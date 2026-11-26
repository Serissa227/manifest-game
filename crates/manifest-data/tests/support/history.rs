//! 历史贡献集成测试共用的真实 testbed 定义与命令入口。
#![allow(dead_code)]
use manifest_core::{history::*, *};
use serde_json::{Value, json};
use std::sync::{Arc, OnceLock};
pub const O: OwnerId = OwnerId::Player;
pub const EVENT: &str = "sample_opening";

pub fn defs(levers: Value) -> Arc<StaticData> {
    static BASE: OnceLock<Arc<StaticData>> = OnceLock::new();
    let mut d = BASE
        .get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "testbed").unwrap())
        .clone();
    let dd = Arc::make_mut(&mut d);
    dd.scenarios[0].start_date = [1558, 1, 1];
    dd.scenarios[0].control_date = [1558, 1, 1];
    dd.history.events.retain(|e| e.key == EVENT);
    let e = &mut dd.history.events[0];
    e.date = Some([1558, 1, 20]);
    e.window = Some([[1558, 1, 1], [1558, 1, 20]]);
    e.levers = serde_json::from_value(levers).unwrap();
    e.campaign = None;
    e.base = None;
    e.base_vars.clear();
    e.need = None;
    e.counter = None;
    e.court = None;
    e.diminish = 100;
    for o in &mut e.outcomes {
        o.vars.clear();
        o.backfire.clear();
    }
    e.balance = -5;
    e.outcomes[0].when = "<= 0".into();
    e.outcomes[1].when = "> 0".into();
    dd.history.order = vec![0];
    d
}
pub fn lever(kind: &str) -> Value {
    json!({"key":kind,"side":"west","kind":kind,"label":"测试贡献","port":"test_west","max_points":20,"points":6,"goods":["grain"],"value_per_point":10})
}
pub fn world(levers: Value) -> World {
    let d = defs(levers);
    assert!(validation::validate(&d).is_empty(), "{:?}", validation::validate(&d));
    World::new(d, ScenarioId(0), 42).unwrap()
}
pub fn command(lever: &str, payload: Payload) -> Command {
    Command::Contribute { owner: O, event: EVENT.into(), lever: lever.into(), payload }
}
pub fn reject(w: &mut World, cmd: Command) {
    let before = w.state.clone();
    assert!(cmd.validate(w).is_err());
    assert_eq!(before, w.state);
    assert!(cmd.apply(w).is_err());
    assert_eq!(before, w.state);
}
pub fn buy(w: &mut World, qty: i64) -> (FleetId, GoodId) {
    let fleet = w.flagship(O).unwrap();
    let good = w.defs.find_good("grain").unwrap();
    Command::Buy { owner: O, fleet, good, qty, max_total: None }.apply(w).unwrap();
    (fleet, good)
}
pub fn delivery(lever: &str, fleet: FleetId, good: GoodId, qty: i64, donate: bool) -> Command {
    command(lever, Payload::Deliver { fleet, goods: vec![(good, qty)], donate })
}
pub fn advance(w: &mut World, days: u32) {
    for _ in 0..days {
        w.end_day().unwrap();
    }
}
pub fn restored(w: &World) -> World {
    World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap()
}
pub fn sail(w: &mut World, owner: OwnerId, fleet: FleetId, dest: LocId) {
    Command::Resupply { owner, fleet, food: 10, water: 10 }.apply(w).unwrap();
    Command::SetSail { owner, fleet, dest }.apply(w).unwrap();
}
