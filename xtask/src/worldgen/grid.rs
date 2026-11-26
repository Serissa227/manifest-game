//! 网格工具：二维数组、邻域、距离变换与连通性（与内核一致：八方向、不斜穿陆角）。

use std::collections::VecDeque;

/// 八个方向（0 = 北，顺时针），与 `manifest_core::nav::DIRS` 一致。
pub const N8: [(i32, i32); 8] = [(0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1)];
/// 四个正交方向。
pub const N4: [(i32, i32); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];

/// 二维网格（行优先）。
#[derive(Clone, Debug)]
pub struct Grid<T> {
    pub w: usize,
    pub h: usize,
    pub v: Vec<T>,
}

impl<T: Clone> Grid<T> {
    pub fn new(w: usize, h: usize, fill: T) -> Self {
        Grid { w, h, v: vec![fill; w * h] }
    }

    pub fn from_fn(w: usize, h: usize, mut f: impl FnMut(usize, usize) -> T) -> Self {
        let mut v = Vec::with_capacity(w * h);
        for y in 0..h {
            for x in 0..w {
                v.push(f(x, y));
            }
        }
        Grid { w, h, v }
    }

    #[inline]
    pub fn get(&self, x: usize, y: usize) -> T {
        self.v[y * self.w + x].clone()
    }

    #[inline]
    pub fn set(&mut self, x: usize, y: usize, val: T) {
        let i = y * self.w + x;
        self.v[i] = val;
    }

    #[inline]
    pub fn inside(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && (x as usize) < self.w && (y as usize) < self.h
    }

    /// 带越界检查的取值。
    pub fn at(&self, x: i32, y: i32) -> Option<T> {
        self.inside(x, y).then(|| self.get(x as usize, y as usize))
    }
}

/// 某格的八邻域下标（越界的跳过）。
pub fn neighbors8(w: usize, h: usize, i: usize) -> impl Iterator<Item = (usize, usize)> {
    let (x, y) = ((i % w) as i32, (i / w) as i32);
    N8.iter().enumerate().filter_map(move |(d, &(dx, dy))| {
        let (nx, ny) = (x + dx, y + dy);
        (nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h).then(|| (d, ny as usize * w + nx as usize))
    })
}

/// 距离变换：到 `target` 为真的格的近似欧氏距离（八方向倒角距离，对角 √2）。
pub fn distance_to(mask: &Grid<bool>, target: bool) -> Grid<f64> {
    let (w, h) = (mask.w, mask.h);
    let big: f64 = 1e9;
    let mut d: Grid<f64> = Grid::from_fn(w, h, |x, y| if mask.get(x, y) == target { 0.0 } else { big });
    let diag = std::f64::consts::SQRT_2;
    // 两遍倒角
    for y in 0..h {
        for x in 0..w {
            let mut v = d.get(x, y);
            if x > 0 {
                v = v.min(d.get(x - 1, y) + 1.0);
            }
            if y > 0 {
                v = v.min(d.get(x, y - 1) + 1.0);
                if x > 0 {
                    v = v.min(d.get(x - 1, y - 1) + diag);
                }
                if x + 1 < w {
                    v = v.min(d.get(x + 1, y - 1) + diag);
                }
            }
            d.set(x, y, v);
        }
    }
    for y in (0..h).rev() {
        for x in (0..w).rev() {
            let mut v = d.get(x, y);
            if x + 1 < w {
                v = v.min(d.get(x + 1, y) + 1.0);
            }
            if y + 1 < h {
                v = v.min(d.get(x, y + 1) + 1.0);
                if x + 1 < w {
                    v = v.min(d.get(x + 1, y + 1) + diag);
                }
                if x > 0 {
                    v = v.min(d.get(x - 1, y + 1) + diag);
                }
            }
            d.set(x, y, v);
        }
    }
    d
}

/// 海格连通性：从 `start` 出发能到达的海格（八方向，不斜穿两块陆地之间的缝隙）。
pub fn sea_reach(land: &Grid<bool>, starts: &[(usize, usize)]) -> Grid<bool> {
    let (w, h) = (land.w, land.h);
    let mut seen = Grid::new(w, h, false);
    let mut q = VecDeque::new();
    for &(x, y) in starts {
        if !land.get(x, y) && !seen.get(x, y) {
            seen.set(x, y, true);
            q.push_back((x, y));
        }
    }
    while let Some((x, y)) = q.pop_front() {
        for &(dx, dy) in &N8 {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if !land.inside(nx, ny) {
                continue;
            }
            let (ux, uy) = (nx as usize, ny as usize);
            if land.get(ux, uy) || seen.get(ux, uy) {
                continue;
            }
            if dx != 0 && dy != 0 && land.get(ux, y) && land.get(x, uy) {
                continue;
            }
            seen.set(ux, uy, true);
            q.push_back((ux, uy));
        }
    }
    seen
}

/// 按四邻域标记连通块，返回（每格的块编号，各块大小）。`want` 为要标记的值。
pub fn components4(mask: &Grid<bool>, want: bool) -> (Grid<u32>, Vec<usize>) {
    let (w, h) = (mask.w, mask.h);
    let mut id = Grid::new(w, h, u32::MAX);
    let mut sizes = Vec::new();
    for sy in 0..h {
        for sx in 0..w {
            if mask.get(sx, sy) != want || id.get(sx, sy) != u32::MAX {
                continue;
            }
            let c = sizes.len() as u32;
            let mut n = 0usize;
            let mut stack = vec![(sx, sy)];
            id.set(sx, sy, c);
            while let Some((x, y)) = stack.pop() {
                n += 1;
                for &(dx, dy) in &N4 {
                    let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                    if mask.inside(nx, ny) {
                        let (ux, uy) = (nx as usize, ny as usize);
                        if mask.get(ux, uy) == want && id.get(ux, uy) == u32::MAX {
                            id.set(ux, uy, c);
                            stack.push((ux, uy));
                        }
                    }
                }
            }
            sizes.push(n);
        }
    }
    (id, sizes)
}

/// 可分离的盒式模糊（半径 r），边缘按夹取处理。
pub fn blur(g: &Grid<f64>, r: usize) -> Grid<f64> {
    if r == 0 {
        return g.clone();
    }
    let (w, h) = (g.w, g.h);
    let mut tmp = Grid::new(w, h, 0.0);
    let n = (2 * r + 1) as f64;
    for y in 0..h {
        for x in 0..w {
            let mut s = 0.0;
            for k in 0..=2 * r {
                let xx = (x as i64 + k as i64 - r as i64).clamp(0, w as i64 - 1) as usize;
                s += g.get(xx, y);
            }
            tmp.set(x, y, s / n);
        }
    }
    let mut out = Grid::new(w, h, 0.0);
    for y in 0..h {
        for x in 0..w {
            let mut s = 0.0;
            for k in 0..=2 * r {
                let yy = (y as i64 + k as i64 - r as i64).clamp(0, h as i64 - 1) as usize;
                s += tmp.get(x, yy);
            }
            out.set(x, y, s / n);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distance_transform_is_reasonable() {
        let mut m = Grid::new(20, 10, false);
        m.set(5, 5, true);
        let d = distance_to(&m, true);
        assert_eq!(d.get(5, 5), 0.0);
        assert_eq!(d.get(8, 5), 3.0);
        assert!((d.get(7, 7) - 2.0 * std::f64::consts::SQRT_2).abs() < 1e-9);
    }

    #[test]
    fn sea_reach_does_not_cut_corners() {
        // . #
        // # .
        let mut land = Grid::new(2, 2, false);
        land.set(1, 0, true);
        land.set(0, 1, true);
        let r = sea_reach(&land, &[(0, 0)]);
        assert!(r.get(0, 0) && !r.get(1, 1));
    }
}
