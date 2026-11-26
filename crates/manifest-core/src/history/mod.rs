//! 时间线：日期与依赖决定结算顺序，空模块不增加经典世界的状态。
mod campaign;
pub(crate) mod contacts;
mod knowledge;
pub use contacts::{ContactChanges, Envoy};
pub use knowledge::Observation;
mod ideas;
pub use ideas::{Backlash, Ending, Gate, Outlook, VarTest};
mod conditions;
pub(crate) mod contribution;
mod diplomacy;
pub use campaign::{
    Backfire, BaseVar, CampaignDef, CampaignState, Counter, Court, CourtFail, Need, Resolution, VarChange, VariableDef,
};
pub use conditions::{Condition, HistoryCondition};
mod material;
pub use diplomacy::{DiplomaticAttempt, Shipment};
mod timeline;
pub use contribution::{Activity, Contribution, LeverDef, LeverKind, Payload};
pub mod validation;

use crate::{diplomacy::DiploStatus, ids::*, scenario::WorldDate, story2};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct HistoryDefs {
    pub events: Vec<EventDef>,
    pub campaigns: Vec<CampaignDef>,
    pub ports: Vec<InitialPort>,
    pub envoys: Vec<Envoy>,
    #[serde(skip)]
    pub order: Vec<usize>,
}
impl HistoryDefs {
    /// 历史结果能设为真的故事旗标；清除旗标的效果不构成设置者。
    pub fn outcome_flags(&self) -> impl Iterator<Item = &str> {
        self.events.iter().flat_map(|e| &e.outcomes).flat_map(|o| &o.effects).filter_map(|effect| {
            if let Effect::Story(story2::Effect::Flag { flag, value: true }) = effect {
                Some(flag.as_str())
            } else {
                None
            }
        })
    }

    pub fn is_empty(&self) -> bool {
        self.events.is_empty() && self.ports.is_empty() && self.campaigns.is_empty() && self.envoys.is_empty()
    }
    pub fn campaign(&self, key: &str) -> Option<&CampaignDef> {
        self.campaigns.iter().find(|c| c.key == key)
    }
    pub fn event(&self, key: &str) -> Option<&EventDef> {
        self.events.iter().find(|e| e.key == key)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EventDef {
    #[serde(skip)]
    pub source: String,
    pub key: String,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    pub knowledge: Option<String>,
    #[serde(default)]
    pub why_hard: Vec<String>,
    pub region: Option<String>,
    pub date: Option<WorldDate>,
    pub latest: Option<WorldDate>,
    pub window: Option<[WorldDate; 2]>,
    #[serde(default)]
    pub trigger: Vec<Condition>,
    #[serde(default)]
    pub requires: Vec<Requirement>,
    #[serde(default)]
    pub locked: bool,
    pub basis: Option<String>,
    #[serde(default)]
    pub sources: Vec<String>,
    pub history: Historical,
    pub sides: Vec<Side>,
    #[serde(default)]
    pub balance: i64,
    #[serde(default)]
    pub roll: i64,
    #[serde(default)]
    pub levers: Vec<LeverDef>,
    #[serde(default = "contribution::default_diminish")]
    pub diminish: i64,
    pub campaign: Option<String>,
    pub base: Option<i64>,
    #[serde(default)]
    pub base_vars: Vec<BaseVar>,
    pub need: Option<Need>,
    pub counter: Option<Counter>,
    pub court: Option<Court>,
    /// 按顺序判定的终局条件；空表沿用原有分数区间。
    #[serde(default)]
    pub outcome_rules: Vec<OutcomeRule>,
    #[serde(default)]
    pub ripple_budget: u32,
    pub outcomes: Vec<OutcomeDef>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutcomeRule {
    pub outcome: String,
    pub when: Vec<Condition>,
}
impl EventDef {
    pub fn deadline(&self) -> WorldDate {
        self.date.or(self.latest).unwrap_or(self.history.date)
    }
    pub fn default_outcome(&self) -> Option<&OutcomeDef> {
        self.outcomes.iter().find(|o| o.default)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Requirement {
    pub event: String,
    pub outcome: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Historical {
    pub date: WorldDate,
    pub outcome: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Side {
    pub key: String,
    pub name: String,
    pub color: Option<String>,
    pub faction: String,
    pub port: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OutcomeDef {
    pub key: String,
    pub when: String,
    #[serde(default)]
    pub default: bool,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub news: String,
    #[serde(default)]
    pub chronicle: String,
    #[serde(default)]
    pub vars: Vec<VarChange>,
    #[serde(default)]
    pub backfire: Vec<Backfire>,
}

/// 通用效果仍复用故事词表；时间线仅增加世界结构的封闭操作。
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum Effect {
    History(HistoryEffect),
    Story(story2::Effect),
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum HistoryEffect {
    PortOwner { port: String, faction: String },
    PortState { port: String, state: PortStatus, days: Option<u32> },
    Unlock { event: String },
    Close { event: String },
    Diplomacy { a: String, b: String, from: DiploStatus, to: DiploStatus },
    Var { campaign: String, var: String, add: i64 },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PortStatus {
    #[default]
    Open,
    Dormant,
    Sacked,
    Destroyed,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct InitialPort {
    pub port: String,
    pub state: PortStatus,
    pub faction: Option<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct DynamicPort {
    pub faction: Option<FactionId>,
    pub status: PortStatus,
    pub until: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct HistoryState {
    pub enabled: bool,
    pub events: BTreeMap<String, EventState>,
    pub campaigns: BTreeMap<String, CampaignState>,
    pub ports: BTreeMap<LocId, DynamicPort>,
    pub chronicle: Vec<ChronicleEntry>,
    pub last_day: Option<u32>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub contact_changes: BTreeMap<OwnerId, ContactChanges>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub audiences: BTreeMap<OwnerId, BTreeMap<String, u32>>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub known_events: BTreeMap<String, Observation>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub known_campaigns: BTreeMap<String, Observation>,
}
impl Default for HistoryState {
    fn default() -> Self {
        Self {
            enabled: true,
            events: BTreeMap::new(),
            campaigns: BTreeMap::new(),
            ports: BTreeMap::new(),
            chronicle: Vec::new(),
            last_day: None,
            contact_changes: BTreeMap::new(),
            audiences: BTreeMap::new(),
            known_events: BTreeMap::new(),
            known_campaigns: BTreeMap::new(),
        }
    }
}
impl HistoryState {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EventState {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ripple: Option<crate::summary::ripple::RippleReceipt>,
    pub outcome: Option<String>,
    pub closed: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub forced: bool,
    pub unlocked: bool,
    pub resolved_day: Option<u32>,
    pub balance: i64,
    pub contributions: BTreeMap<String, Contribution>,
    pub resolution: Option<Resolution>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChronicleEntry {
    pub day: u32,
    pub event: String,
    pub outcome: String,
    pub deviates: bool,
}

pub(crate) fn blocked(message: &str) -> crate::error::CommandError {
    crate::error::CommandError::Precondition(message.into())
}

/// 港口的补给后备报价与船厂服务也不能绕过休眠状态。
pub(crate) fn check_port_service(
    world: &crate::World,
    command: &crate::Command,
) -> Result<(), crate::error::CommandError> {
    use crate::Command::*;
    if world.state.history.ports.is_empty() {
        return Ok(());
    }
    let loc = match command {
        Resupply { owner, fleet, .. }
        | HireCrew { owner, fleet, .. }
        | Repair { owner, fleet }
        | BuyShip { owner, fleet, .. }
        | SellShip { owner, fleet, .. }
        | RefitShip { owner, fleet, .. } => {
            world.state.fleets.get(fleet).filter(|f| f.owner == *owner).and_then(|f| f.docked_at())
        }
        FoundFleet { at, .. } | FormCaravan { at, .. } => Some(*at),
        BuyInto { owner, holder, .. } | SellFrom { owner, holder, .. } | DeliverContract { owner, holder, .. } => {
            world.holder_location(*owner, *holder).ok()
        }
        RentWarehouse { loc, .. }
        | BuyWarehouse { loc, .. }
        | BuildIndustry { loc, .. }
        | InvestPort { loc, .. }
        | ReportDiscovery { loc, .. }
        | BuyMarketReport { loc, .. }
        | ApplyBargain { loc, .. }
        | BuyItem { loc, .. }
        | SellItem { loc, .. } => Some(*loc),
        UpgradeIndustry { owner, industry } | SellIndustry { owner, industry } | SetManager { owner, industry, .. } => {
            world.state.industries.get(industry).filter(|i| i.owner == *owner).map(|i| i.loc)
        }
        AcceptContract { contract, .. } => world.state.contracts.get(contract).map(|c| c.to),
        OfferContract { to, .. } => Some(*to),
        _ => None,
    };
    if loc.is_some_and(|loc| world.port_status(loc) != PortStatus::Open) {
        Err(blocked("港口服务尚未开放"))
    } else {
        Ok(())
    }
}

/// 结果区间使用闭区间；极端边界不允许溢出。
pub fn score_range(text: &str) -> Option<(i64, i64)> {
    let text = text.trim();
    if let Some((lo, hi)) = text.split_once("..") {
        let pair = (lo.trim().parse().ok()?, hi.trim().parse().ok()?);
        return (pair.0 <= pair.1).then_some(pair);
    }
    for prefix in ["<=", ">=", "<", ">", "="] {
        if let Some(value) = text.strip_prefix(prefix) {
            let value: i64 = value.trim().parse().ok()?;
            return Some(match prefix {
                "<=" => (i64::MIN, value),
                ">=" => (value, i64::MAX),
                "<" => (i64::MIN, value.checked_sub(1)?),
                ">" => (value.checked_add(1)?, i64::MAX),
                _ => (value, value),
            });
        }
    }
    None
}
