//! T02 的内核测试：分红的三个上限与按比例分、守恒；遭劫的折损、商馆够级少损、等级重算、存档往返；
//! 船厂随发展度的清单；商会跟投走玩家同一条投资命令；内陆城市的货档门槛；开关关着时什么都不变。

use super::*;
use crate::ids::{CompanyId, ShipTypeId};
use crate::testkit::tiny_defs;
use crate::world::World;
use std::sync::Arc;

const P: OwnerId = OwnerId::Player;
const C0: OwnerId = OwnerId::Company(CompanyId(0));
const ALPHA: LocId = LocId(0);
const BETA: LocId = LocId(1);
const DELTA: LocId = LocId(3);

/// 打开货币流通与分红（另可打开商馆规则）的小型世界。
fn defs_with(access: bool) -> crate::defs::StaticData {
    let mut d = (*tiny_defs()).clone();
    d.rules.money.enabled = true;
    d.rules.dividends.enabled = true;
    d.rules.access.enabled = access;
    d
}

fn world(d: crate::defs::StaticData) -> World {
    World::new(Arc::new(d), crate::ids::ScenarioId(0), 7).unwrap()
}

/// 第一个月初（第 0 天之后头一个 1 日）。
fn first_month_start(w: &World) -> u32 {
    (1..400).find(|d| w.defs.calendar.month_start(*d)).unwrap()
}

fn cash(w: &World, o: OwnerId) -> Money {
    w.state.agents[&o].cash
}

/// 改现金时把差额记进开局总额（守恒检查才对得上）。
fn give_cash(w: &mut World, owner: OwnerId, money: Money) {
    let a = w.state.agents.get_mut(&owner).unwrap();
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

fn set_purse(w: &mut World, loc: LocId, money: Money) {
    // 钱袋的余额改动要记进开局总额，守恒检查才对得上
    let p = w.state.circulation.towns.get_mut(&loc).unwrap();
    let delta = money - p.money;
    p.money = money;
    w.state.circulation.initial += delta;
}

#[test]
fn dividends_pay_what_is_due_when_no_cap_binds_and_conserve_money() {
    let mut w = world(defs_with(false));
    w.state.day = first_month_start(&w);
    w.state.locations[ALPHA.idx()].investments.insert(P, 100_000);
    w.state.locations[ALPHA.idx()].investments.insert(C0, 50_000);
    set_purse(&mut w, ALPHA, 10_000_000);
    assert!(w.money_conserved());
    // 发展度 50：深度系数 1.0；应得 = 累计 × 6% ÷ 12
    assert_eq!(dividend_due(&w.defs, 100_000, 50), 500);
    let hint = mul_div(w.hinterland_income(ALPHA) * i64::from(w.defs.calendar.month_days(w.state.day - 1)), 10, 100);
    assert!(hint >= 750, "这个世界的腹地上限要够大，测试的前提：{hint}");
    let (p0, c0) = (cash(&w, P), cash(&w, C0));
    w.dividends_month_start().unwrap();
    assert_eq!(cash(&w, P) - p0, 500);
    assert_eq!(cash(&w, C0) - c0, 250);
    let r = &w.state.house.dividends[&ALPHA];
    assert_eq!((r.due, r.paid, r.cap), (750, 750, DividendCap::None));
    assert_eq!(w.purse(ALPHA).unwrap().money, 10_000_000 - 750);
    assert!(w.money_conserved(), "分红从城镇钱袋付给投资者，守恒");
    assert_eq!(w.state.money.sources.get(&Flow::HouseDividend), Some(&750));
    // 一条汇总日志
    let logs: Vec<_> = w.state.log.iter().filter(|e| matches!(e.kind, LogKind::HouseDividends { .. })).collect();
    assert_eq!(logs.len(), 1);
    assert!(matches!(logs[0].kind, LogKind::HouseDividends { total: 750, ports: 1, player: 500, .. }));
    // 收入记在“商馆分红”科目
    assert_eq!(w.state.agents[&P].ledger.balance(Account::HouseDividends), -500);
    crate::testkit::check_invariants(&w).unwrap();
}

#[test]
fn dividends_are_capped_by_the_purse_and_split_pro_rata_rounding_down() {
    let mut w = world(defs_with(false));
    w.state.day = first_month_start(&w);
    w.state.locations[ALPHA.idx()].investments.insert(P, 100_000);
    w.state.locations[ALPHA.idx()].investments.insert(C0, 50_000);
    // 钱袋只剩 301：按 500 : 250 分，向下取整（200、100），零头 1 留在钱袋
    set_purse(&mut w, ALPHA, 301);
    let (p0, c0) = (cash(&w, P), cash(&w, C0));
    w.dividends_month_start().unwrap();
    assert_eq!(cash(&w, P) - p0, 200);
    assert_eq!(cash(&w, C0) - c0, 100);
    let r = &w.state.house.dividends[&ALPHA];
    assert_eq!((r.due, r.paid, r.cap), (750, 300, DividendCap::Purse));
    assert_eq!(w.purse(ALPHA).unwrap().money, 1);
    assert!(w.money_conserved());
}

#[test]
fn dividends_are_capped_by_a_tenth_of_the_hinterland_income() {
    let mut w = world(defs_with(false));
    w.state.day = first_month_start(&w);
    let days = i64::from(w.defs.calendar.month_days(w.state.day - 1));
    let hint = mul_div(w.hinterland_income(ALPHA) * days, 10, 100);
    // 投得极多：应得远超腹地上限；钱袋足够
    w.state.locations[ALPHA.idx()].investments.insert(P, 1_000_000_000);
    w.state.locations[ALPHA.idx()].investments.insert(C0, 1_000_000_000);
    set_purse(&mut w, ALPHA, 1_000_000_000);
    let (p0, c0) = (cash(&w, P), cash(&w, C0));
    w.dividends_month_start().unwrap();
    let r = w.state.house.dividends[&ALPHA].clone();
    assert_eq!(r.cap, DividendCap::Hinterland);
    assert!(r.paid <= hint && r.paid >= hint - 1, "{} 对 {hint}", r.paid);
    assert_eq!(cash(&w, P) - p0, cash(&w, C0) - c0, "累计投资相同，分得相同");
    assert!(w.money_conserved());
    // 三个上限：不超过应得、腹地、钱袋
    assert!(r.paid <= r.due && r.paid <= hint);
}

#[test]
fn dividends_only_on_the_first_of_the_month_and_not_with_the_rule_off() {
    // 规则关闭：月初也没有分红，状态里不多出字段
    let mut d = defs_with(false);
    d.rules.dividends.enabled = false;
    let mut w = world(d);
    w.state.day = first_month_start(&w);
    w.state.locations[ALPHA.idx()].investments.insert(P, 100_000);
    let p0 = cash(&w, P);
    w.dividends_month_start().unwrap();
    assert_eq!(cash(&w, P), p0);
    assert!(w.state.house.is_empty());
    let json = serde_json::to_value(&w.state).unwrap();
    assert!(json.get("house").is_none(), "空状态不写进存档");
    // 规则打开、但不是月初
    let mut w = world(defs_with(false));
    w.state.day = first_month_start(&w) + 1;
    w.state.locations[ALPHA.idx()].investments.insert(P, 100_000);
    let p0 = cash(&w, P);
    w.dividends_month_start().unwrap();
    assert_eq!(cash(&w, P), p0);
    // 规则打开、货币流通关闭：没有钱袋，不分
    let mut d = defs_with(false);
    d.rules.money.enabled = false;
    let mut w = world(d);
    w.state.day = 30;
    w.state.locations[ALPHA.idx()].investments.insert(P, 100_000);
    let p0 = cash(&w, P);
    w.dividends_month_start().unwrap();
    assert_eq!(cash(&w, P), p0);
}

#[test]
fn dividends_settle_by_themselves_through_the_daily_tick() {
    let mut w = world(defs_with(true));
    w.state.locations[ALPHA.idx()].investments.insert(P, 20_000);
    let target = first_month_start(&w);
    let mut got = 0;
    let mut want = 0;
    while w.state.day <= target {
        let today = w.state.day;
        let before = w.state.agents[&P].ledger.balance(Account::HouseDividends);
        w.end_day().unwrap();
        if today == target {
            // 发展度在这一个月里随人口规则会动，按结算那天的发展度算应得
            want = dividend_due(&w.defs, 20_000, w.state.locations[ALPHA.idx()].development);
        }
        got += before - w.state.agents[&P].ledger.balance(Account::HouseDividends);
        assert!(w.money_conserved(), "第 {} 天", w.state.day);
    }
    assert!((100..=110).contains(&want), "2 万 × 6% ÷ 12 × 深度系数（发展度 50 上下）：{want}");
    assert_eq!(got, want);
}

#[test]
fn sacking_halves_investments_spares_big_houses_and_recomputes_levels() {
    let mut w = world(defs_with(true));
    w.state.day = 40;
    // alpha 初始发展度 50：商馆门槛 5k / 15k / 45k / 135k
    w.state.locations[ALPHA.idx()].investments.insert(P, 50_001);
    w.state.locations[ALPHA.idx()].investments.insert(C0, 10_001);
    w.state.locations[ALPHA.idx()].investments.insert(OwnerId::Company(CompanyId(1)), 1);
    assert_eq!(w.house_level(P, ALPHA), 3);
    assert_eq!(w.house_level(C0, ALPHA), 1);
    w.sack_port(ALPHA);
    let inv = &w.state.locations[ALPHA.idx()].investments;
    // 3 级商馆只损四分之一（向下取整保留）；其余减半；1 金币的减到 0、不留空条目
    assert_eq!(inv[&P], 37_500);
    assert_eq!(inv[&C0], 5_000);
    assert!(!inv.contains_key(&OwnerId::Company(CompanyId(1))));
    assert_eq!(w.house_level(P, ALPHA), 2, "掉级");
    assert_eq!(w.house_level(C0, ALPHA), 1);
    let s = w.recent_sack(ALPHA).unwrap();
    assert_eq!((s.day, s.loss_of(P), s.loss_of(C0)), (40, 12_501, 5_001));
    assert!(
        w.state
            .log
            .iter()
            .any(|e| matches!(e.kind, LogKind::HouseSacked { loc: ALPHA, player: 12_501, investors: 3, .. }))
    );
    // 同一天再来一次不重复折损
    w.sack_port(ALPHA);
    assert_eq!(w.state.locations[ALPHA.idx()].investments[&P], 37_500);
    // 存档往返
    let json = serde_json::to_string(&w.state).unwrap();
    let back: crate::world::WorldState = serde_json::from_str(&json).unwrap();
    assert_eq!(back.house, w.state.house);
    assert_eq!(back.locations[ALPHA.idx()].investments, w.state.locations[ALPHA.idx()].investments);
    // 过了提醒的日子不再提
    w.state.day = 40 + w.defs.rules.dividends.sack_notice_days;
    assert!(w.recent_sack(ALPHA).is_none());
    // 投资没有动钱：守恒
    assert!(w.money_conserved());
}

#[test]
fn sacking_does_nothing_with_the_rule_off() {
    let mut d = defs_with(true);
    d.rules.dividends.enabled = false;
    let mut w = world(d);
    w.state.locations[ALPHA.idx()].investments.insert(P, 50_000);
    w.sack_port(ALPHA);
    assert_eq!(w.state.locations[ALPHA.idx()].investments[&P], 50_000);
    assert!(w.state.house.is_empty());
}

/// 三档船：sloop 6,000（第 0 档）、hauler 15,000（第 2 档）、galleon 40,000（第 3 档）；alpha 只造 sloop。
fn yard_defs(enabled: bool) -> crate::defs::StaticData {
    let mut d = (*tiny_defs()).clone();
    let mut galleon = d.ships[1].clone();
    galleon.key = "galleon".into();
    galleon.price = 40_000;
    d.ships.push(galleon);
    d.locations[ALPHA.idx()].shipyard = vec![ShipTypeId(0)];
    d.rules.shipyard_growth.enabled = enabled;
    d.rules.shipyard_growth.lines = vec![ShipLine {
        key: "west".into(),
        ships: vec!["sloop".into(), "hauler".into(), "galleon".into()],
        cultures: Vec::new(),
        ids: vec![ShipTypeId(0), ShipTypeId(1), ShipTypeId(2)],
        foreign: Vec::new(),
        foreign_ids: Vec::new(),
    }];
    d
}

#[test]
fn shipyards_build_bigger_ships_as_the_port_develops() {
    let d = yard_defs(true);
    let r = &d.rules.shipyard_growth;
    assert_eq!((r.tier(6_000), r.tier(15_000), r.tier(40_000)), (0, 2, 3));
    // alpha 造到第 0 档：65 起多造到第 1 档（这一系没有第 1 档的船），80 起到第 2 档
    assert_eq!(shipyard_at(&d, ALPHA, 64), vec![ShipTypeId(0)]);
    assert_eq!(shipyard_at(&d, ALPHA, 65), vec![ShipTypeId(0)]);
    assert_eq!(shipyard_at(&d, ALPHA, 80), vec![ShipTypeId(0), ShipTypeId(1)]);
    // beta 造到第 2 档（hauler）：65 起加第 3 档
    assert_eq!(shipyard_at(&d, BETA, 64), vec![ShipTypeId(0), ShipTypeId(1)]);
    assert_eq!(shipyard_at(&d, BETA, 65), vec![ShipTypeId(0), ShipTypeId(1), ShipTypeId(2)]);
    assert_eq!(shipyard_upcoming(&d, ALPHA), vec![(ShipTypeId(1), 80)]);
    assert_eq!(shipyard_upcoming(&d, BETA), vec![(ShipTypeId(2), 65)]);
    // 没有船厂的地点不长出船厂
    assert!(shipyard_at(&d, DELTA, 100).is_empty());
    // 内核的买船命令跟着清单走
    let mut w = world_from(d);
    give_cash(&mut w, P, 1_000_000);
    let found = |w: &mut World| Command::FoundFleet { owner: P, at: BETA, ship_type: ShipTypeId(2) }.apply(w);
    w.state.locations[BETA.idx()].development = 64;
    assert!(found(&mut w).is_err());
    w.state.locations[BETA.idx()].development = 65;
    assert!(found(&mut w).is_ok());
    assert!(w.money_conserved());
}

fn world_from(d: crate::defs::StaticData) -> World {
    World::new(Arc::new(d), crate::ids::ScenarioId(0), 7).unwrap()
}

#[test]
fn shipyards_stay_as_authored_with_the_rule_off() {
    let d = yard_defs(false);
    for dev in [1, 50, 65, 80, 100] {
        assert_eq!(shipyard_at(&d, ALPHA, dev), vec![ShipTypeId(0)]);
        assert_eq!(shipyard_at(&d, BETA, dev), vec![ShipTypeId(0), ShipTypeId(1)]);
    }
    assert!(shipyard_upcoming(&d, ALPHA).is_empty());
    let mut w = world_from(d);
    give_cash(&mut w, P, 1_000_000);
    w.state.locations[BETA.idx()].development = 100;
    assert!(Command::FoundFleet { owner: P, at: BETA, ship_type: ShipTypeId(2) }.apply(&mut w).is_err());
}

#[test]
fn a_culture_listed_on_a_line_joins_it_from_the_yards_top_tier() {
    let mut d = yard_defs(true);
    d.locations[ALPHA.idx()].culture = "isle".into();
    // 另一系只有 galleon，只认文化圈 isle：alpha 造到第 0 档，80 起取到第 2 档——galleon 是第 3 档，取不到
    d.rules.shipyard_growth.lines = vec![ShipLine {
        key: "isle".into(),
        ships: vec!["galleon".into()],
        cultures: vec!["isle".into()],
        ids: vec![ShipTypeId(2)],
        foreign: Vec::new(),
        foreign_ids: Vec::new(),
    }];
    assert_eq!(shipyard_at(&d, ALPHA, 100), vec![ShipTypeId(0)]);
    d.rules.shipyard_growth.steps = vec![40, 50, 60];
    assert_eq!(shipyard_at(&d, ALPHA, 60), vec![ShipTypeId(0), ShipTypeId(2)]);
}

#[test]
fn companies_invest_their_surplus_through_the_players_command() {
    let mut d = defs_with(true);
    d.rules.npc_invest.enabled = true;
    let mut w = world(d);
    let day = first_month_start(&w);
    // 上个月的月报：开支为 0 → 储备线只剩商会自己的储备
    for a in w.state.agents.values_mut() {
        a.ledger.close_month(day - 1);
    }
    w.state.day = day;
    give_cash(&mut w, C0, 400_000);
    let home = w.state.agents[&C0].home;
    crate::house::note_turnover(&mut w, C0, BETA, 9_000);
    crate::house::note_turnover(&mut w, C0, ALPHA, 1_000);
    let (h0, b0) = (w.invested(C0, home), w.invested(C0, BETA));
    w.npc_invest_step().unwrap();
    // 储备线不低于商会自己的储备（本据船厂最贵的船 15,000 × 3）：(400,000 − 45,000) × 5% = 17,750，
    // 投进本据港或上月成交额最高的 beta（别的商会也各自投了自己的，这里只看 C0）
    assert_eq!(cash(&w, C0), 400_000 - 17_750);
    let target = if w.invested(C0, BETA) > b0 { BETA } else { home };
    let gained = w.invested(C0, target) - if target == BETA { b0 } else { h0 };
    assert_eq!(gained, 17_750);
    assert!(w.money_conserved(), "投资进城镇钱袋，守恒");
    // 走的是玩家同一条投资：发展度涨了、商馆等级算得出
    assert!(w.state.locations[target.idx()].development > w.defs.loc(target).development);
    assert_eq!(w.house_level(C0, target), 2);
    // 成交额每月清空
    assert!(w.state.house.turnover.is_empty());
}

#[test]
fn companies_keep_their_reserve_and_do_nothing_with_the_rule_off() {
    let mut d = defs_with(true);
    d.rules.npc_invest.enabled = false;
    let mut w = world(d);
    let day = first_month_start(&w);
    for a in w.state.agents.values_mut() {
        a.ledger.close_month(day - 1);
    }
    w.state.day = day;
    give_cash(&mut w, C0, 400_000);
    crate::house::note_turnover(&mut w, C0, BETA, 9_000);
    assert!(w.state.house.turnover.is_empty(), "关着时不记成交额");
    w.npc_invest_step().unwrap();
    assert_eq!(cash(&w, C0), 400_000);
    // 打开、但还没有月报（开局第一个月）：不投
    let mut d = defs_with(true);
    d.rules.npc_invest.enabled = true;
    let mut w = world(d);
    w.state.day = first_month_start(&w);
    give_cash(&mut w, C0, 400_000);
    w.npc_invest_step().unwrap();
    assert_eq!(cash(&w, C0), 400_000);
}

#[test]
fn inland_cities_use_their_own_lower_rank_thresholds() {
    let mut d = (*tiny_defs()).clone();
    d.rules.access.enabled = true;
    d.rules.access.floor_goods = 0;
    d.rules.access.inland_goodwill = Some(vec![0, 10, 25, 40]);
    d.goods[2].rank = 3; // 香料：珍货
    let mut w = world_from(d);
    let f = w.location_faction(DELTA);
    assert_eq!(f, w.location_faction(ALPHA));
    w.state.agents.get_mut(&P).unwrap().reputation.insert(f, 40);
    let spice = GoodId(2);
    // 内陆城市：声望 40 就够第 3 档
    assert_eq!(w.rank_gate(P, DELTA, spice), None);
    // 港口仍是原门槛 60
    assert_eq!(w.rank_gate(P, ALPHA, spice).map(|g| g.need), Some(60));
    w.state.agents.get_mut(&P).unwrap().reputation.insert(f, 39);
    assert_eq!(w.rank_gate(P, DELTA, spice).map(|g| g.need), Some(40));
}
