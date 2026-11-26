//! 报告里的回归指标：内海沿岸植被占比、各地区植被构成、海岸噪点、浅海宽度分布。
//! 这些数字用来在改骨架或生成器之后快速判断有没有退步（评审时对照）。

use super::climate::BOREAL;
use super::grid::{Grid, N4, components4};
use super::terrain::Terrain;
use std::collections::VecDeque;
use std::fmt::Write as _;

/// 植被构成：按占比从高到低，形如 “M 34% F 28% …”。
fn composition(codes: &[u8]) -> String {
    let mut counts: Vec<(u8, usize)> = Vec::new();
    for &b in codes {
        match counts.iter_mut().find(|(c, _)| *c == b) {
            Some(e) => e.1 += 1,
            None => counts.push((b, 1)),
        }
    }
    counts.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let n = codes.len().max(1) as f64;
    counts.iter().map(|(c, k)| format!("{} {:.0}%", *c as char, 100.0 * *k as f64 / n)).collect::<Vec<_>>().join(" ")
}

/// 配置限定区域内从种子海格出发的泛洪，不越过矩形边界。
fn selected_sea(t: &Terrain, area: &crate::mapgen::config::Coast) -> Grid<bool> {
    let (w, h) = (t.land.w, t.land.h);
    let [x0, y0, x1, y1] = area.rect;
    let mut seen = Grid::new(w, h, false);
    let ok = |x: usize, y: usize| (x0..x1).contains(&x) && (y0..y1).contains(&y) && x < w && y < h && !t.land.get(x, y);
    let mut q = VecDeque::new();
    for &[x, y] in &area.seeds {
        if ok(x, y) && !seen.get(x, y) {
            seen.set(x, y, true);
            q.push_back((x, y));
        }
    }
    while let Some((x, y)) = q.pop_front() {
        for &(dx, dy) in &N4 {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if nx < 0 || ny < 0 {
                continue;
            }
            let (ux, uy) = (nx as usize, ny as usize);
            if ok(ux, uy) && !seen.get(ux, uy) {
                seen.set(ux, uy, true);
                q.push_back((ux, uy));
            }
        }
    }
    seen
}

/// 写报告里的回归指标一节，地区、沿岸范围与针叶林统计均由当前配置指定。
pub fn report(out: &mut String, t: &Terrain, biomes: &Grid<u8>, config: &crate::mapgen::config::Report) {
    let (w, h) = (t.land.w, t.land.h);
    for area in &config.coasts {
        let inner = selected_sea(t, area);
        let mut near = Grid::new(w, h, false);
        let radius = i32::from(area.radius);
        for y in 0..h {
            for x in 0..w {
                if !inner.get(x, y) {
                    continue;
                }
                for dy in -radius..=radius {
                    for dx in -radius..=radius {
                        let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                        if dx * dx + dy * dy <= radius * radius && t.land.at(nx, ny) == Some(true) {
                            near.set(nx as usize, ny as usize, true);
                        }
                    }
                }
            }
        }
        let coast: Vec<u8> = (0..w * h).filter(|&i| near.v[i]).map(|i| biomes.v[i]).collect();
        let _ = writeln!(
            out,
            "{}植被占比（离{} {} 格以内的陆格，共 {} 格）：{}",
            area.name,
            area.sea_name,
            radius,
            coast.len(),
            composition(&coast)
        );
    }
    for area in &config.forests {
        let [x0, y0, x1, y1] = area.rect;
        let forest: Vec<usize> = (0..w * h)
            .filter(|&i| biomes.v[i] == BOREAL && (y0..y1).contains(&(i / w)) && (x0..x1).contains(&(i % w)))
            .collect();
        let low = forest.iter().filter(|&&i| t.elev.v[i] < area.low_elevation).count();
        let _ = writeln!(
            out,
            "{} 的针叶林格数：{}（其中海拔 {:.0} 米以下的低地针叶林 {low} 格，其余是山地针叶林带）",
            area.name,
            forest.len(),
            area.low_elevation
        );
    }
    let _ = writeln!(out, "各地区植被：");
    for area in &config.areas {
        let [x0, y0, x1, y1] = area.rect;
        let v: Vec<u8> = (y0..y1.min(h))
            .flat_map(|y| (x0..x1.min(w)).map(move |x| (x, y)))
            .filter(|&(x, y)| t.land.get(x, y))
            .map(|(x, y)| biomes.get(x, y))
            .collect();
        let _ = writeln!(out, "  {}：{}", area.name, composition(&v));
    }
    // ── 海岸噪点 ──
    let (_, sizes) = components4(&t.land, true);
    let one = sizes.iter().filter(|&&s| s == 1).count();
    let small = sizes.iter().filter(|&&s| s <= 4).count();
    let land = |x: i32, y: i32| t.land.at(x, y).unwrap_or(true);
    let (mut gap_w, mut gap_kept, mut gap_l) = (0usize, 0usize, 0usize);
    for y in 0..h as i32 {
        for x in 0..w as i32 {
            let me = land(x, y);
            let ns = land(x, y - 1) == land(x, y + 1) && land(x, y - 1) != me;
            let ew = land(x - 1, y) == land(x + 1, y) && land(x - 1, y) != me;
            if !(ns || ew) {
                continue;
            }
            if me {
                gap_l += 1;
            } else {
                gap_w += 1;
                if t.keep_sea.get(x as usize, y as usize) {
                    gap_kept += 1;
                }
            }
        }
    }
    let _ = writeln!(
        out,
        "海岸噪点：单格岛 {one} 个，≤ 4 格的岛 {small} 个；1 格宽的水格 {gap_w} 个（其中峡湾 / 河口湾 / 水道等保留的 {gap_kept} 个），1 格宽的陆格 {gap_l} 个"
    );
    // ── 浅海宽度 ──
    let mut hist = [0usize; 6];
    let mut total = 0usize;
    for y in 0..h {
        for x in 0..w {
            if t.land.get(x, y) || !t.shallow.get(x, y) {
                continue;
            }
            let d = t.dist_land.get(x, y);
            let k = if d <= 1.0 {
                0
            } else if d <= 2.0 {
                1
            } else if d <= 3.0 {
                2
            } else if d <= 6.0 {
                3
            } else if d <= 10.0 {
                4
            } else {
                5
            };
            hist[k] += 1;
            total += 1;
        }
    }
    let pct = |k: usize| 100.0 * hist[k] as f64 / total.max(1) as f64;
    let _ = writeln!(
        out,
        "浅海离岸距离分布（共 {total} 格）：1 格 {:.0}%，2 格 {:.0}%，3 格 {:.0}%，4–6 格 {:.0}%，7–10 格 {:.0}%，更远 {:.0}%",
        pct(0),
        pct(1),
        pct(2),
        pct(3),
        pct(4),
        pct(5)
    );
    // 近岸海格（紧挨陆地）离深海多远：陆架宽窄的分布（陡岸 0，低平海岸与陆表海宽）
    let deep = Grid::from_fn(w, h, |x, y| !t.land.get(x, y) && !t.shallow.get(x, y));
    let dd = super::grid::distance_to(&deep, true);
    let mut hd = [0usize; 5];
    let mut nd = 0usize;
    for y in 0..h {
        for x in 0..w {
            if t.land.get(x, y) || t.dist_land.get(x, y) > 1.0 {
                continue;
            }
            let d = dd.get(x, y);
            let k = if d < 0.5 {
                0
            } else if d <= 2.0 {
                1
            } else if d <= 4.0 {
                2
            } else if d <= 7.0 {
                3
            } else {
                4
            };
            hd[k] += 1;
            nd += 1;
        }
    }
    let q = |k: usize| 100.0 * hd[k] as f64 / nd.max(1) as f64;
    let _ = writeln!(
        out,
        "近岸海格离深海的距离（共 {nd} 格）：本身是深海 {:.0}%，1–2 格 {:.0}%，3–4 格 {:.0}%，5–7 格 {:.0}%，8 格以上 {:.0}%",
        q(0),
        q(1),
        q(2),
        q(3),
        q(4)
    );
    let deep_fjord = t.fjord.v.iter().filter(|v| **v).count();
    let _ = writeln!(out, "峡湾深水格：{deep_fjord}");
}
