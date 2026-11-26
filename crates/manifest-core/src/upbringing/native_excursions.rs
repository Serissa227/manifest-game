//! 原生远足保留三次推进与解开后的短结算；材料门槛不隐式消耗工具。
use super::*;
use crate::{CommandError, CoreError, OwnerId, World};
impl World {
    pub fn excursion_available(&self, e: &ExcursionDef) -> bool {
        let Some(stage) = self.upbringing_stage_on(self.cast_date()) else { return false };
        let Some(loc) = self.upbringing_location().map(|i| self.defs.loc(i)) else { return false };
        if !e.at.is_empty() {
            return e.at == loc.key;
        }
        if !e.place.stage.allows(stage.stage) {
            return false;
        }
        if e.place.bind.as_deref() == Some("family_home") && self.upbringing_family().is_none_or(|f| f.home != loc.key)
        {
            return false;
        }
        let academy = stage.academy.as_deref();
        if e.place.bind.as_deref() == Some("enrolled_academy")
            && (stage.stage != Stage::Academy || self.upbringing_academy().is_none_or(|a| a.at != loc.key))
        {
            return false;
        }
        let culture = self.upbringing_academy().map_or(loc.culture.as_str(), |a| a.culture.as_str());
        (e.place.cultures.is_empty() || e.place.cultures.iter().any(|c| self.upbringing_culture_matches(c, culture)))
            && (stage.stage == Stage::Home
                || e.place.academies.is_empty()
                || academy.is_some_and(|a| e.place.academies.iter().any(|k| k == a)))
    }
    pub(crate) fn native_excursion_open(&self, e: &ExcursionDef, n: &ExcursionNode) -> Result<(), CommandError> {
        let blocked = |s: &str| CommandError::Precondition(s.into());
        let date = self.cast_date();
        if !self.excursion_available(e)
            || !self.upbringing_unlock(&n.unlock, date)
            || n.age.is_some_and(|r| {
                !self
                    .state
                    .protagonist
                    .as_ref()
                    .and_then(|p| p.age_on(date))
                    .is_some_and(|age| r[0] <= age && age <= r[1])
            })
        {
            return Err(blocked("尚未满足远足条件"));
        }
        if self.excursion_node_state(&e.key, &n.key) == NodeState::Solved {
            let last = self
                .state
                .upbringing
                .as_ref()
                .and_then(|s| s.excursion_progress.get(&e.key))
                .and_then(|s| s.get(&n.key))
                .and_then(|p| p.last_day);
            if n.repeat.as_ref().is_none_or(|r| last.is_none_or(|day| self.day().saturating_sub(day) < r.cooldown_days))
            {
                return Err(blocked("远足尚未冷却"));
            }
        }
        Ok(())
    }
    fn excursion_requirement(&self, r: &ExcursionRequirement, companion: Option<&str>) -> bool {
        (r.any.is_empty() || r.any.iter().any(|c| self.excursion_requirement(c, companion)))
            && r.item.as_deref().is_none_or(|i| self.item_quantity(OwnerId::Player, i) >= r.qty)
            && r.attr.as_deref().is_none_or(|a| self.upbringing_projected(a) >= r.min)
            && r.skill.as_deref().is_none_or(|s| self.upbringing_skill_level(s) >= r.level)
            && r.companion_skill.as_ref().is_none_or(|skill| {
                companion.is_some_and(|person| {
                    self.upbringing_companion_present(person, None, self.cast_date())
                        && self.upbringing_helper_level(person, skill) >= r.level.max(1)
                })
            })
    }
    pub(crate) fn settle_native_excursion(
        &mut self,
        key: &str,
        n: &ExcursionNode,
        c: &AfterChoice,
        index: u8,
        result: &mut SlotResult,
    ) -> Result<Vec<String>, CoreError> {
        let progress = self
            .state
            .upbringing
            .as_ref()
            .and_then(|s| s.excursion_progress.get(key))
            .and_then(|s| s.get(&n.key))
            .cloned()
            .unwrap_or_default();
        let solved = self.excursion_node_state(key, &n.key) == NodeState::Solved;
        let step = if solved { None } else { n.steps.get(usize::from(progress.step)) };
        if !solved && step.is_none() {
            return Err(CoreError::Internal("远足步骤不存在".into()));
        }
        if step.is_some_and(|s| !self.excursion_requirement(&s.unlock, c.companion.as_deref())) {
            result.success = Some(false);
            result.line = n.hint.clone();
            return Ok(Vec::new());
        }
        let mut rng = self.upbringing_rng(&format!("excursion:{key}:{}", n.key), index, 1);
        let chance = n
            .risk
            .as_ref()
            .map_or(100, |r| (r.check.base + self.upbringing_projected(&r.check.attr) * r.check.per).clamp(5, 95));
        if !rng.chance_bp(chance * 100) {
            result.success = Some(false);
            if let (Some(r), Some(s)) = (&n.risk, &mut self.state.upbringing) {
                let before = (s.fatigue, s.mood);
                s.fatigue = (s.fatigue + r.failure.fatigue).clamp(0, 100);
                s.mood = (s.mood + r.failure.mood).clamp(-100, 100);
                s.stamina = 100 - s.fatigue;
                result.fatigue += s.fatigue - before.0;
                result.mood += s.mood - before.1;
            }
            return Ok(Vec::new());
        }
        let gains = step.map(|s| &s.gains).or_else(|| n.repeat.as_ref().map(|r| &r.gains));
        if let Some(gains) = gains {
            for (attr, [lo, hi]) in gains {
                *result.growth.entry(attr.clone()).or_default() +=
                    self.gain_upbringing_growth(attr, rng.range(*lo, *hi));
            }
        }
        if let Some(step) = step {
            for skill in &step.skills {
                let xp = self
                    .state
                    .items
                    .owners
                    .entry(OwnerId::Player)
                    .or_default()
                    .skill_xp
                    .entry(skill.skill.clone())
                    .or_default();
                *xp = xp.saturating_add(skill.xp);
                *result.skills.entry(skill.skill.clone()).or_default() += skill.xp;
            }
            for i in &step.items {
                self.grant_item(OwnerId::Player, &i.item, i.qty).map_err(|e| CoreError::Internal(e.to_string()))?;
                *result.items.entry(i.item.clone()).or_default() += i.qty;
            }
            if let Some(memory) = &step.memory {
                self.state.story2.memories.insert(memory.clone(), step.name.clone());
                let day = self.day();
                if let Some(s) = &mut self.state.upbringing {
                    s.memory_days.insert(memory.clone(), day);
                }
            }
            result.line = Some(step.text.clone());
        }
        let day = self.day();
        if let Some(s) = &mut self.state.upbringing {
            let step_number = if solved { progress.step } else { progress.step.saturating_add(1) };
            s.excursion_progress
                .entry(key.into())
                .or_default()
                .insert(n.key.clone(), ExcursionProgress { step: step_number, last_day: Some(day) });
            s.excursion_nodes.entry(key.into()).or_default().insert(
                n.key.clone(),
                if solved || usize::from(step_number) == n.steps.len() { NodeState::Solved } else { NodeState::Seen },
            );
            s.fame = (s.fame + step.map_or_else(|| n.repeat.as_ref().map_or(0, |r| r.fame), |s| s.fame)).clamp(0, 100);
        }
        Ok(if solved { Vec::new() } else { n.events.clone() })
    }
}
