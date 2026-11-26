// 细图层（第九批 M01“细海图”）：细海岸、细高程、细河流的解码结果与取值工具。纯数据、纯函数，不碰 DOM——
// 后台线程（chart.worker.ts）与主线程的后备实现都用；解码好的数组可以原样结构化克隆给后台线程。
//
// 数据来自后端的 map_fine 命令（三个二进制文件原样下发，格式见 crates/manifest-data/src/fine_map.rs 开头的说明），
// 只有寰宇有；经典世界没有细图层，海图照原来的画法画。航行网格（map.rows）仍是权威：细海岸在导出前已经照“骨架”
// 约束修正过（每个可航行粗格的格心与相邻可航行粗格之间必有水道），但粗格是陆的地方原样保留真实的海湾。

/** 细格的类别。 */
export const FINE_SEA = 0;
export const FINE_LAND = 1;
export const FINE_LAKE = 2;
/** 粗格的类别里“混合”的记号（格内的细格不全是一类，要查块）。 */
export const FINE_MIXED = 3;

/** 一段细河流：等级（Natural Earth 的 scalerank，越小河越大）与折线。 */
export interface FineRiver {
  rank: number;
  /** 细格坐标 x0, y0, x1, y1, …（横向不取模，跨接缝的河段照展开的坐标连着走） */
  pts: Int32Array;
}

/** 解码好的细图层。 */
export interface FineLayers {
  /** 三个文件内容的哈希（后端给的，缓存与海图的键用） */
  hash: string;
  /** 每粗格的细分数（24）：一粗格 = sub × sub 细格 */
  sub: number;
  /** 粗格的宽高（与航行网格相同） */
  width: number;
  height: number;
  /** 每粗格：0 整格是海、1 整格是陆、2 整格是内陆水、3 混合 */
  kinds: Uint8Array;
  /** 每粗格的块号（不是混合格为 −1） */
  blockOf: Int32Array;
  /** 混合块：每块 blockLen 字节，每细格 2 位，块内行优先、字节内低位在前 */
  blocks: Uint8Array;
  blockLen: number;
  /** 细高程：每粗格 elevPer × elevPer 个样本（ETOPO5 的 5 角分），单位米，海底为负 */
  elevW: number;
  elevH: number;
  elevPer: number;
  elevation: Int16Array;
  rivers: FineRiver[];
}

function u16(b: Uint8Array, at: number): number {
  return b[at] | (b[at + 1] << 8);
}

function u32(b: Uint8Array, at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}

function magic(b: Uint8Array, text: string): boolean {
  if (b.length < text.length) return false;
  for (let i = 0; i < text.length; i++) if (b[i] !== text.charCodeAt(i)) return false;
  return true;
}

/** 解压 zlib 流的函数（浏览器与 Node 用 DecompressionStream，见 map/fineLayers.ts；测试里可以换成同步的）。 */
export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

/** 细海岸（coast.bin）。 */
export async function decodeFineCoast(bytes: Uint8Array, inflate: Inflate): Promise<Pick<FineLayers, "sub" | "width" | "height" | "kinds" | "blockOf" | "blocks" | "blockLen">> {
  if (!magic(bytes, "MFCOAST1") || bytes.length < 32) throw new Error("fine coast: bad magic");
  const width = u32(bytes, 8);
  const height = u32(bytes, 12);
  const sub = u16(bytes, 16);
  if (u16(bytes, 18) !== 1) throw new Error("fine coast: unsupported version");
  const mixed = u32(bytes, 20);
  const raw = u32(bytes, 24);
  const blockLen = Math.ceil((sub * sub * 2) / 8);
  const cells = width * height;
  if (!(cells > 0) || sub <= 0 || raw !== cells + mixed * blockLen || bytes.length !== 32 + u32(bytes, 28)) throw new Error("fine coast: bad header");
  const payload = await inflate(bytes.subarray(32));
  if (payload.length !== raw) throw new Error("fine coast: bad payload");
  const kinds = payload.slice(0, cells);
  const blocks = payload.slice(cells);
  const blockOf = new Int32Array(cells).fill(-1);
  let next = 0;
  for (let i = 0; i < cells; i++) if (kinds[i] === FINE_MIXED) blockOf[i] = next++;
  if (next !== mixed) throw new Error("fine coast: block count mismatch");
  return { sub, width, height, kinds, blockOf, blocks, blockLen };
}

/** 细高程（elevation.bin）。 */
export async function decodeFineElevation(bytes: Uint8Array, inflate: Inflate): Promise<Pick<FineLayers, "elevW" | "elevH" | "elevPer" | "elevation">> {
  if (!magic(bytes, "MFELEV01") || bytes.length < 28) throw new Error("fine elevation: bad magic");
  const elevW = u32(bytes, 8);
  const elevH = u32(bytes, 12);
  const elevPer = u16(bytes, 16);
  if (u16(bytes, 18) !== 1) throw new Error("fine elevation: unsupported version");
  const n = elevW * elevH;
  if (!(n > 0) || elevPer <= 0 || u32(bytes, 20) !== n * 2 || bytes.length !== 28 + u32(bytes, 24)) throw new Error("fine elevation: bad header");
  const payload = await inflate(bytes.subarray(28));
  if (payload.length !== n * 2) throw new Error("fine elevation: bad payload");
  const elevation = new Int16Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    if (i % elevW === 0) prev = 0;
    // 每行横向差分 + 之字形编码；低字节与高字节分两个平面存
    const z = payload[i] | (payload[n + i] << 8);
    prev = (prev + ((z >>> 1) ^ -(z & 1))) | 0;
    elevation[i] = prev;
  }
  return { elevW, elevH, elevPer, elevation };
}

/** 细河流（rivers.bin）。 */
export async function decodeFineRivers(bytes: Uint8Array, inflate: Inflate): Promise<FineRiver[]> {
  if (!magic(bytes, "MFRIVER1") || bytes.length < 32) throw new Error("fine rivers: bad magic");
  if (u16(bytes, 18) !== 1) throw new Error("fine rivers: unsupported version");
  const count = u32(bytes, 20);
  if (bytes.length !== 32 + u32(bytes, 28)) throw new Error("fine rivers: bad header");
  const p = await inflate(bytes.subarray(32));
  if (p.length !== u32(bytes, 24)) throw new Error("fine rivers: bad payload");
  let at = 0;
  const varint = () => {
    let v = 0;
    for (let shift = 0; shift < 35; shift += 7) {
      if (at >= p.length) throw new Error("fine rivers: truncated");
      const b = p[at++];
      v |= (b & 0x7f) << shift;
      if (!(b & 0x80)) return v >>> 0;
    }
    throw new Error("fine rivers: bad varint");
  };
  const signed = () => {
    const v = varint();
    return (v >>> 1) ^ -(v & 1);
  };
  const rivers: FineRiver[] = [];
  for (let r = 0; r < count; r++) {
    if (at >= p.length) throw new Error("fine rivers: truncated");
    const rank = p[at++];
    const n = varint();
    const pts = new Int32Array(n * 2);
    let x = 0;
    let y = 0;
    for (let i = 0; i < n; i++) {
      x += signed();
      y += signed();
      pts[i * 2] = x;
      pts[i * 2 + 1] = y;
    }
    rivers.push({ rank, pts });
  }
  return rivers;
}

/** 细格 (fx, fy) 的类别；横向按环绕取模，纵向越界按最近的一行。 */
export function fineClassAt(f: FineLayers, fx: number, fy: number): number {
  const s = f.sub;
  const FW = f.width * s;
  const x = ((fx % FW) + FW) % FW;
  const y = fy < 0 ? 0 : fy >= f.height * s ? f.height * s - 1 : fy;
  const cx = (x / s) | 0;
  const cy = (y / s) | 0;
  const cell = cy * f.width + cx;
  const kind = f.kinds[cell];
  if (kind !== FINE_MIXED) return kind;
  const bit = ((y - cy * s) * s + (x - cx * s)) * 2;
  return (f.blocks[f.blockOf[cell] * f.blockLen + (bit >> 3)] >> (bit & 7)) & 3;
}

/**
 * 取一片细格的类别：左上角 (x0, y0)、宽 w、高 h（细格坐标；横向按环绕取模，纵向越界按最近的一行）。
 * 按粗格成片地填（整格同类的粗格不逐细格查），比逐格调用 fineClassAt 快一个数量级。
 */
export function fineWindow(f: FineLayers, x0: number, y0: number, w: number, h: number, out: Uint8Array = new Uint8Array(w * h)): Uint8Array {
  const s = f.sub;
  const FW = f.width * s;
  const FH = f.height * s;
  for (let oy = 0; oy < h; oy++) {
    let y = y0 + oy;
    y = y < 0 ? 0 : y >= FH ? FH - 1 : y;
    const cy = (y / s) | 0;
    const iy = y - cy * s;
    const row = oy * w;
    let ox = 0;
    while (ox < w) {
      const x = (((x0 + ox) % FW) + FW) % FW;
      const cx = (x / s) | 0;
      const ix = x - cx * s;
      // 这一粗格在本行里还剩几个细格
      const run = Math.min(s - ix, w - ox);
      const cell = cy * f.width + cx;
      const kind = f.kinds[cell];
      if (kind !== FINE_MIXED) out.fill(kind, row + ox, row + ox + run);
      else {
        const base = f.blockOf[cell] * f.blockLen;
        let bit = (iy * s + ix) * 2;
        for (let k = 0; k < run; k++, bit += 2) out[row + ox + k] = (f.blocks[base + (bit >> 3)] >> (bit & 7)) & 3;
      }
      ox += run;
    }
  }
  return out;
}

/** 细高程的一个样本（米）；横向按环绕取模，纵向越界按最近的一行。 */
export function fineElevationAt(f: FineLayers, ex: number, ey: number): number {
  const x = ((ex % f.elevW) + f.elevW) % f.elevW;
  const y = ey < 0 ? 0 : ey >= f.elevH ? f.elevH - 1 : ey;
  return f.elevation[y * f.elevW + x];
}

/**
 * 由整张细格栅格（行优先，width·sub × height·sub，每细格 1 字节的类别）建细海岸的那一部分——整格同类的粗格不存块，
 * 与后端 `FineCoast::from_raster` 同一种排法。合成世界（测试、预览）用；真实数据由后端下发、不经这里。
 */
export function fineCoastFromRaster(width: number, height: number, sub: number, raster: Uint8Array): Pick<FineLayers, "sub" | "width" | "height" | "kinds" | "blockOf" | "blocks" | "blockLen"> {
  const cells = width * height;
  const blockLen = Math.ceil((sub * sub * 2) / 8);
  const kinds = new Uint8Array(cells);
  const blockOf = new Int32Array(cells).fill(-1);
  const chunks: Uint8Array[] = [];
  const FW = width * sub;
  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const first = raster[cy * sub * FW + cx * sub];
      let uniform = true;
      for (let fy = 0; fy < sub && uniform; fy++) {
        const row = (cy * sub + fy) * FW + cx * sub;
        for (let fx = 0; fx < sub; fx++) {
          if (raster[row + fx] !== first) {
            uniform = false;
            break;
          }
        }
      }
      const cell = cy * width + cx;
      if (uniform) {
        kinds[cell] = first;
        continue;
      }
      kinds[cell] = FINE_MIXED;
      blockOf[cell] = chunks.length;
      const block = new Uint8Array(blockLen);
      for (let fy = 0; fy < sub; fy++) {
        const row = (cy * sub + fy) * FW + cx * sub;
        for (let fx = 0; fx < sub; fx++) {
          const bit = (fy * sub + fx) * 2;
          block[bit >> 3] |= raster[row + fx] << (bit & 7);
        }
      }
      chunks.push(block);
    }
  }
  const blocks = new Uint8Array(chunks.length * blockLen);
  chunks.forEach((b, i) => blocks.set(b, i * blockLen));
  return { sub, width, height, kinds, blockOf, blocks, blockLen };
}
