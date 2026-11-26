//! H02 船况、口粮与船员状态的视图（航行视图的状态区、舰队页的船材与刮船底）。字段名与前端 `ipc/types.ts` 的
//! `WearView`、`PortWearView` 一致。规则关着、或不是玩家的舰队时为 None（JSON 里不出现这一项）。
use manifest_core::{FleetId, World};
use serde_json::{Value, json};

/// 航行视图的状态区。
pub fn nav_wear(world: &World, fleet: FleetId) -> Option<Value> {
    if !world.wear_applies(fleet) {
        return None;
    }
    let f = world.fleet(fleet).ok()?;
    let w = world.fleet_wear(fleet);
    let r = &world.defs.rules.voyage_wear;
    let hull = f.ships.iter().map(|s| s.durability.max(0) * 100 / s.max_durability.max(1)).min().unwrap_or(100);
    let promise_date = w.crisis.promise_until.map(|until| {
        let date = world.defs.calendar.date_of(until);
        [(world.defs.rules.world.start_year + i64::from(date.year) - 1) as u32, date.month, date.day]
    });
    Some(json!({
        "hull": hull,
        "rigging": w.rigging_points(),
        "fouling": w.fouling_points(),
        "crew": f.crew,
        "sick": w.sick,
        "fatigue": w.fatigue,
        "fresh_days": w.fresh_days,
        "scurvy_after": world.scurvy_threshold(fleet),
        "timber": w.timber,
        "timber_cap": world.timber_cap(fleet),
        "load_slow": world.load_slow_pct(fleet),
        "speed_pct": world.wear_speed_bp(fleet) / 100,
        "slowdown": w.crisis.slowdown,
        "promise_until": w.crisis.promise_until,
        "promise_date": promise_date,
        "orders": w.orders,
        "cargo": f.cargo_total(),
        "tired": r.tired,
        "exhausted": r.exhausted,
    }))
}

/// H05 岸与锚地：此地能做的差事（做不了的带原因）、营地进度、下网、避风。字段名与前端 `ShoreView` 一致。
/// 规则关着、或不是玩家在海上手动航行的舰队时为 None。
pub fn nav_shore(world: &World, fleet: FleetId) -> Option<Value> {
    use manifest_core::navigation::Sail;
    use manifest_core::world::{FleetLocation, Voyage};
    if !world.shore_applies(fleet) {
        return None;
    }
    let f = world.fleet(fleet).ok()?;
    let FleetLocation::AtSea(Voyage::Manual { manual }) = &f.location else { return None };
    let cell = manual.pos.cell();
    let site = world.shore_site(cell);
    let wind = world.weather_at_pos(cell).map(|w| w.sea.wind_dir);
    let camp = world.state.shore.camps.get(&fleet).map(|c| {
        json!({"elapsed": c.elapsed, "days": c.days(),
            "jobs": c.jobs.iter().map(|j| json!({"task": j.task, "days": j.days, "hands": j.hands})).collect::<Vec<_>>()})
    });
    Some(json!({
        "coast": site.coast,
        "river": site.river,
        "biomes": site.biomes.iter().map(|b| b.code().to_string()).collect::<Vec<_>>(),
        "options": world.shore_options(fleet),
        "camp": camp,
        "nets": world.state.shore.nets.contains(&fleet),
        "nets_working": world.nets_working(fleet),
        "fish": world.fish_tenths(fleet) * 10,
        "anchored": manual.sail == Sail::Furled && manual.pilot.as_ref().is_none_or(|p| p.mode() != manifest_core::navigation::autopilot::PilotMode::Creep),
        "lee": site.coast && wind.is_some_and(|d| world.sheltered(cell, d)),
        "shelter_keep": world.defs.rules.shore_tasks.shelter_keep,
    }))
}

/// 舰队页：船材与船底。
pub fn port_wear(world: &World, fleet: FleetId) -> Option<Value> {
    if !world.wear_applies(fleet) {
        return None;
    }
    let w = world.fleet_wear(fleet);
    Some(json!({
        "timber": w.timber,
        "timber_cap": world.timber_cap(fleet),
        "timber_price": world.defs.rules.voyage_wear.timber_price,
        "fouling": w.fouling_points(),
        "scrape_cost": world.scrape_cost(fleet),
    }))
}
