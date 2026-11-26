//! K2 的数据与结构化读模型；文字由内容包提供。
use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum LineRequires {
    Lines(Vec<LineReq>),
    Legacy(Box<Requirements>),
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LineReq {
    pub line: String,
    pub tier: u8,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActLineGate {
    #[serde(skip)]
    pub source: String,
    pub line: String,
    pub u12: i64,
    pub gain: Vec<i64>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActMedian {
    #[serde(skip)]
    pub source: String,
    pub family: String,
    pub attr: String,
    pub levels: Vec<i64>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MissionDef {
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub family: String,
    pub month: [u32; 2],
    pub stage: Stage,
    #[serde(default)]
    pub academy: String,
    pub giver: String,
    pub goals: Vec<MissionGoal>,
    #[serde(default)]
    pub merit: Option<i64>,
    #[serde(default)]
    pub reward: Vec<MissionReward>,
    pub text: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum MissionGoal {
    Deed {
        deed: crate::story2::deeds::Deed,
        ge: i64,
        #[serde(default)]
        label: Option<String>,
    },
    Tier {
        line: String,
        ge: i64,
        #[serde(default)]
        label: Option<String>,
    },
    Gain {
        attr: String,
        ge: i64,
        #[serde(default)]
        label: Option<String>,
    },
    Skill {
        skill: String,
        ge: i64,
        #[serde(default)]
        label: Option<String>,
    },
    Affinity {
        person: String,
        ge: i64,
        #[serde(default)]
        label: Option<String>,
    },
    Duty {
        duty: String,
        ge: i64,
        #[serde(default)]
        label: Option<String>,
    },
    Contest {
        contest: String,
        rank: u32,
        #[serde(default)]
        label: Option<String>,
    },
    Flag {
        flag: String,
        #[serde(default)]
        label: Option<String>,
    },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum MissionReward {
    Cash { value: i64 },
    Item { item: String, qty: i64 },
    Affinity { person: String, value: i64 },
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DutyAward {
    pub cash: i64,
    pub items: BTreeMap<String, i64>,
    pub licenses: Vec<String>,
    pub repair_ship: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActCapitalDef {
    #[serde(skip)]
    pub source: String,
    pub family: String,
    pub path: String,
    pub band: String,
    #[serde(default)]
    pub cash: i64,
    #[serde(default)]
    pub ships: Vec<String>,
    #[serde(default)]
    pub ship_condition: Option<u8>,
    #[serde(default)]
    pub crew: i64,
    #[serde(default)]
    pub food: i64,
    #[serde(default)]
    pub water: i64,
    #[serde(default)]
    pub cargo: BTreeMap<String, i64>,
    #[serde(default)]
    pub items: BTreeMap<String, i64>,
    #[serde(default)]
    pub licenses: Vec<String>,
    #[serde(default)]
    pub mates: u8,
    #[serde(default)]
    pub allies: u8,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActReviewDef {
    #[serde(skip)]
    pub source: String,
    pub family: String,
    pub rank_names_home: [String; 4],
    pub rank_names_academy: [String; 4],
    #[serde(default)]
    pub rank_licenses: Vec<String>,
    #[serde(default)]
    pub rank_items: BTreeMap<String, i64>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActOrigin {
    pub growth: BTreeMap<String, i64>,
    pub skills: BTreeMap<String, i64>,
    pub affinity: BTreeMap<String, i64>,
    pub resolved: u32,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReviewRecord {
    pub week: u32,
    pub merit: i64,
    pub from: u8,
    pub to: u8,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MissionStatus {
    Active,
    Done,
    Failed,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MissionState {
    pub status: MissionStatus,
    pub week: u32,
    pub base: BTreeMap<String, i64>,
    pub done_week: Option<u32>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MomentPick {
    Steady,
    Risky,
    Clever,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MomentState {
    pub week: u32,
    pub slot: u8,
    pub day: u8,
    pub pick: Option<MomentPick>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LessonGrade {
    Fail,
    Ok,
    Great,
    Ill,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LessonOutcome {
    pub slot: u8,
    pub grade: LessonGrade,
    pub moment: Option<MomentPick>,
    pub moment_ok: Option<bool>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CapitalRow {
    pub kind: String,
    pub key: String,
    pub qty: i64,
    pub value: i64,
    pub source: String,
    pub condition: Option<u8>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActGraduation {
    pub band: String,
    pub score: i64,
    pub items: BTreeMap<String, i64>,
    pub rows: Vec<CapitalRow>,
    pub given: i64,
    pub kept: i64,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WeekK2 {
    pub mission: Option<MissionSummary>,
    pub review: Option<RankChange>,
    pub ill: bool,
    pub moment: Option<MomentSummary>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MissionSummary {
    pub key: String,
    pub status: MissionStatus,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RankChange {
    pub from: u8,
    pub to: u8,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MomentSummary {
    pub pick: MomentPick,
    pub ok: Option<bool>,
}
#[derive(Clone, Debug, Serialize)]
pub struct LevelScore {
    pub attr: String,
    pub from: i64,
    pub to: i64,
    pub score: i64,
}
#[derive(Clone, Debug, Serialize)]
pub struct PersonScore {
    pub person: String,
    pub from: u8,
    pub to: u8,
    pub score: i64,
}
#[derive(Clone, Debug, Serialize)]
pub struct ExamScore {
    pub exam: String,
    pub passed: bool,
    pub honor: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct ContestScore {
    pub contest: String,
    pub year: u32,
    pub rank: u32,
    pub score: i64,
}
#[derive(Clone, Debug, Serialize)]
pub struct DeedsScore {
    pub markers: u32,
    pub resolved: u32,
    pub voyages: u32,
    pub duties: u32,
    pub savings: i64,
}
#[derive(Clone, Debug, Serialize)]
pub struct ScoreDetail {
    pub craft: Vec<LevelScore>,
    pub root: Vec<LevelScore>,
    pub skill_xp: i64,
    pub exams: Vec<ExamScore>,
    pub contests: Vec<ContestScore>,
    pub people: Vec<PersonScore>,
    pub deeds: DeedsScore,
}
#[derive(Clone, Debug, Serialize)]
pub struct ActScore {
    pub items: BTreeMap<String, i64>,
    pub total: i64,
    pub band: String,
    pub next_band_at: Option<i64>,
    pub bands: BTreeMap<String, i64>,
    pub detail: ScoreDetail,
}
#[derive(Clone, Debug, Serialize)]
pub struct SavingsView {
    pub cash: i64,
    pub given: i64,
    pub kept: i64,
    pub score: i64,
}
#[derive(Clone, Debug, Serialize)]
pub struct CapitalPreview {
    pub band: String,
    pub aspiration: Option<String>,
    pub fulfilled: bool,
    pub value: i64,
    pub rows: Vec<CapitalRow>,
    pub savings: SavingsView,
    pub skip_band: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guarantee: Option<CapitalGuarantee>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CapitalGuarantee {
    pub amount: i64,
    pub rate_pct: i64,
}
