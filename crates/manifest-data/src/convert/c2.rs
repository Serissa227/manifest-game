//! C2 作者表先逐字段校验，再投影/转换；经典 pos 格式完全走原加载路径。
use super::{Issues, load_file, load_optional, parse, read};
use crate::worlds::EffectiveWorld;
use manifest_core::{Cell, geo::authored::*};
use serde::de::DeserializeOwned;
use std::collections::BTreeMap;
use toml::{Table, Value};

#[derive(Default)]
pub(super) struct Prepared {
    pub enabled: bool,
    files: BTreeMap<&'static str, String>,
    pub authored: AuthoredPlaces,
    pub road_keys: Vec<String>,
    site_text: BTreeMap<String, (String, String)>,
}

pub(super) fn file<T: DeserializeOwned>(
    dir: &EffectiveWorld,
    prepared: &Prepared,
    file: &str,
    is: &mut Issues,
) -> Option<T> {
    if let Some(text) = prepared.files.get(file) { parse(file, text, is) } else { load_file(dir, file, is) }
}
pub(super) fn optional_file<T: DeserializeOwned + Default>(
    dir: &EffectiveWorld,
    prepared: &Prepared,
    file: &str,
    is: &mut Issues,
) -> Option<T> {
    if let Some(text) = prepared.files.get(file) { parse(file, text, is) } else { load_optional(dir, file, is) }
}

fn text(v: &Value, key: &str) -> String {
    v.get(key).and_then(Value::as_str).unwrap_or_default().into()
}
fn string(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(str::to_owned)
}
fn number(v: &Value) -> Option<f64> {
    v.as_float().or_else(|| v.as_integer().map(|n| n as f64))
}
fn integer(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(Value::as_integer).unwrap_or(0)
}
fn flag(v: &Value, key: &str, default: bool) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(default)
}
fn strings(v: &Value, key: &str) -> Vec<String> {
    v.get(key).and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str).map(str::to_owned).collect()
}
fn lonlat(v: &Value) -> [f64; 2] {
    let a = v.get("lonlat").and_then(Value::as_array);
    [
        a.and_then(|a| a.first()).and_then(number).unwrap_or(0.0),
        a.and_then(|a| a.get(1)).and_then(number).unwrap_or(0.0),
    ]
}
fn e5(v: &Value) -> [i64; 2] {
    lonlat(v).map(|n| (n * 100_000.0).round() as i64)
}
fn provenance(v: &Value) -> Provenance {
    Provenance { basis: text(v, "basis"), sources: strings(v, "sources"), lonlat_e5: v.get("lonlat").map(|_| e5(v)) }
}
fn rows(dir: &EffectiveWorld, file: &str, table: &str, is: &mut Issues) -> Vec<Value> {
    let Some(source) = read(dir, file, is) else { return Vec::new() };
    let Some(value) = parse::<Table>(file, &source, is) else { return Vec::new() };
    if value.len() != 1 || !value.contains_key(table) {
        is.push(file, table, "作者文件必须只含已声明的条目表");
        return Vec::new();
    }
    let Some(array) = value.get(table).and_then(Value::as_array) else {
        is.push(file, table, "缺少作者数组");
        return Vec::new();
    };
    let mut result = Vec::new();
    for row in array {
        if let Err(error) = crate::worlds::validate_author_row(dir, file, table, row) {
            is.push(file, text(row, "key"), error.to_string());
        } else if !fits_runtime(row) {
            is.push(file, text(row, "key"), "半径、日数或年份超出运行态整数范围");
        } else {
            result.push(row.clone());
        }
    }
    super::check_keys(
        file,
        table,
        result
            .iter()
            .map(|v| (v["key"].as_str().unwrap_or_default(), v.get("name").and_then(Value::as_str).unwrap_or("道路"))),
        is,
    );
    result
}
fn fits_runtime(value: &Value) -> bool {
    match value {
        Value::Table(table) => table.iter().all(|(key, value)| {
            let limit = match key.as_str() {
                "radius" => Some(i64::from(u16::MAX)),
                "days" | "from_year" | "until" => Some(i64::from(u32::MAX)),
                _ => None,
            };
            limit.is_none_or(|limit| value.as_integer().is_none_or(|n| (0..=limit).contains(&n))) && fits_runtime(value)
        }),
        Value::Array(values) => values.iter().all(fits_runtime),
        _ => true,
    }
}
fn put(p: &mut Prepared, file: &'static str, table: &str, rows: Vec<Value>, is: &mut Issues) {
    let value = Table::from_iter([(table.into(), Value::Array(rows))]);
    match toml::to_string(&value) {
        Ok(text) => {
            p.files.insert(file, text);
        }
        Err(error) => is.push(file, table, error.to_string()),
    }
}
fn pos(cell: Cell) -> Value {
    Value::Array(vec![Value::Integer(i64::from(cell.x)), Value::Integer(i64::from(cell.y))])
}

pub(super) fn prepare(dir: &EffectiveWorld, is: &mut Issues) -> Prepared {
    let mut out = Prepared::default();
    let Some(source) = read(dir, "world/ports.toml", is) else { return out };
    let Some(v) = parse::<Value>("world/ports.toml", &source, is) else { return out };
    if !v.get("ports").and_then(Value::as_array).into_iter().flatten().any(|v| v.get("lonlat").is_some()) {
        return out;
    }
    out.enabled = true;
    let map = match super::map_package::load(dir) {
        Ok(map) => map,
        Err(error) => {
            is.list.extend(error.issues);
            return out;
        }
    };
    let Some(projection) = &map.navigation.projection else {
        is.push("navigation.toml", "projection", "经纬度作者表需要明确整数投影");
        return out;
    };
    let project = |v: &Value, file: &str, is: &mut Issues| {
        let [lon, lat] = lonlat(v);
        let step = f64::from(projection.arcmin_per_cell);
        let x = ((lon * 60.0 - f64::from(projection.west)) / step).floor() as i64;
        let y = ((f64::from(projection.north) - lat * 60.0) / step).floor() as i64;
        let x = if map.map.wrap_x { x.rem_euclid(i64::from(map.map.width)) } else { x };
        if x < 0 || y < 0 || x >= i64::from(map.map.width) || y >= i64::from(map.map.height) {
            is.push(file, text(v, "key"), "作者坐标超出所选地图投影");
        }
        Cell::new(x.clamp(0, i64::from(map.map.width) - 1) as u16, y.clamp(0, i64::from(map.map.height) - 1) as u16)
    };
    let mut factions = BTreeMap::new();
    for (table, file, anchors) in
        [("ports", "world/ports.toml", &map.ports), ("cities", "world/cities.toml", &map.cities)]
    {
        let mut converted = Vec::new();
        for row in rows(dir, file, table, is) {
            let key = text(&row, "key");
            let Some(anchor) = anchors.iter().find(|a| a.key == key) else {
                is.push(file, &key, "缺少已校验锚地");
                continue;
            };
            factions.insert(key.clone(), text(&row, "faction"));
            out.authored.locations.insert(
                key.clone(),
                LocationSource {
                    provenance: provenance(&row),
                    anchor_hint: text(&row, "anchor_hint"),
                    river: string(&row, "river"),
                    facilities: strings(&row, "facilities"),
                    style: string(&row, "style"),
                    hidden: flag(&row, "hidden", false),
                    realm: string(&row, "realm"),
                    dormant: row
                        .get("dormant")
                        .map(|d| DormantPort { until: integer(d, "until") as u32, by: text(d, "by") }),
                },
            );
            let mut raw = row.as_table().cloned().unwrap_or_default();
            raw.retain(|k, _| {
                [
                    "key",
                    "name",
                    "faction",
                    "culture",
                    "development",
                    "shipyard",
                    "market",
                    "facilities",
                    "hemisphere",
                    "lore",
                    "size",
                ]
                .contains(&k)
            });
            raw.insert("pos".into(), pos(Cell::new(anchor.pos[0], anchor.pos[1])));
            raw.entry("development").or_insert(Value::Integer(50));
            // 进口需求为零产量时保持零；不凭空添加本地产出或改作者值。
            converted.push(Value::Table(raw));
        }
        put(&mut out, file, table, converted, is);
    }
    let mut converted = Vec::new();
    for row in rows(dir, "world/roads.toml", "roads", is) {
        let key = text(&row, "key");
        let days = integer(&row, "days");
        let risk = row.get("risk").and_then(number).unwrap_or(0.0);
        let from = text(&row, "from");
        let to = text(&row, "to");
        let faction = factions.get(&from).cloned().unwrap_or_default();
        out.road_keys.push(key.clone());
        out.authored.roads.insert(
            key,
            RoadSource {
                provenance: provenance(&row),
                days: days as u32,
                via: strings(&row, "via"),
                risk_bp: (risk * 10_000.0).round() as i64,
                lore: text(&row, "lore"),
            },
        );
        // 平地驮骡每一天10格；保留作者日数与风险，其他载具仍按各自速度计算。
        converted.push(Value::Table(Table::from_iter([
            ("from".into(), Value::String(from)),
            ("to".into(), Value::String(to)),
            ("faction".into(), Value::String(faction)),
            ("terrain".into(), Value::String("plain".into())),
            ("security".into(), Value::Float(1.0 - risk)),
            ("toll".into(), Value::Integer(0)),
            ("length".into(), Value::Integer(days.saturating_mul(10))),
        ])));
    }
    put(&mut out, "world/roads.toml", "roads", converted, is);
    let mut converted = Vec::new();
    for row in rows(dir, "world/discoveries.toml", "discoveries", is) {
        let key = text(&row, "key");
        let cell = project(&row, "world/discoveries.toml", is);
        let req = &row["requires"];
        let reward = &row["reward"];
        let moves = row
            .get("moves")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|m| {
                if !factions.contains_key(&text(m, "location")) {
                    is.push("world/discoveries.toml", &key, "迁移地点不存在");
                }
                DiscoveryMove {
                    from_year: integer(m, "from_year") as u32,
                    location: text(m, "location"),
                    lonlat_e5: e5(m),
                    cell: project(m, "world/discoveries.toml", is),
                }
            })
            .collect();
        out.authored.discoveries.insert(
            key,
            DiscoverySource {
                provenance: provenance(&row),
                radius: integer(&row, "radius") as u16,
                requires: DiscoveryRequirements {
                    mode: match text(req, "mode").as_str() {
                        "land" => DiscoveryMode::Land,
                        "dive" => DiscoveryMode::Dive,
                        _ => DiscoveryMode::Sight,
                    },
                    permission: flag(req, "permission", false),
                    landing: req.get("landing").and_then(Value::as_bool),
                    weather: string(req, "weather"),
                    history: string(req, "history"),
                    records: strings(req, "records"),
                },
                codex: flag(reward, "codex", false),
                clue: string(reward, "clue"),
                phantom: flag(&row, "phantom", false),
                reachable: flag(&row, "reachable", true),
                once: flag(&row, "once", true),
                moves,
            },
        );
        let mut raw = row.as_table().cloned().unwrap_or_default();
        raw.retain(|k, _| ["key", "name", "kind", "lore"].contains(&k));
        raw.insert("pos".into(), pos(cell));
        raw.insert("fame".into(), Value::Integer(integer(reward, "fame")));
        raw.insert("value".into(), Value::Integer(0));
        converted.push(Value::Table(raw));
    }
    put(&mut out, "world/discoveries.toml", "discoveries", converted, is);
    for row in rows(dir, "world/overseas.toml", "sites", is) {
        let key = text(&row, "key");
        let cell = project(&row, "world/overseas.toml", is);
        if map
            .geography
            .landmarks
            .iter()
            .find(|s| s.key == key)
            .is_none_or(|s| s.cell != cell || s.kind != text(&row, "kind"))
        {
            is.push("world/overseas.toml", &key, "场景地标与已生成地图不一致");
        }
        out.site_text.insert(key.clone(), (text(&row, "name"), text(&row, "lore")));
        out.authored.sites.insert(
            key,
            SiteSource {
                provenance: provenance(&row),
                radius: integer(&row, "radius") as u16,
                discovery: string(&row, "discovery"),
            },
        );
    }
    // C2 的景观/灯塔/要塞/海角不具有殖民资源字段，不能误当殖民点。
    out.files.insert("world/overseas.toml", "ports=[]\nsites=[]\n".into());
    out
}

pub(super) fn link_landmarks(
    prepared: &Prepared,
    landmarks: &mut [manifest_core::geo::LandmarkDef],
    ids: &BTreeMap<String, manifest_core::DiscoveryId>,
    is: &mut Issues,
) {
    for landmark in landmarks {
        if let Some(source) = prepared.authored.sites.get(&landmark.key) {
            if let Some((name, lore)) = prepared.site_text.get(&landmark.key) {
                landmark.name.clone_from(name);
                landmark.lore.clone_from(lore);
            }
            landmark.discovery = source
                .discovery
                .as_ref()
                .and_then(|key| super::lookup(ids, key, "sites.toml", &landmark.key, "发现物", is));
        }
    }
}

#[cfg(test)]
mod tests;
