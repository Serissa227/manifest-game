//! 首读奖励、语言、半速通事、译本、航行与暂停后的确定性。
use manifest_core::{
    captain::Birthday,
    items::{equipment::EquipSlot, reading::ReadMode},
    replay::{LogEntry, Source, StartParams, replay},
    *,
};
use std::sync::Arc;
const O: OwnerId = OwnerId::Player;
fn defs() -> Arc<StaticData> {
    let root = manifest_data::find_data_dir().unwrap();
    let mut d = (*manifest_data::load_world(&root, "testbed").unwrap()).clone();
    let mut mate = manifest_data::load(&root).unwrap().mates[0].clone();
    mate.key = "interpreter_test".into();
    mate.home = LocId(0);
    mate.salary = 0;
    mate.hire_cost = 0;
    mate.hidden = false;
    mate.abilities.insert("lang_test".into(), 50);
    d.mates = vec![mate];
    d.scenarios[0].mates.clear();
    Arc::new(d)
}
fn captain() -> Command {
    Command::CreateCaptain {
        owner: O,
        birthday: Birthday { year: 1484, month: 1, day: 31 },
        answers: vec!["library".into()],
        alloc: vec![1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
        genius: None,
    }
}
fn world() -> World {
    let mut w = World::new(defs(), ScenarioId(0), 42).unwrap();
    captain().apply(&mut w).unwrap();
    w
}
fn read(book: &str) -> Command {
    Command::ReadBook { owner: O, book: book.into(), interpreter: None }
}
fn days(w: &mut World, n: usize) {
    for _ in 0..n {
        w.end_day().unwrap();
    }
}
fn rejects(w: &mut World, c: Command) {
    let before = w.state.clone();
    assert!(c.apply(w).is_err(), "{c:?}");
    assert_eq!(w.state, before);
}

#[test]
fn unknown_language_rejects_and_translation_grants_a_work_reward_only_once() {
    let mut w = world();
    w.grant_item(O, "reader", 1).unwrap();
    rejects(&mut w, read("reader"));
    rejects(&mut w, read("ring"));
    w.grant_item(O, "translation", 1).unwrap();
    read("reader").apply(&mut w).unwrap();
    let current = w.inventory(O).unwrap().reading.as_ref().unwrap();
    assert_eq!(current.mode, ReadMode::Translation);
    assert_eq!(current.source, "translation");
    let wit = w.captain_attr(O, 0);
    let fog = w.state.explore.revealed_count();
    days(&mut w, 2);
    assert_eq!(w.books_read(O, None), 0);
    days(&mut w, 1);
    assert_eq!(w.books_read(O, None), 1);
    assert_eq!(w.books_read(O, Some("voyage")), 1);
    assert!(w.has_read_work(O, "reader") && w.has_read_work(O, "translation") && w.has_read_work(O, "voyages"));
    assert_eq!(w.captain_attr(O, 0), wit + 1);
    assert!(w.state.explore.revealed_count() > fog);
    assert!(w.knows_language(O, "lang_test"));
    let inv = w.inventory(O).unwrap();
    assert_eq!(inv.bibliography["voyages"].key, "translation");
    assert_eq!(inv.bibliography["voyages"].day, 3);
    assert_eq!(inv.skill_xp["lang_test"], 10);
    rejects(&mut w, read("reader"));
    rejects(&mut w, read("translation"));
    days(&mut w, 4);
    assert_eq!(w.captain_attr(O, 0), wit + 1);
    assert_eq!(w.item_quantity(O, "translation"), 1);
}

#[test]
fn interpreter_takes_twice_as_long_and_departure_pauses_without_losing_progress() {
    let mut w = world();
    w.grant_item(O, "reader", 1).unwrap();
    rejects(
        &mut w,
        Command::ReadBook { owner: O, book: "reader".into(), interpreter: Some("interpreter_test".into()) },
    );
    Command::HireMate { owner: O, mate: MateId(0) }.apply(&mut w).unwrap();
    read("reader").apply(&mut w).unwrap();
    let reading = w.inventory(O).unwrap().reading.clone().unwrap();
    assert_eq!(reading.mode, ReadMode::Interpreter);
    assert_eq!(w.reading_days(O, &reading), (0, 8));
    days(&mut w, 2);
    assert_eq!(w.reading_days(O, &reading), (2, 8));
    Command::DismissMate { owner: O, mate: MateId(0) }.apply(&mut w).unwrap();
    days(&mut w, 1);
    assert!(w.inventory(O).unwrap().reading.is_none());
    assert_eq!(w.inventory(O).unwrap().read_progress["reader"], 2);
    Command::HireMate { owner: O, mate: MateId(0) }.apply(&mut w).unwrap();
    read("reader").apply(&mut w).unwrap();
    days(&mut w, 5);
    assert_eq!(w.books_read(O, None), 0);
    days(&mut w, 1);
    assert_eq!(w.books_read(O, None), 1);
    assert_eq!(w.inventory(O).unwrap().bibliography["voyages"].day, 9);
}

#[test]
fn selling_the_active_edition_pauses_and_buying_it_again_resumes() {
    let mut w = world();
    w.grant_item(O, "translation", 1).unwrap();
    read("translation").apply(&mut w).unwrap();
    days(&mut w, 1);
    Command::SellItem { owner: O, loc: LocId(0), item: "translation".into(), qty: 1, min_total: None }
        .apply(&mut w)
        .unwrap();
    days(&mut w, 1);
    assert!(w.inventory(O).unwrap().reading.is_none());
    Command::BuyItem { owner: O, loc: LocId(0), item: "translation".into(), qty: 1, max_total: None }
        .apply(&mut w)
        .unwrap();
    read("translation").apply(&mut w).unwrap();
    days(&mut w, 2);
    assert_eq!(w.books_read(O, None), 1);
}

#[test]
fn reading_and_equipment_run_during_voyage_and_replay_across_a_mid_read_save() {
    let d = defs();
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    let fleet = w.flagship(O).unwrap();
    let commands = vec![
        captain(),
        Command::BuyItem { owner: O, loc: LocId(0), item: "translation".into(), qty: 1, max_total: None },
        Command::BuyItem { owner: O, loc: LocId(0), item: "compass".into(), qty: 1, max_total: None },
        Command::Equip { owner: O, wearer: "captain".into(), slot: EquipSlot::Instrument, item: "compass".into() },
        read("translation"),
        Command::SetSail { owner: O, fleet, dest: LocId(1) },
    ];
    let mut log = Vec::new();
    for (seq, command) in commands.into_iter().enumerate() {
        command.apply(&mut w).unwrap();
        log.push(LogEntry { minute: None, tick: 0, seq: seq as u64, source: Source::Player, command });
    }
    assert!(w.fleet(fleet).unwrap().docked_at().is_none());
    days(&mut w, 1);
    let start = StartParams::new(ScenarioId(0), 42);
    let save = SaveFile::new(&d, start.clone(), w.state.clone(), log.clone());
    let loaded = SaveFile::from_json(&save.to_json().unwrap()).unwrap();
    let mut restored = World::from_snapshot(d.clone(), loaded.snapshot).unwrap();
    days(&mut w, 4);
    days(&mut restored, 4);
    assert_eq!(w.state, restored.state);
    assert_eq!(w.books_read(O, None), 1);
    assert_eq!(replay(d, start, &log, 5).unwrap().state, w.state);
}

#[test]
fn corrupt_reading_snapshot_is_rejected_and_rewards_wait_for_a_captain_profile() {
    let mut w = World::new(defs(), ScenarioId(0), 42).unwrap();
    w.grant_item(O, "translation", 1).unwrap();
    read("translation").apply(&mut w).unwrap();
    days(&mut w, 3);
    assert_eq!(w.inventory(O).unwrap().attr_xp["wit"], 100);
    // 缺档案不会丢首读奖励；A3 的晚立身世规则仍由 CreateCaptain 自行校验。
    let before = world().captain_profile(O).unwrap().clone();
    w.state.agents.get_mut(&O).unwrap().captain = Some(before.clone());
    days(&mut w, 1);
    assert_eq!(w.captain_attr(O, 0), before.attrs[0] + 1);
    let mut bad = w.state.clone();
    bad.items.owners.get_mut(&O).unwrap().skill_xp.insert("lang_test".into(), -1);
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
    let mut drifted = w.state.clone();
    drifted.items.owners.get_mut(&O).unwrap().bibliography.get_mut("voyages").unwrap().key = "missing".into();
    let mut restored = World::from_snapshot(w.defs.clone(), drifted.clone()).unwrap();
    assert!(restored.has_read_work(O, "voyages"));
    assert_eq!(restored.state, drifted);
    rejects(&mut restored, read("translation"));
    let mut bad = w.state.clone();
    bad.items.owners.get_mut(&O).unwrap().bibliography.get_mut("voyages").unwrap().day = w.day() + 1;
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
}

#[test]
fn completed_works_survive_edition_category_and_kind_drift_without_new_rewards() {
    use manifest_core::items::ItemKind;
    let mut w = world();
    w.grant_item(O, "translation", 1).unwrap();
    w.grant_item(O, "reader", 1).unwrap();
    read("translation").apply(&mut w).unwrap();
    days(&mut w, 3);
    let original = w.inventory(O).unwrap().bibliography["voyages"].clone();
    let profile = w.captain_profile(O).unwrap().clone();
    let attrs = w.inventory(O).unwrap().attr_xp.clone();
    let skills = w.inventory(O).unwrap().skill_xp.clone();
    let revealed = w.state.explore.revealed_count();
    for change in 0..5 {
        let mut d = (*w.defs).clone();
        match change {
            0 => d.items.items.retain(|i| i.key != "translation"),
            1 => d.items.items.iter_mut().find(|i| i.key == "translation").unwrap().key = "new_edition".into(),
            2 => {
                let mut category = d.items.book_categories[0].clone();
                category.key = "reclassified".into();
                d.items.book_categories.push(category);
                for item in d.items.items.iter_mut().filter(|i| i.work_key() == "voyages") {
                    item.read.as_mut().unwrap().category = "reclassified".into();
                }
            }
            3 => d.items.book_categories.retain(|c| c.key != original.category),
            _ => {
                for item in d.items.items.iter_mut().filter(|i| i.work_key() == "voyages") {
                    item.kind = ItemKind::Curio;
                    item.read = None;
                }
            }
        }
        let mut loaded = World::from_snapshot(Arc::new(d), w.state.clone()).unwrap();
        assert!(loaded.has_read_work(O, "voyages"), "change={change}");
        assert_eq!(loaded.inventory(O).unwrap().bibliography["voyages"], original);
        assert_eq!(World::from_snapshot(loaded.defs.clone(), loaded.state.clone()).unwrap().state, loaded.state);
        let book = if change == 1 { "new_edition" } else { "reader" };
        if change == 1 {
            loaded.grant_item(O, book, 1).unwrap();
        }
        rejects(&mut loaded, read(book));
        // 类别改回原值、版本重新发布后，首读标志也不能复活。
        let mut restored = World::from_snapshot(w.defs.clone(), loaded.state).unwrap();
        rejects(&mut restored, read("reader"));
        days(&mut restored, 4);
        assert_eq!(restored.captain_profile(O), Some(&profile));
        assert_eq!(restored.inventory(O).unwrap().attr_xp, attrs);
        assert_eq!(restored.inventory(O).unwrap().skill_xp, skills);
        assert_eq!(restored.state.explore.revealed_count(), revealed);
        assert_eq!(restored.books_read(O, None), 1);
    }
    let mut removed = (*w.defs).clone();
    removed.items.items.retain(|i| i.work_key() != "voyages");
    let loaded = World::from_snapshot(Arc::new(removed), w.state.clone()).unwrap();
    assert!(!loaded.has_read_work(O, "voyages"));
    assert!(matches!(loaded.state.log.last().unwrap().kind, manifest_core::log::LogKind::ItemsReconciled));
    assert_eq!(loaded.inventory(O).unwrap().attr_xp, attrs);
    assert_eq!(loaded.inventory(O).unwrap().skill_xp, skills);
}
