//! B12：旧望见日志补足玩家归属后，仍能通过“只看与我有关”的过滤。
use manifest_appcore::views;
use manifest_core::{
    CompanyId, LocId, OwnerId,
    log::{LogEvent, LogKind},
};
use serde_json::json;

#[test]
fn old_and_new_sightings_are_player_logs_and_other_owners_stay_distinct() {
    let defs = manifest_core::testkit::tiny_defs();
    let old: LogEvent = serde_json::from_value(json!({"day":3,"kind":{"LocationSighted":{"loc":0}}})).unwrap();
    let current = LogEvent { day: 3, kind: LogKind::LocationSighted { loc: LocId(0), owner: OwnerId::Player } };
    for event in [old, current] {
        let view = views::log_view(&defs, &event);
        assert_eq!(view.kind, "LocationSighted");
        assert!(view.mine);
        assert!(view.args.contains(&("owner".into(), "player".into())));
        assert!(view.args.contains(&("loc".into(), defs.locations[0].name.clone())));
    }
    let other =
        LogEvent { day: 3, kind: LogKind::LocationSighted { loc: LocId(0), owner: OwnerId::Company(CompanyId(0)) } };
    assert!(!views::log_view(&defs, &other).mine);
}
