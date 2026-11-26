//! E64b消费点：混合舰队补给、价格、航速、逐船维护、潜水与读档。
#[path = "support/history.rs"]
mod fixture;
use fixture::*;
use manifest_core::log::LogKind;
use manifest_core::{
    ledger::Account,
    legend_ships::{Trait, mechanics},
    world::{FleetLocation, Voyage},
    *,
};
use serde_json::json;
use std::sync::Arc;
fn world(traits: Vec<Trait>) -> World {
    let mut w = fixture::world(json!([]));
    Arc::make_mut(&mut w.defs).legend_ships.ships[0].traits = traits;
    w.grant_item(O, "ring", 1).unwrap();
    buy(&mut w, 2);
    Command::CommissionShip { owner: O, ship: "sample_legend_ship".into(), loc: LocId(0) }.apply(&mut w).unwrap();
    w
}
fn anchored(w: &mut World) {
    let f = w.flagship(O).unwrap();
    Command::Resupply { owner: O, fleet: f, food: 20, water: 20 }.apply(w).unwrap();
    Arc::make_mut(&mut w.defs).manual_navigation = true;
    let mut voyage = navigation::ManualVoyage::new(w.fleet(f).unwrap().cell(&w.defs), 90);
    voyage.sail = navigation::Sail::Furled;
    w.fleet_mut(f).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual: voyage });
}
#[test]
fn ghost_in_a_mixed_fleet_does_not_cancel_living_wages_food_or_water() {
    let mut mixed = world(vec![Trait::Ghost]);
    anchored(&mut mixed);
    let f = mixed.flagship(O).unwrap();
    let mut ordinary = mixed.clone();
    for s in &mut ordinary.fleet_mut(f).unwrap().ships {
        s.legend = None;
    }
    ordinary.state.legend_ships = Default::default();
    let before = mixed.fleet(f).unwrap().clone();
    let wage_before = mixed.agent(O).unwrap().ledger.balance(Account::Wages);
    mixed.end_day().unwrap();
    ordinary.end_day().unwrap();
    let a = mixed.fleet(f).unwrap();
    let b = ordinary.fleet(f).unwrap();
    assert!(a.food < before.food && a.water < before.water);
    assert_eq!((a.food, a.water, a.crew), (b.food, b.water, b.crew));
    let wages = mixed.agent(O).unwrap().ledger.balance(Account::Wages);
    assert!(wages > wage_before);
    assert_eq!(wages, ordinary.agent(O).unwrap().ledger.balance(Account::Wages));
    assert!(mixed.money_conserved());
    assert_eq!(restored(&mixed).state_hash(), mixed.state_hash());
}
#[test]
fn ghost_trade_penalty_is_local_and_never_makes_a_round_trip_profitable() {
    let w = world(vec![Trait::Ghost]);
    let good = w.defs.find_good("grain").unwrap();
    let mut ordinary = w.clone();
    for s in &mut ordinary.fleet_mut(w.flagship(O).unwrap()).unwrap().ships {
        s.legend = None;
    }
    let quote = |w: &World, side| market::quote(w, O, LocId(0), good, side, 10).unwrap();
    assert!(quote(&w, market::Side::Buy).total > quote(&ordinary, market::Side::Buy).total);
    assert!(quote(&w, market::Side::Sell).total < quote(&ordinary, market::Side::Sell).total);
    assert!(quote(&w, market::Side::Buy).total > quote(&w, market::Side::Sell).total);
    assert!(!w.ghost_anchorage(O, LocId(1)));
}
#[test]
fn named_ship_speed_consumes_daylight_fog_storm_paddle_and_clipper_traits() {
    let w = world(vec![Trait::Ghost]);
    let f = w.fleet(w.flagship(O).unwrap()).unwrap();
    let ship = f.ships.last().unwrap();
    let day = mechanics::ship_speed(&w.defs, ship, 2, None, 720);
    let night = mechanics::ship_speed(&w.defs, ship, 2, None, 1200);
    assert!(night > day);
    for trait_ in [Trait::Paddle, Trait::FairWind, Trait::ClipperHull, Trait::FogSail, Trait::StormRider] {
        let w = world(vec![trait_]);
        let fleet = w.flagship(O).unwrap();
        let mut weather = w.weather_at(w.fleet(fleet).unwrap().cell(&w.defs)).unwrap();
        weather.sea.wind_strength = 0;
        weather.sky = weather::Sky::Clear;
        let s = w.fleet(fleet).unwrap().ships.last().unwrap();
        let clear = mechanics::ship_speed(&w.defs, s, 2, Some(&weather), 720);
        assert!(clear > fixed::Fx::ZERO);
        weather.sky = if trait_ == Trait::StormRider { weather::Sky::Storm } else { weather::Sky::Fog };
        let special = mechanics::ship_speed(&w.defs, s, 2, Some(&weather), 720);
        assert!(special <= w.defs.ship(s.kind).speed.mul(fixed::Fx::from_int(3)));
        if matches!(trait_, Trait::FogSail | Trait::StormRider) {
            assert!(special >= clear);
        }
    }
}
#[test]
fn manual_sailing_keeps_the_named_ships_positive_fog_bonus() {
    let mut w = world(vec![Trait::Paddle, Trait::FogSail]);
    let fleet = w.flagship(O).unwrap();
    w.fleet_mut(fleet).unwrap().ships.remove(0);
    let f = w.fleet(fleet).unwrap();
    let voyage = navigation::ManualVoyage::new(f.cell(&w.defs), 90);
    let mut weather = w.weather_at(f.cell(&w.defs)).unwrap();
    weather.sea.wind_strength = 0;
    weather.sea.current_strength = 0;
    weather.sky = weather::Sky::Fog;
    let input = navigation::course::CourseInput {
        defs: &w.defs,
        fleet: f,
        start: &voyage,
        from: 360,
        until: 720,
        steers: &[],
        day: w.day(),
        speed_bonus: fixed::Fx::ZERO,
        mods: Default::default(),
    };
    let fog = navigation::course::velocity(&input, &voyage, Some(weather));
    weather.sky = weather::Sky::Clear;
    let clear = navigation::course::velocity(&input, &voyage, Some(weather));
    assert!(fog[0] > clear[0]);
}
#[test]
fn giant_and_clipper_build_properties_and_port_restrictions_are_real() {
    let mut giant = world(vec![Trait::Giant]);
    let fleet = giant.flagship(O).unwrap();
    let s = giant.fleet(fleet).unwrap().ships.last().unwrap();
    assert_eq!(s.capacity, giant.defs.ship(s.kind).capacity * 3);
    assert_eq!(legend_ships::crew_min(&giant.defs, s), giant.defs.ship(s.kind).crew_min * 3);
    Arc::make_mut(&mut giant.defs).rules.ships.shallow_ports.push("test_east".into());
    assert!(!giant.legend_port_allowed(giant.fleet(fleet).unwrap(), LocId(1)));
    assert!(giant.route_for(giant.fleet(fleet).unwrap(), LocId(1)).is_none());
    let clipper = world(vec![Trait::ClipperHull]);
    let s = clipper.fleet(clipper.flagship(O).unwrap()).unwrap().ships.last().unwrap();
    assert_eq!(s.capacity, fixed::mul_div(clipper.defs.ship(s.kind).capacity, 80, 100));
    assert_eq!(mechanics::ship_limit(&clipper.defs, s), 20);
}
#[test]
fn maintenance_consumes_real_cargo_and_missing_materials_damage_only_the_named_ship() {
    let mut w = world(vec![Trait::FogSail]);
    let (fleet, good) = buy(&mut w, 1);
    Arc::make_mut(&mut w.defs).legend_ships.ships[0].maintenance.insert("grain".into(), 1);
    let a = w.fleet(fleet).unwrap().ships[0].durability;
    let b = w.fleet(fleet).unwrap().ships[1].durability;
    w.end_day().unwrap();
    assert_eq!(w.fleet(fleet).unwrap().cargo.get(&good), None);
    assert_eq!(w.fleet(fleet).unwrap().ships[1].durability, b);
    w.end_day().unwrap();
    assert_eq!(w.fleet(fleet).unwrap().ships[0].durability, a);
    assert!(w.fleet(fleet).unwrap().ships[1].durability < b);
    assert!(w.agent(O).unwrap().ledger.is_balanced());
}
#[test]
fn dive_checks_location_conditions_and_has_one_persistent_salvage_roll() {
    let mut w = world(vec![Trait::Salvage]);
    let fleet = w.flagship(O).unwrap();
    let d = Arc::make_mut(&mut w.defs);
    d.legend_ships.ships[0].salvage = vec!["coin".into()];
    let id = DiscoveryId(0);
    let key = "test_dive".to_owned();
    let cell = d.loc(LocId(0)).cell;
    d.discoveries.push(manifest_core::defs::DiscoveryDef {
        key: key.clone(),
        name: "测试沉船".into(),
        cell,
        kind: manifest_core::defs::DiscoveryKind::Wreck,
        fame: 1,
        value: 1,
        lore: "这是潜水发现测试。".into(),
    });
    d.geography.places.authored.discoveries.insert(
        key,
        geo::authored::DiscoverySource {
            provenance: Default::default(),
            radius: 2,
            requires: geo::authored::DiscoveryRequirements {
                mode: geo::authored::DiscoveryMode::Dive,
                records: vec!["dive_permission".into()],
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
    let cmd = Command::Dive { owner: O, fleet, discovery: id };
    w.state.explore.discovered.remove(&id);
    w.state.explore.reported.remove(&id);
    reject(&mut w, cmd.clone());
    w.state.story2.flags.insert("dive_permission".into());
    let original = w.fleet(fleet).unwrap().location.clone();
    w.fleet_mut(fleet).unwrap().location = FleetLocation::Docked(LocId(1));
    reject(&mut w, cmd.clone());
    w.fleet_mut(fleet).unwrap().location =
        FleetLocation::AtSea(Voyage::Manual { manual: navigation::ManualVoyage::new(cell, 90) });
    reject(&mut w, cmd.clone());
    w.fleet_mut(fleet).unwrap().location = original;
    cmd.apply(&mut w).unwrap();
    assert!(w.state.explore.discovered.contains_key(&id));
    assert!(w.state.legend_ships.salvage.contains("dive:0"));
    assert!(w.item_quantity(O, "coin") <= 1);
    reject(&mut w, cmd);
    assert_eq!(restored(&w).state_hash(), w.state_hash());
}

#[test]
fn oracle_casts_use_permissions_and_one_calendar_month_without_limiting_learned_spells() {
    let mut w = world(vec![Trait::Oracle]);
    let d = Arc::make_mut(&mut w.defs);
    let mut spell = d.arcana.spells[0].clone();
    spell.key = "ship_oracle".into();
    spell.public = false;
    spell.rank = 0;
    spell.cost = arcana::Cost { cash: 10, ..Default::default() };
    spell.effect = arcana::Effect::Divination;
    d.arcana.spells.push(spell);
    d.legend_ships.ships[0].oracle_spell = Some("ship_oracle".into());
    d.history.events[0].knowledge = Some("oracle_permission".into());
    d.history.events[0].date = Some([1558, 3, 20]);
    d.history.events[0].window = Some([[1558, 1, 1], [1558, 3, 20]]);
    let cmd = Command::CastSpell { owner: O, spell: "ship_oracle".into(), target: arcana::Target::Event(EVENT.into()) };
    reject(&mut w, cmd.clone());
    assert!(w.state.legend_ships.oracle.is_empty());
    w.state.story2.flags.insert("oracle_permission".into());
    advance(&mut w, 1);
    cmd.apply(&mut w).unwrap();
    assert!(!w.oracle_ready("ship_oracle"));
    advance(&mut w, 7);
    assert_eq!(w.spell_cooldown("ship_oracle"), 0);
    reject(&mut w, cmd.clone());
    assert!(!restored(&w).oracle_ready("ship_oracle"));
    w.state.arcana.learned.insert("ship_oracle".into());
    assert!(w.oracle_ready("ship_oracle"));
    w.state.arcana.learned.remove("ship_oracle");
    let month = w.defs.calendar.date_of(w.day()).month;
    while w.defs.calendar.date_of(w.day()).month == month {
        advance(&mut w, 1);
    }
    assert!(w.oracle_ready("ship_oracle"));
    cmd.apply(&mut w).unwrap();
    assert_eq!(w.state.legend_ships.oracle["sample_legend_ship"], w.day());
}

#[test]
fn storm_rider_prevents_actual_named_ship_damage_and_leaves_ordinary_ships_exposed() {
    let mut w = world(vec![Trait::StormRider]);
    anchored(&mut w);
    let fleet = w.flagship(O).unwrap();
    let cell = w.fleet(fleet).unwrap().cell(&w.defs);
    for region in &mut Arc::make_mut(&mut w.defs).regions {
        for season in &mut region.seasons {
            season.storm_bp = 1000;
        }
    }
    let day = (w.day()..w.day() + 3650)
        .find(|day| {
            let mut probe = w.clone();
            probe.state.day = *day;
            let hit = probe.weather_at(cell).map_or(0, |v| v.storm_hit_e8);
            let mut rng = rng::Rng::derive(w.state.seed, *day, rng::Domain::Voyage, u64::from(fleet.0), 0);
            hit > 0 && (rng.below(100_000_000) as i64) < hit
        })
        .expect("测试海区在十年内有受损风暴");
    w.state.day = day;
    let before = w.fleet(fleet).unwrap().ships.clone();
    w.end_day().unwrap();
    let after = &w.fleet(fleet).unwrap().ships;
    assert!(after[0].durability < before[0].durability);
    assert_eq!(after[1].durability, before[1].durability);
    assert!(w.state.log.iter().any(|event| matches!(event.kind,LogKind::Storm{fleet:f,..}if f==fleet)));
}

#[test]
fn ship_restrictions_do_not_replace_unknown_autopilot_destination_errors() {
    let mut w = world(vec![Trait::Giant]);
    let fleet = w.flagship(O).unwrap();
    let count = w.fleet(fleet).unwrap().crew_min(&w.defs) - w.fleet(fleet).unwrap().crew;
    Command::HireCrew { owner: O, fleet, count }.apply(&mut w).unwrap();
    Command::Resupply { owner: O, fleet, food: 20, water: 20 }.apply(&mut w).unwrap();
    Arc::make_mut(&mut w.defs).manual_navigation = true;
    let cmd =
        Command::Autopilot { owner: O, fleet, dest: LocId(65535), minute: 0, stop_at_known_edge: false, route: None };
    assert_eq!(cmd.validate(&w).unwrap_err().code(), "navigation.unknown_dest");
    reject(&mut w, cmd);
}
