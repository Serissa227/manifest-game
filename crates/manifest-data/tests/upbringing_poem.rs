//! 作诗按句提交选项，下标、私有词分和重复领奖都由内核校验。
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    contests::{Moves, Params, occurrence_key},
    replay::{LogEntry, Source, StartParams, replay},
    upbringing::{AfterChoice, PlanSlot},
};
#[test]
fn poem_command_scoring_rejection_snapshot_and_replay_match() {
    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let i = d.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
    let sid = ScenarioId::from_idx(i);
    let key = occurrence_key("test_poem", [1553, 1, 8]);
    for seed in 0..16 {
        let mut w = World::new(d.clone(), sid, seed).unwrap();
        let initial = w.state.clone();
        for moves in [
            Moves::Choices(vec![]),
            Moves::Choices(vec![1]),
            Moves::Choices(vec![2, 0]),
            Moves::Choices(vec![0, 1, 0]),
            Moves::Pairs(vec![[0, 1]]),
        ] {
            assert!(
                Command::PlayContest { owner: OwnerId::Player, contest: key.clone(), moves }.apply(&mut w).is_err()
            );
            assert_eq!(w.state, initial);
        }
        let play =
            Command::PlayContest { owner: OwnerId::Player, contest: key.clone(), moves: Moves::Choices(vec![1, 1]) };
        play.apply(&mut w).unwrap();
        assert_eq!(w.state.upbringing.as_ref().unwrap().contest_results[&key].game_score, Some(100));
        let before = w.state.clone();
        assert!(play.apply(&mut w).is_err());
        assert_eq!(w.state, before);
        assert_eq!(World::from_snapshot(d.clone(), w.state.clone()).unwrap().state, w.state);
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
    let mut bad = (*d).clone();
    let c = bad.upbringing.contests.iter_mut().find(|c| c.key == "test_poem").unwrap();
    c.scoring.line_points[0].pop();
    assert!(!manifest_core::contests::validation::validate(&bad).is_empty());
    let mut bad = (*d).clone();
    let c = bad.upbringing.contests.iter_mut().find(|c| c.key == "test_poem").unwrap();
    c.params = Params::Match(manifest_core::contests::matching::Params {
        cols: 2,
        rows: 1,
        faces: vec!["a".into(); 2],
        flips: 1,
    });
    assert!(!manifest_core::contests::validation::validate(&bad).is_empty());
}
#[test]
fn unplayed_poem_is_automatically_ranked_on_its_date() {
    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let i = d.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
    let mut w = World::new(d, ScenarioId::from_idx(i), 42).unwrap();
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
            .collect(),
    }
    .apply(&mut w)
    .unwrap();
    for _ in 0..8 {
        w.end_day().unwrap();
    }
    let result = &w.state.upbringing.as_ref().unwrap().contest_results[&occurrence_key("test_poem", [1553, 1, 8])];
    assert!(result.game_score.is_none());
    assert!((1..=3).contains(&result.rank));
}

#[test]
fn poem_translation_cannot_add_scoring_or_omit_a_choice() {
    fn copy(from: &std::path::Path, to: &std::path::Path) {
        std::fs::create_dir_all(to).unwrap();
        for entry in std::fs::read_dir(from).unwrap() {
            let entry = entry.unwrap();
            let dest = to.join(entry.file_name());
            if entry.path().is_dir() {
                copy(&entry.path(), &dest);
            } else {
                std::fs::copy(entry.path(), dest).unwrap();
            }
        }
    }
    let tmp = tempfile::tempdir().unwrap();
    copy(&manifest_data::find_data_dir().unwrap(), tmp.path());
    let d = manifest_data::load_world(tmp.path(), "testbed").unwrap();
    let path = tmp.path().join("worlds/testbed/locales/en/upbringing/poem.toml");
    let original = std::fs::read_to_string(&path).unwrap();
    let load = || {
        let world = manifest_data::resolve_world(tmp.path(), "testbed").unwrap();
        let ai = manifest_data::ai_content::load_world_ai_content(&world).unwrap();
        manifest_data::locale::load_world_locale_lenient(&world, manifest_data::Locale::En, &d, &ai)
    };
    let (en, issues) = load();
    assert!(issues.iter().all(|i| !i.file.contains("upbringing")));
    assert!(en.missing.iter().all(|i| !i.file.contains("upbringing")));
    std::fs::write(&path, format!("{original}\n[scoring]\nline_points=[[100,0],[100,0]]\n")).unwrap();
    let (_, issues) = load();
    assert!(issues.iter().any(|i| i.file.contains("upbringing")));
    let mut missing: toml::Value = toml::from_str(&original).unwrap();
    missing["poem_texts"].as_table_mut().unwrap().remove("test_poem:line:1:option:1");
    std::fs::write(path, toml::to_string(&missing).unwrap()).unwrap();
    let (en, issues) = load();
    assert!(
        en.missing.iter().any(|i| i.file.contains("upbringing"))
            || issues.iter().any(|i| i.file.contains("upbringing"))
    );
}
