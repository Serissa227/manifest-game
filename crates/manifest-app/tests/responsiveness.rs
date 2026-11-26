//! 响应性：AI 的网络请求（在线模型、Jev）不在持有游戏锁时等待，推进与界面查询不被卡住；
//! 数据在后台加载完成前，界面请求等待而不是失败。

use manifest_ai::{AiMode, KeyStore, MemoryKeyStore, ProviderKind, Secret};
use manifest_app::{AppHolder, AppPaths, AppState, handlers};
use serde_json::json;
use std::sync::Arc;
use std::time::{Duration, Instant};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn app(dir: &std::path::Path, keys: Arc<MemoryKeyStore>) -> AppState {
    let data = manifest_data::find_data_dir().expect("找到 data/");
    AppState::from_data_dir(&data, keys, AppPaths::in_dir(dir)).unwrap()
}

fn anthropic_reply(text: &str) -> serde_json::Value {
    json!({
        "id": "msg_test", "type": "message", "role": "assistant", "model": "claude-sonnet-5",
        "content": [{"type": "text", "text": text}],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 50, "output_tokens": 20},
    })
}

/// 在线模型：议价在锁外等待 LLM；等待期间推进与查询照常进行，换了一局游戏则结果作废。
#[test]
fn bargain_waits_for_the_llm_outside_the_game_lock() {
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let server = rt.block_on(MockServer::start());
    rt.block_on(
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(anthropic_reply(r#"{"reply":"好吧，给你便宜点。"}"#))
                    .set_delay(Duration::from_millis(1_500)),
            )
            .mount(&server),
    );
    let tmp = tempfile::tempdir().unwrap();
    let keys = Arc::new(MemoryKeyStore::default());
    keys.set("anthropic", &Secret::new("sk-test-responsive")).unwrap();
    let st = app(tmp.path(), keys);
    let mut settings = handlers::get_settings(&st).settings;
    settings.ai.mode = AiMode::Live;
    settings.ai.provider = ProviderKind::Anthropic;
    settings.ai.base_url = server.uri();
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings).unwrap();
    let o = handlers::new_game(&st, "newcomer", Some(5)).unwrap();
    let loc = o.fleets[0].docked.unwrap();

    let worker = {
        let st = st.clone();
        std::thread::spawn(move || handlers::bargain(&st, loc, "老板，便宜一点吧".into()))
    };
    std::thread::sleep(Duration::from_millis(300));
    // LLM 还没回复：查询与推进都应立即完成
    let t = Instant::now();
    handlers::overview(&st).unwrap();
    handlers::port(&st, loc).unwrap();
    handlers::step(&st, 1).unwrap();
    assert!(t.elapsed() < Duration::from_millis(500), "等待 LLM 期间界面被卡住：{:?}", t.elapsed());
    assert!(!worker.is_finished(), "议价应仍在等待 LLM");
    let reply = worker.join().unwrap().unwrap();
    assert_eq!(reply.reply, "好吧，给你便宜点。");
    assert_eq!(reply.intent, "discount");
    assert!(reply.accepted);

    // 等待期间换了一局游戏：结果作废，不会把命令排进新游戏
    let worker = {
        let st = st.clone();
        std::thread::spawn(move || handlers::bargain(&st, loc, "便宜点".into()))
    };
    std::thread::sleep(Duration::from_millis(300));
    handlers::new_game(&st, "newcomer", Some(6)).unwrap();
    let r = worker.join().unwrap();
    assert!(r.is_err(), "游戏已切换时议价应作废");
    assert_eq!(handlers::debug(&st).unwrap().ai_commands, 0);
}

/// 离线模板 + Jev：Jev 变慢或超时时，推进不被阻塞；裁决结果在后台完成后排进之后的 tick。
#[cfg(feature = "jev")]
#[test]
fn jev_with_offline_templates_does_not_block_ticks() {
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let server = rt.block_on(MockServer::start());
    rt.block_on(
        Mock::given(method("POST"))
            .and(path("/v1/adjudicate"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"verdict": "accept", "confidence": 0.9, "score": 0.9}))
                    .set_delay(Duration::from_millis(400)),
            )
            .mount(&server),
    );
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), Arc::new(MemoryKeyStore::default()));
    let mut settings = handlers::get_settings(&st).settings;
    settings.ai.mode = AiMode::Offline;
    settings.ai.jev_enabled = true;
    settings.ai.jev_url = server.uri();
    settings.ai.jev_timeout_ms = 5_000;
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings).unwrap();
    handlers::new_game(&st, "newcomer", Some(7)).unwrap();

    // 30 天里有十几个 AI 任务，每个都要等 Jev 400 ms；若同步等待至少要数秒
    let t = Instant::now();
    handlers::step(&st, 30).unwrap();
    assert!(t.elapsed() < Duration::from_millis(1_500), "Jev 请求阻塞了推进：{:?}", t.elapsed());
    // 后台裁决完成后，之后的推进把结果排进命令日志
    let deadline = Instant::now() + Duration::from_secs(20);
    while handlers::debug(&st).unwrap().ai_commands == 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(200));
        handlers::step(&st, 1).unwrap();
    }
    assert!(handlers::debug(&st).unwrap().ai_commands > 0, "Jev 裁决的结果应在之后的 tick 生效");
    let audit = handlers::debug(&st).unwrap().audit;
    assert!(audit.iter().any(|a| a.stage == "裁决" && a.detail.contains("jev")));
}

/// 启动时数据在后台加载：加载完成前的请求等待，加载失败时返回可读的原因。
#[test]
fn requests_wait_for_background_loading() {
    let holder = AppHolder::default();
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().to_path_buf();
    let waiter = {
        let holder = holder.clone();
        std::thread::spawn(move || holder.get().map(|st| handlers::static_data(&st).locations.len()))
    };
    std::thread::sleep(Duration::from_millis(100));
    assert!(!waiter.is_finished(), "加载完成前应等待");
    holder.set(Ok(app(&dir, Arc::new(MemoryKeyStore::default()))));
    assert!(waiter.join().unwrap().unwrap() >= 20);

    let failed = AppHolder::default();
    failed.set(Err("找不到 data/ 目录".into()));
    let err = failed.get().err().unwrap().to_string();
    assert!(err.contains("找不到 data/ 目录"));
}

/// 后台 AI 任务有并发上限；换了 AI 设置后，排队中的任务不再发出请求。
#[cfg(feature = "jev")]
#[test]
fn background_tasks_are_capped_and_cancelled_on_reconfigure() {
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let server = rt.block_on(MockServer::start());
    rt.block_on(
        Mock::given(method("POST"))
            .and(path("/v1/adjudicate"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({"verdict": "accept", "confidence": 0.9, "score": 0.9}))
                    .set_delay(Duration::from_millis(2_000)),
            )
            .mount(&server),
    );
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), Arc::new(MemoryKeyStore::default()));
    let mut settings = handlers::get_settings(&st).settings;
    settings.ai.mode = AiMode::Offline;
    settings.ai.jev_enabled = true;
    settings.ai.jev_url = server.uri();
    settings.ai.jev_timeout_ms = 10_000;
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings.clone()).unwrap();
    handlers::new_game(&st, "newcomer", Some(8)).unwrap();
    handlers::step(&st, 30).unwrap();
    std::thread::sleep(Duration::from_millis(500));
    let cap = manifest_app::state::AiRunner::max_background_tasks();
    let in_flight = rt.block_on(server.received_requests()).unwrap().len();
    assert_eq!(in_flight, cap, "同时发出的请求数应等于并发上限，其余排队");
    // 关闭 Jev：旧的执行器被替换，排队中的任务不再发出请求
    settings.ai.jev_enabled = false;
    handlers::save_settings(&st, settings).unwrap();
    std::thread::sleep(Duration::from_millis(2_600));
    assert_eq!(rt.block_on(server.received_requests()).unwrap().len(), cap, "排队中的任务应被取消");
}

/// 同一槽位的并发存档串行写盘，不报错；较旧的快照不会覆盖较新的存档。
#[test]
fn concurrent_saves_are_serialized() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), Arc::new(MemoryKeyStore::default()));
    let mut settings = handlers::get_settings(&st).settings;
    settings.ai.mode = AiMode::Off;
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings).unwrap();
    handlers::new_game(&st, "newcomer", Some(9)).unwrap();
    let workers: Vec<_> = (0..8)
        .map(|_| {
            let st = st.clone();
            std::thread::spawn(move || {
                handlers::step(&st, 1)?;
                handlers::save_game(&st, "race")
            })
        })
        .collect();
    for w in workers {
        w.join().unwrap().expect("并发存档不应失败");
    }
    let o = handlers::load_game(&st, "race").unwrap();
    assert_eq!(o.day, 8, "保留的是最新的快照");
    let saves = handlers::list_saves(&st).unwrap();
    assert!(saves.iter().any(|s| s.slot == "race" && s.day == 8), "存档与 meta 一致");
}

/// 自动存档写盘失败后，下一天重试，而不是等到下一个周期。
#[test]
fn failed_autosave_is_retried_the_next_day() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), Arc::new(MemoryKeyStore::default()));
    let mut settings = handlers::get_settings(&st).settings;
    settings.ai.mode = AiMode::Off;
    settings.autosave_days = 5;
    handlers::save_settings(&st, settings).unwrap();
    handlers::new_game(&st, "newcomer", Some(10)).unwrap();
    // 让存档目录无法创建：在同一路径放一个文件
    let saves_dir = st.paths().saves_dir.clone();
    std::fs::write(&saves_dir, b"not a directory").unwrap();
    assert!(handlers::step(&st, 5).is_err(), "第 5 天自动存档应写盘失败");
    std::fs::remove_file(&saves_dir).unwrap();
    handlers::step(&st, 1).unwrap();
    let saves = handlers::list_saves(&st).unwrap();
    assert!(saves.iter().any(|s| s.slot == "autosave" && s.day == 6), "{saves:?}");
}

/// 换世界也必须丢弃旧世界的在途请求，不能用相同地点编号把它排进另一局。
#[test]
fn late_bargain_from_classic_is_discarded_after_entering_testbed() {
    let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    let server = rt.block_on(MockServer::start());
    rt.block_on(
        Mock::given(method("POST"))
            .and(path("/v1/messages"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(anthropic_reply(r#"{"reply":"旧世界的议价。"}"#))
                    .set_delay(Duration::from_millis(1500)),
            )
            .mount(&server),
    );
    let tmp = tempfile::tempdir().unwrap();
    let keys = Arc::new(MemoryKeyStore::default());
    keys.set("anthropic", &Secret::new("sk-test-world-switch")).unwrap();
    let st = app(tmp.path(), keys);
    st.worlds().get("testbed").unwrap();
    let mut settings = st.settings();
    settings.ai.mode = AiMode::Live;
    settings.ai.provider = ProviderKind::Anthropic;
    settings.ai.base_url = server.uri();
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings).unwrap();
    let loc = handlers::new_game(&st, "newcomer", Some(5)).unwrap().fleets[0].docked.unwrap();
    let worker = {
        let st = st.clone();
        std::thread::spawn(move || handlers::bargain(&st, loc, "便宜一点".into()))
    };
    let deadline = Instant::now() + Duration::from_secs(10);
    while rt.block_on(server.received_requests()).unwrap().is_empty() {
        assert!(Instant::now() < deadline, "模拟服务收到请求");
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(!worker.is_finished());
    handlers::new_world_game(
        &st,
        serde_json::from_value(json!({"world":"testbed","scenario":"sandbox","seed":6})).unwrap(),
    )
    .unwrap();
    assert!(worker.join().unwrap().unwrap_err().to_string().contains("游戏已切换"));
    assert_eq!(handlers::overview(&st).unwrap().world_key, "testbed");
    assert!(st.game().unwrap().as_ref().unwrap().session.log().is_empty());
}
