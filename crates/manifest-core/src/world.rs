//! 世界状态。
//!
//! [`WorldState`] 是全部可变状态（可序列化、参与哈希）；[`World`] 把它与只读的
//! 静态数据绑在一起。状态只能通过 [`crate::command::Command`] 与每日 tick 改变。

use crate::bank::{Credit, Loan};
use crate::calendar::Season;
use crate::caravan::Caravan;
use crate::contract::TransportContract;
use crate::defs::{ScenarioDef, StaticData};
use crate::diplomacy::Relation;
use crate::error::CoreError;
use crate::events::EventState;
use crate::fixed::{Fx, Money};
use crate::futures::FuturesState;
use crate::ids::*;
use crate::industry::Industry;
use crate::ledger::{Account, CashClass, InventoryBook, JournalEntry, Ledger, Memo};
use crate::log::LogEvent;
use crate::merchants::Merchants;
use crate::news::{Bargain, NewsState};
use crate::people::People;
use crate::treasury::MoneyStats;
use crate::warehouse::Warehouse;
use crate::workshop::Workshop;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, VecDeque};
use std::sync::Arc;

mod opening;

/// 某地某商品的现货市场状态。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarketEntry {
    pub stock: i64,
    pub target: i64,
    /// 均衡日产量（未乘季节与事件系数）
    pub supply: i64,
    /// 目标库存下的日消耗
    pub demand: i64,
    pub base_price: Money,
    /// 当前报价（中间价）
    pub price: Money,
    pub specialty: bool,
    /// 流行截止日（不含）；0 表示不流行
    pub popular_until: u32,
    /// 事件带来的产量系数
    pub event_supply: Fx,
    /// 事件带来的需求系数
    pub event_demand: Fx,
    /// 最近若干天的收盘价（最早的在前；保留天数见 `rules.toml price_history_days`）
    pub history: VecDeque<Money>,
    /// 最近若干个月的月均收盘价（月末记入，最早的在前；保留个数见 `rules.toml price_history_months`）
    #[serde(default)]
    pub monthly: Vec<Money>,
    /// 当天的库存流量与收盘时的价格构成，供行情分析解释价格变化（不影响任何结算）
    #[serde(default)]
    pub flow: MarketFlow,
    /// 本地生产者与产销余数（ECONOMY.md 6.3）；开关都关时保持全零、不写进存档
    #[serde(default, skip_serializing_if = "Producer::is_unset")]
    pub producer: Producer,
    /// 替代系数相对 1 的偏离（万分之一，ECONOMY.md 6.4）：同组商品按价格分摊需求；0 表示没有替代
    #[serde(default, skip_serializing_if = "is_zero")]
    pub subst_bp: i64,
    /// 本地商人的预期与囤货（ECONOMY.md 6.6；规则关闭时全零、不写进存档）
    #[serde(default, skip_serializing_if = "Merchants::is_unset")]
    pub merchants: Merchants,
    /// 玩家近期在这里的交易量（每天买卖件数 × 100 的 30 天指数平均；商会 2.0 对玩家的反应用）
    #[serde(default, skip_serializing_if = "is_zero")]
    pub player_recent: i64,
    /// 特产这个月被买走的数量（势力的经济政策看它是否被大量运走；规则关闭时为 0、不写进存档）
    #[serde(default, skip_serializing_if = "is_zero")]
    pub month_out: i64,
    /// 流动性系数（ECONOMY.md 6.9）：当地钱袋相对往常的多少，报价乘它；货币流通关闭时为 1，不写进存档
    #[serde(default = "one", skip_serializing_if = "is_one")]
    pub liquidity: Fx,
    /// 开放市场补上的条目（不在地点的市场清单里，[`crate::open_market`]）：只收不卖，不参与城镇的满足度、替代、流行与规则触发的禁运；
    /// 开放市场关闭时没有这样的条目、不写进存档
    #[serde(default, skip_serializing_if = "is_false")]
    pub extra: bool,
    #[serde(default, skip_serializing_if = "crate::stages::RareState::is_unset")]
    pub rare: crate::stages::RareState,
}

fn is_false(b: &bool) -> bool {
    !*b
}

fn one() -> Fx {
    Fx::ONE
}

fn is_one(x: &Fx) -> bool {
    *x == Fx::ONE
}

fn is_zero(v: &i64) -> bool {
    *v == 0
}

fn is_zero_fx(v: &Fx) -> bool {
    *v == Fx::ZERO
}

/// 本地生产者（ECONOMY.md 6.3，规则见 [`crate::defs::ProducerRules`]）：产能、对价格的预期与参照价，以及产销的余数。
/// 产能以万分之一件 / 天计；`k0 == 0` 表示还没有生产者（开关关闭、旧存档或这个市场没有产出），第一次用到时再初始化。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Producer {
    /// 开局产能与当前产能（万分之一件 / 天）
    #[serde(default)]
    pub k0: i64,
    #[serde(default)]
    pub k: i64,
    /// 作物的计划产能：每月调整，季初生效（0 表示还没有计划；非作物不用）
    #[serde(default)]
    pub next: i64,
    /// 生产者对价格的预期（相对当月参照价的比例，1.0 为正常）
    #[serde(default)]
    pub expect: Fx,
    /// 各月（1–12 月）的参照价：头一年那个月影子价格的均值（万分之一金币；0 表示还没看到那个月，12 个月都有之前只看不动）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub refs: Vec<Money>,
    /// 本月至今每日影子价格之和（万分之一金币）与天数；月末用完清零
    #[serde(default)]
    pub month_sum: Money,
    #[serde(default)]
    pub month_days: u32,
    /// 产出与消耗的余数（万分之一件，[`crate::defs::ProducerRules::fractional`] 打开时累计）
    #[serde(default)]
    pub carry_prod: i64,
    #[serde(default)]
    pub carry_cons: i64,
}

impl Producer {
    /// 全零：没有生产者、也没有余数（存档里省略）。
    pub fn is_unset(&self) -> bool {
        *self == Producer::default()
    }

    /// 12 个月的参照价都有了（头一年已过，开始调整产能）。
    pub fn learned(&self) -> bool {
        self.learned_in(12)
    }

    pub fn learned_in(&self, months: usize) -> bool {
        self.refs.len() == months && self.refs.iter().all(|r| *r > 0)
    }

    /// 某月（1–12）的参照价（万分之一金币；还没有时为 0）。
    pub fn reference(&self, month: u32) -> Money {
        self.refs.get(month.saturating_sub(1) as usize).copied().unwrap_or(0)
    }

    /// 当前产能相对开局的比例（没有生产者时为 1.0）。
    pub fn capacity_ratio(&self) -> Fx {
        if self.k0 > 0 { Fx::ratio(self.k, self.k0) } else { Fx::ONE }
    }
}

/// 某市场一天之内的库存流量（件）与收盘（tick 第 3 步记价格）时的价格构成。
///
/// 同一天里：玩家的成交发生在结算之前，产出与消耗在第 2 步，收盘在第 3 步，商会的成交在第 7 步。
/// 每天第一次记录时清零（见 [`MarketFlow::today`]），因此每日结算之后读到的是刚结束的那一天的完整记录。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MarketFlow {
    /// 记录所属的日期
    pub day: u32,
    /// 当日产出与消耗
    pub produced: i64,
    pub consumed: i64,
    /// 当日产量系数（季节 × 事件 × 发展度，不含随机波动）与其中的事件分量
    pub supply_mult: Fx,
    pub event_supply: Fx,
    /// 玩家买入、卖出
    pub player_bought: i64,
    pub player_sold: i64,
    /// 商会买入、卖出
    pub npc_bought: i64,
    pub npc_sold: i64,
    /// 其他参与者（期货做市方的交割采购与回售）买入、卖出
    pub other_bought: i64,
    pub other_sold: i64,
    /// 收盘时的库存与目标库存
    pub stock_close: i64,
    pub target_close: i64,
    /// 收盘价用到的需求系数及其三个分量：季节、事件、是否流行
    pub demand_mult: Fx,
    pub season_demand: Fx,
    pub event_demand: Fx,
    pub popular: bool,
    /// 收盘价是否被夹在下限（−1）或上限（1）
    pub clamped: i8,
    /// 城镇工坊取走的原料与放回的产出（不含在 produced / consumed 里；ECONOMY.md 6.5）
    #[serde(default, skip_serializing_if = "is_zero")]
    pub workshop_in: i64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub workshop_out: i64,
    /// 委托交付进入市场的货物
    #[serde(default, skip_serializing_if = "is_zero")]
    pub delivered: i64,
    /// 本地商人囤入（正）或抛售（负）的货物（收盘之后；ECONOMY.md 6.6）
    #[serde(default, skip_serializing_if = "is_zero")]
    pub hoarded: i64,
    /// 收盘时目标库存用到的需求规模的三个分量：人口比例、需求层级系数、替代系数（ECONOMY.md 6.4；0 表示没有记录，即 1）
    #[serde(default, skip_serializing_if = "is_zero_fx")]
    pub people: Fx,
    #[serde(default, skip_serializing_if = "is_zero_fx")]
    pub prosperity: Fx,
    #[serde(default, skip_serializing_if = "is_zero_fx")]
    pub substitute: Fx,
    /// 收盘价用到的流动性系数（ECONOMY.md 6.9；0 表示没有记录，即 1）
    #[serde(default, skip_serializing_if = "is_zero_fx")]
    pub liquidity: Fx,
}

impl MarketFlow {
    /// 当天的记录：日期不同（新的一天第一次记录）时先清零。
    pub fn today(&mut self, day: u32) -> &mut MarketFlow {
        if self.day != day {
            *self = MarketFlow { day, ..MarketFlow::default() };
        }
        self
    }
}

/// 地点的动态状态。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocationState {
    /// 这一地的市场。各地的市场合起来占世界状态的八成多，这里再按地点各包一层写时复制（见 [`crate::shared`]）：
    /// 试算用的世界副本只改一两处地点时（玩家的一笔买卖、一条涟漪事件），只拷那一处的市场，不拷全部。
    /// 读写照 `BTreeMap` 的写法，序列化不变。
    pub market: crate::shared::Shared<BTreeMap<GoodId, MarketEntry>>,
    /// 发展度（旧规则 1–100；E02 为 1–development.max），影响产量与需求上限
    pub development: i64,
    /// 各所有者在此地的仓库
    #[serde(default)]
    pub warehouses: BTreeMap<OwnerId, Warehouse>,
    /// 各所有者的累计港口投资
    #[serde(default)]
    pub investments: BTreeMap<OwnerId, Money>,
    /// 同盟港的所有者
    #[serde(default)]
    pub ally: Option<OwnerId>,
    /// 殖民点的归属：被势力占领或已建成殖民地
    #[serde(default)]
    pub claim: Option<crate::colony::Claim>,
    /// 被势力占领的日期（殖民竞赛的冷却用；旧存档没有）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claimed_on: Option<u32>,
    /// 人口与繁荣度（ECONOMY.md 6.4；规则关闭时全零、不写进存档）
    #[serde(default, skip_serializing_if = "People::is_unset")]
    pub people: People,
    /// 城镇工坊（按配方；ECONOMY.md 6.5；规则关闭时为空、不写进存档）
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub workshops: BTreeMap<RecipeId, Workshop>,
    /// 告示板：随船带来的各港行情（按出发港；ECONOMY.md 第 7 节；只在随船传递模式下有）。
    /// 每条消息带一整份行情快照，同样按地点包成写时复制。
    #[serde(default, skip_serializing_if = "board_is_empty")]
    pub board: crate::shared::Shared<BTreeMap<LocId, crate::info::Snapshot>>,
    /// E02：发展度零头、月累计与上月构成；规则关闭时为空。
    #[serde(default, skip_serializing_if = "crate::development::DevGrowth::is_unset")]
    pub growth: crate::development::DevGrowth,
}

/// 告示板上没有消息（不写进存档；与原来的 `BTreeMap::is_empty` 同一个条件）。
fn board_is_empty(board: &crate::shared::Shared<BTreeMap<LocId, crate::info::Snapshot>>) -> bool {
    board.is_empty()
}

impl LocationState {
    fn fresh(development: i64) -> LocationState {
        LocationState {
            market: Default::default(),
            development,
            warehouses: BTreeMap::new(),
            investments: BTreeMap::new(),
            ally: None,
            claim: None,
            claimed_on: None,
            people: People::default(),
            workshops: BTreeMap::new(),
            board: Default::default(),
            growth: Default::default(),
        }
    }
}

/// NPC 商会的策略参数（可被 AI 战略备忘在允许范围内调整）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Strategy {
    pub risk: Fx,
    pub preferred: Vec<GoodId>,
    /// 商会 2.0：正在用的预测方法（没有时用数据里偏好的方法）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub method: Option<crate::defs::ForecastMethod>,
    /// 商会 2.0：三种预测方法对卖出价的相对误差（万分之一，指数平均）与样本数
    #[serde(default, skip_serializing_if = "is_zero_errors")]
    pub errors: [i64; 3],
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub samples: u32,
    /// 商会展望（ECONOMY.md 8.2，AI 提案或离线规则经 `SetOutlook` 记下）：对几种商品的看法、备忘与日期；没有时为空
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outlook: Option<crate::commerce::Outlook>,
}

fn is_zero_errors(v: &[i64; 3]) -> bool {
    *v == [0; 3]
}

fn is_zero_u32(v: &u32) -> bool {
    *v == 0
}

/// 资产所有者（玩家或商会）的状态。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Agent {
    pub owner: OwnerId,
    pub cash: Money,
    pub ledger: Ledger,
    pub book: InventoryBook,
    pub home: LocId,
    /// 连续现金为负的天数
    pub negative_days: u32,
    pub bankrupt: bool,
    /// 破产重组次数（玩家）
    pub reorganizations: u32,
    pub strategy: Option<Strategy>,
    /// 银行存款
    #[serde(default)]
    pub deposit: Money,
    #[serde(default)]
    pub credit: Credit,
    /// 对各势力的声望（−100–100）
    #[serde(default)]
    pub reputation: BTreeMap<FactionId, i64>,
    /// 持有许可证的势力
    #[serde(default)]
    pub licenses: Vec<FactionId>,
    /// 持有私掠许可的势力
    #[serde(default)]
    pub marques: Vec<FactionId>,
    /// 各地的议价成果
    #[serde(default)]
    pub bargains: BTreeMap<LocId, Bargain>,
    /// 交易能力带来的议价加成（由担任会计 / 交易员的航海士提供）
    #[serde(default)]
    pub trade_bonus: Fx,
    /// 名声（报告发现物、建立殖民地获得）：高等级航海士的招募门槛，也吸引殖民地移民
    #[serde(default)]
    pub fame: i64,
    /// 主角档案（只有玩家有；开局立下身世后才有，旧存档没有）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub captain: Option<crate::captain::CaptainProfile>,
    /// 对各势力累计而还没折成声望的成交额（T01，[`crate::access::trade_reputation`]；规则关闭时为空、不写进存档）
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub trade_turnover: BTreeMap<FactionId, Money>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub passes: Vec<crate::contract::GoodPass>,
}

/// 一艘船。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ship {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legend: Option<String>,
    pub kind: ShipTypeId,
    pub durability: i64,
    pub max_durability: i64,
    pub capacity: i64,
    pub guns: i64,
    pub speed_bonus: Fx,
    pub refits: Vec<RefitId>,
    /// 账面价值（买价 + 改造费）
    pub book_value: Money,
    /// 下水的日期（商会 2.0 的老船退役用；关闭时与旧存档为 0 = 开局就有）
    #[serde(default, skip_serializing_if = "is_zero_u32")]
    pub built: u32,
}

/// 航行中的状态。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Voyage {
    Route(RouteVoyage),
    Manual { manual: crate::navigation::ManualVoyage },
}

/// 旧航线的字段及序列化顺序保持不变。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RouteVoyage {
    pub dest: LocId,
    pub path: Vec<Cell>,
    /// 当前所在格在 path 中的下标
    pub step: usize,
    /// 在当前这一步上已花费的时间（天）
    pub leg_progress: Fx,
}

impl Voyage {
    pub fn cell(&self) -> Cell {
        match self {
            Self::Route(route) => route.path.get(route.step).copied().unwrap_or(Cell::new(0, 0)),
            Self::Manual { manual } => manual.pos.cell(),
        }
    }

    pub fn destination(&self) -> Option<LocId> {
        match self {
            Self::Route(route) => Some(route.dest),
            Self::Manual { manual } => manual.autopilot,
        }
    }
}

/// 舰队位置。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum FleetLocation {
    Docked(LocId),
    AtSea(Voyage),
}

/// 舰队（最多 5 艘船，航速取最慢者）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Fleet {
    pub id: FleetId,
    pub owner: OwnerId,
    pub ships: Vec<Ship>,
    pub crew: i64,
    /// 士气 0–100
    pub morale: i64,
    pub food: i64,
    pub water: i64,
    /// 未吃完的一格粮水内已消耗的人日；经典与旧档省略。
    #[serde(default, skip_serializing_if = "crate::fleet::SupplyRemainder::is_empty")]
    pub supply_remainder: crate::fleet::SupplyRemainder,
    pub cargo: BTreeMap<GoodId, i64>,
    pub location: FleetLocation,
    pub days_at_sea: u32,
    /// 在港闲置的天数（出航时清零）
    pub idle_days: u32,
    /// 商会 2.0：这一趟的计划（目的地、主货、出航时各方法的预测、套保），卖货时核对
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan: Option<crate::commerce::TradePlan>,
    /// 随船消息：从港口出航时带上的出发港行情，抵达时贴到告示板上（ECONOMY.md 第 7 节；只在随船传递模式下有）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub news: Option<crate::info::Snapshot>,
}

/// 舰队最多的船只数。
pub const MAX_SHIPS_PER_FLEET: usize = 5;

impl Fleet {
    pub fn docked_at(&self) -> Option<LocId> {
        match self.location {
            FleetLocation::Docked(l) => Some(l),
            FleetLocation::AtSea(_) => None,
        }
    }

    pub fn capacity(&self) -> i64 {
        self.ships.iter().map(|s| s.capacity).sum()
    }

    pub fn cargo_total(&self) -> i64 {
        self.cargo.values().sum()
    }

    /// 已用舱位：货物 + 粮 + 水。
    pub fn used(&self) -> i64 {
        self.cargo_total() + self.food + self.water
    }

    pub fn free_capacity(&self) -> i64 {
        (self.capacity() - self.used()).max(0)
    }

    pub fn crew_min(&self, defs: &StaticData) -> i64 {
        self.ships.iter().map(|s| crate::legend_ships::crew_min(defs, s)).sum()
    }

    pub fn crew_max(&self, defs: &StaticData) -> i64 {
        self.ships.iter().map(|s| crate::legend_ships::crew_max(defs, s)).sum()
    }

    /// 基础航速（最慢船的速度，未计风与洋流）。
    pub fn base_speed(&self, defs: &StaticData) -> Fx {
        self.ships.iter().map(|s| defs.ship(s.kind).speed + s.speed_bonus).min().unwrap_or(Fx::ONE)
    }

    pub fn cell(&self, defs: &StaticData) -> Cell {
        match &self.location {
            FleetLocation::Docked(l) => defs.loc(*l).cell,
            FleetLocation::AtSea(v) => v.cell(),
        }
    }

    pub fn book_value(&self) -> Money {
        self.ships.iter().map(|s| s.book_value).sum()
    }
}

/// 全部可变世界状态。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorldState {
    #[serde(default, skip_serializing_if = "crate::navigation::orders::NavigationState::is_empty")]
    pub navigation: crate::navigation::orders::NavigationState,
    /// 已完成的天数；下一个 tick 的编号
    pub day: u32,
    pub seed: u64,
    pub scenario: ScenarioId,
    /// 各地的状态（市场、仓库、投资……）。世界状态里最重的一块（寰宇里占八成五），包成写时复制：
    /// 整份世界拷一遍去试算（剧情选项、航行投影）时只拷一个指针，见 [`crate::shared`]。读写照 `Vec` 的写法。
    pub locations: crate::shared::Shared<Vec<LocationState>>,
    pub agents: BTreeMap<OwnerId, Agent>,
    pub fleets: BTreeMap<FleetId, Fleet>,
    pub next_fleet: u32,
    pub money: MoneyStats,
    pub log: Vec<LogEvent>,
    #[serde(default)]
    pub caravans: BTreeMap<CaravanId, Caravan>,
    #[serde(default)]
    pub next_caravan: u32,
    #[serde(default)]
    pub industries: BTreeMap<IndustryId, Industry>,
    #[serde(default)]
    pub next_industry: u32,
    #[serde(default)]
    pub contracts: BTreeMap<ContractId, TransportContract>,
    #[serde(default)]
    pub next_contract: u32,
    #[serde(default)]
    pub loans: BTreeMap<LoanId, Loan>,
    #[serde(default)]
    pub next_loan: u32,
    #[serde(default)]
    pub relations: Vec<Relation>,
    #[serde(default)]
    pub futures: FuturesState,
    #[serde(default)]
    pub events: EventState,
    #[serde(default)]
    pub news: NewsState,
    /// 航海士
    #[serde(default)]
    pub mates: BTreeMap<MateId, crate::mates::MateState>,
    /// 海盗与海战
    #[serde(default)]
    pub battles: crate::battle::BattleState,
    /// 玩家的探索进度（海图迷雾）
    #[serde(default)]
    pub explore: crate::explore::Exploration,
    /// 剧本胜负
    #[serde(default)]
    pub outcome: Option<crate::goals::Outcome>,
    /// 殖民地
    #[serde(default)]
    pub colonies: BTreeMap<ColonyId, crate::colony::Colony>,
    #[serde(default)]
    pub next_colony: u32,
    /// 剧情事件：推荐角色的故事线与奇遇（旧存档没有：读作什么都没发生过；什么都没发生过时不写进存档）
    #[serde(default, skip_serializing_if = "crate::story::StoryState::is_pristine")]
    pub story: crate::story::StoryState,
    #[serde(default, skip_serializing_if = "crate::items::ItemsState::is_empty")]
    pub items: crate::items::ItemsState,
    #[serde(default, skip_serializing_if = "crate::auction::AuctionState::is_empty")]
    pub auctions: crate::auction::AuctionState,
    #[serde(default, skip_serializing_if = "crate::cast::CastState::is_empty")]
    pub cast: crate::cast::CastState,
    #[serde(default, skip_serializing_if = "crate::story2::Story2State::is_empty")]
    pub story2: crate::story2::Story2State,
    /// 信息时效（ECONOMY.md 第 7 节）：行情情报的模式与各方所知的快照；实时模式下不写进存档
    #[serde(default, skip_serializing_if = "crate::info::InfoState::is_live")]
    pub info: crate::info::InfoState,
    /// 货币流通（ECONOMY.md 6.9）：城镇钱袋、国库、银行、腹地与经济月报；规则关闭时为空，不写进存档
    #[serde(default, skip_serializing_if = "crate::circulation::Circulation::is_off")]
    pub circulation: crate::circulation::Circulation,
    /// 结算进行到收盘之后为真（只在 `end_day` 里；不写进存档）：这时记下的行情包含当天的收盘
    #[serde(skip)]
    pub closed: bool,
    /// 有日期的开局才记录；经典第 0 天开局省略，保持旧状态字节。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub control_day: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub protagonist: Option<crate::scenario::ProtagonistIdentity>,
    /// 时间线与动态港口；未启用时整块省略。
    #[serde(default, skip_serializing_if = "crate::history::HistoryState::is_empty")]
    pub history: crate::history::HistoryState,
    #[serde(default, skip_serializing_if = "crate::ideas::IdeasState::is_empty")]
    pub ideas: crate::ideas::IdeasState,
    #[serde(default, skip_serializing_if = "crate::societies::SocietiesState::is_empty")]
    pub societies: crate::societies::SocietiesState,
    #[serde(default, skip_serializing_if = "crate::legend_ships::LegendShipsState::is_empty")]
    pub legend_ships: crate::legend_ships::LegendShipsState,
    #[serde(default, skip_serializing_if = "crate::realms::RealmsState::is_empty")]
    pub realms: crate::realms::RealmsState,
    #[serde(default, skip_serializing_if = "crate::lineages::LineagesState::is_empty")]
    pub lineages: crate::lineages::LineagesState,
    #[serde(default, skip_serializing_if = "crate::creatures::CreaturesState::is_empty")]
    pub creatures: crate::creatures::CreaturesState,
    #[serde(default, skip_serializing_if = "crate::arcana::ArcanaState::is_empty")]
    pub arcana: crate::arcana::ArcanaState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upbringing: Option<crate::upbringing::UpbringingState>,
    /// 事件节奏的闸（P11）：最近放行的打断、被按下的与出过场的事；规则关闭时为空，不写进存档
    #[serde(default, skip_serializing_if = "crate::pacing::PacingState::is_empty")]
    pub pacing: crate::pacing::PacingState,
    /// 商馆、货档与商誉（T01）：规则生效的日子与旧存档的宽限期；规则关闭时为空，不写进存档
    #[serde(default, skip_serializing_if = "crate::access::AccessState::is_empty")]
    pub access: crate::access::AccessState,
    /// 海上所见（H04）：规则关闭时为空，不写进存档
    #[serde(default, skip_serializing_if = "crate::sightings::SightingState::is_empty")]
    pub sightings: crate::sightings::SightingState,
    /// 喊话、结伴与休战（H06）：规则关闭时为空，不写进存档
    #[serde(default, skip_serializing_if = "crate::hail::HailState::is_empty")]
    pub hail: crate::hail::HailState,
    /// 航海日志的一程与航程总结（H08）：规则关闭时为空，不写进存档
    #[serde(default, skip_serializing_if = "crate::voyage_log::VoyageLogState::is_empty")]
    pub voyage_log: crate::voyage_log::VoyageLogState,
    /// 甲板闲话（H08）：规则关闭时为空，不写进存档
    #[serde(default, skip_serializing_if = "crate::banter::BanterState::is_empty")]
    pub banter: crate::banter::BanterState,
    /// 航线规划（H07）：在海上的出港记录与各对港口的航时纪录；规则关闭时为空，不写进存档
    #[serde(default, skip_serializing_if = "crate::navigation::routing::RoutingState::is_empty")]
    pub routing: crate::navigation::routing::RoutingState,
    /// 商馆的分红、遭劫与商会跟投（T02）：规则关闭时为空，不写进存档
    #[serde(default, skip_serializing_if = "crate::house::HouseState::is_empty")]
    pub house: crate::house::HouseState,
    /// 商馆代办的挂单与成交记录（T03）：规则关闭时为空，不写进存档
    #[serde(default, skip_serializing_if = "crate::agency::AgencyState::is_empty")]
    pub agency: crate::agency::AgencyState,
    /// 船况、口粮与船员状态（H02，按舰队编号；只有玩家的舰队）：规则关闭时为空，不写进存档
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub voyage: BTreeMap<FleetId, crate::seafaring::FleetWear>,
    /// 岸上差事与下网（H05）：规则关闭时为空，不写进存档
    #[serde(default, skip_serializing_if = "crate::seafaring::ShoreState::is_empty")]
    pub shore: crate::seafaring::ShoreState,
    /// E02：0 是旧尺度，1 是新尺度；旧存档缺省为 0。
    #[serde(default, skip_serializing_if = "crate::development::is_legacy")]
    pub dev_model: u8,
    /// R10-T04：航海期的首次小单已经补发；旧档缺省尚未补发。
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub contracts_started: bool,
    #[serde(default, skip_serializing_if = "crate::trade_books::TradeBooksState::is_empty")]
    pub books: crate::trade_books::TradeBooksState,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub unlocks: Vec<crate::stages::MarketUnlock>,
}

/// 最近事件日志保留的条数。
pub const LOG_KEPT: usize = 400;

/// 世界 = 静态数据 + 可变状态。
#[derive(Clone, Debug)]
pub struct World {
    pub defs: Arc<StaticData>,
    pub state: WorldState,
}

impl World {
    /// 按剧本开局。
    pub fn new(defs: Arc<StaticData>, scenario: ScenarioId, seed: u64) -> Result<World, CoreError> {
        Self::bootstrap(defs, scenario, seed, |_| {})
    }

    fn new_at(
        defs: Arc<StaticData>,
        scenario: ScenarioId,
        seed: u64,
        day: u32,
        with_player: bool,
    ) -> Result<World, CoreError> {
        let sc = defs.scenarios.get(scenario.idx()).ok_or(CoreError::UnknownScenario)?.clone();
        // 开放市场打开时，清单以外的商品补上只收不卖的进口条目（关闭时没有，与旧版一致）
        let extras = crate::open_market::extra_markets(&defs);
        let locations: Vec<LocationState> = defs
            .locations
            .iter()
            .zip(extras)
            .map(|(loc, extra)| {
                let mut market: BTreeMap<GoodId, MarketEntry> = loc
                    .market
                    .iter()
                    .filter(|m| !defs.rules.stage_unlocks.enabled || !loc.unlocks.iter().any(|u| u.good == m.good))
                    .map(|m| (m.good, crate::market::new_entry(&defs, m)))
                    .collect();
                for m in &extra {
                    market.insert(m.good, crate::market::new_extra_entry(&defs, m));
                }
                LocationState { market: market.into(), ..LocationState::fresh(loc.development) }
            })
            .collect();
        let mut world = World {
            defs: defs.clone(),
            state: WorldState {
                navigation: Default::default(),
                day,
                seed,
                scenario,
                locations: locations.into(),
                agents: BTreeMap::new(),
                fleets: BTreeMap::new(),
                next_fleet: 1,
                money: MoneyStats::default(),
                log: Vec::new(),
                caravans: BTreeMap::new(),
                next_caravan: 1,
                industries: BTreeMap::new(),
                next_industry: 1,
                contracts: BTreeMap::new(),
                next_contract: 1,
                loans: BTreeMap::new(),
                next_loan: 1,
                relations: Vec::new(),
                futures: FuturesState::default(),
                events: EventState::default(),
                news: NewsState::default(),
                mates: crate::mates::init_mates(&defs),
                battles: crate::battle::BattleState::default(),
                explore: crate::explore::Exploration::default(),
                outcome: None,
                colonies: BTreeMap::new(),
                next_colony: 1,
                story: crate::story::StoryState::default(),
                items: crate::items::ItemsState::default(),
                auctions: crate::auction::AuctionState::default(),
                cast: crate::cast::CastState::default(),
                story2: crate::story2::Story2State::default(),
                info: crate::info::InfoState::default(),
                circulation: crate::circulation::Circulation::default(),
                closed: false,
                control_day: Some(crate::scenario::day_of(&defs, sc.control_date)?).filter(|d| *d != 0),
                protagonist: None,
                history: crate::history::HistoryState::default(),
                ideas: crate::ideas::IdeasState::default(),
                societies: Default::default(),
                legend_ships: Default::default(),
                realms: Default::default(),
                lineages: Default::default(),
                creatures: Default::default(),
                arcana: Default::default(),
                upbringing: None,
                pacing: Default::default(),
                access: Default::default(),
                sightings: Default::default(),
                hail: Default::default(),
                voyage_log: Default::default(),
                banter: Default::default(),
                routing: Default::default(),
                house: Default::default(),
                agency: Default::default(),
                voyage: Default::default(),
                shore: Default::default(),
                dev_model: u8::from(defs.rules.development.enabled),
                contracts_started: false,
                books: Default::default(),
                unlocks: Vec::new(),
            },
        };
        world.init_access();
        if with_player {
            world.add_player(&sc)?;
        }
        for cid in defs.company_ids() {
            let c = defs.company(cid);
            let owner = OwnerId::Company(cid);
            let strategy = Strategy {
                risk: c.risk,
                preferred: c.preferred.clone(),
                method: None,
                errors: [0; 3],
                samples: 0,
                outlook: None,
            };
            world.add_agent(owner, c.home, c.cash, Some(strategy))?;
            let crew: i64 = c.ships.iter().map(|s| defs.ship(*s).crew_min * 5 / 4).sum();
            world.add_opening_fleet(owner, c.home, &c.ships, crew)?;
        }
        world.state.relations = crate::diplomacy::initial_relations(&defs);
        world.init_futures();
        world.recompute_modifiers();
        if with_player {
            world.apply_scenario_start();
            world.init_exploration();
        }
        world.init_people();
        world.init_circulation();
        world.state.money.initial = world.total_money();
        world.restock_items();
        world.auctions_day()?;
        world.init_history();
        world.cast_meet_here();
        world.refresh_story2();
        Ok(world)
    }

    fn add_player(&mut self, sc: &ScenarioDef) -> Result<(), CoreError> {
        self.add_agent(OwnerId::Player, sc.start_loc, sc.cash, None)?;
        if sc.upbringing {
            return Ok(());
        }
        let fleet = self.add_opening_fleet(OwnerId::Player, sc.start_loc, &sc.ships, sc.crew)?;
        self.load_opening_cargo(OwnerId::Player, fleet, sc)?;
        Ok(())
    }

    /// 剧本的开局货物与粮水。
    ///
    /// 货物作为出资按商品基准价记入存货（借：存货，贷：实收资本），存货簿同步记录数量与成本；
    /// 粮水与平时的补给一样不作为资产入账。现金不变，所以货币总量不受影响。
    /// 舱位不够时按剧本中的顺序装到满为止（数据校验保证装得下）。
    /// 剧本没有开局货物与粮水时什么都不做，旧剧本的开局状态与账本逐字节不变。
    fn load_opening_cargo(&mut self, owner: OwnerId, fleet: FleetId, sc: &ScenarioDef) -> Result<(), CoreError> {
        if sc.cargo.is_empty() && sc.food <= 0 && sc.water <= 0 {
            return Ok(());
        }
        let defs = self.defs.clone();
        let mut loaded: Vec<(GoodId, i64, Money)> = Vec::new();
        {
            let f = self.fleet_mut(fleet)?;
            for &(good, qty) in &sc.cargo {
                let q = qty.min(f.free_capacity());
                if q <= 0 {
                    continue;
                }
                *f.cargo.entry(good).or_insert(0) += q;
                loaded.push((good, q, defs.good(good).base_price * q));
            }
            f.food = sc.food.max(0).min(f.free_capacity());
            f.water = sc.water.max(0).min(f.free_capacity());
        }
        let value: Money = loaded.iter().map(|(_, _, cost)| *cost).sum();
        let opening_day = self.state.day;
        let agent = self.agent_mut(owner)?;
        for (good, qty, cost) in loaded {
            agent.book.add(good, qty, cost);
        }
        if value > 0 {
            agent.ledger.post(
                JournalEntry::new(opening_day, Memo::Opening, CashClass::Operating)
                    .dr(Account::Inventory, value)
                    .cr(Account::Capital, value),
            )?;
        }
        Ok(())
    }

    fn add_agent(
        &mut self,
        owner: OwnerId,
        home: LocId,
        cash: Money,
        strategy: Option<Strategy>,
    ) -> Result<(), CoreError> {
        let mut ledger = Ledger::new();
        ledger.post(
            JournalEntry::new(self.state.day, Memo::Opening, CashClass::Financing)
                .dr(Account::Cash, cash)
                .cr(Account::Capital, cash),
        )?;
        ledger.month.opening_cash = cash;
        ledger.year.opening_cash = cash;
        self.state.agents.insert(
            owner,
            Agent {
                owner,
                cash,
                ledger,
                book: InventoryBook::default(),
                home,
                negative_days: 0,
                bankrupt: false,
                reorganizations: 0,
                strategy,
                deposit: 0,
                credit: Credit::default(),
                reputation: BTreeMap::new(),
                licenses: Vec::new(),
                marques: Vec::new(),
                bargains: BTreeMap::new(),
                trade_bonus: Fx::ZERO,
                fame: 0,
                captain: None,
                trade_turnover: BTreeMap::new(),
                passes: Vec::new(),
            },
        );
        Ok(())
    }

    /// 开局船只作为出资计入账本（借：船只，贷：实收资本）。
    pub(crate) fn add_opening_fleet(
        &mut self,
        owner: OwnerId,
        at: LocId,
        ships: &[ShipTypeId],
        crew: i64,
    ) -> Result<FleetId, CoreError> {
        let ships: Vec<Ship> = ships
            .iter()
            .map(|k| {
                let mut ship = crate::fleet::new_ship(&self.defs, *k);
                ship.built = self.state.day;
                ship
            })
            .collect();
        let value: Money = ships.iter().map(|s| s.book_value).sum();
        let id = self.alloc_fleet_id();
        let crew_cap: i64 = ships.iter().map(|s| self.defs.ship(s.kind).crew_max).sum();
        let fleet = Fleet {
            id,
            owner,
            ships,
            crew: crew.min(crew_cap),
            morale: 100,
            food: 0,
            water: 0,
            supply_remainder: Default::default(),
            cargo: BTreeMap::new(),
            location: FleetLocation::Docked(at),
            days_at_sea: 0,
            idle_days: 0,
            plan: None,
            news: None,
        };
        self.state.fleets.insert(id, fleet);
        let opening_day = self.state.day;
        let agent = self.agent_mut(owner)?;
        agent.ledger.post(
            JournalEntry::new(opening_day, Memo::Opening, CashClass::Investing)
                .dr(Account::Ships, value)
                .cr(Account::Capital, value),
        )?;
        Ok(id)
    }

    pub fn alloc_fleet_id(&mut self) -> FleetId {
        let id = FleetId(self.state.next_fleet);
        self.state.next_fleet += 1;
        id
    }

    /// 从快照恢复世界，检查快照与静态数据是否匹配。
    pub fn from_snapshot(defs: Arc<StaticData>, state: WorldState) -> Result<World, CoreError> {
        if state.locations.len() > defs.locations.len() {
            return Err(CoreError::SnapshotMismatch(format!(
                "存档有 {} 个地点，当前数据只有 {} 个",
                state.locations.len(),
                defs.locations.len()
            )));
        }
        let mut world = World { defs, state };
        world.validate_item_snapshot()?;
        world.validate_auction_snapshot()?;
        world.validate_cast_snapshot()?;
        world.validate_story2_snapshot()?;
        world.validate_navigation_snapshot()?;
        let per = world.defs.rules.crew_per_supply_unit;
        for f in world.state.fleets.values() {
            let r = &f.supply_remainder;
            if r.food < 0
                || r.water < 0
                || r.food >= per
                || r.water >= per
                || (!world.defs.rules.fractional_supplies && !r.is_empty())
                || (f.food == 0 && r.food != 0)
                || (f.water == 0 && r.water != 0)
            {
                return Err(CoreError::Save("补给余数无效".into()));
            }
        }
        world.validate_history_snapshot()?;
        world.validate_ideas_snapshot()?;
        world.validate_societies_snapshot()?;
        world.validate_legend_ships_snapshot()?;
        world.validate_legend_combat()?;
        world.validate_realms_snapshot()?;
        world.validate_lineages_snapshot()?;
        world.validate_creatures_snapshot()?;
        world.validate_arcana_snapshot()?;
        world.validate_upbringing_snapshot()?;
        world.validate_pacing_snapshot()?;
        world.reconcile();
        world.restock_items();
        world.auctions_day()?;
        world.init_history();
        Ok(world)
    }

    /// 让状态与静态数据对齐：为新增的地点与市场条目补上初始状态，修正地图重做后停在或将驶过陆地的海上单位，
    /// 把迷雾位图重映射到当前地图。
    fn reconcile(&mut self) {
        self.reconcile_development();
        self.reconcile_items();
        self.reconcile_auctions();
        self.reconcile_cast();
        self.reconcile_story2();
        self.reconcile_upbringing();
        let defs = self.defs.clone();
        // 开放市场打开时：旧存档补上只收不卖的进口条目（库存取均衡值）；关闭时这里是空的
        let extras = crate::open_market::extra_markets(&defs);
        let open = defs.rules.open_market.enabled;
        for (i, loc) in defs.locations.iter().enumerate() {
            if i >= self.state.locations.len() {
                self.state.locations.push(LocationState::fresh(loc.development));
            }
            let ls = &mut self.state.locations[i];
            for m in &loc.market {
                if !crate::stages::market_open(&defs, &self.state.unlocks, LocId::from_idx(i), m.good) {
                    continue;
                }
                ls.market.entry(m.good).or_insert_with(|| crate::market::new_entry(&defs, m));
            }
            if open {
                for m in extras.get(i).into_iter().flatten() {
                    ls.market.entry(m.good).or_insert_with(|| crate::market::new_extra_entry(&defs, m));
                }
                // “只收不卖”的标记跟着当前的市场清单（后来清单里加进或移出了某种商品）
                for (g, e) in ls.market.iter_mut() {
                    e.extra = loc.listed(*g).is_none();
                }
            }
        }
        // 旧存档没有外交关系与期货交易所：补上初始状态（做市方资本计入初始货币总量）
        if self.state.relations.is_empty() {
            self.state.relations = crate::diplomacy::initial_relations(&defs);
        }
        if self.state.futures.house.is_empty() && !defs.exchanges.is_empty() {
            let capital: Money = defs.exchanges.iter().map(|e| e.house_capital).sum();
            self.init_futures();
            self.state.money.initial += capital;
        }
        // 旧存档没有航海士与探索进度：航海士都在酒馆等待招募，迷雾按玩家当前位置初始化
        for (id, m) in crate::mates::init_mates(&defs) {
            self.state.mates.entry(id).or_insert(m);
        }
        if self.state.next_colony == 0 {
            self.state.next_colony = self.state.colonies.keys().map(|c| c.0 + 1).max().unwrap_or(1);
        }
        // 地图重做后（EXPANSION §10.2）：海上舰队与海盗若停在或将驶过已变成陆地的格子，重新寻路或移回海上
        self.reroute_fleets_at_sea();
        self.relocate_stranded_pirates();
        self.remap_exploration();
        self.init_exploration();
        // 旧存档的进行中事件没有记录效果：按事件类型补上
        self.fill_event_effects();
        // 人口规则打开而存档里还没有人口：从头一年学起（ECONOMY.md 6.4）
        self.init_people();
        // 货币流通打开而存档里还没有账户：开钱袋、国库与银行（ECONOMY.md 6.9）
        self.init_circulation();
        // 货档规则打开而存档里没有这套状态（旧存档）：从今天算起，给一段宽限期（T01）
        self.reconcile_access();
        self.recompute_modifiers();
        self.refresh_trade_bonus();
    }

    pub fn day(&self) -> u32 {
        self.state.day
    }

    pub fn season(&self) -> Season {
        self.defs.calendar.season_of(self.state.day)
    }

    pub fn agent(&self, owner: OwnerId) -> Result<&Agent, CoreError> {
        self.state.agents.get(&owner).ok_or(CoreError::UnknownOwner(owner))
    }

    pub fn agent_mut(&mut self, owner: OwnerId) -> Result<&mut Agent, CoreError> {
        self.state.agents.get_mut(&owner).ok_or(CoreError::UnknownOwner(owner))
    }

    pub fn fleet(&self, id: FleetId) -> Result<&Fleet, CoreError> {
        self.state.fleets.get(&id).ok_or(CoreError::UnknownFleet(id))
    }

    pub fn fleet_mut(&mut self, id: FleetId) -> Result<&mut Fleet, CoreError> {
        self.state.fleets.get_mut(&id).ok_or(CoreError::UnknownFleet(id))
    }

    pub fn fleets_of(&self, owner: OwnerId) -> impl Iterator<Item = &Fleet> {
        self.state.fleets.values().filter(move |f| f.owner == owner)
    }

    pub fn market(&self, loc: LocId, good: GoodId) -> Option<&MarketEntry> {
        if !self.location_open(loc) {
            return None;
        }
        self.state.locations.get(loc.idx())?.market.get(&good)
    }

    pub fn market_mut(&mut self, loc: LocId, good: GoodId) -> Option<&mut MarketEntry> {
        self.state.locations.get_mut(loc.idx())?.market.get_mut(&good)
    }

    /// 世界货币总量：全部参与者持有的现金。
    /// 世界货币总量：全部参与者的现金 + 期货保证金账户 + 做市方账户。
    pub fn total_money(&self) -> Money {
        self.state.agents.values().map(|a| a.cash).sum::<Money>() + self.futures_money() + self.agency_money()
    }

    /// 某所有者的总资产（账面）。
    pub fn total_assets(&self, owner: OwnerId) -> Money {
        self.state.agents.get(&owner).map(|a| a.ledger.total_assets()).unwrap_or(0)
    }

    /// 状态哈希：对规范化序列化结果计算 blake3（附带静态数据哈希）。
    pub fn state_hash(&self) -> String {
        state_hash(&self.defs.meta.hash, &self.state)
    }

    pub fn push_log(&mut self, event: LogEvent) {
        self.record_log_deed(&event.kind);
        self.state.log.push(event);
        if self.state.log.len() > LOG_KEPT {
            let excess = self.state.log.len() - LOG_KEPT;
            self.state.log.drain(0..excess);
        }
    }
}

/// 计算状态哈希。序列化只涉及结构体与有序映射，结果与平台无关。
pub fn state_hash(data_hash: &str, state: &WorldState) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(data_hash.as_bytes());
    match serde_json::to_vec(state) {
        Ok(bytes) => {
            hasher.update(&bytes);
        }
        Err(e) => {
            hasher.update(e.to_string().as_bytes());
        }
    }
    hasher.finalize().to_hex().to_string()
}
