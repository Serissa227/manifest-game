//! E57：门槛、反弹、最高值与数据顺序、一次性结局。
#[path = "support/history.rs"]
mod fixture;
use fixture::*;
use manifest_core::{history::*, ideas::Mode, *};
use serde_json::json;
use std::sync::Arc;
fn data() -> Arc<StaticData> {
    let mut d = defs(json!([lever("money"), lever("deliver"), lever("relief")]));
    let dd = Arc::make_mut(&mut d);
    dd.history.campaigns=serde_json::from_value(json!([{"key":"test_chain","name":"测试战役","inertia":25,
        "ending_event":"final","vars":[
            {"key":"wisdom","name":"测试思想","start":10,"drift":[[1553,10],[1600,10]],"idea":"sample_school","court":"council","gates":[{"event":EVENT,"outcome":"closed","cap":40}]},
            {"key":"court","name":"测试朝议","start":60,"drift":[[1553,60],[1600,60]]}],
        "outlooks":[{"key":"council","name":"测试宫廷","historical":"historical","threshold":60,"priority":["wisdom"]}],
        "endings":[
            {"key":"default_historical","outcome":"opens","court":"council","outlook":"historical","text":"测试史实结局。"},
            {"key":"default_school","outcome":"opens","court":"council","outlook":"sample_school","text":"测试思想结局。","effects":[{"kind":"flag","flag":"test_idea_ending"}]},
            {"key":"changed_historical","outcome":"closed","court":"council","outlook":"historical","text":"测试战役结局。"},
            {"key":"changed_school","outcome":"closed","court":"council","outlook":"sample_school","text":"测试组合结局。","effects":[{"kind":"flag","flag":"test_idea_ending"}]}]}])).unwrap();
    let e = &mut dd.history.events[0];
    e.campaign = Some("test_chain".into());
    e.need = Some(Need { kinds: 3 });
    let mut last = e.clone();
    last.key = "final".into();
    last.date = Some([1558, 1, 25]);
    last.window = None;
    last.levers.clear();
    last.need = None;
    last.requires = vec![Requirement { event: EVENT.into(), outcome: None }];
    dd.history.events.push(last);
    dd.history.order = validation::order(&dd.history).unwrap();
    for m in &mut dd.ideas.ports[0].modes {
        m.campaign = Some("test_chain".into());
        m.var = Some("wisdom".into());
    }
    d
}
fn new(d: Arc<StaticData>) -> World {
    assert!(validation::validate(&d).is_empty(), "{:?}", validation::validate(&d));
    World::new(d, ScenarioId(0), 42).unwrap()
}
fn pass(w: &mut World) {
    command("money", Payload::Money { amount: 200 }).apply(w).unwrap();
    let (f, g) = buy(w, 6);
    delivery("deliver", f, g, 3, true).apply(w).unwrap();
    delivery("relief", f, g, 3, true).apply(w).unwrap();
}
#[test]
fn gates_clamp_propagation_and_release_before_the_gate_outcome_effects() {
    let mut d = data();
    let dd = Arc::make_mut(&mut d);
    dd.history.campaigns[0].vars[0].start = 35;
    dd.history.campaigns[0].vars[0].drift = vec![(1553, 35)];
    dd.history.events[0].outcomes[1].vars = vec![VarChange { var: "wisdom".into(), add: 30 }];
    let mut w = new(d);
    w.state.items.owners.entry(O).or_default().skill_xp.insert("lang_test".into(), 2);
    w.grant_item(O, "reader", 1).unwrap();
    let loc = w.defs.find_loc("test_west").unwrap();
    for _ in 0..3 {
        Command::Propagate { owner: O, idea: "sample_school".into(), loc, mode: Mode::Print }.apply(&mut w).unwrap();
        advance(&mut w, 1);
    }
    assert_eq!(w.campaign_value("test_chain", "wisdom"), Some(40));
    assert_eq!(w.campaign_cap("test_chain", "wisdom"), Some(40));
    pass(&mut w);
    advance(&mut w, 20);
    assert_eq!(w.history_outcome(EVENT), Some("closed"));
    assert_eq!(w.campaign_value("test_chain", "wisdom"), Some(70));
    assert_eq!(w.campaign_cap("test_chain", "wisdom"), None);
    advance(&mut w, 3);
    assert_eq!(w.campaign_outlook("test_chain", "council"), Some("sample_school".into()));
    assert!(w.state.story2.flags.contains("test_idea_ending"));
    assert_eq!(restored(&w).state_hash(), w.state_hash());
}
#[test]
fn no_intervention_preserves_history_and_ending_effects_only_run_once() {
    let mut w = new(data());
    advance(&mut w, 30);
    assert_eq!(w.history_deviation(), 0);
    assert_eq!(w.campaign_outlook("test_chain", "council"), Some("historical".into()));
    assert_eq!(w.state.history.campaigns["test_chain"].endings.len(), 1);
    let ending = w.state.history.campaigns["test_chain"].finished;
    let mut saved = restored(&w);
    advance(&mut w, 370);
    advance(&mut saved, 370);
    assert_eq!(w.campaign_value("test_chain", "wisdom"), Some(10));
    assert_eq!(w.state.history.campaigns["test_chain"].finished, ending);
    assert_eq!(w.state_hash(), saved.state_hash());
}
#[test]
fn outlook_uses_highest_value_then_authored_priority_and_ignores_failed_gates() {
    let mut d = data();
    let dd = Arc::make_mut(&mut d);
    let mut idea = dd.ideas.ideas[0].clone();
    idea.key = "other_school".into();
    dd.ideas.ideas.push(idea);
    let c = &mut dd.history.campaigns[0];
    let mut other = c.vars[0].clone();
    other.key = "other".into();
    other.idea = Some("other_school".into());
    other.gates.clear();
    c.vars.push(other);
    c.outlooks[0].priority.push("other".into());
    for outcome in ["opens", "closed"] {
        c.endings.push(serde_json::from_value(json!({"key":format!("{outcome}_other"),"outcome":outcome,"court":"council","outlook":"other_school","text":"测试其他走向。"})).unwrap());
    }
    let mut w = new(d);
    let s = w.state.history.campaigns.get_mut("test_chain").unwrap();
    s.influenced = true;
    s.values.insert("wisdom".into(), 90);
    s.values.insert("other".into(), 70);
    assert_eq!(w.campaign_outlook("test_chain", "council"), Some("other_school".into()));
    w.state.history.events.entry(EVENT.into()).or_default().outcome = Some("closed".into());
    w.state.history.campaigns.get_mut("test_chain").unwrap().values.insert("wisdom".into(), 70);
    assert_eq!(w.campaign_outlook("test_chain", "council"), Some("sample_school".into()));
    w.state.history.campaigns.get_mut("test_chain").unwrap().values.insert("other".into(), 71);
    assert_eq!(w.campaign_outlook("test_chain", "council"), Some("other_school".into()));
}
#[test]
fn backlash_fires_once_on_the_same_day_and_replays() {
    let mut d = data();
    let dd = Arc::make_mut(&mut d);
    dd.history.campaigns[0].vars[0].gates.clear();
    dd.history.campaigns[0].backlash =
        serde_json::from_value(json!([{"when":[{"var":"wisdom","ge":30},{"var":"court","lt":70}],"event":"backlash"}]))
            .unwrap();
    let mut e = dd.history.events[0].clone();
    e.key = "backlash".into();
    e.locked = true;
    e.window = Some([[1558, 1, 1], [1558, 1, 25]]);
    e.date = Some([1558, 1, 25]);
    e.need = None;
    e.levers.clear();
    e.balance = 1;
    e.outcomes[1].vars = vec![VarChange { var: "wisdom".into(), add: -15 }];
    dd.history.events.push(e);
    let l = &mut dd.history.events[0].levers[0];
    l.var = Some("wisdom".into());
    l.var_per_point = 2;
    dd.history.order = validation::order(&dd.history).unwrap();
    let mut w = new(d);
    let mut replayed = w.clone();
    let c = command("money", Payload::Money { amount: 150 });
    let start = w.day();
    c.apply(&mut w).unwrap();
    advance(&mut w, 1);
    assert_eq!(w.history_outcome("backlash"), Some("closed"));
    assert_eq!(w.campaign_value("test_chain", "wisdom"), Some(25));
    advance(&mut w, 2);
    assert_eq!(w.campaign_value("test_chain", "wisdom"), Some(25));
    replay::replay_onto(
        &mut replayed,
        &[replay::LogEntry { tick: start, seq: 0, source: replay::Source::Player, command: c, minute: None }],
        w.day(),
    )
    .unwrap();
    assert_eq!(w.state_hash(), replayed.state_hash());
    assert_eq!(restored(&w).state_hash(), w.state_hash());
}
#[test]
fn incomplete_endings_bad_gates_and_corrupt_finished_state_are_rejected() {
    let d = data();
    for case in 0..3 {
        let mut d = d.clone();
        let c = &mut Arc::make_mut(&mut d).history.campaigns[0];
        match case {
            0 => {
                c.endings.pop();
            }
            1 => c.vars[0].gates[0].outcome = "absent".into(),
            _ => c.outlooks[0].priority.push("absent".into()),
        };
        assert!(!validation::validate(&d).is_empty());
    }
    let mut w = new(d);
    advance(&mut w, 30);
    let mut state = w.state.clone();
    state.history.campaigns.get_mut("test_chain").unwrap().endings.insert("absent".into());
    assert!(World::from_snapshot(w.defs.clone(), state).is_err());
}
#[test]
fn an_outcome_can_trigger_an_earlier_ordered_backlash_on_its_deadline() {
    let mut d = data();
    let dd = Arc::make_mut(&mut d);
    dd.history.campaigns[0].vars[0].gates.clear();
    dd.history.campaigns[0].backlash =
        serde_json::from_value(json!([{"when":[{"var":"wisdom","ge":30}],"event":"a_backlash"}])).unwrap();
    let mut e = dd.history.events[0].clone();
    e.key = "a_backlash".into();
    e.locked = true;
    e.need = None;
    e.levers.clear();
    e.balance = 1;
    e.outcomes[1].vars = vec![VarChange { var: "wisdom".into(), add: -15 }];
    dd.history.events[0].outcomes[1].vars = vec![VarChange { var: "wisdom".into(), add: 30 }];
    dd.history.events.push(e);
    dd.history.order = validation::order(&dd.history).unwrap();
    assert_eq!(dd.history.events[dd.history.order[0]].key, "a_backlash");
    let mut w = new(d);
    pass(&mut w);
    advance(&mut w, 20);
    assert_eq!(w.history_outcome("a_backlash"), Some("closed"));
    assert_eq!(w.state.history.events["a_backlash"].resolved_day, w.state.history.events[EVENT].resolved_day);
    assert_eq!(w.campaign_value("test_chain", "wisdom"), Some(25));
    assert_eq!(restored(&w).state_hash(), w.state_hash());
}
