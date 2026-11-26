//! 日历消费端：真实月长的 testbed 与经典世界兼容。
use manifest_core::calendar::{Calendar, Date, Hemisphere, Season};
use manifest_core::captain::{Birthday, MonthDay};
use manifest_core::fixed::Fx;
use manifest_core::ledger::Account;
use manifest_core::log::LogKind;
use manifest_core::market::{Side, quote};
use manifest_core::*;
use std::path::PathBuf;
use std::sync::Arc;

fn defs() -> StaticData {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let mut d = (*manifest_data::load_world(&root, "testbed").unwrap()).clone();
    d.rules.crew_wage = 0;
    d.rules.production_noise_bp = 0;
    d.rules.seasonal_popular_bp = 0;
    d.rules.producers.enabled = false;
    d.rules.population.enabled = false;
    d.rules.workshops.enabled = false;
    d.rules.merchants.enabled = false;
    d.rules.money.enabled = false;
    d.rules.policies.enabled = false;
    d
}
fn world(d: StaticData) -> World {
    World::new(Arc::new(d), ScenarioId(0), 42).unwrap()
}
fn advance(w: &mut World, to: u32) {
    while w.day() < to {
        w.end_day().unwrap();
    }
}

#[test]
fn salary_interest_and_monthly_reports_follow_31_and_28_days() {
    let mut d = defs();
    let tiny = manifest_core::testkit::tiny_defs();
    d.mates = vec![tiny.mates[0].clone()];
    d.mates[0].home = LocId(0);
    let mut w = world(d);
    Command::HireMate { owner: OwnerId::Player, mate: MateId(0) }.apply(&mut w).unwrap();
    Command::Deposit { owner: OwnerId::Player, amount: 1000 }.apply(&mut w).unwrap();
    let salary = w.state.mates[&MateId(0)].salary;
    for (day, months) in [(30, 0), (31, 1), (58, 1), (59, 2), (90, 3)] {
        advance(&mut w, day);
        let a = w.agent(OwnerId::Player).unwrap();
        assert_eq!(a.ledger.balance(Account::Wages), salary * months);
        assert_eq!(a.ledger.monthly.len(), months as usize);
        assert_eq!(a.deposit > 1000, months > 0);
    }
    let a = w.agent(OwnerId::Player).unwrap();
    assert_eq!(a.ledger.monthly.iter().map(|r| r.index).collect::<Vec<_>>(), vec![0, 1, 2]);
}

#[test]
fn loans_use_calendar_months_and_clamp_the_anniversary() {
    for (start, due) in [(0, 31), (30, 58), (31, 59), (58, 86)] {
        let mut w = world(defs());
        advance(&mut w, start);
        let CommandOutcome::LoanTaken { loan } =
            (Command::Borrow { owner: OwnerId::Player, amount: 1000, months: 1 }).apply(&mut w).unwrap()
        else {
            panic!("贷款")
        };
        assert_eq!(w.state.loans[&loan].due_day, due);
        advance(&mut w, due);
        assert!(w.state.loans.contains_key(&loan));
        w.end_day().unwrap();
        assert!(!w.state.loans.contains_key(&loan));
    }
}

#[test]
fn futures_expire_at_real_month_ends_and_keep_three_listings() {
    let mut d = defs();
    let tiny = manifest_core::testkit::tiny_defs();
    d.exchanges = vec![tiny.exchanges[0].clone()];
    d.exchanges[0].port = LocId(0);
    d.futures_specs = vec![tiny.futures_specs[0].clone()];
    d.futures_specs[0].delivery = LocId(0);
    d.futures_specs[0].exchange = ExchangeId(0);
    d.futures_specs[0].good = GoodId(0);
    let mut w = world(d);
    let expiry =
        |w: &World| w.state.futures.contracts.values().filter(|c| !c.settled).map(|c| c.expiry_day).collect::<Vec<_>>();
    assert_eq!(expiry(&w), vec![30, 58, 89]);
    let feb = w.state.futures.contracts.values().find(|c| c.expiry_day == 58).unwrap().id;
    advance(&mut w, 30);
    assert_eq!(w.futures_quote(feb).unwrap().months_left, 1);
    advance(&mut w, 31);
    assert_eq!(expiry(&w), vec![58, 89, 119]);
    advance(&mut w, 59);
    assert_eq!(expiry(&w), vec![89, 119, 150]);
    assert!(w.state.futures.contracts[&feb].settled);
}

#[test]
fn birthday_and_zodiac_accept_january_31_but_reject_february_29() {
    let mut d = defs();
    d.captain = manifest_core::testkit::captain_defs().captain.clone();
    let mut w = world(d);
    let create = |month, day| Command::CreateCaptain {
        owner: OwnerId::Player,
        birthday: Birthday { year: w.defs.rules.world.start_year - 18, month, day },
        answers: vec!["plain".into(), "university".into(), "relative".into()],
        alloc: vec![0, 2, 0, 0, 3, 0],
        genius: None,
    };
    let bad = create(2, 29);
    let good = create(1, 31);
    assert!(bad.apply(&mut w).is_err());
    good.apply(&mut w).unwrap();
    advance(&mut w, 30);
    assert!(!w.state.log.iter().any(|e| matches!(e.kind, LogKind::Birthday { .. })));
    w.end_day().unwrap();
    assert!(w.state.log.iter().any(|e| e.day == 30 && matches!(e.kind, LogKind::Birthday { .. })));
    assert_eq!(w.defs.captain.zodiac_spans_in(&w.defs.calendar).iter().map(|(_, s)| s.days).sum::<u32>(), 365);
    assert!(MonthDay::new(1, 31).is_valid_in(&w.defs.calendar));
}

#[test]
fn southern_hemisphere_shifts_supply_demand_and_trade_quotes_two_seasons() {
    let mut d = defs();
    assert_eq!(d.locations[1].hemisphere, Hemisphere::South);
    d.goods[0].season_supply = [Fx::from_int(1), Fx::from_int(2), Fx::from_int(3), Fx::from_int(4)];
    d.goods[0].season_demand = d.goods[0].season_supply;
    let mut w = world(d);
    assert_eq!(w.season(), Season::Winter);
    let north = quote(&w, OwnerId::Player, LocId(0), GoodId(0), Side::Buy, 1).unwrap();
    let south = quote(&w, OwnerId::Player, LocId(1), GoodId(0), Side::Buy, 1).unwrap();
    assert!(north.price_before > south.price_before);
    w.end_day().unwrap();
    for (loc, expected) in [(LocId(0), Fx::from_int(4)), (LocId(1), Fx::from_int(2))] {
        let e = w.market(loc, GoodId(0)).unwrap();
        assert_eq!(e.flow.supply_mult, expected);
        assert_eq!(e.flow.season_demand, expected);
    }
    advance(&mut w, 59);
    assert_eq!(w.season(), Season::Spring);
}

#[test]
fn year_end_annual_caps_and_weather_follow_the_world_calendar() {
    let mut d = defs();
    d.composed.max_per_year = 1;
    d.composed.cooldown_days = 1;
    let mut w = world(d);
    w.state.events.history.push(manifest_core::events::EventRecord {
        kind: manifest_core::events::COMPOSED_KIND,
        day: 10,
        origin: manifest_core::events::EventOrigin::Composed { id: 1 },
    });
    advance(&mut w, 360);
    assert!(w.check_composed_schedule().unwrap_err().to_string().contains("今年已达上限"));
    assert!(w.agent(OwnerId::Player).unwrap().ledger.yearly.is_empty());
    advance(&mut w, 365);
    assert!(w.check_composed_schedule().is_ok());
    assert_eq!(w.agent(OwnerId::Player).unwrap().ledger.yearly.len(), 1);
    assert_eq!(w.defs.calendar.date_of(w.day()), Date { year: 2, month: 1, day: 1 });
    for day in [58, 59, 150, 151, 242, 243, 333, 334] {
        let weather = w.weather_on(RegionId(0), day).unwrap();
        let season = w.defs.calendar.season_of(day).index();
        assert_eq!(weather.sea.current_strength, w.defs.regions[0].seasons[season].current_strength);
    }
}

#[test]
fn calendars_with_other_month_counts_learn_a_complete_year() {
    let mut d = defs();
    d.calendar = Calendar::new(vec![3; 5], vec![0, 0, 1, 2, 3], "测试历".into(), vec![]).unwrap();
    d.rules.population.enabled = true;
    d.rules.producers.enabled = true;
    let mut w = world(d);
    advance(&mut w, 15);
    assert!(w.people(LocId(0)).unwrap().learned_in(5));
    assert!(w.market(LocId(0), GoodId(0)).unwrap().producer.learned_in(5));
    advance(&mut w, 30);
    assert_eq!(w.agent(OwnerId::Player).unwrap().ledger.yearly.len(), 2);
}
