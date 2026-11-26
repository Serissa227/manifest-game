//! P05：合并出航查询后，仍沿用缓存路径、帷幕 A* 与海上改航的逐格结果。
use manifest_core::realms::{KeyGroup, RealmDef, RealmStatus, Veil};
use manifest_core::testkit::tiny_defs;
use manifest_core::world::{FleetLocation, RouteVoyage, Voyage};
use manifest_core::{Cell, Command, CommandOutcome, FleetId, Fx, LocId, OwnerId, ScenarioId, World};
use std::sync::Arc;

fn world() -> World {
    World::new(tiny_defs(), ScenarioId(0), 42).expect("小世界")
}

/// 保留优化前两次独立查询作为参考，检查实际命令返回值、路径与查询纯度。
fn sail_like_reference(world: &mut World, fleet: FleetId, dest: LocId) {
    let before = world.state.clone();
    let ship = world.fleet(fleet).expect("舰队");
    let owner = ship.owner;
    let path = world.route_for(ship, dest).expect("参考路径");
    let days = world.estimate_days(ship, dest).unwrap_or(0);
    assert_eq!(world.state, before, "参考查询不能改变状态");
    let outcome = Command::SetSail { owner, fleet, dest }.apply(world).expect("出航");
    assert_eq!(outcome, CommandOutcome::Sailed { days_estimate: days });
    let FleetLocation::AtSea(Voyage::Route(voyage)) = &world.fleet(fleet).expect("舰队").location else {
        panic!("应按路线航行");
    };
    assert_eq!(voyage.path, path);
    assert_eq!(voyage.dest, dest);
    assert_eq!(voyage.step, 0);
    assert_eq!(voyage.leg_progress, Fx::ZERO);
}

fn veil(world: &mut World, cell: Cell, ports: Vec<String>) {
    Arc::make_mut(&mut world.defs).realms.realms.push(RealmDef {
        key: "route_probe".into(),
        name: "测试帷幕".into(),
        basis: None,
        sources: vec![],
        veil: Veil { mark: None, cells: vec![cell], push: 1 },
        key_items: vec![],
        key_any: vec![KeyGroup { flags: vec!["route_key".into()], ..Default::default() }],
        also: vec![],
        ports,
        hint: String::new(),
        knowledge: None,
        rules: vec![],
        otherworld: None,
    });
}

#[test]
fn cached_departures_keep_cells_and_estimates_across_periods() {
    let initial = world();
    let fleet = initial.flagship(OwnerId::Player).expect("旗舰");
    for day in [0, 90, 180, 270] {
        for dest in [LocId(1), LocId(2)] {
            let mut current = initial.clone();
            current.state.day = day;
            sail_like_reference(&mut current, fleet, dest);
        }
    }
}

#[test]
fn realm_search_keeps_detours_and_rechecks_opened_veils() {
    let mut initial = world();
    let fleet = initial.flagship(OwnerId::Player).expect("旗舰");
    let path = initial.route_for(initial.fleet(fleet).expect("旗舰"), LocId(1)).expect("路径");
    let cell = path.iter().copied().find(|cell| initial.defs.locations.iter().all(|l| l.cell != *cell)).expect("海格");
    veil(&mut initial, cell, vec![]);
    let detour = initial.route_for(initial.fleet(fleet).expect("旗舰"), LocId(1)).expect("绕行");
    assert!(!detour.contains(&cell), "无钥匙时不能穿过帷幕");
    let mut closed = initial.clone();
    sail_like_reference(&mut closed, fleet, LocId(1));
    initial.state.realms.states.insert("route_probe".into(), RealmStatus::Open);
    sail_like_reference(&mut initial, fleet, LocId(1));
}

#[test]
fn closed_destination_is_rejected_atomically_then_can_open() {
    let mut current = world();
    let fleet = current.flagship(OwnerId::Player).expect("旗舰");
    let dest = LocId(1);
    let (cell, key) = (current.defs.loc(dest).cell, current.defs.loc(dest).key.clone());
    veil(&mut current, cell, vec![key]);
    let before = current.state.clone();
    let expected = current.check_navigation(current.fleet(fleet).expect("旗舰"), dest).expect_err("帷幕拒绝");
    assert_eq!(Command::SetSail { owner: OwnerId::Player, fleet, dest }.apply(&mut current), Err(expected));
    assert_eq!(current.state, before);
    current.state.realms.states.insert("route_probe".into(), RealmStatus::Open);
    sail_like_reference(&mut current, fleet, dest);
}

#[test]
fn rerouting_at_sea_keeps_the_original_search_and_estimate() {
    for with_veil in [false, true] {
        let mut current = world();
        let fleet = current.flagship(OwnerId::Player).expect("旗舰");
        let path = current.route_for(current.fleet(fleet).expect("旗舰"), LocId(1)).expect("路径");
        current.state.fleets.get_mut(&fleet).expect("旗舰").location =
            FleetLocation::AtSea(Voyage::Route(RouteVoyage { dest: LocId(1), path, step: 1, leg_progress: Fx::ZERO }));
        if with_veil {
            // 目的地以外的海格形成帷幕，仍走原有的动态 A*。
            let cell = current.defs.loc(LocId(0)).cell;
            veil(&mut current, cell, vec![]);
        }
        sail_like_reference(&mut current, fleet, LocId(2));
    }
}
