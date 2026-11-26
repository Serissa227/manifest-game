//! 等距圆柱海岸扫描。每格取十六条水平扫描线，横向使用实际相交长度，洞按奇偶规则扣除。

use anyhow::{Context, Result, ensure};
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

const SAMPLES: usize = 16;
pub type Point = [f64; 2];

#[derive(Clone, Copy, Debug)]
pub struct Projection {
    pub width: usize,
    pub height: usize,
    pub west: i32,
    pub north: i32,
    pub arcmin: u32,
}

impl Projection {
    #[cfg(test)]
    pub fn earth() -> Self {
        Self { width: 1080, height: 396, west: -10800, north: 4320, arcmin: 20 }
    }

    pub fn project(self, [lon, lat]: Point) -> Point {
        [(lon * 60.0 - self.west as f64) / self.arcmin as f64, (self.north as f64 - lat * 60.0) / self.arcmin as f64]
    }

    pub fn center(self, i: usize) -> Point {
        [
            (self.west as f64 + (i % self.width) as f64 * self.arcmin as f64 + self.arcmin as f64 / 2.0) / 60.0,
            (self.north as f64 - (i / self.width) as f64 * self.arcmin as f64 - self.arcmin as f64 / 2.0) / 60.0,
        ]
    }

    pub fn cell(self, point: Point) -> Option<usize> {
        let [x, y] = self.project(point);
        (y >= 0.0 && y < self.height as f64)
            .then(|| y.floor() as usize * self.width + (x.floor() as i64).rem_euclid(self.width as i64) as usize)
    }

    pub fn index(self, x: i64, y: i64) -> Option<usize> {
        (y >= 0 && y < self.height as i64).then(|| y as usize * self.width + x.rem_euclid(self.width as i64) as usize)
    }

    pub fn neighbors(self, i: usize) -> impl Iterator<Item = usize> {
        let (x, y) = ((i % self.width) as i64, (i / self.width) as i64);
        [(0, -1), (1, 0), (0, 1), (-1, 0)].into_iter().filter_map(move |(dx, dy)| self.index(x + dx, y + dy))
    }
}

#[derive(Debug, Deserialize)]
pub struct FeatureCollection {
    #[serde(rename = "type")]
    kind: String,
    pub features: Vec<Feature>,
}

#[derive(Debug, Deserialize)]
pub struct Feature {
    pub properties: Value,
    pub geometry: Geometry,
}

#[derive(Debug, Deserialize)]
pub struct Geometry {
    #[serde(rename = "type")]
    pub kind: String,
    pub coordinates: Value,
}

pub fn read_geojson(path: &Path) -> Result<FeatureCollection> {
    let data = std::fs::read(path).with_context(|| format!("读取 {}", path.display()))?;
    let collection: FeatureCollection =
        serde_json::from_slice(&data).with_context(|| format!("解析 GeoJSON {}", path.display()))?;
    ensure!(collection.kind == "FeatureCollection", "GeoJSON 必须是 FeatureCollection");
    Ok(collection)
}

/// 每个 Polygon 独立处理；外环和洞共同参与奇偶扫描，不依赖环的朝向。
#[derive(Debug)]
pub struct Polygon {
    pub rings: Vec<Vec<Point>>,
    pub bounds: [f64; 4],
}

fn array(value: &Value) -> Result<&[Value]> {
    value.as_array().map(Vec::as_slice).context("GeoJSON 坐标必须是数组")
}

pub fn points(value: &Value) -> Result<Vec<Point>> {
    array(value)?
        .iter()
        .map(|v| {
            let a = array(v)?;
            ensure!(a.len() >= 2, "GeoJSON 坐标需要经纬度");
            let lon = a[0].as_f64().context("无效经度")?;
            let lat = a[1].as_f64().context("无效纬度")?;
            ensure!((-180.0..=180.0).contains(&lon) && (-90.0..=90.0).contains(&lat), "GeoJSON 经纬度越界");
            Ok([lon, lat])
        })
        .collect()
}

impl Polygon {
    pub fn new(rings: Vec<Vec<Point>>, projection: Projection) -> Result<Self> {
        ensure!(!rings.is_empty(), "多边形缺少外环");
        let mut projected = Vec::new();
        let mut bounds = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
        let mut reference = 0.0;
        for (n, ring) in rings.into_iter().enumerate() {
            ensure!(ring.len() >= 4 && ring.first() == ring.last(), "多边形环必须闭合且至少四点");
            let mut out: Vec<Point> = Vec::new();
            for point in ring {
                let mut p = projection.project(point);
                let previous = out.last().map_or_else(|| if n == 0 { p[0] } else { reference }, |a| a[0]);
                p[0] += ((previous - p[0]) / projection.width as f64).round() * projection.width as f64;
                out.push(p);
            }
            if n == 0 {
                reference = out[0][0];
            }
            for p in &out {
                bounds[0] = bounds[0].min(p[0]);
                bounds[1] = bounds[1].min(p[1]);
                bounds[2] = bounds[2].max(p[0]);
                bounds[3] = bounds[3].max(p[1]);
            }
            projected.push(out);
        }
        Ok(Self { rings: projected, bounds })
    }

    pub fn contains(&self, mut point: Point, width: usize) -> bool {
        point[0] += (((self.bounds[0] + self.bounds[2]) / 2.0 - point[0]) / width as f64).round() * width as f64;
        let mut inside = false;
        for ring in &self.rings {
            for edge in ring.windows(2) {
                let (a, b) = (edge[0], edge[1]);
                if (a[1] > point[1]) != (b[1] > point[1])
                    && point[0] < a[0] + (point[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
                {
                    inside = !inside;
                }
            }
        }
        inside
    }

    /// 近岸作者坐标也可识别所属岛；不会把邻近大陆上的港口扩成虚构岛屿。
    pub fn distance2(&self, mut point: Point, width: usize) -> f64 {
        point[0] += (((self.bounds[0] + self.bounds[2]) / 2.0 - point[0]) / width as f64).round() * width as f64;
        let dx = (self.bounds[0] - point[0]).max(point[0] - self.bounds[2]).max(0.0);
        let dy = (self.bounds[1] - point[1]).max(point[1] - self.bounds[3]).max(0.0);
        if dx * dx + dy * dy > 1.0 {
            return dx * dx + dy * dy;
        }
        if self.contains(point, width) {
            return 0.0;
        }
        self.rings
            .iter()
            .flat_map(|r| r.windows(2))
            .map(|e| {
                let (a, b) = (e[0], e[1]);
                let d = (b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2);
                let t = if d == 0.0 {
                    0.0
                } else {
                    (((point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])) / d).clamp(0.0, 1.0)
                };
                (point[0] - a[0] - t * (b[0] - a[0])).powi(2) + (point[1] - a[1] - t * (b[1] - a[1])).powi(2)
            })
            .fold(f64::INFINITY, f64::min)
    }

    pub fn area_km2(&self, projection: Projection) -> f64 {
        let area =
            |ring: &[Point]| ring.windows(2).map(|e| e[0][0] * e[1][1] - e[1][0] * e[0][1]).sum::<f64>().abs() / 2.0;
        let cells = (area(&self.rings[0]) - self.rings[1..].iter().map(|r| area(r)).sum::<f64>()).max(0.0);
        let lat = (projection.north as f64 - (self.bounds[1] + self.bounds[3]) / 2.0 * projection.arcmin as f64) / 60.0;
        cells * (111.195 * projection.arcmin as f64 / 60.0).powi(2) * lat.to_radians().cos().abs()
    }

    fn coverage(&self, projection: Projection) -> BTreeMap<usize, f64> {
        let start = (self.bounds[1] * SAMPLES as f64).floor().max(0.0) as usize;
        let end = (self.bounds[3] * SAMPLES as f64).ceil().min((projection.height * SAMPLES) as f64).max(0.0) as usize;
        if start >= end {
            return BTreeMap::new();
        }
        let mut scans = vec![Vec::new(); end - start];
        for edge in self.rings.iter().flat_map(|r| r.windows(2)) {
            let (a, b) = (edge[0], edge[1]);
            if a[1] == b[1] {
                continue;
            }
            let lo = ((a[1].min(b[1]) * SAMPLES as f64 - 0.5).ceil() as i64).max(start as i64) as usize;
            let hi = ((a[1].max(b[1]) * SAMPLES as f64 - 0.5).ceil() as i64).clamp(start as i64, end as i64) as usize;
            for k in lo..hi {
                let y = (k as f64 + 0.5) / SAMPLES as f64;
                scans[k - start].push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
            }
        }
        let mut result = BTreeMap::new();
        for (row, xs) in scans.iter_mut().enumerate() {
            xs.sort_by(f64::total_cmp);
            let y = (start + row) / SAMPLES;
            for span in xs.chunks_exact(2) {
                for x in span[0].floor() as i64..span[1].ceil() as i64 {
                    let amount = (span[1].min(x as f64 + 1.0) - span[0].max(x as f64)).max(0.0) / SAMPLES as f64;
                    let i = y * projection.width + x.rem_euclid(projection.width as i64) as usize;
                    *result.entry(i).or_insert(0.0) += amount;
                }
            }
        }
        result
    }
}

pub fn polygons(collection: &FeatureCollection, projection: Projection) -> Result<Vec<Polygon>> {
    let mut result = Vec::new();
    for feature in &collection.features {
        let coordinates = &feature.geometry.coordinates;
        let parts: Vec<&Value> = match feature.geometry.kind.as_str() {
            "Polygon" => vec![coordinates],
            "MultiPolygon" => array(coordinates)?.iter().collect(),
            other => anyhow::bail!("海岸/湖泊需要 Polygon 或 MultiPolygon，收到 {other}"),
        };
        for part in parts {
            result.push(Polygon::new(array(part)?.iter().map(points).collect::<Result<_>>()?, projection)?);
        }
    }
    Ok(result)
}

#[derive(Debug)]
pub struct Mask {
    pub cells: Vec<bool>,
    pub coverage: Vec<f64>,
    pub retained: Vec<usize>,
    pub protected: Vec<usize>,
}

pub fn rasterize(polygons: &[Polygon], projection: Projection, minimum_km2: f64, protected: &[Point]) -> Mask {
    let mut coverage = vec![0.0; projection.width * projection.height];
    let mut protected_polygons = std::collections::BTreeSet::new();
    for &point in protected {
        let p = projection.project(point);
        if let Some((index, d)) = polygons
            .iter()
            .enumerate()
            .map(|(i, polygon)| (i, polygon.distance2(p, projection.width)))
            .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)))
            && d <= 1.0
        {
            protected_polygons.insert(index);
        }
    }
    let mut retained = Vec::new();
    let mut protected_cells = Vec::new();
    for (index, polygon) in polygons.iter().enumerate() {
        let cells = polygon.coverage(projection);
        for (&i, &value) in &cells {
            coverage[i] = (coverage[i] + value).min(1.0);
        }
        let protect = protected_polygons.contains(&index);
        if polygon.area_km2(projection) >= minimum_km2 || protect {
            let best =
                cells.iter().max_by(|a, b| a.1.total_cmp(b.1).then_with(|| b.0.cmp(a.0))).map(|(&i, _)| i).or_else(
                    || {
                        projection.index(
                            ((polygon.bounds[0] + polygon.bounds[2]) / 2.0).floor() as i64,
                            ((polygon.bounds[1] + polygon.bounds[3]) / 2.0).floor() as i64,
                        )
                    },
                );
            if let Some(i) = best {
                if !cells.values().any(|&v| v >= 0.5) {
                    retained.push(i);
                }
                if protect {
                    protected_cells.push(i);
                }
            }
        }
    }
    let mut cells = coverage.iter().map(|&a| a >= 0.5).collect::<Vec<_>>();
    for &i in &retained {
        cells[i] = true;
    }
    retained.sort_unstable();
    retained.dedup();
    protected_cells.sort_unstable();
    protected_cells.dedup();
    Mask { cells, coverage, retained, protected: protected_cells }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn projection() -> Projection {
        Projection { width: 360, height: 180, west: -10800, north: 5400, arcmin: 60 }
    }
    fn ring(x: f64, y: f64, w: f64, h: f64) -> Vec<Point> {
        vec![[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]
    }

    #[test]
    fn dateline_polygon_uses_both_edges_without_crossing_the_world() {
        let p = projection();
        let polygon =
            Polygon::new(vec![vec![[179.0, 0.0], [-179.0, 0.0], [-179.0, 2.0], [179.0, 2.0], [179.0, 0.0]]], p)
                .expect("跨缝");
        let mask = rasterize(&[polygon], p, 0.0, &[]);
        assert_eq!(mask.cells.iter().filter(|&&v| v).count(), 4);
        for lon in [-179.5, 179.5] {
            assert!(mask.cells[p.cell([lon, 0.5]).expect("格")]);
        }
        assert!(!mask.cells[p.cell([0.0, 0.5]).expect("格")]);
    }

    #[test]
    fn holes_and_multipart_geometry_keep_water_between_islands() {
        let p = projection();
        let json = serde_json::json!({"type":"FeatureCollection","features":[{"properties":{},"geometry":{"type":"MultiPolygon","coordinates":[[ring(0.0,0.0,4.0,4.0),ring(1.0,1.0,2.0,2.0)],[ring(8.0,0.0,1.0,1.0)]]}}]});
        let c: FeatureCollection = serde_json::from_value(json).expect("GeoJSON");
        let polygons = polygons(&c, p).expect("部件");
        let mask = rasterize(&polygons, p, 0.0, &[]);
        assert_eq!(mask.cells.iter().filter(|&&v| v).count(), 13);
        assert!(!mask.cells[p.cell([1.5, 1.5]).expect("洞")]);
        assert!(!mask.cells[p.cell([6.0, 0.5]).expect("海")]);
    }

    #[test]
    fn narrow_islands_survive_by_area_or_a_port_or_landmark() {
        let p = projection();
        let polygons = [
            Polygon::new(vec![ring(0.1, 0.1, 0.03, 1.0)], p).expect("窄岛"),
            Polygon::new(vec![ring(4.1, 0.1, 0.001, 0.001)], p).expect("微岛"),
        ];
        let mask = rasterize(&polygons, p, 100.0, &[[4.101, 0.101]]);
        assert_eq!(mask.cells.iter().filter(|&&v| v).count(), 2);
        assert_eq!(mask.retained.len(), 2);
        assert_eq!(mask.protected.len(), 1);
        let again = rasterize(&polygons, p, 100.0, &[[4.101, 0.101]]);
        assert_eq!(mask.cells, again.cells);
    }

    #[test]
    fn fractional_coverage_uses_the_majority_and_rejects_open_rings() {
        let p = projection();
        let polygon = Polygon::new(vec![ring(0.0, 0.0, 0.51, 1.0)], p).expect("多数陆地");
        let mask = rasterize(&[polygon], p, f64::MAX, &[]);
        assert_eq!(mask.cells.iter().filter(|&&v| v).count(), 1);
        assert!(Polygon::new(vec![vec![[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]], p).is_err());
    }
}
