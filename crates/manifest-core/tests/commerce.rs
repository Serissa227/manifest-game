//! 第八批 E5：商会 2.0（docs/ECONOMY.md 6.7）在小型世界里的受控检查。
//! - 三种预测方法的已知答案；对玩家的反应与玩家近期交易量的指数平均；
//! - 选货选线看预测价差：目的港的价格正在急跌时，顺势型商会不去，照旧型商会照去；
//! - 装着期货品种驶往交割港时开空头套保，到港卖货后平仓，出航时记下三种方法的预测，卖出后记下误差；
//! - 规则关闭时与旧版一样（没有计划、没有套保）。

use manifest_core::commerce::{forecast_price, fx_pow, player_pressure, reaction_factor};
use manifest_core::defs::{ForecastMethod, Reaction};
use manifest_core::market::normal_price;
use manifest_core::npc::{PlannerParams, plan_load};
use manifest_core::rng::{Domain, Rng};
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::*;
use std::sync::Arc;

const ALPHA: LocId = LocId(0);
const BETA: LocId = LocId(1);
const GAMMA: LocId = LocId(2);
const DELTA: LocId = LocId(3);
const CLOTH: GoodId = GoodId(1);
/// 小型世界的第二家商会（本据港 beta，一艘单桅帆船）
const ANCHOR: OwnerId = OwnerId::Company(CompanyId(1));

fn defs_with(v2: bool, tweak: impl FnOnce(&mut StaticData)) -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.rules.npc.v2.enabled = v2;
    d.rules.seasonal_popular_bp = 0;
    d.rules.pirates.spawn_scale = Fx::ZERO;
    for e in &mut d.events {
        e.max_per_year = 0;
    }
    tweak(&mut d);
    Arc::new(d)
}

#[test]
fn the_three_methods_follow_their_formulas() {
    let w = World::new(defs_with(true, |_| {}), ScenarioId(0), 1).unwrap();
    let mut e = w.market(GAMMA, CLOTH).unwrap().clone();
    e.price = 150;
    e.history = (0..20).map(|i| 290 - i * 7).collect();
    assert_eq!(forecast_price(&w.defs, &e, 10, ForecastMethod::Naive), 150);
    // 顺势：最近 14 天每天跌 7，10 天后 150 − 70
    assert_eq!(forecast_price(&w.defs, &e, 10, ForecastMethod::Trend), 80);
    // 跌幅夹在今天的一半
    assert_eq!(forecast_price(&w.defs, &e, 30, ForecastMethod::Trend), 75);
    // 回归：正常价 + 0.97^天数 × (今天 − 正常价)
    let mu = normal_price(&w.defs, &e);
    let want = mu + fx_pow(Fx::from_pct(97), 10).apply(150 - mu);
    assert_eq!(forecast_price(&w.defs, &e, 10, ForecastMethod::Revert), want);
    assert!((fx_pow(Fx::from_pct(97), 10).raw() - 7_374).abs() <= 2, "0.97^10 ≈ 0.7374");
    // 历史不够两周时顺势就是照旧
    e.history.truncate(10);
    assert_eq!(forecast_price(&w.defs, &e, 10, ForecastMethod::Trend), 150);
}

#[test]
fn reactions_to_the_player_scale_the_score() {
    let s = Fx::from_pct(30);
    assert_eq!(reaction_factor(Reaction::Neutral, s, Fx::ONE), Fx::ONE);
    assert_eq!(reaction_factor(Reaction::Follow, s, Fx::from_pct(50)), Fx::from_pct(115));
    assert_eq!(reaction_factor(Reaction::Avoid, s, Fx::ONE), Fx::from_pct(70));
    // 玩家每天在 alpha 买卖棉布：近期交易量的指数平均逐渐升高，压力按目标库存折算、最多 1
    let mut w = World::new(defs_with(true, |_| {}), ScenarioId(0), 2).unwrap();
    let f = w.fleets_of(OwnerId::Player).next().unwrap().id;
    for _ in 0..40 {
        Command::Buy { owner: OwnerId::Player, fleet: f, good: CLOTH, qty: 2, max_total: None }.apply(&mut w).unwrap();
        Command::Sell { owner: OwnerId::Player, fleet: f, good: CLOTH, qty: 2, min_total: None }.apply(&mut w).unwrap();
        w.end_day().unwrap();
    }
    let e = w.market(ALPHA, CLOTH).unwrap();
    // 每天 4 件，40 天后约 4 × (1 − (29/30)^40) ≈ 2.9 件
    assert!((250..=320).contains(&e.player_recent), "近期交易量 {}", e.player_recent);
    assert!(player_pressure(e) > Fx::ZERO && player_pressure(e) < Fx::from_pct(5));
}

/// 小型世界里只有棉布能在 beta 买到（其余商品在 beta 卖空），alpha 与 delta 的棉布堆成山（去了不赚），
/// 只有 gamma 按今天的价有利可图，而 gamma 的棉布这两周在急跌。
fn falling_gamma(w: &mut World) {
    let target = |w: &World, l: LocId| w.market(l, CLOTH).unwrap().target;
    for (g, e) in w.state.locations[BETA.idx()].market.iter_mut() {
        if *g != CLOTH {
            e.stock = 0;
        }
    }
    for l in [ALPHA, DELTA] {
        let t = target(w, l);
        let e = w.state.locations[l.idx()].market.get_mut(&CLOTH).unwrap();
        e.stock = t * 6;
        e.price = e.base_price / 5;
    }
    let beta = w.state.locations[BETA.idx()].market.get_mut(&CLOTH).unwrap();
    beta.price = 100;
    let e = w.state.locations[GAMMA.idx()].market.get_mut(&CLOTH).unwrap();
    e.price = 150;
    e.history = (0..20).map(|i| 1_100 - i * 50).collect();
}

#[test]
fn companies_pick_routes_by_their_forecast() {
    let mut chosen = Vec::new();
    for method in [ForecastMethod::Naive, ForecastMethod::Trend] {
        let mut w = World::new(defs_with(true, |_| {}), ScenarioId(0), 3).unwrap();
        falling_gamma(&mut w);
        let fid = w.fleets_of(ANCHOR).next().unwrap().id;
        let mut params = PlannerParams::for_owner(&w, ANCHOR);
        assert!(params.v2);
        params.method = method;
        let mut rng = Rng::derive(3, 0, Domain::Company, fid.0 as u64, 0);
        let load = plan_load(&w, fid, &params, &mut rng);
        let dest = load.commands.iter().find_map(|c| match c {
            Command::SetSail { dest, .. } => Some(*dest),
            _ => None,
        });
        let bought = load.commands.iter().any(|c| matches!(c, Command::Buy { good, .. } if *good == CLOTH));
        chosen.push((method, dest, bought, load.plan));
    }
    // 照旧：按今天的价，gamma 有利可图
    let (_, dest, bought, plan) = &chosen[0];
    assert_eq!((*dest, *bought), (Some(GAMMA), true), "照旧型商会去 gamma");
    let plan = plan.as_ref().expect("出航时记下计划");
    assert_eq!((plan.dest, plan.good), (GAMMA, CLOTH));
    assert_eq!(plan.forecasts[0], 150, "照旧的预测就是今天的价");
    assert!(plan.forecasts[1] < 150, "顺势的预测在跌：{:?}", plan.forecasts);
    // 顺势：预计抵达时已经跌到不值得运过去，不去
    let (_, dest, bought, _) = &chosen[1];
    assert!(!bought && *dest != Some(GAMMA), "顺势型商会不去 gamma：{dest:?}");
}

#[test]
fn cargo_bound_for_a_delivery_port_is_hedged_and_the_hedge_is_closed_on_sale() {
    // beta 的棉布便宜，alpha（棉布期货的交割港）贵；gamma 与 delta 的棉布堆成山
    let defs = defs_with(true, |d| {
        d.companies.retain(|c| c.key == "anchor");
        d.meta.keys.companies.retain(|k| k == "anchor");
    });
    let anchor = OwnerId::Company(CompanyId(0));
    let mut w = World::new(defs, ScenarioId(0), 4).unwrap();
    let mut hedged = None;
    let mut closed = false;
    for _ in 0..120 {
        for l in [GAMMA, DELTA] {
            let e = w.state.locations[l.idx()].market.get_mut(&CLOTH).unwrap();
            e.stock = e.target * 6;
        }
        w.end_day().unwrap();
        check_invariants(&w).unwrap();
        for f in w.fleets_of(anchor) {
            if let Some((contract, lots)) = f.plan.as_ref().and_then(|p| p.hedge) {
                assert!(lots < 0, "套保是空头");
                assert_eq!(w.position(anchor, contract).map(|p| p.lots), Some(lots));
                hedged = Some(contract);
            }
        }
        if let Some(c) = hedged
            && w.position(anchor, c).is_none()
        {
            closed = true;
            break;
        }
    }
    assert!(hedged.is_some(), "运棉布去交割港时开了空头");
    assert!(closed, "到港卖货后平仓");
    let s = w.agent(anchor).unwrap().strategy.as_ref().unwrap();
    assert!(s.samples > 0, "卖出后核对了预测");
}

#[test]
fn switched_off_companies_trade_as_before() {
    let mut w = World::new(defs_with(false, |_| {}), ScenarioId(0), 5).unwrap();
    for _ in 0..200 {
        w.end_day().unwrap();
    }
    assert!(w.state.fleets.values().all(|f| f.plan.is_none()));
    assert!(w.state.fleets.values().flat_map(|f| &f.ships).all(|s| s.built == 0));
    let json = serde_json::to_string(&w.state).unwrap();
    for field in ["\"plan\"", "\"built\"", "\"player_recent\"", "\"errors\"", "\"method\""] {
        assert!(!json.contains(field), "关闭时存档里没有 {field}");
    }
    assert_eq!(w.state.money.sinks.get(&treasury::Flow::Dividend), None);
}
