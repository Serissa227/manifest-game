//! 数据到命令的完整路径：任意属性/评价检定、品行范围、额外岗位能力。
use manifest_core::captain::Birthday;
use manifest_core::{Command, OwnerId, ScenarioId, World};
use std::path::Path;
fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let target = to.join(e.file_name());
        if e.path().is_dir() {
            copy(&e.path(), &target);
        } else {
            std::fs::copy(e.path(), target).unwrap();
        }
    }
}
fn fixture() -> tempfile::TempDir {
    let t = tempfile::tempdir().unwrap();
    copy(&manifest_data::find_data_dir().unwrap(), t.path());
    let root = t.path().join("worlds/testbed");
    let file = root.join("world.toml");
    let mut settings: toml::Value = toml::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    settings["modules"]["stories"] = toml::Value::Boolean(true);
    settings["tables"]["stories"].as_array_mut().unwrap().push(toml::Value::String("stories/hook_checks.toml".into()));
    std::fs::write(file, toml::to_string(&settings).unwrap()).unwrap();
    let file = root.join("scenarios/sandbox.toml");
    let s = std::fs::read_to_string(&file).unwrap().replace("[goal]", "story = \"hook_checks\"\n[goal]");
    std::fs::write(file, s).unwrap();
    std::fs::create_dir_all(root.join("stories")).unwrap();
    std::fs::write(root.join("stories/hook_checks.toml"),r#"
key = "hook_checks"
name = "学习的选择"
[[chapters]]
key = "first"
title = "船上的讨论"
hint = "在西港讨论海图。"
text = "大家拿出海图，一起研究接下来的航道。"
when = { docked = ["test_west"] }
choices = [
 { text = "用悟性回答。", check = {attr = "wit", base = 10, per = 2}, reply = "有了思路。", fail_reply = "还需学习。", effects = [{kind = "attr", attr = "piety", value = -2}], fail = [{kind = "attr", attr = "piety", value = -2}] },
 { text = "综合航海经验。", check = {attr = "mariner", base = 10, per = 2}, reply = "有了思路。", fail_reply = "还需学习。", effects = [{kind = "attr", attr = "piety", value = -2}], fail = [{kind = "attr", attr = "piety", value = -2}] }
]
"#).unwrap();
    std::fs::write(
        root.join("mates.toml"),
        r#"
[[mates]]
key = "observer"
name = "观测员"
bio = "熟悉天象的航海士。"
home = "test_west"
navigation = 60
trade = 40
combat = 30
management = 50
level = 1
salary = 100
hire_cost = 200
loyalty = 80
abilities = {astronomy = 83}
"#,
    )
    .unwrap();
    t
}
#[test]
fn loaded_story_checks_and_conduct_changes_follow_the_world_table() {
    let tmp = fixture();
    let d = manifest_data::load_world(tmp.path(), "testbed").unwrap_or_else(|e| panic!("{e}"));
    assert_eq!(d.mates[0].abilities["astronomy"], 83);
    let choices = &d.stories.stories[0].chapters[0].choices;
    assert_eq!(choices[0].check.unwrap().attr, d.captain.check_index("wit").unwrap());
    assert_eq!(choices[1].check.unwrap().attr, d.captain.check_index("mariner").unwrap());
    let year = d.rules.world.start_year - 18;
    let mut w = World::new(d, ScenarioId(0), 7).unwrap();
    Command::CreateCaptain {
        owner: OwnerId::Player,
        birthday: Birthday { year, month: 1, day: 31 },
        answers: vec!["library".into()],
        alloc: vec![1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
        genius: None,
    }
    .apply(&mut w)
    .unwrap();
    w.end_day().unwrap();
    assert!(w.state.story.pending.is_some());
    Command::StoryAnswer { owner: OwnerId::Player, choice: 1 }.apply(&mut w).unwrap();
    assert_eq!(w.captain_profile(OwnerId::Player).unwrap().attrs[9], 48);
}
#[test]
fn undeclared_and_out_of_range_extra_abilities_are_rejected() {
    for (from, to) in [("astronomy = 83", "mystery = 83"), ("astronomy = 83", "astronomy = 101")] {
        let tmp = fixture();
        let file = tmp.path().join("worlds/testbed/mates.toml");
        let s = std::fs::read_to_string(&file).unwrap();
        std::fs::write(file, s.replace(from, to)).unwrap();
        let err = match manifest_data::load_world(tmp.path(), "testbed") {
            Ok(_) => panic!("应拒绝非法能力"),
            Err(e) => e.to_string(),
        };
        assert!(err.contains("mates.toml") && err.contains("能力"), "{err}");
    }
}
#[test]
fn invalid_group_numbers_report_errors_instead_of_overflowing() {
    let tmp = fixture();
    let file = tmp.path().join("worlds/testbed/captain.toml");
    let s = std::fs::read_to_string(&file).unwrap();
    std::fs::write(file, s.replacen("start = 1", "start = 9223372036854775807", 1)).unwrap();
    let err = match manifest_data::load_world(tmp.path(), "testbed") {
        Ok(_) => panic!("应拒绝非法组范围"),
        Err(e) => e.to_string(),
    };
    assert!(err.contains("groups[aptitude]") && err.contains("组须满足"), "{err}");
}
