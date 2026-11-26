//! 学院、自由行动、明确的节日日期和远足图；所有引用在加载时闭包校验。
use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AcademyDef {
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub name: String,
    pub at: String,
    #[serde(default)]
    pub culture: String,
    #[serde(default)]
    pub places: Vec<PlaceDef>,
    #[serde(default)]
    pub companions: BTreeMap<String, CompanionRole>,
    #[serde(default)]
    pub mentor_roles: BTreeMap<String, String>,
    #[serde(default)]
    pub calendar: Vec<CalendarDef>,
    #[serde(default)]
    pub curriculum: Vec<ActivityDef>,
    #[serde(default)]
    pub graduation: Option<AcademyGraduation>,
    #[serde(default)]
    pub phases: Vec<AcademyPhase>,
    #[serde(default)]
    pub visits: Vec<AcademyVisit>,
    #[serde(default)]
    pub clubs: Vec<ClubDef>,
    #[serde(default)]
    pub age: Option<[u32; 2]>,
    #[serde(default)]
    pub board: bool,
    #[serde(default)]
    pub who: Option<AcademyAdmission>,
    #[serde(default)]
    pub rules: Option<AcademyRules>,
    #[serde(default)]
    pub exams: Vec<String>,
    #[serde(default)]
    pub satellite: bool,
    #[serde(default)]
    pub entry_flag: Option<String>,
    #[serde(default)]
    pub schedule_venues: Vec<String>,
    /// 学院每月另给的津贴（学徒工钱、宗教基金的口粮钱之类），在学院期与家里的零用钱一起发；没写就是 0。
    #[serde(default)]
    pub allowance: i64,
    #[serde(default)]
    pub venue_aliases: BTreeMap<String, String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PlaceDef {
    pub key: String,
    pub name: String,
    pub venue: String,
    pub kind: String,
    pub x: i64,
    pub y: i64,
    #[serde(default)]
    pub unlock: Unlock,
    #[serde(default)]
    pub hint: Option<String>,
    #[serde(default)]
    pub events: Vec<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompanionRole {
    Family,
    Mentor,
    Classmate,
    Rival,
    Penpal,
    Friend,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CalendarDef {
    #[serde(default)]
    pub contest: Option<String>,
    #[serde(default)]
    pub exam: Option<String>,
    pub key: String,
    pub name: String,
    pub date: WorldDate,
    pub kind: String,
    #[serde(default)]
    pub event: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FestivalDef {
    #[serde(default)]
    pub events: Vec<String>,
    #[serde(default)]
    pub contests: Vec<String>,
    #[serde(default)]
    pub customs: String,
    #[serde(default)]
    pub gift_custom: String,
    #[serde(default)]
    pub date_note: String,
    #[serde(default)]
    pub romance: bool,
    #[serde(default)]
    pub scene: String,
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub name: String,
    pub cultures: Vec<String>,
    /// 逐年给出世界日历日期，不在内核推算宗教历法。
    pub dates: Vec<WorldDate>,
    #[serde(default)]
    pub event: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExcursionDef {
    #[serde(default, rename = "where")]
    pub place: ExcursionWhere,
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub name: String,
    pub at: String,
    pub starts: Vec<String>,
    pub nodes: Vec<ExcursionNode>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExcursionNode {
    #[serde(default)]
    pub age: Option<[u32; 2]>,
    #[serde(default)]
    pub unlock: Unlock,
    #[serde(default)]
    pub scene: String,
    #[serde(default)]
    pub risk: Option<ExcursionRisk>,
    #[serde(default)]
    pub repeat: Option<ExcursionRepeat>,
    #[serde(default)]
    pub steps: Vec<ExcursionStep>,
    pub key: String,
    pub name: String,
    pub x: i64,
    pub y: i64,
    pub danger: i64,
    pub links: Vec<String>,
    #[serde(default)]
    pub hint: Option<String>,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub companion_skills: Vec<String>,
    #[serde(default)]
    pub growth: BTreeMap<String, i64>,
    #[serde(default)]
    pub rewards: BTreeMap<String, i64>,
    #[serde(default)]
    pub items: BTreeMap<String, u32>,
    #[serde(default)]
    pub events: Vec<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeState {
    Unknown,
    New,
    Seen,
    Solved,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrainingFleet {
    pub fleet: crate::FleetId,
    pub month: [u32; 2],
    pub slot: u8,
    /// 借船地点不依赖仍然存在的家庭定义，供内容迁移时归还学生的货物。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub origin: Option<crate::LocId>,
}
impl UpbringingDefs {
    pub fn academy(&self, key: &str) -> Option<&AcademyDef> {
        self.academies.iter().find(|a| a.key == key)
    }
    pub fn excursion(&self, key: &str) -> Option<&ExcursionDef> {
        self.excursions.iter().find(|a| a.key == key)
    }
}
