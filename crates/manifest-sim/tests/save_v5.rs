//! v5 外壳、世界隔离与全部持久数字 ID 的追加兼容。

mod common;

use manifest_core::{CoreError, SaveFile, ScenarioId};
use manifest_sim::{GameSession, storage};

#[test]
fn v5_world_and_key_tables_roundtrip_without_changing_snapshot() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    for key in ["classic", "testbed"] {
        let defs = manifest_data::load_world(&root, key).unwrap();
        let session = GameSession::new(defs.clone(), ScenarioId(0), 7).unwrap();
        let save = session.to_save();
        assert_eq!(save.version, 5);
        assert_eq!(save.world, key);
        assert_eq!(
            save.data.keys.attributes,
            defs.captain.attributes.iter().map(|a| a.key.clone()).collect::<Vec<_>>()
        );
        assert_eq!(save.data.keys.scenarios, defs.scenarios.iter().map(|s| s.key.clone()).collect::<Vec<_>>());
        assert_eq!(save.data.keys.refits, defs.refits.iter().map(|r| r.key.clone()).collect::<Vec<_>>());
        assert_eq!(save.data.keys.roles, defs.captain.roles.iter().map(|r| r.key.clone()).collect::<Vec<_>>());
        for compress in [false, true] {
            let back = storage::decode(&storage::encode(&save, compress).unwrap()).unwrap();
            assert_eq!(save, back);
            let loaded = GameSession::from_save(defs.clone(), back).unwrap();
            assert_eq!(
                serde_json::to_vec(&loaded.world.state).unwrap(),
                serde_json::to_vec(&session.world.state).unwrap()
            );
        }
    }
}

#[test]
fn every_saved_key_table_accepts_only_suffix_additions() {
    let defs = common::defs();
    let save = GameSession::new(defs.clone(), ScenarioId(0), 8).unwrap().to_save();
    let original = serde_json::to_value(&save.data.keys).unwrap();
    // 遍历所有表，新增表也自动纳入本测试。
    for (name, value) in original.as_object().unwrap() {
        assert!(!value.as_array().unwrap().is_empty(), "经典世界的 {name} 夹具应非空");
        let mut extra = original.clone();
        extra[name].as_array_mut().unwrap().push("appended_key".into());
        let mut current = (*defs).clone();
        current.meta.keys = serde_json::from_value(extra).unwrap();
        save.check_compatible(&current).unwrap();

        let mut missing = original.clone();
        missing[name].as_array_mut().unwrap().pop();
        current.meta.keys = serde_json::from_value(missing).unwrap();
        assert!(matches!(save.check_compatible(&current), Err(CoreError::SnapshotMismatch(_))), "{name}");

        let mut reordered = original.clone();
        let keys = reordered[name].as_array_mut().unwrap();
        if keys.len() > 1 {
            keys.swap(0, 1);
        } else {
            keys[0] = "replaced_key".into();
        }
        current.meta.keys = serde_json::from_value(reordered).unwrap();
        assert!(matches!(save.check_compatible(&current), Err(CoreError::SnapshotMismatch(_))), "{name}");
    }
}

#[test]
fn world_mismatch_is_rejected_even_with_identical_tables() {
    let defs = common::defs();
    let save = GameSession::new(defs.clone(), ScenarioId(0), 1).unwrap().to_save();
    let mut other = (*defs).clone();
    other.world_key = "other".into();
    let error = save.check_compatible(&other).unwrap_err();
    assert_eq!(error.code(), "save.world_mismatch");
    assert!(GameSession::from_save(std::sync::Arc::new(other), save).is_err());
}

#[test]
fn all_legacy_versions_are_classic_and_continue_thirty_days() {
    let original = storage::decode(include_bytes!("fixtures/save_v1.mfsave.zst")).unwrap();
    let mut expected = GameSession::from_save(common::defs(), original.clone()).unwrap();
    for _ in 0..30 {
        expected.advance_day().unwrap();
    }
    for version in 1..=4 {
        let mut value = serde_json::to_value(&original).unwrap();
        value["version"] = version.into();
        value["world"] = "not_classic".into();
        for name in ["attributes", "scenarios", "refits", "roles"] {
            value["data"]["keys"].as_object_mut().unwrap().remove(name);
        }
        if version == 1 {
            value = manifest_core::save::downgrade_to_v1(value).unwrap();
        }
        let save = SaveFile::from_json(&value.to_string()).unwrap();
        assert_eq!(save.world, "classic");
        assert_eq!(save.version, 5);
        let mut session = GameSession::from_save(common::defs(), save).unwrap();
        for _ in 0..30 {
            session.advance_day().unwrap();
        }
        assert_eq!(session.world.state, expected.world.state, "v{version}");
    }
    let mut value = serde_json::to_value(&original).unwrap();
    value.as_object_mut().unwrap().remove("world");
    assert_eq!(SaveFile::from_json(&value.to_string()).unwrap().world, "classic");
    value["version"] = (u64::from(u32::MAX) + 2).into();
    assert!(SaveFile::from_json(&value.to_string()).is_err());
}
