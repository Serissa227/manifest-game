//! A4 真实 testbed 数据上的交易、效果、货架与存读档。
use manifest_core::{
    captain::AttrHook,
    ledger::Account,
    replay::{LogEntry, Source, StartParams, replay},
    *,
};

const OWNER: OwnerId = OwnerId::Player;
const PORT: LocId = LocId(0);

fn world() -> World {
    let defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    World::new(defs, ScenarioId(0), 42).unwrap()
}
fn buy(item: &str, qty: i64) -> Command {
    Command::BuyItem { owner: OWNER, loc: PORT, item: item.into(), qty, max_total: None }
}

#[test]
fn purchases_and_sales_are_personal_expense_and_income_with_a_counterparty() {
    let mut w = world();
    let cash = w.agent(OWNER).unwrap().cash;
    let money = w.all_money();
    let purse = w.purse(PORT).unwrap().money;
    let asset_inventory = w.agent(OWNER).unwrap().ledger.balance(Account::Inventory);
    buy("ring", 2).apply(&mut w).unwrap();
    assert_eq!(w.item_quantity(OWNER, "ring"), 2);
    assert_eq!(w.agent(OWNER).unwrap().cash, cash - 200);
    assert_eq!(w.purse(PORT).unwrap().money, purse + 200);
    assert_eq!(w.collection_value(OWNER), 200);
    assert_eq!(w.agent(OWNER).unwrap().ledger.balance(Account::Inventory), asset_inventory);
    assert_eq!(w.agent(OWNER).unwrap().ledger.balance(Account::OtherExpense), 200);
    Command::SellItem { owner: OWNER, loc: PORT, item: "ring".into(), qty: 1, min_total: Some(50) }
        .apply(&mut w)
        .unwrap();
    assert_eq!(w.item_quantity(OWNER, "ring"), 1);
    assert_eq!(w.agent(OWNER).unwrap().cash, cash - 150);
    assert_eq!(w.purse(PORT).unwrap().money, purse + 150);
    assert_eq!(w.all_money(), money);
    manifest_core::testkit::check_invariants(&w).unwrap();
}

#[test]
fn invalid_commands_leave_every_byte_unchanged() {
    let mut w = world();
    let commands = [
        buy("ring", 0),
        buy("ring", -1),
        buy("ring", i64::MAX),
        buy("ring", 11),
        buy("missing", 1),
        Command::BuyItem { owner: OWNER, loc: LocId(u16::MAX), item: "ring".into(), qty: 1, max_total: None },
        Command::BuyItem { owner: OWNER, loc: LocId(1), item: "ring".into(), qty: 1, max_total: None },
        Command::BuyItem { owner: OWNER, loc: PORT, item: "ring".into(), qty: 1, max_total: Some(99) },
        Command::SellItem { owner: OWNER, loc: PORT, item: "ring".into(), qty: 1, min_total: None },
        Command::UseItem { owner: OWNER, item: "ring".into(), target: None },
    ];
    for command in commands {
        let before = serde_json::to_vec(&w.state).unwrap();
        assert!(command.apply(&mut w).is_err(), "{command:?}");
        assert_eq!(serde_json::to_vec(&w.state).unwrap(), before);
    }
    w.grant_item(OWNER, "sealed_letter", 1).unwrap();
    let before = w.state.clone();
    assert!(
        Command::SellItem { owner: OWNER, loc: PORT, item: "sealed_letter".into(), qty: 1, min_total: None }
            .apply(&mut w)
            .is_err()
    );
    assert_eq!(w.state.clone(), before);
    w.state.agents.get_mut(&OWNER).unwrap().cash = 0;
    let before = w.state.clone();
    assert!(matches!(buy("ring", 1).apply(&mut w), Err(CommandError::InsufficientCash { .. })));
    assert_eq!(w.state.clone(), before);
}

#[test]
fn shelves_follow_world_months_and_ignore_queries_and_unpublished_books() {
    let mut w = world();
    let other = world();
    assert_eq!(w.state.items, other.state.items);
    assert_eq!(w.item_shelf(PORT).unwrap().restock, 31);
    assert!(!w.item_shelf(PORT).unwrap().stock.contains_key("future_book"));
    buy("ring", 2).apply(&mut w).unwrap();
    let stock = w.item_shelf(PORT).unwrap().clone();
    for _ in 0..30 {
        w.end_day().unwrap();
    }
    assert_eq!(w.item_shelf(PORT), Some(&stock));
    let before = w.state.clone();
    for _ in 0..10 {
        assert_eq!(w.item_buy_price(OWNER, PORT, "ring"), Some(100));
    }
    assert_eq!(w.state.clone(), before);
    w.end_day().unwrap();
    assert_eq!(w.item_shelf(PORT).unwrap().stock["ring"], 10);
    assert_eq!(w.item_shelf(PORT).unwrap().restock, 59);
}

#[test]
fn consumables_share_attribute_hooks_expire_and_charts_only_reveal_the_map() {
    let mut w = world();
    buy("tonic", 2).apply(&mut w).unwrap();
    let command = Command::UseItem { owner: OWNER, item: "tonic".into(), target: None };
    command.apply(&mut w).unwrap();
    assert_eq!(w.attr_hook(OWNER, AttrHook::FlagshipSpeed), 800);
    command.apply(&mut w).unwrap();
    assert_eq!(w.attr_hook(OWNER, AttrHook::FlagshipSpeed), 800);
    for _ in 0..3 {
        w.end_day().unwrap();
    }
    assert_eq!(w.attr_hook(OWNER, AttrHook::FlagshipSpeed), 0);
    buy("chart", 1).apply(&mut w).unwrap();
    let count = w.state.explore.revealed_count();
    let discovered = w.state.explore.discovered.clone();
    Command::UseItem { owner: OWNER, item: "chart".into(), target: None }.apply(&mut w).unwrap();
    assert!(w.state.explore.revealed_count() > count);
    assert_eq!(w.state.explore.discovered, discovered);
    assert_eq!(w.item_quantity(OWNER, "chart"), 0);
}

#[test]
fn items_round_trip_and_replay_without_changing_classic_snapshots() {
    let mut w = world();
    let defs = w.defs.clone();
    let start = StartParams::new(ScenarioId(0), 42);
    let command = buy("ring", 2);
    command.apply(&mut w).unwrap();
    let log = vec![LogEntry { minute: None, tick: 0, seq: 0, source: Source::Player, command }];
    for _ in 0..32 {
        w.end_day().unwrap();
    }
    let save = SaveFile::new(&defs, start.clone(), w.state.clone(), log.clone());
    let loaded = SaveFile::from_json(&save.to_json().unwrap()).unwrap();
    assert_eq!(World::from_snapshot(defs.clone(), loaded.snapshot).unwrap().state.clone(), w.state.clone());
    assert_eq!(replay(defs, start, &log, 32).unwrap().state.clone(), w.state.clone());
    let classic = manifest_data::load(&manifest_data::find_data_dir().unwrap()).unwrap();
    let w = World::new(classic, ScenarioId(0), 42).unwrap();
    assert!(serde_json::to_value(w.state.clone()).unwrap().get("items").is_none());
}

#[test]
fn content_drift_is_reconciled_once_and_real_corruption_is_rejected() {
    use std::sync::Arc;
    let mut w = world();
    buy("translation", 1).apply(&mut w).unwrap();
    buy("ring", 1).apply(&mut w).unwrap();
    Command::ReadBook { owner: OWNER, book: "translation".into(), interpreter: None }.apply(&mut w).unwrap();
    w.end_day().unwrap();
    w.end_day().unwrap();
    for change in 0..3 {
        let mut defs = (*w.defs).clone();
        match change {
            0 => defs.items.items.iter_mut().find(|i| i.key == "translation").unwrap().read.as_mut().unwrap().days = 1,
            1 => defs.items.items.retain(|i| i.key != "ring"),
            _ => defs.locations[0].shop = false,
        }
        let mut loaded = World::from_snapshot(Arc::new(defs), w.state.clone()).unwrap();
        assert!(matches!(loaded.state.log.last().unwrap().kind, manifest_core::log::LogKind::ItemsReconciled));
        assert_eq!(World::from_snapshot(loaded.defs.clone(), loaded.state.clone()).unwrap().state, loaded.state);
        match change {
            0 => assert_eq!(loaded.inventory(OWNER).unwrap().read_progress["translation"], 1),
            1 => assert_eq!(loaded.item_quantity(OWNER, "ring"), 0),
            _ => assert!(loaded.item_shelf(PORT).is_none()),
        }
        loaded.end_day().unwrap();
        assert!(loaded.has_read_work(OWNER, "translation"));
    }
    let mut bad = w.state.clone();
    bad.items.owners.get_mut(&OWNER).unwrap().quantities.insert("deleted".into(), -1);
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
    let mut bad = w.state.clone();
    bad.items.owners.insert(OwnerId::Company(CompanyId(u16::MAX)), Default::default());
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
}

#[test]
fn limited_shelves_draw_deterministically_after_culture_size_and_season_filters() {
    use std::{collections::BTreeSet, sync::Arc};
    let original = world();
    let mut defs = (*original.defs).clone();
    defs.rules.items.shelf_slots = 2;
    let template = defs.items.item("ring").unwrap().clone();
    defs.items.items.clear();
    for index in 0..9 {
        let mut item = template.clone();
        item.key = format!("candidate_{index}");
        let rule = item.shop.as_mut().unwrap();
        rule.cultures.clear();
        rule.min_size = 1;
        rule.seasons.clear();
        rule.weight = 1;
        match index {
            6 => rule.cultures = vec!["foreign".into()],
            7 => rule.min_size = 5,
            8 => {
                rule.seasons =
                    vec![((defs.locations[0].hemisphere.season(defs.calendar.season_of(0)).index() + 1) % 4) as u8]
            }
            _ => {}
        }
        defs.items.items.push(item);
    }
    defs.locations[0].size = 1;
    let defs = Arc::new(defs);
    let mut draws = BTreeSet::new();
    for seed in 0..8 {
        let a = World::new(defs.clone(), ScenarioId(0), seed).unwrap();
        let b = World::new(defs.clone(), ScenarioId(0), seed).unwrap();
        let stock = &a.item_shelf(PORT).unwrap().stock;
        assert_eq!(stock.len(), 2);
        assert_eq!(a.item_shelf(PORT), b.item_shelf(PORT));
        for key in ["candidate_6", "candidate_7", "candidate_8"] {
            assert!(!stock.contains_key(key));
        }
        draws.insert(stock.keys().cloned().collect::<Vec<_>>());
    }
    assert!(draws.len() > 1, "种子必须实际参与抽签");
}

#[test]
fn changed_equipment_kind_is_unequipped_without_losing_items_or_accepting_over_equipment() {
    use manifest_core::items::{ItemKind, equipment::EquipSlot};
    use std::sync::Arc;
    let mut w = world();
    w.grant_item(OWNER, "ring", 1).unwrap();
    Command::Equip { owner: OWNER, wearer: "captain".into(), slot: EquipSlot::Accessory1, item: "ring".into() }
        .apply(&mut w)
        .unwrap();
    let mut d = (*w.defs).clone();
    d.items.items.iter_mut().find(|i| i.key == "ring").unwrap().kind = ItemKind::Instrument;
    let d = Arc::new(d);
    let mut loaded = World::from_snapshot(d.clone(), w.state.clone()).unwrap();
    assert_eq!(loaded.item_quantity(OWNER, "ring"), 1);
    assert_eq!(loaded.item_available(OWNER, "ring"), 1);
    assert_eq!(loaded.equipped_item(OWNER, "captain", EquipSlot::Accessory1), None);
    assert!(matches!(loaded.state.log.last().unwrap().kind, manifest_core::log::LogKind::ItemsReconciled));
    assert_eq!(World::from_snapshot(d.clone(), loaded.state.clone()).unwrap().state, loaded.state);
    Command::Equip { owner: OWNER, wearer: "captain".into(), slot: EquipSlot::Instrument, item: "ring".into() }
        .apply(&mut loaded)
        .unwrap();
    assert_eq!(loaded.equipped_item(OWNER, "captain", EquipSlot::Instrument), Some("ring"));
    loaded.end_day().unwrap();
    manifest_core::testkit::check_invariants(&loaded).unwrap();
    let mut bad = w.state.clone();
    bad.items
        .owners
        .get_mut(&OWNER)
        .unwrap()
        .equipment
        .get_mut("captain")
        .unwrap()
        .insert(EquipSlot::Accessory2, "ring".into());
    assert!(World::from_snapshot(d, bad).is_err(), "内容漂移不能掩盖装备件数超过库存的坏档");
}
