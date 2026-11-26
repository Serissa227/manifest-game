//! 日期、期限和月线必须取同一世界日历。
use manifest_appcore::{forecast, views};
use manifest_core::*;
use std::{path::PathBuf, sync::Arc};

fn testbed() -> StaticData {
    (*manifest_data::load_world(&PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data"), "testbed").unwrap())
        .clone()
}

#[test]
fn static_calendar_date_and_year_deadlines_agree() {
    let mut d = testbed();
    d.scenarios[0].goal.deadline = Some(4 * d.calendar.year_days());
    let v = views::static_view(&d);
    let j = serde_json::to_value(&v).unwrap();
    assert_eq!(j["world"]["key"], "testbed");
    assert_eq!(j["world"]["name"], "框架测试海域");
    assert_eq!(j["world"]["map_key"], "testbed");
    assert_eq!(j["world"]["calendar"]["months"], serde_json::json!([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]));
    assert_eq!(j["world"]["calendar"]["seasons"][0], 3);
    assert_eq!(v.scenarios[0].goal.years, Some(4));
    let start = d.rules.world.start_year;
    let mut w = World::new(Arc::new(d), ScenarioId(0), 1).unwrap();
    for (day, y, m, date) in
        [(30, start, 1, 31), (31, start, 2, 1), (58, start, 2, 28), (59, start, 3, 1), (365, start + 1, 1, 1)]
    {
        w.state.day = day;
        let v = views::overview(&w, 1, "off".into(), None);
        assert_eq!(v.world_date, [y, m, date]);
        assert_eq!([v.calendar_year, i64::from(v.month), i64::from(v.date)], v.world_date);
    }
}

#[test]
fn monthly_series_last_close_uses_real_month_ends() {
    let mut w = World::new(Arc::new(testbed()), ScenarioId(0), 1).unwrap();
    for (day, last, len) in [(30, None, 0), (31, Some(30), 1), (58, Some(30), 1), (59, Some(58), 2), (90, Some(89), 3)]
    {
        while w.day() < day {
            w.end_day().unwrap();
        }
        let v = forecast::series_view(&w, LocId(0), GoodId(0)).unwrap();
        assert_eq!(v.monthly_last, last);
        assert_eq!(v.monthly.len(), len);
    }
}

#[test]
fn classic_static_and_overview_keep_their_old_date_fields() {
    let d = manifest_data::load_default().unwrap();
    let v = views::static_view(&d);
    assert_eq!(v.world.calendar.months, vec![30; 12]);
    assert_eq!(v.world.key, "classic");
    let mut w = World::new(d, ScenarioId(0), 1).unwrap();
    w.state.day = 359;
    let v = views::overview(&w, 1, "off".into(), None);
    assert_eq!((v.year, v.month, v.date), (1, 12, 30));
    assert_eq!(v.world_date, [v.calendar_year, 12, 30]);
}
