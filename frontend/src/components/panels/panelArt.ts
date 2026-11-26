// 功能面板用到的像素图：图标、商品、船、头像的缓存取用，以及舰队画面、海盗船画面的合成。
// 画法本身在 src/art/ 各模块；这里只负责组合与缓存（同一张图只生成一次）。
import { drawAnimal, drawIndustryIcon } from "../../art/extras";
import { drawGoodIcon, drawIcon, type IconName } from "../../art/icons";
import { P } from "../../art/palette";
import { drawPortrait, type PortraitSpec } from "../../art/portraits";
import { Px } from "../../art/px";
import { canDraw, memo } from "../../art/render";
import { GULL_FRAMES, SEA_FRAMES, drawCloud, drawGull, drawSea, drawSky } from "../../art/scenery";
import { SHIP_FRAMES, drawShipByKey, shipArtKey, waterlineByKey } from "../../art/ships";
import { locById } from "../../ipc/byId";
import type { FleetView, StaticView } from "../../ipc/types";

export function iconPx(name: IconName): Px {
  return memo(`pn-icon-${name}`, () => drawIcon(name));
}

export function goodPx(statics: StaticView, good: number): Px {
  const g = statics.goods[good];
  return memo(`pn-good-${g?.key ?? good}`, () => drawGoodIcon(g?.key ?? "", g?.category));
}

export function portraitPx(spec: PortraitSpec): Px {
  return memo(`pn-portrait-${JSON.stringify(spec)}`, () => drawPortrait(spec));
}

export function animalPx(index: number, frame = 0): Px {
  return drawAnimal(index, frame);
}

export function industryPx(index: number): Px {
  return drawIndustryIcon(index);
}

export interface ShipLook {
  kind: number;
  /** 船型 key（按 key 画，寰宇·十六世纪的新船型各有画法）；缺省时按 kind 取经典世界同一下标的 key */
  key?: string;
  sail: "square" | "lateen";
  flag?: string;
  pirate?: boolean;
  damaged?: boolean;
}

/** 画这艘船用的 key。 */
function lookKey(s: ShipLook): string {
  return s.key ?? shipArtKey(null, s.kind);
}

export function shipPx(s: ShipLook, size: "large" | "small", frame = 0): Px {
  const f = ((frame % SHIP_FRAMES) + SHIP_FRAMES) % SHIP_FRAMES;
  const key = lookKey(s);
  return memo(`pn-ship-${size}-${key}-${s.sail}-${s.flag ?? ""}-${s.pirate ? 1 : 0}-${s.damaged ? 1 : 0}-${f}`, () =>
    drawShipByKey(key, s.sail, { size, flag: s.flag, pirate: s.pirate, damaged: s.damaged, frame: f }),
  );
}

/**
 * 舰队挂的旗：在港时挂所在港口势力的旗（入港礼旗），航行时挂目的港势力的旗；都没有时挂第一个势力的旗。
 */
export function fleetFlag(statics: StaticView, fleet: FleetView): string {
  const loc = fleet.docked ?? fleet.dest;
  const faction = loc === null ? 0 : (locById(statics, loc)?.faction ?? 0);
  return statics.factions[faction]?.color ?? statics.factions[0]?.color ?? P.red[2];
}

/** 舰队里每艘船的外观。 */
export function fleetLooks(statics: StaticView, fleet: FleetView): ShipLook[] {
  const flag = fleetFlag(statics, fleet);
  return fleet.ships.map((s) => ({
    kind: s.kind,
    key: shipArtKey(statics.ships, s.kind),
    sail: statics.ships[s.kind]?.sail ?? "square",
    flag,
    damaged: s.durability * 2 < s.max_durability,
  }));
}

/** 天空 + 海面背景（按帧缓存）。 */
function seascape(w: number, h: number, horizon: number, season: number, frame: number): Px {
  const f = ((frame % SEA_FRAMES) + SEA_FRAMES) % SEA_FRAMES;
  return memo(`pn-seascape-${w}-${h}-${horizon}-${season}-${f}`, () => {
    const p = new Px(w, h);
    p.blit(memo(`pn-sky-${w}-${horizon}-${season}`, () => drawSky(w, horizon, { season })), 0, 0);
    p.blit(drawSea(w, h - horizon, f), 0, horizon);
    return p;
  });
}

/** 船图与其水线（距图顶的行数）。 */
function shipWithWater(s: ShipLook, frame: number): { px: Px; water: number } {
  return { px: shipPx(s, "large", frame), water: waterlineByKey(lookKey(s), "large", s.sail) };
}

/** 舰队画面最底下留给海面的行数，以及后排每艘船抬高的行数。 */
const SEA_BELOW = 8;
const ROW_RISE = 3;

/**
 * 舰队画面的逻辑高度：容得下最高的船（水线以上部分）与海面，最矮 72、最高 132。
 * 界面按 2 倍显示，所以画面高度随船队里最高的船变化。
 */
export function fleetSceneHeight(looks: ShipLook[]): number {
  let need = 0;
  looks.forEach((s, i) => {
    need = Math.max(need, waterlineByKey(lookKey(s), "large", s.sail) + SEA_BELOW + i * ROW_RISE + 4);
  });
  return Math.max(72, Math.min(132, need));
}

/** 舰队画面（见 composeFleetScene）；没有画布的环境（测试）直接返回 1×1 的空图，免得白算。 */
export function fleetScene(looks: ShipLook[], season: number, w: number, h: number, frame: number): Px {
  if (!canDraw() || w < 8) return new Px(1, 1);
  return composeFleetScene(looks, season, w, h, frame);
}

/** 把船贴到海面上：水线对齐 water 行，水线以下用同一片海面半透明地盖住，水线上一道浪花。 */
function launch(out: Px, bg: Px, ship: { px: Px; water: number }, x: number, water: number, frame: number): void {
  const top = water - ship.water;
  out.blit(ship.px, x, top);
  const below = ship.px.h - ship.water;
  if (below > 0) out.blit(bg.crop(x, water + 1, ship.px.w, below), x, water + 1, { alpha: 0.78 });
  for (let k = 3; k < ship.px.w - 3; k += 4) {
    const xx = x + k + ((frame >> 1) % 4);
    if (ship.px.isOpaque(xx - x, ship.water)) out.set(xx, water, P.foam).set(xx + 1, water, P.sea[4]);
  }
}

/** 舰队画面：天空与海面上排成一列的船，旗舰在最前（右侧），其余依次靠后、略高；船随浪上下起伏，云与海鸥飘过。 */
export function composeFleetScene(looks: ShipLook[], season: number, w: number, h: number, frame: number): Px {
  const horizon = Math.max(Math.floor(h * 0.5), h - 44);
  const bg = seascape(w, h, horizon, season, Math.floor(frame / 2));
  const out = bg.clone();
  // 两朵慢慢飘过的云、一只海鸥
  for (let i = 0; i < 2; i++) {
    const cloud = memo(`pn-cloud-${i}-${season}`, () => drawCloud(i, { season }));
    const span = w + cloud.w;
    const x = ((Math.floor(frame / 4) + i * Math.floor(span / 2) + 13) % span) - cloud.w;
    out.blit(cloud, x, 3 + i * 9);
  }
  const gull = drawGull(Math.floor(frame / 2) % GULL_FRAMES);
  const gx = w - ((frame * 2) % (w + 40)) + 10;
  out.blit(gull, gx, 12 + Math.round(Math.sin(frame / 5) * 2));
  const ships = looks.map((s) => shipWithWater(s, Math.floor(frame / 3)));
  const n = ships.length;
  if (n === 0) return out;
  const front = ships[0].px;
  const margin = 6;
  const room = Math.max(0, w - front.w - margin * 2);
  const gap = n > 1 ? Math.min(Math.max(...ships.map((s) => s.px.w)) * 0.75, room / (n - 1)) : 0;
  // 船队占不满画面时整体往中间挪一些（偏右，船头前方留出海面）
  const spare = Math.max(0, room - gap * (n - 1));
  const right = w - margin - Math.round(spare * 0.35);
  // 从最远的开始画
  for (let i = n - 1; i >= 0; i--) {
    const s = ships[i];
    const x = Math.round(right - front.w - gap * i + (front.w - s.px.w) / 2);
    const bob = Math.round(Math.sin((frame + i * 5) / 4));
    launch(out, bg, s, x, h - SEA_BELOW - i * ROW_RISE + bob, frame);
  }
  return out;
}

/** 海盗船画面：暴风雨黄昏的海面上的黑帆船（对话框用）。 */
export function pirateScene(look: ShipLook): Px {
  return memo(`pn-pirate-scene-${lookKey(look)}-${look.sail}`, () => {
    const ship = shipWithWater({ ...look, pirate: true }, 1);
    const w = Math.max(ship.px.w + 28, 120);
    const h = ship.water + 12;
    const horizon = Math.max(Math.floor(h * 0.5), h - 30);
    const bg = new Px(w, h);
    bg.blit(drawSky(w, horizon, { season: 3, weather: "storm", time: "dusk" }), 0, 0);
    bg.blit(drawSea(w, h - horizon, 0, { time: "dusk" }), 0, horizon);
    const out = bg.clone();
    launch(out, bg, ship, Math.floor((w - ship.px.w) / 2), h - 7, 0);
    return out;
  });
}
