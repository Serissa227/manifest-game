// 殖民地与殖民点的街景规划（PortSceneParams.kind 为 colony / site）。
//
// 构图（由远到近）：天空 → 远山 → 按地形的远景林带（林冠、丘陵、雪山、沙丘、雾林）→ 空地与沙滩 → 林线
// → 后排（高大的殖民建筑与设施）→ 前排（矮的殖民建筑）与土路上的行人 → 近岸的岩石、搁浅的小艇 → 海湾与码头。
// 殖民地：建筑按殖民建筑列表与等级摆放，人口决定路上的行人数，有码头才能靠岸（否则主角的船下锚在湾里）。
// 殖民点：未开发的荒野海湾，沙滩正中留出一块空地给“建立殖民地”按钮；按地点 key 决定有没有古迹残垣。
import {
  COLONY_KEYS,
  DOCK_DECK_FROM_BOTTOM,
  drawBuilding,
  drawColonyBuilding,
  drawProp,
  baseStyle,
  isColonyKey,
  townStyleOr,
  type PropKind,
  type TownStyle,
} from "../art/buildings";
import { P } from "../art/palette";
import { portraitSpec, type NpcRole } from "../art/portraits";
import type { Px } from "../art/px";
import { memo } from "../art/render";
import { hash32, rng, type Rng } from "../art/rng";
import { drawDistantLand } from "../art/scenery";
import { drawShipByKey, shipArtKey } from "../art/ships";
import type { Facility } from "../store/game";
import {
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
import { rowboat } from "./props";
import { bush, clearing, driftwood, farTerrain, isTerrain, pool, rock, ruins, terrainClimate, wildTree, wreck, type Terrain } from "./wild";
import type { PortSceneParams } from "./port";

/** 殖民地的一座建筑：key 为 colony.toml 的建筑 key，level 0 表示尚未建成（不画）。 */
export interface SceneColonyBuilding {
  key: string;
  level: number;
}

/** 殖民地街景需要的数据。 */
export interface SceneColony {
  buildings: readonly SceneColonyBuilding[];
  /** 人口：决定路上的行人数 */
  population: number;
}

// ───────────────────────── 纵向布局（逻辑像素） ─────────────────────────
/** 空地的上沿 */
const GROUND_TOP = 170;
/** 林线的树根 */
const TREELINE_GY = 184;
/** 后排地面线 */
const BACK_GY = 192;
/** 前排地面线（土路上沿） */
const FRONT_GY = 216;
/** 土路 [上沿, 下沿) */
const PATH: readonly [number, number] = [FRONT_GY, FRONT_GY + 12];
/** 前滩沙地的上沿 */
const BEACH_TOP = 231;
/** 陆地最下一行，再往下是海 */
const BEACH_BOTTOM = 246;
/** 码头桥面的上沿 */
const DOCK_DECK_Y = 236;
/** 下锚的主角的船：船底所在的行 */
const ANCHOR_BOTTOM = 222;

/** 殖民建筑在一排里从左到右的先后（堡垒守在最左，渔场挨着水边）。 */
const ORDER: readonly string[] = ["fort", "mine", "lumber", "hunting", "farm", "plantation", "chapel", "housing", "tavern", "storehouse", "distillery", "sugarmill", "fishery"];

/** 一件要摆进排里的东西：殖民建筑或设施。 */
interface Item {
  px: Px;
  bld?: string;
  level: number;
  fac?: Facility;
  order: number;
  /** 亮灯变体（夜里换用） */
  lit: () => Px;
}

function colonySprite(key: string, level: number, style: TownStyle, season: number, snow: boolean, flag: string, lit = false): Px {
  return memo(`scene-colony|${key}|${level}|${style}|${season}|${snow}|${flag}${lit ? "|lit" : ""}`, () =>
    drawColonyBuilding(key, level, style, { season, snow, flag, lit }).trimmed(),
  );
}

function facilitySprite(fac: Facility, style: TownStyle, season: number, snow: boolean, lit = false): Px {
  return memo(`scene-bld|${fac}|${style}|${season}|${snow}${lit ? "|lit" : ""}`, () => drawBuilding(fac, style, { season, snow, lit: lit || fac === "tavern" }).trimmed());
}

/** 冒炊烟的殖民建筑。 */
const SMOKY: ReadonlySet<string> = new Set(["housing", "tavern"]);

function propSprite(kind: PropKind, style: TownStyle, variant: number): Px {
  return memo(`scene-prop|${kind}|${style}|${variant}|`, () => drawProp(kind, style, { variant }).trimmed());
}

/** 主角旗舰的大图（与 port.ts 共用同一缓存键）。 */
function flagshipSprite(params: PortSceneParams): Px | null {
  const s = params.flagship;
  if (!s) return null;
  const flag = params.flag ?? P.red[2];
  const key = s.key ?? shipArtKey(null, s.type);
  return memo(`scene-ship|${key}|${s.sail}|${flag}|0|large`, () => drawShipByKey(key, s.sail, { size: "large", flag, frame: 0 }).trimmed());
}

/** 地形上树木的疏密（0–1）。 */
const TREE_DENSITY: Readonly<Record<Terrain, number>> = {
  forest: 0.95,
  plains: 0.3,
  hills: 0.55,
  jungle: 1,
  tundra: 0.5,
  desert: 0.25,
  swamp: 0.7,
  island: 0.5,
};

/** 在 [a, b) 里种一排树与灌木，树根在 gy。 */
function plantRow(ops: Op[], a: number, b: number, gy: number, t: Terrain, season: number, r: Rng, density: number, bushes = true): void {
  let x = a;
  let guard = 0;
  while (x < b - 6 && guard++ < 60) {
    if (r.chance(density)) {
      const tp = wildTree(t, season, r.int(0, 99));
      ops.push({ px: tp, x: Math.round(x - tp.w / 3), y: gy - tp.h + 1 + r.int(0, 2), flipX: r.chance(0.5) });
      x += Math.max(8, Math.round(tp.w * r.range(0.45, 0.8)));
    } else {
      if (bushes) {
        const bp = bush(t, season, r.int(0, 9));
        ops.push({ px: bp, x: Math.round(x), y: gy - bp.h + 1 });
      }
      x += r.int(10, 20);
    }
  }
}

/** 殖民地与殖民点的街景规划。 */
export function makeWildPlan(params: PortSceneParams, width: number): Plan {
  const kind = params.kind === "colony" ? "colony" : "site";
  const terrain: Terrain = isTerrain(params.terrain) ? params.terrain : "forest";
  // 所有者的城镇风格（第九批的细名按 TOWN_ALIASES 回退）画 3 级建筑；没有时是开拓者风格
  const town: TownStyle = townStyleOr(params.style, "frontier");
  const style = baseStyle(town);
  const climate = terrainClimate(terrain);
  const season = ((Math.floor(params.season) % 4) + 4) % 4;
  const snow = season === 3 && terrain === "tundra";
  const flag = params.flag ?? P.red[2];
  const r = rng(`wild-${params.key}`);
  const ops: Op[] = [];
  const ship = flagshipSprite(params);

  // ── 殖民建筑与设施：同一 key 只取最高等级，码头单独放在水边 ──
  const levels = new Map<string, number>();
  if (kind === "colony") {
    for (const b of params.colony?.buildings ?? []) {
      const lv = Math.floor(b.level);
      if (!(lv >= 1)) continue;
      const key = isColonyKey(b.key) ? b.key : "housing";
      levels.set(key, Math.max(levels.get(key) ?? 0, Math.min(3, lv)));
    }
  }
  const dockLv = levels.get("dock") ?? 0;
  levels.delete("dock");
  const facs = kind === "colony" ? [...new Set(params.facilities)] : [];

  // ── 陆地宽度：放得下两排建筑，其余给海湾；海湾至少放得下下锚的主角的船 ──
  const minBay = Math.max(dockLv ? 150 : 126, ship ? ship.w + 36 : 0);
  const dispLv = new Map(levels);
  const makeItems = (): Item[] => [
    ...[...dispLv].map(([key, lv]) => ({
      px: colonySprite(key, lv, town, season, snow, flag),
      bld: key,
      level: levels.get(key) ?? lv,
      order: ORDER.indexOf(key),
      lit: () => colonySprite(key, lv, town, season, snow, flag, true),
    })),
    ...facs.map((fac, i) => ({ px: facilitySprite(fac, town, season, snow), fac, level: 0, order: 6.5 + i * 0.01, lit: () => facilitySprite(fac, town, season, snow, true) })),
  ];
  let items = makeItems();
  const total = (list: Item[]) => list.reduce((a, it) => a + it.px.w, 0);
  const landMax = width - minBay;
  const landW =
    kind === "site"
      ? clamp(Math.round(width * 0.6), 240, landMax)
      : clamp(Math.round((total(items) / 2) * 1.1 + 40), Math.round(width * 0.5), landMax);
  const span = landW - 30;
  // 太挤时把最宽的建筑按低一级的样子画（热点仍报告真实等级）
  for (let guard = 0; guard < 40 && total(items) > span * 2.3; guard++) {
    let widest: string | null = null;
    let ww = 0;
    for (const it of items) if (it.bld && (dispLv.get(it.bld) ?? 1) > 1 && it.px.w > ww) [widest, ww] = [it.bld, it.px.w];
    if (!widest) break;
    dispLv.set(widest, (dispLv.get(widest) ?? 2) - 1);
    items = makeItems();
  }

  // ── 岸线：前滩在 BEACH_BOTTOM，往后逐渐向右延伸 ──
  // 岸线带一点起伏；靠近林线的一角收圆
  const shore = (y: number) =>
    landW + Math.round((BEACH_BOTTOM - y) * 0.45 + Math.sin(y / 5) * 1.2 + Math.sin(y / 13 + 1) * 2 - Math.max(0, GROUND_TOP + 10 - y) ** 1.5 * 0.35);
  const landEnd = shore(GROUND_TOP);

  // ── 远景与地面 ──
  const land = memo(`scene-land|${width}|${climate}|${season}`, () => drawDistantLand(width, 52, climate, season));
  ops.push({ px: land, x: 0, y: HORIZON + 2 - land.h });
  const far = farTerrain(width, 68, terrain, season, snow, landEnd + 8, params.key);
  ops.push({ px: far, x: 0, y: GROUND_TOP + 6 - far.h });
  const ground = memo(`scene-clearing|${width}|${landW}|${terrain}|${season}|${snow}|${kind}|${params.key}`, () =>
    clearing(width, SCENE_HEIGHT, terrain, season, snow, params.key, {
      top: GROUND_TOP,
      shore,
      bottom: BEACH_BOTTOM,
      path: kind === "colony" ? PATH : null,
      beachTop: kind === "site" ? BEACH_TOP - 6 : BEACH_TOP,
    }),
  );
  ops.push({ px: ground, x: 0, y: GROUND_TOP });
  if (terrain === "swamp") {
    for (let i = 0; i < 3; i++) {
      const pw = r.int(16, 30);
      const px = pool(pw);
      ops.push({ px, x: r.int(4, Math.max(5, landW - pw - 20)), y: kind === "colony" ? PATH[1] + r.int(1, 3) : r.int(BACK_GY + 4, BEACH_TOP - 4) });
    }
  }

  // ── 林线：殖民地把当中一段砍成了空地 ──
  const density = TREE_DENSITY[terrain];
  if (kind === "colony") {
    plantRow(ops, -10, Math.round(landW * 0.18), TREELINE_GY, terrain, season, r, density);
    plantRow(ops, Math.round(landW * 0.18), landEnd - 30, TREELINE_GY - 2, terrain, season, r, density * 0.35);
  } else plantRow(ops, -10, landEnd - 24, TREELINE_GY, terrain, season, r, density);

  const hotspotsRaw: { rect: Rect; z: number; fac?: Facility; bld?: string; level: number }[] = [];
  let found: Rect | null = null;
  const walkers: WalkerPlan[] = [];

  if (kind === "site") {
    // ── 殖民点：古迹残垣、空地两侧的树丛、近岸的岩石、搁浅的小艇 ──
    const hasRuins = params.ruins ?? hash32(`ruins-${params.key}`) % 3 === 0;
    if (hasRuins) {
      const rp = ruins(terrain, season, hash32(params.key));
      ops.push({ px: rp, x: 4, y: BACK_GY + 6 - rp.h });
    }
    const fx0 = Math.round(landW * 0.24);
    const fx1 = Math.round(landW * 0.62);
    found = { x: fx0, y: BACK_GY - 4, w: fx1 - fx0, h: BEACH_TOP - (BACK_GY - 4) };
    plantRow(ops, hasRuins ? 84 : -6, fx0 - 6, BACK_GY + 10, terrain, season, r, Math.min(1, density + 0.2));
    plantRow(ops, fx1 + 4, shore(BACK_GY + 10) - 26, BACK_GY + 8, terrain, season, r, density);
    for (let i = 0; i < 3; i++) {
      const bp = bush(terrain, season, r.int(0, 9));
      ops.push({ px: bp, x: r.int(2, fx0 - 10), y: BEACH_TOP - bp.h + r.int(0, 4) });
    }
    const wk = wreck();
    ops.push({ px: wk, x: Math.round(landW * 0.66), y: BEACH_BOTTOM - 3 - wk.h });
    const dw = driftwood(1);
    ops.push({ px: dw, x: Math.round(landW * 0.12), y: BEACH_BOTTOM - 2 - dw.h });
    // 登陆的小艇与几名水手（主角的船在湾里时）
    if (ship) {
      const boat = rowboat(1);
      const bx = Math.min(shore(BEACH_BOTTOM - 4) - boat.w + 4, Math.round(landW * 0.8));
      ops.push({ px: boat, x: bx, y: BEACH_BOTTOM - boat.h + 2 });
      for (let i = 0; i < 3; i++) {
        walkers.push({
          spec: portraitSpec(`${params.key}-landing-${i}`, "sailor"),
          feet: BEACH_TOP + 4 + i * 3,
          x0: Math.round(landW * 0.52) + i * 6,
          x1: bx - 4,
          speed: i === 0 ? 0 : r.range(0.2, 0.45),
          phase: r.int(0, 200),
          faceLeft: i % 2 === 1,
        });
      }
    }
  } else {
    // ── 殖民地：高的放后排、矮的放前排，两排宽度大致均衡 ──
    const byHeight = [...items].sort((a, b) => b.px.h - a.px.h || a.order - b.order);
    const back: Item[] = [];
    const front: Item[] = [];
    const all = total(items);
    for (const it of byHeight) (total(back) < all / 2 || items.length === 1 ? back : front).push(it);
    const byOrder = (a: Item, b: Item) => a.order - b.order;
    back.sort(byOrder);
    front.sort(byOrder);
    const backSpan: [number, number] = [6, landW - 16];
    const frontSpan: [number, number] = [2, landW - 20];
    const backPlaced = placeRow(back, backSpan[0], backSpan[1], r);
    const frontPlaced = placeRow(front, frontSpan[0], frontSpan[1], r);
    // 后排：空隙里种树 → 建筑
    for (const [a, b] of gapsOf(backPlaced, backSpan[0] - 10, backSpan[1])) plantRow(ops, a, b, BACK_GY + 2, terrain, season, r, density * 0.6);
    backPlaced.forEach((p, i) => {
      ops.push({ px: p.px, x: p.x, y: BACK_GY - p.px.h, fac: p.fac, bld: p.bld, lit: p.lit, litRank: 0.1 + (i % 3) * 0.2, smoke: !!p.bld && SMOKY.has(p.bld) });
      hotspotsRaw.push({ rect: { x: p.x, y: BACK_GY - p.px.h, w: p.px.w, h: p.px.h }, z: i, fac: p.fac, bld: p.bld, level: p.level });
    });
    // 前排：空隙里摆货箱、木桶、灌木 → 建筑
    const PROPS: PropKind[] = ["crates", "barrels", "sacks", "cart"];
    for (const [a, b] of gapsOf(frontPlaced, frontSpan[0], frontSpan[1])) {
      if (b - a < 16) continue;
      const pp = r.chance(0.6) ? propSprite(r.pick(PROPS), "frontier", r.int(0, 3)) : bush(terrain, season, r.int(0, 9));
      ops.push({ px: pp, x: Math.round((a + b) / 2 - pp.w / 2), y: FRONT_GY + 1 - pp.h });
    }
    frontPlaced.forEach((p, i) => {
      ops.push({ px: p.px, x: p.x, y: FRONT_GY - p.px.h, fac: p.fac, bld: p.bld, lit: p.lit, litRank: 0.1 + ((i + 1) % 3) * 0.2, smoke: !!p.bld && SMOKY.has(p.bld) });
      hotspotsRaw.push({ rect: { x: p.x, y: FRONT_GY - p.px.h, w: p.px.w, h: p.px.h }, z: 100 + i, fac: p.fac, bld: p.bld, level: p.level });
    });
    // 行人：人口越多路上人越多
    const pop = Math.max(0, params.colony?.population ?? 0);
    const crowd = params.crowd ?? clamp(Math.round(pop / 30), items.length ? 1 : 0, 14);
    const roles: NpcRole[] = ["townsfolk", "townsfolk", "sailor"];
    const pathEnd = shore(PATH[1]) - 16;
    for (let i = 0; i < crowd; i++) {
      const idle = r.chance(0.25);
      walkers.push({
        spec: portraitSpec(`${params.key}-settler-${i}`, r.pick(roles)),
        feet: PATH[0] + 3 + r.int(0, 3) * 2,
        x0: 2,
        x1: pathEnd,
        speed: idle ? 0 : r.range(0.3, 0.9),
        phase: r.int(0, pathEnd * 2),
        faceLeft: r.chance(0.5),
      });
    }
    // 前滩：拖上岸的小划艇
    const boat = rowboat(r.int(0, 2));
    ops.push({ px: boat, x: Math.round(landW * 0.3) + r.int(-20, 20), y: BEACH_BOTTOM - boat.h + 1 });
  }
  walkers.sort((a, b) => a.feet - b.feet);

  // ── 丘陵地形：林线前几块露头的岩石 ──
  if (terrain === "hills") {
    for (let i = 0; i < 3; i++) {
      const rp = rock(terrain, i * 5 + 1, snow);
      const x = Math.round(((i + 0.3) * landW) / 3) + r.int(-10, 10);
      if (found && x + rp.w > found.x && x < found.x + found.w) continue;
      ops.push({ px: rp, x, y: TREELINE_GY + 4 - rp.h });
    }
  }
  // ── 岸边的岩石 ──
  const nRocks = terrain === "plains" ? 1 : terrain === "swamp" ? 0 : 2;
  for (let i = 0; i < nRocks; i++) {
    const y = i === 0 ? BEACH_BOTTOM + 2 : Math.round(GROUND_TOP + 18);
    const rp = rock(terrain, i + hash32(params.key), snow);
    ops.push({ px: rp, x: shore(y) - Math.round(rp.w * 0.6), y: y - rp.h + 2 });
  }

  // ── 码头：从岸边伸进海湾；主角的船停在码头外侧，否则下锚在湾里 ──
  let pier: Plan["pier"] = null;
  let berthMode: Plan["berthMode"] = "anchor";
  let berthX = landEnd + 10;
  if (dockLv > 0) {
    const dp = colonySprite("dock", dockLv, town, season, snow, flag);
    const dx = shore(DOCK_DECK_Y) - 14;
    const dy = DOCK_DECK_Y - (dp.h - DOCK_DECK_FROM_BOTTOM);
    pier = { x: dx, w: dp.w, px: dp, y: dy };
    hotspotsRaw.push({ rect: { x: dx, y: dy, w: dp.w, h: dp.h }, z: 200, bld: "dock", level: dockLv });
    // 船靠在码头的外端：船身挡在栈桥前面
    berthMode = "pier";
    berthX = ship ? clamp(dx + Math.round(dp.w * 0.5), dx + 6, width - ship.w - 2) : dx + 6;
  } else if (ship) {
    const room = width - landEnd - 8;
    berthX = ship.w <= room ? landEnd + 6 + Math.floor((room - ship.w) / 2) : width - 4 - ship.w;
  }

  // ── 热点：前面的挡住后面的 ──
  const cut = (i: number): Rect => {
    const h = hotspotsRaw[i];
    let a = clipRect(h.rect, width, SCENE_HEIGHT);
    for (const o of hotspotsRaw) if (o.z > h.z) a = cutRect(a, o.rect);
    return a;
  };
  const hotspots: Hotspot[] = [];
  const buildings: BuildingHotspot[] = [];
  hotspotsRaw.forEach((h, i) => {
    const a = cut(i);
    if (h.fac) hotspots.push({ facility: h.fac, ...a });
    else if (h.bld) buildings.push({ building: h.bld, level: h.level, ...a });
  });
  buildings.sort((a, b) => COLONY_KEYS.indexOf(a.building as (typeof COLONY_KEYS)[number]) - COLONY_KEYS.indexOf(b.building as (typeof COLONY_KEYS)[number]));

  // ── 岸线浪花 ──
  const foam: number[] = [];
  for (let y = HORIZON + 30; y <= BEACH_BOTTOM; y++) foam.push(shore(y), y);
  for (let x = 0; x < shore(BEACH_BOTTOM); x++) foam.push(x, BEACH_BOTTOM + 1);

  // ── 云与鸟 ──
  const clouds: CloudPlan[] = [];
  const nClouds = Math.max(3, Math.round(width / 120));
  for (let i = 0; i < nClouds; i++) clouds.push({ variant: r.int(0, 99), y: r.int(6, 64), x0: r.int(0, width), speed: r.range(0.04, 0.12) });
  const gulls: GullPlan[] = [];
  for (let i = 0; i < 3; i++) {
    gulls.push({ cx: landW + r.int(-60, width - landW - 20), cy: r.int(40, 100), rx: r.int(24, 60), ry: r.int(6, 16), period: r.int(90, 160), phase: r.int(0, 999) });
  }

  return {
    width,
    style,
    town,
    climate,
    snow,
    kind,
    townW: landW,
    ops,
    hotspots,
    buildings,
    found,
    walkers,
    clouds,
    gulls,
    caravan: null,
    pier,
    berthMode,
    berthX,
    anchorBottom: ANCHOR_BOTTOM,
    buoys: kind === "colony" && dockLv >= 2 ? [{ x: landEnd + Math.round((width - landEnd) * 0.4), y: HORIZON + 30 }] : [],
    foam: Int16Array.from(foam),
  };
}
