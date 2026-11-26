//! 图纸、造船账目、持久身份与唯一性。
#[path = "support/history.rs"]
mod fixture;
use fixture::*;
use manifest_core::{legend_ships::*, *};
use serde_json::json;
use std::sync::Arc;
const KEY: &str = "sample_legend_ship";
fn world() -> World {
    fixture::world(json!([]))
}
fn commission(w: &World) -> Command {
    Command::CommissionShip { owner: O, ship: KEY.into(), loc: w.defs.find_loc("test_west").unwrap() }
}
fn reject_commission(w: &mut World) {
    let c = commission(w);
    reject(w, c);
}
fn ready(w: &mut World) {
    w.grant_item(O, "ring", 1).unwrap();
    buy(w, 2);
}
#[test]
fn blueprint_shipyard_materials_and_npc_guard_are_atomic() {
    let mut w = world();
    reject_commission(&mut w);
    w.grant_item(O, "ring", 1).unwrap();
    reject_commission(&mut w);
    buy(&mut w, 2);
    let mut wrong = commission(&w);
    if let Command::CommissionShip { loc, .. } = &mut wrong {
        *loc = w.defs.find_loc("test_east").unwrap();
    }
    reject(&mut w, wrong);
    let mut npc = commission(&w);
    if let Command::CommissionShip { owner, .. } = &mut npc {
        *owner = OwnerId::Company(CompanyId(0));
    }
    reject(&mut w, npc);
    commission(&w).apply(&mut w).unwrap();
    assert_eq!(w.legend_ship_count(KEY), 1);
}
#[test]
fn building_caps_identity_and_balances_the_ledger() {
    let mut w = world();
    ready(&mut w);
    let before = w.agent(O).unwrap().clone();
    let c = commission(&w);
    c.apply(&mut w).unwrap();
    let f = w.fleet(w.flagship(O).unwrap()).unwrap();
    let s = f.ships.last().unwrap();
    let d = w.defs.legend_ships.ship(KEY).unwrap();
    assert_eq!(s.legend.as_deref(), Some(KEY));
    assert_eq!(before.cash - w.agent(O).unwrap().cash, d.cost.cash);
    assert_eq!(s.book_value, d.cost.cash + before.book.total_cost() - w.agent(O).unwrap().book.total_cost());
    assert!(w.agent(O).unwrap().ledger.is_balanced());
    reject(&mut w, c);
    assert_eq!(restored(&w).state_hash(), w.state_hash());
}
#[test]
fn sale_and_loss_policies_remain_after_reload() {
    for sold in [false, true] {
        let mut w = world();
        ready(&mut w);
        commission(&w).apply(&mut w).unwrap();
        let fleet = w.flagship(O).unwrap();
        let index = w.fleet(fleet).unwrap().ships.len() - 1;
        if sold {
            Command::SellShip { owner: O, fleet, ship: index as u8 }.apply(&mut w).unwrap();
        } else {
            w.state.fleets.get_mut(&fleet).unwrap().ships.remove(index);
        }
        let mut w = restored(&w);
        buy(&mut w, 2);
        reject_commission(&mut w);
        let d = Arc::make_mut(&mut w.defs).legend_ships.ships.iter_mut().find(|s| s.key == KEY).unwrap();
        if sold {
            d.sold = Recovery::Rebuild
        } else {
            d.lost = Recovery::Rebuild
        }
        commission(&w).apply(&mut w).unwrap();
        assert_eq!(w.legend_ship_count(KEY), 1);
        assert_eq!(w.state.legend_ships.ships[KEY].built, 2);
    }
}
#[test]
fn copied_unknown_and_npc_identities_fail_snapshot_validation() {
    let mut w = world();
    ready(&mut w);
    commission(&w).apply(&mut w).unwrap();
    let f = w.flagship(O).unwrap();
    let mut copy = w.state.clone();
    let ship = copy.fleets[&f].ships.last().unwrap().clone();
    copy.fleets.get_mut(&f).unwrap().ships.push(ship);
    assert!(World::from_snapshot(w.defs.clone(), copy).is_err());
    let mut bad = w.state.clone();
    bad.fleets.get_mut(&f).unwrap().ships.last_mut().unwrap().legend = Some("absent".into());
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
    let mut bad = w.state.clone();
    bad.fleets.get_mut(&f).unwrap().owner = OwnerId::Company(CompanyId(0));
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
}
#[test]
fn commission_replays_exactly() {
    let mut w = world();
    ready(&mut w);
    let mut other = w.clone();
    let day = w.day();
    let c = commission(&w);
    c.apply(&mut w).unwrap();
    advance(&mut w, 1);
    replay::replay_onto(
        &mut other,
        &[LogEntry { tick: day, seq: 0, source: Source::Player, command: c, minute: None }],
        w.day(),
    )
    .unwrap();
    assert_eq!(other.state_hash(), w.state_hash());
}
#[test]
fn definitions_reject_unbounded_traits_and_missing_references() {
    for n in 0..5 {
        let mut w = world();
        let d = Arc::make_mut(&mut w.defs);
        match n {
            0 => d.legend_ships.ships[0].acquire.blueprint = Some("absent".into()),
            1 => d.legend_ships.ships[0].limit = 2,
            2 => d.legend_ships.ships[0].cost.cash = 0,
            3 => d.rules.ships.armor_pct = 51,
            _ => d.rules.ships.shallow_ports.push("absent".into()),
        };
        assert!(!validation::validate(d).is_empty(), "{n}");
    }
}
#[test]
fn classic_empty_identity_is_omitted() {
    let d = manifest_data::load_shared(&manifest_data::find_data_dir().unwrap()).unwrap();
    let w = World::new(d, ScenarioId(0), 42).unwrap();
    let json = serde_json::to_value(&w.state).unwrap();
    assert!(json.get("legend_ships").is_none());
    for f in w.state.fleets.values() {
        for s in &f.ships {
            assert!(serde_json::to_value(s).unwrap().get("legend").is_none());
        }
    }
}

#[test]
fn saturated_rebuild_history_rejects_before_spending_or_creating_an_unloadable_save() {
    let mut w = world();
    ready(&mut w);
    Arc::make_mut(&mut w.defs).legend_ships.ships[0].lost = Recovery::Rebuild;
    w.state.legend_ships.ships.insert(KEY.into(), Record { built: u32::MAX, owned: 0, lost: u32::MAX, sold: 0 });
    let mut w = restored(&w);
    reject_commission(&mut w);
    assert_eq!(restored(&w).state_hash(), w.state_hash());
}
