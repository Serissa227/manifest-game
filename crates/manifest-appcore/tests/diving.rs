//! B12：潜水入口使用命令校验，查询不改变世界。
use manifest_appcore::{
    Locales,
    views::{self, Ctx},
};
use manifest_core::{
    geo::authored::*,
    navigation::{ManualVoyage, Sail},
    world::{FleetLocation, Voyage},
    *,
};
use manifest_data::Locale;
use serde_json::{Value, json};
use std::sync::Arc;

fn world() -> World {
    let mut defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let d = Arc::make_mut(&mut defs);
    d.manual_navigation = true;
    d.navigation.hide_unknown_ports = true;
    let cell = d.loc(LocId(0)).cell;
    d.discoveries.push(defs::DiscoveryDef {
        key: "test_dive".into(),
        name: "测试潜水点".into(),
        cell,
        kind: defs::DiscoveryKind::Wreck,
        fame: 1,
        value: 1,
        lore: "这是潜水测试。".into(),
    });
    d.geography.places.authored.discoveries.insert(
        "test_dive".into(),
        DiscoverySource {
            provenance: Default::default(),
            radius: 8,
            requires: DiscoveryRequirements {
                mode: DiscoveryMode::Dive,
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
    World::new(defs, ScenarioId(0), 42).unwrap()
}

fn check(w: &World, enabled: bool) {
    let locales = Locales::load(&manifest_data::find_data_dir().unwrap()).unwrap();
    let fleet = w.flagship(OwnerId::Player).unwrap();
    let cmd = Command::Dive { owner: OwnerId::Player, fleet, discovery: DiscoveryId(0) };
    let expected = cmd.validate(w);
    assert_eq!(expected.is_ok(), enabled);
    let before = w.state.clone();
    for locale in Locale::ALL {
        let ctx = Ctx { names: &w.defs, ..locales.ctx(locale) };
        let v = serde_json::to_value(views::discoveries_view_in(ctx, w)).unwrap();
        let rows = v["dives"].as_array().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["fleet"], fleet.0);
        assert_eq!(rows[0]["discovery"], 0);
        assert_eq!(rows[0]["enabled"], enabled);
        match &expected {
            Ok(()) => assert!(rows[0].get("blocked_reason").is_none()),
            Err(error) => assert_eq!(rows[0]["blocked_reason"], ctx.error(error)),
        }
    }
    assert_eq!(before, w.state);
}

#[test]
fn dive_options_match_docked_furled_moving_and_already_found_commands() {
    let mut w = world();
    check(&w, false);
    w.state.story2.flags.insert("dive_permission".into());
    check(&w, true);
    let fleet = w.flagship(OwnerId::Player).unwrap();
    let cell = w.defs.loc(LocId(0)).cell;
    let mut manual = ManualVoyage::new(Cell::new(cell.x + 4, cell.y + 4), 90);
    w.fleet_mut(fleet).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual: manual.clone() });
    check(&w, false);
    manual.sail = Sail::Furled;
    w.fleet_mut(fleet).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual });
    check(&w, true);
    Command::Dive { owner: OwnerId::Player, fleet, discovery: DiscoveryId(0) }.apply(&mut w).unwrap();
    check(&w, false);
}

#[test]
fn dive_options_hide_unknown_discoveries_and_never_include_foreign_fleets() {
    let mut w = world();
    w.state.explore.cells.fill(0);
    w.state.explore.discovered.clear();
    w.state.explore.rumors.clear();
    let view = |w: &World| serde_json::to_value(views::discoveries_view(w)).unwrap();
    assert!(view(&w).get("dives").is_none());
    w.state.explore.rumors.insert(DiscoveryId(0), explore::Rumor { day: 0, region: RegionId(0) });
    let fleet = w.flagship(OwnerId::Player).unwrap();
    let mut foreign = w.fleet(fleet).unwrap().clone();
    foreign.id = FleetId(10000);
    foreign.owner = OwnerId::Company(CompanyId(0));
    w.state.fleets.insert(foreign.id, foreign);
    let v = view(&w);
    let rows = v["dives"].as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["fleet"], fleet.0);
    assert!(rows[0].get("name").is_none());
    assert!(rows[0].get("x").is_none());
}

#[test]
fn dive_static_flag_is_optional_and_classic_views_keep_their_shape() {
    let w = world();
    let v = serde_json::to_value(views::static_view(&w.defs)).unwrap();
    assert_eq!(v["discoveries"][0]["dive"], true);
    let defs = manifest_data::load_shared(&manifest_data::find_data_dir().unwrap()).unwrap();
    let classic = World::new(defs, ScenarioId(0), 42).unwrap();
    let static_view = serde_json::to_value(views::static_view(&classic.defs)).unwrap();
    assert!(static_view["discoveries"].as_array().unwrap().iter().all(|d| d.get("dive").is_none()));
    let discovery_view = serde_json::to_value(views::discoveries_view(&classic)).unwrap();
    assert_eq!(discovery_view.get("dives"), None::<&Value>);
    assert_eq!(discovery_view["total"], json!(classic.defs.discoveries.len()));
}

#[test]
fn each_player_fleet_uses_its_own_dive_validation() {
    let mut w = world();
    w.state.story2.flags.insert("dive_permission".into());
    let first = w.flagship(OwnerId::Player).unwrap();
    let mut second = w.fleet(first).unwrap().clone();
    second.id = FleetId(10001);
    let mut manual = ManualVoyage::new(Cell::new(60, 2), 90);
    manual.sail = Sail::Furled;
    second.location = FleetLocation::AtSea(Voyage::Manual { manual });
    w.state.fleets.insert(second.id, second);
    let before = w.state.clone();
    let ctx = Ctx::plain(&w.defs);
    let v = serde_json::to_value(views::discoveries_view_in(ctx, &w)).unwrap();
    let rows = v["dives"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["enabled"], true);
    assert_eq!(rows[1]["enabled"], false);
    for row in rows {
        let fleet = FleetId(row["fleet"].as_u64().unwrap() as u32);
        let checked = Command::Dive { owner: OwnerId::Player, fleet, discovery: DiscoveryId(0) }.validate(&w);
        assert_eq!(row["enabled"], checked.is_ok());
        if let Err(error) = checked {
            assert_eq!(row["blocked_reason"], ctx.error(&error));
        }
    }
    assert_eq!(w.state, before);
}
