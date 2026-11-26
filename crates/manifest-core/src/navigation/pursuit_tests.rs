//! H03 按分钟追击的测试：纵帆船往上风跑、横帆船往下风跑都甩得掉海盗；反过来跑则被追上。
use super::course::{CourseInput, MINUTES_PER_DAY, integrate_course};
use super::pursuit::PirateChase;
use super::{ManualVoyage, Sail, SubCell};
use crate::battle::PirateFleet;
use crate::defs::{SailType, ShipTypeDef, StaticData};
use crate::nav::{NavTable, SeaMap, Terrain};
use crate::world::{FleetLocation, Voyage, World};
use crate::{Cell, FleetId, Fx, OwnerId, RegionId, ScenarioId, ShipTypeId};
use std::collections::BTreeSet;
use std::sync::Arc;

/// 240 × 120 格、东西相接的一整片海，只有一个海区；风恒定从北往南吹（5 级），没有洋流，天天晴。
fn open_sea() -> Arc<StaticData> {
    let mut d = (*crate::testkit::tiny_defs()).clone();
    let (w, h) = (240u16, 120u16);
    let n = usize::from(w) * usize::from(h);
    d.map = SeaMap { width: w, height: h, wrap_x: true, terrain: vec![Terrain::Deep; n], region: vec![0; n] };
    d.regions[0].rect = (0, 0, w - 1, h - 1);
    for r in &mut d.regions {
        for s in &mut r.seasons {
            s.wind_dir = 4;
            s.wind_strength = 5;
            s.current_strength = 0;
            s.storm_bp = 0;
            s.pirate_bp = 0;
        }
    }
    d.rules.weather.wind_dir_weights = [0, 0, 1, 0, 0];
    d.rules.weather.wind_strength_weights = [0, 0, 0, 1, 0, 0, 0];
    for c in &mut d.rules.weather.climates {
        c.skies = [[1, 0, 0, 0]; 4];
    }
    d.nav = Arc::new(NavTable::build(&d.map, &d.regions, d.locations.len(), &[]));
    d.manual_navigation = true;
    d.rules.pirates.spawn_scale = Fx::ZERO;
    d.rules.disease_bp_per_30_days = 0;
    d.rules.pursuit.enabled = true;
    // 第三种船：与横帆运货船同样快的纵帆船（海盗用）
    d.ships.push(ShipTypeDef {
        key: "felucca".into(),
        name: "felucca".into(),
        sail: SailType::Lateen,
        speed: Fx::from_int(5),
        capacity: 80,
        durability: 60,
        crew_min: 8,
        crew_max: 30,
        guns: 4,
        price: 5_000,
        description: String::new(),
        unique: false,
    });
    Arc::new(d)
}

fn ship_kind(d: &StaticData, key: &str) -> ShipTypeId {
    ShipTypeId::from_idx(d.ships.iter().position(|s| s.key == key).unwrap())
}

/// 追击的一局：玩家舰队（一艘 `own` 船，航向 `heading`）在 (120, 100)，海盗（一艘 `pirate` 船，航速加成 `bonus` 格 / 天）
/// 在它正南（下风）或正北 `gap` 格。逐日积分玩家的航迹、算追击，最多 `days` 天。
/// 返回（追上的那一天, 海盗放弃的那一天）。
fn chase(own: &str, heading: u16, pirate: &str, bonus: i64, gap: i64, days: u32) -> (Option<u32>, Option<u32>) {
    let d = open_sea();
    let mut w = World::new(d.clone(), ScenarioId(0), 3).unwrap();
    let id: FleetId = w.fleets_of(OwnerId::Player).next().unwrap().id;
    // 往南跑的从北边出发，往北、往东的从南边出发，八天里都碰不到南北边界
    let y0: i64 = if heading > 90 && heading < 270 { 10 } else { 100 };
    let start = Cell::new(120, y0 as u16);
    {
        let f = w.fleet_mut(id).unwrap();
        f.ships = vec![crate::fleet::new_ship(&d, ship_kind(&d, own))];
        f.crew = 40;
        f.morale = 80;
        f.food = 500;
        f.water = 500;
        let mut manual = ManualVoyage::new(start, heading);
        manual.sail = Sail::Full;
        f.location = FleetLocation::AtSea(Voyage::Manual { manual });
    }
    let mut ship = crate::fleet::new_ship(&d, ship_kind(&d, pirate));
    ship.speed_bonus = Fx::from_int(bonus);
    let pcell = Cell::new(120, (y0 + gap) as u16);
    w.state.battles.pirates.insert(
        7,
        PirateFleet {
            id: 7,
            region: RegionId(0),
            cell: pcell,
            ships: vec![ship],
            crew: 30,
            until: 999,
            engaged: false,
        },
    );
    for day in 0..days {
        w.state.day = day;
        let fleet = w.fleet(id).unwrap().clone();
        let FleetLocation::AtSea(Voyage::Manual { manual }) = &fleet.location else { panic!("在海上") };
        let course = integrate_course(
            CourseInput {
                defs: &d,
                fleet: &fleet,
                start: manual,
                from: 0,
                until: MINUTES_PER_DAY,
                steers: &[],
                day,
                speed_bonus: Fx::ZERO,
                mods: Default::default(),
            },
            |c| w.weather_at_pos(c),
        );
        assert!(course.stops.is_empty(), "开阔海上不停船：{:?}", course.stops);
        let tracks = w.pursuit_tracks(&fleet, &course.points, &BTreeSet::new());
        let t = tracks.into_iter().find(|t| t.pirate == 7);
        // 同样的输入算两次结果相同（纯函数）
        assert_eq!(
            t.as_ref().map(|t| (t.contact, t.end)),
            w.pursuit_tracks(&fleet, &course.points, &BTreeSet::new())
                .into_iter()
                .find(|t| t.pirate == 7)
                .map(|t| (t.contact, t.end))
        );
        let voyage = course.voyage.clone();
        w.fleet_mut(id).unwrap().location = FleetLocation::AtSea(Voyage::Manual { manual: voyage });
        match t {
            None => return (None, Some(day)),
            Some(t) => {
                assert_eq!(t.points.len(), course.points.len());
                if t.contact.is_some() {
                    return (Some(day), None);
                }
                let end: Option<PirateChase> = t.end;
                let last: SubCell = *t.points.last().unwrap();
                w.state.battles.pirates.get_mut(&7).unwrap().cell = last.cell();
                match end {
                    Some(c) => {
                        w.state.battles.chases.insert(7, c);
                    }
                    None => return (None, Some(day)),
                }
            }
        }
    }
    (None, None)
}

#[test]
fn a_lateen_beating_upwind_escapes_a_square_rigger() {
    // 风从北来。纵帆船（死区 50°）抢风往北偏东 55° 走；横帆海盗（死区 67°）更快一些，但抢不了这么高的风
    let (caught, gave_up) = chase("sloop", 55, "hauler", 1, 3, 8);
    assert_eq!(caught, None, "往上风跑的纵帆船不该被追上");
    assert!(gave_up.is_some(), "海盗连续一整天看不见就放弃");
    // 同一条海盗船，纵帆船改往下风跑：被追上
    let (caught, _) = chase("sloop", 180, "hauler", 1, -3, 8);
    assert!(caught.is_some(), "往下风跑的纵帆船跑不过更快的横帆船");
}

#[test]
fn a_square_rigger_running_downwind_escapes_a_lateen() {
    // 风从北来。横帆船往正南（顺风）跑；同样快的纵帆海盗顺风吃亏
    let (caught, gave_up) = chase("hauler", 180, "felucca", 0, -3, 8);
    assert_eq!(caught, None, "顺风跑的横帆船不该被纵帆船追上");
    assert!(gave_up.is_some(), "海盗连续一整天看不见就放弃");
    // 横帆船改成横风（正东）走：被纵帆海盗追上
    let (caught, _) = chase("hauler", 90, "felucca", 0, 3, 8);
    assert!(caught.is_some(), "横风航行的横帆船跑不过纵帆船");
}

#[test]
fn far_pirates_and_disabled_rules_do_not_chase() {
    let mut raw = (*open_sea()).clone();
    raw.rules.pursuit.enabled = false;
    let d = Arc::new(raw);
    let w = World::new(d.clone(), ScenarioId(0), 3).unwrap();
    let fleet = w.fleets_of(OwnerId::Player).next().unwrap().clone();
    let points: Vec<_> = (0..=MINUTES_PER_DAY)
        .map(|m| super::CoursePoint { pos: SubCell::center(Cell::new(120, 100)), minute: m })
        .collect();
    assert!(w.pursuit_tracks(&fleet, &points, &BTreeSet::new()).is_empty(), "开关关着时没有按分钟追击");
    // 开着，但海盗在视野之外、一动不动的玩家也不会被发现
    let d = open_sea();
    let mut w = World::new(d.clone(), ScenarioId(0), 3).unwrap();
    let fleet = w.fleets_of(OwnerId::Player).next().unwrap().clone();
    w.state.battles.pirates.insert(
        7,
        PirateFleet {
            id: 7,
            region: RegionId(0),
            cell: Cell::new(120, 110),
            ships: vec![crate::fleet::new_ship(&d, ship_kind(&d, "hauler"))],
            crew: 30,
            until: 999,
            engaged: false,
        },
    );
    assert!(w.pursuit_tracks(&fleet, &points, &BTreeSet::new()).is_empty(), "十格外的海盗看不见你");
}
