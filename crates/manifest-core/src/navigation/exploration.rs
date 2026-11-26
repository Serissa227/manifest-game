//! 手动世界的沿途探索；直接使用积分器扫过的格子，经典日终探索保持不变。
use super::course::Course;
use crate::captain::AttrHook;
use crate::{FleetId, Fx, LocId, OwnerId, World};

impl World {
    pub fn navigation_sight(&self, fleet: FleetId) -> i64 {
        let bonus = self.fleet(fleet).ok().map_or(0, |f| {
            if self.posts_enabled() && f.owner == OwnerId::Player {
                // H01：瞭望长的 `fog_reveal` 与旗舰主角取较高者
                self.staffed_hook(f.owner, AttrHook::FogReveal, crate::mates::RoleTarget::Fleet(fleet))
            } else {
                self.attr_hook(f.owner, AttrHook::FogReveal)
            }
        });
        let lineage = if self.fleet(fleet).is_ok_and(|f| f.owner == OwnerId::Player) {
            self.lineage_power("night_sight", (self.state.navigation.minute + 360) % 1440)
        } else {
            0
        };
        (self.defs.rules.explore.sight + bonus + lineage + self.legend_lookout_cells(fleet)).clamp(0, 64)
    }

    pub(crate) fn reveal_navigation_course(&mut self, fleet: FleetId, course: &Course) {
        if !self.defs.manual_navigation || !self.fleet(fleet).is_ok_and(|f| f.owner == OwnerId::Player) {
            return;
        }
        for (key, entered) in &course.realms {
            self.record_realm_contact(key, *entered);
        }
        let radius = self.navigation_sight(fleet);
        let radius_bonus = self.legend_lookout_cells(fleet);
        let landmark = self.landmark_sight_cells(fleet);
        let mut seen = std::collections::BTreeSet::new();
        for step in &course.cells {
            if seen.insert(step.cell) {
                self.reveal_around(step.cell, radius);
                if landmark > radius {
                    self.sight_landmarks_near(step.cell, landmark);
                }
                self.record_sighted_locations();
            }
            self.detect_discoveries(&[(step.cell, None)], radius, radius_bonus);
        }
    }

    pub(crate) fn reveal_caravan_segment(&mut self, from: LocId, to: LocId, start: Fx, end: Fx, length: Fx) {
        let a = self.defs.loc(from).cell;
        let b = self.defs.loc(to).cell;
        let topology = self.defs.map.topology();
        let dx = i64::from(topology.dx(a.x, b.x));
        let dy = i64::from(b.y) - i64::from(a.y);
        let point = |progress: Fx| {
            let ratio = progress.div(length).0.clamp(0, Fx::SCALE);
            [
                i64::from(a.x) * 256 + 128 + dx * 256 * ratio / Fx::SCALE,
                i64::from(a.y) * 256 + 128 + dy * 256 * ratio / Fx::SCALE,
            ]
        };
        let start = point(start);
        let end = point(end);
        let steps = (end[0] - start[0]).abs().max((end[1] - start[1]).abs()).max(1);
        let mut cells = Vec::new();
        for step in 0..=steps {
            let x = start[0] + (end[0] - start[0]) * step / steps;
            let y = start[1] + (end[1] - start[1]) * step / steps;
            if let Some(cell) = topology.normalize(x.div_euclid(256), y.div_euclid(256))
                && cells.last() != Some(&cell)
            {
                cells.push(cell);
            }
        }
        let radius =
            (self.defs.navigation.caravan_sight + self.attr_hook(OwnerId::Player, AttrHook::FogReveal)).clamp(0, 64);
        for cell in cells {
            self.reveal_around(cell, radius);
            self.record_sighted_locations();
            self.detect_discoveries(&[(cell, Some(from))], radius, 0);
            self.detect_caravan_land_discoveries(cell, radius);
        }
    }

    /// H01 `position_fix`：港口与地标比迷雾揭开得更远就能认出来（只记“已望见”，不揭开海图）。
    /// 名声与日志同 [`World::record_sighted_locations`]。
    fn sight_landmarks_near(&mut self, at: crate::Cell, radius: i64) {
        if !self.hides_unknown_locations() || !self.state.agents.contains_key(&OwnerId::Player) {
            return;
        }
        let topology = self.defs.map.topology();
        let found: Vec<LocId> = self
            .defs
            .loc_ids()
            .filter(|id| {
                let l = self.defs.loc(*id);
                (l.is_port() || l.is_site())
                    && !self.location_visible(*id)
                    && self.realm_key_at_port(*id).is_none()
                    && topology.squared_distance(at, l.cell) <= radius * radius
            })
            .collect();
        for loc in found {
            self.state.explore.sighted.insert(loc);
            if let Some(player) = self.state.agents.get_mut(&OwnerId::Player) {
                player.fame += self.defs.navigation.sight_fame.max(0);
            }
            self.push_log(crate::log::LogEvent {
                day: self.day(),
                kind: crate::log::LogKind::LocationSighted { loc, owner: OwnerId::Player },
            });
        }
    }

    fn detect_caravan_land_discoveries(&mut self, at: crate::Cell, sight: i64) {
        use crate::geo::authored::DiscoveryMode;
        let found: Vec<_> = self
            .defs
            .discovery_ids()
            .filter(|id| {
                if self.state.explore.discovered.contains_key(id) {
                    return false;
                }
                let Some(source) = self.defs.geography.places.authored.discoveries.get(&self.defs.discovery(*id).key)
                else {
                    return false;
                };
                let radius = sight.min(i64::from(source.radius));
                source.requires.mode == DiscoveryMode::Land
                    && self.discovery_conditions(*id, DiscoveryMode::Land, at, true)
                    && self
                        .discovery_cell(*id)
                        .is_some_and(|cell| self.defs.map.topology().squared_distance(at, cell) <= radius * radius)
            })
            .collect();
        for discovery in found {
            self.state.explore.discovered.insert(discovery, self.day());
            self.push_log(crate::log::LogEvent {
                day: self.day(),
                kind: crate::log::LogKind::Discovered { discovery, owner: OwnerId::Player },
            });
        }
    }
}
