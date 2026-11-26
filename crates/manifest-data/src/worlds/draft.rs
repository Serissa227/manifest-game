//! 草稿只检查已经存在的内容，不要求地图、港口或可开局剧本齐备。

use super::{WorldError, files, invalid, parse};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

pub(super) fn validate(root: &Path, base: &Path) -> Result<(), WorldError> {
    let mut keys = BTreeSet::new();
    for path in files::scan(root, base)? {
        let text = files::read_text(&path)?;
        let value: toml::Value = parse(&path.display().to_string(), &text)?;
        if path.starts_with(base.join("locales")) || path == base.join("world.toml") {
            continue;
        }
        if let Some(tables) = value.as_table() {
            for (table, entries) in tables {
                if let Some(entries) = entries.as_array() {
                    for entry in entries {
                        if let Some(key) = entry.get("key").and_then(toml::Value::as_str) {
                            if key.is_empty() {
                                return Err(invalid(path.display().to_string(), "条目 key 不能为空"));
                            }
                            // 开局评价与养成评价是不同量纲的表，分别检查各自的 key。
                            let namespace = if path == base.join("captain.toml") {
                                format!("captain.{table}")
                            } else if path == base.join("legend_ships.toml") {
                                format!("legend_ships.{table}")
                            } else if path == base.join("ideas.toml") && table == "ports" {
                                "idea_ports".into()
                            } else {
                                table.clone()
                            };
                            if !keys.insert((namespace, key.to_owned())) {
                                return Err(WorldError::DuplicateKey {
                                    file: path.display().to_string(),
                                    key: key.to_owned(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

/// 返回草稿的物理文件，供 validate-data 的语言检查复用；路径由世界解析器检查。
pub fn content_files(root: &Path) -> Result<Vec<(String, PathBuf)>, WorldError> {
    Ok(content_files_with_languages(root)?.into_iter().map(|(rel, path, _)| (rel, path)).collect())
}

/// 各世界包（含成品世界）的作者分片的物理文件。
pub fn all_content_files(root: &Path) -> Result<Vec<(String, PathBuf)>, WorldError> {
    Ok(author_files(root, false)?.into_iter().map(|(rel, path, _)| (rel, path)).collect())
}

pub(crate) fn content_files_with_languages(root: &Path) -> Result<Vec<(String, PathBuf, bool)>, WorldError> {
    author_files(root, true)
}

/// 各世界包的作者分片（不含清单、导航导出与语言目录）；`drafts_only` 为假时连成品世界一起列出，
/// 供显示 schema 的登记清单使用（寰宇 2026-11-02 转为成品世界后，它的分片仍要登记）。分片的显示字段检查只对草稿做，
/// 成品世界的译文由正式的覆盖加载器检查。
pub(crate) fn author_files(root: &Path, drafts_only: bool) -> Result<Vec<(String, PathBuf, bool)>, WorldError> {
    let root = root.canonicalize().map_err(|source| WorldError::Io { path: root.to_owned(), source })?;
    let mut result = Vec::new();
    for key in files::world_keys(&root)? {
        // 只要草稿时先看本包清单上是不是草稿（draft 不随继承传下来）：成品世界不必整个解析
        // （2026-11-03 启动提速：经典的语言包每次加载都要过一遍这里，解析一遍寰宇就要好几秒）。
        if drafts_only && !files::declares_draft(&root, &key)? {
            continue;
        }
        let world = super::resolve_world(&root, &key)?;
        if world.manifest.draft || !drafts_only {
            let base = root.join("worlds").join(key);
            for path in files::scan(&root, &base)? {
                let rel = path.strip_prefix(&base).map_err(|_| WorldError::UnsafePath(path.display().to_string()))?;
                let rel = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/");
                // 导航导出仅含数值与引用键；港口/海区显示名仍由作者分片逐项检查。
                if !matches!(rel.as_str(), "world.toml" | "navigation.toml") && !rel.starts_with("locales/") {
                    result.push((rel, path, world.manifest.requires_english()));
                }
            }
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().expect("临时目录");
        std::fs::create_dir_all(tmp.path().join("worlds/draft/items")).expect("目录");
        std::fs::write(
            tmp.path().join("worlds/draft/world.toml"),
            "key='draft'\nname='草稿'\nmap='missing'\ndraft=true\nhidden=false\n",
        )
        .expect("清单");
        tmp
    }

    #[test]
    fn draft_needs_no_map_is_never_listed_and_cannot_load() {
        let tmp = fixture();
        let world = crate::resolve_world(tmp.path(), "draft").expect("草稿解析");
        assert!(world.map.is_none());
        assert!(!world.contains("world/map.txt"));
        assert!(matches!(crate::load_world(tmp.path(), "draft"), Err(WorldError::DraftWorld(_))));
        assert_eq!(crate::list_worlds(tmp.path()).expect("目录").len(), 1);
    }

    #[test]
    fn draft_still_rejects_bad_toml_and_duplicate_fragment_keys() {
        let tmp = fixture();
        let base = tmp.path().join("worlds/draft/items");
        std::fs::write(base.join("one.toml"), "[[items]]\nkey='same'\n").expect("分片");
        std::fs::write(base.join("two.toml"), "[[items]]\nkey='same'\n").expect("分片");
        assert!(matches!(crate::resolve_world(tmp.path(), "draft"), Err(WorldError::DuplicateKey { .. })));
        std::fs::write(base.join("two.toml"), "[").expect("坏分片");
        assert!(crate::resolve_world(tmp.path(), "draft").is_err());
    }

    #[test]
    fn draft_flag_does_not_make_an_inheriting_world_playable() {
        let tmp = fixture();
        std::fs::create_dir_all(tmp.path().join("worlds/child")).expect("目录");
        std::fs::write(tmp.path().join("worlds/child/world.toml"), "key='child'\nname='子世界'\ninherit='draft'\n")
            .expect("清单");
        assert!(matches!(crate::resolve_world(tmp.path(), "child"), Err(WorldError::DraftWorld(_))));
    }
}
