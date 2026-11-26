//! 银行与信用。
//!
//! 存款按月计息；贷款的可贷额度与利率由信用评级决定，按月付息、到期还本。
//! 到期无力偿还即违约：违约记录增加、信用降级，贷款转为逾期并上浮利率。
//! 信用评级每月根据账本数据（资产、负债、现金、违约记录）重算。银行视为外部机构，
//! 存取款、放贷与还款都记为外部资金往来。

use crate::circulation::Sector;
use crate::error::{CommandError, CoreError, Reason};
use crate::fixed::{Fx, Money, mul_div};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::text::TextArg;
use crate::treasury::Flow;
use crate::world::World;
use serde::{Deserialize, Serialize};

/// 信用记录。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Credit {
    /// 信用分 0–100
    pub score: i64,
    pub defaults: u32,
}

impl Default for Credit {
    fn default() -> Self {
        Credit { score: 60, defaults: 0 }
    }
}

/// 信用等级。
pub fn grade(score: i64) -> &'static str {
    match score {
        90.. => "AAA",
        80..=89 => "AA",
        70..=79 => "A",
        60..=69 => "BBB",
        50..=59 => "BB",
        40..=49 => "B",
        25..=39 => "CCC",
        _ => "D",
    }
}

/// 贷款。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Loan {
    pub id: LoanId,
    pub owner: OwnerId,
    pub principal: Money,
    /// 年利率
    pub rate: Fx,
    pub start_day: u32,
    pub due_day: u32,
    pub overdue: bool,
}

impl World {
    pub fn loans_of(&self, owner: OwnerId) -> impl Iterator<Item = &Loan> {
        self.state.loans.values().filter(move |l| l.owner == owner)
    }

    pub fn loan_total(&self, owner: OwnerId) -> Money {
        self.loans_of(owner).map(|l| l.principal).sum()
    }

    /// 按信用分计算的贷款年利率。
    pub fn loan_rate(&self, owner: OwnerId) -> Fx {
        let rules = &self.defs.rules.bank;
        let score = self.state.agents.get(&owner).map(|a| a.credit.score).unwrap_or(0);
        (rules.loan_base_rate + rules.loan_risk_premium.mul(Fx::ratio(100 - score.clamp(0, 100), 100)))
            .mul(self.interest_mult())
    }

    /// 可贷额度：信用分决定可借的权益倍数，再减去已有贷款。
    pub fn loan_limit(&self, owner: OwnerId) -> Money {
        let Some(a) = self.state.agents.get(&owner) else { return 0 };
        let equity = a.ledger.equity().max(0);
        let mult = match a.credit.score {
            80.. => Fx::from_int(2),
            60..=79 => Fx::ONE,
            40..=59 => Fx::from_pct(50),
            25..=39 => Fx::from_pct(20),
            _ => Fx::ZERO,
        };
        (mult.apply(equity) - self.loan_total(owner)).max(0)
    }

    /// 根据账本数据重算信用分。
    fn recompute_credit(&mut self, owner: OwnerId) {
        let loans = self.loan_total(owner);
        let Some(a) = self.state.agents.get(&owner) else { return };
        let assets = a.ledger.total_assets().max(1);
        let liabilities = a.ledger.total_liabilities().max(0);
        let equity = a.ledger.equity();
        let mut score = 50;
        // 规模：权益每 10 万文 +1，最多 +20
        score += (equity / 100_000).clamp(-20, 20);
        // 负债率越低越好
        score += 25 - mul_div(liabilities, 50, assets).min(50);
        // 现金充足
        if a.cash > loans / 5 {
            score += 5;
        }
        if a.cash < 0 {
            score -= 15;
        }
        score -= a.credit.defaults as i64 * 15;
        let score = score.clamp(0, 100);
        if let Some(a) = self.state.agents.get_mut(&owner) {
            a.credit.score = score;
        }
    }

    /// 账本日结的一部分：月末计息、到期还本、违约处理与信用重算。
    pub(crate) fn bank_day_end(&mut self) -> Result<(), CoreError> {
        let day = self.state.day;
        let rules = self.defs.rules.bank.clone();
        // 到期还本（每天检查）
        let due: Vec<LoanId> = self.state.loans.values().filter(|l| l.due_day <= day).map(|l| l.id).collect();
        for id in due {
            let Some(loan) = self.state.loans.get(&id).cloned() else { continue };
            let cash = self.agent(loan.owner)?.cash;
            if cash >= loan.principal {
                self.book_external(
                    loan.owner,
                    Flow::Bank,
                    Sector::Bank,
                    JournalEntry::new(day, Memo::Bank, CashClass::Financing)
                        .dr(Account::Loans, loan.principal)
                        .cr(Account::Cash, loan.principal),
                )?;
                self.state.loans.remove(&id);
            } else {
                // 违约：延期一个日历月、利率上浮、信用受损
                if let Some(l) = self.state.loans.get_mut(&id) {
                    l.overdue = true;
                    l.due_day = self.defs.calendar.add_months(day, 1).unwrap_or(u32::MAX);
                    l.rate = l.rate.mul(Fx::ONE + rules.overdue_penalty);
                }
                if let Some(a) = self.state.agents.get_mut(&loan.owner) {
                    a.credit.defaults += 1;
                    a.credit.score = (a.credit.score - 25).max(0);
                }
                for f in self.defs.faction_ids().collect::<Vec<_>>() {
                    self.adjust_reputation(loan.owner, f, -5);
                }
                self.push_log(LogEvent { day, kind: LogKind::LoanDefault { owner: loan.owner, loan: id } });
            }
        }
        if !self.defs.calendar.month_end(day) {
            return Ok(());
        }
        // 月末：存款利息、贷款利息
        let owners: Vec<OwnerId> = self.state.agents.keys().copied().collect();
        for owner in owners {
            let deposit = self.agent(owner)?.deposit;
            let interest = mul_div(rules.deposit_rate.apply(deposit), 1, self.defs.calendar.months().len() as i64);
            if interest > 0 {
                // 利息直接计入存款余额（外部来源，不经过现金）
                self.agent_mut(owner)?.deposit += interest;
                self.book_internal(
                    owner,
                    JournalEntry::new(day, Memo::Interest, CashClass::Operating)
                        .dr(Account::BankDeposits, interest)
                        .cr(Account::InterestIncome, interest),
                )?;
            }
            let loan_interest: Money = self
                .loans_of(owner)
                .map(|l| mul_div(l.rate.apply(l.principal), 1, self.defs.calendar.months().len() as i64))
                .sum();
            if loan_interest > 0 {
                self.book_external(
                    owner,
                    Flow::Bank,
                    Sector::Bank,
                    JournalEntry::new(day, Memo::Interest, CashClass::Operating)
                        .dr(Account::InterestExpense, loan_interest)
                        .cr(Account::Cash, loan_interest),
                )?;
            }
            self.recompute_credit(owner);
        }
        Ok(())
    }

    /// 破产或重组时核销贷款（负债免除计为其他收入，不涉及现金）。
    pub(crate) fn write_off_loans(&mut self, owner: OwnerId) -> Result<(), CoreError> {
        let day = self.state.day;
        let ids: Vec<LoanId> = self.loans_of(owner).map(|l| l.id).collect();
        for id in ids {
            if let Some(l) = self.state.loans.remove(&id) {
                self.book_internal(
                    owner,
                    JournalEntry::new(day, Memo::Reorganization, CashClass::Financing)
                        .dr(Account::Loans, l.principal)
                        .cr(Account::OtherIncome, l.principal),
                )?;
            }
        }
        Ok(())
    }
}

/// 银行命令的校验结果。
pub(crate) enum BankPlan {
    Deposit(Money),
    Withdraw(Money),
    Borrow { amount: Money, months: u32, rate: Fx, guarantee: bool },
    Repay { id: LoanId, amount: Money },
}

pub(crate) fn check_deposit(world: &World, owner: OwnerId, amount: Money) -> Result<BankPlan, CommandError> {
    if amount <= 0 {
        return Err(CommandError::InvalidQuantity);
    }
    let have = world.agent(owner)?.cash;
    if have < amount {
        return Err(CommandError::InsufficientCash { need: amount, have });
    }
    Ok(BankPlan::Deposit(amount))
}

pub(crate) fn check_withdraw(world: &World, owner: OwnerId, amount: Money) -> Result<BankPlan, CommandError> {
    let deposit = world.agent(owner)?.deposit;
    if amount <= 0 || amount > deposit {
        return Err(Reason::new("bank.withdraw_range", format!("取款额必须在 1 到 {deposit} 之间"))
            .arg("max", TextArg::Int(deposit))
            .range());
    }
    Ok(BankPlan::Withdraw(amount))
}

pub(crate) fn check_borrow(
    world: &World,
    owner: OwnerId,
    amount: Money,
    months: u32,
) -> Result<BankPlan, CommandError> {
    let rules = &world.defs.rules.bank;
    if amount <= 0 {
        return Err(CommandError::InvalidQuantity);
    }
    if months == 0 || months > rules.max_term_months {
        return Err(Reason::new("bank.term_range", format!("期限必须在 1 到 {} 个月之间", rules.max_term_months))
            .arg("max", TextArg::Int(i64::from(rules.max_term_months)))
            .range());
    }
    let guarantee=owner==OwnerId::Player && world.state.story2.flags.contains("family_guarantee") && !world.state.story2.flags.contains("family_guarantee_used")
        && world.defs.rules.upbringing.act.as_ref().is_some_and(|r|amount<=r.guarantee.amount)
        && world.state.fleets.values().any(|f|f.owner==owner && matches!(f.location,crate::world::FleetLocation::Docked(at) if world.state.agents.get(&owner).is_some_and(|a|a.home==at)));
    let limit = if guarantee { world.loan_limit(owner).max(amount) } else { world.loan_limit(owner) };
    if amount > limit {
        return Err(Reason::new("bank.over_limit", format!("超出可贷额度 {limit}"))
            .arg("limit", TextArg::Int(limit))
            .range());
    }
    let term = i32::try_from(months).map_err(|_| CommandError::OutOfRange("贷款期限超出日历范围".into()))?;
    world.defs.calendar.add_months(world.day(), term).map_err(|e| CommandError::OutOfRange(e.to_string()))?;
    let rate = if guarantee {
        world
            .loan_rate(owner)
            .mul(Fx::from_pct(world.defs.rules.upbringing.act.as_ref().map_or(100, |r| r.guarantee.rate_pct)))
    } else {
        world.loan_rate(owner)
    };
    Ok(BankPlan::Borrow { amount, months, rate, guarantee })
}

pub(crate) fn check_repay(world: &World, owner: OwnerId, id: LoanId, amount: Money) -> Result<BankPlan, CommandError> {
    let loan = world.state.loans.get(&id).ok_or_else(|| CommandError::NotFound(format!("{id:?}")))?;
    if loan.owner != owner {
        return Err(CommandError::NotOwner);
    }
    if amount <= 0 || amount > loan.principal {
        return Err(Reason::new("bank.repay_range", format!("还款额必须在 1 到 {} 之间", loan.principal))
            .arg("max", TextArg::Int(loan.principal))
            .range());
    }
    let have = world.agent(owner)?.cash;
    if have < amount {
        return Err(CommandError::InsufficientCash { need: amount, have });
    }
    Ok(BankPlan::Repay { id, amount })
}

pub(crate) fn exec(world: &mut World, owner: OwnerId, plan: BankPlan) -> Result<Option<LoanId>, CommandError> {
    let day = world.state.day;
    match plan {
        BankPlan::Deposit(amount) => {
            world.book_external(
                owner,
                Flow::Bank,
                Sector::Bank,
                JournalEntry::new(day, Memo::Bank, CashClass::Investing)
                    .dr(Account::BankDeposits, amount)
                    .cr(Account::Cash, amount),
            )?;
            world.agent_mut(owner)?.deposit += amount;
            Ok(None)
        }
        BankPlan::Withdraw(amount) => {
            world.book_external(
                owner,
                Flow::Bank,
                Sector::Bank,
                JournalEntry::new(day, Memo::Bank, CashClass::Investing)
                    .dr(Account::Cash, amount)
                    .cr(Account::BankDeposits, amount),
            )?;
            world.agent_mut(owner)?.deposit -= amount;
            Ok(None)
        }
        BankPlan::Borrow { amount, months, rate, guarantee } => {
            let term = i32::try_from(months).map_err(|_| CommandError::OutOfRange("贷款期限超出日历范围".into()))?;
            let due_day =
                world.defs.calendar.add_months(day, term).map_err(|e| CommandError::OutOfRange(e.to_string()))?;
            world.book_external(
                owner,
                Flow::Bank,
                Sector::Bank,
                JournalEntry::new(day, Memo::Bank, CashClass::Financing)
                    .dr(Account::Cash, amount)
                    .cr(Account::Loans, amount),
            )?;
            let id = LoanId(world.state.next_loan.max(1));
            world.state.next_loan = id.0 + 1;
            world
                .state
                .loans
                .insert(id, Loan { id, owner, principal: amount, rate, start_day: day, due_day, overdue: false });
            if guarantee {
                world.state.story2.flags.insert("family_guarantee_used".into());
            }
            Ok(Some(id))
        }
        BankPlan::Repay { id, amount } => {
            world.book_external(
                owner,
                Flow::Bank,
                Sector::Bank,
                JournalEntry::new(day, Memo::Bank, CashClass::Financing)
                    .dr(Account::Loans, amount)
                    .cr(Account::Cash, amount),
            )?;
            let done = {
                let l = world.state.loans.get_mut(&id).ok_or_else(|| CommandError::Internal("贷款不存在".into()))?;
                l.principal -= amount;
                l.principal == 0
            };
            if done {
                world.state.loans.remove(&id);
            }
            Ok(Some(id))
        }
    }
}
