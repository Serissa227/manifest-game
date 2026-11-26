//! U06a：周首预排、活动补排、出场冷却；旧排期只在入口处分流。
use super::*;
use crate::{
    StaticData, World,
    story2::{ChapterDef, Status, TrackKind, TrackState},
};

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CadenceRules {
    pub enabled: bool,
    pub focus_per_week: u8,
    pub short_per_week: u8,
    pub total_per_week: u8,
    pub focus_day: u8,
    pub short_day: u8,
    pub cooldown_weeks: u32,
    pub category_gap_weeks: u32,
    pub chain_gap_weeks: u32,
    pub defer_weeks: u32,
    pub excursions_per_week: u8,
    pub excursions_per_4_weeks: u8,
    pub outing_every_weeks: u32,
    pub weekly_mood: bool,
}
impl Default for CadenceRules {
    fn default() -> Self {
        Self {
            enabled: true,
            focus_per_week: 1,
            short_per_week: 1,
            total_per_week: 2,
            focus_day: 3,
            short_day: 5,
            cooldown_weeks: 26,
            category_gap_weeks: 6,
            chain_gap_weeks: 3,
            defer_weeks: 4,
            excursions_per_week: 1,
            excursions_per_4_weeks: 3,
            outing_every_weeks: 2,
            weekly_mood: true,
        }
    }
}
impl CadenceRules {
    pub fn problems(&self) -> Vec<String> {
        let mut out = Vec::new();
        if [
            self.focus_per_week,
            self.short_per_week,
            self.total_per_week,
            self.excursions_per_week,
            self.excursions_per_4_weeks,
        ]
        .contains(&0)
            || [
                self.cooldown_weeks,
                self.category_gap_weeks,
                self.chain_gap_weeks,
                self.defer_weeks,
                self.outing_every_weeks,
            ]
            .contains(&0)
            || self.total_per_week < self.focus_per_week.max(self.short_per_week)
            || !(1..=7).contains(&self.focus_day)
            || !(1..=7).contains(&self.short_day)
        {
            out.push("upbringing.cadence：数值须为正，出场日在 1–7，总预算不小于任一分位预算".into());
        }
        out
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Deferred {
    pub since_week: u32,
    pub droppable: bool,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct CadenceState {
    pub last_seen: BTreeMap<String, u32>,
    pub category_seen: BTreeMap<String, u32>,
    pub scheduled: BTreeMap<String, u32>,
    pub deferred: BTreeMap<String, Deferred>,
    pub used: [u8; 2],
    pub week: u32,
    pub excursion_weeks: Vec<u32>,
    pub last_outing_week: Option<u32>,
    /// 已在周首接入新节奏；区分第零周与读入的空旧档。
    #[serde(skip_serializing_if = "super::is_false")]
    pub on: bool,
}
impl CadenceState {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

/// 月内四周，跨年不归零；冷却按实际日数与该周序取严。
pub fn week_index(defs: &StaticData, day: u32) -> u32 {
    defs.calendar
        .month_index(day)
        .saturating_mul(4)
        .saturating_add(u32::from(weekly::week_of(defs.calendar.date_of(day).day)))
}
pub(super) fn week_limits(defs: &StaticData, day: u32) -> [u32; 2] {
    let date = defs.calendar.date_of(day);
    let [lo, hi] = weekly::week_bounds(defs.calendar.month_days(day), weekly::week_of(date.day));
    [day.saturating_sub(date.day - lo), day.saturating_add(hi - date.day)]
}
pub(super) fn next_week_start(defs: &StaticData, day: u32) -> u32 {
    let [first, last] = week_limits(defs, day);
    if day == first { first } else { last.saturating_add(1) }
}
pub fn infer_event_category<'a>(key: &str, gate: Option<&'a EventGate>) -> &'a str {
    if let Some(c) = gate.and_then(|g| g.category.as_deref()) {
        return c;
    }
    if key.starts_with("c9_pool_") {
        if key.contains("_daily_") {
            return "daily";
        }
        if key.contains("_festival_") {
            return "festival_pool";
        }
    }
    if gate.is_some_and(|g| g.activity.is_some()) {
        return "job_followup";
    }
    for (pattern, category) in [
        ("_low_mood_", "low_mood"),
        ("_illness_", "illness"),
        ("_critical_", "critical"),
        ("_festival_", "festival"),
        ("_birthday_", "birthday"),
        ("_family_bond_", "family_bond"),
        ("_calendar_", "calendar"),
        ("_rare_", "rare"),
        ("_first_", "first"),
        ("_omen_", "omen"),
        ("_news_", "news"),
        ("_letter_", "letter"),
        ("_side_", "side"),
        ("_rw_", "bond_web"),
    ] {
        if key.contains(pattern) {
            return category;
        }
    }
    if key.starts_with("c9_academy_") {
        "academy"
    } else if key.starts_with("c8_school_") {
        "school"
    } else if key.ends_with("_placeholder") {
        "placeholder"
    } else {
        "other"
    }
}
/// Q01 在既有四种之后追加 guide；这些轨道不能进入三个位。
pub(super) fn is_guide(kind: TrackKind) -> bool {
    !matches!(kind, TrackKind::Main | TrackKind::History | TrackKind::Request | TrackKind::Encounter)
}
fn budget_slot(kind: TrackKind) -> usize {
    usize::from(kind == TrackKind::Encounter)
}
fn date_of(defs: &StaticData, day: u32) -> WorldDate {
    let d = defs.calendar.date_of(day);
    [(defs.rules.world.start_year + i64::from(d.year) - 1) as u32, d.month, d.day]
}

/// 固定日期入口：同一轨道只记首次开始；节庆模式另由周预算展开。
pub(super) fn dated_events(defs: &StaticData, family: &FamilyDef) -> BTreeMap<String, u32> {
    let mut events = BTreeMap::new();
    let start = defs
        .scenarios
        .iter()
        .find(|s| s.key == family.scenario)
        .map(|s| s.start_date)
        .or_else(|| family.stages.first().map(|s| s.from))
        .unwrap_or(family.graduation);
    let mut add = |key: Option<&String>, date: WorldDate| {
        if let (Some(key), Ok(day)) = (key, crate::scenario::day_of(defs, date.max(start)))
            && defs.story2.track(key).is_some_and(|t| !is_guide(t.kind))
        {
            events.entry(key.clone()).and_modify(|d: &mut u32| *d = (*d).min(day)).or_insert(day);
        }
    };
    for (i, s) in family.stages.iter().enumerate() {
        add(s.entry_event.as_ref(), s.from);
        if let Some(a) = s.academy.as_deref().and_then(|k| defs.upbringing.academy(k)) {
            let until = family.stages.get(i + 1).map_or(family.graduation, |s| s.from);
            for m in a.calendar.iter().filter(|m| s.from <= m.date && m.date < until) {
                add(m.event.as_ref(), m.date);
            }
        }
    }
    for f in &defs.upbringing.festivals {
        for d in &f.dates {
            let stage = family.stages.iter().rev().find(|s| s.from <= *d);
            let culture = stage
                .and_then(|s| s.academy.as_deref())
                .and_then(|k| defs.upbringing.academy(k))
                .map(|a| a.culture.as_str())
                .filter(|c| !c.is_empty())
                .or_else(|| {
                    stage.and_then(|s| defs.locations.iter().find(|l| l.key == s.at)).map(|l| l.culture.as_str())
                });
            if *d >= start
                && *d <= family.graduation
                && culture.is_some_and(|c| {
                    f.cultures.iter().any(|k| {
                        k == c || defs.upbringing.culture_aliases.get(k).is_some_and(|v| v.iter().any(|a| a == c))
                    })
                })
            {
                for e in f.event.iter().chain(&f.events).filter(|e| !e.contains('*')) {
                    add(Some(e), *d);
                }
            }
        }
    }
    if let Some(c) = &family.completion {
        add(c.event.as_ref(), family.graduation);
        let ceremony = family
            .stages
            .iter()
            .rev()
            .find_map(|s| s.academy.as_deref())
            .and_then(|k| defs.upbringing.academy(k))
            .and_then(|a| a.graduation.as_ref());
        if let Some(g) = ceremony {
            add(c.family_event.as_ref(), g.date);
        }
        add(c.choose_event.as_ref(), [family.born[0].saturating_add(c.choose_age), family.born[1], family.born[2]]);
    }
    events
}

/// 节庆通配入口的静态日期窗口；只展开本家庭路线当时所在的文化。
fn festival_windows(defs: &StaticData, family: &FamilyDef, key: &str) -> Vec<[u32; 2]> {
    let gate = defs.upbringing.event_gates.get(key);
    let [lo, hi] = gate.and_then(|g| g.festival_window_days).unwrap_or([0, 0]);
    let mut out = Vec::new();
    for f in &defs.upbringing.festivals {
        if gate.and_then(|g| g.festival.as_ref()).is_some_and(|k| k != &f.key)
            || !f
                .event
                .iter()
                .chain(&f.events)
                .any(|p| p.contains('*') && super::activity_validation::event_matches(p, key))
        {
            continue;
        }
        for date in &f.dates {
            let stage = family.stages.iter().rev().find(|s| s.from <= *date);
            let culture = stage
                .and_then(|s| s.academy.as_deref())
                .and_then(|k| defs.upbringing.academy(k))
                .map(|a| a.culture.as_str())
                .filter(|c| !c.is_empty())
                .or_else(|| {
                    stage.and_then(|s| defs.locations.iter().find(|l| l.key == s.at)).map(|l| l.culture.as_str())
                });
            if !culture.is_some_and(|c| {
                f.cultures
                    .iter()
                    .any(|k| k == c || defs.upbringing.culture_aliases.get(k).is_some_and(|v| v.iter().any(|a| a == c)))
            }) {
                continue;
            }
            if let Ok(day) = crate::scenario::day_of(defs, *date)
                && let (Ok(a), Ok(b)) = (u32::try_from(i64::from(day) + lo), u32::try_from(i64::from(day) + hi))
            {
                out.push([a, b]);
            }
        }
    }
    out
}

#[derive(Clone)]
struct Candidate {
    key: String,
    day: u32,
    slot: usize,
    low_mood: bool,
    deadline: Option<u32>,
    deferred: Option<u32>,
    once: bool,
    tier: EventTier,
    from: u32,
}

impl World {
    pub fn upbringing_cadence_rules(&self) -> Option<&CadenceRules> {
        self.defs.rules.upbringing.cadence.as_ref().filter(|r| r.enabled)
    }
    pub fn upbringing_cadence_enabled(&self) -> bool {
        self.upbringing_active()
            && self.upbringing_weekly()
            && self.upbringing_cadence_rules().is_some()
            && self
                .state
                .upbringing
                .as_ref()
                .is_some_and(|s| s.cadence.on && s.cadence.week == week_index(&self.defs, self.day()))
    }
    fn cadence_dated(&self) -> BTreeMap<String, u32> {
        let Some(family) = self.upbringing_family() else { return BTreeMap::new() };
        let first = week_limits(&self.defs, self.day())[0];
        dated_events(&self.defs, family)
            .into_iter()
            .filter(|(key, _)| {
                let completed = self
                    .state
                    .story2
                    .tracks
                    .get(key)
                    .is_some_and(|s| s.entered < first && matches!(s.status, Status::Done | Status::Failed));
                let chosen = self.state.upbringing.as_ref().is_some_and(|s| s.path.is_some())
                    && family.completion.as_ref().and_then(|c| c.choose_event.as_ref()) == Some(key);
                !(completed || chosen)
            })
            .collect()
    }
    pub(crate) fn prepare_cadence_week(&mut self) {
        if !self.upbringing_active()
            || !self.upbringing_weekly()
            || self.upbringing_cadence_rules().is_none()
            || self.upbringing_skipping()
        {
            return;
        }
        let week = week_index(&self.defs, self.day());
        let first = week_limits(&self.defs, self.day())[0];
        let dated = self.cadence_dated();
        let Some(r) = self.upbringing_cadence_rules().cloned() else { return };
        let mut used = [0u8; 2];
        for (key, day) in dated {
            if week_index(&self.defs, day) != week {
                continue;
            }
            let Some(t) = self.defs.story2.track(&key) else { continue };
            // 本周已经出场的直接事件仍占位；提前由其他入口结算过的则不再预留。
            if self
                .state
                .story2
                .tracks
                .get(&key)
                .is_some_and(|s| s.entered < first && matches!(s.status, Status::Done | Status::Failed))
            {
                continue;
            }
            let slot = budget_slot(t.kind);
            used[slot] = used[slot].saturating_add(1);
        }
        let keys: Vec<_> = self
            .defs
            .upbringing
            .event_gates
            .keys()
            .filter(|k| self.defs.story2.track(k).is_some_and(|t| !is_guide(t.kind)))
            .cloned()
            .collect();
        let continuations: BTreeSet<_> = self
            .state
            .upbringing
            .as_ref()
            .map(|s| s.event_permits.iter().filter(|key| self.upbringing_direct_continuation(key)).cloned().collect())
            .unwrap_or_default();
        if let Some(s) = &mut self.state.upbringing {
            s.cadence.week = week;
            s.cadence.on = true;
            // 按日期直接出场的超额不能阻止出场；计数封顶，后续候选无剩余预算。
            let overflow = used[0] > r.focus_per_week
                || used[1] > r.short_per_week
                || u16::from(used[0]) + u16::from(used[1]) > u16::from(r.total_per_week);
            s.cadence.used = if overflow {
                [r.focus_per_week, r.short_per_week.min(r.total_per_week.saturating_sub(r.focus_per_week))]
            } else {
                [used[0].min(r.focus_per_week), used[1].min(r.short_per_week)]
            };
            s.cadence.scheduled.retain(|_, d| *d >= first);
            s.event_permits = continuations;
            s.activity_tracks.extend(keys);
        }
        self.act_force_due();
    }
    pub(crate) fn permit_cadence_dated_event(&mut self, key: &str) {
        if self.upbringing_cadence_enabled()
            && let Some(s) = &mut self.state.upbringing
        {
            s.event_permits.insert(key.into());
            s.cadence.scheduled.remove(key);
        }
    }
    fn cadence_room(&self, slot: usize) -> bool {
        let Some(r) = self.upbringing_cadence_rules() else { return false };
        let Some(s) = &self.state.upbringing else { return false };
        let used = s.cadence.used;
        used[slot] < [r.focus_per_week, r.short_per_week][slot]
            && u16::from(used[0]) + u16::from(used[1]) < u16::from(r.total_per_week)
    }
    fn cadence_repeat(&self, key: &str) -> bool {
        self.defs.upbringing.event_gates.contains_key(key)
            && self.defs.story2.track(key).and_then(|t| t.chapter(&t.start)).is_some_and(|c| !c.once)
    }
    fn cadence_cooled(&self, key: &str) -> [bool; 2] {
        if !self.cadence_repeat(key) {
            return [true; 2];
        }
        let Some(r) = self.upbringing_cadence_rules() else { return [true; 2] };
        let Some(s) = &self.state.upbringing else { return [true; 2] };
        let gate = self.defs.upbringing.event_gates.get(key);
        let cooldown = gate.and_then(|g| g.cooldown_weeks).unwrap_or(r.cooldown_weeks);
        let category = infer_event_category(key, gate);
        let week = week_index(&self.defs, self.day());
        // 月末零头不折成额外一周：同时满足实际七日与四周月历，保持四年八次的上界。
        let elapsed = |day: u32, weeks: u32| {
            self.day().saturating_sub(day) >= weeks.saturating_mul(7)
                && week.saturating_sub(week_index(&self.defs, day)) >= weeks
        };
        [
            s.cadence.last_seen.get(key).is_none_or(|d| elapsed(*d, cooldown)),
            s.cadence.category_seen.get(category).is_none_or(|d| elapsed(*d, r.category_gap_weeks)),
        ]
    }
    fn cadence_chapter(&self, key: &str) -> Option<(&ChapterDef, u32)> {
        let t = self.defs.story2.track(key)?;
        if is_guide(t.kind) || !self.protagonist_track_allowed(key) {
            return None;
        }
        let state = self.state.story2.tracks.get(key);
        let restart = state.is_some_and(|s| matches!(s.status, Status::Done | Status::Failed));
        if restart && !self.cadence_repeat(key) {
            return None;
        }
        let c = t.chapter(if restart { &t.start } else { state.map_or(t.start.as_str(), |s| s.chapter.as_str()) })?;
        let entered = if restart { self.day() } else { state.map_or(self.day(), |s| s.entered) };
        Some((c, entered))
    }
    /// 排期与逐日对照共用的前置块：轨道资格、活动触发、事件闸和两项冷却。
    pub fn cadence_candidate_chapter(&self, key: &str, triggered: bool) -> Option<(&ChapterDef, u32)> {
        let (c, entered) = self.cadence_chapter(key)?;
        let s = self.state.upbringing.as_ref()?;
        let frozen = s.cadence.deferred.contains_key(key);
        if self.defs.upbringing.event_gates.get(key).is_some_and(|g| g.activity.is_some()) && !frozen && !triggered {
            return None;
        }
        if !self.upbringing_event_gate(key) || self.cadence_cooled(key).contains(&false) {
            return None;
        }
        Some((c, entered))
    }
    /// 当前日期的排期候选；与标记及逐日候选等价检查共用真实判定。
    pub fn cadence_candidate_now(&self, key: &str, triggered: bool) -> bool {
        let Some((c, entered)) = self.cadence_candidate_chapter(key, triggered) else { return false };
        let Some(t) = self.defs.story2.track(key) else { return false };
        let Some(s) = &self.state.upbringing else { return false };
        // 选项全锁的章节出不了场（S02nZ5 起暂挂到有选项可选）：不排期、不挂标记，免得白占这一周的名额。
        if !self.story2_chapter_available_for(key, c, entered)
            || self.story2_choices_locked_for(key, c, entered)
            || (c.once && self.state.story2.tracks.get(key).is_some_and(|s| s.visited.contains(&c.key)))
            || (!c.once
                && !c.variants.is_empty()
                && !c.variants.iter().any(|v| {
                    self.story2_conditions(&v.when, entered)
                        && !self.state.story2.variants_seen.contains(&(key.into(), c.key.clone(), v.key.clone()))
                }))
        {
            return false;
        }
        if t.kind != TrackKind::Encounter
            && !key.contains("_critical_")
            && self.state.story2.tracks.get(key).is_some_and(|s| s.status == Status::Active && s.chapter != t.start)
            && self.day().saturating_sub(entered)
                < self.upbringing_cadence_rules().map_or(3, |r| r.chain_gap_weeks).saturating_mul(7)
        {
            return false;
        }
        if infer_event_tier(key, self.defs.upbringing.event_gates.get(key), false) == EventTier::Filler {
            let month = self.defs.calendar.month_index(self.day());
            if s.filler_seen.get(key).is_some_and(|d| self.day().saturating_sub(*d) < 365)
                || super::events::pool_region(key).is_some_and(|r| {
                    s.filler_seen.iter().any(|(k, d)| {
                        super::events::pool_region(k) == Some(r) && self.defs.calendar.month_index(*d) == month
                    })
                })
            {
                return false;
            }
        }
        true
    }
    /// 排期与标记共用这些条件；只读诊断逐条给出结果，不改候选的规则。
    pub fn cadence_candidate_checks(&self, key: &str, triggered: bool) -> BTreeMap<String, bool> {
        let mut checks = BTreeMap::new();
        let chapter = self.cadence_chapter(key);
        checks.insert("chapter_eligible".into(), chapter.is_some());
        let Some((c, entered)) = chapter else { return checks };
        let t = match self.defs.story2.track(key) {
            Some(t) => t,
            None => return checks,
        };
        checks.insert("upbringing".into(), self.state.upbringing.is_some());
        let s = match &self.state.upbringing {
            Some(s) => s,
            None => return checks,
        };
        let frozen = s.cadence.deferred.contains_key(key);
        checks.insert(
            "activity_trigger".into(),
            self.defs.upbringing.event_gates.get(key).is_none_or(|g| g.activity.is_none()) || frozen || triggered,
        );
        // 选项全锁的章节出不了场（S02nZ5 起暂挂到有选项可选）：不排期、不挂标记，免得白占这一周的名额。
        checks.insert("event_gate".into(), self.upbringing_event_gate(key));
        let [cooldown, category] = self.cadence_cooled(key);
        checks.insert("repeat_cooldown".into(), cooldown);
        checks.insert("category_gap".into(), category);
        // 与 story2_chapter_available 相同的分项；轨道推断也沿用原接口。
        let track = self.chapter_track(c, entered);
        checks.insert("chapter_available".into(), self.story2_chapter_available(c, entered));
        checks.insert("chapter_stage".into(), c.stage != Some(crate::story2::Stage::Rumor));
        checks.insert(
            "chapter_place".into(),
            self.state.agents.contains_key(&crate::OwnerId::Player)
                && c.at.as_ref().is_none_or(|at| {
                    self.cast_player_place().is_some_and(|p| {
                        self.defs.loc(p.loc).key == *at
                            && (p.venue.is_empty() || c.venue.is_empty() || p.venue == c.venue)
                    })
                }),
        );
        for (i, condition) in c.when.iter().enumerate() {
            checks.insert(
                format!("chapter_when.{i}"),
                self.story2_conditions_in(std::slice::from_ref(condition), entered, track),
            );
        }
        checks.insert("chapter_objectives".into(), self.story2_objectives_done_in(c, entered, track));
        checks.insert("family_cooldown".into(), self.story2_cooled(c));
        checks.insert("chapter_deadline".into(), self.story2_deadline(c, entered).is_none_or(|d| self.day() <= d));
        checks.insert(
            "chapter_window".into(),
            c.window.is_none_or(|w| w[0] <= self.cast_date() && self.cast_date() <= w[1]),
        );
        checks.insert("choices_open".into(), !self.story2_choices_locked(c, entered));
        checks.insert(
            "once_unvisited".into(),
            !c.once || !self.state.story2.tracks.get(key).is_some_and(|s| s.visited.contains(&c.key)),
        );
        checks.insert(
            "variant_unseen".into(),
            c.once
                || c.variants.is_empty()
                || c.variants.iter().any(|v| {
                    self.story2_conditions(&v.when, entered)
                        && !self.state.story2.variants_seen.contains(&(key.into(), c.key.clone(), v.key.clone()))
                }),
        );
        checks.insert(
            "chain_gap".into(),
            !(t.kind != TrackKind::Encounter
                && !key.contains("_critical_")
                && self
                    .state
                    .story2
                    .tracks
                    .get(key)
                    .is_some_and(|s| s.status == Status::Active && s.chapter != t.start)
                && self.day().saturating_sub(entered)
                    < self.upbringing_cadence_rules().map_or(3, |r| r.chain_gap_weeks).saturating_mul(7)),
        );
        let mut filler_year = true;
        let mut filler_month = true;
        if infer_event_tier(key, self.defs.upbringing.event_gates.get(key), false) == EventTier::Filler {
            let month = self.defs.calendar.month_index(self.day());
            filler_year = s.filler_seen.get(key).is_none_or(|d| self.day().saturating_sub(*d) >= 365);
            filler_month = !super::events::pool_region(key).is_some_and(|r| {
                s.filler_seen.iter().any(|(k, d)| {
                    super::events::pool_region(k) == Some(r) && self.defs.calendar.month_index(*d) == month
                })
            });
        }
        checks.insert("filler_year".into(), filler_year);
        checks.insert("filler_month".into(), filler_month);
        checks
    }
    /// 节庆的通配引用只能在对应文化的节庆窗口内展开；没有门槛窗口时就是节日当天。
    fn cadence_festival_window(&self, key: &str) -> Option<[u32; 2]> {
        let family = self.upbringing_family()?;
        festival_windows(&self.defs, family, key).into_iter().find(|[a, b]| *a <= self.day() && self.day() <= *b)
    }
    fn cadence_pattern_event(&self, key: &str) -> bool {
        self.defs.upbringing.festivals.iter().any(|f| {
            f.event
                .iter()
                .chain(&f.events)
                .any(|p| p.contains('*') && super::activity_validation::event_matches(p, key))
        })
    }
    fn cadence_reservation_conflict(&self, key: &str, day: u32) -> bool {
        let Some(s) = &self.state.upbringing else { return false };
        let gate = self.defs.upbringing.event_gates.get(key);
        let category = infer_event_category(key, gate);
        let family = self.cadence_chapter(key).and_then(|(c, _)| c.family.as_deref());
        s.cadence.scheduled.iter().any(|(k, d)| {
            if k == key {
                return true;
            }
            let category_conflict = self.cadence_repeat(key)
                && self.cadence_repeat(k)
                && infer_event_category(k, self.defs.upbringing.event_gates.get(k)) == category;
            let family_conflict =
                family.is_some() && self.cadence_chapter(k).and_then(|(c, _)| c.family.as_deref()) == family;
            let category_days = self.upbringing_cadence_rules().map_or(6, |r| r.category_gap_weeks).saturating_mul(7);
            let family_days = self
                .cadence_chapter(key)
                .map_or(0, |(c, _)| c.family_cooldown_days)
                .max(self.cadence_chapter(k).map_or(0, |(c, _)| c.family_cooldown_days));
            (category_conflict && day.abs_diff(*d) < category_days)
                || (family_conflict && day.abs_diff(*d) < family_days)
        })
    }
    pub(super) fn schedule_cadence_event(&mut self, key: &str, day: u32) {
        let Some(t) = self.defs.story2.track(key) else { return };
        let slot = budget_slot(t.kind);
        let entered = self.day();
        let state = self.state.story2.tracks.entry(key.into()).or_insert_with(|| TrackState {
            chapter: t.start.clone(),
            visited: BTreeSet::new(),
            entered,
            status: Status::Active,
            failure: None,
        });
        if matches!(state.status, Status::Done | Status::Failed) {
            state.chapter = t.start.clone();
            state.entered = entered;
            state.failure = None;
        }
        state.status = Status::Active;
        if let Some(s) = &mut self.state.upbringing {
            s.activity_tracks.insert(key.into());
            s.cadence.scheduled.insert(key.into(), day);
            s.cadence.used[slot] = s.cadence.used[slot].saturating_add(1);
        }
    }
    pub(crate) fn queue_cadence_events(&mut self) {
        if self.upbringing_skipping() {
            return;
        }
        let today = self.day();
        let week = week_index(&self.defs, today);
        if self.state.upbringing.as_ref().is_some_and(|s| s.event_day == Some(today)) {
            let Some(r) = self.upbringing_cadence_rules().cloned() else { return };
            let [first, last] = week_limits(&self.defs, today);
            let dated: BTreeSet<_> = self
                .cadence_dated()
                .into_iter()
                .filter(|(_, d)| week_index(&self.defs, *d) == week)
                .map(|(k, _)| k)
                .collect();
            let mut keys = BTreeSet::new();
            if let Some(s) = &self.state.upbringing {
                keys.extend(s.activity_tracks.iter().cloned());
                keys.extend(s.cadence.deferred.keys().cloned());
                keys.extend(self.defs.upbringing.event_gates.keys().cloned());
                for t in &self.defs.story2.tracks {
                    if s.event_backlog.iter().any(|p| super::activity_validation::event_matches(p, &t.key))
                        || self.cadence_pattern_event(&t.key)
                    {
                        keys.insert(t.key.clone());
                    }
                }
            }
            let deferred = self.state.upbringing.as_ref().map(|s| s.cadence.deferred.clone()).unwrap_or_default();
            // 每天只复制一次世界来预看本周窗口，避免对每条轨道复制整个状态。
            let mut probe = self.clone();
            for key in &keys {
                let Some(t) = self.defs.story2.track(key) else { continue };
                if self.state.story2.tracks.get(key).is_some_and(|s| matches!(s.status, Status::Done | Status::Failed))
                {
                    if self.cadence_repeat(key)
                        && let Some(s) = probe.state.story2.tracks.get_mut(key)
                    {
                        s.status = Status::Active;
                        s.chapter = t.start.clone();
                        s.entered = today;
                    }
                } else {
                    probe.state.story2.tracks.entry(key.clone()).or_insert_with(|| TrackState {
                        chapter: t.start.clone(),
                        visited: BTreeSet::new(),
                        entered: today,
                        status: Status::Active,
                        failure: None,
                    });
                }
            }
            let mut candidates = BTreeMap::<String, Candidate>::new();
            for day in today..=last {
                probe.state.day = day;
                probe.cadence_preview_place();
                for key in &keys {
                    if self.act_marker_reserved(key) {
                        continue;
                    }
                    if dated.contains(key) {
                        continue;
                    }
                    if self
                        .state
                        .upbringing
                        .as_ref()
                        .is_some_and(|s| s.cadence.scheduled.contains_key(key) || s.event_permits.contains(key))
                    {
                        continue;
                    }
                    if deferred
                        .get(key)
                        .is_some_and(|d| d.droppable && week.saturating_sub(d.since_week) >= r.defer_weeks)
                    {
                        continue;
                    }
                    // 已有门槛入口沿用自己的节庆条件；通配窗口只约束新补的入口。
                    let festival =
                        !probe.defs.upbringing.event_gates.contains_key(key) && probe.cadence_pattern_event(key);
                    let window = if festival { probe.cadence_festival_window(key) } else { None };
                    if festival && window.is_none() {
                        continue;
                    }
                    if !probe.cadence_candidate_now(key, false) {
                        continue;
                    }
                    let Some((c, entered)) = probe.cadence_chapter(key) else { continue };
                    let Some(t) = probe.defs.story2.track(key) else { continue };
                    let rank = probe.upbringing_event_rank(key, c, entered);
                    if rank.low_mood && day != today {
                        continue;
                    }
                    let deadline = rank.deadline.into_iter().chain(window.map(|w| w[1])).min();
                    let slot = budget_slot(t.kind);
                    let boundary_trigger = deferred.get(key).is_some_and(|d| d.since_week.saturating_add(1) == week)
                        && self
                            .state
                            .upbringing
                            .as_ref()
                            .and_then(|s| s.journal.last())
                            .is_some_and(|j| j.day.saturating_add(1) == first);
                    let desired =
                        if boundary_trigger { first } else { first + u32::from([r.focus_day, r.short_day][slot]) - 1 };
                    let desired = deadline.map_or(desired, |d| desired.min(d)).max(today);
                    // 先保留第一个可达日，再向规则给定的出场日靠拢。
                    if candidates.get(key).is_some_and(|old| old.day.abs_diff(desired) <= day.abs_diff(desired)) {
                        continue;
                    }
                    let gate = probe.defs.upbringing.event_gates.get(key);
                    candidates.insert(
                        key.clone(),
                        Candidate {
                            key: key.clone(),
                            day,
                            slot,
                            low_mood: rank.low_mood,
                            deadline,
                            deferred: deferred.get(key).map(|d| week.saturating_sub(d.since_week)),
                            once: c.once,
                            tier: rank.tier,
                            from: gate
                                .and_then(|g| g.from)
                                .and_then(|d| crate::scenario::day_of(&probe.defs, d).ok())
                                .unwrap_or(0),
                        },
                    );
                }
            }
            // 与 activity_events 分开的键；完整周序装进流序号，不截断到 u8。
            let hash = blake3::hash(b"weekly_events");
            let mut bytes = [0u8; 8];
            bytes.copy_from_slice(&hash.as_bytes()[..8]);
            let mut rng = crate::rng::Rng::derive(
                self.state.seed,
                today,
                crate::rng::Domain::Upbringing,
                u64::from_le_bytes(bytes),
                u64::from(week) * 256,
            );
            let mut ranked: Vec<_> = candidates
                .into_values()
                .map(|c| {
                    let expiring = c.deadline.filter(|d| *d <= last);
                    let order = (
                        !c.low_mood,
                        expiring.is_none(),
                        expiring.unwrap_or(u32::MAX),
                        c.deferred.is_none(),
                        std::cmp::Reverse(c.deferred.unwrap_or(0)),
                        !c.once,
                        c.tier,
                        c.from,
                        rng.below(1 << 20),
                        c.key.clone(),
                    );
                    (order, c)
                })
                .collect();
            ranked.sort_by(|a, b| a.0.cmp(&b.0));
            let viable: BTreeSet<_> = ranked.iter().map(|(_, c)| c.key.clone()).collect();
            if let Some(s) = &mut self.state.upbringing {
                let remove: BTreeSet<_> = s
                    .cadence
                    .deferred
                    .keys()
                    .filter(|k| {
                        !viable.contains(*k) && !s.cadence.scheduled.contains_key(*k) && !s.event_permits.contains(*k)
                    })
                    .cloned()
                    .collect();
                s.cadence.deferred.retain(|k, _| !remove.contains(k));
                s.event_backlog.retain(|k| !remove.contains(k));
                s.event_day = None;
            }
            for (_, c) in ranked {
                if self.cadence_room(c.slot) && !self.cadence_reservation_conflict(&c.key, c.day) {
                    self.schedule_cadence_event(&c.key, c.day);
                }
            }
        }
        self.release_cadence_events();
    }
    fn cadence_preview_place(&mut self) {
        let loc = self
            .upbringing_stage_on(self.cast_date())
            .and_then(|s| self.defs.locations.iter().position(|l| l.key == s.at))
            .map(crate::LocId::from_idx);
        if let (Some(loc), Some(p)) = (loc, &mut self.state.cast.place)
            && p.loc != loc
        {
            p.loc = loc;
            p.venue.clear();
        }
    }
    fn release_cadence_events(&mut self) {
        let today = self.day();
        let due: Vec<_> = self
            .state
            .upbringing
            .as_ref()
            .map(|s| s.cadence.scheduled.iter().filter(|(_, d)| **d <= today).map(|(k, d)| (k.clone(), *d)).collect())
            .unwrap_or_default();
        for (key, day) in due {
            let available = self.cadence_candidate_now(&key, false)
                && (self.defs.upbringing.event_gates.contains_key(&key)
                    || !self.cadence_pattern_event(&key)
                    || self.cadence_festival_window(&key).is_some());
            if let Some(s) = &mut self.state.upbringing {
                if available {
                    s.event_permits.insert(key.clone());
                    s.cadence.scheduled.remove(&key);
                } else if day < today {
                    s.cadence.scheduled.remove(&key);
                }
            }
        }
    }
    /// 这一格的模式与结果一起冻结；不会借用另一格的成败。
    pub(crate) fn trigger_cadence_events(&mut self, patterns: &[String], result: &SlotResult) {
        if !self.upbringing_cadence_enabled() || patterns.is_empty() {
            return;
        }
        let week = week_index(&self.defs, self.day());
        let tomorrow = self.day().saturating_add(1);
        let keys: Vec<_> = self
            .defs
            .story2
            .tracks
            .iter()
            .filter(|t| {
                !is_guide(t.kind) && patterns.iter().any(|p| super::activity_validation::event_matches(p, &t.key))
            })
            .map(|t| t.key.clone())
            .collect();
        for key in keys {
            if !self.upbringing_event_gate_with_result(&key, Some(result), false) {
                continue;
            }
            let Some((c, _)) = self.cadence_chapter(&key) else { continue };
            let droppable = self.defs.upbringing.event_gates.get(&key).and_then(|g| g.droppable).unwrap_or(!c.once);
            let slot = self.defs.story2.track(&key).map_or(1, |t| budget_slot(t.kind));
            let already = self.state.upbringing.as_ref().is_some_and(|s| {
                s.cadence.deferred.contains_key(&key)
                    || s.cadence.scheduled.contains_key(&key)
                    || s.event_permits.contains(&key)
            });
            if already {
                continue;
            }
            if let Some(s) = &mut self.state.upbringing {
                s.cadence.deferred.insert(key.clone(), Deferred { since_week: week, droppable });
            }
            if !self.cadence_candidate_now(&key, true) {
                if let Some(s) = &mut self.state.upbringing {
                    s.cadence.deferred.remove(&key);
                }
                continue;
            }
            if week_index(&self.defs, tomorrow) == week
                && self.cadence_room(slot)
                && !self.cadence_reservation_conflict(&key, tomorrow)
            {
                self.schedule_cadence_event(&key, tomorrow);
            }
        }
        if let Some(s) = &mut self.state.upbringing {
            s.event_backlog.retain(|p| !patterns.contains(p));
        }
    }
    /// 只在实际进入待回应队列时记冷却；反复刷新同一个待回应项不重记。
    pub(crate) fn upbringing_cadence_shown(&mut self) {
        if !self.upbringing_cadence_enabled() {
            return;
        }
        let seen: Vec<_> = self
            .state
            .story2
            .pending
            .iter()
            .map(|p| {
                let gate = self.defs.upbringing.event_gates.get(&p.track);
                (
                    p.track.clone(),
                    infer_event_category(&p.track, gate).to_owned(),
                    p.day,
                    self.cadence_repeat(&p.track),
                    infer_event_tier(&p.track, gate, false) == EventTier::Filler,
                )
            })
            .collect();
        if let Some(s) = &mut self.state.upbringing {
            for (key, category, day, repeat, filler) in seen {
                if filler {
                    s.filler_seen.entry(key.clone()).and_modify(|d| *d = (*d).max(day)).or_insert(day);
                }
                if repeat {
                    s.cadence.last_seen.entry(key).and_modify(|d| *d = (*d).max(day)).or_insert(day);
                    s.cadence.category_seen.entry(category).and_modify(|d| *d = (*d).max(day)).or_insert(day);
                }
            }
        }
    }
    pub(crate) fn settle_cadence_event(&mut self, key: &str) {
        if !self.upbringing_cadence_enabled() {
            return;
        }
        let continuing = self.upbringing_direct_continuation(key);
        let repeat = self.cadence_repeat(key);
        let category = infer_event_category(key, self.defs.upbringing.event_gates.get(key)).to_owned();
        let today = self.day();
        if let Some(s) = &mut self.state.upbringing {
            if repeat {
                s.cadence.last_seen.insert(key.into(), today);
                s.cadence.category_seen.insert(category, today);
            }
            s.cadence.scheduled.remove(key);
            // 直接续章沿用这次活动已冻结的成败，整件事结束后才收回。
            if !continuing {
                s.cadence.deferred.remove(key);
                s.event_backlog.retain(|k| k != key);
            }
        }
    }
    pub(crate) fn cadence_snapshot_problem(&self) -> bool {
        let Some(s) = &self.state.upbringing else { return false };
        let c = &s.cadence;
        let week = week_index(&self.defs, self.day());
        let limits = week_limits(&self.defs, self.day());
        c.last_seen.values().chain(c.category_seen.values()).any(|d| *d > self.day())
            || c.week > week
            || c.last_outing_week.is_some_and(|w| w > week)
            || c.excursion_weeks.iter().any(|w| *w > week)
            || c.excursion_weeks.windows(2).any(|w| w[0] > w[1])
            || c.deferred.values().any(|d| d.since_week > week)
            || c.scheduled.values().any(|d| *d > limits[1])
            || self.defs.rules.upbringing.cadence.as_ref().is_some_and(|r| {
                c.used[0] > r.focus_per_week
                    || c.used[1] > r.short_per_week
                    || u16::from(c.used[0]) + u16::from(c.used[1]) > u16::from(r.total_per_week)
                    || c.excursion_weeks.len() > usize::from(r.excursions_per_4_weeks)
            })
    }
    pub(crate) fn cadence_excursion_problem(&self, extra: usize) -> Option<&'static str> {
        if !self.upbringing_cadence_enabled() {
            return None;
        }
        let r = self.upbringing_cadence_rules()?;
        let s = self.state.upbringing.as_ref()?;
        let week = week_index(&self.defs, self.day());
        if s.cadence.excursion_weeks.iter().filter(|w| **w == week).count() + extra > usize::from(r.excursions_per_week)
        {
            Some("ub.cadence.excursion_week")
        } else if s.cadence.excursion_weeks.iter().filter(|w| week.saturating_sub(**w) < 4).count() + extra
            > usize::from(r.excursions_per_4_weeks)
        {
            Some("ub.cadence.excursion_window")
        } else {
            None
        }
    }
    pub(crate) fn cadence_outing_problem(&self, extra: usize) -> Option<&'static str> {
        if !self.upbringing_cadence_enabled() || extra == 0 {
            return None;
        }
        let r = self.upbringing_cadence_rules()?;
        let s = self.state.upbringing.as_ref()?;
        let week = week_index(&self.defs, self.day());
        (extra > 1 || s.cadence.last_outing_week.is_some_and(|w| week.saturating_sub(w) < r.outing_every_weeks))
            .then_some("ub.cadence.outing_interval")
    }
    /// 当前周的结构化日历；顺延未选中的项保留冻结状态，只有实际排上才报日期。
    pub fn upbringing_agenda(&self) -> Vec<serde_json::Value> {
        if !self.upbringing_cadence_enabled() {
            return Vec::new();
        }
        let Some(s) = &self.state.upbringing else { return Vec::new() };
        let week = week_index(&self.defs, self.day());
        let mut entries: BTreeMap<String, (u32, &str, u32)> = s
            .cadence
            .scheduled
            .iter()
            .map(|(k, d)| {
                let deferred = s.cadence.deferred.get(k).map(|d| week.saturating_sub(d.since_week));
                (
                    k.clone(),
                    (
                        *d,
                        match deferred {
                            Some(0) => "triggered",
                            Some(_) => "deferred",
                            None => "scheduled",
                        },
                        deferred.unwrap_or(0),
                    ),
                )
            })
            .collect();
        for (k, d) in self.cadence_dated().into_iter().filter(|(_, d)| week_index(&self.defs, *d) == week) {
            entries.entry(k).or_insert((d, "dated", 0));
        }
        let mut out:Vec<_>=entries.into_iter().filter_map(|(key,(day,source,deferred_weeks))| {
            let t=self.defs.story2.track(&key)?;
            let chapter=self.state.story2.tracks.get(&key).map_or(t.start.as_str(),|s|s.chapter.as_str());
            Some(serde_json::json!({"track":key,"chapter":chapter,"slot":match super::events::event_slot(t.kind,&key){0=>"focus",2=>"letter",_=>"short"},
                "category":infer_event_category(&key,self.defs.upbringing.event_gates.get(&key)),"day":date_of(&self.defs,day),"source":source,"deferred_weeks":deferred_weeks}))
        }).collect();
        out.sort_by_key(|a| {
            (
                [
                    a["day"][0].as_u64().unwrap_or(0),
                    a["day"][1].as_u64().unwrap_or(0),
                    a["day"][2].as_u64().unwrap_or(0),
                ],
                a["track"].as_str().unwrap_or("").to_owned(),
            )
        });
        out
    }
}

/// 区域旗标由家庭与入学事件发放；静态报告不能把其他文化的池算进本局。
fn family_has_culture(defs: &StaticData, family: &FamilyDef, region: &str) -> bool {
    family.stages.iter().any(|s| {
        let culture = s
            .academy
            .as_deref()
            .and_then(|k| defs.upbringing.academy(k))
            .map(|a| a.culture.as_str())
            .filter(|c| !c.is_empty())
            .or_else(|| defs.locations.iter().find(|l| l.key == s.at).map(|l| l.culture.as_str()));
        culture.is_some_and(|c| {
            c == region || defs.upbringing.culture_aliases.get(region).is_some_and(|v| v.iter().any(|r| r == c))
        })
    })
}

/// 静态上界，不推进世界、不抽随机数；稀疏窗口取首尾跨度，避免把多次节日低估成一次。
pub fn cadence_report(defs: &StaticData, family: Option<&str>) -> serde_json::Value {
    use super::reach::{Constraint, constraints_of_chapter, constraints_of_gate};
    let rules = defs.rules.upbringing.cadence.clone().unwrap_or_default();
    let reach = Reachability::profiles(defs);
    let families: Vec<_> = defs.upbringing.families.iter().filter(|f| family.is_none_or(|k| k == f.key)).collect();
    let mut dated = Vec::new();
    for f in &families {
        for route in std::iter::once(*f).chain(f.routed.iter().map(|(_, v)| v)) {
            let mut weeks = BTreeMap::<u32, Vec<String>>::new();
            for (key, day) in dated_events(defs, route) {
                weeks.entry(week_index(defs, day)).or_default().push(key);
            }
            let max = weeks.values().map(Vec::len).max().unwrap_or(0);
            let peaks: Vec<_> = weeks
                .iter()
                .filter(|(_, v)| v.len() == max)
                .map(|(w, v)| serde_json::json!({"week":w,"tracks":v}))
                .collect();
            dated.push(serde_json::json!({"family":f.key,
                "academy":route.stages.iter().find_map(|s|s.academy.as_deref()),"max":max,"weeks":peaks}));
        }
    }
    #[derive(Default)]
    struct Category {
        keys: u32,
        once: u32,
        repeatable: u32,
        variants: u32,
        lo: u32,
        hi: u32,
        min: u32,
        max: u32,
        sum: u32,
        repeat_sum: u32,
        once_sum: u32,
        slots: BTreeSet<usize>,
    }
    let mut direct = BTreeMap::<String, BTreeSet<String>>::new();
    let mut activity_patterns = BTreeMap::<String, BTreeSet<String>>::new();
    for f in &families {
        direct.insert(f.key.clone(), dated_events(defs, f).into_keys().collect());
        let mut patterns = BTreeSet::new();
        patterns.extend(defs.upbringing.rules.illness_events.iter().cloned());
        if let Some(mood) = &defs.upbringing.rules.mood {
            patterns.extend(mood.low_events.iter().cloned());
        }
        for a in &defs.upbringing.activities {
            let cs = super::reach::constraints_of_activity(a);
            if a.place.at.as_ref().is_some_and(|at| !f.stages.iter().any(|s| &s.at == at))
                || a.place.culture.as_deref().is_some_and(|c| !family_has_culture(defs, f, c))
                || a.place.academy.as_ref().is_some_and(|k| !f.stages.iter().any(|s| s.academy.as_ref() == Some(k)))
                || cs.iter().any(
                    |c| matches!(c, Constraint::Flag { flag, value:true } if f.routes.iter().any(|r| &r.flag == flag)),
                )
                || reach.earliest_for(&f.key, &cs, 0, Some(true)).is_err()
            {
                continue;
            }
            patterns.extend(a.events.iter().chain(&a.failure.events).cloned());
            if let Some(r) = &a.risk {
                patterns.extend(r.success_events.iter().chain(&r.failure_events).cloned());
            }
        }
        for place in f.places.iter().chain(
            f.stages
                .iter()
                .filter_map(|s| s.academy.as_deref())
                .filter_map(|k| defs.upbringing.academy(k))
                .flat_map(|a| &a.places),
        ) {
            patterns.extend(place.events.iter().cloned());
        }
        for exam in &defs.upbringing.exams {
            if exam.academy.as_ref().is_none_or(|k| f.stages.iter().any(|s| s.academy.as_ref() == Some(k))) {
                patterns.extend(exam.events.iter().cloned());
            }
        }
        for contest in &defs.upbringing.contests {
            if f.stages.iter().any(|s| s.at == contest.at || contest.bindings.iter().any(|b| b.at == s.at)) {
                patterns.extend(contest.events.iter().cloned());
            }
        }
        for excursion in &defs.upbringing.excursions {
            let relevant = if excursion.at.is_empty() {
                (excursion.place.cultures.is_empty()
                    || excursion.place.cultures.iter().any(|c| family_has_culture(defs, f, c)))
                    && (excursion.place.academies.is_empty()
                        || excursion
                            .place
                            .academies
                            .iter()
                            .any(|k| f.stages.iter().any(|s| s.academy.as_ref() == Some(k))))
            } else {
                f.stages.iter().any(|s| s.at == excursion.at)
            };
            if relevant {
                for node in &excursion.nodes {
                    patterns.extend(node.events.iter().cloned());
                }
            }
        }
        for academy in f.stages.iter().filter_map(|s| s.academy.as_deref()).filter_map(|k| defs.upbringing.academy(k)) {
            for club in &academy.clubs {
                patterns.extend(club.events.iter().cloned());
            }
        }
        activity_patterns.insert(f.key.clone(), patterns);
    }
    let mut categories = BTreeMap::<String, Category>::new();
    let mut no_variants = Vec::new();
    let mut festival_matches = 0;
    let mut festival_reachable = 0;
    let mut festival_existing = 0;
    for t in &defs.story2.tracks {
        if is_guide(t.kind) || !(t.upbringing || t.academy || defs.upbringing.event_gates.contains_key(&t.key)) {
            continue;
        }
        let Some(chapter) = t.chapter(&t.start) else {
            continue;
        };
        let gate = defs.upbringing.event_gates.get(&t.key);
        let mut cs = constraints_of_chapter(chapter);
        if let Some(g) = gate {
            cs.extend(constraints_of_gate(g));
        }
        let pattern = defs.upbringing.festivals.iter().any(|f| {
            f.event
                .iter()
                .chain(&f.events)
                .any(|p| p.contains('*') && super::activity_validation::event_matches(p, &t.key))
        });
        if pattern {
            festival_matches += 1;
        }
        let mut active = BTreeSet::new();
        for f in &families {
            // 只统计本局的实际入口；其他学院的非自动校历不能仅凭日期混进来。
            if gate.is_none()
                && !pattern
                && !direct.get(&f.key).is_some_and(|v| v.contains(&t.key))
                && !activity_patterns
                    .get(&f.key)
                    .is_some_and(|ps| ps.iter().any(|p| super::activity_validation::event_matches(p, &t.key)))
            {
                continue;
            }
            if gate
                .and_then(|g| g.academy.as_ref())
                .is_some_and(|k| !f.stages.iter().any(|s| s.academy.as_ref() == Some(k)))
                || chapter.at.as_ref().is_some_and(|at| !f.stages.iter().any(|s| &s.at == at))
                || cs.iter().any(
                    |c| matches!(c, Constraint::Flag { flag, value:true } if f.routes.iter().any(|r| &r.flag == flag)),
                )
            {
                continue;
            }
            let wrong_region = super::events::pool_region(&t.key).is_some_and(|r| !family_has_culture(defs, f, r))
                || cs.iter().any(|c| match c {
                    Constraint::Flag { flag, value: true } => flag
                        .strip_prefix("c9_pool_")
                        .or_else(|| flag.strip_prefix("c9_region_"))
                        .is_some_and(|r| !family_has_culture(defs, f, r)),
                    _ => false,
                });
            if wrong_region {
                continue;
            }
            let Some(start) = defs
                .scenarios
                .iter()
                .find(|s| s.key == f.scenario)
                .and_then(|s| crate::scenario::day_of(defs, s.start_date).ok())
            else {
                continue;
            };
            let Some(end) = reach.family_end(&f.key) else {
                continue;
            };
            let pattern_window = pattern && gate.is_none();
            let windows: Vec<_> = if pattern_window { festival_windows(defs, f, &t.key) } else { Vec::new() };
            // 整周约束的并集；不把排不上、冷却与属性软门槛当作静态不可达。
            let mut first = week_limits(defs, start)[0];
            while first <= end {
                let last = week_limits(defs, first)[1].min(end);
                let ranges = if pattern_window { windows.clone() } else { vec![[first, last]] };
                let possible = ranges.into_iter().any(|[lo, hi]| {
                    let lo = first.max(start).max(lo);
                    let hi = last.min(hi);
                    if lo > hi {
                        return false;
                    }
                    let mut dated_cs = cs.clone();
                    dated_cs.push(Constraint::Date { from: Some(date_of(defs, lo)), to: Some(date_of(defs, hi)) });
                    reach.earliest_for(&f.key, &dated_cs, lo, Some(true)).is_ok_and(|d| d <= hi)
                });
                let months_ok = gate
                    .and_then(|g| g.months.as_ref())
                    .is_none_or(|m| m.contains(&defs.calendar.date_of(first).month));
                if possible && months_ok {
                    active.insert(week_index(defs, first));
                }
                first = last.saturating_add(1);
            }
        }
        let (Some(&lo), Some(&hi)) = (active.first(), active.last()) else {
            continue;
        };
        if pattern {
            festival_reachable += 1;
            if gate.is_some() {
                festival_existing += 1;
            }
        }
        let weeks = hi - lo + 1;
        let repeat = !chapter.once;
        let tier = infer_event_tier(&t.key, gate, chapter.window.is_some());
        let cooldown = gate
            .and_then(|g| g.cooldown_weeks)
            .unwrap_or(rules.cooldown_weeks)
            .max(chapter.family_cooldown_days.div_ceil(7))
            .max(if tier == EventTier::Filler { 52 } else { 1 });
        let variants = chapter.variants.len() as u32;
        let per_key = if repeat {
            (1 + (weeks - 1) / cooldown).min(if variants == 0 { u32::MAX } else { variants })
        } else {
            t.chapters.iter().filter(|c| c.key == t.start || !super::events::direct_continuation(c)).count() as u32
        };
        if repeat && variants == 0 {
            no_variants.push(t.key.clone());
        }
        let category = infer_event_category(&t.key, gate).to_owned();
        let c = categories.entry(category).or_default();
        if c.keys == 0 {
            c.lo = lo;
            c.min = per_key;
        } else {
            c.lo = c.lo.min(lo);
            c.min = c.min.min(per_key);
        }
        c.hi = c.hi.max(hi);
        c.keys += 1;
        c.variants += variants;
        c.sum = c.sum.saturating_add(per_key);
        c.max = c.max.max(per_key);
        c.slots.insert(budget_slot(t.kind));
        if repeat {
            c.repeatable += 1;
            c.repeat_sum = c.repeat_sum.saturating_add(per_key);
        } else {
            c.once += 1;
            c.once_sum = c.once_sum.saturating_add(per_key);
        }
    }
    no_variants.sort();
    let categories: Vec<_> = categories
        .into_iter()
        .map(|(category, c)| {
            let weeks = c.hi - c.lo + 1;
            let gap = c.once_sum + c.repeat_sum.min(1 + (weeks - 1) / rules.category_gap_weeks.max(1));
            let per_week = if c.slots.len() > 1 {
                u32::from(rules.total_per_week)
            } else if c.slots.contains(&0) {
                u32::from(rules.focus_per_week)
            } else {
                u32::from(rules.short_per_week)
            };
            let budget = weeks.saturating_mul(per_week);
            let max_total = c.sum.min(gap).min(budget);
            let bound = if budget < gap.min(c.sum) {
                "budget"
            } else if gap < c.sum {
                "gap"
            } else {
                "keys"
            };
            serde_json::json!({"category":category,"keys":c.keys,"once":c.once,"repeatable":c.repeatable,
            "variants":c.variants,"active_weeks":weeks,"max_per_key":[c.min,c.max],"max_total":max_total,"bound":bound})
        })
        .collect();
    serde_json::json!({"categories":categories,"dated_per_week":dated,"repeat_without_variants":no_variants,
        "festival_patterns":{"matched_tracks":festival_matches,"before_pattern_entry":0,"after_pattern_entry":festival_reachable,"before_other_gate_entry":festival_existing}})
}

impl World {
    /// 行动制远足沿用 U06a 的窗口记录；旧结算不改。
    pub(super) fn cadence_note_excursion(&mut self) {
        let week = week_index(&self.defs, self.day());
        let keep = self.upbringing_cadence_rules().map_or(3, |r| usize::from(r.excursions_per_4_weeks));
        if let Some(s) = &mut self.state.upbringing {
            s.cadence.excursion_weeks.push(week);
            s.cadence.excursion_weeks.retain(|w| week.saturating_sub(*w) < 4);
            if s.cadence.excursion_weeks.len() > keep {
                s.cadence.excursion_weeks.remove(0);
            }
        }
    }
}
