//! 结社等级与辖区嫌疑；奖励随等级原子结算，感情关系不属于违禁行为。
pub mod validation;
use crate::{
    World,
    error::{CommandError, CoreError},
    ids::*,
    story2::{Condition, Effect, Status},
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_RANKS: usize = 20;
pub const MAX_SUSPICION: i64 = 100;

#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SocietiesDefs {
    pub societies: Vec<SocietyDef>,
    pub policies: Vec<Policy>,
}
impl SocietiesDefs {
    pub fn is_empty(&self) -> bool {
        self.societies.is_empty() && self.policies.is_empty()
    }
    pub fn society(&self, key: &str) -> Option<&SocietyDef> {
        self.societies.iter().find(|s| s.key == key)
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SocietyDef {
    pub key: String,
    pub name: String,
    #[serde(default)]
    pub secrecy: u8,
    pub seat: Option<String>,
    pub person: Option<String>,
    pub knowledge: Option<String>,
    pub basis: Option<String>,
    #[serde(default)]
    pub sources: Vec<String>,
    pub active: Option<[u32; 2]>,
    pub extended: Option<String>,
    #[serde(default)]
    pub allies: Vec<String>,
    #[serde(default)]
    pub enemies: Vec<String>,
    pub ranks: Vec<RankDef>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RankDef {
    pub name: String,
    pub requirement: String,
    pub reward: String,
    pub trial: Option<String>,
    pub trial_text: Option<String>,
    #[serde(default)]
    pub requires: Vec<Condition>,
    #[serde(default)]
    pub effects: Vec<Effect>,
    #[serde(default)]
    pub spells: Vec<String>,
    #[serde(default)]
    pub safe_houses: Vec<String>,
    #[serde(default)]
    pub price_pct: u8,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Forbids {
    pub societies: Vec<String>,
    pub schools: Vec<String>,
    pub ideas: Vec<String>,
    pub lineages: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    pub faction: String,
    pub forbids: Forbids,
    pub gain: i64,
    pub decay: i64,
    pub away_decay: i64,
    pub threshold: i64,
    pub event: Option<String>,
}
/// 封闭行为，不接收人物关系或任意字符串事件。
#[derive(Clone, Copy)]
pub(crate) enum Activity<'a> {
    Society(&'a str),
    Lineage(&'a str),
    School(&'a str),
    Idea(&'a str),
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct SocietiesState {
    pub members: BTreeMap<String, Membership>,
    pub met: BTreeSet<String>,
    pub relations: BTreeMap<String, i64>,
    pub suspicion: BTreeMap<FactionId, i64>,
    pub incidents: BTreeSet<FactionId>,
    pub last_day: Option<u32>,
}
impl SocietiesState {
    pub fn is_empty(&self) -> bool {
        self == &Self::default()
    }
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Membership {
    pub rank: u8,
    pub rewarded: BTreeSet<u8>,
    pub joined: u32,
}

pub(crate) fn blocked(code: &'static str) -> CommandError {
    crate::Reason::new(code, format!("未满足条件：{code}。")).rule()
}
/// 所有新模块共用试算副本，失败不扣资源、不写持久字段。
pub(crate) fn transaction(
    w: &World,
    f: impl FnOnce(&mut World) -> Result<(), CommandError>,
) -> Result<Box<crate::world::WorldState>, CommandError> {
    let mut next = World { defs: w.defs.clone(), state: w.state.clone() };
    f(&mut next)?;
    Ok(Box::new(next.state))
}
pub(crate) fn check(w: &World, owner: OwnerId, key: &str) -> Result<Box<crate::world::WorldState>, CommandError> {
    transaction(w, |w| {
        w.can_join_society(owner, key)?;
        let d = w.defs.societies.society(key).cloned().ok_or_else(|| blocked("society.unknown"))?;
        w.state.societies.met.insert(key.into());
        w.state.societies.members.insert(key.into(), Membership { joined: w.day(), ..Default::default() });
        for enemy in &d.enemies {
            let v = w.state.societies.relations.entry(enemy.clone()).or_default();
            *v = (*v - 10).max(-100);
        }
        w.record_forbidden(Activity::Society(key));
        w.advance_society(&d)?;
        Ok(())
    })
}
impl World {
    pub fn society_known(&self, key: &str) -> bool {
        self.defs.societies.society(key).is_some_and(|d| {
            self.state.societies.met.contains(key)
                || self.state.societies.members.contains_key(key)
                || d.knowledge.as_ref().map_or(d.secrecy == 0, |k| self.has_knowledge_record(k))
        })
    }
    pub fn society_rank(&self, key: &str) -> Option<u8> {
        self.state.societies.members.get(key).map(|m| m.rank)
    }
    pub fn can_join_society(&self, owner: OwnerId, key: &str) -> Result<(), CommandError> {
        if owner != OwnerId::Player {
            return Err(blocked("society.player_only"));
        }
        let d = self
            .defs
            .societies
            .society(key)
            .filter(|_| self.society_known(key))
            .ok_or_else(|| blocked("society.unknown"))?;
        if self.society_rank(key).is_some() {
            return Err(blocked("society.member"));
        }
        if d.active.is_some_and(|[a, b]| (self.cast_date()[0] < a || self.cast_date()[0] > b) && d.extended.is_none()) {
            return Err(blocked("society.inactive"));
        }
        if d.seat.as_ref().is_some_and(|loc| self.cast_player_place().is_none_or(|p| self.defs.loc(p.loc).key != *loc))
        {
            return Err(blocked("society.away"));
        }
        if d.person.as_ref().is_some_and(|p| !self.person_alive(p) || self.person_place(p) != self.cast_player_place())
        {
            return Err(blocked("society.contact"));
        }
        if d.ranks.first().is_none_or(|r| !self.story2_conditions(&r.requires, self.day())) {
            return Err(blocked("society.requirements"));
        }
        Ok(())
    }
    fn advance_society(&mut self, d: &SocietyDef) -> Result<(), CommandError> {
        // 一日最多一级；新试炼先登记，完成结果在下一次推进时领取。
        let Some(m) = self.state.societies.members.get(&d.key).cloned() else { return Ok(()) };
        let Some(r) = d.ranks.get(m.rank as usize) else { return Ok(()) };
        if !self.story2_conditions(&r.requires, m.joined) {
            return Ok(());
        }
        if let Some(track) = &r.trial {
            self.start_story2(track)?;
            if self.state.story2.tracks.get(track).is_none_or(|s| s.status != Status::Done) {
                return Ok(());
            }
        }
        let rank = m.rank + 1;
        if !m.rewarded.contains(&rank) {
            for e in &r.effects {
                self.apply_story2_effect(e, false)?;
            }
        }
        if let Some(m) = self.state.societies.members.get_mut(&d.key) {
            m.rank = rank;
            m.rewarded.insert(rank);
        }
        if let Some(track) = d.ranks.get(rank as usize).and_then(|r| r.trial.as_ref()) {
            self.start_story2(track)?;
        }
        Ok(())
    }
    pub fn society_price_discount(&self, loc: LocId) -> u8 {
        self.defs
            .societies
            .societies
            .iter()
            .filter(|s| s.seat.as_deref() == Some(&self.defs.loc(loc).key))
            .flat_map(|s| s.ranks.iter().take(self.society_rank(&s.key).unwrap_or(0) as usize))
            .map(|r| r.price_pct)
            .max()
            .unwrap_or(0)
            .min(30)
    }
    pub fn society_safe_house(&self, loc: LocId) -> bool {
        self.defs.societies.societies.iter().any(|s| {
            s.ranks
                .iter()
                .take(self.society_rank(&s.key).unwrap_or(0) as usize)
                .any(|r| r.safe_houses.contains(&self.defs.loc(loc).key))
        })
    }
    pub(crate) fn record_forbidden(&mut self, activity: Activity<'_>) {
        let Some(loc) = self.cast_player_place().map(|p| p.loc) else { return };
        let faction = self.location_faction(loc);
        let Some(policy) =
            self.defs.societies.policies.iter().find(|p| self.defs.factions[faction.idx()].key == p.faction)
        else {
            return;
        };
        let forbidden = match activity {
            Activity::Society(_) => &policy.forbids.societies,
            Activity::Lineage(_) => &policy.forbids.lineages,
            Activity::School(_) => &policy.forbids.schools,
            Activity::Idea(_) => &policy.forbids.ideas,
        };
        let key = match activity {
            Activity::Lineage(k) | Activity::Society(k) | Activity::School(k) | Activity::Idea(k) => k,
        };
        if forbidden.iter().any(|k| k == key) {
            let value = self.state.societies.suspicion.entry(faction).or_default();
            *value = value.saturating_add(policy.gain).min(MAX_SUSPICION);
        }
    }
    pub(crate) fn societies_day(&mut self) -> Result<(), CoreError> {
        if self.defs.societies.is_empty()
            || self.state.societies.is_empty()
            || self.state.societies.last_day == Some(self.day())
        {
            return Ok(());
        }
        let defs = self.defs.clone();
        // 奖励错误不吞掉，也不留下领取一半的状态。
        let next = transaction(self, |w| {
            for d in &defs.societies.societies {
                w.advance_society(d)?;
            }
            Ok(())
        })
        .map_err(|e| CoreError::SnapshotMismatch(e.to_string()))?;
        self.state = *next;
        let here = self.cast_player_place().map(|p| self.location_faction(p.loc));
        let safe = self.cast_player_place().is_some_and(|p| self.society_safe_house(p.loc));
        for p in &defs.societies.policies {
            let Some(f) = defs.factions.iter().position(|f| f.key == p.faction).map(FactionId::from_idx) else {
                continue;
            };
            let v = self.state.societies.suspicion.get(&f).copied().unwrap_or(0);
            if v >= p.threshold
                && self.state.societies.incidents.insert(f)
                && let Some(t) = &p.event
            {
                self.start_story2(t).map_err(|e| CoreError::SnapshotMismatch(e.to_string()))?;
            }
            if let Some(v) = self.state.societies.suspicion.get_mut(&f) {
                *v = v.saturating_sub(if here != Some(f) || safe { p.away_decay } else { p.decay }).max(0);
            }
        }
        self.state.societies.last_day = Some(self.day());
        Ok(())
    }
}
