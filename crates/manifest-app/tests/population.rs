//! 第八批 E4 的应用层视图（docs/ECONOMY.md 6.4、6.5）：港口的人口、繁荣度、市况与城镇工坊，概览里的市况标记（海图用），
//! 市况变化的日志，商品的需求层级，以及行情追踪记下的工坊取用、委托交付与需求规模。

use manifest_ai::{AiMode, MemoryKeyStore};
use manifest_app::handlers;
use manifest_app::{AppPaths, AppState};
use manifest_core::people::Condition;
use manifest_core::{LocId, log};
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

/// 开局港口（新手剧本：维拉马雷，有城镇工坊）。
fn home(st: &AppState) -> u16 {
    handlers::overview(st).unwrap().fleets[0].docked.expect("开局停在港口")
}

/// 直接改世界状态（测试用）。
fn with_world(st: &AppState, f: impl FnOnce(&mut manifest_core::World)) {
    let mut guard = st.game().unwrap();
    let g = guard.as_mut().unwrap();
    f(&mut g.session.world);
}

#[test]
fn the_port_shows_its_people_and_workshops() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(5)).unwrap();
    let loc = home(&st);
    let port = handlers::port(&st, loc).unwrap();
    let p = port.people.clone().expect("港口有人口");
    assert!(p.learning, "头一年在记参照");
    assert_eq!((p.pop, p.prosperity_bp, p.condition, p.growth_bp), (p.pop0, 500_000, "stable", 0));
    assert!(!port.workshops.is_empty(), "维拉马雷有城镇工坊");
    let statics = handlers::static_data(&st);
    let wine = statics.goods.iter().find(|g| g.key == "wine").unwrap().id;
    let shop = port.workshops.iter().find(|w| w.output == wine).expect("酿酒工坊");
    assert!(shop.learning && !shop.stopped);
    assert_eq!(shop.capacity_bp, 10_000);
    assert!(shop.inputs.iter().any(|(g, q)| statics.goods[*g as usize].key == "grapes" && *q > 0));
    handlers::step(&st, 400).unwrap();
    let port = handlers::port(&st, loc).unwrap();
    let p = port.people.unwrap();
    assert!(!p.learning);
    assert!(p.sat_bp.iter().all(|s| (0..=10_000).contains(s)), "{:?}", p.sat_bp);
    assert!((0..=1_000_000).contains(&p.prosperity_bp));
    let shop = port.workshops.iter().find(|w| w.output == wine).unwrap();
    assert!(!shop.learning && shop.value_bp > 0 && shop.daily_bp > 0);
    // 商品的需求层级
    let need = |key: &str| statics.goods.iter().find(|g| g.key == key).unwrap().need;
    assert_eq!(
        (need("grain"), need("wine"), need("silk"), need("iron_ore")),
        (Some("essential"), Some("comfort"), Some("luxury"), None)
    );
    // 没到过的港口：不知道人口与工坊
    let unknown = (0..statics.locations.len() as u16)
        .find(|l| {
            let v = handlers::port(&st, *l).unwrap();
            !v.known && statics.locations[*l as usize].kind == "port"
        })
        .expect("有没到过的港口");
    let v = handlers::port(&st, unknown).unwrap();
    assert!(v.people.is_none() && v.workshops.is_empty());
}

#[test]
fn the_map_marks_the_conditions_of_known_ports_and_the_log_tells_the_story() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(6)).unwrap();
    let loc = home(&st);
    assert!(handlers::overview(&st).unwrap().port_conditions.is_empty(), "开局到处平稳");
    let statics = handlers::static_data(&st);
    let far = (0..statics.locations.len() as u16)
        .find(|l| !handlers::port(&st, *l).unwrap().known && statics.locations[*l as usize].kind == "port")
        .unwrap();
    with_world(&st, |w| {
        for (l, c) in [(loc, Condition::Famine), (far, Condition::Boom)] {
            let p = &mut w.state.locations[l as usize].people;
            p.condition = c;
            p.since = w.state.day;
        }
        w.push_log(log::LogEvent {
            day: w.state.day,
            kind: log::LogKind::PortCondition { loc: LocId(loc), condition: Condition::Famine },
        });
    });
    // 海图只标到过的港口
    let marks = handlers::overview(&st).unwrap().port_conditions;
    assert_eq!(marks.len(), 1);
    assert_eq!((marks[0].loc, marks[0].condition), (loc, "famine"));
    assert_eq!(handlers::port(&st, loc).unwrap().people.unwrap().condition, "famine");
    // 日志：地点名与市况的键（前端按 portCondition.* 显示）
    let intel = handlers::intel(&st).unwrap();
    let line = intel.log.iter().find(|l| l.kind == "PortCondition").expect("市况日志");
    let name = &statics.locations[loc as usize].name;
    assert!(line.args.contains(&("loc".into(), name.clone())), "{:?}", line.args);
    assert!(line.args.contains(&("condition".into(), "famine".into())), "{:?}", line.args);
}

#[test]
fn the_market_track_records_workshops_and_the_demand_scale() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(7)).unwrap();
    let loc = home(&st);
    let statics = handlers::static_data(&st);
    let grapes = statics.goods.iter().find(|g| g.key == "grapes").unwrap().id;
    handlers::step(&st, 5).unwrap();
    // 葡萄被酿酒工坊取用：追踪记下工坊的取用，目标库存的需求规模分量都有记录
    let s = handlers::market_series(&st, loc, grapes).unwrap();
    let last = *s.daily.last().unwrap();
    let point = manifest_app::forecast::ForecastPoint { mean: last, lo80: last, hi80: last, lo95: last, hi95: last };
    let req = manifest_app::forecast::PinRequest {
        loc,
        good: grapes,
        origin: s.last_close.unwrap(),
        horizon: 5,
        spec: manifest_app::forecast::ForecastSpec {
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
        path: vec![point; 5],
        revises: None,
        basis: None,
    };
    let book = handlers::pin_forecast(&st, req).unwrap();
    assert!(book.entries[0].baseline.people_bp > 0);
    handlers::step(&st, 5).unwrap();
    let book = handlers::forecast_book(&st).unwrap();
    let track = &book.entries[0].track;
    assert_eq!(track.len(), 5);
    assert!(track.iter().any(|t| t.workshop_in > 0), "酿酒工坊每天取用葡萄");
    assert!(track.iter().all(|t| t.people_bp > 0 && t.prosperity_bp > 0 && t.substitute_bp > 0));
}
