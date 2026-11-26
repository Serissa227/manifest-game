//! 第八批 E3：本地生产者与供给响应（docs/ECONOMY.md 6.3）的受控实验。使用内核自带的小型世界，
//! 去掉 NPC 商会（没有贸易）与随机的流行，只看一个市场里库存、价格与生产者之间的回路：
//! - 冲击之后是阻尼振荡：价格先涨，产能随后扩张并越过开局水平，价格跌破正常再回来，几年内平息；
//! - 头一年只看不动（学各月的参照价）；作物的产能只在季初变化；产能夹在界内；
//! - 余数累计消除小量商品的取整死区；旧存档打开开关后从头一年学起；存档往返与重放一致。

use manifest_core::defs::MarketDef;
use manifest_core::market::{UNIT_BP, demand_mult, shadow_price_bp};
use manifest_core::replay::{StartParams, replay};
use manifest_core::save::SaveFile;
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::*;
use std::sync::Arc;

const LOC: LocId = LocId(0);
/// alpha 港的铁（均衡产量 10、日消耗 10、基准价 45）
const IRON: GoodId = GoodId(3);
/// alpha 港的香料（均衡产量 3、日消耗 8）
const SPICE: GoodId = GoodId(2);

/// 小型世界：打开生产者与余数累计，去掉商会与随机的流行；`tweak` 再做其他修改。
fn defs_with(tweak: impl FnOnce(&mut StaticData)) -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.rules.producers.enabled = true;
    d.rules.producers.fractional = true;
    d.companies.clear();
    d.meta.keys.companies.clear();
    d.rules.seasonal_popular_bp = 0;
    tweak(&mut d);
    Arc::new(d)
}

fn entry(w: &World, good: GoodId) -> &world::MarketEntry {
    w.market(LOC, good).unwrap()
}

fn producer_mut(w: &mut World, good: GoodId) -> &mut world::Producer {
    &mut w.state.locations[LOC.idx()].market.get_mut(&good).unwrap().producer
}

/// 跑一个月，返回这个月铁的影子价格均值（万分之一金币）。
fn month(w: &mut World) -> i64 {
    let mut sum = 0;
    for _ in 0..30 {
        w.end_day().unwrap();
        let e = entry(w, IRON);
        sum += shadow_price_bp(&w.defs, e, demand_mult(&w.defs, w.day(), IRON, e));
    }
    sum / 30
}

/// a / b，以万分之一表示（内核不用浮点，测试也一样）。
fn ratio_bp(a: i64, b: i64) -> i64 {
    a * 10_000 / b
}

/// 最大值第一次出现的位置。
fn argmax(xs: &[i64]) -> usize {
    xs.iter().enumerate().fold(0, |b, (i, v)| if *v > xs[b] { i } else { b })
}

#[test]
fn a_supply_shock_rings_down_as_a_damped_cycle() {
    for seed in [5, 6, 7] {
        let mut w = World::new(defs_with(|_| {}), ScenarioId(0), seed).unwrap();
        for _ in 0..13 {
            month(&mut w);
        }
        let normal = entry(&w, IRON).producer.reference(1);
        let k0 = entry(&w, IRON).producer.k0;
        // 一场灾害：产能减半
        producer_mut(&mut w, IRON).k = k0 / 2;
        // 价格相对正常价、产能相对开局产能（万分之一）
        let (mut price, mut cap) = (Vec::new(), Vec::new());
        for _ in 0..72 {
            price.push(ratio_bp(month(&mut w), normal));
            cap.push(ratio_bp(entry(&w, IRON).producer.k, k0));
        }
        // 价格先涨
        let peak = argmax(&price[..8]);
        assert!(price[peak] > 14_000, "种子 {seed}：价格的峰 {}‱", price[peak]);
        // 产能随后扩张，越过开局水平（峰晚于价格的峰）
        let cap_peak = argmax(&cap[..30]);
        assert!(cap[cap_peak] > 10_800, "种子 {seed}：产能的峰 {}‱", cap[cap_peak]);
        assert!(cap_peak > peak + 4, "种子 {seed}：产能的峰（第 {cap_peak} 月）晚于价格的峰（第 {peak} 月）");
        // 价格跌破正常（过剩），在产能的峰前后
        let low = price[peak..30].iter().copied().min().unwrap_or(i64::MAX);
        assert!(low < 9_500, "种子 {seed}：价格的谷 {low}‱");
        // 几年内平息：后三年价格与产能都回到正常附近
        let late_price = price[36..].iter().map(|p| (p - 10_000).abs()).sum::<i64>() / 36;
        let late_cap = cap[36..].iter().map(|c| (c - 10_000).abs()).max().unwrap_or(0);
        assert!(late_price < 300, "种子 {seed}：后三年价格平均偏离 {late_price}‱");
        assert!(late_cap < 400, "种子 {seed}：后三年产能最大偏离 {late_cap}‱");
        check_invariants(&w).unwrap();
    }
}

#[test]
fn producers_watch_for_a_year_before_acting() {
    let mut w = World::new(defs_with(|_| {}), ScenarioId(0), 3).unwrap();
    let k0 = entry(&w, IRON).producer.k0;
    assert_eq!(k0, 10 * UNIT_BP);
    for m in 1..=12 {
        month(&mut w);
        let p = &entry(&w, IRON).producer;
        assert_eq!(p.k, k0, "头一年不调整产能（第 {m} 月）");
        assert_eq!(p.learned(), m == 12, "第 {m} 月");
    }
    let p = &entry(&w, IRON).producer;
    assert!((1..=12).all(|m| p.reference(m) > 0));
    // 没有季节的世界里，各月的参照价都在开局价附近
    let open = 45 * UNIT_BP;
    assert!((1..=12).all(|m| (p.reference(m) - open).abs() < open / 10), "{:?}", p.refs);
    // 香料的日消耗大于产量，价格高于基准价；没有产出的市场没有生产者
    assert!(entry(&w, SPICE).producer.k0 > 0);
    let empty =
        w.state.locations.iter().flat_map(|l| l.market.values()).filter(|e| e.supply == 0).all(|e| e.producer.k0 == 0);
    assert!(empty);
}

#[test]
fn crops_follow_their_plan_only_at_season_start() {
    let defs = defs_with(|d| d.goods[IRON.idx()].crop = true);
    let mut w = World::new(defs, ScenarioId(0), 4).unwrap();
    for _ in 0..13 {
        month(&mut w);
    }
    let k0 = entry(&w, IRON).producer.k0;
    producer_mut(&mut w, IRON).k = k0 / 2;
    producer_mut(&mut w, IRON).next = k0 / 2;
    let mut changes = 0;
    let mut last = entry(&w, IRON).producer.k;
    for _ in 0..(360 * 2) {
        let day = w.day();
        w.end_day().unwrap();
        let p = &entry(&w, IRON).producer;
        if p.k != last {
            assert_eq!(day % 90, 0, "作物的产能只在季初变化（第 {day} 天）");
            changes += 1;
            last = p.k;
        }
    }
    assert!(changes >= 4, "两年里季初调整了 {changes} 次");
    assert!(last > k0 / 2, "缺货时扩产");
}

#[test]
fn capacity_stays_within_its_bounds() {
    let defs = defs_with(|d| {
        d.rules.producers.min_ratio = Fx::from_pct(80);
        d.rules.producers.max_ratio = Fx::from_pct(120);
    });
    let mut w = World::new(defs, ScenarioId(0), 8).unwrap();
    for _ in 0..13 {
        month(&mut w);
    }
    let k0 = entry(&w, IRON).producer.k0;
    // 远低于下限的冲击：第一个月末就被拉回界内，此后一直在界内
    producer_mut(&mut w, IRON).k = k0 / 10;
    month(&mut w);
    for _ in 0..48 {
        month(&mut w);
        let k = entry(&w, IRON).producer.k;
        assert!(k >= k0 * 8 / 10 && k <= k0 * 12 / 10, "{k}");
    }
}

#[test]
fn fractional_remainders_remove_rounding_dead_zones() {
    // 香料改成日产 1 件、产量系数 1.4（一年四季一样），生产者关掉，只看余数累计
    let run = |fractional: bool| {
        let defs = defs_with(|d| {
            d.rules.producers.enabled = false;
            d.rules.producers.fractional = fractional;
            d.goods[SPICE.idx()].season_supply = [Fx::from_pct(140); 4];
            let m: &mut MarketDef = d.locations[LOC.idx()].market.iter_mut().find(|m| m.good == SPICE).unwrap();
            m.supply = 1;
        });
        let mut w = World::new(defs, ScenarioId(0), 9).unwrap();
        let mut produced = 0;
        for _ in 0..360 {
            w.end_day().unwrap();
            produced += entry(&w, SPICE).flow.produced;
        }
        produced
    };
    // 应有的一年产出：1.4 × 360 = 504 件
    let exact = 14 * 360 / 10;
    let with = run(true);
    let without = run(false);
    assert!((with - exact).abs() * 50 < exact, "余数累计：一年产出 {with}，应约为 {exact}（误差 2% 以内）");
    assert!(without * 10 < exact * 9, "逐日取整：一年产出 {without}，比应有的少一截");
}

#[test]
fn an_old_save_starts_its_learning_year_when_producers_are_turned_on() {
    let off = defs_with(|d| {
        d.rules.producers.enabled = false;
        d.rules.producers.fractional = false;
    });
    let mut w = World::new(off, ScenarioId(0), 12).unwrap();
    for _ in 0..100 {
        w.end_day().unwrap();
    }
    assert!(!serde_json::to_string(&w.state).unwrap().contains("\"producer\""), "开关关着时存档里没有生产者");
    let mut w = World::from_snapshot(defs_with(|_| {}), w.state.clone()).unwrap();
    w.end_day().unwrap();
    let p = &entry(&w, IRON).producer;
    assert_eq!((p.k0, p.k), (10 * UNIT_BP, 10 * UNIT_BP));
    assert!(!p.learned());
    for _ in 0..13 {
        month(&mut w);
    }
    assert!(entry(&w, IRON).producer.learned());
    check_invariants(&w).unwrap();
}

#[test]
fn producers_are_saved_and_replayed() {
    let defs = defs_with(|_| {});
    let mut w = World::new(defs.clone(), ScenarioId(0), 13).unwrap();
    for _ in 0..500 {
        w.end_day().unwrap();
    }
    assert!(entry(&w, IRON).producer.learned());
    let start = StartParams::new(ScenarioId(0), 13);
    let text = SaveFile::new(&defs, start.clone(), w.state.clone(), Vec::new()).to_json().unwrap();
    assert_eq!(SaveFile::from_json(&text).unwrap().snapshot, w.state);
    assert_eq!(replay(defs, start, &[], w.day()).unwrap().state_hash(), w.state_hash());
}
