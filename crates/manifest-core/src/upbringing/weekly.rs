//! U05：养成排程按周。
//!
//! - **周历**：每月固定四周（1–7、8–14、15–21、22–月末），世界日历一个字不动；一格在它的结算日日末结算，
//!   周末与月末零头是闲日，只在每周第七天做一次自然恢复。
//! - **布局**：`rules.toml [upbringing.weekly]` 按阶段给出课业格、课余格各在周内第几天结算，以及格重
//!   （八分之几个“标准格”；标准格就是按旬时的一格）。寰宇：家乡每周 3 格 × 2/8，学院 3 课业 × 2/8 + 2 课余 × 3/8，
//!   每月合计都仍是 3 个标准格，所以数据文件里的数（成长、经验、学费、收入、疲劳、心情）一个不改。
//! - **进位**：单格实得 = 数据值 × 格重 ÷ 8，向下取整；余数（0–7 个八分之一）按类别记在 [`WeeklyState::carry`]，
//!   下一格接着进位。全是整数，结果只取决于状态。
//! - **常设周课表**：每个阶段一张（[`WeeklyState::home`] / [`WeeklyState::academy`]）。每周第一天自动把课表铺成
//!   本周日程并直接运行；只有某格铺不上（没排、钱不够、门槛变了、次数满、换了阶段）才停在安排阶段。
//!   玩家随时可以用 `PlanWeek` 改本周还没结算的格，改了就写回课表；带补选的活动（约人、去处、书、远足）只管这一周。
//! - **兼容**：规则里没有 `[upbringing.weekly]` 的世界（经典、测试海域、测试夹具）仍按旬，行为逐字节不变；
//!   旧存档读进按周的世界时当月按旬走完，下月 1 日切到按周（[`WeeklyState::on`]）。
use super::*;
use crate::{
    CommandError, CoreError, OwnerId, World,
    log::{LogEvent, LogKind},
};

/// 一个标准格分成八份；格重与进位都以它为单位。
pub const UNIT: i64 = 8;
/// 每月固定四周。
pub const WEEKS: u8 = 4;
/// 一周七天；第四周吃掉月末零头。
pub const WEEK_DAYS: u32 = 7;
/// 一周最多几格（每天至多一格）。
pub const MAX_WEEK_SLOTS: usize = 7;
/// 课后同行每月最多几次（按旬、按周相同）。
const OUTINGS_PER_MONTH: usize = 2;

/// 某一天在本月的第几周（0–3）。
pub fn week_of(day: u32) -> u8 {
    ((day.max(1) - 1) / WEEK_DAYS).min(u32::from(WEEKS) - 1) as u8
}
/// 第几周的首日。
pub fn week_start(week: u8) -> u32 {
    u32::from(week.min(WEEKS - 1)) * WEEK_DAYS + 1
}
/// 第几周的首末日（含）；第四周到月末。
pub fn week_bounds(month_days: u32, week: u8) -> [u32; 2] {
    let start = week_start(week);
    [start, if week >= WEEKS - 1 { month_days.max(start + WEEK_DAYS - 1) } else { start + WEEK_DAYS - 1 }]
}

/// 一个阶段的周布局：课业格与课余格各在周内第几天结算（1–7），以及两栏的格重。
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct WeekLayout {
    /// 课业格（只能排课或自习）的结算日；家乡期留空。
    pub lesson_days: Vec<u8>,
    /// 课业格的格重：八分之几个标准格。
    pub lesson_weight: u8,
    /// 课余格（家乡期就是自由格）的结算日。
    pub after_days: Vec<u8>,
    /// 课余格的格重。
    pub after_weight: u8,
}
/// 布局里的一格。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WeekSlot {
    /// 周内的格序（按结算日先后）。
    pub index: u8,
    /// 周内第几天结算（1–7）。
    pub day: u8,
    /// 课业格（否则是课余 / 自由格）。
    pub lesson: bool,
    /// 格重（八分之几）。
    pub weight: u8,
}
impl WeekLayout {
    /// 按结算日排好的各格。
    pub fn slots(&self) -> Vec<WeekSlot> {
        let mut out: Vec<WeekSlot> = self
            .lesson_days
            .iter()
            .map(|d| (*d, true, self.lesson_weight))
            .chain(self.after_days.iter().map(|d| (*d, false, self.after_weight)))
            .map(|(day, lesson, weight)| WeekSlot { index: 0, day, lesson, weight })
            .collect();
        out.sort_by_key(|s| s.day);
        for (i, s) in out.iter_mut().enumerate() {
            s.index = i as u8;
        }
        out
    }
    fn problem(&self, name: &str, home: bool) -> Option<String> {
        let days: Vec<u8> = self.lesson_days.iter().chain(&self.after_days).copied().collect();
        let distinct: BTreeSet<u8> = days.iter().copied().collect();
        if days.is_empty() || days.len() > MAX_WEEK_SLOTS || distinct.len() != days.len() {
            return Some(format!("upbringing.weekly.{name}：每周须有 1–7 格，结算日不能重复"));
        }
        if days.iter().any(|d| !(1..=WEEK_DAYS as u8).contains(d)) {
            return Some(format!("upbringing.weekly.{name}：结算日须在 1–7"));
        }
        if self.after_days.is_empty() || (home && !self.lesson_days.is_empty()) {
            return Some(format!("upbringing.weekly.{name}：家乡期只有自由格，学院期至少要有一个课余格"));
        }
        let weight = |w: u8| (1..=UNIT as u8).contains(&w);
        if !weight(self.after_weight) || (!self.lesson_days.is_empty() && !weight(self.lesson_weight)) {
            return Some(format!("upbringing.weekly.{name}：格重须在 1–8（八分之几个标准格）"));
        }
        None
    }
}

/// 按周排程的规则（`rules.toml [upbringing.weekly]`）；不写这一段的世界按旬。
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct WeeklyRules {
    pub home: WeekLayout,
    pub academy: WeekLayout,
    /// 每月最多几次远足（0 = 不限）：远足的步骤与奖励按次给，不随格重缩小，所以另设上限。
    pub excursions_per_month: u8,
}
impl Default for WeeklyRules {
    fn default() -> Self {
        Self {
            home: WeekLayout { lesson_days: Vec::new(), lesson_weight: 0, after_days: vec![2, 4, 6], after_weight: 2 },
            academy: WeekLayout {
                lesson_days: vec![1, 3, 5],
                lesson_weight: 2,
                after_days: vec![2, 4],
                after_weight: 3,
            },
            excursions_per_month: 3,
        }
    }
}
impl WeeklyRules {
    pub fn layout(&self, stage: Stage) -> &WeekLayout {
        match stage {
            Stage::Home => &self.home,
            Stage::Academy => &self.academy,
        }
    }
    /// 数据校验用：说不通的取值。
    pub fn problems(&self) -> Vec<String> {
        [self.home.problem("home", true), self.academy.problem("academy", false)].into_iter().flatten().collect()
    }
}

/// 按周排程的状态；全空（按旬的世界、还没切换的旧档）时不落盘。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct WeeklyState {
    /// 本月按周排程。旧档读进来是 false：当月按旬走完，下月 1 日起为 true。
    pub on: bool,
    /// 常设周课表（家乡期）：下标就是周内的格序；两栏都空的格表示还没排。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub home: Vec<PlanSlot>,
    /// 常设周课表（学院期）。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub academy: Vec<PlanSlot>,
    /// 进位余数（八分之一，恒在 0–7）：`growth:<属性>`、`skill:<技能>`、`cost`、`income`、`fatigue`、`mood`、
    /// `count:<活动>`、`job:<工种>`、`item:<活动>:<物品>`、`craft:<活动>`、`recovery`。
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub carry: BTreeMap<String, i64>,
    /// 按周结算折成的标准旬数（八分之一）；`completed_slots` = 按旬结算的旬数 + 这个数 ÷ 8。
    #[serde(skip_serializing_if = "is_zero")]
    pub slots: i64,
    /// 本月已经走过的远足次数。
    #[serde(skip_serializing_if = "is_zero_u8")]
    pub excursions: u8,
    /// 上次考试时各补习活动的进度（八分之一次），键是 `考试/活动`：补考前要求比它多（“有进展”）。
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub remediation: BTreeMap<String, i64>,
}
/// [`WeeklyState::remediation`] 的键。
pub fn remediation_key(exam: &str, activity: &str) -> String {
    format!("{exam}/{activity}")
}
fn is_zero(v: &i64) -> bool {
    *v == 0
}
fn is_zero_u8(v: &u8) -> bool {
    *v == 0
}
impl WeeklyState {
    pub fn is_default(&self) -> bool {
        *self == Self::default()
    }
    pub fn timetable(&self, stage: Stage) -> &[PlanSlot] {
        match stage {
            Stage::Home => &self.home,
            Stage::Academy => &self.academy,
        }
    }
    fn timetable_mut(&mut self, stage: Stage) -> &mut Vec<PlanSlot> {
        match stage {
            Stage::Home => &mut self.home,
            Stage::Academy => &mut self.academy,
        }
    }
}

/// 这一格的补选只管这一周（约人、去处、某本书、远足）：不写回常设课表。
pub fn one_off(slot: &PlanSlot) -> bool {
    slot.after.as_ref().is_some_and(|c| {
        c.place.is_some() || c.companion.is_some() || c.book.is_some() || c.excursion.is_some() || c.node.is_some()
    })
}
/// 这一格排了什么（课业或课余，只会有一个）。
pub fn slot_activity(slot: &PlanSlot) -> Option<&str> {
    slot.lesson.as_deref().or_else(|| slot.after.as_ref().map(|a| a.activity.as_str()))
}
/// “数据值 × 格重”四舍五入到整数（显示用：活动卡片上的单格值）。
pub fn rounded(value: i64, weight: i64) -> i64 {
    if weight >= UNIT {
        return value;
    }
    let x = value * weight;
    if x >= 0 { (x + UNIT / 2).div_euclid(UNIT) } else { -((-x + UNIT / 2).div_euclid(UNIT)) }
}
fn blocked(s: &str) -> CommandError {
    CommandError::Precondition(s.into())
}
#[cfg(test)]
mod tests;

impl World {
    pub fn upbringing_weekly_rules(&self) -> Option<&WeeklyRules> {
        self.defs.rules.upbringing.weekly.as_ref()
    }
    /// 本月是不是按周排程（规则写了按周、而且这一局已经切过去）。
    pub fn upbringing_weekly(&self) -> bool {
        self.upbringing_weekly_rules().is_some() && self.state.upbringing.as_ref().is_some_and(|s| s.weekly.on)
    }
    /// 某一天所在阶段的周布局；按旬时为 None。
    pub fn upbringing_week_layout(&self, date: WorldDate) -> Option<Vec<WeekSlot>> {
        if !self.upbringing_weekly() {
            return None;
        }
        let stage = self.upbringing_stage_on(date).or_else(|| self.upbringing_stage_on(self.cast_date()))?.stage;
        Some(self.upbringing_weekly_rules()?.layout(stage).slots())
    }
    /// 本周各格与它们的结算日期（按旬时为空）。
    pub fn upbringing_week_slots(&self) -> Vec<(WeekSlot, WorldDate)> {
        let today = self.cast_date();
        let start = week_start(week_of(today[2]));
        self.upbringing_week_layout(today)
            .unwrap_or_default()
            .into_iter()
            .map(|s| (s, [today[0], today[1], start + u32::from(s.day) - 1]))
            .collect()
    }
    /// 本周第一个“结算日不早于今天”的格序（没有就是格数）。
    fn week_next_slot(&self) -> u8 {
        let today = self.cast_date();
        let slots = self.upbringing_week_slots();
        slots.iter().position(|(_, d)| *d >= today).unwrap_or(slots.len()) as u8
    }
    /// 一项活动排在某天占的格重（八分之几）；按旬时恒为整格。
    pub fn upbringing_weight(&self, a: &ActivityDef, date: WorldDate) -> i64 {
        if !self.upbringing_weekly() {
            return UNIT;
        }
        let Some(rules) = self.upbringing_weekly_rules() else { return UNIT };
        let stage = self
            .upbringing_stage_on(date)
            .or_else(|| self.upbringing_stage_on(self.cast_date()))
            .map_or(Stage::Home, |s| s.stage);
        let layout = rules.layout(stage);
        i64::from(if stage == Stage::Academy && a.kind == ActivityKind::Lesson && !layout.lesson_days.is_empty() {
            layout.lesson_weight
        } else {
            layout.after_weight
        })
    }
    /// 一格要付的钱的上界：实收费用 × 格重，向上取整（实际按进位收，不会超过它）。
    pub fn upbringing_slot_cost(&self, a: &ActivityDef, date: WorldDate) -> i64 {
        if self.act_running() {
            return self.act_lesson_fee(a);
        }
        let cost = self.upbringing_activity_cost(a);
        let weight = self.upbringing_weight(a, date);
        if weight >= UNIT { cost } else { (cost * weight + UNIT - 1).div_euclid(UNIT) }
    }
    /// 进位里某一类的余数（八分之一）。
    pub fn upbringing_carry_of(&self, key: &str) -> i64 {
        self.state.upbringing.as_ref().and_then(|s| s.weekly.carry.get(key)).copied().unwrap_or(0)
    }
    /// 把“数据值 × 格重”折成整数：向下取整，余数（0–7 个八分之一）按 `key` 记下，下一次接着进位。整格（格重 8）原样返回。
    pub(crate) fn upbringing_carry(&mut self, key: &str, amount: i64, weight: i64) -> i64 {
        if weight >= UNIT {
            return amount;
        }
        self.upbringing_carry_eighths(key, amount.saturating_mul(weight))
    }
    /// 同上，直接给八分之一为单位的量。
    pub(crate) fn upbringing_carry_eighths(&mut self, key: &str, eighths: i64) -> i64 {
        let Some(s) = &mut self.state.upbringing else { return 0 };
        let total = s.weekly.carry.get(key).copied().unwrap_or(0).saturating_add(eighths);
        let rest = total.rem_euclid(UNIT);
        if rest == 0 {
            s.weekly.carry.remove(key);
        } else {
            s.weekly.carry.insert(key.into(), rest);
        }
        total.div_euclid(UNIT)
    }
    /// 一项活动累计做了多少（八分之一次）：整数次数 × 8 + 进位里的余数。
    pub fn upbringing_activity_eighths(&self, key: &str) -> i64 {
        let whole = self.state.upbringing.as_ref().and_then(|s| s.activity_counts.get(key)).copied().unwrap_or(0);
        i64::from(whole) * UNIT + self.upbringing_carry_of(&format!("count:{key}"))
    }
    /// “某项活动做满 `times` 次”。次数按格重累计（按周时一格不到一次）；只要求一次的，有进展（含进位余数）就算做过。
    pub fn upbringing_activity_done(&self, key: &str, times: u32) -> bool {
        let whole = self.state.upbringing.as_ref().and_then(|s| s.activity_counts.get(key)).copied().unwrap_or(0);
        whole >= times || (times == 1 && self.upbringing_carry_of(&format!("count:{key}")) > 0)
    }
    /// 累计结算过的标准旬数：按旬结算的旬数，加上按周结算折成的。
    pub fn upbringing_completed_slots(&self) -> i64 {
        self.state.upbringing.as_ref().map_or(0, |s| s.settled.len() as i64 + s.weekly.slots.div_euclid(UNIT))
    }
    /// 日记里上过多少堂课（标准格）：按周的记录按格重折算。
    pub fn upbringing_lessons_done(&self) -> i64 {
        let Some(s) = &self.state.upbringing else { return 0 };
        s.journal
            .iter()
            .map(|j| {
                let lessons = j
                    .result
                    .activities
                    .iter()
                    .filter(|k| self.defs.upbringing.activity(k).is_some_and(|a| a.kind == ActivityKind::Lesson))
                    .count() as i64;
                lessons * j.result.weight()
            })
            .sum::<i64>()
            .div_euclid(UNIT)
    }
    /// 事件门槛“最近做过某活动”看的那一批结算。按旬：刚结算的那一旬。按周：事件仍在每月 1、11、21 日排期，
    /// 看的是最近一个排期日之前那一旬（上月 21 日至月末、1–10 日、11–20 日）里结算的各格——到下一个排期日之前不变。
    pub(crate) fn upbringing_recent_results(&self) -> Vec<&SlotResult> {
        let Some(s) = &self.state.upbringing else { return Vec::new() };
        if !self.upbringing_weekly() {
            return s.last.last().into_iter().collect();
        }
        if self.upbringing_cadence_enabled() {
            return s.journal.last().map(|j| &j.result).into_iter().collect();
        }
        let date = self.cast_date();
        let scheduled = match date[2] {
            21.. => 21,
            11.. => 11,
            _ => 1,
        };
        let Some(until) = self.day().checked_sub(date[2] - scheduled) else { return Vec::new() };
        let Some(last) = until.checked_sub(1) else { return Vec::new() };
        let span = if scheduled == 1 { self.defs.calendar.month_days(last).saturating_sub(20) } else { 10 };
        let from = until.saturating_sub(span);
        s.journal.iter().filter(|j| from <= j.day && j.day <= last).map(|j| &j.result).collect()
    }
    /// 本月余下的课业格（八分之一个标准格）：本周还没结算的，加上后面几周的。预算留学费用。
    pub(crate) fn week_lessons_left(&self) -> i64 {
        let Some(s) = &self.state.upbringing else { return 0 };
        let today = self.cast_date();
        let this_week: i64 = self
            .upbringing_week_slots()
            .iter()
            .skip(usize::from(s.next_slot))
            .filter(|(def, date)| {
                def.lesson && self.upbringing_stage_on(*date).is_some_and(|st| st.stage == Stage::Academy)
            })
            .map(|(def, _)| i64::from(def.weight))
            .sum();
        let Some(rules) = self.upbringing_weekly_rules() else { return this_week };
        let later: i64 = (week_of(today[2]) + 1..WEEKS)
            .filter_map(|week| self.upbringing_stage_on([today[0], today[1], week_start(week)]))
            .map(|st| {
                let layout = rules.layout(st.stage);
                if st.stage == Stage::Academy {
                    layout.lesson_days.len() as i64 * i64::from(layout.lesson_weight)
                } else {
                    0
                }
            })
            .sum();
        this_week + later
    }
    /// 排程用的命令：按周的月份是 `PlanWeek`，按旬是 `PlanMonth`。
    pub fn upbringing_plan_command(&self, slots: Vec<PlanSlot>) -> crate::Command {
        if self.upbringing_weekly() {
            crate::Command::PlanWeek { owner: OwnerId::Player, slots }
        } else {
            crate::Command::PlanMonth { owner: OwnerId::Player, slots }
        }
    }
    /// 开局或换月时进入按周：记下模式，把“下一格”定在本周第一个结算日不早于今天的格。
    pub(crate) fn enter_weekly(&mut self) {
        if self.upbringing_weekly_rules().is_none() {
            return;
        }
        if let Some(s) = &mut self.state.upbringing {
            s.weekly.on = true;
        }
        let next = self.week_next_slot();
        if let Some(s) = &mut self.state.upbringing {
            s.next_slot = next;
        }
    }
    /// 周中换阶段：本周余下的格按新阶段的布局重排（调用方已经清掉日程）。
    pub(crate) fn restage_week(&mut self) {
        let next = self.week_next_slot();
        if let Some(s) = &mut self.state.upbringing {
            s.next_slot = next;
            // 旧布局的回顾与新布局的格序对不上，留在日记里就够了。
            s.last.clear();
        }
    }

    pub fn check_week_plan(&self, owner: OwnerId, slots: &[PlanSlot]) -> Result<(), CommandError> {
        self.week_plan_problem(owner, slots).map_or(Ok(()), |(_, e)| Err(e))
    }
    /// 周程哪里排不上：（格序，原因）；整张都不对时格序为 None。排得上返回 None。
    pub fn week_plan_problem(&self, owner: OwnerId, slots: &[PlanSlot]) -> Option<(Option<u8>, CommandError)> {
        if owner != OwnerId::Player {
            return Some((None, CommandError::NotOwner));
        }
        let Some(s) = self.state.upbringing.as_ref() else { return Some((None, blocked("当前不是养成阶段"))) };
        if !self.upbringing_weekly() {
            return Some((None, blocked("本月按旬排程，请提交月程")));
        }
        if !self.upbringing_active() || s.skipping || !matches!(s.phase, Phase::Plan | Phase::Running) {
            return Some((None, blocked("现在不能安排周程")));
        }
        let today = self.cast_date();
        let layout = self.upbringing_week_slots();
        if slots.len() != layout.len() {
            return Some((None, blocked("周程的格数与本周不符")));
        }
        if slots.iter().enumerate().any(|(i, p)| usize::from(p.index) != i) {
            return Some((None, blocked("格序必须从 0 起依次排列")));
        }
        let next = usize::from(s.next_slot);
        let planned = |f: &dyn Fn(&AfterChoice) -> bool| {
            slots.iter().skip(next).filter(|p| p.after.as_ref().is_some_and(f)).count()
        };
        if let Some(key) = self.cadence_outing_problem(planned(&|c| c.companion.is_some())) {
            return Some((None, blocked(key)));
        }
        if let Some(key) = self.cadence_excursion_problem(planned(&|c| c.excursion.is_some())) {
            return Some((None, blocked(key)));
        }
        if !self.upbringing_cadence_enabled()
            && usize::from(s.outings) + planned(&|c| c.companion.is_some()) > OUTINGS_PER_MONTH
        {
            return Some((None, blocked("每月最多两次课后同行")));
        }
        let limit = self.upbringing_weekly_rules().map_or(0, |r| usize::from(r.excursions_per_month));
        if !self.upbringing_cadence_enabled()
            && limit > 0
            && usize::from(s.weekly.excursions) + planned(&|c| c.excursion.is_some()) > limit
        {
            return Some((None, CommandError::Precondition(format!("每月最多 {limit} 次远足"))));
        }
        let Some(stage_now) = self.upbringing_stage_on(today) else {
            return Some((None, blocked("阶段日期无效")));
        };
        let mut monthly = BTreeMap::<String, usize>::new();
        for (slot, (def, date)) in slots.iter().zip(&layout).skip(next) {
            let at = Some(def.index);
            // 这一格落在换阶段之后：到那天会按新阶段的布局重排，现在不校验。
            if self.upbringing_stage_on(*date).is_none_or(|st| st.from != stage_now.from) {
                continue;
            }
            let stage = stage_now.stage;
            if def.lesson != slot.lesson.is_some() || def.lesson == slot.after.is_some() {
                return Some((at, blocked("课业格只排课或自习，课余格排课业以外的活动，每格一项")));
            }
            let Some(key) = slot_activity(slot) else { return Some((at, blocked("这一格还没有排"))) };
            let Some(activity) = self.defs.upbringing.activity(key) else {
                return Some((at, CommandError::NotFound(key.into())));
            };
            if let Some(limit) = activity.monthly_limit {
                let group = activity.monthly_limit_group.as_deref().unwrap_or(&activity.key);
                let used = monthly.entry(group.into()).or_insert_with(|| self.upbringing_monthly_used(group));
                *used += 1;
                if *used > limit as usize {
                    return Some((at, blocked("周程超过活动的每月次数限制")));
                }
            }
            if let Err(e) = self.check_upbringing_choice(activity, slot.after.as_ref(), *date) {
                return Some((at, e));
            }
            if !activity.stage.allows(stage)
                || (def.lesson && activity.kind != ActivityKind::Lesson)
                || (!def.lesson && stage == Stage::Academy && activity.kind == ActivityKind::Lesson)
            {
                return Some((at, blocked("活动不适用于这一格")));
            }
        }
        None
    }
    /// 常设课表铺成的本周日程（不校验）；课表里本周余下的格有没排的，返回那一格的格序。
    pub fn upbringing_timetable_week(&self) -> Result<Vec<PlanSlot>, Option<u8>> {
        let s = self.state.upbringing.as_ref().ok_or(None)?;
        let stage = self.upbringing_stage_on(self.cast_date()).ok_or(None)?.stage;
        let layout = self.upbringing_week_slots();
        let table = s.weekly.timetable(stage);
        let mut out = Vec::with_capacity(layout.len());
        for (def, _) in &layout {
            let slot = table.get(usize::from(def.index));
            let filled = slot.is_some_and(|p| def.lesson == p.lesson.is_some() && def.lesson != p.after.is_some());
            if !filled && def.index >= s.next_slot {
                return Err(Some(def.index));
            }
            out.push(PlanSlot {
                index: def.index,
                lesson: slot.filter(|_| filled).and_then(|p| p.lesson.clone()),
                after: slot.filter(|_| filled).and_then(|p| p.after.clone()),
            });
        }
        if out.is_empty() { Err(None) } else { Ok(out) }
    }
    /// 常设课表这一周为什么铺不上：（格序，原因）；铺得上（或不在按周的安排里）返回 None。视图用它标出要改的格。
    pub fn upbringing_timetable_problem(&self) -> Option<(Option<u8>, String)> {
        if !self.upbringing_weekly() {
            return None;
        }
        match self.upbringing_timetable_week() {
            Err(at) => Some((at, "这一格还没有排".into())),
            Ok(slots) => self.week_plan_problem(OwnerId::Player, &slots).map(|(at, e)| (at, e.to_string())),
        }
    }
    /// 把常设课表铺成本周日程并开始运行；铺不上就留在安排阶段，等玩家改。
    pub(crate) fn lay_week_from_timetable(&mut self) {
        let waiting = self
            .state
            .upbringing
            .as_ref()
            .is_some_and(|s| s.weekly.on && !s.skipping && s.phase == Phase::Plan && s.plan.is_empty());
        if !waiting || !self.upbringing_active() {
            return;
        }
        let Ok(slots) = self.upbringing_timetable_week() else { return };
        if self.week_plan_problem(OwnerId::Player, &slots).is_none() {
            self.apply_week_plan(slots, false);
        }
    }
    /// 落实周程：已经结算的格保留原样；`remember` 时把没带补选的格写回常设课表。
    pub(crate) fn apply_week_plan(&mut self, mut slots: Vec<PlanSlot>, remember: bool) {
        let stage = self.upbringing_stage_on(self.cast_date()).map(|s| s.stage);
        if let Some(s) = &mut self.state.upbringing {
            let next = usize::from(s.next_slot);
            let empty = |i: usize| PlanSlot { index: i as u8, lesson: None, after: None };
            if remember && let Some(stage) = stage {
                let table = s.weekly.timetable_mut(stage);
                if table.len() != slots.len() {
                    let old = std::mem::take(table);
                    *table = (0..slots.len()).map(|i| old.get(i).cloned().unwrap_or(empty(i))).collect();
                }
                for (i, slot) in slots.iter().enumerate() {
                    // 空着的格（换阶段之后到时重排的）与带补选的格不进课表。
                    if slot_activity(slot).is_none() || one_off(slot) {
                        continue;
                    }
                    // 还没结算的格写回课表；已经过去的格（开局或换阶段落在周中）只在课表那一格还空着时记下，
                    // 这样头一周交上来的整张周程下周就能自动铺开。
                    if i >= next || slot_activity(&table[i]).is_none() {
                        table[i] = slot.clone();
                    }
                }
            }
            for (i, slot) in slots.iter_mut().enumerate().take(next) {
                *slot = s.plan.get(i).cloned().unwrap_or(empty(i));
            }
            if s.plan.get(next) != slots.get(next) {
                // 下一格换了内容：读书的准备重新来。
                s.reading_slot = None;
            }
            s.plan = slots;
            s.phase = Phase::Running;
        }
        self.register_planned_contests();
        self.prepare_upbringing_reading();
        self.prepare_training_fleet();
    }

    /// 按周的日末：结算日到了的那一格结算；每周第七天做一次自然恢复。
    pub(crate) fn finish_week_day(&mut self) -> Result<(), CoreError> {
        let Some(s) = self.state.upbringing.as_ref() else { return Ok(()) };
        if s.skipping || s.phase != Phase::Running {
            return Ok(());
        }
        let today = self.cast_date();
        let layout = self.upbringing_week_slots();
        // 结算日已经过去的格（开局或换阶段落在周中）不补结算。
        let next = self.week_next_slot().max(s.next_slot);
        if let Some(s) = &mut self.state.upbringing {
            s.next_slot = next;
        }
        if let Some((def, _)) = layout.get(usize::from(next)).filter(|(_, date)| *date == today) {
            self.settle_week_slot(*def)?;
        }
        if today[2] == week_start(week_of(today[2])) + WEEK_DAYS - 1 {
            self.settle_week_rest();
        }
        Ok(())
    }
    fn settle_week_slot(&mut self, def: WeekSlot) -> Result<(), CoreError> {
        let date = self.cast_date();
        let index = def.index;
        let slot = self
            .state
            .upbringing
            .as_ref()
            .and_then(|s| s.plan.get(usize::from(index)).cloned())
            .ok_or_else(|| CoreError::Internal("周程缺少待结算的格".into()))?;
        let key = slot_activity(&slot).ok_or_else(|| CoreError::Internal("周程待结算的格是空的".into()))?;
        let a =
            self.defs.upbringing.activity(key).cloned().ok_or_else(|| CoreError::Internal("周程活动已失效".into()))?;
        let stage = self.upbringing_stage_on(date).map(|s| s.stage);
        let mut result = SlotResult {
            index,
            eighths: def.weight,
            title: a.name.clone(),
            activities: vec![a.key.clone()],
            scene: a.scene.clone(),
            ..Default::default()
        };
        let mut events = Vec::new();
        let choice = slot.after.as_ref();
        let declined = match choice {
            Some(c) if self.upbringing_activity_available(&a, date).is_ok() => {
                !self.settle_local_choice(&a, c, index, &mut result)?
            }
            _ => false,
        };
        if !declined {
            let weight = i64::from(def.weight);
            events.extend(self.settle_upbringing_activity_weighted(&a, index, 0, weight, &mut result)?);
            if result.success != Some(false)
                && let Some(c) = choice
            {
                events.extend(self.settle_week_excursion(c, index, &mut result)?);
                if let Some(place) =
                    c.place.as_ref().and_then(|key| self.upbringing_places().iter().find(|p| &p.key == key))
                {
                    events.extend(place.events.iter().cloned());
                }
            }
            result.success = Some(result.success.unwrap_or(true));
        }
        events.extend(self.settle_upbringing_low_mood());
        self.refresh_upbringing_goals()?;
        self.refresh_upbringing_unlocks(false);
        // 标准旬数：家乡的格都算；学院只算课业格（按旬时一旬的课业与课后合算一旬）。
        let share = if def.lesson || stage != Some(Stage::Academy) { i64::from(def.weight) } else { 0 };
        let week_first = self.state.day.saturating_sub(date[2] - week_start(week_of(date[2])));
        if let Some(s) = &mut self.state.upbringing {
            s.next_slot = index + 1;
            s.weekly.slots += share;
            // 上一周的回顾留到本周第一格结算时才清：周一停下来时还看得到。
            if s.journal.last().is_none_or(|j| j.day < week_first) {
                s.last.clear();
            }
            s.journal.push(JournalEntry { day: self.state.day, result: result.clone() });
            s.last.push(result.clone());
            for event in &events {
                if !s.event_backlog.contains(event) {
                    s.event_backlog.push(event.clone());
                }
            }
        }
        self.trigger_cadence_events(&events, &result);
        self.push_log(LogEvent {
            day: self.day(),
            kind: LogKind::UpbringingSettled { month: [date[0], date[1]], slot: index },
        });
        Ok(())
    }
    /// 远足的步骤与奖励按次给（不随格重缩小），所以每月限次；条件在这一周里变了（节点已经解开等）就只做活动本身。
    fn settle_week_excursion(
        &mut self,
        choice: &AfterChoice,
        index: u8,
        result: &mut SlotResult,
    ) -> Result<Vec<String>, CoreError> {
        let (Some(key), Some(node)) = (&choice.excursion, &choice.node) else { return Ok(Vec::new()) };
        let limit = self.upbringing_weekly_rules().map_or(0, |r| r.excursions_per_month);
        let used = self.state.upbringing.as_ref().map_or(0, |s| s.weekly.excursions);
        if let Some(key) = self.cadence_excursion_problem(1) {
            result.line = Some(key.into());
            return Ok(Vec::new());
        }
        if !self.upbringing_cadence_enabled() && limit > 0 && used >= limit {
            result.line = Some("这个月出门的次数已经用完了".into());
            return Ok(Vec::new());
        }
        if let Err(e) = self.check_excursion(key, node) {
            result.line = Some(e.to_string());
            return Ok(Vec::new());
        }
        let cadence = self.upbringing_cadence_enabled();
        let week = super::cadence::week_index(&self.defs, self.day());
        let keep = self.upbringing_cadence_rules().map_or(3, |r| usize::from(r.excursions_per_4_weeks));
        if let Some(s) = &mut self.state.upbringing {
            if cadence {
                s.cadence.excursion_weeks.retain(|w| week.saturating_sub(*w) < 4);
                s.cadence.excursion_weeks.push(week);
                if s.cadence.excursion_weeks.len() > keep {
                    s.cadence.excursion_weeks.remove(0);
                }
            }
            s.weekly.excursions = s.weekly.excursions.saturating_add(1);
        }
        self.settle_excursion(choice, index, result)
    }
    /// 周末的自然恢复：每旬恢复量 × 3（一个月三旬）摊到四周，同样走进位（每旬 5 → 每周 3.75）。
    fn settle_week_rest(&mut self) {
        let Some(per_slot) = self.defs.upbringing.rules.mood.as_ref().map(|r| r.fatigue_recovery.max(0)) else {
            return;
        };
        let whole = self.upbringing_carry("recovery", per_slot * 3, UNIT / i64::from(WEEKS));
        if let Some(s) = &mut self.state.upbringing {
            let recovered = s.fatigue.clamp(0, whole.max(0));
            s.fatigue -= recovered;
            s.stamina = (100 - s.fatigue).clamp(0, 100);
        }
    }
    /// 存档里按周的部分有没有说不通的地方。
    pub(crate) fn weekly_snapshot_problem(&self) -> bool {
        let Some(s) = &self.state.upbringing else { return false };
        let w = &s.weekly;
        let table_bad = |t: &[PlanSlot]| {
            t.len() > MAX_WEEK_SLOTS
                || t.iter()
                    .enumerate()
                    .any(|(i, p)| usize::from(p.index) != i || (p.lesson.is_some() && p.after.is_some()))
        };
        self.cadence_snapshot_problem()
            || w.carry.values().any(|v| !(1..UNIT).contains(v))
            || w.slots < 0
            || table_bad(&w.home)
            || table_bad(&w.academy)
    }
}
