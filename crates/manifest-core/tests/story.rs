//! 剧情事件：推荐角色的故事线与奇遇。使用内核自带的小型世界（`testkit::captain_defs`，有主角身世），
//! 另加一条三章的故事线、一个带主角的剧本（ScenarioId 1，只给它用的身世选项 hero_only）与两种奇遇（海上、港口）。
//!
//! 覆盖：没有主角档案时一切照旧、状态不写进存档；章节按顺序在条件满足时出现、等玩家回应、不会过期；
//! 选项的花费与交货挡住不够的回应；效果只经内核执行、账目平衡；奇遇当天没有回应就作罢；检定按独立的随机域确定；
//! 故事走完即达成目标；只给推荐角色的身世选项只在它自己的剧本里能选；命令写入日志，只用日志重放一致；存档往返不丢状态。

use manifest_core::captain::{ARMS, Birthday};
use manifest_core::defs::{Goal, GoalKind, HeroDef};
use manifest_core::goals::{OutcomeKind, OutcomeReason};
use manifest_core::log::LogKind;
use manifest_core::mates::MateRole;
use manifest_core::replay::{LogEntry, Source, StartParams, replay};
use manifest_core::save::SaveFile;
use manifest_core::story::{
    ChapterDef, Check, ChoiceDef, Cond, EncounterDef, Place, Speaker, StoryDef, StoryDefs, StoryEffect, StoryOutcome,
    StoryRules, StorySource,
};
use manifest_core::testkit::{captain_defs, check_invariants};
use manifest_core::world::FleetLocation;
use manifest_core::*;
use std::sync::Arc;

const START_YEAR: i64 = 1502;
const ALPHA: LocId = LocId(0);
const BETA: LocId = LocId(1);
const SPICE: GoodId = GoodId(2);
const TRADER: MateId = MateId(1);
const OLD_WRECK: DiscoveryId = DiscoveryId(0);
const EAST: RegionId = RegionId(1);
/// 带主角的剧本
const HERO: ScenarioId = ScenarioId(1);

fn choice(text: &str, effects: Vec<StoryEffect>) -> ChoiceDef {
    ChoiceDef {
        text: text.into(),
        reply: format!("{text}的回应"),
        cost: 0,
        give: None,
        check: None,
        effects,
        fail: Vec::new(),
        fail_reply: String::new(),
    }
}

fn chapter(key: &str, when: Vec<Cond>, choices: Vec<ChoiceDef>) -> ChapterDef {
    ChapterDef {
        key: key.into(),
        title: key.into(),
        text: format!("{key}的叙事"),
        hint: format!("{key}的提示"),
        speaker: Speaker::Captain,
        speaker_name: String::new(),
        when,
        choices,
    }
}

fn encounter(key: &str, place: Place, once: bool, choices: Vec<ChoiceDef>) -> EncounterDef {
    EncounterDef {
        key: key.into(),
        title: key.into(),
        text: format!("{key}的叙事"),
        speaker: Speaker::None,
        speaker_name: String::new(),
        place,
        when: Vec::new(),
        weight: 1,
        once,
        cooldown_days: 10,
        choices,
    }
}

/// 小型世界 + 三章的故事线、带主角的剧本与两种奇遇。`encounter_bp` 为每天遇到奇遇的概率（基点）。
fn story_defs(encounter_bp: i64) -> Arc<StaticData> {
    let mut d = (*captain_defs()).clone();
    // 没有海盗：不让海战打扰剧情
    d.rules.pirates.spawn_scale = Fx::ZERO;
    let mut hero = d.scenarios[0].clone();
    hero.key = "hero".into();
    hero.name = "hero".into();
    hero.recommended = true;
    hero.story = Some(0);
    hero.goal = Goal { kind: GoalKind::Story, deadline: None };
    hero.hero = Some(HeroDef {
        name: "罗塞拉".into(),
        look: 101,
        tagline: String::new(),
        bio: String::new(),
        month: 3,
        day: 3,
        age: 20,
        answers: vec!["hero_only".into(), "cadet".into(), "debt".into()],
        alloc: vec![1, 1, 1, 1, 1, 0],
        genius: None,
    });
    d.scenarios.push(hero);
    let mut only = d.captain.options[0].clone();
    only.key = "hero_only".into();
    only.hero = Some("hero".into());
    d.captain.options.push(only);
    let mut pricey = choice("太贵了", vec![StoryEffect::Fame(5)]);
    pricey.cost = 10_000_000;
    let mut gamble = choice("碰碰运气", vec![StoryEffect::Fame(3)]);
    gamble.check = Some(Check { attr: ARMS, base_pct: 50, per_pct: 0 });
    gamble.fail = vec![StoryEffect::Morale(-5)];
    gamble.fail_reply = "没成".into();
    d.stories = StoryDefs {
        rules: StoryRules { encounter_bp, gap_days: 5, first_day: 3 },
        stories: vec![StoryDef {
            key: "tale".into(),
            name: "tale".into(),
            chapters: vec![
                chapter(
                    "c1",
                    Vec::new(),
                    vec![choice("收下", vec![StoryEffect::Cash(500), StoryEffect::Flag("met".into())]), pricey],
                ),
                chapter(
                    "c2",
                    vec![Cond::Wait(3), Cond::Docked(vec![BETA])],
                    vec![choice("装货", vec![StoryEffect::Goods(SPICE, 10), StoryEffect::Morale(5)]), gamble],
                ),
                chapter(
                    "c3",
                    vec![Cond::Wait(1), Cond::Flag("met".into())],
                    vec![choice(
                        "全都要",
                        vec![
                            StoryEffect::Mate(TRADER),
                            StoryEffect::Reveal(OLD_WRECK),
                            StoryEffect::Attr(ARMS, 1),
                            StoryEffect::Chart(EAST),
                            StoryEffect::Crew(2),
                            StoryEffect::Supplies(3),
                            StoryEffect::Reputation(None, 3),
                            StoryEffect::Fame(10),
                        ],
                    )],
                ),
            ],
        }],
        encounters: vec![
            encounter("on_deck", Place::Sea, false, vec![choice("看看", vec![StoryEffect::Fame(1)])]),
            encounter("at_pier", Place::Port, true, vec![choice("收下", vec![StoryEffect::Cash(100)])]),
        ],
    };
    d.meta.hash = "testkit-story".into();
    Arc::new(d)
}

/// 记录命令并执行（与游戏会话相同），可只用日志重放。
struct Runner {
    defs: Arc<StaticData>,
    scenario: ScenarioId,
    world: World,
    log: Vec<LogEntry>,
}

impl Runner {
    fn new(defs: Arc<StaticData>, scenario: ScenarioId, seed: u64) -> Runner {
        let world = World::new(defs.clone(), scenario, seed).expect("开局");
        Runner { defs, scenario, world, log: Vec::new() }
    }

    fn submit(&mut self, c: Command) -> Result<CommandOutcome, CommandError> {
        let r = c.apply(&mut self.world);
        if r.is_ok() {
            let seq = self.log.len() as u64;
            self.log.push(LogEntry { minute: None, tick: self.world.day(), seq, source: Source::Player, command: c });
        }
        r
    }

    fn create(&mut self, answers: [&str; 3]) -> Result<CommandOutcome, CommandError> {
        self.submit(Command::CreateCaptain {
            owner: OwnerId::Player,
            birthday: Birthday { year: START_YEAR - 20, month: 3, day: 3 },
            answers: answers.iter().map(|s| s.to_string()).collect(),
            alloc: vec![1, 1, 1, 1, 1, 0],
            genius: None,
        })
    }

    fn answer(&mut self, choice: u32) -> Result<CommandOutcome, CommandError> {
        self.submit(Command::StoryAnswer { owner: OwnerId::Player, choice })
    }

    fn days(&mut self, n: u32) {
        for _ in 0..n {
            self.world.end_day().unwrap();
        }
    }

    fn fleet(&self) -> FleetId {
        self.world.flagship(OwnerId::Player).expect("玩家有旗舰")
    }

    fn replay_hash(&self) -> String {
        let start = StartParams::new(self.scenario, self.world.state.seed);
        replay(self.defs.clone(), start, &self.log, self.world.day()).unwrap().state_hash()
    }
}

fn cash(w: &World) -> Money {
    w.agent(OwnerId::Player).unwrap().cash
}

fn pending(w: &World) -> Option<StorySource> {
    w.state.story.pending.as_ref().map(|p| p.source.clone())
}

fn code(r: Result<CommandOutcome, CommandError>) -> String {
    match r.expect_err("应被拒绝") {
        CommandError::Rule(r) | CommandError::Range(r) => r.code.to_string(),
        other => format!("{other:?}"),
    }
}

/// 把舰队直接放到某港（只用于检查触发条件，免得为了条件来回航行）。
fn dock_at(w: &mut World, loc: LocId) {
    let fid = w.flagship(OwnerId::Player).unwrap();
    w.fleet_mut(fid).unwrap().location = FleetLocation::Docked(loc);
}

// ───────────────────────────── 没有主角档案 ─────────────────────────────

#[test]
fn without_a_captain_profile_nothing_happens_and_nothing_is_saved() {
    // 带主角的剧本，但没有立档（无界面模拟、平衡 bot、旧存档）：故事线与奇遇都不出现，状态不写进存档
    let mut r = Runner::new(story_defs(10_000), HERO, 5);
    r.days(60);
    assert!(r.world.state.story.is_pristine());
    let json = serde_json::to_string(&r.world.state).unwrap();
    assert!(!json.contains("\"story\""), "什么都没发生过时不写进存档");
    assert!(!r.world.story_enabled());
    assert_eq!(r.world.story_progress(), Some((0, 3)), "剧本挂着故事线，进度从 0 起");
    // 没有档案时回应被拒绝
    assert_eq!(code(r.answer(0)), "story.no_event");
    check_invariants(&r.world).unwrap();
}

// ───────────────────────────── 故事线 ─────────────────────────────

#[test]
fn chapters_follow_their_conditions_in_order_and_wait_for_an_answer() {
    // 奇遇关掉，只看故事线
    let mut r = Runner::new(story_defs(0), HERO, 7);
    r.create(["hero_only", "cadet", "debt"]).expect("推荐角色的身世在它自己的剧本里能立");
    // 第一章没有条件：第 0 天结算时出现
    r.days(1);
    assert_eq!(pending(&r.world), Some(StorySource::Chapter(0)));
    // 章节不会过期：十天不回应，还在等
    r.days(10);
    assert_eq!(pending(&r.world), Some(StorySource::Chapter(0)));
    // 付不起的选项被拒绝，状态不变
    let before = r.world.state_hash();
    let e = r.answer(1).expect_err("现金不够");
    assert!(matches!(e, CommandError::InsufficientCash { .. }), "{e:?}");
    assert_eq!(r.world.state_hash(), before);
    assert_eq!(code(r.answer(5)), "story.bad_choice");
    // 回应：现金 +500、设下故事标记，进入第二章
    let c0 = cash(&r.world);
    r.answer(0).unwrap();
    assert_eq!(cash(&r.world), c0 + 500);
    let s = &r.world.state.story;
    assert!(s.pending.is_none());
    assert_eq!(s.chapter, 1);
    assert!(s.flags.contains("met"));
    let last = s.last.clone().unwrap();
    assert_eq!((last.choice, last.outcomes.clone()), (Some(0), vec![StoryOutcome::Cash(500)]));
    assert_eq!(s.journal.len(), 1);
    assert!(r.world.state.log.iter().any(|e| matches!(
        &e.kind,
        LogKind::StoryResolved { source: StorySource::Chapter(0), choice: Some(0), owner: OwnerId::Player, .. }
    )));
    assert_eq!(code(r.answer(0)), "story.no_event", "回应过的事件不能再回应一次");
    // 第二章要等三天、并且有舰队停在 beta：一直停在 alpha 就不出现
    r.days(10);
    assert!(r.world.state.story.pending.is_none());
    dock_at(&mut r.world, BETA);
    r.days(1);
    assert_eq!(pending(&r.world), Some(StorySource::Chapter(1)));
    let fid = r.fleet();
    let morale = r.world.fleet(fid).unwrap().morale;
    r.answer(0).unwrap();
    let f = r.world.fleet(fid).unwrap();
    assert_eq!(f.cargo.get(&SPICE).copied(), Some(10));
    assert_eq!(f.morale, (morale + 5).min(100));
    // 第三章：故事标记已经设下，第二天就出现
    r.days(1);
    assert!(r.world.state.story.pending.is_none(), "距上一章至少一天");
    r.days(1);
    assert_eq!(pending(&r.world), Some(StorySource::Chapter(2)));
    let arms = r.world.captain_attr(OwnerId::Player, ARMS);
    let fame = r.world.agent(OwnerId::Player).unwrap().fame;
    let crew = r.world.fleet(fid).unwrap().crew;
    r.answer(0).unwrap();
    let w = &r.world;
    let trader = &w.state.mates[&TRADER];
    assert_eq!((trader.owner, trader.role), (Some(OwnerId::Player), MateRole::None), "航海士不收招募费地加入");
    assert_eq!(w.captain_attr(OwnerId::Player, ARMS), arms + 1);
    assert_eq!(w.agent(OwnerId::Player).unwrap().fame, fame + 10);
    assert!(w.state.explore.charts.contains(&EAST));
    let cell = w.defs.discovery(OLD_WRECK).cell;
    assert!(w.state.explore.is_revealed(cell.y as usize * w.defs.map.width as usize + cell.x as usize));
    assert!(w.fleet(fid).unwrap().crew > crew);
    assert!(w.story_complete());
    assert_eq!(w.goal_progress(), Some((3, 3)));
    check_invariants(w).unwrap();
    assert!(w.money_conserved());
    // 故事走完：当天结算时判定胜利，此后不再有章节
    r.days(1);
    let o = r.world.state.outcome.expect("走完故事线即胜利");
    assert_eq!((o.kind, o.reason), (OutcomeKind::Won, OutcomeReason::GoalReached));
    r.days(20);
    assert!(r.world.state.story.pending.is_none());
}

#[test]
fn checks_draw_from_their_own_domain_and_are_deterministic() {
    let run = |seed: u64| {
        let mut r = Runner::new(story_defs(0), HERO, seed);
        r.create(["hero_only", "cadet", "debt"]).unwrap();
        r.days(1);
        r.answer(0).unwrap();
        dock_at(&mut r.world, BETA);
        r.days(4);
        assert_eq!(pending(&r.world), Some(StorySource::Chapter(1)));
        r.answer(1).unwrap();
        let last = r.world.state.story.last.clone().unwrap();
        (last.success, r.world.state_hash())
    };
    // 同一个种子：同样的检定结果、同样的世界
    assert_eq!(run(11), run(11));
    // 成功率 50%：换一批种子，成败都出现过
    let results: Vec<Option<bool>> = (1..=24).map(|s| run(s).0).collect();
    assert!(results.contains(&Some(true)) && results.contains(&Some(false)), "{results:?}");
}

#[test]
fn the_story_goal_counts_chapters() {
    let mut r = Runner::new(story_defs(0), HERO, 3);
    assert_eq!(r.world.goal_progress(), Some((0, 3)));
    r.create(["hero_only", "cadet", "debt"]).unwrap();
    r.days(1);
    r.answer(0).unwrap();
    assert_eq!(r.world.goal_progress(), Some((1, 3)));
    assert!(!r.world.story_complete());
    r.days(30);
    assert!(r.world.state.outcome.is_none(), "故事没走完，没有限期，也不会失败");
}

// ───────────────────────────── 奇遇 ─────────────────────────────

#[test]
fn encounters_need_a_captain_and_lapse_without_an_answer() {
    // 普通剧本（没有故事线），每天必定遇到奇遇（满足间隔时）；舰队停在 alpha，只会遇到港口的那一种
    let mut r = Runner::new(story_defs(10_000), ScenarioId(0), 9);
    r.create(["plain", "cadet", "debt"]).unwrap();
    r.days(3);
    assert!(r.world.state.story.pending.is_none(), "开局 3 天之内不遇到");
    r.days(1);
    let p = r.world.state.story.pending.clone().expect("第 3 天起遇到");
    assert_eq!(p.source, StorySource::Encounter("at_pier".into()));
    assert_eq!(p.day, 3);
    // 当天没有回应：第二天结算时作罢，不产生任何效果（奇遇的现金没有到账）
    r.days(1);
    let s = &r.world.state.story;
    assert!(s.pending.is_none());
    let last = s.last.clone().unwrap();
    assert_eq!((last.choice, last.outcomes.len()), (None, 0));
    assert!(s.journal.is_empty(), "没有回应的奇遇不记进故事面板");
    assert!(r.world.state.log.iter().any(|e| matches!(&e.kind, LogKind::StoryResolved { choice: None, .. })));
    // 港口的那一种只遇到一次；舰队一直在港，此后再也遇不到奇遇
    r.days(40);
    assert!(r.world.state.story.pending.is_none());
    assert_eq!(r.world.state.story.seen.len(), 1);
    check_invariants(&r.world).unwrap();
}

#[test]
fn an_answered_encounter_applies_its_effects_and_respects_the_gap() {
    let mut r = Runner::new(story_defs(10_000), ScenarioId(0), 13);
    r.create(["plain", "cadet", "debt"]).unwrap();
    r.days(4);
    assert!(matches!(pending(&r.world), Some(StorySource::Encounter(ref k)) if k == "at_pier"));
    let c = cash(&r.world);
    r.answer(0).unwrap();
    assert_eq!(cash(&r.world), c + 100);
    // 在 alpha 与 beta 之间来回航行：间隔（5 天）之后，在海上遇到海上的那一种
    let fid = r.fleet();
    let mut met = None;
    for _ in 0..60 {
        if let Some(at) = r.world.fleet(fid).unwrap().docked_at() {
            let dest = if at == BETA { ALPHA } else { BETA };
            r.submit(Command::Resupply { owner: OwnerId::Player, fleet: fid, food: 30, water: 30 }).ok();
            r.submit(Command::SetSail { owner: OwnerId::Player, fleet: fid, dest }).unwrap();
        }
        r.days(1);
        if let Some(p) = r.world.state.story.pending.clone() {
            met = Some(p);
            break;
        }
    }
    let p = met.expect("出海之后遇到海上的奇遇");
    assert_eq!(p.source, StorySource::Encounter("on_deck".into()));
    assert!(p.day >= 3 + 5, "两次奇遇至少间隔 5 天（上一次在第 3 天）");
    assert_eq!(r.replay_hash(), r.world.state_hash());
}

// ───────────────────────────── 推荐角色 ─────────────────────────────

#[test]
fn hero_options_only_work_in_their_own_scenario() {
    let mut r = Runner::new(story_defs(0), ScenarioId(0), 1);
    assert_eq!(code(r.create(["hero_only", "cadet", "debt"])), "captain.answers");
    let mut r = Runner::new(story_defs(0), HERO, 1);
    r.create(["hero_only", "cadet", "debt"]).unwrap();
    let h = r.world.defs.scenarios[HERO.idx()].hero.clone().unwrap();
    assert_eq!((h.look, h.name.as_str()), (101, "罗塞拉"));
}

#[test]
fn story_state_survives_a_save_round_trip() {
    let mut r = Runner::new(story_defs(0), HERO, 21);
    r.create(["hero_only", "cadet", "debt"]).unwrap();
    r.days(1);
    r.answer(0).unwrap();
    dock_at(&mut r.world, BETA);
    r.days(4);
    assert!(r.world.state.story.pending.is_some());
    let start = StartParams::new(HERO, 21);
    let text = SaveFile::new(&r.defs, start, r.world.state.clone(), r.log.clone()).to_json().unwrap();
    let back = SaveFile::from_json(&text).unwrap();
    let w = World::from_snapshot(r.defs.clone(), back.snapshot).unwrap();
    assert_eq!(w.state.story, r.world.state.story);
    assert_eq!(w.state_hash(), r.world.state_hash());
}
