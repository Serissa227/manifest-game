//! 六种经典效果逐项对照旧公式，任职与消费仍通过同一命令入口。
use manifest_core::captain::{AttrHook, Birthday, CaptainProfile};
use manifest_core::fixed::{Fx, mul_div};
use manifest_core::mates::MateRole;
use manifest_core::news::{Intent, MAX_DISCOUNT};
use manifest_core::testkit::captain_defs;
use manifest_core::{Command, LocId, MateId, OwnerId, ScenarioId, World};
const PLAYER: OwnerId = OwnerId::Player;
fn world(points: i64, ability: i64) -> World {
    let mut w = World::new(captain_defs(), ScenarioId(0), 17).unwrap();
    w.state.agents.get_mut(&PLAYER).unwrap().captain = Some(CaptainProfile {
        birthday: Birthday { year: 1480, month: 2, day: 12 },
        sign: "aquarius".into(),
        answers: vec![],
        attrs: vec![points; 6],
        genius: None,
        learned: vec![],
        teachers: vec![],
        created: 0,
    });
    let m = w.state.mates.get_mut(&MateId(0)).unwrap();
    m.navigation = ability;
    m.combat = ability;
    m.trade = ability;
    m.management = ability;
    w
}
fn old(ability: i64, per: i64, cap: i64) -> Fx {
    Fx(mul_div(ability.clamp(0, 100), Fx::SCALE, per)).min(Fx::from_pct(cap))
}
fn cases(mut f: impl FnMut(World, i64, i64)) {
    for points in 0..=10 {
        for ability in [0, 1, 19, 49, 50, 73, 99, 100, 120] {
            f(world(points, ability), points, ability);
        }
    }
}
fn assign(w: &mut World, role: MateRole) {
    Command::AssignMate { owner: PLAYER, mate: MateId(0), role }.apply(w).unwrap();
}
#[test]
fn classic_speed_matches_old_formula_after_assignment() {
    cases(|mut w, p, a| {
        let f = w.flagship(PLAYER).unwrap();
        assign(&mut w, MateRole::Captain(f));
        assert_eq!(w.fleet_speed_bonus(f), old(p * 10, 1000, 10).max(old(a, 1000, 10)));
    });
}
#[test]
fn classic_naval_combat_matches_old_formula_after_assignment() {
    cases(|mut w, p, a| {
        let f = w.flagship(PLAYER).unwrap();
        assign(&mut w, MateRole::Captain(f));
        assert_eq!(w.fleet_combat_mult(f), Fx::ONE + old(p * 10, 200, 50).max(old(a, 200, 50)));
    });
}
#[test]
fn classic_tax_matches_old_formula_after_assignment() {
    cases(|mut w, p, a| {
        assign(&mut w, MateRole::Trader);
        assert_eq!(w.trade_tax_discount(PLAYER), old(p * 10, 1000, 10).max(old(a, 1000, 10)));
    });
}
#[test]
fn classic_wage_matches_old_formula_after_assignment() {
    cases(|mut w, p, a| {
        assign(&mut w, MateRole::Accountant);
        assert_eq!(w.wage_discount(PLAYER), old(p * 10, 1000, 10).max(old(a, 1000, 10)));
    });
}
#[test]
fn classic_bargain_command_keeps_additive_eloquence_and_old_cap() {
    cases(|mut w, p, a| {
        assign(&mut w, MateRole::Trader);
        let expected = (Fx::from_bp(300) + old(a, 2000, 5) + Fx::from_bp(p * 30)).min(MAX_DISCOUNT);
        Command::ApplyBargain {
            owner: PLAYER,
            loc: LocId(0),
            intent: Intent::Discount,
            player_text: "便宜一点。".into(),
            reply: "好。".into(),
            reply_tpl: None,
        }
        .apply(&mut w)
        .unwrap();
        assert_eq!(w.bargain_discount(PLAYER, LocId(0)), expected);
        assert_eq!(w.bargain_outcome(PLAYER, LocId(0), Intent::Irrelevant).discount, Fx::ZERO);
    });
}
#[test]
fn classic_recruit_command_charges_the_old_eloquence_price() {
    for p in 0..=10 {
        let mut w = world(p, 50);
        let cost = w.defs.mate(MateId(1)).hire_cost;
        let before = w.agent(PLAYER).unwrap().cash;
        Command::HireMate { owner: PLAYER, mate: MateId(1) }.apply(&mut w).unwrap();
        assert_eq!(before - w.agent(PLAYER).unwrap().cash, (Fx::ONE - Fx::from_pct(p * 2)).apply(cost));
    }
}
#[test]
fn a_missing_profile_contributes_zero_to_every_hook() {
    let w = World::new(captain_defs(), ScenarioId(0), 17).unwrap();
    for hook in AttrHook::ALL {
        assert_eq!(w.attr_hook(PLAYER, *hook), 0);
    }
    assert_eq!(w.fleet_speed_bonus(w.flagship(PLAYER).unwrap()), Fx::from_pct(7));
}
#[test]
fn assigning_a_legacy_slot_through_the_new_variant_keeps_state_bytes() {
    let mut old = world(7, 42);
    let mut new = world(7, 42);
    let f = old.flagship(PLAYER).unwrap();
    assign(&mut old, MateRole::Captain(f));
    assign(&mut new, MateRole::Assigned { role: 0, target: manifest_core::mates::RoleTarget::Fleet(f) });
    assert_eq!(serde_json::to_vec(&old.state).unwrap(), serde_json::to_vec(&new.state).unwrap());
    assert!(new.captain_of(f).is_some());
}
