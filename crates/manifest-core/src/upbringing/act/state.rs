use super::*;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActPhase {
    #[default]
    Plan,
    Lessons,
    Moment,
    Free,
    Story,
    Voyage,
    Summary,
}
impl ActPhase {
    pub fn key(self) -> &'static str {
        match self {
            Self::Plan => "plan",
            Self::Lessons => "lessons",
            Self::Moment => "moment",
            Self::Free => "free",
            Self::Story => "story",
            Self::Voyage => "voyage",
            Self::Summary => "summary",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TemplateKind {
    Lessons,
    Free,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum ActAction {
    Greet {
        person: String,
    },
    Talk {
        person: String,
    },
    Gift {
        person: String,
        item: String,
    },
    Job {
        activity: String,
    },
    Marker {
        track: String,
    },
    Rest,
    Pray,
    SelfStudy {
        line: String,
        tier: u8,
    },
    Excursion {
        excursion: String,
        node: String,
    },
    Rumor,
    /// 仅模板内部使用；DoAction 不接受。
    Duty {
        duty: String,
    },
}
impl ActAction {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Greet { .. } => "greet",
            Self::Talk { .. } => "talk",
            Self::Gift { .. } => "gift",
            Self::Job { .. } => "job",
            Self::Marker { .. } => "marker",
            Self::Rest => "rest",
            Self::Pray => "pray",
            Self::SelfStudy { .. } => "self_study",
            Self::Excursion { .. } => "excursion",
            Self::Rumor => "rumor",
            Self::Duty { .. } => "family_duty",
        }
    }
    pub fn cost(&self) -> u8 {
        match self {
            Self::Greet { .. } | Self::Duty { .. } => 0,
            Self::Excursion { .. } => 2,
            _ => 1,
        }
    }
    pub fn target(&self) -> Option<&str> {
        match self {
            Self::Greet { person } | Self::Talk { person } | Self::Gift { person, .. } => Some(person),
            Self::Job { activity } => Some(activity),
            Self::Marker { track } => Some(track),
            Self::SelfStudy { line, .. } => Some(line),
            Self::Excursion { node, .. } => Some(node),
            Self::Duty { duty } => Some(duty),
            _ => None,
        }
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct LessonPlan {
    pub line: String,
    pub tier: u8,
    pub with: Option<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct LineState {
    pub used: u8,
    pub seen: u8,
    #[serde(skip_serializing_if = "zero_u8")]
    pub paid: u8,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub master: bool,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct MarkerState {
    pub chapter: String,
    pub place: String,
    pub person: Option<String>,
    pub since_week: u32,
    pub expires_week: u32,
    pub key: bool,
    pub missed: u8,
    pub cooldown_until: u32,
    pub retired: bool,
}
impl MarkerState {
    pub fn hanging(&self, week: u32) -> bool {
        !self.retired && self.cooldown_until == 0 && self.since_week <= week && self.expires_week >= week
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FreeStep {
    pub place: String,
    /// 模板里的 Job.activity 保存工种组；执行时才选本地最高可做档。
    pub action: ActAction,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FreeSkip {
    pub step: u8,
    pub plan: FreeStep,
    pub reason: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub args: BTreeMap<String, crate::text::TextArg>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionRecord {
    pub place: String,
    pub action: ActAction,
    pub cost: u8,
    pub result: SlotResult,
    #[serde(default)]
    pub greet: Option<(u16, u16)>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rumors: Vec<String>,
    /// 家业当次经过 0–100 截断后的名声变化，其余行动为零。
    #[serde(default, skip_serializing_if = "zero_i64")]
    pub fame: i64,
    /// 深谈转成标记时保留原来的拜访对象，直接看标记不填。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub visit: Option<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WeekSnapshot {
    pub cash: i64,
    pub fatigue: i64,
    pub mood: i64,
    pub growth: BTreeMap<String, i64>,
    pub skills: BTreeMap<String, i64>,
    pub affinity: BTreeMap<String, i64>,
    /// 养成收支的累计账本基线；不依赖只保留六十条的 recent 分录。
    #[serde(default, skip_serializing_if = "zero_i64")]
    pub cash_in_base: i64,
    #[serde(default, skip_serializing_if = "zero_i64")]
    pub cash_out_base: i64,
    #[serde(default, skip_serializing_if = "zero_i64")]
    pub merit: i64,
    /// 缺省表示 K1 尚未记录基线；新快照的零分也显式保存。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score: Option<i64>,
    /// 识货小结只比较是否在本周摸满，读档时保留开周基线。
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub goods_seen: BTreeMap<String, u8>,
}
fn zero_i64(value: &i64) -> bool {
    *value == 0
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct WeekSummary {
    pub week: u32,
    pub from: WorldDate,
    pub to: WorldDate,
    pub growth: BTreeMap<String, i64>,
    pub skills: BTreeMap<String, i64>,
    pub cash: i64,
    pub fatigue: i64,
    pub mood: i64,
    pub affinity: BTreeMap<String, i64>,
    pub lessons_ok: u8,
    pub lessons_fail: u8,
    pub points_used: u8,
    pub markers_seen: u8,
    #[serde(default)]
    pub k2: WeekK2,
    #[serde(default)]
    pub merit: i64,
    #[serde(default)]
    pub score_delta: i64,
    #[serde(default)]
    pub k3: WeekK3,
    #[serde(default, skip_serializing_if = "zero_u8")]
    pub free_applied: u8,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub free_skipped: Vec<FreeSkip>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct WeekK3 {
    pub rumors: Vec<String>,
    pub goods: Vec<String>,
    pub levels: BTreeMap<String, [u8; 2]>,
    pub duty_milestones: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voyage: Option<VoyageSummary>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duty: Option<DutySummary>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DutySummary {
    pub key: String,
    pub success: bool,
    pub cash: i64,
    pub fame: i64,
    pub milestone: bool,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ActState {
    pub on: bool,
    pub week: u32,
    pub phase: ActPhase,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub timetables: BTreeMap<String, Vec<LessonPlan>>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub templates: BTreeMap<String, Vec<Vec<LessonPlan>>>,
    /// 只读旧档；整理后归入 free_templates 的当前阶段。
    #[serde(skip_serializing)]
    pub free_template: Vec<FreeStep>,
    pub points: u8,
    pub points_max: u8,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub lines: BTreeMap<String, LineState>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub markers: BTreeMap<String, MarkerState>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub due: BTreeMap<String, u32>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub presence: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub greeted: BTreeMap<String, u32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub done: Vec<ActionRecord>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub family_duty: BTreeMap<String, u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duty_week: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restaged_week: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opened: Option<WeekSnapshot>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_week: Option<WeekSummary>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub carry: BTreeMap<String, i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<ActOrigin>,
    #[serde(skip_serializing_if = "zero_i64")]
    pub merit: i64,
    #[serde(skip_serializing_if = "zero_u8")]
    pub rank: u8,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub reviews: Vec<ReviewRecord>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub missions: BTreeMap<String, MissionState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub moment: Option<MomentState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub moment_last_week: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ill_until_week: Option<u32>,
    #[serde(skip_serializing_if = "zero_u32")]
    pub markers_seen: u32,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub jobs: BTreeMap<String, u32>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub outcomes: Vec<LessonOutcome>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub rumors: BTreeMap<String, u32>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub goods_seen: BTreeMap<String, u8>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub voyages: BTreeMap<String, VoyageStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub voyage: Option<ActVoyage>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub free_templates: BTreeMap<String, Vec<FreeStep>>,
    #[serde(skip_serializing_if = "zero_u8")]
    pub free_applied: u8,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub free_skipped: Vec<FreeSkip>,
}
fn zero_u8(v: &u8) -> bool {
    *v == 0
}
fn zero_u32(v: &u32) -> bool {
    *v == 0
}
impl ActState {
    pub fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GateGrade {
    Fail,
    Ok,
    Good,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoyageStatus {
    Joined,
    Done { grade: GateGrade },
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActVoyage {
    pub key: String,
    pub leg: u8,
    pub start_week: u32,
    pub plan: Vec<LessonPlan>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoyageSummary {
    pub key: String,
    pub leg: u8,
    pub legs: u8,
    pub gate: Option<GateGrade>,
    pub merit: i64,
}
