use super::*;
use crate::story2::deeds::Deed;

impl World {
    /// 开档只认既有活动的门槛；现金、课表内的月次数另查，不能让缺钱隐藏新档。
    pub fn act_tier_open(&self, line: &LineDef, tier: u8) -> bool {
        if let Some(voyage) = self.state.upbringing.as_ref().and_then(|s| s.act.voyage.as_ref())
            && voyage.plan.iter().any(|p| p.line == line.key && p.tier == tier)
        {
            // 船上承接出发时已开的档，不再以岸上设施或当前学院筛掉。
            return true;
        }
        if self.act_ladder_on() {
            return self.act_line_here(line)
                && line.tiers.get(usize::from(tier)).is_some()
                && self.act_tier_status(line, tier).missing.is_empty();
        }
        self.act_line_here(line)
            && line
                .tiers
                .get(usize::from(tier))
                .and_then(|t| self.defs.upbringing.activity(&t.activity))
                .is_some_and(|a| self.act_activity_open(a))
    }
    pub fn act_activity_open(&self, activity: &ActivityDef) -> bool {
        if self.act_ladder_on() {
            return if activity.kind == ActivityKind::Job {
                self.act_job_open(activity)
            } else {
                self.act_activity_structural(activity, self.cast_date())
            };
        }
        let mut activity = activity.clone();
        // 只忽略学费与累计月限次；普通查询不为每张卡复制整个世界。
        activity.cost = 0;
        activity.monthly_limit = None;
        if self.act_cash() < 0 {
            let mut probe = self.clone();
            if let Some(p) = probe.state.agents.get_mut(&OwnerId::Player) {
                p.cash = 0;
            }
            probe.upbringing_activity_available(&activity, self.cast_date()).is_ok()
        } else {
            self.upbringing_activity_available(&activity, self.cast_date()).is_ok()
        }
    }
    pub fn act_default_lessons(&self) -> Vec<LessonPlan> {
        let Some(f) = self.upbringing_family() else { return Vec::new() };
        self.defs
            .upbringing
            .act_timetables
            .iter()
            .find(|t| t.family == f.key && stage_key(t.stage, &t.academy) == self.act_stage_key())
            .map_or_else(Vec::new, |t| t.slots.clone())
    }
    pub fn act_lesson_fee(&self, activity: &ActivityDef) -> i64 {
        if self.act_sailing() {
            return 0;
        }
        let p = self.act_rules().map_or(100, |r| r.lesson_permille);
        (self.upbringing_activity_cost(activity).saturating_mul(p) + 999) / 1000
    }
    pub fn act_fee_week(&self) -> i64 {
        if self.act_sailing() {
            return 0;
        }
        if self.act_ladder_on() {
            if self.act_ill() {
                return 0;
            }
            return self
                .act_lesson_plan()
                .iter()
                .enumerate()
                .filter(|(i, _)| self.act_lesson_days().get(*i).is_some_and(|d| u32::from(*d) >= self.act_day()))
                .filter_map(|(_, p)| {
                    self.defs.upbringing.lines.iter().find(|l| l.key == p.line).map(|l| self.act_tier_fee(l, p.tier))
                })
                .sum::<i64>()
                + self.act_tool_dues().values().sum::<i64>();
        }
        self.act_lesson_plan()
            .iter()
            .enumerate()
            .filter(|(i, _)| self.act_lesson_days().get(*i).is_some_and(|d| u32::from(*d) >= self.act_day()))
            .filter_map(|(_, p)| {
                self.defs
                    .upbringing
                    .lines
                    .iter()
                    .find(|l| l.key == p.line)
                    .and_then(|l| l.tiers.get(usize::from(p.tier)))
                    .and_then(|t| self.defs.upbringing.activity(&t.activity))
            })
            .map(|a| self.act_lesson_fee(a))
            .sum()
    }
    pub fn act_fatigue_week_x10(&self) -> i64 {
        if self.act_ill() {
            return 0;
        }
        let Some(r) = self.act_rules() else { return 0 };
        self.act_lesson_plan()
            .iter()
            .enumerate()
            .filter(|(i, _)| self.act_lesson_days().get(*i).is_some_and(|d| u32::from(*d) >= self.act_day()))
            .map(|(_, p)| r.fatigue.get(usize::from(p.tier)).copied().unwrap_or(0))
            .sum()
    }
    pub fn act_lessons_problem(&self, slots: &[LessonPlan]) -> Result<(), CommandError> {
        if self.act_sailing() {
            return Ok(());
        }
        let need = self.act_lesson_days().len();
        if slots.len() != need {
            return Err(crate::error::Reason::new("ub.act.slots", "（待写）")
                .arg("need", crate::text::TextArg::Int(need as i64))
                .arg("have", crate::text::TextArg::Int(slots.len() as i64))
                .rule());
        }
        let mut with = 0;
        let mut monthly = BTreeMap::<String, usize>::new();
        for (i, plan) in slots.iter().enumerate() {
            let line = self
                .defs
                .upbringing
                .lines
                .iter()
                .find(|l| l.key == plan.line && self.act_line_here(l))
                .ok_or_else(|| argument("ub.act.line", "slot", i as i64))?;
            let tier =
                line.tiers.get(usize::from(plan.tier)).ok_or_else(|| argument("ub.act.tier", "slot", i as i64))?;
            if u32::from(self.act_lesson_days()[i]) < self.act_day() {
                continue;
            }
            if !self.act_ill() && !self.act_tier_open(line, plan.tier) {
                return Err(argument("ub.act.tier", "slot", i as i64));
            }
            if self.act_ill() {
                continue;
            }
            if let Some(person) = &plan.with {
                with += 1;
                if with > 1 {
                    return Err(argument("ub.act.with", "slot", i as i64));
                }
                if self.act_presence(person) != Some(line.place.as_str()) {
                    return Err(argument("ub.act.absent", "slot", i as i64));
                }
                if let Some(e) = self.cadence_outing_problem(1) {
                    return Err(reason(e));
                }
            }
            if let Some(a) = self.defs.upbringing.activity(&tier.activity)
                && let Some(limit) = a.monthly_limit
            {
                let group = a.monthly_limit_group.as_deref().unwrap_or(&a.key);
                let n = monthly.entry(group.into()).or_insert_with(|| self.upbringing_monthly_used(group));
                *n += 1;
                if *n > limit as usize {
                    return Err(argument("ub.act.monthly_limit", "slot", i as i64));
                }
            }
        }
        Ok(())
    }
    fn act_note_plan(&mut self, slots: &[LessonPlan]) {
        for (index, plan) in slots.iter().enumerate() {
            if self.act_lesson_days().get(index).is_none_or(|day| u32::from(*day) < self.act_day()) {
                continue;
            }
            let first = self.state.upbringing.as_mut().is_some_and(|s| {
                let line = s.act.lines.entry(plan.line.clone()).or_default();
                let first = line.used & (1 << plan.tier) == 0;
                line.used |= 1 << plan.tier;
                first
            });
            if first {
                self.record_deed(Deed::UbTierUp, 1);
                if plan.tier >= 2 {
                    self.record_deed(Deed::UbTierOpen, 1);
                }
            }
        }
    }
    pub(super) fn apply_act_command(&mut self, command: &Command) -> Result<(), CommandError> {
        match command {
            Command::PlanLessons { slots, .. } => {
                if self.act_sailing() {
                    return Err(reason("ub.act.voyage"));
                }
                self.act_require_phase(ActPhase::Plan)?;
                self.act_lessons_problem(slots)?;
                self.act_note_plan(slots);
                let key = self.act_stage_key();
                if let Some(s) = &mut self.state.upbringing {
                    s.act.timetables.insert(key, slots.clone());
                }
            }
            Command::StartWeek { .. } => {
                self.act_require_phase(ActPhase::Plan)?;
                self.act_lessons_problem(self.act_lesson_plan())?;
                let need = self.act_fee_week();
                let have = self.act_cash();
                if need > have {
                    return Err(crate::error::Reason::new("ub.act.fee", "（待写）")
                        .arg("need", crate::text::TextArg::Int(need))
                        .arg("have", crate::text::TextArg::Int(have))
                        .rule());
                }
                let dues = self.act_tool_dues();
                self.act_pay(dues.values().sum()).map_err(|e| CommandError::Internal(e.to_string()))?;
                if let Some(s) = &mut self.state.upbringing {
                    for ((line, tier), _) in dues {
                        s.act.lines.entry(line).or_default().paid |= 1 << tier;
                    }
                }
                let open: Vec<_> = self
                    .defs
                    .upbringing
                    .lines
                    .iter()
                    .filter(|l| self.act_line_here(l))
                    .map(|l| {
                        let mask = (0..l.tiers.len())
                            .filter(|t| self.act_tier_status(l, *t as u8).missing.iter().all(|k| k == "master"))
                            .fold(0, |mask, t| mask | (1 << t));
                        (l.key.clone(), mask)
                    })
                    .collect();
                let phase = if self.act_day() == 6 { ActPhase::Free } else { ActPhase::Lessons };
                if let Some(s) = &mut self.state.upbringing {
                    for (key, mask) in open {
                        s.act.lines.entry(key).or_default().seen |= mask;
                    }
                    s.act.phase = phase;
                }
                self.act_start_moment();
            }
            Command::CloseWeek { .. } => {
                self.act_require_phase(ActPhase::Summary)?;
                if let Some(s) = &mut self.state.upbringing {
                    s.act.phase = ActPhase::Plan;
                }
            }
            Command::EndFree { .. } => {
                self.act_require_phase(ActPhase::Free)?;
                if let Some(s) = &mut self.state.upbringing {
                    s.act.points = 0;
                    s.act.phase = ActPhase::Lessons;
                }
            }
            Command::AnswerMoment { pick, .. } => self.act_answer_moment(*pick)?,
            Command::MasterTest { line, play, .. } => self.act_master_test(line, *play)?,
            Command::JoinVoyage { voyage, .. } => self.act_join_voyage(voyage)?,
            Command::DoAction { place, action, .. } => self.act_do_action(place, action)?,
            Command::FamilyDuty { duty, .. } => self.act_do_duty(duty)?,
            Command::SaveTemplate { slot, kind, .. } => self.act_save_template(*slot, *kind)?,
            Command::UseTemplate { slot, kind, .. } => self.act_use_template(*slot, *kind)?,
            _ => return Err(reason("ub.act.off")),
        }
        Ok(())
    }
    fn act_save_template(&mut self, slot: u8, kind: TemplateKind) -> Result<(), CommandError> {
        let max = self.act_rules().map_or(3, |r| r.templates);
        match kind {
            TemplateKind::Lessons => {
                let key = self.act_stage_key();
                // 海上仍可保存原来的岸上课表，不把三格船课写成五／七格模板。
                let plan = self
                    .state
                    .upbringing
                    .as_ref()
                    .and_then(|s| s.act.timetables.get(&key))
                    .cloned()
                    .unwrap_or_default();
                let count = self.act_rules().map_or(0, |r| {
                    if self.upbringing_academy().is_some() { r.lessons.academy } else { r.lessons.home }
                });
                if slot >= max || plan.len() != usize::from(count) {
                    return Err(reason("ub.act.template"));
                }
                if let Some(s) = &mut self.state.upbringing {
                    let templates = s.act.templates.entry(key).or_default();
                    templates.resize(usize::from(max), Vec::new());
                    templates[usize::from(slot)] = plan;
                }
            }
            TemplateKind::Free => {
                if slot != 0
                    || self.act_sailing()
                    || !matches!(self.act_phase(), ActPhase::Free | ActPhase::Lessons)
                    || self.act_day() < 6
                    || self.act_day() > 7
                {
                    return Err(reason("ub.act.template"));
                }
                let steps: Vec<_> = self
                    .state
                    .upbringing
                    .iter()
                    .flat_map(|s| &s.act.done)
                    .filter(|d| d.cost > 0 || matches!(d.action, ActAction::Duty { .. }))
                    .filter_map(|d| {
                        let action = if matches!(d.action, ActAction::Marker { .. }) {
                            ActAction::Talk { person: d.visit.clone()? }
                        } else {
                            d.action.clone()
                        };
                        self.act_normalize_free_step(&FreeStep { place: d.place.clone(), action })
                    })
                    .collect();
                if !steps.iter().any(|s| s.action.cost() > 0) {
                    return Err(reason("ub.act.template"));
                }
                let key = self.act_stage_key();
                if let Some(s) = &mut self.state.upbringing {
                    s.act.free_templates.insert(key, steps);
                }
            }
        }
        Ok(())
    }
    fn act_use_template(&mut self, slot: u8, kind: TemplateKind) -> Result<(), CommandError> {
        match kind {
            TemplateKind::Lessons => {
                self.act_require_phase(ActPhase::Plan)?;
                if self.act_sailing() {
                    return Err(reason("ub.act.voyage"));
                }
                let plan = self
                    .state
                    .upbringing
                    .as_ref()
                    .and_then(|s| s.act.templates.get(&self.act_stage_key()))
                    .and_then(|t| t.get(usize::from(slot)))
                    .filter(|t| !t.is_empty())
                    .cloned()
                    .ok_or_else(|| reason("ub.act.template"))?;
                self.apply_act_command(&Command::PlanLessons { owner: OwnerId::Player, slots: plan })?;
            }
            TemplateKind::Free => {
                self.act_require_phase(ActPhase::Free)?;
                if self.act_sailing() {
                    return Ok(());
                }
                let steps = self.act_free_template().to_vec();
                if slot != 0 || steps.is_empty() {
                    return Err(reason("ub.act.template"));
                }
                let next = self.act_free_template_next();
                for (i, step) in steps.iter().enumerate().skip(next) {
                    if self.act_ill() && !matches!(step.action, ActAction::Rest)
                        || self.act_story_waiting()
                        || self.state.upbringing.as_ref().is_some_and(|s| s.act.points == 0)
                    {
                        break;
                    }
                    let mut probe = self.clone();
                    let result = if let ActAction::Duty { duty } = &step.action {
                        if self.state.upbringing.as_ref().is_some_and(|s| s.act.duty_week == Some(s.act.week)) {
                            continue;
                        }
                        probe.act_do_duty(duty)
                    } else {
                        self.act_free_step_action(step).and_then(|action| probe.act_do_action(&step.place, &action))
                    };
                    if let Err(e) = result {
                        if let Some(s) = &mut self.state.upbringing {
                            s.act.free_skipped.push(FreeSkip {
                                step: i as u8,
                                plan: step.clone(),
                                reason: e.code().into(),
                                args: e.args().into_iter().map(|(key, value)| (key.into(), value)).collect(),
                            });
                        }
                        continue;
                    }
                    self.state = probe.state;
                    if let Some(s) = &mut self.state.upbringing {
                        s.act.free_applied += 1;
                    }
                }
            }
        }
        self.record_deed(Deed::UbTemplate, 1);
        Ok(())
    }
}
pub fn stage_key(stage: Stage, academy: &str) -> String {
    if stage == Stage::Home { "home".into() } else { format!("academy:{academy}") }
}
