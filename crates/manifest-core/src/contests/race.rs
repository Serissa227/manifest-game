//! 竞渡把每程选项翻译为操舵，复用 B7 的逐分钟定点积分器。
use crate::navigation::{
    ManualVoyage, Sail, Steering, SubCell,
    course::{CourseInput, integrate_course},
};
use crate::rng::{Domain, Rng};
use crate::world::{Fleet, FleetLocation};
use crate::{Cell, CommandError, FleetId, Fx, OwnerId, ShipTypeId, StaticData, World};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OptionDef {
    pub key: String,
    pub text: String,
    pub risk: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Leg {
    pub text: String,
    pub options: Vec<OptionDef>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Params {
    pub legs: Vec<Leg>,
}

/// 地图与操舵规则是私有定义，不扩充 I6 公开参数。
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Track {
    pub ship: String,
    pub start: [u16; 2],
    pub legs: Vec<CourseLeg>,
    #[serde(default)]
    pub option_points: BTreeMap<String, i64>,
    #[serde(default)]
    pub failed_leg_points: i64,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CourseLeg {
    pub minutes: u16,
    pub target: [u16; 2],
    pub options: BTreeMap<String, Helm>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Helm {
    pub heading: u16,
    pub sail: Sail,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Run {
    pub score: i64,
    pub bonus: Option<i64>,
    pub steers: Vec<Steering>,
    pub finish: SubCell,
    /// 每一程：离检查点走了几成（0–100，只由航迹决定）与是否失手（由种子决定，结算之前不要给玩家看）
    pub legs: Vec<LegRun>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LegRun {
    pub score: i64,
    pub failed: bool,
}

impl Params {
    pub fn validate(&self, track: &Track, defs: &StaticData) -> bool {
        let text = |s: &str| !s.trim().is_empty() && s.len() <= 4096;
        let sea = |p: [u16; 2]| defs.map.is_sea_in_bounds(Cell::new(p[0], p[1]));
        (1..=32).contains(&self.legs.len())
            && self.legs.len() == track.legs.len()
            && defs.ships.iter().any(|s| s.key == track.ship)
            && sea(track.start)
            && track.legs.iter().map(|l| u32::from(l.minutes)).sum::<u32>() <= 1440
            && self.legs.iter().zip(&track.legs).all(|(l, c)| {
                text(&l.text)
                    && (1..=16).contains(&l.options.len())
                    && c.minutes > 0
                    && sea(c.target)
                    && l.options.iter().map(|o| &o.key).collect::<BTreeSet<_>>().len() == l.options.len()
                    && l.options.len() == c.options.len()
                    && l.options.iter().all(|o| {
                        text(&o.key)
                            && text(&o.text)
                            && (0..=10000).contains(&o.risk)
                            && c.options.get(&o.key).is_some_and(|h| h.heading < 360)
                    })
            })
            && track
                .legs
                .iter()
                .scan(track.start, |previous, l| {
                    let distinct = *previous != l.target;
                    *previous = l.target;
                    Some(distinct)
                })
                .all(|v| v)
    }
    pub fn run(&self, track: &Track, world: &World, seed: u64, moves: &[String]) -> Result<Run, CommandError> {
        let bad = || CommandError::Precondition("竞渡须为每程选择一项合法走法".into());
        if !self.validate(track, &world.defs) || moves.len() != self.legs.len() {
            return Err(bad());
        }
        let kind =
            world.defs.ships.iter().position(|s| s.key == track.ship).map(ShipTypeId::from_idx).ok_or_else(bad)?;
        let ship = crate::fleet::new_ship(&world.defs, kind);
        let fleet = Fleet {
            id: FleetId(0),
            owner: OwnerId::Player,
            crew: world.defs.ship(kind).crew_min,
            ships: vec![ship],
            morale: 100,
            food: 0,
            water: 0,
            supply_remainder: Default::default(),
            cargo: BTreeMap::new(),
            location: FleetLocation::Docked(world.defs.scenarios[world.state.scenario.idx()].start_loc),
            days_at_sea: 0,
            idle_days: 0,
            plan: None,
            news: None,
        };
        let mut voyage = ManualVoyage::new(Cell::new(track.start[0], track.start[1]), 0);
        let mut weather = crate::weather::DayTable::new(world);
        let mut rng = Rng::derive(seed, 0, Domain::Upbringing, 0x52414345, 0);
        let mut result = Run {
            score: 0,
            bonus: (!track.option_points.is_empty()).then_some(0),
            steers: Vec::new(),
            finish: voyage.pos,
            legs: Vec::new(),
        };
        let mut minute = 0;
        let mut previous = voyage.pos;
        let distance = |a: SubCell, b: SubCell| {
            let width = i64::from(world.defs.map.width) * 256;
            let x = (a.x - b.x).abs();
            let x = if world.defs.map.wrap_x { x.min(width - x) } else { x };
            x + (a.y - b.y).abs()
        };
        for ((leg, course), choice) in self.legs.iter().zip(&track.legs).zip(moves) {
            let option = leg.options.iter().find(|o| &o.key == choice).ok_or_else(bad)?;
            let helm = course.options.get(choice).ok_or_else(bad)?;
            let target = SubCell::center(Cell::new(course.target[0], course.target[1]));
            let steering = Steering { minute, heading: Some(helm.heading), sail: Some(helm.sail) };
            result.steers.push(steering);
            let input = CourseInput {
                defs: &world.defs,
                fleet: &fleet,
                start: &voyage,
                from: minute,
                until: minute + course.minutes,
                steers: std::slice::from_ref(&steering),
                day: world.day(),
                speed_bonus: Fx::ZERO,
                mods: Default::default(),
            };
            let trace = integrate_course(input, |c| weather.at(&world.defs, c));
            // 岸线和流向决定到检查点的实际距离；风险只降低本程成绩，不给世界发船或改钱。
            let remaining = trace
                .points
                .iter()
                .map(|p| distance(p.pos, target))
                .min()
                .unwrap_or_else(|| distance(voyage.pos, target));
            let total = distance(previous, target).max(1);
            let score = (100 * (total - remaining) / total).clamp(0, 100);
            let failed = rng.chance_bp(option.risk);
            result.legs.push(LegRun { score, failed });
            result.score += if failed { score / 2 } else { score };
            if let Some(bonus) = &mut result.bonus {
                let points = if failed {
                    track.failed_leg_points
                } else {
                    track.option_points.get(choice).copied().ok_or_else(bad)?
                };
                *bonus += points * score / 100;
            }
            voyage = trace.voyage;
            previous = target;
            minute += course.minutes;
        }
        result.score /= self.legs.len() as i64;
        result.finish = voyage.pos;
        Ok(result)
    }
}
