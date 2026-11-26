//! E02：发展度的新尺度、月度增长与旧档换算。关闭规则时保留各入口的旧算法。

use crate::defs::StaticData;
use crate::fixed::{Fx, Money, isqrt, mul_div, mul_div_floor};
use crate::ids::{LocId, OwnerId};
use crate::market::{Side, TradeQuote};
use crate::world::World;
use serde::{Deserialize, Serialize};

pub const POINT_BP: i64 = 10_000;

/// 所有速度、比例和阶段都由世界包给出；经典世界缺省关闭。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DevelopmentRules {
    pub enabled: bool,
    pub max: i64,
    pub depth_ref: i64,
    pub speed_bands: Vec<[i64; 2]>,
    pub busy_cap_bp: i64,
    pub busy_floor_bp: i64,
    pub specialty_sources: i64,
    pub specialty_weight_pct: i64,
    pub specialty_max_base: i64,
    pub decay_bp: i64,
    pub invest_coef: i64,
    pub works_cap_pct: i64,
    pub event_point_pct: i64,
    pub stages: Vec<i64>,
}

impl Default for DevelopmentRules {
    fn default() -> Self {
        Self {
            enabled: false,
            max: 9999,
            depth_ref: 50,
            speed_bands: vec![[1, 8000], [30, 10_000], [90, 13_000]],
            busy_cap_bp: 30_000,
            busy_floor_bp: 0,
            specialty_sources: 3,
            specialty_weight_pct: 300,
            specialty_max_base: 0,
            decay_bp: 25,
            invest_coef: 300,
            works_cap_pct: 25,
            event_point_pct: 5,
            stages: vec![30, 100, 300, 1000, 3000, 9999],
        }
    }
}

impl DevelopmentRules {
    pub fn problems(&self) -> Vec<(&'static str, &'static str)> {
        let mut out = Vec::new();
        if !(100..=9999).contains(&self.max) {
            out.push(("max", "必须在 100 到 9999 之间"));
        }
        if self.depth_ref < 1 {
            out.push(("depth_ref", "必须至少为 1"));
        }
        if self.speed_bands.first().is_none_or(|b| b[0] != 1)
            || self.speed_bands.windows(2).any(|w| w[0][0] >= w[1][0])
            || self.speed_bands.iter().any(|b| b[1] < 0)
        {
            out.push(("speed_bands", "下限须从 1 开始严格递增，速度非负"));
        }
        if self.busy_floor_bp < 0 || self.busy_cap_bp < self.busy_floor_bp {
            out.push(("busy_cap_bp", "繁忙度须满足 0 ≤ 下限 ≤ 上限"));
        }
        if self.specialty_sources < 0 {
            out.push(("specialty_sources", "必须非负"));
        }
        if self.specialty_weight_pct < 100 {
            out.push(("specialty_weight_pct", "必须至少为 100"));
        }
        if self.specialty_max_base < 0 {
            out.push(("specialty_max_base", "必须非负"));
        }
        if !(0..=10_000).contains(&self.decay_bp) {
            out.push(("decay_bp", "必须在 0 到 10000 之间"));
        }
        if self.invest_coef < 1 {
            out.push(("invest_coef", "必须至少为 1"));
        }
        if self.works_cap_pct < 0 {
            out.push(("works_cap_pct", "必须非负"));
        }
        if !(0..=100).contains(&self.event_point_pct) {
            out.push(("event_point_pct", "必须在 0 到 100 之间"));
        }
        if self.stages.len() != 6
            || self.stages.first().is_none_or(|s| *s <= 1)
            || self.stages.windows(2).any(|w| w[0] >= w[1])
            || self.stages.last() != Some(&self.max)
        {
            out.push(("stages", "须有六个严格递增的门槛，首项大于 1，末项等于 max"));
        }
        out
    }

    /// 万分之一深度；平方根向下取整，最大尺度下中间量仍在 i64 范围内。
    pub fn depth_bp(&self, development: i64) -> i64 {
        isqrt(mul_div(development.clamp(1, self.max), 100_000_000, self.depth_ref))
    }

    /// 一整点的金币成本；按任务单向下取整。
    pub fn point_cost(&self, development: i64) -> Money {
        mul_div_floor(self.invest_coef, isqrt(development.clamp(1, self.max) * 100_000_000), POINT_BP).max(1)
    }

    pub fn speed_bp(&self, base: i64) -> i64 {
        self.speed_bands.iter().rev().find(|b| base >= b[0]).map_or(0, |b| b[1])
    }

    /// 序号、当前阶段下界与下一阶段门槛，界面自行给阶段出字。
    pub fn stage(&self, development: i64) -> (u8, i64, Option<i64>) {
        let index = self.stages.iter().take_while(|s| **s <= development).count();
        (index as u8, index.checked_sub(1).map_or(1, |i| self.stages[i]), self.stages.get(index).copied())
    }

    pub fn works_cap(&self, base: i64) -> i64 {
        mul_div_floor(base, 100i64.saturating_add(self.works_cap_pct), 100).min(self.max)
    }

    pub fn event_delta(&self, development: i64, delta: i64) -> i64 {
        let magnitude = delta.saturating_abs();
        let scaled = mul_div(magnitude, development.saturating_mul(self.event_point_pct), 100);
        delta.signum() * magnitude.max(scaled)
    }
}

/// R1/R2 的旧算法，独立于新开关，供迁移使用；保留 Fx 曲线原有的逐步取整。
pub fn legacy_depth(defs: &StaticData, development: i64) -> Fx {
    let dev = development.clamp(1, 100);
    match &defs.rules.depth_curve {
        Some(curve) if curve.points.first().is_some_and(|first| Fx::from_int(dev) > first.0) => {
            curve.eval(Fx::from_int(dev))
        }
        _ => crate::market::development_factor(dev),
    }
}

pub fn from_legacy(defs: &StaticData, development: i64) -> i64 {
    let r = &defs.rules.development;
    let f = legacy_depth(defs, development).raw();
    mul_div(r.depth_ref, f * f, 100_000_000).clamp(1, r.max)
}

/// 开局人口与深度同比；关闭时保持原有线性折算。
pub fn initial_population(defs: &StaticData, development: i64) -> i64 {
    let per = defs.rules.population.per_development;
    if defs.rules.development.enabled {
        let d = development.clamp(1, defs.rules.development.max);
        mul_div_floor(per, isqrt(d * 50 * POINT_BP), 100).max(1)
    } else {
        development.max(1) * per
    }
}

/// 人口上限随现值与开局值的深度之比变化；pop0 始终保留存档里的原值。
pub fn population_cap(defs: &StaticData, development: i64, base: i64, pop0: i64) -> i64 {
    let cap = defs.rules.population.max_ratio.apply(pop0);
    let r = &defs.rules.development;
    if r.enabled { mul_div(cap, r.depth_bp(development), r.depth_bp(base).max(1)) } else { cap }
}

/// 所有发展度变化共用万分之一点；空状态整块省略，旧档不需要补字段。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct DevGrowth {
    pub frac: i64,
    pub month_value: Money,
    pub month_special: Money,
    pub month_invest: i64,
    pub month_works: i64,
    pub month_events: i64,
    pub last: Option<DevMonth>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_seen: Option<u8>,
}

impl DevGrowth {
    pub fn is_unset(&self) -> bool {
        self.frac == 0
            && self.month_value == 0
            && self.month_special == 0
            && self.month_invest == 0
            && self.month_works == 0
            && self.month_events == 0
            && self.last.is_none()
            && self.stage_seen.is_none()
    }

    fn clear_month(&mut self) {
        self.month_value = 0;
        self.month_special = 0;
        self.month_invest = 0;
        self.month_works = 0;
        self.month_events = 0;
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DevMonth {
    pub day: u32,
    pub rel_bp: i64,
    pub busy: i64,
    pub specialty: i64,
    pub invest: i64,
    pub works: i64,
    pub events: i64,
    pub decay: i64,
    pub net: i64,
}

pub fn is_legacy(model: &u8) -> bool {
    *model == 0
}

/// 逐点买入的预览与执行共用一条纯函数；钱不够一点时，向下折成零头。
pub fn purchase(r: &DevelopmentRules, development: i64, frac: i64, amount: Money) -> (i64, i64) {
    let mut dev = development.clamp(1, r.max);
    let mut frac = frac.clamp(0, POINT_BP - 1);
    let mut left = amount.max(0);
    while dev < r.max && left > 0 {
        let cost = r.point_cost(dev);
        let need = cost - mul_div_floor(cost, frac, POINT_BP);
        if left >= need {
            left -= need;
            dev += 1;
            frac = 0;
        } else {
            frac += mul_div_floor(left, POINT_BP, cost);
            break;
        }
    }
    (dev, frac)
}

impl World {
    /// 在 reconcile 最前面迁移旧尺度；新增地点随后按新数据补入，不参与二次换算。
    pub(crate) fn reconcile_development(&mut self) {
        if !self.defs.rules.development.enabled || self.state.dev_model != 0 {
            return;
        }
        for (ls, def) in self.state.locations.iter_mut().zip(&self.defs.locations) {
            if !def.is_site() {
                ls.development = from_legacy(&self.defs, ls.development);
                ls.growth = DevGrowth::default();
            }
        }
        self.state.dev_model = 1;
    }

    /// 成交后累计不含税货值；做市方不进入自然增长，特产只计本地清单的出口。
    pub(crate) fn record_development_trade(&mut self, q: &TradeQuote, by: Option<OwnerId>) {
        let defs = &self.defs;
        let r = &defs.rules.development;
        if !r.enabled || by.is_none() {
            return;
        }
        let Some(def) = defs.locations.get(q.loc.idx()).filter(|l| !l.is_site()) else { return };
        let Some(ls) = self.state.locations.get_mut(q.loc.idx()) else { return };
        let Some(entry) = ls.market.get(&q.good) else { return };
        let special = def.is_port()
            && q.side == Side::Buy
            && !entry.extra
            && entry.supply > 0
            && r.specialty_sources > 0
            && (r.specialty_max_base == 0 || def.development < r.specialty_max_base)
            && defs.good_sources.get(q.good.idx()).is_some_and(|n| i64::from(*n) <= r.specialty_sources);
        let value = q.gross.max(0);
        ls.growth.month_value = ls.growth.month_value.saturating_add(value);
        if special {
            ls.growth.month_special = ls.growth.month_special.saturating_add(value);
        }
    }

    /// 月初第六步：先取各地繁忙度，再算港口平均，最后落账；全程按 LocId 顺序。
    pub(crate) fn development_month(&mut self) {
        let defs = self.defs.clone();
        let r = &defs.rules.development;
        let day = self.state.day;
        let days = i64::from(defs.calendar.month_days(day - 1));
        let mut activity = Vec::with_capacity(self.state.locations.len());
        let (mut total, mut ports) = (0i64, 0i64);
        for (i, ls) in self.state.locations.iter().enumerate() {
            let loc = &defs.locations[i];
            let active =
                !loc.is_site() && (loc.is_port() || !loc.market.is_empty()) && self.location_open(LocId::from_idx(i));
            if !active {
                activity.push(None);
                continue;
            }
            let value = ls.growth.month_value;
            let weighted = value.saturating_add(mul_div(ls.growth.month_special, r.specialty_weight_pct - 100, 100));
            let daily =
                loc.market.iter().filter(|m| self.market_open(LocId::from_idx(i), m.good)).fold(0i64, |sum, m| {
                    sum.saturating_add(defs.good(m.good).base_price.saturating_mul(m.supply.saturating_add(m.demand)))
                });
            let baseline = mul_div(daily, r.depth_bp(ls.development) * days, POINT_BP).max(1);
            let busy = mul_div(weighted, POINT_BP, baseline).clamp(0, 100_000_000);
            activity.push(Some((busy, weighted)));
            if loc.is_port() {
                total += busy;
                ports += 1;
            }
        }
        let mean = total / ports.max(1);
        for (i, (ls, activity)) in self.state.locations.iter_mut().zip(activity).enumerate() {
            let Some((busy, weighted)) = activity else {
                // 关闭的地点不增长；不把旧月份的成交带进它以后重开的月份。
                ls.growth.clear_month();
                continue;
            };
            let base = defs.locations[i].development;
            let g = &mut ls.growth;
            let rel = if mean > 0 { mul_div(busy, POINT_BP, mean).clamp(r.busy_floor_bp, r.busy_cap_bp) } else { 0 };
            let gain = mul_div(r.speed_bp(base), rel, POINT_BP);
            let special = if weighted > 0 { mul_div(gain, weighted - g.month_value, weighted) } else { 0 };
            let before = ls.development * POINT_BP + g.frac;
            let excess = (before - base * POINT_BP).max(0);
            let decay = mul_div(excess, r.decay_bp, POINT_BP);
            let after = before.saturating_add(gain).saturating_sub(decay).clamp(POINT_BP, r.max * POINT_BP);
            ls.development = after / POINT_BP;
            g.frac = after % POINT_BP;
            let net = gain
                .saturating_add(g.month_invest)
                .saturating_add(g.month_works)
                .saturating_add(g.month_events)
                .saturating_sub(decay);
            g.last = Some(DevMonth {
                day,
                rel_bp: rel,
                busy: gain - special,
                specialty: special,
                invest: g.month_invest,
                works: g.month_works,
                events: g.month_events,
                decay,
                net,
            });
            g.clear_month();
        }
    }
}
