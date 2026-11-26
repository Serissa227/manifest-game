use super::*;
use crate::{Command, FleetId, Fx, OwnerId, ScenarioId, testkit};
use std::sync::Arc;

fn world() -> (World, FleetId) {
    let mut defs = (*testkit::tiny_defs()).clone();
    defs.manual_navigation = true;
    defs.map.terrain.fill(crate::nav::Terrain::Deep);
    defs.locations[0].cell = Cell::new(2, 15);
    defs.locations[1].cell = Cell::new(8, 15);
    defs.rules.pirates.spawn_scale = Fx::ZERO;
    defs.rules.explore.sight = 0;
    for r in &mut defs.regions {
        for s in &mut r.seasons {
            s.wind_strength = 0;
            s.current_strength = 0;
        }
    }
    let mut w = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
    w.state.explore.cells.fill(0);
    w.state.explore.visited.clear();
    w.state.explore.sighted.clear();
    let id = w.fleets_of(OwnerId::Player).next().unwrap().id;
    w.fleet_mut(id).unwrap().ships.iter_mut().for_each(|s| s.speed_bonus = Fx::from_int(20));
    (w, id)
}
fn reveal(w: &mut World, cell: Cell) {
    w.reveal_around(cell, 0);
}

#[test]
fn batched_destinations_keep_independent_paths_after_unreachable_and_repeated_queries() {
    let (mut w, _) = world();
    let mut destinations: Vec<_> = w.defs.loc_ids().collect();
    destinations.extend([LocId(u16::MAX), LocId(1), LocId(0), LocId(1)]);
    for full in [false, true] {
        if full {
            w.state.explore.cells.fill(u64::MAX);
        } else {
            for x in [2, 3, 4, 8] {
                reveal(&mut w, Cell::new(x, 15));
            }
        }
        for wrap in [false, true] {
            Arc::make_mut(&mut w.defs).map.wrap_x = wrap;
            for edge in [false, true] {
                let before = w.state_hash();
                let batch = w.known_sea_paths(Cell::new(2, 15), &destinations, edge);
                for (dest, actual) in destinations.iter().zip(batch) {
                    let expected = w.known_sea_path(Cell::new(2, 15), *dest, edge);
                    assert_eq!(actual.map_err(|e| e.code()), expected.map_err(|e| e.code()));
                }
                assert_eq!(w.state_hash(), before);
            }
        }
    }
}

#[test]
fn bootstrap_without_player_assets_does_not_consume_first_sighting_rewards() {
    let (mut w, _) = world();
    reveal(&mut w, Cell::new(2, 15));
    let player = w.state.agents.remove(&OwnerId::Player).unwrap();
    let before = w.state.clone();
    w.record_sighted_locations();
    assert_eq!(w.state, before);
    let fame = player.fame;
    w.state.agents.insert(OwnerId::Player, player);
    w.record_sighted_locations();
    assert_eq!(w.agent(OwnerId::Player).unwrap().fame, fame + 1);
    assert_eq!(w.state.explore.sighted, std::collections::BTreeSet::from([LocId(0)]));
}
fn command(fleet: FleetId, edge: bool) -> Command {
    Command::Autopilot {
        owner: OwnerId::Player,
        fleet,
        dest: LocId(1),
        minute: 0,
        stop_at_known_edge: edge,
        route: None,
    }
}

#[test]
fn unknown_destination_and_unknown_route_are_atomic_rejections() {
    let (mut w, id) = world();
    reveal(&mut w, Cell::new(2, 15));
    let before = w.state.clone();
    assert_eq!(command(id, false).apply(&mut w).unwrap_err().code(), "navigation.unknown_dest");
    assert_eq!(before, w.state);
    reveal(&mut w, Cell::new(8, 15));
    let before = w.state.clone();
    assert_eq!(command(id, false).apply(&mut w).unwrap_err().code(), "navigation.unknown_route");
    assert_eq!(before, w.state);
}

#[test]
fn known_edge_stops_without_entering_fog_and_roundtrips() {
    let (mut w, id) = world();
    for x in [2, 3, 4, 8] {
        reveal(&mut w, Cell::new(x, 15));
    }
    command(id, true).apply(&mut w).unwrap();
    let saved = serde_json::to_string(&w.state).unwrap();
    let loaded = World::from_snapshot(w.defs.clone(), serde_json::from_str(&saved).unwrap()).unwrap();
    let course = w.preview_course(id, &[], 0).unwrap();
    assert_eq!(course, loaded.preview_course(id, &[], 0).unwrap());
    assert_eq!(course.voyage.pos, SubCell::center(Cell::new(4, 15)));
    assert_eq!(course.voyage.sail, Sail::Furled);
    assert!(course.points.iter().all(|p| w.state.explore.is_revealed(w.defs.map.idx(p.pos.cell()))));
    assert!(course.stops.iter().any(|s| s.kind == StopKind::Land));
}

#[test]
fn path_avoids_unknown_diagonal_corners_and_wraps_deterministically() {
    let (mut w, _) = world();
    for c in [Cell::new(2, 15), Cell::new(3, 14), Cell::new(8, 15)] {
        reveal(&mut w, c);
    }
    let path = w.known_sea_path(Cell::new(2, 15), LocId(1), true).unwrap();
    assert_eq!(path.path, [Cell::new(2, 15)]);
    let mut defs = (*w.defs).clone();
    defs.map.wrap_x = true;
    defs.locations[1].cell = Cell::new(defs.map.width - 1, 15);
    w.defs = Arc::new(defs);
    let end = w.defs.loc(LocId(1)).cell;
    reveal(&mut w, Cell::new(0, 15));
    reveal(&mut w, end);
    assert_eq!(w.known_sea_path(Cell::new(0, 15), LocId(1), false).unwrap().path, [Cell::new(0, 15), end]);
}

#[test]
fn autopilot_already_at_destination_docks_instead_of_reporting_land() {
    let (mut w, id) = world();
    reveal(&mut w, Cell::new(8, 15));
    w.fleet_mut(id).unwrap().location =
        FleetLocation::AtSea(Voyage::Manual { manual: ManualVoyage::new(Cell::new(8, 15), 90) });
    command(id, false).apply(&mut w).unwrap();
    let course = w.preview_course(id, &[], 0).unwrap();
    assert_eq!(course.arrival, Some(LocId(1)));
    assert_eq!(course.stops.first().unwrap().kind, StopKind::Port);
}

#[test]
fn saved_pilot_cannot_claim_a_different_destination_or_skip_its_entire_path() {
    let (mut w, id) = world();
    for x in 2..=8 {
        reveal(&mut w, Cell::new(x, 15));
    }
    command(id, false).apply(&mut w).unwrap();
    let mut bad = w.state.clone();
    let order = &mut bad.navigation.pending.get_mut(&id).unwrap().autopilots[0];
    order.dest = LocId(0);
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
    let mut bad = w.state.clone();
    let pilot = &mut bad.navigation.pending.get_mut(&id).unwrap().autopilots[0].pilot;
    pilot.step = pilot.path.len();
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
}

#[test]
fn same_minute_orders_preserve_log_order_and_cancel_only_from_that_minute() {
    let (mut w, id) = world();
    for x in 2..=8 {
        reveal(&mut w, Cell::new(x, 15));
    }
    command(id, false).apply(&mut w).unwrap();
    let before = w.preview_course(id, &[], 0).unwrap();
    Command::Steer { owner: OwnerId::Player, fleet: id, minute: 1, heading: None, sail: Some(Sail::Furled) }
        .apply(&mut w)
        .unwrap();
    let after = w.preview_course(id, &[], 0).unwrap();
    assert_eq!(before.points[..=1], after.points[..=1]);
    assert!(after.voyage.autopilot.is_none());
    assert!(after.points[1..].iter().all(|p| p.pos == after.points[1].pos));
    Command::Autopilot {
        owner: OwnerId::Player,
        fleet: id,
        dest: LocId(1),
        minute: 1,
        stop_at_known_edge: false,
        route: None,
    }
    .apply(&mut w)
    .unwrap();
    assert_ne!(w.preview_course(id, &[], 0).unwrap().points[2].pos, after.points[2].pos);
}

#[test]
fn sighting_and_chart_visibility_do_not_unlock_market_or_repeat_fame() {
    let (mut w, _) = world();
    assert!(!w.location_visible(LocId(1)));
    reveal(&mut w, Cell::new(8, 15));
    assert!(w.location_visible(LocId(1)));
    assert!(!w.loc_known(LocId(1)));
    let fame = w.agent(OwnerId::Player).unwrap().fame;
    w.record_sighted_locations();
    assert_eq!(w.agent(OwnerId::Player).unwrap().fame, fame + 1);
    w.record_sighted_locations();
    assert_eq!(w.agent(OwnerId::Player).unwrap().fame, fame + 1);
    assert!(w.state.explore.sighted.contains(&LocId(1)));
}

#[test]
fn autopilot_passes_intermediate_anchors_and_arrives_at_its_requested_destination() {
    let (mut w, id) = world();
    let mut defs = (*w.defs).clone();
    assert!(defs.locations[2].is_port());
    defs.locations[2].cell = Cell::new(5, 15);
    w.defs = Arc::new(defs);
    for x in 2..=8 {
        reveal(&mut w, Cell::new(x, 15));
    }
    command(id, false).apply(&mut w).unwrap();
    let course = w.preview_course(id, &[], 0).unwrap();
    assert!(course.points.iter().any(|p| p.pos.cell() == Cell::new(5, 15)));
    assert_eq!(course.arrival, Some(LocId(1)));
    assert!(course.stops.iter().filter(|s| s.kind == StopKind::Port).all(|s| s.loc == Some(LocId(1))));
}

#[test]
fn bounded_pause_prediction_matches_full_day_at_each_minute_including_arrival() {
    let (mut world, fleet) = world();
    for x in 2..=8 {
        reveal(&mut world, Cell::new(x, 15));
    }
    command(fleet, false).apply(&mut world).unwrap();
    let before = world.state.clone();
    let full = world.preview_course(fleet, &[], 0).unwrap();
    let arrival = full.stops.iter().find(|s| s.kind == StopKind::Port).unwrap().minute;
    for end in (0..=1440).step_by(19).chain([arrival - 1, arrival, arrival + 1, 1440]) {
        let bounded = world.preview_course_until(fleet, &[], 0, end).unwrap();
        let points: Vec<_> = full.points.iter().filter(|p| p.minute <= end).copied().collect();
        let stops: Vec<_> = full.stops.iter().filter(|s| s.minute <= end).cloned().collect();
        assert_eq!(bounded.points, points, "结束分钟 {end}");
        assert_eq!(bounded.stops, stops, "结束分钟 {end}");
        assert_eq!(bounded.voyage.pos, points.last().unwrap().pos);
    }
    assert_eq!(world.state, before);
    let world = world.navigation_projection(arrival / 2).unwrap();
    for end in [arrival / 2, arrival - 1, arrival, 1440] {
        let full = world.preview_course(fleet, &[], 0).unwrap();
        let bounded = world.preview_course_until(fleet, &[], arrival / 2, end).unwrap();
        assert_eq!(
            bounded.points,
            full.points.into_iter().filter(|p| p.minute >= arrival / 2 && p.minute <= end).collect::<Vec<_>>()
        );
        assert_eq!(
            bounded.stops,
            full.stops.into_iter().filter(|s| s.minute >= arrival / 2 && s.minute <= end).collect::<Vec<_>>()
        );
    }
}
