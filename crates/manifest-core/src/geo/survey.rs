//! C2 发现位置与条件查询；被动发现沿用已有记录，主动调查的命令由集成方接线。
use super::authored::DiscoveryMode;
use crate::{
    Cell, DiscoveryId, FleetId, OwnerId, World,
    error::{CommandError, Reason},
};

impl World {
    pub fn discovery_cell(&self, id: DiscoveryId) -> Option<Cell> {
        let discovery = self.defs.discoveries.get(id.idx())?;
        let year = self.cast_date()[0];
        let moved = self
            .defs
            .geography
            .places
            .authored
            .discoveries
            .get(&discovery.key)
            .and_then(|d| d.moves.iter().filter(|m| m.from_year <= year).max_by_key(|m| m.from_year));
        Some(moved.map_or(discovery.cell, |m| m.cell))
    }

    pub(crate) fn discovery_conditions(&self, id: DiscoveryId, mode: DiscoveryMode, at: Cell, landed: bool) -> bool {
        let Some(d) = self.defs.discoveries.get(id.idx()) else { return false };
        let Some(source) = self.defs.geography.places.authored.discoveries.get(&d.key) else {
            return mode == DiscoveryMode::Sight;
        };
        let req = &source.requires;
        req.mode == mode
            && (source.reachable || mode == DiscoveryMode::Sight)
            && (req.landing != Some(true) || landed)
            && (!req.permission || self.state.story2.flags.contains(&format!("discovery_permission_{}", d.key)))
            && req.history.as_ref().is_none_or(|key| self.state.cast.outcomes.contains_key(key))
            && req.records.iter().all(|key| self.has_knowledge_record(key))
            && req
                .weather
                .as_ref()
                .is_none_or(|kind| self.weather_at(at).is_some_and(|weather| weather.sky.key() == kind))
    }

    pub(crate) fn can_sight_discovery(
        &self,
        id: DiscoveryId,
        at: Cell,
        loc: Option<crate::LocId>,
        sight: i64,
        radius_bonus: i64,
    ) -> bool {
        let Some(cell) = self.discovery_cell(id) else { return false };
        let d = self.defs.discovery(id);
        let radius = self
            .defs
            .geography
            .places
            .authored
            .discoveries
            .get(&d.key)
            .map_or(sight, |d| sight.min(i64::from(d.radius) + radius_bonus))
            .max(0);
        self.defs.map.topology().squared_distance(at, cell) <= radius * radius
            && self.discovery_conditions(id, DiscoveryMode::Sight, at, loc.is_some())
    }

    /// 从既有书目与发现记录派生见闻，不写入故事模块未声明的旗标或新增存档块。
    pub fn has_knowledge_record(&self, key: &str) -> bool {
        self.state.story2.flags.contains(key)
            || self.state.explore.discovered.keys().any(|id| {
                let discovery = self.defs.discovery(*id);
                discovery.key == key
                    || self
                        .defs
                        .geography
                        .places
                        .authored
                        .discoveries
                        .get(&discovery.key)
                        .is_some_and(|source| source.clue.as_deref() == Some(key))
            })
            || self.inventory(OwnerId::Player).is_some_and(|inventory| {
                inventory.bibliography.values().any(|record| {
                    self.defs
                        .items
                        .item(&record.key)
                        .and_then(|item| item.read.as_ref())
                        .is_some_and(|read| read.records.iter().any(|record| record == key))
                })
            })
    }

    /// 主动登岸/潜水的纯预检；不在命令系统之外修改发现记录。
    pub fn check_discovery_survey(
        &self,
        fleet: FleetId,
        id: DiscoveryId,
        mode: DiscoveryMode,
    ) -> Result<(), CommandError> {
        let f = self.fleet(fleet)?;
        if f.owner != OwnerId::Player {
            return Err(CommandError::NotOwner);
        }
        let d = self.defs.discoveries.get(id.idx()).ok_or_else(|| CommandError::NotFound(format!("{id:?}")))?;
        let source = self
            .defs
            .geography
            .places
            .authored
            .discoveries
            .get(&d.key)
            .ok_or_else(|| CommandError::NotFound(d.key.clone()))?;
        let at = f.cell(&self.defs);
        let landed = f.docked_at().is_some();
        if (mode == DiscoveryMode::Land && !landed)
            || self.fleet_in_battle(fleet)
            || (source.once && self.state.explore.discovered.contains_key(&id))
            || !self.discovery_conditions(id, mode, at, landed)
            || self.discovery_cell(id).is_none_or(|cell| {
                self.defs.map.topology().squared_distance(at, cell)
                    > (i64::from(source.radius) + self.legend_lookout_cells(fleet)).pow(2)
            })
        {
            return Err(Reason::new("explore.requirements", "发现条件未满足").rule());
        }
        Ok(())
    }
}
