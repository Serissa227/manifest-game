//! 七槽的真实数据集成：数量占用、岗位取高、上限、套装与存读档。
use manifest_core::{
    captain::{AttrHook, Birthday},
    items::equipment::EquipSlot,
    mates::{MateRole, RoleTarget},
    *,
};
use std::sync::Arc;
const O: OwnerId = OwnerId::Player;

fn world() -> World {
    let root = manifest_data::find_data_dir().unwrap();
    let mut defs = (*manifest_data::load_world(&root, "testbed").unwrap()).clone();
    let mut mate = manifest_data::load(&root).unwrap().mates[0].clone();
    mate.key = "navigator_test".into();
    mate.home = LocId(0);
    mate.navigation = 30;
    mate.salary = 0;
    mate.hire_cost = 0;
    defs.mates = vec![mate];
    defs.scenarios[0].mates = vec![MateId(0)];
    let mut w = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
    Command::CreateCaptain {
        owner: O,
        birthday: Birthday { year: 1484, month: 1, day: 31 },
        answers: vec!["library".into()],
        alloc: vec![1, 1, 1, 1, 1, 1, 1, 1, 0, 0],
        genius: None,
    }
    .apply(&mut w)
    .unwrap();
    w
}
fn equip(wearer: &str, slot: EquipSlot, item: &str) -> Command {
    Command::Equip { owner: O, wearer: wearer.into(), slot, item: item.into() }
}
fn rejects(w: &mut World, command: Command) {
    let before = serde_json::to_vec(&w.state).unwrap();
    assert!(command.apply(w).is_err(), "{command:?}");
    assert_eq!(serde_json::to_vec(&w.state).unwrap(), before);
}

#[test]
fn slots_share_quantities_and_replacement_unequip_and_dismiss_return_them() {
    let mut w = world();
    w.grant_item(O, "ring", 2).unwrap();
    w.grant_item(O, "ribbon", 1).unwrap();
    equip("captain", EquipSlot::Accessory1, "ring").apply(&mut w).unwrap();
    equip("captain", EquipSlot::Accessory2, "ring").apply(&mut w).unwrap();
    assert_eq!(w.item_equipped(O, "ring"), 2);
    assert_eq!(w.item_available(O, "ring"), 0);
    // 重复请求是同一槽位，不再占用一件；换槽或换人必须有余量。
    equip("captain", EquipSlot::Accessory2, "ring").apply(&mut w).unwrap();
    rejects(&mut w, equip("navigator_test", EquipSlot::Accessory1, "ring"));
    rejects(&mut w, equip("captain", EquipSlot::Weapon, "ring"));
    rejects(&mut w, equip("not_a_mate", EquipSlot::Accessory1, "ring"));
    rejects(&mut w, Command::SellItem { owner: O, loc: LocId(0), item: "ring".into(), qty: 1, min_total: None });
    equip("captain", EquipSlot::Accessory1, "ribbon").apply(&mut w).unwrap();
    equip("navigator_test", EquipSlot::Accessory1, "ring").apply(&mut w).unwrap();
    Command::Unequip { owner: O, wearer: "captain".into(), slot: EquipSlot::Accessory2 }.apply(&mut w).unwrap();
    assert_eq!(w.item_available(O, "ring"), 1);
    Command::DismissMate { owner: O, mate: MateId(0) }.apply(&mut w).unwrap();
    assert_eq!(w.item_available(O, "ring"), 2);
    assert!(!w.inventory(O).unwrap().equipment.contains_key("navigator_test"));
    Command::HireMate { owner: O, mate: MateId(0) }.apply(&mut w).unwrap();
    assert_eq!(w.item_equipped(O, "ring"), 0);
}

#[test]
fn equipment_uses_a2_hooks_and_the_higher_staffed_value_instead_of_adding_people() {
    let mut w = world();
    let fleet = w.flagship(O).unwrap();
    Command::AssignMate {
        owner: O,
        mate: MateId(0),
        role: MateRole::Assigned { role: 0, target: RoleTarget::Fleet(fleet) },
    }
    .apply(&mut w)
    .unwrap();
    assert_eq!(w.fleet_speed_bonus(fleet).0, 300);
    w.grant_item(O, "compass", 2).unwrap();
    equip("captain", EquipSlot::Instrument, "compass").apply(&mut w).unwrap();
    assert_eq!(w.captain_attr(O, 3), 3);
    assert_eq!(w.fleet_speed_bonus(fleet).0, 900);
    equip("navigator_test", EquipSlot::Instrument, "compass").apply(&mut w).unwrap();
    assert_eq!(w.fleet_speed_bonus(fleet).0, 900);
    assert_eq!(w.role_hook(O, AttrHook::FlagshipSpeed, RoleTarget::Fleet(fleet)), 900);
    Command::Unequip { owner: O, wearer: "captain".into(), slot: EquipSlot::Instrument }.apply(&mut w).unwrap();
    assert_eq!(w.captain_attr(O, 3), 2);
    assert_eq!(w.fleet_speed_bonus(fleet).0, 900);
    Command::Unequip { owner: O, wearer: "navigator_test".into(), slot: EquipSlot::Instrument }.apply(&mut w).unwrap();
    assert_eq!(w.fleet_speed_bonus(fleet).0, 300);
}

#[test]
fn uncapped_equipment_effects_stay_with_the_wearer_and_take_the_higher_value() {
    let mut w = world();
    let mut defs = (*w.defs).clone();
    defs.items.items.iter_mut().find(|i| i.key == "compass").unwrap().effects[0].value = 1;
    w.defs = Arc::new(defs);
    let fleet = w.flagship(O).unwrap();
    Command::AssignMate {
        owner: O,
        mate: MateId(0),
        role: MateRole::Assigned { role: 0, target: RoleTarget::Fleet(fleet) },
    }
    .apply(&mut w)
    .unwrap();
    w.grant_item(O, "compass", 2).unwrap();
    assert_eq!(w.attr_hook(O, AttrHook::FlagshipSpeed), 200);
    assert_eq!(w.role_hook(O, AttrHook::FlagshipSpeed, RoleTarget::Fleet(fleet)), 300);
    equip("captain", EquipSlot::Instrument, "compass").apply(&mut w).unwrap();
    assert_eq!(w.attr_hook(O, AttrHook::FlagshipSpeed), 400);
    assert_eq!(w.role_hook(O, AttrHook::FlagshipSpeed, RoleTarget::Fleet(fleet)), 300);
    assert_eq!(w.fleet_speed_bonus(fleet).0, 400);
    equip("navigator_test", EquipSlot::Instrument, "compass").apply(&mut w).unwrap();
    assert_eq!(w.attr_hook(O, AttrHook::FlagshipSpeed), 400);
    assert_eq!(w.role_hook(O, AttrHook::FlagshipSpeed, RoleTarget::Fleet(fleet)), 500);
    assert_eq!(w.fleet_speed_bonus(fleet).0, 500);
    Command::Unequip { owner: O, wearer: "captain".into(), slot: EquipSlot::Instrument }.apply(&mut w).unwrap();
    assert_eq!(w.attr_hook(O, AttrHook::FlagshipSpeed), 200);
    assert_eq!(w.fleet_speed_bonus(fleet).0, 500);
    Command::Unequip { owner: O, wearer: "navigator_test".into(), slot: EquipSlot::Instrument }.apply(&mut w).unwrap();
    assert_eq!(w.fleet_speed_bonus(fleet).0, 300);
}

#[test]
fn sets_require_distinct_members_and_caps_survive_reload() {
    let mut w = world();
    w.grant_item(O, "coat", 3).unwrap();
    w.grant_item(O, "compass", 1).unwrap();
    assert_eq!(w.item_set_count(O, "mariner"), 2);
    assert!(w.item_titles(O).is_empty());
    w.grant_item(O, "reader", 1).unwrap();
    assert_eq!(w.item_titles(O), vec!["测试领航人"]);
    assert_eq!(w.attr_hook(O, AttrHook::FlagshipSpeed), 700);
    equip("captain", EquipSlot::Instrument, "compass").apply(&mut w).unwrap();
    w.grant_item(O, "tonic", 1).unwrap();
    Command::UseItem { owner: O, item: "tonic".into(), target: None }.apply(&mut w).unwrap();
    assert_eq!(w.attr_hook(O, AttrHook::FlagshipSpeed), 900);
    let loaded = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    assert_eq!(loaded.state, w.state);
    assert_eq!(loaded.attr_hook(O, AttrHook::FlagshipSpeed), 900);
    let mut bad = w.state.clone();
    bad.items
        .owners
        .get_mut(&O)
        .unwrap()
        .equipment
        .get_mut("captain")
        .unwrap()
        .insert(EquipSlot::Weapon, "compass".into());
    assert!(World::from_snapshot(w.defs.clone(), bad).is_err());
}

#[test]
fn attribute_bonuses_are_capped_across_all_seven_slots() {
    let mut w = world();
    let mut defs = (*w.defs).clone();
    for item in &mut defs.items.items {
        item.bonus.insert("navigation".into(), 3);
    }
    w.defs = Arc::new(defs);
    for (slot, key) in EquipSlot::ALL.into_iter().zip(["sabre", "dagger", "coat", "ring", "ring", "compass", "wand"]) {
        w.grant_item(O, key, 1).unwrap();
        equip("captain", slot, key).apply(&mut w).unwrap();
    }
    assert_eq!(w.equipment_bonus(O, "captain")["navigation"], 6);
    assert_eq!(w.captain_attr(O, 3), 8);
    assert_eq!(w.attr_hook(O, AttrHook::FlagshipSpeed), 900);
}
