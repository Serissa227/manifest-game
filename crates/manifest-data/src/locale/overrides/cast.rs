//! 人物覆盖沿源文件登记；称呼和话题句组归一为稳定键，译文不能改人物关系或出生日期。
use super::{Entry, FileSpec, Slot, entry, issue};
use crate::DataIssue;
use manifest_core::StaticData;
use std::collections::BTreeSet;

pub(super) fn specs(defs: &StaticData) -> Vec<FileSpec> {
    let source = |s: &str| if s.is_empty() { "cast.toml".to_owned() } else { s.to_owned() };
    let mut files: BTreeSet<_> = defs
        .cast
        .persons
        .iter()
        .map(|p| source(&p.source))
        .chain(defs.cast.past.iter().map(|p| source(&p.source)))
        .chain(defs.cast.figures.iter().map(|f| source(&f.source)))
        .collect();
    files.insert("cast.toml".into());
    files
        .into_iter()
        .map(|file| {
            let mut persons = Vec::new();
            let mut names = Vec::new();
            let mut lines = Vec::new();
            // 旧版 cast.toml 是全目录覆盖；物理分片覆盖随后应用，可覆盖同一条目的旧式译文。
            for (i, p) in
                defs.cast.persons.iter().enumerate().filter(|(_, p)| file == "cast.toml" || source(&p.source) == file)
            {
                persons.push(entry(
                    &p.key,
                    Slot::Person(i),
                    &[
                        ("name", &p.name),
                        ("role", &p.role),
                        ("persona", &p.persona),
                        ("summary", &p.summary),
                        ("secret", &p.secret),
                        ("after", &p.after),
                    ],
                ));
                for (j, n) in p.names.iter().enumerate() {
                    names.push(entry(&format!("{}:{}", p.key, n.bond), Slot::PersonName(i, j), &[("text", &n.name)]));
                }
                for (j, (topic, texts)) in p.lines.iter().enumerate() {
                    for (k, line) in texts.iter().enumerate() {
                        lines.push(entry(
                            &format!("{}:{topic}:{k}", p.key),
                            Slot::PersonLine(i, j, k),
                            &[("text", line)],
                        ));
                    }
                }
            }
            let past: Vec<Entry> = defs
                .cast
                .past
                .iter()
                .enumerate()
                .filter(|(_, p)| file == "cast.toml" || source(&p.source) == file)
                .map(|(i, p)| entry(&p.key, Slot::Past(i), &[("name", &p.name), ("lore", &p.lore)]))
                .collect();
            let figures = defs
                .cast
                .figures
                .iter()
                .enumerate()
                .filter(|(_, f)| file == "cast.toml" || source(&f.source) == file)
                .map(|(i, f)| entry(&f.key, Slot::Figure(i), &[("name", &f.name)]))
                .collect();
            FileSpec::new(&file)
                .table("figures", figures)
                .table("persons", persons)
                .table("past", past)
                .table("names", names)
                .table("person_lines", lines)
        })
        .collect()
}

pub(super) fn normalize(table: &mut toml::Table, file: &str, issues: &mut Vec<DataIssue>) {
    let Some(mut persons) = table.remove("persons") else { return };
    if let Some(persons) = persons.as_table_mut() {
        for (key, value) in persons {
            let Some(person) = value.as_table_mut() else { continue };
            if let Some(names) = person.remove("names") {
                if let Some(names) = names.as_array() {
                    for name in names {
                        let Some(name) = name.as_table() else {
                            issue(issues, file, key, "names 条目必须为表");
                            continue;
                        };
                        if name.keys().any(|k| !["rank", "text", "bond", "name"].contains(&k.as_str()))
                            || (name.contains_key("rank") && name.contains_key("bond"))
                            || (name.contains_key("text") && name.contains_key("name"))
                        {
                            issue(issues, file, key, "names 只接受 rank/text 或 bond/name");
                            continue;
                        }
                        let Some(rank) = name.get("rank").or_else(|| name.get("bond")).and_then(toml::Value::as_str)
                        else {
                            issue(issues, file, key, "称呼缺少羁绊键");
                            continue;
                        };
                        if let Some(text) = name.get("text").or_else(|| name.get("name")) {
                            insert(table, "names", format!("{key}:{rank}"), text.clone(), file, issues);
                        } else {
                            issue(issues, file, key, "称呼缺少译文");
                        }
                    }
                } else {
                    issue(issues, file, key, "names 必须是列表");
                }
            }
            if let Some(lines) = person.remove("lines") {
                if let Some(lines) = lines.as_table() {
                    for (topic, value) in lines {
                        if let Some(lines) = value.as_array() {
                            for (i, line) in lines.iter().enumerate() {
                                insert(table, "person_lines", format!("{key}:{topic}:{i}"), line.clone(), file, issues);
                            }
                        } else {
                            insert(table, "person_lines", format!("{key}:{topic}:0"), value.clone(), file, issues);
                        }
                    }
                } else {
                    issue(issues, file, key, "lines 必须是话题表");
                }
            }
        }
    }
    table.insert("persons".into(), persons);
}

fn insert(
    table: &mut toml::Table,
    group: &str,
    key: String,
    value: toml::Value,
    file: &str,
    issues: &mut Vec<DataIssue>,
) {
    let target = table.entry(group).or_insert_with(|| toml::Value::Table(toml::Table::new()));
    let Some(target) = target.as_table_mut() else {
        issue(issues, file, group, "覆盖必须是表");
        return;
    };
    if target.insert(key.clone(), toml::Value::Table(toml::Table::from_iter([("text".into(), value)]))).is_some() {
        issue(issues, file, key, "重复的称呼 / 台词覆盖");
    }
}
