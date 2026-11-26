//! 草稿分片的显示字段检查。按逻辑表登记，译文只能覆盖确实存在的显示字段。
//! 数值 schema 由各模块接线后检查；这里不把草稿冒充可运行的 StaticData。

use super::Missing;
use crate::{DataIssue, worlds};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const TABLES: &[&str] = &[
    "items",
    "book_categories",
    "sets",
    "auctions",
    "goods",
    "recipes",
    "industries",
    "factions",
    "companies",
    "ships",
    "refits",
    "figures",
];
const FIELDS: &[&str] =
    &["name", "lore", "description", "persona", "title", "after_loss", "fake_note", "story_hook", "mood_lines"];

fn issue(issues: &mut Vec<DataIssue>, path: &Path, item: &str, message: impl Into<String>) {
    issues.push(DataIssue { file: path.display().to_string(), item: item.to_owned(), message: message.into() });
}

fn read(path: &Path, issues: &mut Vec<DataIssue>) -> Option<toml::Value> {
    match std::fs::read_to_string(path) {
        Ok(text) => match toml::from_str(&text) {
            Ok(value) => Some(value),
            Err(e) => {
                issue(issues, path, "", format!("TOML 格式错误：{e}"));
                None
            }
        },
        Err(e) => {
            issue(issues, path, "", format!("无法读取分片：{e}"));
            None
        }
    }
}

fn files(root: &Path, issues: &mut Vec<DataIssue>) -> Vec<(String, PathBuf, bool)> {
    match worlds::content_files_with_languages(root) {
        Ok(files) => files,
        Err(e) => {
            issue(issues, root, "草稿世界", e.to_string());
            Vec::new()
        }
    }
}

/// 对应原始表中的稳定 key；拍品与出价人的引用同样是稳定键，不使用数组下标。
fn display(value: &toml::Value, path: &Path, issues: &mut Vec<DataIssue>) -> toml::Value {
    let mut out = toml::Table::new();
    if let Some(table) = value.as_table() {
        for (field, value) in table {
            if FIELDS.contains(&field.as_str()) {
                let valid = value.as_str().is_some_and(|s| !s.trim().is_empty())
                    || (field == "mood_lines"
                        && value.as_array().is_some_and(|a| {
                            !a.is_empty() && a.iter().all(|v| v.as_str().is_some_and(|s| !s.trim().is_empty()))
                        }));
                if !valid {
                    issue(issues, path, field, "显示文字不能为空且必须是文字（mood_lines 为文字列表）");
                }
                out.insert(field.clone(), value.clone());
            } else if let Some(entries) = value.as_array() {
                let mut keyed = toml::Table::new();
                for entry in entries.iter().filter(|e| e.is_table()) {
                    let text = display(entry, path, issues);
                    if text.as_table().is_some_and(|t| t.is_empty()) {
                        continue;
                    }
                    let key = ["key", "item", "person"].iter().find_map(|k| entry.get(k).and_then(|v| v.as_str()));
                    if let Some(key) = key {
                        if keyed.insert(key.to_owned(), text).is_some() {
                            issue(issues, path, field, format!("重复的显示条目：{key}"));
                        }
                    } else {
                        issue(issues, path, field, "带显示文字的条目缺少稳定 key / item / person");
                    }
                }
                if !keyed.is_empty() {
                    out.insert(field.clone(), toml::Value::Table(keyed));
                }
            }
        }
    }
    toml::Value::Table(out)
}

fn expected(value: &toml::Value, path: &Path, issues: &mut Vec<DataIssue>) -> Option<toml::Value> {
    if let Some(display) = worlds::c12::display(value) {
        return Some(toml::Value::Table(display));
    }
    let table = value.as_table()?;
    // rules.toml 的 [ships] 是规则表，不是船型条目数组。
    if !table.iter().any(|(k, v)| TABLES.contains(&k.as_str()) && v.is_array()) {
        return None;
    }
    let selected: toml::Table = table
        .iter()
        .filter(|(k, v)| TABLES.contains(&k.as_str()) && v.is_array())
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    let mut text = display(&toml::Value::Table(selected), path, issues);
    // 商品类别的内部键是中文；沿用经典覆盖的 [categories] 形状。
    if let Some(goods) = value.get("goods").and_then(toml::Value::as_array) {
        let categories: toml::Table = goods
            .iter()
            .filter_map(|g| g.get("category").and_then(toml::Value::as_str))
            .map(|c| (c.to_owned(), toml::Value::String(c.to_owned())))
            .collect();
        if !categories.is_empty()
            && let Some(t) = text.as_table_mut()
        {
            t.insert("categories".into(), toml::Value::Table(categories));
        }
    }
    Some(text)
}

fn compare(
    expected: &toml::Value,
    actual: Option<&toml::Value>,
    file: &Path,
    item: &str,
    missing: &mut Vec<Missing>,
    issues: &mut Vec<DataIssue>,
) {
    if let Some(table) = expected.as_table() {
        if let Some(actual) = actual
            && !actual.is_table()
        {
            issue(issues, file, item, "覆盖必须是表");
        }
        let actual = actual.and_then(toml::Value::as_table);
        if let Some(actual) = actual {
            for key in actual.keys().filter(|k| !table.contains_key(*k)) {
                issue(issues, file, &format!("{item}.{key}"), "没有这一条目或字段不能覆盖");
            }
        }
        for (key, value) in table {
            let item = if item.is_empty() { key.clone() } else { format!("{item}.{key}") };
            compare(value, actual.and_then(|t| t.get(key)), file, &item, missing, issues);
        }
    } else if let Some(actual) = actual {
        if let Some(lines) = expected.as_array() {
            if let Some(rows) = actual.as_array().filter(|rows| rows.len() == lines.len()) {
                for (index, (expected, actual)) in lines.iter().zip(rows).enumerate() {
                    compare(expected, Some(actual), file, &format!("{item}[{index}]"), missing, issues);
                }
            } else {
                issue(issues, file, item, "译文列表类型及条数须与原文一致");
            }
        } else {
            let valid = expected.is_str() && actual.as_str().is_some_and(|s| !s.trim().is_empty());
            if !valid {
                issue(issues, file, item, "译文不能为空，且只能覆盖原文的显示字符串");
            }
        }
    } else {
        missing.push(Missing { file: file.to_string_lossy().replace('\\', "/"), item: item.to_owned() });
    }
}

fn overlay(path: &Path, rel: &str) -> PathBuf {
    let mut base = path.to_path_buf();
    for _ in Path::new(rel).components() {
        base.pop();
    }
    base.join("locales/en").join(rel)
}

pub(super) fn registered(root: &Path) -> Vec<String> {
    let mut issues = Vec::new();
    let mut names = BTreeSet::new();
    let mut sources = BTreeSet::new();
    // 登记清单包括成品世界的作者分片（只登记，不在这里检查）。
    let authored = worlds::author_files(root, false).unwrap_or_else(|e| {
        issue(&mut issues, root, "世界包", e.to_string());
        Vec::new()
    });
    for (rel, path, _) in authored {
        if let Some(raw) = read(&path, &mut issues)
            && expected(&raw, &path, &mut issues).is_some()
        {
            names.insert(rel);
            sources.insert(path);
        }
    }
    // 同一作者分片可通过 tables 登记成逻辑表；沿用实际解析映射，不能猜目录名。
    if let Ok(keys) = worlds::all_world_keys(root) {
        for key in keys {
            if let Ok(world) = worlds::resolve_world(root, &key) {
                names.extend(world.files.into_iter().filter_map(|(logical, file)| {
                    file.sources.iter().any(|path| sources.contains(path)).then_some(logical)
                }));
            }
        }
    }
    names.into_iter().collect()
}

pub(super) fn validate(root: &Path, missing: &mut Vec<Missing>, issues: &mut Vec<DataIssue>) {
    for (rel, path, requires_english) in files(root, issues) {
        let Some(raw) = read(&path, issues) else { continue };
        let Some(text) = expected(&raw, &path, issues) else { continue };
        let overlay = overlay(&path, &rel);
        if !requires_english {
            match overlay.try_exists() {
                Ok(false) => continue,
                Err(error) => {
                    issue(issues, &overlay, "", format!("无法检查英文分片：{error}"));
                    continue;
                }
                Ok(true) => {}
            }
        }
        let actual = if overlay.is_file() { read(&overlay, issues) } else { None };
        let rel = overlay.strip_prefix(root.canonicalize().unwrap_or_else(|_| root.to_path_buf())).unwrap_or(&overlay);
        compare(&text, actual.as_ref(), rel, "", missing, issues);
    }
    missing.sort();
}

/// 草稿编辑应刷新检查结果，但不进入经典世界的模拟哈希。
pub(super) fn fingerprint(root: &Path) -> String {
    let mut issues = Vec::new();
    let mut hash = blake3::Hasher::new();
    for (rel, path, requires_english) in files(root, &mut issues) {
        hash.update(&[u8::from(requires_english)]);
        for path in [path.clone(), overlay(&path, &rel)] {
            hash.update(path.to_string_lossy().as_bytes());
            if let Ok(text) = std::fs::read(&path) {
                hash.update(&text);
            }
            hash.update(&[0]);
        }
    }
    for issue in issues {
        hash.update(issue.to_string().as_bytes());
    }
    hash.finalize().to_hex().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn item_names_lore_and_categories_are_required_and_numbers_cannot_be_overridden() {
        let raw: toml::Value = toml::from_str(
            "[[items]]\nkey='book'\nname='书'\nlore='故事'\nprice=3\n[[book_categories]]\nkey='history'\nname='历史'\n",
        )
        .expect("原文");
        let en: toml::Value =
            toml::from_str("[items.book]\nname='Book'\nprice=9\n[book_categories.history]\nname='History'\n")
                .expect("译文");
        let mut issues = Vec::new();
        let mut missing = Vec::new();
        let spec = expected(&raw, Path::new("items/books.toml"), &mut issues).expect("登记");
        compare(&spec, Some(&en), Path::new("locales/en/items/books.toml"), "", &mut missing, &mut issues);
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0].item, "items.book.lore");
        assert_eq!(issues.len(), 1);
        assert!(issues[0].item.ends_with("price"));
    }

    #[test]
    fn unknown_keys_empty_names_and_missing_categories_remain_errors() {
        let raw: toml::Value = toml::from_str(
            "[[book_categories]]\nkey='history'\nname='历史'\n[[items]]\nkey='book'\nname='书'\nlore='故事'\n",
        )
        .expect("原文");
        let en: toml::Value =
            toml::from_str("[items.book]\nname=''\nlore='Story'\n[items.typo]\nname='Oops'\n").expect("译文");
        let mut issues = Vec::new();
        let mut missing = Vec::new();
        let spec = expected(&raw, Path::new("books.toml"), &mut issues).expect("登记");
        compare(&spec, Some(&en), Path::new("en.toml"), "", &mut missing, &mut issues);
        assert_eq!(issues.len(), 2);
        assert_eq!(missing[0].item, "book_categories.history.name");
    }

    #[test]
    fn classic_tables_and_nested_auction_text_use_their_logical_names() {
        let raw: toml::Value = toml::from_str("[[goods]]\nkey='tea'\nname='茶'\ndescription='货'\ncategory='饮品'\n[[auctions]]\nkey='sale'\nname='拍卖'\n[[auctions.lots]]\nitem='tea'\nafter_loss='追索'\n[[auctions.bidders]]\nperson='buyer'\nmood_lines=['等候','出价']\n").expect("原文");
        let mut issues = Vec::new();
        let spec = expected(&raw, Path::new("parts.toml"), &mut issues).expect("登记");
        assert_eq!(spec["goods"]["tea"]["name"].as_str(), Some("茶"));
        assert_eq!(spec["categories"]["饮品"].as_str(), Some("饮品"));
        assert_eq!(spec["auctions"]["sale"]["lots"]["tea"]["after_loss"].as_str(), Some("追索"));
        assert_eq!(spec["auctions"]["sale"]["bidders"]["buyer"]["mood_lines"].as_array().expect("台词").len(), 2);
        assert!(issues.is_empty());
    }

    #[test]
    fn c12_nested_display_lists_preserve_length_and_reject_gameplay_fields() {
        let raw: toml::Value = toml::from_str("[[opening_catalog]]\nkey='captain'\nname='船长'\n[opening_catalog.card]\nname='船长'\nbonds=[{person='friend',name='友',kind='盟友'}]\n[opening_catalog.voyage]\nmementos=[{key='ring',name='戒',description='念',transferable=false}]\n").expect("C12");
        let mut issues = Vec::new();
        let spec = expected(&raw, Path::new("scenarios/openings.toml"), &mut issues).expect("显示字段");
        let mut en = spec.clone();
        let mut missing = Vec::new();
        compare(&spec, Some(&en), Path::new("en.toml"), "", &mut missing, &mut issues);
        assert!(issues.is_empty() && missing.is_empty());
        en["opening_catalog"]["captain"]["voyage"]["mementos"][0]
            .as_table_mut()
            .expect("信物显示表")
            .insert("transferable".into(), true.into());
        compare(&spec, Some(&en), Path::new("en.toml"), "", &mut missing, &mut issues);
        assert_eq!(issues.len(), 1);
        assert!(issues[0].item.ends_with("transferable"));
        issues.clear();
        en = spec.clone();
        en["opening_catalog"]["captain"]["card"]["bonds"] = toml::Value::Array(vec![]);
        compare(&spec, Some(&en), Path::new("en.toml"), "", &mut missing, &mut issues);
        assert_eq!(issues.len(), 1);
        assert!(issues[0].message.contains("条数"));
    }
}
