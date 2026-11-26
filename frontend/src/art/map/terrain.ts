// 整张世界海图的位图（EXPANSION.md §10.4）：像一张手绘的航海图——
//   海面：大陆架的浅海带随海岸渐变、外海由蓝转深，沿海岸有几道平行的水线；海岸有浪花、崖壁、礁石、红树林与冰架；
//   陆地：按植被图层（biomes）着色，按高程图层（relief）做左上光源的地形晕渲，积雪线随高程、纬度与季节变化；
//         山体按高程成脉（峰画在局部高点、沿山脊排列）、丘陵、各植被带的树种与地表纹理；
//   河流：由细到宽的蜿蜒水线，入海处有河口或三角洲；
//   人文景观：地点周围的田地、村落与建筑（culture.ts），沿地形寻路的道路与桥；
//   地标与奇观（landmarks.ts）；经纬线、恒向线、罗盘玫瑰与画框。
// 缺少高程 / 植被图层时（旧数据、测试夹具）按海陆图推导（geo.ts）。四季改变树色、田色与积雪。
//
// 性能：格级字段先算好；逐像素只做双线性采样、少量预算好格点的噪声与查表；树、山、房屋等图元先收集，
// 再按底边排序绘制。地点先去重（同样的地点只处理一次），耗时与地点数基本无关。
import { P, ink } from "../palette";
import { Px, rgba, type Rgba } from "../px";
import { bayer, chamfer, hash2, jitterTable, mix, RowSampler, sampler, tileField } from "./noise";
import { drawCompassRose } from "./marks";
import { CHART_CELL, type ChartInput } from "./types";
import { latitudeAt, classicLatOf, southernAt } from "./projection";
import { cropColumns, padWrapInput, WRAP_MARGIN } from "./wrap";
import { blur3, coastPixels, geoLayers, SEA_VEG, VEG, VEG_COUNT, type CoastPx, type Geo } from "./geo";
import {
  FIR,
  MIRE,
  OLIVE,
  REED,
  SHRUB,
  TREE_ACACIA,
  TREE_BARE,
  TREE_BIG,
  TREE_CANOPY,
  TREE_CYPRESS,
  TREE_MANGROVE,
  TREE_OLIVE,
  TREE_PALM,
  TREE_PALM_SMALL,
  TREE_PINE,
  TREE_PINE_SMALL,
  TREE_PINE_TALL,
  TREE_ROUND,
  TREE_SMALL,
  TUFT,
  TUNDRA_TUFT,
  stampTree,
  treePalette,
  type TreePal,
} from "./flora";
import { FIELD, FieldPainter, chaikin, drawHouse, houseBox, planCulture, routeRoad, structureSprite, uniquePlaces, type CulturePlan, type Structure, type UPlace } from "./culture";
import { rasterStroke, riverStroke } from "./rivers";
import { paintLandmark } from "./landmarks";

const C = CHART_CELL;
const R = (c: string): Rgba => rgba(c);
const { ICE, TUNDRA, BOREAL, FOREST, GRASS, MEDIT, STEPPE, DESERT, SAVANNA, JUNGLE, WETLAND, ALPINE, VOLCANIC, ARCANE } = VEG;

/** 世界的标准行数（没有投影时纬度按它换算）。 */
const WORLD_ROWS = 170;

// ───────────────────────────── 配色 ─────────────────────────────

const ramp = (...c: string[]): Rgba[] => c.map(R);

/** 各植被的地面色阶（由暗到亮 5 阶，下标 2 为平地的主色），按季节。 */
export function groundRamps(season: number): Rgba[][] {
  const s = season;
  const L = P.leaf;
  const t: Rgba[][] = new Array(VEG_COUNT);
  t[ICE] = ramp(P.snow[0], P.snow[1], P.snow[2], P.snow[3], P.white);
  t[TUNDRA] =
    s === 2
      ? ramp(P.wood[1], mix(P.wood[1], P.stone[1], 0.35), mix(P.wood[2], P.stone[2], 0.45), mix(P.straw[1], P.stone[3], 0.45), mix(P.straw[2], P.stone[3], 0.4))
      : ramp(L[0], mix(L[1], P.stone[1], 0.5), mix(L[2], P.stone[2], 0.5), mix(L[3], P.stone[3], 0.45), mix(L[4], P.stone[4], 0.4));
  t[BOREAL] = ramp(L[0], FIR[0], FIR[1], mix(FIR[1], FIR[2], 0.5), FIR[2]);
  t[FOREST] =
    s === 2
      ? ramp(L[0], L[1], mix(L[2], P.autumn[1], 0.3), mix(L[3], P.autumn[2], 0.35), mix(L[4], P.autumn[3], 0.3))
      : s === 3
        ? ramp(P.wood[0], mix(L[1], P.wood[1], 0.5), mix(L[2], P.wood[2], 0.5), mix(L[3], P.wood[3], 0.45), mix(L[4], P.wood[4], 0.4))
        : ramp(L[0], L[1], L[2], mix(L[2], L[3], 0.5), L[3]);
  t[GRASS] =
    s === 2
      ? ramp(P.straw[0], P.straw[1], mix(P.straw[2], L[3], 0.3), P.straw[2], P.straw[3])
      : s === 0
        ? ramp(L[1], L[2], L[3], mix(L[3], L[4], 0.5), L[4])
        : s === 3
          ? ramp(L[1], mix(L[2], P.straw[1], 0.4), mix(L[3], P.straw[1], 0.45), mix(L[3], P.straw[2], 0.5), P.straw[2])
          : ramp(L[1], L[2], mix(L[3], P.straw[2], 0.25), mix(L[4], P.straw[2], 0.35), mix(L[4], P.straw[3], 0.5));
  t[MEDIT] =
    s === 0 || s === 3
      ? ramp(OLIVE[0], OLIVE[1], mix(OLIVE[2], L[3], 0.4), OLIVE[3], mix(OLIVE[3], P.sand[4], 0.4))
      : ramp(OLIVE[0], OLIVE[1], OLIVE[2], mix(OLIVE[3], P.sand[3], 0.35), P.sand[4]);
  t[STEPPE] =
    s === 0
      ? ramp(mix(P.straw[0], L[1], 0.5), mix(P.straw[1], L[2], 0.4), mix(P.straw[2], L[3], 0.35), P.straw[3], P.sand[4])
      : ramp(P.straw[0], P.straw[1], P.straw[2], mix(P.straw[2], P.straw[3], 0.5), P.straw[3]);
  t[DESERT] = ramp(P.sand[2], P.sand[3], mix(P.sand[3], P.sand[4], 0.55), P.sand[4], mix(P.sand[4], P.white, 0.45));
  t[SAVANNA] =
    s === 0
      ? ramp(L[1], mix(L[2], P.straw[1], 0.4), mix(L[3], P.straw[2], 0.45), mix(L[4], P.straw[3], 0.5), P.straw[3])
      : ramp(mix(P.straw[0], L[1], 0.4), P.straw[1], mix(P.straw[2], P.straw[1], 0.3), P.straw[2], P.straw[3]);
  t[JUNGLE] = ramp(P.jade[0], P.jade[1], P.jade[2], mix(P.jade[2], L[3], 0.5), mix(P.jade[3], L[4], 0.5));
  t[WETLAND] = ramp(P.jade[0], MIRE[0], MIRE[1], MIRE[2], mix(MIRE[2], L[4], 0.5));
  t[ALPINE] = ramp(P.stone[0], P.stone[1], P.stone[2], P.stone[3], P.stone[4]);
  t[VOLCANIC] = ramp(ink.deep, P.stone[0], mix(P.stone[0], P.stone[1], 0.5), P.stone[1], P.stone[2]);
  t[ARCANE] = ramp(P.cloth.purple[0], P.cloth.purple[1], mix(P.cloth.purple[2], P.teal[2], 0.5), mix(P.teal[3], P.cloth.purple[2], 0.3), P.teal[4]);
  return t;
}
export const SNOW_RAMP = ramp(P.snow[0], P.snow[1], P.snow[2], P.snow[3], P.white);

/** 积雪线（高程等级）：按季节与纬度（北低南高）。 */
const SNOW_BASE = [8.0, 9.0, 8.5, 6.0];
const SNOW_LAT = [0.06, 0.045, 0.055, 0.11];
export function snowLevel(season: number, lat: number): number {
  return SNOW_BASE[season] + (lat - 85) * SNOW_LAT[season];
}
/** 各植被的积雪修正：干热地区更难积雪，冻原更容易。 */
export function snowBias(v: number, season: number): number {
  switch (v) {
    case ICE:
      return -99;
    case TUNDRA:
      return season === 1 ? 0 : -2;
    case DESERT:
    case SAVANNA:
    case JUNGLE:
      return 3;
    case MEDIT:
    case STEPPE:
      return 1.5;
    case VOLCANIC:
      return 1;
    case ARCANE:
      return 99;
    default:
      return 0;
  }
}

/** 山的配色（受光面在左）。 */
interface RockPal {
  hi: string;
  light: string;
  dark: string;
  deep: string;
  line: string;
}
const ROCK: Record<"stone" | "sand" | "jade" | "basalt" | "crystal", RockPal> = {
  stone: { hi: P.stone[4], light: P.stone[3], dark: P.stone[2], deep: P.stone[1], line: P.stone[0] },
  // 沙漠里的山：赭红的裸岩（不是沙色的小土堆）
  sand: { hi: P.sand[3], light: P.wood[3], dark: P.wood[2], deep: P.wood[1], line: P.wood[0] },
  jade: { hi: P.leaf[4], light: P.jade[3], dark: P.jade[2], deep: P.jade[1], line: P.jade[0] },
  basalt: { hi: P.stone[2], light: P.stone[1], dark: P.stone[0], deep: ink.deep, line: ink.deep },
  crystal: { hi: P.teal[4], light: P.teal[3], dark: P.cloth.purple[1], deep: P.cloth.purple[0], line: P.cloth.purple[0] },
};

function rockPal(v: number): RockPal {
  switch (v) {
    case DESERT:
    case STEPPE:
    case SAVANNA:
      return ROCK.sand;
    case JUNGLE:
    case WETLAND:
      return ROCK.jade;
    case VOLCANIC:
      return ROCK.basalt;
    case ARCANE:
      return ROCK.crystal;
    default:
      return ROCK.stone;
  }
}

/** 丘陵的配色。 */
interface HillPal {
  light: string;
  mid: string;
  dark: string;
  line: string;
}
function hillPal(v: number, season: number, snowy: boolean): HillPal {
  if (snowy || v === ICE) return { light: P.snow[3], mid: P.snow[2], dark: P.snow[1], line: P.snow[0] };
  switch (v) {
    case DESERT:
    case STEPPE:
      return { light: P.straw[3], mid: P.sand[3], dark: P.sand[2], line: P.sand[1] };
    case SAVANNA:
      return { light: P.straw[3], mid: P.straw[2], dark: P.straw[1], line: P.straw[0] };
    case JUNGLE:
    case WETLAND:
      return { light: P.leaf[4], mid: P.jade[3], dark: P.jade[2], line: P.jade[1] };
    case MEDIT:
      return { light: OLIVE[3], mid: OLIVE[2], dark: OLIVE[1], line: OLIVE[0] };
    case TUNDRA:
      return { light: P.stone[4], mid: mix(P.stone[3], P.leaf[3], 0.3), dark: P.stone[2], line: P.stone[1] };
    case BOREAL:
      return { light: FIR[2], mid: FIR[1], dark: FIR[0], line: P.leaf[0] };
    case ALPINE:
    case VOLCANIC:
      return { light: P.stone[3], mid: P.stone[2], dark: P.stone[1], line: P.stone[0] };
    case GRASS:
      return season === 2
        ? { light: P.straw[3], mid: P.straw[2], dark: P.straw[1], line: P.straw[0] }
        : { light: P.leaf[4], mid: mix(P.leaf[3], P.straw[2], 0.25), dark: P.leaf[2], line: P.leaf[1] };
    default:
      return { light: P.leaf[4], mid: P.leaf[3], dark: P.leaf[2], line: P.leaf[1] };
  }
}

/** 山：底边中点 (bx, by)，半宽 hw，高 h。左侧受光，右侧背光，山顶积雪 snow 行；big 时右侧带一座矮一些的肩峰。 */
function mountain(p: Px, bx: number, by: number, hw: number, h: number, pal: RockPal, snow: number, seed: number, big: boolean) {
  if (big) mountain(p, bx + hw - 1, by, Math.max(2, hw - 2), Math.max(3, h - 3), pal, Math.max(0, snow - 2), seed + 1, false);
  const top = by - h + 1;
  const drift = hash2(bx, by, seed) < 0.5 ? 1 : 2;
  for (let r = 0; r < h; r++) {
    const y = top + r;
    const half = Math.max(0, Math.round(((r + 0.6) / h) * hw));
    const ridge = bx + Math.floor((r * drift) / h / 1.5);
    for (let x = bx - half; x <= bx + half; x++) {
      let c: string;
      const edge = x === bx - half || x === bx + half;
      const snowLine = snow + (hash2(x, seed, 7) < 0.45 ? 1 : 0);
      if (edge) c = pal.line;
      else if (r < snowLine) c = x < ridge ? P.snow[3] : x === ridge ? P.snow[2] : P.snow[1];
      else if (x < ridge) c = x === bx - half + 1 ? pal.hi : pal.light;
      else if (x === ridge) c = pal.light;
      else c = x >= bx + half - 1 ? pal.deep : pal.dark;
      if (r === 0) c = pal.line;
      p.set(x, y, c);
    }
  }
  p.set(bx, top - 1, pal.line);
  p.hline(bx - hw + 1, bx + hw + 1, by + 1, "#1a142333");
}

/**
 * 火山：截顶的圆锥（高 h 像素，越高越宽），左侧受光、右侧背光，山腰两道凹下去的冲沟；
 * 火山口里是熔岩，一道熔岩流顺着一侧山坡流下；锥顶冒一缕烟；冬季高的火山顶积雪。
 */
function volcano(p: Px, bx: number, by: number, season: number, h = 8, seed = 0, snowy = false) {
  const hw = Math.round(h * 0.72);
  const top = by - h + 1;
  const flowSide = hash2(bx, by, seed + 1) < 0.5 ? -1 : 1;
  for (let r = 0; r < h; r++) {
    const half = 1 + Math.round((r / h) * (hw - 1));
    const y = top + r;
    for (let x = bx - half; x <= bx + half; x++) {
      const edge = x === bx - half || x === bx + half;
      const rel = (x - bx) / Math.max(1, half);
      let c: string = rel < -0.35 ? P.stone[2] : rel < 0.15 ? P.stone[1] : P.stone[0];
      // 冲沟：两道比两侧暗一阶的竖线
      if (r > 2 && (x === bx - Math.round(half * 0.55) || x === bx + Math.round(half * 0.4))) c = rel < 0 ? P.stone[1] : ink.deep;
      if (snowy && r < Math.ceil(h * 0.3)) c = rel < 0 ? P.snow[3] : P.snow[1];
      p.set(x, y, edge ? ink.deep : c);
    }
  }
  // 火山口与熔岩流
  p.hline(bx - 1, bx + 1, top, ink.deep).set(bx, top, P.red[2]);
  p.set(bx - 1, top + 1, P.red[1]).set(bx, top + 1, P.lamp[1]).set(bx + 1, top + 1, P.red[1]);
  let fx = bx + flowSide;
  for (let r = 2; r < h - 1; r++) {
    if (hash2(r, bx, seed + 2) < 0.55) fx += flowSide;
    const half = 1 + Math.round((r / h) * (hw - 1));
    if (Math.abs(fx - bx) >= half) break;
    p.set(fx, top + r, r % 3 === 0 ? P.lamp[1] : P.red[2]);
  }
  const smoke = season === 3 ? P.snow[2] : P.stone[3];
  p.set(bx, top - 2, smoke).set(bx + 1, top - 3, smoke).set(bx - 1, top - 4, P.stone[4]).set(bx + 1, top - 5, P.stone[4]).set(bx, top - 6, P.stone[4]);
  p.hline(bx - hw, bx + hw + 1, by + 1, "#1a142333");
}

/** 丘陵：半圆形的土包（左亮右暗）。 */
function hill(p: Px, bx: number, by: number, hw: number, h: number, pal: HillPal) {
  for (let r = 0; r < h; r++) {
    const y = by - h + 1 + r;
    const k = (h - r) / h;
    const half = Math.max(1, Math.round(hw * Math.sqrt(Math.max(0, 1 - k * k * 0.85))));
    for (let x = bx - half; x <= bx + half; x++) {
      const edge = x === bx - half || x === bx + half || r === 0;
      const rel = (x - bx) / half;
      let c = rel < -0.25 ? pal.light : rel < 0.35 ? pal.mid : pal.dark;
      if (edge) c = pal.line;
      p.set(x, y, c);
    }
  }
}

// ───────────────────────────── 海岸类型 ─────────────────────────────

/** 海岸类型：沙滩、礁岩、悬崖、红树林、冰架、黑沙（火山）。 */
const COAST = { SAND: 0, ROCK: 1, CLIFF: 2, MANGROVE: 3, ICE: 4, BLACK: 5 } as const;

function hardBias(v: number): number {
  switch (v) {
    case ALPINE:
      return 3;
    case TUNDRA:
    case BOREAL:
    case ARCANE:
      return 1;
    case VOLCANIC:
      return 1.5;
    case MEDIT:
      return 0.6;
    case FOREST:
      return 0.3;
    case GRASS:
      return -0.3;
    case DESERT:
    case SAVANNA:
    case JUNGLE:
      return -1;
    default:
      return 0;
  }
}

function coastType(v: number, r: number, x: number, y: number): number {
  if (v === ICE) return COAST.ICE;
  if (v === VOLCANIC) return COAST.BLACK;
  if (v === WETLAND || (v === JUNGLE && r <= 1)) return COAST.MANGROVE;
  const hard = r + hardBias(v) + (hash2(x >> 1, y >> 1, 1701) - 0.5) * 1.6;
  if (hard >= 3.2) return COAST.CLIFF;
  if (hard >= 2) return COAST.ROCK;
  return COAST.SAND;
}

// ───────────────────────────── 整张海图 ─────────────────────────────

/** 画海图时的分析图层（测试用）：每像素的海陆、河流、人文景观与道路。 */
export interface ChartLayers {
  px: Px;
  geo: Geo;
  coast: CoastPx;
  /** 1 河水 */
  river: Uint8Array;
  /** 1 田地、2 房屋与建筑 */
  culture: Uint8Array;
  /** 1 路面、2 桥 */
  road: Uint8Array;
}

/** 各绘制步骤共用的数据（每一步拆成一个函数，V8 能各自优化）。 */
interface Ctx {
  input: ChartInput;
  season: number;
  winter: boolean;
  geo: Geo;
  coast: CoastPx;
  W: number;
  H: number;
  N: number;
  PW: number;
  PH: number;
  NP: number;
  out: Px;
  data: Uint32Array;
  /**
   * 像素行 → 换算到 170 行世界的纬度刻度。没有投影时为 py·170/H/CELL（与旧代码逐位相同）；
   * 有投影时按真实纬度换算（projection.ts 的 classicLatOf，南北半球对称）。
   */
  latPx: (py: number) => number;
  /** 像素行所在半球的季节（南半球与北半球相反；没有投影时就是 season）：积雪线与河面结冰用 */
  seasonPx: (py: number) => number;
  rows: RowSampler;
  /** 海格也带上最近陆格的植被、高程与海岸类型（海岸噪声把陆地推进海格时用） */
  vegN: Uint8Array;
  relN: Uint8Array;
  coastT: Uint8Array;
  /** 环绕地图补出的列数（格）：装饰避开补边、画框只画上下两边；不环绕时为 0 */
  padX: number;
  /** 每个陆格所在陆块的大小（格，八连通），海格为 0 */
  comp: Int32Array;
  /** 窄水道的海格（两岸在上下或左右紧挨着）：不画浪花与崖壁，只画深色的水面中线 */
  narrow: Uint8Array;
  /** 像素的高程、植被、积雪、冰架 */
  hp: Float32Array;
  vegPx: Uint8Array;
  snowPx: Uint8Array;
  shelfIce: Uint8Array;
  culture: Uint8Array;
  river: Uint8Array;
  riverCell: Uint8Array;
  road: Uint8Array;
  /** 图元（树、山、房屋）不可落脚的像素 */
  clear: Uint8Array;
  jit: { x: Int8Array; y: Int8Array };
  /** 植被交界的扭曲（平滑噪声，±4 像素）：交界成不规则的斑块，而不是有序抖动的棋盘格 */
  warpA: (x: number, y: number) => number;
  warpB: (x: number, y: number) => number;
}

/**
 * 画整张海图（宽 width·CELL、高 height·CELL）。东西相连的地图（wrapX）左右各补 WRAP_MARGIN 列画完再裁掉，
 * 接缝两侧连续（见 wrap.ts）。
 */
export function paintChart(input: ChartInput, season: number): Px {
  if (input.wrapX && input.width > 2 * WRAP_MARGIN) {
    const padded = paintChartLayers(padWrapInput(input, WRAP_MARGIN), season, WRAP_MARGIN).px;
    return cropColumns(padded, WRAP_MARGIN * C, input.width * C);
  }
  return paintChartLayers(input, season).px;
}

/** 画整张海图，并返回各分析图层。padX 为环绕地图补出的列数（由 paintChart 给出；补边后的输入不再环绕）。 */
export function paintChartLayers(input: ChartInput, season: number, padX = 0): ChartLayers {
  const geo = geoLayers(input);
  const coast = coastPixels(geo, input);
  const { W, H } = geo;
  const { PW, PH } = coast;
  const N = W * H;
  const NP = PW * PH;
  const out = new Px(PW, PH);
  const ctx: Ctx = {
    input,
    season,
    winter: season === 3,
    geo,
    coast,
    W,
    H,
    N,
    PW,
    PH,
    NP,
    out,
    data: out.data,
    ...latitudeFns(input, season, H),
    padX,
    rows: new RowSampler(W, H, C),
    vegN: new Uint8Array(N).fill(SEA_VEG),
    relN: new Uint8Array(N),
    coastT: new Uint8Array(N),
    comp: landComponents(geo.terr, W, H),
    narrow: new Uint8Array(0),
    hp: new Float32Array(NP),
    vegPx: new Uint8Array(NP),
    snowPx: new Uint8Array(NP),
    shelfIce: new Uint8Array(NP),
    culture: new Uint8Array(NP),
    river: new Uint8Array(NP),
    riverCell: new Uint8Array(N),
    road: new Uint8Array(NP),
    clear: new Uint8Array(NP),
    jit: jitterTable(1),
    warpA: tileField(256, 9, 1657),
    warpB: tileField(256, 9, 1663),
  };
  ctx.narrow = narrowWater(geo.terr, ctx.comp, W, H);
  nearLand(ctx);
  pixelElevation(ctx);
  paintSea(ctx);
  paintGround(ctx);
  paintCoast(ctx);
  const places = uniquePlaces(input.places ?? [], input);
  const plan = planCulture(geo, places, C, input.rivers ?? []);
  paintFields(ctx, plan);
  paintRivers(ctx);
  const extra = paintRoads(ctx);
  markReserved(ctx, places);
  placeGlyphs(ctx, plan, extra);
  const lctx = { out, isLand: (x: number, y: number) => x >= 0 && y >= 0 && x < PW && y < PH && coast.land[y * PW + x] === 1, cell: C };
  for (const l of input.landmarks ?? []) paintLandmark(lctx, l.kind, l.category, l.x, l.y, Math.max(1, l.w ?? 1), Math.max(1, l.h ?? 1));
  paintDecor(ctx, places);
  return { px: out, geo, coast, river: ctx.river, culture: ctx.culture, road: ctx.road };
}

/** 纬度与半球季节的取值函数（见 Ctx.latPx、Ctx.seasonPx）。 */
function latitudeFns(input: ChartInput, season: number, H: number): Pick<Ctx, "latPx" | "seasonPx"> {
  const p = input.projection;
  if (!p) {
    const latScale = WORLD_ROWS / Math.max(1, H) / C;
    return { latPx: (py) => py * latScale, seasonPx: () => season };
  }
  const opposite = (season + 2) % 4;
  return {
    latPx: (py) => classicLatOf(latitudeAt(p, py / C)),
    seasonPx: (py) => (southernAt(input, py / C) ? opposite : season),
  };
}

/** 像素 → 按平滑噪声扭曲（±4 像素）再加 ±1 像素有序抖动后取的格：植被交界是不规则的斑块与指状伸出，不是棋盘格。 */
function jitterCell(ctx: Ctx, px: number, py: number): number {
  const k = (py & 3) * 4 + (px & 3);
  let gx = Math.floor((px + ctx.jit.x[k] + (ctx.warpA(px, py) - 0.5) * 9) / C);
  let gy = Math.floor((py + ctx.jit.y[k] + (ctx.warpB(px, py) - 0.5) * 9) / C);
  gx = gx < 0 ? 0 : gx >= ctx.W ? ctx.W - 1 : gx;
  gy = gy < 0 ? 0 : gy >= ctx.H ? ctx.H - 1 : gy;
  return gy * ctx.W + gx;
}

/** 离像素 (px, py) 最近的陆格（在像素所在格周围 5×5 格里找；没有时为 −1）。窄海峡两岸各取各的。 */
function nearestLandCell(ctx: Ctx, px: number, py: number): number {
  const { W, H } = ctx;
  const terr = ctx.geo.terr;
  const gx = Math.floor(px / C);
  const gy = Math.floor(py / C);
  let best = -1;
  let bd = Infinity;
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const x = gx + dx;
      const y = gy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H || terr[y * W + x] !== 2) continue;
      // 到格子方块（而不是格中心）的距离
      const ex = Math.max(x * C - px - 0.5, 0, px + 0.5 - (x + 1) * C);
      const ey = Math.max(y * C - py - 0.5, 0, py + 0.5 - (y + 1) * C);
      const d = ex * ex + ey * ey;
      if (d < bd) {
        bd = d;
        best = y * W + x;
      }
    }
  return best;
}

/** 海格的“近旁陆地”：离陆地 2 格以内的海格取最近陆格的植被与高程；再按格定海岸类型。 */
function nearLand(ctx: Ctx) {
  const { W, H, N, vegN, relN, coastT } = ctx;
  const { terr, relief, veg, seaDist } = ctx.geo;
  for (let i = 0; i < N; i++) {
    if (terr[i] === 2) {
      vegN[i] = veg[i];
      relN[i] = relief[i];
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (terr[i] === 2 || seaDist[i] > 2.5) continue;
      let found = -1;
      for (let r = 1; r <= 2 && found < 0; r++)
        for (let dy = -r; dy <= r && found < 0; dy++)
          for (let dx = -r; dx <= r && found < 0; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < W && yy < H && terr[yy * W + xx] === 2) found = yy * W + xx;
          }
      if (found >= 0) {
        vegN[i] = veg[found];
        relN[i] = relief[found];
      }
    }
  }
  for (let i = 0; i < N; i++) if (vegN[i] !== SEA_VEG) coastT[i] = coastType(vegN[i], relN[i], i % W, Math.floor(i / W));
  // 只有 1–3 格的小岛（礁岩、海蚀柱）画成岩石
  for (let i = 0; i < N; i++) if (terr[i] === 2 && ctx.comp[i] <= 3) coastT[i] = COAST.ROCK;
}

/** 像素的高程：格高程模糊后双线性插值；丘陵与山地叠加山脊状的细节（地形晕渲出沟壑）。 */
function pixelElevation(ctx: Ctx) {
  const { W, H, N, PW, PH, hp, rows } = ctx;
  const { terr, relief } = ctx.geo;
  const land = ctx.coast.land;
  const relF = new Float32Array(N);
  for (let i = 0; i < N; i++) relF[i] = terr[i] === 2 ? relief[i] + 0.6 : -0.8;
  const relB = blur3(relF, W, H);
  const nDetail = tileField(256, 7, 1601);
  const rowA = new Float64Array(PW);
  for (let py = 0; py < PH; py++) {
    rows.row(relB, py, rowA);
    const row = py * PW;
    for (let px = 0; px < PW; px++) {
      const i = row + px;
      if (!land[i]) continue;
      const base = rowA[px];
      if (base < 2.2) {
        hp[i] = base > 0 ? base : 0;
        continue;
      }
      const ridged = 1 - Math.abs(nDetail(px, py) - 0.5) * 2;
      hp[i] = base + (ridged - 0.55) * (base - 2.2) * 0.22;
    }
  }
}

/**
 * 海面按“水深”着色，而不是按离岸距离画一圈圈等宽的色带：
 *   格级的陆架坐标 s——浅海格为负（离陆架外缘越远越负），深海格为正（离陆架越远越大）——做两遍平滑（约 5×5 格），
 *   逐像素在扭曲后的坐标上取值（陆架外缘因此是弯曲的舌状，不是逐格的阶梯），再按 s 分成：
 *   近岸浅水（只在陆架上、宽 1–4 像素且随噪声断续）→ 陆架 → 陆坡（陆架外缘外的一道过渡色）→ 深海。
 *   陡岸与火山岛弧（深海贴岸）外只有一道窄窄的陆坡色，不再套光环；
 *   水线只沿大陆与大岛（≥ 30 格）的陆架画一道、被噪声打断，小岛不画；外海零星的浪纹。
 */
function paintSea(ctx: Ctx) {
  const { W, H, N, PW, PH, data, out } = ctx;
  const { terr } = ctx.geo;
  const { land, outDist } = ctx.coast;
  const sea = P.sea.map(R);
  const toDeep = chamfer(W, H, (i) => terr[i] === 0);
  const toShelf = chamfer(W, H, (i) => terr[i] !== 0);
  const s = new Float32Array(N);
  for (let i = 0; i < N; i++) s[i] = terr[i] === 0 ? Math.min(12, toShelf[i] - 0.5) : terr[i] === 1 ? -Math.min(4, toDeep[i] - 0.5) : -3;
  const sb = blur3(blur3(s, W, H), W, H);
  const samp = sampler(sb, W, H, C);
  const warpA = tileField(512, 26, 1613);
  const warpB = tileField(512, 26, 1617);
  const fine = tileField(256, 7, 1619);
  const nNear = tileField(256, 11, 1623);
  const nLine = tileField(512, 30, 1629);
  const nDash = tileField(256, 9, 1637);
  // 陆块大小（格，八连通）：水线只沿大陆与大岛画
  const comp = ctx.comp;
  for (let py = 0; py < PH; py++) {
    for (let px = 0; px < PW; px++) {
      const i = py * PW + px;
      if (land[i]) continue;
      const d = outDist[i];
      const v = samp(px + (warpA(px, py) - 0.5) * 12, py + (warpB(px, py) - 0.5) * 12) + (fine(px, py) - 0.5) * 0.45;
      const b = bayer(px, py);
      let tone: number;
      // 交界处只在很窄的一带里抖动
      if (v < -0.12) tone = 3;
      else if (v < 0.12) tone = (v + 0.12) / 0.24 > b ? 2 : 3;
      else if (v < 1.05) tone = 2;
      else if (v < 1.35) tone = (v - 1.05) / 0.3 > b ? 1 : 2;
      else tone = 1;
      // 近岸浅水：只在陆架上，宽度随噪声 1–4 像素变化
      if (v < 0 && d <= 1 + 3.2 * nNear(px, py) * nNear(px, py) * 2) tone = 4;
      data[i] = sea[tone];
    }
  }
  // 水线：陆架上离岸 5–8 像素（随低频噪声起伏）的一道亮线，被噪声打断；只沿大陆与 ≥ 30 格的岛
  for (let py = 0; py < PH; py++) {
    for (let px = 0; px < PW; px++) {
      const i = py * PW + px;
      if (land[i]) continue;
      const d = outDist[i];
      if (d < 4 || d > 9) continue;
      const d0 = 5 + 3 * nLine(px, py);
      if (Math.abs(d - d0) >= 0.5 || nDash(px, py) < 0.42) continue;
      if (data[i] !== sea[3]) continue;
      const k = nearestLandCell(ctx, px, py);
      if (k < 0 || comp[k] < 30) continue;
      data[i] = sea[4];
    }
  }
  const WAVE = [".xx..", "x..xx"];
  for (let gy = 0; gy * 9 < PH; gy++) {
    for (let gx = 0; gx * 14 < PW; gx++) {
      const x = gx * 14 + (gy % 2) * 7 + Math.floor(hash2(gx, gy, 51) * 9) - 4;
      const y = gy * 9 + Math.floor(hash2(gx, gy, 52) * 5);
      if (hash2(gx, gy, 53) < 0.5) continue;
      if (x < 2 || y < 2 || x + 6 >= PW || y + 3 >= PH) continue;
      if (outDist[y * PW + x] < 9 || outDist[y * PW + x + 5] < 9) continue;
      if (data[y * PW + x] !== sea[1]) continue;
      out.stamp(WAVE, { x: P.sea[2] }, x, y);
    }
  }
}

/** 窄水道：海格的上下或左右两侧都是像样的陆地（≥ 8 格的陆块；1 格宽的溺谷、峡湾、海峡），礁岩之间的缝不算。 */
function narrowWater(terr: Uint8Array, comp: Int32Array, W: number, H: number): Uint8Array {
  const m = new Uint8Array(W * H);
  const L = (x: number, y: number) => x < 0 || y < 0 || x >= W || y >= H || (terr[y * W + x] === 2 && comp[y * W + x] >= 8);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (terr[y * W + x] === 2) continue;
      if ((L(x - 1, y) && L(x + 1, y)) || (L(x, y - 1) && L(x, y + 1))) m[y * W + x] = 1;
    }
  return m;
}

/** 每个陆格所在陆块的大小（格，八连通）；海格为 0。 */
function landComponents(terr: Uint8Array, W: number, H: number): Int32Array {
  const size = new Int32Array(W * H);
  const id = new Int32Array(W * H).fill(-1);
  const stack: number[] = [];
  const members: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (terr[s] !== 2 || id[s] >= 0) continue;
    members.length = 0;
    stack.push(s);
    id[s] = s;
    while (stack.length > 0) {
      const c = stack.pop() as number;
      members.push(c);
      const x = c % W;
      const y = (c - x) / W;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          if (terr[j] !== 2 || id[j] >= 0) continue;
          id[j] = s;
          stack.push(j);
        }
    }
    for (const m of members) size[m] = members.length;
  }
  return size;
}

/** 陆地底色：植被色阶 + 左上光源的地形晕渲 + 地表纹理 + 积雪（积雪线随高程、纬度与季节）。 */
function paintGround(ctx: Ctx) {
  const { W, PW, PH, data, hp, vegPx, snowPx, vegN, season, winter, latPx, seasonPx } = ctx;
  const land = ctx.coast.land;
  const terr = ctx.geo.terr;
  const ramps = groundRamps(season);
  const nGround = tileField(256, 6, 1621);
  const nSnow = tileField(256, 5, 1627);
  const nPool = tileField(256, 7, 1631);
  const lavaA = R(P.red[2]);
  const lavaB = R(P.lamp[1]);
  const spark = [R(P.teal[4]), R(P.white), R(P.cloth.purple[2])];
  const pool = R(winter ? P.snow[1] : P.teal[1]);
  const poolLite = R(winter ? P.snow[3] : P.teal[2]);
  const mud = R(P.wood[1]);
  const crevasse = R(P.snow[0]);
  const lichen = R(season === 2 ? P.autumn[1] : P.straw[2]);
  const speck = R(P.straw[3]);
  const bias = new Float64Array(VEG_COUNT);
  for (let v = 0; v < VEG_COUNT; v++) bias[v] = snowBias(v, season);
  for (let py = 0; py < PH; py++) {
    const sl = snowLevel(seasonPx(py), latPx(py));
    const ownRow = Math.floor(py / C) * W;
    for (let px = 0; px < PW; px++) {
      const i = py * PW + px;
      if (!land[i]) continue;
      // 抖动取到的格是海格时（窄海峡对岸的植被可能不同），改取离这个像素最近的陆格
      const g = jitterCell(ctx, px, py);
      let v: number;
      if (terr[g] === 2) v = vegN[g];
      else {
        const own = ownRow + Math.floor(px / C);
        const k = terr[own] === 2 ? own : nearestLandCell(ctx, px, py);
        v = k >= 0 ? vegN[k] : GRASS;
      }
      vegPx[i] = v;
      const h = hp[i];
      // 左上光源的晕渲：坡度按 ±5 像素（约 2.5 格）的高差算，平原上的大起伏（台地、河谷）也读得出来
      const at = (dx: number, dy: number) => {
        const x = px + dx;
        const y = py + dy;
        if (x < 0 || y < 0 || x >= PW || y >= PH) return h;
        const j = y * PW + x;
        return land[j] ? hp[j] : Math.min(h, hp[j]) - 0.3;
      };
      const gx = at(5, 0) - at(-5, 0);
      const gy = at(0, 5) - at(0, -5);
      const gain = h >= 3 ? 0.7 : 0.38;
      // 河谷：比周围 ±9 像素的平均低就压暗一点
      const around = (at(9, 0) + at(-9, 0) + at(0, 9) + at(0, -9)) * 0.25;
      const valley = h < around - 0.25 ? Math.max(-0.55, (h - around + 0.25) * 0.7) : 0;
      const shade = (gx + gy) * gain + valley;
      const n = nGround(px, py);
      const se = sl + bias[v];
      let snowy = v === ICE;
      if (!snowy && h > se - 0.8) snowy = h + (nSnow(px, py) - 0.5) * 0.9 > se;
      if (snowy) snowPx[i] = 1;
      const rp = snowy ? SNOW_RAMP : ramps[v];
      let L = 2 + shade + (n - 0.5) * 0.5 + (bayer(px, py) - 0.5) * 0.35;
      L = L < 0 ? 0 : L > 4 ? 4 : L;
      let c = rp[Math.round(L)];
      if (!snowy) {
        switch (v) {
          case VOLCANIC:
            if (n > 0.7 && hash2(px, py >> 1, 1641) < 0.18) c = hash2(px, py, 1642) < 0.5 ? lavaA : lavaB;
            break;
          case ARCANE:
            if (hash2(px, py, 1643) < 0.012) c = spark[Math.floor(hash2(px, py, 1644) * 3)];
            break;
          case WETLAND: {
            const w = nPool(px, py);
            if (w > 0.63) c = (px + py) % 3 === 0 ? poolLite : pool;
            else if (w > 0.6) c = mud;
            break;
          }
          case TUNDRA:
            if (hash2(px >> 1, py, 1645) < 0.04) c = lichen;
            break;
          case GRASS:
          case STEPPE:
          case SAVANNA:
            if (hash2(px, py >> 1, 1646) < 0.035) c = speck;
            break;
        }
      } else if (v === ICE && Math.abs(nPool(px, py) - 0.5) < 0.012 && h > 0.8) c = crevasse;
      data[i] = c;
    }
  }
}

/**
 * 海岸：沙滩、礁岩、悬崖、红树林、冰架、黑沙；其余是浪花。只看海岸带的格。
 * 悬崖沿平滑后的海岸轮廓（像素距离场）描：崖壁按海岸朝向的法线投在海面上，朝南（朝向看图的人）的厚、朝北的只剩一道暗线，
 * 拐角自然倒圆，崖顶一像素的岩线带随机凹凸；崖脚的浪花断断续续。窄水道（1 格宽）里不画浪花与崖壁，只画深色的水面中线。
 * 1–3 格的小岛（礁岩、海蚀柱）整块画成岩石。
 */
function paintCoast(ctx: Ctx) {
  const { W, N, PW, PH, data, vegPx, snowPx, coastT, relN, shelfIce, comp, narrow } = ctx;
  const { terr, landDist, seaDist } = ctx.geo;
  const { land, inDist, outDist } = ctx.coast;
  const sea1 = R(P.sea[1]);
  const sea2 = R(P.sea[2]);
  const sea4 = R(P.sea[4]);
  const foam = R(P.foam);
  const beach = R(P.sand[4]);
  const beachDark = R(P.sand[3]);
  const rockA = R(P.stone[3]);
  const rockB = R(P.stone[2]);
  const rockTop = R(P.stone[4]);
  const cliffFace = R(P.stone[2]);
  const cliffDeep = R(P.stone[1]);
  const cliffLine = R(P.stone[0]);
  const mangA = R(P.jade[1]);
  const mangB = R(P.leaf[2]);
  const mangTop = R(P.leaf[3]);
  const iceA = R(P.snow[3]);
  const iceB = R(P.snow[2]);
  const iceEdge = R(P.snow[1]);
  const blackA = R(P.stone[0]);
  const blackB = R(P.stone[1]);
  const nIce = tileField(256, 8, 1651);
  const od = (x: number, y: number, fallback: number) => (x < 0 || y < 0 || x >= PW || y >= PH ? fallback : outDist[y * PW + x]);
  for (let cell = 0; cell < N; cell++) {
    // 只看海岸带的格（离海岸 2 格以内的陆格、3 格以内的海格）
    if (terr[cell] === 2 ? landDist[cell] > 2 && comp[cell] > 3 : seaDist[cell] > 3) continue;
    const cx0 = (cell % W) * C;
    const cy0 = Math.floor(cell / W) * C;
    const landCell = terr[cell] === 2;
    const tiny = landCell && comp[cell] <= 3;
    for (let k = 0; k < C * C; k++) {
      const px = cx0 + (k % C);
      const py = cy0 + Math.floor(k / C);
      const i = py * PW + px;
      // 海格里的像素：海岸类型取离它最近的陆格（窄海峡两岸各是各的）
      let src = cell;
      if (!landCell) {
        const k2 = nearestLandCell(ctx, px, py);
        if (k2 >= 0) src = k2;
      }
      const ct = coastT[src];
      const soft = relN[src] <= 1;
      if (land[i]) {
        const d = inDist[i];
        if (tiny) {
          // 礁岩：受光的左上亮、右下暗
          data[i] = d <= 1 && hash2(px, py, 1660) < 0.5 ? rockB : py % 2 === 0 && px % 3 === 0 ? rockTop : rockA;
          continue;
        }
        if (d > 2.4) continue;
        // 窄水道两岸：一像素的岩线
        if (d <= 1 && narrowNear(ctx, px, py)) {
          data[i] = cliffDeep;
          continue;
        }
        switch (ct) {
          case COAST.SAND: {
            const v = vegPx[i];
            if (d <= 1) data[i] = snowPx[i] ? iceB : beach;
            else if (d <= 2 && soft && !snowPx[i] && (v === DESERT || v === SAVANNA || v === MEDIT || v === STEPPE || v === JUNGLE || v === GRASS)) data[i] = beachDark;
            break;
          }
          case COAST.ROCK:
            if (d <= 1) data[i] = hash2(px, py, 1661) < 0.5 ? rockA : rockB;
            break;
          case COAST.CLIFF:
            // 崖顶：一像素的岩线，随机凹凸
            if (d <= 1 || (d <= 2 && hash2(px, py, 1665) < 0.25)) data[i] = hash2(px >> 1, py, 1666) < 0.7 ? rockA : rockTop;
            break;
          case COAST.MANGROVE:
            if (d <= 2) data[i] = hash2(px >> 1, py, 1662) < 0.5 ? mangA : mangB;
            break;
          case COAST.ICE:
            if (d <= 1.5) data[i] = iceA;
            break;
          case COAST.BLACK:
            if (d <= 1) data[i] = blackA;
            else if (d <= 2) data[i] = blackB;
            break;
        }
      } else {
        const d = outDist[i];
        if (d > 7) continue;
        if (narrow[cell]) {
          // 窄水道：不画浪花，水面中线深一阶
          if (d >= 1.5) data[i] = sea1;
          else data[i] = sea2;
          continue;
        }
        if (ct === COAST.ICE) {
          // 冰架：从海岸伸进海里 2.5–7.5 像素，边缘一道冰崖，外侧一线暗水
          const edge = 2.5 + nIce(px, py) * 5;
          if (d <= edge) {
            data[i] = d > edge - 1 ? iceEdge : (px + py * 3) % 7 === 0 ? iceB : iceA;
            shelfIce[i] = 1;
          } else if (d <= edge + 1) data[i] = sea1;
          continue;
        }
        if (ct === COAST.MANGROVE && d <= 2.4 && nIce(px, py) > 0.42) {
          data[i] = py > 0 && land[i - PW] ? mangTop : hash2(px, py, 1663) < 0.6 ? mangA : mangB;
          continue;
        }
        if (ct === COAST.CLIFF) {
          // 海岸朝向：离岸距离场的梯度（指向海）；朝南、朝东的崖壁看得见
          const gx = od(px + 1, py, d) - od(px - 1, py, d);
          const gy = od(px, py + 1, d) - od(px, py - 1, d);
          const gl = Math.hypot(gx, gy) || 1;
          const face = Math.max(0, gy / gl) + 0.35 * Math.max(0, gx / gl);
          const t = 0.55 + 2.1 * face + (hash2(px, py >> 1, 1667) - 0.5) * 0.7;
          if (d <= t) {
            data[i] = face < 0.2 ? cliffLine : d <= t * 0.55 ? cliffFace : cliffDeep;
            continue;
          }
          // 崖脚的浪花：断续的点
          if (d <= t + 1.1 && hash2(px, py, 1668) < 0.45) data[i] = foam;
          continue;
        }
        if (d <= 1) data[i] = hash2(px >> 1, py >> 1, 1664) < (tiny || comp[src] <= 3 ? 0.55 : 0.8) ? foam : sea4;
      }
    }
  }
}

/** 像素 (px, py) 所在或紧挨的格是不是窄水道。 */
function narrowNear(ctx: Ctx, px: number, py: number): boolean {
  const gx = Math.floor(px / C);
  const gy = Math.floor(py / C);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = gx + dx;
      const y = gy + dy;
      if (x < 0 || y < 0 || x >= ctx.W || y >= ctx.H) continue;
      if (!ctx.narrow[y * ctx.W + x]) continue;
      // 只看离这个像素 2 像素以内的窄水道格
      const ex = Math.max(x * C - px, 0, px - (x + 1) * C + 1);
      const ey = Math.max(y * C - py, 0, py - (y + 1) * C + 1);
      if (ex <= 1 && ey <= 1) return true;
    }
  return false;
}

/** 田地：按平滑的噪声扭曲取格（边缘是干净的曲线，不抖动）；只看附近有田的格，离岸 1.5 像素以内留给海滩。 */
function paintFields(ctx: Ctx, plan: CulturePlan) {
  const { W, H, N, PW, PH, data, hp, snowPx, culture, season } = ctx;
  const { terr } = ctx.geo;
  const { land, inDist } = ctx.coast;
  const painter = new FieldPainter(season);
  const nearField = new Uint8Array(N);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (plan.field[y * W + x] === FIELD.NONE) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) nearField[yy * W + xx] = 1;
        }
    }
  const nWarpA = tileField(256, 7, 1691);
  const nWarpB = tileField(256, 7, 1693);
  for (let py = 0; py < PH; py++) {
    const cy = Math.floor(py / C);
    for (let px = 0; px < PW; px++) {
      const i = py * PW + px;
      if (!land[i] || inDist[i] <= 1.5 || !nearField[cy * W + Math.floor(px / C)]) continue;
      const gx = Math.max(0, Math.min(W - 1, Math.floor((px + (nWarpA(px, py) - 0.5) * 9) / C)));
      const gy = Math.max(0, Math.min(H - 1, Math.floor((py + (nWarpB(px, py) - 0.5) * 9) / C)));
      const g = gy * W + gx;
      const f = plan.field[g];
      if (f === FIELD.NONE || terr[g] !== 2) continue;
      const c = painter.color(f, px, py, plan.owner[g], hp[i], snowPx[i] === 1);
      if (c === 0) continue;
      data[i] = c;
      culture[i] = 1;
    }
  }
}

/** 河流：由细到宽的水线，冬季北方结冰；入海口外的海面画成浑浊的浅水；右下的河岸落一像素暗影。 */
function paintRivers(ctx: Ctx) {
  const { W, H, NP, PW, data, river, riverCell, culture, latPx, seasonPx, geo, coast } = ctx;
  const { land, outDist } = coast;
  const riverWater = R(P.sea[3]);
  const riverLite = R(P.sea[4]);
  const riverIce = R(P.snow[1]);
  const riverIceLite = R(P.snow[3]);
  const wadiBed = R(P.sand[2]);
  const wadiLite = R(P.sand[3]);
  const bank = R("#1a142340");
  for (const r of ctx.input.rivers ?? []) {
    for (const [x, y] of r.path) {
      const xx = Math.round(x);
      const yy = Math.round(y);
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) riverCell[yy * W + xx] = 1;
    }
    const stroke = riverStroke(r, geo, C);
    if (!stroke) continue;
    const { water, mouthSea } = rasterStroke(stroke, coast, river);
    // 干旱区的小河（沿途大半是沙漠或半干旱草原）是季节性的旱谷：画成断续的干河床，不画成蓝色的水线
    let arid = 0;
    for (const [x, y] of r.path) {
      const v = geo.veg[Math.round(y) * W + Math.round(x)];
      if (v === DESERT || v === STEPPE) arid++;
    }
    if ((r.width ?? 1) <= 1 && arid >= r.path.length * 0.6) {
      for (const i of water) {
        const px = i % PW;
        const py = Math.floor(i / PW);
        data[i] = hash2(px, py, 1673) < 0.3 ? wadiLite : wadiBed;
        culture[i] = 0;
      }
      continue;
    }
    for (const i of mouthSea) if (outDist[i] > 1) data[i] = riverLite;
    for (const i of water) {
      const py = Math.floor(i / PW);
      const frozen = seasonPx(py) === 3 && latPx(py) < 62;
      data[i] = frozen ? (hash2(i % PW, py, 1671) < 0.3 ? riverIceLite : riverIce) : riverWater;
      culture[i] = 0;
    }
  }
  for (let i = 0; i < NP; i++) {
    if (!river[i]) continue;
    if ((i % PW) + 1 < PW && land[i + 1] && !river[i + 1]) data[i + 1] = blendOver(data[i + 1], bank);
    if (i + PW < NP && land[i + PW] && !river[i + PW]) data[i + PW] = blendOver(data[i + PW], bank);
  }
}

/** 道路与桥：按地形寻路，画成虚线；过河处画桥。返回沿途要加的建筑（沙漠长路中途的商队驿站）。 */
function paintRoads(ctx: Ctx): Structure[] {
  const { W, PW, PH, NP, data, river, road, culture, clear, riverCell, geo } = ctx;
  const land = ctx.coast.land;
  const roadDark = R(P.wood[1]);
  const roadLite = R(P.sand[3]);
  const plank = R(P.wood[3]);
  const rail = R(P.wood[1]);
  const extra: Structure[] = [];
  const seen = new Set<string>();
  const mark = (cx: number, cy: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < PW && y < PH) clear[y * PW + x] = 1;
      }
  };
  for (const rd of ctx.input.roads ?? []) {
    const key = `${rd.from}-${rd.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const path = routeRoad(geo, riverCell, rd.from, rd.to);
    if (!path || path.length < 2) continue;
    const pts = chaikin(
      path.map((c) => [(c % W) * C + C / 2, Math.floor(c / W) * C + C / 2] as [number, number]),
      2,
    );
    let s = 0;
    let last = -1;
    for (let k = 0; k + 1 < pts.length; k++) {
      const [ax, ay] = pts[k];
      const [bx, by] = pts[k + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
      const alongX = Math.abs(bx - ax) >= Math.abs(by - ay);
      for (let t = 0; t < n; t++) {
        const x = Math.floor(ax + ((bx - ax) * t) / n);
        const y = Math.floor(ay + ((by - ay) * t) / n);
        if (x < 0 || y < 0 || x >= PW || y >= PH) continue;
        const i = y * PW + x;
        if (i === last) continue;
        last = i;
        mark(x, y);
        if (!land[i]) continue;
        if (river[i]) {
          // 桥：桥面顺着路，两侧是栏杆
          data[i] = plank;
          road[i] = 2;
          const ox = alongX ? 0 : 1;
          const oy = alongX ? 1 : 0;
          for (const sgn of [-1, 1]) {
            const j = (y + oy * sgn) * PW + x + ox * sgn;
            if (j >= 0 && j < NP && land[j]) {
              data[j] = rail;
              road[j] = 2;
            }
          }
          continue;
        }
        s++;
        if (s % 4 === 3) continue;
        data[i] = roadDark;
        road[i] = 1;
        culture[i] = 0;
        if (s % 4 === 1 && y > 0 && land[i - PW] && !river[i - PW] && !road[i - PW]) data[i - PW] = roadLite;
      }
    }
    if (path.length >= 10) {
      const mid = path[Math.floor(path.length / 2)];
      const v = geo.veg[mid];
      if (v === DESERT || v === STEPPE) extra.push({ kind: "caravanserai", x: (mid % W) * C + C, y: Math.floor(mid / W) * C + 2, style: "desert" });
    }
  }
  return extra;
}

/** 图元不可落脚处：河道两侧、地点标记（约 19×20，底边在格中心下 5 像素）、地标占地及四周、冰架。 */
function markReserved(ctx: Ctx, places: readonly UPlace[]) {
  const { PW, PH, NP, river, clear, shelfIce } = ctx;
  const box = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, y0); y <= Math.min(PH - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(PW - 1, x1); x++) clear[y * PW + x] = 1;
  };
  for (let i = 0; i < NP; i++) {
    if (shelfIce[i]) clear[i] = 1;
    if (!river[i]) continue;
    const x = i % PW;
    const y = (i - x) / PW;
    box(x - 1, y - 1, x + 1, y + 1);
  }
  for (const p of places) {
    const cx = p.x * C + C / 2;
    const cy = p.y * C + C / 2;
    box(cx - 10, cy - 17, cx + 10, cy + 6);
  }
  for (const l of ctx.input.landmarks ?? []) {
    const w = Math.max(1, l.w ?? 1);
    const h = Math.max(1, l.h ?? 1);
    box(l.x * C - 3, l.y * C - 5, (l.x + w) * C + 2, (l.y + h) * C + 2);
  }
}

type Glyph = { x: number; y: number; draw: () => void };

/** 图元：建筑、民居、山、丘陵、树与各植被带的点缀、沙丘、礁石与冰山。先收集，再按底边 y 排序绘制。 */
function placeGlyphs(ctx: Ctx, plan: CulturePlan, extra: readonly Structure[]) {
  const glyphs: Glyph[] = [];
  placeBuildings(ctx, plan, extra, glyphs);
  placeRelief(ctx, glyphs);
  placePlants(ctx, glyphs);
  placeSeaMarks(ctx, glyphs);
  placeSeaworks(ctx, plan, glyphs);
  glyphs.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const g of glyphs) g.draw();
}

/** 图元放置的辅助函数。 */
function glyphHelpers(ctx: Ctx) {
  const { PW, PH, clear, culture } = ctx;
  const land = ctx.coast.land;
  const isLand = (x: number, y: number) => x >= 0 && y >= 0 && x < PW && y < PH && land[y * PW + x] === 1;
  const free = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!isLand(x, y) || clear[y * PW + x]) return false;
    return true;
  };
  const fieldFree = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!isLand(x, y) || clear[y * PW + x] || culture[y * PW + x]) return false;
    return true;
  };
  const claim = (x0: number, y0: number, x1: number, y1: number, mark: number) => {
    for (let y = Math.max(0, y0); y <= Math.min(PH - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(PW - 1, x1); x++) {
        clear[y * PW + x] = 1;
        if (mark && land[y * PW + x]) culture[y * PW + x] = mark;
      }
  };
  return { isLand, free, fieldFree, claim };
}

function placeBuildings(ctx: Ctx, plan: CulturePlan, extra: readonly Structure[], glyphs: Glyph[]) {
  const { PW, out, snowPx, clear, season } = ctx;
  const { isLand, free, claim } = glyphHelpers(ctx);
  const boxTaken = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, y0); y <= Math.min(ctx.PH - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(PW - 1, x1); x++) if (clear[y * PW + x]) return true;
    return false;
  };
  // 规划的位置被道路、河流、地点标记占了时，在附近几像素里挪一挪（首都的宫殿、东方的宝塔一定要放下）
  const NUDGE: readonly (readonly [number, number])[] = [
    [0, 0],
    [3, 0],
    [-3, 0],
    [0, 3],
    [0, -3],
    [4, 4],
    [-4, 4],
    [5, -3],
    [-5, -3],
    [7, 0],
    [-7, 0],
    [0, 7],
    [2, -7],
    [8, 5],
    [-8, 5],
    [9, -5],
    [-9, -5],
    [0, 11],
    [11, 0],
    [-11, 0],
    [6, 10],
    [-6, 10],
    [13, 4],
    [-13, 4],
    [4, 14],
    [-4, 14],
  ];
  // 首都的宫殿与宝塔先放（优先占位），其余按规划的顺序
  const rank = (k: string) => (k === "castle" ? 0 : k === "pagoda" ? 1 : 2);
  const todo = [...plan.structures, ...extra].map((s, i) => ({ s, i })).sort((a, b) => rank(a.s.kind) - rank(b.s.kind) || a.i - b.i);
  for (const { s } of todo) {
    const important = s.kind === "castle" || s.kind === "pagoda";
    for (const [dx, dy] of important ? NUDGE : NUDGE.slice(0, 9)) {
      const sx = s.x + dx;
      const sy = s.y + dy;
      if (!isLand(sx, sy)) continue;
      const spr = structureSprite(s.kind, s.style, season, snowPx[sy * PW + sx] === 1);
      const x0 = sx - Math.floor(spr.w / 2);
      const y0 = sy - spr.h + 1;
      // 整座建筑都不压在道路、河流、地点标记与地标上，也不伸到海上
      if (boxTaken(x0, y0, x0 + spr.w - 1, sy) || !isLand(x0, sy) || !isLand(x0 + spr.w - 1, sy)) continue;
      claim(x0, y0, x0 + spr.w - 1, y0 + spr.h - 1, 2);
      glyphs.push({ x: sx, y: sy, draw: () => out.blit(spr, x0, y0) });
      break;
    }
  }
  for (const hs of plan.houses) {
    const box = houseBox(hs.style);
    const x0 = hs.x - Math.floor(box.w / 2);
    const y0 = hs.y - box.h + 2;
    if (!free(x0, y0, x0 + box.w - 1, hs.y + 1)) continue;
    const snowy = snowPx[hs.y * PW + hs.x] === 1;
    claim(x0, y0, x0 + box.w - 1, hs.y + 1, 2);
    glyphs.push({ x: hs.x, y: hs.y, draw: () => drawHouse(out, hs.x, hs.y, hs.style, snowy) });
  }
}

/**
 * 山、火山与丘陵（先收集、按底边排序绘制，允许互相遮挡）：
 * - 火山：火山地里高程是周围 8 格的局部最高（≥ 3 级）的格画锥形火山，越高越大；
 * - 山峰：分层抖动取候选（每个网格一个候选，位置在网格里完全随机，不是规则的行列）。主峰（高程 ≥ 5.1）先用大网格放，
 *   峰少而大、按底边排序相互遮挡连成山体；再补小峰；中等高度（3.8–5.1）的脊线（高于四周）画小峰，1300–1600 米的山也读得出来；
 * - 丘陵：山麓（离 5 级以上的格 3 格以内）成一圈过渡带，别处只在隆起处零星几座。
 */
function placeRelief(ctx: Ctx, glyphs: Glyph[]) {
  const { W, H, PW, out, hp, vegPx, snowPx, season, winter, latPx, seasonPx, clear } = ctx;
  const { terr, relief, veg } = ctx.geo;
  const { isLand, fieldFree, claim } = glyphHelpers(ctx);
  const at = (x: number, y: number) => y * PW + x;
  const hpAt = (x: number, y: number) => (isLand(x, y) ? hp[at(x, y)] : 0);
  // 已放的峰：按 8×8 像素分桶，控制峰与峰的间距
  const BK = 8;
  const bw = Math.ceil(PW / BK) + 2;
  const buckets = new Map<number, number[]>();
  const nearPeak = (x: number, y: number, d: number) => {
    const cx = Math.floor(x / BK);
    const cy = Math.floor(y / BK);
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const b = buckets.get((cy + dy) * bw + cx + dx);
        if (!b) continue;
        for (let k = 0; k < b.length; k += 2) if ((b[k] - x) ** 2 + (b[k + 1] - y) ** 2 < d * d) return true;
      }
    return false;
  };
  const addPeak = (x: number, y: number) => {
    const key = Math.floor(y / BK) * bw + Math.floor(x / BK);
    const b = buckets.get(key);
    if (b) b.push(x, y);
    else buckets.set(key, [x, y]);
  };
  // 底边一段不能压在道路、河流、地点标记、建筑上
  const baseFree = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!isLand(x, y) || clear[at(x, y)]) return false;
    return true;
  };
  // —— 火山 ——
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (terr[i] !== 2 || veg[i] !== VOLCANIC || relief[i] < 3) continue;
      let peak = true;
      for (let dy = -1; dy <= 1 && peak; dy++)
        for (let dx = -1; dx <= 1 && peak; dx++) {
          const j = (y + dy) * W + x + dx;
          if (j === i || terr[j] !== 2) continue;
          // 更高的邻格挡住；一样高的只有同是火山地、下标更小的才挡（同一座火山只画一个锥）
          if (relief[j] > relief[i] || (relief[j] === relief[i] && veg[j] === VOLCANIC && j < i)) peak = false;
        }
      if (!peak) continue;
      const bx = x * C + 2;
      const by = y * C + 3;
      const h = Math.min(13, 6 + relief[i]);
      const hw = Math.round(h * 0.72);
      // 小火山岛的锥底可以伸到海面上：只要求格中心一带是陆地、没有被道路与地点占用
      if (nearPeak(bx, by, 7) || !baseFree(bx - 1, by - 2, bx + 1, by - 1)) continue;
      const snowy = snowPx[at(bx, by - h + 2)] === 1 || (winter && relief[i] >= 6);
      addPeak(bx, by);
      claim(bx - hw + 1, by - h + 1, bx + hw - 1, by, 0);
      glyphs.push({ x: bx, y: by, draw: () => volcano(out, bx, by, season, h, x * 131 + y, snowy) });
    }
  }
  // —— 山峰 ——
  const pass = (gw: number, gh: number, minH: number, salt: number, minCrest: number) => {
    for (let gy = 0; gy * gh < ctx.PH; gy++) {
      for (let gx = 0; gx * gw < PW; gx++) {
        const bx = gx * gw + Math.floor(hash2(gx, gy, 81 + salt) * gw);
        const by = gy * gh + Math.floor(hash2(gx, gy, 82 + salt) * gh);
        if (!isLand(bx, by)) continue;
        const hv = hp[at(bx, by)];
        if (hv < minH) continue;
        const v = vegPx[at(bx, by)];
        if (v === VOLCANIC || v === WETLAND) continue;
        const around = (hpAt(bx - 6, by) + hpAt(bx + 6, by) + hpAt(bx, by - 5) + hpAt(bx, by + 5)) / 4;
        const crest = hv - around;
        // 中等高度只画在明显的脊线上（高于四周），平缓的台地与干旱高原上不画；补的小峰也只在脊线上
        if (hv < 5.1 && (crest < 0.3 || hv < 4.2 || v === DESERT || v === STEPPE)) continue;
        if (crest < minCrest + (minCrest > 0 && (v === DESERT || v === STEPPE) ? 0.15 : 0)) continue;
        const rank = hv + Math.max(0, crest) * 1.5 + (hash2(gx, gy, 86 + salt) - 0.5) * 0.8;
        const size = rank >= 8.4 ? 3 : rank >= 7.1 ? 2 : rank >= 5.8 ? 1 : 0;
        const hw = size === 3 ? 7 : size === 2 ? 5 + (hash2(gx, gy, 83 + salt) < 0.4 ? 1 : 0) : size === 1 ? 4 : 3;
        const h = size === 3 ? 13 : size === 2 ? 9 + (hash2(gx, gy, 87 + salt) < 0.3 ? 2 : 0) : size === 1 ? 7 : 5;
        // 主峰之间约隔 9 像素、小峰约 6 像素：少而大，彼此仍然挨着、相互遮挡
        if (nearPeak(bx, by, size >= 2 ? 9 : size === 1 ? 6.5 : 5.5)) continue;
        if (!baseFree(bx - hw + 2, by - 1, bx + hw - 2, by + 1)) continue;
        const se = snowLevel(seasonPx(by), latPx(by)) + snowBias(v, season);
        const over = hv + 0.6 + size * 0.3 - se;
        const cap = Math.ceil(h * (winter ? 0.65 : 0.45));
        const snow = v === ARCANE ? 0 : over > 0 ? Math.min(cap, Math.round(over * 1.6 + 1)) : 0;
        const pal = rockPal(v);
        const big = size >= 2 && hash2(gx, gy, 84 + salt) < 0.55;
        addPeak(bx, by);
        // 山体本身不再长树（树画在山体外）
        claim(bx - hw + 2, by - h + 2, bx + hw - 2, by - 1, 0);
        glyphs.push({ x: bx, y: by, draw: () => mountain(out, bx, by, hw, h, pal, snow, gx * 131 + gy + salt, big) });
      }
    }
  };
  pass(12, 9, 5.1, 0, -99);
  pass(7, 6, 5.1, 10, 0.12);
  pass(8, 7, 3.8, 20, 0.3);
  // —— 丘陵：山麓的过渡带与零星的隆起 ——
  const mnear = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (terr[i] !== 2 || relief[i] < 5) continue;
      for (let dy = -3; dy <= 3; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < H) mnear[yy * W + xx] = 1;
        }
    }
  for (let gy = 0; gy * 6 < ctx.PH; gy++) {
    for (let gx = 0; gx * 8 < PW; gx++) {
      const bx = gx * 8 + Math.floor(hash2(gx, gy, 91) * 8);
      const by = gy * 6 + Math.floor(hash2(gx, gy, 92) * 6);
      if (!isLand(bx, by)) continue;
      const hv = hp[at(bx, by)];
      if (hv < 2.2 || hv >= 5.1) continue;
      const v = vegPx[at(bx, by)];
      if (v === WETLAND || v === ICE || v === VOLCANIC) continue;
      const foot = mnear[Math.floor(by / C) * W + Math.floor(bx / C)] === 1;
      const around = (hpAt(bx - 5, by) + hpAt(bx + 5, by) + hpAt(bx, by - 4) + hpAt(bx, by + 4)) / 4;
      // 山麓更密；别处只画在隆起处；沙漠里少（石漠的起伏交给砾石）
      const dry = v === DESERT || v === STEPPE ? 0.3 : 1;
      const keepHill = (foot ? 0.5 : Math.min(0.7, 0.12 + (hv - 2.7) * 0.18 + (hv - around) * 0.6)) * dry;
      if ((!foot && hv < around + 0.02) || hash2(gx, gy, 93) > keepHill) continue;
      const hw = foot && hv >= 3.2 ? 5 : 4;
      const hh = foot && hv >= 3.2 ? 4 : 3;
      if (!fieldFree(bx - hw, by - hh, bx + hw, by + 1)) continue;
      const pal = hillPal(v, season, snowPx[at(bx, by)] === 1);
      claim(bx - hw, by - hh + 1, bx + hw, by, 0);
      glyphs.push({ x: bx, y: by, draw: () => hill(out, bx, by, hw, hh, pal) });
    }
  }
}

/** 各植被带的树种与点缀；沙漠里的沙丘。 */
function placePlants(ctx: Ctx, glyphs: Glyph[]) {
  const { PW, PH, out, hp, vegPx, snowPx, clear, culture, season, winter, latPx } = ctx;
  const inDist = ctx.coast.inDist;
  const { isLand, fieldFree } = glyphHelpers(ctx);
  const at = (x: number, y: number) => y * PW + x;
  const pal = {
    conifer: treePalette("conifer", season),
    coniferSnow: treePalette("conifer-snow", season),
    broad: treePalette("broad", season),
    broadSouth: treePalette("broad-south", season),
    golden: treePalette("golden", season),
    crimson: treePalette("crimson", season),
    summer: treePalette("broad", 1),
    olive: treePalette("olive", season),
    cypress: treePalette("cypress", season),
    palm: treePalette("palm", season),
    canopy: treePalette("canopy", season),
    acacia: treePalette("acacia", season),
    mangrove: treePalette("mangrove", season),
    swamp: treePalette("swamp", season),
    shrub: treePalette("shrub", season),
    tundra: treePalette("tundra", season),
    bare: treePalette("bare", season),
  };
  const tuftCol = season === 2 || winter ? { h: P.straw[3], m: P.straw[1] } : { h: P.leaf[4], m: P.leaf[2] };
  const reedCol = { h: season === 2 ? P.straw[3] : P.leaf[3], m: P.straw[1], d: P.wood[1] };
  const nForest = tileField(512, 20, 1681);
  const nGlade = tileField(512, 34, 1687);
  const addTree = (x: number, y: number, rowsT: readonly string[], p: TreePal, flip: boolean) => {
    const w = rowsT[0].length;
    const h = rowsT.length;
    const x0 = x - Math.floor(w / 2);
    const y0 = y - h + 1;
    if (!fieldFree(x0, y0 + 1, x0 + w - 1, y)) return;
    glyphs.push({ x, y, draw: () => stampTree(out, rowsT, x0, y0, p, flip) });
  };
  const addStamp = (x: number, y: number, rowsT: readonly string[], key: Record<string, string>, flip: boolean) => {
    const w = rowsT[0].length;
    const h = rowsT.length;
    if (!fieldFree(x - 1, y - h + 1, x + w - 2, y)) return;
    glyphs.push({ x, y, draw: () => out.stamp(rowsT, key, x - 1, y - h + 1, flip) });
  };
  const plantAt = (x: number, y: number, gx: number, gy: number, dense: boolean) => {
    if (!isLand(x, y)) return;
    const i = at(x, y);
    if (clear[i] || culture[i]) return;
    const v = vegPx[i];
    const hv = hp[i];
    if (hv >= 5.1 && v !== BOREAL) return;
    // 礁岩小岛上不长树
    if (ctx.comp[Math.floor(y / C) * ctx.W + Math.floor(x / C)] <= 3) return;
    // 树冠不伸到火山地上
    if (v !== VOLCANIC && (vegPx[at(Math.max(0, x - 3), y)] === VOLCANIC || vegPx[at(Math.min(PW - 1, x + 3), y)] === VOLCANIC || (y >= 5 && vegPx[at(x, y - 5)] === VOLCANIC))) return;
    // 林间空地（低频噪声的低处）
    if ((v === FOREST || v === BOREAL || v === JUNGLE) && nGlade(x, y) < 0.36) return;
    const forest = nForest(x, y) - (dense ? 0.06 : 0);
    const h1 = hash2(gx, gy, 104);
    const flip = hash2(gx, gy, 106) < 0.5;
    const lat = latPx(y);
    const snowy = snowPx[i] === 1;
    const coastal = inDist[i] < 6;
    switch (v) {
      case BOREAL:
        if (forest > 0.34 && hv < 6.2) {
          const snowTip = snowy || (winter && hash2(gx, gy, 108) < 0.5);
          addTree(x, y, h1 < 0.35 ? TREE_PINE_TALL : h1 < 0.75 ? TREE_PINE : TREE_PINE_SMALL, snowTip ? pal.coniferSnow : pal.conifer, flip);
        }
        return;
      case FOREST:
        if (forest > 0.36) {
          const conifer = (lat < 62 && h1 < 0.35) || hv > 3.8;
          if (conifer) addTree(x, y, h1 < 0.5 ? TREE_PINE : TREE_PINE_SMALL, snowy ? pal.coniferSnow : pal.conifer, flip);
          else if (winter) addTree(x, y, TREE_BARE, pal.bare, flip);
          else {
            // 秋天的阔叶林：橙、金、红与少数仍绿的树混在一起
            let tp = lat > 80 ? pal.broadSouth : pal.broad;
            if (season === 2 && lat <= 80) {
              const k = hash2(gx, gy, 107);
              tp = k < 0.4 ? pal.broad : k < 0.7 ? pal.golden : k < 0.85 ? pal.crimson : pal.summer;
            }
            addTree(x, y, hash2(gx, gy, 109) < 0.5 ? TREE_BIG : TREE_ROUND, tp, flip);
          }
        }
        return;
      case JUNGLE:
        if (coastal && hash2(gx, gy, 105) < 0.35) addTree(x, y, dense ? TREE_PALM_SMALL : TREE_PALM, pal.palm, flip);
        else if (forest > 0.3) addTree(x, y, h1 < 0.5 ? TREE_CANOPY : TREE_BIG, pal.canopy, flip);
        return;
      case WETLAND:
        if (dense) return;
        if (coastal && lat > 100 && hash2(gx, gy, 110) < 0.6) addTree(x, y, TREE_MANGROVE, pal.mangrove, flip);
        else if (forest > 0.52) addTree(x, y, TREE_SMALL, pal.swamp, flip);
        else if (hash2(gx, gy, 111) < 0.5) addStamp(x, y, REED, reedCol, flip);
        return;
      case MEDIT:
        if (dense) return;
        if (forest > 0.5) addTree(x, y, h1 < 0.35 ? TREE_CYPRESS : TREE_OLIVE, h1 < 0.35 ? pal.cypress : pal.olive, flip);
        else if (hash2(gx, gy, 112) < 0.4) addTree(x, y, SHRUB, pal.shrub, flip);
        return;
      case GRASS:
        if (dense) return;
        if (forest > 0.66 && h1 < 0.7) addTree(x, y, TREE_ROUND, winter ? pal.bare : pal.broad, flip);
        else if (!snowy && hash2(gx, gy, 113) < 0.3) addStamp(x, y, TUFT, tuftCol, flip);
        return;
      case STEPPE:
        if (dense) return;
        if (hash2(gx, gy, 114) < 0.12) addTree(x, y, SHRUB, pal.shrub, flip);
        else if (!snowy && hash2(gx, gy, 115) < 0.25) addStamp(x, y, TUFT, tuftCol, flip);
        return;
      case SAVANNA:
        if (dense) return;
        if (forest > 0.5 && h1 < 0.35) addTree(x, y, TREE_ACACIA, pal.acacia, flip);
        else if (hash2(gx, gy, 116) < 0.3) addStamp(x, y, TUFT, tuftCol, flip);
        return;
      case TUNDRA:
        if (dense) return;
        if (lat > 12 && forest > 0.62 && h1 < 0.5) addTree(x, y, TREE_PINE_SMALL, snowy ? pal.coniferSnow : pal.conifer, flip);
        else if (!snowy && hash2(gx, gy, 117) < 0.3) addTree(x, y, TUNDRA_TUFT, pal.tundra, flip);
        return;
      case VOLCANIC:
        // 火山地上是熔岩与火山灰，不长树
        return;
      case ARCANE:
        if (!dense && hash2(gx, gy, 119) < 0.18 && fieldFree(x - 1, y - 5, x + 1, y)) {
          const c1 = h1 < 0.5 ? P.teal[3] : P.cloth.purple[2];
          const c2 = h1 < 0.5 ? P.teal[1] : P.cloth.purple[0];
          glyphs.push({ x, y, draw: () => out.vline(x, y - 4, y, c1).vline(x + 1, y - 3, y, c2).set(x, y - 5, P.white).set(x - 1, y, c2) });
        }
        return;
      default:
        return;
    }
  };
  // 树与点缀：分层抖动取样（每 5×5 像素两个候选，位置在网格里完全随机），离已取的点太近（< 3 像素）的丢掉——
  // 接近蓝噪声的分布，没有规则网格的“地毯感”；林间空地由低频噪声留出
  const G = 5;
  const gw = Math.ceil(PW / G) + 1;
  const gh = Math.ceil(PH / G) + 1;
  const pts = new Int16Array(gw * gh * 4).fill(-1);
  const tooClose = (x: number, y: number, gx: number, gy: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const cx = gx + dx;
        const cy = gy + dy;
        if (cx < 0 || cy < 0 || cx >= gw || cy >= gh) continue;
        const b = (cy * gw + cx) * 4;
        for (let k = 0; k < 4; k += 2) {
          if (pts[b + k] < 0) continue;
          if ((pts[b + k] - x) ** 2 + (pts[b + k + 1] - y) ** 2 < 9) return true;
        }
      }
    return false;
  };
  for (let gy = 0; gy * G < PH; gy++) {
    for (let gx = 0; gx * G < PW; gx++) {
      for (let k = 0; k < 2; k++) {
        const x = gx * G + Math.floor(hash2(gx, gy, 101 + k * 7) * G);
        const y = gy * G + Math.floor(hash2(gx, gy, 102 + k * 7) * G);
        if (tooClose(x, y, gx, gy)) continue;
        const b = (gy * gw + gx) * 4 + k * 2;
        pts[b] = x;
        pts[b + 1] = y;
        plantAt(x, y, k === 0 ? gx : gx + 7919, k === 0 ? gy : gy + 104729, k === 1);
      }
    }
  }
  placeDunes(ctx, glyphs);
}

/**
 * 沙漠的地面：低平处（高程 ≤ 2.8 且在沙海噪声的高处）是沙海——大小不一的新月形沙丘（角朝下风，信风带里朝西）
 * 与顺风的纵向沙垄；其余是石漠（零星的砾石与风蚀的小石丘）。分层抖动取样，大沙丘之间留出间距。
 */
function placeDunes(ctx: Ctx, glyphs: Glyph[]) {
  const { PW, PH, out, hp, vegPx } = ctx;
  const inDist = ctx.coast.inDist;
  const { isLand, fieldFree } = glyphHelpers(ctx);
  const at = (x: number, y: number) => y * PW + x;
  const hi = P.white;
  const mid = P.sand[4];
  const dark = P.sand[3];
  const deep = P.sand[2];
  const nErg = tileField(512, 70, 1701);
  /** 新月形沙丘：外圆减去朝下风（西）挪开的内圆，再压扁成俯视的样子；迎光的上缘亮、背风的滑落面暗。 */
  const barchan = (cx: number, cy: number, r: number, flip: boolean) => {
    const dir = flip ? 1 : -1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        const oy = dy / 0.6;
        const outer = dx * dx + oy * oy <= r * r;
        const ix = dx - dir * r * 0.55;
        const inner = ix * ix + (oy + r * 0.15) ** 2 <= r * r * 0.72;
        if (!outer || inner) continue;
        const x = cx + dx;
        const y = cy + Math.round(dy * 0.6);
        let c: string = mid;
        if (dy <= -r + 1) c = hi;
        else if (dx * dir < -r * 0.3 && dy > 0) c = dark;
        else if (ix * ix + (oy + r * 0.15) ** 2 <= r * r * 1.05) c = dark;
        out.set(x, y, c);
      }
    }
    out.hline(cx - r + 1, cx + r - 1, cy + Math.round(r * 0.6) + 1, "#6b402633");
  };
  /** 纵向沙垄：顺风（东西向略斜）的细长沙脊，脊线亮、南坡暗。 */
  const seif = (x0: number, y0: number, len: number, tilt: number, seed: number) => {
    for (let k = 0; k < len; k++) {
      const x = x0 + k;
      const y = y0 + Math.round(k * tilt + Math.sin((k + seed) * 0.5) * 0.6);
      out.set(x, y, k === 0 || k === len - 1 ? mid : hi).set(x, y + 1, mid).set(x, y + 2, k % 3 === 0 ? deep : dark);
    }
  };
  const taken: number[] = [];
  const clear = (x: number, y: number, d: number) => {
    for (let k = 0; k < taken.length; k += 2) if ((taken[k] - x) ** 2 + (taken[k + 1] - y) ** 2 < d * d) return false;
    return true;
  };
  for (let gy = 0; gy * 9 < PH; gy++) {
    for (let gx = 0; gx * 13 < PW; gx++) {
      const x = gx * 13 + Math.floor(hash2(gx, gy, 121) * 13);
      const y = gy * 9 + Math.floor(hash2(gx, gy, 122) * 9);
      if (!isLand(x, y) || vegPx[at(x, y)] !== DESERT || inDist[at(x, y)] < 5) continue;
      const h = hp[at(x, y)];
      if (h > 5) continue;
      const erg = h <= 2.8 && nErg(x, y) > 0.47;
      const u = hash2(gx, gy, 123);
      if (erg) {
        if (nErg(x, y) > 0.56 && u < 0.35) {
          // 沙海深处：纵向沙垄
          const len = 12 + Math.floor(hash2(gx, gy, 124) * 10);
          if (!fieldFree(x, y - 1, x + len, y + 3) || !clear(x + len / 2, y, 12)) continue;
          taken.push(x + len / 2, y);
          const tilt = (hash2(gx, gy, 125) - 0.5) * 0.25;
          glyphs.push({ x, y: y + 2, draw: () => seif(x, y, len, tilt, gx + gy) });
        } else {
          const r = u < 0.35 ? 2 : u < 0.8 ? 3 : 5;
          if (!fieldFree(x - r - 1, y - r, x + r + 1, y + r) || !clear(x, y, r * 2 + 3)) continue;
          taken.push(x, y);
          glyphs.push({ x, y: y + r, draw: () => barchan(x, y, r, false) });
        }
      } else if (u < 0.45) {
        // 石漠：两三块砾石或一个风蚀的小石丘
        if (!fieldFree(x - 2, y - 2, x + 2, y + 1)) continue;
        const big = hash2(gx, gy, 126) < 0.3;
        glyphs.push({
          x,
          y,
          draw: () => {
            if (big) out.set(x, y - 1, dark).set(x - 1, y, dark).set(x, y, deep).set(x + 1, y, deep).set(x - 1, y - 1, mid);
            else out.set(x, y, deep).set(x + 2, y - 1, dark).set(x - 2, y + 1, dark);
          },
        });
      }
    }
  }
}

/** 群岛港口外的采珠筏（陆架上的竹筏与浮子）与近岸的渔栅（指向岸边的 V 形木桩）。 */
function placeSeaworks(ctx: Ctx, plan: CulturePlan, glyphs: Glyph[]) {
  const { PW, PH, out } = ctx;
  const { land, outDist } = ctx.coast;
  const RAFT = ["o.o.o", "ddddd", "wdwdw", "ddddd"];
  const raftKey = { o: P.white, d: P.wood[1], w: P.wood[3] };
  const seaAt = (x: number, y: number) => x >= 2 && y >= 2 && x < PW - 6 && y < PH - 5 && !land[y * PW + x];
  plan.places.forEach((p, k) => {
    if (p.style !== "islands" || p.kind !== "port") return;
    const cx = p.x * C + 2;
    const cy = p.y * C + 2;
    let rafts = 0;
    let weirs = 0;
    for (let t = 0; t < 40 && (rafts < 3 || weirs < 2); t++) {
      const a = hash2(k, t, 1711) * Math.PI * 2;
      const r = (2.5 + hash2(k, t, 1712) * 4) * C;
      const x = Math.round(cx + Math.cos(a) * r);
      const y = Math.round(cy + Math.sin(a) * r);
      if (!seaAt(x, y)) continue;
      const d = outDist[y * PW + x];
      if (rafts < 3 && d >= 4 && d <= 14 && [0, 4, PW * 3, PW * 3 + 4].every((o) => !land[y * PW + x + o])) {
        rafts++;
        glyphs.push({ x, y: y + 3, draw: () => out.stamp(RAFT, raftKey, x, y) });
      } else if (weirs < 2 && d >= 1.5 && d <= 3.5) {
        weirs++;
        // 渔栅：一串木桩，从岸边斜着伸出去再折回（V 形）
        const dir = hash2(k, t, 1713) < 0.5 ? 1 : -1;
        glyphs.push({
          x,
          y,
          draw: () => {
            for (let s2 = 0; s2 < 4; s2++) {
              const ax = x + s2 * dir;
              const ay = y + s2;
              const bx = x + (6 - s2) * dir;
              const by = y + s2;
              if (seaAt(ax, ay)) out.set(ax, ay, P.wood[1]);
              if (seaAt(bx, by)) out.set(bx, by, P.wood[1]);
            }
          },
        });
      }
    }
  });
}

/** 海上的礁石（岩岸与崖岸外）与冰山（极地的海）。 */
function placeSeaMarks(ctx: Ctx, glyphs: Glyph[]) {
  const { W, PW, PH, out, coastT, shelfIce, latPx } = ctx;
  const { land, outDist } = ctx.coast;
  const ROCKS = [".h.", "hmd"];
  const rockKey = { h: P.stone[3], m: P.stone[2], d: P.stone[1] };
  // 冰山：扁平的桌状冰，顶面白、侧面带蓝色阴影（不再是像白帆的三角）
  const BERG = [".hhhh.", "hhhhhm", "mmmmdd"];
  const bergKey = { h: P.white, m: P.snow[1], d: P.sky[2] };
  for (let gy = 0; gy * 5 < PH; gy++) {
    for (let gx = 0; gx * 5 < PW; gx++) {
      const x = gx * 5 + Math.floor(hash2(gx, gy, 131) * 4);
      const y = gy * 5 + Math.floor(hash2(gx, gy, 132) * 4);
      if (x < 3 || y < 3 || x >= PW - 5 || y >= PH - 4) continue;
      const i = y * PW + x;
      if (land[i] || shelfIce[i]) continue;
      const d = outDist[i];
      const near = nearestLandCell(ctx, x, y);
      const ct = near >= 0 ? coastT[near] : coastT[Math.floor(y / C) * W + Math.floor(x / C)];
      if ((ct === COAST.CLIFF || ct === COAST.ROCK) && d >= 3 && d <= 6 && hash2(gx, gy, 133) < 0.1) {
        glyphs.push({
          x,
          y,
          draw: () => {
            out.stamp(ROCKS, rockKey, x - 1, y - 1);
            out.set(x - 2, y, P.foam).set(x + 2, y, P.foam).hline(x - 1, x + 1, y + 1, P.foam);
          },
        });
      } else if (latPx(y) < 13 && d >= 5 && d <= 40 && (ct === COAST.ICE || ct === COAST.CLIFF || ct === COAST.ROCK) && hash2(gx, gy, 134) < 0.035) {
        // 只在寒冷海岸附近少量出现
        glyphs.push({ x, y, draw: () => out.stamp(BERG, bergKey, x - 3, y - 2).hline(x - 3, x + 2, y + 1, P.sea[1]) });
      }
    }
  }
}

/** 航海图的装饰：恒向线与罗盘玫瑰（放在离陆地最远、又不挨着地点与地标的开阔海面上）、经纬线、画框。 */
function paintDecor(ctx: Ctx, places: readonly UPlace[]) {
  const { W, H, PW, PH, out } = ctx;
  const { terr, seaDist } = ctx.geo;
  const land = ctx.coast.land;
  if (PW < 200 || PH < 120) return;
  const landmarks = ctx.input.landmarks ?? [];
  // 罗盘玫瑰放在离陆地最远的开阔海面上，但整朵玫瑰（半径最多 24 像素）加 10 像素的边距都要在画框（8 像素）以内：
  // 图边之外算“开阔的海”，贴着图边的格离陆地最远，以前会把罗盘放在图边、被画框切掉一半
  let best = -1;
  let bx = Math.floor(W / 2);
  let by = Math.floor(H / 2);
  // 环绕地图：补出的列会被裁掉，罗盘玫瑰只放在原图范围内
  const padX = ctx.padX;
  const search = (margin: number) => {
    for (let y = margin; y < H - margin; y++) {
      for (let x = margin + padX; x < W - margin - padX; x++) {
        const d = seaDist[y * W + x];
        if (terr[y * W + x] === 2 || d <= best) continue;
        if (places.some((p) => Math.abs(p.x - x) < 12 && Math.abs(p.y - y) < 10)) continue;
        if (landmarks.some((l) => Math.abs(l.x - x) < 10 && Math.abs(l.y - y) < 8)) continue;
        best = d;
        bx = x;
        by = y;
      }
    }
  };
  search(Math.ceil((24 + 10 + 8) / C));
  // 画框以内找不到开阔海面（小地图）时退回全图最空的海面，再把圆心挪进画框里
  const fallback = best < 0;
  if (fallback) search(0);
  // 找不到够大的开阔海面时用固定的半径（不再缩成残片）
  const radius = fallback || best < 0 ? 14 : Math.max(14, Math.min(24, Math.floor(best * C) - 6));
  const edge = 8 + radius + 2;
  const edgeX = padX > 0 ? padX * C + radius + 2 : edge;
  const rx = Math.max(edgeX, Math.min(PW - edgeX, bx * C + C / 2));
  const ry = Math.max(edge, Math.min(PH - edge, by * C + C / 2));
  for (let k = 0; k < 16; k++) {
    const a = (k * Math.PI) / 8;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    for (let s = radius + 3; s < PW + PH; s++) {
      const x = Math.round(rx + dx * s);
      const y = Math.round(ry + dy * s);
      if (x < 0 || y < 0 || x >= PW || y >= PH) break;
      if (land[y * PW + x] || s % 4 >= 2) continue;
      out.set(x, y, k % 2 === 0 ? "#dcecf826" : "#dcecf81a");
    }
  }
  const { xs, ys } = graticule(ctx);
  for (const x of xs) {
    for (let y = 0; y < PH; y++) if (y % 3 !== 2) out.set(x, y, land[y * PW + x] ? "#2b1b1726" : "#dcecf833");
  }
  for (const y of ys) {
    for (let x = 0; x < PW; x++) if (x % 3 !== 2) out.set(x, y, land[y * PW + x] ? "#2b1b1726" : "#dcecf833");
  }
  const rose = drawCompassRose(radius);
  out.blit(rose, rx - Math.floor(rose.w / 2) + 1, ry - Math.floor(rose.h / 2) + 1, { tint: ink.blue, alpha: 0.35 });
  out.blit(rose, rx - Math.floor(rose.w / 2), ry - Math.floor(rose.h / 2));
  frameBorder(out, padX * C);
}

/**
 * 经纬线的像素位置：没有投影时每 30 格一条（经典世界不变）；有投影时经线、纬线各按 10° 的整数倍。
 * 环绕地图的补边按原图的坐标对齐（补边会被裁掉）。
 */
function graticule(ctx: Ctx): { xs: number[]; ys: number[] } {
  const { PW, PH, padX } = ctx;
  const xs: number[] = [];
  const ys: number[] = [];
  const p = ctx.input.projection;
  if (!p) {
    const step = 30 * C;
    const x0 = padX * C;
    for (let x = x0 + (padX > 0 ? 0 : step); x < PW; x += step) xs.push(x);
    for (let y = step; y < PH; y += step) ys.push(y);
    return { xs, ys };
  }
  const deg = 600; // 10° = 600 角分
  const a = p.arcmin_per_cell;
  // 经线：第 x 列左缘的经度 = west + x·a；取 10° 的整数倍落在哪些像素上
  const kx0 = Math.ceil(p.west / deg);
  for (let k = kx0; ; k++) {
    const x = Math.round(((k * deg - p.west) / a) * C);
    if (x >= PW) break;
    if (x > 0 || padX > 0) xs.push(x);
  }
  // 纬线：第 y 行上缘的纬度 = north − y·a
  const ky0 = Math.floor(p.north / deg);
  for (let k = ky0; ; k--) {
    const y = Math.round(((p.north - k * deg) / a) * C);
    if (y >= PH) break;
    if (y > 0) ys.push(y);
  }
  return { xs, ys };
}

/** 把半透明色 src 叠到不透明色 dst 上（结果不透明）。 */
function blendOver(dst: Rgba, src: Rgba): Rgba {
  const a = (src & 0xff) / 255;
  const ch = (s: number) => Math.round(((src >>> s) & 0xff) * a + ((dst >>> s) & 0xff) * (1 - a)) & 0xff;
  return ((ch(24) << 24) | (ch(16) << 16) | (ch(8) << 8) | 0xff) >>> 0;
}

/**
 * 海图画框：木框 + 羊皮纸刻度带（黑白相间的经纬刻度）。
 * 东西相连的地图（padPx > 0，为补边的像素宽）只画上下两边：左右是接缝，不是图边。
 */
function frameBorder(p: Px, padPx = 0) {
  const { w, h } = p;
  if (padPx > 0) {
    frameBands(p, padPx);
    return;
  }
  const ring = (k: number, c: string) => p.stroke(k, k, w - 2 * k, h - 2 * k, c);
  ring(0, ink.deep);
  ring(1, P.wood[3]);
  ring(2, P.wood[2]);
  ring(3, ink.brown);
  for (let k = 4; k <= 6; k++) ring(k, P.parchment);
  ring(7, ink.brown);
  const seg = 5 * C;
  for (let x = 8; x < w - 8; x++) {
    if (Math.floor((x - 8) / seg) % 2 === 0) {
      p.hline(x, x, 5, P.parchmentDeep);
      p.hline(x, x, h - 6, P.parchmentDeep);
    }
  }
  for (let y = 8; y < h - 8; y++) {
    if (Math.floor((y - 8) / seg) % 2 === 0) {
      p.vline(5, y, y, P.parchmentDeep);
      p.vline(w - 6, y, y, P.parchmentDeep);
    }
  }
  for (const [cx, cy] of [
    [0, 0],
    [w - 8, 0],
    [0, h - 8],
    [w - 8, h - 8],
  ]) {
    p.rect(cx, cy, 8, 8, P.wood[1]);
    p.stroke(cx, cy, 8, 8, ink.deep);
    p.poly(
      [
        [cx + 4, cy + 1],
        [cx + 7, cy + 4],
        [cx + 4, cy + 7],
        [cx + 1, cy + 4],
      ],
      P.gold[2],
    );
    p.set(cx + 3, cy + 3, P.gold[4]);
  }
}

/** 只有上下两边的画框（环绕地图）：同样的木框与刻度带，横贯整个宽度，没有四角的铜饰；刻度从原图的第 0 列起算。 */
function frameBands(p: Px, padPx: number) {
  const { w, h } = p;
  const band = (k: number, c: string) => {
    p.hline(0, w - 1, k, c);
    p.hline(0, w - 1, h - 1 - k, c);
  };
  band(0, ink.deep);
  band(1, P.wood[3]);
  band(2, P.wood[2]);
  band(3, ink.brown);
  for (let k = 4; k <= 6; k++) band(k, P.parchment);
  band(7, ink.brown);
  const seg = 5 * C;
  for (let x = 0; x < w; x++) {
    if (Math.floor((x - padPx + 1000 * seg) / seg) % 2 === 0) {
      p.hline(x, x, 5, P.parchmentDeep);
      p.hline(x, x, h - 6, P.parchmentDeep);
    }
  }
}
