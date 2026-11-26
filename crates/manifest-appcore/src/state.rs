//! 应用状态：当前游戏、AI 执行器、设置、密钥存储与事件推送。
//!
//! 所有处理函数只依赖 [`AppState`]，不依赖 Tauri，因此可以在测试中直接调用。

#[path = "world_registry.rs"]
pub mod world_registry;
use world_registry::{WorldRegistry, WorldResources};

use crate::settings::AppSettings;
use crate::views::Ctx;
use crate::{AppError, Msg};
use manifest_ai::{AiMode, AiOutcome, AiPipeline, CallGate, HttpProvider, KeyStore, MockLlm, Provider};
use manifest_core::StaticData;
use manifest_core::replay::Source;
use manifest_data::{AiContent, Locale, LocaleBundle};
use manifest_sim::{AiDriver, GameSession};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock};

/// 向前端推送事件（事件名, 负载）。
pub type Emitter = Arc<dyn Fn(&str, serde_json::Value) + Send + Sync>;

/// 网页推送只登记最新需求；桌面没有安装此回调时仍直接推送概览。
pub type OverviewNotifier = Arc<dyn Fn(u64, u64) + Send + Sync>;

/// 各存档槽位最后写入的（游戏代数, 时刻戳）；时刻戳见 [`crate::clock::stamp`]（先比日期、再比当天的时刻）。
pub type SaveLog = std::collections::BTreeMap<String, (u64, u64)>;

/// 后台加载的结果（加载完成前为 None）。
type LoadSlot = Mutex<Option<Result<AppState, String>>>;

/// 文件位置。
#[derive(Clone, Debug)]
pub struct AppPaths {
    pub settings_file: PathBuf,
    pub saves_dir: PathBuf,
}

impl AppPaths {
    pub fn in_dir(dir: &std::path::Path) -> AppPaths {
        AppPaths { settings_file: dir.join("settings.json"), saves_dir: dir.join("saves") }
    }
}

/// 已准备、执行中和已完成待领取的网络任务共享这四个许可。
const MAX_BACKGROUND_TASKS: usize = 4;
/// 等待队列只保存轻量请求，不保存世界摘要或已准备上下文。
const MAX_PENDING_TASKS: usize = 16;
const MAX_BACKGROUND_AGE_DAYS: u32 = 3;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AiQueueStats {
    pub pending: usize,
    pub occupied: usize,
    /// 后台实际进入 prepare 的次数（包含 prepare 返回 None 的请求）。
    pub prepare_calls: usize,
    pub dropped: usize,
    pub expired: usize,
}

struct QueuedAi {
    day: u32,
    request: manifest_ai::TaskRequest,
}

/// 许可随结果保留至领取，暂停游戏也不会积攒无界结果。
struct CompletedAi {
    day: u32,
    outcome: AiOutcome,
    _lease: AiLease,
}

pub(crate) struct AiLease {
    _permit: tokio::sync::OwnedSemaphorePermit,
    cancelled: tokio::sync::watch::Receiver<bool>,
}

impl AiLease {
    pub(crate) fn cancelled(&self) -> bool {
        *self.cancelled.borrow()
    }

    pub(crate) async fn process(
        &mut self,
        pipeline: &AiPipeline,
        task: manifest_ai::pipeline::AiTask,
    ) -> Option<AiOutcome> {
        if self.cancelled() {
            return None;
        }
        tokio::select! {
            biased;
            _ = self.cancelled.changed() => None,
            outcome = pipeline.process(task) => Some(outcome),
        }
    }
}

/// 离线/Mock 保留同步次序；网络任务先准入、后准备，不为排队者创建异步任务。
pub struct AiRunner {
    pub pipeline: Arc<AiPipeline>,
    background: bool,
    permits: Arc<tokio::sync::Semaphore>,
    pending: Mutex<std::collections::VecDeque<QueuedAi>>,
    tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
    cancel: tokio::sync::watch::Sender<bool>,
    tx: std::sync::mpsc::SyncSender<CompletedAi>,
    rx: Receiver<CompletedAi>,
    prepare_calls: AtomicUsize,
    dropped: AtomicUsize,
    expired: AtomicUsize,
}

/// 把命令排到下一个 tick，返回排期的条数。
pub fn schedule_commands(session: &mut GameSession, cmds: Vec<manifest_core::Command>) -> usize {
    let tick = session.day() + 1;
    let n = cmds.len();
    for c in cmds {
        session.schedule(tick, Source::Ai, c);
    }
    n
}

impl AiRunner {
    pub fn new(pipeline: AiPipeline) -> AiRunner {
        let background = pipeline.uses_network();
        let (tx, rx) = std::sync::mpsc::sync_channel(MAX_BACKGROUND_TASKS);
        AiRunner {
            pipeline: Arc::new(pipeline),
            background,
            permits: Arc::new(tokio::sync::Semaphore::new(MAX_BACKGROUND_TASKS)),
            pending: Mutex::new(std::collections::VecDeque::new()),
            tasks: Mutex::new(Vec::new()),
            cancel: tokio::sync::watch::channel(false).0,
            tx,
            rx,
            prepare_calls: AtomicUsize::new(0),
            dropped: AtomicUsize::new(0),
            expired: AtomicUsize::new(0),
        }
    }

    pub fn background(&self) -> bool {
        self.background
    }

    pub fn max_background_tasks() -> usize {
        MAX_BACKGROUND_TASKS
    }
    pub fn max_pending_tasks() -> usize {
        MAX_PENDING_TASKS
    }

    pub fn queue_stats(&self) -> AiQueueStats {
        AiQueueStats {
            pending: self.pending.lock().map(|q| q.len()).unwrap_or_default(),
            occupied: MAX_BACKGROUND_TASKS.saturating_sub(self.permits.available_permits()),
            prepare_calls: self.prepare_calls.load(Ordering::Relaxed),
            dropped: self.dropped.load(Ordering::Relaxed),
            expired: self.expired.load(Ordering::Relaxed),
        }
    }

    fn lease(&self) -> Option<AiLease> {
        self.permits
            .clone()
            .try_acquire_owned()
            .ok()
            .map(|permit| AiLease { _permit: permit, cancelled: self.cancel.subscribe() })
    }

    /// 按需议价/文字也必须在投影与 prepare 前准入；满额立即返回可重试错误，不排大上下文。
    pub(crate) fn foreground(&self, session: &mut GameSession) -> Result<Option<AiLease>, AppError> {
        if !self.background {
            return Ok(None);
        }
        self.drain(session);
        self.lease()
            .map(Some)
            .ok_or_else(|| AppError::Invalid(Msg::new("app.ai_busy", "AI 正在处理别的请求，请稍等片刻再试")))
    }

    fn fresh(day: u32, now: u32) -> bool {
        now.checked_sub(day).is_some_and(|age| age <= MAX_BACKGROUND_AGE_DAYS)
    }

    fn schedule(&self, session: &mut GameSession, outcome: &AiOutcome) -> usize {
        let cmds = self.pipeline.finalize(&session.world, outcome);
        schedule_commands(session, cmds)
    }

    /// 结果仍经过管线 finalize 和内核校验；过期结果只释放许可，不写入命令日志。
    pub fn drain(&self, session: &mut GameSession) -> usize {
        let mut n = 0;
        while let Ok(done) = self.rx.try_recv() {
            if Self::fresh(done.day, session.day()) && !done._lease.cancelled() {
                n += self.schedule(session, &done.outcome);
            } else {
                self.expired.fetch_add(1, Ordering::Relaxed);
            }
        }
        n
    }

    pub fn run_due(&self, session: &mut GameSession, rt: &tokio::runtime::Runtime) -> usize {
        let mut n = self.drain(session);
        if !self.background {
            for req in AiDriver::due_requests(&session.world) {
                let Some(task) = self.pipeline.prepare(&session.world, req) else { continue };
                let outcome = rt.block_on(self.pipeline.process(task));
                n += self.schedule(session, &outcome);
            }
            return n;
        }
        let Ok(mut pending) = self.pending.lock() else { return n };
        let day = session.day();
        pending.retain(|queued| {
            let fresh = Self::fresh(queued.day, day);
            if !fresh {
                self.expired.fetch_add(1, Ordering::Relaxed);
            }
            fresh
        });
        for request in AiDriver::due_requests(&session.world) {
            if pending.len() == MAX_PENDING_TASKS {
                self.dropped.fetch_add(1, Ordering::Relaxed);
            } else {
                pending.push_back(QueuedAi { day, request });
            }
        }
        while !pending.is_empty() {
            let Some(mut lease) = self.lease() else { break };
            let Some(queued) = pending.pop_front() else { break };
            self.prepare_calls.fetch_add(1, Ordering::Relaxed);
            let Some(task) = self.pipeline.prepare(&session.world, queued.request) else { continue };
            let pipeline = self.pipeline.clone();
            let tx = self.tx.clone();
            let handle = rt.spawn(async move {
                if let Some(outcome) = lease.process(&pipeline, task).await {
                    let _ = tx.try_send(CompletedAi { day: queued.day, outcome, _lease: lease });
                }
            });
            if let Ok(mut tasks) = self.tasks.lock() {
                tasks.retain(|task| !task.is_finished());
                tasks.push(handle);
            } else {
                handle.abort();
            }
        }
        n
    }
}

impl Drop for AiRunner {
    /// 换局、读档、重配或关闭 AI：连同已发请求一起取消，不把旧结果带入新执行器。
    fn drop(&mut self) {
        self.permits.close();
        self.cancel.send_replace(true);
        if let Ok(tasks) = self.tasks.get_mut() {
            for task in tasks.drain(..) {
                task.abort();
            }
        }
    }
}

/// 一局游戏。
pub struct Game {
    pub session: GameSession,
    pub ai: Option<AiRunner>,
    /// 当前速度：0 暂停，否则为倍速
    pub speed: u8,
    /// 因为有事要玩家回应（剧情事件、养成的回顾与月末安排、海战、遭遇）而自动暂停时，暂停前的倍速
    /// 玩家回应完、再没有要等的事时按它自动继续。
    /// 玩家自己按暂停、抵港暂停时为空；只在应用层，不存档
    pub resume_speed: Option<u8>,
    /// 玩家最近一次选的倍速（开局与读档时取设置里的默认速度，归到三档）：手动航行的世界里旗舰队在港时间不走，
    /// 出港后按它继续。只在应用层，不存档
    pub run_speed: u8,
    pub last_autosave: u32,
    /// 主角（姓名与外貌）：纯展示，保存在应用层（存档的 meta 文件），不进入世界状态、不影响世界哈希与重放
    pub captain: Option<crate::views::CaptainView>,
    /// 当天时刻（分钟 0–1439，每日结算在 6:00）：与主角一样只在应用层，随存档的 meta 文件保存，不影响世界哈希
    pub minute: u16,
    pub last_navigation_stop: Option<crate::clock::NavigationPause>,
    /// 行情预测簿：只在应用层，随存档的附属文件保存，不影响世界哈希与重放
    pub book: crate::forecast::ForecastBook,
    /// AI 写的按需文字（复盘点评、身世序章）的缓存：键为用途与输入，不存档、不进世界状态（ECONOMY.md 8.6、8.7）
    pub notes: std::collections::BTreeMap<String, String>,
    pub clock_speeds: crate::clock::ClockSpeeds,
    /// 新开放提示的已显示记录；只保存应用层 meta，不进入内核状态。
    pub upbringing_unlock_notices: crate::upbringing_view::UnlockNotices,
}

/// 各语言的显示内容（EXPANSION.md §12）。英文总要载入：中文界面也给专名附上英文写法。
#[derive(Clone)]
pub struct Locales {
    pub zh: Arc<LocaleBundle>,
    pub en: Arc<LocaleBundle>,
    gemini: Arc<OnceLock<Arc<LocaleBundle>>>,
    gemini_loader: Option<Arc<dyn Fn() -> Arc<LocaleBundle> + Send + Sync>>,
}

impl Locales {
    pub fn new(zh: Arc<LocaleBundle>, en: Arc<LocaleBundle>) -> Self {
        Self { zh, en, gemini: Arc::new(OnceLock::new()), gemini_loader: None }
    }

    pub(super) fn with_gemini_loader(mut self, loader: impl Fn() -> Arc<LocaleBundle> + Send + Sync + 'static) -> Self {
        self.gemini_loader = Some(Arc::new(loader));
        self
    }

    /// 从数据目录载入（进程内共享）。宽松：有问题的覆盖跳过并显示中文，游戏照常运行
    /// （原数据改了、译文还没跟上时也能启动）；问题由 `manifest-cli validate-data` 报告。
    pub fn load(data_dir: &std::path::Path) -> Result<Locales, AppError> {
        let get = |l: Locale| {
            manifest_data::load_locale_shared_lenient(data_dir, l)
                .map(|(b, _issues)| b)
                .map_err(|e| AppError::Data(e.to_string()))
        };
        let zh = get(Locale::ZhCn)?;
        let en = get(Locale::En)?;
        let fallback = zh.clone();
        let dir = data_dir.to_path_buf();
        Ok(Locales::new(zh, en).with_gemini_loader(move || {
            manifest_data::load_locale_shared_lenient(&dir, Locale::ZhCnGemini)
                .map(|(bundle, _)| bundle)
                .unwrap_or_else(|_| {
                    let mut bundle = (*fallback).clone();
                    bundle.locale = Locale::ZhCnGemini;
                    Arc::new(bundle)
                })
        }))
    }

    pub fn get(&self, locale: Locale) -> &Arc<LocaleBundle> {
        match locale {
            Locale::ZhCn => &self.zh,
            Locale::En => &self.en,
            Locale::ZhCnGemini => self.gemini.get_or_init(|| {
                if let Some(loader) = &self.gemini_loader {
                    loader()
                } else {
                    let mut bundle = (*self.zh).clone();
                    bundle.locale = Locale::ZhCnGemini;
                    Arc::new(bundle)
                }
            }),
        }
    }

    /// 某语言的视图上下文。
    pub fn ctx(&self, locale: Locale) -> Ctx<'_> {
        Ctx::of(self.get(locale), &self.zh, &self.en)
    }
}

struct Inner {
    ai_budget: Arc<manifest_ai::account_budget::AccountBudget>,
    worlds: Arc<WorldRegistry>,
    current: AtomicUsize,
    transition: Mutex<()>,
    keys: Arc<dyn KeyStore>,
    paths: AppPaths,
    settings: Mutex<AppSettings>,
    game: Mutex<Option<Game>>,
    view_cache: Mutex<crate::view_cache::ViewCache>,
    /// 异步运行时：桌面版每个应用状态一个；网页服务端让所有玩家共用一个
    runtime: Arc<tokio::runtime::Runtime>,
    emitter: OnceLock<Emitter>,
    overview_notifier: OnceLock<OverviewNotifier>,
    /// 真实模型调用的实时闸门（网页服务端按玩家设置；桌面版没有）
    gate: OnceLock<Arc<dyn CallGate>>,
    /// 每次开局或读档加一：锁外等待的操作据此判断游戏是否已经切换
    generation: AtomicU64,
    /// 概览的编号：epoch 在创建时定下，rev 每生成一个概览加一（见 [`AppState::stamp`]）
    epoch: u64,
    rev: AtomicU64,
    /// 存档写盘串行化：各槽位最后写入的（代数, 日期）
    save_io: Mutex<SaveLog>,
    dest_cache: Mutex<crate::navigation_dests::DestCache>,
}

/// 应用状态（可廉价克隆，内部共享）。
#[derive(Clone)]
pub struct AppState(Arc<Inner>);

/// 应用状态的编号：创建时的毫秒时间 × 1000 + 进程内的序号（不超过 2^53，界面里的数字不丢精度；
/// 服务端重启或玩家重新驻留后换了编号，界面就不拿新的 rev 和旧的比）。
fn new_epoch() -> u64 {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let ms =
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
    (ms % 4_000_000_000_000) * 1_000 + SEQ.fetch_add(1, Ordering::Relaxed) % 1_000
}

impl AppState {
    pub fn new(
        defs: Arc<StaticData>,
        content: Arc<AiContent>,
        locales: Locales,
        keys: Arc<dyn KeyStore>,
        paths: AppPaths,
    ) -> Result<AppState, AppError> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|e| AppError::Io(format!("无法创建异步运行时：{e}")))?;
        Ok(AppState::with_runtime(defs, content, locales, keys, paths, Arc::new(runtime)))
    }

    /// 使用给定的异步运行时创建（网页服务端：所有玩家共用一个运行时，不必每人各开线程）。
    pub fn with_runtime(
        defs: Arc<StaticData>,
        content: Arc<AiContent>,
        locales: Locales,
        keys: Arc<dyn KeyStore>,
        paths: AppPaths,
        runtime: Arc<tokio::runtime::Runtime>,
    ) -> AppState {
        Self::with_registry(Arc::new(WorldRegistry::single(defs, content, locales)), keys, paths, runtime)
    }

    /// 桌面与服务端共用的多世界入口；每位玩家只保留当前世界编号。
    pub fn with_registry(
        worlds: Arc<WorldRegistry>,
        keys: Arc<dyn KeyStore>,
        paths: AppPaths,
        runtime: Arc<tokio::runtime::Runtime>,
    ) -> AppState {
        let settings = AppSettings::load(&paths.settings_file);
        let ai_budget = Arc::new(manifest_ai::account_budget::AccountBudget::load_or_blocked(
            paths.settings_file.with_file_name("ai-budget.json"),
        ));
        AppState(Arc::new(Inner {
            ai_budget,
            worlds,
            current: AtomicUsize::new(0),
            transition: Mutex::new(()),
            keys,
            paths,
            settings: Mutex::new(settings),
            game: Mutex::new(None),
            view_cache: Mutex::new(crate::view_cache::ViewCache::default()),
            runtime,
            emitter: OnceLock::new(),
            overview_notifier: OnceLock::new(),
            gate: OnceLock::new(),
            generation: AtomicU64::new(0),
            epoch: new_epoch(),
            rev: AtomicU64::new(0),
            save_io: Mutex::new(SaveLog::new()),
            dest_cache: Mutex::new(crate::navigation_dests::DestCache::default()),
        }))
    }

    /// 从 `data/` 目录加载静态数据与 AI 内容后创建。
    pub fn from_data_dir(
        data_dir: &std::path::Path,
        keys: Arc<dyn KeyStore>,
        paths: AppPaths,
    ) -> Result<AppState, AppError> {
        Self::from_worlds(WorldRegistry::load(data_dir)?, keys, paths)
    }

    /// 桌面版用的 [`AppState::from_data_dir`]（2026-11-03 启动提速）：经典世界载好就返回，各世界包在后台登记
    /// （见 [`WorldRegistry::load_in_background`]），标题画面不必等寰宇的上千个文件。
    pub fn from_data_dir_in_background(
        data_dir: &std::path::Path,
        keys: Arc<dyn KeyStore>,
        paths: AppPaths,
    ) -> Result<AppState, AppError> {
        Self::from_worlds(WorldRegistry::load_in_background(data_dir)?, keys, paths)
    }

    fn from_worlds(worlds: Arc<WorldRegistry>, keys: Arc<dyn KeyStore>, paths: AppPaths) -> Result<AppState, AppError> {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .map_err(|e| AppError::Io(format!("无法创建异步运行时：{e}")))?;
        Ok(Self::with_registry(worlds, keys, paths, Arc::new(runtime)))
    }

    pub fn worlds(&self) -> &Arc<WorldRegistry> {
        &self.0.worlds
    }

    pub fn resources(&self) -> &Arc<WorldResources> {
        self.0.worlds.current(self.0.current.load(Ordering::SeqCst))
    }

    /// 开局、读档和世界选择串行；耗时加载和推演不持有游戏锁。
    pub fn transition(&self) -> Result<MutexGuard<'_, ()>, AppError> {
        self.0.transition.lock().map_err(|_| AppError::Poisoned)
    }

    pub fn select_world(&self, key: &str) -> Result<&Arc<WorldResources>, AppError> {
        let resources = self.worlds().get(key)?;
        let guard = self.game()?;
        if guard.is_none() {
            self.0.current.store(self.worlds().index(key)?, Ordering::SeqCst);
        }
        Ok(resources)
    }

    pub fn defs(&self) -> &Arc<StaticData> {
        &self.resources().defs
    }

    pub fn content(&self) -> &Arc<AiContent> {
        &self.resources().content
    }

    /// 各语言的显示内容。
    pub fn locales(&self) -> &Locales {
        &self.resources().locales
    }

    /// 当前语言（设置未写时为中文）。
    pub fn locale(&self) -> Locale {
        self.settings().locale()
    }

    /// 当前语言的视图上下文。
    pub fn ctx(&self) -> Ctx<'_> {
        let mut ctx = self.resources().locales.ctx(self.locale());
        ctx.model_text = self.settings().ai.mode == AiMode::Live;
        ctx
    }

    /// 把错误按当前语言格式化（中文原样返回；内核只留占位的原因例外，见下）。
    pub fn localize_error(&self, e: AppError) -> AppError {
        let locale = self.locale();
        let b = self.resources().locales.get(locale);
        if let AppError::Command(c) = &e
            && let Some(text) = c.reason().and_then(|r| self.ctx().placeholder_reason(r))
        {
            return AppError::Localized(text);
        }
        if locale.is_chinese() {
            return e;
        }
        let msg = |m: &Msg| -> String {
            if m.key.is_empty() {
                return m.zh.clone();
            }
            match b.texts.get(m.key) {
                Some(t) => {
                    let vars = m.args.iter().map(|(k, v)| (*k, v.clone())).collect();
                    manifest_data::locale::fill(t, &vars)
                }
                // 新存档命名规则的应用层提示；经典世界的数据包保持原字节。
                None if m.key == "app.save_name" => {
                    "Save names cannot be blank or contain control characters or path separators.".into()
                }
                None => m.zh.clone(),
            }
        };
        let text = match &e {
            AppError::NoGame => b.app_text("no_game", &[]),
            AppError::Invalid(m) => Some(msg(m)),
            AppError::Command(c) => b.app_text("command", &[("reason", b.command_error(c))]),
            AppError::Data(d) => b.app_text("data", &[("detail", d.clone())]),
            AppError::Io(d) => b.app_text("io", &[("detail", d.clone())]),
            AppError::Key(d) => b.app_text("key", &[("detail", d.clone())]),
            AppError::Save(m) => b.app_text("save", &[("detail", msg(m))]),
            AppError::Poisoned => b.app_text("poisoned", &[]),
            AppError::Localized(_) => return e,
        };
        AppError::Localized(text.unwrap_or_else(|| e.to_string()))
    }

    pub fn paths(&self) -> &AppPaths {
        &self.0.paths
    }

    pub fn keys(&self) -> &Arc<dyn KeyStore> {
        &self.0.keys
    }

    pub fn runtime(&self) -> &tokio::runtime::Runtime {
        &self.0.runtime
    }

    pub fn settings(&self) -> AppSettings {
        self.0.settings.lock().map(|s| s.clone()).unwrap_or_default()
    }

    pub fn set_settings(&self, settings: AppSettings) -> Result<(), AppError> {
        settings.save(&self.0.paths.settings_file)?;
        *self.0.settings.lock().map_err(|_| AppError::Poisoned)? = settings;
        Ok(())
    }

    pub fn game(&self) -> Result<MutexGuard<'_, Option<Game>>, AppError> {
        self.0.game.lock().map_err(|_| AppError::Poisoned)
    }

    /// 缓存锁始终在游戏锁内取得，构建闭包不得反向取得游戏锁。
    pub(crate) fn cached_view(
        &self,
        key: crate::view_cache::ViewKey,
        build: impl FnOnce() -> Result<serde_json::Value, AppError>,
    ) -> Result<serde_json::Value, AppError> {
        self.0.view_cache.lock().map_err(|_| AppError::Poisoned)?.query(key, build)
    }

    pub fn view_cache_stats(&self) -> Result<crate::view_cache::CacheStats, AppError> {
        Ok(self.0.view_cache.lock().map_err(|_| AppError::Poisoned)?.stats())
    }

    /// 存档写盘锁（不与游戏锁嵌套：持有它时不会再去拿游戏锁）。
    pub fn save_io(&self) -> Result<MutexGuard<'_, SaveLog>, AppError> {
        self.0.save_io.lock().map_err(|_| AppError::Poisoned)
    }

    /// 当前游戏的代数（开局、读档时加一）。
    pub fn generation(&self) -> u64 {
        self.0.generation.load(Ordering::SeqCst)
    }

    /// 给一个新生成的概览编号：(epoch, rev)。在游戏锁内调用，rev 的先后就是状态的先后；
    /// 界面丢掉同一个 epoch 里 rev 不比手上新的概览（网页版 WebSocket 上迟到的推送、晚到的请求结果）。
    pub fn stamp(&self) -> (u64, u64) {
        (self.0.epoch, self.0.rev.fetch_add(1, Ordering::SeqCst) + 1)
    }

    /// 换上新的一局游戏。
    pub fn replace_game(&self, game: Game) -> Result<(), AppError> {
        self.replace_game_with(game, |_| ())
    }

    /// 资源、游戏与概览编号在同一个游戏锁内交接；失败的加载不改变原局。
    pub fn replace_game_with<T>(&self, game: Game, view: impl FnOnce(&Game) -> T) -> Result<T, AppError> {
        let key = &game.session.world.defs.world_key;
        self.worlds().get(key)?;
        let index = self.worlds().index(key)?;
        let mut guard = self.game()?;
        if let Some(old) = guard.as_ref() {
            self.collect_ending(&old.session.world)?;
        }
        self.collect_ending(&game.session.world)?;
        self.0.view_cache.lock().map_err(|_| AppError::Poisoned)?.clear();
        self.0.dest_cache.lock().map_err(|_| AppError::Poisoned)?.clear();
        self.0.generation.fetch_add(1, Ordering::SeqCst);
        self.0.current.store(index, Ordering::SeqCst);
        self.defer_overview();
        let result = view(&game);
        *guard = Some(game);
        Ok(result)
    }

    /// 设置事件推送（应用启动时调用一次）。
    pub fn set_emitter(&self, emitter: Emitter) {
        let _ = self.0.emitter.set(emitter);
    }

    pub fn set_overview_notifier(&self, notifier: OverviewNotifier) {
        let _ = self.0.overview_notifier.set(notifier);
    }

    /// 命令返回的完整概览在游戏锁内交给网页缓存，避免锁外广播与按需读取相互倒序。
    pub(crate) fn publish_overview(&self, overview: &crate::views::Overview) {
        if self.0.overview_notifier.get().is_some() {
            self.emit("tick", serde_json::to_value(overview).unwrap_or_default());
        }
    }

    /// 在游戏锁内调用，通知的编号与命令返回的概览使用同一单调序列。
    pub fn defer_overview(&self) -> bool {
        if let Some(notify) = self.0.overview_notifier.get() {
            let (_, rev) = self.stamp();
            notify(self.generation(), rev);
            true
        } else {
            false
        }
    }

    pub fn emit(&self, event: &str, payload: serde_json::Value) {
        if let Some(e) = self.0.emitter.get() {
            e(event, payload);
        }
    }

    /// 设置真实模型调用的实时闸门（创建后调用一次；之后新建的 AI 执行器都经过它）。
    pub fn set_call_gate(&self, gate: Arc<dyn CallGate>) {
        let _ = self.0.gate.set(gate);
    }

    /// 按当前设置创建 AI 执行器。真实提供商缺少密钥时仍创建管线，由它自动使用离线模板。
    pub fn build_ai(&self) -> Result<Option<AiRunner>, AppError> {
        self.build_ai_for(self.resources())
    }

    pub fn build_ai_for(&self, resources: &WorldResources) -> Result<Option<AiRunner>, AppError> {
        let prefs = self.settings().ai;
        let settings = prefs.to_settings();
        let provider = match prefs.mode {
            AiMode::Off => return Ok(None),
            AiMode::Offline => None,
            AiMode::Mock => Some(Provider::Mock(MockLlm::plausible())),
            AiMode::Live => {
                let key = self.0.keys.get(prefs.key_account()).map_err(|e| AppError::Key(e.to_string()))?;
                match key {
                    Some(k) if !k.is_empty() => {
                        let _guard = self.0.runtime.enter();
                        HttpProvider::new(prefs.provider_config(), k).ok().map(Provider::Http)
                    }
                    _ => None,
                }
            }
        };
        let pipeline = {
            // Jev 客户端需要在运行时上下文中创建
            let _guard = self.0.runtime.enter();
            // 提示词按界面语言（EXPANSION.md §12.1）；离线备选仍用中文模板，世界状态与语言无关
            AiPipeline::new(resources.content.clone(), &settings, provider)
                .with_locale(resources.locales.zh.clone(), resources.locales.get(self.locale()).clone())
                .with_account_budget(self.0.ai_budget.clone())
        };
        let pipeline = match self.0.gate.get() {
            Some(gate) => pipeline.with_call_gate(gate.clone()),
            None => pipeline,
        };
        Ok(Some(AiRunner::new(pipeline)))
    }
}

/// 应用状态的占位：启动时在后台线程加载 data/（含航线表预计算），窗口不必等待；
/// 加载完成前到达的界面请求在这里等待，加载失败时返回原因。
#[derive(Clone, Default)]
pub struct AppHolder(Arc<(LoadSlot, Condvar)>);

impl AppHolder {
    pub fn set(&self, result: Result<AppState, String>) {
        let (lock, cv) = &*self.0;
        if let Ok(mut slot) = lock.lock() {
            *slot = Some(result);
        }
        cv.notify_all();
    }

    /// 等待加载完成。
    pub fn get(&self) -> Result<AppState, AppError> {
        let (lock, cv) = &*self.0;
        let mut slot = lock.lock().map_err(|_| AppError::Poisoned)?;
        while slot.is_none() {
            slot = cv.wait(slot).map_err(|_| AppError::Poisoned)?;
        }
        match slot.as_ref() {
            Some(Ok(st)) => Ok(st.clone()),
            Some(Err(e)) => Err(AppError::Data(e.clone())),
            None => Err(AppError::Poisoned),
        }
    }
}

#[cfg(test)]
#[path = "state_ai_queue_tests.rs"]
mod ai_queue_tests;

impl AppState {
    pub(crate) fn cached_dests(
        &self,
        key: crate::navigation_dests::DestKey,
        build: impl FnOnce(&str) -> serde_json::Value,
    ) -> Result<serde_json::Value, AppError> {
        Ok(self.0.dest_cache.lock().map_err(|_| AppError::Poisoned)?.query(key, build))
    }
}
