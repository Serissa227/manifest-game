// 航海图美术：整张世界海图位图，以及海图上的各种标记（港口、内陆城市、殖民点、发现物、罗盘玫瑰、风向箭头、
// 迷雾、选中框、旗舰标记、商队、目的地、航线点）。
// 全部是纯函数，不依赖 DOM，可在 Node 中预览（见 map.preview.ts）；map/renderer.ts 把它们做成 PixiJS 纹理。
// 接口（导出的函数签名与类型）由渲染器依赖，只做向后兼容的扩展；画法可以随意重写。
// 画法拆在 ./map/ 目录：noise（噪声与距离场）、geo（地理图层与平滑海岸）、terrain（海图位图）、flora（树种）、
// culture（人文景观与道路）、rivers（河流）、landmarks（地标与奇观）、biomes（旧的按文化推断的生物群系，兼容接口）、
// fog（迷雾）、places（地点标记）、marks（动态与装饰标记）、types（公共类型）。
//
// 坐标约定：海图每格 CHART_CELL 像素，格 (x, y) 的中心在像素 (x·CELL + CELL/2, y·CELL + CELL/2)。
import { locById } from "../ipc/byId";
import type { StaticView } from "../ipc/types";
import type { Px } from "./px";
import { memo } from "./render";
import { hash32 } from "./rng";
import { paintChart } from "./map/terrain";
import type { ChartInput, ChartLandmark, ChartOpts, ChartPlace, ChartPlaceKind, ChartProjection, ChartRiver, ChartRoad } from "./map/types";

export {
  CHART_CELL,
  CHART_FRAME,
  DISCOVERY_KINDS,
  NEW_WORLD_X,
  type ChartInput,
  type ChartLandmark,
  type ChartOpts,
  type ChartPlace,
  type ChartPlaceKind,
  type ChartProjection,
  type ChartRiver,
  type ChartRoad,
  type DiscoveryKind,
  type LandmarkCategory,
  type SiteMark,
} from "./map/types";
export { BIOME, biomeGrid, type Biome } from "./map/biomes";
export { VEG, VEG_CODES, type Veg } from "./map/geo";
export { CLASSIC_ROWS, classicLatOf, isNewWorld, latitudeAt, longitudeAt } from "./map/projection";
export { WRAP_MARGIN, padWrapInput } from "./map/wrap";
export { LANDMARK_CATEGORIES, LANDMARK_KINDS, drawLandmarkIcon, landmarkIconKey } from "./map/landmarks";
export { FogPainter, drawFog, type PxRect } from "./map/fog";
// 天况标记与夜间灯火（第四批，EXPANSION.md §9.3）
export { WEATHER_FRAMES, WEATHER_VARIANTS, drawPortLight, drawWeatherMark, lightSwatch, weatherSwatch } from "./map/weather";
// 天气特效的雨线、雪片与闪电（第九批）
export { drawLightningBolt, drawRainStreak, drawSnowFlake, type FxTone } from "./map/weather";
export {
  PLAYER_FLAG,
  drawCityMarker,
  drawDiscoveryMarker,
  drawPlaceDot,
  drawPortMarker,
  drawSiteMarker,
  markerStyle,
  siteMarkKey,
} from "./map/places";
export {
  CARAVAN_FRAMES,
  FLAGSHIP_FRAMES,
  FLASH_FRAMES,
  SELECT_FRAMES,
  VIGNETTE_FRAMES,
  WIND_DIRS,
  drawCaravanMarker,
  drawChevron,
  drawCompassRose,
  drawDestPin,
  drawDiscoveryFlash,
  drawFlagshipRing,
  drawRouteDot,
  drawSeaVignette,
  drawSelectFrame,
  drawWake,
  drawWindArrow,
  fogSwatch,
} from "./map/marks";

/** 静态数据里的地点与势力可能带有的扩展字段（缺失时按旧数据处理）。殖民点的地形在 site.terrain（旧的测试数据写在 terrain）。 */
interface LocExtra {
  kind: string;
  terrain?: string | null;
  site?: { terrain?: string | null } | null;
}
interface FactionExtra {
  key: string;
  style?: string | null;
}

const PLACE_KINDS: readonly ChartPlaceKind[] = ["port", "city", "site"];

/**
 * 由静态数据整理出海图输入（含 §10.3 的高程、植被、河流与地标图层；旧后端没有这些字段时缺省）。
 * 第九批：地图资源的投影由 projection 给出（StaticView.map 不带投影）；map.wrap_x 为 true 时按环绕绘制。
 */
export function chartInput(
  s: Pick<StaticView, "map" | "locations" | "factions" | "roads"> & Partial<Pick<StaticView, "rivers" | "landmarks">>,
  projection?: ChartProjection | null,
): ChartInput {
  const places: ChartPlace[] = s.locations.map((l) => {
    const ext = l as LocExtra;
    const f = s.factions[l.faction] as FactionExtra | undefined;
    const kind = (PLACE_KINDS as readonly string[]).includes(ext.kind) ? (ext.kind as ChartPlaceKind) : "port";
    return {
      x: l.x,
      y: l.y,
      kind,
      faction: f?.key ?? "",
      style: f?.style ?? null,
      terrain: ext.site?.terrain ?? ext.terrain ?? null,
    };
  });
  const roads: ChartRoad[] = [];
  for (const r of s.roads) {
    const a = locById(s, r.from);
    const b = locById(s, r.to);
    if (a && b) roads.push({ from: [a.x, a.y], to: [b.x, b.y] });
  }
  const input: ChartInput = { width: s.map.width, height: s.map.height, rows: s.map.rows, places, roads };
  if (s.map.relief) input.relief = s.map.relief;
  if (s.map.biomes) input.biomes = s.map.biomes;
  if (s.rivers) input.rivers = s.rivers.map((r): ChartRiver => ({ key: r.key, path: r.path, width: r.width }));
  if (s.landmarks)
    input.landmarks = s.landmarks.map((l): ChartLandmark => ({ key: l.key, category: l.category, kind: l.kind, x: l.x, y: l.y, w: l.w, h: l.h }));
  if (projection) input.projection = projection;
  if (s.map.wrap_x === true) input.wrapX = true;
  return input;
}

/** 整张世界海图（宽 width·CELL、高 height·CELL）。同一输入只生成一次。 */
export function drawChart(input: ChartInput, opts: ChartOpts = {}): Px {
  const season = ((opts.season ?? 1) % 4 + 4) % 4;
  return memo(chartMemoKey(input, season), () => paintChart(input, season));
}

/** drawChart 在记忆化缓存里的键（季节 0–3；换季、离开世界时据此释放不再用的整图）。 */
export function chartMemoKey(input: ChartInput, season: number): string {
  const placesKey = (input.places ?? []).map((p) => `${p.x},${p.y},${p.kind},${p.faction},${p.style ?? ""},${p.terrain ?? ""}`).join(";");
  const roadsKey = (input.roads ?? []).map((r) => `${r.from}-${r.to}`).join(";");
  // 地理图层：高程、植被、河流与地标
  const layersKey = [
    input.relief ? hash32(input.relief.join("\n")) : "",
    input.biomes ? hash32(input.biomes.join("\n")) : "",
    hash32((input.rivers ?? []).map((r) => `${r.width}:${r.path.join(";")}`).join("|")),
    hash32((input.landmarks ?? []).map((l) => `${l.key}:${l.category}:${l.kind}:${l.x},${l.y},${l.w ?? 1},${l.h ?? 1}`).join("|")),
  ].join(":");
  // 第九批：投影与环绕（经典世界没有，键与以前相同）
  const p = input.projection;
  // 细图层（M01）：有了它整张海图的海岸就换成真实海岸（经典世界没有，键与以前相同）
  const fine = input.fine ? `:fine${input.fine.hash}${input.fineOffsetX ? `@${input.fineOffsetX}` : ""}` : "";
  const f9 = (p ? `:p${p.west},${p.north},${p.arcmin_per_cell}` : "") + (input.wrapX ? ":wrap" : "") + fine;
  return `chart:${input.width}x${input.height}:${hash32(input.rows.join("\n"))}:${hash32(placesKey + "|" + roadsKey)}:${layersKey}:${input.newWorldX ?? ""}:${season}${f9}`;
}
