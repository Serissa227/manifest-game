//! 有效文件清单、路径边界、设置合并及哈希。

use super::read_cache::{ReadCache, par_map};
use super::{MapManifest, WorldError, WorldManifest, invalid, parse};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

const ROOT_FILES: &[&str] = &[
    "rules.toml",
    "goods.toml",
    "ships.toml",
    "factions.toml",
    "companies.toml",
    "caravans.toml",
    "recipes.toml",
    "futures.toml",
    "events.toml",
    "mates.toml",
    "colony.toml",
    "workshops.toml",
    "effects.toml",
    "captain.toml",
    "texts.toml",
    "navigation.toml",
    "items.toml",
    "offstage.toml",
    "runtime_links.toml",
    "ideas.toml",
    "societies.toml",
    "legend_ships.toml",
    "realms.toml",
    "lineages.toml",
    "creatures.toml",
    "arcana.toml",
];
const MAP_FILES: &[&str] = &[
    "map.txt",
    "regions.toml",
    "relief.txt",
    "biomes.txt",
    "seas.txt",
    "rivers.toml",
    "landmarks.toml",
    "anchors.toml",
];
/// 地图目录下细图层的说明文件（相对地图目录）。
const FINE_MANIFEST: &str = "fine/fine.toml";
const PLACE_FILES: &[&str] = &["ports.toml", "cities.toml", "overseas.toml", "roads.toml", "discoveries.toml"];
const COLLECTIONS: &[&str] = &["scenarios", "stories", "prompts", "templates", "cast", "upbringing", "history"];

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum FileMode {
    Replace,
    DeepMerge,
    Fragments,
}

/// sources 按父到子或显式分片顺序排列；路径是实际来源，逻辑路径见 EffectiveWorld.files 的键。
#[derive(Clone, Debug)]
pub struct EffectiveFile {
    pub sources: Vec<PathBuf>,
    pub mode: FileMode,
}

#[derive(Clone, Debug)]
pub struct EffectiveWorld {
    pub manifest: WorldManifest,
    pub map: Option<MapManifest>,
    pub files: BTreeMap<String, EffectiveFile>,
    root: PathBuf,
    /// 目录型表的显式分片顺序；没有清单时按逻辑路径排序。
    order: BTreeMap<String, Vec<String>>,
    metadata: BTreeMap<String, PathBuf>,
    /// 加载流程里的读文件缓存（见 read_cache.rs）；公开的 resolve_world 不开，照旧每次读盘
    cache: Option<Arc<ReadCache>>,
}

impl EffectiveWorld {
    /// 读一个来源文件的原文（开了缓存时同一文件只读一次盘）。
    pub(crate) fn source_text(&self, path: &Path) -> Result<Arc<str>, WorldError> {
        match &self.cache {
            Some(cache) => cache.text(path),
            None => read_disk(path).map(Arc::from),
        }
    }

    /// 开着读文件缓存时，多线程把全部来源先读进来，并把各张分片表、设置表先合并好
    /// （之后按原顺序逐个读、逐个检查，结果与报错都与不预读时相同，只是不再等磁盘与合并）。
    pub(crate) fn warm(&self) {
        let Some(cache) = &self.cache else { return };
        let paths: Vec<PathBuf> = self
            .files
            .iter()
            .filter(|(key, _)| !key.starts_with("locales/zh-gemini/"))
            .flat_map(|(_, f)| f.sources.iter().cloned())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        cache.prefetch(&paths);
        let merged: Vec<&String> = self
            .files
            .iter()
            .filter(|(k, f)| f.mode != FileMode::Replace && !k.starts_with("locales/zh-gemini/"))
            .map(|(k, _)| k)
            .collect();
        par_map(&merged, |logical| {
            let _ = self.read(logical);
        });
    }

    /// 将逻辑表映射到仍存在的物理英文分片，完整逻辑覆盖优先。
    pub(crate) fn locale_overlays(&self, logical: &str, locale: crate::Locale) -> Vec<String> {
        let Some(dir) = locale.dir() else { return Vec::new() };
        let prefix = format!("locales/{dir}/");
        let direct = format!("{prefix}{logical}");
        if self.contains(&direct) {
            return vec![logical.to_owned()];
        }
        let mut overlays = Vec::new();
        for source in self.files.get(logical).into_iter().flat_map(|file| &file.sources) {
            let Some(english) = self.locale_path(source, locale) else { continue };
            for (name, file) in &self.files {
                if let Some(name) = name.strip_prefix(&prefix)
                    && file.sources.contains(&english)
                    && !overlays.iter().any(|value| value == name)
                {
                    overlays.push(name.to_owned());
                }
            }
        }
        if overlays.is_empty() { vec![logical.to_owned()] } else { overlays }
    }

    pub(super) fn english_path(&self, source: &Path) -> Option<PathBuf> {
        self.locale_path(source, crate::Locale::En)
    }

    pub(crate) fn locale_path(&self, source: &Path, locale: crate::Locale) -> Option<PathBuf> {
        let base = self
            .metadata
            .values()
            .filter(|path| path.file_name().is_some_and(|name| name == "world.toml"))
            .filter_map(|path| path.parent())
            .filter(|base| source.starts_with(base))
            .max_by_key(|base| base.components().count())
            .unwrap_or(&self.root);
        Some(base.join("locales").join(locale.dir()?).join(source.strip_prefix(base).ok()?))
    }

    pub(crate) fn data_root(&self) -> &Path {
        &self.root
    }

    /// 所用地图的细图层说明文件（`maps/<地图>/fine/fine.toml`）：逻辑名与路径；地图没有细图层时为 None。
    pub(crate) fn fine_manifest(&self) -> Option<(&str, &Path)> {
        let key = format!("maps/{}/{FINE_MANIFEST}", self.manifest.map);
        self.metadata.get_key_value(&key).map(|(k, p)| (k.as_str(), p.as_path()))
    }

    pub fn contains(&self, logical: &str) -> bool {
        self.files.contains_key(logical)
    }

    pub fn files_in(&self, directory: &str) -> Vec<String> {
        if let Some(order) = self.order.get(directory) {
            return order.clone();
        }
        let prefix = format!("{directory}/");
        self.files.keys().filter(|k| k.starts_with(&prefix) && k.ends_with(".toml")).cloned().collect()
    }

    pub fn module_enabled(&self, key: &str) -> bool {
        self.manifest.modules.get(key).and_then(toml::Value::as_bool) != Some(false)
    }

    /// 运行时登记前仅检查有效游戏文件的 TOML 语法，不转换定义或构建航线。
    /// 普通翻译文件仍由语言加载器按既有规则回退，世界目录文案在解析世界时单独校验。
    /// 各文件互不相干，分给几个线程一起解析；报的错照旧是按逻辑路径排第一个的那个。
    /// 合并表（设置与分片）读出来时已经逐个解析过各来源，合并后写回的文字一定合法，不再解析第二遍。
    pub fn validate_syntax(&self) -> Result<(), WorldError> {
        let logicals: Vec<(&String, &EffectiveFile)> =
            self.files.iter().filter(|(p, _)| p.ends_with(".toml") && !p.starts_with("locales/")).collect();
        let checked = par_map(&logicals, |(logical, file)| {
            let text = self.read(logical)?;
            if file.mode == FileMode::Replace {
                let _: toml::Value = parse(logical, &text)?;
            }
            Ok(())
        });
        checked.into_iter().collect()
    }

    /// 读取条目原文，或在内存中合并设置 / 分片；替换文件不重新排布 TOML。
    pub fn read(&self, logical: &str) -> Result<String, WorldError> {
        let file = self.files.get(logical).ok_or_else(|| invalid(logical, "缺少有效文件"))?;
        self.merge(logical, file)
    }

    fn merge(&self, logical: &str, file: &EffectiveFile) -> Result<String, WorldError> {
        if file.mode == FileMode::Replace {
            return self.source_text(&file.sources[0]).map(|t| t.to_string());
        }
        let key = (logical.to_owned(), file.sources.clone(), file.mode);
        if let Some(text) = self.cache.as_ref().and_then(|c| c.merged(&key)) {
            return Ok(text.to_string());
        }
        let mut value = toml::Value::Table(toml::Table::new());
        for path in &file.sources {
            let next: toml::Value = parse(&path.display().to_string(), &self.source_text(path)?)?;
            if file.mode == FileMode::Fragments {
                append_fragments(&mut value, next, logical)?;
            } else {
                deep_merge(&mut value, next, logical)?;
            }
        }
        check_duplicate_keys(&value, logical)?;
        let text = toml::to_string(&value).map_err(|e| invalid(logical, e.to_string()))?;
        if let Some(cache) = &self.cache {
            cache.put_merged(key, text.as_str().into());
        }
        Ok(text)
    }

    /// 显示文字不进入模拟哈希；with_display 用于语言缓存。
    /// classic 保留旧版的逻辑路径、换行归一化及字节分隔规则。
    pub fn hash(&self, with_display: bool) -> Result<String, WorldError> {
        let mut h = blake3::Hasher::new();
        for (logical, file) in &self.files {
            if !with_display && display_only(logical) {
                continue;
            }
            if self.manifest.key == "classic" {
                hash_part(&mut h, logical, &self.source_text(&file.sources[0])?);
            } else {
                h.update(logical.as_bytes());
                h.update(&[0]);
                for source in &file.sources {
                    let rel = relative(&self.root, source)?;
                    hash_part(&mut h, &rel, &self.source_text(source)?);
                }
            }
        }
        for (key, path) in &self.metadata {
            // 清单只保留继承链和实际所用地图；其他世界完全不参与。
            hash_part(&mut h, key, &self.source_text(path)?);
        }
        Ok(h.finalize().to_hex().to_string())
    }
}

fn hash_part(h: &mut blake3::Hasher, rel: &str, text: &str) {
    h.update(rel.as_bytes());
    h.update(&[0]);
    h.update(text.replace('\r', "").as_bytes());
    h.update(&[0]);
}

fn display_only(rel: &str) -> bool {
    rel.starts_with("locales/") || rel == "texts.toml"
}

pub(super) fn read_text(path: &Path) -> Result<String, WorldError> {
    read_disk(path)
}

/// 直接读盘（读文件缓存也经过这里）。
pub(super) fn read_disk(path: &Path) -> Result<String, WorldError> {
    std::fs::read_to_string(path).map_err(|source| WorldError::Io { path: path.to_owned(), source })
}

fn relative(root: &Path, path: &Path) -> Result<String, WorldError> {
    path.strip_prefix(root)
        .map(|p| p.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
        .map_err(|_| WorldError::UnsafePath(path.display().to_string()))
}

fn key_valid(key: &str) -> Result<(), WorldError> {
    if key.is_empty() || !key.bytes().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_') {
        return Err(WorldError::UnsafePath(key.to_owned()));
    }
    Ok(())
}

/// 只按字面检查相对路径并接到 base 上（不碰磁盘）：非空，不含反斜杠与冒号，只有普通路径段。
fn lexical(base: &Path, rel: &str) -> Result<PathBuf, WorldError> {
    if rel.is_empty()
        || rel.contains(['\\', ':'])
        || Path::new(rel).components().any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(WorldError::UnsafePath(rel.to_owned()));
    }
    Ok(base.join(rel))
}

fn checked(root: &Path, base: &Path, rel: &str) -> Result<PathBuf, WorldError> {
    let path = lexical(base, rel)?;
    // 同时拦截符号链接 / Windows junction。不存在的叶子仍检查已有父目录。
    let existing = path.ancestors().find(|p| p.exists()).ok_or_else(|| WorldError::UnsafePath(rel.to_owned()))?;
    let canonical = existing.canonicalize().map_err(|source| WorldError::Io { path: existing.to_owned(), source })?;
    if !canonical.starts_with(root) {
        return Err(WorldError::UnsafePath(path.display().to_string()));
    }
    Ok(path)
}

pub(super) fn scan(root: &Path, directory: &Path) -> Result<Vec<PathBuf>, WorldError> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    scan_dir(root, directory, None)
}

/// `canonical`：这个目录的路径是不是规范形式（不知道时为 None，第一次遇到普通子目录时查一次）。
fn scan_dir(root: &Path, directory: &Path, mut canonical: Option<bool>) -> Result<Vec<PathBuf>, WorldError> {
    let entries =
        std::fs::read_dir(directory).map_err(|source| WorldError::Io { path: directory.to_owned(), source })?;
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|source| WorldError::Io { path: directory.to_owned(), source })?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let kind = entry.file_type().map_err(|source| WorldError::Io { path: entry.path(), source })?;
        // 链接（符号链接、Windows junction）逐个核对落点。普通文件与目录不是链接，它所在的目录已核过落在 data 根内，
        // 不必再逐个规范化路径（2026-11-03 启动提速：Windows 上每规范化一次都要打开一次文件，寰宇一千多个文件要好几秒）。
        let link = kind.is_symlink();
        let path = if link { checked(root, directory, &name)? } else { lexical(directory, &name)? };
        let is_dir = if link { path.is_dir() } else { kind.is_dir() };
        // 包中不递归目录链接，避免链接环；普通文件链接只允许落在 data 根内。
        if is_dir {
            // 普通子目录的规范形式就是所在目录的规范形式接上目录名（目录名取自磁盘）：只需看所在目录是不是规范形式
            let same = if link {
                path.canonicalize().ok().as_ref() == Some(&path)
            } else {
                *canonical.get_or_insert_with(|| directory.canonicalize().ok().as_deref() == Some(directory))
            };
            if !same {
                return Err(WorldError::UnsafePath(path.display().to_string()));
            }
            result.extend(scan_dir(root, &path, Some(true))?);
        } else if path.extension().is_some_and(|e| e == "toml") {
            result.push(path);
        }
    }
    result.sort();
    Ok(result)
}

fn setting(logical: &str) -> bool {
    matches!(logical, "rules.toml" | "captain.toml" | "effects.toml" | "texts.toml" | "navigation.toml")
}

fn put(world: &mut EffectiveWorld, logical: String, path: PathBuf) {
    for (directory, order) in &mut world.order {
        if logical.starts_with(&format!("{directory}/")) && !order.contains(&logical) {
            order.push(logical.clone());
        }
    }
    if setting(&logical) {
        let file = world
            .files
            .entry(logical)
            .or_insert_with(|| EffectiveFile { sources: Vec::new(), mode: FileMode::DeepMerge });
        file.mode = FileMode::DeepMerge;
        file.sources.push(path);
    } else {
        world.files.insert(logical, EffectiveFile { sources: vec![path], mode: FileMode::Replace });
    }
}

/// 经典世界的清单，还没有任何文件（不继承的世界包从这里起步，不必先把经典的文件清点一遍）。
fn bare(root: &Path, cache: &Option<Arc<ReadCache>>) -> Result<EffectiveWorld, WorldError> {
    let manifest: WorldManifest = parse("classic", "key = 'classic'\nname = '经典世界'\nmap = 'classic'\n")?;
    Ok(EffectiveWorld {
        manifest,
        map: None,
        files: BTreeMap::new(),
        root: root.to_owned(),
        order: BTreeMap::new(),
        metadata: BTreeMap::new(),
        cache: cache.clone(),
    })
}

/// 一个目录里的条目名与类型：读一次目录，代替逐个文件规范化路径、查是否存在（目录不存在或读不了时为空）。
fn listing(dir: &Path) -> BTreeMap<String, std::fs::FileType> {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| Some((e.file_name().into_string().ok()?, e.file_type().ok()?)))
        .collect()
}

/// 目录清单里这个名字的类型；大小写对不上（Windows 上同一个文件）时为 Err，交给逐个核对的旧写法。
fn entry_kind(list: &BTreeMap<String, std::fs::FileType>, name: &str) -> Result<Option<std::fs::FileType>, ()> {
    match list.get(name) {
        Some(kind) => Ok(Some(*kind)),
        None if list.keys().any(|k| k.eq_ignore_ascii_case(name)) => Err(()),
        None => Ok(None),
    }
}

fn classic(root: &Path, cache: &Option<Arc<ReadCache>>) -> Result<EffectiveWorld, WorldError> {
    let mut world = bare(root, cache)?;
    // 根目录与 world/ 各读一次目录（2026-11-03 启动提速：Windows 上逐个文件规范化路径、查是否存在很慢）。
    // 普通文件所在的目录就在 data 根里，不必再核对落点；链接、大小写对不上的名字、world/ 本身是链接时照旧逐个核对。
    let top = listing(root);
    let world_dir = top.get("world").filter(|k| !k.is_symlink()).map(|_| listing(&root.join("world")));
    for logical in ROOT_FILES
        .iter()
        .map(|s| s.to_string())
        .chain(MAP_FILES.iter().chain(PLACE_FILES).chain(["layout.toml"].iter()).map(|s| format!("world/{s}")))
    {
        let kind = match logical.strip_prefix("world/") {
            Some(name) => world_dir.as_ref().map_or(Err(()), |list| entry_kind(list, name)),
            None => entry_kind(&top, &logical),
        };
        let path = match kind {
            Ok(None) => continue,
            Ok(Some(kind)) if kind.is_file() => lexical(root, &logical)?,
            Ok(Some(kind)) if !kind.is_symlink() => continue,
            _ => {
                let path = checked(root, root, &logical)?;
                if !path.is_file() {
                    continue;
                }
                path
            }
        };
        world.files.insert(logical, EffectiveFile { sources: vec![path], mode: FileMode::Replace });
    }
    let locale_dirs: Vec<_> =
        crate::Locale::ALL.into_iter().filter_map(|l| l.dir()).map(|dir| format!("locales/{dir}")).collect();
    for dir in COLLECTIONS.iter().copied().chain(locale_dirs.iter().map(String::as_str)) {
        let kind = if dir.contains('/') { Err(()) } else { entry_kind(&top, dir) };
        let path = match kind {
            Ok(None) => continue,
            Ok(Some(kind)) if kind.is_dir() && !kind.is_symlink() => lexical(root, dir)?,
            _ => checked(root, root, dir)?,
        };
        for path in scan(root, &path)? {
            let logical = relative(root, &path)?;
            world.files.insert(logical, EffectiveFile { sources: vec![path], mode: FileMode::Replace });
        }
    }
    Ok(world)
}

pub(super) fn resolve(root: &Path, key: &str) -> Result<EffectiveWorld, WorldError> {
    resolve_with(root, key, None)
}

/// 加载流程用：开着读文件缓存解析，再多线程把全部来源读进来、各张合并表先合并好（见 read_cache.rs）。
/// 得到的世界与 [`resolve`] 相同，之后的读取与报错也相同。
pub(super) fn resolve_cached(root: &Path, key: &str) -> Result<EffectiveWorld, WorldError> {
    let world = resolve_with(root, key, Some(Arc::new(ReadCache::default())))?;
    world.warm();
    Ok(world)
}

fn resolve_with(root: &Path, key: &str, cache: Option<Arc<ReadCache>>) -> Result<EffectiveWorld, WorldError> {
    let root = root.canonicalize().map_err(|source| WorldError::Io { path: root.to_owned(), source })?;
    resolve_inner(&root, key, &mut Vec::new(), &cache)
}

fn resolve_inner(
    root: &Path,
    key: &str,
    stack: &mut Vec<String>,
    cache: &Option<Arc<ReadCache>>,
) -> Result<EffectiveWorld, WorldError> {
    key_valid(key)?;
    if stack.iter().any(|k| k == key) {
        stack.push(key.to_owned());
        return Err(WorldError::InheritanceCycle(stack.join(" -> ")));
    }
    if key == "classic" {
        return classic(root, cache);
    }
    stack.push(key.to_owned());
    let base = checked(root, root, &format!("worlds/{key}"))?;
    let path = checked(root, &base, "world.toml")?;
    if !path.is_file() {
        return Err(WorldError::UnknownWorld(key.to_owned()));
    }
    let value: toml::Value = parse(&path.display().to_string(), &read_text(&path)?)?;
    if value.get("key").and_then(toml::Value::as_str) != Some(key) {
        return Err(invalid(path.display().to_string(), "key 必须与世界目录名相同"));
    }
    let parent = value
        .get("inherit")
        .map(|v| v.as_str().ok_or_else(|| invalid("world.toml", "inherit 必须是世界 key")))
        .transpose()?;
    let mut world =
        if let Some(parent) = parent { resolve_inner(root, parent, stack, cache)? } else { bare(root, cache)? };
    if world.manifest.draft && value.get("draft").and_then(toml::Value::as_bool) != Some(true) {
        return Err(WorldError::DraftWorld(world.manifest.key.clone()));
    }
    // 名称与目录简介属于当前包，不能把父世界的标题或英文介绍带进子世界。
    for dir in crate::Locale::ALL.into_iter().filter_map(|l| l.dir()) {
        world.files.remove(&format!("locales/{dir}/world.toml"));
    }
    // 其余元信息继承（包括 scaffold：继承测试脚手架世界的夹具世界仍是脚手架），分片路径不能重定基址。
    let mut merged = toml::Value::try_from(&world.manifest).map_err(|e| invalid("world.toml", e.to_string()))?;
    if let Some(table) = merged.as_table_mut() {
        for key in ["key", "name", "languages", "tagline", "blurb", "hidden", "inherit", "tables", "draft"] {
            table.remove(key);
        }
    }
    deep_merge(&mut merged, value.clone(), "world.toml")?;
    world.manifest = merged.try_into().map_err(|e| invalid("world.toml", format!("{e}")))?;
    if world.manifest.name.trim().is_empty() {
        return Err(invalid("world.toml", "name 不能为空"));
    }
    for (key, v) in &world.manifest.modules {
        if key == "navigation" {
            if !matches!(v.as_str(), Some("route" | "manual")) {
                return Err(invalid("world.toml", "navigation 必须是 route 或 manual"));
            }
        } else if !v.is_bool() {
            return Err(invalid("world.toml", format!("modules.{key} 必须是布尔开关")));
        }
    }
    world.metadata.insert(format!("worlds/{key}/world.toml"), path);
    if world.manifest.draft {
        key_valid(&world.manifest.map)?;
        world.map = None;
        world.metadata.retain(|k, _| !k.starts_with("maps/"));
        for name in MAP_FILES.iter().chain(["layout.toml", "mapgen.toml"].iter()) {
            world.files.remove(&format!("world/{name}"));
        }
        super::draft::validate(root, &base)?;
        let map_path = checked(root, root, &format!("maps/{}/map.toml", world.manifest.map))?;
        if map_path.is_file() {
            load_map(root, &mut world)?;
        }
    } else {
        load_map(root, &mut world)?;
    }
    let scanned = scan(root, &base)?;
    let listed: BTreeSet<String> = world.manifest.tables.values().flatten().cloned().collect();
    for path in &scanned {
        let path = path.clone();
        let rel = relative(&base, &path)?;
        if rel == "world.toml" || listed.contains(&rel) {
            continue;
        }
        let logical = logical_path(&rel);
        // 内容子目录只有引擎消费的集合及语言覆盖自动生效；其他分片须明确列出。
        if !rel.contains('/')
            || COLLECTIONS.iter().any(|d| rel.starts_with(&format!("{d}/")))
            || rel.starts_with("locales/")
        {
            put(&mut world, logical, path);
        }
    }
    let tables = world.manifest.tables.clone();
    // 扫描时已核过的普通文件，不必再逐个规范化路径、查是否存在（同 scan）
    let scanned: BTreeSet<PathBuf> = scanned.into_iter().collect();
    if cache.is_some() {
        warm_fragments(&world, &base, &tables, &scanned);
    }
    for (table, fragments) in tables {
        key_valid(&table)?;
        let logical = logical_path(&format!("{table}.toml"));
        if setting(&logical) {
            return Err(invalid("world.toml", format!("设置文件 {table} 不支持条目分片")));
        }
        let mut sources = Vec::new();
        let mut seen = BTreeSet::new();
        for rel in fragments {
            let near = lexical(&base, &rel)?;
            let known = scanned.contains(&near);
            let path = if known { near } else { checked(root, &base, &rel)? };
            if !seen.insert(path.clone()) {
                return Err(invalid("world.toml", format!("分片重复：{rel}")));
            }
            if !known && !path.is_file() {
                return Err(invalid("world.toml", format!("分片不存在：{rel}")));
            }
            sources.push(path);
        }
        if COLLECTIONS.contains(&table.as_str()) {
            world.files.retain(|k, _| !k.starts_with(&format!("{table}/")));
            let mut order = Vec::new();
            for source in sources {
                let rel = relative(&base, &source)?;
                let name = if rel.starts_with(&format!("{table}/")) { rel } else { format!("{table}/{rel}") };
                world.files.insert(name.clone(), EffectiveFile { sources: vec![source], mode: FileMode::Replace });
                order.push(name);
            }
            world.order.insert(table, order);
        } else {
            let file = EffectiveFile { sources, mode: FileMode::Fragments };
            world.files.insert(logical.clone(), file);
            // 目录集合可用空清单关闭，普通表仍需明确的空数组结构。
            if world.files[&logical].sources.is_empty() {
                return Err(invalid("world.toml", format!("{table} 的分片清单不能为空；清空表请提供含空数组的文件")));
            }
            world.read(&logical)?;
        }
    }
    // 最小经典模块可以显式关闭，避免跨地图继承不相关的人物与故事引用。
    if !world.module_enabled("captain") {
        world.files.remove("captain.toml");
    }
    if !world.module_enabled("stories") {
        world.files.retain(|k, _| !k.starts_with("stories/"));
        world.order.insert("stories".into(), Vec::new());
    }
    world.catalog_text(crate::Locale::En)?;
    stack.pop();
    Ok(world)
}

/// 加载流程里先把各张分片表多线程读好、合并好：只取全部分片都已在扫描中核过的表，
/// 出错的跳过，留给随后按原顺序检查的那一步照旧报（报哪个错、先报哪个都不变）。
fn warm_fragments(
    world: &EffectiveWorld,
    base: &Path,
    tables: &BTreeMap<String, Vec<String>>,
    scanned: &BTreeSet<PathBuf>,
) {
    let Some(cache) = &world.cache else { return };
    let pending: Vec<(String, EffectiveFile)> = tables
        .iter()
        .filter(|(table, _)| key_valid(table).is_ok() && !COLLECTIONS.contains(&table.as_str()))
        .filter_map(|(table, fragments)| {
            let logical = logical_path(&format!("{table}.toml"));
            let sources = fragments.iter().map(|rel| lexical(base, rel)).collect::<Result<Vec<_>, _>>().ok()?;
            let ok = !setting(&logical) && !sources.is_empty() && sources.iter().all(|p| scanned.contains(p));
            ok.then_some((logical, EffectiveFile { sources, mode: FileMode::Fragments }))
        })
        .collect();
    let paths: Vec<PathBuf> = pending.iter().flat_map(|(_, f)| f.sources.iter().cloned()).collect();
    cache.prefetch(&paths);
    par_map(&pending, |(logical, file)| {
        let _ = world.merge(logical, file);
    });
}

fn logical_path(rel: &str) -> String {
    if let Some((dir, rest)) = rel.strip_prefix("locales/").and_then(|p| p.split_once('/')) {
        return format!("locales/{dir}/{}", logical_path(rest));
    }
    if rel == "sites.toml" {
        return "world/overseas.toml".into();
    }
    if PLACE_FILES.contains(&rel) {
        return format!("world/{rel}");
    }
    rel.to_owned()
}

fn load_map(root: &Path, world: &mut EffectiveWorld) -> Result<(), WorldError> {
    let key = &world.manifest.map;
    key_valid(key)?;
    let base = if key == "classic" { root.join("world") } else { checked(root, root, &format!("maps/{key}"))? };
    if !base.is_dir() {
        return Err(WorldError::MissingMap(key.clone()));
    }
    world.metadata.retain(|k, _| !k.starts_with("maps/"));
    for name in MAP_FILES.iter().chain(["layout.toml", "mapgen.toml"].iter()) {
        world.files.remove(&format!("world/{name}"));
    }
    world.map = if key == "classic" {
        None
    } else {
        let path = checked(root, &base, "map.toml")?;
        if !path.is_file() {
            return Err(WorldError::MissingMap(key.clone()));
        }
        let map: MapManifest = parse(&path.display().to_string(), &read_text(&path)?)?;
        if map.key != *key || map.name.trim().is_empty() || map.width == 0 || map.height == 0 || map.cell_km == Some(0)
        {
            return Err(invalid(path.display().to_string(), "地图 key、名称或尺寸无效"));
        }
        world.metadata.insert(format!("maps/{key}/map.toml"), path);
        // 细图层的说明（第九批 M02）：细海岸进了内核的碰撞，说明文件记着 coast.bin 的校验和，
        // 所以它算进模拟哈希；加载时再核对 coast.bin 与这里记的校验和一致（convert/fine_coast.rs）。
        let fine = checked(root, &base, FINE_MANIFEST)?;
        if fine.is_file() {
            world.metadata.insert(format!("maps/{key}/{FINE_MANIFEST}"), fine);
        }
        Some(map)
    };
    for name in MAP_FILES.iter().chain([if key == "classic" { "layout.toml" } else { "mapgen.toml" }].iter()) {
        let path = checked(root, &base, name)?;
        if path.is_file() {
            world.files.insert(format!("world/{name}"), EffectiveFile { sources: vec![path], mode: FileMode::Replace });
        }
    }
    if !world.contains("world/map.txt") || !world.contains("world/regions.toml") {
        return Err(WorldError::MissingMap(key.clone()));
    }
    Ok(())
}

pub(super) fn world_keys(root: &Path) -> Result<Vec<String>, WorldError> {
    let root = root.canonicalize().map_err(|source| WorldError::Io { path: root.to_owned(), source })?;
    let base = checked(&root, &root, "worlds")?;
    if !base.exists() {
        return Ok(Vec::new());
    }
    let entries = std::fs::read_dir(&base).map_err(|source| WorldError::Io { path: base.clone(), source })?;
    let mut seen = BTreeSet::from(["classic".to_owned()]);
    let mut keys = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|source| WorldError::Io { path: base.clone(), source })?;
        if !entry.path().is_dir() {
            continue;
        }
        let key = entry.file_name().to_string_lossy().into_owned();
        key_valid(&key)?;
        let path = checked(&root, &base, &format!("{key}/world.toml"))?;
        let raw: toml::Value = parse(&path.display().to_string(), &read_text(&path)?)?;
        let declared = raw.get("key").and_then(toml::Value::as_str).ok_or_else(|| invalid("world.toml", "缺少 key"))?;
        if !seen.insert(declared.to_owned()) {
            return Err(WorldError::DuplicateKey { file: path.display().to_string(), key: declared.into() });
        }
        keys.push(key);
    }
    keys.sort();
    Ok(keys)
}

/// 本包清单上是不是草稿：draft 只取本包自己的 world.toml，不随继承传下来（见 resolve_inner）。
pub(super) fn declares_draft(root: &Path, key: &str) -> Result<bool, WorldError> {
    let path = checked(root, root, &format!("worlds/{key}/world.toml"))?;
    let raw: toml::Value = parse(&path.display().to_string(), &read_text(&path)?)?;
    Ok(raw.get("draft").and_then(toml::Value::as_bool) == Some(true))
}

/// 开局目录单独过滤隐藏包；全量枚举 world_keys 的含义保持不变。
pub(super) fn catalog_world_keys(root: &Path) -> Result<Vec<String>, WorldError> {
    let mut visible = Vec::new();
    for key in world_keys(root)? {
        let path = root.join("worlds").join(&key).join("world.toml");
        let raw: toml::Value = parse(&path.display().to_string(), &read_text(&path)?)?;
        if raw.get("hidden").and_then(toml::Value::as_bool) != Some(true) {
            visible.push(key);
        }
    }
    Ok(visible)
}

pub(super) fn deep_merge(base: &mut toml::Value, next: toml::Value, file: &str) -> Result<(), WorldError> {
    match (base, next) {
        (toml::Value::Table(base), toml::Value::Table(next)) => {
            for (key, value) in next {
                if let Some(old) = base.get_mut(&key) {
                    deep_merge(old, value, file)?;
                } else {
                    base.insert(key, value);
                }
            }
        }
        (base, next) => {
            if base.type_str() != next.type_str()
                && !((base.is_integer() || base.is_float()) && (next.is_integer() || next.is_float()))
            {
                return Err(invalid(file, "覆盖值与继承值类型不一致"));
            }
            *base = next;
        }
    }
    Ok(())
}

fn append_fragments(base: &mut toml::Value, next: toml::Value, file: &str) -> Result<(), WorldError> {
    match (base, next) {
        (toml::Value::Table(base), toml::Value::Table(next)) => {
            for (key, value) in next {
                if let Some(old) = base.get_mut(&key) {
                    append_fragments(old, value, file)?;
                } else {
                    base.insert(key, value);
                }
            }
        }
        (toml::Value::Array(base), toml::Value::Array(next)) => base.extend(next),
        _ => return Err(invalid(file, "分片重复定义非数组字段")),
    }
    Ok(())
}

fn check_duplicate_keys(value: &toml::Value, file: &str) -> Result<(), WorldError> {
    match value {
        toml::Value::Table(table) => {
            for value in table.values() {
                check_duplicate_keys(value, file)?;
            }
        }
        toml::Value::Array(values) => {
            let mut seen = BTreeSet::new();
            for value in values {
                if let Some(key) = value.get("key").and_then(toml::Value::as_str)
                    && !seen.insert(key)
                {
                    return Err(WorldError::DuplicateKey { file: file.into(), key: key.into() });
                }
                check_duplicate_keys(value, file)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub(super) struct DraftFragment {
    pub table: String,
    pub file: String,
    pub path: PathBuf,
    pub english: PathBuf,
}

impl EffectiveWorld {
    /// 草稿要求所有作者分片显式登记；先检查物理清单，再选取继承后实际生效的来源。
    pub(super) fn draft_fragments(&self) -> Result<Vec<DraftFragment>, WorldError> {
        let mut registered = BTreeMap::new();
        for manifest_path in self.metadata.values().filter(|p| p.file_name().is_some_and(|n| n == "world.toml")) {
            let base = manifest_path.parent().ok_or_else(|| invalid("world.toml", "缺少世界目录"))?;
            let raw: toml::Value = parse(&manifest_path.display().to_string(), &read_text(manifest_path)?)?;
            let tables: BTreeMap<String, Vec<String>> = raw
                .get("tables")
                .cloned()
                .unwrap_or_else(|| toml::Value::Table(toml::Table::new()))
                .try_into()
                .map_err(|e| invalid("world.toml", format!("分片清单格式错误：{e}")))?;
            let mut declared = BTreeSet::new();
            for (table, paths) in tables {
                for rel in paths {
                    let path = checked(&self.root, base, &rel)?;
                    if rel == "world.toml"
                        || rel.starts_with("locales/")
                        || !rel.ends_with(".toml")
                        || !declared.insert(path.clone())
                    {
                        return Err(invalid(
                            manifest_path.display().to_string(),
                            format!("分片重复或不是内容文件：{rel}"),
                        ));
                    }
                    let english = checked(&self.root, base, &format!("locales/en/{rel}"))?;
                    registered.insert(
                        path.clone(),
                        DraftFragment { table: table.clone(), file: relative(&self.root, &path)?, path, english },
                    );
                }
            }
            if raw.get("draft").and_then(toml::Value::as_bool) == Some(true) {
                // 基础配置使用固定文件入口（设置表不能放入 tables 分片），仍纳入严格 schema 与翻译校验。
                for name in super::base_config::FILES {
                    let path = checked(&self.root, base, name)?;
                    if path.is_file() && declared.insert(path.clone()) {
                        registered.insert(
                            path.clone(),
                            DraftFragment {
                                table: "base_config".into(),
                                file: relative(&self.root, &path)?,
                                path,
                                english: checked(&self.root, base, &format!("locales/en/{name}"))?,
                            },
                        );
                    }
                }
                for path in scan(&self.root, base)? {
                    let rel = relative(base, &path)?;
                    if let Some(original) = rel.strip_prefix("locales/en/") {
                        let original = checked(&self.root, base, original)?;
                        if !declared.contains(&original) {
                            return Err(invalid(path.display().to_string(), "英文覆盖没有已登记的原始分片"));
                        }
                    } else if rel != "world.toml"
                        && rel != "navigation.toml"
                        && !rel.starts_with("locales/")
                        && !declared.contains(&path)
                    {
                        return Err(invalid(path.display().to_string(), "草稿内容文件未在 [tables] 登记"));
                    }
                }
            }
        }
        let mut result = Vec::new();
        for (logical, file) in &self.files {
            if logical.starts_with("locales/") {
                continue;
            }
            for path in &file.sources {
                if path.starts_with(self.root.join("maps")) || logical == "navigation.toml" {
                    continue;
                }
                let fragment = registered
                    .remove(path)
                    .ok_or_else(|| invalid(path.display().to_string(), "草稿有效内容没有对应的分片登记"))?;
                result.push(fragment);
            }
        }
        // 同一逻辑路径被后登记的表覆盖，或关闭模块移除了文件时，不能把本包
        // 已登记的内容静默丢掉。继承来源可以由子世界整体替换，不要求再次消费。
        let own_base = self.root.join("worlds").join(&self.manifest.key);
        let unconsumed: Vec<_> = registered.values().filter(|fragment| fragment.path.starts_with(&own_base)).collect();
        if let Some(fragment) = unconsumed.first() {
            return Err(invalid(
                &fragment.file,
                format!(
                    "本世界已登记的分片未被消费：{}；请检查逻辑路径覆盖或模块开关",
                    unconsumed.iter().map(|f| format!("{}（{}）", f.file, f.table)).collect::<Vec<_>>().join("、")
                ),
            ));
        }
        result.sort_by(|a, b| a.file.cmp(&b.file));
        Ok(result)
    }
}
