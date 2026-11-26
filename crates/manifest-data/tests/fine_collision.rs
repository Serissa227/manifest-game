//! 第九批 M02“细碰撞”：真实寰宇数据上，玩家的船只在“粗格可航行且细格是水”的地方走。
//!
//! - 真实港口对（含爱琴海、达达尼尔、濑户内海、关门、马六甲、英吉利海峡、厄勒、墨西拿等窄水道）：
//!   自动领航在八个风向与当天真实天气下走完全程，不撞岸停船、不压细陆、到得了港；
//! - 骨架实证：抽样涉及海岸格（细层半陆半水）的内核邻接，从格心领航到相邻格心，逐分钟积分全程在水里；
//! - 角落出发：船在海岸格里离格心最远、仍与格心连着的水上，领航照样绕出来；
//! - 细海岸确实进了内核，并且读出来的每个可航行格心都是水。
//!
//! 不调用网络，不依赖原始地理数据；只读已提交的 `data/`。

use manifest_core::defs::SeasonWeather;
use manifest_core::nav::{FineCoast, FineKind, Terrain};
use manifest_core::navigation::autopilot::Pilot;
use manifest_core::navigation::course::{Course, CourseInput, integrate_course};
use manifest_core::navigation::{ManualVoyage, StopKind, SubCell};
use manifest_core::weather::{DayWeather, Sky};
use manifest_core::world::Fleet;
use manifest_core::{Cell, Fx, LocId, OwnerId, RegionId, ScenarioId, StaticData, World};
use manifest_data::fine_map::skeleton_link;
use std::sync::{Arc, OnceLock};

fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        manifest_data::load_world(&root, "terra16").expect("真实寰宇完整加载")
    })
    .clone()
}

/// 寰宇的一个新世界：全图已探明（领航只走已知海域）。
fn world(defs: &Arc<StaticData>) -> World {
    let scenario = defs.scenarios.iter().position(|s| s.key == "free_1557").expect("自由航海剧本");
    let mut w = World::new(defs.clone(), ScenarioId::from_idx(scenario), 7).expect("寰宇新世界");
    w.state.explore.cells.fill(u64::MAX);
    w
}

fn fleet(w: &World) -> Fleet {
    w.fleets_of(OwnerId::Player).next().expect("玩家舰队").clone()
}

/// 晴天、无洋流；`dir` 是风的去向（0 = 向北吹，顺时针 8 方向）。
fn wind(dir: u8, strength: i64) -> DayWeather {
    DayWeather {
        region: RegionId(0),
        day: 0,
        sky: Sky::Clear,
        storm_hit_e8: 0,
        sea: SeasonWeather {
            wind_dir: dir,
            wind_strength: strength,
            current_dir: 0,
            current_strength: 0,
            storm_bp: 0,
            pirate_bp: 0,
        },
    }
}

fn day(
    defs: &StaticData,
    fleet: &Fleet,
    start: &ManualVoyage,
    today: u32,
    weather: &dyn Fn(Cell) -> Option<DayWeather>,
) -> Course {
    integrate_course(
        CourseInput {
            defs,
            fleet,
            start,
            from: 0,
            until: 1440,
            steers: &[],
            day: today,
            speed_bonus: Fx::ZERO,
            mods: Default::default(),
        },
        weather,
    )
}

/// 航迹全程在细层的水里：逐分钟的点之间按积分器的走法（逐 1/256 格）一份一份地查。
fn first_dry(fine: &FineCoast, width: i64, course: &Course) -> Option<SubCell> {
    let mut last: Option<SubCell> = None;
    for p in &course.points {
        if let Some(a) = last {
            let mut dx = p.pos.x - a.x;
            dx = (dx + width / 2).rem_euclid(width) - width / 2;
            let dy = p.pos.y - a.y;
            let count = dx.abs().max(dy.abs());
            for step in 1..=count {
                let (x, y) = ((a.x + dx * step / count).rem_euclid(width), a.y + dy * step / count);
                if !fine.water_at(x, y) {
                    return Some(SubCell { x, y });
                }
            }
        } else if !fine.water_at(p.pos.x, p.pos.y) {
            return Some(p.pos);
        }
        last = Some(p.pos);
    }
    None
}

fn loc(defs: &StaticData, key: &str) -> LocId {
    LocId::from_idx(defs.locations.iter().position(|l| l.key == key).unwrap_or_else(|| panic!("没有地点 {key}")))
}

#[test]
fn terra16_loads_the_fine_coast_into_the_kernel() {
    let defs = defs();
    let fine = defs.fine_coast.as_deref().expect("寰宇带细海岸");
    assert_eq!((fine.width(), fine.height(), fine.sub()), (defs.map.width, defs.map.height, 24));
    assert!(fine.mixed_cells() > 15_000, "海岸格数：{}", fine.mixed_cells());
    // 内核的细海岸：每细格一位，整格同类的不占块
    assert!(fine.memory_bytes() < 8 << 20, "细海岸占内存 {} 字节", fine.memory_bytes());
    let centre = fine.fine_index(128);
    for (i, t) in defs.map.terrain.iter().enumerate() {
        if *t != Terrain::Land {
            assert!(fine.water(defs.map.cell_of(i), centre, centre), "可航行格 {:?} 的格心是水", defs.map.cell_of(i));
        }
    }
}

/// 真实港口对：狭窄水道各取一对，另加几条开阔或长的航线。
const PAIRS: &[(&str, &str, &str)] = &[
    ("chios", "smyrna", "爱琴海：希俄斯海峡"),
    ("chios", "istanbul", "爱琴海北上、达达尼尔、马尔马拉"),
    ("istanbul", "varna", "博斯普鲁斯"),
    ("candia", "rhodes", "爱琴海南缘"),
    ("sakai", "noshima", "濑户内海"),
    ("hakata", "funai", "关门海峡进濑户内海"),
    ("nagasaki", "hirado", "九州西岸的岛群"),
    ("malacca", "aceh_port", "马六甲海峡"),
    ("malacca", "johor_port", "马六甲海峡南口"),
    ("plymouth", "le_havre", "英吉利海峡"),
    ("london", "dieppe", "泰晤士河口、多佛尔海峡"),
    ("copenhagen", "lubeck", "厄勒海峡、波罗的海西南"),
    ("messina", "naples", "墨西拿海峡"),
    ("venice", "ragusa_port", "亚得里亚海"),
    ("hormuz_port", "julfar", "霍尔木兹海峡"),
    ("havana", "santiago_cuba", "古巴沿岸"),
];

#[test]
fn autopilot_sails_real_port_pairs_through_narrow_waters_without_touching_fine_land() {
    let defs = defs();
    let fine = defs.fine_coast.as_deref().expect("细海岸");
    let width = i64::from(defs.map.width) * 256;
    let w = world(&defs);
    let ship = fleet(&w);
    let today = w.day();
    let mut failures = Vec::new();
    let mut voyages = 0usize;
    let mut longest = 0usize;
    for &(from, to, note) in PAIRS {
        let (a, b) = (loc(&defs, from), loc(&defs, to));
        let start = defs.loc(a).cell;
        let pilot = w.known_sea_path(start, b, false).unwrap_or_else(|e| panic!("{from} → {to} 没有已知海路：{e:?}"));
        // 八个风向（风力 6）与世界当天的真实天气
        for case in 0..9u8 {
            let weather = |cell: Cell| if case < 8 { Some(wind(case, 6)) } else { w.weather_at(cell) };
            let mut voyage =
                ManualVoyage { autopilot: Some(b), pilot: Some(pilot.clone()), ..ManualVoyage::new(start, 0) };
            voyages += 1;
            let label = if case < 8 { format!("风向 {case}") } else { "真实天气".to_string() };
            let mut days = 0;
            let outcome = loop {
                let course = day(&defs, &ship, &voyage, today, &weather);
                if let Some(p) = first_dry(fine, width, &course) {
                    break Err(format!("第 {days} 天压到细陆 {p:?}"));
                }
                if let Some(stop) = course.stops.iter().find(|s| s.kind == StopKind::Land) {
                    break Err(format!("第 {days} 天第 {} 分钟撞岸停船，船位 {:?}", stop.minute, course.voyage.pos));
                }
                if course.arrival == Some(b) {
                    break Ok(days + 1);
                }
                if course.voyage.pilot.is_none() {
                    break Err(format!("第 {days} 天领航没了：{:?}", course.stops));
                }
                voyage = course.voyage;
                days += 1;
                if days >= 120 {
                    break Err(format!("一百二十天没到，船位 {:?}", voyage.pos));
                }
            };
            match outcome {
                Ok(days) => longest = longest.max(days),
                Err(e) => failures.push(format!("{from} → {to}（{note}）{label}：{e}")),
            }
        }
    }
    eprintln!("港口对 {} 对、领航 {voyages} 次，最长 {longest} 天", PAIRS.len());
    assert!(failures.is_empty(), "{} 次失败：\n{}", failures.len(), failures.join("\n"));
}

/// 内核允许直接相通、且至少一头是海岸格的邻接（领航 A* 与骨架同一条规则），按下标抽样。
fn coastal_links(defs: &StaticData, want: usize) -> (Vec<(Cell, Cell)>, usize) {
    let fine = defs.fine_coast.as_deref().expect("细海岸");
    let map = &defs.map;
    let navigable: Vec<bool> = map.terrain.iter().map(|t| *t != Terrain::Land).collect();
    let (w, h) = (usize::from(map.width), usize::from(map.height));
    let period = defs.nav.grid.period_on(0);
    let usable = |c: Cell| defs.nav.grid.check_cell(period, c).is_ok() && defs.realms.at(defs, c).is_none();
    let mut all = Vec::new();
    for i in 0..w * h {
        for dir in 0..8 {
            let Some(j) = skeleton_link(&navigable, w, h, map.wrap_x, i, dir) else { continue };
            let (a, b) = (map.cell_of(i), map.cell_of(j));
            // 斜向的邻接：夹着的两格也要能走（封冻与帷幕同样算，与领航 A* 的规则一致）
            let flanks = a.x != b.x && a.y != b.y;
            if (fine.kind(a) == FineKind::Mixed || fine.kind(b) == FineKind::Mixed)
                && usable(a)
                && usable(b)
                && (!flanks || (usable(Cell::new(a.x, b.y)) && usable(Cell::new(b.x, a.y))))
            {
                all.push((a, b));
            }
        }
    }
    let total = all.len();
    let stride = total.div_ceil(want).max(1);
    // 步长与 8 互素，免得总抽到同一个方向
    let stride = if stride % 2 == 0 { stride + 1 } else { stride };
    (all.into_iter().step_by(stride).collect(), total)
}

/// 从 `pos` 领航到相邻格 `b` 的格心：一天（不够再一天）内到达，全程在水里、到达之前不撞岸。
fn pilot_hop(
    defs: &StaticData,
    ship: &Fleet,
    pos: SubCell,
    a: Cell,
    b: Cell,
    weather: DayWeather,
) -> Result<(), String> {
    let fine = defs.fine_coast.as_deref().expect("细海岸");
    let width = i64::from(defs.map.width) * 256;
    // 领航的目的港只用来限定“进哪个港口的格子才算靠港”：取一个离这里好几格的港口，
    // 免得路过附近（含斜穿时夹着的格子）的港口就靠了港（路径的终点 `b` 本身不当港口）
    let far = |c: Cell| (i32::from(c.x) - i32::from(a.x)).abs() > 3 || (i32::from(c.y) - i32::from(a.y)).abs() > 3;
    let elsewhere = defs.loc_ids().find(|id| defs.loc(*id).is_port() && far(defs.loc(*id).cell));
    let mut voyage = ManualVoyage {
        pos,
        autopilot: elsewhere,
        pilot: Some(Pilot {
            path: vec![a, b],
            step: 1,
            edge: true,
            line: None,
            helm_hold: None,
            motion: None,
            supplies_stopped: false,
        }),
        ..ManualVoyage::new(a, 0)
    };
    // 高纬度的格子东西窄、南北走得慢（航速按纬度修正），给足天数
    for d in 0..10 {
        let course = day(defs, ship, &voyage, 0, &|_| Some(weather));
        if let Some(p) = first_dry(fine, width, &course) {
            return Err(format!("压到细陆 {p:?}"));
        }
        // 路径的终点不是港口：走完时记一条靠岸停船（与原来相同），船正好停在终点的格心
        if course.voyage.pilot.is_none() {
            return if course.voyage.pos == SubCell::center(b) {
                Ok(())
            } else {
                Err(format!("第 {d} 天停在 {:?}：{:?}", course.voyage.pos, course.stops))
            };
        }
        voyage = course.voyage;
    }
    Err(format!("十天没到，船位 {:?}", voyage.pos))
}

#[test]
fn every_sampled_coastal_link_is_sailable_from_centre_to_centre() {
    let defs = defs();
    let w = world(&defs);
    let ship = fleet(&w);
    let (links, total) = coastal_links(&defs, 2_000);
    let mut failures = Vec::new();
    let mut runs = 0usize;
    for (i, &(a, b)) in links.iter().enumerate() {
        // 每条邻接三种风：顺着下标轮换八个风向
        for k in 0..3 {
            let dir = ((i * 3 + k) % 8) as u8;
            runs += 1;
            if let Err(e) = pilot_hop(&defs, &ship, SubCell::center(a), a, b, wind(dir, 6)) {
                failures.push(format!("{a:?} → {b:?} 风向 {dir}：{e}"));
            }
        }
    }
    eprintln!("海岸邻接共 {total} 条（有向），抽 {} 条、积分 {runs} 次", links.len());
    assert!(links.len() >= 1_500);
    assert!(
        failures.is_empty(),
        "{} 次失败（前 20 条）：\n{}",
        failures.len(),
        failures[..failures.len().min(20)].join("\n")
    );
}

/// 海岸格里与格心连着（八方向、不斜穿陆角）、离格心最远的水细格的中点。
fn far_corner(fine: &FineCoast, cell: Cell) -> SubCell {
    let sub = i64::from(fine.sub());
    let mid = i64::from(fine.fine_index(128));
    let water = |x: i64, y: i64| x >= 0 && y >= 0 && x < sub && y < sub && fine.water(cell, x as u16, y as u16);
    let mut seen = vec![false; (sub * sub) as usize];
    let mut stack = vec![(mid, mid)];
    seen[(mid * sub + mid) as usize] = true;
    let mut best = (0, mid, mid);
    while let Some((x, y)) = stack.pop() {
        let d = (x - mid).pow(2) + (y - mid).pow(2);
        if (d, -y, -x) > (best.0, -best.2, -best.1) {
            best = (d, x, y);
        }
        for (dx, dy) in [(0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1)] {
            let (nx, ny) = (x + dx, y + dy);
            if !water(nx, ny) || (dx != 0 && dy != 0 && (!water(nx, y) || !water(x, ny))) {
                continue;
            }
            let i = (ny * sub + nx) as usize;
            if !seen[i] {
                seen[i] = true;
                stack.push((nx, ny));
            }
        }
    }
    SubCell {
        x: i64::from(cell.x) * 256 + fine.fine_center(best.1 as u16),
        y: i64::from(cell.y) * 256 + fine.fine_center(best.2 as u16),
    }
}

/// 寰宇的竞渡（养成小游戏）也走手动航行的积分器：逐条赛道、逐种走法组合，比较有细海岸与没有细海岸的成绩。
#[test]
fn terra16_races_score_the_same_with_and_without_the_fine_coast() {
    use manifest_core::contests::Params;
    let defs = defs();
    let mut coarse = (*defs).clone();
    coarse.fine_coast = None;
    let coarse = Arc::new(coarse);
    let (fine_world, coarse_world) = (world(&defs), world(&coarse));
    let fine = defs.fine_coast.as_deref().expect("细海岸");
    let mut tracks = 0;
    let mut runs = 0;
    let mut changed = Vec::new();
    let mut moved = 0;
    for c in &defs.upbringing.contests {
        let (Params::Race(p), Some(t)) = (&c.params, c.scoring.race.as_ref()) else { continue };
        tracks += 1;
        // 每程的走法逐一组合
        let mut combos: Vec<Vec<String>> = vec![Vec::new()];
        for leg in &p.legs {
            combos = combos
                .into_iter()
                .flat_map(|prefix| {
                    leg.options.iter().map(move |o| {
                        let mut next = prefix.clone();
                        next.push(o.key.clone());
                        next
                    })
                })
                .collect();
        }
        for moves in combos {
            runs += 1;
            let with = p.run(t, &fine_world, 11, &moves).expect("竞渡");
            let without = p.run(t, &coarse_world, 11, &moves).expect("竞渡");
            // 船停在细层的水里（细海岸挡住时停得比原来早一点，终点会变）
            assert!(
                fine.water_at(with.finish.x, with.finish.y),
                "{} {moves:?} 的终点 {:?} 在细陆上",
                c.key,
                with.finish
            );
            moved += usize::from(with.finish != without.finish);
            let (a, b) = ((with.score, with.bonus, &with.legs), (without.score, without.bonus, &without.legs));
            if a != b {
                changed.push(format!("{} {moves:?}：{b:?} → {a:?}", c.key));
            }
        }
    }
    eprintln!("竞渡赛道 {tracks} 条、走法组合 {runs} 种，终点因细海岸挪了的 {moved} 种");
    assert!(tracks >= 6);
    // 成绩（总分、加分、每程得分与失手）一分不变：竞渡的成绩按航迹离检查点最近的距离算，细海岸只让船在岸边早停一点
    assert!(changed.is_empty(), "{} 种走法的成绩因细海岸而变：\n{}", changed.len(), changed.join("\n"));
}

#[test]
fn autopilot_gets_out_of_the_far_corner_of_coastal_cells() {
    let defs = defs();
    let fine = defs.fine_coast.as_deref().expect("细海岸");
    let w = world(&defs);
    let ship = fleet(&w);
    let (links, _) = coastal_links(&defs, 1_000);
    let mut failures = Vec::new();
    let mut runs = 0usize;
    let mut tried = 0usize;
    for (i, &(a, b)) in links.iter().enumerate() {
        if fine.kind(a) != FineKind::Mixed {
            continue;
        }
        tried += 1;
        let corner = far_corner(fine, a);
        for k in 0..2 {
            let dir = ((i * 5 + k * 3) % 8) as u8;
            runs += 1;
            if let Err(e) = pilot_hop(&defs, &ship, corner, a, b, wind(dir, 6)) {
                failures.push(format!("{a:?} 角落 {corner:?} → {b:?} 风向 {dir}：{e}"));
            }
        }
    }
    eprintln!("角落出发：{tried} 个海岸格、积分 {runs} 次");
    assert!(tried >= 300);
    assert!(
        failures.is_empty(),
        "{} 次失败（前 20 条）：\n{}",
        failures.len(),
        failures[..failures.len().min(20)].join("\n")
    );
}
