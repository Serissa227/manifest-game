//! test2：七种新类型使用真实命令日志和存档恢复，重放不调用模型。
use manifest_ai::{AiMode, AiPipeline, AiSettings, TaskRequest};
use manifest_core::{Command, OwnerId, ScenarioId, cast::AudienceDef, replay::Source};
use manifest_sim::{GameSession, ai::AiDriver};
use std::sync::Arc;

fn driver() -> AiDriver {
    let content = Arc::new(manifest_data::load_ai_content(&manifest_data::find_data_dir().unwrap()).unwrap());
    AiDriver::new(AiPipeline::new(content, &AiSettings { mode: AiMode::Offline, ..Default::default() }, None)).unwrap()
}
fn apply(s: &mut GameSession, d: &AiDriver, request: TaskRequest) {
    let (outcome, commands) = d.run_request(&s.world, request.clone());
    assert!(outcome.unwrap().accepted().is_some(), "{request:?}");
    assert_eq!(commands.len(), 1, "{request:?}");
    for c in commands {
        s.submit_from_at(0, Source::Ai, c).unwrap();
    }
}
fn replay_and_save(s: &mut GameSession) {
    let before = s.world.state_hash();
    assert_eq!(s.replay().unwrap().state_hash(), before);
    let json = s.to_save().to_json().unwrap();
    let save = manifest_core::save::SaveFile::from_json(&json).unwrap();
    let mut restored = GameSession::from_save(s.world.defs.clone(), save).unwrap();
    assert_eq!(restored.world.state_hash(), before);
    for game in [&mut *s, &mut restored] {
        if game
            .world
            .state
            .upbringing
            .as_ref()
            .is_some_and(|state| state.phase == manifest_core::upbringing::Phase::Plan)
        {
            game.submit(Command::PlanMonth {
                owner: OwnerId::Player,
                slots: (0..3)
                    .map(|index| manifest_core::upbringing::PlanSlot {
                        index,
                        lesson: None,
                        after: Some(manifest_core::upbringing::AfterChoice::activity("rest")),
                    })
                    .collect(),
            })
            .unwrap();
        }
        while game.world.pending_story2().is_some() {
            game.submit(Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }).unwrap();
        }
        game.advance_day().unwrap();
    }
    assert_eq!(s.world.state_hash(), restored.world.state_hash());
    assert_eq!(restored.replay().unwrap().state_hash(), restored.world.state_hash());
}

#[test]
fn test2_persona_daily_narration_letter_chronicle_and_ripple_replay_from_log() {
    let mut defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let d = Arc::make_mut(&mut defs);
    d.scenarios[0].start_date = [1558, 1, 1];
    d.scenarios[0].control_date = [1558, 1, 1];
    d.cast.persons.iter_mut().find(|p| p.key == "mentor").unwrap().audience = AudienceDef::default();
    d.history.events.iter_mut().find(|e| e.key == "sample_opening").unwrap().ripple_budget = 1000;
    // 本夹具只启用下面两条来信轨道，避免其他独立故事的排队顺序决定应答对象。
    for track in &mut d.story2.tracks {
        track.auto = false;
    }
    for track in [
        serde_json::json!({"key":"a10_news","name":"占位","kind":"encounter","cast":["mentor"],"start":"observe","chapters":[{"key":"observe","title":"占位","text":"占位。","at":"test_east","window":[[1558,1,1],[1558,1,1]],"news":"占位。","default":{"next":"done"}}]}),
        serde_json::json!({"key":"a10_send","name":"占位","kind":"main","cast":["mentor"],"start":"send","chapters":[{"key":"send","title":"占位","text":"占位。","window":[[1558,1,3],[1558,1,10]],"choices":[{"key":"send","text":"占位。","next":"done","effects":[{"kind":"letter","person":"mentor","text":"占位。"}]}]}]}),
    ] {
        d.story2.tracks.push(serde_json::from_value(track).unwrap());
    }
    let mut s = GameSession::new(defs, ScenarioId(0), 42).unwrap();
    let d = driver();
    assert!(s.world.state.cast.persons["mentor"].met);
    apply(
        &mut s,
        &d,
        TaskRequest::Persona { owner: OwnerId::Player, person: "mentor".into(), player_text: "你好".into() },
    );
    apply(&mut s, &d, TaskRequest::Daily { owner: OwnerId::Player, person: "mentor".into() });
    apply(&mut s, &d, TaskRequest::Narration { event: "sample_opening".into(), phase: "opening".into() });
    s.advance_day().unwrap();
    s.advance_day().unwrap();
    assert_eq!(s.world.pending_story2().unwrap().track, "a10_send");
    s.submit(Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }).unwrap();
    assert!(
        s.world
            .known_news(None)
            .iter()
            .any(|n| n.id == "a10_news:observe" && n.kind == manifest_core::story2::NewsKind::Letter)
    );
    apply(&mut s, &d, TaskRequest::Letter { id: "a10_news:observe".into(), purpose: "help".into() });
    apply(&mut s, &d, TaskRequest::Ripple { event: "sample_opening".into() });
    while s.world.cast_date()[0] == 1558 {
        s.advance_day().unwrap();
    }
    apply(&mut s, &d, TaskRequest::AltChronicle { year: 1558 });
    assert_eq!(s.log().iter().filter(|e| e.source == Source::Ai).count(), 6);
    replay_and_save(&mut s);
}

#[test]
fn test2_diary_replays_real_month_plan_results() {
    let defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let sid = ScenarioId::from_idx(defs.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let mut s = GameSession::new(defs, sid, 42).unwrap();
    s.submit(Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| manifest_core::upbringing::PlanSlot {
                index,
                lesson: None,
                after: Some(manifest_core::upbringing::AfterChoice::activity("rest")),
            })
            .collect(),
    })
    .unwrap();
    while s.world.cast_date()[1] == 1 {
        while s.world.pending_story2().is_some() {
            s.submit(Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }).unwrap();
        }
        s.advance_day().unwrap();
    }
    apply(&mut s, &driver(), TaskRequest::Diary { year: 1553, month: 1 });
    replay_and_save(&mut s);
}
