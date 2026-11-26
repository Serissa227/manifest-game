//! E56：真实资源、六种方式、年度预算与重放。
#[path = "support/history.rs"]
mod fixture;
use fixture::*;
use manifest_core::{ideas::*, *};
use std::sync::Arc;
fn world() -> World {
    fixture::world(serde_json::json!([]))
}
fn west(w: &World) -> LocId {
    w.defs.find_loc("test_west").unwrap()
}
fn cmd(w: &World, mode: Mode) -> Command {
    Command::Propagate { owner: O, idea: "sample_school".into(), loc: west(w), mode }
}
fn ready(w: &mut World) {
    w.state.items.owners.entry(O).or_default().skill_xp.insert("lang_test".into(), 2);
    w.state.cast.persons.entry("mentor".into()).or_default().affection.affinity = 60;
}
#[test]
fn mission_requires_carrier_language_permission_and_continuous_stay() {
    let mut w = world();
    let c = cmd(&w, Mode::Mission);
    reject(&mut w, c.clone());
    ready(&mut w);
    Arc::make_mut(&mut w.defs).ideas.ports[0].permission = Some("idea_permit".into());
    reject(&mut w, c.clone());
    w.state.story2.flags.insert("idea_permit".into());
    let cash = w.agent(O).unwrap().cash;
    c.apply(&mut w).unwrap();
    assert_eq!(cash - w.agent(O).unwrap().cash, 100);
    assert_eq!(w.idea_share(west(&w), "sample_school"), Some(10));
    reject(&mut w, c);
    advance(&mut w, 3);
    assert_eq!(w.idea_share(west(&w), "sample_school"), Some(15));
    let mut w = world();
    ready(&mut w);
    cmd(&w, Mode::Mission).apply(&mut w).unwrap();
    let f = w.flagship(O).unwrap();
    let dest = w.defs.find_loc("test_east").unwrap();
    sail(&mut w, O, f, dest);
    advance(&mut w, 3);
    assert_eq!(w.idea_share(west(&w), "sample_school"), Some(10));
}
#[test]
fn printing_needs_book_translator_and_payment_and_diminishes_cumulatively() {
    let mut w = world();
    ready(&mut w);
    let c = cmd(&w, Mode::Print);
    reject(&mut w, c.clone());
    w.grant_item(O, "reader", 1).unwrap();
    let mut values = Vec::new();
    for _ in 0..3 {
        c.apply(&mut w).unwrap();
        values.push(w.idea_share(west(&w), "sample_school").unwrap());
        advance(&mut w, 1);
    }
    assert_eq!(values, [15, 18, 19]);
    reject(&mut w, c);
    assert_eq!(w.item_available(O, "reader"), 1);
    assert!(w.money_conserved());
}
#[test]
fn school_waits_a_month_and_charity_consumes_goods_and_requires_medicine() {
    let mut w = world();
    ready(&mut w);
    cmd(&w, Mode::School).apply(&mut w).unwrap();
    advance(&mut w, 29);
    assert_eq!(w.idea_share(west(&w), "sample_school"), Some(10));
    advance(&mut w, 1);
    assert_eq!(w.idea_share(west(&w), "sample_school"), Some(15));
    let c = cmd(&w, Mode::Charity);
    reject(&mut w, c.clone());
    let (f, g) = buy(&mut w, 1);
    w.state.items.owners.get_mut(&O).unwrap().skill_xp.insert("lang_test".into(), 1);
    reject(&mut w, c.clone());
    ready(&mut w);
    c.apply(&mut w).unwrap();
    assert_eq!(w.holder_qty(O, manifest_core::warehouse::Holder::Fleet(f), g), 0);
    assert!(w.money_conserved());
}
#[test]
fn court_needs_current_audience_and_affinity() {
    let mut w = world();
    ready(&mut w);
    let c = cmd(&w, Mode::Court);
    reject(&mut w, c.clone());
    Command::RequestAudience { owner: O, person: "mentor".into() }.apply(&mut w).unwrap();
    w.state.cast.persons.get_mut("mentor").unwrap().affection.affinity = 49;
    reject(&mut w, c.clone());
    ready(&mut w);
    c.apply(&mut w).unwrap();
    advance(&mut w, 1);
    reject(&mut w, c);
}
#[test]
fn protection_requires_actual_voyage_and_cannot_rescue_the_same_person_twice() {
    let mut w = world();
    let east = w.defs.find_loc("test_east").unwrap();
    let c = Command::Propagate { owner: O, idea: "sample_school".into(), loc: east, mode: Mode::Protect };
    c.apply(&mut w).unwrap();
    assert_eq!(w.idea_share(east, "sample_school"), Some(0));
    assert_eq!(w.state.ideas.suspicion[&O][&w.location_faction(west(&w))], 5);
    advance(&mut w, 2);
    assert!(!w.state.ideas.rescued.contains("mentor"));
    let f = w.flagship(O).unwrap();
    sail(&mut w, O, f, east);
    for _ in 0..12 {
        if w.fleet(f).unwrap().docked_at() == Some(east) {
            break;
        }
        advance(&mut w, 1);
    }
    assert!(w.state.ideas.rescued.contains("mentor"));
    assert_eq!(w.person_place("mentor").unwrap().loc, east);
    assert_eq!(w.idea_share(east, "sample_school"), Some(7));
    reject(&mut w, c);
    assert_eq!(restored(&w).state_hash(), w.state_hash());
}
#[test]
fn annual_cap_is_shared_and_rollover_applies_inertia_once() {
    let mut w = world();
    ready(&mut w);
    w.grant_item(O, "reader", 1).unwrap();
    Arc::make_mut(&mut w.defs).ideas.ports[0].annual_cap = 6;
    cmd(&w, Mode::Print).apply(&mut w).unwrap();
    Command::RequestAudience { owner: O, person: "mentor".into() }.apply(&mut w).unwrap();
    cmd(&w, Mode::Court).apply(&mut w).unwrap();
    assert_eq!(w.idea_delta_year(west(&w), "sample_school"), 6);
    let c = cmd(&w, Mode::School);
    reject(&mut w, c);
    advance(&mut w, 365);
    assert_eq!(w.idea_share(west(&w), "sample_school"), Some(15));
    assert_eq!(w.idea_delta_year(west(&w), "sample_school"), 0);
    cmd(&w, Mode::Print).apply(&mut w).unwrap();
    assert_eq!(w.idea_share(west(&w), "sample_school"), Some(20));
    assert_eq!(restored(&w).state_hash(), w.state_hash());
}
#[test]
fn propagation_and_suspicion_replay_and_corrupt_snapshots_are_rejected() {
    let mut w = world();
    ready(&mut w);
    w.grant_item(O, "reader", 1).unwrap();
    let d = Arc::make_mut(&mut w.defs);
    let p = &mut d.ideas.ports[0];
    p.forbidden.push("sample_school".into());
    p.modes[1].detection = 100;
    p.modes[1].suspicion = 7;
    let mut replayed = w.clone();
    let start = w.day();
    let c = cmd(&w, Mode::Print);
    c.validate(&w).unwrap();
    c.validate(&w).unwrap();
    c.apply(&mut w).unwrap();
    let mut saved = restored(&w);
    advance(&mut w, 5);
    advance(&mut saved, 5);
    replay::replay_onto(
        &mut replayed,
        &[replay::LogEntry { tick: start, seq: 0, source: replay::Source::Player, command: c, minute: None }],
        w.day(),
    )
    .unwrap();
    assert_eq!(saved.state_hash(), w.state_hash());
    assert_eq!(replayed.state_hash(), w.state_hash());
    let mut bad = w.state.clone();
    bad.ideas.ports.get_mut(&west(&w)).unwrap().gained.insert("sample_school".into(), 101);
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
}
#[test]
fn definitions_reject_free_points_bad_references_and_missing_requirements() {
    let w = world();
    assert!(validation::validate(&w.defs).is_empty());
    for change in 0..5 {
        let mut d = w.defs.clone();
        let d = Arc::make_mut(&mut d);
        let m = &mut d.ideas.ports[0].modes[0];
        match change {
            0 => m.cost = 0,
            1 => m.days = 0,
            2 => m.idea = "absent".into(),
            3 => m.cap = 101,
            _ => m.points = -1,
        }
        assert!(!validation::validate(d).is_empty());
    }
}
#[test]
fn classic_omits_ideas_and_old_snapshot_defaults_are_empty() {
    let d = manifest_data::load_shared(&manifest_data::find_data_dir().unwrap()).unwrap();
    let w = World::new(d, ScenarioId(0), 42).unwrap();
    let json = serde_json::to_value(&w.state).unwrap();
    assert!(json.get("ideas").is_none());
    assert_eq!(serde_json::from_value::<world::WorldState>(json).unwrap().ideas, IdeasState::default());
    assert_eq!(rng::Domain::Ideas as u32, 29);
}
#[test]
fn propagation_levers_use_the_same_paid_action_and_completed_points() {
    let mut l = lever("propagate");
    l["idea"] = "sample_school".into();
    l["mode"] = "mission".into();
    let mut w = fixture::world(serde_json::json!([l]));
    ready(&mut w);
    command("propagate", history::Payload::Commit {}).apply(&mut w).unwrap();
    assert_eq!(w.history_lever_points(EVENT, "propagate"), 0);
    advance(&mut w, 3);
    assert_eq!(w.history_lever_points(EVENT, "propagate"), 5);
}

#[test]
fn fractional_hostility_is_accumulated_without_losing_paid_attempts() {
    let mut w = world();
    ready(&mut w);
    w.grant_item(O, "reader", 1).unwrap();
    Arc::make_mut(&mut w.defs).ideas.ports[0].modes[1].points = 1;
    let c = cmd(&w, Mode::Print);
    let cash = w.agent(O).unwrap().cash;
    c.apply(&mut w).unwrap();
    assert_eq!(cash - w.agent(O).unwrap().cash, 100);
    assert_eq!(w.idea_share(west(&w), "sample_school"), Some(10));
    advance(&mut w, 1);
    c.apply(&mut w).unwrap();
    assert_eq!(w.idea_share(west(&w), "sample_school"), Some(11));
}
