//! S01：奇遇（旧式剧情里的随机小事，寰宇出海以后用它）与节奏闸、养成期、待决队列的先后。
//!
//! - 规则开着时，奇遇不在日结途中掷，而是等新一天的头一次刷新之后：过闸的事都排定了，名额有剩才出；
//!   当天已经有别的事出场、或者窗口里可以等的事满了，就当今天没遇到，不记成“按着”；
//! - 养成期一条都不出，规则开没开都一样；
//! - 奇遇只等到当天日结，排在玩家搁了几天的章节、一个选项也交不上的章节前面，排在今天刚出场的章节后面；
//! - 规则关着的世界（经典）照旧在日结途中掷，见 `tests.rs` 与 `manifest-core --test story`。
//!
//! 夹具沿用分类测试的小型世界与那条“每天必出”的港口奇遇（`classic_defs`）。
use super::tests::{PLAYER, base, classic_defs, create_captain, rest_month, track, world};
use super::*;
use crate::defs::PacingRules;
use crate::story::StorySource;
use crate::{Command, StaticData};
use serde_json::{Value, json};

fn on() -> PacingRules {
    PacingRules { enabled: true, ..PacingRules::default() }
}

/// 没有养成、没有经典故事线，只有那条每天必出的港口奇遇；`tracks` 是出海后的 story2 轨道。
fn sea_defs(tracks: Value, rules: PacingRules) -> StaticData {
    let mut d = base(tracks);
    d.scenarios[0].upbringing = false;
    d.stories = classic_defs().stories;
    d.stories.stories.clear();
    d.rules.pacing = rules;
    d
}

fn sea(tracks: Value, rules: PacingRules) -> World {
    let mut w = world(sea_defs(tracks, rules));
    create_captain(&mut w);
    w
}

fn log(w: &World) -> Vec<(u32, BeatWeight)> {
    w.state.pacing.log.iter().map(|r| (r.day, r.weight)).collect()
}

/// 此刻摆在玩家面前的奇遇记在哪一天；没有奇遇时为 None。
fn encounter(w: &World) -> Option<u32> {
    w.state.story.pending.as_ref().filter(|p| p.source == StorySource::Encounter("gull".into())).map(|p| p.day)
}

fn queued(w: &World) -> Vec<&str> {
    w.state.story2.pending.iter().map(|p| p.track.as_str()).collect()
}

fn set_flag(w: &mut World, flag: &str) {
    w.state.story2.flags.insert(flag.into());
    w.refresh_story2();
}

fn answer(w: &mut World) {
    Command::StoryAnswer { owner: PLAYER, choice: 0 }.apply(w).unwrap();
}

/// 立了旗标才出场的故事（Major），选项无门槛。
fn flagged(key: &str, flag: &str) -> Value {
    track(key, "request", json!({}), &[("first", json!([{"kind":"flag","flag":flag}]), "done")])
}

#[test]
fn with_the_gate_on_the_encounter_is_rolled_after_the_gate_and_obeys_the_window() {
    use BeatWeight::Minor;
    let mut w = sea(json!([]), on());
    assert_eq!(encounter(&w), None);
    // 头三天：每天一件。记在昨夜结算的那一天（玩家今天看到、今天日结时作罢），账记在今天。
    for n in 1..=3u32 {
        w.end_day().unwrap();
        assert_eq!(encounter(&w), Some(w.day() - 1), "第 {n} 天");
        assert_eq!(log(&w).last(), Some(&(w.day(), Minor)));
        assert_eq!(log(&w).len() as u32, n);
        // 分类与期限同规则关着时一样：点缀，只等到今天。
        let beat = w.pacing_waiting().into_iter().find(|b| b.key == "gull").unwrap();
        assert_eq!((beat.source, beat.weight, beat.deadline), (BeatSource::Encounter, Minor, Some(w.day())));
    }
    assert_eq!(w.day(), 3);
    // 七天里可以等的事满了三件：第 4–7 天掷不出来——没有名额，不是被“按着”。
    for _ in 4..=7 {
        w.end_day().unwrap();
        assert_eq!(encounter(&w), None, "第 {} 天", w.day());
        assert!(w.state.pacing.held.is_empty());
    }
    assert_eq!(w.state.story.encounter_day, Some(2), "上一次奇遇还是第 3 天早上那一件（记作第 2 天）");
    // 第 8 天，第 1 天那一件滑出了窗口：又轮到它。
    w.end_day().unwrap();
    assert_eq!((w.day(), encounter(&w)), (8, Some(7)));
    // 回应照旧走内核的 StoryAnswer。
    answer(&mut w);
    assert!(w.state.story.pending.is_none() && w.state.story.last.as_ref().is_some_and(|r| r.choice == Some(0)));
}

#[test]
fn an_encounter_never_shares_its_morning_with_another_beat() {
    // 进入轨道两天后才出场的故事：第 2 天早上由闸放行。
    let waiting = track("side", "request", json!({}), &[("first", json!([{"kind":"wait","days":2}]), "done")]);
    let mut w = sea(json!([waiting]), on());
    w.end_day().unwrap();
    assert_eq!((w.day(), encounter(&w)), (1, Some(0)));
    assert!(queued(&w).is_empty());
    // 第 2 天：故事先过闸、占了今天的名额，奇遇就不掷了（昨天那件没人回应，已经作罢）。
    w.end_day().unwrap();
    assert_eq!((w.day(), queued(&w)), (2, vec!["side"]));
    assert_eq!(encounter(&w), None);
    assert_eq!(w.state.story.encounter_day, Some(0));
    assert_eq!(log(&w), [(1, BeatWeight::Minor), (2, BeatWeight::Major)]);
    assert!(w.story2_is_front());
    // 第 3 天：故事还搁着（不是今天的事了），今天没有别的事出场，奇遇照出，而且排在它前面。
    w.end_day().unwrap();
    assert_eq!((w.day(), queued(&w), encounter(&w)), (3, vec!["side"], Some(2)));
    assert!(!w.story2_is_front(), "搁了一天的章节不挡只等一天的奇遇");
    assert!(!w.story2_front_fresh());
    answer(&mut w);
    // 答掉的是奇遇；故事还在，轮到它了。
    assert!(w.state.story.pending.is_none() && w.state.story.last.is_some());
    assert_eq!(queued(&w), ["side"]);
    assert!(w.state.story2.last.is_none());
    assert!(w.story2_is_front());
    answer(&mut w);
    assert!(queued(&w).is_empty() && w.state.story2.last.is_some());
}

#[test]
fn a_fresh_answerable_chapter_goes_first_and_a_locked_one_stays_out_of_the_queue() {
    // 今天白天才引出的章节（玩家的命令立了旗标）：出场日是今天，答得了——排在奇遇前面。
    let mut w = sea(json!([flagged("fresh", "go")]), on());
    w.end_day().unwrap();
    assert_eq!(encounter(&w), Some(0));
    set_flag(&mut w, "go");
    assert_eq!(queued(&w), ["fresh"]);
    assert!(w.story2_is_front() && w.story2_front_fresh());
    answer(&mut w);
    assert!(w.state.story2.last.is_some() && w.state.story.last.is_none());
    // 章节答完，奇遇还在今天，轮到它。
    assert!(!w.story2_is_front());
    answer(&mut w);
    assert!(w.state.story.last.is_some());

    // 同样是今天才满足条件，可唯一的选项要一笔拿不出的钱：选项全锁的章节不进队列（S02nZ5 起一律暂挂），不把奇遇挡到过期。
    let locked = json!({"key":"locked","name":"占位","kind":"request","start":"first","chapters":[
        {"key":"first","title":"占位","text":"占位","when":[{"kind":"flag","flag":"go"}],
         "choices":[{"key":"pay","text":"付钱","next":"done","requires":[{"kind":"cash","ge":1_000_000_000_000i64}]}]}]});
    let mut w = sea(json!([locked]), on());
    w.end_day().unwrap();
    assert_eq!(encounter(&w), Some(0));
    set_flag(&mut w, "go");
    assert!(queued(&w).is_empty());
    assert!(!w.story2_is_front());
    answer(&mut w);
    assert!(w.state.story.last.is_some() && w.state.story2.last.is_none());
    // 奇遇答完，那一章仍然不在队列里，也答不了。
    assert!(queued(&w).is_empty() && !w.story2_is_front());
    assert!(Command::StoryAnswer { owner: PLAYER, choice: 0 }.apply(&mut w).is_err());
}

#[test]
fn without_the_gate_a_pending_chapter_keeps_its_place_ahead_of_the_encounter() {
    // 规则关着（经典世界）：照旧在日结途中掷，章节不论新旧都排在奇遇前面——与加这条规则之前一样。
    let waiting = track("side", "request", json!({}), &[("first", json!([]), "done")]);
    let mut w = sea(json!([waiting]), PacingRules::default());
    assert_eq!(queued(&w), ["side"]);
    w.end_day().unwrap();
    w.end_day().unwrap();
    assert_eq!(encounter(&w), Some(w.day() - 1));
    assert!(w.story2_is_front(), "没有节奏规则时不改先后");
    assert!(w.state.pacing.is_empty());
}

#[test]
fn encounters_never_appear_during_upbringing() {
    // 立过身世的主角档案：从出海的世界里取一份现成的。
    let profile = sea(json!([]), on()).captain_profile(PLAYER).cloned();
    assert!(profile.is_some());
    for rules in [PacingRules::default(), on()] {
        let gated = rules.enabled;
        // 养成剧本（家乡期），同一条每天必出的奇遇。
        let mut d = sea_defs(json!([]), rules.clone());
        d.scenarios[0].upbringing = true;
        let mut w = world(d);
        w.state.agents.get_mut(&PLAYER).unwrap().captain = profile.clone();
        assert!(w.story_enabled() && w.upbringing_active());
        for _ in 0..45 {
            if w.upbringing_waiting() {
                rest_month(&mut w);
            }
            w.end_day().unwrap();
            assert!(w.state.story.pending.is_none(), "养成期第 {} 天冒出了奇遇（闸 {gated}）", w.day());
        }
        assert!(w.state.story.seen.is_empty() && w.state.story.encounter_day.is_none());
        assert!(w.state.story.is_pristine(), "养成期不留下任何奇遇的痕迹");
        // 对照：同一份数据、不是养成剧本，头一天就遇到。
        let mut d = sea_defs(json!([]), rules);
        d.scenarios[0].upbringing = false;
        let mut w = world(d);
        w.state.agents.get_mut(&PLAYER).unwrap().captain = profile.clone();
        w.end_day().unwrap();
        assert_eq!(encounter(&w), Some(0), "闸 {gated}");
    }
}

#[test]
fn the_same_seed_meets_the_same_encounters_on_the_same_days() {
    let run = |seed: u64| {
        let mut d = sea_defs(json!([]), on());
        // 每天四成，间隔两天：让随机数真的起作用。
        d.stories.rules.encounter_bp = 4_000;
        d.stories.rules.gap_days = 2;
        let mut w = World::new(std::sync::Arc::new(d), crate::ScenarioId(0), seed).unwrap();
        create_captain(&mut w);
        let mut days = Vec::new();
        for _ in 0..60 {
            w.end_day().unwrap();
            if encounter(&w).is_some() {
                days.push(w.day());
                answer(&mut w);
            }
        }
        (days, w.state_hash())
    };
    let (a, b, c) = (run(7), run(7), run(8));
    assert_eq!(a, b, "同种子两次结果相同");
    assert!(a.0.len() >= 5, "{:?}", a.0);
    assert_ne!(a.0, c.0, "换一颗种子，日子不同");
    // 间隔与窗口都守着：相邻两次至少隔两天，任意七天里不超过三件。
    assert!(a.0.windows(2).all(|p| p[1] - p[0] >= 2), "{:?}", a.0);
    assert!(a.0.windows(4).all(|p| p[3] - p[0] >= 7), "{:?}", a.0);
}
