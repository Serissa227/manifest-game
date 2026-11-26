//! E58：商会自己的语言、求见、引荐、原件和泄密记账。
#[path = "support/history.rs"]
mod fixture;
use fixture::*;
use manifest_core::{history::*, *};
use serde_json::{Value, json};
use std::sync::Arc;
const NPC: OwnerId = OwnerId::Company(CompanyId(0));
fn data(levers: Value) -> Arc<StaticData> {
    let mut d = defs(levers);
    let dd = Arc::make_mut(&mut d);
    dd.companies.push(defs::CompanyDef {
        key: "envoy_test".into(),
        name: "使者商会".into(),
        persona: "测试商会。".into(),
        home: dd.find_loc("test_west").unwrap(),
        cash: 100_000,
        ships: vec![ShipTypeId(0)],
        preferred: Vec::new(),
        risk: fixed::Fx(1000),
        forecast: Default::default(),
        reaction: Default::default(),
    });
    dd.history.envoys =
        serde_json::from_value(json!([{"company":"envoy_test","contacts":{"classmate_a":60,"mentor":60}}])).unwrap();
    assert!(validation::validate(dd).is_empty(), "{:?}", validation::validate(dd));
    d
}
fn talk() -> Value {
    let mut l = lever("negotiate");
    l["with"] = "mentor".into();
    l["terms"] = json!(["test_terms"]);
    l["language"] = "lang_test".into();
    l["cost"] = 100.into();
    l["introducer"] = "classmate_a".into();
    l["affinity"] = 50.into();
    l
}
fn cmd(kind: &str, payload: Payload) -> Command {
    Command::Contribute { owner: NPC, event: EVENT.into(), lever: kind.into(), payload }
}
fn negotiate() -> Command {
    cmd("negotiate", Payload::Negotiate { term: "test_terms".into() })
}
#[test]
fn npc_cannot_borrow_player_language_audience_or_contacts() {
    let mut w = World::new(data(json!([talk()])), ScenarioId(0), 42).unwrap();
    w.state.items.owners.entry(O).or_default().skill_xp.insert("lang_test".into(), 1);
    Command::RequestAudience { owner: O, person: "mentor".into() }.apply(&mut w).unwrap();
    reject(&mut w, negotiate());
    Command::RequestAudience { owner: NPC, person: "mentor".into() }.apply(&mut w).unwrap();
    reject(&mut w, negotiate());
    w.state.items.owners.entry(NPC).or_default().skill_xp.insert("lang_test".into(), 1);
    let player = w.agent(O).unwrap().cash;
    let npc = w.agent(NPC).unwrap().cash;
    negotiate().apply(&mut w).unwrap();
    assert_eq!(w.agent(O).unwrap().cash, player);
    assert_eq!(w.agent(NPC).unwrap().cash, npc - 100);
    assert_eq!(w.history_owner_points(EVENT, "negotiate", NPC), 6);
    assert_eq!(w.history_owner_points(EVENT, "negotiate", O), 0);
    reject(&mut w, negotiate());
    assert!(w.money_conserved());
    assert_eq!(restored(&w).state_hash(), w.state_hash());
    let mut d = data(json!([talk()]));
    Arc::make_mut(&mut d).history.envoys[0].contacts.clear();
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    w.state.items.owners.entry(NPC).or_default().skill_xp.insert("lang_test".into(), 1);
    let p = w.state.cast.persons.entry("classmate_a".into()).or_default();
    p.met = true;
    p.affection.affinity = 100;
    Command::RequestAudience { owner: NPC, person: "mentor".into() }.apply(&mut w).unwrap();
    reject(&mut w, negotiate());
}

#[test]
fn npc_mission_requires_public_permission_and_its_own_carrier_contact() {
    let mut w = World::new(data(json!([])), ScenarioId(0), 42).unwrap();
    let west = w.defs.find_loc("test_west").unwrap();
    Arc::make_mut(&mut w.defs).ideas.ports.iter_mut().find(|p| p.key == "test_west").unwrap().permission =
        Some("mission_permit".into());
    w.state.items.owners.entry(NPC).or_default().skill_xp.insert("lang_test".into(), 1);
    let c = Command::Propagate { owner: NPC, idea: "sample_school".into(), loc: west, mode: ideas::Mode::Mission };
    reject(&mut w, c.clone());
    w.state.story2.flags.insert("mission_permit".into());
    let mut no_contact = w.clone();
    Arc::make_mut(&mut no_contact.defs).history.envoys[0].contacts.clear();
    no_contact.state.cast.persons.get_mut("mentor").unwrap().affection.affinity = 100;
    reject(&mut no_contact, c.clone());
    let player_cash = w.agent(O).unwrap().cash;
    let company_cash = w.agent(NPC).unwrap().cash;
    c.apply(&mut w).unwrap();
    assert_eq!(w.agent(O).unwrap().cash, player_cash);
    assert_eq!(w.agent(NPC).unwrap().cash, company_cash - 100);
    assert!(w.state.ideas.ports[&west].modes.values().any(|s| s.active.contains_key(&NPC)));
}
#[test]
fn npc_leak_roll_is_once_and_effects_charge_only_the_actor() {
    let mut l = talk();
    l["leak"] = 100.into();
    l["leak_effects"] = json!([{"kind":"cash","value":-50},{"kind":"fame","value":-2},{"kind":"affinity","person":"mentor","value":-5}]);
    let mut w = World::new(data(json!([l])), ScenarioId(0), 42).unwrap();
    w.state.items.owners.entry(NPC).or_default().skill_xp.insert("lang_test".into(), 1);
    Command::RequestAudience { owner: NPC, person: "mentor".into() }.apply(&mut w).unwrap();
    let player = w.agent(O).unwrap().clone();
    let affinity = w.affection("mentor").cloned();
    let npc = w.agent(NPC).unwrap().cash;
    let mut replayed = w.clone();
    let tick = w.day();
    negotiate().validate(&w).unwrap();
    negotiate().validate(&w).unwrap();
    negotiate().apply(&mut w).unwrap();
    assert_eq!(*w.agent(O).unwrap(), player);
    assert_eq!(w.affection("mentor"), affinity.as_ref());
    assert_eq!(w.agent(NPC).unwrap().cash, npc - 150);
    assert_eq!(w.history_affinity(NPC, "mentor"), Some(55));
    assert_eq!(w.history_owner_points(EVENT, "negotiate", NPC), 0);
    reject(&mut w, negotiate());
    advance(&mut w, 2);
    replay::replay_onto(
        &mut replayed,
        &[replay::LogEntry { tick, seq: 0, source: replay::Source::System, command: negotiate(), minute: None }],
        w.day(),
    )
    .unwrap();
    assert_eq!(w.state_hash(), replayed.state_hash());
    assert_eq!(restored(&w).state_hash(), w.state_hash());
    assert!(w.money_conserved());
}
#[test]
fn npc_letter_must_leave_with_its_own_original_and_arrive_in_its_bound_fleet() {
    let mut l = lever("intel");
    l["item"] = "ring".into();
    l["from"] = "test_west".into();
    l["port"] = "test_east".into();
    l["deadline"] = json!([1558, 1, 19]);
    let mut w = World::new(data(json!([l])), ScenarioId(0), 42).unwrap();
    let c = cmd("intel", Payload::Commit {});
    w.grant_item(O, "ring", 1).unwrap();
    reject(&mut w, c.clone());
    w.grant_item(NPC, "ring", 1).unwrap();
    c.apply(&mut w).unwrap();
    assert_eq!(w.item_available(O, "ring"), 1);
    assert_eq!(w.item_available(NPC, "ring"), 0);
    reject(&mut w, c.clone());
    let fleet = w.fleets_of(NPC).next().unwrap().id;
    let east = w.defs.find_loc("test_east").unwrap();
    sail(&mut w, NPC, fleet, east);
    for _ in 0..10 {
        if w.fleet(fleet).unwrap().docked_at() == Some(east) {
            break;
        }
        advance(&mut w, 1);
    }
    c.apply(&mut w).unwrap();
    assert_eq!(w.history_owner_points(EVENT, "intel", NPC), 6);
    reject(&mut w, c);
    assert_eq!(restored(&w).state_hash(), w.state_hash());
}
#[test]
fn history_toggle_is_applied_before_bootstrap_and_preserved_by_replay() {
    let mut d = defs(json!([lever("money")]));
    Arc::make_mut(&mut d).scenarios[0].control_date = [1558, 1, 25];
    for enabled in [false, true] {
        let opening = scenario::NewGameRequest {
            world: "testbed".into(),
            scenario: d.scenarios[0].key.clone(),
            seed: Some(42),
            history: enabled,
            ..Default::default()
        };
        let start =
            replay::StartParams { scenario: ScenarioId(0), seed: 42, opening: Some(opening), bootstrap_days: 24 };
        let mut w = World::from_start(d.clone(), &start, |_| {}).unwrap();
        assert_eq!(w.state.history.enabled, enabled);
        assert_eq!(w.history_outcome(EVENT).is_some(), enabled);
        if !enabled {
            reject(&mut w, command("money", Payload::Money { amount: 100 }));
        }
        advance(&mut w, 3);
        let repeated = replay::replay(d.clone(), start, &[], w.day()).unwrap();
        assert_eq!(w.state_hash(), repeated.state_hash());
        assert_eq!(restored(&w).state_hash(), w.state_hash());
    }
}

#[test]
fn different_protected_people_share_actual_berths_without_blocking_each_other() {
    for full in [true, false] {
        let mut w = World::new(data(json!([])), ScenarioId(0), 42).unwrap();
        let fleet = w.flagship(O).unwrap();
        let free = w.fleet(fleet).unwrap().free_capacity();
        assert!((2..=100).contains(&free));
        let east = w.defs.find_loc("test_east").unwrap();
        let d = Arc::make_mut(&mut w.defs);
        let mut idea = d.ideas.ideas[0].clone();
        idea.key = "other_school".into();
        d.ideas.ideas.push(idea);
        d.cast.persons.iter_mut().find(|p| p.key == "classmate_a").unwrap().schedule = vec![cast::ScheduleDef {
            from: [1553, 1, 1],
            to: None,
            at: "test_west".into(),
            venue: "dock".into(),
            seasons: Vec::new(),
        }];
        let port = d.ideas.ports.iter_mut().find(|p| p.key == "test_east").unwrap();
        let first = port.modes.iter_mut().find(|m| m.mode == ideas::Mode::Protect).unwrap();
        first.berths = if full { free } else { 1 };
        let mut second = first.clone();
        second.idea = "other_school".into();
        second.person = Some("classmate_a".into());
        second.berths = 1;
        port.modes.push(second);
        Command::Propagate { owner: O, idea: "sample_school".into(), loc: east, mode: ideas::Mode::Protect }
            .apply(&mut w)
            .unwrap();
        let second =
            Command::Propagate { owner: O, idea: "other_school".into(), loc: east, mode: ideas::Mode::Protect };
        if full {
            reject(&mut w, second);
        } else {
            second.apply(&mut w).unwrap();
            assert_eq!(w.state.ideas.ports[&east].modes.values().map(|m| m.active.len()).sum::<usize>(), 2);
        }
    }
}
