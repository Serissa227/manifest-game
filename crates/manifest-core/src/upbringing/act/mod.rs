//! R10-U06K1：养成行动制；旧存档与未启用的家庭仍走原循环。
use super::*;
use crate::{Command, CommandError, CoreError, OwnerId, World};

mod actions;
mod bot;
mod defs;
mod index;
mod lessons;
mod markers;
mod presence;
mod rules;
mod settlement;
mod state;
pub mod validation;
mod week;
pub use actions::{ActFreeStop, ActPlaceAction, job_group};
pub use defs::*;
pub use index::{ActIndex, MarkerIndex, build_index};
pub use rules::*;
pub use state::*;
pub use week::{ActCalendarMark, act_stop_blocking, difference};
pub mod capital;
mod k2_defs;
pub mod k2_validation;
mod ladder;
mod results;
mod review;
pub use k2_defs::*;
pub use ladder::{RequiredLine, TierStatus};
mod rumors;
mod tides;
pub use tides::TideEffects;
mod voyage;

pub(crate) fn reason(code: &'static str) -> CommandError {
    CommandError::Rule(crate::error::Reason::new(code, "（待写）"))
}
pub(crate) fn argument(code: &'static str, key: &'static str, value: i64) -> CommandError {
    CommandError::Rule(crate::error::Reason::new(code, "（待写）").arg(key, crate::text::TextArg::Int(value)))
}
pub(crate) fn internal(error: impl std::fmt::Display) -> CoreError {
    CoreError::Internal(error.to_string())
}
impl World {
    pub fn act_rules(&self) -> Option<&ActRules> {
        self.defs.rules.upbringing.act.as_ref()
    }
    pub fn act_running(&self) -> bool {
        self.act_rules().is_some_and(|r| r.enabled)
            && self.upbringing_active()
            && self
                .state
                .upbringing
                .as_ref()
                .is_some_and(|s| s.act.on && !s.skipping && matches!(s.phase, Phase::Plan | Phase::Running))
    }
    pub(crate) fn act_waiting(&self) -> bool {
        self.act_running()
            && self.state.upbringing.as_ref().is_some_and(|s| {
                matches!(s.act.phase, ActPhase::Plan | ActPhase::Moment | ActPhase::Free | ActPhase::Summary)
            })
    }
    pub fn act_stage_key(&self) -> String {
        self.upbringing_academy().map_or_else(|| "home".into(), |a| format!("academy:{}", a.key))
    }
    pub fn act_phase(&self) -> ActPhase {
        self.state.upbringing.as_ref().map_or(ActPhase::Plan, |s| s.act.phase)
    }
    pub fn act_day(&self) -> u32 {
        let d = self.cast_date()[2];
        d - weekly::week_start(weekly::week_of(d)) + 1
    }
    pub fn act_lesson_days(&self) -> &[u8] {
        self.act_rules().map_or(&[], |r| {
            if self.act_sailing() {
                &r.voyage.task_days
            } else if self.upbringing_academy().is_some() {
                &r.lesson_days.academy
            } else {
                &r.lesson_days.home
            }
        })
    }
    pub fn act_lesson_plan(&self) -> &[LessonPlan] {
        self.state
            .upbringing
            .as_ref()
            .and_then(|s| {
                s.act.voyage.as_ref().map(|v| &v.plan).or_else(|| s.act.timetables.get(&self.act_stage_key()))
            })
            .map_or(&[], Vec::as_slice)
    }
    pub fn act_line_here(&self, line: &LineDef) -> bool {
        self.upbringing_family().is_some_and(|f| f.key == line.family)
            && self
                .upbringing_stage_on(self.cast_date())
                .is_some_and(|s| s.stage == line.stage && s.academy.as_deref().unwrap_or("") == line.academy)
    }
    fn act_story_waiting(&self) -> bool {
        !self.state.story2.pending.is_empty() || self.state.story.pending.is_some()
    }
    fn act_require_phase(&self, phase: ActPhase) -> Result<(), CommandError> {
        if self.act_phase() == phase {
            Ok(())
        } else {
            Err(CommandError::Rule(
                crate::error::Reason::new("ub.act.phase", "（待写）")
                    .arg("phase", crate::text::TextArg::Text(self.act_phase().key().into())),
            ))
        }
    }
    pub(crate) fn check_act_command(&self, command: &Command) -> Result<Box<crate::WorldState>, CommandError> {
        if command.owner() != Some(OwnerId::Player) {
            return Err(CommandError::NotOwner);
        }
        if !self.act_running() {
            return Err(reason("ub.act.off"));
        }
        if self.act_story_waiting() {
            return Err(reason("ub.act.story"));
        }
        let mut next = self.clone();
        next.apply_act_command(command)?;
        next.act_refresh_markers(false);
        Ok(Box::new(next.state))
    }
}

impl World {
    /// K2 直接接入既有行动制总开关，不增加分段开关与旧路。
    pub fn act_ladder_on(&self) -> bool {
        self.act_running()
    }
    pub fn act_review_running(&self) -> bool {
        self.act_running()
    }
    pub fn act_review_on(&self) -> bool {
        self.act_rules().is_some_and(|r| r.enabled) && self.state.upbringing.as_ref().is_some_and(|s| s.act.on)
    }
    pub fn act_stage_on(&self, name: &str) -> bool {
        self.act_running() && self.act_rules().is_some_and(|r| r.stages.iter().any(|s| s == name))
    }
}
