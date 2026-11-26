//! H01 岗位钩子：中性值、单位折算与上限。各读取点“有 / 无该效果时结果不同”的测试见 `posts_hooks_tests.rs`。
use super::*;
use crate::captain::{HookDef, RoleHook};
use crate::mates::MateRole;
use crate::{MateId, ScenarioId, testkit};
use std::sync::Arc;

/// 小世界：开关按参数，玩家旗舰 + 一位担任舰长的航海士（航海 1 点，钩子系数即钩子原值）。
pub(crate) fn world_with(enabled: bool, hooks: &[(AttrHook, i64)]) -> (World, FleetId) {
    let mut defs = (*testkit::tiny_defs()).clone();
    defs.rules.voyage_posts.enabled = enabled;
    for (hook, raw) in hooks {
        defs.captain.roles[0].hooks.push(RoleHook {
            effect: HookDef { hook: *hook, per_point: *raw, max: None },
            ability: "navigation".into(),
        });
    }
    let mut w = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
    let fleet = w.flagship(OwnerId::Player).unwrap();
    let m = w.state.mates.get_mut(&MateId(0)).unwrap();
    m.owner = Some(OwnerId::Player);
    m.navigation = 1;
    m.role = MateRole::Captain(fleet);
    (w, fleet)
}

#[test]
fn disabled_rules_give_neutral_effects_even_with_staff() {
    let all = [
        (AttrHook::Upwind, 20),
        (AttrHook::FogSailing, 1),
        (AttrHook::StormCheck, 9_000),
        (AttrHook::DiseaseGuard, 9_000),
        (AttrHook::Healing, 9_000),
        (AttrHook::SupplyDiscount, 9_000),
        (AttrHook::Morale, 50),
        (AttrHook::SteeringPrecision, 90),
        (AttrHook::PositionFix, 90),
        (AttrHook::IntelDetection, 9_000),
        (AttrHook::FleetCoordination, 9_000),
        (AttrHook::Melee, 9_000),
        (AttrHook::Duel, 9_000),
    ];
    let (w, f) = world_with(false, &all);
    assert!(w.voyage_mods(f).is_neutral());
    assert_eq!(
        [
            w.post_storm_keep(f),
            w.post_disease_keep(f),
            w.post_healing_keep(f),
            w.post_supply_keep(f),
            w.post_steering_keep(f)
        ],
        [100; 5]
    );
    assert_eq!((w.post_morale_delay(f), w.post_position_bonus(f), w.post_intel_cells(f)), (0, 0, 0));
    assert_eq!(w.post_boarding_bonus(f), 0);
    assert_eq!(w.fleet_sight_cells(f), w.navigation_sight(f));
    assert_eq!(w.landmark_sight_cells(f), w.navigation_sight(f));
}

#[test]
fn enabled_effects_follow_the_spec_and_respect_caps() {
    // 低于上限：原样折算。
    let low = [
        (AttrHook::Upwind, 5),
        (AttrHook::StormCheck, 2_000),
        (AttrHook::DiseaseGuard, 3_000),
        (AttrHook::Healing, 1_000),
        (AttrHook::SupplyDiscount, 1_500),
        (AttrHook::Morale, 12),
        (AttrHook::SteeringPrecision, 40),
        (AttrHook::PositionFix, 30),
        (AttrHook::IntelDetection, 1_000),
        (AttrHook::FleetCoordination, 2_000),
        (AttrHook::Melee, 1_000),
        (AttrHook::Duel, 1_000),
    ];
    let (w, f) = world_with(true, &low);
    assert_eq!(w.post_upwind(f), 5);
    assert_eq!(w.post_storm_keep(f), 80);
    assert_eq!(w.post_disease_keep(f), 70);
    assert_eq!(w.post_healing_keep(f), 90);
    assert_eq!(w.post_supply_keep(f), 85);
    assert_eq!(w.post_morale_delay(f), 12);
    assert_eq!(w.post_steering_keep(f), 60);
    assert_eq!(w.post_position_bonus(f), 30);
    assert_eq!(w.post_intel_cells(f), 2);
    assert_eq!(w.post_coordination(f), 20);
    assert_eq!(w.post_boarding_bonus(f), 15);
    assert_eq!(w.fleet_sight_cells(f), w.navigation_sight(f) + 2);
    let base = w.navigation_sight(f);
    assert_eq!(w.landmark_sight_cells(f), base + crate::fixed::mul_div(base, 30, 100));
    assert!(w.landmark_sight_cells(f) > base);
    // 远超上限：一律封顶。
    let high = [
        (AttrHook::Upwind, 99),
        (AttrHook::FogSailing, 1),
        (AttrHook::StormCheck, 10_000),
        (AttrHook::DiseaseGuard, 10_000),
        (AttrHook::Healing, 10_000),
        (AttrHook::SupplyDiscount, 10_000),
        (AttrHook::Morale, 999),
        (AttrHook::SteeringPrecision, 999),
        (AttrHook::PositionFix, 999),
        (AttrHook::IntelDetection, 10_000),
        (AttrHook::FleetCoordination, 10_000),
        (AttrHook::Melee, 10_000),
        (AttrHook::Duel, 10_000),
    ];
    let (w, f) = world_with(true, &high);
    assert_eq!(w.post_upwind(f), 8);
    assert_eq!(w.post_fog_offset(f), 100);
    assert_eq!(w.post_storm_keep(f), 40);
    assert_eq!(w.post_disease_keep(f), 30);
    assert_eq!(w.post_healing_keep(f), 50);
    assert_eq!(w.post_supply_keep(f), 70);
    assert_eq!(w.post_morale_delay(f), 30);
    assert_eq!(w.post_steering_keep(f), 40);
    assert_eq!(w.post_position_bonus(f), 50);
    assert_eq!(w.post_intel_cells(f), 4);
    assert_eq!(w.post_coordination(f), 50);
    assert_eq!(w.post_boarding_bonus(f), 100);
    let m = w.voyage_mods(f);
    assert_eq!((m.upwind, m.fog_offset, m.coordination, m.speed_bp), (-8, 100, 50, 10_000));
}

#[test]
fn only_player_fleets_get_post_effects() {
    let (mut w, f) = world_with(true, &[(AttrHook::StormCheck, 5_000)]);
    assert_eq!(w.post_storm_keep(f), 50);
    w.state.fleets.get_mut(&f).unwrap().owner = OwnerId::Company(crate::CompanyId(0));
    assert_eq!(w.post_storm_keep(f), 100);
}

#[test]
fn default_rules_pass_validation_and_bad_values_are_reported() {
    let mut r = PostsRules { enabled: true, ..Default::default() };
    assert!(r.problems().is_empty());
    r.storm_max = 120;
    r.intel_per_cell = 0;
    let fields: Vec<_> = r.problems().into_iter().map(|(f, _)| f).collect();
    assert_eq!(fields, ["storm_max", "intel_per_cell"]);
    assert_eq!(keep_pct(-5, 60), 100);
    assert_eq!(keep_pct(500, 60), 40);
}
