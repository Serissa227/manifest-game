//! 内核错误类型。

use crate::fixed::Money;
use crate::ids::{FleetId, OwnerId};
use crate::ledger::LedgerError;
use crate::text::TextArg;
use std::fmt;

/// 内核错误。
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum CoreError {
    #[error("未知的开局剧本")]
    UnknownScenario,
    #[error("未知的所有者：{0:?}")]
    UnknownOwner(OwnerId),
    #[error("未知的舰队：{0:?}")]
    UnknownFleet(FleetId),
    #[error(transparent)]
    Ledger(#[from] LedgerError),
    #[error("存档与当前数据不匹配：{0}")]
    SnapshotMismatch(String),
    #[error("存档格式错误：{0}")]
    Save(String),
    #[error("内部错误：{0}")]
    Internal(String),
    /// v5：不能把另一个世界的数字 ID 解释为当前世界的内容。
    #[error("存档属于世界“{saved}”，当前加载的是“{current}”（save.world_mismatch）")]
    WorldMismatch { saved: String, current: String },
    #[error("开局参数无效：{0}")]
    InvalidStart(String),
    #[error("养成日程或事件正在等待玩家回应")]
    UpbringingPaused,
}

impl CoreError {
    /// 稳定错误码，供应用层读档错误提示使用。
    pub fn code(&self) -> &'static str {
        match self {
            Self::UnknownScenario => "unknown_scenario",
            Self::UnknownOwner(_) => "unknown_owner",
            Self::UnknownFleet(_) => "unknown_fleet",
            Self::Ledger(_) => "ledger",
            Self::SnapshotMismatch(_) => "save.mismatch",
            Self::Save(_) => "save.invalid",
            Self::Internal(_) => "internal",
            Self::WorldMismatch { .. } => "save.world_mismatch",
            Self::InvalidStart(_) => "invalid_start",
            Self::UpbringingPaused => "upbringing.paused",
        }
    }
}

/// 命令校验或执行失败的原因。
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum CommandError {
    #[error("找不到指定的对象：{0}")]
    NotFound(String),
    #[error("不是该资产的所有者")]
    NotOwner,
    #[error("所有者已破产")]
    Bankrupt,
    #[error("舰队不在港内")]
    NotDocked,
    #[error("舰队不在该地点")]
    WrongLocation,
    #[error("目的地不是港口")]
    NotAPort,
    #[error("已经在目的地")]
    SameLocation,
    #[error("没有可达的航线")]
    NoRoute,
    #[error("该地不交易这种商品")]
    NotTraded,
    /// 开放市场：这里收购这种商品，但不出售（出售的以当地特产为主）
    #[error("这里不出售这种货：只收购，出售的以本地特产为主")]
    NotSoldHere,
    #[error("数量无效")]
    InvalidQuantity,
    #[error("库存不足：只有 {available}")]
    InsufficientStock { available: i64 },
    #[error("现金不足：需要 {need}，现有 {have}")]
    InsufficientCash { need: Money, have: Money },
    #[error("舱位不足：需要 {need}，剩余 {free}")]
    InsufficientCapacity { need: i64, free: i64 },
    #[error("货物不足：只有 {have}")]
    InsufficientCargo { have: i64 },
    #[error("船员不足：至少需要 {need}，现有 {have}")]
    CrewBelowMinimum { need: i64, have: i64 },
    #[error("超过船员上限 {max}")]
    CrewOverMaximum { max: i64 },
    #[error("此地没有出售该船型的船厂")]
    NoShipyard,
    #[error("舰队已满（最多 5 艘）")]
    FleetFull,
    #[error("不能卖掉舰队的最后一艘船")]
    LastShip,
    #[error("船只无需修理")]
    NotDamaged,
    #[error("该改造已经做过")]
    RefitApplied,
    #[error("成交总额 {total} 超出限价 {limit}")]
    PriceLimit { total: Money, limit: Money },
    #[error("参数超出允许范围：{0}")]
    OutOfRange(String),
    #[error("不满足条件：{0}")]
    Precondition(String),
    #[error("内部错误：{0}")]
    Internal(String),
    /// 不满足条件（带错误码）：显示与 `Precondition` 完全相同，界面可按语言重新格式化
    #[error("不满足条件：{0}")]
    Rule(Reason),
    /// 参数超出允许范围（带错误码）：显示与 `OutOfRange` 完全相同，界面可按语言重新格式化
    #[error("参数超出允许范围：{0}")]
    Range(Reason),
}

/// 带错误码的原因（EXPANSION.md §12.1）：中文原文 + 错误码与参数。
///
/// 中文原文就是原来的提示文字（`Display` 不变，命令行与旧测试照常使用）；
/// 界面按错误码与参数用当前语言重新格式化（英文模板见 `data/locales/en/texts.toml` 的 `[reasons]`）。
/// 全部错误码与参数名列在 [`REASON_CODES`] 中。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reason {
    pub code: &'static str,
    pub args: Vec<(&'static str, TextArg)>,
    pub zh: String,
}

impl Reason {
    pub fn new(code: &'static str, zh: impl Into<String>) -> Reason {
        debug_assert!(reason_args(code).is_some(), "错误码 {code} 没有列在 REASON_CODES 中");
        Reason { code, args: Vec::new(), zh: zh.into() }
    }

    /// 追加一个参数（参数名须列在 [`REASON_CODES`] 中）。
    pub fn arg(mut self, name: &'static str, value: TextArg) -> Reason {
        debug_assert!(
            reason_args(self.code).is_some_and(|a| a.contains(&name)),
            "错误码 {} 没有参数 {name}",
            self.code
        );
        self.args.push((name, value));
        self
    }

    /// 作为“不满足条件”的命令错误。
    pub fn rule(self) -> CommandError {
        CommandError::Rule(self)
    }

    /// 作为“参数超出范围”的命令错误。
    pub fn range(self) -> CommandError {
        CommandError::Range(self)
    }
}

impl fmt::Display for Reason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.zh)
    }
}

/// 全部错误码及其参数名（界面的英文模板只能使用这些参数；`data/texts.toml` 与英文覆盖须逐一列出）。
pub const REASON_CODES: &[(&str, &[&str])] = &[
    ("fleet.in_battle", &[]),
    ("trade.license", &[]),
    ("max_level", &[]),
    ("bank.withdraw_range", &["max"]),
    ("bank.term_range", &["max"]),
    ("bank.over_limit", &["limit"]),
    ("bank.repay_range", &["max"]),
    ("battle.invalid_order", &[]),
    ("caravan.no_road", &[]),
    ("caravan.guards_range", &["max"]),
    ("caravan.unload_first", &[]),
    ("colony.no_site", &[]),
    ("colony.not_site", &[]),
    ("colony.claimed", &["faction"]),
    ("colony.occupied", &[]),
    ("colony.unexplored", &[]),
    ("colony.max_colonies", &["max"]),
    ("colony.name_length", &[]),
    ("colony.min_settlers", &["min"]),
    ("colony.found_material", &["good", "qty", "have"]),
    ("colony.busy", &[]),
    ("colony.no_resource", &[]),
    ("colony.build_material", &["good", "qty", "have"]),
    ("colony.tax_range", &["max"]),
    ("colony.dock_resupply", &[]),
    ("colony.dock_repair", &[]),
    ("colony.no_crew", &[]),
    ("colony.keep_one", &["population", "max"]),
    ("port.no_hands", &["population", "max"]),
    ("colony.no_facility", &[]),
    ("contract.unavailable", &[]),
    ("contract.expired", &[]),
    ("contract.reputation", &[]),
    ("contract.not_yours", &[]),
    ("office.has_license", &[]),
    ("office.reputation", &["need"]),
    ("office.no_war", &[]),
    ("office.has_marque", &[]),
    ("office.negative_reputation", &[]),
    ("explore.not_found", &[]),
    ("explore.reported", &[]),
    ("explore.presence", &[]),
    ("explore.has_chart", &[]),
    ("explore.chart_port", &[]),
    ("info.mode_start", &[]),
    ("info.live", &[]),
    ("info.report_port", &[]),
    ("info.report_nothing", &[]),
    ("policy.export_ban", &[]),
    ("futures.expired", &[]),
    ("futures.position_limit", &["max"]),
    ("futures.margin", &["need", "balance"]),
    ("futures.withdraw", &["free"]),
    ("futures.no_position", &[]),
    ("industry.specialty", &[]),
    ("industry.recipe", &[]),
    ("industry.warehouse", &[]),
    ("invest.min", &["min"]),
    ("mates.hired", &[]),
    ("mates.presence", &[]),
    ("mates.fame", &["need", "have"]),
    ("bargain.presence", &[]),
    ("warehouse.shrink", &[]),
    // 独有船型与隐藏的航海士
    ("shipyard.unique", &[]),
    ("shipyard.unique_sell", &[]),
    ("mates.hidden", &[]),
    ("captain.disabled", &[]),
    ("captain.exists", &[]),
    ("captain.birthday", &["min", "max"]),
    ("captain.answers", &[]),
    ("captain.points", &["free"]),
    ("captain.cap", &["cap"]),
    ("captain.genius", &["numeracy"]),
    // 剧情事件：推荐角色的故事线与奇遇
    ("story.no_event", &[]),
    ("story.bad_choice", &[]),
    ("frozen_port", &[]),
    ("frozen_region", &[]),
    ("auction.unknown", &[]),
    ("auction.unknown_lot", &[]),
    ("auction.not_open", &[]),
    ("auction.not_bidding", &[]),
    ("auction.low_bid", &[]),
    ("auction.no_inspection", &[]),
    ("auction.inspected", &[]),
    // 第九批：手动航行与当天分钟命令。
    ("navigation.disabled", &[]),
    ("navigation.not_manual", &[]),
    ("navigation.minute", &[]),
    ("navigation.past", &[]),
    ("navigation.heading", &[]),
    ("navigation.empty_steer", &[]),
    ("navigation.queue_full", &[]),
    ("navigation.not_docked", &[]),
    ("navigation.arrived", &[]),
    ("navigation.manual_only", &[]),
    // 第九批：寰宇的休眠港口与发现条件。
    ("port.not_open", &[]),
    ("explore.requirements", &[]),
    ("navigation.unknown_dest", &[]),
    ("navigation.unknown_route", &[]),
    ("landing.days", &[]),
    ("landing.coast", &[]),
    ("landing.supplies", &[]),
    ("landing.active", &[]),
    // 第九批 A8 的固定原因码，仅在末尾追加。
    ("arcana.cash", &[]),
    ("arcana.cooldown", &[]),
    ("arcana.fleet", &[]),
    ("arcana.intel_permission", &[]),
    ("arcana.invalid_cost", &[]),
    ("arcana.limit", &[]),
    ("arcana.materials", &[]),
    ("arcana.player_only", &[]),
    ("arcana.requirements", &[]),
    ("arcana.target", &[]),
    ("arcana.unknown", &[]),
    ("arcana.unknown_event", &[]),
    ("creature.fleet", &[]),
    ("creature.no_encounter", &[]),
    ("creature.player_only", &[]),
    ("creature.resolved", &[]),
    ("creature.response", &[]),
    ("legend_ship.away", &[]),
    ("legend_ship.blueprint", &[]),
    ("legend_ship.cash", &[]),
    ("legend_ship.dive_anchor", &[]),
    ("legend_ship.dive_done", &[]),
    ("legend_ship.hull", &[]),
    ("legend_ship.limit", &[]),
    ("legend_ship.materials", &[]),
    ("legend_ship.oracle_month", &[]),
    ("legend_ship.player_only", &[]),
    ("legend_ship.port", &[]),
    ("legend_ship.shipyard", &[]),
    ("legend_ship.track", &[]),
    ("legend_ship.unknown", &[]),
    ("legend_ship.unrecoverable", &[]),
    ("lineage.disabled", &[]),
    ("lineage.no_reversal", &[]),
    ("lineage.story_only", &[]),
    ("lineage.unknown", &[]),
    ("realm.away", &[]),
    ("realm.iron_ashore", &[]),
    ("realm.key", &[]),
    ("realm.unknown", &[]),
    ("society.away", &[]),
    ("society.contact", &[]),
    ("society.inactive", &[]),
    ("society.member", &[]),
    ("society.player_only", &[]),
    ("society.requirements", &[]),
    ("society.unknown", &[]),
    // 第九批 T01：货档与商誉（只在末尾追加）。
    ("trade.rank", &["need", "have", "short"]),
    // 第九批 H07：航线规划（只在末尾追加）。
    ("navigation.no_navigator", &[]),
    // 2026-11-12 最后一轮全量补登：H04 海上所见、H06 喊话、H08 甲板闲话、T03 产业位、H02 船况的错误码
    // 当时没有登记（`Reason::new` 里的 debug_assert 只在 debug 构建报错，release 全量看不出来）。参数名照调用处。
    ("sighting.apply", &[]),
    ("sighting.choice", &[]),
    ("sighting.def", &[]),
    ("sighting.disabled", &[]),
    ("sighting.far", &[]),
    ("sighting.item", &[]),
    ("sighting.missing", &[]),
    ("hail.action", &[]),
    ("hail.apply", &[]),
    ("hail.days", &[]),
    ("hail.disabled", &[]),
    ("hail.far", &[]),
    ("hail.used", &[]),
    ("banter.def", &[]),
    ("banter.disabled", &[]),
    ("banter.done", &[]),
    ("banter.none", &[]),
    ("banter.reply", &[]),
    ("industry.slots", &[]),
    ("voyage.alert", &[]),
    ("voyage.clean", &[]),
    ("voyage.disabled", &[]),
    ("voyage.jettison_docked", &[]),
    ("voyage.timber_room", &["max"]),
    ("legend_ship.witness", &[]),
    ("legend_ship.granted", &[]),
    ("legend_ship.upbringing", &[]),
    ("market.reserved", &[]),
    ("ub.act.off", &[]),
    ("ub.act.phase", &["phase"]),
    ("ub.act.story", &[]),
    ("ub.act.slots", &["need", "have"]),
    ("ub.act.line", &["slot"]),
    ("ub.act.tier", &["slot"]),
    ("ub.act.with", &["slot"]),
    ("ub.act.absent", &["slot"]),
    ("ub.act.monthly_limit", &["slot"]),
    ("ub.act.fee", &["need", "have"]),
    ("ub.act.template", &[]),
    ("ub.act.place", &[]),
    ("ub.act.action", &[]),
    ("ub.act.points", &["need", "have"]),
    ("ub.act.greeted", &[]),
    ("ub.act.item", &[]),
    ("ub.act.job", &[]),
    ("ub.act.marker", &[]),
    ("ub.act.self_study", &[]),
    ("ub.act.excursion", &[]),
    ("ub.act.stage_off", &["stage"]),
    ("ub.act.duty", &[]),
    ("ub.act.duty_done", &[]),
    ("ub.act.shop", &[]),
    ("ub.act.use_action", &[]),
    ("trade.rare_quota", &["left", "limit"]),
    ("ub.act.moment", &[]),
    ("ub.act.master", &["missing"]),
    ("ub.act.master_done", &[]),
    ("ub.act.master_play", &[]),
    ("ub.act.ill", &[]),
    ("navigation.supplies_low", &[]),
    ("ub.act.free_marker", &[]),
    ("ub.act.rumor_none", &[]),
    ("ub.act.tide_closed", &["node"]),
    ("ub.act.voyage", &[]),
    ("ub.act.voyage_join", &["missing"]),
    ("ub.act.voyage_closed", &[]),
    ("ub.act.template_empty", &[]),
    ("ub.act.marker_requirements", &[]),
];

/// 某错误码的参数名。
pub fn reason_args(code: &str) -> Option<&'static [&'static str]> {
    REASON_CODES.iter().find(|(c, _)| *c == code).map(|(_, a)| *a)
}

/// 固定原因的错误码及其参数名（与 [`CommandError::code`] 一致）。
pub const ERROR_CODES: &[(&str, &[&str])] = &[
    ("not_found", &["detail"]),
    ("not_owner", &[]),
    ("bankrupt", &[]),
    ("not_docked", &[]),
    ("wrong_location", &[]),
    ("not_a_port", &[]),
    ("same_location", &[]),
    ("no_route", &[]),
    ("not_traded", &[]),
    ("not_sold_here", &[]),
    ("invalid_quantity", &[]),
    ("insufficient_stock", &["available"]),
    ("insufficient_cash", &["need", "have"]),
    ("insufficient_capacity", &["need", "free"]),
    ("insufficient_cargo", &["have"]),
    ("crew_below_minimum", &["need", "have"]),
    ("crew_over_maximum", &["max"]),
    ("no_shipyard", &[]),
    ("fleet_full", &[]),
    ("last_ship", &[]),
    ("not_damaged", &[]),
    ("refit_applied", &[]),
    ("price_limit", &["total", "limit"]),
    ("out_of_range", &["detail"]),
    ("precondition", &["detail"]),
    ("internal", &["detail"]),
];

impl CommandError {
    /// 错误码：固定原因为变体名（如 `insufficient_cash`，见 [`ERROR_CODES`]），
    /// 带错误码的原因为其错误码（如 `colony.busy`，见 [`REASON_CODES`]）。界面按它取当前语言的文字。
    pub fn code(&self) -> &'static str {
        match self {
            CommandError::NotFound(_) => "not_found",
            CommandError::NotOwner => "not_owner",
            CommandError::Bankrupt => "bankrupt",
            CommandError::NotDocked => "not_docked",
            CommandError::WrongLocation => "wrong_location",
            CommandError::NotAPort => "not_a_port",
            CommandError::SameLocation => "same_location",
            CommandError::NoRoute => "no_route",
            CommandError::NotTraded => "not_traded",
            CommandError::NotSoldHere => "not_sold_here",
            CommandError::InvalidQuantity => "invalid_quantity",
            CommandError::InsufficientStock { .. } => "insufficient_stock",
            CommandError::InsufficientCash { .. } => "insufficient_cash",
            CommandError::InsufficientCapacity { .. } => "insufficient_capacity",
            CommandError::InsufficientCargo { .. } => "insufficient_cargo",
            CommandError::CrewBelowMinimum { .. } => "crew_below_minimum",
            CommandError::CrewOverMaximum { .. } => "crew_over_maximum",
            CommandError::NoShipyard => "no_shipyard",
            CommandError::FleetFull => "fleet_full",
            CommandError::LastShip => "last_ship",
            CommandError::NotDamaged => "not_damaged",
            CommandError::RefitApplied => "refit_applied",
            CommandError::PriceLimit { .. } => "price_limit",
            CommandError::OutOfRange(_) => "out_of_range",
            CommandError::Precondition(_) => "precondition",
            CommandError::Internal(_) => "internal",
            CommandError::Rule(r) | CommandError::Range(r) => r.code,
        }
    }

    /// 错误的参数（名称 → 值）。没有错误码的文字原因以 `detail` 给出中文原文。
    pub fn args(&self) -> Vec<(&'static str, TextArg)> {
        let int = TextArg::Int;
        match self {
            CommandError::NotFound(s)
            | CommandError::OutOfRange(s)
            | CommandError::Precondition(s)
            | CommandError::Internal(s) => vec![("detail", TextArg::Text(s.clone()))],
            CommandError::InsufficientStock { available } => vec![("available", int(*available))],
            CommandError::InsufficientCash { need, have } => vec![("need", int(*need)), ("have", int(*have))],
            CommandError::InsufficientCapacity { need, free } => vec![("need", int(*need)), ("free", int(*free))],
            CommandError::InsufficientCargo { have } => vec![("have", int(*have))],
            CommandError::CrewBelowMinimum { need, have } => vec![("need", int(*need)), ("have", int(*have))],
            CommandError::CrewOverMaximum { max } => vec![("max", int(*max))],
            CommandError::PriceLimit { total, limit } => vec![("total", int(*total)), ("limit", int(*limit))],
            CommandError::Rule(r) | CommandError::Range(r) => r.args.clone(),
            _ => Vec::new(),
        }
    }

    /// 带错误码的原因（没有时为 None）。
    pub fn reason(&self) -> Option<&Reason> {
        match self {
            CommandError::Rule(r) | CommandError::Range(r) => Some(r),
            _ => None,
        }
    }
}

impl From<CoreError> for CommandError {
    fn from(e: CoreError) -> Self {
        match e {
            CoreError::UnknownFleet(f) => CommandError::NotFound(format!("{f:?}")),
            CoreError::UnknownOwner(o) => CommandError::NotFound(format!("{o:?}")),
            other => CommandError::Internal(other.to_string()),
        }
    }
}

impl From<LedgerError> for CommandError {
    fn from(e: LedgerError) -> Self {
        CommandError::Internal(e.to_string())
    }
}
