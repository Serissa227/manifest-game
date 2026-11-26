//! 产业：种植园、矿场、作坊、工场等执行配方（投入 → 产出）。
//!
//! 投入从所有者在当地的仓库扣除，不足则停工；产出进入同一仓库。产出的存货成本
//! 等于消耗投入的成本（按产出的基准价值比例分摊）；工资、维护费与管理人薪水直接计为费用。

use crate::circulation::Sector;
use crate::error::{CommandError, CoreError};
use crate::fixed::{Fx, Money, mul_div};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::treasury::Flow;
use crate::warehouse::Holder;
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 管理人。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Manager {
    None,
    /// 雇佣的 NPC 管理人
    Hired,
}

/// 产业实例。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Industry {
    pub id: IndustryId,
    pub owner: OwnerId,
    pub loc: LocId,
    pub kind: IndustryTypeId,
    pub recipe: RecipeId,
    /// 规模等级 1–5
    pub level: i64,
    pub manager: Manager,
    /// 上一日是否因缺料停工
    pub stalled: bool,
    pub book_value: Money,
}

/// 最高等级。
pub const MAX_LEVEL: i64 = 5;

impl World {
    /// 产业效率：雇佣管理人 +20%，再乘事件带来的全局效率修正。
    pub fn industry_efficiency(&self, ind: &Industry) -> Fx {
        let base = match ind.manager {
            Manager::None => Fx::ONE,
            Manager::Hired => Fx::from_pct(120),
        };
        (base + self.industry_mate_bonus(ind.id)).mul(self.industry_mult())
    }

    /// tick 第 2 步：产业生产。
    pub(crate) fn industry_production(&mut self) -> Result<(), CoreError> {
        let defs = self.defs.clone();
        let day = self.state.day;
        let ids: Vec<IndustryId> = self.state.industries.keys().copied().collect();
        for id in ids {
            let Some(ind) = self.state.industries.get(&id).cloned() else { continue };
            let recipe = defs.recipe(ind.recipe);
            let scale = Fx::from_int(ind.level).mul(self.industry_efficiency(&ind));
            let holder = Holder::Warehouse(ind.loc);
            // 投入是否充足
            let inputs: Vec<(GoodId, i64)> = recipe.inputs.iter().map(|(g, q)| (*g, scale.apply(*q).max(1))).collect();
            let enough = inputs.iter().all(|(g, q)| self.holder_qty(ind.owner, holder, *g) >= *q);
            if !enough {
                if !ind.stalled {
                    self.push_log(LogEvent { day, kind: LogKind::IndustryStalled { industry: id, owner: ind.owner } });
                }
                if let Some(i) = self.state.industries.get_mut(&id) {
                    i.stalled = true;
                }
                continue;
            }
            let mut input_cost: Money = 0;
            for (g, q) in &inputs {
                self.holder_take(ind.owner, holder, *g, *q)?;
                input_cost += self.agent_mut(ind.owner)?.book.remove(*g, *q);
            }
            let outputs: Vec<(GoodId, i64)> =
                recipe.outputs.iter().map(|(g, q)| (*g, scale.apply(*q).max(1))).collect();
            let total_value: Money = outputs.iter().map(|(g, q)| defs.good(*g).base_price * q).sum::<Money>().max(1);
            let mut assigned: Money = 0;
            for (i, (g, q)) in outputs.iter().enumerate() {
                let cost = if i + 1 == outputs.len() {
                    input_cost - assigned
                } else {
                    mul_div(input_cost, defs.good(*g).base_price * q, total_value)
                };
                assigned += cost;
                self.holder_add(ind.owner, holder, *g, *q)?;
                self.agent_mut(ind.owner)?.book.add(*g, *q, cost);
            }
            if let Some(i) = self.state.industries.get_mut(&id) {
                i.stalled = false;
            }
        }
        Ok(())
    }

    /// 账本日结的一部分：工资、维护费与管理人薪水。
    pub(crate) fn industry_day_end(&mut self) -> Result<(), CoreError> {
        let defs = self.defs.clone();
        let day = self.state.day;
        let mut costs: BTreeMap<OwnerId, Money> = BTreeMap::new();
        // 货币流通：各处产业的开销进所在城镇的钱袋
        let mut places: BTreeMap<OwnerId, Vec<(Sector, Money)>> = BTreeMap::new();
        for ind in self.state.industries.values() {
            let t = defs.industry_type(ind.kind);
            let mut c = t.workers * ind.level * t.wage + t.maintenance * ind.level;
            if ind.manager == Manager::Hired {
                c += t.manager_salary;
            }
            *costs.entry(ind.owner).or_insert(0) += c;
            places.entry(ind.owner).or_default().push((self.town_sector(ind.loc), c));
        }
        for (owner, c) in costs {
            if c > 0 {
                self.book_spread(
                    owner,
                    Flow::Industry,
                    places.get(&owner).map(|v| v.as_slice()).unwrap_or(&[]),
                    JournalEntry::new(day, Memo::Industry, CashClass::Operating)
                        .dr(Account::Wages, c)
                        .cr(Account::Cash, c),
                )?;
            }
        }
        Ok(())
    }
}

/// 产业命令的校验结果。
pub(crate) enum IndustryPlan {
    Build { loc: LocId, kind: IndustryTypeId, recipe: RecipeId, cost: Money },
    Recipe { id: IndustryId, recipe: RecipeId },
    Upgrade { id: IndustryId, cost: Money },
    Manager { id: IndustryId, manager: Manager },
    Sell { id: IndustryId, proceeds: Money },
}

fn need_cash(world: &World, owner: OwnerId, need: Money) -> Result<(), CommandError> {
    let have = world.agent(owner)?.cash;
    if have < need {
        return Err(CommandError::InsufficientCash { need, have });
    }
    Ok(())
}

fn own(world: &World, owner: OwnerId, id: IndustryId) -> Result<&Industry, CommandError> {
    let i = world.state.industries.get(&id).ok_or_else(|| CommandError::NotFound(format!("{id:?}")))?;
    if i.owner != owner {
        return Err(CommandError::NotOwner);
    }
    Ok(i)
}

/// 配方能否在该地使用：无投入的采集类配方要求产出是当地特产。
fn recipe_allowed(world: &World, loc: LocId, recipe: RecipeId) -> Result<(), CommandError> {
    let defs = &world.defs;
    let r = defs.recipe(recipe);
    if r.inputs.is_empty() {
        let ok = r.outputs.iter().all(|(g, _)| defs.loc(loc).market.iter().any(|m| m.good == *g && m.specialty));
        if !ok {
            return Err(
                crate::error::Reason::new("industry.specialty", "采集类产业只能建在产出是当地特产的地方").rule()
            );
        }
    }
    Ok(())
}

pub(crate) fn check_build(
    world: &World,
    owner: OwnerId,
    loc: LocId,
    kind: IndustryTypeId,
    recipe: RecipeId,
) -> Result<IndustryPlan, CommandError> {
    let defs = &world.defs;
    if defs.locations.get(loc.idx()).is_none()
        || defs.industry_types.get(kind.idx()).is_none()
        || defs.recipes.get(recipe.idx()).is_none()
    {
        return Err(CommandError::NotFound("地点、产业类型或配方".into()));
    }
    if defs.recipe(recipe).industry != kind {
        return Err(crate::error::Reason::new("industry.recipe", "该配方不属于这种产业").rule());
    }
    // 同盟港与有免费仓位的商馆（T01）都算有地方放货
    if world.warehouse(owner, loc).is_none()
        && world.state.locations[loc.idx()].ally != Some(owner)
        && world.house_storage(owner, loc) <= 0
    {
        return Err(crate::error::Reason::new("industry.warehouse", "需要先在当地租或买仓库").rule());
    }
    recipe_allowed(world, loc, recipe)?;
    // 产业位（T03，`[agency] industry_slots`）：港口里能经营的产业处数随商馆等级；规则关闭、内陆城市不限
    if let Some(slots) = world.industry_slots(owner, loc)
        && world.industries_at(owner, loc) >= slots
    {
        return Err(crate::error::Reason::new("industry.slots", "这里的产业位已满（商馆每升一级多一个）").rule());
    }
    let cost = defs.industry_type(kind).build_cost;
    need_cash(world, owner, cost)?;
    Ok(IndustryPlan::Build { loc, kind, recipe, cost })
}

pub(crate) fn check_recipe(
    world: &World,
    owner: OwnerId,
    id: IndustryId,
    recipe: RecipeId,
) -> Result<IndustryPlan, CommandError> {
    let i = own(world, owner, id)?;
    let r = world.defs.recipes.get(recipe.idx()).ok_or_else(|| CommandError::NotFound(format!("{recipe:?}")))?;
    if r.industry != i.kind {
        return Err(crate::error::Reason::new("industry.recipe", "该配方不属于这种产业").rule());
    }
    recipe_allowed(world, i.loc, recipe)?;
    Ok(IndustryPlan::Recipe { id, recipe })
}

pub(crate) fn check_upgrade(world: &World, owner: OwnerId, id: IndustryId) -> Result<IndustryPlan, CommandError> {
    let i = own(world, owner, id)?;
    if i.level >= MAX_LEVEL {
        return Err(crate::error::Reason::new("max_level", "已达最高等级").range());
    }
    let cost = world.defs.industry_type(i.kind).build_cost * i.level;
    need_cash(world, owner, cost)?;
    Ok(IndustryPlan::Upgrade { id, cost })
}

pub(crate) fn check_manager(
    world: &World,
    owner: OwnerId,
    id: IndustryId,
    manager: Manager,
) -> Result<IndustryPlan, CommandError> {
    own(world, owner, id)?;
    Ok(IndustryPlan::Manager { id, manager })
}

pub(crate) fn check_sell(world: &World, owner: OwnerId, id: IndustryId) -> Result<IndustryPlan, CommandError> {
    let i = own(world, owner, id)?;
    Ok(IndustryPlan::Sell { id, proceeds: i.book_value / 2 })
}

pub(crate) fn exec(world: &mut World, owner: OwnerId, plan: IndustryPlan) -> Result<Option<IndustryId>, CommandError> {
    let day = world.state.day;
    match plan {
        IndustryPlan::Build { loc, kind, recipe, cost } => {
            world.book_external(
                owner,
                Flow::Industry,
                world.town_sector(loc),
                JournalEntry::new(day, Memo::Industry, CashClass::Investing)
                    .dr(Account::Property, cost)
                    .cr(Account::Cash, cost),
            )?;
            let id = IndustryId(world.state.next_industry.max(1));
            world.state.next_industry = id.0 + 1;
            world.state.industries.insert(
                id,
                Industry {
                    id,
                    owner,
                    loc,
                    kind,
                    recipe,
                    level: 1,
                    manager: Manager::None,
                    stalled: false,
                    book_value: cost,
                },
            );
            // 确保当地有仓库记录（同盟港商馆可零租金使用）
            world.state.locations[loc.idx()].warehouses.entry(owner).or_default();
            Ok(Some(id))
        }
        IndustryPlan::Recipe { id, recipe } => {
            if let Some(i) = world.state.industries.get_mut(&id) {
                i.recipe = recipe;
            }
            Ok(Some(id))
        }
        IndustryPlan::Upgrade { id, cost } => {
            world.book_external(
                owner,
                Flow::Industry,
                world.industry_town(id),
                JournalEntry::new(day, Memo::Industry, CashClass::Investing)
                    .dr(Account::Property, cost)
                    .cr(Account::Cash, cost),
            )?;
            if let Some(i) = world.state.industries.get_mut(&id) {
                i.level += 1;
                i.book_value += cost;
            }
            Ok(Some(id))
        }
        IndustryPlan::Manager { id, manager } => {
            if let Some(i) = world.state.industries.get_mut(&id) {
                i.manager = manager;
            }
            Ok(Some(id))
        }
        IndustryPlan::Sell { id, proceeds } => {
            let book = world.state.industries.get(&id).map(|i| i.book_value).unwrap_or(0);
            let entry = JournalEntry::new(day, Memo::Industry, CashClass::Investing)
                .dr(Account::Cash, proceeds)
                .dr(Account::Losses, book - proceeds)
                .cr(Account::Property, book);
            world.book_external(owner, Flow::Industry, world.industry_town(id), entry)?;
            world.state.industries.remove(&id);
            Ok(None)
        }
    }
}
