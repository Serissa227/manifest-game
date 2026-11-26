//! H01 各读取点：有 / 无该效果时结果不同，且不越上限。
use super::tests::world_with;
use super::*;
use crate::navigation::course::{CourseInput, sail_limit, sail_limit_with, velocity};
use crate::navigation::{ManualVoyage, Sail};
use crate::rng::{Domain, Rng};
use crate::weather::{DayTable, DayWeather, Sky};
use crate::{Fx, RegionId};
use std::sync::Arc;

fn weather(sky: Sky, wind_dir: u8) -> DayWeather {
    DayWeather {
        region: RegionId(0),
        day: 0,
        sky,
        storm_hit_e8: 0,
        sea: crate::defs::SeasonWeather {
            wind_dir,
            wind_strength: 5,
            current_dir: 0,
            current_strength: 0,
            storm_bp: 0,
            pirate_bp: 0,
        },
    }
}

fn speed(w: &World, f: FleetId, heading: u16, wx: DayWeather) -> i64 {
    let fleet = w.fleet(f).unwrap();
    let start = ManualVoyage { sail: Sail::Full, ..ManualVoyage::new(fleet.cell(&w.defs), heading) };
    let input = CourseInput {
        defs: &w.defs,
        fleet,
        start: &start,
        from: 0,
        until: 0,
        steers: &[],
        day: 0,
        speed_bonus: Fx::ZERO,
        mods: w.voyage_mods(f),
    };
    let v = velocity(&input, &start, Some(wx));
    v[0].abs() + v[1].abs()
}

#[test]
fn upwind_narrows_the_dead_zone_by_at_most_eight_degrees() {
    let (plain, f) = world_with(true, &[]);
    let (posted, _) = world_with(true, &[(AttrHook::Upwind, 30)]);
    let fleet = plain.fleet(f).unwrap();
    let base = sail_limit(&plain.defs, fleet);
    assert_eq!(sail_limit_with(&plain.defs, fleet, &plain.voyage_mods(f)), base);
    assert_eq!(sail_limit_with(&posted.defs, fleet, &posted.voyage_mods(f)), base - 8);
    // 风从正北来（去向 4 = 南）；航向离风 base − 4 度：没有岗位时顶风停船，有了能走。
    let heading = base - 4;
    assert_eq!(speed(&plain, f, heading, weather(Sky::Clear, 4)), 0);
    assert!(speed(&posted, f, heading, weather(Sky::Clear, 4)) > 0);
}

#[test]
fn fog_sailing_offsets_the_fog_drag() {
    let (plain, f) = world_with(true, &[]);
    let (posted, _) = world_with(true, &[(AttrHook::FogSailing, 1)]);
    let clear = speed(&plain, f, 90, weather(Sky::Clear, 2));
    let fog = speed(&plain, f, 90, weather(Sky::Fog, 2));
    assert!(fog < clear);
    assert_eq!(speed(&posted, f, 90, weather(Sky::Fog, 2)), clear);
}

#[test]
fn fleet_coordination_moves_speed_towards_the_second_slowest_ship() {
    let (mut plain, f) = world_with(true, &[]);
    let (mut posted, _) = world_with(true, &[(AttrHook::FleetCoordination, 10_000)]);
    for w in [&mut plain, &mut posted] {
        let fleet = w.fleet_mut(f).unwrap();
        let mut fast = fleet.ships[0].clone();
        fast.speed_bonus = Fx::from_int(2);
        fleet.ships.push(fast);
        fleet.crew = 10_000;
    }
    let slow = speed(&plain, f, 90, weather(Sky::Clear, 2));
    let mid = speed(&posted, f, 90, weather(Sky::Clear, 2));
    assert!(mid > slow, "{mid} > {slow}");
    // 上限 50%：只靠拢一半，仍慢于快船单独航行
    let (mut solo, _) = world_with(true, &[]);
    let fleet = solo.fleet_mut(f).unwrap();
    fleet.ships[0].speed_bonus = Fx::from_int(2);
    fleet.crew = 10_000;
    assert!(mid < speed(&solo, f, 90, weather(Sky::Clear, 2)));
}

/// 在一片全是 0 号海区的海上过若干天，每天把船修满、士气补满，返回（船体损失、断粮外的死亡、疾病次数、吃掉的粮）。
fn sea_days(w: &mut World, f: FleetId, days: u32, setup: impl Fn(&mut crate::world::Fleet)) -> (i64, i64, usize, i64) {
    let (mut lost, mut dead, mut food) = (0, 0, 0);
    for day in 0..days {
        w.state.day = day;
        {
            let fleet = w.fleet_mut(f).unwrap();
            setup(fleet);
            for s in &mut fleet.ships {
                s.durability = s.max_durability;
            }
        }
        let (dur, crew, food0) = {
            let fl = w.fleet(f).unwrap();
            (fl.ships.iter().map(|s| s.durability).sum::<i64>(), fl.crew, fl.food)
        };
        let mut today = DayTable::new(w);
        let mut rng = Rng::derive(w.state.seed, day, Domain::Voyage, u64::from(f.0), 0);
        w.sea_day(f, &mut rng, &mut today, None).unwrap();
        let fl = w.fleet(f).unwrap();
        lost += dur - fl.ships.iter().map(|s| s.durability).sum::<i64>();
        dead += crew - fl.crew;
        food += food0 - fl.food;
    }
    let disease = w.state.log.iter().filter(|e| matches!(e.kind, crate::log::LogKind::Disease { .. })).count();
    (lost, dead, disease, food)
}

fn stormy(hooks: &[(AttrHook, i64)]) -> (World, FleetId) {
    let (mut w, f) = world_with(true, hooks);
    let d = Arc::make_mut(&mut w.defs);
    d.map.region.fill(0);
    for r in &mut d.regions {
        for s in &mut r.seasons {
            s.storm_bp = 3_000;
        }
    }
    d.rules.disease_bp_per_30_days = 0;
    (w, f)
}

fn keep_sailing(fleet: &mut crate::world::Fleet) {
    fleet.crew = 200;
    fleet.morale = 100;
    fleet.food = 10_000;
    fleet.water = 10_000;
    fleet.cargo.clear();
}

#[test]
fn storm_check_reduces_storm_damage_but_not_below_the_cap() {
    let (mut plain, f) = stormy(&[]);
    let (mut posted, _) = stormy(&[(AttrHook::StormCheck, 3_000)]);
    let (mut capped, _) = stormy(&[(AttrHook::StormCheck, 10_000)]);
    let a = sea_days(&mut plain, f, 200, keep_sailing).0;
    let b = sea_days(&mut posted, f, 200, keep_sailing).0;
    let c = sea_days(&mut capped, f, 200, keep_sailing).0;
    assert!(a > 0, "测试海区里应当有暴风雨");
    // 同一种子：暴风雨的日子相同，损伤按 70% / 40% 折算（逐船取整，留一点余量）
    assert!((b - a * 70 / 100).abs() <= a / 20 + 5, "{a} {b}");
    assert!((c - a * 40 / 100).abs() <= a / 20 + 5, "{a} {c}");
}

fn sickly(hooks: &[(AttrHook, i64)]) -> (World, FleetId) {
    let (mut w, f) = world_with(true, hooks);
    let d = Arc::make_mut(&mut w.defs);
    d.map.region.fill(u16::MAX);
    d.rules.disease_bp_per_30_days = 3_000;
    (w, f)
}

fn long_at_sea(fleet: &mut crate::world::Fleet) {
    keep_sailing(fleet);
    fleet.days_at_sea = 30;
}

#[test]
fn disease_guard_makes_outbreaks_rarer_and_healing_makes_them_less_deadly() {
    let (mut plain, f) = sickly(&[]);
    let (mut guarded, _) = sickly(&[(AttrHook::DiseaseGuard, 7_000)]);
    let (mut healed, _) = sickly(&[(AttrHook::Healing, 10_000)]);
    let (dead_a, _, n_a, _) = {
        let r = sea_days(&mut plain, f, 300, long_at_sea);
        (r.1, 0, r.2, 0)
    };
    let n_b = sea_days(&mut guarded, f, 300, long_at_sea).2;
    let (dead_c, n_c) = {
        let r = sea_days(&mut healed, f, 300, long_at_sea);
        (r.1, r.2)
    };
    assert!(n_a > 30, "{n_a}");
    assert!(n_b * 2 < n_a, "{n_b} vs {n_a}");
    // 治疗不改变发病（同一随机流），死亡减半（上限 50%）
    assert_eq!(n_c, n_a);
    assert!(dead_c * 100 <= dead_a * 55 && dead_c * 100 >= dead_a * 40, "{dead_c} vs {dead_a}");
}

#[test]
fn supply_discount_eats_less_and_morale_delay_postpones_the_decline() {
    let (mut plain, f) = sickly(&[]);
    let (mut thrifty, _) = sickly(&[(AttrHook::SupplyDiscount, 2_000), (AttrHook::Morale, 12)]);
    for w in [&mut plain, &mut thrifty] {
        Arc::make_mut(&mut w.defs).rules.disease_bp_per_30_days = 0;
    }
    let short = |fleet: &mut crate::world::Fleet| {
        keep_sailing(fleet);
        fleet.days_at_sea = 30;
    };
    let food_a = sea_days(&mut plain, f, 50, short).3;
    let food_b = sea_days(&mut thrifty, f, 50, short).3;
    assert!(food_b * 100 <= food_a * 81 && food_b * 100 >= food_a * 79, "{food_b} vs {food_a}");
    // 航行第 30 天：没有推迟时士气 −1，推迟 12 天（起点 37 天）时不降
    let once = |w: &mut World| {
        let fleet = w.fleet_mut(f).unwrap();
        keep_sailing(fleet);
        fleet.morale = 50;
        fleet.days_at_sea = 30;
        let mut today = DayTable::new(w);
        let mut rng = Rng::derive(1, 0, Domain::Voyage, 0, 0);
        w.sea_day(f, &mut rng, &mut today, None).unwrap();
        w.fleet(f).unwrap().morale
    };
    assert_eq!(once(&mut plain), 49);
    assert_eq!(once(&mut thrifty), 50);
}

#[test]
fn boarding_bonus_scales_only_the_crew_term() {
    assert_eq!(boarding_crew(120, 0), 120);
    assert_eq!(boarding_crew(120, 25), 150);
    let (w, f) = world_with(true, &[(AttrHook::Melee, 1_000), (AttrHook::Duel, 1_000)]);
    assert_eq!(boarding_crew(100, w.post_boarding_bonus(f)), 115);
}
