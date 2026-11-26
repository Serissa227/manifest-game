//! 寰宇的商馆代办与产业位（T03）在真实数据上的检查：寰宇打开 `[agency]`（代办费 2%、每级两张挂单、产业位 0–4），
//! 经典世界没有这一段（代办关闭、产业处数不限）。
use manifest_core::ids::ScenarioId;
use manifest_core::{LocId, OwnerId, World};

fn world(key: &str) -> std::sync::Arc<manifest_core::StaticData> {
    manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), key).unwrap()
}

#[test]
fn terra16_turns_agency_on_and_classic_stays_as_it_was() {
    let terra = world("terra16");
    let r = &terra.rules.agency;
    assert!(r.enabled);
    assert_eq!((r.fee_pct, r.orders_per_level, r.keep_fills), (2, 2, 60));
    assert_eq!(r.industry_slots, vec![0, 1, 2, 3, 4]);
    assert!(r.problems().is_empty());

    let classic = world("classic");
    assert!(!classic.rules.agency.enabled, "经典世界不开代办");
    assert!(classic.rules.agency.industry_slots.is_empty());
    let w = World::new(classic.clone(), ScenarioId(0), 7).unwrap();
    for i in 0..classic.locations.len() {
        let loc = LocId::from_idx(i);
        assert_eq!(w.industry_slots(OwnerId::Player, loc), None, "经典世界的产业处数不限");
        assert_eq!(w.agency_slots(OwnerId::Player, loc), 0);
    }
}

#[test]
fn terra16_industry_slots_are_zero_without_a_house_and_unlimited_inland() {
    let defs = world("terra16");
    let w = World::new(defs.clone(), defs.find_scenario("free_1557").unwrap(), 7).unwrap();
    let port = (0..defs.locations.len()).map(LocId::from_idx).find(|l| defs.loc(*l).is_port()).unwrap();
    assert_eq!(w.house_level(OwnerId::Player, port), 0);
    assert_eq!(w.industry_slots(OwnerId::Player, port), Some(0), "没有商馆：0 个产业位");
    if let Some(city) = (0..defs.locations.len()).map(LocId::from_idx).find(|l| {
        let d = defs.loc(*l);
        !d.is_port() && !d.is_site() && !d.market.is_empty()
    }) {
        assert_eq!(w.industry_slots(OwnerId::Player, city), None, "内陆城市设不了商馆，照旧不限");
    }
}
