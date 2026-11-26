//! 地球输出的拓扑验收、显式水道/陆障补丁与锚地吸附。所有平局按行优先稳定择取。

use super::coast::{Point, Projection};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::{BTreeSet, BinaryHeap, VecDeque};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Passage {
    pub key: String,
    pub name: String,
    pub points: Vec<Point>,
    /// 检查局部通道，不能借绕世界一圈的远路掩盖海峡闭塞。
    pub bounds: [f64; 4],
    #[serde(default)]
    pub land: bool,
    /// 陆障检查使用障碍两边的海格。
    #[serde(default)]
    pub probes: Vec<Point>,
}

#[derive(Debug, Serialize)]
pub struct PatchReport {
    pub key: String,
    pub name: String,
    pub land: bool,
    pub changed: Vec<[usize; 2]>,
    pub path: Vec<[usize; 2]>,
}

/// 四连通数字线。斜方向补上阶梯格，导航器禁止斜穿陆角时仍有一格宽航道。
pub fn line(projection: Projection, a: usize, b: usize) -> Vec<usize> {
    let (mut x, mut y) = ((a % projection.width) as i64, (a / projection.width) as i64);
    let (mut tx, ty) = ((b % projection.width) as i64, (b / projection.width) as i64);
    tx += (((x - tx) as f64 / projection.width as f64).round() as i64) * projection.width as i64;
    let (dx, dy) = ((tx - x).abs(), (ty - y).abs());
    let (sx, sy) = ((tx - x).signum(), (ty - y).signum());
    let (mut nx, mut ny) = (0, 0);
    let mut out = vec![a];
    while x != tx || y != ty {
        if x != tx && (y == ty || (2 * nx + 1) * dy <= (2 * ny + 1) * dx) {
            x += sx;
            nx += 1;
        } else {
            y += sy;
            ny += 1;
        }
        if let Some(i) = projection.index(x, y) {
            out.push(i);
        }
    }
    out
}

pub fn apply(
    projection: Projection,
    land: &mut [bool],
    passages: &[Passage],
    protected: &[usize],
) -> Result<Vec<PatchReport>> {
    let mut report = Vec::new();
    for passage in passages {
        ensure!(passage.points.len() >= 2, "补丁 {} 至少两个点", passage.key);
        let cells =
            passage.points.iter().map(|&p| projection.cell(p).context("补丁点越界")).collect::<Result<Vec<_>>>()?;
        let mut path = Vec::new();
        for pair in cells.windows(2) {
            for i in line(projection, pair[0], pair[1]) {
                if path.last() != Some(&i) {
                    path.push(i);
                }
            }
        }
        let already_connected =
            !passage.land && connected(projection, land, cells[0], *cells.last().context("空补丁")?, passage.bounds);
        if !passage.land && !already_connected && path.iter().any(|i| protected.contains(i)) {
            path = avoid_islands(projection, land, &path, protected, passage)?;
        }
        let mut changed = Vec::new();
        for &i in path.iter().filter(|_| !already_connected) {
            if land[i] != passage.land {
                changed.push([i % projection.width, i / projection.width]);
                land[i] = passage.land;
            }
        }
        report.push(PatchReport {
            key: passage.key.clone(),
            name: passage.name.clone(),
            land: passage.land,
            changed,
            path: path.iter().map(|i| [i % projection.width, i / projection.width]).collect(),
        });
    }
    Ok(report)
}

/// 补丁与保留小岛相撞时，在原折线两格以内择取最少开挖的四连通绕行。
fn avoid_islands(
    projection: Projection,
    land: &[bool],
    path: &[usize],
    protected: &[usize],
    passage: &Passage,
) -> Result<Vec<usize>> {
    let mut allowed = path.iter().copied().collect::<BTreeSet<_>>();
    for _ in 0..2 {
        let more = allowed.iter().flat_map(|&i| projection.neighbors(i)).collect::<Vec<_>>();
        allowed.extend(more);
    }
    for i in protected {
        allowed.remove(i);
    }
    let a = path[0];
    let b = *path.last().context("空补丁")?;
    ensure!(
        allowed.contains(&a) && allowed.contains(&b),
        "{} 端点覆盖保护岛格 {:?} / {:?}",
        passage.key,
        projection.center(a),
        projection.center(b)
    );
    let mut cost = vec![usize::MAX; land.len()];
    let mut parent = vec![usize::MAX; land.len()];
    cost[a] = 0;
    let mut heap = BinaryHeap::from([Reverse((0, a))]);
    while let Some(Reverse((c, i))) = heap.pop() {
        if c != cost[i] {
            continue;
        }
        if i == b {
            break;
        }
        for j in projection.neighbors(i).filter(|j| allowed.contains(j) && inside(projection, *j, passage.bounds)) {
            let next = c + if land[j] { 100 } else { 1 };
            if next < cost[j] {
                cost[j] = next;
                parent[j] = i;
                heap.push(Reverse((next, j)));
            }
        }
    }
    ensure!(cost[b] != usize::MAX, "{} 无法绕开保护岛格", passage.key);
    let mut result = vec![b];
    let mut i = b;
    while i != a {
        i = parent[i];
        result.push(i);
    }
    result.reverse();
    Ok(result)
}

fn inside(projection: Projection, i: usize, bounds: [f64; 4]) -> bool {
    let [lon, lat] = projection.center(i);
    let [w, s, e, n] = bounds;
    let x = if w <= e { lon >= w && lon <= e } else { lon >= w || lon <= e };
    x && lat >= s && lat <= n
}

pub fn connected(projection: Projection, land: &[bool], a: usize, b: usize, bounds: [f64; 4]) -> bool {
    if land[a] || land[b] || !inside(projection, a, bounds) || !inside(projection, b, bounds) {
        return false;
    }
    let mut visited = vec![false; land.len()];
    visited[a] = true;
    let mut queue = VecDeque::from([a]);
    while let Some(i) = queue.pop_front() {
        if i == b {
            return true;
        }
        for j in projection.neighbors(i) {
            if !land[j] && !visited[j] && inside(projection, j, bounds) {
                visited[j] = true;
                queue.push_back(j);
            }
        }
    }
    false
}

pub fn validate_passages(projection: Projection, land: &[bool], passages: &[Passage]) -> Result<()> {
    for passage in passages {
        let points = if passage.land { &passage.probes } else { &passage.points };
        ensure!(points.len() >= 2, "{} 缺少连通探针", passage.key);
        let a = projection.cell(points[0]).context("探针越界")?;
        let b = projection.cell(*points.last().context("探针为空")?).context("探针越界")?;
        ensure!(!land[a] && !land[b], "{} 的通航探针不是水格", passage.key);
        ensure!(
            connected(projection, land, a, b, passage.bounds) != passage.land,
            "{} {}",
            passage.name,
            if passage.land { "陆障被打通" } else { "海峡不通" }
        );
    }
    Ok(())
}

pub fn components(projection: Projection, mask: &[bool], value: bool) -> (Vec<usize>, Vec<usize>) {
    let mut labels = vec![usize::MAX; mask.len()];
    let mut sizes = Vec::new();
    for start in 0..mask.len() {
        if mask[start] != value || labels[start] != usize::MAX {
            continue;
        }
        let label = sizes.len();
        let mut size = 0;
        labels[start] = label;
        let mut queue = VecDeque::from([start]);
        while let Some(i) = queue.pop_front() {
            size += 1;
            for j in projection.neighbors(i) {
                if mask[j] == value && labels[j] == usize::MAX {
                    labels[j] = label;
                    queue.push_back(j);
                }
            }
        }
        sizes.push(size);
    }
    (labels, sizes)
}

#[derive(Clone, Debug, Deserialize)]
pub struct Place {
    pub key: String,
    pub name: String,
    pub lonlat: Point,
    #[serde(default)]
    pub anchor_hint: String,
    pub realm: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Anchor {
    pub key: String,
    pub name: String,
    pub lonlat: Point,
    pub pos: [usize; 2],
    pub offset_km: f64,
    pub hint: String,
    pub hint_satisfied: bool,
    pub realm: bool,
}

pub fn anchors(projection: Projection, land: &[bool], places: &[Place], port: bool) -> Result<Vec<Anchor>> {
    let (labels, sizes) = components(projection, land, false);
    let ocean = sizes
        .iter()
        .enumerate()
        .max_by_key(|&(i, &size)| (size, std::cmp::Reverse(i)))
        .map(|(i, _)| i)
        .context("地图没有海洋")?;
    let candidates =
        (0..land.len())
            .filter(|&i| {
                if port { !land[i] && labels[i] == ocean && projection.neighbors(i).any(|j| land[j]) } else { land[i] }
            })
            .collect::<Vec<_>>();
    let mut occupied = BTreeSet::new();
    let mut result = Vec::new();
    for place in places {
        let p = projection.project(place.lonlat);
        let satisfies = |i: usize| {
            let mut dx = (i % projection.width) as f64 + 0.5 - p[0];
            dx -= (dx / projection.width as f64).round() * projection.width as f64;
            let dy = (i / projection.width) as f64 + 0.5 - p[1];
            match place.anchor_hint.as_str() {
                "n" => dy <= 0.0,
                "s" => dy >= 0.0,
                "e" => dx >= 0.0,
                "w" => dx <= 0.0,
                _ => true,
            }
        };
        let score = |i: usize| {
            let mut dx = (i % projection.width) as f64 + 0.5 - p[0];
            dx -= (dx / projection.width as f64).round() * projection.width as f64;
            let dy = (i / projection.width) as f64 + 0.5 - p[1];
            (dx * place.lonlat[1].to_radians().cos()).powi(2) + dy.powi(2)
        };
        let i = candidates
            .iter()
            .copied()
            .filter(|i| !occupied.contains(i) && (!port || satisfies(*i)))
            .min_by(|&a, &b| score(a).total_cmp(&score(b)).then(a.cmp(&b)))
            .with_context(|| format!("{} 找不到{}", place.key, if port { "岸边海洋锚地" } else { "陆格" }))?;
        let offset = score(i).sqrt() * 111.195 * projection.arcmin as f64 / 60.0;
        ensure!(offset <= 400.0, "{} 锚地偏移过大：{offset:.1} km", place.key);
        occupied.insert(i);
        result.push(Anchor {
            key: place.key.clone(),
            name: place.name.clone(),
            lonlat: place.lonlat,
            pos: [i % projection.width, i / projection.width],
            offset_km: (offset * 100.0).round() / 100.0,
            hint: place.anchor_hint.clone(),
            hint_satisfied: satisfies(i),
            realm: place.realm.is_some(),
        });
    }
    Ok(result)
}

/// 小岛与湾口在半格阈值下可能粘住大陆。只把原始覆盖率不足95%的近岸格开成泊地，
/// 保留岛格和明确陆障，不在完整陆格中开凿人工运河。
pub fn harbor_patches(
    projection: Projection,
    land: &mut [bool],
    coverage: &[f64],
    protected: &[usize],
    places: &[Place],
    barriers: &[Passage],
) -> Result<Vec<PatchReport>> {
    let mut report = Vec::new();
    let protected = protected.iter().copied().collect::<BTreeSet<_>>();
    for place in places.iter().filter(|p| p.realm.is_none() && p.anchor_hint != "river") {
        let current = anchors(projection, land, std::slice::from_ref(place), true);
        if current.as_ref().is_ok_and(|a| a[0].offset_km <= 60.0) {
            continue;
        }
        let (labels, sizes) = components(projection, land, false);
        let ocean = sizes.iter().enumerate().max_by_key(|&(_, s)| s).map(|(i, _)| i).context("没有海洋")?;
        let projected = projection.project(place.lonlat);
        let mut candidates = Vec::new();
        for dy in -2..=2 {
            for dx in -2..=2 {
                let Some(i) = projection.index(projected[0].floor() as i64 + dx, projected[1].floor() as i64 + dy)
                else {
                    continue;
                };
                if !land[i]
                    || coverage[i] >= 0.95
                    || protected.contains(&i)
                    || !projection.neighbors(i).any(|j| labels[j] == ocean)
                {
                    continue;
                }
                let p = projection.center(i);
                let matches = match place.anchor_hint.as_str() {
                    "n" => p[1] >= place.lonlat[1],
                    "s" => p[1] <= place.lonlat[1],
                    "e" => p[0] >= place.lonlat[0],
                    "w" => p[0] <= place.lonlat[0],
                    _ => true,
                };
                if matches {
                    let d = ((p[0] - place.lonlat[0]) * place.lonlat[1].to_radians().cos()).powi(2)
                        + (p[1] - place.lonlat[1]).powi(2);
                    candidates.push((i, d));
                }
            }
        }
        candidates.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
        for (i, _) in candidates {
            land[i] = false;
            let safe = validate_passages(projection, land, barriers).is_ok();
            if safe {
                let pos = [i % projection.width, i / projection.width];
                report.push(PatchReport {
                    key: format!("harbor_{}", place.key),
                    name: format!("{}近岸泊地", place.name),
                    land: false,
                    changed: vec![pos],
                    path: vec![pos],
                });
                break;
            }
            land[i] = true;
        }
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn water_patch_is_four_connected_and_land_barrier_blocks_shortcuts() {
        let p = Projection { width: 12, height: 8, west: 0, north: 480, arcmin: 60 };
        let mut land = vec![true; 96];
        let passage = Passage {
            key: "test".into(),
            name: "测试峡".into(),
            points: vec![[1.5, 6.5], [8.5, 2.5]],
            bounds: [0.0, 0.0, 12.0, 8.0],
            land: false,
            probes: vec![],
        };
        apply(p, &mut land, std::slice::from_ref(&passage), &[]).expect("补丁");
        validate_passages(p, &land, &[passage]).expect("四通");
        land.fill(false);
        for x in 0..12 {
            land[4 * 12 + x] = true;
        }
        assert!(!connected(p, &land, 12, 72, [0.0, 0.0, 12.0, 8.0]));
    }

    #[test]
    fn anchors_are_unique_directional_ocean_cells_and_cities_are_land() {
        let p = Projection { width: 10, height: 6, west: 0, north: 360, arcmin: 60 };
        let mut land = vec![false; 60];
        for y in 1..5 {
            for x in 2..5 {
                land[y * 10 + x] = true;
            }
        }
        // 内陆湖不是港口候选。
        land[23] = false;
        let places = vec![
            Place { key: "a".into(), name: "甲".into(), lonlat: [4.4, 3.5], anchor_hint: "e".into(), realm: None },
            Place { key: "b".into(), name: "乙".into(), lonlat: [4.4, 3.5], anchor_hint: "e".into(), realm: None },
        ];
        let ports = anchors(p, &land, &places, true).expect("锚地");
        assert_ne!(ports[0].pos, ports[1].pos);
        assert!(ports.iter().all(|a| a.pos[0] >= 5 && a.hint_satisfied));
        let cities = anchors(p, &land, &places, false).expect("城址");
        assert!(cities.iter().all(|a| land[a.pos[1] * 10 + a.pos[0]]));
    }

    #[test]
    fn channel_detours_without_erasing_a_protected_port_island() {
        let p = Projection { width: 10, height: 6, west: 0, north: 360, arcmin: 60 };
        let mut land = vec![true; 60];
        let island = 24;
        let passage = Passage {
            key: "island".into(),
            name: "岛旁水道".into(),
            points: vec![[1.5, 3.5], [8.5, 3.5]],
            bounds: [0.0, 0.0, 10.0, 6.0],
            land: false,
            probes: vec![],
        };
        apply(p, &mut land, std::slice::from_ref(&passage), &[island]).expect("绕岛补丁");
        assert!(land[island]);
        validate_passages(p, &land, &[passage]).expect("水道仍通");
    }
}
