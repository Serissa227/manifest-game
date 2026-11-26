//! 模拟年数、年度报告与月度叙事排期共用 Calendar。
use manifest_ai::TaskRequest;
use manifest_core::{info::InfoMode, *};
use manifest_sim::{ai::AiDriver, balance, bots::BotKind};
use std::path::PathBuf;

#[test]
fn simulation_years_and_chronicle_requests_follow_testbed_calendar() {
    let d =
        manifest_data::load_world(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data"), "testbed").unwrap();
    let r = balance::run_one(d.clone(), 42, BotKind::Passive, 2, InfoMode::Live).unwrap();
    assert_eq!(r.index.len(), 3);
    assert_eq!(r.supply.len(), 3);
    assert!(r.money_conserved);
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    for day in [362, 366] {
        w.state.day = day;
        assert!(!AiDriver::due_requests(&w).iter().any(|t| matches!(t, TaskRequest::Chronicle { .. })));
    }
    w.state.day = 367;
    assert!(AiDriver::due_requests(&w).iter().any(|t| matches!(t, TaskRequest::Chronicle { year: 0 })));
}
