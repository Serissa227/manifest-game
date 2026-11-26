//! Natural Earth 河网按等级筛选。沿真实折线栅格连边，从河口逆向标号，不把河流挖成航海水道。

use super::check;
use super::coast::{FeatureCollection, Projection, points};
use anyhow::{Context, Result};
use serde::Serialize;
use std::collections::{BTreeSet, VecDeque};

#[derive(Debug, Serialize)]
pub struct River {
    pub key: String,
    pub name: String,
    pub path: Vec<[usize; 2]>,
    pub width: usize,
}

#[derive(Debug, Default, Serialize)]
pub struct Report {
    pub selected_features: usize,
    pub clipped_or_short: usize,
    pub unconnected: Vec<String>,
    pub lake_outlets: usize,
    pub ocean_draining_segments: usize,
    pub inland_outlet_segments: Vec<String>,
}

pub fn rasterize(
    collection: &FeatureCollection,
    projection: Projection,
    land: &[bool],
    max_rank: f64,
) -> Result<(Vec<River>, Report)> {
    let (labels, sizes) = check::components(projection, land, false);
    let ocean = sizes.iter().enumerate().max_by_key(|&(_, s)| s).map(|(i, _)| i).context("没有海洋")?;
    let mut edges = vec![BTreeSet::new(); land.len()];
    // 湖面连通河流的上、下游；不能让一条真正通海的河错误地逆流到最近的湖。
    for i in 0..land.len() {
        if !land[i] && labels[i] != ocean {
            for j in projection.neighbors(i).filter(|&j| !land[j] && labels[j] == labels[i]) {
                edges[i].insert(j);
            }
        }
    }
    let mut fragments = Vec::new();
    let mut report = Report::default();
    for (fi, feature) in collection.features.iter().enumerate() {
        let rank = feature.properties.get("scalerank").and_then(|v| v.as_f64()).unwrap_or(99.0);
        let selected = rank <= max_rank;
        // 湖心连接线只帮助下游的真实河网连通；不把水格写进河流图层。
        report.selected_features += usize::from(selected);
        let name = ["name_zh", "name"]
            .iter()
            .find_map(|k| feature.properties.get(*k).and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()))
            .unwrap_or("无名河流");
        let parts = match feature.geometry.kind.as_str() {
            "LineString" => vec![&feature.geometry.coordinates],
            "MultiLineString" => {
                feature.geometry.coordinates.as_array().context("河流多段坐标不是数组")?.iter().collect()
            }
            other => anyhow::bail!("河流不支持几何 {other}"),
        };
        for (pi, part) in parts.into_iter().enumerate() {
            let mut cells = Vec::new();
            for pair in points(part)?.windows(2) {
                let (Some(a), Some(b)) = (projection.cell(pair[0]), projection.cell(pair[1])) else {
                    continue;
                };
                for i in check::line(projection, a, b) {
                    if cells.last() != Some(&i) {
                        cells.push(i);
                    }
                }
            }
            for pair in cells.windows(2) {
                if projection.neighbors(pair[0]).any(|j| j == pair[1])
                    && labels[pair[0]] != ocean
                    && labels[pair[1]] != ocean
                {
                    edges[pair[0]].insert(pair[1]);
                    edges[pair[1]].insert(pair[0]);
                }
            }
            if !selected {
                continue;
            }
            cells.retain(|&i| land[i]);
            if cells.len() < 2 {
                report.clipped_or_short += 1;
                continue;
            }
            fragments.push((format!("ne_river_{fi}_{pi}"), name.to_owned(), rank, cells));
        }
    }
    // 所有等级参与下游拓扑，只有选定等级输出；相邻片段在粗格中汇流。
    // 不能先按显示等级删掉连接线，否则长江、亚马孙等会被错误归为内流河。
    let occupied = edges.iter().map(|e| !e.is_empty()).collect::<Vec<_>>();
    for i in 0..land.len() {
        if occupied[i] {
            for j in projection.neighbors(i).filter(|&j| occupied[j]) {
                edges[i].insert(j);
            }
        }
    }
    // 河口相对于连续地理坐标可能落后半格。只补至正交相邻的水岸，不跨越大陆。
    let mut parent = vec![usize::MAX; land.len()];
    let mut distance = vec![usize::MAX; land.len()];
    let mut queue = VecDeque::new();
    for (i, edge) in edges.iter().enumerate() {
        if land[i] && !edge.is_empty() && projection.neighbors(i).any(|j| labels[j] == ocean) {
            parent[i] = i;
            distance[i] = 0;
            queue.push_back(i);
        }
    }
    while let Some(i) = queue.pop_front() {
        for &j in &edges[i] {
            if distance[j] == usize::MAX {
                distance[j] = distance[i] + 1;
                parent[j] = i;
                queue.push_back(j);
            }
        }
    }
    let reaches_ocean = distance.iter().map(|&d| d != usize::MAX).collect::<Vec<_>>();
    // 其余内陆水体终点单列：含内流盆地、投影裁剪及粗格未接通水系，不宣称都是真实内流河。
    for (i, edge) in edges.iter().enumerate() {
        if land[i] && distance[i] == usize::MAX && !edge.is_empty() && projection.neighbors(i).any(|j| !land[j]) {
            parent[i] = i;
            distance[i] = 0;
            queue.push_back(i);
        }
    }
    while let Some(i) = queue.pop_front() {
        for &j in &edges[i] {
            if distance[j] == usize::MAX {
                distance[j] = distance[i] + 1;
                parent[j] = i;
                queue.push_back(j);
            }
        }
    }
    let mut used = BTreeSet::new();
    let mut rivers = Vec::new();
    for (key, name, rank, cells) in fragments {
        let source = cells
            .into_iter()
            .filter(|&i| distance[i] != usize::MAX)
            .max_by_key(|&i| (distance[i], std::cmp::Reverse(i)));
        let Some(mut i) = source else {
            report.unconnected.push(key);
            continue;
        };
        if distance[i] < 1 || !used.insert(i) {
            report.clipped_or_short += 1;
            continue;
        }
        let drains_ocean = reaches_ocean[i];
        let mut paths = vec![Vec::new()];
        loop {
            if land[i] {
                if let Some(path) = paths.last_mut() {
                    path.push([i % projection.width, i / projection.width]);
                }
            } else if paths.last().is_some_and(|p| !p.is_empty()) {
                paths.push(Vec::new());
            }
            if parent[i] == i {
                break;
            }
            i = parent[i];
        }
        for (part, path) in paths.into_iter().filter(|p| p.len() >= 2).enumerate() {
            let segment_key = format!("{key}_{part}");
            let mouth = path[path.len() - 1];
            if !projection.neighbors(mouth[1] * projection.width + mouth[0]).any(|j| labels[j] == ocean) {
                report.lake_outlets += 1;
            }
            if drains_ocean {
                report.ocean_draining_segments += 1;
            } else {
                report.inland_outlet_segments.push(segment_key.clone());
            }
            rivers.push(River {
                key: segment_key,
                name: name.clone(),
                path,
                width: if rank <= 1.0 {
                    3
                } else if rank <= 3.0 {
                    2
                } else {
                    1
                },
            });
        }
    }
    Ok((rivers, report))
}

pub fn validate(projection: Projection, land: &[bool], rivers: &[River]) -> Result<()> {
    for river in rivers {
        anyhow::ensure!(river.path.len() >= 2, "{} 过短", river.key);
        for p in &river.path {
            anyhow::ensure!(
                p[0] < projection.width && p[1] < projection.height && land[p[1] * projection.width + p[0]],
                "{} 不是陆地折线",
                river.key
            );
        }
        for pair in river.path.windows(2) {
            anyhow::ensure!(
                projection
                    .neighbors(pair[0][1] * projection.width + pair[0][0])
                    .any(|i| i == pair[1][1] * projection.width + pair[1][0]),
                "{} 断流",
                river.key
            );
        }
        let p = river.path.last().context("空河流")?;
        anyhow::ensure!(
            projection.neighbors(p[1] * projection.width + p[0]).any(|i| !land[i]),
            "{} 河口不通水",
            river.key
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reversed_and_multipart_rivers_reach_water_without_excavating_land() {
        let p = Projection { width: 10, height: 8, west: 0, north: 480, arcmin: 60 };
        let mut land = vec![true; 80];
        land[60..].fill(false);
        let original = land.clone();
        let collection:FeatureCollection=serde_json::from_value(serde_json::json!({"type":"FeatureCollection","features":[
            {"properties":{"scalerank":1,"name":"干流"},"geometry":{"type":"MultiLineString","coordinates":[[[4.5,2.5],[4.5,6.5]],[[4.5,5.5],[7.5,6.5]]]}},
            {"properties":{"scalerank":9,"name":"不选"},"geometry":{"type":"LineString","coordinates":[[1.5,2.5],[1.5,7.5]]}}
        ]})).expect("样例");
        let (rivers, report) = rasterize(&collection, p, &land, 5.0).expect("河网");
        assert_eq!(rivers.len(), 2);
        assert_eq!(report.selected_features, 1);
        validate(p, &land, &rivers).expect("所有河口通水");
        assert_eq!(land, original);
    }

    #[test]
    fn lake_centerlines_and_lower_rank_connectors_preserve_ocean_drainage() {
        let p = Projection { width: 10, height: 10, west: 0, north: 600, arcmin: 60 };
        let mut land = vec![true; 100];
        land[90..].fill(false);
        land[44] = false;
        land[45] = false;
        let source: FeatureCollection = serde_json::from_value(serde_json::json!({"type":"FeatureCollection","features":[
            {"properties":{"scalerank":1,"name":"上游"},"geometry":{"type":"LineString","coordinates":[[4.5,8.5],[4.5,5.5]]}},
            {"properties":{"scalerank":8,"name":"湖心与下游连接"},"geometry":{"type":"LineString","coordinates":[[5.5,5.5],[5.5,1.5]]}}
        ]})).expect("样例");
        let (rivers, report) = rasterize(&source, p, &land, 5.0).expect("湖泊与下游");
        assert_eq!(report.selected_features, 1);
        assert_eq!(rivers.len(), 2);
        assert_eq!(report.ocean_draining_segments, 2);
        assert!(report.inland_outlet_segments.is_empty());
        validate(p, &land, &rivers).expect("穿湖河流最终通海，图层只输出陆地部分");
    }
}
