//! U05 养成排程按周：用实际加载的数据测内核单元测试夹具里没有的部分——
//! 只有寰宇写了 `[upbringing.weekly]`；远足按次给奖励，所以每月限次（testbed 的远足图 + 注入按周规则）；
//! 寰宇的新局从第一天起按周、不收月程，按周跑满一个月。
use manifest_core::{
    Command, OwnerId, ScenarioId, World,
    upbringing::{AfterChoice, Phase, PlanSlot, weekly::WeeklyRules},
};
use std::sync::Arc;

fn data() -> std::path::PathBuf {
    manifest_data::find_data_dir().unwrap()
}
fn testbed_weekly() -> Arc<manifest_core::StaticData> {
    let mut d = manifest_data::load_world(&data(), "testbed").unwrap();
    Arc::make_mut(&mut d).rules.upbringing.weekly = Some(WeeklyRules::default());
    d
}
fn world(d: Arc<manifest_core::StaticData>, scenario: &str) -> World {
    let i = d.scenarios.iter().position(|s| s.key == scenario).unwrap();
    World::new(d, ScenarioId::from_idx(i), 42).unwrap()
}
fn answer(w: &mut World) {
    while w.pending_story2().is_some() {
        Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(w).unwrap();
    }
}
fn walk() -> AfterChoice {
    let mut c = AfterChoice::activity("excursion_walk");
    c.excursion = Some("test_walk".into());
    c.node = Some("path_0".into());
    c
}
fn week(n: usize, excursions: usize) -> Vec<PlanSlot> {
    (0..n)
        .map(|i| PlanSlot {
            index: i as u8,
            lesson: None,
            after: Some(if i < excursions { walk() } else { AfterChoice::activity("rest") }),
        })
        .collect()
}

#[test]
fn only_terra16_plans_by_week() {
    for (world, weekly) in [("terra16", true), ("classic", false), ("testbed", false)] {
        let d = manifest_data::load_world(&data(), world).unwrap();
        assert_eq!(d.rules.upbringing.weekly.is_some(), weekly, "{world}");
        if let Some(r) = &d.rules.upbringing.weekly {
            assert!(r.problems().is_empty(), "{world}：{:?}", r.problems());
            // 家乡每周 3 格 × 2/8、学院 3 课 × 2/8 + 2 课余 × 3/8：每月（四周）都是 3 个标准格。
            let month = |l: &manifest_core::upbringing::weekly::WeekLayout| {
                4 * (l.lesson_days.len() as i64 * i64::from(l.lesson_weight)
                    + l.after_days.len() as i64 * i64::from(l.after_weight))
            };
            assert_eq!(month(&r.home), 24);
            assert_eq!(r.academy.after_days.len(), 2);
            assert_eq!(r.academy.lesson_days.len(), 3);
            assert_eq!(4 * r.academy.lesson_days.len() as i64 * i64::from(r.academy.lesson_weight), 24);
            assert_eq!(4 * r.academy.after_days.len() as i64 * i64::from(r.academy.after_weight), 24);
        }
    }
}

#[test]
fn excursions_are_capped_per_month_because_their_rewards_do_not_shrink() {
    let d = testbed_weekly();
    let limit = usize::from(d.rules.upbringing.weekly.as_ref().unwrap().excursions_per_month);
    assert_eq!(limit, 3);
    let mut w = world(d.clone(), "upbringing");
    answer(&mut w);
    assert!(w.upbringing_weekly());
    let n = w.upbringing_week_slots().len();
    assert_eq!(n, 3);
    // 按周的月份不收月程
    assert!(Command::PlanMonth { owner: OwnerId::Player, slots: week(n, 0) }.apply(&mut w).is_err());
    // 第一周三格都去远足：在每月 3 次之内，收
    Command::PlanWeek { owner: OwnerId::Player, slots: week(n, n) }.apply(&mut w).unwrap();
    for _ in 0..7 {
        answer(&mut w);
        w.end_day().unwrap();
    }
    let used = usize::from(w.state.upbringing.as_ref().unwrap().weekly.excursions);
    assert!((1..=limit).contains(&used), "第一周走了 {used} 次远足");
    // 第二周：超出本月余下次数的周程整张拒收，状态不变
    answer(&mut w);
    let left = limit - used;
    if left < n {
        let before = w.state.clone();
        let err = Command::PlanWeek { owner: OwnerId::Player, slots: week(n, left + 1) }.apply(&mut w).unwrap_err();
        assert!(err.to_string().contains("每月最多 3 次远足"), "{err}");
        assert_eq!(w.state, before);
    }
    Command::PlanWeek { owner: OwnerId::Player, slots: week(n, left) }.apply(&mut w).unwrap();
    // 跑到下个月 1 日：本月次数清零
    let month = w.state.upbringing.as_ref().unwrap().month;
    while w.state.upbringing.as_ref().unwrap().month == month {
        answer(&mut w);
        if w.state.upbringing.as_ref().unwrap().phase == Phase::Plan {
            let slots = week(w.upbringing_week_slots().len(), 0);
            Command::PlanWeek { owner: OwnerId::Player, slots }.apply(&mut w).unwrap();
        }
        w.end_day().unwrap();
        assert!(usize::from(w.state.upbringing.as_ref().unwrap().weekly.excursions) <= limit);
    }
    assert_eq!(w.state.upbringing.as_ref().unwrap().weekly.excursions, 0);
    // 存档往返：按周的状态逐字节读回
    let back = World::from_snapshot(d, w.state.clone()).unwrap();
    assert_eq!(back.state.upbringing, w.state.upbringing);
}
