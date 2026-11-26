//! 复式记账与财务报表。
//!
//! 余额按"借正贷负"记：资产、费用通常为正；负债、权益、收入通常为负。
//! 每笔分录借贷相等，因此全部科目余额之和恒为 0（试算平衡）。
//! 存货按移动加权平均成本计价（见 [`InventoryBook`]）。

use crate::calendar::Calendar;
use crate::fixed::{Money, mul_div};
use crate::ids::GoodId;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 会计科目。
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Debug)]
pub enum Account {
    // ── 资产 ──
    Cash,
    Inventory,
    Ships,
    Property,
    Receivables,
    MarginDeposits,
    BankDeposits,
    // ── 负债 ──
    Payables,
    Loans,
    // ── 所有者权益 ──
    Capital,
    RetainedEarnings,
    // ── 收入 ──
    Sales,
    FuturesGains,
    InterestIncome,
    ContractIncome,
    AssetGains,
    OtherIncome,
    // ── 费用 ──
    CostOfGoods,
    Wages,
    Supplies,
    Repairs,
    Taxes,
    Fees,
    InterestExpense,
    FuturesLosses,
    Losses,
    Investment,
    OtherExpense,
    // ── 收入（追加在末尾：科目的先后决定账本里的排序与存档的字节，只能追加）──
    /// 商馆分红（T02）
    HouseDividends,
    // ── 资产（同上，只能追加）──
    /// 代办挂单的预留金（T03）：买单挂着时从现金里留出来，撤单或成交时退回
    AgencyEscrow,
}

/// 科目大类。
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum AccountKind {
    Asset,
    Liability,
    Equity,
    Income,
    Expense,
}

impl Account {
    pub const ALL: [Account; 30] = [
        Account::Cash,
        Account::Inventory,
        Account::Ships,
        Account::Property,
        Account::Receivables,
        Account::MarginDeposits,
        Account::BankDeposits,
        Account::Payables,
        Account::Loans,
        Account::Capital,
        Account::RetainedEarnings,
        Account::Sales,
        Account::FuturesGains,
        Account::InterestIncome,
        Account::ContractIncome,
        Account::AssetGains,
        Account::OtherIncome,
        Account::CostOfGoods,
        Account::Wages,
        Account::Supplies,
        Account::Repairs,
        Account::Taxes,
        Account::Fees,
        Account::InterestExpense,
        Account::FuturesLosses,
        Account::Losses,
        Account::Investment,
        Account::OtherExpense,
        Account::HouseDividends,
        Account::AgencyEscrow,
    ];

    pub fn kind(self) -> AccountKind {
        use Account::*;
        match self {
            Cash | Inventory | Ships | Property | Receivables | MarginDeposits | BankDeposits | AgencyEscrow => {
                AccountKind::Asset
            }
            Payables | Loans => AccountKind::Liability,
            Capital | RetainedEarnings => AccountKind::Equity,
            Sales | FuturesGains | InterestIncome | ContractIncome | AssetGains | OtherIncome | HouseDividends => {
                AccountKind::Income
            }
            CostOfGoods | Wages | Supplies | Repairs | Taxes | Fees | InterestExpense | FuturesLosses | Losses
            | Investment | OtherExpense => AccountKind::Expense,
        }
    }
}

/// 现金流量分类。
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum CashClass {
    Operating,
    Investing,
    Financing,
}

impl CashClass {
    fn index(self) -> usize {
        match self {
            CashClass::Operating => 0,
            CashClass::Investing => 1,
            CashClass::Financing => 2,
        }
    }
}

/// 分录摘要类别（界面据此显示说明）。
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum Memo {
    Opening,
    Purchase,
    Sale,
    Wages,
    Supplies,
    CrewHire,
    Repair,
    ShipPurchase,
    ShipSale,
    Refit,
    CargoLoss,
    ShipLoss,
    Tribute,
    Margin,
    FuturesSettlement,
    Delivery,
    Toll,
    Rent,
    Warehouse,
    Industry,
    Contract,
    Investment,
    Bank,
    Interest,
    License,
    Bargain,
    Reorganization,
    Liquidation,
    YearClose,
    Other,
    /// 殖民地（建立、建设、维护、税收、粮食与消费品）
    Colony,
    /// 报告发现物
    Discovery,
    /// 商会的年末分红
    Dividend,
    /// 行情通报
    MarketReport,
    /// 商会的维护费（货币流通，ECONOMY.md 6.9）
    Overhead,
    /// 商馆分红（T02）
    HouseDividend,
    /// 商馆代办：挂单预留、退回与代办费（T03）
    Agency,
}

/// 分录的一行：金额为正表示借方，为负表示贷方。
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct Line {
    pub account: Account,
    pub amount: i64,
}

/// 一笔分录。
#[derive(Clone, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub struct JournalEntry {
    pub day: u32,
    pub memo: Memo,
    pub class: CashClass,
    pub lines: Vec<Line>,
}

impl JournalEntry {
    pub fn new(day: u32, memo: Memo, class: CashClass) -> Self {
        Self { day, memo, class, lines: Vec::new() }
    }

    /// 借记。
    pub fn dr(mut self, account: Account, amount: i64) -> Self {
        if amount != 0 {
            self.lines.push(Line { account, amount });
        }
        self
    }

    /// 贷记。
    pub fn cr(mut self, account: Account, amount: i64) -> Self {
        if amount != 0 {
            self.lines.push(Line { account, amount: -amount });
        }
        self
    }

    pub fn is_balanced(&self) -> bool {
        self.lines.iter().map(|l| l.amount as i128).sum::<i128>() == 0
    }
}

/// 记账错误。
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum LedgerError {
    #[error("分录借贷不平衡：{0:?}")]
    Unbalanced(JournalEntry),
}

/// 期间累计。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PeriodTotals {
    pub start_day: u32,
    pub opening_cash: i64,
    /// 各科目本期发生额（借正贷负）
    pub movements: BTreeMap<Account, i64>,
    /// 现金净流入：经营 / 投资 / 筹资
    pub cash_flows: [i64; 3],
}

impl PeriodTotals {
    fn new(start_day: u32, opening_cash: i64) -> Self {
        Self { start_day, opening_cash, movements: BTreeMap::new(), cash_flows: [0; 3] }
    }
}

/// 报表期间。
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum PeriodKind {
    Month,
    Year,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BalanceSheet {
    pub assets: Vec<(Account, Money)>,
    pub liabilities: Vec<(Account, Money)>,
    pub equity: Vec<(Account, Money)>,
    /// 尚未结转的本年利润
    pub current_earnings: Money,
    pub total_assets: Money,
    pub total_liabilities: Money,
    pub total_equity: Money,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct IncomeStatement {
    pub revenues: Vec<(Account, Money)>,
    pub expenses: Vec<(Account, Money)>,
    pub total_revenue: Money,
    pub total_expense: Money,
    pub net_income: Money,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CashFlowStatement {
    pub operating: Money,
    pub investing: Money,
    pub financing: Money,
    pub net_change: Money,
    pub opening_cash: Money,
    pub closing_cash: Money,
}

/// 一期财务报表。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FinancialReport {
    pub kind: PeriodKind,
    /// 月报为全局月序号，年报为年序号（均从 0 开始）
    pub index: u32,
    pub start_day: u32,
    pub end_day: u32,
    pub balance_sheet: BalanceSheet,
    pub income: IncomeStatement,
    pub cash_flow: CashFlowStatement,
}

/// 月报保留的份数。
pub const MONTHLY_REPORTS_KEPT: usize = 36;
/// 最近分录保留的条数。
pub const RECENT_ENTRIES_KEPT: usize = 60;

/// 一个所有者的账本。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ledger {
    pub balances: BTreeMap<Account, i64>,
    pub month: PeriodTotals,
    pub year: PeriodTotals,
    pub monthly: Vec<FinancialReport>,
    pub yearly: Vec<FinancialReport>,
    pub recent: Vec<JournalEntry>,
    pub entries_posted: u64,
}

impl Default for Ledger {
    fn default() -> Self {
        Self::new()
    }
}

impl Ledger {
    pub fn new() -> Self {
        Self {
            balances: BTreeMap::new(),
            month: PeriodTotals::new(0, 0),
            year: PeriodTotals::new(0, 0),
            monthly: Vec::new(),
            yearly: Vec::new(),
            recent: Vec::new(),
            entries_posted: 0,
        }
    }

    pub fn balance(&self, account: Account) -> i64 {
        self.balances.get(&account).copied().unwrap_or(0)
    }

    /// 过账。借贷不平衡时拒绝且不改变任何余额。
    pub fn post(&mut self, entry: JournalEntry) -> Result<(), LedgerError> {
        if !entry.is_balanced() {
            return Err(LedgerError::Unbalanced(entry));
        }
        if entry.lines.is_empty() {
            return Ok(());
        }
        for line in &entry.lines {
            *self.balances.entry(line.account).or_insert(0) += line.amount;
            *self.month.movements.entry(line.account).or_insert(0) += line.amount;
            *self.year.movements.entry(line.account).or_insert(0) += line.amount;
            if line.account == Account::Cash {
                self.month.cash_flows[entry.class.index()] += line.amount;
                self.year.cash_flows[entry.class.index()] += line.amount;
            }
        }
        self.balances.retain(|_, v| *v != 0);
        self.entries_posted += 1;
        self.recent.push(entry);
        if self.recent.len() > RECENT_ENTRIES_KEPT {
            let excess = self.recent.len() - RECENT_ENTRIES_KEPT;
            self.recent.drain(0..excess);
        }
        Ok(())
    }

    /// 试算平衡：全部余额之和为 0。
    pub fn is_balanced(&self) -> bool {
        self.balances.values().map(|v| *v as i128).sum::<i128>() == 0
    }

    fn sum_kind(&self, kind: AccountKind) -> i64 {
        self.balances.iter().filter(|(a, _)| a.kind() == kind).map(|(_, v)| *v).sum()
    }

    pub fn total_assets(&self) -> Money {
        self.sum_kind(AccountKind::Asset)
    }

    pub fn total_liabilities(&self) -> Money {
        -self.sum_kind(AccountKind::Liability)
    }

    /// 所有者权益（含未结转利润）= 资产 − 负债。
    pub fn equity(&self) -> Money {
        self.total_assets() - self.total_liabilities()
    }

    /// 会计恒等式：资产 = 负债 + 权益 + (收入 − 费用)。
    pub fn identity_holds(&self) -> bool {
        let assets = self.sum_kind(AccountKind::Asset) as i128;
        let liab = -(self.sum_kind(AccountKind::Liability) as i128);
        let equity = -(self.sum_kind(AccountKind::Equity) as i128);
        let income = -(self.sum_kind(AccountKind::Income) as i128);
        let expense = self.sum_kind(AccountKind::Expense) as i128;
        assets == liab + equity + income - expense
    }

    pub fn balance_sheet(&self) -> BalanceSheet {
        let pick = |kind: AccountKind, sign: i64| -> Vec<(Account, Money)> {
            Account::ALL
                .iter()
                .filter(|a| a.kind() == kind)
                .map(|a| (*a, self.balance(*a) * sign))
                .filter(|(_, v)| *v != 0)
                .collect()
        };
        let income = -self.sum_kind(AccountKind::Income);
        let expense = self.sum_kind(AccountKind::Expense);
        let current = income - expense;
        let equity_accounts = pick(AccountKind::Equity, -1);
        let total_equity = equity_accounts.iter().map(|(_, v)| *v).sum::<i64>() + current;
        BalanceSheet {
            assets: pick(AccountKind::Asset, 1),
            liabilities: pick(AccountKind::Liability, -1),
            equity: equity_accounts,
            current_earnings: current,
            total_assets: self.total_assets(),
            total_liabilities: self.total_liabilities(),
            total_equity,
        }
    }

    fn income_statement(period: &PeriodTotals) -> IncomeStatement {
        let mut revenues = Vec::new();
        let mut expenses = Vec::new();
        for (acct, mv) in &period.movements {
            match acct.kind() {
                AccountKind::Income if *mv != 0 => revenues.push((*acct, -*mv)),
                AccountKind::Expense if *mv != 0 => expenses.push((*acct, *mv)),
                _ => {}
            }
        }
        let total_revenue: i64 = revenues.iter().map(|(_, v)| *v).sum();
        let total_expense: i64 = expenses.iter().map(|(_, v)| *v).sum();
        IncomeStatement { revenues, expenses, total_revenue, total_expense, net_income: total_revenue - total_expense }
    }

    fn report(&self, kind: PeriodKind, index: u32, period: &PeriodTotals, end_day: u32) -> FinancialReport {
        let [operating, investing, financing] = period.cash_flows;
        let closing = self.balance(Account::Cash);
        FinancialReport {
            kind,
            index,
            start_day: period.start_day,
            end_day,
            balance_sheet: self.balance_sheet(),
            income: Self::income_statement(period),
            cash_flow: CashFlowStatement {
                operating,
                investing,
                financing,
                net_change: operating + investing + financing,
                opening_cash: period.opening_cash,
                closing_cash: closing,
            },
        }
    }

    /// 月末：生成月报并开始新的月度累计。`day` 为当月最后一天。
    pub fn close_month(&mut self, day: u32) {
        self.close_month_in(day, &Calendar::default());
    }

    pub fn close_month_in(&mut self, day: u32, calendar: &Calendar) {
        let index = calendar.month_index(day);
        let report = self.report(PeriodKind::Month, index, &self.month.clone(), day);
        self.monthly.push(report);
        if self.monthly.len() > MONTHLY_REPORTS_KEPT {
            let excess = self.monthly.len() - MONTHLY_REPORTS_KEPT;
            self.monthly.drain(0..excess);
        }
        self.month = PeriodTotals::new(day + 1, self.balance(Account::Cash));
    }

    /// 年末：生成年报，把收入与费用结转到留存收益，开始新的年度累计。
    pub fn close_year(&mut self, day: u32) {
        self.close_year_in(day, &Calendar::default());
    }

    pub fn close_year_in(&mut self, day: u32, calendar: &Calendar) {
        let index = calendar.date_of(day).year - 1;
        let report = self.report(PeriodKind::Year, index, &self.year.clone(), day);
        self.yearly.push(report);
        let mut closing = JournalEntry::new(day, Memo::YearClose, CashClass::Operating);
        let mut net = 0i64;
        for (acct, bal) in &self.balances {
            if matches!(acct.kind(), AccountKind::Income | AccountKind::Expense) && *bal != 0 {
                closing.lines.push(Line { account: *acct, amount: -*bal });
                net += *bal;
            }
        }
        if !closing.lines.is_empty() {
            closing.lines.push(Line { account: Account::RetainedEarnings, amount: net });
            // 结转分录不计入任何期间发生额
            for line in &closing.lines {
                *self.balances.entry(line.account).or_insert(0) += line.amount;
            }
            self.balances.retain(|_, v| *v != 0);
            self.entries_posted += 1;
        }
        self.year = PeriodTotals::new(day + 1, self.balance(Account::Cash));
    }
}

/// 存货批次（移动加权平均）。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Lot {
    pub qty: i64,
    pub cost: Money,
}

/// 按商品记录的存货数量与总成本。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct InventoryBook {
    pub goods: BTreeMap<GoodId, Lot>,
}

impl InventoryBook {
    pub fn add(&mut self, good: GoodId, qty: i64, cost: Money) {
        if qty <= 0 && cost == 0 {
            return;
        }
        let lot = self.goods.entry(good).or_default();
        lot.qty += qty;
        lot.cost += cost;
    }

    /// 移出 qty 件，返回按平均成本计算的成本。
    pub fn remove(&mut self, good: GoodId, qty: i64) -> Money {
        let Some(lot) = self.goods.get_mut(&good) else { return 0 };
        if qty <= 0 || lot.qty <= 0 {
            return 0;
        }
        let q = qty.min(lot.qty);
        let cost = if q == lot.qty { lot.cost } else { mul_div(lot.cost, q, lot.qty) };
        lot.qty -= q;
        lot.cost -= cost;
        if lot.qty == 0 {
            self.goods.remove(&good);
        }
        cost
    }

    /// 只读试算移出成本；与 remove 的整批处理、限量和四舍五入完全一致。
    pub fn peek_cost(&self, good: GoodId, qty: i64) -> Money {
        let Some(lot) = self.goods.get(&good) else { return 0 };
        if qty <= 0 || lot.qty <= 0 {
            return 0;
        }
        let q = qty.min(lot.qty);
        if q == lot.qty { lot.cost } else { mul_div(lot.cost, q, lot.qty) }
    }

    pub fn qty(&self, good: GoodId) -> i64 {
        self.goods.get(&good).map(|l| l.qty).unwrap_or(0)
    }

    /// 平均单位成本（四舍五入）。
    pub fn avg_cost(&self, good: GoodId) -> Money {
        self.goods.get(&good).map(|l| mul_div(l.cost, 1, l.qty.max(1))).unwrap_or(0)
    }

    pub fn total_cost(&self) -> Money {
        self.goods.values().map(|l| l.cost).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unbalanced_entries() {
        let mut l = Ledger::new();
        let bad = JournalEntry::new(0, Memo::Other, CashClass::Operating).dr(Account::Cash, 10).cr(Account::Capital, 9);
        assert!(l.post(bad).is_err());
        assert!(l.balances.is_empty());
    }

    #[test]
    fn reports_and_year_close() {
        let mut l = Ledger::new();
        l.post(
            JournalEntry::new(0, Memo::Opening, CashClass::Financing)
                .dr(Account::Cash, 1000)
                .cr(Account::Capital, 1000),
        )
        .unwrap();
        l.post(
            JournalEntry::new(1, Memo::Purchase, CashClass::Operating)
                .dr(Account::Inventory, 300)
                .cr(Account::Cash, 300),
        )
        .unwrap();
        l.post(
            JournalEntry::new(2, Memo::Sale, CashClass::Operating)
                .dr(Account::Cash, 500)
                .cr(Account::Sales, 500)
                .dr(Account::CostOfGoods, 300)
                .cr(Account::Inventory, 300),
        )
        .unwrap();
        assert!(l.is_balanced());
        assert!(l.identity_holds());
        l.close_month(29);
        let r = l.monthly.last().unwrap();
        assert_eq!(r.income.net_income, 200);
        assert_eq!(r.cash_flow.net_change, 1200);
        assert_eq!(r.balance_sheet.total_assets, 1200);
        assert_eq!(r.balance_sheet.total_equity, 1200);
        l.close_year(359);
        assert_eq!(l.balance(Account::Sales), 0);
        assert_eq!(l.balance(Account::RetainedEarnings), -200);
        assert!(l.is_balanced());
    }

    #[test]
    fn moving_average_cost() {
        let mut b = InventoryBook::default();
        let g = GoodId(0);
        b.add(g, 10, 100);
        b.add(g, 10, 300);
        assert_eq!(b.avg_cost(g), 20);
        assert_eq!(b.remove(g, 5), 100);
        assert_eq!(b.qty(g), 15);
        assert_eq!(b.remove(g, 100), 300);
        assert_eq!(b.qty(g), 0);
        assert_eq!(b.total_cost(), 0);
    }
}
