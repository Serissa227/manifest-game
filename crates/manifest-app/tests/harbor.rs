//! 在港暂停与三档倍速：
//! 手动航行的世界里旗舰队在港时按开始也不走、抵港那一分钟自动停（不论两项暂停设置）、出港后按最近一次选的倍速继续；
//! 只有别的舰队在海上时同样停着；旅店休息按天推进、遇到要玩家回应的事提前停下并说明原因；
//! 三档倍速与旧值归档；养成期与经典（非手动航行）世界不受影响；桌面后台线程在暂停时也会按停前的倍速自动继续。
use manifest_ai::{AiMode, MemoryKeyStore};
use manifest_app::settings::{
    AppSettings, ArrivalPause, FAST_SPEED, NORMAL_SPEED, SLOW_SPEED, SPEED_TIERS, nearest_tier,
};
use manifest_app::{AppPaths, AppState, Locales, clock, handlers};
use manifest_core::*;
use serde_json::{Value, json};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

const PLAYER: OwnerId = OwnerId::Player;

/// 手动航行的小世界：alpha（2,15）与 beta（6,15）在同一条东西向的深水航道上，旗舰队开局停在 alpha；没有海盗、疾病与视野。
/// `settings` 在开局之前改设置（开局时按设置里的默认速度定下“出港后的倍速”）。
fn manual(dir: &std::path::Path, settings: impl FnOnce(&mut AppSettings)) -> (AppState, FleetId) {
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
    defs.locations[1].cell = Cell::new(6, 15);
    defs.rules.explore.sight = 0;
    defs.rules.pirates.spawn_scale = Fx::ZERO;
    defs.rules.disease_bp_per_30_days = 0;
    defs.scenarios[0].food = 60;
    defs.scenarios[0].water = 60;
    defs.ships[0].speed = Fx::from_int(120);
    defs.nav = Arc::new(manifest_core::nav::NavTable::build(&defs.map, &defs.regions, defs.locations.len(), &[]));
    let defs = Arc::new(defs);
    let mut locales = locales.clone();
    Arc::make_mut(&mut locales.zh).defs = defs.clone();
    Arc::make_mut(&mut locales.en).defs = defs.clone();
    let st = AppState::new(defs, content.clone(), locales, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(dir))
        .unwrap();
    let mut s = handlers::get_settings(&st).settings;
    s.language = Some(manifest_data::Locale::ZhCn);
    s.ai.mode = AiMode::Off;
    s.autosave_days = 0;
    settings(&mut s);
    handlers::save_settings(&st, s).unwrap();
    handlers::new_game(&st, "test", Some(42)).unwrap();
    let id = st.game().unwrap().as_ref().unwrap().session.world.flagship(PLAYER).unwrap();
    (st, id)
}

fn overview_json(st: &AppState) -> Value {
    serde_json::to_value(handlers::overview(st).unwrap()).unwrap()
}

/// 当前时刻对应的航行分钟（游戏日从 6:00 起算）。
fn nav_minute(st: &AppState) -> u16 {
    clock::since_day_start(handlers::overview(st).unwrap().minute) as u16
}

fn depart(st: &AppState, fleet: FleetId, heading: u16) -> handlers::SubmitResult {
    let minute = nav_minute(st);
    handlers::submit(st, Command::Depart { owner: PLAYER, fleet, minute, heading }).unwrap()
}

/// 当天航迹里抵港的分钟。
fn port_minute(st: &AppState, fleet: FleetId) -> u16 {
    let view = handlers::pending::navigation(st, fleet.0).unwrap();
    view["stops"].as_array().unwrap().iter().find(|s| s["kind"] == "port").expect("航迹上有抵港")["minute"]
        .as_u64()
        .unwrap() as u16
}

#[test]
fn speed_tiers_are_slow_normal_fast_and_old_values_round_to_the_nearest() {
    assert_eq!(SPEED_TIERS, [2, 4, 8]);
    assert_eq!((SLOW_SPEED, NORMAL_SPEED, FAST_SPEED), (2, 4, 8));
    // 每天的实时：慢 2 秒、普通 1 秒、快 0.5 秒
    assert_eq!(SPEED_TIERS.map(|n| clock::BASE_DAY_MS / u64::from(n)), [2_000, 1_000, 500]);
    assert_eq!(AppSettings::default().speed, NORMAL_SPEED, "新的缺省为“普通”");
    for (old, tier) in [(0, 4), (1, 2), (2, 2), (3, 2), (4, 4), (8, 8), (16, 8), (32, 8), (255, 8)] {
        assert_eq!(nearest_tier(old), tier, "{old}×");
    }
    // 旧设置文件里的默认速度：读入时归到最近的一档；不合法的照旧回到缺省设置
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("settings.json");
    let mut v = serde_json::to_value(AppSettings::default()).unwrap();
    for (old, tier) in [(1, 2), (2, 2), (4, 4), (8, 8), (16, 8), (32, 8)] {
        v["speed"] = json!(old);
        std::fs::write(&file, v.to_string()).unwrap();
        assert_eq!(AppSettings::load(&file).speed, tier, "{old}×");
    }
    v["speed"] = json!(3);
    std::fs::write(&file, v.to_string()).unwrap();
    assert_eq!(AppSettings::load(&file), AppSettings::default());
    // 后端仍接受旧的倍速（旧存档、旧界面）
    let (st, _) = manual(tmp.path(), |_| {});
    let classic = classic(tmp.path());
    for n in [1u8, 2, 4, 8, 16, 32] {
        assert_eq!(handlers::set_speed(&classic, n).unwrap().speed, n);
    }
    assert!(handlers::set_speed(&st, 3).is_err());
}

/// 经典开局（航线航行的世界）：旗舰队停在港口时照常走，没有“在港中”。
fn classic(dir: &std::path::Path) -> AppState {
    let data = manifest_data::find_data_dir().unwrap();
    let st =
        AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(&dir.join("classic")))
            .unwrap();
    let mut s = handlers::get_settings(&st).settings;
    s.ai.mode = AiMode::Off;
    s.autosave_days = 0;
    handlers::save_settings(&st, s).unwrap();
    handlers::new_game(&st, "newcomer", Some(7)).unwrap();
    st
}

#[test]
fn the_clock_holds_while_the_flagship_is_docked_and_runs_once_it_departs() {
    let tmp = tempfile::tempdir().unwrap();
    let (st, id) = manual(tmp.path(), |_| {});
    let o = handlers::overview(&st).unwrap();
    let hold = o.port_hold.clone().expect("开局旗舰队停在港口：在港中");
    assert_eq!((hold.loc, hold.resume, o.speed), (0, NORMAL_SPEED, 0), "出港后缺省按“普通”");
    assert_eq!((o.day, o.minute), (0, clock::DEFAULT_MINUTE));

    // 按开始：不走、不报错，这一档留到出港
    let o = handlers::set_speed(&st, FAST_SPEED).unwrap();
    assert_eq!(o.speed, 0);
    assert_eq!(o.port_hold.as_ref().map(|h| h.resume), Some(FAST_SPEED));
    assert_eq!(handlers::current_speed(&st), 0);
    assert_eq!(handlers::advance_clock(&st, 600).unwrap(), None);
    assert!(!handlers::tick(&st).unwrap());
    // 后台时钟同样不走
    let mut ticker = manifest_app::Ticker::new(Instant::now());
    let now = Instant::now();
    for i in 1..=10 {
        ticker.step(&st, now + Duration::from_millis(50 * i));
    }
    let o = handlers::overview(&st).unwrap();
    assert_eq!((o.day, o.minute, o.speed), (0, clock::DEFAULT_MINUTE, 0));
    // 暂停键不改“出港后的倍速”
    assert_eq!(handlers::set_speed(&st, 0).unwrap().port_hold.map(|h| h.resume), Some(FAST_SPEED));

    // 出港
    let r = depart(&st, id, 90);
    assert!(r.overview.port_hold.is_none());
    assert!(overview_json(&st).get("port_hold").is_none(), "不在港时概览里没有 port_hold");
    let s = handlers::advance_clock(&st, 10).unwrap().expect("出港后时钟走");
    assert_eq!(s.clock.minute, clock::DEFAULT_MINUTE + 10);
    // 海上玩家自己按暂停照常停下、再按开始照常走
    assert_eq!(handlers::set_speed(&st, 0).unwrap().speed, 0);
    assert_eq!(handlers::set_speed(&st, SLOW_SPEED).unwrap().speed, SLOW_SPEED);
}

#[test]
fn arrival_pauses_at_the_exact_minute_whatever_the_settings_and_departure_resumes() {
    for (arrival, navigation) in
        [(ArrivalPause::Off, false), (ArrivalPause::Flagship, true), (ArrivalPause::Any, false)]
    {
        let tmp = tempfile::tempdir().unwrap();
        let (st, id) = manual(tmp.path(), |s| {
            s.arrival_pause = arrival;
            s.navigation_pause = navigation;
            // 旧设置写下的 16×：开局时归到“快”
            s.speed = 16;
        });
        assert_eq!(handlers::overview(&st).unwrap().port_hold.map(|h| h.resume), Some(FAST_SPEED));
        handlers::set_speed(&st, SLOW_SPEED).unwrap();
        depart(&st, id, 90);
        let minute = port_minute(&st, id);
        assert!(minute > 120 && minute < 1440, "{minute}");
        // 一步走很远：停在抵港的那一分钟，剩下的分钟作废
        let step = handlers::advance_clock(&st, 5_000).unwrap().unwrap();
        assert_eq!(clock::since_day_start(step.clock.minute), u32::from(minute), "{arrival:?} {navigation}");
        let o = overview_json(&st);
        assert_eq!(o["speed"], 0);
        assert_eq!(o["navigation_stop"]["kind"], "port");
        assert_eq!(o["navigation_stop"]["minute"], minute);
        assert_eq!(o["port_hold"]["loc"], 1, "驶进锚地就算在港");

        // 在港按开始：不走（抵港暂停之后不会因为按了开始就接着往下走）
        let held = handlers::set_speed(&st, NORMAL_SPEED).unwrap();
        assert_eq!(held.speed, 0);
        assert_eq!(handlers::advance_clock(&st, 100).unwrap(), None);
        assert_eq!(nav_minute(&st), minute);
        // 存档读档之后仍在港
        handlers::save_game(&st, "port").unwrap();
        let loaded = handlers::load_game(&st, "port").unwrap();
        assert_eq!(loaded.port_hold.as_ref().map(|h| h.loc), Some(1));
        let sea_speed = loaded.port_hold.as_ref().unwrap().resume;
        handlers::set_speed(&st, NORMAL_SPEED).unwrap();
        assert_eq!(handlers::current_speed(&st), 0);

        // 再出港（向西回 alpha）：时钟继续
        let r = depart(&st, id, 270);
        assert!(r.overview.port_hold.is_none());
        assert!(r.overview.sea_clock);
        assert_eq!(r.overview.speed, sea_speed, "读档初始化的海上档不随随后选择的港内档改变");
        handlers::advance_clock(&st, 1).unwrap().unwrap();
        assert_eq!(nav_minute(&st), minute + 1);
    }
}

#[test]
fn other_fleets_at_sea_do_not_run_the_clock_while_the_flagship_is_docked() {
    let tmp = tempfile::tempdir().unwrap();
    let (st, id) = manual(tmp.path(), |_| {});
    // 再来一支玩家舰队（编号更大：旗舰队仍是开局那支），让它出港
    let other = {
        let mut guard = st.game().unwrap();
        let world = &mut guard.as_mut().unwrap().session.world;
        let mut fleet = world.fleet(id).unwrap().clone();
        fleet.id = FleetId(id.0 + 40);
        let other = fleet.id;
        world.state.fleets.insert(other, fleet);
        assert_eq!(world.flagship(PLAYER), Some(id));
        other
    };
    let r = depart(&st, other, 90);
    assert_eq!(r.overview.speed, 0, "别的舰队出港不让时钟走");
    assert!(r.overview.port_hold.is_some());
    assert_eq!(handlers::set_speed(&st, NORMAL_SPEED).unwrap().speed, 0);
    assert_eq!(handlers::advance_clock(&st, 300).unwrap(), None);
    // 旗舰队出港后才走
    assert_eq!(depart(&st, id, 90).overview.speed, NORMAL_SPEED);
    assert!(handlers::advance_clock(&st, 5).unwrap().is_some());
}

#[test]
fn resting_at_the_inn_passes_days() {
    let tmp = tempfile::tempdir().unwrap();
    let (st, _) = manual(tmp.path(), |_| {});
    handlers::set_speed(&st, FAST_SPEED).unwrap();
    // 休息 3 天：按天结算，停在第 3 天之后的 6:00，仍在港、仍暂停
    let o = handlers::step(&st, 3).unwrap();
    assert_eq!((o.day, o.minute, o.speed), (3, clock::DAY_START_MINUTE, 0));
    assert!(o.awaiting.is_none());
    let hold = o.port_hold.clone().expect("休息完仍在港");
    assert_eq!((hold.loc, hold.resume), (0, FAST_SPEED));
    // 住到下月初：正好过到下个月的 1 日
    let month = o.month;
    let o = handlers::step(&st, hold.month_days).unwrap();
    assert_eq!(o.date, 1, "住到下月初");
    assert_ne!(o.month, month);
    assert_eq!(o.port_hold.as_ref().map(|h| h.month_days), Some(st.defs().calendar.month_days(o.day)));
}

/// 因为有事要回应而自动停下（resume_speed）、回应完时旗舰队在港：不继续。
#[test]
fn auto_resume_waits_for_departure_while_in_port() {
    let tmp = tempfile::tempdir().unwrap();
    let (st, _) = manual(tmp.path(), |_| {});
    {
        let mut guard = st.game().unwrap();
        let g = guard.as_mut().unwrap();
        g.resume_speed = Some(SLOW_SPEED);
    }
    assert!(!handlers::auto_resume(&st));
    assert_eq!(handlers::current_speed(&st), 0);
    let o = handlers::overview(&st).unwrap();
    assert_eq!(o.port_hold.map(|h| h.resume), Some(SLOW_SPEED));
    assert!(st.game().unwrap().as_ref().unwrap().resume_speed.is_none());
}

/// 经典（航线航行）世界：停在港口照常走，概览里没有 port_hold；抵港暂停照旧按设置。
#[test]
fn classic_worlds_keep_running_in_port() {
    let tmp = tempfile::tempdir().unwrap();
    let st = classic(tmp.path());
    let o = handlers::overview(&st).unwrap();
    assert!(o.fleets[0].docked.is_some(), "开局停在港口");
    assert!(o.port_hold.is_none());
    assert!(overview_json(&st).get("port_hold").is_none());
    assert_eq!(handlers::set_speed(&st, NORMAL_SPEED).unwrap().speed, NORMAL_SPEED);
    let s = handlers::advance_clock(&st, 120).unwrap().expect("经典世界在港照常走");
    assert_eq!(s.clock.minute, clock::DEFAULT_MINUTE + 120);
    assert!(handlers::tick(&st).unwrap());
}

/// 养成期（这里把框架测试海域的养成开局改成手动航行）：没有“在港中”，倍速与月计划快进照旧。
#[test]
fn upbringing_is_not_held() {
    let tmp = tempfile::tempdir().unwrap();
    let data = manifest_data::find_data_dir().unwrap();
    let st = AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(tmp.path())).unwrap();
    let request = serde_json::from_value(json!({"world":"testbed","scenario":"upbringing","seed":42})).unwrap();
    handlers::new_world_game(&st, request).unwrap();
    {
        let mut guard = st.game().unwrap();
        let world = &mut guard.as_mut().unwrap().session.world;
        let mut defs = (*world.defs).clone();
        defs.manual_navigation = true;
        world.defs = Arc::new(defs);
        assert!(world.upbringing_active());
    }
    assert!(handlers::overview(&st).unwrap().port_hold.is_none());
    let slots = handlers::pending::auto_plan(&st, "balanced".into()).unwrap()["slots"].clone();
    let command: Command = serde_json::from_value(json!({"PlanMonth":{"owner":"player","slots":slots}})).unwrap();
    handlers::submit(&st, command).unwrap();
    assert_eq!(handlers::set_speed(&st, SLOW_SPEED).unwrap().speed, SLOW_SPEED);
    assert!(handlers::upbringing_turbo(&st).is_some(), "月计划照常快进");
    assert!(handlers::overview(&st).unwrap().port_hold.is_none());
}

/// 桌面的后台线程：因为有事要回应而自动停下的，暂停时也会看一眼，回应完按停前的倍速继续（与网页服务端一致）。
#[test]
fn the_desktop_ticker_resumes_after_the_player_answers() {
    let tmp = tempfile::tempdir().unwrap();
    let st = classic(tmp.path());
    {
        let mut guard = st.game().unwrap();
        let g = guard.as_mut().unwrap();
        g.speed = 0;
        g.resume_speed = Some(NORMAL_SPEED);
    }
    manifest_app::spawn_ticker(st.clone());
    let deadline = Instant::now() + Duration::from_secs(5);
    while handlers::current_speed(&st) == 0 {
        assert!(Instant::now() < deadline, "暂停中的后台线程应按停前的倍速自动继续");
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(handlers::current_speed(&st), NORMAL_SPEED);
    handlers::set_speed(&st, 0).unwrap();
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(handlers::current_speed(&st), 0, "玩家自己暂停的不自动继续");
}
