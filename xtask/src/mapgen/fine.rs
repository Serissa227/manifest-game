//! 细图层（第九批 M01“细海图”）：从同一批本地来源多导出三层只给显示用的细数据，航行网格不变。
//!
//! - 细海岸：每粗格 24 × 24 细格，Natural Earth 陆地 + 小岛 − 湖泊，按与粗格同样的投影与奇偶扫描（每细格取中心）；
//!   导出前照“骨架”约束修正——每个可航行粗格的格心圆、每对直接相通的相邻可航行粗格之间的通道，凡被真实海岸挡住的细格改成水，
//!   其余原样保留；粗格是陆的地方不改（真实的海湾伸进陆格就让它伸进去）。
//! - 细高程：ETOPO5 的原始 5 角分样本（每粗格 4 × 4），含海底深度。
//! - 细河流：Natural Earth 河流中线投影成 1/24 格的定点坐标，带等级。
//!
//! 格式与骨架约束的定义在 `manifest_data::fine_map`（应用层与下一轮的内核碰撞都从那里读）。

use super::check;
use super::coast::{FeatureCollection, Point, Polygon, Projection, points};
use super::elevation::Etopo;
use anyhow::{Context, Result, ensure};
use manifest_data::fine_map::{
    self, FINE_SUB, FineCoast, FineElevation, FineRiver, FineRivers, LAKE, LAND, SEA, SKELETON_DISC,
    SKELETON_HALF_WIDTH,
};
use serde_json::Value;

/// 写进 `fine/` 目录的文件名。
pub const COAST_FILE: &str = "coast.bin";
pub const ELEVATION_FILE: &str = "elevation.bin";
pub const RIVERS_FILE: &str = "rivers.bin";
pub const MANIFEST_FILE: &str = "fine.toml";

pub struct Input<'a> {
    pub projection: Projection,
    /// 陆地与小岛的多边形（已投影到粗格坐标）
    pub land: &'a [Polygon],
    pub lakes: &'a FeatureCollection,
    pub rivers: &'a FeatureCollection,
    /// 航行网格：`#` 陆、`~` 浅、`.` 深（行优先）
    pub terrain: &'a [char],
    pub etopo: &'a Etopo,
}

pub struct Output {
    pub coast: Vec<u8>,
    pub elevation: Vec<u8>,
    pub rivers: Vec<u8>,
    /// `fine.toml`：来源、格式、生成命令与各文件的校验和（中文注释）
    pub manifest: String,
    pub report: Value,
    /// 细海岸的整张栅格（调试图用；每细格 1 字节）
    pub raster: Vec<u8>,
}

/// 把一个多边形按奇偶规则扫进细格栅格：每细格取中心，落在多边形里的交给 `put`。
fn fill(raster: &mut [u8], fine_w: usize, fine_h: usize, sub: usize, polygon: &Polygon, put: impl Fn(&mut u8)) {
    let s = sub as f64;
    let start = (polygon.bounds[1] * s).floor().max(0.0) as usize;
    let end = (polygon.bounds[3] * s).ceil().min(fine_h as f64).max(0.0) as usize;
    if start >= end {
        return;
    }
    let mut scans = vec![Vec::new(); end - start];
    for edge in polygon.rings.iter().flat_map(|r| r.windows(2)) {
        let (a, b) = (edge[0], edge[1]);
        if a[1] == b[1] {
            continue;
        }
        let lo = ((a[1].min(b[1]) * s - 0.5).ceil() as i64).max(start as i64) as usize;
        let hi = ((a[1].max(b[1]) * s - 0.5).ceil() as i64).clamp(start as i64, end as i64) as usize;
        for k in lo..hi {
            let y = (k as f64 + 0.5) / s;
            scans[k - start].push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
    }
    for (row, xs) in scans.iter_mut().enumerate() {
        xs.sort_by(f64::total_cmp);
        let base = (start + row) * fine_w;
        for span in xs.chunks_exact(2) {
            let from = (span[0] * s - 0.5).ceil() as i64;
            let to = (span[1] * s - 0.5).ceil() as i64;
            for fx in from..to {
                put(&mut raster[base + fx.rem_euclid(fine_w as i64) as usize]);
            }
        }
    }
}

fn feature_polygons(feature: &super::coast::Feature, projection: Projection) -> Result<Vec<Polygon>> {
    let coordinates = &feature.geometry.coordinates;
    let parts: Vec<&Value> = match feature.geometry.kind.as_str() {
        "Polygon" => vec![coordinates],
        "MultiPolygon" => coordinates.as_array().context("GeoJSON 坐标必须是数组")?.iter().collect(),
        other => anyhow::bail!("湖泊需要 Polygon 或 MultiPolygon，收到 {other}"),
    };
    parts
        .into_iter()
        .map(|part| {
            let rings = part.as_array().context("GeoJSON 坐标必须是数组")?.iter().map(points).collect::<Result<_>>()?;
            Polygon::new(rings, projection)
        })
        .collect()
}

/// 确定性的小哈希（设定岛的轮廓、调试用）：只依赖整数输入。
fn hash(a: u64, b: u64) -> u64 {
    let mut x = a.wrapping_mul(0x9e37_79b9_7f4a_7c15) ^ b.wrapping_mul(0xc2b2_ae3d_27d4_eb4f);
    x ^= x >> 31;
    x = x.wrapping_mul(0xd6e8_feb8_6659_fd93);
    x ^ (x >> 32)
}

pub fn build(input: &Input<'_>) -> Result<Output> {
    let p = input.projection;
    let sub = usize::from(FINE_SUB);
    let (w, h) = (p.width, p.height);
    let (fine_w, fine_h) = (w * sub, h * sub);
    ensure!(input.terrain.len() == w * h, "细图层：航行网格尺寸不符");
    let navigable = input.terrain.iter().map(|&c| c != '#').collect::<Vec<_>>();
    let coarse_land = navigable.iter().map(|&n| !n).collect::<Vec<_>>();
    let (labels, sizes) = check::components(p, &coarse_land, false);
    let ocean = sizes.iter().enumerate().max_by_key(|&(_, s)| s).map(|(i, _)| i).context("没有海洋")?;

    // 一、真实海岸：陆地与小岛
    let mut raster = vec![SEA; fine_w * fine_h];
    for polygon in input.land {
        fill(&mut raster, fine_w, fine_h, sub, polygon, |c| *c = LAND);
    }
    // 二、湖泊（内陆水）。水库是后世才有的：只有航行网格在那里确有内陆水格时才画，其余略去
    let (mut lake_polygons, mut skipped_reservoirs) = (0usize, 0usize);
    for feature in &input.lakes.features {
        let reservoir = feature.properties.get("featurecla").and_then(Value::as_str) == Some("Reservoir");
        for polygon in feature_polygons(feature, p)? {
            if reservoir {
                let [x0, y0, x1, y1] = polygon.bounds;
                let mut kept = false;
                for y in y0.floor() as i64..=y1.floor() as i64 {
                    for x in x0.floor() as i64..=x1.floor() as i64 {
                        if let Some(i) = p.index(x, y)
                            && navigable[i]
                            && labels[i] != ocean
                        {
                            kept = true;
                        }
                    }
                }
                if !kept {
                    skipped_reservoirs += 1;
                    continue;
                }
            }
            lake_polygons += 1;
            // 湖泊多边形盖住的一律记成内陆水。陆地多边形里本来就留了洞、湖泊数据又不收的内海（里海）仍是“海”：
            // 它有自己的水深，照海来画；航行网格里它本来也是一片不通大洋的水
            fill(&mut raster, fine_w, fine_h, sub, &polygon, |c| *c = LAKE);
        }
    }
    // 三、航行网格是陆、真实数据里却没有一粒陆的粗格（设定岛等）：在格内画一座小岛，免得“陆格”看上去是一片海
    let mut islets = Vec::new();
    for cell in (0..w * h).filter(|&i| !navigable[i]) {
        let (cx, cy) = (cell % w, cell / w);
        let any_land = (0..sub).any(|fy| {
            let row = (cy * sub + fy) * fine_w + cx * sub;
            raster[row..row + sub].contains(&LAND)
        });
        if any_land {
            continue;
        }
        islets.push([cx, cy]);
        // 十六个方向各取一个半径（5–8.5 细格），方向之间线性过渡：轮廓不规则，但不出本格
        let radius = |k: usize| 5.0 + (hash(cell as u64, (k % 16) as u64) % 1000) as f64 / 1000.0 * 3.5;
        for fy in 0..sub {
            for fx in 0..sub {
                let (dx, dy) = (fx as f64 + 0.5 - sub as f64 / 2.0, fy as f64 + 0.5 - sub as f64 / 2.0);
                let turn = (dy.atan2(dx) / std::f64::consts::TAU).rem_euclid(1.0) * 16.0;
                let (k, t) = (turn.floor() as usize, turn.fract());
                if (dx * dx + dy * dy).sqrt() <= radius(k) * (1.0 - t) + radius(k + 1) * t {
                    raster[(cy * sub + fy) * fine_w + cx * sub + fx] = LAND;
                }
            }
        }
    }
    // 四、骨架：航行网格是权威。只把挡在格心圆与通道上的陆改成水（海洋连通的粗格里改成海，内陆水格里改成内陆水）
    //
    // 只挖骨架本身的话，水道是尺子画的直渠、几条渠之间还剩下三角形的碎地，一眼就是假的。所以凡是真挖过的地方：
    // - 骨架外面两圈按平滑噪声啃掉一部分（两岸参差）；
    // - 挖完以后，夹在水道之间、整个落在可航行粗格里的小块碎地（不超过 SLIVER 个细格）一并改成水。
    // 没被挡住的地方（绝大多数海岸）一粒不动。
    const HALO: i64 = 2;
    const SLIVER: usize = 96;
    let mut carved = 0usize;
    let mut carved_cells = std::collections::BTreeSet::new();
    let mut carved_at = Vec::new();
    {
        // 平滑噪声（格点间距 4 细格，双线性）：只依赖取模后的细格坐标，接缝两侧连续
        let lattice = |gx: i64, gy: i64| {
            (hash(gx.rem_euclid((fine_w / 4) as i64) as u64, gy as u64 ^ 0x5eed) % 4096) as f64 / 4096.0
        };
        let noise = |fx: i64, fy: i64| {
            let (gx, gy) = (fx.div_euclid(4), fy.div_euclid(4));
            let (tx, ty) = (fx.rem_euclid(4) as f64 / 4.0, fy.rem_euclid(4) as f64 / 4.0);
            let top = lattice(gx, gy) * (1.0 - tx) + lattice(gx + 1, gy) * tx;
            let bottom = lattice(gx, gy + 1) * (1.0 - tx) + lattice(gx + 1, gy + 1) * tx;
            top * (1.0 - ty) + bottom * ty
        };
        let locate = |fx: i64, fy: i64| -> Option<(usize, usize)> {
            if fy < 0 || fy >= fine_h as i64 {
                return None;
            }
            let fx = fx.rem_euclid(fine_w as i64) as usize;
            let cell = fy as usize / sub * w + fx / sub;
            navigable[cell].then_some((cell, fy as usize * fine_w + fx))
        };
        for cell in (0..w * h).filter(|&i| navigable[i]) {
            let (cx, cy) = ((cell % w) as i64, (cell / w) as i64);
            let links = (2..=5).filter(|&dir| fine_map::skeleton_link(&navigable, w, h, true, cell, dir).is_some());
            for part in std::iter::once(None).chain(links.map(Some)) {
                let mut blocked = false;
                fine_map::skeleton_cells(FINE_SUB, cx, cy, part, |fx, fy| {
                    blocked |= locate(fx, fy).is_some_and(|(_, at)| raster[at] == LAND);
                });
                if !blocked {
                    continue;
                }
                fine_map::skeleton_halo(FINE_SUB, cx, cy, part, HALO, |fx, fy, ring| {
                    let Some((target, at)) = locate(fx, fy) else { return };
                    if raster[at] != LAND || (ring > 0 && noise(fx, fy) < 0.3 + 0.2 * ring as f64) {
                        return;
                    }
                    raster[at] = if labels[target] == ocean { SEA } else { LAKE };
                    carved += 1;
                    carved_cells.insert(target);
                    carved_at.push(at);
                });
            }
        }
    }
    // 碎地：从挖过的细格旁边的陆出发找连通块（四连通）；整块都在可航行粗格里、又不超过 SLIVER 个细格的改成水
    let mut slivers = 0usize;
    {
        // 只记走过的细格（几百万个以内），不为整张栅格再开一份标记
        let mut seen = std::collections::HashSet::new();
        let neighbours = |at: usize| {
            let (fx, fy) = (at % fine_w, at / fine_w);
            [
                Some(fy * fine_w + (fx + 1) % fine_w),
                Some(fy * fine_w + (fx + fine_w - 1) % fine_w),
                (fy + 1 < fine_h).then(|| at + fine_w),
                (fy > 0).then(|| at - fine_w),
            ]
        };
        let coarse = |at: usize| (at / fine_w) / sub * w + (at % fine_w) / sub;
        for &origin in &carved_at {
            for start in neighbours(origin).into_iter().flatten() {
                if raster[start] != LAND || !seen.insert(start) {
                    continue;
                }
                // 有界的搜索：超过上限或碰到陆格就不算碎地（已经走过的照样记下，不重复搜）
                let mut block = vec![start];
                let mut keep = !navigable[coarse(start)];
                let mut next = 0;
                while next < block.len() && !keep {
                    let at = block[next];
                    next += 1;
                    for n in neighbours(at).into_iter().flatten() {
                        if raster[n] != LAND || block.contains(&n) {
                            continue;
                        }
                        block.push(n);
                        if !navigable[coarse(n)] || block.len() > SLIVER {
                            keep = true;
                        }
                    }
                }
                if keep {
                    // 大块或连着陆格的：只有起点记作走过（同一块从别的起点碰到时会再次很快超限）
                    continue;
                }
                for &at in &block {
                    let cell = coarse(at);
                    raster[at] = if labels[cell] == ocean { SEA } else { LAKE };
                    carved_cells.insert(cell);
                }
                slivers += block.len();
            }
        }
    }
    let coast = FineCoast::from_raster(w as u32, h as u32, FINE_SUB, &raster)?;
    let skeleton = fine_map::verify_skeleton(&coast, &navigable, true)?;

    // 粗细两层的对照（只作报告）：粗格的海陆与格内细格的多数是否一致
    let (mut water_mostly_land, mut land_mostly_water) = (0usize, 0usize);
    for (cell, &nav) in navigable.iter().enumerate() {
        let (cx, cy) = (cell % w, cell / w);
        let land = (0..sub)
            .map(|fy| {
                let row = (cy * sub + fy) * fine_w + cx * sub;
                raster[row..row + sub].iter().filter(|&&c| c == LAND).count()
            })
            .sum::<usize>();
        if nav && land * 2 > sub * sub {
            water_mostly_land += 1;
        }
        if !nav && land * 2 < sub * sub {
            land_mostly_water += 1;
        }
    }

    // 五、细高程：ETOPO5 原始样本（缺测按 0 米）
    ensure!(p.arcmin.is_multiple_of(5) && p.west % 5 == 0 && p.north % 5 == 0, "细高程要求投影对齐 5 角分");
    let n = (p.arcmin / 5) as usize;
    let (ew, eh) = (w * n, h * n);
    let (ox, oy) = (i64::from(p.west / 5), i64::from((5400 - p.north) / 5));
    let mut meters = Vec::with_capacity(ew * eh);
    for y in 0..eh as i64 {
        for x in 0..ew as i64 {
            meters.push(input.etopo.sample(ox + x, oy + y).unwrap_or(0));
        }
    }
    let fine_elevation = FineElevation { width: ew as u32, height: eh as u32, per_cell: n as u16, meters };

    // 六、细河流：只收河流（湖心线不收——湖面自己会画），坐标取 1/24 格，跨接缝时沿展开的坐标连着走
    let mut rivers = Vec::new();
    for feature in &input.rivers.features {
        if feature.properties.get("featurecla").and_then(Value::as_str) != Some("River") {
            continue;
        }
        let rank = feature.properties.get("scalerank").and_then(Value::as_f64).unwrap_or(12.0).clamp(0.0, 255.0) as u8;
        let parts = match feature.geometry.kind.as_str() {
            "LineString" => vec![&feature.geometry.coordinates],
            "MultiLineString" => {
                feature.geometry.coordinates.as_array().context("河流多段坐标不是数组")?.iter().collect()
            }
            other => anyhow::bail!("河流不支持几何 {other}"),
        };
        for part in parts {
            let mut line: Vec<[i32; 2]> = Vec::new();
            let mut previous: Option<f64> = None;
            let mut flush = |line: &mut Vec<[i32; 2]>| {
                if line.len() >= 2 {
                    rivers.push(FineRiver { rank, points: std::mem::take(line) });
                } else {
                    line.clear();
                }
            };
            for point in points(part)? {
                let mut q: Point = p.project(point);
                if let Some(px) = previous {
                    q[0] += ((px - q[0]) / w as f64).round() * w as f64;
                }
                previous = Some(q[0]);
                if q[1] < 0.0 || q[1] >= h as f64 {
                    flush(&mut line);
                    continue;
                }
                let fine = [(q[0] * sub as f64).floor() as i32, (q[1] * sub as f64).floor() as i32];
                if line.last() != Some(&fine) {
                    line.push(fine);
                }
            }
            flush(&mut line);
        }
    }
    let river_points = rivers.iter().map(|r| r.points.len()).sum::<usize>();
    let fine_rivers = FineRivers { width: w as u32, height: h as u32, sub: FINE_SUB, rivers };

    let coast_bytes = coast.encode();
    let elevation_bytes = fine_elevation.encode();
    let river_bytes = fine_rivers.encode();
    // 读回逐字节核对：写出去的就是下游读得到的
    ensure!(FineCoast::decode(&coast_bytes)? == coast, "细海岸读回不一致");
    ensure!(FineElevation::decode(&elevation_bytes)? == fine_elevation, "细高程读回不一致");
    ensure!(FineRivers::decode(&river_bytes)? == fine_rivers, "细河流读回不一致");
    let digest = |bytes: &[u8]| blake3::hash(bytes).to_hex().to_string();
    let land_cells = raster.iter().filter(|&&c| c == LAND).count();
    let lake_cells = raster.iter().filter(|&&c| c == LAKE).count();
    let manifest = format!(
        r#"# 细图层的说明（自动生成，不要手改）。生成命令：cargo xtask mapgen real --config data/maps/earth/mapgen.toml
# 这三层只给显示用（下一轮也给玩家手动航行的碰撞用）；航行网格仍以上一级目录的 map.txt 为准。
# 二进制格式的逐字节定义见 crates/manifest-data/src/fine_map.rs 开头的说明；来源文件与校验和见上一级的 sources.toml。
version = {version}
# 每粗格的细分数：一粗格（20 角分）= 24 × 24 细格，一细格约 0.83 角分
cells_per_cell = {sub}

# 细海岸：每细格一类——海、陆、内陆水（湖）。
# 来源：Natural Earth 1:10m 陆地 + 小岛 − 湖泊，与粗格同样的等距圆柱投影与奇偶扫描，每细格取中心。
# 水库是后世才有的：只有航行网格在那里确有内陆水格时才画（略去 {skipped_reservoirs} 座）。
# “骨架”修正：每个可航行粗格以格心为圆心、半径 {disc} 细格的圆，以及内核允许直接相通的相邻可航行粗格
# （八方向，斜向不穿陆角）之间沿格心连线、半宽 {half} 细格的通道，凡是陆的细格改成水；其余真实海岸原样保留，
# 粗格是陆的地方一格不改。真挖过的地方，骨架外面两圈按平滑噪声啃掉一部分（两岸参差，不像尺子画的），
# 夹在水道之间、整个落在可航行粗格里的小块碎地（不超过 96 细格）也改成水。
# carved_fine_cells 是挖掉的细格数，sliver_fine_cells 是清掉的碎地，carved_coarse_cells 是涉及的粗格数。
# synthesized_islets：航行网格是陆、真实数据里却没有一粒陆的粗格（设定岛等），在格内画了一座小岛。
[coast]
file = "{coast_file}"
blake3 = "{coast_hash}"
bytes = {coast_len}
width = {fine_w}
height = {fine_h}
mixed_coarse_cells = {mixed}
land_fine_cells = {land_cells}
lake_fine_cells = {lake_cells}
lake_polygons = {lake_polygons}
carved_fine_cells = {carved}
sliver_fine_cells = {slivers}
carved_coarse_cells = {carved_coarse}
skeleton_cells = {sk_cells}
skeleton_links = {sk_links}
water_cells_mostly_land = {water_mostly_land}
land_cells_mostly_water = {land_mostly_water}
synthesized_islets = {islets:?}

# 细高程：ETOPO5 的原始 5 角分样本（每粗格 4 × 4），单位米，海底为负；缺测按 0。
[elevation]
file = "{elevation_file}"
blake3 = "{elevation_hash}"
bytes = {elevation_len}
width = {ew}
height = {eh}
samples_per_cell = {n}

# 细河流：Natural Earth 1:10m 河流中线（不含湖心线），坐标单位 1/24 格，横向不取模；rank 是原数据的 scalerank（越小河越大）。
[rivers]
file = "{rivers_file}"
blake3 = "{rivers_hash}"
bytes = {rivers_len}
segments = {segments}
points = {river_points}
"#,
        version = fine_map::FINE_VERSION,
        sub = FINE_SUB,
        disc = SKELETON_DISC,
        half = SKELETON_HALF_WIDTH,
        coast_file = COAST_FILE,
        coast_hash = digest(&coast_bytes),
        coast_len = coast_bytes.len(),
        mixed = coast.mixed_cells(),
        carved_coarse = carved_cells.len(),
        sk_cells = skeleton.cells,
        sk_links = skeleton.links,
        elevation_file = ELEVATION_FILE,
        elevation_hash = digest(&elevation_bytes),
        elevation_len = elevation_bytes.len(),
        rivers_file = RIVERS_FILE,
        rivers_hash = digest(&river_bytes),
        rivers_len = river_bytes.len(),
        segments = fine_rivers.rivers.len(),
    );
    let report = serde_json::json!({
        "coast_bytes": coast_bytes.len(),
        "elevation_bytes": elevation_bytes.len(),
        "rivers_bytes": river_bytes.len(),
        "mixed_coarse_cells": coast.mixed_cells(),
        "carved_fine_cells": carved,
        "sliver_fine_cells": slivers,
        "carved_coarse_cells": carved_cells.len(),
        "skeleton_cells": skeleton.cells,
        "skeleton_links": skeleton.links,
        "skeleton_checked_links": skeleton.checked_links,
        "water_cells_mostly_land": water_mostly_land,
        "land_cells_mostly_water": land_mostly_water,
        "synthesized_islets": islets,
        "skipped_reservoirs": skipped_reservoirs,
        "river_segments": fine_rivers.rivers.len(),
        "river_points": river_points,
    });
    Ok(Output { coast: coast_bytes, elevation: elevation_bytes, rivers: river_bytes, manifest, report, raster })
}

/// 调试图：一片经纬范围的细海岸（每细格一个像素；海蓝、陆绿、内陆水浅蓝，粗格线淡淡地画出来）。
pub fn preview(
    raster: &[u8],
    projection: Projection,
    terrain: &[char],
    [west, south, east, north]: [f64; 4],
) -> crate::worldgen::png::Canvas {
    let sub = usize::from(FINE_SUB);
    let fine_w = projection.width * sub;
    let a = projection.project([west, north]);
    let b = projection.project([east, south]);
    let (x0, y0) = ((a[0] * sub as f64).floor() as i64, ((a[1] * sub as f64).floor() as i64).max(0));
    let x1 = (b[0] * sub as f64).ceil() as i64;
    let y1 = ((b[1] * sub as f64).ceil() as i64).min((projection.height * sub) as i64);
    let mut canvas = crate::worldgen::png::Canvas::new((x1 - x0).max(1) as usize, (y1 - y0).max(1) as usize);
    for fy in y0..y1 {
        for fx in x0..x1 {
            let wx = fx.rem_euclid(fine_w as i64) as usize;
            let cell = fy as usize / sub * projection.width + wx / sub;
            let nav = terrain[cell] != '#';
            let mut color = match (raster[fy as usize * fine_w + wx], nav) {
                (LAND, false) => [150, 170, 100],
                // 可航行粗格里的陆：稍暗，一眼看出“这里船能压上去”
                (LAND, true) => [120, 140, 80],
                (LAKE, _) => [110, 170, 200],
                // 陆格里的水：浅滩的颜色
                (_, false) => [120, 180, 170],
                _ => [30, 75, 120],
            };
            if wx.is_multiple_of(sub) || (fy as usize).is_multiple_of(sub) {
                color = [color[0] / 8 * 7, color[1] / 8 * 7, color[2] / 8 * 7];
            }
            canvas.put(fx - x0, fy - y0, color);
        }
    }
    canvas
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mapgen::elevation::{HEIGHT, WIDTH};
    use manifest_data::fine_map::MIXED;

    #[test]
    fn real_coast_is_kept_and_only_the_blocked_skeleton_is_carved() {
        // 6 × 3 粗格（每格 60 角分）：一块陆地占满第 1 列、并盖住第 2 列的西边六成（连同格心）。
        // 航行网格把第 2 列记成可航行（好比近岸泊地补丁）：格心与通道要挖开，别处的真实海岸原样保留。
        let p = Projection { width: 6, height: 3, west: 0, north: 180, arcmin: 60 };
        let land = Polygon::new(vec![vec![[1.0, 0.0], [2.6, 0.0], [2.6, 3.0], [1.0, 3.0], [1.0, 0.0]]], p).expect("陆");
        let lake_json = serde_json::json!({"type":"FeatureCollection","features":[
            {"properties":{"featurecla":"Lake"},"geometry":{"type":"Polygon","coordinates":
                [[[1.25,1.25],[1.75,1.25],[1.75,1.75],[1.25,1.75],[1.25,1.25]]]}},
            {"properties":{"featurecla":"Reservoir"},"geometry":{"type":"Polygon","coordinates":
                [[[1.1,2.1],[1.4,2.1],[1.4,2.4],[1.1,2.4],[1.1,2.1]]]}}
        ]});
        let river_json = serde_json::json!({"type":"FeatureCollection","features":[
            {"properties":{"featurecla":"River","scalerank":3},"geometry":{"type":"LineString","coordinates":
                [[1.5,2.9],[1.5,2.0],[1.6,1.8]]}},
            {"properties":{"featurecla":"Lake Centerline","scalerank":3},"geometry":{"type":"LineString","coordinates":
                [[1.3,1.5],[1.7,1.5]]}}
        ]});
        let lakes: FeatureCollection = serde_json::from_value(lake_json).expect("湖");
        let rivers: FeatureCollection = serde_json::from_value(river_json).expect("河");
        let etopo = Etopo::decode(&vec![0u8; WIDTH * HEIGHT * 2], i16::MIN).expect("高程");
        let terrain = ".#.....#.....#....".chars().collect::<Vec<_>>();
        let input =
            Input { projection: p, land: &[land], lakes: &lakes, rivers: &rivers, terrain: &terrain, etopo: &etopo };
        let out = build(&input).expect("细图层");
        let coast = FineCoast::decode(&out.coast).expect("细海岸");
        let sub = i64::from(FINE_SUB);
        // 第 1 列（陆格）：除了那座湖，一格不改；水库不画
        assert_eq!(coast.class_at(sub + 2, sub + 2), LAND);
        assert_eq!(coast.class_at(sub + 12, sub + 12), LAKE, "湖心");
        assert_eq!(coast.class_at(sub + 5, 17), LAND, "水库略去");
        assert_eq!(coast.kind(1), LAND, "第 1 列第 0 行整格是陆");
        // 第 2 列（可航行）：格心挖开，西北角的真实陆地留着，东边四成本来就是海
        for cy in 0..3 {
            assert_eq!(coast.class_at(2 * sub + 12, cy * sub + 12), SEA, "格心");
            assert_eq!(coast.class_at(2 * sub + 11, cy * sub + 11), SEA, "格心");
            assert_eq!(coast.kind((cy * 6 + 2) as usize), MIXED);
        }
        assert_eq!(coast.class_at(2 * sub + 1, sub + 1), LAND, "离骨架远的真实海岸不动");
        assert_eq!(coast.class_at(2 * sub + 20, sub + 2), SEA);
        // 上下相邻的可航行格之间的通道也挖开了
        assert_eq!(coast.class_at(2 * sub + 12, sub), SEA);
        // 第 0 列：真实数据里是海
        assert_eq!(coast.kind(0), SEA);
        // 河流只收河（湖心线不收），坐标是 1/24 格
        let fine_rivers = FineRivers::decode(&out.rivers).expect("细河流");
        assert_eq!(fine_rivers.rivers.len(), 1);
        assert_eq!(fine_rivers.rivers[0].rank, 3);
        assert_eq!(fine_rivers.rivers[0].points[0], [36, 2]);
        let elevation = FineElevation::decode(&out.elevation).expect("细高程");
        assert_eq!((elevation.width, elevation.height, elevation.per_cell), (72, 36, 12));
        assert!(out.manifest.contains("carved_fine_cells"));
        assert!(out.report["carved_fine_cells"].as_u64().is_some_and(|n| n > 0));
    }
}
