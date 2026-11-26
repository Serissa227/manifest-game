//! 陆上商队。
//!
//! 商队由若干驮畜（或车辆）组成，沿道路图在港口与内陆城市之间移动。每进入一段道路
//! 按货物基准价值交一次关卡税；途中按道路治安与护卫比例结算劫掠风险；驮畜与护卫每日开销在账本日结时支付。

use crate::circulation::Sector;
use crate::defs::{RoadDef, RoadTerrain, StaticData};
use crate::error::{CommandError, CoreError};
use crate::fixed::{Fx, Money, mul_div};
use crate::ids::*;
use crate::ledger::{Account, CashClass, JournalEntry, Memo};
use crate::log::{LogEvent, LogKind};
use crate::rng::{Domain, Rng};
use crate::treasury::Flow;
use crate::world::World;
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::{BTreeMap, BinaryHeap};

/// 商队位置。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum CaravanLocation {
    At(LocId),
    OnRoad(Trek),
}

/// 行进中的状态：依次经过 `stops`，当前在 `stops[leg]` 与 `stops[leg + 1]` 之间。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Trek {
    pub stops: Vec<LocId>,
    pub roads: Vec<RoadId>,
    pub leg: usize,
    /// 当前路段已走的长度（格）
    pub progress: Fx,
}

/// 商队。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Caravan {
    pub id: CaravanId,
    pub owner: OwnerId,
    pub animal: AnimalId,
    pub count: i64,
    pub guards: i64,
    pub cargo: BTreeMap<GoodId, i64>,
    pub location: CaravanLocation,
    /// 驮畜账面价值
    pub book_value: Money,
}

impl Caravan {
    pub fn at(&self) -> Option<LocId> {
        match self.location {
            CaravanLocation::At(l) => Some(l),
            CaravanLocation::OnRoad(_) => None,
        }
    }

    pub fn capacity(&self, defs: &StaticData) -> i64 {
        defs.animal(self.animal).capacity * self.count
    }

    pub fn cargo_total(&self) -> i64 {
        self.cargo.values().sum()
    }

    pub fn free_capacity(&self, defs: &StaticData) -> i64 {
        (self.capacity(defs) - self.cargo_total()).max(0)
    }

    /// 每日开销：驮畜 + 护卫。
    pub fn daily_cost(&self, defs: &StaticData) -> Money {
        defs.animal(self.animal).upkeep * self.count + defs.rules.caravan.guard_wage * self.guards
    }
}

/// 商队在某条道路上的速度（格/天）。
pub fn road_speed(defs: &StaticData, animal: AnimalId, road: RoadId) -> Fx {
    let a = defs.animal(animal);
    let r = defs.road(road);
    let mut s = a.speed.mul(r.terrain.speed());
    if r.terrain == RoadTerrain::Desert {
        s = s.mul(a.desert);
    }
    s.max(Fx::from_pct(50))
}

/// 商队在某条道路上每天遭劫的概率（万分之一）。
/// 护卫与驮畜之比越高风险越低：风险乘以 (1 − 护卫/驮畜)，最多降到两成。
pub fn robbery_bp(defs: &StaticData, road: &RoadDef, count: i64, guards: i64) -> i64 {
    let exposure = Fx::ONE - road.security;
    let guard_ratio = Fx::ratio(guards, count.max(1));
    let protection = (Fx::ONE - guard_ratio).max(Fx::from_pct(20));
    exposure.mul(protection).apply(defs.rules.caravan.robbery_bp)
}

/// 在道路图上按行程时间求最短路线：返回（途经地点, 道路, 预计天数）。
pub fn find_route(
    defs: &StaticData,
    animal: AnimalId,
    from: LocId,
    to: LocId,
) -> Option<(Vec<LocId>, Vec<RoadId>, i64)> {
    let n = defs.locations.len();
    let mut dist = vec![i64::MAX; n];
    let mut prev: Vec<Option<(LocId, RoadId)>> = vec![None; n];
    let mut heap = BinaryHeap::new();
    dist[from.idx()] = 0;
    heap.push(Reverse((0i64, from.0)));
    while let Some(Reverse((d, cur))) = heap.pop() {
        let cur = LocId(cur);
        if d > dist[cur.idx()] {
            continue;
        }
        if cur == to {
            break;
        }
        for (road, next) in defs.roads_from(cur) {
            let t = defs.road(road).length.div(road_speed(defs, animal, road)).raw();
            let nd = d + t;
            if nd < dist[next.idx()] {
                dist[next.idx()] = nd;
                prev[next.idx()] = Some((cur, road));
                heap.push(Reverse((nd, next.0)));
            }
        }
    }
    if dist[to.idx()] == i64::MAX || from == to {
        return None;
    }
    let mut stops = vec![to];
    let mut roads = Vec::new();
    let mut cur = to;
    while let Some((p, r)) = prev[cur.idx()] {
        stops.push(p);
        roads.push(r);
        cur = p;
    }
    stops.reverse();
    roads.reverse();
    let days = (dist[to.idx()] + Fx::SCALE - 1) / Fx::SCALE;
    Some((stops, roads, days.max(1)))
}

impl World {
    pub fn caravan(&self, id: CaravanId) -> Result<&Caravan, CoreError> {
        self.state.caravans.get(&id).ok_or_else(|| CoreError::Internal(format!("商队 {id:?} 不存在")))
    }

    pub fn caravan_mut(&mut self, id: CaravanId) -> Result<&mut Caravan, CoreError> {
        self.state.caravans.get_mut(&id).ok_or_else(|| CoreError::Internal(format!("商队 {id:?} 不存在")))
    }

    pub fn caravans_of(&self, owner: OwnerId) -> impl Iterator<Item = &Caravan> {
        self.state.caravans.values().filter(move |c| c.owner == owner)
    }

    /// 货物按基准价计的价值（关卡税依据）。
    fn cargo_base_value(&self, cargo: &BTreeMap<GoodId, i64>) -> Money {
        cargo.iter().map(|(g, q)| self.defs.good(*g).base_price * q).sum()
    }

    /// 进入一段道路时交关卡税。
    fn pay_toll(&mut self, id: CaravanId, road: RoadId) -> Result<(), CoreError> {
        let day = self.state.day;
        let (owner, value) = {
            let c = self.caravan(id)?;
            (c.owner, self.cargo_base_value(&c.cargo))
        };
        let toll = self.defs.road(road).toll.apply(value);
        if toll > 0 {
            self.book_external(
                owner,
                Flow::Tax,
                Sector::Treasury(self.defs.road(road).faction),
                JournalEntry::new(day, Memo::Toll, CashClass::Operating)
                    .dr(Account::Taxes, toll)
                    .cr(Account::Cash, toll),
            )?;
        }
        Ok(())
    }

    /// tick 第 5 步（陆上部分）：商队移动与劫掠风险。
    pub(crate) fn move_caravans(&mut self) -> Result<(), CoreError> {
        let defs = self.defs.clone();
        let day = self.state.day;
        let seed = self.state.seed;
        let ids: Vec<CaravanId> = self.state.caravans.keys().copied().collect();
        for id in ids {
            let (animal, trek) = {
                let c = self.caravan(id)?;
                match &c.location {
                    CaravanLocation::OnRoad(t) => (c.animal, t.clone()),
                    CaravanLocation::At(_) => continue,
                }
            };
            let mut trek = trek;
            let speed_bonus = Fx::ONE + self.caravan_speed_bonus(id);
            let mut remaining = Fx::ONE;
            let mut arrived = None;
            let mut new_legs = Vec::new();
            let reveals = self.defs.manual_navigation && self.caravan(id)?.owner == OwnerId::Player;
            let mut segments = Vec::new();
            while remaining > Fx::ZERO {
                let road = trek.roads[trek.leg];
                let speed = road_speed(&defs, animal, road).mul(speed_bonus);
                let left = defs.road(road).length - trek.progress;
                let need = left.div(speed);
                if reveals {
                    let end =
                        if need <= remaining { defs.road(road).length } else { trek.progress + remaining.mul(speed) };
                    segments.push((
                        trek.stops[trek.leg],
                        trek.stops[trek.leg + 1],
                        trek.progress,
                        end,
                        defs.road(road).length,
                    ));
                }
                if need <= remaining {
                    remaining -= need;
                    trek.leg += 1;
                    trek.progress = Fx::ZERO;
                    if trek.leg >= trek.roads.len() {
                        arrived = trek.stops.last().copied();
                        break;
                    }
                    new_legs.push(trek.roads[trek.leg]);
                } else {
                    trek.progress += remaining.mul(speed);
                    remaining = Fx::ZERO;
                }
            }
            for (from, to, start, end, length) in segments {
                self.reveal_caravan_segment(from, to, start, end, length);
            }
            for road in new_legs {
                self.pay_toll(id, road)?;
            }
            let road_now = trek.roads.get(trek.leg.min(trek.roads.len().saturating_sub(1))).copied();
            {
                let c = self.caravan_mut(id)?;
                c.location = match arrived {
                    Some(l) => CaravanLocation::At(l),
                    None => CaravanLocation::OnRoad(trek),
                };
            }
            // 劫掠
            if arrived.is_none()
                && let Some(road) = road_now
            {
                let mut rng = Rng::derive(seed, day, Domain::Caravan, id.0 as u64, 0);
                let r = defs.road(road);
                let (owner, count, guards) = {
                    let c = self.caravan(id)?;
                    (c.owner, c.count, c.guards)
                };
                let bp = self.caravan_risk_mult(id).apply(robbery_bp(&defs, r, count, guards));
                if rng.chance_bp(bp) {
                    let cargo: Vec<(GoodId, i64)> = self.caravan(id)?.cargo.iter().map(|(g, q)| (*g, *q)).collect();
                    let mut lost = 0;
                    for (g, q) in cargo {
                        let pct = rng.range(10, 40);
                        lost +=
                            self.holder_lose(owner, crate::warehouse::Holder::Caravan(id), g, mul_div(q, pct, 100))?;
                    }
                    self.push_log(LogEvent { day, kind: LogKind::Robbery { caravan: id, owner, cargo_lost: lost } });
                }
            }
            if let Some(l) = arrived {
                let owner = self.caravan(id)?.owner;
                self.push_log(LogEvent { day, kind: LogKind::CaravanArrived { caravan: id, owner, loc: l } });
            }
        }
        Ok(())
    }
}

/// 商队命令的校验结果。
pub(crate) enum CaravanPlan {
    Form { at: LocId, animal: AnimalId, count: i64, cost: Money },
    Guards { id: CaravanId, delta: i64, cost: Money },
    Travel { id: CaravanId, stops: Vec<LocId>, roads: Vec<RoadId> },
    Disband { id: CaravanId, proceeds: Money },
}

fn own(world: &World, owner: OwnerId, id: CaravanId) -> Result<&Caravan, CommandError> {
    let c = world.state.caravans.get(&id).ok_or_else(|| CommandError::NotFound(format!("{id:?}")))?;
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

pub(crate) fn check_form(
    world: &World,
    owner: OwnerId,
    at: LocId,
    animal: AnimalId,
    count: i64,
) -> Result<CaravanPlan, CommandError> {
    let defs = &world.defs;
    if defs.locations.get(at.idx()).is_none() || defs.animals.get(animal.idx()).is_none() {
        return Err(CommandError::NotFound("地点或驮畜".into()));
    }
    if defs.roads_from(at).next().is_none() {
        return Err(crate::error::Reason::new("caravan.no_road", "此地不通陆路").rule());
    }
    if !(1..=200).contains(&count) {
        return Err(CommandError::InvalidQuantity);
    }
    let cost = defs.animal(animal).price * count;
    need_cash(world, owner, cost)?;
    Ok(CaravanPlan::Form { at, animal, count, cost })
}

pub(crate) fn check_guards(
    world: &World,
    owner: OwnerId,
    id: CaravanId,
    guards: i64,
) -> Result<CaravanPlan, CommandError> {
    let c = own(world, owner, id)?;
    c.at().ok_or(CommandError::NotDocked)?;
    if !(0..=c.count * 2).contains(&guards) {
        return Err(crate::error::Reason::new(
            "caravan.guards_range",
            format!("护卫人数必须在 0 到 {} 之间", c.count * 2),
        )
        .arg("max", crate::text::TextArg::Int(c.count * 2))
        .range());
    }
    let delta = guards - c.guards;
    let cost = delta.max(0) * world.defs.rules.caravan.guard_hire_cost;
    need_cash(world, owner, cost)?;
    Ok(CaravanPlan::Guards { id, delta, cost })
}

pub(crate) fn check_travel(
    world: &World,
    owner: OwnerId,
    id: CaravanId,
    dest: LocId,
) -> Result<CaravanPlan, CommandError> {
    let c = own(world, owner, id)?;
    let here = c.at().ok_or(CommandError::NotDocked)?;
    if here == dest {
        return Err(CommandError::SameLocation);
    }
    let (stops, roads, _) = find_route(&world.defs, c.animal, here, dest).ok_or(CommandError::NoRoute)?;
    // 第一段关卡税在出发时支付
    let toll = world.defs.road(roads[0]).toll.apply(world.cargo_value_base(&c.cargo));
    need_cash(world, owner, toll)?;
    Ok(CaravanPlan::Travel { id, stops, roads })
}

pub(crate) fn check_disband(world: &World, owner: OwnerId, id: CaravanId) -> Result<CaravanPlan, CommandError> {
    let c = own(world, owner, id)?;
    c.at().ok_or(CommandError::NotDocked)?;
    if c.cargo_total() > 0 {
        return Err(crate::error::Reason::new("caravan.unload_first", "解散前需先卸下货物").rule());
    }
    let proceeds = world.defs.rules.caravan.resale.apply(c.book_value);
    Ok(CaravanPlan::Disband { id, proceeds })
}

impl World {
    pub(crate) fn cargo_value_base(&self, cargo: &BTreeMap<GoodId, i64>) -> Money {
        self.cargo_base_value(cargo)
    }
}

pub(crate) fn exec(world: &mut World, owner: OwnerId, plan: CaravanPlan) -> Result<Option<CaravanId>, CommandError> {
    let day = world.state.day;
    match plan {
        CaravanPlan::Form { at, animal, count, cost } => {
            world.book_external(
                owner,
                Flow::Other,
                world.town_sector(at),
                JournalEntry::new(day, Memo::Other, CashClass::Investing)
                    .dr(Account::Property, cost)
                    .cr(Account::Cash, cost),
            )?;
            let id = CaravanId(world.state.next_caravan.max(1));
            world.state.next_caravan = id.0 + 1;
            world.state.caravans.insert(
                id,
                Caravan {
                    id,
                    owner,
                    animal,
                    count,
                    guards: 0,
                    cargo: BTreeMap::new(),
                    location: CaravanLocation::At(at),
                    book_value: cost,
                },
            );
            Ok(Some(id))
        }
        CaravanPlan::Guards { id, delta, cost } => {
            if cost > 0 {
                world.book_external(
                    owner,
                    Flow::Wages,
                    world.caravan_town(id),
                    JournalEntry::new(day, Memo::CrewHire, CashClass::Operating)
                        .dr(Account::Wages, cost)
                        .cr(Account::Cash, cost),
                )?;
            }
            world.caravan_mut(id)?.guards += delta;
            Ok(Some(id))
        }
        CaravanPlan::Travel { id, stops, roads } => {
            let first = roads[0];
            let from = world.caravan(id)?.at();
            world.caravan_mut(id)?.location =
                CaravanLocation::OnRoad(Trek { stops, roads, leg: 0, progress: Fx::ZERO });
            world.pay_toll(id, first)?;
            // 信息时效：离开时记下那里此刻的行情
            if let Some(from) = from {
                world.info_leave(owner, from);
            }
            Ok(Some(id))
        }
        CaravanPlan::Disband { id, proceeds } => {
            let book = world.caravan(id)?.book_value;
            let mut entry = JournalEntry::new(day, Memo::Other, CashClass::Investing)
                .dr(Account::Cash, proceeds)
                .cr(Account::Property, book);
            entry = if proceeds >= book {
                entry.cr(Account::AssetGains, proceeds - book)
            } else {
                entry.dr(Account::Losses, book - proceeds)
            };
            world.book_external(owner, Flow::Other, world.caravan_town(id), entry)?;
            world.state.caravans.remove(&id);
            Ok(None)
        }
    }
}
