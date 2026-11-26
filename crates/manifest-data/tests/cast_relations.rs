//! 年龄规则的逐边界测试与生日跨界回归。
use manifest_core::{
    cast::relations::*,
    scenario::{Gender, ProtagonistIdentity},
    *,
};

fn actor_at(age: u32, with: &[String]) -> RomanceActor<'_> {
    RomanceActor {
        age: Some(age),
        born: None,
        gender: Gender::F,
        historical: false,
        authority: false,
        with: Some(with),
    }
}

#[test]
fn age_rule_table_covers_15_16_17_18_and_three_or_four_year_gaps() {
    let with = vec!["f".into()];
    for (a, b, action, allowed) in [
        (15, 16, RomanceAction::Heart, true),
        (15, 16, RomanceAction::Dating, false),
        (16, 16, RomanceAction::Dating, true),
        (17, 17, RomanceAction::Dating, true),
        (17, 17, RomanceAction::Lovers, false),
        (17, 17, RomanceAction::Partners, false),
        (17, 18, RomanceAction::Heart, false),
        (18, 18, RomanceAction::Lovers, true),
        (18, 18, RomanceAction::Partners, true),
        (14, 17, RomanceAction::Heart, true),
        (13, 17, RomanceAction::Heart, false),
        (18, 21, RomanceAction::Heart, true),
        (18, 22, RomanceAction::Heart, false),
        (16, 17, RomanceAction::Lovers, false),
        (16, 17, RomanceAction::Partners, false),
    ] {
        assert_eq!(
            romance_gate(&actor_at(a, &with), &actor_at(b, &with), action, false).is_ok(),
            allowed,
            "{a}/{b} {action:?}"
        );
    }
}

#[test]
fn authority_history_orientation_and_academy_cannot_be_bypassed() {
    let with = vec!["f".into()];
    let mut a = actor_at(16, &with);
    let b = actor_at(16, &with);
    a.authority = true;
    assert_eq!(romance_gate(&a, &b, RomanceAction::Heart, false), Err(RomanceError::Authority));
    a.authority = false;
    a.historical = true;
    assert_eq!(romance_gate(&a, &b, RomanceAction::Heart, false), Err(RomanceError::Historical));
    a.historical = false;
    a.gender = Gender::M;
    assert_eq!(romance_gate(&a, &b, RomanceAction::Heart, false), Err(RomanceError::Orientation));
    a.gender = Gender::F;
    assert!(romance_gate(&a, &b, RomanceAction::Dating, true).is_ok());
    assert_eq!(romance_gate(&actor_at(15, &with), &b, RomanceAction::Dating, true), Err(RomanceError::UnderSixteen));
    assert_eq!(romance_gate(&a, &b, RomanceAction::Lovers, true), Err(RomanceError::Academy));
    assert_eq!(romance_gate(&a, &b, RomanceAction::Partners, true), Err(RomanceError::Academy));
    assert!(romance_gate(&a, &b, RomanceAction::Heart, true).is_ok());
}

fn world() -> World {
    let mut defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let d = std::sync::Arc::make_mut(&mut defs);
    d.scenarios[0].start_date = [1557, 12, 31];
    d.scenarios[0].control_date = [1557, 12, 31];
    d.cast.persons.iter_mut().find(|p| p.key == "classmate_a").unwrap().born = [1540, 6, 1];
    let mut w = World::new(defs, ScenarioId(0), 42).unwrap();
    w.state.protagonist =
        Some(ProtagonistIdentity { protagonist: None, template: None, born: [1540, 1, 1], gender: Gender::F });
    w
}

#[test]
fn birthday_temporarily_closes_romance_but_keeps_friendship_and_lifetime_promise() {
    let mut w = world();
    w.change_affinity("classmate_a", 80).unwrap();
    for _ in 0..3 {
        w.remember_experience("classmate_a").unwrap();
    }
    w.promise_to("classmate_a").unwrap();
    w.change_heart("classmate_a", 40).unwrap();
    w.change_relation("classmate_a", Relation::Dating, false).unwrap();
    w.end_day().unwrap();
    assert_eq!(w.cast_date(), [1558, 1, 1]);
    let before = w.state.clone();
    assert!(w.change_heart("classmate_a", 1).is_err());
    assert!(w.change_relation("classmate_a", Relation::Dating, false).is_err());
    assert!(w.change_tie("classmate_a", "classmate_b", Relation::Lovers).is_err());
    assert_eq!(w.state, before);
    assert_eq!(w.affection("classmate_a").unwrap().bond, Some(Bond::S));
    assert_eq!(w.affection("classmate_a").unwrap().heart, 40);
    assert!(!w.visible_relations("classmate_a").contains(&Relation::Dating));
    w.change_affinity("classmate_a", 1).unwrap();
    w.state.day = manifest_core::scenario::day_of(&w.defs, [1558, 6, 1]).unwrap();
    w.change_heart("classmate_a", 1).unwrap();
    w.change_tie("classmate_a", "classmate_b", Relation::Lovers).unwrap();
    w.change_affinity("classmate_b", 100).unwrap();
    for _ in 0..3 {
        w.remember_experience("classmate_b").unwrap();
    }
    assert!(w.promise_to("classmate_b").is_err());
}

#[test]
fn conditional_ties_and_dated_segments_follow_state_and_date() {
    let mut w = world();
    assert!(
        w.active_ties().iter().any(|t| t.a == "classmate_a" && t.b == "classmate_b" && t.kind == Relation::Friends)
    );
    w.change_affinity("classmate_a", 100).unwrap();
    for _ in 0..3 {
        w.remember_experience("classmate_a").unwrap();
    }
    w.promise_to("classmate_a").unwrap();
    assert!(!w.active_ties().iter().any(|t| t.a == "classmate_a" && t.b == "classmate_b"));
    w.state.cast.promise = None;
    w.state.cast.persons.get_mut("classmate_a").unwrap().affection.bond = Some(Bond::A);
    w.state.day = manifest_core::scenario::day_of(&w.defs, [1558, 6, 1]).unwrap();
    assert!(w.active_ties().iter().any(|t| t.a == "classmate_a" && t.b == "classmate_b" && t.kind == Relation::Lovers));
}

#[test]
fn saved_bonds_trim_missing_content_but_reject_out_of_range_and_multiple_lifetime_promises() {
    let w = world();
    let mut state = w.state.clone();
    state.cast.persons.entry("classmate_a".into()).or_default().affection.heart = 101;
    assert!(World::from_snapshot(w.defs.clone(), state).is_err());
    let mut state = w.state.clone();
    state.cast.persons.entry("classmate_a".into()).or_default().affection.bond = Some(Bond::S);
    assert!(World::from_snapshot(w.defs.clone(), state).is_err());
    let mut state = w.state.clone();
    state.cast.ties.push(TieState {
        a: "classmate_a".into(),
        b: "missing".into(),
        kind: Relation::Friends,
        since: [1557, 1, 1],
        open: false,
    });
    let restored = World::from_snapshot(w.defs.clone(), state).unwrap();
    assert!(restored.state.cast.ties.is_empty());
    assert!(matches!(restored.state.log.last().unwrap().kind, manifest_core::log::LogKind::CastReconciled));
}

#[test]
fn a_person_keeps_one_promise_even_after_the_visible_relationship_changes() {
    let mut w = world();
    w.change_tie("classmate_a", "classmate_b", Relation::Promise).unwrap();
    w.change_tie("classmate_a", "classmate_b", Relation::Friends).unwrap();
    let before = w.state.clone();
    assert!(w.change_tie("classmate_a", "sailor", Relation::Promise).is_err());
    assert_eq!(w.state, before);
    w.change_affinity("classmate_a", 100).unwrap();
    for _ in 0..3 {
        w.remember_experience("classmate_a").unwrap();
    }
    assert!(w.promise_to("classmate_a").is_err());
    assert_eq!(World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap().state, w.state);
}

fn copy_data(from: &std::path::Path, to: &std::path::Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let dest = to.join(e.file_name());
        if e.path().is_dir() {
            copy_data(&e.path(), &dest);
        } else {
            std::fs::copy(e.path(), dest).unwrap();
        }
    }
}

#[test]
fn loader_rejects_underage_initial_ties_pure_orientation_changes_and_unknown_conditions() {
    let tmp = tempfile::tempdir().unwrap();
    copy_data(&manifest_data::find_data_dir().unwrap(), tmp.path());
    let path = tmp.path().join("worlds/testbed/cast/companions.toml");
    let original = std::fs::read_to_string(&path).unwrap();
    for (old, new) in [
        ("since = [1558, 6, 1]", "since = [1556, 6, 1]"),
        ("romance = { with = [\"f\"] }", "romance = { with = [\"any\"] }"),
        ("person = \"classmate_a\"", "person = \"missing\""),
        ("to = [1558, 5, 31]", "to = [1552, 5, 31]"),
    ] {
        assert!(original.contains(old));
        std::fs::write(&path, original.replacen(old, new, 1)).unwrap();
        assert!(manifest_data::load_world(tmp.path(), "testbed").is_err(), "{new}");
    }
}

#[test]
fn historical_basis_cannot_load_mixed_original_history_romance() {
    let tmp = tempfile::tempdir().unwrap();
    copy_data(&manifest_data::find_data_dir().unwrap(), tmp.path());
    let path = tmp.path().join("worlds/testbed/cast/companions.toml");
    let original = std::fs::read_to_string(&path).unwrap().replace("born = [1500, 1, 1]", "born = [1540, 1, 1]");
    for kind in ["lovers", "partners"] {
        let extra = format!(
            r#"
[[ties]]
a = "classmate_a"
b = "historian"
kind = "{kind}"
since = [1558, 1, 1]
basis = "historical"
sources = ["占位"]
"#
        );
        std::fs::write(&path, format!("{original}{extra}")).unwrap();
        let error = manifest_data::load_world(tmp.path(), "testbed").unwrap_err().to_string();
        assert!(error.contains("历史人物不开放恋爱互动"), "{error}");
    }
    let mut w = world();
    let d = std::sync::Arc::make_mut(&mut w.defs);
    d.cast.persons.iter_mut().find(|p| p.key == "historian").unwrap().born = [1540, 1, 1];
    d.cast.ties.push(
        serde_json::from_value(serde_json::json!({
            "a":"classmate_a", "b":"historian", "kind":"lovers", "since":[1557,1,1],
            "basis":"historical", "sources":["占位"]
        }))
        .unwrap(),
    );
    assert!(!w.active_ties().iter().any(|t| t.a == "classmate_a" && t.b == "historian"));
}
