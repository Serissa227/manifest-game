//! E53：真实资源与账本、连续行动、边界和重放。
#[path = "support/history.rs"]
mod fixture;
use fixture::*;
use manifest_core::{history::*, *};
use serde_json::json;
use std::sync::Arc;

#[test]
fn contribution_payload_matches_i7_exactly() {
    for payload in [
        json!({"Deliver":{"fleet":1,"goods":[[0,2]],"donate":true}}),
        json!({"Money":{"amount":100}}),
        json!({"Negotiate":{"term":"test"}}),
        json!({"Commit":{}}),
    ] {
        let input = json!({"Contribute":{"owner":"player","event":EVENT,"lever":"test","payload":payload}});
        let c: Command = serde_json::from_value(input.clone()).unwrap();
        assert_eq!(serde_json::to_value(c).unwrap(), input);
    }
    assert!(serde_json::from_value::<Payload>(json!({"Commit":{"free":true}})).is_err());
}
#[test]
fn delivered_cargo_is_consumed_once_and_failed_batches_are_atomic() {
    let mut w = world(json!([lever("deliver")]));
    let (fleet, good) = buy(&mut w, 5);
    let mut bad =
        command("deliver", Payload::Deliver { fleet, goods: vec![(good, 2), (GoodId(999), 1)], donate: true });
    reject(&mut w, bad.clone());
    bad = command("deliver", Payload::Deliver { fleet, goods: vec![(good, 1), (good, 1)], donate: true });
    reject(&mut w, bad);
    let cash = w.agent(O).unwrap().cash;
    let cmd = delivery("deliver", fleet, good, 5, true);
    let before = w.state.clone();
    cmd.validate(&w).unwrap();
    assert_eq!(before, w.state);
    cmd.apply(&mut w).unwrap();
    assert_eq!(w.holder_qty(O, warehouse::Holder::Fleet(fleet), good), 0);
    assert_eq!(w.agent(O).unwrap().cash, cash);
    assert!(w.history_lever_points(EVENT, "deliver") > 0);
    reject(&mut w, cmd);
    testkit::check_invariants(&w).unwrap();
}
#[test]
fn arms_cannot_be_sold_and_then_reused_and_sales_discount_is_real() {
    let mut w = world(json!([lever("arms")]));
    let (fleet, good) = buy(&mut w, 5);
    Command::Sell { owner: O, fleet, good, qty: 5, min_total: None }.apply(&mut w).unwrap();
    reject(&mut w, delivery("arms", fleet, good, 5, true));
    buy(&mut w, 4);
    let cash = w.agent(O).unwrap().cash;
    delivery("arms", fleet, good, 4, false).apply(&mut w).unwrap();
    assert!(w.agent(O).unwrap().cash > cash);
    let value = w.defs.good(good).base_price * 4 * 50;
    assert_eq!(w.state.history.events[EVENT].contributions["arms"].value, value);
    assert_eq!(w.history_lever_points(EVENT, "arms"), w.history_lever_base_points(EVENT, "arms") / 3);
    reject(&mut w, delivery("arms", fleet, good, 1, true));
    testkit::check_invariants(&w).unwrap();
}
#[test]
fn money_is_conserved_caps_and_diminishing_returns_cannot_be_split() {
    let mut d = defs(json!([lever("money")]));
    Arc::make_mut(&mut d).history.events[0].diminish = 50;
    let mut one = World::new(d, ScenarioId(0), 42).unwrap();
    let mut split = one.clone();
    command("money", Payload::Money { amount: 200 }).apply(&mut one).unwrap();
    for _ in 0..20 {
        command("money", Payload::Money { amount: 10 }).apply(&mut split).unwrap();
    }
    assert_eq!(one.history_lever_points(EVENT, "money"), 15);
    assert_eq!(one.history_lever_points(EVENT, "money"), split.history_lever_points(EVENT, "money"));
    assert_eq!(one.agent(O).unwrap().cash, split.agent(O).unwrap().cash);
    assert_eq!(one.history_owner_points(EVENT, "money", O), 15);
    command("money", Payload::Money { amount: 100 }).apply(&mut one).unwrap();
    assert_eq!(one.history_lever_points(EVENT, "money"), 20);
    reject(&mut one, command("money", Payload::Money { amount: 1 }));
    assert!(one.money_conserved());
    testkit::check_invariants(&one).unwrap();
}
#[test]
fn training_requires_continuous_presence_and_upgrades_existing_arms_once() {
    let mut arms = lever("arms");
    arms["train"] = "train".into();
    let mut train = lever("train");
    train["trainer"] = "mentor".into();
    train["days"] = 3.into();
    train["cost"] = 100.into();
    let mut w = world(json!([arms, train]));
    let (fleet, good) = buy(&mut w, 8);
    delivery("arms", fleet, good, 8, true).apply(&mut w).unwrap();
    let untrained = w.history_lever_points(EVENT, "arms");
    let cost = w.agent(O).unwrap().cash;
    command("train", Payload::Commit {}).apply(&mut w).unwrap();
    assert_eq!(cost - w.agent(O).unwrap().cash, 100);
    reject(&mut w, command("train", Payload::Commit {}));
    advance(&mut w, 2);
    assert_eq!(w.history_lever_points(EVENT, "train"), 0);
    let mut saved = restored(&w);
    advance(&mut w, 1);
    advance(&mut saved, 1);
    assert_eq!(w.state_hash(), saved.state_hash());
    assert_eq!(w.history_lever_points(EVENT, "train"), 6);
    assert!(w.history_lever_points(EVENT, "arms") >= untrained * 3);
    reject(&mut w, command("train", Payload::Commit {}));
    assert!(w.money_conserved());
}
#[test]
fn leaving_the_training_port_breaks_the_action() {
    let mut train = lever("train");
    train["trainer"] = "mentor".into();
    train["days"] = 3.into();
    let mut w = world(json!([train]));
    command("train", Payload::Commit {}).apply(&mut w).unwrap();
    advance(&mut w, 1);
    let fleet = w.flagship(O).unwrap();
    let east = w.defs.find_loc("test_east").unwrap();
    sail(&mut w, O, fleet, east);
    advance(&mut w, 4);
    assert_eq!(w.history_lever_points(EVENT, "train"), 0);
    assert!(!w.state.history.events[EVENT].contributions["train"].activities[&O].valid);
}
#[test]
fn relief_and_smuggling_use_real_cargo_and_seizure_is_not_repeatable() {
    let mut arms = lever("arms");
    arms["smuggle"] = true.into();
    arms["seizure"] = 100.into();
    arms["seized_effects"] = json!([{"kind":"flag","flag":"history_seized"}]);
    let mut w = world(json!([arms, lever("relief")]));
    let (fleet, good) = buy(&mut w, 6);
    delivery("relief", fleet, good, 2, true).apply(&mut w).unwrap();
    assert!(w.history_lever_points(EVENT, "relief") > 0);
    delivery("arms", fleet, good, 2, true).apply(&mut w).unwrap();
    assert_eq!(w.history_lever_points(EVENT, "arms"), 0);
    assert!(w.state.story2.flags.contains("history_seized"));
    assert_eq!(w.holder_qty(O, warehouse::Holder::Fleet(fleet), good), 2);
    reject(&mut w, delivery("arms", fleet, good, 2, true));
    assert_eq!(restored(&w).state_hash(), w.state_hash());
}
#[test]
fn contribution_window_ownership_and_invalid_definitions_are_enforced() {
    let mut w = world(json!([lever("money")]));
    reject(&mut w, command("money", Payload::Money { amount: -1 }));
    reject(&mut w, command("money", Payload::Money { amount: i64::MAX }));
    reject(&mut w, command("money", Payload::Commit {}));
    w.state.history.enabled = false;
    reject(&mut w, command("money", Payload::Money { amount: 10 }));
    w.state.history.enabled = true;
    advance(&mut w, 20);
    reject(&mut w, command("money", Payload::Money { amount: 10 }));
    for (key, value) in [("max_points", json!(0)), ("port", json!("absent")), ("value_per_point", json!(0))] {
        let mut bad = lever("money");
        bad[key] = value;
        assert!(!validation::validate(&defs(json!([bad]))).is_empty());
    }
}
#[test]
fn accepted_material_commands_replay_and_corrupt_contributions_are_rejected() {
    let d = defs(json!([lever("money")]));
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    let c = command("money", Payload::Money { amount: 200 });
    let log = vec![replay::LogEntry {
        minute: None,
        tick: w.day(),
        seq: 0,
        source: replay::Source::Player,
        command: c.clone(),
    }];
    c.apply(&mut w).unwrap();
    advance(&mut w, 21);
    let replayed = replay::replay(d.clone(), replay::StartParams::new(ScenarioId(0), 42), &log, w.day()).unwrap();
    assert_eq!(w.state_hash(), replayed.state_hash());
    assert_eq!(w.history_outcome(EVENT), Some("closed"));
    let mut state = w.state.clone();
    state.history.events.get_mut(EVENT).unwrap().contributions.get_mut("money").unwrap().value += 1;
    assert!(World::from_snapshot(d, state).is_err());
}
#[test]
fn escort_requires_a_real_convoy_voyage_and_cannot_complete_by_waiting_in_port() {
    let mut l = lever("escort");
    l["from"] = "test_west".into();
    l["port"] = "test_east".into();
    l["company"] = "test_convoy".into();
    l["days"] = 1.into();
    let mut d = defs(json!([l]));
    let dd = Arc::make_mut(&mut d);
    let mut company = testkit::tiny_defs().companies[0].clone();
    company.key = "test_convoy".into();
    company.home = LocId(0);
    company.ships = dd.scenarios[0].ships.clone();
    company.preferred = vec![];
    dd.companies.push(company);
    assert!(validation::validate(&d).is_empty());
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    let p = w.flagship(O).unwrap();
    let company = OwnerId::Company(CompanyId(0));
    let convoy = w.flagship(company).unwrap();
    command("escort", Payload::Commit {}).apply(&mut w).unwrap();
    reject(&mut w, command("escort", Payload::Commit {}));
    assert_eq!(w.history_lever_points(EVENT, "escort"), 0);
    let mut abandoned = w.clone();
    advance(&mut abandoned, 4);
    assert_eq!(abandoned.history_lever_points(EVENT, "escort"), 0);
    let east = w.defs.find_loc("test_east").unwrap();
    sail(&mut w, O, p, east);
    sail(&mut w, company, convoy, east);
    let mut saved = restored(&w);
    for _ in 0..8 {
        if w.history_lever_points(EVENT, "escort") > 0 {
            break;
        }
        advance(&mut w, 1);
        advance(&mut saved, 1);
    }
    assert_eq!(w.history_lever_points(EVENT, "escort"), 6);
    assert_eq!(w.state_hash(), saved.state_hash());
    reject(&mut w, command("escort", Payload::Commit {}));
}

#[test]
fn action_deadlines_and_zero_returns_stop_further_resource_spending() {
    let mut train = lever("train");
    train["trainer"] = "mentor".into();
    train["days"] = 2.into();
    let mut d = defs(json!([train]));
    Arc::make_mut(&mut d).history.events[0].window = Some([[1558, 1, 1], [1558, 1, 1]]);
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    command("train", Payload::Commit {}).apply(&mut w).unwrap();
    advance(&mut w, 3);
    assert_eq!(w.history_lever_points(EVENT, "train"), 0);
    assert!(!w.state.history.events[EVENT].contributions["train"].activities[&O].valid);
    let mut d = defs(json!([lever("money")]));
    Arc::make_mut(&mut d).history.events[0].diminish = 0;
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    command("money", Payload::Money { amount: 100 }).apply(&mut w).unwrap();
    assert_eq!(w.history_lever_points(EVENT, "money"), 10);
    reject(&mut w, command("money", Payload::Money { amount: 1 }));
}

#[test]
fn sub_point_contributions_do_not_activate_a_random_outcome() {
    let mut d = defs(json!([lever("money")]));
    let e = &mut Arc::make_mut(&mut d).history.events[0];
    e.balance = 100;
    e.roll = 20;
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    command("money", Payload::Money { amount: 1 }).apply(&mut w).unwrap();
    assert_eq!(w.history_lever_points(EVENT, "money"), 0);
    advance(&mut w, 20);
    assert_eq!(w.history_outcome(EVENT), Some("opens"));
}

#[test]
fn dormant_ports_cannot_supply_cargo_through_fallback_services() {
    let mut w = world(json!([]));
    let fleet = w.flagship(O).unwrap();
    w.state.history.ports.insert(LocId(0), DynamicPort { status: PortStatus::Dormant, ..DynamicPort::default() });
    for cmd in [
        Command::Resupply { owner: O, fleet, food: 1, water: 1 },
        Command::HireCrew { owner: O, fleet, count: 1 },
        Command::Repair { owner: O, fleet },
        Command::BuyShip { owner: O, fleet, ship_type: ShipTypeId(0), new_fleet: false },
        Command::FoundFleet { owner: O, at: LocId(0), ship_type: ShipTypeId(0) },
    ] {
        reject(&mut w, cmd);
    }
}
