use super::*;
use crate::story2::Condition;
use crate::story2::Status;

/// 可由养成行动补足的门槛；日期、身份、剧情前置等仍等排期，不给地图挂等待标记。
fn recoverable(condition: &Condition) -> bool {
    matches!(
        condition,
        Condition::Cash { .. }
            | Condition::Item { .. }
            | Condition::Attr { .. }
            | Condition::Growth { .. }
            | Condition::Skill { .. }
            | Condition::Affinity { .. }
            | Condition::Fame { .. }
            | Condition::Read { .. }
            | Condition::Books { .. }
            | Condition::Gifts { .. }
            | Condition::Deed { .. }
    ) || matches!(condition, Condition::Any { any } if any.iter().any(recoverable))
}

impl World {
    /// 同一份排期条件区分内部等待与玩家可补足的门槛；后者保留标记并明确拒因。
    pub(super) fn act_marker_candidate_problem(&self, key: &str) -> Result<(), CommandError> {
        let checks = if self.cadence_candidate_now(key, false) {
            BTreeMap::new()
        } else {
            self.cadence_candidate_checks(key, false)
        };
        let Some(t) = self.defs.story2.track(key) else { return Err(reason("ub.act.marker")) };
        let state = self.state.story2.tracks.get(key);
        let Some(c) = t.chapter(state.map_or(t.start.as_str(), |s| s.chapter.as_str())) else {
            return Err(reason("ub.act.marker"));
        };
        let entered = state.map_or(self.day(), |s| s.entered);
        let mut blocked = false;
        for (check, passed) in checks {
            if passed || check == "chapter_available" {
                continue;
            }
            let fixable = if check == "choices_open" {
                // 软检定都失败后，练到门槛即可继续，也属于玩家可补足的条件。
                c.choices.iter().any(|choice| {
                    self.story2_choice_visible(choice, entered)
                        && choice.requires.iter().all(|condition| {
                            recoverable(condition) || self.story2_conditions(std::slice::from_ref(condition), entered)
                        })
                })
            } else if check == "chapter_objectives" {
                c.objectives.iter().any(|o| !self.story2_objective_done(o, entered))
                    && c.objectives.iter().all(|o| {
                        self.story2_objective_done(o, entered) || o.kind.condition().as_ref().is_some_and(recoverable)
                    })
            } else if let Some(i) = check.strip_prefix("chapter_when.").and_then(|i| i.parse::<usize>().ok()) {
                c.when.get(i).is_some_and(recoverable)
            } else {
                false
            };
            if !fixable {
                return Err(reason("ub.act.marker"));
            }
            blocked = true;
        }
        if let Some(index) = self.defs.upbringing.act_index.tracks.get(key)
            && !index.chapters.get(&c.key).copied().unwrap_or(false)
            && self
                .defs
                .upbringing
                .act_markers
                .iter()
                .find(|m| m.track == key)
                .and_then(|m| m.levels.get(&c.key))
                .is_some_and(|level| self.act_person_level(&index.person) < *level)
        {
            blocked = true;
        }
        if blocked { Err(reason("ub.act.marker_requirements")) } else { Ok(()) }
    }
    pub(super) fn act_marker_chapter_deadline(&self, track: &str) -> Option<u32> {
        let m = self.state.upbringing.as_ref()?.act.markers.get(track)?;
        let entered = self.state.story2.tracks.get(track).map_or(self.day(), |s| s.entered);
        let c = self.defs.story2.track(track)?.chapter(&m.chapter)?;
        self.upbringing_event_deadline(track, c, entered)
    }
    /// 期限按章的止日截断；只读时同样适用于旧档尚未刷新的四周标记。
    pub fn act_marker_deadline(&self, track: &str) -> Option<u32> {
        let m = self.state.upbringing.as_ref()?.act.markers.get(track)?;
        let end = crate::scenario::day_of(&self.defs, self.act_week_date(m.expires_week, true)).ok()?;
        Some(self.act_marker_chapter_deadline(track).map_or(end, |deadline| end.min(deadline)))
    }
    pub fn act_marker_visible(&self, track: &str) -> bool {
        let Some(s) = &self.state.upbringing else { return false };
        let Some(m) = s.act.markers.get(track) else { return false };
        let current = self.state.story2.tracks.get(track);
        m.hanging(s.act.week)
            && self.act_places().iter().any(|p| p.key == m.place)
            && current.is_none_or(|state| {
                state.chapter == m.chapter && !matches!(state.status, Status::Done | Status::Failed)
            })
            && m.person.as_deref().is_none_or(|person| self.act_presence(person).is_some())
            && self.act_marker_deadline(track).is_some_and(|day| day >= self.day())
            && {
                let error = self.act_marker_candidate_problem(track).err();
                let blocked = error.as_ref().is_some_and(|error| error.code() == "ub.act.marker_requirements");
                (error.is_none() || blocked)
                    && (self.act_story_waiting()
                        || !s.event_permits.iter().any(|key| self.act_marker_held(key))
                        || s.event_permits.contains(track) && blocked)
            }
    }
    /// 直接点标记、自由日停因与视图都通过完整行动检查；可用性不存档。
    pub fn act_marker_problem(&self, place: &str, track: &str) -> Result<(), CommandError> {
        self.act_action_problem(place, &ActAction::Marker { track: track.into() })
    }
    /// 只读排查入口使用；每个布尔值为相应条件的通过结果。
    pub fn act_marker_checks(&self, place: &str, track: &str) -> BTreeMap<String, bool> {
        let mut checks = self.cadence_candidate_checks(track, false);
        let s = self.state.upbringing.as_ref();
        let m = s.and_then(|s| s.act.markers.get(track));
        checks.insert("marker_hanging".into(), s.zip(m).is_some_and(|(s, m)| m.hanging(s.act.week)));
        checks.insert("marker_place".into(), m.is_some_and(|m| m.place == place));
        checks.insert(
            "marker_current_place".into(),
            m.is_some_and(|m| self.act_places().iter().any(|p| p.key == m.place)),
        );
        checks.insert(
            "marker_waits_on_player".into(),
            self.act_story_waiting()
                || s.is_none_or(|s| {
                    !s.event_permits.iter().any(|key| self.act_marker_held(key))
                        || s.event_permits.contains(track)
                            && self
                                .act_marker_candidate_problem(track)
                                .err()
                                .is_some_and(|error| error.code() == "ub.act.marker_requirements")
                }),
        );
        checks.insert(
            "marker_chapter".into(),
            m.is_some_and(|m| {
                self.state.story2.tracks.get(track).is_none_or(|state| {
                    state.chapter == m.chapter && !matches!(state.status, Status::Done | Status::Failed)
                })
            }),
        );
        checks.insert("marker_deadline".into(), self.act_marker_deadline(track).is_some_and(|day| day >= self.day()));
        checks.insert(
            "marker_person_present".into(),
            m.is_some_and(|m| m.person.as_deref().is_none_or(|person| self.act_presence(person).is_some())),
        );
        checks.insert(
            "marker_permits_clear".into(),
            s.is_none_or(|s| !s.event_permits.iter().any(|key| self.act_marker_held(key))),
        );
        checks.insert("action_healthy".into(), !self.act_ill());
        checks.insert("action_story_clear".into(), !self.act_story_waiting());
        checks.insert("action_free".into(), self.act_phase() == ActPhase::Free);
        checks.insert(
            "action_place_open".into(),
            self.act_places().iter().any(|p| p.key == place && self.upbringing_place_open(p)),
        );
        checks.insert(
            "action_supported".into(),
            self.act_place_actions(place).iter().any(|action| action.kind == "marker"),
        );
        checks.insert("action_points".into(), s.is_some_and(|s| s.act.points >= 1));
        checks
    }
    /// 排期会预看周中门槛；尚未挂上的合资格轨道也留到下个周首，防止预排抢先消耗。
    pub(crate) fn act_marker_reserved(&self, key: &str) -> bool {
        if !self.act_running() {
            return false;
        }
        let Some(s) = &self.state.upbringing else {
            return false;
        };
        if let Some(marker) = s.act.markers.get(key) {
            return !marker.retired;
        }
        self.defs.upbringing.act_index.tracks.get(key).is_some_and(|index| self.act_presence(&index.person).is_some())
    }
    /// 冷却中的标记同样不参与自动排期；退役后交回 U06a。
    pub(crate) fn act_marker_held(&self, key: &str) -> bool {
        self.act_running()
            && self.state.upbringing.as_ref().is_some_and(|s| s.act.markers.get(key).is_some_and(|m| !m.retired))
    }
    pub fn act_marker_for_person(&self, person: &str) -> Option<&str> {
        let s = self.state.upbringing.as_ref()?;
        s.act
            .markers
            .iter()
            .find(|(key, m)| {
                self.act_marker_visible(key)
                    && m.person.as_deref() == Some(person)
                    && Some(m.place.as_str()) == self.act_presence(person)
            })
            .map(|(k, _)| k.as_str())
    }
    pub(crate) fn act_refresh_markers(&mut self, hang: bool) {
        if !self.act_running() {
            return;
        }
        let expired: Vec<_> = self
            .state
            .upbringing
            .as_ref()
            .into_iter()
            .flat_map(|s| s.act.markers.keys())
            .filter(|key| self.act_marker_chapter_deadline(key).is_some_and(|day| day < self.day()))
            .cloned()
            .collect();
        if let Some(s) = &mut self.state.upbringing {
            for key in expired {
                s.act.markers.remove(&key);
            }
        }
        if self.act_sailing() {
            return;
        }
        let week = week_index(&self.defs, self.day());
        let indexes = self.defs.upbringing.act_index.tracks.clone();
        for (track, index) in indexes {
            // 周首 prepare_cadence_week 已把到期关键章强排；本轮挂标记不能把它重新拿回、撤掉排期。
            if self
                .state
                .upbringing
                .as_ref()
                .is_some_and(|s| s.cadence.scheduled.contains_key(&track) || s.act.due.contains_key(&track))
            {
                continue;
            }
            let old = self.state.upbringing.as_ref().and_then(|s| s.act.markers.get(&track)).cloned();
            if old.as_ref().is_some_and(|m| m.retired || m.cooldown_until > week) {
                continue;
            }
            let Some(def) = self.defs.story2.track(&track) else { continue };
            let state = self.state.story2.tracks.get(&track);
            let chapter = state.map_or(def.start.as_str(), |s| s.chapter.as_str()).to_owned();
            let finished = state.is_some_and(|s| matches!(s.status, Status::Done | Status::Failed));
            let person_place = self.act_presence(&index.person).map(str::to_owned);
            let key = index.chapters.get(&chapter).copied().unwrap_or(false);
            let level =
                self.defs.upbringing.act_markers.iter().find(|m| m.track == track).and_then(|m| m.levels.get(&chapter));
            // 初挂仍须满足原排期门槛；已有标记的禁用与隐藏由当前可用性决定。
            let valid = !finished
                && person_place.is_some()
                && self.cadence_candidate_now(&track, false)
                && (key || level.is_none_or(|level| self.act_person_level(&index.person) >= *level));
            if old.as_ref().is_some_and(|m| m.chapter != chapter) || !valid {
                // 内部等待只隐藏，不重置已经挂出的期限；条件恢复后能在本周继续看。
                if old.as_ref().is_some_and(|m| finished || m.chapter != chapter)
                    && let Some(s) = &mut self.state.upbringing
                {
                    s.act.markers.remove(&track);
                }
                continue;
            }
            let place = index
                .places
                .get(&chapter)
                .filter(|key| self.act_places().iter().any(|p| &p.key == *key && self.upbringing_place_open(p)))
                .cloned()
                .or_else(|| {
                    def.chapter(&chapter).and_then(|c| {
                        self.act_places()
                            .iter()
                            .filter(|p| !c.venue.is_empty() && p.venue == c.venue && self.upbringing_place_open(p))
                            .min_by_key(|p| &p.key)
                            .map(|p| p.key.clone())
                    })
                })
                .or(person_place)
                .or_else(|| self.act_home_place().map(str::to_owned));
            let Some(place) = place else { continue };
            if let Some(mut m) = old.clone().filter(|m| m.hanging(week)) {
                m.place = place;
                if let Some(deadline) = self.act_marker_deadline(&track) {
                    m.expires_week = m.expires_week.min(week_index(&self.defs, deadline));
                }
                if let Some(s) = &mut self.state.upbringing {
                    s.act.markers.insert(track, m);
                }
                continue;
            }
            if !hang {
                continue;
            }
            let weeks = self.act_rules().map_or(4, |r| r.marker.weeks);
            let entered = state.map_or(self.day(), |s| s.entered);
            let deadline = def.chapter(&chapter).and_then(|c| self.upbringing_event_deadline(&track, c, entered));
            let expires_week =
                deadline.map_or(week + weeks - 1, |day| (week + weeks - 1).min(week_index(&self.defs, day)));
            let m = MarkerState {
                chapter: chapter.clone(),
                place,
                person: Some(index.person),
                since_week: week,
                expires_week,
                key: index.chapters.get(&chapter).copied().unwrap_or(false),
                missed: old.map_or(0, |m| m.missed),
                ..Default::default()
            };
            if let Some(s) = &mut self.state.upbringing {
                s.cadence.scheduled.remove(&track);
                s.cadence.deferred.remove(&track);
                s.act.markers.insert(track, m);
            }
        }
    }
    pub(super) fn act_expire_markers(&mut self) {
        if self.act_sailing() {
            return;
        }
        let Some(s) = &self.state.upbringing else { return };
        let week = s.act.week;
        let expired: Vec<_> = s
            .act
            .markers
            .iter()
            .filter(|(key, m)| self.act_marker_visible(key) && m.expires_week == week)
            .map(|(k, m)| (k.clone(), m.clone()))
            .collect();
        let r = self.act_rules().cloned().unwrap_or_default();
        for (key, mut m) in expired {
            if m.key {
                let next = crate::scenario::day_of(&self.defs, self.act_week_date(week + 1, false)).ok();
                let focus = self.upbringing_cadence_rules().map_or(3, |r| r.focus_day);
                let deadline = self.act_marker_chapter_deadline(&key);
                if let Some(day) = next
                    && deadline.is_none_or(|end| day + u32::from(focus) - 1 <= end)
                    && let Some(s) = &mut self.state.upbringing
                {
                    s.act.due.insert(key.clone(), day + u32::from(focus) - 1);
                    s.act.markers.remove(&key);
                }
            } else {
                m.missed = m.missed.saturating_add(1);
                m.cooldown_until = week + r.marker.missed_cooldown_weeks;
                let entered = self.state.story2.tracks.get(&key).map_or(self.day(), |s| s.entered);
                let deadline = self
                    .defs
                    .story2
                    .track(&key)
                    .and_then(|t| t.chapter(&m.chapter))
                    .and_then(|c| self.upbringing_event_deadline(&key, c, entered));
                let cooldown = crate::scenario::day_of(&self.defs, self.act_week_date(m.cooldown_until, false)).ok();
                m.retired = m.missed > r.marker.rehang || deadline.zip(cooldown).is_some_and(|(a, b)| a < b);
                if let Some(s) = &mut self.state.upbringing {
                    s.act.markers.insert(key, m);
                }
            }
        }
    }
    pub(crate) fn act_force_due(&mut self) {
        if !self.act_running() {
            return;
        }
        let due = self.state.upbringing.as_ref().map(|s| s.act.due.clone()).unwrap_or_default();
        let Some(r) = self.upbringing_cadence_rules().cloned() else { return };
        for (key, day) in due {
            self.schedule_cadence_event(&key, day);
            if let Some(s) = &mut self.state.upbringing {
                s.act.due.remove(&key);
                s.cadence.used[0] = s.cadence.used[0].min(r.focus_per_week);
                s.cadence.used[1] =
                    s.cadence.used[1].min(r.short_per_week.min(r.total_per_week.saturating_sub(s.cadence.used[0])));
            }
        }
    }
}
