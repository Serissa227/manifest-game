//! 拍卖的嵌套显示覆盖；只接受文字，预算、底价、真伪等不能被翻译改变。
use super::{Missing, Source, issue, read_table};
use crate::DataIssue;
use manifest_core::StaticData;
use serde::Deserialize;
use std::collections::BTreeMap;
#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct TextFile {
    auctions: BTreeMap<String, AuctionText>,
}
#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct AuctionText {
    name: Option<String>,
    lore: Option<String>,
    lots: BTreeMap<String, LotText>,
    bidders: BTreeMap<String, BidderText>,
    specials: BTreeMap<String, SpecialText>,
}
#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct LotText {
    after_loss: Option<String>,
    fake_note: Option<String>,
}
#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct BidderText {
    mood_lines: Option<Vec<String>>,
}
#[derive(Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct SpecialText {
    story_hook: Option<String>,
    after_loss: Option<String>,
}
fn text(
    target: &mut String,
    value: Option<String>,
    file: &str,
    key: &str,
    issues: &mut Vec<DataIssue>,
    missing: &mut Vec<Missing>,
) {
    match value {
        Some(s) if !s.trim().is_empty() && !s.chars().any(|c| c.is_control() && c != '\n') => *target = s,
        Some(_) => issue(issues, file, key, "显示文字不能为空或含控制字符"),
        None => missing.push(Missing { file: file.into(), item: key.into() }),
    }
}
pub(super) fn apply(
    root: &Source<'_>,
    prefix: &str,
    defs: &mut StaticData,
    issues: &mut Vec<DataIssue>,
    missing: &mut Vec<Missing>,
) {
    if defs.auctions.auctions.is_empty() {
        return;
    }
    let file = format!("{prefix}/auctions.toml");
    let path = root.join("auctions.toml");
    let mut overlay = if path.is_file() {
        let Some(table) = read_table(&path, &file, issues) else { return };
        match toml::Value::Table(table).try_into::<TextFile>() {
            Ok(t) => t,
            Err(e) => {
                issue(issues, &file, "auctions", e.to_string());
                return;
            }
        }
    } else {
        TextFile::default()
    };
    for a in &mut defs.auctions.auctions {
        let mut t = overlay.auctions.remove(&a.key).unwrap_or_default();
        text(&mut a.name, t.name, &file, &format!("auctions.{}.name", a.key), issues, missing);
        text(&mut a.lore, t.lore, &file, &format!("auctions.{}.lore", a.key), issues, missing);
        for l in &mut a.lots {
            let t = t.lots.remove(&l.item).unwrap_or_default();
            let key = format!("auctions.{}.lots.{}", a.key, l.item);
            text(&mut l.after_loss, t.after_loss, &file, &format!("{key}.after_loss"), issues, missing);
            match (&mut l.fake_note, t.fake_note) {
                (Some(target), value) => text(target, value, &file, &format!("{key}.fake_note"), issues, missing),
                (None, Some(_)) => issue(issues, &file, &key, "原数据没有 fake_note"),
                _ => {}
            }
        }
        for s in &mut a.specials {
            let t = t.specials.remove(&s.item).unwrap_or_default();
            let key = format!("auctions.{}.specials.{}", a.key, s.item);
            text(&mut s.story_hook, t.story_hook, &file, &format!("{key}.story_hook"), issues, missing);
            text(&mut s.after_loss, t.after_loss, &file, &format!("{key}.after_loss"), issues, missing);
        }
        for b in &mut a.bidders {
            let t = t.bidders.remove(&b.person).unwrap_or_default();
            let key = format!("auctions.{}.bidders.{}.mood_lines", a.key, b.person);
            match t.mood_lines {
                Some(lines) if lines.len() == b.mood_lines.len() && lines.iter().all(|s| !s.trim().is_empty()) => {
                    b.mood_lines = lines
                }
                Some(_) => issue(issues, &file, &key, "台词必须与原数据等长且每条非空"),
                None => missing.push(Missing { file: file.clone(), item: key }),
            }
        }
        for key in t.lots.keys().chain(t.bidders.keys()).chain(t.specials.keys()) {
            issue(issues, &file, key, "原拍卖数据没有此条目");
        }
    }
    for key in overlay.auctions.keys() {
        issue(issues, &file, key, "原数据没有此拍卖会");
    }
    // 航海士优先复用现有名字覆盖；独立人物仅提取显示名，不消费其行为字段。
    for (key, person) in &mut defs.auctions.people {
        if let Some(mate) = defs.mates.iter().find(|m| m.key == *key) {
            person.name = mate.name.clone();
        }
    }
    let path = root.join("persons.toml");
    let file = format!("{prefix}/persons.toml");
    if path.is_file()
        && let Some(table) = read_table(&path, &file, issues)
        && let Some(people) = table.get("persons").and_then(toml::Value::as_table)
    {
        for (key, t) in people {
            if let Some(p) = defs.auctions.people.get_mut(key) {
                text(
                    &mut p.name,
                    t.get("name").and_then(toml::Value::as_str).map(str::to_owned),
                    &file,
                    &format!("persons.{key}.name"),
                    issues,
                    missing,
                );
            } else {
                issue(issues, &file, key, "原数据没有此人物");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn auction_translation_cannot_change_numbers_truth_or_mood_positions() {
        let root = crate::find_data_dir().unwrap();
        let classic = crate::load_shared(&root).unwrap();
        let registered = crate::locale::data_files(&root, &classic);
        assert!(registered.contains(&"auctions.toml".to_owned()));
        assert!(registered.contains(&"persons.toml".to_owned()));
        let defs = crate::load_world(&root, "testbed").unwrap();
        let mut effective = crate::resolve_world(&root, "testbed").unwrap();
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("auctions.toml");
        effective.files.get_mut("locales/en/auctions.toml").unwrap().sources = vec![path.clone()];
        for text in [
            "[auctions.island_sale]\nbudget=100000",
            "[auctions.island_sale.lots.coin]\nauthenticity='genuine'",
            "[auctions.island_sale.bidders.auction_ada]\nmood_lines=['only one']",
            "[auctions.island_sale.lots.missing]\nafter_loss='Somewhere'",
        ] {
            std::fs::write(&path, text).unwrap();
            let mut localized = (*defs).clone();
            let mut issues = Vec::new();
            let mut missing = Vec::new();
            apply(
                &Source::world(&effective).join("locales/en"),
                "locales/en",
                &mut localized,
                &mut issues,
                &mut missing,
            );
            assert!(!issues.is_empty(), "{text}");
            assert_eq!(localized.auctions.auctions[0].bidders[0].budget, defs.auctions.auctions[0].bidders[0].budget);
            assert_eq!(
                localized.auctions.auctions[0].lots[1].authenticity,
                defs.auctions.auctions[0].lots[1].authenticity
            );
            assert_eq!(
                localized.auctions.auctions[0].bidders[0].mood_lines,
                defs.auctions.auctions[0].bidders[0].mood_lines
            );
        }
    }
}
