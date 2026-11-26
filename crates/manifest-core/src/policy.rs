//! 势力的经济政策（docs/ECONOMY.md 6.10、8.4，规则见 [`crate::defs::PolicyRules`]）。
//!
//! - 出口禁令、进口关税、出口税与产量补贴是组合事件效果词表里的四种效果（`export_ban`、`import_tariff`、`export_tariff`、
//!   `subsidy`）：模型也可以在边界内提议，走组合事件现有的裁决、校验与强度预算。
//!   出口禁令：该势力的地点不许买走这种商品（本地消费与补给口粮不受影响）；进口关税与出口税：在该势力的地点卖出 / 买入
//!   这种商品时交易税乘上系数；补贴：某地这种商品的产量乘上系数。
//! - 另有两条规则触发（离线也会发生），每月末检查：
//!   1. 本国港口的主食这个月的均价达到它往常价格（之前至多 12 个月的月均价的平均，至少要有 6 个月）的 `staple_ratio` 倍
//!      → 该势力禁止运出这种主食 `ban_days` 天（真实数据的物价普遍在基准价的 1.7 倍上下，和基准价比会月月禁运）；
//!   2. 本国特产这个月被买走的数量达到当地一个月正常产量的 `export_share` 倍 → 该势力对它加征 `export_tax` 倍的出口税
//!      `export_tax_days` 天。
//!
//!   规则触发的政策记为来源“规则”的组合事件，不占模型组合事件的冷却与年度上限；同一势力同一商品已有同类政策时不重复。
//!   “国库亏空 → 加税”要等势力国库（E8）。
//! - 规则关闭时这里什么也不做，状态里没有新字段（与旧版逐日一致）。

use crate::composed::{ComposedEffect, ComposedSource};
use crate::defs::EffectKind;
use crate::error::CoreError;
use crate::events::EventParams;
use crate::fixed::{Fx, Money};
use crate::ids::*;
use crate::market::Side;
use crate::world::World;

/// 这个月的均价是否达到往常价格（之前至多 12 个月的月均价的平均）的 `ratio` 倍；月线不到 7 个月时不算。
pub fn price_spike(monthly: &[Money], ratio: Fx) -> bool {
    let n = monthly.len();
    if n < 7 {
        return false;
    }
    let prev = &monthly[n.saturating_sub(13)..n - 1];
    let usual = prev.iter().sum::<Money>() / prev.len() as Money;
    monthly[n - 1] >= ratio.apply(usual.max(1))
}

impl World {
    /// 某地是否禁止运出（买走）某商品（所属势力的出口禁令）。
    pub fn export_banned(&self, loc: LocId, good: GoodId) -> bool {
        if self.defs.locations.get(loc.idx()).is_none() {
            return false;
        }
        self.state.events.mods.export_ban.iter().any(|(f, g)| *f == self.location_faction(loc) && *g == good)
    }

    /// 某地买卖某商品时交易税的政策系数：卖出看进口关税、买入看出口税（没有时为 1）。
    pub fn tariff_mult(&self, loc: LocId, good: GoodId, side: Side) -> Fx {
        if self.defs.locations.get(loc.idx()).is_none() {
            return Fx::ONE;
        }
        let mods = &self.state.events.mods;
        let list = match side {
            Side::Sell => &mods.import_tariff,
            Side::Buy => &mods.export_tariff,
        };
        list.iter()
            .filter(|(f, g, _)| *f == self.location_faction(loc) && *g == good)
            .fold(Fx::ONE, |acc, (_, _, m)| acc.mul(*m))
    }

    /// 每天结算之后（规则打开时）：记下特产今天被买走的数量；月末按两条规则触发政策。
    pub(crate) fn policy_day(&mut self) -> Result<(), CoreError> {
        let rules = self.defs.rules.policies.clone();
        if !rules.enabled {
            return Ok(());
        }
        let day = self.state.day;
        for ls in self.state.locations.iter_mut() {
            for e in ls.market.values_mut() {
                if e.specialty && e.flow.day == day {
                    e.month_out += e.flow.player_bought + e.flow.npc_bought + e.flow.other_bought;
                }
            }
        }
        if !self.defs.calendar.month_end(day) {
            return Ok(());
        }
        let defs = self.defs.clone();
        let mut starts: Vec<(EffectKind, FactionId, GoodId)> = Vec::new();
        for (li, ls) in self.state.locations.iter().enumerate() {
            let ldef = defs.loc(LocId::from_idx(li));
            if !ldef.is_port() {
                continue;
            }
            let f = self.location_faction(LocId::from_idx(li));
            for (g, e) in &ls.market {
                let mut push = |x: (EffectKind, FactionId, GoodId)| {
                    if !starts.contains(&x) {
                        starts.push(x);
                    }
                };
                // 主食禁运只看地点清单里的主食（开放市场补上的只收不卖的条目不算）
                if rules.staples.contains(g) && !e.extra && price_spike(&e.monthly, rules.staple_ratio) {
                    push((EffectKind::ExportBan, f, *g));
                }
                let normal = e.supply * self.defs.calendar.month_days(day) as i64;
                if e.specialty && normal > 0 && e.month_out >= rules.export_share.apply(normal) {
                    push((EffectKind::ExportTariff, f, *g));
                }
            }
        }
        for ls in self.state.locations.iter_mut() {
            for e in ls.market.values_mut() {
                e.month_out = 0;
            }
        }
        for (effect, f, g) in starts {
            let active = self
                .state
                .events
                .active
                .iter()
                .any(|a| a.effect == Some(effect) && a.params.faction_a == Some(f) && a.params.good == Some(g));
            if active {
                continue;
            }
            let (mult, days) = match effect {
                EffectKind::ExportBan => (None, rules.ban_days),
                _ => (Some(rules.export_tax), rules.export_tax_days),
            };
            let (fname, gname) = (defs.faction(f).name.clone(), defs.good(g).name.clone());
            let (title, text) = match effect {
                EffectKind::ExportBan => (
                    format!("{fname}禁运{gname}"),
                    format!("{fname}的港口{gname}价格居高不下，官府下令禁止运出 {days} 天。"),
                ),
                _ => (
                    format!("{fname}加征{gname}出口税"),
                    format!(
                        "{gname}被大量运出{fname}，官府把它的出口税加到 {} 倍，为期 {days} 天。",
                        crate::composed::fx_short(rules.export_tax)
                    ),
                ),
            };
            let params =
                EventParams { faction_a: Some(f), good: Some(g), mult, days: Some(days), ..EventParams::default() };
            self.begin_composed(&title, &text, &[ComposedEffect { effect, params }], ComposedSource::Rule, false)?;
        }
        Ok(())
    }
}
