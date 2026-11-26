//! `data/` 中各文件的原始 TOML 结构。字段一律拒绝未知键，拼写错误会被报告。

use serde::Deserialize;

/// 小数（TOML 中可写整数或小数），转换为定点数时四舍五入到万分之一。
#[derive(Clone, Copy, Debug, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Dec {
    Int(i64),
    Float(f64),
}

impl Dec {
    pub fn value(self) -> f64 {
        match self {
            Dec::Int(i) => i as f64,
            Dec::Float(f) => f,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RulesFile {
    #[serde(default)]
    pub upbringing: manifest_core::defs::UpbringingWorldRules,
    /// 事件节奏的闸与预算（P11）；缺省关闭
    #[serde(default)]
    pub pacing: manifest_core::defs::PacingRules,
    /// 岗位与装备在海上的效果（H01）；缺省关闭
    #[serde(default)]
    pub voyage_posts: manifest_core::seafaring::PostsRules,
    /// 船况、口粮与船员状态（H02）；缺省关闭
    #[serde(default)]
    pub voyage_wear: manifest_core::seafaring::WearRules,
    /// 岸与锚地（H05）；缺省关闭
    #[serde(default)]
    pub shore_tasks: manifest_core::seafaring::ShoreRules,
    /// 天气团（H03）；缺省关闭
    #[serde(default)]
    pub weather_cells: manifest_core::weather_cells::WeatherCellRules,
    /// 海盗按分钟追击（H03）；缺省关闭
    #[serde(default)]
    pub pursuit: manifest_core::navigation::pursuit::PursuitRules,
    /// 海上所见（H04）；缺省关闭
    #[serde(default)]
    pub sightings: manifest_core::sightings::SightingRules,
    /// 喊话、结伴（H06）；缺省关闭
    #[serde(default)]
    pub hail: manifest_core::hail::HailRules,
    /// 航海日志与航程总结（H08）；缺省关闭
    #[serde(default)]
    pub voyage_log: manifest_core::voyage_log::VoyageLogRules,
    /// 甲板闲话（H08）；缺省关闭
    #[serde(default)]
    pub banter: manifest_core::banter::BanterRules,
    /// 航线规划（H07）；缺省关闭
    #[serde(default)]
    pub routing: manifest_core::navigation::routing::RoutingRules,
    /// 商馆分红与遭劫（T02）；缺省关闭
    #[serde(default)]
    pub dividends: manifest_core::house::DividendRules,
    /// 船厂随发展度放大船（T02）；缺省关闭
    #[serde(default)]
    pub shipyard_growth: manifest_core::house::ShipyardGrowthRules,
    /// 商会跟投（T02）；缺省关闭
    #[serde(default)]
    pub npc_invest: manifest_core::house::NpcInvestRules,
    /// 商馆代办与产业位（T03）；缺省关闭
    #[serde(default)]
    pub agency: manifest_core::agency::AgencyRules,
    /// 技能效果生效（K01）；缺省关闭
    #[serde(default)]
    pub skill_effects: manifest_core::skills::SkillEffectsRules,
    /// 故事选项的掷骰规则（U02）；缺省关闭
    pub story: Option<manifest_core::story2::dice::StoryRules>,
    pub items: Option<manifest_core::items::ItemsRules>,
    pub ships: Option<manifest_core::legend_ships::Rules>,
    pub attributes: Option<std::collections::BTreeMap<String, i64>>,
    pub market: MarketRules,
    pub voyage: VoyageRules,
    pub npc: NpcRulesRaw,
    pub credit: CreditRules,
    pub warehouse: WarehouseRulesRaw,
    pub caravan: CaravanRulesRaw,
    pub contracts: ContractRulesRaw,
    pub invest: InvestRulesRaw,
    pub bank: BankRulesRaw,
    pub diplomacy: DiplomacyRulesRaw,
    pub mates: MateRulesRaw,
    pub pirates: PirateRulesRaw,
    pub battle: BattleRulesRaw,
    pub explore: ExploreRulesRaw,
    /// 世界配置（货币、纪年）；缺省取默认值
    pub world: Option<WorldRulesRaw>,
    /// 殖民地规则；缺省取默认值
    pub colony: Option<ColonyRulesRaw>,
    /// 探险发现与名声；缺省取默认值
    pub discovery: Option<DiscoveryRulesRaw>,
    /// 每日天气；缺省取默认值
    pub weather: Option<WeatherRulesRaw>,
    /// 本地生产者与供给响应（ECONOMY.md 6.3）；缺省两个开关都关
    pub producers: Option<ProducersRaw>,
    /// 人口、繁荣度与需求层级（ECONOMY.md 6.4）；缺省关闭
    pub population: Option<PopulationRaw>,
    /// 城镇工坊（ECONOMY.md 6.5）；缺省关闭
    pub workshops: Option<WorkshopRulesRaw>,
    /// 舰队补给的口粮从当地市场买（ECONOMY.md 6.4）；缺省关闭
    pub provisions: Option<ProvisionsRaw>,
    /// 本地商人的预期与囤货（ECONOMY.md 6.6、8.3）；缺省关闭
    pub merchants: Option<MerchantsRaw>,
    /// 信息时效（ECONOMY.md 第 7 节）：告示板与行情通报；缺省用内置值（模式在开局时选）
    pub info: Option<InfoRaw>,
    /// 势力的经济政策的规则触发（ECONOMY.md 6.10）；缺省关闭
    pub policies: Option<PoliciesRaw>,
    /// 货币流通（ECONOMY.md 6.9）：城镇钱袋、腹地、流动性、势力国库与财政；缺省关闭
    pub money: Option<MoneyRaw>,
    /// 商馆、货档与商誉（T01）；缺省关闭
    pub access: Option<AccessRaw>,
    /// E02：发展度新尺度与月度增长；缺省关闭。
    #[serde(default)]
    pub development: manifest_core::development::DevelopmentRules,
    #[serde(default)]
    pub quests: manifest_core::story2::guide_defs::QuestRules,
    #[serde(default)]
    pub trade_books: manifest_core::trade_books::TradeBooksRules,
    /// H10b：自动驾驶视线拉直。
    #[serde(default)]
    pub autopilot: manifest_core::navigation::line_pilot::AutopilotRules,
    #[serde(default)]
    pub stage_unlocks: manifest_core::stages::StageUnlockRules,
    #[serde(default)]
    pub rare: manifest_core::stages::RareRules,
}

/// `rules.toml [access]`：商馆、货档与商誉（T01，`manifest_core::defs::AccessRules`）。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccessRaw {
    pub enabled: bool,
    pub rank_goodwill: Vec<i64>,
    pub house_goodwill: Vec<i64>,
    pub house_tax: Vec<Dec>,
    pub house_storage: Vec<i64>,
    pub house_base: i64,
    pub house_step: i64,
    pub ally_house: usize,
    pub floor_goods: usize,
    pub trade_rep_base: i64,
    pub trade_rep_per: i64,
    pub trade_rep_cap: i64,
    pub invest_rep_per: i64,
    pub invest_rep_max: i64,
    pub company_goodwill: i64,
    pub grace_days: u32,
    /// 不能投资的地点（内陆城市等）买入各档要的商誉（T02）；不写时与 rank_goodwill 相同
    #[serde(default)]
    pub inland_goodwill: Option<Vec<i64>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoneyRaw {
    pub enabled: bool,
    pub income_per_capita: Dec,
    pub leak: Dec,
    pub liquidity_root: i64,
    pub liquidity_floor: Dec,
    pub liquidity_cap: Dec,
    pub bank_reserve: i64,
    pub treasury_days: i64,
    pub reserve_months: i64,
    pub spend_rate: Dec,
    pub catch_up_months: i64,
    pub works_share: Dec,
    pub works_cap: i64,
    pub patrol_cost: i64,
    pub navy_cut: Dec,
    pub war_share: Dec,
    pub claim_cost: i64,
    pub deficit_months: i64,
    pub surplus_months: i64,
    pub tax_step: Dec,
    pub tax_min: Dec,
    pub tax_max: Dec,
    pub company_overhead: Dec,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PoliciesRaw {
    pub enabled: bool,
    pub staples: Vec<String>,
    pub staple_ratio: Dec,
    pub ban_days: i64,
    pub export_share: Dec,
    pub export_tax: Dec,
    pub export_tax_days: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InfoRaw {
    pub board_days: i64,
    pub report_base: i64,
    pub report_per_port: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MerchantsRaw {
    pub enabled: bool,
    pub memory: Dec,
    pub inertia: Dec,
    pub intensity: Dec,
    pub min_share: Dec,
    pub scale: i64,
    pub anchor_days: i64,
    pub hoard_base: Dec,
    pub hoard_max: Dec,
    pub hoard_speed: Dec,
    pub hoard_adjust: Dec,
    pub holding_cost: Dec,
    pub rumor_amplitude: Dec,
    pub rumor_decay: Dec,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PopulationRaw {
    pub enabled: bool,
    pub per_development: i64,
    pub min_ratio: Dec,
    pub max_ratio: Dec,
    pub growth: Dec,
    pub prosperity_daily: Dec,
    pub sensitivity: Dec,
    pub weights: [Dec; 3],
    pub elasticity: [Dec; 3],
    pub tier_min: Dec,
    pub tier_max: Dec,
    pub substitution_rate: Dec,
    pub substitution_cap: Dec,
    pub famine: [Dec; 2],
    pub depression: [Dec; 2],
    pub boom: [Dec; 2],
    pub glut: [Dec; 2],
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkshopRulesRaw {
    pub enabled: bool,
    pub min_ratio: Dec,
    pub max_ratio: Dec,
    pub stop_below: Dec,
    pub restart_above: Dec,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProvisionsRaw {
    pub local: bool,
    pub goods: Vec<String>,
    pub rations: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProducersRaw {
    pub enabled: bool,
    pub fractional: bool,
    pub expect_lambda: Dec,
    pub kappa: Dec,
    pub gap_cap: Dec,
    pub min_ratio: Dec,
    pub max_ratio: Dec,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WeatherRulesRaw {
    /// 天气系统的平均长度（天）
    pub system_days: u32,
    /// 海区没写 climate 时按矩形中心行号推断：< 第一项寒冷、< 第二项温和、< 第三项干燥、其余热带
    pub latitude_bands: [i64; 3],
    /// 风向锚点偏移 −2..+2 的权重
    pub wind_dir_weights: [i64; 5],
    /// 风力锚点偏移 −3..+3 的权重
    pub wind_strength_weights: [i64; 7],
    /// 暴风雨当天海上舰队受损的基准概率
    pub storm_hit: Dec,
    /// 暴风雨天数占比的上限
    pub storm_max: Dec,
    pub temperate: ClimateRaw,
    pub cold: ClimateRaw,
    pub arid: ClimateRaw,
    pub tropical: ClimateRaw,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClimateRaw {
    /// 四季非暴风雨天气系统的权重：[晴, 多云, 雨, 雾]
    pub spring: [i64; 4],
    pub summer: [i64; 4],
    pub autumn: [i64; 4],
    pub winter: [i64; 4],
    /// 四季的暴风雨频率系数
    pub storm: [Dec; 4],
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorldRulesRaw {
    pub currency: String,
    pub era: String,
    pub start_year: i64,
    /// v3 及更早存档的迷雾位图按此尺寸解释
    pub legacy_map_size: Option<[i64; 2]>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColonyRulesRaw {
    pub min_settlers: i64,
    pub found_cost: i64,
    pub found_materials: Vec<GoodQty>,
    pub found_consume: Dec,
    pub found_fame: i64,
    pub base_capacity: i64,
    pub base_housing: i64,
    pub food_category: String,
    pub food_per_100: i64,
    pub growth_bp: i64,
    pub immigration_per_morale: i64,
    pub starve_loss_bp: i64,
    pub tax_per_100: i64,
    pub tax_levels: Vec<[i64; 2]>,
    pub default_tax: u8,
    pub morale_goods: Vec<MoraleGoodRaw>,
    pub morale_goods_bonus: i64,
    pub morale_base: i64,
    pub start_morale: i64,
    pub starve_morale: i64,
    pub raid_morale: i64,
    pub raid_scale: Dec,
    pub raid_cooldown_days: u32,
    pub raid_loss_pct: [i64; 2],
    pub raid_death_pct: [i64; 2],
    pub disease_bp_per_hazard: i64,
    pub disease_death_pct: [i64; 2],
    pub claim_chance_bp: i64,
    pub max_claims_per_faction: usize,
    /// 殖民竞赛的节奏（缺省为不限）
    #[serde(default)]
    pub claim_start_day: u32,
    #[serde(default)]
    pub claim_reach: i64,
    #[serde(default)]
    pub claim_slot_years: u32,
    #[serde(default)]
    pub claim_decay_pct: i64,
    #[serde(default)]
    pub claim_cooldown_days: u32,
    pub max_colonies_per_owner: usize,
    pub max_defense_pct: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoraleGoodRaw {
    pub good: String,
    pub per_100: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiscoveryRulesRaw {
    pub mate_fame_from_level: i64,
    pub mate_fame_per_level: i64,
    pub report_reputation: i64,
    pub fame_per_immigrant: i64,
    /// 发现物传闻所需的玩家名声（缺省 0）
    #[serde(default)]
    pub rumor_min_fame: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarketRules {
    pub price_curve: Vec<[Dec; 2]>,
    pub price_floor: Dec,
    pub price_cap: Dec,
    pub target_stock_days: i64,
    pub production_noise: Dec,
    pub popular_bonus: Dec,
    pub popular_days: u32,
    pub seasonal_popular_chance: Dec,
    pub price_history_days: usize,
    /// 月线保留的个数（旧数据没有这一项，取 36）
    #[serde(default = "default_history_months")]
    pub price_history_months: usize,
    /// 开放市场（各地收购全部商品、出售以特产为主）；缺省关闭
    #[serde(default)]
    pub open: Option<OpenMarketRaw>,
    /// 市场深度曲线（T01）：[发展度, 系数]，发展度高于第一个点时产量与目标库存同乘曲线上的值；
    /// 第一个点必须落在线性公式 0.6 + 0.008 × 发展度 上（相接）。缺省没有（一律线性）
    #[serde(default)]
    pub depth_curve: Option<Vec<[Dec; 2]>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpenMarketRaw {
    pub enabled: bool,
    pub sell_min_ratio: Dec,
    pub sell_min_goods: i64,
    pub ratio_curve: Vec<[Dec; 2]>,
    pub demand_scale: Dec,
    pub min_demand: i64,
    pub road_factor: Dec,
    /// 清单里的进口条目也按贸易距离补背景到货（缺省不补）
    #[serde(default)]
    pub listed_import_inflow: bool,
}

fn default_history_months() -> usize {
    36
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VoyageRules {
    pub crew_wage: i64,
    pub crew_hire_cost: i64,
    pub food_price: i64,
    pub water_price: i64,
    pub crew_per_supply_unit: i64,
    #[serde(default)]
    pub fractional_supplies: bool,
    pub repair_cost_per_point: i64,
    pub ship_resale: Dec,
    pub disease_chance_per_30_days: Dec,
    pub starvation_loss: Dec,
    pub starvation_morale: i64,
    pub morale_decay_after: u32,
    pub mutiny_morale: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NpcRulesRaw {
    pub min_margin: Dec,
    pub max_fleets: usize,
    pub expand_cash_multiple: Dec,
    pub supply_margin_days: i64,
    pub repair_below: Dec,
    pub max_stock_share: Dec,
    pub invest_above: i64,
    pub invest_share: Dec,
    pub industry_above: i64,
    pub futures_momentum: Dec,
    /// 商会 2.0（ECONOMY.md 6.7）；缺省关闭
    #[serde(default)]
    pub v2: Option<CommerceRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommerceRaw {
    pub enabled: bool,
    pub fleets_per_worth: i64,
    pub max_fleets_cap: usize,
    pub retire_years: u32,
    pub dividend_share: Dec,
    pub reserve_ships: i64,
    pub hedge: bool,
    pub player_reaction: Dec,
    pub license_multiple: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreditRules {
    pub insolvency_days: u32,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GoodsFile {
    pub goods: Vec<GoodRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GoodRaw {
    pub key: String,
    pub name: String,
    pub category: String,
    pub tier: u8,
    pub base_price: i64,
    pub season_demand: Option<Vec<Dec>>,
    pub season_supply: Option<Vec<Dec>>,
    #[serde(default)]
    pub license: bool,
    /// 介绍文字（可选）
    #[serde(default)]
    pub description: String,
    /// 按季播种的作物（产能的调整到下一季才生效）
    #[serde(default)]
    pub crop: bool,
    /// 需求层级：essential、comfort、luxury；省略为生产资料
    #[serde(default)]
    pub need: Option<String>,
    /// 替代组：同组商品满足同一种需求
    #[serde(default)]
    pub group: Option<String>,
    /// 货档（0–3，缺省 0）：买入要的商誉见 rules.toml [access]（T01；寰宇由 tools/econ/terra16_ranks.py 生成）
    #[serde(default)]
    pub rank: u8,
    #[serde(default)]
    pub secret: bool,
    pub rumor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShipsFile {
    pub ships: Vec<ShipRaw>,
    #[serde(default)]
    pub refits: Vec<RefitRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShipRaw {
    pub key: String,
    pub name: String,
    pub sail: String,
    pub speed: Dec,
    pub capacity: i64,
    pub durability: i64,
    pub crew_min: i64,
    pub crew_max: i64,
    pub guns: i64,
    pub price: i64,
    /// 介绍文字（可选）
    #[serde(default)]
    pub description: String,
    /// 独有船型：船厂不出售、不能建造、NPC 不使用
    #[serde(default)]
    pub unique: bool,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RefitRaw {
    pub key: String,
    pub name: String,
    pub price: i64,
    #[serde(default)]
    pub capacity: i64,
    #[serde(default)]
    pub durability: i64,
    #[serde(default)]
    pub guns: i64,
    pub speed: Option<Dec>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FactionsFile {
    pub factions: Vec<FactionRaw>,
    #[serde(default)]
    pub relations: Vec<RelationRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FactionRaw {
    pub key: String,
    pub name: String,
    pub tax: Dec,
    pub license_price: i64,
    pub marque_price: i64,
    /// 建筑风格（可选）：mediterranean / nordic / lowland / desert / islands / eastern / frontier
    pub style: Option<String>,
    /// 地图配色（可选）：#rrggbb
    pub color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegionsFile {
    pub regions: Vec<RegionRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RegionRaw {
    pub key: String,
    pub name: String,
    pub rect: [i64; 4],
    /// 气候（可选）：temperate / cold / arid / tropical；缺省按纬度推断
    pub climate: Option<String>,
    /// `world/seas.txt` 中代表本海区的单个字符（可选，EXPANSION §10.3；由 `convert/geo.rs` 校验）
    #[serde(default)]
    pub mark: Option<String>,
    pub spring: WeatherRaw,
    pub summer: WeatherRaw,
    pub autumn: WeatherRaw,
    pub winter: WeatherRaw,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct WeatherRaw {
    pub wind: String,
    pub wind_strength: i64,
    pub current: String,
    pub current_strength: i64,
    pub storm: Dec,
    pub pirate: Dec,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortsFile {
    pub ports: Vec<LocationRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CitiesFile {
    pub cities: Vec<LocationRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LocationRaw {
    #[serde(default)]
    pub shop: bool,
    #[serde(default)]
    pub facilities: Vec<String>,
    #[serde(default)]
    pub culture: String,
    pub size: Option<u8>,
    #[serde(default)]
    pub hemisphere: manifest_core::calendar::Hemisphere,
    pub key: String,
    pub name: String,
    pub pos: [i64; 2],
    pub faction: String,
    pub development: i64,
    #[serde(default)]
    pub shipyard: Vec<String>,
    pub market: Vec<MarketRaw>,
    /// 开放市场：特产以外也出售的商品（必须在 market 清单里；可选）
    #[serde(default)]
    pub sells: Vec<String>,
    /// 建城年份（可选，纪年）
    pub founded: Option<i64>,
    /// 简史（可选）
    #[serde(default)]
    pub lore: String,
}

/// `world/overseas.toml`：海外港口（排在城市之后）与可殖民地点（排在全部港口之后）。
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OverseasFile {
    #[serde(default)]
    pub ports: Vec<LocationRaw>,
    #[serde(default)]
    pub sites: Vec<SiteRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SiteRaw {
    #[serde(default)]
    pub hemisphere: manifest_core::calendar::Hemisphere,
    pub key: String,
    pub name: String,
    pub pos: [i64; 2],
    pub terrain: String,
    pub fertility: i64,
    pub hazard: i64,
    #[serde(default)]
    pub resources: Vec<ResourceRaw>,
    #[serde(default)]
    pub lore: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceRaw {
    pub good: String,
    pub richness: i64,
}

/// `colony.toml`：殖民地建筑。
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColonyFile {
    #[serde(default)]
    pub buildings: Vec<BuildingRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuildingRaw {
    pub key: String,
    pub name: String,
    pub kind: String,
    pub cost: i64,
    #[serde(default)]
    pub materials: Vec<GoodQty>,
    pub build_days: u32,
    #[serde(default)]
    pub workers: i64,
    #[serde(default)]
    pub upkeep: i64,
    pub max_level: u8,
    #[serde(default)]
    pub goods: Vec<String>,
    #[serde(default)]
    pub output: i64,
    #[serde(default)]
    pub inputs: Vec<GoodQty>,
    #[serde(default)]
    pub outputs: Vec<GoodQty>,
    #[serde(default)]
    pub capacity: i64,
    #[serde(default)]
    pub defense: i64,
    #[serde(default)]
    pub morale: i64,
    #[serde(default)]
    pub housing: i64,
    #[serde(default)]
    pub description: String,
}

/// `world/discoveries.toml`：发现物。
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiscoveriesFile {
    #[serde(default)]
    pub discoveries: Vec<DiscoveryRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiscoveryRaw {
    pub key: String,
    pub name: String,
    pub pos: [i64; 2],
    pub kind: String,
    pub fame: i64,
    pub value: i64,
    #[serde(default)]
    pub lore: String,
}

/// `world/rivers.toml`：河流（可选文件）。
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RiversFile {
    #[serde(default)]
    pub rivers: Vec<RiverRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RiverRaw {
    pub key: String,
    pub name: String,
    /// 从源头到入海口的陆格折线
    pub path: Vec<[i64; 2]>,
    pub width: i64,
}

/// `world/landmarks.toml`：地标与奇观（可选文件）。
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LandmarksFile {
    #[serde(default)]
    pub landmarks: Vec<LandmarkRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LandmarkRaw {
    pub key: String,
    pub name: String,
    pub category: String,
    pub kind: String,
    /// 占地左上角
    pub pos: [i64; 2],
    /// 占地宽高（缺省 1 × 1）
    pub size: Option<[i64; 2]>,
    #[serde(default)]
    pub lore: String,
    /// 对应的发现物 key
    pub discovery: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MarketRaw {
    pub good: String,
    pub supply: i64,
    pub demand: i64,
    pub unlock_stage: Option<u8>,
    pub unlock_discovery: Option<String>,
    pub unlock_creature: Option<String>,
    pub unlock_visited: Option<String>,
    pub limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompaniesFile {
    pub companies: Vec<CompanyRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompanyRaw {
    pub key: String,
    pub name: String,
    pub home: String,
    pub cash: i64,
    pub ships: Vec<String>,
    #[serde(default)]
    pub preferred: Vec<String>,
    pub risk: Dec,
    /// 偏好的预测方法：naive / trend / revert（商会 2.0；缺省 naive）
    #[serde(default)]
    pub forecast: Option<String>,
    /// 对玩家的反应：neutral / follow / avoid（商会 2.0；缺省 neutral）
    #[serde(default)]
    pub reaction: Option<String>,
    /// 性格（商会展望的提示词用；可省略）
    #[serde(default)]
    pub persona: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ScenarioRaw {
    pub key: String,
    pub name: String,
    pub description: String,
    pub start: String,
    pub cash: i64,
    pub ships: Vec<String>,
    pub crew: i64,
    #[serde(default)]
    pub mates: Vec<String>,
    #[serde(default)]
    pub reputation: std::collections::BTreeMap<String, i64>,
    pub goal: GoalRaw,
    #[serde(default)]
    pub max_reorganizations: u32,
    /// 开局货物（可选）：[{ good, qty }]，装在开局舰队的货舱
    #[serde(default)]
    pub cargo: Vec<GoodQty>,
    /// 开局粮水（可选）
    #[serde(default)]
    pub food: i64,
    #[serde(default)]
    pub water: i64,
    /// 在开局界面加亮为“推荐选择”（可选）
    #[serde(default)]
    pub recommended: bool,
    /// 挂的故事线（`data/stories/` 下某个文件的 key；可选）
    #[serde(default)]
    pub story: Option<String>,
    /// 定好的主角（推荐角色；可选）
    #[serde(default)]
    pub hero: Option<HeroRaw>,
}

/// 推荐角色（剧本的 `[hero]`）。
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HeroRaw {
    pub name: String,
    pub look: u32,
    pub tagline: String,
    pub bio: String,
    /// 生日 [月, 日]
    pub birthday: [u32; 2],
    pub age: i64,
    pub answers: Vec<String>,
    pub alloc: Vec<i64>,
    #[serde(default)]
    pub genius: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GoalRaw {
    /// net_worth / ally_ports / colonies / sandbox / story
    pub kind: String,
    #[serde(default)]
    pub target: i64,
    /// colonies：每个殖民地至少需要的人口
    #[serde(default)]
    pub population: i64,
    /// 限期（年）；不写表示不限期
    pub years: Option<u32>,
}

// ── M5：航海士、海盗、海战、探索 ──

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MatesFile {
    pub mates: Vec<MateRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MateRaw {
    #[serde(default)]
    pub abilities: std::collections::BTreeMap<String, i64>,
    pub key: String,
    pub name: String,
    pub bio: String,
    pub home: String,
    pub navigation: i64,
    pub trade: i64,
    pub combat: i64,
    pub management: i64,
    pub level: i64,
    pub salary: i64,
    pub hire_cost: i64,
    pub loyalty: i64,
    /// 隐藏：酒馆里不出现，只能通过特殊途径加入
    #[serde(default)]
    pub hidden: bool,
    /// 算学奇才掌握的行情预测方法（没有就是普通航海士）
    #[serde(default)]
    pub methods: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MateRulesRaw {
    pub xp_per_level: i64,
    pub level_gain: i64,
    pub salary_growth: Dec,
    pub max_level: i64,
    pub loyalty_paid: i64,
    pub loyalty_unpaid: i64,
    pub leave_below: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PirateRulesRaw {
    pub ships: Vec<String>,
    pub spawn_scale: Dec,
    pub max_per_region: usize,
    pub lifetime: [u32; 2],
    pub fleet_size: [i64; 2],
    pub sight: i64,
    pub speed: i64,
    pub crew_ratio: Dec,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BattleRulesRaw {
    pub evade_max: Dec,
    pub cargo_loss_pct: [i64; 2],
    pub tribute_pct: [i64; 2],
    pub tactical_radius: i64,
    pub gun_range: i64,
    pub max_turns: u32,
    pub reputation_win: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExploreRulesRaw {
    pub sight: i64,
    pub chart_base: i64,
    pub chart_per_100_cells: i64,
}

// ── M2：物流、商队、产业、银行、外交、期货 ──

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WarehouseRulesRaw {
    pub rent_per_100: i64,
    pub price_per_unit: i64,
    pub demurrage_per_100: i64,
    pub ally_free_capacity: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaravanRulesRaw {
    pub guard_wage: i64,
    pub guard_hire_cost: i64,
    pub robbery_chance: Dec,
    pub resale: Dec,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContractRulesRaw {
    pub per_faction_per_month: u32,
    pub reward_factor: Dec,
    pub penalty_share: Dec,
    pub reputation_gain: i64,
    pub reputation_loss: i64,
    /// 交付的货物进入目的港市场（缺省关闭）
    #[serde(default)]
    pub deliver_to_market: bool,
    #[serde(default)]
    pub v2: manifest_core::contract::ContractV2Rules,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InvestRulesRaw {
    pub cost_per_point: i64,
    pub min_amount: i64,
    pub ally_share: Dec,
    pub ally_tax: Dec,
    pub ally_specialty_discount: Dec,
    /// 超出初值的发展度每隔几个月衰减 1 点（缺省 1：每月）
    #[serde(default = "one_month")]
    pub decay_months: u32,
}

fn one_month() -> u32 {
    1
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BankRulesRaw {
    pub deposit_rate: Dec,
    pub loan_base_rate: Dec,
    pub loan_risk_premium: Dec,
    pub max_term_months: u32,
    pub overdue_penalty: Dec,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiplomacyRulesRaw {
    pub incident_chance: Dec,
    pub tension_below: i64,
    pub peace_above: i64,
    pub war_below: i64,
    pub war_min_tension_days: u32,
    pub war_min_days: u32,
    pub truce_days: u32,
    pub war_tax: Dec,
    pub license_reputation: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RelationRaw {
    pub a: String,
    pub b: String,
    pub value: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaravansFile {
    pub animals: Vec<AnimalRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnimalRaw {
    pub key: String,
    pub name: String,
    pub capacity: i64,
    pub speed: Dec,
    pub price: i64,
    pub upkeep: i64,
    pub desert: Dec,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoadsFile {
    pub roads: Vec<RoadRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoadRaw {
    pub from: String,
    pub to: String,
    pub terrain: String,
    pub security: Dec,
    pub faction: String,
    pub toll: Dec,
    /// 省略时按两端坐标的直线距离 × 1.2 计算
    pub length: Option<Dec>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecipesFile {
    pub industries: Vec<IndustryRaw>,
    pub recipes: Vec<RecipeRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IndustryRaw {
    pub key: String,
    pub name: String,
    pub build_cost: i64,
    pub workers: i64,
    pub wage: i64,
    pub maintenance: i64,
    pub manager_salary: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecipeRaw {
    pub key: String,
    pub name: String,
    pub industry: String,
    #[serde(default)]
    pub inputs: Vec<GoodQty>,
    pub outputs: Vec<GoodQty>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GoodQty {
    pub good: String,
    pub qty: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FuturesFile {
    pub exchanges: Vec<ExchangeRaw>,
    pub contracts: Vec<FuturesSpecRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExchangeRaw {
    pub key: String,
    pub name: String,
    pub port: String,
    pub initial_margin: Dec,
    pub maintenance_margin: Dec,
    pub spread: Dec,
    pub carry_per_month: Dec,
    pub impact_per_lot: Dec,
    pub position_limit: i64,
    pub penalty: Dec,
    pub house_capital: i64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FuturesSpecRaw {
    pub exchange: String,
    pub good: String,
    pub lot: i64,
    /// 省略时为交易所所在港
    pub delivery: Option<String>,
    pub tick: i64,
}

// ── M3：事件 ──

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventsFile {
    pub events: Vec<EventRaw>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventRaw {
    pub key: String,
    pub name: String,
    pub description: String,
    pub effect: String,
    pub cooldown_days: u32,
    pub max_per_year: u32,
    #[serde(default = "default_requires")]
    pub requires: String,
    #[serde(default)]
    pub goods: Vec<String>,
    pub mult: Option<[Dec; 2]>,
    pub days: Option<[u32; 2]>,
    pub delta: Option<[i64; 2]>,
    #[serde(default)]
    pub port_only: bool,
    /// 只在这些地点发生（地点 key；不写表示任意）
    #[serde(default)]
    pub locs: Vec<String>,
    /// 只在这些海区发生（海区 key；不写表示任意）
    #[serde(default)]
    pub regions: Vec<String>,
    /// 只针对这些势力（势力 key；不写表示任意）
    #[serde(default)]
    pub factions: Vec<String>,
}

fn default_requires() -> String {
    "none".to_string()
}
