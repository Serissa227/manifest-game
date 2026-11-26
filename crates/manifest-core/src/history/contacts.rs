//! NPC 的求见与引荐使用自己的档案和舰队，不能借用玩家的人际状态。
use super::*;
use crate::{World, error::CommandError, world::WorldState};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envoy {
    pub company: String,
    #[serde(default)]
    pub contacts: BTreeMap<String, i64>,
    #[serde(default)]
    pub titles: BTreeSet<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ContactChanges {
    pub affinity: BTreeMap<String, i64>,
    pub titles: BTreeSet<String>,
}
impl World {
    fn envoy(&self, owner: OwnerId) -> Option<&Envoy> {
        let OwnerId::Company(id) = owner else { return None };
        let company = self.defs.companies.get(id.idx())?;
        self.defs.history.envoys.iter().find(|e| e.company == company.key)
    }
    pub fn history_affinity(&self, owner: OwnerId, person: &str) -> Option<i64> {
        if owner == OwnerId::Player {
            self.state.cast.persons.get(person).filter(|s| s.met).map(|s| s.affection.affinity)
        } else {
            self.state
                .history
                .contact_changes
                .get(&owner)
                .and_then(|e| e.affinity.get(person))
                .copied()
                .or_else(|| self.envoy(owner).and_then(|e| e.contacts.get(person)).copied())
        }
    }
    pub fn can_history_audience(&self, owner: OwnerId, person: &str) -> Result<(), CommandError> {
        if owner == OwnerId::Player {
            return self.can_audience(person);
        }
        let p = self.defs.cast.person(person).ok_or_else(|| CommandError::NotFound(person.into()))?;
        let a = self.agent(owner)?;
        let at = self.person_place(person).filter(|_| self.person_alive(person)).ok_or(CommandError::WrongLocation)?;
        if !self.fleets_of(owner).any(|f| f.docked_at() == Some(at.loc)) || !self.location_open(at.loc) {
            return Err(CommandError::WrongLocation);
        }
        let meets = a.fame >= p.audience.fame
            && p.audience
                .reputation
                .iter()
                .all(|(f, need)| self.defs.find_faction(f).is_some_and(|f| self.reputation(owner, f) >= *need))
            && p.audience.titles.iter().all(|t| {
                self.envoy(owner).is_some_and(|e| e.titles.contains(t))
                    || self.state.history.contact_changes.get(&owner).is_some_and(|e| e.titles.contains(t))
                    || self.item_titles(owner).contains(&t.as_str())
            });
        let introduced = p
            .audience
            .introducer
            .as_ref()
            .is_some_and(|p| self.person_alive(p) && self.history_affinity(owner, p).is_some_and(|v| v >= 50));
        if meets || introduced { Ok(()) } else { Err(blocked("名声、声望、称号或引荐条件尚未达到")) }
    }
    pub fn history_audience_today(&self, owner: OwnerId, person: &str) -> bool {
        if owner == OwnerId::Player {
            self.state.cast.persons.get(person).is_some_and(|s| s.interactions.audience == Some(self.day()))
        } else {
            self.state.history.audiences.get(&owner).and_then(|m| m.get(person)) == Some(&self.day())
        }
    }
    pub fn history_conditions_for(&self, owner: OwnerId, event: &EventDef, conditions: &[Condition]) -> bool {
        if owner == OwnerId::Player {
            return self.history_conditions(event, conditions);
        }
        conditions.iter().all(|c| match c {
            Condition::History(HistoryCondition::Any { conditions }) => {
                conditions.iter().any(|c| self.history_conditions_for(owner, event, std::slice::from_ref(c)))
            }
            Condition::History(_) => self.history_conditions(event, std::slice::from_ref(c)),
            Condition::Story(c) => match c {
                story2::Condition::Cash { ge } => self.agent(owner).is_ok_and(|a| a.cash >= *ge),
                story2::Condition::Fame { ge } => self.agent(owner).is_ok_and(|a| a.fame >= *ge),
                story2::Condition::Reputation { faction, ge } => {
                    self.defs.find_faction(faction).is_some_and(|f| self.reputation(owner, f) >= *ge)
                }
                story2::Condition::Skill { skill, ge } => self.idea_skill(owner, skill) >= *ge,
                story2::Condition::Item { item, qty } => self.item_quantity(owner, item) >= *qty,
                story2::Condition::Equipped { item } => self.item_equipped(owner, item) > 0,
                story2::Condition::Mate { mate } => self
                    .defs
                    .find_mate(mate)
                    .and_then(|id| self.state.mates.get(&id))
                    .is_some_and(|m| m.owner == Some(owner)),
                story2::Condition::Growth { attr, ge } => {
                    self.inventory(owner).and_then(|i| i.attr_xp.get(attr)).copied().unwrap_or(0) >= *ge
                }
                story2::Condition::Attr { attr, ge } => {
                    let attrs = self
                        .state
                        .agents
                        .get(&owner)
                        .and_then(|a| a.captain.as_ref())
                        .map_or(&[][..], |c| c.attrs.as_slice());
                    let value = self.defs.captain.check_index(attr).map_or_else(
                        || self.idea_skill(owner, attr),
                        |index| {
                            self.defs
                                .captain
                                .check_value(attrs, index)
                                .saturating_add(self.equipment_bonus(owner, "captain").get(attr).copied().unwrap_or(0))
                        },
                    );
                    value >= *ge
                }
                story2::Condition::Read { work } => self.has_read_work(owner, work),
                story2::Condition::Books { ge, category } => {
                    self.books_read(owner, category.as_deref()) >= *ge as usize
                }
                story2::Condition::Affinity { person, ge } => {
                    self.history_affinity(owner, person).is_some_and(|v| v >= *ge)
                }
                story2::Condition::At { at, person: None } => {
                    self.defs.find_loc(at).is_some_and(|p| self.fleets_of(owner).any(|f| f.docked_at() == Some(p)))
                }
                story2::Condition::Location { culture, port } => {
                    self.fleets_of(owner).filter_map(|f| f.docked_at()).any(|p| {
                        let loc = self.defs.loc(p);
                        culture.as_ref().is_none_or(|c| loc.culture == *c) && port.is_none_or(|v| loc.is_port() == v)
                    })
                }
                story2::Condition::Gifts { person, count, value, kinds, category, qty } => {
                    count.is_none_or(|n| self.gift_count(owner, Some(person)) >= n)
                        && value.is_none_or(|n| self.gift_value(owner, Some(person)) >= n)
                        && kinds.is_none_or(|n| self.gift_kinds(owner, Some(person)) >= n as usize)
                        && category
                            .as_ref()
                            .is_none_or(|c| self.gift_category_count(owner, person, c) >= qty.unwrap_or(1))
                }
                story2::Condition::Wait { days } => {
                    self.day().saturating_sub(
                        event.window.and_then(|w| crate::scenario::day_of(&self.defs, w[0]).ok()).unwrap_or(0),
                    ) >= *days
                }
                story2::Condition::Date { .. }
                | story2::Condition::Season { .. }
                | story2::Condition::Alive { .. }
                | story2::Condition::Flag { .. }
                | story2::Condition::Tie { .. }
                | story2::Condition::Price { .. }
                | story2::Condition::At { person: Some(_), .. }
                | story2::Condition::Age { person: Some(_), .. } => self.story2_conditions(std::slice::from_ref(c), 0),
                _ => false,
            },
        })
    }
    /// 交涉收益和损失归发起者；全局世界效果沿用同一词表。
    pub(crate) fn apply_history_effect_for(&mut self, owner: OwnerId, effect: &Effect) -> Result<(), CommandError> {
        if owner == OwnerId::Player {
            return self.apply_history_effect(effect);
        }
        self.agent(owner)?;
        if let Some(error) = validation::effect_error(&self.defs, effect) {
            return Err(blocked(&error));
        }
        let Effect::Story(e) = effect else { return self.apply_history_effect(effect) };
        match e {
            story2::Effect::Cash { value } => {
                use crate::ledger::{Account, CashClass, JournalEntry, Memo};
                use crate::{circulation::Sector, treasury::Flow};
                let delta = if *value < 0 { -(-*value).min(self.agent(owner)?.cash.max(0)) } else { *value };
                let journal = JournalEntry::new(self.day(), Memo::Other, CashClass::Operating);
                if delta > 0 {
                    self.book_external(
                        owner,
                        Flow::Other,
                        Sector::Hinterland,
                        journal.dr(Account::Cash, delta).cr(Account::OtherIncome, delta),
                    )?;
                } else if delta < 0 {
                    self.book_external(
                        owner,
                        Flow::Other,
                        Sector::Hinterland,
                        journal.dr(Account::OtherExpense, -delta).cr(Account::Cash, -delta),
                    )?;
                }
            }
            story2::Effect::Fame { value } => {
                let a = self.agent_mut(owner)?;
                a.fame = a.fame.saturating_add(*value).max(0);
            }
            story2::Effect::Reputation { faction, value } => {
                let f = self.defs.find_faction(faction).ok_or_else(|| CommandError::NotFound(faction.clone()))?;
                self.adjust_reputation(owner, f, *value);
            }
            story2::Effect::Item { item, qty } => {
                if *qty > 0 {
                    self.grant_item(owner, item, *qty)?;
                } else {
                    if self.item_available(owner, item) < -*qty {
                        return Err(blocked("待交付物品不足"));
                    }
                    self.take_item(owner, item, -*qty);
                }
            }
            story2::Effect::Skill { skill, value } => {
                let xp = self.state.items.owners.entry(owner).or_default().skill_xp.entry(skill.clone()).or_default();
                *xp = xp.saturating_add(*value);
            }
            story2::Effect::Growth { attr, value } => {
                let xp = self.state.items.owners.entry(owner).or_default().attr_xp.entry(attr.clone()).or_default();
                *xp = xp.saturating_add(*value);
            }
            story2::Effect::Affinity { person, value } => {
                let before = self.history_affinity(owner, person).unwrap_or(0);
                self.state
                    .history
                    .contact_changes
                    .entry(owner)
                    .or_default()
                    .affinity
                    .insert(person.clone(), (before + value).clamp(0, 100));
            }
            story2::Effect::Title { title } => {
                self.state.history.contact_changes.entry(owner).or_default().titles.insert(title.clone());
            }
            story2::Effect::Flag { .. }
            | story2::Effect::Schedule { .. }
            | story2::Effect::Tie { .. }
            | story2::Effect::World { .. } => self.apply_history_effect(effect)?,
            _ => return Err(blocked("该个人叙事效果不适用于商会交涉")),
        }
        Ok(())
    }
}
pub(crate) fn check_audience(w: &World, owner: OwnerId, person: &str) -> Result<Box<WorldState>, CommandError> {
    if w.defs.history.is_empty() {
        return Err(CommandError::NotOwner);
    }
    w.can_history_audience(owner, person)?;
    let mut state = w.state.clone();
    state.history.audiences.entry(owner).or_default().insert(person.into(), w.day());
    Ok(Box::new(state))
}
pub(super) fn validate(d: &crate::StaticData) -> Vec<String> {
    let mut seen = BTreeSet::new();
    d.history
        .envoys
        .iter()
        .filter(|e| {
            !seen.insert(&e.company)
                || d.find_company(&e.company).is_none()
                || e.contacts.iter().any(|(p, a)| d.cast.person(p).is_none() || !(0..=100).contains(a))
        })
        .map(|e| format!("{}：使者档案无效", e.company))
        .collect()
}
pub(super) fn valid_snapshot(w: &World) -> bool {
    w.state.history.audiences.iter().all(|(o, m)| {
        *o != OwnerId::Player
            && w.state.agents.contains_key(o)
            && m.iter().all(|(p, d)| w.defs.cast.person(p).is_some() && *d <= w.day())
    }) && w.state.history.contact_changes.iter().all(|(o, c)| {
        *o != OwnerId::Player
            && w.state.agents.contains_key(o)
            && c.affinity.iter().all(|(p, a)| w.defs.cast.person(p).is_some() && (0..=100).contains(a))
            && c.titles.iter().all(|t| !t.is_empty())
    })
}
