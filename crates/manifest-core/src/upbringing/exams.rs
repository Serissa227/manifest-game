//! 考试只掷一次确定性检定；补考等待冷却并完成补习，费用付给当地钱袋。
use super::{Phase, milestones::*};
use crate::{
    CommandError, OwnerId, World,
    ledger::{Account, CashClass, JournalEntry, Memo},
    rng::{Domain, Rng},
    treasury::Flow,
    world::WorldState,
};
fn blocked(s: &str) -> CommandError {
    CommandError::Precondition(s.into())
}
impl World {
    pub(crate) fn upbringing_effect_sources(&self) -> Vec<(String, Vec<crate::items::effects::Effect>)> {
        let Some(s) = &self.state.upbringing else { return Vec::new() };
        let mut sources = self
            .defs
            .upbringing
            .exams
            .iter()
            .filter(|e| s.exams.get(&e.key).is_some_and(|r| r.passed))
            .map(|e| (format!("exam:{}", e.key), e.award.effects.clone()))
            .collect::<Vec<_>>();
        if let Some(g) = &s.graduation {
            if g.path_fulfilled
                && let Some(p) =
                    g.path.as_ref().and_then(|key| self.defs.upbringing.paths.iter().find(|p| &p.key == key))
            {
                sources.push((format!("path:{}", p.key), p.award.effects.clone()));
            }
            if let Some(e) =
                g.ending.as_ref().and_then(|key| self.defs.upbringing.endings.iter().find(|e| &e.key == key))
            {
                sources.push((format!("ending:{}", e.key), e.award.effects.clone()));
            }
        }
        sources
    }
    /// 今天是否在这门考试的某个考期内（U02 工作包 4）。考期长度为 0 时沿用旧规则：只认 `dates` 里的那一天。
    pub fn exam_in_session(&self, e: &ExamDef) -> bool {
        let days = self.defs.upbringing.rules.exam_session_days;
        if days == 0 {
            return e.dates.contains(&self.cast_date());
        }
        let today = self.day();
        e.dates
            .iter()
            .filter_map(|d| crate::scenario::day_of(&self.defs, *d).ok())
            .any(|d| d <= today && today < d + days)
    }
    /// 当前或下一个考期的开始日（世界日）；没有考期或都过了时为空。
    pub fn exam_next_session(&self, e: &ExamDef) -> Option<u32> {
        let days = self.defs.upbringing.rules.exam_session_days.max(1);
        let today = self.day();
        e.dates.iter().filter_map(|d| crate::scenario::day_of(&self.defs, *d).ok()).find(|d| today < d + days)
    }
    pub fn exam_available(&self, e: &ExamDef) -> Result<(), CommandError> {
        let s = self
            .state
            .upbringing
            .as_ref()
            .filter(|s| self.upbringing_active() && matches!(s.phase, Phase::Plan | Phase::Running))
            .ok_or_else(|| blocked("当前不能参加养成考试"))?;
        if e.academy.as_ref().is_some_and(|k| self.upbringing_academy().is_none_or(|a| &a.key != k))
            || !self.upbringing_requirements(&e.requirements)
        {
            return Err(blocked("考试条件尚未满足"));
        }
        if let Some(c) = &e.rating_check
            && c.ratings.iter().map(|k| self.upbringing_rating(k)).sum::<i64>() < c.min_total
        {
            return Err(blocked("综合评价不足"));
        }
        if let Some(r) = s.exams.get(&e.key) {
            if r.passed || r.attempts >= e.retake.max_attempts {
                return Err(blocked("考试已通过或次数已用完"));
            }
            if r.last_day.is_some_and(|d| self.day().saturating_sub(d) < e.retake.cooldown_days) {
                return Err(blocked("尚未到补考日期"));
            }
            if !e.retake.remediation.is_empty()
                && !e.retake.remediation.iter().any(|k| {
                    // 按周（U05）：上次考试时记了八分之一刻度的进度，补习“有进展”（含余数）就算数。
                    match s.weekly.remediation.get(&super::weekly::remediation_key(&e.key, k)) {
                        Some(mark) => self.upbringing_activity_eighths(k) > *mark,
                        None => {
                            s.activity_counts.get(k).copied().unwrap_or(0) > r.remediation.get(k).copied().unwrap_or(0)
                        }
                    }
                })
            {
                return Err(blocked("补考前须完成补习活动"));
            }
            // 设了考期的世界里，补考同样只能在考期内（U02 工作包 4）。
            if self.defs.upbringing.rules.exam_session_days > 0 && !e.dates.is_empty() && !self.exam_in_session(e) {
                return Err(blocked("尚未到考期"));
            }
            let have = self.agent(OwnerId::Player)?.cash;
            if have < e.retake.fee {
                return Err(CommandError::InsufficientCash { need: e.retake.fee, have });
            }
        } else if !e.dates.is_empty() && !self.exam_in_session(e) {
            return Err(blocked("尚未到考试日期"));
        }
        Ok(())
    }
    pub fn exam_pass_pct(&self, e: &ExamDef) -> i64 {
        let base = e.check.base + e.check.attrs.iter().map(|(k, v)| self.upbringing_projected(k) * v).sum::<i64>();
        let rating = e.rating_check.as_ref().map_or(0, |r| {
            r.ratings.iter().map(|k| self.upbringing_rating(k)).sum::<i64>() / r.check_bonus_divisor.max(1)
        });
        let condition = self.state.upbringing.as_ref().map_or(0, |s| s.mood / 20 - s.fatigue / 10);
        (base + rating + condition).clamp(e.check.min, e.check.max)
    }
    pub(crate) fn check_exam(&self, owner: OwnerId, key: &str) -> Result<Box<WorldState>, CommandError> {
        if owner != OwnerId::Player {
            return Err(CommandError::NotOwner);
        }
        let e = self
            .defs
            .upbringing
            .exams
            .iter()
            .find(|e| e.key == key)
            .ok_or_else(|| CommandError::NotFound(key.into()))?;
        self.exam_available(e)?;
        let mut trial = self.clone();
        let old = self.state.upbringing.as_ref().and_then(|s| s.exams.get(key));
        let attempts = old.map_or(0, |s| s.attempts);
        if attempts > 0 && e.retake.fee > 0 {
            let loc = self.upbringing_location().ok_or(CommandError::WrongLocation)?;
            trial.book_external(
                owner,
                Flow::Other,
                self.town_sector(loc),
                JournalEntry::new(self.day(), Memo::Other, CashClass::Operating)
                    .dr(Account::OtherExpense, e.retake.fee)
                    .cr(Account::Cash, e.retake.fee),
            )?;
        }
        let hash = blake3::hash(key.as_bytes());
        let mut bytes = [0; 8];
        bytes.copy_from_slice(&hash.as_bytes()[..8]);
        let mut rng = Rng::derive(
            self.state.seed,
            self.day(),
            Domain::Upbringing,
            u64::from_le_bytes(bytes),
            u64::from(attempts),
        );
        let passed = rng.chance_bp(self.exam_pass_pct(e) * 100);
        if passed {
            trial.apply_upbringing_award(&e.award)?;
            trial.upbringing_recommendation(e)?;
        }
        // 按周（U05）：把补习活动此刻的进度（八分之一次）记下，补考前只要求“有进展”。
        let marks: Vec<(String, i64)> = if self.upbringing_weekly() {
            e.retake
                .remediation
                .iter()
                .map(|k| (super::weekly::remediation_key(key, k), self.upbringing_activity_eighths(k)))
                .collect()
        } else {
            Vec::new()
        };
        if let Some(s) = &mut trial.state.upbringing {
            s.weekly.remediation.extend(marks);
            s.exams.insert(
                key.into(),
                ExamState {
                    attempts: attempts + 1,
                    last_day: Some(self.day()),
                    passed,
                    remediation: e
                        .retake
                        .remediation
                        .iter()
                        .map(|k| (k.clone(), s.activity_counts.get(k).copied().unwrap_or(0)))
                        .collect(),
                },
            );
            if passed {
                for event in &e.events {
                    if !s.event_backlog.contains(event) {
                        s.event_backlog.push(event.clone());
                    }
                }
            }
        }
        Ok(Box::new(trial.state))
    }

    pub(crate) fn upbringing_recommendation(&mut self, exam: &ExamDef) -> Result<(), CommandError> {
        let item = self
            .upbringing_academy()
            .and_then(|a| a.rules.as_ref())
            .map(|r| &r.recommendation)
            .filter(|r| {
                r.exam == exam.key
                    && self.upbringing_projected("honor") >= r.honor_min
                    && !exam.award.items.contains_key(&r.item)
            })
            .map(|r| r.item.clone());
        if let Some(item) = item {
            self.grant_item(OwnerId::Player, &item, 1)?;
        }
        Ok(())
    }
    pub(crate) fn apply_upbringing_award(&mut self, a: &Award) -> Result<(), CommandError> {
        if a.departure_chart {
            let family = self.upbringing_family().ok_or_else(|| blocked("没有养成家庭"))?;
            let at = family.completion.as_ref().and_then(|c| c.capital.at.as_ref()).unwrap_or(&family.home);
            let region = self
                .defs
                .locations
                .iter()
                .find(|l| &l.key == at)
                .and_then(|l| self.defs.map.region_of(l.cell))
                .ok_or_else(|| blocked("出航海区不存在"))?;
            crate::story::apply(self, None, &crate::story::StoryEffect::Chart(region))?;
        }
        for (item, qty) in &a.items {
            self.grant_item(OwnerId::Player, item, *qty)?;
        }
        for (skill, xp) in &a.skills {
            let v =
                self.state.items.owners.entry(OwnerId::Player).or_default().skill_xp.entry(skill.clone()).or_default();
            *v = v.checked_add(*xp).ok_or(CommandError::InvalidQuantity)?;
        }
        self.state.cast.titles.extend(a.titles.iter().cloned());
        self.state.cast.flags.extend(a.flags.iter().cloned());
        self.state.story2.flags.extend(a.flags.iter().cloned());
        Ok(())
    }
    pub fn path_visible(&self, p: &PathDef) -> bool {
        !p.hidden || self.upbringing_requirements(&p.reveal)
    }
    pub fn path_available(&self, p: &PathDef) -> bool {
        self.upbringing_active()
            && self.state.upbringing.as_ref().is_some_and(|s| matches!(s.phase, Phase::Plan | Phase::Running))
            && self.upbringing_family().and_then(|f| f.completion.as_ref()).is_some_and(|c| {
                c.paths.contains(&p.key)
                    && (self.state.upbringing.as_ref().is_some_and(|s| s.path.is_some())
                        || c.choose_event.as_ref().is_none_or(|key| {
                            self.state.story2.tracks.get(key).is_some_and(|t| t.status == crate::story2::Status::Done)
                        }))
                    && self
                        .state
                        .protagonist
                        .as_ref()
                        .and_then(|i| i.age_on(self.cast_date()))
                        .is_some_and(|age| age >= c.choose_age)
            })
            && self.path_visible(p)
            && self.upbringing_requirements(&p.requirements)
    }
    pub(crate) fn check_path(&self, owner: OwnerId, key: &str) -> Result<(), CommandError> {
        if owner != OwnerId::Player {
            return Err(CommandError::NotOwner);
        }
        let p = self
            .defs
            .upbringing
            .paths
            .iter()
            .find(|p| p.key == key)
            .ok_or_else(|| CommandError::NotFound(key.into()))?;
        if self.path_available(p) { Ok(()) } else { Err(blocked("志向尚未开放或条件不足")) }
    }
}
