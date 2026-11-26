//! 导航调用点：封冻原因、跨月等待、纬度耗时与存档重放。

use manifest_core::nav::NavTable;
use manifest_core::{Command, FleetId, Fx, LocId, OwnerId, ScenarioId, StaticData};
use manifest_sim::{GameSession, storage};
use std::sync::Arc;

fn defs(config: &str, late_start: bool, slow: bool) -> Arc<StaticData> {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let mut defs = (*manifest_data::load_world(&root, "testbed").unwrap()).clone();
    let keys = defs.port_ids().map(|id| (defs.loc(id).key.clone(), id)).collect::<Vec<_>>();
    let ports = defs.port_ids().map(|id| (id, defs.loc(id).cell)).collect::<Vec<_>>();
    let rules = manifest_data::parse_navigation(config, &defs.calendar, &defs.map, &defs.regions, &keys).unwrap();
    defs.nav =
        Arc::new(NavTable::build_with_rules(&defs.map, &defs.regions, defs.locations.len(), &ports, rules).unwrap());
    defs.rules.disease_bp_per_30_days = 0;
    for ship in &mut defs.ships {
        ship.capacity = 500;
        if slow {
            ship.speed = Fx(5_000);
        }
    }
    if late_start {
        let year = u32::try_from(defs.rules.world.start_year).unwrap();
        defs.scenarios[0].start_date = [year, 1, 31];
        defs.scenarios[0].control_date = [year, 1, 31];
    }
    Arc::new(defs)
}

fn game(defs: Arc<StaticData>) -> (GameSession, FleetId) {
    let mut game = GameSession::new(defs, ScenarioId(0), 42).unwrap();
    let fleet = game.world.fleets_of(OwnerId::Player).next().unwrap().id;
    game.submit(Command::Resupply { owner: OwnerId::Player, fleet, food: 60, water: 60 }).unwrap();
    (game, fleet)
}

#[test]
fn frozen_departure_and_destination_return_b4_reason_without_mutation() {
    for (config, reason) in [
        ("[frozen_ports]\ntest_west=[1]", "frozen_port"),
        ("[frozen_ports]\ntest_east=[1]", "frozen_port"),
        ("[regions.test_sea]\nfrozen_months=[1]", "frozen_region"),
    ] {
        let (mut game, fleet) = game(defs(config, false, false));
        let before = game.world.state_hash();
        let commands = game.log().len();
        let error = game.submit(Command::SetSail { owner: OwnerId::Player, fleet, dest: LocId(1) }).unwrap_err();
        assert_eq!(error.code(), reason);
        assert_eq!(game.world.state_hash(), before);
        assert_eq!(game.log().len(), commands);
        assert!(game.world.estimate_days(game.world.fleet(fleet).unwrap(), LocId(1)).is_none());
    }
}

#[test]
fn voyage_waits_through_frozen_month_then_arrives_and_replays() {
    for config in ["[frozen_ports]\ntest_east=[2]", "[regions.test_sea]\nfrozen_months=[2]"] {
        let defs = defs(config, true, true);
        let (mut game, fleet) = game(defs.clone());
        game.submit(Command::SetSail { owner: OwnerId::Player, fleet, dest: LocId(1) }).unwrap();
        while game.day() < 40 {
            game.advance_day().unwrap();
        }
        let held = game.world.fleet(fleet).unwrap().location.clone();
        assert!(game.world.fleet(fleet).unwrap().docked_at().is_none());
        let save = storage::decode(&storage::encode(&game.to_save(), true).unwrap()).unwrap();
        let mut loaded = GameSession::from_save(defs, save).unwrap();
        while game.day() < 59 {
            game.advance_day().unwrap();
            loaded.advance_day().unwrap();
            assert_eq!(game.world.fleet(fleet).unwrap().location, held, "整个二月等待解冻");
        }
        while game.day() < 85 && game.world.fleet(fleet).unwrap().docked_at().is_none() {
            game.advance_day().unwrap();
            loaded.advance_day().unwrap();
        }
        assert_eq!(game.world.fleet(fleet).unwrap().docked_at(), Some(LocId(1)));
        assert_eq!(game.world.state, loaded.world.state);
        assert_eq!(game.world.state_hash(), loaded.replay().unwrap().state_hash());
        assert_eq!(game.world.defs.nav.memory().legacy_expanded_paths, 0);
        manifest_core::testkit::check_invariants(&game.world).unwrap();
    }
}

#[test]
fn latitude_scale_reaches_daily_movement_and_consumes_more_supplies() {
    let mut results = Vec::new();
    for north in [0, 4500] {
        let config = format!("[projection]\nkind='equirect'\nwest=0\nnorth={north}\narcmin_per_cell=1\nlat_scale=true");
        let (mut game, fleet) = game(defs(&config, false, false));
        game.submit(Command::SetSail { owner: OwnerId::Player, fleet, dest: LocId(1) }).unwrap();
        while game.day() < 60 && game.world.fleet(fleet).unwrap().docked_at().is_none() {
            game.advance_day().unwrap();
        }
        let f = game.world.fleet(fleet).unwrap();
        assert_eq!(f.docked_at(), Some(LocId(1)));
        results.push((game.day(), f.food));
        assert_eq!(game.world.defs.nav.memory().legacy_expanded_paths, 0);
        assert_eq!(game.world.state_hash(), game.replay().unwrap().state_hash());
    }
    assert!(results[1].0 > results[0].0, "高纬航程耗时增加：{results:?}");
    assert!(results[1].1 < results[0].1, "高纬多消耗补给：{results:?}");
}
