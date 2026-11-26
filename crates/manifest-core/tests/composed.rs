//! 组合事件的内核校验与执行（小型世界，不读文件）。
//!
//! 内核是最后一道关口：无论提案来自模型还是离线模板、裁决器是否接受，
//! 越界、未知效果、重复、超出总强度预算、违反外交前提、冷却与年度上限等情况都必须被拒绝且不留下任何改动。

use manifest_core::composed::{ComposedEffect, ComposedSource};
use manifest_core::defs::EffectKind;
use manifest_core::events::{COMPOSED_KIND, EventOrigin, EventParams};
use manifest_core::log::LogKind;
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::*;
use std::sync::Arc;

const ALPHA: LocId = LocId(0);
const DELTA_CITY: LocId = LocId(3);
const GRAIN: GoodId = GoodId(0);
const WEST: RegionId = RegionId(0);
const EAST: RegionId = RegionId(1);
const CROWN: FactionId = FactionId(0);
const LEAGUE: FactionId = FactionId(1);

fn world_with(defs: Arc<StaticData>) -> World {
    let mut w = World::new(defs, ScenarioId(0), 3).expect("开局");
    for _ in 0..5 {
        w.end_day().unwrap();
    }
    w
}

fn world() -> World {
    world_with(tiny_defs())
}

fn eff(effect: EffectKind, params: EventParams) -> ComposedEffect {
    ComposedEffect { effect, params }
}

fn loc_supply(loc: LocId, mult: i64, days: u32) -> ComposedEffect {
    eff(
        EffectKind::LocationSupply,
        EventParams { loc: Some(loc), mult: Some(Fx(mult)), days: Some(days), ..EventParams::default() },
    )
}

fn storm(region: RegionId, mult: i64, days: u32) -> ComposedEffect {
    eff(
        EffectKind::RegionStorm,
        EventParams { region: Some(region), mult: Some(Fx(mult)), days: Some(days), ..EventParams::default() },
    )
}

fn interest(mult: i64, days: u32) -> ComposedEffect {
    eff(EffectKind::InterestShift, EventParams { mult: Some(Fx(mult)), days: Some(days), ..EventParams::default() })
}

fn relation(a: FactionId, b: FactionId, delta: i64) -> ComposedEffect {
    eff(
        EffectKind::RelationShift,
        EventParams { faction_a: Some(a), faction_b: Some(b), delta: Some(delta), ..EventParams::default() },
    )
}

fn cmd(title: &str, effects: Vec<ComposedEffect>) -> Command {
    Command::ApplyComposedEvent {
        title: title.into(),
        text: "据港务厅档案记载，码头区夜间起火。".into(),
        effects,
        source: ComposedSource::Model,
    }
}

/// 推进一天（在 tick 开头执行命令，与会话排期执行的顺序相同）。
fn advance(w: &mut World, n: u32) {
    for _ in 0..n {
        w.end_day().unwrap();
    }
}

#[test]
fn legal_composed_event_starts_every_effect_and_records_its_origin() {
    let mut w = world();
    let rel_before = w.relation(CROWN, LEAGUE).unwrap().value;
    let effects = vec![
        loc_supply(ALPHA, 7_000, 30),
        eff(
            EffectKind::DemandShift,
            EventParams {
                loc: Some(ALPHA),
                good: Some(GRAIN),
                mult: Some(Fx(14_000)),
                days: Some(20),
                ..EventParams::default()
            },
        ),
        relation(CROWN, LEAGUE, 5),
    ];
    let c = cmd("alpha 码头大火", effects.clone());
    c.validate(&w).unwrap();
    c.apply(&mut w).unwrap();
    let day = w.day();

    // 记录：标题、叙事、效果与来源
    let rec = w.state.events.composed.last().expect("应有组合事件记录").clone();
    assert_eq!((rec.id, rec.day, rec.title.as_str(), rec.source), (1, day, "alpha 码头大火", ComposedSource::Model));
    assert_eq!(rec.effects, effects);
    // 两条持续效果进入进行中列表，来源记为组合事件；关系变化立即生效
    let active: Vec<_> = w.state.events.active.iter().filter(|e| !e.origin.is_catalog()).collect();
    assert_eq!(active.len(), 2);
    assert!(active.iter().all(|e| e.origin == EventOrigin::Composed { id: 1 } && e.kind == COMPOSED_KIND));
    assert!(active.iter().all(|e| e.catalog_kind().is_none() && e.effect.is_some()));
    assert_eq!(w.relation(CROWN, LEAGUE).unwrap().value, rel_before + 5);
    let history = w.state.events.history.last().unwrap();
    assert_eq!((history.origin, history.catalog_kind()), (EventOrigin::Composed { id: 1 }, None));
    // 修正系数只来自条目本身记录的效果
    let m = w.market(ALPHA, GRAIN).unwrap();
    assert_eq!((m.event_supply, m.event_demand), (Fx(7_000), Fx(14_000)));
    assert!(matches!(
        w.state.log.last().map(|e| &e.kind),
        Some(LogKind::ComposedEventStarted { composed: 1, loc: Some(ALPHA), .. })
    ));
    assert_eq!(w.active_events_text(), format!("【alpha 码头大火】（还剩 {} 天）", rec.end() - day));
    check_invariants(&w).unwrap();
    assert!(w.money_conserved());

    // 到期后效果消失
    advance(&mut w, 31);
    assert!(w.state.events.active.iter().all(|e| e.origin.is_catalog()));
    let m = w.market(ALPHA, GRAIN).unwrap();
    assert_eq!((m.event_supply, m.event_demand), (Fx::ONE, Fx::ONE));
    check_invariants(&w).unwrap();
}

/// 非法的组合事件：内核拒绝，世界状态不变。
#[test]
fn illegal_composed_events_are_rejected_without_changes() {
    let w = world();
    let long = "长".repeat(300);
    let dev = |loc: LocId, d: i64| {
        eff(EffectKind::Development, EventParams { loc: Some(loc), delta: Some(d), ..EventParams::default() })
    };
    let cases: Vec<(&str, Command)> = vec![
        ("系数越界", cmd("t", vec![loc_supply(ALPHA, 30_000, 30)])),
        ("天数越界", cmd("t", vec![loc_supply(ALPHA, 8_000, 200)])),
        ("变化量越界", cmd("t", vec![relation(CROWN, LEAGUE, 50)])),
        ("系数为 1", cmd("t", vec![loc_supply(ALPHA, 10_000, 30)])),
        ("变化量为 0", cmd("t", vec![dev(ALPHA, 0)])),
        ("超出总强度预算", cmd("t", vec![loc_supply(ALPHA, 5_000, 30), storm(WEST, 15_000, 30), interest(15_000, 30)])),
        (
            "效果过多",
            cmd("t", vec![loc_supply(ALPHA, 9_000, 30), storm(WEST, 11_000, 30), interest(11_000, 30), dev(ALPHA, 2)]),
        ),
        ("没有效果", cmd("t", vec![])),
        ("同一目标的同类效果重复", cmd("t", vec![loc_supply(ALPHA, 9_000, 30), loc_supply(ALPHA, 8_000, 20)])),
        (
            "缺少参数",
            cmd(
                "t",
                vec![eff(
                    EffectKind::LocationSupply,
                    EventParams { loc: Some(ALPHA), mult: Some(Fx(8_000)), ..EventParams::default() },
                )],
            ),
        ),
        (
            "多余参数",
            cmd(
                "t",
                vec![eff(
                    EffectKind::InterestShift,
                    EventParams { loc: Some(ALPHA), mult: Some(Fx(11_000)), days: Some(30), ..EventParams::default() },
                )],
            ),
        ),
        ("不存在的地点", cmd("t", vec![loc_supply(LocId(99), 8_000, 30)])),
        (
            "不存在的商品",
            cmd(
                "t",
                vec![eff(
                    EffectKind::GoodSupply,
                    EventParams {
                        good: Some(GoodId(99)),
                        mult: Some(Fx(8_000)),
                        days: Some(30),
                        ..EventParams::default()
                    },
                )],
            ),
        ),
        ("不存在的海区", cmd("t", vec![storm(RegionId(9), 15_000, 30)])),
        ("港口限定的效果用在内陆城市", cmd("t", vec![dev(DELTA_CITY, 3)])),
        ("两个势力相同", cmd("t", vec![relation(CROWN, CROWN, 5)])),
        ("和平状态下关系剧烈恶化", cmd("t", vec![relation(CROWN, LEAGUE, -18)])),
        ("标题为空", cmd("", vec![loc_supply(ALPHA, 8_000, 30)])),
        ("标题过长", cmd(&long, vec![loc_supply(ALPHA, 8_000, 30)])),
        (
            "叙事过长",
            Command::ApplyComposedEvent {
                title: "t".into(),
                text: long.clone(),
                effects: vec![loc_supply(ALPHA, 8_000, 30)],
                source: ComposedSource::Template,
            },
        ),
    ];
    assert!(cases.len() >= 10);
    for (name, c) in cases {
        let mut w = w.clone();
        let before = w.state.clone();
        assert!(c.validate(&w).is_err(), "{name}：应被内核拒绝");
        assert!(c.apply(&mut w).is_err(), "{name}：执行也应失败");
        assert_eq!(w.state, before, "{name}：被拒绝的命令不能留下改动");
    }

    // 不在效果词表中的效果（数据中删去该效果即禁用）
    let mut defs = (*tiny_defs()).clone();
    defs.composed.effects.retain(|b| b.effect != EffectKind::InterestShift);
    let w = world_with(Arc::new(defs));
    let err = cmd("t", vec![interest(11_000, 30)]).validate(&w).unwrap_err();
    assert!(err.to_string().contains("不在效果词表中"), "{err}");
    // 数据中没有启用组合事件
    let mut defs = (*tiny_defs()).clone();
    defs.composed = manifest_core::composed::ComposedRules::default();
    let w = world_with(Arc::new(defs));
    assert!(cmd("t", vec![loc_supply(ALPHA, 8_000, 30)]).validate(&w).is_err());
}

#[test]
fn cooldown_yearly_cap_stacking_and_repeats_are_enforced() {
    let mut defs = (*tiny_defs()).clone();
    defs.composed.max_per_year = 3;
    let mut w = world_with(Arc::new(defs));
    cmd("西海风暴", vec![storm(WEST, 15_000, 30)]).apply(&mut w).unwrap();
    // 冷却期（10 天）内不能再开始组合事件
    advance(&mut w, 1);
    let err = cmd("银根收紧", vec![interest(12_000, 30)]).validate(&w).unwrap_err();
    assert!(err.to_string().contains("冷却"), "{err}");
    // 目录事件不受组合事件冷却的影响
    let harvest = Command::ApplyEvent {
        event: EventTypeId(0),
        params: EventParams { good: Some(GRAIN), mult: Some(Fx(13_000)), days: Some(30), ..EventParams::default() },
    };
    harvest.validate(&w).unwrap();
    advance(&mut w, 10);
    // 进行中的同类同目标效果不叠加（不同海区可以）
    let err = cmd("又一场风暴", vec![storm(WEST, 12_000, 20)]).validate(&w).unwrap_err();
    assert!(err.to_string().contains("进行中"), "{err}");
    cmd("东海风暴", vec![storm(EAST, 12_000, 20)]).apply(&mut w).unwrap();
    // 风暴结束后，同一目标在 repeat_days（60 天）内仍不能再受同类的组合事件效果
    advance(&mut w, 25);
    assert!(w.state.events.active.iter().all(|e| e.params.region != Some(WEST)));
    let err = cmd("西海再起风暴", vec![storm(WEST, 12_000, 20)]).validate(&w).unwrap_err();
    assert!(err.to_string().contains("近期"), "{err}");
    // 年度上限：第三个成功，第四个被拒绝（同一年内）
    cmd("银根收紧", vec![interest(12_000, 30)]).apply(&mut w).unwrap();
    advance(&mut w, 12);
    assert!(w.day() < 360);
    let err = cmd("关税上调", vec![interest(9_000, 30)]).validate(&w).unwrap_err();
    assert!(err.to_string().contains("今年已达上限") || err.to_string().contains("进行中"), "{err}");
    let tax = eff(
        EffectKind::FactionTax,
        EventParams { faction_a: Some(CROWN), mult: Some(Fx(11_000)), days: Some(30), ..EventParams::default() },
    );
    let err = cmd("关税上调", vec![tax]).validate(&w).unwrap_err();
    assert!(err.to_string().contains("今年已达上限"), "{err}");
    check_invariants(&w).unwrap();
}

/// 旧存档的进行中事件没有记录效果：读档时按事件类型补上，修正系数与原局一致。
#[test]
fn legacy_active_events_get_their_effect_filled_on_load() {
    let mut w = world();
    Command::ApplyEvent {
        event: EventTypeId(0),
        params: EventParams { good: Some(GRAIN), mult: Some(Fx(13_000)), days: Some(30), ..EventParams::default() },
    }
    .apply(&mut w)
    .unwrap();
    cmd("东海风暴", vec![storm(EAST, 12_000, 20)]).apply(&mut w).unwrap();
    let mut json = serde_json::to_value(&w.state).unwrap();
    let active = json["events"]["active"].as_array_mut().unwrap();
    assert_eq!(active.len(), 2);
    for e in active.iter_mut() {
        if e.get("origin").is_none() {
            // 目录事件：模拟旧存档，去掉效果字段
            e.as_object_mut().unwrap().remove("effect");
        }
    }
    let state: WorldState = serde_json::from_value(json).unwrap();
    assert!(state.events.active.iter().any(|e| e.effect.is_none()));
    let loaded = World::from_snapshot(w.defs.clone(), state).unwrap();
    assert!(loaded.state.events.active.iter().all(|e| e.effect.is_some()));
    assert_eq!(loaded.state.events.mods, w.state.events.mods);
    assert_eq!(loaded.market(ALPHA, GRAIN).unwrap().event_supply, w.market(ALPHA, GRAIN).unwrap().event_supply);
    assert_eq!(loaded.state_hash(), w.state_hash());
}
