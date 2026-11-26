//! 月初暂停、世界逐日推进、旬间事件和存读档/重放共用同一条时间线。
use manifest_core::{
    replay::{LogEntry, Source, StartParams, replay},
    upbringing::*,
    *,
};
use serde_json::json;
use std::sync::Arc;
fn defs(month_days: u16, academy: bool) -> Arc<StaticData> {
    let mut d = (*testkit::tiny_defs()).clone();
    d.calendar = calendar::Calendar::new(vec![month_days; 12], vec![0; 12], "占位".into(), vec![]).unwrap();
    d.scenarios[0].upbringing = true;
    let at = d.locations[0].key.clone();
    d.upbringing=serde_json::from_value(json!({
        "families":[{"key":"family","name":"占位","scenario":"test","home":at,"born":[1489,6,1],"gender":"f","graduation":[1506,1,1],
            "stages":[{"from":[1502,1,1],"stage":if academy{"academy"}else{"home"},"name":"占位","at":at}]}],
        "activities":[{"key":"rest","name":"占位","kind":"rest"},{"key":"lesson","name":"占位","kind":"lesson"}]
    })).unwrap();
    Arc::new(d)
}
fn plan(academy: bool) -> Command {
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot {
                index,
                lesson: academy.then(|| "lesson".into()),
                after: Some(AfterChoice::activity("rest")),
            })
            .collect(),
    }
}
#[test]
fn three_slots_cover_28_30_and_31_days_without_skipping_world_ticks() {
    for days in [28, 30, 31] {
        for academy in [false, true] {
            let d = defs(days, academy);
            let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
            assert_eq!(w.fleets_of(OwnerId::Player).count(), 0);
            assert_eq!(w.state.cast.academy, academy);
            let before = w.state.clone();
            assert!(matches!(w.end_day(), Err(CoreError::UpbringingPaused)));
            assert_eq!(before, w.state);
            plan(academy).apply(&mut w).unwrap();
            let before = w.state.clone();
            assert!(plan(academy).apply(&mut w).is_err());
            assert_eq!(before, w.state);
            for day in 1..=u32::from(days) {
                w.end_day().unwrap();
                assert_eq!(w.day(), day);
                let expected = if day < 10 {
                    0
                } else if day < 20 {
                    1
                } else if day < u32::from(days) {
                    2
                } else {
                    3
                };
                assert_eq!(w.state.upbringing.as_ref().unwrap().settled.len(), expected);
            }
            assert_eq!(w.cast_date(), [1502, 2, 1]);
            assert_eq!(w.state.upbringing.as_ref().unwrap().phase, Phase::Plan);
            assert_eq!(w.state.upbringing.as_ref().unwrap().last.len(), 3);
            assert!(!w.state.locations[0].market.is_empty());
            testkit::check_invariants(&w).unwrap();
            let history = [LogEntry { minute: None, tick: 0, seq: 0, source: Source::Player, command: plan(academy) }];
            let replayed = replay(d, StartParams::new(ScenarioId(0), 42), &history, u32::from(days)).unwrap();
            assert_eq!(replayed.state, w.state);
        }
    }
}
#[test]
fn every_invalid_plan_is_rejected_atomically() {
    let mut w = World::new(defs(31, true), ScenarioId(0), 7).unwrap();
    let Command::PlanMonth { slots, .. } = plan(true) else { unreachable!() };
    let mut variants = vec![slots.clone(); 5];
    variants[0].pop();
    variants[1][1].index = 0;
    variants[2][2].lesson = None;
    variants[3][0].after = None;
    variants[4][1].after.as_mut().unwrap().activity = "lesson".into();
    let before = w.state.clone();
    for slots in variants {
        assert!(Command::PlanMonth { owner: OwnerId::Player, slots }.apply(&mut w).is_err());
        assert_eq!(before, w.state);
    }
    assert!(plan(false).apply(&mut w).is_err());
}
#[test]
fn event_between_slots_pauses_without_recursive_advance_or_duplicate_settlement() {
    let mut d = defs(31, false);
    let data = Arc::make_mut(&mut d);
    data.story2=serde_json::from_value(json!({"tracks":[{"key":"slot_event","name":"占位","kind":"main","start":"first","auto":false,"chapters":[{"key":"first","title":"占位","text":"占位","choices":[{"key":"ok","text":"继续","next":"done"}]}]}]})).unwrap();
    data.upbringing.activities[0].events.push("slot_event".into());
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    plan(false).apply(&mut w).unwrap();
    for _ in 0..10 {
        w.end_day().unwrap();
    }
    assert_eq!(w.cast_date(), [1502, 1, 11]);
    assert_eq!(w.pending_story2().unwrap().track, "slot_event");
    let before = w.state.clone();
    assert!(matches!(w.end_day(), Err(CoreError::UpbringingPaused)));
    assert_eq!(before, w.state);
    let mut loaded = World::from_snapshot(d, w.state.clone()).unwrap();
    assert_eq!(loaded.state, w.state);
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut loaded).unwrap();
    for _ in 0..21 {
        loaded.end_day().unwrap();
    }
    assert_eq!(loaded.state.upbringing.as_ref().unwrap().settled.len(), 3);
    assert_eq!(loaded.state.log.iter().filter(|l| matches!(l.kind, log::LogKind::UpbringingSettled { .. })).count(), 3);
}
#[test]
fn classic_state_omits_the_module_and_old_snapshots_default_to_none() {
    let d = testkit::tiny_defs();
    let w = World::new(d.clone(), ScenarioId(0), 1).unwrap();
    let saved = serde_json::to_value(&w.state).unwrap();
    assert!(saved.get("upbringing").is_none());
    let loaded = World::from_snapshot(d, serde_json::from_value(saved).unwrap()).unwrap();
    assert_eq!(loaded.state, w.state);
}

#[test]
fn home_lessons_use_the_single_after_column() {
    let mut w = World::new(defs(31, false), ScenarioId(0), 42).unwrap();
    let slots =
        (0..3).map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("lesson")) }).collect();
    Command::PlanMonth { owner: OwnerId::Player, slots }.apply(&mut w).unwrap();
    for _ in 0..31 {
        w.end_day().unwrap();
    }
    assert_eq!(w.state.upbringing.as_ref().unwrap().last.len(), 3);
}

#[test]
fn removed_activity_replans_only_unsettled_slots_and_disabled_family_cleans_once() {
    let mut d = defs(31, false);
    let mut alternate = Arc::make_mut(&mut d).upbringing.activities[0].clone();
    alternate.key = "alternate".into();
    Arc::make_mut(&mut d).upbringing.activities.push(alternate);
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    plan(false).apply(&mut w).unwrap();
    for _ in 0..10 {
        w.end_day().unwrap();
    }
    Arc::make_mut(&mut d).upbringing.activities.retain(|a| a.key != "rest");
    let mut loaded = World::from_snapshot(d.clone(), w.state).unwrap();
    assert_eq!(loaded.state.upbringing.as_ref().unwrap().phase, Phase::Plan);
    assert_eq!(loaded.state.upbringing.as_ref().unwrap().next_slot, 1);
    assert_eq!(World::from_snapshot(d.clone(), loaded.state.clone()).unwrap().state, loaded.state);
    Command::PlanMonth {
        owner: OwnerId::Player,
        slots: (0..3)
            .map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("alternate")) })
            .collect(),
    }
    .apply(&mut loaded)
    .unwrap();
    for _ in 0..21 {
        loaded.end_day().unwrap();
    }
    assert_eq!(loaded.state.upbringing.as_ref().unwrap().settled.len(), 3);
    assert_eq!(loaded.state.log.iter().filter(|l| matches!(l.kind, log::LogKind::UpbringingSettled { .. })).count(), 3);
    Arc::make_mut(&mut d).upbringing = Default::default();
    let mut ended = World::from_snapshot(d.clone(), loaded.state).unwrap();
    assert!(ended.state.upbringing.is_none());
    assert!(ended.state.cast.is_empty());
    assert_eq!(World::from_snapshot(d, ended.state.clone()).unwrap().state, ended.state);
    ended.end_day().unwrap();
}
