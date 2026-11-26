//! 开放市场在真实数据上的检查：
//! - 打开时每个港口与内陆城市对 72 种商品都有市场条目；清单以外的是只收不卖的进口条目；
//! - 出售清单以特产为主、从不为空（至少 `sell_min_goods` 种），维拉马雷只卖它的 13 种特产；
//! - 每种商品至少有一处出售，做礼物的几种货、殖民地的建立物资与建材都买得到（新大陆的殖民港出售建材与口粮）；
//! - 离产地越远，只收不卖的条目越贵（同一种商品按贸易距离单调）；
//! - 买清单里不出售的货被拒、卖得掉；商会一年里只买当地出售的货，也往只收不卖的条目里卖货；
//! - 开放市场之前的存档读进来补上条目，此后货币照样守恒；
//! - 关掉开关时与旧版逐日相同由各期的金标准测试检查（producers、population、commerce、info、policy、circulation 的 `before_*` 一律关掉开放市场）。

mod common;

use manifest_core::market::{Side, normal_price, quote};
use manifest_core::open_market::{extra_markets, nearest_producers, sale_list, sells};
use manifest_core::save::SaveFile;
use manifest_core::*;
use std::sync::Arc;

fn markets(defs: &StaticData) -> Vec<LocId> {
    defs.loc_ids().filter(|l| !defs.loc(*l).market.is_empty()).collect()
}

fn good(defs: &StaticData, key: &str) -> GoodId {
    defs.find_good(key).unwrap_or_else(|| panic!("商品 {key}"))
}

#[test]
fn real_data_opens_the_markets_and_every_market_buys_every_good() {
    let defs = common::defs();
    let r = &defs.rules.open_market;
    assert!(r.enabled && r.sell_min_goods >= 5);
    let w = World::new(defs.clone(), ScenarioId(0), 1).unwrap();
    let locs = markets(&defs);
    assert_eq!(locs.len(), 40);
    let mut extras = 0;
    for &l in &locs {
        let ls = &w.state.locations[l.idx()];
        assert_eq!(ls.market.len(), defs.goods.len(), "{} 每种商品都有条目", defs.loc(l).key);
        for (g, e) in &ls.market {
            assert_eq!(e.extra, defs.loc(l).listed(*g).is_none());
            if e.extra {
                extras += 1;
                assert!(!e.specialty && e.supply < e.demand && e.supply * 10 >= e.demand * 3, "{e:?}");
                assert!(!sells(&defs, l, *g), "只收不卖");
            }
        }
    }
    assert_eq!(extras, 40 * 72 - 918, "清单以外的 1962 条");
    // 殖民点没有市场
    for s in defs.site_ids() {
        assert!(w.state.locations[s.idx()].market.is_empty());
    }
}

#[test]
fn sale_lists_are_mostly_specialties_and_never_empty() {
    let defs = common::defs();
    let r = &defs.rules.open_market;
    let (mut sold, mut specialties) = (0usize, 0usize);
    for l in markets(&defs) {
        let ld = defs.loc(l);
        let list = sale_list(&defs, l);
        assert!(list.len() >= r.sell_min_goods, "{} 出售 {} 种", ld.key, list.len());
        for m in ld.market.iter().filter(|m| m.specialty) {
            assert!(list.contains(&m.good), "{} 的特产 {} 在售", ld.key, defs.good(m.good).key);
        }
        for g in defs.good_ids() {
            assert_eq!(sells(&defs, l, g), list.contains(&g));
        }
        sold += list.len();
        specialties += ld.market.iter().filter(|m| m.specialty).count();
    }
    // 特产占出售清单的八成以上（其余是补足的几种、殖民港的建材与口粮、没有产地的金锭）
    assert!(specialties * 100 >= sold * 80, "特产 {specialties} / 出售 {sold}");
    // 开局港维拉马雷：只卖它的 13 种特产
    let vm = defs.find_loc("chenggang").unwrap();
    let list = sale_list(&defs, vm);
    assert_eq!(list.len(), 13);
    assert!(list.iter().all(|g| defs.loc(vm).listed(*g).is_some_and(|m| m.specialty)));
}

#[test]
fn every_good_is_sold_somewhere_and_special_goods_stay_obtainable() {
    let defs = common::defs();
    let locs = markets(&defs);
    let sold_at = |g: GoodId| locs.iter().filter(|l| sells(&defs, **l, g)).count();
    for g in defs.good_ids() {
        assert!(sold_at(g) >= 1, "{} 至少有一处出售", defs.good(g).key);
    }
    // 没有任何地方以金锭为特产：列出它的地方照旧出售
    assert!(sold_at(good(&defs, "gold_ingot")) >= 3);
    // 这几种做礼物、炼制用得上的货都买得到
    let mut gifts: Vec<GoodId> = Vec::new();
    for key in [
        "salt",
        "sulfur",
        "saltpeter",
        "star_crystal",
        "crystal_lamp",
        "pearl",
        "gems",
        "jewelry",
        "silver_ingot",
        "amber",
        "coral",
        "glass",
    ] {
        gifts.push(good(&defs, key));
    }
    for g in gifts {
        assert!(sold_at(g) >= 1, "礼物 {} 买得到", defs.good(g).key);
    }
    // 殖民地的建立物资（木材、谷物）在很多地方买得到；新大陆开拓者的起始港买得齐建立物资与各建筑的建材
    for (g, _) in &defs.rules.colony.found_materials {
        assert!(sold_at(*g) >= 10, "建立物资 {} 出售的地方 {}", defs.good(*g).key, sold_at(*g));
    }
    let colonist = defs.find_scenario("colonist").unwrap();
    let home = defs.scenarios[colonist.idx()].start;
    let mut needed: Vec<GoodId> = defs.rules.colony.found_materials.iter().map(|(g, _)| *g).collect();
    for b in &defs.colony_buildings {
        needed.extend(b.materials.iter().map(|(g, _)| *g));
    }
    for g in needed {
        assert!(sells(&defs, home, g), "{} 出售殖民地的物资 {}", defs.loc(home).key, defs.good(g).key);
    }
}

#[test]
fn the_farther_from_the_producers_the_higher_the_price() {
    let defs = common::defs();
    let extras = extra_markets(&defs);
    let mut compared = 0;
    for g in defs.good_ids() {
        // 同一种商品的只收不卖条目：（离最近的特产地的距离, 产量, 消耗）
        let mut rows: Vec<(i64, i64, i64, LocId)> = Vec::new();
        for (li, ex) in extras.iter().enumerate() {
            let loc = LocId::from_idx(li);
            let Some(m) = ex.iter().find(|m| m.good == g) else { continue };
            let Some((_, d)) = nearest_producers(&defs, loc)[g.idx()] else { continue };
            rows.push((d.raw(), m.supply, m.demand, loc));
        }
        rows.sort();
        // 消耗一样（按商品取同一个数），产量随距离单调不增
        for w in rows.windows(2) {
            assert_eq!(w[0].2, w[1].2);
            assert!(w[0].1 >= w[1].1, "{}：{:?} 比 {:?} 远却不更贵", defs.good(g).key, w[1], w[0]);
        }
        if let (Some(near), Some(far)) = (rows.first(), rows.last())
            && near.1 > far.1
        {
            compared += 1;
        }
    }
    assert!(compared >= 40, "大多数商品近处与远处的产量不同：{compared}");
    // 例子：谷物在离产地很近的地方与远在瑶华的朝岚港
    let w = World::new(defs.clone(), ScenarioId(0), 1).unwrap();
    let grain = good(&defs, "grain");
    let (near, far) = (defs.find_loc("langjing").unwrap(), defs.find_loc("zhaolan").unwrap());
    let p = |l: LocId| normal_price(&defs, w.market(l, grain).unwrap());
    assert!(w.market(near, grain).unwrap().extra && w.market(far, grain).unwrap().extra);
    assert!(p(near) < p(far), "琅京 {} < 朝岚港 {}", p(near), p(far));
}

#[test]
fn buying_off_the_sale_list_is_refused_and_selling_it_works() {
    let defs = common::defs();
    let w = World::new(defs.clone(), ScenarioId(0), 2).unwrap();
    let vm = defs.find_loc("chenggang").unwrap();
    let p = OwnerId::Player;
    // 香料：维拉马雷清单里的进口货（不出售）；棉花：清单以外（只收不卖）；谷物：特产
    for key in ["spice", "cotton"] {
        let g = good(&defs, key);
        assert_eq!(quote(&w, p, vm, g, Side::Buy, 1).unwrap_err(), CommandError::NotSoldHere, "{key}");
        assert!(quote(&w, p, vm, g, Side::Sell, 5).is_ok(), "{key} 收购");
    }
    assert!(quote(&w, p, vm, good(&defs, "grain"), Side::Buy, 5).is_ok());
}

#[test]
fn companies_only_buy_what_the_port_sells_and_sell_anywhere() {
    // 补给的口粮也从当地市场买（记在商会的买入里，不看出售清单）：这里改按固定价补给，市场里记下的商会买入就全是生意
    let mut d = (*common::defs()).clone();
    d.rules.provisions.local = false;
    let defs = Arc::new(d);
    let mut w = World::new(defs.clone(), ScenarioId(0), 42).unwrap();
    let (mut bought, mut sold_to_extras) = (0i64, 0i64);
    for _ in 0..360 {
        w.end_day().unwrap();
        let day = w.day() - 1;
        for l in markets(&defs) {
            let sale = sale_list(&defs, l);
            for (g, e) in &w.state.locations[l.idx()].market {
                if e.flow.day != day {
                    continue;
                }
                if e.flow.npc_bought > 0 {
                    assert!(
                        !e.extra && sale.contains(g),
                        "第 {day} 天商会在 {} 买了不出售的 {}",
                        defs.loc(l).key,
                        defs.good(*g).key
                    );
                    bought += e.flow.npc_bought;
                }
                if e.extra {
                    sold_to_extras += e.flow.npc_sold;
                }
            }
        }
    }
    assert!(bought > 0);
    assert!(sold_to_extras > 0, "商会也往只收不卖的条目里卖货");
    assert!(w.money_conserved());
}

#[test]
fn a_save_from_before_open_markets_loads_and_stays_consistent() {
    let mut off = (*common::defs()).clone();
    off.rules.open_market.enabled = false;
    let mut old = World::new(Arc::new(off), ScenarioId(0), 9).unwrap();
    for _ in 0..40 {
        old.end_day().unwrap();
    }
    let json = serde_json::to_string(&old.state).unwrap();
    assert!(!json.contains("\"extra\""));
    let start = manifest_core::replay::StartParams::new(ScenarioId(0), 9);
    let text = SaveFile::new(&old.defs, start, old.state.clone(), Vec::new()).to_json().unwrap();
    let loaded = SaveFile::from_json(&text).unwrap();
    let defs = common::defs();
    loaded.check_compatible(&defs).unwrap();
    let mut w = World::from_snapshot(defs.clone(), loaded.snapshot).unwrap();
    for l in markets(&defs) {
        assert_eq!(w.state.locations[l.idx()].market.len(), 72);
    }
    let initial = w.state.money.initial;
    for _ in 0..90 {
        w.end_day().unwrap();
    }
    assert!(w.money_conserved());
    assert_eq!(w.state.money.initial, initial);
}
