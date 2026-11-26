//! A9：身份过滤后的前端序号与生产命令保持一致。
use manifest_appcore::{story_view::story_view_in, views::Ctx};
use manifest_core::{
    scenario::{Gender, ProtagonistIdentity},
    story2::Story2Defs,
    *,
};
use serde_json::json;
use std::sync::Arc;

#[test]
fn story_view_hides_identity_options_and_submits_the_visible_index() {
    let mut defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    Arc::make_mut(&mut defs).story2 = serde_json::from_value::<Story2Defs>(json!({"tracks":[{
    "key":"filtered","name":"过滤测试","kind":"request","start":"a","auto":true,
    "chapters":[{"key":"a","title":"选择","text":"选项过滤测试。","choices":[
        {"key":"other","text":"其他主角。","next":"done","requires":[{"protagonist":"other"}]},
        {"key":"current","text":"当前主角。","next":"done","requires":[{"protagonist":"hero"}]},
        {"key":"poor","text":"资金门槛。","next":"done","requires":[{"kind":"cash","ge":999999999}]}
    ]}]}]}))
    .unwrap();
    let mut w = World::new(defs, ScenarioId(0), 42).unwrap();
    w.state.protagonist = Some(ProtagonistIdentity {
        protagonist: Some("hero".into()),
        template: None,
        born: [1540, 1, 1],
        gender: Gender::F,
    });
    w.refresh_story2();
    let before = w.state.clone();
    let view = serde_json::to_value(story_view_in(Ctx::plain(&w.defs), &w)).unwrap();
    assert_eq!(view["pending"]["choices"].as_array().unwrap().len(), 2);
    assert_eq!(view["pending"]["choices"][0]["key"], "current");
    assert!(view["pending"]["choices"][0]["blocked"].is_null());
    assert_eq!(view["pending"]["choices"][1]["key"], "poor");
    assert!(view["pending"]["choices"][1]["blocked"].is_string());
    assert_eq!(w.state, before);
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    let view = serde_json::to_value(story_view_in(Ctx::plain(&w.defs), &w)).unwrap();
    assert_eq!(view["last"]["choice"], "当前主角。");
    assert_eq!(w.state.story2.last.as_ref().unwrap().choice_key.as_deref(), Some("current"));
}
