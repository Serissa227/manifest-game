//! I3：真实应用时钟、查询投影、分钟交易边界与存档/重放。
use manifest_ai::MemoryKeyStore;
use manifest_app::{AppPaths, AppState, Locales, clock, handlers};
use manifest_core::navigation::{Sail, StopKind};
use manifest_core::*;
use serde_json::{Value, json};
use std::sync::{Arc, OnceLock};
const PLAYER: OwnerId = OwnerId::Player;

fn app(dir: &std::path::Path, kind: &str) -> (AppState, FleetId) {
    static SHARED: OnceLock<(Locales, Arc<manifest_data::AiContent>)> = OnceLock::new();
    let (locales, content) = SHARED.get_or_init(|| {
        let data = manifest_data::find_data_dir().unwrap();
        (Locales::load(&data).unwrap(), Arc::new(manifest_data::load_ai_content(&data).unwrap()))
    });
    let mut defs = (*testkit::tiny_defs()).clone();
    defs.manual_navigation = true;
    defs.map.terrain.fill(manifest_core::nav::Terrain::Deep);
    defs.map.region.fill(u16::MAX);
    defs.locations[0].cell = Cell::new(2, 15);
    defs.locations[1].cell = Cell::new(if matches!(kind, "sight" | "port") { 6 } else { 35 }, 15);
    defs.rules.explore.sight = if matches!(kind, "sight" | "ship") { 1 } else { 0 };
    defs.rules.pirates.spawn_scale = Fx::ZERO;
    defs.rules.disease_bp_per_30_days = 0;
    defs.scenarios[0].food = 40;
    defs.scenarios[0].water = 40;
    defs.ships[0].speed = Fx::from_int(120);
    if kind == "land" {
        let at = defs.map.idx(Cell::new(5, 15));
        defs.map.terrain[at] = manifest_core::nav::Terrain::Land;
    }
    if kind == "storm" {
        for x in 5..defs.map.width {
            let at = defs.map.idx(Cell::new(x, 15));
            defs.map.region[at] = 0;
        }
        for season in &mut defs.regions[0].seasons {
            season.storm_bp = 10_000;
        }
    }
    defs.nav = Arc::new(manifest_core::nav::NavTable::build(&defs.map, &defs.regions, defs.locations.len(), &[]));
    let defs = Arc::new(defs);
    let seed = if kind == "storm" {
        (0..1000)
            .find(|seed| {
                World::new(defs.clone(), ScenarioId(0), *seed)
                    .unwrap()
                    .weather_at(Cell::new(5, 15))
                    .is_some_and(|w| w.sky == manifest_core::weather::Sky::Storm)
            })
            .unwrap()
    } else {
        42
    };
    let mut locales = locales.clone();
    Arc::make_mut(&mut locales.zh).defs = defs.clone();
    Arc::make_mut(&mut locales.en).defs = defs.clone();
    let st = AppState::new(defs, content.clone(), locales, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(dir))
        .unwrap();
    let mut settings = handlers::get_settings(&st).settings;
    settings.language = Some(manifest_data::Locale::ZhCn);
    handlers::save_settings(&st, settings).unwrap();
    handlers::new_game(&st, "test", Some(seed)).unwrap();
    let id = st.game().unwrap().as_ref().unwrap().session.world.fleets_of(PLAYER).next().unwrap().id;
    handlers::submit(&st, Command::Depart { owner: PLAYER, fleet: id, minute: 120, heading: 90 }).unwrap();
    (st, id)
}

fn navigation(st: &AppState, id: FleetId) -> Value {
    handlers::pending::navigation(st, id.0).unwrap()
}

#[test]
fn nav_view_full_json_snapshot_and_reads_do_not_write_a_save() {
    let tmp = tempfile::tempdir().unwrap();
    let (st, id) = app(tmp.path(), "still");
    handlers::submit(
        &st,
        Command::Steer { owner: PLAYER, fleet: id, minute: 120, heading: None, sail: Some(Sail::Furled) },
    )
    .unwrap();
    let before = st.game().unwrap().as_ref().unwrap().session.to_save();
    let actual = navigation(&st, id);
    // 2026-11-11 合入后的统一验证：H03 看得见的海 / H04 海上所见给航行视图加了 sky（位置天况）、cells（天气团）、
    // ships（看得见的船）、fast（顺风的航向）、sightings（海上所见）五个键（navigation_view.rs）；
    // 这个夹具没有天气团、没有别的船、视野为 0，五个键都是空值。原有各键与值一个没变。
    // 再合入主线（H06 喊话、H07 航线规划、H08 航海日志与甲板闲话）后：航行视图只多了 H08 的 journal、banter 两个键
    // （voyage_view.rs；这个夹具里两者都是 null），H06 / H07 没有给航行视图加键；原有各键的值仍一个没变。
    // 2026-11-12 最后一轮全量：H01 岗位与效果加了 ship_sight（瞭望长算进去的船只视野格数，fleet_sight_cells；这个夹具视野为 0）；
    // 原有各键的值仍一个没变。
    assert_eq!(
        actual,
        json!({"fleet":id.0,"mode":"manual","day":0,"minute":120,"pos":{"x":2.5,"y":15.5},
        "heading":90,"sail":"furled","speed":0.0,"wind":{"dir":0,"force":0,"name":"风力 0"},"current":null,
        "sail_limit":50,"trail":[[2.5,15.5]],"forecast":[[2.5,15.5]],"stops":[],"supplies_days":40,
        "morale":100,"sight":0,"autopilot":null,"known_dests":[{"loc":0,"name":"alpha","days":1,"supplies_days":40}],"lat_lon":null,
        "sky":null,"cells":[],"ships":[],"fast":[],"sightings":null,"journal":null,"banter":null,"ship_sight":0,"delay":null})
    );
    handlers::overview(&st).unwrap();
    handlers::static_data(&st);
    handlers::fog(&st).unwrap();
    assert_eq!(before, st.game().unwrap().as_ref().unwrap().session.to_save());
}

/// 普通商船进入视野不暂停：航线上有一支商会的船迎面而来，
/// 航向预测里照旧记下这次相遇，时钟却一路走到下一个真正要停的地方。
#[test]
fn merchant_ships_coming_into_sight_do_not_pause_the_voyage() {
    use manifest_core::world::{FleetLocation, RouteVoyage, Voyage};
    let tmp = tempfile::tempdir().unwrap();
    let (st, id) = app(tmp.path(), "ship");
    let span = {
        let mut guard = st.game().unwrap();
        let world = &mut guard.as_mut().unwrap().session.world;
        world.state.explore.cells.fill(u64::MAX);
        let other = world.state.fleets.values().find(|f| f.owner != PLAYER).unwrap().id;
        world.fleet_mut(other).unwrap().location = FleetLocation::AtSea(Voyage::Route(RouteVoyage {
            dest: LocId(1),
            path: (7..=35).map(|x| Cell::new(x, 15)).collect(),
            step: 0,
            leg_progress: Fx::ZERO,
        }));
        let course = world.preview_course(id, &[], 120).unwrap();
        let contact = course.contacts.first().expect("航线上的商船必须被看见");
        let arrival = course.stops.iter().find(|s| s.kind == StopKind::Port).expect("测试航线要靠港").minute;
        assert!(!contact.pirate && contact.minute > 120 && contact.minute < arrival);
        // 走过看见商船的那一刻、停在靠港之前：靠港照旧要停，不在本测试里
        u32::from(contact.minute + arrival) / 2 - 120
    };
    handlers::set_speed(&st, 32).unwrap();
    let step = handlers::advance_clock(&st, span).unwrap().unwrap();
    let overview = serde_json::to_value(handlers::overview(&st).unwrap()).unwrap();
    assert_eq!(overview["speed"], 32, "看见商船不停：{}", overview["navigation_stop"]);
    assert!(overview["navigation_stop"].is_null());
    assert_eq!(clock::since_day_start(step.clock.minute), 120 + span);
}

#[test]
fn new_port_land_and_storm_pause_at_the_exact_predicted_minute_and_resume() {
    for (kind, stop_kind) in [("sight", "sight"), ("land", "land"), ("storm", "storm")] {
        let tmp = tempfile::tempdir().unwrap();
        let (st, id) = app(tmp.path(), kind);
        let view = navigation(&st, id);
        let predicted = view["stops"].as_array().unwrap().iter().find(|s| s["kind"] == stop_kind).unwrap();
        let minute = predicted["minute"].as_u64().unwrap() as u16;
        assert!(minute > 120 && minute < 1440, "{kind}: {predicted}");
        if kind == "sight" {
            assert!(predicted["loc"].is_null());
            assert!(!view["known_dests"].as_array().unwrap().iter().any(|d| d["loc"] == 1));
        }
        handlers::set_speed(&st, 32).unwrap();
        let step = handlers::advance_clock(&st, 5000).unwrap().unwrap();
        assert_eq!(clock::since_day_start(step.clock.minute), u32::from(minute));
        let overview = serde_json::to_value(handlers::overview(&st).unwrap()).unwrap();
        assert_eq!(overview["speed"], 0);
        assert_eq!(overview["navigation_stop"]["kind"], stop_kind);
        assert_eq!(overview["navigation_stop"]["minute"], minute);
        if kind == "sight" {
            assert!(overview["sighted"].as_array().unwrap().contains(&json!(1)));
            assert_eq!(overview["navigation_stop"]["loc"], 1);
        }
        let before = navigation(&st, id);
        handlers::save_game(&st, "pause").unwrap();
        handlers::load_game(&st, "pause").unwrap();
        assert_eq!(navigation(&st, id), before);
        handlers::set_speed(&st, 1).unwrap();
        handlers::advance_clock(&st, 1).unwrap();
        assert_eq!(clock::since_day_start(handlers::overview(&st).unwrap().minute), u32::from(minute) + 1);
    }
}

#[test]
fn frame_sizes_and_all_clock_speeds_reach_identical_positions_fog_and_pause() {
    let mut expected = None;
    for (speed, chunk) in [(1, 1), (2, 7), (4, 23), (8, 60), (16, 300), (32, 10_000)] {
        let tmp = tempfile::tempdir().unwrap();
        let (st, id) = app(tmp.path(), "land");
        handlers::set_speed(&st, speed).unwrap();
        for _ in 0..1440 {
            if handlers::overview(&st).unwrap().speed == 0 {
                break;
            }
            handlers::advance_clock(&st, chunk).unwrap();
        }
        let overview = serde_json::to_value(handlers::overview(&st).unwrap()).unwrap();
        assert_eq!(overview["speed"], 0);
        let actual = json!({"nav":navigation(&st,id),"pause":overview["navigation_stop"],"fleets":overview["fleets"],
            "sighted":overview["sighted"],"fog":handlers::fog(&st).unwrap()});
        if let Some(expected) = &expected {
            assert_eq!(&actual, expected, "speed {speed}, chunk {chunk}");
        } else {
            expected = Some(actual);
        }
    }
}

#[test]
fn predicted_arrival_never_allows_early_trade_and_actual_arrival_replays_once() {
    let tmp = tempfile::tempdir().unwrap();
    let (st, id) = app(tmp.path(), "port");
    let view = navigation(&st, id);
    let minute = view["stops"].as_array().unwrap().iter().find(|s| s["kind"] == "port").unwrap()["minute"]
        .as_u64()
        .unwrap() as u16;
    let mut settings = handlers::get_settings(&st).settings;
    settings.navigation_pause = false;
    handlers::save_settings(&st, settings).unwrap();
    handlers::set_speed(&st, 1).unwrap();
    handlers::advance_clock(&st, u32::from(minute - 121)).unwrap();
    let trade = || Command::Buy { owner: PLAYER, fleet: id, good: GoodId(0), qty: 1, max_total: None };
    let before = st.game().unwrap().as_ref().unwrap().session.to_save();
    assert!(handlers::submit(&st, trade()).is_err());
    assert_eq!(before, st.game().unwrap().as_ref().unwrap().session.to_save());
    handlers::advance_clock(&st, 1).unwrap();
    let overview = serde_json::to_value(handlers::overview(&st).unwrap()).unwrap();
    assert_eq!(overview["fleets"][0]["docked"], 1);
    handlers::submit(&st, trade()).unwrap();
    {
        let guard = st.game().unwrap();
        let game = guard.as_ref().unwrap();
        let entries = game.session.log();
        assert!(entries.last().unwrap().minute.is_some());
        assert_eq!(game.session.world.state, game.session.replay().unwrap().state);
        assert_eq!(
            game.session
                .world
                .state
                .log
                .iter()
                .filter(|e| matches!(e.kind,manifest_core::log::LogKind::Arrived {fleet,..} if fleet==id))
                .count(),
            1
        );
        let save = SaveFile::from_json(&game.session.to_save().to_json().unwrap()).unwrap();
        let loaded = manifest_sim::GameSession::from_save(game.session.defs().clone(), save).unwrap();
        assert_eq!(loaded.world.state, game.session.world.state);
    }
    let mut guard = st.game().unwrap();
    let game = guard.as_mut().unwrap();
    game.session.advance_day().unwrap();
    assert_eq!(
        game.session
            .world
            .state
            .log
            .iter()
            .filter(|e| matches!(e.kind,manifest_core::log::LogKind::Arrived {fleet,..} if fleet==id))
            .count(),
        1
    );
    assert_eq!(game.session.world.state, game.session.replay().unwrap().state);
}

#[test]
fn resuming_a_minute_arrival_without_a_command_does_not_pause_again_at_day_end() {
    let tmp = tempfile::tempdir().unwrap();
    let (st, id) = app(tmp.path(), "port");
    let view = navigation(&st, id);
    let minute = view["stops"].as_array().unwrap().iter().find(|s| s["kind"] == "port").unwrap()["minute"]
        .as_u64()
        .unwrap() as u16;
    handlers::set_speed(&st, 1).unwrap();
    handlers::advance_clock(&st, 1440).unwrap();
    let paused = serde_json::to_value(handlers::overview(&st).unwrap()).unwrap();
    assert_eq!(paused["navigation_stop"]["kind"], "port");
    assert_eq!(paused["navigation_stop"]["minute"], minute);
    // 11-03 在港暂停：旗舰队驶进锚地之后按开始时间也不走（旧行为：照常走到日结），日子要在旅店休息着过
    assert_eq!(handlers::set_speed(&st, 1).unwrap().speed, 0);
    assert_eq!(handlers::advance_clock(&st, u32::from(1440 - minute) + 1).unwrap(), None);
    let rested = handlers::step(&st, 1).unwrap();
    assert_eq!((rested.day, rested.speed), (1, 0));
    assert!(rested.navigation_stop.is_none(), "日结落实靠港，不再停一次");
    // 出港之后按 1× 继续，日初不再停
    handlers::submit(&st, Command::Depart { owner: PLAYER, fleet: id, minute: 0, heading: 270 }).unwrap();
    handlers::advance_clock(&st, 1).unwrap();
    let continued = handlers::overview(&st).unwrap();
    assert_eq!(continued.day, 1);
    assert_eq!(clock::since_day_start(continued.minute), 1);
}
