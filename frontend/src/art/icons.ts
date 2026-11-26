// 16×16 图标：界面命令、状态、设施与商品。
// 接口由界面代码依赖，不要改；画法在 ./icons/ 目录下（ui.ts 界面图标、colony.ts 殖民与探险图标及殖民建筑图标、
// goods.ts 原有商品图标、goods1502.ts 航海历 1502 年追加的商品图标、books.ts 第六批追加的古籍、goods1600.ts 寰宇追加的交易品图标、
// sky.ts 天况与时刻图标、kit.ts 绘制工具）。
// 统一风格：透明底、1 像素深色描边、左上受光、2–3 阶明暗。生成结果按名称缓存，每次返回副本（调用方可以放心修改）。
import { COLONY_ICONS } from "./icons/colony";
import { CATEGORY_ICONS, FALLBACK_GOOD, GOOD_ICONS } from "./icons/goods";
import { GOOD_ICONS_1502 } from "./icons/goods1502";
import { GOOD_ICONS_1600 } from "./icons/goods1600";
import { GOOD_ICONS_BOOKS } from "./icons/books";
import { SKY_ICONS, windIcon } from "./icons/sky";
import { UI_ICONS } from "./icons/ui";
import { Px } from "./px";
import { memo } from "./render";

export const ICON_NAMES = [
  // 状态与资源
  "coin", "calendar", "clock", "wind", "food", "water", "morale", "crew", "cannon", "cargo", "star",
  // 季节
  "spring", "summer", "autumn", "winter",
  // 功能面板
  "port", "fleet", "mate", "futures", "caravan", "industry", "report", "intel", "settings", "battle", "debug", "quest",
  // 行情预测（第八批追加）
  "forecast",
  // 港口设施
  "market", "shipyard", "tavern", "guild", "bank", "exchange", "warehouse", "invest", "office",
  // 操作
  "sail", "anchor", "map", "save", "load", "menu", "pause", "play", "fast", "step", "close",
  // 音乐开关（配乐追加）
  "music", "music_off",
  // 殖民、探险与组合事件（航海历 1502 年追加）
  "colony", "site", "discovery", "fame", "settler", "claim", "build", "population", "ai_event", "relic",
  // 殖民建筑（与 data/colony.toml 的建筑 key 一一对应：cb_ + key）
  "cb_farm", "cb_plantation", "cb_lumber", "cb_mine", "cb_fishery", "cb_hunting", "cb_distillery",
  "cb_sugarmill", "cb_storehouse", "cb_fort", "cb_chapel", "cb_tavern", "cb_dock", "cb_housing",
] as const;
export type IconName = (typeof ICON_NAMES)[number];

const ALL_ICONS: Record<string, () => Px> = { ...UI_ICONS, ...COLONY_ICONS };

/** 界面图标（16×16，透明底，带描边）。 */
export function drawIcon(name: IconName): Px {
  const make = Object.prototype.hasOwnProperty.call(ALL_ICONS, name) ? ALL_ICONS[name] : undefined;
  return memo(`icon:${name}`, () => (make ? make() : new Px(16, 16))).clone();
}

/** 殖民建筑 key（colony.toml）对应的图标名；未知建筑返回 null。 */
export function colonyBuildingIcon(key: string): IconName | null {
  const name = `cb_${key}`;
  return (ICON_NAMES as readonly string[]).includes(name) ? (name as IconName) : null;
}

const ALL_GOODS: Record<string, () => Px> = { ...GOOD_ICONS, ...GOOD_ICONS_1502, ...GOOD_ICONS_BOOKS };

/** 已画好专属图标的商品 key（goods.toml 的顺序）。 */
export const GOOD_ICON_KEYS: readonly string[] = Object.keys(ALL_GOODS);

/**
 * 寰宇追加的交易品里已画好专属图标的 key（docs/drafts/goods-expansion.json 的顺序）。
 * 这些货只进寰宇的商品分片、不进 goods.toml，所以单列一张登记表，不并进 GOOD_ICON_KEYS。
 * 图标按 key 取：界面只拿载入的世界数据里的商品 key 来画，数据里还没有这种货时这些图样不会被用到。
 */
export const TERRA_GOOD_ICON_KEYS: readonly string[] = Object.keys(GOOD_ICONS_1600);

const OWN_GOODS: Record<string, () => Px> = { ...ALL_GOODS, ...GOOD_ICONS_1600 };

/** 商品图标（16×16）；key 为世界数据中的商品 key，未知商品按 category 画通用图样。 */
export function drawGoodIcon(key: string, category?: string): Px {
  const own = Object.prototype.hasOwnProperty.call(OWN_GOODS, key) ? OWN_GOODS[key] : undefined;
  if (own) return memo(`good:${key}`, own).clone();
  const cat = category && Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, category) ? CATEGORY_ICONS[category] : undefined;
  return memo(`good-cat:${cat ? category : "?"}`, cat ?? FALLBACK_GOOD).clone();
}

// ───────────────────────────── 天况与时刻（第四批追加） ─────────────────────────────

/** 天况与时刻图标（EXPANSION.md §9.3）：sky_ + 天况（与 SkyKind 一一对应），以及时刻用的太阳、半日、月亮。 */
export const SKY_ICON_NAMES = ["sky_clear", "sky_cloudy", "sky_rain", "sky_fog", "sky_storm", "sky_snow", "sun", "sun_half", "moon"] as const;
export type SkyIconName = (typeof SKY_ICON_NAMES)[number];

/** 天况与时刻图标（16×16，透明底，带描边；风格与界面图标相同）。 */
export function drawSkyIcon(name: SkyIconName): Px {
  const make = Object.prototype.hasOwnProperty.call(SKY_ICONS, name) ? SKY_ICONS[name] : undefined;
  return memo(`sky-icon:${name}`, () => (make ? make() : new Px(16, 16))).clone();
}

/** 风向小箭头（16×16）：dir 为风的去向（0 = 北，顺时针 8 方向），箭头指向风吹去的方向。 */
export function drawWindIcon(dir: number): Px {
  const d = ((Math.round(Number.isFinite(dir) ? dir : 0) % 8) + 8) % 8;
  return memo(`wind-icon:${d}`, () => windIcon(d)).clone();
}
