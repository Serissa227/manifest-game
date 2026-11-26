//! 冻结完整事务的旧实现，覆盖安静日、依赖、活动、结局及失败回滚。
use super::*;
use serde_json::{Value, json};
use std::sync::Arc;

fn event(key: &str, date: [u32; 3]) -> Value {
    json!({"key":key,"title":"测试事件","date":date,
        "history":{"date":date,"outcome":"done"},"sides":[
            {"key":"a","name":"甲方","faction":"crown"},
            {"key":"b","name":"乙方","faction":"league"}],
        "outcomes":[{"key":"done","when":"-9223372036854775808..9223372036854775807","default":true}]})
}

fn fixture(history: Value) -> World {
    let mut world = World::new(crate::testkit::tiny_defs(), ScenarioId(0), 42).unwrap();
    let defs = Arc::make_mut(&mut world.defs);
    defs.history = serde_json::from_value(history).unwrap();
    defs.history.order = (0..defs.history.events.len()).collect();
    world.state.history.enabled = true;
    world
}

fn compare(mut actual: World) -> World {
    let mut expected = actual.clone();
    assert_eq!(
        actual.history_day().map_err(|e| e.to_string()),
        expected.original_history_day().map_err(|e| e.to_string())
    );
    assert_eq!(serde_json::to_vec(&actual.state).unwrap(), serde_json::to_vec(&expected.state).unwrap());
    assert_eq!(actual.state_hash(), expected.state_hash());
    actual
}

#[test]
fn quiet_days_keep_year_drift_expiration_and_all_other_state_identical() {
    let mut locked = event("locked", [1, 1, 1]);
    locked["locked"] = json!(true);
    let mut w = fixture(json!({"events":[event("future",[9999,1,1]),locked],"campaigns":[{
        "key":"campaign","name":"测试战役","inertia":10,
        "vars":[{"key":"power","name":"测试变量","start":20,"drift":[[1500,20],[1510,40]]}]
    }]}));
    for day in [0, 1, 30, 359, 360, 365, 720, 1460] {
        w.state.day = day;
        let mut fast = w.clone();
        assert!(fast.advance_history_day(true).unwrap());
        w = compare(w);
        assert_eq!(fast.state, w.state);
        assert!(w.state.history.events["locked"].closed);
    }
}

#[test]
fn forced_events_and_reverse_order_dependencies_use_the_complete_transaction() {
    let first = event("first", [9999, 1, 1]);
    let mut second = event("second", [1, 1, 1]);
    second["requires"] = json!([{"event":"first","outcome":"done"}]);
    second["outcomes"][0]["effects"] = json!([{"kind":"flag","flag":"cascade_done","value":true}]);
    let mut w = fixture(json!({"events":[second,first]}));
    w.init_history();
    w.state.history.events.get_mut("first").unwrap().forced = true;
    let w = compare(w);
    assert_eq!(w.state.history.chronicle.iter().map(|r| r.event.as_str()).collect::<Vec<_>>(), ["first", "second"]);
    assert!(w.state.story2.flags.contains("cascade_done"));
}

#[test]
fn active_material_work_defers_before_mutation_and_keeps_invalidation() {
    let mut definition = event("training", [9999, 1, 1]);
    definition["window"] = json!([[1, 1, 1], [1, 1, 2]]);
    let mut w = fixture(json!({"events":[definition]}));
    w.init_history();
    let activity = Activity {
        fleet: FleetId(0),
        convoy: None,
        started: 0,
        last_day: None,
        days: 0,
        departed: false,
        arrived: false,
        valid: true,
    };
    w.state
        .history
        .events
        .get_mut("training")
        .unwrap()
        .contributions
        .entry("train".into())
        .or_default()
        .activities
        .insert(OwnerId::Player, activity);
    let before = w.state.clone();
    assert!(!w.advance_history_day(true).unwrap());
    assert_eq!(w.state, before);
    let w = compare(w);
    assert!(!w.state.history.events["training"].contributions["train"].activities[&OwnerId::Player].valid);
}

#[test]
fn failure_after_an_earlier_effect_restores_the_whole_world() {
    let first = event("first", [1, 1, 1]);
    let mut broken = event("broken", [1, 1, 1]);
    broken["outcomes"][0]["effects"] = json!([
        {"kind":"flag","flag":"must_not_survive","value":true},
        {"kind":"port_state","port":"missing_port","state":"destroyed"}
    ]);
    let mut w = fixture(json!({"events":[first,broken]}));
    let before = w.state.clone();
    assert!(w.history_day().is_err());
    assert_eq!(w.state, before);
    assert_eq!(compare(w).state, before);
}

#[test]
fn pending_campaign_endings_keep_success_and_failure_atomic() {
    for broken in [false, true] {
        let effects = if broken {
            json!([
                {"kind":"flag","flag":"ending_effect","value":true},
                {"kind":"port_state","port":"missing_port","state":"destroyed"}
            ])
        } else {
            json!([{"kind":"flag","flag":"ending_effect","value":true}])
        };
        let mut w = fixture(json!({"events":[event("last",[1,1,1])],"campaigns":[{
            "key":"campaign","name":"测试战役","inertia":10,"vars":[],"ending_event":"last",
            "outlooks":[{"key":"court","name":"测试宫廷","historical":"old","threshold":50,"priority":[]}],
            "endings":[{"key":"ending","outcome":"done","court":"court","outlook":"old","text":"测试结局","effects":effects}]
        }]}));
        w.init_history();
        let state = w.state.history.events.get_mut("last").unwrap();
        state.outcome = Some("done".into());
        state.resolved_day = Some(0);
        let before = w.state.clone();
        let w = compare(w);
        if broken {
            assert_eq!(w.state, before);
        } else {
            assert_eq!(w.state.history.campaigns["campaign"].finished, Some(w.day()));
            assert!(w.state.story2.flags.contains("ending_effect"));
        }
    }
}

#[test]
fn idea_backlash_still_forces_and_resolves_an_event_on_the_same_day() {
    let mut backlash = event("backlash", [9999, 1, 1]);
    backlash["locked"] = json!(true);
    let w = fixture(json!({"events":[backlash],"campaigns":[{
        "key":"campaign","name":"测试战役","inertia":10,
        "vars":[{"key":"power","name":"测试变量","start":80}],
        "backlash":[{"when":[{"var":"power","ge":70}],"event":"backlash"}]
    }]}));
    let w = compare(w);
    assert_eq!(w.history_outcome("backlash"), Some("done"));
    assert!(w.state.history.campaigns["campaign"].backlash.contains("backlash"));
}

#[test]
fn finished_conditional_campaign_closes_future_events_on_the_quiet_path() {
    let mut ending = event("ending", [1, 1, 1]);
    ending["outcome_rules"] = json!([{"outcome":"done","when":[]}]);
    let mut later = event("later", [9999, 1, 1]);
    later["campaign"] = json!("campaign");
    let mut w = fixture(json!({"events":[ending,later],"campaigns":[{
        "key":"campaign","name":"测试战役","inertia":10,"vars":[],"ending_event":"ending"
    }]}));
    w.init_history();
    let ending = w.state.history.events.get_mut("ending").unwrap();
    ending.outcome = Some("done".into());
    ending.resolved_day = Some(0);
    w.state.history.campaigns.get_mut("campaign").unwrap().finished = Some(0);
    let mut fast = w.clone();
    assert!(fast.advance_history_day(true).unwrap());
    let w = compare(w);
    assert_eq!(fast.state, w.state);
    assert!(w.state.history.events["later"].closed);
}

#[test]
fn disabled_empty_and_already_processed_days_stay_noops() {
    let mut empty = fixture(json!({}));
    empty.state.history.enabled = false;
    assert_eq!(compare(empty.clone()).state, empty.state);
    let mut w = fixture(json!({"events":[event("future",[9999,1,1])]}));
    w.state.history.last_day = Some(w.day());
    assert_eq!(compare(w.clone()).state, w.state);
    w.state.history.last_day = None;
    w.state.history.enabled = false;
    assert_eq!(compare(w.clone()).state, w.state);
}

impl World {
    fn original_history_day(&mut self) -> Result<(), CoreError> {
        if self.defs.history.is_empty()
            || !self.state.history.enabled
            || self.state.history.last_day == Some(self.day())
        {
            return Ok(());
        }
        let mut trial = self.clone();
        trial.original_advance_history_day()?;
        self.state = trial.state;
        Ok(())
    }
    fn original_advance_history_day(&mut self) -> Result<(), CoreError> {
        self.init_history();
        self.campaign_year();
        self.history_material_day().map_err(|e| CoreError::Internal(format!("历史行动：{e}")))?;
        let defs = self.defs.clone();
        let today = self.cast_date();
        for _ in 0..=defs.history.events.len() {
            self.history_ideas_changed();
            let mut changed = false;
            for &index in &defs.history.order {
                let event = &defs.history.events[index];
                let Some(state) = self.state.history.events.get(&event.key) else { continue };
                if state.outcome.is_some() || state.closed {
                    continue;
                }
                // 条件终局可提前结束战役；后来的战事不能再把世界改回缺省轨迹。
                let finished = event
                    .campaign
                    .as_ref()
                    .filter(|c| self.state.history.campaigns.get(*c).is_some_and(|s| s.finished.is_some()))
                    .and_then(|c| defs.history.campaign(c))
                    .and_then(|c| c.ending_event.as_ref())
                    .and_then(|key| defs.history.event(key))
                    .is_some_and(|ending| {
                        !ending.outcome_rules.is_empty() && self.history_outcome(&ending.key).is_some()
                    });
                if finished {
                    self.state.history.events.entry(event.key.clone()).or_default().closed = true;
                    continue;
                }
                let expired = event.deadline() <= today;
                let triggered = (state.forced
                    || !event.trigger.is_empty() && self.history_conditions(event, &event.trigger))
                    && event.window.is_none_or(|w| w[0] <= today && today <= w[1]);
                if !expired && !triggered {
                    continue;
                }
                let requirements = event
                    .requires
                    .iter()
                    .all(|r| self.history_outcome(&r.event).is_some_and(|v| r.outcome.as_ref().is_none_or(|o| o == v)));
                if !requirements || event.locked && !state.unlocked {
                    continue;
                }
                let (outcome, resolution) =
                    self.campaign_outcome(event).map_err(|e| CoreError::Internal(e.to_string()))?;
                self.resolve_history(event, outcome, resolution.score)
                    .map_err(|e| CoreError::Internal(format!("历史事件 {}：{e}", event.key)))?;
                self.state.history.events.entry(event.key.clone()).or_default().resolution = Some(resolution);
                changed = true;
            }
            if !changed {
                break;
            }
        }
        for e in &defs.history.events {
            if e.deadline() <= today {
                let state = self.state.history.events.entry(e.key.clone()).or_default();
                if state.outcome.is_none() {
                    state.closed = true;
                }
            }
        }
        self.history_ideas_changed();
        self.finish_campaigns().map_err(|e| CoreError::Internal(format!("历史结局：{e}")))?;
        self.state.history.last_day = Some(self.day());
        Ok(())
    }
}
