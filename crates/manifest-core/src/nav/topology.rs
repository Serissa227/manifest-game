//! 纯坐标工具：矩形海图可选东西相接，南北始终有边界。
//!
//! 本模块不判断海陆、不绕过陆角；寻路、探索和范围判断共用坐标规则，调用方另行检查地形。
//! 八方向顺序与 [`super::DIRS`] 一致。宽、高沿用 [`Cell`] 的 u16 范围，零尺寸表示空图。

use super::{DIAG, DIRS, MAX_MULT};
use crate::{Cell, Fx};
use std::collections::VecDeque;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MapTopology {
    pub width: u16,
    pub height: u16,
    pub wrap_x: bool,
}

impl MapTopology {
    pub const fn new(width: u16, height: u16, wrap_x: bool) -> Self {
        Self { width, height, wrap_x }
    }

    pub const fn in_bounds(self, cell: Cell) -> bool {
        cell.x < self.width && cell.y < self.height
    }

    /// 归一化任意整数坐标；只允许东西环绕，南北越界仍返回 None。
    pub fn normalize(self, x: i64, y: i64) -> Option<Cell> {
        if self.width == 0 || y < 0 || y >= i64::from(self.height) {
            return None;
        }
        let x = if self.wrap_x { x.rem_euclid(i64::from(self.width)) } else { x };
        (x >= 0 && x < i64::from(self.width)).then_some(Cell::new(x as u16, y as u16))
    }

    /// 朝向使用最短横向差；半周平局沿用 dx 的符号约定。
    pub fn dir_between(self, a: Cell, b: Cell) -> u8 {
        let dx = self.dx(a.x, b.x).signum();
        let dy = (i32::from(b.y) - i32::from(a.y)).signum();
        DIRS.iter().position(|&(x, y)| x == dx && y == dy).unwrap_or(0) as u8
    }

    /// 从横坐标 a 到 b 的有符号最短差；正值向东。环绕时先按宽度取模。
    /// 偶数宽度的正对面有两条等长路，保留原始差的正负，保证 dx(a,b) = -dx(b,a)。
    /// 不环绕或宽度为零时返回普通平面差；不限制传入坐标在界内。
    pub fn dx(self, a: u16, b: u16) -> i32 {
        let delta = i32::from(b) - i32::from(a);
        if !self.wrap_x || self.width == 0 {
            return delta;
        }
        let width = i32::from(self.width);
        let east = delta.rem_euclid(width);
        if east * 2 > width || (east * 2 == width && delta < 0) { east - width } else { east }
    }

    /// 走一个方向（0 北，顺时针到 7 西北）；越界起点、无效方向或越过南北边界返回 None。
    pub fn neighbor(self, cell: Cell, dir: u8) -> Option<Cell> {
        if !self.in_bounds(cell) {
            return None;
        }
        let &(dx, dy) = DIRS.get(usize::from(dir))?;
        let y = i32::from(cell.y) + dy;
        if y < 0 || y >= i32::from(self.height) {
            return None;
        }
        let x = i32::from(cell.x) + dx;
        let x = if self.wrap_x { x.rem_euclid(i32::from(self.width)) } else { x };
        if x < 0 || x >= i32::from(self.width) {
            return None;
        }
        Some(Cell::new(x as u16, y as u16))
    }

    fn deltas(self, a: Cell, b: Cell) -> (i64, i64) {
        (i64::from(self.dx(a.x, b.x)).abs(), (i64::from(b.y) - i64::from(a.y)).abs())
    }

    /// 八方向几何距离（octile），单位为格；对角线沿用现有的万分之 14142。
    /// 距离不检查地形或阻挡，也不把南北坐标取模。
    pub fn distance(self, a: Cell, b: Cell) -> Fx {
        let (dx, dy) = self.deltas(a, b);
        let (lo, hi) = (dx.min(dy), dx.max(dy));
        Fx::from_int(hi - lo) + DIAG.mul(Fx::from_int(lo))
    }

    /// 与现有 A* 相同的启发式：octile 距离除以最大速度系数，沿用 Fx 的取整。
    pub fn octile_heuristic(self, a: Cell, b: Cell) -> i64 {
        self.distance(a, b).div(MAX_MULT).0
    }

    /// 曼哈顿距离（四方向步数）。
    pub fn manhattan(self, a: Cell, b: Cell) -> i64 {
        let (dx, dy) = self.deltas(a, b);
        dx + dy
    }

    /// 切比雪夫距离（八方向步数），与 nearest_cell 的搜索层数对应。
    pub fn chebyshev(self, a: Cell, b: Cell) -> i64 {
        let (dx, dy) = self.deltas(a, b);
        dx.max(dy)
    }

    /// 欧氏距离的平方；供视野、发现物与殖民范围的整数半径判断使用。
    pub fn squared_distance(self, a: Cell, b: Cell) -> i64 {
        let (dx, dy) = self.deltas(a, b);
        dx * dx + dy * dy
    }

    /// 矩形含四个端点，形状与 RegionDef::rect 相同；只有环绕图允许 x0 > x1 表示跨接缝。
    /// 空图、越界端点、颠倒的南北端点或越界 cell 均不包含任何格。
    pub fn rect_contains(self, rect: (u16, u16, u16, u16), cell: Cell) -> bool {
        let (x0, y0, x1, y1) = rect;
        if !self.in_bounds(cell) || x0 >= self.width || x1 >= self.width || y1 >= self.height || y0 > y1 {
            return false;
        }
        let inside_x =
            if x0 <= x1 { (x0..=x1).contains(&cell.x) } else { self.wrap_x && (cell.x >= x0 || cell.x <= x1) };
        inside_x && (y0..=y1).contains(&cell.y)
    }

    /// 有效矩形的横向格数；无效矩形返回 0。
    pub fn rect_width(self, rect: (u16, u16, u16, u16)) -> i64 {
        let (x0, y0, x1, _) = rect;
        if !self.rect_contains(rect, Cell::new(x0, y0)) {
            return 0;
        }
        if x0 <= x1 { i64::from(x1 - x0) + 1 } else { i64::from(self.width - x0) + i64::from(x1) + 1 }
    }

    /// 按行优先枚举矩形，不重复接缝格；平面图保留原来的行列顺序。
    pub fn rect_cells(self, rect: (u16, u16, u16, u16)) -> impl Iterator<Item = Cell> {
        let (_, y0, _, y1) = rect;
        (y0..=y1.min(self.height.saturating_sub(1))).flat_map(move |y| {
            (0..self.width).map(move |x| Cell::new(x, y)).filter(move |c| self.rect_contains(rect, *c))
        })
    }

    /// 最近的合格格子，accept 接收行优先下标。按八方向 BFS 搜索，不受海陆阻挡。
    /// 同一距离的选择沿用北起顺时针的方向顺序；不环绕时与 SeaMap::nearest_cell 逐格相同。
    /// 越界起点在平面图夹到界内，环绕图的 x 取模、y 夹到界内；空图或没有合格格时为 None。
    pub fn nearest_cell(self, from: Cell, accept: impl Fn(usize) -> bool) -> Option<Cell> {
        if self.width == 0 || self.height == 0 {
            return None;
        }
        let start = Cell::new(
            if self.wrap_x { from.x % self.width } else { from.x.min(self.width - 1) },
            from.y.min(self.height - 1),
        );
        let idx = |c: Cell| usize::from(c.y) * usize::from(self.width) + usize::from(c.x);
        let mut seen = vec![false; usize::from(self.width) * usize::from(self.height)];
        let mut queue = VecDeque::from([start]);
        seen[idx(start)] = true;
        while let Some(cell) = queue.pop_front() {
            if accept(idx(cell)) {
                return Some(cell);
            }
            for dir in 0..8 {
                if let Some(next) = self.neighbor(cell, dir)
                    && !seen[idx(next)]
                {
                    seen[idx(next)] = true;
                    queue.push_back(next);
                }
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nav::{SeaMap, Terrain, octile_heuristic};

    fn open_map(width: u16, height: u16) -> SeaMap {
        let n = usize::from(width) * usize::from(height);
        SeaMap { width, height, wrap_x: false, terrain: vec![Terrain::Deep; n], region: vec![0; n] }
    }

    #[test]
    fn seam_deltas_keep_the_shortest_signed_direction_and_stable_ties() {
        let t = MapTopology::new(10, 4, true);
        for (a, b, expected) in
            [(0, 9, -1), (9, 0, 1), (0, 5, 5), (5, 0, -5), (9, 4, -5), (4, 9, 5), (0, 10, 0), (0, 21, 1)]
        {
            assert_eq!(t.dx(a, b), expected);
        }
        assert_eq!(MapTopology::new(9, 4, true).dx(0, 5), -4);
        for width in 1..=16 {
            let t = MapTopology::new(width, 3, true);
            for a in 0..width {
                for b in 0..width {
                    let ordinary = (i32::from(b) - i32::from(a)).abs();
                    assert_eq!(t.dx(a, b).abs(), ordinary.min(i32::from(width) - ordinary));
                    assert_eq!(t.dx(a, b), -t.dx(b, a));
                }
            }
        }
    }

    #[test]
    fn neighbors_cross_the_seam_but_never_the_north_or_south_boundary() {
        let t = MapTopology::new(6, 4, true);
        assert_eq!(t.neighbor(Cell::new(0, 1), 6), Some(Cell::new(5, 1)));
        assert_eq!(t.neighbor(Cell::new(5, 1), 2), Some(Cell::new(0, 1)));
        assert_eq!(t.neighbor(Cell::new(0, 1), 7), Some(Cell::new(5, 0)));
        assert_eq!(t.neighbor(Cell::new(5, 2), 3), Some(Cell::new(0, 3)));
        for x in 0..t.width {
            for dir in [7, 0, 1] {
                assert_eq!(t.neighbor(Cell::new(x, 0), dir), None);
            }
            for dir in [3, 4, 5] {
                assert_eq!(t.neighbor(Cell::new(x, 3), dir), None);
            }
        }
        assert_eq!(t.neighbor(Cell::new(6, 1), 2), None);
        assert_eq!(t.neighbor(Cell::new(1, 4), 0), None);
        assert_eq!(t.neighbor(Cell::new(1, 1), 8), None);
        assert_eq!(t.neighbor(Cell::new(1, 1), u8::MAX), None);
    }

    #[test]
    fn wrapped_distances_use_each_existing_metric_without_north_south_wrapping() {
        let t = MapTopology::new(10, 8, true);
        let (a, b) = (Cell::new(0, 0), Cell::new(9, 7));
        assert_eq!(t.distance(a, b), Fx::from_int(6) + DIAG);
        assert_eq!(t.manhattan(a, b), 8);
        assert_eq!(t.chebyshev(a, b), 7);
        assert_eq!(t.squared_distance(a, b), 50);
        assert_eq!(t.octile_heuristic(a, b), (Fx::from_int(6) + DIAG).div(MAX_MULT).0);
    }

    #[test]
    fn planar_metrics_and_neighbors_match_existing_algorithms_for_every_pair() {
        let (width, height) = (9, 7);
        let t = MapTopology::new(width, height, false);
        let map = open_map(width, height);
        for a in (0..height).flat_map(|y| (0..width).map(move |x| Cell::new(x, y))) {
            for dir in 0..8 {
                let got = t.neighbor(a, dir).map(|c| map.idx(c));
                assert_eq!(got, map.step(map.idx(a), dir));
            }
            for b in (0..height).flat_map(|y| (0..width).map(move |x| Cell::new(x, y))) {
                let dx = (i64::from(a.x) - i64::from(b.x)).abs();
                let dy = (i64::from(a.y) - i64::from(b.y)).abs();
                assert_eq!(t.dx(a.x, b.x), i32::from(b.x) - i32::from(a.x));
                assert_eq!(
                    t.distance(a, b),
                    Fx::from_int(dx.max(dy) - dx.min(dy)) + DIAG.mul(Fx::from_int(dx.min(dy)))
                );
                assert_eq!(t.octile_heuristic(a, b), octile_heuristic(a, b));
                assert_eq!(t.manhattan(a, b), dx + dy);
                assert_eq!(t.chebyshev(a, b), dx.max(dy));
                assert_eq!(t.squared_distance(a, b), dx * dx + dy * dy);
            }
        }
    }

    #[test]
    fn rectangles_include_endpoints_and_only_wrap_when_enabled() {
        let wrapped = MapTopology::new(8, 5, true);
        let flat = MapTopology { wrap_x: false, ..wrapped };
        for y in 0..5 {
            for x in 0..8 {
                let c = Cell::new(x, y);
                assert_eq!(wrapped.rect_contains((6, 1, 1, 3), c), !(2..6).contains(&x) && (1..=3).contains(&y));
                assert!(!flat.rect_contains((6, 1, 1, 3), c));
                assert_eq!(wrapped.rect_contains((2, 1, 5, 3), c), flat.rect_contains((2, 1, 5, 3), c));
            }
        }
        assert!(wrapped.rect_contains((7, 4, 7, 4), Cell::new(7, 4)));
        assert!(!wrapped.rect_contains((0, 3, 7, 1), Cell::new(0, 2)));
        assert!(!wrapped.rect_contains((0, 0, 8, 4), Cell::new(0, 0)));
        assert!(!wrapped.rect_contains((0, 0, 7, 5), Cell::new(0, 0)));
        assert!(!wrapped.rect_contains((0, 0, 7, 4), Cell::new(8, 4)));
        for x0 in 0..8 {
            for x1 in x0..8 {
                for y0 in 0..5 {
                    for y1 in y0..5 {
                        for y in 0..5 {
                            for x in 0..8 {
                                assert_eq!(
                                    flat.rect_contains((x0, y0, x1, y1), Cell::new(x, y)),
                                    x >= x0 && x <= x1 && y >= y0 && y <= y1
                                );
                            }
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn nearest_sea_crosses_the_seam_and_keeps_direction_order_for_ties() {
        let mut map = open_map(8, 4);
        map.terrain.fill(Terrain::Land);
        for c in [Cell::new(7, 1), Cell::new(2, 2)] {
            let i = map.idx(c);
            map.terrain[i] = Terrain::Deep;
        }
        let t = MapTopology::new(8, 4, true);
        let sea = |i| map.terrain[i] != Terrain::Land;
        assert_eq!(t.nearest_cell(Cell::new(0, 1), sea), Some(Cell::new(7, 1)));
        assert_eq!(t.nearest_cell(Cell::new(8, 1), sea), Some(Cell::new(7, 1)), "起点 x 取模");
        assert_eq!(MapTopology { wrap_x: false, ..t }.nearest_cell(Cell::new(0, 1), sea), Some(Cell::new(2, 2)));
        let map = open_map(8, 4);
        let north_east = Cell::new(1, 0);
        let north_west = Cell::new(7, 0);
        assert_eq!(
            t.nearest_cell(Cell::new(0, 1), |i| [map.idx(north_east), map.idx(north_west)].contains(&i)),
            Some(north_east)
        );
        assert_eq!(t.nearest_cell(Cell::new(0, 1), |_| false), None);
    }

    #[test]
    fn planar_nearest_cell_matches_the_old_bfs_for_all_small_masks_and_origins() {
        // 接入后 SeaMap 委托 topology；另保留接入前的平面 BFS，避免对照退化成自比。
        fn legacy_bfs(map: &SeaMap, from: Cell, accept: impl Fn(usize) -> bool) -> Option<Cell> {
            let start = Cell::new(from.x.min(map.width - 1), from.y.min(map.height - 1));
            let mut seen = vec![false; map.terrain.len()];
            let mut queue = VecDeque::from([map.idx(start)]);
            seen[map.idx(start)] = true;
            while let Some(cur) = queue.pop_front() {
                if accept(cur) {
                    return Some(map.cell_of(cur));
                }
                let c = map.cell_of(cur);
                for &(dx, dy) in &DIRS {
                    let (x, y) = (i32::from(c.x) + dx, i32::from(c.y) + dy);
                    if x < 0 || y < 0 || x >= i32::from(map.width) || y >= i32::from(map.height) {
                        continue;
                    }
                    let next = map.idx(Cell::new(x as u16, y as u16));
                    if !seen[next] {
                        seen[next] = true;
                        queue.push_back(next);
                    }
                }
            }
            None
        }
        let map = open_map(3, 3);
        let t = MapTopology::new(3, 3, false);
        for mask in 0..(1u16 << 9) {
            let accept = |i: usize| mask & (1u16 << i) != 0;
            for y in 0..5 {
                for x in 0..5 {
                    let from = Cell::new(x, y);
                    assert_eq!(
                        t.nearest_cell(from, accept),
                        map.nearest_cell(from, accept),
                        "mask {mask} from {from:?}"
                    );
                    assert_eq!(map.nearest_cell(from, accept), legacy_bfs(&map, from, accept));
                }
            }
        }
    }

    #[test]
    fn wrapped_nearest_cell_always_has_minimum_eight_way_distance() {
        let t = MapTopology::new(5, 3, true);
        for y in 0..t.height {
            for x in 0..t.width {
                let from = Cell::new(x, y);
                for mask in 1..(1u16 << 15) {
                    let accept = |i: usize| mask & (1u16 << i) != 0;
                    let found = t.nearest_cell(from, accept).expect("至少一格合格");
                    let nearest = (0..15)
                        .filter(|&i| accept(i))
                        .map(|i| t.chebyshev(from, Cell::new(i as u16 % 5, i as u16 / 5)))
                        .min()
                        .expect("最小距离");
                    assert_eq!(t.chebyshev(from, found), nearest);
                }
            }
        }
    }

    #[test]
    fn empty_single_column_and_largest_coordinates_are_well_defined() {
        for t in [MapTopology::default(), MapTopology::new(0, 3, true), MapTopology::new(3, 0, true)] {
            assert_eq!(t.neighbor(Cell::new(0, 0), 0), None);
            assert_eq!(t.nearest_cell(Cell::new(0, 0), |_| panic!("空图不调用谓词")), None);
            assert!(!t.rect_contains((0, 0, 0, 0), Cell::new(0, 0)));
        }
        let column = MapTopology::new(1, 3, true);
        assert_eq!(column.neighbor(Cell::new(0, 1), 2), Some(Cell::new(0, 1)));
        assert_eq!(column.neighbor(Cell::new(0, 1), 7), Some(Cell::new(0, 0)));
        assert_eq!(column.nearest_cell(Cell::new(50, 50), |i| i == 0), Some(Cell::new(0, 0)));
        assert_eq!(MapTopology::new(1, 1, true).nearest_cell(Cell::new(0, 0), |_| false), None);
        let flat = MapTopology::new(u16::MAX, u16::MAX, false);
        let a = Cell::new(0, 0);
        let b = Cell::new(u16::MAX - 1, u16::MAX - 1);
        assert_eq!(flat.squared_distance(a, b), 2 * 65_534i64 * 65_534);
        assert_eq!(flat.distance(a, b), DIAG.mul(Fx::from_int(65_534)));
        assert_eq!(MapTopology { wrap_x: true, ..flat }.dx(0, u16::MAX - 1), -1);
    }
}
