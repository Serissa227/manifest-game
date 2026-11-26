//! 养成占位数据的封闭字段、引用、日期与显示覆盖。
use manifest_core::{OwnerId, ScenarioId, World};
fn copy(from: &std::path::Path, to: &std::path::Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let dest = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy(&entry.path(), &dest)
        } else {
            std::fs::copy(entry.path(), dest).unwrap();
        }
    }
}
#[test]
fn testbed_family_starts_without_a_fleet_and_locale_preserves_definitions() {
    let dir = manifest_data::find_data_dir().unwrap();
    let d = manifest_data::load_world(&dir, "testbed").unwrap();
    // testbed 替换了港口等整表，却有意保留经典英文作为回退。完整语言断言使用
    // 英文齐备的继承夹具，养成文件和译文直接复制实际样例，不过滤任何语言错误。
    let tmp = tempfile::tempdir().unwrap();
    copy(&dir, tmp.path());
    let base = manifest_data::load_world(tmp.path(), "classic").unwrap();
    let fixture = tmp.path().join("worlds/upbringing_locale");
    std::fs::create_dir_all(&fixture).unwrap();
    std::fs::write(
        fixture.join("world.toml"),
        "key = 'upbringing_locale'\nname = '占位'\ninherit = 'classic'\nmap = 'classic'\n[tables]\nupbringing = ['upbringing/common.toml']\n",
    ).unwrap();
    std::fs::create_dir_all(fixture.join("upbringing")).unwrap();
    std::fs::copy(dir.join("worlds/testbed/upbringing/common.toml"), fixture.join("upbringing/common.toml")).unwrap();
    std::fs::create_dir_all(fixture.join("locales/en/upbringing")).unwrap();
    std::fs::copy(
        dir.join("worlds/testbed/locales/en/upbringing/common.toml"),
        fixture.join("locales/en/upbringing/common.toml"),
    )
    .unwrap();
    let file = fixture.join("upbringing/common.toml");
    let content = std::fs::read_to_string(&file)
        .unwrap()
        .replace("scenario = \"upbringing\"", &format!("scenario = {:?}", base.scenarios[0].key))
        .replace("test_west", &base.locations[base.scenarios[0].start.idx()].key)
        .replace("events = [\"upbringing_note\"]", "events = []");
    let mut content: toml::Value = toml::from_str(&content).unwrap();
    for f in content["families"].as_array_mut().unwrap() {
        f.as_table_mut().unwrap().remove("companions");
        for stage in f["stages"].as_array_mut().unwrap() {
            for key in ["academy", "entry_flag", "entry_event"] {
                stage.as_table_mut().unwrap().remove(key);
            }
        }
    }
    std::fs::write(file, toml::to_string(&content).unwrap()).unwrap();
    let locale_defs = manifest_data::load_world(tmp.path(), "upbringing_locale").unwrap();
    let effective = manifest_data::resolve_world(tmp.path(), "upbringing_locale").unwrap();
    let ai = manifest_data::ai_content::load_world_ai_content(&effective).unwrap();
    let (english, issues) = manifest_data::locale::load_world_locale_lenient(
        &effective,
        manifest_data::locale::Locale::En,
        &locale_defs,
        &ai,
    );
    assert!(issues.is_empty(), "{issues:?}");
    println!("英文覆盖缺项 {} 条：{:?}", english.missing.len(), english.missing);
    assert_eq!(english.defs.upbringing.family("test_family").unwrap().name, "Placeholder family");
    assert_eq!(english.defs.upbringing.family("test_family").unwrap().stages[1].name, "Academy");
    assert_eq!(english.defs.upbringing.activity("rest").unwrap().name, "Rest");
    assert_eq!(english.defs.meta.hash, locale_defs.meta.hash);
    let i = d.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
    let w = World::new(d, ScenarioId::from_idx(i), 42).unwrap();
    assert_eq!(w.fleets_of(OwnerId::Player).count(), 0);
    assert_eq!(w.state.upbringing.as_ref().unwrap().family, "test_family");
    assert_eq!(w.state.protagonist.as_ref().unwrap().age_on(w.cast_date()), Some(12));
    assert!(w.upbringing_waiting());
}
#[test]
fn loader_rejects_unknown_activity_fields_references_and_invalid_stage_dates() {
    let tmp = tempfile::tempdir().unwrap();
    copy(&manifest_data::find_data_dir().unwrap(), tmp.path());
    let file = tmp.path().join("worlds/testbed/upbringing/common.toml");
    let original = std::fs::read_to_string(&file).unwrap();
    for (from, to) in [
        ("key = \"rest\"", "key = \"rest\"\nunknown = 1"),
        ("kind = \"rest\"", "kind = \"typo\""),
        ("home = \"test_west\"", "home = \"missing\""),
        ("scenario = \"upbringing\"", "scenario = \"missing\""),
        ("[1554, 1, 1]", "[1554, 2, 31]"),
        ("events = [\"upbringing_note\"]", "events = [\"missing\"]"),
    ] {
        assert!(original.contains(from));
        std::fs::write(&file, original.replacen(from, to, 1)).unwrap();
        assert!(manifest_data::load_world(tmp.path(), "testbed").is_err(), "{to}");
    }
}
