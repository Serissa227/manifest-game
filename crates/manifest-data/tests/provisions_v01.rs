//! V01：以真实海图、结业资本和季节风量化开局补给，开放港口经过完整开局预演。
use manifest_core::{
    FleetId, GoodId, LocId, OwnerId, ShipTypeId, StaticData,
    fleet::{daily_supply_need, fleet_days_compressed, new_ship},
    world::{Fleet, FleetLocation},
};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{Arc, OnceLock},
};

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn defs() -> Arc<StaticData> {
    static DATA: OnceLock<Arc<StaticData>> = OnceLock::new();
    DATA.get_or_init(|| manifest_data::load_world(&root(), "terra16").expect("真实寰宇加载")).clone()
}

fn navigation_world() -> manifest_core::World {
    static WORLD: OnceLock<manifest_core::World> = OnceLock::new();
    WORLD
        .get_or_init(|| {
            let d = defs();
            let scenario = d.find_scenario("free_1557").expect("自由开局");
            let mut w = manifest_core::World::new(d, scenario, 42).expect("完整开局预演");
            w.state.explore.cells.fill(u64::MAX);
            let ports: Vec<_> = w.defs.port_ids().collect();
            w.state.explore.sighted.extend(ports);
            w
        })
        .clone()
}

fn stopovers(key: &str) -> &'static [&'static str] {
    match key {
        "custom_lisbon_medicine" => &["sao_tome", "sofala", "goa"],
        "custom_basque_whaling" => &["funchal", "ribeira_grande", "san_juan", "st_johns", "red_bay"],
        _ => &[],
    }
}

fn expedition_start(d: &StaticData, o: &Opening, window_day: u32) -> u32 {
    if o.key == "custom_basque_whaling" {
        // 线索章在正月 2–6 日；红湾的六月日期是到港窗口，不能误当成启航日。
        manifest_core::scenario::day_of(d, [1557, 1, 7]).expect("线索章之后启航")
    } else {
        window_day
    }
}

struct Opening {
    key: String,
    fleet: Fleet,
    day: u32,
}

fn fleet(
    d: &StaticData,
    at: LocId,
    ships: Vec<ShipTypeId>,
    crew: i64,
    food: i64,
    water: i64,
    cargo: BTreeMap<GoodId, i64>,
) -> Fleet {
    Fleet {
        id: FleetId(0),
        owner: OwnerId::Player,
        ships: ships.into_iter().map(|k| new_ship(d, k)).collect(),
        crew,
        morale: 100,
        food,
        water,
        supply_remainder: Default::default(),
        cargo,
        location: FleetLocation::Docked(at),
        days_at_sea: 0,
        idle_days: 0,
        plan: None,
        news: None,
    }
}

fn openings(d: &StaticData) -> Vec<Opening> {
    let mut out = Vec::new();
    for family in &d.upbringing.families {
        let completion = family.completion.as_ref().expect("各家庭有结业资本");
        let c = &completion.capital;
        // 四种志向和未完成志向的兜底资本都纳入；变化时不能仅检查默认志向。
        for key in &completion.paths {
            let path = d.upbringing.paths.iter().find(|p| &p.key == key).expect("志向存在");
            let p = &path.capital;
            assert_eq!(
                (&p.at, &p.ships, p.crew, p.food, p.water, &p.cargo),
                (&c.at, &c.ships, c.crew, c.food, c.water, &c.cargo),
                "{key} 的航海资本需单独审计"
            );
        }
        let at = d.find_loc(c.at.as_deref().unwrap_or(&family.home)).expect("结业港");
        let ships = c
            .ships
            .iter()
            .map(|key| ShipTypeId::from_idx(d.ships.iter().position(|s| &s.key == key).expect("船型")))
            .collect();
        let cargo = c.cargo.iter().map(|(key, qty)| (d.find_good(key).expect("货物"), *qty)).collect();
        out.push(Opening {
            key: family.key.clone(),
            fleet: fleet(d, at, ships, c.crew, c.food, c.water, cargo),
            day: manifest_core::scenario::day_of(d, family.graduation).expect("结业日期"),
        });
    }
    let free = &d.scenarios[d.find_scenario("free_1557").expect("自由开局").idx()];
    out.push(Opening {
        key: free.key.clone(),
        fleet: fleet(
            d,
            free.start_loc,
            free.ships.clone(),
            free.crew,
            free.food,
            free.water,
            free.cargo.iter().copied().collect(),
        ),
        day: manifest_core::scenario::day_of(d, free.control_date).expect("接手日期"),
    });
    out
}

fn nearest(d: &StaticData, o: &Opening) -> Vec<(LocId, i64)> {
    let from = o.fleet.docked_at().expect("在港");
    let period = d.nav.grid.period_on(o.day);
    let mut w = navigation_world();
    w.state.day = o.day;
    let mut routes: Vec<_> = d
        .port_ids()
        .filter(|to| *to != from && w.location_open(*to))
        .filter_map(|to| {
            d.nav.compressed_path(period, from, to).map(|p| (p.length, to, fleet_days_compressed(d, &o.fleet, p)))
        })
        .collect();
    // 最近按真实海路长度，而不是直线距离；同距使用稳定的地点 ID。
    routes.sort_by_key(|(length, to, _)| (*length, *to));
    routes.into_iter().take(3).map(|(_, to, days)| (to, days)).collect()
}

fn first_task(d: &StaticData, o: &Opening) -> Option<(String, LocId, u32)> {
    let key = if o.key == "free_1557" {
        "main_free".to_string()
    } else if let Some(suffix) = o.key.strip_prefix("custom_") {
        format!("free_{suffix}")
    } else {
        format!("main_{}", o.key)
    };
    let path = root().join(format!("worlds/terra16/stories/main/{key}.toml"));
    let raw: toml::Value = toml::from_str(&std::fs::read_to_string(path).expect("主线文件")).expect("主线 TOML");
    let track =
        raw["tracks"].as_array().expect("主线").iter().find(|t| t["key"].as_str() == Some(&key)).expect("主线 key");
    let from = o.fleet.docked_at().expect("出发港");
    for c in track["chapters"].as_array().expect("章节") {
        let Some(to) = c.get("at").and_then(toml::Value::as_str).and_then(|k| d.find_loc(k)) else { continue };
        if to == from || !d.loc(to).is_port() {
            continue;
        }
        let date = c.get("window").and_then(toml::Value::as_array).and_then(|w| w.first()).or_else(|| {
            c.get("when")
                .and_then(toml::Value::as_array)
                .and_then(|ws| ws.iter().find(|w| w.get("kind").and_then(toml::Value::as_str) == Some("date")))
                .and_then(|w| w.get("from"))
        });
        let day = date
            .and_then(toml::Value::as_array)
            .map(|date| {
                let v: Vec<_> = date.iter().map(|n| n.as_integer().expect("日期数字") as u32).collect();
                manifest_core::scenario::day_of(d, [v[0], v[1], v[2]]).expect("任务日期")
            })
            .unwrap_or(o.day);
        return Some((c["key"].as_str().expect("章节 key").to_string(), to, day));
    }
    None
}

fn audit(d: &StaticData, o: &Opening) -> Value {
    let f = &o.fleet;
    let from = f.docked_at().expect("在港");
    let daily = daily_supply_need(d, f.crew);
    let mut full = f.clone();
    full.food = f.capacity() / 2;
    full.water = full.food;
    let full_days = full.supplies_days(d).expect("船员非零");
    full.food = (f.capacity() - f.cargo_total()) / 2;
    full.water = full.food;
    let nearby: Vec<_> = nearest(d, o)
        .into_iter()
        .map(|(to, days)| json!({"port":d.loc(to).key,"name":d.loc(to).name,"days":days}))
        .collect();
    let task = first_task(d, o).map(|(chapter, to, day)| {
        let period = d.nav.grid.period_on(day);
        let days = d.nav.compressed_path(period, from, to).map(|p| fleet_days_compressed(d, f, p));
        json!({"chapter":chapter,"port":d.loc(to).key,"name":d.loc(to).name,"day":day,"days":days})
    });
    json!({"key":o.key,"port":d.loc(from).key,"port_name":d.loc(from).name,
        "ships":f.ships.iter().map(|s| &d.ship(s.kind).key).collect::<Vec<_>>(),
        "capacity":f.capacity(),"crew":f.crew,"cargo":f.cargo_total(),"food":f.food,"water":f.water,
        "daily":daily,"daily_milli":manifest_core::fleet::daily_supply_milli(d,f.crew),
        "default_days":f.supplies_days(d),"full_days":full_days,"retained_cargo_days":full.supplies_days(d),
        "rounded_default_days":f.food.min(f.water)/daily,"rounded_full_days":f.capacity()/2/daily,
        "nearest":nearby,"first_task":task})
}

#[test]
fn full_supplies_leave_half_a_passage_for_every_opening_and_first_story_port() {
    let d = defs();
    assert!(d.rules.fractional_supplies);
    for o in openings(&d) {
        let mut f = o.fleet.clone();
        // 保留起始货物也应通过，比清空货舱装补给的验收更严格。
        f.food = (f.capacity() - f.cargo_total()) / 2;
        f.water = f.food;
        let supported = f.supplies_days(&d).expect("有船员");
        let mut targets = nearest(&d, &o);
        if let Some((_, to, day)) = first_task(&d, &o) {
            let path =
                d.nav.compressed_path(d.nav.grid.period_on(day), f.docked_at().expect("在港"), to).expect("剧情港可达");
            let days = fleet_days_compressed(&d, &f, path);
            if !stopovers(&o.key).is_empty() {
                // 远洋剧情按更新任务单使用既有补给港；每段都要保留至少 50% 余量。
                let mut from = f.docked_at().expect("里斯本");
                let mut at_day = expedition_start(&d, &o, day);
                for &key in stopovers(&o.key) {
                    let dest = d.find_loc(key).expect("既有补给港");
                    let p = d.nav.compressed_path(d.nav.grid.period_on(at_day), from, dest).expect("沿岸航路");
                    let leg = fleet_days_compressed(&d, &f, p);
                    assert!(supported * 2 >= leg * 3, "{}→{key}：{leg} 天，补给 {supported} 天", d.loc(from).key);
                    let year = d.rules.world.start_year + i64::from(d.calendar.date_of(at_day).year) - 1;
                    assert!(
                        d.geography
                            .places
                            .authored
                            .locations
                            .get(key)
                            .and_then(|p| p.dormant.as_ref())
                            .is_none_or(|p| year >= i64::from(p.until)),
                        "补给港在剧情日期已开放"
                    );
                    println!(
                        "V01_STOPOVER {}",
                        json!({"from":d.loc(from).key,"to":key,"days":leg,"supported":supported})
                    );
                    from = dest;
                    at_day += leg as u32 + 1;
                }
            } else {
                targets.push((to, days));
            }
        }
        for (to, days) in targets {
            assert!(
                supported * 2 >= days * 3,
                "{}→{}：{days} 天，保留货物满载补给 {supported} 天，余量不足 50%",
                o.key,
                d.loc(to).key
            );
            assert!(f.supplies_needed(&d, (days * 3 + 1) / 2) <= f.food);
        }
    }
}

#[test]
fn ocean_supplies_still_take_cargo_and_classic_keeps_its_default() {
    let d = defs();
    let classic = manifest_data::load(&root()).expect("经典世界加载");
    assert!(!classic.rules.fractional_supplies);
    assert_eq!(classic.rules.crew_per_supply_unit, 20);
    assert_eq!(manifest_core::fleet::supplies_for_days(&classic, 18, 90), 90);
    // 自由开局的 90 天远洋航程：90 格舱位中仍需 66 格粮水，不能忽略贸易取舍。
    assert_eq!(manifest_core::fleet::supplies_for_days(&d, 18, 90) * 2, 66);
    assert_eq!(manifest_core::fleet::supplies_for_days(&d, 60, 30) * 2, 72);
}

#[test]
fn small_starting_boats_report_actual_manual_near_port_passages() {
    use manifest_core::{
        Fx, RegionId,
        navigation::{
            ManualVoyage,
            course::{CourseInput, integrate_course},
        },
    };
    let d = defs();
    // 只把海图揭开以隔离补给与操船；船、港口、日期、每日风流、分钟积分器均为生产定义。
    let mut w = navigation_world();
    w.state.explore.cells.fill(u64::MAX);
    w.state.explore.sighted.extend(d.port_ids());
    for o in openings(&d).into_iter().filter(|o| ["mio", "kaicili", "tariq"].contains(&o.key.as_str())) {
        w.state.day = o.day;
        let (to, seasonal) = nearest(&d, &o)[0];
        let pilot = w.known_sea_path(o.fleet.cell(&d), to, false).expect("真实已知海路");
        let preview = pilot.path.len();
        w.state.fleets.insert(o.fleet.id, o.fleet.clone());
        let revised = w.navigation_path_days(o.fleet.id, &pilot.path);
        let mut voyage = ManualVoyage::new(o.fleet.cell(&d), 0);
        voyage.autopilot = Some(to);
        voyage.pilot = Some(pilot);
        let mut outcome = json!({"status":"over_120_days"});
        for offset in 0..120 {
            let day = o.day + offset;
            let weather: Vec<_> = (0..d.regions.len())
                .map(|i| manifest_core::weather::day_weather(&d, 42, RegionId::from_idx(i), day, Fx::ONE))
                .collect();
            let course = integrate_course(
                CourseInput {
                    defs: &d,
                    fleet: &o.fleet,
                    start: &voyage,
                    from: 0,
                    until: 1440,
                    steers: &[],
                    day,
                    speed_bonus: Fx::ZERO,
                    mods: Default::default(),
                },
                |cell| d.map.region_of(cell).and_then(|r| weather[r.idx()]),
            );
            if course.arrival == Some(to) {
                outcome = json!({"status":"arrived","days":offset+1});
                break;
            }
            if course.voyage.pilot.is_none() {
                outcome = json!({"status":"navigation_stopped","days":offset+1,"stops":course.stops});
                break;
            }
            voyage = course.voyage;
        }
        println!(
            "V01_MANUAL {}",
            json!({"key":o.key,"to":d.loc(to).key,"seasonal_days":seasonal,"preview_days":preview,"revised_days":revised,"actual":outcome})
        );
    }
}

#[test]
fn all_openings_and_four_paths_have_a_real_seasonal_supply_audit() {
    let d = defs();
    let openings = openings(&d);
    assert_eq!(openings.len(), 22, "九位主角、十二种出身、自由航海");
    assert_eq!(d.upbringing.paths.len(), 84);
    for o in &openings {
        assert_eq!(nearest(&d, o).len(), 3, "{} 有三条真实近港航路", o.key);
        assert!(o.fleet.crew >= o.fleet.crew_min(&d), "{} 起始船员足够", o.key);
        assert!(o.fleet.used() <= o.fleet.capacity(), "{} 起始装载合法", o.key);
        println!("V01_AUDIT {}", audit(&d, o));
    }
}

#[test]
fn every_opening_has_half_a_passage_in_reserve_with_real_manual_navigation() {
    use manifest_core::{
        Fx, RegionId,
        navigation::{
            ManualVoyage,
            course::{CourseInput, integrate_course},
        },
    };
    let d = defs();
    let mut w = navigation_world();
    w.state.explore.cells.fill(u64::MAX);
    w.state.explore.sighted.extend(d.port_ids());
    let mut failures = Vec::new();
    for o in openings(&d) {
        let mut f = o.fleet.clone();
        f.food = (f.capacity() - f.cargo_total()) / 2;
        f.water = f.food;
        let supported = f.supplies_days(&d).expect("有船员");
        let from = f.docked_at().expect("起始港");
        let mut targets: Vec<_> = nearest(&d, &o).into_iter().map(|(to, _)| (from, to, o.day, false)).collect();
        if let Some((_, to, day)) = first_task(&d, &o) {
            if !stopovers(&o.key).is_empty() {
                let mut previous = from;
                for &key in stopovers(&o.key) {
                    let next = d.find_loc(key).expect("既有补给港");
                    targets.push((previous, next, expedition_start(&d, &o, day), true));
                    previous = next;
                }
            } else {
                targets.push((from, to, day, false));
            }
        }
        let mut next_stop_day = None;
        for (start, to, base_day, stopover) in targets {
            let day = if stopover { next_stop_day.unwrap_or(base_day) } else { base_day };
            w.state.day = day;
            f.location = FleetLocation::Docked(start);
            let pilot = match w.known_sea_path(d.loc(start).cell, to, false) {
                Ok(pilot) => pilot,
                Err(error) => {
                    failures.push(format!("{}：{}→{}，{error}", o.key, d.loc(start).key, d.loc(to).key));
                    continue;
                }
            };
            let mut voyage = ManualVoyage::new(d.loc(start).cell, 0);
            voyage.autopilot = Some(to);
            voyage.pilot = Some(pilot);
            let mut actual = None;
            // 验收仍要求至少 50% 余量；多计算一段只为报告真实抵达时间，不把迟到算通过。
            let limit = (supported * 2 / 3) as u32;
            for offset in 0..(supported as u32 * 2) {
                let today = day + offset;
                let weather: Vec<_> = (0..d.regions.len())
                    .map(|i| manifest_core::weather::day_weather(&d, 42, RegionId::from_idx(i), today, Fx::ONE))
                    .collect();
                let course = integrate_course(
                    CourseInput {
                        defs: &d,
                        fleet: &f,
                        start: &voyage,
                        from: 0,
                        until: 1440,
                        steers: &[],
                        day: today,
                        speed_bonus: Fx::ZERO,
                        mods: Default::default(),
                    },
                    |cell| d.map.region_of(cell).and_then(|r| weather[r.idx()]),
                );
                if course.arrival == Some(to) {
                    actual = Some(offset + 1);
                    break;
                }
                if course.voyage.pilot.is_none() {
                    println!(
                        "V01_STOP {}",
                        json!({"key":o.key,"to":d.loc(to).key,
                        "offset":offset+1,"pos":course.voyage.pos,"stops":course.stops})
                    );
                    break;
                }
                voyage = course.voyage;
            }
            println!(
                "V01_PASSAGE {}",
                json!({"key":o.key,"from":d.loc(start).key,"to":d.loc(to).key,
                "day":day,"actual_days":actual,"supported":supported,"limit":limit})
            );
            if o.key == "custom_basque_whaling" && d.loc(to).key == "red_bay" {
                let deadline = manifest_core::scenario::day_of(&d, [1557, 11, 10]).expect("原剧情截止日");
                if actual.is_none_or(|days| day + days > deadline) {
                    failures.push("巴斯克航线须在原剧情截止日前抵达红湾".to_string());
                }
            }
            if stopover {
                next_stop_day = Some(day + actual.unwrap_or(limit) + 1);
            }
            if actual.is_none_or(|days| days > limit) {
                failures.push(format!("{}：{}→{}，未在 {limit} 天内抵达", o.key, d.loc(start).key, d.loc(to).key));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}
