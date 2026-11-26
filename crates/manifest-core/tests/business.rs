//! M2 经营扩展的内核测试（小型世界）：期货（第 10 节测试 6）、商队、仓库、产业、投资、银行、合同、外交。

use manifest_core::contract::ContractStatus;
use manifest_core::diplomacy::DiploStatus;
use manifest_core::ledger::Account;
use manifest_core::log::LogKind;
use manifest_core::market::{Side, quote, tax_rate};
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::warehouse::Holder;
use manifest_core::*;

const P: OwnerId = OwnerId::Player;
const ALPHA: LocId = LocId(0);
const BETA: LocId = LocId(1);
const DELTA: LocId = LocId(3);
const GRAIN: GoodId = GoodId(0);
const CLOTH: GoodId = GoodId(1);
const SPICE: GoodId = GoodId(2);
const IRON: GoodId = GoodId(3);
const EX: ExchangeId = ExchangeId(0);

fn world(seed: u64) -> World {
    World::new(tiny_defs(), ScenarioId(0), seed).expect("开局")
}

fn ok(w: &mut World, c: Command) -> CommandOutcome {
    c.apply(w).unwrap_or_else(|e| panic!("{c:?} 失败：{e}"))
}

fn advance(w: &mut World, n: u32) {
    for _ in 0..n {
        w.end_day().unwrap();
        if let Err(e) = check_invariants(w) {
            panic!("{e}");
        }
    }
}

fn fleet(w: &World) -> FleetId {
    w.fleets_of(P).next().expect("玩家舰队").id
}

/// 某规格最近到期的合约。
fn nearest(w: &World, spec: u16) -> FuturesId {
    w.state
        .futures
        .contracts
        .values()
        .filter(|c| c.spec == spec && !c.settled)
        .min_by_key(|c| c.expiry_day)
        .expect("有挂牌合约")
        .id
}

fn logged(w: &World, pred: impl Fn(&LogKind) -> bool) -> bool {
    w.state.log.iter().any(|e| pred(&e.kind))
}

// ───────────────────────────── 期货（测试 6） ─────────────────────────────

#[test]
fn test6_futures_listing_and_quotes() {
    let w = world(1);
    for spec in 0..2u16 {
        let n = w.state.futures.contracts.values().filter(|c| c.spec == spec && !c.settled).count();
        assert_eq!(n, 3, "每个规格同时挂最近 3 个月");
    }
    let q = w.futures_quote(nearest(&w, 1)).unwrap();
    assert!(q.bid <= q.fair && q.fair <= q.ask);
    let big = w.futures_exec_price(nearest(&w, 1), 20).unwrap();
    let small = w.futures_exec_price(nearest(&w, 1), 1).unwrap();
    assert!(big >= small, "成交手数越多，冲击成本越高");
}

#[test]
fn test6_daily_mark_to_market_sums_to_zero_and_cash_settles_at_expiry() {
    let mut w = world(2);
    let c = nearest(&w, 1);
    ok(&mut w, Command::DepositMargin { owner: P, exchange: EX, amount: 20_000 });
    ok(&mut w, Command::TradeFutures { owner: P, contract: c, lots: 10 });
    let mut nonzero = false;
    for _ in 0..40 {
        let before: i64 = w.futures_money();
        w.end_day().unwrap();
        check_invariants(&w).unwrap();
        let r = w.state.futures.mtm_log.last().unwrap();
        assert_eq!(r.participants + r.house, 0, "盯市盈亏全体合计为零");
        nonzero |= r.participants != 0;
        // 期货系统内部只有划转：保证金 + 做市方总额不变（除到期时做市方与现货市场的往来）
        if w.futures_contract(c).is_some_and(|x| !x.settled) {
            assert_eq!(w.futures_money(), before);
        }
    }
    assert!(nonzero, "40 天内价格应有变动");
    let contract = w.futures_contract(c).unwrap();
    assert!(contract.settled);
    assert!(contract.final_price.is_some());
    assert!(w.position(P, c).is_none(), "到期后现金结算的持仓已了结");
    assert_eq!(w.warehouse(P, ALPHA).map(|x| x.used()).unwrap_or(0), 0, "现金结算不交收货物");
}

#[test]
fn test6_margin_call_then_forced_liquidation() {
    let mut w = world(3);
    let c = nearest(&w, 1);
    ok(&mut w, Command::DepositMargin { owner: P, exchange: EX, amount: 9_000 });
    ok(&mut w, Command::TradeFutures { owner: P, contract: c, lots: -45 });
    // 在交割港大量买入现货，推高现货价，从而推高结算价，使空头亏损
    let f = fleet(&w);
    ok(&mut w, Command::Buy { owner: P, fleet: f, good: CLOTH, qty: 100, max_total: None });
    w.end_day().unwrap();
    check_invariants(&w).unwrap();
    assert!(logged(&w, |k| matches!(k, LogKind::MarginCall { owner: OwnerId::Player, .. })), "应发出追保通知");
    assert!(w.position(P, c).is_some(), "追保当天不强平");
    w.end_day().unwrap();
    check_invariants(&w).unwrap();
    assert!(logged(&w, |k| matches!(k, LogKind::ForcedLiquidation { owner: OwnerId::Player, .. })), "次日仍不足则强平");
    assert!(w.position(P, c).is_none());
    assert!(w.margin_balance(P, EX) >= 0, "负保证金由现金补足");
}

#[test]
fn test6_margin_call_cleared_by_top_up() {
    let mut w = world(3);
    let c = nearest(&w, 1);
    ok(&mut w, Command::DepositMargin { owner: P, exchange: EX, amount: 9_000 });
    ok(&mut w, Command::TradeFutures { owner: P, contract: c, lots: -45 });
    let f = fleet(&w);
    ok(&mut w, Command::Buy { owner: P, fleet: f, good: CLOTH, qty: 100, max_total: None });
    advance(&mut w, 1);
    assert!(logged(&w, |k| matches!(k, LogKind::MarginCall { .. })));
    ok(&mut w, Command::DepositMargin { owner: P, exchange: EX, amount: 30_000 });
    advance(&mut w, 1);
    assert!(!logged(&w, |k| matches!(k, LogKind::ForcedLiquidation { .. })), "追加保证金后不再强平");
    assert!(w.position(P, c).is_some());
}

#[test]
fn test6_physical_delivery_long_receives_goods_into_warehouse() {
    let mut w = world(4);
    let c = nearest(&w, 0);
    let lot = w.defs.futures_specs[0].lot;
    ok(&mut w, Command::RentWarehouse { owner: P, loc: ALPHA, capacity: 100 });
    ok(&mut w, Command::DepositMargin { owner: P, exchange: EX, amount: 5_000 });
    ok(&mut w, Command::TradeFutures { owner: P, contract: c, lots: 2 });
    ok(&mut w, Command::SetDelivery { owner: P, contract: c, physical: true });
    let expiry = w.futures_contract(c).unwrap().expiry_day;
    while w.day() <= expiry {
        advance(&mut w, 1);
    }
    let fp = w.futures_contract(c).unwrap().final_price.unwrap();
    assert_eq!(w.holder_qty(P, Holder::Warehouse(ALPHA), GRAIN), 2 * lot, "多头在交割港仓库收货");
    let a = w.agent(P).unwrap();
    assert_eq!(a.book.qty(GRAIN), 2 * lot);
    assert_eq!(a.book.goods[&GRAIN].cost, fp * 2 * lot, "按最终结算价计入存货成本");
    assert!(logged(&w, |k| matches!(k, LogKind::FuturesDelivery { owner: OwnerId::Player, missing: 0, .. })));
}

#[test]
fn test6_physical_delivery_short_delivers_or_pays_penalty() {
    // 有货：从交割港仓库交货收款
    let mut w = world(5);
    let c = nearest(&w, 0);
    let lot = w.defs.futures_specs[0].lot;
    ok(&mut w, Command::RentWarehouse { owner: P, loc: ALPHA, capacity: 200 });
    ok(
        &mut w,
        Command::BuyInto { owner: P, holder: Holder::Warehouse(ALPHA), good: GRAIN, qty: 2 * lot, max_total: None },
    );
    ok(&mut w, Command::DepositMargin { owner: P, exchange: EX, amount: 5_000 });
    ok(&mut w, Command::TradeFutures { owner: P, contract: c, lots: -2 });
    ok(&mut w, Command::SetDelivery { owner: P, contract: c, physical: true });
    let expiry = w.futures_contract(c).unwrap().expiry_day;
    while w.day() <= expiry {
        advance(&mut w, 1);
    }
    assert_eq!(w.holder_qty(P, Holder::Warehouse(ALPHA), GRAIN), 0, "空头交出了仓库里的货");
    assert!(w.agent(P).unwrap().ledger.balance(Account::Sales) < 0, "交货计为销售收入");

    // 无货：按惩罚价现金结算
    let mut w = world(5);
    let c = nearest(&w, 0);
    ok(&mut w, Command::DepositMargin { owner: P, exchange: EX, amount: 5_000 });
    ok(&mut w, Command::TradeFutures { owner: P, contract: c, lots: -2 });
    ok(&mut w, Command::SetDelivery { owner: P, contract: c, physical: true });
    let expiry = w.futures_contract(c).unwrap().expiry_day;
    let losses_before = w.agent(P).unwrap().ledger.balance(Account::FuturesLosses);
    while w.day() <= expiry {
        advance(&mut w, 1);
    }
    assert!(logged(
        &w,
        |k| matches!(k, LogKind::FuturesDelivery { owner: OwnerId::Player, units: 0, missing, .. } if *missing == 2 * lot)
    ));
    assert!(w.agent(P).unwrap().ledger.balance(Account::FuturesLosses) > losses_before, "交不出货要付罚金");
}

#[test]
fn test6_position_limit_and_initial_margin_enforced() {
    let mut w = world(6);
    let c = nearest(&w, 1);
    let before = w.state_hash();
    assert!(Command::TradeFutures { owner: P, contract: c, lots: 5 }.apply(&mut w).is_err(), "没有保证金不能开仓");
    assert_eq!(w.state_hash(), before);
    ok(&mut w, Command::DepositMargin { owner: P, exchange: EX, amount: 50_000 });
    assert!(Command::TradeFutures { owner: P, contract: c, lots: 51 }.apply(&mut w).is_err(), "超过持仓上限");
    ok(&mut w, Command::TradeFutures { owner: P, contract: c, lots: 5 });
    ok(&mut w, Command::TradeFutures { owner: P, contract: c, lots: -5 });
    assert!(w.position(P, c).is_none(), "反向成交平仓");
    assert!(Command::WithdrawMargin { owner: P, exchange: EX, amount: 60_000 }.apply(&mut w).is_err());
    let bal = w.margin_balance(P, EX);
    ok(&mut w, Command::WithdrawMargin { owner: P, exchange: EX, amount: bal });
    check_invariants(&w).unwrap();
}

// ───────────────────────────── 商队、仓库 ─────────────────────────────

#[test]
fn caravan_travels_pays_tolls_and_trades_inland() {
    let mut w = world(7);
    let CommandOutcome::CaravanFormed { caravan } =
        ok(&mut w, Command::FormCaravan { owner: P, at: ALPHA, animal: AnimalId(0), count: 10 })
    else {
        panic!("应组建商队");
    };
    ok(&mut w, Command::SetGuards { owner: P, caravan, guards: 5 });
    ok(&mut w, Command::BuyInto { owner: P, holder: Holder::Caravan(caravan), good: GRAIN, qty: 40, max_total: None });
    assert!(
        Command::BuyInto { owner: P, holder: Holder::Caravan(caravan), good: GRAIN, qty: 20, max_total: None }
            .apply(&mut w)
            .is_err(),
        "超出商队载量"
    );
    let taxes_before = w.agent(P).unwrap().ledger.balance(Account::Taxes);
    ok(&mut w, Command::CaravanTravel { owner: P, caravan, dest: DELTA });
    assert!(w.agent(P).unwrap().ledger.balance(Account::Taxes) > taxes_before, "出发时交关卡税");
    let mut days = 0;
    while w.caravan(caravan).unwrap().at() != Some(DELTA) {
        advance(&mut w, 1);
        days += 1;
        assert!(days < 20, "应在 20 天内到达");
    }
    ok(&mut w, Command::SellFrom { owner: P, holder: Holder::Caravan(caravan), good: GRAIN, qty: 40, min_total: None });
    // 两段道路：delta → beta
    ok(&mut w, Command::CaravanTravel { owner: P, caravan, dest: BETA });
    advance(&mut w, 15);
    assert_eq!(w.caravan(caravan).unwrap().at(), Some(BETA));
    ok(&mut w, Command::DisbandCaravan { owner: P, caravan });
    assert!(w.state.caravans.is_empty());
    check_invariants(&w).unwrap();
}

#[test]
fn warehouse_rent_transfer_and_capacity() {
    let mut w = world(8);
    let f = fleet(&w);
    assert!(
        Command::BuyInto { owner: P, holder: Holder::Warehouse(ALPHA), good: GRAIN, qty: 10, max_total: None }
            .apply(&mut w)
            .is_err(),
        "没有仓库容量不能存货"
    );
    ok(&mut w, Command::RentWarehouse { owner: P, loc: ALPHA, capacity: 200 });
    ok(&mut w, Command::BuyInto { owner: P, holder: Holder::Warehouse(ALPHA), good: GRAIN, qty: 150, max_total: None });
    ok(
        &mut w,
        Command::Transfer { owner: P, from: Holder::Warehouse(ALPHA), to: Holder::Fleet(f), good: GRAIN, qty: 50 },
    );
    assert_eq!(w.holder_qty(P, Holder::Fleet(f), GRAIN), 50);
    assert!(Command::RentWarehouse { owner: P, loc: ALPHA, capacity: 50 }.apply(&mut w).is_err(), "缩租不能小于存货");
    ok(&mut w, Command::BuyWarehouse { owner: P, loc: ALPHA, capacity: 100 });
    assert_eq!(w.warehouse_capacity(P, ALPHA), 300);
    assert!(w.agent(P).unwrap().ledger.balance(Account::Property) > 0, "买下的仓库计为资产");
    let fees_before = w.agent(P).unwrap().ledger.balance(Account::Fees);
    advance(&mut w, 3);
    assert!(w.agent(P).unwrap().ledger.balance(Account::Fees) > fees_before, "按日付租金");
}

// ───────────────────────────── 产业 ─────────────────────────────

#[test]
fn industry_produces_from_warehouse_and_stalls_without_inputs() {
    let mut w = world(9);
    let grow = RecipeId(0);
    let weave = RecipeId(1);
    let farm = IndustryTypeId(0);
    assert!(
        Command::BuildIndustry { owner: P, loc: ALPHA, kind: farm, recipe: grow }.apply(&mut w).is_err(),
        "没有仓库不能建产业"
    );
    ok(&mut w, Command::RentWarehouse { owner: P, loc: ALPHA, capacity: 500 });
    ok(&mut w, Command::RentWarehouse { owner: P, loc: BETA, capacity: 100 });
    assert!(
        Command::BuildIndustry { owner: P, loc: BETA, kind: farm, recipe: grow }.apply(&mut w).is_err(),
        "采集类产业只能建在特产地"
    );
    let CommandOutcome::IndustryBuilt { industry } =
        ok(&mut w, Command::BuildIndustry { owner: P, loc: ALPHA, kind: farm, recipe: grow })
    else {
        panic!("应建成产业");
    };
    advance(&mut w, 5);
    assert_eq!(w.holder_qty(P, Holder::Warehouse(ALPHA), GRAIN), 40, "每天产 8 单位谷物");
    ok(&mut w, Command::ChangeRecipe { owner: P, industry, recipe: weave });
    advance(&mut w, 3);
    assert_eq!(w.holder_qty(P, Holder::Warehouse(ALPHA), CLOTH), 3, "纺织消耗谷物产出布");
    assert_eq!(w.holder_qty(P, Holder::Warehouse(ALPHA), GRAIN), 40 - 18);
    // 谷物用完后停工
    advance(&mut w, 5);
    assert!(w.state.industries[&industry].stalled);
    ok(&mut w, Command::SetManager { owner: P, industry, hired: true });
    ok(&mut w, Command::UpgradeIndustry { owner: P, industry });
    assert_eq!(w.state.industries[&industry].level, 2);
    ok(&mut w, Command::SellIndustry { owner: P, industry });
    assert!(w.state.industries.is_empty());
    check_invariants(&w).unwrap();
}

// ───────────────────────────── 投资、银行 ─────────────────────────────

#[test]
fn port_investment_raises_development_and_grants_ally_benefits() {
    let mut w = world(10);
    let tax_before = tax_rate(&w, P, ALPHA);
    let dev_before = w.state.locations[0].development;
    ok(&mut w, Command::InvestPort { owner: P, loc: ALPHA, amount: 30_000 });
    assert!(w.state.locations[0].development > dev_before);
    assert_eq!(w.state.locations[0].ally, Some(P), "占有率最高且超过阈值即成同盟港");
    assert!(tax_rate(&w, P, ALPHA) < tax_before, "同盟港交易税优惠");
    assert!(w.warehouse_capacity(P, ALPHA) > 0, "同盟港可用商馆容量");
    // 公司投资更多后夺走同盟港
    let c0 = OwnerId::Company(CompanyId(0));
    let cash = w.agent(c0).unwrap().cash;
    ok(&mut w, Command::InvestPort { owner: c0, loc: ALPHA, amount: cash.min(29_000) });
    ok(&mut w, Command::Deposit { owner: c0, amount: 1 });
    assert!(w.investment_share(P, ALPHA) > manifest_core::fixed::Fx::ZERO);
    check_invariants(&w).unwrap();
}

#[test]
fn bank_deposits_loans_interest_and_default() {
    let mut w = world(11);
    ok(&mut w, Command::Deposit { owner: P, amount: 10_000 });
    assert_eq!(w.agent(P).unwrap().deposit, 10_000);
    let limit = w.loan_limit(P);
    assert!(limit > 0);
    assert!(Command::Borrow { owner: P, amount: limit + 1, months: 6 }.apply(&mut w).is_err(), "超出额度");
    let CommandOutcome::LoanTaken { loan } = ok(&mut w, Command::Borrow { owner: P, amount: 20_000, months: 1 }) else {
        panic!("应放贷");
    };
    ok(&mut w, Command::Repay { owner: P, loan, amount: 5_000 });
    // 第 0 天借入、期限 1 个月：第 30 天到期，当天的账本日结自动还本
    advance(&mut w, 31);
    let a = w.agent(P).unwrap();
    assert!(a.deposit > 10_000, "存款按月计息");
    assert!(a.ledger.balance(Account::InterestExpense) > 0, "贷款按月付息");
    assert!(w.state.loans.is_empty(), "到期自动还本");

    // 违约：把大部分现金存入银行（留足工资），到期现金不足以还本
    let CommandOutcome::LoanTaken { loan } = ok(&mut w, Command::Borrow { owner: P, amount: 10_000, months: 1 }) else {
        panic!("应放贷");
    };
    let cash = w.agent(P).unwrap().cash;
    ok(&mut w, Command::Deposit { owner: P, amount: cash - 3_000 });
    advance(&mut w, 31);
    assert!(w.state.loans[&loan].overdue);
    assert_eq!(w.agent(P).unwrap().credit.defaults, 1);
    assert!(logged(&w, |k| matches!(k, LogKind::LoanDefault { .. })));
}

// ───────────────────────────── 合同、外交、许可证 ─────────────────────────────

#[test]
fn contracts_are_posted_accepted_delivered_or_failed() {
    let mut w = world(12);
    advance(&mut w, 16);
    let open: Vec<_> = w.state.contracts.values().filter(|c| c.status == ContractStatus::Open).cloned().collect();
    assert!(!open.is_empty(), "每月中旬发布合同");
    let target = open.iter().find(|c| c.to == ALPHA).cloned();
    let other = open.iter().find(|c| Some(c.id) != target.as_ref().map(|t| t.id)).cloned();
    if let Some(t) = target {
        ok(&mut w, Command::AcceptContract { owner: P, contract: t.id });
        ok(&mut w, Command::RentWarehouse { owner: P, loc: ALPHA, capacity: t.qty });
        ok(
            &mut w,
            Command::BuyInto { owner: P, holder: Holder::Warehouse(ALPHA), good: t.good, qty: t.qty, max_total: None },
        );
        let rep = w.reputation(P, t.issuer);
        ok(&mut w, Command::DeliverContract { owner: P, contract: t.id, holder: Holder::Warehouse(ALPHA) });
        assert_eq!(w.state.contracts[&t.id].status, ContractStatus::Completed(P));
        assert!(w.agent(P).unwrap().ledger.balance(Account::ContractIncome) < 0);
        assert!(w.reputation(P, t.issuer) > rep);
    }
    let o = other.expect("至少两份合同");
    ok(&mut w, Command::AcceptContract { owner: P, contract: o.id });
    let rep = w.reputation(P, o.issuer);
    while w.day() <= o.deadline + 1 {
        advance(&mut w, 1);
    }
    assert_eq!(w.state.contracts[&o.id].status, ContractStatus::Failed(P));
    assert!(w.reputation(P, o.issuer) < rep, "违约损失声望");
    assert!(logged(&w, |k| matches!(k, LogKind::ContractFailed { .. })));
}

#[test]
fn diplomacy_state_machine_and_war_effects() {
    let mut w = world(13);
    let (a, b) = (FactionId(0), FactionId(1));
    assert_eq!(w.relation(a, b).unwrap().status, DiploStatus::Peace);
    w.apply_relation_delta(a, b, -25).unwrap();
    assert_eq!(w.relation(a, b).unwrap().status, DiploStatus::Tension, "关系恶化进入紧张");
    // 紧张未满期限时不能直接开战
    w.apply_relation_delta(a, b, -60).unwrap();
    assert_eq!(w.relation(a, b).unwrap().status, DiploStatus::Tension);
    advance(&mut w, 61);
    w.apply_relation_delta(a, b, -60).unwrap();
    assert_eq!(w.relation(a, b).unwrap().status, DiploStatus::War, "紧张持续足够久后开战");
    assert!(w.at_war(a));
    let tax_war = tax_rate(&w, P, ALPHA);
    ok(&mut w, Command::BuyMarque { owner: P, faction: a });
    assert!(tax_rate(&w, P, ALPHA) < tax_war, "持有私掠许可免除战时加税");
    advance(&mut w, 181);
    w.apply_relation_delta(a, b, 80).unwrap();
    assert_eq!(w.relation(a, b).unwrap().status, DiploStatus::Truce, "战争满期且关系缓和后停战");
    advance(&mut w, 181);
    assert_eq!(w.relation(a, b).unwrap().status, DiploStatus::Peace, "停战期满恢复和平");
}

#[test]
fn licensed_goods_require_a_license() {
    let mut w = world(14);
    let f = fleet(&w);
    assert!(Command::Buy { owner: P, fleet: f, good: IRON, qty: 5, max_total: None }.apply(&mut w).is_err());
    assert!(Command::BuyLicense { owner: P, faction: FactionId(0) }.apply(&mut w).is_err(), "声望不足");
    // 通过大额贸易积累声望
    for _ in 0..6 {
        let q = quote(&w, P, ALPHA, SPICE, Side::Buy, 25).unwrap();
        assert!(q.gross >= 5_000);
        ok(&mut w, Command::Buy { owner: P, fleet: f, good: SPICE, qty: 25, max_total: None });
        ok(&mut w, Command::Sell { owner: P, fleet: f, good: SPICE, qty: 25, min_total: None });
    }
    assert!(w.reputation(P, FactionId(0)) >= 10);
    ok(&mut w, Command::BuyLicense { owner: P, faction: FactionId(0) });
    ok(&mut w, Command::Buy { owner: P, fleet: f, good: IRON, qty: 5, max_total: None });
    check_invariants(&w).unwrap();
}

#[test]
fn two_years_with_all_systems_keep_invariants() {
    let mut w = world(15);
    advance(&mut w, 720);
    let npc_futures = w.state.agents.values().filter(|a| a.owner.company().is_some()).any(|a| {
        a.ledger.yearly.iter().any(|r| r.income.revenues.iter().any(|(acc, _)| *acc == Account::FuturesGains))
    }) || w.state.futures.mtm_log.iter().any(|r| r.participants != 0);
    assert!(npc_futures, "商会应参与期货");
}
