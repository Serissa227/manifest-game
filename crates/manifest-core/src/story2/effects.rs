//! 效果逐项校验；调用者用试算副本保证资源与世界效果原子提交。
use super::*;
use crate::{World, error::CommandError};
fn blocked(s: &str) -> CommandError {
    CommandError::Precondition(s.into())
}
impl World {
    pub(super) fn story2_effect_amount(&self, effect: &Effect) -> Option<i64> {
        let owner = crate::OwnerId::Player;
        match effect {
            Effect::Affinity { person, .. } => Some(self.affection(person).map_or(0, |a| a.affinity)),
            Effect::Heart { person, .. } => Some(self.affection(person).map_or(0, |a| a.heart)),
            Effect::Cash { .. } => self.state.agents.get(&owner).map(|a| a.cash),
            Effect::Fame { .. } if self.upbringing_active() => self.state.upbringing.as_ref().map(|s| s.fame),
            Effect::Fame { .. } => self.state.agents.get(&owner).map(|a| a.fame),
            _ => None,
        }
    }
    pub(crate) fn apply_story2_effect(&mut self, effect: &Effect, academy: bool) -> Result<(), CommandError> {
        match effect {
            Effect::OpenRealm { realm } => self.open_realm(realm)?,
            Effect::EatOtherworld { realm } => self.eat_otherworld(realm)?,
            Effect::Transform { .. } => return Err(blocked("lineage.story_only")),
            Effect::LearnSpell { spell } => {
                if self.defs.arcana.spell(spell).is_none() {
                    return Err(blocked("arcana.unknown"));
                }
                self.state.arcana.learned.insert(spell.clone());
                // 会了法术就是秘术已经觉醒（U03 / A3）：养成的秘术成长与秘术课都认这个旗标。
                self.state.story2.flags.insert(crate::upbringing::ARCANA_AWAKENED_FLAG.into());
            }
            Effect::Flag { flag, value } => {
                if *value {
                    self.state.story2.flags.insert(flag.clone());
                    if !self.defs.cast.persons.is_empty() {
                        self.state.cast.flags.insert(flag.clone());
                    }
                } else {
                    self.state.story2.flags.remove(flag);
                    self.state.cast.flags.remove(flag);
                }
            }
            Effect::Affinity { person, value } => self.change_affinity(person, *value)?,
            Effect::Heart { person, value } => self.change_heart(person, *value)?,
            Effect::Relation { person, relation, remove } => {
                if academy && !*remove && matches!(relation, Relation::Dating | Relation::Lovers | Relation::Partners) {
                    return Err(blocked("学院期只允许朦胧的感情"));
                }
                self.change_relation(person, *relation, *remove)?;
            }
            Effect::Tie { a, b, relation, remove } => {
                let pair = if a < b { (a.clone(), b.clone()) } else { (b.clone(), a.clone()) };
                if *remove {
                    if self.defs.cast.person(a).is_none() || self.defs.cast.person(b).is_none() || a == b {
                        return Err(blocked("关系人物不存在"));
                    }
                    self.state.cast.ties.retain(|t| !((t.a == *a && t.b == *b) || (t.a == *b && t.b == *a)));
                    self.state.story2.removed_ties.insert(pair);
                    return Ok(());
                }
                self.state.story2.removed_ties.remove(&pair);
                if academy && matches!(relation, Relation::Dating | Relation::Lovers | Relation::Partners) {
                    return Err(blocked("学院期只允许朦胧的感情"));
                }
                self.change_tie(a, b, *relation)?;
            }
            Effect::Bond { person, level } => {
                if *level == Bond::S {
                    self.promise_to(person)?;
                } else {
                    self.remember_experience(person)?;
                    if self.affection(person).and_then(|a| a.bond).is_none_or(|b| b < *level) {
                        return Err(blocked("情谊或共同经历不足以提升羁绊"));
                    }
                }
            }
            Effect::Letter { person, text } => {
                if !self.person_alive(person) {
                    return Err(blocked("来信人不存在或已离世"));
                }
                self.remember_person(person, text);
                let ids: Vec<_> = self
                    .state
                    .story2
                    .news
                    .values()
                    .filter(|n| n.persons.contains(person) && !n.known)
                    .map(|n| n.id.clone())
                    .collect();
                self.disclose_story2_news(&ids, NewsKind::Letter);
            }
            Effect::Item { item, qty } => {
                if qty.abs_diff(0) > 10_000 || *qty == 0 {
                    return Err(CommandError::InvalidQuantity);
                }
                if *qty > 0 {
                    self.grant_item(crate::OwnerId::Player, item, *qty)?;
                } else if *qty < 0 {
                    let take = qty.checked_neg().ok_or(CommandError::InvalidQuantity)?;
                    if self.item_available(crate::OwnerId::Player, item) < take {
                        return Err(blocked("待交付的物品不足或仍在装备中"));
                    }
                    self.take_item(crate::OwnerId::Player, item, take);
                }
            }
            Effect::Skill { skill, value } => {
                if !self.defs.story2.skills.contains(skill) || !(0..=10_000).contains(value) {
                    return Err(blocked("技能或经验值无效"));
                }
                let xp = self
                    .state
                    .items
                    .owners
                    .entry(crate::OwnerId::Player)
                    .or_default()
                    .skill_xp
                    .entry(skill.clone())
                    .or_default();
                *xp = xp.saturating_add(*value);
            }
            Effect::Growth { attr, value } => {
                if self.defs.captain.attribute_index(attr).is_none() || !(0..=10_000).contains(value) {
                    return Err(blocked("成长属性或经验值无效"));
                }
                if self.upbringing_active() {
                    self.gain_upbringing_growth(attr, *value);
                } else {
                    let xp = self
                        .state
                        .items
                        .owners
                        .entry(crate::OwnerId::Player)
                        .or_default()
                        .attr_xp
                        .entry(attr.clone())
                        .or_default();
                    *xp = xp.saturating_add(*value);
                }
            }
            Effect::Memory { memory, title } => {
                self.state.story2.memories.insert(memory.clone(), title.clone());
                let day = self.day();
                if let Some(s) = &mut self.state.upbringing {
                    s.memory_days.entry(memory.clone()).or_insert(day);
                }
            }
            Effect::Title { title } => {
                self.state.cast.titles.insert(title.clone());
            }
            Effect::StartTrack { track } => {
                self.start_story2(track)?;
            }
            Effect::EndTrack { track } => {
                if self.defs.story2.track(track).is_none() {
                    return Err(CommandError::NotFound(track.clone()));
                }
                self.start_story2(track)?;
                if let Some(s) = self.state.story2.tracks.get_mut(track) {
                    s.status = Status::Done;
                }
                self.state.story2.pending.retain(|p| &p.track != track);
            }
            Effect::Join { person } => {
                let plan = crate::cast::interactions::check_recruit(self, crate::OwnerId::Player, person)?;
                crate::cast::interactions::apply(self, plan)?;
            }
            Effect::Leave { person } => {
                let mate = self.person_mate(person).ok_or_else(|| blocked("人物不是航海士"))?;
                let state = self
                    .state
                    .mates
                    .get_mut(&mate)
                    .filter(|m| m.owner == Some(crate::OwnerId::Player))
                    .ok_or_else(|| blocked("人物不在队中"))?;
                state.owner = None;
                state.role = crate::mates::MateRole::None;
                state.hired_on = None;
                self.refresh_trade_bonus();
            }
            Effect::Schedule { person, at, venue, until } => {
                if !self.person_alive(person)
                    || !self.defs.locations.iter().any(|l| &l.key == at)
                    || until.is_some_and(|d| d < self.cast_date() || self.story2_day(d).is_none())
                {
                    return Err(blocked("日程人物、地点或日期无效"));
                }
                let from = self.cast_date();
                self.state.cast.persons.entry(person.clone()).or_default().schedule = Some(crate::cast::ScheduleDef {
                    from,
                    to: *until,
                    at: at.clone(),
                    venue: venue.clone(),
                    seasons: Vec::new(),
                });
            }
            Effect::Cash { value } | Effect::Fame { value } => {
                if (matches!(effect, Effect::Cash { .. }) && value.abs_diff(0) > 20_000)
                    || (matches!(effect, Effect::Fame { .. }) && !(-20..=50).contains(value))
                {
                    return Err(blocked("故事收益超出单次边界"));
                }
                if matches!(effect, Effect::Fame { .. }) && self.upbringing_active() {
                    if let Some(s) = &mut self.state.upbringing {
                        s.fame = (s.fame + value).clamp(0, 100);
                    }
                    return Ok(());
                }
                let effect = if matches!(effect, Effect::Cash { .. }) {
                    crate::story::StoryEffect::Cash(*value)
                } else {
                    crate::story::StoryEffect::Fame(*value)
                };
                crate::story::apply(self, None, &effect)?;
            }
            Effect::Reputation { faction, value } => {
                if !(-20..=20).contains(value) {
                    return Err(blocked("故事声望超出单次边界"));
                }
                let id = self
                    .defs
                    .factions
                    .iter()
                    .position(|f| &f.key == faction)
                    .map(crate::FactionId::from_idx)
                    .ok_or_else(|| CommandError::NotFound(faction.clone()))?;
                crate::story::apply(self, None, &crate::story::StoryEffect::Reputation(Some(id), *value))?;
            }
            Effect::Chart { region } => {
                let id = self
                    .defs
                    .regions
                    .iter()
                    .position(|r| &r.key == region)
                    .map(crate::RegionId::from_idx)
                    .ok_or_else(|| CommandError::NotFound(region.clone()))?;
                crate::story::apply(self, None, &crate::story::StoryEffect::Chart(id))?;
            }
            Effect::World { title, text, effects } => {
                self.validate_composed(title, text, effects)?;
                self.start_composed(title, text, effects, crate::composed::ComposedSource::Rule)?;
            }
            Effect::LegendShip { ship } => {
                if self.upbringing_active() {
                    return Err(crate::Reason::new("legend_ship.upbringing", "（待写）").rule());
                }
                let fleet = self.flagship(crate::OwnerId::Player).ok_or_else(|| blocked("legend_ship.away"))?;
                self.grant_legend_ship(crate::OwnerId::Player, ship, fleet)?;
            }
        }
        Ok(())
    }
}
