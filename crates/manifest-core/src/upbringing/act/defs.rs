use super::*;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LineDef {
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub family: String,
    pub stage: Stage,
    #[serde(default)]
    pub academy: String,
    pub place: String,
    pub name: String,
    #[serde(default)]
    pub attr: Option<String>,
    #[serde(default)]
    pub side: Option<String>,
    #[serde(default)]
    pub skill: Option<String>,
    #[serde(default)]
    pub root: Option<String>,
    #[serde(default)]
    pub mentor: Option<String>,
    pub tiers: Vec<LineTier>,
    #[serde(default)]
    pub clever: Option<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct LineTier {
    pub activity: String,
    pub gain: Option<i64>,
    pub root: Option<i64>,
    pub bond: Option<i64>,
    pub fee: Option<i64>,
    pub tool: Option<i64>,
    pub gift: Option<i64>,
    pub gate: Option<String>,
    pub requires: Option<LineRequires>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ActPlaceDef {
    #[serde(skip)]
    pub source: String,
    pub family: String,
    pub place: String,
    pub actions: Vec<String>,
    pub jobs: Vec<String>,
    pub shop: Vec<ActShopItem>,
    pub job_goods: BTreeMap<String, Vec<String>>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActShopItem {
    pub item: String,
    #[serde(default)]
    pub price: Option<i64>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActTimetable {
    #[serde(skip)]
    pub source: String,
    pub family: String,
    pub stage: Stage,
    #[serde(default)]
    pub academy: String,
    pub slots: Vec<LessonPlan>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActDutyDef {
    #[serde(skip)]
    pub source: String,
    pub family: String,
    pub key: String,
    pub stage: Stage,
    #[serde(default)]
    pub academy: String,
    pub name: String,
    pub desc: String,
    #[serde(default)]
    pub cash: [i64; 2],
    #[serde(default)]
    pub growth: BTreeMap<String, i64>,
    #[serde(default)]
    pub skills: BTreeMap<String, i64>,
    #[serde(default)]
    pub affinity: BTreeMap<String, i64>,
    #[serde(default)]
    pub milestone: u32,
    #[serde(default)]
    pub award: DutyAward,
    #[serde(default)]
    pub fame: i64,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ActGreeting {
    #[serde(skip)]
    pub source: String,
    pub family: String,
    pub person: String,
    pub seasons: Vec<u8>,
    pub lines: Vec<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ActMarkerDef {
    #[serde(skip)]
    pub source: String,
    pub track: String,
    pub person: Option<String>,
    pub places: BTreeMap<String, String>,
    pub key: Option<Vec<String>>,
    pub marker: Option<bool>,
    pub levels: BTreeMap<String, u8>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActTideDef {
    #[serde(skip)]
    pub source_file: String,
    pub port: String,
    pub key: String,
    #[serde(default = "tide_source")]
    pub source: String,
    pub months: Vec<u8>,
    #[serde(default)]
    pub jobs: BTreeMap<String, i64>,
    #[serde(default)]
    pub people: Vec<String>,
    #[serde(default = "tide_venue")]
    pub venue: String,
    #[serde(default)]
    pub rumors: u32,
    #[serde(default)]
    pub closed: Vec<String>,
    #[serde(default)]
    pub duty_fail: BTreeMap<String, i64>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub desc: Option<String>,
}
fn tide_source() -> String {
    "static".into()
}
fn tide_venue() -> String {
    "dock".into()
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActRumorDef {
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub heard: Vec<String>,
    pub port: String,
    #[serde(default)]
    pub good: String,
    pub kind: String,
    pub valid: [WorldDate; 2],
    #[serde(default)]
    pub heard_from: Option<WorldDate>,
    #[serde(default)]
    pub person: String,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActPerkDef {
    #[serde(skip)]
    pub source: String,
    pub family: String,
    pub person: String,
    pub level: u8,
    pub kind: String,
    #[serde(default)]
    pub line: String,
    #[serde(default)]
    pub flag: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActVoyageDef {
    pub family: String,
    pub key: String,
    pub start: WorldDate,
    pub weeks: u8,
    pub fee: i64,
    pub line: String,
    pub flag: String,
    #[serde(default)]
    pub requires: VoyageRequires,
    #[serde(default)]
    pub excludes: Vec<String>,
    pub gate: VoyageGate,
    pub legs: Vec<VoyageLeg>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub desc: String,
    /// 仅供显示覆盖定位原始分片，不进入游戏状态。
    #[serde(skip)]
    pub source: String,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct VoyageRequires {
    pub rank: Option<u8>,
    pub person: Option<(String, u8)>,
    pub after: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct VoyageGate {
    pub game: String,
    pub attr: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VoyageLeg {
    pub port: String,
    pub places: Vec<PlaceDef>,
    #[serde(default)]
    pub people: BTreeMap<String, String>,
}
