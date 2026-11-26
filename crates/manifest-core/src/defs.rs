//! 静态定义：由 `manifest-data` 从 `data/` 加载并校验后产出，内核只读。
//!
//! 代码中不写死任何内容名称；所有名称、数值都来自这里。

use crate::fixed::{Curve, Fx, Money};
use crate::ids::*;
use crate::nav::{NavTable, SeaMap};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// 全部静态数据。
#[derive(Clone, Debug)]
pub struct StaticData {
    /// 世界包与地图包身份；经典世界两者均为 classic。
    pub world_key: String,
    pub world_name: String,
    pub map_key: String,
    /// 世界日历；旧模块调用迁移在后续工作包实施。
    pub calendar: crate::calendar::Calendar,
    pub meta: DataMeta,
    pub rules: Rules,
    pub map: SeaMap,
    /// 细海岸（每粗格再细分；只有带细图层的地图有）：玩家手动航行的碰撞与领航用它，
    /// 航线表、出航寻路与 NPC 不看。没有细图层的世界为 None，一切照粗格走。
    pub fine_coast: Option<Arc<crate::nav::FineCoast>>,
    pub regions: Vec<RegionDef>,
    pub goods: Vec<GoodDef>,
    pub locations: Vec<LocationDef>,
    pub ships: Vec<ShipTypeDef>,
    pub refits: Vec<RefitDef>,
    pub factions: Vec<FactionDef>,
    /// 势力之间的基准关系（每对最多一条）
    pub relations: Vec<RelationDef>,
    pub companies: Vec<CompanyDef>,
    pub scenarios: Vec<ScenarioDef>,
    pub animals: Vec<AnimalDef>,
    pub roads: Vec<RoadDef>,
    pub industry_types: Vec<IndustryTypeDef>,
    pub recipes: Vec<RecipeDef>,
    pub exchanges: Vec<ExchangeDef>,
    pub futures_specs: Vec<FuturesSpecDef>,
    /// 事件类型（封闭集合）
    pub events: Vec<EventTypeDef>,
    /// 航海士
    pub mates: Vec<MateDef>,
    /// 殖民地建筑（`data/colony.toml`，可为空）
    pub colony_buildings: Vec<ColonyBuildingDef>,
    /// 发现物（`data/world/discoveries.toml`，可为空）
    pub discoveries: Vec<DiscoveryDef>,
    /// 地理图层（高程、植被、河流、地标；均可为空）：只存储并下发给视图，不参与航行计算
    pub geography: crate::geo::Geography,
    /// 港口之间按季节预计算的航线与寻路网格（由地图派生；同一地图在进程内共享）
    pub nav: Arc<NavTable>,
    /// 组合事件的效果词表与边界（`data/effects.toml`）
    pub composed: crate::composed::ComposedRules,
    /// 主角身世与属性（`data/captain.toml`；没有这个文件时为空）
    pub captain: crate::captain::CaptainDefs,
    /// 剧情事件：推荐角色的故事线与奇遇（`data/stories/*.toml`；没有这些文件时为空）
    pub stories: crate::story::StoryDefs,
    /// 个人物品定义；空表关闭整个模块。
    pub items: crate::items::ItemsDefs,
    pub auctions: crate::auction::AuctionDefs,
    pub cast: crate::cast::CastDefs,
    pub story2: crate::story2::Story2Defs,
    /// 手动航行的世界开关；经典世界保持关闭。
    pub manual_navigation: bool,
    pub navigation: crate::navigation::NavigationRules,
    pub history: crate::history::HistoryDefs,
    pub ideas: crate::ideas::IdeasDefs,
    pub societies: crate::societies::SocietiesDefs,
    pub legend_ships: crate::legend_ships::LegendShipsDefs,
    pub realms: crate::realms::RealmsDefs,
    pub lineages: crate::lineages::LineagesDefs,
    pub creatures: crate::creatures::CreaturesDefs,
    pub arcana: crate::arcana::ArcanaDefs,
    pub upbringing: crate::upbringing::UpbringingDefs,
    /// 地点按 key 排好序的次序，第一次用到时建（[`StaticData::find_loc`]）；只是查找用的缓存，见 [`crate::keyed`]。
    #[doc(hidden)]
    pub loc_order: crate::keyed::KeyOrder,
    /// E02：清单里的正供给按地点去重，开放市场补给前统计。
    pub good_sources: Vec<u16>,
    pub guide: crate::story2::guide_defs::GuideDefs,
    /// R10-T04：贸易距离向下取整到格；不可达为 u16::MAX。
    pub trade_dist: Vec<Vec<u16>>,
    /// E03：隐秘货的唯一作者产地，开放市场补给之前统计。
    pub rare_source: Vec<Option<LocId>>,
}

/// 事件效果：内核实现的封闭集合。每种效果需要的参数固定。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum EffectKind {
    /// 某商品在全部地点减产 / 增产（需要 good、mult、days）
    GoodSupply,
    /// 某商品在全部地点的需求变化（good、mult、days）
    GoodDemand,
    /// 某地某商品的产量变化（loc、good、mult、days）
    SupplyShift,
    /// 某地某商品的需求变化（loc、good、mult、days）
    DemandShift,
    /// 某地全部商品的产量变化（loc、mult、days）
    LocationSupply,
    /// 某地全部商品的需求变化（loc、mult、days）
    LocationDemand,
    /// 某地某商品流行（loc、good、days）
    Popularity,
    /// 海区风暴概率变化（region、mult、days）
    RegionStorm,
    /// 海区海盗概率变化（region、mult、days）
    RegionPirates,
    /// 两个势力的关系值变化（faction_a、faction_b、delta），状态转移仍由内核规则决定
    RelationShift,
    /// 某势力交易税变化（faction_a、mult、days）
    FactionTax,
    /// 港口发展度变化（loc、delta）
    Development,
    /// 贷款利率变化（mult、days）
    InterestShift,
    /// 产业效率变化（mult、days）
    IndustryEfficiency,
    // ── 以下为殖民扩展追加（只能在末尾追加）──
    /// 某殖民地某建筑（或全部建筑）的产量系数（loc 为殖民地所在的殖民点、可选 building、mult、days）
    ColonyOutput,
    /// 某殖民地的士气一次性变化（loc、delta）
    ColonyMorale,
    /// 某殖民地的人口增长与移民系数（loc、mult、days）
    ColonyGrowth,
    /// 某势力占领一处无主的殖民点（loc、faction_a），一次性
    SiteClaim,
    /// 某发现物的传闻：玩家情报中得知其大致海区，不直接揭开（discovery），一次性
    DiscoveryRumor,
    // ── 以下为势力的经济政策（ECONOMY.md 8.4，只能在末尾追加）──
    /// 某势力禁止运出某商品（faction_a、good、days）
    ExportBan,
    /// 某势力对运进来的某商品加征关税：卖出时交易税乘上系数（faction_a、good、mult、days）
    ImportTariff,
    /// 某势力对运出去的某商品加征出口税：买入时交易税乘上系数（faction_a、good、mult、days）
    ExportTariff,
    /// 某地某商品的产量补贴（loc、good、mult、days）
    Subsidy,
}

impl EffectKind {
    pub fn needs_loc(self) -> bool {
        use EffectKind::*;
        matches!(
            self,
            SupplyShift
                | DemandShift
                | LocationSupply
                | LocationDemand
                | Popularity
                | Development
                | ColonyOutput
                | ColonyMorale
                | ColonyGrowth
                | SiteClaim
                | Subsidy
        )
    }
    pub fn needs_good(self) -> bool {
        use EffectKind::*;
        matches!(
            self,
            GoodSupply
                | GoodDemand
                | SupplyShift
                | DemandShift
                | Popularity
                | ExportBan
                | ImportTariff
                | ExportTariff
                | Subsidy
        )
    }
    pub fn needs_region(self) -> bool {
        matches!(self, EffectKind::RegionStorm | EffectKind::RegionPirates)
    }
    pub fn needs_faction_a(self) -> bool {
        use EffectKind::*;
        matches!(self, RelationShift | FactionTax | SiteClaim | ExportBan | ImportTariff | ExportTariff)
    }
    pub fn needs_faction_b(self) -> bool {
        matches!(self, EffectKind::RelationShift)
    }
    pub fn needs_mult(self) -> bool {
        use EffectKind::*;
        !matches!(
            self,
            Popularity | RelationShift | Development | ColonyMorale | SiteClaim | DiscoveryRumor | ExportBan
        )
    }
    pub fn needs_days(self) -> bool {
        use EffectKind::*;
        !matches!(self, RelationShift | Development | ColonyMorale | SiteClaim | DiscoveryRumor)
    }
    pub fn needs_delta(self) -> bool {
        matches!(self, EffectKind::RelationShift | EffectKind::Development | EffectKind::ColonyMorale)
    }
    /// 需要发现物参数。
    pub fn needs_discovery(self) -> bool {
        self == EffectKind::DiscoveryRumor
    }
    /// 可以指定殖民地建筑（不指定表示全部建筑）。
    pub fn allows_building(self) -> bool {
        self == EffectKind::ColonyOutput
    }
    /// 作用于殖民地（地点须是已建成殖民地的殖民点）。
    pub fn targets_colony(self) -> bool {
        matches!(self, EffectKind::ColonyOutput | EffectKind::ColonyMorale | EffectKind::ColonyGrowth)
    }
    /// 地点须是殖民点（殖民地效果与占领殖民点）；其余带地点的效果不能用于殖民点。
    pub fn targets_site(self) -> bool {
        self.targets_colony() || self == EffectKind::SiteClaim
    }
}

/// 事件的前提条件（针对势力关系类事件）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum EventRequire {
    None,
    /// 两个势力须处于紧张状态
    Tension,
    /// 两个势力须处于紧张或战争状态
    TensionOrWar,
}

/// 事件类型及其参数范围。
#[derive(Clone, Debug)]
pub struct EventTypeDef {
    pub key: String,
    pub name: String,
    pub description: String,
    pub effect: EffectKind,
    /// 同类事件两次开始之间至少间隔的天数
    pub cooldown_days: u32,
    /// 每年最多发生次数
    pub max_per_year: u32,
    pub requires: EventRequire,
    /// 允许的商品（空表示任意）
    pub goods: Vec<GoodId>,
    /// 系数范围（含端点）
    pub mult: Option<(Fx, Fx)>,
    /// 持续天数范围
    pub days: Option<(u32, u32)>,
    /// 变化量范围
    pub delta: Option<(i64, i64)>,
    /// 地点必须是港口
    pub port_only: bool,
    /// 只在这些地点发生（空表示任意；带地点的效果才用得上）。S01 起寰宇的行情事件按真实的由头落在对应的地方。
    pub locs: Vec<LocId>,
    /// 只在这些海区发生（空表示任意；带海区的效果才用得上）
    pub regions: Vec<RegionId>,
    /// 只针对这些势力（空表示任意；带势力的效果才用得上，两个势力的效果里双方都须在其中）
    pub factions: Vec<FactionId>,
}

/// 数据版本信息，写入存档。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DataMeta {
    /// data/ 目录中全部文件内容的 blake3 哈希（十六进制）
    pub hash: String,
    /// 各表的条目键（按下标顺序），用于存档兼容性检查
    pub keys: IdTables,
}

#[derive(Clone, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct IdTables {
    pub goods: Vec<String>,
    pub locations: Vec<String>,
    pub ships: Vec<String>,
    pub regions: Vec<String>,
    pub factions: Vec<String>,
    pub companies: Vec<String>,
    #[serde(default)]
    pub animals: Vec<String>,
    #[serde(default)]
    pub roads: Vec<String>,
    #[serde(default)]
    pub industry_types: Vec<String>,
    #[serde(default)]
    pub recipes: Vec<String>,
    #[serde(default)]
    pub exchanges: Vec<String>,
    #[serde(default)]
    pub futures_specs: Vec<String>,
    #[serde(default)]
    pub events: Vec<String>,
    #[serde(default)]
    pub mates: Vec<String>,
    #[serde(default)]
    pub colony_buildings: Vec<String>,
    #[serde(default)]
    pub discoveries: Vec<String>,
    /// v5：属性下标、开局剧本与船只改造均须保持发布顺序。
    #[serde(default)]
    pub attributes: Vec<String>,
    #[serde(default)]
    pub scenarios: Vec<String>,
    #[serde(default)]
    pub refits: Vec<String>,
    #[serde(default)]
    pub roles: Vec<String>,
}

impl StaticData {
    pub fn good(&self, id: GoodId) -> &GoodDef {
        &self.goods[id.idx()]
    }
    pub fn loc(&self, id: LocId) -> &LocationDef {
        &self.locations[id.idx()]
    }
    pub fn ship(&self, id: ShipTypeId) -> &ShipTypeDef {
        &self.ships[id.idx()]
    }
    pub fn region(&self, id: RegionId) -> &RegionDef {
        &self.regions[id.idx()]
    }
    pub fn faction(&self, id: FactionId) -> &FactionDef {
        &self.factions[id.idx()]
    }
    pub fn company(&self, id: CompanyId) -> &CompanyDef {
        &self.companies[id.idx()]
    }
    pub fn animal(&self, id: AnimalId) -> &AnimalDef {
        &self.animals[id.idx()]
    }
    pub fn road(&self, id: RoadId) -> &RoadDef {
        &self.roads[id.idx()]
    }
    pub fn industry_type(&self, id: IndustryTypeId) -> &IndustryTypeDef {
        &self.industry_types[id.idx()]
    }
    pub fn recipe(&self, id: RecipeId) -> &RecipeDef {
        &self.recipes[id.idx()]
    }
    pub fn exchange(&self, id: ExchangeId) -> &ExchangeDef {
        &self.exchanges[id.idx()]
    }
    pub fn good_ids(&self) -> impl Iterator<Item = GoodId> + '_ {
        (0..self.goods.len()).map(GoodId::from_idx)
    }
    pub fn loc_ids(&self) -> impl Iterator<Item = LocId> + '_ {
        (0..self.locations.len()).map(LocId::from_idx)
    }
    pub fn port_ids(&self) -> impl Iterator<Item = LocId> + '_ {
        self.loc_ids().filter(|l| self.loc(*l).is_port())
    }
    pub fn company_ids(&self) -> impl Iterator<Item = CompanyId> + '_ {
        (0..self.companies.len()).map(CompanyId::from_idx)
    }
    pub fn faction_ids(&self) -> impl Iterator<Item = FactionId> + '_ {
        (0..self.factions.len()).map(FactionId::from_idx)
    }
    pub fn find_good(&self, key: &str) -> Option<GoodId> {
        self.goods.iter().position(|g| g.key == key).map(GoodId::from_idx)
    }
    /// key 对应的地点（与逐条比较相同；九百多处地点，按排好序的次序二分）。
    pub fn find_loc(&self, key: &str) -> Option<LocId> {
        self.loc_order.position(&self.locations, key, |l| &l.key).map(LocId::from_idx)
    }
    pub fn find_ship(&self, key: &str) -> Option<ShipTypeId> {
        self.ships.iter().position(|g| g.key == key).map(ShipTypeId::from_idx)
    }
    pub fn find_scenario(&self, key: &str) -> Option<ScenarioId> {
        self.scenarios.iter().position(|g| g.key == key).map(ScenarioId::from_idx)
    }
    pub fn find_recipe(&self, key: &str) -> Option<RecipeId> {
        self.recipes.iter().position(|g| g.key == key).map(RecipeId::from_idx)
    }
    pub fn event_type(&self, id: EventTypeId) -> &EventTypeDef {
        &self.events[id.idx()]
    }
    pub fn find_event(&self, key: &str) -> Option<EventTypeId> {
        self.events.iter().position(|g| g.key == key).map(EventTypeId::from_idx)
    }
    pub fn find_region(&self, key: &str) -> Option<RegionId> {
        self.regions.iter().position(|g| g.key == key).map(RegionId::from_idx)
    }
    pub fn find_faction(&self, key: &str) -> Option<FactionId> {
        self.factions.iter().position(|g| g.key == key).map(FactionId::from_idx)
    }
    pub fn find_company(&self, key: &str) -> Option<CompanyId> {
        self.companies.iter().position(|g| g.key == key).map(CompanyId::from_idx)
    }
    pub fn mate(&self, id: MateId) -> &MateDef {
        &self.mates[id.idx()]
    }
    pub fn find_mate(&self, key: &str) -> Option<MateId> {
        self.mates.iter().position(|g| g.key == key).map(MateId::from_idx)
    }
    pub fn mate_ids(&self) -> impl Iterator<Item = MateId> + '_ {
        (0..self.mates.len()).map(MateId::from_idx)
    }
    /// 可殖民地点。
    pub fn site_ids(&self) -> impl Iterator<Item = LocId> + '_ {
        self.loc_ids().filter(|l| self.loc(*l).is_site())
    }
    pub fn colony_building(&self, id: ColonyBuildingId) -> &ColonyBuildingDef {
        &self.colony_buildings[id.idx()]
    }
    pub fn find_colony_building(&self, key: &str) -> Option<ColonyBuildingId> {
        self.colony_buildings.iter().position(|g| g.key == key).map(ColonyBuildingId::from_idx)
    }
    pub fn colony_building_ids(&self) -> impl Iterator<Item = ColonyBuildingId> + '_ {
        (0..self.colony_buildings.len()).map(ColonyBuildingId::from_idx)
    }
    pub fn discovery(&self, id: DiscoveryId) -> &DiscoveryDef {
        &self.discoveries[id.idx()]
    }
    pub fn find_discovery(&self, key: &str) -> Option<DiscoveryId> {
        self.discoveries.iter().position(|g| g.key == key).map(DiscoveryId::from_idx)
    }
    pub fn discovery_ids(&self) -> impl Iterator<Item = DiscoveryId> + '_ {
        (0..self.discoveries.len()).map(DiscoveryId::from_idx)
    }
    /// 粮食类商品（类别等于 `rules.colony.food_category`）。
    pub fn food_goods(&self) -> impl Iterator<Item = GoodId> + '_ {
        self.good_ids().filter(|g| self.good(*g).category == self.rules.colony.food_category)
    }
    /// 与某地点相连的道路：（道路, 另一端地点）。
    pub fn roads_from(&self, loc: LocId) -> impl Iterator<Item = (RoadId, LocId)> + '_ {
        self.roads.iter().enumerate().filter_map(move |(i, r)| {
            if r.from == loc {
                Some((RoadId::from_idx(i), r.to))
            } else if r.to == loc {
                Some((RoadId::from_idx(i), r.from))
            } else {
                None
            }
        })
    }
}

/// 全局规则参数（`data/rules.toml`）。
#[derive(Clone, Debug)]
pub struct Rules {
    /// 养成期的世界调度；缺省保留完整逐日经济。
    pub upbringing: UpbringingWorldRules,
    pub attributes: crate::captain::AttributeRules,
    pub items: crate::items::ItemsRules,
    pub ships: crate::legend_ships::Rules,
    /// 故事选项的掷骰规则（`[story]`）；缺省关闭。
    pub story: crate::story2::dice::StoryRules,
    // ── 现货市场 ──
    /// 参考价格曲线 f(库存 / 目标库存)，单调递减
    pub price_curve: Curve,
    /// 价格下限（相对基准价）
    pub price_floor: Fx,
    /// 价格上限（相对基准价）
    pub price_cap: Fx,
    /// 目标库存 = 日消耗 × 该天数
    pub target_stock_days: i64,
    /// 每日产量随机波动幅度（万分比）
    pub production_noise_bp: i64,
    /// 流行商品的需求加成
    pub popular_bonus: Fx,
    /// 流行持续天数
    pub popular_days: u32,
    /// 季节触发流行的每日概率（万分比，对每个地点）
    pub seasonal_popular_bp: i64,
    /// 本地价格走势（日线）保留的天数
    pub price_history_days: usize,
    /// 月线（月均收盘价）保留的个数
    pub price_history_months: usize,

    // ── 航海 ──
    pub crew_wage: Money,
    pub crew_hire_cost: Money,
    pub food_price: Money,
    pub water_price: Money,
    /// 1 单位粮或水可供多少船员一天
    pub crew_per_supply_unit: i64,
    /// 按实际人日累计粮水消耗；关闭时保持经典的每日向上取整。
    pub fractional_supplies: bool,
    pub repair_cost_per_point: Money,
    /// 卖船回收比例（再乘耐久比例）
    pub ship_resale: Fx,
    /// 海上每 30 天的疾病概率（万分比 / 天）
    pub disease_bp_per_30_days: i64,
    /// 缺粮或缺水时每日船员损失比例
    pub starvation_loss: Fx,
    /// 缺粮或缺水时每日士气下降
    pub starvation_morale: i64,
    /// 航行超过该天数后士气开始下降
    pub morale_decay_after: u32,
    /// 士气低于该值时可能哗变
    pub mutiny_morale: i64,

    // ── NPC 商会 ──
    pub npc: NpcRules,

    // ── 信用与破产 ──
    /// 现金为负持续多少天判定资不抵债
    pub insolvency_days: u32,

    pub warehouse: WarehouseRules,
    pub caravan: CaravanRules,
    pub contracts: ContractRules,
    pub invest: InvestRules,
    pub bank: BankRules,
    pub diplomacy: DiplomacyRules,
    pub mates: MateRules,
    pub pirates: PirateRules,
    pub battle: BattleRules,
    pub explore: ExploreRules,
    /// 世界配置：货币名称、纪年
    pub world: WorldRules,
    /// 殖民地
    pub colony: ColonyRules,
    /// 探险发现与名声
    pub discovery: DiscoveryRules,
    /// 每日天气（天况频率、风的变化、暴风雨与受损的联动）
    pub weather: crate::weather::WeatherRules,
    /// 本地生产者与供给响应（ECONOMY.md 6.3）；缺省两个开关都关，与旧版逐日一致
    pub producers: ProducerRules,
    /// 人口、繁荣度与需求层级（ECONOMY.md 6.4）；缺省关闭
    pub population: PopulationRules,
    /// 城镇工坊（ECONOMY.md 6.5）；缺省关闭
    pub workshops: WorkshopRules,
    /// 舰队补给的粮食从当地市场买（ECONOMY.md 6.4）；缺省关闭（固定价）
    pub provisions: ProvisionRules,
    /// 本地商人的预期与囤货、传闻进入预期（ECONOMY.md 6.6、8.3）；缺省关闭
    pub merchants: MerchantRules,
    /// 信息时效（ECONOMY.md 第 7 节）：告示板与行情通报；模式在开局时选，实时模式下用不到
    pub info: InfoRules,
    /// 势力的经济政策的规则触发（ECONOMY.md 6.10）；缺省关闭
    pub policies: PolicyRules,
    /// 货币流通（ECONOMY.md 6.9）：城镇钱袋、腹地、流动性、势力国库与财政；缺省关闭
    pub money: MoneyRules,
    /// 开放市场：各地收购全部商品、只出售特产为主的几种（`rules.toml [market.open]`）；缺省关闭
    pub open_market: OpenMarketRules,
    /// 事件节奏的闸与预算（`rules.toml [pacing]`）；缺省关闭
    pub pacing: PacingRules,
    /// 商馆、货档与商誉（`rules.toml [access]`，T01）；缺省关闭
    pub access: AccessRules,
    /// 岗位与装备在海上的效果（`rules.toml [voyage_posts]`，H01）；缺省关闭
    pub voyage_posts: crate::seafaring::PostsRules,
    /// 船况、口粮与船员状态（`rules.toml [voyage_wear]`，H02）；缺省关闭
    pub voyage_wear: crate::seafaring::WearRules,
    /// 岸与锚地（`rules.toml [shore_tasks]`，H05）；缺省关闭
    pub shore_tasks: crate::seafaring::ShoreRules,
    /// 市场深度曲线（`rules.toml [market] depth_curve`，T01）：发展度高于第一个点时，产量与目标库存同乘曲线上的值；
    /// 不高于第一个点时与没有这条规则时一样用线性的发展度系数。缺省没有（一律线性，与旧版逐日一致）
    pub depth_curve: Option<Curve>,
    /// 天气团（`rules.toml [weather_cells]`，H03）；缺省关闭
    pub weather_cells: crate::weather_cells::WeatherCellRules,
    /// 海盗按分钟追击（`rules.toml [pursuit]`，H03）；缺省关闭
    pub pursuit: crate::navigation::pursuit::PursuitRules,
    /// 海上所见（`rules.toml [sightings]` 与 `sightings.toml`，H04）；缺省关闭
    pub sightings: crate::sightings::SightingRules,
    /// 喊话、结伴与甩掉追击（`rules.toml [hail]`，H06）；缺省关闭
    pub hail: crate::hail::HailRules,
    /// 航海日志与航程总结（`rules.toml [voyage_log]`，H08）；缺省关闭
    pub voyage_log: crate::voyage_log::VoyageLogRules,
    /// 甲板闲话（`rules.toml [banter]` 与 `banter.toml`，H08）；缺省关闭
    pub banter: crate::banter::BanterRules,
    /// H07 航线规划（`rules.toml [routing]`）：领航员按用时寻路、航线纪录；缺省关闭
    pub routing: crate::navigation::routing::RoutingRules,
    /// 商馆分红与遭劫（`rules.toml [dividends]`，T02）；缺省关闭
    pub dividends: crate::house::DividendRules,
    /// 船厂随发展度放大船（`rules.toml [shipyard_growth]`，T02）；缺省关闭
    pub shipyard_growth: crate::house::ShipyardGrowthRules,
    /// 商会跟投（`rules.toml [npc_invest]`，T02）；缺省关闭
    pub npc_invest: crate::house::NpcInvestRules,
    /// 商馆代办与产业位（`rules.toml [agency]`，T03）；缺省关闭
    pub agency: crate::agency::AgencyRules,
    /// 技能效果生效（`rules.toml [skill_effects]`，K01）；缺省关闭
    pub skill_effects: crate::skills::SkillEffectsRules,
    /// E02：发展度新尺度与月度增长；缺省关闭。
    pub development: crate::development::DevelopmentRules,
    pub quests: crate::story2::guide_defs::QuestRules,
    pub trade_books: crate::trade_books::TradeBooksRules,
    /// H10b：自动驾驶视线拉直，缺省关闭。
    pub autopilot: crate::navigation::line_pilot::AutopilotRules,
    pub stage_unlocks: crate::stages::StageUnlockRules,
    pub rare: crate::stages::RareRules,
}

/// 商馆、货档与商誉（`rules.toml [access]`，模型见 [`crate::access`]）。
///
/// 缺省关闭：没有这一节的数据包（经典世界、测试夹具）行为与加这条规则之前逐位相同，存档里也不多出字段。
/// 数值的来历见 `docs/BALANCE.md`（T01）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AccessRules {
    pub enabled: bool,
    /// 买入第 r 档的货需要的商誉（下标为货档；第 0 项必须是 0）
    pub rank_goodwill: Vec<i64>,
    /// 商馆 0 级、1 级……的商誉加成（长度 − 1 就是商馆的最高等级）
    pub house_goodwill: Vec<i64>,
    /// 商馆各级的交易税乘数（与同盟港的税率不叠乘，取更低的一个）
    pub house_tax: Vec<Fx>,
    /// 商馆各级的免费仓位（与同盟港的免费仓位不相加，取更多的一个）
    pub house_storage: Vec<i64>,
    /// 1 级商馆要的累计投资（初始发展度 50 的港口）；实际门槛再乘 (0.5 + 初始发展度 / 100)
    pub house_base: Money,
    /// 每升一级，门槛乘这个数
    pub house_step: i64,
    /// 成为同盟港还要商馆达到这一级（0 表示不另设条件）
    pub ally_house: usize,
    /// 每港保底：出售清单里货档最低（同档按基准价从低到高）的这么多种货不看商誉
    pub floor_goods: usize,
    /// 贸易声望：对某势力的第 n 点声望要累计成交额 trade_rep_base × (1 + n / trade_rep_per)，经由贸易最多积累到 trade_rep_cap
    pub trade_rep_base: Money,
    pub trade_rep_per: i64,
    pub trade_rep_cap: i64,
    /// 港口投资：在同一港口每累计这么多金币 +1 声望（不保底），单笔最多 invest_rep_max 点
    pub invest_rep_per: Money,
    pub invest_rep_max: i64,
    /// 商会在各地的商誉起步（本据势力的港口全开）
    pub company_goodwill: i64,
    /// 没有这套状态的旧存档读入后的宽限天数（期间全档可买）
    pub grace_days: u32,
    /// 不能投资的地点（内陆城市等，设不了商馆）买入各档要的商誉（T02）；不写时与 `rank_goodwill` 相同
    pub inland_goodwill: Option<Vec<i64>>,
}

impl Default for AccessRules {
    fn default() -> Self {
        AccessRules {
            enabled: false,
            rank_goodwill: vec![0, 10, 30, 60],
            house_goodwill: vec![0, 10, 25, 45, 70],
            house_tax: vec![Fx::ONE, Fx::ONE, Fx::from_pct(85), Fx::from_pct(70), Fx::from_pct(50)],
            house_storage: vec![0, 100, 200, 300, 300],
            house_base: 5_000,
            house_step: 3,
            ally_house: 4,
            floor_goods: 3,
            trade_rep_base: 2_000,
            trade_rep_per: 10,
            trade_rep_cap: 50,
            invest_rep_per: 20_000,
            invest_rep_max: 10,
            company_goodwill: 30,
            grace_days: 360,
            inland_goodwill: None,
        }
    }
}

impl AccessRules {
    /// 商馆的最高等级。
    pub fn max_house(&self) -> usize {
        self.house_goodwill.len().saturating_sub(1)
    }

    /// 买入各档要的商誉：能投资的地点（港口）用 `rank_goodwill`，不能投资的（内陆城市等）用 `inland_goodwill`（没写时同前者）。
    pub fn rank_table(&self, investable: bool) -> &[i64] {
        match &self.inland_goodwill {
            Some(t) if !investable => t,
            _ => &self.rank_goodwill,
        }
    }

    /// 数据校验用：开启时说不通的取值（字段名，问题）。关闭时不看数值。
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        if self.rank_goodwill.first() != Some(&0) {
            out.push(("rank_goodwill", "第 0 档的门槛必须是 0（0 档的货谁都能买）"));
        }
        if self.rank_goodwill.windows(2).any(|w| w[0] > w[1]) {
            out.push(("rank_goodwill", "货档越高门槛不能越低"));
        }
        if let Some(t) = &self.inland_goodwill
            && (t.len() != self.rank_goodwill.len() || t.first() != Some(&0) || t.windows(2).any(|w| w[0] > w[1]))
        {
            out.push(("inland_goodwill", "项数要与 rank_goodwill 相同，第 0 档为 0，货档越高门槛不能越低"));
        }
        if self.house_goodwill.is_empty() || self.house_goodwill[0] != 0 {
            out.push(("house_goodwill", "至少要有 0 级，且 0 级的加成必须是 0"));
        }
        if self.house_goodwill.windows(2).any(|w| w[0] > w[1]) {
            out.push(("house_goodwill", "等级越高加成不能越少"));
        }
        if self.house_tax.len() != self.house_goodwill.len() || self.house_storage.len() != self.house_goodwill.len() {
            out.push(("house_tax", "house_tax、house_storage 与 house_goodwill 的项数必须相同"));
        }
        if self.house_tax.iter().any(|t| *t <= Fx::ZERO || *t > Fx::ONE) {
            out.push(("house_tax", "税率乘数必须在 0 到 1 之间"));
        }
        if self.house_storage.iter().any(|s| *s < 0) {
            out.push(("house_storage", "免费仓位不能为负"));
        }
        if self.house_base < 1 || self.house_step < 1 {
            out.push(("house_base", "house_base 与 house_step 必须至少为 1"));
        }
        if self.ally_house > self.max_house() {
            out.push(("ally_house", "不能高于商馆的最高等级"));
        }
        if self.trade_rep_base < 1 || self.trade_rep_per < 1 || self.invest_rep_per < 1 {
            out.push(("trade_rep_base", "trade_rep_base、trade_rep_per 与 invest_rep_per 必须至少为 1"));
        }
        if !(0..=100).contains(&self.trade_rep_cap) || self.invest_rep_max < 0 {
            out.push(("trade_rep_cap", "trade_rep_cap 必须在 0 到 100 之间，invest_rep_max 不能为负"));
        }
        out
    }
}

/// 事件节奏的闸与预算（`rules.toml [pacing]`，模型见 [`crate::pacing`]）。
///
/// 缺省关闭：没有这一节的数据包（经典世界、测试夹具）行为与加这条规则之前逐位相同，存档里也不多出字段。
/// 数值的来历见 `docs/BALANCE.md`（2026-11-10 · P11）。
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PacingRules {
    pub enabled: bool,
    /// 一天里最多新出场几件独立打断。要紧的事照出，也占名额；续章不计。
    pub daily: u32,
    /// 滚动窗口的天数（含今天）。
    pub window_days: u32,
    /// 窗口内“可以等的事”（分量不是要紧的）最多出场几件。
    pub window_soft: u32,
    /// 可以等的事最久等几天；等满之后不再受窗口上限限制（仍受单日上限）。
    pub max_defer_days: u32,
}

impl Default for PacingRules {
    fn default() -> Self {
        Self { enabled: false, daily: 2, window_days: 7, window_soft: 3, max_defer_days: 10 }
    }
}

impl PacingRules {
    /// 数据校验用：开启时说不通的取值（字段名，问题）。关闭时不看数值。
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        if self.daily == 0 {
            out.push(("daily", "必须至少为 1（单日上限为 0 时可以等的事永远出不了场）"));
        }
        if self.window_days == 0 {
            out.push(("window_days", "必须至少为 1"));
        }
        if self.window_soft == 0 {
            out.push(("window_soft", "必须至少为 1"));
        }
        out
    }
}

/// 养成与开局预演的调度开关（`rules.toml [upbringing]`）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct UpbringingWorldRules {
    pub light_world: bool,
    /// 播放按周暂停（应用层）。没有 `weekly` 时活动仍按月安排、按旬结算。
    pub weekly_playback: bool,
    /// 每月只在下旬开始时安排普通短事件。
    pub monthly_ordinary_events: bool,
    /// U05：排程按周（`[upbringing.weekly]`）——每周几格、各在周内第几天结算、格重。不写就按旬。
    pub weekly: Option<crate::upbringing::WeeklyRules>,
    /// U06a：事件按周排期；缺省不启用，旧档随周排程切换。
    pub cadence: Option<crate::upbringing::CadenceRules>,
    /// U06K1：缺省关闭，只在新开局进入。
    pub act: Option<crate::upbringing::act::ActRules>,
}

/// 本地商人的预期与囤货（`rules.toml [merchants]`，ECONOMY.md 6.6、8.3；模型见 [`crate::merchants`]）。
/// 系数取 Anufriev & Hommes（2012）实验里验证过的四条规则与学习参数；囤货与传闻的幅度按“现货以回归为主、
/// 只在趋势派占上风时出现小的超调”调。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MerchantRules {
    pub enabled: bool,
    /// 绩效的记忆 η：U = −误差² + η × U₋₁
    pub memory: Fx,
    /// 占比的惯性 δ：n = δ × n₋₁ + (1 − δ) × softmax(β × U)
    pub inertia: Fx,
    /// 选择强度 β
    pub intensity: Fx,
    /// 每条规则的最低占比
    pub min_share: Fx,
    /// 误差的刻度：把价格折算成“长期均价 = 该值”再算误差（实验里的价格在 50 上下）
    pub scale: i64,
    /// 长期均价的平滑天数（锚定派的锚）
    pub anchor_days: i64,
    /// 平常的存货（开张时自带，目标库存的倍数）与上限
    pub hoard_base: Fx,
    pub hoard_max: Fx,
    /// 想要的存货 = 平常的存货 + 该值 × (预期涨幅 − 持有成本) × 目标库存（夹在 0 与上限之间）
    pub hoard_speed: Fx,
    /// 每天向想要的存货移动的比例
    pub hoard_adjust: Fx,
    /// 每天的持有成本（相对价格）
    pub holding_cost: Fx,
    /// 可信度 100 的传闻让预期偏移的幅度（也是偏移的上限）
    pub rumor_amplitude: Fx,
    /// 传闻偏移每天剩下的比例
    pub rumor_decay: Fx,
}

impl Default for MerchantRules {
    fn default() -> Self {
        MerchantRules {
            enabled: false,
            memory: Fx::from_pct(70),
            inertia: Fx::from_pct(90),
            intensity: Fx::from_pct(40),
            min_share: Fx::from_pct(5),
            scale: 50,
            anchor_days: 360,
            hoard_base: Fx::from_pct(10),
            hoard_max: Fx::from_pct(20),
            hoard_speed: Fx::from_int(3),
            hoard_adjust: Fx::from_pct(25),
            holding_cost: Fx::from_bp(5),
            rumor_amplitude: Fx::from_pct(15),
            rumor_decay: Fx::from_pct(85),
        }
    }
}

/// 信息时效（`rules.toml [info]`，ECONOMY.md 第 7 节；模型见 [`crate::info`]）。
/// 开局选“随船传递”时才用得到；“实时（经典）”与旧存档不受影响。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct InfoRules {
    /// 告示板上的消息保留的天数：快照日早于今天减去该值的撕掉
    pub board_days: u32,
    /// 行情通报的价格 = report_base + report_per_port × 买到的快照张数
    pub report_base: Money,
    pub report_per_port: Money,
}

impl Default for InfoRules {
    fn default() -> Self {
        InfoRules { board_days: 180, report_base: 100, report_per_port: 40 }
    }
}

/// 势力的经济政策的规则触发（`rules.toml [policies]`，ECONOMY.md 6.10；模型见 [`crate::policy`]）。缺省关闭（与旧版逐日一致）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PolicyRules {
    pub enabled: bool,
    /// 主食：出口禁令只看这些商品
    pub staples: Vec<GoodId>,
    /// 本国港口的主食这个月的均价达到往常价格（之前至多 12 个月的月均价的平均）的该倍数 → 出口禁令
    pub staple_ratio: Fx,
    pub ban_days: u32,
    /// 本国特产这个月被买走的数量达到当地一个月正常产量的该比例 → 出口税上调
    pub export_share: Fx,
    /// 出口税系数（交易税 × 该值）与天数
    pub export_tax: Fx,
    pub export_tax_days: u32,
}

impl Default for PolicyRules {
    fn default() -> Self {
        PolicyRules {
            enabled: false,
            staples: Vec::new(),
            staple_ratio: Fx::from_pct(180),
            ban_days: 30,
            export_share: Fx::ONE,
            export_tax: Fx::from_pct(200),
            export_tax_days: 60,
        }
    }
}

/// 货币流通（`rules.toml [money]`，ECONOMY.md 6.9；模型见 [`crate::circulation`]）。缺省关闭（与旧版逐日一致）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MoneyRules {
    pub enabled: bool,
    /// 腹地收入：每天 = 人口 × 人均日收入 × 繁荣度系数
    pub income_per_capita: Fx,
    /// 钱袋每天漏回腹地的比例；参照钱袋 = 开局的腹地收入 / 该比例
    pub leak: Fx,
    /// 流动性系数 ℓ = (钱袋 / 参照钱袋)^(1 / liquidity_root)，夹在上下限之间
    pub liquidity_root: u32,
    pub liquidity_floor: Fx,
    pub liquidity_cap: Fx,
    /// 银行开局的准备金
    pub bank_reserve: Money,
    /// 国库开局 = 本国城镇开局的腹地收入之和 × 该天数
    pub treasury_days: i64,
    /// 财政：储备 = 平均月收入 × reserve_months；每月支出 = 平均月收入 × spend_rate + (余额 − 储备) / catch_up_months
    pub reserve_months: i64,
    pub spend_rate: Fx,
    pub catch_up_months: i64,
    /// 每月支出里公共工程的份额（其余是海军）
    pub works_share: Fx,
    /// 公共工程最多把港口的发展度提高到开局值之上多少点
    pub works_cap: i64,
    /// 海军：满巡逻所需的每港每月开支；巡逻度满时海盗出现概率降低的比例
    pub patrol_cost: Money,
    pub navy_cut: Fx,
    /// 交战中的势力每月另花平均月收入的该比例（钱进腹地）
    pub war_share: Fx,
    /// 占领一处殖民点从国库付的钱（钱进腹地；付不起就不占）
    pub claim_cost: Money,
    /// 税：余额低于 −deficit_months 个月收入加税一步，高于 surplus_months 个月减税一步，之间向 1 回一步
    pub deficit_months: i64,
    pub surplus_months: i64,
    pub tax_step: Fx,
    pub tax_min: Fx,
    pub tax_max: Fx,
    /// 商会每月按超出储备的现金的该比例付给本据港的钱袋（维护费）
    pub company_overhead: Fx,
}

impl Default for MoneyRules {
    fn default() -> Self {
        MoneyRules {
            enabled: false,
            income_per_capita: Fx::from_bp(4_000),
            leak: Fx::from_bp(167),
            liquidity_root: 5,
            liquidity_floor: Fx::from_pct(80),
            liquidity_cap: Fx::from_pct(125),
            bank_reserve: 2_000_000,
            treasury_days: 30,
            reserve_months: 6,
            spend_rate: Fx::from_pct(80),
            catch_up_months: 12,
            works_share: Fx::from_pct(50),
            works_cap: 5,
            patrol_cost: 3_000,
            navy_cut: Fx::from_pct(30),
            war_share: Fx::from_pct(50),
            claim_cost: 20_000,
            deficit_months: 0,
            surplus_months: 12,
            tax_step: Fx::from_pct(5),
            tax_min: Fx::from_pct(80),
            tax_max: Fx::from_pct(125),
            company_overhead: Fx::from_pct(1),
        }
    }
}

/// 需求层级（ECONOMY.md 6.4）：必需品的需求不随繁荣度变，舒适品与奢侈品随繁荣度伸缩。只允许追加。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NeedTier {
    Essential,
    Comfort,
    Luxury,
}

impl NeedTier {
    pub const ALL: [NeedTier; 3] = [NeedTier::Essential, NeedTier::Comfort, NeedTier::Luxury];

    pub fn index(self) -> usize {
        self as usize
    }

    pub fn key(self) -> &'static str {
        match self {
            NeedTier::Essential => "essential",
            NeedTier::Comfort => "comfort",
            NeedTier::Luxury => "luxury",
        }
    }

    pub fn from_key(key: &str) -> Option<NeedTier> {
        NeedTier::ALL.into_iter().find(|t| t.key() == key)
    }
}

/// 人口、繁荣度与需求层级（`rules.toml [population]`，ECONOMY.md 6.4）。
///
/// 港口与内陆城市有人口 N（开局 = 发展度 × `per_development`）与繁荣度 S（0–100，初值 50）：
/// - 需求规模：目标库存乘 N / N0、需求层级系数（1 + 弹性 × (S − 50) / 50，夹在 [`tier_min`, `tier_max`]）与替代系数；
/// - 劳动力：产量乘 min(1, N / N0)，本地生产者与工坊的产能上限乘 N / N0；
/// - 满足度：每天按层取各商品（可以相互替代的一组算一项）“库存 / 目标库存”截断到 1 的均值，月末按权重合成指数；
///   头一年记下各月的指数作参照，此后繁荣度的目标 = 50 × (1 + `sensitivity` × (当月指数 / 当月参照 − 1))（夹在 0–100），
///   繁荣度每天向目标移动 `prosperity_daily`；
/// - 人口每月按繁荣度增减 `growth` × (S − 50) / 50，夹在 N0 的 [`min_ratio`, `max_ratio`] 倍；雇船员从当地人口里招；
/// - 替代：同一组商品（[`GoodDef::group`]）按相对往常的涨跌重新分摊需求（份额 ∝ 基础需求 / (价格 / 正常价)²；单一商品的份额不超过
///   `substitution_cap`，本来就更多的不再增加），替代系数每天向新份额移动 `substitution_rate`；
/// - 市况：由必需品满足度、繁荣度与库存指数派生，进入与解除用不同的门槛（滞回）。
///
/// [`tier_min`]: PopulationRules::tier_min
/// [`tier_max`]: PopulationRules::tier_max
/// [`min_ratio`]: PopulationRules::min_ratio
/// [`max_ratio`]: PopulationRules::max_ratio
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PopulationRules {
    pub enabled: bool,
    /// 开局人口 = 发展度 × 该值
    pub per_development: i64,
    /// 人口的下限与上限（开局人口的倍数）
    pub min_ratio: Fx,
    pub max_ratio: Fx,
    /// 繁荣度 100（或 0）时人口每月的增（减）幅
    pub growth: Fx,
    /// 繁荣度每天向目标移动的比例
    pub prosperity_daily: Fx,
    /// 繁荣度的目标对满足度的灵敏度：指数比参照高（低）1%，目标高（低）50 × 该值 %
    pub sensitivity: Fx,
    /// 必需、舒适、奢侈三层满足度的权重
    pub weights: [Fx; 3],
    /// 三层需求对繁荣度的弹性
    pub elasticity: [Fx; 3],
    /// 需求层级系数的下限与上限
    pub tier_min: Fx,
    pub tier_max: Fx,
    /// 替代系数每天向按价格分摊的份额移动的比例
    pub substitution_rate: Fx,
    /// 单一商品最多满足同一需求的比例（基础份额本来就更高的不再增加）
    pub substitution_cap: Fx,
    /// 饥荒：必需品满足度低于当月参照的 `.0` 倍进入，回到 `.1` 倍以上解除
    pub famine: (Fx, Fx),
    /// 萧条：繁荣度低于 `.0` 进入，高于 `.1` 解除（0–100）
    pub depression: (Fx, Fx),
    /// 繁荣：繁荣度高于 `.0` 进入，低于 `.1` 解除
    pub boom: (Fx, Fx),
    /// 过剩：库存指数（各商品“库存 / 目标库存”截断到 4 的均值）高于当月参照的 `.0` 倍进入，低于 `.1` 倍解除
    pub glut: (Fx, Fx),
}

impl Default for PopulationRules {
    fn default() -> Self {
        PopulationRules {
            enabled: false,
            per_development: 500,
            min_ratio: Fx::from_pct(50),
            max_ratio: Fx::from_int(3),
            growth: Fx::from_bp(25),
            prosperity_daily: Fx::from_pct(1),
            sensitivity: Fx::from_int(6),
            weights: [Fx::from_pct(50), Fx::from_pct(30), Fx::from_pct(20)],
            elasticity: [Fx::ZERO, Fx::from_pct(50), Fx::ONE],
            tier_min: Fx::from_pct(25),
            tier_max: Fx::from_int(2),
            substitution_rate: Fx::from_pct(10),
            substitution_cap: Fx::from_pct(80),
            famine: (Fx::from_pct(75), Fx::from_pct(85)),
            depression: (Fx::from_int(38), Fx::from_int(42)),
            boom: (Fx::from_int(62), Fx::from_int(58)),
            glut: (Fx::from_pct(110), Fx::from_pct(105)),
        }
    }
}

/// 城镇工坊（`rules.toml [workshops]` 与 `data/workshops.toml`，ECONOMY.md 6.5）。
///
/// 工坊按配方从本地市场取原料、把产出放回本地市场（不经过资金），接手当地这种加工品均衡产量的一部分（[`WorkshopDef::share`]），
/// 其余仍是凭空的家庭手工产出。产能以万分之一件产出 / 天计，每月按“产出价值 / 原料价值”（影子价格）相对头一年各月参照的预期伸缩，
/// 速度沿用 [`ProducerRules`] 的 λ、κ 与截断，夹在开局产能的 [`min_ratio`, `max_ratio`] 倍（再乘劳动力）；
/// 当月价值比低于 `stop_below`（亏本）停工，回到 `restart_above` 以上复工。原料不够时按最缺的一种少做。
///
/// [`min_ratio`]: WorkshopRules::min_ratio
/// [`max_ratio`]: WorkshopRules::max_ratio
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkshopRules {
    pub enabled: bool,
    /// 产能的下限与上限（开局产能的倍数）
    pub min_ratio: Fx,
    pub max_ratio: Fx,
    /// 停工与复工的价值比门槛
    pub stop_below: Fx,
    pub restart_above: Fx,
}

impl Default for WorkshopRules {
    fn default() -> Self {
        WorkshopRules {
            enabled: false,
            min_ratio: Fx::from_pct(20),
            max_ratio: Fx::from_pct(250),
            stop_below: Fx::ONE,
            restart_above: Fx::from_pct(105),
        }
    }
}

/// 某地的一座城镇工坊（`data/workshops.toml`）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkshopDef {
    pub recipe: RecipeId,
    /// 产出（配方唯一的产出）与每轮的产量
    pub output: GoodId,
    pub out_qty: i64,
    /// 每轮的投入
    pub inputs: Vec<(GoodId, i64)>,
    /// 接手当地这种商品均衡产量的份额（其余仍是凭空的家庭手工产出）
    pub share: Fx,
}

/// 舰队补给的粮食从当地市场买（`rules.toml [provisions]`，ECONOMY.md 6.4）：
/// 在可以充作口粮的商品里挑当前价最低、库存够的一种，按市价（沿库存走价、不含税）买够件数；都不够时照旧按固定价补给。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProvisionRules {
    pub local: bool,
    /// 可以充作口粮的商品
    pub goods: Vec<GoodId>,
    /// 一件这样的商品折合几份口粮
    pub rations: i64,
}

impl Default for ProvisionRules {
    fn default() -> Self {
        ProvisionRules { local: false, goods: Vec::new(), rations: 4 }
    }
}

/// 本地生产者与供给响应（`rules.toml [producers]`，ECONOMY.md 6.3）。
///
/// 每个有产出的市场有一个本地生产者：产能 K、对价格的预期 E（相对“这个月的正常价”的比例）与各月的参照价。
/// 生产者看的是不夹上下限的影子价格（价格曲线过了最后一点按库存反比外推）：库存过剩时价格信号不会卡在下限，
/// 否则卡在下限的市场只看得到“缺货”、看不到“过剩”，产能会一路往上爬。
/// 头一年只看不动，记下每个月的均价作为那个月的参照价（季节起伏与价格曲线的弯曲都算在里面，生产者不会把旺季的高价当成扩产的信号）；
/// 此后每月末 E ← E + λ(当月均价 / 当月参照价 − E)，K ← K × (1 + κ × clamp(E − 1, ±gap_cap))，夹在开局产能的 [min_ratio, max_ratio] 倍之间；
/// 作物（[`GoodDef::crop`]）按月调整计划产能，到下一季开始才生效。线性化后冲击呈阻尼振荡（周期约三年、半衰期约四五个月）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProducerRules {
    /// 供给响应：产能随生产者的价格预期伸缩
    pub enabled: bool,
    /// 产销按万分之一件累计余数（小量商品不再有取整造成的死区）
    pub fractional: bool,
    /// 预期每月向当月均价移动的比例 λ
    pub expect_lambda: Fx,
    /// 月末产能调整的强度 κ
    pub kappa: Fx,
    /// 预期偏离参照价的截断（±）
    pub gap_cap: Fx,
    /// 产能的下限与上限（开局产能的倍数）
    pub min_ratio: Fx,
    pub max_ratio: Fx,
}

impl Default for ProducerRules {
    fn default() -> Self {
        ProducerRules {
            enabled: false,
            fractional: false,
            expect_lambda: Fx::from_pct(30),
            kappa: Fx::from_pct(20),
            gap_cap: Fx::from_pct(50),
            min_ratio: Fx::from_pct(30),
            max_ratio: Fx::from_pct(250),
        }
    }
}

/// 开放市场（`rules.toml [market.open]`，模型见 [`crate::open_market`]）：每个港口与内陆城市都收购全部商品，
/// 离产地越远出价越高；各地出售的只是清单里的特产（外加补足的几种）。缺省关闭（与旧版逐日一致）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpenMarketRules {
    pub enabled: bool,
    /// 清单里“产量 / 消耗”不低于该值的商品也出售（特产总是出售）
    pub sell_min_ratio: Fx,
    /// 出售的商品至少这么多种：不够时按清单里“产量 / 消耗”从高到低补足
    pub sell_min_goods: usize,
    /// 清单以外的商品：离最近的特产地的贸易距离（格）→ 产量 / 消耗（单调不增的分段线性曲线，夹在 0.3 到 1 之间）
    pub ratio_curve: Curve,
    /// 清单以外的商品的日消耗 = 这种商品在各地清单里（进口）的日消耗的中位数 × 该系数，至少 `min_demand`
    pub demand_scale: Fx,
    pub min_demand: i64,
    /// 陆路一格折合几格海路（再除以道路地形的速度系数）
    pub road_factor: Fx,
    /// 清单里的进口条目（不是特产）也按离最近特产地的贸易距离补背景到货（[`crate::open_market::apply_listed_import_inflow`]）：
    /// 产量至少是“日消耗 × ratio_curve(距离)”，代表腹地的驮队与沿海的小商贩。缺省关闭（经典世界不开）。
    pub listed_import_inflow: bool,
}

impl Default for OpenMarketRules {
    fn default() -> Self {
        OpenMarketRules {
            enabled: false,
            sell_min_ratio: Fx::from_pct(75),
            sell_min_goods: 6,
            ratio_curve: Curve::new(vec![(Fx::ZERO, Fx::from_pct(85)), (Fx::from_int(300), Fx::from_pct(36))]),
            demand_scale: Fx::ONE,
            min_demand: 3,
            road_factor: Fx::from_int(2),
            listed_import_inflow: false,
        }
    }
}

/// 世界配置（`rules.toml [world]`）：只影响显示，内核金额仍是整数、日期仍从 0 计。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorldRules {
    /// 货币名称（最小货币单位即 1 个该货币）
    pub currency: String,
    /// 纪年名称
    pub era: String,
    /// 游戏第 1 年对应的纪年年份
    pub start_year: i64,
    /// v3 及更早的存档没有记录迷雾位图的尺寸，读档时按此尺寸解释；(0, 0) 表示与当前地图相同
    pub legacy_map: (u16, u16),
}

impl Default for WorldRules {
    fn default() -> Self {
        WorldRules { currency: "金币".into(), era: "航海历".into(), start_year: 1502, legacy_map: (0, 0) }
    }
}

impl WorldRules {
    /// 游戏年序（从 1 开始）对应的纪年年份。
    pub fn calendar_year(&self, game_year: u32) -> i64 {
        self.start_year + game_year as i64 - 1
    }
}

/// 殖民地规则（`rules.toml [colony]`）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ColonyRules {
    /// 建立殖民地至少需要的殖民者（从舰队船员中转出）
    pub min_settlers: i64,
    /// 建立费
    pub found_cost: Money,
    /// 建立时须从舰队卸下的物资（卸入殖民地仓库，其中一部分作为建设消耗）
    pub found_materials: Vec<(GoodId, i64)>,
    /// 建立物资中作为建设消耗的比例
    pub found_consume: Fx,
    /// 建立殖民地获得的名声
    pub found_fame: i64,
    /// 基础仓储容量
    pub base_capacity: i64,
    /// 基础住房（人口上限）
    pub base_housing: i64,
    /// 粮食类商品的类别名（goods.toml 中的 category）
    pub food_category: String,
    /// 每百人每天消耗的粮食件数
    pub food_per_100: i64,
    /// 有粮、士气 ≥ 50、住房有余时每月的自然增长（万分比）
    pub growth_bp: i64,
    /// 士气每高于 50 十点，每月的移民人数
    pub immigration_per_morale: i64,
    /// 缺粮时每日的人口损失（万分比）
    pub starve_loss_bp: i64,
    /// 每百人每月的税收基数
    pub tax_per_100: Money,
    /// 税率档位：（收入占税收基数的百分比, 士气目标的增减）
    pub tax_levels: Vec<(i64, i64)>,
    /// 新殖民地的税率档位
    pub default_tax: u8,
    /// 提升士气的消费品：（商品, 每百人每月需求）
    pub morale_goods: Vec<(GoodId, i64)>,
    /// 消费品全部满足时的士气目标加成
    pub morale_goods_bonus: i64,
    /// 基础士气目标
    pub morale_base: i64,
    /// 新殖民地的士气
    pub start_morale: i64,
    /// 缺粮时士气目标的惩罚
    pub starve_morale: i64,
    /// 近 30 天遭袭时士气目标的惩罚
    pub raid_morale: i64,
    /// 每日袭击概率 = 海区海盗活跃度 × raid_scale × 危险度 / 50 × (1 − 防御)
    pub raid_scale: Fx,
    /// 两次袭击之间至少间隔的天数
    pub raid_cooldown_days: u32,
    /// 被袭击时库存损失的百分比范围（再乘 1 − 防御）
    pub raid_loss_pct: (i64, i64),
    /// 被袭击时人口损失的百分比范围（再乘 1 − 防御）
    pub raid_death_pct: (i64, i64),
    /// 每月疫病概率 = 危险度 × 该值（万分比）
    pub disease_bp_per_hazard: i64,
    /// 疫病的人口损失百分比范围
    pub disease_death_pct: (i64, i64),
    /// 每个势力每季度占领一处殖民点的基础概率（万分比）
    pub claim_chance_bp: i64,
    /// 每个势力最多占领的殖民点数
    pub max_claims_per_faction: usize,
    /// 开局后多少天起各势力才开始占领殖民点（殖民竞赛与组合事件相同）
    pub claim_start_day: u32,
    /// 势力只占领离本国某个港口不超过该距离（格，直线）的殖民点；0 表示不限
    pub claim_reach: i64,
    /// 占领上限随年代放开：开局每个势力至多 1 处，此后每满该年数多 1 处（仍不超过 max_claims_per_faction）；0 表示不按年代限制
    pub claim_slot_years: u32,
    /// 概率随已占数量递减：实际概率 = 基础概率 × 100 / (100 + 已占数量 × 该值)
    pub claim_decay_pct: i64,
    /// 同一势力两次占领之间至少间隔的天数
    pub claim_cooldown_days: u32,
    /// 每个所有者最多的殖民地数
    pub max_colonies_per_owner: usize,
    /// 防御值上限（百分比）
    pub max_defense_pct: i64,
}

impl Default for ColonyRules {
    fn default() -> Self {
        ColonyRules {
            min_settlers: 20,
            found_cost: 5_000,
            found_materials: Vec::new(),
            found_consume: Fx::from_pct(50),
            found_fame: 10,
            base_capacity: 400,
            base_housing: 150,
            food_category: "粮食".into(),
            food_per_100: 2,
            growth_bp: 150,
            immigration_per_morale: 2,
            starve_loss_bp: 100,
            tax_per_100: 120,
            tax_levels: vec![(0, 10), (50, 5), (100, 0), (150, -10), (200, -20)],
            default_tax: 1,
            morale_goods: Vec::new(),
            morale_goods_bonus: 15,
            morale_base: 45,
            start_morale: 60,
            starve_morale: 25,
            raid_morale: 15,
            raid_scale: Fx::from_pct(10),
            raid_cooldown_days: 60,
            raid_loss_pct: (10, 30),
            raid_death_pct: (2, 8),
            disease_bp_per_hazard: 8,
            disease_death_pct: (2, 6),
            claim_chance_bp: 1_500,
            max_claims_per_faction: 4,
            claim_start_day: 0,
            claim_reach: 0,
            claim_slot_years: 0,
            claim_decay_pct: 0,
            claim_cooldown_days: 0,
            max_colonies_per_owner: 5,
            max_defense_pct: 80,
        }
    }
}

/// 探险发现与名声（`rules.toml [discovery]`）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiscoveryRules {
    /// 招募等级 ≥ 该值的航海士需要名声
    pub mate_fame_from_level: i64,
    /// 所需名声 = (等级 − mate_fame_from_level + 1) × 该值
    pub mate_fame_per_level: i64,
    /// 报告发现物时对所在港口势力的声望增加
    pub report_reputation: i64,
    /// 每多少名声使每个殖民地每月多 1 名移民（0 表示名声不影响移民）
    pub fame_per_immigrant: i64,
    /// 发现物的传闻（组合事件 discovery_rumor）只会传到名声不低于该值的玩家耳中
    pub rumor_min_fame: i64,
}

impl Default for DiscoveryRules {
    fn default() -> Self {
        DiscoveryRules {
            mate_fame_from_level: 4,
            mate_fame_per_level: 20,
            report_reputation: 3,
            fame_per_immigrant: 25,
            rumor_min_fame: 0,
        }
    }
}

impl DiscoveryRules {
    /// 招募某等级航海士所需的名声。
    pub fn mate_fame(&self, level: i64) -> i64 {
        if self.mate_fame_per_level <= 0 || level < self.mate_fame_from_level {
            0
        } else {
            (level - self.mate_fame_from_level + 1) * self.mate_fame_per_level
        }
    }
}

#[derive(Clone, Debug)]
pub struct MateRules {
    /// 升到下一级所需经验 = 当前等级 × 该值（每天在岗得 1 点）
    pub xp_per_level: i64,
    /// 升级时各项能力的增量（上限 100）
    pub level_gain: i64,
    /// 升级时的加薪比例
    pub salary_growth: Fx,
    pub max_level: i64,
    /// 按时发薪时每月忠诚增量
    pub loyalty_paid: i64,
    /// 欠薪（现金为负）时每月忠诚减量
    pub loyalty_unpaid: i64,
    /// 忠诚低于该值即离开
    pub leave_below: i64,
}

#[derive(Clone, Debug)]
pub struct PirateRules {
    /// 海盗使用的船型
    pub ships: Vec<ShipTypeId>,
    /// 每个海区每天出现一支海盗的概率 = 海区海盗活跃度 × 该系数
    pub spawn_scale: Fx,
    pub max_per_region: usize,
    /// 存在天数范围
    pub lifetime: (u32, u32),
    /// 船只数范围
    pub fleet_size: (i64, i64),
    /// 发现商船的距离（格）
    pub sight: i64,
    /// 每天移动的格数
    pub speed: i64,
    /// 船员 = 船型最多船员 × 该比例
    pub crew_ratio: Fx,
}

#[derive(Clone, Debug)]
pub struct BattleRules {
    /// 自动结算时商船凭航速脱离的最大概率
    pub evade_max: Fx,
    /// 战败时货物损失百分比范围
    pub cargo_loss_pct: (i64, i64),
    /// 战败且无货时的现金损失百分比范围
    pub tribute_pct: (i64, i64),
    /// 战术海战六角格地图半径
    pub tactical_radius: i64,
    /// 侧舷炮射程（格）
    pub gun_range: i64,
    /// 战术海战的最多回合数，到达后海盗撤离
    pub max_turns: u32,
    /// 击退海盗时对当地势力的声望奖励
    pub reputation_win: i64,
}

#[derive(Clone, Debug)]
pub struct ExploreRules {
    /// 舰队每天揭开周围多少格
    pub sight: i64,
    /// 海图价格 = 基础价 + 每 100 格价格 × 海区面积 / 100
    pub chart_base: Money,
    pub chart_per_100_cells: Money,
}

#[derive(Clone, Debug)]
pub struct NpcRules {
    /// 期望收益率低于此值不出航
    pub min_margin: Fx,
    /// 每家商会最多舰队数
    pub max_fleets: usize,
    /// 买新船需要的现金倍数（相对船价）
    pub expand_cash_multiple: Fx,
    /// 出航前补给的天数余量
    pub supply_margin_days: i64,
    /// 耐久低于该比例时修理
    pub repair_below: Fx,
    /// 一次买入最多占当地库存的比例
    pub max_stock_share: Fx,
    /// 现金超过该值时每年投资本据港
    pub invest_above: Money,
    /// 每次投资占现金的比例
    pub invest_share: Fx,
    /// 现金超过该值时建设产业
    pub industry_above: Money,
    /// 期货投机：价格动量超过该比例时建仓
    pub futures_momentum: Fx,
    /// 商会 2.0（ECONOMY.md 6.7）：按预测选货选线、一船多货、套保、许可证、按净资产加舰队、老船退役、分红、对玩家的反应；
    /// 关闭时与旧版逐日一致（参数见 [`CommerceRules`]）
    pub v2: CommerceRules,
}

/// 商会 2.0 的参数（`rules.toml [npc]` 的 v2 部分，ECONOMY.md 6.7）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CommerceRules {
    pub enabled: bool,
    /// 净资产每多这么多，舰队上限在 `max_fleets` 之上加一支
    pub fleets_per_worth: Money,
    /// 舰队上限的上限
    pub max_fleets_cap: usize,
    /// 船龄超过这么多年的船在有船厂的港口换新（0 表示不换）
    pub retire_years: u32,
    /// 年末把超出储备的现金按这个比例作为分红派出（流出世界；E8 起流回本据港的城镇钱袋）
    pub dividend_share: Fx,
    /// 储备 = 本据港船厂最贵的船价 × 该值
    pub reserve_ships: i64,
    /// 装着期货品种驶往它的交割港时开空头套保
    pub hedge: bool,
    /// 对玩家近期交易量大的市场：跟进型的评分加成、回避型的评分折扣（最多这么多）
    pub player_reaction: Fx,
    /// 现金超过许可证价格的这么多倍时买本国的许可证
    pub license_multiple: i64,
}

impl Default for CommerceRules {
    fn default() -> Self {
        CommerceRules {
            enabled: false,
            fleets_per_worth: 1_000_000,
            max_fleets_cap: 8,
            retire_years: 20,
            dividend_share: Fx::from_pct(30),
            reserve_ships: 3,
            hedge: true,
            player_reaction: Fx::from_pct(30),
            license_multiple: 10,
        }
    }
}

/// 商会预测目的港价格的方法（ECONOMY.md 6.7）。只允许追加。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ForecastMethod {
    /// 照旧：抵达时还是今天的价
    #[default]
    Naive,
    /// 顺势：按最近两周的走势外推
    Trend,
    /// 回归：向正常价回归（每天回归 3%）
    Revert,
}

impl ForecastMethod {
    pub const ALL: [ForecastMethod; 3] = [ForecastMethod::Naive, ForecastMethod::Trend, ForecastMethod::Revert];

    pub fn key(self) -> &'static str {
        match self {
            ForecastMethod::Naive => "naive",
            ForecastMethod::Trend => "trend",
            ForecastMethod::Revert => "revert",
        }
    }

    pub fn from_key(key: &str) -> Option<ForecastMethod> {
        ForecastMethod::ALL.into_iter().find(|m| m.key() == key)
    }

    pub fn index(self) -> usize {
        self as usize
    }
}

/// 商会对玩家的反应（ECONOMY.md 6.7）：玩家长期占着的市场，跟进型也去做，回避型转向别处。只允许追加。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Reaction {
    #[default]
    Neutral,
    Follow,
    Avoid,
}

impl Reaction {
    pub fn key(self) -> &'static str {
        match self {
            Reaction::Neutral => "neutral",
            Reaction::Follow => "follow",
            Reaction::Avoid => "avoid",
        }
    }

    pub fn from_key(key: &str) -> Option<Reaction> {
        [Reaction::Neutral, Reaction::Follow, Reaction::Avoid].into_iter().find(|r| r.key() == key)
    }
}

#[derive(Clone, Debug)]
pub struct WarehouseRules {
    /// 租用：每 100 单位容量每日租金
    pub rent_per_100: Money,
    /// 购买：每单位容量价格
    pub price_per_unit: Money,
    /// 超出容量部分：每 100 单位每日滞仓费
    pub demurrage_per_100: Money,
    /// 同盟港商馆提供的免费容量
    pub ally_free_capacity: i64,
}

#[derive(Clone, Debug)]
pub struct CaravanRules {
    /// 护卫每日工资
    pub guard_wage: Money,
    /// 雇佣一名护卫的费用
    pub guard_hire_cost: Money,
    /// 治安为 0 时的每日劫掠概率（万分比）
    pub robbery_bp: i64,
    /// 解散时驮畜回收比例
    pub resale: Fx,
}

#[derive(Clone, Debug)]
pub struct ContractRules {
    /// 每个势力每月发布的委托数量
    pub per_faction_per_month: u32,
    /// 旧规则报酬 = 货值 × 该系数 × (1 + 期限天数 / 30)
    pub reward_factor: Fx,
    /// 罚金占报酬的比例
    pub penalty_share: Fx,
    /// 完成 / 违约的声望变化
    pub reputation_gain: i64,
    pub reputation_loss: i64,
    /// 交付的货物进入目的港市场（ECONOMY.md 6.4；关闭时交付的货物直接消失，与旧版一致）
    pub deliver_to_market: bool,
    pub v2: crate::contract::ContractV2Rules,
}

#[derive(Clone, Debug)]
pub struct InvestRules {
    /// 发展度每点的基础投资额
    pub cost_per_point: Money,
    /// 最小投资额
    pub min_amount: Money,
    /// 成为同盟港所需的最低占有率
    pub ally_share: Fx,
    /// 同盟港的交易税折扣（乘数）
    pub ally_tax: Fx,
    /// 同盟港特产商品的价格折扣
    pub ally_specialty_discount: Fx,
    /// 超出初值的发展度每隔这么多个月衰减 1 点（缺省 1：每月，与旧版一致）
    pub decay_months: u32,
}

#[derive(Clone, Debug)]
pub struct BankRules {
    /// 存款年利率
    pub deposit_rate: Fx,
    /// 贷款基础年利率
    pub loan_base_rate: Fx,
    /// 信用最差时额外的年利率
    pub loan_risk_premium: Fx,
    /// 最长贷款期限（月）
    pub max_term_months: u32,
    /// 逾期后利率上浮比例
    pub overdue_penalty: Fx,
}

#[derive(Clone, Debug)]
pub struct DiplomacyRules {
    /// 每日发生外交摩擦或示好的概率（万分比，每对势力）
    pub incident_bp: i64,
    /// 关系低于该值由和平转为紧张
    pub tension_below: i64,
    /// 关系高于该值由紧张回到和平
    pub peace_above: i64,
    /// 关系低于该值且紧张持续足够久时开战
    pub war_below: i64,
    /// 紧张持续多少天后才可能开战
    pub war_min_tension_days: u32,
    /// 战争至少持续多少天
    pub war_min_days: u32,
    /// 停战持续多少天
    pub truce_days: u32,
    /// 战时交易税加成（乘数）
    pub war_tax: Fx,
    /// 购买许可证所需的最低声望
    pub license_reputation: i64,
}

/// 海区。
#[derive(Clone, Debug)]
pub struct RegionDef {
    pub key: String,
    pub name: String,
    /// 覆盖的矩形范围（含端点）
    pub rect: (u16, u16, u16, u16),
    /// 各季节天气
    pub seasons: [SeasonWeather; 4],
    /// 气候（`regions.toml` 的可选字段 `climate`，缺省按纬度推断）：决定各天况的季节频率
    pub climate: crate::weather::Climate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SeasonWeather {
    /// 风的去向（0=北，顺时针 8 方向）
    pub wind_dir: u8,
    /// 风力 0–10
    pub wind_strength: i64,
    /// 洋流去向
    pub current_dir: u8,
    /// 洋流强度 0–3
    pub current_strength: i64,
    /// 每日风暴概率（万分比）
    pub storm_bp: i64,
    /// 每日海盗遭遇概率（万分比）
    pub pirate_bp: i64,
}

/// 商品。
#[derive(Clone, Debug)]
pub struct GoodDef {
    pub key: String,
    pub name: String,
    pub category: String,
    /// 加工层级：0 为原料，1–3 为加工品
    pub tier: u8,
    pub base_price: Money,
    /// 各季节需求系数
    pub season_demand: [Fx; 4],
    /// 各季节产量系数（作物收获季等）
    pub season_supply: [Fx; 4],
    /// 需要所在势力的许可证才能买卖
    pub license: bool,
    /// 介绍文字（界面显示，可为空）
    pub description: String,
    /// 按季播种的作物：本地生产者的扩产或减产到下一季开始才生效（ECONOMY.md 6.3）
    pub crop: bool,
    /// 需求层级（ECONOMY.md 6.4）：没有层级的是生产资料，需求不随繁荣度变、不计入满足度
    pub need: Option<NeedTier>,
    /// 替代组（`goods.toml` 的 `group`，按首次出现的顺序编号）：同组商品满足同一种需求，按价格分摊（ECONOMY.md 6.4）
    pub group: Option<u16>,
    /// 货档（`goods.toml` 的可选字段 `rank`，0–3，缺省 0）：买入要的商誉见 [`AccessRules::rank_goodwill`]；
    /// `[access]` 关闭时不起作用（T01）
    pub rank: u8,
    pub secret: bool,
    pub rumor: String,
}

/// 地点类型（只允许追加）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LocKind {
    Port,
    City,
    /// 可殖民地点：与陆地相邻的海格锚地，建立殖民地之前没有市场与设施
    Site,
}

/// 地点（港口、内陆城市或可殖民地点）。
#[derive(Clone, Debug)]
pub struct LocationDef {
    pub shop: bool,
    pub culture: String,
    pub size: u8,
    pub hemisphere: crate::calendar::Hemisphere,
    pub key: String,
    pub name: String,
    pub kind: LocKind,
    /// 港口与殖民点为停泊海格；城市为所在陆格
    pub cell: crate::ids::Cell,
    /// 所属势力；殖民点不属于任何势力，此处为占位的 0 号势力
    pub faction: FactionId,
    /// 初始发展度（1–100）
    pub development: i64,
    pub shipyard: Vec<ShipTypeId>,
    pub market: Vec<MarketDef>,
    /// 建城年份（纪年）；未写为 None
    pub founded: Option<i64>,
    /// 简史（可为空）
    pub lore: String,
    /// 殖民点的自然条件（只有殖民点有）
    pub site: Option<SiteDef>,
    /// 城镇工坊（`data/workshops.toml`，按文件中的顺序；ECONOMY.md 6.5）
    pub workshops: Vec<WorkshopDef>,
    /// 开放市场（[`crate::open_market`]）：特产以外也出售的清单里的商品（`world/*.toml` 的 sells；
    /// 新大陆的殖民港出售殖民地的建材与口粮）；开放市场关闭时不起作用
    pub sells: Vec<GoodId>,
    /// E03：仅收录带条件的市场条目，保持作者顺序。
    pub unlocks: Vec<MarketUnlockDef>,
}

impl LocationDef {
    pub fn is_port(&self) -> bool {
        self.kind == LocKind::Port
    }
    pub fn is_site(&self) -> bool {
        self.kind == LocKind::Site
    }

    /// 城镇工坊接手的这种商品均衡产量的份额（没有工坊时为 0）。
    pub fn workshop_share(&self, good: GoodId) -> Fx {
        self.workshops.iter().filter(|w| w.output == good).fold(Fx::ZERO, |s, w| s + w.share)
    }

    /// 市场清单里这种商品的参数（清单里没有时为 None）。
    pub fn listed(&self, good: GoodId) -> Option<&MarketDef> {
        self.market.iter().find(|m| m.good == good)
    }
}

/// 殖民点地形（只允许追加）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SiteTerrain {
    Forest,
    Plains,
    Hills,
    Jungle,
    Tundra,
    Desert,
    Swamp,
    Island,
}

impl SiteTerrain {
    pub const ALL: [SiteTerrain; 8] = [
        SiteTerrain::Forest,
        SiteTerrain::Plains,
        SiteTerrain::Hills,
        SiteTerrain::Jungle,
        SiteTerrain::Tundra,
        SiteTerrain::Desert,
        SiteTerrain::Swamp,
        SiteTerrain::Island,
    ];

    pub fn key(self) -> &'static str {
        match self {
            SiteTerrain::Forest => "forest",
            SiteTerrain::Plains => "plains",
            SiteTerrain::Hills => "hills",
            SiteTerrain::Jungle => "jungle",
            SiteTerrain::Tundra => "tundra",
            SiteTerrain::Desert => "desert",
            SiteTerrain::Swamp => "swamp",
            SiteTerrain::Island => "island",
        }
    }

    pub fn parse(s: &str) -> Option<SiteTerrain> {
        SiteTerrain::ALL.iter().copied().find(|t| t.key() == s)
    }
}

/// 殖民点的自然条件。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SiteDef {
    pub terrain: SiteTerrain,
    /// 肥力 1–100：粮食类建筑的产量系数（%）
    pub fertility: i64,
    /// 危险度 1–100：疾病与袭击风险
    pub hazard: i64,
    /// 可开采资源：（商品, 丰度 1–100）
    pub resources: Vec<(GoodId, i64)>,
}

/// 殖民地建筑的种类（只允许追加）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BuildingKind {
    /// 粮食：产出 goods 中的一种，产量乘地点肥力
    Food,
    /// 采集：产出 goods 与地点资源的交集中丰度最高的一种，产量乘资源丰度
    Extract,
    /// 加工：按 inputs → outputs 转化
    Process,
    /// 仓储：增加仓储容量
    Storage,
    /// 防御：降低袭击概率与损失
    Defense,
    /// 士气：提高士气目标
    Morale,
    /// 码头：可在当地补给粮水、修船
    Dock,
    /// 住宅：提高人口上限
    Housing,
}

impl BuildingKind {
    pub const ALL: [BuildingKind; 8] = [
        BuildingKind::Food,
        BuildingKind::Extract,
        BuildingKind::Process,
        BuildingKind::Storage,
        BuildingKind::Defense,
        BuildingKind::Morale,
        BuildingKind::Dock,
        BuildingKind::Housing,
    ];

    pub fn key(self) -> &'static str {
        match self {
            BuildingKind::Food => "food",
            BuildingKind::Extract => "extract",
            BuildingKind::Process => "process",
            BuildingKind::Storage => "storage",
            BuildingKind::Defense => "defense",
            BuildingKind::Morale => "morale",
            BuildingKind::Dock => "dock",
            BuildingKind::Housing => "housing",
        }
    }

    pub fn parse(s: &str) -> Option<BuildingKind> {
        BuildingKind::ALL.iter().copied().find(|t| t.key() == s)
    }
}

/// 殖民地建筑（`data/colony.toml`）。数值均为"每级"。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ColonyBuildingDef {
    pub key: String,
    pub name: String,
    pub kind: BuildingKind,
    /// 每级建造费
    pub cost: Money,
    /// 每级从殖民地库存扣除的建材
    pub materials: Vec<(GoodId, i64)>,
    pub build_days: u32,
    /// 每级需要的人口
    pub workers: i64,
    /// 每级每月维护费
    pub upkeep: Money,
    pub max_level: u8,
    /// 粮食 / 采集：可产出的商品
    pub goods: Vec<GoodId>,
    /// 粮食 / 采集：每级每天基础产量
    pub output: i64,
    /// 加工：每级每天投入
    pub inputs: Vec<(GoodId, i64)>,
    /// 加工：每级每天产出
    pub outputs: Vec<(GoodId, i64)>,
    /// 仓储：每级增加的容量
    pub capacity: i64,
    /// 防御：每级防御值（百分点）
    pub defense: i64,
    /// 士气：每级士气目标加成
    pub morale: i64,
    /// 住宅：每级人口上限加成
    pub housing: i64,
    /// 介绍文字（可为空）
    pub description: String,
}

/// 发现物的种类（只允许追加）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiscoveryKind {
    Ruins,
    Wonder,
    Wreck,
    Relic,
    Beast,
    Landmark,
    Animal,
    Plant,
    Fallen,
    Phantom,
}

impl DiscoveryKind {
    pub const ALL: [DiscoveryKind; 10] = [
        DiscoveryKind::Ruins,
        DiscoveryKind::Wonder,
        DiscoveryKind::Wreck,
        DiscoveryKind::Relic,
        DiscoveryKind::Beast,
        DiscoveryKind::Landmark,
        DiscoveryKind::Animal,
        DiscoveryKind::Plant,
        DiscoveryKind::Fallen,
        DiscoveryKind::Phantom,
    ];

    pub fn key(self) -> &'static str {
        match self {
            DiscoveryKind::Ruins => "ruins",
            DiscoveryKind::Wonder => "wonder",
            DiscoveryKind::Wreck => "wreck",
            DiscoveryKind::Relic => "relic",
            DiscoveryKind::Beast => "beast",
            DiscoveryKind::Landmark => "landmark",
            DiscoveryKind::Animal => "animal",
            DiscoveryKind::Plant => "plant",
            DiscoveryKind::Fallen => "fallen",
            DiscoveryKind::Phantom => "phantom",
        }
    }

    pub fn parse(s: &str) -> Option<DiscoveryKind> {
        DiscoveryKind::ALL.iter().copied().find(|t| t.key() == s)
    }
}

/// 发现物（`data/world/discoveries.toml`）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DiscoveryDef {
    pub key: String,
    pub name: String,
    /// 所在格（海或陆）
    pub cell: crate::ids::Cell,
    pub kind: DiscoveryKind,
    /// 报告后获得的名声
    pub fame: i64,
    /// 报告后获得的赏金
    pub value: Money,
    pub lore: String,
}

/// 某地某商品的市场参数。
#[derive(Clone, Debug)]
pub struct MarketDef {
    pub good: GoodId,
    /// 均衡时的日产量
    pub supply: i64,
    /// 目标库存下的日消耗
    pub demand: i64,
    /// 特产标记
    pub specialty: bool,
}

/// 帆装类型。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SailType {
    /// 横帆：顺风快、逆风慢
    Square,
    /// 纵帆：逆风性能好
    Lateen,
}

/// 船型。
#[derive(Clone, Debug)]
pub struct ShipTypeDef {
    pub key: String,
    pub name: String,
    pub sail: SailType,
    /// 基础航速（格 / 天）
    pub speed: Fx,
    pub capacity: i64,
    pub durability: i64,
    pub crew_min: i64,
    pub crew_max: i64,
    pub guns: i64,
    pub price: Money,
    /// 介绍文字（界面显示，可为空）
    pub description: String,
    /// 独有船型：船厂不出售、不能建造、NPC 与海盗不使用
    pub unique: bool,
}

/// 船只改造项目。
#[derive(Clone, Debug)]
pub struct RefitDef {
    pub key: String,
    pub name: String,
    pub price: Money,
    pub capacity: i64,
    pub durability: i64,
    pub guns: i64,
    pub speed: Fx,
}

/// 势力。
#[derive(Clone, Debug)]
pub struct FactionDef {
    pub key: String,
    pub name: String,
    /// 基础交易税率
    pub tax: Fx,
    /// 许可证价格
    pub license_price: Money,
    /// 私掠许可价格
    pub marque_price: Money,
    /// 建筑风格（文化名，如 mediterranean）；未写为 None
    pub style: Option<String>,
    /// 地图配色（#rrggbb）；未写为 None
    pub color: Option<String>,
}

/// 势力建筑风格的合法取值。
pub const FACTION_STYLES: [&str; 7] =
    ["mediterranean", "nordic", "lowland", "desert", "islands", "eastern", "frontier"];

/// 两个势力之间的基准关系。
#[derive(Clone, Debug)]
pub struct RelationDef {
    pub a: FactionId,
    pub b: FactionId,
    /// 基准关系值 −100–100
    pub value: i64,
}

/// NPC 商会。
#[derive(Clone, Debug)]
pub struct CompanyDef {
    pub key: String,
    pub name: String,
    /// 性格（商会展望的提示词用，ECONOMY.md 8.2；可为空）
    pub persona: String,
    pub home: LocId,
    pub cash: Money,
    pub ships: Vec<ShipTypeId>,
    pub preferred: Vec<GoodId>,
    /// 风险偏好：单次投入占现金的比例
    pub risk: Fx,
    /// 偏好的预测方法（商会 2.0；业绩差时换）
    pub forecast: ForecastMethod,
    /// 对玩家的反应（商会 2.0）
    pub reaction: Reaction,
}

/// 开局剧本。
#[derive(Clone, Debug)]
pub struct ScenarioDef {
    pub key: String,
    pub name: String,
    pub description: String,
    pub start: LocId,
    /// 起始地点的明确名称；start 保留为旧接口的别名。
    pub start_loc: LocId,
    pub start_date: crate::scenario::WorldDate,
    pub control_date: crate::scenario::WorldDate,
    pub protagonists: Vec<String>,
    pub templates: Vec<String>,
    pub upbringing: bool,
    pub timeline: Option<String>,
    pub protagonist_defs: Vec<crate::scenario::ProtagonistDef>,
    pub template_defs: Vec<crate::scenario::TemplateDef>,
    pub cash: Money,
    pub ships: Vec<ShipTypeId>,
    pub crew: i64,
    /// 开局即受雇的航海士
    pub mates: Vec<MateId>,
    /// 开局声望
    pub reputation: Vec<(FactionId, i64)>,
    pub goal: Goal,
    /// 破产重组次数达到该值即失败（0 表示不限）
    pub max_reorganizations: u32,
    /// 开局货物：装在开局舰队的货舱，按商品基准价记入存货成本、计入实收资本（可以为空）
    pub cargo: Vec<(GoodId, i64)>,
    /// 开局粮水（单位同补给；与货物一起占用舱位，不入账）
    pub food: i64,
    pub water: i64,
    /// 在开局界面加亮为“推荐选择”
    pub recommended: bool,
    /// 挂的故事线（[`crate::story::StoryDefs::stories`] 的下标）
    pub story: Option<usize>,
    /// 带主角的剧本：主角的名字、外貌、生日、身世与属性都已定好（推荐角色）
    pub hero: Option<HeroDef>,
}

/// 推荐角色：开局剧本里定好的主角。姓名与外貌只在应用层（界面与存档元数据）；身世以 `CreateCaptain` 立档。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeroDef {
    pub name: String,
    /// 外貌编号：专属头像（[`HERO_LOOK_MIN`] 以上，只给这位角色用）或普通外貌
    pub look: u32,
    /// 一句话介绍
    pub tagline: String,
    /// 小传
    pub bio: String,
    /// 生日（月、日）与开局年龄
    pub month: u32,
    pub day: u32,
    pub age: i64,
    /// 身世五问的回答（选项 key，按问题顺序；可以是只给这位角色的选项）
    pub answers: Vec<String>,
    /// 六项属性的自由分配点
    pub alloc: Vec<i64>,
    /// 开局自选的奇才之法（算学够高时）
    pub genius: Option<String>,
}

/// 推荐角色专属外貌的最小编号：100 起，普通外貌（0–24）都在它下面。
pub const HERO_LOOK_MIN: u32 = 100;

/// 胜利目标的种类。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum GoalKind {
    /// 净资产达到目标
    NetWorth(Money),
    /// 成为若干港口的同盟商号
    AllyPorts(u32),
    /// 自由沙盒：没有胜利条件
    Sandbox,
    /// 拥有至少 count 个人口不少于 population 的殖民地
    Colonies { count: u32, population: i64 },
    /// 走完剧本挂的故事线（推荐角色）
    Story,
}

/// 剧本目标。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Goal {
    pub kind: GoalKind,
    /// 须在第几天之前达成（不含）；None 表示不限期
    pub deadline: Option<u32>,
}

/// 航海士。
#[derive(Clone, Debug)]
pub struct MateDef {
    /// 经典四项以外的能力初值；等级成长由查询推导。
    pub abilities: std::collections::BTreeMap<String, i64>,
    pub key: String,
    pub name: String,
    /// 外貌与小传（纯装饰）
    pub bio: String,
    /// 在哪个港口的酒馆可以招募
    pub home: LocId,
    /// 航海、交易、战斗、管理能力（1–100）
    pub navigation: i64,
    pub trade: i64,
    pub combat: i64,
    pub management: i64,
    pub level: i64,
    /// 月薪
    pub salary: Money,
    pub hire_cost: Money,
    /// 初始忠诚（0–100）
    pub loyalty: i64,
    /// 隐藏的航海士：酒馆里不出现、不能招募，只能通过特殊途径加入
    pub hidden: bool,
    /// 算学奇才掌握的行情预测方法（key 见 [`crate::mates::GENIUS_METHODS`]；方法在界面实现，内核只记下谁会）
    pub methods: Vec<String>,
}

/// 驮畜或车辆。
#[derive(Clone, Debug)]
pub struct AnimalDef {
    pub key: String,
    pub name: String,
    /// 每头（辆）载量
    pub capacity: i64,
    /// 基础速度（格 / 天）
    pub speed: Fx,
    pub price: Money,
    /// 每头（辆）每日开销（草料、车夫等，在驿站补给）
    pub upkeep: Money,
    /// 沙漠道路上的速度系数
    pub desert: Fx,
}

/// 道路地形。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum RoadTerrain {
    Plain,
    Hill,
    Forest,
    Mountain,
    Desert,
}

impl RoadTerrain {
    /// 地形速度系数。
    pub fn speed(self) -> Fx {
        match self {
            RoadTerrain::Plain => Fx::ONE,
            RoadTerrain::Hill => Fx::from_pct(80),
            RoadTerrain::Forest => Fx::from_pct(80),
            RoadTerrain::Mountain => Fx::from_pct(60),
            RoadTerrain::Desert => Fx::from_pct(70),
        }
    }
}

/// 道路（连接两个地点，双向）。
#[derive(Clone, Debug)]
pub struct RoadDef {
    pub key: String,
    pub from: LocId,
    pub to: LocId,
    /// 长度（格）
    pub length: Fx,
    pub terrain: RoadTerrain,
    /// 治安 0–1
    pub security: Fx,
    pub faction: FactionId,
    /// 关卡税（按货物基准价值）
    pub toll: Fx,
}

/// 产业类型（种植园、矿场、作坊、工场……）。
#[derive(Clone, Debug)]
pub struct IndustryTypeDef {
    pub key: String,
    pub name: String,
    pub build_cost: Money,
    /// 每级工人数
    pub workers: i64,
    /// 工人日薪
    pub wage: Money,
    /// 每日维护费
    pub maintenance: Money,
    /// 雇佣管理人的日薪
    pub manager_salary: Money,
}

/// 配方：每级每日投入与产出。
#[derive(Clone, Debug)]
pub struct RecipeDef {
    pub key: String,
    pub name: String,
    pub industry: IndustryTypeId,
    pub inputs: Vec<(GoodId, i64)>,
    pub outputs: Vec<(GoodId, i64)>,
}

/// 期货交易所。
#[derive(Clone, Debug)]
pub struct ExchangeDef {
    pub key: String,
    pub name: String,
    pub port: LocId,
    /// 初始保证金比例
    pub initial_margin: Fx,
    /// 维持保证金比例
    pub maintenance_margin: Fx,
    /// 买卖价差（总宽度）
    pub spread: Fx,
    /// 每月持有成本
    pub carry_per_month: Fx,
    /// 每手成交的冲击成本
    pub impact_per_lot: Fx,
    /// 单一参与者每个合约的持仓上限（手）
    pub position_limit: i64,
    /// 交不出货时的惩罚价倍数
    pub penalty: Fx,
    /// 做市方开局资本
    pub house_capital: Money,
}

/// 期货合约规格：标的、每手数量、交割港、最小变动价位；每月到期一个合约，同时挂最近 3 个月。
#[derive(Clone, Debug)]
pub struct FuturesSpecDef {
    pub key: String,
    pub exchange: ExchangeId,
    pub good: GoodId,
    /// 每手数量
    pub lot: i64,
    pub delivery: LocId,
    /// 最小变动价位
    pub tick: Money,
}

/// 任一条件成立后永久开放；MarketDef 保持原结构。
#[derive(Clone, Debug)]
pub struct MarketUnlockDef {
    pub good: GoodId,
    pub stage: Option<u8>,
    pub discovery: Option<DiscoveryId>,
    pub creature: Option<String>,
    pub visited: Option<LocId>,
    pub limit: Option<i64>,
}
