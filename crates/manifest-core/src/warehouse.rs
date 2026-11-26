//! 仓库与货物持有者。
//!
//! 货物可以放在舰队、商队或仓库中，统一用 [`Holder`] 表示。仓库按所有者与地点区分：
//! 租用容量按日付租金，购买容量计为资产；超出容量的存货按日收滞仓费。

use crate::circulation::Sector;
use crate::error::{CommandError, CoreError};
use crate::fixed::{Money, mul_div};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::treasury::Flow;
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 货物持有者。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Holder {
    Fleet(FleetId),
    Caravan(CaravanId),
    /// 所有者在某地的仓库
    Warehouse(LocId),
}

/// 仓库。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Warehouse {
    /// 租用容量
    pub rented: i64,
    /// 自有容量
    pub owned: i64,
    pub stock: BTreeMap<GoodId, i64>,
}

impl Warehouse {
    pub fn used(&self) -> i64 {
        self.stock.values().sum()
    }
}

impl World {
    pub fn warehouse(&self, owner: OwnerId, loc: LocId) -> Option<&Warehouse> {
        self.state.locations.get(loc.idx())?.warehouses.get(&owner)
    }

    /// 仓库总容量（含同盟港商馆的免费容量与殖民地的仓储容量）。
    pub fn warehouse_capacity(&self, owner: OwnerId, loc: LocId) -> i64 {
        let base =
            self.warehouse(owner, loc).map(|w| w.rented + w.owned).unwrap_or(0) + self.colony_storage(owner, loc);
        // 同盟港的免费容量与商馆的免费仓位（T01）不相加，取更多的一个
        base + self.free_storage(owner, loc)
    }

    /// 持有者所在地点（舰队须在港、商队须在城）。
    pub fn holder_location(&self, owner: OwnerId, holder: Holder) -> Result<LocId, CommandError> {
        match holder {
            Holder::Fleet(id) => {
                let f = self.fleet(id)?;
                if f.owner != owner {
                    return Err(CommandError::NotOwner);
                }
                f.docked_at().ok_or(CommandError::NotDocked)
            }
            Holder::Caravan(id) => {
                let c = self.caravan(id)?;
                if c.owner != owner {
                    return Err(CommandError::NotOwner);
                }
                c.at().ok_or(CommandError::NotDocked)
            }
            Holder::Warehouse(loc) => {
                if self.state.locations.get(loc.idx()).is_none() {
                    return Err(CommandError::NotFound(format!("{loc:?}")));
                }
                Ok(loc)
            }
        }
    }

    /// 持有者中某商品的数量。
    pub fn holder_qty(&self, owner: OwnerId, holder: Holder, good: GoodId) -> i64 {
        match holder {
            Holder::Fleet(id) => self.fleet(id).ok().and_then(|f| f.cargo.get(&good).copied()).unwrap_or(0),
            Holder::Caravan(id) => self.caravan(id).ok().and_then(|c| c.cargo.get(&good).copied()).unwrap_or(0),
            Holder::Warehouse(loc) => self.warehouse(owner, loc).and_then(|w| w.stock.get(&good).copied()).unwrap_or(0),
        }
    }

    /// 持有者剩余可用空间（仓库超出容量时为 0）。
    pub fn holder_free(&self, owner: OwnerId, holder: Holder) -> i64 {
        match holder {
            Holder::Fleet(id) => self.fleet(id).map(|f| f.free_capacity()).unwrap_or(0),
            Holder::Caravan(id) => self.caravan(id).map(|c| c.free_capacity(&self.defs)).unwrap_or(0),
            Holder::Warehouse(loc) => {
                let used = self.warehouse(owner, loc).map(|w| w.used()).unwrap_or(0);
                (self.warehouse_capacity(owner, loc) - used).max(0)
            }
        }
    }

    /// 放入货物（不检查容量；调用方负责）。
    pub(crate) fn holder_add(
        &mut self,
        owner: OwnerId,
        holder: Holder,
        good: GoodId,
        qty: i64,
    ) -> Result<(), CoreError> {
        if qty <= 0 {
            return Ok(());
        }
        let slot = match holder {
            Holder::Fleet(id) => &mut self.fleet_mut(id)?.cargo,
            Holder::Caravan(id) => &mut self.caravan_mut(id)?.cargo,
            Holder::Warehouse(loc) => {
                let ls = self
                    .state
                    .locations
                    .get_mut(loc.idx())
                    .ok_or_else(|| CoreError::Internal(format!("地点 {loc:?} 不存在")))?;
                &mut ls.warehouses.entry(owner).or_default().stock
            }
        };
        *slot.entry(good).or_insert(0) += qty;
        Ok(())
    }

    /// 取出货物，返回实际取出的数量。
    pub(crate) fn holder_take(
        &mut self,
        owner: OwnerId,
        holder: Holder,
        good: GoodId,
        qty: i64,
    ) -> Result<i64, CoreError> {
        let slot = match holder {
            Holder::Fleet(id) => &mut self.fleet_mut(id)?.cargo,
            Holder::Caravan(id) => &mut self.caravan_mut(id)?.cargo,
            Holder::Warehouse(loc) => {
                let ls = self
                    .state
                    .locations
                    .get_mut(loc.idx())
                    .ok_or_else(|| CoreError::Internal(format!("地点 {loc:?} 不存在")))?;
                match ls.warehouses.get_mut(&owner) {
                    Some(w) => &mut w.stock,
                    None => return Ok(0),
                }
            }
        };
        let have = slot.get(&good).copied().unwrap_or(0);
        let q = qty.clamp(0, have);
        if have - q == 0 {
            slot.remove(&good);
        } else {
            slot.insert(good, have - q);
        }
        Ok(q)
    }

    /// 取出货物并按平均成本记为损失。
    pub(crate) fn holder_lose(
        &mut self,
        owner: OwnerId,
        holder: Holder,
        good: GoodId,
        qty: i64,
    ) -> Result<i64, CoreError> {
        let q = self.holder_take(owner, holder, good, qty)?;
        if q > 0 {
            let day = self.state.day;
            let cost = self.agent_mut(owner)?.book.remove(good, q);
            self.book_internal(
                owner,
                JournalEntry::new(day, Memo::CargoLoss, CashClass::Operating)
                    .dr(Account::Losses, cost)
                    .cr(Account::Inventory, cost),
            )?;
        }
        Ok(q)
    }

    /// 账本日结的一部分：仓库租金与滞仓费。
    pub(crate) fn warehouse_day_end(&mut self) -> Result<(), CoreError> {
        let rules = self.defs.rules.warehouse.clone();
        let day = self.state.day;
        // 殖民地的仓储容量免租金，也计入滞仓费的容量
        let colony_cap: BTreeMap<(OwnerId, LocId), i64> =
            self.state.colonies.values().map(|c| ((c.owner, c.loc), self.colony_capacity(c))).collect();
        let mut charges: BTreeMap<OwnerId, (Money, Money)> = BTreeMap::new();
        // 货币流通：仓租与滞仓费进仓库所在城镇的钱袋
        let mut places: BTreeMap<OwnerId, Vec<(Sector, Money)>> = BTreeMap::new();
        for (li, ls) in self.state.locations.iter().enumerate() {
            for (owner, w) in &ls.warehouses {
                let rent = mul_div(w.rented, rules.rent_per_100, 100);
                let cap = w.rented
                    + w.owned
                    + self.free_storage(*owner, LocId::from_idx(li))
                    + colony_cap.get(&(*owner, LocId::from_idx(li))).copied().unwrap_or(0);
                let over = (w.used() - cap).max(0);
                let demurrage = mul_div(over, rules.demurrage_per_100, 100);
                let e = charges.entry(*owner).or_insert((0, 0));
                e.0 += rent;
                e.1 += demurrage;
                places.entry(*owner).or_default().push((Sector::Town(LocId::from_idx(li)), rent + demurrage));
            }
        }
        for (owner, (rent, demurrage)) in charges {
            let total = rent + demurrage;
            if total > 0 {
                self.book_spread(
                    owner,
                    Flow::Rent,
                    places.get(&owner).map(|v| v.as_slice()).unwrap_or(&[]),
                    JournalEntry::new(day, Memo::Rent, CashClass::Operating)
                        .dr(Account::Fees, total)
                        .cr(Account::Cash, total),
                )?;
            }
        }
        Ok(())
    }
}

/// 仓库命令的校验结果。
pub(crate) enum WarehousePlan {
    Rent { loc: LocId, capacity: i64 },
    Buy { loc: LocId, add: i64, cost: Money },
}

pub(crate) fn check_rent(
    world: &World,
    owner: OwnerId,
    loc: LocId,
    capacity: i64,
) -> Result<WarehousePlan, CommandError> {
    if world.state.locations.get(loc.idx()).is_none() {
        return Err(CommandError::NotFound(format!("{loc:?}")));
    }
    if !(0..=100_000).contains(&capacity) {
        return Err(CommandError::InvalidQuantity);
    }
    let w = world.warehouse(owner, loc);
    let used = w.map(|w| w.used()).unwrap_or(0);
    let owned = w.map(|w| w.owned).unwrap_or(0);
    if capacity < w.map(|w| w.rented).unwrap_or(0) && used > capacity + owned {
        return Err(crate::error::Reason::new("warehouse.shrink", "缩减租用容量前需先搬空多余存货").rule());
    }
    Ok(WarehousePlan::Rent { loc, capacity })
}

pub(crate) fn check_buy(world: &World, owner: OwnerId, loc: LocId, add: i64) -> Result<WarehousePlan, CommandError> {
    if world.state.locations.get(loc.idx()).is_none() {
        return Err(CommandError::NotFound(format!("{loc:?}")));
    }
    if !(1..=100_000).contains(&add) {
        return Err(CommandError::InvalidQuantity);
    }
    let cost = add * world.defs.rules.warehouse.price_per_unit;
    let have = world.agent(owner)?.cash;
    if have < cost {
        return Err(CommandError::InsufficientCash { need: cost, have });
    }
    Ok(WarehousePlan::Buy { loc, add, cost })
}

pub(crate) fn exec(world: &mut World, owner: OwnerId, plan: WarehousePlan) -> Result<(), CommandError> {
    let day = world.state.day;
    match plan {
        WarehousePlan::Rent { loc, capacity } => {
            world.state.locations[loc.idx()].warehouses.entry(owner).or_default().rented = capacity;
        }
        WarehousePlan::Buy { loc, add, cost } => {
            world.book_external(
                owner,
                Flow::Rent,
                world.town_sector(loc),
                JournalEntry::new(day, Memo::Warehouse, CashClass::Investing)
                    .dr(Account::Property, cost)
                    .cr(Account::Cash, cost),
            )?;
            world.state.locations[loc.idx()].warehouses.entry(owner).or_default().owned += add;
        }
    }
    Ok(())
}
