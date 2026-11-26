//! H04 海上所见的测试：生成的确定性、不靠近就不触发、过期消失、各种效果、给物品的校验、暗礁看帆。
use super::*;
use crate::navigation::{CoursePoint, ManualVoyage};
use crate::testkit::tiny_defs;
use crate::{Command, ScenarioId};
use std::sync::Arc;

fn option(effects: SightEffects) -> SightOption {
    SightOption { label: "靠过去".into(), result: "好".into(), safe: None, effects, lucky: None }
}

fn def(key: &str, kind: SightKind, effects: SightEffects) -> SightingDef {
    SightingDef {
        key: key.into(),
        kind,
        weight: 1,
        title: key.into(),
        text: "看见了".into(),
        when: SightWhen::default(),
        options: vec![option(effects)],
    }
}

fn defs_with(table: Vec<SightingDef>, daily_bp: i64) -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.manual_navigation = true;
    d.rules.pirates.spawn_scale = crate::Fx::ZERO;
    d.rules.disease_bp_per_30_days = 0;
    d.rules.sightings.enabled = true;
    d.rules.sightings.daily_bp = daily_bp;
    d.rules.sightings.max_bp = 10_000;
    d.rules.sightings.port_clear = 0;
    d.rules.sightings.defs = table;
    Arc::new(d)
}

/// 一支在西海 (4, 4) 朝东、收着帆的玩家舰队。
fn world(d: Arc<StaticData>, seed: u64) -> (World, FleetId) {
    let mut w = World::new(d, ScenarioId(0), seed).unwrap();
    let id = w.fleets_of(OwnerId::Player).next().unwrap().id;
    Command::Resupply { owner: OwnerId::Player, fleet: id, food: 20, water: 20 }.apply(&mut w).unwrap();
    let mut manual = ManualVoyage::new(Cell::new(4, 4), 90);
    manual.sail = Sail::Furled;
    w.fleet_mut(id).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual });
    (w, id)
}

fn crew_def() -> SightingDef {
    def("boat", SightKind::Castaway, SightEffects { crew: Some([3, 3]), morale: 2, ..Default::default() })
}

#[test]
fn generation_is_deterministic_ahead_of_the_bow_and_off_when_disabled() {
    let d = defs_with(vec![crew_def()], 10_000);
    let (mut a, id) = world(d.clone(), 7);
    let (mut b, _) = world(d.clone(), 7);
    a.sightings_day();
    b.sightings_day();
    assert_eq!(a.state.sightings, b.state.sightings, "同种子同日同舰队的所见相同");
    let s = &a.state.sightings.active[0];
    assert_eq!((s.fleet, s.until), (id, a.day() + 2), "寿命 3 天");
    // 在船头前方 2–5 格、±60° 以内（船在 (4.5, 4.5)、朝东）
    let (dx, dy) = (s.pos.x - (4 * 256 + 128), s.pos.y - (4 * 256 + 128));
    assert!(dx > 0 && dx <= 5 * 256 + 256, "在前方：{dx}");
    assert!(dy.abs() <= dx * 2, "偏离航向不超过 60°：{dx}, {dy}");
    // 同一支舰队同时最多 3 个
    for _ in 0..6 {
        a.sightings_day();
    }
    assert!(a.state.sightings.active.len() <= 3);
    // 开关关着：什么也不生成，状态里没有这一节
    let mut raw = (*d).clone();
    raw.rules.sightings.enabled = false;
    let (mut c, _) = world(Arc::new(raw), 7);
    c.sightings_day();
    assert!(c.state.sightings.is_empty());
    assert!(!serde_json::to_string(&c.state).unwrap().contains("sightings"));
}

#[test]
fn not_touched_unless_approached_and_gone_after_lifetime() {
    let d = defs_with(vec![crew_def()], 10_000);
    let (mut w, id) = world(d.clone(), 3);
    w.sightings_day();
    let s = w.state.sightings.active[0].clone();
    let far = [CoursePoint { pos: SubCell::center(Cell::new(1, 1)), minute: 0 }];
    assert!(w.sighting_stops(id, &far).is_empty(), "不靠近就不触发");
    w.touch_sightings(id, &far, Sail::Full);
    assert!(!w.state.sightings.active[0].touched);
    // 命令：没碰上之前选不了
    let cmd = Command::ResolveSighting { owner: OwnerId::Player, fleet: id, sighting: s.id, choice: 0 };
    assert!(cmd.validate(&w).is_err());
    // 过了寿命就消失（可能又生成了新的，只看这一个）
    let _ = d;
    w.state.day = s.until + 1;
    w.sightings_day();
    assert!(w.state.sightings.active.iter().all(|x| x.id != s.id), "过期消失");
}

#[test]
fn touching_then_choosing_applies_effects_once() {
    let d = defs_with(vec![crew_def()], 10_000);
    let (mut w, id) = world(d, 5);
    w.sightings_day();
    let s = w.state.sightings.active[0].clone();
    let near = [CoursePoint { pos: s.pos, minute: 300 }];
    let stops = w.sighting_stops(id, &near);
    assert_eq!(stops.len(), 1);
    assert_eq!((stops[0].minute, stops[0].kind), (300, StopKind::Sighting));
    w.touch_sightings(id, &near, Sail::Full);
    assert!(w.state.sightings.active[0].touched);
    // 先让船员缺几个（满员时救起的人上不了船）
    let min = w.fleet(id).unwrap().crew_min(&w.defs);
    w.fleet_mut(id).unwrap().crew = min;
    let crew = w.fleet(id).unwrap().crew;
    Command::ResolveSighting { owner: OwnerId::Player, fleet: id, sighting: s.id, choice: 0 }.apply(&mut w).unwrap();
    assert!(w.fleet(id).unwrap().crew > crew, "救起了水手");
    assert!(w.state.sightings.active.is_empty(), "结算后消失");
    assert_eq!(w.state.sightings.last.as_ref().map(|l| l.id), Some(s.id));
    // 再选一次：已经不在了
    assert!(
        Command::ResolveSighting { owner: OwnerId::Player, fleet: id, sighting: s.id, choice: 0 }.validate(&w).is_err()
    );
    // 选项越界
    let (mut w, id) = world(defs_with(vec![crew_def()], 10_000), 5);
    w.sightings_day();
    let s = w.state.sightings.active[0].clone();
    w.touch_sightings(id, &[CoursePoint { pos: s.pos, minute: 1 }], Sail::Half);
    assert!(
        Command::ResolveSighting { owner: OwnerId::Player, fleet: id, sighting: s.id, choice: 5 }.validate(&w).is_err()
    );
}

#[test]
fn giving_an_item_is_checked_by_the_kernel() {
    // 物品键不存在：命令被拒，世界不变
    let bad = def("bad", SightKind::Wreck, SightEffects { item: Some("no_such_item".into()), ..Default::default() });
    let (mut w, id) = world(defs_with(vec![bad], 10_000), 9);
    w.sightings_day();
    let s = w.state.sightings.active[0].clone();
    w.touch_sightings(id, &[CoursePoint { pos: s.pos, minute: 1 }], Sail::Half);
    let before = w.state_hash();
    let cmd = Command::ResolveSighting { owner: OwnerId::Player, fleet: id, sighting: s.id, choice: 0 };
    assert!(cmd.validate(&w).is_err(), "不存在的物品键要被拒绝");
    assert_eq!(w.state_hash(), before);
    // 物品键存在：给到玩家手上
    if let Some(item) = w.defs.items.items.first().map(|i| i.key.clone()) {
        let good = def("good", SightKind::Wreck, SightEffects { item: Some(item.clone()), ..Default::default() });
        let (mut w, id) = world(defs_with(vec![good], 10_000), 9);
        w.sightings_day();
        let s = w.state.sightings.active[0].clone();
        w.touch_sightings(id, &[CoursePoint { pos: s.pos, minute: 1 }], Sail::Half);
        Command::ResolveSighting { owner: OwnerId::Player, fleet: id, sighting: s.id, choice: 0 }
            .apply(&mut w)
            .unwrap();
        assert_eq!(w.item_quantity(OwnerId::Player, &item), 1);
    }
}

#[test]
fn reefs_hurt_only_under_full_sail_and_apply_on_touch() {
    let reef = def("reef", SightKind::Reef, SightEffects { damage_full_sail: 10, ..Default::default() });
    let d = defs_with(vec![reef], 10_000);
    let durability = |w: &World, id: FleetId| w.fleet(id).unwrap().ships.iter().map(|s| s.durability).sum::<i64>();
    for (sail, hurt) in [(Sail::Full, true), (Sail::Half, false)] {
        let (mut w, id) = world(d.clone(), 11);
        w.sightings_day();
        let s = w.state.sightings.active[0].clone();
        let before = durability(&w, id);
        w.touch_sightings(id, &[CoursePoint { pos: s.pos, minute: 10 }], sail);
        assert_eq!(durability(&w, id) < before, hurt, "{sail:?}：满帆才受伤");
        let last = w.state.sightings.last.clone().unwrap();
        assert_eq!(last.safe, !hurt);
        // “知道了”只是收起卡片，不再结算
        let after = durability(&w, id);
        Command::ResolveSighting { owner: OwnerId::Player, fleet: id, sighting: s.id, choice: 0 }
            .apply(&mut w)
            .unwrap();
        assert_eq!(durability(&w, id), after);
        assert!(w.state.sightings.active.is_empty());
    }
}

#[test]
fn other_effects_land_port_supplies_and_goods() {
    let all = def(
        "all",
        SightKind::Fishing,
        SightEffects { supplies: 2, goods: Some([2, 2]), port: true, land: 2, cash: -10, ..Default::default() },
    );
    let (mut w, id) = world(defs_with(vec![all], 10_000), 13);
    w.sightings_day();
    let s = w.state.sightings.active[0].clone();
    w.touch_sightings(id, &[CoursePoint { pos: s.pos, minute: 1 }], Sail::Half);
    let (food, cargo) = {
        let f = w.fleet(id).unwrap();
        (f.food, f.cargo.values().sum::<i64>())
    };
    let cash = w.agent(OwnerId::Player).unwrap().cash;
    Command::ResolveSighting { owner: OwnerId::Player, fleet: id, sighting: s.id, choice: 0 }.apply(&mut w).unwrap();
    let f = w.fleet(id).unwrap();
    assert!(f.food > food, "粮水加了");
    assert!(f.cargo.values().sum::<i64>() >= cargo, "捞到当地的货（舱位够时）");
    assert!(w.agent(OwnerId::Player).unwrap().cash < cash, "付了钱");
}

#[test]
fn fish_roll_back_the_fresh_days_when_ship_wear_is_on() {
    let shoal = def("fish", SightKind::Shoal, SightEffects { supplies: 2, fresh: 10, ..Default::default() });
    for wear in [false, true] {
        let mut d = (*defs_with(vec![shoal.clone()], 10_000)).clone();
        d.rules.voyage_wear.enabled = wear;
        let (mut w, id) = world(Arc::new(d), 13);
        let mut x = w.fleet_wear(id);
        x.fresh_days = 25;
        w.state.voyage.insert(id, x);
        w.sightings_day();
        let s = w.state.sightings.active[0].clone();
        w.touch_sightings(id, &[CoursePoint { pos: s.pos, minute: 1 }], Sail::Half);
        Command::ResolveSighting { owner: OwnerId::Player, fleet: id, sighting: s.id, choice: 0 }
            .apply(&mut w)
            .unwrap();
        // H02 开着：断鲜 25 → 15；关着：船况不归它管，原样不动
        assert_eq!(w.fleet_wear(id).fresh_days, if wear { 15 } else { 25 });
    }
}
