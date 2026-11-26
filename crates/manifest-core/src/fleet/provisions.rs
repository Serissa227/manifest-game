//! 粮水按人日累计；未吃完的一格仍占舱，余数随舰队保存。
use crate::{StaticData, world::Fleet};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SupplyRemainder {
    /// 当前粮食格内已消耗的人日，范围为 0..crew_per_supply_unit。
    pub food: i64,
    /// 当前淡水格内已消耗的人日。
    pub water: i64,
}

impl SupplyRemainder {
    pub fn is_empty(&self) -> bool {
        self.food == 0 && self.water == 0
    }
}

fn capped(value: i128) -> i64 {
    value.clamp(0, i128::from(i64::MAX)) as i64
}

fn units(defs: &StaticData, crew: i64, days: i64, used: i64) -> i64 {
    if crew <= 0 || days <= 0 {
        return 0;
    }
    if !defs.rules.fractional_supplies {
        return super::daily_supply_need(defs, crew).saturating_mul(days);
    }
    let per = i128::from(defs.rules.crew_per_supply_unit.max(1));
    capped((i128::from(crew) * i128::from(days) + i128::from(used) + per - 1) / per)
}

/// N 天所需的粮或水（各自）；经典按每日向上取整，累计规则只在总人日上取整。
pub fn supplies_for_days(defs: &StaticData, crew: i64, days: i64) -> i64 {
    units(defs, crew, days, 0)
}

/// 平均每日粮或水消耗，单位为千分之一格；不足千分之一格向上取整。
pub fn daily_supply_milli(defs: &StaticData, crew: i64) -> i64 {
    if !defs.rules.fractional_supplies {
        return super::daily_supply_need(defs, crew.max(0)).saturating_mul(1_000);
    }
    let per = i128::from(defs.rules.crew_per_supply_unit.max(1));
    capped((i128::from(crew.max(0)) * 1_000 + per - 1) / per)
}

impl Fleet {
    /// 未来 N 天所需持有的粮与水，分别计入已打开容器的余数。
    pub fn supplies_required(&self, defs: &StaticData, days: i64) -> [i64; 2] {
        [
            units(defs, self.crew, days, self.supply_remainder.food),
            units(defs, self.crew, days, self.supply_remainder.water),
        ]
    }

    /// 未来 N 天应持有的粮、水各自数量；含当前打开的一格，按较多的一项备齐。
    pub fn supplies_needed(&self, defs: &StaticData, days: i64) -> i64 {
        let [food, water] = self.supplies_required(defs, days);
        food.max(water)
    }

    /// 备齐粮水后的实际占舱；新规则不能把已经装船的余粮当作空舱卖第二次。
    pub fn supplies_space(&self, defs: &StaticData, days: i64) -> i64 {
        let need = self.supplies_needed(defs, days);
        if defs.rules.fractional_supplies {
            self.food.max(need).saturating_add(self.water.max(need))
        } else {
            need.saturating_mul(2)
        }
    }

    /// 现有粮水可完整维持的天数；零船员没有消耗，返回 None。
    pub fn supplies_days(&self, defs: &StaticData) -> Option<i64> {
        if self.crew <= 0 {
            return None;
        }
        if !defs.rules.fractional_supplies {
            return Some(self.food.min(self.water).max(0) / super::daily_supply_need(defs, self.crew));
        }
        let per = i128::from(defs.rules.crew_per_supply_unit.max(1));
        let food = i128::from(self.food.max(0)) * per - i128::from(self.supply_remainder.food);
        let water = i128::from(self.water.max(0)) * per - i128::from(self.supply_remainder.water);
        Some(capped(food.min(water).max(0) / i128::from(self.crew)))
    }

    /// 整格被丢弃或剧情拿走后，没有库存的一项也不保留余数。
    pub(crate) fn normalize_supplies(&mut self) {
        if self.food <= 0 {
            self.supply_remainder.food = 0;
        }
        if self.water <= 0 {
            self.supply_remainder.water = 0;
        }
    }
}

/// 实际扣除粮水，返回是否有任何一项不足；没有粮水时每天都断粮，不产生欠账或免费人日。
pub(crate) fn consume_supplies(defs: &StaticData, fleet: &mut Fleet, days: i64) -> bool {
    consume_supplies_keep(defs, fleet, days, 100)
}

/// 同 [`consume_supplies`]，日耗只吃 `keep` %（H01 会计的 `supply_discount`、H02 的口粮档位）。
/// `keep` 为 100 时与 [`consume_supplies`] 逐位相同；其余按人日向上取整。
pub(crate) fn consume_supplies_keep(defs: &StaticData, fleet: &mut Fleet, days: i64, keep: i64) -> bool {
    let keep = keep.clamp(0, 100);
    if !defs.rules.fractional_supplies {
        let mut need = supplies_for_days(defs, fleet.crew, days);
        if keep != 100 {
            need = capped((i128::from(need) * i128::from(keep) + 99) / 100);
        }
        let short = fleet.food < need || fleet.water < need;
        fleet.food = (fleet.food - need).max(0);
        fleet.water = (fleet.water - need).max(0);
        return short;
    }
    fleet.normalize_supplies();
    let per = i128::from(defs.rules.crew_per_supply_unit.max(1));
    let mut demand = i128::from(fleet.crew.max(0)) * i128::from(days.max(0));
    if keep != 100 {
        demand = (demand * i128::from(keep) + 99) / 100;
    }
    let take = |stock: &mut i64, used: &mut i64| {
        let available = (i128::from((*stock).max(0)) * per - i128::from(*used)).max(0);
        let spent = i128::from(*used) + available.min(demand);
        *stock = (*stock - capped(spent / per)).max(0);
        *used = capped(spent % per);
        available < demand
    };
    let food_short = take(&mut fleet.food, &mut fleet.supply_remainder.food);
    let water_short = take(&mut fleet.water, &mut fleet.supply_remainder.water);
    food_short || water_short
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{FleetId, OwnerId, ScenarioId, World, testkit};
    use std::sync::Arc;

    fn world(fractional: bool, crew: i64, food: i64, water: i64) -> (World, FleetId) {
        let mut defs = (*testkit::tiny_defs()).clone();
        defs.rules.fractional_supplies = fractional;
        defs.rules.crew_per_supply_unit = 50;
        defs.rules.disease_bp_per_30_days = 0;
        defs.map.region.fill(u16::MAX);
        let mut world = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
        let id = world.flagship(OwnerId::Player).unwrap();
        let f = world.fleet_mut(id).unwrap();
        f.crew = crew;
        f.food = food;
        f.water = water;
        (world, id)
    }

    #[test]
    fn small_crews_use_person_days_without_daily_rounding() {
        let (mut w, id) = world(true, 18, 50, 50);
        let defs = w.defs.clone();
        for _ in 0..100 {
            let f = w.fleet_mut(id).unwrap();
            // 换航程、停港和读档不能依靠重置天数凭空获得补给。
            f.days_at_sea = 0;
            assert!(!consume_supplies(&defs, f, 1));
        }
        let f = w.fleet(id).unwrap();
        assert_eq!((f.food, f.water), (14, 14));
        assert!(f.supply_remainder.is_empty());
        assert_eq!(supplies_for_days(&defs, 18, 100), 36);
        assert_eq!(daily_supply_milli(&defs, 18), 360);
    }

    #[test]
    fn opened_unit_occupies_cargo_and_is_used_before_starvation() {
        let (mut w, id) = world(true, 18, 1, 1);
        let defs = w.defs.clone();
        let f = w.fleet_mut(id).unwrap();
        let used = f.used();
        assert_eq!(f.supplies_days(&defs), Some(2));
        assert!(!consume_supplies(&defs, f, 1));
        assert_eq!(f.used(), used);
        assert_eq!(f.supplies_days(&defs), Some(1));
        assert!(!consume_supplies(&defs, f, 1));
        assert_eq!(f.supplies_days(&defs), Some(0));
        assert!(consume_supplies(&defs, f, 1));
        assert_eq!((f.food, f.water), (0, 0));
        assert!(f.supply_remainder.is_empty());
    }

    #[test]
    fn changing_crew_keeps_actual_consumed_person_days() {
        let (mut w, id) = world(true, 18, 10, 10);
        let defs = w.defs.clone();
        let f = w.fleet_mut(id).unwrap();
        for crew in [18, 18, 50, 7] {
            f.crew = crew;
            assert!(!consume_supplies(&defs, f, 1));
        }
        assert_eq!((f.food, f.water), (9, 9));
        assert_eq!((f.supply_remainder.food, f.supply_remainder.water), (43, 43));
        assert_eq!(f.supplies_needed(&defs, 1), 1);
        assert_eq!(f.supplies_needed(&defs, 2), 2);
    }

    #[test]
    fn provisioning_keeps_surplus_stock_in_cargo_reservations() {
        let (w, id) = world(true, 18, 20, 3);
        let f = w.fleet(id).unwrap();
        assert_eq!(f.supplies_needed(&w.defs, 10), 4);
        assert_eq!(f.supplies_space(&w.defs, 10), 24);
        assert_eq!(f.supplies_space(&w.defs, 60), 44);
    }

    #[test]
    fn food_and_water_run_out_independently_without_free_days() {
        for (food, water) in [(0, 10), (10, 0)] {
            let (mut w, id) = world(true, 18, food, water);
            let defs = w.defs.clone();
            let f = w.fleet_mut(id).unwrap();
            for _ in 0..5 {
                assert!(consume_supplies(&defs, f, 1));
            }
            assert_eq!(f.supplies_days(&defs), Some(0));
            assert_eq!(f.food.max(f.water), 9);
            assert_eq!(f.supply_remainder.food.max(f.supply_remainder.water), 40);
        }
    }

    #[test]
    fn starvation_keeps_daily_loss_morale_and_log_rules() {
        for fractional in [false, true] {
            let (mut w, id) = world(fractional, 60, 0, 0);
            for day in 0..3 {
                let mut weather = crate::weather::DayTable::new(&w);
                let mut rng = crate::rng::Rng::derive(42, day, crate::rng::Domain::Voyage, u64::from(id.0), 0);
                w.sea_day(id, &mut rng, &mut weather, None).unwrap();
            }
            let f = w.fleet(id).unwrap();
            // 原有定点乘法四舍五入：60、58、56 人各损失 2 人。
            assert_eq!((f.crew, f.morale), (54, 85));
            assert_eq!(
                w.state.log.iter().filter(|e| matches!(e.kind, crate::log::LogKind::Starvation { .. })).count(),
                3
            );
        }
    }

    #[test]
    fn classic_rounding_and_absent_snapshot_field_are_unchanged() {
        let (mut w, id) = world(false, 18, 10, 10);
        let defs = w.defs.clone();
        let f = w.fleet_mut(id).unwrap();
        assert_eq!(supplies_for_days(&defs, 18, 7), 7);
        assert_eq!(daily_supply_milli(&defs, 18), 1_000);
        assert!(!consume_supplies(&defs, f, 3));
        assert_eq!((f.food, f.water), (7, 7));
        assert!(!serde_json::to_string(&w.state).unwrap().contains("supply_remainder"));
    }

    #[test]
    fn partial_supplies_roundtrip_and_invalid_remainders_are_rejected() {
        let (mut w, id) = world(true, 18, 10, 10);
        let defs = w.defs.clone();
        consume_supplies(&defs, w.fleet_mut(id).unwrap(), 1);
        let state = serde_json::from_str(&serde_json::to_string(&w.state).unwrap()).unwrap();
        let mut restored = World::from_snapshot(defs.clone(), state).unwrap();
        for _ in 0..20 {
            assert_eq!(
                consume_supplies(&defs, w.fleet_mut(id).unwrap(), 1),
                consume_supplies(&defs, restored.fleet_mut(id).unwrap(), 1)
            );
            assert_eq!(w.fleet(id).unwrap(), restored.fleet(id).unwrap());
        }
        for invalid in [-1, 50] {
            let mut state = w.state.clone();
            state.fleets.get_mut(&id).unwrap().supply_remainder.food = invalid;
            assert!(World::from_snapshot(defs.clone(), state).is_err());
        }
    }

    #[test]
    fn zero_crew_zero_days_and_large_inputs_do_not_overflow() {
        let (mut w, id) = world(true, 0, 0, 0);
        let defs = w.defs.clone();
        assert_eq!(w.fleet(id).unwrap().supplies_days(&defs), None);
        assert!(!consume_supplies(&defs, w.fleet_mut(id).unwrap(), 100));
        assert_eq!(supplies_for_days(&defs, 0, i64::MAX), 0);
        assert_eq!(supplies_for_days(&defs, i64::MAX, 0), 0);
        assert_eq!(supplies_for_days(&defs, i64::MAX, i64::MAX), i64::MAX);
    }

    proptest::proptest! {
        #[test]
        fn forecast_matches_consumption(crew in 1i64..201, days in 1i64..91) {
            let (mut w, id) = world(true, crew, 0, 0);
            let defs = w.defs.clone();
            let need = supplies_for_days(&defs, crew, days);
            let f = w.fleet_mut(id).unwrap();
            f.food = need;
            f.water = need;
            proptest::prop_assert!(f.supplies_days(&defs).unwrap() >= days);
            for _ in 0..days {
                proptest::prop_assert!(!consume_supplies(&defs, f, 1));
            }
            proptest::prop_assert_eq!(need * 50 - f.food * 50 + f.supply_remainder.food, crew * days);
        }
    }
}
