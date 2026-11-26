//! 世界资源注册表：首次访问时加载，一份资源同时固定内核定义、AI 内容、语言包和静态视图。

use super::Locales;
use crate::{AppError, Msg, views};
use manifest_core::StaticData;
use manifest_data::worlds::{EffectiveWorld, WorldError};
use manifest_data::{AiContent, Locale};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

pub struct WorldResources {
    pub defs: Arc<StaticData>,
    pub content: Arc<AiContent>,
    pub locales: Locales,
    pub modules: Vec<String>,
    pub languages: Vec<String>,
    pub description: String,
    catalog: [manifest_data::worlds::WorldText; 2],
    statics: [OnceLock<views::StaticView>; 3],
    gemini_catalog: OnceLock<manifest_data::worlds::WorldText>,
    source: Option<Arc<EffectiveWorld>>,
    map: OnceLock<views::MapResource>,
    /// 细图层（M01）：第一次要的时候才读盘
    fine: OnceLock<views::MapFineResource>,
    /// 细图层所在的目录（`data/maps/<地图>/fine`）；经典世界与单世界的测试入口没有
    fine_dir: Option<PathBuf>,
    cell_km: u32,
    #[cfg(test)]
    static_builds: [std::sync::atomic::AtomicUsize; 3],
}

impl WorldResources {
    fn new(defs: Arc<StaticData>, content: Arc<AiContent>, locales: Locales) -> Self {
        let catalog = [Locale::ZhCn, Locale::En]
            .map(|locale| manifest_data::worlds::WorldText::fallback(&defs.world_key, &defs.world_name, locale));
        Self {
            defs,
            content,
            locales,
            modules: Vec::new(),
            languages: vec!["zh".into(), "en".into()],
            description: String::new(),
            catalog,
            statics: Default::default(),
            gemini_catalog: OnceLock::new(),
            source: None,
            map: OnceLock::new(),
            fine: OnceLock::new(),
            fine_dir: None,
            cell_km: views::map_view::DEFAULT_CELL_KM,
            #[cfg(test)]
            static_builds: Default::default(),
        }
    }

    pub fn map_resource(&self) -> &views::MapResource {
        self.map.get_or_init(|| views::MapResource::new(&self.defs, self.cell_km))
    }

    /// 细图层（没有时是空的那一份）。
    pub fn map_fine(&self) -> &views::MapFineResource {
        self.fine.get_or_init(|| match &self.fine_dir {
            Some(dir) => {
                views::MapFineResource::load(&self.defs.map_key, dir, self.defs.map.width, self.defs.map.height)
            }
            None => views::MapFineResource::empty(&self.defs.map_key),
        })
    }

    pub fn catalog_text(&self, locale: Locale) -> &manifest_data::worlds::WorldText {
        if locale == Locale::ZhCnGemini {
            return self.gemini_catalog.get_or_init(|| {
                self.source
                    .as_ref()
                    .and_then(|source| source.catalog_text(locale).ok())
                    .unwrap_or_else(|| self.catalog[0].clone())
            });
        }
        &self.catalog[match locale {
            Locale::ZhCn => 0,
            Locale::En => 1,
            Locale::ZhCnGemini => 0,
        }]
    }

    pub fn static_view(&self, locale: Locale) -> &views::StaticView {
        let index = match locale {
            Locale::ZhCn => 0,
            Locale::En => 1,
            Locale::ZhCnGemini => 2,
        };
        self.statics[index].get_or_init(|| {
            #[cfg(test)]
            self.static_builds[index].fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let ctx = self.locales.ctx(locale);
            let mut view = if self.defs.world_key == "classic" {
                views::static_view_in(ctx)
            } else {
                views::static_view_with_map(ctx, self.map_resource().summary())
            };
            view.world.modules = self.modules.clone();
            view.world.languages = self.languages.clone();
            if self.defs.world_key == "classic" && locale == Locale::En {
                view.world.name = self.locales.en.texts.get("app.classic_world").unwrap_or("Classic World").into();
            } else if self.defs.world_key != "classic" {
                view.world.name = self.catalog_text(locale).name.clone();
            }
            view
        })
    }
}

struct Entry {
    key: String,
    map_key: Option<String>,
    resources: OnceLock<Result<Arc<WorldResources>, Msg>>,
    /// 登记时解析好、带读文件缓存的世界（只留开局目录里列出的）：首次加载接着用，不再读第二遍盘，用过即丢
    resolved: Mutex<Option<EffectiveWorld>>,
}

/// 条目在登记完后固定，加载结果只写一次，因此切换后旧引用仍有效、无需复制静态数据。
/// 经典世界是下标 0，随注册表建好；各世界包从下标 1 起。
pub struct WorldRegistry {
    root: Option<PathBuf>,
    initial: Arc<WorldResources>,
    classic: Entry,
    packages: Pending,
}

/// 各世界包的条目与开局目录里列出的世界（不含经典）。
#[derive(Default)]
struct Packages {
    entries: Vec<Entry>,
    visible: Vec<String>,
}

/// 各世界包的登记：就地做完，或在后台线程里做（桌面版，见 [`WorldRegistry::load_in_background`]）。
/// 后台登记完之前，用到世界包的地方（开局目录、选世界、读别的世界的存档、地图）在 [`Pending::get`] 里等。
struct Pending {
    job: Mutex<Option<std::thread::JoinHandle<Packages>>>,
    done: OnceLock<Packages>,
}

impl Pending {
    fn ready(packages: Packages) -> Self {
        Self { job: Mutex::new(None), done: OnceLock::from(packages) }
    }

    fn spawn(root: PathBuf) -> Self {
        let worker = root.clone();
        match std::thread::Builder::new().name("manifest-worlds".into()).spawn(move || register(&worker)) {
            Ok(job) => Self { job: Mutex::new(Some(job)), done: OnceLock::new() },
            // 开不了线程时就地登记
            Err(_) => Self::ready(register(&root)),
        }
    }

    fn get(&self) -> &Packages {
        self.done.get_or_init(|| {
            let job = self.job.lock().ok().and_then(|mut job| job.take());
            job.and_then(|job| job.join().ok()).unwrap_or_else(|| {
                log_unavailable("worlds/", "登记世界包时发生内部错误");
                Packages::default()
            })
        })
    }

    /// 已经登记完、有人取过的结果（不等）。
    fn ready_now(&self) -> Option<&Packages> {
        self.done.get()
    }
}

impl WorldRegistry {
    pub fn single(defs: Arc<StaticData>, content: Arc<AiContent>, locales: Locales) -> Self {
        let key = defs.world_key.clone();
        let initial = Arc::new(WorldResources::new(defs, content, locales));
        let cell = OnceLock::from(Ok(initial.clone()));
        let map_key = Some(initial.defs.map_key.clone());
        Self {
            root: None,
            initial,
            classic: Entry { key, map_key, resources: cell, resolved: Mutex::new(None) },
            packages: Pending::ready(Packages::default()),
        }
    }

    pub fn load(root: &Path) -> Result<Arc<Self>, AppError> {
        // 经典世界的加载与各世界包的登记检查互不相干：分两个线程同时做（2026-11-03 启动提速），结果与先后无关
        let (classic, packages) = std::thread::scope(|scope| {
            let packages = scope.spawn(|| register(root));
            let classic = load_classic(root);
            (classic, packages.join().unwrap_or_else(|e| std::panic::resume_unwind(e)))
        });
        Self::assemble(root, classic?, Pending::ready(packages))
    }

    /// 同 [`WorldRegistry::load`]，但各世界包在后台线程里登记（桌面版）：
    /// 经典世界载好就返回，标题画面不必等寰宇的上千个文件；用到世界包的地方等登记完，结果与就地登记相同。
    pub fn load_in_background(root: &Path) -> Result<Arc<Self>, AppError> {
        let packages = Pending::spawn(root.to_path_buf());
        Self::assemble(root, load_classic(root)?, packages)
    }

    fn assemble(
        root: &Path,
        (defs, content, locales): (Arc<StaticData>, Arc<AiContent>, Locales),
        packages: Pending,
    ) -> Result<Arc<Self>, AppError> {
        let mut registry = Self::single(defs, content, locales);
        registry.packages = packages;
        registry.root = Some(root.to_path_buf());
        Ok(Arc::new(registry))
    }

    /// 经典世界在前，各世界包按 key 排在后面（要等登记完）。
    fn entries(&self) -> impl Iterator<Item = &Entry> {
        std::iter::once(&self.classic).chain(self.packages.get().entries.iter())
    }

    /// 已经载入成功的世界；不触发载入，也不等世界包登记（列存档时只用手上已有的，不为改写剧本名去载入整个世界）。
    pub fn loaded(&self, key: &str) -> Option<&Arc<WorldResources>> {
        let entry = if self.classic.key == key {
            &self.classic
        } else {
            self.packages.ready_now()?.entries.iter().find(|e| e.key == key)?
        };
        entry.resources.get()?.as_ref().ok()
    }

    /// 把开局目录里列出的世界都载入（桌面版启动后在后台调用：标题画面先能操作，
    /// 选世界、开新局、读档时世界多半已经载好）。载入失败的照旧记下错误，与按需载入相同。
    pub fn preload_visible(&self) {
        for key in self.visible() {
            let _ = self.get(&key);
        }
    }

    pub fn visible(&self) -> Vec<String> {
        std::iter::once(&self.classic.key)
            .chain(self.packages.get().visible.iter())
            .filter(|key| {
                self.entries().find(|e| &e.key == *key).is_some_and(|e| !matches!(e.resources.get(), Some(Err(_))))
            })
            .cloned()
            .collect()
    }

    pub fn index(&self, key: &str) -> Result<usize, AppError> {
        if self.classic.key == key {
            return Ok(0);
        }
        self.packages.get().entries.iter().position(|e| e.key == key).map(|i| i + 1).ok_or_else(|| {
            AppError::Invalid(Msg::new("app.unknown_world", format!("未知世界：{key}")).arg("world", key))
        })
    }

    fn entry(&self, index: usize) -> Option<&Entry> {
        match index {
            0 => Some(&self.classic),
            i => self.packages.get().entries.get(i - 1),
        }
    }

    pub fn get(&self, key: &str) -> Result<&Arc<WorldResources>, AppError> {
        let index = self.index(key)?;
        let entry = self.entry(index).ok_or(AppError::Poisoned)?;
        entry
            .resources
            .get_or_init(|| self.load_entry(entry, key).map(Arc::new).map_err(|e| world_error(key, e)))
            .as_ref()
            .map_err(|e| AppError::Invalid(e.clone()))
    }

    /// 地图 key 只在登记世界中查找；未选择世界时也能读公开图层，不切换当前对局。
    pub fn map_resource(&self, key: &str) -> Result<&views::MapResource, AppError> {
        for entry in self.entries() {
            if let Some(Ok(resources)) = entry.resources.get()
                && resources.defs.map_key == key
            {
                return Ok(resources.map_resource());
            }
        }
        for entry in self.entries() {
            if entry.map_key.as_deref() == Some(key)
                && let Ok(resources) = self.get(&entry.key)
            {
                return Ok(resources.map_resource());
            }
        }
        Err(AppError::Data(format!("未知地图：{key}")))
    }

    /// 细图层：与 [`WorldRegistry::map_resource`] 同样只在登记世界中按地图 key 查找，不接受磁盘路径。
    pub fn map_fine(&self, key: &str) -> Result<&views::MapFineResource, AppError> {
        for entry in self.entries() {
            if let Some(Ok(resources)) = entry.resources.get()
                && resources.defs.map_key == key
            {
                return Ok(resources.map_fine());
            }
        }
        for entry in self.entries() {
            if entry.map_key.as_deref() == Some(key)
                && let Ok(resources) = self.get(&entry.key)
            {
                return Ok(resources.map_fine());
            }
        }
        Err(AppError::Data(format!("未知地图：{key}")))
    }

    /// 只查已加载世界；无效公开 hash 不触发昂贵的世界加载，也不能指定磁盘路径。
    /// 前端先取 session/static_data/map_resource，发布该 hash 的世界此时必已驻留。
    pub fn map_by_hash(&self, hash: &str) -> Option<&views::MapResource> {
        self.entries()
            .filter_map(|entry| entry.resources.get()?.as_ref().ok())
            .map(|resources| resources.map_resource())
            .find(|map| map.hash == hash)
    }

    /// current 只在 get 成功后写入；缺省资源也用于旧的单世界构造入口。不等世界包登记
    /// （下标大于 0 只能来自登记完之后的 index）。
    pub(super) fn current(&self, index: usize) -> &Arc<WorldResources> {
        let entry = match index {
            0 => Some(&self.classic),
            i => self.packages.ready_now().and_then(|p| p.entries.get(i - 1)),
        };
        entry.and_then(|e| e.resources.get()).and_then(|r| r.as_ref().ok()).unwrap_or(&self.initial)
    }

    /// 解析、转换、AI 内容与两种语言包都用同一份解析好的世界（同一份读文件缓存），每个文件只读一次盘。
    fn load_entry(&self, entry: &Entry, key: &str) -> Result<WorldResources, WorldError> {
        let root = self.root.as_ref().ok_or_else(|| WorldError::UnknownWorld(key.to_owned()))?;
        let kept = entry.resolved.lock().ok().and_then(|mut world| world.take());
        let world = match kept {
            Some(world) => world,
            None => manifest_data::resolve_world_for_load(root, key)?,
        };
        // 静态数据与 AI 内容互不相干，两种语言包也互不相干：各分两个线程同时做（结果与先后无关）
        let (defs, content) = std::thread::scope(|scope| {
            let content = scope.spawn(|| manifest_data::ai_content::load_world_ai_content(&world));
            let defs = manifest_data::load_world_resolved(&world);
            (defs, content.join().unwrap_or_else(|e| std::panic::resume_unwind(e)))
        });
        let (defs, content) = (defs?, Arc::new(content?));
        // 运行时的语言包：显示内容与宽松加载相同，只是不做只为报告问题的文件级检查（问题由 validate-data 报告）
        let bundle = |locale| Arc::new(manifest_data::locale::load_world_locale(&world, locale, &defs, &content));
        let (zh, en) = std::thread::scope(|scope| {
            let en = scope.spawn(|| bundle(Locale::En));
            (bundle(Locale::ZhCn), en.join().unwrap_or_else(|e| std::panic::resume_unwind(e)))
        });
        let world = Arc::new(world);
        let locale_world = world.clone();
        let locale_defs = defs.clone();
        let locale_content = content.clone();
        let locales = Locales::new(zh, en).with_gemini_loader(move || {
            Arc::new(manifest_data::locale::load_world_locale(
                &locale_world,
                Locale::ZhCnGemini,
                &locale_defs,
                &locale_content,
            ))
        });
        let modules = world
            .manifest
            .modules
            .iter()
            .filter_map(|(key, value)| {
                if value.as_bool() == Some(true) {
                    Some(key.clone())
                } else if key == "navigation" && value.as_str() == Some("manual") {
                    Some("navigation_manual".into())
                } else {
                    None
                }
            })
            .collect();
        let mut resources = WorldResources::new(defs, content, locales);
        resources.cell_km = world.map.as_ref().and_then(|m| m.cell_km).unwrap_or(views::map_view::DEFAULT_CELL_KM);
        // 地图 key 在解析世界时已经校验过（不含路径分隔符）；经典世界的图层在 data/world，没有细图层
        if world.map.is_some() {
            resources.fine_dir = Some(root.join("maps").join(&world.manifest.map).join("fine"));
        }
        resources.modules = modules;
        resources.languages = world.manifest.languages.clone();
        resources.catalog = [world.catalog_text(Locale::ZhCn)?, world.catalog_text(Locale::En)?];
        resources.description = resources.catalog_text(Locale::ZhCn).blurb.clone();
        resources.source = Some(world);
        Ok(resources)
    }
}

/// 经典世界：静态数据、AI 内容与两种语言包。
fn load_classic(root: &Path) -> Result<(Arc<StaticData>, Arc<AiContent>, Locales), AppError> {
    let defs = manifest_data::load_shared(root).map_err(data_error)?;
    let content = Arc::new(manifest_data::load_ai_content(root).map_err(data_error)?);
    let locales = Locales::load(root)?;
    Ok((defs, content, locales))
}

/// 一个世界包的登记结果：解析好的世界（带读文件缓存）与是否列进开局目录。
type Checked = Result<(EffectiveWorld, bool), WorldError>;

/// 严格的 all_world_keys 留给校验工具；运行时逐包检查，坏包不能阻断其他世界。
/// 登记时只查格式（TOML 语法）与剧本，语义检查在首次载入。
fn check_package(root: &Path, key: &str) -> Checked {
    let world = manifest_data::resolve_world_for_load(root, key)?;
    if world.manifest.draft {
        return Err(WorldError::DraftWorld(key.to_owned()));
    }
    world.validate_syntax()?;
    let scenarios = world.scenarios()?;
    let listed = !world.manifest.hidden && !scenarios.is_empty();
    Ok((world, listed))
}

/// 登记各世界包（按 key 排序）。
fn register(root: &Path) -> Packages {
    let mut out = Packages::default();
    for key in package_keys(root) {
        if key == "classic" {
            log_unavailable(&key, "classic 是保留的世界 key");
            continue;
        }
        let (map_key, resources, resolved) = match check_package(root, &key) {
            Ok((world, listed)) => {
                let map = world.manifest.map.clone();
                if listed {
                    out.visible.push(key.clone());
                }
                // 列出的世界多半马上要载入（桌面版启动后就在后台预先载入）：留着解析好的文件，载入时不再读盘
                (Some(map), OnceLock::new(), listed.then_some(world))
            }
            Err(error) => (None, OnceLock::from(Err(world_error(&key, error))), None),
        };
        out.entries.push(Entry { key, map_key, resources, resolved: Mutex::new(resolved) });
    }
    out
}

fn data_error(e: impl std::fmt::Display) -> AppError {
    AppError::Data(e.to_string())
}

fn log_unavailable(key: &str, error: impl std::fmt::Display) {
    eprintln!("[manifest] 世界 {key:?} 不可用：{}", error.to_string().replace(['\r', '\n'], " "));
}

fn world_error(key: &str, error: WorldError) -> Msg {
    if matches!(error, WorldError::DraftWorld(_)) {
        Msg::new("app.world_draft", format!("草稿世界，还不能加载：{key}")).arg("world", key)
    } else {
        log_unavailable(key, error);
        Msg::new("app.world_unavailable", format!("世界包不可用，请检查包内容：{key}")).arg("world", key)
    }
}

fn package_keys(root: &Path) -> Vec<String> {
    let entries = match std::fs::read_dir(root.join("worlds")) {
        Ok(entries) => entries,
        Err(error) => {
            if error.kind() != std::io::ErrorKind::NotFound {
                log_unavailable("worlds/", error);
            }
            return Vec::new();
        }
    };
    let mut keys = Vec::new();
    for entry in entries {
        match entry {
            Ok(entry) if entry.path().is_dir() => keys.push(entry.file_name().to_string_lossy().into_owned()),
            Ok(_) => {}
            Err(error) => log_unavailable("worlds/", error),
        }
    }
    keys.sort();
    keys
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_language_static_view_is_built_once_across_repeated_concurrent_reads() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let registry = WorldRegistry::load(&root).unwrap();
        let resources = registry.get("testbed").unwrap();
        let counts = || resources.static_builds.each_ref().map(|n| n.load(std::sync::atomic::Ordering::SeqCst));
        assert_eq!(counts(), [0, 0, 0]);
        std::thread::scope(|scope| {
            for _ in 0..6 {
                scope.spawn(|| {
                    for locale in Locale::ALL {
                        resources.static_view(locale);
                    }
                });
            }
        });
        assert_eq!(counts(), [1, 1, 1]);
        for locale in Locale::ALL {
            registry.get("testbed").unwrap().static_view(locale);
        }
        assert_eq!(counts(), [1, 1, 1]);
    }
}
