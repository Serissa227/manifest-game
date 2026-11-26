//! 人物目录与生命周期的真实世界样例。
use manifest_core::{cast::*, *};

fn world() -> World {
    let mut defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let scenario = &mut std::sync::Arc::make_mut(&mut defs).scenarios[0];
    scenario.start_date = [1553, 1, 1];
    scenario.control_date = [1553, 1, 1];
    World::new(defs, ScenarioId(0), 42).unwrap()
}

#[test]
fn schedules_are_pure_seasonal_and_death_and_rescue_override_them() {
    let mut w = world();
    // 10 位测试人物 + 3 位拍卖竞拍人（B5 的 persons.toml，B10 起按正式人物表读）
    assert_eq!(w.defs.cast.persons.len(), 13);
    let before = w.state.clone();
    for _ in 0..20 {
        assert_eq!(w.person_place("visitor").unwrap().loc, LocId(1));
        assert!(w.person_here("mentor"));
        assert!(!w.person_here("distant"));
    }
    assert_eq!(w.state, before);
    let p = w.defs.cast.person("visitor").unwrap();
    assert_eq!(schedule::schedule_on(p, None, [1553, 4, 1], 0).unwrap().at, "test_west");
    w.apply_cast_fate("port_fire", "lost");
    assert!(!w.person_alive("merchant"));
    assert!(w.person_place("merchant").is_none());
    w.apply_cast_fate("port_fire", "rescued");
    assert!(w.person_alive("merchant"));
    assert_eq!(w.person_place("merchant").unwrap().loc, LocId(1));
    let saved = serde_json::to_vec(&w.state).unwrap();
    w.apply_cast_fate("port_fire", "rescued");
    assert_eq!(serde_json::to_vec(&w.state).unwrap(), saved);
    let copy = World::from_snapshot(w.defs.clone(), serde_json::from_slice(&saved).unwrap()).unwrap();
    assert_eq!(copy.state, w.state);
}

#[test]
fn identity_classification_portraits_and_fleetless_presence() {
    let mut w = world();
    assert_eq!(w.defs.cast.person("historian").unwrap().kind, PersonKind::Historical);
    let p = w.defs.cast.person("classmate_a").unwrap();
    assert_eq!(p.age_on([1557, 12, 31]), Some(17));
    assert_eq!(p.portrait([1558, 1, 1]), Some("test_adult"));
    w.state.fleets.retain(|_, f| f.owner != OwnerId::Player);
    assert!(w.person_here("mentor"));
    w.state.cast.place = Some(CastPlace { loc: LocId(0), venue: "court".into() });
    assert!(!w.person_here("mentor"));
}

#[test]
fn unknown_snapshot_person_is_trimmed_and_classic_omits_cast() {
    let mut w = world();
    w.state.cast.persons.insert("missing".into(), PersonState::default());
    let restored = World::from_snapshot(w.defs.clone(), w.state).unwrap();
    assert!(!restored.state.cast.persons.contains_key("missing"));
    assert!(matches!(restored.state.log.last().unwrap().kind, manifest_core::log::LogKind::CastReconciled));
    let defs = manifest_data::load(&manifest_data::find_data_dir().unwrap()).unwrap();
    assert!(defs.cast.persons.is_empty());
    let classic = World::new(defs, ScenarioId(0), 42).unwrap();
    assert!(serde_json::to_value(&classic.state).unwrap().get("cast").is_none());
}

fn copy_data(from: &std::path::Path, to: &std::path::Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let dest = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_data(&entry.path(), &dest);
        } else {
            std::fs::copy(entry.path(), dest).unwrap();
        }
    }
}

#[test]
fn cast_display_translation_preserves_identity_and_gameplay() {
    let tmp = tempfile::tempdir().unwrap();
    copy_data(&manifest_data::find_data_dir().unwrap(), tmp.path());
    let w = world();
    std::fs::write(tmp.path().join("locales/en/cast.toml"), "[persons.classmate_a]\nname='Lan'\nrole='Classmate'\n")
        .unwrap();
    let ai = manifest_data::load_ai_content(tmp.path()).unwrap();
    let mut defs = manifest_data::load(tmp.path()).unwrap();
    std::sync::Arc::make_mut(&mut defs).cast = w.defs.cast.clone();
    std::sync::Arc::make_mut(&mut defs).items = w.defs.items.clone();
    std::fs::write(
        tmp.path().join("locales/en/items.toml"),
        "[items.ring]\nname='Ring'\n[book_categories.voyage]\nname='Voyage'\n",
    )
    .unwrap();
    let locale = manifest_data::load_locale(tmp.path(), manifest_data::Locale::En, &defs, &ai).unwrap();
    assert_eq!(locale.defs.cast.person("classmate_a").unwrap().name, "Lan");
    assert_eq!(locale.defs.cast.person("classmate_a").unwrap().born, [1540, 1, 1]);
    assert_eq!(w.defs.cast.person("classmate_a").unwrap().name, "小岚");
    assert_eq!(locale.defs.items.item("ring").unwrap().name, "Ring");
    assert_eq!(locale.defs.items.item("ring").unwrap().price, w.defs.items.item("ring").unwrap().price);
}

#[test]
fn loader_rejects_invalid_schedule_reference_dates_duplicate_and_historical_romance() {
    let tmp = tempfile::tempdir().unwrap();
    copy_data(&manifest_data::find_data_dir().unwrap(), tmp.path());
    let path = tmp.path().join("worlds/testbed/cast/companions.toml");
    let original = std::fs::read_to_string(&path).unwrap();
    for (old, new) in [
        ("at = \"test_west\"", "at = \"missing\""),
        ("born = [1540, 1, 1]", "born = [1540, 2, 29]"),
        ("key = \"classmate_b\"", "key = \"classmate_a\""),
        ("introducer = \"mentor\"", "introducer = \"missing\""),
        ("kind = \"historical\"", "kind = \"historical\"\nromance = { with = [\"any\"] }"),
        ("seasons = [0, 1]", "seasons = [0, 4]"),
    ] {
        assert!(original.contains(old));
        std::fs::write(&path, original.replacen(old, new, 1)).unwrap();
        assert!(manifest_data::load_world(tmp.path(), "testbed").is_err(), "{new}");
    }
}
