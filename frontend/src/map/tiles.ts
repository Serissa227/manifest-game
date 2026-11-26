// 大地图的两种画面（FRAMEWORK §5.4）：
// - 世界图：整张海图，大地图（1080 × 396 这样的）每格 2 像素（由每格 4 像素的海图 2×2 取平均缩成），经典世界照旧每格 4 像素；
// - 航行视图：以舰队为中心的局部海图，64 × 64 格一块、每格 12 像素（海图位图最近邻放大 3 倍，未探明处盖上羊皮纸迷雾），
//   按需生成、LRU 缓存，内存上限桌面 200 MB、手机 120 MB。
// 这里是纯计算（不碰 DOM）：后台线程（chart.worker.ts）与主线程的后备实现共用；LRU 缓存与可见瓦片的计算也在这里。
import { DETAIL_CELL, DETAIL_TILE } from "../art/map/types";
import { P } from "../art/palette";
import { Px, rgba } from "../art/px";
import type { RgbaImage } from "./chartWork";
import { modX, visibleCopies } from "./wrap";

/** 航行视图每块的边长（格）。 */
export const NAV_TILE = 64;
/** 航行视图每格的像素（海图位图每格 4 像素，放大 3 倍）。 */
export const NAV_CELL_PX = 12;
/** 海图位图每格的像素（CHART_CELL）。 */
export const BASE_CELL_PX = 4;
/**
 * 细节瓦片（第九批 M01“细海图”，只有带细图层的地图才有）：32 × 32 格一块、每格 24 个美术像素。
 * 世界图的近档与航行视图共用；地形与迷雾分开两张（迷雾变了不必重画地形）。
 */
export const DETAIL_TILE_CELLS = DETAIL_TILE;
export const DETAIL_CELL_PX = DETAIL_CELL;
/** 细节瓦片缓存的内存上限（桌面版，内存暂不是约束）。 */
export const DETAIL_BUDGET = 512 * 1024 * 1024;
/**
 * 航行画面的高清瓦片（H10c：8 × 8 格一块、每格 96 像素，一块 768² 约 2.25 MiB）缓存的内存上限：约 450 块，
 * 缺省缩放下约 20 屏的海域；迷雾另记（只有带未探明格的块才占）。
 */
export const HD_BUDGET = 1024 * 1024 * 1024;
export const HD_FOG_BUDGET = 256 * 1024 * 1024;
/** 超过这么多格的地图按大地图处理：世界图每格 2 像素（经典世界 400 × 170 = 68 000 格，不受影响）。 */
export const BIG_MAP_CELLS = 100_000;
const MB = 1024 * 1024;
/** 瓦片缓存的内存上限。 */
export const MEMORY_BUDGET = { desktop: 200 * MB, mobile: 120 * MB } as const;

/** 是否按大地图处理。 */
export function isBigMap(width: number, height: number): boolean {
  return width * height > BIG_MAP_CELLS;
}

/** 世界图的缩小倍数：大地图 2（每格 2 像素），其余 1（每格 4 像素，与以前相同）。 */
export function worldScaleOf(width: number, height: number): 1 | 2 {
  return isBigMap(width, height) ? 2 : 1;
}

/** 是不是手机（粗指针、窄屏或移动端的 UA）：决定瓦片缓存的内存上限。 */
export function isMobileDevice(): boolean {
  try {
    if (typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(pointer: coarse)").matches && Math.min(window.screen?.width ?? 9999, window.screen?.height ?? 9999) < 900;
    }
  } catch {
    // 取不到时按桌面
  }
  return false;
}

/** 瓦片缓存的内存上限（字节）。 */
export function memoryBudget(mobile = isMobileDevice()): number {
  return mobile ? MEMORY_BUDGET.mobile : MEMORY_BUDGET.desktop;
}

/**
 * 按字节计量的 LRU 缓存：超过上限时从最久没用的开始淘汰（至少留下刚放进去的一项）。
 * get 会把命中的项移到最新；淘汰与替换时调用 onEvict（释放画布、位图）。
 */
export class LruCache<V> {
  private readonly map = new Map<string, { v: V; bytes: number }>();
  private total = 0;

  constructor(
    readonly budget: number,
    private readonly sizeOf: (v: V) => number,
    private readonly onEvict?: (key: string, v: V) => void,
  ) {}

  get bytes(): number {
    return this.total;
  }

  get size(): number {
    return this.map.size;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  get(key: string): V | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    this.map.set(key, e);
    return e.v;
  }

  /** 不改变新旧顺序地看一眼。 */
  peek(key: string): V | undefined {
    return this.map.get(key)?.v;
  }

  set(key: string, v: V): void {
    const old = this.map.get(key);
    if (old) {
      this.map.delete(key);
      this.total -= old.bytes;
      if (old.v !== v) this.onEvict?.(key, old.v);
    }
    const bytes = Math.max(0, this.sizeOf(v));
    this.map.set(key, { v, bytes });
    this.total += bytes;
    for (const [k, e] of this.map) {
      if (this.total <= this.budget || this.map.size <= 1) break;
      if (k === key) continue;
      this.map.delete(k);
      this.total -= e.bytes;
      this.onEvict?.(k, e.v);
    }
  }

  delete(key: string): boolean {
    const e = this.map.get(key);
    if (!e) return false;
    this.map.delete(key);
    this.total -= e.bytes;
    this.onEvict?.(key, e.v);
    return true;
  }

  /** 删掉键满足条件的项（迷雾变化时作废相关的瓦片）。 */
  dropWhere(pred: (key: string) => boolean): number {
    let n = 0;
    for (const k of [...this.map.keys()]) if (pred(k) && this.delete(k)) n++;
    return n;
  }

  clear(): void {
    for (const k of [...this.map.keys()]) this.delete(k);
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}

/** 瓦片的键。 */
export function tileKey(season: number, tx: number, ty: number): string {
  return `${season}:${tx}:${ty}`;
}

/** 解析瓦片的键。 */
export function parseTileKey(key: string): { season: number; tx: number; ty: number } | null {
  const m = /^(-?\d+):(-?\d+):(-?\d+)$/.exec(key);
  return m ? { season: Number(m[1]), tx: Number(m[2]), ty: Number(m[3]) } : null;
}

/** 一块要画的瓦片：tx、ty 为瓦片编号（tx 已取模）；x、y 为它左上角的格坐标（横向展开，可以在 [0, W) 之外）。 */
export interface TileSlot {
  tx: number;
  ty: number;
  x: number;
  y: number;
}

/** 地图横向、纵向各有几块瓦片（最后一块可以不满）。 */
export function tileCounts(width: number, height: number, tile = NAV_TILE): { nx: number; ny: number } {
  return { nx: Math.ceil(width / tile), ny: Math.ceil(height / tile) };
}

/**
 * 视野里的瓦片：视野中心在格 (cx, cy)、大小 viewW × viewH 像素、每格 cellPx 像素。
 * 环绕时按副本展开（接缝两侧各取各的瓦片；宽度不是 64 的整数倍时最后一块不满，也能接上），不环绕时裁到图内。
 * 按离视野中心由近到远排序（先生成近的）。
 */
export function visibleTiles(
  cx: number,
  cy: number,
  viewW: number,
  viewH: number,
  cellPx: number,
  width: number,
  height: number,
  wrap: boolean,
  tile = NAV_TILE,
): TileSlot[] {
  if (!(cellPx > 0) || width <= 0 || height <= 0) return [];
  const halfW = viewW / 2 / cellPx;
  const halfH = viewH / 2 / cellPx;
  const left = cx - halfW;
  const right = cx + halfW;
  const top = Math.max(0, cy - halfH);
  const bottom = Math.min(height, cy + halfH);
  if (bottom <= top) return [];
  const { nx, ny } = tileCounts(width, height, tile);
  const ty0 = Math.max(0, Math.floor(top / tile));
  const ty1 = Math.min(ny - 1, Math.floor((bottom - 1e-9) / tile));
  const out: TileSlot[] = [];
  for (const off of visibleCopies(left, right, width, wrap)) {
    const l = Math.max(0, left - off);
    const r = Math.min(width, right - off);
    if (r <= l) continue;
    const tx0 = Math.max(0, Math.floor(l / tile));
    const tx1 = Math.min(nx - 1, Math.floor((r - 1e-9) / tile));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) out.push({ tx, ty, x: off + tx * tile, y: ty * tile });
  }
  const d = (s: TileSlot) => {
    const mx = s.x + tile / 2 - cx;
    const my = s.y + tile / 2 - cy;
    return mx * mx + my * my;
  };
  return out.sort((a, b) => d(a) - d(b));
}

/** 世界图：把整张图按 k×k 取平均缩小（k = 1 时原样返回）。坐标与尺寸一起缩小（向下取整到 k 的倍数之内）。 */
export function downsample(img: RgbaImage, k: number): RgbaImage {
  if (k <= 1) return img;
  const x = Math.floor(img.x / k);
  const y = Math.floor(img.y / k);
  // 对齐到 k 的倍数：源矩形从 x·k 起，覆盖到 img 的右下角
  const sx0 = x * k;
  const sy0 = y * k;
  const w = Math.max(0, Math.ceil((img.x + img.w) / k) - x);
  const h = Math.max(0, Math.ceil((img.y + img.h) / k) - y);
  const data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  for (let oy = 0; oy < h; oy++) {
    for (let ox = 0; ox < w; ox++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let c = 0;
      for (let dy = 0; dy < k; dy++) {
        const py = sy0 + oy * k + dy - img.y;
        if (py < 0 || py >= img.h) continue;
        for (let dx = 0; dx < k; dx++) {
          const px = sx0 + ox * k + dx - img.x;
          if (px < 0 || px >= img.w) continue;
          const i = (py * img.w + px) * 4;
          // 按不透明度加权（迷雾的透明处不把颜色拉灰）
          const al = img.data[i + 3];
          r += img.data[i] * al;
          g += img.data[i + 1] * al;
          b += img.data[i + 2] * al;
          a += al;
          c++;
        }
      }
      const o = (oy * w + ox) * 4;
      if (a > 0) {
        data[o] = Math.round(r / a);
        data[o + 1] = Math.round(g / a);
        data[o + 2] = Math.round(b / a);
      }
      data[o + 3] = c > 0 ? Math.round(a / c) : 0;
    }
  }
  return { x, y, w, h, data };
}

const FOG = {
  shade: rgba(P.parchment),
  rim: rgba(P.parchmentDark),
  line: rgba(P.parchmentDeep),
};
/** 4×4 有序抖动（0–15）。 */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * 航行视图的一块瓦片：从整张海图（每格 basePx 像素，左上角在 (0,0)）裁出 tile × tile 格、最近邻放大到每格 outPx 像素；
 * revealed（每格 1 字节，1 为已揭开；null 表示全部揭开）给出时，未探明的格盖上羊皮纸迷雾（边缘按距离抖动过渡，
 * 斜线阴影与世界图的迷雾一致）。环绕时横向取模；最后一块不满时按实际的格数。
 * base 可以是 RGBA 字节（大地图切瓦片用的整图），也可以是像素缓冲 Px（经典世界记忆化缓存里的海图，不另拷一份）：
 * 两者取到的颜色逐字节相同。
 */
export function tileImage(
  base: RgbaImage | Px,
  basePx: number,
  revealed: Uint8Array | null,
  width: number,
  height: number,
  wrap: boolean,
  tx: number,
  ty: number,
  tile = NAV_TILE,
  outPx = NAV_CELL_PX,
): RgbaImage {
  const cx0 = tx * tile;
  const cy0 = ty * tile;
  const cw = Math.max(0, Math.min(tile, width - cx0));
  const ch = Math.max(0, Math.min(tile, height - cy0));
  const w = cw * outPx;
  const h = ch * outPx;
  const data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  const out32 = new Uint32Array(data.buffer);
  // Px 的像素是 0xRRGGBBAA，要换成小端的 RGBA 字节序；RGBA 字节直接按 32 位读
  const packed = base instanceof Px;
  const src32 = packed ? base.data : new Uint32Array(base.data.buffer, base.data.byteOffset, base.data.byteLength >> 2);
  const BW = base.w;
  // 最近邻：输出列 → 源列（每格 outPx 像素对应 basePx 像素）
  const srcCol = new Int32Array(w);
  for (let ox = 0; ox < w; ox++) {
    const sx = cx0 * basePx + Math.floor((ox * basePx) / outPx);
    srcCol[ox] = wrap ? modX(sx, width * basePx) : Math.min(BW - 1, sx);
  }
  let lastSy = -1;
  for (let oy = 0; oy < h; oy++) {
    const sy = Math.min(base.h - 1, cy0 * basePx + Math.floor((oy * basePx) / outPx));
    const row = oy * w;
    if (sy === lastSy) {
      out32.copyWithin(row, row - w, row);
      continue;
    }
    lastSy = sy;
    const srow = sy * BW;
    if (packed) for (let ox = 0; ox < w; ox++) out32[row + ox] = toLE(src32[srow + srcCol[ox]]);
    else for (let ox = 0; ox < w; ox++) out32[row + ox] = src32[srow + srcCol[ox]];
  }
  if (revealed) paintTileFog(out32, w, h, revealed, width, height, wrap, cx0, cy0, cw, ch, outPx);
  return { x: cx0 * outPx, y: cy0 * outPx, w, h, data };
}

/**
 * 细节瓦片的迷雾：与 tileImage 盖的迷雾同一种画法，但单独一张——已揭开处透明，未探明处是羊皮纸。
 * revealed 为 null（还没有迷雾，全部当作揭开）或这一块里没有未探明的格时返回 null（不必贴图）。
 */
export function fogTileImage(
  revealed: Uint8Array | null,
  width: number,
  height: number,
  wrap: boolean,
  tx: number,
  ty: number,
  tile = DETAIL_TILE_CELLS,
  outPx = DETAIL_CELL_PX,
): RgbaImage | null {
  if (!revealed) return null;
  const cx0 = tx * tile;
  const cy0 = ty * tile;
  const cw = Math.max(0, Math.min(tile, width - cx0));
  const ch = Math.max(0, Math.min(tile, height - cy0));
  if (cw === 0 || ch === 0) return null;
  // 这一块连同四周两格（迷雾的边缘伸得到这么远）都已揭开：没有迷雾
  let any = false;
  for (let y = Math.max(0, cy0 - 2); y < Math.min(height, cy0 + ch + 2) && !any; y++) {
    for (let x = cx0 - 2; x < cx0 + cw + 2; x++) {
      const xx = wrap ? modX(x, width) : Math.max(0, Math.min(width - 1, x));
      if (!revealed[y * width + xx]) {
        any = true;
        break;
      }
    }
  }
  if (!any) return null;
  const w = cw * outPx;
  const h = ch * outPx;
  const data = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  paintTileFog(new Uint32Array(data.buffer), w, h, revealed, width, height, wrap, cx0, cy0, cw, ch, outPx);
  return { x: cx0 * outPx, y: cy0 * outPx, w, h, data };
}

/** 未探明的格：按到已揭开格的距离（格级 3×3 平滑后双线性插值）抖动过渡，远处整片羊皮纸。 */
function paintTileFog(
  out32: Uint32Array,
  w: number,
  h: number,
  revealed: Uint8Array,
  width: number,
  height: number,
  wrap: boolean,
  cx0: number,
  cy0: number,
  cw: number,
  ch: number,
  outPx: number,
) {
  // 格级的“雾浓度”（0 已揭开、1 未探明），四周多取 2 格，3×3 平滑
  const M = 2;
  const gw = cw + 2 * M;
  const gh = ch + 2 * M;
  const raw = new Float32Array(gw * gh);
  let any = false;
  for (let gy = 0; gy < gh; gy++) {
    const y = Math.max(0, Math.min(height - 1, cy0 + gy - M));
    for (let gx = 0; gx < gw; gx++) {
      let x = cx0 + gx - M;
      x = wrap ? modX(x, width) : Math.max(0, Math.min(width - 1, x));
      const v = revealed[y * width + x] ? 0 : 1;
      raw[gy * gw + gx] = v;
      if (v) any = true;
    }
  }
  if (!any) return;
  const fogv = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = gy + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = gx + dx;
          if (xx < 0 || xx >= gw) continue;
          const wgt = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
          s += raw[yy * gw + xx] * wgt;
          n += wgt;
        }
      }
      fogv[gy * gw + gx] = s / n;
    }
  }
  // 像素格的整片判断：雾浓度为 0 的格整格跳过，为 1 且四邻都是 1 的格整格铺满
  for (let py = 0; py < h; py++) {
    const fy = py / outPx - 0.5 + M;
    const gy0 = Math.max(0, Math.min(gh - 2, Math.floor(fy)));
    const ty = Math.max(0, Math.min(1, fy - gy0));
    const absY = cy0 * outPx + py;
    for (let px = 0; px < w; px++) {
      const fx = px / outPx - 0.5 + M;
      const gx0 = Math.max(0, Math.min(gw - 2, Math.floor(fx)));
      const tx = Math.max(0, Math.min(1, fx - gx0));
      const i0 = gy0 * gw + gx0;
      const a = fogv[i0];
      const b = fogv[i0 + 1];
      const c = fogv[i0 + gw];
      const d = fogv[i0 + gw + 1];
      if (a + b + c + d === 0) continue;
      const v = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
      const absX = cx0 * outPx + px;
      const th = (BAYER4[(absY & 3) * 4 + (absX & 3)] + 0.5) / 16;
      // 边缘：浓度 0.35–0.75 之间抖动过渡
      const k = (v - 0.35) / 0.4;
      if (k <= 0 || (k < 1 && th >= k)) continue;
      // 羊皮纸：斜线阴影（与世界图迷雾的底纹一致），边缘一圈深色描边
      const edge = k < 1.15;
      out32[py * w + px] = toLE(edge ? FOG.rim : (absX + absY) % 6 === 0 && (absX & 1) === 0 ? FOG.rim : FOG.shade);
    }
  }
}

/** Px 的颜色（0xRRGGBBAA）→ Uint32Array 视图上的小端 RGBA 字节序。 */
function toLE(c: number): number {
  return (((c & 0xff) << 24) | (((c >>> 8) & 0xff) << 16) | (((c >>> 16) & 0xff) << 8) | ((c >>> 24) & 0xff)) >>> 0;
}

/** 瓦片与 RGBA 图占用的字节数。 */
export function imageBytes(img: { w: number; h: number }): number {
  return img.w * img.h * 4;
}
