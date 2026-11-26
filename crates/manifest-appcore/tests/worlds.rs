//! B3：资源交接、I1/I2 JSON、控制日、跨世界存档与旧入口兼容。

use manifest_ai::MemoryKeyStore;
use manifest_appcore::{AppPaths, AppState, handlers, views};
use manifest_core::info::InfoMode;
use manifest_data::Locale;
use serde_json::{Value, json};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

fn app() -> AppState {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let id = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("manifest-b3-{}-{id}", std::process::id()));
    let data = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data");
    AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(&dir)).unwrap()
}

fn request(world: &str, scenario: &str) -> handlers::NewGameRequest {
    serde_json::from_value(json!({ "world":world, "scenario":scenario, "seed":42 })).unwrap()
}

fn assert_error_key(error: manifest_appcore::AppError, key: &str) {
    match error {
        manifest_appcore::AppError::Invalid(msg) => assert_eq!(msg.key, key),
        other => panic!("应返回带键的应用层错误：{other}"),
    }
}

struct WorldFixture(PathBuf);

impl WorldFixture {
    fn new() -> Self {
        static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let id = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("manifest-b3b-worlds-{}-{id}", std::process::id()));
        fn copy(source: &std::path::Path, destination: &std::path::Path) {
            std::fs::create_dir_all(destination).unwrap();
            for entry in std::fs::read_dir(source).unwrap() {
                let entry = entry.unwrap();
                // 本夹具只需要经典世界与 testbed，不复制庞大的寰宇草稿。
                if entry.file_name() == "terra16" {
                    continue;
                }
                let target = destination.join(entry.file_name());
                if entry.file_type().unwrap().is_dir() {
                    copy(&entry.path(), &target);
                } else {
                    std::fs::copy(entry.path(), target).unwrap();
                }
            }
        }
        copy(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data"), &dir.join("data"));
        Self(dir)
    }

    fn write(&self, relative: &str, text: &str) {
        let path = self.0.join("data").join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn app(&self) -> AppState {
        AppState::from_data_dir(
            &self.0.join("data"),
            Arc::new(MemoryKeyStore::default()),
            AppPaths::in_dir(&self.0.join("user")),
        )
        .unwrap()
    }
}

impl Drop for WorldFixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).unwrap();
    }
}

#[test]
fn broken_world_packages_do_not_disable_classic_catalog_or_other_maps() {
    let f = WorldFixture::new();
    f.write("worlds/broken/world.toml", "key = [");
    f.write("worlds/invalid_data/world.toml", "key='invalid_data'\nname='坏内容'\ninherit='testbed'\nhidden=false\n");
    f.write("worlds/invalid_data/goods.toml", "goods = [");
    f.write(
        "worlds/invalid_reference/world.toml",
        "key='invalid_reference'\nname='坏引用'\ninherit='testbed'\nhidden=false\n",
    );
    f.write("worlds/invalid_reference/goods.toml", "goods = []");
    f.write("worlds/good_world/world.toml", "key='good_world'\nname='好世界'\ninherit='testbed'\nhidden=false\n");
    let st = f.app();
    assert_eq!(
        st.worlds().visible(),
        ["classic", "good_world", "invalid_reference"],
        "登记时即排除格式损坏的包，语义检查在首次加载"
    );
    assert_error_key(handlers::select_world(&st, "broken".into()).unwrap_err(), "app.world_unavailable");
    assert_error_key(handlers::select_world(&st, "invalid_data".into()).unwrap_err(), "app.world_unavailable");
    let catalog = handlers::world_catalog(&st).unwrap();
    assert_eq!(catalog.worlds.iter().map(|c| c.key.as_str()).collect::<Vec<_>>(), ["classic", "good_world"]);
    assert_eq!(st.worlds().visible(), ["classic", "good_world"]);
    assert_error_key(handlers::select_world(&st, "invalid_reference".into()).unwrap_err(), "app.world_unavailable");
    assert_eq!(handlers::map_resource(&st, "testbed".into()).unwrap().key, "testbed");
    assert_eq!(handlers::new_game(&st, "newcomer", Some(42)).unwrap().world_key, "classic");
    assert_eq!(handlers::new_world_game(&st, request("good_world", "sandbox")).unwrap().world_key, "good_world");
    assert!(manifest_data::list_worlds(&f.0.join("data")).is_err(), "校验工具仍严格拒绝坏包");
    // 修复文件后也不在原注册表重试；错误只记录一次，重新启动才重新校验。
    f.write("worlds/broken/world.toml", "key='broken'\nname='已修复'\ninherit='testbed'\n");
    assert_error_key(handlers::select_world(&st, "broken".into()).unwrap_err(), "app.world_unavailable");
    assert_eq!(handlers::select_world(&f.app(), "broken".into()).unwrap().world.key, "broken");
    let mut settings = st.settings();
    settings.language = Some(Locale::En);
    handlers::save_settings(&st, settings).unwrap();
    let error = handlers::select_world(&st, "invalid_data".into()).unwrap_err();
    assert_eq!(st.localize_error(error).to_string(), "World package unavailable; check its contents: invalid_data");
}

#[test]
fn world_and_opening_errors_have_stable_keys_and_english_messages() {
    let st = app();
    let mut settings = st.settings();
    settings.language = Some(Locale::En);
    handlers::save_settings(&st, settings).unwrap();
    assert_error_key(handlers::select_world(&st, "missing".into()).unwrap_err(), "app.unknown_world");
    let error = handlers::select_world(&st, "missing".into()).unwrap_err();
    assert_eq!(st.localize_error(error).to_string(), "Unknown world: missing");
    // 寰宇 2026-11-02 转为成品世界；草稿世界的错误键与英文提示改用夹具里的草稿包检查。
    let f = WorldFixture::new();
    f.write("worlds/sketch/world.toml", "key='sketch'\nname='未完成的草稿'\nmap='testbed'\ndraft=true\n");
    let drafts = f.app();
    let mut english = drafts.settings();
    english.language = Some(Locale::En);
    handlers::save_settings(&drafts, english).unwrap();
    assert_error_key(handlers::select_world(&drafts, "sketch".into()).unwrap_err(), "app.world_draft");
    let error = handlers::select_world(&drafts, "sketch".into()).unwrap_err();
    assert_eq!(drafts.localize_error(error).to_string(), "Draft world is not playable yet: sketch");
    assert_error_key(handlers::new_world_game(&st, request("classic", "missing")).unwrap_err(), "app.unknown_scenario");
    let mut bad = request("testbed", "sandbox");
    bad.protagonist = Some("missing".into());
    assert_error_key(handlers::new_world_game(&st, bad.clone()).unwrap_err(), "app.invalid_start");
    let error = handlers::new_world_game(&st, bad).unwrap_err();
    assert_eq!(
        st.localize_error(error).to_string(),
        "Could not start the game; check the scenario, protagonist and custom details (invalid_start)."
    );
    let mut custom = request("testbed", "sandbox");
    custom.captain = Some(manifest_core::scenario::CustomCaptain {
        name: "Marin".into(),
        look: 12,
        gender: manifest_core::scenario::Gender::F,
        birthday: [1, 1],
    });
    assert_error_key(handlers::new_world_game(&st, custom.clone()).unwrap_err(), "app.captain_portrait");
    let error = handlers::new_world_game(&st, custom).unwrap_err();
    assert_eq!(st.localize_error(error).to_string(), "The portrait number must be between 0 and 24, except 12.");
    assert!(st.game().unwrap().is_none());
}

#[test]
fn world_cards_use_player_copy_english_overrides_and_explicit_defaults() {
    let f = WorldFixture::new();
    f.write("worlds/azure_sea/world.toml", "key='azure_sea'\nname='蔚蓝海域'\ninherit='testbed'\ntagline='扬帆远行'\nblurb='来往海港，经营商船。'\n[lore]\nsummary='仅供作者的内部设定'\n");
    f.write(
        "worlds/azure_sea/locales/en/world.toml",
        "name='The Azure Sea'\ntagline='Sail beyond the horizon'\nblurb='Trade between the harbors.'\n",
    );
    f.write("worlds/silver_coast/world.toml", "key='silver_coast'\nname='银色海岸'\ninherit='azure_sea'\n");
    let st = f.app();
    let azure = st.worlds().get("azure_sea").unwrap();
    let zh = views::world_catalog::world_card(azure, Locale::ZhCn);
    let en = views::world_catalog::world_card(azure, Locale::En);
    assert_eq!(
        (&*zh.name, &*zh.name_en, &*zh.tagline, &*zh.description),
        ("蔚蓝海域", "The Azure Sea", "扬帆远行", "来往海港，经营商船。")
    );
    assert_eq!(
        (&*en.name, &*en.name_en, &*en.tagline, &*en.description),
        ("The Azure Sea", "The Azure Sea", "Sail beyond the horizon", "Trade between the harbors.")
    );
    assert_eq!(azure.static_view(Locale::En).world.name, en.name);
    let silver = st.worlds().get("silver_coast").unwrap();
    let zh = views::world_catalog::world_card(silver, Locale::ZhCn);
    let en = views::world_catalog::world_card(silver, Locale::En);
    assert_eq!(
        (&*zh.name, &*zh.name_en, &*zh.tagline, &*zh.description),
        ("银色海岸", "Silver Coast", "启航探索这个世界", "在此世界中选择剧本，开始航行与经营。")
    );
    assert_eq!(
        (&*en.name, &*en.name_en, &*en.tagline, &*en.description),
        (
            "Silver Coast",
            "Silver Coast",
            "Set sail and explore this world",
            "Choose a scenario to begin sailing and trading in this world."
        )
    );
}

#[test]
fn selection_switches_the_entire_bundle_and_reuses_both_language_views() {
    let st = app();
    let classic = st.resources().clone();
    let selected = handlers::select_world(&st, "testbed".into()).unwrap();
    let bed = st.resources().clone();
    assert_eq!(selected.world.key, "testbed");
    assert_eq!(selected.world.modules, vec!["captain", "stories"]);
    assert_eq!(st.defs().world_key, st.locales().en.defs.world_key);
    assert!(Arc::ptr_eq(st.defs(), &st.locales().zh.defs));
    assert!(!Arc::ptr_eq(st.content(), &classic.content));
    let mut settings = st.settings();
    settings.language = Some(Locale::En);
    handlers::save_settings(&st, settings).unwrap();
    let view = handlers::static_data(&st);
    assert_eq!(view.scenarios.iter().find(|s| s.key == "bootstrap").unwrap().name, "Four Years Later");
    assert_eq!(view.locations.len(), 2);
    handlers::select_world(&st, "classic".into()).unwrap();
    assert!(Arc::ptr_eq(st.resources(), &classic));
    assert_eq!(handlers::static_data(&st).world.name, "Classic World");
    handlers::select_world(&st, "testbed".into()).unwrap();
    assert!(Arc::ptr_eq(st.resources(), &bed));
    // 选不进去的世界不改变当前资源（寰宇 11-02 起能开局，改用不存在的世界）。
    assert_error_key(handlers::select_world(&st, "missing".into()).unwrap_err(), "app.unknown_world");
    assert_eq!(st.defs().world_key, "testbed");
    assert!(handlers::select_world(&st, "../classic".into()).is_err());
}

#[test]
fn catalog_and_requests_match_i1_including_roster_placeholders() {
    let st = app();
    let catalog = serde_json::to_value(handlers::world_catalog(&st).unwrap()).unwrap();
    assert_eq!(catalog["current"], Value::Null);
    // 寰宇 2026-11-02 起进入开局列表，排在经典之后。
    let listed: Vec<_> = catalog["worlds"].as_array().unwrap().iter().map(|w| w["key"].as_str().unwrap()).collect();
    assert_eq!(listed, ["classic", "terra16"]);
    assert_eq!(catalog["worlds"][1]["languages"], json!(["zh"]));
    let card = &catalog["worlds"][0];
    assert_eq!(
        keys(card),
        vec![
            "currency",
            "description",
            "era",
            "key",
            "languages",
            "map_key",
            "modules",
            "months",
            "name",
            "name_en",
            "scenarios",
            "start_year",
            "tagline"
        ]
    );
    assert_eq!(card["languages"], json!(["zh", "en"]));
    assert_eq!(
        keys(&card["scenarios"][0]),
        vec![
            "control_date",
            "description",
            "goal",
            "key",
            "name",
            "name_en",
            "options",
            "protagonists",
            "start_date",
            "templates",
            "upbringing"
        ]
    );
    let minimal: handlers::NewGameRequest = serde_json::from_value(json!({"scenario":"newcomer"})).unwrap();
    assert_eq!(minimal.world, "classic");
    assert_eq!(minimal.info, InfoMode::Carried);
    assert!(minimal.history && !minimal.skip_upbringing);
    let full = json!({"scenario":"sandbox","seed":17,"world":"testbed","protagonist":null,"template":"custom",
        "captain":{"name":"旅人","look":0,"gender":"f","birthday":[1,31]},"skip_upbringing":true,"history":false,"info":"live"});
    let parsed: handlers::NewGameRequest = serde_json::from_value(full.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), full);
    assert!(serde_json::from_value::<handlers::NewGameRequest>(json!({"scenario":"x","typo":true})).is_err());

    // 人物内容未接线时仍输出 I1 的全部字段；出生日期和性别必须来自内核身份。
    let r = st.worlds().get("testbed").unwrap();
    let mut defs = (*r.defs).clone();
    let sc = &mut defs.scenarios[0];
    sc.protagonists = vec!["traveler".into()];
    sc.protagonist_defs = vec![manifest_core::scenario::ProtagonistDef {
        key: "traveler".into(),
        born: [1535, 2, 3],
        gender: manifest_core::scenario::Gender::F,
        captain: None,
        card: None,
    }];
    sc.templates = vec!["custom".into()];
    let defs = Arc::new(defs);
    let mut locales = r.locales.clone();
    Arc::make_mut(&mut locales.zh).defs = defs.clone();
    Arc::make_mut(&mut locales.en).defs = defs.clone();
    let registry = manifest_appcore::state::world_registry::WorldRegistry::single(defs, r.content.clone(), locales);
    let card =
        serde_json::to_value(views::world_catalog::world_card(registry.get("testbed").unwrap(), Locale::ZhCn)).unwrap();
    let hero = &card["scenarios"][0]["protagonists"][0];
    assert_eq!(
        keys(hero),
        vec![
            "academy",
            "bonds",
            "born",
            "difficulty",
            "gender",
            "home",
            "keepsake",
            "key",
            "known",
            "name",
            "name_en",
            "playstyle",
            "portraits",
            "region",
            "start_ship",
            "strengths",
            "style",
            "tagline",
            "tags"
        ]
    );
    assert_eq!(hero["born"], json!([1535, 2, 3]));
    assert_eq!(hero["gender"], "f");
    assert_eq!(hero["academy"], json!({"key":"","name":"","city":""}));
    assert_eq!(
        keys(&card["scenarios"][0]["templates"][0]),
        vec!["academy", "activities", "family", "home", "key", "known", "name", "style"]
    );
}

fn keys(value: &Value) -> Vec<&str> {
    value.as_object().unwrap().keys().map(String::as_str).collect()
}

#[test]
fn preview_and_failed_opening_preserve_the_current_game_and_legacy_start_is_classic() {
    let st = app();
    handlers::new_world_game(&st, request("testbed", "sandbox")).unwrap();
    let before = handlers::debug(&st).unwrap().state_hash;
    let generation = st.generation();
    assert_eq!(handlers::select_world(&st, "classic".into()).unwrap().world.key, "classic");
    assert_eq!(st.defs().world_key, "testbed");
    assert_eq!(handlers::static_data(&st).world.key, "testbed");
    assert_eq!(handlers::world_catalog(&st).unwrap().current.as_deref(), Some("testbed"));
    assert!(handlers::new_world_game(&st, request("classic", "missing")).is_err());
    assert!(handlers::new_world_game(&st, request("terra16", "missing")).is_err());
    assert_eq!(st.generation(), generation);
    assert_eq!(handlers::debug(&st).unwrap().state_hash, before);
    let overview = handlers::new_game(&st, "newcomer", Some(42)).unwrap();
    let expected =
        manifest_sim::GameSession::new(st.defs().clone(), st.defs().find_scenario("newcomer").unwrap(), 42).unwrap();
    assert_eq!(overview.world_key, "classic");
    assert_eq!(handlers::debug(&st).unwrap().state_hash, expected.world.state_hash());
    assert_eq!(st.game().unwrap().as_ref().unwrap().session.start, expected.start);
    assert!(st.game().unwrap().as_ref().unwrap().session.log().is_empty());
}

#[test]
fn bootstrap_events_overview_info_and_replay_share_the_control_day() {
    let st = app();
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    st.set_emitter(Arc::new(move |name, value| {
        if name == "bootstrap" {
            sink.lock().unwrap().push(value);
        }
    }));
    let overview = handlers::new_world_game(&st, request("testbed", "bootstrap")).unwrap();
    let json = serde_json::to_value(overview).unwrap();
    assert_eq!(json["world_key"], "testbed");
    assert_eq!(json["map_key"], "testbed");
    assert_eq!(json["mode"], "voyage");
    assert_eq!(json["world_date"], json!([1557, 1, 1]));
    let events = events.lock().unwrap();
    assert_eq!(events.len(), 1461);
    for (day, event) in events.iter().enumerate() {
        assert_eq!(*event, json!({"day":day,"total":1460}));
    }
    let game = st.game().unwrap();
    let session = &game.as_ref().unwrap().session;
    assert_eq!(session.world.info_mode(), InfoMode::Carried);
    assert_eq!(
        session.world.player_start_day(),
        manifest_core::scenario::day_of(&session.world.defs, [1557, 1, 1]).unwrap()
    );
    assert_eq!(session.world.state_hash(), session.replay().unwrap().state_hash());
    assert!(session.log().is_empty(), "情报模式是开局参数，不在推演中写玩家命令");
}

#[test]
fn saves_route_by_the_save_body_and_old_metadata_defaults_to_classic() {
    let st = app();
    handlers::new_game(&st, "newcomer", Some(42)).unwrap();
    let classic = handlers::debug(&st).unwrap().state_hash;
    handlers::save_game(&st, "classic").unwrap();
    let meta = st.paths().saves_dir.join("classic.meta.json");
    let mut value: Value = serde_json::from_str(&std::fs::read_to_string(&meta).unwrap()).unwrap();
    value.as_object_mut().unwrap().remove("world_key");
    std::fs::write(&meta, value.to_string()).unwrap();
    // 实际旧 v4 存档，不仅是缺少附属字段。
    let path = st.paths().saves_dir.join("classic.mfsave.zst");
    let mut save = serde_json::to_value(manifest_sim::storage::read(&path).unwrap()).unwrap();
    save["version"] = json!(4);
    save.as_object_mut().unwrap().remove("world");
    std::fs::write(&path, save.to_string()).unwrap();

    handlers::new_world_game(&st, request("testbed", "sandbox")).unwrap();
    let bed = handlers::debug(&st).unwrap().state_hash;
    let info = handlers::save_game(&st, "bed").unwrap();
    assert_eq!(info.world_key, "testbed");
    assert_eq!(info.scenario_key.as_deref(), Some("sandbox"));
    let saved: Value =
        serde_json::from_str(&std::fs::read_to_string(st.paths().saves_dir.join("bed.meta.json")).unwrap()).unwrap();
    assert_eq!(saved["world_key"], "testbed");
    assert_eq!(saved["scenario_key"], "sandbox");
    let saves = handlers::list_saves(&st).unwrap();
    assert_eq!(saves.iter().find(|s| s.slot == "classic").unwrap().world_key, "classic");
    assert_eq!(handlers::load_game(&st, "classic").unwrap().world_key, "classic");
    assert_eq!(handlers::debug(&st).unwrap().state_hash, classic);
    // 附属元数据不能把另一个世界的存档伪装成经典世界。
    std::fs::write(st.paths().saves_dir.join("bed.meta.json"), value.to_string()).unwrap();
    assert_eq!(handlers::load_game(&st, "bed").unwrap().world_key, "testbed");
    assert_eq!(handlers::debug(&st).unwrap().state_hash, bed);
    assert_eq!(st.ctx().names.locations.len(), 2);
}

#[test]
fn custom_identity_and_long_display_name_survive_world_save_and_load() {
    let base = app();
    let resources = base.worlds().get("testbed").unwrap();
    let mut defs = (*resources.defs).clone();
    let birth_year = defs.scenarios[0].control_date[0] - 18;
    defs.scenarios[0].templates = vec!["custom".into()];
    defs.scenarios[0].template_defs = vec![manifest_core::scenario::TemplateDef {
        key: "custom".into(),
        born: [birth_year, 1, 1],
        captain: None,
        card: None,
    }];
    let defs = Arc::new(defs);
    let mut locales = resources.locales.clone();
    Arc::make_mut(&mut locales.zh).defs = defs.clone();
    Arc::make_mut(&mut locales.en).defs = defs.clone();
    let st = AppState::new(
        defs,
        resources.content.clone(),
        locales,
        Arc::new(MemoryKeyStore::default()),
        base.paths().clone(),
    )
    .unwrap();
    let name = "二十四字以内但超过旧十二字上限的旅人";
    let mut req = request("testbed", "sandbox");
    req.template = Some("custom".into());
    req.captain = Some(manifest_core::scenario::CustomCaptain {
        name: name.into(),
        look: 3,
        gender: manifest_core::scenario::Gender::F,
        birthday: [2, 28],
    });
    req.info = InfoMode::Live;
    let o = handlers::new_world_game(&st, req.clone()).unwrap();
    assert_eq!(o.captain.unwrap().name, name);
    let before = handlers::debug(&st).unwrap().state_hash;
    assert_eq!(st.game().unwrap().as_ref().unwrap().session.world.info_mode(), InfoMode::Live);
    handlers::save_game(&st, "custom").unwrap();
    assert_eq!(handlers::load_game(&st, "custom").unwrap().captain.unwrap().name, name);
    assert_eq!(handlers::debug(&st).unwrap().state_hash, before);
    let game = st.game().unwrap();
    let session = &game.as_ref().unwrap().session;
    assert_eq!(session.world.state.protagonist.as_ref().unwrap().born, [birth_year, 2, 28]);
    assert_eq!(session.replay().unwrap().state_hash(), before);
    drop(game);
    req.captain.as_mut().unwrap().birthday = [2, 30];
    assert!(handlers::new_world_game(&st, req).is_err());
    assert_eq!(handlers::debug(&st).unwrap().state_hash, before);
}
