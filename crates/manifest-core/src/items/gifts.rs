//! 礼物价值与类别只取静态定义；收礼的人物共享累计。
use super::reading::BookRecord;
use crate::{error::CommandError, ids::*, world::World};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct GiftRecord {
    pub count: u32,
    pub value: i64,
    pub kinds: BTreeMap<String, u64>,
    pub tags: BTreeMap<String, u64>,
    pub book_categories: BTreeMap<String, u64>,
    pub books: BTreeMap<String, BookRecord>,
}

impl World {
    pub(crate) fn valid_gift_inventory(&self, inv: &super::Inventory) -> bool {
        inv.gifts.values().all(|g| {
            g.count > 0
                && g.value >= 0
                && g.kinds.values().all(|n| *n > 0)
                && g.tags.values().all(|n| *n > 0)
                && g.book_categories.values().all(|n| *n > 0)
                && g.books.values().all(|b| b.day <= self.day())
        })
    }
    pub fn gifts_to(&self, owner: OwnerId, person: &str) -> Option<&GiftRecord> {
        self.inventory(owner)?.gifts.get(person)
    }
    pub fn gift_count(&self, owner: OwnerId, person: Option<&str>) -> u32 {
        self.inventory(owner).map_or(0, |i| {
            i.gifts
                .iter()
                .filter(|(key, _)| person.is_none_or(|p| *key == p))
                .fold(0u32, |sum, (_, g)| sum.saturating_add(g.count))
        })
    }
    pub fn gift_value(&self, owner: OwnerId, person: Option<&str>) -> i64 {
        self.inventory(owner).map_or(0, |i| {
            i.gifts
                .iter()
                .filter(|(key, _)| person.is_none_or(|p| *key == p))
                .fold(0i64, |sum, (_, g)| sum.saturating_add(g.value))
        })
    }
    pub fn gift_kinds(&self, owner: OwnerId, person: Option<&str>) -> usize {
        self.inventory(owner)
            .into_iter()
            .flat_map(|i| &i.gifts)
            .filter(|(key, _)| person.is_none_or(|p| *key == p))
            .flat_map(|(_, g)| g.kinds.keys())
            .collect::<BTreeSet<_>>()
            .len()
    }
    pub fn gift_category_count(&self, owner: OwnerId, person: &str, category: &str) -> u64 {
        self.gifts_to(owner, person)
            .and_then(|g| g.kinds.get(category).or_else(|| g.book_categories.get(category)))
            .copied()
            .unwrap_or(0)
    }
    pub fn recipient_has_read(&self, owner: OwnerId, person: &str, work: &str) -> bool {
        let work = self.defs.items.item(work).map(|i| i.work_key()).unwrap_or(work);
        self.gifts_to(owner, person).is_some_and(|g| g.books.contains_key(work))
    }
}

pub(crate) struct GiftPlan {
    owner: OwnerId,
    person: String,
    item: String,
    qty: i64,
    record: GiftRecord,
    cast: crate::cast::interactions::GiftInteraction,
}

pub(crate) fn check(
    world: &World,
    owner: OwnerId,
    person: &str,
    key: &str,
    qty: i64,
) -> Result<GiftPlan, CommandError> {
    let item = super::inventory::item(world, key)?;
    if qty <= 0 {
        return Err(CommandError::InvalidQuantity);
    }
    if item.protected() {
        return Err(CommandError::Precondition("关键物品不能送出".into()));
    }
    let available = world.item_available(owner, key);
    if qty > available {
        return Err(CommandError::InsufficientStock { available });
    }
    if owner != OwnerId::Player {
        return Err(CommandError::NotOwner);
    }
    if world.defs.cast.person(person).is_none() {
        return Err(CommandError::NotFound("这位收礼人尚未出现".into()));
    }
    let handmade = item.made_by.as_deref().is_some_and(|maker| {
        maker == "captain" || world.state.protagonist.as_ref().and_then(|p| p.protagonist.as_deref()) == Some(maker)
    });
    let cast = crate::cast::interactions::check_gift(world, owner, person, key, &item.name, &item.tags, handmade)?;
    let value = item.price.checked_mul(qty).ok_or(CommandError::InvalidQuantity)?;
    let mut record = world.gifts_to(owner, person).cloned().unwrap_or_default();
    record.count = record.count.checked_add(1).ok_or(CommandError::InvalidQuantity)?;
    record.value = record.value.checked_add(value).ok_or(CommandError::InvalidQuantity)?;
    let add = |map: &mut BTreeMap<String, u64>, key: &str| -> Result<(), CommandError> {
        let count = map.entry(key.into()).or_default();
        *count = count.checked_add(qty as u64).ok_or(CommandError::InvalidQuantity)?;
        Ok(())
    };
    add(&mut record.kinds, item.kind.key())?;
    for tag in item.tags.iter().collect::<BTreeSet<_>>() {
        add(&mut record.tags, tag)?;
    }
    if let Some(read) = &item.read {
        add(&mut record.book_categories, &read.category)?;
        record.books.entry(item.work_key().into()).or_insert(BookRecord {
            key: key.into(),
            day: world.day(),
            category: read.category.clone(),
        });
    }
    Ok(GiftPlan { owner, person: person.into(), item: key.into(), qty, record, cast })
}

pub(crate) fn apply(world: &mut World, p: GiftPlan) {
    world.take_item(p.owner, &p.item, p.qty);
    world.state.items.owners.entry(p.owner).or_default().gifts.insert(p.person, p.record);
    crate::cast::interactions::apply_gift(world, p.cast);
}
