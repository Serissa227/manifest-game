//! 第八批 E5：本地商人（docs/ECONOMY.md 6.6）与商会 2.0（6.7）在真实数据上的检查。
//! - 金标准：E5 的两个开关（本地商人、商会 2.0）都关时，种子 42 跑 365 天、全部市场每日的价格与库存以及第 365 天的完整状态
//!   都和 E4 的版本相同（两个摘要在加入 E5 之前的提交 1e4f9ea 上算出）。
//! - 打开时：每个市场都有本地商人；商会的现金不再无限堆积（年末分红），舰队在上限之内，买了本国的许可证，
//!   老船换新，卖货时核对预测；存档往返与重放一致。

mod common;

use manifest_core::*;
use std::sync::Arc;

fn fnv(h: &mut u64, bytes: &[u8]) {
    for b in bytes {
        *h ^= *b as u64;
        *h = h.wrapping_mul(0x0100_0000_01b3);
    }
}

/// 全部市场每日收盘后的价格与库存的摘要，以及最后一天完整状态（JSON）的摘要（FNV-1a 64 位）。
fn digests(defs: Arc<StaticData>, seed: u64, days: u32) -> (u64, u64) {
    let mut w = World::new(defs, ScenarioId(0), seed).unwrap();
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for _ in 0..days {
        w.end_day().unwrap();
        for ls in &w.state.locations {
            for (g, e) in &ls.market {
                fnv(&mut h, &g.0.to_le_bytes());
                fnv(&mut h, &e.price.to_le_bytes());
                fnv(&mut h, &e.stock.to_le_bytes());
            }
        }
    }
    let mut s: u64 = 0xcbf2_9ce4_8422_2325;
    fnv(&mut s, serde_json::to_string(&w.state).unwrap().as_bytes());
    (h, s)
}

/// 加入本地商人与商会 2.0 之前（E4，提交 1e4f9ea）的代码在真实数据上算出的两个摘要。
const E4_DIGEST: u64 = 0x7d7b_fdae_eefe_4f25;
const E4_STATE: u64 = 0xe48a_4253_aeb9_c6f1;

/// E5 的两个开关；之后各期（E7 规则触发的势力政策、E8 货币流通、开放市场）一律关掉，只比较 E5 本身。
fn with(merchants: bool, v2: bool) -> Arc<StaticData> {
    let mut d = (*common::defs()).clone();
    d.rules.merchants.enabled = merchants;
    d.rules.npc.v2.enabled = v2;
    d.rules.policies.enabled = false;
    d.rules.money.enabled = false;
    d.rules.open_market.enabled = false;
    Arc::new(d)
}

#[test]
fn with_both_e5_switches_off_the_world_matches_e4_day_by_day() {
    assert_eq!(digests(with(false, false), 42, 365), (E4_DIGEST, E4_STATE));
}

#[test]
fn real_data_turns_merchants_and_companies_two_on() {
    let defs = common::defs();
    assert!(defs.rules.merchants.enabled && defs.rules.npc.v2.enabled);
    assert_ne!(digests(defs.clone(), 42, 120).0, digests(with(false, false), 42, 120).0);
    let mut w = World::new(defs, ScenarioId(0), 3).unwrap();
    for _ in 0..30 {
        w.end_day().unwrap();
    }
    // 每个市场（地点清单里的条目）都有本地商人，四派占比之和为 1，存货在上限之内；
    // 开放市场补上的只收不卖的条目没有本地商人（需求变更，见 DECISIONS“开放市场”）
    let r = w.defs.rules.merchants.clone();
    for e in w.state.locations.iter().flat_map(|l| l.market.values()) {
        let m = &e.merchants;
        if e.extra {
            assert!(m.is_unset());
            continue;
        }
        assert!(!m.is_unset());
        assert_eq!(m.shares.iter().fold(Fx::ZERO, |s, x| s + *x), Fx::ONE);
        assert!(m.hoard >= 0 && m.hoard <= r.hoard_max.apply(e.target) + 1);
    }
}

/// 各商会第 `year` 年末的现金。
fn company_cash(w: &World) -> Vec<Money> {
    w.defs.company_ids().map(|c| w.agent(OwnerId::Company(c)).map(|a| a.cash).unwrap_or(0)).collect()
}

#[test]
fn companies_stop_hoarding_cash_and_keep_their_fleets_fresh() {
    let run = |v2: bool| {
        let mut w = World::new(with(true, v2), ScenarioId(0), 42).unwrap();
        let mut at10 = Vec::new();
        for day in 0..(360 * 25) {
            w.end_day().unwrap();
            if day == 360 * 10 - 1 {
                at10 = company_cash(&w);
            }
        }
        (w, at10)
    };
    let (old, old10) = run(false);
    let (new, new10) = run(true);
    let (old25, new25) = (company_cash(&old), company_cash(&new));
    // 旧版：现金一路堆积（25 年比 10 年多一半以上）；商会 2.0：分红之后大致持平，远低于旧版
    let sum = |v: &Vec<Money>| v.iter().sum::<Money>();
    assert!(sum(&old25) * 10 > sum(&old10) * 15, "旧版 10 年 {} → 25 年 {}", sum(&old10), sum(&old25));
    assert!(sum(&new25) * 10 < sum(&new10) * 15, "商会 2.0：10 年 {} → 25 年 {}", sum(&new10), sum(&new25));
    assert!(sum(&new25) * 2 < sum(&old25), "商会 2.0 的现金 {} 远低于旧版 {}", sum(&new25), sum(&old25));
    let dividends = new.state.money.sinks.get(&treasury::Flow::Dividend).copied().unwrap_or(0);
    assert!(dividends > sum(&new25), "年末分红派出了 {dividends}");
    let defs = new.defs.clone();
    let limit = defs.rules.npc.v2.retire_years * 360;
    for cid in defs.company_ids() {
        let owner = OwnerId::Company(cid);
        let a = new.agent(owner).unwrap();
        // 舰队不超过上限的上限（上限随净资产伸缩；分红之后净资产下降，已有的舰队不卖）；买了本国的许可证；卖货时核对了预测
        let fleets = new.fleets_of(owner).count();
        assert!(fleets <= defs.rules.npc.v2.max_fleets_cap, "舰队 {fleets}");
        assert!(fleets > defs.rules.npc.max_fleets, "净资产增长之后舰队多于旧版的上限：{fleets}");
        assert!(a.licenses.contains(&defs.loc(a.home).faction), "{} 买了本国的许可证", defs.companies[cid.idx()].key);
        let s = a.strategy.as_ref().unwrap();
        assert!(s.samples > 100 && s.errors.iter().all(|e| *e > 0));
    }
    // 老船换新：第 25 年时，超过船龄上限的船不到三成
    let ships: Vec<_> =
        new.state.fleets.values().filter(|f| f.owner.company().is_some()).flat_map(|f| &f.ships).collect();
    let old_ships = ships.iter().filter(|s| new.day().saturating_sub(s.built) > limit).count();
    assert!(old_ships * 10 < ships.len() * 3, "超龄的船 {old_ships} / {}", ships.len());
    assert!(ships.iter().any(|s| s.built > 360 * 20), "第二十年之后换过新船");
}

#[test]
fn merchants_and_companies_survive_a_save_and_replay() {
    use manifest_core::replay::{StartParams, replay};
    use manifest_core::save::SaveFile;
    let defs = common::defs();
    let mut w = World::new(defs.clone(), ScenarioId(0), 13).unwrap();
    for _ in 0..400 {
        w.end_day().unwrap();
    }
    assert!(w.state.fleets.values().any(|f| f.plan.is_some()));
    let start = StartParams::new(ScenarioId(0), 13);
    let text = SaveFile::new(&defs, start.clone(), w.state.clone(), Vec::new()).to_json().unwrap();
    assert_eq!(SaveFile::from_json(&text).unwrap().snapshot, w.state);
    assert_eq!(replay(defs, start, &[], w.day()).unwrap().state_hash(), w.state_hash());
}
