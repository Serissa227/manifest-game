#![allow(dead_code)]
//! U03：养成整局跑法的共用部分（二十一家整局测试与远足、羁绊、分层的定向测试共用）。
//!
//! 旧月/周程由本文件自己排：课业格轮换最便宜的课，课后格疲劳高就休息，否则轮换当地活动；
//! 行动制用内核缺省策略，并优先回应地点标记。每月中旬约一位同伴（澪固定约冷泉雪，见 A4）。钱不够时直接补足现款，
//! 因为本卡不管钱（零用钱、自习课由工作包 1 做），这里只检查剧情调度。
//! 待回应的章节一律选第一个能选的选项（走改投路线的跑法另选设那条路线旗标的选项）；没有能选的就记为“软锁”，这一局就此停下。
use manifest_core::{
    Command, CoreError, OwnerId, ScenarioId, StaticData, World,
    cast::relations::Bond,
    replay::StartParams,
    scenario::{CustomCaptain, NewGameRequest, WorldDate},
    upbringing::{
        ActivityKind, AfterChoice, FamilyDef, Need, Phase, PlanSlot, Stage,
        act::{ActAction, ActPhase, LessonPlan},
    },
};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, OnceLock};

pub fn defs() -> Arc<StaticData> {
    static DEFS: OnceLock<Arc<StaticData>> = OnceLock::new();
    DEFS.get_or_init(|| manifest_data::load_world(&manifest_data::find_data_dir().unwrap(), "terra16").unwrap()).clone()
}

pub fn start(d: Arc<StaticData>, f: &FamilyDef) -> World {
    let sid = ScenarioId::from_idx(d.scenarios.iter().position(|s| s.key == f.scenario).unwrap());
    let mut p = StartParams::new(sid, 42);
    p.opening = Some(NewGameRequest {
        world: "terra16".into(),
        scenario: f.scenario.clone(),
        protagonist: f.protagonists.first().cloned(),
        template: f.templates.first().cloned(),
        captain: (!f.templates.is_empty()).then(|| CustomCaptain {
            name: "U03".into(),
            look: 0,
            gender: f.gender,
            birthday: [f.born[1], f.born[2]],
        }),
        ..Default::default()
    });
    World::from_start(d, &p, |_| {}).unwrap()
}

/// 一次出现在玩家面前（待回应、排在最前）的章节。
#[derive(Clone, Debug)]
pub struct Seen {
    pub day: u32,
    pub track: String,
    pub chapter: String,
}

#[derive(Debug, Default)]
pub struct Report {
    pub family: String,
    pub seen: Vec<Seen>,
    /// 待回应却没有一个能选的选项：日期、轨道、章节。
    pub locked: Vec<(WorldDate, String, String)>,
    pub errors: Vec<String>,
    pub graduated: bool,
    pub end: WorldDate,
    pub abandoned: usize,
    pub bonds: BTreeMap<String, (i64, i64, u32, Option<Bond>)>,
    pub outings_done: u32,
}

/// 同行对象：第一个固定（澪约冷泉雪），其余按月轮换。
fn outing_target(w: &World, family: &str, month: u32) -> Option<String> {
    let present: Vec<String> = w
        .upbringing_companions()
        .into_iter()
        .filter(|(k, r)| {
            !matches!(
                r,
                manifest_core::upbringing::CompanionRole::Mentor | manifest_core::upbringing::CompanionRole::Family
            ) && w.defs.cast.person(k).is_some()
        })
        .map(|(k, _)| k)
        .collect();
    if family == "mio" && present.iter().any(|k| k == "reizei_yuki") {
        return Some("reizei_yuki".into());
    }
    (!present.is_empty()).then(|| present[month as usize % present.len()].clone())
}

fn companion_choice(w: &World, date: WorldDate, person: &str) -> Option<AfterChoice> {
    let s = w.state.upbringing.as_ref()?;
    // U06a：入学等周中换阶段会重排本周，不能再次约刚完成同行的同一周。
    if w.upbringing_cadence_enabled()
        && w.upbringing_cadence_rules().is_some_and(|r| {
            s.cadence.last_outing_week.is_some_and(|last| {
                manifest_core::upbringing::week_index(&w.defs, w.day()).saturating_sub(last) < r.outing_every_weeks
            })
        })
    {
        return None;
    }
    let d = &w.defs.upbringing;
    for a in d.activities.iter().filter(|a| a.needs.contains(&Need::Companion) && !a.needs.contains(&Need::Book)) {
        for p in w.upbringing_places() {
            if !w.upbringing_place_open(p) || !w.upbringing_companion_present(person, Some(&p.key), date) {
                continue;
            }
            let c = AfterChoice {
                activity: a.key.clone(),
                place: a.needs.contains(&Need::Place).then(|| p.key.clone()),
                companion: Some(person.into()),
                book: None,
                excursion: None,
                node: None,
            };
            if w.check_upbringing_choice(a, Some(&c), date).is_ok() {
                return Some(c);
            }
        }
    }
    None
}

fn plain_choice(w: &World, date: WorldDate, stage: Stage, used: &BTreeMap<String, u32>) -> Option<AfterChoice> {
    let s = w.state.upbringing.as_ref()?;
    let d = &w.defs.upbringing;
    let rest = |a: &&manifest_core::upbringing::ActivityDef| a.kind == ActivityKind::Rest;
    let mut best: Option<(u32, String, AfterChoice)> = None;
    for a in d.activities.iter().filter(|a| {
        (stage == Stage::Home || a.kind != ActivityKind::Lesson)
            && !a.needs.iter().any(|n| matches!(n, Need::Book | Need::Companion | Need::Excursion))
            && (s.fatigue >= 60) == rest(a)
    }) {
        let place = if a.needs.contains(&Need::Place) {
            Some(w.upbringing_places().iter().find(|p| w.upbringing_place_open(p))?.key.clone())
        } else {
            None
        };
        let c = AfterChoice { place, ..AfterChoice::activity(&a.key) };
        if w.check_upbringing_choice(a, Some(&c), date).is_err() {
            continue;
        }
        let n = used.get(&a.key).copied().unwrap_or(0) + s.activity_counts.get(&a.key).copied().unwrap_or(0);
        if best.as_ref().is_none_or(|(m, k, _)| (n, &a.key) < (*m, k)) {
            best = Some((n, a.key.clone(), c));
        }
    }
    best.map(|b| b.2).or_else(|| {
        let a = d.activities.iter().find(|a| a.kind == ActivityKind::Rest)?;
        let c = AfterChoice::activity(&a.key);
        w.check_upbringing_choice(a, Some(&c), date).ok().map(|_| c)
    })
}

fn plan_month(w: &World, family: &str, months: u32) -> Option<Vec<PlanSlot>> {
    let s = w.state.upbringing.as_ref()?;
    let mut used = BTreeMap::new();
    let mut outings = u32::from(s.outings);
    let mut slots = Vec::new();
    for index in 0..3u8 {
        if index < s.next_slot {
            slots.push(s.plan.get(usize::from(index)).cloned().unwrap_or(PlanSlot {
                index,
                lesson: None,
                after: None,
            }));
            continue;
        }
        let date = [s.month[0], s.month[1], 1 + u32::from(index) * 10].max(w.cast_date());
        let stage = w.upbringing_stage_on(date).or_else(|| w.upbringing_stage_on(w.cast_date()))?.stage;
        let lesson = if stage == Stage::Academy {
            let a = w
                .defs
                .upbringing
                .activities
                .iter()
                .filter(|a| a.kind == ActivityKind::Lesson && w.check_upbringing_choice(a, None, date).is_ok())
                .min_by_key(|a| (s.activity_counts.get(&a.key).copied().unwrap_or(0), a.cost, a.key.clone()))?;
            *used.entry(a.key.clone()).or_insert(0) += 1;
            Some(a.key.clone())
        } else {
            None
        };
        // 每月中旬约一次同行。
        let after = (index == 1 && outings < 2)
            .then(|| outing_target(w, family, months).and_then(|p| companion_choice(w, date, &p)))
            .flatten()
            .or_else(|| plain_choice(w, date, stage, &used))?;
        if after.companion.is_some() {
            outings += 1;
        }
        *used.entry(after.activity.clone()).or_insert(0) += 1;
        slots.push(PlanSlot { index, lesson, after: Some(after) });
    }
    Some(slots)
}

/// U05 按周：本周各格按同样的规则挑（课业格轮换最便宜的课，课余 / 自由格疲劳高就休息、否则轮换）；
/// 每月第 2 周的第一个课余格约一次同行（相当于按旬时的“中旬”）。落在换阶段之后的格留空。
fn plan_week(w: &World, family: &str, months: u32) -> Option<Vec<PlanSlot>> {
    let s = w.state.upbringing.as_ref()?;
    let today = w.cast_date();
    let now = w.upbringing_stage_on(today)?;
    let stage = now.stage;
    let week = manifest_core::upbringing::weekly::week_of(today[2]);
    let mut used = BTreeMap::new();
    let mut outings = u32::from(s.outings);
    let mut first_after = true;
    let mut slots = Vec::new();
    for (def, date) in w.upbringing_week_slots() {
        let index = def.index;
        let empty = PlanSlot { index, lesson: None, after: None };
        if index < s.next_slot {
            slots.push(s.plan.get(usize::from(index)).cloned().unwrap_or(empty));
            continue;
        }
        if w.upbringing_stage_on(date).is_none_or(|st| st.from != now.from) {
            slots.push(empty);
            continue;
        }
        if def.lesson {
            let a = w
                .defs
                .upbringing
                .activities
                .iter()
                .filter(|a| a.kind == ActivityKind::Lesson && w.check_upbringing_choice(a, None, date).is_ok())
                .min_by_key(|a| {
                    (
                        s.activity_counts.get(&a.key).copied().unwrap_or(0) + used.get(&a.key).copied().unwrap_or(0),
                        a.cost,
                        a.key.clone(),
                    )
                })?;
            *used.entry(a.key.clone()).or_insert(0) += 1;
            slots.push(PlanSlot { index, lesson: Some(a.key.clone()), after: None });
            continue;
        }
        let outing = week == 1 && first_after && outings < 2;
        first_after = false;
        let after = outing
            .then(|| outing_target(w, family, months).and_then(|p| companion_choice(w, date, &p)))
            .flatten()
            .or_else(|| plain_choice(w, date, stage, &used))?;
        if after.companion.is_some() {
            outings += 1;
        }
        *used.entry(after.activity.clone()).or_insert(0) += 1;
        slots.push(PlanSlot { index, lesson: None, after: Some(after) });
    }
    Some(slots)
}

pub fn answer(w: &mut World, report: &mut Report, route: Option<&str>) -> bool {
    let Some(p) = w.pending_story2().cloned() else { return false };
    let date = w.cast_date();
    if report.seen.last().is_none_or(|s| s.track != p.track || s.chapter != p.chapter || s.day != w.day()) {
        report.seen.push(Seen { day: w.day(), track: p.track.clone(), chapter: p.chapter.clone() });
    }
    let t = w.defs.story2.track(&p.track).unwrap().clone();
    let c = t.chapter(&p.chapter).unwrap().clone();
    let entered = w.state.story2.tracks.get(&p.track).map_or(w.day(), |s| s.entered);
    let sets_route = |o: &manifest_core::story2::Choice| {
        route.is_some_and(|flag| {
            o.effects
                .iter()
                .any(|e| matches!(e, manifest_core::story2::Effect::Flag { flag: f, value: true } if f == flag))
        })
    };
    let choice = if c.choices.is_empty() {
        Some(0)
    } else {
        let visible: Vec<_> = c.choices.iter().filter(|o| w.story2_choice_visible(o, entered)).collect();
        let open = |o: &&manifest_core::story2::Choice| w.story2_conditions(&o.requires, entered);
        visible
            .iter()
            .position(|o| open(o) && sets_route(o))
            .or_else(|| visible.iter().position(open))
            .map(|i| i as u32)
    };
    let Some(choice) = choice else {
        report.locked.push((date, p.track.clone(), p.chapter.clone()));
        return false;
    };
    if let Err(e) = (Command::StoryAnswer { owner: OwnerId::Player, choice }).apply(w) {
        report.errors.push(format!("{date:?} {}:{} 回答失败：{e}", p.track, p.chapter));
        return false;
    }
    true
}

pub fn run(family: &str) -> Report {
    run_until(family, None).1
}

/// 从开局跑到 `until`（不含）或结业，返回世界与记录。
pub fn run_until(family: &str, until: Option<WorldDate>) -> (World, Report) {
    run_with(family, until, None)
}

/// 走改投路线跑到结业：遇到设 `route` 旗标的选项就选它（11-04 改投学院）。
pub fn run_route(family: &str, route: &str) -> (World, Report) {
    run_with(family, None, Some(route))
}

fn run_with(family: &str, until: Option<WorldDate>, route: Option<&str>) -> (World, Report) {
    let d = defs();
    let f = d.upbringing.family(family).unwrap_or_else(|| panic!("没有家庭 {family}")).clone();
    let mut w = start(d.clone(), &f);
    let mut report = Report { family: family.into(), ..Default::default() };
    let mut months = 0;
    let mut last_month: Option<[u32; 2]> = None;
    let mut planned_week: Option<[u32; 3]> = None;
    let graduation = f.graduation;
    for _ in 0..40_000 {
        if !w.upbringing_active() || w.cast_date() > graduation || until.is_some_and(|u| w.cast_date() >= u) {
            break;
        }
        if w.pending_story2().is_some() && w.story2_is_front() {
            if answer(&mut w, &mut report, route) {
                continue;
            }
            break;
        }
        if w.state.story.pending.is_some() {
            if let Err(e) = (Command::StoryAnswer { owner: OwnerId::Player, choice: 0 }).apply(&mut w) {
                report.errors.push(format!("{:?} 旧故事回答失败：{e}", w.cast_date()));
                break;
            }
            continue;
        }
        let today = w.cast_date();
        let week = [today[0], today[1], u32::from(manifest_core::upbringing::weekly::week_of(today[2]))];
        if w.act_running() {
            if w.act_phase() == ActPhase::Plan && planned_week != Some(week) {
                if let Some(a) = w.state.agents.get_mut(&OwnerId::Player)
                    && a.cash < 80
                {
                    a.cash = 200;
                }
                if last_month != Some([today[0], today[1]]) {
                    last_month = Some([today[0], today[1]]);
                    months += 1;
                }
                let mut slots = w.act_lesson_plan().to_vec();
                for slot in &mut slots {
                    slot.with = None;
                }
                if w.act_lessons_problem(&slots).is_ok() {
                    // 同样每月第二周约一次同行；课格要选在同伴实际出现的地点。
                    if week[2] == 1
                        && let Some(person) = outing_target(&w, family, months)
                    {
                        'pair: for line in w.defs.upbringing.lines.iter().filter(|line| {
                            w.act_line_here(line) && w.act_presence(&person) == Some(line.place.as_str())
                        }) {
                            for index in 0..slots.len() {
                                let mut paired = slots.clone();
                                paired[index] =
                                    LessonPlan { line: line.key.clone(), tier: 0, with: Some(person.clone()) };
                                if w.act_lessons_problem(&paired).is_ok() {
                                    slots = paired;
                                    break 'pair;
                                }
                            }
                        }
                    }
                    if slots != w.act_lesson_plan() {
                        let paired = slots.iter().any(|slot| slot.with.is_some());
                        if let Err(e) = (Command::PlanLessons { owner: OwnerId::Player, slots }).apply(&mut w) {
                            report.errors.push(format!("{today:?} 行动制排课被拒：{e}"));
                            break;
                        }
                        report.outings_done += u32::from(paired);
                    }
                    planned_week = Some(week);
                }
            }
            // 人物事件在行动制里挂成地点标记，仍走真实行动和故事命令回应。
            let marker = (w.act_phase() == ActPhase::Free)
                .then(|| {
                    w.state.upbringing.as_ref().and_then(|s| {
                        s.act.markers.iter().filter(|(_, m)| m.hanging(s.act.week)).find_map(|(track, m)| {
                            let command = Command::DoAction {
                                owner: OwnerId::Player,
                                place: m.place.clone(),
                                action: ActAction::Marker { track: track.clone() },
                            };
                            command.validate(&w).is_ok().then_some(command)
                        })
                    })
                })
                .flatten();
            if let Some(command) = marker {
                if let Err(e) = command.apply(&mut w) {
                    report.errors.push(format!("{today:?} 地点标记被拒：{e}"));
                    break;
                }
                continue;
            }
            if family == "mio"
                && w.act_phase() == ActPhase::Free
                && let Some(place) = w.act_presence("reizei_yuki")
            {
                let command = Command::DoAction {
                    owner: OwnerId::Player,
                    place: place.to_owned(),
                    action: ActAction::Talk { person: "reizei_yuki".into() },
                };
                if command.validate(&w).is_ok() {
                    command.apply(&mut w).unwrap();
                    continue;
                }
            }
            match w.act_bot_step() {
                Ok(true) => continue,
                Ok(false) => {}
                Err(e) => {
                    report.errors.push(format!("{today:?} 行动制推进失败：{e}"));
                    break;
                }
            }
        }
        let planning = w.state.upbringing.as_ref().is_some_and(|s| s.phase == Phase::Plan);
        // U05 按周：常设课表每周一自动铺开；与按旬时“每月排一次”对齐，每换一周重排一次。
        let weekly_due = w.upbringing_weekly()
            && w.state.upbringing.as_ref().is_some_and(|s| s.phase == Phase::Running)
            && planned_week != Some(week);
        if !w.act_running() && (planning || weekly_due) {
            planned_week = Some(week);
            // 本卡不管钱：钱少就补足，免得学费把调度测试卡住（零用钱由工作包 1 做）。
            if let Some(a) = w.state.agents.get_mut(&OwnerId::Player)
                && a.cash < 80
            {
                a.cash = 200;
            }
            if last_month != Some([today[0], today[1]]) {
                last_month = Some([today[0], today[1]]);
                months += 1;
            }
            let planned =
                if w.upbringing_weekly() { plan_week(&w, family, months) } else { plan_month(&w, family, months) };
            let Some(slots) = planned else {
                report.errors.push(format!("{:?} 排不出月程", w.cast_date()));
                break;
            };
            report.outings_done +=
                slots.iter().filter(|s| s.after.as_ref().is_some_and(|a| a.companion.is_some())).count() as u32;
            if let Err(e) = w.upbringing_plan_command(slots).apply(&mut w) {
                report.errors.push(format!("{:?} 月程被拒：{e}", w.cast_date()));
                break;
            }
            continue;
        }
        match w.end_day() {
            Ok(_) => {}
            Err(CoreError::UpbringingPaused) => {
                report.errors.push(format!("{:?} 时钟停住，但没有可回应的章节或可排的月程", w.cast_date()));
                break;
            }
            Err(e) => {
                report.errors.push(format!("{:?} 日结失败：{e}", w.cast_date()));
                break;
            }
        }
    }
    report.graduated = !w.upbringing_active();
    report.end = w.cast_date();
    report.abandoned = w
        .state
        .log
        .iter()
        .filter(|e| {
            serde_json::to_value(&e.kind).ok().and_then(|v| v.as_object().map(|o| o.contains_key("Story2Abandoned")))
                == Some(true)
        })
        .count();
    for (k, p) in &w.state.cast.persons {
        if d.cast.person(k).is_some_and(|p| p.bond_track.is_some()) && p.met {
            report.bonds.insert(
                k.clone(),
                (p.affection.affinity, p.affection.heart, p.affection.experiences, p.affection.bond),
            );
        }
    }
    (w, report)
}

// ───────────────────────── 指标 ─────────────────────────

pub fn day_of(d: &StaticData, date: WorldDate) -> u32 {
    manifest_core::scenario::day_of(d, date).unwrap()
}

/// 某一类写好的短事件（家人羁绊、家庭节庆、生日）的覆盖：门槛日期到了的里头，实际出现了几条。
pub fn coverage(r: &Report, part: &str) -> (usize, usize) {
    let d = defs();
    let prefix = format!("c9_{}_{part}_", r.family);
    let seen: BTreeSet<&str> = r.seen.iter().map(|s| s.track.as_str()).collect();
    // 门槛日期至少早于结束前 30 天的才计入（最后一个月刚到的来不及出现，审计报告同样只计已到期的）。
    let last = day_of(&d, r.end).saturating_sub(30);
    let due: Vec<&String> = d
        .upbringing
        .event_gates
        .iter()
        .filter(|(k, g)| k.starts_with(&prefix) && g.from.is_none_or(|f| day_of(&d, f) <= last))
        .map(|(k, _)| k)
        .collect();
    (due.iter().filter(|k| seen.contains(k.as_str())).count(), due.len())
}

/// 新闻从门槛日期到出现的天数（只计出现了的）。
pub fn news_delays(r: &Report) -> Vec<u32> {
    let d = defs();
    let prefix = format!("c9_{}_news_", r.family);
    let mut first = BTreeMap::new();
    for s in &r.seen {
        if s.track.starts_with(&prefix) {
            first.entry(s.track.clone()).or_insert(s.day);
        }
    }
    let mut out: Vec<u32> = first
        .iter()
        .filter_map(|(k, day)| {
            let from = d.upbringing.event_gates.get(k)?.from?;
            Some(day.saturating_sub(day_of(&d, from)))
        })
        .collect();
    out.sort_unstable();
    out
}

pub fn median(v: &[u32]) -> Option<u32> {
    (!v.is_empty()).then(|| v[v.len() / 2])
}

/// 日常池占全部出现章节的比例（万分点）。
pub fn daily_share_bp(r: &Report) -> u32 {
    let daily = r.seen.iter().filter(|s| s.track.contains("_daily_")).count();
    (daily * 10_000 / r.seen.len().max(1)) as u32
}

pub fn summary(r: &Report) -> String {
    let (fb, fbn) = coverage(r, "family_bond");
    let (fe, fen) = coverage(r, "festival");
    let (bi, bin) = coverage(r, "birthday");
    let delays = news_delays(r);
    format!(
        "{}：结业={} 到 {:?}；出现 {} 章；软锁 {:?}；作罢 {}；错误 {:?}；家人羁绊 {fb}/{fbn}，节庆 {fe}/{fen}，生日 {bi}/{bin}；新闻 {} 条，中位延迟 {:?} 天；日常池 {}‰；同行 {} 次",
        r.family,
        r.graduated,
        r.end,
        r.seen.len(),
        r.locked,
        r.abandoned,
        r.errors,
        delays.len(),
        median(&delays),
        daily_share_bp(r) / 10,
        r.outings_done,
    )
}
