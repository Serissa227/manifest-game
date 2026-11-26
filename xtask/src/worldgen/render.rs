//! 调试大图：植被 + 地形晕渲 + 河流 + 地标 + 地点；高程分层设色；海区划分。

use super::grid::Grid;
use super::hydro::River;
use super::png::Canvas;
use super::terrain::Terrain;

/// 地标（渲染用）。
pub struct Mark {
    pub pos: (usize, usize),
    pub size: (usize, usize),
    pub category: String,
}

/// 地点（渲染用）。
pub struct Dot {
    pub pos: (usize, usize),
    /// 0 港口 1 城市 2 殖民点 3 发现物
    pub kind: u8,
}

pub fn biome_color(b: u8) -> [u8; 3] {
    match b {
        b'I' => [238, 243, 248],
        b'T' => [168, 172, 146],
        b'B' => [58, 98, 72],
        b'F' => [84, 142, 72],
        b'G' => [156, 188, 98],
        b'M' => [166, 164, 96],
        b'K' => [204, 188, 124],
        b'D' => [232, 208, 150],
        b'S' => [196, 182, 92],
        b'J' => [36, 108, 52],
        b'W' => [92, 132, 116],
        b'A' => [152, 146, 140],
        b'V' => [96, 62, 56],
        b'X' => [178, 96, 210],
        _ => [255, 0, 255],
    }
}

fn shade(t: &Terrain, x: usize, y: usize) -> f64 {
    let e = |dx: i32, dy: i32| -> f64 {
        let (nx, ny) = ((x as i32 + dx).clamp(0, t.elev.w as i32 - 1), (y as i32 + dy).clamp(0, t.elev.h as i32 - 1));
        t.elev.get(nx as usize, ny as usize).max(0.0)
    };
    let g = (e(-1, -1) + e(-1, 0) + e(0, -1)) - (e(1, 1) + e(1, 0) + e(0, 1));
    (1.0 + g / 1400.0).clamp(0.62, 1.38)
}

fn mul(c: [u8; 3], k: f64) -> [u8; 3] {
    [(c[0] as f64 * k).min(255.0) as u8, (c[1] as f64 * k).min(255.0) as u8, (c[2] as f64 * k).min(255.0) as u8]
}

fn sea_color(t: &Terrain, x: usize, y: usize) -> [u8; 3] {
    if t.shallow.get(x, y) {
        [74, 132, 178]
    } else {
        let d = t.dist_land.get(x, y).min(20.0);
        let k = 1.0 - d / 60.0;
        mul([34, 72, 124], k)
    }
}

fn overlay(c: &mut Canvas, k: usize, rivers: &[River], marks: &[Mark], dots: &[Dot], roads: &[Vec<(usize, usize)>]) {
    let ki = k as i64;
    for r in roads {
        for w in r.windows(2) {
            let (a, b) = (w[0], w[1]);
            c.line(
                a.0 as i64 * ki + ki / 2,
                a.1 as i64 * ki + ki / 2,
                b.0 as i64 * ki + ki / 2,
                b.1 as i64 * ki + ki / 2,
                1,
                [150, 60, 30],
            );
        }
    }
    for r in rivers {
        let t = if k >= 4 { r.width as i64 } else { 1 };
        for w in r.path.windows(2) {
            let (a, b) = (w[0], w[1]);
            c.line(
                a.0 as i64 * ki + ki / 2,
                a.1 as i64 * ki + ki / 2,
                b.0 as i64 * ki + ki / 2,
                b.1 as i64 * ki + ki / 2,
                t,
                [40, 110, 220],
            );
        }
    }
    for m in marks {
        let col = match m.category.as_str() {
            "natural" => [40, 220, 200],
            "arcane" => [230, 80, 255],
            "ancient" => [255, 200, 60],
            _ => [255, 255, 255],
        };
        let (x, y) = (m.pos.0 as i64 * ki, m.pos.1 as i64 * ki);
        let (w, h) = (m.size.0 as i64 * ki, m.size.1 as i64 * ki);
        for i in 0..w.max(ki) {
            c.put(x + i, y, col);
            c.put(x + i, y + h.max(ki) - 1, col);
        }
        for j in 0..h.max(ki) {
            c.put(x, y + j, col);
            c.put(x + w.max(ki) - 1, y + j, col);
        }
    }
    for d in dots {
        let col = match d.kind {
            0 => [230, 30, 30],
            1 => [255, 255, 255],
            2 => [255, 230, 40],
            _ => [255, 60, 200],
        };
        let (x, y) = (d.pos.0 as i64 * ki, d.pos.1 as i64 * ki);
        let s = (ki - 1).max(1);
        c.rect(x, y, s, s, [0, 0, 0]);
        c.rect(x + 1, y + 1, (s - 2).max(1), (s - 2).max(1), col);
    }
}

/// 植被 + 晕渲（道路画成棕色细线）。
pub fn biomes(
    t: &Terrain,
    b: &Grid<u8>,
    k: usize,
    rivers: &[River],
    marks: &[Mark],
    dots: &[Dot],
    roads: &[Vec<(usize, usize)>],
) -> Canvas {
    let (w, h) = (t.land.w, t.land.h);
    let mut c = Canvas::new(w * k, h * k);
    for y in 0..h {
        for x in 0..w {
            let col = if t.land.get(x, y) { mul(biome_color(b.get(x, y)), shade(t, x, y)) } else { sea_color(t, x, y) };
            c.rect((x * k) as i64, (y * k) as i64, k as i64, k as i64, col);
        }
    }
    overlay(&mut c, k, rivers, marks, dots, roads);
    c
}

/// 高程分层设色 + 晕渲。
pub fn relief(t: &Terrain, r: &Grid<u8>, k: usize, rivers: &[River]) -> Canvas {
    const TINT: [[u8; 3]; 10] = [
        [88, 150, 90],
        [128, 172, 96],
        [170, 188, 110],
        [206, 200, 128],
        [214, 182, 118],
        [196, 150, 100],
        [170, 120, 86],
        [146, 104, 84],
        [190, 184, 180],
        [248, 248, 250],
    ];
    let (w, h) = (t.land.w, t.land.h);
    let mut c = Canvas::new(w * k, h * k);
    for y in 0..h {
        for x in 0..w {
            let col = if t.land.get(x, y) {
                mul(TINT[r.get(x, y).min(9) as usize], shade(t, x, y))
            } else {
                sea_color(t, x, y)
            };
            c.rect((x * k) as i64, (y * k) as i64, k as i64, k as i64, col);
        }
    }
    overlay(&mut c, k, rivers, &[], &[], &[]);
    c
}

/// 海区：每个海区一种颜色，陆地灰。
pub fn seas(t: &Terrain, owner: &Grid<u16>, k: usize, seeds: &[Vec<(usize, usize)>]) -> Canvas {
    let (w, h) = (t.land.w, t.land.h);
    let mut c = Canvas::new(w * k, h * k);
    let color = |r: u16| -> [u8; 3] {
        let v = super::noise::mix(r as u64 * 7919 + 13);
        [(80 + (v & 0x7f)) as u8, (80 + ((v >> 8) & 0x7f)) as u8, (80 + ((v >> 16) & 0x7f)) as u8]
    };
    for y in 0..h {
        for x in 0..w {
            let col = if t.land.get(x, y) {
                [70, 70, 70]
            } else {
                let o = owner.get(x, y);
                let edge = [(1i32, 0i32), (0, 1)]
                    .iter()
                    .any(|&(dx, dy)| owner.at(x as i32 + dx, y as i32 + dy).is_some_and(|v| v != o && v != u16::MAX));
                if edge { [20, 20, 20] } else { mul(color(o), if t.shallow.get(x, y) { 1.15 } else { 1.0 }) }
            };
            c.rect((x * k) as i64, (y * k) as i64, k as i64, k as i64, col);
        }
    }
    for list in seeds {
        for &(x, y) in list {
            c.rect((x * k) as i64, (y * k) as i64, k as i64, k as i64, [255, 255, 255]);
        }
    }
    c
}

/// 汇流量（对数）：看水系是否成树枝状。
pub fn flow(t: &Terrain, acc: &[f64], k: usize) -> Canvas {
    let (w, h) = (t.land.w, t.land.h);
    let mut c = Canvas::new(w * k, h * k);
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let col = if t.land.get(x, y) {
                let v = (acc[i].max(1.0).ln() / 8.0).clamp(0.0, 1.0);
                [(30.0 + 40.0 * (1.0 - v)) as u8, (40.0 + 60.0 * (1.0 - v)) as u8, (40.0 + 215.0 * v) as u8]
            } else {
                [0, 0, 0]
            };
            c.rect((x * k) as i64, (y * k) as i64, k as i64, k as i64, col);
        }
    }
    c
}
