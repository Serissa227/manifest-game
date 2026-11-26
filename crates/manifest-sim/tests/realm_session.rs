//! 时间差中的排期命令逐日执行，暂停存档恢复后不丢失也不重复。
use manifest_core::{replay::Source, *};
use manifest_sim::GameSession;
use serde_json::json;
use std::sync::Arc;
#[test]
fn scheduled_commands_execute_on_their_own_day_inside_a_realm_jump() {
    let mut defs = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap();
    let d = Arc::make_mut(&mut defs);
    d.scenarios[0].start_date = [1558, 1, 1];
    d.scenarios[0].control_date = [1558, 1, 1];
    for t in &mut d.story2.tracks {
        t.auto = false;
    }
    let cell = d.loc(LocId(0)).cell;
    d.realms = serde_json::from_value(json!({"realms":[{
        "key":"session_realm","name":"测试秘境","basis":"original","sources":["E63测试"],
        "veil":{"cells":[cell],"push":1},"key_items":["ring"],"ports":["test_west"],
        "hint":"这是排期测试的秘境。","rules":["这是三日时间差的测试。"],
        "otherworld":{"guest_nights":0,"time_ratio":3,"max_skip_days":90,"iron_ashore":true,"touch_land":"warn"}
    }]}))
    .unwrap();
    let mut game = GameSession::new(defs.clone(), ScenarioId(0), 42).unwrap();
    game.world.state.story2 = Default::default();
    game.world.grant_item(OwnerId::Player, "ring", 1).unwrap();
    game.world.state.realms.states.insert("session_realm".into(), realms::RealmStatus::Entered);
    let start = game.day();
    let fleet = game.world.flagship(OwnerId::Player).unwrap();
    let good = game.world.defs.find_good("grain").unwrap();
    game.schedule(start + 1, Source::Ai, Command::Buy { owner: OwnerId::Player, fleet, good, qty: 1, max_total: None });
    game.schedule(
        start + 2,
        Source::Ai,
        Command::Sell { owner: OwnerId::Player, fleet, good, qty: 1, min_total: None },
    );
    let initial = game.world.clone();
    let mut restored = GameSession::from_save(defs.clone(), game.to_save()).unwrap();
    let mut opened = Vec::new();
    game.advance_day_with(|session| {
        opened.push((session.day(), session.world.fleet(fleet).unwrap().cargo.get(&good).copied().unwrap_or(0)));
    })
    .unwrap();
    restored.advance_day().unwrap();
    assert_eq!(game.day(), start + 3);
    assert_eq!(opened, vec![(start + 1, 1), (start + 2, 0), (start + 3, 0)]);
    assert_eq!(game.world.fleet(fleet).unwrap().cargo.get(&good), None);
    assert!(game.world.money_conserved());
    assert_eq!(game.world.state_hash(), restored.world.state_hash());
    let mut replayed = initial;
    replay::replay_onto(&mut replayed, game.log(), game.day()).unwrap();
    assert_eq!(replayed.state_hash(), game.world.state_hash());
}
