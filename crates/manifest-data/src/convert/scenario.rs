//! 开局身份与已登记的公开名册卡；完整人物行为仍由人物模块转换。

use super::{Issues, parse, read};
use crate::worlds::EffectiveWorld;
use manifest_core::scenario::{ProtagonistDef, TemplateDef, WorldDate};
use serde::Deserialize;
use std::collections::BTreeSet;

#[derive(Deserialize)]
struct Templates {
    #[serde(default)]
    templates: Vec<TemplateDef>,
}

// 拍卖目录只有 key/name；必须先分类，再要求开局身份的生日与性别。
// 不能给显示投影虚构身份，也不能让显式主角的缺字段蒙混过去。
fn person_headers(text: &str) -> Result<Vec<ProtagonistDef>, String> {
    let source: toml::Table = toml::from_str(text).map_err(|e| e.to_string())?;
    let Some(persons) = source.get("persons") else { return Ok(Vec::new()) };
    let persons = persons.as_array().ok_or("persons 必须为数组")?;
    let mut result = Vec::new();
    for row in persons {
        let table = row.as_table().ok_or("人物必须为表")?;
        if let Some(kind) = table.get("kind") {
            let kind: manifest_core::cast::PersonKind =
                kind.clone().try_into().map_err(|e: toml::de::Error| e.to_string())?;
            if kind != manifest_core::cast::PersonKind::Protagonist {
                continue;
            }
        } else if table.keys().all(|k| ["key", "name"].contains(&k.as_str())) {
            continue;
        }
        result.push(row.clone().try_into().map_err(|e: toml::de::Error| e.to_string())?);
    }
    Ok(result)
}

pub(super) fn identities(dir: &EffectiveWorld, is: &mut Issues) -> (Vec<ProtagonistDef>, Vec<TemplateDef>) {
    let mut people = Vec::new();
    let mut templates = Vec::new();
    let sources = dir.cast_sources().unwrap_or_else(|e| {
        is.push("cast", "", e.to_string());
        Vec::new()
    });
    for (file, text) in sources {
        match person_headers(&text) {
            Ok(raw) => people.extend(raw),
            Err(error) => is.push(&file, "persons", format!("人物身份格式错误：{error}")),
        }
    }
    // upbringing/ 是后续养成模块的集合；这里只消费明确定名的模板表。
    for file in dir
        .files_in("upbringing")
        .into_iter()
        .filter(|f| f == "upbringing/templates.toml" || f.starts_with("upbringing/templates/"))
    {
        if let Some(text) = read(dir, &file, is)
            && let Some(raw) = parse::<Templates>(&file, &text, is)
        {
            templates.extend(raw.templates);
        }
    }
    for (kind, entries) in [
        ("cast", people.iter().map(|p| (p.key.as_str(), p.born)).collect::<Vec<_>>()),
        ("upbringing/templates", templates.iter().map(|t| (t.key.as_str(), t.born)).collect()),
    ] {
        let mut seen = BTreeSet::new();
        for (key, born) in entries {
            if key.is_empty() || !seen.insert(key) {
                is.push(kind, key, "身份 key 为空或重复");
            }
            if let Err(e) = dir.manifest.calendar.day_of(manifest_core::calendar::Date {
                year: born[0],
                month: born[1],
                day: born[2],
            }) {
                is.push(kind, key, format!("born 无效：{e}"));
            }
        }
    }
    opening_cards(dir, &mut people, &mut templates, is);
    (people, templates)
}

fn opening_cards(dir: &EffectiveWorld, people: &mut [ProtagonistDef], templates: &mut [TemplateDef], is: &mut Issues) {
    let file = "opening_catalog.toml";
    if !dir.contains(file) {
        return;
    }
    let Some(text) = read(dir, file, is) else { return };
    let Some(value) = parse::<toml::Value>(file, &text, is) else { return };
    let mut seen = BTreeSet::new();
    for row in value.get("opening_catalog").and_then(toml::Value::as_array).into_iter().flatten() {
        let Some(raw) = row.get("card") else { continue };
        let key = row.get("key").and_then(toml::Value::as_str).unwrap_or_default();
        let card: manifest_core::scenario::OpeningCard = match raw.clone().try_into() {
            Ok(card) => card,
            Err(e) => {
                is.push(file, key, format!("开局卡格式错误：{e}"));
                continue;
            }
        };
        if card.key != key || !seen.insert(key) {
            is.push(file, key, "开局卡 key 不一致或重复");
            continue;
        }
        if let Some(p) = people.iter_mut().find(|p| p.key == key) {
            if card.born.is_some_and(|d| d != p.born) || card.gender.is_some_and(|g| g != p.gender) {
                is.push(file, key, "开局卡的出生日期或性别与人物身份不一致");
            }
            p.card = Some(card);
        } else if let Some(t) = templates.iter_mut().find(|t| t.key == key) {
            t.card = Some(card);
        } else {
            is.push(file, key, "开局卡没有对应的主角或模板身份");
        }
    }
}

pub(super) fn day_of(dir: &EffectiveWorld, start_year: i64, date: WorldDate, file: &str, is: &mut Issues) -> u32 {
    let year = i64::from(date[0]) - start_year + 1;
    let value = u32::try_from(year).ok().and_then(|year| {
        dir.manifest.calendar.day_of(manifest_core::calendar::Date { year, month: date[1], day: date[2] }).ok()
    });
    value.unwrap_or_else(|| {
        is.push(file, "start_date/control_date", "日期无效或早于 rules.world.start_year");
        0
    })
}

#[cfg(test)]
mod tests {
    use super::person_headers;
    #[test]
    fn auction_projections_do_not_become_protagonists_and_real_headers_stay_strict() {
        let input = "[[persons]]\nkey='auction'\nname='占位'\n[[persons]]\nkey='legacy'\nborn=[1540,1,1]\ngender='f'\n[[persons]]\nkey='hero'\nkind='protagonist'\nborn=[1541,1,1]\ngender='m'\n[[persons]]\nkey='npc'\nkind='story'\n";
        let headers = person_headers(input).expect("分类身份头");
        assert_eq!(headers.iter().map(|p| p.key.as_str()).collect::<Vec<_>>(), ["legacy", "hero"]);
        for invalid in [
            "[[persons]]\nkey='hero'\nkind='protagonist'\nname='占位'\n",
            "[[persons]]\nkey='hero'\nbrn=[1540,1,1]\ngender='f'\n",
            "[[persons]]\nkey='hero'\nkind='unknown'\n",
        ] {
            assert!(person_headers(invalid).is_err());
        }
    }
}
