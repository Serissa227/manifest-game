//! 第八批 E6：信息时效（docs/ECONOMY.md 第 7 节）在应用层的视图——远方港口的行情写明时效与来源、
//! 行情序列截到快照日之前（工作台以快照日为起点、期限可以多出过时的天数）、远方问不到现价、
//! 预测簿只给玩家已经知道的日子（记下时已经过去的日子只补收盘价），以及实时模式（经典）照旧。

use manifest_ai::{AiMode, MemoryKeyStore};
use manifest_app::forecast::{ForecastPoint, ForecastSpec, PinRequest};
use manifest_app::handlers::{self, QuoteRequest};
use manifest_app::{AppError, AppPaths, AppState};
use manifest_core::info::InfoMode;
use manifest_core::{Command, FleetId, LocId, OwnerId};
use std::path::Path;
use std::sync::Arc;

fn app(dir: &Path) -> AppState {
    std::fs::create_dir_all(dir).unwrap();
    let data = manifest_data::find_data_dir().expect("找到 data/");
    let st = AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(dir)).unwrap();
    let mut settings = handlers::get_settings(&st).settings;
    settings.ai.mode = AiMode::Off;
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings).unwrap();
    st
}

/// 随船传递的新游戏：返回开局港口与离它最近的另一处港口。
fn carried_game(st: &AppState, seed: u64) -> (u16, u16) {
    handlers::new_game(st, "newcomer", Some(seed)).unwrap();
    let r = handlers::submit(st, Command::SetInfoMode { owner: OwnerId::Player, mode: InfoMode::Carried }).unwrap();
    assert_eq!(r.overview.info_mode, "carried");
    let start = handlers::overview(st).unwrap().fleets[0].docked.expect("开局停在港口");
    let locs = handlers::static_data(st).locations;
    let at = locs.iter().find(|l| l.id == start).unwrap();
    let dist = |l: &&manifest_app::views::LocView| {
        let (dx, dy) = (l.x as i64 - at.x as i64, l.y as i64 - at.y as i64);
        dx * dx + dy * dy
    };
    let near = locs.iter().filter(|l| l.kind == "port" && l.id != start).min_by_key(dist).unwrap().id;
    (start, near)
}

/// 补足 40 天的粮水再出航（每 20 名船员每天一份粮一份水）。
fn sail(st: &AppState, dest: u16) {
    let f = handlers::overview(st).unwrap().fleets[0].clone();
    let need = (f.crew / 20 + 1) * 40;
    let (food, water) = ((need - f.food).max(0), (need - f.water).max(0));
    if food + water > 0 {
        let cmd = Command::Resupply { owner: OwnerId::Player, fleet: FleetId(f.id), food, water };
        handlers::submit(st, cmd).unwrap();
    }
    handlers::submit(st, Command::SetSail { owner: OwnerId::Player, fleet: FleetId(f.id), dest: LocId(dest) }).unwrap();
}

fn step_until_docked(st: &AppState, dest: u16) {
    for _ in 0..90 {
        if handlers::overview(st).unwrap().fleets[0].docked == Some(dest) {
            return;
        }
        handlers::step(st, 1).unwrap();
    }
    panic!("没有抵达 {dest}");
}

fn quote(st: &AppState, loc: u16, good: u16) -> Result<manifest_core::market::TradeQuote, AppError> {
    handlers::quote(st, QuoteRequest { loc, good, side: "buy".into(), qty: 1 })
}

/// 朴素法的请求：起点是序列的最后收盘日。
fn naive(st: &AppState, loc: u16, good: u16, horizon: u32) -> PinRequest {
    let s = handlers::market_series(st, loc, good).unwrap();
    let last = *s.daily.last().unwrap();
    let path = (1..=horizon as i64)
        .map(|h| {
            let w = (last / 20).max(1) * h;
            ForecastPoint {
                mean: last,
                lo80: (last - w).max(0),
                hi80: last + w,
                lo95: (last - 2 * w).max(0),
                hi95: last + 2 * w,
            }
        })
        .collect();
    PinRequest {
        loc,
        good,
        origin: s.last_close.unwrap(),
        horizon,
        spec: ForecastSpec {
            method: "naive".into(),
            params: Default::default(),
            window: 30,
            log: false,
            seasonal: false,
            excluded: vec![],
            interval: "formula".into(),
            intervention: None,
        },
        fitted_on: s.daily.iter().rev().take(30).rev().copied().collect(),
        path,
        revises: None,
        basis: None,
    }
}

#[test]
fn distant_prices_carry_their_age_and_cannot_be_quoted() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let (start, near) = carried_game(&st, 5);
    handlers::step(&st, 20).unwrap();
    // 在港：实时的，没有时效；可以买行情通报（告示板上有什么就卖什么）
    let here = handlers::port(&st, start).unwrap();
    assert!(here.known && here.seen.is_none());
    assert!(here.report.is_some());
    let good = here.market[0].good;
    assert!(quote(&st, start, good).is_ok());
    let left = handlers::overview(&st).unwrap().day;
    let before = handlers::market_series(&st, start, good).unwrap();
    sail(&st, near);
    step_until_docked(&st, near);
    let today = handlers::overview(&st).unwrap().day;
    let age = today - left;
    assert!(age > 0);
    // 离开的港口：写明几天前、自己到过；价格与日线是离开时的；远方问不到现价
    let away = handlers::port(&st, start).unwrap();
    assert!(away.known && away.report.is_none());
    let seen = away.seen.clone().expect("远方港口的行情有时效");
    assert_eq!((seen.day, seen.age, seen.source), (left, age, "visit"));
    let row = away.market.iter().find(|r| r.good == good).unwrap();
    assert_eq!(row.history, before.daily, "日线截到离开那天之前");
    let Err(AppError::Invalid(m)) = quote(&st, start, good) else { panic!("远方问不到现价") };
    assert_eq!(m.key, "app.not_here");
    // 行情序列：起点是离开前的最后收盘，没有本地生产者与商人的内情；写明到那里的航程
    let s = handlers::market_series(&st, start, good).unwrap();
    assert_eq!(s.last_close, Some(left - 1));
    assert_eq!(s.daily, before.daily);
    assert_eq!(s.seen, Some(seen));
    assert!(s.voyage_days.is_some_and(|d| d > 0));
    assert!(s.merchants.is_none() && s.producer.is_none());
    // 到了的港口：实时的
    let there = handlers::port(&st, near).unwrap();
    assert!(there.known && there.seen.is_none() && there.report.is_some());
    assert!(quote(&st, near, there.market[0].good).is_ok());
    // 什么消息都没有的港口：不知道行情
    let unknown = handlers::static_data(&st)
        .locations
        .iter()
        .map(|l| l.id)
        .find(|l| handlers::port(&st, *l).map(|p| !p.known).unwrap_or(false))
        .expect("有不知道行情的港口");
    assert!(handlers::port(&st, unknown).unwrap().market.is_empty());
    assert!(matches!(handlers::market_series(&st, unknown, good), Err(AppError::Invalid(_))));
}

#[test]
fn a_forecast_from_stale_news_starts_at_the_snapshot_and_waits_for_news() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let (start, near) = carried_game(&st, 9);
    handlers::step(&st, 40).unwrap();
    let good = handlers::port(&st, start).unwrap().market[0].good;
    sail(&st, near);
    step_until_docked(&st, near);
    let day = handlers::overview(&st).unwrap().day;
    let s = handlers::market_series(&st, start, good).unwrap();
    let origin = s.last_close.unwrap();
    let stale = day - 1 - origin;
    assert!(stale > 0);
    // 起点只能是所知的最后收盘日；期限最多 60 + 过时的天数
    let mut wrong = naive(&st, start, good, 5);
    wrong.origin = day - 1;
    assert!(matches!(handlers::pin_forecast(&st, wrong), Err(AppError::Invalid(m)) if m.key == "forecast.origin"));
    let Err(AppError::Invalid(m)) = handlers::pin_forecast(&st, naive(&st, start, good, 61 + stale)) else {
        panic!("期限超出")
    };
    assert_eq!(m.key, "forecast.horizon");
    assert!(m.args.iter().any(|(k, v)| *k == "max" && *v == (60 + stale).to_string()));
    // 按抵达时预测：过时的天数 + 5 天
    let horizon = stale + 5;
    let book = handlers::pin_forecast(&st, naive(&st, start, good, horizon)).unwrap();
    let e = &book.entries[0];
    assert_eq!((e.origin, e.created, e.horizon), (origin, day, horizon));
    assert!(!e.baseline_exact && e.baseline.day == origin);
    assert_eq!(e.baseline.price, *s.daily.last().unwrap());
    // 在外面：玩家不知道那边这些天的行情，预测簿里什么也没抄到（后台照常抄录）
    handlers::step(&st, 2).unwrap();
    assert!(handlers::forecast_book(&st).unwrap().entries[0].track.is_empty());
    // 回到开局港口：看得到实时的行情，抄录的日子都出来了——记下之前已经过去的日子只有收盘价
    sail(&st, start);
    step_until_docked(&st, start);
    handlers::step(&st, 1).unwrap();
    let today = handlers::overview(&st).unwrap().day;
    let e = handlers::forecast_book(&st).unwrap().entries[0].clone();
    let seen = (today - 1 - origin).min(horizon) as usize;
    assert_eq!(e.track.len(), seen);
    let daily = handlers::market_series(&st, start, good).unwrap().daily;
    for (i, t) in e.track.iter().enumerate() {
        assert_eq!(t.day, origin + 1 + i as u32, "第 {i} 步对应起点 + {}", i + 1);
        assert_eq!(t.price, daily[daily.len() - 1 - (today - 1 - t.day) as usize], "第 {} 天的收盘价", t.day);
        assert_eq!(t.filled, t.day < day, "记下之前已经过去的日子只补收盘价");
    }
}

#[test]
fn live_mode_keeps_the_classic_views() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let o = handlers::new_game(&st, "newcomer", Some(3)).unwrap();
    assert_eq!(o.info_mode, "live");
    let start = o.fleets[0].docked.unwrap();
    handlers::step(&st, 10).unwrap();
    let p = handlers::port(&st, start).unwrap();
    assert!(p.known && p.seen.is_none() && p.report.is_none(), "实时模式没有时效与行情通报");
    let s = handlers::market_series(&st, start, p.market[0].good).unwrap();
    assert!(s.seen.is_none());
    assert_eq!(s.last_close, Some(9));
    // 实时模式买不了行情通报
    let r = handlers::submit(&st, Command::BuyMarketReport { owner: OwnerId::Player, loc: LocId(start) });
    assert!(matches!(r, Err(AppError::Command(_))));
    // 开局之后不能再换
    let r = handlers::submit(&st, Command::SetInfoMode { owner: OwnerId::Player, mode: InfoMode::Carried });
    assert!(matches!(r, Err(AppError::Command(_))));
}
