//! 第九批 E02：两种年长、可变月份数、边界与经典自由函数兼容。

use manifest_core::calendar::{self, Calendar, CalendarError, Date, Season};

fn civil() -> Calendar {
    Calendar::new(
        vec![31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31],
        vec![3, 3, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3],
        "公元".into(),
        Vec::new(),
    )
    .unwrap()
}

#[test]
fn both_calendars_round_trip_every_day_across_four_years() {
    for cal in [Calendar::default(), civil()] {
        for day in 0..cal.year_days() * 4 {
            assert_eq!(cal.day_of(cal.date_of(day)).unwrap(), day);
        }
        assert_eq!(cal.day_of(cal.date_of(u32::MAX)).unwrap(), u32::MAX);
        assert_eq!(cal.date_of(cal.year_days()), Date { year: 2, month: 1, day: 1 });
        assert!(cal.month_end(cal.year_days() - 1));
        assert_eq!(cal.month_index(cal.year_days()), 12);
    }
}

#[test]
fn every_month_end_and_season_uses_the_configured_lengths() {
    for cal in [Calendar::default(), civil()] {
        let mut start = 0;
        for (month, &length) in cal.months().iter().enumerate() {
            for d in 0..u32::from(length) {
                assert_eq!(cal.month_index(start + d), month as u32);
                assert_eq!(cal.month_end(start + d), d + 1 == u32::from(length));
                assert_eq!(cal.season_of(start + d), Season::ALL[cal.seasons()[month] as usize]);
            }
            start += u32::from(length);
        }
    }
    assert_eq!(civil().season_of(0), Season::Winter);
    assert_eq!(civil().season_of(59), Season::Spring);
    assert_eq!(Calendar::default().season_of(59), Season::Spring);
}

#[test]
fn month_deadlines_clamp_and_move_across_year_boundaries() {
    let cal = civil();
    let jan = cal.day_of(Date { year: 2, month: 1, day: 31 }).unwrap();
    let feb = cal.add_months(jan, 1).unwrap();
    assert_eq!(cal.date_of(feb), Date { year: 2, month: 2, day: 28 });
    assert_eq!(cal.date_of(cal.add_months(feb, 1).unwrap()), Date { year: 2, month: 3, day: 28 });
    assert_eq!(cal.date_of(cal.add_months(jan, 2).unwrap()), Date { year: 2, month: 3, day: 31 });
    assert_eq!(cal.date_of(cal.add_months(jan, -1).unwrap()), Date { year: 1, month: 12, day: 31 });
    let classic = Calendar::default();
    assert_eq!(classic.add_months(29, 12).unwrap(), 389);
    assert_eq!(classic.add_months(389, -12).unwrap(), 29);
}

#[test]
fn birthdays_and_year_deadlines_have_no_leap_days() {
    for cal in [Calendar::default(), civil()] {
        let born = cal.day_of(Date { year: 1540, month: 3, day: 1 }).unwrap();
        let birthday = cal.day_of(Date { year: 1556, month: 3, day: 1 }).unwrap();
        assert_eq!(birthday - born, 16 * cal.year_days());
        assert_eq!(cal.add_months(born, 16 * 12).unwrap(), birthday);
        let due = born + 4 * cal.year_days();
        assert_eq!(cal.date_of(due), Date { year: 1544, month: 3, day: 1 });
    }
    assert!(civil().day_of(Date { year: 1540, month: 2, day: 29 }).is_err());
    assert!(Calendar::default().day_of(Date { year: 1540, month: 2, day: 29 }).is_ok());
}

#[test]
fn invalid_dates_and_overflow_are_errors() {
    for cal in [Calendar::default(), civil()] {
        for date in [
            Date { year: 0, month: 1, day: 1 },
            Date { year: 1, month: 0, day: 1 },
            Date { year: 1, month: 13, day: 1 },
            Date { year: 1, month: 1, day: 0 },
            Date { year: 1, month: 1, day: 32 },
        ] {
            assert_eq!(cal.day_of(date), Err(CalendarError::InvalidDate(date)));
        }
        assert_eq!(cal.day_of(Date { year: u32::MAX, month: 1, day: 1 }), Err(CalendarError::OutOfRange));
        assert_eq!(cal.add_months(0, -1), Err(CalendarError::OutOfRange));
        assert_eq!(cal.add_months(0, i32::MIN), Err(CalendarError::OutOfRange));
        assert_eq!(cal.add_months(u32::MAX, 1), Err(CalendarError::OutOfRange));
        assert_eq!(cal.add_months(u32::MAX, 0).unwrap(), u32::MAX);
    }
}

#[test]
fn constructors_and_deserialization_reject_invalid_calendars() {
    for months in [vec![], vec![0, 30], vec![1], vec![2; 65_536]] {
        let seasons = vec![0; months.len()];
        assert_eq!(Calendar::new(months, seasons, "历".into(), Vec::new()), Err(CalendarError::InvalidMonths));
    }
    for seasons in [vec![], vec![0, 4], vec![0]] {
        assert_eq!(Calendar::new(vec![2, 3], seasons, "历".into(), Vec::new()), Err(CalendarError::InvalidSeasons));
    }
    for names in [vec!["一月".into()], vec!["一月".into(), " ".into()]] {
        assert_eq!(Calendar::new(vec![2, 3], vec![0, 1], "历".into(), names), Err(CalendarError::InvalidMonthNames));
    }
    assert_eq!(Calendar::new(vec![2], vec![0], "".into(), Vec::new()), Err(CalendarError::InvalidEra));
    for text in [r#"{"months":[]}"#, r#"{"seasons":[4]}"#, r#"{"era":""}"#, r#"{"leap":"julian"}"#] {
        assert!(serde_json::from_str::<Calendar>(text).is_err(), "{text}");
    }
    assert_eq!(serde_json::from_str::<Calendar>("{}").unwrap(), Calendar::default());
}

#[test]
fn different_month_counts_and_names_survive_serialization() {
    let cal = Calendar::new(vec![2, 3], vec![0, 3], "试历".into(), vec!["雨月".into(), "雪月".into()]).unwrap();
    assert_eq!(cal.year_days(), 5);
    assert_eq!(cal.date_of(5), Date { year: 2, month: 1, day: 1 });
    assert_eq!(cal.month_index(5), 2);
    assert_eq!(cal.era(), "试历");
    assert_eq!(cal.month_names(), ["雨月", "雪月"]);
    let value = serde_json::to_value(&cal).unwrap();
    assert_eq!(value.as_object().unwrap().len(), 4, "派生偏移表不写入数据");
    assert_eq!(serde_json::from_value::<Calendar>(value).unwrap(), cal);
    assert_eq!(cal.day_of(cal.date_of(u32::MAX)).unwrap(), u32::MAX);
}

#[test]
fn extreme_valid_calendars_preserve_full_u32_day_range() {
    for cal in [
        Calendar::new(vec![1, 1], vec![0, 1], "短历".into(), Vec::new()).unwrap(),
        Calendar::new(vec![u16::MAX; 65_535], vec![0; 65_535], "长历".into(), Vec::new()).unwrap(),
    ] {
        for day in [0, 1, 2, 65_535, u32::MAX - 1, u32::MAX] {
            assert_eq!(cal.day_of(cal.date_of(day)).unwrap(), day);
            assert_eq!(cal.add_months(day, 0).unwrap(), day);
        }
    }
}

#[test]
fn legacy_free_functions_match_the_original_formulas() {
    for day in (0..36_000).chain([u32::MAX - 1, u32::MAX]) {
        assert_eq!(calendar::date_of(day), Date { year: day / 360 + 1, month: day % 360 / 30 + 1, day: day % 30 + 1 });
        assert_eq!(calendar::month_index(day), day / 30);
        assert_eq!(calendar::season_of(day), Season::ALL[(day % 360 / 90) as usize]);
        assert_eq!(calendar::is_month_end(day), day % 30 == 29);
        assert_eq!(calendar::is_year_end(day), day % 360 == 359);
    }
}
