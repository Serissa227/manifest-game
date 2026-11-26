//! 原生时间线与思想的草稿符号表；不把港口配置当作新的地理地点。
use std::collections::{BTreeMap, BTreeSet};
use toml::Value;

type Symbols = BTreeMap<String, BTreeSet<String>>;
type Reference = (String, &'static str, String);

pub(super) fn namespace(group: &str, raw: &mut toml::Table) {
    for (from, to) in match group {
        "history" => &[("ports", "history_ports"), ("envoys", "history_envoys")][..],
        "ideas" => &[("ports", "idea_ports")][..],
        _ => &[],
    } {
        if let Some(value) = raw.remove(*from) {
            raw.insert((*to).into(), value);
        }
    }
}

pub(super) fn is_native(table: &str) -> bool {
    matches!(table, "events" | "campaigns" | "history_ports" | "history_envoys" | "ideas" | "idea_ports")
}

fn string<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or_default()
}
fn array<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
}

pub(super) fn symbols(table: &str, key: &str, v: &Value, symbols: &mut Symbols) {
    if table == "persons" {
        symbols.entry("people".into()).or_default().insert(key.into());
    }
    for (source, target) in match table {
        "events" => &[("outcomes", "history_outcomes"), ("levers", "history_levers")][..],
        "campaigns" => &[("vars", "history_vars")][..],
        _ => &[],
    } {
        for row in array(v, source) {
            symbols.entry((*target).into()).or_default().insert(format!("{key}:{}", string(row, "key")));
        }
    }
}

pub(super) fn references(table: &str, key: &str, value: &Value) -> Vec<Reference> {
    let mut refs = Vec::new();
    if table == "idea_ports" {
        refs.push(("key".into(), "ports", key.into()));
    }
    let campaign = if table == "campaigns" { key } else { string(value, "campaign") };
    walk(value, "", campaign, (table == "events").then_some(key), &mut refs);
    refs
}

fn walk(value: &Value, path: &str, campaign: &str, event: Option<&str>, refs: &mut Vec<Reference>) {
    match value {
        Value::Array(rows) => {
            for (i, row) in rows.iter().enumerate() {
                walk(row, &format!("{path}[{i}]"), campaign, event, refs);
            }
        }
        Value::Table(fields) => {
            let campaign = fields.get("campaign").and_then(Value::as_str).unwrap_or(campaign);
            let dependency = fields.get("event").and_then(Value::as_str);
            for (field, child) in fields {
                let next = format!("{path}.{field}");
                let target = match field.as_str() {
                    "port" | "loc" => Some("ports"),
                    "from" if string(value, "kind") != "diplomacy" => Some("ports"),
                    "faction" => Some("factions"),
                    "with" | "introducer" | "person" | "protector" => Some("persons"),
                    "trainer" => Some("people"),
                    "company" => Some("companies"),
                    "item" | "book" => Some("items"),
                    "idea" => Some("ideas"),
                    "event" | "ending_event" => Some("events"),
                    "campaign" => Some("campaigns"),
                    "language" | "skill" => Some("skills"),
                    "a" | "b" if string(value, "kind") == "diplomacy" => Some("factions"),
                    _ => None,
                };
                if let Some(target) = target
                    && let Some(key) = child.as_str()
                {
                    refs.push((next.clone(), target, key.into()));
                }
                if field == "var"
                    && !campaign.is_empty()
                    && let Some(var) = child.as_str()
                {
                    refs.push((next.clone(), "history_vars", format!("{campaign}:{var}")));
                }
                if field == "outcome"
                    && let Some(key) = child.as_str()
                    && let Some(parent) = dependency.or_else(|| (path == ".history").then_some(event).flatten())
                {
                    refs.push((next.clone(), "history_outcomes", format!("{parent}:{key}")));
                }
                if field == "train"
                    && let Some(key) = child.as_str()
                    && let Some(event) = event
                {
                    refs.push((next.clone(), "history_levers", format!("{event}:{key}")));
                }
                let map_target = match field.as_str() {
                    "goods" => Some("goods"),
                    "items" => Some("items"),
                    "shares" => Some("ideas"),
                    "reputation" => Some("factions"),
                    "contacts" => Some("persons"),
                    _ => None,
                };
                if let Some(target) = map_target
                    && let Some(map) = child.as_table()
                {
                    for key in map.keys() {
                        refs.push((next.clone(), target, key.clone()));
                    }
                }
                let list_target = match field.as_str() {
                    "goods" => Some("goods"),
                    "books" => Some("items"),
                    "rivals" | "forbidden" => Some("ideas"),
                    _ => None,
                };
                if let Some(target) = list_target
                    && let Some(list) = child.as_array()
                {
                    for key in list.iter().filter_map(Value::as_str) {
                        refs.push((next.clone(), target, key.into()));
                    }
                }
                walk(child, &next, campaign, event, refs);
            }
        }
        _ => {}
    }
}
