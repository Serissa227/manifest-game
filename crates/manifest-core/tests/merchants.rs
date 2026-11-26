//! 第八批 E5：本地商人的预期与囤货（docs/ECONOMY.md 6.6）与传闻进入预期（8.3）。
//! 四条启发式规则、绩效与占比的已知答案；小型世界（去掉商会、流行与目录事件）里的受控实验：
//! - 同一场减产冲击：强趋势派当道时涨价引来囤积，峰比没有商人时更高（超调）；锚定派当道时高价抛售，峰更低、偏离更小（回归更快）；
//!   放任学习（默认）时与没有商人相差无几；
//! - 一条假的短缺传闻让商人囤货、价格上涨，传闻衰减后回到正常；
//! - 规则关闭时没有商人；旧存档打开后开张；存档往返与重放一致。
//!
//! 内核不用浮点，比例一律用万分之一的整数。

use manifest_core::merchants::{Heuristic, exp_neg, heuristic_forecasts, next_shares};
use manifest_core::news::{NewsFact, NewsSource};
use manifest_core::replay::{StartParams, replay};
use manifest_core::save::SaveFile;
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::*;
use std::sync::Arc;

const LOC: LocId = LocId(0);
/// alpha 港的铁：均衡产量 10、日消耗 10、基准价 45
const IRON: GoodId = GoodId(3);

/// 安静的小型世界：去掉商会、流行、目录事件与海盗；`on` 打开本地商人。
fn defs_with(on: bool) -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.rules.merchants.enabled = on;
    d.companies.clear();
    d.meta.keys.companies.clear();
    d.rules.seasonal_popular_bp = 0;
    d.rules.pirates.spawn_scale = Fx::ZERO;
    for e in &mut d.events {
        e.max_per_year = 0;
    }
    Arc::new(d)
}

fn entry_mut(w: &mut World) -> &mut world::MarketEntry {
    w.state.locations[LOC.idx()].market.get_mut(&IRON).unwrap()
}

#[test]
fn the_four_rules_follow_their_formulas() {
    // 今天 100、昨天 90、适应派上次的预测 95、长期均价 80（万分之一金币 × 10000）
    let f = heuristic_forecasts(1_000_000, 900_000, 950_000, 800_000);
    assert_eq!(f[Heuristic::Ada as usize], 982_500, "0.65 × 100 + 0.35 × 95");
    assert_eq!(f[Heuristic::Wtr as usize], 1_040_000, "100 + 0.4 × 10");
    assert_eq!(f[Heuristic::Str as usize], 1_130_000, "100 + 1.3 × 10");
    assert_eq!(f[Heuristic::Laa as usize], 1_000_000, "(80 + 100) / 2 + 10");
    assert_eq!(Heuristic::ALL.map(|h| h.key()), ["ada", "wtr", "str", "laa"]);
}

#[test]
fn the_exp_table_is_monotone_and_close_to_known_values() {
    assert_eq!(exp_neg(Fx::ZERO), Fx::ONE);
    assert!((exp_neg(Fx::ONE).raw() - 3_679).abs() <= 1);
    assert!((exp_neg(Fx::from_bp(25_000)).raw() - 821).abs() <= 2, "e^−2.5");
    assert!((exp_neg(Fx::from_bp(5_000)).raw() - 6_065).abs() <= 2, "e^−0.5");
    assert_eq!(exp_neg(Fx::from_int(11)), Fx::ZERO);
    let mut last = Fx::ONE;
    for k in 1..=220 {
        let v = exp_neg(Fx::from_bp(k * 500));
        assert!(v <= last, "单调递减：x = {}", k * 500);
        last = v;
    }
}

#[test]
fn shares_move_toward_the_better_rule_and_keep_a_floor() {
    let r = defs_with(true).rules.merchants.clone();
    let mut shares = [Fx::from_pct(25); 4];
    // 适应派一直最准
    let perf = [Fx::ZERO, Fx::from_int(-20), Fx::from_int(-20), Fx::from_int(-20)];
    for step in 0..200 {
        let next = next_shares(&r, shares, perf);
        assert_eq!(next.iter().fold(Fx::ZERO, |s, x| s + *x), Fx::ONE, "占比之和为 1（第 {step} 步）");
        assert!(next.iter().all(|x| *x >= r.min_share - Fx(1)), "每条规则至少 5%：{next:?}");
        assert!(next[0] >= shares[0]);
        shares = next;
    }
    assert!(shares[0] > Fx::from_pct(80), "最准的一派占了上风：{shares:?}");
}

/// 同一个种子跑一场减产冲击（第 60–80 天 alpha 的铁颗粒无收），可选把四派的占比锁住；返回每天的报价（万分之一金币，相对冲击前的均价）。
fn shock(on: bool, force: Option<[i64; 4]>, seed: u64) -> Vec<i64> {
    let mut w = World::new(defs_with(on), ScenarioId(0), seed).unwrap();
    let mut prices = Vec::new();
    for day in 0..300 {
        let e = entry_mut(&mut w);
        e.event_supply = if (60..80).contains(&day) { Fx::ZERO } else { Fx::ONE };
        if let Some(f) = force
            && !e.merchants.is_unset()
        {
            e.merchants.shares = f.map(Fx);
        }
        w.end_day().unwrap();
        check_invariants(&w).unwrap();
        prices.push(w.market(LOC, IRON).unwrap().price);
    }
    let normal: i64 = prices[40..60].iter().sum::<i64>() / 20;
    prices.iter().map(|p| p * 10_000 / normal).collect()
}

/// 冲击期间的峰（万分之一）与第 60–240 天偏离正常的总量。
fn stats(v: &[i64]) -> (i64, i64) {
    let peak = v[60..140].iter().copied().max().unwrap_or(0);
    let area: i64 = v[60..240].iter().map(|x| (x - 10_000).abs()).sum();
    (peak, area)
}

#[test]
fn trend_followers_overshoot_and_anchors_revert_faster() {
    const TREND: [i64; 4] = [500, 500, 8_500, 500];
    const ANCHOR: [i64; 4] = [500, 500, 500, 8_500];
    let (mut over, mut free_gap) = (0, 0);
    for seed in [1, 2, 3] {
        let (base_peak, base_area) = stats(&shock(false, None, seed));
        let (trend_peak, _) = stats(&shock(true, Some(TREND), seed));
        let (anchor_peak, anchor_area) = stats(&shock(true, Some(ANCHOR), seed));
        let (free_peak, _) = stats(&shock(true, None, seed));
        // 趋势派当道：涨价引来囤积，峰比没有商人时更高
        assert!(trend_peak > base_peak, "种子 {seed}：趋势派的峰 {trend_peak} 应高于没有商人时的 {base_peak}");
        assert!(trend_peak > anchor_peak + 1_000, "种子 {seed}：趋势派 {trend_peak} 与锚定派 {anchor_peak}");
        over += trend_peak - base_peak;
        // 锚定派当道：高价时抛售，峰低一截，偏离正常的总量更小
        assert!(anchor_peak * 100 < base_peak * 96, "种子 {seed}：锚定派的峰 {anchor_peak}，没有商人时 {base_peak}");
        assert!(anchor_area < base_area, "种子 {seed}：偏离总量 {anchor_area} / {base_area}");
        // 放任学习（默认）：与没有商人相差无几
        free_gap += (free_peak - base_peak).abs();
    }
    assert!(over / 3 > 300, "趋势派的峰平均高出 {} 个万分点", over / 3);
    assert!(free_gap / 3 < 500, "默认情况下峰只差 {} 个万分点", free_gap / 3);
}

#[test]
fn a_false_rumor_moves_prices_then_fades() {
    let mut w = World::new(defs_with(true), ScenarioId(0), 5).unwrap();
    for _ in 0..60 {
        w.end_day().unwrap();
    }
    let normal = w.market(LOC, IRON).unwrap().price;
    let hoard0 = w.market(LOC, IRON).unwrap().merchants.hoard;
    // 一条假的“铁短缺”传闻（库存其实正常），可信度 90
    let fact = NewsFact::Shortage { loc: LOC, good: IRON };
    Command::PublishNews {
        fact,
        source: NewsSource::Merchant,
        credibility: 90,
        text: "听说铁要断货了".into(),
        tpl: None,
    }
    .apply(&mut w)
    .unwrap();
    assert!(!w.state.news.news.last().unwrap().truthful, "这是假传闻");
    assert!(w.market(LOC, IRON).unwrap().merchants.rumor > Fx::from_pct(13));
    let mut peak = 0;
    for _ in 0..15 {
        w.end_day().unwrap();
        peak = peak.max(w.market(LOC, IRON).unwrap().price);
    }
    let e = w.market(LOC, IRON).unwrap();
    assert!(e.merchants.hoard > hoard0, "商人囤货：{hoard0} → {}", e.merchants.hoard);
    assert!(peak * 100 >= normal * 105, "传闻让价格上涨：{normal} → {peak}");
    // 传闻衰减之后，存货放回市场，价格回到正常
    for _ in 0..90 {
        w.end_day().unwrap();
    }
    let e = w.market(LOC, IRON).unwrap();
    assert!(e.merchants.rumor.raw().abs() < 10, "传闻已经淡了：{:?}", e.merchants.rumor);
    assert!((e.price - normal).abs() * 100 <= normal * 5, "价格回到正常：{normal} → {}", e.price);
    check_invariants(&w).unwrap();
}

#[test]
fn switched_off_there_are_no_merchants_and_an_old_save_opens_shop_when_turned_on() {
    let mut w = World::new(defs_with(false), ScenarioId(0), 6).unwrap();
    for _ in 0..30 {
        w.end_day().unwrap();
    }
    assert!(w.state.locations.iter().flat_map(|l| l.market.values()).all(|e| e.merchants.is_unset()));
    assert!(!serde_json::to_string(&w.state).unwrap().contains("\"merchants\""));
    let stock = w.market(LOC, IRON).unwrap().stock;
    let mut w = World::from_snapshot(defs_with(true), w.state.clone()).unwrap();
    w.end_day().unwrap();
    let e = w.market(LOC, IRON).unwrap();
    // 开张：四派各占四分之一，带着平常的存货（目标库存的一成，不从市场库存里拿）
    assert_eq!(e.merchants.shares, [Fx::from_pct(25); 4]);
    assert_eq!(e.merchants.hoard, w.defs.rules.merchants.hoard_base.apply(e.target));
    assert!((e.stock - stock).abs() < 20, "开张不从市场拿货：{stock} → {}", e.stock);
}

#[test]
fn merchants_are_saved_and_replayed() {
    let defs = defs_with(true);
    let mut w = World::new(defs.clone(), ScenarioId(0), 7).unwrap();
    for _ in 0..200 {
        w.end_day().unwrap();
    }
    let start = StartParams::new(ScenarioId(0), 7);
    let text = SaveFile::new(&defs, start.clone(), w.state.clone(), Vec::new()).to_json().unwrap();
    assert_eq!(SaveFile::from_json(&text).unwrap().snapshot, w.state);
    assert_eq!(replay(defs, start, &[], w.day()).unwrap().state_hash(), w.state_hash());
}
