//! I10：自由对话经过通用 submit，概览推送 pending / done / fallback。
use manifest_ai::{AiMode, AiPipeline, AiSettings, MemoryKeyStore, MockLlm, Provider};
use manifest_appcore::{AppPaths, AppState, handlers, state::AiRunner};
use manifest_core::{Command, OwnerId, summary::ai};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};

struct Fixture {
    st: AppState,
    dir: PathBuf,
}
impl Fixture {
    fn new(mode: AiMode, responses: Option<Vec<String>>) -> Self {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "manifest-a10-chat-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        let root = manifest_data::find_data_dir().unwrap();
        let st = AppState::from_data_dir(&root, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(&dir)).unwrap();
        handlers::new_world_game(
            &st,
            serde_json::from_value(json!({"world":"testbed","scenario":"sandbox","seed":42})).unwrap(),
        )
        .unwrap();
        {
            let mut guard = st.game().unwrap();
            let g = guard.as_mut().unwrap();
            let sid = g.session.world.state.scenario;
            let mut defs = g.session.world.defs.clone();
            let scenario = &mut Arc::make_mut(&mut defs).scenarios[sid.idx()];
            scenario.start_date = [1558, 1, 1];
            scenario.control_date = scenario.start_date;
            g.session = manifest_sim::GameSession::new(defs, sid, 42).unwrap();
            let world = &mut g.session.world;
            world.state.cast.place = world.person_place("mentor");
            world.state.cast.persons.entry("mentor".into()).or_default().met = true;
            let provider = responses.map(|v| Provider::Mock(MockLlm::scripted(v))).or_else(|| {
                (mode == AiMode::Mock || mode == AiMode::Live).then(|| Provider::Mock(MockLlm::plausible()))
            });
            g.ai = Some(AiRunner::new(AiPipeline::new(
                st.content().clone(),
                &AiSettings { mode, ..Default::default() },
                provider,
            )));
        }
        Self { st, dir }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

#[test]
fn submit_publishes_pending_and_commits_a_bounded_reply() {
    let f = Fixture::new(AiMode::Live, None);
    let events = Arc::new(Mutex::new(Vec::<Value>::new()));
    let capture = events.clone();
    f.st.set_emitter(Arc::new(move |event, payload| {
        if event == "tick" {
            capture.lock().unwrap().push(payload);
        }
    }));
    let detail = handlers::pending::person(&f.st, "mentor".into()).unwrap();
    assert_eq!(detail["chat"]["enabled"], true);
    assert_eq!(detail["chat"]["left_today"], 3);
    let response = handlers::submit(
        &f.st,
        Command::TalkFree { owner: OwnerId::Player, person: "mentor".into(), text: "你好".into() },
    )
    .unwrap();
    let chat = response.overview.chat.unwrap();
    assert_eq!(chat["person"], "mentor");
    assert_eq!(chat["turns"][1]["status"], "done");
    assert!(events.lock().unwrap().iter().any(|e| e["chat"]["turns"][1]["status"] == "pending"));
    let guard = f.st.game().unwrap();
    let g = guard.as_ref().unwrap();
    assert!(g.session.log().iter().any(|e|e.source==manifest_core::replay::Source::Ai && matches!(e.command,Command::ApplyPersona{..})));
    assert_eq!(g.session.world.state.cast.persons["mentor"].interactions.talks, 1);
}

#[test]
fn mock_offline_and_off_modes_keep_the_menu_and_can_render_fallback() {
    for mode in [AiMode::Mock, AiMode::Offline, AiMode::Off] {
        let f = Fixture::new(mode, None);
        assert!(handlers::pending::person(&f.st, "mentor".into()).unwrap()["chat"].is_null());
        let response = handlers::submit(
            &f.st,
            Command::TalkFree { owner: OwnerId::Player, person: "mentor".into(), text: "你好".into() },
        )
        .unwrap();
        let chat = response.overview.chat.unwrap();
        assert_eq!(chat["turns"].as_array().unwrap().len(), 2);
        if mode != AiMode::Mock {
            assert_eq!(chat["turns"][1]["status"], "fallback");
        }
    }
}

#[test]
fn rejected_reply_keeps_world_unchanged_and_does_not_block_the_next_chat() {
    let f = Fixture::new(
        AiMode::Live,
        Some(vec![
            json!({"reply":"占位。","topic":null,"money":9999}).to_string(),
            json!({"reply":"占位。","topic":null}).to_string(),
        ]),
    );
    let before = f.st.game().unwrap().as_ref().unwrap().session.world.state.clone();
    let response = handlers::submit(
        &f.st,
        Command::TalkFree { owner: OwnerId::Player, person: "mentor".into(), text: "你好".into() },
    )
    .unwrap();
    assert_eq!(response.overview.chat.unwrap()["turns"][1]["status"], "fallback");
    assert_eq!(f.st.game().unwrap().as_ref().unwrap().session.world.state, before);
    let response = handlers::submit(
        &f.st,
        Command::TalkFree { owner: OwnerId::Player, person: "mentor".into(), text: "请继续".into() },
    )
    .unwrap();
    assert_eq!(response.overview.chat.unwrap()["turns"][1]["status"], "done");
}

#[test]
fn system_persona_commands_cannot_be_submitted_by_clients() {
    let f = Fixture::new(AiMode::Offline, None);
    let before = f.st.game().unwrap().as_ref().unwrap().session.world.state.clone();
    let command = Command::ApplyPersona {
        result: ai::PersonaResult {
            owner: OwnerId::Player,
            person: "mentor".into(),
            seq: 1,
            day: 0,
            player_text: "你好".into(),
            reply: "占位。".into(),
            topic: None,
            source: ai::AiSource::Model,
        },
    };
    assert!(handlers::submit(&f.st, command).is_err());
    assert_eq!(f.st.game().unwrap().as_ref().unwrap().session.world.state, before);
}

#[test]
fn switching_games_discards_an_in_flight_http_chat() {
    use std::io::{Read, Write};
    use std::sync::mpsc;
    use std::time::Duration;
    let f = Fixture::new(AiMode::Live, None);
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (started_tx, started_rx) = mpsc::sync_channel(1);
    let (finish_tx, finish_rx) = mpsc::sync_channel(1);
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let mut request = Vec::new();
        let mut chunk = [0; 4096];
        loop {
            let n = stream.read(&mut chunk).unwrap();
            assert!(n > 0);
            request.extend_from_slice(&chunk[..n]);
            if request.windows(4).any(|v| v == b"\r\n\r\n") {
                break;
            }
        }
        started_tx.send(()).unwrap();
        finish_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        let body=json!({"id":"test","type":"message","role":"assistant","model":"test","content":[{"type":"text","text":json!({"reply":"你好。","topic":null}).to_string()}],"usage":{"input_tokens":10,"output_tokens":10}}).to_string();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(response.as_bytes());
    });
    {
        let config = manifest_ai::ProviderConfig {
            base_url: format!("http://{address}"),
            ..manifest_ai::ProviderConfig::anthropic_default()
        };
        let provider =
            manifest_ai::HttpProvider::new(config.clone(), manifest_ai::Secret::new("a10-local-test")).unwrap();
        let mut guard = f.st.game().unwrap();
        guard.as_mut().unwrap().ai = Some(AiRunner::new(AiPipeline::new(
            f.st.content().clone(),
            &AiSettings { mode: AiMode::Live, provider: Some(config), ..Default::default() },
            Some(Provider::Http(provider)),
        )));
    }
    let st = f.st.clone();
    let pending = std::thread::spawn(move || {
        handlers::submit(
            &st,
            Command::TalkFree { owner: OwnerId::Player, person: "mentor".into(), text: "你好".into() },
        )
    });
    started_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    handlers::new_world_game(
        &f.st,
        serde_json::from_value(json!({"world":"testbed","scenario":"sandbox","seed":99})).unwrap(),
    )
    .unwrap();
    let before = f.st.game().unwrap().as_ref().unwrap().session.world.state_hash();
    finish_tx.send(()).unwrap();
    assert!(pending.join().unwrap().is_err());
    server.join().unwrap();
    let guard = f.st.game().unwrap();
    let game = guard.as_ref().unwrap();
    assert_eq!(game.session.world.state_hash(), before);
    assert!(game.session.world.state.cast.ai.is_empty());
}
