// 高清海图瓦片（第十轮 H10c）。
// 航行画面专用：8 × 8 粗格一块、每细格 k 个像素（k = 4 时每粗格 96 像素、一块 768²；k = 1 是生成中先垫着的低清版）。
// 世界海图（Pixi）照旧用 detail.ts 的细节瓦片，这里不动它。
//
// 画法（每一层怎么来的，见 docs/drafts/h10c-handoff.md 第 2 节）：
//   海陆：细海岸层（与内核的细碰撞是同一份数据）→ 细格上的有符号距离 → 二次 B 样条放大 → 零线就是岸线，
//         边上按距离做一像素的抗锯齿；每个细格中心附近的几个像素强制取这个细格的真实类别（孤立的一格小岛不会被抹掉）。
//         岸线与碰撞的出入不超过 0.92 个细格（hdField.ts 文件头的算式）。
//   浅滩：粗格不可航行、细格是水的地方（真实的海湾、河口——船进不去）同样按有符号距离平滑，染成泛绿的浅滩、打细点，
//         边上一道虚线（旧海图标浅滩的画法），“进不去”有个看得见的理由。
//   海：按细高程的水深连续设色；近岸一圈浅水的亮色、贴岸一道断续的白浪，外面三道随岸线走的细线（手绘海图的“岸线晕”）；
//       大尺度的明暗与横向的细纹让海面不是一块平涂。
//   陆：地貌（粗格级，按噪声打散交界）在细格上取色，双线性放大成柔和的过渡；细高程加山脊细纹做西北光的晕渲，
//       暗面偏冷、亮面偏暖；林地是一团团有明暗的树冠，湿地是短横的沼泽符号，沙漠有沙纹，雪线随高程、纬度与季节。
//       岸上贴水一道深褐色的墨线，后面按地势是沙滩或岩岸。河流是真实河道平滑后的抗锯齿细线。
//   人文：城镇周围的田畴（随季节换色）与小房子、地标图标，都按世界坐标确定性地摆，相邻瓦片接得上。
// 全部确定性：噪声与图样都按世界坐标取，相邻瓦片在边上严丝合缝（东西接缝处的纹理噪声不连续，在太平洋中间）。
import { P } from "../palette";
import { Px, rgba } from "../px";
import { arable, drawHouse, houseBox, chaikin } from "./culture";
import { detailContext, type DetailContext } from "./detail";
import { FINE_LAKE, FINE_LAND, fineClassAt, fineWindow } from "./fine";
import { SEA_VEG, VEG } from "./geo";
import { boxBlur, elevationHd, noiseAt, scratchF32, scratchU8, signedField, smoothstep, upsampleField } from "./hdField";
import { drawLandmarkIcon } from "./landmarks";
import { hash2, tileTable } from "./noise";
import { classicLatOf, latitudeAt } from "./projection";
import { groundRamps, snowBias, snowLevel, SNOW_RAMP } from "./terrain";
import { DETAIL_CELL, type ChartInput } from "./types";

const { ICE, TUNDRA, BOREAL, FOREST, GRASS, MEDIT, STEPPE, DESERT, SAVANNA, JUNGLE, WETLAND, ALPINE, VOLCANIC, ARCANE } = VEG;

/** 高清瓦片的边长（粗格）。 */
export const HD_TILE = 8;
/** 正式的精度：每细格 4 像素（每粗格 96 像素，航行画面缩到最远时一像素对一像素）。 */
export const HD_K = 4;
/** 生成中先垫着的低清版：每细格 1 像素（一块 192²，约是正式版的 1/16 的活）。 */
export const HD_PREVIEW_K = 1;
/** 更细的一档：每细格 8 像素（每粗格 192 像素、一块 1536²），放大到每格 HD_FINE_AT 个设备像素以上才要。 */
export const HD_FINE_K = 8;
export const HD_FINE_AT = 168;

/** 高清瓦片：左上角的世界像素坐标（每细格 k 像素）与 RGBA 字节。 */
export interface HdImage {
  x: number;
  y: number;
  w: number;
  h: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

/** 画高清瓦片的画具：与细节瓦片同一份（地貌外扩、城镇、可航行的粗格），另加按 8 格瓦片分的河段索引与平滑过的河道。 */
export interface HdContext {
  base: DetailContext;
  rivers: Map<string, number[]> | null;
  smooth: (Float32Array | null)[];
}

/** 有细图层、尺寸对得上时才能画（与细节瓦片同一个条件）。 */
export function hdContext(input: ChartInput): HdContext | null {
  const base = detailContext(input);
  return base ? { base, rivers: null, smooth: [] } : null;
}

// ───────────────────────────── 配色 ─────────────────────────────
// 手绘海图的调子：整体比像素海图（detail.ts）去一点饱和、往纸色靠一点，暗面偏冷、亮面偏暖。

type Rgb = [number, number, number];
const PAPER: Rgb = [232, 218, 186];
function rgbOf(c: string | number): Rgb {
  const v = typeof c === "number" ? c : rgba(c);
  return [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff];
}
/** 去一点饱和、往纸色靠一点。 */
function painterly(c: Rgb, desat = 0.16, paper = 0.08): Rgb {
  const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
  return [0, 1, 2].map((k) => {
    const v = l + (c[k] - l) * (1 - desat);
    return v + (PAPER[k] - v) * paper;
  }) as Rgb;
}
function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** 水深（米）→ 海色：连续的色带（浅水的青绿 → 陆架 → 陆坡 → 深海）。 */
const DEPTH_STOPS: [number, Rgb][] = [
  [0, [122, 190, 190]],
  [25, [96, 168, 186]],
  [120, [70, 140, 176]],
  [300, [57, 118, 160]],
  [1500, [45, 97, 143]],
  [3500, [37, 81, 127]],
  [6500, [30, 65, 108]],
];
/** 按整米查的海色表（0–6500 米，每 4 米一项）。 */
const DEPTH_LUT: Float32Array = (() => {
  const n = 1626;
  const t = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const d = i * 4;
    let k = 0;
    while (k < DEPTH_STOPS.length - 2 && d > DEPTH_STOPS[k + 1][0]) k++;
    const [d0, c0] = DEPTH_STOPS[k];
    const [d1, c1] = DEPTH_STOPS[k + 1];
    const f = Math.max(0, Math.min(1, (d - d0) / (d1 - d0)));
    // 深浅之间按平滑阶跃过渡（色带之间没有硬边）
    const s = f * f * (3 - 2 * f);
    for (let c = 0; c < 3; c++) t[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * s;
  }
  return t;
})();
const SHALLOW: Rgb = [150, 206, 196];
const WATERLINE: Rgb = [28, 66, 100];
const FOAM: Rgb = [232, 244, 240];
const LAKE: Rgb = [100, 164, 166];
const LAKE_DEEP: Rgb = [78, 138, 150];
const SHOAL: Rgb = [146, 186, 164];
const SHOAL_DOT: Rgb = [206, 196, 152];
const ICE_FLOE: Rgb = [226, 236, 244];
const ICE_EDGE: Rgb = [170, 192, 214];
/** 岸上的墨线（深褐）、冰崖的线（冷灰） */
const INK: Rgb = [58, 40, 28];
const INK_ICE: Rgb = [116, 136, 160];
const BEACH: Rgb = painterly(rgbOf(P.sand[4]), 0.2, 0.2);
const ROCK: Rgb = painterly(rgbOf(P.stone[2]), 0.2, 0.06);
const RIVER: Rgb = [84, 150, 172];
const RIVER_ICE: Rgb = [214, 226, 238];
const SHADOW_TINT: Rgb = [-6, -2, 10];
const LIGHT_TINT: Rgb = [8, 5, -4];
const LAVA: Rgb = rgbOf(P.lamp[1]);
const SPARK: Rgb = rgbOf(P.teal[4]);
/** 田畴：各季的两种庄稼色与翻过的土色（与细节瓦片同一套，手绘的调子） */
const FIELDS: Rgb[][] = [
  [rgbOf(P.leaf[4]), rgbOf(P.leaf[3]), mixRgb(rgbOf(P.wood[3]), rgbOf(P.straw[2]), 0.4)],
  [mixRgb(rgbOf(P.straw[2]), rgbOf(P.leaf[4]), 0.25), rgbOf(P.leaf[3]), mixRgb(rgbOf(P.straw[2]), rgbOf(P.wood[3]), 0.35)],
  [rgbOf(P.straw[3]), mixRgb(rgbOf(P.straw[2]), rgbOf(P.wood[3]), 0.3), mixRgb(rgbOf(P.wood[3]), rgbOf(P.straw[1]), 0.5)],
  [mixRgb(rgbOf(P.straw[1]), rgbOf(P.straw[2]), 0.5), mixRgb(rgbOf(P.wood[3]), rgbOf(P.straw[1]), 0.5), rgbOf(P.wood[2])],
].map((s) => s.map((c) => painterly(c, 0.2, 0.1)));
const FIELDS_TROPIC: Rgb[] = [rgbOf(P.jade[3]), rgbOf(P.leaf[3]), rgbOf(P.wood[2])].map((c) => painterly(c, 0.2, 0.1));
const FIELDS_OASIS: Rgb[] = [rgbOf(P.leaf[3]), rgbOf(P.leaf[2]), rgbOf(P.sand[2])].map((c) => painterly(c, 0.2, 0.1));
const HEDGE: Rgb = [92, 84, 56];
const HEDGE_SNOW: Rgb = [236, 240, 246];

interface SeasonRamps {
  /** [地貌][阶 0–4][r, g, b] 摊平 */
  ramps: Float32Array;
  snow: Float32Array;
  bias: Float64Array;
}
const seasonCache = new Map<number, SeasonRamps>();
function seasonRamps(season: number): SeasonRamps {
  let s = seasonCache.get(season);
  if (!s) {
    const g = groundRamps(season);
    // 稀树草原的雨季在夏天：夏天也用春天那套泛绿的色阶（与细节瓦片相同）
    if (season === 1) g[SAVANNA] = groundRamps(0)[SAVANNA];
    const ramps = new Float32Array(g.length * 15);
    g.forEach((r, v) =>
      r.forEach((c, l) => {
        // 草原一类的色阶本来就亮（黄绿），与林地放在一起扎眼：多去一点饱和、多往纸色靠一点
        const grassy = v === GRASS || v === STEPPE || v === SAVANNA || v === MEDIT;
        const p = grassy ? painterly(rgbOf(c), 0.3, 0.12) : painterly(rgbOf(c));
        ramps.set(p, v * 15 + l * 3);
      }),
    );
    const snow = new Float32Array(15);
    SNOW_RAMP.forEach((c, l) => snow.set(painterly(rgbOf(c), 0.1, 0.04), l * 3));
    const bias = new Float64Array(g.length);
    for (let v = 0; v < g.length; v++) bias[v] = snowBias(v, season);
    s = { ramps, snow, bias };
    seasonCache.set(season, s);
  }
  return s;
}

/** 高程（米）→ 整张海图用的高程等级（0–9，带小数）：与细节瓦片同一种换算。 */
const LEVEL_M = [0, 100, 250, 500, 1000, 1500, 2000, 3000, 4000, 5000];
function levelOfMeters(m: number): number {
  if (m <= 0) return 0;
  for (let i = 1; i < LEVEL_M.length; i++) if (m < LEVEL_M[i]) return i - 1 + (m - LEVEL_M[i - 1]) / (LEVEL_M[i] - LEVEL_M[i - 1]);
  return 9 + Math.min(1, (m - 5000) / 2000);
}

/** 噪声表（细格坐标；与细节瓦片同一组种子，换画法后各处的明暗分布还是那个样子）。 */
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

/** 有符号距离夹到的范围（细格）：岸线晕最远约 4 格、浅水色约 5 格，再远的不必精确。 */
const CLAMP = 10;
/** 细格窗口四周多取的细格：距离要准到 CLAMP，加上 B 样条两侧各一格、地貌取样挪位 9 格。 */
const MF = 12;

/** 像素行的纬度（度；没有投影的地图按 45°）。fy 为细格坐标。 */
function latOfFine(input: ChartInput, fy: number): number {
  const p = input.projection;
  return p ? latitudeAt(p, fy / DETAIL_CELL) : 45;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}
function pack(r: number, g: number, b: number): number {
  return ((0xff << 24) | (clamp255(b) << 16) | (clamp255(g) << 8) | clamp255(r)) >>> 0;
}

/** 一块高清瓦片要用的量。 */
interface Tile {
  hd: HdContext;
  ctx: DetailContext;
  k: number;
  season: number;
  /** 瓦片的世界像素坐标与宽高 */
  X0: number;
  Y0: number;
  TW: number;
  TH: number;
  /** 瓦片左上角的细格坐标、细格宽高 */
  F0x: number;
  F0y: number;
  TFw: number;
  TFh: number;
  /** 细格窗口（瓦片 + 四周 MF）的类别与宽高 */
  cls: Uint8Array;
  FWW: number;
  FWH: number;
  out: Uint32Array;
  /** 陆的覆盖率（0–1，每像素；画河、盖房子时只落在陆上） */
  landA: Float32Array;
}

/**
 * 画一块高清瓦片：瓦片 (tx, ty) 盖粗格 [tx·8, tx·8 + 8) × [ty·8, ty·8 + 8)，地图边上的最后一块按实际的格数；
 * k 为每细格的像素（4 正式、1 低清垫底）。season：0 春 1 夏 2 秋 3 冬（北半球；南半球自动相反）。
 */
export function paintHdTile(hd: HdContext, season: number, tx: number, ty: number, k: number = HD_K): HdImage {
  const ctx = hd.base;
  const { fine, W, H, nav, input } = ctx;
  const S = DETAIL_CELL;
  const cx0 = tx * HD_TILE;
  const cy0 = ty * HD_TILE;
  const cw = Math.max(0, Math.min(HD_TILE, W - cx0));
  const ch = Math.max(0, Math.min(HD_TILE, H - cy0));
  const TFw = cw * S;
  const TFh = ch * S;
  const TW = TFw * k;
  const TH = TFh * k;
  const F0x = cx0 * S;
  const F0y = cy0 * S;
  const X0 = F0x * k;
  const Y0 = F0y * k;
  const data = new Uint8ClampedArray(new ArrayBuffer(TW * TH * 4));
  const image: HdImage = { x: X0, y: Y0, w: TW, h: TH, data };
  if (TW === 0 || TH === 0) return image;

  if (hdProf.on) profAt = performance.now();
  const FWW = TFw + 2 * MF;
  const FWH = TFh + 2 * MF;
  const FN = FWW * FWH;
  const cls = fineWindow(fine, F0x - MF, F0y - MF, FWW, FWH, scratchU8("hd-cls", FN));
  // 每细格：0 可航行的水、1 陆、2 进不去的水（粗格不可航行）
  const kind = scratchU8("hd-kind", FN);
  const wrap = input.wrapX === true;
  let lands = 0;
  let blocked = 0;
  for (let fy = 0; fy < FWH; fy++) {
    const gy = Math.floor((F0y - MF + fy) / S);
    const cy = gy < 0 ? 0 : gy >= H ? H - 1 : gy;
    let lastGx = Number.NaN;
    let open = 0;
    for (let fx = 0; fx < FWW; fx++) {
      const i = fy * FWW + fx;
      if (cls[i] === FINE_LAND) {
        kind[i] = 1;
        lands++;
        continue;
      }
      const gx = Math.floor((F0x - MF + fx) / S);
      if (gx !== lastGx) {
        lastGx = gx;
        const cx = wrap ? ((gx % W) + W) % W : gx < 0 ? 0 : gx >= W ? W - 1 : gx;
        open = nav[cy * W + cx];
      }
      kind[i] = open ? 0 : 2;
      if (!open) blocked++;
    }
  }
  const anyLand = lands > 0;
  const anyWater = lands < FN;
  const both = anyLand && anyWater;
  const anyBlocked = blocked > 0 && blocked + lands < FN;
  const PN = TW * TH;
  prof("kind");

  // 海陆的有符号距离（陆为正）与浅滩的有符号距离（进不去的水为正），放大到像素
  const sL = scratchF32("hd-sL", PN);
  /** 每细格要不要在格心强制画出真实类别：0 不必、1 陆、2 水（窗口坐标） */
  const force = scratchU8("hd-force", FN);
  force.fill(0, 0, FN);
  let fL: Float32Array | null = null;
  if (both) {
    fL = signedField(FWW, FWH, (i) => kind[i] === 1, (i) => kind[i] !== 1, CLAMP, scratchF32("hd-fL", FN));
    coastField(fL, kind, FWW, FWH, k, TW, TH, sL, force);
  } else sL.fill(anyLand ? CLAMP : -CLAMP, 0, PN);
  let sB: Float32Array | null = null;
  if (anyBlocked) {
    const f = signedField(FWW, FWH, (i) => kind[i] === 2, (i) => kind[i] === 0, 4, scratchF32("hd-fB", FN));
    sB = upsampleField(f, FWW, FWH, MF, k, TW, TH, scratchF32("hd-sB", PN));
  }

  prof("sdf");
  const tile: Tile = {
    hd,
    ctx,
    k,
    season: ((season % 4) + 4) % 4,
    X0,
    Y0,
    TW,
    TH,
    F0x,
    F0y,
    TFw,
    TFh,
    cls,
    FWW,
    FWH,
    out: new Uint32Array(data.buffer),
    landA: scratchF32("hd-landA", PN),
  };
  paintPixels(tile, kind, force, sL, sB, fL, anyWater, anyLand);
  prof("pixels");
  if (anyLand) {
    paintRivers(tile, tx, ty);
    prof("rivers");
    paintTowns(tile);
    paintLandmarks(tile);
    prof("towns");
  }
  return image;
}

/** 岸线只许落在离真实细格边界这么近的带子里（细格）：带外的地方颜色必须与碰撞一致。 */
const COAST_BAND = 0.9;

/**
 * 岸线的场（像素级，陆为正，近岸约等于到岸线的距离）：
 * 1. 细格上的有符号距离按二次 B 样条放大（四周多算两个细格）；
 * 2. 再做两遍方框模糊（半宽半个细格，合起来是半宽一个细格的三角形核）——细海岸一格一格的台阶抹成圆滑的线；
 * 3. 夹紧：离真实边界 COAST_BAND 个细格以外（按像素中心到另一类细格方块的精确距离），场的符号必须与真实类别相同。
 *    所以画出来的岸线一定落在真实边界两侧 0.9 个细格的带子里，船停下的地方离画出来的岸不会超过一个细格；
 * 4. 每个细格 1 格之内都要有画成它这一类的像素（小岛、窄水道被抹掉时）：没有的话在格心强制画出来（force）。
 * 结果写进 out（TW × TH），要强制的细格记进 force（窗口坐标）。
 */
function coastField(fL: Float32Array, kind: Uint8Array, FWW: number, FWH: number, k: number, TW: number, TH: number, out: Float32Array, force: Uint8Array) {
  const M2 = 2;
  const P = M2 * k;
  const W2 = TW + 2 * P;
  const H2 = TH + 2 * P;
  const wide = upsampleField(fL, FWW, FWH, MF - M2, k, W2, H2, scratchF32("hd-sLw", W2 * H2));
  boxBlur(wide, W2, H2, k >> 1, 2);
  // 夹紧 + 记下每个细格里有没有画成陆 / 水的像素（瓦片四周各一格，供“1 格之内”的判断）
  const CW = TW / k + 2 * M2;
  const CH = TH / k + 2 * M2;
  const drawn = scratchU8("hd-drawn", CW * CH);
  drawn.fill(0, 0, CW * CH);
  // 四周一圈都与自己同类的细格：离另一类至少一格，不必逐像素量
  const mixed = scratchU8("hd-mixed", CW * CH);
  for (let cy = 0; cy < CH; cy++) {
    for (let cx = 0; cx < CW; cx++) {
      const fi = (MF - M2 + cy) * FWW + MF - M2 + cx;
      const land = kind[fi] === 1;
      let m = 0;
      for (let dj = -1; dj <= 1 && !m; dj++) for (let di = -1; di <= 1; di++) if ((kind[fi + dj * FWW + di] === 1) !== land) m = 1;
      mixed[cy * CW + cx] = m;
    }
  }
  for (let y = 0; y < H2; y++) {
    const cy = Math.floor(y / k);
    const fy = MF - M2 + cy;
    const vy = (y + 0.5) / k - cy;
    for (let x = 0; x < W2; x++) {
      const cx = Math.floor(x / k);
      const fi = fy * FWW + MF - M2 + cx;
      const land = kind[fi] === 1;
      const i = y * W2 + x;
      let f = wide[i];
      // 像素中心到另一类细格方块的精确距离（只看四周一圈：更远的一定 ≥ 1）
      let g = 9;
      const ux = (x + 0.5) / k - cx;
      if (mixed[cy * CW + cx]) for (let dj = -1; dj <= 1; dj++) {
        const ey = dj < 0 ? vy : dj > 0 ? 1 - vy : 0;
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          if ((kind[fi + dj * FWW + di] === 1) === land) continue;
          const ex = di < 0 ? ux : di > 0 ? 1 - ux : 0;
          const d = Math.sqrt(ex * ex + ey * ey);
          if (d < g) g = d;
        }
      }
      if (g >= COAST_BAND) {
        if (land && f < 0.02) f = 0.02;
        else if (!land && f > -0.02) f = -0.02;
      }
      wide[i] = f;
      drawn[cy * CW + cx] |= f > 0 ? 1 : 2;
    }
  }
  // 1 格之内没有画成本类的细格：格心强制
  for (let cy = 1; cy < CH - 1; cy++) {
    for (let cx = 1; cx < CW - 1; cx++) {
      const fi = (MF - M2 + cy) * FWW + MF - M2 + cx;
      const want = kind[fi] === 1 ? 1 : 2;
      let near = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) near |= drawn[(cy + dj) * CW + cx + di];
      if (!(near & want)) force[fi] = want;
    }
  }
  for (let y = 0; y < TH; y++) out.set(wide.subarray((y + P) * W2 + P, (y + P) * W2 + P + TW), y * TW);
}

/**
 * 细格网（瓦片四周各多 2 格）上的慢变量：陆的底色（不含晕渲）、质感的种类、海岸的软硬、地势，水的底色与几种噪声场。
 * 噪声表的格点间距都在 13 细格以上，逐细格取值再双线性放大到像素，与逐像素取值看不出差别，省掉大半的时间。
 */
interface Grid {
  gx0: number;
  gy0: number;
  GW: number;
  GH: number;
  /** 陆的底色（r, g, b 摊平） */
  rgb: Float32Array;
  /** 地貌编号；积雪的加 64 */
  tex: Uint8Array;
  /** 海岸的软硬：小于 1.15 是沙滩，大于 2.1 是岩岸 */
  hard: Float32Array;
  /** 地势（米，带山脊的细纹） */
  hgt: Float32Array;
  /** 水的底色（按水深与海面的明暗；湖另配色） */
  wrgb: Float32Array;
  /** 白浪的断续、岸线晕的抖动、浅滩沙洲、浮冰的噪声 */
  foam: Float32Array;
  warp: Float32Array;
  bars: Float32Array;
  floe: Float32Array;
}

function gridOf(t: Tile, fL: Float32Array | null, anyWater: boolean, anyLand: boolean): Grid {
  const { ctx, cls, FWW, FWH, F0x, F0y, TFw, TFh } = t;
  const { W, H, vegN, input, fine } = ctx;
  const S = DETAIL_CELL;
  const wrap = input.wrapX === true;
  const N = noise();
  const GW = TFw + 4;
  const GH = TFh + 4;
  const gx0 = F0x - 2;
  const gy0 = F0y - 2;
  const GN = GW * GH;
  const g: Grid = {
    gx0,
    gy0,
    GW,
    GH,
    rgb: scratchF32("hd-g-rgb", GN * 3),
    tex: scratchU8("hd-g-tex", GN),
    hard: scratchF32("hd-g-hard", GN),
    hgt: scratchF32("hd-g-hgt", GN),
    wrgb: scratchF32("hd-g-wrgb", GN * 3),
    foam: scratchF32("hd-g-foam", GN),
    warp: scratchF32("hd-g-warp", GN),
    bars: scratchF32("hd-g-bars", GN),
    floe: scratchF32("hd-g-floe", GN),
  };
  const NWN = FWW * FWH;
  // 细格上的地势：取样位置按平滑噪声挪几格（成块的高程样本不沿格线成台阶），与细节瓦片同一种算法
  const landF = anyLand ? elevationHd(fine, S, F0x - MF, F0y - MF, FWW, FWH, 1, 1, scratchF32("hd-landF", NWN)) : null;
  const depthF = anyWater ? elevationHd(fine, S, gx0, gy0, GW, GH, 1, -1, scratchF32("hd-depthF", GN)) : null;
  const sNorth = t.season;
  const sSouth = (sNorth + 2) % 4;
  const pal = seasonRamps(sNorth);
  const palS = seasonRamps(sSouth);
  for (let gy = 0; gy < GH; gy++) {
    const py = gy0 + gy;
    const lat = latOfFine(input, py + 0.5);
    const south = lat < 0;
    const sp = south ? palS : pal;
    const sHere = south ? sSouth : sNorth;
    const cLat = classicLatOf(lat);
    const snowLine = snowLevel(sHere, cLat);
    const treeLine = 4.2 + (cLat <= 30 ? 0 : cLat >= 130 ? 4 : ((cLat - 30) / 100) * 4);
    const r512 = (py & 511) << 9;
    const r256 = (py & 255) << 8;
    const ownRow = Math.min(H - 1, Math.max(0, Math.floor(py / S))) * W;
    const wy = gy + (MF - 2);
    for (let gx = 0; gx < GW; gx++) {
      const px = gx0 + gx;
      const gi = gy * GW + gx;
      const wi = wy * FWW + gx + (MF - 2);
      const i512 = r512 | (px & 511);
      const i256 = r256 | (px & 255);
      if (anyWater && depthF) {
        // 水：水深（米）——贴岸必是浅水、两格以内至少是陆架色；细高程在岸边粗
        const dsh = fL ? -fL[wi] : CLAMP;
        if (cls[wi] === FINE_LAKE) {
          const dd = dsh > 6 ? 6 : dsh < 0 ? 0 : dsh;
          const tt = smoothstep(0.5, 4.5, dd + (N.sea[i512] - 0.5) * 2);
          for (let c = 0; c < 3; c++) g.wrgb[gi * 3 + c] = LAKE[c] + (LAKE_DEEP[c] - LAKE[c]) * tt;
        } else {
          let d = -depthF[gi];
          if (d < 4) d = 4;
          if (dsh <= 0.6) d = d > 12 ? 12 : d;
          else if (dsh <= 1.4) d = d > 150 ? 150 : d;
          const big = N.sea[i512];
          d *= 0.82 + (big - 0.5) * 0.5 + (N.fine[i256] - 0.5) * 0.12;
          let di = (d * 0.25) | 0;
          di = di > 1625 ? 1625 : di;
          // 海面的明暗：大尺度的一块块深浅，加横向拉长的细纹（像水彩刷过）
          const tone = 1 + (big - 0.5) * 0.09 + (noiseAt(N.fine, 8, px * 0.55, py * 2.2) - 0.5) * 0.05;
          for (let c = 0; c < 3; c++) g.wrgb[gi * 3 + c] = DEPTH_LUT[di * 3 + c] * tone;
        }
        g.foam[gi] = N.foam[i256];
        g.warp[gi] = noiseAt(N.warpC, 8, px * 2, py * 2);
        g.bars[gi] = noiseAt(N.shoal, 8, px, py * 2.6);
        g.floe[gi] = N.foam[(((py + 11) & 255) << 8) | ((px + 37) & 255)];
      }
      if (!anyLand || !landF) continue;
      // 陆：地貌与细节瓦片同一种打散法（大尺度挪位 + 在相邻四个格心之间按另一层噪声挑一个）
      const qx = (px + (N.warpA[i512] - 0.5) * 30) / S - 0.5;
      const qy = (py + (N.warpB[i512] - 0.5) * 30) / S - 0.5;
      let cgx = Math.floor(qx);
      let cgy = Math.floor(qy);
      const ux = qx - cgx;
      const uy = qy - cgy;
      if (ux * ux * (3 - 2 * ux) > (N.warpC[i256] - 0.5) * 2.6 + 0.5) cgx++;
      if (uy * uy * (3 - 2 * uy) > (N.warpD[i256] - 0.5) * 2.6 + 0.5) cgy++;
      cgy = cgy < 0 ? 0 : cgy >= H ? H - 1 : cgy;
      cgx = wrap ? ((cgx % W) + W) % W : cgx < 0 ? 0 : cgx >= W ? W - 1 : cgx;
      let v = vegN[cgy * W + cgx];
      if (v === SEA_VEG) {
        const ox = wrap ? ((Math.floor(px / S) % W) + W) % W : Math.min(W - 1, Math.max(0, Math.floor(px / S)));
        v = vegN[ownRow + ox];
        if (v === SEA_VEG) v = GRASS;
      }
      let j = wi + Math.round((N.warpC[i256] - 0.5) * 18) + Math.round((N.warpD[i256] - 0.5) * 18) * FWW;
      j = j < 0 ? 0 : j >= NWN ? NWN - 1 : j;
      const hm = landF[j];
      // 细脊的幅度看地势的陡缓（两侧各 6 细格的高差），高原是平的，山脉才起皱
      const e = j + 6 < NWN ? j + 6 : NWN - 1;
      const w6 = j >= 6 ? j - 6 : 0;
      const s6 = j + 6 * FWW < NWN ? j + 6 * FWW : j;
      const n6 = j >= 6 * FWW ? j - 6 * FWW : j;
      const gx6 = landF[e] - landF[w6];
      const gy6 = landF[s6] - landF[n6];
      const steep = (gx6 < 0 ? -gx6 : gx6) + (gy6 < 0 ? -gy6 : gy6);
      const rough = 6 + (steep * 0.3 > 300 ? 300 : steep * 0.3) + (hm > 2500 ? 30 : hm * 0.012);
      const ra = N.ridge[i512] - 0.5;
      const ridge = 1 - (ra < 0 ? -ra : ra) * 2;
      const rb = N.ridge2[i256] - 0.5;
      const ridge2 = 1 - (rb < 0 ? -rb : rb) * 2;
      // 水格的地势按 −40 米（岸边的坡度朝海），与细节瓦片相同
      g.hgt[gi] = cls[wi] === FINE_LAND ? hm + (ridge * ridge - 0.42) * rough * 1.5 + (ridge2 - 0.5) * rough * 0.45 : -40;
      const lvl = levelOfMeters(cls[wi] === FINE_LAND ? hm : 0);
      const tn = N.tone[i512] - 0.5;
      let snowy = v === ICE;
      if (!snowy) {
        const line = snowLine + sp.bias[v];
        if (lvl > line - 0.9) snowy = lvl + (N.fine[i256] - 0.5) * 1.1 + tn * 0.8 > line;
      }
      if (!snowy && lvl > treeLine + tn * 0.8 && v !== ALPINE && v !== VOLCANIC && v !== ARCANE) v = ALPINE;
      const ramp = snowy ? sp.snow : sp.ramps;
      const off = snowy ? 0 : v * 15;
      // 分层设色：低地略暗、高处略亮；色阶之间连续插值（没有抖动）
      let L = 2 + tn * 0.32 + (N.patch[i512] - 0.5) * 0.24 + (lvl < 1 ? -0.15 : lvl > 3 ? Math.min(0.3, (lvl - 3) * 0.08) : 0);
      L = L < 0 ? 0 : L > 4 ? 4 : L;
      const l0 = Math.floor(L);
      const l1 = l0 < 4 ? l0 + 1 : 4;
      const f = L - l0;
      for (let c = 0; c < 3; c++) g.rgb[gi * 3 + c] = ramp[off + l0 * 3 + c] + (ramp[off + l1 * 3 + c] - ramp[off + l0 * 3 + c]) * f;
      g.tex[gi] = v | (snowy ? 64 : 0);
      let hard = snowy || v === ICE ? 9 : lvl + (v === ALPINE ? 3 : v === BOREAL || v === TUNDRA ? 0.8 : v === DESERT || v === SAVANNA || v === JUNGLE ? -0.6 : 0) + (N.shoal[i256] - 0.5) * 2.2;
      // 湿地与雨林的岸不画沙滩（红树林、泥岸），够硬的照样是岩岸
      if ((v === WETLAND || v === JUNGLE) && hard < 2.1) hard = Math.max(1.5, hard);
      g.hard[gi] = hard;
    }
  }
  return g;
}

/** 城镇（田畴够得着的）：中心（细格坐标，挪到离瓦片最近的那一份）、半径与种子。 */
function townsNear(t: Tile): { u: number; v: number; r: number; seed: number; city: boolean }[] {
  const { ctx, F0x, F0y, TFw, TFh } = t;
  const S = DETAIL_CELL;
  const FW = ctx.W * S;
  const wrap = ctx.input.wrapX === true;
  const out: { u: number; v: number; r: number; seed: number; city: boolean }[] = [];
  ctx.towns.forEach((p, k) => {
    const r = p.city ? 32 : 26;
    const v = p.y * S + S / 2;
    if (v + r + 8 < F0y || v - r - 8 > F0y + TFh) return;
    let u = p.x * S + S / 2;
    if (wrap) u += Math.round((F0x + TFw / 2 - u) / FW) * FW;
    if (u + r + 8 < F0x || u - r - 8 > F0x + TFw) return;
    out.push({ u, v, r, seed: k, city: p.city });
  });
  return out;
}

/** 树冠网：瓦片四周各多 2 细格范围里每个网格的树（中心、半径；没有树的半径为 0），一块瓦片按需算一次。 */
interface Canopy {
  sp: number;
  i0: number;
  j0: number;
  ni: number;
  nj: number;
  cx: Float32Array;
  cy: Float32Array;
  rr: Float32Array;
  gap: number;
}
function canopyGrid(t: Tile, sp: number, r: number, dens: number, gap: number, seed: number): Canopy {
  const i0 = Math.floor((t.F0x - 2) / sp) - 1;
  const j0 = Math.floor((t.F0y - 2) / sp) - 1;
  const ni = Math.ceil((t.TFw + 4) / sp) + 3;
  const nj = Math.ceil((t.TFh + 4) / sp) + 3;
  const n = ni * nj;
  const cx = new Float32Array(n);
  const cy = new Float32Array(n);
  const rr = new Float32Array(n);
  for (let b = 0; b < nj; b++) {
    for (let a = 0; a < ni; a++) {
      const i = i0 + a;
      const j = j0 + b;
      const q = b * ni + a;
      if (hash2(i, j, seed) >= dens) continue;
      cx[q] = (i + 0.5 + (hash2(i, j, seed + 1) - 0.5) * 0.5) * sp;
      cy[q] = (j + 0.5 + (hash2(i, j, seed + 2) - 0.5) * 0.5) * sp;
      rr[q] = r * (0.8 + hash2(i, j, seed + 3) * 0.4);
    }
  }
  return { sp, i0, j0, ni, nj, cx, cy, rr, gap };
}
/**
 * 树冠（手绘地图上成团的树）：u、v 为细格坐标。返回亮度的乘数——树冠左上亮、右下暗、边上略暗，
 * 南边的树冠压住北边的；冠与冠之间返回 gap（阴影）。
 */
function canopyAt(c: Canopy, u: number, v: number): number {
  const a0 = Math.floor(u / c.sp - 0.5) - c.i0;
  const b0 = Math.floor(v / c.sp - 0.5) - c.j0;
  let best = -1e9;
  let shade = c.gap;
  for (let db = 0; db <= 1; db++) {
    const b = b0 + db;
    if (b < 0 || b >= c.nj) continue;
    for (let da = 0; da <= 1; da++) {
      const a = a0 + da;
      if (a < 0 || a >= c.ni) continue;
      const q = b * c.ni + a;
      const rr = c.rr[q];
      if (rr === 0) continue;
      const dx = (u - c.cx[q]) / rr;
      const dy = (v - c.cy[q]) / rr;
      const qq = dx * dx + dy * dy;
      if (qq < 1 && c.cy[q] > best) {
        best = c.cy[q];
        shade = 1 - (dx + dy) * 0.065 - smoothstep(0.55, 1, qq) * 0.08;
      }
    }
  }
  return shade;
}

/**
 * 外海零星的浪纹（手绘海图上一笔淡淡的水波“∿”）：用树冠网的格子摆（每格至多一笔），u、v 为细格坐标。
 * 返回浪纹的不透明度（0 没有）；两头渐淡。
 */
function waveAt(c: Canopy, u: number, v: number, px1: number): number {
  const a0 = Math.floor(u / c.sp - 0.5) - c.i0;
  const b0 = Math.floor(v / c.sp - 0.5) - c.j0;
  let best = 0;
  for (let db = 0; db <= 1; db++) {
    const b = b0 + db;
    if (b < 0 || b >= c.nj) continue;
    for (let da = 0; da <= 1; da++) {
      const a = a0 + da;
      if (a < 0 || a >= c.ni) continue;
      const q = b * c.ni + a;
      if (c.rr[q] === 0) continue;
      const dx = u - c.cx[q];
      if (dx < -1.7 || dx > 1.7) continue;
      const dy = v - c.cy[q] - Math.sin(dx * 1.85) * 0.22;
      const d = dy < 0 ? -dy : dy;
      if (d > 0.3) continue;
      const al = (1 - smoothstep(0.05, 0.05 + px1, d)) * (1 - smoothstep(0.9, 1.7, dx < 0 ? -dx : dx));
      if (al > best) best = al;
    }
  }
  return best;
}

/** 0–1 的小抖动表（64 × 64，按世界像素取）：质感交界的挪位、裸岩的碎点。 */
const JITTER: Float32Array = (() => {
  const t = new Float32Array(4096 * 2);
  for (let i = 0; i < 4096; i++) {
    t[i * 2] = hash2(i & 63, i >> 6, 3311);
    t[i * 2 + 1] = hash2(i & 63, i >> 6, 3313);
  }
  return t;
})();

/** 近岸浅水的亮色：离岸距离（细格）× 46 → 混合比例。 */
const SHALLOW_LUT: Float32Array = Float32Array.from({ length: 256 }, (_, i) => Math.exp(-i / 46 / 1.5) * 0.55);

/** 逐像素：海、浅滩、湖、陆，按陆的覆盖率合成。 */
function paintPixels(t: Tile, kind: Uint8Array, force: Uint8Array, sL: Float32Array, sB: Float32Array | null, fL: Float32Array | null, anyWater: boolean, anyLand: boolean) {
  const { k, X0, Y0, TW, TH, cls, FWW, out, landA, ctx } = t;
  const input = ctx.input;
  const N = noise();
  const G = gridOf(t, fL, anyWater, anyLand);
  prof("grid");
  const towns = anyLand ? townsNear(t) : [];
  // 地势放大到像素（四周多 k 像素好求坡度）
  const HW = TW + 2 * k;
  const hgt = anyLand ? upsampleField(G.hgt, G.GW, G.GH, 1, k, HW, TH + 2 * k, scratchF32("hd-hgt", HW * (TH + 2 * k))) : null;
  prof("hgt");
  const canopies = new Map<number, Canopy>();
  const waves = canopyGrid(t, 5.5, 1, 0.22, 1, 3431);
  const can = (seed: number, sp: number, r: number, dens: number, gap: number) => {
    let c = canopies.get(seed);
    if (!c) canopies.set(seed, (c = canopyGrid(t, sp, r, dens, gap, seed)));
    return c;
  };
  const sNorth = t.season;
  const sSouth = (sNorth + 2) % 4;
  // 一个像素的宽（细格）：抗锯齿与细线的宽度按它
  const px1 = 1 / k;
  const lineW = Math.max(0.16, 0.55 * px1);
  const lw0 = lineW * 0.5;
  const lw1 = lineW * 1.2;
  // 要强制的细格（coastField 定的）只强制格心附近的像素：偏离格心不到 0.3 细格的（k = 4 时是中间 2×2，k ≤ 2 时每个像素）
  const forced = new Uint8Array(k);
  for (let q = 0; q < k; q++) forced[q] = Math.abs((q + 0.5) / k - 0.5) < 0.3 ? 1 : 0;
  // 每列在细格网上的双线性位置
  const colQ = new Int32Array(TW);
  const colF = new Float32Array(TW);
  for (let ox = 0; ox < TW; ox++) {
    const gu = (X0 + ox + 0.5) / k - G.gx0 - 0.5;
    const q = Math.floor(gu);
    colQ[ox] = q;
    colF[ox] = gu - q;
  }
  const GW = G.GW;
  const wrgb = G.wrgb;
  const rgb = G.rgb;
  for (let oy = 0; oy < TH; oy++) {
    const Y = Y0 + oy;
    const v = (Y + 0.5) / k;
    const lat = latOfFine(input, v);
    const sea = lat < 0 ? sSouth : sNorth;
    const alat = lat < 0 ? -lat : lat;
    const iceReach = Math.min(2.5, (sea === 3 ? (alat - 56) * 0.9 : sea === 0 ? (alat - 66) * 0.8 : sea === 2 ? (alat - 70) * 0.6 : (alat - 76) * 0.5) / 4);
    const lakeIce = sea === 3 && alat > 60;
    const fyW = MF + Math.floor(oy / k);
    const subY = oy % k;
    const fRow = forced[subY];
    const sHere = lat < 0 ? sSouth : sNorth;
    const gv = v - G.gy0 - 0.5;
    const rq = Math.floor(gv);
    const fy = gv - rq;
    const rowQ = rq * GW;
    const hRow = (oy + k) * HW + k;
    const jRow = ((Y >> 1) & 63) << 6;
    for (let ox = 0; ox < TW; ox++) {
      const i = oy * TW + ox;
      const u = (X0 + ox + 0.5) / k;
      const fi = fyW * FWW + MF + Math.floor(ox / k);
      const truth = kind[fi];
      let s = sL[i];
      // 陆的覆盖率：零线两侧各半个像素的过渡；格心附近照真实类别
      let a = 0.5 + s * k;
      a = a < 0 ? 0 : a > 1 ? 1 : a;
      const isForced = fRow === 1 && forced[ox % k] === 1 && force[fi] !== 0;
      if (isForced) {
        if (truth === 1 && a < 1) {
          a = 1;
          if (s < 0.05) s = 0.05;
        } else if (truth !== 1 && a > 0) {
          a = 0;
          if (s > -0.05) s = -0.05;
        }
      }
      landA[i] = a;
      // 细格网上的双线性权重
      const fx = colF[ox];
      const q00 = rowQ + colQ[ox];
      const q01 = q00 + GW;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      let wr = 0;
      let wg = 0;
      let wb = 0;
      if (a < 1) {
        // ── 水 ──
        wr = wrgb[q00 * 3] * w00 + wrgb[q00 * 3 + 3] * w10 + wrgb[q01 * 3] * w01 + wrgb[q01 * 3 + 3] * w11;
        wg = wrgb[q00 * 3 + 1] * w00 + wrgb[q00 * 3 + 4] * w10 + wrgb[q01 * 3 + 1] * w01 + wrgb[q01 * 3 + 4] * w11;
        wb = wrgb[q00 * 3 + 2] * w00 + wrgb[q00 * 3 + 5] * w10 + wrgb[q01 * 3 + 2] * w01 + wrgb[q01 * 3 + 5] * w11;
        // 这个像素算哪一种水：自己的细格是水就照它；画成水的陆格看旁边最近的水格
        let wc = cls[fi];
        let blk = truth === 2;
        if (truth === 1) {
          const sx = (ox % k) + 0.5 < k / 2 ? -1 : 1;
          const sy = subY + 0.5 < k / 2 ? -1 : 1;
          wc = 0;
          for (let c = 0; c < 3; c++) {
            const n = c === 0 ? fi + sx : c === 1 ? fi + sy * FWW : fi + sx + sy * FWW;
            if (kind[n] !== 1) {
              wc = cls[n];
              blk = kind[n] === 2;
              break;
            }
          }
        }
        if (sB && !isForced) blk = sB[i] > 0;
        const dsh = -s;
        if (wc === FINE_LAKE) {
          if (lakeIce && G.floe[q00] > 0.35) {
            wr = ICE_FLOE[0];
            wg = ICE_FLOE[1];
            wb = ICE_FLOE[2];
          }
        } else {
          if (dsh < 5.5) {
            // 近岸浅水的亮色
            const sh = SHALLOW_LUT[dsh > 0 ? (dsh * 46) | 0 : 0];
            wr += (SHALLOW[0] - wr) * sh;
            wg += (SHALLOW[1] - wg) * sh;
            wb += (SHALLOW[2] - wb) * sh;
            // 岸线晕：三道随岸线走的细线，越往外越淡（手绘海图的画法）
            const wp = G.warp[q00] * w00 + G.warp[q00 + 1] * w10 + G.warp[q01] * w01 + G.warp[q01 + 1] * w11;
            const dw = dsh + (wp - 0.5) * 0.45;
            const e1 = dw > 1.05 ? dw - 1.05 : 1.05 - dw;
            const e2 = dw > 2.3 ? dw - 2.3 : 2.3 - dw;
            const e3 = dw > 3.8 ? dw - 3.8 : 3.8 - dw;
            const lw = 0.3 * (1 - smoothstep(lw0, lw1, e1)) + 0.19 * (1 - smoothstep(lw0, lw1, e2)) + 0.1 * (1 - smoothstep(lw0, lw1, e3));
            if (lw > 0) {
              wr += (WATERLINE[0] - wr) * lw;
              wg += (WATERLINE[1] - wg) * lw;
              wb += (WATERLINE[2] - wb) * lw;
            }
            // 贴岸一道断续的白浪
            if (dsh < 0.45) {
              const fm = G.foam[q00] * w00 + G.foam[q00 + 1] * w10 + G.foam[q01] * w01 + G.foam[q01 + 1] * w11;
              const fo = (1 - smoothstep(0.1, 0.42, dsh)) * smoothstep(0.38, 0.5, fm) * 0.6;
              wr += (FOAM[0] - wr) * fo;
              wg += (FOAM[1] - wg) * fo;
              wb += (FOAM[2] - wb) * fo;
            }
          }
          if (dsh > 3 && !blk) {
            // 外海零星的浪纹，离岸越远越清楚（还是很淡）
            const wv = waveAt(waves, u, v, px1);
            if (wv > 0) {
              const wa = wv * 0.13 * smoothstep(3, 8, dsh);
              wr += (FOAM[0] - wr) * wa;
              wg += (FOAM[1] - wg) * wa;
              wb += (FOAM[2] - wb) * wa;
            }
          }
          if (blk) {
            // 浅滩（船进不去的水）：泛绿发白的浅水；离可航行的水一格以上，按噪声浮出一道道沙洲
            const sbv = sB ? sB[i] : 9;
            const inA = sB ? smoothstep(-0.5 * px1, 0.5 * px1, sbv) : 1;
            // 离岸近的浅滩才浓（贴着陆的海湾、河口），开阔水面上被粗格挡住的一片只淡淡地染一层
            const sa = (0.2 + 0.4 * (1 - smoothstep(1.5, 5, dsh))) * inA;
            wr += (SHOAL[0] - wr) * sa;
            wg += (SHOAL[1] - wg) * sa;
            wb += (SHOAL[2] - wb) * sa;
            if (sbv > 0.8 && dsh < 6) {
              const bars = G.bars[q00] * w00 + G.bars[q00 + 1] * w10 + G.bars[q01] * w01 + G.bars[q01 + 1] * w11;
              const ba = smoothstep(0.6, 0.6 + 0.6 * px1 + 0.01, bars) * smoothstep(0.8, 1.6, sbv) * (1 - smoothstep(2, 6, dsh)) * 0.75;
              wr += (SHOAL_DOT[0] - wr) * ba;
              wg += (SHOAL_DOT[1] - wg) * ba;
              wb += (SHOAL_DOT[2] - wb) * ba;
            }
          }
          if (sB) {
            // 浅滩的边：一道点线（可航行的水与进不去的水的交界，旧海图标浅滩的画法）
            const e = sB[i] < 0 ? -sB[i] : sB[i];
            if (e < lineW * 1.3) {
              const dot = (u + v) * 0.9;
              if (dot - Math.floor(dot) < 0.45) {
                const ln = (1 - smoothstep(lineW * 0.45, lineW * 1.3, e)) * 0.5;
                wr += (WATERLINE[0] - wr) * ln;
                wg += (WATERLINE[1] - wg) * ln;
                wb += (WATERLINE[2] - wb) * ln;
              }
            }
          }
          if (iceReach > 0 && dsh < iceReach * 3) {
            // 冬天高纬的近岸浮冰：越往高纬越多，离岸越远越稀
            const n = G.floe[q00] * w00 + G.floe[q00 + 1] * w10 + G.floe[q01] * w01 + G.floe[q01 + 1] * w11;
            const thr = 0.6 - Math.min(0.12, iceReach * 0.05) + (dsh / (iceReach * 3)) * 0.12;
            const fl = smoothstep(thr, thr + 0.03, n) * 0.9;
            if (fl > 0) {
              const edge = 1 - smoothstep(thr + 0.03, thr + 0.08, n);
              wr += (ICE_FLOE[0] + (ICE_EDGE[0] - ICE_FLOE[0]) * edge - wr) * fl;
              wg += (ICE_FLOE[1] + (ICE_EDGE[1] - ICE_FLOE[1]) * edge - wg) * fl;
              wb += (ICE_FLOE[2] + (ICE_EDGE[2] - ICE_FLOE[2]) * edge - wb) * fl;
            }
          }
        }
      }
      // 纸面的细颗粒（几乎看不出，免得大片的色块显得太“数码”）
      const grain = 1 + (JITTER[(((Y & 63) << 6) | ((X0 + ox) & 63)) * 2] - 0.5) * 0.035;
      if (a <= 0) {
        out[i] = pack(wr * grain, wg * grain, wb * grain);
        continue;
      }
      // ── 陆 ──
      let lr = rgb[q00 * 3] * w00 + rgb[q00 * 3 + 3] * w10 + rgb[q01 * 3] * w01 + rgb[q01 * 3 + 3] * w11;
      let lg = rgb[q00 * 3 + 1] * w00 + rgb[q00 * 3 + 4] * w10 + rgb[q01 * 3 + 1] * w01 + rgb[q01 * 3 + 4] * w11;
      let lb = rgb[q00 * 3 + 2] * w00 + rgb[q00 * 3 + 5] * w10 + rgb[q01 * 3 + 2] * w01 + rgb[q01 * 3 + 5] * w11;
      const hardV = G.hard[q00] * w00 + G.hard[q00 + 1] * w10 + G.hard[q01] * w01 + G.hard[q01 + 1] * w11;
      // 质感的种类：取像素所在的那个细格（按一点抖动挪，交界不沿格线）
      const ji = jRow | (((X0 + ox) >> 1) & 63);
      const tq = (rq + (fy + JITTER[ji * 2] * 0.6 > 0.8 ? 1 : 0)) * GW + colQ[ox] + (fx + JITTER[ji * 2 + 1] * 0.6 > 0.8 ? 1 : 0);
      const tcode = G.tex[tq];
      const snowy = tcode >= 64;
      const vv = tcode & 63;
      // 晕渲：西北光，沿西北—东南方向的高差（一细格的间距），开方压缩
      const hg = hgt as Float32Array;
      const hi = hRow + ox;
      const g = hg[hi - k * HW - k] + hg[hi - k] * 0.5 + hg[hi - k * HW] * 0.5 - hg[hi + k * HW + k] - hg[hi + k] * 0.5 - hg[hi + k * HW] * 0.5;
      const ga = g < 0 ? -g : g;
      let shade = Math.sqrt(ga / 44);
      if (shade > 1.5) shade = 1.5;
      if (g > 0) shade = -shade;
      const flat = ga < 150;
      let mul = 1 + shade * 0.17;
      // 质感（陡坡上收一点，让晕渲读得出来）
      if (!snowy) {
        switch (vv) {
          case FOREST:
            mul *= canopyAt(can(3401, 1.55, 0.95, 0.86, 0.9), u, v);
            break;
          case JUNGLE:
            mul *= canopyAt(can(3403, 1.4, 0.95, 0.94, 0.89), u, v);
            break;
          case BOREAL:
            mul *= canopyAt(can(3405, 1.15, 0.62, 0.8, 0.9), u, v);
            break;
          case SAVANNA:
            mul *= canopyAt(can(3407, 2.4, 0.55, 0.14, 1), u, v);
            break;
          case MEDIT:
            mul *= canopyAt(can(3409, 1.5, 0.42, 0.32, 1), u, v);
            break;
          case DESERT:
            if (flat) {
              const dune = noiseAt(N.dune, 9, u, v);
              if (dune > 0.48) {
                const ph = (v * 0.92 + u * 0.24 + noiseAt(N.warpC, 8, u, v) * 5) / 2.4;
                mul *= 1 + Math.sin(ph * 6.2832) * 0.045 * smoothstep(0.48, 0.56, dune);
              }
            }
            break;
          case WETLAND: {
            // 沼泽：短横的符号，零星的小水洼
            const cu = Math.floor(u / 2.2);
            const cv = Math.floor(v / 1.6);
            const h = hash2(cu, cv, 3411);
            if (h < 0.55) {
              const du = u - (cu + 0.5) * 2.2;
              const dv = v - (cv + 0.5) * 1.6 - (h - 0.27) * 0.6;
              if ((du < 0 ? -du : du) < 0.55) mul *= 1 - (1 - smoothstep(0.06, 0.06 + px1, dv < 0 ? -dv : dv)) * 0.22;
            } else if (h > 0.93 && flat) {
              const dd = Math.hypot(u - (cu + 0.5) * 2.2, v - (cv + 0.5) * 1.6);
              const pool = 1 - smoothstep(0.3, 0.3 + px1, dd);
              lr += (LAKE[0] - lr) * pool;
              lg += (LAKE[1] - lg) * pool;
              lb += (LAKE[2] - lb) * pool;
            }
            break;
          }
          case ALPINE:
            mul *= 1 + (JITTER[ji * 2] - 0.5) * 0.06;
            break;
          case VOLCANIC:
            if (hash2(Math.floor(u * 0.8), Math.floor(v * 0.8), 3415) < 0.015) {
              lr += (LAVA[0] - lr) * 0.5;
              lg += (LAVA[1] - lg) * 0.5;
              lb += (LAVA[2] - lb) * 0.5;
            }
            break;
          case ARCANE:
            if (hash2(Math.floor(u), Math.floor(v), 3417) < 0.02) {
              lr += (SPARK[0] - lr) * 0.45;
              lg += (SPARK[1] - lg) * 0.45;
              lb += (SPARK[2] - lb) * 0.45;
            }
            break;
        }
      } else if (vv === BOREAL) {
        // 雪里的针叶林：一棵棵深色的树尖从雪里露出来
        const c = canopyAt(can(3421, 1.5, 0.4, 0.28, 1), u, v);
        if (c !== 1) mul *= 0.8 + (c - 0.9) * 0.5;
      } else if (vv === FOREST) {
        if (canopyAt(can(3423, 1.7, 0.4, 0.3, 1), u, v) !== 1) mul *= 0.86;
      }
      lr *= mul;
      lg *= mul;
      lb *= mul;
      // 暗面偏冷、亮面偏暖
      if (shade < 0) {
        lr -= SHADOW_TINT[0] * shade;
        lg -= SHADOW_TINT[1] * shade;
        lb -= SHADOW_TINT[2] * shade;
      } else {
        lr += LIGHT_TINT[0] * shade;
        lg += LIGHT_TINT[1] * shade;
        lb += LIGHT_TINT[2] * shade;
      }
      // 田畴：城镇周围平缓、能开垦的地上是斜着排的小块田，田埂深一阶；积雪时只剩田埂
      if (towns.length > 0 && ga < 110 && vv !== ICE && vv !== ALPINE && vv !== VOLCANIC && vv !== ARCANE && vv !== TUNDRA && arable(vv)) {
        let near = 9;
        // 量到城的距离之前把位置按大尺度噪声挪一挪：田的外缘成不规则的一片，不是圆
        const wu = u + (noiseAt(N.warpA, 9, u * 2, v * 2) - 0.5) * 34;
        const wv = v + (noiseAt(N.warpB, 9, u * 2, v * 2) - 0.5) * 34;
        for (let q = 0; q < towns.length; q++) {
          const tw = towns[q];
          const ddx = wu - tw.u;
          const ddy = wv - tw.v;
          const qq = (ddx * ddx + ddy * ddy) / (tw.r * tw.r);
          if (qq < near) near = qq;
        }
        if (near < 1.6) {
          // 田的外缘按两层噪声参差（不是一个圆）：沙漠里只有贴着城的一小圈绿洲
          const lim = (0.62 + (noiseAt(N.patch, 9, u, v) - 0.5) * 1.5 + (noiseAt(N.tone, 9, u, v) - 0.5) * 0.9) * (vv === DESERT ? 0.3 : 1);
          const fieldA = 1 - smoothstep(lim - 0.06, lim, near);
          if (fieldA > 0) {
            const fu = u * 0.92 + v * 0.38;
            const fv = v * 0.92 - u * 0.38;
            const iu = Math.floor(fu / 7);
            const iv = Math.floor(fv / 5);
            const hsh = hash2(iu, iv, 2301);
            const eu = fu - iu * 7;
            const ev = fv - iv * 5;
            const hedge = Math.max(1 - smoothstep(0.22, 0.22 + px1, eu < 3.5 ? eu : 7 - eu), 1 - smoothstep(0.22, 0.22 + px1, ev < 2.5 ? ev : 5 - ev));
            let fr = lr;
            let fg = lg;
            let fb = lb;
            if (!snowy && hsh < 0.8) {
              const set = vv === DESERT ? FIELDS_OASIS : vv === JUNGLE || vv === SAVANNA ? FIELDS_TROPIC : FIELDS[sHere];
              // 垄：隔一道深一点
              const c = set[hsh < 0.36 ? (Math.floor(fv * 1.6) & 1 ? 1 : 0) : hsh < 0.62 ? 1 : 2];
              fr = c[0] * mul;
              fg = c[1] * mul;
              fb = c[2] * mul;
            }
            const hc = snowy ? HEDGE_SNOW : HEDGE;
            fr += (hc[0] - fr) * hedge * 0.7;
            fg += (hc[1] - fg) * hedge * 0.7;
            fb += (hc[2] - fb) * hedge * 0.7;
            const fa = fieldA * 0.72;
            lr += (fr - lr) * fa;
            lg += (fg - lg) * fa;
            lb += (fb - lb) * fa;
          }
        }
      }
      // 岸：贴水一道墨线；后面是沙滩或岩岸（按地势与地貌），冰原是冷灰的冰崖线
      if (s < 1.2) {
        if (!snowy && s < 1.0) {
          if (hardV < 1.15) {
            const n = vv === DESERT ? 1 : noiseAt(N.sea, 9, u * 3, v * 3);
            const ba = (1 - smoothstep(0.62, 0.9, s)) * smoothstep(0.4, 0.5, n);
            lr += (BEACH[0] - lr) * ba;
            lg += (BEACH[1] - lg) * ba;
            lb += (BEACH[2] - lb) * ba;
          } else if (hardV >= 2.1) {
            const ra = (1 - smoothstep(0.5, 0.85, s)) * 0.55;
            lr += (ROCK[0] - lr) * ra;
            lg += (ROCK[1] - lg) * ra;
            lb += (ROCK[2] - lb) * ra;
          }
        }
        const ic = snowy || vv === ICE ? INK_ICE : INK;
        const ia = (1 - smoothstep(px1 * 0.55, px1 * 1.35, s)) * 0.88;
        lr += (ic[0] - lr) * ia;
        lg += (ic[1] - lg) * ia;
        lb += (ic[2] - lb) * ia;
      }
      if (a >= 1) out[i] = pack(lr * grain, lg * grain, lb * grain);
      else out[i] = pack((wr + (lr - wr) * a) * grain, (wg + (lg - wg) * a) * grain, (wb + (lb - wb) * a) * grain);
    }
  }
}

/** 河段按 8 格瓦片分的索引（与细节瓦片的 32 格不同，另建一份）。 */
function riverIndex(hd: HdContext): Map<string, number[]> {
  if (hd.rivers) return hd.rivers;
  const ctx = hd.base;
  const index = new Map<string, number[]>();
  const T = HD_TILE * DETAIL_CELL;
  const FW = ctx.W * DETAIL_CELL;
  const nx = Math.ceil(ctx.W / HD_TILE);
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
  hd.rivers = index;
  return index;
}

/** 河道平滑（Chaikin 两遍，细格中心坐标）：一条河算一次。 */
function smoothRiver(hd: HdContext, k: number): Float32Array {
  const got = hd.smooth[k];
  if (got) return got;
  const r = hd.base.fine.rivers[k];
  const pts: [number, number][] = [];
  for (let i = 0; i < r.pts.length; i += 2) pts.push([r.pts[i] + 0.5, r.pts[i + 1] + 0.5]);
  const sm = chaikin(pts, 2);
  const out = new Float32Array(sm.length * 2);
  sm.forEach(([x, y], i) => {
    out[i * 2] = x;
    out[i * 2 + 1] = y;
  });
  hd.smooth[k] = out;
  return out;
}

/** 河的宽度（细格）：按 Natural Earth 的等级。 */
function riverWidth(rank: number): number {
  return rank <= 2 ? 1.25 : rank <= 5 ? 0.8 : 0.5;
}

/** 这块瓦片里的河：平滑后的真实河道，抗锯齿的细线，只落在陆上；冬天高纬的河面结冰。 */
function paintRivers(t: Tile, tx: number, ty: number) {
  const { hd, ctx, k, X0, Y0, TW, TH, out, landA, F0x, TFw } = t;
  const list = riverIndex(hd).get(`${tx}:${ty}`);
  if (!list) return;
  const FW = ctx.W * DETAIL_CELL;
  const cover = scratchF32("hd-river", TW * TH);
  cover.fill(0, 0, TW * TH);
  let any = false;
  for (const ri of list) {
    const r = ctx.fine.rivers[ri];
    const pts = smoothRiver(hd, ri);
    const half = riverWidth(r.rank) / 2;
    const shift = Math.round((F0x + TFw / 2 - pts[0]) / FW) * FW;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const ax = pts[i] + shift;
      const ay = pts[i + 1];
      const bx = pts[i + 2] + shift;
      const by = pts[i + 3];
      const reach = half + 1 / k;
      const px0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) * k) - X0);
      const px1 = Math.min(TW - 1, Math.ceil((Math.max(ax, bx) + reach) * k) - X0);
      const py0 = Math.max(0, Math.floor((Math.min(ay, by) - reach) * k) - Y0);
      const py1 = Math.min(TH - 1, Math.ceil((Math.max(ay, by) + reach) * k) - Y0);
      if (px1 < px0 || py1 < py0) continue;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy || 1e-9;
      for (let oy = py0; oy <= py1; oy++) {
        const v = (Y0 + oy + 0.5) / k;
        for (let ox = px0; ox <= px1; ox++) {
          const u = (X0 + ox + 0.5) / k;
          let p = ((u - ax) * dx + (v - ay) * dy) / len2;
          p = p < 0 ? 0 : p > 1 ? 1 : p;
          const ex = u - ax - p * dx;
          const ey = v - ay - p * dy;
          const d = Math.sqrt(ex * ex + ey * ey);
          let c = (half - d) * k + 0.5;
          if (c <= 0) continue;
          c = c > 1 ? 1 : c;
          const i = oy * TW + ox;
          if (c > cover[i]) cover[i] = c;
          any = true;
        }
      }
    }
  }
  if (!any) return;
  for (let oy = 0; oy < TH; oy++) {
    const lat = latOfFine(ctx.input, (Y0 + oy + 0.5) / k);
    const frozen = (lat < 0 ? (t.season + 2) % 4 : t.season) === 3 && Math.abs(lat) > 52;
    const rc = frozen ? RIVER_ICE : RIVER;
    for (let ox = 0; ox < TW; ox++) {
      const i = oy * TW + ox;
      const c = cover[i] * landA[i];
      if (c <= 0) continue;
      const d = out[i];
      const r = d & 0xff;
      const g = (d >>> 8) & 0xff;
      const b = (d >>> 16) & 0xff;
      out[i] = pack(r + (rc[0] - r) * c, g + (rc[1] - g) * c, b + (rc[2] - b) * c);
    }
  }
}

/** 把像素图（0xRRGGBBAA）按 q 倍最近邻盖到瓦片上：左上角在世界像素 (x, y)；landOnly 时只落在陆上。 */
function stamp(t: Tile, src: Px, x: number, y: number, q: number, landOnly: boolean) {
  const { out, TW, TH, X0, Y0, landA } = t;
  for (let sy = 0; sy < src.h * q; sy++) {
    const oy = y + sy - Y0;
    if (oy < 0 || oy >= TH) continue;
    for (let sx = 0; sx < src.w * q; sx++) {
      const ox = x + sx - X0;
      if (ox < 0 || ox >= TW) continue;
      const val = src.data[((sy / q) | 0) * src.w + ((sx / q) | 0)];
      const i = oy * TW + ox;
      let al = (val & 0xff) / 255;
      if (landOnly) al *= landA[i];
      if (al <= 0) continue;
      const d = out[i];
      const r = d & 0xff;
      const g = (d >>> 8) & 0xff;
      const b = (d >>> 16) & 0xff;
      out[i] = pack(r + (((val >>> 24) & 0xff) - r) * al, g + (((val >>> 16) & 0xff) - g) * al, b + (((val >>> 8) & 0xff) - b) * al);
    }
  }
}

/** 城镇的民居：小房子（整张海图上的同一种）按 k/2 倍盖上，比细节瓦片里小一半、多几栋，散在城镇中心周围的陆上。 */
function paintTowns(t: Tile) {
  const { ctx, k } = t;
  const towns = townsNear(t);
  if (towns.length === 0) return;
  const fine = ctx.fine;
  const q = Math.max(1, k >> 1);
  for (const tw of towns) {
    const p = ctx.towns[tw.seed];
    const lat = latOfFine(ctx.input, tw.v);
    const season = lat < 0 ? (t.season + 2) % 4 : t.season;
    const snowy = snowLevel(season, classicLatOf(lat)) < 0.6;
    const box = houseBox(p.style);
    // 房子在细格里的大小
    const bw = (box.w * q) / k;
    const bh = (box.h * q) / k;
    const n = tw.city ? 16 : 10;
    const reach = tw.city ? 13 : 10;
    const spots: [number, number][] = [];
    for (let j = 0; j < n * 3 && spots.length < n; j++) {
      const hx = (hash2(tw.seed, j, 2311) - 0.5) * 2 * reach;
      const hy = (hash2(tw.seed, j, 2313) - 0.5) * 2 * reach * 0.8;
      const wx = tw.u + hx;
      const wy = tw.v + hy;
      const land = (dx: number, dy: number) => fineClassAt(fine, Math.floor(wx + dx), Math.floor(wy + dy)) === FINE_LAND;
      if (!land(0, 0) || !land(-1.5, 0) || !land(1.5, 0) || !land(0, 1.2) || !land(0, -bh) || !land(-1.5, 1.2) || !land(1.5, 1.2)) continue;
      if (spots.some(([sx, sy]) => Math.abs(sx - hx) < bw && Math.abs(sy - hy) < bh)) continue;
      spots.push([hx, hy]);
    }
    if (spots.length === 0) continue;
    spots.sort((a, b) => a[1] - b[1]);
    // 先在小画布上画好（近的压住远的），再按 q 倍盖上去
    const reachPx = Math.ceil((reach * k) / q);
    const size = reachPx * 2 + box.w + 4;
    const sheet = new Px(size, size + box.h);
    for (const [hx, hy] of spots) drawHouse(sheet, Math.round((hx * k) / q) + size / 2, Math.round((hy * k) / q) + size / 2 + box.h, p.style, snowy);
    stamp(t, sheet, Math.round(tw.u * k - (size / 2) * q), Math.round(tw.v * k - (size / 2 + box.h) * q), q, true);
  }
}

/** 地标与奇观：图标按 k/2 倍居中压在所在的格上（格心在水里、旁边就是岸的挪到最近的陆上）。 */
function paintLandmarks(t: Tile) {
  const marks = t.ctx.input.landmarks;
  if (!marks || marks.length === 0) return;
  const { ctx, k, TW, TH, X0, Y0 } = t;
  const S = DETAIL_CELL;
  const wrap = ctx.input.wrapX === true;
  const q = Math.max(1, k >> 1);
  for (const m of marks) {
    let cx = Math.round((m.x + Math.max(1, m.w ?? 1) / 2) * S);
    let cy = Math.round((m.y + Math.max(1, m.h ?? 1) / 2) * S);
    // 先粗筛（挪到离瓦片最近的那一份后，离瓦片一格以外的不画：图标不到一格）
    if (wrap) cx += Math.round((t.F0x + t.TFw / 2 - cx) / (ctx.W * S)) * ctx.W * S;
    if (cx * k < X0 - S * k || cx * k > X0 + TW + S * k || cy * k < Y0 - S * k || cy * k > Y0 + TH + S * k) continue;
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
    const icon = drawLandmarkIcon(m.kind, m.category);
    const x = Math.round(cx * k - (icon.w * q) / 2);
    const y = Math.round(cy * k - (icon.h * q) / 2);
    if (x + icon.w * q < X0 || x > X0 + TW || y + icon.h * q < Y0 || y > Y0 + TH) continue;
    stamp(t, icon, x, y, q, false);
  }
}

/** 量各步耗时（审计脚本用；平时不记）。 */
export const hdProf: { on: boolean; t: Record<string, number> } = { on: false, t: {} };
let profAt = 0;
function prof(name: string) {
  if (!hdProf.on) return;
  const now = performance.now();
  hdProf.t[name] = (hdProf.t[name] ?? 0) + now - profAt;
  profAt = now;
}

/** 一块高清瓦片的字节数。 */
export function hdBytes(img: { w: number; h: number }): number {
  return img.w * img.h * 4;
}

/** 审计用：最近一块瓦片每个像素陆的覆盖率（行优先，长度至少是那块瓦片的像素数；下一块瓦片会覆盖它）。 */
export function lastLandCoverage(): Float32Array {
  return scratchF32("hd-landA", 1);
}
