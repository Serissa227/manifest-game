// 建筑：港口街景中的设施建筑、民居、远景与街道小物件。
// 接口（函数签名与类型）由界面代码依赖，不要改；画法可以随意重写。
// 画法拆在 ./buildings/ 目录：kit（画布与材质）、style（风格套件接口）、七种风格各一个文件、
// facilities（九种设施构图）、houses、skyline、landmarks、props、town（城墙与城门）。
// 第九批的六种文化城镇风格（TownStyle：日本、明、奥斯曼、斯瓦希里、马来、玛雅）每种一个文件，
// 把套件、地标、城门、城墙、远景与物件放在一起（townArt.ts 定义接口，cultures.ts 汇总）。
import type { Facility } from "../store/game";
import type { Px } from "./px";
import { hash32 } from "./rng";
import { desert } from "./buildings/desert";
import { eastern } from "./buildings/eastern";
import { frontier } from "./buildings/frontier";
import { islands } from "./buildings/islands";
import { lowland } from "./buildings/lowland";
import { cypress, mediterranean } from "./buildings/mediterranean";
import { nordic } from "./buildings/nordic";
import { CANVAS_H, CANVAS_W, FACILITY_DRAW } from "./buildings/facilities";
import { drawHouseWith } from "./buildings/houses";
import { drawLandmarkImpl } from "./buildings/landmarks";
import { drawColonyImpl } from "./buildings/colony";
import { drawPropImpl, rampOf } from "./buildings/props";
import { drawSkylineImpl } from "./buildings/skyline";
import { drawCityWallImpl, drawGateImpl } from "./buildings/town";
import { Canvas, finish } from "./buildings/kit";
import { Px as PxBuf } from "./px";
import { type Kit, seedTag } from "./buildings/style";
import { CULTURES } from "./buildings/cultures";

export { seedTag };
export { COLONY_KEYS, DOCK_DECK_FROM_BOTTOM, isColonyKey, type ColonyBuildingKey } from "./buildings/colony";

/**
 * 建筑风格，按文化区分（原创架空风格，见 docs/ART.md 与 docs/EXPANSION.md §8）：
 * mediterranean 地中海、nordic 北地、lowland 低地、desert 沙漠、islands 群岛、eastern 东方、frontier 开拓者殖民地。
 */
export type ArchStyle = "mediterranean" | "nordic" | "lowland" | "desert" | "islands" | "eastern" | "frontier";
export const ARCH_STYLES: readonly ArchStyle[] = ["mediterranean", "nordic", "lowland", "desert", "islands", "eastern", "frontier"];

/** 势力 key → 建筑风格（势力数据没有给出合法的 style 字段时使用）。 */
export const FACTION_STYLE: Readonly<Record<string, ArchStyle>> = {
  cuilan: "mediterranean",
  shuangling: "nordic",
  jinsui: "lowland",
  chisha: "desert",
  bichao: "islands",
  yaohua: "eastern",
};

/** 未知势力使用的风格。 */
export const DEFAULT_STYLE: ArchStyle = "mediterranean";

/** 是否为合法的建筑风格名。 */
export function isArchStyle(s: unknown): s is ArchStyle {
  return typeof s === "string" && (ARCH_STYLES as readonly string[]).includes(s);
}

/**
 * 第九批“寰宇·十六世纪”画出来的六种文化城镇风格（FRAMEWORK §15.1 / 第九批 F12）：
 * japanese 日本港町、ming 明代闽粤海港、ottoman 奥斯曼、swahili 斯瓦希里海岸、malay 马来群岛、maya 玛雅。
 * 只用于画街景的建筑（设施、民居、远景、地标、城墙、城门、物件、殖民建筑）；
 * 音乐、地面、人物等其他模块仍按粗分的 ArchStyle（见 CULTURE_BASE 与 styleOf）。
 */
export type CultureStyle = "japanese" | "ming" | "ottoman" | "swahili" | "malay" | "maya";
export const CULTURE_STYLES: readonly CultureStyle[] = ["japanese", "ming", "ottoman", "swahili", "malay", "maya"];

/** 街景的城镇风格：七种经典风格 ∪ 六种文化风格。 */
export type TownStyle = ArchStyle | CultureStyle;
export const TOWN_STYLES: readonly TownStyle[] = [...ARCH_STYLES, ...CULTURE_STYLES];

/** 文化风格 → 粗分的建筑风格（给按 ArchStyle 工作的模块用：音乐、地面、人物、气候……）。 */
export const CULTURE_BASE: Readonly<Record<CultureStyle, ArchStyle>> = {
  japanese: "eastern",
  ming: "eastern",
  ottoman: "desert",
  swahili: "desert",
  malay: "islands",
  maya: "frontier",
};

/** 是否为六种文化风格之一。 */
export function isCultureStyle(s: unknown): s is CultureStyle {
  return typeof s === "string" && (CULTURE_STYLES as readonly string[]).includes(s);
}

/** 是否为合法的城镇风格名（经典七种或文化六种）。 */
export function isTownStyle(s: unknown): s is TownStyle {
  return isArchStyle(s) || isCultureStyle(s);
}

/** 城镇风格 → 粗分的建筑风格：经典风格原样返回，文化风格按 CULTURE_BASE。 */
export function baseStyle(s: TownStyle): ArchStyle {
  return isCultureStyle(s) ? CULTURE_BASE[s] : s;
}

/**
 * 第九批的世界用的更细的风格名（world.toml [art] styles、势力的 style 字段）→ 最接近的城镇风格
 * （FRAMEWORK §15.1：“未知风格回退到最接近的已有风格”）。六种文化风格自己的名字不在表里（直接就是城镇风格）。
 * 取舍见 docs/DECISIONS.md（2026-10-07 港口街景的文化风格）。
 */
export const TOWN_ALIASES: Readonly<Record<string, TownStyle>> = {
  iberian: "mediterranean",
  portuguese: "mediterranean",
  spanish: "mediterranean",
  italian: "mediterranean",
  venetian: "mediterranean",
  genoese: "mediterranean",
  greek: "mediterranean",
  atlantis: "mediterranean",
  low_countries: "lowland",
  flemish: "lowland",
  dutch: "lowland",
  english: "lowland",
  french: "lowland",
  hanseatic: "nordic",
  baltic: "nordic",
  scandinavian: "nordic",
  russian: "nordic",
  // 寰宇 [art] styles 里笼统的“北方”（配乐的数据接线时补：原来没有去处，写它的势力街景会退成地中海式）
  northern: "nordic",
  arabic: "desert",
  maghreb: "desert",
  persian: "desert",
  mamluk: "desert",
  ethiopian: "desert",
  // 以下几个是配乐的数据接线（2026-10-11）时势力改用的文化细名，街景都指向那些势力原来用的风格（看上去不变）：
  // 阿拉伯的另一种写法（寰宇 [art] styles 里有，原来没有去处）；奥斯曼治下的马格里布（阿尔及尔、的黎波里）照旧画奥斯曼；
  // 贝宁（埃多）与恩东戈照旧借斯瓦希里海岸
  arabian: "desert",
  ottoman_maghreb: "ottoman",
  edo: "swahili",
  ndongo: "swahili",
  // 印度与莫卧儿：圆顶、细高的塔与出挑的木阳台，最接近奥斯曼
  indian: "ottoman",
  mughal: "ottoman",
  // 北印度的宫廷（苏尔王朝写 hindustani）、德干的苏丹国、维查耶纳伽尔（卡纳提克）、马拉巴尔与锡兰：照旧与 indian 一样借奥斯曼
  hindustani: "ottoman",
  deccan: "ottoman",
  carnatic: "ottoman",
  malabar: "ottoman",
  sinhalese: "ottoman",
  // 爪哇、摩鹿加、暹罗、缅甸、菲律宾：高脚木屋、陡峭的多层屋顶，最接近马来
  javanese: "malay",
  moluccan: "malay",
  siamese: "malay",
  burmese: "malay",
  philippine: "malay",
  // 占婆：砖砌的塔与高脚木屋，也最接近马来
  champa: "malay",
  polynesian: "islands",
  // 查莫罗（关岛）：照旧是群岛
  chamorro: "islands",
  chinese: "ming",
  // 朝鲜与琉球：城墙城楼与官衙沿用明制，琉球是红瓦屋顶，都最接近明（不画成日本）
  korean: "ming",
  ryukyu: "ming",
  // 大越：城池、官衙与会馆沿用中国的制度与屋顶，最接近明（港口曲另有《会安的河埠》，见 audio/zones.ts）
  vietnamese: "ming",
  dai_viet: "ming",
  jurchen: "eastern",
  // 阿兹特克与安第斯：石砌台基、阶梯金字塔、茅草屋，最接近玛雅
  aztec: "maya",
  mesoamerican: "maya",
  andean: "maya",
  inca: "maya",
  caribbean: "frontier",
  tupi: "frontier",
  colonial: "frontier",
  west_african: "frontier",
  kongo: "frontier",
};

/**
 * 第九批的风格名 → 粗分的建筑风格（styleOf 用；六种文化风格按 CULTURE_BASE，其余细名按 TOWN_ALIASES 再取粗类）。
 * 粗类与第九批之前完全一样，按 ArchStyle 工作的模块不受影响。
 */
export const STYLE_ALIASES: Readonly<Record<string, ArchStyle>> = Object.fromEntries([
  ...CULTURE_STYLES.map((s) => [s, CULTURE_BASE[s]] as const),
  ...Object.entries(TOWN_ALIASES).map(([k, v]) => [k, baseStyle(v)] as const),
]);

function own<T>(table: Readonly<Record<string, T>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(table, key);
}

/** 风格名 → 城镇风格：合法的城镇风格原样返回，第九批的细名按 TOWN_ALIASES 回退，都不是时返回 fallback。 */
export function townStyleOr(style: string | null | undefined, fallback: TownStyle): TownStyle {
  if (isTownStyle(style)) return style;
  if (typeof style === "string" && own(TOWN_ALIASES, style)) return TOWN_ALIASES[style];
  return fallback;
}

/**
 * 势力 → 街景的城镇风格（画港口街景、城镇与殖民建筑用）：style 是城镇风格时优先，第九批的细名按 TOWN_ALIASES
 * 回退到最接近的城镇风格；否则按 FACTION_STYLE 由势力 key 映射；未知势力按地中海风格处理。
 * 经典世界的势力不带文化风格名，结果与 styleOf 相同。
 */
export function townStyleOf(factionKey: string | undefined, style?: string | null): TownStyle {
  const key = factionKey ?? "";
  return townStyleOr(style, own(FACTION_STYLE, key) ? FACTION_STYLE[key] : DEFAULT_STYLE);
}

/**
 * 势力 → 建筑风格（粗分的七种）：style（势力数据的 style 字段）合法时优先；第九批的风格名换成最接近的粗类
 * （六种文化风格按 CULTURE_BASE）；否则按 FACTION_STYLE 由势力 key 映射；未知势力按地中海风格处理。
 */
export function styleOf(factionKey: string | undefined, style?: string | null): ArchStyle {
  return baseStyle(townStyleOf(factionKey, style));
}

/**
 * 画法借用：给其他美术模块（地面、码头、人物、地图标记）用。那些模块还没有为 mediterranean 与 frontier 画专属画法时，
 * 分别借用 lowland 与 nordic 的画法。建筑模块本身（设施、民居、远景、地标、城墙、城门、物件、殖民建筑）已有两种风格的正式画法，不再经过这一步。
 */
const BORROWED: Readonly<Partial<Record<ArchStyle, ArchStyle>>> = { mediterranean: "lowland", frontier: "nordic" };

/** 风格在尚未提供专属画法的模块里借用的画法（借用画法的风格返回被借用的风格，其余原样返回）。 */
export function drawnStyle(style: ArchStyle): ArchStyle {
  return BORROWED[style] ?? style;
}

export interface BuildingOpts {
  /** 季节 0 春 1 夏 2 秋 3 冬 */
  season: number;
  /** 屋顶积雪（冬季的寒冷港口） */
  snow?: boolean;
  /** 窗户亮灯 */
  lit?: boolean;
}

/**
 * 设施建筑。返回的图已裁掉透明边；底边就是地面线，门在底边附近。
 * 同一设施在不同风格下保持可辨认的招牌图样（交易所=天平、船厂=锚与船架、酒馆=酒杯……）。
 */
export function drawBuilding(fac: Facility, style: TownStyle, opts: BuildingOpts): Px {
  const c = new Canvas(CANVAS_W, CANVAS_H, style, norm(opts), hash32(`${fac}/${seedTag(style)}`));
  FACILITY_DRAW[fac](c, KITS[style]);
  return finish(c);
}

/** 风格 → 构件套件（六种文化风格的套件来自 cultures.ts）。 */
export const KITS: Readonly<Record<TownStyle, Kit>> = {
  mediterranean,
  nordic,
  lowland,
  desert,
  islands,
  eastern,
  frontier,
  japanese: CULTURES.japanese.kit,
  ming: CULTURES.ming.kit,
  ottoman: CULTURES.ottoman.kit,
  swahili: CULTURES.swahili.kit,
  malay: CULTURES.malay.kit,
  maya: CULTURES.maya.kit,
};

/** 规范化绘制选项：季节取模到 0–3，布尔值去掉 undefined。 */
export function norm(o: BuildingOpts): { season: number; snow: boolean; lit: boolean } {
  const s = Number.isFinite(o.season) ? ((Math.floor(o.season) % 4) + 4) % 4 : 0;
  return { season: s, snow: !!o.snow, lit: !!o.lit };
}

/** 普通民居，variant 相同则图相同。每种风格 8 种变体（variant 取模），宽 28–48。 */
export function drawHouse(style: TownStyle, variant: number, opts: BuildingOpts): Px {
  return drawHouseWith(style, KITS[style], variant, norm(opts));
}

/** 远景建筑剪影（后排屋顶、塔楼、城墙），宽度为 width、高 64，贴在街景后方；可无缝横向重复。 */
export function drawSkyline(style: TownStyle, width: number, opts: BuildingOpts): Px {
  return drawSkylineImpl(style, width, norm(opts));
}

/**
 * 每种风格的城市地标（圆顶大教堂与钟楼、尖塔、风车、圆顶望楼、灯塔、楼阁、瞭望塔，原创；
 * 文化风格：寺院山门与多宝塔、天妃宫与砖塔、清真寺、柱墓与小清真寺、多层屋顶的清真寺、阶梯金字塔），各风格轮廓互不相同。
 */
export function drawLandmark(style: TownStyle, opts: BuildingOpts): Px {
  return drawLandmarkImpl(style, norm(opts));
}

/** 城墙段落（内陆城市街景用）：宽 width、高 64，可无缝横向重复；每隔约 72 像素一座墙台。 */
export function drawCityWall(style: TownStyle, width: number, opts: BuildingOpts): Px {
  return drawCityWallImpl(style, width, norm(opts));
}

/** 城门：一座独立的门楼（已描边、裁边，底边是地面线，门洞在底边正中）。 */
export function drawGate(style: TownStyle, opts: BuildingOpts): Px {
  return drawGateImpl(style, norm(opts));
}

export type PropKind = "crates" | "barrels" | "cart" | "lamp" | "flagpole" | "well" | "stall" | "bench" | "sacks" | "anchor";

/** 街道小物件。flag 为旗帜颜色（势力色），lit 为灯火点亮（街灯、灯笼的夜间样子）。图已描边、裁边，底边是地面线。 */
export function drawProp(kind: PropKind, style: TownStyle, opts: { variant?: number; flag?: string; lit?: boolean } = {}): Px {
  return drawPropImpl(kind, style, opts, !!opts.lit);
}

/** 殖民建筑的绘制选项：flag 为所有者的旗色（"#rrggbb"，堡垒上的旗）。 */
export interface ColonyOpts extends BuildingOpts {
  flag?: string;
}

/**
 * 殖民建筑（docs/EXPANSION.md §4.1 的 14 种 key），level 1–3 逐级变大、变精致；未知 key 按住宅区画。
 * 1、2 级是开拓者的简陋营地与原木房子，3 级用 style（所有者的风格）画墙与屋顶。
 * 图已描边、裁边，底边是地面线；码头的底边是桩脚，桥面在底边以上 DOCK_DECK_FROM_BOTTOM 行。
 */
export function drawColonyBuilding(key: string, level: number, style: TownStyle, opts: ColonyOpts): Px {
  let flag: readonly string[] = KITS[style].flag;
  if (opts.flag) {
    try {
      flag = rampOf(opts.flag);
    } catch {
      // 颜色写错时用风格默认旗色
    }
  }
  return drawColonyImpl(key, level, style, KITS, norm(opts), flag);
}

/** 地中海街景的柏树：细高的纺锤形常青树，高 height（16–60），variant 改变枝叶的明暗。已描边、裁边，底边是地面线。 */
export function drawCypress(height: number, variant = 0): Px {
  const h = Math.max(16, Math.min(60, Math.floor(Number.isFinite(height) ? height : 30)));
  const p = new PxBuf(16, h + 2);
  cypress(p, 8, h + 1, h, Math.abs(Math.floor(variant)) || 0);
  return p.outlined("#16301f").trimmed();
}
