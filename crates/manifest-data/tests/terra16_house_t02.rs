//! 寰宇的商馆回报、风险与目标（T02）在真实数据上的检查：
//! - 寰宇打开 `[dividends]`、`[shipyard_growth]`、`[npc_invest]`，内陆城市另用一组货档门槛；经典世界四样都没有；
//! - 船型按基准价分档的分布；寰宇每一种非独有的船型，都至少在某个港口、某个发展度下买得到；
//!   发展度没到第一个台阶时，每座船厂的清单就是数据里的清单；
//! - 内陆城市里声望 40 能买第 3 档的货，可投资的港口仍要 60。
use manifest_core::defs::StaticData;
use manifest_core::house::{shipyard_at, shipyard_upcoming};
use manifest_core::ids::ScenarioId;
use manifest_core::open_market::sale_list;
use manifest_core::{LocId, OwnerId, ShipTypeId, World};
use std::collections::BTreeSet;
use std::sync::Arc;

fn world(key: &str) -> Arc<StaticData> {
    manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), key).unwrap()
}

#[test]
fn terra16_turns_the_t02_rules_on_and_classic_stays_as_it_was() {
    let terra = world("terra16");
    let r = &terra.rules;
    assert!(r.dividends.enabled && r.shipyard_growth.enabled && r.npc_invest.enabled);
    assert_eq!((r.dividends.annual_pct, r.dividends.hinterland_pct), (6, 10));
    assert_eq!((r.dividends.sack_loss_pct, r.dividends.sack_loss_pct_house, r.dividends.sack_house_level), (50, 25, 3));
    assert_eq!(r.shipyard_growth.price_tiers, vec![8_000, 15_000, 30_000, 50_000]);
    assert!(r.shipyard_growth.lines.iter().all(|l| l.ids.len() == l.ships.len()), "船系里的船型都解析得到");
    assert_eq!((r.npc_invest.share_pct, r.npc_invest.reserve_months, r.npc_invest.home_pct), (5, 6, 60));
    assert_eq!(r.access.rank_goodwill, vec![0, 10, 30, 60], "港口的门槛不变");
    assert_eq!(r.access.inland_goodwill, Some(vec![0, 10, 25, 40]));
    assert!(
        r.dividends.problems().is_empty()
            && r.shipyard_growth.problems().is_empty()
            && r.npc_invest.problems().is_empty()
    );
    assert!(r.access.problems().is_empty());
    assert!(r.money.enabled, "分红从城镇钱袋出：寰宇有货币流通");

    let classic = world("classic");
    let c = &classic.rules;
    assert!(!c.dividends.enabled && !c.shipyard_growth.enabled && !c.npc_invest.enabled, "经典世界不开 T02 的规则");
    assert_eq!(c.access.inland_goodwill, None);
    for i in 0..classic.locations.len() {
        let loc = LocId::from_idx(i);
        assert_eq!(shipyard_at(&classic, loc, 100), classic.loc(loc).shipyard, "经典的船厂清单不随发展度变");
        assert!(shipyard_upcoming(&classic, loc).is_empty());
    }
}

#[test]
fn ship_tiers_follow_the_price_formula() {
    let defs = world("terra16");
    let r = &defs.rules.shipyard_growth;
    let mut spread = vec![0usize; r.price_tiers.len() + 1];
    for s in defs.ships.iter().filter(|s| !s.unique) {
        let tier = r.tier(s.price);
        assert_eq!(tier, r.price_tiers.iter().filter(|t| s.price >= **t).count());
        spread[tier] += 1;
    }
    println!("船型分档（非独有）：{spread:?}");
    assert_eq!(spread, vec![6, 9, 10, 6, 4]);
    // 每一种非独有船型都在某个船系里，且只在一个船系里
    for (i, s) in defs.ships.iter().enumerate().filter(|(_, s)| !s.unique) {
        let n = r.lines.iter().filter(|l| l.ids.contains(&ShipTypeId::from_idx(i))).count();
        assert_eq!(n, 1, "{} 应在一个船系里", s.key);
    }
}

#[test]
fn every_non_unique_ship_is_buildable_somewhere_at_some_development() {
    let defs = world("terra16");
    let mut base: BTreeSet<ShipTypeId> = BTreeSet::new();
    let mut grown: BTreeSet<ShipTypeId> = BTreeSet::new();
    for (i, l) in defs.locations.iter().enumerate() {
        if !l.is_port() {
            continue;
        }
        let loc = LocId::from_idx(i);
        base.extend(l.shipyard.iter().copied());
        // 没到第一个台阶：就是数据里的清单
        assert_eq!(shipyard_at(&defs, loc, 64), l.shipyard, "{}", l.key);
        // 台阶越高，清单只多不少，基础清单在最前
        let at65 = shipyard_at(&defs, loc, 65);
        let at80 = shipyard_at(&defs, loc, 80);
        assert!(at65.starts_with(&l.shipyard) && at80.starts_with(&at65), "{}", l.key);
        assert!(at80.iter().all(|s| !defs.ship(*s).unique), "{} 不卖独有船型", l.key);
        grown.extend(at80.iter().copied());
    }
    let unlocked: Vec<&str> = grown.difference(&base).map(|s| defs.ship(*s).key.as_str()).collect();
    println!("原来没有船厂出售、随发展度开造的船型 {} 种：{unlocked:?}", unlocked.len());
}

#[test]
fn inland_cities_sell_top_rank_goods_at_forty_reputation_while_ports_keep_sixty() {
    let defs = world("terra16");
    let w = World::new(defs.clone(), ScenarioId(0), 7).unwrap();
    let top = (defs.rules.access.rank_goodwill.len() - 1) as u8;
    let pick = |port: bool| {
        defs.locations.iter().enumerate().find_map(|(i, l)| {
            let loc = LocId::from_idx(i);
            if l.is_port() != port || l.is_site() || l.market.is_empty() || !w.location_open(loc) {
                return None;
            }
            let floor = manifest_core::access::floor_goods(&defs, loc);
            sale_list(&defs, loc)
                .into_iter()
                .find(|g| defs.good(*g).rank == top && !defs.good(*g).license && !floor.contains(g))
                .map(|g| (loc, g))
        })
    };
    let (city, city_good) = pick(false).expect("寰宇有出售珍货的内陆城市");
    let (port, port_good) = pick(true).expect("寰宇有出售珍货的港口");
    let mut w = w;
    let p = OwnerId::Player;
    // 不在本据势力、不在宽限期：只看商誉（玩家没有商馆，商誉就是声望）
    for (loc, rep, need) in [(city, 40, None), (city, 39, Some(40)), (port, 40, Some(60)), (port, 60, None)] {
        let f = w.location_faction(loc);
        w.state.agents.get_mut(&p).unwrap().reputation.insert(f, rep);
        let good = if loc == city { city_good } else { port_good };
        assert_eq!(w.rank_gate(p, loc, good).map(|g| g.need), need, "{} 声望 {rep}", defs.loc(loc).key);
    }
}
