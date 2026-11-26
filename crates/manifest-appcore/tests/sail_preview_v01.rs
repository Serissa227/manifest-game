//! V01：出航预估复用船速／风向估算，并直接给出粮水缺口。
use manifest_appcore::{AppPaths, AppState, handlers};
use manifest_core::{Cell, FleetId, Fx, LocId, OwnerId, ScenarioId, World, fleet::new_ship, nav::Terrain};
use serde_json::json;
use std::sync::{
    Arc,
    atomic::{AtomicU32, Ordering},
};

fn app(manual: bool, fractional: bool) -> (AppState, FleetId) {
    static NEXT: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!(
        "manifest-v01-preview-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let st = AppState::from_data_dir(
        &manifest_data::find_data_dir().unwrap(),
        Arc::new(manifest_ai::MemoryKeyStore::default()),
        AppPaths::in_dir(&dir),
    )
    .unwrap();
    handlers::new_game(&st, "newcomer", Some(42)).unwrap();
    let mut defs = (*manifest_core::testkit::tiny_defs()).clone();
    defs.manual_navigation = manual;
    defs.rules.fractional_supplies = fractional;
    defs.rules.crew_per_supply_unit = 50;
    defs.map.terrain.fill(Terrain::Deep);
    defs.map.region.fill(u16::MAX);
    defs.locations[0].cell = Cell::new(2, 15);
    defs.locations[1].cell = Cell::new(22, 15);
    defs.ships[0].speed = Fx::from_int(4);
    defs.ships[0].crew_min = 10;
    defs.nav = Arc::new(manifest_core::nav::NavTable::build(&defs.map, &defs.regions, defs.locations.len(), &[]));
    let mut w = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
    let id = w.flagship(OwnerId::Player).unwrap();
    let ship = new_ship(&w.defs, manifest_core::ShipTypeId(0));
    let f = w.fleet_mut(id).unwrap();
    f.ships = vec![ship];
    f.crew = 18;
    f.food = 1;
    f.water = 3;
    f.morale = 100;
    f.location = manifest_core::world::FleetLocation::Docked(LocId(0));
    w.state.explore.cells.fill(u64::MAX);
    w.state.explore.sighted.extend(w.defs.port_ids());
    st.game().unwrap().as_mut().unwrap().session.world = w;
    (st, id)
}

#[test]
fn manual_preview_uses_speed_and_reports_each_shortfall_without_mutating_world() {
    let (st, id) = app(true, true);
    {
        let mut g = st.game().unwrap();
        let f = g.as_mut().unwrap().session.world.fleet_mut(id).unwrap();
        f.supply_remainder.food = 18;
        f.supply_remainder.water = 36;
    }
    let before = st.game().unwrap().as_ref().unwrap().session.world.state.clone();
    let preview = handlers::sail_preview(&st, id.0, 1).unwrap().unwrap();
    let v = serde_json::to_value(&preview).unwrap();
    assert_eq!(preview.days, 5, "20 格 / 每天 4 格，不能把 21 个路径点当天数");
    assert_eq!(preview.path.len(), 21);
    assert_eq!(v["supplies_days"], 1);
    assert_eq!(v["required"], json!({"food":3,"water":3}));
    assert_eq!(v["shortfall"], json!({"food":2,"water":0}));
    assert_eq!(preview.supplies, 5);
    assert_eq!(st.game().unwrap().as_ref().unwrap().session.world.state, before);
    {
        let mut g = st.game().unwrap();
        let w = &mut g.as_mut().unwrap().session.world;
        Arc::make_mut(&mut w.defs).ships[0].speed = Fx::from_int(8);
    }
    assert_eq!(handlers::sail_preview(&st, id.0, 1).unwrap().unwrap().days, 3);
}

#[test]
fn classic_preview_keeps_route_and_daily_rounding() {
    let (st, id) = app(false, false);
    let (path, days) = {
        let g = st.game().unwrap();
        let w = &g.as_ref().unwrap().session.world;
        w.route_with_days(w.fleet(id).unwrap(), LocId(1)).unwrap()
    };
    let p = handlers::sail_preview(&st, id.0, 1).unwrap().unwrap();
    assert_eq!(p.path, path.iter().map(|c| (c.x, c.y)).collect::<Vec<_>>());
    assert_eq!(p.days, days);
    assert_eq!(p.supplies, days + 5.max(days / 4));
    assert_eq!((p.required.food, p.required.water), (days, days));
}

#[test]
fn stocked_ship_has_no_shortfall_and_zero_crew_has_no_consumption() {
    let (st, id) = app(true, true);
    {
        let mut g = st.game().unwrap();
        let f = g.as_mut().unwrap().session.world.fleet_mut(id).unwrap();
        f.food = 10;
        f.water = 10;
    }
    let p = handlers::sail_preview(&st, id.0, 1).unwrap().unwrap();
    assert_eq!((p.shortfall.food, p.shortfall.water), (0, 0));
    assert_eq!(p.supplies_days, Some(27));
    st.game().unwrap().as_mut().unwrap().session.world.fleet_mut(id).unwrap().crew = 0;
    let v = serde_json::to_value(handlers::sail_preview(&st, id.0, 1).unwrap().unwrap()).unwrap();
    assert!(v["supplies_days"].is_null());
    assert_eq!(v["required"], json!({"food":0,"water":0}));
}

#[test]
fn manual_preview_responds_to_wind_direction() {
    let (st, id) = app(true, true);
    let estimate = |wind_dir| {
        {
            let mut g = st.game().unwrap();
            let w = &mut g.as_mut().unwrap().session.world;
            let d = Arc::make_mut(&mut w.defs);
            d.map.region.fill(0);
            d.ships[0].sail = manifest_core::defs::SailType::Square;
            for season in &mut d.regions[0].seasons {
                season.wind_dir = wind_dir;
                season.wind_strength = 10;
                season.current_strength = 0;
                season.storm_bp = 0;
            }
        }
        handlers::sail_preview(&st, id.0, 1).unwrap().unwrap().days
    };
    let following = estimate(2);
    let contrary = estimate(6);
    assert!(following < contrary, "东行顺风 {following} 天，逆风 {contrary} 天");
}
