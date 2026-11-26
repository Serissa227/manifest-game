//! 自动日程只读且可提交，卡片和结算严格使用 I6 的键和数值形状。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{Command, OwnerId, ScenarioId, World};
use serde_json::json;
#[test]
fn all_presets_are_readonly_valid_and_views_expose_real_growth_and_previews() {
    let defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let i = defs.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
    let mut w = World::new(defs, ScenarioId::from_idx(i), 42).unwrap();
    let before = w.state.clone();
    for preset in ["balanced", "previous", "navigation", "trade", "combat", "learning", "social"] {
        let plan = upbringing_view::auto_plan(&w, preset).unwrap();
        let command: Command =
            serde_json::from_value(json!({"PlanMonth":{"owner":"player","slots":plan["slots"]}})).unwrap();
        let mut trial = w.clone();
        command.apply(&mut trial).unwrap();
        assert_eq!(w.state, before);
    }
    assert!(upbringing_view::auto_plan(&w, "missing").is_err());
    let view = upbringing_view::upbringing(Ctx::plain(&w.defs), &w);
    assert_eq!(view["growth"].as_array().unwrap().len(), 9);
    assert!(view["growth"].as_array().unwrap().iter().all(|g| g["attr"] != "piety"));
    assert_eq!(view["meters"]["mood"]["value"], 0);
    let act = view["activities"].as_array().unwrap().iter().find(|a| a["key"] == "train_navigation").unwrap();
    assert_eq!(act["cost"], 2);
    assert_eq!(act["gains"][0]["range"], json!([8, 13]));
    assert_eq!(act["needs"], json!([]));
    assert_eq!(view["presets"].as_array().unwrap().len(), 7);
    let plan = upbringing_view::auto_plan(&w, "navigation").unwrap();
    let slots = serde_json::from_value(plan["slots"].clone()).unwrap();
    Command::PlanMonth { owner: OwnerId::Player, slots }.apply(&mut w).unwrap();
    for _ in 0..10 {
        w.end_day().unwrap();
    }
    let view = upbringing_view::upbringing(Ctx::plain(&w.defs), &w);
    assert_eq!(view["last"][0]["cash"], -2);
    assert!(
        view["last"][0]["growth"]
            .as_array()
            .unwrap()
            .iter()
            .any(|v| v["attr"] == "navigation" && (8..=13).contains(&v["delta"].as_i64().unwrap()))
    );
    assert_eq!(view["plan"]["slots"][0]["result"], view["last"][0]);
}
