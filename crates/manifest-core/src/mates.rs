//! 航海士：航海、交易、战斗、管理四项能力，等级、薪水、忠诚；
//! 可任命为舰长、会计、交易员、商队头领、产业管理人，各有加成。
//!
//! 加成（能力取值 1–100）：
//! - 舰长：航速 +航海/1000（至多 +10%）；海战火力与白刃战 ×(1 + 战斗/200)
//! - 会计：船员与工人工资 −管理/1000（至多 −10%）
//! - 交易员：交易税 −交易/1000（至多 −10%）；议价折扣 +交易/2000（至多 +5%）
//! - 商队头领：遭劫风险 ×(1 − 战斗/200)（至少保留一半）；行进速度 +航海/1000
//! - 产业管理人：产业效率 +管理/500（至多 +20%）
//!
//! 在港口酒馆招募；每月末发薪，欠薪降低忠诚，忠诚过低会离开。

use crate::captain::{AttrHook, LegacyRole, RoleDef, RoleScope};
use crate::circulation::Sector;
use crate::error::{CommandError, CoreError};
use crate::fixed::{Fx, Money};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::treasury::Flow;
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 算学奇才才掌握的行情预测方法（`docs/ECONOMY.md` 4.3）：递减权重均价（简单指数平滑）、最小二乘直线、
/// 双重平滑（Holt）、渐缓的涨势（阻尼趋势）、回归术（均值回归 AR(1)），以及第八批 E3 加入的周期推算（AR(2)）
/// 与四季平滑（Holt–Winters，只用于月线）。方法在界面实现；内核只记下哪位航海士会，
/// 玩家麾下有会的航海士时界面才开放这些方法。行商的老法子人人会，不在这里。只允许在末尾追加。
pub const GENIUS_METHODS: [&str; 7] = ["ses", "linear", "holt", "damped", "ar1", "ar2", "hw"];

/// 任命。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MateRole {
    None,
    Captain(FleetId),
    Accountant,
    Trader,
    CaravanLeader(CaravanId),
    IndustryManager(IndustryId),
    /// 世界定义的岗位，编号按 captain.roles 的顺序；只在枚举末尾追加。
    Assigned {
        role: u16,
        target: RoleTarget,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum RoleTarget {
    Owner,
    Fleet(FleetId),
    Caravan(CaravanId),
    Industry(IndustryId),
}
impl RoleTarget {
    pub fn scope(self) -> RoleScope {
        match self {
            Self::Owner => RoleScope::Owner,
            Self::Fleet(_) => RoleScope::Fleet,
            Self::Caravan(_) => RoleScope::Caravan,
            Self::Industry(_) => RoleScope::Industry,
        }
    }
    pub fn id(self) -> Option<u32> {
        match self {
            Self::Owner => None,
            Self::Fleet(f) => Some(f.0),
            Self::Caravan(c) => Some(c.0),
            Self::Industry(i) => Some(i.0),
        }
    }
}

/// 航海士的动态状态。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MateState {
    /// 雇主；None 表示在酒馆等待招募
    pub owner: Option<OwnerId>,
    /// 等待招募时所在的港口
    pub at: LocId,
    pub level: i64,
    pub xp: i64,
    pub navigation: i64,
    pub trade: i64,
    pub combat: i64,
    pub management: i64,
    /// 月薪
    pub salary: Money,
    pub loyalty: i64,
    pub role: MateRole,
    /// 受雇的日期（主角跟算学奇才学方法用；在酒馆等待时与旧存档为 None）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hired_on: Option<u32>,
}

/// 按静态定义创建全部航海士（都在各自的酒馆等待招募）。
pub fn init_mates(defs: &crate::defs::StaticData) -> BTreeMap<MateId, MateState> {
    defs.mate_ids().map(|id| (id, fresh_state(defs, id))).collect()
}

/// 一位航海士的初始状态（在自己的酒馆等待招募）。
pub fn fresh_state(defs: &crate::defs::StaticData, id: MateId) -> MateState {
    let d = defs.mate(id);
    MateState {
        owner: None,
        at: d.home,
        level: d.level,
        xp: 0,
        navigation: d.navigation,
        trade: d.trade,
        combat: d.combat,
        management: d.management,
        salary: d.salary,
        loyalty: d.loyalty,
        role: MateRole::None,
        hired_on: None,
    }
}

/// 航海士命令的预检结果。
pub(crate) enum MatePlan {
    Hire { mate: MateId, cost: Money },
    Dismiss { mate: MateId },
    Assign { mate: MateId, role: MateRole },
}

impl World {
    fn mate_with_role(&self, owner: OwnerId, role: MateRole) -> Option<&MateState> {
        self.state.mates.values().find(|m| m.owner == Some(owner) && m.role == role)
    }

    /// 额外能力由静态初值与等级成长推导，旧四能力仍读取原来的存档字段。
    pub fn mate_ability(&self, id: MateId, key: &str) -> i64 {
        let Some(m) = self.state.mates.get(&id) else { return 0 };
        let value = match key {
            "navigation" => m.navigation,
            "trade" => m.trade,
            "combat" => m.combat,
            "management" => m.management,
            _ => self
                .defs
                .mates
                .get(id.idx())
                .and_then(|d| {
                    d.abilities.get(key).map(|base| {
                        base.saturating_add(
                            m.level.saturating_sub(d.level).max(0).saturating_mul(self.defs.rules.mates.level_gain),
                        )
                    })
                })
                .unwrap_or(0),
        };
        value.clamp(0, 100)
    }
    fn role_binding(&self, role: MateRole) -> Option<(&RoleDef, RoleTarget)> {
        let (legacy, target) = match role {
            MateRole::None => return None,
            MateRole::Captain(f) => (LegacyRole::Captain, RoleTarget::Fleet(f)),
            MateRole::Accountant => (LegacyRole::Accountant, RoleTarget::Owner),
            MateRole::Trader => (LegacyRole::Trader, RoleTarget::Owner),
            MateRole::CaravanLeader(c) => (LegacyRole::CaravanLeader, RoleTarget::Caravan(c)),
            MateRole::IndustryManager(i) => (LegacyRole::IndustryManager, RoleTarget::Industry(i)),
            MateRole::Assigned { role, target } => {
                return self
                    .defs
                    .captain
                    .roles
                    .get(role as usize)
                    .filter(|r| r.scope == target.scope())
                    .map(|r| (r, target));
            }
        };
        self.defs.captain.roles.iter().find(|r| r.legacy == Some(legacy)).map(|r| (r, target))
    }
    fn owns_role_target(&self, owner: OwnerId, target: RoleTarget) -> bool {
        match target {
            RoleTarget::Owner => self.state.agents.contains_key(&owner),
            RoleTarget::Fleet(f) => self.state.fleets.get(&f).is_some_and(|x| x.owner == owner),
            RoleTarget::Caravan(c) => self.state.caravans.get(&c).is_some_and(|x| x.owner == owner),
            RoleTarget::Industry(i) => self.state.industries.get(&i).is_some_and(|x| x.owner == owner),
        }
    }
    /// 同一目标的在岗航海士按各岗位钩子计算，取最高值。
    pub fn role_hook(&self, owner: OwnerId, hook: AttrHook, target: RoleTarget) -> i64 {
        self.state
            .mates
            .iter()
            .filter(|(_, m)| m.owner == Some(owner))
            .filter_map(|(id, m)| {
                let (role, at) = self.role_binding(m.role)?;
                if at != target || !self.owns_role_target(owner, at) {
                    return None;
                }
                role.hooks
                    .iter()
                    .filter(|h| h.effect.hook == hook)
                    .map(|h| h.effect.value(self.mate_ability(*id, &h.ability)))
                    .max()
                    .map(|base| {
                        let wearer = &self.defs.mate(*id).key;
                        base.saturating_add(self.equipment_attribute_hook(owner, wearer, hook))
                            .saturating_add(self.item_hook(owner, wearer, hook, &Default::default()))
                    })
            })
            .max()
            .unwrap_or(0)
            .min(self.defs.rules.attributes.cap(hook))
    }
    /// 岗位与主角取较高者；主角的舰队效果只作用于旗舰。
    pub fn staffed_hook(&self, owner: OwnerId, hook: AttrHook, target: RoleTarget) -> i64 {
        if !self.owns_role_target(owner, target) {
            return 0;
        }
        let captain = if matches!(target,RoleTarget::Fleet(f) if self.flagship(owner)!=Some(f)) {
            0
        } else {
            self.attr_hook(owner, hook)
        };
        captain.max(self.role_hook(owner, hook, target))
    }

    /// 某所有者麾下的算学奇才掌握的方法（按 [`GENIUS_METHODS`] 的顺序，去重）。
    pub fn genius_methods(&self, owner: OwnerId) -> Vec<&'static str> {
        let known: Vec<&String> = self
            .state
            .mates
            .iter()
            .filter(|(_, m)| m.owner == Some(owner))
            .flat_map(|(id, _)| self.defs.mates.get(id.idx()).map(|d| d.methods.iter()).into_iter().flatten())
            .collect();
        GENIUS_METHODS.into_iter().filter(|g| known.iter().any(|k| k.as_str() == *g)).collect()
    }

    /// 舰长。
    pub fn captain_of(&self, fleet: FleetId) -> Option<&MateState> {
        let owner = self.state.fleets.get(&fleet)?.owner;
        self.mate_with_role(owner, MateRole::Captain(fleet))
    }

    /// 航速：当前舰队岗位与旗舰主角取较高者。
    pub fn fleet_speed_bonus(&self, fleet: FleetId) -> Fx {
        self.state.fleets.get(&fleet).map_or(Fx::ZERO, |f| {
            let base = self.staffed_hook(f.owner, AttrHook::FlagshipSpeed, RoleTarget::Fleet(fleet));
            let spell = self.arcana_bonus(fleet, "fleet_speed") * 100;
            Fx((if spell == 0 { base } else { base.saturating_add(spell).min(crate::arcana::MAX_PCT * 100) })
                - self.lineage_fleet_penalty(fleet) * 100)
        })
    }
    pub fn fleet_combat_mult(&self, fleet: FleetId) -> Fx {
        Fx::ONE
            + self
                .state
                .fleets
                .get(&fleet)
                .map_or(Fx::ZERO, |f| Fx(self.staffed_hook(f.owner, AttrHook::NavalCombat, RoleTarget::Fleet(fleet))))
    }
    pub fn trade_tax_discount(&self, owner: OwnerId) -> Fx {
        Fx(self.staffed_hook(owner, AttrHook::TaxDiscount, RoleTarget::Owner))
    }
    pub fn wage_discount(&self, owner: OwnerId) -> Fx {
        Fx(self.staffed_hook(owner, AttrHook::WageDiscount, RoleTarget::Owner))
    }
    pub fn caravan_risk_mult(&self, caravan: CaravanId) -> Fx {
        self.state.caravans.get(&caravan).map_or(Fx::ONE, |c| {
            Fx::ONE - Fx(self.staffed_hook(c.owner, AttrHook::CaravanRisk, RoleTarget::Caravan(caravan)))
        })
    }
    pub fn caravan_speed_bonus(&self, caravan: CaravanId) -> Fx {
        self.state
            .caravans
            .get(&caravan)
            .map_or(Fx::ZERO, |c| Fx(self.staffed_hook(c.owner, AttrHook::CaravanSpeed, RoleTarget::Caravan(caravan))))
    }
    pub fn industry_mate_bonus(&self, industry: IndustryId) -> Fx {
        self.state.industries.get(&industry).map_or(Fx::ZERO, |i| {
            Fx(self.staffed_hook(i.owner, AttrHook::IndustryEfficiency, RoleTarget::Industry(industry)))
        })
    }
    /// 保持旧存档的 trade_bonus 字段含义：只缓存岗位部分。
    pub(crate) fn refresh_trade_bonus(&mut self) {
        let bonuses: BTreeMap<OwnerId, Fx> = self
            .state
            .agents
            .keys()
            .map(|o| (*o, Fx(self.role_hook(*o, AttrHook::BargainDiscount, RoleTarget::Owner))))
            .collect();
        for a in self.state.agents.values_mut() {
            a.trade_bonus = bonuses.get(&a.owner).copied().unwrap_or(Fx::ZERO);
        }
    }

    /// 每日：任命对象已不存在时撤销任命；在岗者得经验并可能升级。
    pub(crate) fn mates_day(&mut self) {
        let rules = self.defs.rules.mates.clone();
        let fleets: Vec<FleetId> = self.state.fleets.keys().copied().collect();
        let caravans: Vec<CaravanId> = self.state.caravans.keys().copied().collect();
        let industries: Vec<IndustryId> = self.state.industries.keys().copied().collect();
        let owner_of_fleet: BTreeMap<FleetId, OwnerId> = self.state.fleets.values().map(|f| (f.id, f.owner)).collect();
        let valid_assigned: std::collections::BTreeSet<MateId> = self
            .state
            .mates
            .iter()
            .filter_map(|(id, m)| {
                let owner = m.owner?;
                let (_, target) = self.role_binding(m.role)?;
                self.owns_role_target(owner, target).then_some(*id)
            })
            .collect();
        for (id, m) in self.state.mates.iter_mut() {
            let Some(owner) = m.owner else { continue };
            let valid = match m.role {
                MateRole::None | MateRole::Accountant | MateRole::Trader => true,
                MateRole::Captain(f) => fleets.contains(&f) && owner_of_fleet.get(&f) == Some(&owner),
                MateRole::CaravanLeader(c) => caravans.contains(&c),
                MateRole::IndustryManager(i) => industries.contains(&i),
                MateRole::Assigned { .. } => valid_assigned.contains(id),
            };
            if !valid {
                m.role = MateRole::None;
            }
            if m.role == MateRole::None {
                continue;
            }
            m.xp += 1;
            if m.level < rules.max_level && m.xp >= m.level * rules.xp_per_level {
                m.xp = 0;
                m.level += 1;
                for a in [&mut m.navigation, &mut m.trade, &mut m.combat, &mut m.management] {
                    *a = (*a + rules.level_gain).min(100);
                }
                m.salary = (Fx::ONE + rules.salary_growth).apply(m.salary);
                m.loyalty = (m.loyalty + 5).min(100);
            }
        }
        self.refresh_trade_bonus();
    }

    /// 月末：发薪；欠薪降低忠诚，忠诚过低者离开并回到原先的酒馆。
    pub(crate) fn mates_month_end(&mut self) -> Result<(), CoreError> {
        let day = self.state.day;
        let rules = self.defs.rules.mates.clone();
        let mut salaries: BTreeMap<OwnerId, Money> = BTreeMap::new();
        // 货币流通：薪水花在航海士所在的地方（舰队、商队、产业所在；没有职务时是雇主的本据港）
        let mut places: BTreeMap<OwnerId, Vec<(Sector, Money)>> = BTreeMap::new();
        for m in self.state.mates.values() {
            if let Some(o) = m.owner {
                *salaries.entry(o).or_insert(0) += m.salary;
                let at = match m.role {
                    MateRole::Captain(f) | MateRole::Assigned { target: RoleTarget::Fleet(f), .. } => {
                        self.fleet_town(f)
                    }
                    MateRole::CaravanLeader(c) | MateRole::Assigned { target: RoleTarget::Caravan(c), .. } => {
                        self.caravan_town(c)
                    }
                    MateRole::IndustryManager(i) | MateRole::Assigned { target: RoleTarget::Industry(i), .. } => {
                        self.industry_town(i)
                    }
                    _ => self.state.agents.get(&o).map(|a| self.town_sector(a.home)).unwrap_or(Sector::Hinterland),
                };
                places.entry(o).or_default().push((at, m.salary));
            }
        }
        for (owner, amount) in &salaries {
            if *amount > 0 {
                self.book_spread(
                    *owner,
                    Flow::Wages,
                    places.get(owner).map(|v| v.as_slice()).unwrap_or(&[]),
                    JournalEntry::new(day, Memo::Wages, CashClass::Operating)
                        .dr(Account::Wages, *amount)
                        .cr(Account::Cash, *amount),
                )?;
            }
        }
        let cash: BTreeMap<OwnerId, Money> = self.state.agents.values().map(|a| (a.owner, a.cash)).collect();
        let homes: BTreeMap<MateId, LocId> = self.defs.mate_ids().map(|id| (id, self.defs.mate(id).home)).collect();
        for (id, m) in self.state.mates.iter_mut() {
            let Some(o) = m.owner else { continue };
            if cash.get(&o).copied().unwrap_or(0) < 0 {
                m.loyalty -= rules.loyalty_unpaid;
            } else {
                m.loyalty = (m.loyalty + rules.loyalty_paid).min(100);
            }
            if m.loyalty < rules.leave_below {
                m.owner = None;
                m.role = MateRole::None;
                m.at = homes.get(id).copied().unwrap_or(m.at);
                m.loyalty = rules.leave_below + 20;
            }
        }
        self.refresh_trade_bonus();
        Ok(())
    }
}

pub(crate) fn check_hire(world: &World, owner: OwnerId, mate: MateId) -> Result<MatePlan, CommandError> {
    let m = world.state.mates.get(&mate).ok_or_else(|| CommandError::NotFound(format!("{mate:?}")))?;
    if m.owner.is_some() {
        return Err(crate::error::Reason::new("mates.hired", "这位航海士已被雇用").rule());
    }
    if world.defs.mates.get(mate.idx()).is_some_and(|d| d.hidden) {
        return Err(crate::error::Reason::new("mates.hidden", "酒馆里没有这位航海士").rule());
    }
    let present = world.fleets_of(owner).any(|f| f.docked_at() == Some(m.at))
        || world.caravans_of(owner).any(|c| c.at() == Some(m.at));
    if !present {
        return Err(crate::error::Reason::new("mates.presence", "须有舰队或商队在其所在港口").rule());
    }
    let fame_need = world.defs.rules.discovery.mate_fame(m.level);
    let fame = world.agent(owner).map(|a| a.fame).unwrap_or(0);
    if fame < fame_need {
        return Err(crate::error::Reason::new(
            "mates.fame",
            format!("名声不足：招募这位航海士需要名声 {fame_need}（现有 {fame}）"),
        )
        .arg("need", crate::text::TextArg::Int(fame_need))
        .arg("have", crate::text::TextArg::Int(fame))
        .rule());
    }
    // 主角的口才让招募费便宜一些
    let cost = (Fx::ONE - Fx(world.staffed_hook(owner, AttrHook::RecruitDiscount, RoleTarget::Owner)))
        .apply(world.defs.mate(mate).hire_cost)
        .max(0);
    if world.agent(owner).map_err(|e| CommandError::NotFound(e.to_string()))?.cash < cost {
        return Err(CommandError::InsufficientCash {
            need: cost,
            have: world.agent(owner).map(|a| a.cash).unwrap_or(0),
        });
    }
    Ok(MatePlan::Hire { mate, cost })
}

pub(crate) fn check_dismiss(world: &World, owner: OwnerId, mate: MateId) -> Result<MatePlan, CommandError> {
    let m = world.state.mates.get(&mate).ok_or_else(|| CommandError::NotFound(format!("{mate:?}")))?;
    if m.owner != Some(owner) {
        return Err(CommandError::NotOwner);
    }
    Ok(MatePlan::Dismiss { mate })
}

pub(crate) fn check_assign(
    world: &World,
    owner: OwnerId,
    mate: MateId,
    role: MateRole,
) -> Result<MatePlan, CommandError> {
    let m = world.state.mates.get(&mate).ok_or_else(|| CommandError::NotFound(format!("{mate:?}")))?;
    if m.owner != Some(owner) {
        return Err(CommandError::NotOwner);
    }
    let ok = role == MateRole::None
        || world.role_binding(role).is_some_and(|(_, target)| world.owns_role_target(owner, target));
    if !ok {
        return Err(CommandError::NotOwner);
    }
    // 新写法引用经典岗位时仍存为经典任职，保留各模块的既有语义。
    let role = match world.role_binding(role).and_then(|(r, t)| r.legacy.map(|l| (l, t))) {
        Some((LegacyRole::Captain, RoleTarget::Fleet(f))) => MateRole::Captain(f),
        Some((LegacyRole::Accountant, RoleTarget::Owner)) => MateRole::Accountant,
        Some((LegacyRole::Trader, RoleTarget::Owner)) => MateRole::Trader,
        Some((LegacyRole::CaravanLeader, RoleTarget::Caravan(c))) => MateRole::CaravanLeader(c),
        Some((LegacyRole::IndustryManager, RoleTarget::Industry(i))) => MateRole::IndustryManager(i),
        _ => role,
    };
    Ok(MatePlan::Assign { mate, role })
}

pub(crate) fn exec(world: &mut World, owner: OwnerId, plan: MatePlan) -> Result<(), CoreError> {
    let day = world.state.day;
    match plan {
        MatePlan::Hire { mate, cost } => {
            if cost > 0 {
                let at = world.state.mates.get(&mate).map(|m| world.town_sector(m.at)).unwrap_or(Sector::Hinterland);
                world.book_external(
                    owner,
                    Flow::CrewHire,
                    at,
                    JournalEntry::new(day, Memo::CrewHire, CashClass::Operating)
                        .dr(Account::Fees, cost)
                        .cr(Account::Cash, cost),
                )?;
            }
            if let Some(m) = world.state.mates.get_mut(&mate) {
                m.owner = Some(owner);
                m.role = MateRole::None;
                m.hired_on = Some(day);
            }
        }
        MatePlan::Dismiss { mate } => {
            let home = world.defs.mate(mate).home;
            if let Some(m) = world.state.mates.get_mut(&mate) {
                m.owner = None;
                m.role = MateRole::None;
                m.at = home;
                m.hired_on = None;
            }
        }
        MatePlan::Assign { mate, role } => {
            let slot = world.role_binding(role).map(|(r, t)| (r.key.clone(), t));
            let displaced: std::collections::BTreeSet<MateId> = world
                .state
                .mates
                .iter()
                .filter_map(|(id, m)| {
                    (*id != mate
                        && m.owner == Some(owner)
                        && slot.is_some()
                        && world.role_binding(m.role).map(|(r, t)| (r.key.clone(), t)) == slot)
                        .then_some(*id)
                })
                .collect();
            // 同一职位只能有一人：旧任职与新 Assigned 写法共享同一岗位。
            if role != MateRole::None {
                for (id, m) in world.state.mates.iter_mut() {
                    if displaced.contains(id) {
                        m.role = MateRole::None;
                    }
                }
            }
            if let Some(m) = world.state.mates.get_mut(&mate) {
                m.role = role;
            }
        }
    }
    world.refresh_trade_bonus();
    Ok(())
}
