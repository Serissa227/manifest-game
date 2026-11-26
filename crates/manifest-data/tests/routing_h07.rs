//! 第九批 H07“航线规划”：真实寰宇数据上的按用时寻路。
//!
//! - 三条以上的跨洋长航线：按距离与按用时三种偏好各寻一次路，打印耗时（交接文档里的性能数字取自这里）；
//!   按用时“最快”的估计航时不比按距离的路长（A* 在同一个步时模型下最优）；
//! - 一条跨大西洋的脚本航程：同一个月出发，按距离与按用时各真走一遍（逐分钟积分、每天真实天气），
//!   比较到港的天数；
//! - 寰宇的规则确实打开了，领航员岗位的键对得上。
//!
//! 不调用网络；只读已提交的 `data/`。耗时用 `std::time::Instant` 量，只打印、不断言（机器上可能同时有别的编译）。

use manifest_core::mates::{MateRole, RoleTarget};
use manifest_core::navigation::routing::{NAVIGATOR_ROLE, RoutePref, RoutingTier};
use manifest_core::world::FleetLocation;
use manifest_core::{Command, FleetId, LocId, OwnerId, ScenarioId, StaticData, World};
use std::sync::{Arc, OnceLock};
use std::time::Instant;

fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        manifest_data::load_world(&root, "terra16").expect("真实寰宇完整加载")
    })
    .clone()
}

fn port(defs: &StaticData, key: &str) -> LocId {
    LocId::from_idx(defs.locations.iter().position(|l| l.key == key).unwrap_or_else(|| panic!("没有港口 {key}")))
}

/// 寰宇的自由航海新世界：全图已探明，玩家舰队停在 `home`，粮水充足；`navigator` 时派一位领航员。
fn world(defs: &Arc<StaticData>, home: LocId, navigator: bool) -> (World, FleetId) {
    let scenario = defs.scenarios.iter().position(|s| s.key == "free_1557").expect("自由航海剧本");
    let mut w = World::new(defs.clone(), ScenarioId::from_idx(scenario), 7).expect("寰宇新世界");
    w.state.explore.cells.fill(u64::MAX);
    let id = w.fleets_of(OwnerId::Player).next().expect("玩家舰队").id;
    let f = w.fleet_mut(id).unwrap();
    f.location = FleetLocation::Docked(home);
    f.food = 2_000;
    f.water = 2_000;
    if navigator {
        let role = defs.captain.roles.iter().position(|r| r.key == NAVIGATOR_ROLE).expect("领航员岗位") as u16;
        let (_, mate) = w.state.mates.iter_mut().find(|(_, m)| m.owner.is_none()).expect("有没受雇的航海士");
        mate.owner = Some(OwnerId::Player);
        mate.role = MateRole::Assigned { role, target: RoleTarget::Fleet(id) };
    }
    (w, id)
}

// 后两条在 1557 年的剧本里不通（目的港还没开），留着量“很快判不通”的耗时；伦敦—卡亚俄要绕南美，是这里最长的一次搜索
const ROUTES: [(&str, &str); 8] = [
    ("lisbon", "havana"),
    ("lisbon", "goa"),
    ("london", "goa"),
    ("lisbon", "callao"),
    ("seville", "salvador"),
    ("mozambique_island", "goa"),
    ("malacca", "nagasaki"),
    ("acapulco", "manila"),
];

#[test]
fn terra16_turns_routing_on_and_the_navigator_post_unlocks_timed_routes() {
    let defs = defs();
    assert!(defs.rules.routing.enabled, "寰宇打开 [routing]");
    let lisbon = port(&defs, "lisbon");
    let (w, id) = world(&defs, lisbon, false);
    assert_eq!(w.routing_tier(w.fleet(id).unwrap()), RoutingTier::Distance);
    let (w, id) = world(&defs, lisbon, true);
    assert_eq!(w.routing_tier(w.fleet(id).unwrap()), RoutingTier::Timed);
}

#[test]
fn long_ocean_routes_by_distance_and_by_time_with_timings() {
    let defs = defs();
    let mut done = 0;
    let mut differ = 0;
    for (from, to) in ROUTES {
        let (a, b) = (port(&defs, from), port(&defs, to));
        let (w, id) = world(&defs, a, true);
        let f = w.fleet(id).unwrap().clone();
        let start = f.cell(&defs);
        let mut line = format!("{from} → {to}：");
        let mut estimate = Vec::new();
        for pref in RoutePref::ALL {
            // 第一次含分配；量第二次（同一条查询，结果相同）
            let first = w.planned_sea_path(&f, start, b, false, pref);
            let t = Instant::now();
            let again = w.planned_sea_path(&f, start, b, false, pref);
            let ms = t.elapsed().as_secs_f64() * 1000.0;
            assert_eq!(first.as_ref().map(|p| &p.path).ok(), again.as_ref().map(|p| &p.path).ok(), "寻路是确定的");
            match again {
                Ok(p) => {
                    let minutes = w.route_minutes(&f, &p.path);
                    line +=
                        &format!(" {}={:.1}ms/{}格/估{:.1}天", pref.key(), ms, p.path.len(), minutes as f64 / 1440.0);
                    estimate.push((pref, minutes, p.path));
                }
                Err(e) => line += &format!(" {}={:.1}ms/不通({})", pref.key(), ms, e.code()),
            }
        }
        eprintln!("{line}");
        let get = |pref| estimate.iter().find(|(p, ..)| *p == pref);
        if let (Some(d), Some(t)) = (get(RoutePref::Distance), get(RoutePref::Fastest)) {
            done += 1;
            assert!(t.1 <= d.1, "{from} → {to}：最快的估计 {} 分钟不应长于按距离的 {} 分钟", t.1, d.1);
            differ += usize::from(t.2 != d.2);
        }
    }
    assert!(done >= 3, "至少三条跨洋航线寻得到路（{done}）");
    // 多站预览（应用层的 route_plan 用的就是它）：里斯本 → 萨尔瓦多 → 哈瓦那 → 里斯本
    let (lisbon, salvador, havana) = (port(&defs, "lisbon"), port(&defs, "salvador"), port(&defs, "havana"));
    let (w, id) = world(&defs, lisbon, true);
    for pref in RoutePref::ALL {
        let t = Instant::now();
        let plan = w.plan_route(id, &[salvador, havana, lisbon], Some(pref)).expect("多站预览");
        eprintln!(
            "多站预览 里斯本→萨尔瓦多→哈瓦那→里斯本 {}：{:.1}ms，{} 段，全程约 {} 天，风险提示 {} 条",
            pref.key(),
            t.elapsed().as_secs_f64() * 1000.0,
            plan.legs.len(),
            plan.days,
            plan.hazards.len()
        );
        assert_eq!(plan.legs.len(), 3);
    }
    assert!(differ >= 1, "至少一条航线按用时与按距离不同");
}

/// 一天天真走，直到靠上 `dest`；返回天数（没到时为 None）与一句结局（到港、在别处靠港、舰队没了、到期还在海上）。
fn sail(mut w: World, id: FleetId, dest: LocId, route: Option<RoutePref>, limit: u32) -> (Option<u32>, String) {
    Command::Autopilot { owner: OwnerId::Player, fleet: id, dest, minute: 0, stop_at_known_edge: false, route }
        .apply(&mut w)
        .expect("自动领航命令");
    let start = w.day();
    for _ in 0..limit {
        w.end_day().expect("日结");
        let Ok(f) = w.fleet(id) else { return (None, format!("第 {} 天舰队没了", w.day() - start)) };
        if f.docked_at() == Some(dest) {
            return (Some(w.day() - start), "到港".into());
        }
        if let Some(other) = f.docked_at() {
            return (None, format!("第 {} 天在 {} 靠港", w.day() - start, w.defs.loc(other).key));
        }
    }
    let f = w.fleet(id).expect("舰队");
    let cell = f.cell(&w.defs);
    let pilot = match &f.location {
        FleetLocation::AtSea(manifest_core::world::Voyage::Manual { manual }) => {
            format!("领航 {:?}，帆 {:?}", manual.autopilot.map(|d| w.defs.loc(d).key.clone()), manual.sail)
        }
        _ => String::new(),
    };
    (None, format!("{limit} 天后还在海上，停在 ({}, {})，{pilot}，粮 {} 水 {}", cell.x, cell.y, f.food, f.water))
}

#[test]
fn a_scripted_atlantic_voyage_by_time_arrives_no_later_than_by_distance() {
    let defs = defs();
    let (a, b) = (port(&defs, "lisbon"), port(&defs, "havana"));
    let (w, id) = world(&defs, a, true);
    let t = Instant::now();
    let (by_distance, why_distance) = sail(w.clone(), id, b, Some(RoutePref::Distance), 120);
    let (by_time, why_time) = sail(w, id, b, Some(RoutePref::Fastest), 120);
    eprintln!(
        "里斯本 → 哈瓦那 脚本航程：按距离 {by_distance:?} 天（{why_distance}），按用时 {by_time:?} 天（{why_time}）（两趟共 {:.1} 秒）",
        t.elapsed().as_secs_f64()
    );
    let by_time = by_time.expect("按用时到得了港");
    assert!(by_distance.is_none_or(|d| by_time <= d), "按用时 {by_time} 天，按距离 {by_distance:?} 天");
}
