//! H10b：当日之后的只读估计；固定今天的船况和加成，不执行日结或揭雾。
use super::course::{CourseInput, MINUTES_PER_DAY, integrate_with_pilot};
use super::{Course, CourseStop, Sail, StopKind, SubCell};
use crate::weather::DayTable;
use crate::{CommandError, FleetId, OwnerId, World};
use serde::Serialize;
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AheadEnd {
    Horizon,
    Port,
    Land,
    Still,
    Fog,
    Held,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AheadPoint {
    pub pos: SubCell,
    pub t: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct AheadBarrier {
    pub t: u16,
    pub kind: StopKind,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CourseAhead {
    pub step: u8,
    pub points: Vec<AheadPoint>,
    pub barriers: Vec<AheadBarrier>,
    pub end: AheadEnd,
    pub tentative: bool,
}

impl World {
    pub fn course_ahead(&self, fleet: FleetId, days: u8) -> Result<CourseAhead, CommandError> {
        if !(1..=2).contains(&days) {
            return Err(CommandError::InvalidQuantity);
        }
        let f = self.fleet(fleet)?;
        if f.owner != OwnerId::Player {
            return Err(CommandError::NotOwner);
        }
        let today = self.manual_course(f, &[], MINUTES_PER_DAY);
        self.course_ahead_from(fleet, &today, days)
    }

    /// 复用调用方已经算好的今日航迹；操舵草稿也从其真实的日末领航状态接续。
    pub fn course_ahead_from(&self, fleet: FleetId, today: &Course, days: u8) -> Result<CourseAhead, CommandError> {
        if !(1..=2).contains(&days) {
            return Err(CommandError::InvalidQuantity);
        }
        let f = self.fleet(fleet)?;
        if f.owner != OwnerId::Player {
            return Err(CommandError::NotOwner);
        }
        if !self.defs.manual_navigation
            || !matches!(f.location, crate::world::FleetLocation::AtSea(crate::world::Voyage::Manual { .. }))
        {
            self.preview_course(fleet, &[], 0)?;
        }
        let mut out =
            CourseAhead { step: 5, points: Vec::new(), barriers: Vec::new(), end: AheadEnd::Horizon, tentative: true };
        if self.fleet_in_battle(fleet) || self.creature_delayed(fleet) {
            out.end = AheadEnd::Held;
            return Ok(out);
        }
        if today.arrival.is_some() {
            out.end = AheadEnd::Port;
            return Ok(out);
        }
        if today.voyage.sail == Sail::Furled && today.voyage.pilot.is_none() {
            out.end =
                if today.stops.iter().any(|s| s.kind == StopKind::Land) { AheadEnd::Land } else { AheadEnd::Still };
            return Ok(out);
        }
        let mut start = today.voyage.clone();
        let passes = self.realm_passes(f.owner);
        for k in 1..=days {
            let day = self.day().saturating_add(u32::from(k));
            let mut table = DayTable::on(self, day);
            let input = CourseInput {
                defs: &self.defs,
                fleet: f,
                start: &start,
                from: 0,
                until: MINUTES_PER_DAY,
                steers: &[],
                day,
                speed_bonus: self.fleet_speed_bonus(fleet),
                mods: self.voyage_mods(fleet),
            };
            let mut course =
                integrate_with_pilot(input, &[], Some(&self.state.explore), &passes, |c| table.at_pos(&self.defs, c));
            if self.defs.rules.weather_cells.enabled {
                let range = self.navigation_sight(fleet) * self.defs.rules.weather_cells.sight_mult;
                let mut seen: BTreeSet<_> = table
                    .cells_near(&self.defs, start.pos.cell(), range)
                    .iter()
                    .filter(|c| c.kind != crate::weather_cells::CellKind::Squall)
                    .map(|c| (c.region.0, c.index))
                    .collect();
                let mut last = None;
                for p in &course.points {
                    let c = p.pos.cell();
                    if last == Some(c) {
                        continue;
                    }
                    last = Some(c);
                    for cell in table.cells_near(&self.defs, c, range) {
                        let kind = match cell.kind {
                            crate::weather_cells::CellKind::Storm => StopKind::StormAhead,
                            crate::weather_cells::CellKind::Fog => StopKind::FogAhead,
                            crate::weather_cells::CellKind::Squall => continue,
                        };
                        if seen.insert((cell.region.0, cell.index)) {
                            course.stops.push(CourseStop { minute: p.minute, kind, loc: None });
                        }
                    }
                }
            }
            let fog = start
                .pilot
                .is_none()
                .then(|| {
                    course
                        .cells
                        .iter()
                        .find(|c| !self.state.explore.is_revealed(self.defs.map.idx(c.cell)))
                        .map(|c| c.minute)
                })
                .flatten();
            // 未知格的入口分钟不暴露；最后一点留在上一分钟已知海域。
            let until = fog.map_or(MINUTES_PER_DAY, |m| m.saturating_sub(1));
            let stop_at = course
                .stops
                .iter()
                .filter(|s| matches!(s.kind, StopKind::Land | StopKind::Port))
                .map(|s| s.minute)
                .min();
            let until = stop_at.map_or(until, |m| m.min(until));
            let offset = u16::from(k) * MINUTES_PER_DAY;
            let stop_minutes: BTreeSet<_> = course.stops.iter().map(|s| s.minute).collect();
            out.points.extend(
                course
                    .points
                    .iter()
                    .filter(|p| {
                        p.minute > 0
                            && p.minute <= until
                            && (p.minute % 5 == 0 || p.minute == until || stop_minutes.contains(&p.minute))
                    })
                    .map(|p| AheadPoint { pos: p.pos, t: offset + p.minute }),
            );
            out.barriers.extend(
                course
                    .stops
                    .iter()
                    .filter(|s| {
                        s.minute <= until
                            && matches!(
                                s.kind,
                                StopKind::Port
                                    | StopKind::Land
                                    | StopKind::Storm
                                    | StopKind::StormAhead
                                    | StopKind::FogAhead
                            )
                    })
                    .map(|s| AheadBarrier { t: offset + s.minute, kind: s.kind }),
            );
            if fog.is_some_and(|m| stop_at.is_none_or(|s| m <= s)) {
                out.end = AheadEnd::Fog;
                break;
            }
            if course.arrival.is_some() {
                out.end = AheadEnd::Port;
                break;
            }
            if stop_at.is_some() {
                out.end = AheadEnd::Land;
                break;
            }
            if course.voyage.sail == Sail::Furled && course.voyage.pilot.is_none() {
                out.end = AheadEnd::Still;
                break;
            }
            start = course.voyage;
        }
        out.barriers.sort_by_key(|s| (s.t, s.kind.order()));
        out.barriers.dedup();
        Ok(out)
    }
}
