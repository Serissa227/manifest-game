//! 毕业条件只冻结一次；主角约定令配对改为朋友，成年关系仍走统一门禁。
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    cast::{
        metadata::{DeferredTie, GraduationCondition},
        relations::{Relation, TieDef},
    },
    upbringing::{AfterChoice, PlanSlot},
};
use std::sync::Arc;
fn defs() -> Arc<manifest_core::StaticData> {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let data = Arc::make_mut(&mut d);
    data.upbringing.families[0].graduation = [1553, 1, 2];
    data.upbringing.families[0].stages.truncate(1);
    data.upbringing.families[0].born = [1535, 1, 1];
    for p in &mut data.cast.persons {
        if ["classmate_a", "classmate_b"].contains(&p.key.as_str()) {
            p.born = [1535, 1, 1];
        }
    }
    data.cast.deferred_ties.push(DeferredTie {
        key: "test_pair".into(),
        tie: TieDef {
            a: "classmate_a".into(),
            b: "classmate_b".into(),
            kind: Relation::Lovers,
            since: [1553, 1, 1],
            to: None,
            when: vec![],
            basis: "original".into(),
            sources: vec![],
            story: None,
            open: true,
            tags: vec![],
        },
        when: GraduationCondition {
            graduation: true,
            no_promise_with_protagonist: vec!["classmate_a".into(), "classmate_b".into()],
            flag: Some("test_pair_enabled".into()),
        },
    });
    d
}
fn graduate(d: Arc<manifest_core::StaticData>, promised: bool, flag: bool) -> World {
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let mut w = World::new(d, sid, 42).unwrap();
    if flag {
        w.state.cast.flags.insert("test_pair_enabled".into());
    }
    if promised {
        w.change_affinity("classmate_a", 80).unwrap();
        for _ in 0..3 {
            w.remember_experience("classmate_a").unwrap();
        }
        w.promise_to("classmate_a").unwrap();
    }
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
            .collect(),
    }
    .apply(&mut w)
    .unwrap();
    w.end_day().unwrap();
    w
}
#[test]
fn graduation_pair_or_friend_is_frozen_and_preserves_the_protagonist_promise() {
    let d = defs();
    for promised in [false, true] {
        let mut w = graduate(d.clone(), promised, true);
        assert_eq!(w.state.cast.graduation_ties["test_pair"], !promised);
        let kind = if promised { Relation::Friends } else { Relation::Lovers };
        assert!(w.active_ties().iter().any(|t| t.a == "classmate_a" && t.b == "classmate_b" && t.kind == kind));
        assert_eq!(w.state.cast.promise.as_deref(), promised.then_some("classmate_a"));
        same_saved_state(&World::from_snapshot(d.clone(), w.state.clone()).unwrap(), &w);
        w.state.cast.flags.remove("test_pair_enabled");
        w.end_day().unwrap();
        assert_eq!(w.state.cast.graduation_ties["test_pair"], !promised);
        assert!(w.active_ties().iter().any(|t| t.a == "classmate_a" && t.b == "classmate_b" && t.kind == kind));
    }
    let mut closed = graduate(d.clone(), false, false);
    assert!(!closed.state.cast.graduation_ties.contains_key("test_pair"));
    closed.state.cast.flags.insert("test_pair_enabled".into());
    closed.end_day().unwrap();
    assert!(!closed.state.cast.graduation_ties.contains_key("test_pair"));
}
#[test]
fn graduation_state_rejects_a_future_decision_day() {
    let d = defs();
    let mut w = graduate(d.clone(), false, true);
    w.state.cast.graduation_day = Some(w.day() + 1);
    assert!(World::from_snapshot(d, w.state).is_err());
}

// 逐字节核对全部存档字段；B7 的迷雾增量缓存明确不属于存档。
fn same_saved_state(a: &World, b: &World) {
    assert_eq!(serde_json::to_vec(&a.state).unwrap(), serde_json::to_vec(&b.state).unwrap());
    assert_eq!(a.state_hash(), b.state_hash());
}
