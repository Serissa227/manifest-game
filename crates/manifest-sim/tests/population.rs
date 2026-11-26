//! 第八批 E4：人口、繁荣度、需求层级、城镇工坊、补给口粮与委托交付（docs/ECONOMY.md 6.4、6.5）在真实数据上的检查。
//! - 金标准：E4 的开关（人口、工坊、口粮、交付进市场）与之后各期（E5 起）的开关全关时，种子 42 跑 365 天、全部市场每日的
//!   价格与库存以及第 365 天的完整状态都和 E3 的版本相同（两个摘要在加入 E4 之前的提交 fad084a 上算出；数据文件改了，所以不比 state_hash）。
//! - 打开时：港口与城市都有人口，工坊按 `workshops.toml` 建立；十年里人口、繁荣度、工坊产能都在界内；
//!   原料短缺传导到成品；存档往返不丢状态、只用命令日志重放一致。

mod common;

use manifest_core::people::Condition;
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

/// 加入人口与工坊之前（E3，提交 fad084a）的代码在真实数据上算出的两个摘要。
const E3_DIGEST: u64 = 0x0e6d_3ef4_5260_95f0;
const E3_STATE: u64 = 0x1531_99b6_bd2f_9f73;

fn e4_off() -> Arc<StaticData> {
    let mut d = (*common::defs()).clone();
    d.rules.population.enabled = false;
    d.rules.workshops.enabled = false;
    d.rules.provisions.local = false;
    d.rules.contracts.deliver_to_market = false;
    // 之后各期（E5：本地商人、商会 2.0；E7：规则触发的势力政策；E8：货币流通；开放市场）
    d.rules.merchants.enabled = false;
    d.rules.npc.v2.enabled = false;
    d.rules.policies.enabled = false;
    d.rules.money.enabled = false;
    d.rules.open_market.enabled = false;
    Arc::new(d)
}

#[test]
fn with_every_e4_switch_off_the_world_matches_e3_day_by_day() {
    assert_eq!(digests(e4_off(), 42, 365), (E3_DIGEST, E3_STATE));
}

#[test]
fn real_data_turns_everything_on() {
    let defs = common::defs();
    let r = &defs.rules;
    assert!(r.population.enabled && r.workshops.enabled && r.provisions.local && r.contracts.deliver_to_market);
    assert_ne!(digests(defs.clone(), 42, 120).0, digests(e4_off(), 42, 120).0);
    let w = World::new(defs.clone(), ScenarioId(0), 1).unwrap();
    // 有市场的港口与城市都有人口，殖民点没有
    for (i, loc) in defs.locations.iter().enumerate() {
        let has = w.state.locations[i].people.pop0 > 0;
        assert_eq!(has, !loc.is_site() && !loc.market.is_empty(), "{}", loc.key);
    }
    // 每种层级都有商品，每个替代组至少两种
    let tiers = manifest_data::need_counts(&defs.goods);
    assert!(tiers.iter().all(|n| *n >= 5), "{tiers:?}");
    // 工坊：数据里的每一座都在某个港口或城市
    let shops: usize = defs.locations.iter().map(|l| l.workshops.len()).sum();
    assert!(shops >= 20, "城镇工坊 {shops} 座");
    // 投入产出：生产网络能自给（Hawkins–Simon）
    let rho = manifest_data::spectral_radius(&manifest_data::input_coefficients(&defs.recipes, defs.goods.len()));
    assert!(rho < 1.0, "谱半径 {rho}");
}

#[test]
fn ten_years_keep_people_and_workshops_within_their_bounds() {
    let defs = common::defs();
    let r = defs.rules.population.clone();
    let wr = defs.rules.workshops.clone();
    let mut w = World::new(defs.clone(), ScenarioId(0), 7).unwrap();
    let mut conditions = std::collections::BTreeSet::new();
    for day in 0..(360 * 10) {
        w.end_day().unwrap();
        if day % 30 != 29 {
            continue;
        }
        for (i, ls) in w.state.locations.iter().enumerate() {
            let p = &ls.people;
            if p.pop0 > 0 {
                assert!(
                    p.pop >= r.min_ratio.apply(p.pop0) && p.pop <= r.max_ratio.apply(p.pop0),
                    "第 {day} 天 {} 人口",
                    i
                );
                assert!(p.prosperity >= Fx::ZERO && p.prosperity <= Fx::from_int(100));
                conditions.insert(p.condition);
            }
            for ws in ls.workshops.values() {
                // 上限按月末调整产能时的人口（人口在其后才增减，最多差一个月的增幅）
                let hi = (Fx::ONE + r.growth).mul(wr.max_ratio).mul(p.ratio().max(Fx::ONE)).apply(ws.k0) + 1;
                assert!(ws.k >= wr.min_ratio.apply(ws.k0) && ws.k <= hi, "第 {day} 天 工坊产能 {} / {}", ws.k, ws.k0);
            }
        }
    }
    // 工坊都开过工（按数据生成的规则，开工赚钱的地方才设工坊）
    let running = w.state.locations.iter().flat_map(|l| l.workshops.values()).filter(|x| !x.stopped).count();
    let total: usize = defs.locations.iter().map(|l| l.workshops.len()).sum();
    assert!(running * 10 >= total * 8, "十年后在开工的工坊 {running} / {total}");
    assert!(conditions.contains(&Condition::Stable));
}

#[test]
fn a_grape_failure_raises_the_price_of_wine() {
    // 第一个酿酒工坊所在的港口：第 400 天起葡萄颗粒无收，比较葡萄酒的价格
    let defs = common::defs();
    let grapes = defs.find_good("grapes").unwrap();
    let wine = defs.find_good("wine").unwrap();
    let recipe = defs.find_recipe("make_wine").unwrap();
    let loc = defs.loc_ids().find(|l| defs.loc(*l).workshops.iter().any(|w| w.recipe == recipe)).unwrap();
    let run = |cut: bool| {
        let mut w = World::new(defs.clone(), ScenarioId(0), 3).unwrap();
        for day in 0..580 {
            if cut && day >= 400 {
                w.state.locations[loc.idx()].market.get_mut(&grapes).unwrap().event_supply = Fx::ZERO;
            }
            w.end_day().unwrap();
        }
        let ws = w.workshop(loc, recipe).unwrap().clone();
        (w.market(loc, wine).unwrap().price, ws)
    };
    let (normal, _) = run(false);
    let (failed, ws) = run(true);
    assert!(ws.stopped || ws.short, "工坊缺料或停工");
    assert!(failed * 10 > normal * 11, "{}：葡萄酒 {normal} → {failed}", defs.loc(loc).key);
}

#[test]
fn people_and_workshops_survive_a_save_and_replay() {
    use manifest_core::replay::{StartParams, replay};
    use manifest_core::save::SaveFile;
    let defs = common::defs();
    let mut w = World::new(defs.clone(), ScenarioId(0), 11).unwrap();
    for _ in 0..400 {
        w.end_day().unwrap();
    }
    let start = StartParams::new(ScenarioId(0), 11);
    let text = SaveFile::new(&defs, start.clone(), w.state.clone(), Vec::new()).to_json().unwrap();
    let back = SaveFile::from_json(&text).unwrap();
    assert_eq!(back.snapshot, w.state);
    assert_eq!(replay(defs, start, &[], w.day()).unwrap().state_hash(), w.state_hash());
}
