//! 第八批 E8：货币流通（docs/ECONOMY.md 6.9）在真实数据上的检查。
//! - 金标准：货币流通关掉时，种子 42 跑 365 天、全部市场每日的价格与库存以及第 365 天的完整状态都和 E7 相同
//!   （两种行情情报模式；摘要在 E7 的提交 02b2aec 上算出）。
//! - 打开时：四年里全部账户之和每天都等于开局的总额；每份经济月报里各类部门“月初 + 流入 − 流出 = 月末”；
//!   各种资金流都有对手部门（分红与维护费流回城镇、税进国库、腹地收入与漏出）；流动性系数大多在 0.9–1.1 之间；
//!   存读档与重放一致；旧存档读进来时开账户，此后照样守恒。

mod common;

use manifest_core::circulation::SectorKind;
use manifest_core::info::InfoMode;
use manifest_core::replay::{StartParams, replay};
use manifest_core::save::SaveFile;
use manifest_core::treasury::Flow;
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

/// 加入货币流通之前（E7，提交 02b2aec）的代码在真实数据上算出的摘要：实时模式与随船传递。
const E7_LIVE: (u64, u64) = (0x8bc6_4095_ded0_088d, 0x315f_4980_bb14_5c1e);
const E7_CARRIED: (u64, u64) = (0x37b7_0bf8_2a8c_a370, 0xeea9_3d9a_434d_3269);

/// 货币流通的开关；之后各期（开放市场）一律关掉，只比较 E8 本身。
fn money(enabled: bool) -> Arc<StaticData> {
    let mut d = (*common::defs()).clone();
    d.rules.money.enabled = enabled;
    d.rules.open_market.enabled = false;
    Arc::new(d)
}

#[test]
fn with_money_circulation_off_the_world_matches_e7_day_by_day() {
    assert_eq!(digests(money(false), InfoMode::Live, 365), E7_LIVE);
    assert_eq!(digests(money(false), InfoMode::Carried, 365), E7_CARRIED);
}

#[test]
fn over_four_years_every_account_adds_up_every_day() {
    four_years(false);
    four_years(true);
}

fn four_years(items: bool) {
    let mut defs = (*common::defs()).clone();
    // 原场景原样再跑一遍；扩展场景给玩家足够四年工资与每日一枚的消费本金。
    if items {
        defs.scenarios[0].cash += 100_000;
        defs.items = serde_json::from_value(serde_json::json!({"items":[{
            "key":"test_gift","name":"测试礼物","kind":"gift","rarity":1,"price":2,
            "shop":{"cultures":[],"min_size":1,"weight":1}
        }]}))
        .unwrap();
        defs.rules.items.stock = 1_000;
        for loc in &mut defs.locations {
            loc.shop = loc.is_port();
        }
    }
    let defs = Arc::new(defs);
    assert!(defs.rules.money.enabled);
    let mut w = World::new(defs.clone(), ScenarioId(0), 42).unwrap();
    let initial = w.state.circulation.initial;
    assert_eq!(w.all_money(), initial);
    let mut spread = Vec::new();
    for d in 0..(360 * 4) {
        if items {
            let owner = OwnerId::Player;
            let loc = w.fleets_of(owner).find_map(|f| f.docked_at()).expect("玩家在本据港");
            Command::BuyItem { owner, loc, item: "test_gift".into(), qty: 1, max_total: Some(2) }
                .apply(&mut w)
                .unwrap();
            Command::SellItem { owner, loc, item: "test_gift".into(), qty: 1, min_total: Some(1) }
                .apply(&mut w)
                .unwrap();
            assert_eq!(w.item_quantity(owner, "test_gift"), 0);
        }
        manifest_core::testkit::check_invariants(&w).unwrap();
        w.end_day().unwrap();
        assert!(w.money_conserved(), "第 {d} 天全部账户之和变了");
        if d % 90 == 89 {
            spread.extend(w.state.circulation.towns.values().map(|p| p.liquidity));
        }
    }
    let c = &w.state.circulation;
    // 经济月报：各类部门自己对得上账，加起来就是开局的总额
    assert_eq!(c.reports.len(), 24);
    for r in &c.reports {
        for s in &r.sectors {
            assert_eq!(s.opening + s.inflow - s.outflow, s.closing, "第 {} 月 {:?}", r.month, s.kind);
        }
        assert_eq!(r.sectors.iter().map(|s| s.closing).sum::<Money>(), initial);
        assert_eq!(
            r.money_supply,
            initial - r.sectors.iter().find(|s| s.kind == SectorKind::Hinterland).unwrap().closing
        );
        assert!(r.production > 0 && r.population > 0 && r.price_index > Fx::ZERO);
        assert_eq!(r.treasuries.len(), defs.factions.len());
    }
    // 各种资金流都有对手部门
    let has = |flow: Flow, from: SectorKind, to: SectorKind| {
        c.reports.iter().flat_map(|r| r.flows.iter()).any(|l| l.flow == flow && l.from == from && l.to == to)
    };
    assert!(has(Flow::Market, SectorKind::Traders, SectorKind::Towns));
    assert!(has(Flow::Market, SectorKind::Towns, SectorKind::Traders));
    assert!(has(Flow::Tax, SectorKind::Towns, SectorKind::Treasuries));
    assert!(has(Flow::Wages, SectorKind::Traders, SectorKind::Towns));
    assert!(has(Flow::Dividend, SectorKind::Traders, SectorKind::Towns), "分红流回本据港");
    assert!(has(Flow::Overhead, SectorKind::Traders, SectorKind::Towns), "维护费");
    assert!(has(Flow::HinterlandIncome, SectorKind::Hinterland, SectorKind::Towns));
    assert!(has(Flow::Leak, SectorKind::Towns, SectorKind::Hinterland));
    assert!(has(Flow::Navy, SectorKind::Treasuries, SectorKind::Towns));
    assert!(has(Flow::PublicWorks, SectorKind::Treasuries, SectorKind::Towns));
    // 流动性系数：大多在 0.9–1.1 之间，全部在上下限之内
    let r = &defs.rules.money;
    assert!(spread.iter().all(|l| *l >= r.liquidity_floor && *l <= r.liquidity_cap));
    let near = spread.iter().filter(|l| **l >= Fx::from_pct(90) && **l <= Fx::from_pct(110)).count();
    assert!(near * 100 >= spread.len() * 85, "0.9–1.1 之间 {near} / {}", spread.len());
    // 国库的税率系数在上下限之内；商会都还在
    assert!(c.treasuries.values().all(|t| t.tax_mult >= r.tax_min && t.tax_mult <= r.tax_max));
    assert!(w.state.agents.values().all(|a| !a.bankrupt));
}

#[test]
fn circulation_survives_a_save_and_replay() {
    let defs = common::defs();
    let mut w = World::new(defs.clone(), ScenarioId(0), 11).unwrap();
    for _ in 0..(360 * 2 + 45) {
        w.end_day().unwrap();
    }
    let start = StartParams::new(ScenarioId(0), 11);
    let text = SaveFile::new(&defs, start.clone(), w.state.clone(), Vec::new()).to_json().unwrap();
    let loaded = SaveFile::from_json(&text).unwrap().snapshot;
    assert_eq!(loaded, w.state);
    let mut again = World::from_snapshot(defs.clone(), loaded).unwrap();
    assert_eq!(replay(defs, start, &[], w.day()).unwrap().state_hash(), w.state_hash());
    for _ in 0..60 {
        w.end_day().unwrap();
        again.end_day().unwrap();
    }
    assert_eq!(again.state_hash(), w.state_hash());
    assert!(again.money_conserved());
}

#[test]
fn an_old_save_opens_its_accounts_when_loaded() {
    // E7 的存档：没有货币流通的账户
    let old = {
        let mut w = World::new(money(false), ScenarioId(0), 5).unwrap();
        for _ in 0..200 {
            w.end_day().unwrap();
        }
        assert!(!serde_json::to_string(&w.state).unwrap().contains("\"circulation\""));
        w.state
    };
    let mut w = World::from_snapshot(common::defs(), old).unwrap();
    assert!(w.circulation_on());
    let c = &w.state.circulation;
    assert!(!c.towns.is_empty() && c.towns.values().all(|p| p.money == p.reference));
    assert_eq!(w.all_money(), c.initial);
    for _ in 0..120 {
        w.end_day().unwrap();
        assert!(w.money_conserved());
    }
    assert!(!w.state.circulation.reports.is_empty());
}
