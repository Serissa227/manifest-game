//! 中文变体：同一份显示 schema 供清单、导入校验和运行时来源过滤使用。
use super::{FileSpec, Slot, Source, issue};
use crate::{AiContent, DataError, DataIssue, Locale, LocaleBundle, StaticData};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use toml::{Table, Value};

#[derive(Clone, Debug, Default)]
pub struct Coverage {
    pub entries: usize,
    pub chars: usize,
    pub stale: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct ExportEntry {
    pub id: String,
    pub file: String,
    pub table: String,
    pub key: String,
    pub field: String,
    pub index: Option<usize>,
    pub text: String,
    pub src: String,
    pub max_chars: Option<usize>,
    pub group: String,
    pub label: String,
    pub current: Option<String>,
    pub stale: bool,
}

#[derive(Serialize)]
pub struct Export {
    pub world: String,
    pub variant: String,
    pub entries: Vec<ExportEntry>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Import {
    pub world: String,
    pub variant: String,
    pub generator: String,
    pub entries: Vec<ImportEntry>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportEntry {
    pub id: String,
    pub src: String,
    pub text: String,
}

#[derive(Default, Serialize)]
pub struct ImportReport {
    pub written: usize,
    pub pruned: usize,
    pub rejected: Vec<Rejection>,
}

#[derive(Serialize)]
pub struct Rejection {
    pub id: String,
    pub reason: String,
}

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default, deny_unknown_fields)]
struct Overlay {
    generator: String,
    entries: BTreeMap<String, Stored>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Stored {
    src: String,
    text: String,
}

#[derive(Clone)]
enum Part {
    Key(String),
    Index(usize),
}

struct Field {
    entry: ExportEntry,
    path: Vec<Part>,
}

#[derive(Default)]
struct Catalogue {
    docs: BTreeMap<String, Value>,
    fields: BTreeMap<String, Field>,
}

/// 来源只按 UTF-8 原文算一次，带算法前缀，其他工具直接使用导出的值。
fn source_hash(text: &str) -> String {
    format!("blake3:{}", blake3::hash(text.as_bytes()).to_hex())
}

fn keys(parts: &[&str]) -> Vec<Part> {
    parts.iter().map(|s| Part::Key((*s).into())).collect()
}

fn set(value: &mut Value, path: &[Part], replacement: Value) {
    let Some((first, rest)) = path.split_first() else {
        *value = replacement;
        return;
    };
    match first {
        Part::Key(key) => {
            if let Some(table) = value.as_table_mut() {
                let child = table.entry(key.clone()).or_insert_with(|| Value::Table(Table::new()));
                set(child, rest, replacement);
            }
        }
        Part::Index(i) => {
            if let Some(child) = value.as_array_mut().and_then(|a| a.get_mut(*i)) {
                set(child, rest, replacement);
            }
        }
    }
}

impl Catalogue {
    fn document(&mut self, file: &str, value: Value) {
        self.walk(file, &value, &mut Vec::new());
        self.docs.insert(file.into(), value);
    }

    fn walk(&mut self, file: &str, value: &Value, path: &mut Vec<Part>) {
        match value {
            Value::String(text) => self.add(file, path.clone(), text, None, None),
            Value::Table(table) => {
                for (key, value) in table {
                    path.push(Part::Key(key.clone()));
                    self.walk(file, value, path);
                    path.pop();
                }
            }
            Value::Array(array) => {
                for (i, value) in array.iter().enumerate() {
                    path.push(Part::Index(i));
                    self.walk(file, value, path);
                    path.pop();
                }
            }
            _ => {}
        }
    }

    fn add(&mut self, file: &str, path: Vec<Part>, text: &str, slot: Option<Slot>, defs: Option<&StaticData>) {
        let names: Vec<_> = path
            .iter()
            .filter_map(|p| match p {
                Part::Key(s) => Some(s.as_str()),
                _ => None,
            })
            .collect();
        let (table, key, field) = match names.as_slice() {
            [field] => (String::new(), String::new(), (*field).to_owned()),
            [table, field] => ((*table).to_owned(), String::new(), (*field).to_owned()),
            [table, key, rest @ ..] => ((*table).to_owned(), (*key).to_owned(), rest.join(".")),
            [] => return,
        };
        let index = path
            .iter()
            .rev()
            .find_map(|p| match p {
                Part::Index(i) => Some(*i),
                _ => None,
            })
            .or_else(|| {
                if let Some(Slot::UpbringingNative(super::upbringing::native::NativeSlot::Act(slot))) = slot {
                    super::upbringing::act::list_index(slot)
                } else {
                    None
                }
            });
        // 路径本身编码成 JSON，字段含点、冒号或引号也不会碰撞；末项仍保留列表下标。
        let identity: Vec<Value> = path
            .iter()
            .map(|p| match p {
                Part::Key(s) => Value::String(s.clone()),
                Part::Index(i) => Value::Integer(*i as i64),
            })
            .collect();
        let id = serde_json::json!([file, identity, index]).to_string();
        let mut group = if !key.is_empty() {
            key.clone()
        } else if !table.is_empty() {
            table.clone()
        } else {
            file.into()
        };
        let mut label = group.clone();
        if let (Some(slot), Some(defs)) = (slot, defs) {
            let track = match slot {
                Slot::Track2(t) => Some((t, None)),
                Slot::Chapter2(t, c)
                | Slot::Choice2(t, c, _)
                | Slot::Variant2(t, c, _)
                | Slot::Objective2(t, c, _)
                | Slot::Branch2(t, c, _)
                | Slot::Effect2(t, c, _, _) => Some((t, Some(c))),
                _ => None,
            };
            if let Some((t, c)) = track {
                let t = &defs.story2.tracks[t];
                group.clone_from(&t.key);
                label = c.map_or_else(|| t.name.clone(), |c| format!("{} / {}", t.name, t.chapters[c].title));
            }
        }
        let max_chars = limit(slot, &field, file, defs);
        self.fields.insert(
            id.clone(),
            Field {
                entry: ExportEntry {
                    id,
                    file: file.into(),
                    table,
                    key,
                    field,
                    index,
                    text: text.into(),
                    src: source_hash(text),
                    max_chars,
                    group,
                    label,
                    current: None,
                    stale: false,
                },
                path,
            },
        );
    }

    fn spec(&mut self, spec: &FileSpec, defs: &StaticData) {
        let mut add = |path: Vec<Part>, field: &str, text: &str, slot: Slot| {
            let mut path = path;
            path.push(Part::Key(field.into()));
            let doc = self.docs.entry(spec.rel.clone()).or_insert_with(|| Value::Table(Table::new()));
            // 可选的空原文字段仍可导出；投影时不向旧覆盖器塞入空字符串。
            if !text.trim().is_empty() {
                set(doc, &path, Value::String(text.into()));
            }
            self.add(&spec.rel, path, text, Some(slot), Some(defs));
        };
        if let Some(entry) = &spec.top {
            for (field, text) in &entry.fields {
                add(Vec::new(), field, text, entry.slot);
            }
        }
        for (name, entry) in &spec.single {
            for (field, text) in &entry.fields {
                add(keys(&[name]), field, text, entry.slot);
            }
        }
        for (name, entries) in &spec.keyed {
            for entry in entries {
                for (field, text) in &entry.fields {
                    add(keys(&[name, &entry.key]), field, text, entry.slot);
                }
            }
        }
        for category in &spec.categories {
            let path = keys(&["categories", category]);
            set(
                self.docs.entry(spec.rel.clone()).or_insert_with(|| Value::Table(Table::new())),
                &path,
                Value::String(category.clone()),
            );
            self.add(&spec.rel, path, category, None, None);
        }
    }
}

fn limit(slot: Option<Slot>, field: &str, file: &str, defs: Option<&StaticData>) -> Option<usize> {
    use super::upbringing::{act::ActSlot, native::NativeSlot};
    match (slot, field) {
        (Some(Slot::Chapter2(..) | Slot::Variant2(..)), "title") => Some(100),
        (Some(Slot::Chapter2(..) | Slot::Variant2(..)), "text") => Some(4000),
        (Some(Slot::Chapter2(..)), "hint") => Some(120),
        (Some(Slot::Choice2(..) | Slot::Objective2(..)), "text") => Some(300),
        (Some(Slot::Choice2(..)), "reply") => Some(4000),
        (Some(Slot::Chapter2(..) | Slot::Choice2(..) | Slot::Branch2(..)), "news") => Some(1000),
        (Some(Slot::Effect2(t, c, branch, i)), _) => {
            let defs = defs?;
            let chapter = &defs.story2.tracks[t].chapters[c];
            let effects = match branch {
                super::story2::BranchSlot::Default => &chapter.default.as_ref()?.effects,
                super::story2::BranchSlot::Timeout => &chapter.timeout.as_ref()?.effects,
                super::story2::BranchSlot::Choice(choice) => &chapter.choices[choice].effects,
                super::story2::BranchSlot::Fail(choice) => &chapter.choices[choice].fail.as_ref()?.effects,
            };
            match (&effects[i], field) {
                (manifest_core::story2::Effect::Memory { .. }, "title") => Some(100),
                (manifest_core::story2::Effect::Letter { .. }, "text") => Some(1000),
                (manifest_core::story2::Effect::World { .. }, "title") => Some(defs.composed.max_title_chars),
                (manifest_core::story2::Effect::World { .. }, "text") => Some(defs.composed.max_text_chars),
                _ => None,
            }
        }
        (Some(Slot::UpbringingNative(NativeSlot::YouthName(_) | NativeSlot::CallYou(..))), _) => Some(20),
        (Some(Slot::UpbringingNative(NativeSlot::Act(ActSlot::Greeting(..)))), _) => Some(40),
        _ if file.starts_with("templates/") => match file.trim_start_matches("templates/").trim_end_matches(".toml") {
            "ripple" => Some(240),
            "persona" | "daily" => Some(200),
            "narration" | "letter" | "alt_chronicle" | "diary" => Some(1600),
            _ => None,
        },
        _ => None,
    }
}

fn catalogue(dir: &Source<'_>, defs: &StaticData, ai: &AiContent, issues: &mut Vec<DataIssue>) -> Catalogue {
    let mut out = Catalogue::default();
    for spec in super::specs(dir, defs, issues) {
        out.spec(&spec, defs);
    }
    for file in ["texts.toml", "world/roads.toml", "opening_catalog.toml", "auctions.toml"] {
        let path = dir.join(file);
        if !path.is_file() {
            continue;
        }
        let Some(raw) = super::read_table(&path, file, issues) else { continue };
        let value = if file == "texts.toml" {
            Some(Value::Table(raw))
        } else {
            match crate::worlds::auxiliary_display(&Value::Table(raw), file) {
                Ok(value) => Some(Value::Table(value)),
                Err(e) => {
                    issue(issues, file, "", e.to_string());
                    None
                }
            }
        };
        if let Some(value) = value {
            out.document(file, value);
        }
    }
    let templates = super::TemplateText::from_ai(ai);
    for (name, sections) in
        [("rumor", &templates.rumor), ("bargain", &templates.bargain), ("chronicle", &templates.chronicle)]
            .into_iter()
            .chain(templates.texts.iter().map(|(key, value)| (key.as_str(), value)))
    {
        let value = Value::Table(
            sections
                .iter()
                .map(|(key, lines)| (key.clone(), Value::Array(lines.iter().cloned().map(Value::String).collect())))
                .collect(),
        );
        out.document(&format!("templates/{name}.toml"), value);
    }
    let mut composed = Table::new();
    composed.insert(
        "sources".into(),
        Value::Array(templates.composed_sources.iter().cloned().map(Value::String).collect()),
    );
    composed.insert(
        "archetypes".into(),
        Value::Table(
            templates
                .composed
                .iter()
                .map(|(key, a)| {
                    (
                        key.clone(),
                        Value::Table(
                            [
                                ("titles".into(), Value::Array(a.titles.iter().cloned().map(Value::String).collect())),
                                (
                                    "narratives".into(),
                                    Value::Array(a.narratives.iter().cloned().map(Value::String).collect()),
                                ),
                            ]
                            .into_iter()
                            .collect(),
                        ),
                    )
                })
                .collect(),
        ),
    );
    out.document("templates/composed.toml", Value::Table(composed));
    for (kind, prompt) in &ai.prompts {
        if let Ok(value) = Value::try_from(prompt) {
            let file = format!("prompts/{}.toml", kind.key());
            // kind/version/预算是玩法元数据，只有两段提示词可改。
            out.add(&file, keys(&["system"]), &prompt.system, None, None);
            out.add(&file, keys(&["user"]), &prompt.user, None, None);
            out.docs.insert(file, value);
        }
    }
    if let Some(text) = dir.world_text() {
        match text {
            Ok(text) => out.document(
                "world.toml",
                Value::Table(
                    [
                        ("name".into(), Value::String(text.name)),
                        ("tagline".into(), Value::String(text.tagline)),
                        ("blurb".into(), Value::String(text.blurb)),
                    ]
                    .into_iter()
                    .collect(),
                ),
            ),
            Err(e) => issue(issues, "world.toml", "", e.to_string()),
        }
    }
    out
}

fn read_overlays(root: &Source<'_>, issues: &mut Vec<DataIssue>) -> BTreeMap<String, Overlay> {
    let mut out = BTreeMap::new();
    for file in root.files() {
        let path = root.join(&file);
        match path.read().and_then(|text| toml::from_str::<Overlay>(&text).map_err(|e| e.to_string())) {
            Ok(overlay) => {
                out.insert(file, overlay);
            }
            Err(message) => issue(issues, &file, "", message),
        }
    }
    out
}

fn text_error(entry: &ExportEntry, text: &str) -> Option<String> {
    if text.trim().is_empty() {
        return Some("empty".into());
    }
    if text.chars().any(|c| c.is_control() && c != '\n') {
        return Some("control_character".into());
    }
    if !entry.text.contains('\n') && text.contains('\n') {
        return Some("unexpected_newline".into());
    }
    if let Some(max) = entry.max_chars
        && text.chars().count() > max
    {
        return Some(format!("max_chars:{max}"));
    }
    if entry.file == "texts.toml" || entry.file.starts_with("templates/") || entry.file.starts_with("prompts/") {
        let allowed = crate::ai_content::placeholders(&entry.text);
        if let Some(key) = crate::ai_content::placeholders(text).into_iter().find(|key| !allowed.contains(key)) {
            return Some(format!("unknown_placeholder:{key}"));
        }
    }
    None
}

fn inspect(catalogue: &mut Catalogue, overlays: &BTreeMap<String, Overlay>, issues: &mut Vec<DataIssue>) -> Coverage {
    let mut coverage = Coverage::default();
    for (file, overlay) in overlays {
        for (id, stored) in &overlay.entries {
            let Some(field) = catalogue.fields.get_mut(id).filter(|field| field.entry.file == *file) else {
                issue(issues, file, id, "unknown_id");
                continue;
            };
            field.entry.current = Some(stored.text.clone());
            field.entry.stale = stored.src != field.entry.src;
            if field.entry.stale {
                coverage.stale += 1;
            }
            if let Some(error) = text_error(&field.entry, &stored.text) {
                issue(issues, file, id, error);
                continue;
            }
            if !field.entry.stale {
                coverage.entries += 1;
                coverage.chars += stored.text.chars().count();
            }
        }
    }
    coverage
}

/// 先逐字段过滤来源，再把齐全的中文底稿连有效改写投影给现有覆盖器。
/// 列表的缺项、过期项保留原文，下标与玩法数据都不变。
pub(super) fn load(
    dir: &Source<'_>,
    root: &Source<'_>,
    prefix: &str,
    defs: &Arc<StaticData>,
    ai: &AiContent,
    texts: super::Texts,
    issues: &mut Vec<DataIssue>,
) -> LocaleBundle {
    let mut catalogue = catalogue(dir, defs, ai, issues);
    let overlays = read_overlays(root, issues);
    let coverage = inspect(&mut catalogue, &overlays, issues);
    let mut changed = BTreeSet::new();
    for field in catalogue.fields.values() {
        if let Some(text) = &field.entry.current
            && !field.entry.stale
            && text_error(&field.entry, text).is_none()
            && let Some(doc) = catalogue.docs.get_mut(&field.entry.file)
        {
            set(doc, &field.path, Value::String(text.clone()));
            changed.insert(field.entry.file.clone());
        }
    }
    let mut files = BTreeMap::new();
    for file in changed {
        if let Some(doc) = catalogue.docs.get(&file) {
            match toml::to_string(doc) {
                Ok(text) => {
                    files.insert(file, text);
                }
                Err(e) => issue(issues, &file, "", e.to_string()),
            }
        }
    }
    let mut bundle =
        super::load_with(dir, &Source::memory(files), prefix, Locale::ZhCnGemini, defs, ai, texts, false, issues);
    bundle.variant_coverage = coverage;
    bundle
}

/// 导出只读取中文原文与已有变体；筛选按相对文件路径的子串匹配。
pub fn export_world(
    world: &crate::worlds::EffectiveWorld,
    defs: &StaticData,
    ai: &AiContent,
    files: &[String],
) -> Result<Export, DataError> {
    let dir = Source::world(world);
    let mut issues = Vec::new();
    let mut catalogue = catalogue(&dir, defs, ai, &mut issues);
    let overlays = read_overlays(&dir.join("locales/zh-gemini"), &mut issues);
    inspect(&mut catalogue, &overlays, &mut issues);
    if !issues.is_empty() {
        return Err(DataError { issues });
    }
    Ok(Export {
        world: world.manifest.key.clone(),
        variant: Locale::ZhCnGemini.code().into(),
        entries: catalogue
            .fields
            .into_values()
            .map(|field| field.entry)
            .filter(|entry| files.is_empty() || files.iter().any(|file| entry.file.contains(file)))
            .collect(),
    })
}

/// 合并写入当前世界包；不合规条目逐条拒绝，有效条目照写。
pub fn import_world(
    world: &crate::worlds::EffectiveWorld,
    defs: &StaticData,
    ai: &AiContent,
    input: Import,
    prune_stale: bool,
) -> Result<ImportReport, DataError> {
    let mut issues = Vec::new();
    if input.world != world.manifest.key || Locale::parse(&input.variant) != Some(Locale::ZhCnGemini) {
        issue(&mut issues, "import", "", "world_or_variant_mismatch");
        return Err(DataError { issues });
    }
    let dir = Source::world(world);
    let catalogue = catalogue(&dir, defs, ai, &mut issues);
    let mut overlays = read_overlays(&dir.join("locales/zh-gemini"), &mut issues);
    if !issues.is_empty() {
        return Err(DataError { issues });
    }
    let mut report = ImportReport::default();
    let mut changed = BTreeSet::new();
    if prune_stale {
        for (file, overlay) in &mut overlays {
            overlay.entries.retain(|id, stored| {
                let keep = catalogue.fields.get(id).is_some_and(|f| f.entry.file == *file && f.entry.src == stored.src);
                if !keep {
                    report.pruned += 1;
                    changed.insert(file.clone());
                }
                keep
            });
        }
    }
    let mut seen = BTreeSet::new();
    for entry in input.entries {
        let field = catalogue.fields.get(&entry.id);
        let error = if !seen.insert(entry.id.clone()) {
            Some("duplicate_id".into())
        } else if let Some(field) = field {
            if field.entry.src != entry.src {
                Some("source_mismatch".into())
            } else {
                text_error(&field.entry, &entry.text)
            }
        } else {
            Some("unknown_id".into())
        };
        if let Some(reason) = error {
            report.rejected.push(Rejection { id: entry.id, reason });
            continue;
        }
        if let Some(field) = field {
            let file = field.entry.file.clone();
            let overlay = overlays.entry(file.clone()).or_default();
            overlay.generator.clone_from(&input.generator);
            overlay.entries.insert(entry.id, Stored { src: entry.src, text: entry.text });
            changed.insert(file);
            report.written += 1;
        }
    }
    let base = if world.manifest.key == "classic" {
        world.data_root().to_path_buf()
    } else {
        world.data_root().join("worlds").join(&world.manifest.key)
    };
    for file in changed {
        let path = base.join("locales/zh-gemini").join(&file);
        let result = (|| -> Result<(), String> {
            let overlay = &overlays[&file];
            let body = toml::to_string(overlay).map_err(|e| e.to_string())?;
            let text = format!("# 第二套中文 zh-CN-x-gemini；由 locale-import 生成，请勿手改。\n{body}");
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&path, text.as_bytes()).map_err(|e| e.to_string())
        })();
        if let Err(error) = result {
            issue(&mut issues, &file, "", error);
        }
    }
    if issues.is_empty() { Ok(report) } else { Err(DataError { issues }) }
}

pub(crate) fn catalog_overlay(
    world: &crate::worlds::EffectiveWorld,
    mut text: crate::worlds::WorldText,
) -> Result<crate::worlds::WorldText, DataError> {
    let dir = Source::world(world).join("locales/zh-gemini");
    let path = dir.join("world.toml");
    if !path.is_file() {
        return Ok(text);
    }
    let mut catalogue = Catalogue::default();
    catalogue.document(
        "world.toml",
        Value::Table(
            [
                ("name".into(), Value::String(text.name.clone())),
                ("tagline".into(), Value::String(text.tagline.clone())),
                ("blurb".into(), Value::String(text.blurb.clone())),
            ]
            .into_iter()
            .collect(),
        ),
    );
    let mut issues = Vec::new();
    let overlay = path.read().and_then(|text| toml::from_str::<Overlay>(&text).map_err(|e| e.to_string()));
    if let Ok(overlay) = overlay {
        inspect(&mut catalogue, &BTreeMap::from([("world.toml".into(), overlay)]), &mut issues);
        for field in catalogue.fields.into_values() {
            if let Some(value) = &field.entry.current
                && !field.entry.stale
                && text_error(&field.entry, value).is_none()
            {
                match field.entry.field.as_str() {
                    "name" => text.name.clone_from(value),
                    "tagline" => text.tagline.clone_from(value),
                    "blurb" => text.blurb.clone_from(value),
                    _ => {}
                }
            }
        }
    } else if let Err(error) = overlay {
        issue(&mut issues, "world.toml", "", error);
    }
    if issues.is_empty() { Ok(text) } else { Err(DataError { issues }) }
}
