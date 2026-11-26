//! U03：养成期的轨道放行、答不了的章节兜底、远足许可、羁绊线与事件分层的内核回归。
use super::*;
use crate::{Command, OwnerId, ScenarioId, StaticData, World, story2::Status, testkit};
use serde_json::{Value, json};
use std::sync::Arc;

fn base(tracks: Value) -> Arc<StaticData> {
    let mut d = (*testkit::captain_defs()).clone();
    d.scenarios[0].upbringing = true;
    d.rules.money.enabled = true;
    let at = d.locations[0].key.clone();
    d.upbringing = serde_json::from_value(json!({
        "families":[{"key":"family","name":"占位","scenario":"test","home":at,"born":[1489,6,1],"gender":"f","graduation":[1506,1,1],
            "stages":[{"from":[1502,1,1],"stage":"home","name":"占位","at":at}]}],
        "activities":[{"key":"rest","name":"占位","kind":"rest","fatigue":-20,"mood":8}]
    }))
    .unwrap();
    d.story2 = serde_json::from_value(json!({ "tracks": tracks })).unwrap();
    Arc::new(d)
}
fn track(key: &str, extra: Value, choices: Value) -> Value {
    let mut t = json!({"key":key,"name":"占位","kind":"request","start":"first",
        "chapters":[{"key":"first","title":"占位","text":"占位","choices":choices}]});
    if let (Some(t), Some(extra)) = (t.as_object_mut(), extra.as_object()) {
        t.extend(extra.clone());
    }
    t
}
fn ok() -> Value {
    json!([{"key":"ok","text":"继续","next":"done"}])
}
fn rest_month(w: &mut World) {
    let slots =
        (0..3).map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) }).collect();
    Command::PlanMonth { owner: OwnerId::Player, slots }.apply(w).unwrap();
}

#[test]
fn upbringing_admits_only_academy_or_marked_tracks_and_main_lines_wait_for_graduation() {
    let d = base(json!([
        track("main_line", json!({}), ok()),
        track("school", json!({"academy":true}), ok()),
        track("marked", json!({"upbringing":true}), ok()),
    ]));
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    assert!(w.upbringing_active());
    let queued: Vec<_> = w.state.story2.pending.iter().map(|p| p.track.as_str()).collect();
    assert_eq!(queued, ["marked", "school"]);
    // 主线轨道已经开始，只是养成期不放进待回应队列。
    assert_eq!(w.state.story2.tracks["main_line"].status, Status::Active);
    for _ in 0..2 {
        Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    }
    assert!(w.pending_story2().is_none());
    // 结业以后照常出现。
    w.state.upbringing.as_mut().unwrap().phase = Phase::Done;
    w.refresh_story2();
    assert_eq!(w.pending_story2().unwrap().track, "main_line");
    // 经典路径（没有养成）不受影响。
    let mut classic = (*d).clone();
    classic.scenarios[0].upbringing = false;
    let w = World::new(Arc::new(classic), ScenarioId(0), 42).unwrap();
    assert_eq!(w.state.story2.pending.len(), 3);
}

#[test]
fn start_chapter_check_catches_options_locked_behind_unstated_age_or_date() {
    use crate::story2::{ChapterDef, validation::start_may_be_unanswerable};
    let chapter = |when: Value, requires: Vec<Value>| -> ChapterDef {
        serde_json::from_value(json!({"key":"first","title":"占位","text":"占位","when":when,
            "choices":requires.into_iter().enumerate().map(|(i, r)| json!({"key":format!("c{i}"),"text":"占位","next":"done","requires":r})).collect::<Vec<_>>()}))
        .unwrap()
    };
    let age16 = json!([{"kind":"age","ge":16},{"kind":"fame","ge":15}]);
    assert!(start_may_be_unanswerable(&chapter(json!([]), vec![age16.clone()])));
    assert!(!start_may_be_unanswerable(&chapter(json!([{"kind":"age","ge":16}]), vec![age16.clone()])));
    assert!(!start_may_be_unanswerable(&chapter(json!([{"kind":"age","ge":17}]), vec![age16.clone()])));
    // 有一个选项不带门槛就总能回答。
    assert!(!start_may_be_unanswerable(&chapter(json!([]), vec![age16.clone(), json!([])])));
    // 日期门槛同理；只看年龄与日期，情谊、钱这类由运行时兜底。
    let late = json!([{"kind":"date","from":[1560,1,1]}]);
    assert!(start_may_be_unanswerable(&chapter(json!([{"kind":"date","from":[1555,1,1]}]), vec![late.clone()])));
    assert!(!start_may_be_unanswerable(&chapter(json!([{"kind":"date","from":[1561,1,1]}]), vec![late])));
    assert!(!start_may_be_unanswerable(&chapter(json!([]), vec![json!([{"kind":"cash","ge":5}])])));
    let d =
        base(json!([track("ghost", json!({}), json!([{"key":"c0","text":"占位","next":"done","requires":age16}]))]));
    let errors = crate::story2::validation::validate(&d);
    assert!(errors.iter().any(|e| e.starts_with("ghost:first:") && e.contains("回答不了")), "{errors:?}");
}

#[test]
fn outing_permission_is_granted_once_after_the_home_stage_has_run_long_enough() {
    let outing = track("first_outing", json!({"academy":true}), json!([{"key":"go","text":"占位","next":"done"}]));
    let mut outing = outing;
    outing["chapters"][0]["when"] = json!([{"kind":"flag","flag":OUTING_PERMISSION_FLAG}]);
    let mut d = (*base(json!([outing]))).clone();
    d.upbringing.rules.outing_permission_days = 3;
    let d = Arc::new(d);
    let mut w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    rest_month(&mut w);
    let start = w.day();
    let granted = |w: &World| {
        (
            w.state.story2.flags.contains(OUTING_PERMISSION_FLAG),
            w.state.upbringing.as_ref().unwrap().flags.contains(OUTING_PERMISSION_FLAG),
        )
    };
    for _ in 0..2 {
        w.end_day().unwrap();
        assert_eq!(granted(&w), (false, false));
        assert!(w.pending_story2().is_none());
    }
    w.end_day().unwrap();
    assert_eq!(w.day(), start + 3);
    assert_eq!(granted(&w), (true, true));
    assert_eq!(w.pending_story2().unwrap().track, "first_outing");
    let logs = |w: &World| w.state.log.iter().filter(|e| e.kind == crate::log::LogKind::OutingPermitted).count();
    assert_eq!(logs(&w), 1);
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    for _ in 0..3 {
        w.end_day().unwrap();
    }
    assert_eq!(logs(&w), 1);
    assert_eq!(World::from_snapshot(d.clone(), w.state.clone()).unwrap().state, w.state);
    // 规则为 0 时不发放；跳过养成时也不发放。
    let mut off = (*d).clone();
    off.upbringing.rules.outing_permission_days = 0;
    let mut w = World::new(Arc::new(off), ScenarioId(0), 42).unwrap();
    rest_month(&mut w);
    for _ in 0..5 {
        w.end_day().unwrap();
    }
    assert_eq!(granted(&w), (false, false));
    let mut w = World::new(d, ScenarioId(0), 42).unwrap();
    Command::SkipUpbringing { owner: OwnerId::Player }.apply(&mut w).unwrap();
    for _ in 0..5 {
        w.end_day().unwrap();
    }
    assert_eq!(granted(&w), (false, false));
}

#[test]
fn upbringing_unlock_and_requirement_flags_need_a_source() {
    use crate::story2::graph::validate_reachability as validate_world;
    let reader = track("reader", json!({"academy":true}), ok());
    let mut d = (*base(json!([reader]))).clone();
    d.upbringing.activities[0].unlock.flag = Some("orphan_gate".into());
    let errors = validate_world(&d);
    assert!(errors.iter().any(|e| e == "activity:rest: 旗标没有来源：orphan_gate"), "{errors:?}");
    // 引擎旗标、入学标记、职业分支与故事效果都算来源。
    for flag in [OUTING_PERMISSION_FLAG, GRADUATED_FLAG, "aspiration_unset"] {
        d.upbringing.activities[0].unlock.flag = Some(flag.into());
        assert!(validate_world(&d).is_empty(), "{flag}: {:?}", validate_world(&d));
    }
    d.upbringing.families[0].stages[0].entry_flag = Some("entered_home".into());
    d.upbringing.activities[0].unlock.flag = Some("entered_home".into());
    assert!(validate_world(&d).is_empty());
    d.upbringing.activities[0].unlock.flag = Some("story_given".into());
    assert_eq!(validate_world(&d).len(), 1);
    d.story2.tracks[0].chapters[0].choices[0].effects =
        vec![crate::story2::Effect::Flag { flag: "story_given".into(), value: true }];
    assert!(validate_world(&d).is_empty());
    // 考试门槛里的旗标同样检查；取反的门槛不算读取。
    d.upbringing.exams =
        serde_json::from_value(json!([{"key":"exam","name":"占位","description":"占位","check":{"base":50,"attrs":{}},
        "requirements":{"all":[{"flag":"needs_source"},{"flag":"absent_ok","flag_value":false}]}}]))
        .unwrap();
    let errors = validate_world(&d);
    assert_eq!(errors, ["exam:exam: 旗标没有来源：needs_source"]);
}

#[test]
fn non_auto_tracks_without_any_entry_are_rejected() {
    use crate::story2::graph::validate_reachability as validate_world;
    let lonely = track("lonely", json!({"academy":true,"auto":false}), ok());
    let d = base(json!([lonely.clone()]));
    let errors = validate_world(&d);
    assert!(errors.iter().any(|e| e.starts_with("lonely: 不自动开始的轨道没有任何入口")), "{errors:?}");
    // 别的轨道 start_track 它、短事件门槛或活动事件引用它，都算入口。
    let starter = track(
        "starter",
        json!({"academy":true}),
        json!([{"key":"ok","text":"继续","next":"done","effects":[{"kind":"start_track","track":"lonely"}]}]),
    );
    assert!(validate_world(&base(json!([lonely.clone(), starter]))).is_empty());
    let mut gated = (*d).clone();
    gated.upbringing.event_gates.insert("lonely".into(), EventGate::default());
    assert!(validate_world(&gated).is_empty());
    let mut referenced = (*d).clone();
    referenced.upbringing.activities[0].events = vec!["lone*".into()];
    assert!(validate_world(&referenced).is_empty());
}

/// 只有短事件门槛、由每旬调度排出的世界：结算一旬后第二天排事件。
fn scheduled(tracks: Value, gates: Value) -> World {
    let mut d = (*base(tracks)).clone();
    d.upbringing.event_gates = serde_json::from_value(gates).unwrap();
    let mut w = World::new(Arc::new(d), ScenarioId(0), 42).unwrap();
    rest_month(&mut w);
    w
}
fn first_slot(w: &mut World) -> Vec<String> {
    for _ in 0..10 {
        w.end_day().unwrap();
    }
    let mut seen: Vec<String> = w.state.story2.pending.iter().map(|p| p.track.clone()).collect();
    seen.sort();
    seen
}

#[test]
fn timed_events_beat_special_and_filler_and_letters_take_their_own_slot() {
    let enc = |key: &str| {
        json!({"key":key,"name":"占位","kind":"encounter","start":"first","auto":false,"academy":true,
            "chapters":[{"key":"first","title":"占位","text":"占位","once":false,"family":key,"family_cooldown_days":1,
                "choices":[{"key":"ok","text":"继续","next":"done"}]}]})
    };
    let keys = ["c9_x_birthday_a", "c9_x_rare_0", "c9_pool_east_daily_00_0", "c9_x_news_0", "c9_x_letter_0"];
    let gates: serde_json::Map<String, Value> = keys.iter().map(|k| (k.to_string(), json!({}))).collect();
    let mut w = scheduled(Value::Array(keys.iter().map(|k| enc(k)).collect()), Value::Object(gates));
    // 一旬三位：短事件位给限时的生日，来信位给一封信或新闻（按开始日再按抖动），没有重点。
    let first = first_slot(&mut w);
    assert_eq!(first.len(), 2, "{first:?}");
    assert!(first.contains(&"c9_x_birthday_a".to_string()));
    assert!(first.iter().any(|k| k == "c9_x_news_0" || k == "c9_x_letter_0"));
    assert_eq!(infer_event_tier("c9_x_birthday_a", None, false), EventTier::Timed);
    assert_eq!(infer_event_tier("c9_x_rare_0", None, false), EventTier::Special);
    assert_eq!(infer_event_tier("c9_pool_east_daily_00_0", None, false), EventTier::Filler);
    assert_eq!(infer_event_tier("c9_x_side_thing", None, true), EventTier::Timed);
    assert_eq!(infer_event_tier("c9_x_side_thing", None, false), EventTier::Special);
    let explicit = EventGate { tier: Some(EventTier::Filler), ..Default::default() };
    assert_eq!(infer_event_tier("c9_x_birthday_a", Some(&explicit), false), EventTier::Filler);
    assert_eq!(World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap().state, w.state);
}

/// 限时档里只出一次的节庆先于可重复的打工后续，哪怕后续今天就截止（整局测试里诺埃尔的节庆、
/// 伊希与林晚灯的家人羁绊被打工后续挤掉，11-03）；没有只出一次的候选时，打工后续照常出。
#[test]
fn a_once_only_timed_event_beats_a_repeatable_follow_up_due_today() {
    let enc = |key: &str, once: bool, to: [u32; 3]| {
        json!({"key":key,"name":"占位","kind":"encounter","start":"first","auto":false,"academy":true,
            "chapters":[{"key":"first","title":"占位","text":"占位","once":once,"family":key,"family_cooldown_days":1,
                "when":[{"kind":"date","to":to}],
                "choices":[{"key":"ok","text":"继续","next":"done"}]}]})
    };
    let pick = |festival: Option<[u32; 3]>| {
        let mut tracks = vec![enc("c9_x_job_success", false, [1505, 1, 1])];
        let mut gates = json!({"c9_x_job_success":{"activity":"rest"}});
        if let Some(to) = festival {
            tracks.push(enc("c9_x_festival_a", true, to));
            gates["c9_x_festival_a"] = json!({});
        }
        let mut w = scheduled(json!(tracks), gates);
        let seen = first_slot(&mut w);
        assert_eq!(w.cast_date(), [1502, 1, 11], "{seen:?}");
        seen
    };
    // 打工后续依赖上一旬的活动，今天截止；节庆不论还剩几天，只出一次，先出。
    assert_eq!(pick(Some([1502, 1, 15])), ["c9_x_festival_a"]);
    assert_eq!(pick(Some([1502, 3, 1])), ["c9_x_festival_a"]);
    // 没有只出一次的候选：打工后续照常当天出。
    assert_eq!(pick(None), ["c9_x_job_success"]);
}

#[test]
fn a_daily_pool_event_does_not_repeat_within_a_year() {
    let daily = json!({"key":"c9_pool_east_daily_00_0","name":"占位","kind":"encounter","start":"first","auto":false,"academy":true,
        "chapters":[{"key":"first","title":"占位","text":"占位","once":false,"family":"pool","family_cooldown_days":1,
            "choices":[{"key":"ok","text":"继续","next":"first"}]}]});
    let mut w = scheduled(json!([daily]), json!({"c9_pool_east_daily_00_0":{}}));
    assert_eq!(first_slot(&mut w), ["c9_pool_east_daily_00_0"]);
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    let mut again = 0;
    for _ in 0..200 {
        if w.state.upbringing.as_ref().unwrap().phase == Phase::Plan {
            rest_month(&mut w);
        }
        w.end_day().unwrap();
        if w.pending_story2().is_some() {
            again += 1;
            Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
        }
    }
    assert_eq!(again, 0);
    assert!(w.state.upbringing.as_ref().unwrap().filler_seen.contains_key("c9_pool_east_daily_00_0"));
}

#[test]
fn ordinary_short_events_skip_alternate_slots_and_resume_after_a_save() {
    let ordinary = json!({"key":"ordinary","name":"占位","kind":"encounter","start":"first","auto":false,"academy":true,
        "chapters":[{"key":"first","title":"占位","text":"占位","once":false,"family":"ordinary","family_cooldown_days":1,
            "choices":[{"key":"ok","text":"继续","next":"done"}]}]});
    let mut w = scheduled(json!([ordinary]), json!({"ordinary":{}}));
    assert_eq!(first_slot(&mut w), ["ordinary"]);
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    for _ in 0..10 {
        w.end_day().unwrap();
    }
    assert_eq!(w.cast_date(), [1502, 1, 21]);
    assert!(w.pending_story2().is_none());
    assert!(w.state.upbringing.as_ref().unwrap().event_backlog.iter().any(|key| key == "ordinary"));
    let mut loaded = World::from_snapshot(w.defs.clone(), w.state.clone()).unwrap();
    while w.cast_date() < [1502, 2, 1] {
        w.end_day().unwrap();
        loaded.end_day().unwrap();
    }
    assert_eq!(w.cast_date(), [1502, 2, 1]);
    assert_eq!(w.pending_story2().unwrap().track, "ordinary");
    assert_eq!(w.state_hash(), loaded.state_hash());
    // 连续六次旬结算只安排三次；跨月不能重新开始奇偶节奏，读档也不会改变后续事件。
    let mut seen = vec![[1502, 1, 11]];
    loop {
        if let Some(pending) = w.pending_story2() {
            assert_eq!(pending.track, "ordinary");
            seen.push(w.cast_date());
            Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
            Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut loaded).unwrap();
        }
        assert_eq!(w.state_hash(), loaded.state_hash());
        if w.cast_date() >= [1502, 3, 1] {
            break;
        }
        if w.state.upbringing.as_ref().unwrap().phase == Phase::Plan {
            rest_month(&mut w);
            rest_month(&mut loaded);
        }
        w.end_day().unwrap();
        loaded.end_day().unwrap();
    }
    assert_eq!(seen, [[1502, 1, 11], [1502, 2, 1], [1502, 2, 21]]);
}

#[test]
fn monthly_ordinary_window_keeps_urgent_scenes_and_defers_the_rest_across_loads() {
    let ordinary = json!({"key":"ordinary","name":"占位","kind":"encounter","start":"first","auto":false,"academy":true,
        "chapters":[{"key":"first","title":"占位","text":"占位","once":false,"family":"ordinary","family_cooldown_days":1,
            "choices":[{"key":"ok","text":"继续","next":"done"}]}]});
    let urgent = |key: &str, kind: &str| {
        json!({"key":key,"name":"占位","kind":kind,"start":"first","auto":false,"academy":true,
            "chapters":[{"key":"first","title":"占位","text":"占位","once":true,
                "when":[{"kind":"date","from":[1502,1,11],"to":[1502,1,11]}],
                "choices":[{"key":"ok","text":"继续","next":"done"}]}]})
    };
    let mut w = scheduled(
        json!([
            ordinary,
            urgent("limited", "encounter"),
            urgent("important", "request"),
            urgent("c9_x_letter_news", "encounter")
        ]),
        json!({"ordinary":{},"limited":{},"important":{},"c9_x_letter_news":{}}),
    );
    Arc::make_mut(&mut w.defs).rules.upbringing.monthly_ordinary_events = true;
    assert_eq!(first_slot(&mut w), ["c9_x_letter_news", "important", "limited"]);
    assert!(w.state.upbringing.as_ref().unwrap().event_backlog.iter().any(|key| key == "ordinary"));
    while w.pending_story2().is_some() {
        Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    }
    let mut w = World::from_snapshot(w.defs.clone(), w.state).unwrap();
    let mut seen = Vec::new();
    while w.cast_date() < [1502, 3, 1] {
        if w.state.upbringing.as_ref().unwrap().phase == Phase::Plan {
            rest_month(&mut w);
        }
        w.end_day().unwrap();
        if let Some(pending) = w.pending_story2() {
            assert_eq!(pending.track, "ordinary");
            seen.push(w.cast_date());
            Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
        }
    }
    assert_eq!(seen, [[1502, 1, 21], [1502, 2, 21]]);
}

#[test]
fn middle_slot_keeps_timed_events_deadlines_letters_and_story_tracks() {
    for (key, kind, tier, deadline) in [
        ("c9_x_birthday_a", "encounter", None, false),
        ("c9_x_critical_event", "encounter", None, false),
        ("ordinary_deadline", "encounter", Some("filler"), true),
        ("c9_x_letter_news", "encounter", Some("special"), false),
        ("story_line", "request", Some("special"), false),
    ] {
        let mut event = json!({"key":key,"name":"占位","kind":kind,"start":"first","auto":false,"academy":true,
            "chapters":[{"key":"first","title":"占位","text":"占位","once":true,
                "when":[{"kind":"date","from":[1502,1,21]}],
                "choices":[{"key":"ok","text":"继续","next":"done"}]}]});
        if deadline {
            event["chapters"][0]["when"][0]["to"] = json!([1502, 1, 21]);
        }
        let gate = tier.map_or_else(|| json!({}), |tier| json!({"tier":tier}));
        let mut gates = serde_json::Map::new();
        gates.insert(key.into(), gate);
        let mut w = scheduled(json!([event]), Value::Object(gates));
        assert!(first_slot(&mut w).is_empty(), "{key}");
        for _ in 0..10 {
            w.end_day().unwrap();
        }
        assert_eq!(w.pending_story2().map(|p| p.track.as_str()), Some(key), "{key}");
    }
}

#[test]
fn a_failed_check_continues_in_the_same_event_on_the_same_day() {
    let critical = json!({"key":"c9_x_critical_00","name":"占位","kind":"request","start":"event","auto":false,"academy":true,
        "chapters":[
            {"key":"event","title":"占位","text":"占位","choices":[
                {"key":"skill","text":"占位","next":"done","check":{"attr":"commerce","base":-100,"per":0},
                 "fail":{"next":"event_fail"}}]},
            {"key":"event_fail","title":"占位","text":"占位","choices":[{"key":"note","text":"占位","next":"later"}]},
            {"key":"later","title":"占位","text":"占位","when":[{"kind":"date","from":[1502,6,1]}],
             "choices":[{"key":"ok","text":"占位","next":"done"}]}]});
    let mut w = scheduled(json!([critical]), json!({"c9_x_critical_00":{}}));
    assert_eq!(first_slot(&mut w), ["c9_x_critical_00"]);
    let day = w.day();
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    assert_eq!(w.state.story2.last.as_ref().unwrap().success, Some(false));
    // 失败续章当天就排在面前，不等下一旬的抽签。
    let p = w.pending_story2().unwrap();
    assert_eq!((p.track.as_str(), p.chapter.as_str(), w.day()), ("c9_x_critical_00", "event_fail", day));
    Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }.apply(&mut w).unwrap();
    // 带新日期条件的下一段重新排队：许可收回。
    assert!(w.pending_story2().is_none());
    assert!(!w.state.upbringing.as_ref().unwrap().event_permits.contains("c9_x_critical_00"));
}

#[test]
fn reachability_rejects_impossible_activities_gates_and_start_chapters() {
    let fine = track("fine", json!({"academy":true}), ok());
    let mut too_old = track("too_old", json!({"academy":true}), ok());
    // 六岁以下：开局时主角已经十二岁，永远等不到。
    too_old["chapters"][0]["when"] = json!([{"kind":"age","le":5}]);
    let mut orphan = track("orphan", json!({"academy":true}), ok());
    orphan["chapters"][0]["when"] = json!([{"kind":"flag","flag":"never_set"}]);
    let mut d = (*base(json!([fine, too_old, orphan]))).clone();
    d.upbringing.activities[0].age = Some([30, 40]);
    d.upbringing.event_gates.insert("fine".into(), EventGate { academy: Some("nowhere".into()), ..Default::default() });
    let r = Reachability::new(&d);
    let errors = r.unreachable();
    for prefix in ["too_old:first:", "orphan:first:", "activity:rest:", "fine:"] {
        assert!(errors.iter().any(|e| e.starts_with(prefix)), "{prefix} {errors:?}");
    }
    assert_eq!(errors.len(), 4, "{errors:?}");
    // 可达的章节有最早日期，设旗标的选项把旗标的最早日期往前推。
    assert!(r.chapters.contains_key(&("fine".to_string(), "first".to_string())));
    assert!(!r.chapters.contains_key(&("orphan".to_string(), "first".to_string())));
}

#[test]
fn constraint_gaps_list_what_is_missing_now() {
    let d = base(json!([]));
    let w = World::new(d.clone(), ScenarioId(0), 42).unwrap();
    let attr = w.defs.captain.attributes.iter().find(|a| a.key != "fortune").unwrap().key.clone();
    let have = w.upbringing_projected(&attr);
    let cs = vec![
        Constraint::Flag { flag: "nope".into(), value: true },
        Constraint::Attr { attr: attr.clone(), ge: have + 2, hard: true },
        Constraint::Cash { ge: 0 },
        Constraint::Any {
            any: vec![
                vec![Constraint::Cash { ge: i64::MAX }],
                vec![
                    Constraint::Flag { flag: "a".into(), value: true },
                    Constraint::Flag { flag: "b".into(), value: true },
                ],
            ],
        },
        Constraint::Opaque { what: "at".into() },
    ];
    let gaps = w.constraint_gaps(&cs);
    let keys: Vec<_> = gaps.iter().map(|g| g.key.as_str()).collect();
    assert_eq!(keys, ["flag:nope", &format!("attr:{attr}"), "cash"]);
    assert_eq!((gaps[1].have, gaps[1].need), (have, have + 2));
    // 只读：查差项不改世界。
    let before = w.state_hash();
    let _ = w.constraint_gaps(&cs);
    assert_eq!(w.state_hash(), before);
}
