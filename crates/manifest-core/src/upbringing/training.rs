//! 实习船及补给由学校借出，账面为零；只可航行，不能买卖、改装或转移其资源。
use super::*;
use crate::{
    Command, CommandError, FleetId, OwnerId, ShipTypeId, World,
    warehouse::Holder,
    world::{Fleet, FleetLocation},
};
impl World {
    pub fn is_training_fleet(&self, id: FleetId) -> bool {
        self.state.upbringing.as_ref().and_then(|s| s.training.as_ref()).is_some_and(|t| t.fleet == id)
    }
    pub(crate) fn prepare_training_fleet(&mut self) {
        let Some(s) = self.state.upbringing.as_ref() else { return };
        let weekly = self.upbringing_weekly();
        if s.phase != Phase::Running || s.training.is_some() || (!weekly && s.next_slot >= 3) {
            return;
        }
        // 按旬：只看下一旬；按周（U05）：本周余下的格里有实习航行就借，借整周（换周时归还）。
        let first = usize::from(s.next_slot);
        let slots = if weekly { s.plan.get(first..) } else { s.plan.get(first..first + 1) };
        let Some(slots) = slots.filter(|slots| !slots.is_empty()) else { return };
        let kind = slots
            .iter()
            .flat_map(|slot| slot.lesson.iter().chain(slot.after.iter().map(|c| &c.activity)))
            .filter_map(|key| self.defs.upbringing.activity(key))
            .find_map(|a| a.training_ship.as_ref());
        let Some(kind) =
            kind.and_then(|key| self.defs.ships.iter().position(|s| &s.key == key)).map(ShipTypeId::from_idx)
        else {
            return;
        };
        let Some(loc) = self.upbringing_location().filter(|loc| self.defs.loc(*loc).is_port()) else { return };
        let (month, slot) = (s.month, if weekly { weekly::week_of(self.cast_date()[2]) } else { s.next_slot });
        let mut ship = crate::fleet::new_ship(&self.defs, kind);
        ship.book_value = 0;
        let supply = ship.capacity / 2;
        let id = self.alloc_fleet_id();
        let fleet = Fleet {
            id,
            owner: OwnerId::Player,
            crew: self.defs.ship(kind).crew_min,
            ships: vec![ship],
            morale: 100,
            food: supply,
            water: supply,
            supply_remainder: Default::default(),
            cargo: BTreeMap::new(),
            location: FleetLocation::Docked(loc),
            days_at_sea: 0,
            idle_days: 0,
            plan: None,
            news: None,
        };
        self.state.fleets.insert(id, fleet);
        if let Some(s) = &mut self.state.upbringing {
            s.training = Some(TrainingFleet { fleet: id, month, slot, origin: Some(loc) });
        }
    }
    pub(crate) fn return_training_fleet(&mut self) {
        let Some(training) = self.state.upbringing.as_mut().and_then(|s| s.training.take()) else { return };
        let loc = training
            .origin
            .or_else(|| self.upbringing_location())
            .or_else(|| self.state.cast.place.as_ref().map(|p| p.loc))
            // 没有 origin 的旧状态仍有剧本开局地点；人在海上时也不能丢掉货物。
            .or_else(|| self.defs.scenarios.get(self.state.scenario.idx()).map(|s| s.start_loc));
        if let Some(fleet) = self.state.fleets.remove(&training.fleet) {
            // 兼容故事奖励送到旗舰的货物：货物仍属于学生，转入原所在地仓库，账本总量不变。
            if !fleet.cargo.is_empty()
                && let Some(location) = loc.and_then(|l| self.state.locations.get_mut(l.idx()))
            {
                let store = location.warehouses.entry(OwnerId::Player).or_default();
                for (good, qty) in fleet.cargo {
                    *store.stock.entry(good).or_default() += qty;
                }
            }
        }
        for person in self.state.mates.values_mut() {
            if matches!(person.role,crate::mates::MateRole::Captain(id)|crate::mates::MateRole::Assigned{target:crate::mates::RoleTarget::Fleet(id),..} if id==training.fleet)
            {
                person.role = crate::mates::MateRole::None;
            }
        }
        self.prune_equipment();
    }
    pub(crate) fn check_training_command(&self, command: &Command) -> Result<(), CommandError> {
        use Command::*;
        let blocked = match command {
            Buy { fleet, .. }
            | Sell { fleet, .. }
            | Resupply { fleet, .. }
            | HireCrew { fleet, .. }
            | DismissCrew { fleet, .. }
            | Repair { fleet, .. }
            | BuyShip { fleet, .. }
            | SellShip { fleet, .. }
            | RefitShip { fleet, .. }
            | FoundColony { fleet, .. } => self.is_training_fleet(*fleet),
            BuyInto { holder, .. } | SellFrom { holder, .. } | DeliverContract { holder, .. } => {
                matches!(holder,Holder::Fleet(f) if self.is_training_fleet(*f))
            }
            Transfer { from, to, .. } => {
                [from, to].into_iter().any(|h| matches!(h,Holder::Fleet(f) if self.is_training_fleet(*f)))
            }
            AssignMate { role, .. } => {
                matches!(role,crate::mates::MateRole::Captain(id)|crate::mates::MateRole::Assigned{target:crate::mates::RoleTarget::Fleet(id),..} if self.is_training_fleet(*id))
            }
            _ => false,
        };
        if blocked {
            Err(CommandError::Precondition("实习船只供航行，不能交易、改装或转移其资源".into()))
        } else {
            Ok(())
        }
    }
}
