//! 命令提交到某分钟时才把只读投影落实；时钟和查询本身不写世界状态。
use super::{CoursePoint, CourseStop, StopKind};
use crate::log::{LogEvent, LogKind};
use crate::world::{FleetLocation, Voyage};
use crate::{CommandError, FleetId, OwnerId, World};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct DayTrace {
    pub points: Vec<CoursePoint>,
    pub stops: Vec<CourseStop>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub contacts: Vec<super::course::CourseContact>,
}

impl World {
    pub fn navigation_projection(&self, minute: u16) -> Result<Self, CommandError> {
        let mut world = self.clone();
        world.settle_navigation_to(minute)?;
        Ok(world)
    }

    pub(crate) fn settle_navigation_to(&mut self, minute: u16) -> Result<(), CommandError> {
        if !self.defs.manual_navigation {
            return Ok(());
        }
        super::orders::check_minute(minute, self.state.navigation.settled)?;
        let ids: Vec<FleetId> = self
            .state
            .fleets
            .values()
            .filter(|f| {
                f.owner == OwnerId::Player
                    && matches!(f.location, FleetLocation::AtSea(Voyage::Manual { .. }))
                    && !self.fleet_in_battle(f.id)
            })
            .map(|f| f.id)
            .collect();
        let mut arrivals = Vec::new();
        for id in ids {
            let course = self.manual_course(self.fleet(id)?, &[], minute);
            self.reveal_navigation_course(id, &course);
            self.touch_sightings(id, &course.points, course.voyage.sail);
            self.voyage_log_track(id, &course.points);
            let owner = self.fleet(id)?.owner;
            self.record_pilot_modes(id, owner, &course.pilot_modes);
            let previous = self.state.navigation.traces.get(&id);
            let stopped: Vec<_> = course
                .stops
                .iter()
                .filter(|s| {
                    matches!(s.kind, StopKind::Land | StopKind::StormAhead | StopKind::FogAhead)
                        && previous.is_none_or(|trace| !trace.stops.contains(s))
                })
                .cloned()
                .collect();
            let docked_at = super::routing::arrival_minute(&course.stops);
            self.state
                .navigation
                .traces
                .insert(id, DayTrace { points: course.points, stops: course.stops, contacts: course.contacts });
            let owner = self.fleet(id)?.owner;
            for stop in stopped {
                if let Some(kind) = super::stop_log(&stop, id, owner) {
                    self.push_log(LogEvent { day: self.day(), kind });
                }
            }
            if let Some(dest) = course.arrival {
                let fleet = self.fleet_mut(id)?;
                fleet.location = FleetLocation::Docked(dest);
                fleet.days_at_sea = 0;
                self.state.navigation.pending.remove(&id);
                self.state.navigation.arrived.insert(id, dest);
                self.state.explore.visited.insert(dest);
                self.note_route_arrival(id, dest, docked_at);
                self.voyage_log_arrive(id, dest);
                self.push_log(LogEvent { day: self.day(), kind: LogKind::Arrived { fleet: id, owner, loc: dest } });
                arrivals.push((id, dest));
            } else {
                let dest = course.voyage.autopilot;
                let supplies_stopped = course.voyage.pilot.as_ref().is_some_and(|p| p.supplies_stopped);
                self.fleet_mut(id)?.location = FleetLocation::AtSea(Voyage::Manual { manual: course.voyage });
                let orders = self.state.navigation.pending.entry(id).or_default();
                let removed = orders.steers.iter().filter(|s| s.minute < minute).count();
                orders.steers.retain(|s| s.minute >= minute);
                orders.autopilots.retain(|p| p.minute >= minute);
                for pilot in &mut orders.autopilots {
                    pilot.after_steers = pilot.after_steers.saturating_sub(removed);
                    // 同分钟命令仍会重放；把提醒记忆带回队列，读档后不会重新提醒。
                    if pilot.minute == minute && Some(pilot.dest) == dest {
                        pilot.pilot.supplies_stopped |= supplies_stopped;
                    }
                }
                orders.depart = Some(orders.depart.unwrap_or(0).max(minute));
            }
        }
        self.state.navigation.settled = minute;
        self.state.navigation.minute = self.state.navigation.minute.max(minute);
        if !arrivals.is_empty() {
            self.info_arrive(&arrivals);
            let flagship = self.flagship(OwnerId::Player);
            for (id, loc) in arrivals {
                if Some(id) == flagship {
                    self.hear_news_at(loc, true);
                }
            }
            self.cast_meet_here();
            self.refresh_story2();
        }
        Ok(())
    }

    pub fn navigation_path_days(&self, fleet: FleetId, cells: &[crate::Cell]) -> i64 {
        let Some(start) = cells.first() else { return 1 };
        let origin = self
            .fleet(fleet)
            .ok()
            .and_then(|f| match &f.location {
                FleetLocation::AtSea(Voyage::Manual { manual }) => Some(manual.pos),
                _ => None,
            })
            .unwrap_or_else(|| super::SubCell::center(*start));
        eta_days(self.navigation_path_minutes_from(fleet, origin, cells))
    }

    /// 出航菜单、多站预览与航行中共用的估时；只替换显示估时，不改寻路代价。
    pub fn navigation_path_minutes_from(&self, fleet: FleetId, origin: super::SubCell, cells: &[crate::Cell]) -> i64 {
        let Ok(fleet) = self.fleet(fleet) else { return 0 };
        let start = super::ManualVoyage::new(origin.cell(), 0);
        let mut model = super::line_pilot::WeatherModel::new(self, fleet, &start);
        let mut from = origin;
        let width = i64::from(self.defs.map.width) * 256;
        let mut minutes = 0i64;
        for cell in cells.iter().skip(1) {
            let to = super::line_pilot::unfolded(width, self.defs.map.wrap_x, from, super::SubCell::center(*cell));
            minutes =
                minutes.saturating_add(model.minutes_with_floor(from, to, 0, self.defs.rules.autopilot.creep_speed));
            from = to;
        }
        minutes
    }

    pub(crate) fn validate_navigation_trace(&self) -> Result<(), crate::CoreError> {
        let nav = &self.state.navigation;
        let fail = || crate::CoreError::Save("分钟航迹无效".into());
        for (id, trace) in &nav.traces {
            if self.state.fleets.get(id).is_none_or(|f| f.owner != OwnerId::Player)
                || trace.points.is_empty()
                || trace.points.len() > usize::from(nav.settled) + 1
                // 历史点允许因海岸线更新落陆；当前船位仍交给既有 reconcile 迁移。
                || trace.points.iter().enumerate().any(|(i, p)| {
                    usize::from(p.minute) != i
                        || p.pos.x < 0
                        || p.pos.y < 0
                        || p.pos.x >= i64::from(self.defs.map.width) * 256
                        || p.pos.y >= i64::from(self.defs.map.height) * 256
                })
                || trace.contacts.iter().any(|c| usize::from(c.minute) >= trace.points.len())
                || trace.stops.iter().any(|s| {
                    usize::from(s.minute) >= trace.points.len()
                        || s.loc.is_some_and(|id| self.defs.locations.get(id.idx()).is_none())
                        || (s.kind == StopKind::Port && s.loc.is_none())
                })
            {
                return Err(fail());
            }
        }
        if nav.arrived.iter().any(|(id, loc)| {
            self.state.fleets.get(id).is_none_or(|f| f.owner != OwnerId::Player)
                || self.defs.locations.get(loc.idx()).is_none()
                || !nav.traces.contains_key(id)
        }) {
            return Err(fail());
        }
        Ok(())
    }
}

/// 所有领航预计天数统一向上取整，至少一天。
pub fn eta_days(minutes: i64) -> i64 {
    ((minutes + 1439) / 1440).max(1)
}

impl World {
    /// 分钟落实与日结共用：每舰队、每天、每种领航模式只记第一次进入。
    pub(crate) fn record_pilot_modes(
        &mut self,
        id: FleetId,
        owner: OwnerId,
        modes: &[(super::autopilot::PilotMode, u16)],
    ) {
        for (mode, minute) in modes {
            use super::autopilot::PilotMode;
            let kind = match mode {
                PilotMode::Creep => LogKind::AutopilotCreep { fleet: id, owner, minute: *minute },
                PilotMode::Wait => LogKind::AutopilotWait { fleet: id, owner, minute: *minute },
                PilotMode::Sail | PilotMode::Beat => continue,
            };
            let recorded = self.state.log.iter().rev().take_while(|e| e.day == self.day()).any(|e| {
                matches!((&e.kind, &kind),
                    (LogKind::AutopilotCreep { fleet, .. }, LogKind::AutopilotCreep { .. })
                    | (LogKind::AutopilotWait { fleet, .. }, LogKind::AutopilotWait { .. }) if *fleet == id)
            });
            if !recorded {
                self.push_log(LogEvent { day: self.day(), kind });
            }
        }
    }
}
