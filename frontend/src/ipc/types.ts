// 与后端 crates/manifest-app/src/views.rs、handlers.rs 对应的数据类型。
// 金额为整数，单位见静态数据的 world.currency（默认“金币”，界面一律用 i18n 的 money() 格式化）；
// 比例类数值用万分之一（bp）整数表示。
import type { ActCommand, ActView } from "./actTypes";

export type Money = number;

export interface MapView {
  width: number;
  height: number;
  rows: string[];
  /** 高程图层（EXPANSION.md §10.3）：每行一个字符串，陆格 '0'–'9'，海格 '.'；数据没有该图层时缺省 */
  relief?: string[];
  /** 植被 / 地貌图层：陆格为代码 I T B F G M K D S J W A V X，海格 '.'；数据没有该图层时缺省 */
  biomes?: string[];
}

/** 河流（rivers.toml）：从源头到入海口的格坐标折线。 */
export interface RiverView {
  key: string;
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  path: [number, number][];
  /** 1–3 */
  width: number;
}

/** 地标与奇观（landmarks.toml）。 */
export interface LandmarkView {
  key: string;
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  /** natural 自然奇观 | arcane 魔法奇观 | ancient 古代遗迹 | civic 人文地标 */
  category: "natural" | "arcane" | "ancient" | "civic";
  kind: string;
  x: number;
  y: number;
  /** 占地（格），缺省 1×1 */
  w: number;
  h: number;
  lore: string;
  /** 对应的发现物 key（没有为 null） */
  discovery: string | null;
}

/** 世界配置：货币名称与纪年（日期显示为 start_year + 年序 − 1）。 */
export interface WorldView {
  /** 货币名称，如“金币” */
  currency: string;
  /** 纪年名称，如“航海历” */
  era: string;
  /** 游戏第 1 年对应的纪年年份（1502） */
  start_year: number;
  /** 第九批：世界的 key、名字、地图与日历（旧后端没有，按经典世界：12 × 30、1–3 月为春） */
  key?: string;
  name?: string;
  map_key?: string;
  calendar?: { months: number[]; seasons: number[]; month_names: string[] };
  /** 打开的模块（同 WorldCard.modules）；经典世界为空 */
  modules?: string[];
  /** B11：这个世界的内容有哪些语言（缺省 ["zh", "en"]）；不含 "en" 时剧情、人物等文字只有中文，界面仍可切英文 */
  languages?: string[];
}

/** 地点种类：港口、内陆城市、殖民点（可殖民的锚地）。 */
export type LocKind = "port" | "city" | "site";

/** 殖民点地形。 */
export type SiteTerrain =
  | "forest"
  | "plains"
  | "hills"
  | "jungle"
  | "tundra"
  | "desert"
  | "swamp"
  | "island";

/** 殖民点的自然条件。 */
export interface SiteInfoView {
  terrain: SiteTerrain;
  /** 肥力 1–100：农庄产量 */
  fertility: number;
  /** 风险 1–100：疾病与袭击 */
  hazard: number;
  /** （商品 id, 丰度 1–100） */
  resources: [number, number][];
}

export interface LocView {
  id: number;
  key: string;
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  /** port / city / site（殖民点的 faction 为占位的 0，无意义） */
  kind: LocKind;
  x: number;
  y: number;
  faction: number;
  shipyard: boolean;
  /** 建城年份（纪年）；未写为 null。旧测试数据可能没有这个字段 */
  founded?: number | null;
  /** 简史（可为空字符串） */
  lore?: string;
  /** 殖民点的自然条件（只有殖民点有，其余为 null） */
  site?: SiteInfoView | null;
  /** 停泊格所在海区（街景取当地天气用）；内陆城市或旧后端为 null / 缺省 */
  region?: number | null;
}

export interface RoadView {
  id: number;
  from: number;
  to: number;
  terrain: string;
  length: number;
  toll_bp: number;
  security_bp: number;
  faction: number;
}

export interface GoodView {
  id: number;
  key: string;
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  category: string;
  tier: number;
  base_price: Money;
  license: boolean;
  /** 历史风味的介绍（可为空字符串） */
  description: string;
  /** 需求层级（ECONOMY.md 6.4）：必需 / 舒适 / 奢侈；生产资料与旧后端为空 */
  need?: NeedTier | null;
  /** 替代组编号（同组商品满足同一种需求）；没有替代组与旧后端为空 */
  group?: number | null;
  /** 货档 1–3（T01：买入要的商誉见 PortView.invest.house）；0 档、没有货档的世界与旧后端缺省 */
  rank?: number;
}

/** 需求层级。 */
export type NeedTier = "essential" | "comfort" | "luxury";

export interface ShipTypeView {
  id: number;
  key: string;
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  /** 历史风味的介绍（可为空字符串） */
  description: string;
  sail: "square" | "lateen";
  speed: number;
  capacity: number;
  durability: number;
  crew_min: number;
  crew_max: number;
  guns: number;
  price: Money;
  /** 独有船型：船厂不出售、不能建造、NPC 不使用；旧后端没有这个字段 */
  unique?: boolean;
}

export interface RefitView {
  id: number;
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  price: Money;
  capacity: number;
  durability: number;
  guns: number;
  speed: number;
}

export interface FactionView {
  id: number;
  key: string;
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  license_price: Money;
  marque_price: Money;
  /** 地图配色（十六进制）：数据中的 color，未写时取内置调色板 */
  color: string;
  /** 建筑风格（mediterranean / nordic / lowland / desert / islands / eastern / frontier）；未写为 null */
  style: string | null;
}

export interface NamedView {
  id: number;
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  /** 海区才有：音乐分区（regions.toml 的 music 字段，FRAMEWORK §15.1），决定在这片海上放哪首航海曲；旧后端与经典世界没有 */
  music?: string | null;
}

export interface AnimalView {
  id: number;
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  capacity: number;
  speed: number;
  price: Money;
  upkeep: Money;
}

export interface IndustryTypeView {
  id: number;
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  build_cost: Money;
  workers: number;
  wage: Money;
  maintenance: Money;
  manager_salary: Money;
}

export interface RecipeView {
  id: number;
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  industry: number;
  inputs: [number, number][];
  outputs: [number, number][];
}

export interface ExchangeView {
  id: number;
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  port: number;
  initial_margin_bp: number;
  maintenance_margin_bp: number;
  position_limit: number;
}

export interface RulesView {
  crew_hire_cost: Money;
  crew_wage: Money;
  food_price: Money;
  water_price: Money;
  crew_per_supply_unit: number;
  warehouse_rent_per_100: Money;
  warehouse_price_per_unit: Money;
  guard_wage: Money;
  guard_hire_cost: Money;
  invest_min: Money;
  loan_max_months: number;
  /** 建立殖民地至少需要的殖民者（从舰队船员中转出） */
  colony_min_settlers: number;
  /** 建立费 */
  colony_found_cost: Money;
  /** 建立时须从舰队卸下的物资（商品 id, 数量） */
  colony_found_materials: [number, number][];
  /** 税率档位：（收入百分比, 士气目标增减），下标即 SetColonyTax 的 rate */
  colony_tax_levels: [number, number][];
  /** 每个所有者最多拥有的殖民地数 */
  colony_max: number;
  /** V01：粮水按人日累计（寰宇 true、经典 false）：一份够 crew_per_supply_unit 人吃一天，吃到一半的那份仍占一格舱位；旧后端没有 */
  fractional_supplies?: boolean;
}

/** 殖民地建筑的种类。 */
export type ColonyBuildingKind =
  | "food"
  | "extract"
  | "process"
  | "storage"
  | "defense"
  | "morale"
  | "dock"
  | "housing";

/** 殖民地建筑（静态定义，数值均为“每级”）。 */
export interface ColonyBuildingView {
  id: number;
  /** farm / plantation / lumber / mine / fishery / hunting / distillery / sugarmill / storehouse / fort / chapel / tavern / dock / housing */
  key: string;
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  kind: ColonyBuildingKind;
  /** 每级建造费 */
  cost: Money;
  /** 每级建材（商品 id, 数量），从殖民地仓库扣除 */
  materials: [number, number][];
  build_days: number;
  /** 每级需要的工人 */
  workers: number;
  /** 每级每月维护费 */
  upkeep: Money;
  max_level: number;
  /** food / extract：可产出的商品（与地点资源取交集） */
  goods: number[];
  /** food / extract：每级每天基础产量（件），再乘肥力或资源丰度 /100 */
  output: number;
  /** process：每级每天投入与产出（商品 id, 件数） */
  inputs: [number, number][];
  outputs: [number, number][];
  /** storage：每级增加的仓储容量 */
  capacity: number;
  /** defense：每级防御值 */
  defense: number;
  /** morale：每级士气加成 */
  morale: number;
  /** housing：每级人口上限加成 */
  housing: number;
  description: string;
}

/** 发现物的种类。 */
/** 后四种只出现在寰宇：animal / plant / fallen / phantom（B10b） */
export type DiscoveryKind =
  | "ruins"
  | "wonder"
  | "wreck"
  | "relic"
  | "beast"
  | "landmark"
  | "animal"
  | "plant"
  | "fallen"
  | "phantom";

/** 发现物目录（位置只在发现后由 api.discoveries() 的 found 给出）。 */
export interface DiscoveryDefView {
  id: number;
  key: string;
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  kind: DiscoveryKind;
  /** 报告后获得的名声 */
  fame: number;
  /** 报告赏金 */
  value: Money;
  lore: string;
  /** B12：要潜水才找得到的发现物（省略为 false） */
  dive?: boolean;
}

/** 剧本目标（开局界面的剧本卡片用）。 */
export interface ScenarioGoalView {
  kind: "net_worth" | "ally_ports" | "colonies" | "sandbox" | "story";
  /** 目标净资产、同盟港数量、殖民地数量或故事线的章数；沙盒为 0 */
  target: number;
  /** colonies：每个殖民地至少需要的人口；其他目标没有这个字段 */
  population?: number;
  /** 限期（年）；不限期为 null */
  years: number | null;
}

export interface ScenarioView {
  key: string;
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  description: string;
  /** 起始港口（地点 id） */
  start: number;
  /** 起始资金 */
  cash: Money;
  /** 起始船只（船型 id） */
  ships: number[];
  /** 起始船员 */
  crew: number;
  /** 开局即受雇的航海士人数 */
  mates: number;
  goal: ScenarioGoalView;
  /** 开局货物（装在开局舰队的货舱）；没有时为空数组。旧后端没有这个字段 */
  cargo?: ScenarioCargoView[];
  /** 开局粮水（单位同补给）；旧后端没有这个字段 */
  food?: number;
  water?: number;
  /** 在开局界面加亮为“推荐选择”；旧后端没有这个字段 */
  recommended?: boolean;
  /** 定好的主角（推荐角色）；普通剧本为 null，旧后端没有这个字段 */
  hero?: HeroView | null;
  /** 挂的故事线；没有时为 null */
  story?: StoryLineInfo | null;
}

/** 推荐角色：剧本里定好的主角（姓名、专属外貌、生日、身世与属性分配）。 */
export interface HeroView {
  name: string;
  /** 外貌编号：100 以上是只给这位角色的专属头像，否则是普通外貌 */
  look: number;
  tagline: string;
  bio: string;
  month: number;
  day: number;
  age: number;
  /** 身世五问的回答（选项 key，按问题顺序） */
  answers: string[];
  /** 六项属性的自由分配点 */
  alloc: number[];
  genius: string | null;
}

/** 剧本挂的故事线（开局界面用）。 */
export interface StoryLineInfo {
  key: string;
  name: string;
  chapters: number;
}

/** 剧本的一行开局货物。 */
export interface ScenarioCargoView {
  /** 商品 id */
  good: number;
  qty: number;
}

export interface StaticView {
  data_hash: string;
  /** 货币与纪年 */
  world: WorldView;
  map: MapView;
  regions: NamedView[];
  locations: LocView[];
  roads: RoadView[];
  goods: GoodView[];
  ships: ShipTypeView[];
  refits: RefitView[];
  factions: FactionView[];
  companies: NamedView[];
  animals: AnimalView[];
  industry_types: IndustryTypeView[];
  recipes: RecipeView[];
  exchanges: ExchangeView[];
  scenarios: ScenarioView[];
  rules: RulesView;
  colony_buildings: ColonyBuildingView[];
  discoveries: DiscoveryDefView[];
  /** 河流；数据没有 rivers.toml 或旧后端时缺省 */
  rivers?: RiverView[];
  /** 地标与奇观；数据没有 landmarks.toml 或旧后端时缺省 */
  landmarks?: LandmarkView[];
  /** 主角身世（开局向导）；数据没有 captain.toml 时为空，旧后端缺省 */
  captain?: CaptainDefsView | null;
  /**
   * U06K1：养成行动制的内容文字（门名、家业名与说明、寒暄句），值直接取数据（可能还是“（待写）”）。
   * 键：`act:line:<门>:name`、`act:duty:<家业>:name`、`act:duty:<家业>:desc`、`act:greet:<家庭>:<池序>:<句序>`。没有行动制数据的世界省略。
   */
  upbringing_act_texts?: Record<string, string>;
}

/** 酒馆传闻里的算学奇才。 */
export interface GeniusRumorView {
  mate: number;
  name: string;
  /** 这一季落脚的港口 */
  loc: number;
  /** 他会的奇才之法 */
  methods: string[];
}

// ───────────────────────────── 主角身世（docs/ECONOMY.md 第 5 节） ─────────────────────────────

/** 六项属性的 key（顺序即界面与命令里 alloc 的顺序，与 manifest_core::captain::ATTRIBUTES 一致）。 */
export type AttributeKey =
  "seamanship" | "commerce" | "arms" | "stewardship" | "numeracy" | "eloquence";

/** 点数规则（captain.toml [points]）。 */
export interface CaptainPointsView {
  /** 每项属性的起点 */
  base: number;
  /** 自由分配的点数 */
  free: number;
  /** 开局时单项上限 */
  creation_cap: number;
  /** 单项上限 */
  max: number;
  /** 开局算学达到这个值：本人是算学奇才 */
  genius_numeracy: number;
  /** 算学达到这个值：行情窗口里可以手调参数与拟合窗口 */
  manual_numeracy: number;
  /** 算学达到这个值：与算学奇才共事满 learn_days 天后学会他的一种方法 */
  learn_numeracy: number;
  learn_days: number;
  /** 开局年龄范围（出生年份 = 开局年份 − 年龄） */
  age_min: number;
  age_max: number;
  /** 开局向导里年龄的缺省值 */
  age_default: number;
  /** 每年生日：旗舰船员士气增加 */
  birthday_morale: number;
}

export interface CaptainAttributeView {
  /** 经典世界是六项之一（AttributeKey）；第九批的世界按自己的属性表（任意 key） */
  key: string;
  name: string;
  desc: string;
  /** 第九批（UI-CONTRACT I2）：所属的组；隐藏的属性在觉醒之前不显示。旧后端没有 */
  group?: string;
  hidden?: boolean;
}

/** 第九批（UI-CONTRACT I2）：属性的组、评价与航海士岗位。 */
export interface AttributeGroupView {
  key: string;
  name: string;
  range: [number, number];
  start: number;
  free: number;
  creation_cap: number;
}
export interface RatingDefView {
  key: string;
  name: string;
  weights: [string, number][];
}
export interface RoleDefView {
  key: string;
  name: string;
  /** 看哪项能力（MateView.abilities 的 key） */
  ability: string;
  /**
   * 岗位的作用对象（舰队、商队、产业或商会）。契约 I2 与后端 A2 的 RoleView 都还没有输出它（内核 RoleDef.scope 有）：
   * 缺省时界面按经典岗位的 key 推断，推断不了就把四种对象都列出来、由内核校验。
   */
  scope?: RoleScope;
  /** H01：一句“这个岗位在海上管什么”（世界没写时不输出） */
  desc?: string;
}
/** 岗位的作用对象（内核 RoleScope，snake_case）。 */
export type RoleScope = "owner" | "fleet" | "caravan" | "industry";
/** 航海士能力的名字（内核 CaptainDefs.abilities：经典四项与世界追加的，如“观星”）。契约与后端都还没有输出，缺省时界面按属性名与经典能力名找。 */
export interface AbilityDefView {
  key: string;
  name: string;
}

/**
 * 星座：现行的十二星座按生日（月、日）判定，给一项属性 +1；
 * 旧版星宫（legacy）是早先按月份判定的原创星宫，只为旧存档保留名字与特性，不参与判定。
 */
export interface CaptainSignView {
  key: string;
  name: string;
  desc: string;
  attribute: string;
  /** 现行星座的首日与末日 [月, 日]（都含；摩羯座跨年：[12, 22] 到 [1, 19]）；旧版星宫为 null */
  start: [number, number] | null;
  end: [number, number] | null;
  /** 旧版星宫 */
  legacy: boolean;
}

/** 身世选项的开局效果（封闭集合）。 */
export interface CaptainEffectView {
  kind:
    | "cash_pct"
    | "reputation"
    | "fame"
    | "morale"
    | "chart"
    | "rumor"
    | "goods"
    | "loan";
  value?: number;
  /** 海区 id（chart） */
  region?: number;
  /** 商品 id 与数量（goods） */
  good?: number;
  qty?: number;
  /** 贷款金额与期限（loan） */
  amount?: number;
  months?: number;
}

export interface CaptainOptionView {
  key: string;
  name: string;
  text: string;
  /** 属性加点（只列非零的；属性 key 由世界定义） */
  attrs: [string, number][];
  effect: CaptainEffectView | null;
  /** 只给某位推荐角色用（带主角的剧本的 key）：开局向导不列出它 */
  hero?: string;
}

export interface CaptainQuestionView {
  key: string;
  title: string;
  prompt: string;
  options: CaptainOptionView[];
}

export interface CaptainDefsView {
  points: CaptainPointsView;
  attributes: CaptainAttributeView[];
  /** 第九批：属性的组、评价与岗位（旧后端没有；经典世界是一个组） */
  groups?: AttributeGroupView[];
  ratings?: RatingDefView[];
  roles?: RoleDefView[];
  /** 航海士能力的名字（见 AbilityDefView；后端暂未输出） */
  abilities?: AbilityDefView[];
  /** 现行的十二星座在前（白羊座起），旧版星宫在后 */
  signs: CaptainSignView[];
  questions: CaptainQuestionView[];
}

/** 航海历的生日（year 为纪年年份）。 */
export interface Birthday {
  year: number;
  month: number;
  day: number;
}

/** 主角档案（概览；旧存档或尚未立下身世时为空）。 */
export interface CaptainProfileView {
  birthday: Birthday;
  /** 星座 key 与名字（旧存档可能是旧版星宫） */
  sign: string;
  sign_name: string;
  /** 身世五问的回答（选项 key，按问题顺序） */
  answers: string[];
  /** 属性读数 [key, 值]：经典世界是六项，第九批的世界按自己的属性表（含隐藏属性，界面不显示隐藏的） */
  attrs: [string, number][];
  /** 第九批（UI-CONTRACT I2）：评价的当前读数 [key, 值]（名字查 StaticView.captain.ratings）；旧后端没有 */
  ratings?: [string, number][];
  /** 主角本人会的奇才之法（开局自选与学会的） */
  methods: string[];
  /** 立档的日期 */
  created: number;
}

export interface CargoLine {
  good: number;
  qty: number;
  avg_cost: Money;
}

/** 第九批（C11）：有名有姓的传说之船（安在某一艘船上）：key 与船名（当前语言）。 */
export interface LegendShipIdentityView {
  key: string;
  name: string;
}

export interface ShipView {
  /** 第九批（C11）：这艘船是传说之船时的身份；普通的船没有。卖船、改装照旧按船在舰队里的下标 */
  legend?: LegendShipIdentityView;
  kind: number;
  /** 船名（有名字的船）与英文正名（EXPANSION.md §12.3）；普通的船没有，按船型名显示 */
  name?: string | null;
  name_en?: string | null;
  durability: number;
  max_durability: number;
  capacity: number;
  guns: number;
  refits: number[];
  resale: Money;
  /** R10-FIX8：每一种改装此刻能不能做（id 是改装的下标）与做不了的原因（出好的字）；判断与真改装同一处。旧后端没有 */
  refit_options?: RefitOptionView[];
}

/** R10-FIX8：一种改装在这艘船上能不能做。 */
export interface RefitOptionView {
  id: number;
  enabled: boolean;
  reason: string | null;
}

export interface FleetView {
  id: number;
  /** 舰队名与英文正名（EXPANSION.md §12.3）；没有名字的舰队按编号显示（“舰队 #3”），旧后端没有 */
  name?: string | null;
  name_en?: string | null;
  docked: number | null;
  dest: number | null;
  x: number;
  y: number;
  path: [number, number][];
  days_at_sea: number;
  ships: ShipView[];
  crew: number;
  crew_min: number;
  crew_max: number;
  /** 此刻最多还能招募的船员（不算现金；船员上限、当地人手、自己殖民地的殖民者）；在海上为 0，旧后端没有 */
  hire_max?: number;
  morale: number;
  food: number;
  water: number;
  /** 每天粮、水各自的消耗（整份的上界；V01 的累计规则下多数船每天吃不满一份，看 daily_need_milli） */
  daily_need: number;
  /** V01：平均每天粮、水各自的消耗，千分之一份；旧后端没有 */
  daily_need_milli?: number;
  /** V01：现有粮水能完整撑几天（按较少的那项）；没有船员时为 null；旧后端没有 */
  supplies_days?: number | null;
  /** V01：从现在起够 10 / 30 天，粮、水各应持有多少份（库存目标，不是还要买的数）；旧后端没有 */
  supplies_for_10_days?: number;
  supplies_for_30_days?: number;
  capacity: number;
  used: number;
  cargo: CargoLine[];
  repair_cost: Money;
}

export interface CaravanView {
  id: number;
  animal: number;
  count: number;
  guards: number;
  at: number | null;
  leg: [number, number, number] | null;
  dest: number | null;
  capacity: number;
  cargo: CargoLine[];
  daily_cost: Money;
}

export interface MarkerView {
  owner: string;
  /** 商会名的英文写法（玩家为 "player"）；旧后端没有 */
  owner_en?: string;
  x: number;
  y: number;
}

export interface WindView {
  region: number;
  x: number;
  y: number;
  dir: number;
  strength: number;
}

/** 当天的天况（内核 `Sky` 的小写名，见 EXPANSION.md §9.1）。 */
export type SkyKind = "clear" | "cloudy" | "rain" | "fog" | "storm" | "snow";

/** 某海区当天的天气。 */
export interface RegionWeatherView {
  region: number;
  sky: SkyKind;
  /** 风的去向 0–7（0 = 北，顺时针） */
  wind_dir: number;
  /** 风力 0–10 */
  wind_strength: number;
}

/** 某一天的天气（预报）。 */
export interface DayWeatherView {
  day: number;
  sky: SkyKind;
  wind_dir: number;
  wind_strength: number;
}

/** 主角旗舰队所在处（没有舰队时为首都港口）的天气与未来两天预报。 */
export interface LocalWeatherView {
  region: number;
  region_name: string;
  /** 海区的英文正名（EXPANSION.md §12.3）；旧后端没有 */
  region_name_en?: string | null;
  sky: SkyKind;
  wind_dir: number;
  wind_strength: number;
  /** 未来两天（day + 1、day + 2） */
  forecast: DayWeatherView[];
}

/** 后端时钟推送（`clock` 事件，实时每 ≥100 ms 一次）。 */
export interface ClockView {
  day: number;
  /** 当天时刻，分钟 0–1439；每日结算发生在 360（6:00） */
  minute: number;
  /** H10b：现在一天的实时毫秒数（0 = 暂停；旧后端缺省） */
  day_ms?: number;
  /** H10b：是不是海上口径（四档） */
  sea_clock?: boolean;
}

export interface NoticeView {
  kind: string;
  args: [string, string][];
}

export interface BudgetStatus {
  month: number;
  calls_used: number;
  calls_limit: number;
  tokens_used: number;
  tokens_limit: number;
}

export interface PendingView {
  id: number;
  fleet: number;
  pirate_ships: number;
  pirate_guns: number;
  pirate_crew: number;
}

export interface GoalView {
  kind: "net_worth" | "ally_ports" | "colonies" | "story";
  current: number;
  target: number;
  /** colonies：每个殖民地至少需要的人口；其他目标没有这个字段 */
  population?: number;
  /** 限期（绝对天数，从 0 起算）；不限期为 null */
  deadline: number | null;
}

export interface OutcomeView {
  kind: "Won" | "Lost";
  reason: "GoalReached" | "Deadline" | "Reorganizations";
  day: number;
}

/** 主角：姓名与外貌编号（纯展示，不参与模拟）。 */
export interface Captain {
  name: string;
  /** 外貌编号：普通外貌 0–11 与 13–24（见 art/portraits.ts 的 CAPTAIN_LOOK_IDS） */
  portrait: number;
}

/** 殖民地摘要（概览用）。 */
export interface ColonySummaryView {
  id: number;
  name: string;
  /** 英文名（EXPANSION.md §12.3）：玩家起的殖民地名没有英文，后端通常不给；旧后端没有 */
  name_en?: string | null;
  loc: number;
  population: number;
  morale: number;
  /** 连续断粮天数（0 表示有粮） */
  starving_days: number;
  /** 现有粮食可支撑的天数（不计产出） */
  food_days: number;
  /** 进行中的工程：（建筑 id, 完工后等级, 完工日） */
  construction: [number, number, number] | null;
}

/** 殖民点的归属（地图上的占领旗与殖民地标记）。 */
/** 港口市况（ECONOMY.md 6.4）：由满足度、繁荣度与库存派生、带滞回的离散状态。 */
export type PortCondition =
  "stable" | "boom" | "depression" | "famine" | "glut";

/** 到过的港口或城市的市况（只列出不是“平稳”的；海图的市况标记）。 */
export interface PortConditionView {
  loc: number;
  condition: Exclude<PortCondition, "stable">;
  /** 进入这个市况的日期 */
  since: number;
}

export interface SiteClaimView {
  loc: number;
  /** 被某势力占领（势力 id） */
  faction: number | null;
  /** 已建成的殖民地 id */
  colony: number | null;
  /** 殖民地是否属于玩家 */
  mine: boolean;
}

export interface Overview {
  day: number;
  /** 年序（从 1 开始）；显示年份用 calendar_year */
  year: number;
  /** 纪年年份 = world.start_year + year − 1 */
  calendar_year: number;
  month: number;
  date: number;
  season: number;
  scenario: string;
  cash: Money;
  deposit: Money;
  loans: Money;
  net_worth: Money;
  total_assets: Money;
  speed: number;
  /** H10b：现在一天的实时毫秒数（0 = 暂停；旧后端缺省） */
  day_ms?: number;
  /** H10b：是不是海上口径（速度为海上四档：慢 / 普通 / 快 / 极快） */
  sea_clock?: boolean;
  ai_mode: string;
  budget: BudgetStatus | null;
  fleets: FleetView[];
  caravans: CaravanView[];
  others: MarkerView[];
  winds: WindView[];
  notices: NoticeView[];
  reorganizations: number;
  pending_battles: PendingView[];
  tactical_battles: number[];
  pirates: [number, number][];
  fog_version: number;
  goal: GoalView | null;
  outcome: OutcomeView | null;
  /** 主角；旧存档或尚未设置时为空 */
  captain?: Captain | null;
  /** 按主角开局时主角当前年龄的头像素材；有它时名牌用它，不用外貌编号（旧后端没有） */
  captain_asset?: string;
  /** 名声 */
  fame: number;
  /** 玩家殖民地摘要 */
  colonies: ColonySummaryView[];
  /** 已发现、尚未报告的发现物数 */
  discoveries_unreported: number;
  /** 已发现的发现物总数（含已报告；只增不减，变化时界面重新获取发现物列表）；旧后端没有这个字段 */
  discovered_count?: number;
  /** 已有归属的殖民点 */
  site_claims: SiteClaimView[];
  /** 到过的港口与城市里市况不是“平稳”的（ECONOMY.md 6.4）；旧后端没有 */
  port_conditions?: PortConditionView[];
  /** 当天时刻（分钟 0–1439，每日结算在 6:00）；旧后端没有 */
  minute?: number;
  /**
   * 概览的编号（旧后端没有）：epoch 是生成它的后端状态（服务端重启、玩家重新驻留时换一个），rev 在同一个 epoch 里每生成一次加一。
   * 界面丢掉同一个 epoch 里 rev 不比手上新的概览：迟到的推送、晚到的请求结果不会把界面拨回旧状态。
   */
  epoch?: number;
  rev?: number;
  /** 各海区当天的天气；旧后端没有 */
  weather?: RegionWeatherView[];
  /** 主角所在处的天气与预报；旧后端没有 */
  local_weather?: LocalWeatherView | null;
  /** H08：到港的航程总结（distance 为格数；record_* 是 H07 的航线纪录，没有时为 null / false） */
  trip_summary?: {
    id: string;
    fleet: number;
    fleet_name: string;
    from: string | null;
    to: string;
    days: number;
    distance: number;
    hull_lost: number;
    crew_change: number;
    cash_change: number;
    cargo_change: number;
    sightings: number;
    hails: number;
    storms: number;
    shook_off: number;
    record_days: number | null;
    record_broken: boolean;
    /** H07：这一程立下了这对港口的首航纪录 */
    record_first?: boolean;
    /** T03：这一程期间代办替你成交了几笔（没有代办的世界不给） */
    agency_fills?: number;
  } | null;
  /** H03：世界海图上画的天气团（离旗舰队 chart_range 格以内、海图已有或已探明处；没有时不给） */
  weather_cells?: { id: string; kind: "storm" | "squall" | "fog"; x: number; y: number; r: number }[];
  /** 主角档案（身世与属性）；旧存档或尚未立下时为空，旧后端没有 */
  profile?: CaptainProfileView | null;
  /** 剧情事件：推荐角色的故事线与奇遇；没有故事线、也什么都没发生过时为空 */
  story?: StoryView | null;
  /** 行情情报（ECONOMY.md 第 7 节）；旧后端没有（按实时） */
  info_mode?: InfoMode;
  /** 第九批：对局所在的世界与地图（旧后端没有，按经典世界） */
  world_key?: string;
  map_key?: string;
  /** 世界日历的当天 [年, 月, 日]（旧后端没有，按 12 × 30 换算；year/month/date 照旧给出） */
  world_date?: WorldDate;
  /** 养成中还是已经出海（旧后端没有，按出海） */
  mode?: "upbringing" | "voyage";
}

/** 行情情报：live（实时，经典）/ carried（随船传递）。 */
export type InfoMode = "live" | "carried";

/** 远方行情的时效与来源（随船传递时）。 */
export interface SeenView {
  /** 快照日：包含这一天之前的收盘 */
  day: number;
  /** 过时的天数（今天 − 快照日） */
  age: number;
  /** visit（自己到过）/ ship（随船消息）/ report（行情通报） */
  source: "visit" | "ship" | "report";
}

/** 行情通报：告示板上比手上新的港口与价格（没有时为空列表、价格 0）。 */
export interface ReportOfferView {
  locs: number[];
  price: Money;
}

export interface MarketRow {
  good: number;
  price: Money;
  base_price: Money;
  stock: number;
  target: number;
  specialty: boolean;
  popular: boolean;
  history: Money[];
  held: number;
  avg_cost: Money;
  /** 势力的经济政策（ECONOMY.md 8.4）：这里禁止运出；出口税与进口关税的系数（万分之一；1 倍或旧后端时缺省） */
  banned?: boolean;
  export_tax_bp?: number | null;
  import_tax_bp?: number | null;
  /**
   * 开放市场（DECISIONS“开放市场”）：这里出售这种货（买入页只列出售的，以本地特产为主）；false 表示只收不卖。
   * 旧后端没有这一项：那时市场里列出的货都能买（缺省当作出售）。
   */
  sold?: boolean;
  /** 开放市场补上的条目：这种货不在当地的市场清单里（只收不卖，价格随离产地的远近而定）；旧后端缺省 */
  extra?: boolean;
  /** 开放市场：离这里最近的产地（特产地）与贸易距离（格）；这里就是产地、到不了产地或旧后端时缺省 */
  nearest?: [number, number] | null;
  /** 货档（T01）：在这里买入这种货要的商誉；0 档、这座港口保底放开的、没有货档的世界与旧后端缺省 */
  rank_need?: number;
  /** 货档把它锁住了：还差多少商誉（买得了时缺省） */
  rank_short?: number | null;
  /** 商誉不够却买得了的缘由："errand" = 手上的请托、委托要这种货；"patron" = 替这个势力办完委托 90 天内的熟客（T04） */
  rank_pass?: "errand" | "patron" | string | null;
  /** T04：常价（这座港口供需平衡时的价钱）；现价对常价、对基准价的比例（万分之一，10000 = 一样）。旧后端没有 */
  normal?: Money;
  vs_normal_bp?: number;
  vs_base_bp?: number;
  /** T04b：本港有未结的委托要这种货（托运中），谁都买不到，买入被拒 market.reserved；卖出与交货不受限。为假时后端不发 */
  reserved?: boolean;
}

export interface WarehouseView {
  rented: number;
  owned: number;
  capacity: number;
  used: number;
  stock: CargoLine[];
  /** 商馆代办（T03；规则关闭的世界与旧后端不给） */
  agency?: AgencyView;
}

/** 仓库页的“代办”一栏（T03）。 */
export interface AgencyView {
  /** 这里能挂几张、已挂几张；代办费（百分比）；每级商馆给几张 */
  slots: number;
  used: number;
  fee_pct: number;
  per_level: number;
  orders: AgencyOrderView[];
  /** 这里最近的代办成交（新的在前） */
  fills: AgencyFillView[];
  /** 这里市场上的货：现价、买入税率（万分之一）、仓库里有几件 */
  goods: { good: number; price: Money; tax_bp: number; stock: number }[];
  /** T04：本港的代办小账（永久累计；只记录、不参与结算；T04 以前的成交没有回填）。旧后端没有 */
  ledger?: AgencyLedgerView;
}

/** T04：每港永久代办小账；买入含税、卖出扣税；profit = 卖出所得 − 卖出货的成本 − 代办费（估算）。 */
export interface AgencyLedgerView {
  loc: number;
  buy_qty: number;
  buy_total: Money;
  sell_qty: number;
  sell_total: Money;
  sell_cost: Money;
  fees: Money;
  profit: Money;
}

export interface AgencyOrderView {
  id: number;
  good: number;
  side: "buy" | "sell";
  limit: Money;
  qty: number;
  filled: number;
  reserved: Money;
  placed: number;
  /** 最近一次没能成交的原因代码（价格没到为 agency.price） */
  waiting?: string;
  /** T04：这张单累计成交的金额、代办费、（卖单）卖出货的成本；卖单另给盈亏（账目规则关着时没有）。旧后端没有 */
  done_total?: Money;
  done_fee?: Money;
  done_cost?: Money;
  profit?: Money | null;
}

export interface AgencyFillView {
  day: number;
  good: number;
  side: "buy" | "sell";
  qty: number;
  total: Money;
  fee: Money;
  /** T04：成交成本（卖出时是这批货的买入成本）；卖出另给盈亏。旧后端没有 */
  cost?: Money;
  profit?: Money | null;
}

export interface InvestView {
  development: number;
  mine: Money;
  share_bp: number;
  ally: string | null;
  ally_is_me: boolean;
  /** 商馆、货档与商誉（T01）；没有这条规则的世界与旧后端缺省。内陆城市设不了商馆：max_level 为 0，只有声望 */
  house?: HouseView | null;
  /** E02 港口发展度（1–9999、阶段、自然增长）；规则关着的世界与旧后端缺省——那时 development 仍是 1–100 的旧尺度 */
  growth?: DevGrowthView | null;
}

/** E02 投资页的发展度（`views.rs` `DevGrowthView`）：只给数值与阶段序号，阶段名由界面出字。 */
export interface DevGrowthView {
  /** 现值 */
  value: number;
  /** 开局值（回落的底线） */
  base: number;
  /** 上限（寰宇 9999） */
  max: number;
  /** 阶段序号 0–6：寒村、小港、港镇、商埠、大埠、都会、理想之城 */
  stage: number;
  /** 本阶段的下界（阶段 0 为 1）与下一阶段的门槛（最高阶段为空） */
  stage_from: number;
  stage_to?: number | null;
  /** 攒着的不到一点（万分之一点） */
  frac_bp: number;
  /** 本港基础速度：繁忙度与世界平均相当时每月涨几点（万分之一点） */
  speed_bp: number;
  /** 高出开局值的部分每月回落的比例（万分之一） */
  decay_bp: number;
  /** 现在买一点的价钱 */
  point_cost: Money;
  /** 现在的市场深度系数（万分之一） */
  depth_bp: number;
  /** 上个月的增长构成；第一个结算日之前为空 */
  last?: DevMonthView | null;
}

/** 上个月的发展度增长构成（单位：万分之一点；decay ≥ 0 表示回落了多少，net = 其余之和 − decay）。 */
export interface DevMonthView {
  /** 结算日 */
  day: number;
  /** 本港繁忙度 ÷ 世界平均（万分之一） */
  rel_bp: number;
  busy: number;
  specialty: number;
  invest: number;
  works: number;
  events: number;
  decay: number;
  net: number;
}

/** 商馆的一级：到这一级要的累计投资与它给的好处。 */
export interface HouseLevelView {
  level: number;
  cost: Money;
  /** 商誉加成 */
  goodwill: number;
  /** 交易税乘数（万分之一） */
  tax_bp: number;
  /** 免费仓位 */
  storage: number;
  /** 照现在的声望，到这一级后在这里买得到第几档（0–3） */
  top_rank: number;
}

/** 商馆（T01）：等级阶梯、现在的商誉、同盟港的条件与市场深度。 */
export interface HouseView {
  level: number;
  max_level: number;
  /** 在当地势力的声望，与这里的商誉（声望 + 商馆加成） */
  reputation: number;
  goodwill: number;
  /** 买入 0 档、1 档……的货要的商誉 */
  rank_goodwill: number[];
  /** 现在在这里买得到第几档 */
  top_rank: number;
  levels: HouseLevelView[];
  /** 升到下一级还差多少（已经是最高级时缺省） */
  next_cost?: Money | null;
  /** 同盟港的条件：占有率门槛（万分之一）与要的商馆等级 */
  ally_share_bp: number;
  ally_house: number;
  /** 旧存档的宽限期还剩几天（全档可买） */
  grace_left?: number | null;
  /** 市场深度系数（万分之一）：现在的，与把“到下一级还差的钱”投下去之后的 */
  depth_bp: number;
  depth_next_bp?: number | null;
  /** 超出初值的发展度每隔几个月掉 1 点（旧规则）；E02 规则打开时为 0，回落改看 InvestView.growth.decay_bp */
  decay_months: number;
  /** 分红（T02）；规则关闭、没有货币流通的世界与旧后端缺省 */
  dividend?: DividendView | null;
  /** 遭劫的风险与上次遭劫（T02）；规则关闭与旧后端缺省 */
  risk?: SackRiskView | null;
  /** 这座港口船厂的发展度台阶（T02）；规则关闭、没有船厂与旧后端缺省 */
  yard_steps?: YardStepView[];
  /** 本港投资者的前五名（T02）；没有人投过与旧后端缺省 */
  investors?: InvestorView[];
  /** T03：这里的挂单位与产业位，现在与下一级（规则关闭时不给） */
  agency?: { orders: number; orders_next?: number; industry?: number; industry_next?: number; industries: number; stage_bonus?: number };
}

/** 商馆分红（T02）：上个月分到的、照规则的年收益率、本港可分的总额有没有被上限压住。 */
export interface DividendView {
  /** 照规则的年收益率（万分之一）：年利率 × 现在的市场深度系数 */
  yield_bp: number;
  /** 照现在的累计投资，下个月应得 */
  next_due: Money;
  /** 上个月分到的（没分到为 0）与那一天 */
  last: Money;
  last_day?: number | null;
  /** 上个月实得折成的年收益率（万分之一） */
  last_yield_bp?: number | null;
  /** 上个月本港的应得合计、实分合计，与压住它的上限 */
  pool_due: Money;
  pool_paid: Money;
  cap: "none" | "hinterland" | "purse";
  annual_pct: number;
  hinterland_pct: number;
}

/** 遭劫的风险（T02）：规则写的折损比例与上次遭劫。 */
export interface SackRiskView {
  loss_pct: number;
  house_pct: number;
  house_level: number;
  /** 照你现在的商馆等级，遭劫时会折损多少 */
  exposure: Money;
  last_day?: number | null;
  last_loss: Money;
  last_total: Money;
}

/** 船厂的一个发展度台阶（T02）。 */
export interface YardStepView {
  development: number;
  ships: number[];
  reached: boolean;
}

/** 船厂还没开造的一种船（T02）。 */
export interface ShipUpcomingView {
  ship: number;
  development: number;
}

/** 本港的一位投资者（T02）。 */
export interface InvestorView {
  name: string;
  me: boolean;
  amount: Money;
  level: number;
}

export interface RelationView {
  other: number;
  status: string;
  value: number;
}

export interface OfficeView {
  faction: number;
  reputation: number;
  license: boolean;
  marque: boolean;
  at_war: boolean;
  relations: RelationView[];
}

export interface LoanView {
  id: number;
  principal: Money;
  rate_bp: number;
  start_day: number;
  due_day: number;
  overdue: boolean;
}

export interface BankView {
  deposit: Money;
  loans: LoanView[];
  credit_score: number;
  grade: string;
  defaults: number;
  limit: Money;
  rate_bp: number;
  deposit_rate_bp: number;
  /**
   * R10-FE4 / U06B3：行动制结业落在丁、丙两档时家里在本据港的钱庄作的保（头一笔 amount 文以内、利息 rate_pct%，只一回、只在本据港）。
   * 没作过保时后端不给；reason：precondition（用过了）/ wrong_location（不在本据港）/ not_owner
   */
  guarantee?: { available: boolean; amount: number; rate_pct: number; reason?: string };
}

export interface ContractView {
  id: number;
  issuer: number;
  good: number;
  qty: number;
  /** 交货港；hide_unknown_ports 的世界里没看见过的港口为 null，这时给出 direction */
  to: number | null;
  /** 没看见过的交货港在哪个方向（“东北方”，按当前语言；从旗舰队算起）；看得见时没有这个字段 */
  direction?: string;
  deadline: number;
  reward: Money;
  penalty: Money;
  status: string;
  ai: boolean;
  /**
   * T04 委托 v2（寰宇 [contracts.v2]；规则关着时后端给 regular 与 0）：小单 / 大单；起运地（离交货港最近的出售地，
   * 玩家还看不见那座港时为空）；起运地到交货港的贸易距离（格）；从交货港去起运地买货再回来的参考天数；
   * 加急系数（万分之一，10000–15000，期限越紧越高）；办完给发布方势力的声望；办完后在这个势力的港口熟客放行几天。旧后端没有
   */
  size?: "small" | "regular";
  source?: number | null;
  cells?: number;
  need_days?: number;
  urgency_bp?: number;
  rep?: number;
  pass_days?: number;
}

export interface DialogView {
  day: number;
  intent: string;
  player_text: string;
  reply: string;
  discount_bp: number;
}

export interface ChartOffer {
  region: number;
  price: Money;
  owned: boolean;
}

export interface RoleView {
  /** 经典的五种任职与“待命”；第九批的世界定义的岗位为 assigned */
  kind:
    | "none"
    | "captain"
    | "accountant"
    | "trader"
    | "caravan"
    | "industry"
    | "assigned";
  target: number | null;
  /** assigned：岗位在 StaticView.captain.roles 里的下标与作用对象（经典任职没有这两个字段） */
  role?: number;
  scope?: RoleScope;
}

export interface MateView {
  id: number;
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  bio: string;
  level: number;
  xp: number;
  navigation: number;
  trade: number;
  combat: number;
  management: number;
  salary: Money;
  hire_cost: Money;
  loyalty: number;
  at: number;
  hired: boolean;
  role: RoleView;
  /** 第九批（UI-CONTRACT I2）：各项能力 [key, 0–100]（经典四项在前，世界追加的在后）；旧后端没有 */
  abilities?: [string, number][];
  /** 航海士数据的 key（data/mates.toml）；旧后端没有这个字段 */
  key?: string;
  /** 算学奇才掌握的行情预测方法（普通航海士为空；旧后端没有） */
  methods?: string[];
  /** 第九批：航海士也是人物（寰宇）时，人物当前年龄的头像素材 id；经典为 null，旧后端没有 */
  portrait?: string | null;
}

export interface MatesView {
  hired: MateView[];
  available: MateView[];
}

export interface PortView {
  loc: number;
  known: boolean;
  /** 第九批（UI-CONTRACT I4、I9）：有没有道具店；最近的拍卖会（在这个港口、预告或预展或开拍中）的 key。旧后端没有 */
  shop?: boolean;
  auction?: string | null;
  mates_here: MateView[];
  /** 酒馆传闻：某位算学奇才这一季在哪处港口的酒馆（ECONOMY.md 4.3.1）；没有传闻或旧后端时缺省 */
  genius_rumor?: GeniusRumorView | null;
  charts: ChartOffer[];
  tax_bp: number;
  market: MarketRow[];
  shipyard: number[];
  /** 船厂还没开造、发展度到了才开造的船型（T02）；规则关闭、没有船厂与旧后端缺省 */
  shipyard_upcoming?: ShipUpcomingView[];
  fleets_here: number[];
  caravans_here: number[];
  warehouse: WarehouseView;
  invest: InvestView;
  office: OfficeView;
  bank: BankView;
  contracts: ContractView[];
  bargain: [number, number] | null;
  dialogs: DialogView[];
  exchange: number | null;
  industries_here: number[];
  /** 人口、繁荣度与市况（ECONOMY.md 6.4）；人口规则关闭、还没到过或旧后端时为空 */
  people?: PeopleView | null;
  /** 城镇工坊（ECONOMY.md 6.5）；还没到过或旧后端时为空 */
  workshops?: WorkshopView[];
  /** 行情的时效与来源（随船传递、远方港口）；看得到实时行情或旧后端时为空 */
  seen?: SeenView | null;
  /** 行情通报（随船传递、玩家在这个港口时）；其他时候为空 */
  report?: ReportOfferView | null;
  /** 酒馆里的商会传闻：本据港在这里或有船队停在这里的商会近 30 天的展望（ECONOMY.md 8.2）；旧后端没有 */
  outlooks?: OutlookRumorView[];
  /** 城镇钱袋与所属势力的国库（货币流通，ECONOMY.md 6.9）；规则关闭、还没到过、只知道旧消息或旧后端时为空 */
  purse?: PurseView | null;
}

/** 城镇钱袋：当地的报价乘流动性系数（钱袋相对往常的多少）。 */
export interface PurseView {
  money: number;
  /** 参照钱袋（往常的水平） */
  reference: number;
  /** 流动性系数（万分之一） */
  liquidity_bp: number;
  /** 累计由腹地替它付出的缺口 */
  gaps: number;
  treasury: TreasuryView | null;
}

/** 势力国库。 */
export interface TreasuryView {
  faction: string;
  money: number;
  /** 财政的税率系数（万分之一） */
  tax_mult_bp: number;
  /** 海军巡逻度（万分之一） */
  patrol_bp: number;
}

/** 酒馆里的一条商会传闻。 */
export interface OutlookRumorView {
  company: string;
  day: number;
  memo: string;
}

/** 港口的人口、繁荣度与市况。 */
export interface PeopleView {
  pop: number;
  pop0: number;
  /** 繁荣度（0–100，万分之一精度：500000 为 50）与它正在靠近的目标 */
  prosperity_bp: number;
  goal_bp: number;
  condition: PortCondition;
  /** 进入当前市况的日期 */
  since: number;
  /** 上个月必需、舒适、奢侈三层的满足度（万分之一） */
  sat_bp: [number, number, number];
  /** 按当前繁荣度，人口每月的增减幅（万分之一） */
  growth_bp: number;
  /** 头一年还在记参照（繁荣度与人口不动） */
  learning: boolean;
}

/** 一座城镇工坊：按配方从本地市场取原料、把产出放回。 */
export interface WorkshopView {
  recipe: number;
  output: number;
  out_qty: number;
  /** [商品 id, 每轮用量] */
  inputs: [number, number][];
  /** 接手当地这种商品均衡产量的份额（万分之一） */
  share_bp: number;
  /** 当前产能（万分之一件产出 / 天）与相对开局的比例（万分之一） */
  daily_bp: number;
  capacity_bp: number;
  /** 今天做了几件；是否缺料少做、是否亏本停工 */
  made: number;
  short: boolean;
  stopped: boolean;
  /** 上个月的产出价值 / 原料价值（万分之一；0 表示还没有满一个月） */
  value_bp: number;
  /** 头一年还在记参照（产能不动） */
  learning: boolean;
}

export interface TradeQuote {
  loc: number;
  good: number;
  side: "Buy" | "Sell";
  qty: number;
  gross: Money;
  tax: Money;
  tax_rate: number;
  total: Money;
  avg_price: Money;
  price_before: Money;
  price_after: Money;
  stock_after: number;
}

export interface PositionView {
  lots: number;
  avg_price: Money;
  physical: boolean;
  pnl: Money;
}

export interface FuturesRow {
  id: number;
  exchange: number;
  good: number;
  lot: number;
  delivery: number;
  expiry_day: number;
  days_left: number;
  bid: Money;
  ask: Money;
  fair: Money;
  mark: Money;
  spot: Money;
  position: PositionView | null;
}

export interface ExchangeAccount {
  exchange: number;
  balance: Money;
  initial_requirement: Money;
  maintenance_requirement: Money;
  call_since: number | null;
}

export interface FuturesView {
  accounts: ExchangeAccount[];
  contracts: FuturesRow[];
}

export interface RouteLeg {
  road: number;
  from: number;
  to: number;
  length: number;
  toll_bp: number;
  robbery_bp: number;
}

export interface CaravanPlanView {
  stops: number[];
  legs: RouteLeg[];
  days: number;
  distance: number;
  tolls: Money;
  risk_bp: number;
  upkeep: Money;
}

export interface IndustryView {
  id: number;
  loc: number;
  kind: number;
  recipe: number;
  level: number;
  manager: boolean;
  stalled: boolean;
  book_value: Money;
  input_stock: [number, number][];
  daily_revenue: Money;
  daily_inputs: Money;
  daily_costs: Money;
  daily_profit: Money;
}

export interface IndustriesView {
  industries: IndustryView[];
  sites: number[];
}

export type AccountLine = [string, Money];

export interface BalanceSheet {
  assets: AccountLine[];
  liabilities: AccountLine[];
  equity: AccountLine[];
  current_earnings: Money;
  total_assets: Money;
  total_liabilities: Money;
  total_equity: Money;
}

export interface IncomeStatement {
  revenues: AccountLine[];
  expenses: AccountLine[];
  total_revenue: Money;
  total_expense: Money;
  net_income: Money;
}

export interface CashFlowStatement {
  operating: Money;
  investing: Money;
  financing: Money;
  net_change: Money;
  opening_cash: Money;
  closing_cash: Money;
}

export interface FinancialReport {
  kind: "Month" | "Year";
  index: number;
  start_day: number;
  end_day: number;
  balance_sheet: BalanceSheet;
  income: IncomeStatement;
  cash_flow: CashFlowStatement;
}

export interface TrendPoint {
  day: number;
  total_assets: Money;
  equity: Money;
}

export interface ReportsView {
  monthly: FinancialReport[];
  yearly: FinancialReport[];
  current: BalanceSheet;
  trend: TrendPoint[];
  /** 经济月报（货币流通，ECONOMY.md 6.9；旧的在前）；规则关闭或旧后端时没有 */
  economy?: EconomyReportView[];
  /** T04：按有向港口对归集的航线账（估算；最近跑过的在前，最多 60 条）；没有时后端不发 */
  routes?: RouteLineView[];
  /** T04：各港的代办小账；没有时后端不发 */
  agency_books?: AgencyLedgerView[];
}

/**
 * T04：一条有向航线（from → to）的估算账：跑了几趟、海上几天、在 to 卖出所得与那批货的成本、海上开销（工资粮水折算）、
 * 在 from 装货花的钱；profit = 卖出所得 − 货的成本 − 海上开销，per_day = profit ÷ 海上天数。只记录，不参与结算。
 */
export interface RouteLineView {
  from: number;
  to: number;
  trips: number;
  days: number;
  sold_total: Money;
  sold_cost: Money;
  sea_cost: Money;
  bought_total: Money;
  profit: Money;
  per_day: Money;
  last_day: number;
}

export type SectorKind =
  "traders" | "towns" | "treasuries" | "bank" | "hinterland";

/** 经济月报里一类部门：月初 + 流入 − 流出 = 月末。 */
export interface SectorLineView {
  kind: SectorKind;
  opening: number;
  inflow: number;
  outflow: number;
  closing: number;
}

/** 经济月报里一类资金流（名目按 `econ.flow.<名目>` 显示）。 */
export interface FlowLineView {
  flow: string;
  from: SectorKind;
  to: SectorKind;
  amount: number;
}

export interface TreasuryLineView {
  faction: string;
  money: number;
  tax_mult_bp: number;
  patrol_bp: number;
  income: number;
  spent: number;
}

/** 经济月报：各部门的余额与流入流出、货币总量、物价指数、产量与人口。 */
export interface EconomyReportView {
  month: number;
  day: number;
  sectors: SectorLineView[];
  flows: FlowLineView[];
  money_supply: number;
  player: number;
  companies: number;
  exchange: number;
  price_index_bp: number;
  production: number;
  population: number;
  shortfall: number;
  /** 流动性系数最低与最高的城镇（名称, 万分之一） */
  tightest: [string, number] | null;
  flush: [string, number] | null;
  treasuries: TreasuryLineView[];
}

export interface NewsView {
  id: number;
  day: number;
  source: "tavern" | "merchant" | "official";
  credibility: number;
  text: string;
}

/** 事件的一条效果（结构化字段，由界面格式化为“地点 · 商品 · 幅度 · 持续”）。 */
export interface EffectView {
  /** 效果 key：good_supply / demand_shift / region_storm … */
  effect: string;
  /** 效果词表中的显示名 */
  label: string;
  /** 方向提示：产量上升、海盗猖獗…… */
  hint: string;
  loc: string | null;
  good: string | null;
  region: string | null;
  faction_a: string | null;
  faction_b: string | null;
  /** 殖民地产量效果的建筑名（作用于全部建筑时为 null，见 all_buildings）；旧后端没有这个字段 */
  building?: string | null;
  /** 殖民地产量效果作用于全部建筑 */
  all_buildings?: boolean;
  /** 殖民地效果所在殖民地的名称（殖民地已不存在时为 null；loc 为它所在的殖民点） */
  colony?: string | null;
  /** 发现物传闻所指的发现物名（传闻所指的大致海区在 region） */
  discovery?: string | null;
  /** 系数（万分之一，10000 表示不变） */
  mult_bp: number | null;
  days: number | null;
  /** 变化量（关系值 / 发展度） */
  delta: number | null;
  /** 持续效果的结束日（不含）；一次性效果为 null */
  end: number | null;
}

export interface EventView {
  /** 目录事件为类型名，组合事件为标题 */
  name: string;
  /** 英文正名（EXPANSION.md §12.3，任何语言下都给出；name 为当前语言）；旧后端没有 */
  name_en?: string | null;
  /** 目录事件为类型说明，组合事件为叙事 */
  description: string;
  start: number;
  end: number;
  place: string[];
  /** catalog（目录事件）/ composed（组合事件） */
  origin?: "catalog" | "composed";
  /** 组合事件的编号 */
  id?: number | null;
  /** 组合事件的来源：ai（模型）/ template（离线模板）/ rule（内核规则触发的势力政策） */
  source?: "ai" | "template" | "rule" | null;
  title?: string | null;
  narrative?: string | null;
  effects?: EffectView[];
  active?: boolean;
}

export interface LogView {
  day: number;
  kind: string;
  args: [string, string][];
  /** S02nZ2：后端已按语言出好、填好参数的句子（有就直接显示，不再查 log.<种类>） */
  text?: string;
  mine: boolean;
}

export interface ChronicleView {
  year: number;
  text: string;
}

export interface IntelView {
  news: NewsView[];
  /** 进行中的事件：目录事件逐条，组合事件每个一张卡片 */
  events: EventView[];
  log: LogView[];
  chronicles: ChronicleView[];
  /** 最近的组合事件（新的在前，含已结束的） */
  composed?: EventView[];
  /** 市场月报（ECONOMY.md 8.5；新的在前）；旧后端没有 */
  reports?: ReportView[];
}

/** 一篇市场月报。 */
export interface ReportView {
  day: number;
  region: number;
  /** 所写的月份（月序，从 0 开始） */
  month: number;
  text: string;
}

// ── 殖民地、殖民点与发现（api.colonies() / api.site(loc) / api.discoveries()） ──

/** 进行中的工程。 */
export interface ConstructionView {
  building: number;
  /** 完工后的等级 */
  level: number;
  start_day: number;
  done_day: number;
}

/** 一座建筑每天的预计产出。 */
export interface EstimateView {
  building: number;
  /** 投入（商品 id, 每天件数） */
  inputs: [number, number][];
  /** 产出（商品 id, 每天件数 × 10000） */
  outputs: [number, number][];
}

/** 可建设（开工或升级）的建筑。 */
export interface BuildOptionView {
  building: number;
  /** 当前等级（0 表示尚未建造） */
  level: number;
  cost: Money;
  /** 每级建材（商品 id, 数量） */
  materials: [number, number][];
  /** 仓库中尚缺的建材（商品 id, 数量） */
  missing: [number, number][];
  build_days: number;
  /** 能否立即开工；否则 reason 为内核给出的原因 */
  ok: boolean;
  reason: string | null;
  /** 粮食 / 采集类：在此地产出的商品与系数（%） */
  produces: [number, number] | null;
}

/** 殖民地上月的统计。 */
export interface ColonyStatsView {
  /** （商品 id, 件数） */
  produced: [number, number][];
  food_eaten: number;
  births: number;
  immigrants: number;
  deaths: number;
  tax: Money;
  upkeep: Money;
  /** 消费品满足度（万分之一） */
  satisfaction_bp: number;
  /** 累计遭袭次数 */
  raids: number;
}

/** 殖民地详情。 */
export interface ColonyView {
  id: number;
  name: string;
  /** 英文名（EXPANSION.md §12.3）：玩家起的殖民地名没有英文，后端通常不给；旧后端没有 */
  name_en?: string | null;
  loc: number;
  /** 建立日（绝对天数） */
  founded: number;
  population: number;
  /** 人口上限 */
  housing: number;
  morale: number;
  starving_days: number;
  /** 仓库中的粮食、每天需求与可支撑天数（不计产出） */
  food_stock: number;
  food_need: number;
  food_days: number;
  /** 殖民地仓库（即所有者在该地的仓库，Holder 为 { Warehouse: loc }） */
  stock: CargoLine[];
  capacity: number;
  used: number;
  /** （建筑 id, 等级） */
  buildings: [number, number][];
  construction: ConstructionView | null;
  workers_needed: number;
  /** 工人充足率与士气系数（万分之一） */
  staffing_bp: number;
  morale_mult_bp: number;
  estimates: EstimateView[];
  /** 税率档位（rules.colony_tax_levels 的下标） */
  tax: number;
  /** 按当前人口估算的月税收 */
  tax_estimate: Money;
  /** 每月维护费 */
  upkeep: Money;
  /** 防御值（%） */
  defense: number;
  /** 每日遭袭概率（万分之一） */
  raid_bp: number;
  last_raid: number | null;
  dock: boolean;
  book_value: Money;
  last_month: ColonyStatsView;
  build_options: BuildOptionView[];
  /** 停在此地的玩家舰队（可装卸） */
  fleets_here: number[];
  /** 正在作用于该殖民地的组合事件效果（产量、增长系数，含结束日）；预计产量已计入。旧后端没有这个字段 */
  effects?: EffectView[];
  /** 事件造成的人口增长与移民系数（万分之一，10000 表示不变）；旧后端没有这个字段 */
  growth_mult_bp?: number;
}

export interface ColoniesView {
  colonies: ColonyView[];
  /** 还能再建立几个殖民地 */
  slots_left: number;
}

/** 殖民点详情：自然条件、归属、能否建立殖民地与所需物资。 */
export interface SiteView {
  loc: number;
  info: SiteInfoView;
  lore: string;
  /** 是否到过 */
  known: boolean;
  claim: SiteClaimView | null;
  /** 不看舰队时能否建立；否则 reason 为原因 */
  can_found: boolean;
  reason: string | null;
  found_cost: Money;
  /** 须从舰队卸下的物资（商品 id, 数量） */
  found_materials: [number, number][];
  min_settlers: number;
  /** 停在此地的玩家舰队：（舰队 id, 按最少殖民者建立时的拒绝原因；null 表示可以建立） */
  fleets_here: [number, string | null][];
  /** 各粮食 / 采集类建筑在此地的产出：（建筑 id, 商品 id, 系数 %） */
  producible: [number, number, number][];
  /** 此地已有的玩家殖民地 id */
  colony: number | null;
}

/** 一件已发现的发现物。 */
export interface FoundView {
  /** 发现物 id（statics.discoveries 的下标） */
  id: number;
  /** 发现日（绝对天数） */
  day: number;
  reported: boolean;
  x: number;
  y: number;
}

/** 一条发现物传闻（组合事件“发现物传闻”）：只给出大致海区，不给位置。 */
export interface RumorView {
  /** 发现物 id（statics.discoveries 的下标） */
  id: number;
  /** 听到传闻的日期（绝对天数） */
  day: number;
  /** 传闻所指的海区编号与名称 */
  region: number;
  region_name: string;
  /** 海区的英文正名（EXPANSION.md §12.3）；旧后端没有 */
  region_name_en?: string | null;
  /** 是否已经找到（传闻已证实） */
  found: boolean;
}

/** 探险记录：已发现、已报告与名声。 */
export interface DiscoveriesView {
  fame: number;
  found: FoundView[];
  /** 听到的发现物传闻，按发现物编号排列；旧后端没有这个字段 */
  rumors?: RumorView[];
  /** 发现物总数（其余尚未发现） */
  total: number;
  /** 招募各等级航海士所需的名声：（等级, 名声），只列出需要名声的等级 */
  mate_fame: [number, number][];
  /** 停靠的港口中可以报告的地点 */
  report_at: number[];
  /** B12：玩家各舰队的潜水入口（前端按选中的舰队筛选）；省略为空 */
  dives?: DiveOptionView[];
}

/**
 * 一支舰队对一处潜水点（B12）：enabled 与 Dive 命令的校验一致；不能潜时 blocked_reason 是当前语言的一句话。
 * 隐藏未知港口的世界里没发现过的潜水点不在静态数据里（名字只能按传闻的海区称呼），清单本身不给名字与坐标。
 */
export interface DiveOptionView {
  fleet: number;
  discovery: number;
  enabled: boolean;
  blocked_reason?: string;
}

/** 粮、水各一个数。 */
export interface SupplyPair {
  food: number;
  water: number;
}

export interface SailPreview {
  /** 预计天数（手动航行的世界按当天的风流与船速估） */
  days: number;
  path: [number, number][];
  /** 建议的粮、水各自库存（含几天余量） */
  supplies: number;
  /** V01：现有粮水能完整撑几天；没有船员时为 null；旧后端没有 */
  supplies_days?: number | null;
  /** V01：这趟本身要持有的粮、水（不含余量）；旧后端没有 */
  required?: SupplyPair;
  /** V01：相对现有库存还差多少粮、水（不含余量）；旧后端没有 */
  shortfall?: SupplyPair;
}

export interface BargainReply {
  intent: string;
  reply: string;
  discount_bp: number;
  accepted: boolean;
}

export type UnitStatus = "Active" | "Sunk" | "Captured";

export interface Unit {
  id: number;
  player: boolean;
  ship: number;
  kind: number;
  q: number;
  r: number;
  facing: number;
  hp: number;
  max_hp: number;
  crew: number;
  guns: number;
  mp: number;
  mp_left: number;
  fired: boolean;
  boarded: boolean;
  status: UnitStatus;
}

export type TacticalEvent =
  | { Fire: { from: number; to: number; damage: number } }
  | { Sunk: { unit: number } }
  | { Board: { from: number; to: number; captured: boolean } }
  | "RetreatFailed"
  | "Retreated"
  | "PiratesWithdraw";

export interface TacticalBattle {
  id: number;
  fleet: number;
  pirate: number;
  started: number;
  turn: number;
  wind: number;
  radius: number;
  units: Unit[];
  log: [number, TacticalEvent][];
}

export interface UnitOptions {
  unit: number;
  moves: [number, number, number][];
  fire: number[];
  board: number[];
}

export interface TacticalView {
  battle: TacticalBattle;
  gun_range: number;
  max_turns: number;
  options: UnitOptions[];
}

export type MateRole =
  | "None"
  | "Accountant"
  | "Trader"
  | { Captain: number }
  | { CaravanLeader: number }
  | { IndustryManager: number }
  /** 第九批：世界定义的岗位（role 为 StaticView.captain.roles 的下标），目标按岗位的作用对象 */
  | { Assigned: { role: number; target: RoleTarget } };

/** 岗位的目标（内核 RoleTarget）：商会本身或某支舰队、商队、某处产业。 */
export type RoleTarget =
  "Owner" | { Fleet: number } | { Caravan: number } | { Industry: number };

export type TacticalOrder =
  | { Move: { unit: number; q: number; r: number } }
  | { Turn: { unit: number; facing: number } }
  | { Fire: { unit: number; target: number } }
  | { Board: { unit: number; target: number } }
  | "Retreat"
  | "EndTurn";

export type AiMode = "Off" | "Offline" | "Mock" | "Live";
export type ProviderKind = "OpenAiCompatible" | "Anthropic";
export type ModelTier = "Fast" | "Balanced" | "Quality";

export interface AiPrefs {
  mode: AiMode;
  provider: ProviderKind;
  base_url: string;
  models: [string, string, string];
  tier: ModelTier;
  monthly_calls: number;
  monthly_tokens: number;
  timeout_secs: number;
  /** 结构化输出（Anthropic 工具调用 / OpenAI 兼容 json_schema），默认开启 */
  structured?: boolean;
  jev_enabled: boolean;
  jev_url: string;
  jev_timeout_ms: number;
  jev_min_score: number;
}

/** 界面与内容的语言（EXPANSION.md §12）。 */
/** L01F：zh-CN-x-gemini 是中文的第二套剧情文本（Gemini 逐条重写；界面字仍是中文那套，只有后端给的显示数据不同，缺的回退原文）。 */
export type Locale = "zh-CN" | "zh-CN-x-gemini" | "en";

/** 抵达时自动暂停：不暂停、旗舰队抵达时（缺省）、任何一支舰队抵达时。 */
export type ArrivalPause = "off" | "flagship" | "any";

/** U05：养成期播放时什么时候停下来。 */
export type UpbringingPause = "week" | "month" | "event";

export interface AppSettings {
  ai: AiPrefs;
  speed: number;
  autosave_days: number;
  /** 抵达时自动暂停；旧后端没有 */
  arrival_pause?: ArrivalPause;
  /** 手动航行中途的分钟暂停（靠岸、碰上陆地、驶入暴风雨、看见新地点或船只），缺省开启；旧后端没有 */
  navigation_pause?: boolean;
  /** U05：养成期播放的停顿方式——每周停（缺省）、每月停、有事才停；旧后端没有 */
  upbringing_pause?: UpbringingPause;
  /** H03：远处的天气团与普通商船只降到 1×；旧后端没有 */
  navigation_slow?: boolean;
  /** H08：到港时显示航程总结；旧后端没有 */
  voyage_summary?: boolean;
  /** H08：新系统第一次出现时的一句话提示；旧后端没有 */
  voyage_hints?: boolean;
  dev_mode: boolean;
  /** 语言；旧设置没有这个字段时按系统语言 */
  language?: Locale;
}

export interface SettingsView {
  settings: AppSettings;
  keys: [ProviderKind, boolean][];
  jev_available: boolean;
}

export interface SaveInfo {
  slot: string;
  day: number;
  scenario: string;
  net_worth: Money;
  /** 主角：随存档保存；旧存档为 null（更早的数据可能没有这个字段） */
  captain?: Captain | null;
  /** 按主角开局、没另设船长时主角的名字（只用于列表显示；旧后端没有） */
  hero?: string;
  /** 存档时的时刻（分钟 0–1439）；旧后端没有这个字段 */
  minute?: number;
  /** 第九批：存档所在的世界（旧存档按经典世界给出 "classic"；旧后端没有这个字段） */
  world_key?: string;
  /** 剧本 key（旧存档没有） */
  scenario_key?: string;
  /** 存档写入的时刻（Unix 秒，取自存档文件；只在存档列表里有，标题画面的“继续”按它挑最近的；旧后端没有） */
  modified?: number;
}

export interface AuditEntry {
  day: number;
  kind: string;
  stage: string;
  detail: string;
}

export interface DebugView {
  day: number;
  state_hash: string;
  log_len: number;
  ai_commands: number;
  money_conserved: boolean;
  audit: AuditEntry[];
}

/** 命令的结果（与 manifest_core::CommandOutcome 的 JSON 形式一致）。 */
export type CommandOutcome =
  | "Done"
  | { Traded: TradeQuote }
  | { Sailed: { days_estimate: number } }
  | { Paid: { cost: Money } }
  | { ShipBought: { fleet: number; cost: Money } }
  | { ShipSold: { proceeds: Money } }
  | { CaravanFormed: { caravan: number } }
  | { IndustryBuilt: { industry: number } }
  | { LoanTaken: { loan: number } }
  | { FuturesFilled: { price: Money } }
  | { Bargained: { discount: number; bribe: Money } }
  | { ColonyFounded: { colony: number } }
  | { DiscoveryReported: { reward: Money; fame: number } };

export interface SubmitResult {
  outcome: CommandOutcome;
  overview: Overview;
}

// ── 玩家命令（与 manifest_core::Command 的 JSON 形式一致，owner 固定为 "player"） ──

export type Holder =
  { Fleet: number } | { Caravan: number } | { Warehouse: number };

type P<T> = T & { owner: "player" };

export type Command =
  | {
      Buy: P<{
        fleet: number;
        good: number;
        qty: number;
        max_total: Money | null;
      }>;
    }
  | {
      Sell: P<{
        fleet: number;
        good: number;
        qty: number;
        min_total: Money | null;
      }>;
    }
  | { SetSail: P<{ fleet: number; dest: number }> }
  | { Resupply: P<{ fleet: number; food: number; water: number }> }
  | { HireCrew: P<{ fleet: number; count: number }> }
  | { DismissCrew: P<{ fleet: number; count: number }> }
  | { Repair: P<{ fleet: number }> }
  | { BuyShip: P<{ fleet: number; ship_type: number; new_fleet: boolean }> }
  | { FoundFleet: P<{ at: number; ship_type: number }> }
  | { SellShip: P<{ fleet: number; ship: number }> }
  | { RefitShip: P<{ fleet: number; ship: number; refit: number }> }
  | {
      BuyInto: P<{
        holder: Holder;
        good: number;
        qty: number;
        max_total: Money | null;
      }>;
    }
  | {
      SellFrom: P<{
        holder: Holder;
        good: number;
        qty: number;
        min_total: Money | null;
      }>;
    }
  | { Transfer: P<{ from: Holder; to: Holder; good: number; qty: number }> }
  | { RentWarehouse: P<{ loc: number; capacity: number }> }
  | { BuyWarehouse: P<{ loc: number; capacity: number }> }
  | { FormCaravan: P<{ at: number; animal: number; count: number }> }
  | { SetGuards: P<{ caravan: number; guards: number }> }
  | { CaravanTravel: P<{ caravan: number; dest: number }> }
  | { DisbandCaravan: P<{ caravan: number }> }
  | { AcceptContract: P<{ contract: number }> }
  | { DeliverContract: P<{ contract: number; holder: Holder }> }
  | { BuildIndustry: P<{ loc: number; kind: number; recipe: number }> }
  | { ChangeRecipe: P<{ industry: number; recipe: number }> }
  | { UpgradeIndustry: P<{ industry: number }> }
  | { SetManager: P<{ industry: number; hired: boolean }> }
  | { SellIndustry: P<{ industry: number }> }
  | { InvestPort: P<{ loc: number; amount: Money }> }
  | { PlaceOrder: P<{ loc: number; good: number; side: "Buy" | "Sell"; limit: Money; qty: number }> }
  | { CancelOrder: P<{ order: number }> }
  | { Deposit: P<{ amount: Money }> }
  | { Withdraw: P<{ amount: Money }> }
  | { Borrow: P<{ amount: Money; months: number }> }
  | { Repay: P<{ loan: number; amount: Money }> }
  | { BuyLicense: P<{ faction: number }> }
  | { BuyMarque: P<{ faction: number }> }
  | { TradeFutures: P<{ contract: number; lots: number }> }
  | { DepositMargin: P<{ exchange: number; amount: Money }> }
  | { WithdrawMargin: P<{ exchange: number; amount: Money }> }
  | { SetDelivery: P<{ contract: number; physical: boolean }> }
  | { HireMate: P<{ mate: number }> }
  | { DismissMate: P<{ mate: number }> }
  | { AssignMate: P<{ mate: number; role: MateRole }> }
  | { BuyChart: P<{ region: number }> }
  | { EngageBattle: P<{ battle: number; tactical: boolean }> }
  | { TacticalCommand: P<{ battle: number; order: TacticalOrder }> }
  // ── 殖民与探险 ──
  /** 舰队停在殖民点：扣建立费与物资，settlers 名船员成为殖民者；name 为 1–16 字。成功时 outcome 为 ColonyFounded */
  | {
      FoundColony: P<{
        fleet: number;
        site: number;
        name: string;
        settlers: number;
      }>;
    }
  /** 开工或升级一座殖民地建筑（同一时间一个工程） */
  | { BuildColony: P<{ colony: number; building: number }> }
  /** 设定税率档位（rules.colony_tax_levels 的下标） */
  | { SetColonyTax: P<{ colony: number; rate: number }> }
  | { AbandonColony: P<{ colony: number }> }
  /** 在港口报告发现物（loc 为停靠的港口），成功时 outcome 为 DiscoveryReported */
  | { ReportDiscovery: P<{ discovery: number; loc: number }> }
  /** B12：潜水找发现物（DiscoveriesView.dives 里 enabled 的那几处；海上须收帆，或靠港），成功时记为已发现 */
  | { Dive: P<{ fleet: number; discovery: number }> }
  /** H08：回应甲板闲话的小互动 */
  | { BanterReply: P<object> }
  /** H06：向附近的船喊话 */
  | { Hail: P<{ fleet: number; target: HailTargetKey; action: HailActionKey }> }
  /** H04：在海上所见的小卡片上选一个按钮 */
  | { ResolveSighting: P<{ fleet: number; sighting: number; choice: number }> }
  /** 回应等待中的剧情事件（故事线的一章或一次奇遇）：选第 choice 个选项（从 0 起） */
  | { StoryAnswer: P<{ choice: number }> }
  // ── 主角身世 ──
  /** 立下主角的身世（每局一次）：answers 按问题顺序、alloc 按属性顺序且合计为 points.free；算学达到 genius_numeracy 时可带一种奇才之法 */
  | { CreateCaptain: P<CaptainCreation> }
  // ── 信息时效（ECONOMY.md 第 7 节） ──
  /** 选择行情情报（只在开局第 0 天） */
  | { SetInfoMode: P<{ mode: InfoMode }> }
  /** 在港口的交易所买行情通报 */
  | { BuyMarketReport: P<{ loc: number }> }
  // ── 第九批：人物（UI-CONTRACT I5） ──
  | { Talk: P<{ person: string; topic: string }> }
  | { GiveItem: P<{ person: string; item: string; qty: number }> }
  | { GiveGoods: P<{ person: string; good: number; qty: number }> }
  | { RecruitPerson: P<{ person: string }> }
  | { RequestAudience: P<{ person: string }> }
  /** 第九批（I5b）：见闻簿里的这些条目标为已读 */
  | { MarkNewsRead: P<{ ids: string[] }> }
  // ── 第九批：养成（UI-CONTRACT I6） ──
  /** 提交这个月的日程：家乡期每段一格（after），学院期两格（lesson + after） */
  | { PlanMonth: P<{ slots: PlanSlotInput[] }> }
  /** U05：提交这一周的日程（每格只填 lesson 或 after 之一）；本周还没结算的格写回常设周课表 */
  | { PlanWeek: P<{ slots: PlanSlotInput[] }> }
  | { ChoosePath: P<{ path: string }> }
  | { TakeExam: P<{ exam: string }> }
  | {
      PlayContest: P<{
        contest: string;
        moves: unknown[] | { register: boolean };
      }>;
    }
  /** 跳过剩余的养成（只带 owner；原来写成 P<Record<string, never>>，owner 成了 never、提交不了） */
  | { SkipUpbringing: { owner: "player" } }
  // ── 第九批：物品与拍卖（UI-CONTRACT I4、I9） ──
  | {
      BuyItem: P<{
        loc: number;
        item: string;
        qty: number;
        max_total: Money | null;
      }>;
    }
  | {
      SellItem: P<{
        loc: number;
        item: string;
        qty: number;
        min_total: Money | null;
      }>;
    }
  | { Equip: P<{ wearer: string; slot: EquipSlot; item: string }> }
  | { Unequip: P<{ wearer: string; slot: EquipSlot }> }
  | { UseItem: P<{ item: string; target?: string | null }> }
  | { ReadBook: P<{ book: string; interpreter?: string | null }> }
  | { BidAuction: P<{ auction: string; lot: string; amount: Money }> }
  | { PassAuction: P<{ auction: string; lot: string }> }
  | { InspectLot: P<{ auction: string; lot: string }> }
  // ── 第九批：时间线与秘闻（UI-CONTRACT I7、I8） ──
  | {
      Contribute: P<{
        event: string;
        lever: string;
        payload: ContributePayload;
      }>;
    }
  | { JoinSociety: P<{ society: string }> }
  | { CastSpell: P<{ spell: string; target: SpellTargetInput }> }
  | { Propagate: P<{ idea: string; loc: number; mode: string }> }
  | { CommissionShip: P<{ ship: string; loc: number }> }
  // ── 第九批：手动航行（UI-CONTRACT I3，定义在文件末尾） ──
  | NavCommand
  | AiCommand
  // ── R10-U06 养成行动制（定义在 actTypes.ts） ──
  | ActCommand;

// ───────────────────────────── 剧情事件：推荐角色的故事线与奇遇 ─────────────────────────────

/** 对话框里的说话人：旁白、主角、航海士（按 key 取头像）或某张人物头像。 */
export interface StorySpeakerView {
  kind: "none" | "captain" | "mate" | "portrait";
  mate?: string;
  asset?: string;
  /** 名字（主角由界面按主角的姓名显示，这里为空） */
  name: string;
  /** 第九批（I5）：说话的人物 key（旁观的一幕里用它认出台上哪一位在说话） */
  person?: string;
  /** 第九批（I5）：人物头像的素材 id（与 asset 相同） */
  portrait?: string;
}

/**
 * 剧情事件的种类（UI-CONTRACT I5、I5b）。经典故事只有 chapter / encounter；故事 2.0 按轨道给 chapter（主线）/ upbringing / history /
 * request / encounter / side；怪异给 omen / encounter。bond、letter、contest 契约里列了，后端眼下还不发（界面照样有标签）。
 */
export type StoryKind =
  | "chapter"
  | "encounter"
  | "side"
  | "upbringing"
  | "bond"
  | "history"
  | "request"
  | "letter"
  | "omen"
  | "contest";

/** 人物之间的关系（manifest_core::cast::relations::Relation，snake_case）。 */
export type RelationKey =
  | "friends"
  | "confidants"
  | "sisters"
  | "sworn"
  | "mentor"
  | "rivals"
  | "enemies"
  | "crush"
  | "promise"
  | "dating"
  | "lovers"
  | "partners";

/** 第九批（I5b）：旁观的一幕里台上的一位配角。 */
export interface StoryCastView {
  person: string;
  name: string;
  portrait: string | null;
}

export interface StoryChoiceView {
  /** 第九批：故事 2.0 与怪异的选项 key（经典故事没有） */
  key?: string;
  text: string;
  /** 要付的金币（0 表示不用付） */
  cost: number;
  /** 要交出的货：[商品 id, 数量] */
  give?: [number, number];
  /** 检定：attr 是属性、评价或技能的 key，name 是它的名字（当前语言），pct 是对主角的成功率（%） */
  check?: { attr: string; name: string; pct: number };
  /**
   * 现在不能选的原因；能选时没有。经典故事给代码：cash（现金不够）/ cargo（货不够），界面按 story.blocked.<代码> 写；
   * 第九批的故事 2.0 与怪异给后端写好的一句话（当前语言），照写。
   */
  blocked?: string;
  /** 第九批（I5）：选项的后果提示（数据给，可选） */
  hint?: string;
  /** 第九批（I5）：选项的门槛说明（当前语言，“已完成：某一章”“声望 ≥ 20”……）；后端不说满足没有，不满足时 blocked 给原因 */
  requires?: string[];
  /**
   * U02：要掷骰时的最终成功率（0–100，已含原 check，夹在 5–95）；只在有软缺口或有 check、且能选时给。
   * 显示成功率以它为准，不读 check.pct。规则关闭的世界没有。
   */
  chance?: number;
  /** U02：没达到的软门槛（属性、评价、成长、技能）：差的是哪项、有多少、要多少 */
  soft_gap?: StorySoftGapView[];
  /** U02：本次事件里掷骰失败过、门槛仍没达到（此时 blocked 有原因、没有 chance） */
  failed?: boolean;
}

/** U02：一项没达到的软门槛（have / need 的单位随 key：属性为档位、评价为评价分、成长为成长点、技能为经验值）。 */
export interface StorySoftGapView {
  key: string;
  label: string;
  have: number;
  need: number;
}

/** U02：刚掷的一次骰（roll 为 1–100，roll ≤ chance 为成功；choice 为稳定的选项键）。 */
export interface StoryRollView {
  chance: number;
  roll: number;
  success: boolean;
  choice: string;
}

/** 等待回应的剧情事件。 */
export interface StoryEventView {
  day: number;
  fleet: number;
  /** 见 StoryKind；side（第九批 I5b）是配角之间的一幕，主角在场旁观（没有选项时只有“继续”） */
  kind: StoryKind;
  key: string;
  /** 章节：第几章（从 1 起）与总章数、故事线的名字 */
  chapter?: number;
  total?: number;
  story?: string;
  title: string;
  text: string;
  speaker: StorySpeakerView;
  choices: StoryChoiceView[];
  /** 第九批（I5）：轨道 key 与轨道名（“汐 · 羁绊”、“伊内丝与索菲”……） */
  track?: string;
  track_name?: string;
  /** 第九批（I5）：情绪，决定配乐（cheerful / tender / tense / sad / mystic；数据给的字符串） */
  mood?: string;
  /** 第九批（I5）：回忆插画的素材 id（关键事件才有；界面眼下还没有插画位，只挂在对话框的 data-art 上） */
  art?: string;
  /** 第九批（I5）：发生的地点名（当前语言；没探明的地点由后端换成“尚未探明的地点”一类的写法） */
  place?: string;
  /** 第九批（I5）：夜里的事件（画面变暗）；怪异的事件也带 */
  night?: boolean;
  /** 第九批（I5）：这一件之后还在排队的事件数 */
  queue?: number;
  /** 今天是这件事的最后一天（过了今天它就不再等着）：只在开了节奏规则的世界、出海之后、而且为真时才有（P11） */
  last_day?: boolean | null;
  /** 第九批（I5b）：台上的配角（通常两位；说话人仍在 speaker） */
  cast?: StoryCastView[];
  /**
   * R10-FIX8：这一章“站出来的人”（章节写了 figure 才有）：没有人物卡的人（data/worlds/terra16/cast/figures.toml）或人物键；
   * 界面先看它，没有再取 cast 第一位。name 是名牌上的称呼（人物键时照遮名规则）
   */
  figure?: { key: string; name: string } | null;
}

/** 实际发生的一条效果。 */
export interface StoryOutcomeView {
  kind:
    | "cash"
    | "fame"
    | "reputation"
    | "morale"
    | "goods"
    | "crew"
    | "repair"
    | "damage"
    | "supplies"
    | "rumor"
    | "reveal"
    | "chart"
    | "mate"
    | "mate_busy"
    | "attr"
    /** 第九批（I5b）：一条见闻进了见闻簿（text、persons） */
    | "news"
    // 第九批（I5）故事 2.0 的效果：
    /** 成长值（attr、value） */
    | "growth"
    /** 技能经验（skill、value；B12 起另带当前语言的 skill_name，旧后端没有） */
    | "skill"
    /** 情谊 / 心动（person、person_name、value） */
    | "affinity"
    | "heart"
    /** 关系（person、person_name、relation，text 是关系名；value 1 结下、-1 解除）；配角之间的关系另带 persons [a, b]，text 是“甲 / 乙 · 关系名” */
    | "relation"
    /** 物品（item、item_name、value 是数量，负数是交出） */
    | "item"
    /** 回忆（memory、title） */
    | "memory"
    /** 剧情旗标（flag，value 1 / 0）：内部状态，不给玩家看 */
    | "flag"
    /** 称号（title） */
    | "title"
    /** 来信（person、person_name、text 是信的全文） */
    | "letter";
  /** 数值；mate：1 加入、-1 离开 */
  value: number;
  good?: number;
  faction?: number;
  discovery?: number;
  region?: number;
  mate?: string;
  mate_name?: string;
  /** attr（经典的属性点）、growth（成长值）：属性 key */
  attr?: string;
  /** news：见闻的一段话；relation：关系名；letter：信 */
  text?: string;
  persons?: string[];
  /** skill：技能的稳定 key */
  skill?: string;
  /** skill：技能的名字（当前语言，与选项 check.name 同源；B12，旧后端没有） */
  skill_name?: string;
  person?: string;
  person_name?: string;
  item?: string;
  item_name?: string;
  memory?: string;
  /** memory：回忆的标题；title：称号 */
  title?: string;
  flag?: string;
  relation?: RelationKey;
}

/** 上一次回应的结果（choice 为空表示当天没有回应、奇遇就此作罢）。 */
export interface StoryResultView {
  day: number;
  kind: StoryKind;
  key: string;
  title: string;
  choice: string | null;
  reply: string;
  success: boolean | null;
  outcomes: StoryOutcomeView[];
  speaker: StorySpeakerView;
  /** 这一章走完之后故事线结束了 */
  ended: boolean;
}

export interface StoryJournalView {
  day: number;
  /** intro（FIX5，后端合入前没有）：开场介绍的幕（轨道键以 intro_ 开头），只出现在经历里 */
  kind: StoryKind | "intro";
  title: string;
  choice: string;
  success: boolean | null;
}

/** 故事线的进度：已走完的章数、总章数与下一章的提示。 */
export interface StoryLineView {
  key: string;
  name: string;
  done: number;
  total: number;
  hint: string | null;
}

export interface StoryView {
  line: StoryLineView | null;
  pending: StoryEventView | null;
  last: StoryResultView | null;
  /** U02：last 是故事回应且掷过骰时给（含原 check）；规则关闭的世界与旧后端没有 */
  last_roll?: StoryRollView | null;
  journal: StoryJournalView[];
  /** 第九批（I5b）：见闻簿里没读过的条数（旧后端没有） */
  news_unread?: number;
}

/** CreateCaptain 的内容（不含 owner）。 */
export interface CaptainCreation {
  birthday: Birthday;
  answers: string[];
  alloc: number[];
  genius?: string | null;
}

// ───────────────────────────── 行情预测（docs/ECONOMY.md 第 4 节） ─────────────────────────────

/** 作用于某市场的事件、流行等标记（预测期内与进行中）。 */
export interface ForecastMark {
  day: number;
  /** event（目录事件）/ composed（组合事件）/ popular（开始流行）/ popular_end（流行结束） */
  kind: "event" | "composed" | "popular" | "popular_end";
  event?: number | null;
  composed?: number | null;
  /** 效果 key，如 demand_shift */
  effect?: string | null;
  /** 系数（万分之一） */
  mult_bp?: number | null;
  /** 结束日（不含） */
  end?: number | null;
}

/** 某地某商品的行情序列（后端 market_series）。 */
export interface SeriesView {
  loc: number;
  good: number;
  today: number;
  last_close: number | null;
  /** 日线：每日收盘价，最早的在前 */
  daily: Money[];
  /** 月线：月均收盘价，最早的在前 */
  monthly: Money[];
  monthly_last: number | null;
  base_price: Money;
  floor: Money;
  cap: Money;
  price: Money;
  stock: number;
  target: number;
  popular_until: number | null;
  events: ForecastMark[];
  /** 价格曲线 f(库存 / 目标库存)：[比例, 系数]，均为万分之一 */
  curve: [number, number][];
  popular_bonus_bp: number;
  /** 玩家会的预测方法：行商的老法子 + 麾下算学奇才的法子 */
  methods: string[];
  /** 这里有没有本地产出（没有时全靠外来）；旧后端缺省 */
  produces?: boolean;
  /** 本地生产者（docs/ECONOMY.md 6.3）；没有打开或这里没有产出时为空，旧后端缺省 */
  producer?: ProducerView | null;
  /** 本地商人（ECONOMY.md 6.6）；规则关闭、还没开张或旧后端时为空 */
  merchants?: MerchantsView | null;
  /** 行情的时效与来源（随船传递、远方港口）；看得到实时行情或旧后端时为空 */
  seen?: SeenView | null;
  /** 主角的旗舰队到这里的预计航程（天）；没有舰队或到不了时为空 */
  voyage_days?: number | null;
}

/** 本地商人的状况。四派的顺序：适应、弱趋势、强趋势、锚定。 */
export interface MerchantsView {
  /** 四派的占比（万分之一） */
  shares_bp: [number, number, number, number];
  /** 四派对下一个收盘价的预测（万分之一金币） */
  forecast_bp: [number, number, number, number];
  /** 主流预期（按占比加权，含传闻的偏移；万分之一金币） */
  expect_bp: number;
  /** 今天的精确收盘价（万分之一金币） */
  price_bp: number;
  /** 存货（件）与平常的存货 */
  hoard: number;
  hoard_base: number;
  /** 传闻带来的预期偏移（万分之一，±） */
  rumor_bp: number;
}

/** 本地生产者的状况。 */
export interface ProducerView {
  /** 当前产能相对开局（万分之一） */
  capacity_bp: number;
  /** 作物下一季的计划产能相对开局（万分之一；非作物为空） */
  planned_bp: number | null;
  /** 生产者对价格的预期（相对这个月的正常价，万分之一） */
  expect_bp: number;
  /** 这个月的正常价（万分之一金币；头一年还在观望时为空） */
  normal_bp: number | null;
  /** 头一年只看不动 */
  learning: boolean;
  /** 按季播种的作物 */
  crop: boolean;
}

/** 麾下的一位算学奇才与他（她）掌握的方法。 */
export interface GeniusView {
  mate: number;
  /** 名字（当前语言） */
  name: string;
  methods: string[];
}

export interface ForecastPointView {
  mean: Money;
  lo80: Money;
  hi80: Money;
  lo95: Money;
  hi95: Money;
}

export interface InterventionView {
  day: number;
  kind: "step" | "pulse";
  /** 幅度（万分比） */
  size_bp: number;
  end?: number | null;
}

/** 记下的预测的方法与选项（参数的比例为万分之一，窗口与天数为整数）。 */
export interface ForecastSpecView {
  method: string;
  params: Record<string, number>;
  window: number;
  log: boolean;
  seasonal: boolean;
  excluded: number[];
  interval: "formula" | "empirical";
  intervention?: InterventionView | null;
}

export interface AdjustBasisView {
  kind:
    | "refit"
    | "switch"
    | "intervention"
    | "seasonal"
    | "exclude"
    | "params"
    | "calibrate";
  reason: "event" | "intel" | "judgment";
  note: string;
}

/** 某天的实际情况：收盘价与市场驱动（系数为万分之一）。 */
export interface TrackDayView {
  day: number;
  price: Money;
  stock_close: number;
  stock_end: number;
  target: number;
  produced: number;
  consumed: number;
  player_bought: number;
  player_sold: number;
  npc_bought: number;
  npc_sold: number;
  other_bought: number;
  other_sold: number;
  demand_bp: number;
  season_bp: number;
  event_bp: number;
  popular: boolean;
  supply_bp: number;
  event_supply_bp: number;
  clamped: number;
  /** 本地生产者当天的产能（相对开局，万分之一；没有生产者时为 10000；旧的预测簿与旧后端为 0 或缺省 = 不知道） */
  capacity_bp?: number;
  /** 城镇工坊当天取走的原料与放回的产出、委托交付进入市场的货物（ECONOMY.md 6.4、6.5；旧的预测簿与旧后端缺省） */
  workshop_in?: number;
  workshop_out?: number;
  delivered?: number;
  /** 收盘时目标库存的需求规模分量：人口比例、需求层级系数（繁荣度）、替代系数（万分之一；0 或缺省 = 没有记录，即 1） */
  people_bp?: number;
  prosperity_bp?: number;
  substitute_bp?: number;
  /** 本地商人当天囤入（正）或抛售（负）的货物（收盘之后；ECONOMY.md 6.6；旧的预测簿与旧后端缺省） */
  hoarded?: number;
  /** 只补了收盘价（记下预测时这一天已经过去；ECONOMY.md 第 7 节） */
  filled?: boolean;
  /** 收盘价用到的流动性系数（当地钱袋，ECONOMY.md 6.9；万分之一，0 或缺省 = 1） */
  liquidity_bp?: number;
}

export interface ForecastEntryView {
  id: number;
  loc: number;
  good: number;
  created: number;
  origin: number;
  horizon: number;
  spec: ForecastSpecView;
  fitted_on: Money[];
  path: ForecastPointView[];
  revises?: number | null;
  basis?: AdjustBasisView | null;
  baseline: TrackDayView;
  baseline_exact: boolean;
  track: TrackDayView[];
  marks: ForecastMark[];
}

export interface BookView {
  today: number;
  last_close: number | null;
  max_active: number;
  active: number;
  entries: ForecastEntryView[];
  methods: string[];
  geniuses: GeniusView[];
  /**
   * 可以分析的地点（到访过、有市场）与它交易的商品；prices 与 goods 一一对应，是所知的价格（新后端才有），
   * sold 是这里出售的商品（开放市场，新后端才有；缺省时 goods 里的都能买）
   */
  places: {
    loc: number;
    goods: number[];
    prices?: number[];
    sold?: number[];
    /** T04：远方行情的时效（随船传递时；在场或实时时没有）；与 goods 一一对应的常价、现价对常价的比例（万分之一） */
    seen?: SeenView | null;
    normal?: Money[];
    vs_normal_bp?: number[];
  }[];
}

/** 记下一条预测（前端算好的结果）。 */
export interface PinRequest {
  loc: number;
  good: number;
  origin: number;
  horizon: number;
  spec: ForecastSpecView;
  fitted_on: Money[];
  path: ForecastPointView[];
  revises?: number | null;
  basis?: AdjustBasisView | null;
}

// ───────────────────────────── 第九批：世界与开局（docs/UI-CONTRACT.md I1） ─────────────────────────────

/** 世界日历的日期：[年, 月, 日]。 */
export type WorldDate = [number, number, number];

/** 开局界面用的世界目录：可玩的世界、各自的剧本、主角与自创模板（hidden 的测试世界不列出）。 */
export interface WorldCatalog {
  /** 当前对局所在的世界（没有对局时为 null） */
  current: string | null;
  worlds: WorldCard[];
}

export interface WorldCard {
  key: string;
  name: string;
  name_en?: string | null;
  tagline: string;
  description: string;
  map_key: string;
  /** 纪年名，如“公元” */
  era: string;
  /** 世界创建的年份 */
  start_year: number;
  currency: string;
  /** 每月的天数（世界日历；缺省 12 × 30） */
  months?: number[];
  /** 打开的模块：navigation_manual、upbringing、items、cast、history、ideas、societies、arcana、realms…… */
  modules: string[];
  /** B11：这个世界的内容有哪些语言（缺省 ["zh", "en"]）；不含 "en" 时剧情、人物等文字只有中文，界面仍可切英文 */
  languages?: string[];
  scenarios: ScenarioCard[];
}

export interface ScenarioCard {
  key: string;
  name: string;
  name_en?: string | null;
  description: string;
  /** 世界创建的日期 */
  start_date: WorldDate;
  /** 玩家开始操作的日期（晚于 start_date 时先推演） */
  control_date: WorldDate;
  /** 主角从养成开始 */
  upbringing: boolean;
  /** 剧本可选的主角；空表示走旧的开局向导 */
  protagonists: ProtagonistCard[];
  /** 自创主角的模板；空表示不能自创 */
  templates: TemplateCard[];
  goal: ScenarioGoalView;
  options: { history_toggle: boolean; skip_upbringing: boolean };
}

/** 学院（开局卡片上只要名字与所在城市）。 */
export interface AcademyRef {
  key: string;
  name: string;
  city: string;
}

/** 剧本里的一位主角。开局文案照旧不点破人物的秘密（伏笔规则）。 */
export interface ProtagonistCard {
  key: string;
  name: string;
  name_en?: string | null;
  gender: "f" | "m";
  born: WorldDate;
  /** 家乡的地名 */
  home: string;
  /** 地区，如“日本·土佐与京都” */
  region: string;
  tagline: string;
  /** 风格，如“公家的姬君” */
  style: string;
  /** 核心玩法（一句） */
  playstyle: string;
  /** 玩法标签 */
  tags: string[];
  /** 1–5 */
  difficulty: number;
  /** 长项属性的 key */
  strengths: string[];
  start_ship: string;
  /** 起始见识（海区名） */
  known: string[];
  academy: AcademyRef;
  /** 信物 */
  keepsake: string;
  /** 按年龄分阶段的头像：from_age 递增；asset 是头像清单里的 id */
  portraits: { from_age: number; asset: string }[];
  /** 养成期的同伴预告 */
  bonds: { person: string; name: string; kind: string }[];
}

/** 自创主角的模板。 */
export interface TemplateCard {
  key: string;
  name: string;
  home: string;
  /** 家庭与导师（一句） */
  family: string;
  /** 特有活动（一句） */
  activities: string;
  style: string;
  known: string[];
  academy: AcademyRef;
}

/** 开局请求（new_world_game）。 */
export interface NewGameRequest {
  scenario: string;
  seed?: number | null;
  world?: string;
  protagonist?: string | null;
  template?: string | null;
  captain?: {
    name: string;
    look: number;
    gender: "f" | "m";
    birthday: [number, number];
  } | null;
  skip_upbringing?: boolean;
  history?: boolean;
  /** 行情情报（缺省随船传递） */
  info?: InfoMode;
}

/** 开局前推演的进度（事件 bootstrap）。 */
export interface BootstrapProgress {
  day: number;
  total: number;
}

/** 跳过养成时的分段进度（后端 `upbringing_progress` 事件，P05）：每推进至多七天推一次。`day` 为本次已推进天数。 */
export interface UpbringingProgress {
  epoch: number;
  rev: number;
  day: number;
  total: number | null;
  date: [number, number, number];
  target: [number, number, number] | null;
  done: boolean;
}

// ───────────────────────────── 第九批：人物与故事 2.0（docs/UI-CONTRACT.md I5） ─────────────────────────────

export type BondRank = "C" | "B" | "A" | "S";
export type HeartStage = 0 | 1 | 2 | 3;

export interface PersonCard {
  key: string;
  name: string;
  portrait: string | null;
  age: number;
  kind: "historical" | "story" | "protagonist" | "legend";
  role: string;
  /** 一句话身份（公开的人物简介；旧后端没有） */
  summary?: string;
  where: string | null;
  affinity: number;
  heart: number | null;
  heart_stage: HeartStage | null;
  bond: BondRank | null;
  relation: string[];
  call_name: string;
  can_recruit: boolean;
  requests: number;
}

export interface PersonDetail extends PersonCard {
  /** 此刻和主角在同一处（可以交谈、送礼、招募） */
  here: boolean;
  bio_pages: { title: string; text: string }[];
  likes_known: string[];
  dislikes_known: string[];
  birthday: [number, number] | null;
  days_to_birthday: number | null;
  memories: string[];
  topics: {
    key: string;
    name: string;
    enabled: boolean;
    blocked_reason?: string;
  }[];
  gifts: {
    item: string;
    name: string;
    qty: number;
    reaction: "love" | "like" | "neutral" | "dislike" | "hate" | "unknown";
  }[];
  basis?: string;
  sources?: string[];
  /** 第九批（I5b）：主角知道的、这位与别人的关系（旧后端没有） */
  ties?: PersonTie[];
  /** 第九批（I5b）：这位的近况（最近的在前，至多 5 条；旧后端没有） */
  news?: NewsItem[];
  /** A9：真正一起上过学的人才有（结业时冻结的同窗记录）；旧后端与旧档没有 */
  school_memory?: SchoolMemory;
}

/** A9：没被选中的主角此刻停在这里的船（只读投影，不是真舰队）；只列见过、此刻当面的人。 */
export interface PersonFleetView {
  person: string;
  loc: number;
  cell: { x: number; y: number };
  /** 船型的 key（static_data.ships 里的 key） */
  ships: string[];
}

/** A9：同窗记忆。日子都是世界的绝对天数。 */
export interface SchoolMemory {
  family: string;
  /** 一起上过的学院 key */
  academies: string[];
  graduated_on: number;
  /** 结业那天的情谊、心动、关系与羁绊 */
  affection: {
    affinity: number;
    heart: number;
    relations: string[];
    experiences: number;
    bond: BondRank | null;
  };
  promise: boolean;
  memories: string[];
  /** 结业后分开过 */
  parted: boolean;
  /** 分开后第一次再见的日子；还没再见或一直同行时为 null */
  reunited_on: number | null;
}

/** 第九批（I5b）：这位与另一位的关系。tags 只给很小的色点，不写成标签。 */
export interface PersonTie {
  person: string;
  name: string;
  portrait: string | null;
  /** 关系的种类（lovers、friends、rivals……，与关系图的线同一套） */
  kind: string;
  /** 关系名（当前语言） */
  label: string;
  since?: WorldDate;
  tags?: ("GL" | "BL" | "BG" | "GB")[];
}

/** 第九批（I5b）：一条见闻——配角之间的事，主角亲眼看到、听说或在信里读到。 */
export interface NewsItem {
  /** 稳定 id（轨道 key + 章节 key） */
  id: string;
  /** 事情发生的日子（不是主角知道的日子） */
  day: WorldDate;
  text: string;
  /** 涉及的人物 key */
  persons: string[];
  /** 亲眼看到 / 听说 / 信里写的 */
  kind: "seen" | "heard" | "letter";
  place?: string | null;
  track?: string;
  track_name?: string;
  read: boolean;
}

/** 第九批（I5b）：见闻簿（最近的在前）。 */
export interface GossipView {
  items: NewsItem[];
  unread: number;
}

export interface RelationshipsView {
  nodes: {
    key: string;
    name: string;
    portrait: string | null;
    kind: "protagonist" | "person";
  }[];
  edges: {
    a: string;
    b: string;
    kind: string;
    label: string;
    since?: WorldDate;
  }[];
}

export interface TrackView {
  key: string;
  name: string;
  kind: string;
  status: "active" | "done" | "failed" | "waiting";
  chapter: string;
  chapter_title: string;
  objectives: {
    text: string;
    done: boolean;
    place?: string | null;
    deadline?: WorldDate | null;
    days_left?: number | null;
  }[];
}

// ───────────────────────────── 第九批：养成（docs/UI-CONTRACT.md I6） ─────────────────────────────

export interface Meter {
  value: number;
  max: number;
  label: string;
  /** 心情条（U04 工作包 3）：回归中心、兴致与低谷门槛、兴致加成；没有心情规则的世界为 null，旧后端没有这几项 */
  center?: number | null;
  high?: number | null;
  low?: number | null;
  high_bonus_pct?: number | null;
  boosted?: boolean;
  low_mood?: boolean;
  efficiency_pct?: number;
}

/** 解锁差项的一项（U04 工作包 4）：如“航海 312 / 340”。 */
export interface UnlockGap {
  key: string;
  label: string;
  have: number;
  need: number;
}

/** 最近开放的东西（U04 工作包 4）：新活动、新地点、志向可选、考试开放、评价升段。 */
export interface UnlockedNow {
  kind: "activity" | "place" | "path" | "exam" | "rating";
  key: string;
  label: string | null;
  rank: string | null;
  date: [number, number, number];
}

/** 年度目标卡（U04 工作包 5）：今年的三张、往年的记录、刚完成的。 */
export interface UpbringingGoals {
  year: number;
  items: {
    key: string;
    year: number;
    /** 目标文字；空时为 null，界面回退 fallback_code 指的通用语 */
    text: string | null;
    fallback_code: string;
    status: "active" | "done" | "missed" | "upcoming";
    since: [number, number, number];
    done_date: [number, number, number] | null;
    objectives: { key: string; label: string; have: number; need: number; done: boolean }[];
    rewards: { kind: "growth" | "skill" | "item" | "memory" | "other"; key?: string; label?: string | null; value?: number }[];
  }[];
  history: { key: string; year: number; text: string | null; status: "active" | "done" | "missed" | "upcoming" }[];
  done_now: string[];
}

export interface AfterChoice {
  activity: string;
  place?: string | null;
  companion?: string | null;
  book?: string | null;
  excursion?: string | null;
  node?: string | null;
}

export interface SlotResult {
  index: number;
  title: string;
  scene: string;
  success: boolean | null;
  growth: { attr: string; delta: number }[];
  skills: { skill: string; name: string; xp: number }[];
  cash: number;
  fatigue: number;
  mood: number;
  affinity: { person: string; name: string; delta: number }[];
  items: { item: string; name: string; qty: number }[];
  line: string | null;
}

export interface SlotView {
  index: number;
  label: string;
  from: WorldDate;
  to: WorldDate;
  lesson: string | null;
  after: AfterChoice | null;
  status: "empty" | "planned" | "current" | "done" | "locked";
  result?: SlotResult;
  // ── U05 按周排程才有 ──
  /** 栏位：学院的课业格 / 课余格，家乡期的自由格 */
  column?: "lesson" | "after" | "free";
  /** 周内第几天结算（1–7） */
  day?: number;
  /** 格重：八分之几个“标准格”（按旬时的一格） */
  weight?: number;
  /** 落在换阶段之后：到那天按新阶段重排，现在不能排 */
  locked?: boolean;
  /** 常设周课表里这一格排的是什么（没排时为 null） */
  timetable?: { lesson: string | null; after: AfterChoice | null } | null;
}

export interface PlanView {
  month: [number, number];
  editable: boolean;
  slots: SlotView[];
  // ── U05 按周排程才有（按旬的世界与旧后端没有）──
  mode?: "week";
  /** 本周是本月第几周（1–4）与每月几周 */
  week?: number;
  weeks?: number;
  /** 下一格的格序（之前的已经结算） */
  next_slot?: number;
  /** 常设周课表这一周铺不上：哪一格（null = 整张）与原因 */
  timetable_problem?: { index: number | null; reason: string } | null;
}

export type ActivityKind =
  | "lesson"
  | "job"
  | "training"
  | "social"
  | "rest"
  | "voyage"
  | "adventure"
  | "club"
  | "free"
  | "date"
  | "contest"
  | "reading"
  | "craft";

export type ActivityNeed = "place" | "companion" | "book" | "excursion";

export interface ActivityView {
  key: string;
  name: string;
  desc: string;
  kind: ActivityKind;
  scene: string;
  cost: number;
  income: [number, number];
  fatigue: number;
  mood: number;
  gains: { attr: string; range: [number, number] }[];
  skills: { skill: string; name: string; xp: number }[];
  mentor: { key: string; name: string; present: boolean } | null;
  companions: { key: string; name: string }[];
  tier: { level: number; name: string; progress: number; next: number } | null;
  risk: number;
  needs: ActivityNeed[];
  enabled: boolean;
  blocked_code?: string;
  blocked_reason?: string;
  tags: string[];
  new: boolean;
  /** U04 工作包 4：没开放、只差能练出来的项时的差项；“差一点”；名称是否还是占位键（旧后端没有） */
  unlock_gap?: UnlockGap[] | null;
  near?: boolean;
  placeholder?: boolean;
  /**
   * U05 按周排程：这项活动排进一格占的格重（八分之几个标准格；按旬时是 8）。卡片上的 cost / income / fatigue / mood /
   * gains / skills 已经是单格取整值；eighths 是精确值（八分之一为单位），“本周预计”按它加总再除以 8。旧后端没有。
   */
  weight?: number;
  eighths?: {
    cost: number;
    income: [number, number];
    fatigue: number;
    mood: number;
    gains: { attr: string; range: [number, number] }[];
  };
}

export interface PlaceView {
  key: string;
  name: string;
  x: number;
  y: number;
  kind: string;
  open: boolean;
  people: { key: string; name: string; portrait: string | null }[];
  hint: string | null;
}

export interface ExcursionNode {
  key: string;
  name: string;
  x: number;
  y: number;
  state: "unknown" | "new" | "seen" | "solved";
  danger: number;
  hint: string | null;
  links: string[];
}

export interface ExcursionView {
  key: string;
  name: string;
  nodes: ExcursionNode[];
}

export interface CompanionView {
  key: string;
  name: string;
  portrait: string | null;
  /** 一句话身份（公开的人物简介；旧后端没有） */
  summary?: string;
  role: "family" | "mentor" | "classmate" | "rival" | "penpal" | "friend";
  bond: BondRank | null;
  affinity: number;
  heart: number | null;
  heart_stage: HeartStage | null;
  romance_open: boolean;
  relation: string[];
  call_name: string;
  birthday: [number, number];
  days_to_birthday: number;
  likes_known: string[];
  dislikes_known: string[];
  where_now: string | null;
  next_hint: string | null;
}

export interface CalendarMark {
  date: WorldDate;
  days_left: number;
  kind:
    "festival" | "exam" | "contest" | "birthday" | "school" | "letter" | "news";
  key: string;
  name: string;
  heart: boolean;
  note: string | null;
}

export interface ExamView {
  key: string;
  name: string;
  date: WorldDate | null;
  status: "open" | "passed" | "failed" | "locked";
  pass_pct: number | null;
  requirements: string[];
}

export interface PathView {
  choose_on: WorldDate | null;
  chosen: string | null;
  options: {
    key: string;
    name: string;
    desc: string;
    hidden: boolean;
    locked: boolean;
  }[];
}

/** K01：技能某一级的一条效果。`live` 为假时不生效（世界没打开技能效果，或这种效果暂无读取点）；
 *  `capped` 只出现在生效中的那一级：同类效果合计超过叠加上限时的实得（数据里的数，百分数未折算）。 */
export interface SkillEffectLine {
  kind: string;
  text: string;
  live: boolean;
  capped: number | null;
}
/** K01：生效中的这一级（`now`，0 级时为空）与下一级（`next_level` 为空表示已到最高一级）。 */
export interface SkillEffectsView {
  enabled: boolean;
  now: SkillEffectLine[];
  next_level: number | null;
  next: SkillEffectLine[];
}

export interface UpbringingView {
  stage: "home" | "academy";
  stage_name: string;
  home: string;
  /** 养成所在地的文化：学院期是学院的文化，家乡期是家乡的文化（旧后端也给，原来没写进类型） */
  culture?: string | null;
  /** 这一阶段所在的城市（家乡期是家乡港，学院期是学院所在的城市）：地点 key、显示名与地图上的文化；旧后端没有 */
  town?: { key: string; name: string; culture: string } | null;
  academy: AcademyRef | null;
  today: WorldDate;
  /**
   * 按周播放的世界（寰宇，P10）：今天所在的这一周——月内第几周与首末日（都含在这一周里；最后一周到月末为止）。
   * 时钟每过完一周停一下，等玩家开始下一周。不按周播放的世界、养成结束后与旧后端没有这一项。
   */
  week?: {
    number: number;
    from: WorldDate;
    to: WorldDate;
    /** U05 按周排程：本月共几周（固定 4，第 4 周到月末）与本月天数；按旬的世界没有 */
    count?: number;
    month_days?: number;
  } | null;
  phase: "plan" | "running" | "graduation" | "done";
  protagonist: {
    key: string;
    name: string;
    age: number;
    birthday: [number, number];
    portrait: string | null;
    outfit: string | null;
    season: 0 | 1 | 2 | 3;
  };
  meters: { stamina: Meter; fatigue: Meter; mood: Meter; fame: Meter };
  cash: number;
  growth: { attr: string; value: number; projected: number }[];
  ratings: { key: string; name: string; value: number; rank: string }[];
  skills: {
    key: string;
    name: string;
    level: number;
    xp: number;
    next: number;
    /** K01：技能的效果（没有效果数据的技能没有这一项） */
    effects?: SkillEffectsView;
  }[];
  plan: PlanView;
  lessons: ActivityView[];
  activities: ActivityView[];
  places: PlaceView[];
  excursions: ExcursionView[];
  companions: CompanionView[];
  calendar: CalendarMark[];
  exams: ExamView[];
  path: PathView;
  memories: {
    key: string;
    title: string;
    date: WorldDate;
    art: string | null;
    line: string;
  }[];
  letters: {
    key: string;
    from: string;
    from_name: string;
    sent: WorldDate;
    arrived: WorldDate;
    title: string;
    body: string;
    read: boolean;
    ai?: boolean;
  }[];
  diary: { month: [number, number]; text: string; ai?: boolean }[];
  presets: { key: string; name: string }[];
  last: SlotResult[];
  /** 身边的书（读书活动可选；done 表示已读完，再读没有收益） */
  books?: { key: string; name: string; days: number; done: boolean }[];
  /** 比赛（UI-CONTRACT I6 追加）：open 的可以玩小游戏，也可以按实力结算；prep 是准备的加成（百分点） */
  contests?: {
    key: string;
    name: string;
    kind: ContestView["kind"];
    date: WorldDate;
    status: "upcoming" | "open" | "done";
    prep: number;
    result: { rank: number; total: number; text: string } | null;
    /** U04：报名制（寰宇）。open 的比赛提前 30 天可报名；报了名才会在比赛日结算；junior 是少年组。旧后端没有这几项 */
    registered?: boolean;
    can_register?: boolean;
    days_left?: number;
    junior?: boolean;
  }[];
  /** U04 工作包 5：年度目标卡（旧后端没有） */
  goals?: UpbringingGoals | null;
  /** U04 工作包 4：这一局永远排不上的活动与课，折叠成计数（旧后端没有） */
  hidden_count?: number;
  hidden_lessons?: number;
  /** U04 工作包 4：最近开放的东西（旧后端没有） */
  unlocked_now?: UnlockedNow[];
  /** 结业以后（phase = done）：结局、另得的称号、差一点达成的结局与差项（U04 工作包 2；旧后端没有差项的显示名） */
  ending?: { key: string; title: string | null; text: string | null } | null;
  supplementary?: { key: string; title: string | null; text: string | null }[];
  near_miss?: {
    ending: string;
    title?: string | null;
    missing: { key: string; label?: string | null; have: number; need: number; max?: boolean }[];
  }[];
  /** R10-U06 行动制：只在行动制在跑时给（见 actTypes.ts）；没有时照旧画原来的养成画面 */
  act?: ActView | null;
  /** R10-U06：本家有行动制、但这是旧档（按旧规则走完）：提示“新玩法从新开的局开始” */
  act_old_save?: boolean;
}

/** PlanMonth 的一段。 */
export interface PlanSlotInput {
  index: number;
  lesson?: string | null;
  after?: AfterChoice | null;
}

export interface ContestView {
  key: string;
  name: string;
  kind: "match" | "poem" | "rhythm" | "debate" | "race" | "identify";
  seed: number;
  params: Record<string, unknown>;
  rivals: { key: string; name: string; portrait: string | null }[];
  auto_pct: number;
  /** U04：已经报名；还能报名（寰宇的比赛要报名才结算，旧后端没有这两项） */
  registered?: boolean;
  can_register?: boolean;
}

/** 小游戏的一步（作诗的一句、辩论的一回合、竞渡的一程）的加分：got 拿到的，best 这一步最多能拿的（都按加在实力上的分计）。 */
export interface ContestStep {
  got: number;
  best: number;
  /** 辩论：压过对方 1、平手 0、被压过 −1 */
  edge?: -1 | 0 | 1;
  /** 竞渡：这一程成功、失手各加几分，失手的概率（万分之几） */
  win?: number;
  lose?: number;
  risk?: number;
}

/** `contest_preview`：照现在的输入能加几分、约多少能赢（与结算同一套算法；没选的一步按 0 分算）。 */
export interface ContestPreview {
  /** 实力分（基础 + 属性 × 系数 + 准备 + 心情） */
  strength: number;
  max_bonus: number;
  /** 小游戏拿满时的加分 */
  best_bonus: number;
  /** 每配上一对 / 打准一拍 / 压过一回合 / 认对一份加几分（作者计分时才有） */
  unit: number | null;
  /** 现在的加分与胜算；辨识结算前不给（null），竞渡是按失手概率的期望 */
  bonus: number | null;
  pct: number | null;
  /** 不玩（按实力）与小游戏拿满时的胜算 */
  base_pct: number;
  best_pct: number;
  ready: boolean;
  steps: (ContestStep | null)[];
  /** 竞渡：正在选的这一程，每种走法成功 / 失手各加几分与失手的概率 */
  options: { key: string; win: number; lose: number; risk: number }[];
}

/** `contest_outcome`：已经结算的比赛，名次是怎么来的。 */
export interface ContestOutcome {
  rank: number;
  total: number;
  score: number;
  game_score: number | null;
  /** 主角的临场发挥（−10 到 10） */
  jitter: number;
  /** 小游戏的加分（按实力结算为 0；没给交卷时的输入为 null） */
  bonus: number | null;
  /** 结算时的实力分（总分碰到上下限时为 null） */
  strength: number | null;
  /** 名次表（第一名在前）；key 为 "$captain" 的是主角 */
  field: { key: string; name: string | null; score: number; you: boolean }[];
  /** 辨识：每份认得对不对、正确答案；竞渡：每一程失没失手 */
  steps: (
    | { correct: boolean; answer: string | null }
    | { failed: boolean; course: number }
  )[];
}

export interface EndingsView {
  endings: {
    key: string;
    title: string;
    text: string | null;
    got: boolean;
    family: string | null;
  }[];
}

// ───────────────────────────── 第九批：物品、装备、读书与图鉴（docs/UI-CONTRACT.md I4） ─────────────────────────────

export type ItemKind =
  | "weapon"
  | "sidearm"
  | "outfit"
  | "accessory"
  | "instrument"
  | "focus"
  | "book"
  | "consumable"
  | "gift"
  | "curio"
  | "chart"
  | "key";
export type EquipSlot =
  | "weapon"
  | "sidearm"
  | "outfit"
  | "accessory1"
  | "accessory2"
  | "instrument"
  | "focus";

export interface ItemBookInfo {
  category: string;
  category_name: string;
  lang: string | null;
  lang_name: string | null;
  days: number;
  read: boolean;
  can_read: "self" | "interpreter" | "translation" | "no";
  published: number | null;
}

export interface ItemLine {
  key: string;
  name: string;
  kind: ItemKind;
  rarity: 1 | 2 | 3 | 4 | 5;
  qty: number;
  equipped: number;
  icon: string;
  desc: string;
  lore: string | null;
  tags: string[];
  price: number;
  bonus: { attr: string; value: number }[];
  effects: { kind: string; text: string }[];
  set: string | null;
  book: ItemBookInfo | null;
  key_item: boolean;
  can_sell: boolean;
  can_give: boolean;
  can_use: boolean;
  basis?: string;
  sources?: string[];
}

export interface WearerView {
  key: string;
  name: string;
  portrait: string | null;
  slots: { slot: EquipSlot; item: string | null }[];
  attrs: { attr: string; base: number; equipped: number }[];
}

export interface InventoryView {
  items: ItemLine[];
  wearers: WearerView[];
  reading: {
    book: string;
    name: string;
    done_days: number;
    total_days: number;
    mode: "self" | "interpreter" | "translation";
  } | null;
  bibliography: {
    read: number;
    categories: { key: string; name: string; count: number }[];
    recent: { key: string; name: string; on: WorldDate }[];
  };
  sets: {
    key: string;
    name: string;
    items: string[];
    have: number;
    bonus: string;
    done: boolean;
  }[];
  gifts: { count: number; value: number; kinds: number };
  collection_value: number;
}

export interface ShopView {
  loc: number;
  name: string;
  restock: WorldDate;
  offers: {
    item: string;
    stock: number;
    price: number;
    line: ItemLine;
    enabled: boolean;
    blocked_reason?: string;
  }[];
  sell_bp: number;
}

export interface CodexView {
  categories: { key: string; name: string; got: number; total: number }[];
  category: string;
  entries: {
    key: string;
    name: string;
    state: "unknown" | "seen" | "got";
    icon: string | null;
    desc: string | null;
    basis: string | null;
    sources: string[];
    changed: string | null;
  }[];
}

// ───────────────────────────── 第九批：拍卖会（docs/UI-CONTRACT.md I9） ─────────────────────────────

export interface AuctionSummary {
  key: string;
  name: string;
  loc: number;
  loc_name: string;
  opens_on: WorldDate;
  closes_on: WorldDate;
  days_left: number;
  status: "upcoming" | "preview" | "open" | "closed";
  lots: number;
  headline: string | null;
}

export interface AuctionLot {
  key: string;
  line: ItemLine;
  qty: number;
  status: "waiting" | "bidding" | "sold" | "passed" | "withdrawn";
  reserve: number;
  increment: number;
  current: number | null;
  leader: { key: string; name: string; you: boolean } | null;
  next_min: number;
  bidders: {
    key: string;
    name: string;
    portrait: string | null;
    active: boolean;
    mood: string | null;
  }[];
  inspection: {
    done: boolean;
    verdict: "genuine" | "fake" | "unsure" | null;
    note: string | null;
    can_inspect: boolean;
    blocked_reason?: string;
  };
  winner: { key: string; name: string; you: boolean; price: number } | null;
  after_loss: string | null;
  enabled: boolean;
  blocked_reason?: string;
}

export interface AuctionView extends Omit<AuctionSummary, "lots"> {
  here: boolean;
  lots: AuctionLot[];
  cash: number;
  log: { lot: string; text: string }[];
}

// ───────────────────────────── 第九批：时间线、战役链与编年史（docs/UI-CONTRACT.md I7） ─────────────────────────────

export type Known = "exact" | "rough" | "unknown";

export interface LeverView {
  key: string;
  side: string;
  kind: string;
  label: string;
  where: string | null;
  goods: { good: number; name: string }[];
  progress: { points: number; max: number };
  yours: number;
  risk: string | null;
  note: string | null;
  action: "deliver" | "money" | "commit" | "goto" | null;
  enabled: boolean;
  blocked_reason?: string;
}

export interface TimelineEvent {
  key: string;
  title: string;
  summary: string;
  region: string | null;
  date: WorldDate | null;
  window: [WorldDate, WorldDate] | null;
  days_left: number | null;
  status: "future" | "active" | "resolved";
  campaign: string | null;
  sides: { key: string; name: string; color: string | null }[];
  balance: { lo: number; hi: number; known: Known } | null;
  levers: LeverView[];
  why_hard: string[];
  outcome: {
    key: string;
    text: string;
    historical: boolean;
    history: string;
  } | null;
  basis: string | null;
  sources: string[];
}

export interface TimelineView {
  events: TimelineEvent[];
  deviation: number;
  history_on: boolean;
}

export interface CampaignView {
  key: string;
  name: string;
  summary: string;
  inertia: number;
  vars: {
    key: string;
    name: string;
    kind: "force" | "idea";
    court: string | null;
    value: { lo: number; hi: number; known: Known };
    baseline: number;
    drift: [number, number][];
    cap: number | null;
    gates: { event: string; name: string; passed: boolean | null }[];
  }[];
  events: {
    key: string;
    title: string;
    date: WorldDate | null;
    status: TimelineEvent["status"];
    outcome: string | null;
  }[];
  outlook: string | null;
}

export interface ChronicleView {
  entries: {
    date: WorldDate;
    text: string;
    history: string | null;
    deviates: boolean;
    /** I10：已结束年份的年度回顾（另一部编年史），排在当年最后；ai 为模型写的，否则是离线模板 */
    annual?: boolean;
    ai?: boolean;
  }[];
}

export type ContributePayload =
  | { Deliver: { fleet: number; goods: [number, number][]; donate: boolean } }
  | { Money: { amount: Money } }
  | { Negotiate: { term: string } }
  | { Commit: Record<string, never> };

// ───────────────────────────── 第九批：结社、秘术、信仰与思想、传说之船与秘境（docs/UI-CONTRACT.md I8） ─────────────────────────────

export interface SocietyView {
  key: string;
  name: string;
  secrecy: number;
  known: "rumor" | "met" | "member";
  rank: number | null;
  rank_name: string | null;
  ranks: {
    n: number;
    name: string;
    requirement: string;
    reward: string;
    done: boolean;
  }[];
  trial: { track: string; text: string } | null;
  allies: string[];
  enemies: string[];
  seat: string | null;
  basis: string | null;
  sources: string[];
  active: string | null;
  can_join: boolean;
  blocked_reason?: string;
}

export interface SocietiesView {
  societies: SocietyView[];
  suspicion: { faction: number; name: string; value: number; level: string }[];
}

export type SpellTarget = "self" | "fleet" | "port" | "event" | "rumor";

export interface ArcanaView {
  schools: {
    key: string;
    name: string;
    level: number;
    basis: string | null;
    sources: string[];
  }[];
  spells: {
    key: string;
    name: string;
    school: string;
    rank: number;
    desc: string;
    cost: string;
    cooldown_left: number;
    targets: SpellTarget[];
    enabled: boolean;
    blocked_reason?: string;
    source: string | null;
  }[];
}

export interface IdeasView {
  loc: number;
  /** 港名；没到过的港（none = "unvisited"）不给名字 */
  name: string | null;
  /** 这座港没有这一页可看（HOTFIX2）：还没到过（unvisited），或这里没有记载（none）。这时 shares、modes 为空 */
  none?: "none" | "unvisited";
  /** none 时：到过的、有记载的港（界面指路用） */
  ports?: { id: number; name: string }[];
  /** FIX5（后端合入前没有）：人不在这座港（到过、有记载）。这时 shares 不给；能远程做的传播方式照旧在 modes 里 */
  away?: boolean;
  shares: { idea: string; name: string; share: number; delta_year: number }[];
  modes: {
    mode: "mission" | "print" | "school" | "charity" | "court" | "protect";
    idea: string;
    label: string;
    needs: string[];
    points: number;
    cap: number;
    enabled: boolean;
    blocked_reason?: string;
  }[];
  hostility: string | null;
}

export interface LegendShipsView {
  ships: {
    key: string;
    name: string;
    hull: string;
    traits: { key: string; name: string; text: string }[];
    state: "rumor" | "known" | "blueprint" | "owned" | "lost";
    lore: string;
    acquire: string | null;
    basis: string | null;
    sources: string[];
    can_commission: boolean;
    blocked_reason?: string;
  }[];
}

export interface RealmsView {
  realms: {
    key: string;
    name: string;
    state: "unknown" | "heard" | "veil_found" | "entered" | "open";
    hint: string | null;
    key_items: { item: string; name: string; have: boolean }[];
    /** A11 任选钥匙：组间任选、组内全部满足；故事线没开始时 name 为 null，旗标条件只并进 met */
    key_any: {
      items: { item: string; name: string; have: boolean }[];
      tracks: { name: string | null; done: boolean }[];
      met: boolean;
    }[];
    rules: string[];
  }[];
}

export type SpellTargetInput =
  "Self" | { Fleet: number } | { Port: number } | { Event: string };

// ───────────────────────────── 第九批：地图资源、迷雾增量与手动航行（docs/UI-CONTRACT.md I3） ─────────────────────────────
// 以下用接口合并给已有的 MapView、FleetView、Overview 追加可选字段（旧后端、经典世界都没有这些字段）；
// 手动航行的命令另起 NavCommand，并入 Command 联合类型的末尾。

/** 等距圆柱投影（角分；内核不碰浮点）：第 0 列左缘的经度、第 0 行上缘的纬度、每格的角分。 */
export interface MapProjection {
  kind: "equirect";
  /** 第 0 列左缘的经度（角分，西经为负；-10800 即 180°W） */
  west: number;
  /** 第 0 行上缘的纬度（角分，北纬为正；4320 即 72°N） */
  north: number;
  arcmin_per_cell: number;
}

/** 大地图的图层（map_resource，按 hash 永久缓存）。字符集同经典的 map.txt / relief.txt / biomes.txt。 */
export interface MapResource {
  key: string;
  hash: string;
  width: number;
  height: number;
  /** 东西相连：x 坐标按 width 取模 */
  wrap_x: boolean;
  /** 南北方向一格的公里数 */
  cell_km: number;
  projection: MapProjection | null;
  rows: string[];
  relief: string[] | null;
  biomes: string[] | null;
  /** 每格的海区编号（base36 一位；没有海区为 ' '） */
  /** 每格的海区编号：u16 小端、行优先（下标 y·W + x），0 表示没有海区，base64；约 75 个海区，单个字符装不下（UI-CONTRACT I3）。 */
  seas: { encoding: "u16le-base64"; data: string } | null;
}

/**
 * 细图层（map_fine，第九批 M01“细海图”）：细海岸、细高程、细河流三个二进制文件原样下发（base64），只给显示用，
 * 由 map/fineLayers.ts 解码。没有细图层的地图（经典世界）三项为 null、cells 为 0，海图照原来的画法。
 */
export interface MapFineResource {
  key: string;
  /** 三个文件内容的哈希；没有细图层时为空串 */
  hash: string;
  /** 每粗格的细分数（24）；没有细图层时为 0 */
  cells: number;
  coast: string | null;
  elevation: string | null;
  rivers: string | null;
}

/** StaticView.map 的追加：第九批的世界只给尺寸、key、hash 与 wrap_x，external 为 true 时 rows 为空、图层另取。 */
export interface MapView {
  key?: string;
  hash?: string;
  wrap_x?: boolean;
  external?: boolean;
}

/** 迷雾增量（fog_delta）：epoch 换了或 since 太旧时给全量位图，否则给自 since 以来新揭开的行区间。 */
export interface FogDelta {
  /** 换了对局或读档就换 */
  epoch: string;
  /** 迷雾的版本（= Overview.fog_version） */
  rev: number;
  /** 全量：按行优先的位图（下标 y·width + x），每格一位（字节内低位在前），base64；增量时为 null */
  full: string | null;
  /** 增量：[行, 起始列, 结束列（含）]——新揭开的格 */
  runs: [number, number, number][];
}

/** 帆：满帆、半帆、收帆（停船）。 */
export type SailSetting = "full" | "half" | "furled";

/** 当天会停下或自动暂停的时刻。 */
export interface NavStop {
  /** 从当天 6:00 起的分钟 */
  minute: number;
  /** supplies_low（FIX5，后端合入前没有）：自动航行途中粮或水快见底，同一程只停一次；文字照旧由后端给 */
  kind: "land" | "port" | "storm" | "sight" | "storm_ahead" | "fog_ahead" | "overtaken" | "sighting" | "fog_bound" | "supplies_low";
  loc: number | null;
  text: string;
}

/** H03：航行视图里画出来的天气团（格坐标；当天不动）。 */
export interface NavCell {
  kind: "storm" | "squall" | "fog";
  x: number;
  y: number;
  /** 半径（格） */
  r: number;
  /** 移动方向（风的去向，0–359） */
  dir: number;
  id: string;
}

/** H03：视野里的别的船。kind 为 "sail" 时只是帆影（远于视野 2/3，看不出是谁）。 */
export interface NavShip {
  id: string;
  kind: "sail" | "merchant" | "pirate" | "own";
  /** 几艘船（帆影为 0） */
  size: number;
  /** 当前分钟的位置（格坐标） */
  x: number;
  y: number;
  /** 按分钟追击的海盗：当天的航迹（每 15 分钟一点） */
  track: [number, number][];
  /** 走航线的船：日初与预计日末的位置，前端按分钟插值 */
  from?: [number, number];
  to?: [number, number];
  heading: number;
  /** 正在追你 */
  chasing: boolean;
  /** H06：1.5 格以内、能喊话时给：对象与能做的事 */
  hail?: NavHail;
}

/** H06：喊话的对象。 */
export type HailTargetKey = { fleet: number } | { pirate: number };
/** H06：喊话的选项。 */
export type HailActionKey = "news" | { supplies: number } | "convoy" | "bribe" | "bluff" | "fight";

/** H06：对一条船能做的事（cost 金币；chance 虚张声势的成算 %；used 今天已经做过）。 */
export interface NavHail {
  target: HailTargetKey;
  options: { action: HailActionKey; used: boolean; cost?: number; days?: number; chance?: number; active?: boolean }[];
  last: { day: number; fleet: number; target: HailTargetKey; action: HailActionKey; ok: boolean; cost: number } | null;
}

/** 能自动驶往的地方；days 为 null 表示“开到已知海域的边缘”。 */
export interface NavDest {
  loc: number;
  name: string;
  days: number | null;
  /** H10b 的按需清单才有：只能开到已知海域的边缘 */
  edge?: boolean;
  /** FIX5（后端合入前没有）：这支船队现有粮水够几天（同 navigation.supplies_days），界面好在出发前比 */
  supplies_days?: number | null;
  /** R10-FIX8：这支舰队此刻去不了这座港（名船的禁港、王国的进港限制……）：原因码与出好的字，与真去时被拒的是同一句 */
  blocked?: { code: string; text: string } | null;
}

/** H10b 的按需目的地清单（navigation_dests）。 */
export interface NavDestsView {
  fleet: number;
  day: number;
  from: [number, number];
  rev: string;
  dests: NavDest[];
}

/** 航行视图（navigation）：舰队在海上、手动航行的世界才有。 */
export interface NavView {
  fleet: number;
  mode: "route" | "manual";
  /** 结算到哪一天、当天从 6:00 起第几分钟（应用层的时钟） */
  day: number;
  minute: number;
  /** 格坐标（小数，1/256 格的精度） */
  pos: { x: number; y: number };
  /** 0–359，0 为正北，顺时针 */
  heading: number;
  sail: SailSetting;
  /** 节（显示用） */
  speed: number;
  /** 风从哪里来（0–359）、风力 0–12、名字（“西北风 4 级”） */
  wind: { dir: number; force: number; name: string };
  /** 洋流的去向（0–359）与流速（节） */
  current: { dir: number; speed: number } | null;
  /** 这艘船能逆风到的最小夹角（度） */
  sail_limit: number;
  /** 今天已经走过的点（格坐标） */
  trail: [number, number][];
  /** 照现在的舵与帆，今天剩下的航迹（预测就是结果） */
  forecast: [number, number][];
  stops: NavStop[];
  /** 现有粮水能完整撑几天；没有船员时为 null（V01） */
  supplies_days: number | null;
  morale: number;
  /** 视野半径（格） */
  sight: number;
  /**
   * 自动航行。H10h（后端合入前一律可选）：`mode` 帆行 / 慢行（逆风落帆、保底慢慢走）/ 等风；`mode_since` 进入这个状态的时刻；
   * `eta_days` 与出航预览同一个算法，等风时为 null。
   */
  autopilot: {
    dest: number;
    dest_name: string;
    eta_days: number | null;
    mode?: NavAutopilotMode;
    mode_since?: { day: number; minute: number };
  } | null;
  /** H10h：海上奇遇等原因的延误（延误期间 speed 为 0）；没有时为 null。旧后端没有这个字段 */
  delay?: { kind: string; until: { day: number; minute: number } } | null;
  known_dests: NavDest[];
  /** “北纬 38°42′ 西经 9°08′” */
  lat_lon: string | null;
  /** H01：看见别的舰队的距离（格；H03 画帆影用） */
  ship_sight?: number;
  /** H02：船况与船员状态（规则关着时没有） */
  wear?: WearView;
  /** H05：岸与锚地（规则关着时没有） */
  shore?: ShoreView;
  /** H03：船所在处的天况（天气团开着时是位置天况） */
  sky?: "clear" | "cloudy" | "rain" | "fog" | "storm" | "snow" | null;
  /** H03：视野 × 2 以内的天气团 */
  cells?: NavCell[];
  /** H03：视野里的别的船 */
  ships?: NavShip[];
  /** H03：当前帆型、当前风下最快的航向（风轴两侧各一个） */
  fast?: number[];
  /** H04：海上所见（开关关着时为 null） */
  sightings?: NavSightings | null;
  /** H08：航海日志（这一程的条目；开关关着时为 null） */
  journal?: {
    start_day: number;
    from: string | null;
    distance: number;
    entries: { day: number; cat: "weather" | "sight" | "decision" | "loss" | "port"; kind: string; args: [string, string][]; text?: string }[];
  } | null;
  /** H08：甲板闲话（今天这一句；没有时为 null） */
  banter?: { id: string; speaker: string | null; text: string; reply: { label: string; answer: string } | null; replied: boolean } | null;
}

/** H10h 自动航行的状态：帆行、慢行（逆风落帆慢慢走）、等风。 */
/** H10i 多一个抢风 `beat`：顶风时领航照平均航向直走（舵向记成朝瞄准点的方位，落在逆风禁区里是正常的），速度按抢风折算；旧后端没有这个值。 */
export type NavAutopilotMode = "sail" | "creep" | "wait" | "beat";

export type SightKind ="flotsam" | "wreck" | "castaway" | "birds" | "shoal" | "fishing" | "weed" | "ice" | "reef";

/** H04：海上所见——图上的小标记、碰上了等选的小卡片、刚结算的结果。 */
export interface NavSightings {
  marks: { id: number; kind: SightKind; x: number; y: number; title: string; hazard: boolean; touched: boolean }[];
  /** harm：结果是吃了亏的（受损、扣粮水或士气），卡片上用偏红的字 */
  card: { id: number; kind: SightKind; title: string; text: string; hazard: boolean; result: string | null; harm?: boolean; options: string[] } | null;
  last: { id: number; title: string; text: string; harm?: boolean } | null;
}

/** 还没提交的操舵（preview_course 的输入）。 */
export interface SteerInput {
  minute: number;
  heading?: number;
  sail?: SailSetting;
}

/** 预测（preview_course）：点是 [x, y, minute]。 */
export interface CoursePreview {
  points: [number, number, number][];
  stops: NavStop[];
}

/** FleetView 的追加：手动航行时的小数坐标与航向。 */
export interface FleetView {
  pos?: { x: number; y: number };
  heading?: number;
  /** H02：在港买船材、刮船底要看的几项（规则关着的世界没有） */
  wear?: PortWearView;
}

/** H02：舰队页的船材与船底。 */
export interface PortWearView {
  timber: number;
  timber_cap: number;
  timber_price: number;
  /** 船底附着 0–100 */
  fouling: number;
  /** 刮一次船底的费用 */
  scrape_cost: number;
}

/** Overview 的追加：看见过的地点（hide_unknown_ports 的世界；没看见的地点前端不画、不能选作目的地）。 */
export interface Overview {
  sighted?: number[];
  /** 手动航行中途自动暂停的原因（停着、时钟正好停在那一分钟时才有；继续航行或换了时刻就没有） */
  navigation_stop?: NavigationStopView | null;
}

/** 自动暂停的那一处（NavStop 加上日期与舰队）。 */
export interface NavigationStopView extends NavStop {
  day: number;
  fleet: number;
}

/**
 * Overview 的追加（11-03 在港暂停与旅店）：手动航行的世界、养成期之外，旗舰队停在港口时时间不走（倍速控件变灰），
 * 只有在旅店休息才过天，出港后按 resume 继续；awaiting 是在等玩家回应的事（手动推进与旅店休息遇到就停下）。
 */
export interface Overview {
  port_hold?: PortHoldView | null;
  awaiting?: AwaitingKind | null;
}

/** 在港中：旗舰队停在哪个港口、出港后按哪一档继续（倍速）、住到下月初要几天。 */
export interface PortHoldView {
  loc: number;
  resume: number;
  month_days: number;
}

/** 在等玩家回应的事：养成的回顾与安排 / 待决海战 / 刚出现的剧情事件或奇遇。 */
export type AwaitingKind =
  "upbringing" | "battle" | "story";

/** 手动航行的命令（UI-CONTRACT I3；经典世界 route 里被拒绝）。minute 是从当天 6:00 起的分钟。 */
export type NavCommand =
  | {
      Steer: P<{
        fleet: number;
        minute: number;
        heading?: number;
        sail?: SailSetting;
      }>;
    }
  | { Depart: P<{ fleet: number; minute: number; heading: number }> }
  | {
      Autopilot: P<{
        fleet: number;
        dest: number;
        minute: number;
        stop_at_known_edge?: boolean;
        /** H07 寻路偏好（ipc/routing.ts 的 RoutePref）；不写时按缺省 */
        route?: "distance" | "fastest" | "safe" | "coastal";
      }>;
    }
  | { Landing: P<{ fleet: number; days: number }> }
  /** H02：常设命令与港口里的几件事（改常设命令、买船材、刮船底、抛货） */
  | { Voyage: P<{ fleet: number; order: VoyageOrder }> }
  | { Shore: P<{ fleet: number; order: ShoreOrder }> };

/** H02 的口粮、节奏与常设命令（内核 seafaring::wear::StandingOrders）。 */
export type Rations = "full" | "reduced" | "half";
export type Pace = "easy" | "normal" | "hard";
export interface StandingOrders {
  rations: Rations;
  pace: Pace;
  /** 下面三项缺省开着（后端只在关掉时写出来） */
  auto_reef?: boolean;
  auto_repair?: boolean;
  /** 粮水低于几天时提醒并暂停（0 = 不提醒；缺省 7） */
  supply_alert?: number;
}
export type VoyageOrder =
  | { set_orders: StandingOrders }
  | { buy_timber: { qty: number } }
  | "scrape"
  | { jettison: { good: number; qty: number } }
  /** 按比例抛货：从最不值钱的货抛起，抛掉全部货物件数的 pct% */
  | { jettison_share: { pct: number } };

/** H05 岸上差事（内核 seafaring::shore::ShoreTask）。 */
export type ShoreTask = "water" | "forage" | "timber" | "careen";

/** H05 差事做不了的原因（内核 ShoreBlock）。 */
export type ShoreBlock = "no_coast" | "unknown" | "no_fresh_water" | "no_forage" | "no_forest" | "no_beach" | "no_wear" | "full" | "hands";

/** H05 `Command::Shore` 的内容。 */
export type ShoreOrder = { start: { tasks: ShoreTask[] } } | "recall" | { nets: { on: boolean } };

/** H05 此地的一件差事：要多少人、几天、预计所得（水、粮是件数，船材是份数，倾船刮底是附着点数），做不了的带原因。 */
export interface ShoreOptionView {
  task: ShoreTask;
  hands: number;
  days: number;
  gain: number;
  block: ShoreBlock | null;
}

/** H05 航行视图的岸与锚地。 */
export interface ShoreView {
  /** 离陆地 1 格以内 */
  coast: boolean;
  /** 两格内有河 */
  river: boolean;
  /** 周围陆格的地貌代码（biomes.txt 的单字符） */
  biomes: string[];
  options: ShoreOptionView[];
  /** 正在做的差事（没有时为 null） */
  camp: { elapsed: number; days: number; jobs: { task: ShoreTask; days: number; hands: number }[] } | null;
  /** 下了网；nets_working：半帆或收帆、网真在捞 */
  nets: boolean;
  nets_working: boolean;
  /** 下网一天的渔获：够全船吃一天的百分之几 */
  fish: number;
  /** 收帆锚泊着 */
  anchored: boolean;
  /** 锚地在陆地的下风一侧（收帆时暴风雨损伤只剩 shelter_keep%） */
  lee: boolean;
  shelter_keep: number;
}

/** H02：航行视图的船况状态区（规则关着的世界没有这一项）。 */
export interface WearView {
  /** FIX5（后端合入前没有）：自动航行中、由内核按常设命令的粮水警戒线停一次（同一程只停一次，停因 supplies_low）时为 true */
  alert_by_pilot?: boolean;
  /** 船体（耐久 / 最大耐久，百分比，取最差的一艘） */
  hull: number;
  /** 帆缆 0–100（100 为完好） */
  rigging: number;
  /** 船底附着 0–100（0 为干净） */
  fouling: number;
  crew: number;
  sick: number;
  fatigue: number;
  fresh_days: number;
  /** 断鲜超过多少天开始出病号 */
  scurvy_after: number;
  timber: number;
  timber_cap: number;
  /** 载重减速的百分点 */
  load_slow: number;
  /** H02 的航速乘数（百分比，100 为不变） */
  speed_pct: number;
  /** 正在怠工 */
  slowdown: boolean;
  /** 答应船员靠港的最后一天（没有时为 null） */
  promise_until: number | null;
  /** FIX6：答应靠港的最后一天的日历日期 [纪年年份, 月, 日]（旧后端不给） */
  promise_date?: WorldDate | null;
  orders: StandingOrders;
  /** 船上的货物件数（不含粮水；抛货按钮看它） */
  cargo?: number;
  /** 规则里的几个阈值（界面上色用） */
  tired: number;
  exhausted: number;
}

// ───────────── 第九批 I10：AI 增强（docs/UI-CONTRACT.md I10） ─────────────

/** 自由对话的一句：内核裁决的结果写在 effects（数值不由模型决定）。 */
export interface ChatTurn {
  seq: number;
  who: "you" | "them";
  text: string;
  /** pending：等模型回复；fallback：模型失败或超预算，换成离线模板的回答 */
  status: "pending" | "done" | "fallback";
  effects: { kind: "affinity" | "heart" | "topic" | "request"; text: string }[];
}

/** 人物详情的自由对话入口（AI 关着时为 null，只有菜单）。 */
export interface PersonChatInfo {
  enabled: boolean;
  blocked_reason?: string;
  left_today: number;
}

export interface PersonDetail {
  chat?: PersonChatInfo | null;
}

export interface Overview {
  /** 正在进行的自由对话（模型的回复异步到达时随概览推回） */
  chat?: { person: string; seq: number; turns: ChatTurn[] } | null;
}

export interface TimelineEvent {
  /** AI 写的时间线叙事（开场、进展、结局）；没有时不显示 */
  narration?: {
    opening: string | null;
    progress: string | null;
    ending: string | null;
  } | null;
}

export type AiCommand = {
  TalkFree: { owner: string; person: string; text: string };
};

// ───────────── 第十轮 Q01 / Q02：任务视图（docs/tasks/R10-Q01.md 契约 4） ─────────────
// 后端只给“种类 + 参数”，句子由前端按种类出字（components/people/questKit.ts）。后端没开 quests 时这些字段都不出现，
// 界面照旧用 TrackView 画（降级）。

export type QuestKind = "main" | "guide" | "character" | "request" | "history" | "contract" | "annual_goal";
export type QuestStatus = "active" | "waiting" | "done" | "failed" | "missed";
export type QuestPhase = "upbringing" | "voyage";

/** 任务里点到的地点：hide_unknown_ports 且玩家还看不见时 loc 与 label 都是 null（不泄露）。 */
export interface QuestPlace {
  loc: number | null;
  label: string | null;
  known: boolean;
}

export type QuestRowKind =
  // 旧目标种类
  | "deliver"
  | "item"
  | "at"
  | "person"
  | "affinity"
  | "cash"
  | "fame"
  | "wait"
  | "battle"
  | "discovery"
  | "attr"
  | "growth"
  | "skill"
  | "bond"
  // Q01 新增
  | "visited"
  | "ports_known"
  | "house_level"
  | "warehouse"
  | "industries"
  | "ships"
  | "ship_tier"
  | "mates"
  | "post"
  | "rank"
  | "deed"
  // Q01b：“任一”——父行本身没有参数，分支在 any 里，任一做成即可
  | "any";

/** 自动结算失败的原因码（Q01b，`QuestView.failure`；只有 status = failed 的故事条目给）。 */
export type QuestFailure = "window_unmet" | "timeout_missing" | "default_missing" | "settle_failed" | "other";

export interface QuestRowParams {
  good?: string;
  qty?: number;
  item?: string;
  person?: string;
  ge?: number;
  days?: number;
  wins?: number;
  discovery?: string;
  reported?: boolean;
  attr?: string;
  skill?: string;
  level?: "C" | "B" | "A" | "S";
  industry?: string;
  post?: string;
  deed?: string;
  since_entered?: boolean;
}

/**
 * 显式目标行（章节 objectives / 委托交货 / 年度目标条件）。`crates/manifest-appcore/src/quest_view.rs` 的 `ObjectiveRow`。
 * have / need：计数型给原数；“是否”型给 0/1；bond 按 C=1 B=2 A=3 S=4；deed 的 have 是入章后的差或总数；wait 的 have 是入章后过去的天数。
 * ship_tier、rank 的 ge 从 0 数（船价分档 0–4、货档 0 粗货 … 3 珍货）。
 */
export interface QuestRow {
  kind: QuestRowKind;
  params: QuestRowParams;
  /** 当前语言的显示名：good / item / person / faction / discovery / industry / post / attr / skill（找不到时为 null） */
  labels: Record<string, string | null>;
  place: QuestPlace | null;
  have: number;
  need: number;
  done: boolean;
  /** 数据里写的 objective.text；没有为 null（any 的分支一律 null） */
  text: string | null;
  /** kind = "any" 时的各个分支（2–6 条，不嵌套）；别的种类后端不发这个字段 */
  any?: QuestRow[];
}

/** 由 at、日期、期限换算出的隐式行。go_to 的地点键在数据里找不到时 place 为 null；days_left 的 days 理论上可能为 null。 */
export type QuestImplicitRow =
  | { kind: "go_to"; place: QuestPlace | null; done: boolean }
  | { kind: "wait_until"; date: WorldDate; days: number }
  | { kind: "days_left"; date: WorldDate; days: number | null };

/** 去哪儿：港口 / 养成场所 / 面板；人已在地方、只差日子时给 wait_until。 */
export interface QuestGo {
  port: QuestPlace | null;
  place: string | null;
  panel: string | null;
  wait_until: WorldDate | null;
}

export type QuestReward =
  | { kind: "cash"; value: number }
  | { kind: "fame"; value: number }
  | { kind: "reputation"; faction: string; label: string | null; value: number }
  | { kind: "item"; item: string; label: string | null; qty: number }
  | { kind: "chart"; region: string; label: string | null }
  | { kind: "skill"; skill: string; label: string | null; value: number }
  | { kind: "growth"; attr: string; label: string | null; value: number }
  | { kind: "join"; person: string; label: string | null }
  | { kind: "memory" }
  | { kind: "penalty"; value: number };

export interface QuestView {
  /** "track:<轨道key>" | "contract:<合同编号>" | "goal:<年度目标key>" */
  id: string;
  kind: QuestKind;
  status: QuestStatus;
  phase: QuestPhase;
  /** 轨道名；委托与年度目标为 null（前端按种类出字） */
  title: string | null;
  chapter_title: string | null;
  hint: string | null;
  teaches: string[];
  rows: QuestRow[];
  implicit: QuestImplicitRow[];
  go: QuestGo | null;
  rewards: QuestReward[];
  rewards_hidden: boolean;
  rewards_vary: boolean;
  deadline: WorldDate | null;
  days_left: number | null;
  /** 是不是追踪条上那一条（自动挑的也是 true；看 StoryLog.pinned_auto 分手动 / 自动） */
  pinned: boolean;
  /** 没办成的原因（Q01b；只有 failed 的故事条目给，其余为 null；旧后端没有这个字段） */
  failure?: QuestFailure | null;
}

/** story_log 的返回：tracks 不变，quests.enabled 开着时追加 quests / pinned / pinned_auto。 */
export interface StoryLog {
  tracks: TrackView[];
  quests?: QuestView[];
  pinned?: string | null;
  pinned_auto?: boolean;
}

/** 概览里的置顶任务摘要（追踪条、顶栏菜单、地图标记读它）。 */
export interface QuestPin {
  id: string;
  kind: QuestKind;
  phase: QuestPhase;
  title: string | null;
  hint: string | null;
  /** 第一条没完成的显式行；全完成了取第一条隐式行（不管它做没做完，可能是“人已在某地”的 go_to）；都没有为 null */
  row: QuestRow | QuestImplicitRow | null;
  progress: { done: number; total: number };
  /** 章节的 go；go 没写港口时后端沿用章节的 at（Q01b） */
  go: QuestGo | null;
  days_left: number | null;
  /** true：没有手动置顶，后端按“当前期的引导 → 主线（眼下能出场、期限近的在前）→ 委托 → 年度目标”自动挑的 */
  auto: boolean;
}

export interface Overview {
  /** 置顶任务（quests 关着或没有在办任务时没有） */
  quest_pin?: QuestPin;
}

// ── E03 港口阶段开东西（views.rs：StageUnlockView、RareRowView 等）；旧后端都没有，一律可选 ──

/** 发展度阶段到了开什么：kind 取 shop / shelf / books / agency / industry / yard / goods / eligible。 */
export interface StageUnlockView {
  stage: number;
  kind: string;
  /** eligible 时是 academy / auction / exchange */
  key?: string;
  /** goods 时是货物编号 */
  good?: number;
  n: number;
  reached: boolean;
}

export interface DevGrowthView {
  /** 每一档开什么，按档排（规则关着、不是港口时为空） */
  unlocks?: StageUnlockView[];
}

/** 隐秘货在行情里的附加信息。 */
export interface RareRowView {
  producer?: number | null;
  cells: number;
  peak: Money;
  sat_bp?: number;
  /** 本月余量（只在产地给） */
  left?: number;
}

export interface MarketRow {
  rare?: RareRowView | null;
}

export interface GoodView {
  /** 隐秘货：没露面（不在 Overview.revealed 里）前不列出 */
  secret?: boolean;
  /** 隐秘货的风声原文（空时缺省） */
  rumor?: string;
}

export interface Overview {
  /** 已露面的隐秘货编号 */
  revealed?: number[];
}

export interface PortView {
  /** 这里现在生效的设施 */
  facilities?: string[];
  /** 这里能听到的隐秘货风声（货物编号） */
  rare_rumor?: number | null;
}

export interface AgencyView {
  /** 挂单位里来自港口阶段的张数（0 时缺省） */
  stage_bonus?: number;
}
