//! 同学回忆仅随已认识的人物详情公开，不为旧状态补造记录。
use manifest_appcore::{cast_view, views::Ctx};
use manifest_core::{
    cast::{PersonState, reunions::SchoolMemory},
    *,
};

#[test]
fn person_detail_exposes_only_recorded_known_school_memories_without_mutation() {
    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    w.state.cast.persons.insert("classmate_a".into(), PersonState { met: true, ..Default::default() });
    let view = cast_view::person(Ctx::plain(&w.defs), &w, "classmate_a").unwrap();
    assert!(view.get("school_memory").is_none());
    let day = w.day();
    w.state.cast.persons.get_mut("classmate_a").unwrap().school = Some(SchoolMemory {
        family: "test_family".into(),
        academies: vec!["test_academy".into()],
        graduated_on: day,
        affection: Default::default(),
        promise: false,
        memories: vec!["测试回忆".into()],
        parted: false,
        reunited_on: None,
    });
    let before = w.state.clone();
    let view = cast_view::person(Ctx::plain(&w.defs), &w, "classmate_a").unwrap();
    assert_eq!(view["school_memory"]["academies"][0], "test_academy");
    assert_eq!(view["school_memory"]["memories"][0], "测试回忆");
    assert!(view["school_memory"]["reunited_on"].is_null());
    assert_eq!(w.state, before);
    w.state.cast.persons.get_mut("classmate_a").unwrap().met = false;
    // 清掉可见于当下地点的条件，避免“正在这里”本身构成相识。
    w.state.cast.place = None;
    w.state.cast.persons.get_mut("classmate_a").unwrap().alive = Some(false);
    assert!(cast_view::person(Ctx::plain(&w.defs), &w, "classmate_a").is_none());
}
