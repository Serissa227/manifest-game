//! 缓存必须可丢弃、可重建；不因损坏或只读部署目录阻止开局。

use manifest_core::defs::{RegionDef, SeasonWeather};
use manifest_core::nav::climate::{NavWeather, Projection, ProjectionKind, RegionClimate};
use manifest_core::nav::{NavigationRules, SeaMap, Terrain};
use manifest_core::weather::Climate;
use manifest_core::{Cell, LocId};
use manifest_data::nav_cache::{CacheSource, NavCacheOptions, NavInput, fingerprint, load_existing, load_or_build};

fn fixture() -> (SeaMap, Vec<RegionDef>, Vec<(LocId, Cell)>) {
    (
        SeaMap { width: 5, height: 3, wrap_x: true, terrain: vec![Terrain::Deep; 15], region: vec![0; 15] },
        vec![RegionDef {
            key: "sea".into(),
            name: "测试海".into(),
            rect: (0, 0, 4, 2),
            climate: Climate::Temperate,
            seasons: [SeasonWeather {
                wind_dir: 2,
                wind_strength: 5,
                current_dir: 2,
                current_strength: 1,
                storm_bp: 0,
                pirate_bp: 0,
            }; 4],
        }],
        vec![(LocId(0), Cell::new(0, 1)), (LocId(1), Cell::new(4, 1))],
    )
}

#[test]
fn cold_disk_and_memory_loads_have_identical_bytes_without_expanding() {
    let (map, regions, ports) = fixture();
    let tmp = tempfile::tempdir().unwrap();
    let options = NavCacheOptions { directory: tmp.path().join("nav"), threads: 2 };
    let input = NavInput { world: "world", map: &map, regions: &regions, rules: None, loc_count: 2, ports: &ports };
    let cold = load_or_build(input, &options).unwrap();
    assert_eq!(cold.source, CacheSource::Built);
    assert!(cold.persistence_error.is_none());
    let bytes = cold.table.route_bytes();
    assert_eq!(cold.table.memory().legacy_expanded_paths, 0);
    drop(cold);
    let hot = load_or_build(input, &options).unwrap();
    assert_eq!(hot.source, CacheSource::Disk);
    assert_eq!(hot.table.route_bytes(), bytes);
    assert_eq!(hot.table.memory().legacy_expanded_paths, 0);
    let shared = load_or_build(input, &options).unwrap();
    assert_eq!(shared.source, CacheSource::Memory);
    assert!(std::sync::Arc::ptr_eq(&hot.table, &shared.table));
    assert_eq!(std::fs::read_dir(&options.directory).unwrap().count(), 1, "原子写盘不遗留临时文件");
}

/// 2026-11-03：桌面版把缓存写在用户目录，data 旁现成的只读地用（load_existing 只找、不建表、不写盘）。
#[test]
fn existing_tables_are_found_without_building_or_writing() {
    let (map, regions, ports) = fixture();
    let tmp = tempfile::tempdir().unwrap();
    let beside = NavCacheOptions { directory: tmp.path().join("beside"), threads: 2 };
    let user = NavCacheOptions { directory: tmp.path().join("user"), threads: 2 };
    let input = NavInput { world: "world", map: &map, regions: &regions, rules: None, loc_count: 2, ports: &ports };
    assert!(load_existing(input, &beside).unwrap().is_none());
    assert!(!beside.directory.exists(), "只找不写");
    let built = load_or_build(input, &beside).unwrap();
    assert_eq!(built.source, CacheSource::Built);
    let bytes = built.table.route_bytes();
    drop(built);
    let found = load_existing(input, &beside).unwrap().expect("data 旁的缓存");
    assert_eq!(found.source, CacheSource::Disk);
    assert_eq!(found.table.route_bytes(), bytes);
    assert!(load_existing(input, &user).unwrap().is_none());
    assert!(!user.directory.exists(), "另一个目录里没有就是没有，不建表");
}

#[test]
fn all_route_inputs_change_the_fingerprint() {
    let (map, regions, ports) = fixture();
    let input = NavInput { world: "world", map: &map, regions: &regions, rules: None, loc_count: 2, ports: &ports };
    let base = fingerprint(&input).unwrap();
    let mut moved = ports.clone();
    moved[1].1.x = 3;
    assert_ne!(fingerprint(&NavInput { ports: &moved, ..input }).unwrap(), base);
    let mut changed = regions.clone();
    changed[0].seasons[0].current_dir = 6;
    assert_ne!(fingerprint(&NavInput { regions: &changed, ..input }).unwrap(), base);
    let mut barrier = map.clone();
    barrier.terrain[6] = Terrain::Land;
    assert_ne!(fingerprint(&NavInput { map: &barrier, ..input }).unwrap(), base);
    let mut rules = NavigationRules::default();
    let original_rules = fingerprint(&NavInput { rules: Some(&rules), ..input }).unwrap();
    rules.projection =
        Some(Projection { kind: ProjectionKind::Equirect, west: 0, north: 4000, arcmin_per_cell: 20, lat_scale: true });
    assert_ne!(fingerprint(&NavInput { rules: Some(&rules), ..input }).unwrap(), original_rules);
    rules.projection = None;
    rules.regions =
        vec![RegionClimate { weather: vec![NavWeather::from(regions[0].seasons[0]); 12], ..Default::default() }];
    let monthly = fingerprint(&NavInput { rules: Some(&rules), ..input }).unwrap();
    assert_ne!(monthly, original_rules);
    rules.regions[0].frozen_months = vec![1];
    assert_ne!(fingerprint(&NavInput { rules: Some(&rules), ..input }).unwrap(), monthly);
    rules.regions[0].frozen_months.clear();
    rules.frozen_ports.insert(LocId(1), vec![1]);
    assert_ne!(fingerprint(&NavInput { rules: Some(&rules), ..input }).unwrap(), monthly);
    assert_ne!(fingerprint(&NavInput { world: "another", ..input }).unwrap(), base);
}

#[test]
fn truncated_corrupt_and_old_version_files_are_rebuilt() {
    let (map, regions, ports) = fixture();
    let tmp = tempfile::tempdir().unwrap();
    let options = NavCacheOptions { directory: tmp.path().join("nav"), threads: 2 };
    let input = NavInput { world: "world", map: &map, regions: &regions, rules: None, loc_count: 2, ports: &ports };
    let loaded = load_or_build(input, &options).unwrap();
    let path = loaded.cache_path.clone();
    let original = std::fs::read(&path).unwrap();
    let routes = loaded.table.route_bytes();
    drop(loaded);
    let mut corrupted = original.clone();
    *corrupted.last_mut().unwrap() ^= 1;
    let mut old = original.clone();
    old[4..8].copy_from_slice(&0u32.to_le_bytes());
    for bytes in [original[..24].to_vec(), corrupted, old] {
        std::fs::write(&path, bytes).unwrap();
        let rebuilt = load_or_build(input, &options).unwrap();
        assert_eq!(rebuilt.source, CacheSource::Built);
        assert!(rebuilt.persistence_error.is_none());
        assert_eq!(rebuilt.table.route_bytes(), routes);
        assert_eq!(std::fs::read(&path).unwrap(), original);
    }
}

#[test]
fn two_threads_build_one_world_once() {
    let (map, regions, ports) = fixture();
    let tmp = tempfile::tempdir().unwrap();
    let options = NavCacheOptions { directory: tmp.path().join("nav"), threads: 2 };
    let input = NavInput { world: "world", map: &map, regions: &regions, rules: None, loc_count: 2, ports: &ports };
    let barrier = std::sync::Barrier::new(2);
    let results = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..2)
            .map(|_| {
                scope.spawn(|| {
                    barrier.wait();
                    load_or_build(input, &options).unwrap()
                })
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect::<Vec<_>>()
    });
    assert_eq!(results.iter().filter(|r| r.source == CacheSource::Built).count(), 1);
    assert_eq!(results.iter().filter(|r| r.source == CacheSource::Memory).count(), 1);
    assert!(std::sync::Arc::ptr_eq(&results[0].table, &results[1].table));
}

#[test]
fn unwritable_cache_keeps_routes_and_invalid_world_keys_write_nothing() {
    let (map, regions, ports) = fixture();
    let tmp = tempfile::tempdir().unwrap();
    let directory = tmp.path().join("file");
    std::fs::write(&directory, b"not a directory").unwrap();
    let options = NavCacheOptions { directory, threads: 2 };
    let input = NavInput { world: "world", map: &map, regions: &regions, rules: None, loc_count: 2, ports: &ports };
    let loaded = load_or_build(input, &options).unwrap();
    assert!(loaded.persistence_error.is_some());
    assert!(loaded.table.compressed_path(0, LocId(0), LocId(1)).is_some());
    assert!(load_or_build(NavInput { world: "../escape", ..input }, &options).is_err());
    assert_eq!(std::fs::read_dir(tmp.path()).unwrap().count(), 1);
}

#[test]
fn monthly_frozen_cache_preserves_periods_and_accessibility() {
    let (map, regions, ports) = fixture();
    let tmp = tempfile::tempdir().unwrap();
    let options = NavCacheOptions { directory: tmp.path().join("nav"), threads: 2 };
    let mut rules = NavigationRules::default();
    rules.frozen_ports.insert(LocId(1), vec![1, 12]);
    let input =
        NavInput { world: "world", map: &map, regions: &regions, rules: Some(&rules), loc_count: 2, ports: &ports };
    let cold = load_or_build(input, &options).unwrap();
    let bytes = cold.table.route_bytes();
    drop(cold);
    let hot = load_or_build(input, &options).unwrap();
    assert_eq!(hot.source, CacheSource::Disk);
    assert_eq!(hot.table.route_bytes(), bytes);
    assert_eq!(hot.table.grid.period_count(), 12);
    assert!(hot.table.compressed_path(0, LocId(0), LocId(1)).is_none());
    assert!(hot.table.compressed_path(5, LocId(0), LocId(1)).is_some());
    assert_eq!(hot.table.path_on(0, LocId(0), LocId(1)).unwrap_err().code(), "frozen_port");
}
