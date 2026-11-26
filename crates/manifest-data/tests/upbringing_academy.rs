//! 家乡、入学、同行、远足和实习船走实际 testbed 加载与命令路径。
use manifest_core::{
    Command, CoreError, OwnerId, ScenarioId, World,
    upbringing::{AfterChoice, NodeState, Phase, PlanSlot, Stage},
};
use std::sync::Arc;
fn defs() -> Arc<manifest_core::StaticData> {
    manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap()
}
fn world(d: Arc<manifest_core::StaticData>) -> World {
    let i = d.scenarios.iter().position(|s| s.key == "upbringing").unwrap();
    World::new(d, ScenarioId::from_idx(i), 42).unwrap()
}
fn slots(w: &World, after: Vec<AfterChoice>) -> Vec<PlanSlot> {
    let s = w.state.upbringing.as_ref().unwrap();
    after
        .into_iter()
        .enumerate()
        .map(|(i, after)| {
            let date = [s.month[0], s.month[1], 1 + i as u32 * 10].max(w.cast_date());
            let academy = w.upbringing_stage_on(date).unwrap().stage == Stage::Academy;
            PlanSlot { index: i as u8, lesson: academy.then(|| "lesson_numbers".into()), after: Some(after) }
        })
        .collect()
}
fn plan(w: &mut World, after: Vec<AfterChoice>) {
    let slots = slots(w, after);
    Command::PlanMonth { owner: OwnerId::Player, slots }.apply(w).unwrap();
}
fn answer(w: &mut World) {
    while w.pending_story2().is_some() {
        Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(w).unwrap();
    }
}
fn days(w: &mut World, count: u32) {
    for _ in 0..count {
        answer(w);
        w.end_day().unwrap();
    }
}
fn rest() -> AfterChoice {
    AfterChoice::activity("rest")
}
fn outing(person: &str) -> AfterChoice {
    let mut c = AfterChoice::activity("companion_walk");
    c.companion = Some(person.into());
    c.place = Some("home_tavern".into());
    c
}
#[test]
fn midmonth_admission_waits_for_the_critical_event_and_replans_only_unsettled_slots() {
    let mut d = defs();
    let dmut = Arc::make_mut(&mut d);
    dmut.upbringing.families[0].born = [1537, 1, 1];
    dmut.upbringing.families[0].stages[1].from = [1553, 1, 15];
    for p in &mut dmut.cast.persons {
        if ["classmate_a", "classmate_b"].contains(&p.key.as_str()) {
            p.born = [1537, 1, 1];
        }
    }
    dmut.cast.ties.push(manifest_core::cast::relations::TieDef {
        a: "classmate_a".into(),
        b: "classmate_b".into(),
        kind: manifest_core::cast::relations::Relation::Dating,
        since: [1553, 1, 1],
        to: None,
        when: vec![],
        basis: "original".into(),
        sources: vec![],
        story: None,
        open: true,
        tags: vec![],
    });
    let mut w = world(d.clone());
    assert!(w.active_ties().iter().any(|t| t.kind == manifest_core::cast::relations::Relation::Dating));
    assert_eq!(w.state.protagonist.as_ref().unwrap().age_on(w.cast_date()), Some(16));
    plan(&mut w, vec![rest(), rest(), rest()]);
    days(&mut w, 14);
    assert_eq!(w.cast_date(), [1553, 1, 15]);
    assert!(!w.state.cast.academy);
    assert_eq!(w.pending_story2().unwrap().track, "academy_entry");
    assert!(matches!(w.end_day(), Err(CoreError::UpbringingPaused)));
    assert_eq!(World::from_snapshot(d.clone(), w.state.clone()).unwrap().state, w.state);
    answer(&mut w);
    let s = w.state.upbringing.as_ref().unwrap();
    assert_eq!(s.phase, Phase::Plan);
    assert_eq!(s.next_slot, 1);
    assert_eq!(s.settled.len(), 1);
    assert!(w.state.cast.academy);
    assert!(w.validate_romance("classmate_a", manifest_core::cast::relations::RomanceAction::Heart).is_ok());
    assert!(w.validate_romance("classmate_a", manifest_core::cast::relations::RomanceAction::Dating).is_ok());
    assert!(w.validate_romance("classmate_a", manifest_core::cast::relations::RomanceAction::Lovers).is_err());
    assert!(w.validate_romance("classmate_a", manifest_core::cast::relations::RomanceAction::Partners).is_err());
    w.change_relation("classmate_a", manifest_core::cast::relations::Relation::Dating, false).unwrap();
    assert!(w.visible_relations("classmate_a").contains(&manifest_core::cast::relations::Relation::Dating));
    let enrolled = World::from_snapshot(d.clone(), w.state.clone()).unwrap();
    assert_eq!(enrolled.state, w.state);
    assert!(enrolled.validate_romance("classmate_a", manifest_core::cast::relations::RomanceAction::Dating).is_ok());
    assert!(w.active_ties().iter().any(|t| t.kind == manifest_core::cast::relations::Relation::Dating));
    plan(&mut w, vec![rest(), rest(), rest()]);
    days(&mut w, 6);
    assert_eq!(w.state.upbringing.as_ref().unwrap().settled.len(), 2);
    assert_eq!(World::from_snapshot(d, w.state.clone()).unwrap().state, w.state);
}
#[test]
fn invitations_obey_presence_preferences_and_the_two_per_month_limit() {
    let mut d = defs();
    Arc::make_mut(&mut d)
        .cast
        .persons
        .iter_mut()
        .find(|p| p.key == "classmate_a")
        .unwrap()
        .loves
        .push("companion_walk".into());
    let mut w = world(d.clone());
    w.change_affinity("classmate_a", 80).unwrap();
    let bad = slots(&w, vec![outing("classmate_a"); 3]);
    let before = w.state.clone();
    assert!(Command::PlanMonth { owner: OwnerId::Player, slots: bad }.apply(&mut w).is_err());
    assert_eq!(w.state, before);
    plan(&mut w, vec![outing("classmate_a"), outing("classmate_a"), rest()]);
    days(&mut w, 20);
    assert_eq!(w.state.upbringing.as_ref().unwrap().outings, 2);
    assert_eq!(w.affection("classmate_a").unwrap().affinity, 86);
    assert_eq!(w.affection("classmate_a").unwrap().experiences, 2);
    assert_eq!(World::from_snapshot(d, w.state.clone()).unwrap().state, w.state);
    let mut d = defs();
    Arc::make_mut(&mut d).upbringing.families[0]
        .companions
        .insert("visitor".into(), manifest_core::upbringing::CompanionRole::Friend);
    let mut absent = world(d);
    absent.state.cast.persons.entry("visitor".into()).or_default().met = true;
    assert!(!absent.upbringing_companion_present("visitor", Some("home_tavern"), absent.cast_date()));
    plan(&mut absent, vec![outing("visitor"), rest(), rest()]);
    let cash = absent.agent(OwnerId::Player).unwrap().cash;
    days(&mut absent, 10);
    assert_eq!(absent.state.upbringing.as_ref().unwrap().outings, 1);
    assert_eq!(absent.state.upbringing.as_ref().unwrap().last[0].success, Some(false));
    assert_eq!(absent.agent(OwnerId::Player).unwrap().cash, cash);
    assert_eq!(absent.affection("visitor").unwrap().affinity, 0);
}
#[test]
fn excursion_reveals_adjacent_nodes_and_rewards_only_the_first_solution() {
    let d = defs();
    let mut w = world(d.clone());
    assert_eq!(w.excursion_node_state("test_walk", "path_0"), NodeState::New);
    assert_eq!(w.excursion_node_state("test_walk", "path_1"), NodeState::Unknown);
    assert!(w.check_excursion("test_walk", "path_1").is_err());
    let mut c = AfterChoice::activity("excursion_walk");
    c.excursion = Some("test_walk".into());
    c.node = Some("path_0".into());
    plan(&mut w, vec![c.clone(); 3]);
    days(&mut w, 10);
    assert_eq!(w.excursion_node_state("test_walk", "path_0"), NodeState::Seen);
    assert_eq!(w.excursion_node_state("test_walk", "path_1"), NodeState::New);
    assert_eq!(w.upbringing_growth("wit"), 0);
    w.grant_item(OwnerId::Player, "ribbon", 1).unwrap();
    days(&mut w, 10);
    assert_eq!(w.excursion_node_state("test_walk", "path_0"), NodeState::Solved);
    assert_eq!(w.upbringing_growth("wit"), 5);
    let mut loaded = World::from_snapshot(d, w.state.clone()).unwrap();
    assert_eq!(loaded.state, w.state);
    days(&mut w, 11);
    days(&mut loaded, 11);
    assert_eq!(loaded.state, w.state);
    assert_eq!(w.upbringing_growth("wit"), 5);
    assert_eq!(w.state.upbringing.as_ref().unwrap().activity_counts["excursion_walk"], 2);
}
#[test]
fn borrowed_training_ship_has_zero_assets_cannot_trade_and_is_returned_after_sailing() {
    let mut d = defs();
    Arc::make_mut(&mut d).rules.money.enabled = true;
    let mut w = world(d.clone());
    let ledger = w.agent(OwnerId::Player).unwrap().ledger.clone();
    let limit = w.loan_limit(OwnerId::Player);
    let cash = w.agent(OwnerId::Player).unwrap().cash;
    let total = w.all_money();
    plan(&mut w, vec![AfterChoice::activity("training_voyage"), rest(), rest()]);
    let f = w.fleets_of(OwnerId::Player).next().unwrap();
    let id = f.id;
    assert_eq!(f.book_value(), 0);
    assert_eq!(w.agent(OwnerId::Player).unwrap().ledger, ledger);
    assert_eq!(w.loan_limit(OwnerId::Player), limit);
    assert_eq!(w.agent(OwnerId::Player).unwrap().cash, cash);
    let before = w.state.clone();
    for command in [
        Command::SellShip { owner: OwnerId::Player, fleet: id, ship: 0 },
        Command::Buy { owner: OwnerId::Player, fleet: id, good: manifest_core::GoodId(0), qty: 1, max_total: None },
        Command::Transfer {
            owner: OwnerId::Player,
            from: manifest_core::warehouse::Holder::Fleet(id),
            to: manifest_core::warehouse::Holder::Warehouse(manifest_core::LocId(0)),
            good: manifest_core::GoodId(0),
            qty: 1,
        },
    ] {
        assert!(command.apply(&mut w).is_err());
        assert_eq!(w.state, before);
    }
    let dest = w.defs.locations.iter().position(|l| l.key == "test_east").unwrap();
    Command::SetSail { owner: OwnerId::Player, fleet: id, dest: manifest_core::LocId::from_idx(dest) }
        .apply(&mut w)
        .unwrap();
    days(&mut w, 3);
    let mut loaded = World::from_snapshot(d, w.state.clone()).unwrap();
    assert_eq!(loaded.state, w.state);
    days(&mut w, 7);
    days(&mut loaded, 7);
    assert_eq!(loaded.state, w.state);
    assert!(w.state.upbringing.as_ref().unwrap().training.is_none());
    assert!(!w.state.fleets.contains_key(&id));
    assert_eq!(w.all_money(), total);
    assert!(w.money_conserved());
    assert_eq!(w.agent(OwnerId::Player).unwrap().cash, cash);
}

#[test]
fn excursion_helper_capability_is_required_and_cannot_be_attached_to_an_unrelated_activity() {
    let mut d = defs();
    let edit = Arc::make_mut(&mut d);
    edit.story2.skills.insert("test_helper".into());
    edit.upbringing.helpers.insert("classmate_a".into(), vec!["test_helper".into()]);
    let node = &mut edit.upbringing.excursions[0].nodes[0];
    node.tools.clear();
    node.companion_skills = vec!["test_helper".into()];
    edit.upbringing
        .activities
        .iter_mut()
        .find(|a| a.key == "excursion_walk")
        .unwrap()
        .needs
        .push(manifest_core::upbringing::Need::Companion);
    edit.cast.persons.iter_mut().find(|p| p.key == "classmate_a").unwrap().loves.push("excursion_walk".into());
    let mut w = world(d);
    w.change_affinity("classmate_a", 80).unwrap();
    let mut forged = rest();
    forged.companion = Some("classmate_a".into());
    let bad = slots(&w, vec![forged, rest(), rest()]);
    let before = w.state.clone();
    assert!(Command::PlanMonth { owner: OwnerId::Player, slots: bad }.apply(&mut w).is_err());
    assert_eq!(w.state, before);
    let mut c = AfterChoice::activity("excursion_walk");
    c.excursion = Some("test_walk".into());
    c.node = Some("path_0".into());
    c.companion = Some("classmate_a".into());
    plan(&mut w, vec![c.clone(), c, rest()]);
    days(&mut w, 10);
    assert_eq!(w.excursion_node_state("test_walk", "path_0"), NodeState::Seen);
    days(&mut w, 10);
    assert_eq!(w.excursion_node_state("test_walk", "path_0"), NodeState::Solved);
    assert_eq!(w.upbringing_growth("wit"), 5);
}

#[test]
fn impossible_outing_exploration_and_borrowed_asset_snapshots_are_rejected() {
    let d = defs();
    let mut w = world(d.clone());
    let mut bad = w.state.clone();
    bad.upbringing
        .as_mut()
        .unwrap()
        .excursion_nodes
        .entry("test_walk".into())
        .or_default()
        .insert("path_0".into(), NodeState::Unknown);
    assert!(World::from_snapshot(d.clone(), bad).is_err());
    plan(&mut w, vec![AfterChoice::activity("training_voyage"), rest(), rest()]);
    let id = w.state.upbringing.as_ref().unwrap().training.as_ref().unwrap().fleet;
    let mut bad = w.state.clone();
    bad.fleets.get_mut(&id).unwrap().ships[0].book_value = 100;
    assert!(World::from_snapshot(d.clone(), bad).is_err());
    let mut bad = w.state.clone();
    bad.upbringing.as_mut().unwrap().training.as_mut().unwrap().origin =
        Some(manifest_core::LocId::from_idx(d.locations.len()));
    assert!(World::from_snapshot(d, bad).is_err());
}

#[test]
fn removing_the_family_returns_earned_cargo_even_when_the_training_ship_is_at_sea() {
    let mut d = defs();
    let mut w = world(d.clone());
    let home = w.upbringing_location().unwrap();
    plan(&mut w, vec![AfterChoice::activity("training_voyage"), rest(), rest()]);
    let id = w.state.upbringing.as_ref().unwrap().training.as_ref().unwrap().fleet;
    let good = manifest_core::GoodId::from_idx(0);
    // 模拟故事送到旗舰的货物；学校提供的粮水不在可转移货舱中。
    w.state.fleets.get_mut(&id).unwrap().cargo.insert(good, 2);
    let dest = w.defs.locations.iter().position(|l| l.key == "test_east").unwrap();
    Command::SetSail { owner: OwnerId::Player, fleet: id, dest: manifest_core::LocId::from_idx(dest) }
        .apply(&mut w)
        .unwrap();
    let money = w.all_money();
    let changed = Arc::make_mut(&mut d);
    changed.upbringing = Default::default();
    changed.cast = Default::default();
    for old_without_origin in [false, true] {
        let mut saved = w.state.clone();
        if old_without_origin {
            saved.upbringing.as_mut().unwrap().training.as_mut().unwrap().origin = None;
        }
        let loaded = World::from_snapshot(d.clone(), saved).unwrap();
        assert!(loaded.state.upbringing.is_none());
        assert!(!loaded.state.fleets.contains_key(&id));
        assert_eq!(loaded.state.locations[home.idx()].warehouses[&OwnerId::Player].stock[&good], 2);
        assert_eq!(loaded.all_money(), money);
        assert!(loaded.money_conserved());
        assert_eq!(World::from_snapshot(d.clone(), loaded.state.clone()).unwrap().state, loaded.state);
    }
}
