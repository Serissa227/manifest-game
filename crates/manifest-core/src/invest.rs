//! 港口投资与同盟港。
//!
//! 投资提升港口发展度（影响产量与需求上限）并累计投资者的占有率。占有率最高且超过阈值的
//! 所有者使该港成为其同盟港：交易税优惠、特产商品优先供货（价格折扣）、可免费使用商馆容量。
//! 超出初始值的发展度每月衰减 1 点（`[invest] decay_months` 可以放慢到每几个月 1 点）。
//!
//! 商馆、货档与商誉（T01，[`crate::access`]，`rules.toml [access]`）打开时：累计投资同时就是商馆的等级
//! （商誉加成、交易税乘数、免费仓位）；同盟港另要商馆达到 `ally_house` 级（否则没人投过的港口投最低额就占满、立刻成同盟港）；
//! 投资带来的声望按同一港口的累计额每 `invest_rep_per` 一点，不再每笔保底一点。关闭时与旧版逐日一致。

use crate::error::{CommandError, CoreError};
use crate::fixed::{Fx, Money, mul_div};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::treasury::Flow;
use crate::world::World;

impl World {
    /// 某所有者在某港的投资占有率。
    pub fn investment_share(&self, owner: OwnerId, loc: LocId) -> Fx {
        let Some(ls) = self.state.locations.get(loc.idx()) else { return Fx::ZERO };
        let total: Money = ls.investments.values().sum();
        Fx::ratio(ls.investments.get(&owner).copied().unwrap_or(0), total.max(1))
    }

    /// 重新判定同盟港。
    pub(crate) fn update_ally(&mut self, loc: LocId) {
        let threshold = self.defs.rules.invest.ally_share;
        let day = self.state.day;
        let ls = &self.state.locations[loc.idx()];
        let total: Money = ls.investments.values().sum();
        let best = ls.investments.iter().max_by(|a, b| a.1.cmp(b.1).then(b.0.cmp(a.0))).map(|(o, v)| (*o, *v));
        // 商馆规则打开时还要商馆够级（关闭时 ally_house 不起作用）
        let access = &self.defs.rules.access;
        let house_ok = |o: OwnerId| !access.enabled || self.house_level(o, loc) >= access.ally_house;
        let new_ally = best.and_then(|(o, v)| (Fx::ratio(v, total.max(1)) >= threshold && house_ok(o)).then_some(o));
        if new_ally != ls.ally {
            self.state.locations[loc.idx()].ally = new_ally;
            if let Some(owner) = new_ally {
                self.push_log(LogEvent { day, kind: LogKind::AllyPort { loc, owner } });
            }
        }
    }

    /// 月初：超出初始值的发展度衰减。
    pub(crate) fn invest_step(&mut self) -> Result<(), CoreError> {
        if self.defs.rules.development.enabled {
            if self.state.day > 0 && self.defs.calendar.month_start(self.state.day) {
                self.development_month();
            }
            return Ok(());
        }
        if !self.defs.calendar.month_start(self.state.day) {
            return Ok(());
        }
        // 每隔 decay_months 个月才衰减一次（缺省 1：每月）
        let every = self.defs.rules.invest.decay_months.max(1);
        if every > 1 && !self.defs.calendar.month_index(self.state.day).is_multiple_of(every) {
            return Ok(());
        }
        let defs = self.defs.clone();
        for (i, ls) in self.state.locations.iter_mut().enumerate() {
            if ls.development > defs.locations[i].development {
                ls.development -= 1;
            }
        }
        Ok(())
    }
}

/// 发展度提升点数：成本随现有发展度递增。
pub fn development_gain(world: &World, loc: LocId, amount: Money) -> i64 {
    if world.defs.rules.development.enabled {
        let Some(ls) = world.state.locations.get(loc.idx()) else { return 0 };
        let (dev, _) =
            crate::development::purchase(&world.defs.rules.development, ls.development, ls.growth.frac, amount);
        return dev - ls.development;
    }
    let rules = &world.defs.rules.invest;
    let dev = world.state.locations.get(loc.idx()).map(|l| l.development).unwrap_or(100);
    let per_point = rules.cost_per_point + mul_div(rules.cost_per_point, dev, 50);
    (amount / per_point.max(1)).min(100 - dev).max(0)
}

pub(crate) struct InvestPlan {
    pub loc: LocId,
    pub amount: Money,
    pub gain: i64,
    pub frac: i64,
}

pub(crate) fn check(world: &World, owner: OwnerId, loc: LocId, amount: Money) -> Result<InvestPlan, CommandError> {
    let defs = &world.defs;
    let l = defs.locations.get(loc.idx()).ok_or_else(|| CommandError::NotFound(format!("{loc:?}")))?;
    if !l.is_port() {
        return Err(CommandError::NotAPort);
    }
    if amount < defs.rules.invest.min_amount {
        return Err(crate::error::Reason::new("invest.min", format!("投资额至少 {}", defs.rules.invest.min_amount))
            .arg("min", crate::text::TextArg::Int(defs.rules.invest.min_amount))
            .range());
    }
    let have = world.agent(owner)?.cash;
    if have < amount {
        return Err(CommandError::InsufficientCash { need: amount, have });
    }
    let (gain, frac) = if defs.rules.development.enabled {
        let ls = &world.state.locations[loc.idx()];
        let (dev, frac) = crate::development::purchase(&defs.rules.development, ls.development, ls.growth.frac, amount);
        (dev - ls.development, frac)
    } else {
        (development_gain(world, loc, amount), 0)
    };
    Ok(InvestPlan { loc, amount, gain, frac })
}

pub(crate) fn exec(world: &mut World, owner: OwnerId, plan: InvestPlan) -> Result<(), CommandError> {
    let day = world.state.day;
    world.book_external(
        owner,
        Flow::Investment,
        world.town_sector(plan.loc),
        JournalEntry::new(day, Memo::Investment, CashClass::Investing)
            .dr(Account::Investment, plan.amount)
            .cr(Account::Cash, plan.amount),
    )?;
    let before = world.invested(owner, plan.loc);
    let ls = &mut world.state.locations[plan.loc.idx()];
    if world.defs.rules.development.enabled {
        let before = ls.development * crate::development::POINT_BP + ls.growth.frac;
        ls.development = (ls.development + plan.gain).min(world.defs.rules.development.max);
        ls.growth.frac = plan.frac;
        let after = ls.development * crate::development::POINT_BP + plan.frac;
        ls.growth.month_invest = ls.growth.month_invest.saturating_add(after - before);
    } else {
        ls.development = (ls.development + plan.gain).min(100);
    }
    *ls.investments.entry(owner).or_insert(0) += plan.amount;
    let faction = world.location_faction(plan.loc);
    let reputation = if world.access_on() {
        // 按同一港口的累计额每满一档一点，不保底（每笔保底一点时，拆成最低额反复投就能刷声望）
        crate::access::invest_reputation(world, before, plan.amount)
    } else {
        (plan.amount / 20_000).clamp(1, 10)
    };
    if reputation != 0 {
        world.adjust_reputation(owner, faction, reputation);
    }
    world.update_ally(plan.loc);
    Ok(())
}
