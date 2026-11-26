//! 贡献意图与累计量；校验和执行共用一次试算，失败不扣资源。
use super::*;
use crate::{World, error::CommandError, world::WorldState};
use std::collections::BTreeSet;

const fn full() -> i64 {
    100
}
const fn sale() -> i64 {
    50
}
const fn unit() -> i64 {
    1
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum Payload {
    Deliver { fleet: FleetId, goods: Vec<(GoodId, i64)>, donate: bool },
    Money { amount: i64 },
    Negotiate { term: String },
    Commit {},
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LeverKind {
    Deliver,
    Money,
    Arms,
    Train,
    Relief,
    Escort,
    Intel,
    Negotiate,
    Bribe,
    Propagate,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LeverDef {
    pub key: String,
    pub idea: Option<String>,
    pub mode: Option<crate::ideas::Mode>,
    pub side: String,
    pub kind: LeverKind,
    pub label: String,
    pub port: Option<String>,
    #[serde(default)]
    pub goods: Vec<String>,
    #[serde(default = "unit")]
    pub value_per_point: i64,
    #[serde(default)]
    pub points: i64,
    pub max_points: i64,
    #[serde(default = "sale")]
    pub sale_pct: i64,
    pub train: Option<String>,
    pub trainer: Option<String>,
    #[serde(default)]
    pub days: u32,
    #[serde(default)]
    pub cost: i64,
    pub from: Option<String>,
    pub company: Option<String>,
    #[serde(default)]
    pub smuggle: bool,
    #[serde(default)]
    pub seizure: i64,
    #[serde(default)]
    pub seized_effects: Vec<Effect>,
    pub note: Option<String>,
    pub risk: Option<String>,
    pub var: Option<String>,
    #[serde(default = "unit")]
    pub var_per_point: i64,
    #[serde(default)]
    pub court_bonus: i64,
    pub item: Option<String>,
    pub deadline: Option<WorldDate>,
    pub with: Option<String>,
    #[serde(default)]
    pub terms: Vec<String>,
    pub language: Option<String>,
    #[serde(default)]
    pub reputation: BTreeMap<String, i64>,
    pub introducer: Option<String>,
    #[serde(default = "sale")]
    pub affinity: i64,
    #[serde(default)]
    pub leak: i64,
    #[serde(default = "full")]
    pub reliability: i64,
    #[serde(default)]
    pub requires: Vec<Condition>,
    #[serde(default)]
    pub leak_effects: Vec<Effect>,
    #[serde(default)]
    pub false_effects: Vec<Effect>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Contribution {
    /// 价值×100；出售折扣在这里累计，统一折点防止拆单取整套利。
    pub value: i64,
    pub owners: BTreeMap<OwnerId, i64>,
    pub completed: BTreeSet<OwnerId>,
    pub activities: BTreeMap<OwnerId, Activity>,
    pub attempts: u32,
    pub seized: BTreeSet<OwnerId>,
    pub shipments: BTreeMap<OwnerId, Shipment>,
    pub diplomacy: BTreeMap<OwnerId, DiplomaticAttempt>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Activity {
    pub fleet: FleetId,
    pub convoy: Option<FleetId>,
    pub started: u32,
    pub last_day: Option<u32>,
    pub days: u32,
    pub departed: bool,
    pub arrived: bool,
    pub valid: bool,
}

pub(crate) fn check(
    world: &World,
    owner: OwnerId,
    event: &str,
    lever: &str,
    payload: &Payload,
) -> Result<Box<WorldState>, CommandError> {
    let e = world.defs.history.event(event).ok_or_else(|| CommandError::NotFound(event.into()))?;
    let l = e.levers.iter().find(|l| l.key == lever).ok_or_else(|| CommandError::NotFound(lever.into()))?;
    world.agent(owner)?;
    if !world.history_conditions_for(owner, e, &l.requires) {
        return Err(blocked("杠杆条件尚未满足"));
    }
    let state = world.state.history.events.get(event);
    if !world.state.history.enabled
        || state.is_some_and(|s| s.closed || s.outcome.is_some())
        || (e.locked && state.is_none_or(|s| !s.unlocked))
        || !e.window.is_some_and(|w| w[0] <= world.cast_date() && world.cast_date() <= w[1])
        || !e
            .requires
            .iter()
            .all(|r| world.history_outcome(&r.event).is_some_and(|o| r.outcome.as_ref().is_none_or(|v| v == o)))
    {
        return Err(blocked("事件未开放、已结束或不在贡献窗口内"));
    }
    let effective_cap = if e.diminish == 0 { l.max_points / 2 } else { l.max_points };
    if world.history_lever_base_points(event, lever) >= effective_cap {
        return Err(blocked("贡献已达上限"));
    }
    let mut trial = world.clone();
    if l.kind == LeverKind::Propagate {
        if !matches!(payload, Payload::Commit {}) {
            return Err(blocked("传播只接受Commit"));
        }
        let port = l.port.as_ref().and_then(|p| world.defs.find_loc(p)).ok_or(CommandError::WrongLocation)?;
        trial.state = *crate::ideas::check(
            world,
            owner,
            l.idea.as_deref().ok_or_else(|| blocked("缺少思想"))?,
            port,
            l.mode.ok_or_else(|| blocked("缺少传播方式"))?,
        )?;
    } else if matches!(l.kind, LeverKind::Intel | LeverKind::Negotiate | LeverKind::Bribe) {
        super::diplomacy::apply(&mut trial, owner, e, l, payload)?;
    } else {
        super::material::apply(&mut trial, owner, e, l, payload)?;
    }
    trial.campaign_credit(world, e)?;
    Ok(Box::new(trial.state))
}

impl World {
    pub fn history_lever_points(&self, event: &str, lever: &str) -> i64 {
        let Some(e) = self.defs.history.event(event) else { return 0 };
        let Some(l) = e.levers.iter().find(|l| l.key == lever) else { return 0 };
        let diminished = self.history_lever_base_points(event, lever);
        if l.kind == LeverKind::Arms
            && !l.train.as_ref().is_some_and(|t| {
                self.state
                    .history
                    .events
                    .get(event)
                    .and_then(|s| s.contributions.get(t))
                    .is_some_and(|c| !c.completed.is_empty())
            })
        {
            diminished / 3
        } else {
            diminished
        }
    }
    pub fn history_lever_base_points(&self, event: &str, lever: &str) -> i64 {
        let Some(e) = self.defs.history.event(event) else { return 0 };
        let Some(l) = e.levers.iter().find(|l| l.key == lever) else { return 0 };
        let Some(c) = self.state.history.events.get(event).and_then(|s| s.contributions.get(lever)) else { return 0 };
        let raw = c.value / l.value_per_point.max(1) / 100;
        let half = l.max_points / 2;
        (raw.min(half) + (raw - half).max(0) * e.diminish / 100).min(l.max_points)
    }
    pub fn history_owner_points(&self, event: &str, lever: &str, owner: OwnerId) -> i64 {
        let Some(c) = self.state.history.events.get(event).and_then(|s| s.contributions.get(lever)) else { return 0 };
        crate::fixed::mul_div(
            self.history_lever_points(event, lever),
            c.owners.get(&owner).copied().unwrap_or(0),
            c.value.max(1),
        )
    }
    pub(super) fn contribution_mut(&mut self, e: &EventDef, l: &LeverDef) -> &mut Contribution {
        self.state.history.events.entry(e.key.clone()).or_default().contributions.entry(l.key.clone()).or_default()
    }
    pub(crate) fn add_contribution(
        &mut self,
        owner: OwnerId,
        e: &EventDef,
        l: &LeverDef,
        value: i64,
    ) -> Result<(), CommandError> {
        let c = self.contribution_mut(e, l);
        c.value =
            c.value.checked_add(value).filter(|v| *v <= 1_000_000_000_000_000).ok_or(CommandError::InvalidQuantity)?;
        let total = c.owners.entry(owner).or_default();
        *total = total.checked_add(value).ok_or(CommandError::InvalidQuantity)?;
        Ok(())
    }
}

pub(super) fn history_key(key: &str) -> u64 {
    let hash = blake3::hash(key.as_bytes());
    let mut bytes = [0; 8];
    bytes.copy_from_slice(&hash.as_bytes()[..8]);
    u64::from_le_bytes(bytes)
}

pub(super) fn validate_levers(d: &crate::StaticData, e: &EventDef) -> Vec<String> {
    let mut errors = Vec::new();
    let mut keys = BTreeSet::new();
    if !(0..=100).contains(&e.diminish) || e.levers.len() > 128 || (!e.levers.is_empty() && e.window.is_none()) {
        errors.push(format!("{}：杠杆窗口、数量或diminish无效", e.key));
    }
    for l in &e.levers {
        let exists =
            |port: &Option<String>| port.as_ref().is_some_and(|p| d.find_loc(p).is_some_and(|p| d.loc(p).is_port()));
        let valid = !l.key.is_empty()
            && keys.insert(&l.key)
            && e.sides.iter().any(|s| s.key == l.side)
            && !l.label.trim().is_empty()
            && (1..=10000).contains(&l.max_points)
            && (0..=l.max_points).contains(&l.points)
            && (1..=1_000_000_000).contains(&l.value_per_point)
            && (0..=100).contains(&l.sale_pct)
            && (0..=1_000_000_000).contains(&l.cost)
            && (0..=100).contains(&l.seizure)
            && (!l.smuggle || (l.kind == LeverKind::Arms && l.seizure > 0))
            && (l.smuggle || l.seizure == 0)
            && exists(&l.port)
            && l.requires.iter().all(|c| conditions::valid(d, c))
            && (l.kind == LeverKind::Propagate || (l.idea.is_none() && l.mode.is_none()))
            && l.goods.iter().all(|g| d.find_good(g).is_some())
            && l.train.as_ref().is_none_or(|key| {
                e.levers.iter().any(|train| train.key == *key && train.side == l.side && train.kind == LeverKind::Train)
            })
            && l.seized_effects.iter().all(|v| validation::effect_error(d, v).is_none())
            && match l.kind {
                LeverKind::Deliver | LeverKind::Arms | LeverKind::Relief => !l.goods.is_empty(),
                LeverKind::Money => true,
                LeverKind::Propagate => {
                    l.var.is_none()
                        && l.idea.as_ref().zip(l.mode).is_some_and(|(idea, mode)| {
                            l.port
                                .as_ref()
                                .and_then(|p| d.ideas.port(p))
                                .is_some_and(|p| p.modes.iter().any(|m| &m.idea == idea && m.mode == mode))
                        })
                }
                LeverKind::Train => {
                    l.days > 0
                        && l.days <= 3650
                        && l.points > 0
                        && l.trainer.as_ref().is_some_and(|t| d.find_mate(t).is_some() || d.cast.person(t).is_some())
                }
                LeverKind::Escort => {
                    exists(&l.from)
                        && l.from != l.port
                        && l.days > 0
                        && l.days <= 3650
                        && l.points > 0
                        && l.company.as_ref().is_some_and(|c| d.find_company(c).is_some())
                }
                LeverKind::Intel | LeverKind::Negotiate | LeverKind::Bribe => super::diplomacy::valid_lever(d, l),
            };
        if !valid {
            errors.push(format!("{}:{}：杠杆引用、类型或边界无效", e.key, l.key));
        }
    }
    errors
}

pub(super) fn default_diminish() -> i64 {
    full()
}

pub(super) fn valid_snapshot(w: &World) -> bool {
    w.state.history.events.iter().all(|(event, state)| {
        let Some(e) = w.defs.history.event(event) else { return false };
        state.contributions.iter().all(|(key, c)| {
            let Some(l) = e.levers.iter().find(|l| &l.key == key) else { return false };
            (0..=1_000_000_000_000_000).contains(&c.value)
                && c.owners.values().try_fold(0i64, |sum, v| sum.checked_add(*v)) == Some(c.value)
                && c.owners.iter().all(|(o, v)| *v >= 0 && w.state.agents.contains_key(o))
                && c.completed.iter().chain(&c.seized).all(|o| w.state.agents.contains_key(o))
                && super::diplomacy::valid_snapshot(w, e, l, c)
                && (c.seized.is_empty() || l.smuggle)
                && c.activities.iter().all(|(o, a)| {
                    matches!(l.kind, LeverKind::Train | LeverKind::Escort)
                        && w.state.agents.contains_key(o)
                        && !c.completed.contains(o)
                        && a.fleet.0 > 0
                        && a.fleet.0 < w.state.next_fleet
                        && a.convoy.is_some() == (l.kind == LeverKind::Escort)
                        && a.convoy.is_none_or(|f| f != a.fleet && f.0 > 0 && f.0 < w.state.next_fleet)
                        && a.started <= w.day()
                        && a.last_day.is_none_or(|d| a.started <= d && d <= w.day())
                        && a.days <= l.days
                })
        })
    })
}
