//! U04 工作包 5（A13）：年度目标卡。
//!
//! 每家每年几张可选的“这一年的目标”。目标的条件用 story2 的 [`Objective`]（完成判定也走 story2 的目标检查），
//! 奖励用 story2 的 [`Effect`]（只许成长、技能经验、物品、回忆）。引擎只做“年度目标轨道”：
//! - 入队：养成进行中，到了目标所在的年份就记为进行中；
//! - 完成判定：每天日初与每旬结算之后检查，条件全满足就记为完成并当场发奖励；
//! - 过了那一年还没完成的记为错过，不罚。
//!
//! 目标的文字 `text` 可以为空（由 Claude 后写），视图给空值，界面回退一条通用语。
use super::*;
use crate::{
    CoreError, World,
    story2::{Effect, Objective},
};

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AnnualGoalDef {
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub family: String,
    /// 公历年份（养成期第几年由家庭阶段决定）。
    pub year: u32,
    /// 目标文字；空时界面回退通用语。
    #[serde(default)]
    pub text: String,
    pub objectives: Vec<Objective>,
    #[serde(default)]
    pub rewards: Vec<Effect>,
    /// 只在设了这个旗标的局里发（改投学院路线的那一张，见 [`super::AcademyRoute`]）。
    #[serde(default)]
    pub flag: Option<String>,
    /// 设了这个旗标的局里不发（被改投路线换掉的那一张）。
    #[serde(default)]
    pub not_flag: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GoalStatus {
    Active,
    Done,
    Missed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoalState {
    pub status: GoalStatus,
    /// 入队的日子（目标检查里的“等待”类条件从这天算）。
    pub since: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done: Option<u32>,
}

/// 一个目标条件的进度：`key` 稳定（同 reach 的差项键），`label` 取数据里的显示名。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GoalProgress {
    pub key: String,
    pub label: String,
    pub have: i64,
    pub need: i64,
    pub done: bool,
}

fn bond_rank(b: Option<crate::cast::relations::Bond>) -> i64 {
    use crate::cast::relations::Bond;
    match b {
        None => 0,
        Some(Bond::C) => 1,
        Some(Bond::B) => 2,
        Some(Bond::A) => 3,
        Some(Bond::S) => 4,
    }
}

impl World {
    /// 本局主角家庭的全部年度目标（数据顺序；按改投路线的旗标取舍）。
    pub fn upbringing_annual_goals(&self) -> Vec<&AnnualGoalDef> {
        let Some(s) = self.state.upbringing.as_ref() else { return Vec::new() };
        self.defs
            .upbringing
            .annual_goals
            .iter()
            .filter(|g| g.family == s.family && self.upbringing_goal_applies(g))
            .collect()
    }

    fn upbringing_goal_applies(&self, g: &AnnualGoalDef) -> bool {
        g.flag.as_deref().is_none_or(|f| self.upbringing_flag(f))
            && g.not_flag.as_deref().is_none_or(|f| !self.upbringing_flag(f))
    }

    /// 某个目标条件的进度（现有、需要、是否完成）。
    pub fn upbringing_goal_progress(&self, o: &Objective, since: u32) -> GoalProgress {
        use crate::story2::ObjectiveKind::*;
        let done = self.story2_objective_done(o, since);
        let (key, label, have, need) = match &o.kind {
            Attr { attr, ge } => (format!("attr:{attr}"), self.attr_label(attr), self.story2_check_value(attr), *ge),
            Growth { attr, ge } => (format!("growth:{attr}"), self.attr_label(attr), self.upbringing_growth(attr), *ge),
            Skill { skill, ge } => {
                let label = self
                    .defs
                    .story2
                    .skill_labels
                    .iter()
                    .find(|l| &l.key == skill)
                    .map_or_else(|| skill.clone(), |l| l.name.clone());
                (format!("skill:{skill}"), label, self.upbringing_skill_xp(skill), *ge)
            }
            Cash { ge } => (
                "cash".into(),
                "现款".into(),
                self.state.agents.get(&crate::OwnerId::Player).map_or(0, |a| a.cash),
                *ge,
            ),
            Affinity { person, ge } => (
                format!("affinity:{person}"),
                self.person_label(person),
                self.affection(person).map_or(0, |a| a.affinity),
                *ge,
            ),
            Bond { person, level } => (
                format!("bond:{person}"),
                self.person_label(person),
                bond_rank(self.affection(person).and_then(|a| a.bond)),
                bond_rank(Some(*level)),
            ),
            Visited { .. }
            | PortsKnown { .. }
            | HouseLevel { .. }
            | Warehouse { .. }
            | Industries { .. }
            | Ships { .. }
            | ShipTier { .. }
            | Mates { .. }
            | Post { .. }
            | Rank { .. }
            | Deed { .. } => {
                let (have, need) =
                    o.kind.condition().and_then(|c| self.quest_condition_progress(&c, since, None)).unwrap_or((0, 1));
                (format!("quest:{:?}", o.kind), String::new(), have, need)
            }
            other => {
                let kind = format!("{other:?}");
                (kind.split([' ', '{']).next().unwrap_or("objective").to_lowercase(), String::new(), 0, 1)
            }
        };
        GoalProgress { key, label, have: if done { have.max(need) } else { have }, need, done }
    }

    /// 年度目标轨道：入队、过年作废、完成判定与发奖励。养成进行中（不跳过）才动。
    pub(crate) fn refresh_upbringing_goals(&mut self) -> Result<(), CoreError> {
        if !self.upbringing_active() || self.upbringing_skipping() {
            return Ok(());
        }
        let Some(s) = self.state.upbringing.as_ref() else { return Ok(()) };
        if s.phase == Phase::Done || s.phase == Phase::Graduation {
            return Ok(());
        }
        let year = self.cast_date()[0];
        let today = self.day();
        let family = s.family.clone();
        let goals: Vec<AnnualGoalDef> = self
            .defs
            .upbringing
            .annual_goals
            .iter()
            .filter(|g| g.family == family && g.year <= year && self.upbringing_goal_applies(g))
            .cloned()
            .collect();
        for g in goals {
            let state = self.state.upbringing.as_ref().and_then(|s| s.goals.get(&g.key)).cloned();
            let since = match state {
                None if g.year == year => {
                    if let Some(s) = &mut self.state.upbringing {
                        s.goals
                            .insert(g.key.clone(), GoalState { status: GoalStatus::Active, since: today, done: None });
                    }
                    today
                }
                Some(GoalState { status: GoalStatus::Active, .. }) if g.year < year => {
                    if let Some(st) = self.state.upbringing.as_mut().and_then(|s| s.goals.get_mut(&g.key)) {
                        st.status = GoalStatus::Missed;
                    }
                    continue;
                }
                Some(GoalState { status: GoalStatus::Active, since, .. }) => since,
                _ => continue,
            };
            if g.objectives.is_empty() || !g.objectives.iter().all(|o| self.story2_objective_done(o, since)) {
                continue;
            }
            if let Some(st) = self.state.upbringing.as_mut().and_then(|s| s.goals.get_mut(&g.key)) {
                st.status = GoalStatus::Done;
                st.done = Some(today);
            }
            for e in &g.rewards {
                self.apply_story2_effect(e, true)
                    .map_err(|err| CoreError::Internal(format!("年度目标 {} 的奖励无法发放：{err}", g.key)))?;
            }
        }
        Ok(())
    }
}

/// 年度目标只许这几种奖励：成长、技能经验、物品（正数）、回忆。
fn reward_ok(defs: &crate::StaticData, e: &Effect) -> bool {
    let key = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_');
    match e {
        Effect::Growth { attr, value } => defs.captain.attribute_index(attr).is_some() && (1..=100).contains(value),
        Effect::Skill { skill, value } => defs.story2.skills.contains(skill) && (1..=200).contains(value),
        Effect::Item { item, qty } => defs.items.item(item).is_some() && (1..=10).contains(qty),
        Effect::Memory { memory, title } => key(memory) && title.chars().count() <= 100,
        _ => false,
    }
}

pub(super) fn validate(defs: &crate::StaticData) -> Vec<String> {
    let mut errors = Vec::new();
    let mut keys = BTreeSet::new();
    for g in &defs.upbringing.annual_goals {
        let mut check = |ok: bool, message: &str| {
            if !ok {
                errors.push(format!("annual_goal:{}: {message}", g.key));
            }
        };
        check(
            !g.key.is_empty()
                && g.key.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
                && keys.insert(&g.key),
            "目标键重复或无效",
        );
        let family = defs.upbringing.family(&g.family);
        check(family.is_some(), "目标引用未知家庭");
        check(
            g.flag
                .iter()
                .chain(&g.not_flag)
                .all(|flag| family.is_some_and(|f| f.routes.iter().any(|r| &r.flag == flag))),
            "目标的 flag / not_flag 只能用本家改投路线的选择旗标",
        );
        check(
            family.is_some_and(|f| {
                // 结业日在元旦时，养成期的最后一年是前一年。
                let last = if f.graduation[1] == 1 && f.graduation[2] == 1 {
                    f.graduation[0].saturating_sub(1)
                } else {
                    f.graduation[0]
                };
                f.stages.first().is_some_and(|s| s.from[0] <= g.year) && g.year <= last
            }),
            "目标年份不在该家庭的养成期内",
        );
        check(g.text.chars().count() <= 300, "目标文字过长");
        check(!g.objectives.is_empty() && g.objectives.len() <= 4, "目标条件须有 1–4 条");
        for o in &g.objectives {
            let ok = o.kind.condition().is_some_and(|c| {
                matches!(
                    c,
                    crate::story2::Condition::Attr { .. }
                        | crate::story2::Condition::Growth { .. }
                        | crate::story2::Condition::Skill { .. }
                        | crate::story2::Condition::Cash { .. }
                        | crate::story2::Condition::Affinity { .. }
                        | crate::story2::Condition::Bond { .. }
                        | crate::story2::Condition::Item { .. }
                ) && crate::story2::validation::condition_error(defs, &c).is_none()
            });
            check(ok, &format!("目标条件只许属性、成长、技能、现款、情谊、羁绊、物品，且引用有效：{:?}", o.kind));
        }
        check(
            g.rewards.len() <= 4 && g.rewards.iter().all(|e| reward_ok(defs, e)),
            "奖励只许小额成长、技能经验、物品与回忆",
        );
    }
    errors
}
