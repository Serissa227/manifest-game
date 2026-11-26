//! 三档结果、关键时刻与按周生病。
use super::*;
use settlement::ActScale;
impl World {
    pub fn act_ill(&self) -> bool {
        self.state.upbringing.as_ref().is_some_and(|s| s.act.ill_until_week.is_some_and(|w| s.act.week <= w))
    }
    pub fn act_fail_bp(&self, a: &ActivityDef) -> i64 {
        let r = self.act_rules().cloned().unwrap_or_default();
        (self.upbringing_risk(a)
            + if self.state.upbringing.as_ref().is_some_and(|s| s.fatigue >= r.result.fail_tired) {
                r.result.fail_tired_bp
            } else {
                0
            })
        .clamp(0, 10000)
    }
    pub fn act_great_bp(&self, with: bool) -> i64 {
        let r = self.act_rules().cloned().unwrap_or_default();
        (r.result.great_bp
            + if self.state.upbringing.as_ref().is_some_and(|s| s.mood >= r.mood_factor.high) {
                r.result.great_mood_bp
            } else {
                0
            }
            + if with { r.result.great_with_bp } else { 0 })
        .clamp(0, 10000)
    }
    pub fn act_moment_test(&self, line: &LineDef, pick: MomentPick) -> (String, i64, i64, i64) {
        let r = self.act_rules().cloned().unwrap_or_default();
        let attr = if pick == MomentPick::Clever { self.act_root(line) } else { line.attr.as_deref() }.unwrap_or("");
        let have = self.upbringing_projected(attr);
        let family = self.upbringing_family();
        let month = family
            .and_then(|f| f.stages.first())
            .map_or(0, |s| ((self.cast_date()[0] - s.from[0]) * 12 + self.cast_date()[1] - s.from[1]) as usize);
        let need = self
            .defs
            .upbringing
            .act_medians
            .iter()
            .find(|m| family.is_some_and(|f| m.family == f.key) && m.attr == attr)
            .and_then(|m| m.levels.get(month))
            .copied()
            .unwrap_or(have)
            + 1;
        let max = if pick == MomentPick::Clever { r.moment.clever_max_pct } else { r.moment.risky_max_pct };
        let chance = crate::story2::dice::curve_chance(&self.defs.rules.story.attr_curve, have, need).min(max);
        (attr.into(), have, need, chance)
    }
    pub(super) fn act_start_moment(&mut self) {
        if self.act_ill() || self.act_sailing() {
            return;
        }
        let Some(s) = &self.state.upbringing else { return };
        let week = s.act.week;
        if s.act.moment_last_week == Some(week) {
            return;
        }
        let r = self.act_rules().cloned().unwrap_or_default();
        let start = self
            .upbringing_family()
            .and_then(|f| f.stages.first())
            .and_then(|s| crate::scenario::day_of(&self.defs, s.from).ok())
            .map_or(0, |d| week_index(&self.defs, d));
        let forced = week.saturating_sub(s.act.moment_last_week.unwrap_or(start)) >= r.moment.pity_weeks;
        let candidates: Vec<_> = self
            .act_lesson_days()
            .iter()
            .enumerate()
            .filter(|(_, d)| u32::from(**d) >= self.act_day())
            .map(|(i, d)| (i as u8, *d))
            .collect();
        let mut rng = self.upbringing_rng(&format!("act:moment:{week}"), 0, 0);
        if !candidates.is_empty() && (forced || rng.chance_bp(r.moment.chance_pct * 100)) {
            let (slot, day) = candidates[rng.range(0, candidates.len() as i64 - 1) as usize];
            if let Some(s) = &mut self.state.upbringing {
                s.act.moment = Some(MomentState { week, slot, day, pick: None });
                s.act.moment_last_week = Some(week);
            }
        }
        self.act_pause_moment();
    }
    pub(super) fn act_pause_moment(&mut self) {
        let day = self.act_day();
        if let Some(s) = &mut self.state.upbringing
            && s.act.phase == ActPhase::Lessons
            && s.act
                .moment
                .as_ref()
                .is_some_and(|m| m.week == s.act.week && u32::from(m.day) == day && m.pick.is_none())
        {
            s.act.phase = ActPhase::Moment;
        }
    }
    pub(super) fn act_answer_moment(&mut self, pick: MomentPick) -> Result<(), CommandError> {
        if self.act_phase() != ActPhase::Moment {
            return Err(reason("ub.act.moment"));
        }
        if let Some(s) = &mut self.state.upbringing
            && let Some(m) = &mut s.act.moment
        {
            m.pick = Some(pick);
            s.act.phase = ActPhase::Lessons;
        }
        Ok(())
    }
    pub(crate) fn settle_act_lesson(
        &mut self,
        line: &LineDef,
        plan: &LessonPlan,
        index: u8,
        self_study: bool,
        result: &mut SlotResult,
    ) -> Result<Vec<String>, CoreError> {
        if self.act_ill() {
            if let Some(s) = &mut self.state.upbringing {
                s.act.outcomes.push(LessonOutcome {
                    slot: index,
                    grade: LessonGrade::Ill,
                    moment: None,
                    moment_ok: None,
                });
            }
            return Ok(Vec::new());
        }
        let r = self.act_rules().cloned().unwrap_or_default();
        let a = self
            .defs
            .upbringing
            .activity(&line.tiers[usize::from(plan.tier)].activity)
            .cloned()
            .ok_or_else(|| internal("课线活动不存在"))?;
        let companion =
            plan.with.as_deref().filter(|p| !self_study && self.act_presence(p) == Some(line.place.as_str()));
        let with = companion.is_some();
        let moment = (!self_study)
            .then(|| {
                self.state.upbringing.as_ref().and_then(|s| s.act.moment.as_ref()).filter(|m| m.slot == index).cloned()
            })
            .flatten();
        let pick = moment.as_ref().and_then(|m| m.pick);
        let fail = !self_study
            && pick != Some(MomentPick::Steady)
            && self.upbringing_rng(&a.key, index, 0).chance_bp(self.act_fail_bp(&a));
        let great = !self_study
            && !fail
            && self.upbringing_rng(&format!("crit:{}", a.key), index, 0).chance_bp(self.act_great_bp(with));
        let grade = if fail {
            LessonGrade::Fail
        } else if great {
            LessonGrade::Great
        } else {
            LessonGrade::Ok
        };
        let grade_pct = if fail {
            r.result.fail_pct
        } else if great {
            r.result.great_pct
        } else {
            100
        };
        let mut moment_pct = 100;
        let mut moment_ok = None;
        if let Some(pick) = pick {
            if pick == MomentPick::Steady {
                moment_pct = r.moment.steady_pct;
            } else {
                let chance = self.act_moment_test(line, pick).3;
                let week = moment.as_ref().map_or(0, |m| m.week);
                let ok = self.upbringing_rng(&format!("act:moment:{week}"), index, 1).chance_bp(chance * 100);
                moment_ok = Some(ok);
                if pick == MomentPick::Risky {
                    moment_pct = if ok { r.moment.risky_win_pct } else { r.moment.risky_lose_pct };
                    if ok {
                        if let Some(p) = &line.mentor {
                            self.act_affinity(p, r.moment.risky_bond, result).map_err(internal)?;
                        }
                    } else {
                        self.act_meters(r.moment.risky_fatigue, 0, result);
                    }
                }
            }
        }
        let mut base = a.clone();
        base.gains.clear();
        base.skills.clear();
        base.failure.extra_fatigue = 0;
        let mut scale = if self_study { ActScale::self_study(&r) } else { ActScale::lesson(&r, plan.tier) };
        scale.fee = Some(if self_study || self.act_sailing() { 0 } else { self.act_tier_fee(line, plan.tier) });
        scale.voyage_task = !self_study && self.act_sailing();
        scale.success = Some(!fail);
        let events = self.settle_upbringing_activity_scaled(&base, index, 0, scale, result)?;
        let mut g = r.tier_yield[usize::from(plan.tier)] * 10 * self.act_efficiency(line, &a, companion) / 100
            * grade_pct
            / 100
            * moment_pct
            / 100;
        if self_study {
            g = g * r.self_study_pct / 100;
        }
        let mut main = g;
        let mut side = g * r.side_pct / 100;
        if pick == Some(MomentPick::Clever) && moment_ok == Some(true) {
            let convert = g * r.moment.clever_pct / 100;
            main -= convert;
            if line.clever.as_deref() == Some("cash") || line.side.is_none() {
                let cash = convert * r.moment.clever_cash_per_point / 1000;
                self.act_income(cash)?;
                result.cash += cash;
            } else {
                side += convert;
            }
        }
        let cap = if self_study { 100 } else { r.ladder.cap_pct_by_tier[usize::from(plan.tier)] };
        if let Some(attr) = &line.attr {
            self.act_gain_milli(attr, main, cap, result);
        }
        if let Some(attr) = &line.side {
            self.act_gain_milli(attr, side, cap, result);
        }
        if let Some(skill) = &line.skill {
            let xp = self.act_carry(&format!("skill:{skill}"), g * r.skill_pct / 100, 1);
            *self.state.items.owners.entry(OwnerId::Player).or_default().skill_xp.entry(skill.clone()).or_default() +=
                xp;
            *result.skills.entry(skill.clone()).or_default() += xp;
        }
        if !self_study && let Some(s) = &mut self.state.upbringing {
            s.act.outcomes.push(LessonOutcome { slot: index, grade, moment: pick, moment_ok });
        }
        Ok(events)
    }
    fn act_gain_milli(&mut self, attr: &str, g: i64, cap: i64, result: &mut SlotResult) {
        let n = self.act_carry(&format!("growth:{attr}"), g, 1);
        *result.growth.entry(attr.into()).or_default() += self.gain_upbringing_growth_with_cap_pct(attr, n, cap);
    }
    pub(super) fn act_income(&mut self, cash: i64) -> Result<(), CoreError> {
        if cash <= 0 {
            return Ok(());
        }
        let loc = self.upbringing_location().ok_or_else(|| internal("养成收入缺少地点"))?;
        self.book_external(
            OwnerId::Player,
            crate::treasury::Flow::Other,
            self.town_sector(loc),
            crate::ledger::JournalEntry::new(
                self.day(),
                crate::ledger::Memo::Other,
                crate::ledger::CashClass::Operating,
            )
            .dr(crate::ledger::Account::Cash, cash)
            .cr(crate::ledger::Account::OtherIncome, cash),
        )
        .map(|_| ())
    }
    pub fn act_ill_chance(&self, fatigue: i64) -> i64 {
        let r = self.act_rules().cloned().unwrap_or_default();
        if fatigue < r.illness.at { 0 } else { ((fatigue - r.illness.base) * r.illness.pct_per_point).clamp(0, 100) }
    }
    pub(super) fn act_week_illness(&mut self) -> bool {
        if self.act_ill() {
            return false;
        }
        let Some(s) = &self.state.upbringing else { return false };
        let week = s.act.week;
        if !self.upbringing_rng(&format!("act:ill:{week}"), 0, 0).chance_bp(self.act_ill_chance(s.fatigue) * 100) {
            return false;
        }
        let r = self.act_rules().cloned().unwrap_or_default();
        let next = self.act_week_date(week + 1, false);
        let until = crate::scenario::day_of(&self.defs, next).ok().map(|d| d + 7 * r.illness.weeks);
        if let Some(s) = &mut self.state.upbringing {
            s.act.ill_until_week = Some(week + r.illness.weeks);
            s.ill_until = until;
        }
        let events = self.defs.upbringing.rules.illness_events.clone();
        self.trigger_cadence_events(&events, &SlotResult::default());
        true
    }
}
