//! 视图：把世界状态整理成界面需要的结构（名称已解析，金额为整数；货币单位见静态数据的 `world.currency`）。
//!
//! 界面固定文字由前端字符串表提供；这里只输出数据与数据文件中的名称。
//! 比例类数值（税率、利率、份额）用万分之一的整数表示。
//!
//! 多语言（EXPANSION.md §12）：各视图的 `*_in` 版本按 [`Ctx`] 取名字与文字——名字取显示用数据
//! （显示字段换成当前语言、其余与原数据完全相同的副本），专名另给英文写法 `name_en`；
//! 后端生成的文字（离线模板的传闻、议价回复、编年史、组合事件，效果说明，拒绝原因）在非中文界面按语言重新格式化，
//! 中文界面通常显示内核原文，占位原因从文字表补齐。世界始终用原数据运行，视图只读。不带 `_in` 的旧接口等同于中文（`name_en` 取中文名）。

pub mod world_catalog;
pub use world_catalog::{ProtagonistCard, ScenarioCard, TemplateCard, WorldCard, WorldCatalog};

use manifest_ai::BudgetStatus;
use manifest_core::defs::{LocKind, RoadTerrain, SailType};
use manifest_core::diplomacy::DiploStatus;
use manifest_core::fixed::{Fx, Money, mul_div};
use manifest_core::ids::*;
use manifest_core::info::InfoMode;
use manifest_core::ledger::FinancialReport;
use manifest_core::text::TextRef;
use manifest_core::world::FleetLocation;
use manifest_core::{CommandError, DayWeather, Reason, Sky, StaticData, World};
use manifest_data::LocaleBundle;
use serde::{Deserialize, Serialize};

pub const PLAYER: OwnerId = OwnerId::Player;

// ───────────────────────────── 语言 ─────────────────────────────

/// 视图的显示语言：名字从哪份数据取、文字怎样格式化。
#[derive(Clone, Copy)]
pub struct Ctx<'a> {
    pub ai_templates: Option<&'a manifest_data::locale::TemplateText>,
    pub model_text: bool,
    /// 当前语言的显示用数据（显示字段已换成当前语言；下标与数值与原数据相同）
    pub names: &'a StaticData,
    /// 英文显示内容（专名的 `name_en`、商品类别的英文）；旧接口为 None，此时取当前语言的名字
    pub en: Option<&'a LocaleBundle>,
    /// 非中文界面：（中文显示内容, 当前语言显示内容），用来重新格式化后端生成的文字；中文界面为 None（显示内核原文）
    pub tr: Option<(&'a LocaleBundle, &'a LocaleBundle)>,
    /// 当前语言的后端文本；供只登记原因码的新模块使用。
    pub texts: Option<&'a manifest_data::locale::Texts>,
    /// 当前语言包，用于把原因参数中的对象、日期等转换成显示文字。
    pub current: Option<&'a LocaleBundle>,
}

impl<'a> Ctx<'a> {
    /// 中文、不附英文名（旧接口）。
    pub fn plain(defs: &'a StaticData) -> Ctx<'a> {
        Ctx { names: defs, en: None, tr: None, texts: None, ai_templates: None, model_text: true, current: None }
    }

    /// 按语言：`cur` 为当前语言，`zh`、`en` 为中文与英文显示内容。
    pub fn of(cur: &'a LocaleBundle, zh: &'a LocaleBundle, en: &'a LocaleBundle) -> Ctx<'a> {
        let tr = (!cur.locale.is_chinese()).then_some((zh, cur));
        Ctx {
            names: &cur.defs,
            en: Some(en),
            tr,
            texts: Some(&cur.texts),
            ai_templates: Some(&cur.templates),
            model_text: true,
            current: Some(cur),
        }
    }

    /// 英文显示用数据（没有时为当前语言）。
    pub fn en_defs(&self) -> &'a StaticData {
        self.en.map(|b| &*b.defs).unwrap_or(self.names)
    }

    /// 事件效果的方向说明（键见内核 `summary::HINTS`）。
    pub fn hint(&self, key: &str) -> &'static str {
        match self.tr {
            Some((_, cur)) => intern(cur.hint(key)),
            None => manifest_core::summary::hint_zh(key),
        }
    }

    /// 命令被拒绝的原因。
    pub fn error(&self, e: &CommandError) -> String {
        if let Some(text) = e.reason().and_then(|r| self.placeholder_reason(r)) {
            return text;
        }
        // A8 的内核占位仍带原因码；中文也从文本表取，旧错误仍保留原来的格式。
        if let Some(reason) = e.reason()
            && crate::societies_view::localized_reason(reason.code)
            && let Some(text) = self.texts.and_then(|texts| texts.get(&format!("reasons.{}", reason.code)))
        {
            return text.to_owned();
        }
        match self.tr {
            Some((_, cur)) => cur.command_error(e),
            None => e.to_string(),
        }
    }

    /// 带错误码的原因（不带“不满足条件”等前缀）。
    pub fn reason(&self, r: &Reason) -> String {
        if let Some(text) = self.placeholder_reason(r) {
            return text;
        }
        match self.tr {
            Some((_, cur)) => cur.reason_text(r),
            None => r.zh.clone(),
        }
    }

    /// 离线模板生成的文字：非中文界面按引用重新格式化，否则（或模板位置不存在时）显示原文。
    pub fn text(&self, world: &World, original: &str, tpl: Option<&TextRef>) -> String {
        let text = if let (Some((zh, cur)), Some(r)) = (self.tr, tpl) {
            let composed = |title: &str| composed_title(world, zh, cur, title);
            cur.render(r, &composed).unwrap_or_else(|| original.to_string())
        } else {
            original.to_string()
        };
        crate::navigation_view::visibility::redact_text(*self, world, &text)
    }

    /// 组合事件的标题与叙事（非中文界面找回离线模板的位置后重新格式化；模型写的显示原文）。
    pub fn composed(&self, world: &World, r: &manifest_core::composed::ComposedRecord) -> (String, String) {
        // 规则触发的政策：按当前语言的 `[policy]` 模板写成
        if r.source == manifest_core::composed::ComposedSource::Rule
            && let Some(t) = self.tr.and_then(|(_, cur)| cur.policy_text(r))
        {
            return (t.title, t.text);
        }
        if let Some((zh, cur)) = self.tr {
            let colony = colony_name_for(world, r);
            if let Some(t) = manifest_data::locale::localize_composed(zh, cur, r, colony.as_deref()) {
                return (t.title, t.text);
            }
        }
        (r.title.clone(), r.text.clone())
    }

    /// 商品类别的英文（类别本身是内部键）。
    pub fn category_en(&self, zh: &str) -> String {
        self.en.map(|b| b.category(zh)).unwrap_or_else(|| zh.to_string())
    }

    /// 内核只留占位、文字表已有正式文案时，视图与命令拒绝共用同一套参数填充。
    pub(crate) fn placeholder_reason(&self, reason: &Reason) -> Option<String> {
        const PENDING: &str = "（待写）";
        if !reason.zh.contains(PENDING) {
            return None;
        }
        let bundle = self.current?;
        let text = self.texts?.get(&format!("reasons.{}", reason.code))?;
        if text.is_empty() || text.contains(PENDING) {
            return None;
        }
        let none = |_: &str| None;
        let vars = reason.args.iter().map(|(key, arg)| (*key, bundle.arg_text(arg, &none))).collect();
        Some(manifest_data::locale::fill(text, &vars))
    }
}

/// 把效果说明的译文变成 `&'static str`（`EffectView::hint` 的类型）。说明只有几十条固定的键，
/// 每种文字只保留一份，占用的内存有上限。
fn intern(s: String) -> &'static str {
    use std::collections::BTreeSet;
    use std::sync::{Mutex, OnceLock};
    static POOL: OnceLock<Mutex<BTreeSet<&'static str>>> = OnceLock::new();
    let pool = POOL.get_or_init(|| Mutex::new(BTreeSet::new()));
    let mut p = pool.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(x) = p.get(s.as_str()) {
        return x;
    }
    let leaked: &'static str = Box::leak(s.into_boxed_str());
    p.insert(leaked);
    leaked
}

/// 组合事件中殖民地效果所在殖民地的名称（玩家起的名字）。
fn colony_name_for(world: &World, r: &manifest_core::composed::ComposedRecord) -> Option<String> {
    r.effects
        .iter()
        .filter(|e| e.effect.targets_colony())
        .find_map(|e| e.params.loc)
        .and_then(|l| world.colony_at(l))
        .map(|c| c.name.clone())
}

/// 组合事件的中文标题 → 当前语言（在记录中按标题查找并找回模板位置）。
fn composed_title(world: &World, zh: &LocaleBundle, cur: &LocaleBundle, title: &str) -> Option<String> {
    let r = world.state.events.composed.iter().rev().find(|r| r.title == title)?;
    // 规则触发的政策：按当前语言的 `[policy]` 模板写成（与 `Ctx::composed` 一致；原来这里漏了，英文的市场月报里夹着中文标题）
    if r.source == manifest_core::composed::ComposedSource::Rule
        && let Some(t) = cur.policy_text(r)
    {
        return Some(t.title);
    }
    let colony = colony_name_for(world, r);
    manifest_data::locale::localize_composed(zh, cur, r, colony.as_deref()).map(|t| t.title)
}

// ───────────────────────────── 静态数据 ─────────────────────────────

#[path = "map_view.rs"]
pub mod map_view;
pub use map_view::{MapFineResource, MapResource};
#[path = "fog_view.rs"]
pub mod fog_view;
pub use fog_view::FogDelta;

#[derive(Clone, Debug, Serialize)]
pub struct MapView {
    pub width: u16,
    pub height: u16,
    /// 每行一个字符串：`~` 深海、`-` 浅海、`#` 陆地
    pub rows: Vec<String>,
    /// 高程图层（EXPANSION §10.3）：每行一个字符串，陆格 `0`–`9`、海格 `.`；数据没有 relief.txt 时省略
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relief: Option<Vec<String>>,
    /// 植被 / 地貌图层：陆格为 I T B F G M K D S J W A V X 之一、海格 `.`；数据没有 biomes.txt 时省略
    #[serde(skip_serializing_if = "Option::is_none")]
    pub biomes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrap_x: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
pub struct LocView {
    pub id: u16,
    pub key: String,
    pub name: String,
    /// 英文写法（专名以英文为主，中文界面在名字下方小字显示；EXPANSION.md §12.3）
    pub name_en: String,
    /// port / city / site（殖民点：faction 无意义，为 0）
    pub kind: &'static str,
    pub x: u16,
    pub y: u16,
    pub faction: u16,
    pub shipyard: bool,
    /// 建城年份（纪年）；未写为空
    pub founded: Option<i64>,
    /// 简史（可为空字符串）
    pub lore: String,
    /// 殖民点的自然条件（只有殖民点有）
    pub site: Option<SiteInfoView>,
    /// 停泊格所在海区（街景取当地天气用）；内陆城市为空
    pub region: Option<u16>,
}

/// 殖民点的自然条件。
#[derive(Clone, Debug, Serialize)]
pub struct SiteInfoView {
    /// forest / plains / hills / jungle / tundra / desert / swamp / island
    pub terrain: &'static str,
    pub fertility: i64,
    pub hazard: i64,
    /// （商品 id, 丰度 1–100）
    pub resources: Vec<(u16, i64)>,
}

fn site_info(s: &manifest_core::defs::SiteDef) -> SiteInfoView {
    SiteInfoView {
        terrain: s.terrain.key(),
        fertility: s.fertility,
        hazard: s.hazard,
        resources: s.resources.iter().map(|(g, r)| (g.0, *r)).collect(),
    }
}

fn loc_kind(k: LocKind) -> &'static str {
    match k {
        LocKind::Port => "port",
        LocKind::City => "city",
        LocKind::Site => "site",
    }
}

/// 世界配置：货币名称与纪年（日期显示为 start_year + 年序 − 1）。
#[derive(Clone, Debug, Serialize)]
pub struct WorldView {
    pub modules: Vec<String>,
    pub languages: Vec<String>,
    pub key: String,
    pub name: String,
    pub map_key: String,
    pub calendar: CalendarView,
    pub currency: String,
    pub era: String,
    pub start_year: i64,
}

/// 世界日历的展示定义。
#[derive(Clone, Debug, Serialize)]
pub struct CalendarView {
    pub months: Vec<u16>,
    pub seasons: Vec<u8>,
    pub month_names: Vec<String>,
}

/// 殖民地建筑（静态定义，数值均为"每级"）。
#[derive(Clone, Debug, Serialize)]
pub struct ColonyBuildingView {
    pub id: u16,
    pub key: String,
    pub name: String,
    /// 英文写法（专名以英文为主，中文界面在名字下方小字显示；EXPANSION.md §12.3）
    pub name_en: String,
    /// food / extract / process / storage / defense / morale / dock / housing
    pub kind: &'static str,
    pub cost: Money,
    /// （商品 id, 数量）
    pub materials: Vec<(u16, i64)>,
    pub build_days: u32,
    pub workers: i64,
    pub upkeep: Money,
    pub max_level: u8,
    pub goods: Vec<u16>,
    pub output: i64,
    pub inputs: Vec<(u16, i64)>,
    pub outputs: Vec<(u16, i64)>,
    pub capacity: i64,
    pub defense: i64,
    pub morale: i64,
    pub housing: i64,
    pub description: String,
}

/// 发现物目录（位置只在发现后由 `discoveries` 查询给出）。
#[derive(Clone, Debug, Serialize)]
pub struct DiscoveryDefView {
    pub id: u16,
    pub key: String,
    pub name: String,
    /// 英文写法（专名以英文为主，中文界面在名字下方小字显示；EXPANSION.md §12.3）
    pub name_en: String,
    /// ruins / wonder / wreck / relic / beast / landmark
    pub kind: &'static str,
    pub fame: i64,
    pub value: Money,
    pub lore: String,
    /// 需要潜水的发现物；普通发现物省略，保持经典静态数据的字节不变。
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub dive: bool,
}

/// 河流（`world/rivers.toml`）：从源头到入海口的格坐标折线。
#[derive(Clone, Debug, Serialize)]
pub struct RiverView {
    pub key: String,
    pub name: String,
    /// `[x, y]` 数组
    pub path: Vec<[u16; 2]>,
    /// 河宽等级 1–3
    pub width: u8,
}

/// 地标与奇观（`world/landmarks.toml`）。占地为以 (x, y) 为左上角、w × h 的矩形。
#[derive(Clone, Debug, Serialize)]
pub struct LandmarkView {
    pub key: String,
    pub name: String,
    /// natural / arcane / ancient / civic
    pub category: &'static str,
    pub kind: String,
    pub x: u16,
    pub y: u16,
    pub w: u16,
    pub h: u16,
    pub lore: String,
    /// 对应的发现物 key（没有为 null）
    pub discovery: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RoadView {
    pub id: u16,
    pub from: u16,
    pub to: u16,
    pub terrain: &'static str,
    /// 长度（格）
    pub length: i64,
    /// 关卡税率（货值的万分之几）
    pub toll_bp: i64,
    /// 治安（万分之几）
    pub security_bp: i64,
    pub faction: u16,
}

#[derive(Clone, Debug, Serialize)]
pub struct GoodView {
    pub id: u16,
    pub key: String,
    pub name: String,
    /// 英文写法（专名以英文为主，中文界面在名字下方小字显示；EXPANSION.md §12.3）
    pub name_en: String,
    /// 类别（内部键，中文，不随语言变化；图标按它绘制）
    pub category: String,
    /// 类别的英文显示名
    pub category_en: String,
    pub tier: u8,
    pub base_price: Money,
    pub license: bool,
    pub description: String,
    /// 需求层级 essential / comfort / luxury（生产资料为空；ECONOMY.md 6.4）
    pub need: Option<&'static str>,
    /// 替代组编号（同组商品满足同一种需求）
    pub group: Option<u16>,
    /// 货档（1–3；T01：买入要的商誉见港口视图的商馆一节）。0 档与没有货档的世界不写
    #[serde(skip_serializing_if = "is_zero_u8")]
    pub rank: u8,
    #[serde(skip_serializing_if = "is_false")]
    pub secret: bool,
    /// 风声由内容数据给出；视图只选择货物编号。
    #[serde(skip_serializing_if = "String::is_empty")]
    pub rumor: String,
}

fn is_zero_u8(v: &u8) -> bool {
    *v == 0
}

#[derive(Clone, Debug, Serialize)]
pub struct ShipTypeView {
    pub id: u16,
    pub key: String,
    pub name: String,
    /// 英文写法（专名以英文为主，中文界面在名字下方小字显示；EXPANSION.md §12.3）
    pub name_en: String,
    pub description: String,
    /// square / lateen
    pub sail: &'static str,
    /// 航速（万分之一格/天）
    pub speed: i64,
    pub capacity: i64,
    pub durability: i64,
    pub crew_min: i64,
    pub crew_max: i64,
    pub guns: i64,
    pub price: Money,
    /// 独有船型：船厂不出售、不能建造、NPC 不使用
    pub unique: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct RefitView {
    pub id: u16,
    pub name: String,
    /// 英文写法（专名以英文为主，中文界面在名字下方小字显示；EXPANSION.md §12.3）
    pub name_en: String,
    pub price: Money,
    pub capacity: i64,
    pub durability: i64,
    pub guns: i64,
    pub speed: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct FactionView {
    pub id: u16,
    pub key: String,
    pub name: String,
    /// 英文写法（专名以英文为主，中文界面在名字下方小字显示；EXPANSION.md §12.3）
    pub name_en: String,
    pub license_price: Money,
    pub marque_price: Money,
    /// 地图配色（十六进制）：数据中的 color，未写时取内置调色板
    pub color: String,
    /// 建筑风格（mediterranean / nordic / lowland / desert / islands / eastern / frontier）；未写为空
    pub style: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct NamedView {
    pub id: u16,
    pub name: String,
    /// 英文写法（专名以英文为主，中文界面在名字下方小字显示；EXPANSION.md §12.3）
    pub name_en: String,
}

/// 海区（静态数据）：前三个字段与 [`NamedView`] 相同，另带音乐分区。
#[derive(Clone, Debug, Serialize)]
pub struct RegionView {
    pub id: u16,
    pub name: String,
    /// 英文写法（专名以英文为主，中文界面在名字下方小字显示；EXPANSION.md §12.3）
    pub name_en: String,
    /// 音乐分区（FRAMEWORK §15.1）：海区创作源 `regions.toml` 的 `music`，原样给出，界面按它决定这片海放哪首航海曲。
    /// 没写的海区与没有创作源的世界（经典）不输出这个键，经典世界的静态数据逐字节不变。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub music: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AnimalView {
    pub id: u16,
    pub name: String,
    /// 英文写法（专名以英文为主，中文界面在名字下方小字显示；EXPANSION.md §12.3）
    pub name_en: String,
    pub capacity: i64,
    pub speed: i64,
    pub price: Money,
    pub upkeep: Money,
}

#[derive(Clone, Debug, Serialize)]
pub struct IndustryTypeView {
    pub id: u16,
    pub name: String,
    /// 英文写法（专名以英文为主，中文界面在名字下方小字显示；EXPANSION.md §12.3）
    pub name_en: String,
    pub build_cost: Money,
    pub workers: i64,
    pub wage: Money,
    pub maintenance: Money,
    pub manager_salary: Money,
}

#[derive(Clone, Debug, Serialize)]
pub struct RecipeView {
    pub id: u16,
    pub name: String,
    /// 英文写法（专名以英文为主，中文界面在名字下方小字显示；EXPANSION.md §12.3）
    pub name_en: String,
    pub industry: u16,
    pub inputs: Vec<(u16, i64)>,
    pub outputs: Vec<(u16, i64)>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ExchangeView {
    pub id: u16,
    pub name: String,
    /// 英文写法（专名以英文为主，中文界面在名字下方小字显示；EXPANSION.md §12.3）
    pub name_en: String,
    pub port: u16,
    pub initial_margin_bp: i64,
    pub maintenance_margin_bp: i64,
    pub position_limit: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct RulesView {
    pub crew_hire_cost: Money,
    pub crew_wage: Money,
    pub food_price: Money,
    pub water_price: Money,
    pub crew_per_supply_unit: i64,
    pub fractional_supplies: bool,
    pub warehouse_rent_per_100: Money,
    pub warehouse_price_per_unit: Money,
    pub guard_wage: Money,
    pub guard_hire_cost: Money,
    pub invest_min: Money,
    pub loan_max_months: u32,
    /// 建立殖民地：最少殖民者、建立费、须卸下的物资（商品 id, 数量）
    pub colony_min_settlers: i64,
    pub colony_found_cost: Money,
    pub colony_found_materials: Vec<(u16, i64)>,
    /// 税率档位：（收入百分比, 士气目标增减），下标即 SetColonyTax 的 rate
    pub colony_tax_levels: Vec<(i64, i64)>,
    pub colony_max: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct ScenarioView {
    pub key: String,
    pub name: String,
    /// 英文写法（专名以英文为主，中文界面在名字下方小字显示；EXPANSION.md §12.3）
    pub name_en: String,
    pub description: String,
    /// 起始港口（地点 id）
    pub start: u16,
    /// 起始资金（货币单位见 world.currency）
    pub cash: Money,
    /// 起始船只（船型 id）
    pub ships: Vec<u16>,
    /// 起始船员
    pub crew: i64,
    /// 开局即受雇的航海士人数
    pub mates: usize,
    pub goal: ScenarioGoalView,
    /// 开局货物（装在开局舰队的货舱）；没有时为空数组
    pub cargo: Vec<ScenarioCargoView>,
    /// 开局粮水（单位同补给）
    pub food: i64,
    pub water: i64,
    /// 在开局界面加亮为“推荐选择”
    pub recommended: bool,
    /// 定好的主角（推荐角色）；普通剧本为空
    pub hero: Option<crate::story_view::HeroView>,
    /// 挂的故事线；没有时为空
    pub story: Option<crate::story_view::StoryLineInfo>,
}

/// 剧本的一行开局货物。
#[derive(Clone, Debug, Serialize)]
pub struct ScenarioCargoView {
    /// 商品 id
    pub good: u16,
    pub qty: i64,
}

/// 剧本目标（开局界面的剧本卡片用）。
#[derive(Clone, Debug, Serialize)]
pub struct ScenarioGoalView {
    /// net_worth / ally_ports / colonies / sandbox
    pub kind: &'static str,
    /// 目标净资产、同盟港数量或殖民地数量；沙盒为 0
    pub target: i64,
    /// colonies：每个殖民地至少需要的人口；其他目标没有这个字段
    #[serde(skip_serializing_if = "Option::is_none")]
    pub population: Option<i64>,
    /// 限期（年）；不限期为空
    pub years: Option<u32>,
}

fn goal_parts(kind: manifest_core::defs::GoalKind) -> (&'static str, i64, Option<i64>) {
    use manifest_core::defs::GoalKind;
    match kind {
        GoalKind::NetWorth(v) => ("net_worth", v, None),
        GoalKind::AllyPorts(n) => ("ally_ports", i64::from(n), None),
        GoalKind::Colonies { count, population } => ("colonies", i64::from(count), Some(population)),
        GoalKind::Sandbox => ("sandbox", 0, None),
        GoalKind::Story => ("story", 0, None),
    }
}

fn scenario_view(ctx: Ctx<'_>, s: &manifest_core::defs::ScenarioDef, en: &StaticData) -> ScenarioView {
    let (kind, target, population) = goal_parts(s.goal.kind);
    let story = crate::story_view::story_line_info(ctx, s);
    // 走完故事线：目标是章数
    let target = if kind == "story" { story.as_ref().map(|x| i64::from(x.chapters)).unwrap_or(0) } else { target };
    ScenarioView {
        key: s.key.clone(),
        name: s.name.clone(),
        name_en: en.scenarios.iter().find(|x| x.key == s.key).map(|x| x.name.clone()).unwrap_or_else(|| s.name.clone()),
        description: s.description.clone(),
        start: s.start.0,
        cash: s.cash,
        ships: s.ships.iter().map(|t| t.0).collect(),
        crew: s.crew,
        mates: s.mates.len(),
        goal: ScenarioGoalView {
            kind,
            target,
            population,
            years: s.goal.deadline.map(|d| d / ctx.names.calendar.year_days()),
        },
        cargo: s.cargo.iter().map(|(g, q)| ScenarioCargoView { good: g.0, qty: *q }).collect(),
        food: s.food,
        water: s.water,
        recommended: s.recommended,
        hero: crate::story_view::hero_view(s),
        story,
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct StaticView {
    pub data_hash: String,
    /// 货币与纪年
    pub world: WorldView,
    pub map: MapView,
    pub regions: Vec<RegionView>,
    pub locations: Vec<LocView>,
    pub roads: Vec<RoadView>,
    pub goods: Vec<GoodView>,
    pub ships: Vec<ShipTypeView>,
    pub refits: Vec<RefitView>,
    pub factions: Vec<FactionView>,
    pub companies: Vec<NamedView>,
    pub animals: Vec<AnimalView>,
    pub industry_types: Vec<IndustryTypeView>,
    pub recipes: Vec<RecipeView>,
    pub exchanges: Vec<ExchangeView>,
    pub scenarios: Vec<ScenarioView>,
    pub rules: RulesView,
    pub colony_buildings: Vec<ColonyBuildingView>,
    pub discoveries: Vec<DiscoveryDefView>,
    /// 河流（数据没有 rivers.toml 时为空）
    pub rivers: Vec<RiverView>,
    /// 地标与奇观（数据没有 landmarks.toml 时为空）
    pub landmarks: Vec<LandmarkView>,
    /// 主角身世（开局向导；数据里没有 captain.toml 时为空）
    pub captain: Option<crate::captain_view::CaptainDefsView>,
    /// U06K1：新课线、家业与寒暄句的静态文字，旧世界不增加此键。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upbringing_act_texts: Option<std::collections::BTreeMap<String, String>>,
}

fn color_of(index: usize) -> String {
    const PALETTE: [&str; 8] = ["#c0392b", "#2e86c1", "#d4ac0d", "#27ae60", "#8e44ad", "#d35400", "#16a085", "#7f8c8d"];
    PALETTE[index % PALETTE.len()].to_string()
}

fn road_terrain(t: RoadTerrain) -> &'static str {
    match t {
        RoadTerrain::Plain => "plain",
        RoadTerrain::Hill => "hill",
        RoadTerrain::Forest => "forest",
        RoadTerrain::Mountain => "mountain",
        RoadTerrain::Desert => "desert",
    }
}

/// 静态数据（中文，`name_en` 取中文名；旧接口）。
pub fn static_view(defs: &StaticData) -> StaticView {
    static_view_in(Ctx::plain(defs))
}

/// 静态数据：名字按当前语言，专名同时给出英文写法。
pub fn static_view_in(ctx: Ctx<'_>) -> StaticView {
    static_view_with_map(ctx, map_view::static_map(ctx.names))
}

/// 世界注册表传入已缓存地图的摘要，语言切换不再复制和重建大图层。
pub fn static_view_with_map(ctx: Ctx<'_>, map_view: MapView) -> StaticView {
    let defs = ctx.names;
    let en = ctx.en_defs();
    let r = &defs.rules;
    let wr = &r.world;
    StaticView {
        data_hash: defs.meta.hash.clone(),
        world: WorldView {
            modules: Vec::new(),
            languages: vec!["zh".into(), "en".into()],
            key: defs.world_key.clone(),
            name: defs.world_name.clone(),
            map_key: defs.map_key.clone(),
            calendar: CalendarView {
                months: defs.calendar.months().to_vec(),
                seasons: defs.calendar.seasons().to_vec(),
                month_names: defs.calendar.month_names().to_vec(),
            },
            currency: wr.currency.clone(),
            era: wr.era.clone(),
            start_year: wr.start_year,
        },
        map: map_view,
        regions: defs
            .regions
            .iter()
            .enumerate()
            .map(|(i, g)| RegionView {
                id: i as u16,
                name: g.name.clone(),
                name_en: en.regions[i].name.clone(),
                music: defs.geography.places.authored.regions.get(&g.key).and_then(|r| r.music.clone()),
            })
            .collect(),
        locations: defs
            .locations
            .iter()
            .enumerate()
            .map(|(i, l)| LocView {
                id: i as u16,
                key: l.key.clone(),
                name: l.name.clone(),
                name_en: en.locations[i].name.clone(),
                kind: loc_kind(l.kind),
                x: l.cell.x,
                y: l.cell.y,
                faction: l.faction.0,
                shipyard: !l.shipyard.is_empty(),
                founded: l.founded,
                lore: l.lore.clone(),
                site: l.site.as_ref().map(site_info),
                region: region_of_cell(defs, l.cell).map(|r| r.0),
            })
            .collect(),
        roads: defs
            .roads
            .iter()
            .enumerate()
            .map(|(i, rd)| RoadView {
                id: i as u16,
                from: rd.from.0,
                to: rd.to.0,
                terrain: road_terrain(rd.terrain),
                length: rd.length.raw() / Fx::SCALE,
                toll_bp: rd.toll.raw(),
                security_bp: rd.security.raw(),
                faction: rd.faction.0,
            })
            .collect(),
        goods: defs
            .goods
            .iter()
            .enumerate()
            .map(|(i, g)| GoodView {
                id: i as u16,
                key: g.key.clone(),
                name: g.name.clone(),
                name_en: en.goods[i].name.clone(),
                category: g.category.clone(),
                category_en: ctx.category_en(&g.category),
                tier: g.tier,
                base_price: g.base_price,
                license: g.license,
                description: g.description.clone(),
                need: g.need.map(|t| t.key()),
                group: g.group,
                rank: g.rank,
                secret: g.secret,
                rumor: g.rumor.clone(),
            })
            .collect(),
        ships: defs
            .ships
            .iter()
            .enumerate()
            .map(|(i, s)| ShipTypeView {
                id: i as u16,
                key: s.key.clone(),
                name: s.name.clone(),
                name_en: en.ships[i].name.clone(),
                description: s.description.clone(),
                sail: if s.sail == SailType::Square { "square" } else { "lateen" },
                speed: s.speed.raw(),
                capacity: s.capacity,
                durability: s.durability,
                crew_min: s.crew_min,
                crew_max: s.crew_max,
                guns: s.guns,
                price: s.price,
                unique: s.unique,
            })
            .collect(),
        refits: defs
            .refits
            .iter()
            .enumerate()
            .map(|(i, f)| RefitView {
                id: i as u16,
                name: f.name.clone(),
                name_en: en.refits[i].name.clone(),
                price: f.price,
                capacity: f.capacity,
                durability: f.durability,
                guns: f.guns,
                speed: f.speed.raw(),
            })
            .collect(),
        factions: defs
            .factions
            .iter()
            .enumerate()
            .map(|(i, f)| FactionView {
                id: i as u16,
                key: f.key.clone(),
                name: f.name.clone(),
                name_en: en.factions[i].name.clone(),
                license_price: f.license_price,
                marque_price: f.marque_price,
                color: f.color.clone().unwrap_or_else(|| color_of(i)),
                style: f.style.clone(),
            })
            .collect(),
        companies: defs
            .companies
            .iter()
            .enumerate()
            .map(|(i, c)| NamedView { id: i as u16, name: c.name.clone(), name_en: en.companies[i].name.clone() })
            .collect(),
        animals: defs
            .animals
            .iter()
            .enumerate()
            .map(|(i, a)| AnimalView {
                id: i as u16,
                name: a.name.clone(),
                name_en: en.animals[i].name.clone(),
                capacity: a.capacity,
                speed: a.speed.raw(),
                price: a.price,
                upkeep: a.upkeep,
            })
            .collect(),
        industry_types: defs
            .industry_types
            .iter()
            .enumerate()
            .map(|(i, t)| IndustryTypeView {
                id: i as u16,
                name: t.name.clone(),
                name_en: en.industry_types[i].name.clone(),
                build_cost: t.build_cost,
                workers: t.workers,
                wage: t.wage,
                maintenance: t.maintenance,
                manager_salary: t.manager_salary,
            })
            .collect(),
        recipes: defs
            .recipes
            .iter()
            .enumerate()
            .map(|(i, rc)| RecipeView {
                id: i as u16,
                name: rc.name.clone(),
                name_en: en.recipes[i].name.clone(),
                industry: rc.industry.0,
                inputs: rc.inputs.iter().map(|(g, q)| (g.0, *q)).collect(),
                outputs: rc.outputs.iter().map(|(g, q)| (g.0, *q)).collect(),
            })
            .collect(),
        exchanges: defs
            .exchanges
            .iter()
            .enumerate()
            .map(|(i, e)| ExchangeView {
                id: i as u16,
                name: e.name.clone(),
                name_en: en.exchanges[i].name.clone(),
                port: e.port.0,
                initial_margin_bp: e.initial_margin.raw(),
                maintenance_margin_bp: e.maintenance_margin.raw(),
                position_limit: e.position_limit,
            })
            .collect(),
        scenarios: defs.scenarios.iter().map(|s| scenario_view(ctx, s, en)).collect(),
        rules: RulesView {
            crew_hire_cost: r.crew_hire_cost,
            crew_wage: r.crew_wage,
            food_price: r.food_price,
            water_price: r.water_price,
            crew_per_supply_unit: r.crew_per_supply_unit,
            fractional_supplies: r.fractional_supplies,
            warehouse_rent_per_100: r.warehouse.rent_per_100,
            warehouse_price_per_unit: r.warehouse.price_per_unit,
            guard_wage: r.caravan.guard_wage,
            guard_hire_cost: r.caravan.guard_hire_cost,
            invest_min: r.invest.min_amount,
            loan_max_months: r.bank.max_term_months,
            colony_min_settlers: r.colony.min_settlers,
            colony_found_cost: r.colony.found_cost,
            colony_found_materials: r.colony.found_materials.iter().map(|(g, q)| (g.0, *q)).collect(),
            colony_tax_levels: r.colony.tax_levels.clone(),
            colony_max: r.colony.max_colonies_per_owner,
        },
        colony_buildings: defs
            .colony_buildings
            .iter()
            .enumerate()
            .map(|(i, b)| ColonyBuildingView {
                id: i as u16,
                key: b.key.clone(),
                name: b.name.clone(),
                name_en: en.colony_buildings[i].name.clone(),
                kind: b.kind.key(),
                cost: b.cost,
                materials: b.materials.iter().map(|(g, q)| (g.0, *q)).collect(),
                build_days: b.build_days,
                workers: b.workers,
                upkeep: b.upkeep,
                max_level: b.max_level,
                goods: b.goods.iter().map(|g| g.0).collect(),
                output: b.output,
                inputs: b.inputs.iter().map(|(g, q)| (g.0, *q)).collect(),
                outputs: b.outputs.iter().map(|(g, q)| (g.0, *q)).collect(),
                capacity: b.capacity,
                defense: b.defense,
                morale: b.morale,
                housing: b.housing,
                description: b.description.clone(),
            })
            .collect(),
        discoveries: defs
            .discoveries
            .iter()
            .enumerate()
            .map(|(i, d)| DiscoveryDefView {
                id: i as u16,
                key: d.key.clone(),
                name: d.name.clone(),
                name_en: en.discoveries[i].name.clone(),
                kind: d.kind.key(),
                fame: d.fame,
                value: d.value,
                lore: d.lore.clone(),
                dive: crate::navigation_view::diving::is_dive(defs, &d.key),
            })
            .collect(),
        rivers: defs
            .geography
            .rivers
            .iter()
            .map(|rv| RiverView {
                key: rv.key.clone(),
                name: rv.name.clone(),
                path: rv.path.iter().map(|c| [c.x, c.y]).collect(),
                width: rv.width,
            })
            .collect(),
        landmarks: defs
            .geography
            .landmarks
            .iter()
            .map(|l| LandmarkView {
                key: l.key.clone(),
                name: l.name.clone(),
                category: l.category.key(),
                kind: l.kind.clone(),
                x: l.cell.x,
                y: l.cell.y,
                w: l.size.0,
                h: l.size.1,
                lore: l.lore.clone(),
                discovery: l.discovery.map(|d| defs.discovery(d).key.clone()),
            })
            .collect(),
        captain: crate::captain_view::captain_defs_view(ctx),
        upbringing_act_texts: crate::upbringing_view::act::texts(ctx),
    }
}

// ───────────────────────────── 概览 ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct CargoLine {
    pub good: u16,
    pub qty: i64,
    /// 移动加权平均成本（每单位）
    pub avg_cost: Money,
}

#[derive(Clone, Debug, Serialize)]
pub struct LegendShipIdentityView {
    pub key: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct ShipView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legend: Option<LegendShipIdentityView>,
    pub kind: u16,
    pub durability: i64,
    pub max_durability: i64,
    pub capacity: i64,
    pub guns: i64,
    pub refits: Vec<u16>,
    pub resale: Money,
    pub refit_options: Vec<RefitOptionView>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FleetView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pos: Option<crate::navigation_view::Position>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub heading: Option<u16>,
    pub id: u32,
    /// 停靠的地点；在海上时为 None
    pub docked: Option<u16>,
    /// 航行目的地
    pub dest: Option<u16>,
    pub x: u16,
    pub y: u16,
    /// 剩余航线（格坐标）
    pub path: Vec<(u16, u16)>,
    pub days_at_sea: u32,
    pub ships: Vec<ShipView>,
    pub crew: i64,
    pub crew_min: i64,
    pub crew_max: i64,
    /// 此刻最多还能招募的船员（不算现金）：不超过上限，在港口受当地人手限制，在自己的殖民地从殖民者里招；在海上为 0
    pub hire_max: i64,
    pub morale: i64,
    pub food: i64,
    pub water: i64,
    /// 每日粮、水各自的消耗
    pub daily_need: i64,
    /// 平均每日消耗（千分之一格）；旧 daily_need 保留为一天的整格上界。
    pub daily_need_milli: i64,
    /// 可完整维持的天数；零船员为 null。
    pub supplies_days: Option<i64>,
    /// 从现在起够 10／30 天时，粮、水各应持有的整格数量。
    pub supplies_for_10_days: i64,
    pub supplies_for_30_days: i64,
    pub capacity: i64,
    pub used: i64,
    pub cargo: Vec<CargoLine>,
    pub repair_cost: Money,
    /// H02：船材与船底（规则关着时没有）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wear: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize)]
pub struct CaravanView {
    pub id: u32,
    pub animal: u16,
    pub count: i64,
    pub guards: i64,
    pub at: Option<u16>,
    /// 行进中：当前路段的起点、终点与进度（万分之一）
    pub leg: Option<(u16, u16, i64)>,
    pub dest: Option<u16>,
    pub capacity: i64,
    pub cargo: Vec<CargoLine>,
    pub daily_cost: Money,
}

#[derive(Clone, Debug, Serialize)]
pub struct MarkerView {
    pub owner: String,
    /// 商会名的英文写法（玩家为 "player"）
    pub owner_en: String,
    pub x: u16,
    pub y: u16,
}

#[derive(Clone, Debug, Serialize)]
pub struct WindView {
    pub region: u16,
    /// 海区中心
    pub x: u16,
    pub y: u16,
    /// 风向 0–7（0 = 北，顺时针）
    pub dir: u8,
    pub strength: i64,
}

/// 某海区当天的天气。字段名与前端 `ipc/types.ts` 的 `RegionWeatherView` 一致。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct RegionWeatherView {
    pub region: u16,
    /// clear / cloudy / rain / fog / storm / snow
    pub sky: Sky,
    /// 风的去向 0–7（0 = 北，顺时针）
    pub wind_dir: u8,
    /// 风力 0–10
    pub wind_strength: i64,
}

/// 某一天的天气（预报）。字段名与前端 `DayWeatherView` 一致。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct DayWeatherView {
    pub day: u32,
    pub sky: Sky,
    pub wind_dir: u8,
    pub wind_strength: i64,
}

/// 主角旗舰队所在处（没有舰队时为本据港）的天气与未来两天预报。字段名与前端 `LocalWeatherView` 一致。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct LocalWeatherView {
    pub region: u16,
    pub region_name: String,
    /// 海区的英文名
    pub region_name_en: String,
    pub sky: Sky,
    pub wind_dir: u8,
    pub wind_strength: i64,
    /// 未来两天（day + 1、day + 2）
    pub forecast: Vec<DayWeatherView>,
}

#[derive(Clone, Debug, Serialize)]
pub struct NoticeView {
    /// 字符串表中的键
    pub kind: &'static str,
    pub args: Vec<(String, String)>,
}

#[derive(Clone, Debug, Serialize)]
pub struct PendingView {
    pub id: u32,
    pub fleet: u32,
    pub pirate_ships: usize,
    pub pirate_guns: i64,
    pub pirate_crew: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct GoalView {
    /// net_worth / ally_ports / colonies
    pub kind: &'static str,
    pub current: i64,
    pub target: i64,
    /// colonies：每个殖民地至少需要的人口；其他目标没有这个字段
    #[serde(skip_serializing_if = "Option::is_none")]
    pub population: Option<i64>,
    pub deadline: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
pub struct OutcomeView {
    /// Won / Lost
    pub kind: String,
    /// GoalReached / Deadline / Reorganizations
    pub reason: String,
    pub day: u32,
}

/// 在港中（概览的 `port_hold`）：旗舰队停在哪个港口、出港后按哪一档继续、住到下月初要几天。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PortHoldView {
    pub loc: u16,
    /// 出港后按这一档继续（倍速：慢 2 / 普通 4 / 快 8；旧存档、旧界面可能是别的倍速）
    pub resume: u8,
    /// 住到下月初要过的天数（今天住下，过这么多天正好是下个月的 1 日）
    pub month_days: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct Overview {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chat: Option<serde_json::Value>,
    pub world_key: String,
    pub map_key: String,
    pub mode: &'static str,
    /// [纪年年份, 月, 日]；与 calendar_year / month / date 同源。
    pub world_date: [i64; 3],
    pub day: u32,
    /// 年序（从 1 开始）；纪年年份见 calendar_year
    pub year: u32,
    /// 纪年年份 = world.start_year + year − 1
    pub calendar_year: i64,
    pub month: u32,
    pub date: u32,
    /// 0 春 1 夏 2 秋 3 冬
    pub season: usize,
    pub scenario: String,
    /// 剧本名的英文写法（任何语言下都有；EXPANSION.md §12.3）
    pub scenario_en: String,
    pub cash: Money,
    pub deposit: Money,
    pub loans: Money,
    pub net_worth: Money,
    pub total_assets: Money,
    pub speed: u8,
    /// 当天时刻（分钟 0–1439，每日结算在 6:00）：时钟在应用层，由处理函数填入；这里默认 8:00
    pub minute: u16,
    /// 概览的编号（应用层填入，这里为 0）：epoch 是生成它的应用状态，rev 在同一个 epoch 里每生成一次加一。
    /// 网页版的界面丢掉同一个 epoch 里 rev 不比手上新的概览：WebSocket 上排在后面的推送、晚到的请求结果不会把界面拨回旧状态
    pub epoch: u64,
    pub rev: u64,
    pub ai_mode: String,
    pub budget: Option<BudgetStatus>,
    pub fleets: Vec<FleetView>,
    pub caravans: Vec<CaravanView>,
    pub others: Vec<MarkerView>,
    pub winds: Vec<WindView>,
    pub notices: Vec<NoticeView>,
    pub reorganizations: u32,
    /// 等待玩家决定的遭遇
    pub pending_battles: Vec<PendingView>,
    /// 进行中的战术海战
    pub tactical_battles: Vec<u32>,
    /// 视野内的海盗
    pub pirates: Vec<(u16, u16)>,
    /// 已揭开的格子数（变化时界面重新获取迷雾）
    pub fog_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sighted: Option<Vec<u16>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub navigation_stop: Option<serde_json::Value>,
    /// 在港中（手动航行的世界、养成期之外，旗舰队停在港口时才有）：时间不走，旅店休息才过天，出港后按 `resume` 继续。
    /// 由处理函数填入（见 `handlers/harbor.rs`）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port_hold: Option<PortHoldView>,
    /// 在等玩家回应的事：upbringing / battle / story（手动推进与旅店休息遇到就停下）。由处理函数填入
    #[serde(skip_serializing_if = "Option::is_none")]
    pub awaiting: Option<&'static str>,
    pub goal: Option<GoalView>,
    pub outcome: Option<OutcomeView>,
    /// 主角（纯展示，不参与模拟）；尚未设置或旧存档没有时为空
    pub captain: Option<CaptainView>,
    /// 按主角开局时主角当前年龄的头像素材（如 t16-mio-16）；有它时名牌用它，不用外貌编号
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captain_asset: Option<String>,
    /// 名声
    pub fame: i64,
    /// 玩家殖民地摘要
    pub colonies: Vec<ColonySummaryView>,
    /// 已发现、尚未报告的发现物数
    pub discoveries_unreported: usize,
    /// 已发现的发现物总数（含已报告；只增不减，变化时界面重新获取发现物列表）
    pub discovered_count: usize,
    /// 已有归属的殖民点（地图上的占领旗与殖民地标记）
    pub site_claims: Vec<SiteClaimView>,
    /// 到过的港口与城市里市况不是“平稳”的（海图上的市况标记；ECONOMY.md 6.4）
    pub port_conditions: Vec<PortConditionView>,
    /// 各海区当天的天气（按海区序号，每个海区一条）
    pub weather: Vec<RegionWeatherView>,
    /// 主角旗舰队所在处（没有舰队时为本据港）的天气与未来两天预报
    pub local_weather: Option<LocalWeatherView>,
    /// H03：世界海图上画的天气团（旗舰队在海上时，离它 `chart_range` 格以内、海图已有或已探明处的团；开关关着时为空）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub weather_cells: Vec<ChartCellView>,
    /// H08：到港的航程总结（到港那天与次日给，界面弹一次；开关关着时没有）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trip_summary: Option<serde_json::Value>,
    /// 主角档案（身世与属性）；尚未立下身世或旧存档没有时为空
    pub profile: Option<crate::captain_view::ProfileView>,
    /// 剧情事件：推荐角色的故事线与奇遇；没有故事线、也什么都没发生过时为空
    pub story: Option<crate::story_view::StoryView>,
    /// 行情情报（ECONOMY.md 第 7 节）：live（实时，经典）/ carried（随船传递）
    pub info_mode: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quest_pin: Option<crate::quest_view::QuestPin>,
    pub day_ms: u32,
    pub sea_clock: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub revealed: Vec<u16>,
}

/// 殖民地摘要（概览用）。
#[derive(Clone, Debug, Serialize)]
pub struct ColonySummaryView {
    pub id: u32,
    pub name: String,
    pub loc: u16,
    pub population: i64,
    pub morale: i64,
    /// 连续断粮天数（0 表示有粮）
    pub starving_days: u32,
    /// 现有粮食可支撑的天数（不计产出）
    pub food_days: i64,
    /// 进行中的工程：（建筑 id, 完工后等级, 完工日）
    pub construction: Option<(u16, u8, u32)>,
}

/// 某处港口或城市的市况（ECONOMY.md 6.4）。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct PortConditionView {
    pub loc: u16,
    /// boom / depression / famine / glut
    pub condition: &'static str,
    /// 进入这个市况的日期
    pub since: u32,
}

/// 知道行情的港口与城市里市况不是“平稳”的（不知道行情的地方也不知道市况）。
/// 随船传递时，远方的市况是手上快照里的（进入市况的日期取实际的，市况在快照之后变过时取快照日）。
pub fn port_conditions(world: &World) -> Vec<PortConditionView> {
    let sight = world.sight(PLAYER);
    world
        .defs
        .loc_ids()
        .filter(|l| market_known(world, *l))
        .filter_map(|l| {
            let p = world.people(l)?;
            let (condition, since) = match sight.snapshot(l) {
                Some(s) if s.condition == p.condition && p.since <= s.day => (s.condition, p.since),
                Some(s) => (s.condition, s.day),
                None => (p.condition, p.since),
            };
            (condition != manifest_core::people::Condition::Stable).then(|| PortConditionView {
                loc: l.0,
                condition: condition.key(),
                since,
            })
        })
        .collect()
}

/// 玩家是否知道某地的行情（信息时效，ECONOMY.md 第 7 节）：实时模式下是到过的地方；随船传递时是在场或有快照。
pub fn market_known(world: &World, loc: LocId) -> bool {
    if !world.location_visible(loc) || !world.port_is_open(loc) {
        return false;
    }
    match world.info_mode() {
        InfoMode::Live => world.loc_known(loc),
        InfoMode::Carried => world.sight(PLAYER).knows(loc),
    }
}

/// 远方行情的时效（随船传递时；看得到实时行情或不知道时为空）。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct SeenView {
    /// 快照日：包含这一天之前的收盘
    pub day: u32,
    /// 过时的天数（今天 − 快照日）
    pub age: u32,
    /// 来源：visit（自己到过）/ ship（随船消息）/ report（行情通报）
    pub source: &'static str,
}

/// 玩家对某地行情的时效。
pub fn seen_view(world: &World, loc: LocId) -> Option<SeenView> {
    let s = world.sight(PLAYER).snapshot(loc)?;
    Some(SeenView { day: s.day, age: world.day().saturating_sub(s.day), source: s.source.key() })
}

/// 行情通报（随船传递、玩家在这个港口时）：告示板上比手上新的港口与价格（没有时为空列表、价格 0）。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ReportOfferView {
    pub locs: Vec<u16>,
    pub price: Money,
}

fn report_offer_view(world: &World, loc: LocId) -> Option<ReportOfferView> {
    let here = world.info_mode() == InfoMode::Carried
        && world.defs.loc(loc).is_port()
        && !world.state.locations[loc.idx()].market.is_empty()
        && world.presence(PLAYER).contains(&loc);
    here.then(|| {
        let (locs, price) = world.report_offer(loc);
        ReportOfferView { locs: locs.into_iter().map(|l| l.0).collect(), price }
    })
}

/// 殖民点的归属。
#[derive(Clone, Debug, Serialize)]
pub struct SiteClaimView {
    pub loc: u16,
    /// 被某势力占领
    pub faction: Option<u16>,
    /// 已建成的殖民地
    pub colony: Option<u32>,
    /// 殖民地是否属于玩家
    pub mine: bool,
}

/// 主角：姓名与外貌编号（纯展示，不参与模拟，不进入世界状态与重放）。
/// 字段名与前端 `ipc/types.ts` 的 `Captain` 一致。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CaptainView {
    pub name: String,
    /// 外貌编号：0–11 与 13–24（共 handlers::CAPTAIN_PORTRAITS 种，见 handlers::is_ordinary_portrait；12 号停用）
    pub portrait: u32,
}

pub fn owner_label(defs: &StaticData, owner: OwnerId) -> String {
    match owner {
        OwnerId::Player => "player".into(),
        OwnerId::Company(c) => defs.company(c).name.clone(),
    }
}

fn cargo_lines(world: &World, owner: OwnerId, cargo: &std::collections::BTreeMap<GoodId, i64>) -> Vec<CargoLine> {
    let book = world.state.agents.get(&owner).map(|a| &a.book);
    cargo
        .iter()
        .filter(|(_, q)| **q > 0)
        .map(|(g, q)| CargoLine { good: g.0, qty: *q, avg_cost: book.map(|b| b.avg_cost(*g)).unwrap_or(0) })
        .collect()
}

pub fn fleet_view(world: &World, f: &manifest_core::world::Fleet) -> FleetView {
    fleet_view_in(Ctx::plain(&world.defs), world, f)
}
fn fleet_view_in(ctx: Ctx<'_>, world: &World, f: &manifest_core::world::Fleet) -> FleetView {
    let defs = &world.defs;
    let cell = f.cell(defs);
    let (docked, dest, path) = match &f.location {
        FleetLocation::Docked(l) => (Some(l.0), None, Vec::new()),
        FleetLocation::AtSea(manifest_core::world::Voyage::Route(v)) => {
            (None, Some(v.dest.0), v.path.iter().skip(v.step).map(|c| (c.x, c.y)).collect::<Vec<_>>())
        }
        FleetLocation::AtSea(manifest_core::world::Voyage::Manual { manual }) => {
            (None, manual.autopilot.map(|l| l.0), Vec::new())
        }
    };
    FleetView {
        pos: match &f.location {
            FleetLocation::AtSea(manifest_core::world::Voyage::Manual { manual }) => {
                Some(crate::navigation_view::Position {
                    x: manual.pos.x as f64 / 256.0,
                    y: manual.pos.y as f64 / 256.0,
                })
            }
            _ => None,
        },
        heading: match &f.location {
            FleetLocation::AtSea(manifest_core::world::Voyage::Manual { manual }) => Some(manual.heading),
            _ => None,
        },
        id: f.id.0,
        docked: docked.filter(|id| world.location_visible(LocId(*id))),
        dest: dest.filter(|id| world.location_visible(LocId(*id))),
        x: cell.x,
        y: cell.y,
        path: path
            .into_iter()
            .take_while(|(x, y)| {
                !world.hides_unknown_locations() || world.state.explore.is_revealed(defs.map.idx(Cell::new(*x, *y)))
            })
            .collect(),
        days_at_sea: f.days_at_sea,
        ships: f
            .ships
            .iter()
            .enumerate()
            .map(|(ship, s)| ShipView {
                legend: s.legend.as_ref().and_then(|key| ctx.names.legend_ships.ship(key)).map(|d| {
                    LegendShipIdentityView {
                        key: d.key.clone(),
                        name: crate::legend_ships_view::legend_ship_name(world, d).into(),
                    }
                }),
                kind: s.kind.0,
                durability: s.durability,
                max_durability: s.max_durability,
                capacity: s.capacity,
                guns: s.guns,
                refits: s.refits.iter().map(|r| r.0).collect(),
                resale: world.ship_resale(s),
                refit_options: world
                    .defs
                    .refits
                    .iter()
                    .enumerate()
                    .map(|(i, _)| {
                        let id = manifest_core::RefitId::from_idx(i);
                        let reason = cmd_reason(
                            ctx,
                            world,
                            manifest_core::Command::RefitShip {
                                owner: PLAYER,
                                fleet: f.id,
                                ship: ship as u8,
                                refit: id,
                            },
                        );
                        RefitOptionView { id: id.0, enabled: reason.is_none(), reason }
                    })
                    .collect(),
            })
            .collect(),
        crew: f.crew,
        crew_min: f.crew_min(defs),
        crew_max: f.crew_max(defs),
        hire_max: world.crew_hire_room(f),
        morale: f.morale,
        food: f.food,
        water: f.water,
        daily_need: manifest_core::fleet::daily_supply_need(defs, f.crew),
        daily_need_milli: manifest_core::fleet::daily_supply_milli(defs, f.crew),
        supplies_days: f.supplies_days(defs),
        supplies_for_10_days: f.supplies_needed(defs, 10),
        supplies_for_30_days: f.supplies_needed(defs, 30),
        capacity: f.capacity(),
        used: f.used(),
        cargo: cargo_lines(world, f.owner, &f.cargo),
        repair_cost: world.repair_cost(f),
        wear: crate::seafaring_view::port_wear(world, f.id),
    }
}

pub fn caravan_view(world: &World, c: &manifest_core::caravan::Caravan) -> CaravanView {
    let defs = &world.defs;
    let (leg, dest) = match &c.location {
        manifest_core::caravan::CaravanLocation::At(_) => (None, None),
        manifest_core::caravan::CaravanLocation::OnRoad(t) => {
            let from = t.stops.get(t.leg).copied();
            let to = t.stops.get(t.leg + 1).copied();
            let len = t.roads.get(t.leg).map(|r| defs.road(*r).length).unwrap_or(Fx::ONE);
            let pct = if len.raw() > 0 { mul_div(t.progress.raw(), Fx::SCALE, len.raw()) } else { 0 };
            (from.zip(to).map(|(a, b)| (a.0, b.0, pct.clamp(0, Fx::SCALE))), t.stops.last().map(|l| l.0))
        }
    };
    CaravanView {
        id: c.id.0,
        animal: c.animal.0,
        count: c.count,
        guards: c.guards,
        at: c.at().filter(|l| world.location_visible(*l)).map(|l| l.0),
        leg: leg.filter(|(from, to, _)| world.location_visible(LocId(*from)) && world.location_visible(LocId(*to))),
        dest: dest.filter(|id| world.location_visible(LocId(*id))),
        capacity: c.capacity(defs),
        cargo: cargo_lines(world, c.owner, &c.cargo),
        daily_cost: c.daily_cost(defs),
    }
}

/// 每日概览（中文；旧接口）。
pub fn overview(world: &World, speed: u8, ai_mode: String, budget: Option<BudgetStatus>) -> Overview {
    overview_in(Ctx::plain(&world.defs), world, speed, ai_mode, budget)
}

/// 每日概览：名字按当前语言。
pub fn overview_in(ctx: Ctx<'_>, world: &World, speed: u8, ai_mode: String, budget: Option<BudgetStatus>) -> Overview {
    let defs = ctx.names;
    let day = world.day();
    let d = world.defs.calendar.date_of(day);
    let season = world.defs.calendar.season_of(day).index();
    let agent = world.state.agents.get(&PLAYER);
    let mut notices = Vec::new();
    if let Some(calls) = world.state.futures.calls.get(&PLAYER) {
        for (ex, since) in calls {
            notices.push(NoticeView {
                kind: "marginCall",
                args: vec![("exchange".into(), defs.exchange(*ex).name.clone()), ("since".into(), since.to_string())],
            });
        }
    }
    if let Some(a) = agent
        && a.cash < 0
    {
        notices.push(NoticeView { kind: "negativeCash", args: vec![("days".into(), a.negative_days.to_string())] });
    }
    for l in world.loans_of(PLAYER).filter(|l| l.overdue) {
        notices.push(NoticeView { kind: "loanOverdue", args: vec![("loan".into(), l.id.0.to_string())] });
    }
    for f in world.fleets_of(PLAYER) {
        if f.docked_at().is_none() && f.supplies_days(defs).is_some_and(|days| days < 5) {
            notices.push(NoticeView { kind: "lowSupplies", args: vec![("fleet".into(), f.id.0.to_string())] });
        }
    }
    // 各海区当天的天气；海图上的风向箭头用当天的风
    let today: Vec<(usize, DayWeather)> = defs
        .regions
        .iter()
        .enumerate()
        .filter_map(|(i, _)| world.weather_today(RegionId::from_idx(i)).map(|w| (i, w)))
        .collect();
    let winds = today
        .iter()
        .map(|(i, w)| {
            let r = &defs.regions[*i];
            WindView {
                region: *i as u16,
                x: (r.rect.0 + r.rect.2) / 2,
                y: (r.rect.1 + r.rect.3) / 2,
                dir: w.wind_dir(),
                strength: w.wind_strength(),
            }
        })
        .collect();
    let weather = today
        .iter()
        .map(|(i, w)| RegionWeatherView {
            region: *i as u16,
            sky: w.sky,
            wind_dir: w.wind_dir(),
            wind_strength: w.wind_strength(),
        })
        .collect();
    Overview {
        chat: None,
        world_key: world.defs.world_key.clone(),
        map_key: world.defs.map_key.clone(),
        mode: if world.upbringing_active() { "upbringing" } else { "voyage" },
        world_date: [defs.rules.world.calendar_year(d.year), i64::from(d.month), i64::from(d.day)],
        day,
        year: d.year,
        calendar_year: defs.rules.world.calendar_year(d.year),
        month: d.month,
        date: d.day,
        season,
        scenario: defs.scenarios.get(world.state.scenario.idx()).map(|s| s.name.clone()).unwrap_or_default(),
        scenario_en: ctx
            .en_defs()
            .scenarios
            .get(world.state.scenario.idx())
            .map(|s| s.name.clone())
            .unwrap_or_default(),
        cash: agent.map(|a| a.cash).unwrap_or(0),
        deposit: agent.map(|a| a.deposit).unwrap_or(0),
        loans: world.loan_total(PLAYER),
        net_worth: agent.map(|a| a.ledger.equity()).unwrap_or(0),
        total_assets: world.total_assets(PLAYER),
        speed,
        minute: crate::clock::DEFAULT_MINUTE,
        epoch: 0,
        rev: 0,
        ai_mode,
        budget,
        fleets: world.fleets_of(PLAYER).map(|f| fleet_view_in(ctx, world, f)).collect(),
        caravans: world.caravans_of(PLAYER).map(|c| caravan_view(world, c)).collect(),
        others: world
            .state
            .fleets
            .values()
            .filter(|f| f.owner != PLAYER)
            .filter(|f| !world.hides_unknown_locations() || world.state.explore.is_revealed(defs.map.idx(f.cell(defs))))
            .map(|f| {
                let c = f.cell(defs);
                MarkerView {
                    owner: owner_label(defs, f.owner),
                    owner_en: owner_label(ctx.en_defs(), f.owner),
                    x: c.x,
                    y: c.y,
                }
            })
            .collect(),
        winds,
        notices,
        reorganizations: agent.map(|a| a.reorganizations).unwrap_or(0),
        pending_battles: battles_pending(world),
        tactical_battles: world
            .state
            .battles
            .tactical
            .values()
            .filter(|t| world.state.fleets.get(&t.fleet).is_some_and(|f| f.owner == PLAYER))
            .map(|t| t.id.0)
            .collect(),
        pirates: world
            .state
            .battles
            .pirates
            .values()
            .filter(|p| {
                let i = p.cell.y as usize * defs.map.width as usize + p.cell.x as usize;
                world.state.explore.is_revealed(i)
            })
            .map(|p| (p.cell.x, p.cell.y))
            .collect(),
        fog_version: world.state.explore.fog_revision(),
        sighted: world.hides_unknown_locations().then(|| world.visible_locations().map(|id| id.0).collect()),
        navigation_stop: None,
        port_hold: None,
        awaiting: None,
        goal: defs.scenarios.get(world.state.scenario.idx()).and_then(|s| {
            let (current, target) = world.goal_progress()?;
            let (kind, _, population) = goal_parts(s.goal.kind);
            if kind == "sandbox" {
                return None;
            }
            Some(GoalView { kind, current, target, population, deadline: s.goal.deadline })
        }),
        outcome: world.state.outcome.map(|o| OutcomeView {
            kind: format!("{:?}", o.kind),
            reason: format!("{:?}", o.reason),
            day: o.day,
        }),
        // 主角由应用层保存，调用方（handlers::make_overview）填入
        captain: None,
        captain_asset: None,
        fame: agent.map(|a| a.fame).unwrap_or(0),
        colonies: world.colonies_of(PLAYER).map(|c| colony_summary(world, c)).collect(),
        discoveries_unreported: world.unreported_discoveries().count(),
        discovered_count: world.state.explore.discovered.len(),
        site_claims: site_claims(world),
        port_conditions: port_conditions(world),
        weather,
        local_weather: local_weather_in(ctx, world),
        weather_cells: chart_cells(world),
        trip_summary: crate::voyage_view::trip_summary(ctx, world),
        profile: crate::captain_view::profile_view(ctx, world),
        story: crate::story_view::story_view_in(ctx, world),
        info_mode: world.info_mode().key(),
        quest_pin: crate::quest_view::quest_pin(ctx, world),
        day_ms: crate::clock::day_ms(speed, crate::clock::sea_clock_world(world)) as u32,
        sea_clock: crate::clock::sea_clock_world(world),
        revealed: world
            .defs
            .good_ids()
            .filter(|g| world.defs.good(*g).secret && world.good_revealed(*g))
            .map(|g| g.0)
            .collect(),
    }
}

/// 某格所在的海区（越界、陆地或不属于任何海区时为空）。
fn region_of_cell(defs: &StaticData, c: Cell) -> Option<RegionId> {
    defs.map.in_bounds(c.x as i32, c.y as i32).then(|| defs.map.region_of(c)).flatten()
}

/// “当地”所在的海区：主角的第一支舰队（与界面的旗舰队一致）——停泊时取港口停泊格的海区，在海上取所在格的海区；
/// 没有舰队时取本据港（新游戏即剧本的起始港）的停泊格海区。
pub fn local_region(world: &World) -> Option<RegionId> {
    let defs = &world.defs;
    if let Some(r) = world.fleets_of(PLAYER).next().and_then(|f| region_of_cell(defs, f.cell(defs))) {
        return Some(r);
    }
    let home = world
        .state
        .agents
        .get(&PLAYER)
        .map(|a| a.home)
        .or_else(|| defs.scenarios.get(world.state.scenario.idx()).map(|s| s.start))?;
    defs.locations.get(home.idx()).and_then(|l| region_of_cell(defs, l.cell))
}

/// H03：世界海图上的一个天气团（格坐标）。
#[derive(Clone, Debug, Serialize)]
pub struct ChartCellView {
    pub id: String,
    pub kind: manifest_core::weather_cells::CellKind,
    pub x: f64,
    pub y: f64,
    pub r: f64,
}

/// H03：世界海图上画哪些天气团——旗舰队在海上时，离它 `chart_range` 格以内（领航的 PositionFix 每点再远 1%，最多 +50%），
/// 团心所在的海区已有海图、或团心那一格已经探明。开关关着、旗舰队在港时为空。
pub fn chart_cells(world: &World) -> Vec<ChartCellView> {
    let rules = &world.defs.rules.weather_cells;
    if !rules.enabled {
        return Vec::new();
    }
    let Some(f) = world.fleets_of(PLAYER).next().filter(|f| f.docked_at().is_none()) else { return Vec::new() };
    let fix = world.attr_hook(PLAYER, manifest_core::captain::AttrHook::PositionFix).clamp(0, 50);
    let range = rules.chart_range * (100 + fix) / 100;
    let map = &world.defs.map;
    world
        .weather_cells_near(f.cell(&world.defs), range)
        .into_iter()
        .filter(|c| {
            let cell = c.center.cell();
            map.in_bounds(i32::from(cell.x), i32::from(cell.y))
                && (world.state.explore.charts.contains(&c.region) || world.state.explore.is_revealed(map.idx(cell)))
        })
        .map(|c| ChartCellView {
            id: format!("{}:{}:{}", c.region.0, c.start, c.index),
            kind: c.kind,
            x: c.center.x as f64 / 256.0,
            y: c.center.y as f64 / 256.0,
            r: c.radius as f64 / 256.0,
        })
        .collect()
}

/// 当地天气与未来两天的预报（预报按当前生效的事件修正计算）。
pub fn local_weather(world: &World) -> Option<LocalWeatherView> {
    local_weather_in(Ctx::plain(&world.defs), world)
}

/// 当地天气与预报：海区名按当前语言，另给英文名。
pub fn local_weather_in(ctx: Ctx<'_>, world: &World) -> Option<LocalWeatherView> {
    let region = local_region(world)?;
    let mut today = world.weather_today(region)?;
    // H03：天气团开着时，海上的旗舰队取它所在处的位置天况（全画面的雨幕只在船进了团才出现）
    if world.defs.rules.weather_cells.enabled
        && let Some(f) = world.fleets_of(PLAYER).next().filter(|f| f.docked_at().is_none())
        && let Some(w) = world.weather_at_pos(f.cell(&world.defs))
    {
        today = w;
    }
    let forecast = (1..=2)
        .filter_map(|k| world.weather_on(region, world.day() + k))
        .map(|w| DayWeatherView { day: w.day, sky: w.sky, wind_dir: w.wind_dir(), wind_strength: w.wind_strength() })
        .collect();
    Some(LocalWeatherView {
        region: region.0,
        region_name: ctx.names.region(region).name.clone(),
        region_name_en: ctx.en_defs().region(region).name.clone(),
        sky: today.sky,
        wind_dir: today.wind_dir(),
        wind_strength: today.wind_strength(),
        forecast,
    })
}

fn food_days(world: &World, c: &manifest_core::colony::Colony) -> i64 {
    let need = manifest_core::colony::food_need(&world.defs, c.population).max(1);
    world.colony_food_stock(c) / need
}

pub fn colony_summary(world: &World, c: &manifest_core::colony::Colony) -> ColonySummaryView {
    ColonySummaryView {
        id: c.id.0,
        name: c.name.clone(),
        loc: c.loc.0,
        population: c.population,
        morale: c.morale,
        starving_days: c.starving_days,
        food_days: food_days(world, c),
        construction: c.construction.as_ref().map(|k| (k.building.0, k.level, k.done_day)),
    }
}

pub fn site_claims(world: &World) -> Vec<SiteClaimView> {
    use manifest_core::colony::Claim;
    world
        .defs
        .site_ids()
        .filter(|id| world.location_visible(*id))
        .filter_map(|l| {
            let claim = world.claim_of(l)?;
            Some(match claim {
                Claim::Faction(f) => SiteClaimView { loc: l.0, faction: Some(f.0), colony: None, mine: false },
                Claim::Colony(c) => SiteClaimView {
                    loc: l.0,
                    faction: None,
                    colony: Some(c.0),
                    mine: world.colony(c).is_some_and(|x| x.owner == PLAYER),
                },
            })
        })
        .collect()
}

pub fn battles_pending(world: &World) -> Vec<PendingView> {
    let b = &world.state.battles;
    b.pending
        .values()
        .filter(|p| world.state.fleets.get(&p.fleet).is_some_and(|f| f.owner == PLAYER))
        .filter_map(|p| {
            let pirate = b.pirates.get(&p.pirate)?;
            Some(PendingView {
                id: p.id.0,
                fleet: p.fleet.0,
                pirate_ships: pirate.ships.len(),
                pirate_guns: pirate.ships.iter().map(|s| s.guns).sum(),
                pirate_crew: pirate.crew,
            })
        })
        .collect()
}

// ───────────────────────────── 航海士 ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct RoleView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<&'static str>,
    /// none / captain / accountant / trader / caravan / industry
    pub kind: &'static str,
    pub target: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
pub struct MateView {
    pub abilities: Vec<(String, i64)>,
    pub id: u16,
    /// 数据里的 key
    pub key: String,
    pub name: String,
    /// 英文写法（专名以英文为主，中文界面在名字下方小字显示；EXPANSION.md §12.3）
    pub name_en: String,
    pub bio: String,
    pub level: i64,
    pub xp: i64,
    pub navigation: i64,
    pub trade: i64,
    pub combat: i64,
    pub management: i64,
    pub salary: Money,
    pub hire_cost: Money,
    pub loyalty: i64,
    pub at: u16,
    pub hired: bool,
    pub role: RoleView,
    /// 算学奇才掌握的行情预测方法（普通航海士为空）
    pub methods: Vec<String>,
    /// 第九批：航海士也是人物（寰宇）时，人物当前年龄的头像素材 id；经典的航海士为 null，界面照旧按 key 找图
    pub portrait: Option<String>,
}

pub fn role_view(r: manifest_core::mates::MateRole) -> RoleView {
    use manifest_core::mates::MateRole;
    match r {
        MateRole::Assigned { role, target } => RoleView {
            kind: "assigned",
            target: target.id(),
            role: Some(role),
            scope: Some(match target.scope() {
                manifest_core::captain::RoleScope::Owner => "owner",
                manifest_core::captain::RoleScope::Fleet => "fleet",
                manifest_core::captain::RoleScope::Caravan => "caravan",
                manifest_core::captain::RoleScope::Industry => "industry",
            }),
        },
        MateRole::None => RoleView { kind: "none", target: None, role: None, scope: None },
        MateRole::Captain(f) => RoleView { kind: "captain", target: Some(f.0), role: None, scope: None },
        MateRole::Accountant => RoleView { kind: "accountant", target: None, role: None, scope: None },
        MateRole::Trader => RoleView { kind: "trader", target: None, role: None, scope: None },
        MateRole::CaravanLeader(c) => RoleView { kind: "caravan", target: Some(c.0), role: None, scope: None },
        MateRole::IndustryManager(i) => RoleView { kind: "industry", target: Some(i.0), role: None, scope: None },
    }
}

pub fn mate_view(world: &World, id: MateId) -> Option<MateView> {
    mate_view_in(Ctx::plain(&world.defs), world, id)
}

/// 航海士：姓名与小传按当前语言，另给英文名。
pub fn mate_view_in(ctx: Ctx<'_>, world: &World, id: MateId) -> Option<MateView> {
    let m = world.state.mates.get(&id)?;
    if m.owner != Some(PLAYER) && !world.location_visible(m.at) {
        return None;
    }
    let d = ctx.names.mates.get(id.idx())?;
    Some(MateView {
        abilities: world
            .defs
            .captain
            .abilities
            .iter()
            .map(|a| (a.key.clone(), world.mate_ability(id, &a.key)))
            .collect(),
        id: id.0,
        key: d.key.clone(),
        name: d.name.clone(),
        name_en: ctx.en_defs().mates.get(id.idx()).map(|x| x.name.clone()).unwrap_or_default(),
        bio: crate::navigation_view::visibility::redact_text(ctx, world, &d.bio),
        level: m.level,
        xp: m.xp,
        navigation: m.navigation,
        trade: m.trade,
        combat: m.combat,
        management: m.management,
        salary: m.salary,
        hire_cost: d.hire_cost,
        loyalty: m.loyalty,
        at: m.at.0,
        hired: m.owner == Some(PLAYER),
        role: role_view(m.role),
        methods: d.methods.clone(),
        portrait: world.defs.cast.person(&d.key).and_then(|p| p.portrait(world.cast_date())).map(str::to_owned),
    })
}

#[derive(Clone, Debug, Serialize)]
pub struct MatesView {
    pub hired: Vec<MateView>,
    /// 各港口酒馆中等待招募的航海士
    pub available: Vec<MateView>,
}

pub fn mates_view(world: &World) -> MatesView {
    mates_view_in(Ctx::plain(&world.defs), world)
}

pub fn mates_view_in(ctx: Ctx<'_>, world: &World) -> MatesView {
    let mut hired = Vec::new();
    let mut available = Vec::new();
    for (id, m) in &world.state.mates {
        let Some(v) = mate_view_in(ctx, world, *id) else { continue };
        if m.owner == Some(PLAYER) {
            hired.push(v);
        } else if m.owner.is_none() && !world.defs.mates.get(id.idx()).is_some_and(|d| d.hidden) {
            available.push(v);
        }
    }
    MatesView { hired, available }
}

// ───────────────────────────── 战术海战 ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct UnitOptions {
    pub unit: u8,
    /// 可到达的格子（q, r, 消耗）
    pub moves: Vec<(i64, i64, i64)>,
    pub fire: Vec<u8>,
    pub board: Vec<u8>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TacticalView {
    pub battle: manifest_core::battle::TacticalBattle,
    pub gun_range: i64,
    pub max_turns: u32,
    pub options: Vec<UnitOptions>,
}

pub fn tactical_view(world: &World, id: BattleId) -> Option<TacticalView> {
    let t = world.state.battles.tactical.get(&id)?.clone();
    let range = world.defs.rules.battle.gun_range;
    let options = t
        .units
        .iter()
        .filter(|u| u.player && u.status == manifest_core::battle::UnitStatus::Active)
        .map(|u| {
            let enemies: Vec<u8> = t
                .units
                .iter()
                .filter(|e| !e.player && e.status == manifest_core::battle::UnitStatus::Active)
                .map(|e| e.id)
                .collect();
            UnitOptions {
                unit: u.id,
                moves: t.reachable(u.id).into_iter().map(|((q, r), (c, _))| (q, r, c)).collect(),
                fire: enemies.iter().copied().filter(|e| t.can_fire(u.id, *e, range)).collect(),
                board: enemies.iter().copied().filter(|e| t.can_board(u.id, *e)).collect(),
            }
        })
        .collect();
    Some(TacticalView { battle: t, gun_range: range, max_turns: world.defs.rules.battle.max_turns, options })
}

/// 迷雾：每行一个字符串，'1' 为已揭开。
pub fn fog_rows(world: &World) -> Vec<String> {
    let w = world.defs.map.width as usize;
    let h = world.defs.map.height as usize;
    let e = &world.state.explore;
    (0..h).map(|y| (0..w).map(|x| if e.is_revealed(y * w + x) { '1' } else { '0' }).collect()).collect()
}

// ───────────────────────────── 港口 ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct MarketRow {
    pub good: u16,
    pub price: Money,
    pub base_price: Money,
    pub stock: i64,
    pub target: i64,
    pub specialty: bool,
    pub popular: bool,
    /// 近来的收盘价（交易所的走势小图与明细）；这里不出售、手上也没有的货为空（交易所不显示这些行）
    pub history: Vec<Money>,
    /// 玩家在此地（停靠舰队、仓库、商队）持有的数量
    pub held: i64,
    pub avg_cost: Money,
    /// 势力的经济政策（ECONOMY.md 8.4）：这里禁止运出；出口税与进口关税的系数（万分之一，1 倍时不写）
    #[serde(skip_serializing_if = "is_false")]
    pub banned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub export_tax_bp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub import_tax_bp: Option<i64>,
    /// 开放市场（`manifest_core::open_market`）：这里出售这种货（买入页只列出售的，以本地特产为主）；
    /// 开放市场关闭时清单里的都出售
    pub sold: bool,
    /// 开放市场补上的只收不卖的条目（不在地点的市场清单里）
    #[serde(skip_serializing_if = "is_false")]
    pub extra: bool,
    /// 开放市场：离这里最近的特产地与贸易距离（格，取整）；特产、开放市场关闭或到不了任何特产地时为空
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nearest: Option<(u16, i64)>,
    /// 货档（T01）：在这里买入这种货要的商誉（0 档、这座港口保底放开的、没有货档的世界不写）
    #[serde(skip_serializing_if = "is_zero_i64")]
    pub rank_need: i64,
    /// 货档把它锁住了：还差多少商誉（买得了时不写）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank_short: Option<i64>,
    /// 商誉不够却买得了的缘由：errand（手上的请托、委托要这种货）；别的情形不写
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank_pass: Option<&'static str>,
    pub normal: Money,
    pub vs_normal_bp: i64,
    pub vs_base_bp: i64,
    /// 未结委托占用这种货，本港暂停出售。
    #[serde(skip_serializing_if = "is_false")]
    pub reserved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rare: Option<RareRowView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub known_range: Option<[Money; 2]>,
}

fn is_zero_i64(v: &i64) -> bool {
    *v == 0
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// 政策系数（不是 1 倍时）。
fn tariff_bp(world: &World, loc: LocId, good: GoodId, side: manifest_core::market::Side) -> Option<i64> {
    let m = world.tariff_mult(loc, good, side);
    (m != Fx::ONE).then_some(m.raw())
}

#[derive(Clone, Debug, Serialize)]
pub struct WarehouseView {
    pub rented: i64,
    pub owned: i64,
    pub capacity: i64,
    pub used: i64,
    pub stock: Vec<CargoLine>,
    /// 商馆代办（T03；规则关闭的世界为空）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agency: Option<AgencyView>,
}

/// 仓库页的“代办”一栏（T03）：挂单位、挂单、最近的成交与可挂的货。
#[derive(Clone, Debug, Serialize)]
pub struct AgencyView {
    /// 这里能挂几张、已挂几张；代办费（百分比）；每级商馆给几张
    pub slots: i64,
    pub used: i64,
    pub fee_pct: i64,
    pub per_level: i64,
    pub orders: Vec<AgencyOrderView>,
    /// 这里最近的代办成交（新的在前）
    pub fills: Vec<AgencyFillView>,
    /// 这里市场上的货：现价、买入税率（万分之一）、仓库里有几件
    pub goods: Vec<AgencyGoodView>,
    pub ledger: AgencyLedgerView,
    #[serde(skip_serializing_if = "is_zero_i64")]
    pub stage_bonus: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgencyOrderView {
    pub id: u32,
    pub good: u16,
    /// "buy" / "sell"
    pub side: &'static str,
    pub limit: Money,
    pub qty: i64,
    pub filled: i64,
    pub reserved: Money,
    pub placed: u32,
    /// 最近一次没能成交的原因代码（价格没到为 agency.price）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub waiting: Option<String>,
    pub done_total: Money,
    pub done_fee: Money,
    pub done_cost: Money,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profit: Option<Money>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgencyFillView {
    pub day: u32,
    pub good: u16,
    pub side: &'static str,
    pub qty: i64,
    pub total: Money,
    pub fee: Money,
    pub cost: Money,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profit: Option<Money>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgencyGoodView {
    pub good: u16,
    pub price: Money,
    pub tax_bp: i64,
    pub stock: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct InvestView {
    pub development: i64,
    pub mine: Money,
    pub share_bp: i64,
    pub ally: Option<String>,
    pub ally_is_me: bool,
    /// 商馆、货档与商誉（T01；规则关闭的世界为空）。内陆城市设不了商馆：`max_level` 为 0，只有声望
    #[serde(skip_serializing_if = "Option::is_none")]
    pub house: Option<HouseView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub growth: Option<DevGrowthView>,
}

/// 商馆的一级：到这一级要的累计投资与它给的好处。
#[derive(Clone, Debug, Serialize)]
pub struct HouseLevelView {
    pub level: usize,
    /// 到这一级要的累计投资
    pub cost: Money,
    /// 商誉加成
    pub goodwill: i64,
    /// 交易税乘数（万分之一）
    pub tax_bp: i64,
    /// 免费仓位
    pub storage: i64,
    /// 照现在的声望，到这一级后在这里买得到第几档（0–3）
    pub top_rank: u8,
}

/// 商馆（T01，`manifest_core::access`）：等级阶梯、现在的商誉、同盟港的条件与市场深度。
#[derive(Clone, Debug, Serialize)]
pub struct HouseView {
    pub level: usize,
    pub max_level: usize,
    /// 在当地势力的声望，与这里的商誉（声望 + 商馆加成）
    pub reputation: i64,
    pub goodwill: i64,
    /// 买入 0 档、1 档……的货要的商誉
    pub rank_goodwill: Vec<i64>,
    /// 现在在这里买得到第几档（同盟港的主人与宽限期里是最高档）
    pub top_rank: u8,
    /// 0 级到最高级
    pub levels: Vec<HouseLevelView>,
    /// 升到下一级还差多少（已经是最高级时为空）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cost: Option<Money>,
    /// 同盟港的条件：占有率门槛（万分之一）与要的商馆等级
    pub ally_share_bp: i64,
    pub ally_house: usize,
    /// 旧存档的宽限期还剩几天（全档可买；不在宽限期里为空）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grace_left: Option<u32>,
    /// 市场深度系数（万分之一）：现在的，与把“到下一级还差的钱”投下去之后的
    pub depth_bp: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub depth_next_bp: Option<i64>,
    /// 超出初值的发展度每隔几个月掉 1 点
    pub decay_months: u32,
    /// 分红（T02 `[dividends]`；规则关闭或没有货币流通时为空）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dividend: Option<DividendView>,
    /// 遭劫的风险与上次遭劫（T02；规则关闭时为空）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub risk: Option<SackRiskView>,
    /// 这座港口船厂的发展度台阶（T02 `[shipyard_growth]`；规则关闭或没有船厂时为空）
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub yard_steps: Vec<YardStepView>,
    /// 本港投资者的前几名（T02；没有人投过时为空）
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub investors: Vec<InvestorView>,
    /// 商馆代办的挂单位与产业位：现在与下一级（T03；规则关闭时为空）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agency: Option<HouseAgencyView>,
}

/// 投资页上的“下一级多几个挂单位 / 产业位”（T03）。
#[derive(Clone, Debug, Serialize)]
pub struct HouseAgencyView {
    pub orders: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orders_next: Option<i64>,
    /// 产业位（规则没写 industry_slots、或不是港口时为空）与这里已有几处
    #[serde(skip_serializing_if = "Option::is_none")]
    pub industry: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub industry_next: Option<i64>,
    pub industries: i64,
    /// 当前产业位中来自阶段的加成。
    #[serde(skip_serializing_if = "is_zero_i64")]
    pub stage_bonus: i64,
}

/// 商馆分红（T02）：上个月分到的、照规则的年收益率，以及上个月本港可分的总额是不是被上限压住了。
#[derive(Clone, Debug, Serialize)]
pub struct DividendView {
    /// 照规则（没有上限时）的年收益率（万分之一）：年利率 × 现在的市场深度系数
    pub yield_bp: i64,
    /// 照现在的累计投资，下个月应得多少
    pub next_due: Money,
    /// 上个月分到多少（没分到时为 0）；上个月分红的日子（没有时为空）
    pub last: Money,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_day: Option<u32>,
    /// 上个月实得折成的年收益率（万分之一；没分到时为空）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_yield_bp: Option<i64>,
    /// 上个月本港的应得合计与实分合计，压住它的上限："none" / "hinterland" / "purse"
    pub pool_due: Money,
    pub pool_paid: Money,
    pub cap: &'static str,
    /// 规则：年利率（百分比）与腹地收入的上限（百分比）
    pub annual_pct: i64,
    pub hinterland_pct: i64,
}

/// 遭劫的风险（T02）：规则写的折损比例，与这座港口上次遭劫的情形。
#[derive(Clone, Debug, Serialize)]
pub struct SackRiskView {
    /// 遭劫时累计投资折损的百分比；商馆到 `house_level` 级的只折 `house_pct`
    pub loss_pct: i64,
    pub house_pct: i64,
    pub house_level: usize,
    /// 照你现在的商馆等级，遭劫时会折损多少
    pub exposure: Money,
    /// 上次遭劫（还在提醒的日子里；没有时为空）：哪一天、你折损多少、全部投资者合计折损多少
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_day: Option<u32>,
    pub last_loss: Money,
    pub last_total: Money,
}

/// 船厂的一个发展度台阶（T02）：到这个发展度开造哪些船型，现在到了没有。
#[derive(Clone, Debug, Serialize)]
pub struct YardStepView {
    pub development: i64,
    pub ships: Vec<u16>,
    pub reached: bool,
}

/// 船厂还没开造的一种船（T02）：发展度到多少开造。
#[derive(Clone, Debug, Serialize)]
pub struct ShipUpcomingView {
    pub ship: u16,
    pub development: i64,
}

/// 本港的一位投资者（T02）：名字、累计投资、商馆等级、是不是你。
#[derive(Clone, Debug, Serialize)]
pub struct InvestorView {
    pub name: String,
    pub me: bool,
    pub amount: Money,
    pub level: usize,
}

/// 船厂还没开造的船型（规则关闭、或这里没有船厂时为空）。
fn shipyard_upcoming_view(world: &World, loc: LocId) -> Vec<ShipUpcomingView> {
    let dev = world.state.locations.get(loc.idx()).map_or(0, |l| l.development);
    manifest_core::house::shipyard_upcoming(&world.defs, loc)
        .into_iter()
        .filter(|(_, need)| dev < *need)
        .map(|(s, need)| ShipUpcomingView { ship: s.0, development: need })
        .collect()
}

/// 船厂的发展度台阶（规则关闭、或这里没有船厂时为空）。
fn yard_steps_view(world: &World, loc: LocId) -> Vec<YardStepView> {
    let dev = world.state.locations.get(loc.idx()).map_or(0, |l| l.development);
    let upcoming = manifest_core::house::shipyard_upcoming(&world.defs, loc);
    world
        .defs
        .rules
        .shipyard_growth
        .steps
        .iter()
        .filter(|_| !upcoming.is_empty())
        .map(|step| YardStepView {
            development: *step,
            ships: upcoming.iter().filter(|(_, need)| need == step).map(|(s, _)| s.0).collect(),
            reached: dev >= *step,
        })
        .collect()
}

/// 本港的分红（规则关闭或没有货币流通时为 None）。
fn dividend_view(world: &World, loc: LocId) -> Option<DividendView> {
    if !world.dividends_on() || !world.defs.loc(loc).is_port() {
        return None;
    }
    let r = &world.defs.rules.dividends;
    let dev = world.state.locations[loc.idx()].development;
    let mine = world.invested(PLAYER, loc);
    let depth = manifest_core::market::depth_factor(&world.defs, dev);
    let rec = world.state.house.dividends.get(&loc);
    let last = rec.map_or(0, |d| d.share_of(PLAYER));
    Some(DividendView {
        yield_bp: depth.apply(r.annual_pct * 100),
        next_due: manifest_core::house::dividend_due(&world.defs, mine, dev),
        last,
        last_day: rec.map(|d| d.day),
        last_yield_bp: (last > 0 && mine > 0).then(|| last.saturating_mul(12 * 10_000) / mine),
        pool_due: rec.map_or(0, |d| d.due),
        pool_paid: rec.map_or(0, |d| d.paid),
        cap: match rec.map(|d| d.cap) {
            Some(manifest_core::house::DividendCap::Hinterland) => "hinterland",
            Some(manifest_core::house::DividendCap::Purse) => "purse",
            _ => "none",
        },
        annual_pct: r.annual_pct,
        hinterland_pct: r.hinterland_pct,
    })
}

/// 遭劫的风险（规则关闭时为 None）。
fn sack_risk_view(world: &World, loc: LocId) -> Option<SackRiskView> {
    let r = &world.defs.rules.dividends;
    if !r.enabled || !world.defs.loc(loc).is_port() {
        return None;
    }
    let mine = world.invested(PLAYER, loc);
    let pct =
        if world.house_level(PLAYER, loc) >= r.sack_house_level { r.sack_loss_pct_house } else { r.sack_loss_pct };
    let sack = world.recent_sack(loc);
    Some(SackRiskView {
        loss_pct: r.sack_loss_pct,
        house_pct: r.sack_loss_pct_house,
        house_level: r.sack_house_level,
        exposure: mine - manifest_core::fixed::mul_div_floor(mine, 100 - pct, 100),
        last_day: sack.map(|s| s.day),
        last_loss: sack.map_or(0, |s| s.loss_of(PLAYER)),
        last_total: sack.map_or(0, |s| s.losses.iter().map(|(_, v)| *v).sum()),
    })
}

/// 本港投资者的前五名。
fn investors_view(world: &World, loc: LocId) -> Vec<InvestorView> {
    world
        .top_investors(loc, 5)
        .into_iter()
        .map(|(o, amount)| InvestorView {
            name: owner_label(&world.defs, o),
            me: o == PLAYER,
            amount,
            level: world.house_level(o, loc),
        })
        .collect()
}

/// 照某个商誉买得到第几档。
fn top_rank(rank_goodwill: &[i64], goodwill: i64) -> u8 {
    rank_goodwill.iter().rposition(|need| *need <= 0 || goodwill >= *need).unwrap_or(0) as u8
}

/// 某地的商馆视图（规则关闭时为 None）。只有港口能投资：内陆城市的最高等级是 0，阶梯里只有 0 级。
fn house_view(world: &World, loc: LocId) -> Option<HouseView> {
    let r = &world.defs.rules.access;
    if !r.enabled {
        return None;
    }
    let max_level = if world.defs.loc(loc).is_port() { r.max_house() } else { 0 };
    // 不能投资的地点（内陆城市）用另一组门槛（T02）
    let rank_goodwill = r.rank_table(world.defs.loc(loc).is_port()).to_vec();
    let level = world.house_level(PLAYER, loc);
    let reputation = world.reputation(PLAYER, world.location_faction(loc));
    let goodwill = world.goodwill(PLAYER, loc);
    let mine = world.invested(PLAYER, loc);
    let levels: Vec<HouseLevelView> = (0..=max_level)
        .filter_map(|l| {
            Some(HouseLevelView {
                level: l,
                cost: world.house_threshold(loc, l)?,
                goodwill: r.house_goodwill.get(l).copied().unwrap_or(0),
                tax_bp: r.house_tax.get(l).copied().unwrap_or(Fx::ONE).raw(),
                storage: r.house_storage.get(l).copied().unwrap_or(0),
                top_rank: top_rank(&rank_goodwill, reputation + r.house_goodwill.get(l).copied().unwrap_or(0)),
            })
        })
        .collect();
    let next_cost =
        (level < max_level).then(|| world.house_threshold(loc, level + 1)).flatten().map(|need| (need - mine).max(0));
    let development = world.state.locations[loc.idx()].development;
    let depth = |dev: i64| manifest_core::market::depth_factor(&world.defs, dev).raw();
    let free = world.buy_access(PLAYER, loc).free();
    let top = if free { rank_goodwill.len().saturating_sub(1) as u8 } else { top_rank(&rank_goodwill, goodwill) };
    Some(HouseView {
        level,
        max_level,
        reputation,
        goodwill,
        rank_goodwill,
        top_rank: top,
        levels,
        next_cost,
        ally_share_bp: world.defs.rules.invest.ally_share.raw(),
        ally_house: r.ally_house,
        grace_left: world.access_grace_left(),
        depth_bp: depth(development),
        depth_next_bp: next_cost.filter(|c| *c > 0).map(|c| {
            let max = if world.defs.rules.development.enabled { world.defs.rules.development.max } else { 100 };
            depth((development + manifest_core::invest::development_gain(world, loc, c)).min(max))
        }),
        decay_months: if world.defs.rules.development.enabled { 0 } else { world.defs.rules.invest.decay_months },
        dividend: dividend_view(world, loc),
        risk: sack_risk_view(world, loc),
        yard_steps: yard_steps_view(world, loc),
        investors: investors_view(world, loc),
        agency: house_agency_view(world, loc, level, max_level),
    })
}

fn house_agency_view(world: &World, loc: LocId, level: usize, max_level: usize) -> Option<HouseAgencyView> {
    if !world.agency_on() {
        return None;
    }
    let per = world.defs.rules.agency.orders_per_level;
    let next = (level < max_level).then_some(level + 1);
    let slots = world.industry_slots(PLAYER, loc);
    Some(HouseAgencyView {
        orders: world.agency_slots(PLAYER, loc),
        orders_next: next.map(|l| {
            (l as i64 * per).saturating_add(world.stage_bonus(loc, &world.defs.rules.stage_unlocks.agency_bonus))
        }),
        industry: slots,
        industry_next: next
            .filter(|_| slots.is_some())
            .and_then(|l| world.industry_slots_at_level(l))
            .map(|n| n.saturating_add(world.stage_bonus(loc, &world.defs.rules.stage_unlocks.industry_bonus))),
        industries: world.industries_at(PLAYER, loc),
        stage_bonus: world.industry_stage_bonus(PLAYER, loc),
    })
}

fn agency_view(world: &World, loc: LocId) -> Option<AgencyView> {
    use manifest_core::agency::OrderSide;
    if !world.agency_on() {
        return None;
    }
    let side = |s: OrderSide| if s == OrderSide::Buy { "buy" } else { "sell" };
    let holder = manifest_core::warehouse::Holder::Warehouse(loc);
    let orders: Vec<AgencyOrderView> = manifest_core::agency::orders_of(world, PLAYER, loc)
        .into_iter()
        .map(|o| AgencyOrderView {
            id: o.id,
            good: o.good.0,
            side: side(o.side),
            limit: o.limit,
            qty: o.qty,
            filled: o.filled,
            reserved: o.reserved,
            placed: o.placed,
            waiting: o.waiting.clone(),
            done_total: o.done_total,
            done_fee: o.done_fee,
            done_cost: o.done_cost,
            profit: (world.defs.rules.trade_books.enabled && o.side == OrderSide::Sell)
                .then_some(o.done_total - o.done_fee - o.done_cost),
        })
        .collect();
    let fills = world
        .state
        .agency
        .fills
        .iter()
        .rev()
        .filter(|f| f.owner == PLAYER && f.loc == loc)
        .take(12)
        .map(|f| AgencyFillView {
            day: f.day,
            good: f.good.0,
            side: side(f.side),
            qty: f.qty,
            total: f.total,
            fee: f.fee,
            cost: f.cost,
            profit: (world.defs.rules.trade_books.enabled && f.side == OrderSide::Sell)
                .then_some(f.total - f.fee - f.cost),
        })
        .collect();
    let goods = world.state.locations[loc.idx()]
        .market
        .iter()
        .filter(|(g, e)| !e.extra && world.good_revealed(**g))
        .map(|(g, e)| AgencyGoodView {
            good: g.0,
            price: e.price,
            tax_bp: manifest_core::market::quote(world, PLAYER, loc, *g, manifest_core::market::Side::Buy, 1)
                .map(|q| q.tax_rate.raw())
                .unwrap_or(0),
            stock: world.holder_qty(PLAYER, holder, *g),
        })
        .collect();
    Some(AgencyView {
        slots: world.agency_slots(PLAYER, loc),
        used: orders.len() as i64,
        fee_pct: world.defs.rules.agency.fee_pct,
        per_level: world.defs.rules.agency.orders_per_level,
        orders,
        fills,
        goods,
        ledger: agency_ledger_view(world, loc),
        stage_bonus: world.agency_stage_bonus(PLAYER, loc),
    })
}

#[derive(Clone, Debug, Serialize)]
pub struct RelationView {
    pub other: u16,
    pub status: &'static str,
    pub value: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct OfficeView {
    pub faction: u16,
    pub reputation: i64,
    pub license: bool,
    pub marque: bool,
    pub at_war: bool,
    pub relations: Vec<RelationView>,
}

#[derive(Clone, Debug, Serialize)]
pub struct LoanView {
    pub id: u32,
    pub principal: Money,
    pub rate_bp: i64,
    pub start_day: u32,
    pub due_day: u32,
    pub overdue: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct BankView {
    pub deposit: Money,
    pub loans: Vec<LoanView>,
    pub credit_score: i64,
    pub grade: &'static str,
    pub defaults: u32,
    pub limit: Money,
    pub rate_bp: i64,
    pub deposit_rate_bp: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guarantee: Option<BankGuaranteeView>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ContractView {
    pub id: u32,
    pub issuer: u16,
    pub good: u16,
    pub qty: i64,
    pub to: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    pub deadline: u32,
    pub reward: Money,
    pub penalty: Money,
    /// open / mine / completed / failed / expired / taken
    pub status: &'static str,
    pub ai: bool,
    /// small / regular；AI 合同始终 regular。
    pub size: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<u16>,
    pub cells: i64,
    pub need_days: u32,
    pub urgency_bp: i64,
    pub rep: i64,
    pub pass_days: u32,
}

#[derive(Clone, Debug, Serialize)]
pub struct DialogView {
    pub day: u32,
    pub intent: String,
    pub player_text: String,
    pub reply: String,
    pub discount_bp: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct ChartOffer {
    pub region: u16,
    pub price: Money,
    pub owned: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct PortView {
    pub shop: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auction: Option<String>,
    pub loc: u16,
    /// 是否到过（未到过时不显示市场信息）
    pub known: bool,
    pub mates_here: Vec<MateView>,
    pub charts: Vec<ChartOffer>,
    pub tax_bp: i64,
    pub market: Vec<MarketRow>,
    /// 船厂在售船型（T02：随发展度多出来的接在数据里的清单后面）
    pub shipyard: Vec<u16>,
    /// 船厂还没开造、发展度到了才开造的船型（T02 `[shipyard_growth]`；规则关闭或没有船厂时为空）
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub shipyard_upcoming: Vec<ShipUpcomingView>,
    pub fleets_here: Vec<u32>,
    pub caravans_here: Vec<u32>,
    pub warehouse: WarehouseView,
    pub invest: InvestView,
    pub office: OfficeView,
    pub bank: BankView,
    pub contracts: Vec<ContractView>,
    pub bargain: Option<(i64, u32)>,
    pub dialogs: Vec<DialogView>,
    pub exchange: Option<u16>,
    pub industries_here: Vec<u32>,
    /// 酒馆传闻：某位算学奇才这一季在哪处港口的酒馆（没有传闻时为空）
    pub genius_rumor: Option<GeniusRumorView>,
    /// 人口、繁荣度与市况（人口规则关闭或还没到过时为空；ECONOMY.md 6.4）
    pub people: Option<PeopleView>,
    /// 城镇工坊（还没到过时为空；ECONOMY.md 6.5）
    pub workshops: Vec<WorkshopView>,
    /// 行情的时效与来源（随船传递、远方港口；看得到实时行情时为空；ECONOMY.md 第 7 节）
    pub seen: Option<SeenView>,
    /// 行情通报（随船传递、玩家在这个港口时）
    pub report: Option<ReportOfferView>,
    /// 酒馆里的商会传闻：本据港在这里或有船队停在这里的商会近 30 天的展望（ECONOMY.md 8.2）
    pub outlooks: Vec<OutlookRumorView>,
    /// 城镇钱袋与所属势力的国库（货币流通，ECONOMY.md 6.9；规则关闭、还没到过或只知道旧消息时为空）
    pub purse: Option<PurseView>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub facilities: Vec<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rare_rumor: Option<u16>,
}

/// 城镇钱袋：当地的报价乘流动性系数（钱袋相对往常的多少）。
#[derive(Clone, Debug, Serialize)]
pub struct PurseView {
    pub money: Money,
    /// 参照钱袋（往常的水平）
    pub reference: Money,
    /// 流动性系数（万分之一）
    pub liquidity_bp: i64,
    /// 累计由腹地替它付出的缺口（钱袋见底时卖货给市场，差额由腹地付）
    pub gaps: Money,
    /// 所属势力的国库
    pub treasury: Option<TreasuryView>,
}

/// 势力国库。
#[derive(Clone, Debug, Serialize)]
pub struct TreasuryView {
    pub faction: String,
    pub money: Money,
    /// 财政的税率系数（万分之一；亏空加税、富余减税）
    pub tax_mult_bp: i64,
    /// 海军巡逻度（万分之一）
    pub patrol_bp: i64,
}

fn purse_view(defs: &StaticData, world: &World, loc: LocId) -> Option<PurseView> {
    if !world.circulation_on() {
        return None;
    }
    let p = world.purse(loc)?;
    let f = world.defs.loc(loc).faction;
    Some(PurseView {
        money: p.money,
        reference: p.reference,
        liquidity_bp: p.liquidity.raw(),
        gaps: p.gaps,
        treasury: world.treasury(f).map(|t| TreasuryView {
            faction: defs.faction(f).name.clone(),
            money: t.money,
            tax_mult_bp: t.tax_mult.raw(),
            patrol_bp: t.patrol.raw(),
        }),
    })
}

/// 酒馆里的一条商会传闻。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct OutlookRumorView {
    pub company: String,
    pub day: u32,
    pub memo: String,
}

/// 酒馆里的商会传闻：商会的展望是真实的动向，玩家可以利用。
fn outlook_rumors(ctx: Ctx<'_>, world: &World, loc: LocId) -> Vec<OutlookRumorView> {
    let today = world.day();
    world
        .state
        .agents
        .values()
        .filter(|a| a.owner.company().is_some() && !a.bankrupt)
        .filter(|a| a.home == loc || world.fleets_of(a.owner).any(|f| f.docked_at() == Some(loc)))
        .filter_map(|a| {
            let o = a.strategy.as_ref()?.outlook.as_ref()?;
            (o.day + manifest_core::commerce::OUTLOOK_DAYS > today).then(|| OutlookRumorView {
                company: owner_label(ctx.names, a.owner),
                day: o.day,
                memo: ctx.text(world, &o.memo, o.tpl.as_ref()),
            })
        })
        .collect()
}

/// 港口的人口、繁荣度与市况（ECONOMY.md 6.4）。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct PeopleView {
    pub pop: i64,
    pub pop0: i64,
    /// 繁荣度（0–100，万分之一精度：500000 为 50）与它正在靠近的目标
    pub prosperity_bp: i64,
    pub goal_bp: i64,
    /// stable / boom / depression / famine / glut
    pub condition: &'static str,
    /// 进入当前市况的日期
    pub since: u32,
    /// 上个月必需、舒适、奢侈三层的满足度（万分之一）
    pub sat_bp: [i64; 3],
    /// 按当前繁荣度，人口每月的增减幅（万分之一）
    pub growth_bp: i64,
    /// 头一年还在记参照（繁荣度与人口不动）
    pub learning: bool,
}

/// 一座城镇工坊（ECONOMY.md 6.5）。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct WorkshopView {
    pub recipe: u16,
    pub output: u16,
    pub out_qty: i64,
    /// （商品 id, 每轮用量）
    pub inputs: Vec<(u16, i64)>,
    /// 接手当地这种商品均衡产量的份额（万分之一）
    pub share_bp: i64,
    /// 当前产能（万分之一件产出 / 天）与相对开局的比例（万分之一）
    pub daily_bp: i64,
    pub capacity_bp: i64,
    /// 今天做了几件；是否缺料少做、是否亏本停工
    pub made: i64,
    pub short: bool,
    pub stopped: bool,
    /// 上个月的产出价值 / 原料价值（万分之一；0 表示还没有满一个月）
    pub value_bp: i64,
    /// 头一年还在记参照（产能不动）
    pub learning: bool,
}

fn people_view(world: &World, loc: LocId) -> Option<PeopleView> {
    let p = world.people(loc)?;
    let r = &world.defs.rules.population;
    let mid = Fx::from_int(50);
    let growth = if p.learned_in(world.defs.calendar.months().len()) {
        r.growth.mul((p.prosperity - mid).div(mid)).raw()
    } else {
        0
    };
    Some(PeopleView {
        pop: p.pop,
        pop0: p.pop0,
        prosperity_bp: p.prosperity.raw(),
        goal_bp: p.goal.raw(),
        condition: p.condition.key(),
        since: p.since,
        sat_bp: p.sat.map(|s| s.raw()),
        growth_bp: growth,
        learning: !p.learned_in(world.defs.calendar.months().len()),
    })
}

fn workshop_views(world: &World, loc: LocId) -> Vec<WorkshopView> {
    let defs = &world.defs;
    if !defs.rules.workshops.enabled {
        return Vec::new();
    }
    defs.loc(loc)
        .workshops
        .iter()
        .map(|wd| {
            let ws = world.workshop(loc, wd.recipe);
            WorkshopView {
                recipe: wd.recipe.0,
                output: wd.output.0,
                out_qty: wd.out_qty,
                inputs: wd.inputs.iter().map(|(g, q)| (g.0, *q)).collect(),
                share_bp: wd.share.raw(),
                daily_bp: ws.map(|w| w.k).unwrap_or(0),
                capacity_bp: ws.map(|w| w.capacity_ratio().raw()).unwrap_or(Fx::SCALE),
                made: ws.map(|w| w.made).unwrap_or(0),
                short: ws.is_some_and(|w| w.short),
                stopped: ws.is_some_and(|w| w.stopped),
                value_bp: ws.map(|w| w.ratio.raw()).unwrap_or(0),
                learning: !ws.is_some_and(|w| w.learned_in(world.defs.calendar.months().len())),
            }
        })
        .collect()
}

/// 酒馆传闻里的算学奇才（ECONOMY.md 4.3.1：奇才每季换一处酒馆，传闻偶尔透露去向）。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct GeniusRumorView {
    pub mate: u16,
    pub name: String,
    /// 这一季落脚的港口
    pub loc: u16,
    /// 他会的奇才之法
    pub methods: Vec<String>,
}

/// 酒馆传闻：每季每处港口的酒馆有三分之一的机会传出一位（不在本港的）算学奇才的去向；按种子、季与港口确定，同一季里不变。
fn genius_rumor(ctx: Ctx<'_>, world: &World, loc: LocId) -> Option<GeniusRumorView> {
    use manifest_core::rng::{Domain, Rng};
    let defs = ctx.names;
    if !defs.loc(loc).is_port() {
        return None;
    }
    let away: Vec<(MateId, LocId)> = world.wandering_geniuses().into_iter().filter(|(_, at)| *at != loc).collect();
    if away.is_empty() {
        return None;
    }
    let season_start = world.day().saturating_sub(world.defs.calendar.season_elapsed(world.day()).0);
    let mut rng = Rng::derive(world.state.seed, season_start, Domain::Captain, 200 + loc.0 as u64, 0);
    if !rng.chance_bp(3_334) {
        return None;
    }
    let (mate, at) = away[rng.range(0, away.len() as i64 - 1) as usize];
    let d = defs.mates.get(mate.idx())?;
    Some(GeniusRumorView { mate: mate.0, name: d.name.clone(), loc: at.0, methods: d.methods.clone() })
}

fn status_key(s: DiploStatus) -> &'static str {
    match s {
        DiploStatus::Peace => "peace",
        DiploStatus::Tension => "tension",
        DiploStatus::War => "war",
        DiploStatus::Truce => "truce",
    }
}

pub fn contract_view(world: &World, c: &manifest_core::contract::TransportContract) -> ContractView {
    use manifest_core::contract::{ContractSource, ContractStatus};
    let status = match c.status {
        ContractStatus::Open => "open",
        ContractStatus::Accepted(o) if o == PLAYER => "mine",
        ContractStatus::Accepted(_) => "taken",
        ContractStatus::Completed(_) => "completed",
        ContractStatus::Failed(_) => "failed",
        ContractStatus::Expired => "expired",
    };
    let r = &world.defs.rules.contracts;
    ContractView {
        id: c.id.0,
        issuer: c.issuer.0,
        good: c.good.0,
        qty: c.qty,
        to: Some(c.to.0),
        direction: None,
        deadline: c.deadline,
        reward: c.reward,
        penalty: c.penalty,
        status,
        ai: c.source == ContractSource::Ai,
        size: if r.v2.enabled && c.small && c.source != ContractSource::Ai { "small" } else { "regular" },
        source: c.source_port.filter(|l| r.v2.enabled && world.location_visible(*l)).map(|l| l.0),
        cells: if r.v2.enabled { c.cells } else { 0 },
        need_days: if r.v2.enabled { c.need_days } else { 0 },
        urgency_bp: if r.v2.enabled { c.urgency_bp } else { 0 },
        rep: if !r.v2.enabled {
            0
        } else if c.small {
            r.v2.small_reputation
        } else {
            r.reputation_gain
        },
        pass_days: if r.v2.enabled { r.v2.pass_days } else { 0 },
    }
}

pub fn bank_view(world: &World) -> BankView {
    let agent = world.state.agents.get(&PLAYER);
    let credit = agent.map(|a| a.credit.clone()).unwrap_or_default();
    BankView {
        deposit: agent.map(|a| a.deposit).unwrap_or(0),
        loans: world
            .loans_of(PLAYER)
            .map(|l| LoanView {
                id: l.id.0,
                principal: l.principal,
                rate_bp: l.rate.raw(),
                start_day: l.start_day,
                due_day: l.due_day,
                overdue: l.overdue,
            })
            .collect(),
        credit_score: credit.score,
        grade: manifest_core::bank::grade(credit.score),
        defaults: credit.defaults,
        limit: world.loan_limit(PLAYER),
        rate_bp: world.loan_rate(PLAYER).raw(),
        deposit_rate_bp: world.defs.rules.bank.deposit_rate.raw(),
        guarantee: bank_guarantee_view(world, PLAYER),
    }
}

pub fn port_view(world: &World, loc: LocId) -> PortView {
    port_view_in(Ctx::plain(&world.defs), world, loc)
}

/// 港口：航海士、同盟方与议价对话按当前语言。
pub fn port_view_in(ctx: Ctx<'_>, world: &World, loc: LocId) -> PortView {
    let defs = ctx.names;
    let ldef = defs.loc(loc);
    let lstate = &world.state.locations[loc.idx()];
    let day = world.day();
    let fleets_here: Vec<&manifest_core::world::Fleet> =
        world.fleets_of(PLAYER).filter(|f| f.docked_at() == Some(loc)).collect();
    let caravans_here: Vec<&manifest_core::caravan::Caravan> =
        world.caravans_of(PLAYER).filter(|c| c.at() == Some(loc)).collect();
    let wh = world.warehouse(PLAYER, loc);
    let book = world.state.agents.get(&PLAYER).map(|a| &a.book);
    // 信息时效：远方港口的价格、库存与日线是手上快照里的（实时模式下与在场时是实时的）
    let sight = world.sight(PLAYER);
    // 开放市场：这里出售的货（特产为主）与各种货最近的特产地（关闭时清单里的都出售、不写产地）
    let open = world.defs.rules.open_market.enabled;
    let sale = open.then(|| world.market_sale_list(loc));
    let nearest = if open { manifest_core::open_market::nearest_producers(&world.defs, loc) } else { Vec::new() };
    // 货档（T01）：这里各种货要的商誉与锁没锁（规则关闭时什么都不锁）
    let access = world.buy_access(PLAYER, loc);
    let market = lstate
        .market
        .iter()
        .filter_map(|(g, e)| {
            if !world.good_revealed(*g) || !world.market_open(loc, *g) {
                return None;
            }
            let k = sight.market(loc, *g)?;
            let held = fleets_here.iter().map(|f| f.cargo.get(g).copied().unwrap_or(0)).sum::<i64>()
                + caravans_here.iter().map(|c| c.cargo.get(g).copied().unwrap_or(0)).sum::<i64>()
                + wh.and_then(|w| w.stock.get(g).copied()).unwrap_or(0);
            let sold = !e.extra
                && sale.as_ref().is_none_or(|s| s.contains(g))
                && (!manifest_core::stages::is_rare(&world.defs, *g)
                    || manifest_core::stages::rare_source(&world.defs, *g) == Some(loc));
            let rare = rare_row_view(world, loc, *g, k.is_live());
            let foreign_rare = rare.is_some() && manifest_core::stages::rare_source(&world.defs, *g) != Some(loc);
            let price = if foreign_rare {
                if k.is_live() { world.rare_sell_unit(loc, *g, 0) } else { world.rare_peak(loc, *g) }
            } else {
                k.price
            };
            let normal = if foreign_rare {
                world.rare_peak(loc, *g)
            } else {
                manifest_core::market::normal_price(&world.defs, e)
            };
            Some(MarketRow {
                good: g.0,
                price,
                base_price: e.base_price,
                stock: k.stock,
                target: e.target,
                specialty: e.specialty,
                popular: k.is_live() && e.popular_until > day,
                // 交易所只显示这里出售的货与手上的货：别的行不带走势（开放市场下每港 72 行，省下网页版的流量）
                history: if !foreign_rare && (sold || held > 0) { k.history().collect() } else { Vec::new() },
                held,
                avg_cost: book.map(|b| b.avg_cost(*g)).unwrap_or(0),
                banned: world.export_banned(loc, *g),
                export_tax_bp: tariff_bp(world, loc, *g, manifest_core::market::Side::Buy),
                import_tax_bp: tariff_bp(world, loc, *g, manifest_core::market::Side::Sell),
                sold,
                extra: e.extra,
                nearest: if e.specialty {
                    None
                } else {
                    nearest.get(g.idx()).copied().flatten().map(|(l, d)| (l.0, d.trunc()))
                },
                // 只有这里出售的货才谈得上锁不锁
                rank_need: if sold { access.need(&world.defs, *g) } else { 0 },
                rank_short: access.gate(&world.defs, *g).filter(|_| sold).map(|gate| gate.need - gate.have),
                rank_pass: (sold
                    && !access.free()
                    && access.wanted(*g)
                    && access.need(&world.defs, *g) > access.goodwill)
                    .then_some(if access.patron.contains(g) { "patron" } else { "errand" }),
                normal,
                vs_normal_bp: manifest_core::fixed::mul_div_floor(price, 10_000, normal.max(1)),
                vs_base_bp: manifest_core::fixed::mul_div_floor(price, 10_000, e.base_price.max(1)),
                reserved: manifest_core::contract::market_reserved(world, loc, *g),
                rare,
                known_range: world
                    .state
                    .story2
                    .flags
                    .contains(&format!("known_good:{}", world.defs.good(*g).key))
                    .then(|| {
                        let lo = world.defs.rules.price_floor.apply(e.base_price).max(1);
                        [lo, world.defs.rules.price_cap.apply(e.base_price).max(lo)]
                    }),
            })
        })
        .collect();
    let agent = world.state.agents.get(&PLAYER);
    let mine = lstate.investments.get(&PLAYER).copied().unwrap_or(0);
    let faction = ldef.faction;
    let relations = world
        .state
        .relations
        .iter()
        .filter_map(|r| {
            let other = if r.a == faction {
                r.b
            } else if r.b == faction {
                r.a
            } else {
                return None;
            };
            Some(RelationView { other: other.0, status: status_key(r.status), value: r.value })
        })
        .collect();
    let known = market_known(world, loc);
    PortView {
        auction: known.then(|| crate::auction_view::port_auction(world, loc)).flatten(),
        shop: known
            && world.defs.items.enabled()
            && world.effective_shop(loc)
            && ldef.is_port()
            && world.at_item_shop(PLAYER, loc)
            && world.item_shelf(loc).is_some(),
        loc: loc.0,
        known,
        mates_here: world
            .state
            .mates
            .iter()
            .filter(|(id, m)| m.owner.is_none() && m.at == loc && !defs.mates.get(id.idx()).is_some_and(|d| d.hidden))
            .filter_map(|(id, _)| mate_view_in(ctx, world, *id))
            .collect(),
        charts: if ldef.is_port() {
            (0..defs.regions.len())
                .map(|i| {
                    let r = RegionId::from_idx(i);
                    ChartOffer {
                        region: i as u16,
                        price: world.chart_price(r),
                        owned: world.state.explore.charts.contains(&r),
                    }
                })
                .collect()
        } else {
            Vec::new()
        },
        tax_bp: manifest_core::market::tax_rate(world, PLAYER, loc).raw(),
        market: if known { market } else { Vec::new() },
        // 船厂清单随发展度（T02 `[shipyard_growth]`；关闭时就是数据里的清单）
        shipyard: world.shipyard(loc).iter().map(|s| s.0).collect(),
        shipyard_upcoming: shipyard_upcoming_view(world, loc),
        fleets_here: fleets_here.iter().map(|f| f.id.0).collect(),
        caravans_here: caravans_here.iter().map(|c| c.id.0).collect(),
        warehouse: WarehouseView {
            rented: wh.map(|w| w.rented).unwrap_or(0),
            owned: wh.map(|w| w.owned).unwrap_or(0),
            capacity: world.warehouse_capacity(PLAYER, loc),
            used: wh.map(|w| w.used()).unwrap_or(0),
            stock: wh.map(|w| cargo_lines(world, PLAYER, &w.stock)).unwrap_or_default(),
            agency: agency_view(world, loc),
        },
        invest: InvestView {
            development: lstate.development,
            mine,
            share_bp: world.investment_share(PLAYER, loc).raw(),
            ally: lstate.ally.map(|o| owner_label(defs, o)),
            ally_is_me: lstate.ally == Some(PLAYER),
            house: house_view(world, loc),
            growth: development_view(world, loc),
        },
        office: OfficeView {
            faction: faction.0,
            reputation: world.reputation(PLAYER, faction),
            license: world.has_license(PLAYER, faction),
            marque: world.has_marque(PLAYER, faction),
            at_war: world.at_war(faction),
            relations,
        },
        bank: bank_view(world),
        contracts: world
            .state
            .contracts
            .values()
            .filter(|c| {
                use manifest_core::contract::ContractStatus;
                match c.status {
                    ContractStatus::Open => c.issuer == faction,
                    ContractStatus::Accepted(o) => o == PLAYER,
                    _ => false,
                }
            })
            .map(|c| {
                let mut view = contract_view(world, c);
                if !world.location_visible(c.to) {
                    view.to = None;
                    view.direction = Some(crate::navigation_view::visibility::place(ctx, world, c.to));
                }
                view
            })
            .collect(),
        bargain: agent
            .and_then(|a| a.bargains.get(&loc))
            .filter(|b| b.until > day)
            .map(|b| (b.discount.raw(), b.until)),
        dialogs: world
            .state
            .news
            .dialogs
            .iter()
            .rev()
            .filter(|d| d.loc == loc && d.owner == PLAYER)
            .take(10)
            .map(|d| DialogView {
                day: d.day,
                intent: manifest_ai::adjudicator::intent_label(d.intent).to_string(),
                player_text: d.player_text.clone(),
                reply: ctx.text(world, &d.reply, d.reply_tpl.as_ref()),
                discount_bp: d.discount.raw(),
            })
            .collect(),
        exchange: defs.exchanges.iter().position(|e| e.port == loc).map(|i| i as u16),
        industries_here: world
            .state
            .industries
            .values()
            .filter(|i| i.owner == PLAYER && i.loc == loc)
            .map(|i| i.id.0)
            .collect(),
        genius_rumor: genius_rumor(ctx, world, loc),
        people: if known { people_view(world, loc) } else { None },
        workshops: if known { workshop_views(world, loc) } else { Vec::new() },
        seen: seen_view(world, loc),
        report: report_offer_view(world, loc),
        outlooks: outlook_rumors(ctx, world, loc),
        // 钱袋是此刻的情况：只在看得到实时行情时给（在场，或行情情报是实时的）
        purse: if known && seen_view(world, loc).is_none() { purse_view(defs, world, loc) } else { None },
        facilities: manifest_core::stages::facilities_at(&world.defs, loc, lstate.development),
        rare_rumor: world.rare_rumor(loc).map(|g| g.0),
    }
}

// ───────────────────────────── 期货 ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct PositionView {
    pub lots: i64,
    pub avg_price: Money,
    pub physical: bool,
    /// 按盯市价计算的浮动盈亏（相对开仓均价，仅供显示）
    pub pnl: Money,
}

#[derive(Clone, Debug, Serialize)]
pub struct FuturesRow {
    pub id: u32,
    pub exchange: u16,
    pub good: u16,
    pub lot: i64,
    pub delivery: u16,
    pub expiry_day: u32,
    pub days_left: u32,
    pub bid: Money,
    pub ask: Money,
    pub fair: Money,
    pub mark: Money,
    pub spot: Money,
    pub position: Option<PositionView>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ExchangeAccount {
    pub exchange: u16,
    pub balance: Money,
    pub initial_requirement: Money,
    pub maintenance_requirement: Money,
    pub call_since: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
pub struct FuturesView {
    pub accounts: Vec<ExchangeAccount>,
    pub contracts: Vec<FuturesRow>,
}

pub fn futures_view(world: &World) -> FuturesView {
    let defs = &world.defs;
    let day = world.day();
    let accounts = defs
        .exchanges
        .iter()
        .enumerate()
        .filter(|(_, e)| world.location_visible(e.port))
        .map(|(i, e)| {
            let ex = ExchangeId(i as u16);
            ExchangeAccount {
                exchange: i as u16,
                balance: world.margin_balance(PLAYER, ex),
                initial_requirement: world.margin_requirement(PLAYER, ex, e.initial_margin),
                maintenance_requirement: world.margin_requirement(PLAYER, ex, e.maintenance_margin),
                call_since: world.state.futures.calls.get(&PLAYER).and_then(|m| m.get(&ex)).copied(),
            }
        })
        .collect();
    let contracts = world
        .state
        .futures
        .contracts
        .values()
        .filter(|c| !c.settled)
        .filter_map(|c| {
            let spec = &defs.futures_specs[c.spec as usize];
            if !world.location_visible(spec.delivery) || !world.location_visible(defs.exchange(spec.exchange).port) {
                return None;
            }
            let q = world.futures_quote(c.id)?;
            let position = world.position(PLAYER, c.id).filter(|p| p.lots != 0).map(|p| PositionView {
                lots: p.lots,
                avg_price: p.avg_price,
                physical: p.physical,
                pnl: (c.mark - p.avg_price) * p.lots * spec.lot,
            });
            Some(FuturesRow {
                id: c.id.0,
                exchange: spec.exchange.0,
                good: spec.good.0,
                lot: spec.lot,
                delivery: spec.delivery.0,
                expiry_day: c.expiry_day,
                days_left: c.expiry_day.saturating_sub(day),
                bid: q.bid,
                ask: q.ask,
                fair: q.fair,
                mark: q.mark,
                // 交割港的现货价：玩家所知的（随船传递时可能是快照；不知道时为 0）
                spot: world.known_market(PLAYER, spec.delivery, spec.good).map(|k| k.price).unwrap_or(0),
                position,
            })
        })
        .collect();
    FuturesView { accounts, contracts }
}

// ───────────────────────────── 商队路线 ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct RouteLeg {
    pub road: u16,
    pub from: u16,
    pub to: u16,
    pub length: i64,
    pub toll_bp: i64,
    /// 每日遭劫概率（万分之一）
    pub robbery_bp: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct CaravanPlanView {
    pub stops: Vec<u16>,
    pub legs: Vec<RouteLeg>,
    pub days: i64,
    pub distance: i64,
    /// 按给定货值估算的关卡税合计
    pub tolls: Money,
    /// 全程至少遭劫一次的概率（万分之一，估算）
    pub risk_bp: i64,
    /// 驮畜与护卫开销合计
    pub upkeep: Money,
}

pub fn caravan_plan(
    world: &World,
    animal: AnimalId,
    count: i64,
    guards: i64,
    from: LocId,
    to: LocId,
    cargo_value: Money,
) -> Option<CaravanPlanView> {
    let defs = &world.defs;
    let (stops, roads, days) = manifest_core::caravan::find_route(defs, animal, from, to)?;
    if stops.iter().any(|id| !world.location_visible(*id)) {
        return None;
    }
    let mut legs = Vec::new();
    let mut tolls = 0;
    // 不遭劫的概率（万分之一），逐日相乘
    let mut safe = Fx::SCALE;
    for (i, r) in roads.iter().enumerate() {
        let rd = defs.road(*r);
        let bp = manifest_core::caravan::robbery_bp(defs, rd, count.max(1), guards);
        let speed = manifest_core::caravan::road_speed(defs, animal, *r);
        let leg_days = (rd.length.raw() + speed.raw() - 1) / speed.raw().max(1);
        for _ in 0..leg_days.max(1) {
            safe = mul_div(safe, Fx::SCALE - bp, Fx::SCALE);
        }
        tolls += rd.toll.apply(cargo_value);
        legs.push(RouteLeg {
            road: r.0,
            from: stops[i].0,
            to: stops[i + 1].0,
            length: rd.length.raw() / Fx::SCALE,
            toll_bp: rd.toll.raw(),
            robbery_bp: bp,
        });
    }
    let a = defs.animal(animal);
    Some(CaravanPlanView {
        stops: stops.iter().map(|l| l.0).collect(),
        distance: legs.iter().map(|l| l.length).sum(),
        legs,
        days,
        tolls,
        risk_bp: Fx::SCALE - safe,
        upkeep: (a.upkeep * count + defs.rules.caravan.guard_wage * guards) * days,
    })
}

// ───────────────────────────── 产业 ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct IndustryView {
    pub id: u32,
    pub loc: u16,
    pub kind: u16,
    pub recipe: u16,
    pub level: i64,
    pub manager: bool,
    pub stalled: bool,
    pub book_value: Money,
    /// 当地仓库中投入品的库存
    pub input_stock: Vec<(u16, i64)>,
    /// 估算的日盈亏：产出按当地价 − 投入按当地价 − 工资 − 维护 − 管理人
    pub daily_revenue: Money,
    pub daily_inputs: Money,
    pub daily_costs: Money,
    pub daily_profit: Money,
}

#[derive(Clone, Debug, Serialize)]
pub struct IndustriesView {
    pub industries: Vec<IndustryView>,
    /// 玩家有仓库的地点（可建产业）
    pub sites: Vec<u16>,
}

pub fn industries_view(world: &World) -> IndustriesView {
    let defs = &world.defs;
    let price = |loc: LocId, g: GoodId| world.market(loc, g).map(|e| e.price).unwrap_or(defs.good(g).base_price);
    let industries = world
        .state
        .industries
        .values()
        .filter(|i| i.owner == PLAYER)
        .map(|i| {
            let rc = defs.recipe(i.recipe);
            let t = defs.industry_type(i.kind);
            let eff = world.industry_efficiency(i);
            let scale = |q: i64| eff.apply(q * i.level);
            let revenue: Money = rc.outputs.iter().map(|(g, q)| scale(*q) * price(i.loc, *g)).sum();
            let inputs: Money = rc.inputs.iter().map(|(g, q)| q * i.level * price(i.loc, *g)).sum();
            let manager = if i.manager == manifest_core::industry::Manager::Hired { t.manager_salary } else { 0 };
            let costs = (t.wage * t.workers + t.maintenance) * i.level + manager;
            let wh = world.warehouse(PLAYER, i.loc);
            IndustryView {
                id: i.id.0,
                loc: i.loc.0,
                kind: i.kind.0,
                recipe: i.recipe.0,
                level: i.level,
                manager: i.manager == manifest_core::industry::Manager::Hired,
                stalled: i.stalled,
                book_value: i.book_value,
                input_stock: rc
                    .inputs
                    .iter()
                    .map(|(g, _)| (g.0, wh.and_then(|w| w.stock.get(g).copied()).unwrap_or(0)))
                    .collect(),
                daily_revenue: revenue,
                daily_inputs: inputs,
                daily_costs: costs,
                daily_profit: revenue - inputs - costs,
            }
        })
        .collect();
    let sites = world
        .state
        .locations
        .iter()
        .enumerate()
        // 同盟港与有免费仓位的商馆（T01）也算有地方放货
        .filter(|(i, l)| {
            l.warehouses.contains_key(&PLAYER)
                || l.ally == Some(PLAYER)
                || world.house_storage(PLAYER, LocId::from_idx(*i)) > 0
        })
        .filter(|(i, _)| world.location_visible(LocId::from_idx(*i)))
        // 殖民地的仓库不能建产业（殖民地用自己的建筑）
        .filter(|(i, _)| !defs.locations.get(*i).is_some_and(|d| d.is_site()))
        .map(|(i, _)| i as u16)
        .collect();
    IndustriesView { industries, sites }
}

// ───────────────────────────── 报表 ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct TrendPoint {
    pub day: u32,
    pub total_assets: Money,
    pub equity: Money,
}

#[derive(Clone, Debug, Serialize)]
pub struct ReportsView {
    pub monthly: Vec<FinancialReport>,
    pub yearly: Vec<FinancialReport>,
    pub current: manifest_core::ledger::BalanceSheet,
    pub trend: Vec<TrendPoint>,
    /// 经济月报（货币流通，ECONOMY.md 6.9；旧的在前，至多 24 份；规则关闭时为空）
    pub economy: Vec<EconomyReportView>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub routes: Vec<RouteLineView>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub agency_books: Vec<AgencyLedgerView>,
}

/// 经济月报里一类部门：月初 + 流入 − 流出 = 月末。
#[derive(Clone, Debug, Serialize)]
pub struct SectorLineView {
    /// traders / towns / treasuries / bank / hinterland
    pub kind: &'static str,
    pub opening: Money,
    pub inflow: Money,
    pub outflow: Money,
    pub closing: Money,
}

/// 经济月报里一类资金流。
#[derive(Clone, Debug, Serialize)]
pub struct FlowLineView {
    /// 名目（`Flow` 的变体名，界面按 `flow.<名目>` 显示）
    pub flow: String,
    pub from: &'static str,
    pub to: &'static str,
    pub amount: Money,
}

/// 经济月报里一个势力的国库。
#[derive(Clone, Debug, Serialize)]
pub struct TreasuryLineView {
    pub faction: String,
    pub money: Money,
    pub tax_mult_bp: i64,
    pub patrol_bp: i64,
    pub income: Money,
    pub spent: Money,
}

/// 经济月报（参考 EVE Online 的月度经济报告）：各部门的余额与流入流出、货币总量、物价指数、产量与人口。
#[derive(Clone, Debug, Serialize)]
pub struct EconomyReportView {
    pub month: u32,
    pub day: u32,
    pub sectors: Vec<SectorLineView>,
    pub flows: Vec<FlowLineView>,
    pub money_supply: Money,
    pub player: Money,
    pub companies: Money,
    pub exchange: Money,
    pub price_index_bp: i64,
    pub production: i64,
    pub population: i64,
    pub shortfall: Money,
    /// 流动性系数最低与最高的城镇（名称, 万分之一）
    pub tightest: Option<(String, i64)>,
    pub flush: Option<(String, i64)>,
    pub treasuries: Vec<TreasuryLineView>,
}

fn flow_key(f: manifest_core::treasury::Flow) -> String {
    serde_json::to_value(f).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default()
}

fn economy_views(defs: &StaticData, world: &World) -> Vec<EconomyReportView> {
    let place = |x: &Option<(LocId, Fx)>| {
        x.filter(|(l, _)| world.location_visible(*l)).map(|(l, v)| (defs.loc(l).name.clone(), v.raw()))
    };
    world
        .state
        .circulation
        .reports
        .iter()
        .map(|r| EconomyReportView {
            month: r.month,
            day: r.day,
            sectors: r
                .sectors
                .iter()
                .map(|s| SectorLineView {
                    kind: s.kind.key(),
                    opening: s.opening,
                    inflow: s.inflow,
                    outflow: s.outflow,
                    closing: s.closing,
                })
                .collect(),
            flows: r
                .flows
                .iter()
                .map(|l| FlowLineView { flow: flow_key(l.flow), from: l.from.key(), to: l.to.key(), amount: l.amount })
                .collect(),
            money_supply: r.money_supply,
            player: r.player,
            companies: r.companies,
            exchange: r.exchange,
            price_index_bp: r.price_index.raw(),
            production: r.production,
            population: r.population,
            shortfall: r.shortfall,
            tightest: place(&r.tightest),
            flush: place(&r.flush),
            treasuries: r
                .treasuries
                .iter()
                .map(|t| TreasuryLineView {
                    faction: defs.faction(t.faction).name.clone(),
                    money: t.money,
                    tax_mult_bp: t.tax_mult.raw(),
                    patrol_bp: t.patrol.raw(),
                    income: t.income,
                    spent: t.spent,
                })
                .collect(),
        })
        .collect()
}

pub fn reports_view(world: &World) -> ReportsView {
    reports_view_in(&world.defs, world)
}

/// 报表：玩家的三大报表与资产走势；经济月报里的名称按 `defs`（当前语言的显示用数据）。
pub fn reports_view_in(defs: &StaticData, world: &World) -> ReportsView {
    let economy = economy_views(defs, world);
    let routes = route_line_views(world);
    let agency_books = if world.defs.rules.trade_books.enabled {
        world.state.books.agency.keys().map(|loc| agency_ledger_view(world, *loc)).collect()
    } else {
        Vec::new()
    };
    let Some(a) = world.state.agents.get(&PLAYER) else {
        return ReportsView {
            monthly: Vec::new(),
            yearly: Vec::new(),
            current: manifest_core::ledger::Ledger::new().balance_sheet(),
            trend: Vec::new(),
            economy,
            routes,
            agency_books,
        };
    };
    let mut trend: Vec<TrendPoint> = a
        .ledger
        .monthly
        .iter()
        .map(|r| TrendPoint {
            day: r.end_day,
            total_assets: r.balance_sheet.total_assets,
            equity: r.balance_sheet.total_equity,
        })
        .collect();
    let current = a.ledger.balance_sheet();
    trend.push(TrendPoint { day: world.day(), total_assets: current.total_assets, equity: current.total_equity });
    ReportsView {
        monthly: a.ledger.monthly.clone(),
        yearly: a.ledger.yearly.clone(),
        current,
        trend,
        economy,
        routes,
        agency_books,
    }
}

// ───────────────────────────── 情报 ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct NewsView {
    pub id: u32,
    pub day: u32,
    /// tavern / merchant / official
    pub source: &'static str,
    pub credibility: u8,
    pub text: String,
}

/// 事件的一条效果（结构化字段，由前端格式化为“地点 · 商品 · 幅度 · 持续”）。
#[derive(Clone, Debug, Serialize)]
pub struct EffectView {
    /// 效果 key：good_supply / demand_shift / region_storm …
    pub effect: &'static str,
    /// 显示名（effects.toml 中的 name；不在词表中时为 key）
    pub label: String,
    /// 方向提示：产量上升、海盗猖獗……（按界面语言）
    pub hint: &'static str,
    /// 方向提示的键（见 data/texts.toml [hints]）
    pub hint_key: &'static str,
    pub loc: Option<String>,
    pub good: Option<String>,
    pub region: Option<String>,
    pub faction_a: Option<String>,
    pub faction_b: Option<String>,
    /// 殖民地产量效果的建筑名（全部建筑时为 null，见 `all_buildings`）
    pub building: Option<String>,
    /// 殖民地产量效果作用于全部建筑
    pub all_buildings: bool,
    /// 殖民地效果所在殖民地的名称（殖民地已不存在时为 null）
    pub colony: Option<String>,
    /// 发现物传闻的发现物名（传闻所指的大致海区在 `region`）
    pub discovery: Option<String>,
    /// 系数（万分之一，10000 表示不变）
    pub mult_bp: Option<i64>,
    /// 持续天数
    pub days: Option<u32>,
    /// 变化量（关系值 / 发展度）
    pub delta: Option<i64>,
    /// 持续效果的结束日（不含）；一次性效果为 null
    pub end: Option<u32>,
}

#[derive(Clone, Debug, Serialize)]
pub struct EventView {
    /// 目录事件为类型名，组合事件为标题
    pub name: String,
    /// 目录事件为类型说明，组合事件为叙事
    pub description: String,
    pub start: u32,
    pub end: u32,
    pub place: Vec<String>,
    /// catalog（目录事件）/ composed（组合事件）
    pub origin: &'static str,
    /// 组合事件的编号（目录事件为 null）
    pub id: Option<u32>,
    /// 组合事件的来源：ai（模型）/ template（离线模板）；目录事件为 null
    pub source: Option<&'static str>,
    /// 组合事件的标题与叙事（目录事件为 null）
    pub title: Option<String>,
    pub narrative: Option<String>,
    /// 逐条效果
    pub effects: Vec<EffectView>,
    /// 是否仍在进行
    pub active: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct LogView {
    pub day: u32,
    /// 字符串表中的键（LogKind 的变体名）
    pub kind: String,
    /// 参数（名称已解析）
    pub args: Vec<(String, String)>,
    /// 是否与玩家有关
    pub mine: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct ChronicleView {
    pub year: u32,
    pub text: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct IntelView {
    /// 市场月报（ECONOMY.md 8.5；新的在前，至多 12 篇）
    pub reports: Vec<ReportView>,
    pub news: Vec<NewsView>,
    /// 进行中的事件：目录事件逐条，组合事件每个一张卡片
    pub events: Vec<EventView>,
    pub log: Vec<LogView>,
    pub chronicles: Vec<ChronicleView>,
    /// 最近的组合事件（新的在前，含已结束的），格式同 `events`
    pub composed: Vec<EventView>,
}

fn source_key(s: manifest_core::news::NewsSource) -> &'static str {
    use manifest_core::news::NewsSource;
    match s {
        NewsSource::Tavern => "tavern",
        NewsSource::Merchant => "merchant",
        NewsSource::Official => "official",
    }
}

/// 把日志参数中的标识解析为名称（`defs` 为当前语言的显示用数据）。
fn resolve_arg(defs: &StaticData, field: &str, v: &serde_json::Value) -> String {
    let idx = || v.as_u64().map(|n| n as usize);
    let name = match field {
        // H07 航线纪录的出发港（RouteFirst / RouteRecord）
        "loc" | "origin" => idx().and_then(|i| defs.locations.get(i)).map(|l| l.name.clone()),
        "good" | "into" => idx().and_then(|i| defs.goods.get(i)).map(|g| g.name.clone()),
        "a" | "b" | "faction" => idx().and_then(|i| defs.factions.get(i)).map(|f| f.name.clone()),
        "exchange" => idx().and_then(|i| defs.exchanges.get(i)).map(|e| e.name.clone()),
        "event" => idx().and_then(|i| defs.events.get(i)).map(|e| e.name.clone()),
        "ship" => idx().and_then(|i| defs.ships.get(i)).map(|s| s.name.clone()),
        "building" => idx().and_then(|i| defs.colony_buildings.get(i)).map(|b| b.name.clone()),
        "discovery" => idx().and_then(|i| defs.discoveries.get(i)).map(|d| d.name.clone()),
        "mate" => idx().and_then(|i| defs.mates.get(i)).map(|m| m.name.clone()),
        "reason" => v.as_str().map(|s| s.to_lowercase()),
        "owner" => v.as_str().and_then(OwnerId::parse_key).map(|o| owner_label(defs, o)),
        "status" => v.as_str().map(|s| s.to_lowercase()),
        _ => None,
    };
    name.unwrap_or_else(|| match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    })
}

pub fn log_view(defs: &StaticData, e: &manifest_core::log::LogEvent) -> LogView {
    let value = serde_json::to_value(&e.kind).unwrap_or(serde_json::Value::Null);
    log_view_value(defs, e.day, value)
}

/// 日志：名称按当前语言；组合事件的标题换成当前语言（找得到记录时）。
pub fn log_view_in(ctx: Ctx<'_>, world: &World, e: &manifest_core::log::LogEvent) -> LogView {
    let mut v = log_view_value(ctx.names, e.day, serde_json::to_value(&e.kind).unwrap_or(serde_json::Value::Null));
    if let manifest_core::log::LogKind::LegendShipGranted { ship, .. } = &e.kind
        && let Some(s) = ctx.names.legend_ships.ship(ship)
    {
        for (field, value) in &mut v.args {
            if field == "ship" {
                *value = crate::legend_ships_view::legend_ship_name(world, s).into();
            }
        }
    }
    if let manifest_core::log::LogKind::ComposedEventStarted { composed, .. } = &e.kind
        && ctx.tr.is_some()
        && let Some(r) = world.composed_record(*composed)
    {
        let (title, _) = ctx.composed(world, r);
        for (f, val) in &mut v.args {
            if f == "title" {
                *val = title.clone();
            }
        }
    }
    // 剧情事件：来处换成标题与所选选项的文字（按当前语言）；当天没有回应、奇遇作罢的另用一个键
    if let manifest_core::log::LogKind::StoryResolved { source, choice, .. } = &e.kind {
        let (title, text) = crate::story_view::log_texts(ctx, world, source, *choice);
        v.args.retain(|(f, _)| f != "source" && f != "choice");
        v.args.push(("title".into(), title));
        v.args.push(("choice".into(), text));
        if choice.is_none() {
            v.kind = "StoryIgnored".into();
        }
    }
    for (field, text) in &mut v.args {
        *text = if matches!(&e.kind, manifest_core::log::LogKind::StoryResolved { .. })
            && matches!(field.as_str(), "title" | "choice")
        {
            crate::navigation_view::visibility::redact_narrative_text(ctx, world, text)
        } else {
            crate::navigation_view::visibility::redact_text(ctx, world, text)
        };
    }
    if let Some(template) = ctx.texts.and_then(|texts| texts.get(&format!("logs.{}", v.kind))) {
        let vars = v.args.iter().map(|(key, value)| (key.as_str(), value.clone())).collect();
        v.text = Some(manifest_data::locale::fill(template, &vars));
    }
    v
}

fn log_view_value(defs: &StaticData, day: u32, value: serde_json::Value) -> LogView {
    let (kind, args) = match value {
        serde_json::Value::Object(map) => match map.into_iter().next() {
            Some((k, serde_json::Value::Object(fields))) => {
                let args: Vec<(String, String)> =
                    fields.iter().map(|(f, v)| (f.clone(), resolve_arg(defs, f, v))).collect();
                (k, args)
            }
            Some((k, _)) => (k, Vec::new()),
            None => (String::new(), Vec::new()),
        },
        serde_json::Value::String(s) => (s, Vec::new()),
        _ => (String::new(), Vec::new()),
    };
    let mine = args.iter().any(|(f, v)| f == "owner" && v == "player");
    LogView { day, kind, args, mine, text: None }
}

/// 一条效果的视图。
fn effect_view(
    ctx: Ctx<'_>,
    world: &World,
    effect: manifest_core::defs::EffectKind,
    p: &manifest_core::events::EventParams,
    start: u32,
) -> EffectView {
    let defs = ctx.names;
    // 发现物传闻的海区：取玩家记下的传闻（与内核计算一致）
    let region = p.region.or_else(|| {
        p.discovery.and_then(|d| {
            world
                .state
                .explore
                .rumors
                .get(&d)
                .map(|r| r.region)
                .or_else(|| manifest_core::explore::discovery_region(defs, d))
        })
    });
    EffectView {
        effect: effect.key(),
        label: defs.composed.bounds(effect).map(|b| b.name.clone()).unwrap_or_else(|| effect.key().to_string()),
        hint: ctx.hint(manifest_core::summary::effect_hint_key_for(effect, p)),
        hint_key: manifest_core::summary::effect_hint_key_for(effect, p),
        loc: p.loc.map(|l| crate::navigation_view::visibility::place(ctx, world, l)),
        good: p.good.and_then(|g| defs.goods.get(g.idx())).map(|g| g.name.clone()),
        region: region.and_then(|r| defs.regions.get(r.idx())).map(|r| r.name.clone()),
        faction_a: p.faction_a.and_then(|f| defs.factions.get(f.idx())).map(|f| f.name.clone()),
        faction_b: p.faction_b.and_then(|f| defs.factions.get(f.idx())).map(|f| f.name.clone()),
        building: p.building.and_then(|b| defs.colony_buildings.get(b.idx())).map(|b| b.name.clone()),
        all_buildings: effect.allows_building() && p.building.is_none(),
        colony: if effect.targets_colony() {
            p.loc.filter(|l| world.location_visible(*l)).and_then(|l| world.colony_at(l)).map(|c| c.name.clone())
        } else {
            None
        },
        discovery: p
            .discovery
            .filter(|d| !world.hides_unknown_locations() || world.state.explore.discovered.contains_key(d))
            .and_then(|d| defs.discoveries.get(d.idx()))
            .map(|d| d.name.clone()),
        mult_bp: p.mult.map(|m| m.raw()),
        days: p.days,
        delta: p.delta,
        end: (!effect.is_instant()).then(|| start + p.days.unwrap_or(1)),
    }
}

/// 效果涉及的对象名称（去重）。
fn effect_places(effects: &[EffectView]) -> Vec<String> {
    let mut place: Vec<String> = Vec::new();
    for e in effects {
        for n in [&e.colony, &e.loc, &e.good, &e.discovery, &e.region, &e.faction_a, &e.faction_b].into_iter().flatten()
        {
            if !place.contains(n) {
                place.push(n.clone());
            }
        }
    }
    place
}

/// 组合事件卡片。
fn composed_view(ctx: Ctx<'_>, world: &World, r: &manifest_core::composed::ComposedRecord, day: u32) -> EventView {
    let effects: Vec<EffectView> =
        r.effects.iter().map(|e| effect_view(ctx, world, e.effect, &e.params, r.day)).collect();
    let end = r.end();
    let (title, narrative) = ctx.composed(world, r);
    EventView {
        name: title.clone(),
        description: narrative.clone(),
        start: r.day,
        end,
        place: effect_places(&effects),
        origin: "composed",
        id: Some(r.id),
        source: Some(match r.source {
            manifest_core::composed::ComposedSource::Model => "ai",
            manifest_core::composed::ComposedSource::Template => "template",
            manifest_core::composed::ComposedSource::Rule => "rule",
        }),
        title: Some(title),
        narrative: Some(narrative),
        effects,
        active: end > day,
    }
}

pub fn intel_view(world: &World) -> IntelView {
    intel_view_in(Ctx::plain(&world.defs), world)
}

/// 情报：新闻、事件卡片、日志与编年史按当前语言。
pub fn intel_view_in(ctx: Ctx<'_>, world: &World) -> IntelView {
    let defs = ctx.names;
    let day = world.day();
    // 进行中的目录事件逐条列出；组合事件合并为一张卡片
    let mut events: Vec<EventView> = Vec::new();
    let mut shown: Vec<u32> = Vec::new();
    for e in &world.state.events.active {
        if let Some(id) = e.origin.composed_id() {
            if !shown.contains(&id)
                && let Some(r) = world.composed_record(id)
            {
                shown.push(id);
                events.push(composed_view(ctx, world, r, day));
            }
            continue;
        }
        let Some(def) = defs.events.get(e.kind.idx()) else { continue };
        let effects: Vec<EffectView> =
            e.effect.map(|k| effect_view(ctx, world, k, &e.params, e.start)).into_iter().collect();
        events.push(EventView {
            name: def.name.clone(),
            description: def.description.clone(),
            start: e.start,
            end: e.end,
            place: effect_places(&effects),
            origin: "catalog",
            id: None,
            source: None,
            title: None,
            narrative: None,
            effects,
            active: true,
        });
    }
    let composed: Vec<EventView> =
        world.state.events.composed.iter().rev().take(20).map(|r| composed_view(ctx, world, r, day)).collect();
    let mut news: Vec<NewsView> = world
        .state
        .news
        .news
        .iter()
        .map(|n| NewsView {
            id: n.id,
            day: n.day,
            source: source_key(n.source),
            credibility: n.credibility,
            text: ctx.text(world, &n.text, n.tpl.as_ref()),
        })
        .collect();
    news.sort_by_key(|n| std::cmp::Reverse((n.day, n.id)));
    news.truncate(60);
    IntelView {
        composed,
        news,
        events,
        log: world.state.log.iter().rev().take(150).map(|e| log_view_in(ctx, world, e)).collect(),
        chronicles: world
            .state
            .news
            .chronicles
            .iter()
            .map(|c| ChronicleView { year: c.year, text: ctx.text(world, &c.text, c.tpl.as_ref()) })
            .collect(),
        reports: world
            .state
            .news
            .reports
            .iter()
            .rev()
            .take(12)
            .map(|r| ReportView {
                day: r.day,
                region: r.region.0,
                month: r.month,
                text: ctx.text(world, &r.text, r.tpl.as_ref()),
            })
            .collect(),
    }
}

/// 一篇市场月报。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ReportView {
    pub day: u32,
    pub region: u16,
    /// 所写的月份（月序，从 0 开始）
    pub month: u32,
    pub text: String,
}

// ───────────────────────────── 殖民地、殖民点与发现 ─────────────────────────────

/// 进行中的工程。
#[derive(Clone, Debug, Serialize)]
pub struct ConstructionView {
    pub building: u16,
    /// 完工后的等级
    pub level: u8,
    pub start_day: u32,
    pub done_day: u32,
}

/// 一座建筑每天的预计产出。
#[derive(Clone, Debug, Serialize)]
pub struct EstimateView {
    pub building: u16,
    /// 投入（商品 id, 每天件数）
    pub inputs: Vec<(u16, i64)>,
    /// 产出（商品 id, 每天件数 × 10000）
    pub outputs: Vec<(u16, i64)>,
}

/// 可建设（开工或升级）的建筑。
#[derive(Clone, Debug, Serialize)]
pub struct BuildOptionView {
    pub building: u16,
    /// 当前等级（0 表示尚未建造）
    pub level: u8,
    pub cost: Money,
    /// 每级建材（商品 id, 数量）与仓库中尚缺的数量
    pub materials: Vec<(u16, i64)>,
    pub missing: Vec<(u16, i64)>,
    pub build_days: u32,
    /// 能否立即开工；否则 reason 为内核给出的原因
    pub ok: bool,
    pub reason: Option<String>,
    /// 粮食 / 采集类：在此地产出的商品与系数（%）
    pub produces: Option<(u16, i64)>,
}

/// 殖民地上月的统计。
#[derive(Clone, Debug, Serialize)]
pub struct ColonyStatsView {
    pub produced: Vec<(u16, i64)>,
    pub food_eaten: i64,
    pub births: i64,
    pub immigrants: i64,
    pub deaths: i64,
    pub tax: Money,
    pub upkeep: Money,
    /// 消费品满足度（万分之一）
    pub satisfaction_bp: i64,
    /// 累计遭袭次数
    pub raids: u32,
}

/// 殖民地详情。
#[derive(Clone, Debug, Serialize)]
pub struct ColonyView {
    pub id: u32,
    pub name: String,
    pub loc: u16,
    pub founded: u32,
    pub population: i64,
    /// 人口上限
    pub housing: i64,
    pub morale: i64,
    pub starving_days: u32,
    /// 仓库中的粮食、每天需求与可支撑天数（不计产出）
    pub food_stock: i64,
    pub food_need: i64,
    pub food_days: i64,
    /// 殖民地仓库（即所有者在该地的仓库）
    pub stock: Vec<CargoLine>,
    pub capacity: i64,
    pub used: i64,
    /// （建筑 id, 等级）
    pub buildings: Vec<(u16, u8)>,
    pub construction: Option<ConstructionView>,
    pub workers_needed: i64,
    /// 工人充足率与士气系数（万分之一）
    pub staffing_bp: i64,
    pub morale_mult_bp: i64,
    pub estimates: Vec<EstimateView>,
    /// 税率档位（rules 中 colony_tax_levels 的下标）与按当前人口估算的月税收
    pub tax: u8,
    pub tax_estimate: Money,
    /// 每月维护费
    pub upkeep: Money,
    /// 防御值（%）与每日遭袭概率（万分之一）
    pub defense: i64,
    pub raid_bp: i64,
    pub last_raid: Option<u32>,
    pub dock: bool,
    pub book_value: Money,
    pub last_month: ColonyStatsView,
    pub build_options: Vec<BuildOptionView>,
    /// 停在此地的玩家舰队（可装卸）
    pub fleets_here: Vec<u32>,
    /// 正在作用于该殖民地的组合事件效果（产量、增长系数，含结束日）；预计产量已计入
    pub effects: Vec<EffectView>,
    /// 事件造成的人口增长与移民系数（万分之一，10000 表示不变）
    pub growth_mult_bp: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct ColoniesView {
    pub colonies: Vec<ColonyView>,
    /// 还能再建立几个殖民地
    pub slots_left: usize,
}

fn cmd_reason(ctx: Ctx<'_>, world: &World, cmd: manifest_core::Command) -> Option<String> {
    cmd.validate(world).err().map(|e| ctx.error(&e))
}

pub fn colony_view(world: &World, c: &manifest_core::colony::Colony) -> ColonyView {
    colony_view_in(Ctx::plain(&world.defs), world, c)
}

/// 殖民地详情：不能建设的原因与事件效果按当前语言。
pub fn colony_view_in(ctx: Ctx<'_>, world: &World, c: &manifest_core::colony::Colony) -> ColonyView {
    let defs = ctx.names;
    let holder = manifest_core::warehouse::Holder::Warehouse(c.loc);
    let wh = world.warehouse(PLAYER, c.loc);
    let site = defs.loc(c.loc).site.as_ref();
    let food_need = manifest_core::colony::food_need(defs, c.population);
    let tax_pct = defs.rules.colony.tax_levels.get(c.tax as usize).map(|t| t.0).unwrap_or(0);
    let build_options = defs
        .colony_building_ids()
        .filter(|b| c.level(*b) < defs.colony_building(*b).max_level)
        .map(|b| {
            let d = defs.colony_building(b);
            let missing: Vec<(u16, i64)> = d
                .materials
                .iter()
                .filter_map(|(g, q)| {
                    let have = world.holder_qty(c.owner, holder, *g);
                    (have < *q).then_some((g.0, q - have))
                })
                .collect();
            let reason = cmd_reason(
                ctx,
                world,
                manifest_core::Command::BuildColony { owner: c.owner, colony: c.id, building: b },
            );
            BuildOptionView {
                building: b.0,
                level: c.level(b),
                cost: d.cost,
                materials: d.materials.iter().map(|(g, q)| (g.0, *q)).collect(),
                missing,
                build_days: d.build_days,
                ok: reason.is_none(),
                reason,
                produces: site.and_then(|s| manifest_core::colony::raw_output(d, s)).map(|(g, p)| (g.0, p)),
            }
        })
        .collect();
    let s = &c.stats;
    ColonyView {
        id: c.id.0,
        name: c.name.clone(),
        loc: c.loc.0,
        founded: c.founded,
        population: c.population,
        housing: world.colony_housing(c),
        morale: c.morale,
        starving_days: c.starving_days,
        food_stock: world.colony_food_stock(c),
        food_need,
        food_days: food_days(world, c),
        stock: wh.map(|w| cargo_lines(world, c.owner, &w.stock)).unwrap_or_default(),
        capacity: world.warehouse_capacity(c.owner, c.loc),
        used: wh.map(|w| w.used()).unwrap_or(0),
        buildings: c.buildings.iter().map(|(b, l)| (b.0, *l)).collect(),
        construction: c.construction.as_ref().map(|k| ConstructionView {
            building: k.building.0,
            level: k.level,
            start_day: k.start_day,
            done_day: k.done_day,
        }),
        workers_needed: world.colony_workers_needed(c),
        staffing_bp: world.colony_staffing(c).raw(),
        morale_mult_bp: World::colony_morale_mult(c).raw(),
        estimates: world
            .colony_estimates(c)
            .into_iter()
            .map(|e| EstimateView {
                building: e.building.0,
                inputs: e.inputs.iter().map(|(g, q)| (g.0, *q)).collect(),
                outputs: e.outputs.iter().map(|(g, q)| (g.0, q.raw())).collect(),
            })
            .collect(),
        tax: c.tax,
        tax_estimate: mul_div(c.population * defs.rules.colony.tax_per_100, tax_pct, 10_000),
        upkeep: c
            .buildings
            .iter()
            .filter_map(|(b, l)| defs.colony_buildings.get(b.idx()).map(|d| d.upkeep * *l as i64))
            .sum(),
        defense: world.colony_defense(c),
        raid_bp: world.colony_raid_bp(c),
        last_raid: c.last_raid,
        dock: world.colony_has_dock(c.owner, c.loc),
        book_value: c.book_value,
        last_month: ColonyStatsView {
            produced: s.last_produced.iter().map(|(g, q)| (g.0, *q)).collect(),
            food_eaten: s.last_food_eaten,
            births: s.last_births,
            immigrants: s.last_immigrants,
            deaths: s.last_deaths,
            tax: s.last_tax,
            upkeep: s.last_upkeep,
            satisfaction_bp: s.last_satisfaction,
            raids: s.raids,
        },
        build_options,
        fleets_here: world.fleets_of(PLAYER).filter(|f| f.docked_at() == Some(c.loc)).map(|f| f.id.0).collect(),
        effects: world
            .state
            .events
            .active
            .iter()
            .filter(|e| e.params.loc == Some(c.loc) && e.start >= c.founded)
            .filter_map(|e| {
                e.effect.filter(|k| k.targets_colony()).map(|k| effect_view(ctx, world, k, &e.params, e.start))
            })
            .collect(),
        growth_mult_bp: world.colony_growth_mult(c).raw(),
    }
}

pub fn colonies_view(world: &World) -> ColoniesView {
    colonies_view_in(Ctx::plain(&world.defs), world)
}

pub fn colonies_view_in(ctx: Ctx<'_>, world: &World) -> ColoniesView {
    let colonies: Vec<ColonyView> = world.colonies_of(PLAYER).map(|c| colony_view_in(ctx, world, c)).collect();
    let max = world.defs.rules.colony.max_colonies_per_owner;
    ColoniesView { slots_left: max.saturating_sub(colonies.len()), colonies }
}

/// 殖民点详情：自然条件、归属、能否建立殖民地与所需物资。
#[derive(Clone, Debug, Serialize)]
pub struct SiteView {
    pub loc: u16,
    pub info: SiteInfoView,
    pub lore: String,
    /// 是否到过
    pub known: bool,
    pub claim: Option<SiteClaimView>,
    /// 不看舰队时能否建立；否则 reason 为原因
    pub can_found: bool,
    pub reason: Option<String>,
    pub found_cost: Money,
    /// 须从舰队卸下的物资（商品 id, 数量）
    pub found_materials: Vec<(u16, i64)>,
    pub min_settlers: i64,
    /// 停在此地的玩家舰队；各舰队按最少殖民者建立时的校验结果（None 表示可以建立）
    pub fleets_here: Vec<(u32, Option<String>)>,
    /// 各粮食 / 采集类建筑在此地的产出：（建筑 id, 商品 id, 系数 %）
    pub producible: Vec<(u16, u16, i64)>,
    /// 此地已有的玩家殖民地
    pub colony: Option<u32>,
}

pub fn site_view(world: &World, loc: LocId) -> Option<SiteView> {
    site_view_in(Ctx::plain(&world.defs), world, loc)
}

/// 殖民点详情：简史与不能建立的原因按当前语言。
pub fn site_view_in(ctx: Ctx<'_>, world: &World, loc: LocId) -> Option<SiteView> {
    if !world.location_visible(loc) {
        return None;
    }
    let defs = ctx.names;
    let l = defs.locations.get(loc.idx())?;
    let s = l.site.as_ref()?;
    let blocker = manifest_core::colony::site_block(world, PLAYER, loc).map(|r| ctx.reason(&r));
    let rules = &defs.rules.colony;
    Some(SiteView {
        loc: loc.0,
        info: site_info(s),
        lore: l.lore.clone(),
        known: world.loc_known(loc),
        claim: site_claims(world).into_iter().find(|c| c.loc == loc.0),
        can_found: blocker.is_none(),
        reason: blocker,
        found_cost: rules.found_cost,
        found_materials: rules.found_materials.iter().map(|(g, q)| (g.0, *q)).collect(),
        min_settlers: rules.min_settlers,
        fleets_here: world
            .fleets_of(PLAYER)
            .filter(|f| f.docked_at() == Some(loc))
            .map(|f| {
                let cmd = manifest_core::Command::FoundColony {
                    owner: PLAYER,
                    fleet: f.id,
                    site: loc,
                    name: "新殖民地".into(),
                    settlers: rules.min_settlers,
                };
                (f.id.0, cmd_reason(ctx, world, cmd))
            })
            .collect(),
        producible: defs
            .colony_building_ids()
            .filter_map(|b| manifest_core::colony::raw_output(defs.colony_building(b), s).map(|(g, p)| (b.0, g.0, p)))
            .collect(),
        colony: world.colony_at(loc).filter(|c| c.owner == PLAYER).map(|c| c.id.0),
    })
}

/// 一件已发现的发现物。
#[derive(Clone, Debug, Serialize)]
pub struct FoundView {
    pub id: u16,
    /// 发现日期
    pub day: u32,
    pub reported: bool,
    pub x: u16,
    pub y: u16,
}

/// 一条发现物传闻：只给出大致海区，不给位置。
#[derive(Clone, Debug, Serialize)]
pub struct RumorView {
    /// 发现物编号
    pub id: u16,
    /// 听到传闻的日期
    pub day: u32,
    /// 传闻所指的海区编号与名称
    pub region: u16,
    pub region_name: String,
    /// 海区的英文名
    pub region_name_en: String,
    /// 是否已经找到
    pub found: bool,
}

/// 探险记录：已发现、已报告与名声。
#[derive(Clone, Debug, Serialize)]
pub struct DiscoveriesView {
    pub fame: i64,
    pub found: Vec<FoundView>,
    /// 听到的发现物传闻（组合事件“发现物传闻”），按发现物编号排列
    pub rumors: Vec<RumorView>,
    /// 发现物总数（其余尚未发现）
    pub total: usize,
    /// 招募各等级航海士所需的名声：（等级, 名声），只列出需要名声的等级
    pub mate_fame: Vec<(i64, i64)>,
    /// 停靠的港口中可以报告的地点
    pub report_at: Vec<u16>,
    /// 玩家各船队的潜水入口；前端按当前船队筛选，空清单省略。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub dives: Vec<crate::navigation_view::diving::DiveView>,
}

pub fn discoveries_view(world: &World) -> DiscoveriesView {
    discoveries_view_in(Ctx::plain(&world.defs), world)
}

/// 探险记录：传闻所指的海区名按当前语言，另给英文名。
pub fn discoveries_view_in(ctx: Ctx<'_>, world: &World) -> DiscoveriesView {
    let defs = ctx.names;
    let en = ctx.en_defs();
    let e = &world.state.explore;
    let d = &defs.rules.discovery;
    DiscoveriesView {
        fame: world.state.agents.get(&PLAYER).map(|a| a.fame).unwrap_or(0),
        found: e
            .discovered
            .iter()
            .filter_map(|(id, day)| {
                let def = defs.discoveries.get(id.idx())?;
                Some(FoundView { id: id.0, day: *day, reported: e.reported.contains(id), x: def.cell.x, y: def.cell.y })
            })
            .collect(),
        rumors: e
            .rumors
            .iter()
            .map(|(id, r)| RumorView {
                id: id.0,
                day: r.day,
                region: r.region.0,
                region_name: defs.regions.get(r.region.idx()).map(|x| x.name.clone()).unwrap_or_default(),
                region_name_en: en.regions.get(r.region.idx()).map(|x| x.name.clone()).unwrap_or_default(),
                found: e.discovered.contains_key(id),
            })
            .collect(),
        total: defs.discoveries.len(),
        mate_fame: (1..=defs.rules.mates.max_level)
            .map(|lvl| (lvl, d.mate_fame(lvl)))
            .filter(|(_, f)| *f > 0)
            .collect(),
        report_at: world
            .fleets_of(PLAYER)
            .filter_map(|f| f.docked_at())
            .chain(world.caravans_of(PLAYER).filter_map(|c| c.at()))
            .filter(|l| defs.loc(*l).is_port())
            .map(|l| l.0)
            .collect::<std::collections::BTreeSet<u16>>()
            .into_iter()
            .collect(),
        dives: crate::navigation_view::diving::options(ctx, world),
    }
}

/// E02 投资页的发展度契约；只下发数值与阶段序号。
#[derive(Clone, Debug, Serialize)]
pub struct DevGrowthView {
    pub value: i64,
    pub base: i64,
    pub max: i64,
    pub stage: u8,
    pub stage_from: i64,
    pub stage_to: Option<i64>,
    pub frac_bp: i64,
    pub speed_bp: i64,
    pub decay_bp: i64,
    pub point_cost: Money,
    pub depth_bp: i64,
    pub last: Option<DevMonthView>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unlocks: Vec<StageUnlockView>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DevMonthView {
    pub day: u32,
    pub rel_bp: i64,
    pub busy: i64,
    pub specialty: i64,
    pub invest: i64,
    pub works: i64,
    pub events: i64,
    pub decay: i64,
    pub net: i64,
}

fn development_view(world: &World, loc: LocId) -> Option<DevGrowthView> {
    let r = &world.defs.rules.development;
    if !r.enabled {
        return None;
    }
    let ls = world.state.locations.get(loc.idx())?;
    let base = world.defs.loc(loc).development;
    let (stage, stage_from, stage_to) = r.stage(ls.development);
    Some(DevGrowthView {
        value: ls.development,
        base,
        max: r.max,
        stage,
        stage_from,
        stage_to,
        frac_bp: ls.growth.frac,
        speed_bp: r.speed_bp(base),
        decay_bp: r.decay_bp,
        point_cost: r.point_cost(ls.development),
        depth_bp: r.depth_bp(ls.development),
        last: ls.growth.last.as_ref().map(|m| DevMonthView {
            day: m.day,
            rel_bp: m.rel_bp,
            busy: m.busy,
            specialty: m.specialty,
            invest: m.invest,
            works: m.works,
            events: m.events,
            decay: m.decay,
            net: m.net,
        }),
        unlocks: stage_unlock_views(world, loc),
    })
}

/// 每港永久代办小账；金额已经按买入含税、卖出扣税处理。
#[derive(Clone, Debug, Serialize)]
pub struct AgencyLedgerView {
    pub loc: u16,
    pub buy_qty: i64,
    pub buy_total: Money,
    pub sell_qty: i64,
    pub sell_total: Money,
    pub sell_cost: Money,
    pub fees: Money,
    pub profit: Money,
}

fn agency_ledger_view(world: &World, loc: LocId) -> AgencyLedgerView {
    let ledger = if world.defs.rules.trade_books.enabled {
        world.state.books.agency.get(&loc).cloned().unwrap_or_default()
    } else {
        Default::default()
    };
    AgencyLedgerView {
        loc: loc.0,
        buy_qty: ledger.buy_qty,
        buy_total: ledger.buy_total,
        sell_qty: ledger.sell_qty,
        sell_total: ledger.sell_total,
        sell_cost: ledger.sell_cost,
        fees: ledger.fees,
        profit: ledger.profit(),
    }
}

/// 有向航线的估算账；只在玩家打开报表时组装。
#[derive(Clone, Debug, Serialize)]
pub struct RouteLineView {
    pub from: u16,
    pub to: u16,
    pub trips: u32,
    pub days: u32,
    pub sold_total: Money,
    pub sold_cost: Money,
    pub sea_cost: Money,
    pub bought_total: Money,
    pub profit: Money,
    pub per_day: Money,
    pub last_day: u32,
}

fn route_line_views(world: &World) -> Vec<RouteLineView> {
    if !world.defs.rules.trade_books.enabled {
        return Vec::new();
    }
    let mut lines: Vec<_> = world.state.books.routes.iter().collect();
    lines.sort_by_key(|l| (std::cmp::Reverse(l.last_day), l.from, l.to));
    lines
        .into_iter()
        .map(|l| {
            let profit = l.sold_total - l.sold_cost - l.sea_cost;
            RouteLineView {
                from: l.from.0,
                to: l.to.0,
                trips: l.trips,
                days: l.days,
                sold_total: l.sold_total,
                sold_cost: l.sold_cost,
                sea_cost: l.sea_cost,
                bought_total: l.bought_total,
                profit,
                per_day: profit / i64::from(l.days.max(1)),
                last_day: l.last_day,
            }
        })
        .collect()
}

/// 阶段内容只给种类、键和数量，文字由前端处理。
#[derive(Clone, Debug, Serialize)]
pub struct StageUnlockView {
    pub stage: u8,
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub good: Option<u16>,
    pub n: i64,
    pub reached: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct RareRowView {
    pub producer: Option<u16>,
    pub cells: i64,
    pub peak: Money,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sat_bp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub left: Option<i64>,
}

fn rare_row_view(world: &World, loc: LocId, good: GoodId, live: bool) -> Option<RareRowView> {
    if !manifest_core::stages::is_rare(&world.defs, good) || !world.good_revealed(good) {
        return None;
    }
    let source = manifest_core::stages::rare_source(&world.defs, good)?;
    Some(RareRowView {
        producer: world.location_visible(source).then_some(source.0),
        cells: world.rare_cells(loc, good),
        peak: world.rare_peak(loc, good),
        sat_bp: live.then(|| world.rare_sat_bp(loc, good)),
        left: (source == loc).then(|| world.rare_left(loc, good)),
    })
}

fn stage_unlock_views(world: &World, loc: LocId) -> Vec<StageUnlockView> {
    let defs = &world.defs;
    let r = &defs.rules.stage_unlocks;
    let l = defs.loc(loc);
    if !r.enabled || !l.is_port() {
        return Vec::new();
    }
    let current = world.port_stage(loc);
    let row = |stage, kind, n, reached| StageUnlockView { stage, kind, key: None, good: None, n, reached };
    let mut out = Vec::new();
    if !l.shop {
        out.push(row(r.shop_stage, "shop", 1, current >= r.shop_stage));
    }
    let base_stage = defs.rules.development.stage(l.development).0;
    let mut previous_size = i64::from(l.size);
    for stage in base_stage + 1..=6 {
        let size =
            i64::from(l.size).saturating_add(i64::from(stage - base_stage).saturating_mul(r.shelf_step)).clamp(1, 5);
        if size > previous_size {
            out.push(row(stage, "shelf", size - previous_size, current >= stage));
        }
        previous_size = size;
    }
    if r.book_slots > 0 {
        let stage = if world.authored_facility(loc, "bookshop") { 0 } else { r.book_stage };
        out.push(row(stage, "books", r.book_slots as i64, current >= stage));
    }
    let house = world.house_level(PLAYER, loc) > 0;
    for (kind, bonuses) in [("agency", &r.agency_bonus), ("industry", &r.industry_bonus)] {
        let mut previous = 0;
        for (stage, n) in bonuses.iter().enumerate() {
            if *n > previous {
                out.push(row(stage as u8, kind, n - previous, current >= stage as u8 && house));
            }
            previous = *n;
        }
    }
    let upcoming = manifest_core::house::shipyard_upcoming(defs, loc);
    for threshold in &defs.rules.shipyard_growth.steps {
        let n = upcoming.iter().filter(|(_, d)| d == threshold).count() as i64;
        if n > 0 {
            out.push(row(
                defs.rules.development.stage(*threshold).0,
                "yard",
                n,
                world.state.locations[loc.idx()].development >= *threshold,
            ));
        }
    }
    for u in &l.unlocks {
        if !defs.good(u.good).secret
            && let Some(stage) = u.stage
        {
            let mut view = row(stage, "goods", 1, world.market_open(loc, u.good));
            view.good = Some(u.good.0);
            out.push(view);
        }
    }
    for (key, stage) in &r.eligible {
        let key = match key.as_str() {
            "academy" => "academy",
            "auction" => "auction",
            "exchange" => "exchange",
            _ => continue,
        };
        let mut view = row(*stage, "eligible", 1, current >= *stage || world.authored_facility(loc, key));
        view.key = Some(key);
        out.push(view);
    }
    out.sort_by_key(|v| v.stage);
    out
}

/// 每艘船当前的改装可用性；拒绝原因与执行命令共用校验及文字通路。
#[derive(Clone, Debug, Serialize)]
pub struct RefitOptionView {
    pub id: u16,
    pub enabled: bool,
    pub reason: Option<String>,
}

/// 家里作保的首贷；rate_pct 是普通贷款年息的比例。
#[derive(Clone, Debug, Serialize)]
pub struct BankGuaranteeView {
    pub available: bool,
    pub amount: Money,
    pub rate_pct: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<&'static str>,
}

fn bank_guarantee_view(world: &World, owner: OwnerId) -> Option<BankGuaranteeView> {
    if !world.state.story2.flags.contains("family_guarantee") {
        return None;
    }
    let rules = &world.act_rules()?.guarantee;
    let reason = if owner != PLAYER {
        Some(CommandError::NotOwner.code())
    } else if world.state.story2.flags.contains("family_guarantee_used") {
        Some("precondition")
    } else if !world.state.fleets.values().any(|f| {
        f.owner == owner
            && matches!(f.location, FleetLocation::Docked(at) if world.state.agents.get(&owner).is_some_and(|a| a.home == at))
    }) {
        Some(CommandError::WrongLocation.code())
    } else {
        None
    };
    Some(BankGuaranteeView { available: reason.is_none(), amount: rules.amount, rate_pct: rules.rate_pct, reason })
}

#[cfg(test)]
mod guarantee_tests {
    use super::*;
    use std::sync::Arc;

    #[test]
    fn bank_guarantee_truth_table() {
        let mut defs = (*manifest_core::testkit::tiny_defs()).clone();
        defs.rules.upbringing.act = Some(Default::default());
        let base = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
        println!("player,flag,used,home,shown,available,reason");
        for player in [false, true] {
            for flag in [false, true] {
                for used in [false, true] {
                    for home in [false, true] {
                        let mut world = base.clone();
                        if flag {
                            world.state.story2.flags.insert("family_guarantee".into());
                        }
                        if used {
                            world.state.story2.flags.insert("family_guarantee_used".into());
                        }
                        let at = world.state.agents[&PLAYER].home;
                        for fleet in world.state.fleets.values_mut().filter(|f| f.owner == PLAYER) {
                            fleet.location = FleetLocation::Docked(if home { at } else { LocId(1) });
                        }
                        let owner = if player { PLAYER } else { OwnerId::Company(CompanyId(0)) };
                        let view = bank_guarantee_view(&world, owner);
                        let expected = match (player, used, home) {
                            (false, _, _) => Some("not_owner"),
                            (true, true, _) => Some("precondition"),
                            (true, false, false) => Some("wrong_location"),
                            (true, false, true) => None,
                        };
                        println!(
                            "{player},{flag},{used},{home},{},{:?},{:?}",
                            view.is_some(),
                            view.as_ref().map(|v| v.available),
                            view.as_ref().and_then(|v| v.reason)
                        );
                        assert_eq!(view.is_some(), flag);
                        if let Some(view) = view {
                            assert_eq!(view.available, player && !used && home);
                            assert_eq!(view.reason, expected);
                            assert_eq!((view.amount, view.rate_pct), (1500, 50));
                        }
                        if player {
                            let json = serde_json::to_value(bank_view(&world)).unwrap();
                            assert_eq!(json.get("guarantee").is_some(), flag);
                            if flag {
                                assert_eq!(json["guarantee"]["available"], !used && home);
                                assert_eq!(json["guarantee"].get("reason").is_some(), used || !home);
                            }
                        }
                    }
                }
            }
        }
    }
}
