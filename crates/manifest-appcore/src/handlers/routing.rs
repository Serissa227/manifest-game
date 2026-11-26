//! H07 航线规划的处理函数：航线预览、季风历、航线纪录。只读，不改世界状态。
use super::with_game;
use crate::state::AppState;
use crate::{AppError, Msg, routing_view};
use manifest_core::{FleetId, LocId};
use serde::Deserialize;
use serde_json::Value;

/// 航线预览的请求：舰队、依次经停的各站（最后一站是终点）与偏好键（`distance` / `fastest` / `safe` / `coastal`，空为缺省）。
#[derive(Clone, Debug, Deserialize)]
pub struct RoutePlanRequest {
    pub fleet: u32,
    pub stops: Vec<u16>,
    #[serde(default)]
    pub pref: Option<String>,
}

fn unavailable() -> AppError {
    AppError::Invalid(Msg::new("app.feature_unavailable", "这个世界还没有这项功能"))
}

/// 航线预览（手动航行的世界）。舰队在海上时从它此刻的位置算。
pub fn route_plan(st: &AppState, req: RoutePlanRequest) -> Result<Value, AppError> {
    let locale = st.locale();
    with_game(st, |g| {
        if !g.session.world.defs.manual_navigation {
            return Err(unavailable());
        }
        let pref = routing_view::parse_pref(req.pref.as_deref())
            .map_err(|_| AppError::Invalid(Msg::new("app.fleet_or_dest", "舰队或目的地无效")))?;
        let world = g.view_world();
        routing_view::check_owner(&world, FleetId(req.fleet)).map_err(AppError::Command)?;
        let stops: Vec<LocId> = req.stops.iter().map(|s| LocId(*s)).collect();
        routing_view::route_plan(st.resources().locales.ctx(locale), &world, FleetId(req.fleet), &stops, pref)
            .map_err(AppError::Command)
    })
}

/// 季风历：`month` 为 1–12（只有四季的世界为 1–4），缺省为当前。
pub fn monsoon(st: &AppState, month: Option<u8>) -> Result<Value, AppError> {
    with_game(st, |g| {
        if !g.session.world.defs.manual_navigation {
            return Err(unavailable());
        }
        Ok(routing_view::monsoon(&g.view_world(), month))
    })
}

/// 航线纪录。
pub fn route_records(st: &AppState) -> Result<Value, AppError> {
    let locale = st.locale();
    with_game(st, |g| Ok(routing_view::route_records(st.resources().locales.ctx(locale), &g.view_world())))
}
