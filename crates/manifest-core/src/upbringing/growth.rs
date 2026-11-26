//! 活动、读书和故事共用成长上限；离开养成前不兑现到主角正式属性。
use crate::{OwnerId, World};
use std::collections::BTreeMap;

impl World {
    pub fn upbringing_flag(&self, key: &str) -> bool {
        self.state.cast.flags.contains(key)
            || self.state.story2.flags.contains(key)
            || self.state.upbringing.as_ref().is_some_and(|s| s.flags.contains(key))
    }
    pub fn upbringing_growth(&self, key: &str) -> i64 {
        self.state.upbringing.as_ref().and_then(|s| s.growth.get(key)).copied().unwrap_or(0)
    }
    pub fn upbringing_projected(&self, key: &str) -> i64 {
        if key == "arcana" && !self.upbringing_flag(super::ARCANA_AWAKENED_FLAG) {
            return 0;
        }
        let Some(index) = self.defs.captain.attribute_index(key) else {
            return 0;
        };
        let value = self.upbringing_growth(key);
        if key == "fortune" || self.defs.captain.group(index).is_some_and(|g| g.key == "conduct") {
            return value;
        }
        self.defs.upbringing.rules.growth_table.iter().find(|b| b.from <= value && value <= b.to).map_or(1, |b| b.value)
    }
    pub fn upbringing_rating(&self, key: &str) -> i64 {
        if key == "arcane_rating" && !self.upbringing_flag(super::ARCANA_AWAKENED_FLAG) {
            return 0;
        }
        let Some(r) = self.defs.captain.ratings.iter().find(|r| r.key == key) else {
            return 0;
        };
        let mut sum = 0i64;
        let mut total = 0i64;
        for (i, weight) in &r.weights {
            let Some(a) = self.defs.captain.attributes.get(*i) else {
                continue;
            };
            let multiplier = if self.defs.captain.group(*i).is_some_and(|g| g.key == "conduct") { 10 } else { 100 };
            sum = sum
                .saturating_add(self.upbringing_projected(&a.key).saturating_mul(multiplier).saturating_mul(*weight));
            total = total.saturating_add(*weight);
        }
        if total > 0 { sum / total } else { 0 }
    }
    /// 开局点三层叠加（U02）：年龄基线（按属性组）＋家境底子（`origin_points`）＋个人优势（`initial_points`）。
    /// 返回每项属性叠加后的开局点（刻度同 `initial_points`），运气与秘术恒为 0。
    pub fn upbringing_opening_points(&self, family: &super::FamilyDef) -> BTreeMap<String, i64> {
        opening_points(&self.defs, family)
    }
    pub(crate) fn init_upbringing_growth(&mut self) {
        let year = self.cast_date()[0];
        let points = self.upbringing_family().map(|f| self.upbringing_opening_points(f)).unwrap_or_default();
        // 已有自创档案的分配先扣掉创建页的组起点，只保留玩家自己分出的点数，再叠三层开局点；
        // 这样创建页的成年起点与十二岁的年龄基线不会重复计入。具名主角只用三层表。
        let allocated: Vec<i64> = self
            .state
            .protagonist
            .as_ref()
            .filter(|p| p.template.is_some())
            .and_then(|_| self.captain_profile(OwnerId::Player))
            .map(|p| {
                p.attrs
                    .iter()
                    .enumerate()
                    .map(|(i, v)| v.saturating_sub(self.defs.captain.group(i).map_or(0, |g| g.start)).max(0))
                    .collect()
            })
            .unwrap_or_default();
        let Some(s) = self.state.upbringing.as_mut() else {
            return;
        };
        if s.growth_year == 0 {
            s.growth_year = year;
        }
        for (i, a) in self.defs.captain.attributes.iter().enumerate() {
            let bonus = points.get(&a.key).copied().unwrap_or(0);
            // 档案分配按各组自己的刻度（品行是 0–100 的原值，其余是档位），不乘开局点的十倍。
            let own = allocated.get(i).copied().unwrap_or(0);
            let initial = if a.key == "fortune" {
                self.state.protagonist.as_ref().map_or(5, |p| 1 + i64::from((p.born[1] * 31 + p.born[2]) % 10))
            } else if self.defs.captain.group(i).is_some_and(|g| g.key == "conduct") {
                50i64.saturating_add(own).saturating_add(bonus.saturating_mul(10)).clamp(0, 100)
            } else {
                let value = 1i64.saturating_add(own).saturating_add(bonus).clamp(1, 10);
                self.defs.upbringing.rules.growth_table.iter().find(|b| b.value >= value).map_or(0, |b| b.from)
            };
            // 读旧档或阶段刷新只补缺项，不重发开局点，也不覆盖玩家已经取得的成长。
            s.growth.entry(a.key.clone()).or_insert(initial);
        }
    }
    /// 返回实际增加的值，负数品行不会返还本年度已使用的成长额度。
    pub fn gain_upbringing_growth(&mut self, key: &str, gain: i64) -> i64 {
        self.gain_upbringing_growth_with_cap_pct(key, gain, 100)
    }
    /// 仅行动制高档课允许多用年度额度；总成长上限仍为 1000。
    pub fn gain_upbringing_growth_with_cap_pct(&mut self, key: &str, gain: i64, cap_pct: i64) -> i64 {
        if !self.upbringing_active() {
            return 0;
        }
        let Some(i) = self.defs.captain.attribute_index(key) else {
            return 0;
        };
        if key == "fortune" || (key == "arcana" && !self.upbringing_flag(super::ARCANA_AWAKENED_FLAG)) {
            return 0;
        }
        let conduct = self.defs.captain.group(i).is_some_and(|g| g.key == "conduct");
        let year = self.cast_date()[0];
        let annual_cap = self.upbringing_annual_cap() * cap_pct / 100;
        let Some(s) = self.state.upbringing.as_mut() else {
            return 0;
        };
        if s.growth_year != year {
            s.growth_year = year;
            s.year_growth.clear();
        }
        let current = s.growth.entry(key.into()).or_insert(if conduct { 50 } else { 0 });
        let used = s.year_growth.entry(key.into()).or_default();
        let allowed = if gain > 0 { gain.min((annual_cap - *used).max(0)) } else { gain };
        let next = current.saturating_add(allowed).clamp(0, if conduct { 100 } else { 1000 });
        let actual = next - *current;
        *current = next;
        *used = used.saturating_add(actual.max(0));
        actual
    }
    /// 当前年龄的每年每项成长上限（U02 工作包 4）；没有按年龄的表时用 `annual_growth_cap`。
    pub fn upbringing_annual_cap(&self) -> i64 {
        let rules = &self.defs.upbringing.rules;
        let age = self.state.protagonist.as_ref().and_then(|p| p.age_on(self.cast_date())).map(i64::from);
        annual_cap_at(rules, age)
    }
    pub fn upbringing_skill_xp(&self, key: &str) -> i64 {
        self.inventory(OwnerId::Player).and_then(|i| i.skill_xp.get(key)).copied().unwrap_or(0)
    }
}

/// 开局点三层叠加的纯函数版本，供离线审计与成长曲线（`manifest_sim::upbringing_curve`）共用。
pub fn opening_points(defs: &crate::StaticData, family: &super::FamilyDef) -> BTreeMap<String, i64> {
    let baseline = &defs.upbringing.rules.age_baseline;
    defs.captain
        .attributes
        .iter()
        .enumerate()
        .map(|(i, a)| {
            let points = if a.key == "fortune" || a.key == "arcana" {
                0
            } else {
                let group = defs.captain.group(i).and_then(|g| baseline.get(&g.key)).copied().unwrap_or(0);
                [&family.origin_points, &family.initial_points]
                    .iter()
                    .fold(group, |sum, layer| sum.saturating_add(layer.get(&a.key).copied().unwrap_or(0)))
            };
            (a.key.clone(), points)
        })
        .collect()
}

/// 开局点换算成养成成长刻度：品行为 50 + 点数 × 10（0–100），其余按成长换算表取该档的下限。
pub fn opening_growth(defs: &crate::StaticData, family: &super::FamilyDef) -> BTreeMap<String, i64> {
    let table = &defs.upbringing.rules.growth_table;
    opening_points(defs, family)
        .into_iter()
        .map(|(key, points)| {
            let conduct = defs
                .captain
                .attribute_index(&key)
                .and_then(|i| defs.captain.group(i))
                .is_some_and(|g| g.key == "conduct");
            let value = if key == "fortune" || key == "arcana" {
                0
            } else if conduct {
                50i64.saturating_add(points.saturating_mul(10)).clamp(0, 100)
            } else {
                let level = 1i64.saturating_add(points).clamp(1, 10);
                table.iter().find(|b| b.value >= level).map_or(0, |b| b.from)
            };
            (key, value)
        })
        .collect()
}

/// 某个年龄的每年每项成长上限：取起始年龄不超过它的最后一档；比第一档还小时用第一档；表空或年龄未知时用固定上限。
pub fn annual_cap_at(rules: &super::UpbringingRules, age: Option<i64>) -> i64 {
    let table = &rules.annual_growth_cap_by_age;
    match (age, table.first()) {
        (Some(age), Some(first)) => table.iter().rev().find(|[from, _]| *from <= age).map_or(first[1], |e| e[1]),
        _ => rules.annual_growth_cap,
    }
}
