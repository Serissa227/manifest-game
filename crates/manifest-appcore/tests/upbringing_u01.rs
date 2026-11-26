//! U01：考试缺口可计算，查询不得改变世界。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{ScenarioId, World, upbringing::*};
use serde_json::Value;
use std::sync::Arc;

fn world() -> World {
    let d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    World::new(d, sid, 42).unwrap()
}

fn exam(w: &World) -> Value {
    upbringing_view::upbringing(Ctx::plain(&w.defs), w)["exams"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["key"] == "test_exam_navigation")
        .unwrap()
        .clone()
}

#[test]
fn exam_progress_exposes_exact_attribute_skill_fame_and_year_deficits() {
    let mut w = world();
    let attr = w.defs.captain.attributes[0].key.clone();
    let skill = w.defs.story2.skills.iter().next().unwrap().clone();
    let current = w.upbringing_projected(&attr);
    let e = Arc::make_mut(&mut w.defs).upbringing.exams.iter_mut().find(|e| e.key == "test_exam_navigation").unwrap();
    e.requirements = Requirements {
        all: vec![
            Requirements { attr: Some(attr), min: Some(current + 2), ..Default::default() },
            Requirements { skill: Some(skill), level: 2, ..Default::default() },
            Requirements { fame_min: Some(10), ..Default::default() },
            Requirements { year: Some(1), ..Default::default() },
        ],
        ..Default::default()
    };
    w.state.upbringing.as_mut().unwrap().fame = 3;
    let before = w.state_hash();
    let e = exam(&w);
    assert_eq!(e["status"], "locked");
    assert_eq!(e["progress"]["met"], false);
    let all = &e["progress"]["requirements"]["all"];
    assert_eq!(all[0]["checks"][0]["current"], current);
    assert_eq!(all[0]["checks"][0]["missing"], 2);
    assert_eq!(all[1]["checks"][0]["missing"], 2);
    assert_eq!(all[2]["checks"][0]["missing"], 7);
    assert_eq!(all[3]["checks"][0]["missing"], 1);
    assert_eq!(w.state_hash(), before);
}

#[test]
fn alternative_requirements_keep_their_grouping_and_match_the_kernel() {
    let mut w = world();
    let attr = w.defs.captain.attributes[0].key.clone();
    let current = w.upbringing_projected(&attr);
    let e = Arc::make_mut(&mut w.defs).upbringing.exams.iter_mut().find(|e| e.key == "test_exam_navigation").unwrap();
    e.requirements = Requirements {
        any: vec![
            Requirements { attr: Some(attr.clone()), min: Some(current + 1), ..Default::default() },
            Requirements { attr: Some(attr), max: Some(current), ..Default::default() },
        ],
        ..Default::default()
    };
    let e = exam(&w);
    assert_eq!(e["status"], "open");
    assert_eq!(e["progress"]["requirements"]["met"], true);
    let any = &e["progress"]["requirements"]["any"];
    assert_eq!(any[0]["checks"][0]["missing"], 1);
    assert_eq!(any[1]["checks"][0]["met"], true);
    assert_eq!(e["progress"]["met"], true);
}

#[test]
fn retake_progress_explains_cooldown_remediation_fee_and_attempts() {
    let mut w = world();
    let activity = w.defs.upbringing.activities[0].key.clone();
    let cash = w.agent(manifest_core::OwnerId::Player).unwrap().cash;
    let e = Arc::make_mut(&mut w.defs).upbringing.exams.iter_mut().find(|e| e.key == "test_exam_navigation").unwrap();
    e.retake = Retake { cooldown_days: 30, max_attempts: 3, fee: cash + 25, remediation: vec![activity.clone()] };
    let day = w.day();
    w.state.upbringing.as_mut().unwrap().exams.insert(
        "test_exam_navigation".into(),
        ExamState { attempts: 1, last_day: Some(day), passed: false, remediation: [(activity, 0)].into() },
    );
    let p = &exam(&w)["progress"];
    assert_eq!(p["cooldown_days"], 30);
    assert_eq!(p["attempts_remaining"], 2);
    assert_eq!(p["fee"]["missing"], 25);
    assert_eq!(p["remediation"][0]["missing"], 1);
    assert_eq!(p["remediation_met"], false);
    assert_eq!(p["met"], false);
}

#[test]
fn rating_total_and_date_explain_the_remaining_gate_after_requirements_are_met() {
    let mut w = world();
    let rating = w.defs.captain.ratings[0].key.clone();
    let current = w.upbringing_rating(&rating);
    let e = Arc::make_mut(&mut w.defs).upbringing.exams.iter_mut().find(|e| e.key == "test_exam_navigation").unwrap();
    e.requirements = Requirements::default();
    e.rating_check =
        Some(RatingCheck { ratings: vec![rating.clone()], min_total: current + 10, check_bonus_divisor: 100 });
    e.dates = vec![[1553, 2, 1]];
    let value = exam(&w);
    let p = &value["progress"];
    assert_eq!(p["requirements"]["met"], true);
    assert_eq!(p["rating_total"]["current"], current);
    assert_eq!(p["rating_total"]["missing"], 10);
    assert_eq!(p["rating_total"]["ratings"][0], rating);
    assert_eq!(p["date"]["met"], false);
    assert_eq!(p["met"], false);
    // 补考按冷却判断，不再要求落在首次考试日期；数值门槛仍要满足。
    w.state.upbringing.as_mut().unwrap().exams.insert(
        "test_exam_navigation".into(),
        ExamState { attempts: 1, last_day: None, passed: false, remediation: Default::default() },
    );
    assert_eq!(exam(&w)["progress"]["date"]["met"], true);
    assert_eq!(exam(&w)["progress"]["rating_total"]["met"], false);
}
