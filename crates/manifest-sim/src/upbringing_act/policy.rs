//! 报表专用打法；只通过既有命令推动世界。
use super::*;
use manifest_core::contests::{Moves, occurrence_key};
mod ace;
pub(super) use ace::{floor_week, plan_week as ace_plan_week};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Strategy {
    Idle,
    Casual,
    Steady,
    Scholar,
    Social,
    Greedy,
    Ace,
}
impl Strategy {
    pub const ALL: [Self; 7] =
        [Self::Idle, Self::Casual, Self::Steady, Self::Scholar, Self::Social, Self::Greedy, Self::Ace];
    pub fn key(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Casual => "casual",
            Self::Steady => "steady",
            Self::Scholar => "scholar",
            Self::Social => "social",
            Self::Greedy => "greedy",
            Self::Ace => "ace",
        }
    }
    pub fn lesson_mode(self) -> usize {
        match self {
            Self::Idle | Self::Casual | Self::Greedy => 0,
            Self::Steady | Self::Social => 1,
            Self::Scholar | Self::Ace => 2,
        }
    }
}

fn action_command(step: FreeStep) -> Command {
    Command::DoAction { owner: OwnerId::Player, place: step.place, action: step.action }
}

/// 只做一步，不推进日结或窥看未来的随机结果。完全同分时保留候选顺序。
pub(super) fn greedy(w: &World, candidates: Vec<Command>) -> Option<Command> {
    let score = w.act_score().total;
    let mut best = None;
    let mut value = (i64::MIN, i64::MIN);
    for command in candidates {
        let mut trial = w.clone();
        if command.apply(&mut trial).is_err() {
            continue;
        }
        let cost = if matches!(command, Command::PlanLessons { .. }) {
            trial.act_fee_week()
        } else {
            w.act_cash() - trial.act_cash()
        };
        let next = (trial.act_score().total - score, -cost);
        if next > value {
            best = Some(command);
            value = next;
        }
    }
    best
}

pub(super) fn greedy_lessons(w: &World, mut slots: Vec<LessonPlan>) -> Result<Vec<LessonPlan>, ReportError> {
    // 排课本身不结算成长；对完整合法课表逐格替换，同分用内核实际周学费择低。
    for index in 0..slots.len() {
        let mut candidates = Vec::new();
        for line in w.defs.upbringing.lines.iter().filter(|l| w.act_line_here(l)) {
            for tier in 0..line.tiers.len() {
                if !w.act_ill() && !w.act_tier_open(line, tier as u8) {
                    continue;
                }
                let mut next = slots.clone();
                next[index] = LessonPlan { line: line.key.clone(), tier: tier as u8, with: None };
                let command = Command::PlanLessons { owner: OwnerId::Player, slots: next };
                let mut trial = w.clone();
                if command.apply(&mut trial).is_ok() && trial.act_fee_week() <= w.act_cash() {
                    candidates.push(command);
                }
            }
        }
        let Some(Command::PlanLessons { slots: next, .. }) = greedy(w, candidates) else {
            return Err(ReportError::Unavailable("greedy_lessons"));
        };
        slots = next;
    }
    Ok(slots)
}

fn requirement_priority(w: &World, req: &Requirements, line: &LineDef) -> i64 {
    let own = if req.attr == line.attr {
        (req.min.unwrap_or(0) - req.attr.as_deref().map_or(0, |a| w.upbringing_projected(a))).max(0) * 100
    } else {
        0
    };
    let practice = req.activity.as_ref().map_or(0, |key| {
        let done = w.state.upbringing.as_ref().and_then(|s| s.activity_counts.get(key)).copied().unwrap_or(0);
        i64::from(
            done < req.times
                && line.tiers.iter().any(|t| {
                    t.activity == *key
                        || w.defs.upbringing.activity(&t.activity).and_then(|a| a.counts_as.as_ref()) == Some(key)
                }),
        ) * 200
    });
    own + practice + req.all.iter().chain(&req.any).map(|r| requirement_priority(w, r, line)).sum::<i64>()
}

pub(super) fn lesson_priority(w: &World, strategy: Strategy, line: &LineDef) -> i64 {
    if !matches!(strategy, Strategy::Steady | Strategy::Scholar | Strategy::Social) {
        return 0;
    }
    let mut priority = 0;
    for (key, state) in w.state.upbringing.iter().flat_map(|s| &s.act.missions) {
        if state.status != MissionStatus::Active {
            continue;
        }
        let Some(m) = w.defs.upbringing.missions.iter().find(|m| m.key == *key) else { continue };
        for goal in &m.goals {
            if w.act_mission_goal(m, state, goal).2 {
                continue;
            }
            priority += match goal {
                MissionGoal::Gain { attr, .. } if line.attr.as_ref() == Some(attr) => 200,
                MissionGoal::Skill { skill, .. } if line.skill.as_ref() == Some(skill) => 200,
                MissionGoal::Tier { line: key, .. } if line.key == *key => 200,
                _ => 0,
            };
        }
    }
    if strategy == Strategy::Scholar {
        for exam in w.defs.upbringing.exams.iter().filter(|e| {
            e.academy.as_ref().is_some_and(|a| w.upbringing_academy().is_some_and(|v| v.key == *a))
                && !w.state.upbringing.as_ref().and_then(|s| s.exams.get(&e.key)).is_some_and(|e| e.passed)
        }) {
            priority += requirement_priority(w, &exam.requirements, line);
            priority += line.attr.as_ref().and_then(|a| exam.check.attrs.get(a)).copied().unwrap_or(0) * 2;
        }
        for contest in &w.defs.upbringing.contests {
            if contest.dates.iter().any(|d| w.contest_open(contest, *d))
                && line.attr.as_ref() == Some(&contest.check.attr)
            {
                priority += 30;
            }
        }
    }
    priority
}

/// 每天都查询，包含落在课日、月末闲日的考期和比赛；报名后由内核日结参赛。
pub(super) fn calendar_commands(w: &World) -> Vec<Command> {
    let mut out = Vec::new();
    for exam in &w.defs.upbringing.exams {
        if w.exam_available(exam).is_ok() {
            out.push(Command::TakeExam { owner: OwnerId::Player, exam: exam.key.clone() });
        }
    }
    for contest in &w.defs.upbringing.contests {
        for date in &contest.dates {
            let key = occurrence_key(&contest.key, *date);
            if w.contest_open(contest, *date) && !w.contest_registered(&key) {
                out.push(Command::PlayContest {
                    owner: OwnerId::Player,
                    contest: key,
                    moves: Moves::Register { register: true },
                });
            }
        }
    }
    out
}

fn voyage_commands(w: &World) -> Vec<Command> {
    w.defs
        .upbringing
        .act_voyages
        .iter()
        .filter(|v| w.upbringing_family().is_some_and(|f| f.key == v.family) && w.act_voyage_status(v) == "open")
        .map(|v| Command::JoinVoyage { owner: OwnerId::Player, voyage: v.key.clone() })
        .collect()
}

fn greet_commands(w: &World) -> Vec<Command> {
    w.state
        .upbringing
        .iter()
        .flat_map(|s| &s.act.presence)
        .filter_map(|(person, place)| {
            let action = ActAction::Greet { person: person.clone() };
            w.act_action_problem(place, &action)
                .is_ok()
                .then(|| action_command(FreeStep { place: place.clone(), action }))
        })
        .collect()
}

pub(super) fn plan_opportunity(w: &World, strategy: Strategy) -> Option<Command> {
    if strategy == Strategy::Idle {
        return None;
    }
    let mut candidates = calendar_commands(w);
    candidates.extend(voyage_commands(w));
    if matches!(strategy, Strategy::Social | Strategy::Greedy | Strategy::Ace) {
        candidates.extend(greet_commands(w));
    }
    if strategy == Strategy::Greedy {
        for line in w.defs.upbringing.lines.iter().filter(|l| w.act_line_here(l)) {
            candidates.push(Command::MasterTest { owner: OwnerId::Player, line: line.key.clone(), play: false });
        }
        // 开课是零增量的真实出口，防止为了零增量而花钱报名或拜师。
        candidates.push(Command::StartWeek { owner: OwnerId::Player });
        return greedy(w, candidates).filter(|c| !matches!(c, Command::StartWeek { .. }));
    }
    candidates.into_iter().find(|c| c.validate(w).is_ok())
}

fn duty_commands(w: &World) -> Vec<Command> {
    let failures = w.act_tide_effects().duty_fail;
    let mut duties: Vec<_> = w
        .defs
        .upbringing
        .act_duties
        .iter()
        .filter(|d| {
            w.upbringing_family().is_some_and(|f| f.key == d.family)
                && w.upbringing_stage_on(w.cast_date())
                    .is_some_and(|s| s.stage == d.stage && s.academy.as_deref().unwrap_or("") == d.academy)
        })
        .collect();
    duties.sort_by_key(|d| (failures.get(&d.key).copied().unwrap_or(0), &d.key));
    duties
        .into_iter()
        .map(|d| Command::FamilyDuty { owner: OwnerId::Player, duty: d.key.clone() })
        .filter(|c| c.validate(w).is_ok())
        .collect()
}

fn free_actions(w: &World) -> Vec<Command> {
    let mut out = Vec::new();
    for place in w.act_places() {
        for kind in w.act_place_actions(&place.key).into_iter().filter(|a| a.enabled) {
            let mut actions = Vec::new();
            match kind.kind.as_str() {
                "rest" => actions.push(ActAction::Rest),
                "pray" => actions.push(ActAction::Pray),
                "rumor" => actions.push(ActAction::Rumor),
                "job" => actions.extend(kind.targets.into_iter().map(|activity| ActAction::Job { activity })),
                "talk" => actions.extend(kind.targets.into_iter().map(|person| ActAction::Talk { person })),
                "marker" => actions.extend(kind.targets.into_iter().map(|track| ActAction::Marker { track })),
                "gift" => {
                    for person in kind.targets {
                        for (item, _) in w.act_gift_items() {
                            actions.push(ActAction::Gift { person: person.clone(), item });
                        }
                    }
                }
                "self_study" => {
                    for target in kind.targets {
                        if let Some((line, tier)) = target.rsplit_once(':')
                            && let Ok(tier) = tier.parse()
                        {
                            actions.push(ActAction::SelfStudy { line: line.into(), tier });
                        }
                    }
                }
                "excursion" => {
                    for target in kind.targets {
                        if let Some((excursion, node)) = target.split_once(':') {
                            actions.push(ActAction::Excursion { excursion: excursion.into(), node: node.into() });
                        }
                    }
                }
                _ => {}
            }
            out.extend(
                actions
                    .into_iter()
                    .filter(|a| w.act_action_problem(&place.key, a).is_ok())
                    .map(|action| action_command(FreeStep { place: place.key.clone(), action })),
            );
        }
    }
    out
}

fn shopping_commands(w: &World, reserve: i64) -> Vec<Command> {
    let Some(loc) = w.upbringing_location() else { return Vec::new() };
    w.act_places()
        .iter()
        .filter(|p| w.upbringing_place_open(p))
        .flat_map(|p| w.act_shop(&p.key))
        .filter(|(item, price)| w.item_available(OwnerId::Player, item) == 0 && *price <= w.act_cash() - reserve)
        .map(|(item, price)| Command::BuyItem { owner: OwnerId::Player, loc, item, qty: 1, max_total: Some(price) })
        .collect()
}

pub(super) fn free_command(w: &World, strategy: Strategy, weekly_fee: i64) -> Result<Command, ReportError> {
    let end = Command::EndFree { owner: OwnerId::Player };
    if strategy == Strategy::Idle {
        return Ok(end);
    }
    if strategy == Strategy::Ace {
        return ace::free_command(w, weekly_fee);
    }
    let mut calendar = calendar_commands(w);
    calendar.extend(voyage_commands(w));
    if strategy != Strategy::Greedy
        && let Some(c) = calendar.first()
    {
        return Ok(c.clone());
    }
    let duties = duty_commands(w);
    let actions = free_actions(w);
    if strategy == Strategy::Greedy {
        calendar.extend(duties);
        calendar.extend(greet_commands(w));
        calendar.extend(actions);
        calendar.extend(shopping_commands(w, 0));
        calendar.push(end);
        return greedy(w, calendar).ok_or(ReportError::Unavailable("greedy_free"));
    }
    // 家业不花行动点；选择本周潮汐失败率最低的一件，零点时也能做。
    if let Some(c) = duties.into_iter().next() {
        return Ok(c);
    }
    let done = &w.state.upbringing.as_ref().ok_or(ReportError::Unavailable("upbringing"))?.act.done;
    if w.act_ill() {
        return Ok(actions
            .into_iter()
            .find(|c| matches!(c, Command::DoAction { action: ActAction::Rest, .. }))
            .unwrap_or(end));
    }
    if strategy == Strategy::Social {
        if let Some(c) = greet_commands(w).into_iter().next() {
            return Ok(c);
        }
        if !done.iter().any(|d| matches!(d.action, ActAction::Gift { .. }))
            && !actions.iter().any(|c| matches!(c, Command::DoAction { action: ActAction::Gift { .. }, .. }))
        {
            let mut purchases = shopping_commands(w, weekly_fee * 2 + 80);
            purchases.sort_by_key(|c| if let Command::BuyItem { max_total, .. } = c { *max_total } else { None });
            for buy in purchases {
                let mut trial = w.clone();
                if buy.apply(&mut trial).is_err() {
                    continue;
                }
                if free_actions(&trial).iter().any(|c| matches!(c,
                    Command::DoAction { action: ActAction::Gift { person, .. }, .. } if w.act_person_level(person) < 4
                )) { return Ok(buy); }
            }
        }
        let pick = actions
            .iter()
            .filter_map(|c| {
                let Command::DoAction { action, .. } = c else { return None };
                let priority = match action {
                    ActAction::Marker { .. } => 1000,
                    ActAction::Rumor if !done.iter().any(|d| matches!(d.action, ActAction::Rumor)) => 900,
                    ActAction::Gift { person, .. } if w.act_person_level(person) < 4 => {
                        700 - w.act_person_level(person) as i64 * 20
                    }
                    ActAction::Talk { person } if w.act_person_level(person) < 4 => {
                        // 第一程报名先把阿濑练到二级；其余人物轮流补齐等级。
                        if person == "ase" && w.act_person_level(person) < 2 {
                            950
                        } else {
                            650 - w.act_person_level(person) as i64 * 20
                        }
                    }
                    _ => 0,
                };
                (priority > 0).then_some((c, priority))
            })
            .max_by_key(|(_, p)| *p);
        if let Some((c, _)) = pick {
            return Ok(c.clone());
        }
        if !actions.is_empty()
            && w.act_cash() > weekly_fee * 2 + 30
            && let Some(c) = shopping_commands(w, weekly_fee * 2).into_iter().next()
        {
            return Ok(c);
        }
    } else {
        let take_marker =
            strategy != Strategy::Casual || w.state.upbringing.as_ref().is_some_and(|s| s.act.week % 4 == 0);
        if take_marker
            && let Some(c) =
                actions.iter().find(|c| matches!(c, Command::DoAction { action: ActAction::Marker { .. }, .. }))
        {
            return Ok(c.clone());
        }
        if strategy == Strategy::Scholar {
            let study = actions
                .iter()
                .filter_map(|c| {
                    let Command::DoAction { action: ActAction::SelfStudy { line, .. }, .. } = c else { return None };
                    let def = w.defs.upbringing.lines.iter().find(|l| l.key == *line)?;
                    Some((c, lesson_priority(w, strategy, def)))
                })
                .max_by_key(|(_, n)| *n);
            if w.state.upbringing.as_ref().is_some_and(|s| s.fatigue < 55)
                && w.act_cash() >= weekly_fee * 2
                && let Some((c, n)) = study
                && n > 0
            {
                return Ok(c.clone());
            }
        }
    }
    if let Some(step) = legacy_free_step(w, strategy.lesson_mode(), weekly_fee)? {
        return Ok(action_command(step));
    }
    // 认真、学业也听消息；用家业与海上地点的其他工种补足账房不存在的周末。
    Ok(actions
        .into_iter()
        .find(|c| matches!(c, Command::DoAction { action: ActAction::Rumor | ActAction::Job { .. }, .. }))
        .unwrap_or(end))
}

pub(super) fn answer_story(w: &World, strategy: Strategy, ordinal: usize) -> Option<Command> {
    let mut effort = BTreeMap::new();
    let choices: Vec<u32> = if w.story2_is_front() {
        let pending = w.pending_story2()?;
        let chapter = w.defs.story2.track(&pending.track)?.chapter(&pending.chapter)?;
        let entered = w.state.story2.tracks.get(&pending.track).map_or(w.day(), |s| s.entered);
        let visible: Vec<_> = chapter.choices.iter().filter(|c| w.story2_choice_visible(c, entered)).collect();
        if visible.is_empty() {
            vec![0]
        } else {
            visible
                .iter()
                .enumerate()
                .filter(|(_, c)| {
                    w.story2_choice_open(c, entered)
                        && (w.story2_soft_gaps(c).is_empty()
                            || !w.story2_choice_failed(&pending.track, &pending.chapter, entered, &c.key))
                })
                .map(|(i, c)| {
                    effort.insert(i as u32, w.story2_soft_gaps(c).len());
                    i as u32
                })
                .collect()
        }
    } else {
        (0..manifest_core::story::MAX_CHOICES as u32).collect()
    };
    let mut candidates: Vec<_> =
        choices.into_iter().map(|choice| Command::StoryAnswer { owner: OwnerId::Player, choice }).collect();
    if strategy == Strategy::Ace {
        // 只看界面上选项的门槛；不在副本里试答，再根据掷骰结果挑选。
        candidates.sort_by_key(|c| match c {
            Command::StoryAnswer { choice, .. } => effort.get(choice).copied().unwrap_or(0),
            _ => 0,
        });
        return candidates.into_iter().find(|c| c.validate(w).is_ok());
    }
    if strategy == Strategy::Greedy {
        return greedy(w, candidates);
    }
    if strategy == Strategy::Casual && !candidates.is_empty() {
        let len = candidates.len();
        candidates.rotate_left((w.day() as usize + ordinal) % len);
    }
    let mut best = None;
    let mut value = (i64::MIN, i64::MIN, i64::MIN);
    for c in candidates {
        let mut trial = w.clone();
        if c.apply(&mut trial).is_err() {
            continue;
        }
        if strategy == Strategy::Casual {
            return Some(c);
        }
        let Command::StoryAnswer { choice, .. } = c else { continue };
        let easy = -(effort.get(&choice).copied().unwrap_or(0) as i64);
        let cash = trial.act_cash() - w.act_cash();
        let score = trial.act_score().total;
        let affinity = trial.state.cast.persons.values().map(|p| p.affection.affinity).sum();
        let next = match strategy {
            Strategy::Idle => (easy, cash, 0),
            Strategy::Social => (easy, affinity, score),
            _ => (easy, score, cash),
        };
        if next > value {
            best = Some(c);
            value = next;
        }
    }
    best
}
