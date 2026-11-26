//! 第八批 E7：商会展望（docs/ECONOMY.md 8.2）在小型世界里的检查。
//! - `SetOutlook` 的校验：未知商品、看法越界、条数过多、重复、备忘为空或过长、冷却期内、破产的商会，全部拒绝且状态不变；
//! - 看法每级让预期偏 3%，30 天内线性消退；预测方法在滞后规则下切换（明显更差的方法不换）；
//! - 规划器按展望的偏向选货：看淡的商品不运，看好的商品让边际生意变得值得。

use manifest_core::commerce::{OUTLOOK_DAYS, OUTLOOK_INTERVAL};
use manifest_core::defs::ForecastMethod;
use manifest_core::npc::{PlannerParams, plan_load};
use manifest_core::rng::{Domain, Rng};
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::*;
use std::sync::Arc;

const ALPHA: LocId = LocId(0);
const BETA: LocId = LocId(1);
const GAMMA: LocId = LocId(2);
const DELTA: LocId = LocId(3);
const GRAIN: GoodId = GoodId(0);
const CLOTH: GoodId = GoodId(1);
const SPICE: GoodId = GoodId(2);
/// 小型世界的第二家商会（本据港 beta）
const ANCHOR: CompanyId = CompanyId(1);

fn quiet(v2: bool) -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.rules.npc.v2.enabled = v2;
    d.rules.seasonal_popular_bp = 0;
    d.rules.pirates.spawn_scale = Fx::ZERO;
    for e in &mut d.events {
        e.max_per_year = 0;
    }
    Arc::new(d)
}

fn outlook(views: Vec<(GoodId, i8)>, method: Option<ForecastMethod>, memo: &str) -> Command {
    Command::SetOutlook { company: ANCHOR, views, method, memo: memo.into(), tpl: None }
}

fn code(r: Result<CommandOutcome, CommandError>) -> &'static str {
    r.expect_err("应被拒绝").code()
}

#[test]
fn illegal_outlooks_are_rejected_and_change_nothing() {
    let mut w = World::new(quiet(true), ScenarioId(0), 1).unwrap();
    let before = w.state.clone();
    let cases: Vec<(Command, &str)> = vec![
        (outlook(vec![(GoodId(99), 1)], None, "看好"), "not_found"),
        (outlook(vec![(CLOTH, 3)], None, "看好"), "out_of_range"),
        (outlook(vec![(CLOTH, -3)], None, "看淡"), "out_of_range"),
        (outlook(vec![(GRAIN, 1), (CLOTH, 1), (SPICE, 1), (GoodId(3), 1), (GRAIN, 2)], None, "五条"), "out_of_range"),
        (outlook(vec![(CLOTH, 1), (CLOTH, -1)], None, "重复"), "out_of_range"),
        (outlook(vec![(CLOTH, 1)], None, ""), "out_of_range"),
        (outlook(vec![(CLOTH, 1)], None, &"长".repeat(61)), "out_of_range"),
        (outlook(vec![(CLOTH, 1)], None, "看好\u{7}"), "out_of_range"),
        (
            Command::SetOutlook { company: CompanyId(9), views: vec![], method: None, memo: "无".into(), tpl: None },
            "not_found",
        ),
    ];
    for (cmd, want) in cases {
        let r = cmd.apply(&mut w);
        assert_eq!(code(r), want, "{cmd:?}");
        assert_eq!(w.state, before, "被拒绝时状态不变：{cmd:?}");
    }
    // 合法的展望记下之后，25 天内再提就拒绝
    outlook(vec![(CLOTH, 2)], None, "看好棉布").apply(&mut w).unwrap();
    for _ in 0..(OUTLOOK_INTERVAL - 1) {
        w.end_day().unwrap();
    }
    let before = w.state.clone();
    assert_eq!(code(outlook(vec![(CLOTH, -1)], None, "改看淡").apply(&mut w)), "precondition");
    assert_eq!(w.state, before);
    w.end_day().unwrap();
    outlook(vec![(CLOTH, -1)], None, "改看淡").apply(&mut w).unwrap();
    check_invariants(&w).unwrap();
    // 破产的商会不能提
    w.state.agents.get_mut(&OwnerId::Company(ANCHOR)).unwrap().bankrupt = true;
    for _ in 0..OUTLOOK_INTERVAL {
        w.end_day().unwrap();
    }
    assert_eq!(code(outlook(vec![(CLOTH, 1)], None, "看好").apply(&mut w)), "bankrupt");
}

#[test]
fn views_fade_over_a_month_and_methods_switch_with_hysteresis() {
    let mut w = World::new(quiet(true), ScenarioId(0), 2).unwrap();
    let owner = OwnerId::Company(ANCHOR);
    outlook(vec![(CLOTH, 2), (SPICE, -1)], Some(ForecastMethod::Trend), "看好棉布，看淡香料").apply(&mut w).unwrap();
    let s = w.agent(owner).unwrap().strategy.clone().unwrap();
    let o = s.outlook.clone().unwrap();
    assert_eq!((o.day, o.memo.as_str()), (0, "看好棉布，看淡香料"));
    // 每级 3%，30 天内线性消退
    assert_eq!(o.bias(CLOTH, 0), Fx::from_pct(6));
    assert_eq!(o.bias(SPICE, 0), Fx::from_pct(-3));
    assert_eq!(o.bias(CLOTH, 15), Fx::from_pct(3));
    assert_eq!(o.bias(CLOTH, OUTLOOK_DAYS), Fx::ZERO);
    assert_eq!(o.bias(GRAIN, 0), Fx::ZERO, "没有看法的商品没有偏向");
    // 样本不足：直接换
    assert_eq!(s.method, Some(ForecastMethod::Trend));
    // 有了样本：明显更差的方法不换，差不多的换（误差在提交前设好：这期间商会在做生意，误差会变）
    let track_record = |w: &mut World| {
        let st = w.state.agents.get_mut(&owner).unwrap().strategy.as_mut().unwrap();
        (st.method, st.samples, st.errors) = (Some(ForecastMethod::Naive), 20, [1_000, 1_500, 1_050]);
    };
    for _ in 0..OUTLOOK_INTERVAL {
        w.end_day().unwrap();
    }
    track_record(&mut w);
    outlook(vec![], Some(ForecastMethod::Trend), "改顺势").apply(&mut w).unwrap();
    assert_eq!(w.company_method(owner), ForecastMethod::Naive, "顺势的误差大五成，不换");
    for _ in 0..OUTLOOK_INTERVAL {
        w.end_day().unwrap();
    }
    track_record(&mut w);
    outlook(vec![], Some(ForecastMethod::Revert), "改回归").apply(&mut w).unwrap();
    assert_eq!(w.company_method(owner), ForecastMethod::Revert, "回归只差半成，换");
}

/// anchor 在 beta 只能买到棉布；alpha 与 delta 的棉布堆成山（去了不赚），gamma 的棉布比 beta 略贵（边际生意）。
fn marginal_gamma(w: &mut World) {
    for (g, e) in w.state.locations[BETA.idx()].market.iter_mut() {
        if *g != CLOTH {
            e.stock = 0;
        }
    }
    for l in [ALPHA, DELTA] {
        let e = w.state.locations[l.idx()].market.get_mut(&CLOTH).unwrap();
        e.stock = e.target * 6;
        e.price = e.base_price / 5;
    }
}

fn plan(w: &World) -> (Option<LocId>, bool) {
    let fid = w.fleets_of(OwnerId::Company(ANCHOR)).next().unwrap().id;
    let params = PlannerParams::for_owner(w, OwnerId::Company(ANCHOR));
    let mut rng = Rng::derive(3, 0, Domain::Company, fid.0 as u64, 0);
    let load = plan_load(w, fid, &params, &mut rng);
    let dest = load.commands.iter().find_map(|c| match c {
        Command::SetSail { dest, .. } => Some(*dest),
        _ => None,
    });
    (dest, load.commands.iter().any(|c| matches!(c, Command::Buy { good, .. } if *good == CLOTH)))
}

#[test]
fn companies_plan_with_their_outlook() {
    // gamma 的棉布价从 beta 的 1.00 倍扫到 3.00 倍：同一个价位上，没有展望、看好两级（+6%）、看淡两级（−6%）各自去不去 gamma
    let goes = |pct: i64, view: Option<i8>| {
        let mut w = World::new(quiet(false), ScenarioId(0), 3).unwrap();
        marginal_gamma(&mut w);
        let beta = w.market(BETA, CLOTH).unwrap().price;
        w.state.locations[GAMMA.idx()].market.get_mut(&CLOTH).unwrap().price = beta * pct / 100;
        if let Some(v) = view {
            outlook(vec![(CLOTH, v)], None, "对棉布的看法").apply(&mut w).unwrap();
        }
        plan(&w) == (Some(GAMMA), true)
    };
    let rows: Vec<(i64, bool, bool, bool)> =
        (100..=300).map(|p| (p, goes(p, None), goes(p, Some(2)), goes(p, Some(-2)))).collect();
    assert!(rows.iter().any(|r| r.1), "价差够大时没有展望也去 gamma");
    assert!(rows.iter().any(|r| r.2 && !r.1), "看好之后，原本不划算的 gamma 棉布生意变得值得");
    assert!(rows.iter().any(|r| r.1 && !r.3), "看淡之后，原本划算的生意不做");
    // 偏向不会反过来：看好时去得了的价位不少于没有展望时，看淡时不多于
    assert!(rows.iter().all(|r| (!r.1 || r.2) && (!r.3 || r.1)), "{rows:?}");
}
