//! 自动安排：按预设给活动打分，排出一份能通过内核校验的月程；应用与离线审计共用。
//!
//! 打分用整数，单位是“十分之一点成长”：
//! - **收获**：各属性的期望成长 × 预设权重（偏重的属性 ×3，其余 ×1；“均衡”给落后于平均的属性 ×2），
//!   期望成长已算进效率、失败概率、本年剩余额度与属性上限；品行按原始点数计、不乘 10（品行数值小、涨得快，
//!   乘 10 会让任何带品行的活动压过偏重的属性），只有预设偏重的品行（社交的感性）按评价刻度 ×10；
//!   技能经验每 4 点算 1 分。
//! - **钱**：（期望收入 − 学费）× 钱的分量。可花的钱越少分量越重；钱紧时打工的收入翻几倍，自然先排打工；
//!   手头富余（花完还剩 200 以上）时钱只当零头，不再为打工放下功课。
//!   学费按奖学金折扣后的实收价算；排程时先留出本月剩下的学费和下个月零用钱补不上的学费。
//! - **疲劳**：休息在疲劳 < 30 时记 0 分，30–59 只给一点，≥ 60 才明显偏向，并按真能消掉的疲劳折算；
//!   其余活动按会不会把疲劳推过 60、80、90 扣分。负疲劳本身不算收益。
//! - **轮换**：同一个月里排过的递减；上个月排过的扣分；同一门课最多连排两个月，第三个月不排。
//! - **社交**：每月至少一格社交或外出（拜访、家乡探访、约人同行、自由行动），自动补同伴与地点；
//!   约人同行优先于独自外出，“社交”预设每月尽量约满两次。
//! - **标签**：预设在 `rules.auto_presets` 里没有属性映射时（如测试世界），带本预设标签的活动压过其余。
//! - **兜底**：课业格总有免费的自习，课后格总有免费的休息；打分挑不出来时按兜底排，保证月程合法。
//!
//! 按周排程（U05）时排的是本周余下的格：打分仍以“标准格”（按旬时的一格）为单位，所以各项的相对高低不变；
//! 只有随排程推进的量按格重折算——花掉的钱、累积的疲劳、同月里已经排过几次（八分之一为单位）。
use super::*;
use crate::{CommandError, OwnerId, World};

#[cfg(test)]
mod tests;

/// 自动安排的全部预设，界面与审计按这个顺序列出。
pub const AUTO_PRESETS: [&str; 7] = ["balanced", "previous", "navigation", "trade", "combat", "learning", "social"];

/// 社交或外出：拜访、和朋友玩、家乡探访、自由行动、课后同行。
pub fn social_kind(kind: ActivityKind) -> bool {
    matches!(kind, ActivityKind::Social | ActivityKind::Date | ActivityKind::Free)
}

/// 同伴的优先次序：先约同窗与朋友，再是对手、笔友、家人，最后才是师长。
fn role_rank(role: CompanionRole) -> u8 {
    match role {
        CompanionRole::Classmate => 0,
        CompanionRole::Friend => 1,
        CompanionRole::Rival => 2,
        CompanionRole::Penpal => 3,
        CompanionRole::Family => 4,
        CompanionRole::Mentor => 5,
    }
}

/// 一次打分所需的、随排程推进而变化的量。
struct Planner<'a> {
    w: &'a World,
    preset: &'a str,
    weights: BTreeMap<String, i64>,
    tag_bonus: bool,
    last: BTreeSet<String>,
    before_last: BTreeSet<String>,
    /// 本月已经排过多少（八分之一个标准格）。
    picked: BTreeMap<String, i64>,
    limits: BTreeMap<String, usize>,
    cash: i64,
    /// 排到这一格时的疲劳（八分之一点）。
    fatigue: i64,
    outings: u8,
    /// 本次排程按正式校验器的周冷却与窗口筛选。
    planned_outings: usize,
    planned_excursions: usize,
    /// 本月已经走过、加上已经排进去的远足次数，与每月上限（0 = 不限；只有按周时有）。
    excursions: u8,
    excursion_limit: u8,
    social: bool,
    reserve: i64,
    lesson_cost: i64,
    /// 本月余下的课业还要留的学费（八分之一个钱）。
    tuition_left: i64,
    recent: BTreeMap<String, u32>,
    /// 疲劳往前看几遍（U05）：按旬一次排一个月，挑到后面的旬时已经把前面几旬的疲劳算进去了；按周只排一周，
    /// 但这一周的课表会沿用到月底，所以每挑一格，它的疲劳按“本月还剩几周”算几遍。按旬恒为 1（算法不变）。
    horizon: i64,
}

impl World {
    /// 养成日记里一天所在的年月。
    fn upbringing_month_of(&self, day: u32) -> [u32; 2] {
        let d = self.defs.calendar.date_of(day);
        [(self.defs.rules.world.start_year + i64::from(d.year) - 1).max(0) as u32, d.month]
    }
    /// 给需要补选项的活动挑地点、同行者、书目或远足节点；挑不出能通过校验的就返回 None。
    ///
    /// 同行者先挑最近同行次数少的人，再按同窗、朋友、对手、笔友、家人、师长的次序；
    /// 需要地点的同行活动挑同伴那天所在的场所，这样邀请才约得到人。
    pub fn auto_choice(&self, a: &ActivityDef, date: WorldDate) -> Option<AfterChoice> {
        self.auto_choice_with(a, date, &BTreeMap::new())
    }
    fn auto_choice_with(
        &self,
        a: &ActivityDef,
        date: WorldDate,
        recent: &BTreeMap<String, u32>,
    ) -> Option<AfterChoice> {
        let mut base = AfterChoice::activity(&a.key);
        if a.needs.contains(&Need::Book) {
            base.book = Some(
                self.defs
                    .items
                    .items
                    .iter()
                    .find(|i| i.read.is_some() && self.choose_reading(OwnerId::Player, &i.key, None).is_ok())?
                    .key
                    .clone(),
            );
        }
        if a.needs.contains(&Need::Excursion) {
            let (e, n) =
                self.defs.upbringing.excursions.iter().find_map(|e| {
                    e.nodes.iter().find(|n| self.check_excursion(&e.key, &n.key).is_ok()).map(|n| (e, n))
                })?;
            base.excursion = Some(e.key.clone());
            base.node = Some(n.key.clone());
        }
        let places: Vec<&PlaceDef> =
            self.upbringing_places().iter().filter(|p| self.upbringing_place_open(p)).collect();
        let mut options = Vec::new();
        if a.needs.contains(&Need::Companion) {
            let mut people: Vec<(u32, u8, String)> = self
                .upbringing_companions()
                .into_iter()
                .map(|(key, role)| (recent.get(&key).copied().unwrap_or(0), role_rank(role), key))
                .collect();
            people.sort();
            for (_, _, person) in people {
                if a.needs.contains(&Need::Place) {
                    for p in places.iter().filter(|p| self.upbringing_companion_present(&person, Some(&p.key), date)) {
                        let mut c = base.clone();
                        c.companion = Some(person.clone());
                        c.place = Some(p.key.clone());
                        options.push(c);
                    }
                } else if self.upbringing_companion_present(&person, None, date) {
                    let mut c = base.clone();
                    c.companion = Some(person.clone());
                    options.push(c);
                }
            }
        } else if a.needs.contains(&Need::Place) {
            options.extend(places.iter().map(|p| {
                let mut c = base.clone();
                c.place = Some(p.key.clone());
                c
            }));
        } else {
            options.push(base);
        }
        options.into_iter().find(|c| self.check_upbringing_choice(a, Some(c), date).is_ok())
    }

    /// 一项活动按当前状态的期望成长（十分之一点，原始成长刻度），
    /// 已计效率、失败概率与本年剩余额度；运气与未觉醒的秘术为 0。
    pub fn upbringing_expected_gains(&self, a: &ActivityDef) -> BTreeMap<String, i64> {
        let Some(s) = self.state.upbringing.as_ref() else { return BTreeMap::new() };
        let efficiency = self.upbringing_efficiency(a);
        let risk = self.upbringing_risk(a);
        let year = self.cast_date()[0];
        a.gains
            .iter()
            .filter(|(key, _)| *key != "fortune" && (*key != "arcana" || self.upbringing_flag("arcana_awakened")))
            .filter_map(|(key, range)| {
                let i = self.defs.captain.attribute_index(key)?;
                let max = if self.defs.captain.group(i).is_some_and(|g| g.key == "conduct") { 100 } else { 1000 };
                let used = if s.growth_year == year { s.year_growth.get(key).copied().unwrap_or(0) } else { 0 };
                // 本年额度与属性上限（品行 100、其余 1000）都算进去：顶格以后再练就没有收获。
                let room =
                    (self.defs.upbringing.rules.annual_growth_cap - used).min(max - self.upbringing_growth(key)).max(0)
                        * 10;
                let mid = (range[0] + range[1]).max(0) * 5 * efficiency / 100;
                let mid = mid * (10_000 - risk) / 10_000 + mid * a.failure.gains_pct * risk / 1_000_000;
                Some((key.clone(), mid.min(room)))
            })
            .collect()
    }

    /// 按预设排本月尚未结算的旬（按周时是本周尚未结算的格）；结果一定先通过 `check_month_plan` / `check_week_plan`。
    pub fn auto_plan(&self, preset: &str) -> Result<Vec<PlanSlot>, CommandError> {
        let s = self.state.upbringing.as_ref().ok_or_else(|| CommandError::Precondition("当前不是养成阶段".into()))?;
        if !AUTO_PRESETS.contains(&preset) {
            return Err(CommandError::NotFound(preset.into()));
        }
        let budget = self.upbringing_budget();
        if preset == "previous" && self.previous_plan_fits(&s.previous_plan, &budget) {
            return Ok(s.previous_plan.clone());
        }
        let scored = if preset == "previous" { "balanced" } else { preset };
        match self.plan_with(scored, &budget) {
            Ok(slots) => Ok(slots),
            // 打分排出的月程万一没过校验，就退回只用免费兜底活动的月程。
            Err(first) => self.fallback_plan().map_err(|_| first),
        }
    }

    /// “照上月”：上个月的月程仍然合法、花得起、也不会把人累垮，才原样照排；
    /// 上个月是累了才排的休息，这个月不累（疲劳 < 30）就不再照抄，改按均衡重排。
    fn previous_plan_fits(&self, slots: &[PlanSlot], budget: &UpbringingBudget) -> bool {
        let weekly = self.upbringing_weekly();
        let fits = if weekly {
            self.check_week_plan(OwnerId::Player, slots).is_ok()
        } else {
            self.check_month_plan(OwnerId::Player, slots).is_ok()
        };
        if slots.is_empty() || !fits {
            return false;
        }
        let s = self.state.upbringing.as_ref();
        let next = s.map_or(0, |s| s.next_slot);
        let acts = slots
            .iter()
            .skip(usize::from(next))
            .flat_map(|p| p.lesson.iter().chain(p.after.iter().map(|a| &a.activity)))
            .filter_map(|k| self.defs.upbringing.activity(k))
            .collect::<Vec<_>>();
        let now = s.map_or(0, |s| s.fatigue);
        let idle_rest = now < 30 && acts.iter().any(|a| a.kind == ActivityKind::Rest);
        if weekly {
            // 按周：费用与疲劳按各格的格重折算（八分之一为单位，最后进位）。
            let today = self.cast_date();
            let cost: i64 =
                acts.iter().map(|a| self.upbringing_activity_cost(a) * self.upbringing_weight(a, today)).sum();
            let fatigue: i64 = acts.iter().map(|a| a.fatigue * self.upbringing_weight(a, today)).sum();
            return (cost + weekly::UNIT - 1).div_euclid(weekly::UNIT) <= budget.cash - budget.reserve
                && now + fatigue.div_euclid(weekly::UNIT) < 80
                && !idle_rest;
        }
        let cost: i64 = acts.iter().map(|a| self.upbringing_activity_cost(a)).sum();
        let fatigue = now + acts.iter().map(|a| a.fatigue).sum::<i64>();
        cost <= budget.cash - budget.reserve && fatigue < 80 && !idle_rest
    }

    fn planner<'a>(&'a self, preset: &'a str, budget: &UpbringingBudget) -> Option<Planner<'a>> {
        let s = self.state.upbringing.as_ref()?;
        let conduct = |key: &str| {
            self.defs
                .captain
                .attribute_index(key)
                .and_then(|i| self.defs.captain.group(i))
                .is_some_and(|g| g.key == "conduct")
        };
        let mapped = self.defs.upbringing.rules.auto_presets.get(preset);
        let mut weights = BTreeMap::new();
        if let Some(attrs) = mapped {
            // 偏重的属性 ×3；其中的品行（如社交的感性）再按评价刻度 ×10，与这个预设看的评价一致。
            for a in attrs {
                weights.insert(a.clone(), if conduct(a) { 30 } else { 3 });
            }
        } else if preset == "balanced" {
            // 均衡：落后于平均成长的属性加倍，补短板。
            let visible: Vec<(String, i64)> = self
                .defs
                .captain
                .attributes
                .iter()
                .filter(|a| !a.hidden && a.key != "fortune")
                .map(|a| (a.key.clone(), self.upbringing_growth(&a.key) * if conduct(&a.key) { 10 } else { 1 }))
                .collect();
            let mean = visible.iter().map(|v| v.1).sum::<i64>() / (visible.len().max(1) as i64);
            for (k, v) in visible {
                if v < mean {
                    weights.insert(k, 2);
                }
            }
        }
        let month = s.month;
        let prev = if month[1] <= 1 { [month[0].saturating_sub(1), 12] } else { [month[0], month[1] - 1] };
        let prev2 = if prev[1] <= 1 { [prev[0].saturating_sub(1), 12] } else { [prev[0], prev[1] - 1] };
        let mut last = BTreeSet::new();
        let mut before_last = BTreeSet::new();
        let mut picked = BTreeMap::new();
        let mut social = false;
        let mut recent = BTreeMap::new();
        let today = self.day();
        for j in &s.journal {
            let m = self.upbringing_month_of(j.day);
            for key in &j.result.activities {
                if m == prev {
                    last.insert(key.clone());
                } else if m == prev2 {
                    before_last.insert(key.clone());
                } else if m == month {
                    *picked.entry(key.clone()).or_default() += j.result.weight();
                    social |= self.defs.upbringing.activity(key).is_some_and(|a| social_kind(a.kind));
                }
            }
            if today.saturating_sub(j.day) <= 90 {
                for person in j.result.affinity.keys() {
                    *recent.entry(person.clone()).or_default() += 1;
                }
            }
        }
        // 本月余下的课业要留的学费：按旬是“余下的学院旬数 × 一门课的学费”，按周由预算按格重折好。
        let tuition_left = if self.upbringing_weekly() {
            budget.tuition_left * weekly::UNIT
        } else {
            budget.tuition_left / budget.lesson_cost.max(1) * budget.lesson_cost * weekly::UNIT
        };
        Some(Planner {
            w: self,
            preset,
            weights,
            tag_bonus: mapped.is_none() && preset != "balanced",
            last,
            before_last,
            picked,
            limits: BTreeMap::new(),
            cash: budget.cash,
            fatigue: s.fatigue * weekly::UNIT,
            outings: s.outings,
            planned_outings: 0,
            planned_excursions: 0,
            excursions: s.weekly.excursions,
            excursion_limit: if self.upbringing_weekly() {
                self.upbringing_weekly_rules().map_or(0, |r| r.excursions_per_month)
            } else {
                0
            },
            social,
            reserve: budget.reserve,
            lesson_cost: budget.lesson_cost,
            tuition_left,
            recent,
            horizon: if self.upbringing_weekly() {
                i64::from(weekly::WEEKS - weekly::week_of(self.cast_date()[2]))
            } else {
                1
            },
        })
    }

    fn plan_with(&self, preset: &str, budget: &UpbringingBudget) -> Result<Vec<PlanSlot>, CommandError> {
        let s = self.state.upbringing.as_ref().ok_or_else(|| CommandError::Precondition("当前不是养成阶段".into()))?;
        let mut p =
            self.planner(preset, budget).ok_or_else(|| CommandError::Precondition("当前不是养成阶段".into()))?;
        if self.upbringing_weekly() {
            return self.plan_week_with(p);
        }
        let mut slots = Vec::new();
        for index in 0..3u8 {
            if index < s.next_slot {
                slots.push(s.plan.get(usize::from(index)).cloned().unwrap_or(PlanSlot {
                    index,
                    lesson: None,
                    after: None,
                }));
                continue;
            }
            let date = [s.month[0], s.month[1], 1 + u32::from(index) * 10].max(self.cast_date());
            let stage = self
                .upbringing_stage_on(date)
                .or_else(|| self.upbringing_stage_on(self.cast_date()))
                .ok_or_else(|| CommandError::Precondition("阶段日期无效".into()))?
                .stage;
            let lesson = if stage == Stage::Academy {
                p.tuition_left = (p.tuition_left - p.lesson_cost * weekly::UNIT).max(0);
                Some(p.pick(stage, date, true, false, weekly::UNIT)?.activity)
            } else {
                None
            };
            let force_social = index == 2 && !p.social;
            let after = p.pick(stage, date, false, force_social, weekly::UNIT)?;
            slots.push(PlanSlot { index, lesson, after: Some(after) });
        }
        self.check_month_plan(OwnerId::Player, &slots)?;
        Ok(slots)
    }

    /// 按周（U05）：给本周还没结算的格逐格打分挑选。落在换阶段之后的格留空（到那天按新阶段重排）。
    fn plan_week_with(&self, mut p: Planner<'_>) -> Result<Vec<PlanSlot>, CommandError> {
        let s = self.state.upbringing.as_ref().ok_or_else(|| CommandError::Precondition("当前不是养成阶段".into()))?;
        let today = self.cast_date();
        let now = self.upbringing_stage_on(today).ok_or_else(|| CommandError::Precondition("阶段日期无效".into()))?;
        let layout = self.upbringing_week_slots();
        // 每月至少一格社交或外出：留到本月最后一周的最后一个课余格兜底。
        let last_week = weekly::week_of(today[2]) + 1 >= weekly::WEEKS;
        let last_after = layout.iter().rev().find(|(def, _)| !def.lesson).map(|(def, _)| def.index);
        let mut slots = Vec::new();
        for (def, date) in &layout {
            let index = def.index;
            let empty = PlanSlot { index, lesson: None, after: None };
            if index < s.next_slot {
                slots.push(s.plan.get(usize::from(index)).cloned().unwrap_or(empty));
                continue;
            }
            if self.upbringing_stage_on(*date).is_none_or(|st| st.from != now.from) {
                slots.push(empty);
                continue;
            }
            let weight = i64::from(def.weight);
            if def.lesson {
                p.tuition_left = (p.tuition_left - p.lesson_cost * weight).max(0);
                let lesson = p.pick(now.stage, *date, true, false, weight)?.activity;
                slots.push(PlanSlot { index, lesson: Some(lesson), after: None });
            } else {
                let force_social = last_week && Some(index) == last_after && !p.social;
                let after = p.pick(now.stage, *date, false, force_social, weight)?;
                slots.push(PlanSlot { index, lesson: None, after: Some(after) });
            }
        }
        self.check_week_plan(OwnerId::Player, &slots)?;
        Ok(slots)
    }

    /// 按周的兜底：课业格排免费课（自习），课余格排免费、不需要补选项的活动（通常是休息）。
    fn fallback_week(&self) -> Result<Vec<PlanSlot>, CommandError> {
        let s = self.state.upbringing.as_ref().ok_or_else(|| CommandError::Precondition("当前不是养成阶段".into()))?;
        let today = self.cast_date();
        let now = self.upbringing_stage_on(today).ok_or_else(|| CommandError::Precondition("阶段日期无效".into()))?;
        let stage = now.stage;
        let mut used = BTreeMap::<String, usize>::new();
        let mut slots = Vec::new();
        for (def, date) in self.upbringing_week_slots() {
            let index = def.index;
            let empty = PlanSlot { index, lesson: None, after: None };
            if index < s.next_slot {
                slots.push(s.plan.get(usize::from(index)).cloned().unwrap_or(empty));
                continue;
            }
            if self.upbringing_stage_on(date).is_none_or(|st| st.from != now.from) {
                slots.push(empty);
                continue;
            }
            let lesson = def.lesson;
            let a = self
                .defs
                .upbringing
                .activities
                .iter()
                .filter(|a| {
                    self.upbringing_activity_cost(a) == 0
                        && a.needs.is_empty()
                        && a.stage.allows(stage)
                        && if lesson {
                            a.kind == ActivityKind::Lesson
                        } else {
                            stage == Stage::Home || a.kind != ActivityKind::Lesson
                        }
                })
                .filter(|a| {
                    a.monthly_limit.is_none_or(|limit| {
                        let group = a.monthly_limit_group.as_deref().unwrap_or(&a.key);
                        self.upbringing_monthly_used(group) + used.get(group).copied().unwrap_or(0) < limit as usize
                    })
                })
                .filter(|a| {
                    self.check_upbringing_choice(a, (!lesson).then(|| AfterChoice::activity(&a.key)).as_ref(), date)
                        .is_ok()
                })
                .min_by_key(|a| (a.kind != ActivityKind::Rest, a.key.clone()))
                .ok_or_else(|| CommandError::Precondition("没有免费的兜底活动".into()))?;
            if a.monthly_limit.is_some() {
                *used.entry(a.monthly_limit_group.clone().unwrap_or_else(|| a.key.clone())).or_default() += 1;
            }
            slots.push(if lesson {
                PlanSlot { index, lesson: Some(a.key.clone()), after: None }
            } else {
                PlanSlot { index, lesson: None, after: Some(AfterChoice::activity(&a.key)) }
            });
        }
        self.check_week_plan(OwnerId::Player, &slots)?;
        Ok(slots)
    }

    /// 只用免费、不需要补选项的活动排出的月程：课业格排免费课，课后格排免费活动（通常是休息）。
    fn fallback_plan(&self) -> Result<Vec<PlanSlot>, CommandError> {
        if self.upbringing_weekly() {
            return self.fallback_week();
        }
        let s = self.state.upbringing.as_ref().ok_or_else(|| CommandError::Precondition("当前不是养成阶段".into()))?;
        let mut slots = Vec::new();
        let mut used = BTreeMap::<String, usize>::new();
        for index in 0..3u8 {
            if index < s.next_slot {
                slots.push(s.plan.get(usize::from(index)).cloned().unwrap_or(PlanSlot {
                    index,
                    lesson: None,
                    after: None,
                }));
                continue;
            }
            let date = [s.month[0], s.month[1], 1 + u32::from(index) * 10].max(self.cast_date());
            let stage = self
                .upbringing_stage_on(date)
                .or_else(|| self.upbringing_stage_on(self.cast_date()))
                .ok_or_else(|| CommandError::Precondition("阶段日期无效".into()))?
                .stage;
            let mut free = |lesson: bool| {
                let a = self
                    .defs
                    .upbringing
                    .activities
                    .iter()
                    .filter(|a| {
                        self.upbringing_activity_cost(a) == 0
                            && a.needs.is_empty()
                            && a.stage.allows(stage)
                            && if lesson {
                                a.kind == ActivityKind::Lesson
                            } else {
                                stage == Stage::Home || a.kind != ActivityKind::Lesson
                            }
                    })
                    .filter(|a| {
                        a.monthly_limit.is_none_or(|limit| {
                            let group = a.monthly_limit_group.as_deref().unwrap_or(&a.key);
                            self.upbringing_monthly_used(group) + used.get(group).copied().unwrap_or(0) < limit as usize
                        })
                    })
                    .filter(|a| {
                        self.check_upbringing_choice(a, (!lesson).then(|| AfterChoice::activity(&a.key)).as_ref(), date)
                            .is_ok()
                    })
                    // 先休息，再按 key 固定次序。
                    .min_by_key(|a| (a.kind != ActivityKind::Rest, a.key.clone()))
                    .ok_or_else(|| CommandError::Precondition("没有免费的兜底活动".into()))?;
                if a.monthly_limit.is_some() {
                    *used.entry(a.monthly_limit_group.clone().unwrap_or_else(|| a.key.clone())).or_default() += 1;
                }
                Ok::<_, CommandError>(a.key.clone())
            };
            let lesson = if stage == Stage::Academy { Some(free(true)?) } else { None };
            let after = AfterChoice::activity(&free(false)?);
            slots.push(PlanSlot { index, lesson, after: Some(after) });
        }
        self.check_month_plan(OwnerId::Player, &slots)?;
        Ok(slots)
    }
}

impl Planner<'_> {
    /// 本次排程按正式校验器的周冷却与窗口筛选。
    fn choice_fits(&self, c: &AfterChoice) -> bool {
        if self.w.upbringing_cadence_enabled() {
            (c.companion.is_none() || self.w.cadence_outing_problem(self.planned_outings + 1).is_none())
                && (c.excursion.is_none() || self.w.cadence_excursion_problem(self.planned_excursions + 1).is_none())
        } else {
            (c.companion.is_none() || self.outings < 2)
                && (c.excursion.is_none() || self.excursion_limit == 0 || self.excursions < self.excursion_limit)
        }
    }

    /// 一项活动在本次排程里的实收学费、期望收入与得分；排不上时返回 None。
    fn score(&self, a: &ActivityDef, date: WorldDate, lesson: bool, weight: i64) -> Option<(i64, i64, AfterChoice)> {
        let w = self.w;
        let cost = w.upbringing_activity_cost(a);
        // 这一格实际要付的钱（上界）：整格就是费用本身，按周是“费用 × 格重”向上取整。
        let due = (cost * weight + weekly::UNIT - 1).div_euclid(weekly::UNIT);
        // 课业：付得起、而且不动下个月要留的学费；课后：还要先留出本月剩下几旬的学费。
        let left_tuition = (self.tuition_left + weekly::UNIT - 1).div_euclid(weekly::UNIT);
        let slack = self.cash - self.reserve - if lesson { 0 } else { left_tuition };
        if due > 0 && due > slack {
            return None;
        }
        if let Some(limit) = a.monthly_limit {
            let group = a.monthly_limit_group.as_deref().unwrap_or(&a.key);
            let used = w.upbringing_monthly_used(group) + self.limits.get(group).copied().unwrap_or(0);
            if used >= limit as usize {
                return None;
            }
        }
        let self_study = lesson && cost == 0 && a.skills.is_empty();
        if lesson && !self_study && self.last.contains(&a.key) && self.before_last.contains(&a.key) {
            // 同一门课最多连排两个月。
            return None;
        }
        let choice = if lesson {
            w.check_upbringing_choice(a, None, date).ok()?;
            AfterChoice::activity(&a.key)
        } else {
            let c = w.auto_choice_with(a, date, &self.recent)?;
            if !self.choice_fits(&c) {
                return None;
            }
            c
        };
        // 钱的分量（十分之一单位）：紧 40、偏紧 20、平常 10、宽裕 5、富余（花完还剩 200 以上）2。
        // 钱攒多了就不值得再为它放下功课：手头富余时打工的收入只当零头。
        let after = slack - due;
        let money = if after < 0 || slack < self.lesson_cost.max(6) {
            40
        } else if after < 24 {
            20
        } else if after < 60 {
            10
        } else if after < 200 {
            5
        } else {
            2
        };
        let income = self.expected_income(a);
        let mut score = (income - cost) * money;
        score += self.gains(a);
        score += a.skills.iter().map(|s| s.xp.max(0) * 10 / 4).sum::<i64>();
        // 没写属性映射的预设（如测试世界）只能按标签偏重：带本预设标签的活动压过其余。
        if self.tag_bonus && a.tags.iter().any(|t| t == self.preset) {
            score += 1000 + self.gains(a) / 2;
        }
        let f = self.fatigue.div_euclid(weekly::UNIT);
        if a.kind == ActivityKind::Rest {
            // 疲劳 < 30 休息不算收益；30–59 给一点；≥ 60 才明显偏向休息。
            // 按真能消掉的疲劳折算（以一次整休 22 点为准），宿舍夜谈这类小歇不压过整休。
            let curve = if f < 30 {
                0
            } else if f < 60 {
                (f - 30) * 10 / 6
            } else {
                150 + (f - 60) * 10
            };
            // 这一格真能消掉的疲劳是“休息量 × 格重”，折回标准格再比。
            score += curve * (-a.fatigue).clamp(0, f * weekly::UNIT / weight.max(1)) / 22;
        } else {
            let next = f + a.fatigue.max(0) * weight * self.horizon / weekly::UNIT;
            let k = if next >= 90 {
                30
            } else if next >= 80 {
                6
            } else if next >= 60 {
                2
            } else {
                1
            };
            score -= a.fatigue.max(0) * 5 * k;
        }
        let s = w.state.upbringing.as_ref();
        if s.is_some_and(|s| s.mood < 0) {
            score += a.mood * 5;
        }
        // 轮换：本月排过的递减，上个月排过的扣分，连排两个月的再扣；
        // 休息、自习、钱紧时的打工与约人同行（每次换一个人）不扣。
        let exempt = a.kind == ActivityKind::Rest
            || (a.kind == ActivityKind::Job && money >= 40)
            || self_study
            || choice.companion.is_some();
        if !exempt && score > 0 {
            // 本月排过的递减：每排满一个标准格减 35%。
            let n = self.picked.get(&a.key).copied().unwrap_or(0);
            score = score * (100 - (35 * n / weekly::UNIT).min(90)) / 100;
            if self.last.contains(&a.key) {
                score = score * if lesson { 75 } else { 85 } / 100;
                if self.before_last.contains(&a.key) {
                    score = score * 60 / 100;
                }
            }
        }
        // 约人同行优先于独自外出；“社交”预设每月尽量约满两次。
        if social_kind(a.kind) && choice.companion.is_some() {
            score += if self.preset == "social" { 300 } else { 50 };
        }
        Some((score, due, choice))
    }

    /// 期望收入：成功与失败按概率加权；货币流通打开时不超过当地钱袋。
    fn expected_income(&self, a: &ActivityDef) -> i64 {
        let w = self.w;
        let [lo, hi] = a.income.bounds();
        if hi <= 0 {
            return 0;
        }
        let risk = w.upbringing_risk(a);
        let mid = (lo + hi) / 2;
        let expected = mid * (10_000 - risk) / 10_000 + mid * a.failure.income_pct * risk / 1_000_000;
        if w.circulation_on() {
            let purse = w.upbringing_location().and_then(|l| w.purse(l)).map_or(0, |p| p.money.max(0));
            expected.min(purse)
        } else {
            expected
        }
    }

    /// 期望成长折成评价刻度并乘预设权重（十分之一单位）。
    fn gains(&self, a: &ActivityDef) -> i64 {
        self.w
            .upbringing_expected_gains(a)
            .iter()
            .map(|(key, gain)| gain * self.weights.get(key).copied().unwrap_or(1))
            .sum()
    }

    /// 挑一格：先按分数取最高（同分按 key），没有可排的就退回免费兜底；`social` 要求本格排社交或外出。
    fn pick(
        &mut self,
        stage: Stage,
        date: WorldDate,
        lesson: bool,
        social: bool,
        weight: i64,
    ) -> Result<AfterChoice, CommandError> {
        let w = self.w;
        let candidates = w
            .defs
            .upbringing
            .activities
            .iter()
            .filter(|a| {
                a.stage.allows(stage)
                    && if lesson {
                        a.kind == ActivityKind::Lesson
                    } else {
                        stage == Stage::Home || a.kind != ActivityKind::Lesson
                    }
            })
            .filter_map(|a| self.score(a, date, lesson, weight).map(|(score, cost, c)| (score, cost, a, c)))
            .collect::<Vec<_>>();
        let best = |only_social: bool| {
            candidates
                .iter()
                .filter(|c| !only_social || social_kind(c.2.kind))
                .max_by(|a, b| a.0.cmp(&b.0).then_with(|| b.2.key.cmp(&a.2.key)))
        };
        let chosen = social.then(|| best(true)).flatten().or_else(|| best(false));
        let Some((_, cost, a, c)) = chosen else {
            return Err(CommandError::Precondition("当前没有满足条件的活动，须先补齐书目、同行或学费".into()));
        };
        let (cost, a, c) = (*cost, *a, c.clone());
        self.cash -= cost;
        self.fatigue = (self.fatigue + a.fatigue * weight * self.horizon).clamp(0, 100 * weekly::UNIT);
        *self.picked.entry(a.key.clone()).or_default() += weight;
        if c.excursion.is_some() {
            self.excursions = self.excursions.saturating_add(1);
            self.planned_excursions += 1;
        }
        if a.monthly_limit.is_some() {
            *self.limits.entry(a.monthly_limit_group.clone().unwrap_or_else(|| a.key.clone())).or_default() += 1;
        }
        if c.companion.is_some() {
            self.outings += 1;
            self.planned_outings += 1;
            if let Some(person) = &c.companion {
                *self.recent.entry(person.clone()).or_default() += 1;
            }
        }
        self.social |= social_kind(a.kind);
        Ok(if lesson { AfterChoice::activity(&a.key) } else { c })
    }
}
