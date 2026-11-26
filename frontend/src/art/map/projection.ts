// 海图的经纬与气候换算（FRAMEWORK §5.3）：有投影的地图按真实纬度推断气候、积雪与“新大陆”；
// 没有投影的地图（经典世界）保持旧行为——纬度按 170 行的世界比例换算、新大陆是 x ≥ NEW_WORLD_X 的一侧
// （调用方在没有投影时照旧用原来的算式，保证经典世界的海图逐像素不变）。
// 全部是纯函数（可以在后台线程里用）。
import { NEW_WORLD_X, type ChartInput, type ChartProjection } from "./types";

/** 经典世界的标准行数：旧的气候阈值都按它写（第 0 行是极北，第 170 行是热带）。 */
export const CLASSIC_ROWS = 170;

/** 行 y（格，可以是小数；0 为第 0 行的上缘）的纬度（度，北纬为正）。 */
export function latitudeAt(p: ChartProjection, y: number): number {
  return (p.north - y * p.arcmin_per_cell) / 60;
}

/** 列 x（格，可以是小数；0 为第 0 列的左缘）的经度（度，归到 [-180, 180)）。 */
export function longitudeAt(p: ChartProjection, x: number): number {
  const lon = (p.west + x * p.arcmin_per_cell) / 60;
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * 真实纬度 → 经典世界的“纬度行”（旧的气候阈值所用的刻度）。按纬度的绝对值分段线性换算，南北半球对称：
 * 72° 以北冰原、66°–72° 冻原、56°–66° 针叶林、42°–56° 温带、32°–42° 地中海、18°–32° 副热带沙漠、18° 以内热带。
 */
const CLIMATE_KNOTS: readonly (readonly [number, number])[] = [
  [90, -10],
  [72, 7],
  [66, 16],
  [56, 42],
  [42, 80],
  [32, 104],
  [18, 124],
  [0, 170],
];

export function classicLatOf(latDeg: number): number {
  const a = Math.min(90, Math.abs(latDeg));
  for (let i = 1; i < CLIMATE_KNOTS.length; i++) {
    const [d0, v0] = CLIMATE_KNOTS[i - 1];
    const [d1, v1] = CLIMATE_KNOTS[i];
    if (a >= d1) return v0 + ((d0 - a) / (d0 - d1)) * (v1 - v0);
  }
  return CLIMATE_KNOTS[CLIMATE_KNOTS.length - 1][1];
}

/** 有投影时，格行 y（格，可以是小数；按行中心取纬度）的经典纬度刻度。 */
export function projectedClassicLat(p: ChartProjection, y: number): number {
  return classicLatOf(latitudeAt(p, y + 0.5));
}

/** 某行是否在南半球（季节相反）。没有投影的地图都算北半球。 */
export function southernAt(input: Pick<ChartInput, "projection">, yCells: number): boolean {
  const p = input.projection;
  return !!p && latitudeAt(p, yCells + 0.5) < 0;
}

/** 新大陆（美洲）的经度范围（度）：有投影的地图按经度判断。 */
export const NEW_WORLD_LON: readonly [number, number] = [-170, -25];

/** 列 x（格）是否属于“新大陆”：有投影时按经度，否则按 newWorldX（缺省 NEW_WORLD_X）。 */
export function isNewWorld(input: Pick<ChartInput, "projection" | "newWorldX">, x: number): boolean {
  const p = input.projection;
  if (!p) return x >= (input.newWorldX ?? NEW_WORLD_X);
  const lon = longitudeAt(p, x + 0.5);
  return lon >= NEW_WORLD_LON[0] && lon <= NEW_WORLD_LON[1];
}
