//! 信仰与思想的分量：资源、时间、年度预算与敌意共同约束传播。
mod runtime;
pub mod validation;

use crate::{history::Effect, ids::*};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Mission,
    Print,
    School,
    Charity,
    Court,
    Protect,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Faith,
    School,
    Movement,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct IdeasDefs {
    pub ideas: Vec<IdeaDef>,
    pub ports: Vec<PortDef>,
}
impl IdeasDefs {
    pub fn is_empty(&self) -> bool {
        self.ideas.is_empty() && self.ports.is_empty()
    }
    pub fn idea(&self, key: &str) -> Option<&IdeaDef> {
        self.ideas.iter().find(|i| i.key == key)
    }
    pub fn port(&self, key: &str) -> Option<&PortDef> {
        self.ports.iter().find(|p| p.key == key)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IdeaDef {
    pub key: String,
    pub name: String,
    pub kind: Kind,
    pub family: Option<String>,
    pub basis: Option<String>,
    #[serde(default)]
    pub sources: Vec<String>,
    #[serde(default)]
    pub carriers: Vec<String>,
    #[serde(default)]
    pub books: Vec<String>,
    #[serde(default)]
    pub rivals: Vec<String>,
    #[serde(default)]
    pub festivals: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortDef {
    pub key: String,
    pub shares: BTreeMap<String, i64>,
    pub annual_cap: i64,
    pub inertia: i64,
    #[serde(default)]
    pub hostility: i64,
    pub hostility_note: Option<String>,
    #[serde(default)]
    pub forbidden: Vec<String>,
    pub language: Option<String>,
    pub permission: Option<String>,
    pub protector: Option<String>,
    #[serde(default)]
    pub printing: bool,
    pub modes: Vec<ModeDef>,
    #[serde(default)]
    pub unlocks: Vec<Unlock>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModeDef {
    pub idea: String,
    pub mode: Mode,
    pub label: String,
    #[serde(default)]
    pub needs: Vec<String>,
    pub points: i64,
    pub cap: i64,
    pub diminish: i64,
    #[serde(default)]
    pub cost: i64,
    #[serde(default)]
    pub days: u32,
    #[serde(default)]
    pub items: BTreeMap<String, i64>,
    #[serde(default)]
    pub goods: BTreeMap<String, i64>,
    pub book: Option<String>,
    pub skill: Option<String>,
    #[serde(default)]
    pub min_skill: i64,
    pub person: Option<String>,
    #[serde(default)]
    pub affinity: i64,
    pub from: Option<String>,
    /// 传播方式的起始日期；from仍表示庇护行动的出发港。
    #[serde(default)]
    pub from_date: Option<crate::scenario::WorldDate>,
    #[serde(default)]
    pub berths: i64,
    #[serde(default)]
    pub detection: i64,
    #[serde(default)]
    pub suspicion: i64,
    /// 港口传播同时影响相应宫廷；增量同实际获得的点数。
    pub campaign: Option<String>,
    pub var: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Unlock {
    pub key: String,
    pub idea: String,
    pub threshold: i64,
    pub effects: Vec<Effect>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct IdeasState {
    pub ports: BTreeMap<LocId, PortState>,
    pub suspicion: BTreeMap<OwnerId, BTreeMap<FactionId, i64>>,
    pub rescued: BTreeSet<String>,
    pub last_day: Option<u32>,
}
impl IdeasState {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct PortState {
    pub year: u32,
    pub shares: BTreeMap<String, i64>,
    pub gained: BTreeMap<String, i64>,
    pub modes: BTreeMap<String, ModeState>,
    pub unlocked: BTreeSet<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
pub struct ModeState {
    /// 累计原始点数，递减与敌意只在总额上取整，不奖励拆单。
    pub raw: i64,
    pub active: BTreeMap<OwnerId, Activity>,
    pub last: BTreeMap<OwnerId, u32>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Activity {
    pub fleet: FleetId,
    pub started: u32,
    pub elapsed: u32,
    pub departed: bool,
}

pub fn mode_key(idea: &str, mode: Mode) -> String {
    format!("{idea}:{mode:?}")
}
pub(crate) use runtime::check;
