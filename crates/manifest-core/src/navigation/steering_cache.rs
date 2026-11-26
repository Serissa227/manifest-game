//! 单次航程积分内复用同一风况、纬度行与帆位的领航速度，不跨舰队或查询保留。
use super::{ManualVoyage, Sail, course::CourseInput};
use crate::weather::DayWeather;

pub(super) struct SteeringCache<'a, 'defs> {
    input: &'a CourseInput<'defs>,
    key: Option<(Option<DayWeather>, u16, Sail)>,
    vectors: [[i64; 2]; 360],
    beating: Option<Box<[[i64; 2]; 360]>>,
}

impl<'a, 'defs> SteeringCache<'a, 'defs> {
    pub(super) fn new(input: &'a CourseInput<'defs>) -> Self {
        Self { input, key: None, vectors: [[0; 2]; 360], beating: None }
    }

    pub(super) fn vectors(&mut self, voyage: &ManualVoyage, weather: Option<DayWeather>) -> &[[i64; 2]; 360] {
        let key = (weather, voyage.pos.cell().y, voyage.sail);
        if self.key != Some(key) {
            self.beating = None;
            let mut trial = ManualVoyage::new(voyage.pos.cell(), 0);
            trial.pos = voyage.pos;
            trial.sail = voyage.sail;
            for (heading, vector) in self.vectors.iter_mut().enumerate() {
                trial.heading = heading as u16;
                *vector = super::course::velocity(self.input, &trial, weather);
            }
            self.key = Some(key);
        }
        &self.vectors
    }

    /// 各对水方向分别重算抢风推进，再叠加海流；抵流时不能只转一个固定长度的向量。
    pub(super) fn beat_vectors(&mut self, voyage: &ManualVoyage, weather: Option<DayWeather>) -> &[[i64; 2]; 360] {
        self.vectors(voyage, weather);
        let vectors = &self.vectors;
        let rules = &self.input.defs.rules.autopilot;
        let current = super::course::current_velocity(self.input, voyage.pos, weather);
        self.beating.get_or_insert_with(|| {
            Box::new(std::array::from_fn(|heading| {
                let [dx, dy] = super::course::direction(heading as u16);
                let best = super::autopilot::beat_rank(vectors, dx, dy, rules.creep_speed).map_or_else(
                    // 强流使所有对地推进都为负时，仍保留抵流推进，不能当作无动力顺流漂。
                    || {
                        vectors
                            .iter()
                            .copied()
                            .max_by_key(|v| i128::from(v[0]) * i128::from(dx) + i128::from(v[1]) * i128::from(dy))
                            .unwrap_or(current)
                    },
                    |r| vectors[usize::from(r.2)],
                );
                super::autopilot::beat_candidate(
                    super::SubCell { x: 0, y: 0 },
                    super::SubCell { x: dx, y: dy },
                    best,
                    current,
                    rules.beat_efficiency_pct,
                )
                .0
            }))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nav::climate::{NavigationRules, Projection, ProjectionKind};
    use crate::{Cell, Fx, OwnerId, RegionId, ScenarioId, World};
    use std::sync::Arc;

    #[test]
    fn cached_vectors_match_the_original_formula_across_weather_rows_and_headings() {
        let mut defs = (*crate::testkit::tiny_defs()).clone();
        let rules = NavigationRules {
            projection: Some(Projection {
                kind: ProjectionKind::Equirect,
                west: 0,
                north: 4_800,
                arcmin_per_cell: 120,
                lat_scale: true,
            }),
            ..Default::default()
        };
        defs.nav = Arc::new(
            crate::nav::NavTable::build_with_rules(&defs.map, &defs.regions, defs.locations.len(), &[], rules).unwrap(),
        );
        let world = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
        let mut fleet = world.fleets_of(OwnerId::Player).next().unwrap().clone();
        fleet.crew = 1;
        fleet.morale = 20;
        fleet.ships[0].speed_bonus = Fx::from_int(3);
        let start = ManualVoyage::new(Cell::new(5, 5), 0);
        let input = CourseInput {
            defs: &world.defs,
            fleet: &fleet,
            start: &start,
            from: 481,
            until: 1440,
            steers: &[],
            day: 0,
            speed_bonus: Fx::from_pct(23),
            mods: Default::default(),
        };
        let mut cache = SteeringCache::new(&input);
        for row in [5, 15, 25, 5] {
            for wind in 0..8 {
                for sky in [crate::Sky::Clear, crate::Sky::Storm, crate::Sky::Fog] {
                    let weather = DayWeather {
                        region: RegionId(0),
                        day: 0,
                        sky,
                        storm_hit_e8: 0,
                        sea: crate::defs::SeasonWeather {
                            wind_dir: wind,
                            wind_strength: 6,
                            current_dir: (wind + 3) % 8,
                            current_strength: 2,
                            storm_bp: 0,
                            pirate_bp: 0,
                        },
                    };
                    let mut voyage = ManualVoyage::new(Cell::new(5, row), 0);
                    let vectors = *cache.vectors(&voyage, Some(weather));
                    assert_eq!(*cache.vectors(&voyage, Some(weather)), vectors);
                    for heading in 0..360 {
                        voyage.heading = heading;
                        assert_eq!(
                            vectors[usize::from(heading)],
                            super::super::course::velocity(&input, &voyage, Some(weather)),
                            "行 {row}，风 {wind}，天况 {sky:?}，航向 {heading}"
                        );
                    }
                }
            }
        }
        let mut voyage = start.clone();
        let vectors = *cache.vectors(&voyage, None);
        for heading in 0..360 {
            voyage.heading = heading;
            assert_eq!(vectors[usize::from(heading)], super::super::course::velocity(&input, &voyage, None));
        }
    }
}
