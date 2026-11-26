//! P03：用不会访问网络的 Mock 管线控制执行时机，验证准入与结果领取之间的整个队列边界。
use super::*;
use manifest_ai::{AiSettings, TaskRequest};
use std::time::Duration;

fn resources() -> Arc<WorldResources> {
    WorldRegistry::load(&manifest_data::find_data_dir().unwrap()).unwrap().get("classic").unwrap().clone()
}

fn pipeline(mode: AiMode, resources: &WorldResources) -> AiPipeline {
    let settings = AiSettings { mode, ..AiSettings::default() };
    let provider = (mode == AiMode::Mock).then(|| Provider::Mock(MockLlm::plausible()));
    AiPipeline::new(resources.content.clone(), &settings, provider)
}

fn fixture() -> (AiRunner, GameSession, tokio::runtime::Runtime) {
    let resources = resources();
    let mut runner = AiRunner::new(pipeline(AiMode::Mock, &resources));
    // 只在测试里走后台调度，提供商仍是纯 Mock，不调用真实服务。
    runner.background = true;
    let mut session =
        GameSession::new(resources.defs.clone(), resources.defs.find_scenario("newcomer").unwrap(), 42).unwrap();
    session.world.state.day = 5;
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    (runner, session, rt)
}

fn finish(runner: &AiRunner, rt: &tokio::runtime::Runtime) {
    rt.block_on(async {
        tokio::time::timeout(Duration::from_secs(10), async {
            while !runner.tasks.lock().unwrap().iter().all(|task| task.is_finished()) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    });
}

#[test]
fn queue_is_bounded_before_any_context_is_prepared_and_old_requests_expire() {
    let (runner, mut session, rt) = fixture();
    let permits: Vec<_> = (0..MAX_BACKGROUND_TASKS).map(|_| runner.lease().unwrap()).collect();
    let before = session.to_save();
    let due = AiDriver::due_requests(&session.world).len();
    assert!(due > 0);
    for _ in 0..64 {
        assert_eq!(runner.run_due(&mut session, &rt), 0);
    }
    let stats = runner.queue_stats();
    assert_eq!(stats.pending, MAX_PENDING_TASKS);
    assert_eq!(stats.occupied, MAX_BACKGROUND_TASKS);
    assert_eq!(stats.prepare_calls, 0, "没有许可时不得准备世界摘要");
    assert_eq!(stats.dropped, 64 * due - MAX_PENDING_TASKS);
    assert_eq!(session.to_save(), before);
    drop(permits);
    session.world.state.day += MAX_BACKGROUND_AGE_DAYS + 1;
    let fresh_due = AiDriver::due_requests(&session.world).len();
    runner.run_due(&mut session, &rt);
    assert_eq!(runner.queue_stats().expired, MAX_PENDING_TASKS);
    assert!(runner.queue_stats().prepare_calls <= fresh_due, "过期请求不进入 prepare");
    assert!(runner.queue_stats().occupied <= MAX_BACKGROUND_TASKS);
}

#[test]
fn completed_results_hold_capacity_until_drained_and_stale_results_do_not_schedule() {
    let (runner, mut session, rt) = fixture();
    for _ in 0..8 {
        runner.run_due(&mut session, &rt);
    }
    assert_eq!(runner.queue_stats().prepare_calls, MAX_BACKGROUND_TASKS);
    finish(&runner, &rt);
    assert_eq!(runner.queue_stats().occupied, MAX_BACKGROUND_TASKS, "完成但未领取也计入上限");
    session.world.state.day += MAX_BACKGROUND_AGE_DAYS + 1;
    let before = session.to_save();
    assert_eq!(runner.drain(&mut session), 0);
    assert_eq!(session.to_save(), before, "过期回复不能修改世界或命令日志");
    assert_eq!(runner.queue_stats().expired, MAX_BACKGROUND_TASKS);
    assert_eq!(runner.queue_stats().occupied, 0);
}

#[test]
fn reconfiguration_cancels_foreground_and_unstarted_background_tasks() {
    let (runner, mut session, rt) = fixture();
    let foreground = runner.foreground(&mut session).unwrap().unwrap();
    for _ in 0..32 {
        runner.run_due(&mut session, &rt);
    }
    assert!(runner.foreground(&mut session).is_err());
    let weak = Arc::downgrade(&runner.pipeline);
    drop(runner);
    assert!(foreground.cancelled());
    rt.block_on(async {
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
    });
    assert!(weak.upgrade().is_none(), "被取消任务不能继续持有管线与上下文");
}

#[test]
fn synchronous_off_offline_and_mock_preserve_the_reference_command_log() {
    let resources = resources();
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    for mode in [AiMode::Off, AiMode::Offline, AiMode::Mock] {
        let dir = std::env::temp_dir().join(format!("manifest-p03-ai-sync-{}-{mode:?}", std::process::id()));
        let st = AppState::from_data_dir(
            &manifest_data::find_data_dir().unwrap(),
            Arc::new(manifest_ai::MemoryKeyStore::default()),
            AppPaths::in_dir(&dir),
        )
        .unwrap();
        let mut settings = st.settings();
        settings.ai.mode = mode;
        settings.ai.jev_enabled = false;
        st.set_settings(settings).unwrap();
        let runner = st.build_ai().unwrap();
        assert_eq!(runner.is_none(), mode == AiMode::Off);
        assert!(runner.as_ref().is_none_or(|r| !r.background()));
        let reference = AiDriver::with_mode(resources.content.clone(), mode).unwrap();
        let make =
            || GameSession::new(resources.defs.clone(), resources.defs.find_scenario("newcomer").unwrap(), 9).unwrap();
        let (mut actual, mut expected) = (make(), make());
        for _ in 0..90 {
            actual.advance_day().unwrap();
            expected.advance_day().unwrap();
            let count = reference.as_ref().map_or(0, |driver| driver.run_due(&mut expected));
            assert_eq!(runner.as_ref().map_or(0, |r| r.run_due(&mut actual, &rt)), count);
        }
        assert_eq!(actual.to_save(), expected.to_save(), "{mode:?} 必须逐命令保持原同步结果");
        assert_eq!(runner.as_ref().map_or(AiQueueStats::default(), AiRunner::queue_stats), AiQueueStats::default());
    }
}

#[test]
fn an_accepted_background_result_still_uses_pipeline_finalization() {
    let (runner, mut session, rt) = fixture();
    let task = runner.pipeline.prepare(&session.world, TaskRequest::Director).unwrap();
    let expected = rt.block_on(runner.pipeline.process(task));
    let commands = runner.pipeline.finalize(&session.world, &expected);
    assert!(!commands.is_empty(), "夹具必须实际产生可裁决命令");
    let lease = runner.lease().unwrap();
    runner
        .tx
        .try_send(CompletedAi { day: session.day(), outcome: expected, _lease: lease })
        .unwrap_or_else(|_| panic!("结果通道应有空位"));
    assert_eq!(runner.drain(&mut session), commands.len());
    assert_eq!(runner.queue_stats().occupied, 0);
}

#[test]
fn foreground_handlers_reject_before_prepare_when_all_slots_are_occupied() {
    let dir = std::env::temp_dir().join(format!("manifest-p03-ai-foreground-{}", std::process::id()));
    let st = AppState::from_data_dir(
        &manifest_data::find_data_dir().unwrap(),
        Arc::new(manifest_ai::MemoryKeyStore::default()),
        AppPaths::in_dir(&dir),
    )
    .unwrap();
    let mut settings = st.settings();
    settings.ai.mode = AiMode::Mock;
    settings.ai.jev_enabled = false;
    settings.autosave_days = 0;
    crate::handlers::save_settings(&st, settings).unwrap();
    let overview = crate::handlers::new_game(&st, "newcomer", Some(42)).unwrap();
    let loc = overview.fleets[0].docked.unwrap();
    let held: Vec<_> = {
        let mut guard = st.game().unwrap();
        let runner = guard.as_mut().unwrap().ai.as_mut().unwrap();
        runner.background = true;
        (0..MAX_BACKGROUND_TASKS).map(|_| runner.lease().unwrap()).collect()
    };
    let before = st.game().unwrap().as_ref().unwrap().session.to_save();
    let bargain = crate::handlers::bargain(&st, loc, "便宜一点".into());
    assert!(matches!(bargain, Err(AppError::Invalid(msg)) if msg.key == "app.ai_busy"));
    let note = crate::handlers::review_comment(&st, 1, "港口".into(), vec!["价格上涨".into()]);
    assert!(matches!(note, Err(AppError::Invalid(msg)) if msg.key == "app.ai_busy"));
    assert_eq!(st.game().unwrap().as_ref().unwrap().session.to_save(), before);
    drop(held);
    assert!(crate::handlers::bargain(&st, loc, "便宜一点".into()).unwrap().accepted);
}
