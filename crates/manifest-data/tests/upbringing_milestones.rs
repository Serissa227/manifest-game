//! 考试补习、志向与结业资产走同一真实命令/逐日/重放路径。
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    replay::{LogEntry, Source, StartParams, replay},
    upbringing::{AfterChoice, Phase, PlanSlot},
};
use std::sync::Arc;
fn defs() -> Arc<manifest_core::StaticData> {
    manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap()
}
fn world(d: Arc<manifest_core::StaticData>, seed: u64) -> World {
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    World::new(d, sid, seed).unwrap()
}
fn apply(w: &mut World, c: Command, logs: &mut Vec<LogEntry>) {
    logs.push(LogEntry {
        tick: w.day(),
        seq: logs.len() as u64,
        source: Source::Player,
        command: c.clone(),
        minute: None,
    });
    c.apply(w).unwrap();
}
fn plan(w: &mut World, logs: &mut Vec<LogEntry>) {
    let slots =
        (0..3).map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) }).collect();
    apply(w, Command::PlanMonth { owner: OwnerId::Player, slots }, logs);
}
fn day(w: &mut World, logs: &mut Vec<LogEntry>) {
    while w.pending_story2().is_some() {
        apply(w, Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }, logs);
    }
    w.end_day().unwrap();
}
#[test]
fn exams_require_remediation_and_cooldown_and_never_repeat_awards() {
    let d = defs();
    let exam = "test_exam_navigation";
    let take = Command::TakeExam { owner: OwnerId::Player, exam: exam.into() };
    let seed = (0..128)
        .find(|seed| {
            let mut w = world(d.clone(), *seed);
            take.apply(&mut w).unwrap();
            !w.state.upbringing.unwrap().exams[exam].passed
        })
        .expect("实际检定的失败样例");
    let mut w = world(d.clone(), seed);
    let mut logs = vec![];
    let before = w.state.clone();
    assert!(Command::TakeExam { owner: OwnerId::Player, exam: "test_exam_academy".into() }.apply(&mut w).is_err());
    assert_eq!(w.state, before);
    apply(&mut w, take.clone(), &mut logs);
    assert!(!w.state.upbringing.as_ref().unwrap().exams[exam].passed);
    let failed = w.state.clone();
    assert!(take.apply(&mut w).is_err());
    assert_eq!(w.state, failed);
    plan(&mut w, &mut logs);
    for _ in 0..9 {
        day(&mut w, &mut logs);
    }
    assert!(take.apply(&mut w).is_err(), "仅过冷却而没有已结算补习不能补考");
    day(&mut w, &mut logs);
    let cash = w.state.agents[&OwnerId::Player].cash;
    apply(&mut w, take.clone(), &mut logs);
    assert_eq!(w.state.agents[&OwnerId::Player].cash, cash - 5);
    assert_eq!(w.state.upbringing.as_ref().unwrap().exams[exam].attempts, 2);
    same_saved_state(&World::from_snapshot(d.clone(), w.state.clone()).unwrap(), &w);
    day(&mut w, &mut logs);
    let sid = w.state.scenario;
    assert_eq!(replay(d.clone(), StartParams::new(sid, seed), &logs, w.day()).unwrap().state, w.state);
    let mut passed = (0..128)
        .find_map(|seed| {
            let mut w = world(d.clone(), seed);
            take.apply(&mut w).unwrap();
            w.state.upbringing.as_ref().unwrap().exams[exam].passed.then_some(w)
        })
        .unwrap();
    let once = passed.state.clone();
    assert!(take.apply(&mut passed).is_err());
    assert_eq!(passed.state, once);
    assert!(passed.state.cast.flags.contains("test_exam_passed"));
}
#[test]
fn path_age_hidden_gate_and_graduation_are_atomic_balanced_and_replayable() {
    let mut d = defs();
    let mut young = world(d.clone(), 42);
    let choose = Command::ChoosePath { owner: OwnerId::Player, path: "test_path_navigation".into() };
    let before = young.state.clone();
    assert!(choose.apply(&mut young).is_err());
    assert_eq!(young.state, before);
    {
        let f = &mut Arc::make_mut(&mut d).upbringing.families[0];
        f.born = [1538, 6, 1];
        f.graduation = [1553, 1, 12];
        f.stages.truncate(1);
    }
    for seed in 0..4 {
        let mut w = world(d.clone(), seed);
        let mut logs = vec![];
        assert!(Command::ChoosePath { owner: OwnerId::Player, path: "test_path_hidden".into() }.apply(&mut w).is_err());
        apply(&mut w, choose.clone(), &mut logs);
        plan(&mut w, &mut logs);
        let initial_fleets = w.state.fleets.len();
        for _ in 0..11 {
            day(&mut w, &mut logs);
        }
        assert_eq!(w.state.upbringing.as_ref().unwrap().phase, Phase::Done);
        let g = w.state.upbringing.as_ref().unwrap().graduation.as_ref().unwrap();
        assert_eq!(g.path.as_deref(), Some("test_path_navigation"));
        assert_eq!(g.ending.as_deref(), Some("test_ending_navigation"));
        assert_eq!(g.cash, 300);
        assert_eq!(w.state.fleets.len(), initial_fleets + 1);
        assert_eq!(w.item_quantity(OwnerId::Player, "ribbon"), 1);
        assert!(w.state.cast.flags.contains("test_path_kept"));
        assert!(w.state.cast.flags.contains("test_ending_kept"));
        assert!(w.money_conserved());
        assert!(w.state.agents.values().all(|a| a.ledger.is_balanced()));
        let attrs = &w.state.agents[&OwnerId::Player].captain.as_ref().unwrap().attrs;
        assert_eq!(attrs.len(), d.captain.attributes.len());
        for (i, a) in d.captain.attributes.iter().enumerate() {
            assert_eq!(attrs[i], w.upbringing_projected(&a.key));
        }
        same_saved_state(&World::from_snapshot(d.clone(), w.state.clone()).unwrap(), &w);
        let once = w.state.upbringing.as_ref().unwrap().graduation.clone();
        day(&mut w, &mut logs);
        assert_eq!(w.state.upbringing.as_ref().unwrap().graduation, once);
        assert_eq!(w.state.fleets.len(), initial_fleets + 1);
        assert_eq!(replay(d.clone(), StartParams::new(w.state.scenario, seed), &logs, w.day()).unwrap().state, w.state);
    }
}
#[test]
fn milestone_references_and_snapshot_invariants_reject_invalid_inputs() {
    let d = defs();
    for field in ["rating", "remediation", "promise_at"] {
        let mut invalid = d.clone();
        let v = Arc::make_mut(&mut invalid);
        match field {
            "rating" => {
                v.upbringing.exams[0].requirements.rating =
                    Some(manifest_core::upbringing::RatingRequirement::Key("absent".into()))
            }
            "remediation" => v.upbringing.exams[0].retake.remediation.push("absent".into()),
            _ => v.upbringing.families[0].completion.as_mut().unwrap().promise_at = Some("absent".into()),
        };
        assert!(!manifest_core::upbringing::validation::validate(&invalid).is_empty());
    }
    let mut w = world(d.clone(), 42);
    Command::TakeExam { owner: OwnerId::Player, exam: "test_exam_navigation".into() }.apply(&mut w).unwrap();
    let future = w.day() + 1;
    w.state.upbringing.as_mut().unwrap().exams.get_mut("test_exam_navigation").unwrap().last_day = Some(future);
    assert!(World::from_snapshot(d, w.state).is_err());
}

#[test]
fn graduation_projects_cargo_and_consensual_a_rank_friends_without_inventing_money() {
    let mut d = defs();
    {
        let data = Arc::make_mut(&mut d);
        let good = data.goods[0].key.clone();
        let region = data.regions[0].key.clone();
        let f = &mut data.upbringing.families[0];
        f.graduation = [1553, 1, 2];
        f.stages.truncate(1);
        let c = f.completion.as_mut().unwrap();
        c.capital.cargo.insert(good, 2);
        c.capital.regions.push(region);
        c.friends.push(manifest_core::upbringing::JoiningFriend {
            person: "sailor".into(),
            when: manifest_core::upbringing::Requirements {
                flag: Some("test_friend_consents".into()),
                ..Default::default()
            },
        });
    }
    for consent in [false, true] {
        let mut w = world(d.clone(), 42);
        w.change_affinity("sailor", 80).unwrap();
        for _ in 0..3 {
            w.remember_experience("sailor").unwrap();
        }
        if consent {
            w.state.cast.flags.insert("test_friend_consents".into());
        }
        let before = w.state.money.clone();
        let old = w.state.agents[&OwnerId::Player].cash;
        let mut logs = vec![];
        plan(&mut w, &mut logs);
        day(&mut w, &mut logs);
        let g = w.state.upbringing.as_ref().unwrap().graduation.as_ref().unwrap();
        let fleet = &w.state.fleets[&g.fleet.unwrap()];
        assert_eq!(fleet.cargo.values().sum::<i64>(), 2);
        assert_eq!(g.friends.contains(&"sailor".into()), consent);
        assert_eq!(w.state.agents[&OwnerId::Player].cash, old + 100);
        assert!(w.money_conserved());
        assert!(w.state.agents.values().all(|a| a.ledger.is_balanced()));
        assert_ne!(w.state.money, before);
        assert_eq!(w.state.money.sources.get(&manifest_core::treasury::Flow::UpbringingCapital), Some(&100));
        same_saved_state(&World::from_snapshot(d.clone(), w.state.clone()).unwrap(), &w);
    }
}

// 逐字节核对全部存档字段；B7 的迷雾增量缓存明确不属于存档。
fn same_saved_state(a: &World, b: &World) {
    assert_eq!(serde_json::to_vec(&a.state).unwrap(), serde_json::to_vec(&b.state).unwrap());
    assert_eq!(a.state_hash(), b.state_hash());
}
