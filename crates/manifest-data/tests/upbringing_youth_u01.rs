//! U01：称呼字段缺省兼容、人物引用和 Unicode 字数边界。
use std::{collections::BTreeSet, sync::OnceLock};
fn defs() -> &'static manifest_core::StaticData {
    static DATA: OnceLock<manifest_core::StaticData> = OnceLock::new();
    DATA.get_or_init(|| {
        (*manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
    })
}

#[test]
fn omitted_youth_fields_default_empty_for_every_family_identity() {
    let d = defs();
    assert_eq!(d.upbringing.families.len(), 21);
    for original in &d.upbringing.families {
        let family: manifest_core::upbringing::FamilyDef = serde_json::from_value(serde_json::json!({
            "key":original.key,"name":original.name,"scenario":original.scenario,
            "home":original.home,"born":original.born,"gender":original.gender,
            "stages":[],"graduation":original.graduation,
        }))
        .unwrap();
        assert!(family.youth_name.is_empty() && family.call_you.is_empty());
    }
}

#[test]
fn youth_names_accept_twenty_characters_and_reject_unknown_people_or_long_text() {
    let mut d = defs().clone();
    let i = d.upbringing.families.iter().position(|f| f.key == "mio").unwrap();
    let errors = |d: &manifest_core::StaticData| {
        manifest_core::upbringing::validation::validate(d)
            .into_iter()
            .filter(|e| e.contains("少年称呼"))
            .collect::<Vec<_>>()
    };
    d.upbringing.families[i].youth_name = "字".repeat(20);
    d.upbringing.families[i].call_you.insert("ase".into(), "字".repeat(20));
    assert!(errors(&d).is_empty());
    d.upbringing.families[i].youth_name.push('字');
    assert_eq!(errors(&d).len(), 1);
    d.upbringing.families[i].youth_name.clear();
    d.upbringing.families[i].call_you.insert("ase".into(), "字".repeat(21));
    assert_eq!(errors(&d).len(), 1);
    d.upbringing.families[i].call_you.insert("ase".into(), String::new());
    assert!(errors(&d).is_empty());
    d.upbringing.families[i].call_you.insert("missing_person_u01".into(), String::new());
    assert_eq!(errors(&d).len(), 1);
    d.upbringing.families[i].call_you.remove("missing_person_u01");
    d.upbringing.families[i].youth_name = "\n".into();
    assert_eq!(errors(&d).len(), 1);
}

#[test]
fn copy_handoff_covers_every_family_and_all_known_family_and_academy_contacts() {
    let root = manifest_data::find_data_dir().unwrap();
    let handoff: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(root.parent().unwrap().join("copy-needed-u01.json")).unwrap())
            .unwrap();
    let families = handoff["families"].as_array().unwrap();
    assert_eq!(families.len(), 21);
    let d = defs();
    let mut total = 0;
    // 交接单里是已审成稿：非空、至多 20 字、无控制字符；自创出身的 youth_name 有意留空（回退玩家起的名字）。
    let written = |value: &serde_json::Value| {
        let s = value.as_str().unwrap();
        !s.trim().is_empty() && s.trim() == s && s.chars().count() <= 20 && !s.chars().any(char::is_control)
    };
    for f in &d.upbringing.families {
        let row = families.iter().find(|r| r["family_key"] == f.key).unwrap();
        if f.templates.is_empty() {
            assert!(written(&row["youth_name"]), "{}", f.key);
        } else {
            assert_eq!(row["youth_name"], "", "{}", f.key);
        }
        // 仓库数据要么还没填，要么与交接单一致。
        assert!(f.youth_name.is_empty() || row["youth_name"] == f.youth_name.as_str(), "{}", f.key);
        let calls = row["call_you"].as_array().unwrap();
        let mut expected = f.companions.keys().cloned().collect::<BTreeSet<_>>();
        expected.extend(f.mentor_roles.values().cloned());
        for academy in f.stages.iter().filter_map(|s| s.academy.as_ref()).filter_map(|k| d.upbringing.academy(k)) {
            expected.extend(academy.companions.keys().cloned());
            expected.extend(academy.mentor_roles.values().cloned());
        }
        // 共用学院名册包含具名主角本人；文案交接只列别人对主角的称呼。
        expected.retain(|key| !f.protagonists.contains(key));
        let got = calls.iter().map(|c| c["person_key"].as_str().unwrap().to_string()).collect::<BTreeSet<_>>();
        assert_eq!(got, expected, "{}", f.key);
        assert_eq!(got.len(), calls.len());
        for c in calls {
            let p = d.cast.person(c["person_key"].as_str().unwrap()).unwrap();
            assert_eq!(c["person_name"], p.name);
            assert!(written(&c["value"]), "{}:{}", f.key, p.key);
            assert!(
                f.call_you.get(&p.key).is_none_or(|v| v.is_empty() || c["value"] == v.as_str()),
                "{}:{}",
                f.key,
                p.key
            );
            assert!(!c["relationship"].as_str().unwrap().is_empty());
        }
        total += calls.len();
    }
    assert_eq!(handoff["counts"]["call_you"], total);
    assert_eq!(handoff["counts"]["youth_name"], 21);
}

fn with_youth_fields(original: &str) -> String {
    let mut source: toml::Table = original.parse().unwrap();
    let family = source
        .get_mut("families")
        .unwrap()
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|f| f.get("key").and_then(toml::Value::as_str) == Some("mio"))
        .unwrap()
        .as_table_mut()
        .unwrap();
    family.insert("youth_name".into(), toml::Value::String("base_youth".into()));
    family.insert(
        "call_you".into(),
        toml::Value::Table(toml::Table::from_iter([("ase".into(), toml::Value::String("base_call".into()))])),
    );
    toml::to_string(&source).unwrap()
}

fn with_english_youth_fields(original_english: &str) -> toml::Table {
    let mut english: toml::Table = original_english.parse().unwrap();
    for (table, key) in [("family_youth_names", "mio"), ("family_call_you", "mio:ase")] {
        english.insert(
            table.into(),
            toml::Value::Table(toml::Table::from_iter([(
                key.into(),
                toml::Value::Table(toml::Table::from_iter([("name".into(), toml::Value::String("é".repeat(20)))])),
            )])),
        );
    }
    english
}

#[test]
fn native_youth_translation_is_complete_bounded_and_cannot_add_people_or_growth() {
    let root = manifest_data::find_data_dir().unwrap();
    let world = manifest_data::resolve_world(&root, "terra16").unwrap();
    let file = "upbringing/families/mio.toml";
    let original = world.read(file).unwrap();
    let original_english = world.read(&format!("locales/en/{file}")).unwrap();
    let before = manifest_data::worlds::validate_draft_translation(file, &original, &original_english).unwrap();
    let source = with_youth_fields(&original);
    let english = with_english_youth_fields(&original_english);
    let check = |value: &toml::Table| {
        manifest_data::worlds::validate_draft_translation(file, &source, &toml::to_string(value).unwrap())
    };
    // 合成字段整份替换澪的真实少年称呼（youth_name 1 条 + call_you 各条），再加上合成的 2 条。
    let mio = defs().upbringing.family("mio").unwrap();
    let existing = usize::from(!mio.youth_name.trim().is_empty())
        + mio.call_you.values().filter(|name| !name.trim().is_empty()).count();
    assert_eq!(check(&english).unwrap(), before - existing + 2);
    let mut missing = english.clone();
    missing.remove("family_youth_names");
    assert!(check(&missing).is_err());
    for (table, key) in [("family_youth_names", "mio"), ("family_call_you", "mio:ase")] {
        for value in ["é".repeat(21), "a\nb".into()] {
            let mut invalid = english.clone();
            invalid
                .get_mut(table)
                .unwrap()
                .get_mut(key)
                .unwrap()
                .as_table_mut()
                .unwrap()
                .insert("name".into(), toml::Value::String(value));
            assert!(check(&invalid).is_err(), "{table}/{key}");
        }
    }
    let mut unknown = english.clone();
    unknown.get_mut("family_call_you").unwrap().as_table_mut().unwrap().insert(
        "mio:unknown_person_u01".into(),
        toml::Value::Table(toml::Table::from_iter([("name".into(), toml::Value::String("value".into()))])),
    );
    assert!(check(&unknown).is_err());
    let mut gameplay = english.clone();
    gameplay
        .get_mut("families")
        .unwrap()
        .get_mut("mio")
        .unwrap()
        .as_table_mut()
        .unwrap()
        .insert("initial_points".into(), toml::Value::Integer(9));
    assert!(check(&gameplay).is_err());
}

#[test]
fn world_locale_loader_applies_youth_text_without_changing_identity_points_or_hash() {
    fn copy_tree(source: &std::path::Path, target: &std::path::Path) {
        std::fs::create_dir_all(target).unwrap();
        for entry in std::fs::read_dir(source).unwrap() {
            let entry = entry.unwrap();
            let destination = target.join(entry.file_name());
            if entry.path().is_dir() {
                copy_tree(&entry.path(), &destination);
            } else {
                std::fs::copy(entry.path(), destination).unwrap();
            }
        }
    }
    let root = manifest_data::find_data_dir().unwrap();
    let temp = tempfile::tempdir().unwrap();
    copy_tree(&root, temp.path());
    let family_path = temp.path().join("worlds/terra16/upbringing/families/mio.toml");
    let english_path = temp.path().join("worlds/terra16/locales/en/upbringing/families/mio.toml");
    std::fs::write(&family_path, with_youth_fields(&std::fs::read_to_string(&family_path).unwrap())).unwrap();
    let translated = with_english_youth_fields(&std::fs::read_to_string(&english_path).unwrap());
    std::fs::write(&english_path, toml::to_string(&translated).unwrap()).unwrap();
    let defs = manifest_data::load_world(temp.path(), "terra16").unwrap();
    let world = manifest_data::resolve_world(temp.path(), "terra16").unwrap();
    let classic = manifest_data::resolve_world(temp.path(), "classic").unwrap();
    let ai = manifest_data::load_ai_content(temp.path()).unwrap();
    let (english, issues) = manifest_data::locale::load_world_locale_with_common_texts_lenient(
        &world,
        &classic,
        manifest_data::Locale::En,
        &defs,
        &ai,
    );
    let missing = issues.iter().filter(|i| i.message == "已有英文覆盖不完整").count();
    println!("英文覆盖缺项 {missing} 条");
    assert!(issues.iter().all(|i| i.message == "已有英文覆盖不完整"), "{issues:?}");
    let before = defs.upbringing.family("mio").unwrap();
    let after = english.defs.upbringing.family("mio").unwrap();
    assert_eq!(before.youth_name, "base_youth");
    assert_eq!(before.call_you["ase"], "base_call");
    assert_eq!(after.youth_name, "é".repeat(20));
    assert_eq!(after.call_you["ase"], "é".repeat(20));
    assert_eq!(after.call_you.keys().collect::<Vec<_>>(), before.call_you.keys().collect::<Vec<_>>());
    assert_eq!(after.initial_points, before.initial_points);
    assert_eq!(after.protagonists, before.protagonists);
    assert_eq!(after.templates, before.templates);
    assert_eq!(after.mentor_roles, before.mentor_roles);
    assert_eq!(after.born, before.born);
    assert_eq!(english.defs.meta.hash, defs.meta.hash);
    assert!(
        english
            .missing
            .iter()
            .all(|m| !m.item.starts_with("family_youth_names[") && !m.item.starts_with("family_call_you[")),
        "{:?}",
        english.missing
    );
}
