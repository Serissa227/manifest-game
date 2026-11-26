//! 按主角开局（寰宇）的局没有另设船长：概览的名牌用主角的名字与当前年龄的头像；另设过船长时照旧用设的。
use manifest_appcore::{AppPaths, AppState, handlers, views::CaptainView};
use serde_json::json;
use std::sync::Arc;

fn app() -> AppState {
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let dir = std::env::temp_dir().join(format!("manifest-hero-captain-{}-{n}", std::process::id()));
    let base = AppState::from_data_dir(
        &manifest_data::find_data_dir().unwrap(),
        Arc::new(manifest_ai::MemoryKeyStore::default()),
        AppPaths::in_dir(&dir),
    )
    .unwrap();
    let resources = base.worlds().get("testbed").unwrap();
    let mut defs = resources.defs.clone();
    let d = Arc::make_mut(&mut defs);
    let scenario = d.scenarios.iter_mut().find(|s| s.key == "upbringing").unwrap();
    scenario.protagonists = vec!["test_hero".into()];
    scenario.protagonist_defs = vec![manifest_core::scenario::ProtagonistDef {
        key: "test_hero".into(),
        born: [1540, 1, 1],
        gender: manifest_core::scenario::Gender::F,
        captain: None,
        card: None,
    }];
    let mut locales = resources.locales.clone();
    Arc::make_mut(&mut locales.zh).defs = defs.clone();
    Arc::make_mut(&mut locales.en).defs = defs.clone();
    let st = AppState::new(
        defs,
        resources.content.clone(),
        locales,
        Arc::new(manifest_ai::MemoryKeyStore::default()),
        base.paths().clone(),
    )
    .unwrap();
    let mut settings = st.settings();
    settings.ai.mode = manifest_ai::AiMode::Off;
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings).unwrap();
    st
}

#[test]
fn protagonist_games_show_the_hero_on_the_name_plate() {
    let st = app();
    let request = json!({"world":"testbed","scenario":"upbringing","seed":42,"protagonist":"test_hero"});
    let overview = handlers::new_world_game(&st, serde_json::from_value(request).unwrap()).unwrap();
    assert_eq!(overview.captain.as_ref().map(|c| c.name.as_str()), Some("试航者"));
    // 1553 年 13 岁：取 0 岁起的那张头像（18 岁起才换）
    assert_eq!(overview.captain_asset.as_deref(), Some("test_child"));
    // 存档：船长仍是空（读档不会把主角当成另设的船长），列表用 hero 显示主角名；读回来名牌照旧
    let info = handlers::save_game(&st, "hero").unwrap();
    assert!(info.captain.is_none());
    assert_eq!(info.hero.as_deref(), Some("试航者"));
    let loaded = handlers::load_game(&st, "hero").unwrap();
    assert_eq!(loaded.captain.as_ref().map(|c| c.name.as_str()), Some("试航者"));
    assert_eq!(loaded.captain_asset.as_deref(), Some("test_child"));
    // 另设过船长（自创模板走这条路）时照旧用设的，不再挂主角头像
    let set = handlers::set_captain(&st, CaptainView { name: "旅人".into(), portrait: 3 }).unwrap();
    assert_eq!(set.captain.as_ref().map(|c| c.name.as_str()), Some("旅人"));
    assert!(set.captain_asset.is_none());
}
