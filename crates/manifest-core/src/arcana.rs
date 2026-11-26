//! 有费用与冷却的封闭秘术；效果在实际消费点受总上限约束。
pub mod validation;
use crate::{
    World,
    error::{CommandError, CoreError},
    ids::*,
    ledger::{Account, CashClass, JournalEntry, Memo},
    societies::{blocked, transaction},
    warehouse::Holder,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
pub const MAX_PCT: i64 = 50;
pub const MAX_DAYS: u32 = 90;
pub const MAX_VALUE: i64 = 20_000;
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ArcanaDefs {
    pub schools: Vec<SchoolDef>,
    pub spells: Vec<SpellDef>,
}
impl ArcanaDefs {
    pub fn is_empty(&self) -> bool {
        self.schools.is_empty() && self.spells.is_empty()
    }
    pub fn spell(&self, k: &str) -> Option<&SpellDef> {
        self.spells.iter().find(|s| s.key == k)
    }
    pub fn school(&self, k: &str) -> Option<&SchoolDef> {
        self.schools.iter().find(|s| s.key == k)
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SchoolDef {
    pub key: String,
    pub name: String,
    pub skill: String,
    pub basis: Option<String>,
    #[serde(default)]
    pub sources: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpellDef {
    pub key: String,
    pub name: String,
    pub school: String,
    pub rank: u8,
    pub desc: String,
    pub source: Option<String>,
    pub cost: Cost,
    pub cost_note: String,
    pub cooldown_days: u32,
    pub effect: Effect,
    #[serde(default)]
    pub public: bool,
    #[serde(default)]
    pub requires: Vec<crate::story2::Condition>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Cost {
    pub cash: i64,
    #[serde(deserialize_with = "item_amounts")]
    pub items: BTreeMap<String, i64>,
    #[serde(deserialize_with = "good_amounts")]
    pub goods: BTreeMap<String, i64>,
}
// 同时接受按 key 的简写和 FRAMEWORK 中的 [{ item/good, qty }]；后者不能用重复行掩盖扣除量。
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ItemAmount {
    item: String,
    qty: i64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GoodAmount {
    good: String,
    qty: i64,
}
fn item_amounts<'de, D: serde::Deserializer<'de>>(de: D) -> Result<BTreeMap<String, i64>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Shape {
        Map(BTreeMap<String, i64>),
        List(Vec<ItemAmount>),
    }
    match Shape::deserialize(de)? {
        Shape::Map(v) => Ok(v),
        Shape::List(v) => amount_map(v.into_iter().map(|a| (a.item, a.qty))),
    }
}
fn good_amounts<'de, D: serde::Deserializer<'de>>(de: D) -> Result<BTreeMap<String, i64>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Shape {
        Map(BTreeMap<String, i64>),
        List(Vec<GoodAmount>),
    }
    match Shape::deserialize(de)? {
        Shape::Map(v) => Ok(v),
        Shape::List(v) => amount_map(v.into_iter().map(|a| (a.good, a.qty))),
    }
}
fn amount_map<E: serde::de::Error>(rows: impl Iterator<Item = (String, i64)>) -> Result<BTreeMap<String, i64>, E> {
    let mut result = BTreeMap::new();
    for (k, q) in rows {
        if result.insert(k, q).is_some() {
            return Err(E::custom("材料 key 重复"));
        }
    }
    Ok(result)
}
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub enum Target {
    Fleet(FleetId),
    Port(LocId),
    Event(String),
    #[serde(rename = "Self")]
    SelfTarget,
}
// I8 的单位变体拼写必须是 Self。
impl Target {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Fleet(_) => "fleet",
            Self::Port(_) => "port",
            Self::Event(_) => "event",
            Self::SelfTarget => "self",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Effect {
    FleetSpeed { pct: i64, days: u32 },
    StormGuard { pct: i64, days: u32 },
    Fog { pct: i64, days: u32 },
    Ward { power: i64, days: u32 },
    Divination,
    Reveal { radius: u16 },
    Heal { pct: i64 },
    Alchemy { items: BTreeMap<String, i64> },
}
impl Effect {
    pub fn targets(&self) -> Vec<&'static str> {
        match self {
            Self::Divination => vec!["event"],
            Self::StormGuard { .. } => vec!["fleet", "port"],
            Self::Alchemy { .. } => vec!["self"],
            _ => vec!["fleet", "self"],
        }
    }
    pub fn duration(&self) -> Option<u32> {
        match self {
            Self::FleetSpeed { days, .. }
            | Self::StormGuard { days, .. }
            | Self::Fog { days, .. }
            | Self::Ward { days, .. } => Some(*days),
            _ => None,
        }
    }
    pub fn value(&self) -> i64 {
        match self {
            Self::FleetSpeed { pct, .. }
            | Self::StormGuard { pct, .. }
            | Self::Fog { pct, .. }
            | Self::Heal { pct } => *pct,
            Self::Ward { power, .. } => *power,
            _ => 0,
        }
    }
    pub fn key(&self) -> &'static str {
        match self {
            Self::FleetSpeed { .. } => "fleet_speed",
            Self::StormGuard { .. } => "storm_guard",
            Self::Fog { .. } => "fog",
            Self::Ward { .. } => "ward",
            Self::Divination => "divination",
            Self::Reveal { .. } => "reveal",
            Self::Heal { .. } => "heal",
            Self::Alchemy { .. } => "alchemy",
        }
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ArcanaState {
    pub learned: BTreeSet<String>,
    pub last: BTreeMap<String, u32>,
    pub active: Vec<Active>,
    pub divinations: BTreeMap<String, u32>,
}
impl ArcanaState {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Active {
    pub spell: String,
    pub target: Target,
    pub started: u32,
    pub until: u32,
    pub power: i64,
}

impl World {
    pub fn school_level(&self, k: &str) -> i64 {
        self.defs.arcana.school(k).map_or(0, |s| {
            let rank = self
                .defs
                .societies
                .societies
                .iter()
                .filter_map(|d| {
                    self.society_rank(&d.key).filter(|r| {
                        d.ranks
                            .iter()
                            .take(*r as usize)
                            .flat_map(|r| &r.spells)
                            .any(|key| self.defs.arcana.spell(key).is_some_and(|spell| spell.school == k))
                    })
                })
                .max()
                .unwrap_or(0);
            self.idea_skill(OwnerId::Player, &s.skill).saturating_add(i64::from(rank)).clamp(0, 100)
        })
    }
    pub fn spell_known(&self, k: &str) -> bool {
        self.spell_known_without_oracle(k) || self.oracle_ship(k).is_some()
    }
    pub(crate) fn spell_known_without_oracle(&self, k: &str) -> bool {
        self.defs.arcana.spell(k).is_some_and(|s| {
            self.lineage_has_spell(k)
                || s.public
                || self.state.arcana.learned.contains(k)
                || self.item_hook(
                    OwnerId::Player,
                    "captain",
                    crate::captain::AttrHook::Spell,
                    &crate::items::effects::EffectContext { spell: Some(k), ..Default::default() },
                ) > 0
                || self.defs.societies.societies.iter().any(|d| {
                    d.ranks
                        .iter()
                        .take(self.society_rank(&d.key).unwrap_or(0) as usize)
                        .any(|r| r.spells.iter().any(|v| v == k))
                })
        })
    }
    pub fn spell_cooldown(&self, k: &str) -> u32 {
        self.defs
            .arcana
            .spell(k)
            .and_then(|s| {
                self.state.arcana.last.get(k).map(|day| day.saturating_add(s.cooldown_days).saturating_sub(self.day()))
            })
            .unwrap_or(0)
    }
    pub fn spell_ready(&self, owner: OwnerId, k: &str) -> Result<(), CommandError> {
        if owner != OwnerId::Player {
            return Err(blocked("arcana.player_only"));
        }
        let s = self.defs.arcana.spell(k).filter(|_| self.spell_known(k)).ok_or_else(|| blocked("arcana.unknown"))?;
        if self.school_level(&s.school) < i64::from(s.rank) || !self.story2_conditions(&s.requires, self.day()) {
            return Err(blocked("arcana.requirements"));
        }
        if self.spell_cooldown(k) > 0 {
            return Err(blocked("arcana.cooldown"));
        }
        if !self.oracle_ready(k) {
            return Err(blocked("legend_ship.oracle_month"));
        }
        self.check_arcana_cost(&s.cost)
    }
    /// 目标权限的只读校验；查询不能通过试算获取隐藏事件数据。
    pub fn spell_target_ready(&self, owner: OwnerId, k: &str, target: &Target) -> Result<(), CommandError> {
        self.spell_ready(owner, k)?;
        let s = self.defs.arcana.spell(k).ok_or_else(|| blocked("arcana.unknown"))?;
        if !s.effect.targets().contains(&target.kind()) {
            return Err(blocked("arcana.target"));
        }
        let fleet = self.arcana_target_fleet(target);
        if let Some(id) = fleet
            && self.state.fleets.get(&id).is_none_or(|f| f.owner != owner)
        {
            return Err(blocked("arcana.target"));
        }
        if matches!(target, Target::SelfTarget) && !matches!(s.effect, Effect::Alchemy { .. }) && fleet.is_none() {
            return Err(blocked("arcana.target"));
        }
        if let Target::Port(loc) = target
            && (self.defs.locations.get(loc.idx()).is_none_or(|l| !l.is_port()) || !self.presence(owner).contains(loc))
        {
            return Err(blocked("arcana.target"));
        }
        if let Target::Event(key) = target {
            let e = self
                .defs
                .history
                .event(key)
                .filter(|e| self.state.history.enabled && self.history_event_known(e))
                .ok_or_else(|| blocked("arcana.unknown_event"))?;
            // 只有玩家已有的公开事件与有效情报许可可以被占卜；不揭示私有门槛和隐藏人物。
            if e.locked && self.state.history.events.get(key).is_none_or(|s| !s.unlocked)
                || !e.window.is_some_and(|d| d[0] <= self.cast_date() && self.cast_date() <= d[1])
                || !e
                    .sides
                    .iter()
                    .filter_map(|side| side.port.as_ref().and_then(|p| self.defs.find_loc(p)))
                    .any(|p| self.presence(owner).contains(&p))
                || !self.state.history.known_events.contains_key(key)
            {
                return Err(blocked("arcana.intel_permission"));
            }
        }
        Ok(())
    }
    pub(crate) fn check_arcana_cost(&self, c: &Cost) -> Result<(), CommandError> {
        if validation::cost_error(&self.defs, c) {
            return Err(blocked("arcana.invalid_cost"));
        }
        if self.agent(OwnerId::Player)?.cash < c.cash {
            return Err(blocked("arcana.cash"));
        }
        if c.items.iter().any(|(i, q)| self.item_available(OwnerId::Player, i) < *q) {
            return Err(blocked("arcana.materials"));
        }
        if !c.goods.is_empty() {
            let f = self
                .flagship(OwnerId::Player)
                .and_then(|f| self.state.fleets.get(&f))
                .ok_or_else(|| blocked("arcana.fleet"))?;
            if c.goods
                .iter()
                .any(|(g, q)| self.defs.find_good(g).is_none_or(|g| f.cargo.get(&g).copied().unwrap_or(0) < *q))
            {
                return Err(blocked("arcana.materials"));
            }
        }
        Ok(())
    }
    pub(crate) fn pay_arcana_cost(&mut self, c: &Cost) -> Result<(), CommandError> {
        self.check_arcana_cost(c)?;
        let owner = OwnerId::Player;
        if c.cash > 0 {
            self.book_external(
                owner,
                crate::treasury::Flow::Other,
                crate::circulation::Sector::Hinterland,
                JournalEntry::new(self.day(), Memo::Other, CashClass::Operating)
                    .dr(Account::OtherExpense, c.cash)
                    .cr(Account::Cash, c.cash),
            )?;
        }
        for (i, q) in &c.items {
            self.take_item(owner, i, *q);
        }
        for (g, q) in &c.goods {
            let f = self.flagship(owner).ok_or_else(|| blocked("arcana.fleet"))?;
            let g = self.defs.find_good(g).ok_or_else(|| blocked("arcana.materials"))?;
            self.holder_take(owner, Holder::Fleet(f), g, *q)?;
            let cost = self.agent_mut(owner)?.book.remove(g, *q);
            self.book_internal(
                owner,
                JournalEntry::new(self.day(), Memo::Other, CashClass::Operating)
                    .dr(Account::OtherExpense, cost)
                    .cr(Account::Inventory, cost),
            )?;
        }
        Ok(())
    }
    fn arcana_target_fleet(&self, t: &Target) -> Option<FleetId> {
        match t {
            Target::Fleet(f) => Some(*f),
            Target::SelfTarget => self.flagship(OwnerId::Player),
            _ => None,
        }
    }
    pub fn arcana_bonus(&self, fleet: FleetId, kind: &str) -> i64 {
        let Some(f) = self.state.fleets.get(&fleet).filter(|f| f.owner == OwnerId::Player) else { return 0 };
        self.state
            .arcana
            .active
            .iter()
            .filter(|a| {
                a.until > self.day() && self.defs.arcana.spell(&a.spell).is_some_and(|s| s.effect.key() == kind)
            })
            .filter(|a| match a.target {
                Target::Fleet(id) => id == fleet,
                Target::SelfTarget => self.flagship(OwnerId::Player) == Some(fleet),
                Target::Port(loc) => {
                    self.defs.map.region_of(f.cell(&self.defs)) == self.defs.map.region_of(self.defs.loc(loc).cell)
                }
                _ => false,
            })
            .fold(0i64, |v, a| v.saturating_add(a.power))
            .min(if kind == "ward" { 20 } else { MAX_PCT })
    }
    pub(crate) fn arcana_day(&mut self) {
        let day = self.day();
        self.state.arcana.active.retain(|a| a.until > day);
    }
}
pub(crate) fn check(
    w: &World,
    owner: OwnerId,
    k: &str,
    target: &Target,
) -> Result<Box<crate::WorldState>, CommandError> {
    transaction(w, |w| {
        w.spell_ready(owner, k)?;
        let s = w.defs.arcana.spell(k).cloned().ok_or_else(|| blocked("arcana.unknown"))?;
        w.spell_target_ready(owner, k, target)?;
        let fleet = w.arcana_target_fleet(target);
        if s.effect.duration().is_some() && w.state.arcana.active.len() >= 1024 {
            return Err(blocked("arcana.limit"));
        }
        w.pay_arcana_cost(&s.cost)?;
        w.record_oracle(k);
        let power = (s.effect.value()
            + w.school_level(&s.school) / 10
            + w.attr_hook(owner, crate::captain::AttrHook::SpellPower).clamp(0, 50) / 10)
            .min(if matches!(s.effect, Effect::Ward { .. }) { 20 } else { MAX_PCT });
        if let Some(days) = s.effect.duration() {
            w.state.arcana.active.retain(|a| a.spell != k || a.target != *target);
            w.state.arcana.active.push(Active {
                spell: k.into(),
                target: target.clone(),
                started: w.day(),
                until: w.day().saturating_add(days),
                power,
            });
        }
        match &s.effect {
            Effect::Alchemy { items } => {
                for (i, q) in items {
                    w.grant_item(owner, i, *q)?;
                }
            }
            Effect::Divination => {
                if let Target::Event(key) = target {
                    w.observe_history();
                    let day = w.day();
                    let observation = w
                        .state
                        .history
                        .known_events
                        .get_mut(key)
                        .filter(|o| o.day == day)
                        .ok_or_else(|| blocked("arcana.intel_permission"))?;
                    observation.exact = true;
                    w.state.arcana.divinations.insert(key.clone(), day);
                }
            }
            Effect::Reveal { radius } => {
                if let Some(f) = fleet {
                    let cell = w.fleet(f)?.cell(&w.defs);
                    w.reveal_around(cell, i64::from(*radius));
                    w.record_sighted_locations();
                    w.detect_discoveries(&[(cell, None)], i64::from(*radius), 0);
                }
            }
            Effect::Heal { pct } => {
                if let Some(f) = fleet {
                    let f = w.fleet_mut(f)?;
                    f.days_at_sea = f.days_at_sea.saturating_sub(*pct as u32);
                    f.morale = (f.morale + *pct).min(100);
                }
            }
            _ => {}
        }
        w.record_forbidden(crate::societies::Activity::School(&s.school));
        w.state.arcana.last.insert(k.into(), w.day());
        Ok(())
    })
}
