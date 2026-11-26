//! 辨识私有答案、整数计分和真实命令重放。
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    contests::{Kind, Moves, Params, occurrence_key},
    replay::{LogEntry, Source, StartParams, replay},
    upbringing::{AfterChoice, PlanSlot},
};
use serde_json::json;
use std::{collections::BTreeMap, sync::Arc};
fn defs() -> Arc<manifest_core::StaticData> {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let c = &mut Arc::make_mut(&mut d).upbringing.contests[0];
    c.kind = Kind::Identify;
    c.params=serde_json::from_value(json!({"samples":[{"key":"one","clues":["占位线索"]},{"key":"two","clues":["占位线索"]},{"key":"three","clues":["占位线索"]}],"answers":[{"key":"a","name":"占位名称"},{"key":"b","name":"占位名称"}]})).unwrap();
    c.scoring.answers =
        BTreeMap::from([("one".into(), "a".into()), ("two".into(), "b".into()), ("three".into(), "a".into())]);
    assert!(manifest_core::contests::validation::validate(&d).is_empty());
    d
}
#[test]
fn identify_partial_score_repeated_answers_replay_and_atomic_errors() {
    let d = defs();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let key = occurrence_key("test_match", [1553, 1, 5]);
    for seed in 0..16 {
        let mut w = World::new(d.clone(), sid, seed).unwrap();
        let before = w.state.clone();
        for moves in [Moves::Keys(vec![]), Moves::Choices(vec![0, 1, 0]), Moves::Keys(vec!["missing".into(); 3])] {
            assert!(
                Command::PlayContest { owner: OwnerId::Player, contest: key.clone(), moves }.apply(&mut w).is_err()
            );
            assert_eq!(before, w.state);
        }
        let play: Command =
            serde_json::from_value(json!({"PlayContest":{"owner":"player","contest":key,"moves":["a","b","b"]}}))
                .unwrap();
        let plan = Command::PlanMonth {
            owner: OwnerId::Player,
            slots: (0..3)
                .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
                .collect(),
        };
        let logs = vec![
            LogEntry { tick: w.day(), seq: 0, source: Source::Player, command: play.clone(), minute: None },
            LogEntry { tick: w.day(), seq: 1, source: Source::Player, command: plan.clone(), minute: None },
        ];
        play.apply(&mut w).unwrap();
        assert_eq!(w.state.upbringing.as_ref().unwrap().contest_results[&key].game_score, Some(66));
        let once = w.state.clone();
        assert!(play.apply(&mut w).is_err());
        assert_eq!(w.state, once);
        assert_eq!(World::from_snapshot(d.clone(), once).unwrap().state, w.state);
        plan.apply(&mut w).unwrap();
        w.end_day().unwrap();
        assert_eq!(replay(d.clone(), StartParams::new(sid, seed), &logs, w.day()).unwrap().state, w.state);
    }
    let c = &d.upbringing.contests[0];
    let Params::Identify(p) = &c.params else { unreachable!() };
    assert_eq!(p.score(&c.scoring.answers, &["a".into(), "b".into(), "a".into()]).unwrap(), 100);
}
#[test]
fn identify_requires_complete_closed_private_answer_table() {
    let mut d = defs();
    Arc::make_mut(&mut d).upbringing.contests[0].scoring.answers.insert("one".into(), "unknown".into());
    assert!(!manifest_core::contests::validation::validate(&d).is_empty());
    let mut v = serde_json::to_value(&d.upbringing.contests[0].params).unwrap();
    v["secret"] = json!(["a"]);
    assert!(serde_json::from_value::<Params>(v).is_err());
}
