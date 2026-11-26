//! 24 小时时钟与新速度（EXPANSION.md §9.2）：按分钟推进、走到 6:00 时结算一天、遇海战暂停停在 6:00、
//! “下一天”推进到 6:00、新游戏与旧存档从 8:00 开始、时刻随存档往返且不影响世界哈希、速度集合 [1, 2, 4, 8, 16, 32]、
//! 后台线程按实时推进并节流推送 `clock` 事件。

use manifest_ai::{AiMode, MemoryKeyStore};
use manifest_app::clock::{DAY_START_MINUTE, DEFAULT_MINUTE};
use manifest_app::handlers;
use manifest_app::settings::{AppSettings, ArrivalPause, SPEEDS};
use manifest_app::views::CaptainView;
use manifest_app::{AppPaths, AppState};
use manifest_core::Command;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn app(dir: &Path, autosave_days: u32) -> AppState {
    let data = manifest_data::find_data_dir().expect("找到 data/");
    let st = AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(dir)).unwrap();
    let mut settings = handlers::get_settings(&st).settings;
    settings.ai.mode = AiMode::Off;
    settings.autosave_days = autosave_days;
    handlers::save_settings(&st, settings).unwrap();
    st
}

type Events = Arc<Mutex<Vec<(String, Value, Instant)>>>;

/// 记录推送给界面的事件（事件名、负载、收到的时刻）。
fn capture(st: &AppState) -> Events {
    let events: Events = Arc::default();
    let sink = events.clone();
    st.set_emitter(Arc::new(move |name, payload| {
        sink.lock().unwrap().push((name.to_string(), payload, Instant::now()));
    }));
    events
}

fn named(events: &Events, name: &str) -> Vec<(Value, Instant)> {
    events.lock().unwrap().iter().filter(|(n, _, _)| n == name).map(|(_, v, t)| (v.clone(), *t)).collect()
}

fn clock_of(st: &AppState) -> (u32, u16) {
    let o = handlers::overview(st).unwrap();
    (o.day, o.minute)
}

fn state_hash(st: &AppState) -> String {
    handlers::debug(st).unwrap().state_hash
}

fn cmd(v: Value) -> Command {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("命令 JSON 无法解析：{e}\n{v}"))
}

/// manifest-sim 的旧版本（v1）样例存档。
fn legacy_fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("manifest-sim")
        .join("tests")
        .join("fixtures")
        .join("save_v1.mfsave.zst")
}

#[test]
fn new_game_starts_at_eight() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    let o = handlers::new_game(&st, "newcomer", Some(1)).unwrap();
    assert_eq!((o.day, o.minute), (0, DEFAULT_MINUTE));
    assert_eq!(DEFAULT_MINUTE, 480);
    // 返回给界面的 JSON 带 minute（前端 Overview.minute）
    let v = serde_json::to_value(handlers::overview(&st).unwrap()).unwrap();
    assert_eq!(v["minute"], json!(480));
    // 走过一段时间后换新游戏：重新从 8:00 开始
    handlers::set_speed(&st, 1).unwrap();
    handlers::advance_clock(&st, 2_000).unwrap();
    assert_ne!(clock_of(&st), (0, 480));
    let o = handlers::new_game(&st, "sandbox", Some(2)).unwrap();
    assert_eq!((o.day, o.minute), (0, 480));
}

#[test]
fn advance_clock_settles_a_day_exactly_when_passing_six() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    let events = capture(&st);
    // 没有游戏：时钟不走
    assert_eq!(handlers::advance_clock(&st, 100).unwrap(), None);
    handlers::new_game(&st, "newcomer", Some(3)).unwrap();

    // 暂停时时钟不走
    assert_eq!(handlers::advance_clock(&st, 600).unwrap(), None);
    assert_eq!(clock_of(&st), (0, 480));

    handlers::set_speed(&st, 1).unwrap();
    let hash0 = state_hash(&st);
    // 8:00 → 次日 5:59：还没走到 6:00，不结算；世界状态不变
    let s = handlers::advance_clock(&st, 1_319).unwrap().expect("运行中");
    assert_eq!((s.clock.day, s.clock.minute, s.days), (0, 359, 0));
    assert_eq!(state_hash(&st), hash0, "只走时钟不改变世界状态");
    assert!(named(&events, "tick").is_empty(), "没有结算就不推送每日概览");
    // 再走 1 分钟到 6:00：恰好推进一天，推送当天的概览（时刻 6:00）
    let s = handlers::advance_clock(&st, 1).unwrap().unwrap();
    assert_eq!((s.clock.day, s.clock.minute, s.days), (1, DAY_START_MINUTE, 1));
    let ticks = named(&events, "tick");
    assert_eq!(ticks.len(), 1);
    assert_eq!((ticks[0].0["day"].clone(), ticks[0].0["minute"].clone()), (json!(1), json!(360)));
    assert_ne!(state_hash(&st), hash0, "结算推进了世界");

    // 从 6:00 起一整天（1440 分钟）恰好再结算一次，停在下一个 6:00
    let s = handlers::advance_clock(&st, 1_439).unwrap().unwrap();
    assert_eq!((s.clock.day, s.clock.minute, s.days), (1, 359, 0));
    let s = handlers::advance_clock(&st, 1).unwrap().unwrap();
    assert_eq!((s.clock.day, s.clock.minute, s.days), (2, 360, 1));
    // 任意时刻走满 24 小时：跨过 6:00 一次，推进恰好一天，时刻回到原处
    handlers::advance_clock(&st, 700).unwrap();
    let before = clock_of(&st);
    assert_eq!(before, (2, 1060));
    let s = handlers::advance_clock(&st, 1_440).unwrap().unwrap();
    assert_eq!((s.clock.day, s.clock.minute, s.days), (3, 1060, 1));
    // 午夜不是日界线：23:59 → 0:01 仍是同一天
    handlers::advance_clock(&st, 1439 - 1060).unwrap();
    assert_eq!(clock_of(&st), (3, 1439));
    let s = handlers::advance_clock(&st, 2).unwrap().unwrap();
    assert_eq!((s.clock.day, s.clock.minute, s.days), (3, 1, 0));
    // 一步走过多个 6:00（后台线程被挂起后补推）：每个 6:00 都结算一次，只推送最后的概览
    let ticks_before = named(&events, "tick").len();
    let s = handlers::advance_clock(&st, 359 + 1_440 * 2 + 10).unwrap().unwrap();
    assert_eq!((s.clock.day, s.clock.minute, s.days), (6, 370, 3));
    assert_eq!(named(&events, "tick").len(), ticks_before + 1);
    assert_eq!(handlers::overview(&st).unwrap().day, 6);
    // 0 分钟：什么也不变
    let s = handlers::advance_clock(&st, 0).unwrap().unwrap();
    assert_eq!((s.clock.day, s.clock.minute, s.days), (6, 370, 0));

    // clock 事件只由调用方（后台线程）节流推送；换了一局之后不再推送旧局的时钟
    assert!(named(&events, "clock").is_empty());
    handlers::emit_clock(&st, &s);
    let clocks = named(&events, "clock");
    assert_eq!(clocks.len(), 1);
    handlers::new_game(&st, "newcomer", Some(4)).unwrap();
    handlers::emit_clock(&st, &s);
    assert_eq!(named(&events, "clock").len(), 1, "旧局的时钟不推送");
}

#[test]
fn step_and_tick_move_the_clock_to_six() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    handlers::new_game(&st, "newcomer", Some(5)).unwrap();
    // “下一天”：推进到下一个 6:00（结算一次）
    let o = handlers::step(&st, 1).unwrap();
    assert_eq!((o.day, o.minute), (1, 360));
    handlers::set_speed(&st, 4).unwrap();
    handlers::advance_clock(&st, 100).unwrap();
    assert_eq!(clock_of(&st), (1, 460));
    let o = handlers::step(&st, 3).unwrap();
    assert_eq!((o.day, o.minute), (4, 360));
    // 深夜时按“下一天”：同样结算一次，停在 6:00
    handlers::advance_clock(&st, 1_200).unwrap();
    assert_eq!(clock_of(&st), (4, 120));
    let o = handlers::step(&st, 1).unwrap();
    assert_eq!((o.day, o.minute), (5, 360));
    // tick 仍是“推进一天”，时钟停在 6:00
    handlers::advance_clock(&st, 30).unwrap();
    assert!(handlers::tick(&st).unwrap());
    assert_eq!(clock_of(&st), (6, 360));
    // 暂停时 tick 不推进，时钟也不动
    handlers::advance_clock(&st, 45).unwrap();
    handlers::set_speed(&st, 0).unwrap();
    assert!(!handlers::tick(&st).unwrap());
    assert_eq!(clock_of(&st), (6, 405));
    // 暂停后概览照常带着暂停时的时刻
    assert_eq!(handlers::set_speed(&st, 0).unwrap().minute, 405);
}

#[test]
fn battle_pause_stops_the_clock_at_six() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    let events = capture(&st);
    let o = handlers::new_game(&st, "newcomer", Some(31)).unwrap();
    let fleet = &o.fleets[0];
    let (fid, start) = (fleet.id, fleet.docked.expect("开局舰队停在港口"));
    // 航程最远的港口，保证舰队在海上多待几天
    let dest = st
        .defs()
        .port_ids()
        .filter(|l| l.0 != start)
        .filter_map(|l| handlers::sail_preview(&st, fid, l.0).unwrap().map(|p| (l.0, p.days)))
        .max_by_key(|(_, d)| *d)
        .unwrap()
        .0;
    for v in [
        json!({"Resupply": {"owner": "player", "fleet": fid, "food": 30, "water": 30}}),
        json!({"SetSail": {"owner": "player", "fleet": fid, "dest": dest}}),
    ] {
        handlers::submit(&st, cmd(v)).unwrap();
    }
    handlers::step(&st, 1).unwrap();
    {
        // 沿航线前方放一串海盗，舰队驶来时必定相遇
        let mut guard = st.game().unwrap();
        let world = &mut guard.as_mut().unwrap().session.world;
        let path: Vec<manifest_core::Cell> = match &world.fleet(manifest_core::FleetId(fid)).unwrap().location {
            manifest_core::world::FleetLocation::AtSea(manifest_core::world::Voyage::Route(v)) => {
                v.path[v.step + 3..(v.step + 12).min(v.path.len() - 1)].to_vec()
            }
            _ => panic!("舰队应在海上"),
        };
        for cell in path {
            let Some(region) = world.defs.map.region_of(cell) else { continue };
            let kind = world.defs.rules.pirates.ships[0];
            let ship = manifest_core::fleet::new_ship(&world.defs, kind);
            let id = world.state.battles.next_pirate;
            world.state.battles.next_pirate += 1;
            world.state.battles.pirates.insert(
                id,
                manifest_core::battle::PirateFleet {
                    id,
                    region,
                    cell,
                    ships: vec![ship],
                    crew: 12,
                    until: 9_999,
                    engaged: false,
                },
            );
        }
    }
    handlers::set_speed(&st, 2).unwrap();
    // 每步走 1000 分钟（大半天）：遭遇发生在某次走到 6:00 时，剩下的分钟作废，时钟停在 6:00
    let mut met = false;
    for _ in 0..12 {
        let Some(s) = handlers::advance_clock(&st, 1_000).unwrap() else { break };
        if handlers::current_speed(&st) == 0 {
            assert_eq!(s.clock.minute, DAY_START_MINUTE, "遇海战暂停时时钟停在结算的 6:00");
            met = true;
            break;
        }
    }
    assert!(met, "应遭遇海盗并自动暂停");
    let o = handlers::overview(&st).unwrap();
    assert!(!o.pending_battles.is_empty());
    assert_eq!((o.speed, o.minute), (0, 360));
    assert!(!named(&events, "battle").is_empty(), "推送遭遇");
    // 暂停后时钟不再走
    let hash = state_hash(&st);
    assert_eq!(handlers::advance_clock(&st, 1_000).unwrap(), None);
    assert_eq!(clock_of(&st), (o.day, 360));
    assert_eq!(state_hash(&st), hash);
}

/// 抵达时自动暂停（设置 arrival_pause，缺省只看旗舰队）：旗舰队靠港的那次结算之后游戏暂停，时钟停在 6:00；
/// 设置为“不暂停”时照常往前走；旧设置文件没有这一项时按缺省。
#[test]
fn the_game_pauses_when_the_flagship_arrives() {
    let old: AppSettings = serde_json::from_str(r#"{"speed": 2, "autosave_days": 10}"#).unwrap();
    assert_eq!(old.arrival_pause, ArrivalPause::Flagship, "旧设置文件按缺省：旗舰队抵达时暂停");

    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    let o = handlers::new_game(&st, "newcomer", Some(31)).unwrap();
    let fleet = &o.fleets[0];
    let (fid, start) = (fleet.id, fleet.docked.expect("开局舰队停在港口"));
    // 最近的港口
    let (dest, days) = st
        .defs()
        .port_ids()
        .filter(|l| l.0 != start)
        .filter_map(|l| handlers::sail_preview(&st, fid, l.0).unwrap().map(|p| (l.0, p.days)))
        .min_by_key(|(_, d)| *d)
        .unwrap();
    let steps = (days as usize + 10) * 2;
    handlers::submit(&st, cmd(json!({"SetSail": {"owner": "player", "fleet": fid, "dest": dest}}))).unwrap();
    handlers::set_speed(&st, 4).unwrap();
    let mut arrived = false;
    for _ in 0..steps {
        let Some(s) = handlers::advance_clock(&st, 720).unwrap() else { break };
        if handlers::current_speed(&st) == 0 {
            let o = handlers::overview(&st).unwrap();
            assert_eq!(o.fleets[0].docked, Some(dest), "暂停时旗舰队已经靠港");
            assert!(o.pending_battles.is_empty(), "是靠港暂停，不是遇到海盗");
            assert_eq!(s.clock.minute, DAY_START_MINUTE, "停在靠港那次结算的 6:00");
            arrived = true;
            break;
        }
    }
    assert!(arrived, "旗舰队靠港时自动暂停");

    // 设置为不暂停：再出发、回到出发的港口，游戏照常往前走
    let mut s = handlers::get_settings(&st).settings;
    s.arrival_pause = ArrivalPause::Off;
    handlers::save_settings(&st, s).unwrap();
    handlers::submit(&st, cmd(json!({"SetSail": {"owner": "player", "fleet": fid, "dest": start}}))).unwrap();
    handlers::set_speed(&st, 4).unwrap();
    for _ in 0..steps {
        handlers::advance_clock(&st, 720).unwrap();
    }
    let o = handlers::overview(&st).unwrap();
    assert_eq!(o.fleets[0].docked, Some(start), "回到了出发的港口");
    assert_eq!(o.speed, 4, "设置为不暂停时照常运行");
}

#[test]
fn clock_round_trips_through_save_and_load_without_touching_the_world_hash() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    handlers::new_game(&st, "newcomer", Some(11)).unwrap();
    handlers::set_captain(&st, CaptainView { name: "苏岚".into(), portrait: 7 }).unwrap();
    handlers::step(&st, 2).unwrap();
    handlers::set_speed(&st, 1).unwrap();
    handlers::advance_clock(&st, 820).unwrap();
    handlers::set_speed(&st, 0).unwrap();
    assert_eq!(clock_of(&st), (2, 1180));
    let hash = state_hash(&st);
    let saved = handlers::save_game(&st, "dusk").unwrap();
    assert_eq!((saved.day, saved.minute), (2, 1180));
    let info = handlers::list_saves(&st).unwrap().into_iter().find(|s| s.slot == "dusk").expect("存档在列表中");
    assert_eq!(info.minute, 1180);

    // 同一天的另一时刻存档：世界哈希相同（时刻不进世界状态）
    handlers::set_speed(&st, 1).unwrap();
    handlers::advance_clock(&st, 200).unwrap();
    handlers::set_speed(&st, 0).unwrap();
    assert_eq!(clock_of(&st), (2, 1380));
    assert_eq!(state_hash(&st), hash, "只走时钟不改变世界哈希");
    assert_eq!(handlers::save_game(&st, "night").unwrap().minute, 1380);

    // 换一局之后读档：时刻、主角与世界状态都恢复为存档时的样子
    handlers::new_game(&st, "heir", Some(12)).unwrap();
    let o = handlers::load_game(&st, "dusk").unwrap();
    assert_eq!((o.day, o.minute, o.speed), (2, 1180, 0));
    assert_eq!(o.captain, Some(CaptainView { name: "苏岚".into(), portrait: 7 }));
    assert_eq!(state_hash(&st), hash, "读档后世界状态与存档时一致");
    let o = handlers::load_game(&st, "night").unwrap();
    assert_eq!((o.day, o.minute), (2, 1380));
    assert_eq!(state_hash(&st), hash);
    // 读档后继续走：再过 6:00 推进一天
    handlers::set_speed(&st, 1).unwrap();
    let s = handlers::advance_clock(&st, 420).unwrap().unwrap();
    assert_eq!((s.clock.day, s.clock.minute, s.days), (3, 360, 1));
}

#[test]
fn old_saves_without_a_clock_start_at_eight() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    handlers::new_game(&st, "newcomer", Some(41)).unwrap();
    handlers::set_captain(&st, CaptainView { name: "沈远".into(), portrait: 6 }).unwrap();
    handlers::set_speed(&st, 1).unwrap();
    handlers::advance_clock(&st, 300).unwrap();
    handlers::set_speed(&st, 0).unwrap();
    assert_eq!(handlers::save_game(&st, "old").unwrap().minute, 780);
    let saves = st.paths().saves_dir.clone();
    let meta = saves.join("old.meta.json");
    let mut v: Value = serde_json::from_str(&std::fs::read_to_string(&meta).unwrap()).unwrap();
    assert_eq!(v["minute"], json!(780), "时刻写在 meta 文件里");

    // 1. 旧版本的 meta（没有 minute 字段）：列表与读档照常，时刻取 8:00，主角照常恢复
    v.as_object_mut().unwrap().remove("minute");
    std::fs::write(&meta, v.to_string()).unwrap();
    let info = handlers::list_saves(&st).unwrap().into_iter().find(|s| s.slot == "old").expect("旧 meta 仍在列表中");
    assert_eq!(info.minute, 480);
    let o = handlers::load_game(&st, "old").unwrap();
    assert_eq!(o.minute, 480);
    assert_eq!(o.captain, Some(CaptainView { name: "沈远".into(), portrait: 6 }));

    // 2. meta 里的时刻不合法（越界、负数、类型不对）：时刻取 8:00，不连累主角
    for bad in [json!(1440), json!(-1), json!("早上"), json!(null)] {
        v["minute"] = bad.clone();
        std::fs::write(&meta, v.to_string()).unwrap();
        let o = handlers::load_game(&st, "old").unwrap();
        assert_eq!(o.minute, 480, "{bad}");
        assert!(o.captain.is_some(), "{bad}");
    }

    // 3. meta 损坏或缺失：存档照常读取，时刻取 8:00
    std::fs::write(&meta, "{ 不是 JSON").unwrap();
    assert_eq!(handlers::load_game(&st, "old").unwrap().minute, 480);
    std::fs::remove_file(&meta).unwrap();
    assert_eq!(handlers::load_game(&st, "old").unwrap().minute, 480);

    // 4. manifest-sim 的 v1 样例存档（没有 meta）：从 8:00 开始，可以继续推进
    std::fs::copy(legacy_fixture(), saves.join("legacy.mfsave.zst")).expect("复制样例存档");
    let o = handlers::load_game(&st, "legacy").unwrap();
    assert_eq!((o.day, o.minute), (20, 480));
    handlers::set_speed(&st, 32).unwrap();
    let s = handlers::advance_clock(&st, 1_320).unwrap().unwrap();
    assert_eq!((s.clock.day, s.clock.minute), (21, 360));
}

#[test]
fn autosave_records_the_settlement_time() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 2);
    handlers::new_game(&st, "newcomer", Some(21)).unwrap();
    handlers::set_speed(&st, 8).unwrap();
    // 8:00 起走 1320 + 1440 + 90 分钟：第 2 天 6:00 结算时自动存档，之后时钟走到 7:30
    let s = handlers::advance_clock(&st, 1_320 + 1_440 + 90).unwrap().unwrap();
    assert_eq!((s.clock.day, s.clock.minute, s.days), (2, 450, 2));
    let auto = handlers::list_saves(&st).unwrap().into_iter().find(|s| s.slot == "autosave").expect("自动存档");
    assert_eq!((auto.day, auto.minute), (2, 360), "自动存档发生在结算的 6:00");
    // 手动存档记下当前时刻；读回自动存档回到 6:00
    assert_eq!(handlers::save_game(&st, "manual").unwrap().minute, 450);
    let o = handlers::load_game(&st, "autosave").unwrap();
    assert_eq!((o.day, o.minute), (2, 360));
}

#[test]
fn speed_set_is_one_to_thirty_two() {
    assert_eq!(SPEEDS, [1, 2, 4, 8, 16, 32]);
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    handlers::new_game(&st, "newcomer", Some(51)).unwrap();
    for n in [0u8, 1, 2, 4, 8, 16, 32] {
        assert_eq!(handlers::set_speed(&st, n).unwrap().speed, n);
    }
    for n in [3u8, 5, 12, 33, 64, 255] {
        let err = handlers::set_speed(&st, n).unwrap_err().to_string();
        assert!(err.contains("1 / 2 / 4 / 8 / 16 / 32"), "{n}：{err}");
    }
    assert_eq!(handlers::overview(&st).unwrap().speed, 32, "被拒绝时保留原来的速度");

    // 设置里的默认速度：旧设置的 1 / 2 / 4 / 8 与新增的 16 / 32 都合法，3 与 64 不合法
    let base = handlers::get_settings(&st).settings;
    for n in SPEEDS {
        let s = AppSettings { speed: n, ..base.clone() };
        assert_eq!(handlers::save_settings(&st, s).unwrap().settings.speed, n);
    }
    for n in [0u8, 3, 64] {
        let s = AppSettings { speed: n, ..base.clone() };
        let err = handlers::save_settings(&st, s).unwrap_err().to_string();
        assert!(err.contains("1 / 2 / 4 / 8 / 16 / 32"), "{n}：{err}");
    }
    // 旧版本写下的设置文件（速度 8）照常读取；不合法的速度回到默认设置
    let file = tmp.path().join("old-settings.json");
    let mut v = serde_json::to_value(&base).unwrap();
    v["speed"] = json!(8);
    std::fs::write(&file, v.to_string()).unwrap();
    assert_eq!(AppSettings::load(&file).speed, 8);
    v["speed"] = json!(64);
    std::fs::write(&file, v.to_string()).unwrap();
    assert_eq!(AppSettings::load(&file), AppSettings::default());
}

/// 后台线程：按实时推进时钟，节流推送 clock 事件；暂停后时钟不走。
#[test]
fn ticker_runs_the_clock_in_real_time() {
    let tmp = tempfile::tempdir().unwrap();
    let st = app(tmp.path(), 0);
    let events = capture(&st);
    handlers::new_game(&st, "sandbox", Some(61)).unwrap();
    manifest_app::spawn_ticker(st.clone());
    handlers::set_speed(&st, 32).unwrap();
    std::thread::sleep(Duration::from_millis(1_200));
    handlers::set_speed(&st, 0).unwrap();
    let (day, minute) = clock_of(&st);

    // 从 6:00 起算的时刻戳：日期不倒退，同一天内时刻不倒退（游戏日从 6:00 到次日 5:59）
    let key = |v: &Value| {
        let (d, m) = (v["day"].as_u64().unwrap(), v["minute"].as_u64().unwrap());
        d * 1440 + (m + 1440 - 360) % 1440
    };
    let ticks = named(&events, "tick");
    // 每日概览：日期逐次前进；概览带的是推送时的时刻（这一小步走过 6:00 之后的时刻）
    for w in ticks.windows(2) {
        assert!(w[1].0["day"].as_u64() > w[0].0["day"].as_u64(), "{} → {}", w[0].0["day"], w[1].0["day"]);
    }
    assert!(ticks.iter().all(|(v, _)| v["minute"].as_u64().is_some_and(|m| m < 1440)));
    let clocks = named(&events, "clock");
    assert!(clocks.len() >= 5, "clock 事件：{}", clocks.len());
    // 节流：相邻两次推送至少隔约 100 ms（留出记录时刻的抖动）
    for w in clocks.windows(2) {
        let gap = w[1].1.duration_since(w[0].1);
        assert!(gap >= Duration::from_millis(90), "clock 事件间隔过短：{gap:?}");
    }
    // 概览与 clock 事件按推送顺序合在一起，时钟单调前进
    let timeline: Vec<Value> = events
        .lock()
        .unwrap()
        .iter()
        .filter(|(n, _, _)| n == "tick" || n == "clock")
        .map(|(_, v, _)| v.clone())
        .collect();
    for w in timeline.windows(2) {
        assert!(key(&w[1]) >= key(&w[0]), "{} → {}", w[0], w[1]);
    }
    // 最后推送的时刻不晚于暂停时的时钟（节流可能跳过最后一小步的推送，暂停返回的概览会带上准确时刻）
    let paused_key = u64::from(day) * 1440 + (u64::from(minute) + 1440 - 360) % 1440;
    assert!(timeline.last().is_some_and(|v| key(v) <= paused_key));

    // 暂停后：时钟停住，不再推送
    std::thread::sleep(Duration::from_millis(50));
    let n = events.lock().unwrap().len();
    let paused_at = clock_of(&st);
    assert_eq!(paused_at, (day, minute));
    std::thread::sleep(Duration::from_millis(400));
    assert_eq!(clock_of(&st), paused_at, "暂停时时钟不走");
    assert_eq!(events.lock().unwrap().len(), n, "暂停时不推送");
}
