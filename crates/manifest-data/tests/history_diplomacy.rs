//! E54：求见门槛、条款、实物书信、时限和不可重掷的裁定。
#[path = "support/history.rs"]
mod fixture;
use fixture::*;
use manifest_core::{history::*, *};
use serde_json::{Value, json};
use std::sync::Arc;
fn talk() -> Value {
    let mut l = lever("negotiate");
    l["with"] = "mentor".into();
    l["terms"] = json!(["test_terms"]);
    l["language"] = "lang_test".into();
    l["cost"] = 100.into();
    l
}
fn diplomatic(levers: Value) -> World {
    let mut d = defs(levers);
    Arc::make_mut(&mut d).story2.skills.insert("lang_test".into());
    assert!(validation::validate(&d).is_empty(), "{:?}", validation::validate(&d));
    World::new(d, ScenarioId(0), 42).unwrap()
}
fn language(w: &mut World) {
    w.state.items.owners.entry(O).or_default().skill_xp.insert("lang_test".into(), 1);
}
fn audience(w: &mut World) {
    Command::RequestAudience { owner: O, person: "mentor".into() }.apply(w).unwrap();
}
fn negotiate() -> Command {
    command("negotiate", Payload::Negotiate { term: "test_terms".into() })
}
fn letter() -> Value {
    let mut l = lever("intel");
    l["item"] = "ring".into();
    l["from"] = "test_west".into();
    l["port"] = "test_east".into();
    l["deadline"] = json!([1558, 1, 10]);
    l
}
#[test]
fn negotiation_requires_real_audience_language_both_reputations_and_introduction() {
    let mut l = talk();
    l["introducer"] = "classmate_a".into();
    l["affinity"] = 50.into();
    let mut w = diplomatic(json!([l]));
    reject(&mut w, negotiate());
    audience(&mut w);
    reject(&mut w, negotiate());
    language(&mut w);
    reject(&mut w, negotiate());
    let p = w.state.cast.persons.entry("classmate_a".into()).or_default();
    p.met = true;
    p.affection.affinity = 50;
    let f = w.defs.find_faction("cuilan").unwrap();
    w.agent_mut(O).unwrap().reputation.insert(f, -1);
    reject(&mut w, negotiate());
    w.agent_mut(O).unwrap().reputation.insert(f, 0);
    reject(&mut w, command("negotiate", Payload::Negotiate { term: "invented".into() }));
    let cash = w.agent(O).unwrap().cash;
    negotiate().apply(&mut w).unwrap();
    assert_eq!(cash - w.agent(O).unwrap().cash, 100);
    assert_eq!(w.history_lever_points(EVENT, "negotiate"), 6);
    reject(&mut w, negotiate());
    assert!(w.money_conserved());
    let mut d = defs(json!([talk()]));
    let dd = Arc::make_mut(&mut d);
    dd.story2.skills.insert("lang_test".into());
    dd.history.events[0].sides[1].faction = dd.factions[1].key.clone();
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    audience(&mut w);
    language(&mut w);
    w.agent_mut(O).unwrap().reputation.insert(FactionId(1), -1);
    reject(&mut w, negotiate());
}
#[test]
fn old_audience_or_remote_person_cannot_authorize_a_new_negotiation() {
    let mut w = diplomatic(json!([talk()]));
    audience(&mut w);
    language(&mut w);
    advance(&mut w, 1);
    reject(&mut w, negotiate());
    audience(&mut w);
    let fleet = w.flagship(O).unwrap();
    let east = w.defs.find_loc("test_east").unwrap();
    sail(&mut w, O, fleet, east);
    reject(&mut w, negotiate());
}
#[test]
fn a_leak_is_recorded_once_paid_once_and_survives_reload_and_replay() {
    let mut l = talk();
    l["leak"] = 100.into();
    l["leak_effects"] = json!([{"kind":"flag","flag":"test_leaked"}]);
    let mut w = diplomatic(json!([l]));
    audience(&mut w);
    language(&mut w);
    let mut replayed = w.clone();
    let start = w.day();
    let cash = w.agent(O).unwrap().cash;
    negotiate().validate(&w).unwrap();
    negotiate().validate(&w).unwrap();
    negotiate().apply(&mut w).unwrap();
    assert_eq!(cash - w.agent(O).unwrap().cash, 100);
    assert!(w.state.story2.flags.contains("test_leaked"));
    assert_eq!(w.history_lever_points(EVENT, "negotiate"), 0);
    reject(&mut w, negotiate());
    let mut saved = restored(&w);
    advance(&mut w, 2);
    advance(&mut saved, 2);
    replay::replay_onto(
        &mut replayed,
        &[replay::LogEntry { minute: None, tick: start, seq: 0, source: replay::Source::Player, command: negotiate() }],
        w.day(),
    )
    .unwrap();
    assert_eq!(w.state_hash(), saved.state_hash());
    assert_eq!(w.state_hash(), replayed.state_hash());
    let c = &w.state.history.events[EVENT].contributions["negotiate"];
    assert_eq!(c.attempts, 1);
    assert!(c.diplomacy[&O].leaked);
}
#[test]
fn intel_requires_the_original_item_and_bound_fleet_to_reach_the_destination() {
    let mut l = letter();
    l["cost"] = 100.into();
    let mut w = diplomatic(json!([l]));
    let cmd = command("intel", Payload::Commit {});
    reject(&mut w, cmd.clone());
    w.grant_item(O, "ring", 1).unwrap();
    let cash = w.agent(O).unwrap().cash;
    cmd.apply(&mut w).unwrap();
    assert_eq!(cash - w.agent(O).unwrap().cash, 100);
    assert_eq!(w.item_available(O, "ring"), 0);
    reject(&mut w, cmd.clone());
    let fleet = w.flagship(O).unwrap();
    let east = w.defs.find_loc("test_east").unwrap();
    sail(&mut w, O, fleet, east);
    let mut saved = restored(&w);
    for _ in 0..8 {
        if w.fleet(fleet).unwrap().docked_at() == Some(east) {
            break;
        }
        advance(&mut w, 1);
        advance(&mut saved, 1);
    }
    assert_eq!(w.fleet(fleet).unwrap().docked_at(), Some(east));
    let cash = w.agent(O).unwrap().cash;
    cmd.apply(&mut w).unwrap();
    assert_eq!(cash, w.agent(O).unwrap().cash);
    cmd.apply(&mut saved).unwrap();
    assert_eq!(w.state_hash(), saved.state_hash());
    assert_eq!(w.history_lever_points(EVENT, "intel"), 6);
    reject(&mut w, cmd);
    assert!(w.state.history.events[EVENT].contributions["intel"].shipments[&O].delivered.is_some());
}
#[test]
fn stale_and_false_letters_cannot_award_points() {
    let mut l = letter();
    l["deadline"] = json!([1558, 1, 1]);
    let mut w = diplomatic(json!([l]));
    w.grant_item(O, "ring", 1).unwrap();
    command("intel", Payload::Commit {}).apply(&mut w).unwrap();
    advance(&mut w, 1);
    reject(&mut w, command("intel", Payload::Commit {}));
    let mut l = letter();
    l["reliability"] = 0.into();
    l["false_effects"] = json!([{"kind":"flag","flag":"test_false"}]);
    let mut w = diplomatic(json!([l]));
    w.grant_item(O, "ring", 1).unwrap();
    command("intel", Payload::Commit {}).apply(&mut w).unwrap();
    let fleet = w.flagship(O).unwrap();
    let east = w.defs.find_loc("test_east").unwrap();
    sail(&mut w, O, fleet, east);
    for _ in 0..8 {
        if w.fleet(fleet).unwrap().docked_at() == Some(east) {
            break;
        }
        advance(&mut w, 1);
    }
    command("intel", Payload::Commit {}).apply(&mut w).unwrap();
    assert_eq!(w.history_lever_points(EVENT, "intel"), 0);
    assert!(w.state.story2.flags.contains("test_false"));
    reject(&mut w, command("intel", Payload::Commit {}));
}
#[test]
fn bribes_require_audience_and_resources_and_failed_effects_roll_back_everything() {
    let mut l = lever("bribe");
    l["with"] = "mentor".into();
    l["cost"] = 200.into();
    let mut w = diplomatic(json!([l]));
    reject(&mut w, command("bribe", Payload::Commit {}));
    audience(&mut w);
    let cash = w.agent(O).unwrap().cash;
    command("bribe", Payload::Commit {}).apply(&mut w).unwrap();
    assert_eq!(cash - w.agent(O).unwrap().cash, 200);
    reject(&mut w, command("bribe", Payload::Commit {}));
    let mut w = diplomatic(json!([talk()]));
    language(&mut w);
    audience(&mut w);
    let dd = Arc::make_mut(&mut w.defs);
    let l = &mut dd.history.events[0].levers[0];
    l.leak = 100;
    l.leak_effects =
        serde_json::from_value(json!([{"kind":"flag","flag":"partial_leak"},{"kind":"item","item":"absent","qty":1}]))
            .unwrap();
    reject(&mut w, negotiate());
    assert!(!w.state.story2.flags.contains("partial_leak"));
}
#[test]
fn a_hired_interpreter_satisfies_language_and_corrupt_attempts_are_rejected() {
    let mut d = defs(json!([talk()]));
    let dd = Arc::make_mut(&mut d);
    dd.story2.skills.insert("lang_test".into());
    let mate = dd.find_mate("sailor").unwrap();
    dd.mates[mate.idx()].abilities.insert("lang_test".into(), 1);
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    audience(&mut w);
    reject(&mut w, negotiate());
    w.state.mates.get_mut(&mate).unwrap().owner = Some(O);
    negotiate().apply(&mut w).unwrap();
    assert_eq!(w.history_lever_points(EVENT, "negotiate"), 6);
    assert_eq!(restored(&w).state_hash(), w.state_hash());
    let mut bad = w.state.clone();
    bad.history.events.get_mut(EVENT).unwrap().contributions.get_mut("negotiate").unwrap().attempts = 0;
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
}
