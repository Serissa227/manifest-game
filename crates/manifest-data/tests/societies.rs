//! E59：真实加载、一次性奖励、敌对与嫌疑以及旧档兼容。
#[path = "support/history.rs"]
mod fixture;
use fixture::*;
use manifest_core::{societies::*, *};
use serde_json::json;
use std::sync::Arc;
fn world() -> World {
    let mut w = fixture::world(json!([]));
    let d = Arc::make_mut(&mut w.defs);
    d.societies.societies[0].ranks[0].requires.clear();
    let mut rival = d.societies.societies[0].clone();
    rival.key = "rival".into();
    d.societies.societies[0].enemies.push(rival.key.clone());
    d.societies.societies.push(rival);
    let faction = d.loc(d.find_loc("test_west").unwrap()).faction;
    d.societies.policies=serde_json::from_value(json!([{"faction":d.factions[faction.idx()].key,"forbids":{"societies":["sample_society"]},"gain":20,"decay":1,"away_decay":3,"threshold":50}])).unwrap();
    assert!(validation::validate(d).is_empty(), "{:?}", validation::validate(d));
    w
}
fn join() -> Command {
    Command::JoinSociety { owner: O, society: "sample_society".into() }
}
#[test]
fn membership_rewards_once_and_dislikes_declared_enemies() {
    let mut w = world();
    let before = w.item_quantity(O, "reader");
    let price = w.item_buy_price(O, w.defs.find_loc("test_west").unwrap(), "reader").unwrap();
    let snapshot = w.state.clone();
    join().validate(&w).unwrap();
    assert_eq!(snapshot, w.state);
    join().apply(&mut w).unwrap();
    assert_eq!(w.society_rank("sample_society"), Some(1));
    assert_eq!(w.item_quantity(O, "reader"), before + 1);
    assert_eq!(w.state.societies.relations["rival"], -10);
    assert!(w.item_buy_price(O, w.defs.find_loc("test_west").unwrap(), "reader").unwrap() < price);
    reject(&mut w, join());
    advance(&mut w, 5);
    assert_eq!(w.item_quantity(O, "reader"), before + 1);
}
#[test]
fn trials_must_finish_and_next_rank_is_awarded_only_once() {
    let mut w = world();
    let d = Arc::make_mut(&mut w.defs);
    for t in &mut d.story2.tracks {
        t.auto = false;
    }
    for key in ["society_trial", "society_trial_two"] {
        d.story2.tracks.push(serde_json::from_value(json!({"key":key,"name":"测试试炼","kind":"request","auto":false,"start":"first","chapters":[{"key":"first","title":"试炼","text":"这是测试试炼。","choices":[{"key":"finish","text":"完成测试。","next":"done"}]}]})).unwrap());
    }
    let rank = &mut d.societies.societies[0].ranks[0];
    rank.trial = Some("society_trial".into());
    rank.trial_text = Some("这是测试试炼。".into());
    let mut second = rank.clone();
    second.trial = Some("society_trial_two".into());
    second.effects = vec![story2::Effect::Item { item: "coin".into(), qty: 1 }];
    d.societies.societies[0].ranks.push(second);
    w.state.story2 = Default::default();
    let before = w.item_quantity(O, "reader");
    let coin = w.item_quantity(O, "coin");
    join().apply(&mut w).unwrap();
    assert_eq!(w.society_rank("sample_society"), Some(0));
    assert_eq!(w.item_quantity(O, "reader"), before);
    assert_eq!(w.state.story2.pending[0].track, "society_trial");
    Command::StoryAnswer { owner: O, choice: 0 }.apply(&mut w).unwrap();
    advance(&mut w, 1);
    assert_eq!(w.society_rank("sample_society"), Some(1));
    assert_eq!(w.item_quantity(O, "reader"), before + 1);
    assert_eq!(w.item_quantity(O, "coin"), coin);
    assert_eq!(w.state.story2.pending[0].track, "society_trial_two");
    Command::StoryAnswer { owner: O, choice: 0 }.apply(&mut w).unwrap();
    advance(&mut w, 1);
    assert_eq!(w.society_rank("sample_society"), Some(2));
    assert_eq!(w.item_quantity(O, "coin"), coin + 1);
    advance(&mut w, 2);
    assert_eq!(w.item_quantity(O, "reader"), before + 1);
    assert_eq!(w.item_quantity(O, "coin"), coin + 1);
}
#[test]
fn private_conditions_and_unknown_societies_reject_atomically() {
    let mut w = world();
    Arc::make_mut(&mut w.defs).societies.societies[0].knowledge = Some("secret_society".into());
    reject(&mut w, join());
    w.state.story2.flags.insert("secret_society".into());
    Arc::make_mut(&mut w.defs).societies.societies[0].ranks[0].requires =
        serde_json::from_value(json!([{"kind":"cash","ge":999999999}])).unwrap();
    reject(&mut w, join());
    reject(&mut w, Command::JoinSociety { owner: OwnerId::Company(CompanyId(0)), society: "sample_society".into() });
}
#[test]
fn suspicion_decays_and_romance_never_adds_it() {
    let mut w = world();
    join().apply(&mut w).unwrap();
    let f = w.defs.loc(w.defs.find_loc("test_west").unwrap()).faction;
    assert_eq!(w.state.societies.suspicion[&f], 20);
    // 修改已存在的情谊与心动记录，逐日更新不把它们解释成任何违禁行为。
    for p in w.state.cast.persons.values_mut() {
        p.affection.affinity = 100;
        p.affection.heart = 100;
    }
    advance(&mut w, 1);
    assert_eq!(w.state.societies.suspicion[&f], 17);
    advance(&mut w, 10);
    assert_eq!(w.state.societies.suspicion[&f], 0);
}
#[test]
fn membership_save_replay_and_corrupt_reward_validation() {
    let mut w = world();
    let mut other = w.clone();
    let start = w.day();
    join().apply(&mut w).unwrap();
    let mut saved = restored(&w);
    advance(&mut w, 3);
    advance(&mut saved, 3);
    replay::replay_onto(
        &mut other,
        &[LogEntry { tick: start, seq: 0, source: Source::Player, command: join(), minute: None }],
        w.day(),
    )
    .unwrap();
    assert_eq!(other.state_hash(), w.state_hash());
    assert_eq!(saved.state_hash(), w.state_hash());
    let mut bad = w.state.clone();
    bad.societies.members.get_mut("sample_society").unwrap().rewarded.clear();
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
}
#[test]
fn suspicion_uses_current_port_sovereignty() {
    let mut w = world();
    let loc = w.defs.find_loc("test_west").unwrap();
    let original = w.location_faction(loc);
    let changed =
        w.defs.factions.iter().enumerate().map(|(i, _)| FactionId::from_idx(i)).find(|f| *f != original).unwrap();
    let key = w.defs.factions[changed.idx()].key.clone();
    Arc::make_mut(&mut w.defs).societies.policies[0].faction = key;
    w.state
        .history
        .ports
        .insert(loc, history::DynamicPort { faction: Some(changed), status: history::PortStatus::Open, until: None });
    join().apply(&mut w).unwrap();
    assert_eq!(w.state.societies.suspicion.get(&original), None);
    assert_eq!(w.state.societies.suspicion[&changed], 20);
    advance(&mut w, 1);
    assert_eq!(w.state.societies.suspicion[&changed], 17);
}
#[test]
fn society_discount_never_creates_shop_arbitrage() {
    let mut w = world();
    let d = Arc::make_mut(&mut w.defs);
    d.rules.items.sell_bp = 10_000 - manifest_core::news::MAX_DISCOUNT.0;
    d.societies.societies[0].ranks[0].price_pct = 30;
    join().apply(&mut w).unwrap();
    let loc = w.defs.find_loc("test_west").unwrap();
    for item in &w.defs.items.items {
        assert!(w.item_buy_price(O, loc, &item.key).unwrap() >= w.item_sell_price(&item.key).unwrap());
    }
}
#[test]
fn bad_references_and_excess_rewards_are_rejected() {
    for mode in 0..4 {
        let mut w = world();
        let d = Arc::make_mut(&mut w.defs);
        match mode {
            0 => d.societies.societies[0].enemies.push("absent".into()),
            1 => d.societies.policies[0].gain = 101,
            2 => d.societies.societies[0].ranks[0].price_pct = 31,
            _ => d.societies.societies[0].ranks[0].effects = vec![story2::Effect::Cash { value: 10 }],
        }
        assert!(!validation::validate(d).is_empty());
    }
}
#[test]
fn classic_omits_societies_and_old_snapshot_defaults() {
    let d = manifest_data::load_shared(&manifest_data::find_data_dir().unwrap()).unwrap();
    let w = World::new(d, ScenarioId(0), 42).unwrap();
    let j = serde_json::to_value(&w.state).unwrap();
    assert!(j.get("societies").is_none());
    assert!(serde_json::from_value::<WorldState>(j).unwrap().societies.is_empty());
}
