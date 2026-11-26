//! S01：奇遇的四种出场条件——季节、海上的天况与风力、停靠港口的文化圈。
//!
//! 夹具是内核自带的小型世界（有主角身世）；奇遇每天必出、没有间隔，所以“今天出的是哪一条”就是条件的读数：
//! 每组互斥的条件各挂一条奇遇，逐日对照日历、当天的天气与停靠的港口。

use manifest_core::captain::Birthday;
use manifest_core::story::{ChoiceDef, Cond, EncounterDef, Place, Speaker, StoryDefs, StoryRules, StorySource};
use manifest_core::testkit::captain_defs;
use manifest_core::weather::Sky;
use manifest_core::*;
use std::collections::BTreeSet;
use std::sync::Arc;

const ALPHA: LocId = LocId(0);
const BETA: LocId = LocId(1);
const PLAYER: OwnerId = OwnerId::Player;

fn encounter(key: &str, place: Place, when: Vec<Cond>) -> EncounterDef {
    EncounterDef {
        key: key.into(),
        title: key.into(),
        text: key.into(),
        speaker: Speaker::None,
        speaker_name: String::new(),
        place,
        when,
        weight: 1,
        once: false,
        cooldown_days: 0,
        choices: vec![ChoiceDef {
            text: "继续".into(),
            reply: String::new(),
            cost: 0,
            give: None,
            check: None,
            effects: Vec::new(),
            fail: Vec::new(),
            fail_reply: String::new(),
        }],
    }
}

/// 小型世界加一组每天必出的奇遇；两座港口分属两个文化圈。
fn world(encounters: Vec<EncounterDef>, seed: u64) -> World {
    let mut d = (*captain_defs()).clone();
    d.rules.pirates.spawn_scale = Fx::ZERO;
    d.locations[ALPHA.idx()].culture = "north".into();
    d.locations[BETA.idx()].culture = "south".into();
    d.stories = StoryDefs {
        rules: StoryRules { encounter_bp: 10_000, gap_days: 0, first_day: 0 },
        stories: Vec::new(),
        encounters,
    };
    d.meta.hash = "testkit-s01".into();
    let year = d.rules.world.start_year - 20;
    let mut w = World::new(Arc::new(d), ScenarioId(0), seed).expect("开局");
    Command::CreateCaptain {
        owner: PLAYER,
        birthday: Birthday { year, month: 3, day: 3 },
        answers: vec!["plain".into(), "cadet".into(), "debt".into()],
        alloc: vec![1, 1, 1, 1, 1, 0],
        genius: None,
    }
    .apply(&mut w)
    .expect("立身世");
    w
}

fn met(w: &World) -> Option<(String, u32)> {
    w.state.story.pending.as_ref().and_then(|p| match &p.source {
        StorySource::Encounter(key) => Some((key.clone(), p.day)),
        StorySource::Chapter(_) => None,
    })
}

/// 在两座港口之间来回跑 `days` 天，每天日结之后交给 `each` 看一眼。
fn shuttle(w: &mut World, days: u32, mut each: impl FnMut(&World)) {
    let fleet = w.flagship(PLAYER).expect("旗舰");
    for _ in 0..days {
        if let Some(at) = w.fleet(fleet).unwrap().docked_at() {
            let dest = if at == BETA { ALPHA } else { BETA };
            Command::Resupply { owner: PLAYER, fleet, food: 30, water: 30 }.apply(w).ok();
            Command::SetSail { owner: PLAYER, fleet, dest }.apply(w).expect("出港");
        }
        w.end_day().expect("日结");
        each(w);
    }
}

/// 奇遇出现那一天（记在它身上的日子）舰队所在海区的天气；在港或不在任何海区时为 None。
fn weather_then(w: &World, day: u32) -> Option<weather::DayWeather> {
    let f = w.fleet(w.flagship(PLAYER)?).ok()?;
    if f.docked_at().is_some() {
        return None;
    }
    w.weather_on(w.defs.map.region_of(f.cell(&w.defs))?, day)
}

#[test]
fn season_picks_the_encounter_of_the_day() {
    let names = ["spring", "summer", "autumn", "winter"];
    let table = names.iter().enumerate().map(|(i, n)| encounter(n, Place::Port, vec![Cond::Season(vec![i as u8])]));
    let mut w = world(table.collect(), 3);
    let mut seen = BTreeSet::new();
    for _ in 0..w.defs.calendar.year_days() + 5 {
        w.end_day().unwrap();
        let (key, day) = met(&w).expect("停在港口，每天都遇到当季的那一条");
        assert_eq!(key, names[w.defs.calendar.season_of(day).index()], "第 {day} 天");
        seen.insert(key);
    }
    assert_eq!(seen.len(), 4, "四季都轮到了");
    // 几个季节写在一起是“其中之一”；空列表永远不成立。
    let mut w = world(
        vec![
            encounter("warm", Place::Port, vec![Cond::Season(vec![0, 1])]),
            encounter("never", Place::Port, vec![Cond::Season(Vec::new())]),
        ],
        3,
    );
    for _ in 0..w.defs.calendar.year_days() {
        w.end_day().unwrap();
        match met(&w) {
            Some((key, day)) => {
                assert_eq!(key, "warm");
                assert!(w.defs.calendar.season_of(day).index() <= 1);
            }
            None => assert!(w.defs.calendar.season_of(w.day() - 1).index() >= 2),
        }
    }
}

#[test]
fn sky_and_wind_read_the_weather_where_the_fleet_sails() {
    let skies = Sky::ALL.map(|sky| encounter(sky.key(), Place::Sea, vec![Cond::Sky(vec![sky])]));
    let (mut matched, mut distinct) = (0, BTreeSet::new());
    for seed in 1..=12 {
        let mut w = world(skies.to_vec(), seed);
        shuttle(&mut w, 40, |w| match (met(w), weather_then(w, w.day() - 1)) {
            (Some((key, day)), Some(weather)) => {
                assert_eq!(day, w.day() - 1);
                assert_eq!(key, weather.sky.key(), "种子 {seed} 第 {day} 天");
                matched += 1;
                distinct.insert(weather.sky);
            }
            // 在港的日子（或那一格不属于任何海区）没有天况可言：一条也不出。
            (found, None) => assert!(found.is_none(), "种子 {seed}：在港却遇到了 {found:?}"),
            (None, Some(weather)) => panic!("种子 {seed}：海上是{}，却什么也没遇到", weather.sky.name()),
        });
    }
    assert!(matched >= 60 && distinct.len() >= 3, "对上 {matched} 天、{} 种天况", distinct.len());

    // 风力：两条把 0–10 分成两半，逐日对照当天的风。
    let winds = vec![
        encounter("light", Place::Sea, vec![Cond::Wind(0, 4)]),
        encounter("strong", Place::Sea, vec![Cond::Wind(5, 10)]),
    ];
    let mut seen = BTreeSet::new();
    for seed in 1..=12 {
        let mut w = world(winds.clone(), seed);
        shuttle(&mut w, 40, |w| {
            if let (Some((key, _)), Some(weather)) = (met(w), weather_then(w, w.day() - 1)) {
                assert_eq!(
                    key == "light",
                    weather.wind_strength() <= 4,
                    "种子 {seed}：风力 {}",
                    weather.wind_strength()
                );
                seen.insert(key);
            } else {
                assert!(met(w).is_none());
            }
        });
    }
    assert_eq!(seen.len(), 2, "轻风与大风都遇到过：{seen:?}");
    // 范围不含的风力、空的天况列表都不成立。
    let mut w = world(
        vec![
            encounter("off_scale", Place::Sea, vec![Cond::Wind(11, 12)]),
            encounter("no_sky", Place::Sea, vec![Cond::Sky(Vec::new())]),
        ],
        5,
    );
    shuttle(&mut w, 40, |w| assert!(met(w).is_none()));
}

#[test]
fn culture_reads_the_port_the_fleet_is_docked_at() {
    let table = vec![
        encounter("northern", Place::Port, vec![Cond::Culture(vec!["north".into()])]),
        encounter("southern", Place::Port, vec![Cond::Culture(vec!["elsewhere".into(), "south".into()])]),
    ];
    let mut w = world(table, 11);
    let fleet = w.flagship(PLAYER).unwrap();
    let mut seen = BTreeSet::new();
    // 先在北港停两天，再来回跑。
    for _ in 0..2 {
        w.end_day().unwrap();
        assert_eq!(met(&w).map(|m| m.0).as_deref(), Some("northern"));
    }
    shuttle(&mut w, 60, |w| {
        let docked = w.fleet(fleet).unwrap().docked_at();
        match (met(w), docked) {
            (Some((key, _)), Some(at)) => {
                assert_eq!(key, if at == ALPHA { "northern" } else { "southern" });
                seen.insert(key);
            }
            (found, None) => assert!(found.is_none(), "海上没有港口的文化圈可言：{found:?}"),
            (None, Some(_)) => panic!("靠了港却没有遇到当地的那一条"),
        }
    });
    assert_eq!(seen.len(), 2, "{seen:?}");
}
