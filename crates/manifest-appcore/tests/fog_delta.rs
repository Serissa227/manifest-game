//! E18：I3 位图、游标重置、真实航行的乱序/漏包补齐与大图传输预算。
use base64::{Engine, engine::general_purpose::STANDARD};
use manifest_ai::{AiMode, MemoryKeyStore};
use manifest_appcore::views::FogDelta;
use manifest_appcore::{AppPaths, AppState, handlers, views};
use manifest_core::{Command, LocId, OwnerId};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

fn app_at(dir: &Path) -> AppState {
    let data = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let st = AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(dir)).unwrap();
    let mut settings = st.settings();
    settings.ai.mode = AiMode::Off;
    settings.autosave_days = 0;
    handlers::save_settings(&st, settings).unwrap();
    st
}
fn app() -> AppState {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    app_at(&std::env::temp_dir().join(format!("manifest-b6-fog-{}-{seq}", std::process::id())))
}
fn request(world: &str) -> handlers::NewGameRequest {
    serde_json::from_value(json!({"world":world,"scenario":"sandbox","seed":42})).unwrap()
}
fn bitmap(delta: &FogDelta) -> Vec<u8> {
    STANDARD.decode(delta.full.as_ref().expect("全量位图")).unwrap()
}
fn apply(bytes: &mut [u8], runs: &[[u16; 3]], width: u16) {
    for &[row, start, end] in runs {
        assert!(start <= end);
        for x in start..=end {
            let i = usize::from(row) * usize::from(width) + usize::from(x);
            bytes[i / 8] |= 1 << (i % 8);
        }
    }
}
fn compare_rows(bytes: &[u8], rows: &[String]) {
    let width = rows[0].len();
    for (y, row) in rows.iter().enumerate() {
        for (x, b) in row.bytes().enumerate() {
            let i = y * width + x;
            assert_eq!(bytes[i / 8] & (1 << (i % 8)) != 0, b == b'1');
        }
    }
}

#[test]
fn full_delta_and_legacy_rows_agree_and_invalid_cursors_resynchronize() {
    let st = app();
    assert!(handlers::fog_delta(&st, 0, None).is_err());
    let overview = handlers::new_game(&st, "newcomer", Some(42)).unwrap();
    let before = handlers::debug(&st).unwrap().state_hash;
    let full = handlers::fog_delta(&st, 0, None).unwrap();
    assert_eq!(full.rev, overview.fog_version);
    assert!(!full.epoch.is_empty());
    assert!(full.runs.is_empty());
    let object = serde_json::to_value(&full).unwrap();
    assert_eq!(
        object.as_object().unwrap().keys().map(String::as_str).collect::<Vec<_>>(),
        ["epoch", "full", "rev", "runs"]
    );
    compare_rows(&bitmap(&full), &handlers::fog(&st).unwrap());
    let empty = handlers::fog_delta(&st, u64::from(full.rev), Some(full.epoch.clone())).unwrap();
    assert!(empty.full.is_none() && empty.runs.is_empty());
    for (since, epoch) in [(u64::MAX, Some(full.epoch.clone())), (u64::from(full.rev), None), (0, Some("old".into()))] {
        let reset = handlers::fog_delta(&st, since, epoch).unwrap();
        assert_eq!(reset.full, full.full);
        assert!(reset.runs.is_empty());
    }
    assert_eq!(handlers::debug(&st).unwrap().state_hash, before);
}

#[test]
fn epoch_changes_on_new_game_load_world_switch_and_process_state_recreation() {
    let st = app();
    handlers::new_game(&st, "newcomer", Some(42)).unwrap();
    let first = handlers::fog_delta(&st, 0, None).unwrap();
    handlers::new_game(&st, "newcomer", Some(42)).unwrap();
    let second = handlers::fog_delta(&st, u64::from(first.rev), Some(first.epoch.clone())).unwrap();
    assert_eq!(first.rev, second.rev);
    assert_ne!(first.epoch, second.epoch);
    assert!(second.full.is_some());
    handlers::save_game(&st, "fog").unwrap();
    handlers::load_game(&st, "fog").unwrap();
    let loaded = handlers::fog_delta(&st, u64::from(second.rev), Some(second.epoch.clone())).unwrap();
    assert_ne!(loaded.epoch, second.epoch);
    assert_eq!(loaded.full, second.full);
    handlers::select_world(&st, "testbed".into()).unwrap();
    let preview = handlers::fog_delta(&st, u64::from(loaded.rev), Some(loaded.epoch.clone())).unwrap();
    assert_eq!(preview.epoch, loaded.epoch);
    assert!(preview.full.is_none(), "预览不替换当前局");
    handlers::new_world_game(&st, request("testbed")).unwrap();
    let changed = handlers::fog_delta(&st, u64::from(loaded.rev), Some(loaded.epoch.clone())).unwrap();
    assert_ne!(changed.epoch, loaded.epoch);
    compare_rows(&bitmap(&changed), &handlers::fog(&st).unwrap());
    handlers::load_game(&st, "fog").unwrap();
    assert_eq!(st.defs().world_key, "classic");
    let classic = handlers::fog_delta(&st, u64::from(changed.rev), Some(changed.epoch.clone())).unwrap();
    assert_ne!(classic.epoch, changed.epoch);
    assert_eq!(classic.full, first.full);
    let restarted = app_at(st.paths().settings_file.parent().unwrap());
    handlers::load_game(&restarted, "fog").unwrap();
    let fresh = handlers::fog_delta(&restarted, u64::from(first.rev), Some(first.epoch.clone())).unwrap();
    assert_eq!(restarted.generation(), 1);
    assert_ne!(fresh.epoch, first.epoch);
    assert_eq!(fresh.full, first.full);
}

#[test]
fn voyage_deltas_reorder_duplicate_and_recover_missed_days_with_daily_events() {
    let st = app();
    let o = handlers::new_game(&st, "newcomer", Some(42)).unwrap();
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    st.set_emitter(Arc::new(move |name, value| {
        if name == "fog" {
            sink.lock().unwrap().push(value);
        }
    }));
    let fleet = o.fleets[0].id;
    let start = o.fleets[0].docked.unwrap();
    let dest = st
        .defs()
        .port_ids()
        .filter(|l| l.0 != start)
        .filter_map(|l| handlers::sail_preview(&st, fleet, l.0).unwrap().map(|p| (l, p.days)))
        .max_by_key(|(_, days)| *days)
        .unwrap()
        .0;
    for command in [
        Command::Resupply { owner: OwnerId::Player, fleet: manifest_core::FleetId(fleet), food: 30, water: 30 },
        Command::SetSail { owner: OwnerId::Player, fleet: manifest_core::FleetId(fleet), dest },
    ] {
        handlers::submit(&st, command).unwrap();
    }
    let first = handlers::fog_delta(&st, 0, None).unwrap();
    let mut previous = first.rev;
    let mut deltas = Vec::new();
    for _ in 0..20 {
        let overview = handlers::step(&st, 1).unwrap();
        let next = handlers::fog_delta(&st, u64::from(previous), Some(first.epoch.clone())).unwrap();
        assert!(next.full.is_none());
        assert_eq!(next.rev, overview.fog_version);
        assert_eq!(events.lock().unwrap().last().unwrap(), &json!({"rev":next.rev}));
        previous = next.rev;
        deltas.push(next);
    }
    assert_eq!(events.lock().unwrap().len(), 20);
    assert!(deltas.iter().any(|d| !d.runs.is_empty()), "必须实航揭开新格，不能空增量通过");
    let mut reordered = bitmap(&first);
    for delta in deltas.iter().rev().chain(deltas.iter()) {
        apply(&mut reordered, &delta.runs, st.defs().map.width);
    }
    let final_full = handlers::fog_delta(&st, 0, None).unwrap();
    assert_eq!(reordered, bitmap(&final_full));
    compare_rows(&reordered, &handlers::fog(&st).unwrap());
    let missed = handlers::fog_delta(&st, u64::from(first.rev), Some(first.epoch.clone())).unwrap();
    assert!(missed.full.is_none());
    let mut skipped = bitmap(&first);
    apply(&mut skipped, &missed.runs, st.defs().map.width);
    assert_eq!(skipped, reordered);
}

fn synth1080_session() -> manifest_sim::GameSession {
    let data = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let mut defs = (*manifest_data::load_world(&data, "testbed").unwrap()).clone();
    // B2 的完整海岸与 150 港等距锚点；本测试只激活两个港，专测航行后的迷雾负载。
    let (map, anchors) = manifest_data::bench::synth1080::navigation_fixture(150).unwrap();
    let ports = [(LocId(0), anchors[0].1), (LocId(1), anchors[75].1)];
    for &(id, cell) in &ports {
        defs.locations[id.idx()].cell = cell;
    }
    let region = defs.regions[0].clone();
    defs.regions = (0..4)
        .map(|i| {
            let mut r = region.clone();
            r.key = format!("fog_sea_{i}");
            r.rect = (0, i * 99, 1079, i * 99 + 98);
            r
        })
        .collect();
    defs.nav = Arc::new(manifest_core::nav::NavTable::build(&map, &defs.regions, defs.locations.len(), &ports));
    defs.map = map;
    defs.geography = Default::default();
    defs.world_key = "synth1080".into();
    defs.map_key = "synth1080".into();
    let scenario = defs.find_scenario("sandbox").unwrap();
    manifest_sim::GameSession::new(Arc::new(defs), scenario, 42).unwrap()
}

#[test]
fn expired_history_returns_full_then_accepts_the_resynchronized_cursor() {
    let mut session = synth1080_session();
    // 测试海图免费，确保只验证大量揭雾后的窗口淘汰，不依赖开局现金。
    let rules = &mut Arc::make_mut(&mut session.world.defs).rules.explore;
    rules.chart_base = 0;
    rules.chart_per_100_cells = 0;
    let epoch = "window-resynchronization";
    let first = views::fog_view::delta(&session.world, epoch.into(), 0, None);
    session.submit(Command::BuyChart { owner: OwnerId::Player, region: manifest_core::RegionId(0) }).unwrap();
    let reset = views::fog_view::delta(&session.world, epoch.into(), u64::from(first.rev), Some(epoch));
    assert_eq!(reset.epoch, first.epoch, "同一局也必须处理过旧的版本");
    assert!(reset.rev > first.rev + 8192);
    assert!(reset.full.is_some() && reset.runs.is_empty());
    compare_rows(&bitmap(&reset), &views::fog_rows(&session.world));
    let empty = views::fog_view::delta(&session.world, epoch.into(), u64::from(reset.rev), Some(epoch));
    assert!(empty.full.is_none() && empty.runs.is_empty());
    session.submit(Command::BuyChart { owner: OwnerId::Player, region: manifest_core::RegionId(1) }).unwrap();
    let newest = views::fog_view::delta(
        &session.world,
        epoch.into(),
        u64::from(session.world.state.explore.fog_revision() - 3),
        Some(epoch),
    );
    assert!(newest.full.is_none());
    assert_eq!(newest.runs, vec![[197, 1077, 1079]], "窗口淘汰后仍能精确读取最新区间");
}

#[test]
fn synth1080_typical_sailing_day_is_at_most_two_kilobytes() {
    let mut session = synth1080_session();
    let fleet = session.world.fleets_of(OwnerId::Player).next().unwrap().id;
    for command in [
        Command::Resupply { owner: OwnerId::Player, fleet, food: 30, water: 30 },
        Command::SetSail { owner: OwnerId::Player, fleet, dest: LocId(1) },
    ] {
        session.submit(command).unwrap();
    }
    let epoch = "synth1080-measurement";
    let first = views::fog_view::delta(&session.world, epoch.into(), 0, None);
    let mut prior = first.rev;
    let mut bytes = bitmap(&first);
    let mut sizes = Vec::new();
    let mut changed = 0;
    let mut maximum_runs = 0;
    for _ in 0..20 {
        session.advance_day().unwrap();
        let next = views::fog_view::delta(&session.world, epoch.into(), u64::from(prior), Some(epoch));
        assert!(next.full.is_none());
        if !next.runs.is_empty() {
            changed += 1;
        }
        apply(&mut bytes, &next.runs, 1080);
        prior = next.rev;
        let size = serde_json::to_vec(&next).unwrap().len();
        assert!(size <= 2000, "每天原始 JSON 超预算：{size}");
        sizes.push(size);
        maximum_runs = maximum_runs.max(next.runs.len());
    }
    assert!(changed >= 10, "需至少十天真实揭开迷雾：{changed}");
    let full = views::fog_view::delta(&session.world, epoch.into(), 0, None);
    assert_eq!(bytes, bitmap(&full));
    compare_rows(&bytes, &views::fog_rows(&session.world));
    sizes.sort_unstable();
    println!(
        "synth1080 fog: days=20 changed_days={changed} median_json={} max_json={} max_runs={maximum_runs} full_json={}",
        sizes[10],
        sizes.last().unwrap(),
        serde_json::to_vec(&full).unwrap().len()
    );
}
