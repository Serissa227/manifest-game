//! U03：零用钱、奖学金学费与自动安排的打分规则；小型夹具，不读真实数据。
use super::*;
use crate::{Command, ScenarioId, StaticData, testkit, treasury::Flow};
use serde_json::{Value, json};
use std::sync::Arc;

fn course(key: &str, attr: &str, cost: i64) -> Value {
    // 与真实课表同形：主属性 6–10、副属性 2–4、技能经验 12。
    json!({"key":key,"name":"占位","kind":"lesson","cost":cost,"gains":{attr:[6,10],"stewardship":[2,4]},"fatigue":6,"mood":1,
        "skills":[{"skill":"lore","xp":12}],"stage":"academy","where":{"academy":"acad"}})
}
fn self_study() -> Value {
    json!({"key":"self_study","name":"占位","kind":"lesson","cost":0,"gains":{"seamanship":[3,5]},"fatigue":3,
        "stage":"academy","where":{"academy":"acad"}})
}
/// `academy_first`：开局就在学院；否则家乡两个月以后入学。`min`：奖学金的评价门槛（0 即生效）。
fn defs(academy_first: bool, min: i64) -> Arc<StaticData> {
    let mut d = (*testkit::captain_defs()).clone();
    d.scenarios[0].upbringing = true;
    d.rules.money.enabled = true;
    let at = d.locations[0].key.clone();
    let stages = if academy_first {
        json!([{"from":[1502,1,1],"stage":"academy","name":"占位","at":at,"academy":"acad"}])
    } else {
        json!([{"from":[1502,1,1],"stage":"home","name":"占位","at":at},
            {"from":[1502,3,1],"stage":"academy","name":"占位","at":at,"academy":"acad"}])
    };
    let penalty = json!({"fame":-1,"note":"占位"});
    let curriculum = vec![
        course("course_sea", "seamanship", 6),
        course("course_trade", "commerce", 6),
        course("course_arms", "arms", 6),
        self_study(),
    ];
    let mut activities = vec![
        json!({"key":"rest","name":"占位","kind":"rest","fatigue":-22,"mood":8}),
        json!({"key":"work","name":"占位","kind":"job","income":[20,30],"gains":{"commerce":[3,5]},"fatigue":8}),
        json!({"key":"drill","name":"占位","kind":"training","gains":{"arms":[5,9]},"fatigue":6}),
        json!({"key":"chat","name":"占位","kind":"social","cost":4,"gains":{"eloquence":[5,9]},"fatigue":3,"mood":5}),
        json!({"key":"walk","name":"占位","kind":"free","gains":{"seamanship":[2,4]},"fatigue":2,"mood":3}),
        json!({"key":"home_lesson","name":"占位","kind":"lesson","stage":"home","cost":4,"gains":{"numeracy":[5,9]},"fatigue":6}),
    ];
    activities.extend(curriculum.iter().cloned());
    d.upbringing = serde_json::from_value(json!({
        "rules":{"auto_presets":{"navigation":["seamanship"],"trade":["commerce","numeracy"],"combat":["arms"],
            "learning":["numeracy"],"social":["eloquence"]}},
        "families":[{"key":"family","name":"占位","scenario":"test","home":at,"born":[1489,6,1],"gender":"f",
            "graduation":[1506,1,1],"allowance":{"home":15,"academy":30},"stages":stages}],
        "academies":[{"key":"acad","name":"占位","at":at,"allowance":4,"curriculum":curriculum,
            "rules":{"late":penalty,"fighting":penalty,"night_absence":penalty,
                "scholarship":{"rating":"none","min":min,"honor_min":0,"fee_discount_pct":50},
                "recommendation":{"exam":"none","honor_min":0,"item":"none"}}}],
        "activities":activities
    }))
    .unwrap();
    Arc::new(d)
}
fn world(academy_first: bool, min: i64) -> World {
    World::new(defs(academy_first, min), ScenarioId(0), 42).unwrap()
}
fn cash(w: &World) -> i64 {
    w.agent(OwnerId::Player).unwrap().cash
}
fn set_cash(w: &mut World, value: i64) {
    w.agent_mut(OwnerId::Player).unwrap().cash = value;
}
fn keys(slots: &[PlanSlot]) -> Vec<String> {
    slots.iter().flat_map(|s| s.lesson.iter().cloned().chain(s.after.iter().map(|a| a.activity.clone()))).collect()
}
fn lessons(slots: &[PlanSlot]) -> Vec<String> {
    slots.iter().filter_map(|s| s.lesson.clone()).collect()
}
fn afters(slots: &[PlanSlot]) -> Vec<String> {
    slots.iter().filter_map(|s| s.after.as_ref().map(|a| a.activity.clone())).collect()
}
/// 按“均衡”逐日推进，直到日期到 `until`（含当天开头）。
fn run_until(w: &mut World, until: WorldDate) {
    while w.cast_date() < until {
        if w.state.upbringing.as_ref().is_some_and(|s| s.phase == Phase::Plan) {
            let slots = w.auto_plan("balanced").unwrap();
            Command::PlanMonth { owner: OwnerId::Player, slots }.apply(w).unwrap();
        }
        w.end_day().unwrap();
    }
}
/// 把日历挪到某月一日（只给打分规则用，不经过日结算）。
fn jump_to_month(w: &mut World, month: u32) {
    let day = crate::scenario::day_of(&w.defs, [1502, month, 1]).unwrap();
    w.state.day = day;
    let s = w.state.upbringing.as_mut().unwrap();
    s.month = [1502, month];
    s.next_slot = 0;
}
fn journal(w: &mut World, month: u32, activity: &str) {
    let day = crate::scenario::day_of(&w.defs, [1502, month, 5]).unwrap();
    let s = w.state.upbringing.as_mut().unwrap();
    s.journal
        .push(JournalEntry { day, result: SlotResult { activities: vec![activity.into()], ..Default::default() } });
}

#[test]
fn allowance_arrives_each_month_as_an_external_source_and_money_is_conserved() {
    let mut w = world(false, 0);
    assert_eq!(w.upbringing_budget().allowance, 15);
    assert_eq!(w.upbringing_budget().allowance_next, 15);
    // 开局月份不另发：家里给的本钱就是第一个月的钱。
    assert!(!w.state.money.sources.contains_key(&Flow::UpbringingAllowance));
    // 推进到一月最后一天的开头，再结算这一天。
    let february = crate::scenario::day_of(&w.defs, [1502, 2, 1]).unwrap();
    while w.day() + 1 < february {
        if w.state.upbringing.as_ref().is_some_and(|s| s.phase == Phase::Plan) {
            let slots = w.auto_plan("balanced").unwrap();
            Command::PlanMonth { owner: OwnerId::Player, slots }.apply(&mut w).unwrap();
        }
        w.end_day().unwrap();
    }
    let total = w.all_money();
    w.end_day().unwrap();
    assert_eq!(w.cast_date(), [1502, 2, 1]);
    // 零用钱记为外部来源，对手是腹地：全部账户之和不变，按记录推算的货币总量也对得上。
    assert_eq!(w.state.money.sources.get(&Flow::UpbringingAllowance), Some(&15));
    assert_eq!(w.all_money(), total);
    assert!(w.money_conserved());
    // 三月一日入学：学院期按家里 30 加学院津贴 4 发。
    run_until(&mut w, [1502, 3, 1]);
    assert_eq!(w.upbringing_allowance_on(w.cast_date()), 34);
    assert_eq!(w.state.money.sources.get(&Flow::UpbringingAllowance), Some(&(15 + 34)));
    assert!(w.money_conserved());
    testkit::check_invariants(&w).unwrap();
    let loaded = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    assert_eq!(loaded.state, w.state);
}

#[test]
fn skipped_upbringing_gets_no_allowance() {
    let mut w = world(false, 0);
    Command::SkipUpbringing { owner: OwnerId::Player }.apply(&mut w).unwrap();
    for _ in 0..70 {
        w.end_day().unwrap();
    }
    assert!(!w.state.money.sources.contains_key(&Flow::UpbringingAllowance));
    assert!(w.money_conserved());
}

#[test]
fn scholarship_discount_reaches_budget_plan_and_settlement() {
    let mut w = world(true, 0);
    let b = w.upbringing_budget();
    assert_eq!(b.lesson_cost, 3);
    assert!(b.scholarship.as_ref().is_some_and(|s| s.active && s.discount_pct == 50));
    assert_eq!(lessons(&w.auto_plan("trade").unwrap())[0], "course_trade");
    // 课后都排休息，结算出来的钱数就只有学费。
    let slots = (0..3)
        .map(|index| PlanSlot {
            index,
            lesson: Some("course_trade".into()),
            after: Some(AfterChoice::activity("rest")),
        })
        .collect();
    Command::PlanMonth { owner: OwnerId::Player, slots }.apply(&mut w).unwrap();
    let before = cash(&w);
    for _ in 0..10 {
        w.end_day().unwrap();
    }
    assert_eq!(w.state.upbringing.as_ref().unwrap().journal[0].result.cash, -3);
    assert_eq!(cash(&w), before - 3);
    assert!(w.money_conserved());
    let full = world(true, 1);
    let b = full.upbringing_budget();
    assert_eq!(b.lesson_cost, 6);
    assert!(b.scholarship.as_ref().is_some_and(|s| !s.active));
}

#[test]
fn every_preset_plans_a_legal_month_in_any_state() {
    for academy_first in [false, true] {
        let base = world(academy_first, 1);
        for cash_now in [0, 2, 5, 40, 500] {
            for fatigue in [0, 29, 45, 60, 79, 95, 100] {
                for mood in [-100, 0, 100] {
                    for ill in [false, true] {
                        for outings in [0, 2] {
                            for next in [0, 1, 2] {
                                let mut w = base.clone();
                                set_cash(&mut w, cash_now);
                                let day = w.day();
                                let s = w.state.upbringing.as_mut().unwrap();
                                s.fatigue = fatigue;
                                s.mood = mood;
                                s.ill_until = ill.then_some(day + 5);
                                s.outings = outings;
                                s.next_slot = next;
                                for preset in AUTO_PRESETS {
                                    let slots = w.auto_plan(preset).unwrap_or_else(|e| {
                                        panic!("{preset}/{cash_now}/{fatigue}/{mood}/{ill}/{outings}/{next}: {e}")
                                    });
                                    w.check_month_plan(OwnerId::Player, &slots).unwrap();
                                    let cost: i64 = keys(&slots[usize::from(next)..])
                                        .iter()
                                        .map(|k| w.upbringing_activity_cost(w.defs.upbringing.activity(k).unwrap()))
                                        .sum();
                                    assert!(cost <= cash_now.max(0), "{preset}: 花费 {cost} 超过现金 {cash_now}");
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn rest_is_worth_nothing_below_30_and_preferred_from_60() {
    let mut w = world(true, 1);
    set_cash(&mut w, 200);
    w.state.upbringing.as_mut().unwrap().fatigue = 10;
    for preset in AUTO_PRESETS {
        assert!(!afters(&w.auto_plan(preset).unwrap()).contains(&"rest".to_string()), "{preset}");
    }
    w.state.upbringing.as_mut().unwrap().fatigue = 75;
    for preset in ["balanced", "trade", "combat", "navigation"] {
        assert_eq!(afters(&w.auto_plan(preset).unwrap())[0], "rest", "{preset}");
    }
}

#[test]
fn tight_money_takes_free_self_study_and_puts_jobs_first() {
    let mut w = world(true, 1);
    set_cash(&mut w, 0);
    assert!(w.upbringing_budget().tight);
    let slots = w.auto_plan("balanced").unwrap();
    assert_eq!(lessons(&slots), ["self_study", "self_study", "self_study"]);
    assert_eq!(afters(&slots)[0], "work");
    assert_eq!(afters(&slots).iter().filter(|k| *k == "work").count(), 2);
    let mut rich = w.clone();
    set_cash(&mut rich, 300);
    assert!(lessons(&rich.auto_plan("balanced").unwrap()).iter().all(|k| k != "self_study"));
}

#[test]
fn next_month_tuition_is_reserved_before_spending() {
    let mut w = world(false, 1);
    jump_to_month(&mut w, 2);
    set_cash(&mut w, 20);
    let b = w.upbringing_budget();
    // 三月入学：三门课 18，扣掉三月的零用钱 34 不缺；把家里给的改成 0 才要留。
    assert_eq!((b.tuition_next, b.allowance_next, b.reserve), (18, 34, 0));
    let mut d = (*w.defs).clone();
    d.upbringing.families[0].allowance.academy = 0;
    let mut poor = World::from_snapshot(Arc::new(d), w.state.clone()).unwrap();
    set_cash(&mut poor, 20);
    let b = poor.upbringing_budget();
    assert_eq!((b.tuition_next, b.allowance_next, b.reserve), (18, 4, 14));
    let slots = poor.auto_plan("social").unwrap();
    let cost: i64 =
        keys(&slots).iter().map(|k| poor.upbringing_activity_cost(poor.defs.upbringing.activity(k).unwrap())).sum();
    assert!(cost <= 20 - 14, "留出下月学费后只剩 6：{slots:?}");
}

#[test]
fn presets_weight_their_rating_attributes_not_tags() {
    let mut w = world(true, 1);
    set_cash(&mut w, 500);
    for (preset, course) in [("trade", "course_trade"), ("combat", "course_arms"), ("navigation", "course_sea")] {
        let picked = lessons(&w.auto_plan(preset).unwrap());
        assert_eq!(picked[0], course, "{preset}");
        assert!(picked.iter().filter(|k| *k == course).count() >= 2, "{preset}: {picked:?}");
    }
    assert_eq!(afters(&w.auto_plan("combat").unwrap())[0], "drill");
}

#[test]
fn same_lesson_is_never_scheduled_three_months_running() {
    let mut w = world(true, 1);
    jump_to_month(&mut w, 3);
    set_cash(&mut w, 500);
    journal(&mut w, 2, "course_trade");
    assert!(lessons(&w.auto_plan("trade").unwrap()).contains(&"course_trade".to_string()));
    journal(&mut w, 1, "course_trade");
    let picked = lessons(&w.auto_plan("trade").unwrap());
    assert!(!picked.contains(&"course_trade".to_string()), "{picked:?}");
}

#[test]
fn every_month_has_a_social_or_outing_slot() {
    for academy_first in [false, true] {
        let mut w = world(academy_first, 1);
        set_cash(&mut w, 500);
        for preset in AUTO_PRESETS {
            let slots = w.auto_plan(preset).unwrap();
            assert!(
                afters(&slots).iter().any(|k| social_kind(w.defs.upbringing.activity(k).unwrap().kind)),
                "{academy_first}/{preset}: {slots:?}"
            );
        }
    }
}

#[test]
fn previous_month_is_repeated_only_while_affordable_and_not_exhausting() {
    let mut w = world(true, 1);
    set_cash(&mut w, 500);
    let plan = w.auto_plan("trade").unwrap();
    w.state.upbringing.as_mut().unwrap().previous_plan = plan.clone();
    assert_eq!(w.auto_plan("previous").unwrap(), plan);
    w.state.upbringing.as_mut().unwrap().fatigue = 70;
    assert_ne!(w.auto_plan("previous").unwrap(), plan);
    w.state.upbringing.as_mut().unwrap().fatigue = 0;
    set_cash(&mut w, 1);
    assert_ne!(w.auto_plan("previous").unwrap(), plan);
    // 上个月累了排的休息，这个月不累就不照抄。
    set_cash(&mut w, 500);
    w.state.upbringing.as_mut().unwrap().fatigue = 75;
    let tired = w.auto_plan("balanced").unwrap();
    assert!(afters(&tired).contains(&"rest".to_string()));
    w.state.upbringing.as_mut().unwrap().previous_plan = tired.clone();
    w.state.upbringing.as_mut().unwrap().fatigue = 40;
    assert_eq!(w.auto_plan("previous").unwrap(), tired);
    w.state.upbringing.as_mut().unwrap().fatigue = 10;
    assert!(!afters(&w.auto_plan("previous").unwrap()).contains(&"rest".to_string()));
}

#[test]
fn planner_choice_limits_truth_table() {
    for cadence in [false, true] {
        for companion in [false, true] {
            for excursion in [false, true] {
                for (planned_outings, planned_excursions) in (0..=2).flat_map(|o| (0..=2).map(move |e| (o, e))) {
                    for cooled in [false, true] {
                        for this_week in [0, 1] {
                            for four_weeks in [this_week, 3] {
                                for (monthly_outings, monthly_excursions) in
                                    [0, 2].into_iter().flat_map(|o| [0, 2].into_iter().map(move |e| (o, e)))
                                {
                                    for limit in [0, 2] {
                                        let mut w = world(false, 0);
                                        let rule = cadence::CadenceRules { enabled: cadence, ..Default::default() };
                                        Arc::make_mut(&mut w.defs).rules.upbringing.cadence = Some(rule);
                                        Arc::make_mut(&mut w.defs).rules.upbringing.weekly = Some(Default::default());
                                        let s = w.state.upbringing.as_mut().unwrap();
                                        s.outings = monthly_outings;
                                        s.weekly.excursions = monthly_excursions;
                                        s.cadence.last_outing_week = (!cooled).then_some(3);
                                        s.cadence.on = true;
                                        s.weekly.on = true;
                                        s.cadence.week = 3;
                                        // 第 4 周：前一周的记录仍在四周窗口内。
                                        w.state.day = 21;
                                        w.state.upbringing.as_mut().unwrap().cadence.excursion_weeks =
                                            std::iter::repeat_n(3, this_week)
                                                .chain(std::iter::repeat_n(2, four_weeks - this_week))
                                                .collect();
                                        let b = w.upbringing_budget();
                                        let mut p = w.planner("balanced", &b).unwrap();
                                        p.outings = monthly_outings + planned_outings as u8;
                                        p.excursions = monthly_excursions + planned_excursions as u8;
                                        p.excursion_limit = limit;
                                        p.planned_outings = planned_outings;
                                        p.planned_excursions = planned_excursions;
                                        let mut choice = AfterChoice::activity("rest");
                                        choice.companion = companion.then(|| "classmate".into());
                                        choice.excursion = excursion.then(|| "outing".into());
                                        let outing_ok = if cadence {
                                            planned_outings == 0 && cooled
                                        } else {
                                            usize::from(monthly_outings) + planned_outings < 2
                                        };
                                        let excursion_ok = if cadence {
                                            this_week + planned_excursions < 1 && four_weeks + planned_excursions < 3
                                        } else {
                                            limit == 0
                                                || usize::from(monthly_excursions) + planned_excursions
                                                    < usize::from(limit)
                                        };
                                        let expected = (!companion || outing_ok) && (!excursion || excursion_ok);
                                        let actual = p.choice_fits(&choice);
                                        println!(
                                            "cadence={cadence} companion={companion} excursion={excursion} planned_outings={planned_outings} planned_excursions={planned_excursions} cooled={cooled} this_week={this_week} four_weeks={four_weeks} monthly_outings={monthly_outings} monthly_excursions={monthly_excursions} limit={limit} outing_ok={outing_ok} excursion_ok={excursion_ok} actual={actual}"
                                        );
                                        assert_eq!(actual, expected);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
