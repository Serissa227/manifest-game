//! 日期开局、控制日资产、身份与完整重放的集成验收。

use manifest_core::scenario::{CustomCaptain, Gender, NewGameRequest, ProtagonistDef, TemplateDef};
use manifest_core::{Command, OwnerId, ScenarioId, StaticData};
use manifest_sim::{GameSession, storage};
use std::sync::Arc;

fn defs() -> Arc<StaticData> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let mut defs = (*manifest_data::load_world(&root, "testbed").unwrap()).clone();
    let sc = &mut defs.scenarios[0];
    sc.start_date = [1553, 1, 1];
    sc.control_date = [1557, 1, 1];
    Arc::new(defs)
}

fn request() -> NewGameRequest {
    NewGameRequest { scenario: "sandbox".into(), world: "testbed".into(), seed: Some(37), ..Default::default() }
}

#[test]
fn four_year_bootstrap_is_deterministic_and_creates_assets_only_at_control() {
    let defs = defs();
    let mut progress = Vec::new();
    let a = GameSession::new_world(defs.clone(), request(), |p| progress.push(p)).unwrap();
    let b = GameSession::new_world(defs.clone(), request(), |_| {}).unwrap();
    assert_eq!(a.world.state_hash(), b.world.state_hash());
    assert_eq!(progress.len(), 1461);
    for (day, p) in progress.iter().enumerate() {
        assert_eq!((p.day, p.total), (day as u32, 1460));
    }
    assert_eq!(a.start.bootstrap_days, 1460);
    assert!(a.log().is_empty());
    let player = a.world.agent(OwnerId::Player).unwrap();
    assert_eq!(player.cash, defs.scenarios[0].cash);
    assert!(!player.bankrupt);
    assert_eq!(player.negative_days, 0);
    for fleet in a.world.fleets_of(OwnerId::Player) {
        assert_eq!(fleet.idle_days, 0);
        assert_eq!(fleet.crew, defs.scenarios[0].crew);
        assert!(fleet.ships.iter().all(|s| s.built == a.day()));
    }
    assert_eq!(a.world.info_mode(), manifest_core::info::InfoMode::Carried);
    assert!(a.world.state.info.known.values().flat_map(|k| k.values()).all(|s| s.day == a.day()));
    manifest_core::testkit::check_invariants(&a.world).unwrap();
    assert_eq!(a.replay().unwrap().state_hash(), a.world.state_hash());
}

#[test]
fn save_continue_and_replay_preserve_options_and_identity() {
    let mut defs = (*defs()).clone();
    let sc = &mut defs.scenarios[0];
    sc.protagonists.push("navigator".into());
    sc.protagonist_defs.push(ProtagonistDef {
        key: "navigator".into(),
        born: [1540, 6, 15],
        gender: Gender::F,
        captain: None,
        card: None,
    });
    let defs = Arc::new(defs);
    let request =
        NewGameRequest { protagonist: Some("navigator".into()), skip_upbringing: true, history: false, ..request() };
    let mut game = GameSession::new_world(defs.clone(), request.clone(), |_| {}).unwrap();
    let identity = game.world.state.protagonist.as_ref().unwrap();
    assert_eq!(identity.age_on([1557, 6, 14]), Some(16));
    assert_eq!(identity.age_on([1557, 6, 15]), Some(17));
    assert_eq!(identity.gender, Gender::F);
    let fleet = game.world.fleets_of(OwnerId::Player).next().unwrap().id;
    game.submit(Command::Resupply { owner: OwnerId::Player, fleet, food: 5, water: 5 }).unwrap();
    for _ in 0..30 {
        game.advance_day().unwrap();
    }
    let save = storage::decode(&storage::encode(&game.to_save(), true).unwrap()).unwrap();
    assert_eq!(save.start.opening.as_ref().unwrap(), &request);
    let mut loaded = GameSession::from_save(defs, save).unwrap();
    assert_eq!(game.world.state, loaded.world.state);
    for _ in 0..30 {
        game.advance_day().unwrap();
        loaded.advance_day().unwrap();
    }
    assert_eq!(game.world.state, loaded.world.state);
    assert_eq!(loaded.replay().unwrap().state_hash(), loaded.world.state_hash());
}

#[test]
fn custom_birthday_gender_and_template_are_deterministic_state() {
    let mut defs = (*defs()).clone();
    let sc = &mut defs.scenarios[0];
    sc.control_date = sc.start_date;
    sc.templates.push("apprentice".into());
    sc.template_defs.push(TemplateDef { key: "apprentice".into(), born: [1540, 1, 1], captain: None, card: None });
    let defs = Arc::new(defs);
    let request = NewGameRequest {
        template: Some("apprentice".into()),
        captain: Some(CustomCaptain { name: "测试船长".into(), look: 1, gender: Gender::M, birthday: [12, 31] }),
        ..request()
    };
    let game = GameSession::new_world(defs.clone(), request.clone(), |_| {}).unwrap();
    let identity = game.world.state.protagonist.as_ref().unwrap();
    assert_eq!(identity.born, [1540, 12, 31]);
    assert_eq!(identity.template.as_deref(), Some("apprentice"));
    assert_eq!(identity.age_on([1553, 1, 1]), Some(12));
    assert_eq!(game.replay().unwrap().state, game.world.state);
    let mut changed = request.clone();
    changed.captain.as_mut().unwrap().gender = Gender::F;
    assert_ne!(
        game.world.state_hash(),
        GameSession::new_world(defs.clone(), changed, |_| {}).unwrap().world.state_hash()
    );
    let mut invalid = request.clone();
    invalid.captain.as_mut().unwrap().birthday = [2, 29];
    assert!(GameSession::new_world(defs.clone(), invalid, |_| panic!("无效请求不应开始推演")).is_err());
    let mut invalid = request;
    invalid.protagonist = Some("navigator".into());
    assert!(GameSession::new_world(defs, invalid, |_| panic!("无效请求不应开始推演")).is_err());
}

#[test]
fn opening_captain_effects_run_once_on_control_day() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let mut defs = (*manifest_data::load_world(&root, "classic").unwrap()).clone();
    let index = defs.scenarios.iter().position(|s| s.hero.is_some()).unwrap();
    let sc = &mut defs.scenarios[index];
    sc.control_date = [1502, 2, 1];
    let request = NewGameRequest {
        scenario: sc.key.clone(),
        seed: Some(11),
        info: manifest_core::info::InfoMode::Live,
        ..Default::default()
    };
    let defs = Arc::new(defs);
    let mut game = GameSession::new_world(defs.clone(), request, |_| {}).unwrap();
    let captain = game.world.captain_profile(OwnerId::Player).unwrap().clone();
    assert_eq!(captain.created, 30);
    let hash = game.world.state_hash();
    assert!(
        game.submit(Command::CreateCaptain {
            owner: OwnerId::Player,
            birthday: captain.birthday,
            answers: captain.answers,
            alloc: defs.scenarios[index].hero.as_ref().unwrap().alloc.clone(),
            genius: captain.genius
        })
        .is_err()
    );
    assert_eq!(hash, game.world.state_hash());
    let saved = game.to_save();
    let loaded = GameSession::from_save(defs.clone(), saved).unwrap();
    assert_eq!(hash, loaded.world.state_hash());
    assert_eq!(hash, loaded.replay().unwrap().state_hash());
    let raw = GameSession::new(defs, ScenarioId::from_idx(index), 11).unwrap();
    assert!(raw.world.captain_profile(OwnerId::Player).is_none());
    assert_ne!(
        raw.world.agent(OwnerId::Player).unwrap().cash,
        game.world.agent(OwnerId::Player).unwrap().cash,
        "推荐角色的现金开局效果应当生效"
    );
}
