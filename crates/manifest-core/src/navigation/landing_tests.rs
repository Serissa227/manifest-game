use super::*;
use crate::defs::{DiscoveryDef, DiscoveryKind};
use crate::log::LogKind;
use crate::nav::Terrain;
use crate::rng::{Domain, Rng};
use crate::*;
use std::sync::Arc;

fn world() -> (World, FleetId) {
    let mut defs = (*testkit::tiny_defs()).clone();
    defs.manual_navigation = true;
    defs.map.terrain.fill(Terrain::Deep);
    defs.map.region.fill(u16::MAX);
    defs.locations[0].cell = Cell::new(2, 15);
    defs.locations[1].cell = Cell::new(35, 15);
    defs.rules.explore.sight = 0;
    defs.rules.pirates.spawn_scale = Fx::ZERO;
    defs.rules.disease_bp_per_30_days = 0;
    defs.navigation.caravan_sight = 0;
    for r in &mut defs.regions {
        for s in &mut r.seasons {
            s.wind_strength = 0;
            s.current_strength = 0;
        }
    }
    let inland = Cell::new(2, 16);
    let i = defs.map.idx(inland);
    defs.map.terrain[i] = Terrain::Land;
    defs.discoveries = vec![DiscoveryDef {
        key: "inland".into(),
        name: "内陆发现".into(),
        cell: inland,
        kind: DiscoveryKind::Plant,
        fame: 1,
        value: 1,
        lore: String::new(),
    }];
    defs.nav = Arc::new(crate::nav::NavTable::build(&defs.map, &defs.regions, defs.locations.len(), &[]));
    let mut w = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
    w.state.explore.cells.fill(0);
    let id = w.fleets_of(OwnerId::Player).next().unwrap().id;
    // 此用例固定为三天无风险；三种风险另行覆盖。
    w.state.seed = (0..1_000)
        .find(|seed| (0..3).all(|day| !Rng::derive(*seed, day, Domain::Landing, u64::from(id.0), 0).chance_bp(500)))
        .unwrap();
    let f = w.fleet_mut(id).unwrap();
    f.food = 100;
    f.water = 100;
    (w, id)
}

#[test]
fn landing_discovers_inland_consumes_daily_and_roundtrips_while_anchored() {
    let (mut w, id) = world();
    let original = w.clone();
    let command = Command::Landing { owner: OwnerId::Player, fleet: id, days: 3 };
    let need = crate::fleet::daily_supply_need(&w.defs, w.fleet(id).unwrap().crew);
    let anchor = w.fleet(id).unwrap().location.clone();
    command.apply(&mut w).unwrap();
    let mut replay = original;
    command.apply(&mut replay).unwrap();
    for day in 1..=3 {
        w.end_day().unwrap();
        replay.end_day().unwrap();
        assert_eq!(w.state, replay.state);
        assert_eq!(w.fleet(id).unwrap().location, anchor);
        assert_eq!(w.fleet(id).unwrap().food, 100 - need * day);
        assert_eq!(w.fleet(id).unwrap().water, 100 - need * day);
        let encoded = serde_json::to_string(&w.state).unwrap();
        w = World::from_snapshot(w.defs.clone(), serde_json::from_str(&encoded).unwrap()).unwrap();
    }
    assert!(w.state.explore.discovered.contains_key(&DiscoveryId(0)));
    assert!(!w.state.navigation.landings.contains_key(&id));
    assert!(
        w.state.log.iter().any(|e| matches!(e.kind, LogKind::LandingFinished { fleet, days: 3, .. } if fleet == id))
    );
}

#[test]
fn fractional_landing_uses_actual_person_days_and_keeps_partial_units_on_reload() {
    let (mut w, id) = world();
    Arc::make_mut(&mut w.defs).rules.fractional_supplies = true;
    Arc::make_mut(&mut w.defs).rules.crew_per_supply_unit = 50;
    let f = w.fleet_mut(id).unwrap();
    f.crew = 18;
    f.food = 2;
    f.water = 2;
    Command::Landing { owner: OwnerId::Player, fleet: id, days: 3 }.apply(&mut w).unwrap();
    for day in 1..=3 {
        w.end_day().unwrap();
        let f = w.fleet(id).unwrap();
        assert_eq!((f.food, f.water), (2 - day * 18 / 50, 2 - day * 18 / 50));
        assert_eq!((f.supply_remainder.food, f.supply_remainder.water), (day * 18 % 50, day * 18 % 50));
        let encoded = serde_json::to_string(&w.state).unwrap();
        w = World::from_snapshot(w.defs.clone(), serde_json::from_str(&encoded).unwrap()).unwrap();
    }
    // 第二次登陆沿用余数，不能通过分成多个短登陆免除消耗。
    Command::Landing { owner: OwnerId::Player, fleet: id, days: 1 }.apply(&mut w).unwrap();
    w.end_day().unwrap();
    let f = w.fleet(id).unwrap();
    assert_eq!((f.food, f.supply_remainder.food), (1, 22));
}

#[test]
fn landing_rejects_bad_days_open_sea_supplies_and_sailing_while_away() {
    let (mut w, id) = world();
    for days in [0, 31, u16::MAX] {
        let before = w.state.clone();
        assert_eq!(
            Command::Landing { owner: OwnerId::Player, fleet: id, days }.apply(&mut w).unwrap_err().code(),
            "landing.days"
        );
        assert_eq!(before, w.state);
    }
    let dock = w.fleet(id).unwrap().location.clone();
    w.fleet_mut(id).unwrap().location =
        FleetLocation::AtSea(Voyage::Manual { manual: ManualVoyage::new(Cell::new(10, 10), 0) });
    assert_eq!(
        Command::Landing { owner: OwnerId::Player, fleet: id, days: 1 }.validate(&w).unwrap_err().code(),
        "landing.coast"
    );
    w.fleet_mut(id).unwrap().location = dock;
    w.fleet_mut(id).unwrap().food = 0;
    assert_eq!(
        Command::Landing { owner: OwnerId::Player, fleet: id, days: 1 }.validate(&w).unwrap_err().code(),
        "landing.supplies"
    );
    w.fleet_mut(id).unwrap().food = 100;
    Command::Landing { owner: OwnerId::Player, fleet: id, days: 1 }.apply(&mut w).unwrap();
    assert_eq!(
        Command::Depart { owner: OwnerId::Player, fleet: id, minute: 0, heading: 90 }.validate(&w).unwrap_err().code(),
        "landing.active"
    );
}

#[test]
fn all_three_landing_risks_are_reproducible_and_lost_adds_one_day() {
    let (base, id) = world();
    for kind in 0..3 {
        let seed = (0..10_000)
            .find(|seed| {
                let mut rng = Rng::derive(*seed, base.day(), Domain::Landing, u64::from(id.0), 0);
                rng.chance_bp(500) && rng.below(3) == kind
            })
            .unwrap();
        let mut a = base.clone();
        a.state.seed = seed;
        Command::Landing { owner: OwnerId::Player, fleet: id, days: 3 }.apply(&mut a).unwrap();
        let encoded = serde_json::to_string(&a.state).unwrap();
        let mut b = World::from_snapshot(a.defs.clone(), serde_json::from_str(&encoded).unwrap()).unwrap();
        a.finish_landing_day();
        b.finish_landing_day();
        assert_eq!(a.state, b.state);
        let expected = match kind {
            0 => landing::LandingRisk::Injury,
            1 => landing::LandingRisk::Disease,
            _ => landing::LandingRisk::Lost,
        };
        assert!(a.state.log.iter().any(|e| matches!(e.kind, LogKind::LandingRisk { risk, .. } if risk == expected)));
        assert_eq!(a.state.navigation.landings[&id].days, if kind == 2 { 4 } else { 3 });
    }
}

#[test]
fn swept_high_speed_navigation_reveals_every_crossed_cell_even_across_wrap() {
    let (mut w, id) = world();
    let mut defs = (*w.defs).clone();
    defs.map.wrap_x = true;
    defs.nav = Arc::new(crate::nav::NavTable::build(&defs.map, &defs.regions, defs.locations.len(), &[]));
    w.defs = Arc::new(defs);
    let f = w.fleet_mut(id).unwrap();
    f.ships.iter_mut().for_each(|s| s.speed_bonus = Fx::from_int(100_000));
    f.location = FleetLocation::AtSea(Voyage::Manual { manual: ManualVoyage::new(Cell::new(2, 10), 90) });
    let course = w.manual_course(w.fleet(id).unwrap(), &[], 1);
    assert!(course.cells.len() > usize::from(w.defs.map.width));
    w.reveal_navigation_course(id, &course);
    for x in 0..w.defs.map.width {
        assert!(w.state.explore.is_revealed(w.defs.map.idx(Cell::new(x, 10))), "x={x}");
    }
    assert!(!w.state.explore.is_revealed(w.defs.map.idx(Cell::new(10, 9))));
}

#[test]
fn caravan_legs_reveal_intermediate_land_and_classic_does_not_use_manual_trails() {
    let (mut w, id) = world();
    let mut defs = (*w.defs).clone();
    defs.locations[1].cell = Cell::new(12, 15);
    for x in 3..12 {
        let index = defs.map.idx(Cell::new(x, 15));
        defs.map.terrain[index] = Terrain::Land;
    }
    defs.discoveries[0].cell = Cell::new(7, 15);
    w.defs = Arc::new(defs);
    w.reveal_caravan_segment(LocId(0), LocId(1), Fx::ZERO, Fx::from_int(10), Fx::from_int(10));
    for x in 2..=12 {
        assert!(w.state.explore.is_revealed(w.defs.map.idx(Cell::new(x, 15))));
    }
    assert!(w.state.explore.discovered.contains_key(&DiscoveryId(0)));
    let course = w.manual_course(w.fleet(id).unwrap(), &[], 5);
    let mut defs = (*w.defs).clone();
    defs.manual_navigation = false;
    w.defs = Arc::new(defs);
    let before = w.state.clone();
    w.reveal_navigation_course(id, &course);
    assert_eq!(before, w.state);
}

#[test]
fn caravan_daily_movement_reveals_both_legs_and_intermediate_discoveries() {
    let (mut w, _) = world();
    let mut defs = (*w.defs).clone();
    defs.locations[0].cell = Cell::new(2, 15);
    defs.locations[3].cell = Cell::new(12, 15);
    defs.locations[1].cell = Cell::new(22, 15);
    for x in 3..22 {
        let index = defs.map.idx(Cell::new(x, 15));
        defs.map.terrain[index] = Terrain::Land;
    }
    defs.discoveries[0].cell = Cell::new(7, 15);
    defs.animals[0].speed = Fx::from_int(100);
    w.defs = Arc::new(defs);
    let owner = OwnerId::Player;
    let CommandOutcome::CaravanFormed { caravan } =
        Command::FormCaravan { owner, at: LocId(0), animal: AnimalId(0), count: 1 }.apply(&mut w).unwrap()
    else {
        panic!("商队已组建")
    };
    Command::CaravanTravel { owner, caravan, dest: LocId(1) }.apply(&mut w).unwrap();
    w.move_caravans().unwrap();
    assert!(matches!(w.caravan(caravan).unwrap().location, crate::caravan::CaravanLocation::At(LocId(1))));
    for x in 2..=22 {
        assert!(w.state.explore.is_revealed(w.defs.map.idx(Cell::new(x, 15))), "x={x}");
    }
    assert!(w.state.explore.discovered.contains_key(&DiscoveryId(0)));
}

#[test]
fn coastal_landing_furls_at_the_command_minute_and_invalid_saved_anchor_is_rejected() {
    let (mut w, id) = world();
    let anchor = Cell::new(3, 16);
    w.fleet_mut(id).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual: ManualVoyage::new(anchor, 90) });
    Command::Landing { owner: OwnerId::Player, fleet: id, days: 2 }.apply(&mut w).unwrap();
    let course = w.manual_course(w.fleet(id).unwrap(), &[], 1440);
    assert_eq!(course.voyage.sail, Sail::Furled);
    assert!(course.points.iter().all(|p| p.pos == SubCell::center(anchor)));
    let snapshot = w.state.clone();
    World::from_snapshot(w.defs.clone(), snapshot.clone()).unwrap();
    let mut broken = snapshot;
    broken.navigation.landings.get_mut(&id).unwrap().anchor.x += 256;
    assert!(World::from_snapshot(w.defs.clone(), broken).is_err());
    w.end_day().unwrap();
    assert_eq!(w.fleet(id).unwrap().cell(&w.defs), anchor);
}

#[test]
fn partial_caravan_leg_starts_at_the_cell_center_and_does_not_reveal_a_future_cell() {
    let (mut w, _) = world();
    let mut defs = (*w.defs).clone();
    defs.navigation.caravan_sight = 0;
    defs.locations[0].cell = Cell::new(2, 15);
    defs.locations[1].cell = Cell::new(0, 15);
    w.defs = Arc::new(defs);
    w.reveal_caravan_segment(LocId(0), LocId(1), Fx::ZERO, Fx::from_pct(25), Fx::from_int(2));
    assert!(w.state.explore.is_revealed(w.defs.map.idx(Cell::new(2, 15))));
    assert!(!w.state.explore.is_revealed(w.defs.map.idx(Cell::new(1, 15))));
}

#[test]
fn caravan_land_discoveries_respect_authored_permission_and_never_grant_dive_discoveries() {
    use crate::geo::authored::{DiscoveryMode, DiscoveryRequirements, DiscoverySource};
    let (mut w, _) = world();
    let mut defs = (*w.defs).clone();
    defs.locations[1].cell = Cell::new(12, 15);
    defs.discoveries[0].cell = Cell::new(7, 15);
    let key = defs.discoveries[0].key.clone();
    defs.geography.places.authored.discoveries.insert(
        key.clone(),
        DiscoverySource {
            provenance: Default::default(),
            radius: 2,
            requires: DiscoveryRequirements {
                mode: DiscoveryMode::Land,
                permission: true,
                landing: Some(true),
                ..Default::default()
            },
            codex: true,
            clue: None,
            phantom: false,
            reachable: true,
            once: true,
            moves: vec![],
        },
    );
    w.defs = Arc::new(defs);
    let travel =
        |w: &mut World| w.reveal_caravan_segment(LocId(0), LocId(1), Fx::ZERO, Fx::from_int(10), Fx::from_int(10));
    travel(&mut w);
    assert!(!w.state.explore.discovered.contains_key(&DiscoveryId(0)));
    w.state.story2.flags.insert(format!("discovery_permission_{key}"));
    travel(&mut w);
    assert!(w.state.explore.discovered.contains_key(&DiscoveryId(0)));
    w.state.explore.discovered.clear();
    let mut defs = (*w.defs).clone();
    defs.geography.places.authored.discoveries.get_mut(&key).unwrap().requires.mode = DiscoveryMode::Dive;
    w.defs = Arc::new(defs);
    travel(&mut w);
    assert!(!w.state.explore.discovered.contains_key(&DiscoveryId(0)));
}

#[test]
fn landing_anchor_follows_the_existing_coastline_reconciliation_and_roundtrips() {
    let (mut w, id) = world();
    let anchor = Cell::new(3, 16);
    w.fleet_mut(id).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual: ManualVoyage::new(anchor, 90) });
    Command::Landing { owner: OwnerId::Player, fleet: id, days: 2 }.apply(&mut w).unwrap();
    let mut defs = (*w.defs).clone();
    let at = defs.map.idx(anchor);
    defs.map.terrain[at] = Terrain::Land;
    let loaded = World::from_snapshot(Arc::new(defs), w.state).unwrap();
    let moved = loaded.fleet(id).unwrap().cell(&loaded.defs);
    assert_ne!(moved, anchor);
    assert!(loaded.defs.map.is_sea_in_bounds(moved));
    assert_eq!(loaded.state.navigation.landings[&id].anchor, SubCell::center(moved));
    assert_eq!(World::from_snapshot(loaded.defs.clone(), loaded.state.clone()).unwrap().state, loaded.state);
}
