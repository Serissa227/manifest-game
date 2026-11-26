//! 第八批 E6：信息时效（docs/ECONOMY.md 第 7 节）在真实数据上的检查。
//! - 金标准：实时模式（经典，旧存档与没有选择时）下，种子 42 跑 365 天、全部市场每日的价格与库存以及第 365 天的完整状态
//!   都和 E5 的版本相同（两个摘要在加入 E6 之前的提交 f073102 上算出）。
//! - 随船传递：消息随船传到各港的告示板，商会记着各地的快照；存档往返与重放一致。

mod common;

use manifest_core::info::{InfoMode, InfoSource};
use manifest_core::*;
use manifest_sim::GameSession;
use std::sync::Arc;

fn fnv(h: &mut u64, bytes: &[u8]) {
    for b in bytes {
        *h ^= *b as u64;
        *h = h.wrapping_mul(0x0100_0000_01b3);
    }
}

/// 全部市场每日收盘后的价格与库存的摘要，以及最后一天完整状态（JSON）的摘要（FNV-1a 64 位）。
fn digests(w: &mut World, days: u32) -> (u64, u64) {
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

/// 加入信息时效之前（E5，提交 f073102）的代码在真实数据上算出的两个摘要。
const E5_DIGEST: u64 = 0x82e7_0513_2cbf_7a04;
const E5_STATE: u64 = 0x9fab_a38a_f6f2_a6a3;

/// 之后各期（E7 规则触发的势力政策、E8 货币流通、开放市场）关掉的真实数据。
fn without_later_phases() -> Arc<StaticData> {
    let mut d = (*common::defs()).clone();
    d.rules.policies.enabled = false;
    d.rules.money.enabled = false;
    d.rules.open_market.enabled = false;
    Arc::new(d)
}

#[test]
fn with_live_market_news_the_world_matches_e5_day_by_day() {
    let mut w = World::new(without_later_phases(), ScenarioId(0), 42).unwrap();
    assert_eq!(w.info_mode(), InfoMode::Live);
    assert_eq!(digests(&mut w, 365), (E5_DIGEST, E5_STATE));
}

fn carried(seed: u64) -> GameSession {
    let mut s = GameSession::new(common::defs(), ScenarioId(0), seed).unwrap();
    s.choose_info(InfoMode::Carried).unwrap();
    s
}

#[test]
fn news_travels_by_ship_and_companies_keep_their_own_books() {
    let mut s = carried(7);
    let defs: Arc<StaticData> = s.world.defs.clone();
    let markets: Vec<LocId> = defs.loc_ids().filter(|l| !s.world.state.locations[l.idx()].market.is_empty()).collect();
    for _ in 0..120 {
        s.advance_day().unwrap();
    }
    let w = &s.world;
    let today = w.day();
    // 商会记着每个有市场的地点（开局时第 0 天的快照，之后自己的船队带回来的更新）
    for c in defs.company_ids() {
        let known = &w.state.info.known[&OwnerId::Company(c)];
        assert_eq!(known.len(), markets.len(), "{} 记着各地的行情", defs.companies[c.idx()].key);
        assert!(known.values().any(|k| k.day > 60), "自己的船队带回了新的行情");
        assert!(known.values().all(|k| k.day <= today && k.source == InfoSource::Visit));
    }
    // 各港的告示板上贴着随船带来的消息：都是出发那天的快照，不是本港的，也不过期
    let boards: Vec<(LocId, &info::Snapshot)> =
        defs.loc_ids().flat_map(|l| w.state.locations[l.idx()].board.values().map(move |s| (l, s))).collect();
    assert!(boards.len() > 20, "告示板上的消息 {}", boards.len());
    for (l, snap) in &boards {
        assert_ne!(snap.loc, *l);
        assert!(snap.day <= today && snap.day + defs.rules.info.board_days >= today);
        assert!(!snap.goods.is_empty());
    }
    // 在海上的舰队带着出发港的消息
    assert!(w.state.fleets.values().any(|f| f.news.is_some()));
    assert!(w.money_conserved());
}

#[test]
fn carried_news_survives_a_save_and_replay() {
    use manifest_core::save::SaveFile;
    let mut s = carried(13);
    for _ in 0..200 {
        s.advance_day().unwrap();
    }
    let w = &s.world;
    let json = serde_json::to_string(&w.state).unwrap();
    assert!(json.contains("\"carried\"") && json.contains("\"board\"") && json.contains("\"news\""));
    let start = manifest_core::replay::StartParams::new(ScenarioId(0), 13);
    let text = SaveFile::new(&w.defs, start, w.state.clone(), Vec::new()).to_json().unwrap();
    assert_eq!(SaveFile::from_json(&text).unwrap().snapshot, w.state);
    assert_eq!(s.replay().unwrap().state_hash(), s.world.state_hash());
}
