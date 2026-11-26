// 航海图美术的公共类型与常量（由 art/map.ts 统一导出）。
import type { FineLayers } from "./fine";

/** 海图每格的像素数。 */
export const CHART_CELL = 4;
/**
 * 细节美术的密度（第九批 M01“细海图”）：每粗格的美术像素数。只有带细图层的地图（寰宇）才有细节瓦片（detail.ts），
 * 世界图的近档与航行视图用；整张海图（远档）仍是每格 CHART_CELL 像素。
 */
export const DETAIL_CELL = 24;
/** 一块细节瓦片的边长（粗格）：32 × 32 格 = 768 × 768 美术像素。 */
export const DETAIL_TILE = 32;
/** 海图四周画框的宽度（像素）。框画在最外两格陆地上，不改变坐标。 */
export const CHART_FRAME = 8;
/**
 * 新大陆的起始列：x ≥ 该值的陆地（离东方帝国的港口较远处）画成新大陆的原始地貌——密林、草原与更多的山脉。
 * 与 docs/EXPANSION.md §3 一致：旧世界是左上的 240×120。
 */
export const NEW_WORLD_X = 240;

/** 海图上的地点种类：港口、内陆城市、可殖民地点（殖民点）。 */
export type ChartPlaceKind = "port" | "city" | "site";

/** 海图上的地点（决定周边的人文景观与避让）。 */
export interface ChartPlace {
  x: number;
  y: number;
  kind: ChartPlaceKind;
  /** 势力 key（决定周边的气候与地貌）；殖民点没有势力时为空串 */
  faction: string;
  /** 势力数据中的建筑风格（factions.toml 的 style；缺省时由势力 key 推断，规则同 styleOf） */
  style?: string | null;
  /** 殖民点的地形：forest | plains | hills | jungle | tundra | desert | swamp | island（决定殖民点周边的地貌） */
  terrain?: string | null;
}

/** 道路：两端的格坐标。 */
export interface ChartRoad {
  from: readonly [number, number];
  to: readonly [number, number];
}

/** 河流（EXPANSION.md §10.3 的 rivers.toml）：从源头到入海口的陆格折线。 */
export interface ChartRiver {
  key?: string;
  /** 格坐标，源头在前；最后一格是与海相邻的陆格（入海口） */
  path: readonly (readonly [number, number])[];
  /** 1–3：入海处的宽度等级 */
  width: number;
}

/** 地标类别：natural 自然奇观 | arcane 魔法奇观 | ancient 古代遗迹 | civic 人文地标。 */
export type LandmarkCategory = "natural" | "arcane" | "ancient" | "civic";

/** 地标与奇观（landmarks.toml）：左上角格坐标与占地（格）。 */
export interface ChartLandmark {
  key: string;
  category: LandmarkCategory;
  kind: string;
  x: number;
  y: number;
  /** 占地（格），缺省 1 */
  w?: number;
  h?: number;
}

export interface ChartInput {
  width: number;
  height: number;
  /** 每行一个字符串：'#' 陆地、'-' 浅海、其余（'~' 或 '.'）深海——与 StaticView.map.rows 相同。 */
  rows: readonly string[];
  places?: readonly ChartPlace[];
  roads?: readonly ChartRoad[];
  /** 新大陆的起始列（缺省 NEW_WORLD_X） */
  newWorldX?: number;
  /** 高程图层（§10.3 relief.txt）：陆格 '0'–'9'，海格 '.'。缺省时由海陆图推导（离岸距离 + 噪声） */
  relief?: readonly string[];
  /** 植被 / 地貌图层（§10.3 biomes.txt）：陆格 I T B F G M K D S J W A V X，海格 '.'。缺省时按纬度与离海距离推导 */
  biomes?: readonly string[];
  /** 河流；缺省时没有河流 */
  rivers?: readonly ChartRiver[];
  /** 地标与奇观；画在海图位图里（位于迷雾之下，未探明时看不见） */
  landmarks?: readonly ChartLandmark[];
  /**
   * 第九批（FRAMEWORK §5）：等距圆柱投影。有投影时纬度、气候、积雪与“新大陆”都按真实经纬推断；
   * 缺省（经典世界）时照旧按 170 行的世界比例与 newWorldX，输出逐像素不变。
   */
  projection?: ChartProjection | null;
  /** 东西相连：海图按环绕绘制（接缝两侧无缝），画框只画上下两边。缺省不环绕。 */
  wrapX?: boolean;
  /**
   * 细图层（第九批 M01“细海图”，只有寰宇有）：给出时整张海图的海岸取细海岸层降采样得到的真实海岸，
   * 并且可以画每格 24 像素的细节瓦片（detail.ts）。缺省（经典世界）时照旧由格级距离场加噪声做海岸，输出逐像素不变。
   */
  fine?: FineLayers | null;
  /** 环绕地图补边后（wrap.ts 的 padWrapInput），本图第 0 列对应细图层的哪一列（粗格，可以为负；按宽度取模）。缺省 0。 */
  fineOffsetX?: number;
}

/** 等距圆柱投影（角分）：第 0 列左缘的经度、第 0 行上缘的纬度、每格的角分（同 MapResource.projection）。 */
export interface ChartProjection {
  kind?: "equirect";
  west: number;
  north: number;
  arcmin_per_cell: number;
}

export interface ChartOpts {
  /** 季节 0 春 1 夏 2 秋 3 冬：改变树色与积雪 */
  season?: number;
}

/**
 * 殖民点标记的状态（三选一，按优先级）：
 * - colony 非空：已建成的殖民地——小木屋与所有者的旗（主角的旗是金色）；
 * - claim 非空：被某势力占领——势力色的小旗；
 * - 都为空：未开拓——海滩与问号小旗。
 */
export interface SiteMark {
  /** 占领该殖民点的势力旗色 */
  claim?: string | null;
  /** 已建成的殖民地：旗色与规模（0 小、1 中、2 大，按人口分档） */
  colony?: { flag: string; size?: number } | null;
}

/** 发现物种类（与 data/world/discoveries.toml 的 kind 一致）。 */
// 后四种是寰宇的发现物：珍禽异兽、珍奇草木、天降石、传说中的幻岛
export type DiscoveryKind = "ruins" | "wonder" | "wreck" | "relic" | "beast" | "landmark" | "animal" | "plant" | "fallen" | "phantom";
export const DISCOVERY_KINDS: readonly DiscoveryKind[] = ["ruins", "wonder", "wreck", "relic", "beast", "landmark", "animal", "plant", "fallen", "phantom"];
