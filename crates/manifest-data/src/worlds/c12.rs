//! C12海区与开局目录的作者schema、显示字段。导航与严格剧本另复用生产解析器。

use toml::{Table, Value};

pub(super) fn schema(name: &str) -> Option<&'static str> {
    Some(match name {
        "c12_regions_file" => {
            "schema_version:p bounds_arcmin:[i] boundary:=west_south_inclusive sources:{c12_source} regions:[regions] navigation:c12_navigation knowledge_groups:[knowledge_groups]"
        }
        "c12_source" => "name:s url:s status:s",
        "regions" => {
            "key:k name:s climate:=temperate|cold|arid|tropical music:k hidden:b sources:[k] storm_months:[p] fog_bp:[u] areas:[[i]]"
        }
        "knowledge_groups" => "key:k name:s regions:[k] clip_arcmin:[i]",
        "c12_navigation" => "projection:c12_projection regions:{c12_climate} frozen_ports:{[p]}",
        "c12_projection" => "kind:=equirect west:i north:i arcmin_per_cell:p lat_scale:b",
        "c12_climate" => "south:b frozen_months:[p] weather:[c12_weather]",
        "c12_weather" => "wind_dir:u wind_strength:u current_dir:u current_strength:u storm_bp:u pirate_bp:u",
        "opening_catalog" => {
            "key:k name:s kind:=protagonist|template|free scenario:k person?:k family_ref?:k academy_ref?:k classmates?:[k] main_track?:k born?:date options:c12_options card?:c12_card childhood?:c12_childhood voyage:c12_voyage"
        }
        "scenario_labels" => "key:k name:s name_en:s description:s",
        "c12_options" => "history_toggle:b skip_upbringing:b",
        "c12_card" => {
            "key:k name:s name_en?:s gender?:=f|m born?:date home:s region?:s tagline?:s style:s playstyle?:s tags?:[s] difficulty?:p strengths?:[k] start_ship?:s known:[s] academy?:c12_academy keepsake?:s portraits?:[c12_portrait] bonds?:[c12_bond] family?:s activities?:s"
        }
        "c12_academy" => "key:k name:s city:s",
        "c12_portrait" => "from_age:u asset:s",
        "c12_bond" => "person:k name:s kind:s",
        "c12_childhood" => "date:date cash:u ships:[s] crew:u known_regions:[k] family_ref:k",
        "c12_voyage" => {
            "date:date start_loc:k cash:u ships:[s] crew:u food:u water:u cargo:[c12_cargo] items:[c12_item] known_regions:[k] rumored_regions?:[k] mementos?:[c12_memento] source:k grant_once:k estate?:c12_estate caravan?:c12_caravan"
        }
        "c12_cargo" => "good:k qty:p",
        "c12_item" => "item:k qty:p",
        "c12_memento" => "key:k name:s kind:=story_keepsake transferable:b consumable:b description:s item?:k",
        "c12_estate" => "kind:k loc:k good:k level:p workers:p source:k grant_once:k",
        "c12_caravan" => "loc:k capacity:p guards:u cash:u cargo:[c12_cargo] source:k grant_once:k",
        _ => return None,
    })
}

fn selected(source: &Value, fields: &[&str]) -> Table {
    fields.iter().filter_map(|&field| source.get(field).cloned().map(|v| (field.into(), v))).collect()
}

/// 船型清单允许重复（两艘同型船），每一项仍走封闭引用校验。
pub(super) fn references(group: &str, row: &Value) -> Vec<(String, &'static str, String)> {
    let mut result = Vec::new();
    fn walk(value: &Value, path: &str, result: &mut Vec<(String, &'static str, String)>) {
        match value {
            Value::Table(fields) => {
                for (field, value) in fields {
                    let next = format!("{path}.{field}");
                    let target = match field.as_str() {
                        "scenario" => Some("scenarios"),
                        "person" => Some("persons"),
                        "family_ref" => Some("families"),
                        "academy_ref" => Some("academies"),
                        "main_track" => Some("tracks"),
                        "start_loc" | "loc" => Some("locations"),
                        "good" => Some("goods"),
                        "item" => Some("items"),
                        "ships" => Some("ships"),
                        "classmates" | "protagonists" => Some("persons"),
                        "regions" => Some("regions"),
                        "known_regions" | "rumored_regions" => Some("knowledge"),
                        _ => None,
                    };
                    if let Some(target) = target {
                        if let Some(key) = value.as_str() {
                            result.push((next.clone(), target, key.into()));
                        } else if let Some(keys) = value.as_array() {
                            for (i, key) in keys.iter().filter_map(Value::as_str).enumerate() {
                                result.push((format!("{next}[{i}]"), target, key.into()));
                            }
                        }
                    }
                    walk(value, &next, result);
                }
            }
            Value::Array(rows) => {
                for (i, row) in rows.iter().enumerate() {
                    walk(row, &format!("{path}[{i}]"), result);
                }
            }
            _ => {}
        }
    }
    if matches!(group, "opening_catalog" | "scenarios" | "knowledge_groups") {
        walk(row, "", &mut result);
    }
    result
}

fn keyed(rows: &Value, fields: &[&str]) -> Table {
    rows.as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| {
            row.get("key").and_then(Value::as_str).map(|key| (key.into(), Value::Table(selected(row, fields))))
        })
        .collect()
}

/// 只有本包明确列出的UI文字可翻译，来源/资产/引用/日期从不进入覆盖。
pub(crate) fn display(source: &Value) -> Option<Table> {
    if source.get("schema_version").is_some() && source.get("bounds_arcmin").is_some() {
        return Some(
            ["regions", "knowledge_groups"]
                .iter()
                .filter_map(|&group| source.get(group).map(|rows| (group.into(), Value::Table(keyed(rows, &["name"])))))
                .collect(),
        );
    }
    if let Some(rows) = source.get("opening_catalog").and_then(Value::as_array) {
        let mut entries = Table::new();
        for row in rows {
            let key = row.get("key")?.as_str()?;
            let mut entry = selected(row, &["name"]);
            if let Some(card) = row.get("card") {
                let mut text = selected(
                    card,
                    &[
                        "name",
                        "home",
                        "region",
                        "tagline",
                        "style",
                        "playstyle",
                        "tags",
                        "start_ship",
                        "known",
                        "keepsake",
                        "family",
                        "activities",
                    ],
                );
                if let Some(academy) = card.get("academy") {
                    text.insert("academy".into(), Value::Table(selected(academy, &["name", "city"])));
                }
                if let Some(bonds) = card.get("bonds").and_then(Value::as_array) {
                    text.insert(
                        "bonds".into(),
                        Value::Array(bonds.iter().map(|b| Value::Table(selected(b, &["name", "kind"]))).collect()),
                    );
                }
                entry.insert("card".into(), text.into());
            }
            if let Some(mementos) = row.get("voyage").and_then(|v| v.get("mementos")).and_then(Value::as_array) {
                entry.insert(
                    "voyage".into(),
                    Value::Table(Table::from_iter([(
                        "mementos".into(),
                        Value::Array(
                            mementos.iter().map(|m| Value::Table(selected(m, &["name", "description"]))).collect(),
                        ),
                    )])),
                );
            }
            entries.insert(key.into(), entry.into());
        }
        let mut result = Table::from_iter([("opening_catalog".into(), entries.into())]);
        if let Some(labels) = source.get("scenario_labels") {
            result.insert("scenario_labels".into(), keyed(labels, &["name", "description"]).into());
        }
        return Some(result);
    }
    if source.get("key").is_some() && source.get("start_date").is_some() {
        return Some(selected(source, &["name", "description"]));
    }
    None
}
