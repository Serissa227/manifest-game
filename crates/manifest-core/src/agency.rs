//! 商馆代办与产业位（交易与投资改造 T03，`docs/TRADE-PLAN.md` §2；规则 `rules.toml [agency]`，缺省关闭）。
//!
//! - **代办挂单**：在自己有仓库（租的、买的，或商馆的免费仓位）的港口挂限价单。
//!   - 买单：成交均价（不含税）不高于限价时买进，最多若干件，进当地仓库。挂单时按“限价 × 件数 ×
//!     (1 + 当时税率) 再加代办费”从现金里**预留**：记 `借 代办预留金 / 贷 现金`，钱仍算在参与者手里（[`World::agency_money`]
//!     计入 `total_money`），所以守恒；撤单、成交完、自动撤单时原路退回。
//!   - 卖单：成交均价（不含税）不低于限价时，从当地仓库卖出，最多若干件；不预留货物，每次按仓库里当时的存货卖。
//!   - 每天日结（期货盯市之后、舰队移动之前；当天的价格已经按收盘调过）按挂单先后逐张成交：
//!     成交量取满足限价的最大件数（受当天库存、仓库空位、预留金限制），**走玩家手动买卖同一条内核路径**
//!     （`Command::BuyInto` / `SellFrom`：税、货档、许可证、对价格的冲击、声望都一样）。
//!     那一天成交不了（价格不到、货档 / 许可证不够、仓库满、港口封了）就原样挂着，记下原因给界面看。
//!   - 代办费：成交额（不含税）的 `fee_pct`%（向上取整），进当地城镇钱袋（`Flow::AgencyFee`）。
//!   - 每个港口的挂单数上限 = 商馆等级 × `orders_per_level`；商馆掉级以后已挂的单不撤，只是不能再挂新的。
//!   - 参与者现金为负时，先把它的买单撤掉、预留金退回现金（免得钱锁在单子里却因为现金为负而破产）；
//!     破产清算 / 重组之前也一样全部撤掉。
//! - **产业位**（`industry_slots`）：港口里能经营的产业处数随商馆等级（0–4 级 → 0–4 处）。只管港口
//!   （内陆城市设不了商馆，照旧不限）；商会在本据港至少 1 处（商会的老规矩：本据港建一处采集产业）。
//!   已有的产业不没收，超出的保留，只是不能再建。
use crate::circulation::Sector;
use crate::command::Command;
use crate::error::{CommandError, CoreError, Reason};
use crate::fixed::{Fx, Money};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::market::{Side, quote};
use crate::treasury::Flow;
use crate::warehouse::Holder;
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[cfg(test)]
mod tests;

// ───────────────────────────── 规则 ─────────────────────────────

/// 商馆代办与产业位（`rules.toml [agency]`）。缺省关闭。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AgencyRules {
    pub enabled: bool,
    /// 代办费：成交额（不含税）的百分比
    pub fee_pct: i64,
    /// 每级商馆给几张挂单位
    pub orders_per_level: i64,
    /// 成交记录留多少条（全体参与者合计，新的在后）
    pub keep_fills: usize,
    /// 商馆 0、1、2… 级时，港口里能经营的产业处数；空 = 不限（同旧版）
    pub industry_slots: Vec<i64>,
}

impl Default for AgencyRules {
    fn default() -> Self {
        AgencyRules { enabled: false, fee_pct: 2, orders_per_level: 2, keep_fills: 60, industry_slots: Vec::new() }
    }
}

impl AgencyRules {
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !self.enabled {
            return out;
        }
        if !(0..=100).contains(&self.fee_pct) {
            out.push(("fee_pct", "fee_pct 必须在 0 到 100 之间"));
        }
        if self.orders_per_level < 0 {
            out.push(("orders_per_level", "orders_per_level 不能为负"));
        }
        if self.industry_slots.iter().any(|v| *v < 0) || self.industry_slots.windows(2).any(|w| w[0] > w[1]) {
            out.push(("industry_slots", "industry_slots 不能为负，且要随等级不减"));
        }
        out
    }
}

// ───────────────────────────── 状态 ─────────────────────────────

/// 买还是卖。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum OrderSide {
    Buy,
    Sell,
}

/// 一张挂单。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgencyOrder {
    pub id: u32,
    pub owner: OwnerId,
    pub loc: LocId,
    pub good: GoodId,
    pub side: OrderSide,
    /// 限价（单价，不含税）
    pub limit: Money,
    /// 还要成交的件数
    pub qty: i64,
    /// 已成交的件数
    #[serde(default)]
    pub filled: i64,
    /// 挂单那天
    pub placed: u32,
    /// 买单的预留金（卖单为 0）
    #[serde(default)]
    pub reserved: Money,
    /// 最近一次没能成交的原因（`Reason` 的代码；价格没到为 `agency.price`）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waiting: Option<String>,
    #[serde(default, skip_serializing_if = "is_zero_money")]
    pub done_total: Money,
    #[serde(default, skip_serializing_if = "is_zero_money")]
    pub done_fee: Money,
    #[serde(default, skip_serializing_if = "is_zero_money")]
    pub done_cost: Money,
}

/// 一笔代办成交。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgencyFill {
    pub day: u32,
    pub order: u32,
    pub owner: OwnerId,
    pub loc: LocId,
    pub good: GoodId,
    pub side: OrderSide,
    pub qty: i64,
    /// 现金变动的绝对值（买入含税、卖出扣税；不含代办费）
    pub total: Money,
    pub fee: Money,
    #[serde(default, skip_serializing_if = "is_zero_money")]
    pub cost: Money,
}

fn is_zero_money(v: &Money) -> bool {
    *v == 0
}

/// 代办的状态。规则关闭时为空，不写进存档。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgencyState {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub orders: BTreeMap<u32, AgencyOrder>,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub next_id: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fills: Vec<AgencyFill>,
}

fn is_zero(v: &u32) -> bool {
    *v == 0
}

impl AgencyState {
    pub fn is_empty(&self) -> bool {
        self.orders.is_empty() && self.fills.is_empty() && self.next_id == 0
    }
}

// ───────────────────────────── 查询 ─────────────────────────────

impl World {
    /// 代办规则是否打开。
    pub fn agency_on(&self) -> bool {
        self.defs.rules.agency.enabled
    }

    /// 挂单的预留金合计（算在参与者的钱里，见 `total_money`）。
    pub fn agency_money(&self) -> Money {
        self.state.agency.orders.values().map(|o| o.reserved).sum()
    }

    /// 某所有者在某港最多能挂几张单（商馆等级 × 每级挂单位）。
    pub fn agency_slots(&self, owner: OwnerId, loc: LocId) -> i64 {
        if !self.agency_on() {
            return 0;
        }
        (self.house_level(owner, loc) as i64 * self.defs.rules.agency.orders_per_level)
            .saturating_add(self.agency_stage_bonus(owner, loc))
    }

    /// 某所有者在某港已挂的单数。
    pub fn agency_orders_at(&self, owner: OwnerId, loc: LocId) -> i64 {
        self.state.agency.orders.values().filter(|o| o.owner == owner && o.loc == loc).count() as i64
    }

    /// 某所有者在某港能经营几处产业（产业位）；None = 不限（规则关闭、没写 `industry_slots`、不是港口）。
    pub fn industry_slots(&self, owner: OwnerId, loc: LocId) -> Option<i64> {
        let r = &self.defs.rules.agency;
        if !r.enabled || r.industry_slots.is_empty() || !crate::access::investable(&self.defs, loc) {
            return None;
        }
        let level = self.house_level(owner, loc);
        let slots = r
            .industry_slots
            .get(level)
            .or(r.industry_slots.last())
            .copied()
            .unwrap_or(0)
            .saturating_add(self.industry_stage_bonus(owner, loc));
        // 商会在本据港至少 1 处（它的老规矩：本据港建一处采集产业）
        let home = owner.company().is_some() && self.agent(owner).is_ok_and(|a| a.home == loc);
        Some(if home { slots.max(1) } else { slots })
    }

    /// 某所有者在某港已有的产业处数。
    pub fn industries_at(&self, owner: OwnerId, loc: LocId) -> i64 {
        self.state.industries.values().filter(|i| i.owner == owner && i.loc == loc).count() as i64
    }

    /// 某港某商会等级下的产业位（界面用：下一级多几个位）。
    pub fn industry_slots_at_level(&self, level: usize) -> Option<i64> {
        let r = &self.defs.rules.agency;
        (r.enabled && !r.industry_slots.is_empty())
            .then(|| r.industry_slots.get(level).or(r.industry_slots.last()).copied().unwrap_or(0))
    }
}

/// 代办费（成交额不含税的百分比，向上取整）。
pub fn agency_fee(world: &World, gross: Money) -> Money {
    let pct = world.defs.rules.agency.fee_pct;
    if gross <= 0 || pct <= 0 { 0 } else { (gross * pct + 99) / 100 }
}

/// 买单按限价与件数要预留的钱：限价 × 件数 × (1 + 税率) + 代办费。
fn buy_reserve(world: &World, tax_rate: Fx, limit: Money, qty: i64) -> Money {
    let gross = limit.saturating_mul(qty);
    gross + tax_rate.apply(gross) + 1 + agency_fee(world, gross)
}

// ───────────────────────────── 命令 ─────────────────────────────

/// 代办命令的校验结果。
pub(crate) enum AgencyPlan {
    Place(AgencyOrder),
    Cancel(u32),
}

fn rule(code: &'static str, zh: &'static str) -> CommandError {
    Reason::new(code, zh).rule()
}

pub(crate) fn check_place(
    world: &World,
    owner: OwnerId,
    loc: LocId,
    good: GoodId,
    side: OrderSide,
    limit: Money,
    qty: i64,
) -> Result<AgencyPlan, CommandError> {
    if !world.agency_on() {
        return Err(rule("agency.off", "这个世界没有商馆代办"));
    }
    let defs = &world.defs;
    if defs.locations.get(loc.idx()).is_none() || defs.goods.get(good.idx()).is_none() {
        return Err(CommandError::NotFound("地点或商品".into()));
    }
    if qty <= 0 || limit <= 0 {
        return Err(CommandError::InvalidQuantity);
    }
    if world.warehouse_capacity(owner, loc) <= 0 {
        return Err(rule("agency.warehouse", "代办要在当地有仓库（租的、买的或商馆的免费仓位）"));
    }
    if world.market(loc, good).is_none() {
        return Err(rule("agency.market", "这里的市场不收这种货"));
    }
    if world.agency_orders_at(owner, loc) >= world.agency_slots(owner, loc) {
        return Err(rule("agency.slots", "这里的挂单位已满（商馆每升一级多两个）"));
    }
    let reserved = match side {
        OrderSide::Buy => {
            let tax = quote(world, owner, loc, good, Side::Buy, 1).map(|q| q.tax_rate).unwrap_or(Fx::ZERO);
            let need = buy_reserve(world, tax, limit, qty);
            let have = world.agent(owner)?.cash;
            if have < need {
                return Err(CommandError::InsufficientCash { need, have });
            }
            need
        }
        OrderSide::Sell => {
            let have = world.holder_qty(owner, Holder::Warehouse(loc), good);
            if have < qty {
                return Err(CommandError::InsufficientCargo { have });
            }
            0
        }
    };
    let id = world.state.agency.next_id + 1;
    Ok(AgencyPlan::Place(AgencyOrder {
        id,
        owner,
        loc,
        good,
        side,
        limit,
        qty,
        filled: 0,
        placed: world.day(),
        reserved,
        waiting: None,
        done_total: 0,
        done_fee: 0,
        done_cost: 0,
    }))
}

pub(crate) fn check_cancel(world: &World, owner: OwnerId, order: u32) -> Result<AgencyPlan, CommandError> {
    let o = world.state.agency.orders.get(&order).ok_or_else(|| CommandError::NotFound(format!("挂单 {order}")))?;
    if o.owner != owner {
        return Err(CommandError::NotOwner);
    }
    Ok(AgencyPlan::Cancel(order))
}

impl World {
    pub(crate) fn apply_agency(&mut self, plan: AgencyPlan) -> Result<(), CoreError> {
        match plan {
            AgencyPlan::Place(order) => {
                if order.reserved > 0 {
                    self.agency_reserve(order.owner, order.reserved)?;
                }
                self.state.agency.next_id = order.id;
                self.state.agency.orders.insert(order.id, order);
            }
            AgencyPlan::Cancel(id) => self.agency_drop(id)?,
        }
        Ok(())
    }

    /// 现金 → 预留金。
    fn agency_reserve(&mut self, owner: OwnerId, amount: Money) -> Result<(), CoreError> {
        let day = self.state.day;
        self.book_internal(
            owner,
            JournalEntry::new(day, Memo::Agency, CashClass::Operating)
                .dr(Account::AgencyEscrow, amount)
                .cr(Account::Cash, amount),
        )?;
        Ok(())
    }

    /// 预留金 → 现金。
    fn agency_release(&mut self, owner: OwnerId, amount: Money) -> Result<(), CoreError> {
        if amount <= 0 {
            return Ok(());
        }
        let day = self.state.day;
        self.book_internal(
            owner,
            JournalEntry::new(day, Memo::Agency, CashClass::Operating)
                .dr(Account::Cash, amount)
                .cr(Account::AgencyEscrow, amount),
        )?;
        Ok(())
    }

    /// 撤掉一张单，退回预留金。
    fn agency_drop(&mut self, id: u32) -> Result<(), CoreError> {
        if let Some(o) = self.state.agency.orders.remove(&id) {
            self.agency_release(o.owner, o.reserved)?;
        }
        Ok(())
    }

    /// 撤掉某所有者的全部挂单（破产清算、重组之前）。
    pub(crate) fn agency_cancel_all(&mut self, owner: OwnerId) -> Result<(), CoreError> {
        let ids: Vec<u32> = self.state.agency.orders.values().filter(|o| o.owner == owner).map(|o| o.id).collect();
        for id in ids {
            self.agency_drop(id)?;
        }
        Ok(())
    }

    /// 日结的一部分：逐张挂单按当天的价格成交（规则关闭或没有挂单时什么也不做）。
    pub(crate) fn agency_day(&mut self) -> Result<(), CoreError> {
        if self.state.agency.orders.is_empty() {
            return Ok(());
        }
        let day = self.state.day;
        // 现金为负的参与者：买单的预留金先退回（撤单），免得钱锁在单子里却因为现金为负而破产
        let broke: Vec<(u32, OwnerId, LocId, GoodId, Money)> = self
            .state
            .agency
            .orders
            .values()
            .filter(|o| o.side == OrderSide::Buy && self.agent(o.owner).is_ok_and(|a| a.cash < 0))
            .map(|o| (o.id, o.owner, o.loc, o.good, o.reserved))
            .collect();
        for (id, owner, loc, good, refund) in broke {
            self.agency_drop(id)?;
            self.push_log(LogEvent { day, kind: LogKind::AgencyRefunded { owner, loc, good, refund } });
        }
        let ids: Vec<u32> = self.state.agency.orders.keys().copied().collect();
        for id in ids {
            let Some(order) = self.state.agency.orders.get(&id).cloned() else { continue };
            if self.agent(order.owner).map_or(true, |a| a.bankrupt) {
                continue;
            }
            let filled = match order.side {
                OrderSide::Buy => self.agency_fill_buy(&order)?,
                OrderSide::Sell => self.agency_fill_sell(&order)?,
            };
            match filled {
                Ok(fill) => {
                    let done = {
                        let o = self.state.agency.orders.get_mut(&id).expect("挂单还在");
                        o.qty -= fill.qty;
                        o.filled += fill.qty;
                        if self.defs.rules.trade_books.enabled {
                            o.done_total += fill.total;
                            o.done_fee += fill.fee;
                            o.done_cost += fill.cost;
                        }
                        o.waiting = None;
                        o.qty <= 0
                    };
                    crate::trade_books::note_agency(self, &fill);
                    self.push_log(LogEvent {
                        day,
                        kind: LogKind::AgencyFilled {
                            owner: fill.owner,
                            loc: fill.loc,
                            good: fill.good,
                            buy: fill.side == OrderSide::Buy,
                            qty: fill.qty,
                            total: fill.total,
                            fee: fill.fee,
                        },
                    });
                    let keep = self.defs.rules.agency.keep_fills.max(1);
                    let fills = &mut self.state.agency.fills;
                    fills.push(fill);
                    if fills.len() > keep {
                        let excess = fills.len() - keep;
                        fills.drain(0..excess);
                    }
                    if done {
                        self.agency_drop(id)?;
                    }
                }
                Err(code) => {
                    if let Some(o) = self.state.agency.orders.get_mut(&id) {
                        o.waiting = Some(code);
                    }
                }
            }
        }
        Ok(())
    }

    /// 买单：在限价、预留金、仓库空位与当天库存之内买到最多的件数。
    fn agency_fill_buy(&mut self, o: &AgencyOrder) -> Result<Result<AgencyFill, String>, CoreError> {
        let holder = Holder::Warehouse(o.loc);
        let fits = |w: &World, q: i64| -> Result<crate::market::TradeQuote, String> {
            let quote = quote(w, o.owner, o.loc, o.good, Side::Buy, q).map_err(|e| e.code().to_string())?;
            if quote.gross > o.limit.saturating_mul(q) {
                return Err("agency.price".into());
            }
            if quote.total + agency_fee(w, quote.gross) > o.reserved {
                return Err("agency.reserve".into());
            }
            Ok(quote)
        };
        let cap = o.qty.min(self.holder_free(o.owner, holder));
        if cap <= 0 {
            return Ok(Err("agency.capacity".into()));
        }
        let q = match largest(cap, |q| fits(self, q).is_ok()) {
            Some(q) => q,
            None => return Ok(Err(fits(self, 1).err().unwrap_or_else(|| "agency.price".into()))),
        };
        // 同一条内核路径：先把预留金退回现金，再按普通的“买入存仓”成交
        let cmd = Command::BuyInto { owner: o.owner, holder, good: o.good, qty: q, max_total: Some(o.reserved) };

        let reserved = o.reserved;
        self.agency_release(o.owner, reserved)?;
        let outcome = match cmd.apply(self) {
            Ok(crate::command::CommandOutcome::Traded(q)) => q,
            Ok(_) => unreachable!("买入存仓的结果是成交"),
            Err(e) => {
                // 没成交：预留金原样放回
                self.agency_reserve(o.owner, reserved)?;
                return Ok(Err(e.code().to_string()));
            }
        };
        let fee = agency_fee(self, outcome.gross);
        self.agency_pay_fee(o.owner, o.loc, fee)?;
        // 剩下的件数重新预留（按当天的税率；现金不够就有多少留多少）
        let rest = o.qty - q;
        let next = if rest > 0 {
            buy_reserve(self, outcome.tax_rate, o.limit, rest).min(self.agent(o.owner)?.cash.max(0))
        } else {
            0
        };
        if next > 0 {
            self.agency_reserve(o.owner, next)?;
        }
        if let Some(x) = self.state.agency.orders.get_mut(&o.id) {
            x.reserved = next;
        }
        Ok(Ok(AgencyFill {
            day: self.state.day,
            order: o.id,
            owner: o.owner,
            loc: o.loc,
            good: o.good,
            side: OrderSide::Buy,
            qty: q,
            total: outcome.total,
            fee,
            cost: if self.defs.rules.trade_books.enabled { outcome.total } else { 0 },
        }))
    }

    /// 卖单：在限价之内、按仓库里现有的货卖出最多的件数。
    fn agency_fill_sell(&mut self, o: &AgencyOrder) -> Result<Result<AgencyFill, String>, CoreError> {
        let holder = Holder::Warehouse(o.loc);
        let cap = o.qty.min(self.holder_qty(o.owner, holder, o.good));
        if cap <= 0 {
            return Ok(Err("agency.stock".into()));
        }
        let fits = |w: &World, q: i64| -> Result<crate::market::TradeQuote, String> {
            let quote = quote(w, o.owner, o.loc, o.good, Side::Sell, q).map_err(|e| e.code().to_string())?;
            if quote.gross < o.limit.saturating_mul(q) {
                return Err("agency.price".into());
            }
            Ok(quote)
        };
        let q = match largest(cap, |q| fits(self, q).is_ok()) {
            Some(q) => q,
            None => return Ok(Err(fits(self, 1).err().unwrap_or_else(|| "agency.price".into()))),
        };
        let cmd = Command::SellFrom { owner: o.owner, holder, good: o.good, qty: q, min_total: None };
        let cost = if self.defs.rules.trade_books.enabled { self.agent(o.owner)?.book.peek_cost(o.good, q) } else { 0 };
        let outcome = match cmd.apply(self) {
            Ok(crate::command::CommandOutcome::Traded(q)) => q,
            Ok(_) => unreachable!("取仓卖出的结果是成交"),
            Err(e) => return Ok(Err(e.code().to_string())),
        };
        let fee = agency_fee(self, outcome.gross);
        self.agency_pay_fee(o.owner, o.loc, fee)?;
        Ok(Ok(AgencyFill {
            day: self.state.day,
            order: o.id,
            owner: o.owner,
            loc: o.loc,
            good: o.good,
            side: OrderSide::Sell,
            qty: q,
            total: outcome.total,
            fee,
            cost,
        }))
    }

    /// 代办费进当地城镇钱袋。
    fn agency_pay_fee(&mut self, owner: OwnerId, loc: LocId, fee: Money) -> Result<(), CoreError> {
        if fee <= 0 {
            return Ok(());
        }
        let day = self.state.day;
        let to: Sector = self.town_sector(loc);
        self.book_external(
            owner,
            Flow::AgencyFee,
            to,
            JournalEntry::new(day, Memo::Agency, CashClass::Operating).dr(Account::Fees, fee).cr(Account::Cash, fee),
        )?;
        Ok(())
    }
}

/// 满足条件的最大件数（条件随件数单调：件数越多均价越差）。一件都不满足时为 None。
fn largest(cap: i64, ok: impl Fn(i64) -> bool) -> Option<i64> {
    if cap <= 0 || !ok(1) {
        return None;
    }
    let (mut lo, mut hi) = (1i64, cap);
    while lo < hi {
        let mid = lo + (hi - lo + 1) / 2;
        if ok(mid) { lo = mid } else { hi = mid - 1 }
    }
    Some(lo)
}

/// 界面用：按当前行情估一张买单要预留多少。
pub fn reserve_estimate(world: &World, owner: OwnerId, loc: LocId, good: GoodId, limit: Money, qty: i64) -> Money {
    let tax = quote(world, owner, loc, good, Side::Buy, 1).map(|q| q.tax_rate).unwrap_or(Fx::ZERO);
    buy_reserve(world, tax, limit, qty.max(0))
}

/// 测试与视图用：某港某所有者的挂单（按挂单先后）。
pub fn orders_of(world: &World, owner: OwnerId, loc: LocId) -> Vec<&AgencyOrder> {
    world.state.agency.orders.values().filter(|o| o.owner == owner && o.loc == loc).collect()
}
