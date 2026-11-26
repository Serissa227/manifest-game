//! 新故事的两种显示覆盖写法归一为同一严格schema；任何玩法字段都拒绝。
use super::{Entry, FileSpec, Slot, entry, issue};
use crate::DataIssue;
use manifest_core::{
    StaticData,
    story2::{Branch, Effect},
};
use std::collections::{BTreeMap, BTreeSet};

/// 仅中文轨道可追加整章；已出现的章（包括空表）仍须完整翻译。
pub(super) fn untranslated_chapters(spec: &FileSpec, root: &super::Source<'_>) -> BTreeSet<String> {
    let mut optional = BTreeSet::new();
    let Some((_, chapters)) = spec.keyed.iter().find(|(key, _)| *key == "chapters") else { return optional };
    let Ok(text) = root.join(&spec.rel).read() else { return optional };
    let Ok(overlay) = toml::from_str::<toml::Value>(&text) else { return optional };
    for chapter in chapters {
        let Some((track, key)) = chapter.key.split_once(':') else { continue };
        if overlay
            .get("tracks")
            .and_then(|v| v.get(track))
            .and_then(|v| v.get("chapters"))
            .and_then(toml::Value::as_table)
            .is_some_and(|translated| !translated.is_empty() && !translated.contains_key(key))
        {
            optional.insert(chapter.key.clone());
        }
    }
    optional
}

#[derive(Clone, Copy, Debug)]
pub(super) enum BranchSlot {
    Default,
    Timeout,
    Choice(usize),
    Fail(usize),
}

pub(super) fn specs(defs: &StaticData, source: &str) -> FileSpec {
    specs_of(&defs.story2.tracks, source)
}
pub(super) fn specs_of(tracks: &[manifest_core::story2::TrackDef], source: &str) -> FileSpec {
    let mut tables: BTreeMap<&'static str, Vec<Entry>> = BTreeMap::new();
    for (ti, t) in tracks.iter().enumerate().filter(|(_, t)| t.source == source) {
        tables.entry("tracks").or_default().push(entry(&t.key, Slot::Track2(ti), &[("name", &t.name)]));
        for (ci, c) in t.chapters.iter().enumerate() {
            let key = format!("{}:{}", t.key, c.key);
            let mut fields = vec![("title", c.title.clone()), ("text", c.text.clone())];
            if let Some(hint) = &c.hint {
                fields.push(("hint", hint.clone()));
            }
            if let Some(news) = &c.news {
                fields.push(("news", news.clone()));
            }
            tables.entry("chapters").or_default().push(Entry {
                key: key.clone(),
                fields,
                slot: Slot::Chapter2(ti, ci),
            });
            for (i, v) in c.variants.iter().enumerate() {
                let fields = [("title", &v.title), ("text", &v.text)]
                    .into_iter()
                    .filter_map(|(k, v)| v.clone().map(|v| (k, v)))
                    .collect();
                tables.entry("variants").or_default().push(Entry {
                    key: format!("{key}:{}", v.key),
                    fields,
                    slot: Slot::Variant2(ti, ci, i),
                });
            }
            for (i, o) in c.objectives.iter().enumerate() {
                let fields = o.text.iter().map(|s| ("text", s.clone())).collect();
                tables.entry("objectives").or_default().push(Entry {
                    key: format!("{key}:{i}"),
                    fields,
                    slot: Slot::Objective2(ti, ci, i),
                });
            }
            for (oi, o) in c.choices.iter().enumerate() {
                let mut fields = vec![("text", o.text.clone())];
                if !o.reply.is_empty() {
                    fields.push(("reply", o.reply.clone()));
                }
                if let Some(h) = &o.hint {
                    fields.push(("hint", h.clone()));
                }
                if let Some(n) = &o.news {
                    fields.push(("news", n.clone()));
                }
                tables.entry("choices").or_default().push(Entry {
                    key: format!("{key}:{}", o.key),
                    fields,
                    slot: Slot::Choice2(ti, ci, oi),
                });
                effects(&mut tables, &format!("{key}:{}", o.key), ti, ci, BranchSlot::Choice(oi), &o.effects);
                if let Some(b) = &o.fail {
                    branch(&mut tables, "failures", &format!("{key}:{}", o.key), (ti, ci), BranchSlot::Fail(oi), b);
                }
            }
            if let Some(b) = &c.default {
                branch(&mut tables, "defaults", &key, (ti, ci), BranchSlot::Default, b);
            }
            if let Some(b) = &c.timeout {
                branch(&mut tables, "timeouts", &key, (ti, ci), BranchSlot::Timeout, b);
            }
        }
    }
    tables.into_iter().fold(FileSpec::new(source), |spec, (name, entries)| spec.table(name, entries))
}

fn branch(
    tables: &mut BTreeMap<&'static str, Vec<Entry>>,
    table: &'static str,
    key: &str,
    (ti, ci): (usize, usize),
    slot: BranchSlot,
    b: &Branch,
) {
    tables.entry(table).or_default().push(Entry {
        key: key.into(),
        fields: b.news.iter().map(|s| ("news", s.clone())).collect(),
        slot: Slot::Branch2(ti, ci, slot),
    });
    effects(
        tables,
        &format!(
            "{key}:{}",
            match slot {
                BranchSlot::Default => "default",
                BranchSlot::Timeout => "timeout",
                _ => "fail",
            }
        ),
        ti,
        ci,
        slot,
        &b.effects,
    );
}

fn effects(
    tables: &mut BTreeMap<&'static str, Vec<Entry>>,
    key: &str,
    ti: usize,
    ci: usize,
    branch: BranchSlot,
    list: &[Effect],
) {
    for (i, e) in list.iter().enumerate() {
        let fields = match e {
            Effect::Memory { title, .. } => vec![("title", title.clone())],
            Effect::Letter { text, .. } => vec![("text", text.clone())],
            Effect::World { title, text, .. } => vec![("title", title.clone()), ("text", text.clone())],
            _ => Vec::new(),
        };
        tables.entry("effects").or_default().push(Entry {
            key: format!("{key}:{i}"),
            fields,
            slot: Slot::Effect2(ti, ci, branch, i),
        });
    }
}

pub(super) fn apply(defs: &mut StaticData, slot: Slot, field: &str, value: String) {
    match slot {
        Slot::Variant2(t, c, v) => {
            let v = &mut defs.story2.tracks[t].chapters[c].variants[v];
            match field {
                "title" => v.title = Some(value),
                "text" => v.text = Some(value),
                _ => {}
            }
        }
        Slot::Objective2(t, c, i) => defs.story2.tracks[t].chapters[c].objectives[i].text = Some(value),
        Slot::Branch2(t, c, b) => {
            let c = &mut defs.story2.tracks[t].chapters[c];
            let branch = match b {
                BranchSlot::Default => c.default.as_mut(),
                BranchSlot::Timeout => c.timeout.as_mut(),
                BranchSlot::Fail(i) => c.choices[i].fail.as_mut(),
                BranchSlot::Choice(_) => None,
            };
            if let Some(b) = branch {
                b.news = Some(value);
            }
        }
        Slot::Effect2(t, c, b, i) => {
            let c = &mut defs.story2.tracks[t].chapters[c];
            let list = match b {
                BranchSlot::Default => c.default.as_mut().map(|b| &mut b.effects),
                BranchSlot::Timeout => c.timeout.as_mut().map(|b| &mut b.effects),
                BranchSlot::Fail(i) => c.choices[i].fail.as_mut().map(|b| &mut b.effects),
                BranchSlot::Choice(i) => Some(&mut c.choices[i].effects),
            };
            if let Some(e) = list.and_then(|v| v.get_mut(i)) {
                match (e, field) {
                    (Effect::Memory { title, .. } | Effect::World { title, .. }, "title") => *title = value,
                    (Effect::Letter { text, .. } | Effect::World { text, .. }, "text") => *text = value,
                    _ => {}
                }
            }
        }
        _ => {}
    }
}

/// C7作者使用嵌套表；旧的composite key写法继续接受，混写同一条则报告重复。
pub(super) fn normalize(table: &mut toml::Table, file: &str, issues: &mut Vec<DataIssue>) {
    let Some(mut tracks) = table.remove("tracks") else {
        return;
    };
    let Some(map) = tracks.as_table_mut() else {
        table.insert("tracks".into(), tracks);
        return;
    };
    for (tk, t) in map {
        let Some(t) = t.as_table_mut() else {
            continue;
        };
        let Some(chapters) = t.remove("chapters") else {
            continue;
        };
        let Some(chapters) = chapters.as_table() else {
            issue(issues, file, tk, "chapters应为按key的表");
            continue;
        };
        for (ck, c) in chapters {
            let key = format!("{tk}:{ck}");
            let Some(mut c) = c.as_table().cloned() else {
                issue(issues, file, &key, "章节覆盖应为表");
                continue;
            };
            if let Some(options) = c.remove("choices") {
                if let Some(options) = options.as_table() {
                    for (ok, o) in options {
                        let k = format!("{key}:{ok}");
                        let Some(mut o) = o.as_table().cloned() else {
                            issue(issues, file, &k, "选项覆盖应为表");
                            continue;
                        };
                        flatten_list(table, &mut o, "effects", "effects", &k, file, issues);
                        flatten_branch(table, &mut o, "fail", "failures", &k, file, issues);
                        insert(table, "choices", &k, o.into(), file, issues);
                    }
                } else {
                    issue(issues, file, &key, "choices应为按key的表");
                }
            }
            if let Some(variants) = c.remove("variants") {
                if let Some(variants) = variants.as_table() {
                    for (vk, v) in variants {
                        insert(table, "variants", &format!("{key}:{vk}"), v.clone(), file, issues);
                    }
                } else {
                    issue(issues, file, &key, "variants应为按key的表");
                }
            }
            flatten_list(table, &mut c, "objectives", "objectives", &key, file, issues);
            flatten_branch(table, &mut c, "default", "defaults", &key, file, issues);
            flatten_branch(table, &mut c, "timeout", "timeouts", &key, file, issues);
            insert(table, "chapters", &key, c.into(), file, issues);
        }
    }
    table.insert("tracks".into(), tracks);
}
fn insert(root: &mut toml::Table, table: &str, key: &str, v: toml::Value, file: &str, issues: &mut Vec<DataIssue>) {
    let t = root.entry(table.to_string()).or_insert_with(|| toml::Value::Table(toml::Table::new()));
    if let Some(t) = t.as_table_mut() {
        if t.insert(key.into(), v).is_some() {
            issue(issues, file, key, "覆盖条目重复");
        }
    } else {
        issue(issues, file, table, "覆盖集合应为表");
    }
}
fn flatten_list(
    root: &mut toml::Table,
    parent: &mut toml::Table,
    name: &str,
    table: &str,
    key: &str,
    file: &str,
    issues: &mut Vec<DataIssue>,
) {
    if let Some(values) = parent.remove(name) {
        if let Some(values) = values.as_array() {
            for (i, v) in values.iter().enumerate() {
                insert(root, table, &format!("{key}:{i}"), v.clone(), file, issues);
            }
        } else {
            issue(issues, file, key, format!("{name}应为保留下标的数组"));
        }
    }
}
fn flatten_branch(
    root: &mut toml::Table,
    parent: &mut toml::Table,
    name: &str,
    table: &str,
    key: &str,
    file: &str,
    issues: &mut Vec<DataIssue>,
) {
    if let Some(value) = parent.remove(name) {
        if let Some(mut b) = value.as_table().cloned() {
            flatten_list(root, &mut b, "effects", "effects", &format!("{key}:{name}"), file, issues);
            insert(root, table, key, b.into(), file, issues);
        } else {
            issue(issues, file, key, format!("{name}应为表"));
        }
    }
}
