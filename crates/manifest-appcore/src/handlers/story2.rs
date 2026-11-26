//! I5b 见闻簿：仅公开主角已经获知的内容。
use crate::{AppError, AppState, Msg};
use serde_json::Value;
pub fn gossip(st: &AppState, loc: Option<u16>, limit: Option<u32>) -> Result<Value, AppError> {
    if st.defs().story2.tracks.is_empty() {
        return Err(AppError::Invalid(Msg::new("app.feature_unavailable", "这个世界还没有这项功能")));
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    if loc.is_some_and(|l| !game.view_world().location_visible(manifest_core::LocId(l))) {
        return Err(AppError::Command(manifest_core::CommandError::WrongLocation));
    }
    Ok(crate::story2_view::gossip(st.ctx(), &game.view_world(), loc.map(manifest_core::LocId), limit))
}
