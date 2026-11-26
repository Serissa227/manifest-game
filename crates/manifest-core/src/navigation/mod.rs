//! 手动航行：定点位置、航迹与分钟命令；旧航线与 NPC 仍沿用 route。

use crate::world::{Fleet, FleetLocation, Voyage, World};
use crate::{Cell, CoreError, LocId};
use serde::{Deserialize, Serialize};

pub mod autopilot;
pub mod course;
mod exploration;
mod fine_pilot;
pub mod landing;
#[cfg(test)]
mod landing_tests;
pub mod orders;
pub mod pursuit;
pub mod routing;
#[cfg(test)]
mod routing_tests;
mod sight_stops;
mod steering_cache;
pub mod temporal;
#[cfg(test)]
mod temporal_tests;
mod world_course;
pub use course::{Course, CoursePoint, CourseStop, Steering, StopKind};
pub(crate) use fine_pilot::nearest_fine_water;

/// 停船点要记进日志的那几种：碰岸停船；H03 望见远处的风暴团、雾团。
pub(crate) fn stop_log(stop: &CourseStop, fleet: crate::FleetId, owner: crate::OwnerId) -> Option<crate::log::LogKind> {
    use crate::log::LogKind;
    match stop.kind {
        StopKind::Land => Some(LogKind::NavigationStopped { fleet, owner, minute: stop.minute }),
        StopKind::StormAhead => Some(LogKind::StormSighted { fleet, owner, minute: stop.minute }),
        StopKind::FogAhead => Some(LogKind::FogSighted { fleet, owner, minute: stop.minute }),
        _ => None,
    }
}

/// 世界包的探索参数；route 世界不启用这些规则。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct NavigationRules {
    pub hide_unknown_ports: bool,
    pub sight_fame: i64,
    pub caravan_sight: i64,
}

impl Default for NavigationRules {
    fn default() -> Self {
        Self { hide_unknown_ports: true, sight_fame: 1, caravan_sight: 3 }
    }
}

impl NavigationRules {
    pub fn is_default(&self) -> bool {
        self == &Self::default()
    }
}

#[cfg(test)]
mod autopilot_tests;
#[cfg(test)]
mod course_tests;
#[cfg(test)]
mod fine_tests;
#[cfg(test)]
mod pursuit_tests;
#[cfg(test)]
mod tests;

/// 一格 256 单位；格 i 占 [i, i + 1)，不使用浮点。
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SubCell {
    pub x: i64,
    pub y: i64,
}

impl SubCell {
    pub const SCALE: i64 = 256;

    pub fn center(cell: Cell) -> Self {
        Self { x: i64::from(cell.x) * 256 + 128, y: i64::from(cell.y) * 256 + 128 }
    }

    pub fn cell(self) -> Cell {
        Cell::new(
            (self.x.div_euclid(256)).clamp(0, u16::MAX as i64) as u16,
            (self.y.div_euclid(256)).clamp(0, u16::MAX as i64) as u16,
        )
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Sail {
    #[default]
    Full,
    Half,
    Furled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ManualVoyage {
    pub pos: SubCell,
    pub heading: u16,
    pub sail: Sail,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autopilot: Option<LocId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pilot: Option<autopilot::Pilot>,
    /// 小于 1/256 格的积分余数，连同航迹保存，跨日不丢失。
    #[serde(default)]
    pub remainder: [i64; 2],
    /// H02：这次半帆是“进风暴自动收的”，出了风暴放回满帆（玩家自己调帆后清掉）
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub reefed: bool,
}

impl ManualVoyage {
    pub fn new(cell: Cell, heading: u16) -> Self {
        Self {
            pos: SubCell::center(cell),
            heading,
            sail: Sail::Full,
            autopilot: None,
            pilot: None,
            remainder: [0; 2],
            reefed: false,
        }
    }
}

impl World {
    /// route 的历史归属不变；手动航行按当前格的最近港口归属，同距按地点 ID。
    pub fn fleet_port(&self, fleet: &Fleet) -> Option<LocId> {
        match &fleet.location {
            FleetLocation::Docked(loc) => Some(*loc),
            FleetLocation::AtSea(Voyage::Route(route)) => Some(route.dest),
            FleetLocation::AtSea(Voyage::Manual { .. }) => {
                let cell = fleet.cell(&self.defs);
                let topology = self.defs.map.topology();
                self.defs.port_ids().min_by_key(|id| {
                    let port = self.defs.loc(*id).cell;
                    let dx = i64::from(topology.dx(cell.x, port.x));
                    let dy = i64::from(port.y) - i64::from(cell.y);
                    (dx * dx + dy * dy, *id)
                })
            }
        }
    }

    /// 手动航行的快照是否自洽。船位只查在不在图内：压在陆上（粗格的陆，或细海岸的陆——细碰撞之前的存档
    /// 可以停在“粗格可航行、细层却是陆”的地方）不算坏档，由随后的 [`World::reroute_fleets_at_sea`] 挪回水上。
    pub(crate) fn validate_navigation_snapshot(&self) -> Result<(), CoreError> {
        self.validate_navigation_orders()?;
        for fleet in self.state.fleets.values() {
            if let FleetLocation::AtSea(Voyage::Manual { manual }) = &fleet.location
                && (!self.defs.manual_navigation
                    || manual.heading >= 360
                    || manual.remainder.iter().any(|r| !(0..course::REMAINDER_SCALE).contains(r))
                    || manual.pos.x < 0
                    || manual.pos.y < 0
                    || manual.pos.x >= i64::from(self.defs.map.width) * 256
                    || manual.pos.y >= i64::from(self.defs.map.height) * 256
                    || manual.autopilot.is_some_and(|id| self.defs.locations.get(id.idx()).is_none()))
            {
                return Err(CoreError::Save("手动航行状态无效".into()));
            }
            if let FleetLocation::AtSea(Voyage::Manual { manual }) = &fleet.location
                && manual
                    .pilot
                    .as_ref()
                    .is_some_and(|p| manual.autopilot.is_none_or(|dest| !p.valid_destination(self, dest)))
            {
                return Err(CoreError::Save("自动驾驶路径无效".into()));
            }
        }
        self.validate_navigation_trace()?;
        self.validate_landing_snapshot()?;
        self.validate_shore_snapshot()?;
        Ok(())
    }
}

pub mod line_pilot;
pub use line_pilot::{AutopilotRules, PilotLine};

pub mod forecast;
pub use forecast::{AheadEnd, CourseAhead};
