//! 简介、秘密、后日谈与生日的已知信息边界；明确的解锁旗标必须存档保留。
use manifest_appcore::{cast_view, views::Ctx};
use manifest_core::{ScenarioId, World};
use std::sync::Arc;

#[test]
fn secret_and_after_require_explicit_knowledge_and_after_requires_a_conclusion() {
    let mut defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let p = Arc::make_mut(&mut defs).cast.persons.iter_mut().find(|p| p.key == "classmate_a").unwrap();
    p.summary = "公开简介".into();
    p.secret = "尚未知晓的秘密".into();
    p.after = "尚未来到的后日谈".into();
    p.birthday = Some([1, 1]);
    let mut w = World::new(defs, ScenarioId(0), 42).unwrap();
    w.state.cast.persons.entry("classmate_a".into()).or_default().met = true;
    let before = w.state.clone();
    let view = cast_view::person(Ctx::plain(&w.defs), &w, "classmate_a").unwrap();
    assert_eq!(view["summary"], "公开简介");
    assert_eq!(view["birthday"], serde_json::json!([1, 1]));
    assert!(view["secret"].is_null() && view["after"].is_null());
    assert!(!view.to_string().contains("尚未"));
    assert_eq!(w.state, before);
    w.state.story2.flags.extend(["secret_classmate_a_known".into(), "after_classmate_a_known".into()]);
    let view = cast_view::person(Ctx::plain(&w.defs), &w, "classmate_a").unwrap();
    assert_eq!(view["secret"], "尚未知晓的秘密");
    assert!(view["after"].is_null());
    w.state.story2.flags.insert("upbringing_graduated".into());
    let w = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    let view = cast_view::person(Ctx::plain(&w.defs), &w, "classmate_a").unwrap();
    assert_eq!(view["after"], "尚未来到的后日谈");
    assert!(view["bio_pages"].as_array().unwrap().iter().any(|p| p["text"] == "尚未来到的后日谈"));
    assert!(cast_view::person(Ctx::plain(&w.defs), &w, "distant").is_none());
}
