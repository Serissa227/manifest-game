//! U06B2：按公开门槛、当前状态与期望收益取舍；不试跑随机结算。
use super::*;

const FATIGUE_BUDGET: i64 = 32;

fn cash_target(w: &World, r: &ActRules, weekly_fee: i64) -> Result<i64, ReportError> {
    let f = w.upbringing_family().ok_or(ReportError::Unavailable("family"))?;
    let date = w.cast_date();
    let remaining = (f.graduation[0] - date[0]) * 48 - (date[1] - 1) * 4 - (date[2] - 1) / 7;
    let savings_cash = r.savings.score_per * r.savings.score_max + r.savings.keep_max;
    Ok(weekly_fee * 3 + 150 + if remaining < 144 { savings_cash * i64::from(144 - remaining) / 144 } else { 0 })
}

fn active_goals(w: &World) -> impl Iterator<Item = (&MissionDef, &MissionState, &MissionGoal)> {
    w.state
        .upbringing
        .iter()
        .flat_map(|s| &s.act.missions)
        .filter_map(|(key, state)| {
            (state.status == MissionStatus::Active)
                .then(|| w.defs.upbringing.missions.iter().find(|m| m.key == *key).map(|m| (m, state)))
                .flatten()
        })
        .flat_map(|(m, state)| m.goals.iter().map(move |goal| (m, state, goal)))
        .filter(|(m, state, goal)| !w.act_mission_goal(m, state, goal).2)
}

fn mission_line(w: &World, e: &Expected, line: &LineDef, tier: u8) -> i64 {
    active_goals(w)
        .map(|(_, state, goal)| {
            let needed = match goal {
                MissionGoal::Gain { attr, ge, .. } if line.attr.as_ref() == Some(attr) => {
                    let base = state.base.get(&format!("growth:{attr}")).copied().unwrap_or(0);
                    e.growth.get(attr).copied().unwrap_or(0) / 1000 - base < *ge
                        && e.room(
                            attr,
                            w.upbringing_annual_cap(),
                            w.act_rules().map_or(100, |r| r.ladder.cap_pct_by_tier[usize::from(tier)]),
                        ) > 0
                }
                MissionGoal::Skill { skill, ge, .. } if line.skill.as_ref() == Some(skill) => {
                    let base = state.base.get(&format!("skill:{skill}")).copied().unwrap_or(0);
                    e.skills.get(skill).copied().unwrap_or(0) / 1000 - base < *ge
                }
                MissionGoal::Tier { line: key, ge, .. } => {
                    let paid = e.paid.get(key).copied().unwrap_or(0);
                    line.key == *key && i64::from(tier) + 1 >= *ge && i64::from(u8::BITS - paid.leading_zeros()) < *ge
                }
                _ => false,
            };
            i64::from(needed) * 10000
        })
        .sum()
}

fn focus_lines(w: &World) -> Vec<&LineDef> {
    let mut lines: Vec<_> =
        w.defs.upbringing.lines.iter().filter(|l| w.act_line_here(l) && l.tiers.len() == 4).collect();
    lines.sort_by_key(|l| (std::cmp::Reverse(l.attr.as_deref().map_or(0, |a| w.upbringing_growth(a))), &l.key));
    lines.truncate(2);
    lines
}

fn training_value(w: &World, e: &Expected, line: &LineDef, tier: u8, roots: bool) -> i64 {
    let Some(attr) = line.attr.as_deref() else { return 0 };
    let r = w.act_rules().cloned().unwrap_or_default();
    let room = e.room(attr, w.upbringing_annual_cap(), r.ladder.cap_pct_by_tier[usize::from(tier)]);
    if room == 0 {
        return 0;
    }
    let focus = focus_lines(w);
    let root = is_root(&w.defs, attr);
    let relevant = focus.iter().any(|l| l.root.as_deref() == Some(attr));
    let level = e.level(&w.defs, attr);
    let invest = if roots && root && relevant && level < 6 { if level < 5 { 6000 } else { 4000 } } else { 0 };
    let g = w.act_expected_yield(line, tier, None) * 10;
    let direct = e.line_total(&r, line, g, w.upbringing_annual_cap(), r.ladder.cap_pct_by_tier[usize::from(tier)]) / 10;
    invest + direct + if !root && focus.iter().any(|l| l.key == line.key) { 1000 } else { 0 }
}

pub(in crate::upbringing_act) fn plan_week(w: &mut World) -> Result<i64, ReportError> {
    if w.act_sailing() {
        Command::StartWeek { owner: OwnerId::Player }.apply(w)?;
        return Ok(0);
    }
    if w.act_ill() {
        Command::PlanLessons { owner: OwnerId::Player, slots: w.act_default_lessons() }.apply(w)?;
        Command::StartWeek { owner: OwnerId::Player }.apply(w)?;
        return Ok(0);
    }
    let defs = w.defs.clone();
    let r = w.act_rules().cloned().unwrap_or_default();
    let fourth_used = w.state.upbringing.iter().flat_map(|s| s.act.lines.values()).filter(|l| l.used & 8 != 0).count();
    let save_tuition = fourth_used >= 2 && w.act_cash() < cash_target(w, &r, w.act_fee_week())?;
    let mut expected = Expected::from_world(w)?;
    let mut slots = Vec::new();
    let mut tools = BTreeSet::new();
    let mut monthly = BTreeMap::<String, usize>::new();
    let mut committed = 0;
    let mut weekly_fee = 0;
    let mut accompanied = false;
    for (index, day) in w.act_lesson_days().to_vec().into_iter().enumerate() {
        let inactive = u32::from(day) < w.act_day();
        let mut choices = Vec::new();
        for line in defs.upbringing.lines.iter().filter(|l| w.act_line_here(l)) {
            for tier in (0..line.tiers.len()).rev() {
                let status = w.act_tier_status(line, tier as u8);
                let master = !inactive && status.missing == ["master"];
                if !inactive && !status.missing.is_empty() && !master {
                    continue;
                }
                let Some(a) = defs.upbringing.activity(&line.tiers[tier].activity) else { continue };
                let group = a.monthly_limit_group.as_deref().unwrap_or(&a.key);
                if !inactive && let Some(limit) = a.monthly_limit {
                    let mut remaining = a.clone();
                    remaining.monthly_limit =
                        Some(limit.saturating_sub(monthly.get(group).copied().unwrap_or(0) as u32));
                    if !w.act_activity_structural(&remaining, w.cast_date()) {
                        continue;
                    }
                }
                let fee = if inactive { 0 } else { status.fee };
                let tool =
                    if inactive || status.paid || tools.contains(&(line.key.clone(), tier)) { 0 } else { status.tool };
                let gift = if master { status.gift } else { 0 };
                let mission = mission_line(w, &expected, line, tier as u8);
                if save_tuition && mission == 0 && fee > 0 {
                    continue;
                }
                if fee + tool + gift > w.act_cash() - committed {
                    continue;
                }
                let value = mission + training_value(w, &expected, line, tier as u8, index < 3);
                choices.push((PlanChoice { line, tier, master, fee, tool }, value));
            }
        }
        let (choice, _) = choices
            .into_iter()
            .max_by_key(|(c, value)| (*value, -c.fee, -c.tool))
            .ok_or(ReportError::Unavailable("ace_lessons"))?;
        if choice.master {
            Command::MasterTest { owner: OwnerId::Player, line: choice.line.key.clone(), play: false }.apply(w)?;
        }
        let mut plan = LessonPlan { line: choice.line.key.clone(), tier: choice.tier as u8, with: None };
        if !inactive && !accompanied {
            let person = w
                .state
                .upbringing
                .iter()
                .flat_map(|s| &s.act.presence)
                .filter(|(_, place)| *place == &choice.line.place)
                .max_by_key(|(p, _)| (w.act_has_perk(p, "companion"), w.act_person_level(p)));
            if let Some((person, _)) = person {
                plan.with = Some(person.clone());
                accompanied = true;
            }
        }
        committed += choice.fee + choice.tool;
        weekly_fee += choice.fee;
        if !inactive {
            tools.insert((choice.line.key.clone(), choice.tier));
            *expected.paid.entry(choice.line.key.clone()).or_default() |= 1 << choice.tier;
            let a = defs
                .upbringing
                .activity(&choice.line.tiers[choice.tier].activity)
                .ok_or(ReportError::Unavailable("ace_activity"))?;
            *monthly.entry(a.monthly_limit_group.as_deref().unwrap_or(&a.key).into()).or_default() += 1;
            let g = w.act_expected_yield(choice.line, choice.tier as u8, plan.with.as_deref()) * 10;
            expected.apply_line(
                &r,
                choice.line,
                g,
                w.upbringing_annual_cap(),
                r.ladder.cap_pct_by_tier[choice.tier],
                LESSON,
            );
        }
        slots.push(plan);
    }
    if accompanied && w.act_lessons_problem(&slots).is_err() {
        for plan in &mut slots {
            plan.with = None;
        }
    }
    Command::PlanLessons { owner: OwnerId::Player, slots }.apply(w)?;
    Command::StartWeek { owner: OwnerId::Player }.apply(w)?;
    Ok(weekly_fee)
}

fn person_need(w: &World, person: &str) -> i64 {
    let affinity = w.affection(person).map_or(0, |a| a.affinity);
    let perk = w
        .act_person_perks(person)
        .filter(|p| matches!(p.kind.as_str(), "companion" | "job_partner" | "teach"))
        .filter(|p| !w.act_perk_active(p))
        .map(|p| i64::from(p.level))
        .min();
    if perk.is_some() {
        return 5500;
    }
    let mentor = focus_lines(w).iter().any(|l| l.mentor.as_deref() == Some(person));
    if mentor && affinity < 35 {
        5000
    } else if w.act_person_level(person) < 4 {
        400 - i64::from(w.act_person_level(person)) * 50
    } else {
        0
    }
}

fn mission_action(w: &World, command: &Command) -> i64 {
    active_goals(w)
        .map(|(_, _, goal)| {
            let matches = match (goal, command) {
                (MissionGoal::Duty { duty, .. }, Command::FamilyDuty { duty: key, .. }) => duty == key,
                (
                    MissionGoal::Affinity { person, .. },
                    Command::DoAction {
                        action: ActAction::Talk { person: key } | ActAction::Gift { person: key, .. },
                        ..
                    },
                ) => person == key,
                (MissionGoal::Deed { deed, .. }, Command::DoAction { action, .. }) => matches!(
                    (deed.key(), action),
                    ("ub_job", ActAction::Job { .. })
                        | ("ub_gift", ActAction::Gift { .. })
                        | ("ub_rest", ActAction::Rest | ActAction::Pray)
                        | ("ub_talk_deep", ActAction::Talk { .. })
                        | ("ub_self_study", ActAction::SelfStudy { .. })
                        | ("ub_rumor", ActAction::Rumor)
                ),
                (MissionGoal::Deed { deed, .. }, Command::BuyItem { .. }) => deed.key() == "ub_buy",
                (MissionGoal::Deed { deed, .. }, Command::MasterTest { .. }) => deed.key() == "ub_master_test",
                (
                    MissionGoal::Gain { attr, .. },
                    Command::DoAction { action: ActAction::SelfStudy { line, .. }, .. },
                ) => w.defs.upbringing.lines.iter().any(|l| l.key == *line && l.attr.as_ref() == Some(attr)),
                (
                    MissionGoal::Skill { skill, .. },
                    Command::DoAction { action: ActAction::SelfStudy { line, .. }, .. },
                ) => w.defs.upbringing.lines.iter().any(|l| l.key == *line && l.skill.as_ref() == Some(skill)),
                _ => false,
            };
            i64::from(matches) * 10000
        })
        .sum()
}

pub(super) fn free_command(w: &World, weekly_fee: i64) -> Result<Command, ReportError> {
    let end = Command::EndFree { owner: OwnerId::Player };
    if let Some(c) = calendar_commands(w).into_iter().chain(voyage_commands(w)).next() {
        return Ok(c);
    }
    let duties = duty_commands(w);
    if let Some(c) = duties.into_iter().max_by_key(|c| {
        let Command::FamilyDuty { duty, .. } = c else { return 0 };
        let remaining = w.defs.upbringing.act_duties.iter().find(|d| d.key == *duty).map_or(0, |d| {
            let done = w.state.upbringing.as_ref().and_then(|s| s.act.family_duty.get(duty)).copied().unwrap_or(0);
            if done < d.milestone { 100 - i64::from(d.milestone - done) } else { 0 }
        });
        mission_action(w, c) + remaining
    }) {
        return Ok(c);
    }
    if let Some(c) = greet_commands(w).into_iter().next() {
        return Ok(c);
    }
    let s = w.state.upbringing.as_ref().ok_or(ReportError::Unavailable("upbringing"))?;
    let r = w.act_rules().cloned().unwrap_or_default();
    let actions = free_actions(w);
    let rest = actions.iter().find(|c| matches!(c, Command::DoAction { action: ActAction::Rest, .. }));
    // 下周可能换门或升档，按两阶段的最多课格、第四档消耗预留恢复。
    let next_lessons = i64::from(r.lessons.home.max(r.lessons.academy)) * r.fatigue[3] / 10;
    let rests =
        ((s.fatigue + next_lessons - r.recover.weekly - FATIGUE_BUDGET).max(0) + r.recover.rest - 1) / r.recover.rest;
    if w.act_ill() || s.fatigue > FATIGUE_BUDGET || i64::from(s.act.points) <= rests {
        return Ok(rest.cloned().unwrap_or(end));
    }
    let mut candidates = actions;
    let needs_gift = active_goals(w)
        .any(|(_, _, g)| matches!(g, MissionGoal::Deed { deed, .. } if deed.key() == "ub_gift"))
        && !candidates.iter().any(|c| matches!(c, Command::DoAction { action: ActAction::Gift { .. }, .. }));
    candidates.extend(shopping_commands(w, weekly_fee * 3 + 150));
    for line in w.defs.upbringing.lines.iter().filter(|l| w.act_line_here(l)) {
        if let Some(tier) = line.tiers.iter().position(|t| t.gate.as_deref() == Some("master_test")) {
            let status = w.act_tier_status(line, tier as u8);
            if status.missing == ["master"] && w.act_cash() >= status.gift + weekly_fee * 2 {
                candidates.push(Command::MasterTest { owner: OwnerId::Player, line: line.key.clone(), play: false });
            }
        }
    }
    let e = Expected::from_world(w)?;
    let target = cash_target(w, &r, weekly_fee)?;
    let need_cash = w.act_cash() < target;
    let pick = candidates
        .into_iter()
        .filter_map(|c| {
            let (base, tired) = match &c {
                Command::DoAction { place, action, .. } => match action {
                    ActAction::Marker { .. } => (4500, 0),
                    ActAction::Talk { person } => (person_need(w, person), 0),
                    ActAction::Gift { person, .. } => (person_need(w, person) - 100, 0),
                    ActAction::Job { activity } => {
                        let a = w.defs.upbringing.activity(activity)?;
                        let income = w.act_job_income(place, a);
                        (if need_cash { 7000 + income } else { 0 }, r.job_fatigue / 10)
                    }
                    ActAction::SelfStudy { line, tier } => {
                        let l = w.defs.upbringing.lines.iter().find(|l| l.key == *line)?;
                        let room = l.attr.as_deref().map_or(0, |a| e.room(a, w.upbringing_annual_cap(), 100));
                        if room == 0 && !active_goals(w).any(|(_, _, goal)| {
                            matches!(goal, MissionGoal::Skill { skill, .. } if l.skill.as_ref() == Some(skill))
                        }) {
                            return None;
                        }
                        (
                            if room > 0 { training_value(w, &e, l, *tier, true) / 2 } else { 0 },
                            r.self_study_fatigue / 10,
                        )
                    }
                    ActAction::Pray => (if s.fatigue >= r.recover.pray && s.mood < 80 { 3000 } else { 0 }, 0),
                    ActAction::Rest => (0, 0),
                    ActAction::Rumor => {
                        (if !s.act.done.iter().any(|d| matches!(d.action, ActAction::Rumor)) { 200 } else { 0 }, 0)
                    }
                    _ => (0, 0),
                },
                Command::BuyItem { max_total, .. } => ((if needs_gift { 9000 } else { 0 }) - max_total.unwrap_or(0), 0),
                Command::MasterTest { .. } => (500, 0),
                _ => (0, 0),
            };
            // 当前疲劳加公开基础消耗；另留二十点给剧情额外疲劳，不预演失手骰。
            if s.fatigue + tired > FATIGUE_BUDGET {
                return None;
            }
            let value = base + mission_action(w, &c);
            (value > 0).then_some((c, value))
        })
        .max_by_key(|(_, value)| *value);
    if let Some((c, _)) = pick {
        return Ok(c);
    }
    Ok(if s.fatigue > 0 {
        free_actions(w)
            .into_iter()
            .find(|c| matches!(c, Command::DoAction { action: ActAction::Rest, .. }))
            .unwrap_or(end)
    } else {
        end
    })
}

/// 下限调查：只上同一根基的免费第一档，周末什么都不做；仍经排课、开课与日结。
pub(in crate::upbringing_act) fn floor_week(w: &mut World) -> Result<i64, ReportError> {
    let line = w
        .defs
        .upbringing
        .lines
        .iter()
        .filter(|l| w.act_line_here(l))
        .filter(|l| l.attr.as_deref().is_some_and(|a| is_root(&w.defs, a)))
        .filter(|l| w.act_tier_open(l, 0) && w.act_tier_fee(l, 0) == 0)
        .filter(|l| w.defs.upbringing.activity(&l.tiers[0].activity).is_some_and(|a| a.monthly_limit.is_none()))
        .max_by_key(|l| l.attr.as_deref().map_or(0, |a| w.upbringing_growth(a)))
        .ok_or(ReportError::Unavailable("floor_line"))?;
    let slots = vec![LessonPlan { line: line.key.clone(), tier: 0, with: None }; w.act_lesson_days().len()];
    Command::PlanLessons { owner: OwnerId::Player, slots }.apply(w)?;
    Command::StartWeek { owner: OwnerId::Player }.apply(w)?;
    Ok(0)
}
