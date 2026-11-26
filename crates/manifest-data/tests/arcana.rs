//! E60：封闭目标、材料扣除、上限、情报权限与重放。
#[path = "support/history.rs"]
mod fixture;
use fixture::*;
use manifest_core::{arcana::*, *};
use serde_json::json;
use std::sync::Arc;
fn world() -> World {
    let mut w = fixture::world(json!([]));
    w.state.arcana.learned.insert("sample_wind".into());
    w.state.items.owners.entry(O).or_default().skill_xp.insert("lang_test".into(), 1);
    w
}
fn cast(w: &World, k: &str) -> Command {
    Command::CastSpell { owner: O, spell: k.into(), target: Target::Fleet(w.flagship(O).unwrap()) }
}
fn spell(w: &mut World, key: &str, effect: Effect) {
    let d = Arc::make_mut(&mut w.defs);
    let mut s = d.arcana.spells[0].clone();
    s.key = key.into();
    s.effect = effect;
    s.public = true;
    d.arcana.spells.push(s);
}
#[test]
fn costs_cooldowns_and_target_validation_are_atomic() {
    let mut w = world();
    let c = cast(&w, "sample_wind");
    reject(&mut w, c.clone());
    w.grant_item(O, "ring", 2).unwrap();
    let cash = w.agent(O).unwrap().cash;
    let speed = w.fleet_speed_bonus(w.flagship(O).unwrap());
    c.validate(&w).unwrap();
    assert_eq!(w.item_quantity(O, "ring"), 2);
    c.apply(&mut w).unwrap();
    assert_eq!(w.item_quantity(O, "ring"), 1);
    assert_eq!(w.agent(O).unwrap().cash, cash - 10);
    assert!(w.fleet_speed_bonus(w.flagship(O).unwrap()) > speed);
    assert_eq!(w.spell_cooldown("sample_wind"), 7);
    reject(&mut w, c);
    assert!(w.money_conserved());
    advance(&mut w, 3);
    assert_eq!(w.arcana_bonus(w.flagship(O).unwrap(), "fleet_speed"), 0);
    assert_eq!(w.spell_cooldown("sample_wind"), 4);
}
#[test]
fn active_spells_share_a_total_cap_and_expire() {
    let mut w = world();
    w.grant_item(O, "ring", 3).unwrap();
    for k in ["wind_a", "wind_b", "wind_c"] {
        spell(&mut w, k, Effect::FleetSpeed { pct: 30, days: 2 });
        cast(&w, k).apply(&mut w).unwrap();
    }
    assert_eq!(w.arcana_bonus(w.flagship(O).unwrap(), "fleet_speed"), MAX_PCT);
    advance(&mut w, 2);
    assert_eq!(w.arcana_bonus(w.flagship(O).unwrap(), "fleet_speed"), 0);
}
#[test]
fn alchemy_cannot_inflate_value_or_consume_equipped_materials() {
    let mut w = world();
    spell(&mut w, "make_coin", Effect::Alchemy { items: std::collections::BTreeMap::from([("coin".into(), 1)]) });
    w.grant_item(O, "ring", 1).unwrap();
    let c = Command::CastSpell { owner: O, spell: "make_coin".into(), target: Target::SelfTarget };
    let slot = items::equipment::EquipSlot::Accessory1;
    Command::Equip { owner: O, wearer: "captain".into(), slot, item: "ring".into() }.apply(&mut w).unwrap();
    reject(&mut w, c.clone());
    Command::Unequip { owner: O, wearer: "captain".into(), slot }.apply(&mut w).unwrap();
    c.apply(&mut w).unwrap();
    assert_eq!(w.item_quantity(O, "ring"), 0);
    assert_eq!(w.item_quantity(O, "coin"), 1);
    reject(&mut w, c);
    let d = Arc::make_mut(&mut w.defs);
    d.arcana.spells.last_mut().unwrap().effect =
        Effect::Alchemy { items: std::collections::BTreeMap::from([("coin".into(), 2)]) };
    assert!(!validation::validate(d).is_empty());
}
#[test]
fn divination_requires_known_current_authorized_intelligence() {
    let mut w = world();
    w.grant_item(O, "ring", 2).unwrap();
    spell(&mut w, "divine", Effect::Divination);
    let c = Command::CastSpell { owner: O, spell: "divine".into(), target: Target::Event(EVENT.into()) };
    Arc::make_mut(&mut w.defs).history.events[0].knowledge = Some("private_event".into());
    reject(&mut w, c.clone());
    w.state.story2.flags.insert("private_event".into());
    advance(&mut w, 1);
    c.apply(&mut w).unwrap();
    assert!(w.state.history.known_events[EVENT].exact);
    assert_eq!(w.state.history.known_events[EVENT].day, w.day());
    reject(&mut w, Command::CastSpell { owner: O, spell: "divine".into(), target: Target::Event("absent".into()) });
}
#[test]
fn closed_effects_protected_texts_and_all_reference_limits_are_checked() {
    let cost: Cost = serde_json::from_value(json!({"items":[{"item":"ring","qty":1}]})).unwrap();
    assert_eq!(cost.items["ring"], 1);
    assert!(
        serde_json::from_value::<Cost>(json!({"items":[{"item":"ring","qty":1},{"item":"ring","qty":2}]})).is_err()
    );
    assert!(serde_json::from_value::<Effect>(json!({"kind":"cash","value":999})).is_err());
    assert_eq!(serde_json::to_value(Target::SelfTarget).unwrap(), json!("Self"));
    for n in 0..6 {
        let mut w = world();
        let d = Arc::make_mut(&mut w.defs);
        match n {
            0 => d.arcana.spells[0].effect = Effect::FleetSpeed { pct: 31, days: 3 },
            1 => d.arcana.spells[0].effect = Effect::Fog { pct: 10, days: 91 },
            2 => d.arcana.spells[0].cooldown_days = 0,
            3 => d.arcana.spells[0].school = "absent".into(),
            4 => d.items.items.iter_mut().find(|i| i.key == "ring").unwrap().tags.push("sacred_relic".into()),
            _ => d.arcana.spells[0].cost = Cost::default(),
        };
        assert!(!validation::validate(d).is_empty(), "{n}");
    }
}
#[test]
fn save_and_replay_keep_the_same_cost_effect_and_cooldown() {
    let mut w = world();
    w.grant_item(O, "ring", 1).unwrap();
    let mut other = w.clone();
    let start = w.day();
    let c = cast(&w, "sample_wind");
    c.apply(&mut w).unwrap();
    let mut saved = restored(&w);
    advance(&mut w, 3);
    advance(&mut saved, 3);
    replay::replay_onto(
        &mut other,
        &[LogEntry { tick: start, seq: 0, source: Source::Player, command: c, minute: None }],
        w.day(),
    )
    .unwrap();
    assert_eq!(saved.state_hash(), w.state_hash());
    assert_eq!(other.state_hash(), w.state_hash());
    let mut bad = w.state.clone();
    bad.arcana.last.insert("absent".into(), start);
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
}
#[test]
fn classic_never_writes_an_empty_arcana_block() {
    let d = manifest_data::load_shared(&manifest_data::find_data_dir().unwrap()).unwrap();
    let w = World::new(d, ScenarioId(0), 42).unwrap();
    assert!(serde_json::to_value(&w.state).unwrap().get("arcana").is_none());
}

#[test]
fn equipped_and_story_spell_sources_use_the_same_known_spell_gate() {
    let mut w = world();
    w.state.arcana.learned.clear();
    let d = Arc::make_mut(&mut w.defs);
    let mut effect = items::effects::Effect::plain(items::effects::EffectKind::Spell, 1);
    effect.spell = Some("sample_wind".into());
    d.items.items.iter_mut().find(|i| i.key == "ring").unwrap().effects.push(effect);
    for track in &mut d.story2.tracks {
        track.auto = false;
    }
    d.story2.tracks.push(serde_json::from_value(json!({
        "key":"learn_arcana","name":"测试授术","kind":"request","start":"first","auto":false,
        "chapters":[{"key":"first","title":"测试授术","text":"这是授术测试。",
            "choices":[{"key":"learn","text":"学习测试法术。","next":"done","effects":[{"kind":"learn_spell","spell":"sample_wind"}]}]}]
    })).unwrap());
    w.state.story2 = Default::default();
    w.grant_item(O, "ring", 1).unwrap();
    let slot = items::equipment::EquipSlot::Accessory1;
    assert!(!w.spell_known("sample_wind"));
    Command::Equip { owner: O, wearer: "captain".into(), slot, item: "ring".into() }.apply(&mut w).unwrap();
    assert!(w.spell_known("sample_wind"));
    Command::Unequip { owner: O, wearer: "captain".into(), slot }.apply(&mut w).unwrap();
    assert!(!w.spell_known("sample_wind"));
    w.start_story2("learn_arcana").unwrap();
    Command::StoryAnswer { owner: O, choice: 0 }.apply(&mut w).unwrap();
    assert!(w.spell_known("sample_wind"));
    assert!(restored(&w).spell_known("sample_wind"));
    assert!(w.story2_conditions(&[story2::Condition::Spell { spell: "sample_wind".into() }], w.day()));
}

#[test]
fn speed_spell_changes_actual_manual_sailing_and_matches_preview() {
    let mut w = world();
    let d = Arc::make_mut(&mut w.defs);
    d.manual_navigation = true;
    d.map.terrain.fill(nav::Terrain::Deep);
    d.map.region.fill(0);
    d.nav = Arc::new(nav::NavTable::build(&d.map, &d.regions, d.locations.len(), &[]));
    let cell = Cell::new(d.map.width / 2, d.map.height / 2);
    let heading = w.weather_at(cell).map_or(90, |v| u16::from(v.sea.wind_dir) * 45);
    let fleet = w.flagship(O).unwrap();
    let start = navigation::ManualVoyage::new(cell, heading);
    let pos = start.pos;
    w.fleet_mut(fleet).unwrap().location = world::FleetLocation::AtSea(world::Voyage::Manual { manual: start });
    w.fleet_mut(fleet).unwrap().food = 100;
    w.fleet_mut(fleet).unwrap().water = 100;
    let control = w.preview_course(fleet, &[], 0).unwrap();
    w.grant_item(O, "ring", 1).unwrap();
    cast(&w, "sample_wind").apply(&mut w).unwrap();
    let spell = w.preview_course(fleet, &[], 0).unwrap();
    let distance = |course: &navigation::Course| {
        let p = course.points.iter().find(|p| p.minute == 60).unwrap().pos;
        (p.x - pos.x).pow(2) + (p.y - pos.y).pow(2)
    };
    assert!(distance(&spell) > distance(&control));
    advance(&mut w, 1);
    let actual = match &w.fleet(fleet).unwrap().location {
        world::FleetLocation::AtSea(world::Voyage::Manual { manual }) => manual.pos,
        world::FleetLocation::Docked(loc) => navigation::SubCell::center(w.defs.loc(*loc).cell),
        _ => panic!("测试舰队不应变为自动航线"),
    };
    assert_eq!(actual, spell.voyage.pos);
}
