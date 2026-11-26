//! 节奏参数使用 I6 的 beats 毫秒表，不暴露或使用现实时间。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{
    ScenarioId, World,
    contests::{Kind, Params, occurrence_key, rhythm},
};
use serde_json::json;
#[test]
fn rhythm_query_has_the_contract_parameters_and_is_readonly() {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let c = std::sync::Arc::make_mut(&mut d).upbringing.contests.iter_mut().find(|c| c.key == "test_match").unwrap();
    c.kind = Kind::Rhythm;
    c.params = Params::Rhythm(rhythm::Params { bpm: 120, beats: vec![1000, 1500, 2000], window: 100 });
    let i = d.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
    let w = World::new(d, ScenarioId::from_idx(i), 42).unwrap();
    let before = w.state.clone();
    let v = upbringing_view::contest(Ctx::plain(&w.defs), &w, &occurrence_key("test_match", [1553, 1, 5])).unwrap();
    assert_eq!(v["kind"], "rhythm");
    assert_eq!(v["params"], json!({"bpm":120,"beats":[1000,1500,2000],"window":100}));
    assert_eq!(w.state, before);
}
