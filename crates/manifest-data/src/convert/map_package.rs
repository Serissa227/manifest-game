//! 独立地图资源的严格加载；草稿也能验收完整地图，但不能借此创建游戏。

use super::{Issues, check_keys, convert_weather, geo, load_file, parse_map, read, weather};
use crate::raw::RegionsFile;
use crate::worlds::EffectiveWorld;
use crate::{DataError, DataIssue};
use manifest_core::defs::RegionDef;
use manifest_core::geo::Geography;
use manifest_core::nav::{NavigationRules, SeaMap, Terrain};
use manifest_core::{Cell, LocId};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct MapAnchor {
    pub key: String,
    /// 作者源名称的诊断副本；游戏显示通过 key 使用已翻译的地点表。
    pub name: String,
    pub lonlat: [f64; 2],
    pub pos: [u16; 2],
    pub offset_km: f64,
    pub hint: String,
    pub hint_satisfied: bool,
    pub realm: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Anchors {
    ports: Vec<MapAnchor>,
    cities: Vec<MapAnchor>,
}

pub struct LoadedMap {
    pub map: SeaMap,
    pub regions: Vec<RegionDef>,
    pub geography: Geography,
    pub ports: Vec<MapAnchor>,
    pub cities: Vec<MapAnchor>,
    pub navigation: NavigationRules,
}

impl LoadedMap {
    pub fn nav_ports(&self) -> Vec<(LocId, Cell)> {
        self.ports.iter().enumerate().map(|(i, p)| (LocId::from_idx(i), Cell::new(p.pos[0], p.pos[1]))).collect()
    }
}

fn error(file: &str, message: &str) -> DataError {
    DataError { issues: vec![DataIssue { file: file.into(), item: "地图包".into(), message: message.into() }] }
}

pub(crate) fn load(world: &EffectiveWorld) -> Result<LoadedMap, DataError> {
    let manifest = world.map.as_ref().ok_or_else(|| error("map.toml", "缺少独立地图描述"))?;
    for file in [
        "map.txt",
        "regions.toml",
        "relief.txt",
        "biomes.txt",
        "seas.txt",
        "rivers.toml",
        "landmarks.toml",
        "anchors.toml",
    ] {
        if !world.contains(&format!("world/{file}")) {
            return Err(error(file, "缺少完整地图图层"));
        }
    }
    let mut issues = Issues::default();
    let text = read(world, "world/map.txt", &mut issues).ok_or_else(|| error("map.txt", "读取失败"))?;
    let (width, height, terrain) =
        parse_map(&text, &mut issues).ok_or_else(|| error("map.txt", "地图字符或尺寸无效"))?;
    if width != manifest.width || height != manifest.height {
        return Err(error("map.txt", "尺寸与map.toml不一致"));
    }
    let raw: RegionsFile =
        load_file(world, "world/regions.toml", &mut issues).ok_or_else(|| error("regions.toml", "海区结构无效"))?;
    check_keys("regions.toml", "regions", raw.regions.iter().map(|r| (r.key.as_str(), r.name.as_str())), &mut issues);
    let mut regions = Vec::new();
    for r in &raw.regions {
        let [x0, y0, x1, y1] = r.rect;
        if x0 < 0
            || x1 < 0
            || y0 < 0
            || y1 < y0
            || y1 >= i64::from(height)
            || x0 >= i64::from(width)
            || x1 >= i64::from(width)
            || (x0 > x1 && !manifest.wrap_x)
        {
            return Err(error("regions.toml", "海区矩形越界"));
        }
        let seasons = [&r.spring, &r.summer, &r.autumn, &r.winter]
            .map(|s| convert_weather(s, "regions.toml", &r.key, &mut issues));
        let climate = weather::region_climate(
            r.climate.as_deref(),
            (y0 + y1) / 2,
            weather::DEFAULT_BANDS,
            "regions.toml",
            &r.key,
            &mut issues,
        );
        regions.push(RegionDef {
            key: r.key.clone(),
            name: r.name.clone(),
            rect: (x0 as u16, y0 as u16, x1 as u16, y1 as u16),
            seasons,
            climate,
        });
    }
    let marks = geo::region_marks(&raw.regions, &mut issues);
    let sea = geo::load_seas(world, width, height, &terrain, &marks, &mut issues)
        .ok_or_else(|| error("seas.txt", "逐格海区无效"))?;
    let mut region = vec![u16::MAX; terrain.len()];
    for (i, t) in terrain.iter().enumerate() {
        if *t != Terrain::Land {
            region[i] = sea[i].ok_or_else(|| error("seas.txt", "水格没有海区标记"))?;
        }
    }
    let map = SeaMap { width, height, wrap_x: manifest.wrap_x, terrain, region };
    let geography = Geography {
        places: Default::default(),
        relief: geo::load_relief(world, &map, &mut issues),
        biomes: geo::load_biomes(world, &map, &mut issues),
        rivers: geo::load_rivers(world, &map, &mut issues),
        landmarks: geo::load_landmarks(world, &map, &BTreeMap::new(), &mut issues),
        fine_rivers: Vec::new(),
    };
    let anchors: Anchors =
        load_file(world, "world/anchors.toml", &mut issues).ok_or_else(|| error("anchors.toml", "锚地结构无效"))?;
    let mut keys = BTreeSet::new();
    let mut positions = BTreeSet::new();
    for (port, rows) in [(true, &anchors.ports), (false, &anchors.cities)] {
        for row in rows {
            let c = Cell::new(row.pos[0], row.pos[1]);
            let valid = map.in_bounds(i32::from(c.x), i32::from(c.y))
                && if port { map.is_sea(c) && map.touches_land(c) } else { !map.is_sea(c) };
            if !valid
                || !keys.insert(&row.key)
                || (port && !positions.insert(row.pos))
                || !row.offset_km.is_finite()
                || row.offset_km < 0.0
                || row.name.trim().is_empty()
            {
                issues.push("anchors.toml", &row.key, "锚地/城市坐标、重复标识或偏移无效");
            }
        }
    }
    if !issues.list.is_empty() {
        return Err(DataError { issues: issues.list });
    }
    let nav = world.read("navigation.toml").map_err(super::world_error)?;
    let port_ids =
        anchors.ports.iter().enumerate().map(|(i, p)| (p.key.clone(), LocId::from_idx(i))).collect::<Vec<_>>();
    let navigation = crate::nav_cache::parse_navigation(&nav, &world.manifest.calendar, &map, &regions, &port_ids)?;
    for (group, anchors) in [("ports", &anchors.ports), ("cities", &anchors.cities)] {
        let logical = format!("world/{group}.toml");
        if !world.contains(&logical) {
            continue;
        }
        let authored: toml::Value = toml::from_str(&world.read(&logical).map_err(super::world_error)?)
            .map_err(|e| error(&logical, &e.to_string()))?;
        let rows =
            authored.get(group).and_then(toml::Value::as_array).ok_or_else(|| error(&logical, "缺少地点数组"))?;
        if rows.len() != anchors.len() {
            return Err(error("anchors.toml", "锚地数量与作者地点不一致，请重新生成"));
        }
        for (row, anchor) in rows.iter().zip(anchors) {
            let lonlat: Option<[f64; 2]> = row.get("lonlat").and_then(|v| v.clone().try_into().ok());
            if row.get("key").and_then(toml::Value::as_str) != Some(&anchor.key)
                || row.get("name").and_then(toml::Value::as_str) != Some(&anchor.name)
                || lonlat != Some(anchor.lonlat)
                || row.get("anchor_hint").and_then(toml::Value::as_str).unwrap_or_default() != anchor.hint
                || row.get("realm").is_some() != anchor.realm
                || (group == "ports" && !anchor.hint_satisfied)
            {
                return Err(error("anchors.toml", "锚地名称、顺序、原始坐标或方向与作者地点不一致，请重新生成"));
            }
        }
    }
    if world.contains("regions.toml") {
        let authored: toml::Value = toml::from_str(&world.read("regions.toml").map_err(super::world_error)?)
            .map_err(|e| error("regions.toml", &e.to_string()))?;
        if let Some(expected) = authored.get("navigation") {
            let exported: toml::Value = toml::from_str(&nav).map_err(|e| error("navigation.toml", &e.to_string()))?;
            if expected != &exported {
                return Err(error("navigation.toml", "与作者海区的 navigation 子表不一致，请重新导出"));
            }
            let keys = authored
                .get("regions")
                .and_then(toml::Value::as_array)
                .ok_or_else(|| error("regions.toml", "缺少作者海区"))?;
            if keys.len() != regions.len()
                || keys
                    .iter()
                    .zip(&regions)
                    .any(|(r, out)| r.get("key").and_then(toml::Value::as_str) != Some(&out.key))
            {
                return Err(error("regions.toml", "地图海区顺序与作者海区不一致，请重新生成"));
            }
        }
    }
    Ok(LoadedMap { map, regions, geography, ports: anchors.ports, cities: anchors.cities, navigation })
}
