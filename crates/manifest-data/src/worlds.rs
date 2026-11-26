//! 世界包解析：先固定有效文件及来源，再交给既有转换器；不建立临时数据目录。

mod base_config;
pub(crate) mod c12;
mod cast;
mod catalog;
mod draft;
mod files;
mod history;
mod languages;
mod read_cache;
mod scenario;
mod translations;

pub use crate::convert::map_package::{LoadedMap, MapAnchor};
pub use catalog::WorldText;
pub use draft::{all_content_files as author_content_files, content_files as draft_content_files};
pub(crate) use draft::{author_files, content_files_with_languages};
pub use files::{EffectiveFile, EffectiveWorld, FileMode};
pub(crate) use read_cache::par_map;
pub use scenario::{ScenarioCustom, ScenarioInfo};

use crate::{DataError, StaticData};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// 世界包的结构性错误；条目语义错误继续由既有 DataError 汇总。
#[derive(Debug, thiserror::Error)]
pub enum WorldError {
    #[error("未知世界：{0}")]
    UnknownWorld(String),
    #[error("世界继承循环：{0}")]
    InheritanceCycle(String),
    #[error("缺少地图包：{0}")]
    MissingMap(String),
    #[error("路径越界或无效：{0}")]
    UnsafePath(String),
    #[error("{file}：key 重复：{key}")]
    DuplicateKey { file: String, key: String },
    #[error("无法读取 {path}：{source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("{file}：{message}")]
    Invalid { file: String, message: String },
    #[error(transparent)]
    Data(#[from] DataError),
    #[error("草稿世界，还不能加载：{0}")]
    DraftWorld(String),
}

fn invalid(file: impl Into<String>, message: impl Into<String>) -> WorldError {
    WorldError::Invalid { file: file.into(), message: message.into() }
}

fn parse<T: serde::de::DeserializeOwned>(file: &str, text: &str) -> Result<T, WorldError> {
    toml::from_str(text).map_err(|e| invalid(file, format!("TOML 格式错误：{e}")))
}

/// 世界元信息；设置按继承链深合并，数组整块替换。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorldManifest {
    pub key: String,
    pub name: String,
    /// 本包支持的语言；省略时保持中英双语，不继承父包的语言声明。
    #[serde(default = "languages::default", deserialize_with = "languages::deserialize")]
    pub languages: Vec<String>,
    /// 开局目录面向玩家的一句话简介与详细介绍；不借用作者 lore。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tagline: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blurb: Option<String>,
    pub map: String,
    #[serde(default)]
    pub inherit: Option<String>,
    #[serde(default)]
    pub hidden: bool,
    /// 测试脚手架：剧情线与旗标由测试代码直接开、直接设，不做 U03 的可达检查。
    /// 与 hidden 不同，它照常继承：继承脚手架世界的测试夹具世界即使写了 hidden = false 也仍是脚手架。
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub scaffold: bool,
    #[serde(default)]
    pub calendar: manifest_core::calendar::Calendar,
    #[serde(default)]
    pub money: MoneyConfig,
    #[serde(default)]
    pub lore: LoreConfig,
    /// bool 开关以及 navigation = "route" / "manual"。
    #[serde(default)]
    pub modules: BTreeMap<String, toml::Value>,
    #[serde(default, skip_serializing_if = "manifest_core::navigation::NavigationRules::is_default")]
    pub navigation: manifest_core::navigation::NavigationRules,
    #[serde(default)]
    pub art: ArtConfig,
    /// 分片相对声明它的世界包，不相对继承它的子世界。
    #[serde(default)]
    pub tables: BTreeMap<String, Vec<String>>,
    /// 草稿允许尚无地图，仅检查已提交的分片，不能进入游戏。
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub draft: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MoneyConfig {
    pub currency: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct LoreConfig {
    pub summary: String,
    pub terms: String,
    pub taboos: String,
    pub sourcing: Sourcing,
    pub allow_original: Vec<String>,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Sourcing {
    #[default]
    Free,
    Strict,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ArtConfig {
    pub styles: Vec<String>,
}

/// 地图描述；环绕与投影在 E01 只解析保存，寻路接入属于后续包。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MapManifest {
    pub key: String,
    pub name: String,
    pub width: u16,
    pub height: u16,
    #[serde(default)]
    pub wrap_x: bool,
    pub projection: Option<String>,
    pub cell_km: Option<u32>,
}

/// 开局目录的世界项（隐藏世界被 list_worlds 排除，但仍可显式解析、加载）。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorldInfo {
    pub key: String,
    pub name: String,
    #[serde(default = "languages::default")]
    pub languages: Vec<String>,
    pub map_key: String,
    pub playable: bool,
    pub modules: BTreeMap<String, toml::Value>,
    pub scenarios: Vec<ScenarioInfo>,
}

/// 列举可显示的世界，classic 在最前，其余按 key 排序；不构建航线表。
pub fn list_worlds(root: &Path) -> Result<Vec<WorldInfo>, WorldError> {
    let mut keys = vec!["classic".to_owned()];
    keys.extend(files::catalog_world_keys(root)?);
    let mut result = Vec::new();
    for key in keys {
        let world = resolve_world(root, &key)?;
        if !world.manifest.hidden && !world.manifest.draft {
            let scenarios = world.scenarios()?;
            result.push(WorldInfo {
                key: world.manifest.key.clone(),
                name: world.manifest.name.clone(),
                languages: world.manifest.languages.clone(),
                map_key: world.manifest.map.clone(),
                playable: !scenarios.is_empty(),
                modules: world.manifest.modules.clone(),
                scenarios,
            });
        }
    }
    Ok(result)
}

/// 全部世界的 key（含隐藏世界和缺资源草稿），用于全量校验；不会预先加载地图。
pub fn all_world_keys(root: &Path) -> Result<Vec<String>, WorldError> {
    let mut keys = vec!["classic".to_owned()];
    keys.extend(files::world_keys(root)?);
    Ok(keys)
}

/// B2 全量校验入口；与 all_world_keys 一致，包含隐藏世界和草稿。
pub fn validation_world_keys(root: &Path) -> Result<Vec<String>, WorldError> {
    all_world_keys(root)
}

/// 加载一个世界；classic 与 load 使用完全相同的路径。
pub fn load_world(root: &Path, key: &str) -> Result<Arc<StaticData>, WorldError> {
    load_world_resolved(&resolve_world_for_load(root, key)?)
}

/// 同 [`load_world`]，用已经解析好的世界：加载流程里接着用同一份读文件缓存加载 AI 内容与语言包，不再读第二遍盘。
pub fn load_world_resolved(world: &EffectiveWorld) -> Result<Arc<StaticData>, WorldError> {
    let key = &world.manifest.key;
    if world.manifest.draft {
        // 草稿仍不进入可开局目录；显式加载仅在地图和必需基础配置齐备时进行完整严格转换。
        if world.map.is_none()
            || ["rules.toml", "captain.toml", "caravans.toml", "futures.toml", "events.toml", "mates.toml"]
                .iter()
                .any(|file| !world.contains(file))
        {
            return Err(WorldError::DraftWorld(key.to_owned()));
        }
        draft_checks::validate(world, &mut None)?;
    }
    crate::convert::load_effective(world).map(Arc::new).map_err(WorldError::from)
}

/// 解析继承、地图、分片与来源，可供后续语言包、AI 与运行时资源注册表复用。
pub fn resolve_world(root: &Path, key: &str) -> Result<EffectiveWorld, WorldError> {
    files::resolve(root, key)
}

/// 加载流程用的 [`resolve_world`]（2026-11-03 启动提速）：开着读文件缓存（同一个文件只读一次盘、同一张合并表只合并一次），
/// 并多线程预读全部来源。得到的世界、之后读到的内容与报错都与 resolve_world 相同；
/// 只在一次加载里用、用完即弃——缓存不察觉之后的文件改动。
pub fn resolve_world_for_load(root: &Path, key: &str) -> Result<EffectiveWorld, WorldError> {
    files::resolve_cached(root, key)
}

/// 严格加载完整地图、锚地与导航资源，允许草稿；不绕过 load_world 的开局门禁。
pub fn load_map_package(root: &Path, key: &str) -> Result<LoadedMap, WorldError> {
    crate::convert::map_package::load(&resolve_world(root, key)?).map_err(WorldError::from)
}

/// 校验一份草稿分片的完整英文覆盖，返回实际显示字符串数。
/// 作者注释和引用键不属于显示字段；译文不能添加字段、条目或改写数值。
pub fn validate_draft_translation(file: &str, source: &str, english: &str) -> Result<usize, WorldError> {
    draft_translation(file, source, english, &mut None)
}

fn draft_translation(
    file: &str,
    source: &str,
    english: &str,
    missing: &mut Option<usize>,
) -> Result<usize, WorldError> {
    let mut source: toml::Value = parse(file, source)?;
    // 学院一文件一条；英文仍按 academies.<key> 覆盖。
    if source.get("key").is_some() && source.get("curriculum").is_some() {
        source = toml::Value::Table(toml::Table::from_iter([("academies".into(), toml::Value::Array(vec![source]))]));
    }
    let english: toml::Value = parse(&format!("locales/en/{file}"), english)?;
    if file.starts_with("history/") || file.contains("/history/") {
        let text = toml::to_string(&source).map_err(|e| invalid(file, e.to_string()))?;
        let expected = crate::locale::native_history_display(file, &text).map_err(|e| invalid(file, e))?;
        return compare_draft_display(&toml::Value::Table(expected), &english, file, "", missing);
    }
    if file.rsplit('/').next() == Some("ideas.toml") {
        let text = toml::to_string(&source).map_err(|e| invalid(file, e.to_string()))?;
        let expected = crate::locale::native_ideas_display(&text).map_err(|e| invalid(file, e))?;
        return compare_draft_display(&toml::Value::Table(expected), &english, file, "", missing);
    }
    if (file.starts_with("upbringing/") || file.contains("/upbringing/")) && source.get("format_version").is_some() {
        let text = toml::to_string(&source).map_err(|e| invalid(file, e.to_string()))?;
        let mut expected = crate::locale::native_upbringing_display(file, &text).map_err(|e| invalid(file, e))?;
        let mut english = english;
        fold_nested_chapters(&mut expected, &mut english);
        return compare_draft_display(&toml::Value::Table(expected), &english, file, "", missing);
    }
    if let Some(expected) = c12::display(&source) {
        return compare_draft_display(&toml::Value::Table(expected), &english, file, "", missing);
    }
    let mut expected = draft_display(&source, file, false)?;
    if let Some(goods) = source.get("goods").and_then(toml::Value::as_array) {
        let categories: toml::Table = goods
            .iter()
            .filter_map(|row| row.get("category"))
            .filter_map(toml::Value::as_str)
            .map(|name| (name.to_owned(), toml::Value::String(name.to_owned())))
            .collect();
        if !categories.is_empty() {
            expected.insert("categories".into(), toml::Value::Table(categories));
        }
    }
    compare_draft_display(&toml::Value::Table(expected), &english, file, "", missing)
}

/// 仅中文世界允许已有故事覆盖缺少整章；已翻译章节仍逐字段严格检查。
/// 整份章节表缺失、未知章节、空文案和玩法字段覆盖仍由完整检查拒绝。
pub fn validate_story_translation_for_world(
    manifest: &WorldManifest,
    file: &str,
    source: &str,
    english: &str,
) -> Result<usize, WorldError> {
    story_translation(manifest, file, source, english, &mut None)
}

fn story_translation(
    manifest: &WorldManifest,
    file: &str,
    source: &str,
    english: &str,
    missing: &mut Option<usize>,
) -> Result<usize, WorldError> {
    let normalized = file.replace('\\', "/");
    let mut components = normalized.rsplit('/');
    let name = components.next().unwrap_or("").trim_end_matches(".toml");
    if matches!(components.next(), Some("prompts" | "templates"))
        && crate::ProposalKind::ALL.iter().any(|kind| kind.key() == name)
    {
        return crate::ai_content::check_ai_translation(file, source, english).map_err(|e| invalid(file, e));
    }
    if manifest.requires_english() || !file.replace('\\', "/").split('/').any(|p| p == "stories") {
        return draft_translation(file, source, english, missing);
    }
    let mut value: toml::Value = parse(file, source)?;
    let overlay: toml::Value = parse(&format!("locales/en/{file}"), english)?;
    if let Some(tracks) = value.get_mut("tracks").and_then(toml::Value::as_array_mut) {
        for track in tracks {
            let covered = track
                .get("key")
                .and_then(toml::Value::as_str)
                .and_then(|key| overlay.get("tracks").and_then(|t| t.get(key)))
                .and_then(|t| t.get("chapters"))
                .and_then(toml::Value::as_table);
            if let Some(covered) = covered.filter(|c| !c.is_empty())
                && let Some(chapters) = track.get_mut("chapters").and_then(toml::Value::as_array_mut)
            {
                chapters
                    .retain(|c| c.get("key").and_then(toml::Value::as_str).is_some_and(|k| covered.contains_key(k)));
            }
        }
    }
    let source = toml::to_string(&value).map_err(|e| invalid(file, e.to_string()))?;
    draft_translation(file, &source, english, missing)
}

fn draft_display(value: &toml::Value, file: &str, nested: bool) -> Result<toml::Table, WorldError> {
    let mut result = toml::Table::new();
    let table = value.as_table().ok_or_else(|| invalid(file, "显示条目必须是表"))?;
    for (field, value) in table {
        if matches!(
            field.as_str(),
            "name"
                | "desc"
                | "currency"
                | "era"
                | "lore"
                | "description"
                | "persona"
                | "role"
                | "bio"
                | "title"
                | "after_loss"
                | "fake_note"
                | "story_hook"
                | "river"
                | "summary"
                | "text"
                | "secret"
                | "after"
                | "note"
                | "access_note"
                | "calendar_note"
                | "synopsis"
                | "theme"
                | "prompt"
                | "form_note"
                | "topic"
                | "credential_note"
                | "remediation_note"
                | "source_note"
                | "customs"
                | "gift_custom"
                | "date_note"
        ) || (field == "failure" && value.is_str())
            || (file.replace('\\', "/").split('/').any(|part| part == "stories")
                && matches!(field.as_str(), "reply" | "hint" | "news"))
        {
            if value.as_str().is_none_or(|s| s.trim().is_empty()) {
                return Err(invalid(file, format!("{field} 必须是非空显示文字")));
            }
            result.insert(field.clone(), value.clone());
        } else if matches!(field.as_str(), "via" | "mood_lines" | "hints" | "faces" | "clues")
            || (field == "options"
                && table.contains_key("prompt")
                && value.as_array().is_some_and(|a| a.iter().all(toml::Value::is_str)))
        {
            if !value.as_array().is_some_and(|a| a.iter().all(|v| v.as_str().is_some_and(|s| !s.trim().is_empty()))) {
                return Err(invalid(file, format!("{field} 必须是显示文字列表")));
            }
            result.insert(field.clone(), value.clone());
        } else if field == "lines" && value.is_table() {
            let lines = value.as_table().ok_or_else(|| invalid(file, "lines 必须是台词表"))?;
            for (kind, lines) in lines {
                if kind == "catchphrase" {
                    if lines.as_str().is_none_or(|s| s.trim().is_empty()) {
                        return Err(invalid(file, "lines.catchphrase 必须是非空台词"));
                    }
                    continue;
                }
                let registered = matches!(kind.as_str(), "greet" | "gift_liked" | "gift_disliked");
                if !registered
                    || !lines.as_array().is_some_and(|a| {
                        !a.is_empty() && a.iter().all(|v| v.as_str().is_some_and(|s| !s.trim().is_empty()))
                    })
                {
                    return Err(invalid(file, format!("lines.{kind} 必须是已登记的非空台词列表")));
                }
            }
            result.insert(field.clone(), value.clone());
        } else if let Some(rows) = value.as_array() {
            let keyed_story = file.replace('\\', "/").split('/').any(|part| part == "stories")
                && matches!(field.as_str(), "chapters" | "choices" | "variants");
            if nested && !keyed_story && !matches!(field.as_str(), "lots" | "bidders" | "specials") {
                let mut displays = Vec::new();
                let mut any = false;
                for row in rows.iter().filter(|row| row.is_table()) {
                    let mut display = draft_display(row, file, true)?;
                    if !display.is_empty() {
                        any = true;
                        for identity in ["key", "rank"] {
                            if let Some(value) = row.get(identity) {
                                display.insert(identity.into(), value.clone());
                            }
                        }
                    }
                    displays.push(toml::Value::Table(display));
                }
                if any {
                    result.insert(field.clone(), toml::Value::Array(displays));
                }
                continue;
            }
            let mut entries = toml::Table::new();
            for row in rows.iter().filter(|row| row.is_table()) {
                let display = draft_display(row, file, true)?;
                if display.is_empty() {
                    continue;
                }
                let key = ["key", "item", "person"]
                    .iter()
                    .find_map(|key| row.get(*key).and_then(toml::Value::as_str))
                    .or_else(|| if field == "effects" { row.get("effect").and_then(toml::Value::as_str) } else { None })
                    .ok_or_else(|| invalid(file, format!("{field} 显示条目缺少稳定 key / item / person")))?;
                if entries.insert(key.into(), toml::Value::Table(display)).is_some() {
                    return Err(WorldError::DuplicateKey { file: file.into(), key: key.into() });
                }
            }
            if !entries.is_empty() {
                result.insert(field.clone(), toml::Value::Table(entries));
            }
        } else if value.is_table() {
            let display = draft_display(value, file, true)?;
            if !display.is_empty() {
                result.insert(field.clone(), toml::Value::Table(display));
            }
        }
    }
    Ok(result)
}

/// 剧情章节的嵌套写法（与运行时 `locale::overrides::story2::untranslated_chapters` 同一规则）：英文用
/// `[tracks."<轨道>".chapters."<章>"]` 登记过某条轨道的章节时，这条轨道没登记的章（连同它的选项、变体、目标、分支、效果）
/// 允许只有中文、缺译回退中文。比较前把嵌套的章并回扁平的 `chapters."<轨道>:<章>"`，再从原文里去掉没登记的章。
fn fold_nested_chapters(expected: &mut toml::Table, english: &mut toml::Value) {
    let Some(tracks) = english.get_mut("tracks").and_then(toml::Value::as_table_mut) else { return };
    let mut nested: BTreeMap<String, toml::Table> = BTreeMap::new();
    for (track, value) in tracks.iter_mut() {
        if let Some(chapters) = value.as_table_mut().and_then(|t| t.remove("chapters")).and_then(|v| match v {
            toml::Value::Table(t) if !t.is_empty() => Some(t),
            _ => None,
        }) {
            nested.insert(track.clone(), chapters);
        }
    }
    if nested.is_empty() {
        return;
    }
    let Some(root) = english.as_table_mut() else { return };
    let flat = root.entry("chapters").or_insert_with(|| toml::Value::Table(toml::Table::new()));
    if let Some(flat) = flat.as_table_mut() {
        for (track, chapters) in &nested {
            for (chapter, value) in chapters {
                flat.insert(format!("{track}:{chapter}"), value.clone());
            }
        }
    }
    let optional = |key: &str| {
        let mut parts = key.splitn(3, ':');
        let (Some(track), Some(chapter)) = (parts.next(), parts.next()) else { return false };
        nested.get(track).is_some_and(|chapters| !chapters.contains_key(chapter))
    };
    for table in ["chapters", "choices", "variants", "objectives", "branches", "effects"] {
        if let Some(entries) = expected.get_mut(table).and_then(toml::Value::as_table_mut) {
            entries.retain(|key, _| !optional(key));
        }
    }
}

/// 只做中文的世界里，已有英文的条目缺了也回退中文的显示字段（与 `locale::overrides` 的同名规则一致）：人物的一句话身份。
fn chinese_first_display(path: &str) -> bool {
    path.strip_prefix("persons.").and_then(|rest| rest.strip_suffix(".summary")).is_some_and(|key| !key.contains('.'))
}

fn compare_draft_display(
    expected: &toml::Value,
    english: &toml::Value,
    file: &str,
    path: &str,
    missing: &mut Option<usize>,
) -> Result<usize, WorldError> {
    if let Some(table) = expected.as_table() {
        let actual = english.as_table().ok_or_else(|| invalid(file, format!("英文 {path} 必须是表")))?;
        for key in actual.keys() {
            if !table.contains_key(key) {
                return Err(invalid(file, format!("英文 {path}.{key} 没有对应条目或字段不能覆盖")));
            }
        }
        let mut count = 0;
        for (key, value) in table {
            let path = if path.is_empty() { key.clone() } else { format!("{path}.{key}") };
            let Some(translated) = actual.get(key) else {
                // 人物的一句话身份是只写中文补上的字段：已有英文的人物缺这一项时回退中文，其余字段照旧必须有英文
                if chinese_first_display(&path) {
                    continue;
                }
                if let Some(count) = missing {
                    *count += 1;
                    continue;
                }
                return Err(invalid(file, format!("缺少英文 {path}")));
            };
            count += compare_draft_display(value, translated, file, &path, missing)?;
        }
        Ok(count)
    } else if let Some(lines) = expected.as_array() {
        let actual = english
            .as_array()
            .filter(|a| a.len() == lines.len())
            .ok_or_else(|| invalid(file, format!("英文 {path} 列表条数必须与原文一致")))?;
        let mut count = 0;
        for (index, (line, translation)) in lines.iter().zip(actual).enumerate() {
            count += compare_draft_display(line, translation, file, &format!("{path}[{index}]"), missing)?;
        }
        Ok(count)
    } else if matches!(path.split('.').next(), Some("family_youth_names" | "family_call_you"))
        && english.as_str().is_some_and(|s| s.chars().count() > 20 || s.chars().any(char::is_control))
    {
        Err(invalid(file, format!("英文 {path} 的少年称呼超过20字或含控制字符")))
    } else if path.ends_with(".key") || path.ends_with(".rank") {
        if english != expected {
            return Err(invalid(file, format!("英文 {path} 不能覆盖稳定标识")));
        }
        Ok(0)
    } else if english
        .as_str()
        .is_some_and(|s| !s.trim().is_empty() && !s.chars().any(|c| ('\u{3400}'..='\u{9fff}').contains(&c)))
    {
        Ok(1)
    } else {
        Err(invalid(file, format!("英文 {path} 必须是非空英文字符串")))
    }
}

/// 草稿的检查结果；只表示作者数据通过检查，不表示能加载地图或开局。
#[derive(Clone, Debug, Serialize)]
pub struct DraftValidation {
    pub key: String,
    pub files: Vec<String>,
    pub counts: BTreeMap<String, usize>,
    pub translated_strings: usize,
    pub chinese_only_fragments: usize,
    pub resolved_references: usize,
    pub unresolved: Vec<DraftReference>,
    /// B10 人物引用与 A6 条件的明确诊断，不混入一般缺失引用。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub cast_diagnostics: Vec<manifest_core::cast::metadata::CastDiagnostic>,
}

/// 尚无定义的引用保留来源和字段，方便后续内容包逐项接线。
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub struct DraftReference {
    pub table: String,
    pub key: String,
    pub file: String,
    pub item: String,
    pub field: String,
}

/// 严格检查草稿内容与英文；已附地图时校验完整地图资源，不创建游戏。
pub fn validate_draft_world(root: &Path, key: &str) -> Result<DraftValidation, WorldError> {
    validate_draft_coverage(root, key, &mut None)
}

/// CLI 的英文缺项只计数；源数据、已有译文字段及引用仍逐项严格检查。
/// 作者使用的 validate_draft_world 保留完整覆盖约定。
pub fn validate_draft_world_with_english_warnings(
    root: &Path,
    key: &str,
) -> Result<(DraftValidation, usize), WorldError> {
    let mut missing = Some(0);
    let report = validate_draft_coverage(root, key, &mut missing)?;
    Ok((report, missing.unwrap_or_default()))
}

fn validate_draft_coverage(root: &Path, key: &str, missing: &mut Option<usize>) -> Result<DraftValidation, WorldError> {
    let world = resolve_world(root, key)?;
    if !world.manifest.draft {
        return Err(invalid(key, "完整世界必须使用完整数据校验"));
    }
    if world.map.is_some() {
        crate::convert::map_package::load(&world)?;
    }
    let mut report = draft_checks::validate(&world, missing)?;
    report.cast_diagnostics = crate::convert::cast::validate_catalog(&world)?.diagnostics;
    Ok(report)
}

// 作者阶段的 schema 与运行时 raw 结构分开：经纬度、人物和物品不能假装已经能开局。
pub(crate) fn validate_author_row(
    world: &EffectiveWorld,
    file: &str,
    kind: &str,
    row: &toml::Value,
) -> Result<(), WorldError> {
    draft_checks::validate_author_row(world, file, kind, row)
}

/// 物理分片和合并逻辑表共存时，额外覆盖仍须匹配显式清单并通过严格显示校验。
pub(crate) fn validate_fragment_translations(
    world: &EffectiveWorld,
    wanted: &[String],
) -> BTreeMap<String, Result<(), String>> {
    if !world.manifest.draft {
        return translations::validate_merged(world, wanted);
    }
    let fragments = match world.draft_fragments() {
        Ok(v) => v,
        Err(e) => return wanted.iter().map(|file| (file.clone(), Err(e.to_string()))).collect(),
    };
    let mut result = BTreeMap::new();
    for file in wanted {
        let Some(source_file) = world.files.get(&format!("locales/en/{file}")) else { continue };
        let matching: Vec<_> = fragments.iter().filter(|f| source_file.sources.contains(&f.english)).collect();
        if matching.is_empty() {
            continue;
        }
        let checked = matching.into_iter().try_for_each(|fragment| {
            let source = files::read_text(&fragment.path)?;
            let english = files::read_text(&fragment.english)?;
            validate_story_translation_for_world(&world.manifest, file, &source, &english).map(|_| ())
        });
        result.insert(file.clone(), checked.map_err(|e| e.to_string()));
    }
    result
}

mod draft_checks {
    use super::*;
    use std::collections::BTreeSet;
    use toml::Value;

    struct Row {
        file: String,
        table: String,
        key: String,
        value: Value,
    }

    // 字段后 ? 表示可选；[] 是列表，{} 是按 key 索引的表。
    // s 非空文本、k 内部 key、i 整数、u 非负整数、p 正整数、b 布尔。
    // 固定 schema 拒绝未知字段，递归检查嵌套类型；没有通配的“任意 TOML”。
    fn schema(name: &str) -> Option<&'static str> {
        Some(match name {
            "ports" => {
                "key:k name:s lonlat:lonlat anchor_hint:=n|s|e|w|river river?:s faction:k culture:k development:u shipyard:[k] market:[market] facilities:[k] basis:basis sources:[s] lore:s hemisphere?:=north|south dormant?:dormant style?:k hidden?:b realm?:k size?:u"
            }
            "cities" => {
                "key:k name:s lonlat:lonlat faction:k culture:k market:[market] basis:basis sources:[s] lore:s style?:k hemisphere?:=north|south development?:u"
            }
            "market" => {
                "good:k supply:u demand:u unlock_stage?:p unlock_discovery?:k unlock_creature?:k unlock_visited?:k limit?:p"
            }
            "dormant" => "until:p by:k",
            "roads" => "key:k from:k to:k days:p via:[s] risk:prob basis:basis sources:[s] lore:s",
            "discoveries" => {
                "key:k name:s kind:=ruins|wonder|wreck|relic|landmark|fallen|animal|plant|phantom lonlat:lonlat radius:p requires:requires reward:reward basis:basis sources:[s] lore:s phantom?:b reachable?:b once?:b moves?:[move]"
            }
            "requires" => "mode:=sight|land|dive permission?:b landing?:b weather?:k history?:k records?:[k]",
            "reward" => "fame?:u codex:b clue?:k",
            "move" => "from_year:p location:k lonlat:lonlat",
            "sites" => {
                "key:k name:s kind:=scenery|lighthouse|fort|cape lonlat:lonlat radius:p discovery?:k basis:basis sources:[s] lore:s"
            }
            "book_categories" => "key:k name:s",
            "offstage" => "key:k name:s region:k",
            "offstage_regions" => "key:k name:s",
            "items" => {
                "key:k name:s kind:=weapon|sidearm|outfit|accessory|instrument|focus|book|consumable|gift|curio|chart|key rarity:p price:u tags:[k] basis:basis sources:[s] lore:s work?:k published?:published read?:read shop?:shop bonus?:{i} effects?:[effect] flags?:flags owner_hint?:k made_by?:k chart?:chart use?:[effect] variant_of?:k"
            }
            "read" => "days:p lang:k category:k gains:{u} skills?:[skill] reveals?:[k] records?:[k]",
            "skill" => "skill:k xp:u",
            "shop" => "cultures:[k] min_size:u weight:p",
            "effect" => "kind:effect_kind value:i activity?:k tag?:k culture?:k region?:k",
            "flags" => "key:b",
            "chart" => "regions:[k]",
            "sets" => "key:k name:s items:[k] required:p bonus:[effect] title:s",
            "auctions" => {
                "key:k name:s port:k month:p days:p announcement_days:u preview_days:u lots_per_session:range consignment:b basis:basis sources:[s] lore:s lots:[lot] bidders:[bidder] specials?:[special]"
            }
            "lot" => {
                "item:k reserve:u increment:p weight:p authenticity:=genuine|fake|unsure after_loss:s from?:p fake_note?:s"
            }
            "bidder" => "person:k budget:u likes:[k] temper:=cautious|steady|aggressive|collector mood_lines:[s]",
            "special" => "item:k year:p once:b story_hook:s after_loss:s",
            // H04 海上所见（voyage/sightings.toml）；数值上限与物品引用由完整加载检查
            "sightings" => {
                "key:k kind:=flotsam|wreck|castaway|birds|shoal|fishing|weed|ice|reef weight:p title:s text:s when?:sight_when options:[sight_option]"
            }
            "sight_when" => {
                "climates?:[=temperate|cold|arid|tropical] seasons?:[=spring|summer|autumn|winter] shore?:=near|far"
            }
            "sight_option" => "label:s result:s safe?:s effects?:sight_effects lucky?:sight_lucky",
            "sight_lucky" => "chance:prob result:s effects?:sight_effects",
            // H08 甲板闲话（voyage/banter.toml）；同伴、岗位与触发键由完整加载检查
            "banter" => "key:k trigger:k mate?:k role?:k text:s reply?:banter_reply",
            "banter_reply" => "label:s answer:s affinity?:u",
            "sight_effects" => {
                "cash?:i morale?:i crew?:range supplies?:i fresh?:u goods?:range item?:k damage?:u damage_full_sail?:u rumor?:b chart?:b land?:u port?:b"
            }
            "persons" => {
                "key:k name:s kind:=historical|story|protagonist|legend gender:=m|f culture:k faction:k born:birth history:history basis:basis sources:[s] romance:empty portraits:[portrait] schedule:[schedule] audience:audience likes:[k] dislikes:[k] mate:mate persona:s summary?:s lines:lines tracks:[k] fate:[fate] tags?:[k]"
            }
            "history" => "born:u died:u",
            "portrait" => "from_age:u asset:s",
            "schedule" => {
                "from:date to?:date at:k venue:=court|tavern|church|temple|mosque|market|dock|secret_room|trading_house"
            }
            "audience" => "fame:u reputation:{i}",
            "mate" => "navigation:u trade:u combat:u management:u salary:u joinable:b",
            "lines" => "greet:[s] gift_liked:[s] gift_disliked:[s]",
            "fate" => "event:k outcome:k then:=dies|survives schedule?:schedule",
            "past" => "key:k name:s sources:[s] lore:s",
            "workshops" => "loc:k recipe:k share:prob",
            // C6 / C8 作者格式的封闭字段表；不等同运行时加载能力。
            "c8_persons" => {
                "academy?:s after?:s audience:c8_persons_audience basis:author_basis birthday:month_day bond_track?:s born:date cameo?:s culture:s dislikes:[s] faction:s family?:s fate:[fate] gender:=m|f key:k kind:=story|protagonist|legend known_regions?:[s] likes:[s] lineage?:s lines:c8_persons_lines main_track?:s mate:c8_persons_mate name:s names:[c8_persons_names] npc_track?:s persona:s portraits:[c8_persons_portraits] romance:c8_persons_romance schedule:[c8_persons_schedule] secret?:s societies:[k] sources:[s] summary:s tags:[s] template?:s tracks:[s]"
            }
            "c8_persons_romance" => "with?:[=m|f|any]",
            "c8_persons_portraits" => "asset:s from_age:u",
            "c8_persons_schedule" => {
                "at:s from:date to:date venue:=court|tavern|church|temple|mosque|market|dock|secret_room|trading_house|classroom|library|garden|roof|dorm|shrine|exchange|garrison|guildhall|school|shipyard|shore|stable|theatre|workshop"
            }
            "c8_persons_audience" => "fame:i",
            "c8_persons_names" => "rank:=C|B|A|S text:s",
            "c8_persons_mate" => "abilities:[s] combat:u joinable:b management:u navigation:u salary:u trade:u",
            "c8_persons_lines" => "catchphrase?:s gift_disliked:[s] gift_liked:[s] greet:[s]",
            "c8_ties" => {
                "a:s b:s basis:author_basis key:k kind:=friends|confidants|sisters|sworn|rivals|lovers|mentor|enemies|crush|partners note:s open:b since:date sources:[s] story:s tags:[s] when?:c8_ties_when"
            }
            "c8_ties_when" => {
                "flag?:s graduation?:b no_promise_with_protagonist?:[s] no_romance_with_others?:[s] persons?:[c7_ties_person]"
            }
            "c7_ties_person" => "person:k age:int_range",
            "c8_skills" => {
                "basis:author_basis description:s effects:[c8_skills_effects] key:k kind:s language?:s learnable?:b levels:[c8_skills_levels] max_level:u name:s sources:[s] unlock?:c8_skills_unlock"
            }
            "c8_skills_effects" => "kind:effect_kind value:i activity?:k tag?:k culture?:k region?:k",
            "c8_skills_levels" => "effects:[c8_skills_levels_effects] level:u xp:u",
            "c8_skills_levels_effects" => "kind:effect_kind value:i activity?:k tag?:k culture?:k region?:k",
            "c8_skills_unlock" => "all?:[c8_skills_unlock_all] never?:b",
            "c8_skills_unlock_all" => "flag:s",
            "c8_academies" => {
                "age:int_range basis:author_basis board:b calendar:[c8_academies_calendar] calendar_note:s calendar_status:s classmates:[s] clubs:[c8_academies_clubs] culture:s curriculum:[c8_academies_curriculum] entry_flag:s exams:[s] graduation:c8_academies_graduation key:k mentor_roles:c8_academies_mentor_roles mentors:[s] name:s phases:[c8_academies_phases] places:[c8_academies_places] rival:s rules:c8_academies_rules satellite?:b schedule_venues:[s] sources:[s] visits?:[c8_academies_visits] where:s who:c8_academies_who"
            }
            "c8_academies_who" => "access_note:s alternative:c8_academies_who_alternative gender:s rank:[s]",
            "c8_academies_who_alternative" => "flag:s note:s",
            "c8_academies_curriculum" => {
                "cost:u events:[s] fatigue:i gains:{int_range} income:u key:k kind:s mentor:s mood:i name:s scene:s skills:[c8_academies_curriculum_skills] unlock:c8_academies_curriculum_unlock"
            }
            "c8_academies_curriculum_skills" => "skill:s xp:u",
            "c8_academies_curriculum_unlock" => "year:u",
            "c8_academies_calendar" => "contest?:s date:date event:s exam?:s kind:s name:s",
            "c8_academies_mentor_roles" => {
                "club_mentor:s craft_mentor:s job_mentor:s lesson_mentor:s reading_mentor:s rest_mentor:s social_mentor:s training_mentor:s"
            }
            "c8_academies_clubs" => "contests:[s] events:[s] key:k members:[s] name:s practice:[s] synopsis:s",
            "c8_academies_places" => "events:[s] key:k name:s scene:s venue:s x:u y:u",
            "c8_academies_graduation" => "date:date event:s note:s promise_at:s",
            "c8_academies_rules" => {
                "fighting:c8_academies_rules_fighting late:c8_academies_rules_late night_absence:c8_academies_rules_night_absence recommendation:c8_academies_rules_recommendation scholarship:c8_academies_rules_scholarship"
            }
            "c8_academies_rules_late" => "fame:i note:s",
            "c8_academies_rules_fighting" => "club_pause_days:u fame:i note:s",
            "c8_academies_rules_night_absence" => "fame:i leave_pause_days:u note:s",
            "c8_academies_rules_scholarship" => "fee_discount_pct:u honor_min:u min:i rating:s",
            "c8_academies_rules_recommendation" => "exam:s honor_min:u item:s",
            "c8_academies_phases" => "from:date mentors:[s] name:s to:date",
            "c8_academies_visits" => "note:s people?:[s] unlock:c8_academies_visits_unlock where:s",
            "c8_academies_visits_unlock" => "flag:s",
            "c8_upbringing_rules" => {
                "academy_years:u checks:c8_upbringing_rules_checks end_age:u events:c8_upbringing_rules_events fatigue:c8_upbringing_rules_fatigue graduation:c8_upbringing_rules_graduation growth:c8_upbringing_rules_growth home_years:u key:k mentors:c8_upbringing_rules_mentors money:c8_upbringing_rules_money mood:c8_upbringing_rules_mood name:s peer_scenes:c8_upbringing_rules_peer_scenes schedule:c8_upbringing_rules_schedule sources:[s] start_age:u start_year:u"
            }
            "c8_upbringing_rules_schedule" => {
                "academy_periods:[s] after_school_limit_group:s after_school_monthly_limit:u days:[u] home_periods:[s] resolution_order:[s] slots_per_month:u"
            }
            "c8_upbringing_rules_growth" => {
                "arcana_visible_flag:s attrs:[s] conduct_attrs:[s] conduct_initial:u conduct_max:u conduct_min:u fortune:c8_upbringing_rules_growth_fortune max:i min:i note:s rounding:s table:[c8_upbringing_rules_growth_table]"
            }
            "c8_upbringing_rules_growth_table" => "from:u to:u value:i",
            "c8_upbringing_rules_growth_fortune" => "max:i min:i mode:s ordinary_gains:b",
            "c8_upbringing_rules_checks" => "attr_source:s percent_max:u percent_min:u rng:s rounding:s",
            "c8_upbringing_rules_money" => "capital_source:s cost_to:s income_from:s shortage:s",
            "c8_upbringing_rules_fatigue" => {
                "illness:c8_upbringing_rules_fatigue_illness max:i min:i thresholds:[c8_upbringing_rules_fatigue_thresholds]"
            }
            "c8_upbringing_rules_fatigue_thresholds" => "gain_pct:u min:i",
            "c8_upbringing_rules_fatigue_illness" => "chance_percent:u duration_days:u events:[s] min:i",
            "c8_upbringing_rules_mood" => {
                "contest_bonus:[c8_upbringing_rules_mood_contest_bonus] initial:i max:i min:i"
            }
            "c8_upbringing_rules_mood_contest_bonus" => "min:i value:i",
            "c8_upbringing_rules_mentors" => "binding:[s] bonus_pct:u require_present:b roles:[s]",
            "c8_upbringing_rules_events" => {
                "exhausted:s family_cooldown_days:u focus_per_slot:u no_extra_reward_on_repeat:b pools:[s] selection:s side_per_slot:u variant_order:s"
            }
            "c8_upbringing_rules_peer_scenes" => {
                "cast_presence_required:b note:s physical_ceiling:s protagonist_intervention:b regard_requires_mutual_orientation:b relationship_ceiling:s remote_requires_letter_received:b stage:s"
            }
            "c8_upbringing_rules_graduation" => {
                "capital_date:date date:date ending_selection:s events:[s] friends_may_join:s note:s retain:[s]"
            }
            "c8_ratings" => {
                "divisor:u hidden_unless:c8_ratings_hidden_unless key:k name:s normalization:c8_ratings_normalization note:s range:int_range rounding:s unawakened_value:u weights:{u}"
            }
            "c8_ratings_normalization" => "aptitude_ability_multiplier:u conduct_multiplier:u",
            "c8_ratings_hidden_unless" => "flag?:s",
            "c8_activities" => {
                "age:int_range check?:c8_activities_check conduct?:{int_range} cost:u description:s events:[s] failure?:c8_activities_failure fatigue:i gains:{int_range} income:u key:k kind:s mentor:s monthly_limit?:u monthly_limit_group?:s mood:i name:s needs:[s] risk?:u scene:s skill_choice?:c8_activities_skill_choice skills:[c8_activities_skills] stage:s tags:[s] tiers?:[c8_activities_tiers] tutorial?:c8_activities_tutorial unlock:c8_activities_unlock where:c8_activities_where"
            }
            "c8_activities_where" => "feature:s",
            "c8_activities_skills" => "skill:s xp:u",
            "c8_activities_unlock" => "flag?:s",
            "c8_activities_skill_choice" => "field:s options:[s] require_local_teacher?:b require_transmission?:b xp:u",
            "c8_activities_check" => "attr:s base:u per:u",
            "c8_activities_failure" => "events:[s] extra_fatigue:u gains_pct:u income_pct:u",
            "c8_activities_tiers" => {
                "branches?:[c8_activities_tiers_branches] check?:c8_activities_tiers_check cost?:u events?:[s] fatigue?:i gains?:{int_range} income?:u name:s unlock?:c8_activities_tiers_unlock"
            }
            "c8_activities_tiers_check" => "attr:s base:u per:u",
            "c8_activities_tiers_unlock" => "times:u",
            "c8_activities_tiers_branches" => {
                "check:c8_activities_tiers_branches_check cost:u description:s events:[s] fatigue:i gains:{int_range} income:u key:k name:s unlock?:c8_activities_tiers_branches_unlock"
            }
            "c8_activities_tiers_branches_check" => "attr:s base:u per:u",
            "c8_activities_tiers_branches_unlock" => "attr:s min:i",
            "c8_activities_tutorial" => "book_value:u return_on_finish:b temporary_fleet:b",
            "c8_crafts" => {
                "activity:s check:c8_crafts_check consume:s failure:s key:k level:u materials:[c8_crafts_materials] name:s note:s output:c8_crafts_output skill:s tools:[s]"
            }
            "c8_crafts_materials" => "item:s qty:u",
            "c8_crafts_output" => "item:s qty:u",
            "c8_crafts_check" => "attr:s base:u per:u",
            "c8_aspirations" => {
                "choose_age:u evaluation:c8_aspirations_evaluation events:[s] hidden_required_fields:[s] hidden_slots:u hidden_unlock:c8_aspirations_hidden_unlock key:k name:s note:s ordinary_required_fields:[s] ordinary_slots:u provider:s selection:c8_aspirations_selection"
            }
            "c8_aspirations_selection" => "can_change_before_graduation:b command:s mutually_exclusive:b required:b",
            "c8_aspirations_hidden_unlock" => "requires_all:[s]",
            "c8_aspirations_evaluation" => "at:s capital:s unmet:s unselected:s",
            "c8_contests" => {
                "basis:author_basis check:c8_contests_check compose?:c8_contests_compose culture:s events:[s] form_note?:s game:s key:k lexicon?:s name:s note?:s params:c8_contests_params prep:c8_contests_prep rewards:[c8_contests_rewards] rivals:[s] scene:s scoring:c8_contests_scoring sources:[s] unlock?:c8_contests_unlock word_choices?:[[s]]"
            }
            "c8_contests_params" => {
                "answers?:[c8_contests_params_answers] beats?:contest_beats bpm?:u cols?:u faces?:[s] flips?:u hand?:[c8_contests_params_hand] hints?:[s] legs?:[c8_contests_params_legs] lines?:[c8_contests_params_lines] rounds?:[c8_contests_params_rounds] rows?:u samples?:[c8_contests_params_samples] theme?:s topic?:s window?:u"
            }
            "c8_contests_params_lines" => "options:[s] prompt:s",
            "c8_contests_check" => "attr:s base:u coef:u max:i min:i prep_cap:u",
            "c8_contests_prep" => "activities:[s] cap:u companion_bonus:u per_practice:u",
            "c8_contests_rewards" => "fame:i items:[c8_contests_rewards_items] memory:s rank:u",
            "c8_contests_rewards_items" => "item:s qty:u",
            "c8_contests_scoring" => {
                "answers?:[s] failed_leg_points?:u kind:s line_points?:[[u]] max_bonus:u option_points?:{u} points_per_correct?:u points_per_hit?:u points_per_pair?:u points_per_win?:u"
            }
            "c8_contests_compose" => {
                "line_syllables?:[u] mora?:[u] note?:s qafia?:[literal] radif?:s rhyme?:string_or_strings rhyme_lines?:[u] roles?:[s] source:s source_suffixes?:[s] stock?:s tone_check?:b"
            }
            "c8_contests_params_rounds" => "opponent:c8_contests_params_rounds_opponent",
            "c8_contests_params_rounds_opponent" => "kind:s text:s",
            "c8_contests_params_hand" => "key:k kind:s text:s",
            "c8_contests_params_legs" => "options:[c8_contests_params_legs_options] text:s",
            "c8_contests_params_legs_options" => "key:k risk:u text:s",
            "c8_contests_unlock" => "weather:s",
            "c8_contests_params_samples" => "clues:[s] key:k",
            "c8_contests_params_answers" => "key:k name:s",
            "c8_poem_lexicons" => "key:k name:s words:[c8_poem_lexicons_words]",
            "c8_poem_lexicons_words" => "image:s key:k line_group?:u mora?:u rhyme:s season:s source:s text:s",
            "c8_endings" => {
                "basis:author_basis bonus:c8_endings_bonus gallery:b key:k name:s once:b priority:u requirements:c8_endings_requirements sources:[s] text:s title:s"
            }
            "c8_endings_requirements" => {
                "all?:[c8_endings_requirements_all] aspiration?:s bond_grade?:s count_max?:u count_min?:u"
            }
            "c8_endings_bonus" => "effects:[c8_endings_bonus_effects]",
            "c8_endings_bonus_effects" => "kind:effect_kind value:i",
            "c8_endings_requirements_all" => {
                "academy_exam_passed?:b activity?:s attr?:s bond_grade?:s book_categories_min?:u books_read_min?:u cash_max?:u count_min?:u exam_passed?:s exams_attempted_min?:u exams_passed_max?:u fame_max?:u fame_min?:u flag?:s level?:u max?:i min?:i outings_solved?:u rating?:s skill?:s times?:u"
            }
            "c8_vignettes" => {
                "awaken_arcana?:b basis:author_basis cast:[s] family:s family_cooldown_days:u key:k kind:s name:s once:b outcome:c8_vignettes_outcome physical_ceiling?:s pool:s protagonist_role?:s relationship_ceiling?:s scene:s settlement?:s sources:[s] tags?:[s] text:s tie_ref?:s tone?:s when:c8_vignettes_when"
            }
            "c8_vignettes_when" => {
                "academy?:s activity?:s actors?:[s] actors_age?:int_range actors_present?:b check_result?:s festival?:s festival_window_days?:int_range from?:date letter_received?:b mail_route?:s mutual_orientation?:b no_promise_with_protagonist?:[s] not_flag?:s remote_cast?:b stage?:s years?:[u]"
            }
            "c8_vignettes_outcome" => "flag?:s memory?:s",
            "c8_exams" => {
                "academy?:s assessment?:c8_exams_assessment bonus:c8_exams_bonus check:c8_exams_check credential_note:s events?:[s] key:k name:s rating_check?:c8_exams_rating_check remediation_note?:s repeat_reward?:b requirements:c8_exams_requirements retake:c8_exams_retake title:s"
            }
            "c8_exams_requirements" => {
                "all?:[c8_exams_requirements_all] lessons?:u rating?:c8_exams_requirements_rating year?:u"
            }
            "c8_exams_requirements_all" => {
                "activity?:s attr?:s completed_slots?:u flag?:s languages_at_level?:u level?:u min?:i rating?:s times?:u year?:u"
            }
            "c8_exams_check" => "attrs:{u} base:u max:i min:i",
            "c8_exams_retake" => "cooldown_days:u fee:u max_attempts:u remediation:[s]",
            "c8_exams_bonus" => "effects:[c8_exams_bonus_effects] items:[c8_exams_bonus_items]",
            "c8_exams_bonus_effects" => "kind:effect_kind value:i",
            "c8_exams_bonus_items" => "item:s qty:u",
            "c8_exams_rating_check" => "check_bonus_divisor:u min_total:u ratings:[s] unawakened_occult:u",
            "c8_exams_requirements_rating" => "key:k min:i",
            "c8_exams_assessment" => "criteria:[c8_exams_assessment_criteria] note:s practice_contest:s",
            "c8_exams_assessment_criteria" => "attr:s min:i",
            "c8_outings" => {
                "age:int_range culture:s encounters:[c8_outings_encounters] events:[s] key:k links:[s] map:s name:s repeat:c8_outings_repeat risk:c8_outings_risk scene:s source_note:s stage:s states:[c8_outings_states] unlock:c8_outings_unlock where:c8_outings_where x:u y:u"
            }
            "c8_outings_where" => "academies:[s] bind:s cultures:[s]",
            "c8_outings_unlock" => "flag:s",
            "c8_outings_states" => {
                "consume_items?:b fame?:i from:s gains:{int_range} key:k memory?:s name:s skills?:[c8_outings_states_skills] text:s to:s unlock:c8_outings_states_unlock"
            }
            "c8_outings_states_unlock" => "any?:[c8_outings_states_unlock_any]",
            "c8_outings_states_unlock_any" => "attr?:s companion_skill?:s item?:s level?:u min?:i qty?:u skill?:s",
            "c8_outings_states_skills" => "skill:s xp:u",
            "c8_outings_encounters" => {
                "avoid_fight?:b awaken_arcana?:b basis:author_basis kind:s name:s sources:[s] text?:s"
            }
            "c8_outings_repeat" => "cooldown_days:u fame:i gains:{int_range} income:u state:s",
            "c8_outings_risk" => "check:c8_outings_risk_check failure:c8_outings_risk_failure",
            "c8_outings_risk_check" => "attr:s base:u per:u",
            "c8_outings_risk_failure" => "fatigue:i mood:i state_unchanged:b",
            "c8_festivals" => {
                "basis:author_basis calendar_system:s contests:[s] culture:s customs:s date_note:s date_status:s dates:[date] duration_days?:u events:[s] gift_custom:s key:k name:s romance:b scene:s sources:[s]"
            }
            _ => return super::c12::schema(name),
        })
    }

    fn number(value: &Value) -> Option<f64> {
        value.as_float().or_else(|| value.as_integer().map(|n| n as f64)).filter(|n| n.is_finite())
    }

    fn finite_numbers(value: &Value, file: &str) -> Result<(), WorldError> {
        match value {
            Value::Float(number) if !number.is_finite() => return Err(invalid(file, "数值不能是 NaN 或无穷")),
            Value::Table(table) => {
                for value in table.values() {
                    finite_numbers(value, file)?;
                }
            }
            Value::Array(array) => {
                for value in array {
                    finite_numbers(value, file)?;
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn check_shape(
        value: &Value,
        kind: &str,
        file: &str,
        path: &str,
        calendar: &manifest_core::calendar::Calendar,
    ) -> Result<(), WorldError> {
        let error = || invalid(file, format!("{path} 不符合草稿 schema：{kind}"));
        if kind == "author_basis" {
            return if matches!(value.as_str(), Some("literary" | "legendary" | "myth")) {
                Ok(())
            } else {
                check_shape(value, "basis", file, path, calendar)
            };
        }
        if kind == "persons" && value.get("kind").and_then(Value::as_str) == Some("legend") {
            // 传说人物沿用生产目录的封闭字段与缺省值；不为未知身世编造生日、日程或所属势力。
            let p: manifest_core::cast::PersonDef =
                value.clone().try_into().map_err(|e: toml::de::Error| invalid(file, format!("{path}：{e}")))?;
            for (field, shape) in [
                ("key", "k"),
                ("name", "s"),
                ("born", "birth"),
                ("culture", "k"),
                ("basis", "author_basis"),
                ("sources", "[s]"),
                ("persona", "s"),
            ] {
                check_shape(value.get(field).ok_or_else(error)?, shape, file, &format!("{path}.{field}"), calendar)?;
            }
            if p.sources.is_empty() {
                return Err(invalid(file, format!("{path}.sources 必须提供出处")));
            }
            if let Some(birthday) = value.get("birthday") {
                check_shape(birthday, "month_day", file, &format!("{path}.birthday"), calendar)?;
                if p.birthday != Some([p.born[1], p.born[2]]) {
                    return Err(invalid(file, format!("{path}.birthday 必须与born一致")));
                }
            }
            return Ok(());
        }
        if kind == "persons" && value.get("kind").and_then(Value::as_str) != Some("historical") {
            return check_shape(value, "c8_persons", file, path, calendar);
        }
        if let Some(inner) = kind.strip_prefix('[').and_then(|k| k.strip_suffix(']')) {
            let entries = value.as_array().ok_or_else(error)?;
            let mut keys = BTreeSet::new();
            for (index, entry) in entries.iter().enumerate() {
                check_shape(entry, inner, file, &format!("{path}[{index}]"), calendar)?;
                let key = if inner == "k" {
                    entry.as_str()
                } else {
                    ["key", "item", "person", "good", "skill"]
                        .iter()
                        .find_map(|field| entry.get(*field).and_then(Value::as_str))
                };
                if let Some(key) = key
                    && !keys.insert(key)
                {
                    return Err(invalid(file, format!("{path} 重复引用：{key}")));
                }
            }
            return Ok(());
        }
        if let Some(inner) = kind.strip_prefix('{').and_then(|k| k.strip_suffix('}')) {
            for (key, value) in value.as_table().ok_or_else(error)? {
                check_shape(&Value::String(key.clone()), "k", file, path, calendar)?;
                check_shape(value, inner, file, &format!("{path}.{key}"), calendar)?;
            }
            return Ok(());
        }
        if let Some(schema) = schema(kind) {
            let table = value.as_table().ok_or_else(error)?;
            let fields: BTreeMap<_, _> = schema
                .split_whitespace()
                .filter_map(|f| f.split_once(':'))
                .map(|(name, kind)| (name.trim_end_matches('?'), (kind, name.ends_with('?'))))
                .collect();
            for field in table.keys() {
                if !fields.contains_key(field.as_str()) {
                    return Err(invalid(file, format!("{path}.{field} 是未知字段")));
                }
            }
            for (field, (kind, optional)) in fields {
                if let Some(value) = table.get(field) {
                    check_shape(value, kind, file, &format!("{path}.{field}"), calendar)?;
                } else if !optional {
                    return Err(invalid(file, format!("{path} 缺少字段 {field}")));
                }
            }
            return Ok(());
        }
        let valid = match kind {
            "s" => value.as_str().is_some_and(|s| !s.trim().is_empty()),
            // 无韵脚的诗行用空字符串占位，显示文字仍必须非空。
            "literal" => value.is_str(),
            "k" => value
                .as_str()
                .is_some_and(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')),
            "i" => value.is_integer(),
            "u" => value.as_integer().is_some_and(|n| n >= 0),
            "p" => value.as_integer().is_some_and(|n| n > 0),
            "b" => value.is_bool(),
            // 节奏游戏保存正毫秒时点，辩论游戏保存两种论证牌的克制关系。
            "contest_beats" => value.as_array().is_some_and(|beats| {
                !beats.is_empty()
                    && (beats.iter().all(|v| v.as_integer().is_some_and(|n| n > 0))
                        || beats.iter().all(|v| {
                            v.as_array().is_some_and(|pair| {
                                pair.len() == 2
                                    && pair.iter().all(|v| {
                                        matches!(v.as_str(), Some("observation" | "reason" | "counterexample"))
                                    })
                            })
                        }))
            }),
            "string_or_strings" => {
                value.as_str().is_some_and(|s| !s.is_empty())
                    || value.as_array().is_some_and(|a| a.iter().all(|v| v.as_str().is_some_and(|s| !s.is_empty())))
            }
            "int_range" => value
                .as_array()
                .is_some_and(|a| a.len() == 2 && a[0].as_integer().zip(a[1].as_integer()).is_some_and(|(a, b)| a <= b)),
            "month_day" => value.as_array().is_some_and(|a| {
                a.len() == 2
                    && date(&Value::Array(vec![Value::Integer(1), a[0].clone(), a[1].clone()]), calendar, false)
                        .is_some()
            }),
            "prob" => number(value).is_some_and(|n| (0.0..=1.0).contains(&n)),
            "empty" => value.as_table().is_some_and(|t| t.is_empty()),
            "basis" => value.as_str().is_some_and(|s| {
                matches!(s, "historical" | "legend" | "original" | "extended" | "folklore" | "literature" | "invented")
            }),
            "effect_kind" => value.as_str().is_some_and(|s| {
                matches!(
                    s,
                    "speed_pct"
                        | "upwind"
                        | "storm_guard_pct"
                        | "fog_sailing"
                        | "sight"
                        | "supply_pct"
                        | "landing_pct"
                        | "tax_pct"
                        | "bargain_pct"
                        | "price_hint"
                        | "duel_pct"
                        | "boarding_pct"
                        | "gunnery_pct"
                        | "ward"
                        | "morale_daily"
                        | "disease_guard_pct"
                        | "wage_pct"
                        | "affinity_pct"
                        | "find_pct"
                        | "chart_reveal"
                        | "arcana"
                        | "spell"
                        | "activity_pct"
                        | "fatigue_pct"
                )
            }),
            "lonlat" => value.as_array().is_some_and(|a| {
                a.len() == 2
                    && number(&a[0]).is_some_and(|n| (-180.0..=180.0).contains(&n))
                    && number(&a[1]).is_some_and(|n| (-90.0..=90.0).contains(&n))
            }),
            "date" | "birth" => date(value, calendar, kind == "birth").is_some(),
            "published" => value.as_array().is_some_and(|a| {
                a.len() == 2
                    && a[0].as_integer().is_some_and(|n| n != 0)
                    && a[1].as_str().is_some_and(|s| !s.trim().is_empty())
            }),
            "range" => value.as_array().is_some_and(|a| {
                a.len() == 2
                    && a[0].as_integer().is_some_and(|n| n > 0)
                    && a[1].as_integer().is_some_and(|n| n >= a[0].as_integer().unwrap_or(i64::MAX))
            }),
            _ => kind
                .strip_prefix('=')
                .is_some_and(|options| value.as_str().is_some_and(|s| options.split('|').any(|o| o == s))),
        };
        if valid { Ok(()) } else { Err(error()) }
    }

    fn date(value: &Value, calendar: &manifest_core::calendar::Calendar, unknown: bool) -> Option<[i64; 3]> {
        let parts = value.as_array()?;
        if parts.len() != 3 {
            return None;
        }
        let date = [parts[0].as_integer()?, parts[1].as_integer()?, parts[2].as_integer()?];
        let [year, month, day] = date;
        if year < 0 || (year == 0 && !unknown) || year > i64::from(u32::MAX) || month < 1 || day < 1 {
            return None;
        }
        let actual = manifest_core::calendar::Date {
            year: u32::try_from(year.max(1)).ok()?,
            month: u32::try_from(month).ok()?,
            day: u32::try_from(day).ok()?,
        };
        calendar.day_of(actual).ok().map(|_| date)
    }

    fn group_tables(group: &str) -> Option<&'static [&'static str]> {
        Some(match group {
            "goods" => &["goods"],
            "mates" => &["mates"],
            "stories" => &["tracks"],
            "history" => &["events", "campaigns", "history_ports", "history_envoys"],
            "ideas" => &["ideas", "idea_ports"],
            "ships" => &["ships", "refits"],
            "recipes" => &["industries", "recipes"],
            "factions" => &["factions", "relations"],
            "companies" => &["companies"],
            "workshops" => &["workshops"],
            "ports" => &["ports"],
            "cities" => &["cities"],
            "roads" => &["roads"],
            "discoveries" => &["discoveries"],
            "sites" => &["sites"],
            "offstage" => &["offstage", "offstage_regions"],
            "items" => &["items", "book_categories"],
            "sets" => &["sets"],
            "auctions" => &["auctions"],
            "sightings" => &["sightings"],
            "banter" => &["banter"],
            "arcana" => &["schools", "spells"],
            "societies" => &["societies", "policies"],
            "lineages" => &["lineages"],
            "creatures" => &["creatures"],
            "realms" => &["realms"],
            "legend_ships" => &["ships"],
            "persons" => &["persons"],
            "figures" => &["figures"],
            "past" => &["past"],
            "ties" => &["ties"],
            "regions" => &["regions", "knowledge_groups"],
            "opening_catalog" => &["opening_catalog", "scenario_labels"],
            "scenarios" => &["scenarios"],
            "skills" => &["skills"],
            "upbringing" => &[
                "academies",
                "upbringing_rules",
                "ratings",
                "activities",
                "crafts",
                "aspirations",
                "contests",
                "poem_lexicons",
                "endings",
                "vignettes",
                "exams",
                "outings",
                "festivals",
                "families",
                "paths",
                "excursions",
                "tracks",
                "notes",
                "templates",
                "event_gates",
                "culture_aliases",
                "skill_profiles",
                "helpers",
                "helper_levels",
                "job_progress_flags",
                "completions",
                // U04 工作包 5：年度目标卡。
                "annual_goals",
                "lines",
                "act_places",
                "act_timetables",
                "act_duties",
                "act_greetings",
                "act_markers",
                "act_line_gates",
                "act_medians",
                "missions",
                "act_capital",
                "act_review",
                "act_tides",
                "act_rumors",
                "act_perks",
                "act_voyages",
            ],
            "guide" => &["panels", "mechanics", "lines"],
            _ => return None,
        })
    }

    fn runtime_schema(group: &str, file: &str, text: &str) -> Result<bool, WorldError> {
        match group {
            "figures" => {
                parse::<manifest_core::cast::CastDefs>(file, text)?;
                return Ok(true);
            }
            "history" => {
                parse::<manifest_core::history::HistoryDefs>(file, text)?;
                return Ok(true);
            }
            "ideas" => {
                parse::<manifest_core::ideas::IdeasDefs>(file, text)?;
                return Ok(true);
            }
            _ => {}
        }
        if group == "upbringing" {
            let raw: toml::Table = parse(file, text)?;
            if raw.contains_key("format_version") {
                let d: manifest_core::upbringing::UpbringingDefs = parse(file, text).map_err(|e| {
                    if e.to_string().contains("unknown field") {
                        invalid(file, format!("未知字段：{e}"))
                    } else {
                        e
                    }
                })?;
                if d.format_version != Some(1) {
                    return Err(invalid(file, "未知原生养成版本"));
                }
                return Ok(true);
            }
            if file == "upbringing/templates.toml"
                || file.ends_with("/upbringing/templates.toml")
                || file.starts_with("upbringing/templates/")
                || file.contains("/upbringing/templates/")
            {
                #[derive(serde::Deserialize)]
                #[serde(deny_unknown_fields)]
                struct Templates {
                    templates: Vec<manifest_core::scenario::TemplateDef>,
                }
                let d: Templates = parse(file, text)?;
                if d.templates.is_empty() {
                    return Err(invalid(file, "模板表不能为空"));
                }
                return Ok(true);
            }
        }
        if group == "stories" {
            crate::story2::parse_story_tracks(text, file)?;
            return Ok(true);
        }
        // A8 内容分片直接复用生产 schema；不能为草稿另放宽字段和封闭词表。
        match group {
            "arcana" => {
                parse::<manifest_core::arcana::ArcanaDefs>(file, text)?;
            }
            "societies" => {
                parse::<manifest_core::societies::SocietiesDefs>(file, text)?;
            }
            "lineages" => {
                parse::<manifest_core::lineages::LineagesDefs>(file, text)?;
            }
            "creatures" => {
                parse::<manifest_core::creatures::CreaturesDefs>(file, text)?;
            }
            "realms" => {
                parse::<manifest_core::realms::RealmsDefs>(file, text)?;
            }
            "legend_ships" => {
                parse::<manifest_core::legend_ships::LegendShipsDefs>(file, text)?;
            }
            "guide" => {
                parse::<manifest_core::story2::guide_defs::GuideDefs>(file, text)?;
            }
            _ => {}
        }
        if matches!(group, "arcana" | "societies" | "lineages" | "creatures" | "realms" | "legend_ships" | "guide") {
            return Ok(true);
        }
        if !matches!(group, "goods" | "ships" | "recipes" | "factions" | "companies" | "mates") {
            return Ok(false);
        }
        // 一份分片可以只包含组合文件的某一张表；补空数组仅满足生产包装结构。
        let mut value: toml::Table = parse(file, text)?;
        let required: &[&str] = match group {
            "recipes" => &["industries", "recipes"],
            "factions" => &["factions"],
            "ships" => &["ships"],
            _ => &[],
        };
        for field in required {
            value.entry((*field).to_owned()).or_insert_with(|| Value::Array(Vec::new()));
        }
        let text = toml::to_string(&value).map_err(|e| invalid(file, e.to_string()))?;
        match group {
            "mates" => {
                parse::<crate::raw::MatesFile>(file, &text)?;
            }
            "goods" => {
                parse::<crate::raw::GoodsFile>(file, &text)?;
            }
            "ships" => {
                parse::<crate::raw::ShipsFile>(file, &text)?;
            }
            "recipes" => {
                parse::<crate::raw::RecipesFile>(file, &text)?;
            }
            "factions" => {
                parse::<crate::raw::FactionsFile>(file, &text)?;
            }
            "companies" => {
                parse::<crate::raw::CompaniesFile>(file, &text)?;
            }
            _ => return Ok(false),
        }
        Ok(true)
    }

    /// 原生行动制先过正式 schema，再按内核的身份去重；寒暄池保留来源顺序。
    fn act_row_key(table: &str, entry: &Value, file: &str, index: usize) -> Option<String> {
        Some(match table {
            "act_places" => format!("{}/{}", string(entry, "family"), string(entry, "place")),
            "act_timetables" => {
                format!("{}/{}/{}", string(entry, "family"), string(entry, "stage"), string(entry, "academy"))
            }
            "act_markers" => string(entry, "track").to_owned(),
            "act_greetings" => format!("{file}:{index}"),
            "act_line_gates" => string(entry, "line").to_owned(),
            "act_medians" => format!("{}/{}", string(entry, "family"), string(entry, "attr")),
            "act_capital" => {
                format!("{}/{}/{}", string(entry, "family"), string(entry, "path"), string(entry, "band"))
            }
            "act_review" => string(entry, "family").to_owned(),
            "act_perks" => format!("{}/{}/{}", string(entry, "family"), string(entry, "person"), entry["level"]),
            "act_tides" => format!("{}/{}", string(entry, "port"), string(entry, "key")),
            _ => return None,
        })
    }

    pub(super) fn validate_author_row(
        world: &EffectiveWorld,
        file: &str,
        kind: &str,
        row: &Value,
    ) -> Result<(), WorldError> {
        finite_numbers(row, file)?;
        check_shape(row, kind, file, kind, &world.manifest.calendar)
    }

    fn translated_strings(
        fragment: &files::DraftFragment,
        world: &EffectiveWorld,
        text: &str,
        missing: &mut Option<usize>,
    ) -> Result<Option<usize>, WorldError> {
        if missing.is_none() {
            return fragment.translated_strings(&world.manifest, text);
        }
        if !fragment.english.try_exists().map_err(|source| WorldError::Io { path: fragment.english.clone(), source })? {
            if let Some(count) = missing {
                *count += 1;
            }
            return Ok(None);
        }
        let english = files::read_text(&fragment.english)?;
        story_translation(&world.manifest, &fragment.file, text, &english, missing).map(Some)
    }

    pub(super) fn validate(world: &EffectiveWorld, missing: &mut Option<usize>) -> Result<DraftValidation, WorldError> {
        let mut report = DraftValidation {
            key: world.manifest.key.clone(),
            files: Vec::new(),
            counts: BTreeMap::new(),
            translated_strings: 0,
            chinese_only_fragments: 0,
            resolved_references: 0,
            unresolved: Vec::new(),
            cast_diagnostics: Vec::new(),
        };
        let mut rows = Vec::new();
        let mut keys = BTreeSet::new();
        let mut base_symbols: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        let mut ai_checked = false;
        for fragment in world.draft_fragments()? {
            if matches!(fragment.table.as_str(), "prompts" | "templates") {
                if !ai_checked {
                    crate::ai_content::check_world_ai_files(world)
                        .map_err(|e| invalid(&fragment.file, e.to_string()))?;
                    ai_checked = true;
                }
                let text = files::read_text(&fragment.path)?;
                let numeric = ["director.toml", "strategy.toml", "contract.toml"]
                    .iter()
                    .any(|name| fragment.file.ends_with(name));
                if fragment.table != "templates" || !numeric || fragment.english.is_file() {
                    match translated_strings(&fragment, world, &text, missing)? {
                        Some(count) => report.translated_strings += count,
                        None => report.chinese_only_fragments += 1,
                    }
                }
                report.files.push(fragment.file);
                continue;
            }
            if fragment.table == "base_config" {
                let text = files::read_text(&fragment.path)?;
                base_config::validate(&fragment.file, &text)?;
                if fragment.file.rsplit('/').next() == Some("captain.toml") {
                    let raw: Value = parse(&fragment.file, &text)?;
                    for table in ["ratings", "attributes"] {
                        for row in array(&raw, table) {
                            base_symbols.entry(table.into()).or_default().insert(string(row, "key").into());
                        }
                    }
                }
                if fragment.file.rsplit('/').next() == Some("mates.toml") {
                    let raw: Value = parse(&fragment.file, &text)?;
                    for row in array(&raw, "mates") {
                        base_symbols.entry("people".into()).or_default().insert(string(row, "key").into());
                    }
                }
                match translated_strings(&fragment, world, &text, missing)? {
                    Some(count) => report.translated_strings += count,
                    None => report.chinese_only_fragments += 1,
                }
                report.files.push(fragment.file);
                continue;
            }
            let allowed = group_tables(&fragment.table)
                .ok_or_else(|| invalid(&fragment.file, format!("尚无草稿 schema 的表：{}", fragment.table)))?;
            let text = files::read_text(&fragment.path)?;
            let mut raw: toml::Table = parse(&fragment.file, &text)?;
            if fragment.table == "stories"
                && !raw.contains_key("tracks")
                && (raw.contains_key("encounters") || raw.contains_key("chapters"))
            {
                // 旧式故事文件（奇遇、旧故事线；没有 tracks）可以与新轨道并列登记（第九批 S01，2026-11-11）。
                // 结构照生产加载器的 schema 检查（未知字段一律拒绝），不为草稿另放宽；
                // 港口、海区、货物、势力这些引用与数值上限由完整加载检查。
                let (chapters, encounters) = crate::convert::story::classic_file_keys(&text)
                    .map_err(|e| invalid(&fragment.file, format!("旧式故事格式错误：{e}")))?;
                finite_numbers(&Value::Table(raw), &fragment.file)?;
                for (table, list) in [("story_chapters", chapters), ("encounters", encounters)] {
                    if list.is_empty() {
                        continue;
                    }
                    *report.counts.entry(table.to_owned()).or_default() += list.len();
                    for key in list {
                        check_shape(&Value::String(key.clone()), "k", &fragment.file, table, &world.manifest.calendar)?;
                        if !keys.insert((table.to_owned(), key.clone())) {
                            return Err(WorldError::DuplicateKey { file: fragment.file.clone(), key });
                        }
                    }
                }
                match translated_strings(&fragment, world, &text, missing)? {
                    Some(count) => report.translated_strings += count,
                    None => report.chinese_only_fragments += 1,
                }
                report.files.push(fragment.file);
                continue;
            }
            if fragment.table == "regions" {
                check_shape(
                    &Value::Table(raw.clone()),
                    "c12_regions_file",
                    &fragment.file,
                    "",
                    &world.manifest.calendar,
                )?;
                raw.retain(|key, _| matches!(key, "regions" | "knowledge_groups"));
            }
            if fragment.table == "scenarios" {
                let logical = world
                    .files_in("scenarios")
                    .into_iter()
                    .find(|name| world.files[name].sources.contains(&fragment.path))
                    .ok_or_else(|| invalid(&fragment.file, "剧本未被集合消费"))?;
                let (_, legacy) = world.scenario_file(&logical)?;
                parse::<crate::raw::ScenarioRaw>(&fragment.file, &legacy)?;
                raw = toml::Table::from_iter([("scenarios".into(), Value::Array(vec![Value::Table(raw)]))]);
            }
            if fragment.table == "upbringing" && raw.contains_key("key") {
                raw = toml::Table::from_iter([("academies".into(), Value::Array(vec![Value::Table(raw)]))]);
            }
            let runtime = fragment.table == "scenarios" || runtime_schema(&fragment.table, &fragment.file, &text)?;
            super::history::namespace(&fragment.table, &mut raw);
            if runtime && fragment.table == "upbringing" {
                check_native_bounds(&Value::Table(raw.clone()), "", &fragment.file, &world.manifest.calendar)?;
            }
            if raw.is_empty() {
                return Err(invalid(&fragment.file, "分片必须显式声明条目表；空表使用 []"));
            }
            if runtime && fragment.table == "upbringing" {
                raw.remove("format_version");
                raw.remove("rules");
                for table in [
                    "event_gates",
                    "skill_profiles",
                    "helper_levels",
                    "helpers",
                    "culture_aliases",
                    "completions",
                    "job_progress_flags",
                ] {
                    if let Some(entries) = raw.remove(table) {
                        let values = entries
                            .as_table()
                            .ok_or_else(|| invalid(&fragment.file, "原生映射必须是表"))?
                            .iter()
                            .map(|(key, value)| {
                                let mut row = value
                                    .as_table()
                                    .cloned()
                                    .unwrap_or_else(|| toml::Table::from_iter([("values".into(), value.clone())]));
                                row.insert("key".into(), Value::String(key.clone()));
                                Value::Table(row)
                            })
                            .collect();
                        raw.insert(table.into(), Value::Array(values));
                    }
                }
            }
            for (table, entries) in raw {
                if !allowed.contains(&table.as_str()) {
                    return Err(invalid(&fragment.file, format!("{table} 不属于已登记的 {} 表", fragment.table)));
                }
                let entries =
                    entries.as_array().ok_or_else(|| invalid(&fragment.file, format!("{table} 必须是条目列表")))?;
                let row_table = if fragment.table == "legend_ships" { "legend_ships" } else { table.as_str() };
                *report.counts.entry(row_table.to_owned()).or_default() += entries.len();
                for (index, entry) in entries.iter().enumerate() {
                    finite_numbers(entry, &fragment.file)?;
                    if !runtime {
                        check_shape(
                            entry,
                            &if matches!(fragment.table.as_str(), "ties" | "skills" | "upbringing") {
                                format!("c8_{table}")
                            } else {
                                table.clone()
                            },
                            &fragment.file,
                            &format!("{table}[{index}]"),
                            &world.manifest.calendar,
                        )?;
                    }
                    let key = if table == "history_ports" {
                        string(entry, "port").to_owned()
                    } else if table == "history_envoys" {
                        string(entry, "company").to_owned()
                    } else if table == "workshops" {
                        format!("{}/{}", string(entry, "loc"), string(entry, "recipe"))
                    } else if table == "policies" && fragment.table == "societies" {
                        let key = entry.get("faction").ok_or_else(|| invalid(&fragment.file, "政策缺少 faction"))?;
                        check_shape(key, "k", &fragment.file, &table, &world.manifest.calendar)?;
                        key.as_str().unwrap_or_default().to_owned()
                    } else if table == "relations" {
                        let mut pair = [string(entry, "a"), string(entry, "b")];
                        pair.sort();
                        pair.join("/")
                    } else if runtime
                        && fragment.table == "upbringing"
                        && let Some(key) = act_row_key(&table, entry, &fragment.file, index)
                    {
                        key
                    } else {
                        let key =
                            entry.get("key").ok_or_else(|| invalid(&fragment.file, format!("{table} 缺少 key")))?;
                        check_shape(key, "k", &fragment.file, &table, &world.manifest.calendar)?;
                        key.as_str().unwrap_or_default().to_owned()
                    };
                    let namespace = match row_table {
                        "ports" | "cities" | "sites" | "offstage" => "locations",
                        "persons" | "past" | "figures" => "cast",
                        other => other,
                    };
                    if !keys.insert((namespace.to_owned(), key.clone())) {
                        return Err(WorldError::DuplicateKey { file: fragment.file.clone(), key });
                    }
                    rows.push(Row {
                        file: fragment.file.clone(),
                        table: row_table.to_owned(),
                        key,
                        value: entry.clone(),
                    });
                }
            }
            match translated_strings(&fragment, world, &text, missing)? {
                Some(count) => report.translated_strings += count,
                None => report.chinese_only_fragments += 1,
            }
            report.files.push(fragment.file);
        }
        let mut symbols: BTreeMap<String, BTreeSet<String>> = base_symbols;
        for row in &rows {
            symbols.entry(row.table.clone()).or_default().insert(row.key.clone());
            super::history::symbols(&row.table, &row.key, &row.value, &mut symbols);
            if matches!(row.table.as_str(), "regions" | "knowledge_groups") {
                symbols.entry("knowledge".into()).or_default().insert(row.key.clone());
            }
            if row.table == "academies" {
                for course in array(&row.value, "curriculum") {
                    let course_key = string(course, "key").to_owned();
                    register_course_key(row, &course_key, &mut keys)?;
                    symbols.entry("activities".into()).or_default().insert(course_key);
                }
            }
            if matches!(row.table.as_str(), "academies" | "families") {
                for place in array(&row.value, "places") {
                    symbols.entry("places".into()).or_default().insert(string(place, "key").into());
                }
                if let Some(roles) = row.value.get("mentor_roles").and_then(Value::as_table) {
                    symbols.entry("mentor_roles".into()).or_default().extend(roles.keys().cloned());
                }
            }
            if matches!(row.table.as_str(), "ports" | "cities" | "sites" | "offstage") {
                symbols.entry("locations".into()).or_default().insert(row.key.clone());
            }
            if matches!(row.table.as_str(), "ports" | "cities") {
                for entry in array(&row.value, "market") {
                    symbols.entry("market_entries".into()).or_default().insert(format!(
                        "{}/{}",
                        row.key,
                        string(entry, "good")
                    ));
                }
            }
            if matches!(row.table.as_str(), "goods" | "items") {
                symbols.entry("preferences".into()).or_default().insert(row.key.clone());
                for tag in array(&row.value, "tags").iter().filter_map(Value::as_str) {
                    symbols.entry("preferences".into()).or_default().insert(tag.into());
                }
            }
            if row.table == "discoveries" {
                symbols.entry("records".into()).or_default().insert(row.key.clone());
                if let Some(clue) = row.value.get("reward").and_then(|r| r.get("clue")).and_then(Value::as_str) {
                    symbols.entry("clues".into()).or_default().insert(clue.into());
                }
            }
        }
        // B10b 的显式跨包关系只在该关系端点上保留诊断，不把外部人物注入全局符号表。
        if world.contains("runtime_links.toml") {
            let text = world.read("runtime_links.toml")?;
            crate::convert::cast::validate_pending_text(&text).map_err(|e| invalid("runtime_links.toml", e))?;
            let links: Value = parse("runtime_links.toml", &text)?;
            for entry in array(&links, "pending_ties").iter().filter(|e| string(e, "requires") == "C11") {
                let key = string(entry, "key");
                let row = rows
                    .iter()
                    .find(|r| r.table == "ties" && r.key == key)
                    .ok_or_else(|| invalid("runtime_links.toml", "外部关系不存在"))?;
                let missing = [string(&row.value, "a"), string(&row.value, "b")]
                    .into_iter()
                    .filter(|p| !symbols.get("persons").is_some_and(|s| s.contains(*p)))
                    .map(str::to_owned)
                    .collect::<BTreeSet<_>>();
                let declared = array(entry, "external_persons")
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect::<BTreeSet<_>>();
                if !world.manifest.draft
                    || missing.is_empty()
                    || missing != declared
                    || string(entry, "kind") != string(&row.value, "kind")
                    || row.value.get("open").and_then(Value::as_bool) == Some(true)
                {
                    return Err(invalid("runtime_links.toml", "跨包关系必须精确声明缺失人物且保持未开放"));
                }
                symbols.insert(format!("external_tie:{key}"), missing);
            }
        }
        for row in &rows {
            check_row(row, world, &symbols, &mut report)?;
            if matches!(
                row.table.as_str(),
                "ties"
                    | "skills"
                    | "academies"
                    | "upbringing_rules"
                    | "ratings"
                    | "activities"
                    | "crafts"
                    | "aspirations"
                    | "contests"
                    | "poem_lexicons"
                    | "endings"
                    | "vignettes"
                    | "exams"
                    | "outings"
                    | "festivals"
                    | "families"
                    | "paths"
                    | "excursions"
                    | "event_gates"
                    | "helper_levels"
                    | "completions"
            ) {
                check_author_references(row, &row.value, "", &symbols, &mut report)?;
            }
        }
        let recipes: BTreeMap<_, _> =
            rows.iter().filter(|r| r.table == "recipes").map(|r| (r.key.as_str(), r)).collect();
        for workshop in rows.iter().filter(|r| r.table == "workshops") {
            let loc = string(&workshop.value, "loc");
            if let Some(recipe) = recipes.get(string(&workshop.value, "recipe"))
                && symbols.get("locations").is_some_and(|s| s.contains(loc))
            {
                for field in ["inputs", "outputs"] {
                    for entry in array(&recipe.value, field) {
                        reference(
                            workshop,
                            &format!("market.{field}"),
                            "market_entries",
                            &format!("{loc}/{}", string(entry, "good")),
                            &symbols,
                            &mut report,
                        )?;
                    }
                }
            }
        }
        report.files.sort();
        report.unresolved.sort();
        report.unresolved.dedup();
        Ok(report)
    }

    /// 无地图草稿仍校验原生日期和费用，不能因迁移到运行时结构而丢掉作者格式的拒绝边界。
    fn check_native_bounds(
        value: &Value,
        path: &str,
        file: &str,
        calendar: &manifest_core::calendar::Calendar,
    ) -> Result<(), WorldError> {
        match value {
            Value::Table(fields) => {
                for (key, child) in fields {
                    let next = format!("{path}.{key}");
                    if (matches!(key.as_str(), "date" | "born" | "academy_from" | "graduate")
                        || matches!(key.as_str(), "from" | "to") && child.as_array().is_some_and(|a| a.len() == 3))
                        && child.is_array()
                        && date(child, calendar, false).is_none()
                    {
                        return Err(invalid(file, format!("{next}: date 不在世界日历中")));
                    }
                    if key == "cost" && child.as_integer().is_some_and(|n| !(0..=1_000_000).contains(&n)) {
                        return Err(invalid(file, format!("{next}: cost 越界")));
                    }
                    check_native_bounds(child, &next, file, calendar)?;
                }
            }
            Value::Array(entries) => {
                for (index, child) in entries.iter().enumerate() {
                    check_native_bounds(child, &format!("{path}[{index}]"), file, calendar)?;
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn string<'a>(value: &'a Value, field: &str) -> &'a str {
        value.get(field).and_then(Value::as_str).unwrap_or_default()
    }
    fn array<'a>(value: &'a Value, field: &str) -> &'a [Value] {
        value.get(field).and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
    }

    fn register_course_key(row: &Row, key: &str, keys: &mut BTreeSet<(String, String)>) -> Result<(), WorldError> {
        if !keys.insert(("activities".into(), key.into())) {
            return Err(WorldError::DuplicateKey { file: row.file.clone(), key: key.into() });
        }
        Ok(())
    }

    fn reference(
        row: &Row,
        field: &str,
        table: &str,
        key: &str,
        symbols: &BTreeMap<String, BTreeSet<String>>,
        report: &mut DraftValidation,
    ) -> Result<(), WorldError> {
        if symbols.get(table).is_some_and(|keys| keys.contains(key)) {
            report.resolved_references += 1;
        } else {
            if symbols.contains_key("events") && field.starts_with("fate.") {
                return Err(invalid(&row.file, format!("{}.{} 引用了不存在的 {table}/{key}", row.key, field)));
            }
            let declared_external = row.table == "ties"
                && table == "persons"
                && matches!(field, "a" | "b")
                && symbols.get(&format!("external_tie:{}", row.key)).is_some_and(|s| s.contains(key));
            if !declared_external
                && matches!(
                    row.table.as_str(),
                    "persons"
                        | "past"
                        | "ties"
                        | "skills"
                        | "academies"
                        | "families"
                        | "paths"
                        | "completions"
                        | "helper_levels"
                        | "upbringing_rules"
                        | "ratings"
                        | "activities"
                        | "crafts"
                        | "aspirations"
                        | "contests"
                        | "poem_lexicons"
                        | "endings"
                        | "vignettes"
                        | "event_gates"
                        | "exams"
                        | "outings"
                        | "excursions"
                        | "festivals"
                )
                && !(row.table == "persons" && string(&row.value, "kind") == "historical")
                && matches!(
                    table,
                    "persons"
                        | "locations"
                        | "academies"
                        | "activities"
                        | "skills"
                        | "festivals"
                        | "items"
                        | "ratings"
                        | "places"
                        | "mentor_roles"
                )
            {
                return Err(invalid(&row.file, format!("{}.{} 引用了不存在的 {table}/{key}", row.key, field)));
            }
            // 已交付的封闭经济/物品表不能用“草稿”掩盖拼错的引用。
            // 地点、势力、人物及尚未交付的事件等仍在扩写，逐条列出待接线项。
            if symbols.contains_key(table)
                && matches!(
                    table,
                    "goods"
                        | "offstage_regions"
                        | "ships"
                        | "recipes"
                        | "industries"
                        | "items"
                        | "sets"
                        | "book_categories"
                        | "discoveries"
                        | "records"
                )
            {
                return Err(invalid(&row.file, format!("{}.{} 引用了不存在的 {table}/{key}", row.key, field)));
            }
            report.unresolved.push(DraftReference {
                table: table.into(),
                key: key.into(),
                file: row.file.clone(),
                item: row.key.clone(),
                field: field.into(),
            });
        }
        Ok(())
    }

    fn check_row(
        row: &Row,
        world: &EffectiveWorld,
        symbols: &BTreeMap<String, BTreeSet<String>>,
        report: &mut DraftValidation,
    ) -> Result<(), WorldError> {
        let value = &row.value;
        if super::history::is_native(&row.table) {
            for (field, table, key) in super::history::references(&row.table, &row.key, value) {
                if !symbols.get(table).is_some_and(|keys| keys.contains(&key)) {
                    return Err(invalid(&row.file, format!("{}.{} 引用了不存在的 {table}/{key}", row.key, field)));
                }
                report.resolved_references += 1;
            }
        }
        let fail = |message: &str| invalid(&row.file, format!("{}：{message}", row.key));
        let mut refs: Vec<(String, &str, String)> = Vec::new();
        let mut add = |field: &str, table: &'static str, key: &str| {
            if !key.is_empty() {
                refs.push((field.into(), table, key.into()));
            }
        };
        for (field, target) in [
            ("faction", "factions"),
            ("culture", "cultures"),
            ("realm", "realms"),
            ("discovery", "discoveries"),
            ("owner_hint", "persons"),
            ("made_by", "activities"),
            ("variant_of", "items"),
        ] {
            add(field, target, string(value, field));
        }
        if row.table == "offstage" {
            add("region", "offstage_regions", string(value, "region"));
        }
        if let Some(sources) = value.get("sources").and_then(Value::as_array)
            && sources.is_empty()
        {
            return Err(fail("出处列表不能为空"));
        }
        match row.table.as_str() {
            "companies" => {
                add("home", "ports", string(value, "home"));
                for ship in array(value, "ships") {
                    add("ships", "ships", ship.as_str().unwrap_or_default());
                }
                for good in array(value, "preferred") {
                    add("preferred", "goods", good.as_str().unwrap_or_default());
                }
            }
            "relations" => {
                add("a", "factions", string(value, "a"));
                add("b", "factions", string(value, "b"));
            }
            "recipes" => {
                add("industry", "industries", string(value, "industry"));
                for field in ["inputs", "outputs"] {
                    for entry in array(value, field) {
                        add(field, "goods", string(entry, "good"));
                    }
                }
            }
            "workshops" => {
                add("loc", "locations", string(value, "loc"));
                add("recipe", "recipes", string(value, "recipe"));
            }
            "ports" | "cities" => {
                if row.table == "ports" && string(value, "anchor_hint") == "river" && string(value, "river").is_empty()
                {
                    return Err(fail("河港必须填写 river"));
                }
                for entry in array(value, "market") {
                    add("market.good", "goods", string(entry, "good"));
                }
                for ship in array(value, "shipyard") {
                    add("shipyard", "ships", ship.as_str().unwrap_or_default());
                }
                if let Some(dormant) = value.get("dormant") {
                    add("dormant.by", "events", string(dormant, "by"));
                }
                if let Some(style) = value.get("style").and_then(Value::as_str)
                    && !world.manifest.art.styles.iter().any(|s| s == style)
                {
                    return Err(fail("style 未在世界 art.styles 声明"));
                }
            }
            "roads" => {
                if string(value, "from") == string(value, "to") {
                    return Err(fail("道路两端不能相同"));
                }
                add("from", "locations", string(value, "from"));
                add("to", "locations", string(value, "to"));
            }
            "discoveries" => {
                if let Some(requires) = value.get("requires") {
                    add("requires.history", "events", string(requires, "history"));
                    for key in array(requires, "records") {
                        add("requires.records", "records", key.as_str().unwrap_or_default());
                    }
                    if string(value, "kind") == "phantom"
                        && (string(requires, "mode") != "sight"
                            || value.get("reachable").and_then(Value::as_bool) != Some(false))
                    {
                        return Err(fail("幻岛只能目击，不能抵达"));
                    }
                }
                for entry in array(value, "moves") {
                    add("moves.location", "locations", string(entry, "location"));
                }
            }
            "items" => {
                if value.get("rarity").and_then(Value::as_integer).is_some_and(|n| n > 5) {
                    return Err(fail("稀有度必须为1至5"));
                }
                if string(value, "kind") == "book"
                    && ["work", "published", "read"].iter().any(|field| value.get(*field).is_none())
                {
                    return Err(fail("书必须有作品、出版与阅读信息"));
                }
                if array(value, "published").first().and_then(Value::as_integer).is_some_and(|year| year > 1590)
                    && string(value, "basis") != "extended"
                {
                    return Err(fail("1590年后的出版物必须标记 extended"));
                }
                if let Some(read) = value.get("read") {
                    add("read.lang", "skills", string(read, "lang"));
                    add("read.category", "book_categories", string(read, "category"));
                    for skill in array(read, "skills") {
                        add("read.skills", "skills", string(skill, "skill"));
                    }
                    if let Some(gains) = read.get("gains").and_then(Value::as_table) {
                        for key in gains.keys() {
                            add("read.gains", "attributes", key);
                        }
                    }
                    for key in array(read, "reveals") {
                        add("read.reveals", "clues", key.as_str().unwrap_or_default());
                    }
                }
                if let Some(shop) = value.get("shop") {
                    for key in array(shop, "cultures") {
                        add("shop.cultures", "cultures", key.as_str().unwrap_or_default());
                    }
                }
                if let Some(bonus) = value.get("bonus").and_then(Value::as_table) {
                    for key in bonus.keys() {
                        add("bonus", "attributes", key);
                    }
                }
                if let Some(chart) = value.get("chart") {
                    for key in array(chart, "regions") {
                        add("chart.regions", "regions", key.as_str().unwrap_or_default());
                    }
                }
            }
            "sets" => {
                let items = array(value, "items");
                if value.get("required").and_then(Value::as_integer).is_some_and(|n| n as usize > items.len()) {
                    return Err(fail("套装所需件数大于组成件数"));
                }
                if items.iter().filter_map(Value::as_str).collect::<BTreeSet<_>>().len() != items.len() {
                    return Err(fail("套装组成重复"));
                }
                for key in items {
                    add("items", "items", key.as_str().unwrap_or_default());
                }
            }
            "auctions" => {
                add("port", "ports", string(value, "port"));
                if value
                    .get("month")
                    .and_then(Value::as_integer)
                    .is_some_and(|n| n as usize > world.manifest.calendar.months().len())
                {
                    return Err(fail("拍卖月份不在世界日历中"));
                }
                for entry in array(value, "lots") {
                    add("lots.item", "items", string(entry, "item"));
                    if string(entry, "authenticity") == "fake" && string(entry, "fake_note").is_empty() {
                        return Err(fail("假拍品必须说明 fake_note"));
                    }
                }
                for entry in array(value, "specials") {
                    add("specials.item", "items", string(entry, "item"));
                }
                for entry in array(value, "bidders") {
                    add("bidders.person", "persons", string(entry, "person"));
                }
            }
            "mates" => {
                add("home", "locations", string(value, "home"));
            }
            "persons" => {
                for (field, target) in [
                    ("academy", "academies"),
                    ("family", "families"),
                    ("bond_track", "tracks"),
                    ("main_track", "tracks"),
                    ("npc_track", "tracks"),
                ] {
                    add(field, target, string(value, field));
                }
                let mut previous_end = None;
                let born = value.get("born").and_then(|v| date(v, &world.manifest.calendar, true));
                for (index, entry) in array(value, "schedule").iter().enumerate() {
                    let from = entry
                        .get("from")
                        .and_then(|v| date(v, &world.manifest.calendar, false))
                        .ok_or_else(|| fail("日程起始日期无效"))?;
                    let to = entry.get("to").and_then(|v| date(v, &world.manifest.calendar, false));
                    if to.is_some_and(|to| to < from)
                        || previous_end.is_some_and(|end| from <= end)
                        || (index > 0 && previous_end.is_none())
                        || born.is_some_and(|born| born[0] > 0 && from < born)
                    {
                        return Err(fail("日程倒置、重叠、未按日期排序或早于出生"));
                    }
                    previous_end = to;
                    add(&format!("schedule[{index}].at"), "locations", string(entry, "at"));
                }
                if let Some(reputation) =
                    value.get("audience").and_then(|a| a.get("reputation")).and_then(Value::as_table)
                {
                    for key in reputation.keys() {
                        add("audience.reputation", "factions", key);
                    }
                }
                for field in ["likes", "dislikes"] {
                    for key in array(value, field) {
                        add(field, "preferences", key.as_str().unwrap_or_default());
                    }
                }
                for key in array(value, "tracks") {
                    add("tracks", "tracks", key.as_str().unwrap_or_default());
                }
                for entry in array(value, "fate") {
                    add("fate.event", "events", string(entry, "event"));
                    if symbols.contains_key("events") {
                        add(
                            "fate.outcome",
                            "history_outcomes",
                            &format!("{}:{}", string(entry, "event"), string(entry, "outcome")),
                        );
                    }
                    if let Some(schedule) = entry.get("schedule") {
                        add("fate.schedule.at", "locations", string(schedule, "at"));
                    }
                }
            }
            _ => {}
        }
        for field in ["effects", "use", "bonus"] {
            for effect in array(value, field) {
                for (parameter, target) in [("activity", "activities"), ("culture", "cultures"), ("region", "regions")]
                {
                    add(&format!("{field}.{parameter}"), target, string(effect, parameter));
                }
            }
        }
        refs.extend(super::c12::references(&row.table, value));
        for (field, table, key) in refs {
            reference(row, &field, table, &key, symbols, report)?;
        }
        Ok(())
    }

    // 作者资料的嵌套引用也保留完整字段路径；角色槽名和事件通配池不冒充实体定义。
    fn check_author_references(
        row: &Row,
        value: &Value,
        path: &str,
        symbols: &BTreeMap<String, BTreeSet<String>>,
        report: &mut DraftValidation,
    ) -> Result<(), WorldError> {
        match value {
            Value::Table(fields) => {
                for (field, value) in fields {
                    let next = if path.is_empty() { field.clone() } else { format!("{path}.{field}") };
                    if row.table == "excursions"
                        && path.is_empty()
                        && field == "at"
                        && value.as_str() == Some("")
                        && row
                            .value
                            .get("where")
                            .is_some_and(|p| !array(p, "cultures").is_empty() || !array(p, "academies").is_empty())
                    {
                        // 动态远足由封闭的文化/学院绑定地点；空 at 不是一个地点 key。
                        continue;
                    }
                    let target = match field.as_str() {
                        "attr" => Some("attributes"),
                        "person" => Some("persons"),
                        "skill" | "companion_skill" => Some("skills"),
                        "item" => Some("items"),
                        "activity" => Some("activities"),
                        "academy" => Some("academies"),
                        "exam" | "exam_passed" => Some("exams"),
                        "contest" | "practice_contest" => Some("contests"),
                        "tie_ref" => Some("ties"),
                        "event" => Some("events"),
                        "rating" => Some("ratings"),
                        "festival" => Some("festivals"),
                        "promise_at" => Some("places"),
                        "lexicon" => Some("poem_lexicons"),
                        "where" => Some("locations"),
                        "at" | "home" | "loc" => Some("locations"),
                        "counts_as" => Some("activities"),
                        "mentor_role" => Some("mentor_roles"),
                        "rival" | "a" | "b" if row.table == "ties" || row.table == "academies" => Some("persons"),
                        "story" if row.table == "ties" => Some("tracks"),
                        "mentor" => Some(if value.as_str().is_some_and(|s| s.ends_with("_mentor")) {
                            "mentor_roles"
                        } else {
                            "persons"
                        }),
                        _ => None,
                    };
                    if let (Some(target), Some(key)) = (target, value.as_str()) {
                        reference(row, &next, target, key, symbols, report)?;
                    }
                    let array_target = match field.as_str() {
                        "activities" | "practice" | "remediation" => Some("activities"),
                        "classmates"
                        | "companions"
                        | "protagonists"
                        | "members"
                        | "mentors"
                        | "cast"
                        | "actors"
                        | "people"
                        | "no_promise_with_protagonist"
                        | "no_romance_with_others" => Some("persons"),
                        "tools" => Some("items"),
                        "templates" => Some("templates"),
                        "events" | "pools" => Some("events"),
                        "academies" => Some("academies"),
                        "exams" => Some("exams"),
                        "contests" => Some("contests"),
                        "ratings" => Some("ratings"),
                        "cultures" => Some("cultures"),
                        "links" if row.table == "outings" => Some("outings"),
                        _ => None,
                    };
                    if let (Some(target), Some(keys)) = (array_target, value.as_array()) {
                        for (index, key) in keys.iter().enumerate().filter_map(|(i, v)| v.as_str().map(|s| (i, s))) {
                            reference(row, &format!("{next}[{index}]"), target, key, symbols, report)?;
                        }
                    }
                    if field == "rating"
                        && let Some(key) = value.get("key").and_then(Value::as_str)
                    {
                        reference(row, &format!("{next}.key"), "ratings", key, symbols, report)?;
                    }
                    if field == "mentor_roles"
                        && let Some(roles) = value.as_table()
                    {
                        for (role, person) in roles {
                            if let Some(person) = person.as_str() {
                                reference(row, &format!("{next}.{role}"), "persons", person, symbols, report)?;
                            }
                        }
                    }
                    if let Some(values) = value.as_table() {
                        let map_target = match field.as_str() {
                            "items" => Some("items"),
                            "skills" => Some("skills"),
                            "companions" => Some("persons"),
                            "rating" if !values.contains_key("key") => Some("ratings"),
                            _ => None,
                        };
                        if let Some(target) = map_target {
                            for key in values.keys() {
                                reference(row, &format!("{next}.{key}"), target, key, symbols, report)?;
                            }
                        }
                    }
                    if matches!(field.as_str(), "gains" | "conduct" | "weights" | "attrs")
                        && let Some(attrs) = value.as_table()
                    {
                        for key in attrs.keys() {
                            reference(row, &format!("{next}.{key}"), "attributes", key, symbols, report)?;
                        }
                    }
                    check_author_references(row, value, &next, symbols, report)?;
                }
            }
            Value::Array(values) => {
                for (index, value) in values.iter().enumerate() {
                    check_author_references(row, value, &format!("{path}[{index}]"), symbols, report)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    #[cfg(test)]
    mod legend_person_tests {
        include!("worlds/legend_person_draft_tests.rs");
    }
    #[cfg(test)]
    mod reference_tests {
        include!("worlds/draft_reference_tests.rs");
    }

    #[cfg(test)]
    mod act_identity_tests {
        use super::*;

        #[test]
        fn native_act_row_identity_truth_table() {
            let root = crate::find_data_dir().expect("data/");
            let mut samples = toml::Table::new();
            let base = root.join("worlds/terra16");
            let manifest: Value = toml::from_str(&std::fs::read_to_string(base.join("world.toml")).expect("世界清单"))
                .expect("清单 TOML");
            // 与正式加载器共用清单，K1/K2/K3 的表分散在不同目录，不能只猜 act/。
            for file in manifest["tables"]["upbringing"].as_array().expect("养成分片清单") {
                let path = base.join(file.as_str().expect("分片路径"));
                let raw: toml::Table =
                    toml::from_str(&std::fs::read_to_string(path).expect("行动制分片")).expect("TOML");
                if raw.contains_key("format_version") {
                    for (table, entries) in raw {
                        if entries.as_array().is_some_and(|rows| !rows.is_empty()) {
                            samples.entry(table).or_insert(entries);
                        }
                    }
                }
            }
            let cases: &[(&str, &[(&str, bool)])] = &[
                ("lines", &[("key", true)]),
                ("act_places", &[("family", false), ("place", false)]),
                ("act_timetables", &[("family", true), ("stage", true), ("academy", false)]),
                ("act_duties", &[("key", true)]),
                ("act_greetings", &[]),
                ("act_markers", &[("track", false)]),
                ("act_line_gates", &[("line", true)]),
                ("act_medians", &[("family", true), ("attr", true)]),
                ("missions", &[("key", true)]),
                ("act_capital", &[("family", true), ("path", true), ("band", true)]),
                ("act_review", &[("family", true)]),
                ("act_tides", &[("port", true), ("key", true)]),
                ("act_rumors", &[("key", true)]),
                ("act_perks", &[("family", true), ("person", true), ("level", true)]),
                ("act_voyages", &[("key", true)]),
            ];
            for &(table, fields) in cases {
                let sample = samples[table].as_array().expect("表").first().expect("样例");
                for mask in 0..1 << fields.len() {
                    let mut entry = sample.as_table().expect("行").clone();
                    for &(field, required) in fields {
                        if !required {
                            entry.entry(field).or_insert_with(|| Value::String(String::new()));
                        }
                    }
                    for (bit, &(field, _)) in fields.iter().enumerate() {
                        if mask & (1 << bit) == 0 {
                            entry.remove(field);
                        }
                    }
                    let expected_ok =
                        fields.iter().enumerate().all(|(bit, (_, required))| !required || mask & (1 << bit) != 0);
                    let raw = toml::Table::from_iter([
                        ("format_version".into(), Value::Integer(1)),
                        (table.into(), Value::Array(vec![Value::Table(entry.clone())])),
                    ]);
                    let text = toml::to_string(&raw).expect("分片");
                    let result = runtime_schema("upbringing", "upbringing/act/truth.toml", &text);
                    let present: Vec<_> = fields
                        .iter()
                        .enumerate()
                        .map(|(bit, (field, _))| format!("{field}={}", mask & (1 << bit) != 0))
                        .collect();
                    println!("{table} {} schema={} expected={expected_ok}", present.join(" "), result.is_ok());
                    assert_eq!(result.is_ok(), expected_ok, "{table}: {result:?}");
                    if expected_ok {
                        let entry = Value::Table(entry);
                        let key = act_row_key(table, &entry, "truth.toml", 0)
                            .unwrap_or_else(|| string(&entry, "key").to_owned());
                        let expected = if table == "act_greetings" {
                            "truth.toml:0".to_owned()
                        } else {
                            fields
                                .iter()
                                .map(|(field, _)| match entry.get(*field) {
                                    Some(Value::Integer(n)) => n.to_string(),
                                    value => value.and_then(Value::as_str).unwrap_or_default().to_owned(),
                                })
                                .collect::<Vec<_>>()
                                .join("/")
                        };
                        assert_eq!(key, expected, "{table}");
                        if table == "act_greetings" {
                            assert_ne!(act_row_key(table, &entry, "truth.toml", 1), Some(key));
                        }
                    } else {
                        let error = result.expect_err("正式 schema 应拒绝缺必填字段").to_string();
                        assert!(
                            fields.iter().enumerate().any(|(bit, (field, required))| *required
                                && mask & (1 << bit) == 0
                                && error.contains(field)),
                            "{error}"
                        );
                    }
                }
            }
            // 完整草稿的剧情仍引用 FIX8 立绘目录；同一条真值表也核对这张辅助表的身份。
            let figures = std::fs::read_to_string(root.join("worlds/terra16/cast/figures.toml")).expect("立绘目录");
            let raw: toml::Table = toml::from_str(&figures).expect("立绘 TOML");
            for present in [false, true] {
                let mut row = raw["figures"].as_array().expect("立绘表")[0].as_table().expect("立绘行").clone();
                if !present {
                    row.remove("key");
                }
                let raw = toml::Table::from_iter([("figures".into(), Value::Array(vec![Value::Table(row)]))]);
                let text = toml::to_string(&raw).expect("立绘分片");
                let result = runtime_schema("figures", "cast/figures.toml", &text);
                println!("figures key={present} schema={} expected={present}", result.is_ok());
                assert_eq!(result.is_ok(), present, "{result:?}");
            }
        }
    }
}

/// 变体清单复用拍卖、道路与开局卡的显示白名单。
pub(crate) fn auxiliary_display(value: &toml::Value, file: &str) -> Result<toml::Table, WorldError> {
    match c12::display(value) {
        Some(display) => Ok(display),
        None => draft_display(value, file, false),
    }
}
