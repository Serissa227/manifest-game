// 港口街景合成：纯函数，不碰 DOM（浏览器里每帧调用，也可在 Node 中导出 PNG，见 port.preview.ts）。
//
// 构图（由远到近）：天空 → 云（随帧缓慢漂移）→ 远景山岛 → 后排天际线与地标 → 上街（官署类设施与民居）
// → 挡土墙 → 下街（交易所、酒馆、仓库、船厂，穿插民居、树与物件）→ 街面与行人 → 岸壁、栈桥与停泊的船
// → 海面（动画）与岸边浪花 → 海鸥。
// 内陆城市没有海与码头：右侧是城门楼与城外田野，街面下方是草地，城门外的路上有商队牲口。
// 殖民地与殖民点（kind 为 colony / site）另有一套荒野海湾的构图，规划见 colony.ts。
//
// 性能：静态部分（天空 + 城镇）按 (地点, 宽度, 季节, 设施, 悬停, 时段, 天况, 风朝东西) 缓存成整张底图与遮罩；
// 每帧只复制底图，再叠加云（只画在遮罩透明处）、海面（按预先算好的水面行段复制）、船、行人、海鸥等动的部分。
//
// 昼夜与天气（EXPANSION.md §9.3，画法见 look.ts）：底图里的每张小图按（时段, 天况）调色一次并缓存（灯光色保留），
// 夜里、黄昏与阴雨天按比例换用亮灯的民居与设施，街灯与灯笼周围铺上暖光；云按风的东西分量漂移，旗朝风的去向，
// 炊烟朝风的去向飘；雨丝、雪花、雾带与闪电每帧叠加。不给时段与天况时画面与之前完全一样（白天、晴）。
import { drawAnimal } from "../art/extras";
import {
  drawBuilding,
  drawCypress,
  drawHouse,
  drawLandmark,
  drawProp,
  drawSkyline,
  baseStyle,
  townStyleOf,
  type PropKind,
  type TownStyle,
} from "../art/buildings";
import { P } from "../art/palette";
import { drawIdle, drawWalker, portraitSpec, WALK_FRAMES, type NpcRole, type PortraitSpec } from "../art/portraits";
import { hex, Px, rgba } from "../art/px";
import { memo } from "../art/render";
import { hash32, rng, type Rng } from "../art/rng";
import {
  climateOf,
  drawCloud,
  drawDistantLand,
  drawGround,
  drawGull,
  drawPier,
  drawSea,
  drawSky,
  drawTree,
  gradeColor,
  SEA_FRAMES,
  shadeCached,
  skyStops,
  type Climate,
  type TimeOfDay,
  type Weather,
} from "../art/scenery";
import { drawShip, drawShipByKey, shipArtKey, SHIP_FRAMES } from "../art/ships";
import type { Facility } from "../store/game";
import { makeWildPlan, type SceneColony } from "./colony";
import {
  anchorX,
  bloom,
  drawBeacon,
  drawSmoke,
  glowCenter,
  glowStrength,
  gullCount,
  keepWalker,
  lightPool,
  litShare,
  lookOf,
  skyDeepColor,
  topPoint,
  weatherOverlay,
  type FogPlan,
} from "./look";
import {
  BERTH_BOTTOM,
  clamp,
  clipRect,
  cutRect,
  gapsOf,
  HORIZON,
  placeRow,
  SCENE_HEIGHT,
  type BuildingHotspot,
  type CloudPlan,
  type GullPlan,
  type Hotspot,
  type Op,
  type Plan,
  type Rect,
  type WalkerPlan,
} from "./layout";
import {
  bollard,
  buoy,
  farHeadland,
  fields,
  gateTower,
  glowRing,
  hazed,
  quayWall,
  rowboat,
  stairs,
  terraceEnd,
  terraceWall,
  verge,
} from "./props";

export { cutRect, SCENE_HEIGHT };
export type { BuildingHotspot, Hotspot, Rect };
export type { SceneColony, SceneColonyBuilding } from "./colony";
export { TERRAINS, type Terrain } from "./wild";
export { crossfade, LookFader, lookOf, type SceneLook } from "./look";

/** 街景的最小逻辑宽度：再窄就放不下全部设施。 */
export const SCENE_MIN_WIDTH = 400;

// ───────────────────────── 纵向布局（逻辑像素） ─────────────────────────
/** 上街地面线：后排设施与民居的底边 */
const UPPER_GY = 156;
/** 下街地面线：前排设施与民居的底边 */
const STREET_GY = 214;
/** 街面深度（行人走在这里） */
const STREET_H = 16;
/** 岸壁顶 */
const QUAY_Y = STREET_GY + STREET_H;
const QUAY_H = 9;
/** 城前水面的上沿 */
const WATER_Y = QUAY_Y + QUAY_H;
/** 栈桥桥面的上沿 */
const PIER_Y = QUAY_Y - 1;

// ───────────────────────── 对外类型 ─────────────────────────

export interface SceneShip {
  /** 船型下标（ships.toml 的顺序，= ShipTypeView.id） */
  type: number;
  sail: "square" | "lateen";
  /** 船型 key：与经典世界同一下标的 key 不同时才给（寰宇·十六世纪的新船型），画船时优先用它 */
  key?: string;
}

/** 画街景里这艘船用的 key。 */
export function sceneShipKey(ship: SceneShip): string {
  return ship.key ?? shipArtKey(null, ship.type);
}

export interface PortSceneParams {
  /** 地点 key：街景的一切随机布置都以它为种子 */
  key: string;
  /** 地点名称（只用于调试与预览） */
  name?: string;
  /** port 港口、city 内陆城市、colony 已建成的殖民地、site 尚未开发的殖民点 */
  kind: "port" | "city" | "colony" | "site";
  /** 所属势力的 key（没有 style 时由它决定建筑风格，见 townStyleOf） */
  faction: string;
  /** 势力数据的建筑风格（style 字段）；合法时优先于势力 key 的映射，第九批的文化风格（japanese、ming……）画成各自的街景 */
  style?: string | null;
  /** 势力旗色（"#rrggbb"），用于旗杆、城门楼与船旗 */
  flag?: string;
  /** 此地可用的设施（每个设施一座可点击的建筑） */
  facilities: readonly Facility[];
  /** 季节 0 春 1 夏 2 秋 3 冬 */
  season: number;
  /** 逻辑宽度（高度固定为 SCENE_HEIGHT） */
  width: number;
  /** 停泊在此的主角旗舰（第一艘船）；不在此港时为空 */
  flagship?: SceneShip | null;
  /** 其他停泊或往来的船数（最多画 3 艘） */
  others?: number;
  /** 行人数；缺省按宽度 */
  crowd?: number;
  /** 悬停或键盘聚焦中的设施：画亮描边 */
  hover?: Facility | null;
  /** 殖民地（kind 为 colony）：殖民建筑与等级、人口 */
  colony?: SceneColony | null;
  /** 殖民地与殖民点的地形（forest、plains、hills、jungle、tundra、desert、swamp、island），决定远景与植被；缺省为 forest */
  terrain?: string | null;
  /** 殖民点有没有古迹残垣；缺省按地点 key 决定 */
  ruins?: boolean | null;
  /** 悬停或键盘聚焦中的殖民建筑 key：画亮描边 */
  hoverBuilding?: string | null;
  /** 光照时段（缺省白天）：界面按时钟、速度与“昼夜光影”偏好给出（useScenePhase） */
  time?: TimeOfDay;
  /** 当地天况（缺省晴；不给时寒冷港口冬季照旧飘小雪） */
  weather?: Weather;
  /** 风的东西分量 −1（向西）..1（向东），指风的去向；缺省 1（云向右漂、旗朝右） */
  windX?: number;
  /** 风力 0–10（缺省 4.5）：云漂得快慢、炊烟吹得多斜 */
  windStrength?: number;
  /** 暴风雨时是否闪电（缺省是；4× 及以上由界面关掉） */
  lightning?: boolean;
}

export interface PortSceneLayout {
  width: number;
  height: number;
  hotspots: Hotspot[];
  /** 主角的船所占的矩形（“出港”按钮放在它附近）；旗舰不在此港时为 null */
  berth: Rect | null;
  /** 殖民地的殖民建筑热点（与设施热点互不重叠）；其他地点为空 */
  buildings: BuildingHotspot[];
  /** 殖民点：画面里留给“建立殖民地”按钮的空地；其他地点为 null */
  found: Rect | null;
}

/**
 * 此地可用的设施：内陆城市没有造船厂，只有设有期货交易所的地方才有期货交易所；
 * 尚未开发的殖民点没有设施；殖民地只有交易所与仓库（殖民地库存就是所有者在当地的仓库），有船厂时再加船厂。
 */
export function facilitiesAt(kind: "port" | "city" | "colony" | "site", hasShipyard: boolean, hasExchange: boolean): Facility[] {
  if (kind === "site") return [];
  if (kind === "colony") return (["market", "shipyard", "warehouse"] as Facility[]).filter((f) => f !== "shipyard" || hasShipyard);
  const all: Facility[] = ["market", "shipyard", "tavern", "guild", "bank", "exchange", "warehouse", "invest", "office"];
  return all.filter((f) => (f === "shipyard" ? kind === "port" && hasShipyard : f === "exchange" ? hasExchange : true));
}

// ───────────────────────── 规划（静态布局） ─────────────────────────

const planCache = new Map<string, Plan>();
const PLAN_LIMIT = 24;

function signature(p: PortSceneParams): string {
  const base = [p.key, p.kind, p.faction, p.style ?? "", p.flag ?? "", p.facilities.join(","), p.season, sceneWidth(p.width), p.crowd ?? ""];
  if (p.kind === "colony" || p.kind === "site") {
    const col = p.colony ? `${p.colony.population}:${p.colony.buildings.map((b) => `${b.key}${b.level}`).join(",")}` : "";
    const ship = p.flagship ? `${sceneShipKey(p.flagship)}${p.flagship.sail}` : "";
    base.push(p.terrain ?? "", String(p.ruins ?? ""), col, ship);
  }
  return base.join("|");
}

function sceneWidth(w: number): number {
  return Math.max(SCENE_MIN_WIDTH, Math.floor(w));
}

function building(fac: Facility, style: TownStyle, season: number, snow: boolean, lit = false): Px {
  return memo(`scene-bld|${fac}|${style}|${season}|${snow}${lit ? "|lit" : ""}`, () =>
    drawBuilding(fac, style, { season, snow, lit: lit || fac === "tavern" }).trimmed(),
  );
}

function house(style: TownStyle, variant: number, season: number, snow: boolean, lit = false): Px {
  return memo(`scene-house|${style}|${variant}|${season}|${snow}${lit ? "|lit" : ""}`, () => drawHouse(style, variant, { season, snow, lit }).trimmed());
}

/**
 * 文化风格的气候（决定树、远山与田野）：斯瓦希里海岸与尤卡坦都是热带，奥斯曼的港口按地中海东岸的温带
 * （不按它们粗分的沙漠、开拓者风格的气候，免得奥斯曼的街上长出仙人掌）；其余按粗分的风格（climateOf）。
 */
const TOWN_CLIMATE: Readonly<Partial<Record<TownStyle, Climate>>> = { swahili: "tropical", maya: "tropical", ottoman: "temperate" };

/** 确定性的 0–1 值（不消耗规划用的随机序列，保证加了昼夜之后白天的布局不变）。 */
function unit(tag: string): number {
  return hash32(tag) / 4294967296;
}

/** 民居之间的树：地中海与奥斯曼风格的城镇多种柏树，其余按气候。 */
function gapTree(style: TownStyle, climate: Climate, season: number, variant: number): Px {
  if ((style === "mediterranean" || style === "ottoman") && variant % 3 !== 0) return memo(`scene-cypress|${variant % 4}`, () => drawCypress(26 + (variant % 4) * 5, variant));
  return tree(climate, season, variant);
}

function tree(climate: Climate, season: number, variant: number): Px {
  return memo(`scene-tree|${climate}|${season}|${variant}`, () => drawTree(climate, season, variant).trimmed());
}

function prop(kind: PropKind, style: TownStyle, variant: number, flag?: string, lit = false): Px {
  return memo(`scene-prop|${kind}|${style}|${variant}|${flag ?? ""}${lit ? "|lit" : ""}`, () => drawProp(kind, style, { variant, flag, lit }).trimmed());
}

/** 后排官署类设施（上街）与前排营生类设施（下街，港口的船厂紧挨海湾）。 */
const UPPER_ORDER: Facility[] = ["invest", "bank", "exchange", "guild", "office"];
const LOWER_ORDER: Facility[] = ["tavern", "market", "warehouse", "shipyard"];

/** 设施门前摆的物件：[种类, 放在左侧还是右侧]。 */
const FAC_PROPS: Partial<Record<Facility, [PropKind, "l" | "r"][]>> = {
  market: [
    ["stall", "l"],
    ["crates", "r"],
    ["sacks", "r"],
  ],
  tavern: [
    ["bench", "l"],
    ["barrels", "r"],
  ],
  warehouse: [
    ["crates", "l"],
    ["sacks", "l"],
    ["cart", "r"],
  ],
  shipyard: [
    ["anchor", "l"],
    ["barrels", "r"],
  ],
  office: [["flagpole", "r"]],
  guild: [["flagpole", "l"]],
  bank: [["lamp", "r"]],
};

interface Placed {
  fac: Facility;
  px: Px;
  x: number;
}

/** 用民居与树填满一段空隙 [a, b)（画在设施之后的一层之前，所以设施压在它们上面）。 */
function fillGap(
  ops: Op[],
  a: number,
  b: number,
  gy: number,
  style: TownStyle,
  climate: Climate,
  season: number,
  snow: boolean,
  r: Rng,
  treeChance: number,
) {
  let x = a - r.int(2, 6);
  let guard = 0;
  const trees: Op[] = [];
  while (b - x > 14 && guard++ < 12) {
    const room = b - x;
    if (room >= 26 && !r.chance(treeChance)) {
      const hv = r.int(0, 999);
      const hp = house(style, hv, season, snow);
      if (hp.w > room + 10 && guard > 1) {
        // 放不下这座：换一棵树收尾
        const tp = gapTree(style, climate, season, r.int(0, 99));
        trees.push({ px: tp, x: Math.round(x + (room - tp.w) / 2), y: gy - tp.h + 1 });
        break;
      }
      const tag = `${style}|${hv}|${gy}|${x}`;
      ops.push({
        px: hp,
        x,
        y: gy - hp.h,
        flipX: r.chance(0.5),
        lit: () => house(style, hv, season, snow, true),
        litRank: 0.05 + unit(`lit|${tag}`) * 0.95,
        smoke: unit(`smoke|${tag}`) < 0.32,
      });
      x += hp.w - r.int(1, 4);
    } else {
      const tp = gapTree(style, climate, season, r.int(0, 99));
      trees.push({ px: tp, x: x - 2, y: gy - tp.h + 1 });
      x += Math.max(8, tp.w - 6);
    }
  }
  // 树画在民居前面
  ops.push(...trees);
}

function plan(params: PortSceneParams): Plan {
  const sig = signature(params);
  const hit = planCache.get(sig);
  if (hit) {
    planCache.delete(sig);
    planCache.set(sig, hit);
    return hit;
  }
  const made = makePlan(params);
  planCache.set(sig, made);
  if (planCache.size > PLAN_LIMIT) {
    const oldest = planCache.keys().next().value;
    if (oldest !== undefined) planCache.delete(oldest);
  }
  return made;
}

function makePlan(params: PortSceneParams): Plan {
  const width = sceneWidth(params.width);
  if (params.kind === "colony" || params.kind === "site") return makeWildPlan(params, width);
  // town：画建筑用的城镇风格（第九批的文化风格各有画法）；style：粗分的风格（地面、挡土墙、岸壁、气候……）
  const town = townStyleOf(params.faction, params.style);
  const style = baseStyle(town);
  const climate = TOWN_CLIMATE[town] ?? climateOf(style);
  const season = ((params.season % 4) + 4) % 4;
  const snow = season === 3 && climate === "cold";
  const kind = params.kind;
  const flag = params.flag ?? P.red[2];
  const r = rng(`scene-${params.key}`);
  const ops: Op[] = [];

  // ── 设施分到上下两排 ──
  const present = new Set(params.facilities);
  let upper = UPPER_ORDER.filter((f) => present.has(f));
  let lower = LOWER_ORDER.filter((f) => present.has(f));
  for (const f of params.facilities) if (!upper.includes(f) && !lower.includes(f)) upper.push(f);
  const bld = (f: Facility) => building(f, town, season, snow);
  const sum = (l: Facility[]) => l.reduce((a, f) => a + bld(f).w, 0);

  // 城镇区宽度按设施所需自适应：放得下全部设施、设施之间还能穿插民居；其余给海湾（或城门外）
  // 两排的宽度尽量均衡：把上排最窄的设施挪到下排最左边，只要这样能让较宽的一排变窄
  const rowNeed = (u: Facility[], l: Facility[]) => Math.max(sum(u) + 20, sum(l) + 6);
  for (let guard = 0; guard < 2 && upper.length > 1; guard++) {
    const narrow = [...upper].sort((a, b) => bld(a).w - bld(b).w)[0];
    const u2 = upper.filter((f) => f !== narrow);
    const l2 = [narrow, ...lower];
    if (rowNeed(u2, l2) >= rowNeed(upper, lower)) break;
    upper = u2;
    lower = l2;
  }
  // 城镇区宽度按设施所需自适应，其余给海湾（或城门外）；海湾至少留出能停下主角大船的宽度
  const need = Math.round(rowNeed(upper, lower) * 1.06) + 10;
  const sideW =
    kind === "port"
      ? clamp(width - need, clamp(Math.round(width * 0.27), 124, 210), Math.round(width * 0.42))
      : clamp(width - need, 96, Math.round(width * 0.3));
  const townW = width - sideW;

  // ── 远景：山岛与天际线 ──
  let beacon: Plan["beacon"] = null;
  const land = memo(`scene-land|${width}|${climate}|${season}`, () => drawDistantLand(width, 52, climate, season));
  ops.push({ px: land, x: 0, y: HORIZON + 2 - land.h });
  if (kind === "port") {
    // 海湾远处的海岬与灯塔
    const head = farHeadland(climate, snow);
    ops.push({ px: head, x: width - head.w + 8, y: HORIZON + 1 - head.h });
    // 灯室在海岬图的 (48, 2)
    beacon = { x: width - head.w + 8 + 48, y: HORIZON + 1 - head.h + 2 };
  }

  const skyline = memo(`scene-skyline|${town}|${townW}|${season}|${snow}`, () =>
    drawSkyline(town, Math.max(20, townW - (kind === "port" ? 16 : 24)), { season, snow }),
  );

  const upperSpan: [number, number] = [4, townW - (kind === "port" ? 14 : 26)];
  const lowerSpan: [number, number] = [2, townW - (kind === "port" ? 2 : 30)];
  const upperPlaced = placeRow(
    upper.map((fac) => ({ fac, px: bld(fac) })),
    upperSpan[0],
    upperSpan[1],
    r,
  );
  const lowerPlaced = placeRow(
    lower.map((fac) => ({ fac, px: bld(fac) })),
    lowerSpan[0],
    lowerSpan[1],
    r,
  );

  // ── 后排：天际线、地标 ──
  ops.push({
    px: skyline,
    x: 0,
    y: UPPER_GY - 2 - skyline.h,
    lit: () =>
      memo(`scene-skyline|${town}|${townW}|${season}|${snow}|lit`, () =>
        drawSkyline(town, Math.max(20, townW - (kind === "port" ? 16 : 24)), { season, snow, lit: true }),
      ),
    litRank: 0.3,
  });
  const landmark = memo(`scene-landmark|${town}|${season}|${snow}`, () => drawLandmark(town, { season, snow }).trimmed());
  {
    // 地标立在上排最宽的空隙后面
    const gaps = gapsOf(upperPlaced, upperSpan[0], upperSpan[1]);
    const best = gaps.reduce((a, g) => (g[1] - g[0] > a[1] - a[0] ? g : a), [0, Math.round(townW * 0.2)] as [number, number]);
    const lx = clamp(Math.round((best[0] + best[1]) / 2 - landmark.w / 2), 0, Math.max(0, townW - landmark.w - 8));
    ops.push({
      px: landmark,
      x: lx,
      y: UPPER_GY - 6 - landmark.h,
      lit: () => memo(`scene-landmark|${town}|${season}|${snow}|lit`, () => drawLandmark(town, { season, snow, lit: true }).trimmed()),
      litRank: 0.2,
    });
  }

  // ── 上街：民居与树 → 设施 → 物件 ──
  for (const [a, b] of gapsOf(upperPlaced, upperSpan[0] - 30, upperSpan[1] + (kind === "port" ? 8 : 0))) {
    fillGap(ops, a, b, UPPER_GY, town, climate, season, snow, r, 0.3);
  }
  for (const p of upperPlaced) {
    ops.push({ px: p.px, x: p.x, y: UPPER_GY - p.px.h, fac: p.fac, lit: () => building(p.fac, town, season, snow, true), litRank: 0 });
    pushProps(ops, p, UPPER_GY, town, flag);
  }
  // 上街的地面（窄窄一条人行道）
  // 地中海与开拓者的街面暂借用低地、北地的地面画法，那两种地面冬天有积雪；这两种风格是温带，冬天的街面按秋天画
  const groundSeason = (style === "mediterranean" || style === "frontier") && season === 3 && !snow ? 2 : season;
  const upperWalk = memo(`scene-upperwalk|${townW}|${style}|${groundSeason}`, () => drawGround(townW, 4, style, groundSeason));
  ops.push({ px: upperWalk, x: 0, y: UPPER_GY - 1 });

  // ── 挡土墙（港口一侧在海湾前收头，转角砌隅石） ──
  const wallW = kind === "port" ? townW - 6 : townW;
  const wallH = STREET_GY - UPPER_GY - 2;
  ops.push({ px: terraceWall(wallW, wallH, style, params.key, snow, season), x: 0, y: UPPER_GY + 2 });
  if (kind === "port") {
    const end = terraceEnd(wallH + 3, style, snow);
    ops.push({ px: end, x: wallW - end.w + 2, y: UPPER_GY - 1 });
  }

  if (kind === "city") {
    // ── 城门外的田野与树、城门楼（都在下街之后的远处） ──
    const fieldsW = width - townW + 30;
    const fieldsH = STREET_GY - (HORIZON - 2);
    ops.push({ px: fields(fieldsW, fieldsH, climate, season, snow, params.key), x: townW - 30, y: HORIZON - 2 });
    const nTrees = Math.max(2, Math.floor(fieldsW / 40));
    for (let i = 0; i < nTrees; i++) {
      const tp = tree(climate, season, 100 + i);
      ops.push({ px: tp, x: townW + 10 + Math.round((i * fieldsW) / nTrees) + r.int(-8, 8), y: STREET_GY - tp.h + 1 });
    }
    const gate = gateTower(town, flag);
    ops.push({ px: gate, x: townW - 34, y: STREET_GY + 2 - gate.h });
  }

  // ── 下街：民居与树 → 设施 → 物件 ──
  // 下排最宽的一段内侧空隙留给通往上街的石阶，其余空隙填民居与树
  const inner = gapsOf(lowerPlaced, lowerSpan[0], lowerSpan[1]).filter(([a, b]) => a > lowerSpan[0] && b < lowerSpan[1]);
  const stairGap = inner.reduce<[number, number] | null>((best, g) => (g[1] - g[0] >= 26 && (!best || g[1] - g[0] > best[1] - best[0]) ? g : best), null);
  if (stairGap) {
    const sw = Math.min(44, stairGap[1] - stairGap[0] - 2);
    const st = stairs(sw, STREET_GY - UPPER_GY, style, snow);
    ops.push({ px: st, x: Math.round((stairGap[0] + stairGap[1] - sw) / 2), y: UPPER_GY });
  }
  for (const [a, b] of gapsOf(lowerPlaced, lowerSpan[0] - 30, lowerSpan[1])) {
    if (stairGap && a === stairGap[0] && b === stairGap[1]) continue;
    fillGap(ops, a, b, STREET_GY, town, climate, season, snow, r, 0.4);
  }
  for (const p of lowerPlaced) {
    ops.push({
      px: p.px,
      x: p.x,
      y: STREET_GY - p.px.h,
      fac: p.fac,
      lit: () => building(p.fac, town, season, snow, true),
      litRank: 0,
      smoke: p.fac === "tavern" || p.fac === "shipyard",
    });
  }
  // 街面
  const streetW = kind === "port" ? townW + 4 : width;
  const street = memo(`scene-street|${streetW}|${style}|${groundSeason}`, () => drawGround(streetW, STREET_H, style, groundSeason));
  ops.push({ px: street, x: 0, y: STREET_GY });
  for (const p of lowerPlaced) pushProps(ops, p, STREET_GY, town, flag);
  // 街灯：放在下排较宽的空隙里
  for (const [a, b] of gapsOf(lowerPlaced, lowerSpan[0], lowerSpan[1])) {
    if (b - a < 18 || (stairGap && a === stairGap[0])) continue;
    const lamp = prop("lamp", town, 0);
    ops.push({ px: lamp, x: Math.round((a + b) / 2 - lamp.w / 2), y: STREET_GY + 3 - lamp.h, lit: () => prop("lamp", town, 0, undefined, true), glow: 12, litRank: 0 });
  }

  let pier: Plan["pier"] = null;
  let caravan: Plan["caravan"] = null;
  let berthX = townW + 4;
  const buoys: Plan["buoys"] = [];
  if (kind === "port") {
    // ── 海湾一侧：岸壁的尽头、栈桥 ──
    ops.push({ px: quayWall(townW + 4, QUAY_H, style, params.key, snow), x: 0, y: QUAY_Y });
    for (let x = 16; x < townW - 4; x += 36) ops.push({ px: bollard(), x, y: QUAY_Y - 4 });
    // 岸边系着的小划艇（在城前水面上）
    const boats = Math.max(1, Math.floor(townW / 170));
    for (let i = 0; i < boats; i++) {
      const b = rowboat(r.int(0, 2));
      ops.push({ px: b, x: Math.round(((i + 0.5) * townW) / boats + r.int(-30, 30)), y: WATER_Y + 3 });
    }
    pier = { x: townW - 2, w: width - townW - 6 };
    berthX = townW + 2;
    const bay = width - townW;
    buoys.push({ x: townW + Math.round(bay * 0.18), y: HORIZON + 38 });
    if (bay > 160) buoys.push({ x: townW + Math.round(bay * 0.62), y: HORIZON + 22 });
  } else {
    // 前景草地
    ops.push({ px: verge(width, SCENE_HEIGHT - QUAY_Y, climate, season, snow, params.key), x: 0, y: QUAY_Y });
    // 前景的树（被画面下沿裁掉一半，拉开景深）
    for (let i = 0; i < Math.max(2, Math.floor(width / 200)); i++) {
      const tp = tree(climate, season, 200 + i);
      ops.push({ px: tp, x: Math.round(((i + 0.3) * width) / Math.max(2, Math.floor(width / 200))) + r.int(-20, 20), y: SCENE_HEIGHT + 8 - tp.h });
    }
    caravan = {
      x0: townW - 60,
      x1: width - 10,
      feet: STREET_GY + 13,
      animal: climate === "arid" ? 1 : climate === "cold" ? 3 : r.pick([0, 2, 3]),
      count: width > 560 ? 3 : 2,
      driver: portraitSpec(`${params.key}-caravan-driver`, "townsfolk"),
    };
  }

  // ── 热点：设施建筑的矩形，前面的挡住后面的 ──
  const rects: { fac: Facility; rect: Rect; z: number }[] = [];
  upperPlaced.forEach((p, i) => rects.push({ fac: p.fac, rect: { x: p.x, y: UPPER_GY - p.px.h, w: p.px.w, h: p.px.h }, z: i }));
  lowerPlaced.forEach((p, i) =>
    rects.push({ fac: p.fac, rect: { x: p.x, y: STREET_GY - p.px.h, w: p.px.w, h: p.px.h }, z: 100 + i }),
  );
  const hotspots: Hotspot[] = rects.map(({ fac, rect, z }) => {
    let a = clipRect(rect, width, SCENE_HEIGHT);
    for (const o of rects) if (o.z > z) a = cutRect(a, o.rect);
    return { facility: fac, ...a };
  });

  // ── 行人 ──
  const crowd = params.crowd ?? clamp(Math.round(townW / 42), 5, 16);
  const walkers: WalkerPlan[] = [];
  const roles: NpcRole[] = kind === "port" ? ["townsfolk", "townsfolk", "sailor"] : ["townsfolk"];
  const streetEnd = kind === "port" ? townW - 12 : width - 16;
  for (let i = 0; i < crowd; i++) {
    const idle = r.chance(0.2);
    walkers.push({
      spec: portraitSpec(`${params.key}-walker-${i}`, r.pick(roles)),
      feet: STREET_GY + 5 + r.int(0, 3) * 3,
      x0: 2,
      x1: streetEnd,
      speed: idle ? 0 : r.range(0.35, 1.1),
      phase: r.int(0, streetEnd * 2),
      faceLeft: r.chance(0.5),
    });
  }
  walkers.sort((a, b) => a.feet - b.feet);

  // ── 云与鸟 ──
  const clouds: CloudPlan[] = [];
  const nClouds = Math.max(3, Math.round(width / 120));
  for (let i = 0; i < nClouds; i++) {
    clouds.push({ variant: r.int(0, 99), y: r.int(6, 64), x0: r.int(0, width), speed: r.range(0.04, 0.12) });
  }
  const gulls: GullPlan[] = [];
  const nGulls = kind === "port" ? 3 : 2;
  for (let i = 0; i < nGulls; i++) {
    const cx = kind === "port" ? townW + r.int(-40, width - townW - 20) : r.int(40, width - 40);
    gulls.push({ cx, cy: r.int(40, 100), rx: r.int(24, 60), ry: r.int(6, 16), period: r.int(90, 160), phase: r.int(0, 999) });
  }

  return {
    width,
    style,
    town,
    climate,
    snow,
    kind,
    townW,
    ops,
    hotspots,
    buildings: [],
    found: null,
    walkers,
    clouds,
    gulls,
    caravan,
    pier,
    berthMode: "pier",
    berthX,
    anchorBottom: BERTH_BOTTOM,
    buoys,
    foam: null,
    beacon,
  };
}

function pushProps(ops: Op[], p: Placed, gy: number, style: TownStyle, flag: string) {
  const list = FAC_PROPS[p.fac];
  if (!list) return;
  let left = p.x + 2;
  let right = p.x + p.px.w - 2;
  list.forEach(([kind, side], i) => {
    const variant = hash32(`${p.fac}-${i}`) % 4;
    const px = prop(kind, style, variant, kind === "flagpole" ? flag : undefined);
    const y = gy + (kind === "flagpole" || kind === "lamp" ? 1 : 3) - px.h;
    // 街灯夜里点亮、周围铺一圈暖光；旗杆的旗朝风的去向
    const extra: Partial<Op> =
      kind === "lamp" ? { lit: () => prop("lamp", style, variant, undefined, true), glow: 12, litRank: 0 } : kind === "flagpole" ? { flag: true } : {};
    if (side === "l") {
      ops.push({ px, x: left - Math.round(px.w / 2), y, ...extra });
      left += Math.round(px.w * 0.7);
    } else {
      ops.push({ px, x: right - Math.round(px.w / 2), y, ...extra });
      right -= Math.round(px.w * 0.7);
    }
  });
}

// ───────────────────────── 底图（静态层）缓存 ─────────────────────────

interface Backdrop {
  /** 天空 + 城镇 */
  px: Px;
  /** 城镇不透明处为 1（云只画在 0 的地方） */
  mask: Uint8Array;
  /** 水面行段：[y, x0, x1)（海面只复制到这些地方） */
  water: Int32Array;
  /** 栈桥层（在海面、远处的船之后画） */
  front: { px: Px; x: number; y: number } | null;
  /** 炊烟的烟源（x, y 交替） */
  smoke: Int16Array;
  /** 灯光晕强度（0 表示白天不亮灯） */
  glow: number;
}

const backdrops = new Map<string, Backdrop>();
const BACKDROP_LIMIT = 12;

function skyOf(width: number, season: number, time: TimeOfDay = "day", weather: Weather = "clear"): Px {
  if (time === "day" && weather === "clear") return memo(`scene-sky|${width}|${season}`, () => drawSky(width, HORIZON + 2, { season }));
  return memo(`scene-sky|${width}|${season}|${time}|${weather}`, () => drawSky(width, HORIZON + 2, { season, time, weather }));
}

/** 街景天空最上方的颜色（舞台比街景高时向上延伸的天色）。 */
export function sceneSkyTop(params: Pick<PortSceneParams, "season" | "time" | "weather">): string {
  const stops = skyStops({ season: params.season, time: params.time, weather: params.weather });
  return hex(skyDeepColor(stops[0][1]));
}

function backdrop(params: PortSceneParams, pl: Plan): Backdrop {
  const look = lookOf(params);
  const { time, weather } = look;
  const west = look.windX < 0;
  const key = `${signature(params)}|${params.hover ?? ""}|${params.hoverBuilding ?? ""}|${time}|${weather}|${west ? "w" : "e"}`;
  const hit = backdrops.get(key);
  if (hit) {
    backdrops.delete(key);
    backdrops.set(key, hit);
    return hit;
  }
  const { width } = pl;
  const season = ((params.season % 4) + 4) % 4;
  const share = litShare(time, weather);
  const glowK = glowStrength(time, weather);
  const town = new Px(width, SCENE_HEIGHT);
  const lights: [number, number, number, number][] = [];
  const smoke: number[] = [];
  for (const op of pl.ops) {
    let src = op.px;
    let x = op.x;
    let flip = !!op.flipX;
    // 亮灯：按亮灯比例换用亮灯变体（尺寸不同时不换，保证热点与画面对齐）
    let lit = false;
    if (op.lit && share > 0 && (op.litRank ?? 0) < share) {
      const l = op.lit();
      if (l.w === src.w && l.h === src.h) {
        src = l;
        lit = true;
      }
    }
    // 旗朝风的去向：风朝西时以旗杆为轴翻转
    if (op.flag && west) {
      const a = anchorX(op.px);
      const world = op.x + (flip ? op.px.w - 1 - a : a);
      flip = !flip;
      x = world - (flip ? op.px.w - 1 - a : a);
    }
    town.blit(shadeCached(src, time, weather), x, op.y, { flipX: flip });
    const hot = (op.fac && op.fac === params.hover) || (op.bld && op.bld === params.hoverBuilding);
    if (hot) {
      // 悬停：建筑整体提亮一点，外加两像素亮描边（不随时段调色，夜里也看得清）
      town.blit(op.px, op.x, op.y, { tint: P.lamp[2], alpha: 0.18 });
      town.blit(glowRing(op.px, `${op.fac ?? op.bld}|${op.px.w}x${op.px.h}|${pl.town ?? pl.style}|${season}|${pl.snow}`), op.x - 2, op.y - 2);
    }
    if (lit && op.glow && glowK > 0) {
      const c = glowCenter(src);
      if (c) lights.push([x + (flip ? src.w - 1 - c[0] : c[0]), op.y + c[1], op.glow, op.y + src.h - 1]);
    }
    if (op.smoke) {
      const t = topPoint(op.px);
      smoke.push(x + (flip ? op.px.w - 1 - t[0] : t[0]), op.y + t[1]);
    }
  }
  const mask = new Uint8Array(width * SCENE_HEIGHT);
  for (let i = 0; i < mask.length; i++) mask[i] = town.data[i] & 0xff ? 1 : 0;

  // 水面行段：港口（以及殖民地、殖民点）在海平线以下、城镇不透明之外的地方
  const spans: number[] = [];
  if (pl.kind !== "city") {
    for (let y = HORIZON; y < SCENE_HEIGHT; y++) {
      let x = 0;
      while (x < width) {
        while (x < width && mask[y * width + x]) x++;
        const s = x;
        while (x < width && !mask[y * width + x]) x++;
        if (x > s) spans.push(y, s, x);
      }
    }
  }

  const px = new Px(width, SCENE_HEIGHT);
  px.blit(skyOf(width, season, time, weather), 0, 0);
  px.blit(town, 0, 0);
  if (glowK > 0) {
    // 亮窗的泛光、街灯与灯笼的光晕、灯塔的灯室
    bloom(px, mask, glowK);
    for (const [cx, cy, r, gy] of lights) lightPool(px, cx + 0.5, cy + 0.5, r, glowK, gy);
    if (pl.beacon) lightPool(px, pl.beacon.x + 0.5, pl.beacon.y + 0.5, 7, glowK);
  }

  let front: Backdrop["front"] = null;
  if (pl.pier && pl.pier.px) {
    // 殖民地的码头：画好的码头精灵
    front = { px: shadeCached(pl.pier.px, time, weather), x: pl.pier.x, y: pl.pier.y ?? PIER_Y };
  } else if (pl.pier && pl.pier.w > 0) {
    const pier = memo(`scene-pier|${pl.pier.w}|${pl.style}`, () => drawPier(pl.pier ? pl.pier.w : 1, pl.style));
    const f = new Px(pl.pier.w + 4, pier.h + 6);
    f.blit(pier, 0, 0);
    for (let x = 10; x < pl.pier.w - 4; x += 40) f.blit(bollard(), x, 0);
    front = { px: shadeCached(f, time, weather), x: pl.pier.x, y: PIER_Y - 4 };
    // 栈桥桥面与岸壁同高：桥面上沿对齐街面下沿
    front.y = PIER_Y;
  }

  const made: Backdrop = { px, mask, water: Int32Array.from(spans), front, smoke: Int16Array.from(smoke), glow: glowK };
  backdrops.set(key, made);
  if (backdrops.size > BACKDROP_LIMIT) {
    const oldest = backdrops.keys().next().value;
    if (oldest !== undefined) backdrops.delete(oldest);
  }
  return made;
}

// ───────────────────────── 每帧合成 ─────────────────────────

/** 只在遮罩为 0（天空）处叠加一张图（云在城镇之后）。 */
function blitBehind(out: Px, src: Px, x: number, y: number, mask: Uint8Array) {
  const W = out.w;
  for (let sy = 0; sy < src.h; sy++) {
    const dy = y + sy;
    if (dy < 0 || dy >= out.h) continue;
    for (let sx = 0; sx < src.w; sx++) {
      const dx = x + sx;
      if (dx < 0 || dx >= W) continue;
      if (mask[dy * W + dx]) continue;
      const v = src.data[sy * src.w + sx];
      if (v & 0xff) out.set(dx, dy, v);
    }
  }
}

/** 雾带的位置：远处一条压在海平线上（只画在天空与海面），近处两条贴着街面与水面的薄雾。 */
function fogPlan(pl: Plan): FogPlan {
  const low = pl.kind === "colony" || pl.kind === "site" ? 222 : STREET_GY + 10;
  return {
    far: [{ cy: HORIZON - 8, hh: 14, k: 0.9 }],
    near: [
      { cy: low, hh: 5, k: 0.42 },
      { cy: SCENE_HEIGHT - 12, hh: 7, k: 0.5 },
    ],
  };
}

function shipSprite(ship: SceneShip, flag: string, frame: number): Px {
  const f = ((frame % SHIP_FRAMES) + SHIP_FRAMES) % SHIP_FRAMES;
  const key = sceneShipKey(ship);
  return memo(`scene-ship|${key}|${ship.sail}|${flag}|${f}|large`, () =>
    drawShipByKey(key, ship.sail, { size: "large", flag, frame: f }).trimmed(),
  );
}

function smallShip(type: number, sail: "square" | "lateen", flag: string, frame: number): Px {
  const f = ((frame % SHIP_FRAMES) + SHIP_FRAMES) % SHIP_FRAMES;
  return memo(`scene-ship|${type}|${sail}|${flag}|${f}|small`, () =>
    drawShip(type, sail, { size: "small", flag, frame: f }).trimmed(),
  );
}

function seaFrame(width: number, frame: number, time: TimeOfDay = "day", weather: Weather = "clear"): Px {
  const f = ((frame % SEA_FRAMES) + SEA_FRAMES) % SEA_FRAMES;
  if (time === "day" && weather === "clear") return memo(`scene-sea|${width}|${f}`, () => drawSea(width, SCENE_HEIGHT - HORIZON, f));
  return memo(`scene-sea|${width}|${f}|${time}|${weather}`, () => drawSea(width, SCENE_HEIGHT - HORIZON, f, { time, weather }));
}

/** 往返走动：返回 [x, 朝左]。 */
function pingpong(x0: number, x1: number, t: number): [number, boolean] {
  const span = Math.max(1, x1 - x0);
  const m = ((t % (2 * span)) + 2 * span) % (2 * span);
  return m < span ? [x0 + m, false] : [x0 + 2 * span - m, true];
}

/** 行人小图：f 为步伐帧，-1 表示站着（人物模块已缓存；朝左时由贴图水平翻转，不另存副本）。 */
function walkerSprite(spec: PortraitSpec, f: number): Px {
  return f < 0 ? drawIdle(spec) : drawWalker(spec, f);
}

/** 主角的船在画面中的位置（不含帆的飘动与起伏）。 */
function berthRect(params: PortSceneParams, pl: Plan): Rect | null {
  if (pl.kind === "city" || !params.flagship) return null;
  const ship = shipSprite(params.flagship, params.flag ?? P.red[2], 0);
  // 殖民地与殖民点：规划里已经算好了船的左边界（靠在码头外端，或下锚在湾里）
  if (pl.kind !== "port") return { x: pl.berthX, y: (pl.berthMode === "anchor" ? pl.anchorBottom : BERTH_BOTTOM) - ship.h, w: ship.w, h: ship.h };
  const room = pl.width - pl.berthX - 4;
  const x = ship.w <= room ? pl.berthX + Math.floor((room - ship.w) / 3) : pl.width - 4 - ship.w;
  return { x, y: BERTH_BOTTOM - ship.h, w: ship.w, h: ship.h };
}

/**
 * 港口里站在主角的船旁边的位置（逻辑像素）：x 为人物的左边界、feet 为脚底所在的行。
 * 人物站在岸壁尽头的栈桥上、紧挨着船尾（船不在时站在泊位边上）；w 为人物的宽度。城市、殖民地与殖民点没有栈桥，为 null。
 * 给界面叠加会动的人物用。
 */
export function pierStand(params: PortSceneParams, w: number): { x: number; feet: number } | null {
  const pl = plan(params);
  if (pl.kind !== "port" || !pl.pier) return null;
  const berth = berthRect(params, pl);
  const x = berth ? berth.x - w - 2 : pl.berthX + 6;
  return { x: Math.max(4, Math.min(pl.width - w - 4, x)), feet: PIER_Y + 3 };
}

/** 街景布局：热点与主角的船的位置（不画图，开销很小，给界面叠加按钮用）。 */
export function layoutPortScene(params: PortSceneParams): PortSceneLayout {
  const pl = plan(params);
  return { width: pl.width, height: SCENE_HEIGHT, hotspots: pl.hotspots, berth: berthRect(params, pl), buildings: pl.buildings, found: pl.found };
}

/**
 * 合成一帧街景。frame 为从 0 开始的帧号（10 fps）；out 给出时复用这块缓冲（尺寸不符则新建）。
 * 返回整张图、设施热点与殖民建筑热点（逻辑像素）。
 */
export function composePortScene(params: PortSceneParams, frame: number, out?: Px): { px: Px; hotspots: Hotspot[]; buildings: BuildingHotspot[] } {
  const pl = plan(params);
  const bd = backdrop(params, pl);
  const look = lookOf(params);
  const { time, weather } = look;
  const g = (p: Px) => shadeCached(p, time, weather);
  const W = pl.width;
  const px = out && out.w === W && out.h === SCENE_HEIGHT ? out : new Px(W, SCENE_HEIGHT);
  px.data.set(bd.px.data);
  const flag = params.flag ?? P.red[2];
  const season = ((params.season % 4) + 4) % 4;

  // 云：随风漂移（默认向右），出了一边从另一边回来；阴雨天云多一层，雾天云少而淡
  const drift = (look.windX === 0 ? 0.25 : look.windX) * (params.windStrength === undefined ? 1 : 0.55 + look.windStrength * 0.1);
  const overcast = weather === "cloudy" || weather === "rain" || weather === "storm" || weather === "snow";
  const cloudOf = (variant: number) =>
    time === "day" && weather === "clear"
      ? memo(`scene-cloud|${variant}|${season}`, () => drawCloud(variant, { season }))
      : memo(`scene-cloud|${variant}|${season}|${time}|${weather}`, () => drawCloud(variant, { season, time, weather }));
  const drawClouds = (list: readonly { variant: number; y: number; x0: number; speed: number }[]) => {
    for (const c of list) {
      const cloud = cloudOf(c.variant);
      const loop = W + cloud.w + 20;
      const x = Math.floor((((c.x0 + frame * c.speed * drift) % loop) + loop) % loop) - cloud.w - 10;
      blitBehind(px, cloud, x, c.y, bd.mask);
    }
  };
  if (overcast) drawClouds(pl.clouds.map((c) => ({ variant: c.variant + 17, y: ((c.y + 29) % 64) + 2, x0: c.x0 + Math.round(W / 2), speed: c.speed * 0.8 })));
  drawClouds(weather === "fog" ? pl.clouds.filter((_, i) => i % 2 === 0) : pl.clouds);

  // 灯塔：夜里、黄昏、黎明与阴雨天亮起，光束左右扫过
  if (pl.beacon && bd.glow > 0) drawBeacon(px, pl.beacon.x, pl.beacon.y, frame, bd.glow, bd.mask);

  if (pl.kind !== "city") {
    // 海面：每 2 帧换一格浪（5 fps），只复制到水面行段
    const sea = seaFrame(W, Math.floor(frame / 2), time, weather);
    const w = bd.water;
    for (let i = 0; i < w.length; i += 3) {
      const y = w[i];
      const row = (y - HORIZON) * W;
      px.data.set(sea.data.subarray(row + w[i + 1], row + w[i + 2]), y * W + w[i + 1]);
    }
    drawFoam(px, pl, frame, gradeColor(P.foam, time, weather), gradeColor(P.sea[4], time, weather));
    for (const [i, b] of pl.buoys.entries()) {
      const bob = ((frame >> 2) + i * 3) % 6 < 3 ? 0 : 1;
      px.blit(g(buoy()), b.x, b.y - 7 + bob);
    }

    // 远处的船：海平线上缓慢驶过的小船、湾里下锚的大船（殖民地与殖民点只有海平线上的一艘）
    const others = Math.min(pl.kind === "port" ? 3 : 1, params.others ?? 0);
    if (others >= 1) {
      const far = g(smallShip(1, "square", flag, frame >> 2));
      // 殖民地与殖民点的陆地一直延伸到海平线，远处的船只在海湾一侧往来
      const x0 = pl.kind === "port" ? pl.townW - 40 : pl.townW + 50;
      const span = pl.kind === "port" ? W - pl.townW + 60 : Math.max(20, W - pl.townW - 90);
      const [x, left] = pingpong(x0, x0 + span, frame * 0.08);
      px.blit(far, Math.round(x), HORIZON + 5 - far.h, { flipX: left });
    }
    if (others >= 2) {
      // 湾里下锚的大船：在主角的船后面、露出大半；海湾太窄时不画，免得挤成一团
      const anchored = shipSprite({ type: 2, sail: "square" }, flag, frame >> 3);
      const lead = berthRect(params, pl);
      const room = W - (lead ? lead.x + lead.w : pl.townW);
      if (room + anchored.w * 0.45 >= anchored.w * 0.7) {
        const bob = (frame >> 3) % 4 === 3 ? 1 : 0;
        const x = Math.max(W - anchored.w + 6, W - room - Math.round(anchored.w * 0.3));
        const hazeTo = time === "day" && weather === "clear" ? P.sky[3] : hex(skyStops({ season, time, weather }).at(-1)?.[1] ?? rgba(P.sky[3])).slice(0, 7);
        const far = hazed(g(anchored), `anchored|${frame >> 3 & 3}|${flag}|${time}|${weather}`, hazeTo, 0.28);
        px.blit(far, x, HORIZON + 50 - far.h + bob);
      }
    }
    if (others >= 3) {
      const far = g(smallShip(0, "lateen", flag, frame >> 2));
      px.blit(far, pl.townW + Math.round((W - pl.townW) * 0.55), HORIZON + 9 - far.h);
    }
    if (bd.front) px.blit(bd.front.px, bd.front.x, bd.front.y);
  }

  // 炊烟：从民居、酒馆的屋顶升起，朝风的去向飘散
  drawSmoke(px, bd.smoke, frame, look);

  // 行人：往返走动，每走 3 像素换一帧步伐；夜里与雨雪天街上人少
  for (const [wi, w] of pl.walkers.entries()) {
    if (!keepWalker(wi, look)) continue;
    let x: number;
    let left: boolean;
    let f = -1;
    if (w.speed === 0) {
      x = w.x0 + (w.phase % Math.max(1, w.x1 - w.x0));
      left = w.faceLeft;
    } else {
      const t = w.phase + frame * w.speed;
      [x, left] = pingpong(w.x0, w.x1, t);
      f = Math.floor(t / 3) % WALK_FRAMES;
    }
    const sp = g(walkerSprite(w.spec, f));
    px.blit(sp, Math.round(x), w.feet + 1 - sp.h, { flipX: left });
  }

  // 商队：城门外的路上来回
  if (pl.caravan) {
    const c = pl.caravan;
    const t = frame * 0.35;
    const [x, left] = pingpong(c.x0, c.x1, t);
    const step = Math.floor(t / 4) % 2;
    for (let i = 0; i < c.count; i++) {
      const a = g(drawAnimal(c.animal, step));
      const ax = Math.round(x + (left ? i : -i) * (a.w + 3));
      px.blit(a, ax, c.feet - a.h, { flipX: left });
    }
    const driver = g(walkerSprite(c.driver, Math.floor(t / 3) % WALK_FRAMES));
    px.blit(driver, Math.round(x + (left ? -12 : 26)), c.feet + 2 - driver.h, { flipX: left });
  }

  // 主角的船：离观者最近，随浪轻轻起伏；缆绳系在栈桥的系缆桩上
  const berth = berthRect(params, pl);
  if (berth && params.flagship) {
    const ship = g(shipSprite(params.flagship, flag, frame >> 2));
    const bob = [0, 0, 1, 1, 1, 0, 0, -1][(frame >> 2) % 8] ?? 0;
    const top = berth.y + bob;
    px.blit(ship, berth.x, top);
    // 吃水：船底几行被海水淹没（浪花压在船壳上）
    const sea = seaFrame(W, Math.floor(frame / 2), time, weather);
    const foamC = gradeColor(P.foam, time, weather);
    const wl = berth.y + berth.h - Math.max(4, Math.round(ship.h * 0.07)) + bob;
    for (let y = wl; y < Math.min(SCENE_HEIGHT, top + ship.h); y++) {
      for (let x = berth.x; x < berth.x + ship.w; x++) {
        if (!ship.isOpaque(x - berth.x, y - top)) continue;
        const v = sea.get(x, y - HORIZON);
        px.put(x, y, y === wl && (x + (frame >> 1)) % 3 !== 0 ? foamC : v);
      }
    }
    const hullY = top + Math.round(ship.h * 0.72);
    if (pl.berthMode === "pier") {
      // 缆绳
      const ropeY = (bd.front?.y ?? PIER_Y) + 1;
      const rope = gradeColor(P.wood[1], time, weather);
      px.line(berth.x + 6, hullY, berth.x - 2, ropeY, rope);
      px.line(berth.x + ship.w - 8, hullY, berth.x + ship.w + 2, ropeY, rope);
    } else {
      // 下锚：船头垂下一段锚链没入水中
      const bx = berth.x + ship.w - 6;
      px.line(bx, hullY, bx + 5, wl + 4, gradeColor(P.iron[1], time, weather));
    }
  }

  // 海鸥（城市里是普通的飞鸟）：夜里与暴风雨时不飞
  for (const gl of pl.gulls.slice(0, gullCount(pl.gulls.length, look))) {
    const a = ((frame + gl.phase) / gl.period) * Math.PI * 2;
    const x = Math.round(gl.cx + Math.cos(a) * gl.rx);
    const y = Math.round(gl.cy + Math.sin(a) * gl.ry);
    px.blit(g(drawGullCached(Math.floor((frame + gl.phase) / 2))), x, y);
  }

  // 天气：雨丝、雪花、雾带、闪电。没有给出天况时（旧后端），寒冷港口的冬天照旧飘小雪
  if (look.hasWeather) weatherOverlay(px, look, frame, bd.mask, fogPlan(pl));
  else if (pl.snow) drawSnow(px, frame);

  return { px, hotspots: pl.hotspots, buildings: pl.buildings };
}

function drawGullCached(frame: number): Px {
  const f = ((frame % 4) + 4) % 4;
  return memo(`scene-gull|${f}`, () => drawGull(f));
}

/** 岸边浪花：岸壁脚下与栈桥桩周围一闪一闪的白沫；殖民地与殖民点沿沙滩的岸线。foam / edge 为按时段调过的浪花色与浅水色。 */
function drawFoam(px: Px, pl: Plan, frame: number, foam: number = rgba(P.foam), edge: number = rgba(P.sea[4])) {
  const t = frame >> 1;
  if (pl.foam) {
    const f = pl.foam;
    for (let i = 0; i < f.length; i += 2) {
      const x = f[i];
      const y = f[i + 1];
      const k = (x * 7 + y * 5 + t * 3) % 23;
      if (k < 4) px.set(x, y, foam);
      else if (k < 7) px.set(x + 1, y, edge);
    }
    if (pl.pier) {
      for (let x = pl.pier.x; x < pl.pier.x + pl.pier.w; x++) {
        const k = (x * 5 + t * 2) % 19;
        if (k < 2) px.set(x, (pl.pier.y ?? PIER_Y) + 10, foam);
      }
    }
    return;
  }
  for (let x = 0; x < pl.townW + 4; x++) {
    const k = (x * 7 + t * 3) % 23;
    if (k < 3) px.set(x, WATER_Y, foam);
    else if (k < 5) px.set(x, WATER_Y + 1, edge);
  }
  if (pl.pier) {
    for (let x = pl.pier.x; x < pl.pier.x + pl.pier.w; x++) {
      const k = (x * 5 + t * 2) % 19;
      if (k < 2) px.set(x, PIER_Y + 12, foam);
    }
  }
}

/** 飘雪：约 70 片，缓慢下落并左右摆动。 */
function drawSnow(px: Px, frame: number) {
  const r = rng("scene-snow");
  for (let i = 0; i < 70; i++) {
    const x0 = r.int(0, px.w - 1);
    const y0 = r.int(0, SCENE_HEIGHT - 1);
    const sp = r.range(0.4, 1.0);
    const y = Math.floor((y0 + frame * sp) % SCENE_HEIGHT);
    const x = Math.floor(x0 + Math.sin((frame + i * 13) / 9) * 2);
    px.set(x, y, P.snow[3]);
    if (sp > 0.8) px.set(x + 1, y, P.snow[2]);
  }
}
