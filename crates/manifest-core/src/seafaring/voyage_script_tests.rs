//! H02 “脚本航程”（docs/VOYAGE-PLAN.md §3.7）：同一条约 46 天的航线（干净船底、顺风时；断鲜 45 天才发坏血病，航线要比它长一点才看得出鲜食的作用）、同一串天气，全缺省与“会操作”各跑一遍，
//! 比航时与损耗，对照原则 2 的目标（用心的玩家航时少约 15%、损耗少约一半）。数字用 `--nocapture` 打出来，写进交接文档。
//!
//! 天气按日子排好（不掷骰）：顺风 5 级为主，第 9–10、21–22、33–34 天暴风雨，第 12–13、30 天大风 9 级，第 5、15、27 天起雾。
//! 暴风雨日每艘船按 10% 掉船体（代替原来的掷骰，两边相同）。
use super::*;
use crate::defs::SeasonWeather;
use crate::nav::{NavTable, Terrain};
use crate::navigation::course::{CourseInput, integrate_course};
use crate::navigation::{ManualVoyage, SubCell};
use crate::weather::{DayWeather, Sky};
use crate::{ScenarioId, testkit};
use std::sync::Arc;

fn weather(day: u32) -> DayWeather {
    let (sky, wind) = match day {
        9 | 10 | 21 | 22 | 33 | 34 => (Sky::Storm, 9),
        12 | 13 | 30 => (Sky::Clear, 9),
        5 | 15 | 27 => (Sky::Fog, 3),
        _ => (Sky::Clear, 5),
    };
    DayWeather {
        region: crate::RegionId(0),
        day,
        sky,
        storm_hit_e8: 0,
        sea: SeasonWeather {
            wind_dir: 2,
            wind_strength: wind,
            current_dir: 0,
            current_strength: 0,
            storm_bp: 0,
            pirate_bp: 0,
        },
    }
}

/// 一条没有港口的纬线（从这一行的西头出发一路往东，不会被当成靠港停下）。
fn lane(w: &World) -> crate::Cell {
    let y = (0..w.defs.map.height).find(|y| w.defs.locations.iter().all(|l| l.cell.y != *y)).unwrap_or(0);
    crate::Cell::new(0, y)
}

fn open_sea() -> (World, FleetId) {
    let mut defs = (*testkit::tiny_defs()).clone();
    defs.manual_navigation = true;
    defs.map.terrain.fill(Terrain::Deep);
    defs.map.region.fill(u16::MAX);
    defs.map.wrap_x = true;
    defs.nav = Arc::new(NavTable::build(&defs.map, &defs.regions, defs.locations.len(), &[]));
    defs.rules.voyage_wear =
        WearRules { enabled: true, antiscorbutic: vec![defs.goods[0].key.clone()], ..Default::default() };
    let mut w = World::new(Arc::new(defs), ScenarioId(0), 7).unwrap();
    let id = w.flagship(OwnerId::Player).unwrap();
    let min = w.fleet(id).unwrap().crew_min(&w.defs);
    let f = w.fleet_mut(id).unwrap();
    f.crew = f.crew.max(min * 2);
    f.morale = 100;
    f.cargo.clear();
    (w, id)
}

#[derive(Debug, Default)]
struct Outcome {
    days: u32,
    hull_lost_pct: i64,
    rigging: i64,
    dead: i64,
    sick: i64,
    fatigue_peak: i64,
}

/// 一趟航程：`skilled` 时出发前刮了船底、补满船材、带了抗坏血病的货，按疲劳换节奏。
fn voyage(skilled: bool, distance: i64) -> Outcome {
    let (mut w, id) = open_sea();
    let crew0 = w.fleet(id).unwrap().crew;
    let max: i64 = w.fleet(id).unwrap().ships.iter().map(|s| s.max_durability).sum();
    {
        let mut wear = w.fleet_wear(id);
        // 上一趟回来没进船坞：船底附着 40、帆缆 90
        wear.fouling = 40 * POINT;
        wear.rigging_wear = 10 * POINT;
        if skilled {
            wear.fouling = 0;
            wear.timber = w.timber_cap(id);
        }
        w.wear_store(id, wear);
    }
    if skilled {
        let crew = w.fleet(id).unwrap().crew;
        let need = crate::fleet::daily_supply_need(&w.defs, crew) * 60;
        w.fleet_mut(id).unwrap().cargo.insert(crate::GoodId(0), need);
    }
    let mut voyage = ManualVoyage::new(lane(&w), 90);
    let width = i64::from(w.defs.map.width) * SubCell::SCALE;
    let mut travelled = 0i64;
    let mut out = Outcome::default();
    for day in 0..120u32 {
        if travelled >= distance * SubCell::SCALE {
            break;
        }
        w.state.day = day;
        let wx = weather(day);
        if skilled {
            let mut wear = w.fleet_wear(id);
            wear.orders.pace = if wear.fatigue < 40 && wx.sky != Sky::Storm { Pace::Hard } else { Pace::Easy };
            w.wear_store(id, wear);
        }
        w.fleet_mut(id).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual: voyage.clone() });
        let course = {
            let f = w.fleet(id).unwrap();
            integrate_course(
                CourseInput {
                    defs: &w.defs,
                    fleet: f,
                    start: &voyage,
                    from: 0,
                    until: crate::navigation::course::MINUTES_PER_DAY,
                    steers: &[],
                    day,
                    speed_bonus: w.fleet_speed_bonus(id),
                    mods: w.voyage_mods(id),
                },
                |_| Some(wx),
            )
        };
        let dx = (course.voyage.pos.x - voyage.pos.x).rem_euclid(width);
        travelled += dx;
        voyage = course.voyage;
        // 穿过测试海图上的港口格会被当成靠港停下：照旧扬帆继续往东
        voyage.sail = if voyage.reefed { Sail::Half } else { Sail::Full };
        voyage.heading = 90;
        w.fleet_mut(id).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual: voyage.clone() });
        w.fleet_mut(id).unwrap().days_at_sea = day;
        if wx.sky == Sky::Storm {
            for s in &mut w.fleet_mut(id).unwrap().ships {
                s.durability -= s.max_durability / 10;
            }
        }
        w.wear_sea_day(id, Some(&wx)).unwrap();
        out.fatigue_peak = out.fatigue_peak.max(w.fleet_wear(id).fatigue);
        out.days = day + 1;
    }
    let f = w.fleet(id).unwrap();
    let wear = w.fleet_wear(id);
    out.hull_lost_pct = (max - f.ships.iter().map(|s| s.durability).sum::<i64>()) * 100 / max.max(1);
    out.rigging = wear.rigging_points();
    out.dead = crew0 - f.crew;
    out.sick = wear.sick;
    out
}

#[test]
fn scripted_voyage_skilled_play_is_faster_and_loses_less() {
    // 航程：干净船底、新帆缆、正常节奏、顺风 5 级时 46 天的路
    let (w, id) = open_sea();
    let f = w.fleet(id).unwrap();
    let start = ManualVoyage::new(lane(&w), 90);
    let day = integrate_course(
        CourseInput {
            defs: &w.defs,
            fleet: f,
            start: &start,
            from: 0,
            until: crate::navigation::course::MINUTES_PER_DAY,
            steers: &[],
            day: 0,
            speed_bonus: w.fleet_speed_bonus(id),
            mods: w.voyage_mods(id),
        },
        |_| Some(weather(0)),
    );
    let per_day = (day.voyage.pos.x - start.pos.x).rem_euclid(i64::from(w.defs.map.width) * SubCell::SCALE);
    let distance = per_day * 46 / SubCell::SCALE;
    let plain = voyage(false, distance);
    let skilled = voyage(true, distance);
    eprintln!("脚本航程（{distance} 格）：全缺省 {plain:?}");
    eprintln!("脚本航程（{distance} 格）：会操作 {skilled:?}");
    assert!(skilled.days < plain.days, "{skilled:?} vs {plain:?}");
    assert!(skilled.hull_lost_pct + skilled.dead + skilled.sick < plain.hull_lost_pct + plain.dead + plain.sick);
}
