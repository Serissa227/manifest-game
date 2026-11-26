//! Tauri 命令：只做参数转发。处理函数在独立线程中执行，既不阻塞界面主线程，
//! 也不与 Tauri 自身的异步运行时相互嵌套。

use crate::forecast::{BookView, PinRequest, SeriesView};
use crate::handlers::{
    self, BargainReply, CaravanPlanRequest, DebugView, QuoteRequest, SailPreview, SaveInfo, SettingsView, SubmitResult,
};
use crate::settings::AppSettings;
use crate::views::{self, Overview};
use crate::{AppError, AppHolder, AppState};
use manifest_ai::ProviderKind;
use manifest_core::Command;
use manifest_core::market::TradeQuote;
use serde_json::Value;

/// 各命令取到的应用状态（启动时在后台加载，加载完成前在处理线程里等待）。
type State<'a> = tauri::State<'a, AppHolder>;

async fn run<T, F>(st: State<'_>, f: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&AppState) -> Result<T, AppError> + Send + 'static,
{
    let holder = st.inner().clone();
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        // 错误按界面语言格式化后再返回
        let _ = tx.send(holder.get().and_then(|st| f(&st).map_err(|e| st.localize_error(e))));
    });
    rx.await.map_err(|_| AppError::Poisoned)?
}

#[tauri::command]
pub async fn static_data(st: State<'_>) -> Result<views::StaticView, AppError> {
    run(st, |s| Ok(handlers::static_data(s))).await
}

#[tauri::command]
pub async fn new_game(st: State<'_>, scenario: String, seed: Option<u64>) -> Result<Overview, AppError> {
    run(st, move |s| handlers::new_game(s, &scenario, seed)).await
}

#[tauri::command]
pub async fn overview(st: State<'_>) -> Result<Overview, AppError> {
    run(st, handlers::overview).await
}

#[tauri::command]
pub async fn set_captain(st: State<'_>, captain: views::CaptainView) -> Result<Overview, AppError> {
    run(st, move |s| handlers::set_captain(s, captain)).await
}

#[tauri::command]
pub async fn step(st: State<'_>, days: u32) -> Result<Overview, AppError> {
    run(st, move |s| handlers::step(s, days)).await
}

#[tauri::command]
pub async fn set_speed(st: State<'_>, speed: u8) -> Result<Overview, AppError> {
    run(st, move |s| handlers::set_speed(s, speed)).await
}

#[tauri::command]
pub async fn submit(st: State<'_>, command: Command) -> Result<SubmitResult, AppError> {
    run(st, move |s| handlers::submit(s, command)).await
}

#[tauri::command]
pub async fn quote(st: State<'_>, request: QuoteRequest) -> Result<TradeQuote, AppError> {
    run(st, move |s| handlers::quote(s, request)).await
}

#[tauri::command]
pub async fn port(st: State<'_>, loc: u16) -> Result<views::PortView, AppError> {
    run(st, move |s| handlers::port(s, loc)).await
}

#[tauri::command]
pub async fn market_series(st: State<'_>, loc: u16, good: u16) -> Result<SeriesView, AppError> {
    run(st, move |s| handlers::market_series(s, loc, good)).await
}

#[tauri::command]
pub async fn forecast_book(st: State<'_>) -> Result<BookView, AppError> {
    run(st, handlers::forecast_book).await
}

#[tauri::command]
pub async fn pin_forecast(st: State<'_>, request: PinRequest) -> Result<BookView, AppError> {
    run(st, move |s| handlers::pin_forecast(s, request)).await
}

#[tauri::command]
pub async fn remove_forecast(st: State<'_>, id: u32) -> Result<BookView, AppError> {
    run(st, move |s| handlers::remove_forecast(s, id)).await
}

/// H07 航线预览：多站行程、预计天数、粮水与当季风险。
#[tauri::command]
pub async fn route_plan(st: State<'_>, request: handlers::RoutePlanRequest) -> Result<Value, AppError> {
    run(st, move |s| handlers::route_plan(s, request)).await
}

/// H07 季风历：某月各取样点的风与流（只取已有海图的海区）。
#[tauri::command]
pub async fn monsoon(st: State<'_>, month: Option<u8>) -> Result<Value, AppError> {
    run(st, move |s| handlers::monsoon(s, month)).await
}

/// H07 航线纪录。
#[tauri::command]
pub async fn route_records(st: State<'_>) -> Result<Value, AppError> {
    run(st, handlers::route_records).await
}

#[tauri::command]
pub async fn sail_preview(st: State<'_>, fleet: u32, dest: u16) -> Result<Option<SailPreview>, AppError> {
    run(st, move |s| handlers::sail_preview(s, fleet, dest)).await
}

#[tauri::command]
pub async fn caravan_plan(
    st: State<'_>,
    request: CaravanPlanRequest,
) -> Result<Option<views::CaravanPlanView>, AppError> {
    run(st, move |s| handlers::caravan_plan(s, request)).await
}

#[tauri::command]
pub async fn futures(st: State<'_>) -> Result<views::FuturesView, AppError> {
    run(st, handlers::futures).await
}

#[tauri::command]
pub async fn industries(st: State<'_>) -> Result<views::IndustriesView, AppError> {
    run(st, handlers::industries).await
}

#[tauri::command]
pub async fn reports(st: State<'_>) -> Result<views::ReportsView, AppError> {
    run(st, handlers::reports).await
}

#[tauri::command]
pub async fn intel(st: State<'_>) -> Result<views::IntelView, AppError> {
    run(st, handlers::intel).await
}

#[tauri::command]
pub async fn mates(st: State<'_>) -> Result<views::MatesView, AppError> {
    run(st, handlers::mates).await
}

#[tauri::command]
pub async fn battle(st: State<'_>, id: u32) -> Result<Option<views::TacticalView>, AppError> {
    run(st, move |s| handlers::battle(s, id)).await
}

#[tauri::command]
pub async fn fog(st: State<'_>) -> Result<Vec<String>, AppError> {
    run(st, handlers::fog).await
}

#[tauri::command]
pub async fn colonies(st: State<'_>) -> Result<views::ColoniesView, AppError> {
    run(st, handlers::colonies).await
}

#[tauri::command]
pub async fn site(st: State<'_>, loc: u16) -> Result<views::SiteView, AppError> {
    run(st, move |s| handlers::site(s, loc)).await
}

#[tauri::command]
pub async fn discoveries(st: State<'_>) -> Result<views::DiscoveriesView, AppError> {
    run(st, handlers::discoveries).await
}

#[tauri::command]
pub async fn bargain(st: State<'_>, loc: u16, text: String) -> Result<BargainReply, AppError> {
    run(st, move |s| handlers::bargain(s, loc, text)).await
}

#[tauri::command]
pub async fn review_comment(st: State<'_>, entry: u32, place: String, facts: Vec<String>) -> Result<String, AppError> {
    run(st, move |s| handlers::review_comment(s, entry, place, facts)).await
}

#[tauri::command]
pub async fn prologue(st: State<'_>) -> Result<String, AppError> {
    run(st, handlers::prologue).await
}

#[tauri::command]
pub async fn get_settings(st: State<'_>) -> Result<SettingsView, AppError> {
    run(st, |s| Ok(handlers::get_settings(s))).await
}

#[tauri::command]
pub async fn save_settings(st: State<'_>, settings: AppSettings) -> Result<SettingsView, AppError> {
    run(st, move |s| handlers::save_settings(s, settings)).await
}

#[tauri::command]
pub async fn set_api_key(st: State<'_>, provider: ProviderKind, key: String) -> Result<SettingsView, AppError> {
    run(st, move |s| handlers::set_api_key(s, provider, key)).await
}

#[tauri::command]
pub async fn clear_api_key(st: State<'_>, provider: ProviderKind) -> Result<SettingsView, AppError> {
    run(st, move |s| handlers::clear_api_key(s, provider)).await
}

#[tauri::command]
pub async fn save_game(st: State<'_>, slot: String) -> Result<SaveInfo, AppError> {
    run(st, move |s| handlers::save_game(s, &slot)).await
}

#[tauri::command]
pub async fn load_game(st: State<'_>, slot: String) -> Result<Overview, AppError> {
    run(st, move |s| handlers::load_game(s, &slot)).await
}

#[tauri::command]
pub async fn list_saves(st: State<'_>) -> Result<Vec<SaveInfo>, AppError> {
    run(st, handlers::list_saves).await
}

/// 删除一个存档，返回删除后的存档列表。
#[tauri::command]
pub async fn delete_save(st: State<'_>, slot: String) -> Result<Vec<SaveInfo>, AppError> {
    run(st, move |s| handlers::delete_save(s, &slot)).await
}

#[tauri::command]
pub async fn debug(st: State<'_>) -> Result<DebugView, AppError> {
    run(st, handlers::debug).await
}

#[tauri::command]
pub async fn world_catalog(st: State<'_>) -> Result<views::WorldCatalog, AppError> {
    run(st, handlers::world_catalog).await
}

#[tauri::command]
pub async fn select_world(st: State<'_>, world: String) -> Result<views::StaticView, AppError> {
    run(st, move |s| handlers::select_world(s, world)).await
}

#[tauri::command]
pub async fn new_world_game(st: State<'_>, request: handlers::NewGameRequest) -> Result<Overview, AppError> {
    run(st, move |s| handlers::new_world_game(s, request)).await
}

#[tauri::command]
pub async fn upbringing(st: State<'_>) -> Result<Value, AppError> {
    run(st, handlers::pending::upbringing).await
}

#[tauri::command]
pub async fn auto_plan(st: State<'_>, preset: String) -> Result<Value, AppError> {
    run(st, move |s| handlers::pending::auto_plan(s, preset)).await
}

#[tauri::command]
pub async fn contest(st: State<'_>, key: String) -> Result<Value, AppError> {
    run(st, move |s| handlers::pending::contest(s, key)).await
}

#[tauri::command]
pub async fn contest_preview(st: State<'_>, key: String, moves: Vec<Value>) -> Result<Value, AppError> {
    run(st, move |s| handlers::pending::contest_preview(s, key, moves)).await
}

#[tauri::command]
pub async fn contest_outcome(st: State<'_>, key: String, moves: Option<Vec<Value>>) -> Result<Value, AppError> {
    run(st, move |s| handlers::pending::contest_outcome(s, key, moves)).await
}

#[tauri::command]
pub async fn endings(st: State<'_>) -> Result<Value, AppError> {
    run(st, handlers::pending::endings).await
}

#[tauri::command]
pub async fn persons(st: State<'_>, loc: Option<u16>) -> Result<Value, AppError> {
    run(st, move |s| handlers::pending::persons(s, loc)).await
}

#[tauri::command]
pub async fn person(st: State<'_>, key: String) -> Result<Value, AppError> {
    run(st, move |s| handlers::pending::person(s, key)).await
}

#[tauri::command]
pub async fn relationships(st: State<'_>) -> Result<Value, AppError> {
    run(st, handlers::pending::relationships).await
}

#[tauri::command]
pub async fn story_log(st: State<'_>) -> Result<Value, AppError> {
    run(st, handlers::pending::story_log).await
}

#[tauri::command]
pub async fn gossip(st: State<'_>, loc: Option<u16>, limit: Option<u32>) -> Result<Value, AppError> {
    run(st, move |s| handlers::story2::gossip(s, loc, limit)).await
}

#[tauri::command]
pub async fn inventory(st: State<'_>) -> Result<Value, AppError> {
    run(st, handlers::inventory).await
}

#[tauri::command]
pub async fn item_shop(st: State<'_>, loc: u16) -> Result<Value, AppError> {
    run(st, move |s| handlers::item_shop(s, loc)).await
}

#[tauri::command]
pub async fn codex(st: State<'_>, category: Option<String>) -> Result<Value, AppError> {
    run(st, move |s| handlers::codex(s, category)).await
}

#[tauri::command]
pub async fn auctions(st: State<'_>, loc: Option<u16>) -> Result<Value, AppError> {
    run(st, move |s| handlers::auctions(s, loc)).await
}

#[tauri::command]
pub async fn auction(st: State<'_>, key: String) -> Result<Value, AppError> {
    run(st, move |s| handlers::auction(s, key)).await
}

#[tauri::command]
pub async fn timeline(st: State<'_>) -> Result<Value, AppError> {
    run(st, handlers::pending::timeline).await
}

#[tauri::command]
pub async fn campaign(st: State<'_>, key: String) -> Result<Value, AppError> {
    run(st, move |s| handlers::pending::campaign(s, key)).await
}

#[tauri::command]
pub async fn chronicle(st: State<'_>) -> Result<Value, AppError> {
    run(st, handlers::pending::chronicle).await
}

#[tauri::command]
pub async fn societies(st: State<'_>) -> Result<Value, AppError> {
    run(st, handlers::pending::societies).await
}

#[tauri::command]
pub async fn arcana(st: State<'_>) -> Result<Value, AppError> {
    run(st, handlers::pending::arcana).await
}

#[tauri::command]
pub async fn ideas(st: State<'_>, loc: u16) -> Result<Value, AppError> {
    run(st, move |s| handlers::pending::ideas(s, loc)).await
}

#[tauri::command]
pub async fn legend_ships(st: State<'_>) -> Result<Value, AppError> {
    run(st, handlers::pending::legend_ships).await
}

#[tauri::command]
pub async fn realms(st: State<'_>) -> Result<Value, AppError> {
    run(st, handlers::pending::realms).await
}

#[tauri::command]
pub async fn map_resource(st: State<'_>, map: String) -> Result<views::MapResource, AppError> {
    run(st, move |s| handlers::map_resource(s, map)).await
}

#[tauri::command]
pub async fn map_fine(st: State<'_>, map: String) -> Result<views::MapFineResource, AppError> {
    run(st, move |s| handlers::map_fine(s, map)).await
}

#[tauri::command]
pub async fn fog_delta(st: State<'_>, since: u64, epoch: Option<String>) -> Result<views::FogDelta, AppError> {
    run(st, move |s| handlers::fog_delta(s, since, epoch)).await
}

#[tauri::command]
pub async fn navigation(st: State<'_>, fleet: u32) -> Result<Value, AppError> {
    run(st, move |s| handlers::pending::navigation(s, fleet)).await
}

#[tauri::command]
pub async fn preview_course(
    st: State<'_>,
    fleet: u32,
    steers: Vec<manifest_core::navigation::Steering>,
    minute: u16,
) -> Result<Value, AppError> {
    run(st, move |s| handlers::preview_course(s, fleet, steers, minute)).await
}

#[tauri::command]
pub async fn pin_quest(st: State<'_>, id: Option<String>) -> Result<Overview, AppError> {
    run(st, move |s| manifest_appcore::pin_quest(s, id)).await
}

#[tauri::command]
pub async fn navigation_view(
    st: State<'_>,
    fleet: u32,
    opts: Option<manifest_appcore::navigation_view::NavigationOptions>,
) -> Result<Value, AppError> {
    run(st, move |s| handlers::pending::navigation_view(s, fleet, opts.unwrap_or_default())).await
}

#[tauri::command]
pub async fn navigation_dests(st: State<'_>, fleet: u32) -> Result<Value, AppError> {
    run(st, move |s| handlers::navigation_dests(s, fleet)).await
}

#[tauri::command]
pub async fn course_view(
    st: State<'_>,
    fleet: u32,
    steers: Vec<manifest_core::navigation::Steering>,
    minute: u16,
    days: u8,
) -> Result<Value, AppError> {
    run(st, move |s| handlers::course_view(s, fleet, steers, minute, days)).await
}

#[tauri::command]
pub async fn steer_toward(
    st: State<'_>,
    fleet: u32,
    target: manifest_core::navigation::SubCell,
    sail: Option<manifest_core::navigation::Sail>,
) -> Result<manifest_appcore::handlers::SubmitResult, AppError> {
    run(st, move |s| handlers::steer_toward(s, fleet, target, sail)).await
}
