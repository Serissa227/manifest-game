//! 短事件在旬预算前检查作者门槛；已结束的可重复轨道只在冷却后重新入队。
use super::EventGate;
use crate::{World, cast::relations::Bond, scenario::WorldDate};
impl World {
    /// 门槛里只随日期变的那几条：阶段、月份、年份、起始日，以及出场人物的年龄与是否在场。
    /// [`World::upbringing_event_gate`] 用今天的日期查；节奏的闸（`pacing`）用明天的日期预看——
    /// 明天就不成立的事今天是它的最后一天，不能按下。
    pub(crate) fn upbringing_event_gate_dated(&self, g: &EventGate, date: WorldDate) -> bool {
        self.upbringing_stage_on(date).is_some_and(|s| g.stage.allows(s.stage))
            && g.months.as_ref().is_none_or(|months| months.contains(&date[1]))
            && (g.years.is_empty() || g.years.contains(&date[0]))
            && g.from.is_none_or(|d| date >= d)
            && g.actors.iter().all(|p| {
                g.actors_age.is_none_or(|r| {
                    self.defs.cast.person(p).and_then(|p| p.age_on(date)).is_some_and(|a| r[0] <= a && a <= r[1])
                })
            })
            && (!g.actors_present || g.actors.iter().all(|p| self.upbringing_companion_present(p, None, date)))
    }

    pub(crate) fn upbringing_event_gate(&self, key: &str) -> bool {
        let frozen = self.upbringing_cadence_enabled()
            && self.state.upbringing.as_ref().is_some_and(|s| s.cadence.deferred.contains_key(key));
        self.upbringing_event_gate_with_result(key, None, frozen)
    }
    pub(crate) fn upbringing_event_gate_with_result(
        &self,
        key: &str,
        result: Option<&super::SlotResult>,
        frozen: bool,
    ) -> bool {
        let Some(g) = self.defs.upbringing.event_gates.get(key) else { return true };
        if !self.upbringing_active() || self.upbringing_skipping() {
            return false;
        }
        if !self.upbringing_event_gate_dated(g, self.cast_date())
            || g.academy.as_ref().is_some_and(|k| self.upbringing_academy().is_none_or(|a| &a.key != k))
            || g.not_flag.as_deref().is_some_and(|f| self.upbringing_flag(f))
            || g.actors.iter().any(|p| !self.person_alive(p))
        {
            return false;
        }
        if g.no_promise_with_protagonist.iter().any(|p| self.affection(p).is_some_and(|a| a.bond == Some(Bond::S))) {
            return false;
        }
        if g.mutual_orientation
            && (g.actors.len() != 2
                || self
                    .validate_tie_romance(&g.actors[0], &g.actors[1], crate::cast::relations::RomanceAction::Heart)
                    .is_err())
        {
            return false;
        }
        if g.letter_received || g.remote_cast || g.mail_route.is_some() {
            let known = self.state.story2.news.values().any(|n| {
                n.known
                    && n.kind == crate::story2::NewsKind::Letter
                    && g.mail_route.as_ref().is_none_or(|route| &n.track == route)
                    && g.actors.iter().all(|p| n.persons.contains(p))
            });
            if !known {
                return false;
            }
        }
        if let Some(festival) = &g.festival {
            let [lo, hi] = g.festival_window_days.unwrap_or([0, 0]);
            let active = self.defs.upbringing.festivals.iter().find(|f| &f.key == festival).is_some_and(|f| {
                f.dates.iter().any(|d| {
                    crate::scenario::day_of(&self.defs, *d).is_ok_and(|day| {
                        let delta = i64::from(self.day()) - i64::from(day);
                        lo <= delta && delta <= hi
                    })
                })
            });
            if !active {
                return false;
            }
        }
        if !frozen && let Some(activity) = &g.activity {
            // 按旬：刚结算的那一旬；按周（U05）：上一个排期日之前那一旬里结算的各格。
            let recent = result.map(|r| vec![r]).unwrap_or_else(|| self.upbringing_recent_results());
            if !recent.iter().any(|r| {
                r.activities.iter().any(|k| {
                    k == activity
                        || self.defs.upbringing.activity(k).is_some_and(|a| a.counts_as.as_ref() == Some(activity))
                }) && g.check_result.as_deref().is_none_or(|wanted| r.success == Some(wanted == "success"))
            }) {
                return false;
            }
        }
        true
    }
}
