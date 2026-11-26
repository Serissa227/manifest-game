//! 每旬一个重点、一封来信；普通短事件按世界规则安排，限时短事件每旬照常。未选中者延后。
use super::*;
use crate::{
    World,
    story2::{ChapterDef, Condition, Status, TrackKind, TrackState},
};

/// 同一事件的直接续章：没有自己的日期、等待、季节条件，也不带窗口或期限（U03 / A5）。
pub(super) fn direct_continuation(c: &ChapterDef) -> bool {
    c.window.is_none()
        && c.deadline.is_none()
        && c.deadline_days.is_none()
        && !c
            .when
            .iter()
            .any(|w| matches!(w, Condition::Date { .. } | Condition::Wait { .. } | Condition::Season { .. }))
}

/// 日常池轨道的文化区：`c9_pool_<文化>_daily_*` / `c9_pool_<文化>_festival_*`。
pub(super) fn pool_region(key: &str) -> Option<&str> {
    let rest = key.strip_prefix("c9_pool_")?;
    let end = rest.find("_daily_").or_else(|| rest.find("_festival_"))?;
    Some(&rest[..end])
}

/// 新闻与书信占单独的来信位。
pub(crate) fn is_letter(key: &str) -> bool {
    key.contains("_news_") || key.contains("_letter_") || key.ends_with("_letters")
}

/// 旬配额的位：0 重点（不是短事件的轨道）、1 短事件、2 来信。旬调度与节奏分类（`pacing`）共用。
pub(crate) fn event_slot(kind: TrackKind, key: &str) -> u8 {
    if super::cadence::is_guide(kind) {
        u8::MAX
    } else if kind != TrackKind::Encounter {
        0
    } else if is_letter(key) {
        2
    } else {
        1
    }
}

/// 普通短事件：占短事件位、不是限时档、也没有截止日。只在世界规则的普通窗口放行，其余旬留在候选里。
pub(crate) fn ordinary_event(slot: u8, tier: EventTier, deadline: Option<u32>) -> bool {
    slot == 1 && tier != EventTier::Timed && deadline.is_none()
}

/// 候选章节的排序依据（旬调度与节奏分类共用）。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct EventRank {
    /// 正处在心情低谷里的低谷事件。
    pub low_mood: bool,
    /// 截止日；没有为 None。
    pub deadline: Option<u32>,
    pub tier: EventTier,
}

/// 档次推断（U03 / A5）：门槛显式写了 tier 就用它；否则按 key——日常池与占位是填充，稀有、第一次、征兆是特别，
/// 节庆、生日、家人羁绊、校历、书信、新闻、关键事件是限时；其余有截止日的算限时，没有的算特别。
pub fn infer_event_tier(key: &str, gate: Option<&EventGate>, has_deadline: bool) -> EventTier {
    if let Some(t) = gate.and_then(|g| g.tier) {
        return t;
    }
    if key.starts_with("c9_pool_") || key.contains("_daily_") || key.ends_with("_placeholder") {
        EventTier::Filler
    } else if ["_rare_", "_first_", "_omen_"].iter().any(|p| key.contains(p)) {
        EventTier::Special
    } else if ["_festival_", "_birthday_", "_family_bond_", "_calendar_", "_critical_"].iter().any(|p| key.contains(p))
        || key.starts_with("c9_academy_")
        || is_letter(key)
        || has_deadline
    {
        EventTier::Timed
    } else {
        EventTier::Special
    }
}
impl World {
    pub(crate) fn upbringing_story_allowed(&self, track: &str) -> bool {
        if !self.upbringing_event_gate(track) {
            return false;
        }
        // 养成进行中只放行学院轨道、显式标了 upbringing 的轨道，以及养成调度自己排进来的短事件；
        // 主线的传说之船、结社接触等等到结业（U03 / A2）。
        if self.upbringing_active()
            && self.defs.story2.track(track).is_some_and(|t| !t.academy && !t.upbringing)
            && self.state.upbringing.as_ref().is_none_or(|s| !s.activity_tracks.contains(track))
        {
            return false;
        }
        if self.state.upbringing.as_ref().is_some_and(|s| s.skipping)
            && self.defs.story2.track(track).is_some_and(|t| t.academy)
        {
            return false;
        }
        self.state.upbringing.as_ref().is_none_or(|s| {
            !self.upbringing_active() || !s.activity_tracks.contains(track) || s.event_permits.contains(track)
        })
    }
    /// 轨道此刻停在的章节是不是上一章的直接续章：还没结算过，也不带新的日期条件或期限。
    /// 结算后保留出场许可与节奏分类（`pacing`）共用这一个判断。
    pub(crate) fn upbringing_direct_continuation(&self, track: &str) -> bool {
        self.state
            .story2
            .tracks
            .get(track)
            // 回到已经结算过的章节（可重复事件的循环）不算续章。
            .filter(|s| s.status == Status::Active && !s.visited.contains(&s.chapter))
            .and_then(|s| self.defs.story2.track(track)?.chapter(&s.chapter))
            .is_some_and(direct_continuation)
    }
    pub(crate) fn upbringing_story_settled(&mut self, track: &str) {
        self.settle_cadence_event(track);
        // 同一事件的直接续章当场接着出，不收回本旬的出场许可；带新日期条件或期限的下一段才重新排队。
        if self.upbringing_direct_continuation(track) {
            return;
        }
        if let Some(s) = &mut self.state.upbringing {
            s.event_permits.remove(track);
        }
    }
    /// 候选章节的档次与截止日；心情低谷事件（U04 工作包 3）当作今天截止的限时事件。
    pub(crate) fn upbringing_event_rank(&self, key: &str, c: &ChapterDef, entered: u32) -> EventRank {
        let low_mood = self.upbringing_low_mood_event(key);
        let deadline = if low_mood { Some(self.day()) } else { self.upbringing_event_deadline(key, c, entered) };
        let tier = if low_mood {
            EventTier::Timed
        } else {
            infer_event_tier(key, self.defs.upbringing.event_gates.get(key), deadline.is_some())
        };
        EventRank { low_mood, deadline, tier }
    }
    /// 候选章节的截止日：章节日期条件的止日、窗口、期限，节日窗口的末日，依赖最近一旬活动的当天；没有为 None。
    pub(crate) fn upbringing_event_deadline(&self, key: &str, c: &ChapterDef, entered: u32) -> Option<u32> {
        let day = |d: WorldDate| crate::scenario::day_of(&self.defs, d).ok();
        let mut out: Option<u32> = None;
        let mut take = |d: Option<u32>| {
            if let Some(d) = d {
                out = Some(out.map_or(d, |o| o.min(d)));
            }
        };
        for w in &c.when {
            if let Condition::Date { to: Some(to), .. } = w {
                take(day(*to));
            }
        }
        take(c.window.and_then(|w| day(w[1])));
        take(self.story2_deadline(c, entered));
        if let Some(g) = self.defs.upbringing.event_gates.get(key) {
            if g.activity.is_some() && !self.upbringing_cadence_enabled() {
                take(Some(self.day()));
            }
            if let Some(f) = &g.festival {
                let hi = g.festival_window_days.unwrap_or([0, 0])[1];
                let today = i64::from(self.day());
                take(
                    self.defs
                        .upbringing
                        .festivals
                        .iter()
                        .filter(|x| &x.key == f)
                        .flat_map(|x| &x.dates)
                        .filter_map(|d| day(*d))
                        .map(|d| i64::from(d) + hi)
                        .filter(|end| *end >= today)
                        .min()
                        .and_then(|d| u32::try_from(d).ok()),
                );
            }
        }
        out
    }
    pub(crate) fn queue_upbringing_events(&mut self) {
        if self.upbringing_cadence_enabled() {
            self.queue_cadence_events();
            return;
        }
        let Some(s) = self.state.upbringing.as_ref() else { return };
        if s.skipping || s.event_day != Some(self.day()) {
            return;
        }
        let patterns = s.event_backlog.clone();
        let date = self.cast_date();
        // 随机流的序号：按旬是刚结算的那一旬；按周（U05）排期与结算脱钩，按日期所在的旬取同样的序号。
        let index = if self.upbringing_weekly() {
            super::schedule::slot_of(date[2]).saturating_sub(1)
        } else {
            s.next_slot.saturating_sub(1)
        };
        let ordinary_window = if self.defs.rules.upbringing.monthly_ordinary_events {
            date[2] == 21
        } else {
            let calendar_slot = u64::from(self.defs.calendar.month_index(self.day())) * 3
                + u64::from(super::schedule::slot_of(date[2]));
            !calendar_slot.is_multiple_of(2)
        };
        let mut keys = self
            .defs
            .story2
            .tracks
            .iter()
            .filter(|t| patterns.iter().any(|p| super::activity_validation::event_matches(p, &t.key)))
            .map(|t| t.key.clone())
            .collect::<BTreeSet<_>>();
        keys.extend(s.activity_tracks.iter().cloned());
        keys.extend(self.defs.upbringing.event_gates.keys().cloned());
        // 节奏的闸（P11）按着、还没出场的轨道：上一旬已经入选过，许可留着（见下），这一旬不再占一个新名额。
        let held: BTreeSet<String> = if self.pacing_active() {
            self.state
                .pacing
                .held
                .iter()
                .filter(|(key, h)| {
                    s.event_permits.contains(*key)
                        && self.state.story2.tracks.get(*key).is_some_and(|t| {
                            t.status == Status::Active && t.chapter == h.chapter && t.entered == h.entered
                        })
                })
                .map(|(key, _)| key.clone())
                .collect()
        } else {
            BTreeSet::new()
        };
        let mut pending = Vec::new();
        let mut remove = BTreeSet::new();
        for key in &keys {
            let Some(t) = self.defs.story2.track(key) else {
                remove.insert(key.clone());
                continue;
            };
            if super::cadence::is_guide(t.kind) || held.contains(key) {
                continue;
            }
            if !self.upbringing_event_gate(key) {
                continue;
            }
            let state = self.state.story2.tracks.get(key);
            let repeat = self.defs.upbringing.event_gates.contains_key(key)
                && t.chapter(&t.start).is_some_and(|c| !c.once && self.story2_cooled(c));
            if !repeat && state.is_some_and(|s| matches!(s.status, Status::Done | Status::Failed)) {
                remove.insert(key.clone());
                continue;
            }
            let restarting = repeat && state.is_some_and(|s| matches!(s.status, Status::Done | Status::Failed));
            let Some(c) =
                t.chapter(if restarting { &t.start } else { state.map_or(t.start.as_str(), |s| s.chapter.as_str()) })
            else {
                continue;
            };
            let entered = state.map_or(self.day(), |s| s.entered);
            if !self.story2_chapter_available(c, entered)
                || (c.once && state.is_some_and(|s| s.visited.contains(&c.key)))
                || (!c.once
                    && !c.variants.is_empty()
                    && !c.variants.iter().any(|v| {
                        self.story2_conditions(&v.when, entered)
                            && !self.state.story2.variants_seen.contains(&(key.clone(), c.key.clone(), v.key.clone()))
                    }))
            {
                continue;
            }
            let encounter = t.kind == TrackKind::Encounter;
            let gate = self.defs.upbringing.event_gates.get(key);
            let slot = event_slot(t.kind, key);
            // 心情低谷事件（U04 工作包 3）：当作今天截止的限时事件，排在本旬最前。
            let EventRank { low_mood, deadline, tier } = self.upbringing_event_rank(key, c, entered);
            // 被延后的普通候选仍留在队列，也占用原有排序随机数。
            let defer_ordinary = !ordinary_window && ordinary_event(slot, tier, deadline);
            if tier == EventTier::Filler {
                // 日常池同一事件 365 天内不重复；同一文化区的日常每月最多一个。
                let month = [date[0], date[1]];
                let this_month = |d: u32| {
                    let date = self.defs.calendar.date_of(d);
                    [(self.defs.rules.world.start_year + i64::from(date.year) - 1) as u32, date.month] == month
                };
                if s.filler_seen.get(key).is_some_and(|d| self.day().saturating_sub(*d) < 365)
                    || pool_region(key)
                        .is_some_and(|r| s.filler_seen.iter().any(|(k, d)| pool_region(k) == Some(r) && this_month(*d)))
                {
                    continue;
                }
            }
            // 支线（不是关键事件的重点轨道）下一章排在距上一章至少两旬之后。
            if !encounter
                && !key.contains("_critical_")
                && state.is_some_and(|s| s.status == Status::Active && s.chapter != t.start)
                && self.day().saturating_sub(entered) < 20
            {
                continue;
            }
            let from = gate.and_then(|g| g.from).and_then(|d| crate::scenario::day_of(&self.defs, d).ok()).unwrap_or(0);
            // 限时档先分三类：心情低谷最前；其次只出一次的（节庆、家人羁绊、生日等，错过就没了）；
            // 最后是可重复的（打工成败的后续等，截止日虽是当天，下回做同一件事还会再来）。类内照旧按截止日。
            let urgency: u8 = if low_mood {
                0
            } else if c.once {
                1
            } else {
                2
            };
            pending.push((slot, tier, urgency, deadline.unwrap_or(u32::MAX), from, key.clone(), defer_ordinary));
        }
        // 先按 key 固定候选顺序，再用本旬随机流给每个候选一个抖动值；限时档按类别、截止日、开始日排，其余档按抖动排。
        pending.sort_by(|a, b| a.5.cmp(&b.5));
        let mut rng = self.upbringing_rng("activity_events", index, 0);
        let mut ranked: Vec<_> = pending
            .iter()
            .filter_map(|(slot, tier, urgency, deadline, from, key, deferred)| {
                let jitter = rng.below(1 << 20);
                let order =
                    if *tier == EventTier::Timed { (*urgency, *deadline, *from, jitter) } else { (0, 0, 0, jitter) };
                if *deferred { None } else { Some((*slot, *tier, order, key.clone())) }
            })
            .collect();
        ranked.sort();
        let mut selected = Vec::new();
        for slot in [0u8, 1, 2] {
            if let Some(best) = ranked.iter().find(|r| r.0 == slot) {
                selected.push(best.3.clone());
            }
        }
        let fillers: Vec<String> = ranked
            .iter()
            .filter(|r| r.1 == EventTier::Filler && selected.contains(&r.3))
            .map(|r| r.3.clone())
            .collect();
        for key in &selected {
            if let Some(t) = self.defs.story2.track(key) {
                let state = self.state.story2.tracks.entry(key.clone()).or_insert_with(|| TrackState {
                    chapter: t.start.clone(),
                    visited: BTreeSet::new(),
                    entered: self.state.day,
                    status: Status::Active,
                    failure: None,
                });
                if self.defs.upbringing.event_gates.contains_key(key)
                    && matches!(state.status, Status::Done | Status::Failed)
                {
                    state.chapter = t.start.clone();
                    state.entered = self.state.day;
                    state.failure = None;
                }
                state.status = Status::Active;
            }
        }
        if let Some(s) = &mut self.state.upbringing {
            s.event_day = None;
            s.event_backlog = keys.difference(&remove).cloned().collect();
            s.activity_tracks.retain(|key| !remove.contains(key));
            s.activity_tracks.extend(selected.iter().cloned());
            // 许可每旬整体替换；被闸按着的那些接着留用，否则过了旬界它就不再是候选、内容白白丢掉。
            s.event_permits = selected.into_iter().chain(held).collect();
            let today = self.state.day;
            for key in fillers {
                s.filler_seen.insert(key, today);
            }
        }
    }
}
