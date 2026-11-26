//! 战役变量以史实轨迹加偏差保存；所有插值、回拉与结算都向零取整。
use super::{contribution::history_key, *};
use crate::{
    World,
    error::CommandError,
    rng::{Domain, Rng},
};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CampaignDef {
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub summary: String,
    pub vars: Vec<VariableDef>,
    pub inertia: i64,
    #[serde(default)]
    pub backlash: Vec<Backlash>,
    #[serde(default)]
    pub outlooks: Vec<Outlook>,
    pub ending_event: Option<String>,
    #[serde(default)]
    pub endings: Vec<Ending>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VariableDef {
    pub key: String,
    pub name: String,
    pub start: i64,
    pub idea: Option<String>,
    pub court: Option<String>,
    #[serde(default)]
    pub gates: Vec<Gate>,
    #[serde(default)]
    pub drift: Vec<(u32, i64)>,
}
impl VariableDef {
    pub fn baseline(&self, year: u32) -> i64 {
        let Some(first) = self.drift.first() else { return self.start };
        if year < first.0 {
            return self.start;
        }
        if year == first.0 {
            return first.1;
        }
        for pair in self.drift.windows(2) {
            let (a, b) = (pair[0], pair[1]);
            if year <= b.0 {
                return a.1 + (b.1 - a.1) * i64::from(year - a.0) / i64::from(b.0 - a.0);
            }
        }
        self.drift.last().map_or(self.start, |p| p.1)
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CampaignState {
    pub values: BTreeMap<String, i64>,
    pub year: u32,
    pub influenced: bool,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub outlooks: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "BTreeSet::is_empty")]
    pub endings: BTreeSet<String>,
    #[serde(skip_serializing_if = "BTreeSet::is_empty")]
    pub backlash: BTreeSet<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished: Option<u32>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub held_since: BTreeMap<String, u32>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BaseVar {
    pub var: String,
    pub weight: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Need {
    pub kinds: usize,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Counter {
    pub side: String,
    pub pct: i64,
    pub max: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Court {
    pub var: String,
    pub min: i64,
    pub fail: CourtFail,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CourtFail {
    Downgrade,
    Cancel,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VarChange {
    pub var: String,
    pub add: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Backfire {
    pub from_side: String,
    pub lever: LeverKind,
    pub var: String,
    pub pct: i64,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Resolution {
    pub base: i64,
    pub sides: BTreeMap<String, i64>,
    pub counter: i64,
    pub roll: i64,
    pub score: i64,
    pub kinds: usize,
    pub need_met: bool,
    pub court_passed: Option<bool>,
}

impl World {
    pub(super) fn init_campaigns(&mut self) {
        let year = self.cast_date()[0];
        for c in &self.defs.history.campaigns {
            let values = c
                .vars
                .iter()
                .map(|v| (v.key.clone(), v.baseline(year).min(self.campaign_cap(&c.key, &v.key).unwrap_or(100))))
                .collect();
            self.state.history.campaigns.entry(c.key.clone()).or_insert_with(|| CampaignState {
                values,
                year,
                influenced: false,
                ..CampaignState::default()
            });
        }
        self.refresh_campaign_holds();
    }
    pub fn campaign_value(&self, campaign: &str, var: &str) -> Option<i64> {
        let c = self.defs.history.campaign(campaign)?;
        let v = c.vars.iter().find(|v| v.key == var)?;
        let year = self.cast_date()[0];
        let cap = self.campaign_cap(campaign, var).unwrap_or(100);
        let Some(s) = self.state.history.campaigns.get(campaign) else { return Some(v.baseline(year).min(cap)) };
        let mut value = s.values.get(var).copied().unwrap_or_else(|| v.baseline(s.year));
        for y in s.year.saturating_add(1)..=year {
            let delta = value - v.baseline(y - 1);
            value = (v.baseline(y) + delta - delta * c.inertia / 100).clamp(0, 100);
        }
        Some(value.min(cap))
    }
    pub(super) fn campaign_year(&mut self) {
        let defs = self.defs.clone();
        let year = self.cast_date()[0];
        for c in &defs.history.campaigns {
            let values = c
                .vars
                .iter()
                .map(|v| (v.key.clone(), self.campaign_value(&c.key, &v.key).unwrap_or(v.start)))
                .collect();
            let state = self.state.history.campaigns.entry(c.key.clone()).or_default();
            state.values = values;
            state.year = year;
        }
        self.refresh_campaign_holds();
    }
    fn refresh_campaign_holds(&mut self) {
        let day = self.day();
        for ((campaign, key), (var, ge, le)) in conditions::held_tests(&self.defs) {
            // 午夜时下一年的漂移可能尚未结算；恢复快照不能提前改变持续记录。
            // campaign_year/change_campaign 写入变量值后会再刷新这里。
            let holds = self
                .state
                .history
                .campaigns
                .get(&campaign)
                .and_then(|s| s.values.get(&var))
                .is_some_and(|v| ge.is_none_or(|n| *v >= n) && le.is_none_or(|n| *v <= n));
            if let Some(state) = self.state.history.campaigns.get_mut(&campaign) {
                if holds {
                    state.held_since.entry(key).or_insert(day);
                } else {
                    state.held_since.remove(&key);
                }
            }
        }
    }
    pub(crate) fn change_campaign(&mut self, campaign: &str, var: &str, add: i64) -> Result<(), CommandError> {
        self.campaign_year();
        let cap = self.campaign_cap(campaign, var).unwrap_or(100);
        let value = self
            .state
            .history
            .campaigns
            .get_mut(campaign)
            .and_then(|s| s.values.get_mut(var))
            .ok_or_else(|| blocked("战役链变量不存在"))?;
        *value = value.saturating_add(add).clamp(0, cap);
        if add != 0
            && let Some(s) = self.state.history.campaigns.get_mut(campaign)
        {
            s.influenced = true;
        }
        self.refresh_campaign_holds();
        Ok(())
    }
    pub(super) fn campaign_credit(&mut self, before: &World, e: &EventDef) -> Result<(), CommandError> {
        let Some(c) = &e.campaign else { return Ok(()) };
        for l in &e.levers {
            if let Some(var) = &l.var {
                let delta = self.history_lever_points(&e.key, &l.key) - before.history_lever_points(&e.key, &l.key);
                self.change_campaign(c, var, delta * l.var_per_point)?;
            }
        }
        Ok(())
    }
    pub(super) fn campaign_outcome<'a>(&self, e: &'a EventDef) -> Result<(&'a OutcomeDef, Resolution), CommandError> {
        let default = e.default_outcome().ok_or_else(|| blocked("事件没有缺省结果"))?;
        let contributed = e.levers.iter().any(|l| self.history_lever_points(&e.key, &l.key) > 0);
        let influenced =
            e.campaign.as_ref().and_then(|key| self.state.history.campaigns.get(key)).is_some_and(|s| s.influenced);
        let mut r = Resolution { base: e.base.unwrap_or(e.balance), need_met: true, ..Resolution::default() };
        if let Some(c) = &e.campaign {
            for v in &e.base_vars {
                r.base += v.weight * (self.campaign_value(c, &v.var).unwrap_or(50) - 50) / 10;
            }
        }
        for side in &e.sides {
            r.sides.insert(
                side.key.clone(),
                e.levers.iter().filter(|l| l.side == side.key).map(|l| self.history_lever_points(&e.key, &l.key)).sum(),
            );
        }
        r.score = r.base + r.sides[&e.sides[0].key] - r.sides[&e.sides[1].key];
        // 条件终局也可能只由前置事件改写；没有变量增减不等于没有改变历史。
        if !e.outcome_rules.is_empty() {
            let chosen = e
                .outcome_rules
                .iter()
                .find(|rule| self.history_conditions(e, &rule.when))
                .and_then(|rule| e.outcomes.iter().find(|o| o.key == rule.outcome))
                .unwrap_or(default);
            return Ok((chosen, r));
        }
        if !contributed && !influenced {
            r.need_met = e.need.is_none();
            return Ok((default, r));
        }
        if let Some(counter) = &e.counter {
            let other: i64 = r.sides.iter().filter(|(key, _)| **key != counter.side).map(|(_, v)| v).sum();
            r.counter = (other * counter.pct / 100).min(counter.max);
            r.score += r.counter * if counter.side == e.sides[0].key { 1 } else { -1 };
        }
        let key = history_key(&e.key);
        r.roll = Rng::derive(self.state.seed, self.day(), Domain::History, key, 0).range(-e.roll, e.roll);
        r.score += r.roll;
        let mut ordered: Vec<_> = e.outcomes.iter().collect();
        ordered.sort_by_key(|o| score_range(&o.when).map(|p| p.0));
        let historical = ordered.iter().position(|o| o.default).ok_or_else(|| blocked("事件没有缺省结果"))?;
        let mut chosen = ordered
            .iter()
            .position(|o| score_range(&o.when).is_some_and(|(lo, hi)| lo <= r.score && r.score <= hi))
            .ok_or_else(|| blocked("事件结果区间无效"))?;
        let side = if chosen >= historical { &e.sides[0].key } else { &e.sides[1].key };
        r.kinds = e
            .levers
            .iter()
            .filter(|l| &l.side == side && self.history_lever_points(&e.key, &l.key) > 0)
            .map(|l| (l.kind, l.mode))
            .collect::<BTreeSet<_>>()
            .len();
        r.need_met = e.need.as_ref().is_none_or(|n| r.kinds >= n.kinds);
        if chosen != historical && !r.need_met {
            chosen = historical;
        }
        if chosen != historical
            && let Some((c, court)) = e.campaign.as_ref().zip(e.court.as_ref())
        {
            let value = self.campaign_value(c, &court.var).unwrap_or(0);
            let bonus: i64 = e
                .levers
                .iter()
                .filter(|l| &l.side == side && self.history_lever_points(&e.key, &l.key) > 0)
                .map(|l| l.court_bonus)
                .sum();
            let passed = value + bonus >= court.min
                && Rng::derive(self.state.seed, self.day(), Domain::History, key, 0x200)
                    .chance_bp((value + bonus).clamp(0, 100) * 100);
            r.court_passed = Some(passed);
            if !passed {
                chosen = match court.fail {
                    CourtFail::Cancel => historical,
                    CourtFail::Downgrade => {
                        if chosen > historical {
                            chosen - 1
                        } else {
                            chosen + 1
                        }
                    }
                };
            }
        }
        Ok((ordered[chosen], r))
    }
    pub(super) fn campaign_result(&mut self, e: &EventDef, o: &OutcomeDef) -> Result<(), CommandError> {
        let Some(c) = &e.campaign else { return Ok(()) };
        // drift 已含缺省历史的影响；非缺省分支只记相对史实的差值，避免双重记账。
        let mut changes = BTreeMap::<String, i64>::new();
        for v in &o.vars {
            *changes.entry(v.var.clone()).or_default() += v.add;
        }
        if let Some(default) = e.default_outcome() {
            for v in &default.vars {
                *changes.entry(v.var.clone()).or_default() -= v.add;
            }
        }
        for b in &o.backfire {
            let points: i64 = e
                .levers
                .iter()
                .filter(|l| l.side == b.from_side && l.kind == b.lever)
                .map(|l| self.history_lever_points(&e.key, &l.key))
                .sum();
            *changes.entry(b.var.clone()).or_default() += points * b.pct / 100;
        }
        for (var, add) in changes {
            self.change_campaign(c, &var, add)?;
        }
        Ok(())
    }
}

pub(super) fn validate(d: &crate::StaticData) -> Vec<String> {
    let mut errors = Vec::new();
    let mut keys = BTreeSet::new();
    for c in &d.history.campaigns {
        let mut vars = BTreeSet::new();
        if c.key.is_empty()
            || !keys.insert(&c.key)
            || c.name.trim().is_empty()
            || !(0..=100).contains(&c.inertia)
            || c.vars.is_empty()
            || c.vars.len() > 64
            || !c.vars.iter().all(|v| {
                !v.key.is_empty()
                    && vars.insert(&v.key)
                    && !v.name.trim().is_empty()
                    && (0..=100).contains(&v.start)
                    && v.drift.iter().all(|(year, value)| (1..=9999).contains(year) && (0..=100).contains(value))
                    && v.drift.windows(2).all(|p| p[0].0 < p[1].0)
            })
        {
            errors.push(format!("{}：战役变量、轨迹或惯性无效", c.key));
        }
    }
    for e in &d.history.events {
        let c = e.campaign.as_ref().and_then(|c| d.history.campaign(c));
        let var = |key: &str| c.is_some_and(|c| c.vars.iter().any(|v| v.key == key));
        if e.campaign.is_some() != c.is_some()
            || e.base.is_some_and(|v| v.abs_diff(0) > 100_000)
            || e.base_vars.len() > 64
            || !e.base_vars.iter().all(|v| var(&v.var) && v.weight.abs_diff(0) <= 100)
            || e.need.as_ref().is_some_and(|n| n.kinds > 15 || n.kinds == 0)
            || e.counter.as_ref().is_some_and(|v| {
                !e.sides.iter().any(|s| s.key == v.side)
                    || !(0..=100).contains(&v.pct)
                    || !(0..=10_000).contains(&v.max)
            })
            || e.court.as_ref().is_some_and(|v| !var(&v.var) || !(0..=100).contains(&v.min))
            || !e.levers.iter().all(|l| {
                l.var.as_ref().is_none_or(|v| var(v))
                    && l.var_per_point.abs_diff(0) <= 100
                    && (0..=100).contains(&l.court_bonus)
                    && (l.court_bonus == 0 || matches!(l.kind, LeverKind::Bribe | LeverKind::Negotiate))
            })
            || !e.outcomes.iter().all(|o| {
                o.vars.len() <= 64
                    && o.backfire.len() <= 64
                    && o.vars.iter().all(|v| var(&v.var) && v.add.abs_diff(0) <= 100)
                    && o.backfire.iter().all(|b| {
                        var(&b.var) && e.sides.iter().any(|s| s.key == b.from_side) && (0..=100).contains(&b.pct)
                    })
            })
        {
            errors.push(format!("{}：战役结算引用或边界无效", e.key));
        }
    }
    errors
}
pub(super) fn valid_snapshot(w: &World) -> bool {
    let held = conditions::held_tests(&w.defs);
    w.state.history.campaigns.iter().all(|(key, s)| {
        w.defs.history.campaign(key).is_some_and(|c| {
            s.year > 0
                && s.year <= w.cast_date()[0]
                && s.values.len() == c.vars.len()
                && s.values.iter().all(|(key, v)| (0..=100).contains(v) && c.vars.iter().any(|d| d.key == *key))
                && s.held_since.iter().all(|(test, start)| {
                    *start <= w.day()
                        && held.get(&(key.clone(), test.clone())).is_some_and(|(var, ge, le)| {
                            s.values.get(var).is_some_and(|v| ge.is_none_or(|n| *v >= n) && le.is_none_or(|n| *v <= n))
                        })
                })
        })
    }) && w.state.history.events.iter().all(|(key, s)| {
        s.resolution.as_ref().is_none_or(|r| {
            w.defs.history.event(key).is_some_and(|e| {
                s.outcome.is_some()
                    && s.balance == r.score
                    && r.sides.len() == e.sides.len()
                    && e.sides.iter().all(|side| r.sides.get(&side.key).is_some_and(|v| (0..=1_280_000).contains(v)))
                    && r.base.abs_diff(0) <= 132_000
                    && r.score.abs_diff(0) <= 2_000_000
                    && r.roll.abs_diff(0) <= e.roll as u64
                    && (0..=e.counter.as_ref().map_or(0, |c| c.max)).contains(&r.counter)
                    && r.kinds <= 15
                    && (r.court_passed.is_none() || e.court.is_some())
            })
        })
    })
}
