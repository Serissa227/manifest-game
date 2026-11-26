//! 日期剧本的两种语法、明确起点与开局身份头。

use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        if entry.path().is_dir() {
            copy(&entry.path(), &to.join(entry.file_name()));
        } else {
            std::fs::copy(entry.path(), to.join(entry.file_name())).unwrap();
        }
    }
}

#[test]
fn new_dates_and_identity_headers_reach_kernel_definitions() {
    let temp = tempfile::tempdir().unwrap();
    copy(&root(), temp.path());
    let base = temp.path().join("worlds/testbed");
    std::fs::create_dir_all(base.join("cast")).unwrap();
    std::fs::create_dir_all(base.join("upbringing")).unwrap();
    std::fs::write(
        base.join("cast/protagonists.toml"),
        "[[persons]]\nkey='navigator'\nname='领航员'\nkind='protagonist'\nborn=[1540,6,15]\ngender='f'\n",
    )
    .unwrap();
    std::fs::write(base.join("upbringing/templates.toml"), "[[templates]]\nkey='apprentice'\nborn=[1540,1,1]\n")
        .unwrap();
    let manifest_path = base.join("world.toml");
    let manifest = std::fs::read_to_string(&manifest_path).unwrap();
    std::fs::write(
        manifest_path,
        manifest.replace("\"upbringing/common.toml\"", "\"upbringing/common.toml\", \"upbringing/templates.toml\""),
    )
    .unwrap();
    let path = base.join("scenarios/sandbox.toml");
    let text = std::fs::read_to_string(&path).unwrap()
        .replace("start = \"test_west\"", "start_date=[1553,1,1]\ncontrol_date=[1557,1,1]\nstart_port='test_west'\nprotagonists=['navigator']\ncustom={templates=['apprentice']}\nupbringing=true\ntimeline='main'")
        .replace("kind = \"sandbox\"", "kind = 'story'")
        .replace("ships = [\"swallow\"]", "ships = []")
        .replace("crew = 14", "crew = 0");
    std::fs::write(&path, text).unwrap();
    // 日期/身份正例启用了养成，须提供覆盖 control_date 的家庭与无舰队开局。
    let family_path = base.join("upbringing/common.toml");
    let mut family = std::fs::read_to_string(&family_path).unwrap();
    family.push_str(
        r#"
[[families]]
key = "date_family"
name = "占位"
scenario = "sandbox"
home = "test_west"
born = [1540, 6, 15]
gender = "f"
graduation = [1558, 1, 1]
stages = [{ from = [1553, 1, 1], stage = "home", name = "占位", at = "test_west" }]
"#,
    );
    std::fs::write(family_path, family).unwrap();
    let defs = manifest_data::load_world(temp.path(), "testbed").unwrap();
    let sc = &defs.scenarios[0];
    assert_eq!(sc.start_date, [1553, 1, 1]);
    assert_eq!(sc.control_date, [1557, 1, 1]);
    assert_eq!(sc.start_loc, sc.start);
    assert_eq!(sc.goal.kind, manifest_core::defs::GoalKind::Story);
    assert_eq!(sc.protagonist_defs[0].born, [1540, 6, 15]);
    assert_eq!(sc.template_defs[0].born[0], 1540);
    assert!(sc.upbringing);
    assert_eq!(sc.timeline.as_deref(), Some("main"));
    let hash = defs.meta.hash.clone();
    std::fs::write(base.join("cast/protagonists.toml"), "[[persons]]\nkey='navigator'\nborn=[1541,6,15]\ngender='f'\n")
        .unwrap();
    assert_ne!(manifest_data::load_world(temp.path(), "testbed").unwrap().meta.hash, hash);
}

#[test]
fn ambiguous_missing_and_invalid_dates_are_rejected() {
    let temp = tempfile::tempdir().unwrap();
    copy(&root(), temp.path());
    let path = temp.path().join("worlds/testbed/scenarios/sandbox.toml");
    let original = std::fs::read_to_string(&path).unwrap();
    for fields in [
        "start_date=[1553,1,1]",
        "start_date=[1553,1,1]\nstart_port='test_west'\nstart_loc='test_east'",
        "start_date=[1553,2,29]\nstart_loc='test_west'",
        "start_date=[1553,1,1]\ncontrol_date=[1552,12,31]\nstart_loc='test_west'",
        "control_date=[1557,1,1]\nstart_loc='test_west'",
        "start_date=[1501,1,1]\nstart_loc='test_west'",
        "start=[1553,1,1]\nstart_date=[1554,1,1]\nstart_loc='test_west'",
        "start_date=[1553,1,1]\ncontrol=[1554,1,1]\ncontrol_date=[1555,1,1]\nstart_loc='test_west'",
    ] {
        std::fs::write(&path, original.replace("start = \"test_west\"", fields)).unwrap();
        assert!(manifest_data::load_world(temp.path(), "testbed").is_err(), "{fields}");
    }
}
