//! 借用分支必须与原来的完整投影逐字节相同，不能漏掉分钟、航迹和可见性。
use super::*;
use crate::state::Game;
use manifest_core::{Command, OwnerId, ScenarioId};
use std::{borrow::Cow, sync::Arc};

fn game(manual: bool) -> Game {
    let mut defs = (*manifest_core::testkit::tiny_defs()).clone();
    defs.manual_navigation = manual;
    Game {
        session: manifest_sim::GameSession::new(Arc::new(defs), ScenarioId(0), 42).unwrap(),
        ai: None,
        speed: 0,
        resume_speed: None,
        run_speed: crate::settings::NORMAL_SPEED,
        last_autosave: 0,
        captain: None,
        minute: DAY_START_MINUTE,
        last_navigation_stop: None,
        book: Default::default(),
        notes: Default::default(),
        clock_speeds: Default::default(),
        upbringing_unlock_notices: Default::default(),
    }
}

fn compare(game: &Game) {
    let world = &game.session.world;
    let before = world.state.clone();
    let minute = (since_day_start(game.minute) as u16).max(world.state.navigation.settled);
    let original = world.navigation_projection(minute).unwrap();
    let projected = game.view_world();
    assert_eq!(serde_json::to_vec(&projected.state).unwrap(), serde_json::to_vec(&original.state).unwrap());
    assert_eq!(projected.state_hash(), original.state_hash());
    assert_eq!(world.state, before);
}

#[test]
fn docked_identity_projection_borrows_without_changing_any_state() {
    let mut game = game(true);
    for (minute, settled, recorded) in [(360, 0, 0), (360, 0, 120), (960, 720, 800)] {
        game.minute = minute;
        game.session.world.state.navigation.settled = settled;
        game.session.world.state.navigation.minute = recorded;
        assert!(matches!(game.view_world(), Cow::Borrowed(_)));
        compare(&game);
    }
}

#[test]
fn advancing_docked_clock_keeps_the_projected_minute_and_watermark() {
    let mut game = game(true);
    for minute in [0, 1, 359, 361, 720, 1439] {
        game.minute = minute;
        assert!(matches!(game.view_world(), Cow::Owned(_)));
        compare(&game);
    }
    game.minute = DAY_START_MINUTE;
    game.session.world.state.navigation.settled = 120;
    game.session.world.state.navigation.minute = 0;
    assert!(matches!(game.view_world(), Cow::Owned(_)));
    compare(&game);
}

#[test]
fn manual_voyage_still_projects_even_at_the_current_watermark() {
    let mut game = game(true);
    let fleet = game.session.world.fleets_of(OwnerId::Player).next().unwrap().id;
    Command::Depart { owner: OwnerId::Player, fleet, minute: 0, heading: 90 }.apply(&mut game.session.world).unwrap();
    for minute in [DAY_START_MINUTE, DAY_START_MINUTE + 60] {
        game.minute = minute;
        assert!(matches!(game.view_world(), Cow::Owned(_)));
        compare(&game);
    }
}

#[test]
fn classic_world_keeps_its_borrowed_view() {
    let mut game = game(false);
    game.minute = 1000;
    assert!(matches!(game.view_world(), Cow::Borrowed(_)));
    compare(&game);
}

#[test]
fn port_hold_matches_full_projection_before_and_after_repeated_pause_and_departure() {
    use manifest_core::{Cell, Fx, LocId};
    let mut game = game(true);
    let defs = Arc::make_mut(&mut game.session.world.defs);
    defs.map.terrain.fill(manifest_core::nav::Terrain::Deep);
    defs.map.region.fill(u16::MAX);
    defs.locations[0].cell = Cell::new(2, 15);
    defs.locations[1].cell = Cell::new(8, 15);
    defs.ships[0].speed = Fx::from_int(120);
    defs.rules.explore.sight = 0;
    let fleet = game.session.world.flagship(OwnerId::Player).unwrap();
    Command::Depart { owner: OwnerId::Player, fleet, minute: 0, heading: 90 }
        .apply_at(&mut game.session.world, 0)
        .unwrap();
    let arrival = game.session.world.preview_course(fleet, &[], 0).unwrap();
    let at = arrival.stops.iter().find(|s| s.kind == manifest_core::navigation::StopKind::Port).unwrap().minute;
    for minute in [0, at / 2, at - 1, at, at + 1] {
        for speed in [0, 4, 0, 8, 0] {
            game.minute = norm(u32::from(DAY_START_MINUTE) + u32::from(minute));
            game.speed = speed;
            let before = game.session.world.state.clone();
            let projected = game.view_world();
            assert_eq!(game.port_hold(), projected.fleet(fleet).unwrap().docked_at());
            assert_eq!(game.session.world.state, before);
        }
    }
    assert_eq!(game.port_hold(), Some(LocId(1)));
    let minute = at + 1;
    Command::Depart { owner: OwnerId::Player, fleet, minute, heading: 270 }
        .apply_at(&mut game.session.world, minute)
        .unwrap();
    assert_eq!(game.port_hold(), None);
    assert_eq!(game.view_world().fleet(fleet).unwrap().docked_at(), None);
}
