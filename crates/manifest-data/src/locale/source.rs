//! 语言加载使用同一份有效文件清单，不落地临时目录，也不借用别的世界的条目下标。

use crate::worlds::EffectiveWorld;
use std::path::{Path, PathBuf};

#[derive(Clone)]
pub(super) struct Source<'a> {
    path: PathBuf,
    world: Option<&'a EffectiveWorld>,
    common_texts: Option<&'a EffectiveWorld>,
    memory: Option<std::sync::Arc<std::collections::BTreeMap<String, String>>>,
}

impl<'a> Source<'a> {
    pub fn requires_english(&self) -> bool {
        self.world.is_none_or(|world| world.manifest.requires_english())
    }

    pub fn data_overlays(&self, logical: &str) -> Vec<(String, Self)> {
        let locale = self
            .path
            .file_name()
            .and_then(|s| s.to_str())
            .and_then(|dir| super::Locale::ALL.into_iter().find(|locale| locale.dir() == Some(dir)))
            .unwrap_or(super::Locale::En);
        let names =
            self.world.map(|world| world.locale_overlays(logical, locale)).unwrap_or_else(|| vec![logical.to_owned()]);
        names
            .into_iter()
            .map(|name| {
                let source = self.join(&name);
                (name, source)
            })
            .collect()
    }

    pub fn is_world(&self) -> bool {
        self.world.is_some()
    }

    pub fn world_text(&self) -> Option<Result<crate::worlds::WorldText, crate::worlds::WorldError>> {
        self.world.map(|world| world.catalog_text(super::Locale::ZhCn))
    }

    pub fn fragment_translations(&self, files: &[String]) -> std::collections::BTreeMap<String, Result<(), String>> {
        self.world.map(|world| crate::worlds::validate_fragment_translations(world, files)).unwrap_or_default()
    }

    /// 条目分片的原始来源及同路径显示覆盖名；普通整表保持原入口。
    pub fn table_fragments(&self, logical: &str) -> Result<Vec<(String, Self)>, String> {
        let Some(world) = self.world else { return Ok(Vec::new()) };
        let Some(file) = world.files.get(logical).filter(|f| f.mode == crate::worlds::FileMode::Fragments) else {
            return Ok(Vec::new());
        };
        file.sources
            .iter()
            .map(|path| {
                let rel = path.strip_prefix(world.data_root()).map_err(|e| e.to_string())?;
                // 原始来源已经过世界清单的路径校验；继承时仍按所属包的相对文件名覆盖。
                let rel = if let Ok(in_worlds) = rel.strip_prefix("worlds") {
                    in_worlds.components().skip(1).collect::<PathBuf>()
                } else {
                    rel.to_owned()
                };
                Ok((rel.to_string_lossy().replace(std::path::MAIN_SEPARATOR, "/"), Self::directory(path)))
            })
            .collect()
    }

    pub fn directory(path: &Path) -> Self {
        Self { path: path.to_path_buf(), world: None, common_texts: None, memory: None }
    }

    pub fn world(world: &'a EffectiveWorld) -> Self {
        Self { path: PathBuf::new(), world: Some(world), common_texts: None, memory: None }
    }

    pub fn world_with_common_texts(world: &'a EffectiveWorld, common: &'a EffectiveWorld) -> Self {
        Self { path: PathBuf::new(), world: Some(world), common_texts: Some(common), memory: None }
    }

    /// 变体通过字段哈希过滤后，复用英文覆盖器的显示 schema，不落盘。
    pub fn memory(files: std::collections::BTreeMap<String, String>) -> Self {
        Self { path: PathBuf::new(), world: None, common_texts: None, memory: Some(std::sync::Arc::new(files)) }
    }

    pub fn is_memory(&self) -> bool {
        self.memory.is_some()
    }

    pub fn join(&self, path: impl AsRef<Path>) -> Self {
        Self {
            path: self.path.join(path),
            world: self.world,
            common_texts: self.common_texts,
            memory: self.memory.clone(),
        }
    }

    fn logical(&self) -> String {
        self.path.to_string_lossy().replace('\\', "/")
    }

    fn is_common_text(logical: &str) -> bool {
        let file = logical.strip_prefix("locales/").and_then(|p| p.split_once('/')).map_or(logical, |(_, file)| file);
        file == "texts.toml" || file.starts_with("prompts/") || file.starts_with("templates/")
    }

    fn resource_world(&self, logical: &str) -> Option<&'a EffectiveWorld> {
        self.world.map(|world| {
            if !world.contains(logical) && Self::is_common_text(logical) {
                self.common_texts.filter(|common| common.contains(logical)).unwrap_or(world)
            } else {
                world
            }
        })
    }

    pub fn read(&self) -> Result<String, String> {
        if let Some(memory) = &self.memory {
            return memory.get(&self.logical()).cloned().ok_or_else(|| format!("缺少显示投影：{}", self.logical()));
        }
        match self.resource_world(&self.logical()) {
            Some(world) => world.read(&self.logical()).map_err(|e| e.to_string()),
            None => std::fs::read_to_string(&self.path).map_err(|e| e.to_string()),
        }
    }

    pub fn is_file(&self) -> bool {
        if let Some(memory) = &self.memory {
            return memory.contains_key(&self.logical());
        }
        match self.resource_world(&self.logical()) {
            Some(world) => world.contains(&self.logical()),
            None => self.path.is_file(),
        }
    }

    /// 相对当前目录的 TOML 路径，按路径排序；世界分片保留逻辑路径。
    pub fn files(&self) -> Vec<String> {
        if let Some(memory) = &self.memory {
            let prefix = if self.path.as_os_str().is_empty() { String::new() } else { format!("{}/", self.logical()) };
            return memory.keys().filter_map(|p| p.strip_prefix(&prefix).map(str::to_owned)).collect();
        }
        if let Some(world) = self.world {
            let prefix = format!("{}/", self.logical());
            return world
                .files
                .keys()
                .chain(
                    self.common_texts
                        .into_iter()
                        .flat_map(|common| common.files.keys())
                        .filter(|key| Self::is_common_text(key)),
                )
                .filter_map(|p| p.strip_prefix(&prefix))
                .filter(|p| p.ends_with(".toml"))
                .map(str::to_owned)
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .collect();
        }
        fn walk(root: &Path, dir: &Path, out: &mut Vec<String>) {
            let Ok(entries) = std::fs::read_dir(dir) else { return };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    walk(root, &path, out);
                } else if path.extension().is_some_and(|e| e == "toml")
                    && let Ok(rel) = path.strip_prefix(root)
                {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
        let mut files = Vec::new();
        walk(&self.path, &self.path, &mut files);
        files.sort();
        files
    }
}
