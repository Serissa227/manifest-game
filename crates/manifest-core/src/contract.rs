//! 委托运输合同：把某货物在期限内送到某地，完成有报酬，违约有罚金与声望损失。
//!
//! 合同由势力按规则每月发布（也可由经过裁决的 AI 提案发布）。报酬由发布方势力支付（外部来源），
//! 罚金付给发布方（外部去向）。

use crate::circulation::Sector;
use crate::error::{CommandError, CoreError};
use crate::fixed::{Fx, Money, mul_div};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::rng::{Domain, Rng};
use crate::treasury::Flow;
use crate::warehouse::Holder;
use crate::world::World;
use serde::{Deserialize, Serialize};

/// R10-T04：按贸易距离与期限计算委托；缺省关闭。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ContractV2Rules {
    pub enabled: bool,
    pub premium_pct: i64,
    pub urgent_pct: i64,
    pub slack_pct: [i64; 2],
    pub ref_speed: i64,
    pub handling_days: u32,
    pub min_cells: i64,
    pub small_per_month: u32,
    pub small_value: [Money; 2],
    pub small_qty: [i64; 2],
    pub small_reputation: i64,
    pub pass_days: u32,
    pub reward_turnover: bool,
    pub reserve_market: bool,
    pub small_min_cells: i64,
}

impl Default for ContractV2Rules {
    fn default() -> Self {
        Self {
            enabled: false,
            premium_pct: 30,
            urgent_pct: 50,
            slack_pct: [150, 300],
            ref_speed: 4,
            handling_days: 4,
            min_cells: 6,
            small_per_month: 1,
            small_value: [1500, 3500],
            small_qty: [5, 40],
            small_reputation: 3,
            pass_days: 90,
            reward_turnover: true,
            reserve_market: false,
            small_min_cells: 6,
        }
    }
}

impl ContractV2Rules {
    pub fn problems(&self, monthly: u32) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        for (key, valid) in [
            ("premium_pct", (0..=200).contains(&self.premium_pct)),
            ("urgent_pct", (0..=200).contains(&self.urgent_pct)),
            (
                "slack_pct",
                self.slack_pct[0] >= 100 && self.slack_pct[1] <= 600 && self.slack_pct[0] <= self.slack_pct[1],
            ),
            ("ref_speed", self.ref_speed >= 1),
            ("handling_days", self.handling_days <= 30),
            ("min_cells", self.min_cells >= 0),
            ("small_per_month", self.small_per_month <= monthly),
            ("small_value", self.small_value[0] > 0 && self.small_value[0] <= self.small_value[1]),
            ("small_qty", self.small_qty[0] > 0 && self.small_qty[0] <= self.small_qty[1]),
            ("small_reputation", self.small_reputation >= 0),
            ("small_min_cells", (1..=20).contains(&self.small_min_cells)),
        ] {
            if !valid {
                out.push((key, "委托规则超出允许范围"));
            }
        }
        out
    }
}

fn is_zero<T: Default + PartialEq>(v: &T) -> bool {
    *v == T::default()
}

/// 完成委托后，在发布方势力内有效的货档放行；until 为不含的截止日。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoodPass {
    pub faction: FactionId,
    pub good: GoodId,
    pub until: u32,
}

/// 合同状态。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ContractStatus {
    Open,
    Accepted(OwnerId),
    Completed(OwnerId),
    Failed(OwnerId),
    Expired,
}

/// 合同来源。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ContractSource {
    Rule,
    Ai,
}

/// 委托运输合同。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransportContract {
    pub id: ContractId,
    pub issuer: FactionId,
    pub good: GoodId,
    pub qty: i64,
    pub to: LocId,
    /// 截止日（含）
    pub deadline: u32,
    pub reward: Money,
    pub penalty: Money,
    pub status: ContractStatus,
    pub source: ContractSource,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub small: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_port: Option<LocId>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub cells: i64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub need_days: u32,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub urgency_bp: i64,
}

/// 合同的公允报酬：货值 × 系数 × (1 + 天数/30)。只依赖静态数据。
pub fn fair_reward(defs: &crate::defs::StaticData, good: GoodId, qty: i64, days: i64) -> Money {
    let rules = &defs.rules.contracts;
    let value = defs.good(good).base_price * qty;
    let f = rules.reward_factor.mul(Fx::ONE + Fx::ratio(days.max(0), 30));
    f.apply(value)
}

/// 最近的出售地点；同距离按地点编号取第一处，不包含目的港。
pub fn nearest_source(defs: &crate::StaticData, good: GoodId, to: LocId) -> Option<(LocId, i64)> {
    defs.locations
        .iter()
        .enumerate()
        .filter_map(|(i, l)| {
            let source = LocId::from_idx(i);
            if source == to
                || !l.market.iter().any(|m| m.good == good)
                || !crate::open_market::sells(defs, source, good)
            {
                return None;
            }
            let cells = *defs.trade_dist.get(i)?.get(to.idx())?;
            (cells != u16::MAX).then_some((source, i64::from(cells)))
        })
        .min_by_key(|(loc, cells)| (*cells, *loc))
}

/// 从目的港出发、买货后送回的参考天数。
pub fn need_days(defs: &crate::StaticData, cells: i64) -> u32 {
    let r = &defs.rules.contracts.v2;
    let speed = r.ref_speed.max(1);
    let round_trip = cells.max(0).saturating_mul(2);
    (round_trip / speed + i64::from(round_trip % speed != 0)) as u32 + r.handling_days
}

/// 按实际期限（含 20–180 天截断）计算加急系数。
pub fn urgency_bp(defs: &crate::StaticData, need: u32, days: i64) -> i64 {
    let slack = (days.max(0) * 100 / i64::from(need.max(1))).clamp(150, 300);
    10_000 + defs.rules.contracts.v2.urgent_pct * 100 * (300 - slack) / 150
}

/// 公允报酬：沿用开放市场的两条曲线，逐步四舍五入。
pub fn fair_reward_v2(defs: &crate::StaticData, good: GoodId, qty: i64, to: LocId, days: i64) -> Option<Money> {
    let (_, cells) = nearest_source(defs, good, to)?;
    let ratio = defs.rules.open_market.ratio_curve.eval(Fx::from_int(cells));
    let mult = defs.rules.price_curve.eval(ratio);
    let value = defs.good(good).base_price.saturating_mul(qty);
    let normal = mult.apply(value);
    let premium = mul_div(normal, 100 + defs.rules.contracts.v2.premium_pct, 100);
    Some(mul_div(premium, urgency_bp(defs, need_days(defs, cells), days), 10_000))
}

/// 按单子大小筛选候选；校验摘要与实际发布共用，权重取动态现价。
fn candidates_for_size(world: &World, faction: FactionId, small: bool) -> Vec<(LocId, GoodId, i64)> {
    let defs = &world.defs;
    let r = &defs.rules.contracts.v2;
    let mut out = Vec::new();
    for loc in defs.port_ids().filter(|l| world.location_faction(*l) == faction && world.location_open(*l)) {
        for (good, e) in &world.state.locations[loc.idx()].market {
            if e.specialty || e.extra || defs.good(*good).license || crate::stages::is_rare(defs, *good) {
                continue;
            }
            if r.enabled && !route_allowed(defs, loc, *good, small) {
                continue;
            }
            out.push((loc, *good, mul_div(e.price, 100, e.base_price.max(1)).max(1)));
        }
    }
    out
}

/// 小单按目标货值取最接近的整数件数，再限制舱位。
pub fn small_qty(defs: &crate::StaticData, good: GoodId, value: Money) -> i64 {
    let r = &defs.rules.contracts.v2;
    mul_div(value, 1, defs.good(good).base_price.max(1)).clamp(r.small_qty[0], r.small_qty[1])
}

/// 已结束的合同保留的数量。
const CLOSED_KEPT: usize = 60;

impl World {
    /// 合同报酬的合理区间：货值 × 系数 × (1 + 天数/30) 的 0.5–2 倍。
    pub fn contract_fair_reward(&self, good: GoodId, qty: i64, to: LocId, days: i64) -> Money {
        if self.defs.rules.contracts.v2.enabled {
            fair_reward_v2(&self.defs, good, qty, to, days).unwrap_or(0)
        } else {
            fair_reward(&self.defs, good, qty, days)
        }
    }

    /// 发布一份合同（规则或 AI 提案）。
    pub(crate) fn post_contract(&mut self, mut c: TransportContract) -> ContractId {
        // AI 合同也记住发布时的航程信息；旧规则保留原来的空字段。
        if self.defs.rules.contracts.v2.enabled
            && let Some((source, cells)) = nearest_source(&self.defs, c.good, c.to)
        {
            c.source_port = Some(source);
            c.cells = cells;
            c.need_days = need_days(&self.defs, cells);
            c.urgency_bp = urgency_bp(&self.defs, c.need_days, i64::from(c.deadline.saturating_sub(self.day())));
        }
        let id = ContractId(self.state.next_contract.max(1));
        self.state.next_contract = id.0 + 1;
        c.id = id;
        self.state.contracts.insert(id, c);
        id
    }

    /// tick 第 6 步：每月按规则发布合同；处理过期与违约。
    pub(crate) fn contracts_step(&mut self) -> Result<(), CoreError> {
        let day = self.state.day;
        let defs = self.defs.clone();
        let rules = defs.rules.contracts.clone();
        if rules.v2.enabled {
            for agent in self.state.agents.values_mut() {
                agent.passes.retain(|pass| pass.until > day);
            }
        }
        // 过期与违约
        let due: Vec<ContractId> = self
            .state
            .contracts
            .values()
            .filter(|c| c.deadline < day && matches!(c.status, ContractStatus::Open | ContractStatus::Accepted(_)))
            .map(|c| c.id)
            .collect();
        for id in due {
            let Some(c) = self.state.contracts.get(&id).cloned() else { continue };
            match c.status {
                ContractStatus::Open => {
                    if let Some(c) = self.state.contracts.get_mut(&id) {
                        c.status = ContractStatus::Expired;
                    }
                }
                ContractStatus::Accepted(owner) => {
                    let penalty = c.penalty;
                    if penalty > 0 {
                        self.book_external(
                            owner,
                            Flow::Contract,
                            Sector::Treasury(c.issuer),
                            JournalEntry::new(day, Memo::Contract, CashClass::Operating)
                                .dr(Account::Fees, penalty)
                                .cr(Account::Cash, penalty),
                        )?;
                    }
                    self.adjust_reputation(owner, c.issuer, -rules.reputation_loss);
                    if let Some(c) = self.state.contracts.get_mut(&id) {
                        c.status = ContractStatus::Failed(owner);
                    }
                    self.push_log(LogEvent { day, kind: LogKind::ContractFailed { contract: id, owner } });
                }
                _ => {}
            }
        }
        // 清理过多的已结束合同
        let closed: Vec<ContractId> = self
            .state
            .contracts
            .values()
            .filter(|c| !matches!(c.status, ContractStatus::Open | ContractStatus::Accepted(_)))
            .map(|c| c.id)
            .collect();
        if closed.len() > CLOSED_KEPT {
            for id in &closed[..closed.len() - CLOSED_KEPT] {
                self.state.contracts.remove(id);
            }
        }
        // 航海期第一次日结补发一轮小单；标记独立保存，合同归档后也不会重发。
        let first = rules.v2.enabled && !self.upbringing_active() && !self.state.contracts_started;
        if rules.v2.enabled && self.upbringing_active() {
            return Ok(());
        }
        let monthly = self.defs.calendar.date_of(day).day - 1 == self.defs.calendar.month_days(day) / 2;
        if first {
            self.state.contracts_started = true;
        }
        if !monthly && !first {
            return Ok(());
        }
        for faction in defs.faction_ids() {
            let mut rng = Rng::derive(self.state.seed, day, Domain::Contracts, faction.0 as u64, 0);
            let count = if monthly { rules.per_faction_per_month } else { rules.v2.small_per_month };
            for slot in 0..count {
                let small = rules.v2.enabled && slot < rules.v2.small_per_month;
                // 在该势力的港口中挑一个当地需求大于产出的商品，现价越高越可能被委托
                let cands = candidates_for_size(self, faction, small);
                let weights: Vec<i64> = cands.iter().map(|c| c.2).collect();
                let Some(i) = rng.weighted(&weights) else {
                    // 新规则下两种单子的距离不同，缺小单候选也要继续检查后面的普通单。
                    if rules.v2.enabled && rules.v2.reserve_market {
                        continue;
                    }
                    break;
                };
                let (to, good, _) = cands[i];
                let e = &self.state.locations[to.idx()].market[&good];
                let qty = if small {
                    small_qty(&defs, good, rng.range(rules.v2.small_value[0], rules.v2.small_value[1]))
                } else {
                    (e.demand * rng.range(5, 12)).max(5)
                };
                let days = if rules.v2.enabled {
                    let Some((_, cells)) = nearest_source(&defs, good, to) else { continue };
                    let slack = rng.range(rules.v2.slack_pct[0], rules.v2.slack_pct[1]);
                    (i64::from(need_days(&defs, cells)) * slack / 100).clamp(20, 180)
                } else {
                    rng.range(45, 90)
                };
                let reward = self.contract_fair_reward(good, qty, to, days);
                let penalty = rules.penalty_share.apply(reward);
                self.post_contract(TransportContract {
                    id: ContractId(0),
                    issuer: faction,
                    good,
                    qty,
                    to,
                    deadline: day + days as u32,
                    reward,
                    penalty,
                    status: ContractStatus::Open,
                    source: ContractSource::Rule,
                    small,
                    source_port: None,
                    cells: 0,
                    need_days: 0,
                    urgency_bp: 0,
                });
            }
        }
        Ok(())
    }
}

/// 合同命令的校验结果。
pub(crate) enum ContractPlan {
    Accept { id: ContractId },
    Deliver { id: ContractId, holder: Holder, good: GoodId, qty: i64, reward: Money, issuer: FactionId, to: LocId },
}

pub(crate) fn check_accept(world: &World, owner: OwnerId, id: ContractId) -> Result<ContractPlan, CommandError> {
    let c = world.state.contracts.get(&id).ok_or_else(|| CommandError::NotFound(format!("{id:?}")))?;
    if c.status != ContractStatus::Open {
        return Err(crate::error::Reason::new("contract.unavailable", "合同已不可接受").rule());
    }
    if c.deadline < world.day() {
        return Err(crate::error::Reason::new("contract.expired", "合同已过期").rule());
    }
    if world.reputation(owner, c.issuer) < -20 {
        return Err(crate::error::Reason::new("contract.reputation", "声望过低，对方不愿委托").rule());
    }
    Ok(ContractPlan::Accept { id })
}

pub(crate) fn check_deliver(
    world: &World,
    owner: OwnerId,
    id: ContractId,
    holder: Holder,
) -> Result<ContractPlan, CommandError> {
    let c = world.state.contracts.get(&id).ok_or_else(|| CommandError::NotFound(format!("{id:?}")))?;
    if c.status != ContractStatus::Accepted(owner) {
        return Err(crate::error::Reason::new("contract.not_yours", "不是你承接中的合同").rule());
    }
    let loc = world.holder_location(owner, holder)?;
    if loc != c.to {
        return Err(CommandError::WrongLocation);
    }
    let have = world.holder_qty(owner, holder, c.good);
    if have < c.qty {
        return Err(CommandError::InsufficientCargo { have });
    }
    Ok(ContractPlan::Deliver { id, holder, good: c.good, qty: c.qty, reward: c.reward, issuer: c.issuer, to: c.to })
}

pub(crate) fn exec(world: &mut World, owner: OwnerId, plan: ContractPlan) -> Result<(), CommandError> {
    let day = world.state.day;
    match plan {
        ContractPlan::Accept { id } => {
            if let Some(c) = world.state.contracts.get_mut(&id) {
                c.status = ContractStatus::Accepted(owner);
            }
        }
        ContractPlan::Deliver { id, holder, good, qty, reward, issuer, to } => {
            world.holder_take(owner, holder, good, qty)?;
            // 交付的货物进入目的港市场（ECONOMY.md 6.4；规则关闭时直接消失，与旧版一致）
            if world.defs.rules.contracts.deliver_to_market
                && let Some(e) = world.market_mut(to, good)
            {
                e.stock += qty;
                e.flow.today(day).delivered += qty;
            }
            let cost = world.agent_mut(owner)?.book.remove(good, qty);
            world.book_external(
                owner,
                Flow::Contract,
                Sector::Treasury(issuer),
                JournalEntry::new(day, Memo::Contract, CashClass::Operating)
                    .dr(Account::Cash, reward)
                    .cr(Account::ContractIncome, reward)
                    .dr(Account::CostOfGoods, cost)
                    .cr(Account::Inventory, cost),
            )?;
            if let Some(c) = world.state.contracts.get_mut(&id) {
                c.status = ContractStatus::Completed(owner);
            }
            let rules = &world.defs.rules.contracts;
            let gain = if rules.v2.enabled && world.state.contracts.get(&id).is_some_and(|c| c.small) {
                rules.v2.small_reputation
            } else {
                rules.reputation_gain
            };
            world.adjust_reputation(owner, issuer, gain);
            let v2 = world.defs.rules.contracts.v2.clone();
            if v2.enabled {
                if v2.reward_turnover && world.access_on() {
                    crate::access::trade_reputation_for_faction(world, owner, issuer, reward);
                }
                if v2.pass_days > 0 {
                    let until = day.saturating_add(v2.pass_days);
                    let passes = &mut world.agent_mut(owner)?.passes;
                    if let Some(pass) = passes.iter_mut().find(|p| p.faction == issuer && p.good == good) {
                        pass.until = pass.until.max(until);
                    } else {
                        passes.push(GoodPass { faction: issuer, good, until });
                        passes.sort_by_key(|p| (p.faction, p.good));
                    }
                }
            }
            world.push_log(LogEvent { day, kind: LogKind::ContractCompleted { contract: id, owner } });
        }
    }
    Ok(())
}

/// AI 提议的合同：内核校验可行性与报酬是否在合理区间。
pub fn check_offer(
    world: &World,
    issuer: FactionId,
    good: GoodId,
    qty: i64,
    to: LocId,
    days: i64,
    reward: Money,
) -> Result<(), CommandError> {
    let defs = &world.defs;
    if crate::stages::is_rare(defs, good) {
        return Err(CommandError::NotTraded);
    }
    if defs.factions.get(issuer.idx()).is_none() || defs.goods.get(good.idx()).is_none() {
        return Err(CommandError::NotFound("势力或商品".into()));
    }
    if defs.locations.get(to.idx()).is_none() || world.market(to, good).is_none() {
        return Err(CommandError::Precondition("目的地不交易该商品".into()));
    }
    if !(1..=2_000).contains(&qty) {
        return Err(CommandError::OutOfRange("数量必须在 1 到 2000 之间".into()));
    }
    if !(20..=180).contains(&days) {
        return Err(CommandError::OutOfRange("期限必须在 20 到 180 天之间".into()));
    }
    // AI 不能绕过规则发布的产地与距离过滤，在目的港买完当场交货。
    if defs.rules.contracts.v2.enabled && !candidates(world, issuer).iter().any(|c| c.0 == to && c.1 == good) {
        return Err(CommandError::Precondition("没有起运地".into()));
    }
    let fair = if defs.rules.contracts.v2.enabled {
        fair_reward_v2(defs, good, qty, to, days).ok_or_else(|| CommandError::Precondition("没有起运地".into()))?
    } else {
        fair_reward(defs, good, qty, days)
    };
    if reward < fair / 2 || reward > fair * 2 {
        return Err(CommandError::OutOfRange(format!("报酬 {reward} 不在合理区间 {}–{}", fair / 2, fair * 2)));
    }
    Ok(())
}

/// 大单与 AI 提案的候选；AI 提案没有小单标记，仍沿用大单距离。
pub fn candidates(world: &World, faction: FactionId) -> Vec<(LocId, GoodId, i64)> {
    candidates_for_size(world, faction, false)
}

/// 首次航海补发与月度小单的候选。
pub fn small_candidates(world: &World, faction: FactionId) -> Vec<(LocId, GoodId, i64)> {
    candidates_for_size(world, faction, true)
}

/// 静态产地与距离过滤：托运市场关闭时保留 T04 的全部限制。
pub fn route_allowed(defs: &crate::StaticData, to: LocId, good: GoodId, small: bool) -> bool {
    let r = &defs.rules.contracts.v2;
    if !r.enabled {
        return true;
    }
    let sold = if r.reserve_market {
        crate::open_market::sells_listed(defs, to, good)
    } else {
        crate::open_market::sells(defs, to, good)
    };
    let min_cells = if r.reserve_market && small { r.small_min_cells } else { r.min_cells };
    !sold && nearest_source(defs, good, to).is_some_and(|(_, cells)| cells >= min_cells)
}

/// 是否有未结委托占住本港这种货；不新增状态，多张同货委托全部结清才解除。
pub fn market_reserved(world: &World, loc: LocId, good: GoodId) -> bool {
    let r = &world.defs.rules.contracts.v2;
    r.enabled
        && r.reserve_market
        && world.state.contracts.values().any(|c| {
            c.to == loc && c.good == good && matches!(c.status, ContractStatus::Open | ContractStatus::Accepted(_))
        })
}
