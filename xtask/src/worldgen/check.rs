//! 输出图层的自检（EXPANSION.md §10.3）：尺寸、代码、海陆一致、河流在陆上并通海、地标在界内、海区标记与 mark 一致，
//! 以及殖民点的 terrain 与岸上的植被 / 地势一致（与吸附时的规则相同）。
//! 生成器写完文件后调用；单元测试也对仓库里的 data/world/ 跑一遍。正式的加载与校验在 manifest-data 中实现。

use super::grid::{Grid, N8, components4};
use super::places;
use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RiversFile {
    #[serde(default)]
    rivers: Vec<RiverRow>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RiverRow {
    key: String,
    name: String,
    path: Vec<[i64; 2]>,
    width: u8,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LandmarksFile {
    #[serde(default)]
    landmarks: Vec<LandmarkRow>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LandmarkRow {
    key: String,
    name: String,
    category: String,
    kind: String,
    pos: [i64; 2],
    #[serde(default)]
    size: Option<[i64; 2]>,
    #[serde(default)]
    lore: Option<String>,
    #[serde(default)]
    discovery: Option<String>,
}

/// 某个字符是否合法的判定。
type CharTest<'a> = &'a dyn Fn(char) -> bool;

fn grid(path: &Path) -> Result<Vec<Vec<char>>> {
    let text = std::fs::read_to_string(path).with_context(|| format!("读取 {}", path.display()))?;
    Ok(text
        .lines()
        .map(|l| l.trim_end_matches('\r'))
        .filter(|l| !l.starts_with("//") && !l.is_empty())
        .map(|l| l.chars().collect())
        .collect())
}

/// 检查 `world` 目录下的图层，返回发现的问题（空表示通过）。
pub fn check_layers(world: &Path) -> Result<Vec<String>> {
    let mut out = Vec::new();
    let map = grid(&world.join("map.txt"))?;
    let h = map.len();
    let w = map.first().map_or(0, Vec::len);
    let land = |x: usize, y: usize| map[y][x] == '#';
    let inside = |x: i64, y: i64| x >= 0 && y >= 0 && (x as usize) < w && (y as usize) < h;
    let layers: [(&str, CharTest, CharTest); 3] = [
        ("relief.txt", &|c: char| c.is_ascii_digit(), &|c: char| c == '.'),
        ("biomes.txt", &|c: char| c.is_ascii() && super::climate::CODES.contains(&(c as u8)), &|c: char| c == '.'),
        ("seas.txt", &|c: char| c == '#', &|c: char| !matches!(c, '#') && !c.is_whitespace()),
    ];
    for (name, land_ok, sea_ok) in layers {
        let p = world.join(name);
        if !p.exists() {
            continue;
        }
        let g = grid(&p)?;
        if g.len() != h || g.iter().any(|r| r.len() != w) {
            out.push(format!("{name}：尺寸与 map.txt（{w} × {h}）不一致"));
            continue;
        }
        let mut bad = 0usize;
        let mut first = None;
        for (y, row) in g.iter().enumerate() {
            for (x, &c) in row.iter().enumerate() {
                let ok = if land(x, y) { land_ok(c) } else { sea_ok(c) };
                if !ok {
                    bad += 1;
                    first.get_or_insert((x, y, c));
                }
            }
        }
        if let Some((x, y, c)) = first {
            out.push(format!("{name}：{bad} 格与海陆不一致或代码无效，例如 ({x}, {y}) 的“{c}”"));
        }
    }
    // 海区标记与 regions.toml 的 mark 一致
    let seas = world.join("seas.txt");
    if seas.exists() {
        let regions = std::fs::read_to_string(world.join("regions.toml"))?;
        let marks: Vec<char> = regions
            .lines()
            .filter_map(|l| l.trim().strip_prefix("mark"))
            .filter_map(|r| r.trim_start().strip_prefix('='))
            .filter_map(|r| r.trim().trim_matches('"').chars().next())
            .collect();
        let g = grid(&seas)?;
        for (y, row) in g.iter().enumerate() {
            for (x, &c) in row.iter().enumerate() {
                if y < h && x < w && !land(x, y) && !matches!(c, '.' | '~') && !marks.contains(&c) {
                    out.push(format!("seas.txt：({x}, {y}) 的标记“{c}”不在 regions.toml 的 mark 里"));
                    return Ok(out);
                }
            }
        }
    }
    // 河流
    let rp = world.join("rivers.toml");
    if rp.exists() {
        let rf: RiversFile = toml::from_str(&std::fs::read_to_string(&rp)?).context("解析 rivers.toml")?;
        let mut keys = Vec::new();
        for r in &rf.rivers {
            if r.name.is_empty() || keys.contains(&r.key) {
                out.push(format!("rivers.toml：{} 名字为空或 key 重复", r.key));
            }
            keys.push(r.key.clone());
            if !(1..=3).contains(&r.width) || r.path.len() < 2 {
                out.push(format!("rivers.toml：{} 的 width 须为 1–3、path 至少 2 格", r.key));
            }
            for p in &r.path {
                if !inside(p[0], p[1]) || !land(p[0] as usize, p[1] as usize) {
                    out.push(format!("rivers.toml：{} 的 {:?} 不是陆格", r.key, p));
                    break;
                }
            }
            for s in r.path.windows(2) {
                let (dx, dy) = ((s[0][0] - s[1][0]).abs(), (s[0][1] - s[1][1]).abs());
                if dx > 1 || dy > 1 || dx + dy == 0 {
                    out.push(format!("rivers.toml：{} 的路径在 {:?} 处不连续", r.key, s[0]));
                    break;
                }
            }
        }
        // 通海：终点与海正交相邻，或终点落在（或八邻紧挨）另一条通海河流的某格上（支流），反复求不动点——
        // 与 manifest-data 的加载器同一规则
        let sea4 = |m: &[i64; 2]| {
            [(0i64, -1i64), (1, 0), (0, 1), (-1, 0)]
                .iter()
                .any(|(dx, dy)| inside(m[0] + dx, m[1] + dy) && !land((m[0] + dx) as usize, (m[1] + dy) as usize))
        };
        let mut ok: Vec<bool> = rf.rivers.iter().map(|r| r.path.last().is_some_and(sea4)).collect();
        loop {
            let mut changed = false;
            for i in 0..rf.rivers.len() {
                if ok[i] {
                    continue;
                }
                let Some(m) = rf.rivers[i].path.last() else { continue };
                let joins = rf.rivers.iter().enumerate().any(|(j, o)| {
                    j != i && ok[j] && o.path.iter().any(|q| (q[0] - m[0]).abs() <= 1 && (q[1] - m[1]).abs() <= 1)
                });
                if joins {
                    ok[i] = true;
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }
        for (r, ok) in rf.rivers.iter().zip(&ok) {
            if !ok {
                out.push(format!("rivers.toml：{} 的终点 {:?} 既不与海相邻，也没有接到别的河上", r.key, r.path.last()));
            }
        }
    }
    // 地标
    let lp = world.join("landmarks.toml");
    if lp.exists() {
        let lf: LandmarksFile = toml::from_str(&std::fs::read_to_string(&lp)?).context("解析 landmarks.toml")?;
        let disc = std::fs::read_to_string(world.join("discoveries.toml")).unwrap_or_default();
        let mut keys = Vec::new();
        for m in &lf.landmarks {
            if keys.contains(&m.key) || m.name.is_empty() || m.kind.is_empty() {
                out.push(format!("landmarks.toml：{} key 重复或名字 / kind 为空", m.key));
            }
            keys.push(m.key.clone());
            if !matches!(m.category.as_str(), "natural" | "arcane" | "ancient" | "civic") {
                out.push(format!("landmarks.toml：{} 的 category “{}” 无效", m.key, m.category));
            }
            let (sw, sh) = m.size.map_or((1, 1), |s| (s[0], s[1]));
            if sw < 1 || sh < 1 || !inside(m.pos[0], m.pos[1]) || !inside(m.pos[0] + sw - 1, m.pos[1] + sh - 1) {
                out.push(format!("landmarks.toml：{} 超出地图", m.key));
            }
            if let Some(d) = &m.discovery
                && !disc.contains(&format!("key = \"{d}\""))
            {
                out.push(format!("landmarks.toml：{} 的 discovery “{d}” 不在 discoveries.toml 里", m.key));
            }
            let _ = &m.lore;
        }
    }
    // 殖民点的 terrain 与岸上的植被 / 地势一致（与生成器吸附时的规则相同）
    let (bp, rlp) = (world.join("biomes.txt"), world.join("relief.txt"));
    if bp.exists() && rlp.exists() && world.join("overseas.toml").exists() {
        let bio = grid(&bp)?;
        let rel = grid(&rlp)?;
        if bio.len() == h && rel.len() == h && bio.iter().chain(rel.iter()).all(|r| r.len() == w) {
            let lm = Grid::from_fn(w, h, land);
            let (comp, sizes) = components4(&lm, true);
            for p in places::read_all(world)?.iter().filter(|p| p.kind == places::Kind::Site) {
                let (x, y) = p.pos;
                if !inside(x, y) {
                    out.push(format!("overseas.toml：殖民点 {} 超出地图", p.key));
                    continue;
                }
                let tr = p.terrain.as_deref().unwrap_or("forest");
                let m = if tr == "island" {
                    let best = N8
                        .iter()
                        .filter_map(|&(dx, dy)| {
                            let (nx, ny) = (x + dx as i64, y + dy as i64);
                            (inside(nx, ny) && land(nx as usize, ny as usize))
                                .then(|| sizes[comp.get(nx as usize, ny as usize) as usize])
                        })
                        .min()
                        .unwrap_or(usize::MAX);
                    places::island_match(best)
                } else {
                    let (mut ok, mut all) = (0usize, 0usize);
                    for dy in -2i64..=2 {
                        for dx in -2i64..=2 {
                            let (nx, ny) = (x + dx, y + dy);
                            if !inside(nx, ny) || !land(nx as usize, ny as usize) {
                                continue;
                            }
                            let b = bio[ny as usize][nx as usize] as u8;
                            let rl = rel[ny as usize][nx as usize].to_digit(10).unwrap_or(0) as u8;
                            all += 1;
                            if places::terrain_ok(tr, b, rl) {
                                ok += 1;
                            }
                        }
                    }
                    if all == 0 { 0.0 } else { ok as f64 / all as f64 }
                };
                if m < places::SITE_MATCH_MIN {
                    out.push(format!(
                        "overseas.toml：殖民点 {} 的 terrain “{tr}” 与岸上植被不符（吻合度 {m:.2} < {}）",
                        p.key,
                        places::SITE_MATCH_MIN
                    ));
                }
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 仓库里的地理图层必须自洽（生成器的输出或手改后都要满足）。
    #[test]
    fn repository_layers_are_consistent() {
        let world = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("data").join("world");
        let problems = check_layers(&world).unwrap();
        assert!(problems.is_empty(), "{problems:#?}");
    }
}
