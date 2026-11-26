//! 行情预测簿（docs/ECONOMY.md 第 4 节）：行情序列、记下预测的校验、逐日追踪与抄录、存档读档，
//! 以及预测簿不影响世界状态（应用层数据，不进世界哈希与重放）。

use manifest_ai::{AiMode, MemoryKeyStore};
use manifest_app::forecast::{AdjustBasis, BookView, ForecastPoint, ForecastSpec, PinRequest};
use manifest_app::handlers;
use manifest_app::{AppError, AppPaths, AppState};
use manifest_core::events::EventParams;
use manifest_core::{Command, Fx, LocId, Source};
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

fn state_hash(st: &AppState) -> String {
    handlers::debug(st).unwrap().state_hash
}

/// 开局港口与那里交易的第一种商品。
fn home_market(st: &AppState) -> (u16, u16) {
    let loc = handlers::overview(st).unwrap().fleets[0].docked.expect("开局停在港口");
    let good = handlers::port(st, loc).unwrap().market[0].good;
    (loc, good)
}

fn spec(method: &str) -> ForecastSpec {
    ForecastSpec {
        method: method.into(),
        params: Default::default(),
        window: 30,
        log: false,
        seasonal: false,
        excluded: vec![],
        interval: "formula".into(),
        intervention: None,
    }
}

/// 朴素法的路径：点预测都是最后一个收盘价，区间按 √h 放宽（前端的计算这里只需要形状合法）。
fn naive_request(st: &AppState, loc: u16, good: u16, horizon: u32) -> PinRequest {
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
        spec: spec("naive"),
        fitted_on: s.daily.iter().rev().take(30).rev().copied().collect(),
        path,
        revises: None,
        basis: None,
    }
}

#[test]
fn series_gives_daily_monthly_bounds_and_curve() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(5)).unwrap();
    let (loc, good) = home_market(&st);
    // 还没有收盘价
    let s = handlers::market_series(&st, loc, good).unwrap();
    assert_eq!((s.today, s.last_close, s.daily.len()), (0, None, 0));
    handlers::step(&st, 95).unwrap();
    let s = handlers::market_series(&st, loc, good).unwrap();
    assert_eq!(s.today, 95);
    assert_eq!(s.last_close, Some(94));
    assert_eq!(s.daily.len(), 95, "日线从第 0 天记起");
    assert_eq!(s.monthly.len(), 3, "三个完整的月");
    assert_eq!(s.monthly_last, Some(89));
    assert!(s.floor >= 1 && s.floor < s.base_price && s.cap > s.base_price);
    assert!(s.daily.iter().all(|p| *p >= s.floor && *p <= s.cap));
    assert!(s.curve.len() >= 2 && s.curve.windows(2).all(|w| w[0].0 < w[1].0 && w[0].1 >= w[1].1), "价格曲线单调递减");
    // 日线与港口视图的走势一致（港口视图给的是同一份日线）
    let row = handlers::port(&st, loc).unwrap().market.into_iter().find(|r| r.good == good).unwrap();
    assert_eq!(row.history, s.daily);
    // 未到访的港口没有行情
    let far = (0..200u16).find(|l| handlers::port(&st, *l).map(|p| !p.known).unwrap_or(false)).expect("有没到访的地点");
    assert!(matches!(handlers::market_series(&st, far, good), Err(AppError::Invalid(_))));
}

#[test]
fn pinned_forecast_is_tracked_day_by_day_until_its_horizon() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(9)).unwrap();
    handlers::step(&st, 40).unwrap();
    let (loc, good) = home_market(&st);
    let book = handlers::pin_forecast(&st, naive_request(&st, loc, good, 10)).unwrap();
    assert_eq!((book.active, book.entries.len()), (1, 1));
    let e = &book.entries[0];
    assert_eq!((e.origin, e.created, e.horizon), (39, 40, 10));
    assert!(e.baseline_exact, "记下之前当天没有成交：基准来自内核的完整记录");
    assert_eq!(e.baseline.day, 39);
    assert_eq!(e.baseline.price, *handlers::market_series(&st, loc, good).unwrap().daily.last().unwrap());
    assert!(e.track.is_empty());

    for k in 1..=12u32 {
        handlers::step(&st, 1).unwrap();
        let book = handlers::forecast_book(&st).unwrap();
        let e = &book.entries[0];
        let expect = k.min(10) as usize;
        assert_eq!(e.track.len(), expect, "第 {k} 天之后");
        let t = e.track.last().unwrap();
        assert_eq!(t.day, 39 + expect as u32);
        if k <= 10 {
            // 抄录的收盘价就是日线的最后一个值；库存流量自洽（含城镇工坊、委托交付与本地商人的存货进出）
            let s = handlers::market_series(&st, loc, good).unwrap();
            assert_eq!(t.price, *s.daily.last().unwrap());
            let prev_end = if k == 1 { e.baseline.stock_end } else { e.track[e.track.len() - 2].stock_end };
            assert_eq!(
                t.stock_close,
                prev_end - t.player_bought + t.player_sold + t.produced - t.consumed + t.workshop_out - t.workshop_in
                    + t.delivered
            );
            assert_eq!(
                t.stock_end,
                t.stock_close - (t.npc_bought - t.npc_sold) - (t.other_bought - t.other_sold) - t.hoarded
            );
            assert!(t.demand_bp > 0 && t.season_bp > 0 && t.target > 0);
        }
    }
    assert_eq!(handlers::forecast_book(&st).unwrap().active, 0, "到期后不再占追踪名额");
}

#[test]
fn invalid_pins_are_rejected_and_revisions_need_a_basis() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(3)).unwrap();
    let (loc, good) = home_market(&st);
    // 第 0 天还没有收盘价
    let s = handlers::market_series(&st, loc, good).unwrap();
    assert!(s.last_close.is_none());
    handlers::step(&st, 20).unwrap();
    let ok = naive_request(&st, loc, good, 5);
    let reject = |r: PinRequest| {
        let before = handlers::forecast_book(&st).unwrap().entries.len();
        assert!(matches!(handlers::pin_forecast(&st, r), Err(AppError::Invalid(_))));
        assert_eq!(handlers::forecast_book(&st).unwrap().entries.len(), before);
    };
    reject(PinRequest { origin: ok.origin - 1, ..ok.clone() });
    reject(PinRequest { horizon: 0, path: vec![], ..ok.clone() });
    reject(PinRequest { horizon: 61, ..ok.clone() });
    reject(PinRequest { path: ok.path[..4].to_vec(), ..ok.clone() });
    let mut bad = ok.clone();
    bad.path[2] = ForecastPoint { mean: 10, lo80: 12, hi80: 13, lo95: 9, hi95: 14 };
    reject(bad);
    reject(PinRequest { spec: spec("crystal_ball"), ..ok.clone() });
    reject(PinRequest { fitted_on: vec![1], ..ok.clone() });
    reject(PinRequest { good: 60_000, ..ok.clone() });
    reject(PinRequest { revises: Some(99), ..ok.clone() });
    let mut odd = ok.clone();
    odd.spec.interval = "psychic".into();
    reject(odd);

    let first = handlers::pin_forecast(&st, ok.clone()).unwrap().entries[0].id;
    // 修订版必须写明调整的种类与依据
    reject(PinRequest { revises: Some(first), ..ok.clone() });
    let basis =
        AdjustBasis { kind: "refit".into(), reason: "judgment".into(), note: "  加入最新数据\u{7}  ".into() };
    reject(PinRequest {
        revises: Some(first),
        basis: Some(AdjustBasis { kind: "magic".into(), ..basis.clone() }),
        ..ok.clone()
    });
    let book =
        handlers::pin_forecast(&st, PinRequest { revises: Some(first), basis: Some(basis), ..ok.clone() }).unwrap();
    let rev = book.entries.last().unwrap();
    assert_eq!(rev.revises, Some(first));
    assert_eq!(rev.basis.as_ref().unwrap().note, "加入最新数据", "去掉控制字符与首尾空白");

    // 同时追踪的条数有上限
    let limit = book.max_active;
    for _ in book.active..limit {
        handlers::pin_forecast(&st, ok.clone()).unwrap();
    }
    reject(ok.clone());
    // 删除一条之后又能记下
    let id = handlers::forecast_book(&st).unwrap().entries[0].id;
    handlers::remove_forecast(&st, id).unwrap();
    handlers::pin_forecast(&st, ok).unwrap();
    assert!(matches!(handlers::remove_forecast(&st, 9_999), Err(AppError::Invalid(_))));
}

#[test]
fn trading_before_pinning_makes_the_baseline_approximate() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(4)).unwrap();
    handlers::step(&st, 15).unwrap();
    let (loc, good) = home_market(&st);
    let fleet = handlers::overview(&st).unwrap().fleets[0].id;
    let stock_before = handlers::market_series(&st, loc, good).unwrap().stock;
    let cmd = serde_json::from_value(serde_json::json!({
        "Buy": { "owner": "player", "fleet": fleet, "good": good, "qty": 5, "max_total": null }
    }))
    .unwrap();
    handlers::submit(&st, cmd).unwrap();
    let book = handlers::pin_forecast(&st, naive_request(&st, loc, good, 3)).unwrap();
    let e = &book.entries[0];
    assert!(!e.baseline_exact);
    assert_eq!(e.baseline.stock_end, stock_before, "退回到今天开盘时的库存");
}

#[test]
fn events_and_popularity_during_the_forecast_are_marked() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(12)).unwrap();
    handlers::step(&st, 10).unwrap();
    let (loc, good) = home_market(&st);
    handlers::pin_forecast(&st, naive_request(&st, loc, good, 40)).unwrap();
    // 由 AI 通道排进下一天：当地节庆（需求上升）与这种商品一时风行
    {
        let mut guard = st.game().unwrap();
        let g = guard.as_mut().unwrap();
        let defs = g.session.defs().clone();
        let festival = defs.find_event("festival").unwrap();
        let craze = defs.find_event("local_craze").unwrap();
        let tick = g.session.day() + 1;
        let p =
            EventParams { loc: Some(LocId(loc)), mult: Some(Fx::from_pct(130)), days: Some(15), ..Default::default() };
        g.session.schedule(tick, Source::Ai, Command::ApplyEvent { event: festival, params: p });
        let p = EventParams {
            loc: Some(LocId(loc)),
            good: Some(manifest_core::GoodId(good)),
            days: Some(20),
            ..Default::default()
        };
        g.session.schedule(tick, Source::Ai, Command::ApplyEvent { event: craze, params: p });
    }
    handlers::step(&st, 40).unwrap();
    let book: BookView = handlers::forecast_book(&st).unwrap();
    let e = &book.entries[0];
    let kinds: Vec<&str> = e.marks.iter().map(|m| m.kind.as_str()).collect();
    assert!(kinds.contains(&"event"), "节庆记为事件：{kinds:?}");
    assert!(kinds.contains(&"popular") && kinds.contains(&"popular_end"), "流行开始与结束：{kinds:?}");
    let ev = e.marks.iter().find(|m| m.kind == "event").unwrap();
    assert_eq!((ev.effect.as_deref(), ev.mult_bp), (Some("location_demand"), Some(13_000)));
    // 事件期间抄录到的事件需求系数
    assert!(e.track.iter().any(|t| t.event_bp == 13_000));
    assert!(e.track.iter().any(|t| t.popular));
}

#[test]
fn the_book_is_saved_beside_the_game_and_never_touches_the_world() {
    let tmp = tempfile::tempdir().unwrap();
    // 对照：同一种子、同样推进，不记预测
    let plain = app(&tmp.path().join("plain"));
    handlers::new_game(&plain, "newcomer", Some(21)).unwrap();
    handlers::step(&plain, 30).unwrap();
    handlers::step(&plain, 12).unwrap();

    let st = app(&tmp.path().join("book"));
    handlers::new_game(&st, "newcomer", Some(21)).unwrap();
    handlers::step(&st, 30).unwrap();
    let (loc, good) = home_market(&st);
    let log_before = handlers::debug(&st).unwrap().log_len;
    handlers::pin_forecast(&st, naive_request(&st, loc, good, 20)).unwrap();
    assert_eq!(handlers::debug(&st).unwrap().log_len, log_before, "记下预测不写命令日志");
    handlers::step(&st, 12).unwrap();
    assert_eq!(state_hash(&st), state_hash(&plain), "预测簿不改变世界状态");

    handlers::save_game(&st, "slot1").unwrap();
    let saved = handlers::forecast_book(&st).unwrap().entries;
    assert!(tmp.path().join("book").join("saves").join("slot1.book.json").is_file());
    handlers::step(&st, 5).unwrap();
    handlers::load_game(&st, "slot1").unwrap();
    assert_eq!(handlers::forecast_book(&st).unwrap().entries, saved, "读档恢复预测簿");
    // 新开一局：预测簿清空
    handlers::new_game(&st, "newcomer", Some(2)).unwrap();
    assert!(handlers::forecast_book(&st).unwrap().entries.is_empty());
    // 没有附属文件的旧存档：预测簿为空
    std::fs::remove_file(tmp.path().join("book").join("saves").join("slot1.book.json")).unwrap();
    handlers::load_game(&st, "slot1").unwrap();
    assert!(handlers::forecast_book(&st).unwrap().entries.is_empty());
}

#[test]
fn genius_methods_need_a_genius_in_your_service() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(8)).unwrap();
    handlers::step(&st, 30).unwrap();
    let (loc, good) = home_market(&st);
    // 开局只会行商的老法子
    let s = handlers::market_series(&st, loc, good).unwrap();
    assert_eq!(s.methods, ["naive", "ma", "drift", "seasonal", "fair", "astrology"]);
    let book = handlers::forecast_book(&st).unwrap();
    assert!(book.geniuses.is_empty());
    // 可以分析的地点：到访过的开局港口在列，交易的商品与港口视图一致
    let place = book.places.iter().find(|p| p.loc == loc).expect("开局港口可以分析");
    let port_goods: Vec<u16> = handlers::port(&st, loc).unwrap().market.iter().map(|r| r.good).collect();
    assert_eq!(place.goods, port_goods);
    assert!(book.places.iter().all(|p| handlers::port(&st, p.loc).unwrap().known));
    let mut req = naive_request(&st, loc, good, 5);
    req.spec.method = "ar1".into();
    assert!(matches!(handlers::pin_forecast(&st, req.clone()), Err(AppError::Invalid(_))), "还不会回归术");
    // 老法子都能记下
    for m in ["ma", "drift", "fair", "astrology"] {
        let mut r = naive_request(&st, loc, good, 5);
        r.spec.method = m.into();
        handlers::pin_forecast(&st, r).unwrap();
    }
    // 收下天文台出身的卡里姆（算学奇才：最小二乘直线、回归术）
    {
        let mut guard = st.game().unwrap();
        let g = guard.as_mut().unwrap();
        let id = manifest_core::MateId::from_idx(
            g.session.defs().mates.iter().position(|m| m.key == "karim_alnajmi").expect("有卡里姆"),
        );
        g.session.world.state.mates.get_mut(&id).unwrap().owner = Some(manifest_core::OwnerId::Player);
    }
    let s = handlers::market_series(&st, loc, good).unwrap();
    assert_eq!(s.methods, ["naive", "ma", "drift", "seasonal", "fair", "astrology", "linear", "ar1"]);
    let book = handlers::forecast_book(&st).unwrap();
    assert_eq!(book.geniuses.len(), 1);
    assert_eq!(book.geniuses[0].methods, ["linear", "ar1"]);
    handlers::pin_forecast(&st, req).unwrap();
    // 航海士卡片上也看得到奇才掌握的方法
    let mates = handlers::mates(&st).unwrap();
    let karim = mates.hired.iter().find(|m| m.key == "karim_alnajmi").unwrap();
    assert_eq!(karim.methods, ["linear", "ar1"]);
}

#[test]
fn series_and_track_show_the_local_producers() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(21)).unwrap();
    let (loc, good) = home_market(&st);
    // 头一年：生产者只看不动
    let s = handlers::market_series(&st, loc, good).unwrap();
    if s.produces {
        let p = s.producer.clone().expect("有产出的市场有生产者");
        assert!(p.learning && p.normal_bp.is_none());
        assert_eq!(p.capacity_bp, 10_000);
    } else {
        assert!(s.producer.is_none());
    }
    handlers::step(&st, 370).unwrap();
    // 满一年后：开局港口每一种有产出的商品都有这个月的正常价与产能（产能在开局的上下限之内）
    let port = handlers::port(&st, loc).unwrap();
    let mut seen = 0;
    for row in &port.market {
        let s = handlers::market_series(&st, loc, row.good).unwrap();
        match (s.produces, s.producer) {
            (true, Some(p)) => {
                assert!(!p.learning && p.normal_bp.is_some_and(|n| n > 0));
                assert!((3_000..=25_000).contains(&p.capacity_bp), "{}", p.capacity_bp);
                seen += 1;
            }
            (false, None) => {}
            other => panic!("产出与生产者不一致：{other:?}"),
        }
    }
    assert!(seen > 0);
    // 逐日追踪记下产能
    let book = handlers::pin_forecast(&st, naive_request(&st, loc, good, 5)).unwrap();
    assert!(book.entries[0].baseline.capacity_bp > 0);
    handlers::step(&st, 3).unwrap();
    let book = handlers::forecast_book(&st).unwrap();
    assert!(book.entries[0].track.iter().all(|t| t.capacity_bp > 0));
}

#[test]
fn series_shows_the_local_merchants() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(23)).unwrap();
    let (loc, good) = home_market(&st);
    // 第 0 天还没开张
    assert!(handlers::market_series(&st, loc, good).unwrap().merchants.is_none());
    handlers::step(&st, 30).unwrap();
    let s = handlers::market_series(&st, loc, good).unwrap();
    let m = s.merchants.expect("开张之后有本地商人");
    assert_eq!(m.shares_bp.iter().sum::<i64>(), 10_000, "四派占比之和为 1");
    assert!(m.shares_bp.iter().all(|x| *x >= 500), "每派至少 5%：{:?}", m.shares_bp);
    assert!(m.forecast_bp.iter().all(|f| *f > 0) && m.expect_bp > 0 && m.price_bp > 0);
    // 主流预期在四派预测的最低与最高之间（没有传闻时）
    let (lo, hi) = (m.forecast_bp.iter().min().unwrap(), m.forecast_bp.iter().max().unwrap());
    assert_eq!(m.rumor_bp, 0);
    assert!(m.expect_bp >= lo - 1 && m.expect_bp <= hi + 1, "{} 不在 {lo}–{hi}", m.expect_bp);
    assert!(m.hoard >= 0 && m.hoard_base > 0);
}
