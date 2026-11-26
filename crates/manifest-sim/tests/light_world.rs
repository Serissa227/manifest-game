//! P07：真实寰宇的两种开局对齐，轻量时间轴仍支持排期、旧档和分段重放。
use manifest_core::{
    Command, EventTypeId, Fx, GoodId, OwnerId, ScenarioId, StaticData, World, events::EventParams, replay::Source,
    testkit,
};
use manifest_sim::{GameSession, storage};
use serde_json::json;
use std::sync::Arc;

fn small_defs(light: bool) -> Arc<StaticData> {
    let mut d = (*testkit::tiny_defs()).clone();
    d.rules.upbringing.light_world = light;
    d.scenarios[0].upbringing = true;
    // 与真实养成世界相同，保留结业使用的人物／故事模块。
    d.cast = serde_json::from_value(json!({"persons":[{
        "key":"teacher","name":"测试","kind":"story","gender":"f","born":[1480,1,1]
    }]}))
    .unwrap();
    d.story2 = serde_json::from_value(json!({"tracks":[{
        "key":"waiting","name":"测试","kind":"main","start":"start","auto":false,
        "chapters":[{"key":"start","title":"测试","text":"测试"}]
    }]}))
    .unwrap();
    let at = d.locations[0].key.clone();
    d.upbringing = serde_json::from_value(json!({
        "families":[{"key":"family","name":"测试","scenario":"test","home":at,
            "born":[1489,6,1],"gender":"f","graduation":[1502,3,1],
            "stages":[{"from":[1502,1,1],"stage":"home","name":"测试","at":at}],
            "completion":{"capital":{"cash":100}}}],
        "activities":[{"key":"rest","name":"测试","kind":"rest"}]
    }))
    .unwrap();
    Arc::new(d)
}

#[test]
fn scheduled_ai_and_segmented_skip_roundtrip_through_graduation() {
    let d = small_defs(true);
    let mut game = GameSession::new(d.clone(), ScenarioId(0), 42).unwrap();
    game.submit(Command::SkipUpbringing { owner: OwnerId::Player }).unwrap();
    game.schedule(
        17,
        Source::Ai,
        Command::ApplyEvent {
            event: EventTypeId(0),
            params: EventParams {
                good: Some(GoodId(0)),
                mult: Some(Fx::from_pct(150)),
                days: Some(20),
                ..Default::default()
            },
        },
    );
    for boundary in [11, 17, 30, 37, 59, 60, 61] {
        while game.day() < boundary {
            game.advance_day().unwrap();
        }
        if boundary == 17 || boundary == 30 {
            assert_eq!(game.world.state.locations[0].market[&GoodId(0)].event_supply, Fx::from_pct(150));
        }
        if boundary == 37 {
            assert_eq!(game.world.state.locations[0].market[&GoodId(0)].event_supply, Fx::ONE);
        }
        let save = storage::decode(&storage::encode(&game.to_save(), true).unwrap()).unwrap();
        let loaded = GameSession::from_save(d.clone(), save).unwrap();
        assert_eq!(loaded.world.state, game.world.state, "第 {boundary} 日存档恢复");
        assert_eq!(loaded.replay().unwrap().state, game.world.state, "第 {boundary} 日重放");
        testkit::check_invariants(&loaded.world).unwrap();
        game = loaded;
    }
    assert!(!game.world.upbringing_active());
    assert_eq!(game.world.state.upbringing.as_ref().unwrap().graduation.as_ref().unwrap().day, 60);
}

#[test]
fn active_legacy_save_adopts_the_new_rule_without_new_state_fields() {
    let old = small_defs(false);
    let mut legacy = GameSession::new(old.clone(), ScenarioId(0), 42).unwrap();
    legacy.submit(Command::SkipUpbringing { owner: OwnerId::Player }).unwrap();
    for _ in 0..15 {
        legacy.advance_day().unwrap();
    }
    let encoded = storage::encode(&legacy.to_save(), false).unwrap();
    let mut new = (*old).clone();
    new.rules.upbringing.light_world = true;
    new.meta.hash = "f".repeat(64);
    assert_ne!(new.meta.hash, old.meta.hash);
    let new = Arc::new(new);
    let mut restored = GameSession::from_save(new.clone(), storage::decode(&encoded).unwrap()).unwrap();
    let frozen = restored.world.state.locations.clone();
    for _ in 15..30 {
        restored.advance_day().unwrap();
    }
    assert_eq!(restored.world.state.locations, frozen);
    while restored.world.upbringing_active() {
        restored.advance_day().unwrap();
    }
    testkit::check_invariants(&restored.world).unwrap();
    assert!(restored.world.fleets_of(OwnerId::Company(manifest_core::CompanyId(0))).all(|f| f.docked_at().is_some()));
    let saved = restored.to_save();
    assert!(!serde_json::to_string(&saved.snapshot).unwrap().contains("light_world"));
    assert_eq!(GameSession::from_save(new, saved).unwrap().world.state, restored.world.state);
}

#[test]
fn terra16_graduation_and_free_opening_share_economy_and_original_history() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let d = manifest_data::load_world(&root, "terra16").unwrap();
    let upbringing = d.find_scenario("mio_1553").unwrap();
    let free = d.find_scenario("free_1557").unwrap();
    let mut school = GameSession::new(d.clone(), upbringing, 42).unwrap();
    school.submit(Command::SkipUpbringing { owner: OwnerId::Player }).unwrap();
    while school.world.upbringing_active() {
        school.advance_day().unwrap();
    }
    let mut progress = Vec::new();
    let open = World::bootstrap(d.clone(), free, 42, |p| progress.push(p)).unwrap();
    assert_eq!(school.day(), 1460);
    assert_eq!(open.day(), school.day());
    assert_eq!(progress.len(), 1461);
    for (day, p) in progress.iter().enumerate() {
        assert_eq!((p.day, p.total), (day as u32, 1460));
    }
    for (a, b) in school.world.state.locations.iter().zip(&open.state.locations) {
        assert_eq!(a.market, b.market, "同日、同历史供需的市场应完全相同");
        assert_eq!(a.development, b.development);
        assert_eq!(a.people, b.people);
    }
    for company in d.company_ids() {
        let owner = OwnerId::Company(company);
        let a = school.world.agent(owner).unwrap();
        let b = open.agent(owner).unwrap();
        assert_eq!((a.cash, a.home, a.bankrupt), (b.cash, b.home, b.bankrupt));
        let fleets_a: Vec<_> = school.world.fleets_of(owner).collect();
        let fleets_b: Vec<_> = open.fleets_of(owner).collect();
        assert_eq!(fleets_a, fleets_b);
        assert!(fleets_a.iter().all(|f| f.docked_at().is_some()));
    }
    assert_eq!(school.world.state.history.chronicle, open.state.history.chronicle);
    assert_eq!(school.world.state.history.ports, open.state.history.ports);
    assert_eq!(school.world.state.relations, open.state.relations);
    testkit::check_invariants(&school.world).unwrap();
    testkit::check_invariants(&open).unwrap();
    let mut full_defs = (*d).clone();
    full_defs.rules.upbringing.light_world = false;
    let original = World::new(Arc::new(full_defs), free, 42).unwrap();
    assert_eq!(open.state.history.chronicle.len(), 30);
    assert_eq!(open.state.history.chronicle, original.state.history.chronicle, "完整四年的历史事件及结果必须保留");
    assert_eq!(open.state.history.ports, original.state.history.ports);
}

#[test]
fn light_bootstrap_honors_the_history_option_and_replays_the_control_day() {
    let mut d = small_defs(true);
    let data = Arc::make_mut(&mut d);
    data.scenarios[0].upbringing = false;
    data.scenarios[0].control_date = [1502, 3, 1];
    data.history = serde_json::from_value(json!({"events":[{
        "key":"test_history","title":"测试历史","date":[1502,1,20],
        "history":{"date":[1502,1,20],"outcome":"changed"},
        "sides":[{"key":"a","name":"测试","faction":"crown"},{"key":"b","name":"测试","faction":"league"}],
        "outcomes":[{"key":"changed","when":">= 0","default":true,
            "effects":[{"kind":"flag","flag":"historic_change"}]}]
    }]}))
    .unwrap();
    data.history.order = vec![0];
    let mut progress = Vec::new();
    let request = manifest_core::scenario::NewGameRequest {
        world: "classic".into(),
        scenario: "test".into(),
        seed: Some(42),
        history: false,
        ..Default::default()
    };
    let game = GameSession::new_world(d.clone(), request.clone(), |p| progress.push(p)).unwrap();
    assert_eq!(game.day(), 60);
    assert_eq!(game.start.bootstrap_days, 60);
    assert_eq!(progress.len(), 61);
    for (day, p) in progress.iter().enumerate() {
        assert_eq!((p.day, p.total), (day as u32, 60));
    }
    assert!(game.world.state.history.chronicle.is_empty());
    assert!(!game.world.state.story2.flags.contains("historic_change"));
    assert_eq!(game.replay().unwrap().state, game.world.state);
    let restored = GameSession::from_save(d.clone(), game.to_save()).unwrap();
    assert_eq!(restored.world.state, game.world.state);
    testkit::check_invariants(&restored.world).unwrap();
    let historical =
        GameSession::new_world(d, manifest_core::scenario::NewGameRequest { history: true, ..request }, |_| {})
            .unwrap();
    assert_eq!(historical.world.state.history.chronicle.len(), 1);
    assert!(historical.world.state.story2.flags.contains("historic_change"));
}
