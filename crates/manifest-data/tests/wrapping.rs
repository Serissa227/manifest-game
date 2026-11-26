//! 实际地图包的环绕接线、最优寻路及缓存隔离。

use manifest_core::nav::NavGrid;
use manifest_core::rng::{Domain, Rng};
use manifest_core::{Cell, LocId};
use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

#[test]
fn testbed_routes_cross_the_seam_and_astar_matches_dijkstra_for_200_pairs() {
    let defs = manifest_data::load_world(&root(), "testbed").unwrap();
    let map = &defs.map;
    assert!(map.wrap_x);
    assert_eq!((map.width, map.height), (120, 60));
    let (a, b) = (defs.loc(LocId(0)).cell, defs.loc(LocId(1)).cell);
    let route = map.find_path(&defs.regions, 0, a, b).unwrap();
    let mut flat = map.clone();
    flat.wrap_x = false;
    let detour = flat.find_path(&defs.regions, 0, a, b).unwrap();
    assert!(route.cost < detour.cost / 10);
    assert_eq!(route.cells.len(), 5);
    assert!(route.cells.windows(2).any(|w| w[0].x == 0 && w[1].x == 119));
    assert_eq!(map.dir_between(Cell::new(0, 2), Cell::new(119, 2)), 6);
    assert_eq!(map.dir_between(Cell::new(119, 2), Cell::new(0, 2)), 2);
    assert_eq!(route, defs.nav.grid.find_path(0, a, b).unwrap());

    // 不同方向、纬度、季节；加入浅海与不同风流，避免只验证均匀代价的开阔海面。
    let mut map = map.clone();
    for y in 10..40 {
        let idx = map.idx(Cell::new(0, y));
        map.terrain[idx] = manifest_core::nav::Terrain::Shallow;
    }
    let mut regions = defs.regions.clone();
    for (i, region) in regions.iter_mut().enumerate() {
        for (season, weather) in region.seasons.iter_mut().enumerate() {
            weather.wind_dir = (i * 3 + season * 2) as u8;
            weather.wind_strength = 10;
            weather.current_dir = (i + season) as u8;
            weather.current_strength = 3;
        }
    }
    let grid = NavGrid::new(&map, &regions);
    let mut rng = Rng::derive(13, 0, Domain::Weather, 0, 0);
    for i in 0..200 {
        let a = Cell::new(rng.below(8) as u16, 2 + rng.below(58) as u16);
        let b = Cell::new(112 + rng.below(8) as u16, 2 + rng.below(58) as u16);
        let (a, b) = if i % 2 == 0 { (a, b) } else { (b, a) };
        let season = i % 4;
        let astar = map.find_path(&regions, season, a, b).unwrap();
        let cached_astar = grid.find_path(season, a, b).unwrap();
        let dijkstra = grid.routes_from(season, a, &[b]).remove(0).unwrap();
        assert_eq!(astar, cached_astar, "第 {i} 对：{a:?} → {b:?}");
        assert_eq!(astar.cost, dijkstra.cost, "第 {i} 对：{a:?} → {b:?}");
        let reference = map.reference_routes(&regions, season, a, &[b]).remove(0).unwrap();
        assert_eq!(dijkstra, reference);
    }
}

#[test]
fn classic_astar_matches_dijkstra_on_real_map() {
    let defs = manifest_data::load_world(&root(), "classic").unwrap();
    assert!(!defs.map.wrap_x);
    let ports: Vec<_> = defs.port_ids().map(|p| defs.loc(p).cell).collect();
    for (i, from) in ports.iter().enumerate() {
        let to = ports[(i + 7) % ports.len()];
        let season = i % 4;
        let a = defs.nav.grid.find_path(season, *from, to).unwrap();
        let d = defs.nav.grid.routes_from(season, *from, &[to]).remove(0).unwrap();
        assert_eq!(a.cost, d.cost);
    }
}

#[test]
fn changing_only_wrap_flag_rebuilds_navigation_and_flat_map_rejects_seam_rectangle() {
    let temp = tempfile::tempdir().unwrap();
    fn copy(from: &std::path::Path, to: &std::path::Path) {
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
    copy(&root(), temp.path());
    let path = temp.path().join("maps/testbed/map.toml");
    let original = std::fs::read_to_string(&path).unwrap();
    std::fs::write(&path, original.replace("wrap_x = true", "wrap_x = false")).unwrap();
    assert!(manifest_data::load_world(temp.path(), "testbed").unwrap_err().to_string().contains("rect"));

    let regions = temp.path().join("maps/testbed/regions.toml");
    let text = std::fs::read_to_string(&regions).unwrap();
    std::fs::write(&regions, text.replace("[115, 0, 4, 59]", "[0, 0, 119, 59]")).unwrap();
    let flat = manifest_data::load_world(temp.path(), "testbed").unwrap();
    std::fs::write(&path, &original).unwrap();
    let wrapped = manifest_data::load_world(temp.path(), "testbed").unwrap();
    assert!(!std::sync::Arc::ptr_eq(&flat.nav, &wrapped.nav));
    let (a, b) = (flat.loc(LocId(0)).cell, flat.loc(LocId(1)).cell);
    assert!(wrapped.nav.grid.find_path(0, a, b).unwrap().cost < flat.nav.grid.find_path(0, a, b).unwrap().cost);
}

#[test]
fn seam_region_includes_both_sides_and_excludes_the_middle() {
    let defs = manifest_data::load_world(&root(), "testbed").unwrap();
    for x in [0, 4, 115, 119] {
        assert_eq!(defs.map.region_of(Cell::new(x, 30)).unwrap().idx(), 0);
    }
    for x in [5, 60, 114] {
        assert_eq!(defs.map.region_of(Cell::new(x, 30)).unwrap().idx(), 1);
    }
}
