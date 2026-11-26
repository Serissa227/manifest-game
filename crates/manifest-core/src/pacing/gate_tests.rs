//! 节奏闸的内核回归（P11 第二阶段）：闸的每一条规则、先后次序、幂等、旧档兼容、规则关闭时不留痕迹、
//! 跳过养成时不过闸、旬许可的保留与队首可答优先。
//!
//! 夹具沿用分类测试的小型世界：没有养成的剧本里轨道按出海后的规则分（request 是可以等的故事、encounter 是奇遇、
//! main 与带窗口的是要紧的）；养成剧本里自动开始的学院线是不经旬调度的羁绊线。
use super::tests::{
    PLAYER, after_first_slot, answer, base, classic_defs, create_captain, event, rest_month, track, world,
};
use super::*;
use crate::defs::PacingRules;
use crate::story2::Status;
use crate::upbringing::Phase;
use crate::{Command, LocId, RegionId, StaticData, testkit};
use serde_json::{Value, json};
use std::sync::Arc;

fn on() -> PacingRules {
    PacingRules { enabled: true, ..PacingRules::default() }
}

/// 没有养成的剧本，加上给定的节奏规则。
fn sea_defs(tracks: Value, rules: PacingRules) -> StaticData {
    let mut d = base(tracks);
    d.scenarios[0].upbringing = false;
    d.rules.pacing = rules;
    d
}

fn sea(tracks: Value, rules: PacingRules) -> World {
    world(sea_defs(tracks, rules))
}

/// 养成剧本（家乡期），加上给定的节奏规则。
fn home(tracks: Value, rules: PacingRules) -> World {
    let mut d = base(tracks);
    d.rules.pacing = rules;
    world(d)
}

/// 可以等的故事（Major）。
fn side(key: &str) -> Value {
    track(key, "request", json!({}), &[("first", json!([]), "done")])
}

/// 奇遇（Minor）。
fn chance(key: &str) -> Value {
    track(key, "encounter", json!({}), &[("first", json!([]), "done")])
}

/// 立了旗标才出场的故事。
fn flagged(key: &str, flag: &str) -> Value {
    track(key, "request", json!({}), &[("first", json!([{"kind":"flag","flag":flag}]), "done")])
}

/// 自动开始的学院线：养成期里不经旬调度的羁绊线（Major）。
fn bond(key: &str) -> Value {
    track(key, "request", json!({"academy":true}), &[("first", json!([]), "done")])
}

fn queued(w: &World) -> Vec<(&str, u32)> {
    w.state.story2.pending.iter().map(|p| (p.track.as_str(), p.day)).collect()
}

fn held(w: &World) -> Vec<(&str, u32)> {
    w.state.pacing.held.iter().map(|(track, h)| (track.as_str(), h.since)).collect()
}

fn log(w: &World) -> Vec<(u32, BeatWeight)> {
    w.state.pacing.log.iter().map(|r| (r.day, r.weight)).collect()
}

fn set_flag(w: &mut World, flag: &str, on: bool) {
    if on {
        w.state.story2.flags.insert(flag.into());
    } else {
        w.state.story2.flags.remove(flag);
    }
    w.refresh_story2();
}

/// 养成期过一天：需要时先排月程，把在等的事都答掉，再日结。
fn pass_day(w: &mut World) {
    if w.state.upbringing.as_ref().is_some_and(|s| s.phase == Phase::Plan) {
        rest_month(w);
    }
    for _ in 0..100 {
        if w.pending_story2().is_none() {
            break;
        }
        answer(w);
    }
    w.end_day().unwrap();
}

use BeatWeight::{Key, Major, Minor};

#[test]
fn rules_default_to_off_with_the_documented_budget() {
    let rules = PacingRules::default();
    assert_eq!(
        (rules.enabled, rules.daily, rules.window_days, rules.window_soft, rules.max_defer_days),
        (false, 2, 7, 3, 10)
    );
    assert!(rules.problems().is_empty());
    // 关着的时候不看数值；开着的时候上限不能是 0。
    let zero = PacingRules { enabled: false, daily: 0, window_days: 0, window_soft: 0, max_defer_days: 0 };
    assert!(zero.problems().is_empty());
    let fields: Vec<_> = PacingRules { enabled: true, ..zero }.problems().into_iter().map(|(f, _)| f).collect();
    assert_eq!(fields, ["daily", "window_days", "window_soft"]);
    assert!(testkit::default_rules().pacing == PacingRules::default());
}

#[test]
fn a_soft_event_is_admitted_by_last_chance_then_daily_cap_then_wait_then_window() {
    let rules = on();
    let b = |today, soft| Budget { today, soft };
    // 预算有余：放行。
    assert!(rules.admits(b(0, 0), false, 0));
    assert!(rules.admits(b(1, 2), false, 0));
    // 当天已经两件：按下，等满了也一样。
    assert!(!rules.admits(b(2, 0), false, 0));
    assert!(!rules.admits(b(2, 0), false, 10));
    // 窗口内已经三件：按下；等满一旬就不看窗口了。
    assert!(!rules.admits(b(0, 3), false, 9));
    assert!(rules.admits(b(0, 3), false, 10));
    assert!(rules.admits(b(1, 9), false, 11));
    // 最后一天：什么上限都不看。
    assert!(rules.admits(b(5, 9), true, 0));

    // 账面只数窗口里的：今天、六天前算，七天前不算；要紧的只占当天的名额。
    let state = PacingState {
        log: vec![
            Released { day: 13, weight: Major },
            Released { day: 14, weight: Minor },
            Released { day: 20, weight: Key },
            Released { day: 20, weight: Major },
        ],
        ..PacingState::default()
    };
    assert_eq!(state.budget(&rules, 20), b(2, 2));
    assert_eq!(state.budget(&rules, 21), Budget { today: 0, soft: 1 });
    // 日结里先记到明天的账，今天不算。
    assert_eq!(state.budget(&rules, 19), Budget { today: 0, soft: 2 });
    let mut budget = b(0, 0);
    budget.note(Key);
    budget.note(Minor);
    assert_eq!(budget, b(2, 1));
}

#[test]
fn soft_events_queue_by_last_chance_wait_slot_weight_deadline_then_age() {
    let rules = on();
    let beat = |weight, deadline: Option<u32>, slot: Option<u8>| Beat {
        source: BeatSource::Bond,
        weight,
        key: String::new(),
        chapter: None,
        since: 0,
        deadline,
        slot,
    };
    let today = 100;
    let rank = |last, since, b: &Beat| SoftRank::new(&rules, today, last, since, b);
    // 按期望的先后排好，逐对比较。
    let order = [
        // 今天是最后一天的
        rank(true, 100, &beat(Minor, Some(100), None)),
        // 等满的：等得久的在前
        rank(false, 80, &beat(Minor, None, None)),
        rank(false, 90, &beat(Major, None, Some(0))),
        // 经旬调度入选的
        rank(false, 100, &beat(Minor, None, Some(1))),
        // Major 先于 Minor
        rank(false, 100, &beat(Major, Some(130), None)),
        // 截止日早的
        rank(false, 100, &beat(Major, Some(140), None)),
        // 等得久的
        rank(false, 95, &beat(Major, None, None)),
        rank(false, 100, &beat(Major, None, None)),
        rank(false, 91, &beat(Minor, None, None)),
    ];
    for pair in order.windows(2) {
        assert!(pair[0] < pair[1], "{pair:?}");
    }
}

#[test]
fn soft_arrivals_are_spread_by_the_daily_cap_and_the_rolling_window() {
    let tracks = json!([side("a"), side("b"), side("c"), side("d"), side("e"), chance("z")]);
    let mut w = sea(tracks, on());
    // 当天两件：故事先于奇遇，同类按轨道名。
    assert_eq!(queued(&w), [("a", 0), ("b", 0)]);
    assert_eq!(held(&w), [("c", 0), ("d", 0), ("e", 0), ("z", 0)]);
    assert_eq!(log(&w), [(0, Major), (0, Major)]);
    // 第二天窗口里还差一件。
    w.end_day().unwrap();
    assert_eq!(queued(&w), [("a", 0), ("b", 0), ("c", 1)]);
    // 之后窗口满着：谁也不出。
    for day in 2..7 {
        w.end_day().unwrap();
        assert_eq!(w.day(), day);
        assert_eq!(queued(&w).len(), 3, "第 {day} 天");
        assert_eq!(held(&w), [("d", 0), ("e", 0), ("z", 0)]);
    }
    // 第 7 天，第 0 天的两件滑出窗口：再出两件（单日上限）。
    w.end_day().unwrap();
    assert_eq!(queued(&w), [("a", 0), ("b", 0), ("c", 1), ("d", 7), ("e", 7)]);
    assert_eq!(held(&w), [("z", 0)]);
    // 第 8 天轮到奇遇。按下的事没有被丢掉，只是晚了几天。
    w.end_day().unwrap();
    assert_eq!(queued(&w).last(), Some(&("z", 8)));
    assert!(w.state.pacing.held.is_empty());
    assert_eq!(log(&w), [(7, Major), (7, Major), (8, Minor)]);
    // 被按着的时候不在队列里：时钟不等它，界面也看不见它。
    assert!(w.pacing_held().is_empty());
}

#[test]
fn key_events_are_never_held_and_a_continuation_is_free() {
    let main =
        |key: &str| track(key, "main", json!({}), &[("first", json!([]), "second"), ("second", json!([]), "done")]);
    let mut windowed = side("timed");
    windowed["chapters"][0]["window"] = json!([[1502, 1, 1], [1502, 3, 1]]);
    let mut w = sea(json!([main("m1"), main("m2"), windowed, side("a")]), on());
    // 三件要紧的都当天出场（超过单日上限也出），占满名额；可以等的那件按下。
    assert_eq!(queued(&w), [("m1", 0), ("m2", 0), ("timed", 0)]);
    assert_eq!(log(&w), [(0, Key), (0, Key), (0, Key)]);
    assert_eq!(held(&w), [("a", 0)]);
    // 答掉主线的第一章：续章当场接着出，不记账。
    answer(&mut w);
    assert_eq!(w.state.story2.pending.iter().find(|p| p.track == "m1").map(|p| p.chapter.as_str()), Some("second"));
    assert_eq!(log(&w).len(), 3);
    assert_eq!(held(&w), [("a", 0)]);
    // 第二天名额空出来，按下的那件出场。
    w.end_day().unwrap();
    assert!(queued(&w).contains(&("a", 1)));
    assert_eq!(log(&w).last(), Some(&(1, Major)));
}

#[test]
fn a_full_wait_beats_the_window_but_not_the_daily_cap_and_the_oldest_goes_first() {
    let rules = PacingRules { daily: 1, window_days: 30, window_soft: 1, max_defer_days: 3, ..on() };
    let mut w = sea(json!([side("a"), side("b"), side("c"), flagged("d", "go")]), rules);
    assert_eq!(queued(&w), [("a", 0)]);
    assert_eq!(held(&w), [("b", 0), ("c", 0)]);
    w.end_day().unwrap();
    // 第 1 天才来的那件也按下，起始日是第 1 天。
    set_flag(&mut w, "go", true);
    assert_eq!(held(&w), [("b", 0), ("c", 0), ("d", 1)]);
    w.end_day().unwrap();
    assert_eq!(queued(&w), [("a", 0)]);
    // 第 3 天 b、c 等满：不看窗口上限，但一天只出一件。
    w.end_day().unwrap();
    assert_eq!(queued(&w), [("a", 0), ("b", 3)]);
    // 第 4 天 c、d 都等满了：等得久的 c 先出。
    w.end_day().unwrap();
    assert_eq!(queued(&w), [("a", 0), ("b", 3), ("c", 4)]);
    assert_eq!(held(&w), [("d", 1)]);
    w.end_day().unwrap();
    assert_eq!(queued(&w), [("a", 0), ("b", 3), ("c", 4), ("d", 5)]);
    assert!(w.state.pacing.held.is_empty());
}

#[test]
fn the_last_day_releases_a_soft_event_regardless_of_the_caps() {
    // 两条主线种类的学院线是要紧的，占满当天的名额；带窗口的羁绊线今天是最后一天。
    let key_line = |key: &str| track(key, "main", json!({"academy":true}), &[("first", json!([]), "done")]);
    let mut closing = bond("bond_closing");
    closing["chapters"][0]["window"] = json!([[1502, 1, 1], [1502, 1, 1]]);
    let mut later = bond("bond_later");
    later["chapters"][0]["window"] = json!([[1502, 1, 1], [1502, 1, 3]]);
    let rules = PacingRules { window_soft: 1, ..on() };
    let mut w = home(json!([key_line("k1"), key_line("k2"), closing, later, bond("bond_open")]), rules);
    assert_eq!(w.cast_date(), [1502, 1, 1]);
    // 当天的名额已经被两件要紧的占满，今天截止的那件照样出场。
    let out: Vec<_> = queued(&w).into_iter().map(|(track, _)| track).collect();
    assert_eq!(out, ["k1", "k2", "bond_closing"]);
    assert_eq!(log(&w), [(0, Key), (0, Key), (0, Major)]);
    assert_eq!(held(&w), [("bond_later", 0), ("bond_open", 0)]);
    // 第二天窗口里已经有一件（这里的窗口上限是一件），带窗口的那件还没到最后一天：两件都按着。
    pass_day(&mut w);
    assert!(queued(&w).is_empty());
    // 第三天是 bond_later 窗口的最后一天：放行，不看窗口上限。
    pass_day(&mut w);
    assert_eq!(w.cast_date(), [1502, 1, 3]);
    assert_eq!(queued(&w), [("bond_later", 2)]);
    assert_eq!(held(&w), [("bond_open", 0)]);
}

#[test]
fn nothing_stays_held_past_graduation_or_a_stage_change() {
    // 结业前一天：按着的都放出来（结业之后养成期的事就没有了）。
    let mut d = base(json!([bond("bond_a"), bond("bond_b"), bond("bond_c"), bond("bond_d")]));
    d.upbringing.families[0].graduation = [1502, 1, 4];
    d.rules.pacing = on();
    let mut w = world(d);
    assert_eq!(held(&w), [("bond_c", 0), ("bond_d", 0)]);
    pass_day(&mut w);
    assert_eq!(queued(&w), [("bond_c", 1)]);
    assert_eq!(held(&w), [("bond_d", 0)]);
    // 1 月 3 日：明天结业，窗口满着也放行。
    pass_day(&mut w);
    assert_eq!(w.cast_date(), [1502, 1, 3]);
    assert_eq!(queued(&w), [("bond_d", 2)]);
    assert!(w.state.pacing.held.is_empty());

    // 换阶段的前一天同理（夹具里没有课业，下一个阶段仍写成家乡期：闸只看“明天起是另一个阶段”）。
    let mut d = base(json!([bond("bond_a"), bond("bond_b"), bond("bond_c"), bond("bond_d")]));
    let at = d.locations[0].key.clone();
    let next = json!({"from":[1502,1,4],"stage":"home","name":"占位","at":at});
    d.upbringing.families[0].stages.push(serde_json::from_value(next).unwrap());
    d.rules.pacing = on();
    let mut w = world(d);
    pass_day(&mut w);
    assert_eq!(held(&w), [("bond_d", 0)]);
    pass_day(&mut w);
    assert_eq!(w.cast_date(), [1502, 1, 3]);
    assert_eq!(queued(&w), [("bond_d", 2)]);
}

#[test]
fn the_last_day_also_covers_a_season_and_dated_event_gates() {
    // 季节条件：这个季节的最后一天不能再按着。
    let season = crate::calendar::Calendar::default().season_of(0).index();
    let seasonal =
        track("b_season", "request", json!({}), &[("first", json!([{"kind":"season","season":season}]), "done")]);
    let rules = PacingRules { daily: 1, window_days: 400, window_soft: 1, max_defer_days: 1000, ..on() };
    let mut w = sea(json!([side("a_first"), seasonal]), rules);
    assert_eq!(queued(&w), [("a_first", 0)]);
    assert_eq!(held(&w), [("b_season", 0)]);
    let last = (0..400).find(|day| w.defs.calendar.season_of(day + 1).index() != season).unwrap();
    assert!(last > 5, "夹具的第一个季节太短：{last}");
    while w.day() < last {
        assert_eq!(held(&w), [("b_season", 0)], "第 {} 天", w.day());
        assert!(!w.pacing_held()[0].last_chance);
        w.end_day().unwrap();
    }
    assert_eq!(queued(&w), [("a_first", 0), ("b_season", last)]);

    // 事件门槛里随日期变的条件：只在一月出的事件，一月的最后一天是它的最后一天。
    let mut d = base(json!([event("c9_x_rare_0", "encounter", json!([]))]));
    d.upbringing.event_gates = [("c9_x_rare_0".to_owned(), Default::default())].into();
    d.upbringing.event_gates.get_mut("c9_x_rare_0").unwrap().months = Some(vec![1]);
    let mut w = world(d);
    let p = Pending { track: "c9_x_rare_0".into(), chapter: "first".into(), day: w.day(), variant: None };
    assert!(!w.pacing_last_chance(&p));
    while w.cast_date() < [1502, 1, 30] {
        pass_day(&mut w);
    }
    let p = Pending { day: w.day(), ..p };
    assert!(w.pacing_last_chance(&p), "{:?}", w.cast_date());
}

#[test]
fn refreshing_again_on_the_same_day_changes_nothing() {
    let tracks = json!([
        side("a"),
        side("b"),
        side("c"),
        chance("z"),
        track("m", "main", json!({}), &[("first", json!([]), "done")])
    ]);
    let mut w = sea(tracks, on());
    for _ in 0..3 {
        let before = serde_json::to_value(&w.state).unwrap();
        w.refresh_story2();
        w.refresh_story2_day_start();
        assert_eq!(serde_json::to_value(&w.state).unwrap(), before);
        w.end_day().unwrap();
    }
    // 账只记了出场的那几件，按下的起始日没有被重置。
    assert_eq!(log(&w), [(0, Key), (0, Major), (1, Major), (1, Major)]);
    assert_eq!(held(&w), [("z", 0)]);
    // 闸刚跑完时，没有哪件按着的事按规则该放。
    assert!(w.pacing_held().iter().all(|h| h.beat.is_some() && !h.due), "{:?}", w.pacing_held());
}

#[test]
fn an_event_that_left_the_queue_comes_back_as_the_same_event() {
    let mut w = sea(json!([flagged("a", "here"), side("b")]), on());
    set_flag(&mut w, "here", true);
    assert_eq!(queued(&w), [("a", 0), ("b", 0)]);
    assert_eq!(log(&w).len(), 2);
    w.end_day().unwrap();
    w.end_day().unwrap();
    // 条件暂时不成立（玩家走开了）：离开队列，但闸记得它出过场。
    set_flag(&mut w, "here", false);
    assert_eq!(queued(&w), [("b", 0)]);
    assert!(w.state.pacing.shown.contains_key("a"));
    // 回来时还是原来的出场日，不再记账，也不算刚出场。
    set_flag(&mut w, "here", true);
    assert_eq!(queued(&w), [("a", 0), ("b", 0)]);
    assert_eq!(log(&w), [(0, Major), (0, Major)]);
    assert!(!w.story2_front_fresh());
    // 答掉以后记录作废。
    answer(&mut w);
    assert!(!w.state.pacing.shown.contains_key("a"));
}

#[test]
fn a_held_event_keeps_its_first_day_while_away_and_is_dropped_when_its_track_ends() {
    let rules = PacingRules { daily: 1, window_days: 400, window_soft: 1, max_defer_days: 3, ..on() };
    let mut w = sea(json!([side("a"), flagged("b", "here"), side("c")]), rules);
    set_flag(&mut w, "here", true);
    assert_eq!(held(&w), [("b", 0), ("c", 0)]);
    w.end_day().unwrap();
    // 玩家走开：b 暂时不是候选，按着的记录留着。
    set_flag(&mut w, "here", false);
    assert_eq!(held(&w), [("b", 0), ("c", 0)]);
    let away = w.pacing_held();
    assert_eq!((away[0].track.as_str(), away[0].beat.is_some(), away[0].due), ("b", false, false));
    // c 的轨道就此结束：记录清掉。
    w.state.story2.tracks.get_mut("c").unwrap().status = Status::Failed;
    for _ in 0..4 {
        w.end_day().unwrap();
    }
    assert_eq!(held(&w), [("b", 0)]);
    assert_eq!(queued(&w), [("a", 0)]);
    // 第 5 天回来：接着算等了多久，早就等满了，当天出场。
    set_flag(&mut w, "here", true);
    assert_eq!(queued(&w), [("a", 0), ("b", 5)]);
    assert!(w.state.pacing.held.is_empty());
}

#[test]
fn midway_through_day_end_new_events_wait_for_the_day_start_refresh() {
    let mut w = sea(
        json!([
            flagged("a", "go"),
            track("m", "main", json!({}), &[("first", json!([{"kind":"flag","flag":"go"}]), "done")])
        ]),
        on(),
    );
    assert!(queued(&w).is_empty());
    // 日结进行到一半：新候选不放行、不按下、不记账。
    w.state.closed = true;
    set_flag(&mut w, "go", true);
    assert!(queued(&w).is_empty());
    assert!(w.state.pacing.is_empty());
    // 当天最后一次刷新统一放行。
    w.refresh_story2_day_start();
    assert_eq!(queued(&w), [("m", 0), ("a", 0)]);
    assert_eq!(log(&w), [(0, Key), (0, Major)]);
    // 已经出过场的在日结中途的刷新里照样留着。
    w.refresh_story2();
    assert_eq!(queued(&w).len(), 2);
    w.state.closed = false;
}

#[test]
fn a_candidate_that_only_exists_halfway_through_a_command_is_ignored() {
    // 入学事件的选项设上入学旗标；羁绊线要这枚旗标、又绑在家乡——
    // 旗标设上的同一条命令里阶段就换到了学院所在的另一座城，它只在命令执行到一半时当了一瞬间的候选。
    let mut enroll = event("enroll", "request", json!([]));
    enroll["chapters"][0]["choices"][0]["effects"] = json!([{"kind":"flag","flag":"enrolled","value":true}]);
    let mut d = base(json!([]));
    let (home_key, away) = (d.locations[0].key.clone(), d.locations[1].key.clone());
    let mut at_home = track(
        "bond_home",
        "request",
        json!({"academy":true}),
        &[("first", json!([{"kind":"flag","flag":"enrolled"}]), "done")],
    );
    at_home["chapters"][0]["at"] = json!(home_key);
    d.story2 = serde_json::from_value(json!({ "tracks": [enroll, at_home] })).unwrap();
    let academy = json!({"from":[1502,1,1],"stage":"academy","name":"占位","at":away,
        "entry_flag":"enrolled","entry_event":"enroll"});
    d.upbringing.families[0].stages.push(serde_json::from_value(academy).unwrap());
    d.rules.pacing = on();
    let mut w = world(d);
    assert_eq!(queued(&w), [("enroll", 0)]);
    assert_eq!(log(&w), [(0, Key)]);
    let at = |w: &World| w.defs.loc(w.cast_player_place().unwrap().loc).key.clone();
    assert_eq!(at(&w), home_key);
    answer(&mut w);
    // 答完入学事件：人已经在学院那座城，绑在家乡的那一章不是候选——没有被放行、没有占名额，也没有被记成按着。
    assert_eq!(at(&w), away);
    assert!(w.state.story2.flags.contains("enrolled"));
    assert!(queued(&w).is_empty());
    assert_eq!(log(&w), [(0, Key)]);
    assert!(w.state.pacing.held.is_empty() && w.state.pacing.shown.is_empty(), "{:?}", w.state.pacing);
}

#[test]
fn old_saves_keep_their_queue_and_bad_pacing_state_is_rejected() {
    let tracks = json!([side("a"), side("b"), side("c"), side("d"), chance("z")]);
    // 没有闸的时候存的档：五件事都在队列里。
    let mut old = sea(tracks.clone(), PacingRules::default());
    for _ in 0..3 {
        old.end_day().unwrap();
    }
    assert_eq!(queued(&old).len(), 5);
    let saved = serde_json::to_value(&old.state).unwrap();
    assert!(saved.get("pacing").is_none());
    // 开了闸的数据读这份档：队列原样留着（出场日不变），不补记账，也不算刚出场。
    let defs = Arc::new(sea_defs(tracks, on()));
    let state: crate::world::WorldState = serde_json::from_value(saved).unwrap();
    let mut w = World::from_snapshot(defs.clone(), state).unwrap();
    w.refresh_story2();
    assert_eq!(queued(&w), queued(&old));
    assert_eq!(w.state.pacing.shown.len(), 5);
    assert!(w.state.pacing.log.is_empty() && w.state.pacing.held.is_empty());
    assert!(!w.story2_front_fresh());
    // 新状态存得下、读得回。
    w.end_day().unwrap();
    let saved = serde_json::to_value(&w.state).unwrap();
    assert!(saved.get("pacing").is_some());
    let back: crate::world::WorldState = serde_json::from_value(saved).unwrap();
    assert_eq!(back.pacing, w.state.pacing);
    let reloaded = World::from_snapshot(defs.clone(), back).unwrap();
    assert_eq!(reloaded.state_hash(), w.state_hash());

    // 未来日期与“同一章既按着又出过场”都拒绝。
    let mut w = sea_world_with_backlog();
    let day = w.day();
    assert!(!w.state.pacing.log.is_empty() && !w.state.pacing.held.is_empty() && !w.state.pacing.shown.is_empty());
    let defs = w.defs.clone();
    let reject = |edit: &dyn Fn(&mut PacingState)| {
        let mut state = w.state.clone();
        edit(&mut state.pacing);
        World::from_snapshot(defs.clone(), state).is_err()
    };
    assert!(!reject(&|_| {}));
    assert!(reject(&|s| s.log[0].day = day + 1));
    assert!(reject(&|s| s.held.values_mut().next().unwrap().since = day + 1));
    assert!(reject(&|s| s.shown.values_mut().next().unwrap().day = day + 1));
    assert!(reject(&|s| {
        let (track, h) = s.held.iter().next().map(|(t, h)| (t.clone(), h.clone())).unwrap();
        s.shown.insert(track, Shown { chapter: h.chapter, entered: h.entered, day });
    }));
    w.end_day().unwrap();
}

/// 开着闸、既有出过场的也有按着的小世界。
fn sea_world_with_backlog() -> World {
    sea(json!([side("a"), side("b"), side("c"), side("d")]), on())
}

#[test]
fn with_the_rules_off_nothing_is_gated_and_nothing_is_saved() {
    let tracks = json!([side("a"), side("b"), side("c"), side("d"), chance("z")]);
    let run = |rules: PacingRules| {
        let mut w = sea(tracks.clone(), rules);
        let mut hashes = vec![w.state_hash()];
        for _ in 0..12 {
            w.end_day().unwrap();
            hashes.push(w.state_hash());
        }
        (w, hashes)
    };
    let (w, plain) = run(PacingRules::default());
    // 五件事当天全在队列里，闸没有留下任何状态。
    assert_eq!(queued(&w), [("a", 0), ("b", 0), ("c", 0), ("d", 0), ("z", 0)]);
    assert!(w.state.pacing.is_empty());
    assert!(serde_json::to_value(&w.state).unwrap().get("pacing").is_none());
    assert!(w.story2_front_fresh());
    // 关着的时候数值怎么写都不影响世界。
    let (_, odd) = run(PacingRules { enabled: false, daily: 1, window_days: 1, window_soft: 1, max_defer_days: 0 });
    assert_eq!(odd, plain);
    // 开着就不一样了（确认上面比的不是摆设）。
    let (_, gated) = run(on());
    assert_ne!(gated, plain);
}

#[test]
fn skipping_the_upbringing_bypasses_the_gate() {
    let dated = |key: &str| {
        track(
            key,
            "request",
            json!({"upbringing":true}),
            &[("first", json!([{"kind":"date","from":[1502,1,5]}]), "done")],
        )
    };
    let tracks = json!([dated("up_a"), dated("up_b"), dated("up_c"), dated("up_d")]);
    let run = |rules: PacingRules, skip: bool| {
        let mut d = base(tracks.clone());
        d.rules.pacing = rules;
        let mut w = world(d);
        if skip {
            Command::SkipUpbringing { owner: PLAYER }.apply(&mut w).unwrap();
            assert!(w.upbringing_skipping());
        } else {
            rest_month(&mut w);
        }
        for _ in 0..4 {
            w.end_day().unwrap();
        }
        assert_eq!(w.cast_date(), [1502, 1, 5]);
        w
    };
    // 跳过养成：四件事同一天全进队列，闸不留状态，世界与没开闸时逐位相同。
    let skipped = run(on(), true);
    assert_eq!(queued(&skipped).len(), 4);
    assert!(skipped.state.pacing.is_empty());
    assert_eq!(skipped.state_hash(), run(PacingRules::default(), true).state_hash());
    // 不跳过的同一局：当天只出两件。
    let played = run(on(), false);
    assert_eq!(queued(&played).len(), 2);
    assert_eq!(played.state.pacing.held.len(), 2);
}

#[test]
fn a_held_scheduled_event_keeps_its_permit_across_the_slot_boundary() {
    let rules = PacingRules { window_days: 30, window_soft: 2, max_defer_days: 12, ..on() };
    let mut d = base(json!([
        event("story_line", "request", json!([])),
        event("c9_x_rare_0", "encounter", json!([])),
        event("c9_x_letter_0", "encounter", json!([])),
    ]));
    d.rules.pacing = rules;
    let mut w = after_first_slot(d, &["story_line", "c9_x_rare_0", "c9_x_letter_0"]);
    // 1 月 11 日旬调度排出三件：重点与来信出场，普通短事件按下。
    let day = w.day();
    assert_eq!(queued(&w), [("story_line", day), ("c9_x_letter_0", day)]);
    assert_eq!(held(&w), [("c9_x_rare_0", day)]);
    let permits = |w: &World| w.state.upbringing.as_ref().unwrap().event_permits.clone();
    assert!(permits(&w).contains("c9_x_rare_0"));
    // 过了 1 月 21 日的旬界：许可整体替换，按着的那件接着留用，也没有被当成新的一件再排一次。
    while w.cast_date() < [1502, 1, 21] {
        pass_day(&mut w);
        assert!(queued(&w).is_empty(), "{:?}", w.cast_date());
    }
    assert_eq!(permits(&w).into_iter().collect::<Vec<_>>(), ["c9_x_rare_0"]);
    assert_eq!(held(&w), [("c9_x_rare_0", day)]);
    // 等满十二天（1 月 23 日）出场：许可还在，它仍是候选。
    pass_day(&mut w);
    assert!(queued(&w).is_empty());
    pass_day(&mut w);
    assert_eq!(w.cast_date(), [1502, 1, 23]);
    assert_eq!(queued(&w), [("c9_x_rare_0", day + 12)]);
    let b = w.pacing_classify_story2(w.pending_story2().unwrap());
    assert_eq!((b.source, b.slot), (BeatSource::Ordinary, Some(1)));
    answer(&mut w);
    assert!(permits(&w).is_empty() && w.state.pacing.held.is_empty());
}

#[test]
fn the_front_chapter_is_fresh_on_its_first_day_and_on_its_last() {
    let mut windowed = side("timed");
    windowed["chapters"][0]["window"] = json!([[1502, 1, 1], [1502, 1, 5]]);
    let tracks = json!([windowed]);
    let mut w = sea(tracks.clone(), on());
    let mut plain = sea(tracks, PacingRules::default());
    let mut fresh = Vec::new();
    for _ in 0..5 {
        assert!(w.story2_is_front() && plain.story2_front_fresh(), "{:?}", w.cast_date());
        fresh.push(w.story2_front_fresh());
        w.end_day().unwrap();
        plain.end_day().unwrap();
    }
    // 出场那天提醒一次，中间的日子不再提醒，最后一天（1 月 5 日）再提醒一次。
    assert_eq!(fresh, [true, false, false, false, true]);
    // 窗口过了，章节走掉。
    assert!(!w.story2_front_fresh() && w.pending_story2().is_none());
}

#[test]
fn other_sources_are_noted_on_the_day_the_player_meets_them() {
    // 怪异：日结里生成，记在第二天的账上。
    let creature = |rules: PacingRules| {
        let mut d = (*testkit::tiny_defs()).clone();
        let port = d.loc(d.scenarios[0].start_loc).key.clone();
        d.creatures = serde_json::from_value(json!({"moon_epoch":0,"creatures":[{
            "key":"sample","name":"占位","text":"占位","ports":[port],
            "responses":["avoid"],"outcomes":{"avoid":{}},"chance_bp":10000,"cooldown_days":0}]}))
        .unwrap();
        d.rules.pacing = rules;
        let mut w = world(d);
        w.state.closed = true;
        w.creatures_day().unwrap();
        w.state.closed = false;
        assert!(w.creature_pending().is_some());
        w
    };
    let w = creature(on());
    assert_eq!(log(&w), [(w.day() + 1, Minor)]);
    // 规则关着就不记。
    assert!(creature(PacingRules::default()).state.pacing.is_empty());

    // 待决海战：要紧。
    let mut d = (*testkit::tiny_defs()).clone();
    d.rules.pirates.spawn_scale = crate::Fx::ZERO;
    d.rules.pirates.speed = 0;
    d.rules.pacing = on();
    let mut w = world(d);
    let fleet = w.flagship(PLAYER).unwrap();
    Command::SetSail { owner: PLAYER, fleet, dest: LocId(1) }.apply(&mut w).unwrap();
    let f = w.fleet(fleet).unwrap().clone();
    let pirate = crate::battle::PirateFleet {
        id: 0,
        region: RegionId(0),
        cell: f.cell(&w.defs),
        ships: f.ships.clone(),
        crew: f.crew,
        until: 100,
        engaged: false,
    };
    w.state.battles.pirates.insert(0, pirate);
    w.state.battles.next_pirate = 1;
    w.battle_day().unwrap();
    assert_eq!(w.state.battles.pending.len(), 1);
    assert_eq!(log(&w), [(w.day(), Key)]);

    // 经典故事线的章节（要紧）与奇遇（点缀）：都在日结里生成，记在玩家看到它的那一天。
    let mut d = classic_defs();
    d.rules.pacing = on();
    let mut w = world(d);
    create_captain(&mut w);
    w.end_day().unwrap();
    assert!(w.state.story.pending.is_some());
    assert_eq!(log(&w), [(w.day(), Key)]);
    answer(&mut w);
    w.end_day().unwrap();
    assert_eq!(log(&w), [(w.day() - 1, Key), (w.day(), Minor)]);
}
