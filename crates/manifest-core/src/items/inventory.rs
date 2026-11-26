//! 物品栏与消耗品。物品只记件数，现金消费仍走既有复式账本。
use super::{
    ItemDef, ItemKind,
    effects::{self, Effect, EffectContext},
};
use crate::{
    captain::AttrHook,
    error::{CommandError, CoreError},
    ids::*,
    world::World,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ItemsState {
    pub owners: BTreeMap<OwnerId, Inventory>,
    pub shelves: BTreeMap<LocId, super::shop::Shelf>,
}
impl ItemsState {
    pub fn is_empty(&self) -> bool {
        self.owners.is_empty() && self.shelves.is_empty()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Inventory {
    pub quantities: BTreeMap<String, i64>,
    pub seen: BTreeSet<String>,
    pub acquired: BTreeSet<String>,
    pub active: Vec<ActiveItem>,
    pub equipment: BTreeMap<String, BTreeMap<super::equipment::EquipSlot, String>>,
    pub reading: Option<super::reading::Reading>,
    pub read_progress: BTreeMap<String, u32>,
    pub bibliography: BTreeMap<String, super::reading::BookRecord>,
    pub attr_xp: BTreeMap<String, i64>,
    pub skill_xp: BTreeMap<String, i64>,
    pub gifts: BTreeMap<String, super::gifts::GiftRecord>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActiveItem {
    pub item: String,
    pub until: u32,
}

pub(crate) fn unavailable() -> CommandError {
    CommandError::Precondition("这个世界没有物品模块".into())
}

pub(crate) fn item<'a>(world: &'a World, key: &str) -> Result<&'a ItemDef, CommandError> {
    if !world.defs.items.enabled() {
        return Err(unavailable());
    }
    world.defs.items.item(key).ok_or_else(|| CommandError::Precondition("未知物品".into()))
}

impl World {
    pub fn inventory(&self, owner: OwnerId) -> Option<&Inventory> {
        self.state.items.owners.get(&owner)
    }
    pub fn item_quantity(&self, owner: OwnerId, key: &str) -> i64 {
        self.inventory(owner).and_then(|i| i.quantities.get(key)).copied().unwrap_or(0)
    }
    pub fn item_available(&self, owner: OwnerId, key: &str) -> i64 {
        self.item_quantity(owner, key).saturating_sub(self.item_equipped(owner, key))
    }
    /// 供故事、掉落、拍卖等已校验的内核计划授予物品；外壳不能提交任意赠物命令。
    pub fn grant_item(&mut self, owner: OwnerId, key: &str, qty: i64) -> Result<(), CommandError> {
        self.agent(owner)?;
        item(self, key)?;
        if qty <= 0 {
            return Err(CommandError::InvalidQuantity);
        }
        let total = self.item_quantity(owner, key).checked_add(qty).ok_or(CommandError::InvalidQuantity)?;
        let inv = self.state.items.owners.entry(owner).or_default();
        inv.quantities.insert(key.into(), total);
        inv.acquired.insert(key.into());
        inv.seen.insert(key.into());
        Ok(())
    }
    pub(crate) fn take_item(&mut self, owner: OwnerId, key: &str, qty: i64) {
        if let Some(inv) = self.state.items.owners.get_mut(&owner) {
            if let Some(n) = inv.quantities.get_mut(key) {
                *n -= qty;
            }
            inv.quantities.retain(|_, n| *n > 0);
        }
    }
    pub fn collection_value(&self, owner: OwnerId) -> i64 {
        self.inventory(owner).map_or(0, |inv| {
            inv.quantities.iter().fold(0i64, |sum, (key, qty)| {
                sum.saturating_add(self.defs.items.item(key).map_or(0, |i| i.price.saturating_mul(*qty)))
            })
        })
    }
    pub(crate) fn item_effect_sources(&self, owner: OwnerId, wearer: &str) -> Vec<(String, Vec<Effect>)> {
        let mut sources = self.equipment_effect_sources(owner, wearer);
        if wearer == "captain" && owner == OwnerId::Player {
            sources.extend(self.upbringing_effect_sources());
            // K01：技能当前等级的效果并进同一个汇总（开关关着时为空）
            sources.extend(self.skill_effect_sources());
        }
        if wearer == "captain" {
            sources.extend(
                self.inventory(owner)
                    .into_iter()
                    .flat_map(|inv| &inv.active)
                    .filter(|a| a.until > self.state.day)
                    .filter_map(|a| self.defs.items.item(&a.item).map(|i| (format!("use:{}", i.key), i.uses.clone()))),
            );
        }
        sources
    }
    pub fn item_hook(&self, owner: OwnerId, wearer: &str, hook: AttrHook, context: &EffectContext<'_>) -> i64 {
        // K01：没有物品模块的世界里，技能效果打开时也走这个汇总
        if !self.defs.items.enabled() && !self.skill_effects_enabled() {
            return 0;
        }
        let sources = self.item_effect_sources(owner, wearer);
        effects::aggregate(sources.iter().map(|(k, e)| (k.as_str(), e.as_slice())), &self.defs.rules.items, context)
            .iter()
            .filter(|(kind, _)| kind.hook().0 == hook)
            .fold(0i64, |sum, (kind, v)| sum.saturating_add(v.saturating_mul(kind.hook().1)))
    }
    pub(crate) fn items_day(&mut self) -> Result<(), CoreError> {
        if !self.defs.items.enabled() {
            return Ok(());
        }
        for inv in self.state.items.owners.values_mut() {
            inv.active.retain(|a| a.until > self.state.day);
        }
        self.prune_equipment();
        self.items_reading_day()?;
        self.restock_items();
        Ok(())
    }
    pub(crate) fn validate_item_snapshot(&self) -> Result<(), CoreError> {
        let fail = || CoreError::SnapshotMismatch("物品状态包含负库存或不可能的记录".into());
        for (owner, inv) in &self.state.items.owners {
            if !self.state.agents.contains_key(owner)
                || inv.quantities.values().any(|n| *n <= 0)
                || inv.active.iter().map(|a| &a.item).collect::<BTreeSet<_>>().len() != inv.active.len()
                || !self.valid_reading_inventory(inv)
                || !self.valid_gift_inventory(inv)
            {
                return Err(fail());
            }
            for slots in inv.equipment.values() {
                if slots.values().any(|key| self.item_equipped(*owner, key) > self.item_quantity(*owner, key)) {
                    return Err(fail());
                }
            }
        }
        for shelf in self.state.items.shelves.values() {
            if shelf.stock.values().any(|n| *n < 0) {
                return Err(fail());
            }
        }
        Ok(())
    }

    /// 内容删改不是坏档；修剪失效引用，缩短的阅读留到下一天正常完成。
    pub(crate) fn reconcile_items(&mut self) {
        let before = self.state.items.clone();
        let keep_skills = self.upbringing_active();
        if !self.defs.items.enabled() {
            // 人物赠送商品不依赖物品模块；关闭物品后仍保留这些往来记录。
            let owners = std::mem::take(&mut self.state.items.owners);
            self.state.items = ItemsState::default();
            for (owner, inv) in owners {
                let gifts = inv
                    .gifts
                    .into_iter()
                    .filter(|(person, gift)| {
                        self.defs.cast.person(person).is_some() && gift.kinds.keys().all(|kind| kind == "goods")
                    })
                    .collect::<BTreeMap<_, _>>();
                // 养成技能不依赖物品目录；只保留仍在技能符号表中的经验。
                let skill_xp = if keep_skills && owner == OwnerId::Player {
                    inv.skill_xp.into_iter().filter(|(key, _)| self.defs.story2.skills.contains(key)).collect()
                } else {
                    BTreeMap::new()
                };
                if !gifts.is_empty() || !skill_xp.is_empty() {
                    self.state.items.owners.insert(owner, Inventory { gifts, skill_xp, ..Inventory::default() });
                }
            }
        } else {
            let defs = &self.defs;
            let item = |key: &str| defs.items.item(key);
            let book = |key: &str| item(key).filter(|i| i.read.is_some());
            // 首读按作品去重；版本和类别只是当时的记录，不是保留奖励标志的条件。
            let works: BTreeSet<_> = defs.items.items.iter().map(ItemDef::work_key).collect();
            for inv in self.state.items.owners.values_mut() {
                inv.quantities.retain(|k, _| item(k).is_some());
                inv.seen.retain(|k| item(k).is_some());
                inv.acquired.retain(|k| item(k).is_some());
                inv.active.retain(|a| item(&a.item).is_some());
                for slots in inv.equipment.values_mut() {
                    slots.retain(|slot, k| item(k).is_some_and(|i| i.kind == slot.kind()));
                }
                inv.read_progress.retain(|key, units| {
                    let Some(read) = book(key).and_then(|i| i.read.as_ref()) else { return false };
                    *units = (*units).min(read.days.saturating_mul(2).saturating_sub(1));
                    true
                });
                inv.bibliography.retain(|work, _| works.contains(work.as_str()));
                if inv.reading.as_ref().is_some_and(|r| {
                    book(&r.book).zip(book(&r.source)).is_none_or(|(a, b)| a.work_key() != b.work_key())
                        || r.interpreter.as_ref().is_some_and(|key| !defs.mates.iter().any(|m| m.key == *key))
                }) {
                    inv.reading = None;
                }
                inv.attr_xp.retain(|key, _| defs.captain.attribute_index(key).is_some());
                inv.gifts.retain(|person, _| defs.cast.person(person).is_some());
                for gift in inv.gifts.values_mut() {
                    gift.book_categories.retain(|k, _| defs.items.book_categories.iter().any(|c| c.key == *k));
                    gift.books.retain(|work, _| works.contains(work.as_str()));
                }
            }
            self.state.items.shelves.retain(|loc, shelf| {
                shelf.stock.retain(|key, _| item(key).is_some());
                // 阶段店和独立书架不依赖 shop；阶段回落后也保留已存的本月库存。
                defs.locations
                    .get(loc.idx())
                    .is_some_and(|l| l.is_port() && (l.shop || defs.rules.stage_unlocks.enabled))
            });
            self.prune_equipment();
        }
        if before != self.state.items {
            self.push_log(crate::log::LogEvent { day: self.day(), kind: crate::log::LogKind::ItemsReconciled });
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct UsePlan {
    owner: OwnerId,
    item: String,
    regions: Vec<RegionId>,
    until: u32,
}

pub(crate) fn check_use(
    world: &World,
    owner: OwnerId,
    key: &str,
    target: Option<&str>,
) -> Result<UsePlan, CommandError> {
    let def = item(world, key)?;
    if target.is_some_and(|t| t != "captain") {
        return Err(CommandError::Precondition("这种道具只能由主角使用".into()));
    }
    if world.item_available(owner, key) < 1 {
        return Err(CommandError::InsufficientStock { available: 0 });
    }
    if def.protected()
        || (!matches!(def.kind, ItemKind::Consumable | ItemKind::Chart))
        || (def.uses.is_empty() && def.chart.is_none())
    {
        return Err(CommandError::Precondition("这件物品不能直接使用".into()));
    }
    let regions: Vec<_> = def
        .chart
        .iter()
        .flat_map(|c| &c.regions)
        .chain(def.uses.iter().filter(|e| e.value > 0).filter_map(|e| e.region.as_ref()))
        .filter_map(|r| world.defs.regions.iter().position(|def| &def.key == r).map(RegionId::from_idx))
        .collect();
    if !regions.is_empty() && owner != OwnerId::Player {
        return Err(CommandError::NotOwner);
    }
    let until = world.state.day.checked_add(world.defs.rules.items.use_days).ok_or(CommandError::InvalidQuantity)?;
    Ok(UsePlan { owner, item: key.into(), regions, until })
}

pub(crate) fn use_item(world: &mut World, p: UsePlan) -> Result<(), CoreError> {
    for region in p.regions {
        crate::explore::exec_chart(world, p.owner, crate::explore::ChartPlan { region, cost: 0 })?;
    }
    world.take_item(p.owner, &p.item, 1);
    if world.defs.items.item(&p.item).is_some_and(|i| !i.uses.is_empty()) {
        let inv = world.state.items.owners.entry(p.owner).or_default();
        // 同一种消耗品只刷新期限，不能用重复消耗无限叠加。
        inv.active.retain(|a| a.item != p.item);
        inv.active.push(ActiveItem { item: p.item, until: p.until });
        inv.active.sort_by(|a, b| a.item.cmp(&b.item));
    }
    Ok(())
}
