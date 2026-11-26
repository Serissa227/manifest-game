//! 按世界日历运行的养成月程；没有启用的剧本不产生任何状态。按周排程（U05）见 [`weekly`]。
pub mod native_defs;
pub mod native_validation;
pub use native_defs::*;
pub mod milestones;
pub use milestones::*;
pub mod academy_defs;
pub mod allowance;
pub mod auto_plan;
pub use allowance::{ScholarshipStatus, UpbringingBudget};
pub use auto_plan::{AUTO_PRESETS, social_kind};
pub mod capital;
mod ending_match;
mod exams;
mod goals;
pub use goals::{AnnualGoalDef, GoalProgress, GoalState, GoalStatus};
mod graduation;
mod mood;
pub use mood::MoodRules;
mod requirement_gaps;
pub use graduation::{
    ARCANA_AWAKENED_FLAG, ENGINE_FLAGS, GRADUATED_FLAG, GRADUATION_RESULT_FLAGS, OUTING_PERMISSION_FLAG,
};
pub mod milestone_validation;
mod requirements;
mod skip;
pub use academy_defs::*;
mod academy;
pub mod academy_validation;
pub mod activity_defs;
mod companions;
mod excursions;
mod native_excursions;
pub mod schedule;
mod training;
pub use activity_defs::*;
pub mod activity;
pub mod activity_validation;
mod cadence;
mod events;
pub use cadence::{CadenceRules, CadenceState, Deferred, cadence_report, infer_event_category, week_index};
pub use events::infer_event_tier;
// 旬调度的位与档次判断，节奏分类（`crate::pacing`）共用。
pub(crate) use events::{event_slot, is_letter, ordinary_event};
pub mod growth;
mod native_activity;
mod native_events;
pub mod reach;
mod reading;
#[cfg(test)]
mod u03_tests;
pub mod unlocks;
pub mod validation;
pub mod weekly;
use crate::scenario::{Gender, WorldDate};
pub use reach::{Constraint, Gap, Reachability};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
pub use weekly::{WeekLayout, WeekSlot, WeeklyRules, WeeklyState};

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct UpbringingDefs {
    pub format_version: Option<u32>,
    pub notes: Vec<AuthorNote>,
    pub crafts: Vec<CraftDef>,
    pub tracks: Vec<crate::story2::TrackDef>,
    pub event_gates: BTreeMap<String, EventGate>,
    pub poem_lexicons: Vec<crate::contests::native::PoemLexicon>,
    pub job_progress_flags: BTreeMap<String, JobProgressGrant>,
    pub culture_aliases: BTreeMap<String, Vec<String>>,
    pub skill_profiles: BTreeMap<String, SkillProfile>,
    pub families: Vec<FamilyDef>,
    pub activities: Vec<ActivityDef>,
    pub rules: UpbringingRules,
    pub contests: Vec<crate::contests::ContestDef>,
    pub academies: Vec<AcademyDef>,
    pub festivals: Vec<FestivalDef>,
    pub excursions: Vec<ExcursionDef>,
    pub helpers: BTreeMap<String, Vec<String>>,
    pub helper_levels: BTreeMap<String, BTreeMap<String, u32>>,
    pub exams: Vec<ExamDef>,
    pub paths: Vec<PathDef>,
    pub endings: Vec<EndingDef>,
    pub completions: BTreeMap<String, Completion>,
    /// U04 工作包 5：年度目标卡。
    pub annual_goals: Vec<AnnualGoalDef>,
    pub lines: Vec<act::LineDef>,
    pub act_places: Vec<act::ActPlaceDef>,
    pub act_timetables: Vec<act::ActTimetable>,
    pub act_duties: Vec<act::ActDutyDef>,
    pub act_greetings: Vec<act::ActGreeting>,
    pub act_markers: Vec<act::ActMarkerDef>,
    #[serde(skip)]
    pub act_index: act::ActIndex,
    pub act_line_gates: Vec<act::ActLineGate>,
    pub act_medians: Vec<act::ActMedian>,
    pub missions: Vec<act::MissionDef>,
    pub act_capital: Vec<act::ActCapitalDef>,
    pub act_review: Vec<act::ActReviewDef>,
    pub act_tides: Vec<act::ActTideDef>,
    pub act_rumors: Vec<act::ActRumorDef>,
    pub act_perks: Vec<act::ActPerkDef>,
    pub act_voyages: Vec<act::ActVoyageDef>,
}
impl UpbringingDefs {
    pub fn family(&self, key: &str) -> Option<&FamilyDef> {
        self.families.iter().find(|f| f.key == key)
    }
    /// 各家庭连同它的改投派生（[`FamilyDef::routed`]）：可达检查、旗标来源、门槛归属这类“任何一局可能走到”的判断用。
    pub fn family_variants(&self) -> impl Iterator<Item = &FamilyDef> {
        self.families.iter().flat_map(|f| std::iter::once(f).chain(f.routed.iter().map(|(_, v)| v)))
    }
    /// 按 [`FamilyDef::routes`] 重新派生各家庭的改投版本；加载完、换语言覆盖之后各调一次，派生内容随之一致。
    /// 引用不到的学院跳过（由校验报错）。
    pub fn derive_routes(&mut self) {
        let academies = &self.academies;
        for f in &mut self.families {
            let mut base = f.clone();
            base.routed.clear();
            f.routed = f
                .routes
                .iter()
                .filter_map(|r| {
                    let a = academies.iter().find(|a| a.key == r.academy)?;
                    Some((r.flag.clone(), base.routed_to(r, a)))
                })
                .collect();
        }
    }
    pub fn activity(&self, key: &str) -> Option<&ActivityDef> {
        self.activities.iter().find(|a| a.key == key)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Home,
    Academy,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    #[default]
    Plan,
    Running,
    Graduation,
    Done,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FamilyDef {
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub name: String,
    pub scenario: String,
    #[serde(default)]
    pub protagonists: Vec<String>,
    #[serde(default)]
    pub templates: Vec<String>,
    /// 家庭开局点：资质、本领每点升一级，品行每点加十；不占年度成长额度。
    #[serde(default)]
    pub initial_points: BTreeMap<String, i64>,
    /// U02：家境与文化底子，刻度同 `initial_points`，叠在年龄基线之上、个人开局点之下。
    #[serde(default)]
    pub origin_points: BTreeMap<String, i64>,
    #[serde(default)]
    pub youth_name: String,
    #[serde(default)]
    pub call_you: BTreeMap<String, String>,
    #[serde(default)]
    pub mentor_roles: BTreeMap<String, String>,
    /// 家里每月给的零用钱：家乡期与学院期分开写；没写就是 0。
    #[serde(default)]
    pub allowance: Allowance,
    pub home: String,
    #[serde(default)]
    pub places: Vec<PlaceDef>,
    #[serde(default)]
    pub companions: BTreeMap<String, CompanionRole>,
    pub born: WorldDate,
    pub gender: Gender,
    pub stages: Vec<StageDef>,
    pub graduation: WorldDate,
    #[serde(default)]
    pub completion: Option<Completion>,
    /// 改投学院的路线；见 [`AcademyRoute`]。
    #[serde(default)]
    pub routes: Vec<AcademyRoute>,
    /// 按 `routes` 逐条派生的同 key 家庭（选择旗标，派生家庭）；由 [`UpbringingDefs::derive_routes`] 生成，不读数据。
    #[serde(skip)]
    pub routed: Vec<(String, FamilyDef)>,
    #[serde(default)]
    pub act: bool,
    #[serde(default)]
    pub venue_aliases: BTreeMap<String, String>,
}
/// 改投学院：家乡期里某件事设了 `flag`，学院期各段整段换到 `academy`——日期不变，地点、阶段名取那所学院的；
/// 头一段学院期的入学标记换成那所学院的 `entry_flag`、入学事件换成 `entry_event`（它的选项设这个标记），
/// 结业约定地点换成那所学院的。没选的照原来的学院走。
/// 原学院专属的事件由数据用门槛的 `not_flag` 挡掉（原学院的校历事件由校验保证），新学院版本的事件条件里写这个旗标。
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcademyRoute {
    pub flag: String,
    pub academy: String,
    pub entry_event: String,
    /// 结业时的事件（[`Completion::event`]）换成这一条；不写就不换。
    #[serde(default)]
    pub completion_event: Option<String>,
}
impl FamilyDef {
    /// 设了 `flag` 时走的派生家庭。
    pub fn routed_by(&self, flags: impl Fn(&str) -> bool) -> &FamilyDef {
        self.routed.iter().find(|(flag, _)| flags(flag)).map_or(self, |(_, v)| v)
    }
    fn routed_to(&self, r: &AcademyRoute, a: &AcademyDef) -> FamilyDef {
        let mut v = self.clone();
        v.routes.clear();
        let mut first = true;
        for s in v.stages.iter_mut().filter(|s| s.stage == Stage::Academy) {
            s.academy = Some(a.key.clone());
            s.at = a.at.clone();
            s.name = a.name.clone();
            if first || s.entry_flag.is_some() {
                s.entry_flag = a.entry_flag.clone();
                s.entry_event = Some(r.entry_event.clone());
            }
            first = false;
        }
        if let Some(c) = v.completion.as_mut() {
            if let Some(g) = &a.graduation {
                c.promise_at = Some(g.promise_at.clone());
            }
            if let Some(event) = &r.completion_event {
                c.event = Some(event.clone());
            }
        }
        v
    }
}
/// 每月零用钱（月初发到手上）。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Allowance {
    pub home: i64,
    pub academy: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StageDef {
    pub from: WorldDate,
    pub stage: Stage,
    pub name: String,
    pub at: String,
    #[serde(default)]
    pub academy: Option<String>,
    #[serde(default)]
    pub entry_flag: Option<String>,
    #[serde(default)]
    pub entry_event: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActivityDef {
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub name: String,
    pub kind: ActivityKind,
    #[serde(default)]
    pub scene: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub stage: ActivityStage,
    #[serde(default)]
    pub events: Vec<String>,
    #[serde(default, rename = "where")]
    pub place: ActivityWhere,
    #[serde(default)]
    pub age: Option<[u32; 2]>,
    #[serde(default)]
    pub income: AmountRange,
    #[serde(default)]
    pub cost: i64,
    #[serde(default)]
    pub gains: BTreeMap<String, [i64; 2]>,
    #[serde(default)]
    pub fatigue: i64,
    #[serde(default)]
    pub mood: i64,
    #[serde(default)]
    pub skills: Vec<ActivitySkill>,
    #[serde(default)]
    pub mentor: Option<String>,
    #[serde(default)]
    pub unlock: Unlock,
    #[serde(default)]
    pub tier: Option<JobTier>,
    #[serde(default)]
    pub risk: Option<ActivityRisk>,
    #[serde(default)]
    pub failure: ActivityFailure,
    #[serde(default)]
    pub needs: Vec<Need>,
    #[serde(default)]
    pub items: BTreeMap<String, i64>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub heart: i64,
    #[serde(default)]
    pub training_ship: Option<String>,
    #[serde(default)]
    pub counts_as: Option<String>,
    #[serde(default)]
    pub mentor_role: Option<String>,
    #[serde(default)]
    pub monthly_limit: Option<u32>,
    #[serde(default)]
    pub monthly_limit_group: Option<String>,
    #[serde(default)]
    pub skill_choice: Option<SkillChoice>,
    #[serde(default)]
    pub selected_skill: Option<String>,
    #[serde(default)]
    pub craft: Option<String>,
    #[serde(default)]
    pub club: Option<String>,
    #[serde(default)]
    pub tutorial: Option<TutorialFleet>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityKind {
    Lesson,
    Job,
    Training,
    Social,
    Rest,
    Voyage,
    Adventure,
    Club,
    Free,
    Date,
    Contest,
    Reading,
    Craft,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityStage {
    Home,
    Academy,
    #[default]
    Any,
}
impl ActivityStage {
    pub fn allows(self, stage: Stage) -> bool {
        self == Self::Any || matches!((self, stage), (Self::Home, Stage::Home) | (Self::Academy, Stage::Academy))
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AfterChoice {
    pub activity: String,
    #[serde(default)]
    pub place: Option<String>,
    #[serde(default)]
    pub companion: Option<String>,
    #[serde(default)]
    pub book: Option<String>,
    #[serde(default)]
    pub excursion: Option<String>,
    #[serde(default)]
    pub node: Option<String>,
}
impl AfterChoice {
    pub fn activity(key: &str) -> Self {
        Self { activity: key.into(), place: None, companion: None, book: None, excursion: None, node: None }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlanSlot {
    pub index: u8,
    #[serde(default)]
    pub lesson: Option<String>,
    #[serde(default)]
    pub after: Option<AfterChoice>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct UpbringingState {
    pub family: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub excursion_progress: BTreeMap<String, BTreeMap<String, ExcursionProgress>>,
    pub month: [u32; 2],
    pub phase: Phase,
    #[serde(skip_serializing_if = "is_false")]
    pub skipping: bool,
    pub plan: Vec<PlanSlot>,
    pub previous_plan: Vec<PlanSlot>,
    pub next_slot: u8,
    pub settled: BTreeSet<([u32; 2], u8)>,
    pub last: Vec<SlotResult>,
    pub event_backlog: Vec<String>,
    pub growth: BTreeMap<String, i64>,
    pub growth_year: u32,
    pub year_growth: BTreeMap<String, i64>,
    pub stamina: i64,
    pub fatigue: i64,
    pub mood: i64,
    /// U04 工作包 3：正处在心情低谷里（低谷事件已经触发过，回到门槛以上才复位）。
    #[serde(default, skip_serializing_if = "is_false")]
    pub low_mood: bool,
    pub fame: i64,
    pub ill_until: Option<u32>,
    pub job_progress: BTreeMap<String, u32>,
    pub flags: BTreeSet<String>,
    pub activity_counts: BTreeMap<String, u32>,
    pub reading_slot: Option<([u32; 2], u8)>,
    pub event_day: Option<u32>,
    pub activity_tracks: BTreeSet<String>,
    pub event_permits: BTreeSet<String>,
    #[serde(default, skip_serializing_if = "BTreeSet::is_empty")]
    pub contest_registrations: BTreeSet<String>,
    pub contest_results: BTreeMap<String, crate::contests::ContestResult>,
    pub contest_wins: BTreeMap<String, u32>,
    pub stage_from: Option<WorldDate>,
    pub outings: u8,
    pub excursion_nodes: BTreeMap<String, BTreeMap<String, NodeState>>,
    pub training: Option<TrainingFleet>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub journal: Vec<JournalEntry>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub memory_days: BTreeMap<String, u32>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub letter_arrivals: BTreeMap<String, u32>,
    /// 日常池与占位事件上一次排出的日子：同一事件 365 天内不重复，同一文化区每月最多一个（U03 / A5）。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub filler_seen: BTreeMap<String, u32>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub exams: BTreeMap<String, ExamState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub graduation: Option<GraduationRecord>,
    /// U04 工作包 5：年度目标的进度（入队后才有）。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub goals: BTreeMap<String, GoalState>,
    /// U04 工作包 4：开放过的活动、地点、志向、考试与评价分段 → 开放的日子（开局时已开放的记 None，不报）。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub unlocks: BTreeMap<String, Option<u32>>,
    /// U05：按周排程的状态（模式、常设周课表、进位余数）；按旬的世界与还没切换的旧档全空，不落盘。
    #[serde(default, skip_serializing_if = "WeeklyState::is_default")]
    pub weekly: WeeklyState,
    /// U06a：事件周预算、冷却与顺延；旧档缺省为空。
    #[serde(default, skip_serializing_if = "CadenceState::is_default")]
    pub cadence: CadenceState,
    #[serde(default, skip_serializing_if = "act::ActState::is_default")]
    pub act: act::ActState,
}
fn is_false(value: &bool) -> bool {
    !value
}
impl Default for UpbringingState {
    fn default() -> Self {
        Self {
            family: String::new(),
            excursion_progress: BTreeMap::new(),
            month: [0, 0],
            phase: Phase::Plan,
            skipping: false,
            plan: Vec::new(),
            previous_plan: Vec::new(),
            next_slot: 0,
            settled: BTreeSet::new(),
            last: Vec::new(),
            event_backlog: Vec::new(),
            growth: BTreeMap::new(),
            growth_year: 0,
            year_growth: BTreeMap::new(),
            stamina: 100,
            fatigue: 0,
            mood: 0,
            low_mood: false,
            fame: 0,
            ill_until: None,
            job_progress: BTreeMap::new(),
            flags: BTreeSet::new(),
            activity_counts: BTreeMap::new(),
            reading_slot: None,
            event_day: None,
            activity_tracks: BTreeSet::new(),
            event_permits: BTreeSet::new(),
            contest_registrations: BTreeSet::new(),
            contest_results: BTreeMap::new(),
            contest_wins: BTreeMap::new(),
            stage_from: None,
            outings: 0,
            excursion_nodes: BTreeMap::new(),
            training: None,
            journal: Vec::new(),
            memory_days: BTreeMap::new(),
            letter_arrivals: BTreeMap::new(),
            filler_seen: BTreeMap::new(),
            exams: BTreeMap::new(),
            path: None,
            graduation: None,
            goals: BTreeMap::new(),
            unlocks: BTreeMap::new(),
            weekly: WeeklyState::default(),
            cadence: CadenceState::default(),
            act: act::ActState::default(),
        }
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotResult {
    pub index: u8,
    pub title: String,
    #[serde(default)]
    pub activities: Vec<String>,
    pub scene: String,
    pub success: Option<bool>,
    pub growth: BTreeMap<String, i64>,
    pub skills: BTreeMap<String, i64>,
    pub cash: i64,
    pub fatigue: i64,
    pub mood: i64,
    pub affinity: BTreeMap<String, i64>,
    pub items: BTreeMap<String, i64>,
    pub line: Option<String>,
    /// U05：这一格的格重（八分之几个标准格）；0 表示整格（按旬的记录），不落盘。
    #[serde(default, skip_serializing_if = "is_zero_u8")]
    pub eighths: u8,
}
fn is_zero_u8(value: &u8) -> bool {
    *value == 0
}
impl SlotResult {
    /// 格重（八分之几）：按旬的记录是整格。
    pub fn weight(&self) -> i64 {
        if self.eighths == 0 { weekly::UNIT } else { i64::from(self.eighths) }
    }
}

/// 一次真实旬结算的日期与结果，用于跨月日记。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct JournalEntry {
    pub day: u32,
    pub result: SlotResult,
}

pub mod act;
pub use act::{ActAction, ActPhase, ActState, LessonPlan, TemplateKind};

pub use act::MomentPick;
