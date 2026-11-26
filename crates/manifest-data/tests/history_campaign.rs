//! E55：根源变量、整数公式、缺省、多类门槛与确定性结果。
#[path = "support/history.rs"]
mod fixture;
use fixture::*;
use manifest_core::{history::*, *};
use serde_json::{Value, json};
use std::sync::Arc;
fn data(levers: Value) -> Arc<StaticData> {
    let mut d = defs(levers);
    let dd = Arc::make_mut(&mut d);
    dd.history.campaigns = serde_json::from_value(json!([{"key":"test_chain","name":"测试战役","inertia":25,"vars":[
        {"key":"pay","name":"测试军饷","start":50,"drift":[[1558,50],[1560,45],[1600,10]]},
        {"key":"court","name":"测试朝议","start":100,"drift":[[1558,100],[1600,100]]}]}]))
    .unwrap();
    let e = &mut dd.history.events[0];
    e.campaign = Some("test_chain".into());
    e.base = None;
    e.base_vars.clear();
    e.need = None;
    e.counter = None;
    e.court = None;
    for o in &mut e.outcomes {
        o.vars.clear();
        o.backfire.clear();
    }
    d
}
fn new(d: Arc<StaticData>) -> World {
    assert!(validation::validate(&d).is_empty(), "{:?}", validation::validate(&d));
    World::new(d, ScenarioId(0), 42).unwrap()
}
#[test]
fn interpolation_and_negative_inertia_round_towards_zero() {
    let mut l = lever("money");
    l["var"] = "pay".into();
    l["var_per_point"] = (-1).into();
    let d = data(json!([l]));
    let v = &d.history.campaigns[0].vars[0];
    assert_eq!(v.baseline(1559), 48);
    assert_eq!(v.baseline(1500), 50);
    assert_eq!(v.baseline(1700), 10);
    let mut early = v.clone();
    early.start = 42;
    assert_eq!(early.baseline(1500), 42);
    assert_eq!(early.baseline(1558), 50);
    let mut w = new(d);
    command("money", Payload::Money { amount: 50 }).apply(&mut w).unwrap();
    assert_eq!(w.campaign_value("test_chain", "pay"), Some(45));
    w.state.day = scenario::day_of(&w.defs, [1559, 1, 1]).unwrap();
    assert_eq!(w.campaign_value("test_chain", "pay"), Some(44));
    let mut copy = restored(&w);
    advance(&mut w, 1);
    advance(&mut copy, 1);
    assert_eq!(w.state_hash(), copy.state_hash());
    assert_eq!(w.campaign_value("test_chain", "pay"), Some(44));
    assert_eq!(w.state.history.campaigns["test_chain"].year, 1559);
}
#[test]
fn no_intervention_matches_historical_trajectory_exactly_across_years_and_seeds() {
    let mut d = data(json!([]));
    let e = &mut Arc::make_mut(&mut d).history.events[0];
    e.roll = 100;
    e.balance = -999;
    e.outcomes[0].vars = serde_json::from_value(json!([{"var":"pay","add":-6}])).unwrap();
    for seed in [0, 42, 2026] {
        let mut w = World::new(d.clone(), ScenarioId(0), seed).unwrap();
        advance(&mut w, 731);
        for v in &d.history.campaigns[0].vars {
            assert_eq!(w.campaign_value("test_chain", &v.key), Some(v.baseline(w.cast_date()[0])));
        }
        assert_eq!(w.history_outcome(EVENT), Some("opens"));
        assert_eq!(w.history_deviation(), 0);
    }
}
#[test]
fn capped_single_kind_cannot_flip_need_but_three_real_kinds_can() {
    let mut d = data(json!([lever("money"), lever("deliver"), lever("relief")]));
    Arc::make_mut(&mut d).history.events[0].need = Some(Need { kinds: 3 });
    let mut one = new(d.clone());
    command("money", Payload::Money { amount: 200 }).apply(&mut one).unwrap();
    advance(&mut one, 20);
    assert_eq!(one.history_outcome(EVENT), Some("opens"));
    assert!(!one.state.history.events[EVENT].resolution.as_ref().unwrap().need_met);
    let mut many = new(d);
    let (fleet, good) = buy(&mut many, 6);
    command("money", Payload::Money { amount: 200 }).apply(&mut many).unwrap();
    delivery("deliver", fleet, good, 3, true).apply(&mut many).unwrap();
    delivery("relief", fleet, good, 3, true).apply(&mut many).unwrap();
    advance(&mut many, 20);
    assert_eq!(many.history_outcome(EVENT), Some("closed"));
    assert_eq!(many.state.history.events[EVENT].resolution.as_ref().unwrap().kinds, 3);
}
#[test]
fn counter_is_capped_and_failed_arms_backfire_uses_actual_effective_points() {
    let mut d = data(json!([lever("arms"), lever("money")]));
    let e = &mut Arc::make_mut(&mut d).history.events[0];
    e.balance = -100;
    e.counter = Some(Counter { side: "east".into(), pct: 40, max: 3 });
    e.outcomes[0].backfire =
        serde_json::from_value(json!([{"from_side":"west","lever":"arms","var":"court","pct":50}])).unwrap();
    Arc::make_mut(&mut d).history.campaigns[0].vars[1].drift = vec![(1558, 20)];
    let mut w = new(d);
    let (fleet, good) = buy(&mut w, 6);
    delivery("arms", fleet, good, 6, true).apply(&mut w).unwrap();
    command("money", Payload::Money { amount: 200 }).apply(&mut w).unwrap();
    let arms = w.history_lever_points(EVENT, "arms");
    advance(&mut w, 20);
    let r = w.state.history.events[EVENT].resolution.as_ref().unwrap();
    assert_eq!(r.counter, 3);
    assert_eq!(r.score, -100 + arms + 20 - 3);
    assert_eq!(w.campaign_value("test_chain", "court"), Some(20 + arms * 50 / 100));
}
#[test]
fn court_downgrade_and_bribe_bonus_are_deterministic_and_bounded() {
    let mut bribe = lever("bribe");
    bribe["with"] = "mentor".into();
    bribe["cost"] = 100.into();
    bribe["court_bonus"] = 100.into();
    bribe["var"] = "pay".into();
    bribe["var_per_point"] = (-1).into();
    let mut d = data(json!([lever("money"), bribe]));
    let dd = Arc::make_mut(&mut d);
    dd.history.campaigns[0].vars[1].drift = vec![(1558, 0)];
    let e = &mut dd.history.events[0];
    e.court = Some(Court { var: "court".into(), min: 40, fail: CourtFail::Downgrade });
    e.outcomes[1].when = "1..10".into();
    let mut top = e.outcomes[1].clone();
    top.key = "victory".into();
    top.when = "> 10".into();
    e.outcomes.push(top);
    let mut failed = new(d.clone());
    command("money", Payload::Money { amount: 200 }).apply(&mut failed).unwrap();
    advance(&mut failed, 20);
    assert_eq!(failed.history_outcome(EVENT), Some("closed"));
    assert_eq!(failed.state.history.events[EVENT].resolution.as_ref().unwrap().court_passed, Some(false));
    let mut w = new(d);
    Command::RequestAudience { owner: O, person: "mentor".into() }.apply(&mut w).unwrap();
    command("bribe", Payload::Commit {}).apply(&mut w).unwrap();
    command("money", Payload::Money { amount: 200 }).apply(&mut w).unwrap();
    let mut saved = restored(&w);
    advance(&mut w, 20);
    advance(&mut saved, 20);
    assert_eq!(w.state_hash(), saved.state_hash());
    assert_eq!(w.history_outcome(EVENT), Some("victory"));
    assert_eq!(w.state.history.events[EVENT].resolution.as_ref().unwrap().court_passed, Some(true));
}
#[test]
fn outcome_changes_are_relative_to_default_and_relief_cannot_exceed_variable_bounds() {
    let mut relief = lever("relief");
    relief["var"] = "pay".into();
    relief["var_per_point"] = 100.into();
    let mut d = data(json!([relief]));
    let e = &mut Arc::make_mut(&mut d).history.events[0];
    e.outcomes[0].vars = vec![VarChange { var: "court".into(), add: 5 }];
    e.outcomes[1].vars = vec![VarChange { var: "court".into(), add: -10 }];
    let mut w = new(d);
    let (fleet, good) = buy(&mut w, 6);
    delivery("relief", fleet, good, 6, true).apply(&mut w).unwrap();
    assert_eq!(w.campaign_value("test_chain", "pay"), Some(100));
    advance(&mut w, 20);
    assert_eq!(w.campaign_value("test_chain", "court"), Some(85));
}
#[test]
fn campaign_resolution_replays_from_commands_and_rejects_invalid_data_and_snapshots() {
    let mut l = lever("money");
    l["var"] = "pay".into();
    let mut d = data(json!([l]));
    let e = &mut Arc::make_mut(&mut d).history.events[0];
    e.roll = 10;
    e.base_vars = vec![BaseVar { var: "pay".into(), weight: -3 }];
    let mut w = new(d.clone());
    let cmd = command("money", Payload::Money { amount: 50 });
    let log = vec![replay::LogEntry {
        minute: None,
        tick: w.day(),
        seq: 0,
        source: replay::Source::Player,
        command: cmd.clone(),
    }];
    cmd.apply(&mut w).unwrap();
    advance(&mut w, 21);
    let replayed = replay::replay(d.clone(), replay::StartParams::new(ScenarioId(0), 42), &log, w.day()).unwrap();
    assert_eq!(w.state_hash(), replayed.state_hash());
    assert_eq!(w.state.history.events[EVENT].resolution.as_ref().unwrap().base, -6);
    let mut bad = w.state.clone();
    bad.history.campaigns.get_mut("test_chain").unwrap().values.insert("pay".into(), 101);
    assert!(World::from_snapshot(d.clone(), bad).is_err());
    let dd = Arc::make_mut(&mut d);
    dd.history.campaigns[0].vars[0].drift = vec![(1558, 50), (1558, 40)];
    assert!(!validation::validate(dd).is_empty());
}
#[test]
fn training_revalues_arms_variables_once_without_consuming_the_cargo_again() {
    let mut arms = lever("arms");
    arms["train"] = "train".into();
    arms["var"] = "pay".into();
    let mut train = lever("train");
    train["trainer"] = "mentor".into();
    train["days"] = 2.into();
    let mut w = new(data(json!([arms, train])));
    let (fleet, good) = buy(&mut w, 6);
    delivery("arms", fleet, good, 6, true).apply(&mut w).unwrap();
    assert_eq!(w.campaign_value("test_chain", "pay"), Some(50 + w.history_lever_points(EVENT, "arms")));
    command("train", Payload::Commit {}).apply(&mut w).unwrap();
    advance(&mut w, 2);
    let value = 50 + w.history_lever_points(EVENT, "arms");
    assert_eq!(w.campaign_value("test_chain", "pay"), Some(value));
    assert_eq!(w.holder_qty(O, warehouse::Holder::Fleet(fleet), good), 0);
    advance(&mut w, 1);
    assert_eq!(w.campaign_value("test_chain", "pay"), Some(value));
}
#[test]
fn saving_on_new_years_day_does_not_apply_inertia_early_or_twice() {
    let mut d = data(json!([]));
    let dd = Arc::make_mut(&mut d);
    dd.scenarios[0].start_date = [1558, 12, 31];
    dd.scenarios[0].control_date = [1558, 12, 31];
    let mut w = new(d);
    advance(&mut w, 1);
    assert_eq!(w.cast_date(), [1559, 1, 1]);
    assert_eq!(w.state.history.campaigns["test_chain"].year, 1558);
    let mut saved = restored(&w);
    assert_eq!(w.state_hash(), saved.state_hash());
    advance(&mut w, 1);
    advance(&mut saved, 1);
    assert_eq!(w.state_hash(), saved.state_hash());
    assert_eq!(w.campaign_value("test_chain", "pay"), Some(48));
}
#[test]
fn negotiation_can_require_a_campaign_variable_before_accepting_terms() {
    let mut fund = lever("money");
    fund["var"] = "pay".into();
    let mut talk = lever("negotiate");
    talk["with"] = "mentor".into();
    talk["language"] = "lang_test".into();
    talk["terms"] = json!(["test"]);
    talk["requires"] = json!([{"kind":"campaign_var","campaign":"test_chain","var":"pay","ge":60}]);
    let mut w = new(data(json!([fund, talk])));
    w.state.items.owners.entry(O).or_default().skill_xp.insert("lang_test".into(), 1);
    Command::RequestAudience { owner: O, person: "mentor".into() }.apply(&mut w).unwrap();
    let cmd = command("negotiate", Payload::Negotiate { term: "test".into() });
    reject(&mut w, cmd.clone());
    command("money", Payload::Money { amount: 100 }).apply(&mut w).unwrap();
    cmd.apply(&mut w).unwrap();
    assert_eq!(w.history_lever_points(EVENT, "negotiate"), 6);
}
#[test]
fn history_conditions_order_same_day_triggers_and_validate_references() {
    let mut d = data(json!([]));
    let dd = Arc::make_mut(&mut d);
    let parent = &mut dd.history.events[0];
    parent.date = None;
    parent.latest = Some([1558, 1, 20]);
    parent.trigger = serde_json::from_value(json!([{"kind":"flag","flag":"start_history"}])).unwrap();
    let mut child = parent.clone();
    child.key = "aaa_followup".into();
    child.trigger = serde_json::from_value(json!([{"kind":"history","event":EVENT,"outcome":"opens"}])).unwrap();
    dd.history.events.push(child);
    dd.history.order = validation::order(&dd.history).unwrap();
    let mut w = new(d.clone());
    w.state.story2.flags.insert("start_history".into());
    advance(&mut w, 1);
    assert_eq!(w.state.history.chronicle.iter().map(|c| c.event.as_str()).collect::<Vec<_>>(), [EVENT, "aaa_followup"]);
    let dd = Arc::make_mut(&mut d);
    dd.history.events[0].trigger =
        serde_json::from_value(json!([{"kind":"campaign_var","campaign":"test_chain","var":"missing","ge":10}]))
            .unwrap();
    assert!(!validation::validate(dd).is_empty());
}
#[test]
fn wait_conditions_count_from_the_event_window_instead_of_world_day_zero() {
    let mut d = data(json!([]));
    let dd = Arc::make_mut(&mut d);
    let e = &mut dd.history.events[0];
    e.date = None;
    e.latest = Some([1558, 1, 20]);
    e.trigger = serde_json::from_value(json!([{"kind":"wait","days":1}])).unwrap();
    let mut w = new(d);
    advance(&mut w, 1);
    assert!(w.history_outcome(EVENT).is_none());
    advance(&mut w, 1);
    assert_eq!(w.history_outcome(EVENT), Some("opens"));
}

#[test]
fn real_commands_replay_counter_court_backfire_and_new_year_inertia_together() {
    let mut fund = lever("money");
    fund["var"] = "pay".into();
    let mut d = data(json!([fund, lever("arms")]));
    let dd = Arc::make_mut(&mut d);
    dd.scenarios[0].start_date = [1558, 12, 30];
    dd.scenarios[0].control_date = [1558, 12, 30];
    dd.history.campaigns[0].vars[1].drift = vec![(1558, 0), (1560, 0)];
    let e = &mut dd.history.events[0];
    e.date = Some([1559, 1, 3]);
    e.window = Some([[1558, 12, 30], [1559, 1, 3]]);
    e.balance = 0;
    e.counter = Some(Counter { side: "east".into(), pct: 40, max: 3 });
    e.court = Some(Court { var: "court".into(), min: 40, fail: CourtFail::Downgrade });
    e.outcomes[1].when = "1..10".into();
    e.outcomes[1].vars = vec![VarChange { var: "pay".into(), add: -10 }];
    e.outcomes[1].backfire =
        vec![Backfire { from_side: "west".into(), lever: LeverKind::Arms, var: "court".into(), pct: 50 }];
    let mut top = e.outcomes[1].clone();
    top.key = "victory".into();
    top.when = "> 10".into();
    e.outcomes.push(top);
    let mut w = new(d.clone());
    let fleet = w.flagship(O).unwrap();
    let good = w.defs.find_good("grain").unwrap();
    let mut log = Vec::new();
    for cmd in [
        Command::Buy { owner: O, fleet, good, qty: 6, max_total: None },
        command("money", Payload::Money { amount: 200 }),
        delivery("arms", fleet, good, 6, true),
    ] {
        log.push(replay::LogEntry {
            minute: None,
            tick: w.day(),
            seq: log.len() as u64,
            source: replay::Source::Player,
            command: cmd.clone(),
        });
        cmd.apply(&mut w).unwrap();
    }
    let arms = w.history_lever_points(EVENT, "arms");
    advance(&mut w, 2);
    assert_eq!(w.cast_date(), [1559, 1, 1]);
    let mut saved = restored(&w);
    assert_eq!(w.state_hash(), saved.state_hash());
    advance(&mut w, 4);
    advance(&mut saved, 4);
    assert_eq!(w.history_outcome(EVENT), Some("closed"));
    let r = w.state.history.events[EVENT].resolution.as_ref().unwrap();
    assert_eq!(r.counter, 3);
    assert_eq!(r.court_passed, Some(false));
    assert_eq!(r.score, 20 + arms - 3);
    assert_eq!(w.campaign_value("test_chain", "pay"), Some(53));
    assert_eq!(w.campaign_value("test_chain", "court"), Some(arms * 50 / 100));
    let replayed = replay::replay(d, replay::StartParams::new(ScenarioId(0), 42), &log, w.day()).unwrap();
    assert_eq!(w.state_hash(), replayed.state_hash());
    assert_eq!(w.state_hash(), saved.state_hash());
    assert!(w.money_conserved());
}
