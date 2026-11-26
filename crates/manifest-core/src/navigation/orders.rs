//! 当天分钟命令。队列的插入顺序就是调用方按日志序号执行的顺序；不另造第二套序号。
use super::ManualVoyage;
use super::course::{Course, CoursePoint, MINUTES_PER_DAY, Steering};
use crate::world::{Fleet, FleetLocation, Voyage, World};
use crate::{CommandError, CoreError, FleetId, OwnerId, Reason};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NavigationState {
    /// 已接受命令的最大分钟。真实应用时钟在 submit_at 处另行检查，不进入内核哈希。
    pub minute: u16,
    #[serde(default, skip_serializing_if = "minute_zero")]
    pub settled: u16,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub traces: BTreeMap<FleetId, super::temporal::DayTrace>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub arrived: BTreeMap<FleetId, crate::LocId>,
    pub pending: BTreeMap<FleetId, DayOrders>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub landings: BTreeMap<FleetId, super::landing::LandingTrip>,
}
fn minute_zero(value: &u16) -> bool {
    *value == 0
}
impl NavigationState {
    pub fn is_empty(&self) -> bool {
        self.minute == 0
            && self.settled == 0
            && self.pending.is_empty()
            && self.landings.is_empty()
            && self.traces.is_empty()
            && self.arrived.is_empty()
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DayOrders {
    pub depart: Option<u16>,
    pub steers: Vec<Steering>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub autopilots: Vec<super::autopilot::PilotOrder>,
}

pub(crate) enum NavigationPlan {
    Depart { fleet: FleetId, minute: u16, voyage: ManualVoyage },
    Steer { fleet: FleetId, order: Steering },
    Autopilot { fleet: FleetId, departure: bool, order: super::autopilot::PilotOrder },
}

pub fn check_minute(minute: u16, now: u16) -> Result<(), CommandError> {
    if minute >= MINUTES_PER_DAY || now >= MINUTES_PER_DAY {
        return Err(Reason::new("navigation.minute", "航行分钟须在 0 至 1439 之间").range());
    }
    if minute < now {
        return Err(Reason::new("navigation.past", "不能回填已经过去的航行分钟").rule());
    }
    Ok(())
}

fn check_heading(heading: u16) -> Result<(), CommandError> {
    if heading >= 360 {
        return Err(Reason::new("navigation.heading", "航向须在 0 至 359 度之间").range());
    }
    Ok(())
}

pub(crate) fn check_steering(order: &Steering, now: u16) -> Result<(), CommandError> {
    check_minute(order.minute, now)?;
    if let Some(heading) = order.heading {
        check_heading(heading)?;
    }
    if order.heading.is_none() && order.sail.is_none() {
        return Err(Reason::new("navigation.empty_steer", "操舵至少需要航向或帆状态").rule());
    }
    Ok(())
}

pub(crate) fn check_fleet(world: &World, owner: OwnerId, fleet: FleetId, minute: u16) -> Result<&Fleet, CommandError> {
    if !world.defs.manual_navigation {
        return Err(Reason::new("navigation.disabled", "这个世界没有手动航行").rule());
    }
    let f = world.fleet(fleet)?;
    if owner != OwnerId::Player || f.owner != owner {
        return Err(CommandError::NotOwner);
    }
    check_minute(minute, world.state.navigation.minute)?;
    if world.state.navigation.landings.contains_key(&fleet) {
        return Err(Reason::new("landing.active", "登陆队尚未返回。").rule());
    }
    // H05：岸上的差事做完（或召回）之前不能起航
    if world.state.shore.camps.contains_key(&fleet) {
        return Err(Reason::new("shore.active", "岸上的差事还没做完（可以先召回）").rule());
    }
    if world.fleet_in_battle(fleet) {
        return Err(Reason::new("fleet.in_battle", "舰队正在交战").rule());
    }
    Ok(f)
}

pub(crate) fn check_depart(
    world: &World,
    owner: OwnerId,
    fleet: FleetId,
    minute: u16,
    heading: u16,
) -> Result<NavigationPlan, CommandError> {
    let f = check_fleet(world, owner, fleet, minute)?;
    check_heading(heading)?;
    let port = f.docked_at().ok_or_else(|| Reason::new("navigation.not_docked", "舰队须在港口才能出港").rule())?;
    if !world.defs.loc(port).is_port() && !world.defs.loc(port).is_site() {
        return Err(CommandError::NotAPort);
    }
    if !world.defs.map.is_sea_in_bounds(f.cell(&world.defs)) {
        return Err(CommandError::NoRoute);
    }
    let grid = &world.defs.nav.grid;
    let period = grid.period_on(world.day());
    if grid.check_port(period, port).is_err() {
        return Err(Reason::new("frozen_port", "港口封冻，暂时无法通航").rule());
    }
    if grid.check_cell(period, f.cell(&world.defs)).is_err() {
        return Err(Reason::new("frozen_region", "海区封冻，暂时无法通航").rule());
    }
    let need = f.crew_min(&world.defs);
    if f.crew < need {
        return Err(CommandError::CrewBelowMinimum { need, have: f.crew });
    }
    Ok(NavigationPlan::Depart { fleet, minute, voyage: ManualVoyage::new(f.cell(&world.defs), heading) })
}

pub(crate) fn check_steer(
    world: &World,
    owner: OwnerId,
    fleet: FleetId,
    order: Steering,
) -> Result<NavigationPlan, CommandError> {
    let f = check_fleet(world, owner, fleet, order.minute)?;
    check_steering(&order, world.state.navigation.minute)?;
    if !matches!(f.location, FleetLocation::AtSea(Voyage::Manual { .. })) {
        return Err(Reason::new("navigation.not_manual", "舰队当前没有手动航行").rule());
    }
    let pending = world.state.navigation.pending.get(&fleet);
    if pending.is_some_and(|p| p.steers.len() + p.autopilots.len() >= 4096) {
        return Err(Reason::new("navigation.queue_full", "当天操舵命令已达上限").rule());
    }
    let preview = world.manual_course(f, &[], order.minute);
    if preview.arrival.is_some() {
        return Err(Reason::new("navigation.arrived", "舰队在这个分钟已经抵达锚地，等待日结靠港").rule());
    }
    Ok(NavigationPlan::Steer { fleet, order })
}

pub(crate) fn apply(world: &mut World, plan: NavigationPlan) -> Result<(), CoreError> {
    match plan {
        NavigationPlan::Depart { fleet, minute, voyage } => {
            world.note_route_departure(fleet, minute);
            world.fleet_mut(fleet)?.location = FleetLocation::AtSea(Voyage::Manual { manual: voyage });
            world.state.navigation.pending.insert(fleet, DayOrders { depart: Some(minute), ..Default::default() });
            world.state.navigation.minute = minute;
        }
        NavigationPlan::Steer { fleet, order } => {
            // 兼容 E25 的目的地占位；有实际路径时，取消由积分器在命令分钟执行。
            if let FleetLocation::AtSea(Voyage::Manual { manual }) = &mut world.fleet_mut(fleet)?.location
                && manual.pilot.is_none()
            {
                manual.autopilot = None;
            }
            world.state.navigation.pending.entry(fleet).or_default().steers.push(order);
            world.state.navigation.minute = order.minute;
        }
        NavigationPlan::Autopilot { fleet, departure, order } => {
            if departure {
                world.note_route_departure(fleet, order.minute);
                let cell = world.fleet(fleet)?.cell(&world.defs);
                world.fleet_mut(fleet)?.location =
                    FleetLocation::AtSea(Voyage::Manual { manual: ManualVoyage::new(cell, 0) });
                world
                    .state
                    .navigation
                    .pending
                    .insert(fleet, DayOrders { depart: Some(order.minute), ..Default::default() });
            }
            world.state.navigation.minute = order.minute;
            world.state.navigation.pending.entry(fleet).or_default().autopilots.push(order);
        }
    }
    Ok(())
}

impl World {
    /// 从日初状态与已提交队列算整日；预览的临时操舵在同一分钟排在已提交命令之后。
    pub(crate) fn manual_course(&self, fleet: &Fleet, extra: &[Steering], until: u16) -> Course {
        let manual = match &fleet.location {
            FleetLocation::AtSea(Voyage::Manual { manual }) => manual.clone(),
            _ => ManualVoyage::new(fleet.cell(&self.defs), 0),
        };
        let pending = self.state.navigation.pending.get(&fleet.id);
        let from = pending.and_then(|p| p.depart).unwrap_or(0).max(self.state.navigation.settled);
        let mut steers = pending.map(|p| p.steers.clone()).unwrap_or_default();
        steers.extend_from_slice(extra);
        let mut course = self.integrate_manual(fleet, &manual, from.min(until), until, &steers);
        let history = self.state.navigation.traces.get(&fleet.id);
        let mut points: Vec<_> =
            history.into_iter().flat_map(|h| h.points.iter()).filter(|p| p.minute < from.min(until)).copied().collect();
        let cursor = points.last().map_or(0, |p| p.minute + 1);
        points.extend((cursor..from.min(until)).map(|minute| CoursePoint { pos: manual.pos, minute }));
        points.append(&mut course.points);
        course.points = points;
        let mut stops: Vec<_> =
            history.into_iter().flat_map(|h| h.stops.iter()).filter(|s| s.minute <= until).cloned().collect();
        for stop in std::mem::take(&mut course.stops) {
            if !stops.contains(&stop) {
                stops.push(stop);
            }
        }
        course.stops = stops;
        let mut contacts: Vec<_> =
            history.into_iter().flat_map(|h| h.contacts.iter()).filter(|c| c.minute <= until).copied().collect();
        contacts.append(&mut course.contacts);
        course.contacts = contacts;
        self.add_sea_signs(fleet, &mut course, until);
        course
    }

    pub(crate) fn validate_navigation_orders(&self) -> Result<(), CoreError> {
        let nav = &self.state.navigation;
        let fail = || CoreError::Save("分钟航行队列无效".into());
        if nav.minute >= MINUTES_PER_DAY
            || nav.settled > nav.minute
            || (!self.defs.manual_navigation && !nav.is_empty())
        {
            return Err(fail());
        }
        for (id, orders) in &nav.pending {
            let Some(fleet) = self.state.fleets.get(id) else {
                return Err(fail());
            };
            if fleet.owner != OwnerId::Player
                || !matches!(fleet.location, FleetLocation::AtSea(Voyage::Manual { .. }))
                || orders.depart.is_some_and(|m| m > nav.minute)
                || (orders.depart.is_none() && orders.steers.is_empty() && orders.autopilots.is_empty())
                || orders.steers.len() + orders.autopilots.len() > 4096
            {
                return Err(fail());
            }
            let mut minute = orders.depart.unwrap_or(0);
            for order in &orders.steers {
                if check_steering(order, minute).is_err() || order.minute > nav.minute {
                    return Err(fail());
                }
                minute = order.minute;
            }
            let mut minute = orders.depart.unwrap_or(0);
            for order in &orders.autopilots {
                if super::orders::check_minute(order.minute, minute).is_err()
                    || order.minute > nav.minute
                    || order.after_steers > orders.steers.len()
                    || self.defs.locations.get(order.dest.idx()).is_none()
                    || !order.pilot.valid_destination(self, order.dest)
                    || order
                        .after_steers
                        .checked_sub(1)
                        .and_then(|i| orders.steers.get(i))
                        .is_some_and(|s| s.minute > order.minute)
                    || orders.steers.get(order.after_steers).is_some_and(|s| s.minute < order.minute)
                {
                    return Err(fail());
                }
                minute = order.minute;
            }
        }
        Ok(())
    }
}
