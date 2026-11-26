//! 命令日志与重放。
//!
//! 日志记录每条被接受的命令及其执行 tick 与全局序号。重放只读日志：
//! 同一初始条件 + 同一日志 ⇒ 同一状态哈希。

use crate::command::Command;
use crate::defs::StaticData;
use crate::error::CoreError;
use crate::ids::ScenarioId;
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// 命令来源。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Source {
    Player,
    /// 被接受的 AI 提案
    Ai,
    System,
}

/// 日志中的一条命令。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LogEntry {
    /// 执行的 tick
    pub tick: u32,
    /// 全局序号：同一 tick 内按序号执行
    pub seq: u64,
    pub source: Source,
    pub command: Command,
    /// 应用层提交时实际走到的分钟；经典及旧日志不写入。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minute: Option<u16>,
}

impl LogEntry {
    pub fn apply(&self, world: &mut World) -> Result<crate::CommandOutcome, crate::CommandError> {
        match self.minute {
            Some(minute) => self.command.apply_at(world, minute),
            None => self.command.apply(world),
        }
    }
}

/// 开局参数。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StartParams {
    pub scenario: ScenarioId,
    pub seed: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opening: Option<crate::scenario::NewGameRequest>,
    /// 命令日志起点之前运行的天数，经典开局为 0 并省略。
    #[serde(default, skip_serializing_if = "is_zero")]
    pub bootstrap_days: u32,
}

fn is_zero(value: &u32) -> bool {
    *value == 0
}

impl StartParams {
    pub fn new(scenario: ScenarioId, seed: u64) -> Self {
        Self { scenario, seed, opening: None, bootstrap_days: 0 }
    }
}

/// 从开局按日志重放 `days` 天。
pub fn replay(defs: Arc<StaticData>, start: StartParams, log: &[LogEntry], days: u32) -> Result<World, CoreError> {
    let mut world = World::from_start(defs, &start, |_| {})?;
    replay_onto(&mut world, log, days)?;
    Ok(world)
}

/// 在已有世界上按日志继续推进到第 `until_day` 天。
pub fn replay_onto(world: &mut World, log: &[LogEntry], until_day: u32) -> Result<(), CoreError> {
    if until_day < world.day() {
        return Err(crate::scenario::invalid("重放终点早于玩家控制日"));
    }
    let mut entries: Vec<&LogEntry> = log.iter().filter(|e| e.tick >= world.day()).collect();
    entries.sort_by_key(|e| (e.tick, e.seq));
    let mut idx = 0;
    while world.day() < until_day {
        let day = world.day();
        while idx < entries.len() && entries[idx].tick == day {
            // 执行失败的命令在原局中同样失败，重放时忽略结果即可保持一致
            let _ = entries[idx].apply(world);
            idx += 1;
        }
        world.end_day_with(|world| {
            let day = world.day();
            // 当前终点的命令由 replay_to 沿用原规则执行；跳日途中不能漏掉命令日志。
            if day >= until_day {
                return false;
            }
            while idx < entries.len() && entries[idx].tick == day {
                let _ = entries[idx].apply(world);
                idx += 1;
            }
            true
        })?;
    }
    Ok(())
}
