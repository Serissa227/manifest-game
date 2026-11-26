//! I3 航行读模型：轨迹与预测共用积分器，定点坐标只在 JSON 边界转成小数。
use crate::items_view::label;
use crate::views::Ctx;
use manifest_core::navigation::{CourseStop, Steering, StopKind, SubCell};
use manifest_core::world::{FleetLocation, Voyage};
use manifest_core::{CommandError, FleetId, OwnerId, World};
use serde_json::{Value, json};
pub mod diving;
pub mod visibility;

#[derive(Clone, Debug, serde::Serialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

pub fn stop_view(ctx: Ctx<'_>, world: &World, stop: &CourseStop) -> Value {
    let text = match stop.kind {
        StopKind::SuppliesLow => ctx.reason(&manifest_core::Reason::new("navigation.supplies_low", "（待写）")),
        StopKind::Land => {
            label(ctx, "前方是陆地或封冻海面，已停船", "Land or frozen water ahead; vessel stopped").to_string()
        }
        StopKind::Port => {
            let name = stop
                .loc
                .filter(|id| world.location_visible(*id))
                .and_then(|id| ctx.names.locations.get(id.idx()))
                .map(|l| l.name.as_str())
                .unwrap_or("");
            format!("{}{}", label(ctx, "抵达锚地：", "Anchorage reached: "), name)
        }
        StopKind::Storm => label(ctx, "驶入暴风雨", "Entering a storm").to_string(),
        StopKind::Sight if stop.loc.is_some() => label(ctx, "看见新地点", "New place sighted").to_string(),
        StopKind::Sight => label(ctx, "看见船只。", "A vessel is in sight.").to_string(),
        StopKind::StormAhead => label(ctx, "远处望见风暴团", "A storm cell on the horizon").to_string(),
        StopKind::FogAhead => label(ctx, "远处有一片雾", "A fog bank on the horizon").to_string(),
        StopKind::Overtaken => label(ctx, "海盗追上来了", "The pirates have caught up").to_string(),
        StopKind::Sighting => label(ctx, "靠近了海上的所见", "Alongside something at sea").to_string(),
    };
    json!({"minute":stop.minute,"kind":stop.kind,"loc":stop.loc.filter(|id| world.location_visible(*id)).map(|id| id.0),"text":text})
}

/// 性能报告分别量寻路与估天数；旧、新命令共用这两段。
pub type DestinationPaths =
    (Vec<manifest_core::LocId>, Vec<Result<manifest_core::navigation::autopilot::Pilot, CommandError>>);
pub fn destination_paths(world: &World, fleet: FleetId) -> DestinationPaths {
    let Ok(f) = world.fleet(fleet) else { return (Vec::new(), Vec::new()) };
    let locations: Vec<_> = world
        .visible_locations()
        .filter(|id| {
            let l = world.defs.loc(*id);
            l.is_port() || l.is_site()
        })
        .collect();
    let paths = world.known_sea_paths(f.cell(&world.defs), &locations, true);
    (locations, paths)
}

pub fn destination_estimates(
    ctx: Ctx<'_>,
    world: &World,
    fleet: FleetId,
    locations: Vec<manifest_core::LocId>,
    paths: Vec<Result<manifest_core::navigation::autopilot::Pilot, CommandError>>,
    edge: bool,
) -> Value {
    let Ok(f) = world.fleet(fleet) else { return json!([]) };
    let supplies_days = f.supplies_days(&world.defs);
    json!(locations.into_iter().zip(paths).filter_map(|(id,path)| {
        let path=path.ok()?;
        let mut value=json!({"loc":id.0,"name":ctx.names.loc(id).name,"days":(!path.edge).then(||world.navigation_path_days(fleet,&path.path)),"supplies_days":supplies_days});
        if edge {value["edge"]=json!(path.edge);}
        if let Err(error) = world.check_port_access(f, id) {
            value["blocked"] = json!({"code":error.code(),"text":ctx.error(&error)});
        }
        Some(value)
    }).collect::<Vec<_>>())
}

fn dests_at(ctx: Ctx<'_>, world: &World, fleet: FleetId) -> Value {
    let (locations, paths) = destination_paths(world, fleet);
    destination_estimates(ctx, world, fleet, locations, paths, false)
}

pub fn known_dests(ctx: Ctx<'_>, world: &World, fleet: FleetId, minute: u16) -> Value {
    world.navigation_projection(minute).map(|w| dests_at(ctx, &w, fleet)).unwrap_or_else(|_| json!([]))
}

pub fn preview_course(
    ctx: Ctx<'_>,
    world: &World,
    fleet: FleetId,
    steers: &[Steering],
    minute: u16,
) -> Result<Value, CommandError> {
    let course = world.preview_course(fleet, steers, minute)?;
    let points: Vec<_> =
        course.points.iter().map(|p| (p.pos.x as f64 / 256.0, p.pos.y as f64 / 256.0, p.minute)).collect();
    let stops: Vec<_> = course.stops.iter().map(|s| stop_view(ctx, world, s)).collect();
    Ok(json!({"points":points,"stops":stops}))
}

fn degrees(value: i64) -> String {
    format!("{}°{:02}′", value.abs() / 60, value.abs() % 60)
}

fn lat_lon(ctx: Ctx<'_>, world: &World, pos: SubCell) -> Option<String> {
    let projection = world.defs.nav.grid.rules()?.projection.as_ref()?;
    let latitude = i64::from(projection.north) - (pos.y * i64::from(projection.arcmin_per_cell) + 128) / 256;
    let longitude = i64::from(projection.west) + (pos.x * i64::from(projection.arcmin_per_cell) + 128) / 256;
    let longitude = if world.defs.map.wrap_x { (longitude + 10_800).rem_euclid(21_600) - 10_800 } else { longitude };
    Some(format!(
        "{} {} {} {}",
        label(ctx, if latitude >= 0 { "北纬" } else { "南纬" }, if latitude >= 0 { "N" } else { "S" }),
        degrees(latitude),
        label(ctx, if longitude >= 0 { "东经" } else { "西经" }, if longitude >= 0 { "E" } else { "W" }),
        degrees(longitude)
    ))
}

#[derive(Clone, Copy, Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct NavigationOptions {
    pub lazy_dests: bool,
    pub course_days: u8,
}

pub fn navigation(
    ctx: Ctx<'_>,
    world: &World,
    fleet: FleetId,
    minute: u16,
    cell_km: u32,
) -> Result<Value, CommandError> {
    let mut view = navigation_with(ctx, world, fleet, minute, cell_km, NavigationOptions::default(), 0, "")?;
    if let Some(pilot) = view.get_mut("autopilot").and_then(Value::as_object_mut) {
        pilot.remove("corners");
    }
    Ok(view)
}

#[allow(clippy::too_many_arguments)]
pub fn navigation_with(
    ctx: Ctx<'_>,
    world: &World,
    fleet: FleetId,
    minute: u16,
    cell_km: u32,
    opts: NavigationOptions,
    generation: u64,
    locale: &str,
) -> Result<Value, CommandError> {
    if opts.course_days > 2 {
        return Err(CommandError::InvalidQuantity);
    }
    if !world.defs.manual_navigation {
        return Ok(Value::Null);
    }
    let fleet_before = world.fleet(fleet)?;
    if fleet_before.owner != OwnerId::Player {
        return Err(CommandError::NotOwner);
    }
    if !matches!(fleet_before.location, FleetLocation::AtSea(Voyage::Manual { .. })) {
        return Ok(Value::Null);
    }
    let at = world.navigation_projection(minute)?;
    let f = at.fleet(fleet)?;
    let FleetLocation::AtSea(Voyage::Manual { manual }) = &f.location else { return Ok(Value::Null) };
    let course = at.preview_course(fleet, &[], 0)?;
    let point = |p: &manifest_core::navigation::CoursePoint| [p.pos.x as f64 / 256.0, p.pos.y as f64 / 256.0];
    let mut trail: Vec<_> = course.points.iter().filter(|p| p.minute <= minute).map(point).collect();
    let mut forecast: Vec<_> = course.points.iter().filter(|p| p.minute >= minute).map(point).collect();
    trail.dedup();
    forecast.dedup();
    let stops: Vec<_> = course.stops.iter().filter(|s| s.minute >= minute).map(|s| stop_view(ctx, &at, s)).collect();
    let weather = at.weather_at_pos(manual.pos.cell());
    let input = manifest_core::navigation::course::CourseInput {
        defs: &at.defs,
        fleet: f,
        start: manual,
        from: minute,
        until: minute,
        steers: &[],
        day: at.day(),
        speed_bonus: at.fleet_speed_bonus(fleet),
        mods: at.voyage_mods(fleet),
    };
    use manifest_core::navigation::autopilot::{PilotMode, beat_velocity, creep_velocity};
    let motion = manual.pilot.as_ref().and_then(|p| p.motion());
    let delay = at
        .state
        .creatures
        .delays
        .get(&fleet)
        .filter(|&&day| day > at.day())
        .map(|&day| json!({"kind":"creature","until":{"day":day,"minute":0}}));
    let vector = if delay.is_some() {
        [0; 2]
    } else if let Some(motion) = motion.filter(|m| m.mode == PilotMode::Creep) {
        creep_velocity(manual.pos, motion.aim, at.defs.rules.autopilot.creep_speed)
    } else if motion.is_some_and(|m| m.mode == PilotMode::Beat) {
        beat_velocity(&input, manual, weather)
    } else {
        manifest_core::navigation::course::velocity(&input, manual, weather)
    };
    let scale = f64::from(cell_km) / 24.0 / 1.852 / 10_000.0;
    let cosine = at
        .defs
        .nav
        .grid
        .rules()
        .and_then(|r| r.projection.as_ref())
        .filter(|p| p.lat_scale)
        .map_or(1.0, |p| p.row_cos(manual.pos.cell().y).0 as f64 / 10_000.0);
    let speed = ((vector[0] as f64 * cosine).powi(2) + (vector[1] as f64).powi(2)).sqrt() * scale;
    let force = weather.map_or(0, |w| w.sea.wind_strength.clamp(0, 12));
    let wind = json!({"dir":weather.map_or(0,|w|(u16::from(w.sea.wind_dir)*45+180)%360), "force":force,
        "name":format!("{} {force}",label(ctx,"风力","Wind force"))});
    let current = weather.filter(|w| w.sea.current_strength > 0).map(|w| {
        json!({"dir":u16::from(w.sea.current_dir)*45,
        "speed":w.sea.current_strength as f64 * 0.5 * f64::from(cell_km) * cosine.powi(2) / 24.0 / 1.852})
    });
    let autopilot = manual.autopilot.filter(|id| at.location_visible(*id)).map(|dest| {
        let mode = manual.pilot.as_ref().map_or(PilotMode::Sail, |p| p.mode());
        let since = motion.map_or(u64::from(at.day()) * 1440 + u64::from(minute), |m| m.since);
        let eta = (mode != PilotMode::Wait).then(|| {
            manual.pilot.as_ref().map_or(1, |p| {
                // step 在拉直时指向整段终点；出港不能因此把整段从菜单的原路径估时中跳掉。
                let start =
                    p.line.as_ref().filter(|line| line.hold.is_none()).map_or(p.step.saturating_sub(1), |line| {
                        let previous = line.corners.iter().copied().take_while(|&i| (i as usize) < p.step).last();
                        let index = previous.map_or(0, |i| i as usize);
                        let from = previous.map_or(line.origin, |i| SubCell::center(p.path[i as usize]));
                        let to = SubCell::center(p.path[p.step]);
                        let width = i64::from(at.defs.map.width) * 256;
                        let delta =
                            |x: i64| if at.defs.map.wrap_x { (x + width / 2).rem_euclid(width) - width / 2 } else { x };
                        let u = [i128::from(delta(to.x - from.x)), i128::from(to.y - from.y)];
                        let pos = [i128::from(delta(manual.pos.x - from.x)), i128::from(manual.pos.y - from.y)];
                        let length = (u[0] * u[0] + u[1] * u[1]).max(1);
                        let progress = (pos[0] * u[0] + pos[1] * u[1]).clamp(0, length);
                        index + ((p.step - index) as i128 * progress / length) as usize
                    });
                at.navigation_path_days(fleet, &p.path[start..])
            })
        });
        json!({"dest":dest.0,"dest_name":ctx.names.loc(dest).name,"mode":mode,
            "mode_since":{"day":since / 1440,"minute":since % 1440},"eta_days":eta})
    });
    let sea = sea_view(&at, f, manual, minute, &course);
    let fast = fast_headings(&input, manual, weather);
    let mut view = json!({"fleet":fleet.0,"mode":"manual","day":at.day(),"minute":minute,
        "sky":weather.map(|w| w.sky),"cells":sea.0,"ships":sea.1,"fast":fast,"sightings":sightings_view(&at, f),
        "journal":crate::voyage_view::journal(ctx, &at, fleet),"banter":crate::voyage_view::banter(ctx, &at),
        "pos":Position { x:manual.pos.x as f64 /256.0, y:manual.pos.y as f64 /256.0 },"heading":manual.heading,
        "sail":manual.sail,"speed":speed,"delay":delay,"wind":wind,"current":current,
        "sail_limit":manifest_core::navigation::course::sail_limit_with(&at.defs, f, &input.mods),"trail":trail,"forecast":forecast,"stops":stops,
        "supplies_days":f.supplies_days(&at.defs),"morale":f.morale,"sight":at.navigation_sight(fleet),"ship_sight":at.fleet_sight_cells(fleet),
        "autopilot":autopilot,"lat_lon":lat_lon(ctx,&at,manual.pos)});
    if opts.lazy_dests {
        let key = crate::navigation_dests::DestKey::new(generation, &at, locale, fleet)
            .map_err(|_| CommandError::Internal("navigation.dests_key".into()))?;
        view["dests_rev"] = json!(key.rev());
    } else {
        view["known_dests"] = dests_at(ctx, &at, fleet);
    }
    if opts.course_days > 0 {
        view["course"] = course_from(ctx, &at, fleet, minute, opts.course_days, &course)?;
    }
    if view["autopilot"].is_object()
        && let Some(pilot) = manual.pilot.as_ref()
    {
        let corners: Vec<_> = pilot
            .line
            .as_ref()
            .map(|l| l.corners.iter().filter(|&&i| i as usize >= pilot.step).map(|&i| pilot.path[i as usize]).collect())
            .unwrap_or_else(|| pilot.path.iter().copied().skip(pilot.step).collect());
        view["autopilot"]["corners"] =
            json!(corners.iter().map(|c| [f64::from(c.x) + 0.5, f64::from(c.y) + 0.5]).collect::<Vec<_>>());
    }
    // H02：船况状态区（规则关着时不出现）
    if let Some(wear) = crate::seafaring_view::nav_wear(&at, fleet) {
        view["wear"] = wear;
        // 自动领航的粮水提醒由内核每程接管一次，界面据此跳过逐日暂停，仍展示原常设命令。
        view["wear"]["alert_by_pilot"] =
            json!(manual.pilot.is_some() && at.defs.rules.autopilot.supplies_stop_days > 0);
    }
    // H05：岸与锚地（规则关着时不出现）
    if let Some(shore) = crate::seafaring_view::nav_shore(&at, fleet) {
        view["shore"] = shore;
    }
    Ok(view)
}

/// H04：海上所见——视野 × 2 以内的所见（图上的小标记）、碰上了等选的小卡片、刚结算的结果。开关关着时为 null。
fn sightings_view(at: &World, f: &manifest_core::world::Fleet) -> Value {
    let rules = &at.defs.rules.sightings;
    if !rules.enabled {
        return Value::Null;
    }
    let FleetLocation::AtSea(Voyage::Manual { manual }) = &f.location else { return Value::Null };
    let range = at.navigation_sight(f.id) * 2 * 256;
    let mut marks = Vec::new();
    let mut card = Value::Null;
    for s in at.state.sightings.active.iter().filter(|s| s.fleet == f.id) {
        let Some(def) = rules.def(&s.def) else { continue };
        let d2 = manifest_core::weather_cells::sub_distance2(&at.defs, manual.pos, s.pos);
        if d2 <= range * range {
            marks.push(json!({"id":s.id,"kind":def.kind,"x":s.pos.x as f64 / 256.0,"y":s.pos.y as f64 / 256.0,
                "title":def.title,"hazard":def.kind.hazard(),"touched":s.touched}));
        }
        if s.touched && card.is_null() {
            // 要绕开的：当场已经结算，卡片上直接给结果（暗礁按帆换句子）
            let result = def.kind.hazard().then(|| {
                let o = &def.options[0];
                if s.full_sail { o.result.clone() } else { o.safe.clone().unwrap_or_else(|| o.result.clone()) }
            });
            // 吃了亏的结果（要绕开的那三种当场受损、扣粮水；暗礁没满帆时安全）卡片上用偏红的字
            let e = &def.options[0].effects;
            let harm = def.kind.hazard()
                && (e.damage > 0 || e.supplies < 0 || e.morale < 0 || (s.full_sail && e.damage_full_sail > 0));
            card = json!({"id":s.id,"kind":def.kind,"title":def.title,"text":def.text,"hazard":def.kind.hazard(),
                "result":result,"harm":harm,"options":def.options.iter().map(|o| o.label.clone()).collect::<Vec<_>>()});
        }
    }
    let last = at.state.sightings.last.as_ref().filter(|l| l.fleet == f.id && l.day == at.day()).and_then(|l| {
        let def = rules.def(&l.def)?;
        let o = def.options.get(l.choice)?;
        let mut text = if l.safe { o.safe.clone().unwrap_or_else(|| o.result.clone()) } else { o.result.clone() };
        if l.lucky
            && let Some(lucky) = &o.lucky
        {
            text = format!("{text}{}", lucky.result);
        }
        let e = &o.effects;
        let harm = !l.safe && (e.damage > 0 || e.damage_full_sail > 0 || e.supplies < 0 || e.morale < 0);
        Some(json!({"id":l.id,"title":def.title,"text":text,"harm":harm}))
    });
    json!({"marks":marks,"card":card,"last":last})
}

/// H03：罗经盘上“最快的风角”——当前帆型、当前风下最快的两个航向（风轴两侧各一个；5° 一档）。没有风时为空。
fn fast_headings(
    input: &manifest_core::navigation::course::CourseInput<'_>,
    manual: &manifest_core::navigation::ManualVoyage,
    weather: Option<manifest_core::weather::DayWeather>,
) -> Value {
    let Some(w) = weather.filter(|w| w.sea.wind_strength > 0) else { return json!([]) };
    let mut still = w;
    still.sea.current_strength = 0;
    let from = (u16::from(w.sea.wind_dir) * 45 + 180) % 360;
    let mut probe = manual.clone();
    probe.sail = manifest_core::navigation::Sail::Full;
    let mut best = [(0i64, 0u16); 2];
    for h in (0..360u16).step_by(5) {
        probe.heading = h;
        let v = manifest_core::navigation::course::velocity(input, &probe, Some(still));
        let speed2 = v[0] * v[0] + v[1] * v[1];
        // 风轴的右侧（从来风方向顺时针 0–180°）与左侧各取最快的一个
        let side = usize::from((h + 360 - from) % 360 >= 180);
        if speed2 > best[side].0 {
            best[side] = (speed2, h);
        }
    }
    // 两侧最快的航向挨得很近（横帆船顺风跑最快）时只留更快的一个，盘上不叠两枚
    let mut out: Vec<_> = best.iter().filter(|(s, _)| *s > 0).copied().collect();
    if out.len() == 2 && manifest_core::navigation::course::angle_between(out[0].1, out[1].1) < 30 {
        out.sort_by_key(|(s, h)| (std::cmp::Reverse(*s), *h));
        out.truncate(1);
    }
    json!(out.iter().map(|(_, h)| *h).collect::<Vec<_>>())
}

/// H03：航行视图里看得见的海——天气团（进入视野 × 2 就画）与视野里的别的船。
/// 船：远于视野 2/3 时只是“帆影”（不给种类与大小）；按分钟追击的海盗给当天的航迹（每 15 分钟一点，与日结的结果相同），
/// 别的船给日初与预计日末两点，前端按分钟插值。两个开关都关着时什么也不给。
fn sea_view(
    at: &World,
    f: &manifest_core::world::Fleet,
    manual: &manifest_core::navigation::ManualVoyage,
    minute: u16,
    course: &manifest_core::navigation::Course,
) -> (Value, Value) {
    let defs = &at.defs;
    let sight = at.navigation_sight(f.id);
    let cell = manual.pos.cell();
    let cells: Vec<_> = if defs.rules.weather_cells.enabled {
        at.weather_cells_near(cell, sight * defs.rules.weather_cells.sight_mult)
            .iter()
            .map(|c| {
                json!({"kind":c.kind,"x":c.center.x as f64 / 256.0,"y":c.center.y as f64 / 256.0,
                    "r":c.radius as f64 / 256.0,"dir":u16::from(c.dir) * 45,"id":format!("{}:{}:{}", c.region.0, c.start, c.index)})
            })
            .collect()
    } else {
        Vec::new()
    };
    if !defs.rules.weather_cells.enabled && !defs.rules.pursuit.enabled {
        return (json!(cells), json!([]));
    }
    let width = f64::from(defs.map.width);
    let wrap = defs.map.wrap_x;
    let me = (manual.pos.x as f64 / 256.0, manual.pos.y as f64 / 256.0);
    let dist = |x: f64, y: f64| {
        let mut dx = (x - me.0).abs();
        if wrap {
            dx = dx.min(width - dx);
        }
        dx.max((y - me.1).abs())
    };
    let far = sight as f64;
    let near = far * 2.0 / 3.0;
    let mut ships = Vec::new();
    let tracks =
        if defs.rules.pursuit.enabled { at.pursuit_tracks(f, &course.points, &Default::default()) } else { Vec::new() };
    for p in at.state.battles.pirates.values() {
        let track = tracks.iter().find(|t| t.pirate == p.id);
        let now = track
            .and_then(|t| t.points.get(usize::from(minute)).or(t.points.last()))
            .map_or((f64::from(p.cell.x) + 0.5, f64::from(p.cell.y) + 0.5), |q| {
                (q.x as f64 / 256.0, q.y as f64 / 256.0)
            });
        if dist(now.0, now.1) > far {
            continue;
        }
        let known = dist(now.0, now.1) <= near;
        let points: Vec<_> = track
            .map(|t| t.points.iter().step_by(15).map(|q| [q.x as f64 / 256.0, q.y as f64 / 256.0]).collect())
            .unwrap_or_default();
        ships.push(json!({"id":format!("p{}", p.id),"kind": if known {"pirate"} else {"sail"},
            "size": if known { p.ships.len() } else { 0 },"x":now.0,"y":now.1,"track":points,
            "chasing": track.is_some_and(|t| t.from <= minute),"heading":0}));
    }
    for other in at.state.fleets.values() {
        if other.id == f.id || !matches!(other.location, FleetLocation::AtSea(_)) {
            continue;
        }
        let c = other.cell(defs);
        let (x0, y0) = (f64::from(c.x) + 0.5, f64::from(c.y) + 0.5);
        // 走航线的：沿航线往前估一天的路（按最慢船型的基础航速），前端按分钟插值；别的原地画
        let (x1, y1, heading) = match &other.location {
            FleetLocation::AtSea(Voyage::Route(r)) => {
                let speed = other.ships.iter().map(|s| defs.ship(s.kind).speed.0).min().unwrap_or(0) / 10_000;
                let last = r.path.len().saturating_sub(1);
                let ahead = r.path.get((r.step + speed.max(1) as usize).min(last)).copied().unwrap_or(c);
                let next = r.path.get(r.step + 1).copied().unwrap_or(c);
                (f64::from(ahead.x) + 0.5, f64::from(ahead.y) + 0.5, u16::from(defs.map.dir_between(c, next)) * 45)
            }
            _ => (x0, y0, 0),
        };
        let t = f64::from(minute) / 1440.0;
        let mut dx = x1 - x0;
        if wrap && dx.abs() > width / 2.0 {
            dx -= dx.signum() * width;
        }
        let now = (x0 + dx * t, y0 + (y1 - y0) * t);
        if dist(now.0, now.1) > far {
            continue;
        }
        let known = dist(now.0, now.1) <= near;
        let kind = if !known {
            "sail"
        } else if other.owner == OwnerId::Player {
            "own"
        } else {
            "merchant"
        };
        ships.push(
            json!({"id":format!("f{}", other.id.0),"kind":kind,"size": if known { other.ships.len() } else { 0 },
            "x":now.0,"y":now.1,"from":[x0,y0],"to":[x0 + dx, y1],"heading":heading,"track":[],"chasing":false}),
        );
    }
    // H06：能喊话的船，附上能选的事（价钱、虚张声势的成算、今天用过没有）
    if defs.rules.hail.enabled {
        let targets = at.hail_targets(f.id);
        for s in ships.iter_mut() {
            let id = s["id"].as_str().unwrap_or("");
            let target = if let Some(n) = id.strip_prefix('p').and_then(|n| n.parse().ok()) {
                manifest_core::hail::HailTarget::Pirate(n)
            } else if let Some(n) = id.strip_prefix('f').and_then(|n| n.parse().ok()) {
                manifest_core::hail::HailTarget::Fleet(manifest_core::FleetId(n))
            } else {
                continue;
            };
            if targets.contains(&target) {
                s["hail"] = hail_options(at, f.id, target);
            }
        }
    }
    (json!(cells), json!(ships))
}

/// H06：对一个喊话对象能做的事。`used` 为真时今天已经做过（按钮置灰）。
fn hail_options(at: &World, fleet: FleetId, target: manifest_core::hail::HailTarget) -> Value {
    use manifest_core::hail::{HailAction, HailTarget};
    let rules = &at.defs.rules.hail;
    let day = at.day();
    let used = |a: HailAction| {
        let index = match a {
            HailAction::News => 0,
            HailAction::Supplies(_) => 1,
            HailAction::Convoy => 2,
            HailAction::Bribe => 3,
            HailAction::Bluff => 4,
            HailAction::Fight => 5,
        };
        at.state.hail.used.contains(&(day, target, index))
    };
    let days = rules.supply_days_max.clamp(1, 255) as u8;
    let list: Vec<(HailAction, Value)> = match target {
        HailTarget::Fleet(_) => vec![
            (HailAction::News, json!({})),
            (HailAction::Supplies(days), json!({"cost": at.hail_supply_cost(fleet, i64::from(days)), "days": days})),
            (HailAction::Convoy, json!({"days": rules.convoy_days, "active": at.convoy_active(fleet)})),
        ],
        HailTarget::Pirate(p) => vec![
            (HailAction::Bribe, json!({"cost": at.bribe_cost(fleet)})),
            (HailAction::Bluff, json!({"chance": at.bluff_chance_bp(fleet, p) / 100})),
            (HailAction::Fight, json!({})),
        ],
    };
    json!({"target": target, "options": list.into_iter().map(|(a, mut v)| {
        v["action"] = json!(a);
        v["used"] = json!(used(a));
        v
    }).collect::<Vec<_>>(), "last": at.state.hail.last.filter(|l| l.day == day && l.fleet == fleet && l.target == target)})
}

/// H10b：今日完整分钟点与后几日的抽点共用一个负载。
pub fn course_view(
    ctx: Ctx<'_>,
    world: &World,
    fleet: FleetId,
    steers: &[Steering],
    minute: u16,
    days: u8,
) -> Result<Value, CommandError> {
    if days > 2 {
        return Err(CommandError::InvalidQuantity);
    }
    if world.fleet(fleet)?.owner != OwnerId::Player {
        return Err(CommandError::NotOwner);
    }
    let today = world.preview_course(fleet, steers, minute)?;
    course_from(ctx, world, fleet, minute, days, &today)
}

fn course_from(
    ctx: Ctx<'_>,
    world: &World,
    fleet: FleetId,
    minute: u16,
    days: u8,
    today: &manifest_core::navigation::Course,
) -> Result<Value, CommandError> {
    let points: Vec<_> = today
        .points
        .iter()
        .filter(|p| p.minute >= minute)
        .map(|p| (p.pos.x as f64 / 256.0, p.pos.y as f64 / 256.0, p.minute))
        .collect();
    let stops: Vec<_> = today.stops.iter().filter(|s| s.minute >= minute).map(|s| stop_view(ctx, world, s)).collect();
    let ahead = if days == 0 {
        None
    } else {
        let ahead = world.course_ahead_from(fleet, today, days)?;
        if ahead.points.is_empty() {
            None
        } else {
            Some(
                json!({"step":ahead.step,"points":ahead.points.iter().map(|p|(p.pos.x as f64/256.0,p.pos.y as f64/256.0,p.t)).collect::<Vec<_>>(),
            "barriers":ahead.barriers,"end":ahead.end,"tentative":ahead.tentative}),
            )
        }
    };
    Ok(json!({"fleet":fleet.0,"day":world.day(),"minute":minute,"points":points,"stops":stops,"ahead":ahead}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use manifest_core::nav::climate::{NavigationRules, Projection, ProjectionKind};
    use std::sync::Arc;

    #[test]
    fn projected_coordinates_use_arcminutes_and_the_hemisphere_labels() {
        let mut defs = (*manifest_core::testkit::tiny_defs()).clone();
        let rules = NavigationRules {
            projection: Some(Projection {
                kind: ProjectionKind::Equirect,
                west: -623,
                north: 2787,
                arcmin_per_cell: 30,
                lat_scale: false,
            }),
            ..Default::default()
        };
        defs.nav = Arc::new(
            manifest_core::nav::NavTable::build_with_rules(&defs.map, &defs.regions, defs.locations.len(), &[], rules)
                .unwrap(),
        );
        let world = World::new(Arc::new(defs), manifest_core::ScenarioId(0), 42).unwrap();
        assert_eq!(
            lat_lon(Ctx::plain(&world.defs), &world, SubCell::center(manifest_core::Cell::new(2, 15))).as_deref(),
            Some("北纬 38°42′ 西经 9°08′")
        );
        assert_eq!(degrees(-548), "9°08′");
    }
}
