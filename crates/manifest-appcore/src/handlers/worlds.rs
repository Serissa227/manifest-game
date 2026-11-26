//! 多世界开局命令；重建资源和推演成功后才交接当前对局。

use super::*;
pub use manifest_core::scenario::NewGameRequest;

pub fn world_catalog(st: &AppState) -> Result<views::WorldCatalog, AppError> {
    let current = st.game()?.as_ref().map(|g| g.session.world.defs.world_key.clone());
    let locale = st.locale();
    let worlds = st
        .worlds()
        .visible()
        .iter()
        .filter_map(|key| st.worlds().get(key).ok().map(|r| views::world_catalog::world_card(r, locale)))
        .collect();
    Ok(views::WorldCatalog { current, worlds })
}

pub fn select_world(st: &AppState, world: String) -> Result<views::StaticView, AppError> {
    let _transition = st.transition()?;
    let resources = st.select_world(&world)?;
    Ok(super::static_data_for(st, resources))
}

pub fn new_world_game(st: &AppState, mut request: NewGameRequest) -> Result<Overview, AppError> {
    let _transition = st.transition()?;
    let resources = st.worlds().get(&request.world)?;
    if resources.defs.find_scenario(&request.scenario).is_none() {
        return Err(AppError::Invalid(
            Msg::new("app.unknown_scenario", format!("未知剧本：{}", request.scenario))
                .arg("scenario", request.scenario),
        ));
    }
    request.seed = Some(opening_seed(request.seed));
    let custom = request
        .captain
        .as_ref()
        .map(|c| validate_custom_captain(CaptainView { name: c.name.trim().into(), portrait: c.look }))
        .transpose()?;
    let session = GameSession::new_world(resources.defs.clone(), request, |progress| {
        st.emit("bootstrap", serde_json::json!({ "day": progress.day, "total": progress.total }));
    })
    .map_err(|error| {
        let code = match &error {
            manifest_sim::SimError::Core(core) => core.code(),
            _ => "internal",
        };
        eprintln!("[manifest] 开局失败（{code}）：{}", error.to_string().replace(['\r', '\n'], " "));
        AppError::Invalid(
            Msg::new("app.invalid_start", format!("开局失败，请检查剧本、主角与自创资料（{code}）")).arg("code", code),
        )
    })?;
    let captain = custom.or_else(|| {
        let sc = &resources.locales.get(st.locale()).defs.scenarios[session.world.state.scenario.idx()];
        sc.hero.as_ref().map(|h| CaptainView { name: h.name.clone(), portrait: h.look })
    });
    let captain = if session.start.opening.as_ref().is_some_and(|r| r.template.is_some()) {
        captain.map(validate_custom_captain).transpose()?
    } else {
        captain
    };
    let game = Game {
        last_autosave: session.day(),
        session,
        ai: st.build_ai_for(resources)?,
        speed: 0,
        resume_speed: None,
        run_speed: crate::settings::nearest_tier(st.settings().speed),
        captain,
        minute: DEFAULT_MINUTE,
        last_navigation_stop: None,
        book: ForecastBook::default(),
        notes: Default::default(),
        clock_speeds: Default::default(),
        upbringing_unlock_notices: Default::default(),
    };
    st.replace_game_with(game, |g| make_overview(st, g))
}

/// 旧命令和新命令都把生成的种子写入存档；内核始终只使用明确的种子。
pub(super) fn opening_seed(seed: Option<u64>) -> u64 {
    seed.unwrap_or_else(|| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        now ^ 0x9E37_79B9_7F4A_7C15
    })
}

/// 自创模板允许 24 字姓名（I1 / 内核），普通外貌和不可见字符规则沿用旧入口。
pub(super) fn validate_custom_captain(captain: CaptainView) -> Result<CaptainView, AppError> {
    let name = captain.name.trim().to_string();
    if name.chars().count() > HERO_NAME_MAX {
        return Err(AppError::Invalid(Msg::new("app.captain_long", "主角姓名最长 24 个字").arg("max", "24")));
    }
    if name.chars().any(|c| c.is_control() || invisible_format(c)) {
        return Err(AppError::Invalid(Msg::new("app.captain_control", "主角姓名不能包含控制字符")));
    }
    let checked = validate_captain(CaptainView {
        name: name.chars().take(CAPTAIN_NAME_MAX).collect(),
        portrait: captain.portrait,
    })?;
    if !is_ordinary_portrait(checked.portrait) {
        return Err(AppError::Invalid(Msg::new("app.captain_ordinary", "自创主角须使用普通外貌")));
    }
    Ok(CaptainView { name, portrait: checked.portrait })
}
