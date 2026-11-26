//! 通用人物目录与确定性状态；没有人物数据的世界不生成状态。
mod graduation;
pub mod interactions;
pub mod metadata;
pub mod protagonists;
mod reconcile;
pub mod relations;
pub mod reunions;
pub mod schedule;

use crate::{
    ids::LocId,
    scenario::{Gender, WorldDate},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct CastDefs {
    pub persons: Vec<PersonDef>,
    pub past: Vec<PastDef>,
    pub ties: Vec<relations::TieDef>,
    /// 作者关系的键与文字，以及结业时冻结的配对条件。
    #[serde(skip)]
    pub tie_metadata: Vec<metadata::TieMetadata>,
    #[serde(skip)]
    pub deferred_ties: Vec<metadata::DeferredTie>,
    /// 加载时明确报告的待接线项；不进入世界状态或存档。
    #[serde(skip)]
    pub diagnostics: Vec<metadata::CastDiagnostic>,
    /// 人物按 key 排好序的次序，第一次用到时建（[`CastDefs::person`]）；只是查找用的缓存。
    #[doc(hidden)]
    #[serde(skip)]
    pub order: crate::keyed::KeyOrder,
    /// 只供剧情立绘使用的目录；不生成人物状态或好感。
    pub figures: Vec<FigureDef>,
}

impl CastDefs {
    /// key 对应的人物（与逐条比较相同；五百多个人物，按排好序的次序二分，见 [`crate::keyed::KeyOrder`]）。
    pub fn person(&self, key: &str) -> Option<&PersonDef> {
        self.order.find(&self.persons, key, |p| &p.key)
    }

    pub fn figure(&self, key: &str) -> Option<&FigureDef> {
        self.figures.iter().find(|f| f.key == key)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PersonKind {
    Historical,
    Story,
    Protagonist,
    Legend,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PersonDef {
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub name: String,
    pub kind: PersonKind,
    pub gender: Gender,
    pub born: WorldDate,
    #[serde(default)]
    pub role: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub secret: String,
    #[serde(default)]
    pub after: String,
    #[serde(default)]
    pub birthday: Option<[u32; 2]>,
    #[serde(default)]
    pub academy: Option<String>,
    #[serde(default)]
    pub bond_track: Option<String>,
    #[serde(default)]
    pub main_track: Option<String>,
    #[serde(default)]
    pub npc_track: Option<String>,
    #[serde(default)]
    pub family: Option<String>,
    #[serde(default)]
    pub template: Option<String>,
    #[serde(default)]
    pub cameo: Option<String>,
    #[serde(default)]
    pub known_regions: Vec<String>,
    #[serde(default)]
    pub culture: String,
    #[serde(default)]
    pub faction: String,
    #[serde(default)]
    pub history: Option<HistoryDef>,
    #[serde(default)]
    pub basis: String,
    #[serde(default)]
    pub sources: Vec<String>,
    #[serde(default)]
    pub societies: Vec<String>,
    #[serde(default)]
    pub faith: String,
    #[serde(default)]
    pub lineage: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub romance: RomanceDef,
    #[serde(default)]
    pub names: Vec<NameDef>,
    #[serde(default)]
    pub portraits: Vec<PortraitDef>,
    #[serde(default)]
    pub schedule: Vec<ScheduleDef>,
    #[serde(default)]
    pub audience: AudienceDef,
    #[serde(default)]
    pub loves: Vec<String>,
    #[serde(default)]
    pub likes: Vec<String>,
    #[serde(default)]
    pub dislikes: Vec<String>,
    #[serde(default)]
    pub hates: Vec<String>,
    #[serde(default)]
    pub mate: Option<PersonMateDef>,
    #[serde(default)]
    pub persona: String,
    #[serde(default, deserialize_with = "metadata::lines")]
    pub lines: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub tracks: Vec<String>,
    #[serde(default)]
    pub fate: Vec<FateDef>,
    #[serde(default)]
    pub captain: Option<crate::scenario::CaptainPreset>,
}

impl PersonDef {
    /// 未知出生年（0）与尚未出生都不给出虚构年龄。
    pub fn age_on(&self, date: WorldDate) -> Option<u32> {
        if self.born[0] == 0 {
            return None;
        }
        crate::scenario::ProtagonistIdentity { protagonist: None, template: None, born: self.born, gender: self.gender }
            .age_on(date)
    }
    /// 当前年龄的头像：取不超过年龄的最后一段。生日不详（`born` 为 0）的人物按成年人取最后一段，不因此没有头像。
    pub fn portrait(&self, date: WorldDate) -> Option<&str> {
        let age = match self.age_on(date) {
            Some(age) => age,
            None if self.born[0] == 0 => u32::MAX,
            None => return None,
        };
        self.portraits.iter().filter(|p| p.from_age <= age).max_by_key(|p| p.from_age).map(|p| p.asset.as_str())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HistoryDef {
    pub born: u32,
    pub died: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct RomanceDef {
    pub with: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NameDef {
    #[serde(alias = "rank")]
    pub bond: String,
    #[serde(alias = "text")]
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortraitDef {
    pub from_age: u32,
    pub asset: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ScheduleDef {
    pub from: WorldDate,
    #[serde(default)]
    pub to: Option<WorldDate>,
    pub at: String,
    #[serde(default)]
    pub venue: String,
    #[serde(default)]
    pub seasons: Vec<u32>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AudienceDef {
    pub fame: i64,
    pub reputation: BTreeMap<String, i64>,
    pub titles: Vec<String>,
    pub introducer: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PersonMateDef {
    #[serde(default)]
    pub key: Option<String>,
    pub navigation: i64,
    pub trade: i64,
    pub combat: i64,
    pub management: i64,
    pub salary: i64,
    #[serde(default)]
    pub joinable: bool,
    #[serde(default = "recruit_affinity")]
    pub affinity: i64,
    /// 作者标注的专长键；没有数值时不凭空生成岗位加成。
    #[serde(default)]
    pub abilities: Vec<String>,
}
fn recruit_affinity() -> i64 {
    60
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FateDef {
    pub event: String,
    pub outcome: String,
    pub then: FateAction,
    #[serde(default)]
    pub schedule: Option<ScheduleDef>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FateAction {
    Dies,
    #[serde(alias = "survives")]
    Lives,
    Moves,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PastDef {
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub name: String,
    pub sources: Vec<String>,
    pub lore: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct CastState {
    #[serde(skip_serializing_if = "crate::summary::ai::AiCastState::is_empty")]
    pub ai: crate::summary::ai::AiCastState,
    pub persons: BTreeMap<String, PersonState>,
    /// 养成期的实际场所；未进入养成时沿用玩家旗舰队的位置。
    pub place: Option<CastPlace>,
    pub outcomes: BTreeMap<String, String>,
    pub promise: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub graduation_day: Option<u32>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub graduation_ties: BTreeMap<String, bool>,
    pub promises: BTreeMap<String, String>,
    pub academy: bool,
    pub titles: std::collections::BTreeSet<String>,
    pub last: Option<interactions::InteractionResult>,
    pub ties: Vec<relations::TieState>,
    pub flags: std::collections::BTreeSet<String>,
}
impl CastState {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct PersonState {
    pub met: bool,
    pub affection: relations::Affection,
    pub interactions: interactions::InteractionState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub school: Option<reunions::SchoolMemory>,
    /// None 沿用数据生命状态；时间线可以明确改写。
    pub alive: Option<bool>,
    pub schedule: Option<ScheduleDef>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CastPlace {
    pub loc: LocId,
    pub venue: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FigureDef {
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub name: String,
}
