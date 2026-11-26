//! U02 工作包 4：考期。考试与补考都只能在考期（开考日起 10 天）内参加；日历与考试卡提前 60 天倒计时。
use manifest_appcore::{upbringing_view, views::Ctx};
use manifest_core::{
    ScenarioId, StaticData, World,
    replay::StartParams,
    scenario::{NewGameRequest, day_of},
    upbringing::{ExamState, Phase, Requirements},
};
use serde_json::Value;
use std::sync::Arc;

fn mio() -> World {
    let d: Arc<StaticData> = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap();
    let f = d.upbringing.family("mio").unwrap().clone();
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == f.scenario).unwrap());
    let mut p = StartParams::new(sid, 42);
    p.opening = Some(NewGameRequest {
        world: "terra16".into(),
        scenario: f.scenario.clone(),
        protagonist: Some("mio".into()),
        ..Default::default()
    });
    let mut w = World::from_start(d, &p, |_| {}).unwrap();
    // 只测考期：去掉通用领航考的其他门槛，阶段设为进行中。
    let e = Arc::make_mut(&mut w.defs).upbringing.exams.iter_mut().find(|e| e.key == "exam_pilot").unwrap();
    e.requirements = Requirements::default();
    w.state.upbringing.as_mut().unwrap().phase = Phase::Running;
    w
}

fn on(w: &mut World, date: [u32; 3]) {
    w.state.day = day_of(&w.defs, date).unwrap();
}

fn pilot(w: &World) -> Value {
    upbringing_view::upbringing(Ctx::plain(&w.defs), w)["exams"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["key"] == "exam_pilot")
        .unwrap()
        .clone()
}

#[test]
fn exams_open_only_inside_a_ten_day_session() {
    let mut w = mio();
    let e = w.defs.upbringing.exams.iter().find(|e| e.key == "exam_pilot").unwrap().clone();
    for (date, open) in [([1554, 3, 20], false), ([1554, 3, 21], true), ([1554, 3, 30], true), ([1554, 3, 31], false)] {
        on(&mut w, date);
        assert_eq!(w.exam_in_session(&e), open, "{date:?}");
        assert_eq!(w.exam_available(&e).is_ok(), open, "{date:?}: {:?}", w.exam_available(&e));
    }
    on(&mut w, [1554, 2, 1]);
    assert_eq!(w.exam_next_session(&e), Some(day_of(&w.defs, [1554, 3, 21]).unwrap()));
    on(&mut w, [1556, 10, 1]);
    assert_eq!(w.exam_next_session(&e), None, "最后一个考期过了就没有下一个");
}

#[test]
fn retakes_also_wait_for_the_next_session_after_the_cooldown() {
    let mut w = mio();
    let e = w.defs.upbringing.exams.iter().find(|e| e.key == "exam_pilot").unwrap().clone();
    on(&mut w, [1554, 3, 21]);
    let day = w.day();
    w.state.upbringing.as_mut().unwrap().exams.insert(
        e.key.clone(),
        ExamState { attempts: 1, last_day: Some(day), passed: false, remediation: Default::default() },
    );
    // 冷却过了，但不在考期：不能补考。
    on(&mut w, [1554, 6, 1]);
    let err = w.exam_available(&e).unwrap_err().to_string();
    assert!(err.contains("考期") || err.contains("补习"), "{err}");
    assert_eq!(pilot(&w)["progress"]["date"]["met"], false);
    assert_eq!(pilot(&w)["date"], serde_json::json!([1554, 9, 21]));
    on(&mut w, [1554, 9, 22]);
    assert_eq!(pilot(&w)["progress"]["date"]["met"], true);
}

#[test]
fn the_exam_card_counts_down_sixty_days_ahead() {
    let mut w = mio();
    on(&mut w, [1554, 1, 1]);
    assert!(pilot(&w)["countdown_days"].is_null(), "离春季考期七十九天，还不倒计时");
    on(&mut w, [1554, 2, 1]);
    assert_eq!(pilot(&w)["countdown_days"], 48);
    on(&mut w, [1554, 3, 25]);
    assert_eq!(pilot(&w)["countdown_days"], 0, "考期中为 0");
}
