use super::*;
use crate::log::{LogEvent, LogKind};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ActCalendarMark {
    pub date: WorldDate,
    pub kind: String,
    pub key: String,
}
/// 只有日程与主命到期属于提醒；以后增加的停因默认需要玩家决定。
pub fn act_stop_blocking(kind: &str) -> bool {
    !matches!(kind, "calendar" | "mission_due")
}
pub fn difference(now: &BTreeMap<String, i64>, before: &BTreeMap<String, i64>) -> BTreeMap<String, i64> {
    now.keys()
        .chain(before.keys())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .filter_map(|k| {
            let v = now.get(k).copied().unwrap_or(0) - before.get(k).copied().unwrap_or(0);
            (v != 0).then(|| (k.clone(), v))
        })
        .collect()
}
impl World {
    pub fn act_cash(&self) -> i64 {
        self.state.agents.get(&OwnerId::Player).map_or(0, |a| a.cash)
    }
    pub fn act_points_bonus(&self) -> u8 {
        self.act_rules().map_or(0, |r| {
            (u8::from(self.upbringing_projected("constitution") >= r.bonus.constitution_level)
                + if self.act_review_running() && self.act_rank() >= 2 { r.rank_points } else { 0 })
            .min(r.points.bonus_max)
        })
    }
    pub fn act_points_base(&self) -> u8 {
        self.act_rules()
            .map_or(0, |r| if self.upbringing_academy().is_some() { r.points.academy } else { r.points.home })
    }
    pub fn act_snapshot(&self) -> WeekSnapshot {
        let Some(s) = &self.state.upbringing else { return WeekSnapshot::default() };
        WeekSnapshot {
            cash: self.act_cash(),
            fatigue: s.fatigue,
            mood: s.mood,
            growth: s.growth.clone(),
            goods_seen: s.act.goods_seen.clone(),
            skills: self.inventory(OwnerId::Player).map(|i| i.skill_xp.clone()).unwrap_or_default(),
            affinity: self.state.cast.persons.iter().map(|(k, p)| (k.clone(), p.affection.affinity)).collect(),
            cash_in_base: self
                .state
                .agents
                .get(&OwnerId::Player)
                .map_or(0, |p| -p.ledger.balance(crate::ledger::Account::OtherIncome)),
            merit: s.act.merit,
            score: Some(if self.act_review_on() { self.act_score().total } else { 0 }),
            cash_out_base: self
                .state
                .agents
                .get(&OwnerId::Player)
                .map_or(0, |p| p.ledger.balance(crate::ledger::Account::OtherExpense)),
        }
    }
    pub(crate) fn enter_act(&mut self) {
        if !self.act_rules().is_some_and(|r| r.enabled)
            || !self.upbringing_family().is_some_and(|f| f.act)
            || !self.upbringing_active()
            || self.upbringing_skipping()
        {
            return;
        }
        if let Some(s) = &mut self.state.upbringing {
            s.act.on = true;
            s.phase = Phase::Running;
        }
        self.init_upbringing_growth();
        self.act_init_origin();
        self.act_open_week();
        self.act_open_missions();
        let week = week_index(&self.defs, self.day());
        if let Some(s) = &mut self.state.upbringing {
            s.act.phase = ActPhase::Plan;
            s.act.restaged_week = Some(week);
        }
    }
    fn act_open_week(&mut self) {
        let week = week_index(&self.defs, self.day());
        if let Some(s) = &mut self.state.upbringing {
            s.act.week = week;
            if s.act.ill_until_week.is_some_and(|w| w < week) {
                s.act.ill_until_week = None;
            }
        }
        let points = if self.act_ill() {
            self.act_rules().map_or(1, |r| r.illness.points)
        } else {
            self.act_points_base() + self.act_points_bonus()
        };
        let snapshot = self.act_snapshot();
        let stage = self.act_stage_key();
        let defaults = self.act_default_lessons();
        if let Some(s) = &mut self.state.upbringing {
            let first = s.act.opened.is_none();
            s.phase = Phase::Running;
            s.plan.clear();
            s.next_slot = 0;
            s.last.clear();
            s.act.week = week;
            s.act.phase = if first { ActPhase::Plan } else { ActPhase::Summary };
            s.act.points = points;
            s.act.points_max = points;
            s.act.done.clear();
            s.act.outcomes.clear();
            s.act.moment = None;
            s.act.free_applied = 0;
            s.act.free_skipped.clear();
            s.act.opened = Some(snapshot);
            if !defaults.is_empty() {
                s.act.timetables.entry(stage).or_insert(defaults);
            }
        }
        self.act_open_voyage_week();
        self.act_introduce();
        self.act_refresh_presence();
        self.act_refresh_markers(true);
    }
    pub(crate) fn act_new_day(&mut self) -> Result<(), CoreError> {
        if !self.act_running() {
            return Ok(());
        }
        let week = week_index(&self.defs, self.day());
        if self.state.upbringing.as_ref().is_some_and(|s| s.act.week != week) {
            self.act_open_week();
        }
        if self.cast_date()[2] == 1 {
            self.act_open_missions();
        }
        self.act_pause_moment();
        self.act_refresh_markers(false);
        if self.act_day() == 6
            && self.act_phase() == ActPhase::Lessons
            && let Some(s) = &mut self.state.upbringing
        {
            s.act.phase = ActPhase::Free;
        }
        Ok(())
    }
    pub(crate) fn act_restage(&mut self) {
        if !self.act_running() {
            return;
        }
        let key = self.act_stage_key();
        let defaults = self.act_default_lessons();
        let points = if self.act_ill() {
            self.act_rules().map_or(1, |r| r.illness.points)
        } else {
            self.act_points_base() + self.act_points_bonus()
        };
        let week = week_index(&self.defs, self.day());
        if let Some(s) = &mut self.state.upbringing {
            s.phase = Phase::Running;
            s.act.moment = None;
            // 入学剧情在小结页答完时，先保留上周小结；关闭后仍会因 restage 停在周初。
            if s.act.phase != ActPhase::Summary {
                s.act.phase = ActPhase::Plan;
            }
            s.act.restaged_week = Some(week);
            s.act.points = points;
            s.act.points_max = points;
            if !defaults.is_empty() {
                s.act.timetables.entry(key).or_insert(defaults);
            }
        }
        self.act_refresh_presence();
        self.act_refresh_markers(true);
    }
    pub(crate) fn finish_act_day(&mut self) -> Result<(), CoreError> {
        if self.act_phase() != ActPhase::Lessons {
            return Ok(());
        }
        let day = self.act_day();
        let slots: Vec<_> = self
            .act_lesson_plan()
            .iter()
            .enumerate()
            .filter(|(i, _)| self.act_lesson_days().get(*i).is_some_and(|d| u32::from(*d) == day))
            .map(|(i, p)| (i as u8, p.clone()))
            .collect();
        for (index, plan) in slots {
            let a = self
                .defs
                .upbringing
                .lines
                .iter()
                .find(|l| l.key == plan.line)
                .and_then(|l| l.tiers.get(usize::from(plan.tier)))
                .and_then(|t| self.defs.upbringing.activity(&t.activity))
                .cloned();
            let mut result = SlotResult { index, eighths: 1, ..Default::default() };
            let mut events = Vec::new();
            if let Some(a) = a {
                result.activities.push(a.key.clone());
                result.scene = a.scene.clone();
                let r = self.act_rules().cloned().unwrap_or_default();
                if self.act_ladder_on() {
                    let line = self
                        .defs
                        .upbringing
                        .lines
                        .iter()
                        .find(|l| l.key == plan.line)
                        .cloned()
                        .ok_or_else(|| internal("课线不存在"))?;
                    events = self.settle_act_lesson(&line, &plan, index, false, &mut result)?;
                } else {
                    events = self.settle_upbringing_activity_scaled(
                        &a,
                        index,
                        0,
                        settlement::ActScale::lesson(&r, plan.tier),
                        &mut result,
                    )?;
                }
                if !self.act_ill()
                    && result.success != Some(false)
                    && let Some(person) = &plan.with
                {
                    let place =
                        self.defs.upbringing.lines.iter().find(|l| l.key == plan.line).map(|l| l.place.as_str());
                    if self.act_presence(person) == place && place.is_some() {
                        self.act_affinity(person, r.with.affinity, &mut result).map_err(internal)?;
                        if let Some(s) = &mut self.state.upbringing {
                            s.cadence.last_outing_week = Some(s.act.week);
                        }
                        self.record_deed(crate::story2::deeds::Deed::UbCompanion, 1);
                    }
                }
            } else {
                result.success = Some(false);
            }
            events.extend(self.settle_upbringing_low_mood());
            self.refresh_upbringing_goals()?;
            self.refresh_upbringing_unlocks(false);
            self.act_journal(&result);
            if let Some(s) = &mut self.state.upbringing {
                s.weekly.slots += 1;
                s.last.push(result.clone());
            }
            self.trigger_cadence_events(&events, &result);
            self.push_log(LogEvent {
                day: self.day(),
                kind: LogKind::UpbringingSettled { month: [self.cast_date()[0], self.cast_date()[1]], slot: index },
            });
        }
        self.act_refresh_missions()?;
        self.act_refresh_markers(false);
        if day == 7 {
            self.act_close_week()?;
        }
        Ok(())
    }
    pub(super) fn act_journal(&mut self, result: &SlotResult) {
        let today = self.day();
        if let Some(s) = &mut self.state.upbringing {
            if let Some(last) = s.journal.last_mut().filter(|j| j.day == today) {
                let r = &mut last.result;
                r.activities.extend(result.activities.iter().cloned());
                for (target, source) in [
                    (&mut r.growth, &result.growth),
                    (&mut r.skills, &result.skills),
                    (&mut r.items, &result.items),
                    (&mut r.affinity, &result.affinity),
                ] {
                    for (k, v) in source {
                        *target.entry(k.clone()).or_default() += v;
                    }
                }
                r.cash += result.cash;
                r.fatigue += result.fatigue;
                r.mood += result.mood;
                if result.success.is_some() {
                    r.success = Some(r.success.unwrap_or(true) && result.success.unwrap_or(true));
                }
            } else {
                s.journal.push(JournalEntry { day: today, result: result.clone() });
            }
        }
    }
    fn act_close_week(&mut self) -> Result<(), CoreError> {
        let recover =
            self.act_rules().map_or(10, |r| if self.act_ill() { r.illness.recover } else { r.recover.weekly });
        let mut result = SlotResult { eighths: 1, ..Default::default() };
        self.act_meters(-recover, 0, &mut result);
        self.act_journal(&result);
        self.act_expire_markers();
        let voyage = self.act_close_voyage_week();
        self.act_refresh_missions()?;
        let mut k2 = self.act_week_review()?;
        k2.ill = self.act_week_illness();
        k2.moment = self.state.upbringing.as_ref().and_then(|s| {
            s.act.outcomes.iter().find_map(|o| o.moment.map(|pick| MomentSummary { pick, ok: o.moment_ok }))
        });
        let now = self.act_snapshot();
        let week = week_index(&self.defs, self.day());
        let from = self.act_week_date(week, false);
        let to = self.act_week_date(week, true);
        let mut k3 = self.act_week_k3();
        k3.voyage = voyage;
        if let Some(s) = &mut self.state.upbringing
            && let Some(before) = &s.act.opened
        {
            s.act.last_week = Some(WeekSummary {
                k2,
                k3,
                merit: now.merit - before.merit,
                score_delta: now.score.unwrap_or(0) - before.score.unwrap_or(0),
                week: s.act.week,
                from,
                to,
                growth: difference(&now.growth, &before.growth),
                skills: difference(&now.skills, &before.skills),
                cash: now.cash - before.cash,
                fatigue: now.fatigue - before.fatigue,
                mood: now.mood - before.mood,
                affinity: difference(&now.affinity, &before.affinity),
                lessons_ok: s.last.iter().filter(|r| r.success == Some(true)).count() as u8,
                lessons_fail: s.last.iter().filter(|r| r.success == Some(false)).count() as u8,
                points_used: s.act.done.iter().map(|d| d.cost).sum(),
                markers_seen: s.act.done.iter().filter(|d| matches!(d.action, ActAction::Marker { .. })).count() as u8,
                free_applied: s.act.free_applied,
                free_skipped: s.act.free_skipped.clone(),
            });
        }
        Ok(())
    }
    pub fn act_stops(&self) -> BTreeMap<String, Vec<String>> {
        let mut out = BTreeMap::new();
        if self.act_phase() != ActPhase::Plan {
            return out;
        }
        let Some(s) = &self.state.upbringing else { return out };
        let Some(r) = self.act_rules() else { return out };
        let tiers: Vec<_> = self
            .defs
            .upbringing
            .lines
            .iter()
            .filter(|l| self.act_line_here(l))
            .flat_map(|l| {
                (1..l.tiers.len())
                    .filter(|t| {
                        self.act_tier_status(l, *t as u8).missing.iter().all(|m| m == "master")
                            && !self.act_paid(&l.key, *t as u8)
                            && s.act.lines.get(&l.key).is_none_or(|s| s.seen & (1 << t) == 0)
                    })
                    .map(|t| format!("{}:{t}", l.key))
            })
            .collect();
        if !self.act_sailing() && !tiers.is_empty() {
            out.insert("tier_open".into(), tiers);
        }
        if s.act.voyage.as_ref().is_some_and(|v| v.leg == 0) {
            out.insert("voyage".into(), s.act.voyage.iter().map(|v| v.key.clone()).collect());
        }
        if self.act_ill() {
            out.insert("ill".into(), Vec::new());
        }
        let due: Vec<_> = self
            .defs
            .upbringing
            .missions
            .iter()
            .filter(|m| {
                self.act_mission_due(m)[..2] == self.cast_date()[..2]
                    && weekly::week_of(self.act_mission_due(m)[2]) == weekly::week_of(self.cast_date()[2])
                    && s.act.missions.get(&m.key).is_some_and(|m| m.status == MissionStatus::Active)
            })
            .map(|m| m.key.clone())
            .collect();
        if !due.is_empty() {
            out.insert("mission_due".into(), due);
        }
        if self.act_fee_week() > self.act_cash() {
            out.insert("fee".into(), Vec::new());
        }
        if s.fatigue * 10 + self.act_fatigue_week_x10() - r.recover.weekly * 10 >= r.fatigue_stop * 10 {
            out.insert("fatigue".into(), Vec::new());
        }
        let calendar: Vec<_> = self
            .act_calendar()
            .into_iter()
            .filter(|m| {
                crate::scenario::day_of(&self.defs, m.date)
                    .ok()
                    .is_some_and(|d| week_index(&self.defs, d) == s.act.week)
                    && ["festival", "exam", "contest", "academy", "review"].contains(&m.kind.as_str())
            })
            .map(|m| m.key)
            .collect();
        if !calendar.is_empty() {
            out.insert("calendar".into(), calendar);
        }
        let keys: Vec<_> = s
            .act
            .markers
            .iter()
            .filter(|(key, m)| {
                self.act_marker_visible(key)
                    && m.key
                    && m.expires_week == s.act.week
                    && self.act_marker_candidate_problem(key).is_ok()
            })
            .map(|(k, _)| k.clone())
            .collect();
        if !keys.is_empty() {
            out.insert("key_marker".into(), keys);
        }
        if s.act.restaged_week == Some(s.act.week) {
            out.insert("restage".into(), vec![self.act_stage_key()]);
        }
        if let Err(e) = self.act_lessons_problem(self.act_lesson_plan()) {
            let slots = match e {
                CommandError::Rule(r) => r
                    .args
                    .into_iter()
                    .filter_map(|(k, v)| match (k, v) {
                        ("slot", crate::text::TextArg::Int(n)) => Some(n.to_string()),
                        _ => None,
                    })
                    .collect(),
                _ => Vec::new(),
            };
            out.insert("blocked".into(), slots);
        }
        out
    }
    pub fn act_week_date(&self, week: u32, end: bool) -> WorldDate {
        let months = self.defs.calendar.months().len() as u32;
        let month = week / 4;
        let day = if end && week % 4 == 3 {
            u32::from(self.defs.calendar.months()[(month % months) as usize])
        } else {
            1 + week % 4 * 7 + if end { 6 } else { 0 }
        };
        [self.defs.rules.world.start_year.max(0) as u32 + month / months, month % months + 1, day]
    }
    pub fn act_calendar(&self) -> Vec<ActCalendarMark> {
        let mut out = Vec::new();
        let week = week_index(&self.defs, self.day());
        let loc = self.upbringing_location().map(|l| self.defs.loc(l));
        let in_range = |date| {
            crate::scenario::day_of(&self.defs, date)
                .ok()
                .is_some_and(|d| (week..=week + 4).contains(&week_index(&self.defs, d)))
        };
        let mut add = |date, kind: &str, key: &str| {
            if in_range(date) {
                out.push(ActCalendarMark { date, kind: kind.into(), key: key.into() });
            }
        };
        for c in &self.defs.upbringing.contests {
            if loc.is_some_and(|l| l.key == c.at) {
                for d in &c.dates {
                    add(*d, "contest", &c.key);
                }
            }
        }
        let academy = self.upbringing_academy();
        for e in &self.defs.upbringing.exams {
            if e.academy.is_some() && e.academy.as_deref() == academy.map(|a| a.key.as_str()) {
                for d in &e.dates {
                    add(*d, "exam", &e.key);
                }
            }
        }
        let culture =
            academy.map(|a| a.culture.as_str()).filter(|c| !c.is_empty()).or_else(|| loc.map(|l| l.culture.as_str()));
        for f in &self.defs.upbringing.festivals {
            if culture.is_some_and(|c| f.cultures.iter().any(|wanted| self.upbringing_culture_matches(wanted, c))) {
                for d in &f.dates {
                    add(*d, "festival", &f.key);
                }
            }
        }
        if let Some(a) = academy {
            for m in &a.calendar {
                add(m.date, "academy", &m.key);
            }
        }
        if let Some(s) = &self.state.upbringing {
            for key in s.act.markers.keys() {
                if self.act_marker_visible(key)
                    && let Some(day) = self.act_marker_deadline(key)
                {
                    let d = self.defs.calendar.date_of(day);
                    add([self.defs.rules.world.start_year as u32 + d.year - 1, d.month, d.day], "marker_due", key);
                }
            }
            for (key, day) in &s.cadence.scheduled {
                let d = self.defs.calendar.date_of(*day);
                add([self.defs.rules.world.start_year as u32 + d.year - 1, d.month, d.day], "agenda", key);
            }
        }
        for m in &self.defs.upbringing.missions {
            if self.upbringing_family().is_some_and(|f| m.family == f.key) {
                add(self.act_mission_due(m), "mission_due", &m.key);
            }
        }
        for offset in 0..=4 {
            let next = week + offset;
            let previous = next.checked_sub(1).map(|w| self.act_tides_at(w)).unwrap_or_default();
            for tide in self.act_tides_at(next) {
                if !previous.iter().any(|t| t.port == tide.port && t.key == tide.key) {
                    add(self.act_week_date(next, false), "tide", &tide.key);
                }
            }
            let date = self.act_week_date(week + offset, true);
            if weekly::week_of(date[2]) == 3 && self.act_rules().is_some_and(|r| r.reviews.contains(&date[1])) {
                add(date, "review", "review");
            }
        }
        if self.act_stage_on("voyage") {
            for v in &self.defs.upbringing.act_voyages {
                if self.upbringing_family().is_some_and(|f| v.family == f.key)
                    && matches!(self.act_voyage_status(v), "open" | "joined")
                {
                    add(v.start, "voyage", &v.key);
                }
            }
        }
        out.sort_by(|a, b| (&a.date, &a.kind, &a.key).cmp(&(&b.date, &b.kind, &b.key)));
        out.dedup();
        out
    }
}
