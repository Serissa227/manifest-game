//! H03 天气团的测试：纯函数性与确定性、团内外的天况、移动、开关关闭时与海区天况一致、绕开则不受损。
use super::*;
use crate::navigation::{ManualVoyage, Sail};
use crate::testkit::tiny_defs;
use crate::weather::{DayTable, day_weather};
use crate::world::{FleetLocation, Voyage, World};
use crate::{Command, FleetId, LocId, OwnerId, ScenarioId};
use std::sync::Arc;

fn defs(enabled: bool) -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.manual_navigation = true;
    d.rules.weather_cells.enabled = enabled;
    d.rules.pirates.spawn_scale = Fx::ZERO;
    d.rules.disease_bp_per_30_days = 0;
    // 西海与东海的风暴、雾都多一些，统计更快
    for r in &mut d.regions {
        for s in &mut r.seasons {
            s.storm_bp = 300;
        }
    }
    Arc::new(d)
}

/// 找一天：某海区今天有风暴团。
fn storm_day(d: &StaticData, seed: u64, region: RegionId) -> (u32, Vec<WeatherCell>) {
    (0..2_000)
        .find_map(|day| {
            let cells = cells_of(d, seed, region, day, Fx::ONE);
            cells.iter().any(|c| c.kind == CellKind::Storm).then_some((day, cells))
        })
        .expect("两千天里总有风暴团")
}

#[test]
fn cells_are_pure_and_deterministic() {
    let d = defs(true);
    let mut kinds = [0; 3];
    let mut differs = 0;
    for day in 0..720 {
        for r in 0..d.regions.len() {
            let r = RegionId::from_idx(r);
            let a = cells_of(&d, 7, r, day, Fx::ONE);
            assert_eq!(a, cells_of(&d, 7, r, day, Fx::ONE), "同种子同日同海区的天气团必须相同");
            if a != cells_of(&d, 8, r, day, Fx::ONE) {
                differs += 1;
            }
            let base = day_weather(&d, 7, r, day, Fx::ONE).unwrap();
            for c in &a {
                kinds[rank(c.kind) as usize] += 1;
                assert!(c.radius >= 2 * 256 && c.radius <= 9 * 256, "半径在规则范围内");
                assert!(u32::from(c.index) < 2);
                assert!(c.start <= day && day < c.end, "团活在它的段落里");
                // 种类跟着海区当天的天况走
                match c.kind {
                    CellKind::Storm => assert_eq!(base.sky, Sky::Storm),
                    CellKind::Fog => assert_eq!(base.sky, Sky::Fog),
                    CellKind::Squall => assert!(matches!(base.sky, Sky::Rain | Sky::Snow)),
                }
                assert_eq!(c.storm_hit_e8 > 0, c.kind == CellKind::Storm);
            }
            if base.sky == Sky::Storm || base.sky == Sky::Fog {
                assert!(!a.is_empty(), "暴风雨与雾的日子至少有一个团");
            }
        }
    }
    assert!(kinds.iter().all(|k| *k > 0), "三种团都出现过：{kinds:?}");
    assert!(differs > 50, "换种子后团明显不同：{differs}");
    // 开关关着时没有团
    assert!(cells_of(&defs(false), 7, RegionId(0), 3, Fx::ONE).is_empty());
}

#[test]
fn cells_drift_with_the_wind_one_to_three_cells_a_day() {
    let d = defs(true);
    let mut checked = 0;
    for day in 0..1_500 {
        let today = cells_of(&d, 11, RegionId(0), day, Fx::ONE);
        let next = cells_of(&d, 11, RegionId(0), day + 1, Fx::ONE);
        for c in &today {
            let Some(n) = next.iter().find(|n| n.index == c.index && n.start == c.start && n.kind == c.kind) else {
                continue;
            };
            let moved = sub_distance2(&d, c.center, n.center);
            // 贴着外接矩形的边时会被夹住，只看没被夹住的
            let rect = d.regions[0].rect;
            let inner = |p: SubCell| {
                p.x > i64::from(rect.0) * 256 + 8 * 256
                    && p.x < i64::from(rect.2) * 256 - 8 * 256
                    && p.y > i64::from(rect.1) * 256 + 8 * 256
                    && p.y < i64::from(rect.3) * 256 - 8 * 256
            };
            if !inner(c.center) || !inner(n.center) {
                continue;
            }
            assert!(moved <= (4 * 256) * (4 * 256), "一天最多走 3 格多：{moved}");
            assert_eq!(n.radius, c.radius, "同一个团的半径不变");
            checked += 1;
        }
    }
    assert!(checked > 5, "应有足够的连续两天的团：{checked}");
}

#[test]
fn position_weather_inside_and_outside_cells() {
    let d = defs(true);
    let w = World::new(d.clone(), ScenarioId(0), 5).unwrap();
    let (day, cells) = storm_day(&d, 5, RegionId(0));
    let mut w = w;
    w.state.day = day;
    let storm = cells.iter().find(|c| c.kind == CellKind::Storm).unwrap();
    let base = w.weather_today(RegionId(0)).unwrap();
    assert_eq!(base.sky, Sky::Storm);
    let mut table = DayTable::new(&w);
    let (mut inside, mut outside) = (0, 0);
    for y in 0..d.map.height {
        for x in 0..20u16 {
            let cell = crate::Cell::new(x, y);
            let Some(at) = table.at_pos(&d, cell) else { continue };
            assert_eq!(Some(at), w.weather_at_pos(cell), "缓存与直接查询一致");
            let all = table.cells_near(&d, cell, 0);
            if all.iter().any(|c| c.kind == CellKind::Storm && contains(&d, c, SubCell::center(cell))) {
                assert_eq!(at.sky, Sky::Storm);
                assert!(at.storm_hit_e8 >= base.storm_hit_e8, "团内受损概率不低于海区（×200%）");
                inside += 1;
            } else {
                assert_ne!(at.sky, Sky::Storm, "团外不是暴风雨");
                assert_eq!(at.storm_hit_e8, 0, "团外不受损");
                outside += 1;
            }
            // 风向、洋流沿用海区当天的
            assert_eq!(at.sea.current_dir, base.sea.current_dir);
        }
    }
    assert!(inside > 0 && outside > 0, "团内 {inside} 格、团外 {outside} 格");
    assert!(contains(&d, storm, storm.center));
}

#[test]
fn disabled_cells_leave_position_weather_equal_to_region_weather() {
    let d = defs(false);
    let mut w = World::new(d.clone(), ScenarioId(0), 5).unwrap();
    for day in (0..400).step_by(13) {
        w.state.day = day;
        let mut table = DayTable::new(&w);
        for y in (0..d.map.height).step_by(3) {
            for x in (0..d.map.width).step_by(3) {
                let c = crate::Cell::new(x, y);
                assert_eq!(table.at_pos(&d, c), w.weather_at(c));
                assert_eq!(w.weather_at_pos(c), w.weather_at(c));
            }
        }
        assert!(w.weather_cells_near(crate::Cell::new(5, 5), 30).is_empty());
    }
}

/// 一支收着帆停在某格的玩家舰队（手动航行），船坚粮足。
fn parked(d: Arc<StaticData>, seed: u64, day: u32, cell: crate::Cell) -> (World, FleetId) {
    let mut w = World::new(d, ScenarioId(0), seed).unwrap();
    let id = w.fleets_of(OwnerId::Player).next().unwrap().id;
    Command::Resupply { owner: OwnerId::Player, fleet: id, food: 20, water: 20 }.apply(&mut w).unwrap();
    let mut manual = ManualVoyage::new(cell, 90);
    manual.sail = Sail::Furled;
    w.fleet_mut(id).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual });
    w.state.day = day;
    (w, id)
}

fn storm_logs(w: &World) -> usize {
    w.state.log.iter().filter(|e| matches!(e.kind, crate::log::LogKind::Storm { .. })).count()
}

#[test]
fn staying_outside_the_storm_cell_takes_no_damage_and_inside_does() {
    // 团内受损概率封顶到 100%：待在团里一整天必定受损；同一天停在团外则不受损
    let mut raw = (*defs(true)).clone();
    raw.rules.weather_cells.storm_hit_pct = 1_000;
    for r in &mut raw.regions {
        for s in &mut r.seasons {
            s.storm_bp = 3_000;
        }
    }
    let d = Arc::new(raw);
    let _ = LocId(0);
    let mut tested = 0;
    for seed in 1..40u64 {
        let (day, cells) = storm_day(&d, seed, RegionId(0));
        let probe = World::new(d.clone(), ScenarioId(0), seed).unwrap();
        let mut probe = probe;
        probe.state.day = day;
        let mut table = DayTable::new(&probe);
        let mut inside = None;
        let mut outside = None;
        for y in 0..d.map.height {
            for x in 0..15u16 {
                let c = crate::Cell::new(x, y);
                let Some(at) = table.at_pos(&d, c) else { continue };
                if at.sky == Sky::Storm && at.storm_hit_e8 >= E8 && inside.is_none() {
                    inside = Some(c);
                }
                if at.sky != Sky::Storm && outside.is_none() {
                    outside = Some(c);
                }
            }
        }
        let (Some(inside), Some(outside)) = (inside, outside) else { continue };
        let _ = cells;
        let (mut a, _) = parked(d.clone(), seed, day, inside);
        a.move_fleets().unwrap();
        assert_eq!(storm_logs(&a), 1, "种子 {seed}：在风暴团里待满一天必定受损");
        let (mut b, _) = parked(d.clone(), seed, day, outside);
        b.move_fleets().unwrap();
        assert_eq!(storm_logs(&b), 0, "种子 {seed}：绕开风暴团当天不受损");
        tested += 1;
        if tested >= 3 {
            break;
        }
    }
    assert!(tested >= 1, "应找到可测的风暴日");
}

#[test]
fn new_state_fields_stay_out_of_saves_and_old_saves_load() {
    // 开关关着：存档里没有追击的字段；开着跑几天：日结后“当天的追击结果”总是空的
    for enabled in [false, true] {
        let mut raw = (*defs(enabled)).clone();
        raw.rules.pursuit.enabled = enabled;
        let d = Arc::new(raw);
        let (mut w, _) = parked(d.clone(), 9, 0, crate::Cell::new(4, 4));
        for _ in 0..5 {
            w.end_day().unwrap();
        }
        let json = serde_json::to_string(&w.state).unwrap();
        assert!(!json.contains("\"pursued\""), "当天的追击结果不进存档");
        if !enabled {
            assert!(!json.contains("\"chases\""), "开关关着时存档里没有追击状态");
        }
        // 去掉新字段的旧存档照样读得进来
        let mut value: serde_json::Value = serde_json::from_str(&json).unwrap();
        if let Some(b) = value.get_mut("battles").and_then(|b| b.as_object_mut()) {
            b.remove("chases");
            b.remove("pursued");
        }
        let save = crate::SaveFile::new(
            &d,
            crate::StartParams::new(ScenarioId(0), 9),
            serde_json::from_value(value).unwrap(),
            Vec::new(),
        );
        let back = crate::SaveFile::from_json(&save.to_json().unwrap()).unwrap();
        assert!(World::from_snapshot(d.clone(), back.snapshot).is_ok());
    }
}
