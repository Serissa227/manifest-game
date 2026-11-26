//! H08 航海日志的一程与航程总结的测试。
use super::*;
use crate::navigation::{ManualVoyage, Sail, SubCell};
use crate::testkit::tiny_defs;
use crate::world::Voyage;
use crate::{Cell, Command, ScenarioId};
use std::sync::Arc;

fn world(enabled: bool) -> (World, FleetId) {
    let mut d = (*tiny_defs()).clone();
    d.manual_navigation = true;
    d.rules.voyage_log.enabled = enabled;
    d.rules.pirates.spawn_scale = crate::Fx::ZERO;
    d.rules.disease_bp_per_30_days = 0;
    let mut w = World::new(Arc::new(d), ScenarioId(0), 3).unwrap();
    let id = w.fleets_of(OwnerId::Player).next().unwrap().id;
    Command::Resupply { owner: OwnerId::Player, fleet: id, food: 10, water: 10 }.apply(&mut w).unwrap();
    let mut manual = ManualVoyage::new(Cell::new(4, 4), 90);
    manual.sail = Sail::Furled;
    w.fleet_mut(id).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual });
    (w, id)
}

fn line(from: Cell, cells: i64, minutes: u16) -> Vec<CoursePoint> {
    // 每分钟往东走 cells / minutes 格
    (0..=minutes)
        .map(|m| CoursePoint {
            pos: SubCell {
                x: i64::from(from.x) * 256 + 128 + cells * 256 * i64::from(m) / i64::from(minutes),
                y: i64::from(from.y) * 256 + 128,
            },
            minute: m,
        })
        .collect()
}

#[test]
fn a_trip_counts_distance_once_and_sums_up_at_the_port() {
    let (mut w, id) = world(true);
    w.voyage_log_day();
    assert!(w.state.voyage_log.trips.contains_key(&id), "在海上就开始记一程");
    let points = line(Cell::new(4, 4), 3, 600);
    // 同一段落实两次（分钟落实之后日结又给一遍整天）：里程只算一次
    w.voyage_log_track(id, &points[..=300]);
    w.voyage_log_track(id, &points);
    let d = w.state.voyage_log.trips[&id].distance;
    assert!((3 * 256 - 4..=3 * 256 + 4).contains(&d), "3 格的里程：{d}");
    // 途中受损、少了两个人
    let hull: i64 = w.fleet(id).unwrap().ships.iter().map(|s| s.durability).sum();
    for s in &mut w.fleet_mut(id).unwrap().ships {
        s.durability -= 5;
    }
    w.fleet_mut(id).unwrap().crew -= 2;
    let n = w.fleet(id).unwrap().ships.len() as i64;
    w.state.day += 4;
    w.voyage_log_arrive(id, LocId(1));
    let s = w.state.voyage_log.last.clone().expect("到港有总结");
    assert_eq!((s.days, s.to, s.hull_lost, s.crew_change), (4, LocId(1), 5 * n, -2));
    assert_eq!(s.distance, d);
    assert!(hull > 0 && s.record_days.is_none());
    assert!(!w.state.voyage_log.trips.contains_key(&id), "这一程结束了");
    // 只弹一次：过了到港的第二天就不再给
    w.fleet_mut(id).unwrap().location = FleetLocation::Docked(LocId(1));
    w.state.day += 2;
    w.voyage_log_day();
    assert!(w.state.voyage_log.last.is_none());
}

#[test]
fn disabled_voyage_log_keeps_no_state() {
    let (mut w, id) = world(false);
    w.voyage_log_day();
    w.voyage_log_track(id, &line(Cell::new(4, 4), 2, 100));
    w.voyage_log_arrive(id, LocId(1));
    assert!(w.state.voyage_log.is_empty());
    assert!(!serde_json::to_string(&w.state).unwrap().contains("voyage_log"));
}
