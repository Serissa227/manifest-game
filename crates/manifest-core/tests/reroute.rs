//! 第五批（EXPANSION §10.2）：地图重做后读旧存档——海上舰队与海盗若停在或将驶过已变成陆地的格子，
//! 读档时重新寻路到原目的地（或移回最近的海格）。全部在小型世界中进行：存下快照，把地图的一些格子改成陆地后读档。

use manifest_core::battle::PirateFleet;
use manifest_core::defs::StaticData;
use manifest_core::ids::*;
use manifest_core::nav::{NavTable, Terrain};
use manifest_core::replay::{LogEntry, Source, replay_onto};
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::world::{FleetLocation, Voyage};
use manifest_core::*;
use std::sync::Arc;

const P: OwnerId = OwnerId::Player;
const BETA: LocId = LocId(1);
const GAMMA: LocId = LocId(2);

/// 小型世界，关闭海盗的自然出现（测试自己放海盗）。
fn calm() -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.rules.pirates.spawn_scale = Fx::ZERO;
    Arc::new(d)
}

/// 把若干格改成陆地（海区清空），可选地移动一个地点的停泊格，然后重建航线表。
fn reshaped(defs: &StaticData, land: &[Cell], moved: Option<(LocId, Cell)>) -> Arc<StaticData> {
    let mut d = defs.clone();
    for c in land {
        assert!(defs.locations.iter().all(|l| l.cell != *c), "测试不应把地点所在格改成陆地：{c:?}");
        let i = d.map.idx(*c);
        d.map.terrain[i] = Terrain::Land;
        d.map.region[i] = u16::MAX;
    }
    if let Some((loc, cell)) = moved {
        d.locations[loc.idx()].cell = cell;
    }
    let ports: Vec<(LocId, Cell)> = d.port_ids().map(|l| (l, d.loc(l).cell)).collect();
    d.nav = Arc::new(NavTable::build(&d.map, &d.regions, d.locations.len(), &ports));
    Arc::new(d)
}

/// 航路上不是地点所在格的前 n 格。
fn off_locations(defs: &StaticData, cells: &[Cell], n: usize) -> Vec<Cell> {
    cells.iter().copied().filter(|c| defs.locations.iter().all(|l| l.cell != *c)).take(n).collect()
}

fn player_fleet(w: &World) -> FleetId {
    w.fleets_of(P).next().expect("玩家舰队").id
}

fn voyage(w: &World, f: FleetId) -> manifest_core::world::RouteVoyage {
    match &w.fleet(f).expect("舰队").location {
        FleetLocation::AtSea(manifest_core::world::Voyage::Route(v)) => v.clone(),
        other => panic!("舰队应在海上，实际 {other:?}"),
    }
}

/// 航路合法：所在格起的剩余航路都是海格、相邻两格八方向相邻、终点是目的地的停泊格。
fn assert_route_valid(w: &World, f: FleetId, dest: LocId) {
    let v = voyage(w, f);
    assert_eq!(v.dest, dest);
    let rest = &v.path[v.step..];
    assert!(!rest.is_empty());
    assert!(rest.iter().all(|c| w.defs.map.is_sea_in_bounds(*c)), "剩余航路应全是海格：{rest:?}");
    for pair in rest.windows(2) {
        let d = (pair[0].x as i64 - pair[1].x as i64).abs().max((pair[0].y as i64 - pair[1].y as i64).abs());
        assert_eq!(d, 1, "航路相邻两格应相邻：{pair:?}");
    }
    assert_eq!(v.path.last(), Some(&w.defs.loc(dest).cell), "终点是目的地的停泊格");
}

/// 开局后驶向 beta，走一天：返回世界与舰队（在海上）。
fn underway(defs: Arc<StaticData>, seed: u64) -> (World, FleetId) {
    let mut w = World::new(defs, ScenarioId(0), seed).expect("开局");
    let f = player_fleet(&w);
    Command::Resupply { owner: P, fleet: f, food: 20, water: 20 }.apply(&mut w).expect("补给");
    Command::SetSail { owner: P, fleet: f, dest: BETA }.apply(&mut w).expect("出航");
    w.end_day().unwrap();
    assert!(matches!(w.fleet(f).unwrap().location, FleetLocation::AtSea(_)), "一天后仍在海上");
    (w, f)
}

fn advance_until_docked(w: &mut World, f: FleetId, dest: LocId) {
    for _ in 0..60 {
        if w.fleet(f).unwrap().docked_at() == Some(dest) {
            return;
        }
        w.end_day().unwrap();
        check_invariants(w).unwrap_or_else(|e| panic!("{e}"));
    }
    panic!("60 天内没有抵达 {dest:?}");
}

#[test]
fn unchanged_map_leaves_the_snapshot_untouched() {
    let defs = calm();
    let (w, _) = underway(defs.clone(), 3);
    let loaded = World::from_snapshot(defs, w.state.clone()).expect("读档");
    assert_eq!(loaded.state, w.state, "地图没变时读档不改动任何状态");
}

#[test]
fn fleet_on_new_land_is_rerouted_to_its_original_destination() {
    let defs = calm();
    let (w, f) = underway(defs.clone(), 7);
    let v = voyage(&w, f);
    let cur = v.path[v.step];
    // 所在格与其后的三格（跳过地点所在格）变成陆地
    let land = off_locations(&defs, &v.path[v.step..v.path.len() - 1], 4);
    assert!(land.contains(&cur));
    let altered = reshaped(&defs, &land, None);
    let snapshot = w.state.clone();
    let loaded = World::from_snapshot(altered.clone(), snapshot.clone()).expect("读档");
    assert_route_valid(&loaded, f, BETA);
    let nv = voyage(&loaded, f);
    assert_eq!((nv.step, nv.leg_progress), (0, Fx::ZERO), "新航路从头开始");
    // 起点是离原所在格最近、且与目的地连通的海格
    let reach = altered.map.reachable_from(altered.loc(BETA).cell);
    assert_eq!(Some(nv.path[0]), altered.map.nearest_cell(cur, |i| reach[i]));
    assert_ne!(nv.path[0], cur);
    check_invariants(&loaded).unwrap_or_else(|e| panic!("{e}"));
    // 同一存档读两次结果相同（确定性）
    let again = World::from_snapshot(altered.clone(), snapshot.clone()).expect("读档");
    assert_eq!(again.state, loaded.state);
    assert_eq!(again.state_hash(), loaded.state_hash());
    // 继续运行：次日改驶 gamma。按日志重放与直接运行一致，舰队最终抵达
    let day = loaded.day();
    let log = vec![LogEntry {
        minute: None,
        tick: day + 1,
        seq: 0,
        source: Source::Player,
        command: Command::SetSail { owner: P, fleet: f, dest: GAMMA },
    }];
    let mut direct = loaded;
    direct.end_day().unwrap();
    log[0].command.apply(&mut direct).expect("读档修正后可以在海上改驶");
    for _ in 0..10 {
        direct.end_day().unwrap();
        check_invariants(&direct).unwrap_or_else(|e| panic!("{e}"));
    }
    let mut replayed = World::from_snapshot(altered.clone(), snapshot).expect("读档");
    replay_onto(&mut replayed, &log, direct.day()).unwrap();
    assert_eq!(replayed.state_hash(), direct.state_hash(), "读档修正后按日志重放一致");
    advance_until_docked(&mut direct, f, GAMMA);
}

#[test]
fn fleet_cut_off_in_a_new_lagoon_moves_to_connected_water() {
    let defs = calm();
    let (mut w, f) = underway(defs.clone(), 11);
    // 让舰队在开阔海面上航行：从 (5, 3) 驶向 beta，当前在航路第 2 格
    let start = Cell::new(5, 3);
    let path = defs.nav.find_path(&defs.map, &defs.regions, 0, start, defs.loc(BETA).cell).expect("有路").cells;
    let fleet = w.state.fleets.get_mut(&f).unwrap();
    fleet.location = FleetLocation::AtSea(Voyage::Route(manifest_core::world::RouteVoyage {
        dest: BETA,
        path: path.clone(),
        step: 2,
        leg_progress: Fx(3_000),
    }));
    let cur = path[2];
    // 当前格仍是海，但四周八格变成陆地：成了与外海不连通的潟湖
    let ring: Vec<Cell> = manifest_core::nav::DIRS
        .iter()
        .map(|(dx, dy)| Cell::new((cur.x as i32 + dx) as u16, (cur.y as i32 + dy) as u16))
        .collect();
    let altered = reshaped(&defs, &ring, None);
    assert!(altered.map.is_sea(cur));
    let loaded = World::from_snapshot(altered.clone(), w.state.clone()).expect("读档");
    assert_route_valid(&loaded, f, BETA);
    let nv = voyage(&loaded, f);
    assert_ne!(nv.path[0], cur, "离开潟湖");
    let reach = altered.map.reachable_from(altered.loc(BETA).cell);
    assert!(reach[altered.map.idx(nv.path[0])], "新起点与目的地连通");
    assert_eq!(Some(nv.path[0]), altered.map.nearest_cell(cur, |i| reach[i]));
    check_invariants(&loaded).unwrap_or_else(|e| panic!("{e}"));
    let mut loaded = loaded;
    advance_until_docked(&mut loaded, f, BETA);
}

#[test]
fn moved_destination_is_sailed_to_at_its_new_anchorage() {
    let defs = calm();
    let (w, f) = underway(defs.clone(), 5);
    let old = defs.loc(BETA).cell;
    // beta 的停泊格挪到岛东岸的另一格（仍与陆地相邻），航路上的格子都还是海
    let new_cell = Cell::new(25, 14);
    assert!(defs.map.is_sea(new_cell) && defs.map.touches_land(new_cell) && new_cell != old);
    let altered = reshaped(&defs, &[], Some((BETA, new_cell)));
    let loaded = World::from_snapshot(altered.clone(), w.state.clone()).expect("读档");
    assert_route_valid(&loaded, f, BETA);
    assert_eq!(voyage(&loaded, f).path.last(), Some(&new_cell));
    // 所在格仍是海：从原所在格出发
    let v = voyage(&w, f);
    assert_eq!(voyage(&loaded, f).path[0], v.path[v.step]);
    let mut loaded = loaded;
    advance_until_docked(&mut loaded, f, BETA);
    assert_eq!(loaded.fleet(f).unwrap().cell(&loaded.defs), new_cell);
}

#[test]
fn npc_fleets_at_sea_are_corrected_too() {
    let defs = calm();
    let mut w = World::new(defs.clone(), ScenarioId(0), 21).expect("开局");
    // 推进到有商会舰队在海上
    let mut npc = None;
    for _ in 0..60 {
        w.end_day().unwrap();
        npc = w
            .state
            .fleets
            .values()
            .find(|f| f.owner != P && matches!(f.location, FleetLocation::AtSea(_)))
            .map(|f| f.id);
        if let Some(id) = npc
            && voyage(&w, id).path.len() > voyage(&w, id).step + 3
        {
            break;
        }
    }
    let id = npc.expect("商会舰队出海");
    let v = voyage(&w, id);
    let land = off_locations(&defs, &v.path[v.step..v.path.len() - 1], 3);
    assert!(!land.is_empty());
    let altered = reshaped(&defs, &land, None);
    let loaded = World::from_snapshot(altered, w.state.clone()).expect("读档");
    assert_route_valid(&loaded, id, v.dest);
    check_invariants(&loaded).unwrap_or_else(|e| panic!("{e}"));
    let mut loaded = loaded;
    for _ in 0..30 {
        loaded.end_day().unwrap();
        check_invariants(&loaded).unwrap_or_else(|e| panic!("{e}"));
    }
}

#[test]
fn stranded_pirates_return_to_the_nearest_sea() {
    let defs = calm();
    let mut w = World::new(defs.clone(), ScenarioId(0), 9).expect("开局");
    let pirate = |id: u32, region: u16, cell: Cell| PirateFleet {
        id,
        region: RegionId(region),
        cell,
        ships: vec![manifest_core::fleet::new_ship(&defs, ShipTypeId(0))],
        crew: 10,
        until: 400,
        engaged: false,
    };
    // 1 号在西海 (5, 5)，2 号在东海 (30, 20)，3 号本来就在海上 (8, 18)
    for (id, region, cell) in [(1, 0, Cell::new(5, 5)), (2, 1, Cell::new(30, 20)), (3, 0, Cell::new(8, 18))] {
        w.state.battles.pirates.insert(id, pirate(id, region, cell));
    }
    w.state.battles.next_pirate = 4;
    let snapshot = w.state.clone();
    // (5, 5) 与 (30, 20) 变成陆地
    let altered = reshaped(&defs, &[Cell::new(5, 5), Cell::new(30, 20)], None);
    let loaded = World::from_snapshot(altered.clone(), snapshot.clone()).expect("读档");
    let p = &loaded.state.battles.pirates;
    assert_eq!(p[&1].cell, altered.map.nearest_cell(Cell::new(5, 5), |i| altered.map.region[i] == 0).unwrap());
    assert_eq!(p[&1].region, RegionId(0), "优先留在本海区");
    assert_eq!(p[&2].region, RegionId(1));
    assert!(altered.map.is_sea(p[&2].cell));
    assert_eq!(p[&3], snapshot.battles.pirates[&3], "本来就在海上的海盗不动");
    check_invariants(&loaded).unwrap_or_else(|e| panic!("{e}"));

    // 本海区已没有海格：取任意海区的最近海格，并改属该海区
    let mut merged = (*altered).clone();
    for r in merged.map.region.iter_mut() {
        if *r == 1 {
            *r = 0;
        }
    }
    let merged = Arc::new(merged);
    let loaded = World::from_snapshot(merged.clone(), snapshot).expect("读档");
    let p2 = &loaded.state.battles.pirates[&2];
    assert!(merged.map.is_sea(p2.cell));
    assert_eq!(p2.region, RegionId(0), "改属最近海格所在的海区");
    let mut loaded = loaded;
    for _ in 0..10 {
        loaded.end_day().unwrap();
        check_invariants(&loaded).unwrap_or_else(|e| panic!("{e}"));
    }
}

#[test]
fn invariants_catch_a_voyage_over_land() {
    let defs = calm();
    let (mut w, f) = underway(defs.clone(), 13);
    let v = voyage(&w, f);
    let bad = off_locations(&defs, &v.path[v.step + 1..v.path.len() - 1], 1);
    let altered = reshaped(&defs, &bad, None);
    // 不经读档修正、直接把状态放到改过的地图上：不变量检查应发现航路穿过陆地
    w.defs = altered;
    let msg = check_invariants(&w).unwrap_err();
    assert!(msg.contains("非海格"), "{msg}");
}
