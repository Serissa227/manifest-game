//! H08 甲板闲话的测试：触发、说话人的先后（专属句 → 岗位句 → 老水手）、冷却、小互动只能一次、开关关闭。
use super::*;
use crate::navigation::{ManualVoyage, Sail};
use crate::testkit::tiny_defs;
use crate::{Cell, Command, ScenarioId};
use std::sync::Arc;

fn line(key: &str, trigger: &str, mate: Option<&str>, reply: bool) -> BanterDef {
    BanterDef {
        key: key.into(),
        trigger: trigger.into(),
        mate: mate.map(Into::into),
        role: None,
        text: format!("{key} 说了一句"),
        reply: reply.then(|| BanterReply { label: "嗯".into(), answer: "好".into(), affinity: 2 }),
    }
}

fn world(defs: Vec<BanterDef>, enabled: bool) -> (World, FleetId) {
    let mut d = (*tiny_defs()).clone();
    d.manual_navigation = true;
    d.rules.banter.enabled = enabled;
    d.rules.banter.chance_bp = 10_000;
    d.rules.banter.defs = defs;
    d.rules.hail.enabled = true;
    d.rules.pirates.spawn_scale = crate::Fx::ZERO;
    let mut w = World::new(Arc::new(d), ScenarioId(0), 5).unwrap();
    let id = w.flagship(OwnerId::Player).unwrap();
    Command::Resupply { owner: OwnerId::Player, fleet: id, food: 10, water: 10 }.apply(&mut w).unwrap();
    let mut manual = ManualVoyage::new(Cell::new(4, 4), 90);
    manual.sail = Sail::Furled;
    w.fleet_mut(id).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual });
    // 结伴中：命中 convoy
    w.state.hail.convoys.insert(id, crate::hail::Convoy { with: id, until: 999 });
    (w, id)
}

#[test]
fn a_trigger_picks_a_line_and_cooldowns_hold() {
    let (mut w, id) =
        world(vec![line("deck_convoy", "convoy", None, false), line("deck_convoy_b", "convoy", None, false)], true);
    w.banter_day();
    let first = w.state.banter.current.clone().expect("结伴时说一句");
    assert_eq!((first.fleet, first.mate, first.day), (id, None, w.day()));
    // 第二天：同一个触发键 3 天内不再触发，今天这一句不变
    w.state.day += 1;
    w.banter_day();
    assert_eq!(w.state.banter.current.as_ref().map(|c| c.key.clone()), Some(first.key.clone()));
    // 过了触发冷却：说另一句（同一句 60 天内不重复）
    w.state.day += 3;
    w.banter_day();
    let second = w.state.banter.current.clone().unwrap();
    assert_ne!(second.key, first.key);
    // 两句都说过了、还在 60 天里：不再说
    w.state.day += 4;
    w.banter_day();
    assert_eq!(w.state.banter.current.as_ref().map(|c| c.key.clone()), Some(second.key));
}

#[test]
fn a_hired_companion_speaks_before_the_old_hand_and_replies_count_once() {
    let mut defs = vec![line("deck_convoy", "convoy", None, false)];
    let (probe, _) = world(defs.clone(), true);
    // 一位开局时没被玩家雇着的航海士
    let mid = *probe
        .state
        .mates
        .iter()
        .find(|(_, m)| m.owner != Some(OwnerId::Player))
        .map(|(id, _)| id)
        .expect("有没雇着的航海士");
    let mate_key = probe.defs.mates[mid.idx()].key.clone();
    defs.push(line("named_convoy", "convoy", Some(&mate_key), true));
    let (mut w, _) = world(defs, true);
    // 没雇这位同伴：只能老水手说
    w.banter_day();
    assert_eq!(w.state.banter.current.as_ref().map(|c| c.key.as_str()), Some("deck_convoy"));
    // 雇了：专属句优先
    let (mut w, _) = world(
        vec![line("deck_convoy", "convoy", None, false), line("named_convoy", "convoy", Some(&mate_key), true)],
        true,
    );
    w.state.mates.get_mut(&mid).unwrap().owner = Some(OwnerId::Player);
    w.banter_day();
    let c = w.state.banter.current.clone().unwrap();
    assert_eq!((c.key.as_str(), c.mate), ("named_convoy", Some(mid)));
    // 小互动：一次
    let loyalty = w.state.mates[&mid].loyalty;
    let affinity = w.state.cast.persons.get(&mate_key).map_or(0, |p| p.affection.affinity);
    Command::BanterReply { owner: OwnerId::Player }.apply(&mut w).unwrap();
    let after = w.state.cast.persons.get(&mate_key).map_or(0, |p| p.affection.affinity);
    assert!(after > affinity || w.state.mates[&mid].loyalty > loyalty, "好感或忠诚加了");
    assert!(Command::BanterReply { owner: OwnerId::Player }.validate(&w).is_err(), "只能回应一次");
}

#[test]
fn new_regions_and_the_switch() {
    let (mut w, id) = world(vec![line("deck_region", "new_region", None, false)], true);
    w.state.hail.convoys.clear();
    // 头一天只记下所在海区，不说
    w.banter_day();
    assert!(w.state.banter.current.is_none());
    // 开进东海（x ≥ 20）：头一回进这片海区
    if let FleetLocation::AtSea(Voyage::Manual { manual }) = &mut w.fleet_mut(id).unwrap().location {
        manual.pos = crate::navigation::SubCell::center(Cell::new(30, 4));
    }
    w.state.day += 1;
    w.banter_day();
    assert_eq!(w.state.banter.current.as_ref().map(|c| c.key.as_str()), Some("deck_region"));
    // 开关关着：什么也不说，状态里没有这一节
    let (mut off, _) = world(vec![line("deck_convoy", "convoy", None, false)], false);
    off.banter_day();
    assert!(off.state.banter.is_empty());
    assert!(Command::BanterReply { owner: OwnerId::Player }.validate(&off).is_err());
}

#[test]
fn ship_wear_triggers_speak_only_when_h02_is_on() {
    let lines = vec![
        line("deck_no_fresh", "no_fresh", None, false),
        line("deck_fatigue", "fatigue", None, false),
        line("deck_short", "short_rations", None, false),
        line("deck_grumble", "grumbling", None, false),
    ];
    for wear in [false, true] {
        let (mut w, id) = world(lines.clone(), true);
        w.state.hail.convoys.clear();
        Arc::make_mut(&mut w.defs).rules.voyage_wear.enabled = wear;
        let mut x = w.fleet_wear(id);
        x.fresh_days = 30;
        x.fatigue = 60;
        x.orders.rations = crate::seafaring::Rations::Reduced;
        x.crisis.grumbled = true;
        w.state.voyage.insert(id, x);
        let triggers = w.banter_triggers(id);
        let h02: Vec<_> =
            triggers.iter().filter(|t| ["no_fresh", "fatigue", "short_rations", "grumbling"].contains(t)).collect();
        if wear {
            assert_eq!(h02, [&"no_fresh", &"fatigue", &"short_rations", &"grumbling"]);
        } else {
            assert!(h02.is_empty(), "{triggers:?}");
        }
    }
}
