//! 开放市场在应用层（处理函数与视图）：港口的行情行带 sold / extra / nearest，买入页只列出售的货；
//! 买不出售的货被拒并按界面语言说明；卖出哪种货都行；行情簿的地点带所知的价格与出售清单（交易所明细的“别处的价格”用）；
//! 英文界面的市场月报里规则触发的政策写成英文（顺手修的缺陷）。

use manifest_ai::{AiMode, MemoryKeyStore};
use manifest_app::handlers;
use manifest_app::{AppError, AppPaths, AppState};
use manifest_core::composed::{ComposedEffect, ComposedRecord, ComposedSource};
use manifest_core::defs::EffectKind;
use manifest_core::events::EventParams;
use manifest_core::{Command, CommandError, Fx, GoodId, TextArg, TextRef};
use manifest_data::Locale;
use serde_json::json;
use std::path::Path;
use std::sync::Arc;

fn app(dir: &Path) -> AppState {
    let data = manifest_data::find_data_dir().expect("找到 data/");
    let st = AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(dir)).unwrap();
    let mut settings = handlers::get_settings(&st).settings;
    settings.ai.mode = AiMode::Off;
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings).unwrap();
    st
}

fn set_language(st: &AppState, locale: Locale) {
    let mut settings = handlers::get_settings(st).settings;
    settings.language = Some(locale);
    handlers::save_settings(st, settings).unwrap();
}

fn cjk(s: &str) -> bool {
    s.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
}

#[test]
fn the_port_view_marks_what_is_sold_and_where_goods_come_from() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let o = handlers::new_game(&st, "newcomer", Some(3)).unwrap();
    let start = o.fleets[0].docked.unwrap();
    handlers::step(&st, 3).unwrap();
    let defs = st.defs().clone();
    let port = handlers::port(&st, start).unwrap();
    assert_eq!(port.market.len(), defs.goods.len(), "开放市场：72 种货都有行情");
    let sale = manifest_core::open_market::sale_list(&defs, manifest_core::LocId(start));
    let sold: Vec<u16> = port.market.iter().filter(|r| r.sold).map(|r| r.good).collect();
    assert_eq!(sold.len(), sale.len());
    assert!(port.market.iter().filter(|r| r.sold).all(|r| r.specialty), "维拉马雷只卖特产");
    for r in &port.market {
        let listed = defs.loc(manifest_core::LocId(start)).listed(GoodId(r.good)).is_some();
        assert_eq!(r.extra, !listed);
        // 走势只给这里出售的与手上有的货（交易所只显示这些行）
        assert_eq!(r.history.is_empty(), !r.sold && r.held == 0, "{r:?}");
        if r.specialty {
            assert!(r.nearest.is_none());
        } else if manifest_core::open_market::has_specialty(&defs, GoodId(r.good)) {
            let (p, d) = r.nearest.expect("不是特产的货写明最近的产地");
            assert!(defs.loc(manifest_core::LocId(p)).listed(GoodId(r.good)).is_some_and(|m| m.specialty));
            assert!(d > 0);
        } else {
            assert!(r.nearest.is_none(), "哪里都不是特产的货（金锭）没有产地");
        }
    }
    // 序列化：sold 一直写；extra、nearest 没有时省略
    let v = serde_json::to_value(&port).unwrap();
    let rows = v["market"].as_array().unwrap();
    assert!(rows.iter().all(|r| r.get("sold").is_some()));
    assert!(rows.iter().any(|r| r.get("extra").is_none()) && rows.iter().any(|r| r["extra"] == json!(true)));
    // 行情簿：知道的地点带所知的价格与出售清单
    let book = handlers::forecast_book(&st).unwrap();
    let here = book.places.iter().find(|p| p.loc == start).expect("开局港知道行情");
    assert_eq!(here.goods.len(), defs.goods.len());
    assert_eq!(here.prices.len(), here.goods.len());
    assert!(here.prices.iter().all(|p| *p > 0));
    let mut want: Vec<u16> = sale.iter().map(|g| g.0).collect();
    want.sort();
    let mut got = here.sold.clone();
    got.sort();
    assert_eq!(got, want);
}

#[test]
fn buying_what_is_not_sold_is_refused_in_the_player_language_and_selling_works() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    let o = handlers::new_game(&st, "newcomer", Some(4)).unwrap();
    let start = o.fleets[0].docked.unwrap();
    let fleet = o.fleets[0].id;
    let defs = st.defs().clone();
    let spice = defs.find_good("spice").unwrap();
    let buy = || -> Command {
        serde_json::from_value(
            json!({"Buy": {"owner": "player", "fleet": fleet, "good": spice.0, "qty": 2, "max_total": null}}),
        )
        .unwrap()
    };
    let err = handlers::submit(&st, buy()).unwrap_err();
    assert!(matches!(err, AppError::Command(CommandError::NotSoldHere)), "{err:?}");
    assert!(st.localize_error(err).to_string().contains("这里不出售这种货"));
    set_language(&st, Locale::En);
    let err = st.localize_error(handlers::submit(&st, buy()).unwrap_err()).to_string();
    assert!(err.contains("does not sell it") && !cjk(&err), "{err}");
    // 询价：买入同样被拒，卖出询得到
    let q = |side: &str| {
        handlers::quote(&st, handlers::QuoteRequest { loc: start, good: spice.0, side: side.into(), qty: 3 })
    };
    assert!(q("buy").is_err());
    assert!(q("sell").is_ok());
}

#[test]
fn english_market_reports_write_rule_policies_in_english() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(5)).unwrap();
    set_language(&st, Locale::En);
    let defs = st.defs().clone();
    let (pearl, faction) = (defs.find_good("pearl").unwrap(), defs.find_faction("bichao").unwrap());
    let title = format!("{}加征{}出口税", defs.faction(faction).name, defs.good(pearl).name);
    let mut guard = st.game().unwrap();
    let world = &mut guard.as_mut().unwrap().session.world;
    world.state.events.composed.push(ComposedRecord {
        id: 999,
        day: 0,
        title: title.clone(),
        text: "……".into(),
        effects: vec![ComposedEffect {
            effect: EffectKind::ExportTariff,
            params: EventParams {
                faction_a: Some(faction),
                good: Some(pearl),
                mult: Some(Fx::from_int(2)),
                days: Some(60),
                ..EventParams::default()
            },
        }],
        source: ComposedSource::Rule,
    });
    let tpl = TextRef {
        parts: vec![TextRef::part("market_report", "policy", 0)],
        args: [("policy".to_string(), TextArg::Composed(title.clone()))].into_iter().collect(),
    };
    let text = st.ctx().text(world, &title, Some(&tpl));
    assert!(!cjk(&text) && text.contains("export duty"), "{text}");
}
