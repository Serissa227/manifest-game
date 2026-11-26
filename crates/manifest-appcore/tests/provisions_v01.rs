//! V01：界面直接使用后端的补给天数和整数目标，不再把每日取整值乘天数。
use manifest_appcore::{navigation_view, views};
use manifest_core::{
    FleetId, OwnerId, ScenarioId, World,
    navigation::{ManualVoyage, Sail},
    world::{FleetLocation, Voyage},
};
use serde_json::json;
use std::sync::Arc;

fn world(fractional: bool) -> (World, FleetId) {
    let mut defs = (*manifest_core::testkit::tiny_defs()).clone();
    defs.manual_navigation = true;
    defs.rules.fractional_supplies = fractional;
    defs.rules.crew_per_supply_unit = 50;
    let mut w = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
    let id = w.flagship(OwnerId::Player).unwrap();
    let f = w.fleet_mut(id).unwrap();
    f.crew = 18;
    f.food = 2;
    f.water = 2;
    (w, id)
}

fn anchor(w: &mut World, id: FleetId) {
    let mut manual = ManualVoyage::new(w.fleet(id).unwrap().cell(&w.defs), 0);
    manual.sail = Sail::Furled;
    w.fleet_mut(id).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual });
}

#[test]
fn fleet_json_exposes_daily_milli_days_and_top_up_targets() {
    let (mut w, id) = world(true);
    let f = w.fleet_mut(id).unwrap();
    f.supply_remainder.food = 18;
    f.supply_remainder.water = 36;
    let before = w.state.clone();
    let v = serde_json::to_value(views::fleet_view(&w, w.fleet(id).unwrap())).unwrap();
    assert_eq!(v["daily_need"], 1);
    assert_eq!(v["daily_need_milli"], 360);
    assert_eq!(v["supplies_days"], 3);
    assert_eq!(v["supplies_for_10_days"], 5);
    assert_eq!(v["supplies_for_30_days"], 12);
    assert_eq!(serde_json::to_value(views::static_view(&w.defs)).unwrap()["rules"]["fractional_supplies"], true);
    assert_eq!(w.state, before);
}

#[test]
fn low_supply_warning_uses_complete_days_not_rounded_daily_need() {
    let (mut w, id) = world(true);
    anchor(&mut w, id);
    let low = |w: &World| views::overview(w, 1, "off".into(), None).notices.iter().any(|n| n.kind == "lowSupplies");
    assert!(!low(&w), "18 人的两格粮水能用五个整日");
    w.fleet_mut(id).unwrap().food = 1;
    assert!(low(&w));
    w.fleet_mut(id).unwrap().crew = 0;
    assert!(!low(&w), "零船员没有补给消耗");
}

#[test]
fn navigation_hud_and_fleet_panel_share_the_same_supply_days() {
    let (mut w, id) = world(true);
    anchor(&mut w, id);
    w.fleet_mut(id).unwrap().supply_remainder.food = 36;
    let before = w.state.clone();
    let nav = navigation_view::navigation(views::Ctx::plain(&w.defs), &w, id, 0, 20).unwrap();
    let fleet = views::fleet_view(&w, w.fleet(id).unwrap());
    assert_eq!(nav["supplies_days"], json!(fleet.supplies_days));
    assert_eq!(nav["supplies_days"], 3);
    assert_eq!(w.state, before);
}

#[test]
fn classic_view_keeps_daily_rounding_and_zero_crew_is_explicit() {
    let (mut w, id) = world(false);
    let v = views::fleet_view(&w, w.fleet(id).unwrap());
    assert_eq!((v.daily_need, v.daily_need_milli, v.supplies_days), (1, 1_000, Some(2)));
    assert_eq!((v.supplies_for_10_days, v.supplies_for_30_days), (10, 30));
    w.fleet_mut(id).unwrap().crew = 0;
    let v = serde_json::to_value(views::fleet_view(&w, w.fleet(id).unwrap())).unwrap();
    assert_eq!(v["daily_need_milli"], 0);
    assert!(v["supplies_days"].is_null());
}
