//! 节奏分类的内核回归：每一类来源至少一条断言。
//!
//! 养成期的夹具照 U03 的测试搭（小型世界加一户占位家庭）；出海的各类遭遇都走真实的生成入口——
//! 海战在舰队身边放一支海盗再跑 `battle_day`，怪异与经典剧情在测试里拼一份最小定义
//! （testkit 没有现成的怪异、故事线与奇遇，内容由测试自己写，生成仍由内核的日结入口完成）。
use super::*;
use crate::upbringing::{AfterChoice, MoodRules, PlanSlot};
use crate::{Command, LocId, RegionId, ScenarioId, StaticData, testkit};
use serde_json::{Value, json};
use std::sync::Arc;

pub(super) const PLAYER: OwnerId = OwnerId::Player;

/// 小型世界加一户占位家庭：1502-01-01 起的家乡期，只有“休息”一项活动。
pub(super) fn base(tracks: Value) -> StaticData {
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
    d
}

pub(super) fn world(d: StaticData) -> World {
    World::new(Arc::new(d), ScenarioId(0), 42).unwrap()
}

/// 一条轨道；`chapters` 里每一项是（章节 key、出场条件、下一章）。
pub(super) fn track(key: &str, kind: &str, extra: Value, chapters: &[(&str, Value, &str)]) -> Value {
    let chapters: Vec<Value> = chapters
        .iter()
        .map(|(chapter, when, next)| {
            json!({"key":chapter,"title":"占位","text":"占位","when":when,
                "choices":[{"key":"ok","text":"继续","next":next}]})
        })
        .collect();
    let mut t = json!({"key":key,"name":"占位","kind":kind,"start":chapters[0]["key"],"chapters":chapters});
    if let (Some(t), Some(extra)) = (t.as_object_mut(), extra.as_object()) {
        t.extend(extra.clone());
    }
    t
}

/// 只有一章、由每旬调度排出的事件（不自动开始的学院轨道）。
pub(super) fn event(key: &str, kind: &str, when: Value) -> Value {
    track(key, kind, json!({"auto":false,"academy":true}), &[("first", when, "done")])
}

pub(super) fn rest_month(w: &mut World) {
    let slots =
        (0..3).map(|index| PlanSlot { index, lesson: None, after: Some(AfterChoice::activity("rest")) }).collect();
    Command::PlanMonth { owner: PLAYER, slots }.apply(w).unwrap();
}

/// 排好月程、过完上旬：1502-01-11 的旬调度刚排出事件。
pub(super) fn after_first_slot(d: StaticData, gates: &[&str]) -> World {
    let mut d = d;
    d.upbringing.event_gates = gates.iter().map(|k| ((*k).to_owned(), Default::default())).collect();
    let mut w = world(d);
    rest_month(&mut w);
    for _ in 0..10 {
        w.end_day().unwrap();
    }
    assert_eq!(w.cast_date(), [1502, 1, 11]);
    w
}

pub(super) fn waiting(w: &World, key: &str) -> Beat {
    let beats = w.pacing_waiting();
    beats.iter().find(|b| b.key == key).cloned().unwrap_or_else(|| panic!("{key} 不在等回应：{beats:?}"))
}

pub(super) fn answer(w: &mut World) {
    Command::StoryAnswer { owner: PLAYER, choice: 0 }.apply(w).unwrap();
}

#[test]
fn names_follow_serde_and_default_weights_cover_every_source() {
    for source in BeatSource::ALL {
        assert_eq!(serde_json::to_value(source).unwrap(), json!(source.key()));
    }
    for weight in BeatWeight::ALL {
        assert_eq!(serde_json::to_value(weight).unwrap(), json!(weight.key()));
    }
    let of = |weight| BeatSource::ALL.into_iter().filter(|s| s.weight() == weight).collect::<Vec<_>>();
    use BeatSource::*;
    assert_eq!(of(BeatWeight::Key), [Plan, LowMood, Timed, Battle]);
    assert_eq!(of(BeatWeight::Major), [Letter, Focus, Bond, Continuation, Story]);
    assert_eq!(of(BeatWeight::Minor), [Ordinary, Filler, Encounter, Creature]);
    // 序列化的名字就是存档与报告里的名字；枚举只在末尾追加。
    assert_eq!(serde_json::to_value(LowMood).unwrap(), json!("low_mood"));
    assert_eq!(serde_json::from_value::<BeatSource>(json!("continuation")).unwrap(), Continuation);
}

#[test]
fn month_plan_is_a_key_beat_until_the_plan_is_submitted() {
    let mut w = world(base(json!([])));
    let plan = w.pacing_waiting();
    assert_eq!(plan.len(), 1, "{plan:?}");
    assert_eq!(
        plan[0],
        Beat {
            source: BeatSource::Plan,
            weight: BeatWeight::Key,
            key: "1502-01".into(),
            chapter: None,
            since: w.day(),
            deadline: None,
            slot: None,
        }
    );
    rest_month(&mut w);
    assert!(w.pacing_waiting().is_empty());
    // 换月的第一天又等着排月程。
    while w.cast_date() < [1502, 2, 1] {
        w.end_day().unwrap();
    }
    let plan = waiting(&w, "1502-02");
    assert_eq!((plan.source, plan.since), (BeatSource::Plan, w.day()));
    assert!(w.upbringing_waiting());
    // 只读：看一眼在等什么不改世界。
    let before = w.state_hash();
    let _ = w.pacing_waiting();
    assert_eq!(w.state_hash(), before);
}

#[test]
fn unscheduled_lines_are_bond_and_a_same_day_follow_up_is_a_continuation() {
    let auto = json!({"academy":true});
    let today = json!([{"kind":"date","from":[1502,1,1]}]);
    let mut w = world(base(json!([
        // 自动开始的学院线：不经旬调度，开局当天就在等。
        track("bond_friend", "request", auto.clone(), &[("c1", json!([]), "c2"), ("c2", json!([]), "done")]),
        // 下一章带自己的日期条件：当天就满足，也算新的一段，不是续章。
        track("bond_rival", "request", auto.clone(), &[("c1", json!([]), "c2"), ("c2", today, "done")]),
        // 主线种类的自动线：来源照旧，分量按要紧。
        track("newbie", "main", auto, &[("up", json!([]), "done")]),
    ])));
    let day = w.day();
    let beats = w.pacing_waiting();
    // 按（分量、来源、key）排：要紧的月程与主线在前。
    let order: Vec<_> = beats.iter().map(|b| (b.weight, b.source, b.key.as_str())).collect();
    assert_eq!(
        order,
        [
            (BeatWeight::Key, BeatSource::Plan, "1502-01"),
            (BeatWeight::Key, BeatSource::Bond, "newbie"),
            (BeatWeight::Major, BeatSource::Bond, "bond_friend"),
            (BeatWeight::Major, BeatSource::Bond, "bond_rival"),
        ]
    );
    let friend = waiting(&w, "bond_friend");
    assert_eq!((friend.chapter.as_deref(), friend.since, friend.slot, friend.deadline), (Some("c1"), day, None, None));
    // 队首是主线；答掉以后轮到 bond_friend。
    assert_eq!(w.pending_story2().unwrap().track, "newbie");
    answer(&mut w);
    assert_eq!(w.pending_story2().unwrap().track, "bond_friend");
    answer(&mut w);
    let next = waiting(&w, "bond_friend");
    assert_eq!(
        (next.source, next.weight, next.chapter.as_deref(), next.since),
        (BeatSource::Continuation, BeatWeight::Major, Some("c2"), day)
    );
    answer(&mut w);
    assert_eq!(w.pending_story2().unwrap().track, "bond_rival");
    answer(&mut w);
    let next = waiting(&w, "bond_rival");
    assert_eq!((next.source, next.chapter.as_deref()), (BeatSource::Bond, Some("c2")));
    // 分类函数与队列里的那一项一一对应。
    let p = w.pending_story2().unwrap().clone();
    assert_eq!(w.pacing_classify_story2(&p), next);
}

#[test]
fn engine_dated_events_and_calendar_keys_are_timed_even_without_the_slot_quota() {
    let mut d = base(json!([
        event("enroll", "request", json!([])),
        track("c9_academy_opening", "request", json!({"academy":true}), &[("first", json!([]), "done")]),
        track("bond_friend", "request", json!({"academy":true}), &[("first", json!([]), "done")]),
    ]));
    // 学院阶段要等入学事件设旗标：阶段日期一到，引擎直接开启入学事件（不经旬调度）。
    let at = d.locations[0].key.clone();
    let academy = json!({"from":[1502,1,1],"stage":"academy","name":"占位","at":at,
        "entry_flag":"enrolled","entry_event":"enroll"});
    d.upbringing.families[0].stages.push(serde_json::from_value(academy).unwrap());
    let w = world(d);
    for key in ["enroll", "c9_academy_opening"] {
        let b = waiting(&w, key);
        assert_eq!((b.source, b.weight, b.slot), (BeatSource::Timed, BeatWeight::Key, None), "{key}");
    }
    assert_eq!(waiting(&w, "bond_friend").source, BeatSource::Bond);
}

/// 一个候选事件：key、轨道种类、出场条件。
type Candidate<'a> = (&'a str, &'a str, Value);
/// 期望的分类：key、来源、分量、旬配额的位。
type Expected<'a> = (&'a str, BeatSource, BeatWeight, u8);

#[test]
fn scheduled_events_are_classified_by_slot_and_tier() {
    use BeatSource::*;
    let due = json!([{"kind":"date","to":[1502,1,11]}]);
    let cases: [(&[Candidate], &[Expected]); 3] = [
        // 重点位、短事件位、来信位各一个。
        (
            &[
                ("story_line", "request", json!([])),
                ("c9_x_rare_0", "encounter", json!([])),
                ("c9_x_letter_0", "encounter", json!([])),
            ],
            &[
                ("story_line", Focus, BeatWeight::Major, 0),
                ("c9_x_rare_0", Ordinary, BeatWeight::Minor, 1),
                ("c9_x_letter_0", Letter, BeatWeight::Major, 2),
            ],
        ),
        // 关键事件占重点位也是限时；日常池是填充。
        (
            &[("c9_x_critical_00", "request", json!([])), ("c9_pool_east_daily_00_0", "encounter", json!([]))],
            &[
                ("c9_x_critical_00", Timed, BeatWeight::Key, 0),
                ("c9_pool_east_daily_00_0", Filler, BeatWeight::Minor, 1),
            ],
        ),
        // 生日按 key 是限时；普通名字的短事件带了截止日也是限时。
        (
            &[("c9_x_birthday_a", "request", json!([])), ("plain_side", "encounter", due)],
            &[("c9_x_birthday_a", Timed, BeatWeight::Key, 0), ("plain_side", Timed, BeatWeight::Key, 1)],
        ),
    ];
    for (events, expected) in cases {
        let tracks: Vec<Value> = events.iter().map(|(key, kind, when)| event(key, kind, when.clone())).collect();
        let gates: Vec<&str> = events.iter().map(|(key, _, _)| *key).collect();
        let w = after_first_slot(base(json!(tracks)), &gates);
        assert_eq!(w.pacing_waiting().len(), expected.len(), "{:?}", w.pacing_waiting());
        for (key, source, weight, slot) in expected {
            let b = waiting(&w, key);
            assert_eq!((b.source, b.weight, b.slot, b.since), (*source, *weight, Some(*slot), w.day()), "{key}");
        }
        assert_eq!(waiting(&w, expected[0].0).chapter.as_deref(), Some("first"));
    }
    // 截止日跟着章节的日期条件走。
    let w = after_first_slot(
        base(json!([event("plain_side", "encounter", json!([{"kind":"date","to":[1502,1,11]}]))])),
        &["plain_side"],
    );
    assert_eq!(waiting(&w, "plain_side").deadline, Some(w.day()));
}

#[test]
fn a_low_mood_event_is_its_own_key_source_due_today() {
    let mut d = base(json!([event("c9_x_low_sulk", "encounter", json!([]))]));
    d.upbringing.rules.mood = Some(MoodRules { low_events: vec!["c9_x_low_*".into()], ..MoodRules::default() });
    let mut w = world(d);
    // 夹具里的休息只回一点心情：开局心情放在门槛以下，上旬结算时自然进入低谷，旬调度把低谷事件排在最前。
    w.state.upbringing.as_mut().unwrap().mood = 0;
    rest_month(&mut w);
    for _ in 0..10 {
        w.end_day().unwrap();
    }
    assert!(w.state.upbringing.as_ref().unwrap().low_mood);
    let b = waiting(&w, "c9_x_low_sulk");
    assert_eq!(
        (b.source, b.weight, b.slot, b.deadline),
        (BeatSource::LowMood, BeatWeight::Key, Some(1), Some(w.day()))
    );
}

#[test]
fn after_upbringing_lines_are_story_timed_or_encounter_and_main_lines_are_key() {
    let mut windowed = track("windowed", "request", json!({}), &[("first", json!([]), "done")]);
    windowed["chapters"][0]["window"] = json!([[1502, 1, 1], [1502, 3, 1]]);
    let mut d = base(json!([
        track("main_line", "main", json!({}), &[("first", json!([]), "second"), ("second", json!([]), "done")]),
        track("side", "request", json!({}), &[("first", json!([]), "done")]),
        windowed,
        track("chance", "encounter", json!({}), &[("first", json!([]), "done")]),
    ]));
    // 没有养成的剧本：所有轨道都按出海后的规则分。
    d.scenarios[0].upbringing = false;
    let mut w = world(d);
    assert!(!w.upbringing_active());
    let got: Vec<_> = w.pacing_waiting().into_iter().map(|b| (b.weight, b.source, b.key, b.slot)).collect();
    assert_eq!(
        got,
        [
            (BeatWeight::Key, BeatSource::Timed, "windowed".to_owned(), None),
            (BeatWeight::Key, BeatSource::Story, "main_line".to_owned(), None),
            (BeatWeight::Major, BeatSource::Story, "side".to_owned(), None),
            (BeatWeight::Minor, BeatSource::Encounter, "chance".to_owned(), None),
        ]
    );
    let end = crate::scenario::day_of(&w.defs, [1502, 3, 1]).unwrap();
    assert_eq!(waiting(&w, "windowed").deadline, Some(end));
    assert_eq!(waiting(&w, "side").deadline, None);
    // 主线的下一章当场接着出：来源是续章，分量仍按主线。
    assert_eq!(w.pending_story2().unwrap().track, "main_line");
    answer(&mut w);
    let next = waiting(&w, "main_line");
    assert_eq!((next.source, next.weight), (BeatSource::Continuation, BeatWeight::Key));
}

/// 经典剧情的最小定义：一条只有一章的故事线，加一个每天必出的奇遇。
pub(super) fn classic_defs() -> StaticData {
    use crate::story::{ChapterDef, ChoiceDef, EncounterDef, Place, Speaker, StoryDef, StoryDefs, StoryRules};
    let mut d = (*testkit::captain_defs()).clone();
    let choice = ChoiceDef {
        text: "继续".into(),
        reply: String::new(),
        cost: 0,
        give: None,
        check: None,
        effects: Vec::new(),
        fail: Vec::new(),
        fail_reply: String::new(),
    };
    d.stories = StoryDefs {
        rules: StoryRules { encounter_bp: 10_000, gap_days: 0, first_day: 0 },
        stories: vec![StoryDef {
            key: "line".into(),
            name: "占位".into(),
            chapters: vec![ChapterDef {
                key: "opening".into(),
                title: "占位".into(),
                text: "占位".into(),
                hint: String::new(),
                speaker: Speaker::None,
                speaker_name: String::new(),
                when: Vec::new(),
                choices: vec![choice.clone()],
            }],
        }],
        encounters: vec![EncounterDef {
            key: "gull".into(),
            title: "占位".into(),
            text: "占位".into(),
            speaker: Speaker::None,
            speaker_name: String::new(),
            place: Place::Port,
            when: Vec::new(),
            weight: 1,
            once: false,
            cooldown_days: 0,
            choices: vec![choice],
        }],
    };
    d.scenarios[0].story = Some(0);
    d
}

/// 立主角身世：剧情事件只在立过身世的对局里发生。
pub(super) fn create_captain(w: &mut World) {
    let year = w.defs.rules.world.calendar_year(w.defs.calendar.date_of(w.player_start_day()).year) - 20;
    Command::CreateCaptain {
        owner: PLAYER,
        birthday: crate::captain::Birthday { year, month: 6, day: 1 },
        answers: vec!["plain".into(), "university".into(), "relative".into()],
        alloc: vec![1, 1, 1, 1, 1, 0],
        genius: None,
    }
    .apply(w)
    .unwrap();
}

#[test]
fn classic_chapters_are_key_stories_and_classic_encounters_lapse_the_next_day() {
    let mut w = world(classic_defs());
    create_captain(&mut w);
    assert!(w.pacing_waiting().is_empty());
    w.end_day().unwrap();
    let chapter = waiting(&w, "line");
    assert_eq!(
        (chapter.source, chapter.weight, chapter.chapter.as_deref(), chapter.since, chapter.deadline),
        (BeatSource::Story, BeatWeight::Key, Some("opening"), w.day() - 1, None)
    );
    answer(&mut w);
    // 故事线走完以后，满足间隔的日子按概率遇到奇遇；它只等到出现的第二天。
    w.end_day().unwrap();
    let gull = waiting(&w, "gull");
    assert_eq!(
        (gull.source, gull.weight, gull.chapter, gull.since, gull.deadline),
        (BeatSource::Encounter, BeatWeight::Minor, None, w.day() - 1, Some(w.day()))
    );
}

#[test]
fn a_creature_encounter_waits_without_a_deadline() {
    let mut d = (*testkit::tiny_defs()).clone();
    let port = d.loc(d.scenarios[0].start_loc).key.clone();
    d.creatures = serde_json::from_value(json!({"moon_epoch":0,"creatures":[{
        "key":"sample","name":"占位","text":"占位","ports":[port],
        "responses":["avoid"],"outcomes":{"avoid":{}},"chance_bp":10000,"cooldown_days":0}]}))
    .unwrap();
    let mut w = world(d);
    assert!(w.pacing_waiting().is_empty());
    w.creatures_day().unwrap();
    let b = waiting(&w, "sample");
    assert_eq!(
        (b.source, b.weight, b.chapter, b.since, b.deadline),
        (BeatSource::Creature, BeatWeight::Minor, None, w.day(), None)
    );
    let encounter = w.state.creatures.pending.as_ref().unwrap().id.clone();
    Command::RespondCreature { owner: PLAYER, encounter, response: crate::creatures::Response::Avoid }
        .apply(&mut w)
        .unwrap();
    assert!(w.pacing_waiting().is_empty());
}

#[test]
fn a_pending_battle_is_a_key_beat_until_it_is_engaged() {
    let mut d = (*testkit::tiny_defs()).clone();
    // 只留下面手放的这一支海盗，并且让它待在原地。
    d.rules.pirates.spawn_scale = crate::Fx::ZERO;
    d.rules.pirates.speed = 0;
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
    let beats = w.pacing_waiting();
    assert_eq!(beats.len(), 1, "{beats:?}");
    let b = &beats[0];
    assert_eq!(
        (b.source, b.weight, b.since, b.deadline),
        (BeatSource::Battle, BeatWeight::Key, w.day(), Some(w.day() + 1))
    );
    let battle = *w.state.battles.pending.keys().next().unwrap();
    assert_eq!(b.key, format!("battle:{}", battle.0));
    Command::EngageBattle { owner: PLAYER, battle, tactical: false }.apply(&mut w).unwrap();
    assert!(w.pacing_waiting().is_empty());
}
