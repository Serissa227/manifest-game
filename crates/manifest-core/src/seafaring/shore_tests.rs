//! H05 岸与锚地：各差事的产出与地貌条件、营地的天数与锁定、召回、风险、避风、下网与接雨水、开关与存档。
use super::*;
use crate::geo::RiverDef;
use crate::navigation::ManualVoyage;
use crate::rng::{Domain, Rng};
use crate::seafaring::WearRules;
use crate::weather::DayTable;
use crate::{Command, Fx, ScenarioId, testkit};
use std::sync::Arc;

/// 锚地（10, 10）是海，正南（10, 11）是一格陆。
const SEA: Cell = Cell { x: 10, y: 10 };
const LAND: Cell = Cell { x: 10, y: 11 };

struct Setup {
    shore: bool,
    wear: bool,
    biome: Option<Biome>,
    /// 粗河流离锚地几格（None：没有河）
    river: Option<u16>,
    fine_river: bool,
    risk_bp: i64,
    /// 按人日累计粮水（寰宇的做法，每格 50 人日）
    fractional: bool,
}

impl Default for Setup {
    fn default() -> Self {
        Self {
            shore: true,
            wear: true,
            biome: Some(Biome::Rainforest),
            river: None,
            fine_river: false,
            risk_bp: 0,
            fractional: false,
        }
    }
}

fn world_with(s: Setup) -> (World, FleetId) {
    let mut defs = (*testkit::tiny_defs()).clone();
    defs.manual_navigation = true;
    defs.map.terrain.fill(Terrain::Deep);
    defs.map.region.fill(u16::MAX);
    defs.locations[0].cell = Cell::new(2, 15);
    defs.locations[1].cell = Cell::new(35, 15);
    defs.rules.explore.sight = 0;
    defs.rules.pirates.spawn_scale = Fx::ZERO;
    defs.rules.disease_bp_per_30_days = 0;
    defs.navigation.caravan_sight = 0;
    if s.fractional {
        defs.rules.fractional_supplies = true;
        defs.rules.crew_per_supply_unit = 50;
    }
    defs.rules.shore_tasks = ShoreRules { enabled: s.shore, risk_bp: s.risk_bp, ..Default::default() };
    defs.rules.voyage_wear = WearRules { enabled: s.wear, ..Default::default() };
    let land = defs.map.idx(LAND);
    defs.map.terrain[land] = Terrain::Land;
    let n = defs.map.terrain.len();
    if let Some(b) = s.biome {
        defs.geography.biomes = vec![None; n];
        defs.geography.biomes[land] = Some(b);
    }
    if let Some(d) = s.river {
        defs.geography.rivers = vec![RiverDef {
            key: "brook".into(),
            name: "小河".into(),
            path: vec![Cell::new(10 + d, 11), Cell::new(10 + d, 12)],
            width: 1,
        }];
    }
    if s.fine_river {
        defs.geography.fine_rivers = vec![defs.map.idx(Cell::new(11, 12)) as u32];
    }
    defs.nav = Arc::new(crate::nav::NavTable::build(&defs.map, &defs.regions, defs.locations.len(), &[]));
    let mut w = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
    let id = w.flagship(OwnerId::Player).unwrap();
    let mut manual = ManualVoyage::new(SEA, 90);
    manual.sail = Sail::Furled;
    let f = w.fleet_mut(id).unwrap();
    f.location = FleetLocation::AtSea(Voyage::Manual { manual });
    f.crew = f.crew.max(40);
    f.food = 100;
    f.water = 20;
    f.morale = 100;
    f.cargo.clear();
    // 舱位放宽，免得汲水、采集互相挤占空舱让预计所得与交付对不上
    for s in f.ships.iter_mut() {
        s.capacity = 10_000;
    }
    (w, id)
}

fn option(w: &World, id: FleetId, task: ShoreTask) -> ShoreOption {
    w.shore_options(id).into_iter().find(|o| o.task == task).unwrap()
}

fn start(w: &mut World, id: FleetId, tasks: &[ShoreTask]) -> Result<(), CommandError> {
    Command::Shore { owner: OwnerId::Player, fleet: id, order: ShoreOrder::Start { tasks: tasks.to_vec() } }
        .apply(w)
        .map(|_| ())
}

fn crew(w: &World, id: FleetId) -> i64 {
    w.fleet(id).unwrap().crew
}

#[test]
fn switch_off_means_no_shore_tasks_and_no_state() {
    let (mut w, id) = world_with(Setup { shore: false, ..Default::default() });
    assert!(w.shore_options(id).is_empty());
    assert!(start(&mut w, id, &[ShoreTask::Water]).is_err());
    assert!(
        Command::Shore { owner: OwnerId::Player, fleet: id, order: ShoreOrder::Nets { on: true } }
            .apply(&mut w)
            .is_err()
    );
    let food = w.fleet(id).unwrap().food;
    for _ in 0..3 {
        w.end_day().unwrap();
    }
    assert!(w.state.shore.is_empty());
    assert!(!serde_json::to_string(&w.state).unwrap().contains("\"shore\""));
    assert!(w.fleet(id).unwrap().food < food, "开关关着时没有渔获，只有日耗");
    assert_eq!(w.shelter_keep(id, None), 100);
}

#[test]
fn forage_follows_the_biome() {
    let days = ShoreRules::default().forage_days;
    for (biome, tenths) in [(Biome::Rainforest, 30), (Biome::Grassland, 20), (Biome::Tundra, 10)] {
        let (w, id) = world_with(Setup { biome: Some(biome), ..Default::default() });
        let o = option(&w, id, ShoreTask::Forage);
        let want = crate::fleet::supplies_for_days(&w.defs, crew(&w, id), tenths * days) / 10;
        assert_eq!((o.block, o.days, o.gain), (None, days, want), "{biome:?}");
        assert!(o.gain > 0);
    }
    for biome in [Biome::Desert, Biome::IceSheet] {
        let (w, id) = world_with(Setup { biome: Some(biome), ..Default::default() });
        assert_eq!(option(&w, id, ShoreTask::Forage).block, Some(ShoreBlock::NoForage), "{biome:?}");
    }
    // 没有地貌数据：写“地貌不明”
    let (w, id) = world_with(Setup { biome: None, ..Default::default() });
    assert_eq!(option(&w, id, ShoreTask::Forage).block, Some(ShoreBlock::Unknown));
}

#[test]
fn timber_needs_a_forest_and_the_wear_rules() {
    let (w, id) = world_with(Setup { biome: Some(Biome::Boreal), ..Default::default() });
    let ships = w.fleet(id).unwrap().ships.len() as i64;
    let o = option(&w, id, ShoreTask::Timber);
    assert_eq!((o.block, o.days), (None, 3));
    assert_eq!(o.gain, (3 * 3 * ships).min(w.timber_cap(id)));
    for biome in [Biome::Grassland, Biome::Desert, Biome::Tundra] {
        let (w, id) = world_with(Setup { biome: Some(biome), ..Default::default() });
        assert_eq!(option(&w, id, ShoreTask::Timber).block, Some(ShoreBlock::NoForest), "{biome:?}");
    }
    let (w, id) = world_with(Setup { wear: false, ..Default::default() });
    assert_eq!(option(&w, id, ShoreTask::Timber).block, Some(ShoreBlock::NoWear));
    assert_eq!(option(&w, id, ShoreTask::Careen).block, Some(ShoreBlock::NoWear));
}

#[test]
fn water_needs_a_river_or_a_spring() {
    let fill = |w: &World, id: FleetId| {
        let f = w.fleet(id).unwrap();
        crate::fleet::supplies_for_days(&w.defs, f.crew, 60) - f.water
    };
    // 荒漠、没有河：汲不到
    let (w, id) = world_with(Setup { biome: Some(Biome::Desert), ..Default::default() });
    assert_eq!(option(&w, id, ShoreTask::Water).block, Some(ShoreBlock::NoFreshWater));
    // 荒漠、两格内有粗河流：一天
    let (w, id) = world_with(Setup { biome: Some(Biome::Desert), river: Some(2), ..Default::default() });
    let o = option(&w, id, ShoreTask::Water);
    assert_eq!((o.block, o.days, o.gain), (None, 1, fill(&w, id)));
    // 河在三格外：不算
    let (w, id) = world_with(Setup { biome: Some(Biome::Desert), river: Some(3), ..Default::default() });
    assert_eq!(option(&w, id, ShoreTask::Water).block, Some(ShoreBlock::NoFreshWater));
    // 细河流
    let (w, id) = world_with(Setup { biome: Some(Biome::IceSheet), fine_river: true, ..Default::default() });
    assert_eq!(option(&w, id, ShoreTask::Water).days, 1);
    assert_eq!(option(&w, id, ShoreTask::Water).block, None);
    // 没有河、地貌有水源：两天
    let (w, id) = world_with(Setup { biome: Some(Biome::Grassland), ..Default::default() });
    let o = option(&w, id, ShoreTask::Water);
    assert_eq!((o.block, o.days), (None, 2));
}

#[test]
fn away_from_the_coast_everything_is_greyed() {
    let (mut w, id) = world_with(Setup::default());
    if let FleetLocation::AtSea(Voyage::Manual { manual }) = &mut w.fleet_mut(id).unwrap().location {
        manual.pos = crate::navigation::SubCell::center(Cell::new(10, 5));
    }
    assert!(w.shore_options(id).iter().all(|o| o.block == Some(ShoreBlock::NoCoast)));
    assert!(start(&mut w, id, &[ShoreTask::Water]).is_err());
}

#[test]
fn camp_delivers_each_task_on_its_day_and_holds_the_fleet() {
    let (mut w, id) = world_with(Setup { river: Some(1), ..Default::default() });
    let water = option(&w, id, ShoreTask::Water);
    let forage = option(&w, id, ShoreTask::Forage);
    let mut wear = w.fleet_wear(id);
    wear.fresh_days = 25;
    w.wear_store(id, wear);
    start(&mut w, id, &[ShoreTask::Forage, ShoreTask::Water]).unwrap();
    assert!(start(&mut w, id, &[ShoreTask::Water]).is_err(), "营地还在");
    // 差事期间不能起航
    let steer =
        Command::Steer { owner: OwnerId::Player, fleet: id, minute: 0, heading: Some(0), sail: Some(Sail::Full) };
    assert!(steer.apply(&mut w).is_err());
    let anchor = w.fleet(id).unwrap().location.clone();
    let need = crate::fleet::daily_supply_need(&w.defs, crew(&w, id));
    let water0 = w.fleet(id).unwrap().water;
    let food0 = w.fleet(id).unwrap().food;
    w.end_day().unwrap();
    // 第一天：水补满到 60 天份（交付在日耗之后，所以日耗那份也补回来了）
    assert_eq!(w.fleet(id).unwrap().water, water0 + water.gain);
    assert!(w.state.shore.camps.contains_key(&id));
    w.end_day().unwrap();
    assert!(!w.state.shore.camps.contains_key(&id), "两件都做完就拔锚");
    assert_eq!(w.fleet(id).unwrap().food, food0 - 2 * need + forage.gain);
    assert_eq!(w.fleet_wear(id).fresh_days, 0, "采集狩猎吃到鲜食");
    assert_eq!(w.fleet(id).unwrap().location, anchor);
    let done: Vec<_> = w
        .state
        .log
        .iter()
        .filter_map(|e| match e.kind {
            LogKind::ShoreDone { fleet, task, gain, .. } if fleet == id => Some((task, gain)),
            _ => None,
        })
        .collect();
    // 日志记的是实际交付：水按当时缺多少补（比派出时多了一天的日耗）
    assert_eq!(done, vec![(ShoreTask::Water, water.gain + need), (ShoreTask::Forage, forage.gain)]);
    assert!(w.state.log.iter().any(|e| matches!(e.kind, LogKind::ShoreStarted { tasks: 2, days: 2, .. })));
    // 拔锚之后可以起航
    steer.apply(&mut w).unwrap();
}

#[test]
fn careen_takes_five_days_and_clears_the_fouling() {
    let (mut w, id) = world_with(Setup::default());
    let mut wear = w.fleet_wear(id);
    wear.fouling = 40 * crate::seafaring::wear::POINT;
    w.wear_store(id, wear);
    let o = option(&w, id, ShoreTask::Careen);
    assert_eq!((o.block, o.days, o.gain), (None, 5, 40));
    w.fleet_mut(id).unwrap().food = 1_000;
    w.fleet_mut(id).unwrap().water = 1_000;
    start(&mut w, id, &[ShoreTask::Careen]).unwrap();
    for day in 1..=5 {
        w.end_day().unwrap();
        assert_eq!(w.state.shore.camps.contains_key(&id), day < 5, "第 {day} 天");
    }
    assert_eq!(w.fleet_wear(id).fouling, 0);
    // 冰原或高崖：没有滩
    let (mut w, id) = world_with(Setup { biome: Some(Biome::IceSheet), ..Default::default() });
    let mut wear = w.fleet_wear(id);
    wear.fouling = 10 * crate::seafaring::wear::POINT;
    w.wear_store(id, wear);
    assert_eq!(option(&w, id, ShoreTask::Careen).block, Some(ShoreBlock::NoBeach));
}

#[test]
fn hands_add_up_and_recall_gives_nothing_unfinished() {
    let (mut w, id) = world_with(Setup { biome: Some(Biome::Broadleaf), ..Default::default() });
    let mut wear = w.fleet_wear(id);
    wear.fouling = 30 * crate::seafaring::wear::POINT;
    wear.sick = crew(&w, id) - 4;
    w.wear_store(id, wear);
    // 能干活的只剩 4 人：倾船刮底要 2 人起，伐木、采集各 2 人起，三件加起来不够
    assert!(start(&mut w, id, &[ShoreTask::Careen, ShoreTask::Timber, ShoreTask::Forage]).is_err());
    let mut wear = w.fleet_wear(id);
    wear.sick = 0;
    w.wear_store(id, wear);
    let timber0 = w.fleet_wear(id).timber;
    start(&mut w, id, &[ShoreTask::Timber, ShoreTask::Careen]).unwrap();
    w.end_day().unwrap();
    Command::Shore { owner: OwnerId::Player, fleet: id, order: ShoreOrder::Recall }.apply(&mut w).unwrap();
    assert!(w.state.shore.camps.is_empty());
    w.end_day().unwrap();
    w.end_day().unwrap();
    assert_eq!(w.fleet_wear(id).timber, timber0, "没做完的伐木不给船材");
    assert!(w.fleet_wear(id).fouling > 0);
}

#[test]
fn foraging_mishaps_use_the_landing_injuries() {
    let (mut w, id) = world_with(Setup { risk_bp: 10_000, ..Default::default() });
    let crew0 = crew(&w, id);
    start(&mut w, id, &[ShoreTask::Forage]).unwrap();
    w.end_day().unwrap();
    w.end_day().unwrap();
    let risks: Vec<_> = w
        .state
        .log
        .iter()
        .filter_map(|e| match e.kind {
            LogKind::LandingRisk { fleet, risk, .. } if fleet == id => Some(risk),
            _ => None,
        })
        .collect();
    assert_eq!(risks.len(), 2, "两个工作日各出一次事");
    let injuries = risks.iter().filter(|r| **r == LandingRisk::Injury).count() as i64;
    assert!(crew(&w, id) <= crew0 - injuries);
    // 汲水没有风险
    let (mut w, id) = world_with(Setup { risk_bp: 10_000, river: Some(1), ..Default::default() });
    start(&mut w, id, &[ShoreTask::Water]).unwrap();
    w.end_day().unwrap();
    assert!(!w.state.log.iter().any(|e| matches!(e.kind, LogKind::LandingRisk { .. })));
}

fn storm(wind_dir: u8) -> DayWeather {
    DayWeather {
        region: crate::RegionId(0),
        day: 0,
        sky: Sky::Storm,
        storm_hit_e8: crate::weather::E8,
        sea: crate::defs::SeasonWeather {
            wind_dir,
            wind_strength: 9,
            current_dir: 0,
            current_strength: 0,
            storm_bp: 0,
            pirate_bp: 0,
        },
    }
}

#[test]
fn shelter_only_on_the_lee_side_at_anchor() {
    let (mut w, id) = world_with(Setup::default());
    // 陆地在正南（下标 4）。风吹向正北（0）＝从南边吹来：锚地在陆地的下风，避风
    assert!(w.sheltered(SEA, 0));
    assert!(w.sheltered(SEA, 1) && w.sheltered(SEA, 7), "左右 45° 也算");
    assert!(!w.sheltered(SEA, 4), "风从北边吹向陆地：锚地在上风，不避风");
    assert!(!w.sheltered(SEA, 2));
    assert_eq!(w.shelter_keep(id, Some(&storm(0))), 30);
    assert_eq!(w.shelter_keep(id, Some(&storm(4))), 100);
    // 没收帆不算锚泊
    if let FleetLocation::AtSea(Voyage::Manual { manual }) = &mut w.fleet_mut(id).unwrap().location {
        manual.sail = Sail::Half;
    }
    assert_eq!(w.shelter_keep(id, Some(&storm(0))), 100);
    assert_eq!(sheltered_damage(57, 30), 17);
    assert_eq!(sheltered_damage(57, 100), 57);
}

#[test]
fn storm_at_a_sheltered_anchor_does_three_tenths_of_the_damage() {
    // 有海区才有天气：恢复测试地图的海区，读出锚地当天的风向，把陆放到上风一侧
    let run = |furled: bool| {
        let (w0, id) = world_with(Setup { wear: false, ..Default::default() });
        let mut defs = (*w0.defs).clone();
        let fresh = testkit::tiny_defs();
        defs.map.region = fresh.map.region.clone();
        for (i, t) in defs.map.terrain.iter().enumerate() {
            if *t == Terrain::Land {
                defs.map.region[i] = u16::MAX;
            }
        }
        let defs = Arc::new(defs);
        let mut w = World::from_snapshot(defs.clone(), w0.state.clone()).unwrap();
        let wind = w.weather_at_pos(SEA).expect("锚地有天气").sea.wind_dir;
        let mut defs = (*defs).clone();
        let land = defs.map.idx(LAND);
        defs.map.terrain[land] = Terrain::Deep;
        defs.map.region[land] = 0;
        let upwind = defs.map.topology().neighbor(SEA, (wind + 4) % 8).unwrap();
        let i = defs.map.idx(upwind);
        defs.map.terrain[i] = Terrain::Land;
        defs.map.region[i] = u16::MAX;
        w = World::from_snapshot(Arc::new(defs), w.state.clone()).unwrap();
        if let FleetLocation::AtSea(Voyage::Manual { manual }) = &mut w.fleet_mut(id).unwrap().location {
            manual.sail = if furled { Sail::Furled } else { Sail::Full };
        }
        let before: Vec<i64> = w.fleet(id).unwrap().ships.iter().map(|s| s.durability).collect();
        let mut today = DayTable::new(&w);
        let mut rng = Rng::derive(w.state.seed, w.state.day, Domain::Voyage, u64::from(id.0), 0);
        w.sea_day(id, &mut rng, &mut today, Some(crate::weather::E8)).unwrap();
        let after: Vec<i64> = w.fleet(id).unwrap().ships.iter().map(|s| s.durability).collect();
        before.iter().zip(&after).map(|(b, a)| b - a).collect::<Vec<i64>>()
    };
    let open = run(false);
    let lee = run(true);
    assert!(open.iter().all(|d| *d > 0), "满帆在风暴里受损：{open:?}");
    let want: Vec<i64> = open.iter().map(|d| mul_div(*d, 30, 100)).collect();
    assert_eq!(lee, want);
}

#[test]
fn nets_feed_the_crew_and_keep_the_fresh_count_and_rain_fills_casks() {
    // 寰宇按人日累计粮水：40 人一天吃 40 人日，下网（温和海区 0.4 天）捞回 16 人日
    let (mut w, id) = world_with(Setup { fractional: true, ..Default::default() });
    let per = w.defs.rules.crew_per_supply_unit;
    let stock = |w: &World, water: bool| {
        let f = w.fleet(id).unwrap();
        if water { f.water * per - f.supply_remainder.water } else { f.food * per - f.supply_remainder.food }
    };
    Command::Shore { owner: OwnerId::Player, fleet: id, order: ShoreOrder::Nets { on: true } }.apply(&mut w).unwrap();
    assert!(w.nets_working(id), "收帆时网能用");
    assert_eq!(w.fish_tenths(id), 4);
    let crew = crew(&w, id);
    let food0 = stock(&w, false);
    let fresh0 = w.fleet_wear(id).fresh_days;
    let mut today = DayTable::new(&w);
    let mut rng = Rng::derive(w.state.seed, w.state.day, Domain::Voyage, u64::from(id.0), 0);
    w.sea_day(id, &mut rng, &mut today, None).unwrap();
    assert_eq!(stock(&w, false), food0 - crew + crew * 4 / 10);
    assert_eq!(w.fleet_wear(id).fresh_days, fresh0, "吃到鲜鱼，断鲜天数不涨");
    // 满帆收不了网
    if let FleetLocation::AtSea(Voyage::Manual { manual }) = &mut w.fleet_mut(id).unwrap().location {
        manual.sail = Sail::Full;
    }
    assert!(!w.nets_working(id));
    let food1 = stock(&w, false);
    let mut today = DayTable::new(&w);
    w.sea_day(id, &mut rng, &mut today, None).unwrap();
    assert_eq!(stock(&w, false), food1 - crew);
    assert_eq!(w.fleet_wear(id).fresh_days, fresh0 + 1);
    // 下雨：每天 +0.5 天份的水；晴天不接
    let water0 = stock(&w, true);
    let mut rain = storm(0);
    rain.sky = Sky::Rain;
    w.shore_sea_day(id, Some(&rain)).unwrap();
    assert_eq!(stock(&w, true), water0 + crew / 2);
    let mut clear = rain;
    clear.sky = Sky::Clear;
    w.shore_sea_day(id, Some(&clear)).unwrap();
    assert_eq!(stock(&w, true), water0 + crew / 2);
    // 舱满了就添不进去
    let f = w.fleet_mut(id).unwrap();
    let cap = f.capacity();
    f.food = cap - f.water;
    let units = w.fleet(id).unwrap().water;
    w.shore_sea_day(id, Some(&rain)).unwrap();
    assert_eq!(w.fleet(id).unwrap().water, units, "舱满：只补已经打开的那一格，不多占舱");
    assert!(stock(&w, true) <= units * per);
    assert_eq!(w.fleet(id).unwrap().free_capacity(), 0);
}
#[test]
fn camps_round_trip_through_the_save_and_bad_ones_are_rejected() {
    let (mut w, id) = world_with(Setup::default());
    start(&mut w, id, &[ShoreTask::Forage]).unwrap();
    w.end_day().unwrap();
    let text = serde_json::to_string(&w.state).unwrap();
    assert!(text.contains("\"shore\""));
    let back = World::from_snapshot(w.defs.clone(), serde_json::from_str(&text).unwrap()).unwrap();
    assert_eq!(back.state.shore, w.state.shore);
    let mut broken = w.state.clone();
    broken.shore.camps.get_mut(&id).unwrap().elapsed = 9;
    assert!(World::from_snapshot(w.defs.clone(), broken).is_err());
    let mut docked = w.state.clone();
    docked.fleets.get_mut(&id).unwrap().location = FleetLocation::Docked(crate::LocId(0));
    assert!(World::from_snapshot(w.defs.clone(), docked).is_err());
}
