//! H08 航海日志、航程总结与甲板闲话的读模型。
//!
//! 航海日志的条目就是这一程期间、与这支舰队有关的世界日志，按 [`JOURNAL`] 分类表归集：
//! **以后新加的日志种类（例如甲线 H02 的船况、口粮、船员状态）只要在表里登记一行就会出现在航海日志里**。
use crate::views::{Ctx, log_view_in};
use manifest_core::world::World;
use manifest_core::{FleetId, OwnerId};
use serde_json::{Value, json};

/// 日志种类 → 航海日志的分类（weather 天气、sight 看见、decision 决定、loss 损耗、port 到港）。
pub const JOURNAL: &[(&str, &str)] = &[
    ("StormSighted", "weather"),
    ("FogSighted", "weather"),
    ("LocationSighted", "sight"),
    ("Discovered", "sight"),
    ("ShookOff", "sight"),
    ("Hailed", "decision"),
    ("SightingChosen", "decision"),
    ("LandingStarted", "decision"),
    // H05 岸与锚地：派人上岸、差事做完
    ("ShoreStarted", "decision"),
    ("ShoreDone", "decision"),
    // H02 船况与船员（事故、进水、坏血病、怠工……）、登陆与岸上差事的伤病
    ("VoyageWear", "loss"),
    ("LandingRisk", "loss"),
    ("Storm", "loss"),
    ("Starvation", "loss"),
    ("Disease", "loss"),
    ("Mutiny", "loss"),
    ("NavalBattle", "loss"),
    ("NavigationStopped", "loss"),
    ("Arrived", "port"),
    // H07 航线纪录：首航与破纪录
    ("RouteFirst", "port"),
    ("RouteRecord", "port"),
    // T03 商馆代办：代办替你成交的（航程期间、到港时都看得到）
    ("AgencyFilled", "port"),
    ("AutopilotCreep", "decision"),
    ("AutopilotWait", "weather"),
];

/// 航海日志最多给几条（新的在后）。
const JOURNAL_KEEP: usize = 60;

fn category(kind: &str) -> Option<&'static str> {
    JOURNAL.iter().find(|(k, _)| *k == kind).map(|(_, c)| *c)
}

/// 这一条日志是不是这支舰队的（日志里带 fleet 字段的看 fleet；不带的只认玩家的“看见”与“发现”）。
fn about(value: &Value, fleet: FleetId) -> bool {
    let Some(fields) = value.as_object().and_then(|m| m.values().next()).and_then(|v| v.as_object()) else {
        return false;
    };
    match fields.get("fleet") {
        Some(f) => f.as_u64() == Some(u64::from(fleet.0)),
        None => fields.get("owner").and_then(|o| o.as_str()) == Some("player"),
    }
}

/// 航海日志（航行视图的侧栏）：这一程从哪天开始、从哪里出发、条目。开关关着或没有一程时为 null。
pub fn journal(ctx: Ctx<'_>, world: &World, fleet: FleetId) -> Value {
    if !world.defs.rules.voyage_log.enabled {
        return Value::Null;
    }
    let trip = world.state.voyage_log.trips.get(&fleet);
    let start = trip.map_or(world.day(), |t| t.start_day);
    let mut entries: Vec<Value> = world
        .state
        .log
        .iter()
        .filter(|e| e.day >= start)
        .filter_map(|e| {
            let value = serde_json::to_value(&e.kind).ok()?;
            let kind = value.as_object()?.keys().next().cloned().or_else(|| value.as_str().map(str::to_owned))?;
            let cat = category(&kind)?;
            about(&value, fleet).then(|| {
                let v = log_view_in(ctx, world, e);
                json!({"day": e.day, "cat": cat, "kind": v.kind, "args": v.args})
            })
        })
        .collect();
    if entries.len() > JOURNAL_KEEP {
        entries.drain(0..entries.len() - JOURNAL_KEEP);
    }
    let from = trip.and_then(|t| t.from).filter(|l| world.location_visible(*l)).map(|l| ctx.names.loc(l).name.clone());
    json!({"start_day": start, "from": from, "distance": trip.map_or(0.0, |t| t.distance as f64 / 256.0), "entries": entries})
}

/// 到港的航程总结（概览里给，界面弹一次）。开关关着或没有时为 None。
pub fn trip_summary(ctx: Ctx<'_>, world: &World) -> Option<Value> {
    if !world.defs.rules.voyage_log.enabled {
        return None;
    }
    let s = world.state.voyage_log.last.as_ref()?;
    let fleet = world.fleet(s.fleet).ok().filter(|f| f.owner == OwnerId::Player)?;
    let name = |l: manifest_core::LocId| ctx.names.loc(l).name.clone();
    let logs: Vec<String> = world
        .state
        .log
        .iter()
        .filter(|e| e.day >= s.start_day && e.day <= s.end_day)
        .filter_map(|e| {
            let value = serde_json::to_value(&e.kind).ok()?;
            about(&value, s.fleet).then(|| value.as_object()?.keys().next().cloned()).flatten()
        })
        .collect();
    let count = |k: &str| logs.iter().filter(|x| x.as_str() == k).count();
    Some(json!({
        "id": format!("{}:{}:{}", s.fleet.0, s.start_day, s.end_day),
        "fleet": s.fleet.0,
        "fleet_name": format!("#{}", fleet.id.0),
        "from": s.from.map(name),
        "to": name(s.to),
        "days": s.days,
        "distance": s.distance as f64 / 256.0,
        "hull_lost": s.hull_lost,
        "crew_change": s.crew_change,
        "cash_change": s.cash_change,
        "cargo_change": s.cargo_change,
        "sightings": count("SightingChosen"),
        "hails": count("Hailed"),
        "storms": count("Storm"),
        "shook_off": count("ShookOff"),
        // H07 的航线纪录：这一对港口的最短航时（天）；这一程立下了首航纪录或破了纪录
        "record_days": s.record_days.or_else(|| {
            s.from.and_then(|f| world.state.routing.record(f, s.to)).map(|r| r.days())
        }),
        "record_broken": s.record_broken || count("RouteRecord") > 0,
        "record_first": count("RouteFirst") > 0,
        // T03：这一程期间代办替你成交了几笔
        "agency_fills": count("AgencyFilled"),
    }))
}

/// 甲板闲话：今天这一句（说话人、句子、可选的小互动）。开关关着或没有时为 null。
pub fn banter(ctx: Ctx<'_>, world: &World) -> Value {
    let rules = &world.defs.rules.banter;
    if !rules.enabled {
        return Value::Null;
    }
    let Some(line) = world.state.banter.current.as_ref().filter(|l| l.day + 1 >= world.day()) else {
        return Value::Null;
    };
    let Some(def) = rules.defs.iter().find(|d| d.key == line.key) else { return Value::Null };
    let speaker = line.mate.and_then(|m| ctx.names.mates.get(m.idx())).map(|m| m.name.clone());
    json!({
        "id": format!("{}:{}", line.day, line.key),
        "speaker": speaker,
        "text": def.text,
        "reply": def.reply.as_ref().map(|r| json!({"label": r.label, "answer": r.answer})),
        "replied": line.replied,
    })
}
