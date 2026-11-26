//! 城镇工坊（ECONOMY.md 6.5，规则见 [`crate::defs::WorkshopRules`]，数据见 `data/workshops.toml`）。
//!
//! - 工坊按配方从本地市场取原料、把产出放回本地市场，不经过资金；接手当地这种加工品均衡产量的一部分，
//!   其余仍是凭空的家庭手工产出（本地生产者的产能随之缩小，见 [`crate::market`]）。
//! - 每天（tick 第 2 步，本地产销之后）：想做的量 = 产能 × 劳动力；原料不够时按最缺的一种少做；产出与投入都按万分之一件累计余数。
//! - 每天收盘之后记下“产出价值 / 原料价值”（影子价格）；月末头一年记参照，此后与本地生产者同一套规则伸缩产能；
//!   当月价值比低于停工门槛（亏本）停工，回到复工门槛以上复工。产出卖不掉时价值比下降、工坊减产或停工，不会堵死整条链。
//! - 规则关闭时这里什么也不做，工坊状态不写进存档。

use crate::defs::{Rules, StaticData, WorkshopDef};
use crate::fixed::{Fx, mul_div_floor};
use crate::ids::{GoodId, LocId, RecipeId};
use crate::market::{UNIT_BP, price_mult_in, shadow_price_bp};
use crate::world::{MarketEntry, World};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 一座城镇工坊的状态。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Workshop {
    /// 开局产能与当前产能（万分之一件产出 / 天）
    #[serde(default)]
    pub k0: i64,
    #[serde(default)]
    pub k: i64,
    /// 对价值比的预期（相对当月参照的比例，1.0 为正常）
    #[serde(default)]
    pub expect: Fx,
    /// 头一年各月（1–12 月）的价值比（万分之一；12 个月都有之前只看不动）
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub refs: Vec<i64>,
    /// 本月至今每日价值比之和（万分之一）与天数；月末用完清零
    #[serde(default)]
    pub month_sum: i64,
    #[serde(default)]
    pub month_days: u32,
    /// 产出与各种投入（与配方同序）的余数（万分之一件）
    #[serde(default)]
    pub carry_out: i64,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub carry_in: Vec<i64>,
    /// 亏本停工
    #[serde(default)]
    pub stopped: bool,
    /// 上个月的价值比（0 表示还没有）
    #[serde(default)]
    pub ratio: Fx,
    /// 今天做了几件、是否因为缺料少做
    #[serde(default)]
    pub made: i64,
    #[serde(default)]
    pub short: bool,
}

impl Workshop {
    /// 12 个月的参照都有了（头一年已过，开始调整产能）。
    pub fn learned(&self) -> bool {
        self.learned_in(12)
    }

    pub fn learned_in(&self, months: usize) -> bool {
        self.refs.len() == months && self.refs.iter().all(|r| *r > 0)
    }

    /// 某月（1–12）的参照价值比（万分之一；还没有时为 0）。
    pub fn reference(&self, month: u32) -> i64 {
        self.refs.get(month.saturating_sub(1) as usize).copied().unwrap_or(0)
    }

    /// 当前产能相对开局的比例。
    pub fn capacity_ratio(&self) -> Fx {
        if self.k0 > 0 { Fx::ratio(self.k, self.k0) } else { Fx::ONE }
    }
}

/// 新工坊：产能 = 份额 × 当地这种商品的均衡产量（万分之一件 / 天）。
fn new_workshop(wd: &WorkshopDef, supply: i64) -> Workshop {
    let k0 = wd.share.apply(supply.max(0) * UNIT_BP).max(1);
    Workshop { k0, k: k0, expect: Fx::ONE, carry_in: vec![0; wd.inputs.len()], ..Workshop::default() }
}

/// 产出价值 / 原料价值（按影子价格；万分之一，最多 10 倍）。
pub fn value_ratio(defs: &StaticData, day: u32, market: &BTreeMap<GoodId, MarketEntry>, wd: &WorkshopDef) -> Fx {
    value_ratio_in(defs, day, market, wd, defs.calendar.season_of(day))
}

pub fn value_ratio_in(
    defs: &StaticData,
    day: u32,
    market: &BTreeMap<GoodId, MarketEntry>,
    wd: &WorkshopDef,
    season: crate::calendar::Season,
) -> Fx {
    let price = |g: GoodId| {
        market.get(&g).map(|e| shadow_price_bp(defs, e, price_mult_in(defs, day, g, e, season))).unwrap_or(0)
    };
    let out = price(wd.output).saturating_mul(wd.out_qty);
    let cost: i64 = wd.inputs.iter().map(|(g, q)| price(*g).saturating_mul(*q)).sum();
    let cap = Fx::from_int(10);
    if cost <= 0 { cap } else { Fx::ratio(out, cost).min(cap) }
}

/// 月末（`month` 为刚结束的月份）：停工或复工；头一年记参照；此后按价值比的预期伸缩产能（`cap_mult` 为人口比例，放宽产能上限）。
fn month_end(rules: &Rules, ws: &mut Workshop, month: u32, cap_mult: Fx, months: usize) {
    let v = if ws.month_days > 0 { ws.month_sum / i64::from(ws.month_days) } else { 0 };
    ws.month_sum = 0;
    ws.month_days = 0;
    ws.ratio = Fx(v);
    let wr = &rules.workshops;
    if Fx(v) < wr.stop_below {
        ws.stopped = true;
    } else if ws.stopped && Fx(v) >= wr.restart_above {
        ws.stopped = false;
    }
    if !ws.learned_in(months) {
        ws.refs.resize(months, 0);
        if let Some(slot) = ws.refs.get_mut(month.saturating_sub(1) as usize)
            && *slot == 0
        {
            *slot = v.max(1);
        }
        return;
    }
    let lo = wr.min_ratio.apply(ws.k0).max(1);
    let hi = wr.max_ratio.mul(cap_mult).apply(ws.k0).max(lo);
    if ws.stopped {
        // 停工时产能不变，只随人口收紧上限
        ws.k = ws.k.clamp(lo, hi);
        return;
    }
    let pr = &rules.producers;
    let seen = Fx::ratio(v, ws.reference(month).max(1));
    ws.expect = ws.expect + (seen - ws.expect).mul(pr.expect_lambda);
    let gap = (ws.expect - Fx::ONE).clamp(-pr.gap_cap, pr.gap_cap);
    ws.k = (Fx::ONE + gap.mul(pr.kappa)).apply(ws.k).clamp(lo, hi);
}

impl World {
    /// tick 第 2 步（本地产销之后）：各地工坊按配方从本地市场取原料、把产出放回本地市场。
    pub(crate) fn workshops_run(&mut self) {
        let defs = self.defs.clone();
        if !defs.rules.workshops.enabled {
            return;
        }
        let day = self.state.day;
        let pop_on = defs.rules.population.enabled;
        for (ls, def) in self.state.locations.iter_mut().zip(&defs.locations) {
            if def.workshops.is_empty() {
                continue;
            }
            let labour = if pop_on && ls.people.pop0 > 0 { ls.people.labour() } else { Fx::ONE };
            // 市场深度曲线（T01）抬高家庭手工的产量与目标库存时，工坊按同样的倍数跟上（没有曲线时为 1，不乘）
            let boost = crate::market::depth_boost(&defs, ls.development);
            for wd in &def.workshops {
                let supply = def.market.iter().find(|m| m.good == wd.output).map(|m| m.supply).unwrap_or(0);
                let ws = ls.workshops.entry(wd.recipe).or_insert_with(|| new_workshop(wd, supply));
                ws.carry_in.resize(wd.inputs.len(), 0);
                let run = if boost == Fx::ONE { labour.apply(ws.k) } else { boost.apply(labour.apply(ws.k)) };
                let want = if ws.stopped { 0 } else { run };
                // 原料够做多少：保证按余数累计后取走的整件数不超过库存
                let mut can = want;
                for ((g, q), carry) in wd.inputs.iter().zip(&ws.carry_in) {
                    let stock = ls.market.get(g).map(|e| e.stock.max(0)).unwrap_or(0);
                    let room = (stock * UNIT_BP + UNIT_BP - 1 - carry).max(0);
                    can = can.min(mul_div_floor(room, wd.out_qty, (*q).max(1)));
                }
                can = can.max(0);
                ws.short = can < want;
                for ((g, q), carry) in wd.inputs.iter().zip(ws.carry_in.iter_mut()) {
                    let total = *carry + mul_div_floor(can, *q, wd.out_qty.max(1));
                    *carry = total % UNIT_BP;
                    let take = total / UNIT_BP;
                    if let Some(e) = ls.market.get_mut(g) {
                        e.stock -= take;
                        e.flow.today(day).workshop_in += take;
                    }
                }
                let total = ws.carry_out + can;
                ws.carry_out = total % UNIT_BP;
                ws.made = total / UNIT_BP;
                if let Some(e) = ls.market.get_mut(&wd.output) {
                    e.stock += ws.made;
                    e.flow.today(day).workshop_out += ws.made;
                }
            }
        }
    }

    /// tick 第 3 步（收盘之后）：记下各工坊当天的价值比；月末停工或复工、调整产能。
    pub(crate) fn workshops_close(&mut self) {
        let defs = self.defs.clone();
        if !defs.rules.workshops.enabled {
            return;
        }
        let day = self.state.day;
        let month_end_today = self.defs.calendar.month_end(day);
        let month = self.defs.calendar.date_of(day).month;
        let pop_on = defs.rules.population.enabled;
        for (ls, def) in self.state.locations.iter_mut().zip(&defs.locations) {
            let cap_mult = if pop_on && ls.people.pop0 > 0 { ls.people.ratio() } else { Fx::ONE };
            for wd in &def.workshops {
                let v = value_ratio_in(&defs, day, &ls.market, wd, def.hemisphere.season(defs.calendar.season_of(day)));
                let Some(ws) = ls.workshops.get_mut(&wd.recipe) else { continue };
                ws.month_sum += v.raw();
                ws.month_days += 1;
                if month_end_today {
                    month_end(&defs.rules, ws, month, cap_mult, defs.calendar.months().len());
                }
            }
        }
    }

    /// 某地某配方的工坊状态（还没有时为 None）。
    pub fn workshop(&self, loc: LocId, recipe: RecipeId) -> Option<&Workshop> {
        self.state.locations.get(loc.idx())?.workshops.get(&recipe)
    }
}
