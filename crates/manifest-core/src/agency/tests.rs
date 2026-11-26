//! T03 的内核测试：挂单的成交条件、预留金与撤单、挂单上限、守恒、存档往返；产业位按商馆等级、旧档超出的保留；
//! 开关关着时没有挂单、行为不变。

use super::*;
use crate::ids::ScenarioId;
use crate::testkit::tiny_defs;
use crate::warehouse::Warehouse;
use std::sync::Arc;

const P: OwnerId = OwnerId::Player;
const ALPHA: LocId = LocId(0);
const GRAIN: GoodId = GoodId(0);
const CLOTH: GoodId = GoodId(1);
const IRON: GoodId = GoodId(3);

/// 打开货币流通、商馆与代办的小型世界。
fn defs() -> crate::defs::StaticData {
    let mut d = (*tiny_defs()).clone();
    d.rules.money.enabled = true;
    d.rules.access.enabled = true;
    d.rules.agency = AgencyRules { enabled: true, industry_slots: vec![0, 1, 2, 3, 4], ..AgencyRules::default() };
    d
}

fn world(d: crate::defs::StaticData) -> World {
    World::new(Arc::new(d), ScenarioId(0), 7).unwrap()
}

/// 改现金时把差额记进开局总额（守恒检查才对得上）。
fn give_cash(w: &mut World, money: Money) {
    let a = w.state.agents.get_mut(&P).unwrap();
    let delta = money - a.cash;
    a.cash = money;
    a.ledger
        .post(
            JournalEntry::new(0, Memo::Opening, CashClass::Financing)
                .dr(Account::Cash, delta)
                .cr(Account::Capital, delta),
        )
        .unwrap();
    w.state.money.initial += delta;
    if w.circulation_on() {
        w.state.circulation.initial += delta;
    }
}

/// 在 ALPHA 有 `level` 级商馆、500 仓位的仓库（另放一些货）。
fn setup(level: usize, stock: &[(GoodId, i64)]) -> World {
    let mut w = world(defs());
    let need = w.house_threshold(ALPHA, level).unwrap();
    w.state.locations[ALPHA.idx()].investments.insert(P, need);
    assert_eq!(w.house_level(P, ALPHA), level);
    let wh = Warehouse { rented: 0, owned: 500, stock: stock.iter().copied().collect() };
    w.state.locations[ALPHA.idx()].warehouses.insert(P, wh);
    for (g, q) in stock {
        w.agent_mut(P).unwrap().book.add(*g, *q, 0);
    }
    give_cash(&mut w, 100_000);
    assert!(w.money_conserved());
    w
}

fn price(w: &World, g: GoodId) -> Money {
    w.market(ALPHA, g).unwrap().price
}

fn place(w: &mut World, good: GoodId, side: OrderSide, limit: Money, qty: i64) -> Result<(), CommandError> {
    Command::PlaceOrder { owner: P, loc: ALPHA, good, side, limit, qty }.apply(w).map(|_| ())
}

fn escrow(w: &World) -> Money {
    w.state.agents[&P].ledger.balance(Account::AgencyEscrow)
}

#[test]
fn a_buy_order_reserves_cash_and_cancelling_returns_it() {
    let mut w = setup(1, &[]);
    let limit = price(&w, GRAIN) * 2;
    place(&mut w, GRAIN, OrderSide::Buy, limit, 50).unwrap();
    let o = w.state.agency.orders.values().next().unwrap().clone();
    assert!(o.reserved >= limit * 50, "预留至少限价 × 件数：{}", o.reserved);
    assert_eq!(w.state.agents[&P].cash, 100_000 - o.reserved);
    assert_eq!(escrow(&w), o.reserved);
    assert_eq!(w.agency_money(), o.reserved);
    assert!(w.money_conserved(), "预留金算在参与者手里");
    Command::CancelOrder { owner: P, order: o.id }.apply(&mut w).unwrap();
    assert_eq!(w.state.agents[&P].cash, 100_000);
    assert_eq!(escrow(&w), 0);
    assert!(w.state.agency.orders.is_empty());
    assert!(w.money_conserved());
    // 现金不够预留：挂不上
    let err = place(&mut w, GRAIN, OrderSide::Buy, 10_000, 100).unwrap_err();
    assert!(matches!(err, CommandError::InsufficientCash { .. }), "{err:?}");
}

#[test]
fn a_buy_order_fills_at_or_below_its_limit_through_the_normal_trade_path() {
    let mut w = setup(1, &[]);
    let p0 = price(&w, GRAIN);
    // 限价低于现价：不成交，原样挂着，记下原因
    place(&mut w, GRAIN, OrderSide::Buy, p0 / 2, 20).unwrap();
    w.agency_day().unwrap();
    let o = w.state.agency.orders.values().next().unwrap();
    assert_eq!((o.qty, o.filled, o.waiting.as_deref()), (20, 0, Some("agency.price")));
    assert!(w.money_conserved());
    Command::CancelOrder { owner: P, order: o.id }.apply(&mut w).unwrap();

    // 限价够：成交，货进仓库，市场被吃掉、付了税与代办费，剩下的预留金退回
    let stock0 = w.market(ALPHA, GRAIN).unwrap().stock;
    let purse0 = w.state.circulation.towns[&ALPHA].money;
    place(&mut w, GRAIN, OrderSide::Buy, p0 * 3, 10).unwrap();
    w.agency_day().unwrap();
    assert!(w.state.agency.orders.is_empty(), "全数成交后单子撤掉");
    assert_eq!(w.holder_qty(P, Holder::Warehouse(ALPHA), GRAIN), 10);
    assert_eq!(w.market(ALPHA, GRAIN).unwrap().stock, stock0 - 10);
    let fill = w.state.agency.fills.last().unwrap().clone();
    assert_eq!((fill.qty, fill.side), (10, OrderSide::Buy));
    assert!(fill.fee >= 1);
    assert_eq!(w.state.agents[&P].cash, 100_000 - fill.total - fill.fee);
    assert_eq!(escrow(&w), 0);
    assert!(w.state.circulation.towns[&ALPHA].money > purse0, "货款与代办费进了城镇钱袋");
    assert_eq!(w.state.money.sinks.get(&Flow::AgencyFee), Some(&fill.fee));
    assert!(w.state.log.iter().any(|e| matches!(e.kind, LogKind::AgencyFilled { buy: true, qty: 10, .. })));
    assert!(w.money_conserved());
}

#[test]
fn a_buy_order_fills_only_as_much_as_the_limit_allows() {
    let mut w = setup(1, &[]);
    let p0 = price(&w, GRAIN);
    // 买得越多均价越高：限价只比现价高一点，只成交一部分，剩下的挂着、预留金按剩下的件数重算
    place(&mut w, GRAIN, OrderSide::Buy, p0 + p0 / 10 + 1, 400).unwrap();
    w.agency_day().unwrap();
    let o = w.state.agency.orders.values().next().unwrap().clone();
    assert!(o.filled > 0 && o.qty > 0, "部分成交：{o:?}");
    assert_eq!(o.filled + o.qty, 400);
    assert_eq!(escrow(&w), o.reserved);
    assert!(w.money_conserved());
}

#[test]
fn a_sell_order_sells_from_the_warehouse_at_or_above_its_limit() {
    let mut w = setup(1, &[(CLOTH, 30)]);
    let p0 = price(&w, CLOTH);
    place(&mut w, CLOTH, OrderSide::Sell, p0 * 3, 30).unwrap();
    w.agency_day().unwrap();
    assert_eq!(w.state.agency.orders.values().next().unwrap().waiting.as_deref(), Some("agency.price"));
    let id = *w.state.agency.orders.keys().next().unwrap();
    Command::CancelOrder { owner: P, order: id }.apply(&mut w).unwrap();
    place(&mut w, CLOTH, OrderSide::Sell, 1, 30).unwrap();
    w.agency_day().unwrap();
    assert!(w.state.agency.orders.is_empty());
    assert_eq!(w.holder_qty(P, Holder::Warehouse(ALPHA), CLOTH), 0);
    let fill = w.state.agency.fills.last().unwrap();
    assert_eq!(w.state.agents[&P].cash, 100_000 + fill.total - fill.fee);
    assert!(w.money_conserved());
    // 仓库里没有那么多货：挂不上
    assert!(matches!(
        place(&mut w, CLOTH, OrderSide::Sell, 1, 5).unwrap_err(),
        CommandError::InsufficientCargo { have: 0 }
    ));
}

#[test]
fn orders_need_a_warehouse_and_are_capped_at_two_per_house_level() {
    // 没有商馆：0 张
    let mut w = setup(0, &[]);
    assert_eq!(place(&mut w, GRAIN, OrderSide::Buy, 1, 1).unwrap_err().code(), "agency.slots");
    // 1 级：2 张
    let mut w = setup(1, &[]);
    place(&mut w, GRAIN, OrderSide::Buy, 1, 1).unwrap();
    place(&mut w, CLOTH, OrderSide::Buy, 1, 1).unwrap();
    assert_eq!(place(&mut w, GRAIN, OrderSide::Buy, 1, 1).unwrap_err().code(), "agency.slots");
    assert_eq!(w.agency_slots(P, ALPHA), 2);
    // 3 级：6 张
    let w3 = setup(3, &[]);
    assert_eq!(w3.agency_slots(P, ALPHA), 6);
    // 商馆的免费仓位也算仓库；没有仓库、也没有免费仓位时挂不上
    let mut w = setup(1, &[]);
    w.state.locations[ALPHA.idx()].warehouses.remove(&P);
    assert!(w.free_storage(P, ALPHA) > 0, "1 级商馆有免费仓位");
    place(&mut w, GRAIN, OrderSide::Buy, 1, 1).unwrap();
    let mut d = defs();
    d.rules.access.house_storage = vec![0; d.rules.access.house_storage.len()];
    let mut w = world(d);
    let need = w.house_threshold(ALPHA, 1).unwrap();
    w.state.locations[ALPHA.idx()].investments.insert(P, need);
    assert_eq!(w.free_storage(P, ALPHA), 0);
    assert_eq!(place(&mut w, GRAIN, OrderSide::Buy, 1, 1).unwrap_err().code(), "agency.warehouse");
}

#[test]
fn a_licensed_good_waits_with_the_license_reason_and_keeps_its_reserve() {
    let mut w = setup(1, &[]);
    let limit = price(&w, IRON) * 3;
    place(&mut w, IRON, OrderSide::Buy, limit, 5).unwrap();
    let reserved = w.agency_money();
    w.agency_day().unwrap();
    let o = w.state.agency.orders.values().next().unwrap();
    assert_eq!(o.waiting.as_deref(), Some("trade.license"));
    assert_eq!((o.filled, o.reserved), (0, reserved));
    assert!(w.money_conserved());
}

#[test]
fn a_negative_cash_balance_refunds_buy_orders_first() {
    let mut w = setup(1, &[]);
    place(&mut w, GRAIN, OrderSide::Buy, 1, 10).unwrap();
    let reserved = w.agency_money();
    // 现金被别的开销拖成负数
    let rest = w.state.agents[&P].cash;
    w.book_internal(
        P,
        JournalEntry::new(0, Memo::Other, CashClass::Operating)
            .dr(Account::OtherExpense, rest + 10)
            .cr(Account::Cash, rest + 10),
    )
    .unwrap();
    w.state.money.initial -= rest + 10;
    w.state.circulation.initial -= rest + 10;
    assert!(w.money_conserved());
    w.agency_day().unwrap();
    assert!(w.state.agency.orders.is_empty());
    assert_eq!(w.state.agents[&P].cash, reserved - 10);
    assert!(w.state.log.iter().any(|e| matches!(e.kind, LogKind::AgencyRefunded { .. })));
    assert!(w.money_conserved());
}

#[test]
fn orders_survive_a_save_round_trip_and_fill_through_the_daily_tick() {
    let mut w = setup(1, &[]);
    let limit = price(&w, GRAIN) * 3;
    place(&mut w, GRAIN, OrderSide::Buy, limit, 5).unwrap();
    let json = serde_json::to_string(&w.state).unwrap();
    assert!(json.contains("\"agency\""));
    let back: crate::world::WorldState = serde_json::from_str(&json).unwrap();
    assert_eq!(back.agency, w.state.agency);
    // 日结里成交
    for _ in 0..3 {
        w.end_day().unwrap();
        assert!(w.money_conserved());
    }
    assert!(w.state.agency.orders.is_empty());
    assert_eq!(w.holder_qty(P, Holder::Warehouse(ALPHA), GRAIN), 5);
}

#[test]
fn with_the_rule_off_there_are_no_orders_and_the_state_is_not_saved() {
    let mut d = defs();
    d.rules.agency.enabled = false;
    let mut w = world(d);
    w.state.locations[ALPHA.idx()].investments.insert(P, 1_000_000);
    w.state.locations[ALPHA.idx()].warehouses.insert(P, Warehouse { rented: 0, owned: 500, stock: Default::default() });
    assert_eq!(place(&mut w, GRAIN, OrderSide::Buy, 1, 1).unwrap_err().code(), "agency.off");
    assert_eq!(w.agency_slots(P, ALPHA), 0);
    assert_eq!(w.industry_slots(P, ALPHA), None, "产业位也不限");
    w.end_day().unwrap();
    assert!(w.state.agency.is_empty());
    assert!(!serde_json::to_string(&w.state).unwrap().contains("\"agency\""));
}

#[test]
fn industry_slots_follow_the_house_level_and_old_extras_are_kept() {
    let build = |w: &mut World| {
        Command::BuildIndustry { owner: P, loc: ALPHA, kind: IndustryTypeId(0), recipe: RecipeId(0) }.apply(w)
    };
    // 0 级：0 个位
    let mut w = setup(0, &[]);
    w.state.locations[ALPHA.idx()].warehouses.insert(P, Warehouse { rented: 0, owned: 500, stock: Default::default() });
    assert_eq!(w.industry_slots(P, ALPHA), Some(0));
    assert_eq!(build(&mut w).unwrap_err().code(), "industry.slots");
    // 1 级：1 个位
    let mut w = setup(1, &[]);
    build(&mut w).unwrap();
    assert_eq!(build(&mut w).unwrap_err().code(), "industry.slots");
    // 2 级：2 个位
    let mut w = setup(2, &[]);
    build(&mut w).unwrap();
    build(&mut w).unwrap();
    assert_eq!(build(&mut w).unwrap_err().code(), "industry.slots");
    // 旧档：0 级却已有两处产业——保留，照常生产，只是不能再建
    let mut w = setup(2, &[]);
    build(&mut w).unwrap();
    build(&mut w).unwrap();
    w.state.locations[ALPHA.idx()].investments.insert(P, 0);
    assert_eq!(w.industry_slots(P, ALPHA), Some(0));
    w.end_day().unwrap();
    assert_eq!(w.industries_at(P, ALPHA), 2, "超出的产业不没收");
    assert_eq!(build(&mut w).unwrap_err().code(), "industry.slots");
}
