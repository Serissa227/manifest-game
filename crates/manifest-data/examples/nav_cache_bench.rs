//! B4 的固定合成基准；8 线程，真实磁盘冷热对照，热载后不展开航线。
//! 运行：cargo run --locked --release -p manifest-data --example nav_cache_bench
//! 并行编译期间的数据仅用于观察；E19 的正式门槛仍须在空闲时段验收。

use manifest_core::defs::{RegionDef, SeasonWeather};
use manifest_core::nav::NavigationRules;
use manifest_core::nav::climate::{NavWeather, Projection, ProjectionKind, RegionClimate};
use manifest_core::weather::Climate;
use manifest_data::nav_cache::{CacheSource, NavCacheOptions, NavInput, load_or_build};
use std::time::Instant;

fn measure(port_count: usize, periods: usize) -> Result<(), Box<dyn std::error::Error>> {
    let (map, ports) = manifest_data::bench::synth1080::navigation_fixture(port_count)?;
    let regions: Vec<_> = (0..4)
        .map(|i| RegionDef {
            key: format!("sea_{i}"),
            name: format!("合成海区 {i}"),
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
        .collect();
    let rules = (periods == 12).then(|| NavigationRules {
        projection: Some(Projection {
            kind: ProjectionKind::Equirect,
            west: -10800,
            north: 4320,
            arcmin_per_cell: 20,
            lat_scale: true,
        }),
        regions: regions
            .iter()
            .enumerate()
            .map(|(i, r)| RegionClimate {
                weather: (0..12)
                    .map(|m| NavWeather {
                        wind_dir: ((i + m * 2) % 8) as u8,
                        wind_strength: 4 + (m % 3) as i64,
                        ..r.seasons[0].into()
                    })
                    .collect(),
                south: i >= 2,
                ..Default::default()
            })
            .collect(),
        ..Default::default()
    });
    let tmp = tempfile::tempdir()?;
    let options = NavCacheOptions { directory: tmp.path().join("nav"), threads: 8 };
    let world = format!("synth1080-{port_count}-{periods}");
    let input = NavInput {
        world: &world,
        map: &map,
        regions: &regions,
        rules: rules.as_ref(),
        loc_count: port_count,
        ports: &ports,
    };
    let start = Instant::now();
    let cold = load_or_build(input, &options)?;
    let cold_ms = start.elapsed().as_millis();
    assert_eq!(cold.source, CacheSource::Built);
    assert!(cold.persistence_error.is_none(), "{:?}", cold.persistence_error);
    let bytes = cold.table.route_bytes();
    let memory = cold.table.memory();
    let disk_bytes = std::fs::metadata(&cold.cache_path)?.len();
    assert_eq!(memory.paths, periods * port_count * (port_count - 1));
    assert_eq!(memory.legacy_expanded_paths, 0);
    drop(cold);
    let start = Instant::now();
    let hot = load_or_build(input, &options)?;
    let hot_ms = start.elapsed().as_millis();
    assert_eq!(hot.source, CacheSource::Disk, "必须是真正的磁盘热载");
    assert_eq!(hot.table.route_bytes(), bytes);
    assert_eq!(hot.table.memory().legacy_expanded_paths, 0);
    println!(
        "ports={port_count} periods={periods} threads=8 routes={} cells={} segments={} uncompressed_cell_bytes={} compressed_table_bytes={} grid_bytes={} disk_bytes={disk_bytes} cold_ms={cold_ms} hot_ms={hot_ms} expanded_paths=0",
        memory.paths, memory.cells, memory.segments, memory.expanded_cell_bytes, memory.table_bytes, memory.grid_bytes
    );
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    measure(150, 4)?;
    measure(165, 12)
}
