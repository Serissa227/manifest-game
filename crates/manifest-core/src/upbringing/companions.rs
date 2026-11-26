//! 同行按当日场所、喜好和好感接受；每月最多发出两次邀请，推辞也占次数。
use super::*;
use crate::{
    CommandError, CoreError, World,
    cast::{CastPlace, relations::RomanceAction},
};
impl World {
    pub fn upbringing_academy(&self) -> Option<&AcademyDef> {
        self.upbringing_stage_on(self.cast_date())?.academy.as_ref().and_then(|k| self.defs.upbringing.academy(k))
    }
    pub fn upbringing_places(&self) -> &[PlaceDef] {
        self.upbringing_academy()
            .map(|a| a.places.as_slice())
            .or_else(|| self.upbringing_family().map(|f| f.places.as_slice()))
            .unwrap_or(&[])
    }
    pub fn upbringing_companions(&self) -> BTreeMap<String, CompanionRole> {
        let mut people = self.upbringing_family().map(|f| f.companions.clone()).unwrap_or_default();
        if let Some(a) = self.upbringing_academy() {
            people.extend(a.companions.clone());
        }
        people.retain(|key, _| self.state.cast.persons.get(key).is_some_and(|p| p.met) && self.person_alive(key));
        people
    }
    pub fn upbringing_person_on(&self, key: &str, date: WorldDate) -> Option<CastPlace> {
        if !self.person_alive(key) {
            return None;
        }
        let p = self.defs.cast.person(key)?;
        let day = crate::scenario::day_of(&self.defs, date).ok()?;
        let schedule = crate::cast::schedule::schedule_on(
            p,
            self.state.cast.persons.get(key),
            date,
            self.defs.calendar.season_of(day) as u32,
        )?;
        let loc = self.defs.locations.iter().position(|l| l.key == schedule.at)?;
        Some(CastPlace { loc: crate::LocId::from_idx(loc), venue: schedule.venue.clone() })
    }
    pub fn upbringing_place_open(&self, place: &PlaceDef) -> bool {
        self.upbringing_unlock(&place.unlock, self.cast_date())
    }
    pub fn upbringing_companion_present(&self, key: &str, place: Option<&str>, date: WorldDate) -> bool {
        let Some(p) = self.upbringing_person_on(key, date) else { return false };
        let venue =
            place.and_then(|key| self.upbringing_places().iter().find(|p| p.key == key)).map(|p| p.venue.as_str());
        Some(p.loc) == self.upbringing_location() && venue.is_none_or(|v| p.venue == v)
    }
    pub(crate) fn check_local_choice(
        &self,
        a: &ActivityDef,
        c: &AfterChoice,
        date: WorldDate,
    ) -> Result<(), CommandError> {
        for (provided, need) in [
            (c.place.is_some(), Need::Place),
            (c.companion.is_some(), Need::Companion),
            (c.excursion.is_some() || c.node.is_some(), Need::Excursion),
        ] {
            if provided && !a.needs.contains(&need) {
                return Err(CommandError::Precondition("这项活动不接受该行动选择".into()));
            }
        }
        if let Some(place) = &c.place {
            let p = self
                .upbringing_places()
                .iter()
                .find(|p| &p.key == place)
                .ok_or_else(|| CommandError::NotFound(place.clone()))?;
            if !self.upbringing_unlock(&p.unlock, date) {
                return Err(CommandError::Precondition("场所尚未开放".into()));
            }
        }
        // 带心动的同行对谁都能约；心动只给开放恋爱的人（结算时由内核按年龄与性向校验，U03 / A4）。
        if let Some(person) = &c.companion
            && !self.upbringing_companions().contains_key(person)
        {
            return Err(CommandError::Precondition("还不能邀请这位同行者".into()));
        }
        match (&c.excursion, &c.node) {
            (Some(e), Some(n)) => self.check_excursion(e, n)?,
            (None, None) => {}
            _ => return Err(CommandError::Precondition("远足必须同时给出图与节点".into())),
        }
        Ok(())
    }
    pub(crate) fn settle_companion(
        &mut self,
        a: &ActivityDef,
        c: &AfterChoice,
        index: u8,
        result: &mut SlotResult,
    ) -> Result<bool, CoreError> {
        let Some(key) = &c.companion else { return Ok(true) };
        if let Some(key) = self.cadence_outing_problem(1) {
            result.line = Some(key.into());
            return Ok(false);
        }
        let cadence = self.upbringing_cadence_enabled();
        let week = super::cadence::week_index(&self.defs, self.day());
        let Some(s) = &mut self.state.upbringing else { return Ok(false) };
        if !cadence && s.outings >= 2 {
            return Ok(false);
        }
        s.outings = s.outings.saturating_add(1);
        if cadence {
            s.cadence.last_outing_week = Some(week);
        }
        let Some(person) = self.defs.cast.person(key) else { return Ok(false) };
        let matches = |tags: &[String]| {
            tags.iter().any(|tag| tag == &a.key || a.tags.contains(tag) || c.place.as_ref() == Some(tag))
        };
        let affinity = self.affection(key).map_or(0, |a| a.affinity);
        let chance = if matches(&person.hates) {
            0
        } else {
            (6000
                + affinity * 35
                + if matches(&person.loves) { 3000 } else { 0 }
                + if matches(&person.likes) { 1500 } else { 0 }
                - if matches(&person.dislikes) { 3000 } else { 0 })
            .clamp(0, 10000)
        };
        let accepted = self.upbringing_companion_present(key, c.place.as_deref(), self.cast_date())
            && self.upbringing_rng(&format!("invitation:{}:{key}", a.key), index, 1).chance_bp(chance);
        if !accepted {
            result.line = Some("同行者推辞了邀请".into());
            return Ok(false);
        }
        let before = self.affection(key).map_or(0, |a| a.affinity);
        self.change_affinity(key, 3).map_err(|e| CoreError::Internal(e.to_string()))?;
        self.remember_experience(key).map_err(|e| CoreError::Internal(e.to_string()))?;
        if a.heart > 0 && self.validate_romance(key, RomanceAction::Heart).is_ok() {
            self.change_heart(key, a.heart).map_err(|e| CoreError::Internal(e.to_string()))?;
        }
        *result.affinity.entry(key.clone()).or_default() += self.affection(key).map_or(0, |a| a.affinity) - before;
        self.record_deed(crate::story2::deeds::Deed::UbCompanion, 1);
        Ok(true)
    }
}
