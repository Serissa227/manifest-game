//! B7：分钟命令的真实会话日志、半天存档、次日队列与重放。
use manifest_core::navigation::{Sail, Steering};
use manifest_core::replay::Source;
use manifest_core::world::{FleetLocation, Voyage};
use manifest_core::*;
use manifest_sim::GameSession;
use std::sync::Arc;

const P: OwnerId = OwnerId::Player;
fn session(manual: bool) -> (GameSession, FleetId) {
    let mut defs = (*testkit::tiny_defs()).clone();
    defs.manual_navigation = manual;
    defs.rules.pirates.spawn_scale = Fx::ZERO;
    defs.map.terrain.fill(manifest_core::nav::Terrain::Deep);
    defs.map.wrap_x = true;
    defs.nav = Arc::new(manifest_core::nav::NavTable::build(&defs.map, &defs.regions, defs.locations.len(), &[]));
    let mut s = GameSession::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
    let id = s.world.fleets_of(P).next().unwrap().id;
    s.submit(Command::Resupply { owner: P, fleet: id, food: 30, water: 30 }).unwrap();
    (s, id)
}
fn steer(id: FleetId, minute: u16, heading: u16, sail: Sail) -> Command {
    Command::Steer { owner: P, fleet: id, minute, heading: Some(heading), sail: Some(sail) }
}

#[test]
fn half_day_save_restore_keeps_queue_replay_and_next_day_equal() {
    let (mut s, id) = session(true);
    s.submit_at(120, Command::Depart { owner: P, fleet: id, minute: 120, heading: 90 }).unwrap();
    s.submit_at(720, steer(id, 720, 140, Sail::Half)).unwrap();
    assert_eq!(s.world.state, s.replay().unwrap().state);
    let save = SaveFile::from_json(&s.to_save().to_json().unwrap()).unwrap();
    let mut restored = GameSession::from_save(s.defs().clone(), save).unwrap();
    assert_eq!(restored.to_save(), s.to_save());
    for live in [&mut s, &mut restored] {
        live.submit_at(720, steer(id, 720, 175, Sail::Full)).unwrap();
        live.submit_at(1100, steer(id, 1100, 270, Sail::Half)).unwrap();
    }
    assert_eq!(s.world.preview_course(id, &[], 0).unwrap(), restored.world.preview_course(id, &[], 0).unwrap());
    s.advance_day().unwrap();
    restored.advance_day().unwrap();
    assert_eq!(s.world.state, restored.world.state);
    assert_eq!(s.world.state, s.replay().unwrap().state);
    assert!(s.world.state.navigation.is_empty());
    assert!(serde_json::to_value(&s.world.state).unwrap().get("navigation").is_none());
}

#[test]
fn same_minute_orders_follow_global_log_sequence_even_after_scheduling() {
    let (mut s, id) = session(true);
    s.schedule(1, Source::Player, Command::Depart { owner: P, fleet: id, minute: 0, heading: 90 });
    s.schedule(1, Source::Player, steer(id, 0, 180, Sail::Half));
    s.advance_day().unwrap();
    s.submit(steer(id, 0, 270, Sail::Full)).unwrap();
    let orders = &s.world.state.navigation.pending[&id].steers;
    assert_eq!(orders.iter().map(|s| s.heading).collect::<Vec<_>>(), [Some(180), Some(270)]);
    assert!(s.log().windows(2).all(|entries| entries[0].seq < entries[1].seq));
    let preview = s.world.preview_course(id, &[], 0).unwrap();
    assert_eq!(preview.voyage.heading, 270);
    let mut shuffled = s.to_save();
    shuffled.log.reverse();
    let b = GameSession::from_save(s.defs().clone(), shuffled).unwrap();
    assert_eq!(b.replay().unwrap().state, s.world.state);
    s.advance_day().unwrap();
    assert_eq!(s.world.state, s.replay().unwrap().state);
}

#[test]
fn backfill_is_atomic_in_core_and_against_the_application_clock() {
    let (mut s, id) = session(true);
    let before = s.to_save();
    assert_eq!(
        s.submit_at(600, Command::Depart { owner: P, fleet: id, minute: 599, heading: 90 }).unwrap_err().code(),
        "navigation.past"
    );
    assert_eq!(s.to_save(), before);
    s.submit_at(600, Command::Depart { owner: P, fleet: id, minute: 600, heading: 90 }).unwrap();
    let before = s.to_save();
    assert_eq!(s.submit(steer(id, 599, 0, Sail::Half)).unwrap_err().code(), "navigation.past");
    assert_eq!(s.to_save(), before);
    assert_eq!(s.submit_at(800, steer(id, 799, 0, Sail::Full)).unwrap_err().code(), "navigation.past");
    assert_eq!(s.to_save(), before);
}

#[test]
fn invalid_minutes_headings_empty_steers_and_classic_commands_are_rejected() {
    let (mut classic, id) = session(false);
    let before = classic.to_save();
    for cmd in [Command::Depart { owner: P, fleet: id, minute: 0, heading: 90 }, steer(id, 0, 90, Sail::Full)] {
        assert_eq!(classic.submit(cmd).unwrap_err().code(), "navigation.disabled");
        assert_eq!(classic.to_save(), before);
    }
    let (mut s, id) = session(true);
    for (minute, heading, code) in [(1440, 90, "navigation.minute"), (0, 360, "navigation.heading")] {
        let before = s.to_save();
        assert_eq!(s.submit(Command::Depart { owner: P, fleet: id, minute, heading }).unwrap_err().code(), code);
        assert_eq!(s.to_save(), before);
    }
    assert_eq!(
        s.submit(Command::SetSail { owner: P, fleet: id, dest: LocId(1) }).unwrap_err().code(),
        "navigation.manual_only"
    );
    s.submit(Command::Depart { owner: P, fleet: id, minute: 0, heading: 90 }).unwrap();
    let before = s.to_save();
    assert_eq!(
        s.submit(Command::Steer { owner: P, fleet: id, minute: 0, heading: None, sail: None }).unwrap_err().code(),
        "navigation.empty_steer"
    );
    assert_eq!(s.to_save(), before);
    let value = serde_json::to_value(steer(id, 3, 15, Sail::Half)).unwrap();
    assert_eq!(value["Steer"]["sail"], "half");
    assert_eq!(value["Steer"]["minute"], 3);
}

#[test]
fn departure_waits_until_its_minute_and_tentative_preview_matches_submission() {
    let (mut s, id) = session(true);
    let origin = manifest_core::navigation::SubCell::center(s.world.fleet(id).unwrap().cell(s.defs()));
    s.submit(Command::Depart { owner: P, fleet: id, minute: 720, heading: 90 }).unwrap();
    let full = s.world.preview_course(id, &[], 0).unwrap();
    assert_eq!(full.points.len(), 1441);
    assert!(full.points.iter().filter(|p| p.minute <= 720).all(|p| p.pos == origin));
    let orders = [
        Steering { minute: 900, heading: Some(180), sail: Some(Sail::Half) },
        Steering { minute: 900, heading: Some(270), sail: None },
    ];
    let before = s.to_save();
    let forecast = s.world.preview_course(id, &orders, 720).unwrap();
    assert_eq!(s.to_save(), before);
    assert_eq!(forecast.points.first().unwrap().minute, 720);
    assert_eq!(forecast.points.last().unwrap().minute, 1440);
    for o in orders {
        s.submit(Command::Steer { owner: P, fleet: id, minute: o.minute, heading: o.heading, sail: o.sail }).unwrap();
    }
    assert_eq!(s.world.preview_course(id, &[], 720).unwrap(), forecast);
    s.advance_day().unwrap();
    match (&s.world.fleet(id).unwrap().location, forecast.arrival) {
        (FleetLocation::AtSea(Voyage::Manual { manual }), None) => assert_eq!(*manual, forecast.voyage),
        (FleetLocation::Docked(loc), Some(expected)) => assert_eq!(*loc, expected),
        other => panic!("预测与实际位置不一致：{other:?}"),
    }
    assert_eq!(s.world.state, s.replay().unwrap().state);
}

#[test]
fn tampered_saved_queue_is_rejected_and_steer_cancels_autopilot() {
    let (mut s, id) = session(true);
    s.submit(Command::Depart { owner: P, fleet: id, minute: 0, heading: 90 }).unwrap();
    if let FleetLocation::AtSea(Voyage::Manual { manual }) = &mut s.world.fleet_mut(id).unwrap().location {
        manual.autopilot = Some(LocId(1));
    }
    s.submit(steer(id, 12, 90, Sail::Full)).unwrap();
    if let FleetLocation::AtSea(Voyage::Manual { manual }) = &s.world.fleet(id).unwrap().location {
        assert_eq!(manual.autopilot, None);
    }
    for bad in 0..3 {
        let mut save = s.to_save();
        let nav = &mut save.snapshot.navigation;
        match bad {
            0 => nav.pending.get_mut(&id).unwrap().steers[0].heading = Some(360),
            1 => nav.minute = 1440,
            _ => {
                let queue = nav.pending.remove(&id).unwrap();
                nav.pending.insert(FleetId(u32::MAX), queue);
            }
        }
        assert!(GameSession::from_save(s.defs().clone(), save).is_err());
    }
}

#[test]
fn thousand_tentative_minute_queues_equal_committed_day_end() {
    let (base, id) = session(true);
    let mut rng = manifest_core::rng::Rng::derive(91, 0, manifest_core::rng::Domain::Voyage, 0, 0);
    for _ in 0..1000 {
        let mut w = base.world.clone();
        let depart = rng.below(720) as u16;
        Command::Depart { owner: P, fleet: id, minute: depart, heading: rng.below(360) as u16 }.apply(&mut w).unwrap();
        // 这组测试只比较无抵港的远海段；独立用例检查抵港后的命令拒绝。
        if let FleetLocation::AtSea(Voyage::Manual { manual }) = &mut w.fleet_mut(id).unwrap().location {
            manual.pos = manifest_core::navigation::SubCell::center(Cell::new(8, 15));
        }
        let mut orders: Vec<_> = (0..4)
            .map(|_| Steering {
                minute: depart + rng.below(u64::from(1440 - depart)) as u16,
                heading: Some(rng.below(360) as u16),
                sail: Some([Sail::Full, Sail::Half, Sail::Furled][rng.below(3) as usize]),
            })
            .collect();
        orders.sort_by_key(|s| s.minute);
        let before = w.state.clone();
        let forecast = w.preview_course(id, &orders, depart).unwrap();
        assert_eq!(w.state, before);
        for order in &orders {
            Command::Steer { owner: P, fleet: id, minute: order.minute, heading: order.heading, sail: order.sail }
                .apply(&mut w)
                .unwrap();
        }
        assert_eq!(forecast, w.preview_course(id, &[], depart).unwrap());
        w.end_day().unwrap();
        match (&w.fleet(id).unwrap().location, forecast.arrival) {
            (FleetLocation::AtSea(Voyage::Manual { manual }), None) => {
                assert_eq!(manual, &forecast.voyage)
            }
            (FleetLocation::Docked(loc), Some(expected)) => assert_eq!(*loc, expected),
            other => panic!("队列结算不一致：{other:?}"),
        }
    }
}

#[test]
fn arrival_rejects_later_steering_without_opening_port_trade_early() {
    let (mut s, id) = session(true);
    let cell = s.world.fleet(id).unwrap().cell(s.defs());
    let heading = s.world.weather_at(cell).map(|w| u16::from(w.sea.wind_dir) * 45).unwrap_or(90);
    s.submit(Command::Depart { owner: P, fleet: id, minute: 0, heading }).unwrap();
    let trace = s.world.preview_course(id, &[], 0).unwrap();
    let anchor = trace.points.iter().find(|p| p.pos.cell() != cell).unwrap().pos.cell();
    let mut defs = (**s.defs()).clone();
    defs.locations[1].cell = anchor;
    s.world.defs = Arc::new(defs);
    let course = s.world.preview_course(id, &[], 0).unwrap();
    assert_eq!(course.arrival, Some(LocId(1)));
    let minute = course.stops.iter().find(|s| s.kind == manifest_core::navigation::StopKind::Port).unwrap().minute;
    let before = s.to_save();
    assert_eq!(s.submit(steer(id, minute, heading, Sail::Full)).unwrap_err().code(), "navigation.arrived");
    assert_eq!(s.to_save(), before);
    assert_eq!(
        s.world.preview_course(id, &[Steering { minute, heading: Some(heading), sail: None }], 0).unwrap_err().code(),
        "navigation.arrived"
    );
    assert!(s.world.fleet(id).unwrap().docked_at().is_none());
    s.advance_day().unwrap();
    assert_eq!(s.world.fleet(id).unwrap().docked_at(), Some(LocId(1)));
    assert!(s.world.state.log.iter().any(
        |e| matches!(e.kind, manifest_core::log::LogKind::Arrived { fleet, loc, .. } if fleet == id && loc == LocId(1))
    ));
}

#[test]
fn npc_routes_are_identical_when_the_manual_module_is_enabled() {
    let (mut manual, _) = session(true);
    let (mut classic, _) = session(false);
    let npc = manual.world.state.fleets.values().find(|f| f.owner != P).expect("测试商会舰队");
    let fleet = npc.id;
    let owner = npc.owner;
    let dest = if npc.docked_at() == Some(LocId(0)) { LocId(1) } else { LocId(0) };
    for s in [&mut manual, &mut classic] {
        Command::SetSail { owner, fleet, dest }.apply(&mut s.world).unwrap();
        assert!(matches!(s.world.fleet(fleet).unwrap().location, FleetLocation::AtSea(Voyage::Route(_))));
        s.advance_day().unwrap();
    }
    // E28 起手动世界另行记录四个已看见地点及精确奖励；其余完整状态（含全部 NPC）仍逐项相等。
    let sighted = [LocId(0), LocId(2), LocId(3), LocId(4)];
    assert_eq!(manual.world.state.explore.sighted, std::collections::BTreeSet::from(sighted));
    assert!(classic.world.state.explore.sighted.is_empty());
    let sightings: Vec<_> = manual
        .world
        .state
        .log
        .iter()
        .filter_map(|event| match event.kind {
            manifest_core::log::LogKind::LocationSighted { loc, owner } => {
                assert_eq!(owner, P);
                Some((event.day, loc))
            }
            _ => None,
        })
        .collect();
    assert_eq!(sightings, sighted.map(|loc| (0, loc)));
    let original_fame = classic.world.agent(P).unwrap().fame;
    assert_eq!(manual.world.agent(P).unwrap().fame, original_fame + 4 * manual.defs().navigation.sight_fame);
    let mut comparable = manual.world.state.clone();
    comparable.agents.get_mut(&P).unwrap().fame = original_fame;
    comparable.explore.sighted.clear();
    comparable.log.retain(|event| !matches!(event.kind, manifest_core::log::LogKind::LocationSighted { .. }));
    assert_eq!(comparable, classic.world.state);
}
