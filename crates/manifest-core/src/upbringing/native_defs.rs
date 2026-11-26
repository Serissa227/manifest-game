//! C8 原生扩展：手作、学院手册与远足步骤均使用封闭类型，不接收任意字典。
use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JobProgressGrant {
    pub group: String,
    pub at_least: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorNote {
    #[serde(skip)]
    pub file: String,
    pub key: String,
    pub text: String,
    pub source: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcademyGraduation {
    pub event: String,
    pub promise_at: String,
    pub date: WorldDate,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcademyPhase {
    pub from: WorldDate,
    pub to: WorldDate,
    pub name: String,
    pub mentors: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcademyVisit {
    #[serde(rename = "where")]
    pub at: String,
    pub unlock: Unlock,
    #[serde(default)]
    pub people: Vec<String>,
    pub note: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClubDef {
    pub key: String,
    pub name: String,
    pub practice: Vec<String>,
    pub contests: Vec<String>,
    pub members: Vec<String>,
    pub synopsis: String,
    pub events: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcademyAdmission {
    pub gender: String,
    pub rank: Vec<String>,
    pub access_note: String,
    pub alternative: AdmissionAlternative,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AdmissionAlternative {
    pub flag: String,
    pub note: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcademyRules {
    pub late: SchoolPenalty,
    pub fighting: SchoolPenalty,
    pub night_absence: SchoolPenalty,
    pub scholarship: Scholarship,
    pub recommendation: Recommendation,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SchoolPenalty {
    pub fame: i64,
    #[serde(default)]
    pub club_pause_days: u32,
    #[serde(default)]
    pub leave_pause_days: u32,
    pub note: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scholarship {
    pub rating: String,
    pub min: i64,
    pub honor_min: i64,
    pub fee_discount_pct: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Recommendation {
    pub exam: String,
    pub honor_min: i64,
    pub item: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SkillChoice {
    pub field: String,
    pub options: Vec<String>,
    pub xp: i64,
    #[serde(default)]
    pub require_local_teacher: bool,
    #[serde(default)]
    pub require_transmission: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TutorialFleet {
    pub book_value: i64,
    pub return_on_finish: bool,
    pub temporary_fleet: bool,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SkillProfile {
    pub thresholds: Vec<i64>,
    pub flags: Vec<String>,
    pub cultures: Vec<String>,
    pub unavailable: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CraftDef {
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub name: String,
    pub activity: String,
    pub materials: Vec<Ingredient>,
    pub tools: Vec<String>,
    pub skill: String,
    pub level: u32,
    pub output: Ingredient,
    pub check: CraftCheck,
    pub consume: String,
    pub failure: String,
    pub note: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ingredient {
    pub item: String,
    pub qty: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CraftCheck {
    pub attr: String,
    pub base: i64,
    pub per: i64,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ExcursionWhere {
    pub cultures: Vec<String>,
    pub academies: Vec<String>,
    pub bind: Option<String>,
    pub stage: ActivityStage,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExcursionStep {
    pub key: String,
    pub name: String,
    pub from: String,
    pub to: String,
    pub text: String,
    pub unlock: ExcursionRequirement,
    #[serde(default)]
    pub consume_items: bool,
    #[serde(default)]
    pub gains: BTreeMap<String, [i64; 2]>,
    #[serde(default)]
    pub skills: Vec<ActivitySkill>,
    #[serde(default)]
    pub memory: Option<String>,
    #[serde(default)]
    pub fame: i64,
    #[serde(default)]
    pub items: Vec<Ingredient>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ExcursionRequirement {
    pub any: Vec<ExcursionRequirement>,
    pub item: Option<String>,
    pub qty: i64,
    pub attr: Option<String>,
    pub min: i64,
    pub skill: Option<String>,
    pub companion_skill: Option<String>,
    pub level: u32,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExcursionRepeat {
    pub state: String,
    pub cooldown_days: u32,
    pub gains: BTreeMap<String, [i64; 2]>,
    pub fame: i64,
    pub income: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExcursionRisk {
    pub check: CraftCheck,
    pub failure: ExcursionFailure,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExcursionFailure {
    pub fatigue: i64,
    pub mood: i64,
    pub state_unchanged: bool,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ExcursionProgress {
    pub step: u8,
    pub last_day: Option<u32>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EventGate {
    pub stage: ActivityStage,
    /// 缺省不限月份；显式列表须非空且只含互异的1至12。
    pub months: Option<Vec<u32>>,
    pub years: Vec<u32>,
    pub actors: Vec<String>,
    pub actors_age: Option<[u32; 2]>,
    pub academy: Option<String>,
    pub actors_present: bool,
    pub festival: Option<String>,
    pub festival_window_days: Option<[i64; 2]>,
    pub no_promise_with_protagonist: Vec<String>,
    pub mutual_orientation: bool,
    pub mail_route: Option<String>,
    pub letter_received: bool,
    pub remote_cast: bool,
    pub activity: Option<String>,
    pub check_result: Option<String>,
    pub from: Option<WorldDate>,
    pub not_flag: Option<String>,
    /// 每旬排序的档次；缺省按 key 推断（U03 / A5）。
    pub tier: Option<EventTier>,
    /// U06a：可重复事件类别、单条冷却与顺延丢弃策略。
    pub category: Option<String>,
    pub cooldown_weeks: Option<u32>,
    pub droppable: Option<bool>,
}
/// 短事件的档次：有时限的写好事件先出，稀有与“第一次”其次，日常池与占位只当填充。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventTier {
    Timed,
    Special,
    Filler,
}
