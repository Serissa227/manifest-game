//! U05：按周排程的内核回归——周历、格重与进位、常设周课表、周中换阶段、旧档切换、装备效果。
use super::*;
use crate::{
    Command, CoreError, ScenarioId, StaticData, World,
    calendar::Calendar,
    replay::{LogEntry, Source, StartParams, replay},
    testkit,
};
use serde_json::{Value, json};
use std::sync::Arc;

const PLAYER: OwnerId = OwnerId::Player;

/// 测试世界：真实月长；`stages` 是家庭的阶段表；`weekly` 决定规则里有没有 `[upbringing.weekly]`。
fn defs(stages: Value, weekly: bool, rules: Value) -> Arc<StaticData> {
    let mut d = (*testkit::captain_defs()).clone();
    d.calendar =
        Calendar::new(vec![31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], vec![0; 12], "占位".into(), vec![])
            .unwrap();
    d.scenarios[0].upbringing = true;
    if weekly {
        d.rules.upbringing.weekly = Some(WeeklyRules::default());
    }
    let at = d.locations[0].key.clone();
    let stages: Vec<Value> = stages
        .as_array()
        .unwrap()
        .iter()
        .map(|s| json!({"from": s[0], "stage": s[1], "name": "占位", "at": at}))
        .collect();
    d.upbringing = serde_json::from_value(json!({
        "families":[{"key":"family","name":"占位","scenario":"test","home":at,"born":[1489,6,1],"gender":"f",
            "graduation":[1506,1,1],"stages":stages}],
        "rules": rules,
        "activities":[
            {"key":"rest","name":"休息","kind":"rest","fatigue":-22,"mood":8},
            {"key":"work","name":"打工","kind":"job","income":32,"gains":{"commerce":[8,8]},"fatigue":9,
                "skills":[{"skill":"ledger","xp":12}]},
            {"key":"class","name":"上课","kind":"lesson","cost":6,"gains":{"commerce":[10,10]},"fatigue":6},
            {"key":"study","name":"自习","kind":"lesson"}
        ]
    }))
    .unwrap();
    Arc::new(d)
}
fn home(weekly: bool) -> Arc<StaticData> {
    defs(json!([[[1502, 1, 1], "home"]]), weekly, json!({}))
}
fn academy(weekly: bool) -> Arc<StaticData> {
    defs(json!([[[1502, 1, 1], "academy"]]), weekly, json!({}))
}
fn world(d: &Arc<StaticData>) -> World {
    World::new(d.clone(), ScenarioId(0), 42).unwrap()
}
fn after(index: u8, key: &str) -> PlanSlot {
    PlanSlot { index, lesson: None, after: Some(AfterChoice::activity(key)) }
}
fn lesson(index: u8, key: &str) -> PlanSlot {
    PlanSlot { index, lesson: Some(key.into()), after: None }
}
/// 家乡的一周：三个自由格都排同一项。
fn home_week(key: &str) -> Command {
    Command::PlanWeek { owner: PLAYER, slots: (0..3).map(|i| after(i, key)).collect() }
}
/// 学院的一周：课、课余、课、课余、课。
fn academy_week(class: &str, free: &str) -> Command {
    Command::PlanWeek {
        owner: PLAYER,
        slots: vec![lesson(0, class), after(1, free), lesson(2, class), after(3, free), lesson(4, class)],
    }
}
fn month(key: &str) -> Command {
    Command::PlanMonth { owner: PLAYER, slots: (0..3).map(|i| after(i, key)).collect() }
}
fn state(w: &World) -> &UpbringingState {
    w.state.upbringing.as_ref().unwrap()
}
/// 养成活动带来的现金净额（收入减学费），按日记合计；世界里别的开销不算在内。
fn earned(w: &World) -> i64 {
    state(w).journal.iter().map(|j| j.result.cash).sum()
}
fn xp(w: &World, key: &str) -> i64 {
    w.upbringing_skill_xp(key)
}
/// 走到某月某日的早上；返回沿途每一格结算的日号。
fn run_until(w: &mut World, date: [u32; 3]) -> Vec<u32> {
    let mut settled = Vec::new();
    while w.cast_date() != date {
        let (day, before) = (w.cast_date()[2], state(w).journal.len());
        w.end_day().unwrap();
        if state(w).journal.len() > before {
            settled.push(day);
        }
    }
    settled
}

#[test]
fn a_month_is_always_four_weeks_and_the_fourth_takes_the_tail() {
    assert_eq!([1, 7, 8, 14, 15, 21, 22, 28, 29, 31].map(week_of), [0, 0, 1, 1, 2, 2, 3, 3, 3, 3]);
    assert_eq!([0, 1, 2, 3].map(week_start), [1, 8, 15, 22]);
    assert_eq!(week_bounds(30, 0), [1, 7]);
    assert_eq!(week_bounds(31, 3), [22, 31]);
    assert_eq!(week_bounds(28, 3), [22, 28]);
    let r = WeeklyRules::default();
    assert!(r.problems().is_empty());
    let days = |l: &WeekLayout| l.slots().iter().map(|s| (s.index, s.day, s.lesson, s.weight)).collect::<Vec<_>>();
    assert_eq!(days(&r.home), [(0, 2, false, 2), (1, 4, false, 2), (2, 6, false, 2)]);
    assert_eq!(
        days(&r.academy),
        [(0, 1, true, 2), (1, 2, false, 3), (2, 3, true, 2), (3, 4, false, 3), (4, 5, true, 2)]
    );
    // 每月四周，每一栏合计都仍是三个标准格。
    let column = |l: &WeekLayout, lesson: bool| {
        l.slots().iter().filter(|s| s.lesson == lesson).map(|s| i64::from(s.weight)).sum::<i64>() * i64::from(WEEKS)
    };
    assert_eq!(column(&r.home, false), 3 * UNIT);
    assert_eq!(column(&r.academy, true), 3 * UNIT);
    assert_eq!(column(&r.academy, false), 3 * UNIT);
    // 说不通的布局逐条报出来。
    let mut bad = WeeklyRules::default();
    bad.home.lesson_days = vec![1];
    bad.academy.after_days = vec![3, 8];
    bad.academy.after_weight = 9;
    assert_eq!(bad.problems().len(), 2);
    assert_eq!(rounded(14, 2), 4);
    assert_eq!(rounded(8, 2), 2);
    assert_eq!(rounded(-22, 2), -6);
    assert_eq!(rounded(7, 8), 7);
}

#[test]
fn a_home_month_of_quarter_slots_adds_up_to_three_standard_slots() {
    let d = home(true);
    let mut w = world(&d);
    assert!(state(&w).weekly.on && state(&w).phase == Phase::Plan && state(&w).next_slot == 0);
    assert!(matches!(w.end_day(), Err(CoreError::UpbringingPaused)));
    // 按周的月份不收月程；格数、格序、栏位不对的周程原样拒绝。
    let before = w.state.clone();
    assert!(month("work").apply(&mut w).is_err());
    assert!(academy_week("class", "rest").apply(&mut w).is_err());
    assert!(
        Command::PlanWeek { owner: PLAYER, slots: vec![after(0, "work"), after(2, "work"), after(1, "work")] }
            .apply(&mut w)
            .is_err()
    );
    assert!(
        Command::PlanWeek { owner: PLAYER, slots: vec![after(0, "work"), lesson(1, "class"), after(2, "work")] }
            .apply(&mut w)
            .is_err()
    );
    assert!(home_week("nothing").apply(&mut w).is_err());
    assert_eq!(before, w.state);
    let growth = w.upbringing_growth("commerce");
    home_week("work").apply(&mut w).unwrap();
    // 之后每周一照课表自动铺好，一路不停。
    let settled = run_until(&mut w, [1502, 2, 1]);
    assert_eq!(settled, [2, 4, 6, 9, 11, 13, 16, 18, 20, 23, 25, 27]);
    let s = state(&w);
    assert_eq!(s.phase, Phase::Running);
    assert_eq!(s.next_slot, 0);
    assert_eq!(Command::PlanWeek { owner: PLAYER, slots: s.plan.clone() }, home_week("work"));
    assert_eq!(s.weekly.home, s.plan);
    assert!(s.settled.is_empty() && s.weekly.carry.is_empty());
    assert!(s.journal.iter().all(|j| j.result.eighths == 2 && j.result.index < 3));
    assert_eq!(w.upbringing_completed_slots(), 3);
    // 12 格 × 2/8：成长 3×8、经验 3×12、收入 3×32、疲劳 3×9、次数 3。
    let weekly =
        (w.upbringing_growth("commerce") - growth, xp(&w, "ledger"), earned(&w), s.fatigue, s.activity_counts["work"]);
    assert_eq!(weekly, (24, 36, 96, 27, 3));
    testkit::check_invariants(&w).unwrap();
    // 同样的活动在按旬的世界排三旬，一个月下来数字相同。
    let mut old = world(&home(false));
    let growth = old.upbringing_growth("commerce");
    month("work").apply(&mut old).unwrap();
    run_until(&mut old, [1502, 2, 1]);
    let s = state(&old);
    let dekad = (
        old.upbringing_growth("commerce") - growth,
        xp(&old, "ledger"),
        earned(&old),
        s.fatigue,
        s.activity_counts["work"],
    );
    assert_eq!(weekly, dekad);
    // 重放：只有头一周的那一条命令。
    let history = [LogEntry { minute: None, tick: 0, seq: 0, source: Source::Player, command: home_week("work") }];
    let replayed = replay(d, StartParams::new(ScenarioId(0), 42), &history, 31).unwrap();
    assert_eq!(replayed.state, w.state);
}

#[test]
fn an_academy_week_is_three_lessons_and_two_afters() {
    let d = academy(true);
    let mut w = world(&d);
    let before = w.state.clone();
    for slots in [
        vec![lesson(0, "class"), lesson(1, "class"), lesson(2, "class"), after(3, "rest"), lesson(4, "class")],
        vec![lesson(0, "rest"), after(1, "rest"), lesson(2, "class"), after(3, "rest"), lesson(4, "class")],
        vec![lesson(0, "class"), after(1, "study"), lesson(2, "class"), after(3, "rest"), lesson(4, "class")],
        vec![after(0, "rest"), after(1, "rest"), after(2, "rest")],
        vec![
            PlanSlot { index: 0, lesson: Some("class".into()), after: Some(AfterChoice::activity("rest")) },
            after(1, "rest"),
            lesson(2, "class"),
            after(3, "rest"),
            lesson(4, "class"),
        ],
    ] {
        assert!(Command::PlanWeek { owner: PLAYER, slots }.apply(&mut w).is_err());
        assert_eq!(before, w.state);
    }
    let growth = w.upbringing_growth("commerce");
    academy_week("class", "rest").apply(&mut w).unwrap();
    let settled = run_until(&mut w, [1502, 2, 1]);
    assert_eq!(settled, [1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 22, 23, 24, 25, 26]);
    let s = state(&w);
    // 12 堂课 × 2/8 = 3 个标准格：成长 3×10、学费 3×6；8 格课余 × 3/8 = 3 个标准格的休息。
    assert_eq!(w.upbringing_growth("commerce") - growth, 30);
    assert_eq!(earned(&w), -18);
    assert_eq!((s.activity_counts["class"], s.activity_counts["rest"]), (3, 3));
    assert_eq!(w.upbringing_lessons_done(), 3);
    // 标准旬数只算课业格：按旬时一旬的课业与课后合算一旬。
    assert_eq!(w.upbringing_completed_slots(), 3);
    assert!(s.journal.iter().all(|j| j.result.eighths == if j.result.index % 2 == 0 { 2 } else { 3 }));
    testkit::check_invariants(&w).unwrap();
}

#[test]
fn counts_carry_in_eighths_and_once_means_any_progress() {
    let mut w = world(&home(true));
    home_week("work").apply(&mut w).unwrap();
    run_until(&mut w, [1502, 1, 3]);
    let s = state(&w);
    assert_eq!(s.activity_counts["work"], 0);
    assert_eq!(w.upbringing_carry_of("count:work"), 2);
    assert_eq!(w.upbringing_activity_eighths("work"), 2);
    assert!(w.upbringing_activity_done("work", 1));
    assert!(!w.upbringing_activity_done("work", 2));
    assert!(!w.upbringing_activity_done("rest", 1));
    // 进位向下取整，余数恒在 0–7；负数也一样，两次合起来不多不少。
    assert_eq!(w.upbringing_carry("probe", -22, 2), -6);
    assert_eq!(w.upbringing_carry_of("probe"), 4);
    assert_eq!(w.upbringing_carry("probe", -22, 2), -5);
    assert_eq!(w.upbringing_carry_of("probe"), 0);
    assert!(!state(&w).weekly.carry.contains_key("probe"));
    assert_eq!(w.upbringing_carry("probe", 7, 8), 7);
    assert!(!state(&w).weekly.carry.contains_key("probe"));
}

#[test]
fn the_timetable_stops_only_when_a_slot_cannot_be_laid() {
    let mut w = world(&academy(true));
    academy_week("class", "rest").apply(&mut w).unwrap();
    run_until(&mut w, [1502, 1, 7]);
    // 周末钱只剩一块（一堂课这一格要两块）：下周一课表铺不上，停在安排阶段，并说得出是哪一格、为什么。
    let money = std::mem::replace(&mut w.state.agents.get_mut(&PLAYER).unwrap().cash, 1);
    run_until(&mut w, [1502, 1, 8]);
    assert_eq!(state(&w).phase, Phase::Plan);
    assert!(state(&w).plan.is_empty());
    assert!(matches!(w.end_day(), Err(CoreError::UpbringingPaused)));
    let (at, reason) = w.upbringing_timetable_problem().unwrap();
    assert_eq!(at, Some(0));
    assert!(!reason.is_empty());
    // 上一周的回顾还在，留到本周第一格结算。
    assert_eq!(state(&w).last.len(), 5);
    academy_week("study", "rest").apply(&mut w).unwrap();
    assert_eq!(state(&w).weekly.academy[0], lesson(0, "study"));
    assert!(w.upbringing_timetable_problem().is_none());
    w.state.agents.get_mut(&PLAYER).unwrap().cash = money;
    run_until(&mut w, [1502, 1, 9]);
    assert_eq!(state(&w).last.len(), 1);
    // 再往后又是一路不停。
    run_until(&mut w, [1502, 2, 1]);
    assert_eq!(state(&w).phase, Phase::Running);
}

#[test]
fn replanning_mid_week_keeps_settled_slots_and_writes_the_timetable() {
    let mut w = world(&home(true));
    home_week("work").apply(&mut w).unwrap();
    run_until(&mut w, [1502, 1, 3]);
    assert_eq!(state(&w).next_slot, 1);
    // 运行中改本周还没结算的格：已经结算的那一格不动，改了的写回课表。
    home_week("rest").apply(&mut w).unwrap();
    let s = state(&w);
    assert_eq!(s.phase, Phase::Running);
    assert_eq!(s.plan, vec![after(0, "work"), after(1, "rest"), after(2, "rest")]);
    assert_eq!(s.weekly.home, vec![after(0, "work"), after(1, "rest"), after(2, "rest")]);
    run_until(&mut w, [1502, 1, 9]);
    assert_eq!(state(&w).plan, vec![after(0, "work"), after(1, "rest"), after(2, "rest")]);
    // 带补选的格只管这一周。
    let mut walk = after(1, "rest");
    assert!(!one_off(&walk));
    walk.after.as_mut().unwrap().companion = Some("friend".into());
    assert!(one_off(&walk));
    assert_eq!(slot_activity(&walk), Some("rest"));
    assert_eq!(slot_activity(&lesson(0, "class")), Some("class"));
}

#[test]
fn a_stage_change_mid_week_relays_the_rest_of_the_week() {
    let d = defs(json!([[[1502, 1, 1], "home"], [[1502, 1, 10], "academy"]]), true, json!({}));
    let mut w = world(&d);
    home_week("work").apply(&mut w).unwrap();
    // 第二周照家乡的课表走到 9 日；10 日入学，本周余下的格按学院的布局重排（10、11、12 日）。
    let settled = run_until(&mut w, [1502, 1, 10]);
    assert_eq!(settled, [2, 4, 6, 9]);
    let s = state(&w);
    assert_eq!((s.phase, s.next_slot), (Phase::Plan, 2));
    assert!(s.plan.is_empty() && s.last.is_empty());
    assert!(matches!(w.end_day(), Err(CoreError::UpbringingPaused)));
    assert!(home_week("work").apply(&mut w).is_err());
    academy_week("class", "rest").apply(&mut w).unwrap();
    let settled = run_until(&mut w, [1502, 1, 15]);
    assert_eq!(settled, [10, 11, 12]);
    // 头一周交上来的整张周程都记进了学院课表：下一周接着自动走。
    assert_eq!(state(&w).phase, Phase::Running);
    let settled = run_until(&mut w, [1502, 2, 1]);
    assert_eq!(settled, [15, 16, 17, 18, 19, 22, 23, 24, 25, 26]);
    testkit::check_invariants(&w).unwrap();
}

#[test]
fn an_old_save_finishes_its_month_by_dekads_then_switches_to_weeks() {
    let mut old = world(&home(false));
    month("work").apply(&mut old).unwrap();
    run_until(&mut old, [1502, 1, 15]);
    let saved = serde_json::to_value(&old.state).unwrap();
    // 按旬的状态里没有任何按周的字段。
    let text = saved.to_string();
    assert!(!text.contains("\"weekly\"") && !text.contains("\"eighths\""));
    let d = home(true);
    let mut w = World::from_snapshot(d.clone(), serde_json::from_value(saved.clone()).unwrap()).unwrap();
    assert!(!w.upbringing_weekly() && state(&w).weekly.is_default());
    assert_eq!(state(&w).plan, state(&old).plan);
    assert!(home_week("work").apply(&mut w).is_err());
    // 当月按旬走完：中旬在 20 日、下旬在月末结算，数值与留在按旬世界里的那一局逐位相同。
    let settled = run_until(&mut w, [1502, 2, 1]);
    assert_eq!(settled, [20, 31]);
    run_until(&mut old, [1502, 2, 1]);
    assert_eq!(state(&w).growth, state(&old).growth);
    assert_eq!(state(&w).journal, state(&old).journal);
    // 下月 1 日切到按周，等玩家排第一周。
    let s = state(&w);
    assert!(s.weekly.on && w.upbringing_weekly());
    assert_eq!((s.phase, s.next_slot, s.settled.len(), s.previous_plan.len()), (Phase::Plan, 0, 3, 3));
    assert!(month("work").apply(&mut w).is_err());
    home_week("work").apply(&mut w).unwrap();
    let settled = run_until(&mut w, [1502, 3, 1]);
    assert_eq!(settled, [2, 4, 6, 9, 11, 13, 16, 18, 20, 23, 25, 27]);
    assert_eq!(w.upbringing_completed_slots(), 6);
    assert_eq!(state(&w).activity_counts["work"], 6);
    // 两种形状的存档都读得回来。
    let saved = serde_json::to_value(&w.state).unwrap();
    let back = World::from_snapshot(d, serde_json::from_value(saved).unwrap()).unwrap();
    assert_eq!(back.state.upbringing, w.state.upbringing);
    testkit::check_invariants(&w).unwrap();
}

#[test]
fn natural_recovery_is_weekly_and_keeps_the_monthly_total() {
    // 家乡的自由格排自习（不累也不回疲劳），只看周末的自然恢复。
    let d = defs(json!([[[1502, 1, 1], "home"]]), true, json!({"mood": {}}));
    let mut w = world(&d);
    w.state.upbringing.as_mut().unwrap().fatigue = 50;
    home_week("study").apply(&mut w).unwrap();
    // 每旬 5 → 每周 3.75：四个周末依次恢复 3、4、4、4，一个月合计仍是 15。
    let mut seen = Vec::new();
    for day in [8, 15, 22, 29] {
        run_until(&mut w, [1502, 1, day]);
        seen.push(state(&w).fatigue);
    }
    assert_eq!(seen, [47, 43, 39, 35]);
    assert_eq!(w.upbringing_carry_of("recovery"), 0);
}

#[test]
fn equipment_effects_reach_activity_gains_and_fatigue() {
    let mut d = (*home(false)).clone();
    d.items = serde_json::from_value(json!({"items":[
        {"key":"tonic","name":"补药","kind":"curio","rarity":1,"price":10,"use":[{"kind":"fatigue_pct","value":30}]},
        {"key":"abacus","name":"算盘","kind":"curio","rarity":1,"price":10,
            "use":[{"kind":"activity_pct","value":20,"activity":"work"}]}
    ]}))
    .unwrap();
    let mut w = World::new(Arc::new(d), ScenarioId(0), 42).unwrap();
    let work = w.defs.upbringing.activity("work").unwrap().clone();
    let rest = w.defs.upbringing.activity("rest").unwrap().clone();
    assert_eq!((w.upbringing_activity_bonus_bp(&work), w.upbringing_fatigue_relief_bp(&work)), (0, 0));
    let plain = w.upbringing_efficiency(&work);
    let active = &mut w.state.items.owners.entry(PLAYER).or_default().active;
    for item in ["tonic", "abacus"] {
        active.push(crate::items::inventory::ActiveItem { item: item.into(), until: 10_000 });
    }
    // 活动收益只加在限定的活动上；疲劳减免不分活动。
    assert_eq!(w.upbringing_activity_bonus_bp(&work), 2_000);
    assert_eq!(w.upbringing_activity_bonus_bp(&rest), 0);
    assert_eq!(w.upbringing_fatigue_relief_bp(&work), 3_000);
    assert_eq!(w.upbringing_efficiency(&work), plain * 120 / 100);
    assert_eq!(w.upbringing_efficiency(&rest), plain);
    w.state.upbringing.as_mut().unwrap().fatigue = 40;
    let growth = w.upbringing_growth("commerce");
    let mut result = SlotResult::default();
    w.settle_upbringing_activity(&work, 0, 0, &mut result).unwrap();
    // 成长 8 × 120% = 9（向下取整）；疲劳 9 × 70% = 6。
    assert_eq!(w.upbringing_growth("commerce") - growth, 9);
    assert_eq!(result.fatigue, 6);
    // 休息回的疲劳不打折。
    let mut result = SlotResult::default();
    w.settle_upbringing_activity(&rest, 1, 0, &mut result).unwrap();
    assert_eq!(result.fatigue, -22);
}

/// K01：技能的“活动收益”“疲劳减免”与装备走同一个读取点；只有当前等级生效，开关关着时不生效。
#[test]
fn skill_effects_reach_activity_gains_and_fatigue() {
    use crate::items::effects::{Effect, EffectKind};
    use crate::skills::{SkillEffects, SkillLevelEffects};
    let level = |kind, values: [i64; 3], activity: Option<&str>| SkillEffects {
        max_level: 3,
        summary: vec![],
        levels: (0..3)
            .map(|i| SkillLevelEffects {
                level: i as u32 + 1,
                xp: [60, 180, 360][i],
                effects: vec![Effect { activity: activity.map(Into::into), ..Effect::plain(kind, values[i]) }],
            })
            .collect(),
    };
    let make = |enabled: bool| {
        let mut d = (*home(false)).clone();
        d.rules.skill_effects.enabled = enabled;
        d.story2.skill_effects.insert("cooking".into(), level(EffectKind::FatiguePct, [2, 4, 6], None));
        d.story2.skill_effects.insert("poetry".into(), level(EffectKind::ActivityPct, [3, 6, 9], None));
        d.story2.skill_effects.insert("abacus".into(), level(EffectKind::ActivityPct, [10, 20, 30], Some("work")));
        let mut w = world(&Arc::new(d));
        let xp = &mut w.state.items.owners.entry(PLAYER).or_default().skill_xp;
        // 没有技能等级表：经验 ÷ 100 + 1 级（150 → 2 级，250 → 3 级）
        xp.insert("cooking".into(), 250);
        xp.insert("poetry".into(), 150);
        xp.insert("abacus".into(), 50);
        w
    };
    let off = make(false);
    let on = make(true);
    let work = on.defs.upbringing.activity("work").unwrap().clone();
    let rest = on.defs.upbringing.activity("rest").unwrap().clone();
    assert_eq!((off.upbringing_activity_bonus_bp(&work), off.upbringing_fatigue_relief_bp(&work)), (0, 0));
    // 打工：诗（不限活动，第 2 级 6%）与算盘（限打工，第 1 级 10%）合计 16%；休息只吃到诗的 6%。疲劳减免 6%（第 3 级）。
    assert_eq!(on.upbringing_activity_bonus_bp(&work), 1_600);
    assert_eq!(on.upbringing_activity_bonus_bp(&rest), 600);
    assert_eq!(on.upbringing_fatigue_relief_bp(&work), 600);
    assert_eq!(on.upbringing_efficiency(&work), off.upbringing_efficiency(&work) * 116 / 100);
    // 结算：成长 8 × 116% = 9；疲劳 9 × 94% = 8。
    let (mut off, mut on) = (off, on);
    for w in [&mut off, &mut on] {
        w.state.upbringing.as_mut().unwrap().fatigue = 40;
    }
    let mut results = Vec::new();
    for w in [&mut off, &mut on] {
        let growth = w.upbringing_growth("commerce");
        let mut result = SlotResult::default();
        w.settle_upbringing_activity(&work, 0, 0, &mut result).unwrap();
        results.push((w.upbringing_growth("commerce") - growth, result.fatigue));
    }
    assert_eq!(results, [(8, 9), (9, 8)]);
}

#[test]
fn effect_activities_must_be_real_activity_keys() {
    // 正例：限定的活动存在（含物品使用、套装加成），校验无话说。
    let mut d = (*home(false)).clone();
    d.items = serde_json::from_value(json!({"items":[
        {"key":"abacus","name":"算盘","kind":"curio","rarity":1,"price":10,
            "use":[{"kind":"activity_pct","value":20,"activity":"work"}]},
        {"key":"pillow","name":"枕头","kind":"curio","rarity":1,"price":10,
            "effects":[{"kind":"fatigue_pct","value":5}]}
    ],"sets":[{"key":"desk","name":"书桌","items":["abacus","pillow"],
        "bonus":[{"kind":"activity_pct","value":8,"activity":"rest"}]}]}))
    .unwrap();
    assert_eq!(crate::upbringing::validation::effect_activity_problems(&d), Vec::<String>::new());
    assert!(crate::upbringing::validation::validate(&d).iter().all(|e| !e.contains("效果限定的活动")));
    // 反例：物品、使用效果、套装里各写一个不存在的活动名，各报一条，并进入养成的数据校验。
    d.items = serde_json::from_value(json!({"items":[
        {"key":"globe","name":"地球仪","kind":"curio","rarity":1,"price":10,
            "effects":[{"kind":"activity_pct","value":8,"activity":"chart_study"}]},
        {"key":"glasses","name":"眼镜","kind":"curio","rarity":1,"price":10,
            "use":[{"kind":"activity_pct","value":8,"activity":"proofreading"}]}
    ],"sets":[{"key":"desk","name":"书桌","items":["globe","glasses"],
        "bonus":[{"kind":"activity_pct","value":8,"activity":"tea_gathering"}]}]}))
    .unwrap();
    let errors = crate::upbringing::validation::effect_activity_problems(&d);
    assert_eq!(errors.len(), 3, "{errors:?}");
    for name in ["chart_study", "proofreading", "tea_gathering"] {
        assert!(errors.iter().any(|e| e.contains(name)), "{name}：{errors:?}");
    }
    assert_eq!(crate::upbringing::validation::validate(&d).iter().filter(|e| e.contains("效果限定的活动")).count(), 3);
}

#[test]
fn auto_plan_fills_the_week_and_passes_its_own_check() {
    for d in [home(true), academy(true)] {
        let mut w = world(&d);
        for preset in AUTO_PRESETS {
            let slots = w.auto_plan(preset).unwrap();
            assert!(w.check_week_plan(PLAYER, &slots).is_ok(), "{preset}");
            assert_eq!(w.upbringing_plan_command(slots.clone()), Command::PlanWeek { owner: PLAYER, slots });
        }
        let slots = w.auto_plan("balanced").unwrap();
        w.upbringing_plan_command(slots.clone()).apply(&mut w).unwrap();
        // 周中重排：已经结算的格原样带回。
        run_until(&mut w, [1502, 1, 4]);
        let again = w.auto_plan("balanced").unwrap();
        let next = usize::from(state(&w).next_slot);
        assert!(next > 0);
        assert_eq!(again[..next], slots[..next]);
        w.upbringing_plan_command(again).apply(&mut w).unwrap();
        // 下一周“照上周”：上周的周程还排得上就原样照排。
        run_until(&mut w, [1502, 1, 8]);
        let previous = state(&w).previous_plan.clone();
        assert_eq!(previous.len(), state(&w).plan.len());
        assert_eq!(w.auto_plan("previous").unwrap(), previous);
    }
    // 按旬的世界照旧给三旬，命令仍是月程。
    let w = world(&home(false));
    let slots = w.auto_plan("balanced").unwrap();
    assert_eq!(slots.len(), 3);
    assert_eq!(w.upbringing_plan_command(slots.clone()), Command::PlanMonth { owner: PLAYER, slots });
}
