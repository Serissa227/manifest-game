//! 处理函数：界面的全部操作。只依赖 [`AppState`]，不依赖 Tauri，测试可直接调用。

mod chat;
mod harbor;
pub(crate) use harbor::harbor_rule;
use harbor::{hold_in_port, port_hold_view, resume_after_departure};
pub mod pending;
mod routing;
pub use chat::{PersonaChatReply, persona_chat};
pub use routing::{RoutePlanRequest, monsoon, route_plan, route_records};
pub mod story2;
mod worlds;
use worlds::opening_seed;
pub use worlds::{NewGameRequest, new_world_game, select_world, world_catalog};

use crate::clock::{self, ClockView, DAY_START_MINUTE, DEFAULT_MINUTE};
use crate::forecast::{self, BookView, ForecastBook, PinRequest, SeriesView};
use crate::settings::{AppSettings, ArrivalPause, SPEEDS, key_account, speeds_text};
use crate::state::{AppState, Game, schedule_commands};
use crate::views::{self, CaptainView, Ctx, Overview, PLAYER};
use crate::{AppError, Msg};
use manifest_ai::pipeline::TaskExtra;
use manifest_ai::{
    AiMode, AiPipeline, AiSettings, AuditEntry, BudgetStatus, Proposal, ProviderKind, Secret, TaskRequest,
};
use manifest_core::defs::HERO_LOOK_MIN;
use manifest_core::ids::*;
use manifest_core::market::{Side, TradeQuote};
use manifest_core::{Command, CommandOutcome, ScenarioId};
use manifest_sim::{GameSession, storage};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;

fn with_game<T>(st: &AppState, f: impl FnOnce(&mut Game) -> Result<T, AppError>) -> Result<T, AppError> {
    let mut guard = st.game()?;
    let game = guard.as_mut().ok_or(AppError::NoGame)?;
    let result = f(game);
    st.collect_ending(&game.session.world)?;
    result
}

fn ai_mode_name(game: &Game) -> String {
    let mode = game.ai.as_ref().map(|a| a.pipeline.mode()).unwrap_or(AiMode::Off);
    format!("{mode:?}").to_lowercase()
}

fn budget(game: &Game) -> Option<BudgetStatus> {
    game.ai.as_ref().map(|a| a.pipeline.budget_in(game.session.day(), &game.session.world.defs.calendar))
}

fn make_overview(st: &AppState, game: &Game) -> Overview {
    let o = read_overview(st, game);
    st.publish_overview(&o);
    o
}

fn read_overview(st: &AppState, game: &Game) -> Overview {
    let mut o = make_overview_in(st.ctx(), game);
    (o.epoch, o.rev) = st.stamp();
    o
}

/// 概览（名字按 `ctx` 的语言）。
fn make_overview_in(ctx: Ctx<'_>, game: &Game) -> Overview {
    let projected = game.view_world();
    let mut o = views::overview_in(ctx, &projected, game.speed, ai_mode_name(game), budget(game));
    o.chat = game
        .notes
        .get(chat::PENDING_CHAT)
        .or_else(|| game.notes.get(chat::FALLBACK_CHAT))
        .and_then(|s| serde_json::from_str(s).ok())
        .or_else(|| chat::chat_view(&projected));
    o.navigation_stop = game.navigation_pause_view(ctx, &projected);
    o.port_hold = port_hold_view(&projected, game);
    o.awaiting = awaiting_kind(&game.session.world, game.minute);
    o.captain = game.captain.clone();
    // 按主角开局（寰宇）的局没有设过船长：名牌用主角的名字与当前年龄的头像（外貌编号不用）
    if o.captain.is_none()
        && let Some(person) = projected
            .state
            .protagonist
            .as_ref()
            .and_then(|i| i.protagonist.as_deref())
            .and_then(|p| ctx.names.cast.person(p))
    {
        o.captain = Some(views::CaptainView { name: person.name.clone(), portrait: 0 });
        o.captain_asset = person.portrait(projected.cast_date()).map(str::to_owned);
    }
    o.minute = game.minute;
    o.sea_clock = game.sea_clock();
    o.day_ms = clock::day_ms(game.speed, o.sea_clock) as u32;
    crate::creatures_view::mask(&projected, game.minute, &mut o.story);
    o
}

// ───────────────────────────── 开局与静态数据 ─────────────────────────────

/// 静态数据：名字按当前语言，专名同时给出英文写法（切换语言后界面重新拉取）。
pub fn static_data(st: &AppState) -> views::StaticView {
    static_data_for(st, st.resources())
}

fn static_data_for(st: &AppState, resources: &crate::state::world_registry::WorldResources) -> views::StaticView {
    let mut view = resources.static_view(st.locale()).clone();
    let guard = st.game().ok();
    let world =
        guard.as_ref().and_then(|g| g.as_ref()).map(|g| g.view_world()).filter(|w| w.defs.world_key == view.world.key);
    crate::navigation_view::visibility::filter_static(&mut view, resources.locales.ctx(st.locale()), world.as_deref());
    view
}

/// I3 公开图层；地图与世界/语言/玩家状态分离，地图 key 不改变当前世界。
pub fn map_resource(st: &AppState, map: String) -> Result<views::MapResource, AppError> {
    Ok(st.worlds().map_resource(&map)?.clone())
}

/// 细图层（M01“细海图”）：细海岸、细高程、细河流，只给显示用；没有细图层的地图返回空的一份（不是错误）。
pub fn map_fine(st: &AppState, map: String) -> Result<views::MapFineResource, AppError> {
    Ok(st.worlds().map_fine(&map)?.clone())
}

/// 开始新游戏。`seed` 为空时由剧本 key 与当前时间派生（种子写入存档，重放不受影响）。
pub fn new_game(st: &AppState, scenario: &str, seed: Option<u64>) -> Result<Overview, AppError> {
    let _transition = st.transition()?;
    let resources = st.worlds().get("classic")?;
    let defs = resources.defs.clone();
    let sid: ScenarioId = defs.find_scenario(scenario).ok_or_else(|| {
        AppError::Invalid(Msg::new("app.unknown_scenario", format!("未知剧本：{scenario}")).arg("scenario", scenario))
    })?;
    let seed = opening_seed(seed);
    let session = GameSession::new(defs, sid, seed).map_err(|e| AppError::Invalid(e.to_string().into()))?;
    let ai = st.build_ai_for(resources)?;
    // 新的一局没有主角：由界面随后调用 set_captain 设置；时钟从 8:00 开始
    let game = Game {
        session,
        ai,
        speed: 0,
        resume_speed: None,
        run_speed: crate::settings::nearest_tier(st.settings().speed),
        last_autosave: 0,
        captain: None,
        minute: DEFAULT_MINUTE,
        last_navigation_stop: None,
        book: ForecastBook::default(),
        notes: Default::default(),
        clock_speeds: Default::default(),
        upbringing_unlock_notices: Default::default(),
    };
    st.replace_game_with(game, |g| make_overview(st, g))
}

pub fn overview(st: &AppState) -> Result<Overview, AppError> {
    with_game(st, |g| Ok(read_overview(st, g)))
}

// ───────────────────────────── 主角 ─────────────────────────────

/// 主角可选的外貌数量（与前端 `art/portraits.ts` 的 CAPTAIN_PORTRAITS 一致）：编号 0–11 与 13–24，共 24 种。
/// 12 号停用（第一批的 12 种外貌是 0–11，英雄扩充的 12 种是 13–24；跳过 12 号，旧存档里的编号都不变）。
pub const CAPTAIN_PORTRAITS: u32 = 24;
/// 外貌编号的最大值（含）。
pub const CAPTAIN_PORTRAIT_MAX: u32 = 24;
/// 停用的外貌编号。
pub const RETIRED_PORTRAIT: u32 = 12;

/// 外貌编号是不是可用的外貌（0–11、13–24）。
pub fn is_ordinary_portrait(portrait: u32) -> bool {
    portrait <= CAPTAIN_PORTRAIT_MAX && portrait != RETIRED_PORTRAIT
}
/// 主角姓名的最大字符数（去掉首尾空白后）。
pub const CAPTAIN_NAME_MAX: usize = 12;

/// 不可见的格式控制字符（零宽字符、双向文字控制符、BOM）：与控制字符一样不允许出现在姓名中。
fn invisible_format(c: char) -> bool {
    matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2069}' | '\u{FEFF}')
}

/// 校验主角：姓名去掉首尾空白后为 1–12 个字符、不含控制字符，外貌编号是可用的外貌（0–11、13–24，见 [`is_ordinary_portrait`]）。
/// 只影响外观，不影响模拟。返回去掉首尾空白后的主角。
pub fn validate_captain(captain: CaptainView) -> Result<CaptainView, AppError> {
    let name = captain.name.trim();
    let len = name.chars().count();
    if len == 0 {
        return Err(AppError::Invalid(Msg::new("app.captain_empty", "主角姓名不能为空")));
    }
    if len > CAPTAIN_NAME_MAX {
        return Err(AppError::Invalid(
            Msg::new("app.captain_long", format!("主角姓名最长 {CAPTAIN_NAME_MAX} 个字"))
                .arg("max", CAPTAIN_NAME_MAX.to_string()),
        ));
    }
    if name.chars().any(|c| c.is_control() || invisible_format(c)) {
        return Err(AppError::Invalid(Msg::new("app.captain_control", "主角姓名不能包含控制字符")));
    }
    if !is_ordinary_portrait(captain.portrait) {
        return Err(AppError::Invalid(
            Msg::new(
                "app.captain_portrait",
                format!("外貌编号只能是 0–{CAPTAIN_PORTRAIT_MAX}（{RETIRED_PORTRAIT} 号除外）"),
            )
            .arg("max", CAPTAIN_PORTRAIT_MAX.to_string())
            .arg("except", RETIRED_PORTRAIT.to_string()),
        ));
    }
    Ok(CaptainView { name: name.to_string(), portrait: captain.portrait })
}

/// 推荐角色的姓名最长的字符数：数据里定好的名字的译名可能比玩家自取的名字长（“Rossella Salina”）。
pub const HERO_NAME_MAX: usize = 24;

/// 按本局剧本校验主角：推荐角色的专属外貌（[`HERO_LOOK_MIN`] 以上）只在它自己的剧本里可用；带主角的剧本里姓名最长
/// [`HERO_NAME_MAX`] 个字（数据里定好的名字按界面语言给出，译名可能较长）；其余同 [`validate_captain`]。
pub fn validate_captain_for(
    captain: CaptainView,
    scenario: Option<&manifest_core::defs::ScenarioDef>,
) -> Result<CaptainView, AppError> {
    let Some(hero) = scenario.and_then(|s| s.hero.as_ref()) else { return validate_captain(captain) };
    let hero_look = (hero.look >= HERO_LOOK_MIN).then_some(hero.look);
    let name = captain.name.trim().to_string();
    let len = name.chars().count();
    // 名字先照常校验（空、控制字符；借一个普通外貌与不超过 12 个字的名字走一遍），长度另按推荐角色的上限
    let probe: String = name.chars().take(CAPTAIN_NAME_MAX).collect();
    validate_captain(CaptainView { name: probe, portrait: 0 })?;
    if len > HERO_NAME_MAX {
        return Err(AppError::Invalid(
            Msg::new("app.captain_long", format!("主角姓名最长 {HERO_NAME_MAX} 个字"))
                .arg("max", HERO_NAME_MAX.to_string()),
        ));
    }
    if captain.portrait >= HERO_LOOK_MIN && hero_look == Some(captain.portrait) {
        return Ok(CaptainView { name, portrait: captain.portrait });
    }
    let v = validate_captain(CaptainView { name: String::from("_"), portrait: captain.portrait })?;
    Ok(CaptainView { name, portrait: v.portrait })
}

/// 本局的剧本定义。
fn scenario_of(game: &Game) -> Option<&manifest_core::defs::ScenarioDef> {
    let w = &game.session.world;
    w.defs.scenarios.get(w.state.scenario.idx())
}

/// 设置当前游戏的主角（姓名与外貌），返回更新后的概览。
/// 主角不参与模拟：不写入命令日志，不改变世界状态与世界哈希。
pub fn set_captain(st: &AppState, captain: CaptainView) -> Result<Overview, AppError> {
    with_game(st, |g| {
        let captain = validate_captain_for(captain, scenario_of(g))?;
        g.captain = Some(captain);
        Ok(make_overview(st, g))
    })
}

// ───────────────────────────── 时间 ─────────────────────────────

/// 玩家舰队遇到海盗、或剧情事件（故事线的一章、奇遇）刚出现时暂停，等待玩家决定；
/// 分别推送 `battle`（待决海战列表）与 `story`（[`crate::story_view::StoryEventView`]）事件。
/// 剧情事件只在出现的那一天暂停一次（章节会一直等着玩家回应，奇遇当天没有回应就作罢）。
fn pause_on_battle(st: &AppState, game: &mut Game) {
    let acted = act_autoplay(st, game);
    if acted
        && game.session.world.act_phase() == manifest_core::upbringing::ActPhase::Free
        && game.session.world.state.story2.pending.is_empty()
        && game.session.world.state.story.pending.is_none()
        && game.session.world.act_free_stop().is_none()
    {
        return;
    }
    let world = &game.session.world;
    let pending = views::battles_pending(world);
    let story = story_just_appeared(world, game.minute)
        .then(|| crate::story_view::story_view_in(st.ctx(), world).and_then(|v| v.pending))
        .flatten();
    if game.speed == 0 || (pending.is_empty() && story.is_none() && !world.upbringing_waiting()) {
        return;
    }
    game.resume_speed = Some(game.speed);
    game.speed = 0;
    if let Some(e) = story {
        st.emit("story", serde_json::to_value(&e).unwrap_or_default());
    }
    if !pending.is_empty() {
        st.emit("battle", serde_json::to_value(&pending).unwrap_or_default());
    }
}

/// 剧情事件是不是刚出现（前一天结算时出现）。
/// story2 的章节由内核判断（[`manifest_core::World::story2_front_fresh`]）：开了节奏规则的世界里，队首章节只在出场的那一天、
/// 以及它的最后一天算“刚出现”——它一直等着玩家回应，但不再每天日结都把时钟叫停一次、把人从旅店叫醒一次；
/// 没开节奏规则的世界与养成期照旧（只要队首是 story2 的章节就算）。
fn story_just_appeared(world: &manifest_core::World, minute: u16) -> bool {
    world.story2_front_fresh()
        || world.state.story.pending.as_ref().is_some_and(|p| p.day + 1 == world.day())
        || crate::creatures_view::visible(world, minute)
}

/// 是否有等待玩家决定的事（待决海战、刚出现的剧情事件、养成的安排）：手动推进时遇到就停下。
fn awaiting_player(world: &manifest_core::World, minute: u16) -> bool {
    awaiting_kind(world, minute).is_some()
}

/// 在等玩家决定的是哪一类事（概览的 `awaiting`；旅店休息提前停下时据此说明原因）：
/// upbringing（养成的回顾与安排）/ battle（待决海战）/ story（刚出现的剧情事件或奇遇）。
fn awaiting_kind(world: &manifest_core::World, minute: u16) -> Option<&'static str> {
    if world.upbringing_waiting() {
        Some("upbringing")
    } else if !views::battles_pending(world).is_empty() {
        Some("battle")
    } else if story_just_appeared(world, minute) {
        Some("story")
    } else {
        None
    }
}

/// 玩家的舰队抵达目的地（靠港或抵达殖民点）时暂停，按设置“抵达时自动暂停”（缺省只看旗舰队：主角亲自率领的第一支舰队，
/// 与界面的 `flagship()` 一致）。只在游戏运行时起作用：手动“下一天”本来就停在那里。
fn pause_on_arrival(game: &mut Game, report: &manifest_core::DayReport, mode: ArrivalPause) {
    // 手动世界已在实际抵港分钟暂停；恢复后不在日结再暂停一次。
    if game.session.world.defs.manual_navigation {
        return;
    }
    if game.speed == 0 || mode == ArrivalPause::Off {
        return;
    }
    let world = &game.session.world;
    let flagship = world.fleets_of(PLAYER).next().map(|f| f.id);
    let arrived = report.arrivals.iter().any(|(fleet, _)| match mode {
        ArrivalPause::Flagship => Some(*fleet) == flagship,
        ArrivalPause::Any => world.fleet(*fleet).is_ok_and(|f| f.owner == PLAYER),
        ArrivalPause::Off => false,
    });
    if arrived {
        game.speed = 0;
    }
}

/// 推进一天：AI 任务、推送事件。调用方持有游戏锁。
/// 到了自动存档的日子只在锁内做快照（内存拷贝），由调用方释放锁之后再编码、压缩、写盘。
fn advance_one(st: &AppState, game: &mut Game, autosave_days: u32) -> Result<Option<PendingSave>, AppError> {
    act_autoplay(st, game);
    if game.session.world.upbringing_waiting() {
        game.speed = 0;
        return Ok(None);
    }
    let daily_observer = !game.session.world.defs.realms.is_empty();
    let report = if daily_observer {
        let book = &mut game.book;
        let ai = game.ai.as_ref();
        game.session.advance_day_with(|session| {
            book.record_day(&session.world);
            if let Some(ai) = ai {
                ai.run_due(session, st.runtime());
            }
        })
    } else {
        game.session.advance_day()
    }
    .map_err(|e| AppError::Invalid(e.to_string().into()))?;
    st.collect_ending(&game.session.world)?;
    // 预测簿：给还没到期的预测抄录刚结束的那一天（在任何新的成交之前）
    if !daily_observer {
        game.book.record_day(&game.session.world);
    }
    pause_on_battle(st, game);
    pause_on_arrival(game, &report, st.settings().arrival_pause);
    if !daily_observer && let Some(ai) = &game.ai {
        ai.run_due(&mut game.session, st.runtime());
    }
    st.emit("fog", serde_json::json!({ "rev": game.session.world.state.explore.fog_revision() }));
    let day = game.session.day();
    if autosave_days > 0 && day >= game.last_autosave + autosave_days {
        let mut pending = snapshot_save(st, game, "autosave")?;
        pending.previous_autosave = game.last_autosave;
        game.last_autosave = day;
        return Ok(Some(pending));
    }
    Ok(None)
}

/// 手动推进若干天（界面的"下一天"按钮、港口的旅店休息与测试使用）：结算 `days` 次，时钟停在（最后一次结算的）6:00。
/// 遇到海盗时提前停下，等待玩家决定（概览的 `awaiting` 写明是哪一类事）。不看倍速：在港暂停时同样推进。
pub fn step(st: &AppState, days: u32) -> Result<Overview, AppError> {
    if days == 0 || days > 3_600 {
        return Err(AppError::Invalid(Msg::new("app.step_range", "一次推进 1–3600 天")));
    }
    let autosave_days = st.settings().autosave_days;
    let (overview, autosave, generation) = with_game(st, |g| {
        let mut autosave = None;
        if g.session.world.creature_pending().is_some() {
            if !crate::creatures_view::visible(&g.session.world, g.minute) {
                g.minute = 1080;
            }
            g.speed = 0;
            return Ok((make_overview(st, g), autosave, st.generation()));
        }
        // 每次结算都发生在 6:00，已有遭遇则保持在本日。
        g.minute = DAY_START_MINUTE;
        for _ in 0..days {
            if let Some(p) = advance_one(st, g, autosave_days)? {
                autosave = Some(p);
            }
            if g.session.world.creature_pending().is_some_and(|(_, c)| c.when.night)
                && !awaiting_player(&g.session.world, g.minute)
            {
                g.minute = 1080;
            }
            if awaiting_player(&g.session.world, g.minute) {
                break;
            }
        }
        // 运行中按“下一天”、结算时旗舰队靠了港：在港暂停
        hold_in_port(g);
        g.sync_clock_speed();
        Ok((make_overview(st, g), autosave, st.generation()))
    })?;
    emit_tick(st, &overview, generation);
    if let Some(p) = autosave {
        write_autosave(st, p)?;
    }
    Ok(overview)
}

/// 推进一天：游戏在运行且未暂停时结算一次，时钟停在新一天的 6:00。返回是否推进。
/// 后台线程改为按分钟推进（见 [`advance_clock`]），这里保留“推进一天”的语义供测试使用。
pub fn tick(st: &AppState) -> Result<bool, AppError> {
    let autosave_days = st.settings().autosave_days;
    let (overview, autosave, generation) = {
        let mut guard = st.game()?;
        let Some(g) = guard.as_mut() else { return Ok(false) };
        act_autoplay(st, g);
        if g.speed == 0 || g.session.world.upbringing_waiting() {
            pause_for_player(g);
            return Ok(false);
        }
        g.sync_clock_speed();
        if hold_in_port(g) {
            return Ok(false);
        }
        if g.session.world.creature_pending().is_some() {
            if !crate::creatures_view::visible(&g.session.world, g.minute) {
                g.minute = 1080;
            }
            pause_on_battle(st, g);
            return Ok(false);
        }
        g.minute = DAY_START_MINUTE;
        let autosave = advance_one(st, g, autosave_days)?;
        hold_in_port(g);
        g.sync_clock_speed();
        ((!st.defer_overview()).then(|| make_overview(st, g)), autosave, st.generation())
    };
    if let Some(overview) = overview {
        emit_tick(st, &overview, generation);
    }
    if let Some(p) = autosave {
        write_autosave(st, p)?;
    }
    Ok(true)
}

/// 推送每日概览；推进之后若已换了一局游戏（开局或读档），不再推送旧局的概览。
fn emit_tick(st: &AppState, overview: &Overview, generation: u64) {
    if st.generation() == generation {
        st.emit("tick", serde_json::to_value(overview).unwrap_or_default());
    }
}

/// 时钟推进一小步的结果。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ClockStep {
    /// 推进后的日期与时刻
    pub clock: ClockView,
    /// 这一步结算的天数（走到 6:00 的次数）
    pub days: u32,
    /// 所属的游戏代数：推送 `clock` 事件前据此判断游戏是否已经切换
    pub generation: u64,
}

/// 推进时钟 `minutes` 分钟（后台线程的一小步，EXPANSION.md §9.2）。
///
/// 时钟走到 6:00 时调用原来的“推进一天”（AI 任务、自动存档、遇海盗暂停），新的日期从 6:00 开始，并推送当天的
/// `tick` 概览；推进中遇到海战自动暂停时，时钟停在那个 6:00，剩下的分钟作废。没有游戏或已暂停时时钟不走，返回 None。
/// 手动航行的世界里旗舰队靠港时停在抵港的那一分钟（在港暂停，见 `handlers/harbor.rs`）。
/// `clock` 事件由调用方节流后用 [`emit_clock`] 推送。
pub fn advance_clock(st: &AppState, minutes: u32) -> Result<Option<ClockStep>, AppError> {
    let autosave_days = st.settings().autosave_days;
    let (step, overview, autosave, course) = {
        let mut guard = st.game()?;
        let Some(g) = guard.as_mut() else { return Ok(None) };
        act_autoplay(st, g);
        if g.speed == 0 || g.session.world.upbringing_waiting() {
            pause_for_player(g);
            return Ok(None);
        }
        g.sync_clock_speed();
        let mut pulse = None;
        let world = &g.session.world;
        // 养成期过周界（或按设置过月末）停下，等玩家开始下一周（U05：停顿方式见 `upbringing_pause` 设置）。
        let week_end = if world.act_running() {
            None
        } else {
            clock::upbringing_stop_after(world, st.settings().upbringing_pause)
        };
        let mut left = minutes;
        let mut days = 0;
        let mut autosave = None;
        let mut paused = false;
        while left > 0 && g.speed != 0 {
            // 在港暂停：旗舰队停在港口（日结时靠了港，或别处让它停着时开了钟）——时钟不走
            if hold_in_port(g) {
                paused = true;
                break;
            }
            let to_start = clock::minutes_to_day_start(g.minute);
            let now = clock::since_day_start(g.minute) as u16;
            let end = u32::from(now) + left.min(to_start);
            let stop = g.next_navigation_pause(end as u16, &st.settings());
            let creature = g.session.world.creature_pending().map(|(_, c)| {
                if c.when.night && !crate::creatures_view::visible(&g.session.world, g.minute) { 720 } else { now }
            });
            if let Some(at) =
                creature.filter(|at| u32::from(*at) <= end && stop.as_ref().is_none_or(|s| *at <= s.minute))
            {
                g.minute = clock::norm(u32::from(DAY_START_MINUTE) + u32::from(at));
                pause_on_battle(st, g);
                pause_for_player(g);
                paused = true;
                break;
            }
            // H03：远处的天气团、普通商船：降到 1×，记下水位（同一分钟不再降），接着走
            if let Some(slow) = stop
                .as_ref()
                .filter(|s| s.minute < clock::MINUTES_PER_DAY && crate::state::Game::navigation_slows(s))
                .cloned()
            {
                left = left.saturating_sub(u32::from(slow.minute.saturating_sub(now)));
                g.minute = clock::norm(u32::from(DAY_START_MINUTE) + u32::from(slow.minute));
                g.last_navigation_stop = Some(slow);
                g.speed = g.speed.min(if g.sea_clock() { crate::settings::NORMAL_SPEED } else { 1 });
                paused = true;
                continue;
            }
            if let Some(stop) = stop.as_ref().filter(|s| s.minute < clock::MINUTES_PER_DAY) {
                g.minute = clock::norm(u32::from(DAY_START_MINUTE) + u32::from(stop.minute));
                g.last_navigation_stop = Some(stop.clone());
                g.speed = 0;
                paused = true;
                break;
            }
            if left < to_start {
                g.minute = clock::norm(u32::from(g.minute) + left);
                break;
            }
            left -= to_start;
            let before = g.minute;
            if pulse.is_none() && g.sea_clock() {
                pulse = Some(clock::SettlementPulse::start(
                    st.clone(),
                    ClockView {
                        day: g.session.day(),
                        minute: g.minute,
                        day_ms: clock::day_ms(g.speed, g.sea_clock()) as u32,
                        sea_clock: g.sea_clock(),
                    },
                    st.generation(),
                ));
            }
            // 结算发生在 6:00：先拨到 6:00，自动存档记下的也是这个时刻
            g.minute = DAY_START_MINUTE;
            match advance_one(st, g, autosave_days) {
                Ok(Some(p)) => autosave = Some(p),
                Ok(None) => {}
                Err(e) => {
                    // 结算失败：这一天没有推进，时钟退回原处（调用方随后暂停）
                    g.minute = before;
                    return Err(e);
                }
            }
            days += 1;
            if week_end.is_some_and(|end| g.session.day() > end) {
                // 即使周界同时遇到剧情，答完后也要由玩家开始下一周。
                g.speed = 0;
                g.resume_speed = None;
            }
            if let Some(stop) = stop.filter(|s| !crate::state::Game::navigation_slows(s)) {
                g.last_navigation_stop = Some(stop);
                g.speed = 0;
                paused = true;
            }
        }
        let generation = st.generation();
        g.sync_clock_speed();
        let clock = ClockView {
            day: g.session.day(),
            minute: g.minute,
            day_ms: clock::day_ms(g.speed, g.sea_clock()) as u32,
            sea_clock: g.sea_clock(),
        };
        let overview = (days > 0 || paused).then(|| (!st.defer_overview()).then(|| make_overview(st, g))).flatten();
        let course = if days > 0 && overview.is_some() {
            let w = &g.session.world;
            let fleet = w.flagship(PLAYER).filter(|id| {
                w.fleet(*id).is_ok_and(|f| {
                    matches!(
                        f.location,
                        manifest_core::world::FleetLocation::AtSea(manifest_core::world::Voyage::Manual { .. })
                    )
                }) && !w.fleet_in_battle(*id)
            });
            fleet.map(|id| cached_course(st, g, id.0, &[], 0, 2)).transpose()?
        } else {
            None
        };
        drop(pulse);
        (ClockStep { clock, days, generation }, overview, autosave, course)
    };
    if let Some(o) = &overview {
        emit_tick(st, o, step.generation);
    }
    if let Some(course) = course
        && st.generation() == step.generation
    {
        st.emit("nav_course", course);
    }
    if let Some(p) = autosave {
        write_autosave(st, p)?;
    }
    Ok(Some(step))
}

/// 推送 `clock` 事件 `{ day, minute }`；推进之后若已换了一局游戏，不再推送旧局的时钟。
pub fn emit_clock(st: &AppState, step: &ClockStep) {
    if st.generation() == step.generation {
        st.emit("clock", serde_json::to_value(step.clock).unwrap_or_default());
    }
}

/// 写自动存档；失败时把 last_autosave 退回快照前的值，下一天再试。
fn write_autosave(st: &AppState, p: PendingSave) -> Result<(), AppError> {
    let (generation, day, previous) = (p.generation, p.info.day, p.previous_autosave);
    if let Err(e) = write_pending(st, p) {
        if st.generation() == generation
            && let Some(g) = st.game()?.as_mut()
            && g.last_autosave == day
        {
            g.last_autosave = previous;
        }
        return Err(e);
    }
    Ok(())
}

/// 当前速度（0 表示暂停或没有游戏）。
pub fn current_speed(st: &AppState) -> u8 {
    st.game().ok().and_then(|g| g.as_ref().map(|g| g.speed)).unwrap_or(0)
}

/// 养成期正在播放（没暂停、没在等安排或剧情）时，走到下一个 6:00 还差的分钟数；否则 None。
/// 这时时钟不按倍速折算实时，一天结算完直接进入下一天（见 [`crate::Ticker::step`]），等待只剩计算本身。
pub fn upbringing_turbo(st: &AppState) -> Option<u32> {
    let guard = st.game().ok()?;
    let g = guard.as_ref()?;
    let w = &g.session.world;
    (g.speed != 0 && w.upbringing_active() && !w.upbringing_waiting()).then(|| clock::minutes_to_day_start(g.minute))
}

/// 设置速度：0 暂停，否则为倍速（1× 每天 4 秒）。界面只给慢 2× / 普通 4× / 快 8× 三档（[`crate::settings::SPEED_TIERS`]），
/// 旧的 1 / 16 / 32 倍速照样接受（旧存档、旧界面）。暂停时时钟停在当时的时刻。
/// 手动航行的世界里旗舰队在港时按开始也不走（不报错）：这一档记下，出港后按它继续（见 `handlers/harbor.rs`）。
pub fn set_speed(st: &AppState, speed: u8) -> Result<Overview, AppError> {
    if speed != 0 && !SPEEDS.contains(&speed) {
        return Err(AppError::Invalid(
            Msg::new("app.speed", format!("速度只能是 0（暂停）或 {} 倍速", speeds_text()))
                .arg("speeds", speeds_text()),
        ));
    }
    with_game(st, |g| {
        g.sync_clock_speed();
        let waiting = g.session.world.upbringing_waiting();
        if speed != 0 {
            g.run_speed = speed;
        }
        let held = speed != 0 && !waiting && g.port_hold().is_some();
        g.speed = if waiting || held { 0 } else { speed };
        // 玩家自己按暂停：不再自动继续；有事在等时按了开始：回应完按这个倍速走
        g.resume_speed = (waiting && speed != 0).then_some(speed);
        Ok(make_overview(st, g))
    })
}

/// 因为有事要玩家回应而停下：记下停前的倍速（已经停着的不改），时钟暂停。
fn pause_for_player(g: &mut Game) {
    if g.speed != 0 {
        g.resume_speed = Some(g.speed);
    }
    g.speed = 0;
}

/// 行动制的自动推进只代发一条玩家命令；成功与手动提交共用 submit_at 和命令日志。
fn act_autoplay(st: &AppState, game: &mut Game) -> bool {
    use manifest_core::upbringing::{ActPhase, TemplateKind, act::act_stop_blocking};
    let pause = st.settings().upbringing_pause;
    if pause == crate::settings::UpbringingPause::Week || (game.speed == 0 && game.resume_speed.is_none()) {
        return false;
    }
    let world = &game.session.world;
    if !world.act_running() || !world.state.story2.pending.is_empty() || world.state.story.pending.is_some() {
        return false;
    }
    let owner = PLAYER;
    let command = match world.act_phase() {
        ActPhase::Plan if !world.act_stops().keys().any(|kind| act_stop_blocking(kind)) => {
            Some(Command::StartWeek { owner })
        }
        ActPhase::Free => {
            if world.act_free_stop().is_some() {
                None
            } else if world.act_free_template_done() {
                Some(Command::EndFree { owner })
            } else {
                Some(Command::UseTemplate { owner, slot: 0, kind: TemplateKind::Free })
            }
        }
        ActPhase::Summary => {
            let Some(s) = &world.state.upbringing else { return false };
            let Some(summary) = &s.act.last_week else { return false };
            // 生病时同时保存了期限日期；按原公式还原痊愈周，不另存自动播放状态。
            let recovered = !world.act_ill()
                && world.act_rules().is_some_and(|r| {
                    s.ill_until.is_some_and(|until| {
                        manifest_core::upbringing::week_index(&world.defs, until.saturating_sub(7 * r.illness.weeks))
                            + r.illness.weeks
                            == s.act.week
                    })
                });
            let decision = summary.k2.review.is_some() || summary.k2.mission.is_some() || summary.k2.ill || recovered;
            let month_end = summary.week % 4 == 3;
            (!(decision || pause == crate::settings::UpbringingPause::Month && month_end))
                .then_some(Command::CloseWeek { owner })
        }
        _ => None,
    };
    let Some(command) = command else { return false };
    let minute = clock::since_day_start(game.minute) as u16;
    match game.session.submit_at(minute, command) {
        Ok(_) => true,
        Err(_) => {
            game.speed = 0;
            game.resume_speed = None;
            false
        }
    }
}

/// 自动暂停后玩家已回应完（剧情答了、海战打完、月计划排好……）、再没有要等的事时，按停前的倍速继续，推送概览。
/// 后台时钟在暂停时调用（见 [`crate::Ticker::step`] 与 [`crate::spawn_ticker`]）；返回是否恢复了。
/// 旗舰队在港（在港暂停）时不继续：这一档留到出港。
pub fn auto_resume(st: &AppState) -> bool {
    let resumed = {
        let Ok(mut guard) = st.game() else { return false };
        let Some(g) = guard.as_mut() else { return false };
        g.sync_clock_speed();
        let Some(speed) = g.resume_speed.filter(|_| g.speed == 0) else { return false };
        act_autoplay(st, g);
        let world = &g.session.world;
        if awaiting_player(world, g.minute) || world.creature_pending().is_some() || world.upbringing_skipping() {
            return false;
        }
        if g.port_hold().is_some() {
            g.run_speed = speed;
            g.resume_speed = None;
            return false;
        }
        g.speed = speed;
        g.resume_speed = None;
        (!st.defer_overview()).then(|| make_overview(st, g)).map(|o| (o, st.generation()))
    };
    if let Some((overview, generation)) = resumed {
        emit_tick(st, &overview, generation);
    }
    true
}

// ───────────────────────────── 命令 ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct SubmitResult {
    pub outcome: CommandOutcome,
    pub overview: Overview,
}

/// AI 专用的命令不能由界面提交。
fn player_command_allowed(cmd: &Command) -> bool {
    !matches!(
        cmd,
        Command::RecordAiText { .. }
            | Command::ApplyRipple { .. }
            | Command::ApplyPersona { .. }
            | Command::ApplyDaily { .. }
            | Command::ApplyEvent { .. }
            | Command::PublishNews { .. }
            | Command::ApplyBargain { .. }
            | Command::AdjustStrategy { .. }
            | Command::OfferContract { .. }
            | Command::RecordChronicle { .. }
            | Command::ApplyComposedEvent { .. }
            | Command::SetOutlook { .. }
            | Command::RecordMarketReport { .. }
    ) && cmd.owner() == Some(PLAYER)
}

/// 提交一条玩家命令：校验通过后立即执行并写入命令日志。
pub fn submit(st: &AppState, cmd: Command) -> Result<SubmitResult, AppError> {
    if !player_command_allowed(&cmd) {
        return Err(AppError::Invalid(Msg::new("app.player_only", "界面只能提交玩家自己的命令")));
    }
    if let Command::TalkFree { person, text, .. } = cmd {
        persona_chat(st, person, text)?;
        return with_game(st, |g| Ok(SubmitResult { outcome: CommandOutcome::Done, overview: make_overview(st, g) }));
    }
    let (outcome, mut overview, generation, start_day, target, total) = with_game(st, |g| {
        let minute = clock::since_day_start(g.minute) as u16;
        let held = harbor::held_before_command(g);
        let resume_lessons = matches!(&cmd, Command::StartWeek { .. } | Command::AnswerMoment { .. });
        g.sync_clock_speed();
        let outcome = g.session.submit_at(minute, cmd).map_err(AppError::Command)?;
        g.sync_clock_speed();
        // 开课与关键时刻答复共用自动续走；读档未留下停前倍速时按上课的缺省快档。
        if resume_lessons && g.speed == 0 {
            g.resume_speed.get_or_insert(crate::settings::FAST_SPEED);
        }
        // 在港暂停：这条命令让旗舰队出了港（出港、自动导航……），按玩家最近一次选的倍速继续
        if held && g.speed == 0 && g.port_hold().is_none() {
            resume_after_departure(g);
        }
        let world = &g.session.world;
        let start_day = world.day();
        let target = world.upbringing_family().map(|family| family.graduation);
        let total = target
            .and_then(|date| manifest_core::scenario::day_of(&world.defs, date).ok())
            .map(|day| day.saturating_sub(start_day));
        let overview = (!world.upbringing_skipping()).then(|| make_overview(st, g));
        Ok((outcome, overview, st.generation(), start_day, target, total))
    })?;
    loop {
        if let Some(overview) = overview {
            return Ok(SubmitResult { outcome, overview });
        }
        // 每段最多七天，仍逐日结算并记预测账；读接口可在完整日边界取得游戏锁。
        let (next, progress) = with_game(st, |g| {
            if st.generation() != generation {
                return Err(AppError::Invalid(Msg::new("app.upbringing_switched", "跳过养成时对局已切换。")));
            }
            for _ in 0..7 {
                if !g.session.world.upbringing_skipping() {
                    break;
                }
                g.session.advance_day().map_err(|e| AppError::Invalid(e.to_string().into()))?;
                g.book.record_day(&g.session.world);
            }
            let world = &g.session.world;
            let done = !world.upbringing_skipping();
            // 网页概览按需构建；分段后也须使旧快照失效。
            st.defer_overview();
            let (epoch, rev) = st.stamp();
            let progress = serde_json::json!({
                "epoch":epoch, "rev":rev, "day":world.day().saturating_sub(start_day),
                "total":total, "date":world.cast_date(), "target":target, "done":done
            });
            Ok((done.then(|| make_overview(st, g)), progress))
        })?;
        overview = next;
        // 推送与让出线程都在锁外；换局后旧任务不能继续推进新局。
        if st.generation() == generation {
            st.emit("upbringing_progress", progress);
        }
        std::thread::yield_now();
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct QuoteRequest {
    pub loc: u16,
    pub good: u16,
    /// buy / sell
    pub side: String,
    pub qty: i64,
}

/// 成交预估（与实际成交使用同一套计算）。
pub fn quote(st: &AppState, req: QuoteRequest) -> Result<TradeQuote, AppError> {
    let side = match req.side.as_str() {
        "buy" => Side::Buy,
        "sell" => Side::Sell,
        other => {
            return Err(AppError::Invalid(Msg::new("app.side", format!("未知的买卖方向：{other}")).arg("side", other)));
        }
    };
    with_game(st, |g| {
        let w = &g.view_world();
        if !w.location_visible(LocId(req.loc)) || w.defs.goods.get(req.good as usize).is_none() {
            return Err(AppError::Invalid(Msg::new("app.loc_or_good", "地点或商品不存在")));
        }
        // 信息时效：随船传递时，只有舰队或商队在那里才问得到现价
        if w.info_mode() == manifest_core::info::InfoMode::Carried && !w.presence(PLAYER).contains(&LocId(req.loc)) {
            return Err(AppError::Invalid(Msg::new("app.not_here", "不在这里，问不到现价")));
        }
        manifest_core::market::quote(w, PLAYER, LocId(req.loc), GoodId(req.good), side, req.qty)
            .map_err(AppError::Command)
    })
}

/// I3：未提交的操舵只用于预览，返回到当天结束的全部分钟点。
pub fn preview_course(
    st: &AppState,
    fleet: u32,
    steers: Vec<manifest_core::navigation::Steering>,
    minute: u16,
) -> Result<serde_json::Value, AppError> {
    let guard = st.game()?;
    let g = guard
        .as_ref()
        .filter(|g| g.session.world.defs.manual_navigation)
        .ok_or_else(|| AppError::Invalid(Msg::new("app.feature_unavailable", "这个世界还没有这项功能")))?;
    let w = &g.session.world;
    if w.fleet(FleetId(fleet)).map_err(manifest_core::CommandError::from).map_err(AppError::Command)?.owner != PLAYER {
        return Err(AppError::Command(manifest_core::CommandError::NotOwner));
    }
    let now = clock::since_day_start(g.minute) as u16;
    for steer in &steers {
        manifest_core::navigation::orders::check_minute(steer.minute, now).map_err(AppError::Command)?;
    }
    let locale = st.locale();
    let key = crate::view_cache::ViewKey::new(
        st,
        g,
        locale,
        crate::view_cache::Query::Preview { fleet, minute, steers: &steers },
    )?;
    st.cached_view(key, || {
        crate::navigation_view::preview_course(
            st.resources().locales.ctx(locale),
            &g.view_world(),
            FleetId(fleet),
            &steers,
            minute,
        )
        .map_err(AppError::Command)
    })
}

// ───────────────────────────── 查询 ─────────────────────────────

pub fn port(st: &AppState, loc: u16) -> Result<views::PortView, AppError> {
    with_game(st, |g| {
        if !g.view_world().location_visible(LocId(loc)) {
            return Err(AppError::Invalid(Msg::new("app.no_loc", "地点不存在")));
        }
        Ok(views::port_view_in(st.ctx(), &g.view_world(), LocId(loc)))
    })
}

/// 行情序列（日线、月线、上下限、进行中的事件与价格曲线）：行情窗口与交易所的预测开关用。
pub fn market_series(st: &AppState, loc: u16, good: u16) -> Result<SeriesView, AppError> {
    with_game(st, |g| forecast::series_view(&g.view_world(), LocId(loc), GoodId(good)))
}

/// 同时追踪的预测上限（主角的算学决定）。
fn forecast_limit(g: &Game) -> usize {
    forecast::max_active(&g.view_world())
}

/// 行情预测簿。
pub fn forecast_book(st: &AppState) -> Result<BookView, AppError> {
    with_game(st, |g| Ok(g.book.view(&g.view_world(), forecast_limit(g), st.ctx().names)))
}

/// 记下一条预测（前端算好的方法、参数、路径与区间）；修订版须写明调整的种类与依据。
pub fn pin_forecast(st: &AppState, req: PinRequest) -> Result<BookView, AppError> {
    with_game(st, |g| {
        let limit = forecast_limit(g);
        let world = g.view_world().into_owned();
        g.book.pin(&world, req, limit)?;
        Ok(g.book.view(&g.view_world(), limit, st.ctx().names))
    })
}

/// 从预测簿删除一条。
pub fn remove_forecast(st: &AppState, id: u32) -> Result<BookView, AppError> {
    with_game(st, |g| {
        if !g.book.remove(id) {
            return Err(AppError::Invalid(Msg::new("forecast.missing", "预测簿里没有这一条")));
        }
        Ok(g.book.view(&g.view_world(), forecast_limit(g), st.ctx().names))
    })
}

#[derive(Clone, Debug, Serialize)]
pub struct SupplyAmounts {
    pub food: i64,
    pub water: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct SailPreview {
    pub days: i64,
    pub path: Vec<(u16, u16)>,
    /// 建议携带的粮、水（各自）
    pub supplies: i64,
    /// 当前船员及剩余粮水可完整维持的天数；零船员为 null。
    pub supplies_days: Option<i64>,
    /// 预计航程本身所需持有的粮水，包含已打开容器的余数。
    pub required: SupplyAmounts,
    /// 相对当前库存的缺口，不含建议安全余量。
    pub shortfall: SupplyAmounts,
}

/// 航行预估：天数、航线与建议补给。
pub fn sail_preview(st: &AppState, fleet: u32, dest: u16) -> Result<Option<SailPreview>, AppError> {
    with_game(st, |g| {
        let w = &g.view_world();
        let f = w.fleet(FleetId(fleet)).map_err(|e| AppError::Invalid(e.to_string().into()))?;
        if f.owner != PLAYER || !w.location_visible(LocId(dest)) {
            return Err(AppError::Invalid(Msg::new("app.fleet_or_dest", "舰队或目的地无效")));
        }
        let dest = LocId(dest);
        // 殖民点等不在预计算航线表中的目的地只寻路一次
        let route = if w.defs.manual_navigation {
            w.known_sea_path(f.cell(&w.defs), dest, false).ok().map(|p| {
                let days = w.navigation_path_days(f.id, &p.path);
                (p.path, days)
            })
        } else {
            w.route_with_days(f, dest)
        };
        let Some((path, days)) = route else { return Ok(None) };
        let margin = manifest_core::fleet::supply_margin(w.defs.rules.npc.supply_margin_days, days);
        let margin = if w.defs.rules.fractional_supplies { margin.max((days + 1) / 2) } else { margin };
        let supplies = f.supplies_needed(&w.defs, days + margin);
        let [food, water] = f.supplies_required(&w.defs, days);
        Ok(Some(SailPreview {
            days,
            path: path.iter().map(|c| (c.x, c.y)).collect(),
            supplies,
            supplies_days: f.supplies_days(&w.defs),
            required: SupplyAmounts { food, water },
            shortfall: SupplyAmounts { food: (food - f.food).max(0), water: (water - f.water).max(0) },
        }))
    })
}

#[derive(Clone, Debug, Deserialize)]
pub struct CaravanPlanRequest {
    pub animal: u16,
    pub count: i64,
    pub guards: i64,
    pub from: u16,
    pub to: u16,
    pub cargo_value: i64,
}

pub fn caravan_plan(st: &AppState, req: CaravanPlanRequest) -> Result<Option<views::CaravanPlanView>, AppError> {
    with_game(st, |g| {
        let w = &g.view_world();
        if !w.location_visible(LocId(req.from))
            || !w.location_visible(LocId(req.to))
            || req.animal as usize >= w.defs.animals.len()
        {
            return Err(AppError::Invalid(Msg::new("app.bad_params", "参数无效")));
        }
        Ok(views::caravan_plan(
            w,
            AnimalId(req.animal),
            req.count.max(1),
            req.guards.max(0),
            LocId(req.from),
            LocId(req.to),
            req.cargo_value.max(0),
        ))
    })
}

pub fn futures(st: &AppState) -> Result<views::FuturesView, AppError> {
    with_game(st, |g| Ok(views::futures_view(&g.view_world())))
}

pub fn industries(st: &AppState) -> Result<views::IndustriesView, AppError> {
    with_game(st, |g| Ok(views::industries_view(&g.view_world())))
}

pub fn reports(st: &AppState) -> Result<views::ReportsView, AppError> {
    with_game(st, |g| Ok(views::reports_view_in(st.ctx().names, &g.view_world())))
}

pub fn intel(st: &AppState) -> Result<views::IntelView, AppError> {
    with_game(st, |g| Ok(views::intel_view_in(st.ctx(), &g.view_world())))
}

pub fn mates(st: &AppState) -> Result<views::MatesView, AppError> {
    with_game(st, |g| Ok(views::mates_view_in(st.ctx(), &g.view_world())))
}

pub fn battle(st: &AppState, id: u32) -> Result<Option<views::TacticalView>, AppError> {
    with_game(st, |g| Ok(views::tactical_view(&g.view_world(), BattleId(id))))
}

/// I3 游标是应用驻留编号与游戏代数；缺失/过期 epoch 一律全量。
/// 与读取迷雾共持游戏锁，不能把新局 epoch 配到旧局位图上。
pub fn fog_delta(st: &AppState, since: u64, epoch: Option<String>) -> Result<views::FogDelta, AppError> {
    with_game(st, |g| {
        let current = format!("{}:{}", st.stamp().0, st.generation());
        Ok(views::fog_view::delta(&g.view_world(), current, since, epoch.as_deref()))
    })
}

pub fn fog(st: &AppState) -> Result<Vec<String>, AppError> {
    with_game(st, |g| Ok(views::fog_rows(&g.view_world())))
}

/// 玩家的殖民地详情（人口、士气、粮食、库存、建筑与工程、产出预估、税率、袭击风险、可建设项目）。
pub fn colonies(st: &AppState) -> Result<views::ColoniesView, AppError> {
    with_game(st, |g| Ok(views::colonies_view_in(st.ctx(), &g.view_world())))
}

/// 殖民点详情：自然条件、归属、能否建立殖民地与所需物资。
pub fn site(st: &AppState, loc: u16) -> Result<views::SiteView, AppError> {
    with_game(st, |g| {
        views::site_view_in(st.ctx(), &g.view_world(), LocId(loc))
            .ok_or_else(|| AppError::Invalid(Msg::new("app.not_site", "不是殖民点")))
    })
}

/// 探险记录：已发现、已报告的发现物与名声。
pub fn discoveries(st: &AppState) -> Result<views::DiscoveriesView, AppError> {
    with_game(st, |g| Ok(views::discoveries_view_in(st.ctx(), &g.view_world())))
}

// ───────────────────────────── 议价 ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct BargainReply {
    /// discount / threat / bribe / rapport / irrelevant
    pub intent: String,
    pub reply: String,
    /// 预计折扣（万分之一；次日生效时由内核按当时局面计算）
    pub discount_bp: i64,
    pub accepted: bool,
}

/// 锁外等待，但保留准入许可直到最终领取；配置替换立即取消本地等待。
fn process_admitted(
    st: &AppState,
    pipeline: &AiPipeline,
    task: manifest_ai::pipeline::AiTask,
    lease: &mut Option<crate::state::AiLease>,
) -> Result<manifest_ai::AiOutcome, AppError> {
    match lease {
        Some(lease) => st
            .runtime()
            .block_on(lease.process(pipeline, task))
            .ok_or_else(|| AppError::Invalid(Msg::new("app.bargain_switched", "游戏已切换，议价作废"))),
        None => Ok(st.runtime().block_on(pipeline.process(task))),
    }
}

/// 议价：意图分类与回复由 AI 管线生成（关闭 AI 时用离线模板），折扣由内核在下一个 tick 计算。
///
/// 分三步：持锁准备任务 → 释放锁等待 LLM / Jev（期间推进与其他查询照常进行）→ 重新持锁，
/// 按当时的世界做内核校验并排期。等待期间若换了一局游戏（开局或读档），结果作废。
pub fn bargain(st: &AppState, loc: u16, text: String) -> Result<BargainReply, AppError> {
    let text = text.trim().to_string();
    if text.is_empty() || text.chars().count() > manifest_core::news::MAX_PLAYER_TEXT_CHARS {
        return Err(AppError::Invalid(Msg::new("app.bargain_text", "议价内容为空或过长")));
    }
    let (generation, pipeline, task, mut lease) = with_game(st, |g| {
        let lease = g.ai.as_ref().map(|runner| runner.foreground(&mut g.session)).transpose()?.flatten();
        if !g.view_world().location_visible(LocId(loc)) {
            return Err(AppError::Invalid(Msg::new("app.no_loc", "地点不存在")));
        }
        let pipeline = match &g.ai {
            Some(r) => r.pipeline.clone(),
            None => st.offline_pipeline(),
        };
        let req = TaskRequest::Bargain { owner: PLAYER, loc: LocId(loc), player_text: text };
        let task = pipeline
            .prepare(&g.view_world(), req)
            .ok_or_else(|| AppError::Invalid(Msg::new("app.bargain_unavailable", "无法议价")))?;
        Ok((st.generation(), pipeline, task, lease))
    })?;
    let outcome = process_admitted(st, &pipeline, task, &mut lease)?;
    with_game(st, |g| {
        if st.generation() != generation || lease.as_ref().is_some_and(crate::state::AiLease::cancelled) {
            return Err(AppError::Invalid(Msg::new("app.bargain_switched", "游戏已切换，议价作废")));
        }
        let cmds = pipeline.finalize(&g.view_world(), &outcome);
        let scheduled = schedule_commands(&mut g.session, cmds);
        let intent = outcome.intent.unwrap_or(manifest_core::news::Intent::Irrelevant);
        let discount = match &outcome.task.extra {
            TaskExtra::Bargain { options, .. } => {
                options.iter().find(|(i, _, _)| *i == intent).map(|(_, d, _)| d.raw()).unwrap_or(0)
            }
            _ => 0,
        };
        // 回复按界面语言：离线模板生成的回复按模板位置重新格式化，模型写的回复原样显示
        let reply = match outcome.accepted() {
            Some(Proposal::Bargain(b)) => {
                let tpl = manifest_ai::pipeline::offline_tpl_for(&outcome, &b.reply);
                st.ctx().text(&g.view_world(), &b.reply, tpl.as_ref())
            }
            _ => String::new(),
        };
        Ok(BargainReply {
            intent: manifest_ai::adjudicator::intent_label(intent).to_string(),
            reply,
            discount_bp: discount,
            accepted: scheduled > 0,
        })
    })
}

// ───────────────────────────── AI 写的按需文字（第八批 E7）─────────────────────────────

/// 跑一个只返回文字的 AI 任务（复盘点评、身世序章）：模型写的原样返回，离线模板写的按界面语言重新格式化；
/// 结果按 `key` 缓存（同一局里同样的请求不再调用）。不改世界状态、不写命令日志。
fn ai_note(st: &AppState, key: String, req: TaskRequest, generation: u64) -> Result<String, AppError> {
    let same_game = || {
        if st.generation() != generation {
            Err(AppError::Invalid(Msg::new("app.bargain_switched", "游戏已切换，议价作废")))
        } else {
            Ok(())
        }
    };
    if let Some(hit) = with_game(st, |g| {
        same_game()?;
        Ok(g.notes.get(&key).cloned())
    })? {
        return Ok(hit);
    }
    let (pipeline, task, mut lease) = with_game(st, |g| {
        same_game()?;
        let lease = g.ai.as_ref().map(|runner| runner.foreground(&mut g.session)).transpose()?.flatten();
        let pipeline = match &g.ai {
            Some(r) => r.pipeline.clone(),
            None => st.offline_pipeline(),
        };
        let task = pipeline
            .prepare(&g.session.world, req)
            .ok_or_else(|| AppError::Invalid(Msg::new("app.note_unavailable", "没有可写的内容")))?;
        Ok((pipeline, task, lease))
    })?;
    let outcome = process_admitted(st, &pipeline, task, &mut lease)?;
    with_game(st, |g| {
        same_game()?;
        if lease.as_ref().is_some_and(crate::state::AiLease::cancelled) {
            return Err(AppError::Invalid(Msg::new("app.bargain_switched", "游戏已切换，议价作废")));
        }
        // 模型写的被裁决拒绝时退回离线备选
        let (text, tpl) = pipeline.text_result(&outcome).unwrap_or_else(|| {
            let text = match &outcome.task.offline {
                Some(Proposal::Review(t) | Proposal::Prologue(t)) => t.text.clone(),
                _ => String::new(),
            };
            (text, outcome.task.offline_tpl.clone())
        });
        let text = st.ctx().text(&g.session.world, &text, tpl.as_ref());
        g.notes.insert(key, text.clone());
        Ok(text)
    })
}

/// 请账房点评一条预测（ECONOMY.md 8.6）：`facts` 是复盘算出的诊断与驱动（界面按当前语言写好），`place` 是预测的地点与商品。
pub fn review_comment(st: &AppState, entry: u32, place: String, facts: Vec<String>) -> Result<String, AppError> {
    let generation = st.generation();
    let clean = |s: &str| s.chars().filter(|c| !c.is_control()).take(200).collect::<String>();
    let facts: Vec<String> = facts.iter().map(|f| clean(f)).filter(|f| !f.is_empty()).take(12).collect();
    if facts.is_empty() {
        return Err(AppError::Invalid(Msg::new("app.note_unavailable", "没有可写的内容")));
    }
    let place = clean(&place);
    let key = format!("review|{entry}|{:?}|{place}|{}", st.locale(), facts.join("|"));
    ai_note(st, key, TaskRequest::Review { place, facts }, generation)
}

/// 主角的身世序章（ECONOMY.md 8.7）：按身世写一段；没有身世时报错。
pub fn prologue(st: &AppState) -> Result<String, AppError> {
    let (facts, key, generation) = with_game(st, |g| {
        let w = &g.session.world;
        let c = w
            .captain_profile(PLAYER)
            .ok_or_else(|| AppError::Invalid(Msg::new("app.note_unavailable", "没有可写的内容")))?
            .clone();
        let names = st.ctx().names;
        let captain = &names.captain;
        let sign = captain.sign(&c.sign).map(|s| s.name.clone()).unwrap_or_default();
        let answers: Vec<String> = c.answers.iter().filter_map(|k| captain.option(k)).map(|o| o.name.clone()).collect();
        let start = w.defs.scenarios.get(w.state.scenario.idx()).map(|s| s.start);
        let port = start.map(|l| names.loc(l).name.clone()).unwrap_or_default();
        let name = g.captain.as_ref().map(|c| c.name.clone()).unwrap_or_default();
        let key = format!("prologue|{:?}|{name}|{}", st.locale(), c.answers.join(","));
        Ok((manifest_ai::offline::PrologueFacts { name, sign, answers, port }, key, st.generation()))
    })?;
    ai_note(st, key, TaskRequest::Prologue { captain: facts }, generation)
}

// ───────────────────────────── 设置与密钥 ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct SettingsView {
    pub settings: AppSettings,
    /// 各提供商是否已保存密钥（不返回密钥本身）
    pub keys: Vec<(ProviderKind, bool)>,
    /// 当前构建是否包含 Jev 裁决器
    pub jev_available: bool,
}

fn settings_view(st: &AppState) -> SettingsView {
    let keys = [ProviderKind::Anthropic, ProviderKind::OpenAiCompatible]
        .into_iter()
        .map(|k| (k, st.keys().get(key_account(k)).ok().flatten().is_some_and(|s| !s.is_empty())))
        .collect();
    SettingsView { settings: st.settings(), keys, jev_available: cfg!(feature = "jev") }
}

pub fn get_settings(st: &AppState) -> SettingsView {
    settings_view(st)
}

/// 重建当前游戏的 AI 执行器（设置或密钥变化后）。
fn rebuild_ai(st: &AppState) -> Result<(), AppError> {
    let mut guard = st.game()?;
    if let Some(g) = guard.as_mut() {
        g.ai = st.build_ai()?;
        st.defer_overview();
    }
    Ok(())
}

pub fn save_settings(st: &AppState, settings: AppSettings) -> Result<SettingsView, AppError> {
    st.set_settings(settings.normalized()?)?;
    rebuild_ai(st)?;
    Ok(settings_view(st))
}

pub fn set_api_key(st: &AppState, provider: ProviderKind, key: String) -> Result<SettingsView, AppError> {
    let key = key.trim().to_string();
    if key.is_empty() || key.len() > 512 {
        return Err(AppError::Invalid(Msg::new("app.api_key", "密钥为空或过长")));
    }
    st.keys().set(key_account(provider), &Secret::new(key)).map_err(|e| AppError::Key(e.to_string()))?;
    rebuild_ai(st)?;
    Ok(settings_view(st))
}

pub fn clear_api_key(st: &AppState, provider: ProviderKind) -> Result<SettingsView, AppError> {
    st.keys().delete(key_account(provider)).map_err(|e| AppError::Key(e.to_string()))?;
    rebuild_ai(st)?;
    Ok(settings_view(st))
}

// ───────────────────────────── 存档 ─────────────────────────────

/// 存档信息：写在存档旁的 `<slot>.meta.json` 中，存档列表据此显示。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SaveInfo {
    #[serde(default = "classic_world_key")]
    pub world_key: String,
    pub slot: String,
    pub day: u32,
    /// 剧本名（按读取存档列表时的界面语言；写在 meta 文件里的是中文原名）
    pub scenario: String,
    /// 剧本 key（按语言显示剧本名用）；旧存档没有这个字段
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scenario_key: Option<String>,
    pub net_worth: i64,
    /// 主角：随存档保存、读档时恢复（旧存档没有该字段，读作空）
    #[serde(default)]
    pub captain: Option<CaptainView>,
    /// 按主角开局、没另设船长时主角的名字：只给存档列表显示，读档时不恢复成船长（旧存档没有）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hero: Option<String>,
    /// 存档时的时刻（分钟 0–1439）：读档时恢复；旧存档没有该字段或字段不合法时取 8:00
    #[serde(default = "clock::default_minute", deserialize_with = "clock::lenient_minute")]
    pub minute: u16,
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "clock::lenient_navigation_pause")]
    pub navigation_stop: Option<clock::NavigationPause>,
    /// 存档写入的时刻（Unix 秒，取自存档文件的修改时间）：只在存档列表里给出，标题画面的“继续”按它挑最近的一局
    /// （2026-11-03）；不写进 meta 文件，读 meta 时也不认
    #[serde(default, skip_deserializing, skip_serializing_if = "Option::is_none")]
    pub modified: Option<u64>,
}

fn classic_world_key() -> String {
    "classic".into()
}

fn slot_ok(slot: &str) -> Result<(), AppError> {
    let ok = !slot.trim().is_empty()
        && !matches!(slot, "." | "..")
        && !slot.chars().any(|c| c.is_control() || c == '/' || c == '\\');
    if ok {
        Ok(())
    } else {
        Err(AppError::Invalid(Msg::new("app.save_name", "存档名不能为空，不能包含控制字符或路径分隔符。")))
    }
}

/// 显示名称与磁盘文件名分开；原来的合法槽名保持路径不变，新名称用定长文件名。
fn storage_slot(slot: &str) -> String {
    let upper = slot.to_ascii_uppercase();
    let reserved = matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            upper
                .strip_prefix(prefix)
                .is_some_and(|n| matches!(n, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"))
        });
    if !reserved && slot.chars().count() <= 40 && slot.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        slot.to_owned()
    } else {
        format!("~{}", blake3::hash(slot.as_bytes()).to_hex())
    }
}

fn save_path(st: &AppState, slot: &str) -> PathBuf {
    st.paths().saves_dir.join(format!("{}.mfsave.zst", storage_slot(slot)))
}

fn meta_path(st: &AppState, slot: &str) -> PathBuf {
    st.paths().saves_dir.join(format!("{}.meta.json", storage_slot(slot)))
}

/// 行情预测簿的附属文件（旧存档没有，读作空）。
fn book_path(st: &AppState, slot: &str) -> PathBuf {
    st.paths().saves_dir.join(format!("{}.book.json", storage_slot(slot)))
}

/// 存档快照：在游戏锁内只做内存拷贝，编码、压缩与写盘在锁外进行。
struct PendingSave {
    save: manifest_core::SaveFile,
    info: SaveInfo,
    /// 行情预测簿（写到附属文件）
    book: ForecastBook,
    /// 快照所属的游戏代数
    generation: u64,
    /// 自动存档：快照前的 last_autosave（写盘失败时回退）
    previous_autosave: u32,
    upbringing_unlock_notices: crate::upbringing_view::UnlockNotices,
}

/// 在游戏锁内调用。
fn snapshot_save(st: &AppState, game: &Game, slot: &str) -> Result<PendingSave, AppError> {
    slot_ok(slot)?;
    // 存档内容与界面语言无关：meta 文件里写中文原名与剧本 key，列表按界面语言显示
    let o = make_overview_in(Ctx::plain(&game.session.world.defs), game);
    let w = &game.session.world;
    let info = SaveInfo {
        world_key: w.defs.world_key.clone(),
        slot: slot.to_string(),
        day: o.day,
        scenario: o.scenario,
        scenario_key: w.defs.scenarios.get(w.state.scenario.idx()).map(|s| s.key.clone()),
        net_worth: o.net_worth,
        captain: game.captain.clone(),
        hero: if game.captain.is_none() { o.captain.as_ref().map(|c| c.name.clone()) } else { None },
        minute: game.minute,
        navigation_stop: game.last_navigation_stop.clone(),
        modified: None,
    };
    Ok(PendingSave {
        save: game.session.to_save(),
        info,
        book: game.book.clone(),
        generation: st.generation(),
        previous_autosave: 0,
        upbringing_unlock_notices: game.upbringing_unlock_notices.clone(),
    })
}

/// 在游戏锁外调用：同一时间只有一个写盘操作；同一槽位、同一局中比已写入内容更旧（日期与时刻更早）的快照直接跳过。
fn write_pending(st: &AppState, p: PendingSave) -> Result<SaveInfo, AppError> {
    let mut written = st.save_io()?;
    let slot = p.info.slot.clone();
    let stamp = clock::stamp(p.info.day, p.info.minute);
    if let Some((generation, last)) = written.get(&slot)
        && (*generation > p.generation || (*generation == p.generation && *last > stamp))
    {
        return Ok(p.info);
    }
    std::fs::create_dir_all(&st.paths().saves_dir).map_err(|e| AppError::Io(e.to_string()))?;
    storage::write(&save_path(st, &slot), &p.save, true).map_err(|e| AppError::Save(save_msg(&e)))?;
    let meta = serde_json::to_string(&SaveMeta {
        info: p.info.clone(),
        upbringing_unlock_notices: Some(p.upbringing_unlock_notices),
    })
    .map_err(|e| AppError::Io(e.to_string()))?;
    std::fs::write(meta_path(st, &slot), meta).map_err(|e| AppError::Io(e.to_string()))?;
    std::fs::write(book_path(st, &slot), p.book.to_file()?).map_err(|e| AppError::Io(e.to_string()))?;
    written.insert(slot, (p.generation, stamp));
    Ok(p.info)
}

pub fn save_game(st: &AppState, slot: &str) -> Result<SaveInfo, AppError> {
    let pending = with_game(st, |g| snapshot_save(st, g, slot))?;
    write_pending(st, pending)
}

/// 读取存档附带的应用层数据：主角与时刻。meta 缺失或损坏时主角为空、时刻取 8:00；主角不合法时为空
/// （旧存档照常读取）。
fn read_meta(st: &AppState, slot: &str) -> Option<SaveMeta> {
    std::fs::read_to_string(meta_path(st, slot)).ok().and_then(|text| serde_json::from_str::<SaveMeta>(&text).ok())
}

/// 读档：只读快照与命令日志，不重新调用 AI；AI 按当前设置继续处理之后的日程。
/// 主角与时刻从存档的 meta 文件恢复。
pub fn load_game(st: &AppState, slot: &str) -> Result<Overview, AppError> {
    let _transition = st.transition()?;
    slot_ok(slot)?;
    // 在写盘锁内读取存档与 meta，保证两者来自同一次写入（不与游戏锁嵌套）
    let (save, meta, book) = {
        let _io = st.save_io()?;
        let save = storage::read(&save_path(st, slot)).map_err(|e| AppError::Save(save_msg(&e)))?;
        let book = ForecastBook::from_file(std::fs::read_to_string(book_path(st, slot)).ok().as_deref());
        (save, read_meta(st, slot), book)
    };
    let resources = st.worlds().get(&save.world)?;
    let session = GameSession::from_save(resources.defs.clone(), save).map_err(|e| AppError::Save(save_msg(&e)))?;
    let (captain, minute, navigation_stop, notices) = meta
        .map(|meta| (meta.info.captain, meta.info.minute, meta.info.navigation_stop, meta.upbringing_unlock_notices))
        .unwrap_or((None, DEFAULT_MINUTE, None, None));
    let upbringing_unlock_notices = crate::upbringing_view::UnlockNotices::restore(notices, &session.world);
    let scenario = session.world.defs.scenarios.get(session.world.state.scenario.idx());
    let custom = session.start.opening.as_ref().is_some_and(|r| r.template.is_some());
    let captain = captain.and_then(|c| {
        if custom { worlds::validate_custom_captain(c).ok() } else { validate_captain_for(c, scenario).ok() }
    });
    let day = session.day();
    let minute = if session.world.defs.manual_navigation {
        clock::norm(
            u32::from(DAY_START_MINUTE)
                + clock::since_day_start(minute).max(u32::from(session.world.state.navigation.settled)),
        )
    } else {
        minute
    };
    let navigation_stop = navigation_stop.filter(|stop| {
        (stop.day == day && u32::from(stop.minute) <= clock::since_day_start(minute))
            || (stop.day.checked_add(1) == Some(day) && stop.minute == 1440 && minute == DAY_START_MINUTE)
    });
    let game = Game {
        session,
        ai: st.build_ai_for(resources)?,
        speed: 0,
        resume_speed: None,
        run_speed: crate::settings::nearest_tier(st.settings().speed),
        last_autosave: day,
        captain,
        minute,
        last_navigation_stop: navigation_stop,
        book,
        notes: Default::default(),
        clock_speeds: Default::default(),
        upbringing_unlock_notices,
    };
    st.replace_game_with(game, |g| make_overview(st, g))
}

/// 删除一个存档（存档本体、meta、行情预测簿，连同写到一半留下的临时文件），返回删除后的存档列表。
/// 在写盘锁内进行，不会删到正在写的存档；正在进行的这一局不受影响（它在内存里，再存一次就又有了）。
/// 没有这个存档时报错。
pub fn delete_save(st: &AppState, slot: &str) -> Result<Vec<SaveInfo>, AppError> {
    slot_ok(slot)?;
    {
        let mut written = st.save_io()?;
        if !save_path(st, slot).is_file() && !meta_path(st, slot).is_file() {
            return Err(AppError::Invalid(
                Msg::new("app.no_save", format!("没有名为 {slot} 的存档")).arg("slot", slot),
            ));
        }
        let tmp = save_path(st, slot).with_extension("tmp");
        for path in [save_path(st, slot), meta_path(st, slot), book_path(st, slot), tmp] {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(AppError::Io(e.to_string())),
            }
        }
        // 写盘记录也清掉：之后同名槽位（例如自动存档）照常写入
        written.remove(slot);
    }
    list_saves(st)
}

pub fn list_saves(st: &AppState) -> Result<Vec<SaveInfo>, AppError> {
    let dir = &st.paths().saves_dir;
    let Ok(entries) = std::fs::read_dir(dir) else { return Ok(Vec::new()) };
    let mut out: Vec<SaveInfo> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let stem = name.strip_suffix(".meta.json")?;
            let text = std::fs::read_to_string(e.path()).ok()?;
            let mut info: SaveInfo = serde_json::from_str(&text).ok()?;
            slot_ok(&info.slot).ok()?;
            if storage_slot(&info.slot) != stem {
                return None;
            }
            let save = std::fs::metadata(save_path(st, &info.slot)).ok().filter(|m| m.is_file())?;
            // 存档写入的时刻：标题画面的“继续”按它挑最近的一局
            info.modified =
                save.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs());
            Some(info)
        })
        .collect();
    out.sort_by(|a, b| a.slot.cmp(&b.slot));
    // 剧本名按界面语言：只用已经载入的世界改写（2026-11-03：不为列存档去载入整个世界，寰宇要好几秒，
    // 标题画面的“继续”“读档”因此不必等世界载入）；还没载入的世界照 meta 里写的中文原名
    let locale = st.locale();
    for info in &mut out {
        let Some(resources) = st.worlds().loaded(&info.world_key) else { continue };
        let names = &resources.locales.get(locale).defs.scenarios;
        if let Some(s) = info.scenario_key.as_ref().and_then(|k| names.iter().find(|s| &s.key == k)) {
            info.scenario = s.name.clone();
        }
    }
    Ok(out)
}

/// 存档读写错误的键与细节（中文原文不变；其他语言按 `data/texts.toml [save]` 的键重新格式化）。
fn save_msg(e: &manifest_sim::SimError) -> Msg {
    use manifest_core::CoreError;
    use manifest_sim::SimError;
    let zh = e.to_string();
    let split = |s: &str, prefix: &str| s.strip_prefix(prefix).map(str::to_string);
    let (key, detail): (&'static str, String) = match e {
        SimError::Storage(s) => {
            let table: [(&str, &'static str); 6] = [
                ("读取存档失败：", "save.read"),
                ("写入存档失败：", "save.write"),
                ("保存存档失败：", "save.write"),
                ("无法创建目录：", "save.write"),
                ("zstd 解压失败：", "save.decompress"),
                ("存档不是 UTF-8：", "save.not_utf8"),
            ];
            table.iter().find_map(|(p, k)| split(s, p).map(|d| (*k, d))).unwrap_or(("save.other", s.clone()))
        }
        SimError::Core(CoreError::Save(s)) => {
            if let Some(d) = split(s, "JSON 解析失败：") {
                ("save.json", d)
            } else if let Some(d) = split(s, "存档结构不符：") {
                ("save.structure", d)
            } else if let Some(d) = split(s, "不是 Manifest 存档（format = “") {
                ("save.not_manifest", d.trim_end_matches("”）").to_string())
            } else if s == "缺少版本号" {
                ("save.no_version", String::new())
            } else if s.starts_with("存档版本") {
                ("save.too_new", s.clone())
            } else {
                ("save.other", s.clone())
            }
        }
        SimError::Core(CoreError::SnapshotMismatch(s)) => ("save.mismatch", s.clone()),
        other => ("save.other", other.to_string()),
    };
    Msg::new(key, zh).arg("detail", detail)
}

// ───────────────────────────── 调试 ─────────────────────────────

#[derive(Clone, Debug, Serialize)]
pub struct DebugView {
    pub day: u32,
    pub state_hash: String,
    pub log_len: usize,
    pub ai_commands: usize,
    pub money_conserved: bool,
    pub audit: Vec<AuditEntry>,
}

pub fn debug(st: &AppState) -> Result<DebugView, AppError> {
    with_game(st, |g| {
        let s = &g.session;
        Ok(DebugView {
            day: s.day(),
            state_hash: s.world.state_hash(),
            log_len: s.log().len(),
            ai_commands: s.log().iter().filter(|e| e.source == manifest_core::replay::Source::Ai).count(),
            money_conserved: s.world.money_conserved(),
            audit: g.ai.as_ref().map(|a| a.pipeline.audit_log()).unwrap_or_default(),
        })
    })
}

impl AppState {
    /// 临时的离线模板管线（关闭 AI 时议价仍可用）。
    pub fn offline_pipeline(&self) -> std::sync::Arc<AiPipeline> {
        let settings = AiSettings { mode: AiMode::Offline, ..AiSettings::default() };
        std::sync::Arc::new(AiPipeline::new(self.content().clone(), &settings, None))
    }
}

pub fn inventory(st: &AppState) -> Result<Value, AppError> {
    if !st.defs().items.enabled() {
        return Err(items_unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    Ok(crate::items_view::inventory_for(st.ctx(), &game.view_world(), game.captain.as_ref()))
}

pub fn item_shop(st: &AppState, loc: u16) -> Result<Value, AppError> {
    if !st.defs().items.enabled() {
        return Ok(Value::Null);
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    Ok(crate::items_view::item_shop(st.ctx(), &game.view_world(), manifest_core::LocId(loc)))
}

pub fn codex(st: &AppState, category: Option<String>) -> Result<Value, AppError> {
    if !st.defs().items.enabled() {
        return Err(items_unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    Ok(crate::codex_view::codex(st.ctx(), &game.view_world(), category.as_deref()))
}

// I4 / I9 正式查询；经典世界沿用明确的功能未启用响应。
fn items_unavailable() -> AppError {
    AppError::Invalid(Msg::new("app.feature_unavailable", "这个世界还没有这项功能"))
}
pub fn auctions(st: &AppState, loc: Option<u16>) -> Result<Value, AppError> {
    if st.defs().auctions.auctions.is_empty() {
        return Err(items_unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    Ok(crate::auction_view::auctions(st.ctx(), &game.view_world(), loc.map(LocId)))
}
pub fn auction(st: &AppState, key: String) -> Result<Value, AppError> {
    if st.defs().auctions.auctions.is_empty() {
        return Err(items_unavailable());
    }
    let game = st.game()?;
    let game = game.as_ref().ok_or(AppError::NoGame)?;
    crate::auction_view::auction(st.ctx(), &game.view_world(), &key, game.captain.as_ref().map(|c| c.name.as_str()))
        .ok_or_else(|| AppError::Command(manifest_core::Reason::new("auction.unknown", "没有这场拍卖会").rule()))
}

/// H10b：Ticker 使用的实际日长；切换海港场景时同步各自记忆的档位。
pub fn current_day_ms(st: &AppState) -> u64 {
    let Ok(mut guard) = st.game() else { return 0 };
    let Some(game) = guard.as_mut() else { return 0 };
    game.sync_clock_speed();
    clock::day_ms(game.speed, game.sea_clock())
}

/// H10b：当天分钟点加指定天数的只读预测。
pub fn course_view(
    st: &AppState,
    fleet: u32,
    steers: Vec<manifest_core::navigation::Steering>,
    minute: u16,
    days: u8,
) -> Result<Value, AppError> {
    let guard = st.game()?;
    let game = guard.as_ref().ok_or(AppError::NoGame)?;
    cached_course(st, game, fleet, &steers, minute, days)
}

fn cached_course(
    st: &AppState,
    game: &Game,
    fleet: u32,
    steers: &[manifest_core::navigation::Steering],
    minute: u16,
    days: u8,
) -> Result<Value, AppError> {
    if days > 2 {
        return Err(AppError::Command(manifest_core::CommandError::InvalidQuantity));
    }
    let now = clock::since_day_start(game.minute) as u16;
    for steer in steers {
        manifest_core::navigation::orders::check_minute(steer.minute, now).map_err(AppError::Command)?;
    }
    let locale = st.locale();
    let key = crate::view_cache::ViewKey::new(
        st,
        game,
        locale,
        crate::view_cache::Query::Course { fleet, minute, steers, days },
    )?;
    st.cached_view(key, || {
        crate::navigation_view::course_view(
            st.resources().locales.ctx(locale),
            &game.view_world(),
            FleetId(fleet),
            steers,
            minute,
            days,
        )
        .map_err(AppError::Command)
    })
}

pub fn navigation_dests(st: &AppState, fleet: u32) -> Result<Value, AppError> {
    crate::navigation_dests::navigation_dests(st, fleet)
}

/// H10b：读取目标与提交 Steer 共用游戏锁，避免后台推进使目标计算所用分钟过期。
pub fn steer_toward(
    st: &AppState,
    fleet: u32,
    target: manifest_core::navigation::SubCell,
    sail: Option<manifest_core::navigation::Sail>,
) -> Result<SubmitResult, AppError> {
    with_game(st, |g| {
        let minute = clock::since_day_start(g.minute) as u16;
        let steering =
            g.session.world.steering_toward(FleetId(fleet), target, minute, sail).map_err(AppError::Command)?;
        let outcome = g
            .session
            .submit_at(
                minute,
                Command::Steer {
                    owner: PLAYER,
                    fleet: FleetId(fleet),
                    minute,
                    heading: steering.heading,
                    sail: steering.sail,
                },
            )
            .map_err(AppError::Command)?;
        g.sync_clock_speed();
        Ok(SubmitResult { outcome, overview: make_overview(st, g) })
    })
}

/// 内部 meta 扩展不进入存档列表视图；缺字段的旧档照常读取。
#[derive(Serialize, Deserialize)]
struct SaveMeta {
    #[serde(flatten)]
    info: SaveInfo,
    /// None 是旧档；Some({}) 区分尚未显示过任何提示的新档。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    upbringing_unlock_notices: Option<crate::upbringing_view::UnlockNotices>,
}
