// 海图的地理图层（EXPANSION.md §10.3）：海陆、高程（0–9）与植被代码，缺图层时的回退推导；
// 以及像素级的平滑海岸遮罩与距离场。全部确定性，不依赖 DOM。
//
// 回退（旧数据、测试夹具没有 relief / biomes 图层时）：
//   高程 = 离岸距离（越往内陆越高）+ 山脊噪声（成条带的山脉），海岸格不超过 2；
//   植被 = 纬度（冷—温—热，按 170 行的世界比例换算；有投影的地图按真实纬度换算到同一刻度）+ 离海距离（近海湿润、内陆干燥）
//          + 高程（最高处为高山）。
// 图层里个别格与海陆图不一致（陆格写了 '.'、代码不认识）时，只有这些格按回退推导。
import { FINE_LAND, FINE_MIXED, type FineLayers } from "./fine";
import { chamfer, fbmField, RowSampler, tileField } from "./noise";
import { projectedClassicLat } from "./projection";
import { CHART_CELL, type ChartInput } from "./types";

const C = CHART_CELL;

/** 植被代码（与 biomes.txt 的字符一一对应，下标即 VEG 的编号）。 */
export const VEG_CODES = "ITBFGMKDSJWAVX";

/** 植被 / 地貌编号（只追加，不改已有编号）。 */
export const VEG = {
  /** I 冰原 */
  ICE: 0,
  /** T 冻原 */
  TUNDRA: 1,
  /** B 针叶林 */
  BOREAL: 2,
  /** F 温带阔叶林 */
  FOREST: 3,
  /** G 温带草原 */
  GRASS: 4,
  /** M 地中海灌丛 */
  MEDIT: 5,
  /** K 半干旱草原 */
  STEPPE: 6,
  /** D 热带沙漠 */
  DESERT: 7,
  /** S 稀树草原 */
  SAVANNA: 8,
  /** J 热带雨林 */
  JUNGLE: 9,
  /** W 湿地 / 红树林 */
  WETLAND: 10,
  /** A 高山（裸岩与积雪） */
  ALPINE: 11,
  /** V 火山地 */
  VOLCANIC: 12,
  /** X 奥术地貌（奇观专用） */
  ARCANE: 13,
} as const;
export type Veg = (typeof VEG)[keyof typeof VEG];
export const VEG_COUNT = VEG_CODES.length;
/** 海格的植被编号。 */
export const SEA_VEG = 255;

/** 格级的地理图层。 */
export interface Geo {
  W: number;
  H: number;
  /** 0 深海、1 浅海、2 陆地 */
  terr: Uint8Array;
  /** 陆格的高程 0–9（海格为 0） */
  relief: Uint8Array;
  /** 陆格的植被编号（VEG），海格为 SEA_VEG */
  veg: Uint8Array;
  /** 陆格到最近海格的倒角距离（格；紧挨海的陆格为 1），海格为 0 */
  landDist: Float32Array;
  /** 海格到最近陆格的倒角距离（格），陆格为 0 */
  seaDist: Float32Array;
  /** 高程与植被是否来自数据图层（false 表示整张按回退推导） */
  fromData: { relief: boolean; biomes: boolean };
}

/** 世界的标准行数：没有投影时回退植被的纬度按它换算（小地图的测试夹具按比例处理）。 */
const WORLD_ROWS = 170;

/** 由海图输入整理出格级的地理图层（缺图层时按回退推导）。 */
export function geoLayers(input: ChartInput): Geo {
  const W = Math.max(1, input.width);
  const H = Math.max(1, input.height);
  const N = W * H;
  const terr = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    const row = input.rows[y] ?? "";
    for (let x = 0; x < W; x++) {
      const ch = row[x];
      terr[y * W + x] = ch === "#" ? 2 : ch === "-" ? 1 : 0;
    }
  }
  const landDist = chamfer(W, H, (i) => terr[i] !== 2);
  const seaDist = chamfer(W, H, (i) => terr[i] === 2);
  for (let i = 0; i < N; i++) {
    if (landDist[i] > 999) landDist[i] = 999;
    if (seaDist[i] > 999) seaDist[i] = 999;
  }

  // —— 高程 ——
  const relief = new Uint8Array(N);
  const rl = validRows(input.relief, W, H);
  const nRidge = fbmField(W, H, 16, 1301);
  const nRidge2 = fbmField(W, H, 9, 1307);
  const nBump = fbmField(W, H, 5, 1311);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (terr[i] !== 2) continue;
      const ch = rl ? rl[y].charCodeAt(x) - 48 : -1;
      if (ch >= 0 && ch <= 9) {
        relief[i] = ch;
        continue;
      }
      // 回退：离岸距离 + 两组山脊噪声（等值线附近为山脊，彼此交叉时山脉分叉）
      const d = landDist[i];
      const inland = Math.min(d, 16) / 16;
      // 山脊只在噪声等值线附近很窄的一带（6 次方），山脉是细长的条带而不是满地的山
      const ra = 1 - Math.abs(nRidge(x, y) - 0.5) * 2;
      const rb = 1 - Math.abs(nRidge2(x, y) - 0.5) * 2;
      const ra3 = ra * ra * ra;
      const rb3 = rb * rb * rb;
      const ridge = Math.max(ra3 * ra3, rb3 * rb3 * 0.75);
      let r = inland * 2.6 + ridge * 6.8 * Math.min(1, d / 5) + (nBump(x, y) - 0.5) * 1.4;
      if (d <= 1.5) r = Math.min(r, 2);
      relief[i] = Math.max(0, Math.min(9, Math.round(r)));
    }
  }

  // —— 植被 ——
  const veg = new Uint8Array(N).fill(SEA_VEG);
  const bl = validRows(input.biomes, W, H);
  const nLat = fbmField(W, H, 22, 1321);
  const nWet = fbmField(W, H, 14, 1327);
  const latScale = WORLD_ROWS / Math.max(H, 1);
  const proj = input.projection ?? null;
  for (let y = 0; y < H; y++) {
    // 没有投影：照旧按 170 行的比例（经典世界逐位不变）；有投影：真实纬度换算到同一刻度
    const rowLat = proj ? projectedClassicLat(proj, y) : y * latScale;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (terr[i] !== 2) continue;
      const code = bl ? VEG_CODES.indexOf(bl[y][x]) : -1;
      if (code >= 0) {
        veg[i] = code;
        continue;
      }
      veg[i] = fallbackVeg(rowLat + (nLat(x, y) - 0.5) * 14, landDist[i], relief[i], nWet(x, y));
    }
  }
  return { W, H, terr, relief, veg, landDist, seaDist, fromData: { relief: rl !== null, biomes: bl !== null } };
}

/** 图层的行数与每行长度都对得上才使用（否则整张按回退）。 */
function validRows(rows: readonly string[] | undefined, W: number, H: number): readonly string[] | null {
  if (!rows || rows.length < H) return null;
  for (let y = 0; y < H; y++) if ((rows[y]?.length ?? 0) < W) return null;
  return rows;
}

/**
 * 回退植被：lat 为换算到 170 行世界的纬度（已加扰动），d 为离海距离（格），r 为高程，wet 为 [0,1) 的湿度噪声。
 * 规则与 §10.1 的气候带一致：北冰原—冻原—针叶林—温带（近海阔叶林、内陆草原）—地中海（近海灌丛、内陆半干旱）—
 * 副热带沙漠—热带（湿处雨林、干处稀树草原，低洼海岸为湿地）。
 */
function fallbackVeg(lat: number, d: number, r: number, wet: number): number {
  if (r >= 8) return VEG.ALPINE;
  const moist = Math.max(0, 1 - (d - 1) / 22) * 0.6 + wet * 0.55;
  if (lat < 7) return VEG.ICE;
  if (lat < 16) return VEG.TUNDRA;
  if (lat < 42) return moist < 0.3 && lat > 32 ? VEG.GRASS : VEG.BOREAL;
  if (lat < 80) return moist > 0.42 ? VEG.FOREST : VEG.GRASS;
  if (lat < 104) return d <= 7 ? VEG.MEDIT : moist > 0.5 ? VEG.GRASS : VEG.STEPPE;
  if (lat < 124) return moist > 0.78 ? VEG.STEPPE : VEG.DESERT;
  if (r <= 1 && d <= 2 && wet > 0.62) return VEG.WETLAND;
  return moist > 0.48 ? VEG.JUNGLE : VEG.SAVANNA;
}

// ───────────────────────────── 像素级的海岸 ─────────────────────────────

/** 像素级的海陆与距离场。 */
export interface CoastPx {
  PW: number;
  PH: number;
  /** 每像素 1 陆地、0 海 */
  land: Uint8Array;
  /** 陆地像素到最近海像素的距离（像素，紧挨海为 1），海像素为 0 */
  inDist: Float32Array;
  /** 海像素到最近陆地像素的距离（像素，紧挨陆地为 1），陆地像素为 0 */
  outDist: Float32Array;
}

/**
 * 平滑的海岸：格级的有符号距离（陆正海负）做 3×3 模糊后双线性插值，海岸带再叠两层噪声（大尺度的湾岬与像素级的碎边），
 * 得到不沿格线的自然海岸。为保证与航行用的海陆图一致：每个陆格中心的 2×2 像素必为陆地、每个海格中心的 2×2 必为海，
 * 相邻同类格之间 2 像素宽的通道也保留（1 格宽的海峡与地峡不会被抹掉）。
 */
export function coastPixels(geo: Geo, input?: Pick<ChartInput, "fine" | "fineOffsetX">): CoastPx {
  const { W, H, terr, landDist, seaDist } = geo;
  const PW = W * C;
  const PH = H * C;
  const N = W * H;
  // 有细图层（寰宇）：海岸取细海岸层降采样得到的真实海岸，不做下面的假细节
  const fine = input?.fine;
  if (fine && fine.height === H && fine.sub % C === 0) {
    const land = fineCoastLand(geo, fine, input?.fineOffsetX ?? 0);
    return { PW, PH, land, inDist: pxDistance(PW, PH, (i) => land[i] === 0), outDist: pxDistance(PW, PH, (i) => land[i] === 1) };
  }
  // 有符号距离（陆地为正），限制在 ±6 格
  const sd = new Float32Array(N);
  for (let i = 0; i < N; i++) sd[i] = terr[i] === 2 ? Math.min(6, landDist[i] - 0.5) : -Math.min(6, seaDist[i] - 0.5);
  const sdb = blur3(sd, W, H);
  // 同类邻格的掩码：1 左、2 右、4 上、8 下
  const same = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const l = terr[i] === 2;
      let m = 0;
      if (x > 0 && (terr[i - 1] === 2) === l) m |= 1;
      if (x < W - 1 && (terr[i + 1] === 2) === l) m |= 2;
      if (y > 0 && (terr[i - W] === 2) === l) m |= 4;
      if (y < H - 1 && (terr[i + W] === 2) === l) m |= 8;
      same[i] = m;
    }
  }
  const nBig = tileField(512, 11, 1401);
  const nFine = tileField(512, 3.2, 1409);
  const land = new Uint8Array(PW * PH);
  const rows = new RowSampler(W, H, C);
  const rowV = new Float64Array(PW);
  for (let py = 0; py < PH; py++) {
    rows.row(sdb, py, rowV);
    const gy = Math.floor(py / C);
    const oy = py - gy * C;
    const midY = oy === 1 || oy === 2;
    for (let px = 0; px < PW; px++) {
      const gx = Math.floor(px / C);
      const ox = px - gx * C;
      const cell = gy * W + gx;
      const isLandCell = terr[cell] === 2;
      const midX = ox === 1 || ox === 2;
      const m = same[cell];
      // 格中心与通往同类邻格的通道：直接取格的类型
      const core =
        (midX && midY) ||
        (midY && ((ox >= 2 && m & 2) || (ox <= 1 && m & 1))) ||
        (midX && ((oy >= 2 && m & 8) || (oy <= 1 && m & 4)));
      let isLand: boolean;
      if (core) isLand = isLandCell;
      else {
        let v = rowV[px];
        if (v > -1.7 && v < 1.7) v += (nBig(px, py) - 0.5) * 1.5 + (nFine(px, py) - 0.5) * 0.7;
        isLand = v > 0;
      }
      if (isLand) land[py * PW + px] = 1;
    }
  }
  const inDist = pxDistance(PW, PH, (i) => land[i] === 0);
  const outDist = pxDistance(PW, PH, (i) => land[i] === 1);
  return { PW, PH, land, inDist, outDist };
}

/**
 * 真实海岸（第九批 M01）：把细海岸层（每粗格 sub × sub 细格）降采样到每格 4 像素——每个像素盖 6 × 6 细格，
 * 陆的细格不少于 16 个（略偏向陆：细长的半岛与小岛不至于消失）就是陆；湖与海都算水。
 * 航行网格仍是权威：每个可航行格中心的 2 × 2 像素必是水，上下左右相邻的可航行格之间留 2 像素宽的水道；
 * 陆格里一个陆像素都没有时（很小的岛）中心的 2 × 2 像素画成陆，港口所在的小岛在远档也看得见。
 * offX：本图第 0 列对应细图层的哪一列（环绕地图补边后为负），按细图层的宽度取模。
 */
function fineCoastLand(geo: Geo, fine: FineLayers, offX: number): Uint8Array {
  const { W, H, terr } = geo;
  const PW = W * C;
  const K = fine.sub / C;
  const need = Math.ceil(K * K * 0.44);
  const land = new Uint8Array(PW * H * C);
  const FW = fine.width;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const fc = y * FW + ((((x + offX) % FW) + FW) % FW);
      const kind = fine.kinds[fc];
      const cell = y * W + x;
      let any = false;
      if (kind === FINE_LAND) {
        for (let oy = 0; oy < C; oy++) land.fill(1, (y * C + oy) * PW + x * C, (y * C + oy) * PW + x * C + C);
        any = true;
      } else if (kind === FINE_MIXED) {
        const base = fine.blockOf[fc] * fine.blockLen;
        for (let oy = 0; oy < C; oy++) {
          for (let ox = 0; ox < C; ox++) {
            let n = 0;
            for (let fy = oy * K; fy < oy * K + K; fy++) {
              let bit = (fy * fine.sub + ox * K) * 2;
              for (let k = 0; k < K; k++, bit += 2) if (((fine.blocks[base + (bit >> 3)] >> (bit & 7)) & 3) === FINE_LAND) n++;
            }
            if (n >= need) {
              land[(y * C + oy) * PW + x * C + ox] = 1;
              any = true;
            }
          }
        }
      }
      // 陆格里没有陆像素：中心画成陆
      if (terr[cell] === 2 && !any) {
        for (let oy = 1; oy <= 2; oy++) for (let ox = 1; ox <= 2; ox++) land[(y * C + oy) * PW + x * C + ox] = 1;
      }
    }
  }
  // 可航行格：中心与通往上下左右可航行邻格的水道必是水
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (terr[y * W + x] === 2) continue;
      const px = x * C;
      const py = y * C;
      const water = (ox0: number, oy0: number, ox1: number, oy1: number) => {
        for (let oy = oy0; oy <= oy1; oy++) for (let ox = ox0; ox <= ox1; ox++) land[(py + oy) * PW + px + ox] = 0;
      };
      water(1, 1, 2, 2);
      if (x > 0 && terr[y * W + x - 1] !== 2) water(0, 1, 0, 2);
      if (x < W - 1 && terr[y * W + x + 1] !== 2) water(3, 1, 3, 2);
      if (y > 0 && terr[(y - 1) * W + x] !== 2) water(1, 0, 2, 0);
      if (y < H - 1 && terr[(y + 1) * W + x] !== 2) water(1, 3, 2, 3);
    }
  }
  return land;
}

/** 逐格的有符号距离做一次 [1 2 1] 的可分离模糊（边缘按夹取处理）。 */
export function blur3(f: Float32Array, W: number, H: number): Float32Array {
  const t = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = f[x > 0 ? i - 1 : i];
      const b = f[x < W - 1 ? i + 1 : i];
      t[i] = (a + 2 * f[i] + b) / 4;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const a = t[y > 0 ? i - W : i];
      const b = t[y < H - 1 ? i + W : i];
      out[i] = (a + 2 * t[i] + b) / 4;
    }
  }
  return out;
}

/**
 * 像素级的倒角距离（3-4 权重，结果换算成像素）：源像素为 0，其余为到最近源像素的距离（紧挨源为 1）。
 * 没有源时全为很大的值。
 */
export function pxDistance(w: number, h: number, isSource: (i: number) => boolean): Float32Array {
  const n = w * h;
  const d = new Uint16Array(n);
  const BIG = 65000;
  for (let i = 0; i < n; i++) d[i] = isSource(i) ? 0 : BIG;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0 && d[i - 1] + 3 < v) v = d[i - 1] + 3;
      if (y > 0) {
        if (d[i - w] + 3 < v) v = d[i - w] + 3;
        if (x > 0 && d[i - w - 1] + 4 < v) v = d[i - w - 1] + 4;
        if (x < w - 1 && d[i - w + 1] + 4 < v) v = d[i - w + 1] + 4;
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    for (let x = w - 1; x >= 0; x--) {
      const i = row + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < w - 1 && d[i + 1] + 3 < v) v = d[i + 1] + 3;
      if (y < h - 1) {
        if (d[i + w] + 3 < v) v = d[i + w] + 3;
        if (x < w - 1 && d[i + w + 1] + 4 < v) v = d[i + w + 1] + 4;
        if (x > 0 && d[i + w - 1] + 4 < v) v = d[i + w - 1] + 4;
      }
      d[i] = v;
    }
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = d[i] / 3;
  return out;
}
