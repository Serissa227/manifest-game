//! 第九批文字类型的真实日历与最小来信夹具，不改变经典请求覆盖。
use manifest_ai::TaskRequest;
use manifest_core::{Command, OwnerId, ScenarioId, World};
use std::sync::Arc;

pub fn text_cases() -> Vec<(World, TaskRequest)> {
    let root = manifest_data::find_data_dir().unwrap();
    let base = manifest_data::load_world(&root, "testbed").unwrap();
    let mut d = base.clone();
    let s = &mut Arc::make_mut(&mut d).scenarios[0];
    s.start_date = [1558, 1, 1];
    s.control_date = s.start_date;
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    let mut out = vec![(w.clone(), TaskRequest::Narration { event: "sample_opening".into(), phase: "opening".into() })];
    w.state.cast.persons.entry("mentor".into()).or_default().met = true;
    let id = format!("request_letters:{}", w.defs.story2.track("request_letters").unwrap().start);
    let n=serde_json::from_value(serde_json::json!({"id":id,"day":w.day(),"text":"占位。","persons":["mentor"],"kind":"letter","loc":null,"track":"request_letters","known":true,"read":false,"rumor_days":30})).unwrap();
    w.state.story2.news.insert(id.clone(), n);
    out.push((w.clone(), TaskRequest::Letter { id, purpose: "help".into() }));
    while w.cast_date()[0] == 1558 {
        w.end_day().unwrap();
    }
    out.push((w, TaskRequest::AltChronicle { year: 1558 }));
    let sid = ScenarioId::from_idx(base.scenarios.iter().position(|s| s.key == "upbringing").unwrap());
    let mut w = World::new(base, sid, 42).unwrap();
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| manifest_core::upbringing::PlanSlot {
                index,
                lesson: None,
                after: Some(manifest_core::upbringing::AfterChoice::activity("rest")),
            })
            .collect(),
    }
    .apply(&mut w)
    .unwrap();
    while w.cast_date()[1] == 1 {
        while w.pending_story2().is_some() {
            Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
        }
        w.end_day().unwrap();
    }
    out.push((w, TaskRequest::Diary { year: 1553, month: 1 }));
    let mut w = out[0].0.clone();
    Arc::make_mut(&mut w.defs).history.events.iter_mut().find(|e| e.key == "sample_opening").unwrap().ripple_budget =
        1000;
    w.end_day().unwrap();
    w.end_day().unwrap();
    out.push((w, TaskRequest::Ripple { event: "sample_opening".into() }));
    out
}
