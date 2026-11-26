//! 世界属性表：经典回退、动态顺序、分组开局及作者错误的定位。
use manifest_core::captain::{AttrHook, Birthday, background_attrs};
use manifest_core::ids::{OwnerId, ScenarioId};
use manifest_core::{Command, World};
use std::path::{Path, PathBuf};
fn data() -> PathBuf {
    manifest_data::find_data_dir().unwrap()
}
fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let dest = to.join(e.file_name());
        if e.path().is_dir() {
            copy(&e.path(), &dest);
        } else {
            std::fs::copy(e.path(), dest).unwrap();
        }
    }
}
fn corrupt(file: &str, from: &str, to: &str, expected: &[&str]) {
    let tmp = tempfile::tempdir().unwrap();
    copy(&data(), tmp.path());
    let file = tmp.path().join("worlds/testbed").join(file);
    let s = std::fs::read_to_string(&file).unwrap();
    assert!(s.contains(from));
    std::fs::write(file, s.replacen(from, to, 1)).unwrap();
    let err = match manifest_data::load_world(tmp.path(), "testbed") {
        Ok(_) => panic!("应拒绝 {from} → {to}"),
        Err(e) => e.to_string(),
    };
    for word in expected {
        assert!(err.contains(word), "{word}: {err}");
    }
}
#[test]
fn classic_fallback_definitions_and_closed_hooks() {
    let d = manifest_data::load(&data()).unwrap();
    let c = &d.captain;
    assert!(c.legacy);
    assert_eq!(c.groups.len(), 1);
    assert_eq!(c.groups[0].free, 5);
    assert_eq!(c.groups[0].range, [0, 10]);
    assert_eq!(c.attributes.len(), 6);
    assert_eq!(c.roles.len(), 5);
    assert_eq!(c.abilities.len(), 4);
    assert!(c.ratings.is_empty());
    assert_eq!(c.attributes[0].hooks[0].hook, AttrHook::FlagshipSpeed);
    assert_eq!(c.attributes[0].hooks[0].per_point, 100);
    for h in AttrHook::ALL {
        assert_eq!(AttrHook::parse(h.key()), Some(*h));
        assert!(d.rules.attributes.cap(*h) > 0);
    }
    assert_eq!(d.meta.hash, "76f354cdd43e6ac99e3f661ed862f7c385b901e73d39df130b420c8284a2be35");
}
#[test]
fn ten_attributes_create_with_separate_group_budgets_and_ratings() {
    let d = manifest_data::load_world(&data(), "testbed").unwrap();
    let c = &d.captain;
    assert_eq!((c.attributes.len(), c.groups.len(), c.ratings.len(), c.roles.len()), (10, 3, 2, 2));
    assert_eq!(c.attribute_index("numeracy"), Some(7));
    assert_eq!(c.check_index("mariner"), Some(10));
    assert!(c.attributes[9].hidden);
    assert_eq!(d.rules.attributes.cap(AttrHook::FlagshipSpeed), 900);
    let mut w = World::new(d.clone(), ScenarioId(0), 7).unwrap();
    let birthday = Birthday { year: d.rules.world.start_year - 18, month: 1, day: 31 };
    let alloc = vec![1, 1, 1, 1, 1, 1, 1, 1, 0, 0];
    let make = |alloc: Vec<i64>| Command::CreateCaptain {
        owner: OwnerId::Player,
        birthday,
        answers: vec!["library".into()],
        alloc,
        genius: None,
    };
    // 总点数一样，但挪用了其他组的点数，也必须拒绝且不留下半成品。
    let mut bad = alloc.clone();
    bad[0] -= 1;
    bad[3] += 1;
    assert!(make(bad).apply(&mut w).is_err());
    assert!(w.captain_profile(OwnerId::Player).is_none());
    let mut huge = alloc.clone();
    huge[0] = i64::MAX;
    assert!(make(huge).apply(&mut w).is_err());
    make(alloc).apply(&mut w).unwrap();
    let p = w.captain_profile(OwnerId::Player).unwrap();
    assert_eq!(p.attrs, vec![3, 2, 2, 2, 2, 2, 2, 3, 50, 50]);
    assert_eq!(c.check_value(&p.attrs, 10), 23);
    assert_eq!(c.check_value(&p.attrs, 11), 62);
    assert_eq!(background_attrs(c, &[c.option("library").unwrap()], None), vec![2, 1, 1, 1, 1, 1, 1, 2, 50, 50]);
}
#[test]
fn unknown_hook_is_rejected() {
    corrupt("captain.toml", "hook = \"study_xp\"", "hook = \"invented\"", &["captain.toml", "wit", "未知钩子"]);
}
#[test]
fn coefficients_and_global_caps_are_bounded() {
    corrupt("captain.toml", "per_point = 100", "per_point = 10001", &["wit", "系数"]);
    corrupt("captain.toml", "max = 6", "max = 7", &["navigation", "全局上限"]);
    corrupt("rules.toml", "flagship_speed = 900", "flagship_speed = 1001", &["rules.toml", "全局上限"]);
    corrupt("rules.toml", "flagship_speed = 900", "not_a_hook = 900", &["rules.toml", "未知钩子"]);
}
#[test]
fn duplicate_attributes_are_rejected() {
    corrupt("captain.toml", "key = \"endurance\"", "key = \"wit\"", &["captain.toml", "key 重复：wit"]);
}
#[test]
fn invalid_weights_and_groups_are_rejected() {
    corrupt("captain.toml", "navigation = 4", "navigation = -1", &["mariner", "权重"]);
    corrupt("captain.toml", "navigation = 4", "missing_attr = 4", &["mariner", "未知属性"]);
    corrupt("captain.toml", "group = \"aptitude\"", "group = \"missing\"", &["wit", "组不存在"]);
    corrupt("captain.toml", "free = 3", "free = 1000", &["groups[aptitude]", "放不下"]);
}
#[test]
fn roles_require_known_abilities_and_unique_slots() {
    corrupt("captain.toml", "ability = \"navigation\"", "ability = \"missing\"", &["navigator", "未知能力"]);
    corrupt("captain.toml", "key = \"quartermaster\"", "key = \"navigator\"", &["captain.toml", "key 重复：navigator"]);
}
