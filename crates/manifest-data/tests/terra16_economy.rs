//! 寰宇经济的均衡检查（几秒钟，不跑模拟）：由数据直接算每个市场条目的均衡价（库存 / 目标库存 = 产量 / 消耗时的价格），
//! 看价格是否随地理与稀缺自然起伏——特产地便宜、离产地越远越贵、没有条目卡在价格上下限、同一种货各地的价差有界。
//! 2026-11-02 经济重做（空间价格均衡）：原来的模板“出口 12/4、进口 0/12”让各地价格非 0.36 倍即 5 倍。
use manifest_core::defs::StaticData;
use manifest_core::fixed::Fx;
use manifest_core::market::{new_entry, normal_price};
use std::collections::BTreeMap;

fn terra() -> std::sync::Arc<StaticData> {
    manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()
}

/// 均衡价 / 基准价（万分比）：直接取价格曲线在“产量 / 消耗”处的值（不经过整数金币取整，便宜货的比值不失真）
fn ratio_bp(defs: &StaticData, m: &manifest_core::defs::MarketDef) -> i64 {
    defs.rules.price_curve.eval(Fx::ratio(m.supply.max(0), m.demand.max(1))).0
}

/// 均衡价（整数金币，夹过上下限）：不卡在上下限
fn clamped(defs: &StaticData, m: &manifest_core::defs::MarketDef) -> bool {
    let e = new_entry(defs, m);
    let p = normal_price(defs, &e);
    p > defs.rules.price_floor.apply(e.base_price).max(1) && p < defs.rules.price_cap.apply(e.base_price)
}

/// 秘境港口（亚特兰蒂斯外港、珀耳塞福涅诸岛）的市场另有设计，不在这里检查
fn realm(key: &str) -> bool {
    key == "atlantis_port" || key.starts_with("persephone_isle")
}

#[test]
fn listed_markets_sit_between_the_price_limits_by_geography() {
    let defs = terra();
    assert!(defs.rules.open_market.enabled && defs.rules.open_market.listed_import_inflow);
    let (floor, cap) = (defs.rules.price_floor, defs.rules.price_cap);
    let (lo, hi) = (floor.apply(10_000), cap.apply(10_000));
    let mut exports = Vec::new();
    let mut imports = Vec::new();
    let mut per_good: BTreeMap<_, (i64, i64)> = BTreeMap::new();
    for l in defs.locations.iter().filter(|l| !l.is_site() && !realm(&l.key)) {
        for m in &l.market {
            let r = ratio_bp(&defs, m);
            assert!(
                r > lo && r < hi && clamped(&defs, m),
                "{} {:?}：均衡价 {r} 卡在上下限（{lo}–{hi}）",
                l.key,
                m.good
            );
            if m.specialty {
                exports.push(r)
            } else {
                imports.push(r)
            }
            let slot = per_good.entry(m.good).or_insert((i64::MAX, 0));
            *slot = (slot.0.min(r), slot.1.max(r));
        }
    }
    exports.sort_unstable();
    imports.sort_unstable();
    let pct = |v: &[i64], p: usize| v[(v.len() - 1) * p / 100];
    println!(
        "出口均衡价：{} 条，最低 {} / 中位 {} / 最高 {}；进口：{} 条，最低 {} / 中位 {} / 最高 {}（万分比）",
        exports.len(),
        pct(&exports, 0),
        pct(&exports, 50),
        pct(&exports, 100),
        imports.len(),
        pct(&imports, 0),
        pct(&imports, 50),
        pct(&imports, 100)
    );
    // 特产地便宜但不白送：约 0.4–0.75 倍基准价
    assert!(pct(&exports, 0) >= 4_000 && pct(&exports, 100) <= 7_500, "出口均衡价 {exports:?}");
    // 进口按离产地的远近：近处约 1.1 倍起，远在海外不超过约 2.6 倍
    assert!(
        pct(&imports, 0) >= 10_000 && pct(&imports, 100) <= 26_000,
        "进口均衡价分布 {}–{}",
        pct(&imports, 0),
        pct(&imports, 100)
    );
    // 同一种货各地均衡价之比有界（产地最便宜处 → 最远处）：不超过 6.5 倍
    for (good, (min, max)) in per_good {
        assert!(max <= min * 65 / 10, "{good:?}：各地均衡价 {min}–{max} 相差超过 6.5 倍");
    }
}

#[test]
fn open_market_extra_entries_follow_the_same_distance_curve() {
    let defs = terra();
    let extras = manifest_core::open_market::extra_markets(&defs);
    let mut n = 0;
    for (l, extra) in defs.locations.iter().zip(&extras) {
        if realm(&l.key) {
            continue;
        }
        for m in extra {
            let r = ratio_bp(&defs, m);
            assert!((10_000..=26_000).contains(&r), "{} {:?}：只收不卖的进口条目均衡价 {r}", l.key, m.good);
            n += 1;
        }
    }
    assert!(n > 1_000);
    let listed: usize = defs.locations.iter().map(|loc| loc.market.len()).sum();
    let total = listed + extras.iter().map(Vec::len).sum::<usize>();
    println!("市场规模：{} 商品，清单 {listed}，含开放市场 {total}，数据哈希 {}", defs.goods.len(), defs.meta.hash);
    if let Ok(dir) = std::env::var("G01_REPORT_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            std::path::Path::new(&dir).join("market-counts.json"),
            serde_json::to_vec_pretty(&serde_json::json!({
                "data_hash": defs.meta.hash, "goods": defs.goods.len(),
                "listed_markets": listed, "all_markets": total,
            }))
            .unwrap(),
        )
        .unwrap();
    }
}

#[test]
fn classic_does_not_switch_on_the_listed_import_inflow() {
    let classic = manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "classic").unwrap();
    assert!(!classic.rules.open_market.listed_import_inflow, "经典世界不补清单进口条目的背景到货（逐字节不变）");
}

#[test]
fn workshops_can_restart_at_real_trade_distance_equilibrium() {
    let defs = terra();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let draft: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("docs/drafts/goods-existing-fixes.json")).unwrap()).unwrap();
    let mut able = 0;
    let mut report = Vec::new();
    for (loc, workshop) in defs.locations.iter().flat_map(|loc| loc.workshops.iter().map(move |w| (loc, w))) {
        let recipe = &defs.recipes[workshop.recipe.idx()];
        // load_world 已用四季实际航线与陆路最短距离补进口。复工检查取本工坊停工时的
        // 均衡：扣掉它接手的产出份额（market::household_supply 的同一规则），投入不消耗。
        // 库存/目标同乘 UNIT_BP 保留半件等产能余数，不先取整便宜原料的金币价格。
        let output_market = loc.market.iter().find(|m| m.good == workshop.output).unwrap();
        let price = |good, utilization: Fx| {
            let market = loc.market.iter().find(|m| m.good == good).expect("工坊投入产出必须在当地交易");
            let mut entry = new_entry(&defs, market);
            entry.stock *= manifest_core::market::UNIT_BP;
            entry.target *= manifest_core::market::UNIT_BP;
            if good == workshop.output {
                entry.stock = (Fx::ONE - workshop.share.mul(Fx::ONE - utilization)).apply(entry.stock);
            }
            if let Some((_, qty)) = workshop.inputs.iter().find(|(input, _)| *input == good) {
                let daily =
                    utilization.apply(workshop.share.apply(output_market.supply * manifest_core::market::UNIT_BP));
                let consumed = daily * qty / workshop.out_qty;
                entry.stock = (entry.stock - consumed * defs.rules.target_stock_days).max(0);
            }
            manifest_core::market::shadow_price_bp(&defs, &entry, Fx::ONE)
        };
        let cost: i64 = workshop.inputs.iter().map(|(good, qty)| price(*good, Fx::ZERO) * qty).sum();
        let revenue = price(workshop.output, Fx::ZERO) * workshop.out_qty;
        let full_cost: i64 = workshop.inputs.iter().map(|(good, qty)| price(*good, Fx::ONE) * qty).sum();
        let full_revenue = price(workshop.output, Fx::ONE) * workshop.out_qty;
        assert!(cost > 0 && revenue > 0, "{} {}", loc.key, recipe.key);
        let can_restart = i128::from(revenue) * i128::from(Fx::SCALE)
            >= i128::from(cost) * i128::from(defs.rules.workshops.restart_above.raw());
        let full_runs = i128::from(full_revenue) * i128::from(Fx::SCALE)
            >= i128::from(full_cost) * i128::from(defs.rules.workshops.restart_above.raw());
        let status = if full_runs {
            "常开"
        } else if can_restart {
            "间歇"
        } else {
            "待喂"
        };
        able += usize::from(can_restart);
        let estimate = draft["workshops"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["loc"].as_str() == Some(&loc.key) && row["recipe"].as_str() == Some(&recipe.key));
        let expected_status = estimate.map(|row| row["after"]["status"].as_str().unwrap());
        let changed = expected_status.is_some_and(|expected| expected != status);
        println!(
            "工坊 {} {}：成本/产值 {}，产值/成本 {}，{}{}",
            loc.key,
            recipe.key,
            Fx::ratio(cost, revenue),
            Fx::ratio(revenue, cost),
            status,
            if changed { "（与草稿分类不同）" } else { "" }
        );
        report.push(serde_json::json!({
            "loc": loc.key, "location": loc.name, "recipe": recipe.key,
            "input_cost_bp": cost, "output_value_bp": revenue,
            "cost_to_value_bp": Fx::ratio(cost, revenue).raw(),
            "value_to_cost_bp": Fx::ratio(revenue, cost).raw(),
            "can_restart": can_restart, "status": status,
            "full_value_to_cost_bp": Fx::ratio(full_revenue, full_cost).raw(),
            "draft_status": expected_status, "changed": changed,
            "inputs": workshop.inputs.iter().map(|(good, qty)| {
                let market = loc.market.iter().find(|m| m.good == *good).unwrap();
                serde_json::json!({"good": defs.good(*good).key, "qty": qty, "supply": market.supply,
                    "demand": market.demand, "price_bp": price(*good, Fx::ZERO), "specialty": market.specialty})
            }).collect::<Vec<_>>(),
        }));
    }
    println!("真实贸易距离下可开工 {able}/{}", report.len());
    if let Ok(dir) = std::env::var("G01_REPORT_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(std::path::Path::new(&dir).join("workshops.json"), serde_json::to_vec_pretty(&report).unwrap())
            .unwrap();
    }
    assert_eq!(report.len(), 98);
    // G01 2026-11-03 实测 64/98；E01 不能把更多工坊调回停工。
    assert!(able >= 64, "真实距离均衡下仅 {able} 座能复工，低于 G01 的64座");
}
