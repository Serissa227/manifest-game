//! 西幻扩展：殖民地（建立、生产、消耗、袭击、税收、放弃、清算）、势力占领殖民点、发现与名声、
//! 殖民地目标，以及迷雾位图在更宽地图上的重映射。全部在小型世界中进行，每天检查不变量。

use manifest_core::colony::{Claim, LossReason};
use manifest_core::defs::{GoalKind, StaticData};
use manifest_core::ids::*;
use manifest_core::log::LogKind;
use manifest_core::nav::{NavTable, SeaMap, Terrain};
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::treasury::Flow;
use manifest_core::warehouse::Holder;
use manifest_core::*;
use std::sync::Arc;

const P: OwnerId = OwnerId::Player;
const ALPHA: LocId = LocId(0);
const GAMMA: LocId = LocId(2);
const SIGMA: LocId = LocId(4);
const GRAIN: GoodId = GoodId(0);
const CLOTH: GoodId = GoodId(1);
const SPICE: GoodId = GoodId(2);
const FARM: ColonyBuildingId = ColonyBuildingId(0);
const PLANTATION: ColonyBuildingId = ColonyBuildingId(1);
const MILL: ColonyBuildingId = ColonyBuildingId(2);
const FORT: ColonyBuildingId = ColonyBuildingId(4);
const DOCK: ColonyBuildingId = ColonyBuildingId(6);

/// 小型世界，关闭海盗舰队（航行不被打断；殖民地袭击按海区活跃度另算，不受影响）。
fn calm(edit: impl FnOnce(&mut StaticData)) -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.rules.pirates.spawn_scale = Fx::ZERO;
    edit(&mut d);
    Arc::new(d)
}

fn world_with(defs: Arc<StaticData>, seed: u64) -> World {
    World::new(defs, ScenarioId(0), seed).expect("开局")
}

fn ok(w: &mut World, c: Command) -> CommandOutcome {
    c.apply(w).unwrap_or_else(|e| panic!("{c:?} 失败：{e}"))
}

fn err(w: &mut World, c: Command) -> String {
    match c.apply(w) {
        Ok(o) => panic!("{c:?} 应被拒绝，却得到 {o:?}"),
        Err(e) => e.to_string(),
    }
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

fn logged(w: &World, pred: impl Fn(&LogKind) -> bool) -> bool {
    w.state.log.iter().any(|e| pred(&e.kind))
}

/// 航行到目的地并等待靠港。
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

/// 在 alpha 招满船员、买好建立物资，航行到 sigma 并建立殖民地（殖民者 12 人）。
fn settle(w: &mut World) -> ColonyId {
    let f = fleet(w);
    let crew = w.fleet(f).unwrap().crew;
    ok(w, Command::HireCrew { owner: P, fleet: f, count: 24 - crew });
    ok(w, Command::Resupply { owner: P, fleet: f, food: 10, water: 10 });
    ok(w, Command::Buy { owner: P, fleet: f, good: GRAIN, qty: 60, max_total: None });
    ok(w, Command::Buy { owner: P, fleet: f, good: CLOTH, qty: 10, max_total: None });
    sail(w, SIGMA);
    let out = ok(w, Command::FoundColony { owner: P, fleet: f, site: SIGMA, name: " 新晨港 ".into(), settlers: 12 });
    let CommandOutcome::ColonyFounded { colony } = out else { panic!("应返回殖民地编号：{out:?}") };
    check_invariants(w).unwrap();
    colony
}

#[test]
fn founding_a_colony_moves_settlers_materials_and_money() {
    let mut w = world_with(calm(|_| {}), 3);
    let cash0 = w.agent(P).unwrap().cash;
    let id = settle(&mut w);
    let c = w.colony(id).unwrap().clone();
    assert_eq!((c.loc, c.owner, c.population, c.name.as_str()), (SIGMA, P, 12, "新晨港"));
    assert_eq!(w.fleet(fleet(&w)).unwrap().crew, 12, "12 名船员成为殖民者");
    assert_eq!(w.claim_of(SIGMA), Some(Claim::Colony(id)));
    // 40 件粮食：一半作为建设消耗，另一半进入殖民地仓库；船上还剩 20 件
    assert_eq!(w.holder_qty(P, Holder::Warehouse(SIGMA), GRAIN), 20);
    assert_eq!(w.fleet(fleet(&w)).unwrap().cargo.get(&GRAIN).copied(), Some(20));
    assert!(c.book_value > 3_000, "账面价值含建立费与消耗的建材");
    assert!(w.agent(P).unwrap().cash < cash0);
    assert_eq!(w.agent(P).unwrap().fame, 10);
    assert!(w.state.money.sinks.get(&Flow::Colony).copied().unwrap_or(0) >= 3_000);
    assert!(logged(&w, |k| matches!(k, LogKind::ColonyFounded { colony, .. } if *colony == id)));
    // 殖民地容量免租金；舰队可直接与殖民地仓库装卸
    let f = fleet(&w);
    ok(
        &mut w,
        Command::Transfer { owner: P, from: Holder::Fleet(f), to: Holder::Warehouse(SIGMA), good: GRAIN, qty: 20 },
    );
    ok(
        &mut w,
        Command::Transfer { owner: P, from: Holder::Fleet(f), to: Holder::Warehouse(SIGMA), good: CLOTH, qty: 10 },
    );
    assert_eq!(w.holder_qty(P, Holder::Warehouse(SIGMA), GRAIN), 40);
    assert_eq!(w.warehouse_capacity(P, SIGMA), 400);
    // 同一殖民点不能再建第二个殖民地
    let msg =
        err(&mut w, Command::FoundColony { owner: P, fleet: f, site: SIGMA, name: "又一处".into(), settlers: 10 });
    assert!(msg.contains("已有殖民地"), "{msg}");
    advance(&mut w, 30);
}

#[test]
fn found_colony_is_validated() {
    let mut w = world_with(calm(|_| {}), 4);
    let f = fleet(&w);
    // 港口不是殖民点；舰队不在殖民点
    assert!(
        err(&mut w, Command::FoundColony { owner: P, fleet: f, site: ALPHA, name: "甲".into(), settlers: 10 })
            .contains("可殖民地点")
    );
    let msg = err(&mut w, Command::FoundColony { owner: P, fleet: f, site: SIGMA, name: "甲".into(), settlers: 10 });
    assert!(msg.contains("探明"), "未到过的殖民点不能建立：{msg}");
    ok(&mut w, Command::Resupply { owner: P, fleet: f, food: 10, water: 10 });
    sail(&mut w, SIGMA);
    // 殖民点没有市场与设施
    assert!(Command::Buy { owner: P, fleet: f, good: GRAIN, qty: 1, max_total: None }.apply(&mut w).is_err());
    assert!(err(&mut w, Command::RentWarehouse { owner: P, loc: SIGMA, capacity: 100 }).contains("设施"));
    assert!(err(&mut w, Command::Resupply { owner: P, fleet: f, food: 1, water: 1 }).contains("码头"));
    assert!(err(&mut w, Command::HireCrew { owner: P, fleet: f, count: 1 }).contains("船员"));
    // 名称、殖民者、船员、物资
    assert!(
        err(&mut w, Command::FoundColony { owner: P, fleet: f, site: SIGMA, name: "  ".into(), settlers: 10 })
            .contains("名称")
    );
    let long = "很".repeat(17);
    assert!(
        err(&mut w, Command::FoundColony { owner: P, fleet: f, site: SIGMA, name: long, settlers: 10 })
            .contains("名称")
    );
    assert!(
        err(&mut w, Command::FoundColony { owner: P, fleet: f, site: SIGMA, name: "甲".into(), settlers: 5 })
            .contains("殖民者")
    );
    let msg = err(&mut w, Command::FoundColony { owner: P, fleet: f, site: SIGMA, name: "甲".into(), settlers: 10 });
    assert!(msg.contains("船员不足"), "船员 12 人、最低 8 人，转出 10 人后不够：{msg}");
    let crew = w.fleet(f).unwrap().crew;
    let msg =
        err(&mut w, Command::FoundColony { owner: P, fleet: f, site: SIGMA, name: "甲".into(), settlers: crew - 8 });
    assert!(msg.contains("殖民者") || msg.contains("grain"), "{msg}");
    check_invariants(&w).unwrap();
}

#[test]
fn buildings_produce_process_and_colonists_eat() {
    let mut w = world_with(calm(|_| {}), 5);
    let id = settle(&mut w);
    let f = fleet(&w);
    ok(
        &mut w,
        Command::Transfer { owner: P, from: Holder::Fleet(f), to: Holder::Warehouse(SIGMA), good: CLOTH, qty: 10 },
    );
    ok(&mut w, Command::BuildColony { owner: P, colony: id, building: FARM });
    // 同一时间只有一个工程；未达条件的建筑被拒绝
    assert!(err(&mut w, Command::BuildColony { owner: P, colony: id, building: MILL }).contains("工程"));
    advance(&mut w, 6);
    assert_eq!(w.colony(id).unwrap().level(FARM), 1, "5 天后农庄完工");
    assert!(logged(&w, |k| matches!(k, LogKind::ColonyBuilt { building, level: 1, .. } if *building == FARM)));
    // 种植园：香料是当地资源，建材（布）从殖民地仓库扣除
    ok(&mut w, Command::BuildColony { owner: P, colony: id, building: PLANTATION });
    assert_eq!(w.holder_qty(P, Holder::Warehouse(SIGMA), CLOTH), 5);
    let grain0 = w.holder_qty(P, Holder::Warehouse(SIGMA), GRAIN);
    advance(&mut w, 10);
    let c = w.colony(id).unwrap();
    assert_eq!(c.level(PLANTATION), 1);
    let est = w.colony_estimates(c);
    assert!(est.iter().any(|e| e.outputs.iter().any(|(g, q)| *g == GRAIN && *q > Fx::from_int(5))));
    assert!(w.holder_qty(P, Holder::Warehouse(SIGMA), GRAIN) > grain0, "农庄产出超过殖民者的消耗");
    assert!(w.holder_qty(P, Holder::Warehouse(SIGMA), SPICE) > 0, "种植园产出香料");
    assert!(c.starving_days == 0 && c.stats.food_eaten > 0);
    // 加工：6 粮 → 1 布
    ok(&mut w, Command::BuildColony { owner: P, colony: id, building: MILL });
    advance(&mut w, 8);
    let cloth = w.holder_qty(P, Holder::Warehouse(SIGMA), CLOTH);
    advance(&mut w, 5);
    assert!(w.holder_qty(P, Holder::Warehouse(SIGMA), CLOTH) > cloth, "加工坊把粮食加工成布");
    // 装船运走产出
    let spice = w.holder_qty(P, Holder::Warehouse(SIGMA), SPICE);
    ok(
        &mut w,
        Command::Transfer { owner: P, from: Holder::Warehouse(SIGMA), to: Holder::Fleet(f), good: SPICE, qty: spice },
    );
    assert_eq!(w.fleet(f).unwrap().cargo.get(&SPICE).copied(), Some(spice));
    advance(&mut w, 40);
    let c = w.colony(id).unwrap();
    assert!(!c.stats.last_produced.is_empty(), "月末记录上月产出");
}

#[test]
fn starvation_shrinks_the_colony_and_can_depopulate_it() {
    let mut w = world_with(calm(|d| d.rules.colony.starve_loss_bp = 2_000), 6);
    let id = settle(&mut w);
    let pop0 = w.colony(id).unwrap().population;
    // 仓库里只有 20 件粮食，每天吃 2 件：十天后断粮
    advance(&mut w, 12);
    let c = w.colony(id).expect("仍在");
    assert!(c.starving_days > 0, "断粮");
    assert!(c.population < pop0, "断粮时人口下降");
    assert!(logged(&w, |k| matches!(k, LogKind::ColonyStarving { colony, .. } if *colony == id)));
    advance(&mut w, 40);
    assert!(w.colony(id).is_none(), "人口耗尽后失去殖民地");
    assert!(logged(&w, |k| matches!(k, LogKind::ColonyLost { reason: LossReason::Depopulated, .. })));
    assert_eq!(w.claim_of(SIGMA), None, "殖民点恢复无主");
}

#[test]
fn raids_strike_colonies_and_forts_reduce_the_risk() {
    let defs = calm(|d| d.rules.colony.raid_scale = Fx::from_int(400));
    let mut w = world_with(defs, 7);
    let id = settle(&mut w);
    let f = fleet(&w);
    ok(
        &mut w,
        Command::Transfer { owner: P, from: Holder::Fleet(f), to: Holder::Warehouse(SIGMA), good: GRAIN, qty: 20 },
    );
    let c = w.colony(id).unwrap().clone();
    let bare = w.colony_raid_bp(&c);
    assert!(bare > 1_000, "海区海盗活跃度 × 危险度 × 系数：{bare}");
    let mut raided = false;
    for _ in 0..30 {
        advance(&mut w, 1);
        if w.colony(id).is_some_and(|c| c.last_raid.is_some()) {
            raided = true;
            break;
        }
    }
    assert!(raided, "高袭击概率下 30 天内应遭袭");
    assert!(logged(&w, |k| matches!(k, LogKind::ColonyRaided { colony, .. } if *colony == id)));
    assert_eq!(w.colony(id).unwrap().stats.raids, 1);
    // 冷却期内不会再次遭袭
    let day = w.day();
    advance(&mut w, 20);
    assert_eq!(w.colony(id).unwrap().last_raid, Some(day - 1));
    // 栅栏堡降低袭击概率
    let mut c = w.colony(id).unwrap().clone();
    c.buildings.insert(FORT, 2);
    assert_eq!(w.colony_defense(&c), 50);
    assert!(w.colony_raid_bp(&c) < bare);
}

#[test]
fn month_end_taxes_upkeep_and_morale_follow_the_rules() {
    let mut w = world_with(calm(|_| {}), 8);
    let id = settle(&mut w);
    let f = fleet(&w);
    ok(
        &mut w,
        Command::Transfer { owner: P, from: Holder::Fleet(f), to: Holder::Warehouse(SIGMA), good: GRAIN, qty: 20 },
    );
    ok(
        &mut w,
        Command::Transfer { owner: P, from: Holder::Fleet(f), to: Holder::Warehouse(SIGMA), good: CLOTH, qty: 10 },
    );
    ok(&mut w, Command::BuildColony { owner: P, colony: id, building: FARM });
    assert!(err(&mut w, Command::SetColonyTax { owner: P, colony: id, rate: 9 }).contains("税率"));
    ok(&mut w, Command::SetColonyTax { owner: P, colony: id, rate: 4 });
    let sources0 = w.state.money.sources.get(&Flow::Colony).copied().unwrap_or(0);
    let sinks0 = w.state.money.sinks.get(&Flow::Colony).copied().unwrap_or(0);
    let to_month_end = 30 - w.day() % 30;
    advance(&mut w, to_month_end);
    let c = w.colony(id).unwrap();
    // 苛税：收入 = 人口 × 200 / 100 × 200%
    assert_eq!(c.stats.last_tax, c.population * 200 * 200 / 10_000);
    assert!(c.stats.last_tax > 0 && c.stats.last_upkeep == 20, "税收与农庄的维护费");
    assert!(c.morale < 60, "苛税压低士气：{}", c.morale);
    assert!(c.stats.last_satisfaction > 0, "布满足了部分消费需求");
    assert_eq!(w.state.money.sources.get(&Flow::Colony).copied().unwrap_or(0) - sources0, c.stats.last_tax);
    assert_eq!(w.state.money.sinks.get(&Flow::Colony).copied().unwrap_or(0) - sinks0, c.stats.last_upkeep);
    assert!(w.money_conserved());
}

#[test]
fn colonies_grow_with_food_housing_and_fame() {
    let mut w = world_with(calm(|_| {}), 9);
    let id = settle(&mut w);
    let f = fleet(&w);
    ok(
        &mut w,
        Command::Transfer { owner: P, from: Holder::Fleet(f), to: Holder::Warehouse(SIGMA), good: GRAIN, qty: 20 },
    );
    ok(&mut w, Command::BuildColony { owner: P, colony: id, building: FARM });
    ok(&mut w, Command::SetColonyTax { owner: P, colony: id, rate: 0 });
    let pop0 = w.colony(id).unwrap().population;
    advance(&mut w, 120);
    let c = w.colony(id).unwrap();
    assert!(c.population > pop0, "有粮、士气高时人口增长：{} → {}", pop0, c.population);
    assert!(c.population <= w.colony_housing(c), "不超过人口上限");
    assert!(c.morale >= 50);
}

#[test]
fn abandoning_writes_off_the_colony() {
    let mut w = world_with(calm(|_| {}), 10);
    let id = settle(&mut w);
    let property = |w: &World| w.agent(P).unwrap().ledger.balance(manifest_core::ledger::Account::Property);
    let before = property(&w);
    let book = w.colony(id).unwrap().book_value;
    ok(&mut w, Command::AbandonColony { owner: P, colony: id });
    assert!(w.colony(id).is_none());
    assert_eq!(property(&w), before - book);
    assert_eq!(w.holder_qty(P, Holder::Warehouse(SIGMA), GRAIN), 0, "仓库存货随之损失");
    assert_eq!(w.claim_of(SIGMA), None);
    assert!(logged(&w, |k| matches!(k, LogKind::ColonyLost { reason: LossReason::Abandoned, .. })));
    check_invariants(&w).unwrap();
    // 殖民点恢复无主，可以再次建立
    let f = fleet(&w);
    let crew = w.fleet(f).unwrap().crew;
    let msg = err(&mut w, Command::FoundColony { owner: P, fleet: f, site: SIGMA, name: "再起".into(), settlers: 10 });
    assert!(!msg.contains("已有殖民地") && crew == 12, "{msg}");
}

#[test]
fn bankrupt_owners_sell_their_colonies() {
    let mut w = world_with(calm(|_| {}), 11);
    let id = settle(&mut w);
    // 农庄保证殖民地在破产前不会因断粮而消亡
    ok(&mut w, Command::BuildColony { owner: P, colony: id, building: FARM });
    let book = w.colony(id).unwrap().book_value;
    let sources0 = w.state.money.sources.get(&Flow::Colony).copied().unwrap_or(0);
    // 把现金全部投进港口，之后的工资与维护费使现金为负，30 天后破产重组
    let cash = w.agent(P).unwrap().cash;
    ok(&mut w, Command::InvestPort { owner: P, loc: ALPHA, amount: cash });
    advance(&mut w, 45);
    assert_eq!(w.agent(P).unwrap().reorganizations, 1);
    assert!(w.colony(id).is_none(), "破产重组时殖民地被出售");
    assert!(logged(&w, |k| matches!(k, LogKind::ColonyLost { reason: LossReason::Sold, .. })));
    let gained = w.state.money.sources.get(&Flow::Colony).copied().unwrap_or(0) - sources0;
    assert!(gained >= book / 2, "按账面价值的一半出售：{gained} vs {book}");
    assert!(w.money_conserved());
}

#[test]
fn factions_claim_free_sites_each_quarter() {
    let mut w = world_with(calm(|d| d.rules.colony.claim_chance_bp = 10_000), 12);
    assert_eq!(w.claim_of(SIGMA), None);
    advance(&mut w, 89);
    assert_eq!(w.claim_of(SIGMA), None, "季度末之前不占领");
    advance(&mut w, 1);
    let Some(Claim::Faction(f)) = w.claim_of(SIGMA) else { panic!("季度末有势力占领殖民点") };
    assert!(logged(&w, |k| matches!(k, LogKind::SiteClaimed { loc, faction } if *loc == SIGMA && *faction == f)));
    // 被占领的殖民点不能建立殖民地
    let fl = fleet(&w);
    ok(&mut w, Command::Resupply { owner: P, fleet: fl, food: 10, water: 10 });
    sail(&mut w, SIGMA);
    let msg = err(&mut w, Command::FoundColony { owner: P, fleet: fl, site: SIGMA, name: "迟到".into(), settlers: 8 });
    assert!(msg.contains("占领"), "{msg}");
}

#[test]
fn claims_are_deterministic_per_seed() {
    let run = |seed| {
        let mut w = world_with(calm(|d| d.rules.colony.claim_chance_bp = 3_000), seed);
        advance(&mut w, 720);
        (w.claim_of(SIGMA), w.state_hash())
    };
    assert_eq!(run(21), run(21));
}

#[test]
fn docks_allow_resupply_at_the_colony() {
    let mut w = world_with(calm(|_| {}), 13);
    let id = settle(&mut w);
    let f = fleet(&w);
    ok(&mut w, Command::BuildColony { owner: P, colony: id, building: DOCK });
    advance(&mut w, 6);
    assert!(w.colony_has_dock(P, SIGMA));
    ok(&mut w, Command::Resupply { owner: P, fleet: f, food: 5, water: 5 });
    // 殖民地可以作为出发地与目的地
    sail(&mut w, ALPHA);
    sail(&mut w, SIGMA);
}

#[test]
fn discoveries_are_found_by_sight_and_reported_in_port() {
    let mut w = world_with(calm(|_| {}), 14);
    let wreck = DiscoveryId(0);
    advance(&mut w, 1);
    assert!(!w.state.explore.discovered.contains_key(&wreck), "开局视野外");
    let msg = err(&mut w, Command::ReportDiscovery { owner: P, discovery: wreck, loc: ALPHA });
    assert!(msg.contains("尚未发现"), "{msg}");
    let f = fleet(&w);
    ok(&mut w, Command::Resupply { owner: P, fleet: f, food: 10, water: 10 });
    sail(&mut w, GAMMA);
    assert!(w.state.explore.discovered.contains_key(&wreck), "沿途视野覆盖到沉船");
    assert!(logged(&w, |k| matches!(k, LogKind::Discovered { discovery, .. } if *discovery == wreck)));
    assert!(!w.state.explore.discovered.contains_key(&DiscoveryId(1)), "远处的发现物仍未发现");
    assert_eq!(w.unreported_discoveries().collect::<Vec<_>>(), vec![wreck]);
    let cash = w.agent(P).unwrap().cash;
    let faction = w.defs.loc(GAMMA).faction;
    let rep = w.reputation(P, faction);
    let out = ok(&mut w, Command::ReportDiscovery { owner: P, discovery: wreck, loc: GAMMA });
    assert_eq!(out, CommandOutcome::DiscoveryReported { reward: 2_000, fame: 30 });
    assert_eq!(w.agent(P).unwrap().cash, cash + 2_000);
    assert_eq!(w.agent(P).unwrap().fame, 30);
    assert_eq!(w.reputation(P, faction), rep + 3);
    assert_eq!(w.state.money.sources.get(&Flow::Discovery).copied(), Some(2_000));
    assert!(err(&mut w, Command::ReportDiscovery { owner: P, discovery: wreck, loc: GAMMA }).contains("报告过"));
    check_invariants(&w).unwrap();
}

#[test]
fn high_level_mates_require_fame() {
    let mut w = world_with(calm(|_| {}), 15);
    let mate = MateId(1);
    w.state.mates.get_mut(&mate).unwrap().level = 5;
    let msg = err(&mut w, Command::HireMate { owner: P, mate });
    assert!(msg.contains("名声不足") && msg.contains("40"), "{msg}");
    w.state.agents.get_mut(&P).unwrap().fame = 40;
    ok(&mut w, Command::HireMate { owner: P, mate });
}

#[test]
fn colony_goal_is_reached_by_settling() {
    let defs = calm(|d| {
        d.scenarios[0].goal.kind = GoalKind::Colonies { count: 1, population: 10 };
    });
    let mut w = world_with(defs, 16);
    assert_eq!(w.goal_progress(), Some((0, 1)));
    settle(&mut w);
    assert_eq!(w.goal_progress(), Some((1, 1)));
    advance(&mut w, 1);
    assert_eq!(w.state.outcome.map(|o| o.kind), Some(goals::OutcomeKind::Won));
}

/// 把小型世界的地图向右、向下扩展（新区域为深海），其余内容不变。
fn widened(defs: &StaticData, w: u16, h: u16) -> StaticData {
    let mut d = defs.clone();
    let old = &defs.map;
    let n = w as usize * h as usize;
    let mut map = SeaMap { width: w, height: h, wrap_x: false, terrain: vec![Terrain::Deep; n], region: vec![1; n] };
    for y in 0..old.height {
        for x in 0..old.width {
            let (i, j) = (old.idx(Cell::new(x, y)), map.idx(Cell::new(x, y)));
            map.terrain[j] = old.terrain[i];
            map.region[j] = old.region[i];
        }
    }
    d.regions[1].rect = (20, 0, w - 1, h - 1);
    let ports: Vec<(LocId, Cell)> = d.port_ids().map(|l| (l, d.loc(l).cell)).collect();
    d.nav = Arc::new(NavTable::build(&map, &d.regions, d.locations.len(), &ports));
    d.map = map;
    d
}

#[test]
fn fog_bitmap_is_remapped_onto_a_wider_map() {
    let small = calm(|_| {});
    let mut w = world_with(small.clone(), 17);
    let f = fleet(&w);
    ok(&mut w, Command::Resupply { owner: P, fleet: f, food: 10, water: 10 });
    sail(&mut w, GAMMA);
    let (ow, oh) = (small.map.width as usize, small.map.height as usize);
    let revealed: Vec<(usize, usize)> = (0..oh)
        .flat_map(|y| (0..ow).map(move |x| (x, y)))
        .filter(|(x, y)| w.state.explore.is_revealed(y * ow + x))
        .collect();
    assert!(!revealed.is_empty());
    assert_eq!((w.state.explore.width, w.state.explore.height), (40, 24), "v4 记录迷雾位图的宽高");

    let mut wide = widened(&small, 64, 30);
    wide.rules.world.legacy_map = (40, 24);
    let wide = Arc::new(wide);
    let check = |state: WorldState, label: &str| {
        let loaded = World::from_snapshot(wide.clone(), state).expect("读档");
        let e = &loaded.state.explore;
        assert_eq!((e.width, e.height), (64, 30), "{label}");
        for (x, y) in &revealed {
            assert!(e.is_revealed(y * 64 + x), "{label}：({x}, {y}) 应保持已揭开");
        }
        assert_eq!(e.revealed_count() as usize, revealed.len(), "{label}：新区域仍被迷雾覆盖");
        let mut loaded = loaded;
        for _ in 0..5 {
            loaded.end_day().unwrap();
            check_invariants(&loaded).unwrap();
        }
    };
    // v4：位图记录了宽高
    check(w.state.clone(), "v4");
    // v3 及更早：位图没有宽高，按 rules.world.legacy_map 解释
    let mut json = serde_json::to_value(&w.state).unwrap();
    let explore = json.get_mut("explore").and_then(|v| v.as_object_mut()).unwrap();
    explore.remove("width");
    explore.remove("height");
    check(serde_json::from_value(json).unwrap(), "v3");
}
