//! G01 的开局近程货线观测：真实导航、各开局原配船与船员、现货税费及补给工资。
//! 只量不调；输出是同一开局价格快照的估计，不把途中天气、海盗损失或未来价格当作已知。

use manifest_core::ids::{FleetId, GoodId, LocId, OwnerId, ScenarioId, ShipTypeId};
use manifest_core::market::{Side, provisions_quote, quote};
use manifest_core::world::{Fleet, FleetLocation};
use manifest_core::{StaticData, World};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::Path;

fn loc_id(defs: &StaticData, key: &str) -> LocId {
    LocId::from_idx(defs.locations.iter().position(|loc| loc.key == key).expect("开局/草稿地点存在"))
}

fn travel_days(world: &World, fleet: &Fleet, from: LocId, to: LocId) -> Option<i64> {
    if from == to {
        return Some(0);
    }
    let mut fleet = fleet.clone();
    fleet.location = FleetLocation::Docked(from);
    world.estimate_days(&fleet, to)
}

#[test]
fn opening_routes_use_real_navigation_and_account_for_costs() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let data = std::env::var_os("G01_DATA_DIR").map(std::path::PathBuf::from).unwrap_or_else(|| root.join("data"));
    let defs = manifest_data::load_world(&data, "terra16").expect("寰宇严格加载");
    let catalog: toml::Value =
        toml::from_str(&std::fs::read_to_string(data.join("worlds/terra16/scenarios/openings.toml")).unwrap()).unwrap();
    let goods: Vec<Value> =
        serde_json::from_slice(&std::fs::read(root.join("docs/drafts/goods-expansion.json")).unwrap()).unwrap();
    let scenario = ScenarioId::from_idx(defs.scenarios.iter().position(|s| s.key == "free_1557").unwrap());
    let world = World::new(defs.clone(), scenario, 42).unwrap();
    let listed: usize = defs.locations.iter().map(|loc| loc.market.len()).sum();
    let total: usize = world.state.locations.iter().map(|loc| loc.market.len()).sum();
    println!("市场条目：清单 {listed}，含开放市场 {total}；货物 {}；哈希 {}", defs.goods.len(), defs.meta.hash);
    let mut openings = Vec::new();
    let mut sailing_cache = BTreeMap::new();
    for opening in catalog["opening_catalog"].as_array().unwrap().iter().filter(|o| o["kind"].as_str() != Some("free"))
    {
        let voyage = &opening["voyage"];
        let start = loc_id(&defs, voyage["start_loc"].as_str().unwrap());
        let cash = voyage["cash"].as_integer().unwrap();
        let fleet = Fleet {
            id: FleetId(0),
            owner: OwnerId::Player,
            ships: voyage["ships"]
                .as_array()
                .unwrap()
                .iter()
                .map(|key| {
                    let index = defs.ships.iter().position(|s| Some(s.key.as_str()) == key.as_str()).unwrap();
                    manifest_core::fleet::new_ship(&defs, ShipTypeId::from_idx(index))
                })
                .collect(),
            crew: voyage["crew"].as_integer().unwrap(),
            morale: 100,
            food: voyage["food"].as_integer().unwrap(),
            water: voyage["water"].as_integer().unwrap(),
            supply_remainder: Default::default(),
            cargo: BTreeMap::new(),
            location: FleetLocation::Docked(start),
            days_at_sea: 0,
            idle_days: 0,
            plan: None,
            news: None,
        };
        let mut days_cache = BTreeMap::new();
        let profile: Vec<_> = fleet.ships.iter().map(|ship| ship.kind).collect();
        let mut days = |from, to| {
            *days_cache.entry((from, to)).or_insert_with(|| {
                *sailing_cache
                    .entry((profile.clone(), fleet.crew, from, to))
                    .or_insert_with(|| travel_days(&world, &fleet, from, to))
            })
        };
        let mut candidates = Vec::new();
        for row in &goods {
            let key = row["key"].as_str().unwrap();
            let Some(index) = defs.goods.iter().position(|g| g.key == key) else { continue };
            let good = GoodId::from_idx(index);
            // 产地和按开放市场规则实际出售的进口港都纳入买入候选，不漏掉近程转口。
            let sellers = defs.port_ids().filter(|&loc| manifest_core::open_market::sells(&defs, loc, good));
            for seller in sellers {
                if world.export_banned(seller, good) {
                    continue;
                }
                let Some(approach) = days(start, seller).filter(|d| *d < 10) else { continue };
                // 开放市场哪里都收，遍历全部真实港口，不把草稿的清单销地误当成交易限制。
                for consumer in defs.port_ids() {
                    if seller == consumer {
                        continue;
                    }
                    let Some(loaded) = days(seller, consumer) else { continue };
                    let sailing = approach + loaded;
                    if sailing > 10 {
                        continue;
                    }
                    // 整趟带安全余量，粮食取真实补给报价；水与工资按 voyage 规则。
                    let daily = manifest_core::fleet::daily_supply_need(&defs, fleet.crew);
                    let buffer = manifest_core::fleet::supply_margin(2, sailing);
                    let supplies = daily * (sailing + buffer);
                    let food_cost = provisions_quote(&world, start, supplies).0;
                    let water_cost = supplies * defs.rules.water_price;
                    let wages = sailing * fleet.crew * defs.rules.crew_wage;
                    let overhead = food_cost + water_cost + wages;
                    // 开局已带的粮水占舱；只为不足部分另付现金。净利仍按整趟补给重置成本
                    // 扣除，避免把免费初始补给当作经营收益；余量也计成本，口径偏保守。
                    let extra_food = (supplies - fleet.food).max(0);
                    let extra_water = (supplies - fleet.water).max(0);
                    let cash_overhead =
                        provisions_quote(&world, start, extra_food).0 + extra_water * defs.rules.water_price + wages;
                    let food_loaded = fleet.food.max(supplies);
                    let water_loaded = fleet.water.max(supplies);
                    // 开局货物先占舱；不凭空丢弃，也不把卖旧货的收入作为新线利润。
                    let existing: i64 =
                        voyage["cargo"].as_array().unwrap().iter().map(|r| r["qty"].as_integer().unwrap()).sum();
                    if food_loaded + water_loaded + existing > fleet.capacity() {
                        continue;
                    }
                    // 接近买入港时已经消耗的补给腾出舱位；不凭空丢掉原有多余粮水。
                    let cap = (fleet.capacity() - food_loaded - water_loaded + daily * approach * 2 - existing).max(0);
                    let stock = world.market(seller, good).map_or(0, |market| market.stock);
                    let mut best: Option<Value> = None;
                    for qty in 1..=cap.min(stock) {
                        let Ok(buy) = quote(&world, OwnerId::Player, seller, good, Side::Buy, qty) else { continue };
                        if buy.total + cash_overhead > cash {
                            break;
                        }
                        let Ok(sell) = quote(&world, OwnerId::Player, consumer, good, Side::Sell, qty) else {
                            continue;
                        };
                        let profit = sell.total - buy.total - overhead;
                        if best.as_ref().is_none_or(|b| profit > b["profit"].as_i64().unwrap()) {
                            best = Some(json!({
                                "good": key, "good_name": defs.good(good).name,
                                "from": defs.loc(seller).key, "from_name": defs.loc(seller).name,
                                "to": defs.loc(consumer).key, "to_name": defs.loc(consumer).name,
                                "approach_days": approach, "loaded_days": loaded, "days": sailing,
                                "qty": qty, "buy_with_tax": buy.total, "sell_after_tax": sell.total,
                                "food": food_cost, "water": water_cost, "wages": wages,
                                "cash_needed": buy.total + cash_overhead,
                                "initial_food": fleet.food, "initial_water": fleet.water,
                                "profit": profit,
                                "return_bp": manifest_core::Fx::ratio(profit, buy.total + overhead).raw(),
                            }));
                        }
                    }
                    if let Some(best) = best {
                        candidates.push(best);
                    }
                }
            }
        }
        candidates.sort_by_key(|route| std::cmp::Reverse(route["profit"].as_i64().unwrap()));
        candidates.truncate(2);
        println!("{} {}", opening["name"].as_str().unwrap(), serde_json::to_string(&candidates).unwrap());
        openings.push(json!({
            "key": opening["key"].as_str().unwrap(), "name": opening["name"].as_str().unwrap(),
            "start": defs.loc(start).key, "start_name": defs.loc(start).name,
            "cash": cash, "crew": fleet.crew, "routes": candidates,
        }));
    }
    assert_eq!(openings.len(), 21);
    assert!(openings.iter().flat_map(|o| o["routes"].as_array().unwrap()).all(|r| r["days"].as_i64().unwrap() <= 10));
    if let Ok(dir) = std::env::var("G01_REPORT_DIR") {
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            Path::new(&dir).join("routes.json"),
            serde_json::to_vec_pretty(&json!({
                "data_hash": defs.meta.hash, "goods": defs.goods.len(), "listed_markets": listed,
                "all_markets": total, "day": world.day(),
                "sale_origins": "all_sellable_ports", "openings": openings,
            }))
            .unwrap(),
        )
        .unwrap();
    }
}
