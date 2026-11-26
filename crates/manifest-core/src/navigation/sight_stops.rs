//! 暂停候选只从实际积分扫过的格子派生，不提前揭开未来迷雾。
use super::{Course, CourseStop, StopKind};
use crate::world::{Fleet, FleetLocation};
use crate::{OwnerId, World};
use std::collections::BTreeSet;

impl World {
    pub(crate) fn add_navigation_sights(&self, fleet: &Fleet, course: &mut Course) {
        if fleet.owner != OwnerId::Player {
            return;
        }
        let map = &self.defs.map;
        let topology = map.topology();
        // H01：港口与地标按 `position_fix` 看得更远，别的舰队按 `intel_detection`；开关关闭时都等于航行视野
        let radius = self.landmark_sight_cells(fleet.id);
        let ship_radius = self.fleet_sight_cells(fleet.id);
        let mut places = BTreeSet::new();
        let mut ships: BTreeSet<_> = self
            .state
            .navigation
            .traces
            .get(&fleet.id)
            .into_iter()
            .flat_map(|trace| trace.contacts.iter())
            .map(|c| (u8::from(c.pirate), c.id))
            .collect();
        let candidates: Vec<_> = self
            .state
            .fleets
            .values()
            .filter(|f| f.owner != OwnerId::Player && matches!(f.location, FleetLocation::AtSea(_)))
            .map(|f| ((0, f.id.0), f.cell(&self.defs)))
            .chain(self.state.battles.pirates.values().map(|p| ((1, p.id), p.cell)))
            .collect();
        for crossed in &course.cells {
            for loc in self.defs.loc_ids().filter(|id| !self.location_visible(*id)) {
                let definition = self.defs.loc(loc);
                if (definition.is_port() || definition.is_site())
                    && topology.squared_distance(crossed.cell, definition.cell) <= radius * radius
                    && places.insert(loc)
                {
                    course.stops.push(CourseStop { minute: crossed.minute, kind: StopKind::Sight, loc: Some(loc) });
                }
            }
            for (id, cell) in &candidates {
                if topology.squared_distance(crossed.cell, *cell) <= ship_radius * ship_radius && ships.insert(*id) {
                    course.stops.push(CourseStop { minute: crossed.minute, kind: StopKind::Sight, loc: None });
                    course.contacts.push(super::course::CourseContact {
                        minute: crossed.minute,
                        pirate: id.0 == 1,
                        id: id.1,
                    });
                }
            }
        }
        course.stops.sort_by_key(|s| (s.minute, s.kind.order(), s.loc));
        course.stops.dedup();
    }

    /// H03：远处的天气团与追上来的海盗（只看整天的航迹，日初就在眼里的团不算“进入视野”）。
    /// 两个开关都关着时什么也不加。
    pub(crate) fn add_sea_signs(&self, fleet: &Fleet, course: &mut Course, until: u16) {
        if fleet.owner != OwnerId::Player || course.points.is_empty() {
            return;
        }
        let defs = &self.defs;
        let mut added = Vec::new();
        if defs.rules.weather_cells.enabled {
            let range = self.navigation_sight(fleet.id) * defs.rules.weather_cells.sight_mult;
            let mut table = crate::weather::DayTable::new(self);
            let first = course.points[0].pos.cell();
            let mut seen: BTreeSet<(u16, u8)> = table
                .cells_near(defs, first, range)
                .iter()
                .filter(|c| c.kind != crate::weather_cells::CellKind::Squall)
                .map(|c| (c.region.0, c.index))
                .collect();
            let mut last = None;
            for p in &course.points {
                let cell = p.pos.cell();
                if last == Some(cell) {
                    continue;
                }
                last = Some(cell);
                for c in table.cells_near(defs, cell, range) {
                    let kind = match c.kind {
                        crate::weather_cells::CellKind::Storm => StopKind::StormAhead,
                        crate::weather_cells::CellKind::Fog => StopKind::FogAhead,
                        crate::weather_cells::CellKind::Squall => continue,
                    };
                    if seen.insert((c.region.0, c.index)) {
                        added.push(CourseStop { minute: p.minute, kind, loc: None });
                    }
                }
            }
        }
        if defs.rules.pursuit.enabled {
            let points: Vec<_> = course.points.iter().copied().take(usize::from(until) + 1).collect();
            for t in self.pursuit_tracks(fleet, &points, &BTreeSet::new()) {
                if let Some(m) = t.contact {
                    added.push(CourseStop { minute: m, kind: StopKind::Overtaken, loc: None });
                }
            }
        }
        if defs.rules.sightings.enabled {
            let points: Vec<_> = course.points.iter().copied().take(usize::from(until) + 1).collect();
            added.extend(self.sighting_stops(fleet.id, &points));
        }
        if added.is_empty() {
            return;
        }
        for s in added {
            if !course.stops.contains(&s) {
                course.stops.push(s);
            }
        }
        course.stops.sort_by_key(|s| (s.minute, s.kind.order(), s.loc));
        course.stops.dedup();
    }
}
