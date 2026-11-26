//! 商会 2.0（ECONOMY.md 6.7，规则见 [`crate::defs::CommerceRules`]）：选货选线看预测价差而不是当前价差，
//! 每家商会有偏好的预测方法、业绩差时换；一船装多种货；装着期货品种驶往交割港时开空头套保；
//! 买本国的许可证；舰队上限随净资产增长、老船换新、年末分红（现金不再无限堆积）；对玩家长期占着的市场跟进或回避。
//!
//! 规划仍在 [`crate::npc`]（只读世界、产出命令）；这里是预测、出航计划的记录与核对、每月与每年的经营决策。
//! 规则关闭时这里什么也不做，状态里没有这些字段（与旧版逐日一致）。

use crate::command::{Command, CommandOutcome};
use crate::defs::{ForecastMethod, Reaction, StaticData};
use crate::error::{CommandError, CoreError};
use crate::fixed::{Fx, Money, mul_div};
use crate::ids::*;
use crate::info::Known;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::market::{TradeQuote, normal_price};
use crate::text::TextRef;
use crate::treasury::Flow;
use crate::world::{MarketEntry, World};
use serde::{Deserialize, Serialize};

/// 一趟出航的计划：出航时记下，到港卖出主货时核对各方法的预测。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TradePlan {
    pub dest: LocId,
    /// 主货
    pub good: GoodId,
    /// 出航那天三种方法对抵达时目的港主货价格的预测（照旧、顺势、回归）
    pub forecasts: [Money; 3],
    /// 套保：合约与手数（空头为负）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hedge: Option<(FuturesId, i64)>,
}

/// 商会展望（ECONOMY.md 8.2）：AI（没有模型时是离线规则）每月一次写下的看法。
/// 看法每级让商会对这种商品抵达时的预期偏 3%，30 天内线性消退到 0；备忘是酒馆里“某商会看好……”的传闻（真实的动向）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Outlook {
    pub day: u32,
    /// (商品, 看法 −2…+2)
    pub views: Vec<(GoodId, i8)>,
    /// 备忘（≤ 60 字）
    pub memo: String,
    /// 离线模板的位置与参数（显示时按语言重新格式化；模型写的为空）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tpl: Option<TextRef>,
}

/// 展望最多几条看法。
pub const OUTLOOK_MAX_VIEWS: usize = 4;
/// 每级看法的偏向。
pub const OUTLOOK_STEP: Fx = Fx::from_pct(3);
/// 偏向消退到 0 的天数。
pub const OUTLOOK_DAYS: u32 = 30;
/// 两次展望的最短间隔。
pub const OUTLOOK_INTERVAL: u32 = 25;
/// 备忘的字数上限。
pub const MAX_MEMO_CHARS: usize = 60;

impl Outlook {
    /// 某商品在某天的偏向（每级 3%，30 天内线性消退到 0；没有看法时为 0）。
    pub fn bias(&self, good: GoodId, today: u32) -> Fx {
        let Some((_, v)) = self.views.iter().find(|(g, _)| *g == good) else { return Fx::ZERO };
        let age = today.saturating_sub(self.day);
        if age >= OUTLOOK_DAYS {
            return Fx::ZERO;
        }
        Fx(mul_div(OUTLOOK_STEP.raw() * *v as i64, (OUTLOOK_DAYS - age) as i64, OUTLOOK_DAYS as i64))
    }
}

/// `SetOutlook` 的预检：商会存在且没有破产；看法至多 4 条、商品存在且不重复、看法在 −2…+2；备忘 1–60 字；距上次 ≥ 25 天。
pub(crate) fn check_outlook(
    world: &World,
    company: CompanyId,
    views: &[(GoodId, i8)],
    memo: &str,
    tpl: Option<&TextRef>,
) -> Result<(), CommandError> {
    let agent = world.agent(OwnerId::Company(company))?;
    let Some(strategy) = agent.strategy.as_ref().filter(|_| !agent.bankrupt) else {
        return Err(CommandError::Bankrupt);
    };
    if views.len() > OUTLOOK_MAX_VIEWS {
        return Err(CommandError::OutOfRange(format!("看法最多 {OUTLOOK_MAX_VIEWS} 条")));
    }
    for (i, (g, v)) in views.iter().enumerate() {
        if world.defs.goods.get(g.idx()).is_none() {
            return Err(CommandError::NotFound(format!("{g:?}")));
        }
        if !(-2..=2).contains(v) {
            return Err(CommandError::OutOfRange("看法必须在 −2 到 +2 之间".into()));
        }
        if views[..i].iter().any(|(h, _)| h == g) {
            return Err(CommandError::OutOfRange("同一种商品只能有一条看法".into()));
        }
    }
    crate::news::check_text(memo, MAX_MEMO_CHARS)?;
    tpl.map_or(Ok(()), TextRef::check)?;
    if strategy.outlook.as_ref().is_some_and(|o| o.day + OUTLOOK_INTERVAL > world.state.day) {
        return Err(CommandError::Precondition("展望调整过于频繁".into()));
    }
    Ok(())
}

/// 记下展望；预测方法在滞后规则下切换：样本不到五个、或新方法的误差不比正在用的差一成以上时才换（商会 2.0 打开时）。
pub(crate) fn exec_outlook(
    world: &mut World,
    company: CompanyId,
    views: Vec<(GoodId, i8)>,
    method: Option<ForecastMethod>,
    memo: String,
    tpl: Option<TextRef>,
) -> Result<(), CoreError> {
    let owner = OwnerId::Company(company);
    let day = world.state.day;
    let current = world.company_method(owner);
    let v2 = world.defs.rules.npc.v2.enabled;
    let Some(s) = world.state.agents.get_mut(&owner).and_then(|a| a.strategy.as_mut()) else {
        return Err(CoreError::UnknownOwner(owner));
    };
    s.outlook = Some(Outlook { day, views, memo, tpl });
    if let Some(m) = method
        && v2
        && (s.samples < 5 || s.errors[m.index()] * 9 <= s.errors[current.index()] * 10)
    {
        s.method = Some(m);
    }
    Ok(())
}

/// 顺势法看的天数。
const TREND_DAYS: usize = 14;
/// 回归法每天回归的比例（φ = 0.97）。
const REVERT_PHI: Fx = Fx::from_pct(97);

/// 定点数的整数次幂（平方求幂）。
pub fn fx_pow(base: Fx, mut n: u32) -> Fx {
    let (mut acc, mut b) = (Fx::ONE, base);
    while n > 0 {
        if n & 1 == 1 {
            acc = acc.mul(b);
        }
        b = b.mul(b);
        n >>= 1;
    }
    acc
}

/// 按某方法预测 `days` 天后某市场的价格（整数金币）：
/// - 照旧：今天的价；
/// - 顺势：最近两周收盘价的平均日变化外推，涨跌夹在今天的一半到一倍半之间；
/// - 回归：正常价 + 0.97^天数 × (今天 − 正常价)。
pub fn forecast_price(defs: &StaticData, e: &MarketEntry, days: i64, method: ForecastMethod) -> Money {
    forecast_known(defs, &Known::live(e), days, method)
}

/// 按所知的行情预测（ECONOMY.md 第 7 节）：起点是所知的价格与日线；快照时 `days` 从快照日算起（航程加上过时的天数）。
pub fn forecast_known(defs: &StaticData, k: &Known<'_>, days: i64, method: ForecastMethod) -> Money {
    let p = k.price.max(1);
    let days = days.clamp(0, 365);
    match method {
        ForecastMethod::Naive => p,
        ForecastMethod::Trend => {
            let n = k.history_len();
            if n <= TREND_DAYS {
                return p;
            }
            let (Some(last), Some(old)) = (k.history_at(n - 1), k.history_at(n - 1 - TREND_DAYS)) else { return p };
            let moved = mul_div(last - old, days, TREND_DAYS as i64);
            (p + moved).clamp(p / 2, p * 3 / 2).max(1)
        }
        ForecastMethod::Revert => {
            let mu = normal_price(defs, k.entry);
            (mu + fx_pow(REVERT_PHI, days as u32).apply(p - mu)).max(1)
        }
    }
}

/// 三种方法的预测（照旧、顺势、回归）。
pub fn all_forecasts(defs: &StaticData, e: &MarketEntry, days: i64) -> [Money; 3] {
    all_known(defs, &Known::live(e), days)
}

/// 按所知的行情，三种方法的预测。
pub fn all_known(defs: &StaticData, k: &Known<'_>, days: i64) -> [Money; 3] {
    ForecastMethod::ALL.map(|m| forecast_known(defs, k, days, m))
}

/// 玩家在某市场近期交易的压力（相对目标库存，0–1）。
pub fn player_pressure(e: &MarketEntry) -> Fx {
    Fx::ratio(e.player_recent / 100, e.target.max(1)).clamp(Fx::ZERO, Fx::ONE)
}

/// 商会对玩家的反应给评分乘的系数：跟进型 1 + 反应 × 压力，回避型 1 − 反应 × 压力。
pub fn reaction_factor(reaction: Reaction, strength: Fx, pressure: Fx) -> Fx {
    match reaction {
        Reaction::Neutral => Fx::ONE,
        Reaction::Follow => Fx::ONE + strength.mul(pressure),
        Reaction::Avoid => (Fx::ONE - strength.mul(pressure)).max(Fx::ZERO),
    }
}

impl World {
    /// 商会正在用的预测方法（策略里没有时用数据里偏好的方法）。
    pub fn company_method(&self, owner: OwnerId) -> ForecastMethod {
        let fallback =
            owner.company().and_then(|c| self.defs.companies.get(c.idx())).map(|c| c.forecast).unwrap_or_default();
        self.state.agents.get(&owner).and_then(|a| a.strategy.as_ref()).and_then(|s| s.method).unwrap_or(fallback)
    }

    /// 商会的舰队上限：`max_fleets` 加上净资产每 `fleets_per_worth` 一支，不超过 `max_fleets_cap`（规则关闭时就是 `max_fleets`）。
    pub fn company_fleet_cap(&self, owner: OwnerId) -> usize {
        let npc = &self.defs.rules.npc;
        if !npc.v2.enabled {
            return npc.max_fleets;
        }
        let extra = (self.total_assets(owner) / npc.v2.fleets_per_worth.max(1)).max(0) as usize;
        (npc.max_fleets + extra).min(npc.v2.max_fleets_cap.max(npc.max_fleets))
    }

    /// 卖出主货之后：核对出航时各方法的预测（相对误差的指数平均），平掉套保，清掉这趟的计划。
    pub(crate) fn review_sale(&mut self, fleet: FleetId, good: GoodId, q: &TradeQuote) {
        let Ok(f) = self.fleet(fleet) else { return };
        let owner = f.owner;
        let Some(plan) = f.plan.clone() else { return };
        if plan.good != good || f.docked_at() != Some(plan.dest) {
            return;
        }
        let realized = q.avg_price.max(1);
        if let Some(s) = self.state.agents.get_mut(&owner).and_then(|a| a.strategy.as_mut()) {
            for (err, forecast) in s.errors.iter_mut().zip(plan.forecasts) {
                let e = mul_div((forecast - realized).abs(), Fx::SCALE, realized);
                *err = if s.samples == 0 { e } else { (*err * 4 + e) / 5 };
            }
            s.samples += 1;
        }
        self.close_hedge(fleet);
    }

    /// 平掉这支舰队的套保（还有持仓时买回），清掉计划。
    pub(crate) fn close_hedge(&mut self, fleet: FleetId) {
        let Ok(f) = self.fleet(fleet) else { return };
        let owner = f.owner;
        let hedge = f.plan.as_ref().and_then(|p| p.hedge);
        if let Some((contract, lots)) = hedge
            && self.position(owner, contract).is_some_and(|p| p.lots == lots)
        {
            let _ = Command::TradeFutures { owner, contract, lots: -lots }.apply(self);
        }
        if let Ok(f) = self.fleet_mut(fleet) {
            f.plan = None;
        }
    }

    /// 商会每月的经营复盘（错开日期）：误差最小的方法比现在用的准一成以上时换过去；现金宽裕时买本国的许可证；
    /// 年末把超出储备的现金按比例分红（流出世界）。
    pub(crate) fn company_review(&mut self, owner: OwnerId) -> Result<(), CoreError> {
        let Some(cid) = owner.company() else { return Ok(()) };
        let v2 = self.defs.rules.npc.v2.clone();
        if !v2.enabled {
            return Ok(());
        }
        let day = self.state.day;
        if self.defs.calendar.date_of(day).day - 1 != (cid.0 as u32 * 13 + 3) % self.defs.calendar.month_days(day) {
            return Ok(());
        }
        // 换预测方法
        let current = self.company_method(owner);
        if let Some(s) = self.state.agents.get_mut(&owner).and_then(|a| a.strategy.as_mut())
            && s.samples >= 5
        {
            let best =
                ForecastMethod::ALL.into_iter().min_by_key(|m| (s.errors[m.index()], m.index())).unwrap_or(current);
            if s.errors[best.index()] * 10 < s.errors[current.index()] * 9 {
                s.method = Some(best);
            }
        }
        let (cash, home) = {
            let a = self.agent(owner)?;
            (a.cash, a.home)
        };
        // 许可证：本国的许可证能做军需品的生意
        let faction = self.defs.loc(home).faction;
        let price = self.defs.faction(faction).license_price;
        if price > 0 && !self.has_license(owner, faction) && cash > price * v2.license_multiple {
            let _ = Command::BuyLicense { owner, faction }.apply(self);
        }
        let reserve =
            self.defs.loc(home).shipyard.iter().map(|s| self.defs.ship(*s).price).max().unwrap_or(0) * v2.reserve_ships;
        // 年末分红：每年最后一个月（货币流通打开时流回本据港的钱袋，否则流出世界）
        if self.defs.calendar.date_of(day).month as usize == self.defs.calendar.months().len() {
            let cash = self.agent(owner)?.cash;
            let amount = v2.dividend_share.apply((cash - reserve).max(0));
            if amount > 0 {
                self.book_external(
                    owner,
                    Flow::Dividend,
                    self.town_sector(home),
                    JournalEntry::new(day, Memo::Dividend, CashClass::Financing)
                        .dr(Account::RetainedEarnings, amount)
                        .cr(Account::Cash, amount),
                )?;
            }
        }
        // 维护费（货币流通，ECONOMY.md 6.9）：每月按超出储备的现金的一定比例付给本据港的钱袋，
        // 与分红一起让囤积的现金流回城镇（下水道与财富同量级）
        if self.circulation_on() {
            let cash = self.agent(owner)?.cash;
            let amount = self.defs.rules.money.company_overhead.apply((cash - reserve).max(0));
            if amount > 0 {
                self.book_external(
                    owner,
                    Flow::Overhead,
                    self.town_sector(home),
                    JournalEntry::new(day, Memo::Overhead, CashClass::Operating)
                        .dr(Account::Fees, amount)
                        .cr(Account::Cash, amount),
                )?;
            }
        }
        Ok(())
    }

    /// 收盘时记下玩家在各市场的交易量（30 天指数平均；商会 2.0 对玩家的反应用）。
    pub(crate) fn track_player_trades(&mut self) {
        if !self.defs.rules.npc.v2.enabled {
            return;
        }
        let day = self.state.day;
        for ls in self.state.locations.iter_mut() {
            for e in ls.market.values_mut() {
                let f = &e.flow;
                let today = if f.day == day { (f.player_bought + f.player_sold) * 100 } else { 0 };
                e.player_recent += mul_div(today - e.player_recent, 1, 30);
            }
        }
    }
}

/// 卖出命令的结果里的成交（给 [`World::review_sale`] 用）。
pub fn traded(outcome: &Result<CommandOutcome, crate::error::CommandError>) -> Option<&TradeQuote> {
    match outcome {
        Ok(CommandOutcome::Traded(q)) => Some(q),
        _ => None,
    }
}
