//! 跳过只免去月程交互：仍逐日推进，经济调度服从世界规则，到期才兑现缺省成长。
use super::{ExamState, Phase};
use crate::{CommandError, OwnerId, World, world::WorldState};
impl World {
    pub fn upbringing_skipping(&self) -> bool {
        self.upbringing_active() && self.state.upbringing.as_ref().is_some_and(|s| s.skipping)
    }
    pub(crate) fn check_skip_upbringing(&self, owner: OwnerId) -> Result<Box<WorldState>, CommandError> {
        if owner != OwnerId::Player {
            return Err(CommandError::NotOwner);
        }
        if !self.upbringing_active() || self.upbringing_skipping() {
            return Err(CommandError::Precondition("当前不能跳过养成".into()));
        }
        let mut trial = self.clone();
        trial.return_training_fleet();
        if let Some(s) = &mut trial.state.upbringing {
            s.skipping = true;
            if s.phase != Phase::Graduation {
                s.phase = Phase::Running;
            }
            s.plan.clear();
            s.reading_slot = None;
            s.event_day = None;
            s.event_permits.clear();
            s.event_backlog.clear();
        }
        trial.finish_upbringing().map_err(|e| CommandError::Precondition(e.to_string()))?;
        Ok(Box::new(trial.state))
    }
    pub(crate) fn apply_skipped_growth(&mut self) -> Result<(), CommandError> {
        if !self.upbringing_skipping() {
            return Ok(());
        }
        let defaults = self
            .upbringing_family()
            .and_then(|f| f.completion.as_ref())
            .map(|c| c.defaults.clone())
            .unwrap_or_default();
        let day = self.day();
        let conduct = |key: &str| {
            self.defs
                .captain
                .attribute_index(key)
                .and_then(|i| self.defs.captain.group(i))
                .is_some_and(|g| g.key == "conduct")
        };
        let caps: std::collections::BTreeMap<String, i64> =
            defaults.growth.keys().map(|k| (k.clone(), if conduct(k) { 100 } else { 1000 })).collect();
        if let Some(s) = &mut self.state.upbringing {
            for (key, value) in &defaults.growth {
                // 已玩过的成长不被抹掉；出生运势不受跳过开关改变。
                if key == "fortune" {
                    continue;
                }
                let current = s.growth.entry(key.clone()).or_default();
                *current = (*current).max((*value).clamp(0, caps.get(key).copied().unwrap_or(1000)));
            }
            if s.path.is_none() {
                s.path = defaults.path;
            }
            s.flags.extend(defaults.flags.iter().cloned());
        }
        self.state.cast.flags.extend(defaults.flags.iter().cloned());
        self.state.story2.flags.extend(defaults.flags);
        for (key, xp) in defaults.skills {
            let current = self.state.items.owners.entry(OwnerId::Player).or_default().skill_xp.entry(key).or_default();
            *current = (*current).max(xp);
        }
        for (person, affinity) in defaults.affinity {
            let state = self.state.cast.persons.entry(person).or_default();
            state.met = true;
            state.affection.affinity = state.affection.affinity.max(affinity);
            state.affection.experiences = state.affection.experiences.max(if affinity >= 80 {
                3
            } else if affinity >= 50 {
                2
            } else if affinity >= 20 {
                1
            } else {
                0
            });
            Self::refresh_bond(&mut state.affection);
        }
        if self.state.cast.promise.is_none()
            && let Some(person) = defaults.promise
        {
            // 缺省约定只是候选；死亡、既有约定或不足的羁绊不能被跳过开关覆盖。
            let _ = self.promise_to(&person);
        }
        for key in defaults.exams {
            if self.state.upbringing.as_ref().and_then(|s| s.exams.get(&key)).is_some_and(|e| e.passed) {
                continue;
            }
            let Some(exam) = self.defs.upbringing.exams.iter().find(|e| e.key == key).cloned() else { continue };
            self.apply_upbringing_award(&exam.award)?;
            self.upbringing_recommendation(&exam)?;
            if let Some(s) = &mut self.state.upbringing {
                let record = s.exams.entry(key).or_insert_with(|| ExamState {
                    attempts: 1,
                    last_day: Some(day),
                    passed: false,
                    remediation: Default::default(),
                });
                record.passed = true;
            }
        }
        Ok(())
    }
}
