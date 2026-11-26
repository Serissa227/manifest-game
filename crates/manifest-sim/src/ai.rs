//! 把 AI 管线接入游戏会话。
//!
//! 按固定日程产生 AI 任务（事件导演、传闻、商会战略、委托合同、编年史、组合事件）以及玩家发起的议价；
//! 任务在后台（异步）处理，通过裁决与内核校验的命令排到下一个 tick 并写入命令日志。
//! 无界面模拟使用"同步推进"方式：当天的任务处理完再推进下一天，结果可复现。

use crate::SimError;
use crate::session::GameSession;
use manifest_ai::{AiMode, AiOutcome, AiPipeline, AiSettings, MockLlm, Provider, TaskRequest};
use manifest_core::ids::*;
use manifest_core::replay::Source;
use manifest_core::{Command, World};
use manifest_data::AiContent;
use std::sync::Arc;

/// 驱动 AI 管线的执行器。
pub struct AiDriver {
    pipeline: Arc<AiPipeline>,
    runtime: tokio::runtime::Runtime,
}

impl AiDriver {
    pub fn new(pipeline: AiPipeline) -> Result<Self, SimError> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|e| SimError::Ai(format!("无法创建异步运行时：{e}")))?;
        Ok(Self { pipeline: Arc::new(pipeline), runtime })
    }

    /// 按模式创建：离线模板或 Mock LLM（真实提供商由界面层配置后通过 [`AiDriver::new`] 创建）。
    pub fn with_mode(content: Arc<AiContent>, mode: AiMode) -> Result<Option<Self>, SimError> {
        let settings = AiSettings { mode, ..AiSettings::default() };
        let pipeline = match mode {
            AiMode::Off => return Ok(None),
            AiMode::Offline => AiPipeline::new(content, &settings, None),
            AiMode::Mock => AiPipeline::new(content, &settings, Some(Provider::Mock(MockLlm::plausible()))),
            AiMode::Live => return Err(SimError::Ai("真实提供商需要在设置中配置".into())),
        };
        Ok(Some(Self::new(pipeline)?))
    }

    pub fn pipeline(&self) -> &Arc<AiPipeline> {
        &self.pipeline
    }

    /// 当天按日程应产生的任务。
    pub fn due_requests(world: &World) -> Vec<TaskRequest> {
        let day = world.day();
        let calendar = &world.defs.calendar;
        let month_day = calendar.date_of(day).day - 1;
        let mut out = Vec::new();
        if world.defs.world_key != "classic" {
            out.extend(
                world
                    .defs
                    .history
                    .events
                    .iter()
                    .filter(|e| {
                        e.ripple_budget > 0 && manifest_core::summary::ripple::available(world, &e.key).is_some()
                    })
                    .take(1)
                    .map(|e| TaskRequest::Ripple { event: e.key.clone() }),
            );
        }
        out.extend(manifest_core::summary::text::due_targets(world).into_iter().map(|target| match target {
            manifest_core::summary::text::TextTarget::Narration { event, phase } => {
                TaskRequest::Narration { event, phase }
            }
            manifest_core::summary::text::TextTarget::Letter { id, purpose } => TaskRequest::Letter { id, purpose },
            manifest_core::summary::text::TextTarget::AltChronicle { year } => TaskRequest::AltChronicle { year },
            manifest_core::summary::text::TextTarget::Diary { year, month } => TaskRequest::Diary { year, month },
        }));
        if day % 10 == 5 {
            out.push(TaskRequest::Director);
        }
        if day % 3 == 1 {
            out.push(TaskRequest::Rumor);
        }
        for a in world.state.agents.values() {
            if let Some(c) = a.owner.company()
                && !a.bankrupt
                && day % 30 == (10 + c.0 as u32 * 3) % 30
            {
                out.push(TaskRequest::Strategy { company: c });
            }
        }
        if day % 30 == 20 {
            out.push(TaskRequest::Contract);
        }
        if day >= calendar.year_days() && day % calendar.year_days() == 2.min(calendar.year_days() - 1) {
            out.push(TaskRequest::Chronicle { year: day / calendar.year_days() - 1 });
        }
        // 组合事件：每 15 天一次（冷却期或年度上限未到时，准备阶段直接跳过）
        if day % 15 == 8 {
            out.push(TaskRequest::Composed);
        }
        // 商会展望（ECONOMY.md 8.2）：每家商会每月一次，与战略备忘错开
        for a in world.state.agents.values() {
            if let Some(c) = a.owner.company()
                && !a.bankrupt
                && month_day == (20 + c.0 as u32 * 3) % calendar.month_days(day)
            {
                out.push(TaskRequest::Outlook { company: c });
            }
        }
        // 市场月报（8.5）：每月初，为上个月行情变化最大的至多两个海区各写一篇
        if month_day == 2.min(calendar.month_days(day) - 1) {
            out.extend(world.report_regions().into_iter().map(|region| TaskRequest::MarketReport { region }));
        }
        if world.defs.world_key != "classic" && day.is_multiple_of(3) {
            let person = world
                .defs
                .cast
                .persons
                .iter()
                .find(|p| manifest_core::summary::ai::check_free(world, OwnerId::Player, &p.key, "占位。").is_ok());
            if let Some(person) = person {
                out.push(TaskRequest::Daily { owner: OwnerId::Player, person: person.key.clone() });
            }
        }
        out
    }

    /// 同步处理一个任务：准备 → 处理 → 转为命令。
    pub fn run_request(&self, world: &World, request: TaskRequest) -> (Option<AiOutcome>, Vec<Command>) {
        let Some(task) = self.pipeline.prepare(world, request) else { return (None, Vec::new()) };
        let outcome = self.runtime.block_on(self.pipeline.process(task));
        let cmds = self.pipeline.finalize(world, &outcome);
        (Some(outcome), cmds)
    }

    /// 处理当天日程上的全部任务，把通过校验的命令排到下一个 tick。返回排期的命令数。
    pub fn run_due(&self, session: &mut GameSession) -> usize {
        let mut scheduled = 0;
        for req in Self::due_requests(&session.world) {
            let (_, cmds) = self.run_request(&session.world, req);
            let tick = session.day() + 1;
            for c in cmds {
                session.schedule(tick, Source::Ai, c);
                scheduled += 1;
            }
        }
        scheduled
    }

    /// 玩家发起议价：返回裁决结果（意图、回复等）；命令排到下一个 tick。
    pub fn bargain(&self, session: &mut GameSession, owner: OwnerId, loc: LocId, text: String) -> Option<AiOutcome> {
        let (outcome, cmds) = self.run_request(&session.world, TaskRequest::Bargain { owner, loc, player_text: text });
        let tick = session.day() + 1;
        for c in cmds {
            session.schedule(tick, Source::Ai, c);
        }
        outcome
    }
}
