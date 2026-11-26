//! 辨识视图只公开线索和选项，题目答案不进入 JSON。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{
    ScenarioId, World,
    contests::{Kind, Params, occurrence_key},
};
use serde_json::json;
use std::{collections::BTreeMap, sync::Arc};
#[test]
fn identify_view_localizes_clues_and_does_not_expose_correct_answers() {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let c = &mut Arc::make_mut(&mut d).upbringing.contests[0];
    c.kind = Kind::Identify;
    c.params = serde_json::from_value(
        json!({"samples":[{"key":"sample","clues":["占位线索"]}],"answers":[{"key":"answer","name":"占位答案"}]}),
    )
    .unwrap();
    c.scoring.answers = BTreeMap::from([("sample".into(), "answer".into())]);
    assert!(manifest_core::contests::validation::validate(&d).is_empty());
    let w = World::new(d.clone(), sid, 42).unwrap();
    let before = w.state.clone();
    let mut names = (*d).clone();
    let Params::Identify(p) = &mut names.upbringing.contests[0].params else { unreachable!() };
    p.samples[0].clues[0] = "Placeholder clue".into();
    p.answers[0].name = "Placeholder answer".into();
    let v = upbringing_view::contest(Ctx::plain(&names), &w, &occurrence_key("test_match", [1553, 1, 5])).unwrap();
    assert_eq!(v["kind"], "identify");
    assert_eq!(
        v["params"],
        json!({"samples":[{"key":"sample","clues":["Placeholder clue"]}],"answers":[{"key":"answer","name":"Placeholder answer"}]})
    );
    assert_eq!(v.as_object().unwrap().len(), 10);
    assert_eq!(v["registered"], false);
    assert_eq!(v["can_register"], true);
    assert_eq!(v["days_left"], 4);
    assert_eq!(before, w.state);
}
