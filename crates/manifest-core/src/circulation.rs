//! 货币流通（docs/ECONOMY.md 6.9，E8；规则见 [`crate::defs::MoneyRules`]）。
//!
//! 旧版的市场凭空造钱、销毁钱；打开后每一笔钱都有来源和去向，部门之间只有转账（Godley–Lavoie 的存量流量一致）：
//! - **城镇钱袋**（每个有市场的港口与内陆城市一个）：玩家与商会卖货给市场时由钱袋付钱，买货时钱进钱袋；
//!   工资、补给、修船、船厂、仓租、产业开销、分红与维护费花在哪里就进哪里的钱袋。
//!   钱袋每天得到腹地收入（人口 × 人均日收入 × 繁荣度系数，龙头），并按固定比例漏回腹地（下水道）；
//!   开局钱袋 = 参照钱袋 = 开局的腹地收入 / 漏出率（收支平衡的水平）。
//! - **流动性系数** ℓ = (钱袋 / 参照钱袋)^(1/root)，夹在上下限之间：当地全部商品的报价乘 ℓ（每天日结时更新，
//!   次日的成交与收盘都用它）。贸易让钱从逆差港流向顺差港，价格随之变化，把贸易拉回平衡（Hume 的价格—铸币流动）。
//! - **缺口**：钱袋付不出时，差额由腹地付出并记账（不让任何一方被抽干到停摆）。
//! - **势力国库**：交易税、关税、通行税、许可费与罚金进国库；委托报酬、发现赏金与战利品由国库付；
//!   每月末按财政规则花在公共工程、海军与战争上，亏空时加税、富余时减税（有界），占领殖民点也要花钱。
//! - **银行**：存款、取款、放贷、还款与贷款利息经过银行的准备金（存款利息只记在存款余额上，取款时才付）。
//! - 期货交易所的做市方与现货市场之间的往来进出交割港的钱袋。
//! - **守恒**：玩家、商会、交易所（保证金与做市方）、城镇、国库、银行与腹地的余额之和始终等于开局的总额
//!   （[`World::money_conserved`]）。
//! - **经济月报**：每月末记下各部门的余额与流入流出、货币总量、物价指数、产量与人口（保留最近 24 份）。
//!
//! 规则关闭时这里什么也不做：状态保持为空、不写进存档，记账只改动参与者一方（与旧版逐日一致）。

use crate::defs::MoneyRules;
use crate::diplomacy::DiploStatus;
use crate::fixed::{Fx, Money, mul_div};
use crate::ids::*;
use crate::log::{LogEvent, LogKind};
use crate::treasury::Flow;
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// 经济月报保留的份数。
pub const REPORTS_KEPT: usize = 24;

/// 资金往来的对手部门。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Sector {
    /// 某地的城镇钱袋（没有钱袋的地点——殖民点——按腹地处理）
    Town(LocId),
    /// 势力国库
    Treasury(FactionId),
    /// 银行
    Bank,
    /// 腹地：远方的市场、海盗、储蓄；钱袋付不出时的缺口也由它付
    Hinterland,
}

/// 经济月报的部门分类。只允许追加。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SectorKind {
    /// 商人：玩家、商会与交易所（保证金与做市方）；彼此之间的期货结算是内部往来，不计入流量
    Traders,
    /// 城镇钱袋
    Towns,
    /// 势力国库
    Treasuries,
    /// 银行
    Bank,
    /// 腹地
    Hinterland,
}

impl SectorKind {
    pub const ALL: [SectorKind; 5] =
        [SectorKind::Traders, SectorKind::Towns, SectorKind::Treasuries, SectorKind::Bank, SectorKind::Hinterland];

    pub fn key(self) -> &'static str {
        match self {
            SectorKind::Traders => "traders",
            SectorKind::Towns => "towns",
            SectorKind::Treasuries => "treasuries",
            SectorKind::Bank => "bank",
            SectorKind::Hinterland => "hinterland",
        }
    }
}

/// 城镇钱袋。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Purse {
    pub money: Money,
    /// 参照钱袋：开局的腹地收入 / 漏出率
    pub reference: Money,
    /// 当前的流动性系数（每天日结时更新，当地的报价乘它）
    pub liquidity: Fx,
    /// 累计由腹地替它付出的缺口
    #[serde(default)]
    pub gaps: Money,
}

/// 势力国库。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Treasury {
    pub money: Money,
    /// 财政的税率系数：乘在本国的交易税上（亏空加税、富余减税）
    pub tax_mult: Fx,
    /// 海军巡逻度（0–1）：本国港口所在海区的海盗少一些
    pub patrol: Fx,
    /// 近几个月的平均月收入（指数平均）
    pub income_avg: Money,
    /// 本月至今的收入（税、许可、罚金等流入）与支出
    pub income: Money,
    pub spent: Money,
    /// 公共工程里还没折成发展度的投资
    #[serde(default)]
    pub works: Money,
}

/// 一类资金流：名目、从哪类部门到哪类部门、金额。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FlowLine {
    pub flow: Flow,
    pub from: SectorKind,
    pub to: SectorKind,
    pub amount: Money,
}

/// 经济月报里一类部门的余额与流量：月初 + 流入 − 流出 = 月末。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SectorLine {
    pub kind: SectorKind,
    pub opening: Money,
    pub inflow: Money,
    pub outflow: Money,
    pub closing: Money,
}

/// 经济月报里一个势力的国库。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TreasuryLine {
    pub faction: FactionId,
    pub money: Money,
    pub tax_mult: Fx,
    pub patrol: Fx,
    pub income: Money,
    pub spent: Money,
}

/// 经济月报（ECONOMY.md 6.9，参考 EVE Online 的月度经济报告）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EconomyReport {
    /// 所写的月份（月序，从 0 开始）与发布日
    pub month: u32,
    pub day: u32,
    pub sectors: Vec<SectorLine>,
    pub flows: Vec<FlowLine>,
    /// 货币总量：腹地以外全部账户之和
    pub money_supply: Money,
    /// 其中玩家、商会的现金与保证金，交易所的做市方
    pub player: Money,
    pub companies: Money,
    pub exchange: Money,
    /// 物价指数：全部市场报价 / 基准价的平均
    pub price_index: Fx,
    /// 本月各地市场的产量（件）
    pub production: i64,
    /// 各城镇的人口之和
    pub population: i64,
    /// 本月腹地替钱袋付出的缺口
    pub shortfall: Money,
    /// 流动性系数最低与最高的城镇
    pub tightest: Option<(LocId, Fx)>,
    pub flush: Option<(LocId, Fx)>,
    pub treasuries: Vec<TreasuryLine>,
}

/// 货币流通的状态。`on == false`（规则关闭、旧存档还没开）时全部为空，不写进存档。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Circulation {
    #[serde(default)]
    pub on: bool,
    #[serde(default)]
    pub towns: BTreeMap<LocId, Purse>,
    #[serde(default)]
    pub treasuries: BTreeMap<FactionId, Treasury>,
    /// 银行的准备金（可以为负：放贷创造存款）
    #[serde(default)]
    pub bank: Money,
    /// 腹地的余额（可以为负）
    #[serde(default)]
    pub hinterland: Money,
    /// 开局（或打开规则时）全部账户之和：守恒的初值
    #[serde(default)]
    pub initial: Money,
    /// 本月至今的资金流、月初各类部门的余额、缺口与产量
    #[serde(default)]
    pub flows: Vec<FlowLine>,
    #[serde(default)]
    pub opening: Vec<(SectorKind, Money)>,
    #[serde(default)]
    pub shortfall: Money,
    #[serde(default)]
    pub production: i64,
    #[serde(default)]
    pub reports: Vec<EconomyReport>,
}

impl Circulation {
    pub fn is_off(&self) -> bool {
        !self.on
    }
}

/// 流动性系数 ℓ = (钱袋 / 参照钱袋)^(1/root)，夹在上下限之间。在上下限之间二分，找 v^root 不超过比值的最大 v（确定性的定点运算）。
pub fn liquidity(r: &MoneyRules, money: Money, reference: Money) -> Fx {
    if reference <= 0 {
        return Fx::ONE;
    }
    let x = Fx::ratio(money.max(0), reference);
    let lo = r.liquidity_floor;
    let hi = r.liquidity_cap.max(lo);
    let root = r.liquidity_root.max(1);
    let pow = |v: Fx| (1..root).fold(v, |acc, _| acc.mul(v));
    if pow(lo) >= x {
        return lo;
    }
    if pow(hi) <= x {
        return hi;
    }
    let (mut a, mut b) = (lo.raw(), hi.raw());
    while b - a > 1 {
        let m = (a + b) / 2;
        if pow(Fx(m)) <= x {
            a = m;
        } else {
            b = m;
        }
    }
    Fx(a)
}

/// 一件商品的报价 / 基准价（物价指数用）。
fn price_ratio(e: &crate::world::MarketEntry) -> Fx {
    Fx::ratio(e.price, e.base_price.max(1))
}

impl World {
    /// 货币流通是否在运行（规则打开且已经开了账户）。
    pub fn circulation_on(&self) -> bool {
        self.defs.rules.money.enabled && self.state.circulation.on
    }

    /// 全部账户之和：参与者的现金、保证金与做市方，加上城镇、国库、银行与腹地。
    pub fn all_money(&self) -> Money {
        let c = &self.state.circulation;
        self.total_money()
            + c.towns.values().map(|p| p.money).sum::<Money>()
            + c.treasuries.values().map(|t| t.money).sum::<Money>()
            + c.bank
            + c.hinterland
    }

    /// 各类部门的余额。
    pub fn sector_balances(&self) -> Vec<(SectorKind, Money)> {
        let c = &self.state.circulation;
        vec![
            (SectorKind::Traders, self.total_money()),
            (SectorKind::Towns, c.towns.values().map(|p| p.money).sum()),
            (SectorKind::Treasuries, c.treasuries.values().map(|t| t.money).sum()),
            (SectorKind::Bank, c.bank),
            (SectorKind::Hinterland, c.hinterland),
        ]
    }

    /// 某地的人口：人口规则打开时是当前人口，否则按发展度折算。
    pub fn town_population(&self, loc: LocId) -> i64 {
        let Some(ls) = self.state.locations.get(loc.idx()) else { return 0 };
        if ls.people.pop0 > 0 {
            ls.people.pop
        } else {
            crate::development::initial_population(&self.defs, ls.development)
        }
    }

    /// 某地每天的腹地收入：人口 × 人均日收入 × 繁荣度系数（0.5 + 繁荣度 / 100；没有人口规则时为 1）。
    pub fn hinterland_income(&self, loc: LocId) -> Money {
        let r = &self.defs.rules.money;
        let Some(ls) = self.state.locations.get(loc.idx()) else { return 0 };
        let factor = if ls.people.pop0 > 0 { Fx::from_pct(50) + Fx(ls.people.prosperity.raw() / 100) } else { Fx::ONE };
        factor.apply(r.income_per_capita.apply(self.town_population(loc)))
    }

    /// 某地的城镇钱袋。
    pub fn purse(&self, loc: LocId) -> Option<&Purse> {
        self.state.circulation.towns.get(&loc)
    }

    /// 某势力的国库。
    pub fn treasury(&self, f: FactionId) -> Option<&Treasury> {
        self.state.circulation.treasuries.get(&f)
    }

    /// 财政的税率系数（没有国库时为 1）。
    pub fn fiscal_tax_mult(&self, f: FactionId) -> Fx {
        if !self.circulation_on() {
            return Fx::ONE;
        }
        self.treasury(f).map(|t| t.tax_mult).unwrap_or(Fx::ONE)
    }

    /// 海军让某海区的海盗出现概率乘上的系数：1 − navy_cut × 在该海区有港口的势力的巡逻度（按港口数平均）。
    pub fn navy_pirate_mult(&self, region: RegionId) -> Fx {
        if !self.circulation_on() {
            return Fx::ONE;
        }
        let mut sum = Fx::ZERO;
        let mut n = 0;
        for l in self.defs.port_ids() {
            if self.region_of_loc(l) != Some(region) || !self.location_open(l) {
                continue;
            }
            let f = self.location_faction(l);
            sum += self.treasury(f).map(|t| t.patrol).unwrap_or(Fx::ZERO);
            n += 1;
        }
        if n == 0 {
            return Fx::ONE;
        }
        let avg = Fx(sum.raw() / n);
        Fx::ONE - self.defs.rules.money.navy_cut.mul(avg)
    }

    /// 规则打开而状态里还没有：开城镇钱袋、国库与银行，记下全部账户之和（新开局与旧存档都从这里开始）。
    pub(crate) fn init_circulation(&mut self) {
        let r = self.defs.rules.money.clone();
        if !r.enabled || self.state.circulation.on {
            return;
        }
        let defs = self.defs.clone();
        let mut towns = BTreeMap::new();
        for loc in defs.loc_ids() {
            let def = defs.loc(loc);
            if def.is_site() || def.market.is_empty() {
                continue;
            }
            let income = self.hinterland_income(loc);
            let reference = mul_div(income, Fx::SCALE, r.leak.raw().max(1));
            towns.insert(loc, Purse { money: reference, reference, liquidity: Fx::ONE, gaps: 0 });
        }
        let mut treasuries = BTreeMap::new();
        for f in defs.faction_ids() {
            let income: Money =
                towns.keys().filter(|l| defs.loc(**l).faction == f).map(|l| self.hinterland_income(*l)).sum();
            treasuries
                .insert(f, Treasury { money: income * r.treasury_days, tax_mult: Fx::ONE, ..Treasury::default() });
        }
        self.state.circulation =
            Circulation { on: true, towns, treasuries, bank: r.bank_reserve, ..Circulation::default() };
        let total = self.all_money();
        let opening = self.sector_balances();
        let c = &mut self.state.circulation;
        c.initial = total;
        c.opening = opening;
        self.update_liquidity();
    }

    /// 没有钱袋或国库的对手按腹地处理。
    fn norm(&self, s: Sector) -> Sector {
        let c = &self.state.circulation;
        match s {
            Sector::Town(l) if !c.towns.contains_key(&l) => Sector::Hinterland,
            Sector::Treasury(f) if !c.treasuries.contains_key(&f) => Sector::Hinterland,
            other => other,
        }
    }

    /// 部门付出 amount：返回（付款的部门类别, 它实付的, 腹地补的缺口）。城镇钱袋最多付到 0，其余部门可以为负。只改余额。
    fn pay_out(&mut self, s: Sector, amount: Money) -> (SectorKind, Money, Money) {
        let s = self.norm(s);
        let c = &mut self.state.circulation;
        match s {
            Sector::Town(l) => match c.towns.get_mut(&l) {
                Some(p) => {
                    let paid = amount.min(p.money.max(0));
                    let gap = amount - paid;
                    p.money -= paid;
                    p.gaps += gap;
                    c.hinterland -= gap;
                    c.shortfall += gap;
                    (SectorKind::Towns, paid, gap)
                }
                None => {
                    c.hinterland -= amount;
                    (SectorKind::Hinterland, amount, 0)
                }
            },
            Sector::Treasury(f) => match c.treasuries.get_mut(&f) {
                Some(t) => {
                    t.money -= amount;
                    t.spent += amount;
                    (SectorKind::Treasuries, amount, 0)
                }
                None => {
                    c.hinterland -= amount;
                    (SectorKind::Hinterland, amount, 0)
                }
            },
            Sector::Bank => {
                c.bank -= amount;
                (SectorKind::Bank, amount, 0)
            }
            Sector::Hinterland => {
                c.hinterland -= amount;
                (SectorKind::Hinterland, amount, 0)
            }
        }
    }

    /// 部门收进 amount，返回收款的部门类别。只改余额。
    fn take_in(&mut self, s: Sector, amount: Money) -> SectorKind {
        let s = self.norm(s);
        let c = &mut self.state.circulation;
        match s {
            Sector::Town(l) => match c.towns.get_mut(&l) {
                Some(p) => {
                    p.money += amount;
                    SectorKind::Towns
                }
                None => {
                    c.hinterland += amount;
                    SectorKind::Hinterland
                }
            },
            Sector::Treasury(f) => match c.treasuries.get_mut(&f) {
                Some(t) => {
                    t.money += amount;
                    t.income += amount;
                    SectorKind::Treasuries
                }
                None => {
                    c.hinterland += amount;
                    SectorKind::Hinterland
                }
            },
            Sector::Bank => {
                c.bank += amount;
                SectorKind::Bank
            }
            Sector::Hinterland => {
                c.hinterland += amount;
                SectorKind::Hinterland
            }
        }
    }

    /// 记下本月的一类资金流（同类部门之间的往来不记）。
    fn record_flow(&mut self, flow: Flow, from: SectorKind, to: SectorKind, amount: Money) {
        if amount == 0 || from == to {
            return;
        }
        let flows = &mut self.state.circulation.flows;
        match flows.iter_mut().find(|l| l.flow == flow && l.from == from && l.to == to) {
            Some(l) => l.amount += amount,
            None => flows.push(FlowLine { flow, from, to, amount }),
        }
    }

    /// 参与者与部门之间的往来：参与者一方的现金已经变了 `delta`，对手部门变 −delta。规则关闭时什么也不做。
    pub(crate) fn settle_sector(&mut self, to: Sector, delta: Money, flow: Flow) {
        if !self.circulation_on() || delta == 0 {
            return;
        }
        if delta > 0 {
            let (kind, paid, gap) = self.pay_out(to, delta);
            self.record_flow(flow, kind, SectorKind::Traders, paid);
            self.record_flow(flow, SectorKind::Hinterland, SectorKind::Traders, gap);
        } else {
            let kind = self.take_in(to, -delta);
            self.record_flow(flow, SectorKind::Traders, kind, -delta);
        }
    }

    /// 按权重把一笔现金变动分摊到几个部门（按地点汇总的工资、仓租、产业开销等）；权重都不为正时记到腹地。
    pub(crate) fn settle_spread(&mut self, parts: &[(Sector, Money)], delta: Money, flow: Flow) {
        if !self.circulation_on() || delta == 0 {
            return;
        }
        let parts: Vec<(Sector, Money)> = parts.iter().copied().filter(|p| p.1 > 0).collect();
        let total: Money = parts.iter().map(|p| p.1).sum();
        if total <= 0 {
            self.settle_sector(Sector::Hinterland, delta, flow);
            return;
        }
        let mut left = delta;
        let n = parts.len();
        for (i, (s, w)) in parts.into_iter().enumerate() {
            let share = if i + 1 == n { left } else { mul_div(delta, w, total) };
            left -= share;
            self.settle_sector(s, share, flow);
        }
    }

    /// 部门之间的转账（付款方是城镇钱袋而钱不够时，差额由腹地付）。规则关闭时什么也不做。
    pub(crate) fn transfer(&mut self, from: Sector, to: Sector, amount: Money, flow: Flow) {
        if !self.circulation_on() || amount <= 0 {
            return;
        }
        let (kind, paid, gap) = self.pay_out(from, amount);
        let to_kind = self.take_in(to, amount);
        self.record_flow(flow, kind, to_kind, paid);
        self.record_flow(flow, SectorKind::Hinterland, to_kind, gap);
    }

    /// 某地的城镇部门（没有钱袋时是腹地）。
    pub fn town_sector(&self, loc: LocId) -> Sector {
        self.norm(Sector::Town(loc))
    }

    /// 某地所属势力的国库。
    pub fn treasury_of(&self, loc: LocId) -> Sector {
        match self.defs.locations.get(loc.idx()) {
            Some(_) => self.norm(Sector::Treasury(self.location_faction(loc))),
            None => Sector::Hinterland,
        }
    }

    /// 舰队开销归停泊港、route 目的港或手动航行当前位置的最近港。
    pub fn fleet_town(&self, fleet: FleetId) -> Sector {
        self.state
            .fleets
            .get(&fleet)
            .and_then(|f| self.fleet_port(f))
            .map(|loc| self.town_sector(loc))
            .unwrap_or(Sector::Hinterland)
    }

    /// 某支商队的开销花在哪里：所在城市，路上时是这一段的下一站。
    pub fn caravan_town(&self, id: CaravanId) -> Sector {
        match self.state.caravans.get(&id).map(|c| &c.location) {
            Some(crate::caravan::CaravanLocation::At(l)) => self.town_sector(*l),
            Some(crate::caravan::CaravanLocation::OnRoad(t)) => {
                t.stops.get(t.leg + 1).or(t.stops.last()).map(|l| self.town_sector(*l)).unwrap_or(Sector::Hinterland)
            }
            None => Sector::Hinterland,
        }
    }

    /// 某处产业所在的城镇。
    pub fn industry_town(&self, id: IndustryId) -> Sector {
        self.state.industries.get(&id).map(|i| self.town_sector(i.loc)).unwrap_or(Sector::Hinterland)
    }

    /// 某所有者此刻所在的港口（先看停泊的舰队，再看城里的商队）；都没有时是本据港。
    pub fn owner_port(&self, owner: OwnerId) -> Sector {
        let at = self
            .fleets_of(owner)
            .find_map(|f| f.docked_at().filter(|l| self.defs.loc(*l).is_port()))
            .or_else(|| self.caravans_of(owner).find_map(|c| c.at().filter(|l| self.defs.loc(*l).is_port())))
            .or_else(|| self.state.agents.get(&owner).map(|a| a.home));
        at.map(|l| self.town_sector(l)).unwrap_or(Sector::Hinterland)
    }

    /// 更新各地的流动性系数（写到钱袋与当地的每个市场条目上，报价乘它）。
    pub(crate) fn update_liquidity(&mut self) {
        let r = self.defs.rules.money.clone();
        let st = &mut self.state;
        for (loc, p) in st.circulation.towns.iter_mut() {
            let l = liquidity(&r, p.money, p.reference);
            p.liquidity = l;
            if let Some(ls) = st.locations.get_mut(loc.idx()) {
                for e in ls.market.values_mut() {
                    e.liquidity = l;
                }
            }
        }
    }

    /// 账本日结的一部分：腹地收入与漏出；月末的财政与经济月报；最后更新流动性系数（次日的报价用）。
    pub(crate) fn circulation_day_end(&mut self) -> Result<(), crate::error::CoreError> {
        if !self.circulation_on() {
            return Ok(());
        }
        let day = self.state.day;
        let produced: i64 = self
            .state
            .locations
            .iter()
            .flat_map(|l| l.market.values())
            .filter(|e| e.flow.day == day)
            .map(|e| e.flow.produced)
            .sum();
        self.state.circulation.production += produced;
        let leak = self.defs.rules.money.leak;
        let towns: Vec<LocId> = self.state.circulation.towns.keys().copied().collect();
        for loc in towns {
            let income = self.hinterland_income(loc);
            self.transfer(Sector::Hinterland, Sector::Town(loc), income, Flow::HinterlandIncome);
            let money = self.purse(loc).map(|p| p.money).unwrap_or(0);
            self.transfer(Sector::Town(loc), Sector::Hinterland, leak.apply(money.max(0)), Flow::Leak);
        }
        if self.defs.calendar.month_end(day) {
            self.fiscal_month_end();
            self.economy_report();
        }
        self.update_liquidity();
        Ok(())
    }

    /// 月末的财政：平均月收入、支出（公共工程、海军、战争）与税率。
    fn fiscal_month_end(&mut self) {
        let r = self.defs.rules.money.clone();
        let day = self.state.day;
        let at_war: BTreeSet<FactionId> =
            self.state.relations.iter().filter(|x| x.status == DiploStatus::War).flat_map(|x| [x.a, x.b]).collect();
        let factions: Vec<FactionId> = self.state.circulation.treasuries.keys().copied().collect();
        for f in factions {
            let Some(t) = self.treasury(f).cloned() else { continue };
            let avg = if t.income_avg == 0 { t.income } else { t.income_avg + (t.income - t.income_avg) / 6 };
            let reserve = avg * r.reserve_months;
            let budget =
                (r.spend_rate.apply(avg) + (t.money - reserve) / r.catch_up_months.max(1)).clamp(0, t.money.max(0));
            let works = r.works_share.apply(budget);
            let navy = budget - works;
            if works > 0 {
                self.public_works(f, works);
            }
            let ports: Vec<(LocId, Money)> = self
                .state
                .circulation
                .towns
                .iter()
                .filter(|(l, _)| {
                    self.location_faction(**l) == f && self.defs.loc(**l).is_port() && self.location_open(**l)
                })
                .map(|(l, p)| (*l, p.reference))
                .collect();
            let navy = if ports.is_empty() { 0 } else { navy };
            if navy > 0 {
                let total: Money = ports.iter().map(|p| p.1.max(1)).sum();
                let mut left = navy;
                for (i, (l, w)) in ports.iter().enumerate() {
                    let share = if i + 1 == ports.len() { left } else { mul_div(navy, (*w).max(1), total) };
                    left -= share;
                    self.transfer(Sector::Treasury(f), Sector::Town(*l), share, Flow::Navy);
                }
            }
            let patrol = Fx::ratio(navy, r.patrol_cost * ports.len().max(1) as i64).clamp(Fx::ZERO, Fx::ONE);
            if at_war.contains(&f) {
                self.transfer(Sector::Treasury(f), Sector::Hinterland, r.war_share.apply(avg), Flow::War);
            }
            let Some(t) = self.state.circulation.treasuries.get_mut(&f) else { continue };
            t.income_avg = avg;
            t.patrol = patrol;
            let old = t.tax_mult;
            let (lo, hi) = (r.tax_min, r.tax_max.max(r.tax_min));
            let step = r.tax_step;
            let next = if t.money < -(avg * r.deficit_months) {
                (old + step).min(hi)
            } else if t.money > avg * r.surplus_months {
                (old - step).max(lo)
            } else if old > Fx::ONE {
                (old - step).max(Fx::ONE)
            } else if old < Fx::ONE {
                (old + step).min(Fx::ONE)
            } else {
                old
            };
            t.tax_mult = next;
            let money = t.money;
            // 国库亏空加税、富余减税才记日志（回到 1 的一步不记）
            let deficit = money < -(avg * r.deficit_months) && next > old;
            let surplus = money > avg * r.surplus_months && next < old;
            if deficit || surplus {
                self.push_log(LogEvent {
                    day,
                    kind: LogKind::FiscalTax { faction: f, mult: next, raised: deficit, treasury: money },
                });
            }
        }
    }

    /// 公共工程：投在本国发展度相对开局最落后、还没到上限的港口，钱进那里的钱袋；攒够一点就把发展度提高一点（同港口投资的价钱）。
    fn public_works(&mut self, f: FactionId, amount: Money) {
        if self.defs.rules.development.enabled {
            self.development_public_works(f, amount);
            return;
        }
        let cap = self.defs.rules.money.works_cap;
        let defs = self.defs.clone();
        let target = defs
            .port_ids()
            .filter(|l| {
                self.location_faction(*l) == f && self.location_open(*l) && self.state.circulation.towns.contains_key(l)
            })
            .filter(|l| self.state.locations[l.idx()].development < (defs.loc(*l).development + cap).min(100))
            .min_by_key(|l| (self.state.locations[l.idx()].development - defs.loc(*l).development, l.0));
        let Some(loc) = target else { return };
        self.transfer(Sector::Treasury(f), Sector::Town(loc), amount, Flow::PublicWorks);
        let dev = self.state.locations[loc.idx()].development;
        let room = ((defs.loc(loc).development + cap).min(100) - dev).max(0);
        let per_point = {
            let c = defs.rules.invest.cost_per_point;
            (c + mul_div(c, dev, 50)).max(1)
        };
        let Some(t) = self.state.circulation.treasuries.get_mut(&f) else { return };
        t.works += amount;
        let gain = (t.works / per_point).min(room);
        if gain > 0 {
            t.works -= gain * per_point;
            self.state.locations[loc.idx()].development += gain;
        }
    }

    /// E02：仍挑高出开局最少的本国港；逐点用同一单价，预算余款留在国库的工程累计。
    fn development_public_works(&mut self, f: FactionId, amount: Money) {
        let defs = self.defs.clone();
        let r = &defs.rules.development;
        let target = defs
            .port_ids()
            .filter(|l| {
                self.location_faction(*l) == f && self.location_open(*l) && self.state.circulation.towns.contains_key(l)
            })
            .filter(|l| self.state.locations[l.idx()].development < r.works_cap(defs.loc(*l).development))
            .min_by_key(|l| (self.state.locations[l.idx()].development - defs.loc(*l).development, l.0));
        let Some(loc) = target else { return };
        self.transfer(Sector::Treasury(f), Sector::Town(loc), amount, Flow::PublicWorks);
        let Some(t) = self.state.circulation.treasuries.get_mut(&f) else { return };
        t.works = t.works.saturating_add(amount);
        let ls = &mut self.state.locations[loc.idx()];
        let before = ls.development * crate::development::POINT_BP + ls.growth.frac;
        let cap = r.works_cap(defs.loc(loc).development);
        while ls.development < cap {
            let cost = r.point_cost(ls.development);
            if t.works < cost {
                break;
            }
            t.works -= cost;
            ls.development += 1;
        }
        let after = ls.development * crate::development::POINT_BP + ls.growth.frac;
        ls.growth.month_works = ls.growth.month_works.saturating_add(after - before);
    }

    /// 占领殖民点的花费：国库付得起就付（钱进腹地）并返回 true；规则关闭时总是 true。
    pub(crate) fn pay_claim(&mut self, f: FactionId) -> bool {
        if !self.circulation_on() {
            return true;
        }
        let cost = self.defs.rules.money.claim_cost;
        if self.treasury(f).is_none_or(|t| t.money < cost) {
            return false;
        }
        self.transfer(Sector::Treasury(f), Sector::Hinterland, cost, Flow::Claim);
        true
    }

    /// 月末：记下经济月报，清零本月的统计。
    fn economy_report(&mut self) {
        let day = self.state.day;
        let balances = self.sector_balances();
        let c = &self.state.circulation;
        let opening_of = |k: SectorKind| c.opening.iter().find(|x| x.0 == k).map(|x| x.1).unwrap_or(0);
        let sectors: Vec<SectorLine> = balances
            .iter()
            .map(|(k, closing)| SectorLine {
                kind: *k,
                opening: opening_of(*k),
                inflow: c.flows.iter().filter(|l| l.to == *k).map(|l| l.amount).sum(),
                outflow: c.flows.iter().filter(|l| l.from == *k).map(|l| l.amount).sum(),
                closing: *closing,
            })
            .collect();
        let mut flows = c.flows.clone();
        flows.sort_by(|a, b| b.amount.cmp(&a.amount).then(a.flow.cmp(&b.flow)));
        let (mut player, mut companies) = (0, 0);
        for (owner, a) in &self.state.agents {
            let margin: Money = self.state.futures.margin.get(owner).map(|m| m.values().sum()).unwrap_or(0);
            match owner {
                OwnerId::Player => player += a.cash + margin,
                OwnerId::Company(_) => companies += a.cash + margin,
            }
        }
        let exchange: Money = self.state.futures.house.values().sum();
        let (mut sum, mut n) = (0i64, 0i64);
        for ls in &self.state.locations {
            for e in ls.market.values() {
                sum += price_ratio(e).raw();
                n += 1;
            }
        }
        let price_index = Fx(if n > 0 { sum / n } else { Fx::SCALE });
        let population: i64 = c.towns.keys().map(|l| self.town_population(*l)).sum();
        let mut tightest: Option<(LocId, Fx)> = None;
        let mut flush: Option<(LocId, Fx)> = None;
        for (l, p) in &c.towns {
            if tightest.is_none_or(|t| p.liquidity < t.1) {
                tightest = Some((*l, p.liquidity));
            }
            if flush.is_none_or(|t| p.liquidity > t.1) {
                flush = Some((*l, p.liquidity));
            }
        }
        let treasuries: Vec<TreasuryLine> = c
            .treasuries
            .iter()
            .map(|(f, t)| TreasuryLine {
                faction: *f,
                money: t.money,
                tax_mult: t.tax_mult,
                patrol: t.patrol,
                income: t.income,
                spent: t.spent,
            })
            .collect();
        let money_supply = balances.iter().filter(|b| b.0 != SectorKind::Hinterland).map(|b| b.1).sum();
        let report = EconomyReport {
            month: self.defs.calendar.month_index(day),
            day,
            sectors,
            flows,
            money_supply,
            player,
            companies,
            exchange,
            price_index,
            production: c.production,
            population,
            shortfall: c.shortfall,
            tightest,
            flush,
            treasuries,
        };
        let c = &mut self.state.circulation;
        c.reports.push(report);
        if c.reports.len() > REPORTS_KEPT {
            let excess = c.reports.len() - REPORTS_KEPT;
            c.reports.drain(0..excess);
        }
        c.flows.clear();
        c.opening = balances;
        c.shortfall = 0;
        c.production = 0;
        for t in c.treasuries.values_mut() {
            t.income = 0;
            t.spent = 0;
        }
    }
}
