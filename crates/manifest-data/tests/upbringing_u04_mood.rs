//! U04 工作包 3（A11）：心情与疲劳有张力。
//!
//! - 规则单元：月初回归（不越过中心，兴致高时回得更多）、兴致加成门槛、休息只回一点心情、每旬疲劳自然恢复、
//!   低谷事件每段只触发一次并排在本旬最前、没有心情规则的世界照旧。
//! - 整局：九位主角只用“均衡”跑满四年，心情 ≥ 95 的月份 ≤ 30%（按每月日结后的最高心情计，最严的读法）。
#[path = "support/u04.rs"]
mod u04;
use manifest_core::{Command, OwnerId, ScenarioId, World, upbringing::*};
use std::{collections::BTreeMap, sync::Arc};

fn testbed(rules: Option<MoodRules>) -> World {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    Arc::make_mut(&mut d).upbringing.rules.mood = rules;
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    World::new(d, sid, 42).unwrap()
}

fn rests(w: &mut World) {
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
            .collect(),
    }
    .apply(w)
    .unwrap();
}

fn day(w: &mut World) {
    while w.pending_story2().is_some() {
        Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(w).unwrap();
    }
    w.end_day().unwrap();
}

fn mood(w: &World) -> i64 {
    w.state.upbringing.as_ref().unwrap().mood
}

#[test]
fn opening_mood_is_the_center_and_old_worlds_start_at_zero() {
    assert_eq!(mood(&testbed(Some(MoodRules::default()))), 50);
    assert_eq!(mood(&testbed(None)), 0);
}

#[test]
fn monthly_regression_moves_toward_the_center_and_faster_when_high() {
    for (start, expected) in
        [(100, 80), (85, 65), (80, 60), (79, 69), (55, 50), (50, 50), (45, 50), (20, 30), (-100, -90)]
    {
        let mut w = testbed(Some(MoodRules::default()));
        // 休息不回心情、不减疲劳，只看月初回归。
        let rest = Arc::make_mut(&mut w.defs).upbringing.activities.iter_mut().find(|a| a.key == "rest").unwrap();
        rest.mood = 0;
        rest.fatigue = 0;
        rests(&mut w);
        while w.cast_date()[2] < 31 {
            day(&mut w);
        }
        w.state.upbringing.as_mut().unwrap().mood = start;
        day(&mut w);
        assert_eq!([w.cast_date()[1], w.cast_date()[2]], [2, 1]);
        assert_eq!(mood(&w), expected, "月末 {start}");
    }
}

#[test]
fn old_worlds_have_no_regression() {
    let mut w = testbed(None);
    let rest = Arc::make_mut(&mut w.defs).upbringing.activities.iter_mut().find(|a| a.key == "rest").unwrap();
    rest.mood = 0;
    rests(&mut w);
    while w.cast_date()[2] < 31 {
        day(&mut w);
    }
    w.state.upbringing.as_mut().unwrap().mood = 100;
    day(&mut w);
    assert_eq!(mood(&w), 100);
}

#[test]
fn high_mood_bonus_starts_at_eighty_and_old_rule_is_unchanged() {
    let mut w = testbed(Some(MoodRules::default()));
    for (m, pct) in [(-31, 80), (20, 100), (50, 100), (79, 100), (80, 110), (100, 110)] {
        w.state.upbringing.as_mut().unwrap().mood = m;
        assert_eq!(w.upbringing_mood_pct(m), pct, "心情 {m}");
    }
    let a = w.defs.upbringing.activity("train_navigation").unwrap().clone();
    w.state.upbringing.as_mut().unwrap().mood = 79;
    let plain = w.upbringing_efficiency(&a);
    w.state.upbringing.as_mut().unwrap().mood = 80;
    assert_eq!(w.upbringing_efficiency(&a), plain * 110 / 100);
    let old = testbed(None);
    for (m, pct) in [(-31, 80), (-30, 100), (39, 100), (40, 110), (100, 110)] {
        assert_eq!(old.upbringing_mood_pct(m), pct, "旧规则 心情 {m}");
    }
}

#[test]
fn rest_gives_little_mood_and_fatigue_recovers_five_each_slot() {
    let mut w = testbed(Some(MoodRules::default()));
    let rest = w.defs.upbringing.activity("rest").unwrap().clone();
    assert!(rest.mood > 2, "测试世界的休息原本回 {} 心情", rest.mood);
    assert_eq!(w.upbringing_activity_mood(&rest), 2);
    let s = w.state.upbringing.as_mut().unwrap();
    s.fatigue = 30;
    s.stamina = 70;
    s.mood = 50;
    rests(&mut w);
    for _ in 0..10 {
        day(&mut w);
    }
    let s = w.state.upbringing.as_ref().unwrap();
    let after_rest = (30 + rest.fatigue).clamp(0, 100);
    assert_eq!(s.fatigue, (after_rest - 5).max(0));
    assert_eq!(s.stamina, 100 - s.fatigue);
    assert_eq!(s.mood, 52);
    assert_eq!(s.last[0].fatigue, s.fatigue - 30, "自然恢复计入本旬结果");
    assert_eq!(s.last[0].mood, 2);
    // 旧世界：休息照数据回心情，没有自然恢复。
    let mut old = testbed(None);
    let s = old.state.upbringing.as_mut().unwrap();
    s.fatigue = 30;
    s.mood = 50;
    rests(&mut old);
    for _ in 0..10 {
        day(&mut old);
    }
    let s = old.state.upbringing.as_ref().unwrap();
    assert_eq!(s.fatigue, after_rest);
    assert_eq!(s.mood, 50 + rest.mood);
}

#[test]
fn fatigue_recovery_never_goes_below_zero() {
    let mut w = testbed(Some(MoodRules::default()));
    w.state.upbringing.as_mut().unwrap().fatigue = 3;
    rests(&mut w);
    for _ in 0..10 {
        day(&mut w);
    }
    let s = w.state.upbringing.as_ref().unwrap();
    assert_eq!(s.fatigue, 0);
    assert_eq!(s.stamina, 100);
}

#[test]
fn low_mood_triggers_once_per_episode_and_rearms_after_recovery() {
    let rules = MoodRules { low_events: vec!["upbringing_short".into()], ..Default::default() };
    let mut w = testbed(Some(rules));
    let rest = Arc::make_mut(&mut w.defs).upbringing.activities.iter_mut().find(|a| a.key == "rest").unwrap();
    rest.mood = 0;
    w.state.upbringing.as_mut().unwrap().mood = 10;
    rests(&mut w);
    for _ in 0..10 {
        day(&mut w);
    }
    // 第一旬结算后进入低谷，次日低谷事件排在本旬最前。
    let s = w.state.upbringing.as_ref().unwrap();
    assert!(s.low_mood);
    assert!(
        w.state.story2.pending.iter().any(|p| p.track == "upbringing_short")
            || w.state.story2.tracks.contains_key("upbringing_short"),
        "低谷事件没有入队"
    );
    // 存档往返不丢低谷标记。
    let w2 = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    assert_eq!(w2.state, w.state);
    // 还在低谷里：标记保持，不复位。
    for _ in 0..10 {
        day(&mut w);
    }
    assert!(w.state.upbringing.as_ref().unwrap().low_mood);
    // 回到门槛以上就复位；再跌下去重新进入低谷。
    w.state.upbringing.as_mut().unwrap().mood = 60;
    while !w.state.upbringing.as_ref().unwrap().last.iter().any(|r| r.index == 2) {
        day(&mut w);
    }
    assert!(!w.state.upbringing.as_ref().unwrap().low_mood);
}

#[test]
fn low_mood_event_wins_the_encounter_slot_over_any_seed() {
    for seed in 0..16 {
        let rules = MoodRules { low_events: vec!["upbringing_short".into()], ..Default::default() };
        let mut w = testbed(Some(rules));
        w.state.seed = seed;
        w.state.upbringing.as_mut().unwrap().mood = 10;
        rests(&mut w);
        for _ in 0..10 {
            day(&mut w);
        }
        let s = w.state.upbringing.as_ref().unwrap();
        assert!(s.low_mood, "seed {seed}");
        assert!(
            s.event_permits.contains("upbringing_short") || s.activity_tracks.contains("upbringing_short"),
            "seed {seed}"
        );
    }
}

#[test]
fn saves_without_the_low_mood_flag_still_load_and_do_not_write_it() {
    let w = testbed(Some(MoodRules::default()));
    let json = serde_json::to_value(&w.state).unwrap();
    assert!(json["upbringing"].get("low_mood").is_none(), "没进低谷时不写这个字段");
    let mut old = json.clone();
    old["upbringing"].as_object_mut().unwrap().remove("low_mood");
    let state: manifest_core::WorldState = serde_json::from_value(old).unwrap();
    assert!(!state.upbringing.unwrap().low_mood);
}

#[test]
fn terra16_mood_rules_are_explicit_and_rest_only_restores_fatigue() {
    let d = u04::defs();
    let r = d.upbringing.rules.mood.as_ref().expect("寰宇写了心情规则");
    assert_eq!(
        (r.center, r.monthly_step, r.high_step, r.high, r.high_bonus_pct, r.low, r.rest_mood_max, r.fatigue_recovery),
        (50, 10, 20, 80, 10, 20, 2, 5)
    );
    assert!(!r.low_events.is_empty());
    for a in d.upbringing.activities.iter().filter(|a| a.kind == ActivityKind::Rest) {
        assert!(a.gains.is_empty() && a.skills.is_empty(), "{} 休息不该带成长", a.key);
        assert!(a.fatigue < 0, "{} 休息要回疲劳", a.key);
    }
    let mut v = (*d).clone();
    v.upbringing.rules.mood.as_mut().unwrap().low = 60;
    assert!(manifest_core::upbringing::activity_validation::validate(&v).iter().any(|e| e.contains("心情规则")));
    let mut v = (*d).clone();
    v.upbringing.rules.mood.as_mut().unwrap().low_events = vec!["no_such_track_u04".into()];
    assert!(manifest_core::upbringing::activity_validation::validate(&v).iter().any(|e| e.contains("心情低谷事件")));
}

/// 九位主角各跑四年“均衡”，统计每月日结后的最高心情。
fn four_years(family: &str) {
    let mut peak: BTreeMap<[u32; 2], i64> = BTreeMap::new();
    let mut lowest = i64::MAX;
    u04::run_balanced(family, 7, [1557, 1, 1], |w| {
        let Some(s) = w.state.upbringing.as_ref() else { return };
        let d = w.cast_date();
        let e = peak.entry([d[0], d[1]]).or_insert(i64::MIN);
        *e = (*e).max(s.mood);
        lowest = lowest.min(s.mood);
    });
    let months = peak.len();
    let high = peak.values().filter(|m| **m >= 95).count();
    let curve: Vec<String> = peak.iter().map(|(m, v)| format!("{}-{:02}:{v}", m[0], m[1])).collect();
    eprintln!("{family}：{months} 个月，≥95 的 {high} 个月，最低 {lowest}；{}", curve.join(" "));
    assert!(months >= 40, "{family}：只跑了 {months} 个月");
    assert!(high * 100 <= months * 30, "{family}：心情 ≥ 95 的月份 {high}/{months} 超过 30%");
}

macro_rules! heroes {
    ($($name:ident => $key:literal),* $(,)?) => {
        $(
            #[test]
            fn $name() {
                four_years($key);
            }
        )*
    };
}

heroes! {
    four_years_mood_mio => "mio",
    four_years_mood_lieve => "lieve",
    four_years_mood_najma => "najma",
    four_years_mood_lin_wandeng => "lin_wandeng",
    four_years_mood_ix_nikte => "ix_nikte",
    four_years_mood_noel => "noel",
    four_years_mood_tariq => "tariq",
    four_years_mood_kaicili => "kaicili",
    four_years_mood_baraka => "baraka",
}
