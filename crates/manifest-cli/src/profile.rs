//! 启动与读档的分段计时（`manifest-cli profile-startup`）：照桌面应用的启动顺序逐段打时间，不开窗口、不连网。
//!
//! - 缺省：照桌面版建应用状态（世界包在后台登记）、后台预先载入开局目录里的世界，
//!   再量标题画面要的几步（取设置、经典静态数据、存档列表、世界目录、切到寰宇），然后开一局寰宇新游戏、存一个档；
//! - `--load <槽位>`：冷启动后直接读这个存档（标题画面的“继续”），量读档；
//! - `--sync`：照旧版就地登记世界包、不预先载入（量改前的启动路径，或网页服务端的路径）；
//! - `--detail`：不经应用层，逐个调用数据加载函数，看寰宇的加载花在哪一步。
//!
//! 每一步各自计时；同一进程里后面的步骤会用上前面的进程内缓存（经典静态数据、航线表），
//! 所以“冷”数字要分别起进程来量。存档与设置写在 `--config` 目录（缺省为临时目录下的 manifest-profile）；
//! `--nav-cache` 照桌面版把航线表缓存放到别的目录（缺省照旧在 data 旁的 cache/nav）。

use anyhow::{Context, Result, anyhow};
use manifest_appcore::state::world_registry::WorldRegistry;
use manifest_appcore::{AppPaths, AppState, handlers};
use manifest_data::Locale;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

#[derive(clap::Args)]
pub struct ProfileArgs {
    /// 设置与存档目录（缺省为系统临时目录下的 manifest-profile）
    #[arg(long)]
    config: Option<PathBuf>,
    /// 航线表缓存目录（照桌面版放在用户目录；缺省在 data 旁的 cache/nav）
    #[arg(long)]
    nav_cache: Option<PathBuf>,
    /// 开新局用的世界
    #[arg(long, default_value = "terra16")]
    play: String,
    /// 开新局用的剧本
    #[arg(long, default_value = "noel_1553")]
    scenario: String,
    /// 推荐角色（剧本带主角时）
    #[arg(long, default_value = "noel")]
    protagonist: Option<String>,
    /// 新局存进的槽位
    #[arg(long, default_value = "profile")]
    slot: String,
    /// 冷启动后直接读这个存档
    #[arg(long)]
    load: Option<String>,
    /// 就地登记世界包、不在后台预先载入（旧版的启动路径）
    #[arg(long)]
    sync: bool,
    /// 逐个调用数据加载函数
    #[arg(long)]
    detail: bool,
}

/// 计时表：每步打一行。
struct Timer {
    started: Instant,
}

impl Timer {
    fn new() -> Timer {
        Timer { started: Instant::now() }
    }

    fn time<T>(&mut self, label: &str, f: impl FnOnce() -> T) -> T {
        let t = Instant::now();
        let out = f();
        println!("{label:<44} {:>10.1} ms", t.elapsed().as_secs_f64() * 1000.0);
        out
    }

    fn total(&self, label: &str) {
        println!("{label:<44} {:>10.1} ms", self.started.elapsed().as_secs_f64() * 1000.0);
    }
}

/// JSON 的大小（界面经 IPC 收到的字节数）。
fn json_kb(value: &impl serde::Serialize) -> String {
    serde_json::to_vec(value).map(|v| format!("{:.0} KB", v.len() as f64 / 1024.0)).unwrap_or_default()
}

fn app(timer: &mut Timer, data: &Path, config: &Path, sync: bool) -> Result<AppState> {
    let keys: Arc<dyn manifest_ai::KeyStore> = Arc::new(manifest_ai::MemoryKeyStore::default());
    let paths = AppPaths::in_dir(config);
    let st = if sync {
        timer.time("应用状态 AppState::from_data_dir", || AppState::from_data_dir(data, keys, paths))
    } else {
        timer.time("应用状态（世界包在后台登记）", || {
            AppState::from_data_dir_in_background(data, keys, paths)
        })
    }
    .map_err(|e| anyhow!("{e}"))?;
    if !sync {
        // 照桌面版：开局目录里的世界在后台预先载入
        let worlds = st.worlds().clone();
        let started = Instant::now();
        std::thread::spawn(move || {
            worlds.preload_visible();
            println!("    （后台预先载入开局目录里的世界，用时 {:.1} ms）", started.elapsed().as_secs_f64() * 1000.0);
        });
    }
    Ok(st)
}

pub fn run(data: Option<PathBuf>, args: ProfileArgs) -> Result<()> {
    let mut timer = Timer::new();
    let data = match data {
        Some(d) => d,
        None => timer.time("查找 data/", manifest_data::find_data_dir).context("找不到 data/ 目录")?,
    };
    println!("data/：{}", data.display());
    if let Some(dir) = &args.nav_cache {
        manifest_data::nav_cache::use_user_cache_dir(dir.clone());
    }
    if args.detail {
        return detail(&mut timer, &data, &args.play);
    }
    let config = args.config.clone().unwrap_or_else(|| std::env::temp_dir().join("manifest-profile"));
    std::fs::create_dir_all(&config)?;
    let st = app(&mut timer, &data, &config, args.sync)?;
    timer.time("取设置 get_settings", || handlers::get_settings(&st));
    let statics = timer.time("经典静态数据 static_data", || handlers::static_data(&st));
    println!("  （经典静态数据 {}）", json_kb(&statics));
    let saves = timer.time("存档列表 list_saves", || handlers::list_saves(&st)).map_err(|e| anyhow!("{e}"))?;
    println!("  （{} 个存档）", saves.len());
    timer.total("合计（标题画面出来、菜单可点）");
    if let Some(slot) = &args.load {
        let o = timer.time("读档 load_game", || handlers::load_game(&st, slot)).map_err(|e| anyhow!("{e}"))?;
        println!("  （概览 {}，第 {} 天）", json_kb(&o), o.day);
        let s = timer.time("读档后的静态数据 static_data", || handlers::static_data(&st));
        println!("  （静态数据 {}）", json_kb(&s));
        timer.total("合计（冷启动到读档进游戏）");
        return Ok(());
    }
    let catalog = timer.time("世界目录 world_catalog", || handlers::world_catalog(&st)).map_err(|e| anyhow!("{e}"))?;
    println!("  （{} 个世界，{}）", catalog.worlds.len(), json_kb(&catalog));
    let view = timer
        .time(&format!("切换世界 select_world({})", args.play), || handlers::select_world(&st, args.play.clone()))
        .map_err(|e| anyhow!("{e}"))?;
    println!("  （静态数据 {}）", json_kb(&view));
    timer.total("合计（开局向导可操作）");
    let request = manifest_core::scenario::NewGameRequest {
        world: args.play.clone(),
        scenario: args.scenario.clone(),
        protagonist: args.protagonist.clone(),
        seed: Some(42),
        ..Default::default()
    };
    let o =
        timer.time("开新局 new_world_game", || handlers::new_world_game(&st, request)).map_err(|e| anyhow!("{e}"))?;
    println!("  （概览 {}，第 {} 天）", json_kb(&o), o.day);
    timer.time("开局后的静态数据 static_data", || handlers::static_data(&st));
    let info = timer.time("存档 save_game", || handlers::save_game(&st, &args.slot)).map_err(|e| anyhow!("{e}"))?;
    println!("  （存进 {}，{}）", info.slot, config.join("saves").display());
    timer.time("读档（世界已驻留）load_game", || handlers::load_game(&st, &args.slot)).map_err(|e| anyhow!("{e}"))?;
    timer.total("合计");
    Ok(())
}

/// 逐个调用数据加载函数（不经应用层；航线表与经典静态数据有进程内缓存，见各行说明）。
fn detail(timer: &mut Timer, data: &Path, key: &str) -> Result<()> {
    timer.time("经典：静态数据 load（不经缓存）", || manifest_data::load(data)).map_err(|e| anyhow!("{e}"))?;
    let defs =
        timer.time("经典：静态数据 load_shared", || manifest_data::load_shared(data)).map_err(|e| anyhow!("{e}"))?;
    let ai = timer.time("经典：AI 内容", || manifest_data::load_ai_content(data)).map_err(|e| anyhow!("{e}"))?;
    for locale in Locale::ALL {
        timer.time(&format!("经典：语言包 {}（不经缓存）", locale.code()), || {
            manifest_data::load_locale_lenient(data, locale, &defs, &ai)
        });
    }
    timer
        .time("经典：语言包（经缓存，含哈希）", || manifest_appcore::Locales::load(data))
        .map_err(|e| anyhow!("{e}"))?;
    let plain = timer.time(&format!("{key}：解析（不开读缓存）resolve_world"), || {
        manifest_data::resolve_world(data, key)
    })?;
    println!("  （有效文件 {} 个）", plain.files.len());
    let world = timer.time(&format!("{key}：解析并预读 resolve_world_for_load"), || {
        manifest_data::resolve_world_for_load(data, key)
    })?;
    timer.time(&format!("{key}：TOML 语法检查 validate_syntax"), || world.validate_syntax())?;
    timer.time(&format!("{key}：剧本 scenarios"), || world.scenarios())?;
    timer.time(&format!("{key}：内容哈希 hash"), || world.hash(false))?;
    let defs = timer
        .time(&format!("{key}：静态数据 load_world_resolved"), || manifest_data::load_world_resolved(&world))?;
    timer.time(&format!("{key}：静态数据 load_world（从头，航线表已驻留）"), || {
        manifest_data::load_world(data, key)
    })?;
    let ai = timer.time(&format!("{key}：AI 内容"), || manifest_data::ai_content::load_world_ai_content(&world))?;
    for locale in Locale::ALL {
        timer.time(&format!("{key}：语言包 {}（含校验）", locale.code()), || {
            manifest_data::locale::load_world_locale_lenient(&world, locale, &defs, &ai)
        });
        timer.time(&format!("{key}：语言包 {}（运行时）", locale.code()), || {
            manifest_data::locale::load_world_locale(&world, locale, &defs, &ai)
        });
    }
    for locale in Locale::ALL {
        timer.time(&format!("{key}：目录文字 {}", locale.code()), || world.catalog_text(locale))?;
    }
    let registry =
        timer.time("注册表 WorldRegistry::load", || WorldRegistry::load(data)).map_err(|e| anyhow!("{e}"))?;
    let resources = timer.time(&format!("注册表：载入 {key}"), || registry.get(key)).map_err(|e| anyhow!("{e}"))?;
    let map = timer.time(&format!("{key}：地图资源 map_resource"), || resources.map_resource());
    println!("  （地图资源 {}）", json_kb(map));
    for locale in Locale::ALL {
        let view = timer.time(&format!("{key}：静态视图 {}", locale.code()), || resources.static_view(locale));
        println!("  （{}）", json_kb(view));
    }
    timer.total("合计");
    Ok(())
}
