//! 从世界已登记定义展开身份矩阵；普通命令与资源作弊使用独立世界和报告。
use super::BotError;
use manifest_core::{
    replay::{LogEntry, Source, StartParams},
    scenario::{CustomCaptain, Gender, NewGameRequest},
    story2::Status,
    upbringing::{ActivityKind, AfterChoice, Phase, PlanSlot, Stage},
    *,
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

#[derive(Clone, Debug, Serialize)]
pub struct Case {
    pub key: String,
    pub gender: Gender,
    pub template: bool,
    pub batch: usize,
    pub request: NewGameRequest,
}

/// 批次单位是身份；模板的男女两次运行留在同一批。
pub fn cases(defs: &StaticData) -> Vec<Case> {
    let mut result = Vec::new();
    let mut seen = BTreeSet::new();
    let mut named = 0;
    let mut custom = 0;
    for scenario in &defs.scenarios {
        for p in &scenario.protagonist_defs {
            if !seen.insert(p.key.clone()) {
                continue;
            }
            result.push(Case {
                key: p.key.clone(),
                gender: p.gender,
                template: false,
                batch: named / 2,
                request: NewGameRequest {
                    world: defs.world_key.clone(),
                    scenario: scenario.key.clone(),
                    protagonist: Some(p.key.clone()),
                    seed: Some(42),
                    ..Default::default()
                },
            });
            named += 1;
        }
    }
    let offset = named.div_ceil(2);
    for scenario in &defs.scenarios {
        for t in &scenario.template_defs {
            if !seen.insert(t.key.clone()) {
                continue;
            }
            for gender in [Gender::F, Gender::M] {
                result.push(Case {
                    key: t.key.clone(),
                    gender,
                    template: true,
                    batch: offset + custom / 4,
                    request: NewGameRequest {
                        world: defs.world_key.clone(),
                        scenario: scenario.key.clone(),
                        template: Some(t.key.clone()),
                        seed: Some(42),
                        captain: Some(CustomCaptain {
                            name: "审计船长".into(),
                            look: 0,
                            gender,
                            birthday: [t.born[1], t.born[2]],
                        }),
                        ..Default::default()
                    },
                });
            }
            custom += 1;
        }
    }
    result
}

pub fn start(defs: &StaticData, case: &Case) -> Result<StartParams, BotError> {
    let sid = defs
        .scenarios
        .iter()
        .position(|s| s.key == case.request.scenario)
        .ok_or_else(|| super::blocked("矩阵身份的剧本不存在"))?;
    let scenario = &defs.scenarios[sid];
    let bootstrap_days =
        scenario::day_of(defs, scenario.control_date)?.saturating_sub(scenario::day_of(defs, scenario.start_date)?);
    Ok(StartParams {
        scenario: ScenarioId::from_idx(sid),
        seed: case.request.seed.unwrap_or(42),
        opening: Some(case.request.clone()),
        bootstrap_days,
    })
}

#[derive(Clone, Debug, Serialize)]
pub struct OrdinaryReport {
    pub mode: &'static str,
    pub from: u32,
    pub until: u32,
    pub budget_days: u32,
    pub graduated: bool,
    /// 世界中的完成状态包含后台默认分支；实际应答证据另列。
    pub done: BTreeSet<String>,
    pub answered_chapters: BTreeMap<String, BTreeSet<String>>,
    pub completed_by_answer: BTreeSet<String>,
    pub failed: BTreeSet<String>,
    pub blocked: Option<String>,
    pub commands: Vec<LogEntry>,
}

fn submit(w: &mut World, report: &mut OrdinaryReport, command: Command) -> Result<(), BotError> {
    let tick = w.day();
    let answered = (matches!(&command, Command::StoryAnswer { .. }) && w.story2_is_front())
        .then(|| w.pending_story2().map(|p| (p.track.clone(), p.chapter.clone())))
        .flatten();
    command.apply(w)?;
    if let Some((track, chapter)) = answered {
        report.answered_chapters.entry(track.clone()).or_default().insert(chapter);
        if w.state.story2.tracks.get(&track).is_some_and(|s| s.status == Status::Done) {
            report.completed_by_answer.insert(track);
        }
    }
    report.commands.push(LogEntry {
        tick,
        seq: report.commands.len() as u64,
        source: Source::Player,
        command,
        minute: None,
    });
    Ok(())
}

fn cash(w: &World) -> i64 {
    w.state.agents.get(&OwnerId::Player).map_or(0, |a| a.cash)
}

/// 以本家庭实际课程费用留出两个月学费；只影响机器人选项，不修改世界资源。
fn school_reserve(w: &World) -> i64 {
    if !w.upbringing_active() {
        return 0;
    }
    w.upbringing_family()
        .into_iter()
        .flat_map(|f| &f.stages)
        .filter_map(|s| s.academy.as_deref())
        .filter_map(|key| w.defs.upbringing.academy(key))
        .flat_map(|a| &a.curriculum)
        .map(|a| w.upbringing_activity_cost(a))
        .max()
        .unwrap_or(0)
        .saturating_mul(6)
}

fn answer(w: &World, count: usize) -> Option<Command> {
    let reserve = school_reserve(w);
    let mut fallback = None;
    for choice in 0..count {
        let command = Command::StoryAnswer { owner: OwnerId::Player, choice: choice as u32 };
        let mut trial = w.clone();
        if command.apply(&mut trial).is_err() {
            continue;
        }
        let remaining = cash(&trial);
        if remaining >= reserve {
            return Some(command);
        }
        if fallback.as_ref().is_none_or(|(best, _)| remaining > *best) {
            fallback = Some((remaining, command));
        }
    }
    fallback.map(|(_, command)| command)
}

fn conservative_income(w: &World, activity: &manifest_core::upbringing::ActivityDef) -> i64 {
    let pct = if w.upbringing_risk(activity) > 0 { activity.failure.income_pct.min(100) } else { 100 };
    activity.income.bounds()[0] * pct / 100
}

fn month(w: &World) -> Result<Vec<PlanSlot>, BotError> {
    let state = w.state.upbringing.as_ref().ok_or_else(|| super::blocked("缺少养成状态"))?;
    let reserve = school_reserve(w);
    let mut planned_cash = cash(w);
    let mut planned_fatigue = state.fatigue;
    let mut used = BTreeMap::<String, u32>::new();
    for journal in &state.journal {
        let date = w.defs.calendar.date_of(journal.day);
        if w.defs.rules.world.start_year + i64::from(date.year) - 1 != i64::from(state.month[0])
            || date.month != state.month[1]
        {
            continue;
        }
        for key in &journal.result.activities {
            if let Some(activity) = w.defs.upbringing.activity(key) {
                *used.entry(activity.monthly_limit_group.as_ref().unwrap_or(key).clone()).or_default() += 1;
            }
        }
    }
    // 要排的格：（格序，结算日期，要挑的栏位）。按旬：每月三旬，学院一旬挑课业 + 课后两项；
    // 按周（U05）：本周各格，每格只挑一项（课业格挑课，课余 / 自由格挑别的），落在换阶段之后的格留空。
    let weekly = w.upbringing_weekly();
    let mut plan: Vec<(u8, manifest_core::scenario::WorldDate, Vec<bool>)> = Vec::new();
    if weekly {
        let now = w.upbringing_stage_on(w.cast_date()).ok_or_else(|| super::blocked("排程日期没有养成阶段"))?;
        for (def, date) in w.upbringing_week_slots() {
            let live = def.index >= state.next_slot && w.upbringing_stage_on(date).is_some_and(|s| s.from == now.from);
            plan.push((def.index, date, if live { vec![def.lesson] } else { Vec::new() }));
        }
    } else {
        for index in 0..3u8 {
            let date = [state.month[0], state.month[1], 1 + u32::from(index) * 10].max(w.cast_date());
            if index < state.next_slot {
                plan.push((index, date, Vec::new()));
                continue;
            }
            let academy = w
                .upbringing_stage_on(date)
                .or_else(|| w.upbringing_stage_on(w.cast_date()))
                .ok_or_else(|| super::blocked("排程日期没有养成阶段"))?
                .stage
                == Stage::Academy;
            plan.push((index, date, if academy { vec![true, false] } else { vec![false] }));
        }
    }
    let mut slots = Vec::new();
    for (index, date, columns) in plan {
        let mut pick = |lesson: bool| {
            // 按周时一格只占格重（八分之几个标准格）：费用按上界、疲劳按比例估。
            let weight_of = |a: &manifest_core::upbringing::ActivityDef| w.upbringing_weight(a, date);
            let mut candidates: Vec<_> = w
                .defs
                .upbringing
                .activities
                .iter()
                .filter(|a| {
                    let after = AfterChoice::activity(&a.key);
                    (a.kind == ActivityKind::Lesson) == lesson
                        && w.upbringing_slot_cost(a, date) <= planned_cash
                        && a.monthly_limit.is_none_or(|limit| {
                            used.get(a.monthly_limit_group.as_deref().unwrap_or(&a.key)).copied().unwrap_or(0) < limit
                        })
                        && w.check_upbringing_choice(a, if lesson { None } else { Some(&after) }, date).is_ok()
                })
                .collect();
            candidates.sort_by_key(|a| {
                let cost = w.upbringing_activity_cost(a);
                let net = conservative_income(w, a) - cost;
                let save = planned_cash < reserve;
                (
                    if planned_fatigue >= 60 && !lesson && (!save || planned_cash >= reserve / 2) {
                        u32::from(a.kind != ActivityKind::Rest)
                    } else {
                        0
                    },
                    if lesson {
                        cost
                    } else if save {
                        -net
                    } else {
                        0
                    },
                    state.activity_counts.get(a.counts_as.as_ref().unwrap_or(&a.key)).copied().unwrap_or(0),
                    a.key.clone(),
                )
            });
            let a = *candidates.first().ok_or_else(|| {
                super::blocked(format!(
                    "ordinary_strategy: {date:?} {}无可选活动；cash={}，next_slot={}",
                    if lesson { "课业" } else { "课后" },
                    w.state.agents.get(&OwnerId::Player).map_or(0, |a| a.cash),
                    state.next_slot
                ))
            })?;
            *used.entry(a.monthly_limit_group.as_ref().unwrap_or(&a.key).clone()).or_default() += 1;
            let weight = weight_of(a);
            planned_cash += conservative_income(w, a) * weight / 8 - w.upbringing_slot_cost(a, date);
            planned_fatigue = (planned_fatigue + a.fatigue * weight / 8).clamp(0, 100);
            Ok::<_, BotError>(a.key.clone())
        };
        let mut lesson = None;
        let mut after = None;
        for column in columns {
            if column {
                lesson = Some(pick(true)?);
            } else {
                after = Some(AfterChoice::activity(&pick(false)?));
            }
        }
        slots.push(PlanSlot { index, lesson, after });
    }
    if weekly {
        w.check_week_plan(OwnerId::Player, &slots)?;
    } else {
        w.check_month_plan(OwnerId::Player, &slots)?;
    }
    Ok(slots)
}

/// 仅提交普通命令并逐日结算；没有传送、资源补齐、改年龄或跳过养成。
/// 这是可重放的确定性策略，未触发的故事不被宣称为不可达。
pub fn ordinary(mut w: World, days: u32) -> (World, OrdinaryReport) {
    let mut report = OrdinaryReport {
        mode: "ordinary_commands",
        from: w.day(),
        until: w.day(),
        budget_days: days,
        graduated: false,
        done: BTreeSet::new(),
        answered_chapters: BTreeMap::new(),
        completed_by_answer: BTreeSet::new(),
        failed: BTreeSet::new(),
        blocked: None,
        commands: Vec::new(),
    };
    let end = w.day().saturating_add(days);
    let mut planned_week: Option<[u32; 3]> = None;
    let run = (|| -> Result<(), BotError> {
        while w.day() < end {
            let mut answered = 0;
            while w.pending_story2().is_some() || w.state.story.pending.is_some() || w.creature_pending().is_some() {
                let (count, context) = if w.story2_is_front() {
                    let pending = w.pending_story2().ok_or_else(|| super::blocked("待决轨道不存在"))?;
                    let chapter = w
                        .defs
                        .story2
                        .track(&pending.track)
                        .and_then(|t| t.chapter(&pending.chapter))
                        .ok_or_else(|| super::blocked("待决章节不存在"))?;
                    let entered = w.state.story2.tracks[&pending.track].entered;
                    (
                        chapter.choices.iter().filter(|c| w.story2_choice_visible(c, entered)).count().max(1),
                        format!("{}/{}", pending.track, pending.chapter),
                    )
                } else if let Some((encounter, creature)) = w.creature_pending() {
                    (creature.responses.len(), encounter.id.clone())
                } else {
                    (manifest_core::story::MAX_CHOICES, "legacy_story".into())
                };
                let command = answer(&w, count);
                let Some(command) = command else {
                    return Err(super::blocked(format!("ordinary_strategy: {context} 无可提交选项")));
                };
                submit(&mut w, &mut report, command)?;
                answered += 1;
                if answered > 10000 {
                    return Err(super::blocked("ordinary_strategy: 同日应答预算耗尽"));
                }
            }
            // 按周（U05）：常设周课表每周一自动铺开；与按旬时“每月重排一次”对齐，每换一周就重排一次。
            if w.act_running() && w.act_bot_step()? {
                continue;
            }
            let today = w.cast_date();
            let week = [today[0], today[1], u32::from(manifest_core::upbringing::weekly::week_of(today[2]))];
            let phase = w.state.upbringing.as_ref().map(|s| s.phase);
            let replan = w.upbringing_weekly() && phase == Some(Phase::Running) && planned_week != Some(week);
            if !w.act_running() && (phase == Some(Phase::Plan) || replan) {
                planned_week = Some(week);
                let slots = month(&w)?;
                let command = w.upbringing_plan_command(slots);
                submit(&mut w, &mut report, command)?;
            }
            if let Some(f) = w.upbringing_family()
                && w.state.upbringing.as_ref().is_some_and(|s| s.path.is_none())
            {
                let path = f
                    .completion
                    .as_ref()
                    .into_iter()
                    .flat_map(|c| &c.paths)
                    .map(|path| Command::ChoosePath { owner: OwnerId::Player, path: path.clone() })
                    .find(|c| c.validate(&w).is_ok());
                if let Some(c) = path {
                    submit(&mut w, &mut report, c)?;
                }
            }
            let before = w.day();
            w.end_day()?;
            if w.day() == before {
                return Err(super::blocked("ordinary_strategy: 日历等待尚未处理的玩法输入"));
            }
        }
        Ok(())
    })();
    report.blocked = run.err().map(|e| e.to_string());
    report.until = w.day();
    report.graduated = w.state.upbringing.as_ref().is_some_and(|s| s.phase == Phase::Done);
    for (key, state) in &w.state.story2.tracks {
        match state.status {
            Status::Done => {
                report.done.insert(key.clone());
            }
            Status::Failed => {
                report.failed.insert(key.clone());
            }
            _ => {}
        }
    }
    (w, report)
}

/// 核心 replay 的终点是该日开始；审计中途停下时还要重放终点当日已接受的命令。
pub fn replay_ordinary(defs: Arc<StaticData>, start: StartParams, report: &OrdinaryReport) -> Result<World, BotError> {
    let mut w = manifest_core::replay::replay(defs, start, &report.commands, report.until)?;
    for entry in report.commands.iter().filter(|e| e.tick == report.until) {
        entry.apply(&mut w)?;
    }
    Ok(w)
}

/// 共享一次关闭 auto 的定义副本，避免每条轨道复制整份世界数据。
/// 节奏的闸一并关掉：作弊审计一条轨道一条轨道地验证每个分支走不走得通，靠改日期、改条件把章节直接推到队首，
/// 与“什么时候出场”无关；开着闸的话，连着推出来的几章会被预算按下，审计就误报“章节没有进入待决队列”。
pub fn isolated_defs(defs: &Arc<StaticData>) -> Arc<StaticData> {
    let mut result = defs.clone();
    let d = Arc::make_mut(&mut result);
    for track in &mut d.story2.tracks {
        track.auto = false;
    }
    d.rules.pacing.enabled = false;
    result
}

/// 家庭专属分片只归本身份；学院按家庭阶段归属。其余交叉故事逐身份运行。
pub fn relevant(w: &World, track: &manifest_core::story2::TrackDef) -> bool {
    if !w.protagonist_track_allowed(&track.key) {
        return false;
    }
    let source = track.source.replace('\\', "/");
    if let Some(family) = w.defs.upbringing.families.iter().find(|f| source.contains(&format!("/families/{}", f.key)))
        && w.upbringing_family().is_none_or(|f| f.key != family.key)
    {
        return false;
    }
    if let Some(academy) = w.defs.upbringing.event_gates.get(&track.key).and_then(|g| g.academy.as_ref())
        && w.upbringing_family().is_none_or(|f| !f.stages.iter().any(|s| s.academy.as_ref() == Some(academy)))
    {
        return false;
    }
    if let Some(chapter) = track.chapter(&track.start) {
        for condition in &chapter.when {
            use manifest_core::story2::Condition;
            if matches!(condition, Condition::Protagonist { .. } | Condition::ProtagonistIn { .. })
                && !w.story2_conditions(std::slice::from_ref(condition), w.day())
            {
                return false;
            }
            if let Condition::Flag { flag, value: true } = condition {
                if let Some(key) = flag.strip_prefix("c9_family_")
                    && w.defs.upbringing.family(key).is_some()
                    && w.upbringing_family().is_none_or(|f| f.key != key)
                {
                    return false;
                }
                if let Some(key) = flag.strip_prefix("c12_voyage_")
                    && w.state.protagonist.as_ref().and_then(|p| p.key()) != Some(key)
                {
                    return false;
                }
            }
        }
    }
    true
}

/// 只为独立的作弊证明准备外部门槛；不改出生日期、性别、取向或年龄规则。
pub fn cheat_seed(initial: &World, key: &str) -> Result<(World, Vec<String>), BotError> {
    use manifest_core::story2::{Condition, Effect};
    let mut w = initial.clone();
    let track = w.defs.story2.track(key).ok_or_else(|| super::blocked("未知轨道"))?.clone();
    let mut prepared = Vec::new();
    let written: BTreeSet<_> = track
        .chapters
        .iter()
        .flat_map(|c| {
            c.choices
                .iter()
                .flat_map(|v| v.effects.iter().chain(v.fail.iter().flat_map(|b| &b.effects)))
                .chain(c.default.iter().chain(&c.timeout).flat_map(|b| &b.effects))
        })
        .filter_map(|e| match e {
            Effect::Flag { flag, .. } => Some(flag.clone()),
            _ => None,
        })
        .collect();
    if let Some(chapter) = track.chapter(&track.start) {
        for c in &chapter.when {
            if let Condition::Flag { flag, .. } = c
                && !written.contains(flag)
            {
                super::Cheat::Satisfy(c.clone()).apply(&mut w, 0)?;
                prepared.push(format!("external_condition:{c:?}"));
            }
        }
    }
    if let Some(gate) = w.defs.upbringing.event_gates.get(key).cloned() {
        let mut date = w.cast_date();
        if let Some(from) = gate.from {
            date = date.max(from);
        }
        if let Some(year) = gate.years.iter().min() {
            date = date.max([*year, 1, 1]);
        }
        if let Some(range) = gate.actors_age {
            for actor in &gate.actors {
                if let Some(p) = w.defs.cast.person(actor) {
                    date = date.max([p.born[0] + range[0], p.born[1], p.born[2]]);
                }
            }
        }
        if let Some(family) = w.upbringing_family().cloned() {
            let stage = family.stages.iter().find(|s| {
                gate.stage.allows(s.stage) && gate.academy.as_ref().is_none_or(|a| s.academy.as_ref() == Some(a))
            });
            if let Some(stage) = stage {
                date = date.max(stage.from);
                if let Some(flag) = &stage.entry_flag {
                    super::Cheat::Satisfy(Condition::Flag { flag: flag.clone(), value: true }).apply(&mut w, 0)?;
                    prepared.push(format!("academy_entry:{flag}"));
                }
            }
        }
        if let Some(festival) =
            gate.festival.as_ref().and_then(|k| w.defs.upbringing.festivals.iter().find(|f| &f.key == k))
            && let Some(day) = festival.dates.iter().filter(|d| **d >= date).min()
        {
            date = *day;
        }
        if w.upbringing_family().is_some_and(|f| date > f.graduation) {
            return Err(super::blocked("native_context: 原生事件的准备日期已经超出本家庭养成期"));
        }
        super::Cheat::AdvanceTo(date).apply(&mut w, 0)?;
        prepared.push(format!("native_date:{date:?}"));
        // 按周（U05）时门槛“最近做过某活动”看的是最近一个排期日（1 / 11 / 21 日）之前一天及更早那一旬的日记，
        // 所以另在那一天的日记里放一条记录（日记的日子须严格递增，已有同日的记录就并进去）。
        let recent_day = w.upbringing_weekly().then(|| {
            let today = w.cast_date();
            let scheduled = match today[2] {
                21.. => 21,
                11.. => 11,
                _ => 1,
            };
            w.day().saturating_sub(today[2] - scheduled).saturating_sub(1)
        });
        if let Some(s) = &mut w.state.upbringing {
            s.event_permits.insert(key.into());
            if let Some(activity) = &gate.activity {
                let result = manifest_core::upbringing::SlotResult {
                    activities: vec![activity.clone()],
                    success: gate.check_result.as_ref().map(|r| r == "success"),
                    ..Default::default()
                };
                if let Some(day) = recent_day {
                    match s.journal.binary_search_by_key(&day, |j| j.day) {
                        Ok(i) => {
                            let j = &mut s.journal[i].result;
                            j.activities.push(activity.clone());
                            j.success = result.success;
                        }
                        Err(i) => {
                            s.journal.insert(i, manifest_core::upbringing::JournalEntry { day, result: result.clone() })
                        }
                    }
                }
                s.last = vec![result];
                prepared.push(format!("activity_result:{activity}:{:?}", gate.check_result));
            }
        }
        prepared.push("native_event_permit".into());
        w.state.cast.academy = w.upbringing_stage_on(w.cast_date()).is_some_and(|s| s.stage == Stage::Academy);
    }
    Ok((w, prepared))
}
