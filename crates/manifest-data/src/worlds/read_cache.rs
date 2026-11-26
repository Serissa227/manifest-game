//! 一次世界加载里的读文件缓存（2026-11-03 启动提速）：同一个文件只从磁盘读一次，同一张合并表只合并一次。
//!
//! 登记、语法检查、转换、AI 内容与语言包都要读同一批文件；寰宇一千多个文件，Windows 上每打开一次文件都慢，
//! 每读一遍就是好几秒。只在加载流程里开（[`super::resolve_world_for_load`] 与 `load_world`），公开的
//! [`super::resolve_world`] 照旧每次读盘——测试会改写文件后再读同一个世界对象。缓存随世界对象释放，不跨加载、不落盘；
//! 读到的内容与不开缓存时逐字节相同，只是少读几遍。

use super::{FileMode, WorldError};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

/// 合并表的缓存键：逻辑路径、来源与合并方式都在键里，世界对象的文件清单改了就自然不命中。
type MergedKey = (String, Vec<PathBuf>, FileMode);

#[derive(Default)]
pub(crate) struct ReadCache {
    texts: Mutex<BTreeMap<PathBuf, Arc<str>>>,
    merged: Mutex<BTreeMap<MergedKey, Arc<str>>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl ReadCache {
    /// 原文：缓存里有就用，没有就读盘再记下（读失败不记，下次照旧报同样的错）。
    pub(crate) fn text(&self, path: &Path) -> Result<Arc<str>, WorldError> {
        if let Some(text) = lock(&self.texts).get(path) {
            return Ok(text.clone());
        }
        let text: Arc<str> = super::files::read_disk(path)?.into();
        lock(&self.texts).insert(path.to_owned(), text.clone());
        Ok(text)
    }

    pub(crate) fn merged(&self, key: &MergedKey) -> Option<Arc<str>> {
        lock(&self.merged).get(key).cloned()
    }

    pub(crate) fn put_merged(&self, key: MergedKey, text: Arc<str>) {
        lock(&self.merged).insert(key, text);
    }

    /// 多线程把这些文件先读进缓存（读失败的跳过，留给按顺序读的那一步照旧报错）。
    pub(crate) fn prefetch(&self, paths: &[PathBuf]) {
        let missing: Vec<&PathBuf> = {
            let texts = lock(&self.texts);
            paths.iter().filter(|p| !texts.contains_key(*p)).collect()
        };
        let read = par_map(&missing, |path| super::files::read_disk(path).ok().map(|t| ((*path).clone(), t)));
        let mut texts = lock(&self.texts);
        for (path, text) in read.into_iter().flatten() {
            texts.entry(path).or_insert_with(|| text.into());
        }
    }
}

impl std::fmt::Debug for ReadCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ReadCache")
            .field("texts", &lock(&self.texts).len())
            .field("merged", &lock(&self.merged).len())
            .finish()
    }
}

/// 把 `items` 分给几个线程各自算，结果按原顺序排好（与单线程逐个算的结果、顺序都相同）。
pub(crate) fn par_map<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(1, 8);
    if items.len() < 2 || threads == 1 {
        return items.iter().map(f).collect();
    }
    let chunk = items.len().div_ceil(threads);
    std::thread::scope(|scope| {
        let f = &f;
        let handles: Vec<_> =
            items.chunks(chunk).map(|part| scope.spawn(move || part.iter().map(f).collect::<Vec<_>>())).collect();
        handles
            .into_iter()
            .flat_map(|h| match h.join() {
                Ok(rows) => rows,
                Err(e) => std::panic::resume_unwind(e),
            })
            .collect()
    })
}
