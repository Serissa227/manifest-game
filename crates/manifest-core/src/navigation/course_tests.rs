use super::course::*;
use super::{ManualVoyage, Sail};
use crate::defs::{SailType, SeasonWeather};
use crate::nav::{NavTable, Terrain};
use crate::weather::{DayWeather, Sky};
use crate::world::Fleet;
use crate::world::{FleetLocation, Voyage, World};
use crate::{Cell, Fx, LocId, StaticData};
use crate::{FleetId, OwnerId, RegionId, ScenarioId};
use std::sync::Arc;

fn setup() -> (StaticData, Fleet) {
    let mut defs = (*crate::testkit::tiny_defs()).clone();
    defs.manual_navigation = true;
    defs.map.terrain.fill(Terrain::Deep);
    defs.map.region.fill(0);
    defs.map.wrap_x = true;
    // 测试航路不自动靠港；实际港口另有一条抵港测试。
    let world = World::new(Arc::new(defs.clone()), ScenarioId(0), 42).unwrap();
    let fleet = world.fleets_of(OwnerId::Player).next().unwrap().clone();
    defs.nav = Arc::new(NavTable::build(&defs.map, &defs.regions, defs.locations.len(), &[]));
    (defs, fleet)
}

fn clear(wind: u8, current: u8, strength: i64) -> DayWeather {
    DayWeather {
        region: RegionId(0),
        day: 0,
        sky: Sky::Clear,
        storm_hit_e8: 0,
        sea: SeasonWeather {
            wind_dir: wind,
            wind_strength: 5,
            current_dir: current,
            current_strength: strength,
            storm_bp: 0,
            pirate_bp: 0,
        },
    }
}

fn run(
    defs: &StaticData,
    fleet: &Fleet,
    start: &ManualVoyage,
    range: (u16, u16),
    orders: &[Steering],
    w: DayWeather,
) -> Course {
    integrate_course(
        CourseInput {
            defs,
            fleet,
            start,
            from: range.0,
            until: range.1,
            steers: orders,
            day: 0,
            speed_bonus: Fx::ZERO,
            mods: Default::default(),
        },
        |_| Some(w),
    )
}

#[test]
fn cardinal_vectors_and_both_no_go_angles_are_exact() {
    assert_eq!([0, -10000], direction(0));
    assert_eq!([10000, 0], direction(90));
    assert_eq!([0, 10000], direction(180));
    assert_eq!([-10000, 0], direction(270));
    let (mut defs, fleet) = setup();
    for (sail, limit) in [(SailType::Square, 67), (SailType::Lateen, 50)] {
        for ship in &fleet.ships {
            defs.ships[ship.kind.idx()].sail = sail;
        }
        let start = ManualVoyage::new(Cell::new(5, 15), limit - 1);
        let result = run(&defs, &fleet, &start, (0, 1440), &[], clear(4, 0, 0));
        assert_eq!(result.voyage.pos, start.pos);
        let start = ManualVoyage { heading: limit, ..start };
        assert_ne!(run(&defs, &fleet, &start, (0, 1440), &[], clear(4, 0, 0)).voyage.pos, start.pos);
    }
}

#[test]
fn wind_and_current_are_vectors_and_furled_is_stationary() {
    let (defs, fleet) = setup();
    let start = ManualVoyage::new(Cell::new(5, 15), 90);
    let dry = run(&defs, &fleet, &start, (0, 1440), &[], clear(2, 0, 0));
    let flow = run(&defs, &fleet, &start, (0, 1440), &[], clear(2, 4, 2));
    assert_eq!(dry.voyage.pos.x, flow.voyage.pos.x);
    assert_eq!(flow.voyage.pos.y - dry.voyage.pos.y, 256);
    let half = ManualVoyage { sail: Sail::Half, ..start.clone() };
    let slower = run(&defs, &fleet, &half, (0, 1440), &[], clear(2, 0, 0));
    assert!((2 * (slower.voyage.pos.x - start.pos.x) - (dry.voyage.pos.x - start.pos.x)).abs() <= 1);
    let reefed = ManualVoyage { sail: Sail::Furled, ..start };
    assert_eq!(run(&defs, &fleet, &reefed, (0, 1440), &[], clear(2, 4, 3)).voyage, reefed);
}

#[test]
fn fast_ship_cannot_tunnel_through_land_or_cut_a_land_corner() {
    let (mut defs, mut fleet) = setup();
    for ship in &mut fleet.ships {
        ship.speed_bonus = Fx::from_int(3000);
    }
    let cell = Cell::new(7, 15);
    let index = defs.map.idx(cell);
    defs.map.terrain[index] = Terrain::Land;
    let start = ManualVoyage::new(Cell::new(5, 15), 90);
    let result = run(&defs, &fleet, &start, (0, 60), &[], clear(2, 0, 0));
    assert_eq!(result.voyage.pos.cell(), Cell::new(6, 15));
    assert_eq!(result.voyage.pos.x, 7 * 256 - 1);
    assert_eq!(result.stops[0].kind, StopKind::Land);
    assert_eq!(result.stops[0].minute, 1);
    assert!(result.points.iter().all(|p| defs.map.is_sea_in_bounds(p.pos.cell())));
    defs.map.terrain[index] = Terrain::Deep;
    let flank = defs.map.idx(Cell::new(7, 16));
    defs.map.terrain[flank] = Terrain::Land;
    let start = ManualVoyage::new(Cell::new(6, 16), 45);
    let corner = run(&defs, &fleet, &start, (0, 1), &[], clear(1, 0, 0));
    assert!(corner.stops.iter().any(|s| s.kind == StopKind::Land));
}

#[test]
fn both_seams_preserve_signed_remainders_and_split_minutes_match() {
    let (defs, fleet) = setup();
    for (heading, x, wind) in [(90, defs.map.width - 1, 2), (270, 0, 6)] {
        let start = ManualVoyage::new(Cell::new(x, 15), heading);
        let full = run(&defs, &fleet, &start, (0, 1440), &[], clear(wind, 0, 0));
        assert!(full.voyage.pos.x >= 0 && full.voyage.pos.x < i64::from(defs.map.width) * 256);
        assert_ne!(full.voyage.pos.cell().x, x);
        let a = run(&defs, &fleet, &start, (0, 721), &[], clear(wind, 0, 0));
        let b = run(&defs, &fleet, &a.voyage, (721, 1440), &[], clear(wind, 0, 0));
        assert_eq!(full.voyage, b.voyage);
        assert_eq!(&full.points[721..], b.points);
        assert_eq!(full, run(&defs, &fleet, &start, (0, 1440), &[], clear(wind, 0, 0)));
    }
}

#[test]
fn latitude_uses_the_same_e14_travel_scale() {
    use crate::nav::climate::{NavigationRules, Projection, ProjectionKind};
    let (mut defs, fleet) = setup();
    let start = ManualVoyage::new(Cell::new(5, 15), 90);
    let flat = run(&defs, &fleet, &start, (0, 1440), &[], clear(2, 0, 0));
    let projection = Projection {
        kind: ProjectionKind::Equirect,
        west: 0,
        north: 60 * 60 + 15 * 60 + 30,
        arcmin_per_cell: 60,
        lat_scale: true,
    };
    assert_eq!(projection.row_cos(15), Fx(5000));
    defs.nav = Arc::new(
        NavTable::build_with_rules(
            &defs.map,
            &defs.regions,
            defs.locations.len(),
            &[],
            NavigationRules { projection: Some(projection), ..Default::default() },
        )
        .unwrap(),
    );
    let polar = run(&defs, &fleet, &start, (0, 1440), &[], clear(2, 0, 0));
    assert!((2 * (polar.voyage.pos.x - start.pos.x) - (flat.voyage.pos.x - start.pos.x)).abs() <= 1);
}

#[test]
fn arriving_at_anchor_stops_and_uses_existing_arrival_pipeline() {
    let (mut defs, fleet) = setup();
    let dest = LocId(1);
    let start = Cell::new(5, 15);
    defs.locations[dest.idx()].cell = Cell::new(6, 15);
    let result = run(&defs, &fleet, &ManualVoyage::new(start, 90), (0, 1440), &[], clear(2, 0, 0));
    assert_eq!(result.arrival, Some(dest));
    let stop = result.stops.iter().find(|s| s.kind == StopKind::Port).unwrap();
    assert_eq!(stop.loc, Some(dest));
    assert!(stop.minute > 0 && stop.minute < 1440);
    assert!(result.points.iter().filter(|p| p.minute >= stop.minute).all(|p| p.pos == result.voyage.pos));
}

#[test]
fn thousand_random_previews_equal_day_end_and_do_not_mutate_world() {
    let (mut defs, _) = setup();
    defs.rules.pirates.spawn_scale = Fx::ZERO;
    let defs = Arc::new(defs);
    let mut rng = crate::rng::Rng::derive(1234, 0, crate::rng::Domain::Voyage, 0, 0);
    let base = World::new(defs, ScenarioId(0), 42).unwrap();
    let id: FleetId = base.fleets_of(OwnerId::Player).next().unwrap().id;
    for _ in 0..1000 {
        let mut w = base.clone();
        w.state.day = rng.below(360) as u32;
        let mut manual = ManualVoyage::new(
            Cell::new(rng.below(u64::from(w.defs.map.width)) as u16, 10 + rng.below(8) as u16),
            rng.below(360) as u16,
        );
        manual.sail = [Sail::Full, Sail::Half, Sail::Furled][rng.below(3) as usize];
        let f = w.fleet_mut(id).unwrap();
        f.food = 100;
        f.water = 100;
        f.location = FleetLocation::AtSea(Voyage::Manual { manual });
        let before = w.state.clone();
        let preview = w.preview_course(id, &[], 0).unwrap();
        assert_eq!(w.state, before);
        assert_eq!(w.preview_course(id, &[], 0).unwrap(), preview);
        w.end_day().unwrap();
        let f = w.fleet(id).unwrap();
        match (&f.location, preview.arrival) {
            (FleetLocation::AtSea(Voyage::Manual { manual }), None) => {
                assert_eq!(manual, &preview.voyage)
            }
            (FleetLocation::Docked(loc), Some(expected)) => assert_eq!(*loc, expected),
            other => panic!("预览与日结不一致：{other:?}"),
        }
    }
}

#[test]
fn moving_voyage_keeps_fractional_remainders_across_save_and_next_day() {
    let (mut defs, _) = setup();
    defs.rules.pirates.spawn_scale = Fx::ZERO;
    let mut w = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
    let id = w.fleets_of(OwnerId::Player).next().unwrap().id;
    let cell = Cell::new(8, 15);
    let heading = (u16::from(w.weather_at(cell).unwrap().sea.wind_dir) * 45 + 17) % 360;
    let f = w.fleet_mut(id).unwrap();
    f.food = 100;
    f.water = 100;
    f.location = FleetLocation::AtSea(Voyage::Manual { manual: ManualVoyage::new(cell, heading) });
    w.end_day().unwrap();
    let FleetLocation::AtSea(Voyage::Manual { manual }) = &w.fleet(id).unwrap().location else {
        panic!("远海航段")
    };
    assert_ne!(manual.pos, super::SubCell::center(cell));
    assert!(manual.remainder.iter().any(|r| *r != 0));
    let save =
        crate::SaveFile::new(&w.defs, crate::replay::StartParams::new(ScenarioId(0), 42), w.state.clone(), vec![]);
    let loaded = crate::SaveFile::from_json(&save.to_json().unwrap()).unwrap();
    let mut b = World::from_snapshot(w.defs.clone(), loaded.snapshot).unwrap();
    assert_eq!(w.state, b.state);
    assert_eq!(w.preview_course(id, &[], 0).unwrap(), b.preview_course(id, &[], 0).unwrap());
    w.end_day().unwrap();
    b.end_day().unwrap();
    assert_eq!(w.state, b.state);
    for bad in [-1, REMAINDER_SCALE] {
        let mut state = b.state.clone();
        let FleetLocation::AtSea(Voyage::Manual { manual }) = &mut state.fleets.get_mut(&id).unwrap().location else {
            panic!("远海航段")
        };
        manual.remainder[0] = bad;
        assert!(World::from_snapshot(w.defs.clone(), state).is_err());
    }
}
