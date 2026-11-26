//! 考试、志向、结业资本与结局的封闭定义。
use crate::cast::relations::Bond;
use crate::scenario::WorldDate;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Requirements {
    pub all: Vec<Requirements>,
    pub any: Vec<Requirements>,
    pub attr: Option<String>,
    pub rating: Option<RatingRequirement>,
    pub min: Option<i64>,
    pub max: Option<i64>,
    pub flag: Option<String>,
    pub flag_value: Option<bool>,
    pub activity: Option<String>,
    pub times: u32,
    pub skill: Option<String>,
    pub level: u32,
    pub year: Option<u32>,
    pub lessons: Option<u32>,
    pub completed_slots: Option<u32>,
    pub languages_at_level: Option<u32>,
    pub exam_passed: Option<String>,
    pub contest: Option<String>,
    pub academy_exam_passed: Option<bool>,
    pub exams_attempted_min: Option<u32>,
    pub exams_passed_max: Option<u32>,
    pub aspiration: Option<String>,
    pub bond_grade: Option<Bond>,
    pub count_min: Option<u32>,
    pub count_max: Option<u32>,
    pub person: Option<String>,
    pub fame_min: Option<i64>,
    pub fame_max: Option<i64>,
    pub cash_max: Option<i64>,
    pub books_read_min: Option<u32>,
    pub book_categories_min: Option<u32>,
    pub outings_solved: Option<u32>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum RatingRequirement {
    Key(String),
    Threshold(RatingThreshold),
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RatingThreshold {
    pub key: String,
    pub min: i64,
}
impl RatingRequirement {
    pub fn key(&self) -> &str {
        match self {
            Self::Key(k) => k,
            Self::Threshold(t) => &t.key,
        }
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Award {
    pub effects: Vec<crate::items::effects::Effect>,
    pub titles: Vec<String>,
    pub skills: BTreeMap<String, i64>,
    pub items: BTreeMap<String, i64>,
    pub flags: Vec<String>,
    pub departure_chart: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExamDef {
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub academy: Option<String>,
    #[serde(default)]
    pub dates: Vec<WorldDate>,
    #[serde(default)]
    pub requirements: Requirements,
    pub check: ExamCheck,
    #[serde(default)]
    pub retake: Retake,
    #[serde(default)]
    pub award: Award,
    #[serde(default)]
    pub events: Vec<String>,
    #[serde(default)]
    pub rating_check: Option<RatingCheck>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExamCheck {
    pub base: i64,
    pub attrs: BTreeMap<String, i64>,
    #[serde(default = "min_pct")]
    pub min: i64,
    #[serde(default = "max_pct")]
    pub max: i64,
}
fn min_pct() -> i64 {
    5
}
fn max_pct() -> i64 {
    95
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RatingCheck {
    pub ratings: Vec<String>,
    pub min_total: i64,
    pub check_bonus_divisor: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Retake {
    pub cooldown_days: u32,
    pub max_attempts: u32,
    pub fee: i64,
    pub remediation: Vec<String>,
}
impl Default for Retake {
    fn default() -> Self {
        Self { cooldown_days: 30, max_attempts: 3, fee: 0, remediation: vec![] }
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ExamState {
    pub attempts: u32,
    pub last_day: Option<u32>,
    pub passed: bool,
    pub remediation: BTreeMap<String, u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PathDef {
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub reveal: Requirements,
    #[serde(default)]
    pub requirements: Requirements,
    #[serde(default)]
    pub award: Award,
    #[serde(default)]
    pub events: Vec<String>,
    pub capital: Capital,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Capital {
    pub source: Option<String>,
    pub grant_once: Option<String>,
    pub known: Vec<super::capital::KnowledgeArea>,
    pub rumored: Vec<super::capital::KnowledgeArea>,
    pub mementos: Vec<super::capital::Memento>,
    pub estate: Option<super::capital::Estate>,
    pub caravan: Option<super::capital::CaravanCapital>,
    pub at: Option<String>,
    pub cash: i64,
    pub ships: Vec<String>,
    pub crew: i64,
    pub food: i64,
    pub water: i64,
    pub cargo: BTreeMap<String, i64>,
    pub regions: Vec<String>,
    pub items: BTreeMap<String, i64>,
    pub allies: Vec<String>,
    pub mates: Vec<String>,
    pub ship_condition: Option<u8>,
    pub licenses: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Completion {
    #[serde(default)]
    pub event: Option<String>,
    /// 本家庭的告别事件，按最后一所学院的结业日期排入。
    #[serde(default)]
    pub family_event: Option<String>,
    /// 达到选择年龄后、首次选择志向之前的谈话。
    #[serde(default)]
    pub choose_event: Option<String>,
    #[serde(default)]
    pub promise_at: Option<String>,
    #[serde(default = "choose_age")]
    pub choose_age: u32,
    #[serde(default)]
    pub paths: Vec<String>,
    pub capital: Capital,
    #[serde(default)]
    pub friends: Vec<JoiningFriend>,
    #[serde(default)]
    pub defaults: DefaultGrowth,
}
fn choose_age() -> u32 {
    14
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct JoiningFriend {
    pub person: String,
    #[serde(default)]
    pub when: Requirements,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DefaultGrowth {
    pub growth: BTreeMap<String, i64>,
    pub skills: BTreeMap<String, i64>,
    pub flags: Vec<String>,
    pub path: Option<String>,
    pub exams: Vec<String>,
    pub affinity: BTreeMap<String, i64>,
    pub promise: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EndingDef {
    #[serde(default)]
    pub weights: EndingWeights,
    #[serde(default)]
    pub supplementary: bool,
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub title: String,
    pub text: String,
    #[serde(default)]
    pub family: Option<String>,
    #[serde(default)]
    pub priority: i64,
    #[serde(default)]
    pub requirements: Requirements,
    #[serde(default)]
    pub award: Award,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EndingWeights {
    pub ratings: BTreeMap<String, i64>,
    pub aspirations: BTreeMap<String, i64>,
    pub bonds: BTreeMap<String, i64>,
    pub flags: BTreeMap<String, i64>,
}
impl EndingWeights {
    pub fn is_empty(&self) -> bool {
        self.ratings.is_empty() && self.aspirations.is_empty() && self.bonds.is_empty() && self.flags.is_empty()
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RequirementGap {
    pub key: String,
    pub have: i64,
    pub need: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct EndingNearMiss {
    pub ending: String,
    pub missing: Vec<RequirementGap>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraduationRecord {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub near_miss: Vec<EndingNearMiss>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub supplementary: Vec<String>,
    pub day: u32,
    pub ending: Option<String>,
    pub path: Option<String>,
    pub path_fulfilled: bool,
    pub cash: i64,
    pub fleet: Option<crate::FleetId>,
    pub friends: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub act: Option<super::act::ActGraduation>,
}
