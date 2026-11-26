//! I6 辩论只公开题面、论点、克制关系；本地化不影响命令的牌键。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{
    ScenarioId, World,
    contests::{Kind, occurrence_key},
};
use serde_json::json;
use std::sync::Arc;

#[test]
fn debate_view_uses_localized_text_and_stable_card_keys() {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let c = &mut Arc::make_mut(&mut d).upbringing.contests[0];
    c.kind = Kind::Debate;
    c.params = serde_json::from_value(json!({"topic":"占位题目","rounds":[{"opponent":{"text":"占位论点","kind":"a"}}],"hand":[{"key":"card","text":"占位牌","kind":"b"}],"beats":[["b","a"]]})).unwrap();
    let w = World::new(d.clone(), sid, 42).unwrap();
    let mut names = (*d).clone();
    let manifest_core::contests::Params::Debate(p) = &mut names.upbringing.contests[0].params else { unreachable!() };
    p.topic = "Placeholder topic".into();
    let before = w.state.clone();
    let view = upbringing_view::contest(Ctx::plain(&names), &w, &occurrence_key("test_match", [1553, 1, 5])).unwrap();
    assert_eq!(view["kind"], "debate");
    assert_eq!(view["params"]["topic"], "Placeholder topic");
    assert_eq!(view["params"]["hand"][0]["key"], "card");
    assert_eq!(
        view["params"].as_object().unwrap().keys().map(String::as_str).collect::<Vec<_>>(),
        ["beats", "hand", "rounds", "topic"]
    );
    assert_eq!(view.as_object().unwrap().len(), 10);
    assert_eq!(view["registered"], false);
    assert_eq!(view["can_register"], true);
    assert_eq!(view["days_left"], 4);
    assert_eq!(w.state, before);
}
