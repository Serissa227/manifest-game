//! 第八批 E7：规则触发的势力政策（docs/ECONOMY.md 6.10）在真实数据上的检查。
//! - 金标准：规则触发关掉时，种子 42 跑 365 天、全部市场每日的价格与库存以及第 365 天的完整状态都和 E6 相同
//!   （两种行情情报模式；摘要在 E6 的提交 3ba5648 上算出。商会展望、市场月报等只在 AI 打开时出现，这里 AI 是关的）。
//! - 打开时：几年里有几次主食禁运或出口税，都记为来源“规则”的组合事件；货币守恒；存读档与重放一致。

mod common;

use manifest_core::composed::ComposedSource;
use manifest_core::defs::EffectKind;
use manifest_core::info::InfoMode;
use manifest_core::*;
use std::sync::Arc;

fn fnv(h: &mut u64, bytes: &[u8]) {
    for b in bytes {
        *h ^= *b as u64;
        *h = h.wrapping_mul(0x0100_0000_01b3);
    }
}

/// 全部市场每日收盘后的价格与库存的摘要，以及最后一天完整状态（JSON）的摘要（FNV-1a 64 位）。
fn digests(defs: Arc<StaticData>, mode: InfoMode, days: u32) -> (u64, u64) {
    let mut w = World::new(defs, ScenarioId(0), 42).unwrap();
    Command::SetInfoMode { owner: OwnerId::Player, mode }.apply(&mut w).unwrap();
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

/// 加入势力政策之前（E6，提交 3ba5648）的代码在真实数据上算出的摘要：实时模式（与 E5 相同）与随船传递。
const E6_LIVE: (u64, u64) = (0x82e7_0513_2cbf_7a04, 0x9fab_a38a_f6f2_a6a3);
const E6_CARRIED: (u64, u64) = (0xe1fc_0678_1ed9_b8e4, 0x7345_ecad_0ff4_3364);

/// 规则触发的开关；之后各期（E8 货币流通、开放市场）一律关掉，只比较 E7 本身。
fn policies(enabled: bool) -> Arc<StaticData> {
    let mut d = (*common::defs()).clone();
    d.rules.policies.enabled = enabled;
    d.rules.money.enabled = false;
    d.rules.open_market.enabled = false;
    Arc::new(d)
}

#[test]
fn with_rule_policies_off_the_world_matches_e6_day_by_day() {
    assert_eq!(digests(policies(false), InfoMode::Live, 365), E6_LIVE);
    assert_eq!(digests(policies(false), InfoMode::Carried, 365), E6_CARRIED);
}

#[test]
fn real_data_brings_a_few_export_bans_and_duties() {
    let defs = common::defs();
    assert!(defs.rules.policies.enabled && !defs.rules.policies.staples.is_empty());
    let mut w = World::new(defs.clone(), ScenarioId(0), 42).unwrap();
    for _ in 0..(360 * 4) {
        w.end_day().unwrap();
    }
    assert!(w.money_conserved());
    let rules: Vec<_> = w.state.events.composed.iter().filter(|r| r.source == ComposedSource::Rule).collect();
    // 四年：禁运只在主食价格比往常高出八成时才有，全海域每年几次；出口税每年一两次
    assert!((5..=60).contains(&rules.len()), "规则触发的政策 {} 条", rules.len());
    for r in &rules {
        assert_eq!(r.effects.len(), 1);
        let e = &r.effects[0];
        assert!(matches!(e.effect, EffectKind::ExportBan | EffectKind::ExportTariff));
        let (f, g) = (e.params.faction_a.unwrap(), e.params.good.unwrap());
        if e.effect == EffectKind::ExportBan {
            assert!(defs.rules.policies.staples.contains(&g), "只禁运主食");
        }
        assert!(defs.loc_ids().any(|l| defs.loc(l).faction == f && w.market(l, g).is_some()));
    }
}

#[test]
fn rule_policies_survive_a_save_and_replay() {
    use manifest_core::replay::{StartParams, replay};
    use manifest_core::save::SaveFile;
    let defs = common::defs();
    let mut w = World::new(defs.clone(), ScenarioId(0), 11).unwrap();
    for _ in 0..(360 * 3) {
        w.end_day().unwrap();
    }
    let start = StartParams::new(ScenarioId(0), 11);
    let text = SaveFile::new(&defs, start.clone(), w.state.clone(), Vec::new()).to_json().unwrap();
    assert_eq!(SaveFile::from_json(&text).unwrap().snapshot, w.state);
    assert_eq!(replay(defs, start, &[], w.day()).unwrap().state_hash(), w.state_hash());
}
