//! 细碰撞（第九批 M02）：细海岸挡船、领航绕细层的陆、旧存档挪回水上、确定性。
//! 夹具都是合成的小细图层，不依赖真实数据文件（真实数据的检查在 `manifest-data/tests/fine_collision.rs`）。
use super::autopilot::Pilot;
use super::course::*;
use super::fine_pilot::{Aim, FineWindow};
use super::*;
use crate::defs::SeasonWeather;
use crate::log::LogKind;
use crate::nav::{FineCoast, NavTable, Terrain};
use crate::weather::{DayWeather, Sky};
use crate::{Command, FleetId, Fx, OwnerId, RegionId, ScenarioId, StaticData, testkit};
use std::sync::Arc;

const SUB: u16 = 24;
const HOME: Cell = Cell::new(2, 15);
const DEST: Cell = Cell::new(8, 15);
/// 第 15 行格心的纵坐标。
const ROW: i64 = 15 * 256 + 128;

/// 细海岸夹具：`land(粗格, 细格 x, 细格 y)` 指的细格是陆，其余全是水。
fn coast(defs: &StaticData, land: impl Fn(Cell, u16, u16) -> bool) -> Arc<FineCoast> {
    let s = u32::from(SUB);
    let water = |fx: u32, fy: u32| !land(Cell::new((fx / s) as u16, (fy / s) as u16), (fx % s) as u16, (fy % s) as u16);
    Arc::new(FineCoast::from_fn(defs.map.width, defs.map.height, SUB, water).unwrap())
}

/// 粗格 `cell` 里细格 `(fx, fy)` 的中点。
fn at(cell: Cell, fx: i64, fy: i64) -> SubCell {
    SubCell { x: i64::from(cell.x) * 256 + (fx * 256 + 128) / 24, y: i64::from(cell.y) * 256 + (fy * 256 + 128) / 24 }
}

fn on_water(defs: &StaticData, course: &Course) -> bool {
    let fine = defs.fine_coast.as_deref().unwrap();
    course.points.iter().all(|p| fine.water_at(p.pos.x, p.pos.y))
}

fn land_stops(course: &Course) -> Vec<u16> {
    course.stops.iter().filter(|s| s.kind == StopKind::Land).map(|s| s.minute).collect()
}

// ───────────────────────────── 碰撞（积分器） ─────────────────────────────

/// 全图是海的小世界；两个港口摆在第 15 行的 (2,15) 与 (8,15)。
fn open_sea() -> (StaticData, crate::world::Fleet) {
    let mut defs = (*testkit::tiny_defs()).clone();
    defs.manual_navigation = true;
    defs.map.terrain.fill(Terrain::Deep);
    defs.map.region.fill(0);
    defs.locations[0].cell = HOME;
    defs.locations[1].cell = DEST;
    let world = World::new(Arc::new(defs.clone()), ScenarioId(0), 42).unwrap();
    let fleet = world.fleets_of(OwnerId::Player).next().unwrap().clone();
    defs.nav = Arc::new(NavTable::build(&defs.map, &defs.regions, defs.locations.len(), &[]));
    (defs, fleet)
}

/// 晴天、没有洋流；`wind_dir` 是风的去向（0 = 向北吹，顺时针 8 方向）。
fn wind(wind_dir: u8, wind_strength: i64) -> DayWeather {
    DayWeather {
        region: RegionId(0),
        day: 0,
        sky: Sky::Clear,
        storm_hit_e8: 0,
        sea: SeasonWeather { wind_dir, wind_strength, current_dir: 0, current_strength: 0, storm_bp: 0, pirate_bp: 0 },
    }
}

fn day(defs: &StaticData, fleet: &crate::world::Fleet, start: &ManualVoyage, weather: DayWeather) -> Course {
    integrate_course(
        CourseInput {
            defs,
            fleet,
            start,
            from: 0,
            until: 1440,
            steers: &[],
            day: 0,
            speed_bonus: Fx::ZERO,
            mods: Default::default(),
        },
        |_| Some(weather),
    )
}

/// 风向东吹：向东、向东南都是顺风。
fn sail(defs: &StaticData, fleet: &crate::world::Fleet, start: &ManualVoyage) -> Course {
    day(defs, fleet, start, wind(2, 5))
}

#[test]
fn fine_land_stops_the_ship_head_on_exactly_like_coarse_land() {
    let (mut defs, fleet) = open_sea();
    let cell = Cell::new(12, 15);
    let start = ManualVoyage::new(cell, 90);
    let free = sail(&defs, &fleet, &start);
    assert!(free.stops.is_empty());
    assert!(free.voyage.pos.x > 13 * 256, "没有细海岸时一天能驶出这一格");
    // 细层：这一粗格里第 20 列细格整列是陆
    defs.fine_coast = Some(coast(&defs, |c, fx, _| c == cell && fx == 20));
    let hit = sail(&defs, &fleet, &start);
    // 停在墙前最后一份水上：第 19 列细格最东的一份（213 × 24 ÷ 256 = 19，214 就进了第 20 列）
    assert_eq!(hit.voyage.pos, SubCell { x: 12 * 256 + 213, y: ROW });
    assert_eq!(hit.voyage.sail, Sail::Furled);
    assert_eq!(hit.voyage.remainder, [0; 2]);
    let stops: Vec<_> = hit.stops.iter().map(|s| (s.kind, s.loc)).collect();
    assert_eq!(stops, [(StopKind::Land, None)]);
    let minute = usize::from(hit.stops[0].minute);
    assert!(hit.points[minute..].iter().all(|p| p.pos == hit.voyage.pos), "撞岸后不再动");
    // 撞岸之前与没有细海岸时逐分钟相同
    assert_eq!(hit.points[..minute], free.points[..minute]);
    // 与撞上粗格的陆是同一种结果：把东边的粗格改成陆、去掉细海岸，停船的形态相同（只是停得更远）
    let mut coarse = defs.clone();
    coarse.fine_coast = None;
    let index = coarse.map.idx(Cell::new(13, 15));
    coarse.map.terrain[index] = Terrain::Land;
    let wall = sail(&coarse, &fleet, &start);
    assert_eq!(wall.voyage.pos, SubCell { x: 12 * 256 + 255, y: ROW });
    assert_eq!(wall.stops.iter().map(|s| (s.kind, s.loc)).collect::<Vec<_>>(), stops);
    assert_eq!((wall.voyage.sail, wall.voyage.remainder), (hit.voyage.sail, hit.voyage.remainder));
    assert_eq!((wall.voyage.autopilot, &wall.voyage.pilot), (hit.voyage.autopilot, &hit.voyage.pilot));
}

#[test]
fn fine_water_lets_the_ship_through_step_for_step() {
    let (mut defs, fleet) = open_sea();
    let cell = Cell::new(12, 15);
    let start = ManualVoyage::new(cell, 90);
    let free = sail(&defs, &fleet, &start);
    // 同一堵墙，船走的那一行（第 12 行细格）留一个口子；别的行里也撒些不碍事的陆
    defs.fine_coast = Some(coast(&defs, |c, fx, fy| {
        (c == cell && fx == 20 && fy != 12) || (c.y != 15 && (fx + fy).is_multiple_of(5))
    }));
    assert_eq!(sail(&defs, &fleet, &start), free, "细层是水的地方与没有细海岸时逐步相同");
    // 全是水的细海岸同样逐步相同
    defs.fine_coast = Some(coast(&defs, |_, _, _| false));
    assert_eq!(sail(&defs, &fleet, &start), free);
}

#[test]
fn a_fine_land_pinch_cannot_be_cut_diagonally_but_a_single_corner_can_be_brushed() {
    let (mut defs, fleet) = open_sea();
    let cell = Cell::new(12, 12);
    // 正东南（135°）：两个分量相等，船沿对角线走，正好从细格 (12,12) 的角上进 (13,13)
    let start = ManualVoyage::new(cell, 135);
    let free = sail(&defs, &fleet, &start);
    assert!(free.stops.is_empty());
    assert!(free.points.iter().all(|p| p.pos.x - start.pos.x == p.pos.y - start.pos.y), "夹具：航迹是正对角线");
    assert!(free.voyage.pos.x > start.pos.x + 40);
    // 要进的细格 (13,13) 是水，夹着的两格都是陆（只在角上相接的掐口）：挡住，停在 (12,12) 的最后一份上
    let corner = SubCell { x: 12 * 256 + 138, y: 12 * 256 + 138 };
    defs.fine_coast = Some(coast(&defs, |c, x, y| c == cell && matches!((x, y), (13, 12) | (12, 13))));
    let hit = sail(&defs, &fleet, &start);
    assert_eq!(hit.voyage.pos, corner, "掐口");
    assert_eq!(hit.stops.iter().map(|s| s.kind).collect::<Vec<_>>(), [StopKind::Land]);
    assert_eq!(hit.voyage.sail, Sail::Furled);
    // 夹着的两格里只有一格是陆：擦过陆角放行，与没有细海岸时逐步相同
    for (fx, fy) in [(13, 12), (12, 13)] {
        defs.fine_coast = Some(coast(&defs, |c, x, y| c == cell && (x, y) == (fx, fy)));
        assert_eq!(sail(&defs, &fleet, &start), free, "陆在细格 ({fx},{fy})");
    }
    // 要进的那一格自己是陆：同样停在角上
    defs.fine_coast = Some(coast(&defs, |c, x, y| c == cell && (x, y) == (13, 13)));
    assert_eq!(sail(&defs, &fleet, &start).voyage.pos, corner);
    // 陆不挨着航迹：照常通过
    defs.fine_coast = Some(coast(&defs, |c, x, y| c == cell && (x, y) == (14, 12)));
    assert_eq!(sail(&defs, &fleet, &start), free);
}

// ───────────────────────────── 领航（积分器，风向由夹具给定） ─────────────────────────────

/// 从 (3,15) 到 (7,15) 一条东西向的窄水道：只有中间六行细格（第 9–14 行，即格心连线两侧各 3 格）是水。
fn channel(c: Cell, _: u16, fy: u16) -> bool {
    c.y == 15 && (3..=7).contains(&c.x) && !(9..=14).contains(&fy)
}

/// 从 (2,15) 出港、沿第 15 行领航去 (8,15) 的起始状态。
fn piloted_start() -> ManualVoyage {
    ManualVoyage {
        autopilot: Some(LocId(1)),
        pilot: Some(Pilot {
            path: (2..=8).map(|x| Cell::new(x, 15)).collect(),
            step: 1,
            edge: false,
            line: None,
            helm_hold: None,
            motion: None,
            supplies_stopped: false,
        }),
        ..ManualVoyage::new(HOME, 90)
    }
}

/// (3,15) 到 (7,15) 的北边整片是陆，格心所在的第 12 行细格就是最北一行水：格心连线贴着北岸。
fn ledge(c: Cell, _: u16, fy: u16) -> bool {
    c.y == 15 && (3..=7).contains(&c.x) && fy < 12
}

#[test]
fn pilot_beats_up_a_narrow_channel_without_touching_the_banks() {
    let (mut plain, fleet) = open_sea();
    // H10g 0683c69f 的稳舵缺省走廊是一整粗格；窄水道夹具把走廊限定在半宽 32 内。
    plain.rules.autopilot.corridor = 16;
    // 两种岸：半宽 3 细格的水道（骨架的最窄处），格心连线贴着北岸的“岸台”。
    // `outside(y)`：没有细海岸时原来的走法这一点算不算出了水。
    let shores: [Shore; 2] = [("水道", channel, |y| (y - ROW).abs() > 32), ("岸台", ledge, |y| y < 15 * 256 + 128)];
    check_pilot_shores(plain, &fleet, shores);
}

type Shore = (&'static str, fn(Cell, u16, u16) -> bool, fn(i64) -> bool);

/// 保留四项独立自检：粗图水道不越界、粗图岸台会越界、细图不撞岸、到港。
fn check_pilot_shores(plain: StaticData, fleet: &crate::world::Fleet, shores: [Shore; 2]) {
    for (name, land, outside) in shores {
        let mut defs = plain.clone();
        defs.fine_coast = Some(coast(&defs, land));
        let mut leaves = Vec::new();
        // 八个风向各三档风力：去 (8,15) 一路向东，风从东、东北、东南来时只能抢风
        for wind_dir in 0..8u8 {
            for strength in [3, 6, 9] {
                let weather = wind(wind_dir, strength);
                let case = format!("{name} 风向 {wind_dir} 风力 {strength}");
                let mut voyage = piloted_start();
                let mut days = 0;
                loop {
                    let course = day(&defs, fleet, &voyage, weather);
                    assert!(on_water(&defs, &course), "{case} 第 {days} 天压到了岸");
                    assert!(land_stops(&course).is_empty(), "{case}：{:?}", course.stops);
                    if course.arrival == Some(LocId(1)) {
                        break;
                    }
                    assert!(course.voyage.pilot.is_some(), "领航还在");
                    voyage = course.voyage;
                    days += 1;
                    assert!(days < 80, "{case}：八十天内应当到港");
                }
                // 同样的风，没有细海岸时原来的走法一路走到港，出没出水。选舵只在首选的舵这一分钟会撞岸时
                // 才与原来不同，所以原来的走法出了水，就是试走（与退路舵）避开了撞岸。
                let mut voyage = piloted_start();
                let mut out = false;
                for _ in 0..80 {
                    let old = day(&plain, fleet, &voyage, weather);
                    out |= old.points.iter().any(|p| outside(p.pos.y));
                    if old.arrival.is_some() {
                        break;
                    }
                    voyage = old.voyage;
                }
                if out {
                    leaves.push((wind_dir, strength));
                }
            }
        }
        if name == "水道" {
            // 粗图按走廊沿骨架走，全部风况都应留在对应夹具的水道界限内
            assert!(leaves.is_empty(), "{name}：原来的走法不出水道：{leaves:?}");
        } else {
            assert!(!leaves.is_empty(), "夹具：{name}上总有些风下原来的走法会压上北岸（要靠试走避岸）");
        }
    }
}

#[test]
fn pilot_beats_up_a_narrow_channel_with_the_default_corridor() {
    let (plain, fleet) = open_sea();
    assert_eq!(plain.rules.autopilot.corridor, 256);
    // 水道半宽 288，容纳缺省一格走廊及每分钟积分的余量；北岸台仍贴格心，确实需要细图避岸。
    let shores: [Shore; 2] = [
        (
            "水道",
            |c, _, fy| {
                let y = i64::from(c.y) * 256 + (i64::from(fy) * 256 + 128) / 24;
                (3..=7).contains(&c.x) && (y - ROW).abs() > 288
            },
            |y| (y - ROW).abs() > 288,
        ),
        ("岸台", ledge, |y| y < ROW),
    ];
    check_pilot_shores(plain, &fleet, shores);
}

#[test]
fn pilot_in_open_water_is_unchanged_by_an_all_water_fine_layer() {
    // 开阔水面：有细海岸（全是水）与没有细海岸，领航的航迹逐分钟相同（抢风时照旧一舷走到底）
    let (plain, fleet) = open_sea();
    let mut defs = plain.clone();
    defs.fine_coast = Some(coast(&defs, |_, _, _| false));
    // 只在别的行里有陆：窗口仍然全是水，同样逐分钟相同
    let mut elsewhere = plain.clone();
    elsewhere.fine_coast = Some(coast(&elsewhere, |c, fx, _| c.y.abs_diff(15) > 3 && fx % 3 == 0));
    for wind_dir in 0..8u8 {
        for strength in [0, 4, 8] {
            let weather = wind(wind_dir, strength);
            let (mut a, mut b, mut c) = (piloted_start(), piloted_start(), piloted_start());
            for d in 0..4 {
                let (x, y, z) = (
                    day(&plain, &fleet, &a, weather),
                    day(&defs, &fleet, &b, weather),
                    day(&elsewhere, &fleet, &c, weather),
                );
                assert!(on_water(&elsewhere, &x), "夹具的远岸不能进入粗图实际航迹");
                assert_eq!(x, y, "风向 {wind_dir} 风力 {strength} 第 {d} 天");
                assert_eq!(x, z, "风向 {wind_dir} 风力 {strength} 第 {d} 天");
                if x.arrival.is_some() {
                    break;
                }
                (a, b, c) = (x.voyage, y.voyage, z.voyage);
            }
        }
    }
}

// ───────────────────────────── 领航（世界：命令、落实、日志） ─────────────────────────────

/// 两个港口在同一行（(2,15) 与 (8,15)），全图是海、已探明；`wind` 是季节的风（去向、风力），每天在它附近变。
fn pilot_world(wind: Option<(u8, i64)>, land: impl Fn(Cell, u16, u16) -> bool) -> (World, FleetId) {
    let mut defs = (*testkit::tiny_defs()).clone();
    defs.manual_navigation = true;
    defs.map.terrain.fill(Terrain::Deep);
    defs.locations[0].cell = HOME;
    defs.locations[1].cell = DEST;
    defs.rules.pirates.spawn_scale = Fx::ZERO;
    defs.rules.explore.sight = 0;
    for r in &mut defs.regions {
        for s in &mut r.seasons {
            (s.wind_dir, s.wind_strength) = wind.unwrap_or((0, 0));
            s.current_strength = 0;
        }
    }
    defs.fine_coast = Some(coast(&defs, land));
    let mut w = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
    w.state.explore.cells.fill(u64::MAX);
    let id = w.fleets_of(OwnerId::Player).next().unwrap().id;
    let f = w.fleet_mut(id).unwrap();
    f.ships.iter_mut().for_each(|s| s.speed_bonus = Fx::from_int(2));
    f.food = 5_000;
    f.water = 5_000;
    (w, id)
}

fn park(w: &mut World, id: FleetId, pos: SubCell) {
    w.fleet_mut(id).unwrap().location = FleetLocation::AtSea(Voyage::Manual {
        manual: ManualVoyage {
            pos,
            heading: 0,
            sail: Sail::Furled,
            autopilot: None,
            pilot: None,
            remainder: [0; 2],
            reefed: false,
        },
    });
}

fn engage(w: &mut World, id: FleetId) {
    Command::Autopilot {
        owner: OwnerId::Player,
        fleet: id,
        dest: LocId(1),
        minute: 0,
        stop_at_known_edge: false,
        route: None,
    }
    .apply(w)
    .unwrap();
}

fn manual(w: &World, id: FleetId) -> &ManualVoyage {
    match &w.fleet(id).unwrap().location {
        FleetLocation::AtSea(Voyage::Manual { manual }) => manual,
        other => panic!("应当在手动航行：{other:?}"),
    }
}

/// 一天一天走到港：每天的航迹都在细层的水里、没有撞岸停船。返回逐日的航迹。
fn sail_to_port(w: &mut World, id: FleetId) -> Vec<Course> {
    let mut days = Vec::new();
    loop {
        let course = w.preview_course(id, &[], 0).unwrap();
        assert!(on_water(&w.defs, &course), "第 {} 天压到了岸", days.len());
        assert!(land_stops(&course).is_empty(), "第 {} 天撞岸停船：{:?}", days.len(), course.stops);
        let arrived = course.arrival;
        days.push(course);
        if arrived == Some(LocId(1)) {
            return days;
        }
        assert!(manual(w, id).pilot.is_some() || days.len() == 1, "领航还在");
        assert!(days.len() < 40, "四十天内应当到港");
        w.end_day().unwrap();
        testkit::check_invariants(w).unwrap();
    }
}

/// (3,15) 里一堵横墙（第 8 行，第 6 列起）一直伸进 (4,15)（到第 6 列）：把 (3,15) 的上半截与格心连线隔开，
/// 只有西头（第 0–5 列）与东头（(4,15) 的第 7 列起）能绕过去。
fn wall(c: Cell, fx: u16, fy: u16) -> bool {
    fy == 8 && ((c == Cell::new(3, 15) && fx >= 6) || (c == Cell::new(4, 15) && fx <= 6))
}

#[test]
fn pilot_walks_around_fine_land_from_a_corner_and_reaches_the_port() {
    let (mut w, id) = pilot_world(None, wall);
    // 船停在 (3,15) 的上半截，墙挡在它与下一格格心之间
    let corner = at(Cell::new(3, 15), 10, 3);
    park(&mut w, id, corner);
    let fine = w.defs.fine_coast.clone().unwrap();
    let mut window = FineWindow::build(&w.defs.map, &fine, Cell::new(3, 15), Cell::new(4, 15), |_| true);
    assert!(matches!(window.aim(corner), Aim::Via(_)), "夹具：到下一格格心的直线被细层的陆挡住");
    engage(&mut w, id);
    let days = sail_to_port(&mut w, id);
    assert_eq!(days.last().unwrap().points.last().unwrap().pos.cell(), DEST);
    // 绕出来以后回到格心连线上：经过 (5,15) 的格心
    assert!(days.iter().flat_map(|c| &c.points).any(|p| p.pos == SubCell::center(Cell::new(5, 15))));
    assert!(matches!(
        w.navigation_projection(1439).unwrap().fleet(id).unwrap().location,
        FleetLocation::Docked(LocId(1))
    ));

    // 同一个世界去掉细海岸：原来的走法直奔格心，从墙上压过去——有了细海岸才绕
    let mut plain = (*pilot_world(None, wall).0.defs).clone();
    plain.fine_coast = None;
    let mut old = World::new(Arc::new(plain), ScenarioId(0), 42).unwrap();
    old.state.explore.cells.fill(u64::MAX);
    park(&mut old, id, corner);
    engage(&mut old, id);
    let mut crossed = false;
    for _ in 0..40 {
        let straight = old.preview_course(id, &[], 0).unwrap();
        crossed |= straight.points.iter().any(|p| !fine.water_at(p.pos.x, p.pos.y));
        if crossed || straight.arrival.is_some() {
            break;
        }
        old.end_day().unwrap();
    }
    assert!(crossed, "夹具：原来的直线压过细层的陆");
}

#[test]
fn pilot_boxed_in_by_fine_land_stops_at_once_and_says_so() {
    // 船被围在 (3,15) 的左上角：第 8 列与第 8 行各一道陆，围出 8 × 8 细格的一小块水
    let ring = |c: Cell, fx: u16, fy: u16| c == Cell::new(3, 15) && ((fx == 8 && fy <= 8) || (fy == 8 && fx <= 8));
    let (mut w, id) = pilot_world(None, ring);
    let pocket = at(Cell::new(3, 15), 3, 3);
    park(&mut w, id, pocket);
    // 粗格上有路，命令照常接受；领航在第一分钟就发现细格上出不去
    engage(&mut w, id);
    let course = w.preview_course(id, &[], 0).unwrap();
    assert_eq!(course.arrival, None);
    assert!(course.voyage.pilot.is_none() && course.voyage.autopilot.is_none(), "领航已撤");
    assert_eq!(course.voyage.sail, Sail::Furled);
    assert!(course.points.iter().all(|p| p.pos == pocket), "不卡死也不穿陆：原地收帆");
    assert_eq!(land_stops(&course), [0], "给出原因：一条靠岸停船，记在发现堵死的那一分钟");
    // 原因落进航海日志：与撞岸停船同一条记录
    let settled = w.navigation_projection(30).unwrap();
    assert!(
        settled
            .state
            .log
            .iter()
            .any(|e| matches!(e.kind, LogKind::NavigationStopped { fleet, minute: 0, .. } if fleet == id))
    );
    assert!(manual(&settled, id).pilot.is_none());
    // 玩家接手后仍能在这一小块水里操舵，只是出不去
    let mut hands = settled.clone();
    Command::Steer { owner: OwnerId::Player, fleet: id, minute: 31, heading: Some(90), sail: Some(Sail::Full) }
        .apply(&mut hands)
        .unwrap();
    let boxed = hands.preview_course(id, &[], 31).unwrap();
    assert!(on_water(&hands.defs, &boxed));
    assert!(boxed.points.iter().all(|p| p.pos.cell() == Cell::new(3, 15) && p.pos.x <= 3 * 256 + 85), "出不了第 8 列");
}

// ───────────────────────────── 旧存档 ─────────────────────────────

#[test]
fn old_saves_parked_on_fine_land_are_moved_to_the_nearest_connected_water() {
    let (mut w, id) = pilot_world(None, wall);
    let cell = Cell::new(3, 15);
    // 船压在墙上（细格 (10,8)）：细碰撞之前的存档可以停在这里
    let on_land = at(cell, 10, 8);
    assert!(!w.defs.fine_coast.as_deref().unwrap().water_at(on_land.x, on_land.y));
    park(&mut w, id, on_land);
    w.state
        .navigation
        .landings
        .insert(id, landing::LandingTrip { anchor: on_land, days: 3, elapsed: 1, delayed: false });
    let saved = serde_json::to_string(&w.state).unwrap();
    let loaded = World::from_snapshot(w.defs.clone(), serde_json::from_str(&saved).unwrap()).unwrap();
    // 最近的水是正上方的 (10,7)（中点差 10 份；正下方的 (10,9) 差 11 份），它经墙西头的口子与格心相连
    assert_eq!(manual(&loaded, id).pos, at(cell, 10, 7));
    assert_eq!(manual(&loaded, id).pos.cell(), cell, "不离开原来的粗格");
    assert_eq!(manual(&loaded, id).remainder, [0; 2]);
    assert_eq!(loaded.state.navigation.landings[&id].anchor, manual(&loaded, id).pos, "登陆队的锚地跟着挪");
    testkit::check_invariants(&loaded).unwrap();
    // 再存再读不再动
    let again = World::from_snapshot(loaded.defs.clone(), loaded.state.clone()).unwrap();
    assert_eq!(again.state, loaded.state);
    // 已经在水上的存档原样读回
    let mut afloat = w.clone();
    afloat.state.navigation.landings.clear();
    park(&mut afloat, id, at(cell, 10, 3));
    let state = afloat.state.clone();
    assert_eq!(World::from_snapshot(afloat.defs.clone(), state.clone()).unwrap().state, state);

    // 墙把整格拦腰截断时，上半截与格心不连：最近的 (10,7) 是出不来的水洼，改挪到墙下面的 (10,9)
    let cut = |c: Cell, _: u16, fy: u16| c == cell && fy == 8;
    let (mut w, id) = pilot_world(None, cut);
    park(&mut w, id, on_land);
    let saved = serde_json::to_string(&w.state).unwrap();
    let loaded = World::from_snapshot(w.defs.clone(), serde_json::from_str(&saved).unwrap()).unwrap();
    assert_eq!(manual(&loaded, id).pos, at(cell, 10, 9));
    testkit::check_invariants(&loaded).unwrap();
}

#[test]
fn old_saves_keep_their_pilot_when_moved_within_the_same_cell() {
    let (mut w, id) = pilot_world(None, wall);
    let cell = Cell::new(3, 15);
    park(&mut w, id, at(cell, 10, 3));
    engage(&mut w, id);
    // 落实到第 0 分钟：领航进了船的状态；再把船位改到墙上，模拟旧存档
    let mut settled = w.navigation_projection(0).unwrap();
    if let FleetLocation::AtSea(Voyage::Manual { manual }) = &mut settled.fleet_mut(id).unwrap().location {
        assert!(manual.pilot.is_some());
        manual.pos = at(cell, 10, 8);
    }
    let saved = serde_json::to_string(&settled.state).unwrap();
    let mut loaded = World::from_snapshot(settled.defs.clone(), serde_json::from_str(&saved).unwrap()).unwrap();
    assert_eq!(manual(&loaded, id).pos, at(cell, 10, 7));
    assert!(
        manual(&loaded, id).pilot.is_some() && manual(&loaded, id).autopilot == Some(LocId(1)),
        "粗格没变，领航留着"
    );
    // 读回来接着走：照样绕过墙到港
    sail_to_port(&mut loaded, id);
}

// ───────────────────────────── 确定性 ─────────────────────────────

#[test]
fn fine_piloting_is_deterministic_across_runs_splits_and_replays() {
    // 两种夹具：从角落绕墙（季节无风），顶风走窄水道（两舷轮换）
    type Land = fn(Cell, u16, u16) -> bool;
    type Case = (Option<(u8, i64)>, Land, Option<SubCell>);
    let cases: [Case; 2] = [(None, wall, Some(at(Cell::new(3, 15), 10, 3))), (Some((6, 5)), channel, None)];
    for (wind, land, parked) in cases {
        let build = || {
            let (mut w, id) = pilot_world(wind, land);
            if let Some(pos) = parked {
                park(&mut w, id, pos);
            }
            engage(&mut w, id);
            (w, id)
        };
        let (w, id) = build();
        let (again, _) = build();
        let full = w.preview_course(id, &[], 0).unwrap();
        assert!(on_water(&w.defs, &full) && land_stops(&full).is_empty());
        assert!(full.points.iter().any(|p| p.pos != full.points[0].pos), "夹具：船在走");
        // 同一串输入两次运行结果相同
        assert_eq!(full, again.preview_course(id, &[], 0).unwrap());
        assert_eq!(w.state_hash(), again.state_hash());
        // 只预测到某一分钟，与整天预测的前一段逐分钟相同
        let last = full.stops.iter().map(|s| s.minute).max().unwrap_or(1440).min(1439);
        for end in (0..=1440).step_by(97).chain([last, last + 1]) {
            let bounded = w.preview_course_until(id, &[], 0, end).unwrap();
            let points: Vec<_> = full.points.iter().filter(|p| p.minute <= end).copied().collect();
            let stops: Vec<_> = full.stops.iter().filter(|s| s.minute <= end).cloned().collect();
            assert_eq!(bounded.points, points, "结束分钟 {end}");
            assert_eq!(bounded.stops, stops, "结束分钟 {end}");
        }
        // 中途落实一次再接着走，与一口气落实到同一分钟逐位相同
        for (first, second) in [(1, 2), (37, 211), (211, 900), (5, 1439)] {
            if full.arrival.is_some() && second >= last {
                continue;
            }
            let split = w.navigation_projection(first).unwrap().navigation_projection(second).unwrap();
            let direct = w.navigation_projection(second).unwrap();
            assert_eq!(split.state, direct.state, "分两次落实 {first}、{second}");
            assert_eq!(split.state_hash(), direct.state_hash());
            // 存档读回不改状态，接着预测的航迹也相同
            let loaded = World::from_snapshot(split.defs.clone(), split.state.clone()).unwrap();
            assert_eq!(loaded.state, split.state);
            assert_eq!(
                loaded.preview_course(id, &[], second).unwrap(),
                direct.preview_course(id, &[], second).unwrap()
            );
        }
        // 重放：同样的命令在两个世界里各走三天，逐日状态哈希相同
        let (mut a, _) = build();
        let (mut b, _) = build();
        for day in 0..3 {
            a.end_day().unwrap();
            b.end_day().unwrap();
            assert_eq!(a.state_hash(), b.state_hash(), "第 {day} 天");
            testkit::check_invariants(&a).unwrap();
        }
    }
}
