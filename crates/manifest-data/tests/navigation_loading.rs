//! 世界加载器对导航配置、数据哈希与磁盘缓存的接线。

use manifest_core::LocId;
use std::path::{Path, PathBuf};

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

fn fixture() -> (tempfile::TempDir, PathBuf) {
    let temp = tempfile::tempdir().unwrap();
    let data = temp.path().join("data");
    copy(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data"), &data);
    (temp, data)
}

#[test]
fn navigation_changes_hash_uses_real_months_and_loads_compressed_cache() {
    let (temp, data) = fixture();
    let old = manifest_data::load_world(&data, "testbed").unwrap();
    assert_eq!(old.nav.grid.period_on(0), 3, "无配置时也沿用世界的北半球季节");
    let old_hash = old.meta.hash.clone();
    drop(old);
    let config = data.join("worlds/testbed/navigation.toml");
    std::fs::write(&config, "# 一月封冻\n[frozen_ports]\ntest_east=[1]\n").unwrap();
    let defs = manifest_data::load_world(&data, "testbed").unwrap();
    assert_ne!(defs.meta.hash, old_hash);
    assert_eq!(defs.nav.grid.period_count(), 12);
    assert_eq!(defs.nav.grid.period_on(30), 0);
    assert_eq!(defs.nav.grid.period_on(31), 1);
    assert_eq!(defs.nav.grid.check_port(0, LocId(1)).unwrap_err().code(), "frozen_port");
    assert!(defs.nav.compressed_path(0, LocId(0), LocId(1)).is_none());
    assert!(defs.nav.compressed_path(1, LocId(0), LocId(1)).is_some());
    assert_eq!(defs.nav.memory().legacy_expanded_paths, 0);
    let encoded = defs.nav.route_bytes();
    let hash = defs.meta.hash.clone();
    drop(defs);
    assert!(
        std::fs::read_dir(temp.path().join("cache/nav"))
            .unwrap()
            .any(|e| { e.unwrap().path().file_name().unwrap().to_string_lossy().starts_with("testbed-") })
    );
    let loaded = manifest_data::load_world(&data, "testbed").unwrap();
    assert_eq!(loaded.nav.route_bytes(), encoded);
    assert_eq!(loaded.nav.memory().legacy_expanded_paths, 0);
    drop(loaded);
    std::fs::write(config, "[frozen_ports]\ntest_east=[2]\n").unwrap();
    assert_ne!(manifest_data::load_world(&data, "testbed").unwrap().meta.hash, hash);
}

#[test]
fn invalid_world_navigation_is_rejected_by_normal_loader() {
    let (_temp, data) = fixture();
    for config in [
        "[frozen_ports]\nmissing=[1]",
        "[frozen_ports]\ntest_east=[13]",
        "[regions.missing]\nsouth=true",
        "[regions.test_sea]\nweather=[{wind_dir=8,wind_strength=2,current_dir=0,current_strength=0}]",
        "[projection]\nkind='equirect'\nwest=0\nnorth=5400\narcmin_per_cell=0\nlat_scale=true",
    ] {
        std::fs::write(data.join("worlds/testbed/navigation.toml"), config).unwrap();
        let error = manifest_data::load_world(&data, "testbed").unwrap_err();
        assert!(
            matches!(&error, manifest_data::worlds::WorldError::Data(e) if e.issues.iter().any(|i| i.file == "navigation.toml")),
            "{error}"
        );
    }
}

#[test]
fn optional_classic_navigation_is_part_of_effective_files_and_hash() {
    let (_temp, data) = fixture();
    let before = manifest_data::resolve_world(&data, "classic").unwrap();
    assert!(!before.contains("navigation.toml"));
    let hash = before.hash(false).unwrap();
    std::fs::write(data.join("navigation.toml"), "# 显式导航配置\n").unwrap();
    let after = manifest_data::resolve_world(&data, "classic").unwrap();
    assert!(after.contains("navigation.toml"));
    assert_ne!(after.hash(false).unwrap(), hash);
}
