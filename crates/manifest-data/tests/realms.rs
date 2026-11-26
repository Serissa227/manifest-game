//! E63：真实帷幕、通行许可、逐日时间差和存档重放。
#[path = "support/history.rs"]
mod fixture;
use fixture::*;
use manifest_core::{
    realms::*,
    world::{FleetLocation, Voyage},
    *,
};
use serde_json::json;
use std::sync::Arc;
fn world() -> World {
    let mut w = fixture::world(json!([]));
    let d = Arc::make_mut(&mut w.defs);
    d.realms = toml::from_str(include_str!("../../../data/worlds/testbed/samples/realms.toml")).unwrap();
    d.map.terrain.fill(nav::Terrain::Deep);
    d.map.region.fill(u16::MAX);
    d.locations[0].cell = Cell::new(15, 20);
    d.locations[1].cell = Cell::new(20, 20);
    d.realms.realms[0].veil.cells = vec![Cell::new(20, 20)];
    for t in &mut d.story2.tracks {
        t.auto = false
    }
    d.nav = Arc::new(nav::NavTable::build(
        &d.map,
        &d.regions,
        d.locations.len(),
        &[(LocId(0), d.locations[0].cell), (LocId(1), d.locations[1].cell)],
    ));
    w.state.story2 = Default::default();
    w
}
fn manual(w: &mut World) {
    Arc::make_mut(&mut w.defs).manual_navigation = true;
    let f = w.flagship(O).unwrap();
    w.fleet_mut(f).unwrap().location =
        FleetLocation::AtSea(Voyage::Manual { manual: navigation::ManualVoyage::new(Cell::new(19, 20), 90) });
}
fn inside(w: &mut World) {
    w.grant_item(O, "ring", 1).unwrap();
    manual(w);
    *w = w.navigation_projection(1000).unwrap();
    assert_eq!(w.realm_status("sample_realm"), RealmStatus::Entered);
    assert_eq!(w.fleet(w.flagship(O).unwrap()).unwrap().docked_at(), Some(LocId(1)));
    w.state.navigation = Default::default();
}
#[test]
fn no_key_pushes_back_without_showing_private_port() {
    let mut w = world();
    manual(&mut w);
    assert!(!w.location_visible(LocId(1)));
    let state = w.state.clone();
    let course = w.preview_course(w.flagship(O).unwrap(), &[], 0).unwrap();
    assert_eq!(w.state, state);
    assert!(course.voyage.pos.cell().x < 19);
    let projected = w.navigation_projection(1000).unwrap();
    assert_eq!(projected.realm_status("sample_realm"), RealmStatus::VeilFound);
    assert!(!projected.location_visible(LocId(1)));
    assert!(projected.fleet(projected.flagship(O).unwrap()).unwrap().docked_at().is_none());
    assert_eq!(restored(&projected).state_hash(), projected.state_hash());
}
#[test]
fn key_opens_real_port_and_trading_is_still_accounted() {
    let mut w = world();
    inside(&mut w);
    assert!(w.location_visible(LocId(1)));
    assert!(w.location_open(LocId(1)));
    let before = w.agent(O).unwrap().cash;
    buy(&mut w, 1);
    assert!(w.agent(O).unwrap().cash < before);
    assert!(w.money_conserved());
    assert_eq!(restored(&w).state_hash(), w.state_hash());
}
#[test]
fn npc_paths_detour_around_the_veil_and_cannot_trade_inside() {
    let mut w = world();
    let d = Arc::make_mut(&mut w.defs);
    let mut port = d.locations[0].clone();
    port.key = "outside".into();
    port.cell = Cell::new(25, 20);
    d.locations.push(port);
    d.nav = Arc::new(nav::NavTable::build(&d.map, &d.regions, d.locations.len(), &[]));
    let mut fleet = w.fleet(w.flagship(O).unwrap()).unwrap().clone();
    fleet.owner = OwnerId::Company(CompanyId(0));
    let route = w.route_for(&fleet, LocId(2)).unwrap();
    assert!(!route.contains(&Cell::new(20, 20)));
    assert!(w.route_for(&fleet, LocId(1)).is_none());
    inside(&mut w);
    assert!(!w.realm_port_allowed(fleet.owner, LocId(1)));
}
#[test]
fn otherworld_days_match_individual_economic_and_history_settlement() {
    let mut fast = world();
    inside(&mut fast);
    let mut daily = fast.clone();
    Arc::make_mut(&mut daily.defs).realms.realms[0].otherworld.as_mut().unwrap().time_ratio = 1;
    let start = fast.day();
    fast.end_day().unwrap();
    advance(&mut daily, 3);
    assert_eq!(fast.day(), start + 3);
    let mut a = serde_json::to_value(&fast.state).unwrap();
    let mut b = serde_json::to_value(&daily.state).unwrap();
    a.as_object_mut().unwrap().remove("realms");
    b.as_object_mut().unwrap().remove("realms");
    assert_eq!(a, b);
    assert_eq!(restored(&fast).state_hash(), fast.state_hash());
}
#[test]
fn time_debt_stops_at_real_story_decision_and_is_saved() {
    let mut w = world();
    inside(&mut w);
    let start = w.day();
    let date = w.defs.calendar.date_of(start + 2);
    let year = w.defs.rules.world.start_year + i64::from(date.year) - 1;
    let d = Arc::make_mut(&mut w.defs);
    d.realms.realms[0].otherworld.as_mut().unwrap().time_ratio = 91;
    d.story2.tracks.push(
        serde_json::from_value(json!({
            "key":"realm_appointment","name":"测试约定","kind":"request","start":"first",
            "chapters":[{"key":"first","title":"测试约定","text":"这是时间差约定测试。",
                "when":[{"kind":"date","from":[year,date.month,date.day]}],
                "choices":[{"key":"done","text":"完成约定测试。","next":"done"}]}]
        }))
        .unwrap(),
    );
    w.end_day().unwrap();
    assert_eq!(w.day(), start + 2);
    assert!(w.state.realms.debt > 0);
    assert_eq!(w.pending_story2().unwrap().track, "realm_appointment");
    assert_eq!(restored(&w).state_hash(), w.state_hash());
}
#[test]
fn time_ratio_cap_and_reference_validation_are_strict() {
    let mut w = world();
    inside(&mut w);
    Arc::make_mut(&mut w.defs).realms.realms[0].otherworld.as_mut().unwrap().time_ratio = 91;
    let day = w.day();
    w.end_day().unwrap();
    assert_eq!(w.day() - day, 91);
    assert_eq!(w.state.realms.debt, 0);
    for mode in 0..4 {
        let mut w = world();
        let d = Arc::make_mut(&mut w.defs);
        let r = &mut d.realms.realms[0];
        match mode {
            0 => r.key_items = vec!["absent".into()],
            1 => r.otherworld.as_mut().unwrap().max_skip_days = 91,
            2 => r.rules.clear(),
            _ => r.veil.push = 0,
        }
        assert!(!validation::validate(d).is_empty());
    }
}
#[test]
fn classic_never_writes_realms() {
    let d = manifest_data::load_shared(&manifest_data::find_data_dir().unwrap()).unwrap();
    let w = World::new(d, ScenarioId(0), 42).unwrap();
    assert!(serde_json::to_value(w.state).unwrap().get("realms").is_none());
}

#[test]
fn intermediate_commands_and_segmented_replay_are_not_lost_in_time_debt() {
    let mut original = world();
    inside(&mut original);
    let initial = original.clone();
    let start = original.day();
    let fleet = original.flagship(O).unwrap();
    let good = original.defs.find_good("grain").unwrap();
    let cmd = Command::Buy { owner: O, fleet, good, qty: 1, max_total: None };
    let entry = LogEntry { tick: start + 1, seq: 0, source: Source::Ai, command: cmd.clone(), minute: None };
    original
        .end_day_with(|w| {
            if w.day() == start + 1 {
                cmd.apply(w).unwrap();
            }
            true
        })
        .unwrap();
    assert_eq!(original.day(), start + 3);
    assert_eq!(original.fleet(fleet).unwrap().cargo.get(&good), Some(&1));
    let mut replayed = initial.clone();
    replay::replay_onto(&mut replayed, std::slice::from_ref(&entry), original.day()).unwrap();
    assert_eq!(replayed.state_hash(), original.state_hash());
    let mut split = initial;
    replay::replay_onto(&mut split, std::slice::from_ref(&entry), start + 1).unwrap();
    assert_eq!(split.day(), start + 1);
    assert_eq!(split.state.realms.debt, 2);
    replay::replay_onto(&mut split, &[entry], original.day()).unwrap();
    assert_eq!(split.state_hash(), original.state_hash());
}

#[test]
fn alternative_key_groups_cross_the_same_veil_and_keep_realm_key_rejection() {
    for use_items in [true, false] {
        let mut w = world();
        let r = &mut Arc::make_mut(&mut w.defs).realms.realms[0];
        r.key_items.clear();
        r.key_any = vec![
            KeyGroup { items: vec!["ring".into(), "ribbon".into()], ..Default::default() },
            KeyGroup { flags: vec!["star_pass".into()], ..Default::default() },
        ];
        assert!(!w.realm_passable(O, "sample_realm"));
        let err = Command::BuyMarketReport { owner: O, loc: LocId(1) }.validate(&w).unwrap_err();
        assert!(err.to_string().contains("realm.key"));
        if use_items {
            w.grant_item(O, "ring", 1).unwrap();
            assert!(!w.realm_passable(O, "sample_realm"), "同组物品必须全部具备");
            w.grant_item(O, "ribbon", 1).unwrap();
        } else {
            w.state.story2.flags.insert("star_pass".into());
        }
        assert!(w.realm_passable(O, "sample_realm"));
        manual(&mut w);
        w = w.navigation_projection(1000).unwrap();
        assert_eq!(w.realm_status("sample_realm"), RealmStatus::Entered);
        assert_eq!(w.fleet(w.flagship(O).unwrap()).unwrap().docked_at(), Some(LocId(1)));
        assert_eq!(restored(&w).state_hash(), w.state_hash());
    }
}

#[test]
fn alternative_key_groups_reject_empty_unknown_duplicate_and_unkeyed_definitions() {
    for group in [
        KeyGroup::default(),
        KeyGroup { items: vec!["missing".into()], ..Default::default() },
        KeyGroup { items: vec!["ring".into(), "ring".into()], ..Default::default() },
        KeyGroup { flags: vec!["invalid flag".into()], ..Default::default() },
        KeyGroup { completed_tracks: vec!["missing".into()], ..Default::default() },
    ] {
        let mut w = world();
        let r = &mut Arc::make_mut(&mut w.defs).realms.realms[0];
        r.key_items.clear();
        r.key_any = vec![group];
        assert!(!validation::validate(&w.defs).is_empty());
    }
    let mut w = world();
    Arc::make_mut(&mut w.defs).realms.realms[0].key_items.clear();
    assert!(!validation::validate(&w.defs).is_empty());
}

#[test]
fn atlantis_accepts_awakened_tablet_or_completed_star_route_without_the_tablet() {
    let mut d = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap();
    for t in &mut Arc::make_mut(&mut d).story2.tracks {
        t.auto = false;
    }
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == "free_1557").unwrap());
    let base = World::new(d.clone(), sid, 42).unwrap();
    let mut tablet = base.clone();
    assert!(!tablet.realm_passable(O, "atlantis"));
    tablet.grant_item(O, "tabula_smaragdina", 1).unwrap();
    assert!(!tablet.realm_passable(O, "atlantis"), "未醒来的书仍不能通行");
    tablet.state.story2.flags.insert("c11_atlantis_key_ready".into());
    assert!(tablet.realm_passable(O, "atlantis"));

    let mut star = base;
    star.state.day = manifest_core::scenario::day_of(&d, [1563, 8, 25]).unwrap();
    let family = d.upbringing.family("mio").unwrap();
    // 自由航海的内核夹具没有身份；补入具名主角的真实出生资料以满足该请托的年龄门槛。
    star.state.protagonist = Some(manifest_core::scenario::ProtagonistIdentity {
        protagonist: Some("mio".into()),
        template: None,
        born: family.born,
        gender: family.gender,
    });
    star.state.cast.place =
        Some(manifest_core::cast::CastPlace { loc: d.find_loc("mocha").unwrap(), venue: String::new() });
    star.grant_item(O, "majid_hidden_route", 1).unwrap();
    star.state.items.owners.entry(O).or_default().skill_xp.insert("astral_navigation".into(), 1);
    assert!(!star.realm_passable(O, "atlantis"));
    star.start_story2("c11_najma_star_key").unwrap();
    assert_eq!(star.pending_story2().unwrap().track, "c11_najma_star_key");
    Command::StoryAnswer { owner: O, choice: 0 }.apply(&mut star).unwrap();
    assert_eq!(star.state.story2.tracks["c11_najma_star_key"].status, manifest_core::story2::Status::Done);
    assert_eq!(star.item_quantity(O, "tabula_smaragdina"), 1);
    // 两个来源共用同一物品/许可旗标；完成记录才明确证明星路已对读。
    star.state.items.owners.get_mut(&O).unwrap().quantities.remove("tabula_smaragdina");
    assert!(star.realm_passable(O, "atlantis"));
    for w in [&mut tablet, &mut star] {
        let realm = d.realms.realm("atlantis").unwrap();
        assert!(w.realm_cell_allowed(O, realm.veil.cells[0]));
        assert!(w.realm_port_allowed(O, d.find_loc("atlantis_port").unwrap()));
        w.state.story2.flags.insert("atlantis_verdict_close".into());
        assert!(!w.realm_passable(O, "atlantis"), "关闭帷幕的裁决仍适用于所有钥匙");
    }
}
