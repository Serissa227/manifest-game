//! 期货交易所。
//!
//! - 每个合约规格每月一个到期合约（月末到期），同时挂最近 3 个月。
//! - 交易所作为做市方（house）报价：公允价 = 交割港现货价 × (1 + 持有成本 × 剩余月数) × NPC 预期调整；
//!   买价 / 卖价在公允价两侧各留半个价差；成交按手数有冲击成本；单一参与者有持仓上限。
//! - 全部持仓按同一盯市价计价。成交时立即结算成交价与盯市价之差；每日按结算价盯市，
//!   盈亏在参与者保证金账户与做市方账户之间划转，因此全体（含做市方）合计恒为零。
//! - 保证金低于维持保证金时发出追保通知，次日仍不足则按做市方报价强制平仓。
//! - 到期：最终结算价 = 交割港当日现货价（因此在交割港囤积现货可以影响结算价）。
//!   现金结算的持仓直接了结；实物交割时多头付款收货进交割港仓库，空头从交割港仓库交货收款，
//!   交不出的部分按惩罚价现金结算。做市方与现货市场之间的货物往来记为外部资金往来。

use crate::error::{CommandError, CoreError};
use crate::fixed::{Fx, Money, mul_div};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::market::{Side, quote, quote_any};
use crate::treasury::Flow;
use crate::warehouse::Holder;
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 一个到期合约。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FuturesContract {
    pub id: FuturesId,
    /// 合约规格下标
    pub spec: u16,
    pub expiry_day: u32,
    /// 当前盯市价（每单位）
    pub mark: Money,
    pub settled: bool,
    /// 最终结算价
    pub final_price: Option<Money>,
}

/// 持仓。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Position {
    /// 手数：正为多头，负为空头
    pub lots: i64,
    /// 开仓均价（仅供显示）
    pub avg_price: Money,
    /// 到期时是否实物交割
    pub physical: bool,
    pub opened_day: u32,
}

/// 某日的盯市合计（审计用）：参与者合计 + 做市方 = 0。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MtmRecord {
    pub day: u32,
    pub participants: Money,
    pub house: Money,
}

/// 期货系统状态。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FuturesState {
    pub contracts: BTreeMap<FuturesId, FuturesContract>,
    pub next_id: u32,
    pub positions: BTreeMap<FuturesId, BTreeMap<OwnerId, Position>>,
    /// 参与者在各交易所的保证金账户
    pub margin: BTreeMap<OwnerId, BTreeMap<ExchangeId, Money>>,
    /// 做市方账户
    pub house: BTreeMap<ExchangeId, Money>,
    /// 未解除的追保通知：发出日期
    pub calls: BTreeMap<OwnerId, BTreeMap<ExchangeId, u32>>,
    pub mtm_log: Vec<MtmRecord>,
}

const MTM_KEPT: usize = 60;

/// 做市方报价。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FuturesQuote {
    pub contract: FuturesId,
    pub fair: Money,
    pub bid: Money,
    pub ask: Money,
    pub mark: Money,
    pub months_left: i64,
}

fn round_tick(p: Money, tick: Money) -> Money {
    let t = tick.max(1);
    ((p + t / 2) / t * t).max(t)
}

impl World {
    fn spec_of(&self, c: &FuturesContract) -> &crate::defs::FuturesSpecDef {
        &self.defs.futures_specs[c.spec as usize]
    }

    pub fn futures_contract(&self, id: FuturesId) -> Option<&FuturesContract> {
        self.state.futures.contracts.get(&id)
    }

    pub fn margin_balance(&self, owner: OwnerId, ex: ExchangeId) -> Money {
        self.state.futures.margin.get(&owner).and_then(|m| m.get(&ex)).copied().unwrap_or(0)
    }

    pub fn position(&self, owner: OwnerId, id: FuturesId) -> Option<&Position> {
        self.state.futures.positions.get(&id)?.get(&owner)
    }

    /// 交割港现货价（未上市则用基准价）。
    fn spot_of(&self, c: &FuturesContract) -> Money {
        let spec = self.spec_of(c);
        self.market(spec.delivery, spec.good).map(|e| e.price).unwrap_or(self.defs.good(spec.good).base_price)
    }

    /// NPC 预期调整：以交割港近 30 日现货动量的一半为预期，夹在 ±10%。
    fn expectation(&self, c: &FuturesContract) -> Fx {
        let spec = self.spec_of(c);
        let Some(e) = self.market(spec.delivery, spec.good) else { return Fx::ONE };
        let h = &e.history;
        if h.len() < 2 {
            return Fx::ONE;
        }
        let old = h[h.len().saturating_sub(30)].max(1);
        let now = *h.back().unwrap_or(&old);
        let momentum = Fx::ratio(now - old, old);
        Fx::ONE + Fx(momentum.raw() / 2).clamp(Fx::from_pct(-10), Fx::from_pct(10))
    }

    /// 做市方报价。
    pub fn futures_quote(&self, id: FuturesId) -> Option<FuturesQuote> {
        let c = self.state.futures.contracts.get(&id)?;
        if c.settled {
            return None;
        }
        let spec = self.spec_of(c);
        let ex = self.defs.exchange(spec.exchange);
        let months_left = i64::from(self.defs.calendar.months_until(self.state.day, c.expiry_day));
        let carry = Fx::ONE + ex.carry_per_month.mul(Fx::from_int(months_left));
        let fair = round_tick(carry.mul(self.expectation(c)).apply(self.spot_of(c)), spec.tick);
        let half = Fx(ex.spread.raw() / 2);
        Some(FuturesQuote {
            contract: id,
            fair,
            bid: round_tick((Fx::ONE - half).apply(fair), spec.tick),
            ask: round_tick((Fx::ONE + half).apply(fair), spec.tick),
            mark: c.mark,
            months_left,
        })
    }

    /// 成交价：买入以卖价为基础、卖出以买价为基础，再加冲击成本。
    pub fn futures_exec_price(&self, id: FuturesId, lots: i64) -> Option<Money> {
        let q = self.futures_quote(id)?;
        let c = self.state.futures.contracts.get(&id)?;
        let spec = self.spec_of(c);
        let ex = self.defs.exchange(spec.exchange);
        let impact = ex.impact_per_lot.mul(Fx::from_int(lots.abs())).mul(Fx::from_pct(50));
        Some(if lots > 0 {
            round_tick((Fx::ONE + impact).apply(q.ask), spec.tick)
        } else {
            round_tick((Fx::ONE - impact).apply(q.bid), spec.tick)
        })
    }

    /// 某参与者在某交易所的保证金要求（按比例 × 持仓名义价值）。
    pub fn margin_requirement(&self, owner: OwnerId, ex: ExchangeId, ratio: Fx) -> Money {
        let mut total = 0;
        for (id, book) in &self.state.futures.positions {
            let Some(c) = self.state.futures.contracts.get(id) else { continue };
            let spec = self.spec_of(c);
            if spec.exchange != ex {
                continue;
            }
            if let Some(p) = book.get(&owner) {
                total += ratio.apply(p.lots.abs() * spec.lot * c.mark);
            }
        }
        total
    }

    /// 在参与者保证金与做市方之间划转盈亏（正数为参与者获利），并记账。
    fn settle_pnl(&mut self, owner: OwnerId, ex: ExchangeId, pnl: Money) -> Result<(), CoreError> {
        if pnl == 0 {
            return Ok(());
        }
        let day = self.state.day;
        *self.state.futures.margin.entry(owner).or_default().entry(ex).or_insert(0) += pnl;
        *self.state.futures.house.entry(ex).or_insert(0) -= pnl;
        let entry = if pnl > 0 {
            JournalEntry::new(day, Memo::FuturesSettlement, CashClass::Operating)
                .dr(Account::MarginDeposits, pnl)
                .cr(Account::FuturesGains, pnl)
        } else {
            JournalEntry::new(day, Memo::FuturesSettlement, CashClass::Operating)
                .dr(Account::FuturesLosses, -pnl)
                .cr(Account::MarginDeposits, -pnl)
        };
        self.book_internal(owner, entry)?;
        Ok(())
    }

    /// 以成交价交易 `lots` 手（不做校验），返回成交价。
    fn futures_fill(&mut self, owner: OwnerId, id: FuturesId, lots: i64, price: Money) -> Result<Money, CoreError> {
        let day = self.state.day;
        let (mark, lot, ex) = {
            let c = self.state.futures.contracts.get(&id).ok_or_else(|| CoreError::Internal("合约不存在".into()))?;
            let spec = self.spec_of(c);
            (c.mark, spec.lot, spec.exchange)
        };
        // 成交价与盯市价之差立即结算
        self.settle_pnl(owner, ex, (mark - price) * lots * lot)?;
        let book = self.state.futures.positions.entry(id).or_default();
        let p = book.entry(owner).or_insert(Position { lots: 0, avg_price: price, physical: false, opened_day: day });
        let new_lots = p.lots + lots;
        if p.lots == 0 || (p.lots > 0) != (new_lots > 0) {
            p.avg_price = price;
            p.opened_day = day;
        } else if p.lots.signum() == lots.signum() {
            p.avg_price = mul_div(p.avg_price * p.lots.abs() + price * lots.abs(), 1, new_lots.abs().max(1));
        }
        p.lots = new_lots;
        if new_lots == 0 {
            book.remove(&owner);
        }
        Ok(price)
    }

    /// 挂出新合约，保证每个规格都有从 `day` 所在月份起最近 3 个月的合约。
    pub(crate) fn list_futures(&mut self, day: u32) {
        let month = self.defs.calendar.month_index(day);
        for (si, _) in self.defs.futures_specs.iter().enumerate() {
            for m in month..month + 3 {
                let Ok(expiry) = self.defs.calendar.month_end_day(m) else { continue };
                if expiry < day {
                    continue;
                }
                let exists =
                    self.state.futures.contracts.values().any(|c| c.spec as usize == si && c.expiry_day == expiry);
                if exists {
                    continue;
                }
                let id = FuturesId(self.state.futures.next_id.max(1));
                self.state.futures.next_id = id.0 + 1;
                let mut c = FuturesContract {
                    id,
                    spec: si as u16,
                    expiry_day: expiry,
                    mark: 0,
                    settled: false,
                    final_price: None,
                };
                self.state.futures.contracts.insert(id, c.clone());
                c.mark = self.futures_quote(id).map(|q| q.fair).unwrap_or(1);
                self.state.futures.contracts.insert(id, c);
            }
        }
    }

    /// 开局时为做市方注资（计入初始货币总量）。
    pub(crate) fn init_futures(&mut self) {
        for (i, ex) in self.defs.exchanges.iter().enumerate() {
            self.state.futures.house.insert(ExchangeId::from_idx(i), ex.house_capital);
        }
        self.list_futures(self.state.day);
    }

    /// tick 第 4 步：盯市、到期处理、追保与强平、挂新合约。
    pub(crate) fn futures_day(&mut self) -> Result<(), CoreError> {
        let day = self.state.day;
        let active: Vec<FuturesId> =
            self.state.futures.contracts.values().filter(|c| !c.settled).map(|c| c.id).collect();
        let mut participants_total: Money = 0;
        let mut house_total: Money = 0;
        for id in &active {
            let (settle, lot, ex, expiring) = {
                let c = &self.state.futures.contracts[id];
                let spec = self.spec_of(c);
                let expiring = c.expiry_day <= day;
                let settle = if expiring {
                    round_tick(self.spot_of(c), spec.tick)
                } else {
                    self.futures_quote(*id).map(|q| q.fair).unwrap_or(c.mark)
                };
                (settle, spec.lot, spec.exchange, expiring)
            };
            let mark = self.state.futures.contracts[id].mark;
            let holders: Vec<(OwnerId, i64)> = self
                .state
                .futures
                .positions
                .get(id)
                .map(|b| b.iter().map(|(o, p)| (*o, p.lots)).collect())
                .unwrap_or_default();
            for (owner, lots) in holders {
                let pnl = (settle - mark) * lots * lot;
                self.settle_pnl(owner, ex, pnl)?;
                participants_total += pnl;
                house_total -= pnl;
            }
            if let Some(c) = self.state.futures.contracts.get_mut(id) {
                c.mark = settle;
                if expiring {
                    c.final_price = Some(settle);
                }
            }
            if expiring {
                self.expire_contract(*id)?;
            }
        }
        self.state.futures.mtm_log.push(MtmRecord { day, participants: participants_total, house: house_total });
        if self.state.futures.mtm_log.len() > MTM_KEPT {
            let excess = self.state.futures.mtm_log.len() - MTM_KEPT;
            self.state.futures.mtm_log.drain(0..excess);
        }
        self.margin_calls()?;
        // 清理已结算的旧合约
        let old: Vec<FuturesId> = self
            .state
            .futures
            .contracts
            .values()
            .filter(|c| c.settled && self.defs.calendar.add_months(c.expiry_day, 3).is_ok_and(|expiry| expiry < day))
            .map(|c| c.id)
            .collect();
        for id in old {
            self.state.futures.contracts.remove(&id);
            self.state.futures.positions.remove(&id);
        }
        if self.defs.calendar.month_end(day) {
            // 月末（到期处理之后）挂出下一批合约，保证下个月初仍有 3 个月可交易
            self.list_futures(day + 1);
        }
        Ok(())
    }

    /// 到期交割。
    fn expire_contract(&mut self, id: FuturesId) -> Result<(), CoreError> {
        let day = self.state.day;
        let (final_price, lot, ex, good, delivery) = {
            let c = &self.state.futures.contracts[&id];
            let spec = self.spec_of(c);
            (c.mark, spec.lot, spec.exchange, spec.good, spec.delivery)
        };
        let penalty = self.defs.exchange(ex).penalty;
        let book = self.state.futures.positions.remove(&id).unwrap_or_default();
        // 先收空头交货，再给多头发货
        let mut pool: i64 = 0;
        for (owner, p) in book.iter().filter(|(_, p)| p.physical && p.lots < 0) {
            let units = -p.lots * lot;
            let holder = Holder::Warehouse(delivery);
            let delivered = self.holder_take(*owner, holder, good, units)?;
            if delivered > 0 {
                let proceeds = final_price * delivered;
                let cost = self.agent_mut(*owner)?.book.remove(good, delivered);
                *self.state.futures.margin.entry(*owner).or_default().entry(ex).or_insert(0) += proceeds;
                *self.state.futures.house.entry(ex).or_insert(0) -= proceeds;
                self.book_internal(
                    *owner,
                    JournalEntry::new(day, Memo::Delivery, CashClass::Operating)
                        .dr(Account::MarginDeposits, proceeds)
                        .cr(Account::Sales, proceeds)
                        .dr(Account::CostOfGoods, cost)
                        .cr(Account::Inventory, cost),
                )?;
                pool += delivered;
            }
            let missing = units - delivered;
            if missing > 0 {
                // 交不出货：按惩罚价现金结算
                let fine = (penalty - Fx::ONE).apply(final_price * missing);
                self.settle_pnl(*owner, ex, -fine)?;
            }
            self.push_log(LogEvent {
                day,
                kind: LogKind::FuturesDelivery { owner: *owner, contract: id, units: delivered, missing },
            });
        }
        for (owner, p) in book.iter().filter(|(_, p)| p.physical && p.lots > 0) {
            let units = p.lots * lot;
            let from_pool = units.min(pool);
            pool -= from_pool;
            let mut need = units - from_pool;
            let mut bought = 0;
            if need > 0 {
                // 做市方从交割港现货市场采购不足部分（做市方不是玩家或商会，不受“当地出售什么”的限制，见开放市场）
                let available = self.market(delivery, good).map(|e| e.stock).unwrap_or(0);
                let q_units = need.min(available);
                if q_units > 0
                    && let Ok(q) = quote_any(self, *owner, delivery, good, Side::Buy, q_units)
                {
                    self.apply_trade_to_market(&q, None);
                    *self.state.futures.house.entry(ex).or_insert(0) -= q.gross;
                    let m = &mut self.state.money;
                    *m.sinks.entry(Flow::Exchange).or_insert(0) += q.gross;
                    self.settle_sector(self.town_sector(delivery), -q.gross, Flow::Exchange);
                    bought = q_units;
                    need -= q_units;
                }
            }
            let received = from_pool + bought;
            if received > 0 {
                let pay = final_price * received;
                *self.state.futures.margin.entry(*owner).or_default().entry(ex).or_insert(0) -= pay;
                *self.state.futures.house.entry(ex).or_insert(0) += pay;
                self.book_internal(
                    *owner,
                    JournalEntry::new(day, Memo::Delivery, CashClass::Operating)
                        .dr(Account::Inventory, pay)
                        .cr(Account::MarginDeposits, pay),
                )?;
                self.holder_add(*owner, Holder::Warehouse(delivery), good, received)?;
                self.agent_mut(*owner)?.book.add(good, received, pay);
            }
            if need > 0 {
                // 做市方也交不出的部分：按惩罚价补偿多头
                let comp = (penalty - Fx::ONE).apply(final_price * need);
                self.settle_pnl(*owner, ex, comp)?;
            }
            self.push_log(LogEvent {
                day,
                kind: LogKind::FuturesDelivery { owner: *owner, contract: id, units: received, missing: need },
            });
        }
        if pool > 0 {
            // 多余的交割货由做市方卖回现货市场（做市方不交税，只取不含税成交额；报价的所有者参数只影响税率）
            if let Ok(q) = quote(self, OwnerId::Player, delivery, good, Side::Sell, pool) {
                self.apply_trade_to_market(&q, None);
                *self.state.futures.house.entry(ex).or_insert(0) += q.gross;
                *self.state.money.sources.entry(Flow::Exchange).or_insert(0) += q.gross;
                self.settle_sector(self.town_sector(delivery), q.gross, Flow::Exchange);
            }
        }
        if let Some(c) = self.state.futures.contracts.get_mut(&id) {
            c.settled = true;
        }
        Ok(())
    }

    /// 追保：维持保证金不足时发出通知；次日仍不足则强制平仓。
    fn margin_calls(&mut self) -> Result<(), CoreError> {
        let day = self.state.day;
        let mut pairs: Vec<(OwnerId, ExchangeId)> = Vec::new();
        for (id, book) in &self.state.futures.positions {
            let Some(c) = self.state.futures.contracts.get(id) else { continue };
            let ex = self.spec_of(c).exchange;
            for owner in book.keys() {
                if !pairs.contains(&(*owner, ex)) {
                    pairs.push((*owner, ex));
                }
            }
        }
        pairs.sort();
        // 已无持仓的参与者，其追保通知自动解除
        for (owner, m) in self.state.futures.calls.iter_mut() {
            m.retain(|ex, _| pairs.contains(&(*owner, *ex)));
        }
        self.state.futures.calls.retain(|_, m| !m.is_empty());
        for (owner, ex) in pairs {
            let maint = self.defs.exchange(ex).maintenance_margin;
            let need = self.margin_requirement(owner, ex, maint);
            let have = self.margin_balance(owner, ex);
            let issued = self.state.futures.calls.get(&owner).and_then(|m| m.get(&ex)).copied();
            if have >= need {
                if let Some(m) = self.state.futures.calls.get_mut(&owner) {
                    m.remove(&ex);
                }
                continue;
            }
            match issued {
                Some(d) if d < day => {
                    self.force_liquidate(owner, ex)?;
                    if let Some(m) = self.state.futures.calls.get_mut(&owner) {
                        m.remove(&ex);
                    }
                    self.push_log(LogEvent { day, kind: LogKind::ForcedLiquidation { owner, exchange: ex } });
                }
                Some(_) => {}
                None => {
                    self.state.futures.calls.entry(owner).or_default().insert(ex, day);
                    self.push_log(LogEvent {
                        day,
                        kind: LogKind::MarginCall { owner, exchange: ex, shortfall: need - have },
                    });
                }
            }
        }
        Ok(())
    }

    /// 按做市方报价平掉某参与者在某交易所的全部持仓；保证金为负时从现金补足。
    pub(crate) fn force_liquidate(&mut self, owner: OwnerId, ex: ExchangeId) -> Result<(), CoreError> {
        let ids: Vec<(FuturesId, i64)> = self
            .state
            .futures
            .positions
            .iter()
            .filter_map(|(id, book)| {
                let c = self.state.futures.contracts.get(id)?;
                if self.spec_of(c).exchange != ex {
                    return None;
                }
                book.get(&owner).map(|p| (*id, p.lots))
            })
            .collect();
        for (id, lots) in ids {
            let price = self.futures_exec_price(id, -lots).unwrap_or(0);
            self.futures_fill(owner, id, -lots, price)?;
        }
        let bal = self.margin_balance(owner, ex);
        if bal < 0 {
            let day = self.state.day;
            // 负保证金由现金补足（内部划转）
            *self.state.futures.margin.entry(owner).or_default().entry(ex).or_insert(0) = 0;
            self.book_internal(
                owner,
                JournalEntry::new(day, Memo::Margin, CashClass::Operating)
                    .dr(Account::MarginDeposits, -bal)
                    .cr(Account::Cash, -bal),
            )?;
        }
        Ok(())
    }

    /// 全部保证金账户与做市方账户之和（计入世界货币总量）。
    pub fn futures_money(&self) -> Money {
        let m: Money = self.state.futures.margin.values().flat_map(|x| x.values()).sum();
        let h: Money = self.state.futures.house.values().sum();
        m + h
    }
}

/// 期货命令的校验结果。
pub(crate) enum FuturesPlan {
    Trade { id: FuturesId, lots: i64, price: Money },
    Deposit { ex: ExchangeId, amount: Money },
    Withdraw { ex: ExchangeId, amount: Money },
    Delivery { id: FuturesId, physical: bool },
}

pub(crate) fn check_trade(
    world: &World,
    owner: OwnerId,
    id: FuturesId,
    lots: i64,
) -> Result<FuturesPlan, CommandError> {
    let c = world.state.futures.contracts.get(&id).ok_or_else(|| CommandError::NotFound(format!("{id:?}")))?;
    if c.settled || c.expiry_day < world.day() {
        return Err(crate::error::Reason::new("futures.expired", "合约已到期").rule());
    }
    if lots == 0 {
        return Err(CommandError::InvalidQuantity);
    }
    let spec = world.spec_of(c);
    let ex = world.defs.exchange(spec.exchange);
    let current = world.position(owner, id).map(|p| p.lots).unwrap_or(0);
    let after = current + lots;
    if after.abs() > ex.position_limit && after.abs() > current.abs() {
        return Err(crate::error::Reason::new(
            "futures.position_limit",
            format!("超出持仓上限 {} 手", ex.position_limit),
        )
        .arg("max", crate::text::TextArg::Int(ex.position_limit))
        .range());
    }
    let price = world.futures_exec_price(id, lots).ok_or(CommandError::NotFound("报价".into()))?;
    // 成交后保证金（含成交价差的即时结算）须覆盖全部持仓的初始保证金
    let immediate = (c.mark - price) * lots * spec.lot;
    let balance = world.margin_balance(owner, spec.exchange) + immediate;
    let existing = world.margin_requirement(owner, spec.exchange, ex.initial_margin);
    let this_before = ex.initial_margin.apply(current.abs() * spec.lot * c.mark);
    let this_after = ex.initial_margin.apply(after.abs() * spec.lot * c.mark);
    let need = existing - this_before + this_after;
    if after.abs() > current.abs() && balance < need {
        return Err(crate::error::Reason::new(
            "futures.margin",
            format!("保证金不足：需要 {need}，成交后余额 {balance}"),
        )
        .arg("need", crate::text::TextArg::Int(need))
        .arg("balance", crate::text::TextArg::Int(balance))
        .rule());
    }
    Ok(FuturesPlan::Trade { id, lots, price })
}

pub(crate) fn check_deposit(
    world: &World,
    owner: OwnerId,
    ex: ExchangeId,
    amount: Money,
) -> Result<FuturesPlan, CommandError> {
    if world.defs.exchanges.get(ex.idx()).is_none() {
        return Err(CommandError::NotFound(format!("{ex:?}")));
    }
    if amount <= 0 {
        return Err(CommandError::InvalidQuantity);
    }
    let have = world.agent(owner)?.cash;
    if have < amount {
        return Err(CommandError::InsufficientCash { need: amount, have });
    }
    Ok(FuturesPlan::Deposit { ex, amount })
}

pub(crate) fn check_withdraw(
    world: &World,
    owner: OwnerId,
    ex: ExchangeId,
    amount: Money,
) -> Result<FuturesPlan, CommandError> {
    let e = world.defs.exchanges.get(ex.idx()).ok_or_else(|| CommandError::NotFound(format!("{ex:?}")))?;
    let bal = world.margin_balance(owner, ex);
    let locked = world.margin_requirement(owner, ex, e.initial_margin);
    let free = (bal - locked).max(0);
    if amount <= 0 || amount > free {
        return Err(crate::error::Reason::new("futures.withdraw", format!("可提取的保证金为 {free}"))
            .arg("free", crate::text::TextArg::Int(free))
            .range());
    }
    Ok(FuturesPlan::Withdraw { ex, amount })
}

pub(crate) fn check_delivery(
    world: &World,
    owner: OwnerId,
    id: FuturesId,
    physical: bool,
) -> Result<FuturesPlan, CommandError> {
    let c = world.state.futures.contracts.get(&id).ok_or_else(|| CommandError::NotFound(format!("{id:?}")))?;
    if c.settled {
        return Err(crate::error::Reason::new("futures.expired", "合约已到期").rule());
    }
    world
        .position(owner, id)
        .ok_or_else(|| crate::error::Reason::new("futures.no_position", "没有该合约的持仓").rule())?;
    Ok(FuturesPlan::Delivery { id, physical })
}

pub(crate) fn exec(world: &mut World, owner: OwnerId, plan: FuturesPlan) -> Result<Option<Money>, CommandError> {
    let day = world.state.day;
    match plan {
        FuturesPlan::Trade { id, lots, price } => Ok(Some(world.futures_fill(owner, id, lots, price)?)),
        FuturesPlan::Deposit { ex, amount } => {
            *world.state.futures.margin.entry(owner).or_default().entry(ex).or_insert(0) += amount;
            world.book_internal(
                owner,
                JournalEntry::new(day, Memo::Margin, CashClass::Operating)
                    .dr(Account::MarginDeposits, amount)
                    .cr(Account::Cash, amount),
            )?;
            Ok(None)
        }
        FuturesPlan::Withdraw { ex, amount } => {
            *world.state.futures.margin.entry(owner).or_default().entry(ex).or_insert(0) -= amount;
            world.book_internal(
                owner,
                JournalEntry::new(day, Memo::Margin, CashClass::Operating)
                    .dr(Account::Cash, amount)
                    .cr(Account::MarginDeposits, amount),
            )?;
            Ok(None)
        }
        FuturesPlan::Delivery { id, physical } => {
            if let Some(p) = world.state.futures.positions.get_mut(&id).and_then(|b| b.get_mut(&owner)) {
                p.physical = physical;
            }
            Ok(None)
        }
    }
}
