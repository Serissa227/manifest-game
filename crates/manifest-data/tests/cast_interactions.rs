//! 真实人物命令的资源、每日额度、账目、同伴唯一性与重放。
use manifest_core::{
    cast::{CastPlace, interactions::*},
    ledger::Account,
    replay::{LogEntry, Source, StartParams, replay},
    *,
};
use std::sync::Arc;
const O: OwnerId = OwnerId::Player;
fn defs() -> Arc<StaticData> {
    let mut defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let d = Arc::make_mut(&mut defs);
    d.scenarios[0].start_date = [1553, 1, 2];
    d.scenarios[0].control_date = [1553, 1, 2];
    defs
}
fn world() -> World {
    World::new(defs(), ScenarioId(0), 42).unwrap()
}
fn talk(person: &str, topic: &str) -> Command {
    Command::Talk { owner: O, person: person.into(), topic: topic.into() }
}
fn give(person: &str, item: &str) -> Command {
    Command::GiveItem { owner: O, person: person.into(), item: item.into(), qty: 1 }
}
fn rejects(w: &mut World, c: Command) {
    let before = w.state.clone();
    assert!(c.apply(w).is_err(), "{c:?}");
    assert_eq!(w.state, before);
}

#[test]
fn talk_topics_presence_daily_limits_and_memory_are_bounded() {
    let mut w = world();
    for c in [
        talk("missing", "chat"),
        talk("distant", "chat"),
        talk("classmate_a", "invented"),
        talk("classmate_a", "book:reader"),
    ] {
        rejects(&mut w, c);
    }
    for _ in 0..TALKS_PER_DAY {
        talk("classmate_a", "chat").apply(&mut w).unwrap();
    }
    assert_eq!(w.affection("classmate_a").unwrap().affinity, 6);
    assert_eq!(w.affection("classmate_a").unwrap().heart, 0);
    rejects(&mut w, talk("classmate_a", "chat"));
    w.end_day().unwrap();
    talk("classmate_a", "request").apply(&mut w).unwrap();
    assert_eq!(w.state.cast.persons["classmate_a"].interactions.talks, 1);
    w.state.cast.place = Some(CastPlace { loc: LocId(0), venue: "court".into() });
    rejects(&mut w, talk("classmate_a", "chat"));
    for n in 0..30 {
        w.remember_person("classmate_a", &format!("{n}{}", "记".repeat(200)));
    }
    let memories = &w.state.cast.persons["classmate_a"].interactions.memories;
    assert_eq!(memories.len(), MEMORIES_KEPT);
    assert!(memories.iter().all(|s| s.chars().count() <= MEMORY_CHARS));
}

#[test]
fn audience_requires_a_real_same_place_meeting_and_fame_or_introducer() {
    let mut w = world();
    let command = Command::RequestAudience { owner: O, person: "historian".into() };
    rejects(&mut w, talk("historian", "chat"));
    rejects(&mut w, command.clone());
    w.change_affinity("mentor", 50).unwrap();
    command.apply(&mut w).unwrap();
    talk("historian", "chat").apply(&mut w).unwrap();
    w.end_day().unwrap();
    rejects(&mut w, talk("historian", "chat"));
    w.change_affinity("mentor", -50).unwrap();
    w.state.agents.get_mut(&O).unwrap().fame = 10;
    command.apply(&mut w).unwrap();
    w.state.cast.place = Some(CastPlace { loc: LocId(1), venue: String::new() });
    rejects(&mut w, command);
}

#[test]
fn item_gifts_consume_once_share_caps_with_talk_and_remember_books() {
    let mut w = world();
    w.grant_item(O, "ring", 3).unwrap();
    w.grant_item(O, "translation", 1).unwrap();
    give("classmate_a", "ring").apply(&mut w).unwrap();
    for _ in 0..3 {
        talk("classmate_a", "chat").apply(&mut w).unwrap();
    }
    give("classmate_a", "ring").apply(&mut w).unwrap();
    assert_eq!(w.affection("classmate_a").unwrap().affinity, AFFINITY_PER_DAY);
    assert_eq!(w.item_quantity(O, "ring"), 1);
    assert_eq!(w.gift_count(O, Some("classmate_a")), 2);
    rejects(&mut w, give("classmate_a", "ring"));
    w.end_day().unwrap();
    give("classmate_a", "translation").apply(&mut w).unwrap();
    assert!(w.recipient_has_read(O, "classmate_a", "voyages"));
    assert_eq!(w.gifts_to(O, "classmate_a").unwrap().book_categories["voyage"], 1);
    assert!(w.state.cast.persons["classmate_a"].interactions.memories.iter().any(|s| s.contains("测试译本")));
    assert_eq!(World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap().state, w.state);
}

#[test]
fn birthdays_and_handmade_gifts_gain_more_affinity_without_heart() {
    for (birthday, handmade, expected) in [(false, false, 2), (true, false, 4), (false, true, 3), (true, true, 6)] {
        let mut d = defs();
        let defs = Arc::make_mut(&mut d);
        if birthday {
            defs.cast.persons.iter_mut().find(|p| p.key == "classmate_a").unwrap().born = [1540, 1, 2];
        }
        if handmade {
            defs.items.items.iter_mut().find(|i| i.key == "flowers").unwrap().made_by = Some("captain".into());
        }
        let mut w = World::new(d, ScenarioId(0), 42).unwrap();
        w.grant_item(O, "flowers", 1).unwrap();
        give("classmate_a", "flowers").apply(&mut w).unwrap();
        assert_eq!(w.affection("classmate_a").unwrap().affinity, expected);
        assert_eq!(w.affection("classmate_a").unwrap().heart, 0);
    }
}

#[test]
fn goods_gift_uses_actual_cargo_and_cost_basis_and_survives_without_item_definitions() {
    for items in [true, false] {
        let mut d = defs();
        if !items {
            Arc::make_mut(&mut d).items = Default::default();
        }
        let mut w = World::new(d, ScenarioId(0), 42).unwrap();
        let fleet = w.fleets_of(O).next().unwrap().id;
        Command::Buy { owner: O, fleet, good: GoodId(0), qty: 3, max_total: None }.apply(&mut w).unwrap();
        let balance = w.agent(O).unwrap().ledger.balance(Account::Inventory);
        let cash = w.agent(O).unwrap().cash;
        let money = w.all_money();
        let c = Command::GiveGoods { owner: O, person: "classmate_a".into(), good: GoodId(0), qty: 2 };
        c.apply(&mut w).unwrap();
        assert_eq!(w.fleet(fleet).unwrap().cargo[&GoodId(0)], 1);
        assert!(w.agent(O).unwrap().ledger.balance(Account::Inventory) < balance);
        assert_eq!(w.agent(O).unwrap().cash, cash);
        assert_eq!(w.all_money(), money);
        assert_eq!(w.gifts_to(O, "classmate_a").unwrap().kinds["goods"], 2);
        rejects(&mut w, c);
        manifest_core::testkit::check_invariants(&w).unwrap();
        assert_eq!(World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap().state, w.state);
    }
}

#[test]
fn recruiting_reuses_one_mate_and_dismissal_preserves_memory_and_restores_schedule() {
    let mut w = world();
    let id = w.person_mate("sailor").unwrap();
    let count = w.state.mates.len();
    let c = Command::RecruitPerson { owner: O, person: "sailor".into() };
    rejects(&mut w, c.clone());
    w.change_affinity("sailor", 20).unwrap();
    c.apply(&mut w).unwrap();
    assert_eq!(w.state.mates.len(), count);
    assert!(w.person_in_team("sailor"));
    rejects(&mut w, c.clone());
    w.state.cast.place = Some(CastPlace { loc: LocId(1), venue: "dock".into() });
    assert!(w.person_here("sailor"));
    Command::DismissMate { owner: O, mate: id }.apply(&mut w).unwrap();
    assert!(!w.person_in_team("sailor"));
    assert_eq!(w.person_place("sailor").unwrap().loc, LocId(0));
    assert!(!w.state.cast.persons["sailor"].interactions.memories.is_empty());
    w.state.cast.place = None;
    c.apply(&mut w).unwrap();
    assert_eq!(w.state.mates.len(), count);
}

#[test]
fn talk_and_gifts_replay_and_save_exactly() {
    let d = defs();
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    let day = w.day();
    let commands = [
        Command::BuyItem { owner: O, loc: LocId(0), item: "ring".into(), qty: 1, max_total: None },
        talk("classmate_a", "chat"),
        give("classmate_a", "ring"),
    ];
    let mut log = Vec::new();
    for (seq, command) in commands.into_iter().enumerate() {
        command.apply(&mut w).unwrap();
        log.push(LogEntry { minute: None, tick: day, seq: seq as u64, source: Source::Player, command });
    }
    w.end_day().unwrap();
    assert_eq!(replay(d.clone(), StartParams::new(ScenarioId(0), 42), &log, day + 1).unwrap().state, w.state);
    let save = SaveFile::new(&d, StartParams::new(ScenarioId(0), 42), w.state.clone(), log);
    let loaded = SaveFile::from_json(&save.to_json().unwrap()).unwrap();
    assert_eq!(World::from_snapshot(d, loaded.snapshot).unwrap().state, w.state);
}

#[test]
fn equipment_affinity_bonus_matches_the_recipients_tags_and_culture() {
    use manifest_core::items::{
        effects::{Effect, EffectKind},
        equipment::EquipSlot,
    };
    for (matching, expected) in [(true, 13), (false, 10)] {
        let mut d = defs();
        let data = Arc::make_mut(&mut d);
        let p = data.cast.persons.iter_mut().find(|p| p.key == "classmate_a").unwrap();
        p.tags.push("peer".into());
        p.culture = "test_culture".into();
        let item = data.items.items.iter_mut().find(|i| i.key == "ring").unwrap();
        let mut effect = Effect::plain(EffectKind::AffinityPct, 30);
        effect.tag = Some("peer".into());
        effect.culture = Some(if matching { "test_culture" } else { "other" }.into());
        item.effects = vec![effect];
        let mut w = World::new(d, ScenarioId(0), 42).unwrap();
        w.grant_item(O, "ring", 2).unwrap();
        Command::Equip { owner: O, wearer: "captain".into(), slot: EquipSlot::Accessory1, item: "ring".into() }
            .apply(&mut w)
            .unwrap();
        give("classmate_a", "ring").apply(&mut w).unwrap();
        assert_eq!(w.affection("classmate_a").unwrap().affinity, expected);
    }
}

#[test]
fn snapshots_reject_forged_interaction_limits_and_future_audiences() {
    let w = world();
    for which in 0..4 {
        let mut state = w.state.clone();
        let p = state.cast.persons.get_mut("classmate_a").unwrap();
        p.interactions.day = Some(w.day());
        match which {
            0 => p.interactions.talks = TALKS_PER_DAY + 1,
            1 => p.interactions.gained = AFFINITY_PER_DAY + 1,
            2 => p.interactions.audience = Some(w.day() + 1),
            _ => p.interactions.memories = vec!["字".repeat(MEMORY_CHARS + 1)],
        };
        assert!(World::from_snapshot(w.defs.clone(), state).is_err());
    }
}
