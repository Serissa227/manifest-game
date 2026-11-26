//! 仅接受作者显式登记的跨内容依赖；完整保留原关系，不改出生日期或年龄门禁。
use super::*;
use manifest_core::{cast::relations::Relation, geo::authored::PendingTie};
use serde::Deserialize;

const FILE: &str = "runtime_links.toml";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Links {
    pending_ties: Vec<Entry>,
    /// 故事分片已登记、但人物卡与关系还引用着别的内容包尚未交付的轨道；只在草稿里逐条登记。
    #[serde(default)]
    pending_tracks: Vec<TrackEntry>,
    /// 故事已在读、设置它的内容包还没交付的旗标；只在草稿里逐条登记，写明归属与理由。
    #[serde(default)]
    pending_flags: Vec<FlagEntry>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TrackEntry {
    requires: String,
    tracks: Vec<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FlagEntry {
    key: String,
    owner: String,
    reason: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    key: String,
    kind: Relation,
    requires: String,
    #[serde(default)]
    external_persons: Vec<String>,
}

pub(super) fn validate_text(text: &str) -> Result<(), String> {
    toml::from_str::<Links>(text).map(|_| ()).map_err(|e| e.to_string())
}

/// 显式登记的待交付轨道。只在草稿里有效；归属写明由哪个内容包交付，key 不得为空或重复。
/// 登记了却已经交付、或者没有任何人物与关系引用的 key，由 `link_tracks` 报错，清单不能悄悄过时。
pub(super) fn declared_tracks(dir: &EffectiveWorld, is: &mut Issues) -> BTreeSet<String> {
    let mut result = BTreeSet::new();
    if !dir.contains(FILE) {
        return result;
    }
    let Some(text) = read(dir, FILE, is) else { return result };
    let Some(links) = parse::<Links>(FILE, &text, is) else { return result };
    for entry in links.pending_tracks {
        if !dir.manifest.draft || entry.requires.trim().is_empty() || entry.tracks.is_empty() {
            is.push(FILE, "pending_tracks", "待交付轨道只能登记在草稿里，并写明由哪个内容包交付");
            continue;
        }
        for key in entry.tracks {
            if key.trim().is_empty() || !result.insert(key.clone()) {
                is.push(FILE, &key, "待交付轨道 key 为空或重复登记");
            }
        }
    }
    result
}

/// 显式登记的待交付旗标。只在草稿里有效；key、归属（哪个内容包、哪一章）与理由都不能空，key 不能重复。
/// 已有故事或引擎设置者、或没有任何故事读取的登记由故事图检查报错（`manifest_core::story2::graph`）。
pub(super) fn declared_flags(dir: &EffectiveWorld, is: &mut Issues) -> BTreeSet<String> {
    let mut result = BTreeSet::new();
    if !dir.contains(FILE) {
        return result;
    }
    let Some(text) = read(dir, FILE, is) else { return result };
    let Some(links) = parse::<Links>(FILE, &text, is) else { return result };
    for entry in links.pending_flags {
        if !dir.manifest.draft {
            is.push(FILE, &entry.key, "待交付旗标只能登记在草稿里，正式世界不认这张清单");
        } else if [&entry.key, &entry.owner, &entry.reason].iter().any(|s| s.trim().is_empty()) {
            is.push(FILE, &entry.key, "待交付旗标要写明 key、归属与理由");
        } else if !result.insert(entry.key.clone()) {
            is.push(FILE, &entry.key, "待交付旗标重复登记");
        }
    }
    result
}

pub(super) fn collect(dir: &EffectiveWorld, defs: &mut CastDefs, is: &mut Issues) -> Vec<PendingTie> {
    if !dir.contains(FILE) {
        return Vec::new();
    }
    let Some(text) = read(dir, FILE, is) else { return Vec::new() };
    let Some(links) = parse::<Links>(FILE, &text, is) else { return Vec::new() };
    let mut result = Vec::new();
    let mut seen = BTreeSet::new();
    for entry in links.pending_ties {
        let Some(meta) = defs.tie_metadata.iter().find(|m| m.key == entry.key) else {
            is.push(FILE, &entry.key, "待接线关系不存在");
            continue;
        };
        let Some(index) = defs.ties.iter().position(|t| t.a == meta.a && t.b == meta.b && t.kind == entry.kind) else {
            is.push(FILE, &entry.key, "待接线关系种类不匹配或重复登记");
            continue;
        };
        let tie = &defs.ties[index];
        let missing: BTreeSet<_> = [&tie.a, &tie.b].into_iter().filter(|k| defs.person(k).is_none()).cloned().collect();
        let declared: BTreeSet<_> = entry.external_persons.iter().cloned().collect();
        let reason_valid = match entry.requires.as_str() {
            "C11" => !missing.is_empty() && missing == declared && !tie.open,
            "A6_npc_narrative" => {
                declared.is_empty()
                    && missing.is_empty()
                    && !tie.open
                    && tie.kind.romantic()
                    && [&tie.a, &tie.b].iter().all(|key| {
                        defs.person(key)
                            .is_some_and(|p| p.age_on(tie.since).is_some_and(|age| age >= 18) && !p.lineage.is_empty())
                    })
            }
            _ => false,
        };
        if !dir.manifest.draft
            || !seen.insert(entry.key.clone())
            || !reason_valid
            || tie.a == tie.b
            || !valid_date(dir, tie.since)
            || tie.to.is_some_and(|to| !valid_date(dir, to) || to < tie.since)
        {
            is.push(FILE, &entry.key, "依赖必须是草稿中的未开放关系，并精确列出缺失人物或成年长生者叙事条件");
            continue;
        }
        result.push(PendingTie { key: entry.key, requires: entry.requires, tie: defs.ties.remove(index) });
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_flags_cover_only_undelivered_setters_and_only_in_drafts() {
        use manifest_core::story2::{Story2Defs, graph};
        // 一条读旗标的轨道；`set` 给出时，另一章的选项设置它。`variant` 时只由变体读。
        let defs = |flag: &str, set: bool, variant: bool| -> Story2Defs {
            let read = serde_json::json!([{ "kind": "flag", "flag": flag }]);
            let first = if variant {
                serde_json::json!({"key":"a","title":"一","text":"开始。","variants":[{"key":"v","when":read,"text":"揭开以后。"}],
                    "choices":[{"key":"go","text":"继续","next":"b"}]})
            } else {
                serde_json::json!({"key":"a","title":"一","text":"开始。","choices":[{"key":"go","text":"继续","next":"b","requires":read}]})
            };
            let effects =
                if set { serde_json::json!([{ "kind": "flag", "flag": flag }]) } else { serde_json::json!([]) };
            serde_json::from_value(serde_json::json!({"tracks":[
                {"key":"reader","name":"读","kind":"request","start":"a","chapters":[first,
                    {"key":"b","title":"二","text":"结束。","choices":[{"key":"end","text":"结束","next":"done"}]}]},
                {"key":"setter","name":"写","kind":"request","start":"s","chapters":[
                    {"key":"s","title":"三","text":"另一件事。","choices":[{"key":"end","text":"结束","next":"done","effects":effects}]}]}]}))
            .unwrap()
        };
        let errors = |d: &Story2Defs| graph::validate(d).join("\n");
        // 1. 没登记、也没有设置者：照旧是硬错误；登记以后不再报。
        let mut d = defs("noel_unveiled", false, false);
        assert!(errors(&d).contains("旗标没有来源：noel_unveiled"));
        d.pending_flags.insert("noel_unveiled".into());
        assert!(errors(&d).is_empty(), "{}", errors(&d));
        // 只由变体读也算有人读。
        let mut d = defs("noel_unveiled", false, true);
        d.pending_flags.insert("noel_unveiled".into());
        assert!(errors(&d).is_empty(), "{}", errors(&d));
        // 2. 登记了、可设置者已经交付：错误，提醒把登记删掉。
        let mut d = defs("noel_unveiled", true, false);
        assert!(errors(&d).is_empty());
        d.pending_flags.insert("noel_unveiled".into());
        assert!(errors(&d).contains("已有故事设置") && errors(&d).contains("noel_unveiled"));
        // 3. 登记了、却没有任何章节 / 选项 / 变体读：错误。
        let mut d = defs("noel_unveiled", false, false);
        d.pending_flags.extend(["noel_unveiled".to_string(), "nobody_reads".to_string()]);
        assert!(errors(&d).contains("没有任何章节、选项或变体读取：nobody_reads"));
        assert!(!errors(&d).contains("读取：noel_unveiled"));
        // 4. 只在草稿里有效：正式世界不认清单；归属与理由不能空，key 不能重复。
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join(FILE);
        let mut world = crate::resolve_world(&root, "classic").unwrap();
        world.files.insert(
            FILE.into(),
            crate::worlds::EffectiveFile { sources: vec![path.clone()], mode: crate::worlds::FileMode::Replace },
        );
        let entry = "{key='noel_unveiled',owner='C13 main_noel 第三章',reason='主线还没交付'}";
        for (draft, entries, accepted) in [
            (true, entry.to_string(), true),
            (false, entry.to_string(), false),
            (true, "{key='noel_unveiled',owner='',reason='主线还没交付'}".to_string(), false),
            (true, format!("{entry},{entry}"), false),
        ] {
            world.manifest.draft = draft;
            std::fs::write(&path, format!("pending_ties=[]\npending_flags=[{entries}]")).unwrap();
            let mut issues = Issues::default();
            let flags = declared_flags(&world, &mut issues);
            assert_eq!(issues.list.is_empty(), accepted, "{entries} {:?}", issues.list);
            assert_eq!(flags.contains("noel_unveiled"), draft && !entries.contains("owner=''"));
        }
    }

    #[test]
    fn explicit_pending_content_preserves_the_tie_and_rejects_inexact_or_published_declarations() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join(FILE);
        let mut world = crate::resolve_world(&root, "classic").unwrap();
        world.files.insert(
            FILE.into(),
            crate::worlds::EffectiveFile { sources: vec![path.clone()], mode: crate::worlds::FileMode::Replace },
        );
        let tie: manifest_core::cast::relations::TieDef =
            toml::from_str("a='a'\nb='b'\nkind='friends'\nsince=[1553,1,1]").unwrap();
        let original = CastDefs {
            ties: vec![tie.clone()],
            tie_metadata: vec![manifest_core::cast::metadata::TieMetadata {
                key: "pending".into(),
                a: "a".into(),
                b: "b".into(),
                note: "原说明".into(),
            }],
            ..Default::default()
        };
        for (draft, persons, accepted) in
            [(true, "['a','b']", true), (false, "['a','b']", false), (true, "['a']", false)]
        {
            world.manifest.draft = draft;
            std::fs::write(
                &path,
                format!("pending_ties=[{{key='pending',kind='friends',requires='C11',external_persons={persons}}}]"),
            )
            .unwrap();
            let mut defs = original.clone();
            let mut issues = Issues::default();
            let pending = collect(&world, &mut defs, &mut issues);
            assert_eq!(issues.list.is_empty(), accepted);
            assert_eq!(pending.len(), usize::from(accepted));
            assert_eq!(defs.tie_metadata, original.tie_metadata);
            if accepted {
                assert_eq!(pending[0].tie, tie);
                assert!(defs.ties.is_empty());
            } else {
                assert_eq!(defs.ties, original.ties);
            }
        }
    }
}
