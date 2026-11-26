//! 比赛沿实际加载、命令、存档及日志重放路径；不接受客户端直接报分。
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    contests::{Moves, Params, occurrence_key},
    replay::{LogEntry, Source, StartParams, replay},
    upbringing::{AfterChoice, PlanSlot},
};
use std::{collections::BTreeMap, sync::Arc};
fn defs() -> Arc<manifest_core::StaticData> {
    manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap()
}
fn world(d: Arc<manifest_core::StaticData>, seed: u64) -> World {
    let i = d.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
    World::new(d, ScenarioId::from_idx(i), seed).unwrap()
}
fn pairs(w: &World, key: &str) -> Moves {
    let p = match w.contest_params(key).unwrap() {
        Params::Match(p) => p,
        _ => panic!("配对夹具必须仍是配对参数"),
    };
    let mut by_face: BTreeMap<String, Vec<u32>> = BTreeMap::new();
    for (i, face) in p.faces.into_iter().enumerate() {
        by_face.entry(face).or_default().push(i as u32);
    }
    Moves::Pairs(by_face.into_values().map(|v| [v[0], v[1]]).collect())
}
fn plan() -> Command {
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
            .collect(),
    }
}
#[test]
fn matching_rewards_are_atomic_once_and_seeded_moves_replay_through_the_command_log() {
    let mut d = defs();
    let c = &mut Arc::make_mut(&mut d).upbringing.contests[0];
    c.check.base = 95;
    c.check.coef = 0;
    c.scoring.max_bonus = 30;
    let key = occurrence_key("test_match", [1553, 1, 5]);
    for seed in 0..16 {
        let mut w = world(d.clone(), seed);
        let initial = w.state.clone();
        let total = w.all_money();
        for moves in [Moves::Pairs(vec![[0, 0]]), Moves::Pairs(vec![[0, 99]]), Moves::Choices(vec![0, 1])] {
            assert!(
                Command::PlayContest { owner: OwnerId::Player, contest: key.clone(), moves }.apply(&mut w).is_err()
            );
            assert_eq!(w.state, initial);
        }
        let command = Command::PlayContest { owner: OwnerId::Player, contest: key.clone(), moves: pairs(&w, &key) };
        let command: Command = serde_json::from_str(&serde_json::to_string(&command).unwrap()).unwrap();
        command.apply(&mut w).unwrap();
        let result = &w.state.upbringing.as_ref().unwrap().contest_results[&key];
        assert_eq!((result.rank, result.total, result.game_score), (1, 3, Some(100)));
        assert_eq!(w.upbringing_growth("wit"), 5);
        assert_eq!(w.item_quantity(OwnerId::Player, "ribbon"), 1);
        assert_eq!(w.state.upbringing.as_ref().unwrap().contest_wins["classmate_a"], 1);
        assert_eq!(w.state.upbringing.as_ref().unwrap().contest_wins["classmate_b"], 1);
        let before = w.state.clone();
        assert!(command.apply(&mut w).is_err());
        assert_eq!(w.state, before);
        let loaded = World::from_snapshot(d.clone(), w.state.clone()).unwrap();
        assert_eq!(loaded.state, w.state);
        let plan = plan();
        let log = vec![
            LogEntry { minute: None, tick: w.day(), seq: 0, source: Source::Player, command: command.clone() },
            LogEntry { minute: None, tick: w.day(), seq: 1, source: Source::Player, command: plan.clone() },
        ];
        plan.apply(&mut w).unwrap();
        w.end_day().unwrap();
        let replayed = replay(d.clone(), StartParams::new(w.state.scenario, seed), &log, w.day()).unwrap();
        assert_eq!(replayed.state, w.state);
        assert_eq!(w.all_money(), total);
    }
}
#[test]
fn unplayed_contests_settle_on_the_due_day_once_and_survive_content_removal() {
    let d = defs();
    let mut w = world(d.clone(), 42);
    let key = occurrence_key("test_match", [1553, 1, 5]);
    plan().apply(&mut w).unwrap();
    for _ in 0..4 {
        w.end_day().unwrap();
    }
    assert_eq!(w.cast_date(), [1553, 1, 5]);
    assert!(!w.state.upbringing.as_ref().unwrap().contest_results.contains_key(&key));
    let mut loaded = World::from_snapshot(d.clone(), w.state.clone()).unwrap();
    w.end_day().unwrap();
    loaded.end_day().unwrap();
    assert_eq!(loaded.state, w.state);
    let result = w.state.upbringing.as_ref().unwrap().contest_results[&key].clone();
    assert!(result.game_score.is_none());
    assert!((1..=3).contains(&result.rank));
    let before = w.state.clone();
    assert!(
        Command::PlayContest { owner: OwnerId::Player, contest: key.clone(), moves: Moves::Pairs(vec![]) }
            .apply(&mut w)
            .is_err()
    );
    assert_eq!(w.state, before);
    let mut changed = (*d).clone();
    changed.upbringing.contests.clear();
    let loaded = World::from_snapshot(Arc::new(changed), w.state.clone()).unwrap();
    assert_eq!(loaded.state.upbringing.as_ref().unwrap().contest_results[&key], result);
    let mut bad = w.state.clone();
    bad.upbringing.as_mut().unwrap().contest_results.get_mut(&key).unwrap().rank = 0;
    assert!(World::from_snapshot(d, bad).is_err());
}
#[test]
fn contest_definitions_close_every_reference_and_reject_invalid_board_or_reward() {
    let d = defs();
    assert!(manifest_core::contests::validation::validate(&d).is_empty());
    for i in 0..12 {
        let mut broken = (*d).clone();
        let c = &mut broken.upbringing.contests[0];
        match i {
            0 => c.at = "missing".into(),
            1 => c.check.attr = "missing".into(),
            2 => c.rivals.push("missing".into()),
            3 => c.prep.activities.push("missing".into()),
            4 => c.prep.items.push("missing".into()),
            5 => c.prep.companions.push("missing".into()),
            6 => c.rewards[0].items.insert("missing".into(), 1).map(|_| ()).unwrap_or(()),
            7 => c.rewards[0].growth.insert("missing".into(), 1).map(|_| ()).unwrap_or(()),
            8 => c.events.push("missing".into()),
            9 => c.dates[0] = [1553, 2, 31],
            10 => {
                let p = match &mut c.params {
                    Params::Match(p) => p,
                    _ => panic!("配对夹具必须仍是配对参数"),
                };
                p.faces[0] = "unpaired".into();
            }
            11 => c.rewards[0].rank = 9,
            _ => unreachable!(),
        }
        assert!(!manifest_core::contests::validation::validate(&broken).is_empty(), "case {i}");
    }
}
