//! 节奏输入只含整数毫秒；真实命令和自动结算共用比赛实例与领奖门禁。
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    contests::{Kind, Moves, Params, occurrence_key, rhythm},
    replay::{LogEntry, Source, StartParams, replay},
    upbringing::{AfterChoice, PlanSlot},
};
use std::sync::Arc;
fn defs() -> Arc<manifest_core::StaticData> {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let c = Arc::make_mut(&mut d).upbringing.contests.iter_mut().find(|c| c.key == "test_match").unwrap();
    c.kind = Kind::Rhythm;
    c.params = Params::Rhythm(rhythm::Params { bpm: 120, beats: vec![1000, 1500, 2000], window: 100 });
    assert!(manifest_core::contests::validation::validate(&d).is_empty());
    d
}
#[test]
fn rhythm_inputs_replay_exactly_without_wall_clock_and_reject_repeated_prizes() {
    let d = defs();
    let i = d.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
    let sid = ScenarioId::from_idx(i);
    let key = occurrence_key("test_match", [1553, 1, 5]);
    for seed in 0..16 {
        let mut w = World::new(d.clone(), sid, seed).unwrap();
        let before = w.state.clone();
        for input in ["[[0,1]]", "[-1]", "[1.5]", "[1500,1000]", "[4294967296]"] {
            let raw = format!("{{\"PlayContest\":{{\"owner\":\"player\",\"contest\":\"{key}\",\"moves\":{input}}}}}");
            if let Ok(command) = serde_json::from_str::<Command>(&raw) {
                assert!(command.apply(&mut w).is_err(), "{input}");
            }
            assert_eq!(w.state, before);
        }
        for (taps, expected) in
            [(vec![1000, 1000], 33), (vec![2101], 0), (vec![900, 1600, 2000, 3200], 75), (vec![u32::MAX], 0)]
        {
            let mut trial = World::new(d.clone(), sid, seed).unwrap();
            Command::PlayContest { owner: OwnerId::Player, contest: key.clone(), moves: Moves::Choices(taps) }
                .apply(&mut trial)
                .unwrap();
            assert_eq!(trial.state.upbringing.as_ref().unwrap().contest_results[&key].game_score, Some(expected));
        }
        let play = Command::PlayContest {
            owner: OwnerId::Player,
            contest: key.clone(),
            moves: Moves::Choices(vec![900, 1600, 2000]),
        };
        play.apply(&mut w).unwrap();
        assert_eq!(w.state.upbringing.as_ref().unwrap().contest_results[&key].game_score, Some(100));
        assert_eq!(World::from_snapshot(d.clone(), w.state.clone()).unwrap().state, w.state);
        let before = w.state.clone();
        assert!(play.apply(&mut w).is_err());
        assert_eq!(w.state, before);
        let plan = Command::PlanMonth {
            owner: OwnerId::Player,
            slots: (0..3)
                .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
                .collect(),
        };
        let logs = vec![
            LogEntry { minute: None, tick: w.day(), seq: 0, source: Source::Player, command: play },
            LogEntry { minute: None, tick: w.day(), seq: 1, source: Source::Player, command: plan.clone() },
        ];
        plan.apply(&mut w).unwrap();
        w.end_day().unwrap();
        assert_eq!(replay(d.clone(), StartParams::new(sid, seed), &logs, w.day()).unwrap().state, w.state);
    }
}
#[test]
fn empty_rhythm_input_scores_zero_and_unplayed_rhythm_is_automatic() {
    let d = defs();
    let i = d.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
    let mut w = World::new(d.clone(), ScenarioId::from_idx(i), 42).unwrap();
    let key = occurrence_key("test_match", [1553, 1, 5]);
    let raw = serde_json::json!({"PlayContest":{"owner":"player","contest":key,"moves":[]}});
    let command: Command = serde_json::from_value(raw).unwrap();
    command.apply(&mut w).unwrap();
    assert_eq!(w.state.upbringing.as_ref().unwrap().contest_results[&key].game_score, Some(0));
    let mut w = World::new(d, ScenarioId::from_idx(i), 42).unwrap();
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
            .collect(),
    }
    .apply(&mut w)
    .unwrap();
    for _ in 0..5 {
        w.end_day().unwrap();
    }
    assert!(w.state.upbringing.as_ref().unwrap().contest_results[&key].game_score.is_none());
}
