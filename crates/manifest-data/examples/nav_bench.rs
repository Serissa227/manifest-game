//! 航线表构建耗时对比：旧算法（逐格计算的 Dijkstra）、新算法（查表网格，单线程 / 多线程）、完整加载。
//!
//! 运行：`cargo run --release -p manifest-data --example nav_bench`
//! 先用真实 data/（240×120），再用合成的 400×170 大地图（临时目录，不写入 data/）。

use manifest_core::StaticData;
use manifest_core::ids::{Cell, LocId};
use manifest_core::nav::NavTable;
use std::time::Instant;

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

fn measure(label: &str, dir: &std::path::Path) {
    let t = Instant::now();
    let defs: std::sync::Arc<StaticData> = manifest_data::load(dir).unwrap_or_else(|e| panic!("{e}"));
    let first_load = ms(t);
    let t = Instant::now();
    let _ = manifest_data::load(dir).unwrap_or_else(|e| panic!("{e}"));
    let second_load = ms(t);
    let ports: Vec<(LocId, Cell)> = defs.port_ids().map(|l| (l, defs.loc(l).cell)).collect();
    let targets: Vec<Cell> = ports.iter().map(|p| p.1).collect();
    let t = Instant::now();
    let mut paths = 0usize;
    for season in 0..4 {
        for &(_, c) in &ports {
            paths += defs.map.reference_routes(&defs.regions, season, c, &targets).iter().flatten().count();
        }
    }
    let old = ms(t);
    let t = Instant::now();
    let single = NavTable::build(&defs.map, &defs.regions, defs.locations.len(), &ports);
    let single_ms = ms(t);
    let t = Instant::now();
    let _ = manifest_data::bench::build_nav_parallel(&defs.map, &defs.regions, defs.locations.len(), &ports);
    let parallel_ms = ms(t);
    let t = Instant::now();
    let sites: Vec<LocId> = defs.site_ids().collect();
    for s in &sites {
        let _ = single.find_path(&defs.map, &defs.regions, 0, ports[0].1, defs.loc(*s).cell);
    }
    let astar = if sites.is_empty() { 0.0 } else { ms(t) / sites.len() as f64 };
    println!(
        "{label}：地图 {}×{}，港口 {}，殖民点 {}，航线 {paths} 条\n  旧算法（逐格 Dijkstra，单线程）{old:.0} ms\n  新算法（查表网格，单线程）{single_ms:.0} ms\n  新算法（查表网格，{} 线程）{parallel_ms:.0} ms\n  完整加载：首次 {first_load:.0} ms，再次（航线表已缓存）{second_load:.0} ms\n  殖民点实时寻路（A*）平均 {astar:.1} ms/次",
        defs.map.width,
        defs.map.height,
        ports.len(),
        sites.len(),
        std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1)
    );
}

fn main() {
    let data = manifest_data::find_data_dir().expect("找到 data/");
    measure("真实数据", &data);
    let tmp = std::env::temp_dir().join(format!("manifest-nav-bench-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp);
    manifest_data::bench::write_synthetic_world(&data, &tmp, Default::default()).expect("生成合成大地图");
    measure("合成大地图", &tmp);
    let _ = std::fs::remove_dir_all(&tmp);
}
