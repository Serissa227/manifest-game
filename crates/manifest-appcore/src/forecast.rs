//! 行情预测簿（`docs/ECONOMY.md` 第 4 节）。
//!
//! 预测的数学全部在前端完成（浮点只在显示层）。这里只做三件事：
//! - 保存玩家“记下”的预测：方法与参数、拟合用的日线、预测路径与 80% / 95% 区间（整数金币）、修订关系与调整依据；
//! - 每日结算之后，给还没到期的预测抄录当天的实际收盘价与市场驱动（内核的 [`MarketFlow`]），
//!   以及预测期内发生的相关事件（事件开始、流行开始与结束）；
//! - 随存档写入附属文件 `<槽位>.book.json`，读档恢复。
//!
//! 信息时效（`docs/ECONOMY.md` 第 7 节，随船传递时）：远方港口的行情以手上快照的日期为起点，
//! 期限可以多出过时的天数（最多到今天之后 60 天）；抄录照常按实际进行，但视图只给玩家已经知道的日子
//! （到期而消息还没传回来的预测等消息）。记下时已经过去的日子只补收盘价（`filled`）。
//!
//! 预测簿是应用层数据，与主角、时刻一样不进世界状态，不影响世界哈希与重放。

use crate::{AppError, Msg};
use manifest_core::defs::EffectKind;
use manifest_core::events::{ActiveEvent, EventOrigin};
use manifest_core::world::{MarketEntry, MarketFlow};
use manifest_core::{GoodId, LocId, OwnerId, World};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 前端实现的预测方法（后端只认 key）。行商的老法子人人会：照旧（朴素法）、旬均价（移动平均）、顺势推算（漂移法）、
/// 去年同月（季节朴素法）、公道价（经验回归）、星象历书；其余是算学奇才的法子（见 `manifest_core::mates::GENIUS_METHODS`），
/// 玩家麾下有会的航海士时才能用。
pub const COMMON_METHODS: [&str; 6] = ["naive", "ma", "drift", "seasonal", "fair", "astrology"];
/// 调整的种类（修订版）：重新拟合、换方法、干预修正、季节修正、剔除日期、参数微调、区间校准。
pub const ADJUSTMENTS: [&str; 7] = ["refit", "switch", "intervention", "seasonal", "exclude", "params", "calibrate"];
/// 调整的依据：某个事件、某条情报、自己的判断。
pub const REASONS: [&str; 3] = ["event", "intel", "judgment"];
/// 预测期限上限（天）。
pub const MAX_HORIZON: u32 = 60;
/// 预测簿最多保留的条数（含已到期）；超出时丢掉最早到期的。
pub const MAX_BOOK: usize = 60;
/// 同时追踪的上限（第 5 节上线后按算学决定）。
pub const DEFAULT_MAX_ACTIVE: usize = 12;
/// 拟合用序列的长度上限、剔除日期的个数上限。
pub const MAX_SERIES: usize = 400;
/// 备注的字数上限。
pub const MAX_NOTE_CHARS: usize = 60;
/// 附属文件的格式版本。
pub const BOOK_VERSION: u32 = 1;
/// 价格与区间的上限（防止前端传来的异常值）。
const MAX_PRICE: i64 = 1_000_000_000_000;

/// 预测路径上的一步（整数金币）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForecastPoint {
    pub mean: i64,
    pub lo80: i64,
    pub hi80: i64,
    pub lo95: i64,
    pub hi95: i64,
}

/// 干预修正（Box–Tiao）：在某天加入阶跃（step）或脉冲（pulse，到 `end` 为止）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Intervention {
    pub day: u32,
    pub kind: String,
    /// 幅度（万分比，相对原预测）
    pub size_bp: i64,
    #[serde(default)]
    pub end: Option<u32>,
}

/// 方法、参数与选项（前端原样保存，后端只校验范围）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForecastSpec {
    pub method: String,
    /// 参数：比例写成万分之一（α = 0.3 → 3000），窗口、天数写成整数
    #[serde(default)]
    pub params: BTreeMap<String, i64>,
    /// 拟合窗口（天）
    pub window: u32,
    /// 对数尺度（Box–Cox λ = 0）
    #[serde(default)]
    pub log: bool,
    /// 季节修正
    #[serde(default)]
    pub seasonal: bool,
    /// 不参与拟合的日期（绝对天数）
    #[serde(default)]
    pub excluded: Vec<u32>,
    /// 区间：formula（公式）或 empirical（按回测误差的分位数）
    #[serde(default = "formula")]
    pub interval: String,
    #[serde(default)]
    pub intervention: Option<Intervention>,
}

fn formula() -> String {
    "formula".into()
}

/// 调整的依据（修订版必须写明）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdjustBasis {
    /// 调整的种类（见 [`ADJUSTMENTS`]）
    pub kind: String,
    /// 依据（见 [`REASONS`]）
    pub reason: String,
    #[serde(default)]
    pub note: String,
}

/// 某天的实际情况：收盘价与市场驱动（整数；系数为万分之一）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrackDay {
    pub day: u32,
    /// 收盘价
    pub price: i64,
    pub stock_close: i64,
    /// 日终库存（收盘之后还有商会与做市方的成交）
    pub stock_end: i64,
    pub target: i64,
    pub produced: i64,
    pub consumed: i64,
    pub player_bought: i64,
    pub player_sold: i64,
    pub npc_bought: i64,
    pub npc_sold: i64,
    pub other_bought: i64,
    pub other_sold: i64,
    /// 收盘价的需求系数与分量（季节、事件、是否流行）
    pub demand_bp: i64,
    pub season_bp: i64,
    pub event_bp: i64,
    pub popular: bool,
    /// 当日产量系数与其中的事件分量
    pub supply_bp: i64,
    pub event_supply_bp: i64,
    /// 收盘价被夹在下限（−1）或上限（1）
    pub clamped: i8,
    /// 本地生产者当天的产能（相对开局，万分之一；没有生产者时为 10000，旧的预测簿为 0 = 不知道）
    #[serde(default)]
    pub capacity_bp: i64,
    /// 城镇工坊当天取走的原料与放回的产出、委托交付进入市场的货物（ECONOMY.md 6.4、6.5；旧的预测簿为 0）
    #[serde(default)]
    pub workshop_in: i64,
    #[serde(default)]
    pub workshop_out: i64,
    #[serde(default)]
    pub delivered: i64,
    /// 收盘时目标库存的需求规模分量：人口比例、需求层级系数（繁荣度）、替代系数（万分之一；0 = 没有记录，即 1）
    #[serde(default)]
    pub people_bp: i64,
    #[serde(default)]
    pub prosperity_bp: i64,
    #[serde(default)]
    pub substitute_bp: i64,
    /// 本地商人当天囤入（正）或抛售（负）的货物（收盘之后；ECONOMY.md 6.6；旧的预测簿为 0）
    #[serde(default)]
    pub hoarded: i64,
    /// 只补了收盘价（记下预测时这一天已经过去，库存与驱动无从得知；ECONOMY.md 第 7 节）
    #[serde(default, skip_serializing_if = "is_false")]
    pub filled: bool,
    /// 收盘价用到的流动性系数（当地钱袋相对往常的多少，ECONOMY.md 6.9；万分之一，0 = 没有记录，即 1）
    #[serde(default)]
    pub liquidity_bp: i64,
}

fn is_false(b: &bool) -> bool {
    !*b
}

impl TrackDay {
    fn from_flow(price: i64, stock_end: i64, f: &MarketFlow, capacity_bp: i64) -> TrackDay {
        TrackDay {
            day: f.day,
            price,
            stock_close: f.stock_close,
            stock_end,
            target: f.target_close,
            produced: f.produced,
            consumed: f.consumed,
            player_bought: f.player_bought,
            player_sold: f.player_sold,
            npc_bought: f.npc_bought,
            npc_sold: f.npc_sold,
            other_bought: f.other_bought,
            other_sold: f.other_sold,
            demand_bp: f.demand_mult.raw(),
            season_bp: f.season_demand.raw(),
            event_bp: f.event_demand.raw(),
            popular: f.popular,
            supply_bp: f.supply_mult.raw(),
            event_supply_bp: f.event_supply.raw(),
            clamped: f.clamped,
            capacity_bp,
            workshop_in: f.workshop_in,
            workshop_out: f.workshop_out,
            delivered: f.delivered,
            people_bp: f.people.raw(),
            prosperity_bp: f.prosperity.raw(),
            substitute_bp: f.substitute.raw(),
            hoarded: f.hoarded,
            filled: false,
            liquidity_bp: f.liquidity.raw(),
        }
    }
}

/// 预测期内发生的相关事件。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Mark {
    pub day: u32,
    /// event（目录事件）、composed（组合事件）、popular（开始流行）、popular_end（流行结束）
    pub kind: String,
    #[serde(default)]
    pub event: Option<u16>,
    #[serde(default)]
    pub composed: Option<u32>,
    /// 效果 key（如 demand_shift）
    #[serde(default)]
    pub effect: Option<String>,
    #[serde(default)]
    pub mult_bp: Option<i64>,
    /// 结束日（不含）
    #[serde(default)]
    pub end: Option<u32>,
}

/// 预测簿的一条。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForecastEntry {
    pub id: u32,
    pub loc: u16,
    pub good: u16,
    /// 记下的日期
    pub created: u32,
    /// 预测起点：最后一个已知收盘价的日期；第 k 步对应 origin + k
    pub origin: u32,
    pub horizon: u32,
    pub spec: ForecastSpec,
    /// 拟合所用的日线（截至 origin，最早的在前）
    pub fitted_on: Vec<i64>,
    pub path: Vec<ForecastPoint>,
    /// 修订自哪一条
    #[serde(default)]
    pub revises: Option<u32>,
    #[serde(default)]
    pub basis: Option<AdjustBasis>,
    /// 起点当天的市场状况（原因分析的基准）
    pub baseline: TrackDay,
    /// 基准是否来自内核的完整记录（记下之前当天已有成交时只能近似）
    pub baseline_exact: bool,
    /// 逐日的实际情况（第 1 步起）
    #[serde(default)]
    pub track: Vec<TrackDay>,
    #[serde(default)]
    pub marks: Vec<Mark>,
}

impl ForecastEntry {
    /// 已到期（实际情况抄满了）。
    pub fn complete(&self) -> bool {
        self.track.len() >= self.horizon as usize
    }
}

/// 记下一条预测的请求（前端算好的结果）。
#[derive(Clone, Debug, Deserialize)]
pub struct PinRequest {
    pub loc: u16,
    pub good: u16,
    pub origin: u32,
    pub horizon: u32,
    pub spec: ForecastSpec,
    pub fitted_on: Vec<i64>,
    pub path: Vec<ForecastPoint>,
    #[serde(default)]
    pub revises: Option<u32>,
    #[serde(default)]
    pub basis: Option<AdjustBasis>,
}

/// 预测簿。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForecastBook {
    pub next_id: u32,
    pub entries: Vec<ForecastEntry>,
}

/// 附属文件的内容。
#[derive(Serialize, Deserialize)]
struct BookFile {
    version: u32,
    book: ForecastBook,
}

fn invalid(key: &'static str, zh: &str) -> AppError {
    AppError::Invalid(Msg::new(key, zh))
}

/// 去掉控制字符并截到上限字数。
fn clean_note(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).take(MAX_NOTE_CHARS).collect::<String>().trim().to_string()
}

/// 事件是否作用于某地某商品的市场（与内核重算修正系数的规则一致）。
fn affects(ev: &ActiveEvent, loc: LocId, good: GoodId) -> bool {
    let p = &ev.params;
    match ev.effect {
        Some(EffectKind::GoodSupply | EffectKind::GoodDemand) => p.good == Some(good),
        Some(EffectKind::SupplyShift | EffectKind::DemandShift) => p.loc == Some(loc) && p.good == Some(good),
        Some(EffectKind::LocationSupply | EffectKind::LocationDemand) => p.loc == Some(loc),
        _ => false,
    }
}

/// 作用于某市场的进行中事件（按开始日）。
pub fn market_events(world: &World, loc: LocId, good: GoodId) -> Vec<Mark> {
    world
        .state
        .events
        .active
        .iter()
        .filter(|ev| affects(ev, loc, good))
        .map(|ev| {
            let (kind, event, composed) = match ev.origin {
                EventOrigin::Catalog => ("event", Some(ev.kind.0), None),
                EventOrigin::Composed { id } => ("composed", None, Some(id)),
            };
            Mark {
                day: ev.start,
                kind: kind.into(),
                event,
                composed,
                effect: ev.effect.map(|e| e.key().to_string()),
                mult_bp: ev.params.mult.map(|m| m.raw()),
                end: Some(ev.end),
            }
        })
        .collect()
}

/// 玩家会的预测方法：老法子，加上麾下算学奇才的法子与主角本人会的（开局自选、跟奇才学会的），按固定顺序去重。
pub fn known_methods(world: &World) -> Vec<String> {
    let player = manifest_core::OwnerId::Player;
    let mut genius: Vec<&str> = world.genius_methods(player);
    if let Some(c) = world.captain_profile(player) {
        genius.extend(c.methods());
    }
    let genius: Vec<&str> = manifest_core::mates::GENIUS_METHODS.into_iter().filter(|g| genius.contains(g)).collect();
    COMMON_METHODS.iter().copied().chain(genius).map(str::to_string).collect()
}

/// 同时追踪的预测上限：有主角档案时为 3 + 算学，没有（旧存档）时为默认值。
pub fn max_active(world: &World) -> usize {
    match world.captain_profile(manifest_core::OwnerId::Player) {
        Some(_) => {
            3 + world.attr_hook(manifest_core::OwnerId::Player, manifest_core::captain::AttrHook::MarketWindow) as usize
        }
        None => DEFAULT_MAX_ACTIVE,
    }
}

/// 麾下的算学奇才与各自掌握的方法；名字取自 `names`（当前语言的显示数据）。
pub fn geniuses(world: &World, names: &manifest_core::StaticData) -> Vec<GeniusView> {
    world
        .state
        .mates
        .iter()
        .filter(|(_, m)| m.owner == Some(manifest_core::OwnerId::Player))
        .filter_map(|(id, _)| {
            let d = world.defs.mates.get(id.idx())?;
            let name = names.mates.get(id.idx()).map(|m| m.name.clone()).unwrap_or_else(|| d.name.clone());
            (!d.methods.is_empty()).then(|| GeniusView { mate: id.0, name, methods: d.methods.clone() })
        })
        .collect()
}

/// 最后一个已知收盘价的日期（还没有收盘价时为 None）。
pub fn last_close_day(world: &World) -> Option<u32> {
    world.day().checked_sub(1)
}

/// 玩家所知的某地最后一个收盘日（信息时效：远方港口是手上快照日的前一天；看得到实时行情时是昨天）。
pub fn known_close(world: &World, loc: LocId) -> Option<u32> {
    match world.sight(OwnerId::Player).snapshot(loc) {
        Some(s) => s.day.checked_sub(1),
        None => last_close_day(world),
    }
}

/// 过时起点的基准：只知道快照里的价格与库存（记为近似）。
fn stale_baseline(e: &MarketEntry, origin: u32, price: i64, stock: i64) -> TrackDay {
    TrackDay {
        day: origin,
        price,
        stock_end: stock,
        stock_close: stock,
        target: e.target,
        capacity_bp: e.producer.capacity_ratio().raw(),
        ..TrackDay::default()
    }
}

/// 起点当天的基准：内核的当日记录还是那一天时是完整的；当天已经有成交（记录被清零）时，
/// 由日终库存倒推收盘库存（商会与做市方在收盘之后的成交无从得知，记为近似）。
fn baseline_of(e: &MarketEntry, origin: u32, today: u32) -> (TrackDay, bool) {
    let price = e.history.back().copied().unwrap_or(e.price);
    if e.flow.day == origin {
        return (TrackDay::from_flow(price, e.stock, &e.flow, e.producer.capacity_ratio().raw()), true);
    }
    let mut t = TrackDay {
        day: origin,
        price,
        stock_end: e.stock,
        stock_close: e.stock,
        target: e.target,
        capacity_bp: e.producer.capacity_ratio().raw(),
        ..TrackDay::default()
    };
    if e.flow.day == today {
        // 今天的玩家与其他成交发生在记下之前：退回到今天开盘时的库存
        let back = e.flow.player_bought - e.flow.player_sold + e.flow.npc_bought - e.flow.npc_sold
            + e.flow.other_bought
            - e.flow.other_sold;
        t.stock_end = e.stock + back;
        t.stock_close = t.stock_end;
    }
    (t, false)
}

impl ForecastBook {
    /// 还没到期的条数。
    pub fn active_count(&self) -> usize {
        self.entries.iter().filter(|e| !e.complete()).count()
    }

    pub fn get(&self, id: u32) -> Option<&ForecastEntry> {
        self.entries.iter().find(|e| e.id == id)
    }

    /// 记下一条预测：校验请求，记录起点当天的基准。返回新条目的编号。
    pub fn pin(&mut self, world: &World, req: PinRequest, max_active: usize) -> Result<u32, AppError> {
        let defs = &world.defs;
        let (loc, good) = (LocId(req.loc), GoodId(req.good));
        if !world.location_visible(loc)
            || defs.goods.get(good.idx()).is_none()
            || !world.good_revealed(good)
            || !world.market_open(loc, good)
        {
            return Err(invalid("app.loc_or_good", "地点或商品不存在"));
        }
        let Some(e) = world.market(loc, good) else {
            return Err(invalid("forecast.not_traded", "这个地点不交易这种商品"));
        };
        if !crate::views::market_known(world, loc) {
            return Err(invalid("forecast.unknown", "尚未到访的港口，没有行情可以分析"));
        }
        let Some(last) = known_close(world, loc) else {
            return Err(invalid("forecast.no_data", "还没有收盘价，至少要过一天才能预测"));
        };
        if req.origin != last {
            return Err(invalid("forecast.origin", "预测只能从所知的最近一个收盘日起算"));
        }
        // 过时的行情：期限可以多出过时的天数（终点最多在今天之后 60 天）
        let stale = last_close_day(world).map(|d| d.saturating_sub(last)).unwrap_or(0);
        let max_horizon = MAX_HORIZON + stale;
        if req.horizon == 0 || req.horizon > max_horizon {
            return Err(AppError::Invalid(
                Msg::new("forecast.horizon", format!("预测期限必须在 1–{max_horizon} 天之间"))
                    .arg("max", max_horizon.to_string()),
            ));
        }
        if req.path.len() != req.horizon as usize {
            return Err(invalid("forecast.path_len", "预测路径的长度与期限不一致"));
        }
        let ordered = |p: &ForecastPoint| {
            0 <= p.lo95
                && p.lo95 <= p.lo80
                && p.lo80 <= p.mean
                && p.mean <= p.hi80
                && p.hi80 <= p.hi95
                && p.hi95 <= MAX_PRICE
        };
        if !req.path.iter().all(ordered) {
            return Err(invalid(
                "forecast.path_order",
                "预测路径的区间必须满足 95% 下沿 ≤ 80% 下沿 ≤ 预测值 ≤ 80% 上沿 ≤ 95% 上沿",
            ));
        }
        let spec = &req.spec;
        if !known_methods(world).iter().any(|m| m == &spec.method) {
            return Err(invalid("forecast.method", "你还不会这种预测方法"));
        }
        if req.fitted_on.len() < 2
            || req.fitted_on.len() > MAX_SERIES
            || spec.window < 2
            || spec.window as usize > MAX_SERIES
            || spec.excluded.len() > MAX_SERIES
            || req.fitted_on.iter().any(|v| *v < 0 || *v > MAX_PRICE)
            || spec.params.len() > 16
            || spec.params.iter().any(|(k, v)| k.chars().count() > 16 || v.abs() > 1_000_000_000)
        {
            return Err(invalid("forecast.spec", "拟合数据或参数超出范围"));
        }
        if !["formula", "empirical"].contains(&spec.interval.as_str()) {
            return Err(invalid("forecast.spec", "拟合数据或参数超出范围"));
        }
        if let Some(i) = &spec.intervention
            && (!["step", "pulse"].contains(&i.kind.as_str()) || i.size_bp.abs() > 100_000)
        {
            return Err(invalid("forecast.spec", "拟合数据或参数超出范围"));
        }
        if let Some(r) = req.revises
            && self.get(r).is_none()
        {
            return Err(invalid("forecast.revises", "要修订的预测不存在"));
        }
        let basis = match &req.basis {
            Some(b) => {
                if !ADJUSTMENTS.contains(&b.kind.as_str()) || !REASONS.contains(&b.reason.as_str()) {
                    return Err(invalid("forecast.basis", "调整的种类或依据不对"));
                }
                Some(AdjustBasis { kind: b.kind.clone(), reason: b.reason.clone(), note: clean_note(&b.note) })
            }
            None if req.revises.is_some() => {
                return Err(invalid("forecast.basis_missing", "修订版必须写明调整的种类与依据"));
            }
            None => None,
        };
        if self.active_count() >= max_active {
            return Err(AppError::Invalid(
                Msg::new("forecast.full", format!("同时追踪的预测已达上限 {max_active} 条"))
                    .arg("max", max_active.to_string()),
            ));
        }
        let (baseline, baseline_exact) = match world.known_market(OwnerId::Player, loc, good) {
            Some(k) if !k.is_live() => (stale_baseline(e, last, k.history().last().unwrap_or(k.price), k.stock), false),
            _ => baseline_of(e, last, world.day()),
        };
        let id = self.next_id.max(1);
        self.next_id = id + 1;
        let mut spec = req.spec.clone();
        spec.excluded.sort_unstable();
        spec.excluded.dedup();
        self.entries.push(ForecastEntry {
            id,
            loc: req.loc,
            good: req.good,
            created: world.day(),
            origin: req.origin,
            horizon: req.horizon,
            spec,
            fitted_on: req.fitted_on,
            path: req.path,
            revises: req.revises,
            basis,
            baseline,
            baseline_exact,
            track: Vec::new(),
            marks: market_events(world, loc, good).into_iter().filter(|m| m.end.is_none_or(|end| end > last)).collect(),
        });
        self.trim();
        Ok(id)
    }

    /// 超出上限时丢掉最早到期的条目（还在追踪的不丢）。
    fn trim(&mut self) {
        while self.entries.len() > MAX_BOOK {
            let Some(i) = self.entries.iter().position(|e| e.complete()) else { break };
            self.entries.remove(i);
        }
    }

    /// 删除一条（应用层数据，可以随时删）。
    pub fn remove(&mut self, id: u32) -> bool {
        let before = self.entries.len();
        self.entries.retain(|e| e.id != id);
        self.entries.len() != before
    }

    /// 每日结算之后调用：给没到期的条目抄录刚结束的那一天。
    pub fn record_day(&mut self, world: &World) {
        let Some(d) = last_close_day(world) else { return };
        for entry in self.entries.iter_mut() {
            if entry.complete() || d <= entry.origin || entry.track.last().is_some_and(|t| t.day >= d) {
                continue;
            }
            let (loc, good) = (LocId(entry.loc), GoodId(entry.good));
            let Some(e) = world.market(loc, good) else { continue };
            if e.flow.day != d {
                continue;
            }
            // 从过时的行情记下的预测：记下时已经过去的日子只补收盘价（日线里有的），对齐“第 k 步 = 起点 + k”
            let mut next = entry.track.last().map(|t| t.day).unwrap_or(entry.origin) + 1;
            while next < d && entry.track.len() < entry.horizon as usize {
                let back = (d - next) as usize;
                let prev = entry.track.last().unwrap_or(&entry.baseline);
                let price = e.history.len().checked_sub(1 + back).map(|i| e.history[i]).unwrap_or(prev.price);
                // 库存照前一天，驱动都记 0（无从得知）
                let filled = TrackDay {
                    day: next,
                    price,
                    stock_close: prev.stock_end,
                    stock_end: prev.stock_end,
                    target: prev.target,
                    capacity_bp: prev.capacity_bp,
                    filled: true,
                    ..TrackDay::default()
                };
                entry.track.push(filled);
                next += 1;
            }
            if entry.complete() {
                continue;
            }
            let price = e.history.back().copied().unwrap_or(e.price);
            let day = TrackDay::from_flow(price, e.stock, &e.flow, e.producer.capacity_ratio().raw());
            let prev_popular = entry.track.last().map(|t| t.popular).unwrap_or(entry.baseline.popular);
            if day.popular && !prev_popular {
                entry.marks.push(Mark {
                    day: d,
                    kind: "popular".into(),
                    event: None,
                    composed: None,
                    effect: None,
                    mult_bp: None,
                    end: Some(e.popular_until),
                });
            } else if !day.popular && prev_popular {
                entry.marks.push(Mark {
                    day: d,
                    kind: "popular_end".into(),
                    event: None,
                    composed: None,
                    effect: None,
                    mult_bp: None,
                    end: None,
                });
            }
            for m in market_events(world, loc, good) {
                let seen = entry.marks.iter().any(|x| {
                    x.kind == m.kind
                        && x.day == m.day
                        && x.event == m.event
                        && x.composed == m.composed
                        && x.effect == m.effect
                });
                if !seen && m.day > entry.origin {
                    entry.marks.push(m);
                }
            }
            entry.track.push(day);
        }
    }

    /// 序列化为附属文件的内容。
    pub fn to_file(&self) -> Result<String, AppError> {
        serde_json::to_string(&BookFile { version: BOOK_VERSION, book: self.clone() })
            .map_err(|e| AppError::Io(e.to_string()))
    }

    /// 从附属文件的内容读取；缺失或损坏时为空（预测簿不影响游戏本身）。
    pub fn from_file(text: Option<&str>) -> ForecastBook {
        text.and_then(|t| serde_json::from_str::<BookFile>(t).ok())
            .filter(|f| f.version <= BOOK_VERSION)
            .map(|f| f.book)
            .unwrap_or_default()
    }
}

// ───────────────────────────── 视图 ─────────────────────────────

/// 某地某商品的行情序列（行情窗口与交易所的预测开关用）。
#[derive(Clone, Debug, Serialize)]
pub struct SeriesView {
    pub loc: u16,
    pub good: u16,
    /// 今天（尚未结算的一天）
    pub today: u32,
    /// 日线最后一个值的日期（还没有收盘价时为 None）
    pub last_close: Option<u32>,
    /// 日线：每日收盘价，最早的在前，最后一个是 `last_close` 那天
    pub daily: Vec<i64>,
    /// 月线：月均收盘价，最早的在前
    pub monthly: Vec<i64>,
    /// 月线最后一个值所在月的月末日期
    pub monthly_last: Option<u32>,
    pub base_price: i64,
    /// 价格下限与上限（金币）
    pub floor: i64,
    pub cap: i64,
    pub price: i64,
    pub stock: i64,
    pub target: i64,
    /// 流行截止日（不含）；不流行为 None
    pub popular_until: Option<u32>,
    /// 作用于这个市场的进行中事件
    pub events: Vec<Mark>,
    /// 价格曲线 f(库存 / 目标库存)（万分之一）与流行加成，供原因分析按内核公式拆解价格
    pub curve: Vec<(i64, i64)>,
    pub popular_bonus_bp: i64,
    /// 玩家会的预测方法（老法子 + 麾下算学奇才的法子）
    pub methods: Vec<String>,
    /// 这里有没有本地产出（没有时全靠外来）
    pub produces: bool,
    /// 本地生产者（ECONOMY.md 6.3）；生产者没有打开或这里没有产出时为空
    pub producer: Option<ProducerView>,
    /// 本地商人（ECONOMY.md 6.6）：四派的占比与各自对下一个收盘价的预测、主流预期、存货；规则关闭或还没开张时为空
    pub merchants: Option<MerchantsView>,
    /// 行情的时效与来源（随船传递、远方港口；看得到实时行情时为空；ECONOMY.md 第 7 节）
    pub seen: Option<crate::views::SeenView>,
    /// 主角的旗舰队到这里的预计航程（天）：工作台用“过时的天数 + 航程”作期限，直接给出抵达时的价格区间
    pub voyage_days: Option<i64>,
}

/// 本地商人的状况（行情窗口的说明用）。四派的顺序：适应、弱趋势、强趋势、锚定。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct MerchantsView {
    /// 四派的占比（万分之一）
    pub shares_bp: [i64; 4],
    /// 四派对下一个收盘价的预测与按占比加权的主流预期（含传闻的偏移；万分之一金币）
    pub forecast_bp: [i64; 4],
    pub expect_bp: i64,
    /// 今天的精确收盘价（万分之一金币）
    pub price_bp: i64,
    /// 存货（件）与平常的存货
    pub hoard: i64,
    pub hoard_base: i64,
    /// 传闻带来的预期偏移（万分之一，±）
    pub rumor_bp: i64,
}

fn merchants_view(world: &World, loc: LocId, good: GoodId, e: &MarketEntry) -> Option<MerchantsView> {
    let defs = &world.defs;
    let m = manifest_core::merchants::merchants_of(defs, e)?;
    let mult = manifest_core::market::price_mult_in(
        defs,
        world.day(),
        good,
        e,
        defs.loc(loc).hemisphere.season(defs.calendar.season_of(world.day())),
    );
    Some(MerchantsView {
        shares_bp: m.shares.map(|s| s.raw()),
        forecast_bp: m.forecast,
        expect_bp: m.expect,
        price_bp: manifest_core::market::precise_price_bp(defs, e, mult),
        hoard: m.hoard,
        hoard_base: defs.rules.merchants.hoard_base.apply(e.target),
        rumor_bp: m.rumor.raw(),
    })
}

/// 本地生产者的状况（行情窗口的说明与复盘用）。
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ProducerView {
    /// 当前产能相对开局（万分之一）
    pub capacity_bp: i64,
    /// 作物下一季的计划产能相对开局（万分之一；非作物为空）
    pub planned_bp: Option<i64>,
    /// 生产者对价格的预期（相对这个月的正常价，万分之一）
    pub expect_bp: i64,
    /// 这个月的正常价（万分之一金币；头一年还在观望时为空）
    pub normal_bp: Option<i64>,
    /// 头一年只看不动
    pub learning: bool,
    /// 按季播种的作物
    pub crop: bool,
}

fn producer_view(world: &World, good: GoodId, e: &MarketEntry) -> Option<ProducerView> {
    let p = &e.producer;
    if !world.defs.rules.producers.enabled || p.k0 == 0 {
        return None;
    }
    let crop = world.defs.good(good).crop;
    let month = world.defs.calendar.date_of(world.day()).month;
    let ratio = |k: i64| manifest_core::Fx::ratio(k, p.k0).raw();
    Some(ProducerView {
        capacity_bp: ratio(p.k),
        planned_bp: (crop && p.next > 0).then(|| ratio(p.next)),
        expect_bp: p.expect.raw(),
        normal_bp: p.learned_in(world.defs.calendar.months().len()).then(|| p.reference(month)),
        learning: !p.learned_in(world.defs.calendar.months().len()),
        crop,
    })
}

/// 麾下的一位算学奇才。
#[derive(Clone, Debug, Serialize)]
pub struct GeniusView {
    pub mate: u16,
    pub name: String,
    pub methods: Vec<String>,
}

/// 预测簿视图。
#[derive(Clone, Debug, Serialize)]
pub struct BookView {
    pub today: u32,
    pub last_close: Option<u32>,
    /// 同时追踪的上限与当前条数
    pub max_active: usize,
    pub active: usize,
    pub entries: Vec<ForecastEntry>,
    /// 玩家会的预测方法与麾下的算学奇才
    pub methods: Vec<String>,
    pub geniuses: Vec<GeniusView>,
    /// 可以分析的地点（到访过、有市场）与各自交易的商品
    pub places: Vec<PlaceGoods>,
}

/// 可以分析的地点与它交易的商品。
#[derive(Clone, Debug, Serialize)]
pub struct PlaceGoods {
    pub loc: u16,
    pub goods: Vec<u16>,
    /// 与 `goods` 一一对应：玩家所知的价格（信息时效：远方是快照里的）
    pub prices: Vec<i64>,
    /// 这里出售的商品（开放市场打开时；关闭时为空，表示 `goods` 里的都能买）
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub sold: Vec<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seen: Option<crate::views::SeenView>,
    pub normal: Vec<manifest_core::Money>,
    pub vs_normal_bp: Vec<i64>,
}

/// 知道行情、有市场的地点（按地点编号；信息时效：随船传递时是在场或有快照的地点）。
pub fn places(world: &World) -> Vec<PlaceGoods> {
    let defs = &world.defs;
    world
        .state
        .locations
        .iter()
        .enumerate()
        .filter(|(i, l)| !l.market.is_empty() && crate::views::market_known(world, LocId::from_idx(*i)))
        .map(|(i, l)| {
            let loc = LocId::from_idx(i);
            let sold: Vec<u16> = if defs.rules.open_market.enabled {
                world.market_sale_list(loc).into_iter().filter(|g| world.good_revealed(*g)).map(|g| g.0).collect()
            } else {
                Vec::new()
            };
            // 所知的价格（快照里没有的商品不列：例如开放市场之前的旧快照里没有补上的条目）
            let (goods, prices): (Vec<u16>, Vec<i64>) = l
                .market
                .keys()
                .filter(|g| world.good_revealed(**g) && world.market_open(loc, **g))
                .filter_map(|g| {
                    world.known_market(OwnerId::Player, loc, *g).map(|k| {
                        let price = if foreign_rare(world, loc, *g) {
                            if k.is_live() { world.rare_sell_unit(loc, *g, 0) } else { world.rare_peak(loc, *g) }
                        } else {
                            k.price
                        };
                        (g.0, price)
                    })
                })
                .unzip();
            let normal: Vec<_> = goods
                .iter()
                .map(|g| {
                    if foreign_rare(world, loc, GoodId(*g)) {
                        world.rare_peak(loc, GoodId(*g))
                    } else {
                        manifest_core::market::normal_price(defs, &l.market[&GoodId(*g)])
                    }
                })
                .collect();
            let vs_normal_bp = prices
                .iter()
                .zip(&normal)
                .map(|(p, n)| manifest_core::fixed::mul_div_floor(*p, 10_000, (*n).max(1)))
                .collect();
            PlaceGoods {
                loc: i as u16,
                goods,
                prices,
                sold,
                seen: crate::views::seen_view(world, loc),
                normal,
                vs_normal_bp,
            }
        })
        .collect()
}

/// 行情序列；未到访的港口报错（没有行情可以分析）。
pub fn series_view(world: &World, loc: LocId, good: GoodId) -> Result<SeriesView, AppError> {
    let defs = &world.defs;
    if !world.location_visible(loc)
        || defs.goods.get(good.idx()).is_none()
        || !world.good_revealed(good)
        || !world.market_open(loc, good)
    {
        return Err(invalid("app.loc_or_good", "地点或商品不存在"));
    }
    let Some(e) = world.market(loc, good) else {
        return Err(invalid("forecast.not_traded", "这个地点不交易这种商品"));
    };
    let k = world.known_market(OwnerId::Player, loc, good).filter(|_| crate::views::market_known(world, loc));
    let Some(k) = k else {
        return Err(invalid("forecast.unknown", "尚未到访的港口，没有行情可以分析"));
    };
    let rules = &defs.rules;
    let rare = foreign_rare(world, loc, good);
    // 信息时效：远方港口的日线截到快照日之前，月线去掉快照之后才结束的月份
    let stale = !k.is_live();
    let last_close = known_close(world, loc);
    let calendar = &defs.calendar;
    let month_ends =
        |d: Option<u32>| d.map(|d| (calendar.month_index(d) + u32::from(calendar.month_end(d))) as usize).unwrap_or(0);
    let hidden_months = month_ends(last_close_day(world)).saturating_sub(month_ends(last_close));
    let monthly = if rare { Vec::new() } else { e.monthly[..e.monthly.len().saturating_sub(hidden_months)].to_vec() };
    let monthly_last = match (last_close, monthly.is_empty()) {
        (Some(d), false) => month_ends(Some(d)).checked_sub(1).and_then(|m| calendar.month_end_day(m as u32).ok()),
        _ => None,
    };
    let floor = rules.price_floor.apply(e.base_price).max(1);
    let seen_day = k.day;
    Ok(SeriesView {
        loc: loc.0,
        good: good.0,
        today: world.day(),
        last_close,
        daily: if rare { Vec::new() } else { k.history().collect() },
        monthly,
        monthly_last,
        base_price: e.base_price,
        floor,
        cap: rules.price_cap.apply(e.base_price).max(floor),
        price: if rare {
            if stale { world.rare_peak(loc, good) } else { world.rare_sell_unit(loc, good, 0) }
        } else {
            k.price
        },
        stock: k.stock,
        target: e.target,
        popular_until: (!stale && e.popular_until > world.day()).then_some(e.popular_until),
        events: market_events(world, loc, good).into_iter().filter(|m| seen_day.is_none_or(|d| m.day < d)).collect(),
        curve: rules.price_curve.points.iter().map(|(x, y)| (x.raw(), y.raw())).collect(),
        popular_bonus_bp: rules.popular_bonus.raw(),
        methods: known_methods(world),
        produces: e.supply > 0,
        producer: if stale { None } else { producer_view(world, good, e) },
        merchants: if stale { None } else { merchants_view(world, loc, good, e) },
        seen: crate::views::seen_view(world, loc),
        voyage_days: voyage_days(world, loc),
    })
}

/// 主角的旗舰队到某地的预计航程（天；已经在那里时为 0；没有舰队或到不了时为空）。
pub fn voyage_days(world: &World, loc: LocId) -> Option<i64> {
    let fleet = world.fleet(world.flagship(OwnerId::Player)?).ok()?;
    if fleet.docked_at() == Some(loc) {
        return Some(0);
    }
    world.estimate_days(fleet, loc)
}

/// 玩家已经知道的那部分：抄录与事件只到所知的最后一个收盘日（信息时效；看得到实时行情时是全部）。
fn known_part(world: &World, entry: &ForecastEntry) -> ForecastEntry {
    let Some(known) = known_close(world, LocId(entry.loc)) else {
        return ForecastEntry { track: Vec::new(), marks: Vec::new(), ..entry.clone() };
    };
    let mut out = entry.clone();
    out.track.retain(|t| t.day <= known);
    out.marks.retain(|m| m.day <= known);
    out
}

impl ForecastBook {
    /// 预测簿视图；`names` 为当前语言的显示数据（奇才的名字）。
    pub fn view(&self, world: &World, max_active: usize, names: &manifest_core::StaticData) -> BookView {
        BookView {
            today: world.day(),
            last_close: last_close_day(world),
            max_active,
            active: self.active_count(),
            entries: self.entries.iter().map(|e| known_part(world, e)).collect(),
            methods: known_methods(world),
            geniuses: geniuses(world, names),
            places: places(world),
        }
    }
}

/// 隐秘货的远销价不读库存；快照只给不饱和峰值，不泄漏当前饱和。
fn foreign_rare(world: &World, loc: LocId, good: GoodId) -> bool {
    manifest_core::stages::is_rare(&world.defs, good)
        && manifest_core::stages::rare_source(&world.defs, good) != Some(loc)
}
