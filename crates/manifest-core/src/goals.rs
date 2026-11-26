//! 剧本与胜负：开局设定（航海士、声望）、胜利目标（净资产、同盟港数量、殖民地、自由沙盒）与失败条件
//! （限期未达成、破产重组次数达到上限）。胜负一旦判定即记录，游戏仍可继续。

use crate::defs::GoalKind;
use crate::ids::*;
use crate::mates::MateRole;
use crate::world::World;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum OutcomeKind {
    Won,
    Lost,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum OutcomeReason {
    /// 达成目标
    GoalReached,
    /// 限期已到仍未达成
    Deadline,
    /// 破产重组次数达到上限
    Reorganizations,
}

/// 胜负结果。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Outcome {
    pub kind: OutcomeKind,
    pub reason: OutcomeReason,
    pub day: u32,
}

impl World {
    /// 目标进度：（当前值, 目标值）；自由沙盒返回 None。
    pub fn goal_progress(&self) -> Option<(i64, i64)> {
        let s = self.defs.scenarios.get(self.state.scenario.idx())?;
        match s.goal.kind {
            GoalKind::NetWorth(target) => {
                let equity = self.state.agents.get(&OwnerId::Player).map(|a| a.ledger.equity()).unwrap_or(0);
                Some((equity, target))
            }
            GoalKind::AllyPorts(n) => {
                let count = self.state.locations.iter().filter(|l| l.ally == Some(OwnerId::Player)).count() as i64;
                Some((count, n as i64))
            }
            GoalKind::Colonies { count, population } => {
                let have = self.colonies_of(OwnerId::Player).filter(|c| c.population >= population).count() as i64;
                Some((have, count as i64))
            }
            GoalKind::Sandbox => None,
            GoalKind::Story => self.story_progress().map(|(done, total)| (i64::from(done), i64::from(total))),
        }
    }

    /// 开局设定：受雇的航海士（第一位担任旗舰舰长）与开局声望。
    pub(crate) fn apply_scenario_start(&mut self) {
        let Some(s) = self.defs.scenarios.get(self.state.scenario.idx()).cloned() else { return };
        let first_fleet = self.fleets_of(OwnerId::Player).map(|f| f.id).next();
        for (i, mate) in s.mates.iter().enumerate() {
            if let Some(m) = self.state.mates.get_mut(mate) {
                m.owner = Some(OwnerId::Player);
                m.hired_on = Some(self.state.day);
                m.role = match (i, first_fleet) {
                    (0, Some(f)) => MateRole::Captain(f),
                    _ => MateRole::None,
                };
            }
        }
        for (faction, value) in &s.reputation {
            self.adjust_reputation(OwnerId::Player, *faction, *value);
        }
        self.refresh_trade_bonus();
    }

    /// 每日末检查胜负（只判定一次）。
    pub(crate) fn check_outcome(&mut self) {
        if self.state.outcome.is_some() || !self.state.agents.contains_key(&OwnerId::Player) {
            return;
        }
        let Some(s) = self.defs.scenarios.get(self.state.scenario.idx()) else { return };
        let day = self.state.day;
        let reorganizations = self.state.agents.get(&OwnerId::Player).map(|a| a.reorganizations).unwrap_or(0);
        let outcome = if s.max_reorganizations > 0 && reorganizations >= s.max_reorganizations {
            Some((OutcomeKind::Lost, OutcomeReason::Reorganizations))
        } else if self.goal_progress().is_some_and(|(cur, target)| cur >= target) {
            Some((OutcomeKind::Won, OutcomeReason::GoalReached))
        } else if s.goal.deadline.is_some_and(|d| day + 1 >= d) && s.goal.kind != GoalKind::Sandbox {
            Some((OutcomeKind::Lost, OutcomeReason::Deadline))
        } else {
            None
        };
        if let Some((kind, reason)) = outcome {
            self.state.outcome = Some(Outcome { kind, reason, day });
        }
    }
}
