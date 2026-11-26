//! 七个装备槽只占用物品栏中的数量；不复制物品，卸下后恢复可用数量。
use super::{ItemKind, effects::Effect};
use crate::{captain::AttrHook, error::CommandError, ids::*, world::World};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EquipSlot {
    Weapon,
    Sidearm,
    Outfit,
    Accessory1,
    Accessory2,
    Instrument,
    Focus,
}
impl EquipSlot {
    pub const ALL: [Self; 7] =
        [Self::Weapon, Self::Sidearm, Self::Outfit, Self::Accessory1, Self::Accessory2, Self::Instrument, Self::Focus];
    pub fn kind(self) -> ItemKind {
        match self {
            Self::Weapon => ItemKind::Weapon,
            Self::Sidearm => ItemKind::Sidearm,
            Self::Outfit => ItemKind::Outfit,
            Self::Accessory1 | Self::Accessory2 => ItemKind::Accessory,
            Self::Instrument => ItemKind::Instrument,
            Self::Focus => ItemKind::Focus,
        }
    }
}

impl World {
    pub fn item_wearer(&self, owner: OwnerId, wearer: &str) -> bool {
        self.state.agents.contains_key(&owner)
            && (wearer == "captain"
                || self.defs.mates.iter().enumerate().any(|(i, m)| {
                    m.key == wearer
                        && self.state.mates.get(&MateId::from_idx(i)).is_some_and(|s| s.owner == Some(owner))
                }))
    }
    pub fn equipped_item(&self, owner: OwnerId, wearer: &str, slot: EquipSlot) -> Option<&str> {
        if !self.item_wearer(owner, wearer) {
            return None;
        }
        self.inventory(owner)?.equipment.get(wearer)?.get(&slot).map(String::as_str)
    }
    pub fn item_equipped(&self, owner: OwnerId, key: &str) -> i64 {
        self.inventory(owner)
            .into_iter()
            .flat_map(|i| &i.equipment)
            .filter(|(w, _)| self.item_wearer(owner, w))
            .flat_map(|(_, slots)| slots.values())
            .filter(|k| k.as_str() == key)
            .count() as i64
    }
    pub fn equipment_bonus(&self, owner: OwnerId, wearer: &str) -> BTreeMap<String, i64> {
        let mut result = BTreeMap::<String, i64>::new();
        for slot in EquipSlot::ALL {
            if let Some(item) = self.equipped_item(owner, wearer, slot).and_then(|key| self.defs.items.item(key)) {
                for (attr, value) in &item.bonus {
                    let v = result.entry(attr.clone()).or_default();
                    *v = v
                        .saturating_add((*value).clamp(0, self.defs.rules.items.attribute_bonus.single))
                        .min(self.defs.rules.items.attribute_bonus.total);
                }
            }
        }
        result
    }
    /// 旧航海士四能力按相应属性组的量纲显示；岗位基础公式仍由 A2 原实现负责。
    pub fn wearer_base_attrs(&self, owner: OwnerId, wearer: &str) -> Vec<i64> {
        if !self.item_wearer(owner, wearer) {
            return Vec::new();
        }
        if wearer == "captain" {
            return self.captain_profile(owner).map(|c| c.attrs.clone()).unwrap_or_default();
        }
        let Some(id) = self.defs.mates.iter().position(|m| m.key == wearer).map(MateId::from_idx) else {
            return Vec::new();
        };
        self.defs
            .captain
            .attributes
            .iter()
            .enumerate()
            .map(|(i, attr)| {
                let ability = match attr.key.as_str() {
                    "seamanship" => "navigation",
                    "commerce" => "trade",
                    "arms" => "combat",
                    "stewardship" => "management",
                    s => s,
                };
                let base = self.mate_ability(id, ability);
                self.defs.captain.group(i).map_or(base, |g| {
                    let value = if g.range[1] <= 10 { base / 10 } else { base };
                    value.clamp(g.range[0], g.range[1])
                })
            })
            .collect()
    }
    pub fn wearer_attrs(&self, owner: OwnerId, wearer: &str) -> Vec<i64> {
        let bonus = self.equipment_bonus(owner, wearer);
        let mut attrs = self.wearer_base_attrs(owner, wearer);
        for (i, a) in self.defs.captain.attributes.iter().enumerate() {
            if let Some(value) = attrs.get_mut(i) {
                *value = value.saturating_add(bonus.get(&a.key).copied().unwrap_or(0));
                if let Some(g) = self.defs.captain.group(i) {
                    *value = (*value).clamp(g.range[0], g.range[1]);
                }
            }
        }
        attrs
    }
    pub(crate) fn equipment_attribute_hook(&self, owner: OwnerId, wearer: &str, hook: AttrHook) -> i64 {
        if !self.defs.items.enabled() {
            return 0;
        }
        let defs = &self.defs.captain;
        let rules = &self.defs.rules.attributes;
        let base = defs.hook_value(&self.wearer_base_attrs(owner, wearer), hook, rules);
        defs.hook_value(&self.wearer_attrs(owner, wearer), hook, rules).saturating_sub(base).max(0)
    }
    pub fn item_set_count(&self, owner: OwnerId, set: &str) -> usize {
        self.defs
            .items
            .sets
            .iter()
            .find(|s| s.key == set)
            .map_or(0, |s| s.items.iter().filter(|k| self.item_quantity(owner, k) > 0).count())
    }
    pub fn item_titles(&self, owner: OwnerId) -> Vec<&str> {
        self.defs
            .items
            .sets
            .iter()
            .filter(|s| self.item_set_count(owner, &s.key) >= s.threshold())
            .filter(|s| !s.title.is_empty())
            .map(|s| s.title.as_str())
            .collect()
    }
    pub(crate) fn equipment_effect_sources(&self, owner: OwnerId, wearer: &str) -> Vec<(String, Vec<Effect>)> {
        let mut result = Vec::new();
        for slot in EquipSlot::ALL {
            if let Some(item) = self.equipped_item(owner, wearer, slot).and_then(|key| self.defs.items.item(key)) {
                result.push((format!("equip:{slot:?}:{}", item.key), item.effects.clone()));
            }
        }
        if wearer == "captain" {
            for set in &self.defs.items.sets {
                if self.item_set_count(owner, &set.key) >= set.threshold() {
                    result.push((format!("set:{}", set.key), set.bonus.clone()));
                }
            }
        }
        result
    }
    /// 离队的航海士立即归还装备；再次雇用不会复活旧槽位。
    pub(crate) fn prune_equipment(&mut self) {
        if !self.defs.items.enabled() {
            return;
        }
        let live: BTreeSet<_> = self
            .state
            .mates
            .iter()
            .filter_map(|(id, m)| Some((m.owner?, self.defs.mates.get(id.idx())?.key.clone())))
            .collect();
        for (owner, inv) in &mut self.state.items.owners {
            inv.equipment.retain(|wearer, _| wearer == "captain" || live.contains(&(*owner, wearer.clone())));
        }
    }
}

pub(crate) struct EquipmentPlan {
    owner: OwnerId,
    wearer: String,
    slot: EquipSlot,
    item: Option<String>,
}
pub(crate) fn check(
    world: &World,
    owner: OwnerId,
    wearer: &str,
    slot: EquipSlot,
    key: Option<&str>,
) -> Result<EquipmentPlan, CommandError> {
    if !world.defs.items.enabled() {
        return Err(super::inventory::unavailable());
    }
    if !world.item_wearer(owner, wearer) {
        return Err(CommandError::NotOwner);
    }
    if let Some(key) = key {
        let def = super::inventory::item(world, key)?;
        if slot.kind() != def.kind {
            return Err(CommandError::Precondition("物品与装备槽不匹配".into()));
        }
        let current = world.equipped_item(owner, wearer, slot) == Some(key);
        if world.item_available(owner, key) < 1 && !current {
            return Err(CommandError::InsufficientStock { available: world.item_available(owner, key) });
        }
    } else if world.equipped_item(owner, wearer, slot).is_none() {
        return Err(CommandError::Precondition("这个装备槽是空的".into()));
    }
    Ok(EquipmentPlan { owner, wearer: wearer.into(), slot, item: key.map(str::to_owned) })
}
pub(crate) fn apply(world: &mut World, p: EquipmentPlan) {
    let inv = world.state.items.owners.entry(p.owner).or_default();
    let slots = inv.equipment.entry(p.wearer).or_default();
    if let Some(key) = p.item {
        slots.insert(p.slot, key);
    } else {
        slots.remove(&p.slot);
    }
    inv.equipment.retain(|_, slots| !slots.is_empty());
}
