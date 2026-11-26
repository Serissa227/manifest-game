//! 手写气候区 + 地形推断。只影响地貌与美术诊断，不改海陆或导航封冻。

use super::coast::{Point, Projection};
use super::{check, rivers::River};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::path::Path;

pub const DEGRADED_REASON: &str = "未提供已授权的气候栅格；降级模式为手写气候区 + 推断（大陆度、迎背风坡、高程、河湖与确定性边界噪声），不是柯本栅格或1553年实测气候";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Climate {
    Rainforest,
    Savanna,
    Monsoon,
    Desert,
    Mediterranean,
    Broadleaf,
    Grassland,
    Steppe,
    Boreal,
    Tundra,
    Highland,
    Ice,
}

impl Climate {
    fn code(self) -> char {
        match self {
            Self::Rainforest => 'J',
            Self::Savanna => 'S',
            Self::Monsoon => 'N',
            Self::Desert => 'D',
            Self::Mediterranean => 'M',
            Self::Broadleaf => 'F',
            Self::Grassland => 'G',
            Self::Steppe => 'K',
            Self::Boreal => 'B',
            Self::Tundra => 'T',
            Self::Highland => 'H',
            Self::Ice => 'I',
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ClimateTable {
    version: u32,
    pub seed: u64,
    boundary_jitter_degrees: f64,
    pub regions: Vec<Region>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Region {
    key: String,
    name: String,
    climate: Climate,
    shape: Shape,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Shape {
    Polygon { points: Vec<Point> },
    Ellipse { center: Point, radii: Point },
}

fn relative_longitude(lon: f64, reference: f64) -> f64 {
    reference + (lon - reference + 180.0).rem_euclid(360.0) - 180.0
}

impl Shape {
    fn contains(&self, [lon, lat]: Point) -> bool {
        match self {
            Self::Ellipse { center, radii } => {
                ((relative_longitude(lon, center[0]) - center[0]) / radii[0]).powi(2)
                    + ((lat - center[1]) / radii[1]).powi(2)
                    <= 1.0
            }
            Self::Polygon { points } => {
                // 相对首顶点展开接缝；区域宽度不超过半球。
                let x = relative_longitude(lon, points[0][0]);
                let mut previous = points[0];
                let mut inside = false;
                for point in points.iter().skip(1).chain(points.first()) {
                    let current = [relative_longitude(point[0], points[0][0]), point[1]];
                    if (previous[1] > lat) != (current[1] > lat)
                        && x < (current[0] - previous[0]) * (lat - previous[1]) / (current[1] - previous[1])
                            + previous[0]
                    {
                        inside = !inside;
                    }
                    previous = current;
                }
                inside
            }
        }
    }
}

impl ClimateTable {
    pub fn read(path: &Path) -> Result<(Self, String)> {
        let bytes = std::fs::read(path).with_context(|| format!("读取气候区表 {}", path.display()))?;
        let table = Self::parse(std::str::from_utf8(&bytes).context("气候区表必须为 UTF-8")?)?;
        Ok((table, blake3::hash(&bytes).to_hex().to_string()))
    }

    fn parse(text: &str) -> Result<Self> {
        let table: Self = toml::from_str(text).context("解析手写气候区表")?;
        ensure!(table.version == 1 && !table.regions.is_empty(), "气候区表必须为版本1且至少有一区");
        ensure!(
            table.boundary_jitter_degrees.is_finite() && (0.0..=3.0).contains(&table.boundary_jitter_degrees),
            "边界扰动须在0–3度之间"
        );
        let valid_point = |p: Point| {
            p.iter().all(|v| v.is_finite()) && (-180.0..=180.0).contains(&p[0]) && (-90.0..=90.0).contains(&p[1])
        };
        let mut keys = BTreeSet::new();
        for region in &table.regions {
            ensure!(
                !region.key.is_empty() && keys.insert(&region.key) && !region.name.trim().is_empty(),
                "气候区key重复或名称为空：{}",
                region.key
            );
            match &region.shape {
                Shape::Polygon { points } => {
                    ensure!(
                        points.len() >= 3 && points.iter().all(|&p| valid_point(p)),
                        "气候多边形无效：{}",
                        region.key
                    );
                    let origin = points[0];
                    let area: f64 = points
                        .windows(2)
                        .map(|p| {
                            let a = [relative_longitude(p[0][0], origin[0]) - origin[0], p[0][1] - origin[1]];
                            let b = [relative_longitude(p[1][0], origin[0]) - origin[0], p[1][1] - origin[1]];
                            a[0] * b[1] - b[0] * a[1]
                        })
                        .sum();
                    let xs: Vec<_> = points.iter().map(|p| relative_longitude(p[0], origin[0])).collect();
                    ensure!(
                        area.abs() > 1e-6
                            && xs.iter().copied().fold(f64::NEG_INFINITY, f64::max)
                                - xs.iter().copied().fold(f64::INFINITY, f64::min)
                                < 180.0,
                        "气候多边形须非退化且窄于半球：{}",
                        region.key
                    );
                }
                Shape::Ellipse { center, radii } => ensure!(
                    valid_point(*center)
                        && radii.iter().all(|v| v.is_finite() && *v > 0.0)
                        && radii[0] < 90.0
                        && radii[1] <= 90.0,
                    "气候椭圆无效：{}",
                    region.key
                ),
            }
        }
        Ok(table)
    }

    fn warped(&self, [lon, lat]: Point) -> Point {
        let warp = |salt| {
            self.boundary_jitter_degrees
                * (noise(self.seed ^ salt, [lon, lat], 6.0) + 0.3 * noise(self.seed ^ salt, [lon, lat], 2.0))
        };
        [relative_longitude(lon + warp(17), 0.0), (lat + warp(91)).clamp(-90.0, 90.0)]
    }

    pub fn climate(&self, point: Point) -> (Climate, Option<&str>) {
        let warped = self.warped(point);
        if let Some(region) = self.regions.iter().rev().find(|r| r.shape.contains(warped)) {
            (region.climate, Some(&region.key))
        } else {
            // 未覆盖的零散岛屿用连续温度场兜底；经向低频扰动避免重造整纬度直条。
            let effective_lat = point[1].abs() + 6.0 * noise(self.seed, point, 30.0);
            (
                if effective_lat > 65.0 {
                    Climate::Tundra
                } else if effective_lat > 53.0 {
                    Climate::Boreal
                } else if effective_lat < 23.0 {
                    Climate::Savanna
                } else {
                    Climate::Broadleaf
                },
                None,
            )
        }
    }
}

/// 环绕连续的值噪声；只用种子与经纬度，不消费世界随机数或读取时钟。
fn noise(seed: u64, [lon, lat]: Point, scale: f64) -> f64 {
    let x = (lon + 180.0).rem_euclid(360.0) / scale;
    let y = (lat + 90.0) / scale;
    let hash = |dx: i64, dy: i64| {
        let xx = (x.floor() as i64 + dx).rem_euclid((360.0 / scale) as i64) as u64;
        let yy = (y.floor() as i64 + dy) as u64;
        let mut n = seed ^ xx.wrapping_mul(0x9e3779b97f4a7c15) ^ yy.wrapping_mul(0xbf58476d1ce4e5b9);
        n = (n ^ (n >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        n = (n ^ (n >> 27)).wrapping_mul(0x94d049bb133111eb);
        ((n ^ (n >> 31)) >> 11) as f64 / ((1u64 << 53) - 1) as f64 * 2.0 - 1.0
    };
    let smooth = |v: f64| v * v * (3.0 - 2.0 * v);
    let (tx, ty) = (smooth(x.fract()), smooth(y.fract()));
    let a = hash(0, 0) * (1.0 - tx) + hash(1, 0) * tx;
    let b = hash(0, 1) * (1.0 - tx) + hash(1, 1) * tx;
    a * (1.0 - ty) + b * ty
}

/// 到目标水体的环绕距离；非目标水体也传true，内陆湖不参与大陆度。
pub fn coast_distance(projection: Projection, land: &[bool]) -> Vec<u16> {
    let mut distance = vec![u16::MAX; land.len()];
    let mut queue = VecDeque::new();
    for (i, &is_land) in land.iter().enumerate() {
        if !is_land {
            distance[i] = 0;
            queue.push_back(i);
        }
    }
    while let Some(i) = queue.pop_front() {
        for j in projection.neighbors(i) {
            if distance[j] == u16::MAX {
                distance[j] = distance[i].saturating_add(1);
                queue.push_back(j);
            }
        }
    }
    distance
}

/// 去向：低纬信风由东向西，中纬西风由西向东；季风用湿季的西南来风。
fn wind(point: Point, climate: Climate) -> [i64; 2] {
    if climate == Climate::Monsoon {
        [1, -1]
    } else if point[1].abs() < 30.0 {
        [-1, if point[1] >= 0.0 { 1 } else { -1 }]
    } else {
        [1, if point[1] >= 0.0 { -1 } else { 1 }]
    }
}

fn orographic(projection: Projection, meters: &[i32], i: usize, climate: Climate) -> f64 {
    let [dx, dy] = wind(projection.center(i), climate);
    let (x, y) = ((i % projection.width) as i64, (i / projection.width) as i64);
    let here = meters[i].max(0) as f64;
    let mut ridge = here;
    let mut nearest = here;
    // 向上风方向看约200km；上坡增湿，上风高脊挡雨，下风坡减湿。
    for step in 1..=6 {
        if let Some(j) = projection.index(x - dx * step, y - dy * step) {
            let height = meters[j].max(0) as f64;
            ridge = ridge.max(height);
            if step == 1 {
                nearest = height;
            }
        }
    }
    // 下坡和上风山脊是同一雨影的两项证据，总量封顶，避免重复扣水分。
    (((here - nearest) / 2200.0).clamp(-0.12, 0.18) - ((ridge - here) / 4000.0).clamp(0.0, 0.28)).clamp(-0.28, 0.18)
}

#[derive(Clone, Copy)]
struct Conditions {
    point: Point,
    meters: i32,
    ocean_distance: u16,
    freshwater_distance: u16,
    slope_moisture: f64,
    variation: f64,
}

fn moisture(climate: Climate, c: Conditions) -> f64 {
    let base = match climate {
        Climate::Rainforest => 0.98,
        Climate::Monsoon => 0.85,
        Climate::Broadleaf | Climate::Boreal => 0.73,
        Climate::Savanna => 0.52,
        Climate::Grassland => 0.46,
        Climate::Mediterranean => 0.40,
        Climate::Steppe => 0.30,
        Climate::Desert => 0.08,
        _ => 0.45,
    };
    let continental = (f64::from(c.ocean_distance) / 50.0).min(1.0) * 0.17;
    let freshwater = if c.meters < 1800 { 0.09 * (1.0 - f64::from(c.freshwater_distance) / 3.0).max(0.0) } else { 0.0 };
    (base - continental + freshwater + c.slope_moisture + c.variation * 0.07).clamp(0.0, 1.0)
}

fn snowline(latitude: f64) -> f64 {
    (5200.0 - 52.0 * latitude.abs()).max(1200.0)
}

fn classify(climate: Climate, c: Conditions) -> char {
    let latitude = c.point[1].abs();
    let height = c.meters as f64;
    let snow = snowline(latitude) + c.variation * 180.0;
    if climate == Climate::Ice && height >= 400.0 {
        return 'I';
    }
    if height >= snow
        || height >= (4400.0 - 40.0 * latitude + c.variation * 150.0).max(850.0)
        || (climate == Climate::Highland && height >= 1800.0)
    {
        return 'A';
    }
    let wet = moisture(climate, c);
    if climate == Climate::Rainforest
        && wet >= 0.82
        && c.meters < 20
        && (c.freshwater_distance <= 1 || c.ocean_distance <= 1)
    {
        return 'W';
    }
    if matches!(climate, Climate::Rainforest | Climate::Monsoon | Climate::Savanna) && height > 1500.0 {
        return if wet >= 0.55 { 'F' } else { 'G' };
    }
    match climate {
        Climate::Rainforest | Climate::Monsoon => {
            if climate == Climate::Monsoon && latitude + c.variation * 2.0 > 25.0 {
                'F'
            } else if wet >= 0.62 {
                'J'
            } else {
                'S'
            }
        }
        Climate::Savanna => {
            if wet > 0.69 {
                'J'
            } else {
                'S'
            }
        }
        Climate::Desert => {
            if wet > 0.33 {
                'K'
            } else {
                'D'
            }
        }
        Climate::Mediterranean => 'M',
        Climate::Broadleaf => {
            if wet < 0.48 {
                'G'
            } else {
                'F'
            }
        }
        Climate::Grassland => {
            if wet > 0.68 {
                'F'
            } else {
                'G'
            }
        }
        Climate::Steppe => {
            if wet > 0.47 {
                'G'
            } else {
                'K'
            }
        }
        Climate::Boreal => {
            // 冷凉地区蒸散较弱，同一水分指数下针叶林比温带阔叶林更能保留。
            if wet < 0.22 { 'K' } else { 'B' }
        }
        Climate::Tundra | Climate::Ice => 'T',
        Climate::Highland => {
            if wet > 0.57 {
                'F'
            } else {
                'G'
            }
        }
    }
}

fn season_masks(c: Conditions, land: bool, ocean: bool, wet: f64) -> (u16, u16) {
    // 一月至十二月；南半球反相。纬度越低，年内雪线摆动越小。
    let cycle = [-1.0, -0.866, -0.5, 0.0, 0.5, 0.866, 1.0, 0.866, 0.5, 0.0, -0.5, -0.866];
    let lat = c.point[1].abs();
    let (mut snow, mut ice) = (0, 0);
    for (month, season) in cycle.into_iter().enumerate() {
        let season = if c.point[1] < 0.0 { -season } else { season };
        let line = snowline(lat) - lat * 15.0 + season * lat.min(60.0) * 40.0 + c.variation * 180.0;
        if land && wet >= 0.25 && c.meters as f64 >= line {
            snow |= 1 << month;
        }
        let mean = 30.0 - 0.50 * lat - c.meters.max(0) as f64 * 0.0065 + c.variation;
        let swing =
            if ocean { 4.0 + lat * 0.05 } else { 4.0 + lat * 0.20 + f64::from(c.ocean_distance.min(50)) * 0.16 };
        if !land && (!ocean || lat > 60.0) && mean + swing * season < if ocean { -2.0 } else { 0.0 } {
            ice |= 1 << month;
        }
    }
    (snow, ice)
}

#[derive(Serialize)]
pub struct Raster {
    pub biomes: Vec<char>,
    pub climate_codes: Vec<char>,
    pub snow_months: Vec<u16>,
    pub ice_months: Vec<u16>,
    pub report: serde_json::Value,
}

pub fn rasterize(
    table: &ClimateTable,
    projection: Projection,
    land: &[bool],
    meters: &[i32],
    rivers: &[River],
) -> Result<Raster> {
    ensure!(land.len() == projection.width * projection.height && meters.len() == land.len(), "气候输入尺寸错误");
    let (labels, sizes) = check::components(projection, land, false);
    let ocean = sizes.iter().enumerate().max_by_key(|&(_, size)| size).context("气候推断需要海洋")?.0;
    let ocean_mask: Vec<_> = labels.iter().enumerate().map(|(i, &label)| !land[i] && label == ocean).collect();
    // ETOPO聚合的水面层只保存水深；内陆湖的冷暖使用最低邻岸高程估计湖面海拔。
    let mut lake_heights = vec![i32::MAX; sizes.len()];
    for (i, &is_land) in land.iter().enumerate() {
        if is_land {
            for j in projection.neighbors(i).filter(|&j| !land[j] && !ocean_mask[j]) {
                lake_heights[labels[j]] = lake_heights[labels[j]].min(meters[i].max(0));
            }
        }
    }
    let sea_distance = coast_distance(projection, &ocean_mask.iter().map(|v| !v).collect::<Vec<_>>());
    let mut non_fresh: Vec<_> = land.iter().zip(&ocean_mask).map(|(&l, &o)| l || o).collect();
    for river in rivers {
        for &[x, y] in &river.path {
            ensure!(x < projection.width && y < projection.height, "河流湿润输入越界");
            non_fresh[y * projection.width + x] = false;
        }
    }
    let fresh_distance = coast_distance(projection, &non_fresh);
    let mut result = Raster {
        biomes: Vec::with_capacity(land.len()),
        climate_codes: Vec::with_capacity(land.len()),
        snow_months: Vec::with_capacity(land.len()),
        ice_months: Vec::with_capacity(land.len()),
        report: serde_json::Value::Null,
    };
    let mut region_cells = BTreeMap::<&str, usize>::new();
    let mut biome_cells = BTreeMap::<char, usize>::new();
    let (mut snowy, mut frozen) = ([0usize; 12], [0usize; 12]);
    for (i, &is_land) in land.iter().enumerate() {
        let point = projection.center(i);
        let (climate, key) = table.climate(point);
        let c = Conditions {
            point,
            meters: if !is_land && !ocean_mask[i] { lake_heights[labels[i]].min(9000) } else { meters[i] },
            ocean_distance: sea_distance[i],
            freshwater_distance: fresh_distance[i],
            slope_moisture: orographic(projection, meters, i, climate),
            variation: noise(table.seed ^ 371, point, 6.0),
        };
        let biome = if is_land { classify(climate, c) } else { '.' };
        let (snow, ice) = season_masks(c, is_land, ocean_mask[i], moisture(climate, c));
        if is_land {
            *region_cells.entry(key.unwrap_or("fallback")).or_default() += 1;
            *biome_cells.entry(biome).or_default() += 1;
        }
        for month in 0..12 {
            snowy[month] += usize::from(snow & (1 << month) != 0);
            frozen[month] += usize::from(ice & (1 << month) != 0);
        }
        result.biomes.push(biome);
        result.climate_codes.push(if is_land { climate.code() } else { '.' });
        result.snow_months.push(snow);
        result.ice_months.push(ice);
    }
    result.report = serde_json::json!({"method":DEGRADED_REASON,"seed":table.seed,"regions":table.regions.len(),"region_cells":region_cells,"biome_cells":biome_cells,"snow_cells_by_month":snowy,"ice_cells_by_month":frozen,"season_mask":"逐格u16，第0位为1月，第11位为12月；仅美术诊断，不改变C12导航封港","climate_codes":"J雨林 S草原 N季风 D沙漠 M地中海 F阔叶林 G草甸 K半干旱 B针叶林 T苔原 H高原 I冰盖"});
    Ok(result)
}

#[cfg(test)]
mod tests;
