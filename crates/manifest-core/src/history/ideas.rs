//! 思想门槛、一次性反弹与战役结局；所有世界效果沿用已校验的封闭词表。
use super::*;
use crate::{StaticData, World, error::CommandError};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Gate {
    pub event: String,
    pub outcome: String,
    pub cap: i64,
    pub from: Option<WorldDate>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VarTest {
    pub var: String,
    pub ge: Option<i64>,
    pub lt: Option<i64>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Backlash {
    pub when: Vec<VarTest>,
    pub event: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Outlook {
    pub key: String,
    pub name: String,
    pub historical: String,
    pub threshold: i64,
    /// 变量 key，先列出的同分者优先。
    pub priority: Vec<String>,
    /// 最后一场战事的哪些结果中此宫廷仍存在；空表表示全部。
    #[serde(default)]
    pub survives: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ending {
    pub key: String,
    pub outcome: String,
    pub court: String,
    pub outlook: String,
    pub text: String,
    #[serde(default)]
    pub effects: Vec<Effect>,
}

impl World {
    pub fn campaign_cap(&self, campaign: &str, var: &str) -> Option<i64> {
        self.campaign_cap_on(campaign, var, self.cast_date())
    }
    fn campaign_cap_on(&self, campaign: &str, var: &str, date: WorldDate) -> Option<i64> {
        let v = self.defs.history.campaign(campaign)?.vars.iter().find(|v| v.key == var)?;
        v.gates
            .iter()
            .filter(|g| g.from.is_none_or(|from| from <= date) && self.history_outcome(&g.event) != Some(&g.outcome))
            .map(|g| g.cap)
            .min()
    }
    pub fn campaign_outlook(&self, campaign: &str, court: &str) -> Option<String> {
        let c = self.defs.history.campaign(campaign)?;
        let o = c.outlooks.iter().find(|o| o.key == court)?;
        if let Some(s) = self.state.history.campaigns.get(campaign)
            && let Some(outlook) = s.outlooks.get(court)
        {
            return Some(outlook.clone());
        }
        let outcome = c.ending_event.as_ref().and_then(|e| self.history_outcome(e));
        if outcome.is_some_and(|r| !o.survives.is_empty() && !o.survives.iter().any(|s| s == r)) {
            return None;
        }
        if self.state.history.campaigns.get(campaign).is_none_or(|s| !s.influenced) {
            return Some(o.historical.clone());
        }
        let mut chosen = (&o.historical, -1);
        for key in &o.priority {
            let v = c.vars.iter().find(|v| &v.key == key)?;
            let value = self.campaign_value(campaign, key)?;
            if value >= o.threshold
                && value > chosen.1
                && self.campaign_cap(campaign, key).is_none()
                && let Some(idea) = &v.idea
            {
                chosen = (idea, value);
            }
        }
        Some(chosen.0.clone())
    }
    pub(crate) fn history_ideas_changed(&mut self) {
        if !self.state.history.enabled {
            return;
        }
        self.campaign_year();
        let defs = self.defs.clone();
        for c in &defs.history.campaigns {
            for b in &c.backlash {
                if b.when.iter().all(|p| {
                    self.campaign_value(&c.key, &p.var)
                        .is_some_and(|v| p.ge.is_none_or(|n| v >= n) && p.lt.is_none_or(|n| v < n))
                }) {
                    let Some(e) = defs.history.event(&b.event) else { continue };
                    if self.cast_date() > e.deadline() || e.window.is_some_and(|w| self.cast_date() < w[0]) {
                        continue;
                    }
                    let state = self.state.history.events.entry(b.event.clone()).or_default();
                    if !state.closed && state.outcome.is_none() {
                        state.unlocked = true;
                        state.forced = true;
                        self.state.history.campaigns.entry(c.key.clone()).or_default().backlash.insert(b.event.clone());
                    }
                }
            }
        }
    }
    pub(super) fn finish_campaigns(&mut self) -> Result<(), CommandError> {
        let defs = self.defs.clone();
        for c in &defs.history.campaigns {
            let Some(event) = c.ending_event.as_ref() else { continue };
            let Some(result) = self.history_outcome(event).map(str::to_owned) else { continue };
            if self.state.history.campaigns.get(&c.key).is_some_and(|s| s.finished.is_some()) {
                continue;
            }
            let mut outlooks = BTreeMap::new();
            let mut endings = BTreeSet::new();
            for court in &c.outlooks {
                let Some(outlook) = self.campaign_outlook(&c.key, &court.key) else { continue };
                let ending = c
                    .endings
                    .iter()
                    .find(|e| e.outcome == result && e.court == court.key && e.outlook == outlook)
                    .ok_or_else(|| blocked("结局矩阵缺少胜负与走向组合"))?;
                for effect in &ending.effects {
                    self.apply_history_effect(effect)?;
                }
                outlooks.insert(court.key.clone(), outlook);
                endings.insert(ending.key.clone());
            }
            let day = self.day();
            let state = self.state.history.campaigns.entry(c.key.clone()).or_default();
            state.outlooks = outlooks;
            state.endings = endings;
            state.finished = Some(day);
        }
        Ok(())
    }
}

pub(super) fn validate(d: &StaticData) -> Vec<String> {
    let mut errors = Vec::new();
    for c in &d.history.campaigns {
        let bad = || format!("{}：思想门槛、反弹或结局矩阵无效", c.key);
        for v in &c.vars {
            if v.idea.is_some() != v.court.is_some()
                || v.idea.as_ref().is_some_and(|i| d.ideas.idea(i).is_none())
                || v.court.as_ref().is_some_and(|court| !c.outlooks.iter().any(|o| &o.key == court))
                || !v.gates.is_empty() && v.idea.is_none()
                || v.gates.iter().any(|g| {
                    !(0..=100).contains(&g.cap)
                        || g.from.is_some_and(|from| crate::scenario::day_of(d, from).is_err())
                        || d.history.event(&g.event).is_none_or(|e| !e.outcomes.iter().any(|o| o.key == g.outcome))
                })
            {
                errors.push(bad());
            }
        }
        let mut backlash = BTreeSet::new();
        for b in &c.backlash {
            if !backlash.insert(&b.event)
                || b.when.is_empty()
                || d.history.event(&b.event).is_none_or(|e| !e.locked)
                || b.when.iter().any(|p| {
                    !c.vars.iter().any(|v| v.key == p.var)
                        || p.ge.is_none() && p.lt.is_none()
                        || p.ge.is_some_and(|v| !(0..=100).contains(&v))
                        || p.lt.is_some_and(|v| !(1..=101).contains(&v))
                        || p.ge.zip(p.lt).is_some_and(|(a, b)| a >= b)
                })
            {
                errors.push(bad());
            }
        }
        if c.outlooks.is_empty() && c.endings.is_empty() && c.ending_event.is_none() {
            continue;
        }
        let Some(event) = c.ending_event.as_ref().and_then(|e| d.history.event(e)) else {
            errors.push(bad());
            continue;
        };
        if event.campaign.as_ref() != Some(&c.key) {
            errors.push(bad());
        }
        let mut courts = BTreeSet::new();
        let mut endings = BTreeSet::new();
        for o in &c.outlooks {
            let possible = |r: &str| o.survives.is_empty() || o.survives.iter().any(|s| s == r);
            if o.key.is_empty()
                || o.name.is_empty()
                || !courts.insert(&o.key)
                || o.historical.is_empty()
                || !(1..=100).contains(&o.threshold)
                || o.priority.is_empty()
                || o.priority.iter().collect::<BTreeSet<_>>().len() != o.priority.len()
                || o.priority.iter().any(|k| {
                    !c.vars.iter().any(|v| &v.key == k && v.court.as_ref() == Some(&o.key) && v.idea.is_some())
                })
                || o.survives.iter().any(|r| !event.outcomes.iter().any(|e| &e.key == r))
            {
                errors.push(bad());
            }
            let ideas: BTreeSet<_> = std::iter::once(o.historical.as_str())
                .chain(
                    o.priority
                        .iter()
                        .filter_map(|k| c.vars.iter().find(|v| &v.key == k).and_then(|v| v.idea.as_deref())),
                )
                .collect();
            for r in event.outcomes.iter().filter(|r| possible(&r.key)) {
                for idea in &ideas {
                    if c.endings.iter().filter(|e| e.outcome == r.key && e.court == o.key && e.outlook == *idea).count()
                        != 1
                    {
                        errors.push(bad());
                    }
                }
            }
        }
        for e in &c.endings {
            if e.key.is_empty()
                || !endings.insert(&e.key)
                || e.text.trim().is_empty()
                || !event.outcomes.iter().any(|o| o.key == e.outcome)
                || !c.outlooks.iter().any(|o| {
                    o.key == e.court
                        && (o.survives.is_empty() || o.survives.contains(&e.outcome))
                        && (o.historical == e.outlook
                            || c.vars
                                .iter()
                                .any(|v| o.priority.contains(&v.key) && v.idea.as_ref() == Some(&e.outlook)))
                })
                || e.effects.iter().any(|e| validation::effect_error(d, e).is_some())
            {
                errors.push(bad());
            }
        }
        // 缺省路径经过的门必须容得下史实轨迹，否则内容本身自相矛盾。
        for v in &c.vars {
            for g in &v.gates {
                let Some(e) = d.history.event(&g.event) else { continue };
                let start = g.from.map_or(d.rules.world.start_year.max(1) as u32, |from| from[0]);
                let last = if e.history.outcome == g.outcome { e.deadline()[0] } else { u32::MAX };
                if g.from.is_some_and(|from| e.history.outcome == g.outcome && e.deadline() < from) {
                    continue;
                }
                if v.baseline(start) > g.cap
                    || last != u32::MAX && v.baseline(last) > g.cap
                    || v.drift.iter().any(|(year, value)| *year >= start && *year <= last && *value > g.cap)
                {
                    errors.push(bad());
                }
            }
        }
    }
    errors
}

pub(super) fn valid_snapshot(w: &World) -> bool {
    // end_day 的日期已进入次日，而存储的变量仍是刚结束那天的值。
    let as_of = w.defs.calendar.date_of(w.state.history.last_day.unwrap_or(w.day()));
    let as_of = [(w.defs.rules.world.start_year + i64::from(as_of.year) - 1) as u32, as_of.month, as_of.day];
    w.state.history.campaigns.iter().all(|(key, s)| {
        let Some(c) = w.defs.history.campaign(key) else { return false };
        s.values.iter().all(|(v, value)| *value <= w.campaign_cap_on(key, v, as_of).unwrap_or(100))
            && s.backlash.iter().all(|key| {
                c.backlash.iter().any(|b| &b.event == key)
                    && w.state.history.events.get(key).is_some_and(|e| e.unlocked && e.forced)
            })
            && s.finished.is_none_or(|day| {
                day <= w.day() && c.ending_event.as_ref().and_then(|e| w.history_outcome(e)).is_some()
            })
            && (s.finished.is_some() || s.outlooks.is_empty() && s.endings.is_empty())
            && (s.finished.is_none() || {
                let result = c.ending_event.as_ref().and_then(|e| w.history_outcome(e));
                let count = c
                    .outlooks
                    .iter()
                    .filter(|o| o.survives.is_empty() || result.is_some_and(|r| o.survives.iter().any(|v| v == r)))
                    .count();
                s.outlooks.len() == count && s.endings.len() == count
            })
            && s.outlooks.iter().all(|(key, value)| {
                c.outlooks.iter().any(|o| {
                    &o.key == key
                        && (o.historical == *value
                            || c.vars.iter().any(|v| o.priority.contains(&v.key) && v.idea.as_ref() == Some(value)))
                })
            })
            && s.endings.iter().all(|key| {
                c.endings.iter().any(|e| {
                    &e.key == key
                        && s.outlooks.get(&e.court) == Some(&e.outlook)
                        && c.ending_event.as_ref().and_then(|k| w.history_outcome(k)) == Some(&e.outcome)
                })
            })
    }) && w.state.history.events.iter().all(|(key, s)| {
        !s.forced
            || w.defs.history.campaigns.iter().any(|c| {
                c.backlash.iter().any(|b| &b.event == key)
                    && w.state.history.campaigns.get(&c.key).is_some_and(|s| s.backlash.contains(key))
            })
    })
}
