//! testbed 的动态属性、检定、岗位上限与任职生命周期。
use manifest_core::captain::{AttrHook, Birthday, HookDef};
use manifest_core::mates::{MateRole, RoleTarget};
use manifest_core::story::Check;
use manifest_core::{Command, MateId, OwnerId, ScenarioId, World};
use std::{path::PathBuf, sync::Arc};
const PLAYER: OwnerId = OwnerId::Player;
fn data() -> PathBuf {
    manifest_data::find_data_dir().unwrap()
}
fn world() -> World {
    let mut d = (*manifest_data::load_world(&data(), "testbed").unwrap()).clone();
    let sample = manifest_core::testkit::tiny_defs();
    let mut mate = sample.mates[0].clone();
    mate.home = d.scenarios[0].start;
    mate.abilities.insert("astronomy".into(), 83);
    d.mates = vec![mate.clone(), mate];
    d.mates[1].key = "second".into();
    let year = d.rules.world.start_year - 18;
    let mut w = World::new(Arc::new(d), ScenarioId(0), 17).unwrap();
    Command::CreateCaptain {
        owner: PLAYER,
        birthday: Birthday { year, month: 1, day: 31 },
        answers: vec!["library".into()],
        alloc: vec![1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
        genius: None,
    }
    .apply(&mut w)
    .unwrap();
    for m in w.state.mates.values_mut() {
        m.owner = Some(PLAYER);
        m.role = MateRole::None;
    }
    w
}
#[test]
fn dynamic_attributes_and_ratings_feed_checks_and_hooks() {
    let w = world();
    let c = &w.defs.captain;
    let check = |key: &str| Check { attr: c.check_index(key).unwrap(), base_pct: 10, per_pct: 2 };
    assert_eq!(w.story_check_pct(&check("navigation")), 14);
    assert_eq!(w.story_check_pct(&check("mariner")), 56);
    assert_eq!(w.story_check_pct(&check("society")), 95);
    assert_eq!(w.attr_hook(PLAYER, AttrHook::FlagshipSpeed), 200);
    assert_eq!(w.attr_hook(PLAYER, AttrHook::MarketWindow), 3);
    assert_eq!(w.attr_hook(PLAYER, AttrHook::Honor), 50);
}
#[test]
fn genius_creation_uses_the_market_window_hook_without_a_numeracy_key() {
    let mut d = (*manifest_data::load_world(&data(), "testbed").unwrap()).clone();
    d.captain.attributes[7].key = "reckoning".into();
    let year = d.rules.world.start_year - 18;
    let mut w = World::new(Arc::new(d), ScenarioId(0), 17).unwrap();
    Command::CreateCaptain {
        owner: PLAYER,
        birthday: Birthday { year, month: 1, day: 31 },
        answers: vec!["library".into()],
        alloc: vec![3, 0, 0, 0, 0, 0, 0, 5, 0, 0],
        genius: Some("ses".into()),
    }
    .apply(&mut w)
    .unwrap();
    assert_eq!(w.attr_hook(PLAYER, AttrHook::MarketWindow), 7);
    assert_eq!(w.captain_profile(PLAYER).unwrap().genius.as_deref(), Some("ses"));
}
#[test]
fn additive_attributes_obey_individual_and_global_hook_caps() {
    let mut w = world();
    let d = Arc::make_mut(&mut w.defs);
    // 两项属性共同影响航速；先各自上限，再取世界全局上限。
    d.captain.attributes[0].hooks.push(HookDef { hook: AttrHook::FlagshipSpeed, per_point: 10_000, max: Some(800) });
    assert_eq!(w.attr_hook(PLAYER, AttrHook::FlagshipSpeed), 900);
    w.state.agents.get_mut(&PLAYER).unwrap().captain.as_mut().unwrap().attrs[3] = i64::MAX;
    assert_eq!(w.attr_hook(PLAYER, AttrHook::FogReveal), 6);
    assert_eq!(w.attr_hook(PLAYER, AttrHook::FlagshipSpeed), 900);
}
#[test]
fn custom_roles_use_declared_abilities_maxima_and_assignment_validation() {
    let mut w = world();
    let fleet = w.flagship(PLAYER).unwrap();
    let role = MateRole::Assigned { role: 0, target: RoleTarget::Fleet(fleet) };
    Command::AssignMate { owner: PLAYER, mate: MateId(0), role }.apply(&mut w).unwrap();
    assert_eq!(w.mate_ability(MateId(0), "astronomy"), 83);
    assert_eq!(w.staffed_hook(PLAYER, AttrHook::PositionFix, RoleTarget::Fleet(fleet)), 83);
    assert_eq!(w.fleet_speed_bonus(fleet).0, 700);
    w.state.agents.get_mut(&PLAYER).unwrap().captain.as_mut().unwrap().attrs[3] = 10;
    assert_eq!(w.fleet_speed_bonus(fleet).0, 900);
    for bad in [
        MateRole::Assigned { role: 99, target: RoleTarget::Fleet(fleet) },
        MateRole::Assigned { role: 0, target: RoleTarget::Owner },
    ] {
        assert!(Command::AssignMate { owner: PLAYER, mate: MateId(1), role: bad }.apply(&mut w).is_err());
    }
    Command::AssignMate { owner: PLAYER, mate: MateId(1), role }.apply(&mut w).unwrap();
    assert_eq!(w.state.mates[&MateId(0)].role, MateRole::None);
    assert_eq!(w.state.mates[&MateId(1)].role, role);
    w.state.fleets.remove(&fleet);
    w.end_day().unwrap();
    assert_eq!(w.state.mates[&MateId(1)].role, MateRole::None);
}
#[test]
fn new_world_bargaining_uses_the_higher_hook_instead_of_legacy_addition() {
    let mut w = world();
    let d = Arc::make_mut(&mut w.defs);
    d.captain.roles[1].hooks.push(manifest_core::captain::RoleHook {
        effect: HookDef { hook: AttrHook::BargainDiscount, per_point: 5, max: None },
        ability: "trade".into(),
    });
    Command::AssignMate {
        owner: PLAYER,
        mate: MateId(0),
        role: MateRole::Assigned { role: 1, target: RoleTarget::Owner },
    }
    .apply(&mut w)
    .unwrap();
    let staff = w.mate_ability(MateId(0), "trade") * 5;
    let hero = w.attr_hook(PLAYER, AttrHook::BargainDiscount);
    assert_eq!(
        w.bargain_outcome(PLAYER, w.defs.scenarios[0].start, manifest_core::news::Intent::Discount).discount.0,
        (300 + staff.max(hero)).min(800)
    );
}
