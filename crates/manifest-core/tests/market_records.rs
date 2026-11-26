//! 行情记录（ECONOMY.md 第 4.2 节）：日线、月线与当日流量。这些记录只供界面分析，不影响任何结算。

use manifest_core::market::{Side, quote};
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::*;

fn new_world(seed: u64) -> World {
    World::new(tiny_defs(), ScenarioId(0), seed).expect("开局")
}

fn player_fleet(w: &World) -> FleetId {
    w.fleets_of(OwnerId::Player).next().expect("玩家有舰队").id
}

#[test]
fn daily_flow_explains_the_stock_change_of_each_day() {
    let mut w = new_world(21);
    let fleet = player_fleet(&w);
    let (loc, good) = (LocId(0), GoodId(0));
    for day in 0..120u32 {
        let start = w.market(loc, good).unwrap().stock;
        // 每隔几天玩家买一点、卖一点：成交记在当天的玩家流量里
        let mut bought = 0;
        let mut sold = 0;
        if day % 7 == 3 {
            let q = quote(&w, OwnerId::Player, loc, good, Side::Buy, 20).unwrap();
            Command::Buy { owner: OwnerId::Player, fleet, good, qty: 20, max_total: Some(q.total) }
                .apply(&mut w)
                .unwrap();
            bought = 20;
        }
        if day % 7 == 5 {
            Command::Sell { owner: OwnerId::Player, fleet, good, qty: 20, min_total: None }.apply(&mut w).unwrap();
            sold = 20;
        }
        w.end_day().unwrap();
        let e = w.market(loc, good).unwrap();
        let f = &e.flow;
        assert_eq!(f.day, day, "结算之后读到的是刚结束的那一天");
        assert_eq!((f.player_bought, f.player_sold), (bought, sold), "第 {day} 天的玩家成交");
        // 收盘库存 = 开盘库存 − 玩家净买入 + 产出 − 消耗
        assert_eq!(f.stock_close, start - bought + sold + f.produced - f.consumed, "第 {day} 天的收盘库存");
        // 收盘之后只有商会与其他参与者的成交
        assert_eq!(
            e.stock,
            f.stock_close - (f.npc_bought - f.npc_sold) - (f.other_bought - f.other_sold),
            "第 {day} 天的日终库存"
        );
        // 收盘价就是当天记进日线的价格，需求系数的分量与合成一致
        assert_eq!(e.history.back().copied(), Some(e.history[e.history.len() - 1]));
        let season = w.defs.good(good).season_demand[calendar::season_of(day).index()];
        assert_eq!(f.season_demand, season);
        let mut expect = season.mul(f.event_demand);
        if f.popular {
            expect = expect.mul(Fx::ONE + w.defs.rules.popular_bonus);
        }
        assert_eq!(f.demand_mult, expect, "第 {day} 天的需求系数");
        assert!(f.target_close > 0);
        check_invariants(&w).unwrap();
    }
}

#[test]
fn npc_trades_are_recorded_as_company_flow() {
    let mut w = new_world(11);
    let mut npc = 0;
    for _ in 0..360 {
        w.end_day().unwrap();
        npc += w
            .state
            .locations
            .iter()
            .flat_map(|l| l.market.values())
            .map(|e| e.flow.npc_bought + e.flow.npc_sold)
            .sum::<i64>();
    }
    assert!(npc > 0, "一年里商会应当有成交记进流量");
}

#[test]
fn daily_history_keeps_the_configured_days_and_monthly_is_the_month_average() {
    let mut w = new_world(7);
    let keep = w.defs.rules.price_history_days;
    let months = w.defs.rules.price_history_months;
    let (loc, good) = (LocId(1), GoodId(0));
    for day in 0..(30 * 40u32) {
        w.end_day().unwrap();
        let e = w.market(loc, good).unwrap();
        assert!(e.history.len() <= keep);
        if calendar::is_month_end(day) {
            // 月线的最后一个值 = 最近 30 天收盘价的平均（四舍五入）
            let n = e.history.len().min(30);
            let sum: i64 = e.history.iter().rev().take(n).sum();
            assert_eq!(e.monthly.last().copied(), Some(fixed::mul_div(sum, 1, n as i64)), "第 {day} 天月末");
        }
    }
    let e = w.market(loc, good).unwrap();
    assert_eq!(e.history.len(), keep);
    assert_eq!(e.monthly.len(), months.min(40));
}

#[test]
fn records_survive_save_and_do_not_change_what_happens() {
    // 记录进入存档，读档后接着跑与不存档一路跑下去的状态哈希一致
    let mut a = new_world(5);
    for _ in 0..100 {
        a.end_day().unwrap();
    }
    let snap = a.state.clone();
    let mut b = World::from_snapshot(a.defs.clone(), snap).unwrap();
    for _ in 0..50 {
        a.end_day().unwrap();
        b.end_day().unwrap();
    }
    assert_eq!(a.state_hash(), b.state_hash());
    // 旧存档里的市场条目没有月线与流量：按默认值读入
    let mut json = serde_json::to_value(&a.state).unwrap();
    for l in json["locations"].as_array_mut().unwrap() {
        for (_, e) in l["market"].as_object_mut().unwrap() {
            let e = e.as_object_mut().unwrap();
            e.remove("monthly");
            e.remove("flow");
        }
    }
    let old: WorldState = serde_json::from_value(json).unwrap();
    let w = World::from_snapshot(a.defs.clone(), old).unwrap();
    assert!(w.state.locations.iter().flat_map(|l| l.market.values()).all(|e| e.monthly.is_empty() && e.flow.day == 0));
}
