//! 月货架使用独立随机域；查价不推进随机数，也不刷新状态。
use super::inventory::item;
use crate::{
    error::{CommandError, CoreError},
    fixed::mul_div,
    ids::*,
    ledger::{Account, CashClass, JournalEntry, Memo},
    rng::{Domain, Rng},
    treasury::Flow,
    world::World,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Shelf {
    pub month: u32,
    pub restock: u32,
    pub stock: BTreeMap<String, i64>,
}

impl World {
    pub fn item_shelf(&self, loc: LocId) -> Option<&Shelf> {
        if !self.location_open(loc) {
            return None;
        }
        self.state.items.shelves.get(&loc)
    }
    pub fn item_buy_price(&self, owner: OwnerId, loc: LocId, key: &str) -> Option<i64> {
        let i = self.defs.items.item(key)?;
        Some(
            mul_div(
                i.price,
                10_000
                    - (self.bargain_discount(owner, loc).0.clamp(0, crate::news::MAX_DISCOUNT.0)
                        + if owner == OwnerId::Player { i64::from(self.society_price_discount(loc)) * 100 } else { 0 })
                    .min(5_000),
                10_000,
            )
            .max(1)
            .max(self.item_sell_price(key).unwrap_or(0)),
        )
    }
    pub fn item_sell_price(&self, key: &str) -> Option<i64> {
        self.defs.items.item(key).map(|i| mul_div(i.price, self.defs.rules.items.sell_bp, 10_000))
    }
    pub fn at_item_shop(&self, owner: OwnerId, loc: LocId) -> bool {
        self.location_open(loc) && self.fleets_of(owner).any(|f| f.docked_at() == Some(loc))
    }
    pub(crate) fn restock_items(&mut self) {
        if !self.defs.items.enabled() {
            return;
        }
        let defs = self.defs.clone();
        let cal = &defs.calendar;
        let month = cal.month_index(self.state.day);
        let first = self.state.day - (cal.date_of(self.state.day).day - 1);
        let restock = first.saturating_add(u32::from(cal.months()[(cal.date_of(first).month - 1) as usize]));
        let year = self.defs.rules.world.start_year + i64::from(cal.date_of(self.state.day).year) - 1;
        for (idx, loc) in defs.locations.iter().enumerate().filter(|(_, l)| l.is_port()) {
            let id = LocId::from_idx(idx);
            if !self.effective_shop(id)
                || !self.port_is_open(id)
                || self.item_shelf(id).is_some_and(|s| s.month == month)
            {
                continue;
            }
            let season = loc.hemisphere.season(cal.season_of(first)).index() as u8;
            let mut candidates: Vec<_> = self
                .defs
                .items
                .items
                .iter()
                .filter_map(|i| {
                    let rule = i.shop.as_ref()?;
                    (rule.min_size <= self.effective_size(id)
                        && (rule.cultures.is_empty() || rule.cultures.contains(&loc.culture))
                        && (rule.seasons.is_empty() || rule.seasons.contains(&season))
                        && i.published.as_ref().is_none_or(|(y, _)| *y <= year)
                        && !i.protected())
                    .then_some((i.key.clone(), rule.weight))
                })
                .collect();
            candidates.sort_by(|a, b| a.0.cmp(&b.0));
            let mut rng = Rng::derive(self.state.seed, first, Domain::Items, u64::from(id.0), 0);
            let mut stock = BTreeMap::new();
            let regular = loc.shop
                || (defs.rules.stage_unlocks.enabled && self.port_stage(id) >= defs.rules.stage_unlocks.shop_stage);
            let slots = if regular { defs.rules.items.shelf_slots.min(candidates.len()) } else { 0 };
            for _ in 0..slots {
                let Some(pick) = rng.weighted(&candidates.iter().map(|(_, w)| *w).collect::<Vec<_>>()) else {
                    break;
                };
                let (key, _) = candidates.remove(pick);
                stock.insert(key, self.defs.rules.items.stock);
            }
            if self.book_shelf(id) {
                candidates.retain(|(key, _)| defs.items.item(key).is_some_and(|i| i.kind == super::ItemKind::Book));
                let mut books = Rng::derive(self.state.seed, first, Domain::Items, u64::from(id.0), 1);
                for _ in 0..defs.rules.stage_unlocks.book_slots.min(candidates.len()) {
                    let Some(pick) = books.weighted(&candidates.iter().map(|(_, w)| *w).collect::<Vec<_>>()) else {
                        break;
                    };
                    let (key, _) = candidates.remove(pick);
                    stock.insert(key, defs.rules.items.stock);
                }
            }
            self.state.items.shelves.insert(id, Shelf { month, restock, stock });
        }
        // 只有人在港口亲眼见到的货架才记入图鉴；远程查询不会泄漏未见藏品。
        for fleet in self.state.fleets.values() {
            if let Some(shelf) = fleet.docked_at().and_then(|loc| self.state.items.shelves.get(&loc)) {
                self.state.items.owners.entry(fleet.owner).or_default().seen.extend(shelf.stock.keys().cloned());
            }
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct TradePlan {
    pub owner: OwnerId,
    pub loc: LocId,
    pub item: String,
    pub qty: i64,
    pub total: i64,
    pub buy: bool,
}

pub(crate) fn check_trade(
    world: &World,
    owner: OwnerId,
    loc: LocId,
    key: &str,
    qty: i64,
    limit: Option<i64>,
    buy: bool,
) -> Result<TradePlan, CommandError> {
    let def = item(world, key)?;
    if qty <= 0 {
        return Err(CommandError::InvalidQuantity);
    }
    if !world.effective_shop(loc) {
        return Err(CommandError::Precondition("这里没有道具店".into()));
    }
    if !world.at_item_shop(owner, loc) {
        return Err(CommandError::WrongLocation);
    }
    if def.protected() {
        return Err(CommandError::Precondition("关键物品不能买卖或送出".into()));
    }
    let price = if buy { world.item_buy_price(owner, loc, key) } else { world.item_sell_price(key) }.unwrap_or(0);
    let total = price.checked_mul(qty).ok_or(CommandError::InvalidQuantity)?;
    if let Some(limit) = limit
        && ((buy && total > limit) || (!buy && total < limit))
    {
        return Err(CommandError::PriceLimit { total, limit });
    }
    let available = if buy {
        world.item_shelf(loc).and_then(|s| s.stock.get(key)).copied().unwrap_or(0)
    } else {
        world.item_available(owner, key)
    };
    if available < qty {
        return Err(CommandError::InsufficientStock { available });
    }
    let cash = world.agent(owner)?.cash;
    if buy && total > cash {
        return Err(CommandError::InsufficientCash { need: total, have: cash });
    }
    if buy {
        world.item_quantity(owner, key).checked_add(qty).ok_or(CommandError::InvalidQuantity)?;
    } else {
        cash.checked_add(total).ok_or(CommandError::InvalidQuantity)?;
    }
    Ok(TradePlan { owner, loc, item: key.into(), qty, total, buy })
}

pub(crate) fn trade(world: &mut World, p: TradePlan) -> Result<(), CoreError> {
    let entry = JournalEntry::new(world.state.day, Memo::Other, CashClass::Operating);
    let entry = if p.buy {
        entry.dr(Account::OtherExpense, p.total).cr(Account::Cash, p.total)
    } else {
        entry.dr(Account::Cash, p.total).cr(Account::OtherIncome, p.total)
    };
    if p.total > 0 {
        world.book_external(p.owner, Flow::Other, world.town_sector(p.loc), entry)?;
    }
    if p.buy {
        if let Some(s) = world.state.items.shelves.get_mut(&p.loc).and_then(|s| s.stock.get_mut(&p.item)) {
            *s -= p.qty;
        }
        // 校验阶段已检查所有者、定义、数量与溢出。
        world.grant_item(p.owner, &p.item, p.qty).map_err(|e| CoreError::Internal(e.to_string()))?;
    } else {
        world.take_item(p.owner, &p.item, p.qty);
    }
    Ok(())
}
