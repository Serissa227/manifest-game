//! I3 航迹查询与应用时钟：真正的 handler，查询不提前结算或允许提前交易。
use manifest_ai::MemoryKeyStore;
use manifest_app::{AppError, AppPaths, AppState, handlers};
use manifest_core::navigation::{Sail, Steering};
use manifest_core::*;
use serde_json::json;
use std::sync::Arc;

fn app(dir: &std::path::Path) -> (AppState, FleetId) {
    let data = manifest_data::find_data_dir().unwrap();
    let st = AppState::from_data_dir(&data, Arc::new(MemoryKeyStore::default()), AppPaths::in_dir(dir)).unwrap();
    handlers::new_game(&st, "newcomer", Some(42)).unwrap();
    let id = {
        let mut guard = st.game().unwrap();
        let g = guard.as_mut().unwrap();
        let mut defs = (*g.session.world.defs).clone();
        defs.manual_navigation = true;
        g.session.world.defs = Arc::new(defs);
        g.session.world.fleets_of(OwnerId::Player).next().unwrap().id
    };
    (st, id)
}

#[test]
fn preview_json_is_i3_and_tentative_orders_do_not_change_state_or_clock() {
    let tmp = tempfile::tempdir().unwrap();
    let (st, id) = app(tmp.path());
    // 应用 08:00 是内核航行分钟 120，不是 480。
    let command = Command::Depart { owner: OwnerId::Player, fleet: id, minute: 120, heading: 90 };
    handlers::submit(&st, command).unwrap();
    let before = st.game().unwrap().as_ref().unwrap().session.to_save();
    let steers = vec![Steering { minute: 120, heading: Some(90), sail: Some(Sail::Furled) }];
    let view = handlers::preview_course(&st, id.0, steers.clone(), 120).unwrap();
    assert_eq!(view.as_object().unwrap().keys().map(String::as_str).collect::<Vec<_>>(), ["points", "stops"]);
    let points = view["points"].as_array().unwrap();
    assert_eq!(points.len(), 1321);
    assert_eq!(points[0][2], 120);
    assert_eq!(points.last().unwrap()[2], 1440);
    assert!(points.iter().all(|p| p.as_array().unwrap().len() == 3));
    for point in points {
        for axis in [0, 1] {
            assert_eq!((point[axis].as_f64().unwrap() * 256.0).fract(), 0.0);
        }
    }
    let guard = st.game().unwrap();
    let g = guard.as_ref().unwrap();
    assert_eq!(g.minute, 480);
    assert_eq!(g.session.to_save(), before);
    let fleet_view =
        serde_json::to_value(manifest_app::views::fleet_view(&g.session.world, g.session.world.fleet(id).unwrap()))
            .unwrap();
    assert_eq!(fleet_view["heading"], 90);
    assert_eq!(fleet_view["pos"], json!({"x":points[0][0],"y":points[0][1]}));
    let expected = g.session.world.preview_course(id, &steers, 120).unwrap();
    assert_eq!(
        points.last().unwrap(),
        &json!([expected.voyage.pos.x as f64 / 256.0, expected.voyage.pos.y as f64 / 256.0, 1440])
    );
    drop(guard);
    handlers::submit(
        &st,
        Command::Steer { owner: OwnerId::Player, fleet: id, minute: 120, heading: Some(90), sail: Some(Sail::Furled) },
    )
    .unwrap();
    assert_eq!(handlers::preview_course(&st, id.0, vec![], 120).unwrap(), view);
    let error =
        handlers::submit(&st, Command::Resupply { owner: OwnerId::Player, fleet: id, food: 1, water: 1 }).unwrap_err();
    assert!(matches!(error, AppError::Command(CommandError::NotDocked)));
}

#[test]
fn application_clock_rejects_past_commands_and_previews_atomically() {
    let tmp = tempfile::tempdir().unwrap();
    let (st, id) = app(tmp.path());
    let before = st.game().unwrap().as_ref().unwrap().session.to_save();
    let err = handlers::submit(&st, Command::Depart { owner: OwnerId::Player, fleet: id, minute: 119, heading: 90 })
        .unwrap_err();
    assert!(matches!(err, AppError::Command(ref e) if e.code() == "navigation.past"));
    assert_eq!(st.game().unwrap().as_ref().unwrap().session.to_save(), before);
    handlers::submit(&st, Command::Depart { owner: OwnerId::Player, fleet: id, minute: 120, heading: 90 }).unwrap();
    let before = st.game().unwrap().as_ref().unwrap().session.to_save();
    let err = handlers::preview_course(&st, id.0, vec![Steering { minute: 119, heading: Some(0), sail: None }], 0)
        .unwrap_err();
    assert!(matches!(err, AppError::Command(ref e) if e.code() == "navigation.past"));
    assert_eq!(st.game().unwrap().as_ref().unwrap().session.to_save(), before);
}

#[test]
fn stop_fields_and_navigation_reasons_are_localized() {
    let tmp = tempfile::tempdir().unwrap();
    let (st, id) = app(tmp.path());
    handlers::submit(&st, Command::Depart { owner: OwnerId::Player, fleet: id, minute: 120, heading: 90 }).unwrap();
    {
        let mut guard = st.game().unwrap();
        let w = &mut guard.as_mut().unwrap().session.world;
        let cell = w.fleet(id).unwrap().cell(&w.defs);
        let heading = w.weather_at(cell).map(|w| u16::from(w.sea.wind_dir) * 45).unwrap_or(90);
        let mut defs = (*w.defs).clone();
        for dir in 0..8 {
            if let Some(c) = defs.map.topology().neighbor(cell, dir) {
                let i = defs.map.idx(c);
                defs.map.terrain[i] = manifest_core::nav::Terrain::Land;
            }
        }
        w.defs = Arc::new(defs);
        let f = w.fleet_mut(id).unwrap();
        f.ships.iter_mut().for_each(|s| s.speed_bonus = Fx::from_int(3000));
        if let manifest_core::world::FleetLocation::AtSea(manifest_core::world::Voyage::Manual { manual }) =
            &mut f.location
        {
            manual.heading = heading;
        }
    }
    let invalid = || Command::Steer { owner: OwnerId::Player, fleet: id, minute: 120, heading: Some(360), sail: None };
    let zh = st.localize_error(handlers::submit(&st, invalid()).unwrap_err()).to_string();
    assert!(zh.contains("航向"));
    let mut settings = handlers::get_settings(&st).settings;
    settings.language = Some(manifest_data::Locale::En);
    handlers::save_settings(&st, settings).unwrap();
    let en = st.localize_error(handlers::submit(&st, invalid()).unwrap_err()).to_string();
    assert!(en.contains("heading") || en.contains("Heading"), "{en}");
    let view = handlers::preview_course(&st, id.0, vec![], 120).unwrap();
    let stops = view["stops"].as_array().unwrap();
    assert!(stops.iter().any(|s| s["kind"] == "land"));
    for stop in stops {
        assert_eq!(
            stop.as_object().unwrap().keys().map(String::as_str).collect::<Vec<_>>(),
            ["kind", "loc", "minute", "text"]
        );
        assert!(matches!(stop["kind"].as_str(), Some("land" | "port" | "storm" | "sight")));
        assert!(!stop["text"].as_str().unwrap().is_empty());
    }
}
