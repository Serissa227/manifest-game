//! 特性必须进入真实战术伤害与接舷裁决。
use super::*;
use crate::legend_ships::mechanics::CombatTraits;
fn unit(id: u8, player: bool) -> Unit {
    Unit {
        id,
        player,
        ship: 0,
        kind: ShipTypeId(0),
        q: i64::from(id),
        r: 0,
        facing: 0,
        hp: 1000,
        max_hp: 1000,
        crew: 1000,
        guns: 100,
        mp: 3,
        mp_left: 3,
        fired: false,
        boarded: false,
        status: UnitStatus::Active,
        legend: None,
    }
}
fn battle() -> TacticalBattle {
    TacticalBattle {
        id: BattleId(0),
        fleet: FleetId(0),
        pirate: 0,
        started: 0,
        turn: 1,
        wind: 0,
        radius: 5,
        units: vec![unit(0, true), unit(1, false)],
        log: vec![],
    }
}
fn rng() -> Rng {
    Rng::derive(42, 0, Domain::Combat, 0, 0)
}
#[test]
fn armor_reduces_actual_fire_damage_without_changing_the_attacking_random_draw() {
    let mut ordinary = battle();
    let mut armored = ordinary.clone();
    armored.units[1].legend = Some(CombatTraits { armor: 50, ..Default::default() });
    ordinary.fire(0, 1, Fx::ONE, &mut rng());
    armored.fire(0, 1, Fx::ONE, &mut rng());
    let normal = 1000 - ordinary.units[1].hp;
    let reduced = 1000 - armored.units[1].hp;
    assert_eq!(normal % 2, 0, "夹具使用偶数伤害，单独验证一半减伤而不混入舍入");
    assert!(normal > 0 && reduced > 0);
    assert_eq!(reduced, normal / 2);
    assert!(armored.units[0].fired);
}
#[test]
fn ram_strikes_once_before_boarding_and_does_not_fire_again_after_a_reload() {
    let mut b = battle();
    b.units[1].crew = 10000;
    b.units[0].legend = Some(CombatTraits { ram: 10, ..Default::default() });
    b.board(0, 1, Fx::ONE, Fx::ONE, &mut rng());
    assert_eq!(b.units[1].hp, 900);
    let text = serde_json::to_string(&b).unwrap();
    let mut loaded: TacticalBattle = serde_json::from_str(&text).unwrap();
    loaded.units[0].boarded = false;
    loaded.board(0, 1, Fx::ONE, Fx::ONE, &mut rng());
    assert_eq!(loaded.units[1].hp, 900);
}
#[test]
fn boarding_bridge_changes_the_real_capture_outcome() {
    let mut found = false;
    for seed in 0..100 {
        let mut ordinary = battle();
        let mut bridge = ordinary.clone();
        bridge.units[0].legend = Some(CombatTraits { bridge: 50, ..Default::default() });
        let mut a = Rng::derive(seed, 0, Domain::Combat, 0, 0);
        let mut b = Rng::derive(seed, 0, Domain::Combat, 0, 0);
        ordinary.board(0, 1, Fx::ONE, Fx::ONE, &mut a);
        bridge.board(0, 1, Fx::ONE, Fx::ONE, &mut b);
        if ordinary.units[1].status == UnitStatus::Active && bridge.units[1].status == UnitStatus::Captured {
            found = true;
            break;
        }
    }
    assert!(found);
}
