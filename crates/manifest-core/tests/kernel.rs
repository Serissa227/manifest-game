//! 内核集成测试（小型世界，不读文件）。

use manifest_core::ledger::Account;
use manifest_core::market::{Side, quote};
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::warehouse::Holder;
use manifest_core::world::FleetLocation;
use manifest_core::*;
use proptest::prelude::*;

fn new_world(seed: u64) -> World {
    World::new(tiny_defs(), ScenarioId(0), seed).expect("开局")
}

fn player_fleet(w: &World) -> FleetId {
    w.fleets_of(OwnerId::Player).next().expect("玩家有舰队").id
}

#[test]
fn invariants_hold_for_two_years_of_npc_trading() {
    let mut w = new_world(11);
    check_invariants(&w).unwrap();
    for _ in 0..720 {
        w.end_day().unwrap();
        check_invariants(&w).unwrap();
    }
    // NPC 商会确实在做生意
    let sales: i64 = w
        .state
        .agents
        .values()
        .filter(|a| a.owner.company().is_some())
        .flat_map(|a| a.ledger.yearly.iter())
        .map(|r| r.income.total_revenue)
        .sum();
    assert!(sales > 0, "两年内商会应有销售收入");
    assert_eq!(w.state.agents[&OwnerId::Player].ledger.yearly.len(), 2);
}

#[test]
fn same_seed_same_hash_different_seed_differs() {
    let run = |seed| {
        let mut w = new_world(seed);
        for _ in 0..200 {
            w.end_day().unwrap();
        }
        w.state_hash()
    };
    assert_eq!(run(5), run(5));
    assert_ne!(run(5), run(6));
}

#[test]
fn player_buys_sails_and_sells() {
    let mut w = new_world(3);
    let fleet = player_fleet(&w);
    let cash0 = w.state.agents[&OwnerId::Player].cash;
    // 在 alpha 买谷物（产地，便宜）
    let q = quote(&w, OwnerId::Player, LocId(0), GoodId(0), Side::Buy, 50).unwrap();
    let out = Command::Buy { owner: OwnerId::Player, fleet, good: GoodId(0), qty: 50, max_total: None }
        .apply(&mut w)
        .unwrap();
    assert_eq!(out, CommandOutcome::Traded(q.clone()));
    assert!(q.price_after > q.price_before, "买入推高价格");
    Command::Resupply { owner: OwnerId::Player, fleet, food: 20, water: 20 }.apply(&mut w).unwrap();
    Command::SetSail { owner: OwnerId::Player, fleet, dest: LocId(1) }.apply(&mut w).unwrap();
    let mut days = 0;
    while w.fleet(fleet).unwrap().docked_at() != Some(LocId(1)) {
        w.end_day().unwrap();
        check_invariants(&w).unwrap();
        days += 1;
        assert!(days < 60, "应在 60 天内抵达");
    }
    let have = w.fleet(fleet).unwrap().cargo.get(&GoodId(0)).copied().unwrap_or(0);
    assert!(have > 0);
    let sell = quote(&w, OwnerId::Player, LocId(1), GoodId(0), Side::Sell, have).unwrap();
    assert!(sell.price_after < sell.price_before, "卖出压低价格");
    Command::Sell { owner: OwnerId::Player, fleet, good: GoodId(0), qty: have, min_total: None }.apply(&mut w).unwrap();
    check_invariants(&w).unwrap();
    let agent = &w.state.agents[&OwnerId::Player];
    assert_ne!(agent.cash, cash0);
    assert!(agent.ledger.balance(Account::Sales) < 0, "记有销售收入");
    assert_eq!(agent.book.qty(GoodId(0)), 0);
}

#[test]
fn invalid_commands_do_not_change_state() {
    let mut w = new_world(9);
    let fleet = player_fleet(&w);
    let before = w.state_hash();
    let bad = [
        Command::Buy { owner: OwnerId::Player, fleet, good: GoodId(0), qty: 0, max_total: None },
        Command::Buy { owner: OwnerId::Player, fleet, good: GoodId(0), qty: 10_000_000, max_total: None },
        Command::Sell { owner: OwnerId::Player, fleet, good: GoodId(1), qty: 5, min_total: None },
        Command::SetSail { owner: OwnerId::Player, fleet, dest: LocId(0) },
        Command::HireCrew { owner: OwnerId::Player, fleet, count: 10_000 },
        Command::Repair { owner: OwnerId::Player, fleet },
        Command::SellShip { owner: OwnerId::Player, fleet, ship: 0 },
        Command::Buy { owner: OwnerId::Company(CompanyId(0)), fleet, good: GoodId(0), qty: 1, max_total: None },
    ];
    for c in bad {
        assert!(c.apply(&mut w).is_err(), "{c:?} 应被拒绝");
    }
    assert_eq!(w.state_hash(), before);
}

#[test]
fn save_roundtrip_and_v1_migration() {
    let mut w = new_world(21);
    for _ in 0..40 {
        w.end_day().unwrap();
    }
    let defs = w.defs.clone();
    let save = SaveFile::new(&defs, StartParams::new(ScenarioId(0), 21), w.state.clone(), Vec::new());
    let json = save.to_json().unwrap();
    let back = SaveFile::from_json(&json).unwrap();
    assert_eq!(back, save);
    let restored = World::from_snapshot(defs.clone(), back.snapshot).unwrap();
    assert_eq!(restored.state_hash(), w.state_hash());

    let v1 = manifest_core::save::downgrade_to_v1(serde_json::from_str(&json).unwrap()).unwrap();
    assert_eq!(v1["version"], 1);
    assert!(v1.get("world").is_some());
    let migrated = SaveFile::from_json(&v1.to_string()).unwrap();
    assert_eq!(migrated, save);
}

#[derive(Clone, Debug)]
enum Op {
    Buy(u16, i64),
    Sell(u16, i64),
    Sail(u16),
    Resupply(i64, i64),
    Hire(i64),
    Dismiss(i64),
    Repair,
    BuyShip(u16, bool),
    SellShip(u8),
    Refit(u8),
    Advance(u32),
    Rent(i64),
    BuyWh(u16, i64),
    SellWh(u16, i64),
    ToWh(u16, i64),
    FromWh(u16, i64),
    Caravan(i64),
    CarBuy(i64),
    CarTravel(u16),
    Margin(i64),
    Futures(u16, i64),
    Physical(bool),
    Deposit(i64),
    Borrow(i64),
    Invest(i64),
    Build(u16),
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        (0u16..4, 1i64..400).prop_map(|(g, q)| Op::Buy(g, q)),
        (0u16..4, 1i64..400).prop_map(|(g, q)| Op::Sell(g, q)),
        (0u16..3).prop_map(Op::Sail),
        (0i64..80, 0i64..80).prop_map(|(f, w)| Op::Resupply(f, w)),
        (1i64..30).prop_map(Op::Hire),
        (1i64..10).prop_map(Op::Dismiss),
        Just(Op::Repair),
        (0u16..2, any::<bool>()).prop_map(|(t, n)| Op::BuyShip(t, n)),
        (0u8..3).prop_map(Op::SellShip),
        (0u8..3).prop_map(Op::Refit),
        (1u32..15).prop_map(Op::Advance),
        (0i64..400).prop_map(Op::Rent),
        (0u16..4, 1i64..200).prop_map(|(g, q)| Op::BuyWh(g, q)),
        (0u16..4, 1i64..200).prop_map(|(g, q)| Op::SellWh(g, q)),
        (0u16..4, 1i64..100).prop_map(|(g, q)| Op::ToWh(g, q)),
        (0u16..4, 1i64..100).prop_map(|(g, q)| Op::FromWh(g, q)),
        (1i64..20).prop_map(Op::Caravan),
        (1i64..60).prop_map(Op::CarBuy),
        (0u16..4).prop_map(Op::CarTravel),
        (1i64..20_000).prop_map(Op::Margin),
        (0u16..2, -30i64..30).prop_map(|(s, l)| Op::Futures(s, l)),
        any::<bool>().prop_map(Op::Physical),
        (1i64..20_000).prop_map(Op::Deposit),
        (1i64..40_000).prop_map(Op::Borrow),
        (1_000i64..30_000).prop_map(Op::Invest),
        (0u16..2).prop_map(Op::Build),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 96, .. ProptestConfig::default() })]

    /// 测试 3（账本平衡）、4（货币守恒）、5（非负）：随机操作序列下任意时刻都成立。
    #[test]
    fn random_operations_keep_invariants(seed in 0u64..1000, ops in proptest::collection::vec(op(), 1..40)) {
        let mut w = new_world(seed);
        let owner = OwnerId::Player;
        for op in ops {
            let fleets: Vec<FleetId> = w.fleets_of(owner).map(|f| f.id).collect();
            let Some(&fleet) = fleets.first() else { break };
            let fleet = if let Some(&last) = fleets.last() { if seed.is_multiple_of(2) { last } else { fleet } } else { fleet };
            let cmd = match op {
                Op::Buy(g, q) => Some(Command::Buy { owner, fleet, good: GoodId(g), qty: q, max_total: None }),
                Op::Sell(g, q) => Some(Command::Sell { owner, fleet, good: GoodId(g), qty: q, min_total: None }),
                Op::Sail(d) => Some(Command::SetSail { owner, fleet, dest: LocId(d) }),
                Op::Resupply(f, wt) => Some(Command::Resupply { owner, fleet, food: f, water: wt }),
                Op::Hire(n) => Some(Command::HireCrew { owner, fleet, count: n }),
                Op::Dismiss(n) => Some(Command::DismissCrew { owner, fleet, count: n }),
                Op::Repair => Some(Command::Repair { owner, fleet }),
                Op::BuyShip(t, n) => Some(Command::BuyShip { owner, fleet, ship_type: ShipTypeId(t), new_fleet: n }),
                Op::SellShip(i) => Some(Command::SellShip { owner, fleet, ship: i }),
                Op::Refit(i) => Some(Command::RefitShip { owner, fleet, ship: i, refit: RefitId(0) }),
                Op::Advance(days) => {
                    for _ in 0..days {
                        w.end_day().unwrap();
                        if let Err(e) = check_invariants(&w) { prop_assert!(false, "{}", e); }
                    }
                    None
                }
                Op::Rent(cap) => Some(Command::RentWarehouse { owner, loc: LocId(0), capacity: cap }),
                Op::BuyWh(g, q) => Some(Command::BuyInto { owner, holder: Holder::Warehouse(LocId(0)), good: GoodId(g), qty: q, max_total: None }),
                Op::SellWh(g, q) => Some(Command::SellFrom { owner, holder: Holder::Warehouse(LocId(0)), good: GoodId(g), qty: q, min_total: None }),
                Op::ToWh(g, q) => Some(Command::Transfer { owner, from: Holder::Fleet(fleet), to: Holder::Warehouse(LocId(0)), good: GoodId(g), qty: q }),
                Op::FromWh(g, q) => Some(Command::Transfer { owner, from: Holder::Warehouse(LocId(0)), to: Holder::Fleet(fleet), good: GoodId(g), qty: q }),
                Op::Caravan(n) => Some(Command::FormCaravan { owner, at: LocId(0), animal: AnimalId(0), count: n }),
                Op::CarBuy(q) => w.caravans_of(owner).next().map(|c| Command::BuyInto { owner, holder: Holder::Caravan(c.id), good: GoodId(0), qty: q, max_total: None }),
                Op::CarTravel(d) => w.caravans_of(owner).next().map(|c| Command::CaravanTravel { owner, caravan: c.id, dest: LocId(d) }),
                Op::Margin(a) => Some(Command::DepositMargin { owner, exchange: ExchangeId(0), amount: a }),
                Op::Futures(s, l) => w.state.futures.contracts.values().filter(|c| c.spec == s && !c.settled).map(|c| c.id).next()
                    .map(|contract| Command::TradeFutures { owner, contract, lots: l }),
                Op::Physical(p) => w.state.futures.positions.iter().find(|(_, b)| b.contains_key(&owner)).map(|(id, _)| *id)
                    .map(|contract| Command::SetDelivery { owner, contract, physical: p }),
                Op::Deposit(a) => Some(Command::Deposit { owner, amount: a }),
                Op::Borrow(a) => Some(Command::Borrow { owner, amount: a, months: 2 }),
                Op::Invest(a) => Some(Command::InvestPort { owner, loc: LocId(0), amount: a }),
                Op::Build(r) => Some(Command::BuildIndustry { owner, loc: LocId(0), kind: IndustryTypeId(0), recipe: RecipeId(r) }),
            };
            if let Some(cmd) = cmd {
                let before = w.state_hash();
                let res = cmd.apply(&mut w);
                if res.is_err() {
                    prop_assert_eq!(w.state_hash(), before, "失败的命令不得改变状态");
                }
            }
            if let Err(e) = check_invariants(&w) { prop_assert!(false, "{}", e); }
            for f in w.state.fleets.values() {
                prop_assert!(f.ships.len() <= 5);
                if let FleetLocation::Docked(_) = f.location {
                    prop_assert!(f.used() <= f.capacity() || f.food + f.water > 0 || f.cargo_total() <= f.capacity());
                }
            }
        }
    }
}
