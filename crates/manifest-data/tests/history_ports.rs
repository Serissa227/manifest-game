//! 动态领土跨市场、声望、财政、委托和港口服务的一致性回归。
#[path = "support/history.rs"]
mod fixture;
use fixture::*;
use manifest_core::{history::*, *};
use serde_json::json;
use std::sync::Arc;

fn occupied() -> (Arc<StaticData>, LocId, FactionId, FactionId) {
    let mut d = defs(json!([]));
    let dd = Arc::make_mut(&mut d);
    let loc = dd.find_loc("test_west").unwrap();
    let old = dd.loc(loc).faction;
    let new = dd.faction_ids().find(|f| *f != old).unwrap();
    dd.history.ports.push(InitialPort {
        port: "test_west".into(),
        state: PortStatus::Open,
        faction: Some(dd.faction(new).key.clone()),
    });
    (d, loc, old, new)
}

#[test]
fn captured_ports_reward_current_faction_and_npc_plans_use_its_license() {
    let (d, loc, old, new) = occupied();
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    let (fleet, good) = buy(&mut w, 3);
    Arc::make_mut(&mut w.defs).goods[good.idx()].license = true;
    w.agent_mut(O).unwrap().licenses = vec![new];
    assert!(!w.has_license(O, old));
    let orders = npc::stage_unload(&w, fleet, &npc::PlannerParams::for_owner(&w, O));
    let sale = orders.into_iter().find(|c| matches!(c, Command::Sell { good: g, .. } if *g == good)).unwrap();
    sale.apply(&mut w).unwrap();
    let old_rep = w.reputation(O, old);
    let new_rep = w.reputation(O, new);
    let amount = w.defs.rules.invest.min_amount;
    Command::InvestPort { owner: O, loc, amount }.apply(&mut w).unwrap();
    assert_eq!(w.reputation(O, old), old_rep);
    assert_eq!(w.reputation(O, new), new_rep + (amount / 20_000).clamp(1, 10));
    let new_rep = w.reputation(O, new);
    Command::ApplyBargain {
        owner: O,
        loc,
        intent: news::Intent::Rapport,
        player_text: "测试议价".into(),
        reply: "测试回复".into(),
        reply_tpl: None,
    }
    .apply(&mut w)
    .unwrap();
    assert_eq!(w.reputation(O, old), old_rep);
    assert_eq!(w.reputation(O, new), new_rep + 1);
    assert!(w.money_conserved());
}

#[test]
fn closing_a_port_blocks_remote_property_and_contract_transactions_atomically() {
    let mut d = defs(json!([]));
    let dd = Arc::make_mut(&mut d);
    let loc = dd.find_loc("test_west").unwrap();
    let good = dd.find_good("grain").unwrap();
    let issuer = dd.loc(loc).faction;
    let e = &mut dd.history.events[0];
    e.date = Some([1558, 1, 1]);
    e.window = Some([[1558, 1, 1], [1558, 1, 1]]);
    e.outcomes[0].effects =
        serde_json::from_value(json!([{"kind":"port_state","port":"test_west","state":"dormant"}])).unwrap();
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    let (fleet, _) = buy(&mut w, 3);
    let reward = w.contract_fair_reward(good, 1, loc, 20);
    Command::OfferContract { issuer, good, qty: 1, to: loc, days: 20, reward }.apply(&mut w).unwrap();
    let contract = *w.state.contracts.keys().next().unwrap();
    Command::AcceptContract { owner: O, contract }.apply(&mut w).unwrap();
    let cmds = [
        Command::RentWarehouse { owner: O, loc, capacity: 10 },
        Command::BuyWarehouse { owner: O, loc, capacity: 10 },
        Command::InvestPort { owner: O, loc, amount: w.defs.rules.invest.min_amount },
        Command::DeliverContract { owner: O, contract, holder: warehouse::Holder::Fleet(fleet) },
    ];
    for cmd in &cmds {
        cmd.validate(&w).unwrap();
    }
    advance(&mut w, 1);
    assert_eq!(w.port_status(loc), PortStatus::Dormant);
    for cmd in cmds {
        reject(&mut w, cmd);
    }
    assert_eq!(w.holder_qty(O, warehouse::Holder::Fleet(fleet), good), 3);
}

#[test]
fn current_territory_controls_monthly_contract_issuers_and_naval_patrols() {
    let (mut d, loc, _, new) = occupied();
    let dd = Arc::make_mut(&mut d);
    dd.rules.contracts.per_faction_per_month = 1;
    dd.rules.money.enabled = true;
    dd.history.ports.push(InitialPort {
        port: "test_east".into(),
        state: PortStatus::Open,
        faction: Some(dd.faction(new).key.clone()),
    });
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    for (f, t) in &mut w.state.circulation.treasuries {
        t.patrol = if *f == new { Fx::ONE } else { Fx::ZERO };
    }
    let region = w.region_of_loc(loc).unwrap();
    assert_eq!(w.navy_pirate_mult(region), Fx::ONE - w.defs.rules.money.navy_cut);
    advance(&mut w, 20);
    let contracts: Vec<_> = w.state.contracts.values().filter(|c| c.source == contract::ContractSource::Rule).collect();
    assert!(!contracts.is_empty());
    assert!(contracts.iter().all(|c| c.issuer == new));
    assert!(w.money_conserved());
}

#[test]
fn only_current_open_ports_extend_faction_reach() {
    let (mut d, loc, _, new) = occupied();
    Arc::make_mut(&mut d).rules.colony.claim_reach = 1;
    let w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    assert!(!colony::faction_reaches(&d, new, loc));
    assert!(w.faction_reaches(new, loc));
    Arc::make_mut(&mut d).history.ports[0].state = PortStatus::Dormant;
    let closed = World::new(d, ScenarioId(0), 42).unwrap();
    assert!(!closed.faction_reaches(new, loc));
}

#[test]
fn a_sacked_port_reopens_on_the_exact_day_after_reload() {
    let mut d = defs(json!([]));
    let e = &mut Arc::make_mut(&mut d).history.events[0];
    e.date = Some([1558, 1, 1]);
    e.window = Some([[1558, 1, 1], [1558, 1, 1]]);
    e.outcomes[0].effects = serde_json::from_value(json!([
        {"kind":"port_state","port":"test_west","state":"sacked","days":2}
    ]))
    .unwrap();
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    let loc = w.defs.find_loc("test_west").unwrap();
    let cmd = Command::Buy {
        owner: O,
        fleet: w.flagship(O).unwrap(),
        good: w.defs.find_good("grain").unwrap(),
        qty: 1,
        max_total: None,
    };
    advance(&mut w, 1);
    assert_eq!(w.port_status(loc), PortStatus::Sacked);
    reject(&mut w, cmd.clone());
    let mut saved = restored(&w);
    advance(&mut w, 1);
    advance(&mut saved, 1);
    assert_eq!(w.port_status(loc), PortStatus::Open);
    cmd.apply(&mut w).unwrap();
    cmd.apply(&mut saved).unwrap();
    assert_eq!(w.state_hash(), saved.state_hash());
}
