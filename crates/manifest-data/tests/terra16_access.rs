//! 寰宇的商馆、货档与市场深度（T01）在真实数据上的检查（只读静态数据，不跑模拟）：
//! - 寰宇打开 `[access]`、写了深度曲线、发展度衰减放慢；经典世界三样都没有，货物也没有档位（逐字节不变）；
//! - 货档就是公式生成的结果（必需品 0 档，其余按基准价 30 / 80 / 200 分档），与 `tools/econ/terra16_ranks.py` 一致；
//! - 每个有市场的地点，新来的人（商誉 0）至少买得到 3 种货（出售清单本来就不足 3 种的地点：出售几种就买得到几种）；
//! - 深度曲线在发展度 50 处与线性公式相接，寰宇现有港口的系数。
use manifest_core::access::floor_goods;
use manifest_core::defs::{NeedTier, StaticData};
use manifest_core::fixed::Fx;
use manifest_core::market::{depth_factor, development_factor};
use manifest_core::open_market::sale_list;
use manifest_core::{GoodId, LocId};
use std::sync::Arc;

fn world(key: &str) -> Arc<StaticData> {
    manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), key).unwrap()
}

/// 货档的公式：必需品 0 档；其余按基准价 < 30、< 80、< 200 分成 0 / 1 / 2 档，再往上 3 档。
fn formula(defs: &StaticData, g: GoodId) -> u8 {
    let good = defs.good(g);
    if good.need == Some(NeedTier::Essential) {
        return 0;
    }
    [30, 80, 200].iter().filter(|step| good.base_price >= **step).count() as u8
}

#[test]
fn terra16_turns_the_rule_on_and_classic_stays_as_it_was() {
    let terra = world("terra16");
    let r = &terra.rules.access;
    assert!(r.enabled);
    assert_eq!(r.rank_goodwill, vec![0, 10, 30, 60]);
    assert_eq!(r.house_goodwill, vec![0, 10, 25, 45, 70]);
    assert_eq!(r.house_tax, vec![Fx::ONE, Fx::ONE, Fx::from_pct(85), Fx::from_pct(70), Fx::from_pct(50)]);
    assert_eq!(r.house_storage, vec![0, 100, 200, 300, 300]);
    assert_eq!((r.house_base, r.house_step, r.ally_house, r.floor_goods), (5_000, 3, 4, 3));
    assert_eq!((r.trade_rep_base, r.trade_rep_per), (2_000, 10));
    assert_eq!((r.invest_rep_per, r.invest_rep_max, r.company_goodwill, r.grace_days), (20_000, 10, 30, 360));
    assert!(r.problems().is_empty());
    assert_eq!(terra.rules.invest.decay_months, 6);
    assert!(terra.rules.depth_curve.is_some());

    let classic = world("classic");
    assert!(!classic.rules.access.enabled, "经典世界不开商馆与货档");
    assert!(classic.rules.depth_curve.is_none(), "经典世界没有深度曲线");
    assert_eq!(classic.rules.invest.decay_months, 1, "经典世界的发展度照旧每月衰减");
    assert!(classic.goods.iter().all(|g| g.rank == 0), "经典世界的货没有档位");
    for dev in 1..=100 {
        assert_eq!(depth_factor(&classic, dev), development_factor(dev));
    }
}

#[test]
fn ranks_in_the_data_are_exactly_what_the_formula_generates() {
    let defs = world("terra16");
    let mut spread = [0usize; 4];
    for g in defs.good_ids() {
        let good = defs.good(g);
        assert_eq!(
            good.rank,
            formula(&defs, g),
            "{}（{} 金、{:?}）要重跑 terra16_ranks.py",
            good.key,
            good.base_price,
            good.need
        );
        spread[usize::from(good.rank)] += 1;
    }
    println!("货档分布：0–3 档各 {spread:?} 种，共 {} 种", defs.goods.len());
    // G02（2026-11-11）交易品扩充加了 60 种货，货档照同一公式（terra16_ranks.py）生成：
    // [39, 42, 42, 36] → [54, 67, 52, 46]（共 159 → 219 种；BALANCE.md“G02 寰宇交易品扩充”一节已记）。
    // 公式与每种货的档位逐条比对（上面的断言）照旧，这里只是分布随新货更新。
    assert_eq!(spread, [54, 67, 52, 46]);
    // 军需照旧另要许可证：有档位不代替许可证
    assert_eq!(defs.goods.iter().filter(|g| g.license).count(), 10);
}

#[test]
fn a_newcomer_can_buy_at_least_three_goods_in_every_market() {
    let defs = world("terra16");
    let r = &defs.rules.access;
    let mut by_data_short = Vec::new();
    // 出售清单（军需除外）本来就不足 3 种的地点：与货档无关，数据如此
    let mut thin = Vec::new();
    let mut fewest = usize::MAX;
    for (i, l) in defs.locations.iter().enumerate() {
        if l.is_site() || l.market.is_empty() {
            continue;
        }
        let loc = LocId::from_idx(i);
        let on_sale: Vec<GoodId> = sale_list(&defs, loc).into_iter().filter(|g| !defs.good(*g).license).collect();
        let floor = floor_goods(&defs, loc);
        let by_rank = on_sale.iter().filter(|g| defs.good(**g).rank == 0).count();
        let open = on_sale.iter().filter(|g| defs.good(**g).rank == 0 || floor.contains(g)).count();
        assert!(
            open >= r.floor_goods.min(on_sale.len()) && open >= on_sale.len().min(3),
            "{}：新来的人只买得到 {open} 种货（出售 {} 种）",
            l.key,
            on_sale.len()
        );
        if on_sale.len() < 3 {
            thin.push((l.key.clone(), on_sale.len()));
        }
        // 保底只补到 floor_goods 种：0 档的货已经够数的港口不多放
        assert_eq!(floor.len(), r.floor_goods.saturating_sub(by_rank).min(on_sale.len() - by_rank), "{}", l.key);
        if on_sale.len() >= 3 {
            fewest = fewest.min(open);
        }
        if by_rank < 3 && on_sale.len() >= 3 {
            by_data_short.push((l.key.clone(), by_rank, on_sale.len()));
        }
    }
    println!(
        "出售 3 种以上的地点里，新来的人每处至少买得到 {fewest} 种；单看货档，0 档的货不足 3 种的地点 {} 处（靠每港保底补足）：{:?}",
        by_data_short.len(),
        by_data_short
    );
    println!("出售清单（军需除外）不足 3 种的地点 {} 处（全部放开）：{thin:?}", thin.len());
    assert!(fewest >= 3);
    // 港口都出售 3 种以上（开放市场每处至少补足 6 种）；不足 3 种的只有内陆城市
    for (key, _) in &thin {
        let l = defs.locations.iter().find(|l| l.key == *key).unwrap();
        assert!(!l.is_port(), "{key} 是港口，出售清单却不足 3 种");
    }
}

#[test]
fn the_depth_curve_joins_the_linear_formula_at_fifty() {
    let defs = world("terra16");
    assert_eq!(depth_factor(&defs, 50), Fx::ONE);
    let mut seen = std::collections::BTreeMap::new();
    for l in defs.locations.iter().filter(|l| !l.is_site() && !l.market.is_empty()) {
        *seen.entry(l.development).or_insert(0usize) += 1;
    }
    println!("各发展度的地点数：{seen:?}");
    for (dev, _) in seen {
        let (old, new) = (development_factor(dev), depth_factor(&defs, dev));
        if dev > 50 {
            assert!(new > old, "发展度 {dev}：{old} → {new}");
        }
    }
}
