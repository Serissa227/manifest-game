use super::*;
use crate::battle::{BattleResult, PendingBattle, PirateFleet};
use crate::nav::Terrain;
use crate::replay::StartParams;
use crate::save::{SaveFile, downgrade_to_v1};
use crate::world::RouteVoyage;
use crate::*;
use std::sync::Arc;

fn world() -> (World, FleetId) {
    let mut defs = (*testkit::tiny_defs()).clone();
    defs.manual_navigation = true;
    defs.rules.money.enabled = true;
    defs.rules.pirates.spawn_scale = Fx::ZERO;
    defs.rules.disease_bp_per_30_days = 0;
    let mut w = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
    let id = w.fleets_of(OwnerId::Player).next().unwrap().id;
    Command::Resupply { owner: OwnerId::Player, fleet: id, food: 20, water: 20 }.apply(&mut w).unwrap();
    let cell = w.defs.loc(LocId(1)).cell;
    let mut manual = ManualVoyage::new(cell, 90);
    manual.sail = Sail::Furled;
    w.fleet_mut(id).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual });
    (w, id)
}

#[test]
fn route_json_is_byte_identical_and_old_saves_load() {
    let route = RouteVoyage { dest: LocId(1), path: vec![Cell::new(3, 2)], step: 0, leg_progress: Fx(123) };
    assert_eq!(serde_json::to_string(&Voyage::Route(route.clone())).unwrap(), serde_json::to_string(&route).unwrap());
    let defs = testkit::tiny_defs();
    let mut w = World::new(defs.clone(), ScenarioId(0), 42).unwrap();
    let id = w.fleets_of(OwnerId::Player).next().unwrap().id;
    Command::SetSail { owner: OwnerId::Player, fleet: id, dest: LocId(1) }.apply(&mut w).unwrap();
    let save = SaveFile::new(&defs, StartParams::new(ScenarioId(0), 42), w.state.clone(), vec![]);
    let json = save.to_json().unwrap();
    assert!(!json.contains("manual"));
    for version in 1..=5 {
        let mut value = serde_json::to_value(&save).unwrap();
        if version == 1 {
            value = downgrade_to_v1(value).unwrap();
        } else {
            value["version"] = version.into();
        }
        let loaded = SaveFile::from_json(&value.to_string()).unwrap();
        assert_eq!(World::from_snapshot(defs.clone(), loaded.snapshot).unwrap().state, w.state);
    }
}

#[test]
fn manual_save_roundtrip_and_daily_supplies_and_wages() {
    let (mut w, id) = world();
    let f = w.fleet(id).unwrap().clone();
    assert_eq!(w.fleet_port(&f), Some(LocId(1)));
    assert_eq!(w.fleet_town(id), crate::circulation::Sector::Town(LocId(1)));
    assert_eq!(w.fleet_town(id), w.town_sector(LocId(1)));
    let save = SaveFile::new(&w.defs, StartParams::new(ScenarioId(0), 42), w.state.clone(), vec![]);
    let loaded = SaveFile::from_json(&save.to_json().unwrap()).unwrap();
    let mut b = World::from_snapshot(w.defs.clone(), loaded.snapshot).unwrap();
    assert_eq!(w.state, b.state);
    let cash = w.agent(OwnerId::Player).unwrap().cash;
    let need = crate::fleet::daily_supply_need(&w.defs, f.crew);
    w.end_day().unwrap();
    b.end_day().unwrap();
    assert_eq!(w.state, b.state);
    let after = w.fleet(id).unwrap();
    assert_eq!((after.food, after.water), (f.food - need, f.water - need));
    assert_eq!(w.agent(OwnerId::Player).unwrap().cash, cash - f.crew * w.defs.rules.crew_wage);
    testkit::check_invariants(&w).unwrap();
}

#[test]
fn manual_wreck_removes_fleet_and_writes_off_assets() {
    let (mut w, id) = world();
    w.fleet_mut(id).unwrap().ships.iter_mut().for_each(|s| s.durability = 0);
    w.sink_wrecked_ships(id).unwrap();
    assert!(!w.state.fleets.contains_key(&id));
    assert!(w.state.log.iter().any(|e| matches!(e.kind, crate::log::LogKind::FleetLost { fleet, .. } if fleet == id)));
    testkit::check_invariants(&w).unwrap();
}

#[test]
fn manual_battle_win_uses_nearest_port_faction() {
    let (mut w, id) = world();
    let cell = w.fleet(id).unwrap().cell(&w.defs);
    let faction = w.defs.loc(LocId(1)).faction;
    let reputation = w.agent(OwnerId::Player).unwrap().reputation.get(&faction).copied().unwrap_or(0);
    let pirate = PirateFleet { id: 99, region: RegionId(0), cell, ships: vec![], crew: 0, until: 100, engaged: true };
    w.state.battles.pirates.insert(99, pirate);
    w.state
        .battles
        .pending
        .insert(BattleId(99), PendingBattle { id: BattleId(99), fleet: id, pirate: 99, day: w.day() });
    Command::EngageBattle { owner: OwnerId::Player, battle: BattleId(99), tactical: false }.apply(&mut w).unwrap();
    assert_eq!(w.state.battles.records.last().unwrap().result, BattleResult::Won);
    assert_eq!(w.agent(OwnerId::Player).unwrap().reputation[&faction], reputation + w.defs.rules.battle.reputation_win);
}

#[test]
fn manual_on_changed_coast_relocates_once_without_a_destination() {
    let (w, id) = world();
    let mut state = w.state.clone();
    let cell = Cell::new(8, 8);
    state.fleets.get_mut(&id).unwrap().location =
        FleetLocation::AtSea(Voyage::Manual { manual: ManualVoyage::new(cell, 90) });
    let mut defs = (*w.defs).clone();
    let index = defs.map.idx(cell);
    defs.map.terrain[index] = Terrain::Land;
    let defs = Arc::new(defs);
    let loaded = World::from_snapshot(defs.clone(), state).unwrap();
    assert_ne!(loaded.fleet(id).unwrap().cell(&defs), cell);
    assert!(defs.map.is_sea_in_bounds(loaded.fleet(id).unwrap().cell(&defs)));
    assert_eq!(World::from_snapshot(defs, loaded.state.clone()).unwrap().state, loaded.state);
}

#[test]
fn manual_bad_heading_or_position_is_rejected() {
    let (w, id) = world();
    for bad in [ManualVoyage::new(Cell::new(1, 1), 360), ManualVoyage::new(Cell::new(u16::MAX, 1), 0)] {
        let mut state = w.state.clone();
        state.fleets.get_mut(&id).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual: bad });
        assert!(World::from_snapshot(w.defs.clone(), state).is_err());
    }
}
