//! 资金流动与货币守恒。
//!
//! 世界货币总量 = 全部参与者持有的现金（以及后续的保证金账户等内部账户）。
//! 与外部（现货市场、势力、船厂、银行……）之间的每一笔往来都记为有名目的
//! 来源或去向，因此恒有：当前总量 = 初始总量 + Σ来源 − Σ去向。
//!
//! 货币流通打开时（ECONOMY.md 6.9，见 [`crate::circulation`]），每一笔往来还要写明对手部门（城镇钱袋、国库、银行或腹地），
//! 对手部门的余额反向变动，于是另有：全部账户（参与者与各部门）之和 = 开局的总额。

use crate::circulation::Sector;
use crate::error::CoreError;
use crate::fixed::Money;
use crate::ids::OwnerId;
use crate::ledger::{Account, JournalEntry};
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 外部资金往来的名目。
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Debug)]
pub enum Flow {
    /// 现货买卖（与各地市场之间）
    Market,
    /// 交易税、关税、通行税
    Tax,
    /// 船员与工人工资
    Wages,
    /// 粮水补给
    Supplies,
    /// 招募船员
    CrewHire,
    /// 修船
    Repair,
    /// 买卖、改造船只
    Shipyard,
    /// 被海盗勒索
    Tribute,
    /// 破产核销的欠款
    BadDebt,
    /// 仓储、租金、滞仓费
    Rent,
    /// 产业建设与维护
    Industry,
    /// 港口投资
    Investment,
    /// 银行存取款、贷款与利息
    Bank,
    /// 委托合同的报酬与罚金
    Contract,
    /// 许可证与议价
    License,
    /// 期货交割中交易所与现货市场之间的往来
    Exchange,
    /// 势力支出（战利品、补贴等）
    Faction,
    /// 其他
    Other,
    /// 殖民地：建立费、建筑费、维护费（去向）与税收、出售（来源）
    Colony,
    /// 报告发现物的赏金
    Discovery,
    /// 商会的年末分红（流出世界；ECONOMY.md 6.7，E8 起流回本据港的城镇钱袋）
    Dividend,
    /// 行情通报的费用（ECONOMY.md 第 7 节）
    MarketReport,
    /// 以下是部门之间的转账（货币流通，ECONOMY.md 6.9），不经过参与者：腹地收入（龙头）
    HinterlandIncome,
    /// 钱袋漏回腹地（下水道）
    Leak,
    /// 国库的公共工程
    PublicWorks,
    /// 国库的海军开支
    Navy,
    /// 国库的战争开支
    War,
    /// 势力占领殖民点的花费
    Claim,
    /// 商会的维护费（按超出储备的现金付给本据港）
    Overhead,
    /// 养成家庭结业出资（来源）。
    UpbringingCapital,
    /// 养成期家里与学院按月发的零用钱（来源）。
    UpbringingAllowance,
    /// 商馆分红：城镇钱袋按月付给在本港投资的人（T02，来源）
    HouseDividend,
    /// 商馆代办费（T03）：成交额的百分比，进当地城镇钱袋
    AgencyFee,
}

/// 货币统计。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MoneyStats {
    pub initial: Money,
    pub sources: BTreeMap<Flow, Money>,
    pub sinks: BTreeMap<Flow, Money>,
}

impl MoneyStats {
    pub fn total_sources(&self) -> Money {
        self.sources.values().sum()
    }

    pub fn total_sinks(&self) -> Money {
        self.sinks.values().sum()
    }

    /// 按记录推算的当前货币总量。
    pub fn expected_total(&self) -> Money {
        self.initial + self.total_sources() - self.total_sinks()
    }

    fn record(&mut self, flow: Flow, delta: Money) {
        if delta > 0 {
            *self.sources.entry(flow).or_insert(0) += delta;
        } else if delta < 0 {
            *self.sinks.entry(flow).or_insert(0) += -delta;
        }
    }
}

fn cash_delta(entry: &JournalEntry) -> Money {
    entry.lines.iter().filter(|l| l.account == Account::Cash).map(|l| l.amount).sum()
}

impl World {
    /// 与外部的资金往来：过账、改变现金，并记录资金流；货币流通打开时对手部门 `to` 的余额反向变动。
    pub(crate) fn book_external(
        &mut self,
        owner: OwnerId,
        flow: Flow,
        to: Sector,
        entry: JournalEntry,
    ) -> Result<Money, CoreError> {
        let delta = cash_delta(&entry);
        let agent = self.agent_mut(owner)?;
        agent.ledger.post(entry)?;
        agent.cash += delta;
        self.state.money.record(flow, delta);
        self.settle_sector(to, delta, flow);
        Ok(delta)
    }

    /// 同上，对手是按权重分摊的几个部门（按地点汇总的工资、仓租、产业开销等）。
    pub(crate) fn book_spread(
        &mut self,
        owner: OwnerId,
        flow: Flow,
        parts: &[(Sector, Money)],
        entry: JournalEntry,
    ) -> Result<Money, CoreError> {
        let delta = cash_delta(&entry);
        let agent = self.agent_mut(owner)?;
        agent.ledger.post(entry)?;
        agent.cash += delta;
        self.state.money.record(flow, delta);
        self.settle_spread(parts, delta, flow);
        Ok(delta)
    }

    /// 与其他内部账户之间的往来（调用方负责配对的另一方）；或不涉及现金的分录。
    pub(crate) fn book_internal(&mut self, owner: OwnerId, entry: JournalEntry) -> Result<Money, CoreError> {
        let delta = cash_delta(&entry);
        let agent = self.agent_mut(owner)?;
        agent.ledger.post(entry)?;
        agent.cash += delta;
        Ok(delta)
    }

    /// 货币守恒检查：当前总量是否等于按记录推算的总量；货币流通打开时，全部账户之和还要等于开局的总额。
    pub fn money_conserved(&self) -> bool {
        let traders = self.total_money() == self.state.money.expected_total();
        if self.circulation_on() { traders && self.all_money() == self.state.circulation.initial } else { traders }
    }
}
