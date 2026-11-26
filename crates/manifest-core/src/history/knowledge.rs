//! 历史情报在到访时拍下快照；离开后不会随隐藏世界状态自动更新。
use super::*;
use crate::World;
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Observation {
    pub day: u32,
    pub exact: bool,
    pub balance: i64,
    pub values: BTreeMap<String, i64>,
}
impl World {
    pub fn history_event_known(&self, e: &EventDef) -> bool {
        e.knowledge.as_ref().is_none_or(|k| self.has_knowledge_record(k))
    }
    pub(crate) fn observe_history(&mut self) {
        if self.defs.history.is_empty() {
            return;
        }
        let here = self.presence(OwnerId::Player);
        let defs = self.defs.clone();
        for e in &defs.history.events {
            if !self.history_event_known(e)
                || self
                    .state
                    .history
                    .events
                    .get(&e.key)
                    .is_some_and(|s| s.closed || s.resolved_day.is_some_and(|d| d < self.day()))
                || !e.window.is_some_and(|v| v[0] <= self.cast_date() && self.cast_date() <= v[1])
                || !e
                    .sides
                    .iter()
                    .filter_map(|s| s.port.as_ref().and_then(|p| defs.find_loc(p)))
                    .any(|p| here.contains(&p))
            {
                continue;
            }
            let exact = self.state.arcana.divinations.get(&e.key) == Some(&self.day())
                || self.state.history.events.get(&e.key).is_some_and(|s| {
                    s.outcome.is_some()
                        || s.contributions.iter().any(|(key, c)| {
                            e.levers.iter().any(|l| l.key == *key && l.kind == LeverKind::Intel)
                                && c.diplomacy
                                    .get(&OwnerId::Player)
                                    .is_some_and(|a| a.truthful && !a.leaked && self.day().saturating_sub(a.day) <= 30)
                        })
                });
            let mut balance = e.base.unwrap_or(e.balance);
            if let Some(c) = &e.campaign {
                for v in &e.base_vars {
                    balance += v.weight * (self.campaign_value(c, &v.var).unwrap_or(50) - 50) / 10;
                }
            }
            let values: BTreeMap<_, _> =
                e.levers.iter().map(|l| (l.key.clone(), self.history_lever_points(&e.key, &l.key))).collect();
            for l in &e.levers {
                balance += values[&l.key] * if e.sides.first().is_some_and(|s| s.key == l.side) { 1 } else { -1 };
            }
            if let Some(counter) = &e.counter {
                let opposing: i64 = e.levers.iter().filter(|l| l.side != counter.side).map(|l| values[&l.key]).sum();
                balance += (opposing * counter.pct / 100).min(counter.max)
                    * if e.sides[0].key == counter.side { 1 } else { -1 };
            }
            self.state
                .history
                .known_events
                .insert(e.key.clone(), Observation { day: self.day(), exact, balance, values });
            if let Some(c) = e.campaign.as_ref().and_then(|key| defs.history.campaign(key)) {
                let values = c
                    .vars
                    .iter()
                    .map(|v| (v.key.clone(), self.campaign_value(&c.key, &v.key).unwrap_or(v.start)))
                    .collect();
                let day = self.day();
                if self.state.history.known_campaigns.get(&c.key).is_none_or(|o| o.day != day || !o.exact || exact) {
                    self.state
                        .history
                        .known_campaigns
                        .insert(c.key.clone(), Observation { day, exact, balance: 0, values });
                }
            }
        }
    }
}
pub(super) fn valid_snapshot(w: &World) -> bool {
    w.state.history.known_events.iter().all(|(key, o)| {
        w.defs.history.event(key).is_some_and(|e| {
            o.day <= w.day()
                && o.balance.abs_diff(0) <= 2_000_000
                && o.values.iter().all(|(k, v)| e.levers.iter().any(|l| &l.key == k && (0..=l.max_points).contains(v)))
        })
    }) && w.state.history.known_campaigns.iter().all(|(key, o)| {
        w.defs.history.campaign(key).is_some_and(|c| {
            o.day <= w.day()
                && o.values.iter().all(|(k, v)| c.vars.iter().any(|d| &d.key == k) && (0..=100).contains(v))
        })
    })
}
