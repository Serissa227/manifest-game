//! U04：匹配度、同分决胜、差距解释及支线纪念。
use manifest_core::{Command, OwnerId, ScenarioId, World, upbringing::*};
use std::sync::Arc;

fn defs() -> Arc<manifest_core::StaticData> {
    manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap()
}
fn world(d: Arc<manifest_core::StaticData>) -> World {
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    World::new(d, sid, 17).unwrap()
}
#[test]
fn match_score_uses_ratings_path_affinity_flags_and_priority_only_breaks_ties() {
    let mut d = defs();
    let mut e = d.upbringing.endings[0].clone();
    e.family = None;
    e.requirements = Requirements::default();
    e.priority = 0;
    e.key = "matched".into();
    e.weights.ratings.insert("mariner".into(), 2);
    e.weights.aspirations.insert("test_path_navigation".into(), 400);
    e.weights.bonds.insert("sailor".into(), 3);
    e.weights.flags.insert("matching".into(), 150);
    let mut high = e.clone();
    high.key = "priority".into();
    high.weights = EndingWeights::default();
    high.priority = 999;
    Arc::make_mut(&mut d).upbringing.endings = vec![e.clone(), high];
    let mut w = world(d);
    w.state.upbringing.as_mut().unwrap().path = Some("test_path_navigation".into());
    w.state.story2.flags.insert("matching".into());
    w.change_affinity("sailor", 20).unwrap();
    assert_eq!(
        w.upbringing_ending_score(&e),
        w.upbringing_rating("mariner") * 2 + 400 + 150 + w.affection("sailor").unwrap().affinity * 3
    );
    assert_eq!(w.upbringing_best_ending().unwrap().key, "matched");
    Arc::make_mut(&mut w.defs).upbringing.endings[0].weights = EndingWeights::default();
    assert_eq!(w.upbringing_best_ending().unwrap().key, "priority");
    Arc::make_mut(&mut w.defs).upbringing.endings[0].priority = 999;
    assert_eq!(w.upbringing_best_ending().unwrap().key, "matched");
}
#[test]
fn gaps_explain_true_values_and_choose_the_closest_alternative() {
    let w = world(defs());
    let rating = w.upbringing_rating("mariner");
    let r = Requirements {
        all: vec![
            Requirements {
                rating: Some(RatingRequirement::Key("mariner".into())),
                min: Some(rating + 20),
                ..Default::default()
            },
            Requirements { flag: Some("missing".into()), ..Default::default() },
        ],
        any: vec![
            Requirements { skill: Some("lang_test".into()), level: 2, ..Default::default() },
            Requirements { completed_slots: Some(1), ..Default::default() },
        ],
        ..Default::default()
    };
    let gaps = w.upbringing_requirement_gaps(&r);
    assert_eq!(gaps.len(), 3);
    assert_eq!((gaps[0].key.as_str(), gaps[0].have, gaps[0].need), ("rating:mariner", rating, rating + 20));
    assert_eq!((gaps[1].have, gaps[1].need), (0, 1));
    assert!(!w.upbringing_requirements(&r));
    for e in &w.defs.upbringing.endings {
        assert_eq!(
            w.upbringing_requirements(&e.requirements),
            w.upbringing_requirement_gaps(&e.requirements).is_empty(),
            "{}",
            e.key
        );
    }
}
#[test]
fn graduation_preserves_main_award_and_adds_side_memories_once_with_frozen_near_misses() {
    let mut d = defs();
    let data = Arc::make_mut(&mut d);
    data.upbringing.families[0].graduation = [1553, 1, 2];
    data.upbringing.families[0].stages.truncate(1);
    let mut main = data.upbringing.endings[0].clone();
    main.key = "main".into();
    main.requirements = Requirements::default();
    main.family = None;
    main.weights.flags.insert("always".into(), 1);
    let mut side = main.clone();
    side.key = "side".into();
    side.supplementary = true;
    side.priority = 999;
    side.award = Award::default();
    side.award.titles = vec!["Side title".into()];
    side.award.skills.insert("lang_test".into(), 999);
    let mut missed = main.clone();
    missed.key = "near_one".into();
    missed.requirements.flag = Some("absent".into());
    let mut missed2 = missed.clone();
    missed2.key = "near_two".into();
    missed2.requirements.flag = Some("also_absent".into());
    data.upbringing.endings = vec![main, side, missed, missed2];
    let mut w = world(d.clone());
    let xp = w.upbringing_skill_xp("lang_test");
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) })
            .collect(),
    }
    .apply(&mut w)
    .unwrap();
    w.end_day().unwrap();
    let record = w.state.upbringing.as_ref().unwrap().graduation.as_ref().unwrap().clone();
    assert_eq!(record.ending.as_deref(), Some("main"));
    assert_eq!(record.supplementary, vec!["side"]);
    assert_eq!(record.near_miss.len(), 2);
    assert_eq!(record.near_miss[0].missing[0].key, "flag:absent");
    assert!(w.state.cast.titles.contains("Side title"));
    assert!(w.state.story2.memories.contains_key("side"));
    assert!(w.upbringing_skill_xp("lang_test") < xp + 999);
    assert_eq!(World::from_snapshot(d, w.state.clone()).unwrap().state, w.state);
    w.end_day().unwrap();
    assert_eq!(w.state.upbringing.as_ref().unwrap().graduation.as_ref(), Some(&record));
}
#[test]
fn terra_side_endings_cannot_replace_main_and_all_thresholds_have_correct_gaps() {
    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap();
    for f in &d.upbringing.families {
        let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == f.scenario).unwrap());
        let mut w = World::new(d.clone(), sid, 42).unwrap();
        for e in d.upbringing.endings.iter().filter(|e| e.family.as_deref() == Some(&f.key)) {
            let n = e.key.rsplit('_').next().unwrap().parse::<u8>().unwrap();
            assert_eq!(e.supplementary, (1..=8).contains(&n));
            if let Some(flag) = &e.requirements.flag {
                w.state.story2.flags.insert(flag.clone());
            }
        }
        assert!(!w.upbringing_best_ending().unwrap().supplementary);
        for e in &d.upbringing.endings {
            assert_eq!(
                w.upbringing_requirements(&e.requirements),
                w.upbringing_requirement_gaps(&e.requirements).is_empty(),
                "{}",
                e.key
            );
        }
    }
}

#[test]
fn ending_weights_reject_unknown_references_and_out_of_range_values() {
    let d = defs();
    assert!(manifest_core::upbringing::validation::validate(&d).is_empty());
    for case in 0..6 {
        let mut bad = (*d).clone();
        let ending = &mut bad.upbringing.endings[0];
        let key = ending.key.clone();
        match case {
            0 => {
                ending.weights.ratings.insert("absent_rating".into(), 1);
            }
            1 => {
                ending.weights.aspirations.insert("absent_path".into(), 1);
            }
            2 => {
                ending.weights.bonds.insert("absent_person".into(), 1);
            }
            3 => {
                ending.weights.ratings.insert("mariner".into(), -1);
            }
            4 => {
                ending.weights.ratings.insert("mariner".into(), 1001);
            }
            _ => {
                ending.weights.flags.insert("valid_flag".into(), 10001);
            }
        }
        let errors = manifest_core::upbringing::validation::validate(&bad);
        assert!(errors.iter().any(|error| error.contains(&key)), "case {case}: {errors:?}");
    }
}
