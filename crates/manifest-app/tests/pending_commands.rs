//! 第九批前端先行命令：经典世界的明确响应与不修改对局的保证。
use manifest_ai::MemoryKeyStore;
use manifest_app::handlers::pending;
use manifest_app::{AppError, AppPaths, AppState, handlers};
use serde_json::{Value, json};
use std::sync::Arc;

fn app(dir: &std::path::Path) -> AppState {
    let data = manifest_data::find_data_dir().unwrap();
    AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(dir)).unwrap()
}

fn check(query: impl Fn(&AppState) -> Result<Value, AppError>, nullable: bool) {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    for started in [false, true] {
        if started {
            handlers::new_game(&st, "newcomer", Some(42)).unwrap();
        }
        let before = st.game().unwrap().as_ref().map(|g| g.session.world.state_hash());
        let result = query(&st);
        if nullable {
            assert_eq!(result.unwrap(), Value::Null);
        } else {
            match result.unwrap_err() {
                AppError::Invalid(msg) => {
                    assert_eq!(msg.key, "app.feature_unavailable");
                    assert_eq!(msg.zh, "这个世界还没有这项功能");
                }
                error => panic!("应明确拒绝功能：{error}"),
            }
        }
        let after = st.game().unwrap().as_ref().map(|g| g.session.world.state_hash());
        assert_eq!(before, after);
    }
}

#[test]
fn new_world_game_now_starts_classic_with_control_day_info() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let request = serde_json::from_value(json!({"scenario":"newcomer", "world":"classic", "seed":42})).unwrap();
    let overview = handlers::new_world_game(&st, request).unwrap();
    assert_eq!(overview.world_key, "classic");
    assert_eq!(overview.mode, "voyage");
    assert_eq!(
        st.game().unwrap().as_ref().unwrap().session.world.state.info.mode,
        manifest_core::info::InfoMode::Carried
    );
}

#[test]
fn upbringing_has_an_explicit_classic_response() {
    check(pending::upbringing, true);
}

#[test]
fn auto_plan_has_an_explicit_classic_response() {
    check(|st| pending::auto_plan(st, "balanced".into()), false);
}

#[test]
fn contest_has_an_explicit_classic_response() {
    check(|st| pending::contest(st, "missing".into()), false);
}

#[test]
fn endings_has_an_explicit_classic_response() {
    check(pending::endings, false);
}

#[test]
fn persons_has_an_explicit_classic_response() {
    check(|st| pending::persons(st, None), false);
}

#[test]
fn person_has_an_explicit_classic_response() {
    check(|st| pending::person(st, "missing".into()), false);
}

#[test]
fn relationships_has_an_explicit_classic_response() {
    check(pending::relationships, false);
}

#[test]
fn story_log_has_an_explicit_classic_response() {
    check(pending::story_log, false);
}

#[test]
fn gossip_has_an_explicit_classic_response() {
    check(|st| manifest_appcore::handlers::story2::gossip(st, None, None), false);
    check(|st| manifest_appcore::handlers::story2::gossip(st, Some(0), Some(20)), false);
}

#[test]
fn inventory_has_an_explicit_classic_response() {
    check(handlers::inventory, false);
}

#[test]
fn item_shop_has_an_explicit_classic_response() {
    check(|st| handlers::item_shop(st, 0), true);
}

#[test]
fn codex_has_an_explicit_classic_response() {
    check(|st| handlers::codex(st, None), false);
}

#[test]
fn auctions_has_an_explicit_classic_response() {
    check(|st| handlers::auctions(st, None), false);
}

#[test]
fn auction_has_an_explicit_classic_response() {
    check(|st| handlers::auction(st, "missing".into()), false);
}

#[test]
fn timeline_has_an_explicit_classic_response() {
    check(pending::timeline, false);
}

#[test]
fn campaign_has_an_explicit_classic_response() {
    check(|st| pending::campaign(st, "missing".into()), false);
}

#[test]
fn chronicle_has_an_explicit_classic_response() {
    check(pending::chronicle, false);
}

#[test]
fn societies_has_an_explicit_classic_response() {
    check(pending::societies, false);
}

#[test]
fn arcana_has_an_explicit_classic_response() {
    check(pending::arcana, false);
}

#[test]
fn ideas_has_an_explicit_classic_response() {
    check(|st| pending::ideas(st, 0), false);
}

#[test]
fn legend_ships_has_an_explicit_classic_response() {
    check(pending::legend_ships, false);
}

#[test]
fn realms_has_an_explicit_classic_response() {
    check(pending::realms, false);
}

#[test]
fn map_resource_now_returns_public_classic_layers_without_changing_the_game() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    for started in [false, true] {
        if started {
            handlers::new_game(&st, "newcomer", Some(42)).unwrap();
        }
        let before = st.game().unwrap().as_ref().map(|g| g.session.world.state_hash());
        let map = handlers::map_resource(&st, "classic".into()).unwrap();
        assert_eq!(map.rows, handlers::static_data(&st).map.rows);
        assert_eq!(map.hash, map.content_hash());
        assert!(handlers::map_resource(&st, "missing".into()).is_err());
        assert_eq!(before, st.game().unwrap().as_ref().map(|g| g.session.world.state_hash()));
    }
}

#[test]
fn fog_delta_now_returns_classic_bitmap_without_changing_the_game() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    assert!(matches!(handlers::fog_delta(&st, 0, None), Err(AppError::NoGame)));
    let overview = handlers::new_game(&st, "newcomer", Some(42)).unwrap();
    let before = handlers::debug(&st).unwrap().state_hash;
    let fog = handlers::fog_delta(&st, 0, None).unwrap();
    assert!(fog.full.is_some() && fog.runs.is_empty());
    assert_eq!(fog.rev, overview.fog_version);
    assert_eq!(handlers::debug(&st).unwrap().state_hash, before);
}

#[test]
fn navigation_has_an_explicit_classic_response() {
    check(|st| pending::navigation(st, 0), true);
}

#[test]
fn preview_course_has_an_explicit_classic_response() {
    check(|st| pending::preview_course(st, 0, vec![], 0), false);
}

#[test]
fn world_catalog_matches_i1_and_localizes_without_loading_hidden_worlds() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let catalog = serde_json::to_value(handlers::world_catalog(&st).unwrap()).unwrap();
    assert_eq!(catalog["current"], Value::Null);
    // 寰宇 2026-11-02 起进入开局列表，排在经典之后；隐藏的 testbed 仍不出现。
    let listed: Vec<_> = catalog["worlds"].as_array().unwrap().iter().map(|w| w["key"].as_str().unwrap()).collect();
    assert_eq!(listed, ["classic", "terra16"]);
    let world = &catalog["worlds"][0];
    assert_eq!(world["key"], "classic");
    assert_eq!(world["map_key"], "classic");
    assert_eq!(world["name"], "经典世界");
    assert_eq!(world["months"], json!(vec![30; 12]));
    assert_eq!(world["modules"], json!([]));
    assert!(world["tagline"].as_str().unwrap().len() > 1);
    assert!(world["description"].as_str().unwrap().len() > 1);
    let statics = handlers::static_data(&st);
    assert_eq!(world["era"], statics.world.era);
    assert_eq!(world["currency"], statics.world.currency);
    assert_eq!(world["start_year"], statics.world.start_year);
    assert_eq!(world["scenarios"].as_array().unwrap().len(), statics.scenarios.len());
    for (card, original) in world["scenarios"].as_array().unwrap().iter().zip(statics.scenarios) {
        assert_eq!(card["key"], original.key);
        assert_eq!(card["name"], original.name);
        assert_eq!(card["goal"], serde_json::to_value(original.goal).unwrap());
        assert_eq!(card["protagonists"], json!([]));
        assert_eq!(card["templates"], json!([]));
        assert_eq!(card["start_date"], json!([statics.world.start_year, 1, 1]));
        assert_eq!(card["control_date"], card["start_date"]);
        assert_eq!(card["options"], json!({"history_toggle":false,"skip_upbringing":false}));
        assert_eq!(card["upbringing"], false);
    }
    handlers::new_game(&st, "newcomer", Some(42)).unwrap();
    assert_eq!(serde_json::to_value(handlers::world_catalog(&st).unwrap()).unwrap()["current"], "classic");
    let mut settings = handlers::get_settings(&st).settings;
    settings.language = Some(manifest_data::Locale::En);
    handlers::save_settings(&st, settings).unwrap();
    assert_eq!(
        serde_json::to_value(handlers::world_catalog(&st).unwrap()).unwrap()["worlds"][0]["name"],
        "Classic World"
    );
    assert_eq!(
        st.localize_error(handlers::inventory(&st).unwrap_err()).to_string(),
        "This world does not support this feature yet."
    );
}

#[test]
fn select_world_rejections_preserve_the_game() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let expected = serde_json::to_value(handlers::static_data(&st)).unwrap();
    for started in [false, true] {
        if started {
            handlers::new_game(&st, "newcomer", Some(42)).unwrap();
        }
        let before = st.game().unwrap().as_ref().map(|g| g.session.world.state_hash());
        assert_eq!(serde_json::to_value(handlers::select_world(&st, "classic".into()).unwrap()).unwrap(), expected);
        // 寰宇 2026-11-02 转为成品世界；这里改用不存在的世界（草稿世界的错误键见 manifest-appcore 的 worlds 测试）。
        assert!(
            matches!(handlers::select_world(&st, "missing".into()), Err(AppError::Invalid(m)) if m.key == "app.unknown_world")
        );
        assert_eq!(before, st.game().unwrap().as_ref().map(|g| g.session.world.state_hash()));
    }
}

#[test]
fn desktop_i6_exposes_culture_milestones_and_persisted_ending() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let overview = handlers::new_world_game(
        &st,
        serde_json::from_value(json!({"world":"testbed","scenario":"upbringing","seed":42})).unwrap(),
    )
    .unwrap();
    assert_eq!(overview.mode, "upbringing");
    let view = pending::upbringing(&st).unwrap();
    assert!(view.get("culture").is_some());
    assert_eq!(view["exams"].as_array().unwrap().len(), 2);
    assert_eq!(view["path"]["options"].as_array().unwrap().len(), 3);
    for command in [
        json!({"TakeExam":{"owner":"player","exam":"test_exam_navigation"}}),
        json!({"SkipUpbringing":{"owner":"player"}}),
    ] {
        handlers::submit(&st, serde_json::from_value(command).unwrap()).unwrap();
    }
    assert!(pending::upbringing(&st).unwrap().is_null());
    assert!(pending::endings(&st).unwrap()["endings"].as_array().unwrap().iter().any(|e| e["got"] == true));
    assert!(tmp.path().join("endings.json").is_file());
}
