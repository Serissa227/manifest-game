//! 未知地点的所有公开查询使用与不存在相同的结果。
use manifest_ai::MemoryKeyStore;
use manifest_app::{AppPaths, AppState, Locales, handlers};
use manifest_core::*;
use std::sync::Arc;

fn app(path: &std::path::Path) -> AppState {
    let data = manifest_data::find_data_dir().unwrap();
    let mut defs = (*manifest_data::load_shared(&data).unwrap()).clone();
    defs.manual_navigation = true;
    let kinds = [
        manifest_core::defs::DiscoveryKind::Animal,
        manifest_core::defs::DiscoveryKind::Plant,
        manifest_core::defs::DiscoveryKind::Fallen,
        manifest_core::defs::DiscoveryKind::Phantom,
    ];
    for (d, kind) in defs.discoveries.iter_mut().zip(kinds) {
        d.kind = kind;
    }
    let defs = Arc::new(defs);
    let mut locales = Locales::load(&data).unwrap();
    Arc::make_mut(&mut locales.zh).defs = defs.clone();
    Arc::make_mut(&mut locales.en).defs = defs.clone();
    let st = AppState::new(
        defs,
        Arc::new(manifest_data::load_ai_content(&data).unwrap()),
        locales,
        Arc::new(MemoryKeyStore::default()),
        AppPaths::in_dir(path),
    )
    .unwrap();
    handlers::new_game(&st, "newcomer", Some(42)).unwrap();
    {
        let mut guard = st.game().unwrap();
        let w = &mut guard.as_mut().unwrap().session.world;
        w.state.explore.cells.fill(0);
        w.state.explore.visited.clear();
        w.state.explore.sighted.clear();
        w.state.explore.discovered.clear();
    }
    st
}

#[test]
fn direct_unknown_ids_match_nonexistent_and_static_definitions_are_private() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let id = handlers::overview(&st).unwrap().fleets[0].id;
    let error = |e: manifest_app::AppError| e.to_string();
    assert_eq!(error(handlers::port(&st, 1).unwrap_err()), error(handlers::port(&st, u16::MAX).unwrap_err()));
    assert_eq!(error(handlers::site(&st, 1).unwrap_err()), error(handlers::site(&st, u16::MAX).unwrap_err()));
    assert_eq!(
        error(handlers::sail_preview(&st, id, 1).unwrap_err()),
        error(handlers::sail_preview(&st, id, u16::MAX).unwrap_err())
    );
    assert_eq!(
        error(handlers::market_series(&st, 1, 0).unwrap_err()),
        error(handlers::market_series(&st, u16::MAX, 0).unwrap_err())
    );
    let quote = |loc| handlers::quote(&st, handlers::QuoteRequest { loc, good: 0, side: "buy".into(), qty: 1 });
    assert_eq!(error(quote(1).unwrap_err()), error(quote(u16::MAX).unwrap_err()));
    assert_eq!(handlers::item_shop(&st, 1).unwrap(), handlers::item_shop(&st, u16::MAX).unwrap());
    let statics = handlers::static_data(&st);
    assert!(statics.locations.is_empty() && statics.roads.is_empty() && statics.exchanges.is_empty());
    assert!(statics.discoveries.is_empty() && statics.landmarks.is_empty());
    assert_eq!(handlers::overview(&st).unwrap().sighted, Some(vec![]));
    assert!(handlers::mates(&st).unwrap().available.is_empty());
    let guard = st.game().unwrap();
    let w = &guard.as_ref().unwrap().session.world;
    let ctx = manifest_app::views::Ctx::plain(&w.defs);
    let secret = &w.defs.loc(LocId(1)).name;
    let mut text = serde_json::json!({"text":format!("前往{secret}"),"lore":format!("记述{secret}"),"name":format!("{secret}札记"),"key":"kept_as_machine_key"});
    manifest_appcore::navigation_view::visibility::redact_prose(ctx, w, &mut text);
    assert!(!text["text"].as_str().unwrap().contains(secret));
    assert!(!text["lore"].as_str().unwrap().contains(secret));
    assert!(!text["name"].as_str().unwrap().contains(secret));
    assert_eq!(text["key"], "kept_as_machine_key");
}

#[test]
fn visible_destinations_keep_original_ids_and_four_new_discovery_kinds_stay_hidden() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    {
        let mut guard = st.game().unwrap();
        let w = &mut guard.as_mut().unwrap().session.world;
        let fleet = w.fleets_of(OwnerId::Player).next().unwrap();
        let id = fleet.id;
        let home = fleet.docked_at().unwrap();
        let index = w.defs.map.idx(w.defs.loc(home).cell);
        assert_eq!(
            manifest_appcore::navigation_view::known_dests(manifest_app::views::Ctx::plain(&w.defs), w, id, 0),
            serde_json::json!([])
        );
        w.state.explore.cells[index / 64] |= 1 << (index % 64);
        let list = manifest_appcore::navigation_view::known_dests(manifest_app::views::Ctx::plain(&w.defs), w, id, 0);
        assert_eq!(list.as_array().unwrap().len(), 1);
        assert_eq!(list[0]["loc"], home.0);
        assert!(!w.loc_known(home));
        w.state.explore.discovered.insert(DiscoveryId(0), 0);
    }
    let view = handlers::static_data(&st);
    assert_eq!(view.locations.len(), 1);
    assert_eq!(view.discoveries.len(), 1);
    assert_eq!(view.discoveries[0].kind, "animal");
}
