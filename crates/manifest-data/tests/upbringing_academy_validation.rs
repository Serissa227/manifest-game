//! 学院的引用、校历、课程唯一性、探索图及学院效果必须在加载时拒绝坏数据。
use std::path::Path;
fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let dest = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy(&entry.path(), &dest);
        } else {
            std::fs::copy(entry.path(), dest).unwrap();
        }
    }
}
#[test]
fn all_academy_references_graph_boundaries_and_curriculum_collisions_are_rejected() {
    let tmp = tempfile::tempdir().unwrap();
    copy(&manifest_data::find_data_dir().unwrap(), tmp.path());
    let path = tmp.path().join("worlds/testbed/upbringing/academy.toml");
    let original = std::fs::read_to_string(&path).unwrap();
    assert!(manifest_data::load_world(tmp.path(), "testbed").is_ok());
    for (from, to) in [
        ("at = \"test_west\"", "at = \"missing_place\""),
        ("mentor = \"mentor\"", "missing_person = \"mentor\""),
        ("lesson_mentor = \"mentor\"", "lesson_mentor = \"missing_person\""),
        ("training_ship = \"swallow\"", "training_ship = \"missing_ship\""),
        ("culture = \"test\"", "culture = \"missing_culture\""),
        ("date = [1554, 1, 1]", "date = [1554, 2, 31]"),
        ("cultures = [\"test\"]", "cultures = [\"missing_culture\"]"),
        ("tools = [\"ribbon\"]", "tools = [\"missing_item\"]"),
        ("tools = [\"ribbon\"]", "companion_skills = [\"missing_skill\"]"),
        ("rewards = { wit = 5 }", "rewards = { missing_attr = 5 }"),
        ("danger = 0", "danger = 10001"),
        ("links = [\"path_1\"]", "links = [\"missing_node\"]"),
        ("links = [\"path_1\"]", "links = []"),
        ("starts = [\"path_0\"]", "starts = [\"missing_node\"]"),
        (
            "calendar = [",
            "curriculum = [{ key = \"rest\", name = \"占位\", description = \"占位。\", kind = \"lesson\", scene = \"school\" }]\ncalendar = [",
        ),
    ] {
        assert!(original.contains(from), "{from}");
        std::fs::write(&path, original.replacen(from, to, 1)).unwrap();
        assert!(manifest_data::load_world(tmp.path(), "testbed").is_err(), "{from} -> {to}");
    }
    std::fs::write(&path, original).unwrap();
    let common = tmp.path().join("worlds/testbed/upbringing/common.toml");
    let original = std::fs::read_to_string(&common).unwrap();
    std::fs::write(&common, original.replace("academy = \"test_academy\"", "academy = \"missing_academy\"")).unwrap();
    assert!(manifest_data::load_world(tmp.path(), "testbed").is_err());
    std::fs::write(&common, original).unwrap();
    let story = tmp.path().join("worlds/testbed/stories/academy_entry.toml");
    let original = std::fs::read_to_string(&story).unwrap();
    let mut data: toml::Value = toml::from_str(&original).unwrap();
    data["tracks"][0]["academy"] = toml::Value::Boolean(false);
    data["tracks"][0]["chapters"][0]["choices"][0]["effects"] = toml::Value::Array(vec![
        toml::from_str::<toml::Value>("kind = 'relation'\nperson = 'classmate_a'\nrelation = 'lovers'").unwrap(),
    ]);
    std::fs::write(story, toml::to_string(&data).unwrap()).unwrap();
    assert!(manifest_data::load_world(tmp.path(), "testbed").is_err(), "入学入口隐含学院语境，漏写标志也拒绝越界效果");
}
#[test]
fn tracks_started_by_academy_lines_after_graduation_leave_the_academy_context() {
    // 学院线在结业时开启的重逢轨道，章节都在结业日之后，可以有成年恋人效果；只要有一章早于结业日，仍按学院语境拒绝。
    let tmp = tempfile::tempdir().unwrap();
    copy(&manifest_data::find_data_dir().unwrap(), tmp.path());
    let story = tmp.path().join("worlds/testbed/stories/academy_entry.toml");
    let original = std::fs::read_to_string(&story).unwrap();
    let reunion = r#"
key = "later_reunion"
name = "重逢"
kind = "main"
start = "meet"
auto = false
[[chapters]]
key = "meet"
title = "重逢"
text = "占位。"
window = [FROM, [1561, 9, 30]]
[[chapters.choices]]
key = "stay"
text = "留下"
next = "done"
effects = [{ kind = "relation", person = "classmate_a", relation = "lovers" }]
[chapters.default]
next = "done"
effects = []
"#;
    let with_reunion = |from: &str| {
        let mut data: toml::Value = toml::from_str(&original).unwrap();
        data["tracks"][0]["chapters"][0]["choices"][0]["effects"]
            .as_array_mut()
            .unwrap()
            .push(toml::from_str::<toml::Value>("kind = 'start_track'\ntrack = 'later_reunion'").unwrap());
        let track: toml::Value = toml::from_str(&reunion.replace("FROM", from)).unwrap();
        data["tracks"].as_array_mut().unwrap().push(track);
        std::fs::write(&story, toml::to_string(&data).unwrap()).unwrap();
    };
    with_reunion("[1561, 6, 1]");
    let loaded = manifest_data::load_world(tmp.path(), "testbed");
    assert!(loaded.is_ok(), "结业之后的重逢不属于学院语境：{:?}", loaded.err());
    with_reunion("[1556, 6, 1]");
    let err = manifest_data::load_world(tmp.path(), "testbed").expect_err("早于结业日的章节仍按学院语境拒绝");
    assert!(format!("{err:?}").contains("学院"), "{err:?}");
}
#[test]
fn nested_academy_places_calendar_and_excursions_are_translated_without_mechanics_changes() {
    let root = manifest_data::find_data_dir().unwrap();
    let d = manifest_data::load_world(&root, "testbed").unwrap();
    let effective = manifest_data::resolve_world(&root, "testbed").unwrap();
    let ai = manifest_data::ai_content::load_world_ai_content(&effective).unwrap();
    let (en, issues) = manifest_data::locale::load_world_locale_lenient(&effective, manifest_data::Locale::En, &d, &ai);
    assert!(issues.iter().all(|i| !i.file.contains("upbringing")), "{issues:?}");
    assert!(en.missing.iter().all(|i| !i.file.contains("upbringing")), "{:?}", en.missing);
    assert_eq!(en.defs.upbringing.academies[0].name, "Placeholder academy");
    assert_eq!(en.defs.upbringing.academies[0].places[0].name, "Placeholder");
    assert_eq!(en.defs.upbringing.excursions[0].nodes[0].name, "Placeholder");
    assert_eq!(en.defs.upbringing.excursions[0].nodes[0].rewards, d.upbringing.excursions[0].nodes[0].rewards);
    assert_eq!(en.defs.meta.hash, d.meta.hash);
}
