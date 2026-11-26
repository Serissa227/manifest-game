//! P01 导航基线。prepare 在独立进程导出输入，cold/hot 进程只测 B4 缓存接口。
//! 完整入口与 JSON 口径见 tools/perf/README.md。

#[path = "../../../tools/perf/support.rs"]
mod support;

use manifest_core::defs::RegionDef;
use manifest_core::nav::climate::NavWeather;
use manifest_core::nav::{NavigationRules, SeaMap, Terrain};
use manifest_core::weather::Climate;
use manifest_core::{Cell, LocId};
use manifest_data::nav_cache::{CacheSource, NavCacheOptions, NavInput, fingerprint, load_or_build};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::Path;
use support::{Args, Result, measure, nav_memory, write_json};

// 只在工具中增加传输结构，不给内核类型添加序列化接口。
#[derive(Serialize, Deserialize)]
#[serde(remote = "SeaMap")]
struct MapWire {
    width: u16,
    height: u16,
    wrap_x: bool,
    terrain: Vec<Terrain>,
    region: Vec<u16>,
}

#[derive(Serialize, Deserialize)]
struct RegionWire {
    key: String,
    name: String,
    rect: (u16, u16, u16, u16),
    seasons: [NavWeather; 4],
    climate: Climate,
}

#[derive(Serialize, Deserialize)]
struct Fixture {
    world: String,
    world_fingerprint: String,
    map_key: String,
    #[serde(with = "MapWire")]
    map: SeaMap,
    regions: Vec<RegionWire>,
    rules: Option<NavigationRules>,
    loc_count: usize,
    ports: Vec<(LocId, Cell)>,
}

impl Fixture {
    fn regions(&self) -> Vec<RegionDef> {
        self.regions
            .iter()
            .map(|r| RegionDef {
                key: r.key.clone(),
                name: r.name.clone(),
                rect: r.rect,
                seasons: r.seasons.map(Into::into),
                climate: r.climate,
            })
            .collect()
    }

    fn input<'a>(&'a self, regions: &'a [RegionDef]) -> NavInput<'a> {
        NavInput {
            world: &self.world,
            map: &self.map,
            regions,
            rules: self.rules.as_ref(),
            loc_count: self.loc_count,
            ports: &self.ports,
        }
    }
}

fn prepare(root: &Path, world: &str, out: &Path) -> Result<()> {
    let root = if world == "synth1080" {
        let generated = out.join("fixture-data");
        manifest_data::bench::synth1080::write_world(root, &generated)?;
        generated
    } else {
        root.canonicalize()?
    };
    if let Some(report) = support::skipped(&root, world)? {
        return write_json(&out.join("report.json"), &report);
    }
    let defs = manifest_data::load_world(&root, world)?;
    let fixture = Fixture {
        world: world.into(),
        world_fingerprint: defs.meta.hash.clone(),
        map_key: defs.map_key.clone(),
        map: defs.map.clone(),
        loc_count: defs.locations.len(),
        ports: defs.port_ids().map(|id| (id, defs.loc(id).cell)).collect(),
        regions: defs
            .regions
            .iter()
            .map(|r| RegionWire {
                key: r.key.clone(),
                name: r.name.clone(),
                rect: r.rect,
                seasons: r.seasons.map(Into::into),
                climate: r.climate,
            })
            .collect(),
        rules: defs.nav.grid.rules().cloned(),
    };
    // 真实世界必须实际使用十二个月；不能把四季复制三次冒充实测。
    if world == "terra16" && defs.nav.grid.period_count() != 12 {
        return Err("terra16 已可加载，但运行时导航尚未接入 12 月配置；不能作为十二月基线".into());
    }
    let key = fingerprint(&fixture.input(&defs.regions))?;
    write_json(&out.join("input.json"), &fixture)?;
    write_json(
        &out.join("report.json"),
        &json!({
            "schema_version": 1, "package_version": env!("CARGO_PKG_VERSION"),
            "status": "ok", "phase": "prepare", "world": world,
            "world_fingerprint": defs.meta.hash, "nav_fingerprint": key,
            "data_root": root, "fixture": out.join("input.json"),
            "cells": fixture.map.terrain.len(), "ports": fixture.ports.len(),
            "periods": defs.nav.grid.period_count(), "calendar_months": defs.calendar.months().len(),
            "note": "input export only; existing world loader may build its own navigation table; excluded from B4 timing and RSS"
        }),
    )
}

fn run(fixture: &Fixture, phase: &str, cache: &Path, threads: usize, queries: usize) -> Result<serde_json::Value> {
    let regions = fixture.regions();
    if fixture.ports.len() < 2 {
        return Err("导航查询至少需要两个港口".into());
    }
    let input = fixture.input(&regions);
    let key = fingerprint(&input)?;
    let options = NavCacheOptions { directory: cache.into(), threads };
    // 热载不允许自动重建后冒充命中；冷载不允许复用已有产物。
    let cache_path = cache.join(format!("{}-{key}.bin", fixture.world));
    if cache_path.is_file() != (phase == "hot") {
        return Err(format!("{phase} 的缓存前置条件不满足：{}", cache_path.display()).into());
    }
    let (loaded, loading) = measure(|| Ok(load_or_build(input, &options)?))?;
    let expected = if phase == "cold" { CacheSource::Built } else { CacheSource::Disk };
    if loaded.source != expected {
        return Err(format!("缓存来源不符：期望 {expected:?}，实际 {:?}", loaded.source).into());
    }
    if let Some(error) = &loaded.persistence_error {
        return Err(format!("缓存未持久化：{error}").into());
    }
    let memory = nav_memory(&loaded.table);
    let periods = loaded.table.grid.period_count();
    let (query_results, query_measurement) = measure(|| {
        let mut results = Vec::new();
        for q in 0..queries {
            let from = fixture.ports[q % fixture.ports.len()].1;
            let to = fixture.ports[(q * 17 + 1) % fixture.ports.len()].1;
            let path = loaded.table.grid.find_path(q % periods, from, to);
            results.push(path.map(|p| json!({"cost": p.cost, "cells": p.cells})));
        }
        Ok(results)
    })?;
    let route_bytes = loaded.table.route_bytes();
    let route_hash = blake3::hash(&route_bytes).to_hex().to_string();
    let query_hash = blake3::hash(&serde_json::to_vec(&query_results)?).to_hex().to_string();
    Ok(json!({
        "schema_version": 1, "package_version": env!("CARGO_PKG_VERSION"),
        "status": "ok", "case": "nav", "phase": phase, "world": fixture.world,
        "world_fingerprint": fixture.world_fingerprint, "nav_fingerprint": key,
        "nav_algorithm_version": manifest_data::nav_cache::NAV_ALGORITHM_VERSION,
        "map_key": fixture.map_key, "cells": fixture.map.terrain.len(),
        "width": fixture.map.width, "height": fixture.map.height,
        "ports": fixture.ports.len(), "periods": periods, "threads": threads,
        "cache_source": format!("{:?}", loaded.source), "loading": loading,
        "loading_scope": "fingerprint, grid, B4 build/read, cache validation and persistence; excludes input parsing and output hashing",
        "cache_temperature": "application disk cache; operating-system file cache is not flushed",
        "navigation_memory": memory,
        "cache_file_bytes": std::fs::metadata(&loaded.cache_path)?.len(),
        "cache_file": loaded.cache_path,
        "route_encoding_bytes": route_bytes.len(), "route_hash_blake3": route_hash,
        "queries": {"count": queries, "measurement": query_measurement, "hash_blake3": query_hash},
        "legacy_expanded_paths_after_queries": loaded.table.memory().legacy_expanded_paths
    }))
}

fn main() -> Result<()> {
    let mut args = Args::parse(std::env::args().skip(1))?;
    let out = support::output_dir(&mut args)?;
    let phase = args.required("--phase")?;
    if phase == "prepare" {
        let root = args.required("--data-root")?;
        let world = args.required("--world")?;
        args.finish()?;
        return prepare(Path::new(&root), &world, &out);
    }
    if !["cold", "hot"].contains(&phase.as_str()) {
        return Err("--phase 只能是 prepare/cold/hot".into());
    }
    let fixture = args.required("--fixture")?;
    let cache = args.required("--cache-dir")?;
    let threads = args.number("--threads", 2, 1, 64)? as usize;
    let queries = args.number("--queries", 3, 1, 100_000)? as usize;
    args.finish()?;
    let fixture = serde_json::from_reader(std::io::BufReader::new(std::fs::File::open(fixture)?))?;
    let report = run(&fixture, &phase, Path::new(&cache), threads, queries)?;
    write_json(&out.join("report.json"), &report)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Fixture {
        let weather = NavWeather {
            wind_dir: 2,
            wind_strength: 4,
            current_dir: 2,
            current_strength: 1,
            storm_bp: 0,
            pirate_bp: 0,
        };
        Fixture {
            world: "tiny".into(),
            world_fingerprint: "test".into(),
            map_key: "tiny".into(),
            map: SeaMap { width: 5, height: 3, wrap_x: true, terrain: vec![Terrain::Deep; 15], region: vec![0; 15] },
            regions: vec![RegionWire {
                key: "sea".into(),
                name: "测试海".into(),
                rect: (0, 0, 4, 2),
                seasons: [weather; 4],
                climate: Climate::Temperate,
            }],
            rules: Some(NavigationRules {
                regions: vec![manifest_core::nav::climate::RegionClimate {
                    weather: vec![weather; 12],
                    ..Default::default()
                }],
                ..Default::default()
            }),
            loc_count: 2,
            ports: vec![(LocId(0), Cell::new(0, 1)), (LocId(1), Cell::new(4, 1))],
        }
    }

    #[test]
    fn exported_input_keeps_months_and_navigation_fingerprint() {
        let original = fixture();
        let decoded: Fixture = serde_json::from_slice(&serde_json::to_vec(&original).expect("编码")).expect("解码");
        assert_eq!(decoded.rules.as_ref().expect("规则").period_count(), 12);
        assert_eq!(
            fingerprint(&original.input(&original.regions())).expect("原指纹"),
            fingerprint(&decoded.input(&decoded.regions())).expect("新指纹")
        );
    }

    #[test]
    fn cold_and_disk_hot_have_equal_hashes_without_expansion() {
        let target = std::env::var_os("CARGO_TARGET_DIR").expect("测试必须设置独立 target");
        let dir = tempfile::tempdir_in(target).expect("独立目录");
        let cold = run(&fixture(), "cold", dir.path(), 2, 2).expect("冷建");
        let hot = run(&fixture(), "hot", dir.path(), 2, 2).expect("磁盘热载");
        assert_eq!(cold["route_hash_blake3"], hot["route_hash_blake3"]);
        assert_eq!(cold["queries"]["hash_blake3"], hot["queries"]["hash_blake3"]);
        assert_eq!(hot["cache_source"], "Disk");
        assert_eq!(hot["periods"], 12);
        assert_eq!(hot["legacy_expanded_paths_after_queries"], 0);
        assert!(run(&fixture(), "cold", dir.path(), 2, 2).is_err());
        let path = std::fs::read_dir(dir.path()).expect("缓存").next().expect("文件").expect("目录项").path();
        std::fs::write(path, b"damaged").expect("破坏夹具");
        assert!(run(&fixture(), "hot", dir.path(), 2, 2).is_err(), "损坏后的重建不是热命中");
    }
}
