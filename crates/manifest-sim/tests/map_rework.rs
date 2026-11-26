//! 第五批（EXPANSION §10.2）：用重做过的地图读档。建一局并存档，再把海上舰队与海盗的航路上的一些格子
//! 改成陆地后读档：单位被修正到合法的海上航路，世界不变量成立，读两次结果相同，之后按日志重放一致；
//! 旧版本（v1）样例存档在改过的地图上同样能读并继续运行。

mod common;

use manifest_core::StaticData;
use manifest_core::ids::{Cell, FleetId, ScenarioId};
use manifest_core::testkit::check_invariants;
use manifest_core::world::FleetLocation;
use manifest_sim::{Bot, BotKind, GameSession, storage};
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let p = e.path();
        let dest = to.join(e.file_name());
        if p.is_dir() {
            copy_dir(&p, &dest);
        } else {
            std::fs::copy(&p, &dest).unwrap();
        }
    }
}

/// 把字符网格文件中 (x, y) 的字符改为 `ch`（`//` 注释行与空行不计行号）；文件不存在时什么都不做。
fn set_cell(path: &Path, x: u16, y: u16, ch: char) {
    let Ok(text) = std::fs::read_to_string(path) else { return };
    let mut row = 0usize;
    let mut out = String::new();
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        if line.starts_with("//") || line.is_empty() {
            out.push_str(line);
        } else {
            if row == y as usize {
                out.extend(line.chars().enumerate().map(|(i, c)| if i == x as usize { ch } else { c }));
            } else {
                out.push_str(line);
            }
            row += 1;
        }
        out.push('\n');
    }
    std::fs::write(path, out).unwrap();
}

/// 复制正式数据，把给定的海格改成陆地（逐格图层存在时同步补上高程、植被，并清掉海区标记），然后加载。
fn reshaped_data(cells: &[Cell]) -> Arc<StaticData> {
    let tmp = tempfile::tempdir().unwrap();
    copy_dir(&manifest_data::find_data_dir().unwrap(), tmp.path());
    let world = tmp.path().join("world");
    for c in cells {
        set_cell(&world.join("map.txt"), c.x, c.y, '#');
        set_cell(&world.join("relief.txt"), c.x, c.y, '0');
        set_cell(&world.join("biomes.txt"), c.x, c.y, 'G');
        set_cell(&world.join("seas.txt"), c.x, c.y, '#');
    }
    manifest_data::load(tmp.path()).unwrap_or_else(|e| panic!("改过的地图应能通过校验：{e}"))
}

/// 开阔海面上的格子：八邻格都是海，且离任何地点、河流与地标都至少 3 格（改成陆地不会影响数据校验与航线连通）。
fn open_water(defs: &StaticData, c: Cell) -> bool {
    let map = &defs.map;
    let near = |a: Cell, b: Cell| (a.x as i64 - b.x as i64).abs().max((a.y as i64 - b.y as i64).abs()) <= 3;
    map.is_sea_in_bounds(c)
        && !map.touches_land(c)
        && defs.locations.iter().all(|l| !near(l.cell, c))
        && defs.geography.rivers.iter().flat_map(|r| r.path.iter()).all(|p| !near(*p, c))
        && defs.geography.landmarks.iter().all(|l| !near(l.cell, c))
}

/// 海上舰队剩余航路上（含所在格）可以改成陆地的格子，每支舰队至多 `per_fleet` 格。
fn blockers(defs: &StaticData, world: &manifest_core::World, per_fleet: usize) -> Vec<(FleetId, Vec<Cell>)> {
    world
        .state
        .fleets
        .values()
        .filter_map(|f| match &f.location {
            FleetLocation::AtSea(manifest_core::world::Voyage::Route(v)) => {
                let cells: Vec<Cell> = v.path[v.step..v.path.len().saturating_sub(1)]
                    .iter()
                    .copied()
                    .filter(|c| open_water(defs, *c))
                    .take(per_fleet)
                    .collect();
                (!cells.is_empty()).then_some((f.id, cells))
            }
            FleetLocation::Docked(_) => None,
            FleetLocation::AtSea(manifest_core::world::Voyage::Manual { .. }) => panic!("经典世界不应手动航行"),
        })
        .collect()
}

/// 航路合法：剩余航路都是海格、相邻两格相邻、终点是目的地的停泊格。
fn assert_routes_valid(world: &manifest_core::World) {
    let defs = &world.defs;
    for f in world.state.fleets.values() {
        let FleetLocation::AtSea(manifest_core::world::Voyage::Route(v)) = &f.location else { continue };
        let rest = &v.path[v.step..];
        assert!(rest.iter().all(|c| defs.map.is_sea_in_bounds(*c)), "舰队 {:?} 的航路经过陆地", f.id);
        for pair in rest.windows(2) {
            let d = (pair[0].x as i64 - pair[1].x as i64).abs().max((pair[0].y as i64 - pair[1].y as i64).abs());
            assert_eq!(d, 1, "舰队 {:?} 的航路不连续", f.id);
        }
        assert_eq!(v.path.last(), Some(&defs.loc(v.dest).cell), "舰队 {:?} 的航路终点是目的地", f.id);
    }
    for p in world.state.battles.pirates.values() {
        assert!(defs.map.is_sea_in_bounds(p.cell), "海盗 {} 停在陆地", p.id);
    }
}

#[test]
fn saved_game_loads_on_a_reshaped_map_and_replays_consistently() {
    let defs = common::defs();
    let mut s = GameSession::new(defs.clone(), ScenarioId(0), 42).unwrap();
    let mut bot = Bot::new(BotKind::Arbitrage);
    // 推进到至少两支舰队在开阔海面上航行（每天开头存档，当天还没有提交命令）
    let mut found = Vec::new();
    for _ in 0..200 {
        bot.act(&mut s);
        s.advance_day().unwrap();
        found = blockers(&defs, &s.world, 3);
        if found.len() >= 2 && s.day() >= 20 {
            break;
        }
    }
    assert!(found.len() >= 2, "应有至少两支舰队在开阔海面上航行");
    let mut land: Vec<Cell> = found.iter().flat_map(|(_, c)| c.iter().copied()).collect();
    // 海盗停在开阔海面上时，把它脚下也改成陆地
    let stranded: Vec<u32> = s
        .world
        .state
        .battles
        .pirates
        .values()
        .filter(|p| open_water(&defs, p.cell))
        .map(|p| {
            land.push(p.cell);
            p.id
        })
        .collect();
    land.sort_by_key(|c| (c.y, c.x));
    land.dedup();
    let save = s.to_save();
    let json = save.to_json().unwrap();
    let altered = reshaped_data(&land);
    assert_ne!(altered.meta.hash, defs.meta.hash);
    save.check_compatible(&altered).expect("只改地图，键表不变");

    let mut loaded = GameSession::from_save(altered.clone(), manifest_core::SaveFile::from_json(&json).unwrap())
        .expect("在改过的地图上读档");
    assert_routes_valid(&loaded.world);
    check_invariants(&loaded.world).unwrap_or_else(|e| panic!("{e}"));
    for (id, _) in &found {
        let before = &s.world.fleet(*id).unwrap().location;
        let after = &loaded.world.fleet(*id).unwrap().location;
        assert_ne!(before, after, "航路被截断的舰队 {id:?} 应重新寻路");
        if let (
            FleetLocation::AtSea(manifest_core::world::Voyage::Route(a)),
            FleetLocation::AtSea(manifest_core::world::Voyage::Route(b)),
        ) = (before, after)
        {
            assert_eq!(a.dest, b.dest, "仍驶向原目的地");
        }
    }
    for id in &stranded {
        assert_ne!(loaded.world.state.battles.pirates[id].cell, s.world.state.battles.pirates[id].cell);
    }
    // 读两次结果相同
    let second = GameSession::from_save(altered.clone(), manifest_core::SaveFile::from_json(&json).unwrap()).unwrap();
    assert_eq!(second.world.state, loaded.world.state, "读档修正是确定的");

    // 继续运行 60 天，再按日志从读档时刻重放
    for day in 0..60 {
        bot.act(&mut loaded);
        loaded.advance_day().unwrap();
        if day % 10 == 9 {
            check_invariants(&loaded.world).unwrap_or_else(|e| panic!("{e}"));
        }
    }
    let mut replayed = second.world;
    manifest_core::replay::replay_onto(&mut replayed, loaded.log(), loaded.day()).unwrap();
    assert_eq!(replayed.state_hash(), loaded.world.state_hash(), "读档后按日志重放一致");
    // 再存一次、读回（地图不变，不再修正），状态一致
    let again = storage::decode(&storage::encode(&loaded.to_save(), true).unwrap()).unwrap();
    let reloaded = GameSession::from_save(altered, again).unwrap();
    assert_eq!(reloaded.world.state, loaded.world.state);
}

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join("save_v1.mfsave.zst")
}

#[test]
fn legacy_v1_save_loads_on_a_reshaped_map() {
    let bytes = std::fs::read(fixture()).expect("缺少样例存档");
    let defs = common::defs();
    // 先在正式数据上读出，找到海上舰队的航路
    let plain = GameSession::from_save(defs.clone(), storage::decode(&bytes).unwrap()).unwrap();
    let found = blockers(&defs, &plain.world, 2);
    assert!(!found.is_empty(), "样例存档中应有在开阔海面上航行的舰队");
    let land: Vec<Cell> = found.iter().flat_map(|(_, c)| c.iter().copied()).collect();
    let altered = reshaped_data(&land);
    let mut session =
        GameSession::from_save(altered, storage::decode(&bytes).unwrap()).expect("v1 存档在改过的地图上读档");
    assert_eq!(session.day(), 20);
    assert_routes_valid(&session.world);
    check_invariants(&session.world).unwrap_or_else(|e| panic!("{e}"));
    for (id, _) in &found {
        assert_ne!(
            plain.world.fleet(*id).unwrap().location,
            session.world.fleet(*id).unwrap().location,
            "航路被截断的舰队 {id:?} 应重新寻路"
        );
    }
    for _ in 0..30 {
        session.advance_day().unwrap();
    }
    assert_eq!(session.day(), 50);
    check_invariants(&session.world).unwrap_or_else(|e| panic!("{e}"));
}
