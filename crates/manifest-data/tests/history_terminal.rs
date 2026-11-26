//! 条件终局、持续时间与分期思想门；所有状态变化走现有贡献入口。
#[path = "support/history.rs"]
mod fixture;
use fixture::*;
use manifest_core::{history::*, *};
use serde_json::json;
use std::sync::Arc;

fn data() -> Arc<StaticData> {
    let mut d = defs(json!([lever("money")]));
    let dd = Arc::make_mut(&mut d);
    dd.history.campaigns = serde_json::from_value(json!([{
        "key":"terminal_chain", "name":"终局测试", "inertia":0, "ending_event":"final",
        "vars":[{"key":"grain","name":"粮食","start":0}]
    }]))
    .expect("战役");
    let opening = &mut dd.history.events[0];
    opening.campaign = Some("terminal_chain".into());
    opening.outcomes[1].vars = vec![VarChange { var: "grain".into(), add: 70 }];
    let mut last = opening.clone();
    last.key = "final".into();
    last.date = None;
    last.latest = Some([1558, 2, 20]);
    last.window = Some([[1558, 1, 1], [1558, 2, 20]]);
    last.levers.clear();
    for outcome in &mut last.outcomes {
        outcome.vars.clear();
    }
    last.trigger = serde_json::from_value(json!([{"kind":"any","conditions":[
        {"kind":"campaign_var_held","campaign":"terminal_chain","var":"grain","ge":70,"days":3},
        {"kind":"flag","flag":"immediate_final"}
    ]}]))
    .expect("触发");
    last.outcome_rules = serde_json::from_value(json!([{"outcome":"closed","when":[
        {"kind":"history","event":EVENT,"outcome":"closed"},
        {"kind":"campaign_var","campaign":"terminal_chain","var":"grain","ge":70}
    ]}]))
    .expect("终局");
    let mut supply = opening.clone();
    supply.key = "supply".into();
    supply.date = Some([1558, 3, 1]);
    supply.window = Some([[1558, 1, 1], [1558, 3, 1]]);
    supply.levers = serde_json::from_value(json!([
        {"key":"drain","kind":"money","side":"west","label":"减少","port":"test_west","value_per_point":1,
            "max_points":10,"var":"grain","var_per_point":-1},
        {"key":"restore","kind":"money","side":"west","label":"恢复","port":"test_west","value_per_point":1,
            "max_points":10,"var":"grain","var_per_point":1}
    ]))
    .expect("物资");
    dd.history.events.extend([last, supply]);
    dd.history.order = validation::order(&dd.history).expect("依赖");
    assert!(validation::validate(dd).is_empty(), "{:?}", validation::validate(dd));
    d
}
fn new() -> World {
    World::new(data(), ScenarioId(0), 42).expect("世界")
}
fn supply(w: &mut World, lever: &str) {
    Command::Contribute {
        owner: O,
        event: "supply".into(),
        lever: lever.into(),
        payload: Payload::Money { amount: 1 },
    }
    .apply(w)
    .expect("物资命令");
}

#[test]
fn condition_terminal_preserves_default_without_intervention() {
    let mut w = new();
    advance(&mut w, 52);
    assert_eq!(w.history_outcome("final"), Some("opens"));
    assert_eq!(w.history_deviation(), 0);
    assert!(w.state.history.campaigns["terminal_chain"].held_since.is_empty());
    assert_eq!(restored(&w).state_hash(), w.state_hash());
}

#[test]
fn event_only_rewrite_reaches_terminal_without_changing_campaign_variables() {
    let mut d = data();
    let dd = Arc::make_mut(&mut d);
    dd.history.events[0].outcomes[1].vars.clear();
    let last = &mut dd.history.events[1];
    last.trigger.clear();
    last.outcome_rules[0].when = serde_json::from_value(json!([
        {"kind":"history","event":EVENT,"outcome":"closed"}
    ]))
    .expect("只依赖事件结果");
    let mut w = World::new(d, ScenarioId(0), 42).expect("世界");
    command("money", Payload::Money { amount: 100 }).apply(&mut w).expect("改写前置事件");
    advance(&mut w, 52);
    assert!(!w.state.history.campaigns["terminal_chain"].influenced);
    assert_eq!(w.history_outcome(EVENT), Some("closed"));
    assert_eq!(w.history_outcome("final"), Some("closed"));
    assert_eq!(restored(&w).state_hash(), w.state_hash());
}

#[test]
fn held_condition_resets_on_same_day_dip_and_survives_save() {
    let mut w = new();
    command("money", Payload::Money { amount: 100 }).apply(&mut w).expect("改变前置事件");
    advance(&mut w, 22);
    assert_eq!(w.history_outcome(EVENT), Some("closed"));
    assert_eq!(w.history_outcome("final"), None);
    supply(&mut w, "drain");
    supply(&mut w, "restore");
    let restarted = w.day();
    assert_eq!(
        w.state.history.campaigns["terminal_chain"].held_since.values().copied().collect::<Vec<_>>(),
        [restarted]
    );
    let mut saved = restored(&w);
    advance(&mut w, 3);
    advance(&mut saved, 3);
    assert_eq!(w.history_outcome("final"), None);
    advance(&mut w, 1);
    advance(&mut saved, 1);
    assert_eq!(w.history_outcome("final"), Some("closed"));
    assert_eq!(w.state.history.events["final"].resolved_day, Some(restarted + 3));
    assert_eq!(w.state_hash(), saved.state_hash());
    advance(&mut w, 1);
    assert!(w.state.history.events["supply"].closed, "提前终局后不再发生后续战事");
}

#[test]
fn held_condition_snapshot_preserves_midnight_before_annual_drift() {
    for (before, after) in [(70, 0), (0, 70)] {
        let mut d = data();
        let var = &mut Arc::make_mut(&mut d).history.campaigns[0].vars[0];
        var.start = before;
        var.drift = vec![(1558, before), (1559, after)];
        let mut w = World::new(d, ScenarioId(0), 42).expect("世界");
        advance(&mut w, 365);
        assert_eq!(w.cast_date(), [1559, 1, 1]);
        assert_eq!(w.state.history.campaigns["terminal_chain"].values["grain"], before);
        assert_eq!(w.campaign_value("terminal_chain", "grain"), Some(after));
        let mut saved = restored(&w);
        assert_eq!(w.state_hash(), saved.state_hash(), "跨年午夜读档不能提前增删持续记录");
        advance(&mut w, 1);
        advance(&mut saved, 1);
        assert_eq!(w.state_hash(), saved.state_hash());
        assert_eq!(w.state.history.campaigns["terminal_chain"].held_since.is_empty(), after < 70);
    }
}

#[test]
fn old_snapshot_does_not_invent_a_held_interval() {
    let mut w = new();
    command("money", Payload::Money { amount: 100 }).apply(&mut w).expect("改变前置事件");
    advance(&mut w, 22);
    let mut value = serde_json::to_value(&w.state).expect("存档");
    value["history"]["campaigns"]["terminal_chain"].as_object_mut().expect("战役").remove("held_since");
    let state = serde_json::from_value(value).expect("旧字段缺省");
    let mut loaded = World::from_snapshot(w.defs.clone(), state).expect("兼容旧存档");
    advance(&mut loaded, 1);
    assert_eq!(loaded.history_outcome("final"), None);
    assert_eq!(
        loaded.state.history.campaigns["terminal_chain"].held_since.values().copied().collect::<Vec<_>>(),
        [w.day()]
    );
    let state = &mut loaded.state.history.campaigns.get_mut("terminal_chain").expect("战役").held_since;
    state.insert("unknown:70:_".into(), 0);
    assert!(World::from_snapshot(loaded.defs.clone(), loaded.state.clone()).is_err());
}

#[test]
fn nested_conditions_cannot_hide_bad_references_or_cycles() {
    let mut d = data();
    let dd = Arc::make_mut(&mut d);
    dd.history.events[0].trigger = serde_json::from_value(json!([{"kind":"any","conditions":[
        {"kind":"history","event":"final"}
    ]}]))
    .expect("条件");
    assert!(validation::order(&dd.history).is_none());
    dd.history.events[0].trigger = serde_json::from_value(json!([{"kind":"any","conditions":[
        {"kind":"campaign_var_held","campaign":"terminal_chain","var":"missing","ge":70,"days":3}
    ]}]))
    .expect("条件");
    assert!(!validation::validate(dd).is_empty());
    dd.history.events[0].trigger.clear();
    dd.history.events[1].outcome_rules[0].outcome = "missing".into();
    assert!(!validation::validate(dd).is_empty());
}

#[test]
fn future_gate_preserves_prior_baseline_and_clamps_only_when_active() {
    let mut d = data();
    let dd = Arc::make_mut(&mut d);
    let var = &mut dd.history.campaigns[0].vars[0];
    var.start = 35;
    var.drift = vec![(1558, 35), (1559, 20)];
    var.idea = Some("sample_school".into());
    var.court = Some("council".into());
    var.gates = serde_json::from_value(json!([{
        "event":EVENT,"outcome":"closed","cap":25,"from":[1559,1,1]
    }]))
    .expect("分期门");
    dd.history.campaigns[0].outlooks = serde_json::from_value(json!([{
        "key":"council","name":"测试宫廷","historical":"historical","threshold":60,"priority":["grain"]
    }]))
    .expect("宫廷");
    dd.history.campaigns[0].endings = ["opens", "closed"]
        .iter()
        .flat_map(|outcome| {
            ["historical", "sample_school"].iter().map(move |idea| Ending {
                key: format!("{outcome}_{idea}"),
                outcome: (*outcome).into(),
                court: "council".into(),
                outlook: (*idea).into(),
                text: "测试结局。".into(),
                effects: Vec::new(),
            })
        })
        .collect();
    assert!(validation::validate(dd).is_empty(), "{:?}", validation::validate(dd));
    let mut w = World::new(d.clone(), ScenarioId(0), 42).expect("世界");
    assert_eq!(w.campaign_value("terminal_chain", "grain"), Some(35));
    assert_eq!(w.campaign_cap("terminal_chain", "grain"), None);
    advance(&mut w, 365);
    assert_eq!(w.campaign_cap("terminal_chain", "grain"), Some(25));
    assert_eq!(w.campaign_value("terminal_chain", "grain"), Some(20));
    assert_eq!(restored(&w).state_hash(), w.state_hash(), "生效日午夜的合法快照");
    Arc::make_mut(&mut d).history.campaigns[0].vars[0].gates[0].from = None;
    assert!(!validation::validate(&d).is_empty(), "移除生效日期后，原轨迹超过上限必须报错");
}
