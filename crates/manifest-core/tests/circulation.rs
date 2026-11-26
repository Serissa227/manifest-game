//! 第八批 E8：货币流通（docs/ECONOMY.md 6.9）在小型世界里的检查。
//! - 每笔钱都有来源和去向：各种操作之后，玩家、商会、交易所、城镇、国库、银行与腹地之和每天都等于开局的总额，
//!   经济月报里每类部门都满足“月初 + 流入 − 流出 = 月末”；
//! - 抽干一个港口：它的钱袋付不出时由腹地补缺口，流动性系数跌到下限，当地的买价下降；腹地收入慢慢把钱袋补回来，价格随之恢复；
//! - 国库亏空加税、富余减税（有界）并记日志；海军开支让本国港口所在海区的海盗少一些；占领殖民点要花国库的钱；
//! - 规则关闭时没有任何账户，报价不乘流动性系数，状态里没有这一节。

use manifest_core::circulation::{Sector, SectorKind, liquidity};
use manifest_core::defs::MoneyRules;
use manifest_core::log::LogKind;
use manifest_core::market::{Side, current_price, quote};
use manifest_core::testkit::{check_invariants, tiny_defs};
use manifest_core::treasury::Flow;
use manifest_core::world::FleetLocation;
use manifest_core::*;
use std::sync::Arc;

const ALPHA: LocId = LocId(0);
const BETA: LocId = LocId(1);
const GRAIN: GoodId = GoodId(0);
const CLOTH: GoodId = GoodId(1);
const SPICE: GoodId = GoodId(2);
const IRON: GoodId = GoodId(3);
/// alpha、gamma 与城市 delta 属于 0 号势力，beta 属于 1 号势力
const CROWN: FactionId = FactionId(0);
const LEAGUE: FactionId = FactionId(1);
const PLAYER: OwnerId = OwnerId::Player;

/// 小型世界：没有季节流行与随机事件；腹地收入按人均 `income` 金币 / 天（人口 25000）。
fn defs(enabled: bool, income: Fx) -> Arc<StaticData> {
    let mut d = (*tiny_defs()).clone();
    d.rules.seasonal_popular_bp = 0;
    for e in &mut d.events {
        e.max_per_year = 0;
    }
    d.rules.money = MoneyRules { enabled, income_per_capita: income, ..MoneyRules::default() };
    Arc::new(d)
}

fn player_fleet(w: &World) -> FleetId {
    w.fleets_of(PLAYER).next().unwrap().id
}

/// 测试布置：把玩家的舰队直接挪到某港（不涉及资金）。
fn dock(w: &mut World, f: FleetId, at: LocId) {
    w.state.fleets.get_mut(&f).unwrap().location = FleetLocation::Docked(at);
}

fn check_reports(w: &World) {
    for r in &w.state.circulation.reports {
        for s in &r.sectors {
            assert_eq!(s.opening + s.inflow - s.outflow, s.closing, "第 {} 月 {:?}", r.month, s.kind);
        }
        let total: Money = r.sectors.iter().map(|s| s.closing).sum();
        assert_eq!(total, w.state.circulation.initial, "第 {} 月各部门之和", r.month);
        for l in &r.flows {
            assert!(l.from != l.to && l.amount > 0, "{l:?}");
        }
    }
}

#[test]
fn every_payment_has_a_counterparty_and_all_accounts_sum_to_the_start() {
    let mut w = World::new(defs(true, Fx::from_bp(4_000)), ScenarioId(0), 5).unwrap();
    assert!(w.circulation_on());
    let c = &w.state.circulation;
    // 三个港口与内陆城市 delta 有钱袋，殖民点没有；开局钱袋 = 参照钱袋，流动性为 1
    assert_eq!(c.towns.len(), 4);
    assert!(c.towns.values().all(|p| p.money == p.reference && p.reference > 0 && p.liquidity == Fx::ONE));
    assert_eq!(c.treasuries.len(), 2);
    assert_eq!(w.all_money(), c.initial);
    let f = player_fleet(&w);
    let mut day = 0;
    let mut step = |w: &mut World, cmds: Vec<Command>| {
        for c in cmds {
            c.apply(w).unwrap_or_else(|e| panic!("第 {day} 天 {e:?}"));
        }
        w.end_day().unwrap();
        assert!(w.money_conserved(), "第 {day} 天全部账户之和变了");
        check_invariants(w).unwrap();
        day += 1;
    };
    let alpha_before = w.purse(ALPHA).unwrap().money;
    // 买货：钱进 alpha 的钱袋，税转进国库
    step(&mut w, vec![Command::Buy { owner: PLAYER, fleet: f, good: GRAIN, qty: 60, max_total: None }]);
    let flows = &w.state.circulation.flows;
    assert!(flows.iter().any(|l| l.flow == Flow::Market && l.from == SectorKind::Traders && l.to == SectorKind::Towns));
    assert!(flows.iter().any(|l| l.flow == Flow::Tax && l.from == SectorKind::Towns && l.to == SectorKind::Treasuries));
    assert!(w.purse(ALPHA).unwrap().money != alpha_before);
    // 补给、招募、修船、买船、改造、卖船：进停泊港的钱袋（先让船受点损伤，好修）
    w.state.fleets.get_mut(&f).unwrap().ships[0].durability -= 10;
    step(
        &mut w,
        vec![
            Command::Resupply { owner: PLAYER, fleet: f, food: 20, water: 20 },
            Command::HireCrew { owner: PLAYER, fleet: f, count: 4 },
            Command::Repair { owner: PLAYER, fleet: f },
            Command::BuyShip { owner: PLAYER, fleet: f, ship_type: ShipTypeId(0), new_fleet: false },
            Command::RefitShip { owner: PLAYER, fleet: f, ship: 1, refit: RefitId(0) },
            Command::SellShip { owner: PLAYER, fleet: f, ship: 1 },
        ],
    );
    // 银行：存取款、借款与还款经过银行的准备金
    let bank = w.state.circulation.bank;
    step(
        &mut w,
        vec![
            Command::Deposit { owner: PLAYER, amount: 5_000 },
            Command::Withdraw { owner: PLAYER, amount: 2_000 },
            Command::Borrow { owner: PLAYER, amount: 8_000, months: 6 },
        ],
    );
    assert_eq!(w.state.circulation.bank, bank + 5_000 - 2_000 - 8_000);
    let loan = *w.state.loans.keys().next().unwrap();
    step(&mut w, vec![Command::Repay { owner: PLAYER, loan, amount: 3_000 }]);
    // 仓库、港口投资
    step(
        &mut w,
        vec![
            Command::BuyWarehouse { owner: PLAYER, loc: ALPHA, capacity: 50 },
            Command::RentWarehouse { owner: PLAYER, loc: ALPHA, capacity: 100 },
            Command::InvestPort { owner: PLAYER, loc: ALPHA, amount: 10_000 },
        ],
    );
    // 到 beta 卖货：beta 的钱袋付钱
    dock(&mut w, f, BETA);
    let beta_before = w.purse(BETA).unwrap().money;
    step(&mut w, vec![Command::Sell { owner: PLAYER, fleet: f, good: GRAIN, qty: 60, min_total: None }]);
    assert!(w.purse(BETA).unwrap().money < beta_before + w.hinterland_income(BETA));
    // 之后照常过日子（工资、仓租、商会的买卖、月末的财政与月报）
    for _ in 0..200 {
        step(&mut w, vec![]);
    }
    check_reports(&w);
    assert!(w.state.circulation.reports.len() >= 6);
    let r = w.state.circulation.reports.last().unwrap();
    assert!(r.flows.iter().any(|l| l.flow == Flow::HinterlandIncome && l.from == SectorKind::Hinterland));
    assert!(r.flows.iter().any(|l| l.flow == Flow::Leak && l.to == SectorKind::Hinterland));
    assert!(
        r.flows.iter().any(|l| l.flow == Flow::Wages && l.from == SectorKind::Traders && l.to == SectorKind::Towns)
    );
    // 部门之间只有转账：商人从各部门净得到的，等于商人的钱比开局多出来的
    let traders_net: Money = w
        .state
        .circulation
        .reports
        .iter()
        .flat_map(|r| r.flows.iter())
        .chain(w.state.circulation.flows.iter())
        .map(|l| {
            if l.to == SectorKind::Traders {
                l.amount
            } else if l.from == SectorKind::Traders {
                -l.amount
            } else {
                0
            }
        })
        .sum();
    assert_eq!(traders_net, w.total_money() - w.state.money.initial);
}

/// 抽干 alpha：在 beta 买一船香料，到 alpha 卖掉，舰队再回 beta（船员的工资花在停泊港，留下会把钱袋撑到往常之上）。
/// 腹地收入小：alpha 的参照钱袋约 3000 金币；没有商会（它们的买卖会立刻把小钱袋填满或抽干），
/// 国库也不花钱（它的开支会流进小钱袋），只看腹地收入怎样把钱袋补回来。`enabled` 关掉时是对照组。
fn drained(enabled: bool) -> (World, Money) {
    let mut d = (*defs(enabled, Fx::from_bp(20))).clone();
    d.companies.clear();
    d.rules.money.spend_rate = Fx::ZERO;
    d.rules.money.catch_up_months = 1_000_000;
    let mut w = World::new(Arc::new(d), ScenarioId(0), 9).unwrap();
    let f = player_fleet(&w);
    dock(&mut w, f, BETA);
    Command::Buy { owner: PLAYER, fleet: f, good: SPICE, qty: 100, max_total: None }.apply(&mut w).unwrap();
    dock(&mut w, f, ALPHA);
    let sold = Command::Sell { owner: PLAYER, fleet: f, good: SPICE, qty: 100, min_total: None }.apply(&mut w).unwrap();
    let CommandOutcome::Traded(q) = sold else { panic!() };
    dock(&mut w, f, BETA);
    (w, q.gross)
}

fn iron(w: &World) -> Money {
    current_price(&w.defs, w.day(), IRON, w.market(ALPHA, IRON).unwrap())
}

fn sell_iron(w: &World) -> Money {
    quote(w, PLAYER, ALPHA, IRON, Side::Sell, 5).unwrap().gross
}

#[test]
fn a_drained_port_pays_less_then_recovers() {
    let (mut w, gross) = drained(true);
    let (mut control, _) = drained(false);
    // 卖掉一船香料：钱袋付到见底，余下的由腹地补上（记为缺口）
    let p = w.purse(ALPHA).unwrap();
    assert!(gross > p.reference && (2_000..5_000).contains(&p.reference), "参照钱袋 {}", p.reference);
    assert_eq!(p.money, 0);
    assert!(p.gaps > 0 && w.state.circulation.shortfall == p.gaps);
    assert!(w.money_conserved());
    // 次日：流动性系数跌到下限；铁（库存没动）的报价与卖给市场的所得都比对照组低约两成
    w.end_day().unwrap();
    control.end_day().unwrap();
    let l1 = w.purse(ALPHA).unwrap().liquidity;
    assert_eq!(l1, w.defs.rules.money.liquidity_floor);
    assert_eq!(w.market(ALPHA, IRON).unwrap().liquidity, l1);
    assert_eq!(w.market(ALPHA, IRON).unwrap().stock, control.market(ALPHA, IRON).unwrap().stock);
    assert!(iron(&w) * 100 < iron(&control) * 88, "铁价 {} / 对照 {}", iron(&w), iron(&control));
    assert!(
        sell_iron(&w) * 100 < sell_iron(&control) * 88,
        "卖五件铁 {} / 对照 {}",
        sell_iron(&w),
        sell_iron(&control)
    );
    // 没有来往的 gamma 不受影响（beta 刚卖出一船香料，钱袋鼓了）
    assert!(w.purse(LocId(2)).unwrap().liquidity >= Fx::from_bp(9_990));
    assert!(w.purse(BETA).unwrap().liquidity > Fx::ONE);
    // 腹地收入把钱袋慢慢补回来：流动性逐月回升，八个月后价格回到对照组的水平附近
    let mut monthly = vec![l1];
    for d in 1..=240 {
        w.end_day().unwrap();
        control.end_day().unwrap();
        assert!(w.money_conserved());
        if d % 30 == 0 {
            monthly.push(w.purse(ALPHA).unwrap().liquidity);
        }
    }
    assert!(monthly[..5].windows(2).all(|x| x[0] < x[1]), "{monthly:?}");
    let last = *monthly.last().unwrap();
    assert!(last >= Fx::from_pct(97), "流动性 {last:?}");
    let (p2, c2) = (iron(&w), iron(&control));
    assert!((p2 - c2).abs() * 100 <= c2 * 3, "铁价 {p2} / 对照 {c2}；流动性 {monthly:?}");
}

#[test]
fn liquidity_is_the_fifth_root_of_the_purse_ratio_within_bounds() {
    let r = MoneyRules::default();
    assert_eq!(liquidity(&r, 1_000, 1_000), Fx::ONE);
    assert_eq!(liquidity(&r, 0, 1_000), r.liquidity_floor);
    assert_eq!(liquidity(&r, 10_000, 1_000), r.liquidity_cap);
    // 0.5^(1/5) ≈ 0.8706，2^(1/5) ≈ 1.1487
    assert!((liquidity(&r, 500, 1_000).raw() - 8_706).abs() <= 1);
    assert!((liquidity(&r, 2_000, 1_000).raw() - 11_487).abs() <= 1);
    // 单调
    let mut last = Fx::ZERO;
    for m in (0..4_000).step_by(50) {
        let l = liquidity(&r, m, 1_000);
        assert!(l >= last);
        last = l;
    }
}

/// 测试布置：国库与腹地之间挪一笔钱（两边反向，守恒不变）。
fn shift_treasury(w: &mut World, f: FactionId, delta: Money) {
    w.state.circulation.treasuries.get_mut(&f).unwrap().money += delta;
    w.state.circulation.hinterland -= delta;
}

fn to_month_end(w: &mut World) {
    loop {
        let month_end = calendar::is_month_end(w.day());
        w.end_day().unwrap();
        if month_end {
            break;
        }
    }
}

#[test]
fn a_treasury_in_deficit_raises_taxes_and_a_surplus_cuts_them() {
    let mut w = World::new(defs(true, Fx::from_bp(4_000)), ScenarioId(0), 11).unwrap();
    let base = market::tax_rate(&w, PLAYER, BETA);
    // 亏空：月末加税一步，记日志；交易税随之上调
    let money = w.treasury(LEAGUE).unwrap().money;
    shift_treasury(&mut w, LEAGUE, -money - 50_000);
    to_month_end(&mut w);
    let t = w.treasury(LEAGUE).unwrap();
    assert_eq!(t.tax_mult, Fx::from_pct(105));
    assert!(
        w.state
            .log
            .iter()
            .any(|e| matches!(e.kind, LogKind::FiscalTax { faction, raised: true, .. } if faction == LEAGUE))
    );
    assert_eq!(market::tax_rate(&w, PLAYER, BETA), base.mul(Fx::from_pct(105)));
    // 一直亏空：每月一步，最多到上限
    for _ in 0..8 {
        to_month_end(&mut w);
    }
    assert_eq!(w.treasury(LEAGUE).unwrap().tax_mult, w.defs.rules.money.tax_max);
    assert!(w.money_conserved());
    // 富余（余额超过一年的收入）：减税，最低到下限
    shift_treasury(&mut w, LEAGUE, 5_000_000);
    let before = w.treasury(LEAGUE).unwrap().tax_mult;
    to_month_end(&mut w);
    let after = w.treasury(LEAGUE).unwrap().tax_mult;
    assert!(after < before);
    assert!(
        w.state
            .log
            .iter()
            .any(|e| matches!(e.kind, LogKind::FiscalTax { faction, raised: false, .. } if faction == LEAGUE))
    );
    for _ in 0..20 {
        to_month_end(&mut w);
    }
    assert!(w.treasury(LEAGUE).unwrap().tax_mult >= w.defs.rules.money.tax_min);
    assert!(w.money_conserved());
}

#[test]
fn navy_spending_keeps_pirates_away_and_public_works_raise_development() {
    let mut w = World::new(defs(true, Fx::from_bp(4_000)), ScenarioId(0), 13).unwrap();
    let region = RegionId(0);
    let before = w.pirate_spawn_bp(region);
    // 国库充裕：月末的预算一半公共工程、一半海军
    shift_treasury(&mut w, CROWN, 2_000_000);
    to_month_end(&mut w);
    let t = w.treasury(CROWN).unwrap();
    assert!(t.patrol > Fx::ZERO);
    assert!(w.navy_pirate_mult(region) < Fx::ONE);
    assert!(w.pirate_spawn_bp(region) < before);
    let r = w.state.circulation.reports.last().unwrap();
    assert!(
        r.flows.iter().any(|l| l.flow == Flow::Navy && l.from == SectorKind::Treasuries && l.to == SectorKind::Towns)
    );
    assert!(r.flows.iter().any(|l| l.flow == Flow::PublicWorks && l.to == SectorKind::Towns));
    // 公共工程：本国港口的发展度比开局高了，最多高 works_cap 点
    let cap = w.defs.rules.money.works_cap;
    let raised: Vec<i64> =
        [ALPHA, LocId(2)].iter().map(|l| w.state.locations[l.idx()].development - w.defs.loc(*l).development).collect();
    assert!(raised.iter().any(|d| *d > 0) && raised.iter().all(|d| *d <= cap), "{raised:?}");
    assert!(w.money_conserved());
    // 开关关闭时没有海军的效果
    let off = World::new(defs(false, Fx::from_bp(4_000)), ScenarioId(0), 13).unwrap();
    assert_eq!(off.navy_pirate_mult(region), Fx::ONE);
}

#[test]
fn switched_off_there_are_no_accounts_and_prices_ignore_liquidity() {
    let mut w = World::new(defs(false, Fx::from_bp(4_000)), ScenarioId(0), 5).unwrap();
    assert!(!w.circulation_on());
    let f = player_fleet(&w);
    Command::Buy { owner: PLAYER, fleet: f, good: CLOTH, qty: 5, max_total: None }.apply(&mut w).unwrap();
    for _ in 0..40 {
        w.end_day().unwrap();
    }
    let c = &w.state.circulation;
    assert!(c.towns.is_empty() && c.treasuries.is_empty() && c.reports.is_empty() && c.flows.is_empty());
    assert!(w.state.locations.iter().flat_map(|l| l.market.values()).all(|e| e.liquidity == Fx::ONE));
    assert!(w.money_conserved());
    let json = serde_json::to_string(&w.state).unwrap();
    assert!(!json.contains("\"circulation\"") && !json.contains("\"liquidity\""));
    assert_eq!(w.town_sector(ALPHA), Sector::Hinterland);
}
