//! 登陆队按日行动，舰队留在锚地；检定使用独立随机域。
use super::{Sail, Steering, SubCell};
use crate::captain::AttrHook;
use crate::geo::authored::DiscoveryMode;
use crate::log::{LogEvent, LogKind};
use crate::rng::{Domain, Rng};
use crate::world::{FleetLocation, Voyage};
use crate::{CommandError, CoreError, FleetId, OwnerId, Reason, World};
use serde::{Deserialize, Serialize};

pub const MAX_LANDING_DAYS: u16 = 30;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LandingTrip {
    pub anchor: SubCell,
    pub days: u16,
    pub elapsed: u16,
    pub delayed: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LandingRisk {
    Injury,
    Disease,
    Lost,
}

pub(crate) struct LandingPlan {
    fleet: FleetId,
    minute: u16,
    trip: LandingTrip,
}

pub(crate) fn check(world: &World, owner: OwnerId, fleet: FleetId, days: u16) -> Result<LandingPlan, CommandError> {
    let minute = world.state.navigation.minute;
    let f = super::orders::check_fleet(world, owner, fleet, minute)?;
    if days == 0 || days > MAX_LANDING_DAYS {
        return Err(Reason::new("landing.days", "登陆天数须在 1 至 30 之间。").range());
    }
    let anchor = match &f.location {
        FleetLocation::Docked(_) => SubCell::center(f.cell(&world.defs)),
        FleetLocation::AtSea(Voyage::Manual { .. }) => {
            let course = world.manual_course(f, &[], minute);
            if course.arrival.is_some() {
                return Err(Reason::new("navigation.arrived", "舰队在这个分钟已经抵达锚地，等待日结靠港").rule());
            }
            course.voyage.pos
        }
        _ => return Err(Reason::new("navigation.not_manual", "舰队当前没有手动航行").rule()),
    };
    let coast = f.docked_at().is_some()
        || (0..8).any(|dir| {
            world
                .defs
                .map
                .topology()
                .neighbor(anchor.cell(), dir)
                .is_some_and(|c| world.defs.map.terrain[world.defs.map.idx(c)] == crate::nav::Terrain::Land)
        });
    if !coast {
        return Err(Reason::new("landing.coast", "舰队需要靠近陆地。").rule());
    }
    let need = f.supplies_needed(&world.defs, i64::from(days + 1));
    if f.food < need || f.water < need {
        return Err(Reason::new("landing.supplies", "登陆所需粮水不足。").rule());
    }
    Ok(LandingPlan { fleet, minute, trip: LandingTrip { anchor, days, elapsed: 0, delayed: false } })
}

pub(crate) fn apply(world: &mut World, plan: LandingPlan) -> Result<(), CoreError> {
    if matches!(world.fleet(plan.fleet)?.location, FleetLocation::AtSea(Voyage::Manual { .. })) {
        world.state.navigation.pending.entry(plan.fleet).or_default().steers.push(Steering {
            minute: plan.minute,
            heading: None,
            sail: Some(Sail::Furled),
        });
    }
    world.state.navigation.landings.insert(plan.fleet, plan.trip);
    Ok(())
}

impl World {
    pub(crate) fn validate_landing_snapshot(&self) -> Result<(), CoreError> {
        let fail = || CoreError::Save("登陆状态无效".into());
        for (id, trip) in &self.state.navigation.landings {
            let Some(fleet) = self.state.fleets.get(id) else { return Err(fail()) };
            if fleet.owner != OwnerId::Player
                || trip.days == 0
                || trip.days > MAX_LANDING_DAYS + u16::from(trip.delayed)
                || trip.elapsed >= trip.days
                || trip.anchor.x < 0
                || trip.anchor.y < 0
                || trip.anchor.x >= i64::from(self.defs.map.width) * 256
                || trip.anchor.y >= i64::from(self.defs.map.height) * 256
            {
                return Err(fail());
            }
            let at = match &fleet.location {
                FleetLocation::Docked(_) => SubCell::center(fleet.cell(&self.defs)),
                FleetLocation::AtSea(Voyage::Manual { .. }) => {
                    self.manual_course(fleet, &[], self.state.navigation.minute).voyage.pos
                }
                _ => return Err(fail()),
            };
            if trip.anchor != at {
                return Err(fail());
            }
        }
        Ok(())
    }

    pub(crate) fn finish_landing_day(&mut self) {
        if !self.defs.manual_navigation {
            return;
        }
        let trips = self.state.navigation.landings.clone();
        for (id, mut trip) in trips {
            let Some(fleet) = self.state.fleets.get(&id) else {
                self.state.navigation.landings.remove(&id);
                continue;
            };
            let owner = fleet.owner;
            // 登陆期间只结算登陆风险，但无论锚泊还是停港都消耗粮水。
            {
                if let Some(fleet) = self.state.fleets.get_mut(&id) {
                    crate::fleet::consume_supplies(&self.defs, fleet, 1);
                }
            }
            trip.elapsed += 1;
            let skill = self.attr_hook(owner, AttrHook::Landing).clamp(0, 8_000);
            let mut rng = Rng::derive(self.state.seed, self.day(), Domain::Landing, u64::from(id.0), 0);
            if rng.chance_bp(500 * (10_000 - skill) / 10_000) {
                let risk = match rng.below(3) {
                    2 if !trip.delayed => {
                        trip.days += 1;
                        trip.delayed = true;
                        LandingRisk::Lost
                    }
                    1 => LandingRisk::Disease,
                    _ => LandingRisk::Injury,
                };
                // H01 `disease_guard`：登陆染病按船医与体魄减免（开关关闭时保留 100%，不多掷骰）
                let keep = self.post_disease_keep(id);
                let spared = risk == LandingRisk::Disease && keep < 100 && !rng.chance_bp(keep * 100);
                if let Some(fleet) = self.state.fleets.get_mut(&id).filter(|_| !spared) {
                    match risk {
                        LandingRisk::Injury => fleet.crew -= fleet.crew.saturating_sub(1).clamp(0, 2),
                        LandingRisk::Disease => fleet.morale = (fleet.morale - 5).max(0),
                        LandingRisk::Lost => {}
                    }
                }
                if !spared {
                    self.push_log(LogEvent { day: self.day(), kind: LogKind::LandingRisk { fleet: id, owner, risk } });
                }
            }
            let radius = (self.defs.rules.explore.sight + i64::from(trip.elapsed) * 2).clamp(1, 64);
            self.reveal_around(trip.anchor.cell(), radius);
            let find = self.attr_hook(owner, AttrHook::Find).clamp(0, 10_000) / 100;
            let defs = self.defs.clone();
            for discovery in defs.discovery_ids() {
                if self.state.explore.discovered.contains_key(&discovery) {
                    continue;
                }
                let Some(cell) = self.discovery_cell(discovery) else {
                    continue;
                };
                let dist = defs.map.topology().squared_distance(trip.anchor.cell(), cell);
                if dist > radius * radius {
                    continue;
                }
                let source = defs.geography.places.authored.discoveries.get(&defs.discovery(discovery).key);
                if let Some(source) = source {
                    if source.requires.mode == DiscoveryMode::Dive
                        || !source.reachable
                        || !self.discovery_conditions(discovery, source.requires.mode, trip.anchor.cell(), true)
                    {
                        continue;
                    }
                } else if defs.map.is_sea_in_bounds(cell) {
                    continue;
                }
                let mut check = Rng::derive(
                    self.state.seed,
                    self.day(),
                    Domain::Landing,
                    u64::from(id.0),
                    u64::from(discovery.0) + 1,
                );
                let score = i64::from(trip.elapsed) * 20 + find + check.range(0, 20);
                let dx = i64::from(defs.map.topology().dx(trip.anchor.cell().x, cell.x)).abs();
                let dy = (i64::from(trip.anchor.cell().y) - i64::from(cell.y)).abs();
                if score < dx.max(dy) * 10 {
                    continue;
                }
                self.state.explore.discovered.insert(discovery, self.day());
                self.push_log(LogEvent { day: self.day(), kind: LogKind::Discovered { discovery, owner } });
            }
            if trip.elapsed >= trip.days {
                self.state.navigation.landings.remove(&id);
                self.push_log(LogEvent {
                    day: self.day(),
                    kind: LogKind::LandingFinished { fleet: id, owner, days: trip.days },
                });
            } else {
                self.state.navigation.landings.insert(id, trip);
            }
        }
    }
}
