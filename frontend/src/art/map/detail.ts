// 细节瓦片（第九批 M01“细海图”）：每粗格 24 个美术像素（一个美术像素就是一个细格，约 0.83 角分）的像素海图。
// 世界图的近档与航行视图共用（map/chartWork.ts 按需画、LRU 缓存）；只有带细图层的地图（寰宇）才有，经典世界照旧。
//
// 与整张海图（terrain.ts，每格 4 像素）的不同：海陆直接取细海岸层的真实海岸，不再由格级距离场加噪声做假细节；
// 地势取细高程（ETOPO5，5 角分）做西北光的晕渲与分层设色；河流取细河流的真实河道。
//   海岸：深色岸线、沙滩或岩岸、断续的碎浪；内陆水（湖）与海分色；粗格是陆、细层是水的地方（真实的海湾、河口——
//         航行网格进不去）画成带沙洲的浅滩，“进不去”有个看得见的理由。
//   海：按水深分层（近岸浅水 → 大陆架 → 陆坡 → 深海 → 海沟），层与层之间有序抖动过渡；外海零星的浪纹。
//   陆：14 种地貌（biomes.txt，粗格级）给底色与质感，地貌的交界按平滑噪声打散（不是 24 像素的方块台阶）；
//       晕渲出山脊的明暗，雪线随高程、纬度与季节；森林、草原、沙漠、冻原、雨林各有成片的点画，不是一格一个大图标。
//   四季：色阶沿用整张海图的那一套（terrain.ts 的 groundRamps 与积雪线），南半球季节相反。
//   人文：港口与城市周围是按噪声收边的小块田畴（随季节换色，积雪时只剩田埂）与几栋民居（culture.ts 的小房子，原尺寸）；
//         地标与奇观用它们的图标（landmarks.ts，原尺寸，约半格），都压在迷雾之下。树不再一棵棵画——林地是成片的点画。
// 全部确定性：噪声与点画都按世界像素坐标取，相邻瓦片在边上严丝合缝（只有东西接缝处的纹理噪声不连续，在太平洋中间）。
//
// 性能：一块 768 × 768 像素。逐像素的循环里噪声直接查表（noise.ts 的 tileTable），不经函数调用；
// 纯海、纯陆的瓦片各只走一半的步骤。实测见 docs/drafts/m01-handoff.md。
import { styleOf, type ArchStyle } from "../buildings";
import { P, ink } from "../palette";
import { Px, rgba } from "../px";
import { arable, drawHouse, houseBox } from "./culture";
import { FINE_LAKE, FINE_LAND, fineClassAt, fineWindow, type FineLayers } from "./fine";
import { geoLayers, SEA_VEG, VEG, type Geo } from "./geo";
import { drawLandmarkIcon } from "./landmarks";
import { hash2, mix, tileTable } from "./noise";
import { classicLatOf, latitudeAt } from "./projection";
import { groundRamps, snowBias, snowLevel, SNOW_RAMP } from "./terrain";
import { DETAIL_CELL, DETAIL_TILE, type ChartInput } from "./types";

export { DETAIL_CELL, DETAIL_TILE };

const { ICE, TUNDRA, BOREAL, FOREST, GRASS, MEDIT, STEPPE, DESERT, SAVANNA, JUNGLE, WETLAND, ALPINE, VOLCANIC, ARCANE } = VEG;

/** 颜色 → RGBA 字节序上的 32 位值（小端：低字节是 R）。 */
function le(c: string | number): number {
  const v = rgba(c);
  return (((v & 0xff) << 24) | (((v >>> 8) & 0xff) << 16) | (((v >>> 16) & 0xff) << 8) | ((v >>> 24) & 0xff)) >>> 0;
}

/** 细节瓦片的位图：左上角的美术像素坐标与 RGBA 字节（可直接构造 ImageData）。 */
export interface DetailImage {
  x: number;
  y: number;
  w: number;
  h: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** 一张地图画细节瓦片要用的全部数据（建一次，各块瓦片共用）。 */
export interface DetailContext {
  input: ChartInput;
  fine: FineLayers;
  geo: Geo;
  W: number;
  H: number;
  /** 每粗格：1 可航行 */
  nav: Uint8Array;
  /** 每粗格的地貌；水格取附近陆格的（真实海岸伸进水格的陆地由此着色），远离陆地的为 SEA_VEG */
  vegN: Uint8Array;
  /** 河段按瓦片分的索引（键 `${tx}:${ty}`，值为河段下标）；第一次用到时建 */
  riverIndex: Map<string, number[]> | null;
  /** 有人烟的地点（港口与城市；殖民点不算）：格坐标、是不是城市、建筑风格 */
  towns: { x: number; y: number; city: boolean; style: ArchStyle }[];
}

/** 有细图层、且尺寸与航行网格对得上时才能画细节瓦片。 */
export function detailContext(input: ChartInput): DetailContext | null {
  const fine = input.fine;
  if (!fine || fine.sub !== DETAIL_CELL || fine.width !== input.width || fine.height !== input.height) return null;
  const geo = geoLayers(input);
  const { W, H, terr, veg } = geo;
  const N = W * H;
  const nav = new Uint8Array(N);
  for (let i = 0; i < N; i++) nav[i] = terr[i] === 2 ? 0 : 1;
  // 水格带上附近陆格的地貌：一圈一圈往外传三格
  const vegN = veg.slice();
  let frontier: number[] = [];
  for (let i = 0; i < N; i++) if (vegN[i] !== SEA_VEG) frontier.push(i);
  const wrap = input.wrapX === true;
  for (let step = 0; step < 3; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % W;
      const y = (i / W) | 0;
      for (let d = 0; d < 4; d++) {
        let nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (ny < 0 || ny >= H) continue;
        if (wrap) nx = (nx + W) % W;
        else if (nx < 0 || nx >= W) continue;
        const j = ny * W + nx;
        if (vegN[j] !== SEA_VEG) continue;
        vegN[j] = vegN[i];
        next.push(j);
      }
    }
    frontier = next;
  }
  const towns = (input.places ?? [])
    .filter((p) => p.kind !== "site")
    .map((p) => ({ x: p.x, y: p.y, city: p.kind === "city", style: styleOf(p.faction || undefined, p.style) }));
  return { input, fine, geo, W, H, nav, vegN, riverIndex: null, towns };
}

/** 高程（米）→ 整张海图用的高程等级（0–9，带小数）：积雪线的算式按等级写，这里换算过去。 */
const LEVEL_M = [0, 100, 250, 500, 1000, 1500, 2000, 3000, 4000, 5000];
function levelOfMeters(m: number): number {
  if (m <= 0) return 0;
  for (let i = 1; i < LEVEL_M.length; i++) if (m < LEVEL_M[i]) return i - 1 + (m - LEVEL_M[i - 1]) / (LEVEL_M[i] - LEVEL_M[i - 1]);
  return 9 + Math.min(1, (m - 5000) / 2000);
}
/** 按整米查的表（逐像素用）。 */
const LEVEL_LUT: Float32Array = (() => {
  const t = new Float32Array(9001);
  for (let m = 0; m <= 9000; m++) t[m] = levelOfMeters(m);
  return t;
})();

/** 4×4 有序抖动阈值 → (0, 1)。 */
const BAYER: Float32Array = Float32Array.from([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], (v) => (v + 0.5) / 16);

/** 二次 B 样条在 6 个相位上的三个权重（细高程每 6 像素一个样本）。 */
const SPLINE: Float32Array = (() => {
  const w = new Float32Array(18);
  for (let p = 0; p < 6; p++) {
    // 像素中心相对最近样本中心的偏移（样本宽）：−5/12 … 5/12
    const t = (p + 0.5 - 3) / 6;
    w[p * 3] = 0.5 * (0.5 - t) * (0.5 - t);
    w[p * 3 + 1] = 0.75 - t * t;
    w[p * 3 + 2] = 0.5 * (0.5 + t) * (0.5 + t);
  }
  return w;
})();

/**
 * 细高程在像素窗口上的平滑插值（二次 B 样条，坡度连续，晕渲不会出现 6 像素一块的折面）。
 * clamp 为 1 时样本先夹到 ≥ 0（陆地的地势：近岸的陆地不被海底的深度拉出假陡坡），为 −1 时夹到 ≤ 0（水深）。
 */
function elevationWindow(f: FineLayers, x0: number, y0: number, w: number, h: number, clamp: -1 | 1, out: Float32Array): Float32Array {
  const step = DETAIL_CELL / f.elevPer;
  // 窗口里第一个像素最近的样本，再往前一个
  const sx0 = Math.floor(x0 / step) - 1;
  const sy0 = Math.floor(y0 / step) - 1;
  const ncol = Math.floor((x0 + w - 1) / step) + 1 - sx0 + 1;
  const nrow = Math.floor((y0 + h - 1) / step) + 1 - sy0 + 1;
  const { elevW, elevH, elevation } = f;
  const samples = f32("samples", ncol * nrow);
  for (let r = 0; r < nrow; r++) {
    let ey = sy0 + r;
    ey = ey < 0 ? 0 : ey >= elevH ? elevH - 1 : ey;
    for (let c = 0; c < ncol; c++) {
      const ex = (((sx0 + c) % elevW) + elevW) % elevW;
      let v = elevation[ey * elevW + ex];
      if (clamp > 0) v = v < 0 ? 0 : v;
      else v = v > 0 ? 0 : v;
      samples[r * ncol + c] = v;
    }
  }
  // 陆地的样本再做一次 [1 2 1] 的模糊：细高程在不少地方（非洲、亚洲腹地）本身是成块的粗数据，直接用会晕渲出方方正正的台阶
  if (clamp > 0) {
    const blur = f32("blur", ncol * nrow);
    for (let r = 0; r < nrow; r++) {
      const o = r * ncol;
      for (let c = 0; c < ncol; c++) blur[o + c] = (samples[o + (c > 0 ? c - 1 : c)] + 2 * samples[o + c] + samples[o + (c < ncol - 1 ? c + 1 : c)]) * 0.25;
    }
    for (let r = 0; r < nrow; r++) {
      const o = r * ncol;
      const up = (r > 0 ? r - 1 : r) * ncol;
      const dn = (r < nrow - 1 ? r + 1 : r) * ncol;
      for (let c = 0; c < ncol; c++) samples[o + c] = (blur[up + c] + 2 * blur[o + c] + blur[dn + c]) * 0.25;
    }
  }
  // 横向（按行走，顺着内存）
  const tmp = f32("tmp", nrow * w);
  const col = i32("col", w);
  const phase = i32("phase", w);
  for (let ox = 0; ox < w; ox++) {
    const x = x0 + ox;
    const s = Math.floor(x / step);
    phase[ox] = (x - s * step) * 3;
    col[ox] = s - sx0;
  }
  for (let r = 0; r < nrow; r++) {
    const base = r * ncol;
    const o = r * w;
    for (let ox = 0; ox < w; ox++) {
      const i = base + col[ox];
      const ph = phase[ox];
      tmp[o + ox] = samples[i - 1] * SPLINE[ph] + samples[i] * SPLINE[ph + 1] + samples[i + 1] * SPLINE[ph + 2];
    }
  }
  // 纵向
  for (let oy = 0; oy < h; oy++) {
    const y = y0 + oy;
    const s = Math.floor(y / step);
    const ph = (y - s * step) * 3;
    const r = s - sy0;
    const wa = SPLINE[ph];
    const wb = SPLINE[ph + 1];
    const wc = SPLINE[ph + 2];
    const a = (r - 1) * w;
    const b = r * w;
    const c = (r + 1) * w;
    const o = oy * w;
    for (let ox = 0; ox < w; ox++) out[o + ox] = tmp[a + ox] * wa + tmp[b + ox] * wb + tmp[c + ox] * wc;
  }
  return out;
}

/**
 * 窗口上到岸的距离（3-4 权重的倒角距离，单位 1/3 像素，封顶 255）：水像素到最近的陆、陆像素到最近的水，一遍算出。
 * 先找出岸线两侧紧挨着另一类的像素（八邻域）记作 3（一个像素），其余按到这些像素的倒角距离再加 3——
 * 离一个像素最近的异类像素必在岸线上，所以这就是到异类的距离（差不到半个像素）。
 */
function shoreDistance(w: number, h: number, cls: Uint8Array, d: Uint8Array): Uint8Array {
  const n = w * h;
  d.fill(255, 0, n);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      const land = cls[i] === FINE_LAND;
      if (x > 0 && (cls[i - 1] === FINE_LAND) !== land) d[i] = d[i - 1] = 0;
      if (y > 0) {
        if ((cls[i - w] === FINE_LAND) !== land) d[i] = d[i - w] = 0;
        if (x > 0 && (cls[i - w - 1] === FINE_LAND) !== land) d[i] = d[i - w - 1] = 0;
        if (x < w - 1 && (cls[i - w + 1] === FINE_LAND) !== land) d[i] = d[i - w + 1] = 0;
      }
    }
  }
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
      if (v !== 0) {
        if (x < w - 1 && d[i + 1] + 3 < v) v = d[i + 1] + 3;
        if (y < h - 1) {
          if (d[i + w] + 3 < v) v = d[i + w] + 3;
          if (x < w - 1 && d[i + w + 1] + 4 < v) v = d[i + w + 1] + 4;
          if (x > 0 && d[i + w - 1] + 4 < v) v = d[i + w - 1] + 4;
        }
      }
      // 岸线上的像素离异类一个像素
      d[i] = v > 252 ? 255 : v + 3;
    }
  }
  return d;
}

// 逐块重复使用的草稿缓冲（后台线程里瓦片一块一块地画，不会重入）：省掉每块十几 MB 的分配与随后的垃圾回收。
// 交回去的位图（要转交给主线程）每块新分配，不在这里。
const scratchF32 = new Map<string, Float32Array>();
const scratchU8 = new Map<string, Uint8Array>();
const scratchI32 = new Map<string, Int32Array>();
function f32(name: string, n: number): Float32Array {
  let b = scratchF32.get(name);
  if (!b || b.length < n) scratchF32.set(name, (b = new Float32Array(n)));
  return b;
}
function u8(name: string, n: number): Uint8Array {
  let b = scratchU8.get(name);
  if (!b || b.length < n) scratchU8.set(name, (b = new Uint8Array(n)));
  return b;
}
function i32(name: string, n: number): Int32Array {
  let b = scratchI32.get(name);
  if (!b || b.length < n) scratchI32.set(name, (b = new Int32Array(n)));
  return b;
}

// ───────────────────────────── 配色 ─────────────────────────────

const SEA = P.sea.map(le);
const FOAM = le(P.foam);
/** 湖：比海偏青、偏亮（由深到浅三阶） */
const LAKE = [le(mix(P.sea[2], P.teal[2], 0.45)), le(mix(P.sea[3], P.teal[3], 0.4)), le(mix(P.sea[4], P.teal[4], 0.45))];
/** 浅滩（航行网格进不去的水）：泛绿的浅水（深浅两色）、沙洲与泥滩 */
const SHOAL = [le(mix(P.teal[3], P.sea[4], 0.45)), le(mix(P.teal[4], P.sand[4], 0.32)), le(mix(P.sand[4], P.white, 0.2)), le(mix(P.teal[2], P.sand[2], 0.4))];
/** 岸线：深色的描边（海岸与湖岸），以及沙滩与岩岸 */
const SHORE = le(mix(ink.brown, P.wood[0], 0.4));
const SHORE_ROCK = le(P.stone[0]);
const SHORE_ICE = le(P.snow[0]);
const BEACH = [le(mix(P.sand[4], P.white, 0.3)), le(P.sand[4])];
const ROCK = [le(P.stone[1]), le(P.stone[2]), le(P.stone[3])];
const RIVER = [le(mix(P.sea[3], P.sea[4], 0.35)), le(P.sea[3])];
const RIVER_ICE = le(P.snow[1]);
const ICE_FLOE = [le(P.snow[2]), le(P.snow[1])];
/** 雪里的树：针叶林的深浅两色与落叶林的枯枝 */
const WINTER_TREE = [le(mix(P.leaf[0], P.slate[1], 0.3)), le(mix(P.leaf[1], P.slate[2], 0.35)), le(mix(P.wood[1], P.snow[0], 0.45))];
const LAVA = [le(P.red[2]), le(P.lamp[1])];
/** 田畴：各季的两种庄稼色与翻过的土色（春青、夏金、秋收后的茬、冬闲）；热带的种植园与沙漠的绿洲另取 */
const FIELDS: number[][] = [
  [le(P.leaf[4]), le(P.leaf[3]), le(mix(P.wood[3], P.straw[2], 0.4))],
  [le(mix(P.straw[2], P.leaf[4], 0.25)), le(P.leaf[3]), le(mix(P.straw[2], P.wood[3], 0.35))],
  [le(P.straw[3]), le(mix(P.straw[2], P.wood[3], 0.3)), le(mix(P.wood[3], P.straw[1], 0.5))],
  [le(mix(P.straw[1], P.straw[2], 0.5)), le(mix(P.wood[3], P.straw[1], 0.5)), le(P.wood[2])],
];
const FIELDS_TROPIC = [le(P.jade[3]), le(P.leaf[3]), le(P.wood[2])];
const FIELDS_OASIS = [le(P.leaf[3]), le(P.leaf[2]), le(P.sand[2])];
const HEDGE_SNOW = le(P.snow[0]);
const SPARK = [le(P.teal[4]), le(P.white), le(P.cloth.purple[2])];

interface SeasonPalette {
  ramps: number[][];
  snow: number[];
  bias: Float64Array;
}
const seasonCache = new Map<number, SeasonPalette>();
function seasonPalette(season: number): SeasonPalette {
  let s = seasonCache.get(season);
  if (!s) {
    const ramps = groundRamps(season).map((r) => r.map(le));
    // 稀树草原的雨季在夏天：夏天也用春天那套泛绿的色阶（整张海图只有春天是绿的，热带的岛夏天看着像荒漠）
    if (season === 1) ramps[SAVANNA] = groundRamps(0)[SAVANNA].map(le);
    const bias = new Float64Array(ramps.length);
    for (let v = 0; v < ramps.length; v++) bias[v] = snowBias(v, season);
    s = { ramps, snow: SNOW_RAMP.map(le), bias };
    seasonCache.set(season, s);
  }
  return s;
}

/** 噪声表（按世界像素坐标取；512 的周期 512 像素、256 的周期 256 像素）。 */
interface Noise {
  warpA: Float32Array;
  warpB: Float32Array;
  warpC: Float32Array;
  warpD: Float32Array;
  tone: Float32Array;
  fine: Float32Array;
  ridge: Float32Array;
  ridge2: Float32Array;
  sea: Float32Array;
  foam: Float32Array;
  shoal: Float32Array;
  dune: Float32Array;
  patch: Float32Array;
}
let noiseTables: Noise | null = null;
function noise(): Noise {
  return (noiseTables ??= {
    warpA: tileTable(512, 44, 2101),
    warpB: tileTable(512, 44, 2103),
    warpC: tileTable(256, 10, 2107),
    warpD: tileTable(256, 10, 2109),
    tone: tileTable(512, 34, 2111),
    fine: tileTable(256, 5, 2113),
    ridge: tileTable(512, 14, 2117),
    ridge2: tileTable(256, 6, 2119),
    sea: tileTable(512, 40, 2121),
    foam: tileTable(256, 4, 2123),
    shoal: tileTable(256, 9, 2127),
    dune: tileTable(512, 30, 2129),
    patch: tileTable(512, 60, 2131),
  });
}

/** 河流的宽度（美术像素）：按 Natural Earth 的等级。 */
function riverWidth(rank: number): number {
  return rank <= 2 ? 3 : rank <= 5 ? 2 : 1;
}

/** 河段按瓦片分的索引。 */
function riverIndex(ctx: DetailContext): Map<string, number[]> {
  if (ctx.riverIndex) return ctx.riverIndex;
  const index = new Map<string, number[]>();
  const T = DETAIL_TILE * DETAIL_CELL;
  const FW = ctx.W * DETAIL_CELL;
  const nx = Math.ceil(ctx.W / DETAIL_TILE);
  ctx.fine.rivers.forEach((r, k) => {
    if (r.rank > 9) return;
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < r.pts.length; i += 2) {
      x0 = Math.min(x0, r.pts[i]);
      x1 = Math.max(x1, r.pts[i]);
      y0 = Math.min(y0, r.pts[i + 1]);
      y1 = Math.max(y1, r.pts[i + 1]);
    }
    if (!(x1 >= x0)) return;
    const seen = new Set<string>();
    for (let ty = Math.floor((y0 - 3) / T); ty <= Math.floor((y1 + 3) / T); ty++) {
      // 横向每隔半块瓦片取一个点（地图宽不是瓦片的整数倍，接缝旁的最后一块不满）：取模后落在哪块就记哪块
      for (let fx = x0 - 3; ; fx += T / 2) {
        const x = Math.min(fx, x1 + 3);
        const tx = Math.min(nx - 1, Math.floor((((x % FW) + FW) % FW) / T));
        const key = `${tx}:${ty}`;
        if (!seen.has(key)) {
          seen.add(key);
          const list = index.get(key);
          if (list) list.push(k);
          else index.set(key, [k]);
        }
        if (fx >= x1 + 3) break;
      }
    }
  });
  ctx.riverIndex = index;
  return index;
}

/** 窗口四周多取的像素：岸线、碎浪、浅滩的距离与晕渲的坡度都只看这么远（取高程时挪位 9 像素、再看两侧 6 像素的坡度）。 */
const MARGIN = 18;

/** 一块瓦片各步骤共用的量。 */
interface Tile {
  ctx: DetailContext;
  out: Uint32Array;
  cls: Uint8Array;
  /** 瓦片的宽高与左上角（美术像素） */
  TW: number;
  TH: number;
  X0: number;
  Y0: number;
  /** 窗口（瓦片加四周的余量）的宽高 */
  WW: number;
  WH: number;
  /** 瓦片盖的粗格 */
  cx0: number;
  cy0: number;
  cw: number;
  ch: number;
  /** 北半球的季节（南半球相反） */
  season: number;
  /** 到岸的距离（1/3 像素）：水像素到最近的陆、陆像素到最近的水；纯海或纯陆的瓦片为 null */
  shore: Uint8Array | null;
  /** 这块瓦片附近的城镇：中心（美术像素，已挪到离瓦片最近的那一份上）、田畴的半径与风格 */
  towns: { px: number; py: number; r: number; city: boolean; style: ArchStyle; seed: number }[];
}

/**
 * 画一块细节瓦片：瓦片 (tx, ty) 盖粗格 [tx·32, tx·32 + 32) × [ty·32, ty·32 + 32)，地图边上的最后一块按实际的格数。
 * season：0 春 1 夏 2 秋 3 冬（北半球；南半球自动取相反的季节）。
 */
export function paintDetailTile(ctx: DetailContext, season: number, tx: number, ty: number): DetailImage {
  const { fine, W, H } = ctx;
  const S = DETAIL_CELL;
  const cx0 = tx * DETAIL_TILE;
  const cy0 = ty * DETAIL_TILE;
  const cw = Math.max(0, Math.min(DETAIL_TILE, W - cx0));
  const ch = Math.max(0, Math.min(DETAIL_TILE, H - cy0));
  const TW = cw * S;
  const TH = ch * S;
  const X0 = cx0 * S;
  const Y0 = cy0 * S;
  const data = new Uint8ClampedArray(new ArrayBuffer(TW * TH * 4));
  const image: DetailImage = { x: X0, y: Y0, w: TW, h: TH, data };
  if (TW === 0 || TH === 0) return image;
  const WW = TW + 2 * MARGIN;
  const WH = TH + 2 * MARGIN;
  const NW = WW * WH;
  const cls = fineWindow(fine, X0 - MARGIN, Y0 - MARGIN, WW, WH, u8("cls", NW));
  let lands = 0;
  for (let i = 0; i < NW; i++) lands += cls[i] === FINE_LAND ? 1 : 0;
  const anyLand = lands > 0;
  const anyWater = lands < NW;
  const both = anyLand && anyWater;
  const tile: Tile = {
    ctx,
    out: new Uint32Array(data.buffer),
    cls,
    TW,
    TH,
    X0,
    Y0,
    WW,
    WH,
    cx0,
    cy0,
    cw,
    ch,
    season: ((season % 4) + 4) % 4,
    shore: both ? shoreDistance(WW, WH, cls, u8("shore", NW)) : null,
    towns: anyLand ? townsNear(ctx, X0, Y0, TW, TH) : [],
  };
  if (anyWater) {
    paintWater(tile);
    paintWaves(tile);
  }
  if (anyLand) {
    paintLand(tile);
    paintRivers(tile, tx, ty);
    paintTowns(tile);
    paintLandmarks(tile);
  }
  return image;
}

/** 田畴的半径（美术像素）：港口约一格、城市再大一圈。 */
const TOWN_R = 26;
const CITY_R = 32;

/** 瓦片附近（田畴够得着）的城镇。 */
function townsNear(ctx: DetailContext, X0: number, Y0: number, TW: number, TH: number): Tile["towns"] {
  const S = DETAIL_CELL;
  const FW = ctx.W * S;
  const wrap = ctx.input.wrapX === true;
  const out: Tile["towns"] = [];
  ctx.towns.forEach((p, k) => {
    const r = p.city ? CITY_R : TOWN_R;
    const py = p.y * S + S / 2;
    if (py + r + 8 < Y0 || py - r - 8 > Y0 + TH) return;
    let px = p.x * S + S / 2;
    // 环绕：挪到离这块瓦片最近的那一份
    if (wrap) px += Math.round((X0 + TW / 2 - px) / FW) * FW;
    if (px + r + 8 < X0 || px - r - 8 > X0 + TW) return;
    out.push({ px, py, r, city: p.city, style: p.style, seed: k });
  });
  return out;
}

/** 像素行的纬度（度；没有投影的地图按 45°）。 */
function latOfRow(input: ChartInput, py: number): number {
  const p = input.projection;
  return p ? latitudeAt(p, (py + 0.5) / DETAIL_CELL) : 45;
}

/** 海、湖与浅滩。 */
function paintWater(t: Tile) {
  const { ctx, out, cls, TW, TH, X0, Y0, WW, cx0, cy0, cw, ch } = t;
  const dOut = t.shore;
  const { W, H, nav, input } = ctx;
  const S = DETAIL_CELL;
  const M = MARGIN;
  const wrap = input.wrapX === true;
  const N = noise();
  const nSea = N.sea;
  const nFine = N.fine;
  const nFoam = N.foam;
  const nShoal = N.shoal;
  const nWarpC = N.warpC;
  const nWarpD = N.warpD;
  const seaDepth = elevationWindow(ctx.fine, X0 - M, Y0 - M, WW, t.WH, -1, f32("depth", WW * t.WH));
  // 粗格“可航行”的平滑场：格心取 0 / 1，双线性插值；0.5 上下就是可航行与不可航行的交界。
  // 先按“对偶格”（四个格心围成的方块）判一遍：四角同类、周围八个对偶格也同类的，里面的像素不必插值。
  const gx0 = cx0 - 2;
  const gy0 = cy0 - 2;
  const DW = cw + 4;
  const DH = ch + 4;
  const navCell = (x: number, y: number) => {
    const yy = y < 0 ? 0 : y >= H ? H - 1 : y;
    const xx = wrap ? ((x % W) + W) % W : x < 0 ? 0 : x >= W ? W - 1 : x;
    return nav[yy * W + xx];
  };
  const dualSum = new Uint8Array(DW * DH);
  for (let j = 0; j < DH; j++)
    for (let i = 0; i < DW; i++)
      dualSum[j * DW + i] = navCell(gx0 + i, gy0 + j) + navCell(gx0 + i + 1, gy0 + j) + navCell(gx0 + i, gy0 + j + 1) + navCell(gx0 + i + 1, gy0 + j + 1);
  /** 0 全不可航行、1 全可航行、2 要插值 */
  const dualKind = new Uint8Array(DW * DH).fill(2);
  let shoals = false;
  for (let j = 1; j < DH - 1; j++)
    for (let i = 1; i < DW - 1; i++) {
      const k = j * DW + i;
      const v = dualSum[k];
      if (v !== 4) shoals = true;
      if (v !== 0 && v !== 4) continue;
      let same = true;
      for (let dj = -1; dj <= 1 && same; dj++) for (let di = -1; di <= 1; di++) if (dualSum[k + dj * DW + di] !== v) same = false;
      if (same) dualKind[k] = v === 4 ? 1 : 0;
    }
  const navAt = (px: number, py: number): number => {
    const gx = (px - S / 2) / S;
    const gy = (py - S / 2) / S;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    const a = navCell(x0, y0);
    const b = navCell(x0 + 1, y0);
    const c = navCell(x0, y0 + 1);
    const d = navCell(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const sNorth = t.season;
  const sSouth = (sNorth + 2) % 4;
  const hasDist = dOut !== null;
  for (let oy = 0; oy < TH; oy++) {
    const py = Y0 + oy;
    const wrow = (oy + M) * WW + M;
    const orow = oy * TW;
    const latDeg = latOfRow(input, py);
    const sea = latDeg < 0 ? sSouth : sNorth;
    const lat = latDeg < 0 ? -latDeg : latDeg;
    // 冬天高纬的近岸海冰（春秋只剩极北）：最宽 10 像素（不超过窗口的余量，相邻瓦片接得上）
    const iceReach = Math.min(10, sea === 3 ? (lat - 56) * 0.9 : sea === 0 ? (lat - 66) * 0.8 : sea === 2 ? (lat - 70) * 0.6 : (lat - 76) * 0.5);
    const lakeIce = sea === 3 && lat > 60;
    const dualRow = (Math.floor((py - S / 2) / S) - gy0) * DW;
    const bayRow = (py & 3) * 4;
    const r512 = (py & 511) << 9;
    const r256 = (py & 255) << 8;
    for (let ox = 0; ox < TW; ox++) {
      const wi = wrow + ox;
      const c = cls[wi];
      if (c === FINE_LAND) continue;
      const px = X0 + ox;
      const b = BAYER[bayRow + (px & 3)];
      const dist = hasDist ? dOut[wi] * (1 / 3) : 99;
      const big = nSea[r512 | (px & 511)];
      if (c === FINE_LAKE) {
        // 湖：岸边一圈亮、湖心略深，带一点大尺度的明暗（离岸 10 像素以外一律按湖心，相邻瓦片接得上）
        const v = (dist > 10 ? 10 : dist) / 6 + (big - 0.5) * 0.5;
        const tone = v < 0.45 ? 2 : v < 0.6 ? ((v - 0.45) / 0.15 > b ? 1 : 2) : v < 1.4 ? 1 : v < 1.7 ? ((v - 1.4) / 0.3 > b ? 0 : 1) : 0;
        out[orow + ox] = lakeIce && nFoam[r256 | (px & 255)] > 0.35 ? ICE_FLOE[tone === 2 ? 0 : 1] : LAKE[tone];
        continue;
      }
      // 水深（米）：贴岸两像素必是浅水、五像素以内至少是陆架色；细高程在岸边粗，陆上的样本按浅水算
      let d = -seaDepth[wi];
      if (d < 4) d = 4;
      if (dist <= 2.4) d = d > 12 ? 12 : d;
      else if (dist <= 5.5) d = d > 150 ? 150 : d;
      d *= 0.82 + (big - 0.5) * 0.5 + (nFine[r256 | (px & 255)] - 0.5) * 0.12;
      // 色阶：4 近岸浅水、3 陆架、2 陆坡、1 深海、0 海沟；交界处在一小段里抖动
      let tone: number;
      if (d < 22) tone = 4;
      else if (d < 34) tone = (d - 22) / 12 > b ? 3 : 4;
      else if (d < 170) tone = 3;
      else if (d < 260) tone = (d - 170) / 90 > b ? 2 : 3;
      else if (d < 1700) tone = 2;
      else if (d < 2300) tone = (d - 1700) / 600 > b ? 1 : 2;
      else if (d < 5200) tone = 1;
      else if (d < 6000) tone = (d - 5200) / 800 > b ? 0 : 1;
      else tone = 0;
      let color = SEA[tone];
      // 浅滩：航行网格进不去的水
      if (shoals) {
        const kind = dualKind[dualRow + Math.floor((px - S / 2) / S) - gx0];
        let shoal = kind === 0;
        if (kind === 2) {
          const nv = navAt(px + (nWarpC[r256 | (px & 255)] - 0.5) * 9, py + (nWarpD[r256 | (px & 255)] - 0.5) * 9);
          shoal = nv < 0.5 && (0.5 - nv) / 0.16 > b;
        }
        if (shoal) {
          // 泛绿的浅水上横着一道道断续的沙洲、泥滩与水沟
          const bar = nShoal[((((py * 2.6) | 0) & 255) << 8) | (px & 255)];
          const far = dist > 3.5;
          if (bar > 0.66 && far) color = SHOAL[2];
          else if (bar > 0.63 && far) color = SHOAL[3];
          else color = bar < 0.36 ? SHOAL[0] : SHOAL[1];
        }
      }
      if (hasDist) {
        // 碎浪：贴岸一像素，断断续续
        if (dist <= 1.05 && nFoam[r256 | (px & 255)] > 0.42) color = FOAM;
        // 海冰：近岸的浮冰，越往高纬越宽
        if (iceReach > 0 && dist < iceReach && nFoam[(((py + 11) & 255) << 8) | ((px + 37) & 255)] > 0.5 - Math.min(0.25, iceReach * 0.02)) {
          color = ICE_FLOE[hash2(px >> 1, py >> 1, 2137) < 0.6 ? 0 : 1];
        }
      }
      out[orow + ox] = color;
    }
  }
}

/** 外海零星的浪纹（两种小图样，按世界坐标的网格摆；不压在岸边、浅滩与海冰上）。 */
function paintWaves(t: Tile) {
  const { out, cls, TW, TH, X0, Y0, WW } = t;
  const dOut = t.shore;
  const M = MARGIN;
  const GX = 26;
  const GY = 15;
  const A = [1, 0, 2, 0, 0, 1, 3, 1, 4, 1];
  const B = [0, 0, 1, 0, 2, 1, 3, 1, 4, 0, 5, 0];
  for (let gy = Math.floor(Y0 / GY) - 1; gy * GY < Y0 + TH; gy++) {
    for (let gx = Math.floor(X0 / GX) - 1; gx * GX < X0 + TW; gx++) {
      if (hash2(gx, gy, 2141) < 0.62) continue;
      const bx = gx * GX + ((gy & 1) * GX) / 2 + Math.floor(hash2(gx, gy, 2143) * 14) - 7;
      const by = gy * GY + Math.floor(hash2(gx, gy, 2147) * 8);
      const pts = hash2(gx, gy, 2149) < 0.5 ? A : B;
      // 图样的 5–6 个像素都要落在同一色阶的开阔海面上
      let ok = true;
      let toneAt = -1;
      for (let k = 0; k < pts.length && ok; k += 2) {
        const ox = bx + pts[k] - X0;
        const oy = by + pts[k + 1] - Y0;
        if (ox < 0 || oy < 0 || ox >= TW || oy >= TH) {
          ok = false;
          break;
        }
        const wi = (oy + M) * WW + ox + M;
        if (cls[wi] !== 0 || (dOut && dOut[wi] < 27)) ok = false;
        const tn = SEA.indexOf(out[oy * TW + ox]);
        if (tn < 0 || tn > 3 || (toneAt >= 0 && tn !== toneAt)) ok = false;
        toneAt = tn;
      }
      if (!ok || toneAt < 0) continue;
      const wave = SEA[toneAt + 1];
      for (let k = 0; k < pts.length; k += 2) out[(by + pts[k + 1] - Y0) * TW + bx + pts[k] - X0] = wave;
    }
  }
}

/** 陆地：地貌的底色与质感、晕渲、积雪与海岸。 */
function paintLand(t: Tile) {
  const { ctx, out, cls, TW, TH, X0, Y0, WW, WH } = t;
  const dIn = t.shore;
  const towns = t.towns;
  const { W, H, vegN, input } = ctx;
  const S = DETAIL_CELL;
  const M = MARGIN;
  const wrap = input.wrapX === true;
  const N = noise();
  const nWarpA = N.warpA;
  const nWarpB = N.warpB;
  const nWarpC = N.warpC;
  const nWarpD = N.warpD;
  const nTone = N.tone;
  const nFine = N.fine;
  const nRidge = N.ridge;
  const nRidge2 = N.ridge2;
  const nSea = N.sea;
  const nShoal = N.shoal;
  const nDune = N.dune;
  const nPatch = N.patch;
  const wx0 = X0 - M;
  const wy0 = Y0 - M;
  const landH = elevationWindow(ctx.fine, wx0, wy0, WW, WH, 1, f32("land", WW * WH));
  const sNorth = t.season;
  const sSouth = (sNorth + 2) % 4;
  const pal = seasonPalette(sNorth);
  const palS = seasonPalette(sSouth);
  // 地势：细高程 + 山地的细脊（幅度随高程，平原上只有一点）。取高程的位置按平滑噪声挪几个像素：
  // 粗数据里笔直的台阶边（成块的高程样本）由此变成弯弯曲曲的坡脚，不沿着格线走
  const NW = WW * WH;
  const hgt = f32("hgt", NW);
  const base = f32("base", NW);
  for (let wy = 0; wy < WH; wy++) {
    const py = wy0 + wy;
    const r512 = (py & 511) << 9;
    const r256 = (py & 255) << 8;
    const row = wy * WW;
    for (let wx = 0; wx < WW; wx++) {
      const i = row + wx;
      if (cls[i] !== FINE_LAND) {
        hgt[i] = -40;
        base[i] = 0;
        continue;
      }
      const px = wx0 + wx;
      let j = i + Math.round((nWarpC[r256 | (px & 255)] - 0.5) * 18) + Math.round((nWarpD[r256 | (px & 255)] - 0.5) * 18) * WW;
      j = j < 0 ? 0 : j >= NW ? NW - 1 : j;
      const h = landH[j];
      base[i] = h;
      // 细脊的幅度看这里地势的陡缓（两侧各 6 像素的高差），不看海拔：高原是平的，山脉才起皱
      const e = j + 6 < NW ? j + 6 : NW - 1;
      const w6 = j >= 6 ? j - 6 : 0;
      const s6 = j + 6 * WW < NW ? j + 6 * WW : j;
      const n6 = j >= 6 * WW ? j - 6 * WW : j;
      const gx6 = landH[e] - landH[w6];
      const gy6 = landH[s6] - landH[n6];
      const steep = (gx6 < 0 ? -gx6 : gx6) + (gy6 < 0 ? -gy6 : gy6);
      const rough = 6 + (steep * 0.3 > 300 ? 300 : steep * 0.3) + (h > 2500 ? 30 : h * 0.012);
      const ra = nRidge[r512 | (px & 511)] - 0.5;
      const ridge = 1 - (ra < 0 ? -ra : ra) * 2;
      const rb = nRidge2[r256 | (px & 255)] - 0.5;
      const ridge2 = 1 - (rb < 0 ? -rb : rb) * 2;
      hgt[i] = h + (ridge * ridge - 0.42) * rough * 1.5 + (ridge2 - 0.5) * rough * 0.45;
    }
  }
  for (let oy = 0; oy < TH; oy++) {
    const py = Y0 + oy;
    const wrow = (oy + M) * WW + M;
    const orow = oy * TW;
    const lat = latOfRow(input, py);
    const south = lat < 0;
    const sp = south ? palS : pal;
    const sHere = south ? sSouth : sNorth;
    const cLat = classicLatOf(lat);
    const snowLine = snowLevel(sHere, cLat);
    // 林线（高程等级）：过了它露出岩石。北地约一千米出头，温带两千多米，热带四千米
    const treeLine = 4.2 + (cLat <= 30 ? 0 : cLat >= 130 ? 4 : ((cLat - 30) / 100) * 4);
    const bayRow = (py & 3) * 4;
    const r512 = (py & 511) << 9;
    const r256 = (py & 255) << 8;
    const ownRow = Math.floor(py / S) * W;
    for (let ox = 0; ox < TW; ox++) {
      const wi = wrow + ox;
      if (cls[wi] !== FINE_LAND) continue;
      const px = X0 + ox;
      const i512 = r512 | (px & 511);
      const i256 = r256 | (px & 255);
      // 地貌：粗格级的图层不能照格子画成 24 像素的方块。先按大尺度的平滑噪声把位置挪一挪（交界成大弯），
      // 再在相邻四个格心之间按另一层平滑噪声挑一个——离哪个格心近就多半取哪个，交界处两边的地貌犬牙交错，
      // 孤零零一格的异类地貌是一团不规则的斑块，不是一个方块
      const qx = (px + (nWarpA[i512] - 0.5) * 30) / S - 0.5;
      const qy = (py + (nWarpB[i512] - 0.5) * 30) / S - 0.5;
      let gx = Math.floor(qx);
      let gy = Math.floor(qy);
      const ux = qx - gx;
      const uy = qy - gy;
      // 平滑噪声集中在 0.5 附近，拉开到 0–1 再比
      if (ux * ux * (3 - 2 * ux) > (nWarpC[i256] - 0.5) * 2.6 + 0.5) gx++;
      if (uy * uy * (3 - 2 * uy) > (nWarpD[i256] - 0.5) * 2.6 + 0.5) gy++;
      gy = gy < 0 ? 0 : gy >= H ? H - 1 : gy;
      gx = wrap ? ((gx % W) + W) % W : gx < 0 ? 0 : gx >= W ? W - 1 : gx;
      let v = vegN[gy * W + gx];
      if (v === SEA_VEG) {
        v = vegN[ownRow + (wrap ? Math.floor(px / S) % W : Math.min(W - 1, Math.floor(px / S)))];
        if (v === SEA_VEG) v = GRASS;
      }
      // 西北光的晕渲：沿西北—东南方向的高差，开方压缩（丘陵读得出来，高山不至于一片死黑）
      const g = hgt[wi - WW - 1] + hgt[wi - 1] * 0.5 + hgt[wi - WW] * 0.5 - hgt[wi + WW + 1] - hgt[wi + 1] * 0.5 - hgt[wi + WW] * 0.5;
      const ga = g < 0 ? -g : g;
      let shade = Math.sqrt(ga / 44);
      if (shade > 1.5) shade = 1.5;
      if (g > 0) shade = -shade;
      const bay = BAYER[bayRow + (px & 3)];
      const hm = base[wi];
      const lvl = LEVEL_LUT[hm <= 0 ? 0 : hm >= 9000 ? 9000 : hm | 0];
      const tn = nTone[i512] - 0.5;
      // 积雪：高程等级过了雪线（随季节、纬度与地貌），边缘按噪声参差
      let snowy = v === ICE;
      if (!snowy) {
        const line = snowLine + sp.bias[v];
        if (lvl > line - 0.9) snowy = lvl + (nFine[i256] - 0.5) * 1.1 + tn * 0.8 > line;
      }
      // 高山：过了林线的地方露出岩石（地貌图层是粗格级的，这里按像素的高程补上）
      if (!snowy && lvl > treeLine + tn * 0.8 && v !== ALPINE && v !== VOLCANIC && v !== ARCANE) v = ALPINE;
      const rp = snowy ? sp.snow : sp.ramps[v];
      // 分层设色：低地略暗、高处略亮（同一地貌里也看得出台地与盆地）
      const L = 2 + shade + tn * 0.55 + (nPatch[i512] - 0.5) * 0.45 + (lvl < 1 ? -0.15 : lvl > 3 ? Math.min(0.3, (lvl - 3) * 0.08) : 0);
      // 色阶之间只在交界的一小段里抖动（成片的色块边上一圈点画，不是满地的棋盘格）
      let Li = Math.floor(L + 0.5 + (bay - 0.5) * 0.55);
      Li = Li < 0 ? 0 : Li > 4 ? 4 : Li;
      let color = rp[Li];
      const dark = rp[Li > 0 ? Li - 1 : 0];
      const lite = rp[Li < 4 ? Li + 1 : 4];
      // 质感：各地貌成片的点画（陡坡上少画，让晕渲读得出来）
      const flat = ga < 150;
      if (!snowy) {
        switch (v) {
          case FOREST:
          case JUNGLE: {
            // 树冠：4 像素一棵，错行排；左上一点高光、右下一块暗
            const row = py >> 2;
            const qx4 = px + (row & 1) * 2;
            const hsh = hash2(qx4 >> 2, row, 2201);
            if (hsh < (v === JUNGLE ? 0.92 : 0.8)) {
              const ax = (qx4 & 3) - (((hsh * 97) | 0) & 1);
              const ay = (py & 3) - (((hsh * 53) | 0) & 1);
              if (ax === 0 && ay === 0) color = lite;
              else if ((ax === 1 && ay === 1) || (ax === 0 && ay === 1 && hsh > 0.3) || (ax === 1 && ay === 0 && hsh > 0.6)) color = dark;
            }
            break;
          }
          case BOREAL: {
            // 针叶林：竖着的小深色条，密
            const col = px >> 1;
            const sy = py + (col & 1) * 2;
            const hsh = hash2(col, sy >> 2, 2203);
            if (hsh < 0.5) {
              if ((px & 1) === 0 && (sy & 3) <= 1) color = dark;
              else if ((px & 1) === 1 && (sy & 3) === 0 && hsh < 0.2) color = lite;
            }
            break;
          }
          case GRASS:
            if (flat) {
              // 草：稀疏的浅色短划
              const hsh = hash2(px >> 1, py, 2205);
              if (hsh < 0.045) color = lite;
              else if (hsh > 0.985) color = dark;
            }
            break;
          case MEDIT: {
            // 灌丛：零散的深色小点，间或一棵亮的
            const hsh = hash2(px, py, 2207);
            if (hsh < 0.1 && ((px + py) & 1) === 0) color = dark;
            else if (hsh > 0.985) color = lite;
            break;
          }
          case STEPPE:
            if (flat) {
              const hsh = hash2(px >> 1, py, 2209);
              if (hsh < 0.03) color = dark;
              else if (hsh > 0.975) color = lite;
            }
            break;
          case SAVANNA: {
            // 稀树草原：草的短划之间零星的深色树点
            if (hash2(px >> 1, py, 2211) < 0.035) color = lite;
            if (hash2(px >> 1, py >> 1, 2213) < 0.035) color = rp[Li > 1 && ((px ^ py) & 1) === 0 ? Li - 2 : Li > 0 ? Li - 1 : 0];
            break;
          }
          case DESERT: {
            // 沙丘：成片的弧形沙纹（低频噪声决定哪里是沙丘地），其余是零星的砾石
            const dune = nDune[i512];
            if (dune > 0.5 && flat) {
              const ph = (py + nWarpC[i256] * 16 + px * 0.25) % 7;
              if (ph < 1) color = lite;
              else if (ph < 2 && dune > 0.56) color = dark;
            } else if (hash2(px, py, 2215) < 0.018) color = dark;
            break;
          }
          case TUNDRA: {
            const hsh = hash2(px, py >> 1, 2217);
            if (hsh < 0.05) color = lite;
            else if (hsh > 0.96) color = dark;
            break;
          }
          case WETLAND: {
            // 沼泽：横着的深色短划与零星的水洼
            const hsh = hash2(px >> 2, py, 2219);
            if (hsh < 0.16) color = dark;
            else if (hsh > 0.95 && flat) color = LAKE[1];
            break;
          }
          case ALPINE: {
            // 裸岩：碎石的亮点与裂隙的暗点
            const hsh = hash2(px, py, 2221);
            if (hsh < 0.06) color = dark;
            else if (hsh > 0.95) color = lite;
            break;
          }
          case VOLCANIC:
            if (hash2(px, py >> 1, 2223) < 0.02) color = LAVA[hash2(px, py, 2225) < 0.5 ? 0 : 1];
            break;
          case ARCANE:
            if (hash2(px, py, 2227) < 0.014) color = SPARK[Math.floor(hash2(px, py, 2229) * 3)];
            break;
        }
      } else if (v === BOREAL) {
        // 雪里的针叶林：一棵棵深色的树尖从雪里露出来，林子冬天也认得出
        const col = px >> 1;
        const sy = py + (col & 1) * 2;
        const hsh = hash2(col, sy >> 2, 2203);
        if (hsh < 0.3 && (px & 1) === 0 && (sy & 3) <= 1) color = hsh < 0.12 ? WINTER_TREE[0] : WINTER_TREE[1];
      } else if (v === FOREST) {
        // 雪里的落叶林：稀疏的枯枝
        if (hash2(px >> 1, py >> 1, 2235) < 0.09 && ((px ^ py) & 1) === 0) color = WINTER_TREE[2];
      } else if (flat && hash2(px, py >> 1, 2231) < 0.02) color = dark;
      // 田畴：城镇周围平缓、能开垦的地上是斜着排的小块田（边上按噪声参差），田埂深一阶；积雪时只剩田埂
      if (towns.length > 0 && ga < 110 && v !== ICE && v !== ALPINE && v !== VOLCANIC && v !== ARCANE && v !== TUNDRA && arable(v)) {
        let near = 9;
        for (let k = 0; k < towns.length; k++) {
          const tw = towns[k];
          const ddx = px - tw.px;
          const ddy = py - tw.py;
          const q = (ddx * ddx + ddy * ddy) / (tw.r * tw.r);
          if (q < near) near = q;
        }
        // 沙漠里只有贴着城的一小圈绿洲
        if (near < (v === DESERT ? 0.3 : 1) && near < 0.55 + (nPatch[i512] - 0.5) * 1.6 + tn * 0.7) {
          const fu = px * 0.92 + py * 0.38;
          const fv = py * 0.92 - px * 0.38;
          const iu = Math.floor(fu / 7);
          const iv = Math.floor(fv / 5);
          const hsh = hash2(iu, iv, 2301);
          if (fu - iu * 7 < 1 || fv - iv * 5 < 1) color = snowy ? HEDGE_SNOW : dark;
          else if (!snowy && hsh < 0.8) {
            const f = v === DESERT ? FIELDS_OASIS : v === JUNGLE || v === SAVANNA ? FIELDS_TROPIC : FIELDS[sHere];
            color = f[hsh < 0.36 ? 0 : hsh < 0.62 ? 1 : 2];
            // 垄：隔行深一点
            if (hsh < 0.62 && ((py + iu) & 1) === 0 && (px & 1) === 0) color = f[1];
          }
        }
      }
      // 岸：贴水一像素的深色岸线；后面是沙滩或岩岸（按地貌与地势），冰原是冰崖
      if (dIn) {
        const di = dIn[wi] * (1 / 3);
        if (di <= 1.05) color = v === ICE || snowy ? SHORE_ICE : lvl > 2.2 || v === ALPINE || v === VOLCANIC ? SHORE_ROCK : SHORE;
        else if (di <= 3.4 && !snowy && v !== ICE) {
          const hard = lvl + (v === ALPINE ? 3 : v === BOREAL || v === TUNDRA ? 0.8 : v === DESERT || v === SAVANNA || v === JUNGLE ? -0.6 : 0) + (nShoal[i256] - 0.5) * 2.2;
          if (hard < 1.15 && v !== WETLAND && v !== JUNGLE) {
            // 沙滩：断断续续，宽处两像素、窄处一像素（沙漠的海岸整条都是）
            const n = v === DESERT ? 1 : nSea[((((py * 3) | 0) & 511) << 9) | ((px * 3) & 511)];
            if (di <= 2.05 ? n > 0.46 : di <= 3.1 && n > 0.6) color = di <= 2.05 ? BEACH[0] : BEACH[1];
          } else if (hard >= 2.1 && di <= 2.4) color = ROCK[(Li > 2 ? 2 : 1) - (hash2(px, py, 2233) < 0.3 ? 1 : 0)];
        }
      }
      out[orow + ox] = color;
    }
  }
}

/** 这块瓦片里的河：真实河道（细河流），只画在陆上（到了水边自然接上），冬天高纬的河面结冰。 */
function paintRivers(t: Tile, tx: number, ty: number) {
  const { ctx, out, cls, TW, TH, X0, Y0, WW } = t;
  const list = riverIndex(ctx).get(`${tx}:${ty}`);
  if (!list) return;
  const M = MARGIN;
  const FW = ctx.W * DETAIL_CELL;
  const put = (x: number, y: number, c: number) => {
    const ox = x - X0;
    const oy = y - Y0;
    if (ox < 0 || oy < 0 || ox >= TW || oy >= TH) return;
    if (cls[(oy + M) * WW + ox + M] !== FINE_LAND) return;
    out[oy * TW + ox] = c;
  };
  // 细的先画、粗的后画（支流汇入处干流压在上面）
  const order = [...list].sort((a, b) => ctx.fine.rivers[b].rank - ctx.fine.rivers[a].rank);
  for (const k of order) {
    const r = ctx.fine.rivers[k];
    const wd = riverWidth(r.rank);
    // 河段可能在接缝的另一侧：平移到离这块瓦片最近的那一份
    const shift = Math.round((X0 + TW / 2 - r.pts[0]) / FW) * FW;
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      let x = r.pts[i] + shift;
      let y = r.pts[i + 1];
      const x1 = r.pts[i + 2] + shift;
      const y1 = r.pts[i + 3];
      if (Math.max(x, x1) < X0 - 3 || Math.min(x, x1) > X0 + TW + 3 || Math.max(y, y1) < Y0 - 3 || Math.min(y, y1) > Y0 + TH + 3) continue;
      const dx = Math.abs(x1 - x);
      const dy = Math.abs(y1 - y);
      const sx = x < x1 ? 1 : -1;
      const sy = y < y1 ? 1 : -1;
      // 这一小段的纬度变化不大：结不结冰按起点算
      const lat = latOfRow(ctx.input, y);
      const frozen = (lat < 0 ? (t.season + 2) % 4 : t.season) === 3 && Math.abs(lat) > 52;
      const c = frozen ? RIVER_ICE : RIVER[wd >= 2 ? 0 : 1];
      const edge = frozen ? RIVER_ICE : RIVER[1];
      let err = dx - dy;
      for (let guard = 0; guard < 100000; guard++) {
        put(x, y, c);
        if (wd >= 2) {
          // 加宽：横着走的河往下加，竖着走的往右加
          if (dx >= dy) put(x, y + 1, edge);
          else put(x + 1, y, edge);
        }
        if (wd >= 3) {
          if (dx >= dy) put(x, y - 1, c);
          else put(x - 1, y, c);
        }
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) {
          err -= dy;
          x += sx;
        }
        if (e2 < dx) {
          err += dx;
          y += sy;
        }
      }
    }
  }
}

/** 把一张像素图（0xRRGGBBAA）盖到瓦片上：左上角在世界像素 (x, y)，半透明的像素与底色混合；landOnly 时只落在陆上。 */
function stamp(t: Tile, src: Px, x: number, y: number, landOnly: boolean) {
  const { out, cls, TW, TH, X0, Y0, WW } = t;
  for (let sy = 0; sy < src.h; sy++) {
    const oy = y + sy - Y0;
    if (oy < 0 || oy >= TH) continue;
    for (let sx = 0; sx < src.w; sx++) {
      const ox = x + sx - X0;
      if (ox < 0 || ox >= TW) continue;
      const v = src.data[sy * src.w + sx];
      const a = v & 0xff;
      if (a === 0) continue;
      if (landOnly && cls[(oy + MARGIN) * WW + ox + MARGIN] !== FINE_LAND) continue;
      const i = oy * TW + ox;
      if (a === 0xff) {
        out[i] = le(v);
        continue;
      }
      const d = out[i];
      const k = a / 255;
      const r = Math.round(((v >>> 24) & 0xff) * k + (d & 0xff) * (1 - k));
      const g = Math.round(((v >>> 16) & 0xff) * k + ((d >>> 8) & 0xff) * (1 - k));
      const b = Math.round(((v >>> 8) & 0xff) * k + ((d >>> 16) & 0xff) * (1 - k));
      out[i] = ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
    }
  }
}

/** 城镇的民居：几栋小房子（整张海图上的同一种小房子，原尺寸）散在城镇中心周围的陆上，城市多几栋；积雪的地方屋顶是白的。 */
function paintTowns(t: Tile) {
  if (t.towns.length === 0) return;
  const { ctx } = t;
  const fine = ctx.fine;
  for (const tw of t.towns) {
    const lat = latOfRow(ctx.input, tw.py);
    const season = lat < 0 ? (t.season + 2) % 4 : t.season;
    const snowy = snowLevel(season, classicLatOf(lat)) < 0.6;
    const box = houseBox(tw.style);
    const n = tw.city ? 9 : 6;
    const reach = tw.city ? 15 : 12;
    // 先在小画布上把这座城的房子画好（按底边从远到近排，近的压住远的），再整张盖上去
    const size = reach * 2 + box.w + 4;
    const sheet = new Px(size, size + box.h);
    const spots: [number, number][] = [];
    for (let k = 0; k < n * 3 && spots.length < n; k++) {
      const hx = Math.floor((hash2(tw.seed, k, 2311) - 0.5) * 2 * reach);
      const hy = Math.floor((hash2(tw.seed, k, 2313) - 0.5) * 2 * reach * 0.8);
      const wx = tw.px + hx;
      const wy = tw.py + hy;
      // 屋基连同四周要在陆上。直接查细海岸层、不看这块瓦片的窗口：一座城跨着两块瓦片时，两边选出的房子完全相同
      const land = (dx: number, dy: number) => fineClassAt(fine, wx + dx, wy + dy) === FINE_LAND;
      if (!land(0, 0) || !land(-3, 0) || !land(3, 0) || !land(0, 2) || !land(0, -box.h) || !land(-3, 2) || !land(3, 2)) continue;
      // 彼此不叠
      if (spots.some(([sx, sy]) => Math.abs(sx - hx) < box.w && Math.abs(sy - hy) < box.h)) continue;
      spots.push([hx, hy]);
    }
    spots.sort((a, b) => a[1] - b[1]);
    for (const [hx, hy] of spots) drawHouse(sheet, hx + size / 2, hy + size / 2 + box.h, tw.style, snowy);
    stamp(t, sheet, Math.round(tw.px - size / 2), Math.round(tw.py - size / 2 - box.h), true);
  }
}

/** 地标与奇观：用它们的图标（原尺寸，约半格），居中压在所在的格上。 */
function paintLandmarks(t: Tile) {
  const marks = t.ctx.input.landmarks;
  if (!marks || marks.length === 0) return;
  const { ctx, TW, TH, X0, Y0 } = t;
  const S = DETAIL_CELL;
  const FW = ctx.W * S;
  const wrap = ctx.input.wrapX === true;
  for (const m of marks) {
    const icon = drawLandmarkIcon(m.kind, m.category);
    let cx = Math.round((m.x + Math.max(1, m.w ?? 1) / 2) * S);
    let cy = Math.round((m.y + Math.max(1, m.h ?? 1) / 2) * S);
    // 格心落在水里、旁边不远就是岸的（海峡边的名城）：挪到最近的陆上，不让房子漂在海面上；四周都是海的（漩涡、风浪）照旧
    if (fineClassAt(ctx.fine, cx, cy) !== FINE_LAND) {
      let best = Infinity;
      let bx = cx;
      let by = cy;
      for (let dy = -16; dy <= 16; dy += 2) {
        for (let dx = -16; dx <= 16; dx += 2) {
          const d = dx * dx + dy * dy;
          if (d < best && d <= 256 && fineClassAt(ctx.fine, cx + dx, cy + dy) === FINE_LAND && fineClassAt(ctx.fine, cx + dx, cy + dy - 4) === FINE_LAND) {
            best = d;
            bx = cx + dx;
            by = cy + dy;
          }
        }
      }
      cx = bx;
      cy = by;
    }
    if (wrap) cx += Math.round((X0 + TW / 2 - cx) / FW) * FW;
    const x = Math.round(cx - icon.w / 2);
    const y = Math.round(cy - icon.h / 2);
    if (x + icon.w < X0 || x > X0 + TW || y + icon.h < Y0 || y > Y0 + TH) continue;
    stamp(t, icon, x, y, false);
  }
}
