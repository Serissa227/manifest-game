//! 原生选择卡绑定教师、手作配方与月内次数；结算使用既有账本与随机域。
use super::*;
use crate::{CommandError, CoreError, OwnerId, World};
impl World {
    /// 年度事件可给打工进度保底，不重复累加也不降低已有进度。
    pub fn upbringing_job_progress(&self, group: &str) -> u32 {
        let earned = self.state.upbringing.as_ref().and_then(|s| s.job_progress.get(group)).copied().unwrap_or(0);
        self.defs
            .upbringing
            .job_progress_flags
            .iter()
            .filter(|(flag, grant)| grant.group == group && self.upbringing_flag(flag))
            .map(|(_, grant)| grant.at_least)
            .fold(earned, u32::max)
    }

    pub fn upbringing_helper_level(&self, person: &str, skill: &str) -> u32 {
        self.defs.upbringing.helper_levels.get(person).and_then(|s| s.get(skill)).copied().unwrap_or_else(|| {
            u32::from(self.defs.upbringing.helpers.get(person).is_some_and(|s| s.iter().any(|k| k == skill)))
        })
    }
    pub fn upbringing_culture_matches(&self, wanted: &str, actual: &str) -> bool {
        wanted == actual
            || self.defs.upbringing.culture_aliases.get(wanted).is_some_and(|v| v.iter().any(|c| c == actual))
    }
    pub fn upbringing_mentor<'a>(&'a self, a: &'a ActivityDef) -> Option<&'a str> {
        a.mentor.as_deref().or_else(|| {
            a.mentor_role.as_deref().and_then(|role| {
                self.upbringing_academy()
                    .and_then(|a| a.mentor_roles.get(role))
                    .or_else(|| self.upbringing_family().and_then(|f| f.mentor_roles.get(role)))
                    .map(String::as_str)
            })
        })
    }
    /// 实收费用：课程按当前学院的奖学金折扣（`rules.scholarship`），其余活动照标价。
    pub fn upbringing_activity_cost(&self, a: &ActivityDef) -> i64 {
        self.upbringing_tuition(a, self.upbringing_academy())
    }
    pub(crate) fn check_native_activity(&self, a: &ActivityDef) -> Result<(), CommandError> {
        let blocked = |s: &str| CommandError::Precondition(s.into());
        if let Some(limit) = a.monthly_limit {
            let group = a.monthly_limit_group.as_deref().unwrap_or(&a.key);
            if self.upbringing_monthly_used(group) >= limit as usize {
                return Err(blocked("本月活动次数已满"));
            }
        }
        self.check_native_selection(a)
    }
    pub(crate) fn upbringing_monthly_used(&self, group: &str) -> usize {
        let month = self.cast_date();
        self.state.upbringing.as_ref().map_or(0, |s| {
            s.journal
                .iter()
                .filter(|j| {
                    let d = self.defs.calendar.date_of(j.day);
                    self.defs.rules.world.start_year + i64::from(d.year) - 1 == i64::from(month[0])
                        && d.month == month[1]
                })
                .flat_map(|j| &j.result.activities)
                .filter(|k| {
                    self.defs
                        .upbringing
                        .activity(k)
                        .is_some_and(|a| a.monthly_limit_group.as_deref().unwrap_or(&a.key) == group)
                })
                .count()
        })
    }
    fn check_native_selection(&self, a: &ActivityDef) -> Result<(), CommandError> {
        let blocked = |s: &str| CommandError::Precondition(s.into());
        if a.skill_choice.is_some() && a.selected_skill.is_none() {
            return Err(blocked("请选择具体技能活动"));
        }
        if let Some(skill) = &a.selected_skill {
            let Some(choice) = &a.skill_choice else {
                return Err(blocked("技能选择缺少定义"));
            };
            if !choice.options.contains(skill) {
                return Err(blocked("技能不属于本活动"));
            }
            let profile = self.defs.upbringing.skill_profiles.get(skill);
            if profile.is_some_and(|p| p.unavailable || p.flags.iter().any(|f| !self.upbringing_flag(f))) {
                return Err(blocked("技能尚未开放"));
            }
            if choice.require_transmission
                && !profile.is_some_and(|p| !p.flags.is_empty() && p.flags.iter().all(|f| self.upbringing_flag(f)))
            {
                return Err(blocked("尚未获得传授"));
            }
            if choice.require_local_teacher {
                let teacher = self
                    .upbringing_mentor(a)
                    .filter(|key| self.upbringing_companion_present(key, None, self.cast_date()));
                let academy_teaches = self.upbringing_academy().is_some_and(|ac| {
                    ac.curriculum.iter().any(|c| {
                        c.skills.iter().any(|s| &s.skill == skill)
                            && self
                                .upbringing_mentor(c)
                                .is_some_and(|p| self.upbringing_companion_present(p, None, self.cast_date()))
                    })
                });
                let helper_teaches = teacher.is_some_and(|p| self.upbringing_helper_level(p, skill) > 0);
                if !academy_teaches && !helper_teaches {
                    return Err(blocked("当地没有可用的教师"));
                }
            }
        }
        if let Some(club) = &a.club
            && !self.upbringing_academy().is_some_and(|ac| ac.clubs.iter().any(|c| &c.key == club))
        {
            return Err(blocked("此处没有该社团"));
        }
        if a.kind == ActivityKind::Club
            && a.club.is_none()
            && !self.upbringing_academy().is_some_and(|ac| {
                ac.clubs.iter().any(|club| club.practice.iter().any(|k| k == &a.key || a.counts_as.as_ref() == Some(k)))
            })
        {
            return Err(blocked("此处没有安排这项活动的社团"));
        }
        if let Some(key) = &a.craft {
            let c =
                self.defs.upbringing.crafts.iter().find(|c| &c.key == key).ok_or_else(|| blocked("手作配方不存在"))?;
            if c.materials.iter().any(|i| self.item_quantity(OwnerId::Player, &i.item) < i.qty)
                || c.tools.iter().any(|i| self.item_quantity(OwnerId::Player, i) <= 0)
                || self.upbringing_skill_level(&c.skill) < c.level
            {
                return Err(blocked("缺少手作材料、工具或技能"));
            }
        }
        Ok(())
    }
    pub(crate) fn settle_native_activity(
        &mut self,
        a: &ActivityDef,
        success: bool,
        weight: i64,
        result: &mut SlotResult,
    ) -> Result<(), CoreError> {
        if let Some(key) = &a.craft {
            let c = self
                .defs
                .upbringing
                .crafts
                .iter()
                .find(|c| &c.key == key)
                .cloned()
                .ok_or_else(|| CoreError::Internal("手作配方不存在".into()))?;
            if success {
                // 按周：做满一个标准格才出一件，材料也在出件时才扣（整格时每次一件，与按旬相同）。
                let pieces = self.upbringing_carry(&format!("craft:{}", a.key), 1, weight).max(0);
                for _ in 0..pieces {
                    for i in &c.materials {
                        self.take_item(OwnerId::Player, &i.item, i.qty);
                        *result.items.entry(i.item.clone()).or_default() -= i.qty;
                    }
                    self.grant_item(OwnerId::Player, &c.output.item, c.output.qty)
                        .map_err(|e| CoreError::Internal(e.to_string()))?;
                    *result.items.entry(c.output.item.clone()).or_default() += c.output.qty;
                }
            } else {
                result.line = Some(c.failure);
            }
        }
        if let Some(base) = a.counts_as.as_ref().filter(|base| *base != &a.key) {
            let times = self.upbringing_carry(&format!("count:{base}"), 1, weight).max(0) as u32;
            if let Some(s) = &mut self.state.upbringing {
                let count = s.activity_counts.entry(base.clone()).or_default();
                *count = count.saturating_add(times);
            }
        }
        Ok(())
    }
}
