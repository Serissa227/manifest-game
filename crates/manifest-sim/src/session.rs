//! 游戏会话：世界 + 命令日志 + 已排期的未来命令。
//!
//! - 玩家命令：立即校验并在当前 tick 的"命令执行"阶段执行（因为 tick 的其余步骤尚未开始，
//!   这与在 tick 开头执行等价），成功才写入日志。
//! - AI 等来源的命令：排期到未来某个 tick，接受时即写入日志；到该 tick 开始时执行。
//! - 推进一天：完成当天其余步骤，然后"打开"下一个 tick（执行排在该 tick 的命令）。
//!
//! 同一 tick 内按全局序号执行，因此重放只需按 (tick, seq) 排序日志。

use crate::SimError;
use manifest_core::replay::{LogEntry, Source, StartParams};
use manifest_core::{Command, CommandError, CommandOutcome, DayReport, SaveFile, ScenarioId, StaticData, World};
use std::collections::BTreeMap;
use std::sync::Arc;

pub use manifest_core::scenario::{BootstrapProgress, NewGameRequest};

pub struct GameSession {
    pub world: World,
    pub start: StartParams,
    log: Vec<LogEntry>,
    next_seq: u64,
    /// 已排期、尚未执行的命令（按 tick）
    pending: BTreeMap<u32, Vec<LogEntry>>,
}

impl GameSession {
    pub fn new(defs: Arc<StaticData>, scenario: ScenarioId, seed: u64) -> Result<Self, SimError> {
        let first = defs.scenarios.get(scenario.idx()).ok_or(manifest_core::CoreError::UnknownScenario)?.start_date;
        let first = manifest_core::scenario::day_of(&defs, first)?;
        let world = World::new(defs, scenario, seed)?;
        let mut start = StartParams::new(scenario, seed);
        start.bootstrap_days = world.day() - first;
        Ok(Self { world, start, log: Vec::new(), next_seq: 0, pending: BTreeMap::new() })
    }

    /// I1 世界开局。应用层可将 progress 原样推送为 bootstrap 事件。
    pub fn new_world(
        defs: Arc<StaticData>,
        request: NewGameRequest,
        progress: impl FnMut(BootstrapProgress),
    ) -> Result<Self, SimError> {
        let scenario = defs.find_scenario(&request.scenario).ok_or(manifest_core::CoreError::UnknownScenario)?;
        let sc = &defs.scenarios[scenario.idx()];
        let first = manifest_core::scenario::day_of(&defs, sc.start_date)?;
        let control = manifest_core::scenario::day_of(&defs, sc.control_date)?;
        let bootstrap_days = control
            .checked_sub(first)
            .ok_or_else(|| manifest_core::scenario::invalid("control_date 不能早于 start_date"))?;
        let start = StartParams { scenario, seed: request.seed.unwrap_or(42), opening: Some(request), bootstrap_days };
        let world = World::from_start(defs, &start, progress)?;
        Ok(Self { world, start, log: Vec::new(), next_seq: 0, pending: BTreeMap::new() })
    }

    pub fn defs(&self) -> &Arc<StaticData> {
        &self.world.defs
    }

    pub fn day(&self) -> u32 {
        self.world.day()
    }

    pub fn log(&self) -> &[LogEntry] {
        &self.log
    }

    /// 开局时选定行情情报（ECONOMY.md 第 7 节）：随船传递时提交 `SetInfoMode`（写入日志、重放时照做）；实时模式什么也不做。
    pub fn choose_info(&mut self, mode: manifest_core::info::InfoMode) -> Result<(), SimError> {
        if mode == manifest_core::info::InfoMode::Live {
            return Ok(());
        }
        self.submit(Command::SetInfoMode { owner: manifest_core::ids::OwnerId::Player, mode })
            .map(|_| ())
            .map_err(|e| SimError::Storage(format!("无法选择行情情报：{e}")))
    }

    /// 玩家（或 bot）命令：立即执行，成功则写入日志。
    pub fn submit(&mut self, command: Command) -> Result<CommandOutcome, CommandError> {
        self.submit_from(Source::Player, command)
    }

    /// 应用时钟使用从当天 6:00 起的分钟；检查失败时不分配日志序号。
    pub fn submit_at(&mut self, minute: u16, command: Command) -> Result<CommandOutcome, CommandError> {
        self.submit_from_at(minute, Source::Player, command)
    }

    /// 记录即时系统命令的日内位置，与玩家命令使用相同的导航投影。
    pub fn submit_from_at(
        &mut self,
        minute: u16,
        source: Source,
        command: Command,
    ) -> Result<CommandOutcome, CommandError> {
        if let Some(at) = command.navigation_minute() {
            manifest_core::navigation::orders::check_minute(at, minute)?;
        }
        if !self.world.defs.manual_navigation {
            return self.submit_from(source, command);
        }
        let outcome = command.apply_at(&mut self.world, minute)?;
        let seq = self.alloc_seq();
        self.log.push(LogEntry { tick: self.world.day(), seq, source, command, minute: Some(minute) });
        Ok(outcome)
    }

    pub fn submit_from(&mut self, source: Source, command: Command) -> Result<CommandOutcome, CommandError> {
        let outcome = command.apply(&mut self.world)?;
        let seq = self.alloc_seq();
        self.log.push(LogEntry { tick: self.world.day(), seq, source, command, minute: None });
        Ok(outcome)
    }

    /// 排期一条命令到未来的 tick（至少为下一个 tick），立即写入日志。返回实际排定的 tick。
    pub fn schedule(&mut self, tick: u32, source: Source, command: Command) -> u32 {
        let tick = tick.max(self.world.day() + 1);
        let seq = self.alloc_seq();
        let entry = LogEntry { tick, seq, source, command, minute: None };
        self.log.push(entry.clone());
        self.pending.entry(tick).or_default().push(entry);
        tick
    }

    fn alloc_seq(&mut self) -> u64 {
        let s = self.next_seq;
        self.next_seq += 1;
        s
    }

    /// 推进一天：完成当前 tick，并打开下一个 tick。
    pub fn advance_day(&mut self) -> Result<DayReport, SimError> {
        self.advance_day_with(|_| {})
    }

    /// 每个新日期都处理排期并通知调用方，彼界时间差不能漏掉AI与预测的日界工作。
    pub fn advance_day_with(&mut self, mut opened: impl FnMut(&mut Self)) -> Result<DayReport, SimError> {
        let mut report = self.world.end_day_with(|_| false)?;
        Self::open_tick(&mut self.world, &mut self.pending);
        opened(self);
        let mut skipped = 0;
        while self.world.realm_skipping() && skipped < manifest_core::realms::MAX_SKIP {
            let next = self.world.end_day_with(|_| false)?;
            report.day = next.day;
            report.arrivals.extend(next.arrivals);
            report.month_end |= next.month_end;
            report.year_end |= next.year_end;
            Self::open_tick(&mut self.world, &mut self.pending);
            opened(self);
            skipped += 1;
        }
        Ok(report)
    }

    /// 执行排在当前 tick 的命令（结果与原局一致，失败的命令同样被忽略）。
    fn open_tick(world: &mut World, pending: &mut BTreeMap<u32, Vec<LogEntry>>) {
        let day = world.day();
        if let Some(mut entries) = pending.remove(&day) {
            entries.sort_by_key(|e| e.seq);
            for e in entries {
                let _ = e.apply(world);
            }
        }
    }

    /// 生成存档。
    pub fn to_save(&self) -> SaveFile {
        SaveFile::new(&self.world.defs, self.start.clone(), self.world.state.clone(), self.log.clone())
    }

    /// 从存档恢复：快照即当前状态，日志中 tick 晚于快照日期的命令重新排期。
    pub fn from_save(defs: Arc<StaticData>, save: SaveFile) -> Result<Self, SimError> {
        save.check_compatible(&defs)?;
        let seen: BTreeMap<_, _> =
            save.snapshot.items.owners.iter().map(|(owner, inv)| (*owner, inv.seen.clone())).collect();
        let mut world = World::from_snapshot(defs, save.snapshot)?;
        // 恢复货架和拍卖不算一次新见闻；保留存下来的图鉴，失效键仍由内核清理。
        world.state.items.owners.retain(|owner, inv| {
            if let Some(before) = seen.get(owner) {
                inv.seen.retain(|key| before.contains(key));
                true
            } else {
                inv.seen.clear();
                *inv != manifest_core::items::Inventory::default()
            }
        });
        let day = world.day();
        let next_seq = save.log.iter().map(|e| e.seq + 1).max().unwrap_or(0);
        let mut pending: BTreeMap<u32, Vec<LogEntry>> = BTreeMap::new();
        for e in &save.log {
            if e.tick > day {
                pending.entry(e.tick).or_default().push(e.clone());
            }
        }
        Ok(Self { world, start: save.start, log: save.log, next_seq, pending })
    }

    /// 只用日志从开局重放到当前时刻（含当前 tick 已执行的命令），返回重放得到的世界。
    pub fn replay(&self) -> Result<World, SimError> {
        replay_to(self.world.defs.clone(), self.start.clone(), &self.log, self.world.day())
    }
}

/// 从开局按日志重放：推进 `day` 天后，再执行排在第 `day` 个 tick 的命令。
pub fn replay_to(defs: Arc<StaticData>, start: StartParams, log: &[LogEntry], day: u32) -> Result<World, SimError> {
    let mut world = World::from_start(defs, &start, |_| {})?;
    manifest_core::replay::replay_onto(&mut world, log, day)?;
    let mut current: Vec<&LogEntry> = log.iter().filter(|e| e.tick == day).collect();
    current.sort_by_key(|e| e.seq);
    for e in current {
        let _ = e.apply(&mut world);
    }
    Ok(world)
}
