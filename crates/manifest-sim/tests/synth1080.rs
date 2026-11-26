//! B2 的固定大地图冒烟测试；E19 再在同一夹具上加入性能预算。
//!
//! 手动测量：cargo test --release -p manifest-sim --test synth1080 -- --nocapture

use manifest_core::ids::{LocId, ScenarioId};
use manifest_core::nav::Terrain;
use manifest_data::bench::synth1080::{self, COMPANIES, HEIGHT, PORTS, WIDTH, WORLD_KEY};
use manifest_sim::{Bot, BotKind, GameSession};
use std::path::PathBuf;
use std::time::Instant;

#[test]
fn generated_world_loads_builds_all_routes_and_simulates_30_days() {
    let started = Instant::now();
    let source = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let first = tempfile::tempdir().unwrap();
    synth1080::write_world(&source, first.path()).unwrap();
    let generation = started.elapsed();
    let other = tempfile::tempdir().unwrap();
    synth1080::write_world(&source, other.path()).unwrap();
    let hash = |root: &std::path::Path| manifest_data::resolve_world(root, WORLD_KEY).unwrap().hash(false).unwrap();
    assert_eq!(hash(first.path()), hash(other.path()), "不同输出目录逐份生成的有效数据相同");
    assert!(synth1080::write_world(&source, first.path()).is_err(), "拒绝覆盖非空目录");

    let loading = Instant::now();
    let defs = manifest_data::load_world(first.path(), WORLD_KEY).unwrap();
    let load_and_routes = loading.elapsed();
    assert_eq!(defs.nav.memory().legacy_expanded_paths, 0, "加载与连通校验不展开航线表");
    assert_eq!((defs.map.width, defs.map.height), (WIDTH, HEIGHT));
    assert!(defs.map.wrap_x);
    assert_eq!(defs.port_ids().count(), PORTS);
    assert_eq!(defs.companies.len(), COMPANIES);
    let land = defs.map.terrain.iter().filter(|t| **t == Terrain::Land).count();
    assert!(land > 50_000 && land < 300_000, "既有大陆也有广阔外洋：{land}");
    let reachable = defs.map.reachable_from(defs.loc(LocId(0)).cell);
    for port in defs.port_ids() {
        let cell = defs.loc(port).cell;
        assert!(reachable[defs.map.idx(cell)] && defs.map.touches_land(cell));
    }
    let (mut routes, mut route_cells) = (0usize, 0usize);
    for season in 0..4 {
        for from in defs.port_ids() {
            for to in defs.port_ids().filter(|to| *to != from) {
                let path = defs.nav.compressed_path(season, from, to).expect("每季所有港口互通");
                assert_eq!(path.cells(defs.map.topology()).next(), Some(defs.loc(from).cell));
                assert_eq!(path.cells(defs.map.topology()).last(), Some(defs.loc(to).cell));
                routes += 1;
                route_cells += path.len();
            }
        }
    }
    assert_eq!(routes, 4 * PORTS * (PORTS - 1));
    let simulation = Instant::now();
    let mut session = GameSession::new(defs, ScenarioId(0), 42).unwrap();
    let mut bot = Bot::new(BotKind::Arbitrage);
    for _ in 0..30 {
        bot.act(&mut session);
        session.advance_day().unwrap();
        manifest_core::testkit::check_invariants(&session.world).unwrap();
    }
    let simulation_time = simulation.elapsed();
    assert_eq!(session.day(), 30);
    assert_eq!(session.world.state_hash(), session.replay().unwrap().state_hash());
    assert_eq!(session.world.defs.nav.memory().legacy_expanded_paths, 0, "运行与重放 30 天仍无兼容展开");
    println!(
        "synth1080：{WIDTH}×{HEIGHT}，港口 {PORTS}，商会 {COMPANIES}，陆格 {land}，四季航线 {routes}，路径格 {route_cells}（格序列净字节 {}）；生成 {:.3}s，加载含建表 {:.3}s，开局与模拟 30 天 {:.3}s；数据哈希 {}，状态哈希 {}",
        route_cells * std::mem::size_of::<manifest_core::Cell>(),
        generation.as_secs_f64(),
        load_and_routes.as_secs_f64(),
        simulation_time.as_secs_f64(),
        session.world.defs.meta.hash,
        session.world.state_hash()
    );
}
