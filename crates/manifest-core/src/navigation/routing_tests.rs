//! H07 航线规划的测试：按用时与按距离的路不同且真走更快、三种偏好、纪录、开关关闭与没有领航员时的退路。
use super::routing::*;
use super::*;
use crate::captain::{RoleDef, RoleScope};
use crate::log::LogKind;
use crate::mates::{MateRole, RoleTarget};
use crate::nav::Terrain;
use crate::{Command, FleetId, Fx, OwnerId, RegionId, ScenarioId, testkit};
use std::sync::Arc;

/// 风与流：`wind`、`current` 都是去向（0 北，顺时针 8 向）。
fn sea(wind: u8, force: i64, current: u8, flow: i64, storm: i64) -> crate::defs::SeasonWeather {
    crate::defs::SeasonWeather {
        wind_dir: wind,
        wind_strength: force,
        current_dir: current,
        current_strength: flow,
        storm_bp: storm,
        pirate_bp: 0,
    }
}

/// 40×24 的开阔海：第 0 海区是 `y < 8` 的北带，第 1 海区是其余。港口 0、1 放在 `a`、`b`。
/// `land` 里的格子改成陆地。全图已探明，海盗、疾病、风暴受损都关掉。
fn world(
    north: crate::defs::SeasonWeather,
    south: crate::defs::SeasonWeather,
    a: Cell,
    b: Cell,
    land: &dyn Fn(Cell) -> bool,
    routing: bool,
) -> (World, FleetId) {
    let mut defs = (*testkit::tiny_defs()).clone();
    defs.manual_navigation = true;
    defs.rules.pirates.spawn_scale = Fx::ZERO;
    defs.rules.disease_bp_per_30_days = 0;
    defs.rules.explore.sight = 0;
    defs.rules.routing.enabled = routing;
    let width = defs.map.width;
    for i in 0..defs.map.terrain.len() {
        let c = Cell::new((i % usize::from(width)) as u16, (i / usize::from(width)) as u16);
        if land(c) {
            defs.map.terrain[i] = Terrain::Land;
            defs.map.region[i] = u16::MAX;
        } else {
            defs.map.terrain[i] = Terrain::Deep;
            defs.map.region[i] = u16::from(c.y >= 8);
        }
    }
    defs.regions[0].rect = (0, 0, width - 1, 7);
    defs.regions[1].rect = (0, 8, width - 1, defs.map.height - 1);
    defs.regions[0].seasons = [north; 4];
    defs.regions[1].seasons = [south; 4];
    defs.locations[0].cell = a;
    defs.locations[1].cell = b;
    defs.locations[2].cell = Cell::new(20, 2);
    defs.captain.roles.push(RoleDef {
        key: NAVIGATOR_ROLE.into(),
        name: "领航员".into(),
        ability: "navigation".into(),
        hooks: Vec::new(),
        scope: RoleScope::Fleet,
        legacy: None,
        desc: String::new(),
    });
    let mut w = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
    w.state.explore.cells.fill(u64::MAX);
    let id = w.fleets_of(OwnerId::Player).next().unwrap().id;
    w.fleet_mut(id).unwrap().location = FleetLocation::Docked(LocId(0));
    w.fleet_mut(id).unwrap().food = 500;
    w.fleet_mut(id).unwrap().water = 500;
    (w, id)
}

/// 给舰队派一位领航员（任何一位还没受雇的航海士）。
fn hire_navigator(w: &mut World, fleet: FleetId) {
    let role = w.defs.captain.roles.iter().position(|r| r.key == NAVIGATOR_ROLE).unwrap() as u16;
    let (_, mate) = w.state.mates.iter_mut().find(|(_, m)| m.owner.is_none()).unwrap();
    mate.owner = Some(OwnerId::Player);
    mate.role = MateRole::Assigned { role, target: RoleTarget::Fleet(fleet) };
}

fn autopilot(fleet: FleetId, route: Option<RoutePref>) -> Command {
    Command::Autopilot { owner: OwnerId::Player, fleet, dest: LocId(1), minute: 0, stop_at_known_edge: false, route }
}

/// 一直过日子，直到舰队靠上港口 1；返回用了几天（到 `limit` 天还没到为 None）。
fn sail_days(mut w: World, fleet: FleetId, limit: u32) -> (Option<u32>, World) {
    let start = w.day();
    for _ in 0..limit {
        w.end_day().unwrap();
        if w.fleet(fleet).unwrap().docked_at() == Some(LocId(1)) {
            return (Some(w.day() - start), w);
        }
    }
    (None, w)
}

fn path_for(w: &World, fleet: FleetId, pref: RoutePref) -> Vec<Cell> {
    let f = w.fleet(fleet).unwrap();
    w.planned_sea_path(f, f.cell(&w.defs), LocId(1), false, pref).unwrap().path
}

/// 北带顺风顺流、南带顶风逆流：两港都在南带。
fn detour_world() -> (World, FleetId) {
    world(sea(2, 8, 2, 2, 0), sea(6, 7, 6, 1, 0), Cell::new(3, 16), Cell::new(36, 16), &|_| false, true)
}

#[test]
fn timed_route_differs_from_the_distance_route_and_the_scripted_voyage_arrives_sooner() {
    let (mut w, id) = detour_world();
    hire_navigator(&mut w, id);
    let distance = path_for(&w, id, RoutePref::Distance);
    let fastest = path_for(&w, id, RoutePref::Fastest);
    assert_ne!(distance, fastest, "同一对港口、同一个月，按用时与按距离的路不同");
    assert!(distance.iter().all(|c| c.y >= 8), "按距离的路就在南带里直走");
    assert!(fastest.iter().any(|c| c.y < 8), "按用时的路绕进顺风顺流的北带");
    let f = w.fleet(id).unwrap();
    assert!(w.route_minutes(f, &fastest) < w.route_minutes(f, &distance));
    // 真走（逐分钟积分、每天的风照天气函数变化）：按用时的先到
    let mut by_distance = w.clone();
    autopilot(id, Some(RoutePref::Distance)).apply(&mut by_distance).unwrap();
    let mut by_time = w.clone();
    autopilot(id, None).apply(&mut by_time).unwrap();
    let (slow, _) = sail_days(by_distance, id, 120);
    let (fast, after) = sail_days(by_time, id, 120);
    let fast = fast.expect("按用时的航线到得了港");
    assert!(slow.is_none_or(|slow| fast < slow), "按用时 {fast} 天，按距离 {slow:?} 天");
    // 首航有了纪录
    let record = after.state.routing.record(LocId(0), LocId(1)).expect("首航纪录");
    assert_eq!(record.days(), fast.max(1));
}

#[test]
fn safe_preference_keeps_out_of_the_stormy_band() {
    // 两带同风，北带当月风暴多；两港都在北带
    let (mut w, id) =
        world(sea(0, 5, 0, 0, 2_000), sea(0, 5, 0, 0, 100), Cell::new(3, 4), Cell::new(36, 4), &|_| false, true);
    hire_navigator(&mut w, id);
    let fastest = path_for(&w, id, RoutePref::Fastest);
    let safe = path_for(&w, id, RoutePref::Safe);
    let stormy = |p: &[Cell]| p.iter().filter(|c| c.y < 8).count();
    assert!(stormy(&safe) * 3 < stormy(&fastest), "稳妥 {} 格在风暴带，最快 {} 格", stormy(&safe), stormy(&fastest));
    let f = w.fleet(id).unwrap();
    assert!(w.route_minutes(f, &fastest) <= w.route_minutes(f, &safe), "最快确实不比稳妥慢");
    // 预览里有风暴季的提示（最快的路经过北带）
    let plan = w.plan_route(id, &[LocId(1)], Some(RoutePref::Fastest)).unwrap();
    assert!(plan.hazards.iter().any(|h| h.kind == HazardKind::Storm && h.region == Some(RegionId(0))));
}

#[test]
fn coastal_preference_stays_within_n_cells_of_land() {
    // 南边是陆，中段的岸往南凹进去：直线离岸 6 格，沿岸的路要贴着凹进去的岸走
    let land = |c: Cell| c.y >= 20 && !((10..30).contains(&c.x) && c.y < 23);
    let (mut w, id) = world(sea(0, 5, 0, 0, 0), sea(0, 5, 0, 0, 0), Cell::new(3, 17), Cell::new(36, 17), &land, true);
    hire_navigator(&mut w, id);
    let n = i64::from(w.defs.rules.routing.coast_cells);
    let near = |c: &Cell| {
        (-n..=n).any(|dy| {
            (-n..=n).any(|dx| {
                let (x, y) = (i64::from(c.x) + dx, i64::from(c.y) + dy);
                (0..40).contains(&x) && (0..24).contains(&y) && land(Cell::new(x as u16, y as u16))
            })
        })
    };
    let fastest = path_for(&w, id, RoutePref::Fastest);
    let coastal = path_for(&w, id, RoutePref::Coastal);
    assert!(fastest.iter().any(|c| !near(c)), "最快的路有离岸超过 {n} 格的一段");
    assert!(coastal.iter().all(near), "沿岸的路每一格都离岸不超过 {n} 格：{coastal:?}");
    assert!(coastal.iter().any(|c| (10..30).contains(&c.x) && c.y >= 20), "沿岸的路进了凹进去的那段岸");
}

#[test]
fn records_are_kept_per_port_pair_and_fame_is_given_for_first_voyages_and_broken_records() {
    let (mut w, id) = detour_world();
    let fame = |w: &World| w.agent(OwnerId::Player).unwrap().fame;
    let rules = w.defs.rules.routing.clone();
    let start = fame(&w);
    let trip = |w: &mut World, dest: LocId, days: u32, minute: u16| {
        w.fleet_mut(id).unwrap().location = FleetLocation::Docked(LocId(0));
        w.note_route_departure(id, 100);
        w.state.day += days;
        w.note_route_arrival(id, dest, minute)
    };
    // 首航：五天零一百分钟
    let first = trip(&mut w, LocId(1), 5, 200).expect("首航立纪录");
    assert_eq!(first.minutes, 5 * 1440 + 100);
    assert_eq!(first.days(), 6);
    assert_eq!(fame(&w), start + rules.first_fame);
    assert!(w.state.routing.departures.is_empty());
    // 慢了：不破纪录、不给名声
    assert!(trip(&mut w, LocId(1), 7, 0).is_none());
    assert_eq!(fame(&w), start + rules.first_fame);
    // 快了：破纪录
    let broken = trip(&mut w, LocId(1), 4, 0).expect("破纪录");
    assert_eq!(broken.minutes, 4 * 1440 - 100);
    assert_eq!(fame(&w), start + rules.first_fame + rules.record_fame);
    let log = w.state.log.iter().rev().find(|e| matches!(e.kind, LogKind::RouteRecord { .. })).unwrap();
    assert!(matches!(log.kind, LogKind::RouteRecord { previous: 6, days: 4, .. }));
    assert!(w.state.log.iter().any(|e| matches!(e.kind, LogKind::RouteFirst { days: 6, .. })));
    // 太短的首航照记纪录、不给名声；回到出发港不算
    assert!(trip(&mut w, LocId(2), 1, 0).is_some());
    assert_eq!(fame(&w), start + rules.first_fame + rules.record_fame);
    assert!(trip(&mut w, LocId(0), 9, 0).is_none());
    assert_eq!(w.state.routing.records.len(), 2);
    // 纪录进存档、读回来一样
    let saved = serde_json::to_string(&w.state).unwrap();
    let loaded = World::from_snapshot(w.defs.clone(), serde_json::from_str(&saved).unwrap()).unwrap();
    assert_eq!(loaded.state.routing, w.state.routing);
    // 规则关着时什么都不记
    let (mut off, id) =
        world(sea(2, 8, 2, 2, 0), sea(6, 7, 6, 1, 0), Cell::new(3, 16), Cell::new(36, 16), &|_| false, false);
    off.note_route_departure(id, 0);
    off.state.day += 5;
    assert!(off.note_route_arrival(id, LocId(1), 0).is_none());
    assert!(off.state.routing.is_empty());
}

#[test]
fn with_the_switch_off_the_autopilot_is_the_old_distance_search() {
    let (mut w, id) =
        world(sea(2, 8, 2, 2, 0), sea(6, 7, 6, 1, 0), Cell::new(3, 16), Cell::new(36, 16), &|_| false, false);
    hire_navigator(&mut w, id);
    let f = w.fleet(id).unwrap();
    assert_eq!(w.routing_tier(f), RoutingTier::Distance, "开关关着，有领航员也只按距离");
    assert_eq!(w.route_prefs(f), [RoutePref::Distance]);
    let old = w.known_sea_path(f.cell(&w.defs), LocId(1), false).unwrap();
    // 不写偏好与写“按距离”都落到原来的寻路上；写按用时的偏好被内核拒绝且不改状态
    for route in [None, Some(RoutePref::Distance)] {
        let mut a = w.clone();
        autopilot(id, route).apply(&mut a).unwrap();
        assert_eq!(a.state.navigation.pending[&id].autopilots[0].pilot, old);
    }
    for route in [RoutePref::Fastest, RoutePref::Safe, RoutePref::Coastal] {
        let before = w.state.clone();
        assert_eq!(autopilot(id, Some(route)).apply(&mut w).unwrap_err().code(), "navigation.no_navigator");
        assert_eq!(w.state, before);
    }
    // 命令不写偏好时序列化与加字段之前相同；整段航程之后存档里没有 routing
    let json = serde_json::to_string(&autopilot(id, None)).unwrap();
    assert!(!json.contains("route"), "{json}");
    autopilot(id, None).apply(&mut w).unwrap();
    let (days, after) = sail_days(w, id, 120);
    assert!(days.is_some());
    assert!(after.state.routing.is_empty());
    assert!(!serde_json::to_string(&after.state).unwrap().contains("routing"));
}

#[test]
fn without_a_navigator_the_autopilot_falls_back_to_the_distance_search() {
    let (mut w, id) = detour_world();
    let f = w.fleet(id).unwrap();
    assert_eq!(w.routing_tier(f), RoutingTier::Distance);
    assert_eq!(w.resolve_route_pref(f, None).unwrap(), RoutePref::Distance);
    let old = w.known_sea_path(f.cell(&w.defs), LocId(1), false).unwrap();
    let mut a = w.clone();
    autopilot(id, None).apply(&mut a).unwrap();
    assert_eq!(a.state.navigation.pending[&id].autopilots[0].pilot, old, "没有领航员：缺省就是按距离");
    assert_eq!(autopilot(id, Some(RoutePref::Fastest)).apply(&mut w).unwrap_err().code(), "navigation.no_navigator");
    let plan = w.plan_route(id, &[LocId(1)], None).unwrap();
    assert_eq!((plan.tier, plan.pref), (RoutingTier::Distance, RoutePref::Distance));
    assert_eq!(plan.legs[0].path, old.path);
    // 派了领航员就能按用时
    hire_navigator(&mut w, id);
    let f = w.fleet(id).unwrap();
    assert_eq!(w.routing_tier(f), RoutingTier::Timed);
    assert_eq!(w.route_prefs(f).len(), 4);
    assert_eq!(w.resolve_route_pref(f, None).unwrap(), RoutePref::Fastest);
}

#[test]
fn route_plans_chain_stops_estimate_supplies_and_do_not_touch_the_world() {
    let (mut w, id) = detour_world();
    hire_navigator(&mut w, id);
    let before = w.state.clone();
    let plan = w.plan_route(id, &[LocId(1), LocId(2)], None).unwrap();
    assert_eq!(w.state, before, "预览只读");
    assert_eq!(plan.pref, RoutePref::Fastest);
    assert_eq!(plan.legs.len(), 2);
    assert_eq!(plan.legs[0].from, Some(LocId(0)));
    assert_eq!(plan.legs[1].from, Some(LocId(1)));
    assert_eq!(plan.legs[1].path.first(), Some(&w.defs.loc(LocId(1)).cell), "第二段从第一站出发");
    assert_eq!(plan.minutes, plan.legs.iter().map(|l| l.minutes).sum::<i64>());
    assert_eq!(plan.days, (plan.minutes + 1439) / 1440);
    let f = w.fleet(id).unwrap();
    assert_eq!(plan.required, f.supplies_required(&w.defs, plan.days));
    assert_eq!(plan.have, [f.food, f.water]);
    // 第一段与命令真用的路径相同
    assert_eq!(plan.legs[0].path, path_for(&w, id, RoutePref::Fastest));
    // 同样的查询结果相同（确定性）
    assert_eq!(w.plan_route(id, &[LocId(1), LocId(2)], None).unwrap(), plan);
}
