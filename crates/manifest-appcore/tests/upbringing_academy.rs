//! 小地图、校历和远足查询只读，并遵守人物喜好与地图探索的可见性。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{Command, OwnerId, ScenarioId, World};
use serde_json::json;
#[test]
fn maps_calendar_companions_and_auto_plans_are_readonly_and_hide_unknown_details() {
    let defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let i = defs.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
    let w = World::new(defs, ScenarioId::from_idx(i), 42).unwrap();
    let before = w.state.clone();
    let view = upbringing_view::upbringing(Ctx::plain(&w.defs), &w);
    assert_eq!(view["places"].as_array().unwrap().len(), 6);
    let tavern = view["places"].as_array().unwrap().iter().find(|p| p["key"] == "home_tavern").unwrap();
    assert!(tavern["people"].as_array().unwrap().iter().any(|p| p["key"] == "classmate_a"));
    assert!(tavern["people"].as_array().unwrap().iter().all(|p| p["key"] != "visitor"));
    assert!(
        view["places"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|p| p["key"] != "home_tavern")
            .all(|p| p["people"] == json!([]))
    );
    let graph = &view["excursions"][0];
    assert_eq!(graph["nodes"][0]["state"], "new");
    assert_eq!(graph["nodes"][1]["state"], "unknown");
    assert_eq!(graph["nodes"][1]["name"], "?");
    assert!(graph["nodes"][1]["hint"].is_null());
    assert_eq!(graph["nodes"][1]["links"], json!([]));
    let mark = view["calendar"].as_array().unwrap().iter().find(|v| v["key"] == "test_festival").unwrap();
    assert_eq!(mark["date"], json!([1553, 2, 3]));
    assert_eq!(mark["days_left"], 33);
    let friend = view["companions"].as_array().unwrap().iter().find(|v| v["key"] == "classmate_a").unwrap();
    assert_eq!(friend["role"], "friend");
    assert_eq!(friend["likes_known"], json!([]));
    for preset in ["balanced", "previous", "navigation", "trade", "combat", "learning", "social"] {
        let plan = upbringing_view::auto_plan(&w, preset).unwrap();
        let slots = serde_json::from_value(plan["slots"].clone()).unwrap();
        let mut trial = w.clone();
        Command::PlanMonth { owner: OwnerId::Player, slots }.apply(&mut trial).unwrap();
    }
    assert_eq!(w.state, before);

    let mut defs = (*w.defs).clone();
    defs.upbringing.activities.iter_mut().find(|a| a.key == "companion_walk").unwrap().tags.push("social".into());
    let trial = World::new(std::sync::Arc::new(defs), ScenarioId::from_idx(i), 42).unwrap();
    let plan = upbringing_view::auto_plan(&trial, "social").unwrap();
    assert_eq!(plan["slots"].as_array().unwrap().iter().filter(|s| !s["after"]["companion"].is_null()).count(), 2);
    let slots = serde_json::from_value(plan["slots"].clone()).unwrap();
    let mut submitted = trial.clone();
    Command::PlanMonth { owner: OwnerId::Player, slots }.apply(&mut submitted).unwrap();
}
