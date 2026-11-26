//! 第八批 E3：本地生产者与供给响应（docs/ECONOMY.md 6.3）在真实数据上的检查。
//! - 金标准：两个开关（供给响应、余数累计）都关、之后各期（E4 起）的开关也都关时，种子 42 跑 365 天、全部市场每日的价格与库存
//!   和 E3 之前的版本逐日相同（摘要 `E2_DIGEST` 在加入生产者之前的代码上算出）。
//! - 打开时：生产者只在有产出的市场建立，产能始终夹在开局产能的上下限之内；作物的产能只在季初变化；
//!   存档往返不丢生产者；只用命令日志重放一致。

mod common;

use manifest_core::*;
use std::sync::Arc;

/// 全部市场每日收盘后的价格与库存的摘要（FNV-1a 64 位；按地点、商品的顺序）。
fn digest(defs: Arc<StaticData>, seed: u64, days: u32) -> u64 {
    let mut w = World::new(defs, ScenarioId(0), seed).unwrap();
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut mix = |bytes: &[u8]| {
        for b in bytes {
            h ^= *b as u64;
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    };
    for _ in 0..days {
        w.end_day().unwrap();
        for ls in &w.state.locations {
            for (g, e) in &ls.market {
                mix(&g.0.to_le_bytes());
                mix(&e.price.to_le_bytes());
                mix(&e.stock.to_le_bytes());
            }
        }
    }
    h
}

/// 加入本地生产者之前（E2，提交 ad15054）的代码在真实数据上算出的摘要。
const E2_DIGEST: u64 = 0xa444_9537_3bd4_18c7;

fn with_producers(enabled: bool, fractional: bool) -> Arc<StaticData> {
    let mut d = (*common::defs()).clone();
    d.rules.producers.enabled = enabled;
    d.rules.producers.fractional = fractional;
    Arc::new(d)
}

/// E3 之前的规则：生产者的两个开关与之后各期（E4 的人口、工坊、口粮、交付进市场；E5 的本地商人、商会 2.0）的开关都关。
fn before_e3() -> Arc<StaticData> {
    let mut d = (*with_producers(false, false)).clone();
    d.rules.population.enabled = false;
    d.rules.workshops.enabled = false;
    d.rules.provisions.local = false;
    d.rules.contracts.deliver_to_market = false;
    d.rules.merchants.enabled = false;
    d.rules.npc.v2.enabled = false;
    // E7：规则触发的势力政策；E8：货币流通；开放市场
    d.rules.policies.enabled = false;
    d.rules.money.enabled = false;
    d.rules.open_market.enabled = false;
    Arc::new(d)
}

#[test]
fn with_both_switches_off_prices_match_the_old_version_day_by_day() {
    assert_eq!(digest(before_e3(), 42, 365), E2_DIGEST);
    // 关掉时存档里没有生产者的字段（状态与旧版相同）
    let w = World::new(before_e3(), ScenarioId(0), 42).unwrap();
    let json = serde_json::to_string(&w.state).unwrap();
    assert!(!json.contains("\"producer\""));
}

#[test]
fn real_data_turns_both_switches_on_and_they_change_the_market() {
    let defs = common::defs();
    assert!(defs.rules.producers.enabled && defs.rules.producers.fractional);
    assert_ne!(digest(defs, 42, 120), digest(with_producers(false, false), 42, 120));
}

#[test]
fn producers_stay_within_bounds_and_crops_change_only_at_season_start() {
    let defs = common::defs();
    let r = defs.rules.producers.clone();
    let growth = defs.rules.population.growth;
    let mut w = World::new(defs.clone(), ScenarioId(0), 7).unwrap();
    // 作物的产能（上一天的）
    let mut crop_k: std::collections::BTreeMap<(usize, GoodId), i64> = Default::default();
    for _ in 0..(360 * 3) {
        let day = w.day();
        w.end_day().unwrap();
        for (li, ls) in w.state.locations.iter().enumerate() {
            for (g, e) in &ls.market {
                let p = &e.producer;
                if e.supply <= 0 {
                    assert_eq!(p.k0, 0, "没有产出的市场没有生产者");
                    continue;
                }
                // 城镇工坊（E4）接手的份额不归本地生产者
                let share = if defs.rules.workshops.enabled { defs.locations[li].workshop_share(*g) } else { Fx::ZERO };
                assert_eq!(p.k0, (Fx::ONE - share).apply(e.supply * market::UNIT_BP));
                // 产能上限随人口伸缩（E4；按月末调整产能时的人口，人口在其后才增减，最多差一个月的增幅）
                let cap = ls.people.ratio().max(Fx::ONE);
                let hi = (Fx::ONE + growth).mul(r.max_ratio).mul(cap).apply(p.k0) + 1;
                assert!(p.k >= r.min_ratio.apply(p.k0).max(1) && p.k <= hi, "产能夹在界内");
                if defs.good(*g).crop {
                    let prev = crop_k.insert((li, *g), p.k);
                    if let Some(prev) = prev
                        && prev != p.k
                    {
                        assert_eq!(day % 90, 0, "作物的产能只在季初变化（第 {day} 天）");
                    }
                }
            }
        }
    }
    // 三年里确实有产能动过（真实数据有商会贸易与季节）
    let moved =
        w.state.locations.iter().flat_map(|l| l.market.values()).filter(|e| e.producer.k != e.producer.k0).count();
    assert!(moved > 20, "动过的产能 {moved} 处");
}

#[test]
fn producers_survive_a_save_and_replay() {
    use manifest_core::replay::{StartParams, replay};
    use manifest_core::save::SaveFile;
    let defs = common::defs();
    let mut w = World::new(defs.clone(), ScenarioId(0), 11).unwrap();
    for _ in 0..200 {
        w.end_day().unwrap();
    }
    let start = StartParams::new(ScenarioId(0), 11);
    let text = SaveFile::new(&defs, start.clone(), w.state.clone(), Vec::new()).to_json().unwrap();
    let back = SaveFile::from_json(&text).unwrap();
    assert_eq!(back.snapshot, w.state);
    assert_eq!(replay(defs, start, &[], w.day()).unwrap().state_hash(), w.state_hash());
}
