//! 公开作诗词表按语言显示，选择下标与隐藏评分保持一致。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    contests::{Moves, occurrence_key},
};
use serde_json::json;
#[test]
fn localized_poem_options_preserve_indices_and_do_not_expose_private_points() {
    let root = manifest_data::find_data_dir().unwrap();
    let d = manifest_data::load_world(&root, "testbed").unwrap();
    let i = d.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
    let mut w = World::new(d, ScenarioId::from_idx(i), 42).unwrap();
    let effective = manifest_data::resolve_world(&root, "testbed").unwrap();
    let ai = manifest_data::ai_content::load_world_ai_content(&effective).unwrap();
    let (en, issues) =
        manifest_data::locale::load_world_locale_lenient(&effective, manifest_data::Locale::En, &w.defs, &ai);
    assert!(issues.iter().all(|i| !i.file.contains("upbringing")), "{issues:?}");
    assert!(en.missing.iter().all(|i| !i.file.contains("upbringing")), "{:?}", en.missing);
    let key = occurrence_key("test_poem", [1553, 1, 8]);
    let before = w.state.clone();
    let view = upbringing_view::contest(Ctx::plain(&en.defs), &w, &key).unwrap();
    assert_eq!(view["name"], "Placeholder poem");
    assert_eq!(view["params"]["theme"], "Placeholder theme");
    assert_eq!(view["params"]["lines"][0]["options"], json!(["A", "B"]));
    assert_eq!(view["params"]["lines"][1]["options"], json!(["C", "D"]));
    assert_eq!(view["params"].as_object().unwrap().len(), 3);
    assert!(!serde_json::to_string(&view).unwrap().contains("line_points"));
    assert_eq!(w.state, before);
    assert_eq!(
        en.defs.upbringing.contests.iter().find(|c| c.key == "test_poem").unwrap().scoring,
        w.defs.upbringing.contests.iter().find(|c| c.key == "test_poem").unwrap().scoring
    );
    assert_eq!(en.defs.meta.hash, w.defs.meta.hash);
    Command::PlayContest { owner: OwnerId::Player, contest: key.clone(), moves: Moves::Choices(vec![1, 1]) }
        .apply(&mut w)
        .unwrap();
    assert_eq!(w.state.upbringing.as_ref().unwrap().contest_results[&key].game_score, Some(100));
}
