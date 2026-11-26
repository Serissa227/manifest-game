//! H07 航线规划的读模型：航线预览（多站行程、预计天数、粮水对比、当季风险）、季风历（按月的风与流取样）、航线纪录。
//! 数都由内核算（[`World::plan_route`]、[`manifest_core::navigation::routing::period_weather`]），这里只换成名字与 JSON；
//! 前端只画。
use crate::views::Ctx;
use manifest_core::navigation::routing::{HazardKind, RoutePref, RoutingTier, period_weather};
use manifest_core::{CommandError, FleetId, LocId, OwnerId, RegionId, World};
use serde_json::{Value, json};

/// 季风历的取样间隔（格）：每这么多格取一个点画一条流线。
pub const MONSOON_STEP: u16 = 6;

fn pref_key(p: RoutePref) -> &'static str {
    p.key()
}

/// 前端传来的偏好键：空串或没有为 `Ok(None)`（按命令的缺省），认不出的键原样放在 `Err` 里。
pub fn parse_pref(key: Option<&str>) -> Result<Option<RoutePref>, String> {
    match key.filter(|k| !k.is_empty()) {
        None => Ok(None),
        Some(k) => RoutePref::ALL.into_iter().find(|p| p.key() == k).map(Some).ok_or_else(|| k.to_string()),
    }
}

fn region_name(ctx: Ctx<'_>, r: RegionId) -> String {
    ctx.names.regions.get(r.idx()).map(|r| r.name.clone()).unwrap_or_default()
}

fn loc_name(ctx: Ctx<'_>, id: LocId) -> String {
    ctx.names.locations.get(id.idx()).map(|l| l.name.clone()).unwrap_or_default()
}

/// 航线预览。`world` 是当下这一分钟的投影（在海上时舰队在它此刻的位置）。
pub fn route_plan(
    ctx: Ctx<'_>,
    world: &World,
    fleet: FleetId,
    stops: &[LocId],
    pref: Option<RoutePref>,
) -> Result<Value, CommandError> {
    if stops.is_empty() || stops.len() > 8 {
        return Err(manifest_core::Reason::new("navigation.unknown_dest", "行程要有 1 到 8 站。").rule());
    }
    let plan = world.plan_route(fleet, stops, pref)?;
    let f = world.fleet(fleet)?;
    let periods = world.defs.nav.grid.period_count();
    let legs: Vec<Value> = plan
        .legs
        .iter()
        .map(|l| {
            let record = l.from.and_then(|from| world.state.routing.record(from, l.dest));
            json!({
                "dest": l.dest.0,
                "name": loc_name(ctx, l.dest),
                "from": l.from.map(|f| f.0),
                "path": l.path.iter().map(|c| [c.x, c.y]).collect::<Vec<_>>(),
                "edge": l.edge,
                "minutes": l.minutes,
                "days": manifest_core::navigation::temporal::eta_days(l.minutes),
                "regions": l.regions.iter().map(|r| region_name(ctx, *r)).collect::<Vec<_>>(),
                "record": record.map(|r| json!({"days": r.days(), "minutes": r.minutes, "day": r.day})),
                "corners": l.corners,
                "supplies_days": f.supplies_days(&world.defs),
            })
        })
        .collect();
    let hazards: Vec<Value> = plan
        .hazards
        .iter()
        .map(|h| {
            json!({
                "kind": match h.kind { HazardKind::Storm => "storm", HazardKind::Pirate => "pirate", HazardKind::Frozen => "frozen" },
                "leg": h.leg,
                // 有 12 个导航周期时是月份（1–12），否则是季节（0 春 … 3 冬）
                "month": (periods == 12).then_some(h.period + 1),
                "season": (periods != 12).then_some(h.period),
                "region": h.region.map(|r| region_name(ctx, r)),
                "port": h.port.map(|p| loc_name(ctx, p)),
                "bp": h.bp,
            })
        })
        .collect();
    let [need_food, need_water] = plan.required;
    let [food, water] = plan.have;
    let failed = plan.failed.as_ref().map(
        |(i, e)| json!({"stop": i, "dest": stops.get(*i).map(|d| d.0), "code": e.code(), "message": ctx.error(e)}),
    );
    Ok(json!({
        "fleet": fleet.0,
        "tier": match plan.tier { RoutingTier::Distance => "distance", RoutingTier::Timed => "timed" },
        "pref": pref_key(plan.pref),
        "prefs": world.route_prefs(f).into_iter().map(pref_key).collect::<Vec<_>>(),
        "legs": legs,
        "minutes": plan.minutes,
        "days": plan.days,
        "required": {"food": need_food, "water": need_water},
        "have": {"food": food, "water": water},
        "short": {"food": (need_food - food).max(0), "water": (need_water - water).max(0)},
        "hazards": hazards,
        "failed": failed,
        "month": (periods == 12).then(|| world.defs.nav.grid.period_on(world.day()) + 1),
        "supplies_days": f.supplies_days(&world.defs),
    }))
}

/// 季风历：某个导航周期（寰宇是月份 1–12；缺省为当前）各取样点的风与流。只取已有海图的海区——
/// 玩家揭开过的海格，或买过海图的海区里的海格。每点 `[x, y, 风去向(0–7), 风力, 流去向, 流强]`。
pub fn monsoon(world: &World, month: Option<u8>) -> Value {
    let defs = &world.defs;
    let grid = &defs.nav.grid;
    let periods = grid.period_count();
    let now = grid.period_on(world.day());
    let period = month.map(|m| usize::from(m.max(1)) - 1).filter(|p| *p < periods).unwrap_or(now);
    let map = &defs.map;
    let explore = &world.state.explore;
    let mut points = Vec::new();
    let half = MONSOON_STEP / 2;
    for y in (half..map.height).step_by(usize::from(MONSOON_STEP)) {
        for x in (half..map.width).step_by(usize::from(MONSOON_STEP)) {
            let c = manifest_core::Cell::new(x, y);
            if !map.is_sea(c) {
                continue;
            }
            let Some(region) = map.region_of(c) else { continue };
            if !explore.is_revealed(map.idx(c)) && !explore.charts.contains(&region) {
                continue;
            }
            let Some(w) = period_weather(defs, region, period) else { continue };
            points.push(json!([x, y, w.wind_dir, w.wind_strength, w.current_dir, w.current_strength]));
        }
    }
    json!({
        "periods": periods,
        "period": period,
        "now": now,
        "step": MONSOON_STEP,
        "points": points,
    })
}

/// 航线纪录（按出发港、目的港排序），到港总结（H08）与航线预览用。
pub fn route_records(ctx: Ctx<'_>, world: &World) -> Value {
    let records: Vec<Value> = world
        .state
        .routing
        .records
        .iter()
        .filter(|r| world.location_visible(r.from) && world.location_visible(r.to))
        .map(|r| {
            json!({
                "origin": r.from.0, "origin_name": loc_name(ctx, r.from),
                "dest": r.to.0, "name": loc_name(ctx, r.to),
                "days": r.days(), "minutes": r.minutes, "day": r.day,
            })
        })
        .collect();
    json!({"enabled": world.defs.rules.routing.enabled, "records": records})
}

/// 只给玩家自己的舰队看预览。
pub fn check_owner(world: &World, fleet: FleetId) -> Result<(), CommandError> {
    if world.fleet(fleet)?.owner != OwnerId::Player {
        return Err(CommandError::NotOwner);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use manifest_core::world::FleetLocation;
    use manifest_core::{Cell, ScenarioId};
    use std::sync::Arc;

    fn world() -> (World, FleetId) {
        let mut defs = (*manifest_core::testkit::tiny_defs()).clone();
        defs.manual_navigation = true;
        defs.rules.routing.enabled = true;
        defs.rules.explore.sight = 0;
        for s in &mut defs.regions[0].seasons {
            s.storm_bp = 1_500;
        }
        let mut w = World::new(Arc::new(defs), ScenarioId(0), 42).unwrap();
        let id = w.fleets_of(OwnerId::Player).next().unwrap().id;
        w.fleet_mut(id).unwrap().location = FleetLocation::Docked(LocId(0));
        (w, id)
    }

    #[test]
    fn route_plan_json_names_legs_and_marks_short_supplies_and_storms() {
        let (mut w, id) = world();
        w.state.explore.cells.fill(u64::MAX);
        w.fleet_mut(id).unwrap().food = 0;
        let ctx = Ctx::plain(&w.defs);
        let v = route_plan(ctx, &w, id, &[LocId(1)], None).unwrap();
        assert_eq!(v["tier"], "distance", "没有领航员");
        assert_eq!(v["prefs"], json!(["distance"]));
        assert_eq!(v["legs"][0]["name"], w.defs.loc(LocId(1)).name.as_str());
        assert!(v["legs"][0]["path"].as_array().unwrap().len() > 1);
        assert!(v["short"]["food"].as_i64().unwrap() > 0, "没带粮：缺口为正");
        assert!(v["hazards"].as_array().unwrap().iter().any(|h| h["kind"] == "storm"), "西海风暴多：{v}");
        assert_eq!(v["failed"], Value::Null);
        // 写了用不了的偏好：内核拒绝
        assert!(route_plan(ctx, &w, id, &[LocId(1)], Some(RoutePref::Safe)).is_err());
        assert!(route_plan(ctx, &w, id, &[], None).is_err());
        assert_eq!(parse_pref(Some("coastal")), Ok(Some(RoutePref::Coastal)));
        assert_eq!(parse_pref(Some("")), Ok(None));
        assert!(parse_pref(Some("bogus")).is_err());
    }

    #[test]
    fn monsoon_samples_only_charted_waters_and_follows_the_requested_month() {
        let (mut w, _) = world();
        w.state.explore.cells.fill(0);
        assert_eq!(monsoon(&w, None)["points"], json!([]), "还没有海图：一个点都没有");
        for y in 0..8u16 {
            for x in 0..8u16 {
                let i = w.defs.map.idx(Cell::new(x, y));
                w.state.explore.cells[i / 64] |= 1 << (i % 64);
            }
        }
        let some = monsoon(&w, None)["points"].as_array().unwrap().len();
        assert!(some > 0);
        w.state.explore.cells.fill(u64::MAX);
        let all = monsoon(&w, Some(3));
        assert!(all["points"].as_array().unwrap().len() > some);
        assert_eq!(all["period"], 2);
        assert_eq!(all["periods"], 4, "只有四季的世界");
        let p = &all["points"][0];
        let x = p[0].as_u64().unwrap() as u16;
        let y = p[1].as_u64().unwrap() as u16;
        let region = w.defs.map.region_of(Cell::new(x, y)).unwrap();
        assert_eq!(p[2], w.defs.regions[region.idx()].seasons[2].wind_dir);
    }
}
