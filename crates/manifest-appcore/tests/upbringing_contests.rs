//! 比赛列表、详情及校历保持 I6 的参数形状，查询不领奖也不改随机状态。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{ScenarioId, World, contests::occurrence_key};
#[test]
fn contest_query_has_exact_public_shape_and_no_private_scoring() {
    let root = manifest_data::find_data_dir().unwrap();
    let defs = manifest_data::load_world(&root, "testbed").unwrap();
    let i = defs.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
    let w = World::new(defs, ScenarioId::from_idx(i), 42).unwrap();
    let before = w.state.clone();
    let key = occurrence_key("test_match", [1553, 1, 5]);
    let view = upbringing_view::contest(Ctx::plain(&w.defs), &w, &key).unwrap();
    assert_eq!(view["kind"], "match");
    assert_eq!(view["params"]["faces"].as_array().unwrap().len(), 4);
    assert_eq!(view.as_object().unwrap().len(), 10);
    assert_eq!(view["registered"], false);
    assert_eq!(view["can_register"], true);
    assert_eq!(view["days_left"], 4);
    assert!(view.get("scoring").is_none());
    assert!(view["seed"].as_u64().unwrap() < 9_007_199_254_740_992);
    assert_eq!(view["auto_pct"], 3);
    let up = upbringing_view::upbringing(Ctx::plain(&w.defs), &w);
    let c = up["contests"].as_array().unwrap().iter().find(|c| c["key"] == key).unwrap();
    assert_eq!(c["status"], "open");
    assert_eq!(c["prep"], 2);
    assert!(c["result"].is_null());
    assert!(
        up["calendar"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["key"] == key && m["kind"] == "contest" && m["days_left"] == 4)
    );
    assert_eq!(w.state, before);
    let effective = manifest_data::resolve_world(&root, "testbed").unwrap();
    let ai = manifest_data::ai_content::load_world_ai_content(&effective).unwrap();
    let (en, issues) =
        manifest_data::locale::load_world_locale_lenient(&effective, manifest_data::Locale::En, &w.defs, &ai);
    assert!(issues.iter().all(|i| !i.file.contains("upbringing")), "{issues:?}");
    assert!(en.missing.iter().all(|i| !i.file.contains("upbringing")), "{:?}", en.missing);
    assert_eq!(en.defs.upbringing.contests[0].name, "Placeholder contest");
    assert_eq!(en.defs.meta.hash, w.defs.meta.hash);
}

#[test]
fn displayed_win_estimate_matches_actual_seeded_rankings() {
    use manifest_core::{Command, OwnerId, contests::Moves};
    use std::sync::Arc;

    let root = manifest_data::find_data_dir().unwrap();
    let original = manifest_data::load_world(&root, "testbed").unwrap();
    for (base, rivals) in [(40, 2), (95, 1)] {
        let mut defs = original.clone();
        let contest = &mut Arc::make_mut(&mut defs).upbringing.contests[0];
        contest.check.base = base;
        contest.rivals.truncate(rivals);
        let i = defs.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
        let key = occurrence_key("test_match", [1553, 1, 5]);
        let sample = World::new(defs.clone(), ScenarioId::from_idx(i), 0).unwrap();
        let view = upbringing_view::contest(Ctx::plain(&defs), &sample, &key).unwrap();
        let estimate = view["auto_pct"].as_i64().unwrap();
        let mut wins = 0;
        for seed in 0..512 {
            let mut w = World::new(defs.clone(), ScenarioId::from_idx(i), seed).unwrap();
            Command::PlayContest { owner: OwnerId::Player, contest: key.clone(), moves: Moves::Pairs(vec![]) }
                .apply(&mut w)
                .unwrap();
            wins += i64::from(w.state.upbringing.as_ref().unwrap().contest_results[&key].rank == 1);
        }
        assert!(
            (wins * 100 / 512 - estimate).abs() <= 3,
            "base={base}, rivals={rivals}, estimate={estimate}, wins={wins}/512"
        );
    }
}

#[test]
fn contest_handler_preserves_unavailable_errors_and_serves_only_active_upbringing() {
    use manifest_ai::MemoryKeyStore;
    use manifest_appcore::{AppError, AppPaths, AppState, handlers};
    use manifest_core::CommandError;
    use serde_json::json;
    use std::sync::Arc;

    let tmp = std::env::temp_dir().join(format!("manifest-a6-contest-handler-{}", std::process::id()));
    let st = AppState::from_data_dir(
        &manifest_data::find_data_dir().unwrap(),
        Arc::new(MemoryKeyStore::default()),
        AppPaths::in_dir(&tmp),
    )
    .unwrap();
    for request in [
        None,
        Some(json!({"world":"classic","scenario":"newcomer","seed":42})),
        Some(json!({"world":"testbed","scenario":"sandbox","seed":42})),
    ] {
        if let Some(request) = request {
            handlers::new_world_game(&st, serde_json::from_value(request).unwrap()).unwrap();
        }
        let before = st.game().unwrap().as_ref().map(|g| g.session.world.state_hash());
        assert!(matches!(
            handlers::pending::contest(&st, "missing".into()),
            Err(AppError::Invalid(message)) if message.key == "app.feature_unavailable"
        ));
        assert_eq!(before, st.game().unwrap().as_ref().map(|g| g.session.world.state_hash()));
    }
    let request = serde_json::from_value(json!({"world":"testbed","scenario":"upbringing","seed":42})).unwrap();
    handlers::new_world_game(&st, request).unwrap();
    let before = handlers::debug(&st).unwrap().state_hash;
    let key = occurrence_key("test_match", [1553, 1, 5]);
    let view = handlers::pending::contest(&st, key.clone()).unwrap();
    assert_eq!(view["key"], key);
    assert_eq!(view["kind"], "match");
    assert_eq!(view.as_object().unwrap().len(), 10);
    assert_eq!(view["registered"], false);
    assert_eq!(view["can_register"], true);
    assert_eq!(view["days_left"], 4);
    assert!(matches!(
        handlers::pending::contest(&st, "missing".into()),
        Err(AppError::Command(CommandError::NotFound(key))) if key == "missing"
    ));
    assert_eq!(before, handlers::debug(&st).unwrap().state_hash);
}
