//! 定义引用和存档内部约束；失效的活动引用恢复为待安排，不重放已结算旬。
use super::*;
use crate::{CoreError, StaticData, World};
fn key(s: &str) -> bool {
    !s.is_empty() && s.len() <= 128 && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}
pub fn validate(defs: &StaticData) -> Vec<String> {
    let mut errors = Vec::new();
    let mut keys = BTreeSet::new();
    let valid_date =
        |d: WorldDate| defs.calendar.day_of(crate::calendar::Date { year: d[0], month: d[1], day: d[2] }).is_ok();
    for a in &defs.upbringing.activities {
        if !key(&a.key) || !keys.insert(&a.key) || a.name.trim().is_empty() {
            errors.push(format!("{}: 活动键重复、无效或名称为空", a.key));
        }
        for event in &a.events {
            if !defs.story2.tracks.iter().any(|t| super::activity_validation::event_matches(event, &t.key)) {
                errors.push(format!("{}: 未知事件轨道 {event}", a.key));
            }
        }
    }
    keys.clear();
    for f in &defs.upbringing.families {
        let mut check = |ok: bool, message: &str| {
            if !ok {
                errors.push(format!("{}: {message}", f.key));
            }
        };
        check(key(&f.key) && keys.insert(&f.key) && !f.name.trim().is_empty(), "家庭键重复、无效或名称为空");
        check(defs.scenarios.iter().any(|s| s.key == f.scenario), "家庭引用未知剧本");
        check(f.protagonists.iter().all(|p| defs.cast.person(p).is_some()), "家庭引用未知人物");
        let valid_name = |name: &str| name.chars().count() <= 20 && !name.chars().any(char::is_control);
        check(valid_name(&f.youth_name), "少年称呼超过20字或含控制字符");
        check(
            f.call_you.iter().all(|(person, name)| defs.cast.person(person).is_some() && valid_name(name)),
            "少年称呼引用未知人物、超过20字或含控制字符",
        );
        let points_ok = |points: &BTreeMap<String, i64>| {
            points.iter().all(|(key, value)| {
                key != "fortune"
                    && key != "arcana"
                    && defs.captain.attribute_index(key).is_some_and(|i| {
                        let max = if defs.captain.group(i).is_some_and(|g| g.key == "conduct") { 5 } else { 9 };
                        (0..=max).contains(value)
                    })
            })
        };
        check(points_ok(&f.initial_points), "家庭开局点含未知属性、固定运气、未觉醒秘术或越界值");
        check(points_ok(&f.origin_points), "家境底子含未知属性、固定运气、未觉醒秘术或越界值");
        check(
            f.templates.iter().all(|p| {
                defs.scenarios
                    .iter()
                    .find(|s| s.key == f.scenario)
                    .is_some_and(|s| s.template_defs.iter().any(|t| &t.key == p))
            }),
            "家庭引用未知模板",
        );
        check(defs.locations.iter().any(|l| l.key == f.home), "家庭引用未知家乡");
        check(f.allowance.home >= 0 && f.allowance.academy >= 0, "零用钱不能为负");
        check(valid_date(f.born) && valid_date(f.graduation) && f.born < f.graduation, "出生或结业日期无效");
        check(
            !f.stages.is_empty() && f.stages.windows(2).all(|p| p[0].from < p[1].from),
            "阶段必须非空并按起始日期严格递增",
        );
        for s in &f.stages {
            check(valid_date(s.from) && s.from >= f.born && s.from < f.graduation, "阶段日期无效");
            check(!s.name.trim().is_empty() && defs.locations.iter().any(|l| l.key == s.at), "阶段名称或地点无效");
        }
    }
    for s in defs.scenarios.iter().filter(|s| s.upbringing) {
        if defs.calendar.months().iter().any(|days| *days < 21) {
            errors.push("养成日历每月至少须有21天".into());
        }
        // U05：按周排程每月固定四周，第四周从 22 日起，月长至少 28 天。
        if defs.rules.upbringing.weekly.is_some() && defs.calendar.months().iter().any(|days| *days < 28) {
            errors.push("按周排程的养成日历每月至少须有28天".into());
        }
        if !defs.upbringing.families.iter().any(|f| {
            f.scenario == s.key
                && f.stages.first().is_some_and(|stage| stage.from <= s.control_date)
                && s.control_date < f.graduation
        }) {
            errors.push(format!("{}: 缺少覆盖开局日期的养成家庭", s.key));
        }
    }
    if let Some(weekly) = &defs.rules.upbringing.weekly {
        errors.extend(weekly.problems().into_iter().map(|p| format!("rules.toml：{p}")));
    }
    errors.extend(super::native_validation::validate(defs));
    errors.extend(super::activity_validation::validate(defs));
    errors.extend(crate::contests::validation::validate(defs));
    errors.extend(super::academy_validation::validate(defs));
    errors.extend(super::milestone_validation::validate(defs));
    errors.extend(super::goals::validate(defs));
    errors.extend(super::act::validation::validate(defs));
    errors.extend(crate::scenario::templates::validate(defs));
    errors.extend(effect_activity_problems(defs));
    errors
}

/// U05 收尾（二）：物品、套装、考试 / 志向 / 结局奖励里限定了活动的效果，活动名必须是存在的养成活动 key；
/// 否则效果显示出来却永远不生效（内核按活动自己的 key 或它 `counts_as` 的那一项匹配）。
pub fn effect_activity_problems(defs: &StaticData) -> Vec<String> {
    let mut sources: Vec<(String, &[crate::items::effects::Effect])> = Vec::new();
    for item in &defs.items.items {
        sources.push((format!("物品 {}", item.key), &item.effects));
        sources.push((format!("物品 {}（使用）", item.key), &item.uses));
    }
    for set in &defs.items.sets {
        sources.push((format!("套装 {}", set.key), &set.bonus));
    }
    for e in &defs.upbringing.exams {
        sources.push((format!("考试 {}", e.key), &e.award.effects));
    }
    for p in &defs.upbringing.paths {
        sources.push((format!("志向 {}", p.key), &p.award.effects));
    }
    for e in &defs.upbringing.endings {
        sources.push((format!("结局 {}", e.key), &e.award.effects));
    }
    // K01：技能的顶层效果与各级效果
    for (key, s) in &defs.story2.skill_effects {
        sources.push((format!("技能 {key}"), &s.summary));
        for l in &s.levels {
            sources.push((format!("技能 {key}（第 {} 级）", l.level), &l.effects));
        }
    }
    let mut errors = Vec::new();
    for (owner, effects) in sources {
        for activity in effects.iter().filter_map(|e| e.activity.as_deref()) {
            if defs.upbringing.activity(activity).is_none() {
                errors.push(format!("{owner}：效果限定的活动 {activity} 不是养成活动的 key"));
            }
        }
    }
    errors
}
impl World {
    pub(crate) fn validate_upbringing_snapshot(&self) -> Result<(), CoreError> {
        self.validate_contest_snapshot()?;
        self.validate_milestone_snapshot()?;
        let Some(s) = &self.state.upbringing else {
            return Ok(());
        };
        let date = self.cast_date();
        // U05：存档有按旬、按周两种形状。本月按周（`weekly.on`）时日程是一周的格（至多 7 格）；
        // 写了按周规则的世界里，日记同时有两种记录（旧档切换之前的按旬，之后的按周）。
        let weekly = s.weekly.on;
        let week_rules = self.defs.rules.upbringing.weekly.as_ref();
        let slots: u8 = if weekly { weekly::MAX_WEEK_SLOTS as u8 } else { 3 };
        let journal_slots: u8 = if weekly || week_rules.is_some() { weekly::MAX_WEEK_SLOTS as u8 } else { 3 };
        let plan_len_ok = |len: usize| match (weekly, week_rules) {
            (false, _) => len == 3,
            (true, Some(r)) => len == r.home.slots().len() || len == r.academy.slots().len(),
            (true, None) => (1..=weekly::MAX_WEEK_SLOTS).contains(&len),
        };
        if self.act_snapshot_problem() {
            return Err(CoreError::SnapshotMismatch("养成行动制状态矛盾".into()));
        }
        if self.weekly_snapshot_problem() {
            return Err(CoreError::SnapshotMismatch("养成周程的课表、进位或计数矛盾".into()));
        }
        if s.journal.iter().any(|entry| entry.day > self.day() || entry.result.index >= journal_slots)
            || s.journal.windows(2).any(|p| p[0].day >= p[1].day)
            || s.memory_days
                .values()
                .chain(s.letter_arrivals.values())
                .chain(s.filler_seen.values())
                .any(|day| *day > self.day())
        {
            return Err(CoreError::SnapshotMismatch("养成日记或来信日期矛盾".into()));
        }
        if s.excursion_progress.iter().any(|(key, nodes)| {
            nodes.iter().any(|(node, p)| {
                !(1..=3).contains(&p.step)
                    || p.last_day.is_none_or(|day| day > self.day())
                    || s.excursion_nodes.get(key).and_then(|n| n.get(node))
                        != Some(if p.step == 3 { &NodeState::Solved } else { &NodeState::Seen })
            })
        }) {
            return Err(CoreError::SnapshotMismatch("远足步骤或日期矛盾".into()));
        }
        if s.stage_from.is_some_and(|d| d > date)
            || s.excursion_nodes
                .values()
                .flat_map(|nodes| nodes.values())
                .any(|v| !matches!(v, NodeState::Seen | NodeState::Solved))
            || s.training.as_ref().is_some_and(|t| {
                t.month != s.month
                    // 按旬：借的是下一旬；按周：借的是本周（记周序）。
                    || if weekly { t.slot != weekly::week_of(date[2]) } else { t.slot != s.next_slot || t.slot >= 3 }
                    || s.phase != Phase::Running
                    || t.origin.is_some_and(|loc| loc.idx() >= self.state.locations.len())
                    || self
                        .state
                        .fleets
                        .get(&t.fleet)
                        .is_some_and(|f| f.owner != crate::OwnerId::Player || f.book_value() != 0)
            })
        {
            return Err(CoreError::SnapshotMismatch("学院、同行、远足或实习船状态矛盾".into()));
        }
        // 周节奏的日期入口也会发放许可，不属于活动轨道，且不受旧排期的三件上限限制。
        if s.event_day.is_some_and(|d| d > self.day().saturating_add(1)) {
            return Err(CoreError::SnapshotMismatch("养成事件预算或日期矛盾".into()));
        }
        let mut indices = BTreeSet::new();
        if (s.phase != Phase::Done && s.month != [date[0], date[1]])
            || s.month > [date[0], date[1]]
            || s.next_slot > slots
            || (!s.plan.is_empty()
                && (!plan_len_ok(s.plan.len()) || s.plan.iter().enumerate().any(|(i, p)| usize::from(p.index) != i)))
            || (s.phase == Phase::Running && !s.skipping && !self.act_running() && !plan_len_ok(s.plan.len()))
            || s.last.iter().any(|r| r.index >= journal_slots || (!s.act.on && !indices.insert(r.index)))
            || s.settled.iter().any(|(m, i)| {
                *i >= 3 || *m > s.month || m[0] == 0 || m[1] == 0 || m[1] as usize > self.defs.calendar.months().len()
            })
        {
            return Err(CoreError::SnapshotMismatch("养成月程日期、旬索引或结算记录矛盾".into()));
        }
        Ok(())
    }
    pub(crate) fn reconcile_upbringing(&mut self) {
        let before = self.state.upbringing.clone();
        if !self.upbringing_active() {
            self.return_training_fleet();
        }
        self.trim_upbringing();
        if self.state.upbringing.as_ref().is_some_and(|s| s.plan.is_empty()) {
            self.return_training_fleet();
        }
        self.refresh_upbringing_stage();
        if let Some(s) = &mut self.state.upbringing {
            s.growth.retain(|k, _| self.defs.captain.attribute_index(k).is_some());
            s.year_growth.retain(|k, _| self.defs.captain.attribute_index(k).is_some());
            s.activity_counts.retain(|k, _| self.defs.upbringing.activity(k).is_some());
            s.excursion_progress.retain(|key, nodes| {
                let Some(e) = self.defs.upbringing.excursions.iter().find(|e| &e.key == key) else { return false };
                nodes.retain(|key, _| e.nodes.iter().any(|n| &n.key == key && !n.steps.is_empty()));
                !nodes.is_empty()
            });
            s.exams.retain(|k, _| self.defs.upbringing.exams.iter().any(|e| &e.key == k));
            if s.path.as_ref().is_some_and(|key| !self.defs.upbringing.paths.iter().any(|p| &p.key == key)) {
                s.path = None;
            }
            s.job_progress.retain(|k, _| {
                self.defs.upbringing.activities.iter().filter_map(|a| a.tier.as_ref()).any(|t| &t.group == k)
            });
        }
        if let Some(s) = &mut self.state.upbringing {
            s.activity_tracks.retain(|key| self.defs.story2.track(key).is_some());
            // 日期事件的许可也要保留；只清理定义已移除的轨道。
            s.event_permits.retain(|key| self.defs.story2.track(key).is_some());
            s.filler_seen.retain(|key, _| self.defs.story2.track(key).is_some());
        }
        self.init_upbringing_growth();
        self.reconcile_act();
        if self.state.upbringing != before {
            self.push_log(crate::log::LogEvent { day: self.day(), kind: crate::log::LogKind::UpbringingReconciled });
        }
    }
    fn trim_upbringing(&mut self) {
        let today = self.cast_date();
        let Some(s) = &mut self.state.upbringing else {
            return;
        };
        if self.defs.upbringing.family(&s.family).is_none()
            || self.defs.scenarios.get(self.state.scenario.idx()).is_none_or(|s| !s.upbringing)
        {
            self.state.upbringing = None;
            return;
        }
        if s.phase != Phase::Done
            && s.plan.iter().skip(usize::from(s.next_slot)).any(|p| {
                p.lesson
                    .iter()
                    .chain(p.after.iter().map(|a| &a.activity))
                    .any(|k| self.defs.upbringing.activity(k).is_none())
            })
        {
            s.plan.clear();
            s.reading_slot = None;
            s.phase = Phase::Plan;
        }
        // U05：常设周课表里失效的活动清成“没排”；规则不再按周的世界退回按旬，本月余下的旬重新安排。
        for table in [&mut s.weekly.home, &mut s.weekly.academy] {
            for slot in table.iter_mut() {
                if weekly::slot_activity(slot).is_some_and(|k| self.defs.upbringing.activity(k).is_none()) {
                    slot.lesson = None;
                    slot.after = None;
                }
            }
        }
        if s.weekly.on && self.defs.rules.upbringing.weekly.is_none() {
            s.weekly.on = false;
            if s.phase != Phase::Done {
                s.plan.clear();
                s.reading_slot = None;
                s.last.clear();
                s.next_slot = super::schedule::slot_of(today[2]);
                if !s.skipping && s.phase == Phase::Running {
                    s.phase = Phase::Plan;
                }
            }
        }
        // 待排的事件可以是轨道 key，也可以是活动、地点给的“前缀*”模式：模式只要还对得上某条轨道就留着。
        // （U05：按周时结算与排期脱钩，存档时待排事件常不为空；原来只认完整 key，读档会把模式清掉。）
        let tracks = &self.defs.story2;
        s.event_backlog.retain(|k| {
            tracks.track(k).is_some()
                || (k.ends_with('*')
                    && tracks.tracks.iter().any(|t| super::activity_validation::event_matches(k, &t.key)))
        });
    }
}
