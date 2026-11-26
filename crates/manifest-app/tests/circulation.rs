//! 第八批 E8：货币流通（docs/ECONOMY.md 6.9）在应用层的视图——交易所里的城镇钱袋与所属势力的国库
//! （只在看得到实时行情时给：在场，或行情情报是实时的）；报表里的经济月报（各部门对得上账，名称按界面语言）。

use manifest_ai::{AiMode, MemoryKeyStore};
use manifest_app::{AppPaths, AppState, handlers};
use manifest_core::info::InfoMode;
use manifest_core::{Command, OwnerId};
use manifest_data::Locale;
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

fn cjk(s: &str) -> bool {
    s.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
}

#[test]
fn the_exchange_shows_the_town_purse_and_the_treasury_where_prices_are_live() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(3)).unwrap();
    handlers::submit(&st, Command::SetInfoMode { owner: OwnerId::Player, mode: InfoMode::Carried }).unwrap();
    handlers::step(&st, 10).unwrap();
    let here = handlers::overview(&st).unwrap().fleets[0].docked.expect("开局停在港口");
    let p = handlers::port(&st, here).unwrap();
    let purse = p.purse.expect("在场：看得到当地的钱袋");
    assert!(purse.reference > 0 && purse.money > 0);
    assert!((8_000..=12_500).contains(&purse.liquidity_bp));
    let t = purse.treasury.expect("所属势力的国库");
    assert!(!t.faction.is_empty() && t.tax_mult_bp > 0);
    // 远方港口只知道旧消息：不给钱袋
    let locs = handlers::static_data(&st).locations;
    let far = locs.iter().find(|l| l.kind == "port" && l.id != here).unwrap().id;
    assert!(handlers::port(&st, far).unwrap().purse.is_none());
}

#[test]
fn reports_carry_the_economic_monthly_report_in_the_interface_language() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path());
    handlers::new_game(&st, "newcomer", Some(4)).unwrap();
    handlers::step(&st, 65).unwrap();
    let r = handlers::reports(&st).unwrap();
    assert_eq!(r.economy.len(), 2, "两个月的经济月报");
    let e = &r.economy[1];
    assert_eq!(e.month, 1);
    let kinds: Vec<&str> = e.sectors.iter().map(|s| s.kind).collect();
    assert_eq!(kinds, ["traders", "towns", "treasuries", "bank", "hinterland"]);
    for s in &e.sectors {
        assert_eq!(s.opening + s.inflow - s.outflow, s.closing, "{}", s.kind);
    }
    assert!(e.flows.iter().any(|l| l.flow == "HinterlandIncome" && l.from == "hinterland" && l.to == "towns"));
    assert!(e.money_supply > 0 && e.price_index_bp > 0 && e.population > 0);
    assert!(e.tightest.is_some() && e.flush.is_some());
    assert!(!e.treasuries.is_empty() && e.treasuries.iter().all(|t| cjk(&t.faction)));
    // 英文界面：势力与港口的名称是英文
    let mut settings = handlers::get_settings(&st).settings;
    settings.language = Some(Locale::En);
    handlers::save_settings(&st, settings).unwrap();
    let e = handlers::reports(&st).unwrap().economy.pop().unwrap();
    assert!(e.treasuries.iter().all(|t| !cjk(&t.faction)), "{:?}", e.treasuries);
    assert!(!cjk(&e.tightest.unwrap().0));
}
