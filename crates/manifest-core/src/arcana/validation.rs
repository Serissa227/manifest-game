//! 法术边界、等价交换与存档校验。
use super::*;
use crate::{StaticData, societies::validation::key};
pub fn religious(i: &crate::items::ItemDef) -> bool {
    i.read.as_ref().is_some_and(|r| r.category == "devotion")
        || i.tags.iter().any(|t| matches!(t.as_str(), "scripture" | "sacred_relic"))
}
pub fn cost_error(d: &StaticData, c: &Cost) -> bool {
    c.cash < 0
        || c.cash > MAX_VALUE
        || c.items.len() + c.goods.len() > 16
        || c.cash == 0 && c.items.is_empty() && c.goods.is_empty()
        || c.items
            .iter()
            .any(|(i, q)| !(1..=10000).contains(q) || d.items.item(i).is_none_or(|i| i.protected() || religious(i)))
        || c.goods.iter().any(|(g, q)| !(1..=10000).contains(q) || d.find_good(g).is_none())
        || material_value(d, c).is_none_or(|v| v > MAX_VALUE)
}
pub fn material_value(d: &StaticData, c: &Cost) -> Option<i64> {
    let mut sum = 0i64;
    for (i, q) in &c.items {
        sum = sum.checked_add(d.items.item(i)?.price.checked_mul(*q)?)?;
    }
    for (g, q) in &c.goods {
        sum = sum.checked_add(d.good(d.find_good(g)?).base_price.checked_mul(*q)?)?;
    }
    Some(sum)
}
pub fn validate(d: &StaticData) -> Vec<String> {
    let mut errors = Vec::new();
    let mut keys = BTreeSet::new();
    if d.arcana.spells.len() > 256 || d.arcana.schools.len() > 64 {
        errors.push("秘术目录超过上限".into());
    }
    for i in &d.items.items {
        if religious(i)
            && i.effects.iter().chain(&i.uses).any(|e| {
                matches!(
                    e.kind,
                    crate::items::effects::EffectKind::Arcana
                        | crate::items::effects::EffectKind::Spell
                        | crate::items::effects::EffectKind::Ward
                )
            })
        {
            errors.push(format!("{}：宗教典籍与圣物不能提供秘术效果", i.key));
        }
    }
    for set in &d.items.sets {
        let religious_set = set.items.iter().any(|k| d.items.item(k).is_some_and(religious));
        if religious_set
            && set.bonus.iter().any(|e| {
                matches!(
                    e.kind,
                    crate::items::effects::EffectKind::Arcana
                        | crate::items::effects::EffectKind::Spell
                        | crate::items::effects::EffectKind::Ward
                )
            })
        {
            errors.push(format!("{}：宗教藏品套装不能提供秘术效果", set.key));
        }
        if set.bonus.iter().any(|e| {
            e.kind == crate::items::effects::EffectKind::Spell
                && e.spell.as_ref().is_none_or(|k| d.arcana.spell(k).is_none())
        }) {
            errors.push(format!("{}：套装法术引用无效", set.key));
        }
    }
    for item in &d.items.items {
        for e in item.effects.iter().chain(&item.uses) {
            if e.kind == crate::items::effects::EffectKind::Spell
                && e.spell.as_ref().is_none_or(|k| d.arcana.spell(k).is_none())
            {
                errors.push(format!("{}：装备法术引用无效", item.key));
            }
        }
    }
    for s in &d.arcana.schools {
        if !key(&s.key) || !keys.insert(&s.key) || s.name.trim().is_empty() || !d.story2.skills.contains(&s.skill) {
            errors.push(format!("{}：流派或技能引用无效", s.key));
        }
    }
    let mut keys = BTreeSet::new();
    for s in &d.arcana.spells {
        let effect_ok = match &s.effect {
            Effect::FleetSpeed { pct, days } | Effect::StormGuard { pct, days } | Effect::Fog { pct, days } => {
                (1..=30).contains(pct) && (1..=MAX_DAYS).contains(days)
            }
            Effect::Ward { power, days } => (1..=10).contains(power) && (1..=MAX_DAYS).contains(days),
            Effect::Heal { pct } => (1..=30).contains(pct),
            Effect::Reveal { radius } => (1..=8).contains(radius),
            Effect::Divination => true,
            Effect::Alchemy { items } => {
                let mut value = 0i64;
                !items.is_empty()
                    && items.len() <= 16
                    && items.iter().all(|(i, q)| {
                        d.items.item(i).is_some_and(|i| {
                            !i.protected()
                                && !religious(i)
                                && (1..=100).contains(q)
                                && i.price.checked_mul(*q).and_then(|v| value.checked_add(v)).is_some_and(|sum| {
                                    value = sum;
                                    true
                                })
                        })
                    })
                    && value > 0
                    && value <= material_value(d, &s.cost).unwrap_or(0)
                    && value <= MAX_VALUE
            }
        };
        if !key(&s.key)
            || !keys.insert(&s.key)
            || s.name.trim().is_empty()
            || s.desc.trim().is_empty()
            || s.cost_note.trim().is_empty()
            || d.arcana.school(&s.school).is_none()
            || s.rank > 100
            || !(1..=3650).contains(&s.cooldown_days)
            || !effect_ok
            || cost_error(d, &s.cost)
            || s.requires.iter().any(|c| crate::story2::validation::condition_error(d, c).is_some())
        {
            errors.push(format!("{}：法术引用、费用、等价交换或效果边界无效", s.key));
        }
    }
    for s in &d.societies.societies {
        if s.ranks.iter().flat_map(|r| &r.spells).any(|k| d.arcana.spell(k).is_none()) {
            errors.push(format!("{}：结社引用未知法术", s.key));
        }
    }
    for p in &d.societies.policies {
        if p.forbids.schools.iter().any(|k| d.arcana.school(k).is_none()) {
            errors.push(format!("{}：违禁流派不存在", p.faction));
        }
    }
    errors
}
impl World {
    pub(crate) fn validate_arcana_snapshot(&self) -> Result<(), CoreError> {
        let s = &self.state.arcana;
        let mut unique = BTreeSet::new();
        let valid = s.is_empty()
            || !self.defs.arcana.is_empty()
                && s.learned.iter().all(|k| self.defs.arcana.spell(k).is_some())
                && s.last.iter().all(|(k, day)| self.defs.arcana.spell(k).is_some() && *day <= self.day())
                && s.active.len() <= 1024
                && s.active.iter().all(|a| {
                    self.defs.arcana.spell(&a.spell).is_some_and(|d| {
                        d.effect.duration().is_some_and(|days| a.until == a.started.saturating_add(days))
                            && a.started <= self.day()
                            && s.last.get(&a.spell).is_some_and(|day| *day >= a.started)
                            && d.effect.targets().contains(&a.target.kind())
                            && (1..=if matches!(d.effect, Effect::Ward { .. }) { 20 } else { MAX_PCT })
                                .contains(&a.power)
                            && unique.insert((a.spell.clone(), a.target.clone()))
                            && match &a.target {
                                Target::Fleet(f) => f.0 > 0 && f.0 < self.state.next_fleet,
                                Target::Port(p) => self.defs.locations.get(p.idx()).is_some(),
                                Target::SelfTarget => true,
                                _ => false,
                            }
                    })
                })
                && s.divinations.iter().all(|(k, day)| {
                    *day <= self.day()
                        && self.defs.history.event(k).is_some()
                        && self.state.history.known_events.contains_key(k)
                });
        if valid { Ok(()) } else { Err(CoreError::SnapshotMismatch("法术状态、目标或冷却无效".into())) }
    }
}
