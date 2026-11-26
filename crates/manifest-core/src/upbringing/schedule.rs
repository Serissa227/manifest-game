//! 上旬 1–10 日、中旬 11–20 日、下旬 21 日至月末；结算由日末调用一次。
use super::*;
use crate::{
    CommandError, CoreError, OwnerId, World,
    cast::CastPlace,
    log::{LogEvent, LogKind},
    scenario::ProtagonistIdentity,
};

pub fn bounds(month_days: u32, index: u8) -> Option<[u32; 2]> {
    match index {
        0 if month_days >= 21 => Some([1, 10]),
        1 if month_days >= 21 => Some([11, 20]),
        2 if month_days >= 21 => Some([21, month_days]),
        _ => None,
    }
}
pub fn slot_of(day: u32) -> u8 {
    if day <= 10 {
        0
    } else if day <= 20 {
        1
    } else {
        2
    }
}
fn blocked(s: &str) -> CommandError {
    CommandError::Precondition(s.into())
}

impl World {
    pub fn upbringing_active(&self) -> bool {
        self.state.upbringing.as_ref().is_some_and(|s| {
            s.phase != Phase::Done
                && self.defs.upbringing.family(&s.family).is_some()
                && self.defs.scenarios.get(self.state.scenario.idx()).is_some_and(|s| s.upbringing)
        })
    }
    pub fn upbringing_waiting(&self) -> bool {
        self.upbringing_active()
            && !self.upbringing_skipping()
            && !self.upbringing_graduation_ready()
            && self.state.upbringing.as_ref().is_some_and(|s| {
                s.phase != Phase::Done
                    && (s.phase != Phase::Running
                        || !self.state.story2.pending.is_empty()
                        || self.state.story.pending.is_some()
                        || self.act_waiting())
            })
    }
    pub fn upbringing_family(&self) -> Option<&FamilyDef> {
        self.upbringing_family_in(&self.defs.upbringing)
    }
    /// 本局的家庭在给定数据里的那一份（换了语言的显示数据也用它）：家乡期选了改投路线的，取那条路线派生的家庭。
    pub fn upbringing_family_in<'d>(&self, defs: &'d UpbringingDefs) -> Option<&'d FamilyDef> {
        let s = self.state.upbringing.as_ref()?;
        defs.family(&s.family).map(|f| f.routed_by(|flag| self.upbringing_flag(flag)))
    }
    pub fn upbringing_stage_on(&self, date: crate::scenario::WorldDate) -> Option<&StageDef> {
        self.upbringing_family()?.stages.iter().rev().find(|s| {
            s.from <= date
                && (self.upbringing_skipping() || s.entry_flag.as_ref().is_none_or(|f| self.upbringing_flag(f)))
        })
    }
    pub(crate) fn init_upbringing(&mut self) -> Result<(), CoreError> {
        let scenario = &self.defs.scenarios[self.state.scenario.idx()];
        if !scenario.upbringing {
            return Ok(());
        }
        let identity = self.state.protagonist.as_ref().and_then(|p| p.protagonist.as_deref());
        let template = self.state.protagonist.as_ref().and_then(|p| p.template.as_deref());
        let family = self
            .defs
            .upbringing
            .families
            .iter()
            .find(|f| {
                f.scenario == scenario.key
                    && identity.is_none_or(|p| f.protagonists.is_empty() || f.protagonists.iter().any(|v| v == p))
                    && template.is_none_or(|t| f.templates.iter().any(|v| v == t))
            })
            .cloned()
            .ok_or_else(|| CoreError::InvalidStart("养成剧本缺少对应家庭".into()))?;
        if self.state.upbringing.as_ref().is_some_and(|s| s.family == family.key) {
            return Ok(());
        }
        let date = self.cast_date();
        let stage = family
            .stages
            .iter()
            .rev()
            .find(|s| s.from <= date)
            .ok_or_else(|| CoreError::InvalidStart("养成开局不在阶段日期内".into()))?;
        let at = self
            .defs
            .locations
            .iter()
            .position(|l| l.key == stage.at)
            .ok_or_else(|| CoreError::InvalidStart("养成地点不存在".into()))?;
        if self.state.protagonist.is_none() {
            self.state.protagonist = Some(ProtagonistIdentity {
                protagonist: None,
                template: None,
                born: family.born,
                gender: family.gender,
            });
        }
        self.state.cast.place = Some(CastPlace { loc: crate::LocId::from_idx(at), venue: String::new() });
        let home = self
            .defs
            .locations
            .iter()
            .position(|l| l.key == family.home)
            .map(crate::LocId::from_idx)
            .ok_or_else(|| CoreError::InvalidStart("家乡不存在".into()))?;
        self.agent_mut(OwnerId::Player).map_err(|e| CoreError::InvalidStart(e.to_string()))?.home = home;
        self.state.cast.academy = stage.stage == Stage::Academy;
        let mood = self.defs.upbringing.rules.mood.as_ref().map_or(0, |r| r.center);
        self.state.upbringing = Some(UpbringingState {
            family: family.key,
            mood,
            month: [date[0], date[1]],
            next_slot: slot_of(date[2]),
            ..Default::default()
        });
        // U05：规则写了按周的世界，新开的局从第一天起就按周。
        self.enter_weekly();
        self.enter_act();
        self.init_upbringing_growth();
        self.prepare_cadence_week();
        self.refresh_upbringing_stage();
        if self.upbringing_cadence_enabled() {
            let today = self.day();
            if let Some(s) = &mut self.state.upbringing {
                s.event_day = Some(today);
            }
            self.queue_upbringing_events();
        }
        self.refresh_upbringing_goals()?;
        self.refresh_upbringing_unlocks(true);
        Ok(())
    }
    pub fn check_month_plan(&self, owner: OwnerId, slots: &[PlanSlot]) -> Result<(), CommandError> {
        if owner != OwnerId::Player {
            return Err(CommandError::NotOwner);
        }
        let s = self.state.upbringing.as_ref().ok_or_else(|| blocked("当前不是养成阶段"))?;
        if self.upbringing_weekly() {
            return Err(blocked("本月按周排程，请提交周程"));
        }
        if s.phase != Phase::Plan || !s.plan.is_empty() {
            return Err(blocked("本月日程已提交"));
        }
        if slots.len() != 3 {
            return Err(blocked("月程必须有且只有三旬"));
        }
        if usize::from(s.outings)
            + slots
                .iter()
                .skip(usize::from(s.next_slot))
                .filter(|p| p.after.as_ref().is_some_and(|c| c.companion.is_some()))
                .count()
            > 2
        {
            return Err(blocked("每月最多两次课后同行"));
        }
        let mut monthly = BTreeMap::<String, usize>::new();
        for (index, slot) in slots.iter().enumerate() {
            if slot.index as usize != index {
                return Err(blocked("旬索引必须按 0、1、2 排列"));
            }
            if index < usize::from(s.next_slot) {
                continue;
            }
            let date = [s.month[0], s.month[1], 1 + index as u32 * 10].max(self.cast_date());
            let stage = self
                .upbringing_stage_on(date)
                .or_else(|| self.upbringing_stage_on(self.cast_date()))
                .ok_or_else(|| blocked("阶段日期无效"))?
                .stage;
            if (stage == Stage::Academy) != slot.lesson.is_some() || slot.after.is_none() {
                return Err(blocked("家乡每旬一格，学院每旬须有课业和课后两格"));
            }
            for (key, lesson) in
                slot.lesson.iter().map(|k| (k, true)).chain(slot.after.iter().map(|a| (&a.activity, false)))
            {
                let activity = self.defs.upbringing.activity(key).ok_or_else(|| CommandError::NotFound(key.clone()))?;
                if let Some(limit) = activity.monthly_limit {
                    let group = activity.monthly_limit_group.as_deref().unwrap_or(&activity.key);
                    let used = monthly.entry(group.into()).or_insert_with(|| self.upbringing_monthly_used(group));
                    *used += 1;
                    if *used > limit as usize {
                        return Err(blocked("月程超过活动次数限制"));
                    }
                }
                self.check_upbringing_choice(activity, if lesson { None } else { slot.after.as_ref() }, date)?;
                if !activity.stage.allows(stage)
                    || (lesson && activity.kind != ActivityKind::Lesson)
                    || (!lesson && stage == Stage::Academy && activity.kind == ActivityKind::Lesson)
                {
                    return Err(blocked("活动不适用于本旬或栏目"));
                }
            }
        }
        Ok(())
    }
    pub(crate) fn apply_month_plan(&mut self, slots: Vec<PlanSlot>) {
        if let Some(s) = &mut self.state.upbringing {
            s.plan = slots;
            s.phase = Phase::Running;
            if s.next_slot == 0 {
                s.last.clear();
            }
        }
        self.register_planned_contests();
        self.prepare_upbringing_reading();
        self.prepare_training_fleet();
    }
    pub(crate) fn finish_upbringing_day(&mut self) -> Result<(), CoreError> {
        if self.act_running() {
            return self.finish_act_day();
        }
        let Some(s) = self.state.upbringing.as_ref() else {
            return Ok(());
        };
        if self.upbringing_weekly() {
            return self.finish_week_day();
        }
        if s.skipping || s.phase != Phase::Running || s.next_slot >= 3 {
            return Ok(());
        }
        let date = self.cast_date();
        let days = u32::from(self.defs.calendar.months()[date[1] as usize - 1]);
        let index = s.next_slot;
        if bounds(days, index).is_none_or(|b| date[2] != b[1]) || s.settled.contains(&(s.month, index)) {
            return Ok(());
        }
        let slot = s.plan.get(index as usize).cloned().ok_or_else(|| CoreError::Internal("月程缺少待结算旬".into()))?;
        let mut result = SlotResult { index, ..Default::default() };
        let mut events = Vec::new();
        for (column, key) in slot.lesson.iter().chain(slot.after.iter().map(|a| &a.activity)).enumerate() {
            let a = self
                .defs
                .upbringing
                .activity(key)
                .cloned()
                .ok_or_else(|| CoreError::Internal("月程活动已失效".into()))?;
            if !result.title.is_empty() {
                result.title.push_str(" / ");
            }
            result.title.push_str(&a.name);
            result.activities.push(a.key.clone());
            result.scene = a.scene.clone();
            let previous_success = result.success.take();
            let choice = slot.after.as_ref().filter(|c| c.activity == a.key);
            if self.upbringing_activity_available(&a, self.cast_date()).is_ok()
                && let Some(choice) = choice
                && !self.settle_local_choice(&a, choice, index, &mut result)?
            {
                continue;
            }
            events.extend(self.settle_upbringing_activity(&a, index, column as u8, &mut result)?);
            if result.success != Some(false)
                && let Some(choice) = choice
            {
                events.extend(self.settle_excursion(choice, index, &mut result)?);
                if let Some(place) =
                    choice.place.as_ref().and_then(|key| self.upbringing_places().iter().find(|p| &p.key == key))
                {
                    events.extend(place.events.iter().cloned());
                }
            }
            result.success = Some(previous_success.unwrap_or(true) && result.success.unwrap_or(true));
        }
        events.extend(self.settle_upbringing_mood_slot(&mut result));
        self.refresh_upbringing_goals()?;
        self.refresh_upbringing_unlocks(false);
        if let Some(s) = &mut self.state.upbringing {
            s.settled.insert((s.month, index));
            s.next_slot += 1;
            s.journal.push(super::JournalEntry { day: self.state.day, result: result.clone() });
            s.last.push(result);
            for event in events {
                if !s.event_backlog.contains(&event) {
                    s.event_backlog.push(event);
                }
            }
        }
        if let Some(s) = &mut self.state.upbringing {
            s.event_day = Some(self.state.day.saturating_add(1));
        }
        self.return_training_fleet();
        self.push_log(LogEvent {
            day: self.day(),
            kind: LogKind::UpbringingSettled { month: [date[0], date[1]], slot: index },
        });
        Ok(())
    }
    pub(crate) fn new_upbringing_day(&mut self) -> Result<(), CoreError> {
        let date = self.cast_date();
        let weekly_rules = self.defs.rules.upbringing.weekly.is_some();
        let today = self.day();
        let cadence = self.defs.rules.upbringing.cadence.as_ref().is_some_and(|r| r.enabled);
        let act = self.act_running();
        let Some(s) = &mut self.state.upbringing else {
            return Ok(());
        };
        if s.phase == Phase::Done {
            return Ok(());
        }
        let new_month = s.month != [date[0], date[1]];
        if new_month {
            // U05：换月时切换排程方式——旧档当月按旬走完，从这里起按周。
            s.weekly.on = weekly_rules;
        }
        let weekly = s.weekly.on && weekly_rules;
        if new_month && !weekly {
            s.month = [date[0], date[1]];
            s.previous_plan = std::mem::take(&mut s.plan);
            s.next_slot = 0;
            s.outings = 0;
            s.phase = if s.skipping { Phase::Running } else { Phase::Plan };
        }
        // 按周：每月 1、8、15、22 日换周；月内的次数（同行、远足）仍在月初清零。
        let new_week = weekly && (new_month || date[2] == weekly::week_start(weekly::week_of(date[2])));
        if weekly {
            if new_month {
                s.month = [date[0], date[1]];
                s.outings = 0;
                s.weekly.excursions = 0;
            }
            if new_week {
                let plan = std::mem::take(&mut s.plan);
                if !plan.is_empty() {
                    s.previous_plan = plan;
                }
                s.next_slot = 0;
                s.reading_slot = None;
                s.phase = if s.skipping || act { Phase::Running } else { Phase::Plan };
            }
            // 事件排期与格子结算脱钩：仍在每月 1、11、21 日各排一次。
            if !s.skipping
                && if cadence && (s.cadence.on || new_week) { new_week } else { matches!(date[2], 1 | 11 | 21) }
            {
                s.event_day = Some(today);
            }
        }
        if new_week {
            // 实习船借整周：换周时归还。
            self.return_training_fleet();
        }
        if new_week && cadence {
            self.prepare_cadence_week();
        }
        let weekly_mood =
            self.upbringing_cadence_enabled() && self.upbringing_cadence_rules().is_some_and(|r| r.weekly_mood);
        if weekly_mood {
            if new_week {
                self.settle_upbringing_mood_week();
            }
        } else if new_month {
            self.settle_upbringing_mood_month();
        }
        let stage_before = self.state.upbringing.as_ref().and_then(|s| s.stage_from);
        self.refresh_upbringing_stage();
        // 阶段刷新之后再发：到了结业日就不再发。
        if new_month {
            self.pay_upbringing_allowance()?;
            self.refresh_upbringing_unlocks(false);
        }
        if weekly {
            // 换周，或今天换了阶段：零用钱到手之后，把常设课表铺成本周余下的日程；铺不上就停在安排阶段。
            let restaged = self.state.upbringing.as_ref().and_then(|s| s.stage_from) != stage_before;
            if (new_week || restaged) && !self.act_running() {
                self.lay_week_from_timetable();
            }
        }
        self.refresh_upbringing_goals()?;
        self.act_new_day()?;
        Ok(())
    }
}
