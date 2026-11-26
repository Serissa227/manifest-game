//! 稳定待决队列、窗口默认结算与只向主角公开已知见闻。
use super::*;
use crate::{
    error::{CommandError, CoreError},
    ids::OwnerId,
    world::{World, WorldState},
};

pub(crate) struct AnswerPlan {
    pub state: WorldState,
}

struct Settlement {
    kind: NewsKind,
    choice: Option<u32>,
    success: Option<bool>,
    timeout: bool,
    /// U02：本次回应的骰子；只在掷骰规则打开时写进结果。
    roll: Option<dice::Roll>,
}
impl Settlement {
    fn automatic(timeout: bool) -> Self {
        Self { kind: NewsKind::Heard, choice: None, success: None, timeout, roll: None }
    }
}

fn blocked(message: &str) -> CommandError {
    CommandError::Precondition(message.into())
}

/// 主角此刻所在：一轮刷新开头取一次（`Known`），单独查询某一章时现取（`Unknown`）。
enum Here {
    Known(Option<crate::cast::CastPlace>),
    Unknown,
}

impl World {
    fn chapter_here(&self, c: &ChapterDef) -> bool {
        self.chapter_here_at(c, &Here::Unknown)
    }

    /// 同 [`World::chapter_here`]；`here` 是调用方为这一轮预先取好的主角所在（没取时现取，结果相同）。
    fn chapter_here_at(&self, c: &ChapterDef, here: &Here) -> bool {
        let at_place = |p: &crate::cast::CastPlace, at: &String| {
            self.defs.loc(p.loc).key == *at && (p.venue.is_empty() || c.venue.is_empty() || p.venue == c.venue)
        };
        self.state.agents.contains_key(&OwnerId::Player)
            && c.at.as_ref().is_none_or(|at| match here {
                Here::Known(place) => place.as_ref().is_some_and(|p| at_place(p, at)),
                Here::Unknown => self.cast_player_place().is_some_and(|p| at_place(&p, at)),
            })
    }

    pub fn story2_cooled(&self, c: &ChapterDef) -> bool {
        c.family
            .as_ref()
            .and_then(|f| self.state.story2.families.get(f))
            .is_none_or(|d| self.day().saturating_sub(*d) >= c.family_cooldown_days.max(1))
    }

    pub(crate) fn story2_chapter_available(&self, c: &ChapterDef, entered: u32) -> bool {
        self.story2_chapter_available_at(c, entered, &Here::Unknown, self.chapter_track(c, entered))
    }

    /// 排期已持有轨道：状态、进入日与章节引用都吻合时，原归属推断必定返回这个 key。
    /// 重启章、尚未开始的章和克隆章仍沿用原推断，保留同名章的歧义处理。
    pub(crate) fn story2_chapter_available_for(&self, key: &str, c: &ChapterDef, entered: u32) -> bool {
        let track = self.known_chapter_track(key, c, entered).or_else(|| self.chapter_track(c, entered));
        self.story2_chapter_available_at(c, entered, &Here::Unknown, track)
    }

    fn story2_chapter_available_at(&self, c: &ChapterDef, entered: u32, here: &Here, track: Option<&str>) -> bool {
        c.stage != Some(Stage::Rumor)
            && self.chapter_here_at(c, here)
            && self.story2_conditions_in(&c.when, entered, track)
            && self.story2_objectives_done_in(c, entered, track)
            && self.story2_cooled(c)
            && self.story2_deadline(c, entered).is_none_or(|d| self.day() <= d)
            && c.window.is_none_or(|w| self.cast_date() >= w[0] && self.cast_date() <= w[1])
    }
    /// 这条进行中的轨道此刻停着的章节能不能出场（地点、条件、目标、冷却、期限、窗口与养成期的放行都满足）；
    /// 能的话给出它用的变体——已经在队列里的沿用原来的，新来的取还没看过的第一个。
    pub(crate) fn story2_candidate(&self, key: &str, state: &TrackState) -> Option<Option<String>> {
        self.story2_candidate_of(self.defs.story2.track(key)?, key, state, &Here::Unknown)
    }

    /// 同 [`World::story2_candidate`]，轨道定义与主角所在由调用方给（一轮刷新里几百条轨道共用）。
    fn story2_candidate_of(&self, t: &TrackDef, key: &str, state: &TrackState, here: &Here) -> Option<Option<String>> {
        if !self.story2_track_running(t) {
            return None;
        }
        let c = t.chapter(&state.chapter)?;
        if !self.story2_chapter_available_at(c, state.entered, here, Some(key))
            || !self.upbringing_story_allowed(key)
            || self.story2_choices_locked(c, state.entered)
        {
            return None;
        }
        let variant = match self.state.story2.pending.iter().find(|p| p.track == key && p.chapter == c.key) {
            Some(p) => p.variant.clone(),
            None => c
                .variants
                .iter()
                .filter(|v| {
                    self.story2_conditions(&v.when, state.entered)
                        && !self.state.story2.variants_seen.contains(&(key.to_owned(), c.key.clone(), v.key.clone()))
                })
                .min_by_key(|v| &v.key)
                .map(|v| v.key.clone()),
        };
        (c.once || c.variants.is_empty() || variant.is_some()).then_some(variant)
    }

    pub fn refresh_story2(&mut self) {
        self.refresh_story2_with(crate::pacing::Refresh::Normal);
    }

    /// 日结末尾、新一天的头一次刷新：节奏的闸在这里统一放行这一夜出现的事（见 [`crate::pacing`]）。
    /// 规则关闭时与 [`World::refresh_story2`] 完全相同。
    pub(crate) fn refresh_story2_day_start(&mut self) {
        self.record_inn_day();
        self.refresh_story2_with(crate::pacing::Refresh::DayStart);
    }

    pub(crate) fn refresh_story2_with(&mut self, mode: crate::pacing::Refresh) {
        let day = self.day();
        let excluded = self.excluded_protagonist_tracks();
        for key in &excluded {
            self.state.story2.tracks.remove(key);
            if self.defs.rules.quests.enabled {
                self.state.story2.opened.remove(key);
                self.state.story2.quiet.remove(key);
            }
        }
        // 轨道定义按 key 排好序的次序；状态里的轨道（BTreeMap）本来就按 key 排序，下面两步都是两边并排走一遍。
        // 次序拿不到（定义被就地改过）时退回逐条查找，结果相同。
        let defs = self.defs.clone();
        let by_key = defs.story2.by_key();
        // 自动开始的轨道补上状态：只挑出还没有的（每次刷新都要看一遍，绝大多数时候一条也不缺）
        let missing: Vec<&TrackDef> = match by_key.clone() {
            Some(sorted) => {
                let mut have = self.state.story2.tracks.keys().peekable();
                sorted
                    .filter(|(_, t)| {
                        t.auto
                            && (t.kind != TrackKind::Guide
                                || (self.defs.rules.quests.enabled && self.defs.rules.quests.guide))
                    })
                    .filter(|(key, _)| {
                        while have.next_if(|k| k.as_str() < *key).is_some() {}
                        have.peek().is_none_or(|k| k.as_str() != *key)
                    })
                    .map(|(_, t)| t)
                    .filter(|t| !excluded.contains(&t.key))
                    .collect()
            }
            None => self
                .defs
                .story2
                .tracks
                .iter()
                .filter(|t| {
                    t.auto
                        && (t.kind != TrackKind::Guide
                            || (self.defs.rules.quests.enabled && self.defs.rules.quests.guide))
                        && !excluded.contains(&t.key)
                        && !self.state.story2.tracks.contains_key(&t.key)
                })
                .collect(),
        };
        for t in missing {
            // key 重复的定义（数据校验不允许）仍是靠前的那一条先占位
            self.state.story2.tracks.entry(t.key.clone()).or_insert_with(|| TrackState {
                visited: BTreeSet::new(),
                chapter: t.start.clone(),
                entered: day,
                status: Status::Active,
                failure: None,
            });
        }
        self.refresh_deed_marks();
        if self.defs.rules.quests.enabled {
            let opened = self
                .state
                .story2
                .tracks
                .iter()
                .filter(|(key, state)| {
                    state.status == Status::Active
                        && !excluded.contains(*key)
                        && !self.state.story2.opened.contains(*key)
                })
                .filter_map(|(key, state)| {
                    let t = self.defs.story2.track(key)?;
                    let c = t.chapter(&state.chapter)?;
                    (t.kind == TrackKind::Main
                        && self.story2_track_running(t)
                        && self.story2_conditions_in(&c.when, state.entered, Some(key))
                        && c.window.is_none_or(|w| self.cast_date() >= w[0])
                        && c.at
                            .as_ref()
                            .is_none_or(|at| self.defs.find_loc(at).is_some_and(|id| self.location_visible(id))))
                    .then(|| key.clone())
                })
                .collect::<Vec<_>>();
            self.state.story2.opened.extend(opened);
        }
        // 主角所在这一轮里不变：取一次，几百条轨道的“在不在场”共用
        let here = Here::Known(self.cast_player_place());
        let mut defs_by_key = by_key.map(Iterator::peekable);
        let mut pending = Vec::new();
        for (key, state) in &self.state.story2.tracks {
            if state.status != Status::Active || excluded.contains(key) {
                continue;
            }
            let def = match &mut defs_by_key {
                Some(sorted) => {
                    while sorted.next_if(|pair| pair.0 < key.as_str()).is_some() {}
                    sorted.peek().filter(|pair| pair.0 == key.as_str()).map(|pair| pair.1)
                }
                None => self.defs.story2.track(key),
            };
            let Some(variant) = def.and_then(|t| self.story2_candidate_of(t, key, state, &here)) else {
                continue;
            };
            let appeared = self
                .state
                .story2
                .pending
                .iter()
                .find(|p| p.track == *key && p.chapter == state.chapter)
                .map_or(day, |p| p.day);
            pending.push(Pending { track: key.clone(), chapter: state.chapter.clone(), day: appeared, variant });
        }
        // 排好序的次序借着定义：下面要改世界了，先放手
        drop(defs_by_key);
        // 曾出场后才全锁的章节也撤下；解锁后按新候选提醒，不能沿用旧的出场日而一直不再弹出。
        let locked: Vec<_> = self
            .state
            .story2
            .pending
            .iter()
            .filter(|p| {
                self.state.story2.tracks.get(&p.track).is_some_and(|s| {
                    self.defs
                        .story2
                        .track(&p.track)
                        .and_then(|t| t.chapter(&p.chapter))
                        .is_some_and(|c| self.story2_choices_locked(c, s.entered))
                })
            })
            .map(|p| p.track.clone())
            .collect();
        for track in locked {
            self.state.pacing.shown.remove(&track);
            self.state.pacing.held.remove(&track);
        }
        // 节奏的闸（P11）：新候选当天出场还是先按下。规则关闭或正在跳过养成时不过闸，与原来逐位相同。
        if self.pacing_active() {
            pending = self.pacing_gate(pending, mode);
        }
        let rank = |p: &Pending| self.defs.story2.track(&p.track).map(|t| t.kind);
        pending.sort_by(|a, b| (rank(a), &a.track, &a.chapter).cmp(&(rank(b), &b.track, &b.chapter)));
        self.state.story2.pending = pending;
        self.upbringing_cadence_shown();
    }

    pub fn pending_story2(&self) -> Option<&Pending> {
        self.state.story2.pending.first()
    }

    /// 旧章节与奇遇保留原状态，与新队列只比较稳定优先级。
    pub fn story2_is_front(&self) -> bool {
        let Some(p) = self.pending_story2() else {
            return false;
        };
        let Some(t) = self.defs.story2.track(&p.track) else {
            return false;
        };
        let Some(old) = &self.state.story.pending else {
            return true;
        };
        let (kind, key, chapter) = match &old.source {
            crate::story::StorySource::Chapter(i) => {
                let Some(s) = self.story_def() else {
                    return true;
                };
                (TrackKind::Main, s.key.as_str(), s.chapters.get(*i as usize).map_or("", |c| c.key.as_str()))
            }
            crate::story::StorySource::Encounter(key) => {
                // 开了节奏规则、出海以后：奇遇只等到今天日结，队首的章节却可以一直等。玩家搁了几天的章节、
                // 一个选项也交不上的章节不该把它挡到过期——只有今天刚出场（或今天是最后一天）而且答得了的章节排在它前面。
                if self.pacing_enabled() && !self.upbringing_active() && !self.story2_front_due(p) {
                    return false;
                }
                (TrackKind::Encounter, key.as_str(), "")
            }
        };
        (t.kind, p.track.as_str(), p.chapter.as_str()) < (kind, key, chapter)
    }

    /// 队首的章节是不是“今天的事”：今天出场或今天是它的最后一天，而且至少有一个选项交得上。
    fn story2_front_due(&self, p: &Pending) -> bool {
        let locked = self.state.story2.tracks.get(&p.track).is_some_and(|s| {
            self.defs
                .story2
                .track(&p.track)
                .and_then(|t| t.chapter(&p.chapter))
                .is_some_and(|c| self.story2_choices_locked(c, s.entered))
        });
        !locked && (p.day >= self.day() || self.pacing_last_chance(p))
    }

    pub fn start_story2(&mut self, track: &str) -> Result<(), CommandError> {
        if !self.protagonist_track_allowed(track) {
            return Err(blocked("这段故事属于另一种出身"));
        }
        let t = self.defs.story2.track(track).ok_or_else(|| CommandError::NotFound(track.into()))?;
        if t.kind == TrackKind::Guide && (!self.defs.rules.quests.enabled || !self.defs.rules.quests.guide) {
            return Err(blocked("quests_guide_disabled"));
        }
        let day = self.day();
        self.state.story2.tracks.entry(track.into()).or_insert_with(|| TrackState {
            visited: BTreeSet::new(),
            chapter: t.start.clone(),
            entered: day,
            status: Status::Active,
            failure: None,
        });
        self.refresh_story2();
        Ok(())
    }

    /// 按当前日结算到期轨道；日结与离线审计共用，不推进日历或绕过效果门禁。
    pub fn close_story2_windows(&mut self) {
        let quests_enabled = self.defs.rules.quests.enabled;
        let excluded = self.excluded_protagonist_tracks();
        let mut budget = self.defs.story2.tracks.iter().map(|t| t.chapters.len()).sum::<usize>();
        loop {
            let due = self.state.story2.tracks.iter().find_map(|(key, s)| {
                if s.status != Status::Active || excluded.contains(key) {
                    return None;
                }
                let t = self.defs.story2.track(key)?;
                if !self.story2_track_running(t) {
                    return None;
                }
                let c = t.chapter(&s.chapter)?;
                let expired = self.story2_deadline(c, s.entered).is_some_and(|d| self.day() >= d);
                if !expired
                    && (!self.story2_cooled(c)
                        || (!c.once
                            && !c.variants.is_empty()
                            && c.variants.iter().all(|v| {
                                !self.story2_conditions(&v.when, s.entered)
                                    || self.state.story2.variants_seen.contains(&(
                                        key.clone(),
                                        c.key.clone(),
                                        v.key.clone(),
                                    ))
                            })))
                {
                    return None;
                }
                (expired || c.window.is_some_and(|w| self.cast_date() >= w[1]))
                    .then(|| (key.clone(), c.clone(), s.entered, expired))
            });
            let Some((key, c, entered, expired)) = due else { break };
            if budget == 0 {
                break;
            }
            budget -= 1;
            if quests_enabled
                && self.defs.story2.track(&key).is_some_and(|t| t.kind == TrackKind::Main)
                && !self.state.story2.opened.contains(&key)
            {
                self.state.story2.quiet.insert(key.clone());
            }
            let (outcome, failure) = if expired {
                if let Some(branch) = &c.timeout {
                    (self.settle_story2(&key, &c, branch, Settlement::automatic(true)), FAILURE_SETTLE_FAILED)
                } else {
                    (Err(blocked("期限章节缺少timeout分支")), FAILURE_TIMEOUT_MISSING)
                }
            } else if !self.story2_conditions_in(&c.when, entered, Some(&key)) {
                (Err(blocked("窗口结束时章节条件仍未满足")), FAILURE_WINDOW_UNMET)
            } else if let Some(branch) = &c.default {
                (self.settle_story2(&key, &c, branch, Settlement::automatic(false)), FAILURE_SETTLE_FAILED)
            } else {
                (Err(blocked("窗口章节缺少默认分支")), FAILURE_DEFAULT_MISSING)
            };
            if let Err(e) = outcome {
                if let Some(s) = self.state.story2.tracks.get_mut(&key) {
                    s.status = Status::Failed;
                    s.failure = Some(if quests_enabled { failure.into() } else { e.to_string() });
                }
                self.state.story2.pending.retain(|p| p.track != key);
            }
        }
    }

    fn settle_story2(
        &mut self,
        track: &str,
        c: &ChapterDef,
        branch: &Branch,
        settlement: Settlement,
    ) -> Result<(), CommandError> {
        let Settlement { kind, choice, success, timeout, roll } = settlement;
        let mut trial = self.clone();
        let t = trial.defs.story2.track(track).cloned().ok_or_else(|| CommandError::NotFound(track.into()))?;
        if trial.state.story2.tracks.get(track).is_none_or(|s| s.chapter != c.key || s.status != Status::Active) {
            return Err(blocked("章节已经结算或尚未开始"));
        }
        if choice.is_some() {
            trial.deliver_story2_objectives(c)?;
            if !c.objectives.is_empty() {
                trial.state.story2.completed_objectives.insert((track.into(), c.key.clone()));
            }
        }
        let variant = trial
            .state
            .story2
            .pending
            .iter()
            .find(|p| p.track == track && p.chapter == c.key)
            .and_then(|p| p.variant.clone())
            .or_else(|| {
                let entered = trial.state.story2.tracks.get(track).map_or(trial.day(), |s| s.entered);
                c.variants
                    .iter()
                    .filter(|v| {
                        trial.story2_conditions(&v.when, entered)
                            && !trial.state.story2.variants_seen.contains(&(track.into(), c.key.clone(), v.key.clone()))
                    })
                    .min_by_key(|v| &v.key)
                    .map(|v| v.key.clone())
            });
        if let Some(v) = &variant {
            trial.state.story2.variants_seen.insert((track.into(), c.key.clone(), v.clone()));
        }
        let mut outcomes = Vec::new();
        for e in &branch.effects {
            let before = trial.story2_effect_amount(e);
            if let Effect::Transform { lineage } = e {
                trial.transform_lineage(lineage.as_deref())?;
            } else {
                trial.apply_story2_effect(e, t.academy)?;
            }
            let mut applied = e.clone();
            if let Some((before, after)) = before.zip(trial.story2_effect_amount(e)) {
                match &mut applied {
                    Effect::Affinity { value, .. }
                    | Effect::Heart { value, .. }
                    | Effect::Cash { value }
                    | Effect::Fame { value } => *value = after - before,
                    _ => {}
                }
            }
            outcomes.push(applied);
        }
        if kind == NewsKind::Seen {
            trial.remember_story2_ties(&format!("{track}:{}", c.key), trial.day(), &branch.effects);
            for key in if c.cast.is_empty() { &t.cast } else { &c.cast } {
                trial.state.cast.persons.entry(key.clone()).or_default().met = true;
            }
        }
        let state = trial.state.story2.tracks.get_mut(track).ok_or_else(|| blocked("轨道尚未开始"))?;
        if !state.visited.insert(c.key.clone()) && c.once {
            return Err(blocked("本章已经结算，不能重复获取效果"));
        }
        let status = if state.status != Status::Active {
            state.status
        } else {
            match branch.next.as_str() {
                "done" => Status::Done,
                "failed" => Status::Failed,
                _ => Status::Active,
            }
        };
        if status == Status::Active && t.chapter(&branch.next).is_none() {
            return Err(blocked("分支指向未知章节"));
        }
        if status == Status::Active
            && state.visited.contains(&branch.next)
            && t.chapter(&branch.next).is_none_or(|c| c.once)
        {
            return Err(blocked("分支不能重进已结算的章节"));
        }
        state.status = status;
        if status == Status::Active {
            state.chapter = branch.next.clone();
            state.entered = trial.state.day;
        }
        if let Some(family) = &c.family {
            trial.state.story2.families.insert(family.clone(), trial.day());
        }
        // 这一次事件已经结算：掷骰失败过的选项记录随之作废。
        trial.state.story2.failed_choices.remove(track);
        trial.state.story2.pending.retain(|p| p.track != track);
        // 节奏的闸记下的“出过场 / 按着”随这一章作废：可重复的事件当天回到同一章时算新的一件（规则关闭时两张表本来就是空的）。
        trial.state.pacing.shown.remove(track);
        trial.state.pacing.held.remove(track);
        let text = branch.news.as_ref().or(c.news.as_ref());
        let mut news_id = None;
        if let Some(text) = text {
            let id = format!("{track}:{}", c.key);
            let persons = if c.cast.is_empty() { t.cast.clone() } else { c.cast.clone() };
            let loc =
                c.at.as_ref()
                    .and_then(|key| trial.defs.locations.iter().position(|l| l.key == *key))
                    .map(LocId::from_idx);
            trial.state.story2.news.insert(
                id.clone(),
                News {
                    success,
                    timeout,
                    choice,
                    choice_key: choice.and_then(|i| c.choices.get(i as usize)).map(|o| o.key.clone()),
                    id: id.clone(),
                    day: trial.day(),
                    text: text.clone(),
                    persons,
                    kind,
                    loc,
                    track: track.into(),
                    known: kind != NewsKind::Heard,
                    read: false,
                    rumor_days: c.rumor_days,
                },
            );
            news_id = Some(id);
        }
        if choice.is_some() {
            trial.state.story2.last = Some(Story2Result {
                track: track.into(),
                chapter: c.key.clone(),
                day: trial.day(),
                text: choice
                    .and_then(|i| c.choices.get(i as usize))
                    .filter(|o| !o.reply.is_empty() && success != Some(false))
                    .map(|o| o.reply.clone())
                    .or_else(|| text.cloned())
                    .unwrap_or_else(|| c.text.clone()),
                choice,
                choice_key: choice.and_then(|i| c.choices.get(i as usize)).map(|o| o.key.clone()),
                news: news_id,
                success,
                outcomes,
                variant,
                roll: roll.filter(|_| trial.defs.rules.story.soft_requires),
                soft_fail: None,
            });
        }
        trial.upbringing_story_settled(track);
        // 结算之后调用方还要收尾（命令的话是换阶段、刷新人物，再做一次正式的刷新；日结的话有当天最后那一次）：
        // 这里只把队列理一遍，节奏的闸不在这半路上放行或按下新候选（规则关闭时两种刷新完全相同）。
        trial.refresh_story2_with(crate::pacing::Refresh::Quiet);
        self.state = trial.state;
        Ok(())
    }

    /// 新见闻入知识簿时记录实际分支；读视图本身不写入状态。
    pub(crate) fn remember_story2_ties(&mut self, source: &str, day: u32, effects: &[Effect]) {
        for e in effects {
            let Effect::Tie { a, b, relation, remove } = e else {
                continue;
            };
            let (a, b) = if a < b { (a.clone(), b.clone()) } else { (b.clone(), a.clone()) };
            let fact = KnownTie {
                a: a.clone(),
                b: b.clone(),
                kind: (!*remove).then_some(*relation),
                day,
                source: source.into(),
            };
            if let Some(old) = self.state.story2.known_ties.iter_mut().find(|t| t.a == a && t.b == b) {
                if (day, source) >= (old.day, old.source.as_str()) {
                    *old = fact;
                }
            } else {
                self.state.story2.known_ties.push(fact);
            }
        }
        self.state.story2.known_ties.sort_by(|a, b| (&a.a, &a.b).cmp(&(&b.a, &b.b)));
    }

    pub fn story2_news_effects<'a>(&'a self, n: &News) -> &'a [Effect] {
        let Some(c) =
            n.id.strip_prefix(&format!("{}:", n.track)).and_then(|key| self.defs.story2.track(&n.track)?.chapter(key))
        else {
            return &[];
        };
        if n.timeout {
            return c.timeout.as_ref().map_or(&[], |b| b.effects.as_slice());
        }
        if let Some(o) = n.choice.and_then(|i| c.choices.get(i as usize)) {
            if n.success == Some(false) {
                return o.fail.as_ref().map_or(&[], |b| b.effects.as_slice());
            }
            return &o.effects;
        }
        c.default.as_ref().map_or(&[], |b| b.effects.as_slice())
    }

    pub(crate) fn disclose_story2_news(&mut self, ids: &[String], kind: NewsKind) {
        for id in ids {
            let Some(n) = self.state.story2.news.get(id).cloned() else {
                continue;
            };
            if kind == NewsKind::Letter {
                let day = self.day();
                if let Some(s) = &mut self.state.upbringing {
                    s.letter_arrivals.entry(id.clone()).or_insert(day);
                }
            }
            let effects = self.story2_news_effects(&n).to_vec();
            self.remember_story2_ties(&n.id, n.day, &effects);
            if let Some(n) = self.state.story2.news.get_mut(id) {
                n.known = true;
                n.kind = kind;
            }
        }
    }

    pub fn hear_news_at(&mut self, loc: LocId, passing: bool) {
        let day = self.day();
        let ids: Vec<_> = self
            .state
            .story2
            .news
            .values()
            .filter(|n| n.loc == Some(loc) && !n.known && (!passing || day.saturating_sub(n.day) <= n.rumor_days))
            .map(|n| n.id.clone())
            .collect();
        self.disclose_story2_news(&ids, NewsKind::Heard);
    }

    pub fn news_unread(&self) -> usize {
        self.state.story2.news.values().filter(|n| n.known && !n.read).count()
    }

    pub fn known_news(&self, loc: Option<LocId>) -> Vec<&News> {
        let mut news: Vec<_> =
            self.state.story2.news.values().filter(|n| n.known && loc.is_none_or(|loc| n.loc == Some(loc))).collect();
        news.sort_by(|a, b| b.day.cmp(&a.day).then_with(|| a.id.cmp(&b.id)));
        news
    }

    pub(crate) fn validate_story2_snapshot(&self) -> Result<(), CoreError> {
        let state = &self.state.story2;
        let mut queued = BTreeSet::new();
        // 内容 key 的有效性在 reconcile 中处理；这里只拒绝内核不可能生成的内部矛盾。
        if state.known_ties.windows(2).any(|p| (&p[0].a, &p[0].b) >= (&p[1].a, &p[1].b))
            || state.known_ties.iter().any(|t| t.a >= t.b || t.day > self.day())
            || state
                .completed_objectives
                .iter()
                .any(|(t, c)| state.tracks.get(t).is_none_or(|s| !s.visited.contains(c)))
            || state.families.values().any(|day| *day > self.day())
            || state.removed_ties.iter().any(|(a, b)| a >= b)
            || state.last.as_ref().is_some_and(|last| {
                last.day > self.day()
                    || (last.choice_key.is_some() && last.choice.is_none())
                    || last.news.as_ref().is_some_and(|id| state.news.get(id).is_none_or(|n| !n.known))
            })
            || state.pending.iter().any(|p| p.day > self.day() || !queued.insert(&p.track))
            || state.tracks.values().any(|s| s.entered > self.day())
            || state.failed_choices.values().any(|f| f.entered > self.day() || f.choices.is_empty())
            || state.last.as_ref().is_some_and(|last| {
                last.soft_fail.is_some()
                    && (last.success != Some(false) || last.choice.is_none() || last.roll.is_none())
            })
            || state.pending.iter().any(|p| {
                state.tracks.get(&p.track).is_none_or(|s| s.status != Status::Active || s.chapter != p.chapter)
            })
            || state.news.iter().any(|(id, n)| {
                id != &n.id
                    || n.day > self.day()
                    || (n.choice_key.is_some() && n.choice.is_none())
                    || (n.read && !n.known)
                    || n.id.strip_prefix(&format!("{}:", n.track)).is_none_or(|chapter| chapter.is_empty())
                    || (n.timeout && (n.choice.is_some() || n.success.is_some()))
                    || (n.success.is_some() && n.choice.is_none())
            })
        {
            return Err(CoreError::SnapshotMismatch("故事状态含未来日期或内部矛盾".into()));
        }
        Ok(())
    }
}

pub(crate) fn check_answer(world: &World, owner: OwnerId, choice: u32) -> Result<AnswerPlan, CommandError> {
    if owner != OwnerId::Player {
        return Err(CommandError::NotOwner);
    }
    let p = world.pending_story2().ok_or_else(|| blocked("没有待回应的故事"))?;
    let t = world.defs.story2.track(&p.track).ok_or_else(|| blocked("未知轨道"))?;
    let c = t.chapter(&p.chapter).ok_or_else(|| blocked("未知章节"))?;
    let s = world.state.story2.tracks.get(&p.track).ok_or_else(|| blocked("轨道尚未开始"))?;
    if !world.story2_track_running(t)
        || !world.protagonist_track_allowed(&p.track)
        || !world.chapter_here(c)
        || !world.story2_conditions(&c.when, s.entered)
        || !world.story2_objectives_done(c, s.entered)
        || !world.story2_cooled(c)
        || world.story2_deadline(c, s.entered).is_some_and(|d| world.day() > d)
        || c.window.is_some_and(|w| world.cast_date() < w[0] || world.cast_date() > w[1])
    {
        return Err(blocked("事件已不在当前地点或窗口内"));
    }
    // 命令使用可见列表的序号；结果与见闻继续保存定义序号，稳定关联 choice_key。
    let choice = if c.choices.is_empty() {
        choice
    } else {
        c.choices
            .iter()
            .enumerate()
            .filter(|(_, o)| world.story2_choice_visible(o, s.entered))
            .nth(choice as usize)
            .map(|(i, _)| i as u32)
            .ok_or_else(|| blocked("选项不存在"))?
    };
    let mut success = None;
    let mut roll = None;
    let branch = if c.stage == Some(Stage::Witness) && c.choices.is_empty() {
        if choice != 0 {
            return Err(blocked("旁观事件只能选择继续"));
        }
        c.default.clone().ok_or_else(|| blocked("旁观事件缺少分支"))?
    } else {
        let option = c.choices.get(choice as usize).ok_or_else(|| blocked("选项不存在"))?;
        // 掷骰规则打开时，数值门槛（未标 hard）不在这里锁死，改由下面掷骰；其余条件照旧。
        if !world.story2_choice_open(option, s.entered) {
            return Err(blocked("选项条件未满足"));
        }
        let gaps = world.story2_soft_gaps(option);
        if !gaps.is_empty() && world.story2_choice_failed(&p.track, &c.key, s.entered, &option.key) {
            return Err(blocked("这个选项这次已经试过了，等本事够了再来"));
        }
        // 门槛都满足时只剩原 check，骰子与旧版逐位相同；规则关闭的世界也走这里。
        roll = world.story2_choice_chance(option).map(|chance| world.story2_roll(p, option, chance));
        success = roll.as_ref().map(|r| r.success);
        if success == Some(false) {
            match &option.fail {
                Some(fail) => fail.clone(),
                None if !gaps.is_empty() => {
                    let roll = roll.clone().ok_or_else(|| blocked("缺少骰子"))?;
                    return Ok(AnswerPlan { state: soft_failure(world, p, s.entered, choice, option, roll, &gaps) });
                }
                None => return Err(blocked("检定缺少失败分支")),
            }
        } else {
            option.branch()
        }
    };
    let mut trial = world.clone();
    trial.settle_story2(
        &p.track,
        c,
        &branch,
        Settlement { kind: NewsKind::Seen, choice: Some(choice), success, timeout: false, roll },
    )?;
    Ok(AnswerPlan { state: trial.state })
}

/// 掷骰失败又没有 fail 分支：停在原节点，这个选项本次不能再选，养成期扣一点疲劳与心情。
/// 不交付目标、不发奖励、不记章节已访问，也不写见闻。
fn soft_failure(
    world: &World,
    p: &Pending,
    entered: u32,
    choice: u32,
    option: &Choice,
    roll: dice::Roll,
    gaps: &[dice::SoftGap],
) -> WorldState {
    let mut trial = world.clone();
    trial.remember_failed_choice(p, entered, &option.key);
    let (fatigue, mood) = trial.story2_fail_cost();
    // 语句按差得最多（成功率最低）的那一项门槛分池。
    let pool = gaps.iter().min_by_key(|g| g.chance).map(|g| g.pool.clone()).unwrap_or_default();
    let pick = trial.story2_fail_pick(p, option);
    trial.state.story2.last = Some(Story2Result {
        track: p.track.clone(),
        chapter: p.chapter.clone(),
        day: trial.day(),
        text: String::new(),
        choice: Some(choice),
        choice_key: Some(option.key.clone()),
        news: None,
        success: Some(false),
        outcomes: Vec::new(),
        variant: p.variant.clone(),
        roll: Some(roll),
        soft_fail: Some(dice::SoftFailure { pool, pick, fatigue, mood }),
    });
    trial.state
}

pub(crate) fn check_read(world: &World, owner: OwnerId, ids: &[String]) -> Result<(), CommandError> {
    if owner != OwnerId::Player {
        return Err(CommandError::NotOwner);
    }
    if world.defs.story2.tracks.is_empty() {
        return Err(blocked("这个世界没有见闻簿"));
    }
    if ids.iter().any(|id| world.state.story2.news.get(id).is_none_or(|n| !n.known)) {
        return Err(blocked("见闻尚未获知或不存在"));
    }
    Ok(())
}

impl World {
    /// 关闭引导只暂停公开与结算，保留旧档的进度，重新打开时不会重发已领过的奖励。
    fn story2_track_running(&self, t: &TrackDef) -> bool {
        t.kind != TrackKind::Guide
            || (self.defs.rules.quests.enabled
                && self.defs.rules.quests.guide
                && super::guide_defs::phase(t) == self.quest_phase())
    }
}
