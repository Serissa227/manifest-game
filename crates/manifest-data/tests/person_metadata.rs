//! 人物新增文字的正式英文覆盖、严格 schema 与 survives 的运行语义。
use manifest_core::{ScenarioId, World, cast::PersonDef};
use manifest_data::{Locale, locale::load_world_locale_lenient};
use std::sync::Arc;

#[test]
fn person_overlays_follow_source_files_and_preserve_gameplay() {
    let root = manifest_data::find_data_dir().unwrap();
    let tmp = tempfile::tempdir().unwrap();
    // testbed 继承 classic；有效资源仍来自原目录，只换本测试的覆盖来源。
    let mut world = manifest_data::resolve_world(&root, "testbed").unwrap();
    let mut defs = manifest_data::load_world(&root, "testbed").unwrap();
    let p = Arc::make_mut(&mut defs).cast.persons.iter_mut().find(|p| p.key == "classmate_a").unwrap();
    p.summary = "公开简介".into();
    p.secret = "秘密".into();
    p.after = "后日谈".into();
    p.names = vec![serde_json::from_value(serde_json::json!({"bond":"C","name":"称呼"})).unwrap()];
    p.lines.insert("catchphrase".into(), vec!["一句台词".into()]);
    let source = p.source.clone();
    let ai = manifest_data::ai_content::load_world_ai_content(&world).unwrap();
    // testbed 继承的经典译文会留下既有陈旧键诊断；本次覆盖不得新增诊断。
    let (_, baseline) = load_world_locale_lenient(&world, Locale::En, &defs, &ai);
    let overlay = tmp.path().join("person.toml");
    let english = r#"[persons.classmate_a]
summary="Public summary"
secret="Secret"
after="Afterword"
names=[{rank="C",text="Friend"}]
lines={catchphrase="A line."}
"#;
    std::fs::write(&overlay, english).unwrap();
    world.files.insert(
        format!("locales/en/{source}"),
        manifest_data::worlds::EffectiveFile {
            sources: vec![overlay.clone()],
            mode: manifest_data::worlds::FileMode::Replace,
        },
    );
    let (en, issues) = load_world_locale_lenient(&world, Locale::En, &defs, &ai);
    let details = |list: &[manifest_data::DataIssue]| {
        list.iter().map(|i| (i.file.clone(), i.item.clone(), i.message.clone())).collect::<Vec<_>>()
    };
    assert_eq!(details(&issues), details(&baseline));
    let p = en.defs.cast.person("classmate_a").unwrap();
    assert_eq!((&*p.summary, &*p.secret, &*p.after), ("Public summary", "Secret", "Afterword"));
    assert_eq!(p.names[0].name, "Friend");
    assert_eq!(p.lines["catchphrase"], ["A line."]);
    assert_eq!(p.born, defs.cast.person("classmate_a").unwrap().born);
    std::fs::write(overlay, format!("{english}birthday=[2,3]\n")).unwrap();
    let (_, issues) = load_world_locale_lenient(&world, Locale::En, &defs, &ai);
    assert_eq!(issues.len(), baseline.len() + 1);
    assert!(issues.iter().any(|i| {
        i.file == format!("locales/en/{source}")
            && i.item == "persons[classmate_a]"
            && i.message.starts_with("字段 birthday 不能覆盖")
    }));
}

#[test]
fn survives_alias_restores_life_without_inventing_a_schedule() {
    let mut defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let p:PersonDef=serde_json::from_value(serde_json::json!({
        "key":"survivor","name":"人物","kind":"story","gender":"f","born":[1530,1,1],
        "fate":[{"event":"danger","outcome":"lost","then":"dies"},{"event":"danger","outcome":"rescued","then":"survives"}]
    })).unwrap();
    let d = Arc::make_mut(&mut defs);
    d.cast.persons.push(p);
    d.scenarios[0].start_date = [1553, 1, 1];
    d.scenarios[0].control_date = [1553, 1, 1];
    let mut w = World::new(defs, ScenarioId(0), 42).unwrap();
    assert!(w.person_alive("survivor"));
    w.apply_cast_fate("danger", "lost");
    assert!(!w.person_alive("survivor"));
    w.apply_cast_fate("danger", "rescued");
    assert!(w.person_alive("survivor"));
    assert!(w.state.cast.persons["survivor"].schedule.is_none());
    let before = w.state.clone();
    w.apply_cast_fate("danger", "rescued");
    assert_eq!(w.state, before);
}

#[test]
fn extended_person_fields_still_reject_unknown_names_and_conflicting_aliases() {
    let raw = serde_json::json!({"key":"person","name":"人物","kind":"story","gender":"f","born":[1540,1,1]});
    let mut typo = raw.clone();
    typo["summry"] = serde_json::json!("简介");
    assert!(serde_json::from_value::<PersonDef>(typo).is_err());
    let mut duplicate = raw;
    duplicate["names"] = serde_json::json!([{"rank":"C","bond":"S","text":"称呼"}]);
    assert!(serde_json::from_value::<PersonDef>(duplicate).is_err());
    for field in ["tie_metadata", "deferred_ties", "diagnostics"] {
        let injected = serde_json::json!({field:[]});
        assert!(serde_json::from_value::<manifest_core::cast::CastDefs>(injected).is_err(), "{field}");
    }
}
