//! 开放市场（`rules.toml [market.open]`，`manifest_core::open_market`）在小型世界里的检查：
//! - 每个有市场的地点都收购全部商品：清单以外的商品补上只收不卖的进口条目（产量低于消耗、不是特产）；
//! - 离产地越远，只收不卖的条目的均衡价越高；
//! - 买清单里不出售的货被拒（`NotSoldHere`，世界不变），同一种货卖得掉；在产地买了运到远处卖；
//! - 商会只买当地出售的货；旧存档（开放市场之前）读进来补上条目，此后不变量照旧成立；
//! - 开关关掉时没有补上的条目、存档里没有新字段（真实数据上的逐日金标准见 manifest-sim 的各期测试）。

use manifest_core::fixed::Curve;
use manifest_core::market::{Side, normal_price, quote};
use manifest_core::open_market::{sale_list, sells, trade_distances};
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::*;
use std::sync::Arc;

const ALPHA: LocId = LocId(0);
const BETA: LocId = LocId(1);
const GAMMA: LocId = LocId(2);
const CLOTH: GoodId = GoodId(1);
const SPICE: GoodId = GoodId(2);
const P: OwnerId = OwnerId::Player;

/// 小型世界：香料只在 beta 出产（12/4），alpha 与 gamma 的清单里没有香料；只卖特产（门槛 1.5、不补足）。
/// 贸易距离从 0 格的 0.9 降到 30 格的 0.4（小世界的航线只有几十格，曲线陡一些才看得出远近）。
fn defs_with(open: bool) -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.locations[0].market.retain(|m| m.good != SPICE);
    d.locations[2].market.retain(|m| m.good != SPICE);
    let r = &mut d.rules.open_market;
    r.enabled = open;
    r.sell_min_ratio = Fx::from_pct(150);
    r.sell_min_goods = 0;
    r.ratio_curve = Curve::new(vec![(Fx::ZERO, Fx::from_pct(90)), (Fx::from_int(30), Fx::from_pct(40))]);
    Arc::new(d)
}

fn player_fleet(w: &World) -> FleetId {
    w.fleets_of(P).next().expect("玩家有舰队").id
}

fn market_locs(w: &World) -> Vec<LocId> {
    w.defs.loc_ids().filter(|l| !w.defs.loc(*l).market.is_empty()).collect()
}

#[test]
fn every_market_buys_every_good_and_the_extra_entries_only_buy() {
    let w = World::new(defs_with(true), ScenarioId(0), 1).unwrap();
    for l in market_locs(&w) {
        let ls = &w.state.locations[l.idx()];
        assert_eq!(ls.market.len(), w.defs.goods.len(), "{l:?} 每种商品都有市场条目");
        for (g, e) in &ls.market {
            // 卖出：哪里都询得到价
            assert!(quote(&w, P, l, *g, Side::Sell, 3).is_ok(), "{l:?} 收购 {g:?}");
            assert_eq!(e.extra, w.defs.loc(l).listed(*g).is_none());
            if e.extra {
                assert!(!e.specialty && e.supply < e.demand && e.supply * 10 >= e.demand * 3, "{e:?}");
            }
        }
    }
    // 殖民点没有市场
    assert!(w.state.locations[4].market.is_empty());
    // alpha 与 gamma 的香料是只收不卖的条目：买不了
    for l in [ALPHA, GAMMA] {
        assert!(w.market(l, SPICE).unwrap().extra);
        assert_eq!(quote(&w, P, l, SPICE, Side::Buy, 1).unwrap_err(), CommandError::NotSoldHere);
    }
    assert!(quote(&w, P, BETA, SPICE, Side::Buy, 1).is_ok(), "产地照常出售");
}

#[test]
fn the_farther_from_the_producer_the_higher_the_price() {
    let w = World::new(defs_with(true), ScenarioId(0), 1).unwrap();
    let d = trade_distances(&w.defs);
    let (to_alpha, to_gamma) = (d[BETA.idx()][ALPHA.idx()].unwrap(), d[BETA.idx()][GAMMA.idx()].unwrap());
    assert!(to_gamma < to_alpha, "gamma 离产地 beta 更近：{to_gamma} < {to_alpha}");
    let price = |l: LocId| normal_price(&w.defs, w.market(l, SPICE).unwrap());
    let (near, far, home) = (price(GAMMA), price(ALPHA), price(BETA));
    assert!(home < near && near < far, "产地 {home} < 近处 {near} < 远处 {far}");
    // 开局库存就在均衡值上：现价也是远处更贵
    assert!(w.market(GAMMA, SPICE).unwrap().price < w.market(ALPHA, SPICE).unwrap().price);
}

#[test]
fn buying_what_is_not_sold_is_refused_but_it_can_be_sold_anywhere() {
    let mut w = World::new(defs_with(true), ScenarioId(0), 3).unwrap();
    let fleet = player_fleet(&w);
    assert_eq!(w.fleet(fleet).unwrap().docked_at(), Some(ALPHA));
    // alpha 只卖谷物（特产）：棉布在清单里、香料只收不卖，都买不了，世界不变
    assert_eq!(sale_list(&w.defs, ALPHA), vec![GoodId(0)]);
    let before = w.state_hash();
    for good in [CLOTH, SPICE] {
        let err = Command::Buy { owner: P, fleet, good, qty: 5, max_total: None }.apply(&mut w).unwrap_err();
        assert_eq!(err, CommandError::NotSoldHere);
        assert_eq!(err.code(), "not_sold_here");
        assert_eq!(err.to_string(), "这里不出售这种货：只收购，出售的以本地特产为主");
    }
    assert_eq!(w.state_hash(), before, "被拒的命令不改世界");
    // 去产地 beta 买香料，运回 alpha 卖：alpha 收购，香料价被压低
    Command::Resupply { owner: P, fleet, food: 30, water: 30 }.apply(&mut w).unwrap();
    Command::SetSail { owner: P, fleet, dest: BETA }.apply(&mut w).unwrap();
    while w.fleet(fleet).unwrap().docked_at() != Some(BETA) {
        w.end_day().unwrap();
        assert!(w.day() < 60);
    }
    Command::Buy { owner: P, fleet, good: SPICE, qty: 10, max_total: None }.apply(&mut w).unwrap();
    Command::SetSail { owner: P, fleet, dest: ALPHA }.apply(&mut w).unwrap();
    while w.fleet(fleet).unwrap().docked_at() != Some(ALPHA) {
        w.end_day().unwrap();
        check_invariants(&w).unwrap();
        assert!(w.day() < 120);
    }
    let have = w.fleet(fleet).unwrap().cargo.get(&SPICE).copied().unwrap_or(0);
    assert_eq!(have, 10);
    let q = quote(&w, P, ALPHA, SPICE, Side::Sell, have).unwrap();
    assert!(q.price_after < q.price_before, "卖出压低价格");
    let out = Command::Sell { owner: P, fleet, good: SPICE, qty: have, min_total: None }.apply(&mut w).unwrap();
    assert_eq!(out, CommandOutcome::Traded(q));
    assert_eq!(w.fleet(fleet).unwrap().cargo.get(&SPICE).copied().unwrap_or(0), 0);
    check_invariants(&w).unwrap();
}

#[test]
fn companies_buy_only_what_the_port_sells() {
    let mut w = World::new(defs_with(true), ScenarioId(0), 11).unwrap();
    let mut bought = 0i64;
    for _ in 0..720 {
        w.end_day().unwrap();
        let day = w.day() - 1;
        for l in market_locs(&w) {
            for (g, e) in &w.state.locations[l.idx()].market {
                if e.flow.day == day && e.flow.npc_bought > 0 {
                    assert!(!e.extra && sells(&w.defs, l, *g), "第 {day} 天商会在 {l:?} 买了不出售的 {g:?}");
                    bought += e.flow.npc_bought;
                }
            }
        }
    }
    check_invariants(&w).unwrap();
    assert!(bought > 0, "商会照样做生意");
}

/// 开放市场让每个港口都收军需品：规划卖货时只看自己有许可证的港口（原来会在没有许可证的港口之间来回跑，
/// 货一直卖不掉——真实数据里一家商会因此破产，见 DECISIONS“开放市场”）。
#[test]
fn planners_only_sell_munitions_where_they_hold_a_license() {
    use manifest_core::npc::{PlannerParams, plan_load, stage_unload};
    use manifest_core::rng::{Domain, Rng};
    const IRON: GoodId = GoodId(3);
    // 铁在 gamma 最贵（4/12，没有许可证）、在 beta 便宜（14/7，有许可证）：只看价钱会驶往 gamma
    let mut d = (*defs_with(true)).clone();
    for (loc, supply, demand) in [(BETA, 14, 7), (GAMMA, 4, 12)] {
        let m = d.locations[loc.idx()].market.iter_mut().find(|m| m.good == IRON).unwrap();
        (m.supply, m.demand, m.specialty) = (supply, demand, supply > demand);
    }
    let mut w = World::new(Arc::new(d), ScenarioId(0), 3).unwrap();
    assert!(w.defs.good(IRON).license);
    assert!(w.market(GAMMA, IRON).unwrap().price > w.market(BETA, IRON).unwrap().price * 3);
    let fleet = player_fleet(&w);
    assert_eq!(w.fleet(fleet).unwrap().docked_at(), Some(ALPHA));
    // 船上有铁（军需品），只有 beta 所属势力的许可证；alpha、gamma 属于另一个势力
    w.state.fleets.get_mut(&fleet).unwrap().cargo.insert(IRON, 20);
    w.state.agents.get_mut(&P).unwrap().licenses = vec![w.defs.loc(BETA).faction];
    assert_ne!(w.defs.loc(ALPHA).faction, w.defs.loc(BETA).faction);
    assert_eq!(w.defs.loc(ALPHA).faction, w.defs.loc(GAMMA).faction);
    let params = PlannerParams::for_owner(&w, P);
    let unload = stage_unload(&w, fleet, &params);
    assert!(
        !unload.iter().any(|c| matches!(c, Command::Sell { good, .. } if *good == IRON)),
        "alpha 没有许可证，不在这里卖：{unload:?}"
    );
    let mut rng = Rng::derive(3, 0, Domain::Scenario, 0, 77);
    let plan = plan_load(&w, fleet, &params, &mut rng);
    let dest = plan.commands.iter().find_map(|c| match c {
        Command::SetSail { dest, .. } => Some(*dest),
        _ => None,
    });
    assert_eq!(dest, Some(BETA), "带着铁只驶往有许可证的 beta：{:?}", plan.commands);
}

#[test]
fn an_old_save_gains_the_extra_entries_when_loaded() {
    // 开放市场之前的存档：没有补上的条目，存档里没有新字段
    let mut old = World::new(defs_with(false), ScenarioId(0), 5).unwrap();
    for _ in 0..40 {
        old.end_day().unwrap();
    }
    assert!(old.market(ALPHA, SPICE).is_none());
    let json = serde_json::to_string(&old.state).unwrap();
    assert!(!json.contains("\"extra\""));
    let state: WorldState = serde_json::from_str(&json).unwrap();
    let mut w = World::from_snapshot(defs_with(true), state).unwrap();
    for l in market_locs(&w) {
        assert_eq!(w.state.locations[l.idx()].market.len(), w.defs.goods.len());
    }
    let e = w.market(ALPHA, SPICE).unwrap();
    assert!(e.extra && e.stock > 0 && e.stock < e.target, "补上的条目库存取均衡值：{e:?}");
    // 原有条目原样保留（库存、价格）
    assert_eq!(w.market(ALPHA, GoodId(0)), old.market(ALPHA, GoodId(0)));
    check_invariants(&w).unwrap();
    for _ in 0..90 {
        w.end_day().unwrap();
        check_invariants(&w).unwrap();
    }
    // 再存再读：标记跟着存档走，读回来一样
    let again: WorldState = serde_json::from_str(&serde_json::to_string(&w.state).unwrap()).unwrap();
    let w2 = World::from_snapshot(defs_with(true), again).unwrap();
    assert_eq!(w2.state_hash(), w.state_hash());
}

#[test]
fn with_the_switch_off_nothing_is_added_and_everything_listed_is_sold() {
    let w = World::new(defs_with(false), ScenarioId(0), 1).unwrap();
    for l in market_locs(&w) {
        assert_eq!(w.state.locations[l.idx()].market.len(), w.defs.loc(l).market.len());
        for g in w.defs.good_ids() {
            assert!(sells(&w.defs, l, g));
        }
        for m in &w.defs.loc(l).market {
            assert!(quote(&w, P, l, m.good, Side::Buy, 1).is_ok(), "{l:?} 清单里的 {:?} 都能买", m.good);
        }
    }
    assert_eq!(quote(&w, P, ALPHA, SPICE, Side::Sell, 1).unwrap_err(), CommandError::NotTraded, "清单以外照旧不收");
    assert!(!serde_json::to_string(&w.state).unwrap().contains("\"extra\""));
}
