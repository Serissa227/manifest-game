//! 1104 航海卡顿诊断：真实开局、分钟预测、只读投影、目的地与应用时钟分别计时。
//! `cargo run --release --locked -p manifest-appcore --example perf_navigation -- <输出目录> [世界] [初始存档]`
use manifest_appcore::{AppPaths, AppState, clock, handlers, navigation_view, state::Game, views::Ctx};
use manifest_core::{Command, OwnerId, SaveFile};
use manifest_sim::GameSession;
use serde::Serialize;
use serde_json::{Value, json};
use std::{path::Path, sync::Arc, time::Instant};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn digest(value: &impl Serialize) -> Result<String> {
    Ok(blake3::hash(&serde_json::to_vec(value)?).to_hex().to_string())
}

fn measure<T>(name: &str, samples: &mut Vec<Value>, run: impl FnOnce() -> Result<T>) -> Result<T> {
    let start = Instant::now();
    let value = run()?;
    let ms = start.elapsed().as_secs_f64() * 1000.0;
    eprintln!("{name}: {ms:.3} ms");
    samples.push(json!({"stage":name,"ms":ms}));
    Ok(value)
}

fn write(path: &Path, value: &impl Serialize) -> Result<()> {
    serde_json::to_writer(std::io::BufWriter::new(std::fs::File::create(path)?), value)?;
    Ok(())
}

fn main() -> Result<()> {
    let mut args = std::env::args().skip(1);
    let out = args.next().ok_or("需要输出目录")?;
    let out = Path::new(&out);
    std::fs::create_dir_all(out)?;
    let world = args.next().unwrap_or_else(|| "terra16".into());
    let initial = args.next();
    let root = manifest_data::find_data_dir().ok_or("找不到数据目录")?;
    let st = AppState::from_data_dir(
        &root,
        Arc::new(manifest_ai::MemoryKeyStore::default()),
        AppPaths::in_dir(&out.join("app")),
    )?;
    let emitted = Arc::new(std::sync::Mutex::new(Vec::<(String, Instant, Value)>::new()));
    let capture = emitted.clone();
    st.set_emitter(Arc::new(move |kind, value| {
        if matches!(kind, "clock" | "tick" | "nav_course")
            && let Ok(mut events) = capture.lock()
        {
            events.push((kind.to_owned(), Instant::now(), json!({"day":value["day"],"minute":value["minute"]})));
        }
    }));
    let defs = st.select_world(&world)?.defs.clone();
    // H03：环境变量 MANIFEST_PERF_SEA_OFF=1 时关掉天气团与按分钟追击（改动前后对照用）
    let defs = if std::env::var("MANIFEST_PERF_SEA_OFF").is_ok_and(|v| v == "1") {
        let mut d = (*defs).clone();
        d.rules.weather_cells.enabled = false;
        d.rules.pursuit.enabled = false;
        Arc::new(d)
    } else {
        defs
    };
    // H10b：同一构建关闭拉直，作为改前对照；旧视图入口仍可独立计时。
    let defs = if std::env::var("MANIFEST_PERF_STRAIGHTEN_OFF").is_ok_and(|v| v == "1") {
        let mut d = (*defs).clone();
        d.rules.autopilot.straighten = false;
        Arc::new(d)
    } else {
        defs
    };
    let mut settings = handlers::get_settings(&st).settings;
    settings.autosave_days = 0;
    settings.language = Some(manifest_data::Locale::ZhCn);
    handlers::save_settings(&st, settings)?;
    let mut samples = Vec::new();
    let session = if let Some(path) = initial {
        let save: SaveFile = serde_json::from_reader(std::io::BufReader::new(std::fs::File::open(path)?))?;
        GameSession::from_save(defs.clone(), save)?
    } else {
        let scenario =
            defs.find_scenario(if world == "classic" { "newcomer" } else { "free_1557" }).ok_or("找不到诊断剧本")?;
        measure("initialization", &mut samples, || Ok(GameSession::new(defs.clone(), scenario, 42)?))?
    };
    let initial = session.to_save();
    write(&out.join("initial.json"), &initial)?;
    let mut cases = Vec::new();
    for autopilot in [false, true] {
        if !defs.manual_navigation {
            break;
        }
        let mut session = GameSession::from_save(defs.clone(), initial.clone())?;
        let fleet = session.world.flagship(OwnerId::Player).ok_or("没有旗舰队")?;
        let start = session.world.fleet(fleet)?.cell(&defs);
        let dest = session
            .world
            .visible_locations()
            .filter(|loc| defs.loc(*loc).is_port())
            .filter_map(|loc| session.world.known_sea_path(start, loc, true).ok().map(|p| (p.path.len(), loc)))
            .filter(|(len, _)| *len > 2)
            .min();
        let cmd = if autopilot {
            let (_, dest) = dest.ok_or("没有已知目的地")?;
            Command::Autopilot {
                owner: OwnerId::Player,
                fleet,
                minute: 120,
                dest,
                stop_at_known_edge: true,
                route: None,
            }
        } else {
            Command::Depart { owner: OwnerId::Player, fleet, minute: 120, heading: 270 }
        };
        session.submit_at(120, cmd)?;
        let mode = if autopilot { "autopilot" } else { "manual" };
        eprintln!("case {mode}, destination {dest:?}");
        let before = digest(&session.to_save())?;
        st.replace_game(Game {
            last_autosave: session.day(),
            session: GameSession::from_save(defs.clone(), session.to_save())?,
            ai: None,
            speed: 4,
            run_speed: 4,
            resume_speed: None,
            captain: None,
            minute: clock::DEFAULT_MINUTE,
            last_navigation_stop: None,
            book: Default::default(),
            notes: Default::default(),
            clock_speeds: Default::default(),
            upbringing_unlock_notices: Default::default(),
        })?;
        let mut reads = Vec::new();
        for minute in [120, 300, 600] {
            let w = &session.world;
            let course = measure(&format!("{mode}.preview.{minute}"), &mut samples, || {
                Ok(navigation_view::preview_course(Ctx::plain(&defs), w, fleet, &[], minute)?)
            })?;
            let projection =
                measure(&format!("{mode}.projection.{minute}"), &mut samples, || Ok(w.navigation_projection(minute)?))?;
            let dests = measure(&format!("{mode}.destinations.{minute}"), &mut samples, || {
                Ok(navigation_view::known_dests(Ctx::plain(&defs), w, fleet, minute))
            })?;
            let nav = measure(&format!("{mode}.navigation.{minute}"), &mut samples, || {
                Ok(navigation_view::navigation(Ctx::plain(&defs), w, fleet, minute, 1)?)
            })?;
            let (locations, paths) = measure(&format!("{mode}.dests.paths.{minute}"), &mut samples, || {
                Ok(navigation_view::destination_paths(&projection, fleet))
            })?;
            measure(&format!("{mode}.dests.estimates.{minute}"), &mut samples, || {
                Ok(navigation_view::destination_estimates(
                    Ctx::plain(&defs),
                    &projection,
                    fleet,
                    locations,
                    paths,
                    false,
                ))
            })?;
            measure(&format!("{mode}.course_ahead.2.{minute}"), &mut samples, || Ok(w.course_ahead(fleet, 2)?))?;
            {
                let mut guard = st.game()?;
                let game = guard.as_mut().ok_or("game")?;
                game.minute = clock::norm(u32::from(clock::DAY_START_MINUTE) + u32::from(minute));
            }
            measure(&format!("{mode}.navigation_dests.{minute}"), &mut samples, || {
                Ok(handlers::navigation_dests(&st, fleet.0)?)
            })?;
            measure(&format!("{mode}.navigation_dests.cached.{minute}"), &mut samples, || {
                Ok(handlers::navigation_dests(&st, fleet.0)?)
            })?;
            measure(&format!("{mode}.navigation_command.{minute}"), &mut samples, || {
                Ok(handlers::pending::navigation(&st, fleet.0)?)
            })?;
            measure(&format!("{mode}.navigation_view.2.{minute}"), &mut samples, || {
                Ok(handlers::pending::navigation_view(
                    &st,
                    fleet.0,
                    navigation_view::NavigationOptions { lazy_dests: true, course_days: 2 },
                )?)
            })?;
            reads.push(json!({"minute":minute,"course":digest(&course)?,
                "projection":digest(&projection.state)?,"destinations":digest(&dests)?,"navigation":digest(&nav)?}));
        }
        if before != digest(&session.to_save())? {
            return Err("只读查询改变了存档".into());
        }
        // H03：海上一天的日结（另开一份，免得影响下面的时钟计时）
        let mut sea = GameSession::from_save(defs.clone(), session.to_save())?;
        for day in 0..3 {
            measure(&format!("{mode}.sea_settlement.{day}"), &mut samples, || Ok(sea.advance_day()?))?;
        }
        st.replace_game(Game {
            last_autosave: session.day(),
            session,
            ai: None,
            speed: 1,
            run_speed: 1,
            resume_speed: None,
            captain: None,
            minute: clock::DEFAULT_MINUTE,
            last_navigation_stop: None,
            book: Default::default(),
            notes: Default::default(),
            clock_speeds: Default::default(),
            upbringing_unlock_notices: Default::default(),
        })?;
        for step in 0..5 {
            measure(&format!("{mode}.clock.{step}"), &mut samples, || Ok(handlers::advance_clock(&st, 18)?))?;
        }
        measure(&format!("{mode}.overview"), &mut samples, || Ok(handlers::overview(&st)?))?;
        let mut prefs = st.settings();
        prefs.navigation_pause = false;
        handlers::save_settings(&st, prefs)?;
        handlers::set_speed(&st, 4)?;
        let to_start = {
            let guard = st.game()?;
            clock::minutes_to_day_start(guard.as_ref().ok_or("game")?.minute)
        };
        if let Ok(mut events) = emitted.lock() {
            events.clear();
        }
        let rollover = Instant::now();
        let step = measure(&format!("{mode}.rollover.nav_course"), &mut samples, || {
            Ok(handlers::advance_clock(&st, to_start)?)
        })?;
        eprintln!("{mode}.rollover.days: {}", step.map_or(0, |s| s.days));
        if let Ok(events) = emitted.lock() {
            samples.push(json!({"stage":format!("{mode}.rollover.events"),"events":events.iter().map(|(kind,at,value)|
                json!({"kind":kind,"ms":at.duration_since(rollover).as_secs_f64()*1000.0,"clock":value})).collect::<Vec<_>>()}));
        }

        let guard = st.game()?;
        let game = guard.as_ref().ok_or("对局消失")?;
        cases.push(json!({"mode":mode,"reads":reads,"clock":game.minute,
            "save":digest(&game.session.to_save())?}));
    }
    // H10b：另用真实长航线，确保量到完整的后两日，而非短航线提前靠港后的空结果。
    if world == "terra16" {
        let mut session = GameSession::from_save(defs.clone(), initial.clone())?;
        let fleet = session.world.flagship(OwnerId::Player).ok_or("flagship")?;
        let from = defs.find_loc("lisbon").ok_or("lisbon")?;
        let dest = defs.find_loc("goa").ok_or("goa")?;
        session.world.state.explore.cells.fill(u64::MAX);
        session.world.fleet_mut(fleet)?.location = manifest_core::world::FleetLocation::Docked(from);
        session.submit_at(
            0,
            Command::Autopilot {
                owner: OwnerId::Player,
                fleet,
                minute: 0,
                dest,
                stop_at_known_edge: false,
                route: Some(manifest_core::navigation::routing::RoutePref::Distance),
            },
        )?;
        let today = session.world.preview_course(fleet, &[], 0)?;
        let ahead = measure("full.course_ahead.2", &mut samples, || Ok(session.world.course_ahead(fleet, 2)?))?;
        eprintln!("full.course_ahead.points: {}, end: {:?}", ahead.points.len(), ahead.end);
        measure("full.course_ahead.future.2", &mut samples, || {
            Ok(session.world.course_ahead_from(fleet, &today, 2)?)
        })?;
        st.replace_game(Game {
            last_autosave: session.day(),
            session,
            ai: None,
            speed: 4,
            run_speed: 4,
            resume_speed: None,
            captain: None,
            minute: clock::DAY_START_MINUTE,
            last_navigation_stop: None,
            book: Default::default(),
            notes: Default::default(),
            clock_speeds: Default::default(),
            upbringing_unlock_notices: Default::default(),
        })?;
        measure("full.navigation_view.2", &mut samples, || {
            Ok(handlers::pending::navigation_view(
                &st,
                fleet.0,
                navigation_view::NavigationOptions { lazy_dests: true, course_days: 2 },
            )?)
        })?;
        if let Ok(mut events) = emitted.lock() {
            events.clear();
        }
        let rollover = Instant::now();
        let step = measure("full.rollover.nav_course", &mut samples, || Ok(handlers::advance_clock(&st, 1440)?))?;
        if let Ok(events) = emitted.lock() {
            samples.push(json!({"stage":"full.rollover.events","days":step.map_or(0,|s|s.days),"events":events.iter().map(|(kind,at,value)|
                json!({"kind":kind,"ms":at.duration_since(rollover).as_secs_f64()*1000.0,"clock":value})).collect::<Vec<_>>()}));
        }
    }
    let mut session = GameSession::from_save(defs.clone(), initial.clone())?;
    let mut daily = Vec::new();
    for day in 0..3 {
        measure(&format!("settlement.{day}"), &mut samples, || Ok(session.advance_day()?))?;
        daily.push(digest(&session.to_save())?);
    }
    write(
        &out.join("report.json"),
        &json!({"world":world,"data_hash":defs.meta.hash,"straighten":defs.rules.autopilot.straighten,
        "initial":digest(&initial)?,"samples":samples,"cases":cases,"daily_saves":daily}),
    )?;
    Ok(())
}
