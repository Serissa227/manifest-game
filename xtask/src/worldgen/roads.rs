//! 道路：在陆格上按地势与植被的通行代价寻路（Dijkstra），得出实际长度与主导地形，
//! 可以写回 `roads.toml` 的 `length` 与 `terrain`（`--write-roads`）。
//! 港口在海上，道路从港口旁边的陆格起步；城市就在陆格上。

use super::grid::{Grid, N8};
use super::hydro::River;
use super::places::{Kind, Placed};
use super::terrain::Terrain;
use anyhow::{Context, Result};
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::path::Path;

/// 一条道路的寻路结果。
#[derive(Clone, Debug)]
pub struct RoadOut {
    pub from: String,
    pub to: String,
    /// 实际长度（格，按步长累计）
    pub length: f64,
    /// 两端直线距离（格）
    pub straight: f64,
    /// 主导地形：plain | hill | forest | mountain | desert
    pub terrain: &'static str,
    /// 寻路失败时为 false（两端不在同一块陆地上）
    pub found: bool,
    /// 路径（陆格）
    pub path: Vec<(usize, usize)>,
}

/// 一格的通行代价倍数：高处与密林、湿地难走，高山最难；过河（有桥）加一点。
fn step_cost(b: u8, rl: u8, river: bool) -> f64 {
    let r = match rl {
        0 | 1 => 1.0,
        2 => 1.2,
        3 => 1.5,
        4 => 2.0,
        5 => 3.0,
        _ => 5.0,
    };
    let v = match b {
        b'J' | b'W' => 1.6,
        b'F' | b'B' => 1.2,
        b'A' | b'I' => 4.0,
        b'X' | b'V' => 2.5,
        b'D' => 1.15,
        _ => 1.0,
    };
    r * v + if river { 0.6 } else { 0.0 }
}

/// 一格的地形类别（与 roads.toml 的 terrain 一致）。
fn class_of(b: u8, rl: u8) -> &'static str {
    if rl >= 5 || b == b'A' {
        "mountain"
    } else if rl >= 3 {
        "hill"
    } else if matches!(b, b'F' | b'B' | b'J') {
        "forest"
    } else if matches!(b, b'D' | b'K') {
        "desert"
    } else {
        "plain"
    }
}

/// 从陆格 a 到陆格 b 的最小代价路径（八方向，不斜穿两块海之间的陆角）。
fn route(t: &Terrain, cost: &Grid<f64>, a: (usize, usize), b: (usize, usize)) -> Option<Vec<(usize, usize)>> {
    let (w, h) = (t.land.w, t.land.h);
    let n = w * h;
    let mut dist = vec![u64::MAX; n];
    let mut prev = vec![usize::MAX; n];
    let start = a.1 * w + a.0;
    let goal = b.1 * w + b.0;
    dist[start] = 0;
    let mut heap = BinaryHeap::new();
    heap.push(Reverse((0u64, start)));
    while let Some(Reverse((d, i))) = heap.pop() {
        if d > dist[i] {
            continue;
        }
        if i == goal {
            break;
        }
        let (x, y) = (i % w, i / w);
        for (k, &(dx, dy)) in N8.iter().enumerate() {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if !t.land.inside(nx, ny) {
                continue;
            }
            let (ux, uy) = (nx as usize, ny as usize);
            if !t.land.get(ux, uy) {
                continue;
            }
            if dx != 0 && dy != 0 && !t.land.get(ux, y) && !t.land.get(x, uy) {
                continue;
            }
            let j = uy * w + ux;
            let len = if k % 2 == 1 { std::f64::consts::SQRT_2 } else { 1.0 };
            // 代价取两格的平均，换成整数（千分之一）保证确定性
            let c = (len * 0.5 * (cost.v[i] + cost.v[j]) * 1000.0).round() as u64;
            let nd = d + c;
            if nd < dist[j] {
                dist[j] = nd;
                prev[j] = i;
                heap.push(Reverse((nd, j)));
            }
        }
    }
    if dist[goal] == u64::MAX {
        return None;
    }
    let mut path = vec![(goal % w, goal / w)];
    let mut c = goal;
    while c != start {
        c = prev[c];
        path.push((c % w, c / w));
    }
    path.reverse();
    Some(path)
}

/// 港口（海格）旁边离另一端最近的陆格；城市就是自身。
fn land_end(t: &Terrain, p: (usize, usize), toward: (usize, usize)) -> (usize, usize) {
    if t.land.get(p.0, p.1) {
        return p;
    }
    let mut best: Option<(i64, (usize, usize))> = None;
    for &(dx, dy) in &N8 {
        let (nx, ny) = (p.0 as i32 + dx, p.1 as i32 + dy);
        if t.land.at(nx, ny) == Some(true) {
            let q = (nx as usize, ny as usize);
            let d = (q.0 as i64 - toward.0 as i64).pow(2) + (q.1 as i64 - toward.1 as i64).pow(2);
            if best.is_none_or(|(b, _)| d < b) {
                best = Some((d, q));
            }
        }
    }
    best.map(|b| b.1).unwrap_or(p)
}

/// 读 roads.toml 的 (from, to) 列表（按顺序）。
fn read_pairs(text: &str) -> Vec<(String, String)> {
    let quoted = |l: &str, f: &str| -> Option<String> {
        let r = l.trim().strip_prefix(f)?.trim_start().strip_prefix('=')?.trim().strip_prefix('"')?;
        Some(r[..r.find('"')?].to_string())
    };
    let mut out = Vec::new();
    let (mut from, mut to): (Option<String>, Option<String>) = (None, None);
    let mut in_road = false;
    for line in text.lines() {
        let t = line.trim();
        if t.starts_with("[[") {
            if let (true, Some(a), Some(b)) = (in_road, from.take(), to.take()) {
                out.push((a, b));
            }
            in_road = t == "[[roads]]";
            continue;
        }
        if in_road {
            if let Some(v) = quoted(t, "from") {
                from = Some(v);
            } else if let Some(v) = quoted(t, "to") {
                to = Some(v);
            }
        }
    }
    if let (true, Some(a), Some(b)) = (in_road, from, to) {
        out.push((a, b));
    }
    out
}

/// 按新地理给每条道路寻路。
pub fn plan(
    world: &Path,
    t: &Terrain,
    biomes: &Grid<u8>,
    relief: &Grid<u8>,
    rivers: &[River],
    placed: &[Placed],
) -> Result<Vec<RoadOut>> {
    let text = std::fs::read_to_string(world.join("roads.toml")).context("读取 roads.toml")?;
    let (w, h) = (t.land.w, t.land.h);
    let mut river = Grid::new(w, h, false);
    for r in rivers {
        for &(x, y) in &r.path {
            river.set(x, y, true);
        }
    }
    let cost = Grid::from_fn(w, h, |x, y| step_cost(biomes.get(x, y), relief.get(x, y), river.get(x, y)));
    let pos = |k: &str| placed.iter().find(|p| p.key == k && matches!(p.kind, Kind::Port | Kind::City)).map(|p| p.new);
    let mut out = Vec::new();
    for (a, b) in read_pairs(&text) {
        let (Some(pa), Some(pb)) = (pos(&a), pos(&b)) else { continue };
        let straight = ((pa.0 as f64 - pb.0 as f64).powi(2) + (pa.1 as f64 - pb.1 as f64).powi(2)).sqrt();
        let (la, lb) = (land_end(t, pa, pb), land_end(t, pb, pa));
        let path = route(t, &cost, la, lb);
        let (length, terrain, found, path) = match path {
            Some(p) => {
                let mut len = 0.0;
                for s in p.windows(2) {
                    len += if s[0].0 != s[1].0 && s[0].1 != s[1].1 { std::f64::consts::SQRT_2 } else { 1.0 };
                }
                // 港口到岸边的一步也算上
                len += if la != pa { 1.0 } else { 0.0 } + if lb != pb { 1.0 } else { 0.0 };
                let mut counts: Vec<(&'static str, usize)> = Vec::new();
                for &(x, y) in &p {
                    let c = class_of(biomes.get(x, y), relief.get(x, y));
                    match counts.iter_mut().find(|(k, _)| *k == c) {
                        Some(e) => e.1 += 1,
                        None => counts.push((c, 1)),
                    }
                }
                let n = p.len().max(1) as f64;
                let share = |k: &str| counts.iter().find(|(c, _)| *c == k).map_or(0.0, |(_, v)| *v as f64 / n);
                // 翻山的路按山路计；否则取占比最大的一类
                let terrain = if share("mountain") >= 0.2 {
                    "mountain"
                } else if share("hill") >= 0.35 {
                    "hill"
                } else {
                    counts.sort_by(|x, y| y.1.cmp(&x.1).then(x.0.cmp(y.0)));
                    counts.first().map_or("plain", |c| c.0)
                };
                (len, terrain, true, p)
            }
            None => (straight * 1.2, "plain", false, Vec::new()),
        };
        out.push(RoadOut { from: a, to: b, length, straight, terrain, found, path });
    }
    Ok(out)
}

/// 把寻路结果写回 roads.toml：只改（或补上）各条道路的 `terrain` 与 `length` 两行，其余行与注释不动。
pub fn rewrite(world: &Path, roads: &[RoadOut]) -> Result<usize> {
    let path = world.join("roads.toml");
    let text = std::fs::read_to_string(&path)?;
    let crlf = text.contains("\r\n");
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    // 找出每个 [[roads]] 块的起止行
    let mut blocks: Vec<(usize, usize)> = Vec::new();
    for (i, l) in lines.iter().enumerate() {
        if l.trim().starts_with("[[") {
            if let Some(last) = blocks.last_mut()
                && last.1 == usize::MAX
            {
                last.1 = i;
            }
            if l.trim() == "[[roads]]" {
                blocks.push((i, usize::MAX));
            }
        }
    }
    if let Some(last) = blocks.last_mut()
        && last.1 == usize::MAX
    {
        last.1 = lines.len();
    }
    let mut changed = 0;
    // 从后往前改，插入行不影响前面的行号
    for (bi, &(s, e)) in blocks.iter().enumerate().rev() {
        let Some(r) = roads.get(bi) else { continue };
        if !r.found {
            continue;
        }
        let len_line = format!("length = {:.0}", r.length.max(1.0));
        let ter_line = format!("terrain = \"{}\"", r.terrain);
        let mut has_len = false;
        // 块尾的空行与下一条的注释不算在块里
        let mut end = e;
        while end > s + 1 && (lines[end - 1].trim().is_empty() || lines[end - 1].trim().starts_with('#')) {
            end -= 1;
        }
        for line in lines.iter_mut().take(end).skip(s + 1) {
            let t = line.trim_start();
            if t.starts_with("length") && t.contains('=') {
                if *line != len_line {
                    *line = len_line.clone();
                    changed += 1;
                }
                has_len = true;
            } else if t.starts_with("terrain") && t.contains('=') && *line != ter_line {
                *line = ter_line.clone();
                changed += 1;
            }
        }
        if !has_len {
            lines.insert(end, len_line);
            changed += 1;
        }
    }
    if changed > 0 {
        let nl = if crlf { "\r\n" } else { "\n" };
        let mut s = lines.join(nl);
        s.push_str(nl);
        std::fs::write(&path, s)?;
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_road_pairs_in_order() {
        let text = "# 注释\n[[roads]]\nfrom = \"a\"\nto = \"b\"\nterrain = \"plain\"\ntoll = 0.02\n\n# 下一条\n[[roads]]\nfrom = \"c\"\nto = \"d\"\n";
        assert_eq!(read_pairs(text), vec![("a".into(), "b".into()), ("c".into(), "d".into())]);
    }

    #[test]
    fn terrain_classes_follow_relief_and_biome() {
        assert_eq!(class_of(b'F', 1), "forest");
        assert_eq!(class_of(b'M', 3), "hill");
        assert_eq!(class_of(b'G', 6), "mountain");
        assert_eq!(class_of(b'D', 0), "desert");
        assert_eq!(class_of(b'M', 0), "plain");
        assert!(step_cost(b'A', 7, false) > step_cost(b'G', 0, true));
    }
}
