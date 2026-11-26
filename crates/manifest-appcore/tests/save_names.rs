//! 显示名可以很长，文件名保持有界；旧槽位与新槽位共用原来的存读档、覆盖和删除流程。
use manifest_ai::MemoryKeyStore;
use manifest_appcore::{AppPaths, AppState, handlers};
use std::sync::Arc;

#[test]
fn long_and_punctuated_names_roundtrip_without_collisions_and_keep_legacy_slots() {
    let dir = std::env::temp_dir().join(format!("manifest-save-names-{}", std::process::id()));
    let st = AppState::from_data_dir(
        &manifest_data::find_data_dir().unwrap(),
        Arc::new(MemoryKeyStore::default()),
        AppPaths::in_dir(&dir),
    )
    .unwrap();
    let first = format!("{}：暂停前 ⚓", "很长的中文存档名称".repeat(50));
    let second = format!("{}：暂停后 ⚓", "很长的中文存档名称".repeat(50));
    handlers::new_game(&st, "newcomer", Some(1)).unwrap();
    let before = handlers::debug(&st).unwrap().state_hash;
    handlers::save_game(&st, "legacy").unwrap();
    assert!(dir.join("saves/legacy.mfsave.zst").is_file());
    handlers::save_game(&st, &first).unwrap();
    handlers::new_game(&st, "newcomer", Some(2)).unwrap();
    let after = handlers::debug(&st).unwrap().state_hash;
    assert_ne!(before, after);
    for name in [&second, "CON", "港口（临时） - 第 1 天"] {
        assert_eq!(handlers::save_game(&st, name).unwrap().slot, *name);
    }
    let names: Vec<_> = handlers::list_saves(&st).unwrap().into_iter().map(|s| s.slot).collect();
    assert_eq!(names.len(), 5);
    assert!(names.contains(&first) && names.contains(&second));
    for file in std::fs::read_dir(dir.join("saves")).unwrap() {
        assert!(file.unwrap().file_name().to_string_lossy().len() < 100);
    }
    handlers::load_game(&st, &first).unwrap();
    assert_eq!(handlers::debug(&st).unwrap().state_hash, before);
    handlers::load_game(&st, &second).unwrap();
    assert_eq!(handlers::debug(&st).unwrap().state_hash, after);
    handlers::save_game(&st, &first).unwrap();
    handlers::load_game(&st, &first).unwrap();
    assert_eq!(handlers::debug(&st).unwrap().state_hash, after);
    let remaining = handlers::delete_save(&st, &first).unwrap();
    assert_eq!(remaining.len(), 4);
    assert!(remaining.iter().any(|s| s.slot == second));
    handlers::load_game(&st, "legacy").unwrap();
    assert_eq!(handlers::debug(&st).unwrap().state_hash, before);
    for invalid in ["", "   ", "..", "../legacy", "a\\b", "name\n"] {
        assert!(handlers::save_game(&st, invalid).is_err());
        assert!(handlers::load_game(&st, invalid).is_err());
        assert!(handlers::delete_save(&st, invalid).is_err());
    }
    assert!(dir.join("saves/legacy.mfsave.zst").is_file());
    std::fs::remove_dir_all(dir).unwrap();
}
