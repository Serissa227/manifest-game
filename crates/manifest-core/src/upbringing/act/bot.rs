use super::*;
impl World {
    /// 随手玩的缺省策略：沿用最低档、不看标记，每次最多提交一条命令。
    pub fn act_bot_step(&mut self) -> Result<bool, CommandError> {
        if !self.act_running() || self.act_story_waiting() {
            return Ok(false);
        }
        let owner = OwnerId::Player;
        let command = match self.act_phase() {
            ActPhase::Moment => Some(Command::AnswerMoment { owner, pick: MomentPick::Steady }),
            ActPhase::Summary => Some(Command::CloseWeek { owner }),
            ActPhase::Plan => {
                if let Some(voyage) = self
                    .defs
                    .upbringing
                    .act_voyages
                    .iter()
                    .find(|v| {
                        self.upbringing_family().is_some_and(|f| f.key == v.family)
                            && self.act_voyage_status(v) == "open"
                    })
                    .map(|v| v.key.clone())
                {
                    Command::JoinVoyage { owner, voyage }.apply(self)?;
                    return Ok(true);
                }
                let need_plan =
                    self.act_lessons_problem(self.act_lesson_plan()).is_err() || self.act_fee_week() > self.act_cash();
                if need_plan {
                    let mut plans = self.act_default_lessons();
                    for p in &mut plans {
                        p.with = None;
                        if let Some(l) = self.defs.upbringing.lines.iter().find(|l| l.key == p.line)
                            && (!self.act_tier_open(l, p.tier) || self.act_fee_week() > self.act_cash())
                        {
                            p.tier = 0;
                        }
                    }
                    // 阶段缺省档尚未开放时，寻找能上且不超本月次数的替代门。
                    let candidates: Vec<_> = self
                        .defs
                        .upbringing
                        .lines
                        .iter()
                        .filter(|l| self.act_line_here(l) && self.act_tier_open(l, 0))
                        .map(|l| LessonPlan { line: l.key.clone(), tier: 0, with: None })
                        .collect();
                    let mut selected = Vec::new();
                    for i in 0..self.act_lesson_days().len() {
                        let preferred = plans.get(i).cloned();
                        let choices = preferred.into_iter().chain(candidates.iter().cloned());
                        let mut found = None;
                        for choice in choices {
                            let Some(l) = self.defs.upbringing.lines.iter().find(|l| l.key == choice.line) else {
                                continue;
                            };
                            if self.act_fee_week() > self.act_cash() && self.act_tier_fee(l, choice.tier) > 0 {
                                continue;
                            }
                            if !self.act_tier_open(l, choice.tier) {
                                continue;
                            }
                            let Some(a) = l
                                .tiers
                                .get(usize::from(choice.tier))
                                .and_then(|t| self.defs.upbringing.activity(&t.activity))
                            else {
                                continue;
                            };
                            let group = a.monthly_limit_group.as_deref().unwrap_or(&a.key);
                            let planned = selected
                                .iter()
                                .filter_map(|p: &LessonPlan| {
                                    self.defs
                                        .upbringing
                                        .lines
                                        .iter()
                                        .find(|l| l.key == p.line)
                                        .and_then(|l| l.tiers.get(usize::from(p.tier)))
                                        .and_then(|t| self.defs.upbringing.activity(&t.activity))
                                })
                                .filter(|a| a.monthly_limit_group.as_deref().unwrap_or(&a.key) == group)
                                .count();
                            if a.monthly_limit
                                .is_some_and(|n| self.upbringing_monthly_used(group) + planned >= n as usize)
                            {
                                continue;
                            }
                            found = Some(choice);
                            break;
                        }
                        let Some(p) = found else { return Err(reason("ub.act.line")) };
                        selected.push(p);
                    }
                    if selected == self.act_lesson_plan() {
                        Some(Command::StartWeek { owner })
                    } else {
                        Some(Command::PlanLessons { owner, slots: selected })
                    }
                } else {
                    Some(Command::StartWeek { owner })
                }
            }
            ActPhase::Free => {
                if self
                    .state
                    .upbringing
                    .as_ref()
                    .is_some_and(|s| !s.act.done.iter().any(|d| matches!(d.action, ActAction::Rumor)))
                    && let Some(place) = self
                        .act_places()
                        .iter()
                        .find(|p| self.act_place_actions(&p.key).iter().any(|a| a.kind == "rumor" && a.enabled))
                        .map(|p| p.key.clone())
                {
                    Command::DoAction { owner, place, action: ActAction::Rumor }.apply(self)?;
                    return Ok(true);
                }
                let fatigued = self.act_ill() || self.state.upbringing.as_ref().is_some_and(|s| s.fatigue >= 50);
                let rest = self
                    .act_places()
                    .iter()
                    .find(|p| self.act_place_actions(&p.key).iter().any(|a| a.kind == "rest" && a.enabled))
                    .map(|p| p.key.clone());
                if fatigued && let Some(place) = rest {
                    Some(Command::DoAction { owner, place, action: ActAction::Rest })
                } else {
                    let job = self.act_places().iter().filter(|p| self.upbringing_place_open(p)).find_map(|p| {
                        self.act_job_tier(&p.key)
                            .into_iter()
                            .find(|a| {
                                self.act_action_problem(&p.key, &ActAction::Job { activity: a.key.clone() }).is_ok()
                            })
                            .map(|a| (p.key.clone(), a.key.clone()))
                    });
                    job.map(|(place, activity)| Command::DoAction { owner, place, action: ActAction::Job { activity } })
                        .or(Some(Command::EndFree { owner }))
                }
            }
            _ => None,
        };
        if let Some(command) = command {
            command.apply(self)?;
            Ok(true)
        } else {
            Ok(false)
        }
    }
}
