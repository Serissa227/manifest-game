//! 分钟投影的接触去重与快照边界。
use super::*;
use crate::world::RouteVoyage;
use crate::*;
use std::sync::Arc;

fn sailing_world() -> (World, FleetId) {
    let mut defs = (*testkit::tiny_defs()).clone();
    defs.manual_navigation = true;
    defs.map.terrain.fill(crate::nav::Terrain::Deep);
    defs.map.region.fill(u16::MAX);
    defs.locations[0].cell = Cell::new(2, 15);
    defs.locations[1].cell = Cell::new(35, 15);
    defs.rules.explore.sight = 1;
    defs.rules.pirates.spawn_scale = Fx::ZERO;
    defs.ships[0].speed = Fx::from_int(120);
    defs.nav = Arc::new(crate::nav::NavTable::build(&defs.map, &defs.regions, defs.locations.len(), &[]));
    let mut world = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
    world.state.explore.cells.fill(u64::MAX);
    let player = world.fleets_of(OwnerId::Player).next().unwrap().id;
    let other = world.state.fleets.values().find(|f| f.owner != OwnerId::Player).unwrap().id;
    world.fleet_mut(other).unwrap().location = FleetLocation::AtSea(Voyage::Route(RouteVoyage {
        dest: LocId(1),
        path: (7..=35).map(|x| Cell::new(x, 15)).collect(),
        step: 0,
        leg_progress: Fx::ZERO,
    }));
    Command::Depart { owner: OwnerId::Player, fleet: player, minute: 0, heading: 90 }.apply_at(&mut world, 0).unwrap();
    (world, player)
}

#[test]
fn ships_on_charted_water_are_seen_once_and_projection_splits_keep_exact_results() {
    let (world, player) = sailing_world();
    let before = world.state.clone();
    let course = world.preview_course(player, &[], 0).unwrap();
    let contact = course.contacts.first().expect("已知海域里的船也必须触发发现");
    let minute = contact.minute;
    assert!(minute > 0 && minute + 2 < 1440);
    assert!(course.stops.iter().any(|s| s.minute == minute && s.kind == StopKind::Sight && s.loc.is_none()));
    assert_eq!(world.state, before);
    let first = world.navigation_projection(minute).unwrap();
    assert_eq!(first.state.navigation.traces[&player].contacts.len(), 1);
    let split = first.navigation_projection(minute + 2).unwrap();
    let direct = world.navigation_projection(minute + 2).unwrap();
    assert_eq!(split.state, direct.state);
    assert_eq!(split.state.navigation.traces[&player].contacts.len(), 1);
    assert_eq!(World::from_snapshot(split.defs.clone(), split.state.clone()).unwrap().state, split.state);
    for change in 0..5 {
        let mut bad = split.state.clone();
        match change {
            0 => bad.navigation.traces.get_mut(&player).unwrap().points[0].minute = 1,
            1 => bad.navigation.traces.get_mut(&player).unwrap().contacts[0].minute = 1440,
            2 => bad.navigation.settled = bad.navigation.minute + 1,
            3 => bad.navigation.traces.get_mut(&player).unwrap().points[0].pos.x = -1,
            _ => {
                bad.navigation.traces.get_mut(&player).unwrap().points[0].pos.x =
                    i64::from(split.defs.map.width) * SubCell::SCALE;
            }
        }
        assert!(World::from_snapshot(split.defs.clone(), bad).is_err());
    }
}

#[test]
fn splitting_a_projection_does_not_reorder_location_discovery_logs() {
    let (mut world, player) = sailing_world();
    let mut defs = (*world.defs).clone();
    defs.locations[2].cell = Cell::new(6, 14);
    defs.locations[1].cell = Cell::new(9, 14);
    world.defs = Arc::new(defs);
    world.state.explore.cells.fill(0);
    world.state.explore.visited.clear();
    world.state.explore.sighted.clear();
    let course = world.preview_course(player, &[], 0).unwrap();
    let first = course.stops.iter().find(|s| s.kind == StopKind::Sight && s.loc == Some(LocId(2))).unwrap().minute;
    let last = course.stops.iter().find(|s| s.kind == StopKind::Sight && s.loc == Some(LocId(1))).unwrap().minute;
    assert!(first < last);
    let split = world.navigation_projection(first).unwrap().navigation_projection(last).unwrap();
    let direct = world.navigation_projection(last).unwrap();
    assert_eq!(split.state, direct.state);
}

#[test]
fn minute_history_survives_a_coast_update_and_relocation_is_idempotent() {
    let (world, player) = sailing_world();
    let world = world.navigation_projection(45).unwrap();
    let old_cell = world.fleet(player).unwrap().cell(&world.defs);
    let mut defs = (*world.defs).clone();
    let index = defs.map.idx(old_cell);
    defs.map.terrain[index] = crate::nav::Terrain::Land;
    let defs = Arc::new(defs);
    let loaded = World::from_snapshot(defs.clone(), world.state.clone()).unwrap();
    let relocated = loaded.fleet(player).unwrap().cell(&defs);
    assert_ne!(relocated, old_cell);
    assert!(defs.map.is_sea_in_bounds(relocated));
    // 航迹记的是旧地图上的历史；它不能阻止已有的船位迁移机制。
    assert_eq!(loaded.state.navigation.traces[&player], world.state.navigation.traces[&player]);
    let before = loaded.state.clone();
    let course = loaded.preview_course(player, &[], 45).unwrap();
    assert_eq!(course.points.first().unwrap().pos, SubCell::center(relocated));
    assert!(course.points.iter().all(|p| defs.map.is_sea_in_bounds(p.pos.cell())));
    assert_eq!(loaded.state, before);
    assert_eq!(World::from_snapshot(defs, loaded.state.clone()).unwrap().state, loaded.state);
}

#[test]
fn departing_again_after_arrival_allows_a_new_steering_preview() {
    let (mut world, player) = sailing_world();
    let arrival = world.preview_course(player, &[], 0).unwrap();
    let minute = arrival.stops.iter().find(|s| s.kind == StopKind::Port).unwrap().minute;
    world = world.navigation_projection(minute).unwrap();
    assert_eq!(world.fleet(player).unwrap().docked_at(), Some(LocId(1)));
    Command::Depart { owner: OwnerId::Player, fleet: player, minute, heading: 270 }
        .apply_at(&mut world, minute)
        .unwrap();
    let steering = Steering { minute, heading: Some(270), sail: Some(Sail::Full) };
    let preview = world.preview_course(player, &[steering], minute).unwrap();
    assert!(preview.points.iter().any(|p| p.pos.x < SubCell::center(world.defs.loc(LocId(1)).cell).x));
    Command::Steer { owner: OwnerId::Player, fleet: player, minute, heading: steering.heading, sail: steering.sail }
        .apply_at(&mut world, minute)
        .unwrap();
    assert_eq!(world.preview_course(player, &[], minute).unwrap(), preview);
    let loaded = World::from_snapshot(world.defs.clone(), world.state.clone()).unwrap();
    assert_eq!(loaded.preview_course(player, &[], minute).unwrap(), preview);
}

#[test]
fn a_saved_coastal_stop_can_turn_and_sail_back_into_open_water() {
    let (mut world, player) = sailing_world();
    let defs = Arc::make_mut(&mut world.defs);
    let land = defs.map.idx(Cell::new(5, 15));
    defs.map.terrain[land] = crate::nav::Terrain::Land;
    let course = world.preview_course(player, &[], 0).unwrap();
    let minute = course.stops.iter().find(|s| s.kind == StopKind::Land).unwrap().minute;
    world = world.navigation_projection(minute).unwrap();
    let coast = world.fleet(player).unwrap().cell(&world.defs);
    assert!(world.defs.map.is_sea_in_bounds(coast));
    let mut loaded = World::from_snapshot(world.defs.clone(), world.state.clone()).unwrap();
    Command::Steer { owner: OwnerId::Player, fleet: player, minute, heading: Some(270), sail: Some(Sail::Full) }
        .apply_at(&mut loaded, minute)
        .unwrap();
    let preview = loaded.preview_course(player, &[], minute).unwrap();
    assert!(preview.points.iter().all(|p| loaded.defs.map.is_sea_in_bounds(p.pos.cell())));
    assert!(preview.points.iter().any(|p| p.pos.cell().x < coast.x));
    assert_eq!(preview.arrival, Some(LocId(0)));
}
