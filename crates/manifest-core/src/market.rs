//! 现货市场。
//!
//! - 参考价格 = 基准价 × f(库存 / 目标库存) × 需求系数，夹在基准价的下限与上限之间；f 单调递减（查表）。
//! - 每日：产量 = 均衡产量 × 季节 × 事件 × 发展度 × 随机波动；消耗 = 日消耗 × 需求系数 × 库存 / 目标库存。
//!   因此库存（进而价格）每日向均衡回归，均衡库存 = 目标库存 × 产量 / 消耗。
//! - 价格冲击：成交按单位逐步推动库存，从而推动价格；一次买得越多均价越高，卖出同理。
//! - 行情记录：每日收盘价（日线）、月末的月均收盘价（月线），以及当天的库存流量与收盘时的价格构成
//!   （[`crate::world::MarketFlow`]），供界面的行情分析解释价格变化；这些记录不影响任何结算。
//! - 本地生产者（ECONOMY.md 6.3，`rules.toml [producers]`）：打开后产量按生产者的产能（而不是固定的均衡产量）计算，
//!   产能每月随生产者对价格的预期伸缩（作物到下一季才生效）；产销可以按万分之一件累计余数。两个开关都关时与旧版逐日一致。
//! - 人口与繁荣度（ECONOMY.md 6.4，`rules.toml [population]`）：目标库存再乘需求规模（人口比例 × 需求层级系数 × 替代系数），
//!   产量乘劳动力（人口比例，最多 1），生产者的产能上限乘人口比例。城镇工坊（6.5）接手的份额从家庭手工的均衡产量里扣掉。
//! - 补给口粮（ECONOMY.md 6.4，`rules.toml [provisions]`）：打开后从当地市场买口粮商品（[`provisions_quote`]）。

use crate::calendar::Season;
use crate::defs::{MarketDef, StaticData};
use crate::error::CommandError;
use crate::fixed::{Fx, Money, mul_div};
use crate::ids::{GoodId, LocId, OwnerId};
use crate::log::{LogEvent, LogKind};
use crate::rng::{Domain, Rng};
use crate::world::{MarketEntry, MarketFlow, Producer, World};
use serde::{Deserialize, Serialize};

/// 买卖方向。
#[derive(Clone, Copy, PartialEq, Eq, Debug, Serialize, Deserialize)]
pub enum Side {
    Buy,
    Sell,
}

/// 成交预估 / 成交结果。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TradeQuote {
    pub loc: LocId,
    pub good: GoodId,
    pub side: Side,
    pub qty: i64,
    /// 不含税成交额
    pub gross: Money,
    pub tax: Money,
    pub tax_rate: Fx,
    /// 现金变动的绝对值：买入为 gross + tax，卖出为 gross − tax
    pub total: Money,
    /// 不含税成交均价
    pub avg_price: Money,
    pub price_before: Money,
    pub price_after: Money,
    pub stock_after: i64,
}

/// 发展度系数：发展度 50 为 1.0，100 为 1.4，1 约为 0.6。
pub fn development_factor(development: i64) -> Fx {
    Fx(6_000 + development.clamp(1, 100) * 80)
}

/// 市场深度系数（T01）：产量与目标库存同乘它，均衡价不变、市场吃得下的货量跟着变。
/// 没有深度曲线（`[market] depth_curve`，经典世界不写）或发展度不高于曲线的第一个点时，就是线性的 [`development_factor`]；
/// 高于第一个点时取曲线上的值（寰宇：发展度 50 / 75 / 100 为 1.0 / 1.6 / 2.4，50 处与线性公式相接）。
pub fn depth_factor(defs: &StaticData, development: i64) -> Fx {
    if defs.rules.development.enabled {
        return Fx(defs.rules.development.depth_bp(development));
    }
    let dev = development.clamp(1, 100);
    match &defs.rules.depth_curve {
        Some(curve) if curve.points.first().is_some_and(|first| Fx::from_int(dev) > first.0) => {
            curve.eval(Fx::from_int(dev))
        }
        _ => development_factor(dev),
    }
}

/// 深度曲线相对线性系数多出来的倍数（没有曲线或发展度不高于第一个点时为 1）：城镇工坊的产能不乘发展度系数，
/// 深度曲线把家庭手工的产量与目标库存一起抬高时，工坊按这个倍数跟上，各种货的均衡价才和原来一样。
pub fn depth_boost(defs: &StaticData, development: i64) -> Fx {
    if defs.rules.development.enabled {
        return depth_factor(defs, development);
    }
    let (deep, linear) = (depth_factor(defs, development), development_factor(development));
    if deep == linear { Fx::ONE } else { Fx::ratio(deep.raw(), linear.raw().max(1)) }
}

/// 产能与产销余数的单位：万分之一件。
pub const UNIT_BP: i64 = 10_000;

/// 生产者看的影子价格（万分之一金币）：基准价 × f(库存 / 目标库存) × 需求系数，不夹上下限；
/// 库存比例超过价格曲线的最后一点时按反比外推（f = f_末 × r_末 / r），过剩越多影子价格越低。
pub fn shadow_price_bp(defs: &StaticData, e: &MarketEntry, mult: Fx) -> Money {
    let curve = &defs.rules.price_curve;
    let ratio = Fx::ratio(e.stock.max(0), e.target.max(1));
    let f = match curve.points.last() {
        Some(&(r_last, f_last)) if ratio > r_last && ratio > Fx::ZERO => {
            Fx(mul_div(f_last.raw(), r_last.raw(), ratio.raw()))
        }
        _ => curve.eval(ratio),
    };
    f.mul(mult).apply(e.base_price * UNIT_BP)
}

/// 精确的报价（万分之一金币）：影子价格夹在价格上下限之间（报价是它按整数金币取整的结果）。
/// 本地商人（ECONOMY.md 6.6）用它形成预期：便宜商品的整数报价太粗，一金币的跳动就是一成。
pub fn precise_price_bp(defs: &StaticData, e: &MarketEntry, mult: Fx) -> Money {
    let rules = &defs.rules;
    let lo = rules.price_floor.apply(e.base_price * UNIT_BP).max(1);
    let hi = rules.price_cap.apply(e.base_price * UNIT_BP).max(lo);
    shadow_price_bp(defs, e, mult).clamp(lo, hi)
}

/// 新的本地生产者：产能取家庭手工的均衡产量（`household`，万分之一件 / 天），预期在参照价上，参照价要先看一年。
/// 没有产出的市场没有生产者。
fn new_producer(e: &MarketEntry, household: i64) -> Producer {
    if e.supply <= 0 || household <= 0 {
        return Producer::default();
    }
    Producer { k0: household, k: household, expect: Fx::ONE, ..Producer::default() }
}

/// 家庭手工的均衡产量（万分之一件 / 天）：城镇工坊接手的份额从当地均衡产量里扣掉（工坊规则关闭时就是均衡产量）。
fn household_bp(defs: &StaticData, loc: &crate::defs::LocationDef, good: GoodId, e: &MarketEntry) -> i64 {
    if defs.rules.workshops.enabled {
        (Fx::ONE - loc.workshop_share(good)).apply(e.supply * UNIT_BP)
    } else {
        e.supply * UNIT_BP
    }
}

/// 月末（`month` 为刚结束的月份 1–12，`month_avg_bp` 为这个月的均价，万分之一金币）：
/// 头一年只记下各月的均价作为那个月的参照价；此后预期向“当月均价 / 当月参照价”移动，产能按预期偏离 1 的程度伸缩
/// （夹在开局产能的上下限之间；上限再乘 `cap_mult`，即人口比例）。作物调整的是计划产能，季初生效。
fn producer_month_end(
    r: &crate::defs::ProducerRules,
    p: &mut Producer,
    period: (u32, usize),
    month_avg_bp: Money,
    crop: bool,
    cap_mult: Fx,
) {
    let (month, months) = period;
    if !p.learned_in(months) {
        p.refs.resize(months, 0);
        if let Some(slot) = p.refs.get_mut(month.saturating_sub(1) as usize)
            && *slot == 0
        {
            *slot = month_avg_bp.max(1);
        }
        return;
    }
    let seen = Fx::ratio(month_avg_bp, p.reference(month).max(1));
    p.expect = p.expect + (seen - p.expect).mul(r.expect_lambda);
    let gap = (p.expect - Fx::ONE).clamp(-r.gap_cap, r.gap_cap);
    let lo = r.min_ratio.apply(p.k0).max(1);
    let hi = r.max_ratio.mul(cap_mult).apply(p.k0).max(lo);
    let base = if crop && p.next > 0 { p.next } else { p.k };
    let k = (Fx::ONE + gap.mul(r.kappa)).apply(base).clamp(lo, hi);
    if crop {
        p.next = k;
    } else {
        p.k = k;
    }
}

/// 按静态定义创建市场条目（库存取均衡值）。
pub fn new_entry(defs: &StaticData, m: &MarketDef) -> MarketEntry {
    let rules = &defs.rules;
    let base = defs.good(m.good).base_price;
    let target = (m.demand * rules.target_stock_days).max(1);
    let stock = mul_div(target, m.supply, m.demand.max(1));
    let mut e = MarketEntry {
        stock,
        target,
        supply: m.supply,
        demand: m.demand,
        base_price: base,
        price: base,
        specialty: m.specialty,
        popular_until: 0,
        event_supply: Fx::ONE,
        event_demand: Fx::ONE,
        history: Default::default(),
        monthly: Vec::new(),
        flow: MarketFlow::default(),
        producer: Producer::default(),
        subst_bp: 0,
        merchants: Default::default(),
        player_recent: 0,
        month_out: 0,
        liquidity: Fx::ONE,
        extra: false,
        rare: Default::default(),
    };
    e.price = unit_price(defs, &e, e.stock * 2, Fx::ONE);
    if defs.rules.producers.enabled {
        // 城镇工坊接手的份额在第一天的产销里扣掉（见 `market_production`）
        e.producer = new_producer(&e, e.supply * UNIT_BP);
    }
    e
}

/// 开放市场补上的只收不卖的条目（[`crate::open_market::extra_markets`]）：库存同样取均衡值。
pub fn new_extra_entry(defs: &StaticData, m: &MarketDef) -> MarketEntry {
    MarketEntry { extra: true, ..new_entry(defs, m) }
}

/// 需求系数：季节 × 流行 × 事件。
pub fn demand_mult(defs: &StaticData, day: u32, good: GoodId, e: &MarketEntry) -> Fx {
    demand_mult_in(defs, day, good, e, defs.calendar.season_of(day))
}

pub fn demand_mult_in(defs: &StaticData, day: u32, good: GoodId, e: &MarketEntry, season: Season) -> Fx {
    let season = season.index();
    let mut m = defs.good(good).season_demand[season].mul(e.event_demand);
    if e.popular_until > day {
        m = m.mul(Fx::ONE + defs.rules.popular_bonus);
    }
    m
}

/// 报价系数：需求系数 × 流动性系数（ECONOMY.md 6.9；货币流通关闭时流动性系数为 1）。消耗只看需求系数。
pub fn price_mult(defs: &StaticData, day: u32, good: GoodId, e: &MarketEntry) -> Fx {
    price_mult_in(defs, day, good, e, defs.calendar.season_of(day))
}

pub fn price_mult_in(defs: &StaticData, day: u32, good: GoodId, e: &MarketEntry, season: Season) -> Fx {
    let m = demand_mult_in(defs, day, good, e, season);
    if e.liquidity == Fx::ONE { m } else { m.mul(e.liquidity) }
}

/// 产量系数：季节 × 事件 × 发展度。
pub fn supply_mult(defs: &StaticData, day: u32, good: GoodId, e: &MarketEntry, development: i64) -> Fx {
    supply_mult_in(defs, good, e, development, defs.calendar.season_of(day))
}

pub fn supply_mult_in(defs: &StaticData, good: GoodId, e: &MarketEntry, development: i64, season: Season) -> Fx {
    let season = season.index();
    defs.good(good).season_supply[season].mul(e.event_supply).mul(depth_factor(defs, development))
}

/// 正常价：库存在均衡水平（“库存 / 目标库存” = 均衡产量 / 日消耗）时的价格，不含季节、事件与流行，夹在上下限之间。
/// 替代（ECONOMY.md 6.4）按各商品相对自己正常价的涨跌分摊需求：各地的特产本来就便宜，不因此多分到需求。
pub fn normal_price(defs: &StaticData, e: &MarketEntry) -> Money {
    let rules = &defs.rules;
    let raw = rules.price_curve.eval(Fx::ratio(e.supply.max(0), e.demand.max(1))).apply(e.base_price);
    let lo = rules.price_floor.apply(e.base_price).max(1);
    let hi = rules.price_cap.apply(e.base_price).max(lo);
    raw.clamp(lo, hi)
}

/// 以"两倍库存"给出的位置上的单位价格（用两倍避免半件取整误差）。
fn unit_price(defs: &StaticData, e: &MarketEntry, stock_x2: i64, mult: Fx) -> Money {
    let rules = &defs.rules;
    let ratio = Fx::ratio(stock_x2.max(0), e.target.max(1) * 2);
    let f = rules.price_curve.eval(ratio);
    let raw = f.mul(mult).apply(e.base_price);
    let lo = rules.price_floor.apply(e.base_price).max(1);
    let hi = rules.price_cap.apply(e.base_price).max(lo);
    raw.clamp(lo, hi)
}

/// 当前报价。
pub fn current_price(defs: &StaticData, day: u32, good: GoodId, e: &MarketEntry) -> Money {
    unit_price(defs, e, e.stock * 2, price_mult(defs, day, good, e))
}

/// 沿库存逐步走价，返回（不含税成交额, 成交后库存）。
fn walk(defs: &StaticData, e: &MarketEntry, mult: Fx, side: Side, qty: i64) -> (Money, i64) {
    let steps = qty.clamp(1, 40);
    let base_chunk = qty / steps;
    let extra = qty % steps;
    let mut stock = e.stock;
    let mut gross: Money = 0;
    for i in 0..steps {
        let c = base_chunk + if i < extra { 1 } else { 0 };
        if c == 0 {
            continue;
        }
        let mid_x2 = match side {
            Side::Buy => 2 * stock - c,
            Side::Sell => 2 * stock + c,
        };
        gross += unit_price(defs, e, mid_x2, mult) * c;
        stock = match side {
            Side::Buy => stock - c,
            Side::Sell => stock + c,
        };
    }
    (gross, stock)
}

/// 某所有者在某地的交易税率。
pub fn tax_rate(world: &World, owner: OwnerId, loc: LocId) -> Fx {
    let defs = &world.defs;
    let faction = world.location_faction(loc);
    let mut rate = defs
        .faction(faction)
        .tax
        .mul(world.faction_tax_mult(owner, faction))
        .mul(world.faction_tax_event_mult(faction))
        .mul(world.fiscal_tax_mult(faction));
    // 同盟港的税率与商馆的税率（T01）不叠乘，取更低的一个；商馆规则关闭时商馆的乘数恒为 1
    let house = world.house_tax(owner, loc);
    if is_ally(world, owner, loc) {
        rate = rate.mul(defs.rules.invest.ally_tax.min(house));
    } else if house != Fx::ONE {
        rate = rate.mul(house);
    }
    rate.mul(Fx::ONE - world.trade_tax_discount(owner))
}

fn is_ally(world: &World, owner: OwnerId, loc: LocId) -> bool {
    world.state.locations.get(loc.idx()).and_then(|l| l.ally) == Some(owner)
}

/// 成交预估：界面与命令校验共用同一套计算。
/// 开放市场（[`crate::open_market`]）打开时，玩家与商会只能买当地出售的商品（特产为主），别的商品报 [`CommandError::NotSoldHere`]；
/// 卖出不受限制（每种商品都有市场条目）。
pub fn quote(
    world: &World,
    owner: OwnerId,
    loc: LocId,
    good: GoodId,
    side: Side,
    qty: i64,
) -> Result<TradeQuote, CommandError> {
    check_reservation(world, loc, good, side, qty)?;
    if qty > 0
        && side == Side::Buy
        && let Some(e) = world.market(loc, good)
        && (e.extra || !world.market_sells(loc, good))
    {
        return Err(CommandError::NotSoldHere);
    }
    // 货档（T01）：商誉不够的货这里不卖给你（只锁买；规则关闭时什么都不锁）
    if qty > 0
        && side == Side::Buy
        && let Some(gate) = world.rank_gate(owner, loc, good)
    {
        return Err(rank_error(gate));
    }
    quote_any(world, owner, loc, good, side, qty)
}

/// 货档锁着的报错：带上要的商誉、手上的商誉与差多少。
pub fn rank_error(gate: crate::access::RankGate) -> CommandError {
    use crate::text::TextArg;
    crate::error::Reason::new(
        "trade.rank",
        format!("商誉不够：行会只把这种货卖给熟客，要商誉 {}，你在这里只有 {}", gate.need, gate.have),
    )
    .arg("need", TextArg::Int(gate.need))
    .arg("have", TextArg::Int(gate.have))
    .arg("short", TextArg::Int(gate.need - gate.have))
    .rule()
}

/// 成交预估，不看当地出售什么（期货做市方从交割港现货市场采购交割货时用）。
pub(crate) fn quote_any(
    world: &World,
    owner: OwnerId,
    loc: LocId,
    good: GoodId,
    side: Side,
    qty: i64,
) -> Result<TradeQuote, CommandError> {
    check_reservation(world, loc, good, side, qty)?;
    if qty <= 0 {
        return Err(CommandError::InvalidQuantity);
    }
    let defs = &world.defs;
    world.require_open_port(loc)?;
    let e = world.market(loc, good).ok_or(CommandError::NotTraded)?;
    if !world.good_revealed(good) || !world.market_open(loc, good) {
        return Err(CommandError::NotTraded);
    }
    if crate::stages::is_rare(defs, good) && owner.company().is_some() {
        return Err(CommandError::NotTraded);
    }
    if side == Side::Buy {
        world.check_rare_buy(loc, good, qty)?;
    }
    let rare_sell =
        side == Side::Sell && crate::stages::is_rare(defs, good) && crate::stages::rare_source(defs, good) != Some(loc);
    if rare_sell && qty > 2_000 {
        return Err(CommandError::InvalidQuantity);
    }
    if side == Side::Buy && e.stock < qty {
        return Err(CommandError::InsufficientStock { available: e.stock });
    }
    let day = world.day();
    let mult = price_mult_in(defs, day, good, e, defs.loc(loc).hemisphere.season(defs.calendar.season_of(day)));
    let price_before =
        if rare_sell { world.rare_sell_unit(loc, good, 0) } else { unit_price(defs, e, e.stock * 2, mult) };
    let (mut gross, stock_after) = if rare_sell {
        (
            (0..qty).fold(0i64, |sum, i| sum.saturating_add(world.rare_sell_unit(loc, good, i))),
            e.stock.saturating_add(qty),
        )
    } else {
        walk(defs, e, mult, side, qty)
    };
    // 同盟港：特产商品优先供货，买入享有折扣
    if side == Side::Buy && e.specialty && is_ally(world, owner, loc) {
        gross = (Fx::ONE - defs.rules.invest.ally_specialty_discount).apply(gross);
    }
    // 议价成果：买入降价，卖出按一半比例加价
    let bargain = world.bargain_discount(owner, loc);
    if bargain > Fx::ZERO {
        gross = match side {
            Side::Buy => (Fx::ONE - bargain).apply(gross),
            Side::Sell => (Fx::ONE + Fx(bargain.raw() / 2)).apply(gross),
        };
    }
    if world.ghost_anchorage(owner, loc) {
        let pct = defs.rules.ships.ghost_port_price_pct;
        gross = mul_div(gross, if side == Side::Buy { 100 + pct } else { 100 - pct }, 100);
    }
    let price_after =
        if rare_sell { world.rare_sell_unit(loc, good, qty) } else { unit_price(defs, e, stock_after * 2, mult) };
    // 势力的经济政策：进口关税（卖出）与出口税（买入）乘在交易税上（ECONOMY.md 8.4；没有时为 1）
    let tax_rate = tax_rate(world, owner, loc).mul(world.tariff_mult(loc, good, side));
    let tax = tax_rate.apply(gross);
    let total = match side {
        Side::Buy => gross + tax,
        Side::Sell => (gross - tax).max(0),
    };
    Ok(TradeQuote {
        loc,
        good,
        side,
        qty,
        gross,
        tax,
        tax_rate,
        total,
        avg_price: mul_div(gross, 1, qty),
        price_before,
        price_after,
        stock_after,
    })
}

/// 补给口粮（ECONOMY.md 6.4）：`rules.toml [provisions]` 打开时，在当地市场上可以充作口粮的商品里挑当前价最低、库存够的一种，
/// 买够 ⌈口粮 / 折合份数⌉ 件（沿库存走价、不含税）；没有这样的商品或规则关闭时按固定价。
/// 返回口粮的费用与从市场买的成交（按固定价时为 None）。
pub fn provisions_quote(world: &World, loc: LocId, food: i64) -> (Money, Option<TradeQuote>) {
    let defs = &world.defs;
    let fixed = food.max(0) * defs.rules.food_price;
    let r = &defs.rules.provisions;
    if !r.local || food <= 0 {
        return (fixed, None);
    }
    let per = r.rations.max(1);
    let units = (food + per - 1) / per;
    let day = world.day();
    // 只从地点清单里的粮食买（开放市场补上的只收不卖的条目不算）
    let pick = r
        .goods
        .iter()
        .filter(|g| !crate::contract::market_reserved(world, loc, **g))
        .filter_map(|g| {
            let e = world.market(loc, *g).filter(|e| !e.extra)?;
            (e.stock >= units).then(|| (current_price(defs, day, *g, e), *g))
        })
        .min();
    let Some((price_before, good)) = pick else { return (fixed, None) };
    let Some(e) = world.market(loc, good) else { return (fixed, None) };
    let mult = price_mult_in(defs, day, good, e, defs.loc(loc).hemisphere.season(defs.calendar.season_of(day)));
    let (gross, stock_after) = walk(defs, e, mult, Side::Buy, units);
    let price_after = unit_price(defs, e, stock_after * 2, mult);
    let q = TradeQuote {
        loc,
        good,
        side: Side::Buy,
        qty: units,
        gross,
        tax: 0,
        tax_rate: Fx::ZERO,
        total: gross,
        avg_price: mul_div(gross, 1, units),
        price_before,
        price_after,
        stock_after,
    };
    (gross, Some(q))
}

impl World {
    /// 按预估结果改变市场库存与报价（资金与货物由调用方处理）。`by` 为成交的一方（玩家、商会；
    /// 期货做市方等其他参与者为 None），用于当天的流量记录与 E02 的月成交累计。
    pub(crate) fn apply_trade_to_market(&mut self, q: &TradeQuote, by: Option<OwnerId>) {
        let day = self.state.day;
        let rare = crate::stages::is_rare(&self.defs, q.good);
        let source = crate::stages::rare_source(&self.defs, q.good);
        let month_start = self.defs.calendar.date_of(day).day == 1;
        if let Some(e) = self.market_mut(q.loc, q.good) {
            if rare {
                match q.side {
                    Side::Buy if source == Some(q.loc) => {
                        if month_start {
                            e.rare.sold_month = crate::stages::rare_bought_today(e, day);
                        }
                        e.rare.sold_month = e.rare.sold_month.saturating_add(q.qty);
                    }
                    Side::Sell if source != Some(q.loc) => {
                        e.rare.sat = e.rare.sat.saturating_add(q.qty.saturating_mul(100))
                    }
                    _ => {}
                }
            }
            e.stock = q.stock_after.max(0);
            e.price = q.price_after;
            let f = e.flow.today(day);
            let (bought, sold) = match by {
                Some(OwnerId::Player) => (&mut f.player_bought, &mut f.player_sold),
                Some(OwnerId::Company(_)) => (&mut f.npc_bought, &mut f.npc_sold),
                None => (&mut f.other_bought, &mut f.other_sold),
            };
            match q.side {
                Side::Buy => *bought += q.qty,
                Side::Sell => *sold += q.qty,
            }
        }
        self.record_development_trade(q, by);
    }

    /// tick 第 2 步：各地市场的生产与消耗。
    pub(crate) fn market_production(&mut self) {
        self.stage_unlocks_day();
        let defs = self.defs.clone();
        let day = self.state.day;
        let seed = self.state.seed;
        let noise_bp = defs.rules.production_noise_bp;
        let target_days = defs.rules.target_stock_days;
        let pr = &defs.rules.producers;
        let (pop_on, ws_on) = (defs.rules.population.enabled, defs.rules.workshops.enabled);
        // 季初：作物在上一季定下的产能生效
        let season_start = defs.calendar.season_start(day);
        for (li, ls) in self.state.locations.iter_mut().enumerate() {
            let dev = ls.development;
            let dev_f = depth_factor(&defs, dev);
            let loc_def = &defs.locations[li];
            let season = loc_def.hemisphere.season(defs.calendar.season_of(day));
            let mut rng = Rng::derive(seed, day, Domain::Market, li as u64, 0);
            // 劳动力：人口比例，最多 1（人口规则关闭时为 1）
            let labour = if pop_on && ls.people.pop0 > 0 { ls.people.labour() } else { Fx::ONE };
            for (good, e) in ls.market.iter_mut() {
                let household = household_bp(&defs, loc_def, *good, e);
                if pr.enabled {
                    if e.producer.k0 == 0 && e.supply > 0 {
                        // 旧存档或开关后来才打开：第一次用到时建立生产者（保留已有的余数）
                        let (cp, cc) = (e.producer.carry_prod, e.producer.carry_cons);
                        e.producer = Producer { carry_prod: cp, carry_cons: cc, ..new_producer(e, household) };
                    } else if e.producer.k0 > 0 && household > 0 && e.producer.k0 != household {
                        // 城镇工坊接手（或交还）了一部分产量：生产者的开局产能改为家庭手工的份额，现有产能按比例缩放
                        let p = &mut e.producer;
                        let old = p.k0;
                        let rescale = |v: i64| if v > 0 { mul_div(v, household, old).max(1) } else { v };
                        p.k = rescale(p.k);
                        p.next = rescale(p.next);
                        p.k0 = household;
                    }
                    if season_start && e.producer.next > 0 {
                        e.producer.k = e.producer.next;
                    }
                }
                let s_mult = supply_mult_in(&defs, *good, e, dev, season);
                let d_mult = demand_mult_in(&defs, day, *good, e, season);
                let noise = Fx::ONE + Fx(rng.range(-noise_bp, noise_bp));
                // 目标库存随发展度与需求规模（人口、繁荣度、替代）变化
                let (pop_mult, tier_mult, subst_mult) = crate::people::demand_scale(&defs, &ls.people, *good, e);
                let scale = dev_f.mul(pop_mult).mul(tier_mult).mul(subst_mult);
                e.target = (scale.apply(e.demand) * target_days).max(1);
                let (production, consumption) = if !pr.enabled && !pr.fractional {
                    // 旧版的算法（与 E3 之前逐日一致）
                    let supply =
                        if ws_on { (Fx::ONE - loc_def.workshop_share(*good)).apply(e.supply) } else { e.supply };
                    let production = s_mult.mul(noise).mul(labour).apply(supply).max(0);
                    let desired = mul_div(d_mult.mul(scale).apply(e.demand), e.stock, e.target);
                    (production, desired.clamp(0, e.stock + production))
                } else {
                    // 产量按生产者的产能（没有生产者时按家庭手工的均衡产量），万分之一件精度
                    let cap = if pr.enabled && e.producer.k0 > 0 { e.producer.k } else { household };
                    let prod_bp = s_mult.mul(noise).mul(labour).apply(cap).max(0);
                    let desired_bp = mul_div(d_mult.mul(scale).apply(e.demand * UNIT_BP), e.stock, e.target).max(0);
                    if pr.fractional {
                        let p = &mut e.producer;
                        let total = p.carry_prod + prod_bp;
                        p.carry_prod = total % UNIT_BP;
                        let production = total / UNIT_BP;
                        let want_total = p.carry_cons + desired_bp;
                        let want = want_total / UNIT_BP;
                        let consumption = want.clamp(0, e.stock + production);
                        p.carry_cons = if consumption == want { want_total % UNIT_BP } else { 0 };
                        (production, consumption)
                    } else {
                        let production = (prod_bp + UNIT_BP / 2) / UNIT_BP;
                        let consumption = ((desired_bp + UNIT_BP / 2) / UNIT_BP).clamp(0, e.stock + production);
                        (production, consumption)
                    }
                };
                let available = e.stock + production;
                e.stock = available - consumption;
                let event_supply = e.event_supply;
                let f = e.flow.today(day);
                f.produced += production;
                f.consumed += consumption;
                f.supply_mult = s_mult;
                f.event_supply = event_supply;
            }
        }
    }

    /// tick 第 3 步：现货价格调整、流行商品与价格走势。
    pub(crate) fn market_adjust(&mut self) {
        let defs = self.defs.clone();
        let day = self.state.day;
        let seed = self.state.seed;
        let keep = defs.rules.price_history_days;
        let keep_months = defs.rules.price_history_months;
        let month_end = defs.calendar.month_end(day);
        let mut popular_events = Vec::new();
        let pop_on = defs.rules.population.enabled;
        // 当天的季节整趟只推一次、各地（分南北半球）每地换算一次：原先每个市场条目都从日期重新推一遍
        let today_season = defs.calendar.season_of(day);
        for (li, ls) in self.state.locations.iter_mut().enumerate() {
            let mut rng = Rng::derive(seed, day, Domain::Market, li as u64, 1);
            let season = defs.locations[li].hemisphere.season(today_season);
            // 生产者的产能上限随人口伸缩（人口规则关闭时为 1）
            let cap_mult = if pop_on && ls.people.pop0 > 0 { ls.people.ratio() } else { Fx::ONE };
            if !ls.market.is_empty() && rng.chance_bp(defs.rules.seasonal_popular_bp) {
                // 季节触发流行：按季节需求系数加权挑一种商品（地点清单里的商品；开放市场补上的只收不卖的条目不算）
                let season = season.index();
                let goods: Vec<GoodId> = ls.market.iter().filter(|(_, e)| !e.extra).map(|(g, _)| *g).collect();
                let weights: Vec<i64> = goods.iter().map(|g| defs.good(*g).season_demand[season].0).collect();
                if let Some(i) = rng.weighted(&weights) {
                    let g = goods[i];
                    if let Some(e) = ls.market.get_mut(&g)
                        && e.popular_until <= day
                    {
                        e.popular_until = day + defs.rules.popular_days;
                        popular_events.push((LocId::from_idx(li), g));
                    }
                }
            }
            for (good, e) in ls.market.iter_mut() {
                if e.popular_until != 0 && e.popular_until <= day {
                    e.popular_until = 0;
                }
                let mult = price_mult_in(&defs, day, *good, e, season);
                e.price = unit_price(&defs, e, e.stock * 2, mult);
                if defs.rules.producers.enabled && e.producer.k0 > 0 {
                    let shadow = shadow_price_bp(&defs, e, mult);
                    e.producer.month_sum += shadow;
                    e.producer.month_days += 1;
                }
                e.history.push_back(e.price);
                while e.history.len() > keep {
                    e.history.pop_front();
                }
                record_close(&defs, day, *good, e, season);
                if pop_on && ls.people.pop0 > 0 {
                    let (pm, tm, sm) = crate::people::demand_scale(&defs, &ls.people, *good, e);
                    let f = e.flow.today(day);
                    (f.people, f.prosperity, f.substitute) = (pm, tm, sm);
                }
                if month_end {
                    // 月线：本月（日历月长）收盘价的平均
                    let n = e.history.len().min(defs.calendar.month_days(day) as usize);
                    if n > 0 {
                        let sum: i64 = e.history.iter().rev().take(n).sum();
                        let avg = mul_div(sum, 1, n as i64);
                        e.monthly.push(avg);
                        if e.monthly.len() > keep_months {
                            let excess = e.monthly.len() - keep_months;
                            e.monthly.drain(0..excess);
                        }
                        // 本地生产者看着这个月影子价格的均值（万分之一金币）调整预期与产能
                        if defs.rules.producers.enabled && e.producer.k0 > 0 {
                            let p = &mut e.producer;
                            let avg_bp = if p.month_days > 0 {
                                p.month_sum / i64::from(p.month_days)
                            } else {
                                mul_div(sum, UNIT_BP, n as i64)
                            };
                            p.month_sum = 0;
                            p.month_days = 0;
                            let month = defs.calendar.date_of(day).month;
                            producer_month_end(
                                &defs.rules.producers,
                                p,
                                (month, defs.calendar.months().len()),
                                avg_bp,
                                defs.good(*good).crop,
                                cap_mult,
                            );
                        }
                    }
                }
            }
        }
        for (loc, good) in popular_events {
            self.push_log(LogEvent { day, kind: LogKind::Popular { loc, good } });
        }
    }
}

/// 记下收盘时的库存、目标库存与需求系数的构成（tick 第 3 步，价格刚按当天的库存算出）。
fn record_close(defs: &StaticData, day: u32, good: GoodId, e: &mut MarketEntry, season: Season) {
    let season_demand = defs.good(good).season_demand[season.index()];
    let popular = e.popular_until > day;
    let demand_mult = demand_mult_in(defs, day, good, e, season);
    let (lo, hi) = at_bound(defs, e);
    let (stock, target, event_demand, liquidity) = (e.stock, e.target, e.event_demand, e.liquidity);
    let f = e.flow.today(day);
    if liquidity != Fx::ONE {
        f.liquidity = liquidity;
    }
    f.stock_close = stock;
    f.target_close = target;
    f.demand_mult = demand_mult;
    f.season_demand = season_demand;
    f.event_demand = event_demand;
    f.popular = popular;
    f.clamped = if lo {
        -1
    } else if hi {
        1
    } else {
        0
    };
}

/// 价格是否卡在下限或上限（平衡统计用）。
pub fn at_bound(defs: &StaticData, e: &MarketEntry) -> (bool, bool) {
    let lo = defs.rules.price_floor.apply(e.base_price).max(1);
    let hi = defs.rules.price_cap.apply(e.base_price).max(lo);
    (e.price <= lo, e.price >= hi)
}

/// 普通买入与期货采购共用托运限制，卖出和无效数量沿用原校验。
fn check_reservation(world: &World, loc: LocId, good: GoodId, side: Side, qty: i64) -> Result<(), CommandError> {
    if qty > 0 && side == Side::Buy && crate::contract::market_reserved(world, loc, good) {
        return Err(crate::error::Reason::new("market.reserved", "（待写）").rule());
    }
    Ok(())
}
