//! 阶段由家庭日期和入学事件决定；日期改变只重排尚未结算的部分。
use super::*;
use crate::{CoreError, World, cast::CastPlace};
impl World {
    pub(crate) fn refresh_upbringing_stage(&mut self) {
        if !self.upbringing_active() {
            return;
        }
        let date = self.cast_date();
        let Some(family) = self.upbringing_family().cloned() else { return };
        for stage in family.stages.iter().filter(|s| s.from <= date) {
            if !self.upbringing_skipping()
                && stage.entry_flag.as_ref().is_some_and(|flag| !self.upbringing_flag(flag))
                && let Some(event) = &stage.entry_event
            {
                self.permit_cadence_dated_event(event);
                let _ = self.start_story2(event);
            }
        }
        let Some(stage) = self.upbringing_stage_on(date).cloned() else { return };
        let Some(loc) = self.defs.locations.iter().position(|l| l.key == stage.at).map(crate::LocId::from_idx) else {
            return;
        };
        let changed =
            self.state.upbringing.as_ref().is_some_and(|s| s.stage_from.is_some_and(|from| from != stage.from));
        if changed || date >= family.graduation {
            self.return_training_fleet();
        }
        let act = self.act_running();
        if let Some(s) = &mut self.state.upbringing {
            if changed {
                s.plan.clear();
                s.reading_slot = None;
                s.phase = if s.skipping || act { Phase::Running } else { Phase::Plan };
                if !s.weekly.on {
                    s.next_slot = s.next_slot.max(super::schedule::slot_of(date[2]));
                }
            }
            s.stage_from = Some(stage.from);
            if date >= family.graduation {
                s.phase = Phase::Graduation;
            }
        }
        if changed && self.upbringing_weekly() && !self.act_running() {
            // U05：周中换阶段——本周余下的格按新阶段的布局重排（上面已经清掉日程；布局取新阶段的）。
            self.restage_week();
        }
        if changed || self.state.cast.place.as_ref().is_none_or(|p| p.loc != loc) {
            self.state.cast.place = Some(CastPlace { loc, venue: String::new() });
        }
        self.state.cast.academy = stage.stage == Stage::Academy;
        if changed && self.act_running() {
            self.act_restage();
        }
        // 家乡和实际入学地的近岸见识随经历积累；不发放尚未毕业的远海图。
        if !self.state.explore.visited.contains(&loc) {
            self.state.explore.visited.insert(loc);
            self.reveal_around(self.defs.loc(loc).cell, self.defs.rules.explore.sight);
        }
        if self.upbringing_skipping() {
            return;
        }
        self.grant_outing_permission();
        // 校历和节庆只触发明确日期的轨道；故事自己的 once 标志避免重复领效果。
        let culture = self
            .upbringing_academy()
            .map(|a| a.culture.as_str())
            .filter(|s| !s.is_empty())
            .unwrap_or(self.defs.loc(loc).culture.as_str());
        let mut events = self
            .defs
            .upbringing
            .festivals
            .iter()
            .filter(|f| {
                f.dates.contains(&date) && f.cultures.iter().any(|c| self.upbringing_culture_matches(c, culture))
            })
            .flat_map(|f| f.event.iter().chain(&f.events).cloned())
            .filter(|e| !self.upbringing_cadence_enabled() || !e.contains('*'))
            .collect::<Vec<_>>();
        if let Some(a) = self.upbringing_academy() {
            events.extend(a.calendar.iter().filter(|m| m.date == date).filter_map(|m| m.event.clone()));
        }
        if let Some(c) = &family.completion {
            if let Some(event) = &c.family_event
                && self.upbringing_family_ceremony_date().is_some_and(|d| date >= d)
            {
                events.push(event.clone());
            }
            if let Some(event) = &c.choose_event
                && self.state.upbringing.as_ref().is_some_and(|s| s.path.is_none())
                && self.state.protagonist.as_ref().and_then(|i| i.age_on(date)).is_some_and(|age| age >= c.choose_age)
            {
                events.push(event.clone());
            }
        }
        if date >= family.graduation
            && let Some(event) = family.completion.as_ref().and_then(|c| c.event.clone())
        {
            events.push(event);
        }
        for event in events {
            self.permit_cadence_dated_event(&event);
            let _ = self.start_story2(&event);
        }
    }
    /// 家乡期开始满规则天数，家里准许出门远足：剧情旗标表与养成旗标集都设上，记一条日志（U03 / A3）。
    /// 远足图的节点门槛读养成旗标，各家“第一次远足”的章节条件读剧情旗标；只发一次。
    pub(crate) fn grant_outing_permission(&mut self) {
        let days = self.defs.upbringing.rules.outing_permission_days;
        if days == 0 || self.upbringing_flag(super::OUTING_PERMISSION_FLAG) {
            return;
        }
        let Some(from) =
            self.upbringing_family().and_then(|f| f.stages.iter().find(|s| s.stage == Stage::Home)).map(|s| s.from)
        else {
            return;
        };
        let Ok(start) = crate::scenario::day_of(&self.defs, from) else { return };
        if self.day() < start.saturating_add(days) {
            return;
        }
        self.state.story2.flags.insert(super::OUTING_PERMISSION_FLAG.into());
        if let Some(s) = &mut self.state.upbringing {
            s.flags.insert(super::OUTING_PERMISSION_FLAG.into());
        }
        self.push_log(crate::log::LogEvent { day: self.day(), kind: crate::log::LogKind::OutingPermitted });
    }
    pub(crate) fn upbringing_family_ceremony_date(&self) -> Option<crate::scenario::WorldDate> {
        self.upbringing_family()?
            .stages
            .iter()
            .rev()
            .find_map(|s| s.academy.as_deref())
            .and_then(|key| self.defs.upbringing.academy(key))
            .and_then(|a| a.graduation.as_ref())
            .map(|g| g.date)
    }
    pub(crate) fn settle_local_choice(
        &mut self,
        a: &ActivityDef,
        c: &AfterChoice,
        index: u8,
        result: &mut SlotResult,
    ) -> Result<bool, CoreError> {
        if self.check_local_choice(a, c, self.cast_date()).is_err() {
            result.success = Some(false);
            result.line = Some(
                if self.upbringing_weekly() {
                    "这一格行动的条件已经改变"
                } else {
                    "本旬行动的条件已经改变"
                }
                .into(),
            );
            return Ok(false);
        }
        if let Some(place) =
            c.place.as_ref().and_then(|key| self.upbringing_places().iter().find(|p| &p.key == key)).cloned()
        {
            if let Some(at) = &mut self.state.cast.place {
                at.venue = place.venue;
            }
            self.cast_meet_here();
        }
        let accepted = self.settle_companion(a, c, index, result)?;
        if !accepted {
            result.success = Some(false);
        }
        Ok(accepted)
    }
}
