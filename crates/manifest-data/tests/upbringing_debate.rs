//! 辩论真实命令：一次用牌、名次、自动结算、读档和重放。
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    contests::{Kind, Moves, Params, debate, occurrence_key},
    replay::{LogEntry, Source, StartParams, replay},
    upbringing::{AfterChoice, PlanSlot},
};
use std::sync::Arc;

fn defs() -> Arc<manifest_core::StaticData> {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let c = &mut Arc::make_mut(&mut d).upbringing.contests[0];
    c.kind = Kind::Debate;
    c.params = Params::Debate(debate::Params {
        topic: "占位题目".into(),
        rounds: vec![debate::Round { opponent: debate::Argument { text: "占位论点".into(), kind: "a".into() } }; 2],
        hand: ["first", "second"]
            .iter()
            .map(|key| debate::Card { key: (*key).into(), text: "占位论点".into(), kind: "b".into() })
            .collect(),
        beats: vec![["b".into(), "a".into()]],
    });
    assert!(manifest_core::contests::validation::validate(&d).is_empty());
    d
}

#[test]
fn debate_replay_snapshot_atomic_rejection_and_automatic_resolution() {
    let d = defs();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let key = occurrence_key("test_match", [1553, 1, 5]);
    let plan = Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
            .collect(),
    };
    for seed in 0..16 {
        let mut w = World::new(d.clone(), sid, seed).unwrap();
        let initial = w.state.clone();
        for moves in [
            Moves::Keys(vec![]),
            Moves::Keys(vec!["first".into(); 2]),
            Moves::Keys(vec!["first".into(), "absent".into()]),
            Moves::Choices(vec![0, 1]),
        ] {
            assert!(
                Command::PlayContest { owner: OwnerId::Player, contest: key.clone(), moves }.apply(&mut w).is_err()
            );
            assert_eq!(w.state, initial);
        }
        let play: Command = serde_json::from_value(
            serde_json::json!({"PlayContest":{"owner":"player","contest":key,"moves":["first","second"]}}),
        )
        .unwrap();
        let logs = vec![
            LogEntry { tick: w.day(), seq: 0, source: Source::Player, command: play.clone(), minute: None },
            LogEntry { tick: w.day(), seq: 1, source: Source::Player, command: plan.clone(), minute: None },
        ];
        play.apply(&mut w).unwrap();
        assert_eq!(w.state.upbringing.as_ref().unwrap().contest_results[&key].game_score, Some(100));
        let once = w.state.clone();
        assert!(play.apply(&mut w).is_err());
        assert_eq!(w.state, once);
        assert_eq!(World::from_snapshot(d.clone(), once).unwrap().state, w.state);
        plan.apply(&mut w).unwrap();
        w.end_day().unwrap();
        assert_eq!(replay(d.clone(), StartParams::new(sid, seed), &logs, w.day()).unwrap().state, w.state);
    }
    let mut w = World::new(d, sid, 42).unwrap();
    plan.apply(&mut w).unwrap();
    for _ in 0..5 {
        w.end_day().unwrap();
    }
    assert!(w.state.upbringing.as_ref().unwrap().contest_results[&key].game_score.is_none());
}

#[test]
fn debate_definition_rejects_unknown_fields_and_conflicting_counters() {
    let mut d = defs();
    let Params::Debate(p) = &mut Arc::make_mut(&mut d).upbringing.contests[0].params else { unreachable!() };
    p.beats.push(["a".into(), "b".into()]);
    assert!(!manifest_core::contests::validation::validate(&d).is_empty());
    let mut json = serde_json::to_value(&d.upbringing.contests[0].params).unwrap();
    json["correct"] = serde_json::json!(["first", "second"]);
    assert!(serde_json::from_value::<Params>(json).is_err());
}
