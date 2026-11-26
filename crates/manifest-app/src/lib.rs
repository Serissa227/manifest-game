//! Manifest 桌面应用：Tauri 2 外壳与应用入口。
//!
//! 应用层（处理函数、视图、设置、存档与时钟）在 `manifest-appcore`，这里原样重新导出，路径不变
//! （`manifest_app::handlers`、`manifest_app::AppState`……）；网页服务端（`manifest-server`）直接用应用层，不带 Tauri。
//!
//! - [`commands`]：薄薄一层 `#[tauri::command]` 包装，在后台线程中调用处理函数。
//! - [`run`]：启动窗口，后台加载 data/，启动自动推进线程（[`spawn_ticker`]），把事件转给界面。
//! - [`fit_window`]：窗口的初始大小放不进显示器（小笔记本、系统缩放 125% / 150%）时缩到工作区之内（网页自适应）。

pub use manifest_appcore::*;

pub mod commands;
mod startup;

use std::sync::Arc;
use tauri::{Emitter, Manager};

/// 窗口的最小尺寸（逻辑像素，与 `tauri.conf.json` 的 minWidth / minHeight 一致）。界面在更小的尺寸下也排得开
/// （手机横屏的紧凑布局），这里只是别让窗口被缩到看不见；取得小一些，1366 × 768 的笔记本开 125% 缩放时也放得下。
pub const MIN_WINDOW: (f64, f64) = (720.0, 480.0);

/// 初始大小放不进工作区时，缩到工作区的这么多。
const FIT_RATIO: f64 = 0.92;

/// 窗口的初始大小（逻辑像素）：配置里的大小（`desired`）放得进显示器的工作区（`work`，除去任务栏、再减去标题栏与边框）时不动，返回 None；
/// 放不进时缩到工作区的 92%（宽高分别算），但不小于最小尺寸（`min`）。
pub fn fit_window(desired: (f64, f64), min: (f64, f64), work: (f64, f64)) -> Option<(f64, f64)> {
    if desired.0 <= work.0 && desired.1 <= work.1 {
        return None;
    }
    let w = desired.0.min(work.0 * FIT_RATIO).max(min.0);
    let h = desired.1.min(work.1 * FIT_RATIO).max(min.1);
    Some((w.round(), h.round()))
}

/// 按主窗口所在显示器的工作区调整初始大小，调整过就居中。拿不到显示器信息时什么也不做。
fn fit_to_monitor(win: &tauri::WebviewWindow) {
    let Ok(Some(monitor)) = win.current_monitor() else {
        return;
    };
    let (Ok(inner), Ok(outer)) = (win.inner_size(), win.outer_size()) else {
        return;
    };
    let scale = monitor.scale_factor();
    if scale <= 0.0 {
        return;
    }
    let work = monitor.work_area();
    // 标题栏与边框占的地方
    let chrome_w = f64::from(outer.width.saturating_sub(inner.width)) / scale;
    let chrome_h = f64::from(outer.height.saturating_sub(inner.height)) / scale;
    let avail = (f64::from(work.size.width) / scale - chrome_w, f64::from(work.size.height) / scale - chrome_h);
    let desired = (f64::from(inner.width) / scale, f64::from(inner.height) / scale);
    if let Some((w, h)) = fit_window(desired, MIN_WINDOW, avail) {
        let _ = win.set_size(tauri::LogicalSize::new(w, h));
        let _ = win.center();
    }
}

/// 启动桌面应用。
pub fn run() {
    if let Err(err) = run_with_environment() {
        eprintln!("应用启动失败：{err}");
        std::process::exit(1);
    }
}

fn run_with_environment() -> tauri::Result<()> {
    let options = startup::StartupOptions::from_env()?;
    let mut context = tauri::generate_context!();
    let windows = options.prepare_windows(context.config_mut());
    tauri::Builder::default()
        .setup(move |app| {
            let config_dir = options.user_directory(|| app.path().app_config_dir())?;
            eprintln!("[manifest-app] user directory: {}", config_dir.display());
            options.create_windows(app, windows)?;
            // 小屏幕（或系统缩放大）时，配置里的 1440 × 900 放不下：缩到显示器的工作区之内
            if let Some(win) = app.get_webview_window("main") {
                fit_to_monitor(&win);
            }
            // 在后台线程加载 data/（含航线表预计算），窗口立即可用；加载完成前的请求在 AppHolder 中等待
            let holder = AppHolder::default();
            app.manage(holder.clone());
            // 航线表缓存（寰宇约 66 MB）写到用户的本地缓存目录，不写在 exe 与 data 旁（2026-11-03）；data 旁现成的照旧先读
            if let Ok(cache) = options.user_directory(|| app.path().app_cache_dir()) {
                manifest_data::nav_cache::use_user_cache_dir(cache.join("nav"));
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                // 加载过程若意外 panic，也要让等待中的请求得到错误而不是永久等待
                let loaded = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    manifest_data::find_data_dir()
                        .ok_or_else(|| "找不到 data/ 目录（可设置环境变量 MANIFEST_DATA_DIR）".to_string())
                        .and_then(|dir| {
                            let keys: Arc<dyn manifest_ai::KeyStore> =
                                Arc::new(manifest_ai::KeyringStore::new("manifest-game"));
                            AppState::from_data_dir_in_background(&dir, keys, AppPaths::in_dir(&config_dir))
                                .map_err(|e| e.to_string())
                        })
                }))
                .unwrap_or_else(|_| Err("加载数据时发生内部错误".to_string()));
                if let Ok(st) = &loaded {
                    st.set_emitter(Arc::new(move |event, payload| {
                        let _ = handle.emit(event, payload);
                    }));
                    spawn_ticker(st.clone());
                    // 标题画面先能操作；开局目录里的世界（寰宇）接着在后台载入，选世界、开新局、读档时多半已经载好
                    // 载入途中到达的请求在世界注册表里等同一次载入，不会重复载入
                    let worlds = st.worlds().clone();
                    std::thread::spawn(move || {
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| worlds.preload_visible()));
                    });
                }
                holder.set(loaded);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::static_data,
            commands::new_game,
            commands::overview,
            commands::set_captain,
            commands::step,
            commands::set_speed,
            commands::submit,
            commands::quote,
            commands::port,
            commands::market_series,
            commands::forecast_book,
            commands::pin_forecast,
            commands::remove_forecast,
            commands::sail_preview,
            commands::route_plan,
            commands::monsoon,
            commands::route_records,
            commands::caravan_plan,
            commands::futures,
            commands::industries,
            commands::reports,
            commands::intel,
            commands::mates,
            commands::battle,
            commands::fog,
            commands::colonies,
            commands::site,
            commands::discoveries,
            commands::bargain,
            commands::review_comment,
            commands::prologue,
            commands::get_settings,
            commands::save_settings,
            commands::set_api_key,
            commands::clear_api_key,
            commands::save_game,
            commands::load_game,
            commands::list_saves,
            commands::delete_save,
            commands::debug,
            commands::world_catalog,
            commands::select_world,
            commands::new_world_game,
            commands::upbringing,
            commands::auto_plan,
            commands::contest,
            commands::contest_preview,
            commands::contest_outcome,
            commands::endings,
            commands::persons,
            commands::person,
            commands::relationships,
            commands::story_log,
            commands::gossip,
            commands::inventory,
            commands::item_shop,
            commands::codex,
            commands::auctions,
            commands::auction,
            commands::timeline,
            commands::campaign,
            commands::chronicle,
            commands::societies,
            commands::arcana,
            commands::ideas,
            commands::legend_ships,
            commands::realms,
            commands::map_resource,
            commands::map_fine,
            commands::fog_delta,
            commands::navigation,
            commands::preview_course,
            commands::pin_quest,
            commands::navigation_view,
            commands::navigation_dests,
            commands::course_view,
            commands::steer_toward,
        ])
        .run(context)
}
