//! 竞渡经过实际海图积分，操舵进入结算记录，既不发船也不改世界位置。
use manifest_core::{
    Cell, Command, OwnerId, ScenarioId, World,
    contests::{Kind, Moves, Params, occurrence_key, race},
    navigation::{Sail, SubCell},
    replay::{LogEntry, Source, StartParams, replay},
    upbringing::{AfterChoice, PlanSlot},
};
use std::collections::BTreeMap;
use std::sync::Arc;
fn defs() -> Arc<manifest_core::StaticData> {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    // 选择同一片海相邻的真实格，避免把陆地当赛道。
    let start = (1..d.map.height - 1)
        .flat_map(|y| (1..d.map.width - 1).map(move |x| [x, y]))
        .find(|p| [p[0] - 1, p[0], p[0] + 1].iter().all(|x| d.map.is_sea_in_bounds(Cell::new(*x, p[1]))))
        .unwrap();
    let ship = d.ships[0].key.clone();
    let c = &mut Arc::make_mut(&mut d).upbringing.contests[0];
    c.kind = Kind::Race;
    c.params = Params::Race(race::Params {
        legs: vec![race::Leg {
            text: "占位航段".into(),
            options: vec![
                race::OptionDef { key: "east".into(), text: "占位走法".into(), risk: 0 },
                race::OptionDef { key: "anchor".into(), text: "占位走法".into(), risk: 0 },
            ],
        }],
    });
    c.scoring.race = Some(race::Track {
        ship,
        start,
        option_points: BTreeMap::new(),
        failed_leg_points: 0,
        legs: vec![race::CourseLeg {
            minutes: 720,
            target: [start[0] + 1, start[1]],
            options: BTreeMap::from([
                ("east".into(), race::Helm { heading: 90, sail: Sail::Full }),
                ("anchor".into(), race::Helm { heading: 90, sail: Sail::Furled }),
            ]),
        }],
    });
    assert!(manifest_core::contests::validation::validate(&d).is_empty());
    d
}
#[test]
fn race_reuses_course_and_retains_replayable_steering_without_world_assets() {
    let d = defs();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let key = occurrence_key("test_match", [1553, 1, 5]);
    for seed in 0..8 {
        let mut w = World::new(d.clone(), sid, seed).unwrap();
        let c = &d.upbringing.contests[0];
        let Params::Race(p) = &c.params else { unreachable!() };
        let t = c.scoring.race.as_ref().unwrap();
        let stopped = p.run(t, &w, w.contest_seed(&key), &["anchor".into()]).unwrap();
        assert_eq!(stopped.finish, SubCell::center(Cell::new(t.start[0], t.start[1])));
        assert_eq!(stopped.score, 0);
        let expected = p.run(t, &w, w.contest_seed(&key), &["east".into()]).unwrap();
        let initial = w.state.clone();
        for moves in [Moves::Keys(vec![]), Moves::Keys(vec!["unknown".into()]), Moves::Choices(vec![0])] {
            assert!(
                Command::PlayContest { owner: OwnerId::Player, contest: key.clone(), moves }.apply(&mut w).is_err()
            );
            assert_eq!(w.state, initial);
        }
        let play = Command::PlayContest {
            owner: OwnerId::Player,
            contest: key.clone(),
            moves: Moves::Keys(vec!["east".into()]),
        };
        play.apply(&mut w).unwrap();
        let r = &w.state.upbringing.as_ref().unwrap().contest_results[&key];
        assert_eq!(r.game_score, Some(expected.score));
        assert_eq!(r.steers, expected.steers);
        assert_eq!(r.steers[0].heading, Some(90));
        assert_eq!(w.state.fleets, initial.fleets);
        let once = w.state.clone();
        assert!(play.apply(&mut w).is_err());
        assert_eq!(w.state, once);
        assert_eq!(World::from_snapshot(d.clone(), once).unwrap().state, w.state);
        let plan = Command::PlanMonth {
            owner: OwnerId::Player,
            slots: (0..3)
                .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
                .collect(),
        };
        let logs = vec![
            LogEntry { tick: w.day(), seq: 0, source: Source::Player, command: play, minute: None },
            LogEntry { tick: w.day(), seq: 1, source: Source::Player, command: plan.clone(), minute: None },
        ];
        plan.apply(&mut w).unwrap();
        w.end_day().unwrap();
        assert_eq!(replay(d.clone(), StartParams::new(sid, seed), &logs, w.day()).unwrap().state, w.state);
    }
}
#[test]
fn race_rejects_invalid_course_and_steering_records() {
    let mut d = defs();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let mut w = World::new(d.clone(), sid, 42).unwrap();
    let key = occurrence_key("test_match", [1553, 1, 5]);
    Command::PlayContest { owner: OwnerId::Player, contest: key.clone(), moves: Moves::Keys(vec!["east".into()]) }
        .apply(&mut w)
        .unwrap();
    w.state.upbringing.as_mut().unwrap().contest_results.get_mut(&key).unwrap().steers[0].minute = 1440;
    assert!(World::from_snapshot(d.clone(), w.state).is_err());
    let t = Arc::make_mut(&mut d).upbringing.contests[0].scoring.race.as_mut().unwrap();
    t.legs[0].options.get_mut("east").unwrap().heading = 360;
    assert!(!manifest_core::contests::validation::validate(&d).is_empty());
}
