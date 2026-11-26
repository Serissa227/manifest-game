//! 本地商人的预期与囤货（ECONOMY.md 6.6，规则见 [`crate::defs::MerchantRules`]）。
//!
//! 每个市场有一群本地商人，按启发式切换模型（Anufriev & Hommes 2012）形成对明天价格的预期。四条规则：
//! - 适应（ADA）：p̂ = 0.65·p + 0.35·p̂₋₁；
//! - 弱趋势（WTR）：p + 0.4·Δ；强趋势（STR）：p + 1.3·Δ（Δ = 今天与昨天收盘价之差）；
//! - 锚定调整（LAA）：(长期均价 + p) / 2 + Δ，向长期均价回归的基本面规则。
//!
//! 每天收盘之后（tick 第 3 步末，[`World::merchants_day`]）：
//! 1. 绩效 U = −误差² + 记忆 × U₋₁（误差按“长期均价 = 刻度”折算，与实验里 50 左右的价格尺度一致）；
//! 2. 占比 n = 惯性 × n₋₁ + (1 − 惯性) × softmax(强度 × U)，每条规则至少 `min_share`；
//! 3. 各规则对明天的预测，按占比加权得到主流预期，再乘传闻带来的偏移（每天衰减）；
//! 4. 存货：商人开张时自带平常的存货（`hoard_base` × 目标库存）；想要的存货 = 平常的存货 + 速度 × (预期涨幅 − 持有成本) × 目标库存，
//!    夹在 [0, `hoard_max` × 目标库存]，每天向它移动 `hoard_adjust`。囤入从市场库存划出、抛售划回，不涉及资金——
//!    趋势派当道时涨价引来囤积、跌价引来抛售（超调）；锚定派当道时高价时抛售、低价时囤入（回归更快）。
//!
//! 价格用精确到万分之一金币的报价（[`crate::market::precise_price_bp`]），便宜商品的整数报价太粗。
//! 规则关闭时这里什么也不做，商人状态保持全零、不写进存档。

use crate::defs::{MerchantRules, StaticData};
use crate::fixed::{Fx, Money, mul_div};
use crate::ids::{GoodId, LocId};
use crate::market::{precise_price_bp, price_mult_in};
use crate::news::NewsFact;
use crate::world::{MarketEntry, World};
use serde::{Deserialize, Serialize};

/// 四条启发式规则（顺序固定，状态里的数组按这个顺序）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Heuristic {
    /// 适应（简单指数平滑，α = 0.65）
    Ada,
    /// 弱趋势外推
    Wtr,
    /// 强趋势外推
    Str,
    /// 锚定调整（向长期均价回归）
    Laa,
}

impl Heuristic {
    pub const ALL: [Heuristic; 4] = [Heuristic::Ada, Heuristic::Wtr, Heuristic::Str, Heuristic::Laa];

    pub fn key(self) -> &'static str {
        match self {
            Heuristic::Ada => "ada",
            Heuristic::Wtr => "wtr",
            Heuristic::Str => "str",
            Heuristic::Laa => "laa",
        }
    }
}

/// 某市场的本地商人。全零表示还没有（规则关闭、旧存档）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Merchants {
    /// 四派的占比（ADA、WTR、STR、LAA；和为 1）
    #[serde(default)]
    pub shares: [Fx; 4],
    /// 四派的绩效（≤ 0，越接近 0 越好）
    #[serde(default)]
    pub perf: [Fx; 4],
    /// 四派对下一个收盘价的预测（万分之一金币）
    #[serde(default)]
    pub forecast: [Money; 4],
    /// 最近一次收盘价（万分之一金币）
    #[serde(default)]
    pub last: Money,
    /// 长期均价（锚定派的锚，慢速指数平均；万分之一金币）
    #[serde(default)]
    pub anchor: Money,
    /// 主流预期：各派的加权预测乘传闻偏移（万分之一金币）
    #[serde(default)]
    pub expect: Money,
    /// 囤货（件）
    #[serde(default)]
    pub hoard: i64,
    /// 传闻带来的预期偏移（±，每天衰减）
    #[serde(default)]
    pub rumor: Fx,
}

impl Merchants {
    /// 全零：还没有商人（存档里省略）。
    pub fn is_unset(&self) -> bool {
        *self == Merchants::default()
    }

    /// 开张：四派各占四分之一，预测与锚都在当前价上。
    pub fn fresh(price: Money) -> Merchants {
        let p = price.max(1);
        Merchants {
            shares: [Fx::from_pct(25); 4],
            perf: [Fx::ZERO; 4],
            forecast: [p; 4],
            last: p,
            anchor: p,
            expect: p,
            hoard: 0,
            rumor: Fx::ZERO,
        }
    }
}

/// exp(−k / 16)，k = 0..=160（万分之一；更大的 x 视为 0）。
const EXP_NEG: [i64; 161] = [
    10000, 9394, 8825, 8290, 7788, 7316, 6873, 6456, 6065, 5698, 5353, 5028, 4724, 4437, 4169, 3916, 3679, 3456, 3247,
    3050, 2865, 2691, 2528, 2375, 2231, 2096, 1969, 1850, 1738, 1632, 1534, 1441, 1353, 1271, 1194, 1122, 1054, 990,
    930, 874, 821, 771, 724, 681, 639, 601, 564, 530, 498, 468, 439, 413, 388, 364, 342, 321, 302, 284, 266, 250, 235,
    221, 208, 195, 183, 172, 162, 152, 143, 134, 126, 118, 111, 104, 98, 92, 87, 81, 76, 72, 67, 63, 59, 56, 52, 49,
    46, 44, 41, 38, 36, 34, 32, 30, 28, 26, 25, 23, 22, 21, 19, 18, 17, 16, 15, 14, 13, 12, 12, 11, 10, 10, 9, 9, 8, 8,
    7, 7, 6, 6, 6, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 0, 0,
];

/// exp(−x)（x ≥ 0，定点；查表并在相邻两格之间线性插值）。
pub fn exp_neg(x: Fx) -> Fx {
    if x <= Fx::ZERO {
        return Fx::ONE;
    }
    // 表的步长是 1/16：x × 16 的整数部分与余数
    let scaled = x.raw() * 16;
    let k = (scaled / Fx::SCALE) as usize;
    if k + 1 >= EXP_NEG.len() {
        return Fx::ZERO;
    }
    let frac = scaled % Fx::SCALE;
    let (a, b) = (EXP_NEG[k], EXP_NEG[k + 1]);
    Fx(a + mul_div(b - a, frac, Fx::SCALE))
}

/// 四派对下一个收盘价的预测：今天收盘价 `p`、上一次收盘价 `prev`、适应派上一次的预测 `ada_prev`、长期均价 `anchor`。
pub fn heuristic_forecasts(p: Money, prev: Money, ada_prev: Money, anchor: Money) -> [Money; 4] {
    let delta = p - prev;
    let ada = Fx::from_pct(65).apply(p) + Fx::from_pct(35).apply(ada_prev);
    let wtr = p + Fx::from_pct(40).apply(delta);
    let str_ = p + Fx::from_pct(130).apply(delta);
    let laa = (anchor + p) / 2 + delta;
    [ada, wtr, str_, laa].map(|f| f.max(1))
}

/// 新的占比：惯性 × 旧占比 + (1 − 惯性) × softmax(强度 × 绩效)，每条至少 `min_share`，和为 1。
pub fn next_shares(r: &MerchantRules, shares: [Fx; 4], perf: [Fx; 4]) -> [Fx; 4] {
    let best = perf.iter().copied().max().unwrap_or(Fx::ZERO);
    let w = perf.map(|u| exp_neg(r.intensity.mul(best - u)));
    let total = w.iter().fold(Fx::ZERO, |s, x| s + *x).max(Fx(1));
    let mut n = [Fx::ZERO; 4];
    for i in 0..4 {
        let soft = w[i].div(total);
        n[i] = r.inertia.mul(shares[i]) + (Fx::ONE - r.inertia).mul(soft);
    }
    // 最低占比：不足的补到下限，补上的部分按比例从其余几派里扣
    let low: [bool; 4] = n.map(|x| x < r.min_share);
    let floor_total = r.min_share.mul(Fx::from_int(low.iter().filter(|b| **b).count() as i64));
    let rest_total = (0..4).filter(|i| !low[*i]).fold(Fx::ZERO, |s, i| s + n[i]).max(Fx(1));
    let room = (Fx::ONE - floor_total).max(Fx::ZERO);
    let mut out = [Fx::ZERO; 4];
    for i in 0..4 {
        out[i] = if low[i] { r.min_share } else { n[i].mul(room).div(rest_total) };
    }
    // 取整的余量给占比最大的一派，保证和正好是 1
    let rest = Fx::ONE - out.iter().fold(Fx::ZERO, |s, x| s + *x);
    let top = (0..4).max_by_key(|i| (out[*i], std::cmp::Reverse(*i))).unwrap_or(0);
    out[top] += rest;
    out
}

/// 收盘之后的一天：绩效、占比、预测、主流预期与传闻衰减（不含囤货）。`p` 为今天的精确收盘价。
pub fn observe(r: &MerchantRules, m: &mut Merchants, p: Money) {
    let p = p.max(1);
    if m.shares == [Fx::ZERO; 4] {
        *m = Merchants { hoard: m.hoard, rumor: m.rumor, ..Merchants::fresh(p) };
        return;
    }
    let scale = r.scale.max(1);
    let normal = m.anchor.max(1);
    for i in 0..4 {
        let err = Fx(mul_div((p - m.forecast[i]) * scale, Fx::SCALE, normal));
        // 误差截断在 ±100 点以内（单日翻倍以上的跳变），平方不会溢出
        let err = err.clamp(Fx::from_int(-100), Fx::from_int(100));
        m.perf[i] = (m.perf[i].mul(r.memory) - err.mul(err)).max(Fx::from_int(-10_000));
    }
    m.shares = next_shares(r, m.shares, m.perf);
    m.anchor += mul_div(p - m.anchor, 1, r.anchor_days.max(1));
    m.forecast = heuristic_forecasts(p, m.last, m.forecast[0], m.anchor);
    m.last = p;
    let mix: Money = (0..4).map(|i| m.shares[i].apply(m.forecast[i])).sum();
    m.expect = (Fx::ONE + m.rumor).apply(mix).max(1);
    m.rumor = r.rumor_decay.mul(m.rumor);
}

/// 今天的存货变动（正数为囤入）：向“平常的存货 + 速度 × (预期涨幅 − 持有成本) × 目标库存”（夹在 [0, 上限]）移动一步，
/// 囤入不超过市场现有的库存。
pub fn hoard_move(r: &MerchantRules, m: &Merchants, e: &MarketEntry, p: Money) -> i64 {
    let rise = Fx::ratio(m.expect - p, p.max(1)) - r.holding_cost;
    let cap = r.hoard_max.apply(e.target).max(0);
    let want = (r.hoard_base.apply(e.target) + r.hoard_speed.mul(rise).apply(e.target)).clamp(0, cap);
    let delta = r.hoard_adjust.apply(want - m.hoard);
    if delta > 0 { delta.min(e.stock.max(0)) } else { delta }
}

/// 传闻对市场的影响方向（+1 看涨：价格高企、短缺；−1 看跌：价格低迷）。
pub fn rumor_direction(fact: &NewsFact) -> Option<(LocId, GoodId, i64)> {
    match fact {
        NewsFact::PriceHigh { loc, good } | NewsFact::Shortage { loc, good } => Some((*loc, *good, 1)),
        NewsFact::PriceLow { loc, good } => Some((*loc, *good, -1)),
        _ => None,
    }
}

impl World {
    /// tick 第 3 步末（人口与繁荣度之后）：各市场的本地商人更新预期，并按预期囤货或抛售。
    pub(crate) fn merchants_day(&mut self) {
        let defs = self.defs.clone();
        let r = &defs.rules.merchants;
        if !r.enabled {
            return;
        }
        let day = self.state.day;
        // 当天的季节整趟只推一次、各地每地换算一次（原先每个市场条目都从日期重新推一遍）
        let today_season = defs.calendar.season_of(day);
        for (ls, loc) in self.state.locations.iter_mut().zip(&defs.locations) {
            let season = loc.hemisphere.season(today_season);
            // 开放市场补上的只收不卖的条目没有本地商人（不囤货；开放市场关闭时没有这样的条目）
            for (good, e) in ls.market.iter_mut().filter(|(_, e)| !e.extra) {
                let p = precise_price_bp(&defs, e, price_mult_in(&defs, day, *good, e, season));
                let mut m = std::mem::take(&mut e.merchants);
                if m.is_unset() {
                    // 开张：带着平常的存货（不从市场库存里拿）
                    m = Merchants { hoard: r.hoard_base.apply(e.target).max(0), ..Merchants::fresh(p) };
                    e.merchants = m;
                    continue;
                }
                observe(r, &mut m, p);
                let delta = hoard_move(r, &m, e, p);
                m.hoard += delta;
                e.stock -= delta;
                e.flow.today(day).hoarded += delta;
                e.merchants = m;
            }
        }
    }

    /// 传闻或新闻发布时：涉及的市场里本地商人的预期按“可信度 × 幅度”偏移（无论真假；ECONOMY.md 8.3）。
    pub(crate) fn rumor_moves_expectations(&mut self, fact: &NewsFact, credibility: u8) {
        let r = self.defs.rules.merchants.clone();
        if !r.enabled {
            return;
        }
        let Some((loc, good, dir)) = rumor_direction(fact) else { return };
        let Some(e) = self.market_mut(loc, good).filter(|e| !e.extra) else { return };
        let push = r.rumor_amplitude.mul(Fx::from_pct(i64::from(credibility.min(100))));
        let shift = if dir > 0 { push } else { -push };
        e.merchants.rumor = (e.merchants.rumor + shift).clamp(-r.rumor_amplitude, r.rumor_amplitude);
    }
}

/// 某市场的本地商人（规则关闭或还没有时为 None）。
pub fn merchants_of<'a>(defs: &StaticData, e: &'a MarketEntry) -> Option<&'a Merchants> {
    (defs.rules.merchants.enabled && !e.merchants.is_unset()).then_some(&e.merchants)
}
