//! 剧本的开局货物与粮水（小型世界，不读文件）：
//! 货物装进开局舰队的货舱，按商品基准价记入存货、同额计入实收资本；粮水装船但不入账；
//! 账本、存货簿、货币守恒等不变量从第 0 天起成立，开局货物可以照常卖出与转入仓库；
//! 没有开局货物与粮水的剧本开局状态与账本不受影响；货舱装不下时按顺序装到满为止。

use manifest_core::ledger::Account;
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::warehouse::Holder;
use manifest_core::*;
use std::sync::Arc;

const P: OwnerId = OwnerId::Player;
/// 小型世界的商品：0 谷物（基准价 12）、3 铁（基准价 45）。
const GRAIN: GoodId = GoodId(0);
const IRON: GoodId = GoodId(3);

fn defs_with(cargo: Vec<(GoodId, i64)>, food: i64, water: i64) -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    let s = &mut d.scenarios[0];
    s.cargo = cargo;
    s.food = food;
    s.water = water;
    Arc::new(d)
}

fn player_fleet(w: &World) -> manifest_core::world::Fleet {
    w.fleets_of(P).next().expect("玩家有舰队").clone()
}

#[test]
fn opening_cargo_is_booked_as_contributed_inventory() {
    let defs = defs_with(vec![(GRAIN, 40), (IRON, 10)], 20, 25);
    let plain = World::new(tiny_defs(), ScenarioId(0), 5).unwrap();
    let mut w = World::new(defs.clone(), ScenarioId(0), 5).unwrap();
    check_invariants(&w).unwrap();

    // 货舱：货物与粮水都在，并占用舱位
    let f = player_fleet(&w);
    assert_eq!(f.cargo.get(&GRAIN).copied(), Some(40));
    assert_eq!(f.cargo.get(&IRON).copied(), Some(10));
    assert_eq!((f.food, f.water), (20, 25));
    assert_eq!(f.used(), 40 + 10 + 20 + 25);

    // 账本：借存货、贷实收资本，金额 = 基准价 × 数量；现金与货币总量不变
    let value = 40 * defs.good(GRAIN).base_price + 10 * defs.good(IRON).base_price;
    let a = w.agent(P).unwrap();
    let a0 = plain.agent(P).unwrap();
    assert_eq!(a.ledger.balance(Account::Inventory), value);
    assert_eq!(a.book.qty(GRAIN), 40);
    assert_eq!(a.book.avg_cost(GRAIN), defs.good(GRAIN).base_price);
    assert_eq!(a.book.qty(IRON), 10);
    assert_eq!(a.ledger.balance(Account::Capital), a0.ledger.balance(Account::Capital) - value);
    assert_eq!(a.cash, a0.cash);
    assert_eq!(w.state.money.initial, plain.state.money.initial);
    assert_eq!(w.total_assets(P), plain.total_assets(P) + value);
    // 粮水不作为资产入账，也不是费用
    assert_eq!(a.ledger.balance(Account::Supplies), 0);

    // 开局货物可以照常卖出、转入仓库；之后每天不变量成立
    let fid = f.id;
    let at = f.docked_at().unwrap();
    let sold = Command::Sell { owner: P, fleet: fid, good: GRAIN, qty: 15, min_total: None }.apply(&mut w);
    assert!(sold.is_ok(), "{sold:?}");
    check_invariants(&w).unwrap();
    let rent = Command::RentWarehouse { owner: P, loc: at, capacity: 100 }.apply(&mut w);
    assert!(rent.is_ok(), "{rent:?}");
    let moved =
        Command::Transfer { owner: P, from: Holder::Fleet(fid), to: Holder::Warehouse(at), good: IRON, qty: 10 }
            .apply(&mut w);
    assert!(moved.is_ok(), "{moved:?}");
    check_invariants(&w).unwrap();
    for _ in 0..60 {
        w.end_day().unwrap();
        check_invariants(&w).unwrap();
    }
    assert!(w.money_conserved());
}

#[test]
fn scenario_without_opening_cargo_starts_as_before() {
    let w = World::new(tiny_defs(), ScenarioId(0), 7).unwrap();
    check_invariants(&w).unwrap();
    let f = player_fleet(&w);
    assert!(f.cargo.is_empty());
    assert_eq!((f.food, f.water), (0, 0));
    let a = w.agent(P).unwrap();
    assert!(a.book.goods.is_empty());
    assert_eq!(a.ledger.balance(Account::Inventory), 0);
    // 实收资本 = 起始现金 + 开局船只
    let ships: Money = f.ships.iter().map(|s| s.book_value).sum();
    assert_eq!(-a.ledger.balance(Account::Capital), w.defs.scenarios[0].cash + ships);
    // 开局货物确实会改变开局状态（对照：同一种子、只多了开局货物）
    let with = World::new(defs_with(vec![(GRAIN, 5)], 0, 0), ScenarioId(0), 7).unwrap();
    assert_ne!(with.state_hash(), w.state_hash());
}

#[test]
fn opening_cargo_is_clipped_to_the_hold() {
    // 数据校验保证装得下；内核仍按顺序装到满为止，粮水排在货物之后
    let defs = defs_with(vec![(GRAIN, 100), (IRON, 50)], 30, 30);
    let cap = defs.ship(defs.scenarios[0].ships[0]).capacity;
    let w = World::new(defs.clone(), ScenarioId(0), 3).unwrap();
    check_invariants(&w).unwrap();
    let f = player_fleet(&w);
    assert_eq!(f.cargo.get(&GRAIN).copied(), Some(100.min(cap)));
    assert_eq!(f.cargo.get(&IRON).copied().unwrap_or(0), (cap - 100).clamp(0, 50));
    assert!(f.used() <= f.capacity());
    let a = w.agent(P).unwrap();
    assert_eq!(a.ledger.balance(Account::Inventory), a.book.total_cost());
}
