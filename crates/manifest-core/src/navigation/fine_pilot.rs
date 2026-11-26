//! 领航在细海岸里找路（第九批 M02“细碰撞”）。
//!
//! 领航沿粗格路径走，逐分钟对准下一格的格心。船在“骨架”上（格心连线）时那条直线一定是水；
//! 船若被玩家开到了格子的角落，直线可能被细层的陆挡住。这里把“所在粗格 → 下一粗格”圈成一个小窗口
//! （两格并排是 2 × 1，斜向是 2 × 2，最多 3 × 3），在窗口的细格上回答两件事：
//!
//! - 从船位到下一格格心的直线通不通（与积分器的扫掠同一套走法：逐 1/256 格、不斜穿细格的陆角）；
//! - 不通时，沿细格上的最短路（从格心倒着搜一遍，每个细格记下朝格心走的下一格）找出
//!   直线看得见的最远一点，让船先朝那一点走。船所在的细格到不了格心，就是堵死了。
//!
//! 全部是整数运算，搜索用二叉堆、同代价按细格下标先后，结果只由静态数据与窗口决定。

use super::SubCell;
use crate::Cell;
use crate::nav::{FineCoast, FineKind, SeaMap};
use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// 窗口每边最多几个粗格；再大（船离路径太远）就不在细格上找路了，照旧对准格心、靠试走避岸。
const MAX_SPAN: i64 = 3;
const UNREACHED: u32 = u32::MAX;
/// 八个方向，偶数是正向、奇数是斜向（与 `nav::DIRS` 的次序相同）。
const DIRS: [(i64, i64); 8] = [(0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1)];
/// 细格上一步的代价：正向 5、斜向 7（约 1 : 1.4）；紧贴陆的细格另加 4，让路尽量离岸一格。
const STRAIGHT: u32 = 5;
const DIAGONAL: u32 = 7;
const HUG: u32 = 4;

/// 这一分钟该朝哪里走。
pub(super) enum Aim {
    /// 窗口里全是水（或窗口太大不管）：照旧对准下一格的格心，抢风也照旧一舷走到底。
    Open,
    /// 窗口里有陆，但到下一格格心的直线是通的：对准格心。
    Centre,
    /// 直线被挡住：先朝这一点走（相对船位的位移，1/256 格）。
    Via([i64; 2]),
    /// 船所在的细格到不了下一格的格心。
    Blocked,
}

pub(super) struct FineWindow {
    cur: Cell,
    next: Cell,
    /// None：开阔。
    grid: Option<Grid>,
}

struct Grid {
    /// 窗口左上角的定点位置（一粗格 256 份）。
    origin: [i64; 2],
    /// 东西环绕的地图：整张图的定点宽度；不环绕为 0。
    wrap: i64,
    sub: i64,
    /// 窗口的细格数。
    fw: i64,
    fh: i64,
    /// 每个细格能不能走：所在粗格能走，并且细格是水。
    open: Vec<bool>,
    /// 下一格格心在窗口里的定点位置。
    goal: [i64; 2],
    /// 每个细格朝格心走的下一格（格心所在的细格指向自己）；第一次要绕路时才算。
    toward: Vec<u32>,
}

impl FineWindow {
    /// 圈出窗口。`navigable` 是粗格能不能走（与扫掠同一条规则）。
    pub(super) fn build(
        map: &SeaMap,
        fine: &FineCoast,
        cur: Cell,
        next: Cell,
        navigable: impl Fn(Cell) -> bool,
    ) -> Self {
        let topology = map.topology();
        let (ddx, ddy) = (i64::from(topology.dx(cur.x, next.x)), i64::from(next.y) - i64::from(cur.y));
        let (w, h) = (ddx.abs() + 1, ddy.abs() + 1);
        let open_sea = Self { cur, next, grid: None };
        if w > MAX_SPAN || h > MAX_SPAN {
            return open_sea;
        }
        // 左上角的粗格（横向是展开坐标，跨接缝时可以为负）
        let (x0, y0) = (i64::from(cur.x) + ddx.min(0), i64::from(cur.y) + ddy.min(0));
        let cells: Vec<Option<Cell>> =
            (0..w * h).map(|i| topology.normalize(x0 + i % w, y0 + i / w).filter(|c| navigable(*c))).collect();
        if cells.iter().all(|c| c.is_some_and(|c| fine.kind(c) == FineKind::Water)) {
            return open_sea;
        }
        let sub = i64::from(fine.sub());
        let (fw, fh) = (w * sub, h * sub);
        let mut open = vec![false; (fw * fh) as usize];
        for (i, cell) in cells.iter().enumerate() {
            let Some(cell) = *cell else { continue };
            let kind = fine.kind(cell);
            if kind == FineKind::Land {
                continue;
            }
            let (cx, cy) = (i as i64 % w, i as i64 / w);
            for fy in 0..sub {
                for fx in 0..sub {
                    if kind == FineKind::Water || fine.water(cell, fx as u16, fy as u16) {
                        open[((cy * sub + fy) * fw + cx * sub + fx) as usize] = true;
                    }
                }
            }
        }
        let width = i64::from(map.width);
        let wrap = if map.wrap_x { width * SubCell::SCALE } else { 0 };
        let x0 = if map.wrap_x { x0.rem_euclid(width.max(1)) } else { x0 };
        Self {
            cur,
            next,
            grid: Some(Grid {
                origin: [x0 * SubCell::SCALE, y0 * SubCell::SCALE],
                wrap,
                sub,
                fw,
                fh,
                open,
                goal: [
                    ddx.max(0) * SubCell::SCALE + SubCell::SCALE / 2,
                    ddy.max(0) * SubCell::SCALE + SubCell::SCALE / 2,
                ],
                toward: Vec::new(),
            }),
        }
    }

    pub(super) fn matches(&self, cur: Cell, next: Cell) -> bool {
        self.cur == cur && self.next == next
    }

    /// 从船位 `pos` 出发该朝哪里走。
    pub(super) fn aim(&mut self, pos: SubCell) -> Aim {
        let Some(grid) = &mut self.grid else { return Aim::Open };
        let from = grid.local(pos);
        if grid.index(grid.fine_of(from)).is_none() || grid.line_clear(from, grid.goal) {
            return Aim::Centre;
        }
        grid.route();
        let Some(mut at) = grid.index(grid.fine_of(from)).filter(|&i| grid.toward[i] != UNREACHED) else {
            return Aim::Blocked;
        };
        // 沿最短路往前看：直线看得见的最远一格。紧挨着的下一格一定看得见（正向相邻，或斜向且夹着的两格都是水）。
        let mut via = None;
        loop {
            let next = grid.toward[at] as usize;
            if next == at {
                break;
            }
            let centre = grid.centre_of(next);
            if !grid.line_clear(from, centre) {
                break;
            }
            via = Some(centre);
            at = next;
        }
        match via {
            Some(point) => Aim::Via([point[0] - from[0], point[1] - from[1]]),
            None => Aim::Blocked,
        }
    }
}

impl Grid {
    /// 船位在窗口里的定点位置。
    fn local(&self, pos: SubCell) -> [i64; 2] {
        let x = pos.x - self.origin[0];
        [if self.wrap > 0 { x.rem_euclid(self.wrap) } else { x }, pos.y - self.origin[1]]
    }

    /// 窗口里的定点位置落在哪个细格（窗口左上角是整粗格，所以与整张图上的细格划分一致）。
    fn fine_of(&self, point: [i64; 2]) -> [i64; 2] {
        [(point[0] * self.sub).div_euclid(SubCell::SCALE), (point[1] * self.sub).div_euclid(SubCell::SCALE)]
    }

    fn index(&self, fine: [i64; 2]) -> Option<usize> {
        (fine[0] >= 0 && fine[1] >= 0 && fine[0] < self.fw && fine[1] < self.fh)
            .then(|| (fine[1] * self.fw + fine[0]) as usize)
    }

    /// 窗口外一律不能走。
    fn is_open(&self, fine: [i64; 2]) -> bool {
        self.index(fine).is_some_and(|i| self.open[i])
    }

    /// 细格中点在窗口里的定点位置（落在这个细格里）。
    fn centre_of(&self, index: usize) -> [i64; 2] {
        let (fx, fy) = (index as i64 % self.fw, index as i64 / self.fw);
        [(fx * SubCell::SCALE + SubCell::SCALE / 2) / self.sub, (fy * SubCell::SCALE + SubCell::SCALE / 2) / self.sub]
    }

    /// 从 `from` 到 `to` 的直线通不通：与积分器的扫掠同一套走法（逐 1/256 格取点，换了细格才查；
    /// 落脚的细格要能走），但斜着换细格时比扫掠更严：夹着的两格都要能走（扫掠只挡两格都是陆的掐口）。
    /// 这里判通的直线，扫掠一定放行。起点所在的细格不查。
    fn line_clear(&self, from: [i64; 2], to: [i64; 2]) -> bool {
        let delta = [to[0] - from[0], to[1] - from[1]];
        let count = delta[0].abs().max(delta[1].abs());
        let mut last = self.fine_of(from);
        for step in 1..=count {
            let fine = self.fine_of([from[0] + delta[0] * step / count, from[1] + delta[1] * step / count]);
            if fine == last {
                continue;
            }
            if !self.is_open(fine)
                || (fine[0] != last[0]
                    && fine[1] != last[1]
                    && (!self.is_open([fine[0], last[1]]) || !self.is_open([last[0], fine[1]])))
            {
                return false;
            }
            last = fine;
        }
        true
    }

    /// 从下一格格心所在的细格倒着搜一遍最短路（八方向，不斜穿陆角），每个能到的细格记下朝格心走的下一格。
    fn route(&mut self) {
        if !self.toward.is_empty() {
            return;
        }
        let cells = (self.fw * self.fh) as usize;
        let mut toward = vec![UNREACHED; cells];
        let mut cost = vec![u32::MAX; cells];
        // 紧贴陆（或窗口边）的细格：走进去多算一点代价
        let hug: Vec<bool> = (0..cells)
            .map(|i| {
                let (x, y) = (i as i64 % self.fw, i as i64 / self.fw);
                DIRS.iter().any(|(dx, dy)| !self.is_open([x + dx, y + dy]))
            })
            .collect();
        if let Some(goal) = self.index(self.fine_of(self.goal)).filter(|&g| self.open[g]) {
            let mut heap = BinaryHeap::new();
            cost[goal] = 0;
            toward[goal] = goal as u32;
            heap.push(Reverse((0u32, goal as u32)));
            while let Some(Reverse((spent, at))) = heap.pop() {
                if cost[at as usize] != spent {
                    continue;
                }
                let (x, y) = (i64::from(at) % self.fw, i64::from(at) / self.fw);
                for (dir, (dx, dy)) in DIRS.iter().enumerate() {
                    let Some(to) = self.index([x + dx, y + dy]).filter(|&i| self.open[i]) else { continue };
                    let diagonal = dir % 2 == 1;
                    if diagonal && (!self.is_open([x + dx, y]) || !self.is_open([x, y + dy])) {
                        continue;
                    }
                    let total = spent + if diagonal { DIAGONAL } else { STRAIGHT } + if hug[to] { HUG } else { 0 };
                    if total < cost[to] {
                        cost[to] = total;
                        toward[to] = at;
                        heap.push(Reverse((total, to as u32)));
                    }
                }
            }
        }
        self.toward = toward;
    }
}

/// 读档修正用：船位压在细海岸的陆上时，同一粗格里离它最近的水。
///
/// 只在“与格心连着”的水里挑（从格心所在的细格出发在这一粗格里漫一遍，八方向、不斜穿陆角）：
/// 这样挪过去的船一定开得出来，不会落进一小块与外面不通的水洼。落点是那个细格的中点；
/// 同样近的取行、列靠前的。格心本身不是水（数据加载时已经查过，不会发生）就放在格心。
pub(crate) fn nearest_fine_water(fine: &FineCoast, pos: SubCell) -> SubCell {
    let cell = pos.cell();
    let centre = SubCell::center(cell);
    let sub = i64::from(fine.sub());
    let water = |fx: i64, fy: i64| fx >= 0 && fy >= 0 && fx < sub && fy < sub && fine.water(cell, fx as u16, fy as u16);
    let middle = i64::from(fine.fine_index(SubCell::SCALE / 2));
    if !water(middle, middle) {
        return centre;
    }
    let mut seen = vec![false; (sub * sub) as usize];
    let mut stack = vec![(middle, middle)];
    seen[(middle * sub + middle) as usize] = true;
    let (origin_x, origin_y) = (i64::from(cell.x) * SubCell::SCALE, i64::from(cell.y) * SubCell::SCALE);
    let mut best: Option<(i64, i64, i64)> = None;
    while let Some((fx, fy)) = stack.pop() {
        let point = (origin_x + fine.fine_center(fx as u16), origin_y + fine.fine_center(fy as u16));
        let distance = (point.0 - pos.x).pow(2) + (point.1 - pos.y).pow(2);
        if best.is_none_or(|b| (distance, fy, fx) < b) {
            best = Some((distance, fy, fx));
        }
        for (dir, (dx, dy)) in DIRS.iter().enumerate() {
            let (nx, ny) = (fx + dx, fy + dy);
            if !water(nx, ny) || (dir % 2 == 1 && (!water(nx, fy) || !water(fx, ny))) {
                continue;
            }
            let i = (ny * sub + nx) as usize;
            if !seen[i] {
                seen[i] = true;
                stack.push((nx, ny));
            }
        }
    }
    match best {
        Some((_, fy, fx)) => {
            SubCell { x: origin_x + fine.fine_center(fx as u16), y: origin_y + fine.fine_center(fy as u16) }
        }
        None => centre,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nav::Terrain;

    /// 3 × 2 粗格的海图，细分 24；`land(fx, fy)` 给出细层的陆。
    fn fixture(wrap: bool, land: impl Fn(u32, u32) -> bool) -> (SeaMap, FineCoast) {
        let map = SeaMap { width: 3, height: 2, wrap_x: wrap, terrain: vec![Terrain::Deep; 6], region: vec![0; 6] };
        let fine = FineCoast::from_fn(3, 2, 24, |fx, fy| !land(fx, fy)).unwrap();
        (map, fine)
    }

    fn at(cell: Cell, fx: i64, fy: i64) -> SubCell {
        // 细格 (fx, fy) 的中点
        SubCell {
            x: i64::from(cell.x) * 256 + (fx * 256 + 128) / 24,
            y: i64::from(cell.y) * 256 + (fy * 256 + 128) / 24,
        }
    }

    #[test]
    fn all_water_windows_are_open_and_far_windows_are_left_alone() {
        let (map, fine) = fixture(false, |fx, _| fx >= 66);
        let mut window = FineWindow::build(&map, &fine, Cell::new(0, 0), Cell::new(1, 0), |_| true);
        assert!(matches!(window.aim(SubCell::center(Cell::new(0, 0))), Aim::Open));
        // (2,0) 有陆：窗口不再开阔，格心连线是通的
        let mut window = FineWindow::build(&map, &fine, Cell::new(1, 0), Cell::new(2, 0), |_| true);
        assert!(matches!(window.aim(SubCell::center(Cell::new(1, 0))), Aim::Centre));
        // 粗格不能走也算有陆：斜着去 (1,1)，夹着的 (1,0) 不能走，格心连线正好擦过它的角，要从 (0,1) 绕
        let mut window = FineWindow::build(&map, &fine, Cell::new(0, 0), Cell::new(1, 1), |c| c != Cell::new(1, 0));
        assert!(matches!(window.aim(SubCell::center(Cell::new(0, 0))), Aim::Via(_)));
        let big = SeaMap { width: 9, height: 2, wrap_x: false, terrain: vec![Terrain::Deep; 18], region: vec![0; 18] };
        let coast = FineCoast::from_fn(9, 2, 24, |fx, _| fx % 7 != 0).unwrap();
        let mut window = FineWindow::build(&big, &coast, Cell::new(0, 0), Cell::new(5, 0), |_| true);
        assert!(matches!(window.aim(SubCell::center(Cell::new(0, 0))), Aim::Open), "隔得太远不找路");
    }

    #[test]
    fn a_wall_between_the_ship_and_the_centre_is_walked_around() {
        // 船在 (0,0) 的右上角（细格 (20,2)），要去 (1,0) 的格心（细格 (36,12)）。
        // 西边一堵竖墙（x = 16，y ≤ 17），南边一堵横墙（y = 6，x 从 17 到 40）：直线被横墙挡住，
        // 只能先向东走过横墙的东头（x ≥ 41），再折回西南。
        let land = |fx: u32, fy: u32| (fx == 16 && fy <= 17) || (fy == 6 && (17..=40).contains(&fx));
        let (map, fine) = fixture(false, land);
        let (cur, next) = (Cell::new(0, 0), Cell::new(1, 0));
        let mut window = FineWindow::build(&map, &fine, cur, next, |_| true);
        let ship = at(cur, 20, 2);
        let Aim::Via(first) = window.aim(ship) else { panic!("直线被横墙挡住，应当绕路") };
        // 一路照着走到格心：每一步的直线都是通的，最后直线看得见格心
        let grid = window.grid.as_ref().unwrap();
        assert!(grid.line_clear(grid.local(ship), [grid.local(ship)[0] + first[0], grid.local(ship)[1] + first[1]]));
        let mut pos = ship;
        let mut legs = 0;
        let mut east = 0;
        loop {
            match window.aim(pos) {
                Aim::Via([dx, dy]) => {
                    pos = SubCell { x: pos.x + dx, y: pos.y + dy };
                    assert!(fine.water_at(pos.x, pos.y), "拐点在水里");
                    east = east.max(pos.x * 24 / 256);
                    legs += 1;
                    assert!(legs < 60, "拐点应当越走越近");
                }
                Aim::Centre => break,
                Aim::Open | Aim::Blocked => panic!("不该开阔，也不该堵死"),
            }
        }
        assert!(legs >= 1);
        // 拐点里有一个已经越过横墙的东头（第 40 列）；最后一个拐点可以就是格心所在的细格
        assert!(east >= 41, "绕过横墙的东头：最东的拐点在第 {east} 列");
        // 同一船位再问一次，答案相同（窗口里只缓存纯函数）
        let mut again = FineWindow::build(&map, &fine, cur, next, |_| true);
        let (Aim::Via(a), Aim::Via(b)) = (again.aim(ship), window.aim(ship)) else { panic!("应当绕路") };
        assert_eq!(a, b);
        assert_eq!(a, first);
    }

    #[test]
    fn an_enclosed_ship_is_reported_blocked() {
        // 船被一圈陆围在 (0,0) 的左上角：x ≤ 8、y ≤ 8 的方块，边上一圈是陆
        let land = |fx: u32, fy: u32| (fx == 8 && fy <= 8) || (fy == 8 && fx <= 8);
        let (map, fine) = fixture(false, land);
        let mut window = FineWindow::build(&map, &fine, Cell::new(0, 0), Cell::new(1, 0), |_| true);
        assert!(matches!(window.aim(at(Cell::new(0, 0), 3, 3)), Aim::Blocked));
        // 圈外的船照常
        assert!(matches!(window.aim(at(Cell::new(0, 0), 12, 12)), Aim::Centre));
        // 只在角上相接的两块陆之间也过不去（不斜穿陆角）：把口子留成斜角
        let land = |fx: u32, fy: u32| (fx == 8 && fy <= 7) || (fy == 8 && fx <= 7);
        let (map, fine) = fixture(false, land);
        let mut window = FineWindow::build(&map, &fine, Cell::new(0, 0), Cell::new(1, 0), |_| true);
        assert!(matches!(window.aim(at(Cell::new(0, 0), 3, 3)), Aim::Blocked), "斜角的口子不算路");
    }

    #[test]
    fn windows_across_the_seam_use_unwrapped_positions() {
        // 环绕的图：从最东一列 (2,0) 向东越过接缝去最西一列 (0,0)。一堵横墙（y = 10）跨在接缝上：
        // (2,0) 的细格 x ≥ 8（整张图上的 56..71）与 (0,0) 的细格 x ≤ 16，挡住船到格心的直线。
        let land = |fx: u32, fy: u32| fy == 10 && (fx >= 56 || fx <= 16);
        let (map, fine) = fixture(true, land);
        let (cur, next) = (Cell::new(2, 0), Cell::new(0, 0));
        let mut window = FineWindow::build(&map, &fine, cur, next, |_| true);
        let ship = at(cur, 16, 4);
        // 直线从 (2,0) 的右上去 (0,0) 的格心：向东越过接缝，被横墙挡住
        let Aim::Via(mut step) = window.aim(ship) else { panic!("应当绕路") };
        let mut pos = ship;
        for _ in 0..60 {
            pos = SubCell { x: (pos.x + step[0]).rem_euclid(3 * 256), y: pos.y + step[1] };
            assert!(fine.water_at(pos.x, pos.y));
            match window.aim(pos) {
                Aim::Via(next) => step = next,
                Aim::Centre => return,
                Aim::Open | Aim::Blocked => panic!("不该开阔，也不该堵死"),
            }
        }
        panic!("六十步内应当看得见格心");
    }
}
