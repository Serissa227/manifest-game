//! 比赛实例由定义键和明确日期组成，小游戏只提交选择，名次与奖励由内核决定。
pub mod debate;
pub mod identify;
pub mod matching;
pub mod native;
mod native_runtime;
pub mod poem;
mod poem_tags;
pub mod race;
mod registration;
pub mod rhythm;
mod runtime;
pub use runtime::{ContestDraws, ContestPlay};
pub mod validation;
use crate::scenario::WorldDate;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Match,
    Poem,
    Rhythm,
    Debate,
    Race,
    Identify,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Params {
    Match(matching::Params),
    Poem(poem::Params),
    Rhythm(rhythm::Params),
    Debate(debate::Params),
    Race(race::Params),
    Identify(identify::Params),
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Moves {
    Pairs(Vec<[u32; 2]>),
    Choices(Vec<u32>),
    Keys(Vec<String>),
    Register { register: bool },
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ContestDef {
    /// 旧世界缺省沿用自动参赛；新规则由世界包显式启用。
    #[serde(default)]
    pub registration_required: bool,
    #[serde(default)]
    pub age_groups: bool,
    #[serde(default)]
    pub home_quarterly: bool,
    #[serde(default)]
    pub junior_families: Vec<String>,
    #[serde(default)]
    pub bindings: Vec<native::Binding>,
    #[serde(default)]
    pub unlock: native::ContestUnlock,
    #[serde(default)]
    pub poem: Option<native::PoemMetadata>,
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub name: String,
    pub kind: Kind,
    pub params: Params,
    pub at: String,
    pub dates: Vec<WorldDate>,
    #[serde(default = "open_days")]
    pub open_days: u32,
    pub check: Check,
    #[serde(default)]
    pub prep: Preparation,
    #[serde(default)]
    pub scoring: Scoring,
    #[serde(default)]
    pub rivals: Vec<String>,
    #[serde(default)]
    pub rewards: Vec<Reward>,
    #[serde(default)]
    pub events: Vec<String>,
}
fn open_days() -> u32 {
    10
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Check {
    pub base: i64,
    pub attr: String,
    pub coef: i64,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Preparation {
    pub activities: Vec<String>,
    pub per_practice: i64,
    pub cap: i64,
    pub items: Vec<String>,
    pub item_bonus: i64,
    pub companions: Vec<String>,
    pub companion_bonus: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Scoring {
    pub max_bonus: i64,
    pub authored_kind: Option<String>,
    pub points_per_pair: Option<i64>,
    pub points_per_hit: Option<i64>,
    pub points_per_win: Option<i64>,
    pub points_per_correct: Option<i64>,
    pub line_points: Vec<Vec<i64>>,
    pub race: Option<race::Track>,
    pub answers: BTreeMap<String, String>,
}
impl Default for Scoring {
    fn default() -> Self {
        Self {
            max_bonus: 15,
            line_points: Vec::new(),
            race: None,
            answers: BTreeMap::new(),
            authored_kind: None,
            points_per_pair: None,
            points_per_hit: None,
            points_per_win: None,
            points_per_correct: None,
        }
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Reward {
    pub rank: u32,
    pub fame: i64,
    pub growth: BTreeMap<String, i64>,
    pub items: BTreeMap<String, i64>,
    pub memory: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContestResult {
    pub contest: String,
    pub date: WorldDate,
    pub day: u32,
    pub rank: u32,
    pub total: u32,
    pub score: i64,
    pub game_score: Option<i64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub steers: Vec<crate::navigation::Steering>,
}
pub fn occurrence_key(key: &str, date: WorldDate) -> String {
    format!("{key}:{}-{:02}-{:02}", date[0], date[1], date[2])
}
pub(crate) struct ContestPlan {
    pub state: crate::world::WorldState,
}
