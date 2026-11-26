//! 殖民相关的组合事件效果（小型世界，不读文件）：殖民地产量、士气、增长，势力占领殖民点，发现物传闻；
//! 以及殖民竞赛的节奏规则（开局保护期、随年代放开的上限、势力范围、冷却）。
//!
//! 合法的效果改变世界；越界、目标不存在、局势不允许的效果被内核拒绝且不留下任何改动；同样的命令两次执行结果一致。

use manifest_core::colony::{Claim, claim_blocker, faction_claim_cap, faction_reaches};
use manifest_core::composed::{ComposedEffect, ComposedSource};
use manifest_core::defs::EffectKind;
use manifest_core::diplomacy::DiploStatus;
use manifest_core::events::EventParams;
use manifest_core::log::LogKind;
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::warehouse::Holder;
use manifest_core::*;
use std::sync::Arc;

const P: OwnerId = OwnerId::Player;
const ALPHA: LocId = LocId(0);
const SIGMA: LocId = LocId(4);
const GRAIN: GoodId = GoodId(0);
const CLOTH: GoodId = GoodId(1);
const FARM: ColonyBuildingId = ColonyBuildingId(0);
const PLANTATION: ColonyBuildingId = ColonyBuildingId(1);
const STOREHOUSE: ColonyBuildingId = ColonyBuildingId(3);
const CROWN: FactionId = FactionId(0);
const LEAGUE: FactionId = FactionId(1);
const WRECK: DiscoveryId = DiscoveryId(0);
const ARCH: DiscoveryId = DiscoveryId(1);
const EAST: RegionId = RegionId(1);

/// 小型世界，关闭海盗舰队与殖民地袭击、疫病，仓库足够大，让测试只看组合事件的效果；
/// 另在岛的北岸加一处殖民点 tau（排在最后，旧地点编号不变）。
fn calm(edit: impl FnOnce(&mut StaticData)) -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.rules.pirates.spawn_scale = Fx::ZERO;
    d.rules.colony.raid_scale = Fx::ZERO;
    d.rules.colony.disease_bp_per_hazard = 0;
    d.rules.colony.base_capacity = 5_000;
    let mut tau = d.locations[SIGMA.idx()].clone();
    tau.key = "tau".into();
    tau.name = "tau".into();
    tau.cell = Cell::new(22, 7);
    d.locations.push(tau);
    edit(&mut d);
    Arc::new(d)
}

const TAU: LocId = LocId(5);

fn ok(w: &mut World, c: Command) -> CommandOutcome {
    c.apply(w).unwrap_or_else(|e| panic!("{c:?} 失败：{e}"))
}

fn advance(w: &mut World, n: u32) {
    for _ in 0..n {
        w.end_day().unwrap();
        if let Err(e) = check_invariants(w) {
            panic!("{e}");
        }
    }
}

fn fleet(w: &World) -> FleetId {
    w.fleets_of(P).next().expect("玩家舰队").id
}

fn sail(w: &mut World, dest: LocId) {
    let f = fleet(w);
    ok(w, Command::SetSail { owner: P, fleet: f, dest });
    for _ in 0..40 {
        if w.fleet(f).unwrap().docked_at() == Some(dest) {
            return;
        }
        advance(w, 1);
    }
    panic!("40 天内没有抵达 {dest:?}");
}

/// 在 sigma 建立殖民地、建好农庄，并让它度过新殖民地的保护期（小型世界的保护期为 30 天）。
fn colony_world(defs: Arc<StaticData>, seed: u64) -> (World, ColonyId) {
    let mut w = World::new(defs, ScenarioId(0), seed).expect("开局");
    let f = fleet(&w);
    let crew = w.fleet(f).unwrap().crew;
    ok(&mut w, Command::HireCrew { owner: P, fleet: f, count: 24 - crew });
    ok(&mut w, Command::Resupply { owner: P, fleet: f, food: 10, water: 10 });
    ok(&mut w, Command::Buy { owner: P, fleet: f, good: GRAIN, qty: 60, max_total: None });
    ok(&mut w, Command::Buy { owner: P, fleet: f, good: CLOTH, qty: 10, max_total: None });
    sail(&mut w, SIGMA);
    let CommandOutcome::ColonyFounded { colony } =
        ok(&mut w, Command::FoundColony { owner: P, fleet: f, site: SIGMA, name: "晨星垦地".into(), settlers: 12 })
    else {
        panic!("建立殖民地");
    };
    for g in [GRAIN, CLOTH] {
        let q = w.fleet(f).unwrap().cargo.get(&g).copied().unwrap_or(0);
        ok(
            &mut w,
            Command::Transfer { owner: P, from: Holder::Fleet(f), to: Holder::Warehouse(SIGMA), good: g, qty: q },
        );
    }
    ok(&mut w, Command::BuildColony { owner: P, colony, building: FARM });
    advance(&mut w, 35);
    assert_eq!(w.colony(colony).unwrap().level(FARM), 1);
    (w, colony)
}

fn eff(effect: EffectKind, params: EventParams) -> ComposedEffect {
    ComposedEffect { effect, params }
}

fn output(loc: LocId, building: Option<ColonyBuildingId>, mult: i64, days: u32) -> ComposedEffect {
    eff(
        EffectKind::ColonyOutput,
        EventParams { loc: Some(loc), building, mult: Some(Fx(mult)), days: Some(days), ..EventParams::default() },
    )
}

fn morale(loc: LocId, delta: i64) -> ComposedEffect {
    eff(EffectKind::ColonyMorale, EventParams { loc: Some(loc), delta: Some(delta), ..EventParams::default() })
}

fn growth(loc: LocId, mult: i64, days: u32) -> ComposedEffect {
    eff(
        EffectKind::ColonyGrowth,
        EventParams { loc: Some(loc), mult: Some(Fx(mult)), days: Some(days), ..EventParams::default() },
    )
}

fn claim(loc: LocId, f: FactionId) -> ComposedEffect {
    eff(EffectKind::SiteClaim, EventParams { loc: Some(loc), faction_a: Some(f), ..EventParams::default() })
}

fn rumor(d: DiscoveryId) -> ComposedEffect {
    eff(EffectKind::DiscoveryRumor, EventParams { discovery: Some(d), ..EventParams::default() })
}

fn cmd(title: &str, effects: Vec<ComposedEffect>) -> Command {
    Command::ApplyComposedEvent {
        title: title.into(),
        text: "据拓荒者的书信所述，新大陆的消息随补给船传回了内海。".into(),
        effects,
        source: ComposedSource::Model,
    }
}

/// 预计的农庄日产量（万分之一件）。
fn farm_estimate(w: &World, id: ColonyId) -> Fx {
    let c = w.colony(id).unwrap();
    w.colony_estimates(c)
        .iter()
        .filter(|e| e.building == FARM)
        .flat_map(|e| e.outputs.iter().map(|x| x.1))
        .fold(Fx::ZERO, |a, b| a + b)
}

#[test]
fn colony_effects_change_output_growth_and_morale() {
    let (mut w, id) = colony_world(calm(|_| {}), 3);
    let control = w.clone();
    let base = farm_estimate(&w, id);
    let morale0 = w.colony(id).unwrap().morale;
    ok(
        &mut w,
        cmd("风调雨顺", vec![output(SIGMA, Some(FARM), 15_000, 60), growth(SIGMA, 16_000, 60), morale(SIGMA, 10)]),
    );
    // 士气一次性上升；产量与增长系数持续
    assert_eq!(w.colony(id).unwrap().morale, (morale0 + 10).min(100));
    assert_eq!(w.colony_output_mult(w.colony(id).unwrap(), FARM), Fx(15_000));
    assert_eq!(w.colony_output_mult(w.colony(id).unwrap(), PLANTATION), Fx::ONE, "只作用于指定的建筑");
    assert_eq!(w.colony_growth_mult(w.colony(id).unwrap()), Fx(16_000));
    assert!(farm_estimate(&w, id) > base, "预计产量随之上升");
    assert_eq!(w.state.events.composed.len(), 1);
    assert_eq!(w.state.events.active.iter().filter(|e| !e.origin.is_catalog()).count(), 2, "两条持续效果");
    assert!(w.state.log.iter().any(|e| matches!(e.kind, LogKind::ComposedEventStarted { loc: Some(SIGMA), .. })));
    // 与对照组比较：一个月后粮食更多（增产）、月末增长更多
    let mut control = control;
    advance(&mut w, 30);
    advance(&mut control, 30);
    let grain = |x: &World| x.holder_qty(P, Holder::Warehouse(SIGMA), GRAIN);
    assert!(grain(&w) > grain(&control), "增产：{} vs {}", grain(&w), grain(&control));
    let grown = |x: &World| {
        let s = &x.colony(id).unwrap().stats;
        s.last_births + s.last_immigrants
    };
    assert!(grown(&w) >= grown(&control), "增长系数不小于对照组");
    // 效果到期后系数回到 1
    advance(&mut w, 40);
    assert_eq!(w.colony_output_mult(w.colony(id).unwrap(), FARM), Fx::ONE);
    assert_eq!(w.colony_growth_mult(w.colony(id).unwrap()), Fx::ONE);
    check_invariants(&w).unwrap();
}

#[test]
fn output_effect_for_all_buildings_and_negative_effects_after_grace() {
    let (mut w, id) = colony_world(calm(|_| {}), 4);
    let base = farm_estimate(&w, id);
    // 不指定建筑：全部建筑；负面效果在保护期之后、殖民地没有困境时可以施加
    ok(&mut w, cmd("虫害", vec![output(SIGMA, None, 8_000, 30), morale(SIGMA, -5)]));
    assert!(farm_estimate(&w, id) < base);
    assert_eq!(w.colony_output_mult(w.colony(id).unwrap(), PLANTATION), Fx(8_000), "全部建筑");
    check_invariants(&w).unwrap();
}

#[test]
fn site_claims_and_discovery_rumors_apply_once() {
    let mut w = World::new(calm(|_| {}), ScenarioId(0), 5).unwrap();
    advance(&mut w, 3);
    let revealed = w.state.explore.revealed_count();
    ok(&mut w, cmd("王旗插上海岬", vec![claim(SIGMA, LEAGUE), rumor(ARCH)]));
    assert_eq!(w.claim_of(SIGMA), Some(Claim::Faction(LEAGUE)));
    assert_eq!(w.state.locations[SIGMA.idx()].claimed_on, Some(w.day()));
    assert_eq!(w.faction_last_claim(LEAGUE), Some(w.day()));
    assert!(w.state.log.iter().any(|e| matches!(e.kind, LogKind::SiteClaimed { loc: SIGMA, faction: LEAGUE })));
    // 传闻只给出大致海区，不揭开迷雾、不算发现
    let r = w.state.explore.rumors.get(&ARCH).copied().expect("记下传闻");
    assert_eq!((r.day, r.region), (w.day(), EAST));
    assert_eq!(manifest_core::explore::discovery_region(&w.defs, ARCH), Some(EAST));
    assert!(!w.state.explore.discovered.contains_key(&ARCH));
    assert_eq!(w.state.explore.revealed_count(), revealed);
    assert!(w.state.events.active.iter().all(|e| e.origin.is_catalog()), "一次性效果不进入进行中列表");
    // 被占领的殖民点不能再建立殖民地
    assert!(manifest_core::colony::site_blocker(&w, P, SIGMA).is_some_and(|m| m.contains("占领")));
    check_invariants(&w).unwrap();
}

/// 越界、目标不存在、局势不允许：内核拒绝，且不留下任何改动。
#[test]
fn illegal_colony_effects_are_rejected_without_changes() {
    let (w, id) = colony_world(calm(|_| {}), 6);
    let cases: Vec<(&str, Command, &str)> = vec![
        ("港口不是殖民点", cmd("t", vec![output(ALPHA, None, 12_000, 30)]), "殖民点"),
        ("系数越界", cmd("t", vec![output(SIGMA, Some(FARM), 30_000, 30)]), "系数"),
        ("天数越界", cmd("t", vec![growth(SIGMA, 12_000, 400)]), "天数"),
        ("变化量越界", cmd("t", vec![morale(SIGMA, 40)]), "变化量"),
        ("变化量为 0", cmd("t", vec![morale(SIGMA, 0)]), "变化量"),
        ("系数为 1", cmd("t", vec![growth(SIGMA, 10_000, 30)]), "系数"),
        ("还没有这座建筑", cmd("t", vec![output(SIGMA, Some(PLANTATION), 12_000, 30)]), "还没有这座建筑"),
        ("建筑没有产出", cmd("t", vec![output(SIGMA, Some(STOREHOUSE), 12_000, 30)]), "没有产出"),
        ("不存在的建筑", cmd("t", vec![output(SIGMA, Some(ColonyBuildingId(99)), 12_000, 30)]), "ColonyBuildingId"),
        (
            "多余的参数",
            cmd(
                "t",
                vec![eff(EffectKind::ColonyMorale, EventParams { building: Some(FARM), ..morale(SIGMA, 5).params })],
            ),
            "多余的参数",
        ),
        (
            "士气效果带了建筑",
            cmd(
                "t",
                vec![eff(
                    EffectKind::ColonyGrowth,
                    EventParams { building: Some(FARM), ..growth(SIGMA, 12_000, 30).params },
                )],
            ),
            "多余的参数",
        ),
        (
            "同一殖民地的产量效果重复",
            cmd("t", vec![output(SIGMA, Some(FARM), 12_000, 30), output(SIGMA, None, 11_000, 30)]),
            "重复",
        ),
        ("殖民点已有殖民地", cmd("t", vec![claim(SIGMA, CROWN)]), "已有殖民地"),
        ("港口不能被占领", cmd("t", vec![claim(ALPHA, CROWN)]), "殖民点"),
        ("不存在的势力", cmd("t", vec![claim(SIGMA, FactionId(9))]), "FactionId"),
        ("不存在的发现物", cmd("t", vec![rumor(DiscoveryId(9))]), "DiscoveryId"),
    ];
    assert!(cases.len() >= 10);
    for (name, c, needle) in cases {
        let mut w = w.clone();
        let before = w.state.clone();
        let err = c.validate(&w).expect_err(name).to_string();
        assert!(err.contains(needle), "{name}：{err}");
        assert!(c.apply(&mut w).is_err(), "{name}：执行也应失败");
        assert_eq!(w.state, before, "{name}：被拒绝的命令不能留下改动");
    }
    // 目标不存在：殖民地放弃后，殖民地效果没有对象
    let mut gone = w.clone();
    ok(&mut gone, Command::AbandonColony { owner: P, colony: id });
    let err = cmd("t", vec![morale(SIGMA, 5)]).validate(&gone).unwrap_err().to_string();
    assert!(err.contains("没有殖民地"), "{err}");
    // 已有进行中的同类效果：不叠加
    let mut w2 = w.clone();
    ok(&mut w2, cmd("丰收", vec![output(SIGMA, Some(FARM), 12_000, 60)]));
    advance(&mut w2, 12);
    let err = cmd("又一次丰收", vec![output(SIGMA, None, 11_000, 30)]).validate(&w2).unwrap_err().to_string();
    assert!(err.contains("进行中"), "{err}");
}

/// 对玩家殖民地的负面效果要克制：新殖民地在保护期内、正在断粮或近期遭袭的殖民地不受负面效果。
#[test]
fn harmful_effects_spare_new_and_troubled_colonies() {
    let (w, id) = colony_world(calm(|_| {}), 7);
    // 新殖民地：建立后 30 天内
    let mut fresh = w.clone();
    fresh.state.colonies.get_mut(&id).unwrap().founded = fresh.day() - 5;
    let err = cmd("t", vec![morale(SIGMA, -5)]).validate(&fresh).unwrap_err().to_string();
    assert!(err.contains("保护期"), "{err}");
    assert!(cmd("t", vec![morale(SIGMA, 5)]).validate(&fresh).is_ok(), "有利的效果不受限制");
    // 正在断粮
    let mut starving = w.clone();
    starving.state.colonies.get_mut(&id).unwrap().starving_days = 3;
    let err = cmd("t", vec![output(SIGMA, None, 8_000, 30)]).validate(&starving).unwrap_err().to_string();
    assert!(err.contains("困境"), "{err}");
    // 近 30 天遭袭
    let mut raided = w.clone();
    raided.state.colonies.get_mut(&id).unwrap().last_raid = Some(raided.day() - 10);
    let err = cmd("t", vec![growth(SIGMA, 8_000, 30)]).validate(&raided).unwrap_err().to_string();
    assert!(err.contains("困境"), "{err}");
    assert!(cmd("t", vec![growth(SIGMA, 12_000, 30)]).validate(&raided).is_ok());
    // 平常时候可以
    assert!(cmd("t", vec![growth(SIGMA, 8_000, 30)]).validate(&w).is_ok());
}

#[test]
fn rumors_need_fame_and_undiscovered_targets() {
    let mut w = World::new(calm(|d| d.rules.discovery.rumor_min_fame = 25), ScenarioId(0), 8).unwrap();
    advance(&mut w, 2);
    let err = cmd("t", vec![rumor(ARCH)]).validate(&w).unwrap_err().to_string();
    assert!(err.contains("名声"), "{err}");
    w.state.agents.get_mut(&P).unwrap().fame = 30;
    // 已经发现的不再流传
    w.state.explore.discovered.insert(WRECK, 1);
    let err = cmd("t", vec![rumor(WRECK)]).validate(&w).unwrap_err().to_string();
    assert!(err.contains("已经发现"), "{err}");
    ok(&mut w, cmd("老水手的海图", vec![rumor(ARCH)]));
    // 同一件发现物不重复传闻
    advance(&mut w, 70);
    let err = cmd("t", vec![rumor(ARCH)]).validate(&w).unwrap_err().to_string();
    assert!(err.contains("已经有"), "{err}");
}

#[test]
fn site_claims_follow_diplomacy_and_the_race_rules() {
    // 交战中的势力不能用事件占领殖民点
    let mut w = World::new(calm(|_| {}), ScenarioId(0), 9).unwrap();
    advance(&mut w, 2);
    for r in w.state.relations.iter_mut() {
        r.status = DiploStatus::War;
    }
    let err = cmd("t", vec![claim(SIGMA, CROWN)]).validate(&w).unwrap_err().to_string();
    assert!(err.contains("战争"), "{err}");
    // 开局保护期
    let w = World::new(calm(|d| d.rules.colony.claim_start_day = 200), ScenarioId(0), 9).unwrap();
    assert!(claim_blocker(&w, CROWN, SIGMA).is_some_and(|m| m.contains("尚未开始")));
    assert!(cmd("t", vec![claim(SIGMA, CROWN)]).validate(&w).is_err());
    // 势力范围：离本国港口太远
    let w = World::new(calm(|d| d.rules.colony.claim_reach = 2), ScenarioId(0), 9).unwrap();
    assert!(!faction_reaches(&w.defs, CROWN, SIGMA));
    assert!(claim_blocker(&w, CROWN, SIGMA).is_some_and(|m| m.contains("太远")));
    // 上限随年代放开
    let mut w = World::new(
        calm(|d| {
            d.rules.colony.claim_slot_years = 2;
            d.rules.colony.max_claims_per_faction = 3;
        }),
        ScenarioId(0),
        9,
    )
    .unwrap();
    assert_eq!(faction_claim_cap(&w, CROWN), 1);
    w.state.day = 2 * 360;
    assert_eq!(faction_claim_cap(&w, CROWN), 2);
    w.state.day = 20 * 360;
    assert_eq!(faction_claim_cap(&w, CROWN), 3, "不超过 max_claims_per_faction");
    // 冷却：刚占领过的势力暂不再占领（别的势力不受影响）
    let mut w = World::new(
        calm(|d| {
            d.rules.colony.claim_cooldown_days = 100;
            d.rules.colony.claim_chance_bp = 0;
        }),
        ScenarioId(0),
        9,
    )
    .unwrap();
    advance(&mut w, 2);
    ok(&mut w, cmd("插旗", vec![claim(SIGMA, CROWN)]));
    assert!(claim_blocker(&w, CROWN, TAU).is_some_and(|m| m.contains("近期")));
    assert!(claim_blocker(&w, LEAGUE, TAU).is_none());
    let err = cmd("再插一面旗", vec![claim(TAU, CROWN)]).validate(&w).unwrap_err().to_string();
    assert!(err.contains("近期") || err.contains("冷却"), "{err}");
    advance(&mut w, 100);
    assert!(claim_blocker(&w, CROWN, TAU).is_none(), "冷却期过后可以再占领");
}

/// 殖民竞赛：概率随已占数量递减、到了上限不再占领、开局保护期内不占领。
#[test]
fn claim_race_respects_start_day_and_caps() {
    let mut w = World::new(
        calm(|d| {
            d.rules.colony.claim_chance_bp = 10_000;
            d.rules.colony.claim_start_day = 100;
        }),
        ScenarioId(0),
        10,
    )
    .unwrap();
    advance(&mut w, 90);
    assert_eq!(w.claim_of(SIGMA), None, "第一个季度末仍在开局保护期内");
    advance(&mut w, 90);
    assert!(matches!(w.claim_of(SIGMA), Some(Claim::Faction(_))), "保护期过后季度末占领");
    // 上限为 0 的势力不占领
    let mut w = World::new(
        calm(|d| {
            d.rules.colony.claim_chance_bp = 10_000;
            d.rules.colony.max_claims_per_faction = 0;
        }),
        ScenarioId(0),
        10,
    )
    .unwrap();
    advance(&mut w, 200);
    assert_eq!(w.claim_of(SIGMA), None);
}

/// 同样的开局与命令两次执行，状态哈希一致（组合事件的殖民效果可重放）。
#[test]
fn colony_effects_are_deterministic() {
    let run = || {
        let (mut w, _) = colony_world(calm(|_| {}), 11);
        ok(&mut w, cmd("移民潮", vec![growth(SIGMA, 15_000, 60), morale(SIGMA, 6)]));
        advance(&mut w, 12);
        ok(&mut w, cmd("工匠抵达", vec![output(SIGMA, None, 12_000, 45), rumor(ARCH)]));
        advance(&mut w, 60);
        w.state_hash()
    };
    assert_eq!(run(), run());
}

/// 提示词中的“新大陆局势”：列出现有殖民地与产出建筑、可以流传的传闻、可以占领的殖民点，与内核的校验一致。
#[test]
fn frontier_catalog_lists_only_valid_targets() {
    let (w, _) = colony_world(calm(|_| {}), 12);
    let text = manifest_core::composed::frontier_catalog(&w, 2_000);
    assert!(text.contains("sigma=sigma") && text.contains("晨星垦地") && text.contains("farm=farm 1 级"), "{text}");
    assert!(text.contains("sky_arch"), "名声足够（建立殖民地 +10）时列出可以流传的传闻：{text}");
    assert!(text.contains("tau=tau"), "无主、可以占领的殖民点：{text}");
    assert!(!text.contains("sigma=sigma（可占领"), "已有殖民地的殖民点不能被占领：{text}");
    // 长度上限
    assert!(manifest_core::composed::frontier_catalog(&w, 20).chars().count() <= 20);
}
