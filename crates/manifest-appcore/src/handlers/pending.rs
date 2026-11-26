//! 第九批接线的过渡响应；两个外壳共用，不制造尚未实现的玩法状态。

use crate::{AppError, AppState, Msg};
use serde_json::Value;

/// 沿用应用层 Msg 的本地化错误键与外壳的 rejected 响应。
fn unavailable() -> AppError {
    AppError::Invalid(Msg::new("app.feature_unavailable", "这个世界还没有这项功能"))
}

pub fn upbringing(st: &AppState) -> Result<Value, AppError> {
    let mut game = st.game()?;
    let Some(game) = game.as_mut() else { return Ok(Value::Null) };
    let mut view = crate::upbringing_view::upbringing_with_name(
        st.ctx(),
        &game.view_world(),
        game.captain.as_ref().map(|c| c.name.as_str()),
    );
    if !view.is_null() {
        game.upbringing_unlock_notices.filter(&mut view);
    }
    Ok(view)
}

pub fn auto_plan(st: &AppState, preset: String) -> Result<Value, AppError> {
    if st.defs().upbringing.families.is_empty() {
        return Err(unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    if !game.session.world.upbringing_active() {
        return Err(unavailable());
    }
    crate::upbringing_view::auto_plan(&game.view_world(), &preset).map_err(AppError::Command)
}

pub fn contest(st: &AppState, key: String) -> Result<Value, AppError> {
    with_contests(st, |w| crate::upbringing_view::contest(st.ctx(), w, &key))
}

/// 小游戏照现在的输入能加几分、约多少能赢（只读，不结算）。
pub fn contest_preview(st: &AppState, key: String, moves: Vec<Value>) -> Result<Value, AppError> {
    with_contests(st, |w| crate::upbringing_view::contest_preview(st.ctx(), w, &key, &moves))
}

/// 已经结算的比赛：名次怎么来的（各人的分、临场发挥；给了交卷时的输入还讲到每一步）。
pub fn contest_outcome(st: &AppState, key: String, moves: Option<Vec<Value>>) -> Result<Value, AppError> {
    with_contests(st, |w| crate::upbringing_view::contest_outcome(st.ctx(), w, &key, moves.as_deref()))
}

/// 比赛的三个查询共用的门槛：这个世界有比赛、有对局、正在养成。
fn with_contests(
    st: &AppState,
    query: impl FnOnce(&manifest_core::World) -> Result<Value, manifest_core::CommandError>,
) -> Result<Value, AppError> {
    if st.defs().upbringing.contests.is_empty() {
        return Err(unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    if !game.session.world.upbringing_active() {
        return Err(unavailable());
    }
    query(&game.view_world()).map_err(AppError::Command)
}

pub fn endings(st: &AppState) -> Result<Value, AppError> {
    if st.defs().upbringing.endings.is_empty() {
        return Err(unavailable());
    }
    if let Some(game) = st.game()?.as_ref() {
        st.collect_ending(&game.session.world)?;
    }
    let got = st.collected_endings()?;
    Ok(
        serde_json::json!({"endings":st.ctx().names.upbringing.endings.iter().map(|e|{let has=got.contains(&e.key);serde_json::json!({"key":e.key,"title":e.title,"text":has.then_some(&e.text),"got":has,"family":e.family})}).collect::<Vec<_>>() }),
    )
}

pub fn persons(st: &AppState, loc: Option<u16>) -> Result<Value, AppError> {
    if st.defs().cast.persons.is_empty() {
        return Err(unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    if loc.is_some_and(|l| !game.view_world().location_visible(manifest_core::LocId(l))) {
        return Err(AppError::Command(manifest_core::CommandError::WrongLocation));
    }
    Ok(crate::cast_view::persons_with_name(
        st.ctx(),
        &game.view_world(),
        loc.map(manifest_core::LocId),
        game.captain.as_ref().map(|c| c.name.as_str()),
    ))
}

pub fn person(st: &AppState, key: String) -> Result<Value, AppError> {
    if st.defs().cast.persons.is_empty() {
        return Err(unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    let world = game.view_world();
    let mut detail =
        crate::cast_view::person_with_name(st.ctx(), &world, &key, game.captain.as_ref().map(|c| c.name.as_str()))
            .ok_or_else(|| AppError::Command(manifest_core::CommandError::NotFound(key.clone())))?;
    detail["chat"] = serde_json::Value::Null;
    if game.ai.as_ref().is_some_and(|a| a.pipeline.mode() == manifest_ai::AiMode::Live) && detail["here"] == true {
        let used = world
            .state
            .cast
            .persons
            .get(&key)
            .filter(|p| p.interactions.day == Some(world.day()))
            .map(|p| p.interactions.talks)
            .unwrap_or(0);
        let available = game.ai.as_ref().is_some_and(|a| {
            let budget = a.pipeline.budget_in(world.day(), &world.defs.calendar);
            budget.calls_used < budget.calls_limit && budget.tokens_used < budget.tokens_limit
        });
        let pending = game.notes.contains_key(super::chat::PENDING_CHAT);
        // 只为试探准入；这句话不会发出去，也不会显示。
        let free =
            manifest_core::summary::ai::check_free(&world, manifest_core::OwnerId::Player, &key, "你好。").is_ok();
        let allowed = available && !pending && free;
        let left = manifest_core::cast::interactions::TALKS_PER_DAY.saturating_sub(used);
        detail["chat"] = serde_json::json!({"enabled":allowed,"left_today":left});
        if !allowed {
            let reason = if !available {
                super::chat::BUDGET_TEXT
            } else if pending {
                super::chat::BUSY_TEXT
            } else if left == 0 {
                "今天已经和这个人说了不少话，明天再聊。"
            } else {
                "眼下不便和这个人攀谈。"
            };
            detail["chat"]["blocked_reason"] = serde_json::json!(reason);
        }
    }
    Ok(detail)
}

pub fn relationships(st: &AppState) -> Result<Value, AppError> {
    if st.defs().cast.persons.is_empty() {
        return Err(unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    Ok(crate::cast_view::relationships(st.ctx(), &game.view_world()))
}

pub fn story_log(st: &AppState) -> Result<Value, AppError> {
    if st.defs().story2.tracks.is_empty() {
        return Err(unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    Ok(crate::story_log_view::story_log(st.ctx(), &game.view_world()))
}

pub fn timeline(st: &AppState) -> Result<Value, AppError> {
    if st.defs().history.is_empty() {
        return Err(unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    Ok(crate::history_view::timeline(st.ctx(), &game.session.world))
}

pub fn campaign(st: &AppState, key: String) -> Result<Value, AppError> {
    if st.defs().history.is_empty() {
        return Err(unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    crate::history_view::campaign(st.ctx(), &game.session.world, &key).ok_or_else(unavailable)
}

pub fn chronicle(st: &AppState) -> Result<Value, AppError> {
    if st.defs().history.is_empty() {
        return Err(unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    Ok(crate::history_view::chronicle(st.ctx(), &game.session.world))
}

pub fn societies(st: &AppState) -> Result<Value, AppError> {
    if st.defs().societies.is_empty() {
        return Err(unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    Ok(crate::societies_view::societies(st.ctx(), &game.view_world()))
}

pub fn arcana(st: &AppState) -> Result<Value, AppError> {
    if st.defs().arcana.is_empty() {
        return Err(unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    Ok(crate::arcana_view::arcana(st.ctx(), &game.view_world()))
}

pub fn ideas(st: &AppState, loc: u16) -> Result<Value, AppError> {
    if st.defs().ideas.is_empty() {
        return Err(unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    let (world, loc) = (&game.session.world, manifest_core::LocId(loc));
    // 没到过或没有记载的港也回一个对象（`none` 字段写明是哪一种），不回空值。
    Ok(crate::history_view::ideas(st.ctx(), world, loc)
        .unwrap_or_else(|| crate::history_view::ideas_none(st.ctx(), world, loc)))
}

pub fn legend_ships(st: &AppState) -> Result<Value, AppError> {
    if st.defs().legend_ships.is_empty() {
        return Err(unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    Ok(crate::legend_ships_view::legend_ships(st.ctx(), &game.view_world()))
}

pub fn realms(st: &AppState) -> Result<Value, AppError> {
    if st.defs().realms.is_empty() {
        return Err(unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    Ok(crate::realms_view::realms(st.ctx(), &game.view_world()))
}

pub fn navigation(st: &AppState, fleet: u32) -> Result<Value, AppError> {
    crate::view_cache::navigation(st, fleet)
}

pub use super::preview_course;

/// H10b：旧 navigation 保留；新选项独立进入缓存键。
pub fn navigation_view(
    st: &AppState,
    fleet: u32,
    opts: crate::navigation_view::NavigationOptions,
) -> Result<Value, AppError> {
    if opts.course_days > 2 {
        return Err(AppError::Command(manifest_core::CommandError::InvalidQuantity));
    }
    let guard = st.game()?;
    let Some(game) = guard.as_ref() else { return Ok(Value::Null) };
    let locale = st.locale();
    let key =
        crate::view_cache::ViewKey::new(st, game, locale, crate::view_cache::Query::NavigationWith { fleet, opts })?;
    st.cached_view(key, || {
        crate::navigation_view::navigation_with(
            st.resources().locales.ctx(locale),
            &game.session.world,
            manifest_core::FleetId(fleet),
            crate::clock::since_day_start(game.minute) as u16,
            st.resources().map_resource().cell_km,
            opts,
            st.generation(),
            locale.code(),
        )
        .map_err(AppError::Command)
    })
}
