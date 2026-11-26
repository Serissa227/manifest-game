//! 环绕地图上的实际玩法边界；通过日结入口验证探索、海盗与人物出没。

use super::*;
use crate::battle::PirateFleet;
use crate::testkit::ruins_defs;
use crate::world::{FleetLocation, Voyage};
use crate::{Command, DiscoveryId, FleetId, OwnerId, ScenarioId, StaticData, World};
use std::sync::Arc;

fn defs(wrap_x: bool) -> StaticData {
    let mut defs = (*ruins_defs()).clone();
    defs.map = SeaMap { width: 120, height: 60, wrap_x, terrain: vec![Terrain::Deep; 7200], region: vec![1; 7200] };
    defs.regions[0].rect = (115, 0, 4, 59);
    defs.regions[1].rect = (5, 0, 114, 59);
    for cell in defs.map.topology().rect_cells(defs.regions[0].rect) {
        let idx = defs.map.idx(cell);
        defs.map.region[idx] = 0;
    }
    for loc in &mut defs.locations {
        loc.cell = Cell::new(60, 30);
    }
    defs.locations[0].cell = Cell::new(0, 30);
    let site = defs.site_ids().next().unwrap();
    defs.locations[site.idx()].cell = Cell::new(119, 30);
    defs.discoveries[0].cell = Cell::new(119, 30);
    defs.rules.explore.sight = 2;
    defs.rules.colony.claim_reach = 2;
    defs.rules.pirates.spawn_scale = Fx::ZERO;
    defs.rules.pirates.speed = 0;
    let ports = defs.port_ids().map(|l| (l, defs.loc(l).cell)).collect::<Vec<_>>();
    defs.nav = Arc::new(NavTable::build(&defs.map, &defs.regions, defs.locations.len(), &ports));
    defs
}

fn world(wrap_x: bool) -> World {
    World::new(Arc::new(defs(wrap_x)), ScenarioId(0), 13).unwrap()
}

fn at_sea(world: &mut World, cell: Cell) -> FleetId {
    let id = world.fleets_of(OwnerId::Player).next().unwrap().id;
    world.state.fleets.get_mut(&id).unwrap().location =
        FleetLocation::AtSea(Voyage::Route(crate::world::RouteVoyage {
            dest: LocId(1),
            path: vec![cell, Cell::new(cell.x, cell.y + 1)],
            step: 0,
            leg_progress: Fx::ZERO,
        }));
    id
}

fn pirate(world: &mut World, cell: Cell) {
    let id = at_sea(world, Cell::new(0, 30));
    let fleet = world.fleet(id).unwrap();
    world.state.battles.pirates.insert(
        0,
        PirateFleet {
            id: 0,
            region: RegionId(0),
            cell,
            ships: fleet.ships.clone(),
            crew: fleet.crew,
            until: 100,
            engaged: false,
        },
    );
    world.state.battles.next_pirate = 1;
}

#[test]
fn wrapped_sea_steps_touch_land_and_nearest_cell_cross_the_seam() {
    let mut map = defs(true).map;
    let west = Cell::new(0, 30);
    let east = Cell::new(119, 30);
    assert_eq!(map.step(map.idx(west), 6), Some(map.idx(east)));
    assert_eq!(map.step(map.idx(east), 2), Some(map.idx(west)));
    assert_eq!(map.step(map.idx(Cell::new(0, 0)), 7), None);
    let east_idx = map.idx(east);
    map.terrain[east_idx] = Terrain::Land;
    assert!(map.touches_land(west));
    assert_eq!(map.nearest_cell(west, |i| i == east_idx), Some(east));
    let north_idx = map.idx(Cell::new(0, 29));
    map.terrain[north_idx] = Terrain::Land;
    assert_eq!(map.step(map.idx(west), 7), None, "接缝处也不能斜穿两个陆角");
    map.terrain[north_idx] = Terrain::Deep;
    assert_eq!(map.step(map.idx(west), 7), Some(map.idx(Cell::new(119, 29))));
}

#[test]
fn fog_discoveries_and_claim_reach_cross_the_seam_only_when_enabled() {
    for wrap_x in [false, true] {
        let mut world = world(wrap_x);
        world.explore_day();
        let target = world.defs.map.idx(Cell::new(119, 30));
        assert_eq!(world.state.explore.is_revealed(target), wrap_x);
        assert_eq!(world.state.explore.discovered.contains_key(&DiscoveryId(0)), wrap_x);
        let site = world.defs.site_ids().next().unwrap();
        assert_eq!(crate::colony::faction_reaches(&world.defs, world.defs.loc(LocId(0)).faction, site), wrap_x);
        world.state.explore.cells.fill(0);
        world.reveal_around(Cell::new(0, 0), 2);
        assert!(!world.state.explore.is_revealed(world.defs.map.idx(Cell::new(0, 59))), "南北不环绕");
        assert_eq!(world.state.explore.is_revealed(world.defs.map.idx(Cell::new(119, 1))), wrap_x);
    }
}

#[test]
fn discovery_rumor_search_finds_sea_across_the_seam() {
    for wrap_x in [false, true] {
        let mut defs = defs(wrap_x);
        defs.discoveries[0].cell = Cell::new(0, 30);
        defs.map.region.fill(u16::MAX);
        let index = defs.map.idx(Cell::new(119, 30));
        defs.map.region[index] = 0;
        assert_eq!(crate::explore::discovery_region(&defs, DiscoveryId(0)), wrap_x.then_some(RegionId(0)));
    }
}

#[test]
fn seam_chart_price_and_revealed_cells_match_its_true_area() {
    let mut world = world(true);
    world.state.explore.cells.fill(0);
    let rules = &world.defs.rules.explore;
    assert_eq!(world.chart_price(RegionId(0)), rules.chart_base + rules.chart_per_100_cells * 600 / 100);
    Command::BuyChart { owner: OwnerId::Player, region: RegionId(0) }.apply(&mut world).unwrap();
    assert_eq!(world.state.explore.revealed_count(), 600);
    for y in 0..60 {
        for x in 0..120 {
            assert_eq!(world.state.explore.is_revealed(world.defs.map.idx(Cell::new(x, y))), !(5..115).contains(&x));
        }
    }
}

#[test]
fn pirate_encounters_and_pursuit_use_wrapped_distance() {
    for wrap_x in [false, true] {
        let mut world = world(wrap_x);
        pirate(&mut world, Cell::new(119, 30));
        world.battle_day().unwrap();
        assert_eq!(!world.state.battles.pending.is_empty(), wrap_x);
    }
    let mut defs = defs(true);
    defs.rules.pirates.sight = 6;
    defs.rules.pirates.speed = 3;
    let mut world = World::new(Arc::new(defs), ScenarioId(0), 13).unwrap();
    pirate(&mut world, Cell::new(116, 30));
    world.battle_day().unwrap();
    assert!(!world.state.battles.pending.is_empty());
    assert_eq!(world.state.battles.pirates[&0].cell.x, 119);
}

#[test]
fn pirates_spawn_inside_a_seam_rectangle() {
    let mut defs = defs(true);
    defs.rules.pirates.spawn_scale = Fx::ONE;
    for season in &mut defs.regions[0].seasons {
        season.pirate_bp = 10000;
    }
    for season in &mut defs.regions[1].seasons {
        season.pirate_bp = 0;
    }
    let defs = Arc::new(defs);
    for seed in 0..32 {
        let mut world = World::new(defs.clone(), ScenarioId(0), seed).unwrap();
        world.battle_day().unwrap();
        assert!(!world.state.battles.pirates.is_empty());
        assert!(
            world
                .state
                .battles
                .pirates
                .values()
                .all(|p| defs.map.topology().rect_contains(defs.regions[0].rect, p.cell))
        );
    }
}

#[test]
fn narrow_wrapped_paths_keep_direction_and_cost_consistent() {
    for width in [1, 2] {
        let map = SeaMap {
            width,
            height: 4,
            wrap_x: true,
            terrain: vec![Terrain::Deep; width as usize * 4],
            region: vec![u16::MAX; width as usize * 4],
        };
        let grid = NavGrid::new(&map, &[]);
        let (from, to) = (Cell::new(0, 0), Cell::new(width - 1, 3));
        assert_eq!(map.find_path(&[], 0, from, to), grid.find_path(0, from, to));
        let path = grid.find_path(0, from, to).unwrap();
        assert_eq!(path.cost, path.time_ref.0);
    }
}

#[test]
fn fleet_motion_has_the_same_wind_and_progress_across_the_seam() {
    let mut defs = defs(true);
    defs.map.region.fill(0);
    for ship in &mut defs.ships {
        ship.speed = Fx::ONE;
    }
    let defs = Arc::new(defs);
    let mut outcomes = Vec::new();
    for start in [29, 119] {
        let mut world = World::new(defs.clone(), ScenarioId(0), 13).unwrap();
        let id = at_sea(&mut world, Cell::new(start, 30));
        let FleetLocation::AtSea(crate::world::Voyage::Route(v)) =
            &mut world.state.fleets.get_mut(&id).unwrap().location
        else {
            panic!("海上")
        };
        v.path = (0..6).map(|i| Cell::new((start + i) % 120, 30)).collect();
        world.move_fleets().unwrap();
        let FleetLocation::AtSea(crate::world::Voyage::Route(v)) = &world.fleet(id).unwrap().location else {
            panic!("尚未抵达")
        };
        outcomes.push((v.step, v.leg_progress));
    }
    assert_eq!(outcomes[0], outcomes[1]);
}
