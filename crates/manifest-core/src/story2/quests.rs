//! 任务的公开范围、身份与置顶选择；视图和命令共用同一份规则。
use super::{
    Condition, Stage, Status, TrackDef, TrackKind, TrackState,
    guide_defs::{Phase, phase},
};
use crate::{CommandError, OwnerId, World, contract::ContractStatus, upbringing::GoalStatus};
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QuestKind {
    Main,
    Guide,
    Character,
    Request,
    History,
    Contract,
    AnnualGoal,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QuestStatus {
    Active,
    Waiting,
    Done,
    Failed,
    Missed,
}

impl QuestStatus {
    pub fn active(self) -> bool {
        matches!(self, Self::Active | Self::Waiting)
    }
}

#[derive(Clone, Debug)]
pub struct QuestEntry {
    pub id: String,
    pub kind: QuestKind,
    pub status: QuestStatus,
    pub phase: Phase,
    pub chapter: Option<String>,
    pub entered: u32,
    pub private_progress: bool,
    pub due: Option<u32>,
    pub ready: bool,
}

pub fn kind(t: &super::TrackDef) -> QuestKind {
    if t.kind == TrackKind::Guide {
        return QuestKind::Guide;
    }
    let source = t.source.replace('\\', "/");
    if source.starts_with("stories/main/") {
        return QuestKind::Main;
    }
    if source.starts_with("stories/bonds/") || source.starts_with("stories/npc/") {
        return QuestKind::Character;
    }
    match t.kind {
        TrackKind::Main => QuestKind::Main,
        TrackKind::Guide => QuestKind::Guide,
        TrackKind::Request => QuestKind::Request,
        TrackKind::History => QuestKind::History,
        TrackKind::Encounter => QuestKind::Character,
    }
}

impl World {
    pub fn quest_phase(&self) -> Phase {
        if self.upbringing_active() { Phase::Upbringing } else { Phase::Voyage }
    }

    pub(crate) fn quest_track_opened(&self, key: &str, state: &TrackState) -> bool {
        self.state.story2.opened.contains(key) || (!self.state.story2.quiet.contains(key) && !state.visited.is_empty())
    }

    pub fn quest_track_revealed(&self, key: &str, t: &TrackDef, state: &TrackState) -> bool {
        if !self.defs.rules.quests.enabled {
            return false;
        }
        if self.quest_track_opened(key, state) {
            return true;
        }
        if self.state.story2.quiet.contains(key) || self.defs.rules.quests.reveal_days == 0 {
            return false;
        }
        let Some(c) = t.chapter(&state.chapter) else { return false };
        if c.at.as_ref().is_some_and(|at| self.defs.find_loc(at).is_none_or(|id| !self.location_visible(id))) {
            return false;
        }
        let gates = c
            .when
            .iter()
            .filter(|c| !matches!(c, Condition::Date { .. } | Condition::Wait { .. }))
            .cloned()
            .collect::<Vec<_>>();
        if !self.story2_conditions_in(&gates, state.entered, Some(key)) {
            return false;
        }
        c.window
            .map(|win| win[0])
            .into_iter()
            .chain(c.when.iter().filter_map(|c| match c {
                Condition::Date { from: Some(from), .. } => Some(*from),
                _ => None,
            }))
            .max()
            .and_then(|start| self.story2_day(start))
            .is_some_and(|start| self.day() >= start.saturating_sub(self.defs.rules.quests.reveal_days))
    }

    pub fn quest_entries(&self) -> Vec<QuestEntry> {
        if !self.defs.rules.quests.enabled {
            return Vec::new();
        }
        let mut out = Vec::new();
        let news = self.known_news(None);
        for (key, s) in &self.state.story2.tracks {
            let Some(t) = self.defs.story2.track(key) else { continue };
            let guide = t.kind == TrackKind::Guide;
            if guide
                && (!self.defs.rules.quests.guide
                    || !self.defs.guide.lines.iter().any(|l| {
                        (l.upbringing.contains(key) || l.voyage.contains(key))
                            && self.state.protagonist.as_ref().and_then(|p| p.key()) == Some(l.protagonist.as_str())
                    })
                    || (phase(t) != self.quest_phase() && s.status != Status::Done))
            {
                continue;
            }
            let pending = self.state.story2.pending.iter().any(|p| &p.track == key);
            let last = self.state.story2.last.as_ref().filter(|r| &r.track == key);
            let heard = news.iter().copied().find(|n| &n.track == key);
            let met = t.cast.iter().any(|p| {
                self.state.cast.persons.get(p).is_some_and(|p| p.met)
                    || self.state.protagonist.as_ref().and_then(|p| p.key()) == Some(p.as_str())
            });
            if !(guide
                || pending
                || (t.kind == TrackKind::Main && self.quest_track_revealed(key, t, s))
                || last.is_some()
                || heard.is_some()
                || (!t.auto && (met || self.state.story2.opened.contains(key))))
            {
                continue;
            }
            let private = !guide && t.auto && t.kind != TrackKind::Main && !pending;
            let chapter = if private {
                heard
                    .and_then(|n| n.id.strip_prefix(&format!("{key}:")))
                    .or_else(|| last.map(|r| r.chapter.as_str()))
                    .unwrap_or(&s.chapter)
            } else {
                &s.chapter
            };
            let Some(c) = t.chapter(chapter) else { continue };
            let status = if private {
                let next = heard.and_then(|n| {
                    if n.timeout {
                        return c.timeout.as_ref().map(|b| b.next.as_str());
                    }
                    if let Some(o) = n.choice.and_then(|i| c.choices.get(i as usize)) {
                        return if n.success == Some(false) {
                            o.fail.as_ref().map(|b| b.next.as_str())
                        } else {
                            Some(o.next.as_str())
                        };
                    }
                    c.default.as_ref().map(|b| b.next.as_str())
                });
                match next {
                    Some("done") => QuestStatus::Done,
                    Some("failed") => QuestStatus::Failed,
                    _ => QuestStatus::Waiting,
                }
            } else {
                match s.status {
                    Status::Done => QuestStatus::Done,
                    Status::Failed => QuestStatus::Failed,
                    Status::Active if pending => QuestStatus::Active,
                    Status::Active | Status::Waiting => QuestStatus::Waiting,
                }
            };
            let mut due = self.story2_deadline(c, s.entered);
            if let Some(end) = c.window.and_then(|win| self.story2_day(win[1])) {
                due = Some(due.map_or(end, |d| d.min(end)));
            }
            out.push(QuestEntry {
                id: format!("track:{key}"),
                kind: kind(t),
                status,
                phase: phase(t),
                chapter: Some(chapter.to_owned()),
                entered: s.entered,
                private_progress: private,
                due: if private { None } else { due },
                ready: !private
                    && (kind(t) != QuestKind::Main
                        || (c.stage != Some(Stage::Rumor)
                            && self.story2_conditions_in(&c.when, s.entered, Some(key))
                            && c.window.is_none_or(|w| self.cast_date() >= w[0] && self.cast_date() <= w[1])
                            && self.story2_deadline(c, s.entered).is_none_or(|d| self.day() <= d))),
            });
        }
        for c in self.state.contracts.values().filter(|c| c.status == ContractStatus::Accepted(OwnerId::Player)) {
            out.push(QuestEntry {
                id: format!("contract:{}", c.id.0),
                kind: QuestKind::Contract,
                status: QuestStatus::Active,
                phase: Phase::Voyage,
                chapter: None,
                entered: 0,
                private_progress: false,
                due: Some(c.deadline),
                ready: true,
            });
        }
        if self.upbringing_active() {
            for g in self.upbringing_annual_goals() {
                let Some(s) = self
                    .state
                    .upbringing
                    .as_ref()
                    .and_then(|s| s.goals.get(&g.key))
                    .filter(|s| s.status == GoalStatus::Active)
                else {
                    continue;
                };
                out.push(QuestEntry {
                    id: format!("goal:{}", g.key),
                    kind: QuestKind::AnnualGoal,
                    status: QuestStatus::Active,
                    phase: Phase::Upbringing,
                    chapter: None,
                    entered: s.since,
                    private_progress: false,
                    due: self.story2_day([g.year, 12, 31]),
                    ready: true,
                });
            }
        }
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    pub fn quest_ids_active(&self) -> Vec<String> {
        self.quest_entries().into_iter().filter(|q| q.status.active()).map(|q| q.id).collect()
    }

    pub fn quest_pin_id(&self, entries: &[QuestEntry]) -> (Option<String>, bool) {
        if let Some(id) = &self.state.story2.pinned
            && entries.iter().any(|q| &q.id == id && q.status.active())
        {
            return (Some(id.clone()), false);
        }
        let key = |q: &QuestEntry| {
            let rank = match q.kind {
                QuestKind::Guide => 0,
                QuestKind::Main => 1,
                QuestKind::Contract => 2,
                QuestKind::AnnualGoal => 3,
                _ => 4,
            };
            (
                rank,
                !q.ready,
                if matches!(q.kind, QuestKind::Main | QuestKind::Contract) { q.due.unwrap_or(u32::MAX) } else { 0 },
                q.id.clone(),
            )
        };
        (
            entries
                .iter()
                .filter(|q| q.status.active() && q.phase == self.quest_phase())
                .min_by_key(|q| key(q))
                .map(|q| q.id.clone()),
            true,
        )
    }

    pub(crate) fn check_pin_quest(&self, owner: OwnerId, id: &Option<String>) -> Result<(), CommandError> {
        if owner != OwnerId::Player {
            return Err(CommandError::NotOwner);
        }
        if !self.defs.rules.quests.enabled {
            return Err(CommandError::Precondition("quests_disabled".into()));
        }
        if let Some(id) = id
            && !self.quest_ids_active().contains(id)
        {
            return Err(CommandError::NotFound(id.clone()));
        }
        Ok(())
    }
}
