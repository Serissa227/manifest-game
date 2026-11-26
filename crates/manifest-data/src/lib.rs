//! 加载并校验 `data/` 目录中的静态内容，产出内核使用的 [`StaticData`]。
//!
//! 所有问题都会被收集起来一并报告，每条问题指明文件、条目与原因。

pub mod ai_content;
pub mod assets;
#[doc(hidden)]
pub mod bench;
mod convert;
pub mod fine_map;
pub mod locale;
mod raw;
pub mod worlds;
pub use worlds::{
    WorldError, WorldInfo, list_worlds, load_world, load_world_resolved, resolve_world, resolve_world_for_load,
};
pub mod nav_cache;
pub mod story2;
pub use nav_cache::parse_navigation;

pub use ai_content::{
    AiContent, ArchetypeEffect, ComposedArchetype, ComposedTemplate, OfflineTemplates, PromptTemplate, ProposalKind,
    check_against_data, load_ai_content,
};
/// 配方的投入产出分析（Hawkins–Simon 条件与按基准价的对偶价格检查，`validate-data` 的报告用）。
pub use convert::economy::{input_coefficients, need_counts, recipe_value_ratio, spectral_radius};
pub use locale::{
    Locale, LocaleBundle, Missing, coverage, load_locale, load_locale_lenient, load_locale_shared,
    load_locale_shared_lenient, load_texts,
};

use manifest_core::StaticData;
use std::collections::BTreeMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

/// 一条数据问题。
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DataIssue {
    /// 相对 data/ 的文件路径
    pub file: String,
    /// 条目（如 `goods[grain]`），可为空
    pub item: String,
    pub message: String,
}

impl fmt::Display for DataIssue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.item.is_empty() {
            write!(f, "data/{}：{}", self.file, self.message)
        } else {
            write!(f, "data/{}：{}：{}", self.file, self.item, self.message)
        }
    }
}

/// 数据加载失败：包含全部问题。
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub struct DataError {
    pub issues: Vec<DataIssue>,
}

impl fmt::Display for DataError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "data/ 校验失败，共 {} 个问题：", self.issues.len())?;
        for issue in &self.issues {
            writeln!(f, "  - {issue}")?;
        }
        Ok(())
    }
}

/// 加载并校验数据目录。
///
/// 每次都完整读取与校验；其中最耗时的航线表按地图内容在进程内共享（同一张地图只计算一次）。
pub fn load(dir: &Path) -> Result<Arc<StaticData>, DataError> {
    convert::load(dir).map(Arc::new)
}

/// 进程内共享的加载结果：同一目录且内容未变时，直接返回上次加载的静态数据（不再解析与校验）。
/// 应用启动、各测试与命令行都应使用它；内容变化（数据哈希不同）时重新加载。
pub fn load_shared(dir: &Path) -> Result<Arc<StaticData>, DataError> {
    static CACHE: OnceLock<Mutex<BTreeMap<PathBuf, Arc<StaticData>>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(BTreeMap::new()));
    let key = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    let hash = convert::hash_dir(dir);
    // 加载期间持锁：并发的调用方等待同一次加载，而不是各自重复加载
    let mut c = cache.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(defs) = c.get(&key)
        && defs.meta.hash == hash
    {
        return Ok(defs.clone());
    }
    let defs = load(dir)?;
    c.insert(key, defs.clone());
    Ok(defs)
}

/// 查找数据目录：优先环境变量 `MANIFEST_DATA_DIR`；其次可执行文件旁的 `data/`（打包版：`manifest-app.exe` 与 `data/`
/// 放在同一目录，双击时工作目录不一定是这里，2026-11-03）；再从当前目录与可执行文件所在目录向上查找含 `data/goods.toml` 的目录。
pub fn find_data_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok();
    find_data_dir_from(
        std::env::var_os("MANIFEST_DATA_DIR").map(PathBuf::from),
        exe.as_deref().and_then(Path::parent),
        std::env::current_dir().ok().as_deref(),
        Path::new(env!("CARGO_MANIFEST_DIR")),
    )
}

/// [`find_data_dir`] 的查找顺序（各起点由调用方给出，便于测试）。
#[doc(hidden)]
pub fn find_data_dir_from(
    env: Option<PathBuf>,
    exe_dir: Option<&Path>,
    cwd: Option<&Path>,
    crate_dir: &Path,
) -> Option<PathBuf> {
    let is_data = |dir: &Path| dir.join("goods.toml").is_file();
    if let Some(dir) = env.filter(|d| is_data(d)) {
        return Some(dir);
    }
    // 打包版：exe 旁的 data/ 先于当前目录（只看 exe 所在的这一层，不往上找——开发时编译目录的上层可能是别的检出）
    if let Some(dir) = exe_dir.map(|d| d.join("data")).filter(|d| is_data(d)) {
        return Some(dir);
    }
    let starts = cwd.into_iter().chain(exe_dir).chain(std::iter::once(crate_dir));
    starts.flat_map(Path::ancestors).map(|dir| dir.join("data")).find(|candidate| is_data(candidate))
}

/// 查找并加载默认数据目录（进程内共享，见 [`load_shared`]）。
pub fn load_default() -> Result<Arc<StaticData>, DataError> {
    let dir = find_data_dir().ok_or_else(|| DataError {
        issues: vec![DataIssue {
            file: String::new(),
            item: String::new(),
            message: "找不到 data/ 目录（可设置环境变量 MANIFEST_DATA_DIR）".into(),
        }],
    })?;
    load_shared(&dir)
}
