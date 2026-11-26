//! 殖民地：在殖民点建立殖民地，经营人口、士气、粮食、建筑、生产加工、税收与防御；
//! 海盗袭击与疫病；各势力争夺殖民点；破产清算时出售。
//!
//! - 殖民地的库存就是所有者在该地点的仓库（`Holder::Warehouse(loc)`），容量 = 基础容量 + 仓棚，免租金；
//!   舰队与仓库之间直接用 `Transfer` 命令装卸，库存与存货簿的不变量因此不变。
//! - 每日（tick 第 2 步，产业之后）：工程完工；各建筑按 等级 × 工人充足率 × 肥力或资源丰度 × 士气系数 生产。
//! - 每日（第 5 步之后）：海盗袭击。
//! - 每季度末（第 6 步）：各势力按概率占领一处无主的殖民点，被占领的殖民点不能再建立殖民地。
//!   殖民竞赛有节奏限制（开局保护期、随年代放开的占领上限、只占领本国港口附近的殖民点、
//!   概率随已占数量递减、两次占领之间的冷却），组合事件的“占领殖民点”效果遵守同样的限制。
//! - 组合事件可以改变殖民地的产量系数与增长系数（持续）、士气（一次性），见 [`crate::composed`]。
//! - 每日（第 8 步）：按人口消耗粮食，断粮则人口与士气下降。
//! - 月末（第 8 步）：消费品与士气、人口增长与移民、疫病、税收、维护费。
//!
//! 资金：建立费、建筑费记 借 产业 / 贷 现金（投资活动）；维护费记费用；税收记收入；
//! 均为与外部的往来，记入 `Flow::Colony`。消耗的建材按存货成本转入产业，消耗的粮食与消费品按成本记为费用。

use crate::calendar::DAYS_PER_MONTH;
use crate::circulation::Sector;
use crate::defs::{BuildingKind, ColonyBuildingDef, EffectKind, SiteDef, StaticData};
use crate::error::{CommandError, CoreError, Reason};
use crate::fixed::{Fx, Money, mul_div};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::rng::{Domain, Rng};
use crate::text::TextArg;
use crate::treasury::Flow;
use crate::warehouse::Holder;
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 殖民点的归属。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Claim {
    /// 被某势力占领（不能再建立殖民地）
    Faction(FactionId),
    /// 已建成的殖民地
    Colony(ColonyId),
}

/// 失去殖民地的原因。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LossReason {
    /// 所有者放弃
    Abandoned,
    /// 人口耗尽
    Depopulated,
    /// 破产清算时出售
    Sold,
}

/// 进行中的工程（同一时间只有一个）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Construction {
    pub building: ColonyBuildingId,
    /// 完工后的等级
    pub level: u8,
    pub start_day: u32,
    /// 该日结算时完工
    pub done_day: u32,
}

/// 殖民地的统计（本月累计与上月结果）。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColonyStats {
    /// 本月产出
    pub produced: BTreeMap<GoodId, i64>,
    /// 上月产出
    pub last_produced: BTreeMap<GoodId, i64>,
    /// 本月消耗的粮食
    pub food_eaten: i64,
    pub last_food_eaten: i64,
    /// 本月死亡（断粮、袭击、疫病）
    pub deaths: i64,
    pub last_deaths: i64,
    /// 上月出生与移民
    pub last_births: i64,
    pub last_immigrants: i64,
    /// 上月税收与维护费
    pub last_tax: Money,
    pub last_upkeep: Money,
    /// 上月消费品满足度（万分之一）
    pub last_satisfaction: i64,
    /// 累计遭袭次数
    pub raids: u32,
}

/// 殖民地。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Colony {
    pub id: ColonyId,
    /// 所在殖民点
    pub loc: LocId,
    pub owner: OwnerId,
    pub name: String,
    /// 建立的日期（天）
    pub founded: u32,
    pub population: i64,
    /// 士气 0–100
    pub morale: i64,
    /// 各建筑的等级
    pub buildings: BTreeMap<ColonyBuildingId, u8>,
    pub construction: Option<Construction>,
    /// 连续断粮的天数
    pub starving_days: u32,
    /// 最近一次遭袭的日期
    pub last_raid: Option<u32>,
    /// 税率档位（`rules.colony.tax_levels` 的下标）
    pub tax: u8,
    /// 账面价值：建立费 + 建筑费 + 消耗的建材成本
    pub book_value: Money,
    /// 产量的小数部分（万分之一件），逐日累计
    #[serde(default)]
    pub carry: BTreeMap<GoodId, i64>,
    #[serde(default)]
    pub stats: ColonyStats,
}

impl Colony {
    pub fn level(&self, building: ColonyBuildingId) -> u8 {
        self.buildings.get(&building).copied().unwrap_or(0)
    }

    /// 全部建筑的等级之和。
    pub fn total_levels(&self) -> i64 {
        self.buildings.values().map(|l| *l as i64).sum()
    }
}

/// 有产出的建筑（粮食、采集、加工）。
pub fn is_productive(defs: &StaticData, b: ColonyBuildingId) -> bool {
    defs.colony_buildings
        .get(b.idx())
        .is_some_and(|d| matches!(d.kind, BuildingKind::Food | BuildingKind::Extract | BuildingKind::Process))
}

/// 粮食类建筑的产出：goods 中第一种当地有资源的商品，没有则取第一种；产量系数为肥力（%）。
pub fn food_output(b: &ColonyBuildingDef, site: &SiteDef) -> Option<(GoodId, i64)> {
    let g = b.goods.iter().find(|g| site.resources.iter().any(|(r, _)| r == *g)).or(b.goods.first())?;
    Some((*g, site.fertility))
}

/// 采集类建筑的产出：goods 与当地资源的交集中丰度最高的一种（并列取 goods 中靠前者）；系数为丰度（%）。
pub fn extract_output(b: &ColonyBuildingDef, site: &SiteDef) -> Option<(GoodId, i64)> {
    let mut best: Option<(GoodId, i64)> = None;
    for g in &b.goods {
        if let Some((_, rich)) = site.resources.iter().find(|(r, _)| r == g)
            && best.is_none_or(|(_, r)| *rich > r)
        {
            best = Some((*g, *rich));
        }
    }
    best
}

/// 粮食 / 采集类建筑在该地的产出商品与系数（%）；不能产出时为 None。
pub fn raw_output(b: &ColonyBuildingDef, site: &SiteDef) -> Option<(GoodId, i64)> {
    match b.kind {
        BuildingKind::Food => food_output(b, site),
        BuildingKind::Extract => extract_output(b, site),
        _ => None,
    }
}

/// 每日粮食需求：ceil(人口 × 每百人需求 / 100)。
pub fn food_need(defs: &StaticData, population: i64) -> i64 {
    let per = defs.rules.colony.food_per_100.max(0);
    (population.max(0) * per + 99) / 100
}

/// 殖民地名称：去掉首尾空白后 1–16 个字，不含控制字符。
pub fn valid_name(name: &str) -> Option<String> {
    let n = name.trim();
    let len = n.chars().count();
    if len == 0 || len > 16 || n.chars().any(|c| c.is_control()) {
        return None;
    }
    Some(n.to_string())
}

/// 一座建筑一天的预计产出（件，万分之一精度）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutputEstimate {
    pub building: ColonyBuildingId,
    /// 投入（每日）
    pub inputs: Vec<(GoodId, i64)>,
    /// 产出（每日，万分之一件）
    pub outputs: Vec<(GoodId, Fx)>,
}

impl World {
    pub fn colony(&self, id: ColonyId) -> Option<&Colony> {
        self.state.colonies.get(&id)
    }

    pub fn colonies_of(&self, owner: OwnerId) -> impl Iterator<Item = &Colony> {
        self.state.colonies.values().filter(move |c| c.owner == owner)
    }

    /// 某地点的殖民地。
    pub fn colony_at(&self, loc: LocId) -> Option<&Colony> {
        self.state.colonies.values().find(|c| c.loc == loc)
    }

    /// 殖民点的归属。
    pub fn claim_of(&self, loc: LocId) -> Option<crate::colony::Claim> {
        self.state.locations.get(loc.idx()).and_then(|l| l.claim)
    }

    fn building_sum(&self, c: &Colony, kind: BuildingKind, f: impl Fn(&ColonyBuildingDef) -> i64) -> i64 {
        c.buildings
            .iter()
            .filter_map(|(b, lvl)| self.defs.colony_buildings.get(b.idx()).map(|d| (d, *lvl as i64)))
            .filter(|(d, _)| d.kind == kind)
            .map(|(d, lvl)| f(d) * lvl)
            .sum()
    }

    /// 仓储容量。
    pub fn colony_capacity(&self, c: &Colony) -> i64 {
        self.defs.rules.colony.base_capacity + self.building_sum(c, BuildingKind::Storage, |d| d.capacity)
    }

    /// 人口上限。
    pub fn colony_housing(&self, c: &Colony) -> i64 {
        self.defs.rules.colony.base_housing + self.building_sum(c, BuildingKind::Housing, |d| d.housing)
    }

    /// 防御值（百分比，有上限）。
    pub fn colony_defense(&self, c: &Colony) -> i64 {
        self.building_sum(c, BuildingKind::Defense, |d| d.defense).clamp(0, self.defs.rules.colony.max_defense_pct)
    }

    /// 是否有码头（可补给、修船）。
    pub fn colony_has_dock(&self, owner: OwnerId, loc: LocId) -> bool {
        self.colony_at(loc)
            .filter(|c| c.owner == owner)
            .is_some_and(|c| self.building_sum(c, BuildingKind::Dock, |_| 1) > 0)
    }

    /// 所有者在某地的殖民地提供的仓储容量（没有殖民地为 0）。
    pub fn colony_storage(&self, owner: OwnerId, loc: LocId) -> i64 {
        self.colony_at(loc).filter(|c| c.owner == owner).map(|c| self.colony_capacity(c)).unwrap_or(0)
    }

    /// 全部建筑需要的工人数。
    pub fn colony_workers_needed(&self, c: &Colony) -> i64 {
        c.buildings
            .iter()
            .filter_map(|(b, lvl)| self.defs.colony_buildings.get(b.idx()).map(|d| d.workers * *lvl as i64))
            .sum()
    }

    /// 工人充足率（0–1）。
    pub fn colony_staffing(&self, c: &Colony) -> Fx {
        let need = self.colony_workers_needed(c);
        if need <= 0 { Fx::ONE } else { Fx::ratio(c.population.max(0), need).min(Fx::ONE) }
    }

    /// 士气系数：50% + 士气%（士气 50 为 1.0）。
    pub fn colony_morale_mult(c: &Colony) -> Fx {
        Fx::from_pct(50 + c.morale.clamp(0, 100))
    }

    /// 每日袭击概率（万分之一）。
    pub fn colony_raid_bp(&self, c: &Colony) -> i64 {
        let defs = &self.defs;
        let Some(site) = defs.loc(c.loc).site.as_ref() else { return 0 };
        let Some(region) = defs.map.region_of(defs.loc(c.loc).cell) else { return 0 };
        let pirate = self.pirate_mult(region).apply(defs.region(region).seasons[self.season().index()].pirate_bp);
        let base = defs.rules.colony.raid_scale.apply(mul_div(pirate, site.hazard, 50));
        mul_div(base, 100 - self.colony_defense(c), 100)
    }

    /// 进行中的组合事件对殖民地的系数（同类多条相乘）；只看殖民地建立之后开始的条目。
    fn colony_event_mult(&self, c: &Colony, effect: EffectKind, building: Option<ColonyBuildingId>) -> Fx {
        self.state
            .events
            .active
            .iter()
            .filter(|e| e.effect == Some(effect) && e.params.loc == Some(c.loc) && e.start >= c.founded)
            .filter(|e| e.params.building.is_none() || e.params.building == building)
            .filter_map(|e| e.params.mult)
            .fold(Fx::ONE, |a, m| a.mul(m))
    }

    /// 事件造成的建筑产量系数（组合事件“殖民地产量”）。
    pub fn colony_output_mult(&self, c: &Colony, building: ColonyBuildingId) -> Fx {
        self.colony_event_mult(c, EffectKind::ColonyOutput, Some(building))
    }

    /// 事件造成的人口增长与移民系数（组合事件“殖民地增长”）。
    pub fn colony_growth_mult(&self, c: &Colony) -> Fx {
        self.colony_event_mult(c, EffectKind::ColonyGrowth, None)
    }

    /// 一次性改变某殖民点上殖民地的士气（组合事件“殖民地士气”）；没有殖民地时不做任何事。
    pub(crate) fn shift_colony_morale(&mut self, loc: LocId, delta: i64) {
        if let Some(c) = self.state.colonies.values_mut().find(|c| c.loc == loc) {
            c.morale = (c.morale + delta).clamp(0, 100);
        }
    }

    /// 某势力占领的殖民点数。
    pub fn faction_claims(&self, f: FactionId) -> usize {
        self.state.locations.iter().filter(|l| l.claim == Some(Claim::Faction(f))).count()
    }

    /// 某势力最近一次占领殖民点的日期。
    pub fn faction_last_claim(&self, f: FactionId) -> Option<u32> {
        self.state.locations.iter().filter(|l| l.claim == Some(Claim::Faction(f))).filter_map(|l| l.claimed_on).max()
    }

    /// 势力占领殖民点（殖民竞赛与组合事件共用；调用前须已通过 [`claim_blocker`]）。
    pub(crate) fn claim_site(&mut self, f: FactionId, loc: LocId) {
        let day = self.state.day;
        if let Some(ls) = self.state.locations.get_mut(loc.idx()) {
            ls.claim = Some(Claim::Faction(f));
            ls.claimed_on = Some(day);
        }
        self.push_log(LogEvent { day, kind: LogKind::SiteClaimed { loc, faction: f } });
    }

    /// 仓库中的粮食总量。
    pub fn colony_food_stock(&self, c: &Colony) -> i64 {
        self.defs.food_goods().map(|g| self.holder_qty(c.owner, Holder::Warehouse(c.loc), g)).sum()
    }

    /// 各建筑每天的预计产出（按当前人口与士气）。
    pub fn colony_estimates(&self, c: &Colony) -> Vec<OutputEstimate> {
        let defs = &self.defs;
        let Some(site) = defs.loc(c.loc).site.as_ref() else { return Vec::new() };
        let scale = self.colony_staffing(c).mul(World::colony_morale_mult(c));
        let mut out = Vec::new();
        for (b, lvl) in &c.buildings {
            let Some(d) = defs.colony_buildings.get(b.idx()) else { continue };
            let lvl = *lvl as i64;
            let scale = scale.mul(self.colony_output_mult(c, *b));
            match d.kind {
                BuildingKind::Food | BuildingKind::Extract => {
                    if let Some((g, pct)) = raw_output(d, site) {
                        let amount = Fx::ratio(d.output * lvl * pct, 100).mul(scale);
                        out.push(OutputEstimate { building: *b, inputs: Vec::new(), outputs: vec![(g, amount)] });
                    }
                }
                BuildingKind::Process => {
                    let s = Fx::from_int(lvl).mul(scale);
                    out.push(OutputEstimate {
                        building: *b,
                        inputs: d.inputs.iter().map(|(g, q)| (*g, process_qty(s, *q))).collect(),
                        outputs: d.outputs.iter().map(|(g, q)| (*g, Fx::from_int(process_qty(s, *q)))).collect(),
                    });
                }
                _ => {}
            }
        }
        out
    }

    /// 仓库剩余空间。
    fn colony_free(&self, c: &Colony) -> i64 {
        let used = self.warehouse(c.owner, c.loc).map(|w| w.used()).unwrap_or(0);
        (self.warehouse_capacity(c.owner, c.loc) - used).max(0)
    }

    /// tick 第 2 步（产业之后）：工程完工与生产。
    pub(crate) fn colony_production(&mut self) -> Result<(), CoreError> {
        let defs = self.defs.clone();
        let day = self.state.day;
        let ids: Vec<ColonyId> = self.state.colonies.keys().copied().collect();
        for id in ids {
            // 工程完工
            let done = self.state.colonies.get(&id).and_then(|c| c.construction.clone()).filter(|k| k.done_day <= day);
            if let Some(k) = done {
                let Some(c) = self.state.colonies.get_mut(&id) else { continue };
                c.buildings.insert(k.building, k.level);
                c.construction = None;
                let (owner, loc) = (c.owner, c.loc);
                self.push_log(LogEvent {
                    day,
                    kind: LogKind::ColonyBuilt { colony: id, owner, loc, building: k.building, level: k.level },
                });
            }
            let Some(c) = self.state.colonies.get(&id).cloned() else { continue };
            if c.population <= 0 {
                continue;
            }
            let Some(site) = defs.loc(c.loc).site.clone() else { continue };
            let holder = Holder::Warehouse(c.loc);
            let scale = self.colony_staffing(&c).mul(World::colony_morale_mult(&c));
            for (b, lvl) in &c.buildings {
                let Some(d) = defs.colony_buildings.get(b.idx()) else { continue };
                let lvl = *lvl as i64;
                let scale = scale.mul(self.colony_output_mult(&c, *b));
                match d.kind {
                    BuildingKind::Food | BuildingKind::Extract => {
                        let Some((g, pct)) = raw_output(d, &site) else { continue };
                        let amount = Fx::ratio(d.output * lvl * pct, 100).mul(scale);
                        let qty = {
                            let Some(col) = self.state.colonies.get_mut(&id) else { continue };
                            let carry = col.carry.entry(g).or_insert(0);
                            let total = *carry + amount.raw();
                            *carry = total % Fx::SCALE;
                            total / Fx::SCALE
                        };
                        let free = self.colony_free(&c);
                        let q = qty.min(free);
                        if q > 0 {
                            self.holder_add(c.owner, holder, g, q)?;
                            self.agent_mut(c.owner)?.book.add(g, q, 0);
                            if let Some(col) = self.state.colonies.get_mut(&id) {
                                *col.stats.produced.entry(g).or_insert(0) += q;
                            }
                        }
                    }
                    BuildingKind::Process => {
                        let s = Fx::from_int(lvl).mul(scale);
                        if s <= Fx::ZERO {
                            continue;
                        }
                        let inputs: Vec<(GoodId, i64)> =
                            d.inputs.iter().map(|(g, q)| (*g, process_qty(s, *q))).collect();
                        let outputs: Vec<(GoodId, i64)> =
                            d.outputs.iter().map(|(g, q)| (*g, process_qty(s, *q))).collect();
                        let enough = inputs.iter().all(|(g, q)| self.holder_qty(c.owner, holder, *g) >= *q);
                        let net: i64 =
                            outputs.iter().map(|x| x.1).sum::<i64>() - inputs.iter().map(|x| x.1).sum::<i64>();
                        if !enough || net > self.colony_free(&c) {
                            continue;
                        }
                        let mut input_cost: Money = 0;
                        for (g, q) in &inputs {
                            self.holder_take(c.owner, holder, *g, *q)?;
                            input_cost += self.agent_mut(c.owner)?.book.remove(*g, *q);
                        }
                        let total_value: Money =
                            outputs.iter().map(|(g, q)| defs.good(*g).base_price * q).sum::<Money>().max(1);
                        let mut assigned: Money = 0;
                        for (i, (g, q)) in outputs.iter().enumerate() {
                            let cost = if i + 1 == outputs.len() {
                                input_cost - assigned
                            } else {
                                mul_div(input_cost, defs.good(*g).base_price * q, total_value)
                            };
                            assigned += cost;
                            self.holder_add(c.owner, holder, *g, *q)?;
                            self.agent_mut(c.owner)?.book.add(*g, *q, cost);
                            if let Some(col) = self.state.colonies.get_mut(&id) {
                                *col.stats.produced.entry(*g).or_insert(0) += q;
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        Ok(())
    }

    /// 第 5 步之后：海盗袭击殖民地。
    pub(crate) fn colony_raids(&mut self) -> Result<(), CoreError> {
        let rules = self.defs.rules.colony.clone();
        let day = self.state.day;
        let seed = self.state.seed;
        let ids: Vec<ColonyId> = self.state.colonies.keys().copied().collect();
        for id in ids {
            let Some(c) = self.state.colonies.get(&id).cloned() else { continue };
            if c.last_raid.is_some_and(|d| day < d + rules.raid_cooldown_days) {
                continue;
            }
            let mut rng = Rng::derive(seed, day, Domain::Colony, id.0 as u64, 1);
            if !rng.chance_bp(self.colony_raid_bp(&c)) {
                continue;
            }
            let eff = 100 - self.colony_defense(&c);
            let loss_pct = mul_div(rng.range(rules.raid_loss_pct.0, rules.raid_loss_pct.1), eff, 100);
            let death_pct = mul_div(rng.range(rules.raid_death_pct.0, rules.raid_death_pct.1), eff, 100);
            let holder = Holder::Warehouse(c.loc);
            let stock: Vec<(GoodId, i64)> = self
                .warehouse(c.owner, c.loc)
                .map(|w| w.stock.iter().map(|(g, q)| (*g, *q)).collect())
                .unwrap_or_default();
            let mut lost = 0;
            for (g, q) in stock {
                let n = mul_div(q, loss_pct, 100).min(q);
                if n > 0 {
                    lost += self.holder_lose(c.owner, holder, g, n)?;
                }
            }
            let deaths = mul_div(c.population, death_pct, 100).clamp(0, c.population);
            if let Some(col) = self.state.colonies.get_mut(&id) {
                col.population -= deaths;
                col.last_raid = Some(day);
                col.stats.raids += 1;
                col.stats.deaths += deaths;
            }
            self.push_log(LogEvent {
                day,
                kind: LogKind::ColonyRaided { colony: id, owner: c.owner, loc: c.loc, cargo_lost: lost, deaths },
            });
            if c.population - deaths <= 0 {
                self.lose_colony(id, LossReason::Depopulated)?;
            }
        }
        Ok(())
    }

    /// 第 6 步：每季度末，各势力按概率占领一处无主的殖民点。
    ///
    /// 节奏限制见 [`claim_blocker`]；概率 = 基础概率 × 100 / (100 + 已占数量 × claim_decay_pct)，
    /// 在本国港口附近、可以占领的殖民点中等概率挑一处。
    pub(crate) fn colony_claims(&mut self) {
        let day = self.state.day;
        if !self.defs.calendar.season_end(day) {
            return;
        }
        let defs = self.defs.clone();
        let rules = &defs.rules.colony;
        if day < rules.claim_start_day {
            return;
        }
        let seed = self.state.seed;
        for f in defs.faction_ids() {
            let held = self.faction_claims(f);
            if held >= faction_claim_cap(self, f) || self.claim_cooling(f) {
                continue;
            }
            let mut rng = Rng::derive(seed, day, Domain::Claims, f.0 as u64, 0);
            let chance = mul_div(rules.claim_chance_bp, 100, 100 + held as i64 * rules.claim_decay_pct.max(0));
            if !rng.chance_bp(chance) {
                continue;
            }
            let free: Vec<LocId> = defs.site_ids().filter(|l| claim_blocker(self, f, *l).is_none()).collect();
            if free.is_empty() {
                continue;
            }
            let loc = free[rng.below(free.len() as u64) as usize];
            // 货币流通：占领要从国库花钱，付不起就不占（ECONOMY.md 6.9）
            if !self.pay_claim(f) {
                continue;
            }
            self.claim_site(f, loc);
        }
    }

    /// 势力是否仍在两次占领之间的冷却期内。
    fn claim_cooling(&self, f: FactionId) -> bool {
        let cooldown = self.defs.rules.colony.claim_cooldown_days;
        cooldown > 0 && self.faction_last_claim(f).is_some_and(|d| self.state.day < d + cooldown)
    }

    /// 第 8 步：按人口消耗粮食；断粮时人口与士气下降。
    pub(crate) fn colony_consumption(&mut self) -> Result<(), CoreError> {
        let defs = self.defs.clone();
        let rules = &defs.rules.colony;
        let day = self.state.day;
        let food: Vec<GoodId> = defs.food_goods().collect();
        let ids: Vec<ColonyId> = self.state.colonies.keys().copied().collect();
        for id in ids {
            let Some(c) = self.state.colonies.get(&id).cloned() else { continue };
            let holder = Holder::Warehouse(c.loc);
            let need = food_need(&defs, c.population);
            let mut eaten = 0;
            let mut cost: Money = 0;
            for g in &food {
                if eaten >= need {
                    break;
                }
                let q = self.holder_take(c.owner, holder, *g, need - eaten)?;
                if q > 0 {
                    eaten += q;
                    cost += self.agent_mut(c.owner)?.book.remove(*g, q);
                }
            }
            if cost > 0 {
                self.book_internal(
                    c.owner,
                    JournalEntry::new(day, Memo::Colony, CashClass::Operating)
                        .dr(Account::Supplies, cost)
                        .cr(Account::Inventory, cost),
                )?;
            }
            let Some(col) = self.state.colonies.get_mut(&id) else { continue };
            col.stats.food_eaten += eaten;
            if eaten >= need {
                col.starving_days = 0;
                continue;
            }
            col.starving_days += 1;
            let deaths = mul_div(col.population, rules.starve_loss_bp, 10_000).max(1).min(col.population);
            col.population -= deaths;
            col.morale = (col.morale - 1).max(0);
            col.stats.deaths += deaths;
            let (starving, pop) = (col.starving_days, col.population);
            if starving == 1 || starving.is_multiple_of(DAYS_PER_MONTH) {
                self.push_log(LogEvent {
                    day,
                    kind: LogKind::ColonyStarving { colony: id, owner: c.owner, loc: c.loc, deaths },
                });
            }
            if pop <= 0 {
                self.lose_colony(id, LossReason::Depopulated)?;
            }
        }
        Ok(())
    }

    /// 月末：消费品与士气、人口增长与移民、疫病、税收、维护费。
    pub(crate) fn colony_month_end(&mut self) -> Result<(), CoreError> {
        let defs = self.defs.clone();
        let rules = &defs.rules.colony;
        let day = self.state.day;
        let seed = self.state.seed;
        let ids: Vec<ColonyId> = self.state.colonies.keys().copied().collect();
        for id in ids {
            let Some(c) = self.state.colonies.get(&id).cloned() else { continue };
            let holder = Holder::Warehouse(c.loc);
            // ── 消费品 ──
            let mut need_total = 0;
            let mut taken_total = 0;
            let mut cost: Money = 0;
            for (g, per_100) in &rules.morale_goods {
                let need = (c.population.max(0) * per_100 + 99) / 100;
                let q = self.holder_take(c.owner, holder, *g, need)?;
                need_total += need;
                taken_total += q;
                if q > 0 {
                    cost += self.agent_mut(c.owner)?.book.remove(*g, q);
                }
            }
            if cost > 0 {
                self.book_internal(
                    c.owner,
                    JournalEntry::new(day, Memo::Colony, CashClass::Operating)
                        .dr(Account::Supplies, cost)
                        .cr(Account::Inventory, cost),
                )?;
            }
            let satisfaction = if need_total > 0 { Fx::ratio(taken_total, need_total) } else { Fx::ZERO };
            // ── 士气 ──
            let (tax_pct, tax_morale) = rules.tax_levels.get(c.tax as usize).copied().unwrap_or((100, 0));
            let mut target = rules.morale_base
                + self.building_sum(&c, BuildingKind::Morale, |d| d.morale)
                + satisfaction.apply(rules.morale_goods_bonus)
                + tax_morale;
            if c.starving_days > 0 {
                target -= rules.starve_morale;
            }
            if c.last_raid.is_some_and(|d| d + DAYS_PER_MONTH > day) {
                target -= rules.raid_morale;
            }
            let target = target.clamp(0, 100);
            let diff = target - c.morale;
            let step = if diff == 0 { 0 } else { (diff / 3).abs().max(1) * diff.signum() };
            let morale = (c.morale + step).clamp(0, 100);
            // ── 人口 ──
            let mut pop = c.population;
            let (mut births, mut immigrants) = (0, 0);
            if c.starving_days == 0 && morale >= 50 && pop > 0 {
                let room = (self.colony_housing(&c) - pop).max(0);
                births = mul_div(pop, rules.growth_bp, 10_000).max(1).min(room);
                let fame = self.state.agents.get(&c.owner).map(|a| a.fame).unwrap_or(0);
                let fame_part = if defs.rules.discovery.fame_per_immigrant > 0 {
                    fame.max(0) / defs.rules.discovery.fame_per_immigrant
                } else {
                    0
                };
                let morale_part =
                    mul_div((morale - 50) / 10 * rules.immigration_per_morale, 100 + 10 * c.total_levels(), 100);
                // 组合事件的增长系数同时作用于自然增长与移民
                let growth = self.colony_growth_mult(&c);
                births = growth.apply(births).min(room);
                immigrants = growth.apply(morale_part + fame_part).clamp(0, room - births);
                pop += births + immigrants;
            }
            // ── 疫病 ──
            let mut deaths = 0;
            let hazard = defs.loc(c.loc).site.as_ref().map(|s| s.hazard).unwrap_or(0);
            let mut rng = Rng::derive(seed, day, Domain::Colony, id.0 as u64, 2);
            if pop > 0 && rng.chance_bp(hazard * rules.disease_bp_per_hazard) {
                let pct = rng.range(rules.disease_death_pct.0, rules.disease_death_pct.1);
                deaths = mul_div(pop, pct, 100).max(1).min(pop);
                pop -= deaths;
                self.push_log(LogEvent {
                    day,
                    kind: LogKind::ColonyEpidemic { colony: id, owner: c.owner, loc: c.loc, deaths },
                });
            }
            // ── 税收与维护费 ──
            let tax = mul_div(pop * rules.tax_per_100, tax_pct, 10_000).max(0);
            if tax > 0 {
                self.book_external(
                    c.owner,
                    Flow::Colony,
                    Sector::Hinterland,
                    JournalEntry::new(day, Memo::Colony, CashClass::Operating)
                        .dr(Account::Cash, tax)
                        .cr(Account::OtherIncome, tax),
                )?;
            }
            let upkeep: Money = c
                .buildings
                .iter()
                .filter_map(|(b, lvl)| defs.colony_buildings.get(b.idx()).map(|d| d.upkeep * *lvl as i64))
                .sum();
            if upkeep > 0 {
                self.book_external(
                    c.owner,
                    Flow::Colony,
                    Sector::Hinterland,
                    JournalEntry::new(day, Memo::Colony, CashClass::Operating)
                        .dr(Account::OtherExpense, upkeep)
                        .cr(Account::Cash, upkeep),
                )?;
            }
            let Some(col) = self.state.colonies.get_mut(&id) else { continue };
            col.morale = morale;
            col.population = pop;
            let s = &mut col.stats;
            s.last_produced = std::mem::take(&mut s.produced);
            s.last_food_eaten = std::mem::take(&mut s.food_eaten);
            s.last_deaths = std::mem::take(&mut s.deaths) + deaths;
            s.last_births = births;
            s.last_immigrants = immigrants;
            s.last_tax = tax;
            s.last_upkeep = upkeep;
            s.last_satisfaction = satisfaction.raw();
            if pop <= 0 {
                self.lose_colony(id, LossReason::Depopulated)?;
            }
        }
        Ok(())
    }

    /// 失去殖民地（放弃或人口耗尽）：仓库存货与账面价值全部核销，殖民点恢复无主。
    pub(crate) fn lose_colony(&mut self, id: ColonyId, reason: LossReason) -> Result<(), CoreError> {
        let day = self.state.day;
        let Some(c) = self.state.colonies.get(&id).cloned() else { return Ok(()) };
        let holder = Holder::Warehouse(c.loc);
        let stock: Vec<(GoodId, i64)> =
            self.warehouse(c.owner, c.loc).map(|w| w.stock.iter().map(|(g, q)| (*g, *q)).collect()).unwrap_or_default();
        for (g, q) in stock {
            self.holder_lose(c.owner, holder, g, q)?;
        }
        if c.book_value != 0 {
            self.book_internal(
                c.owner,
                JournalEntry::new(day, Memo::Colony, CashClass::Investing)
                    .dr(Account::Losses, c.book_value)
                    .cr(Account::Property, c.book_value),
            )?;
        }
        self.remove_colony(id, reason);
        Ok(())
    }

    fn remove_colony(&mut self, id: ColonyId, reason: LossReason) {
        let day = self.state.day;
        let Some(c) = self.state.colonies.remove(&id) else { return };
        if let Some(ls) = self.state.locations.get_mut(c.loc.idx())
            && ls.claim == Some(Claim::Colony(id))
        {
            ls.claim = None;
        }
        self.push_log(LogEvent { day, kind: LogKind::ColonyLost { colony: id, owner: c.owner, loc: c.loc, reason } });
    }

    /// 破产清算：殖民地按账面价值的一半出售（仓库存货已由调用方处理）。
    pub(crate) fn sell_colonies(&mut self, owner: OwnerId) -> Result<(), CoreError> {
        let day = self.state.day;
        let ids: Vec<ColonyId> = self.colonies_of(owner).map(|c| c.id).collect();
        for id in ids {
            let Some(book) = self.state.colonies.get(&id).map(|c| c.book_value) else { continue };
            let proceeds = book / 2;
            self.book_external(
                owner,
                Flow::Colony,
                Sector::Hinterland,
                JournalEntry::new(day, Memo::Liquidation, CashClass::Investing)
                    .dr(Account::Cash, proceeds)
                    .dr(Account::Losses, book - proceeds)
                    .cr(Account::Property, book),
            )?;
            self.remove_colony(id, LossReason::Sold);
        }
        Ok(())
    }
}

/// 加工建筑按规模折算的数量（至少 1）。
fn process_qty(scale: Fx, q: i64) -> i64 {
    if scale <= Fx::ZERO || q <= 0 { 0 } else { scale.apply(q).max(1) }
}

/// 殖民地命令的预检结果。
pub(crate) enum ColonyPlan {
    Found { fleet: FleetId, site: LocId, name: String, settlers: i64, cost: Money },
    Build { colony: ColonyId, building: ColonyBuildingId, level: u8, cost: Money },
    Tax { colony: ColonyId, rate: u8 },
    Abandon { colony: ColonyId },
}

fn own_colony(world: &World, owner: OwnerId, id: ColonyId) -> Result<&Colony, CommandError> {
    let c = world.colony(id).ok_or_else(|| CommandError::NotFound(format!("{id:?}")))?;
    if c.owner != owner {
        return Err(CommandError::NotOwner);
    }
    Ok(c)
}

fn need_cash(world: &World, owner: OwnerId, need: Money) -> Result<(), CommandError> {
    let have = world.agent(owner)?.cash;
    if have < need {
        return Err(CommandError::InsufficientCash { need, have });
    }
    Ok(())
}

/// 势力当前允许占领的殖民点数：开局 1 处，此后每满 `claim_slot_years` 年多 1 处，不超过 `max_claims_per_faction`。
pub fn faction_claim_cap(world: &World, _f: FactionId) -> usize {
    let rules = &world.defs.rules.colony;
    if rules.claim_slot_years == 0 {
        return rules.max_claims_per_faction;
    }
    let years = (world.state.day / world.defs.calendar.year_days() / rules.claim_slot_years) as usize;
    (1 + years).min(rules.max_claims_per_faction)
}

/// 殖民点是否在势力的势力范围内：离该势力某个港口的直线距离不超过 `claim_reach` 格（0 表示不限）。
pub fn faction_reaches(defs: &StaticData, f: FactionId, site: LocId) -> bool {
    let reach = defs.rules.colony.claim_reach;
    if reach <= 0 {
        return true;
    }
    let s = defs.loc(site).cell;
    defs.port_ids().filter(|l| defs.loc(*l).faction == f).any(|l| {
        let c = defs.loc(l).cell;
        defs.map.topology().squared_distance(c, s) <= reach * reach
    })
}

/// 势力能否占领某殖民点（殖民竞赛与组合事件共用）：返回不能占领的原因。
///
/// 殖民点须无主；开局保护期已过；该势力的占领数未达当前上限；离本国港口足够近；不在两次占领之间的冷却期内。
pub fn claim_blocker(world: &World, f: FactionId, site: LocId) -> Option<String> {
    let defs = &world.defs;
    let rules = &defs.rules.colony;
    let Some(l) = defs.locations.get(site.idx()) else { return Some("地点不存在".into()) };
    if !l.is_site() {
        return Some("这里不是可殖民地点".into());
    }
    if defs.factions.get(f.idx()).is_none() {
        return Some("势力不存在".into());
    }
    match world.claim_of(site) {
        Some(Claim::Faction(g)) => return Some(format!("已被{}占领", defs.faction(g).name)),
        Some(Claim::Colony(_)) => return Some("这里已有殖民地".into()),
        None => {}
    }
    if world.state.day < rules.claim_start_day {
        return Some("各国尚未开始争夺殖民点".into());
    }
    if world.faction_claims(f) >= faction_claim_cap(world, f) {
        return Some(format!("{}占领的殖民点已达目前的上限", defs.faction(f).name));
    }
    if !world.faction_reaches(f, site) {
        return Some(format!("这处殖民点离{}的港口太远", defs.faction(f).name));
    }
    if world.claim_cooling(f) {
        return Some(format!("{}近期刚占领过殖民点", defs.faction(f).name));
    }
    None
}

/// 殖民点能否建立殖民地（不看舰队）：返回不能建立的原因（中文）。
pub fn site_blocker(world: &World, owner: OwnerId, site: LocId) -> Option<String> {
    site_block(world, owner, site).map(|r| r.zh)
}

/// 同 [`site_blocker`]，返回带错误码的原因（界面按语言显示）。
pub fn site_block(world: &World, owner: OwnerId, site: LocId) -> Option<Reason> {
    let defs = &world.defs;
    let Some(l) = defs.locations.get(site.idx()) else { return Some(Reason::new("colony.no_site", "地点不存在")) };
    if !l.is_site() {
        return Some(Reason::new("colony.not_site", "这里不是可殖民地点"));
    }
    match world.claim_of(site) {
        Some(Claim::Faction(f)) => {
            return Some(
                Reason::new("colony.claimed", format!("已被{}占领", defs.faction(f).name))
                    .arg("faction", TextArg::Faction(f)),
            );
        }
        Some(Claim::Colony(_)) => return Some(Reason::new("colony.occupied", "这里已有殖民地")),
        None => {}
    }
    if owner.is_player() && !world.loc_known(site) {
        return Some(Reason::new("colony.unexplored", "尚未探明这处殖民点"));
    }
    let max = defs.rules.colony.max_colonies_per_owner;
    if world.colonies_of(owner).count() >= max {
        return Some(
            Reason::new("colony.max_colonies", format!("最多经营 {max} 个殖民地")).arg("max", TextArg::Int(max as i64)),
        );
    }
    None
}

pub(crate) fn check_found(
    world: &World,
    owner: OwnerId,
    fleet: FleetId,
    site: LocId,
    name: &str,
    settlers: i64,
) -> Result<ColonyPlan, CommandError> {
    let defs = &world.defs;
    let rules = &defs.rules.colony;
    if let Some(why) = site_block(world, owner, site) {
        return Err(why.rule());
    }
    let f = world.fleet(fleet)?;
    if f.owner != owner {
        return Err(CommandError::NotOwner);
    }
    if f.docked_at() != Some(site) {
        return Err(CommandError::WrongLocation);
    }
    if world.fleet_in_battle(fleet) {
        return Err(Reason::new("fleet.in_battle", "舰队正在交战").rule());
    }
    let name = valid_name(name).ok_or_else(|| Reason::new("colony.name_length", "殖民地名称须为 1–16 个字").range())?;
    if settlers < rules.min_settlers {
        return Err(Reason::new("colony.min_settlers", format!("至少需要 {} 名殖民者", rules.min_settlers))
            .arg("min", TextArg::Int(rules.min_settlers))
            .range());
    }
    let crew_min = f.crew_min(defs);
    if f.crew - settlers < crew_min {
        return Err(CommandError::CrewBelowMinimum { need: crew_min + settlers, have: f.crew });
    }
    for (g, q) in &rules.found_materials {
        let have = f.cargo.get(g).copied().unwrap_or(0);
        if have < *q {
            return Err(Reason::new(
                "colony.found_material",
                format!("建立殖民地需要 {} {} 件（船上只有 {have}）", defs.good(*g).name, q),
            )
            .arg("good", TextArg::Good(*g))
            .arg("qty", TextArg::Int(*q))
            .arg("have", TextArg::Int(have))
            .rule());
        }
    }
    let cost = rules.found_cost;
    need_cash(world, owner, cost)?;
    Ok(ColonyPlan::Found { fleet, site, name, settlers, cost })
}

pub(crate) fn check_build(
    world: &World,
    owner: OwnerId,
    colony: ColonyId,
    building: ColonyBuildingId,
) -> Result<ColonyPlan, CommandError> {
    let defs = &world.defs;
    let c = own_colony(world, owner, colony)?;
    let d = defs.colony_buildings.get(building.idx()).ok_or_else(|| CommandError::NotFound(format!("{building:?}")))?;
    if c.construction.is_some() {
        return Err(Reason::new("colony.busy", "已有工程在进行").rule());
    }
    let level = c.level(building);
    if level >= d.max_level {
        return Err(Reason::new("max_level", "已达最高等级").range());
    }
    if matches!(d.kind, BuildingKind::Food | BuildingKind::Extract) {
        let site = defs.loc(c.loc).site.as_ref().ok_or_else(|| CommandError::Internal("殖民地不在殖民点".into()))?;
        if raw_output(d, site).is_none() {
            return Err(Reason::new("colony.no_resource", "此地没有这种建筑可以开采的资源").rule());
        }
    }
    for (g, q) in &d.materials {
        let have = world.holder_qty(owner, Holder::Warehouse(c.loc), *g);
        if have < *q {
            return Err(Reason::new(
                "colony.build_material",
                format!("殖民地仓库需要 {} {} 件（现有 {have}）", defs.good(*g).name, q),
            )
            .arg("good", TextArg::Good(*g))
            .arg("qty", TextArg::Int(*q))
            .arg("have", TextArg::Int(have))
            .rule());
        }
    }
    need_cash(world, owner, d.cost)?;
    Ok(ColonyPlan::Build { colony, building, level: level + 1, cost: d.cost })
}

pub(crate) fn check_tax(world: &World, owner: OwnerId, colony: ColonyId, rate: u8) -> Result<ColonyPlan, CommandError> {
    own_colony(world, owner, colony)?;
    if rate as usize >= world.defs.rules.colony.tax_levels.len() {
        let max = world.defs.rules.colony.tax_levels.len().saturating_sub(1);
        return Err(Reason::new("colony.tax_range", format!("税率档位只能是 0–{max}"))
            .arg("max", TextArg::Int(max as i64))
            .range());
    }
    Ok(ColonyPlan::Tax { colony, rate })
}

pub(crate) fn check_abandon(world: &World, owner: OwnerId, colony: ColonyId) -> Result<ColonyPlan, CommandError> {
    own_colony(world, owner, colony)?;
    Ok(ColonyPlan::Abandon { colony })
}

/// 从持有者中取出建材，把其存货成本转入产业（建设消耗）。返回转入的成本。
fn consume_materials(
    world: &mut World,
    owner: OwnerId,
    holder: Holder,
    materials: &[(GoodId, i64)],
) -> Result<Money, CoreError> {
    let day = world.state.day;
    let mut cost: Money = 0;
    for (g, q) in materials {
        let taken = world.holder_take(owner, holder, *g, *q)?;
        cost += world.agent_mut(owner)?.book.remove(*g, taken);
    }
    if cost > 0 {
        world.book_internal(
            owner,
            JournalEntry::new(day, Memo::Colony, CashClass::Investing)
                .dr(Account::Property, cost)
                .cr(Account::Inventory, cost),
        )?;
    }
    Ok(cost)
}

pub(crate) fn exec(world: &mut World, owner: OwnerId, plan: ColonyPlan) -> Result<Option<ColonyId>, CoreError> {
    let day = world.state.day;
    let defs = world.defs.clone();
    let rules = &defs.rules.colony;
    match plan {
        ColonyPlan::Found { fleet, site, name, settlers, cost } => {
            if cost > 0 {
                world.book_external(
                    owner,
                    Flow::Colony,
                    Sector::Hinterland,
                    JournalEntry::new(day, Memo::Colony, CashClass::Investing)
                        .dr(Account::Property, cost)
                        .cr(Account::Cash, cost),
                )?;
            }
            // 建立物资：一部分作为建设消耗，其余卸入殖民地仓库
            let consumed: Vec<(GoodId, i64)> =
                rules.found_materials.iter().map(|(g, q)| (*g, rules.found_consume.apply(*q).clamp(0, *q))).collect();
            let used = consume_materials(world, owner, Holder::Fleet(fleet), &consumed)?;
            for ((g, q), (_, c)) in rules.found_materials.iter().zip(&consumed) {
                let moved = world.holder_take(owner, Holder::Fleet(fleet), *g, q - c)?;
                world.holder_add(owner, Holder::Warehouse(site), *g, moved)?;
            }
            world.fleet_mut(fleet)?.crew -= settlers;
            let id = ColonyId(world.state.next_colony.max(1));
            world.state.next_colony = id.0 + 1;
            world.state.colonies.insert(
                id,
                Colony {
                    id,
                    loc: site,
                    owner,
                    name,
                    founded: day,
                    population: settlers,
                    morale: rules.start_morale.clamp(0, 100),
                    buildings: BTreeMap::new(),
                    construction: None,
                    starving_days: 0,
                    last_raid: None,
                    tax: rules.default_tax.min(rules.tax_levels.len().saturating_sub(1) as u8),
                    book_value: cost + used,
                    carry: BTreeMap::new(),
                    stats: ColonyStats::default(),
                },
            );
            if let Some(ls) = world.state.locations.get_mut(site.idx()) {
                ls.claim = Some(Claim::Colony(id));
                ls.warehouses.entry(owner).or_default();
            }
            world.agent_mut(owner)?.fame += rules.found_fame;
            world.push_log(LogEvent { day, kind: LogKind::ColonyFounded { colony: id, owner, loc: site } });
            Ok(Some(id))
        }
        ColonyPlan::Build { colony, building, level, cost } => {
            let loc = world.colony(colony).map(|c| c.loc).ok_or_else(|| CoreError::Internal("殖民地消失".into()))?;
            if cost > 0 {
                world.book_external(
                    owner,
                    Flow::Colony,
                    Sector::Hinterland,
                    JournalEntry::new(day, Memo::Colony, CashClass::Investing)
                        .dr(Account::Property, cost)
                        .cr(Account::Cash, cost),
                )?;
            }
            let materials = defs.colony_building(building).materials.clone();
            let used = consume_materials(world, owner, Holder::Warehouse(loc), &materials)?;
            let days = defs.colony_building(building).build_days.max(1);
            if let Some(c) = world.state.colonies.get_mut(&colony) {
                c.book_value += cost + used;
                c.construction = Some(Construction { building, level, start_day: day, done_day: day + days });
            }
            Ok(Some(colony))
        }
        ColonyPlan::Tax { colony, rate } => {
            if let Some(c) = world.state.colonies.get_mut(&colony) {
                c.tax = rate;
            }
            Ok(Some(colony))
        }
        ColonyPlan::Abandon { colony } => {
            world.lose_colony(colony, LossReason::Abandoned)?;
            Ok(None)
        }
    }
}
