// 旧的按文化推断的生物群系（兼容接口）：每格按“最近的地点”（坐标加低频扰动）与纬度定出一种。
// 海图的地貌已改为按 EXPANSION.md §10.3 的植被与高程图层绘制（见 terrain.ts、geo.ts），画法不再依赖这里；
// 只保留导出的 BIOME 与 biomeGrid，供旧代码与测试使用。
import { styleOf } from "../buildings";
import { fbmField } from "./noise";
import { classicLatOf, isNewWorld, latitudeAt } from "./projection";
import { CHART_CELL, type ChartInput, type ChartPlace } from "./types";

const C = CHART_CELL;

/** 生物群系编号（只追加，不改已有编号）。 */
export const BIOME = {
  /** 寒带雪原（最北端） */
  COLD: 0,
  /** 温带草地（未知风格） */
  TEMPERATE: 1,
  /** 低地：平原田块与运河 */
  FARM: 2,
  /** 沙漠 */
  ARID: 3,
  /** 热带群岛 */
  TROPIC: 4,
  /** 地中海：橄榄绿与赭石 */
  MEDIT: 5,
  /** 北地：针叶林与残雪 */
  BOREAL: 6,
  /** 东方：竹林与梯田 */
  EAST: 7,
  /** 新大陆：原始密林 */
  WILDWOOD: 8,
  /** 新大陆：草原 */
  PRAIRIE: 9,
  /** 新大陆：雨林 */
  JUNGLE: 10,
  /** 新大陆：沼泽 */
  SWAMP: 11,
} as const;
export type Biome = (typeof BIOME)[keyof typeof BIOME];
const { COLD, TEMPERATE, FARM, ARID, TROPIC, MEDIT, BOREAL, EAST, WILDWOOD, PRAIRIE, JUNGLE, SWAMP } = BIOME;
/** 地点的“自动”气候：新大陆按纬度与噪声决定。 */
const AUTO = 255;

/** 最北的冰原纬度（格）。 */
const POLAR_LAT = 11;
/** 旧世界南岸沙漠的纬度范围（格）：旧地图（高 120 格）最南的一带是沙漠。 */
const OLD_SOUTH: readonly [number, number] = [112, 124];
/** 新大陆的地点只影响这个半径（格）以内的地貌，更远处按纬度自动决定。 */
const NEW_WORLD_REACH = 30;
/** 殖民点按自己的地形决定周边地貌的半径（格）。 */
const SITE_REACH = 12;
/** 热带岛屿的最北纬度（格）：更北的岛屿按纬度自动决定地貌（北方的岛不长棕榈）。 */
const TROPIC_ISLAND_LAT = 90;

/** 殖民点地形 → 生物群系（y 为殖民点的纬度，格）。 */
function terrainBiome(t: string | null | undefined, y: number): number {
  switch (t) {
    case "forest":
      return WILDWOOD;
    case "plains":
    case "hills":
      return PRAIRIE;
    case "jungle":
      return JUNGLE;
    case "tundra":
      return COLD;
    case "desert":
      return ARID;
    case "swamp":
      return SWAMP;
    case "island":
      return y >= TROPIC_ISLAND_LAT ? TROPIC : AUTO;
    default:
      return AUTO;
  }
}

/** 地点 → 周边的生物群系（AUTO 表示按纬度自动）。 */
function placeBiome(p: ChartPlace, inNewWorld: (x: number) => boolean): number {
  if (p.kind === "site") return terrainBiome(p.terrain, p.y);
  const style = styleOf(p.faction || undefined, p.style);
  if (style === "eastern") return EAST;
  // 新大陆的殖民港：四周仍是荒野（群岛与沙漠风格的港口保留各自的地貌）
  if (inNewWorld(p.x) && style !== "islands" && style !== "desert") return AUTO;
  switch (style) {
    case "nordic":
      return BOREAL;
    case "lowland":
      return FARM;
    case "desert":
      return ARID;
    case "islands":
      return TROPIC;
    case "mediterranean":
      return MEDIT;
    case "frontier":
      return AUTO;
    default:
      return TEMPERATE;
  }
}

/** 新大陆按纬度（格）与低频噪声 n 决定的地貌。 */
function autoBiome(lat: number, n: number): number {
  if (lat < 40) return n > 0.6 ? PRAIRIE : WILDWOOD;
  if (lat < 104) return n > 0.52 ? PRAIRIE : n < 0.27 ? SWAMP : WILDWOOD;
  return n > 0.64 ? PRAIRIE : n < 0.3 ? SWAMP : JUNGLE;
}

/**
 * 每个查询点（格）最近的地点下标与平方距离；没有地点时下标为 −1。
 * 按 8×8 格分块，先筛出可能最近的候选（到块内查询点包围盒的最近距离不超过各地点最远距离的最小值），
 * 块内每格只比较候选——结果与逐个比较所有地点相同（等距时取下标小的）。
 */
function nearestGrid(xs: readonly number[], ys: readonly number[], qx: Float64Array, qy: Float64Array, W: number, H: number) {
  const n = xs.length;
  const idx = new Int32Array(W * H).fill(-1);
  const dist = new Float64Array(W * H).fill(Infinity);
  if (n === 0) return { idx, dist };
  const BS = 8;
  const cand = new Int32Array(n);
  for (let by = 0; by < H; by += BS) {
    for (let bx = 0; bx < W; bx += BS) {
      const x1 = Math.min(W, bx + BS);
      const y1 = Math.min(H, by + BS);
      let lx = Infinity;
      let ly = Infinity;
      let hx = -Infinity;
      let hy = -Infinity;
      for (let y = by; y < y1; y++) {
        for (let x = bx; x < x1; x++) {
          const i = y * W + x;
          if (qx[i] < lx) lx = qx[i];
          if (qx[i] > hx) hx = qx[i];
          if (qy[i] < ly) ly = qy[i];
          if (qy[i] > hy) hy = qy[i];
        }
      }
      let bound = Infinity;
      for (let k = 0; k < n; k++) {
        const fx = Math.max(Math.abs(xs[k] - lx), Math.abs(xs[k] - hx));
        const fy = Math.max(Math.abs(ys[k] - ly), Math.abs(ys[k] - hy));
        bound = Math.min(bound, fx * fx + fy * fy);
      }
      let nc = 0;
      for (let k = 0; k < n; k++) {
        const dx = xs[k] < lx ? lx - xs[k] : xs[k] > hx ? xs[k] - hx : 0;
        const dy = ys[k] < ly ? ly - ys[k] : ys[k] > hy ? ys[k] - hy : 0;
        if (dx * dx + dy * dy <= bound) cand[nc++] = k;
      }
      for (let y = by; y < y1; y++) {
        for (let x = bx; x < x1; x++) {
          const i = y * W + x;
          let best = -1;
          let bd = Infinity;
          for (let c = 0; c < nc; c++) {
            const k = cand[c];
            const dx = xs[k] - qx[i];
            const dy = ys[k] - qy[i];
            const d = dx * dx + dy * dy;
            if (d < bd) {
              bd = d;
              best = k;
            }
          }
          idx[i] = best;
          dist[i] = bd;
        }
      }
    }
  }
  return { idx, dist };
}

/**
 * 每格的生物群系（W×H，行优先）。离哪个港口或城市最近就用它的气候（坐标加低频扰动，边界更自然）；
 * 殖民点只影响附近 SITE_REACH 格、且比最近的港口更近时，按自己的地形决定；
 * 新大陆离港口太远、或最近的是旧世界港口时按纬度自动；最北是冰原，旧世界最南一带是沙漠。
 */
export function biomeGrid(input: ChartInput): Uint8Array {
  const W = Math.max(1, input.width);
  const H = Math.max(1, input.height);
  const PW = W * C;
  const PH = H * C;
  // 新大陆：有投影时按经度，否则按 newWorldX（缺省 NEW_WORLD_X，经典世界不变）
  const inNewWorld = (x: number) => isNewWorld(input, x);
  const proj = input.projection ?? null;
  const all = input.places ?? [];
  const towns = all.filter((p) => p.kind !== "site");
  const sites = all.filter((p) => p.kind === "site");
  const tb = towns.map((p) => placeBiome(p, inNewWorld));
  const sb = sites.map((p) => placeBiome(p, inNewWorld));
  const nOx = fbmField(PW, PH, 60, 21);
  const nOy = fbmField(PW, PH, 60, 22);
  const nLat = fbmField(PW, PH, 30, 23);
  const nAuto = fbmField(PW, PH, 104, 301);
  // 查询点：格中心加低频扰动（单位：格）
  const qx = new Float64Array(W * H);
  const qy = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x * C + C / 2;
      const py = y * C + C / 2;
      qx[y * W + x] = px / C + (nOx(px, py) - 0.5) * 18;
      qy[y * W + x] = py / C + (nOy(px, py) - 0.5) * 18;
    }
  }
  const tx = towns.map((p) => p.x);
  const near = nearestGrid(
    tx,
    towns.map((p) => p.y),
    qx,
    qy,
    W,
    H,
  );
  const nearSite = nearestGrid(
    sites.map((p) => p.x),
    sites.map((p) => p.y),
    qx,
    qy,
    W,
    H,
  );
  const reach2 = NEW_WORLD_REACH * NEW_WORLD_REACH;
  const siteReach2 = SITE_REACH * SITE_REACH;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const px = x * C + C / 2;
      const py = y * C + C / 2;
      const best = near.idx[i];
      const newWorld = inNewWorld(qx[i]);
      let b = best < 0 ? (newWorld ? AUTO : TEMPERATE) : tb[best];
      // 新大陆离港口太远处是荒野（靠近旧世界东岸的仍随旧世界的港口）
      if (newWorld && near.dist[i] > reach2) b = AUTO;
      // 殖民点附近按地形决定；东方帝国境内的普通地形（平原、丘陵、森林、岛屿）仍是东方的竹林梯田
      const s = nearSite.idx[i];
      if (s >= 0 && sb[s] !== AUTO && nearSite.dist[i] < siteReach2 && nearSite.dist[i] < near.dist[i]) {
        const generic = sb[s] === PRAIRIE || sb[s] === WILDWOOD || sb[s] === TROPIC;
        if (!(b === EAST && generic)) b = sb[s];
      }
      const lat = (proj ? classicLatOf(latitudeAt(proj, py / C)) : py / C) + (nLat(px, py) - 0.5) * 8;
      if (b === AUTO) b = autoBiome(lat, nAuto(px, py));
      if (lat < POLAR_LAT) b = COLD;
      else if (!newWorld && lat > OLD_SOUTH[0] && lat < OLD_SOUTH[1] && b !== COLD && b !== TROPIC) b = ARID;
      out[i] = b;
    }
  }
  return out;
}
