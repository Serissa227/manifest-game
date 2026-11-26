//! H08 航海日志与到港的航程总结（`rules.toml [voyage_log]`，VOYAGE-PLAN §9）。
//!
//! - **航海日志**的条目不另存：就是世界日志（`state.log`）里这一程期间、与这支舰队有关的那些，由应用层按日志种类归集
//!   （`manifest-appcore` 的 `journal` 分类表：天气、所见、决定、损耗、到港）。以后新加的日志种类只要登记进分类表就会出现。
//!   为了让“做了什么决定”也进日志，本模块在开关打开时让喊话与海上所见的选择各记一条日志（`Hailed`、`SightingChosen`）。
//! - **一程**：玩家舰队在海上的那一天起（日结或分钟落实时发现它在海上），到靠港为止。起点记下日期、出发港、船体、船员、
//!   现金、货值；途中逐分钟累计里程（1/256 格，整数开方）；靠港时算出**航程总结**（天数、里程、平均航速、损耗、盈亏），
//!   放在 `last` 里给界面弹一次。航线纪录（H07）留了字段，没有数据时为空。
//!
//! 开关关闭（经典世界、测试夹具）时什么也不记，状态里没有这一节。

use crate::OwnerId;
use crate::fixed::Money;
use crate::ids::{FleetId, LocId};
use crate::navigation::CoursePoint;
use crate::world::{FleetLocation, World};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// 航海日志与航程总结的规则（`rules.toml [voyage_log]`）。缺省关闭。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct VoyageLogRules {
    pub enabled: bool,
}

/// 进行中的一程。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Trip {
    pub start_day: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<LocId>,
    /// 出发时各船耐久之和
    pub hull: i64,
    pub crew: i64,
    pub cash: Money,
    /// 出发时货物按基准价的货值
    pub cargo_value: Money,
    /// 累计里程（1/256 格）
    #[serde(default)]
    pub distance: i64,
    /// 里程已经算到哪一天的哪一分钟（同一天里分段落实时不重复计）
    #[serde(default)]
    pub counted: (u32, u16),
    /// 抵港时记下实际航时，日结稍后结算损耗与总结；旧档缺失时仍能读取。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minutes: Option<u32>,
}

/// 一程的总结（到港时算好，界面弹一次）。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TripSummary {
    pub fleet: FleetId,
    pub start_day: u32,
    pub end_day: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<LocId>,
    pub to: LocId,
    /// 天数（至少 1）
    pub days: u32,
    /// 里程（1/256 格）
    pub distance: i64,
    /// 船体损失的耐久（出发时 − 到港时，修理不算）
    pub hull_lost: i64,
    /// 船员增减（到港时 − 出发时）
    pub crew_change: i64,
    /// 现金增减
    pub cash_change: Money,
    /// 货值增减（按基准价）
    pub cargo_change: Money,
    /// H07 的航线纪录：这一对港口的最短天数（H07 合入前为空）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub record_days: Option<u32>,
    /// 这一程是否破了纪录（H07 合入前为 false）
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub record_broken: bool,
}

/// 航海日志的状态。开关关闭时总是空的、不写进存档。
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoyageLogState {
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub trips: BTreeMap<FleetId, Trip>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last: Option<TripSummary>,
}

impl VoyageLogState {
    pub fn is_empty(&self) -> bool {
        self.trips.is_empty() && self.last.is_none()
    }
}

/// 两点之间的直线距离（1/256 格，整数开方）。
fn step(defs: &crate::StaticData, a: crate::navigation::SubCell, b: crate::navigation::SubCell) -> i64 {
    crate::weather_cells::sub_distance2(defs, a, b).max(0).isqrt()
}

impl World {
    fn trip_snapshot(&self, fleet: FleetId) -> Option<(i64, i64, Money, Money)> {
        let f = self.state.fleets.get(&fleet)?;
        let hull = f.ships.iter().map(|s| s.durability).sum();
        let value = f.cargo.iter().map(|(g, q)| self.defs.goods.get(g.idx()).map_or(0, |d| d.base_price) * q).sum();
        let cash = self.agent(f.owner).map_or(0, |a| a.cash);
        Some((hull, f.crew, cash, value))
    }

    /// 玩家舰队在海上却还没有一程：从现在起记。
    fn trip_begin(&mut self, fleet: FleetId) {
        if self.state.voyage_log.trips.contains_key(&fleet) {
            return;
        }
        let Some((hull, crew, cash, cargo_value)) = self.trip_snapshot(fleet) else { return };
        let from = self.state.fleets.get(&fleet).and_then(|f| self.fleet_port(f));
        let day = self.state.day;
        self.state.voyage_log.trips.insert(
            fleet,
            Trip { start_day: day, from, hull, crew, cash, cargo_value, distance: 0, counted: (day, 0), minutes: None },
        );
        self.books_depart(fleet);
    }

    /// 落实一段分钟航迹时累计里程（只算 `counted` 以后的分钟）。开关关闭时什么也不做。
    pub(crate) fn voyage_log_track(&mut self, fleet: FleetId, points: &[CoursePoint]) {
        if !self.defs.rules.voyage_log.enabled
            || self.state.fleets.get(&fleet).is_none_or(|f| f.owner != OwnerId::Player)
        {
            return;
        }
        self.trip_begin(fleet);
        let day = self.state.day;
        let defs = self.defs.clone();
        let Some(trip) = self.state.voyage_log.trips.get_mut(&fleet) else { return };
        let from = if trip.counted.0 == day { trip.counted.1 } else { 0 };
        let mut add = 0;
        let mut last = None;
        for p in points.iter().filter(|p| p.minute >= from) {
            if let Some(q) = last {
                add += step(&defs, q, p.pos);
            }
            last = Some(p.pos);
        }
        trip.distance += add;
        if let Some(end) = points.last() {
            trip.counted = (day, end.minute.max(from));
        }
    }

    /// 靠港：结算这一程（开关关闭或没有一程时什么也不做）。
    pub(crate) fn voyage_log_arrive(&mut self, fleet: FleetId, to: LocId) {
        if !self.defs.rules.voyage_log.enabled {
            return;
        }
        let Some(trip) = self.state.voyage_log.trips.remove(&fleet) else { return };
        let Some((hull, crew, cash, cargo_value)) = self.trip_snapshot(fleet) else { return };
        let day = self.state.day;
        // 与航线纪录共用实际航时、向上取整；旧档没有航时记录时沿用已有日期。
        let days = trip
            .minutes
            .map_or_else(|| day.saturating_sub(trip.start_day).max(1), |minutes| minutes.div_ceil(1440).max(1));
        self.state.voyage_log.last = Some(TripSummary {
            fleet,
            start_day: trip.start_day,
            end_day: day,
            from: trip.from,
            to,
            days,
            distance: trip.distance,
            hull_lost: (trip.hull - hull).max(0),
            crew_change: crew - trip.crew,
            cash_change: cash - trip.cash,
            cargo_change: cargo_value - trip.cargo_value,
            record_days: None,
            record_broken: false,
        });
        self.books_arrive(fleet, trip.from, to, days);
    }

    /// 日结：在海上的玩家舰队开始记一程；已经靠港的结算（分钟落实时没结算到的）；没了的舰队丢掉。
    pub(crate) fn voyage_log_day(&mut self) {
        if !self.defs.rules.voyage_log.enabled {
            return;
        }
        let fleets: Vec<(FleetId, Option<LocId>)> = self
            .state
            .fleets
            .values()
            .filter(|f| f.owner == OwnerId::Player)
            .map(|f| {
                (
                    f.id,
                    match f.location {
                        FleetLocation::Docked(l) => Some(l),
                        FleetLocation::AtSea(_) => None,
                    },
                )
            })
            .collect();
        let alive: Vec<FleetId> = fleets.iter().map(|(f, _)| *f).collect();
        self.state.voyage_log.trips.retain(|f, _| alive.contains(f));
        for (id, docked) in fleets {
            match docked {
                Some(loc) => self.voyage_log_arrive(id, loc),
                None => self.trip_begin(id),
            }
        }
        // 总结只弹一次：过了到港那一天就不再给
        let day = self.state.day;
        if self.state.voyage_log.last.as_ref().is_some_and(|l| l.end_day + 1 < day) {
            self.state.voyage_log.last = None;
        }
    }
}

#[cfg(test)]
#[path = "voyage_log_tests.rs"]
mod tests;
