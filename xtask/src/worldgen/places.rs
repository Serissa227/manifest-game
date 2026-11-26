//! 地点吸附：把港口、城市、殖民点、发现物放到新地理上合适的格，并可就地改写数据文件里的 `pos`。
//!
//! - 港口：与陆地相邻的海格，优先海湾（周围陆地多）、河口、背风处；
//! - 城市：陆格，优先低地与河边，离海至少两格；
//! - 殖民点：与陆地相邻的海格，岸上 5×5 陆格与 `terrain` 一致的比例至少 [`SITE_MATCH_MIN`]，不够的格不吸附；
//! - 发现物：有对应地标时放在地标处；陆上的发现物离海不超过 4 格（舰队视野能看到）。

use super::climate::{BOREAL, DESERT, FOREST, GRASS, ICE, JUNGLE, MEDIT, SAVANNA, STEPPE, TUNDRA, WETLAND};
use super::grid::{Grid, N8, components4};
use super::hydro::River;
use super::layout::Layout;
use super::terrain::Terrain;
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Port,
    City,
    Site,
    Discovery,
}

/// 数据文件里的一个地点。
#[derive(Clone, Debug)]
pub struct PlaceRef {
    pub file: PathBuf,
    pub kind: Kind,
    pub key: String,
    pub pos: (i64, i64),
    pub terrain: Option<String>,
    /// `pos = […]` 所在的行号（0 起）
    pub line: usize,
}

/// 吸附结果。
#[derive(Clone, Debug)]
pub struct Placed {
    pub key: String,
    pub kind: Kind,
    pub old: (i64, i64),
    pub new: (usize, usize),
    pub note: String,
}

fn parse_pos(line: &str) -> Option<(i64, i64)> {
    let rest = line.trim().strip_prefix("pos")?.trim_start().strip_prefix('=')?;
    let inner = rest.trim().strip_prefix('[')?;
    let inner = &inner[..inner.find(']')?];
    let mut it = inner.split(',').map(|s| s.trim().parse::<i64>());
    Some((it.next()?.ok()?, it.next()?.ok()?))
}

fn quoted(line: &str, field: &str) -> Option<String> {
    let rest = line.trim().strip_prefix(field)?.trim_start().strip_prefix('=')?.trim();
    let rest = rest.strip_prefix('"')?;
    Some(rest[..rest.find('"')?].to_string())
}

/// 正在读的一项：key、terrain、（x, y, pos 行号）。
type Pending = Option<(String, Option<String>, Option<(i64, i64, usize)>)>;

/// 读一个文件里指定表的地点。
fn read_file(path: &Path, table: &str, kind: Kind, out: &mut Vec<PlaceRef>) -> Result<()> {
    let text = std::fs::read_to_string(path).with_context(|| format!("读取 {}", path.display()))?;
    let mut cur: Pending = None;
    let mut in_table = false;
    let flush = |cur: &mut Pending, out: &mut Vec<PlaceRef>| {
        if let Some((key, terrain, Some((x, y, line)))) = cur.take() {
            out.push(PlaceRef { file: path.to_path_buf(), kind, key, pos: (x, y), terrain, line });
        }
    };
    for (i, line) in text.lines().enumerate() {
        let t = line.trim();
        if t.starts_with("[[") {
            flush(&mut cur, out);
            in_table = t == format!("[[{table}]]");
            if in_table {
                cur = Some((String::new(), None, None));
            }
            continue;
        }
        if !in_table {
            continue;
        }
        let Some(c) = cur.as_mut() else { continue };
        if let Some(k) = quoted(t, "key")
            && c.0.is_empty()
        {
            c.0 = k;
        } else if let Some(tr) = quoted(t, "terrain") {
            c.1 = Some(tr);
        } else if let Some((x, y)) = parse_pos(t)
            && c.2.is_none()
        {
            c.2 = Some((x, y, i));
        }
    }
    flush(&mut cur, out);
    Ok(())
}

/// 按 LocId 顺序读出全部地点，再接上发现物。
pub fn read_all(world: &Path) -> Result<Vec<PlaceRef>> {
    let mut out = Vec::new();
    read_file(&world.join("ports.toml"), "ports", Kind::Port, &mut out)?;
    read_file(&world.join("cities.toml"), "cities", Kind::City, &mut out)?;
    let overseas = world.join("overseas.toml");
    if overseas.exists() {
        read_file(&overseas, "ports", Kind::Port, &mut out)?;
        read_file(&overseas, "sites", Kind::Site, &mut out)?;
    }
    let disc = world.join("discoveries.toml");
    if disc.exists() {
        read_file(&disc, "discoveries", Kind::Discovery, &mut out)?;
    }
    Ok(out)
}

/// 吸附所需的地理信息。
pub struct Geo<'a> {
    pub t: &'a Terrain,
    pub biomes: &'a Grid<u8>,
    pub relief: &'a Grid<u8>,
    pub rivers: &'a [River],
    /// 发现物 key → 对应地标的位置
    pub landmark_of: &'a [(String, (usize, usize))],
}

fn touches_land(t: &Terrain, x: usize, y: usize) -> bool {
    N8.iter().any(|&(dx, dy)| t.land.at(x as i32 + dx, y as i32 + dy) == Some(true))
}

fn count_land(t: &Terrain, x: usize, y: usize, r: i32) -> i32 {
    let mut n = 0;
    for dy in -r..=r {
        for dx in -r..=r {
            if t.land.at(x as i32 + dx, y as i32 + dy).unwrap_or(true) {
                n += 1;
            }
        }
    }
    n
}

fn land_biomes_around(g: &Geo, x: usize, y: usize, r: i32) -> Vec<(u8, u8)> {
    let mut v = Vec::new();
    for dy in -r..=r {
        for dx in -r..=r {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if g.t.land.at(nx, ny) == Some(true) {
                v.push((g.biomes.get(nx as usize, ny as usize), g.relief.get(nx as usize, ny as usize)));
            }
        }
    }
    v
}

/// 殖民点的吻合度门槛：岸上 5×5 内的陆格至少这么大比例与 `terrain` 一致（island 要求相邻陆块 ≤ 250 格）。
pub const SITE_MATCH_MIN: f64 = 0.5;

/// 殖民点的 `terrain` 与一格陆地（植被代码、地势等级）是否一致。
pub fn terrain_ok(terrain: &str, b: u8, rl: u8) -> bool {
    match terrain {
        "forest" => b == FOREST || b == BOREAL,
        "plains" => matches!(b, GRASS | SAVANNA | MEDIT | STEPPE) && rl <= 2,
        "hills" => (2..=6).contains(&rl),
        "jungle" => b == JUNGLE,
        "tundra" => b == TUNDRA || b == ICE,
        "desert" => b == DESERT || b == STEPPE,
        "swamp" => b == WETLAND,
        _ => true,
    }
}

/// 岛屿殖民点的吻合度：相邻陆地所在陆块的大小（格）→ 0–1。
pub fn island_match(size: usize) -> f64 {
    if size <= 250 {
        1.0
    } else if size <= 900 {
        0.4
    } else {
        0.0
    }
}

/// 殖民点地形与岸上植被的吻合度（0–1）。
fn terrain_match(g: &Geo, comp: &Grid<u32>, sizes: &[usize], terrain: &str, x: usize, y: usize) -> f64 {
    if terrain == "island" {
        // 相邻陆地所在的陆块足够小
        let mut best = usize::MAX;
        for &(dx, dy) in &N8 {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if g.t.land.at(nx, ny) == Some(true) {
                let c = comp.get(nx as usize, ny as usize);
                if c != u32::MAX {
                    best = best.min(sizes[c as usize]);
                }
            }
        }
        return island_match(best);
    }
    let around = land_biomes_around(g, x, y, 2);
    if around.is_empty() {
        return 0.0;
    }
    around.iter().filter(|&&(b, rl)| terrain_ok(terrain, b, rl)).count() as f64 / around.len() as f64
}

fn river_mouths(rivers: &[River]) -> Vec<(usize, usize)> {
    rivers.iter().filter_map(|r| r.path.last().copied()).collect()
}

fn on_river(rivers: &[River], x: usize, y: usize) -> u8 {
    let mut best = 0;
    for r in rivers {
        for &(px, py) in &r.path {
            let d = (px as i64 - x as i64).abs().max((py as i64 - y as i64).abs());
            if d == 0 {
                best = best.max(r.width + 2);
            } else if d == 1 {
                best = best.max(r.width + 1);
            }
        }
    }
    best
}

/// 吸附全部地点。`used` 防止两个地点落在同一格。殖民点只吸附到吻合度 ≥ [`SITE_MATCH_MIN`] 的格；
/// 半径内找不到时退而取得分最高的格，并把它记进 `violations`（报告列出，自检当作错误）。
pub fn snap(
    l: &Layout,
    g: &Geo,
    places: &[PlaceRef],
    warn: &mut Vec<String>,
    violations: &mut Vec<String>,
) -> Vec<Placed> {
    let t = g.t;
    let (w, h) = (t.land.w, t.land.h);
    let (comp, sizes) = components4(&t.land, true);
    let mouths = river_mouths(g.rivers);
    let mut used: Vec<(usize, usize)> = Vec::new();
    let mut out = Vec::new();
    for p in places {
        let anchor = l.anchor.iter().find(|a| a.key == p.key);
        let (ax, ay) = anchor.map(|a| (a.pos[0], a.pos[1])).unwrap_or((p.pos.0 as f64, p.pos.1 as f64));
        let radius = anchor.map(|a| a.radius).unwrap_or(6.0);
        if p.kind == Kind::Discovery
            && let Some((_, lm)) = g.landmark_of.iter().find(|(k, _)| *k == p.key)
        {
            out.push(Placed { key: p.key.clone(), kind: p.kind, old: p.pos, new: *lm, note: "地标处".into() });
            continue;
        }
        let mut best: Option<(f64, (usize, usize))> = None;
        // 殖民点：吻合度不够的格只作后备
        let mut fallback: Option<(f64, (usize, usize), f64)> = None;
        let r = radius.ceil() as i64;
        for dy in -r..=r {
            for dx in -r..=r {
                let (x, y) = (ax.round() as i64 + dx, ay.round() as i64 + dy);
                if x < 0 || y < 0 || x >= w as i64 || y >= h as i64 {
                    continue;
                }
                let (x, y) = (x as usize, y as usize);
                let d = ((x as f64 - ax).powi(2) + (y as f64 - ay).powi(2)).sqrt();
                if d > radius || used.contains(&(x, y)) {
                    continue;
                }
                let land = t.land.get(x, y);
                let score = match p.kind {
                    Kind::Port => {
                        if land || !touches_land(t, x, y) {
                            continue;
                        }
                        let enc = count_land(t, x, y, 2);
                        let open = super::grid::N4
                            .iter()
                            .filter(|&&(ddx, ddy)| t.land.at(x as i32 + ddx, y as i32 + ddy) == Some(false))
                            .count();
                        if open < 2 {
                            continue;
                        }
                        let mouth = mouths
                            .iter()
                            .map(|&(mx, my)| (mx as i64 - x as i64).abs().max((my as i64 - y as i64).abs()))
                            .min()
                            .unwrap_or(99);
                        let river = match mouth {
                            0 | 1 => 6.0,
                            2 => 3.0,
                            _ => 0.0,
                        };
                        let hab = land_biomes_around(g, x, y, 1)
                            .iter()
                            .filter(|&&(b, _)| !matches!(b, b'A' | b'I' | b'V' | b'X'))
                            .count() as f64;
                        // 只挨着礁岩、海蚀柱这种小岛（≤ 12 格）的海格不当港口（码头要建在像样的陆地上）
                        let biggest = N8
                            .iter()
                            .filter_map(|&(dx, dy)| {
                                let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                                (t.land.at(nx, ny) == Some(true)).then(|| comp.get(nx as usize, ny as usize))
                            })
                            .filter(|&c| c != u32::MAX)
                            .map(|c| sizes[c as usize])
                            .max()
                            .unwrap_or(0);
                        let islet = if biggest <= 12 { 6.0 } else { 0.0 };
                        (enc.min(14) as f64) * 0.9 - (enc - 17).max(0) as f64 * 1.5 + river + 0.6 * hab.min(3.0)
                            - 0.9 * d
                            - islet
                    }
                    Kind::City => {
                        if !land {
                            continue;
                        }
                        let b = g.biomes.get(x, y);
                        let rl = g.relief.get(x, y) as f64;
                        let rv = on_river(g.rivers, x, y) as f64;
                        let ds = t.dist_sea.get(x, y);
                        let bpen = match b {
                            b'W' => 6.0,
                            b'A' | b'I' => 20.0,
                            b'V' => 10.0,
                            b'X' => 30.0,
                            b'D' if rv == 0.0 => 2.0,
                            _ => 0.0,
                        };
                        let inland = if ds >= 2.0 { 2.0 } else { -8.0 };
                        -1.2 * rl - bpen + 2.2 * rv + inland - 0.7 * d
                    }
                    Kind::Site => {
                        if land || !touches_land(t, x, y) {
                            continue;
                        }
                        let tr = p.terrain.as_deref().unwrap_or("forest");
                        let m = terrain_match(g, &comp, &sizes, tr, x, y);
                        let enc = count_land(t, x, y, 1) as f64;
                        let s = 10.0 * m + 0.3 * enc.min(5.0) - 0.8 * d;
                        if m < SITE_MATCH_MIN {
                            if fallback.is_none_or(|(b, _, _)| s > b) {
                                fallback = Some((s, (x, y), m));
                            }
                            continue;
                        }
                        s
                    }
                    Kind::Discovery => {
                        // 陆上的发现物要离海足够近；海上的随意
                        if land && t.dist_sea.get(x, y) > 4.0 {
                            continue;
                        }
                        -d
                    }
                };
                if best.is_none_or(|(b, _)| score > b) {
                    best = Some((score, (x, y)));
                }
            }
        }
        if best.is_none()
            && let Some((s, c, m)) = fallback
        {
            violations.push(format!(
                "殖民点 {}：terrain “{}” 与岸上植被不符（锚点半径 {radius} 内最好的吻合度只有 {m:.2}，至少要 {SITE_MATCH_MIN}），暂放在 {:?}",
                p.key,
                p.terrain.as_deref().unwrap_or("forest"),
                c
            ));
            best = Some((s, c));
        }
        match best {
            Some((s, c)) => {
                if matches!(p.kind, Kind::Port | Kind::Site | Kind::City) {
                    used.push(c);
                }
                out.push(Placed {
                    key: p.key.clone(), kind: p.kind, old: p.pos, new: c, note: format!("得分 {s:.1}")
                });
            }
            None => {
                warn.push(format!("地点 {}：锚点 ({ax}, {ay}) 半径 {radius} 内没有合适的格", p.key));
                out.push(Placed {
                    key: p.key.clone(),
                    kind: p.kind,
                    old: p.pos,
                    new: (p.pos.0.max(0) as usize, p.pos.1.max(0) as usize),
                    note: "未找到，保留原坐标".into(),
                });
            }
        }
    }
    out
}

/// 把吸附结果写回数据文件（只改 `pos = […]` 那一行，保留行尾注释）。
pub fn rewrite(places: &[PlaceRef], placed: &[Placed]) -> Result<usize> {
    let mut changed = 0;
    let mut files: Vec<PathBuf> = places.iter().map(|p| p.file.clone()).collect();
    files.sort();
    files.dedup();
    for f in files {
        let text = std::fs::read_to_string(&f)?;
        let crlf = text.contains("\r\n");
        let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
        let mut dirty = false;
        for (p, q) in places.iter().zip(placed) {
            if p.file != f || p.key != q.key {
                continue;
            }
            if (q.new.0 as i64, q.new.1 as i64) == p.pos {
                continue;
            }
            let line = &lines[p.line];
            let indent: String = line.chars().take_while(|c| c.is_whitespace()).collect();
            let tail = line.find(']').map(|i| line[i + 1..].to_string()).unwrap_or_default();
            lines[p.line] = format!("{indent}pos = [{}, {}]{tail}", q.new.0, q.new.1);
            dirty = true;
            changed += 1;
        }
        if dirty {
            let nl = if crlf { "\r\n" } else { "\n" };
            let mut s = lines.join(nl);
            s.push_str(nl);
            std::fs::write(&f, s)?;
        }
    }
    Ok(changed)
}
