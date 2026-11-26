//! 压缩表与逐格 Dijkstra 的经典全量对照，以及固定大图的随机 500 条路径。

use manifest_core::defs::{RegionDef, SeasonWeather};
use manifest_core::nav::{CompressedPath, NavGrid, NavTable};
use manifest_core::rng::{Domain, Rng};
use manifest_core::weather::Climate;
use std::path::PathBuf;

fn regions() -> Vec<RegionDef> {
    (0..4)
        .map(|i| RegionDef {
            key: format!("sea_{i}"),
            name: format!("海区 {i}"),
            rect: (0, i * 99, 1079, i * 99 + 98),
            climate: Climate::Temperate,
            seasons: std::array::from_fn(|s| SeasonWeather {
                wind_dir: ((usize::from(i) + s * 2) % 8) as u8,
                wind_strength: 4,
                current_dir: 2,
                current_strength: 1,
                storm_bp: 0,
                pirate_bp: 0,
            }),
        })
        .collect()
}

#[test]
fn all_classic_routes_match_original_cell_dijkstra_and_binary_roundtrip() {
    let defs = manifest_data::load_shared(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")).unwrap();
    let ports: Vec<_> = defs.port_ids().map(|id| (id, defs.loc(id).cell)).collect();
    let targets: Vec<_> = ports.iter().map(|(_, cell)| *cell).collect();
    let bytes = defs.nav.route_bytes();
    let restored =
        NavTable::from_route_bytes(NavGrid::new(&defs.map, &defs.regions), defs.locations.len(), &ports, &bytes)
            .unwrap();
    assert_eq!(restored.memory().legacy_expanded_paths, 0);
    assert_eq!(restored.route_bytes(), bytes);
    let mut count = 0;
    for period in 0..4 {
        for &(from, cell) in &ports {
            let reference = defs.map.reference_routes(&defs.regions, period, cell, &targets);
            for ((to, _), original) in ports.iter().zip(reference) {
                let route = restored.compressed_path(period, from, *to);
                match (original, route) {
                    (Some(original), Some(route)) => {
                        assert_eq!(route.expand(defs.map.topology()), original);
                        assert_eq!(
                            serde_json::to_vec(&route.expand(defs.map.topology())).unwrap(),
                            serde_json::to_vec(&original).unwrap()
                        );
                        count += 1;
                    }
                    (None, None) => {}
                    _ => panic!("可达性必须一致"),
                }
            }
        }
    }
    assert_eq!(count, 4 * ports.len() * (ports.len() - 1));
    assert_eq!(restored.memory().legacy_expanded_paths, 0, "统计与迭代均不缓存逐格展开");
    for bad in [&bytes[..0], &bytes[..bytes.len() / 2], &bytes[..bytes.len() - 1]] {
        assert!(
            NavTable::from_route_bytes(NavGrid::new(&defs.map, &defs.regions), defs.locations.len(), &ports, bad)
                .is_err()
        );
    }
}

#[test]
fn synthetic_1080_routes_roundtrip_500_random_paths() {
    let (map, ports) = manifest_data::bench::synth1080::navigation_fixture(150).unwrap();
    let grid = NavGrid::new(&map, &regions());
    let mut rng = Rng::derive(15, 0, Domain::Weather, 0, 0);
    for i in 0..500 {
        let a = rng.below(ports.len() as u64) as usize;
        let b = (a + 1 + rng.below((ports.len() - 1) as u64) as usize) % ports.len();
        let original = grid.find_path(i % 4, ports[a].1, ports[b].1).unwrap();
        let compressed = CompressedPath::compress(&original, map.topology()).unwrap();
        assert_eq!(compressed.expand(map.topology()), original, "随机路径 {i}");
    }
}
