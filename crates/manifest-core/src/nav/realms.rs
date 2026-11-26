//! 帷幕世界的动态寻路；复用海图缓存中的风流、封冻与纬度代价。
use super::*;
use std::sync::Mutex;

/// 一次寻路的工作区：全图大小的三张表（代价、父指针、是否已定）与待展开的堆。
///
/// 寰宇的海图有四十多万格，原先每次寻路都新开这三张表并填上初值（约 5.6 MB），商会每次出航的校验都要付一遍，
/// 比搜索本身还贵。现在工作区留在网格里轮流用：取出来时只把上一次动过的格子复位，表的内容与新开的一模一样，
/// 所以搜索的每一步、找到的航线都与原来逐位相同。
#[derive(Debug, Default)]
struct Scratch {
    g: Vec<i64>,
    parent: Vec<u32>,
    closed: Vec<bool>,
    /// 这一次写过代价的格子：下次取用时只复位这些
    touched: Vec<u32>,
    heap: BinaryHeap<Reverse<(i64, u32)>>,
}

impl Scratch {
    /// 复位到“全图都没到过”的初态（大小不对就重开）。
    fn reset(&mut self, n: usize) {
        if self.g.len() != n {
            *self = Scratch {
                g: vec![i64::MAX; n],
                parent: vec![u32::MAX; n],
                closed: vec![false; n],
                touched: Vec::new(),
                heap: BinaryHeap::new(),
            };
            return;
        }
        for i in self.touched.drain(..) {
            let i = i as usize;
            self.g[i] = i64::MAX;
            self.parent[i] = u32::MAX;
            self.closed[i] = false;
        }
        self.heap.clear();
    }
}

/// 留着轮流用的工作区（最多留 [`ScratchPool::KEPT`] 份；同时寻路的更多时多出来的现开现弃）。
/// 拷贝网格时不带过去：它只是省分配的缓存。
#[derive(Debug, Default)]
pub(super) struct ScratchPool(Mutex<Vec<Scratch>>);

impl ScratchPool {
    const KEPT: usize = 2;

    fn take(&self, n: usize) -> Scratch {
        let mut scratch = self.0.lock().ok().and_then(|mut pool| pool.pop()).unwrap_or_default();
        scratch.reset(n);
        scratch
    }

    fn put(&self, scratch: Scratch) {
        if let Ok(mut pool) = self.0.lock()
            && pool.len() < Self::KEPT
        {
            pool.push(scratch);
        }
    }
}

impl Clone for ScratchPool {
    fn clone(&self) -> Self {
        Self::default()
    }
}

impl NavGrid {
    pub(crate) fn find_path_allowed(
        &self,
        season: usize,
        start: Cell,
        goal: Cell,
        allowed: impl Fn(Cell) -> bool,
    ) -> Option<Path> {
        if self.check_cell(season, start).is_err()
            || self.check_cell(season, goal).is_err()
            || !allowed(start)
            || !allowed(goal)
        {
            return None;
        }
        let mut scratch = self.scratch.take(self.class.len());
        let path = self.search_allowed(&mut scratch, season, start, goal, allowed);
        self.scratch.put(scratch);
        path
    }

    /// A*：`scratch` 进来时是初态（全图没到过、堆是空的）；每写一格代价就记进 `touched`。
    fn search_allowed(
        &self,
        scratch: &mut Scratch,
        season: usize,
        start: Cell,
        goal: Cell,
        allowed: impl Fn(Cell) -> bool,
    ) -> Option<Path> {
        let Scratch { g, parent, closed, touched, heap } = scratch;
        let s = self.idx(start);
        let g_idx = self.idx(goal);
        let table = &self.seasons[season];
        // 启发值要不要折算、当前格的坐标与代价：在各自的循环外取一次（都不随循环里的写入变）
        let scaled = self.heuristic_scaled();
        g[s] = 0;
        touched.push(s as u32);
        heap.push(Reverse((self.heuristic_by(scaled, start, goal), s as u32)));
        while let Some(Reverse((_, cur))) = heap.pop() {
            let cur = cur as usize;
            if closed[cur] {
                continue;
            }
            if cur == g_idx {
                return Some(self.build_path(season, parent, s, g_idx, g[g_idx]));
            }
            closed[cur] = true;
            let a = self.cell_of(cur);
            let g_cur = g[cur];
            for dir in 0..8usize {
                let Some(next) = self.next_at(season, cur, dir) else { continue };
                // 已定的邻格先排除，再换算坐标、问能不能过（`allowed` 没有副作用，先后不影响结果）
                if closed[next] {
                    continue;
                }
                let b = self.cell_of(next);
                if !allowed(b)
                    || !dir.is_multiple_of(2) && (!allowed(Cell::new(a.x, b.y)) || !allowed(Cell::new(b.x, a.y)))
                {
                    continue;
                }
                let cand = g_cur + self.cost_at(table, next, dir);
                if cand < g[next] {
                    if g[next] == i64::MAX {
                        touched.push(next as u32);
                    }
                    g[next] = cand;
                    parent[next] = cur as u32;
                    heap.push(Reverse((cand + self.heuristic_by(scaled, b, goal), next as u32)));
                }
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defs::RegionDef;

    /// P12 之前的实现，冻结在这里作对照：每次寻路新开三张全图大小的表。
    fn find_path_allowed_before_p12(
        grid: &NavGrid,
        season: usize,
        start: Cell,
        goal: Cell,
        allowed: impl Fn(Cell) -> bool,
    ) -> Option<Path> {
        if grid.check_cell(season, start).is_err()
            || grid.check_cell(season, goal).is_err()
            || !allowed(start)
            || !allowed(goal)
        {
            return None;
        }
        let n = grid.class.len();
        let s = grid.idx(start);
        let g_idx = grid.idx(goal);
        let table = &grid.seasons[season];
        let mut g = vec![i64::MAX; n];
        let mut parent = vec![u32::MAX; n];
        let mut closed = vec![false; n];
        let mut heap = BinaryHeap::new();
        g[s] = 0;
        heap.push(Reverse((grid.heuristic(start, goal), s as u32)));
        while let Some(Reverse((_, cur))) = heap.pop() {
            let cur = cur as usize;
            if closed[cur] {
                continue;
            }
            if cur == g_idx {
                return Some(grid.build_path(season, &parent, s, g_idx, g[g_idx]));
            }
            closed[cur] = true;
            for dir in 0..8usize {
                let Some(next) = grid.next_at(season, cur, dir) else { continue };
                let a = grid.cell_of(cur);
                let b = grid.cell_of(next);
                if closed[next]
                    || !allowed(b)
                    || !dir.is_multiple_of(2) && (!allowed(Cell::new(a.x, b.y)) || !allowed(Cell::new(b.x, a.y)))
                {
                    continue;
                }
                let cand = g[cur] + grid.cost_at(table, next, dir);
                if cand < g[next] {
                    g[next] = cand;
                    parent[next] = cur as u32;
                    heap.push(Reverse((cand + grid.heuristic(b, goal), next as u32)));
                }
            }
        }
        None
    }

    /// 一张有岛、有两片海区的小海图。
    fn grid() -> (NavGrid, u16, u16) {
        let (w, h) = (40u16, 24u16);
        let n = w as usize * h as usize;
        let mut terrain = vec![Terrain::Deep; n];
        let mut region = vec![0u16; n];
        for y in 0..h {
            for x in 0..w {
                let i = y as usize * w as usize + x as usize;
                region[i] = u16::from(x >= 20);
                if (15..25).contains(&x) && (8..16).contains(&y) || (x + y * 3) % 17 == 0 {
                    terrain[i] = Terrain::Land;
                } else if (x * 5 + y) % 11 == 0 {
                    terrain[i] = Terrain::Shallow;
                }
            }
        }
        let map = SeaMap { width: w, height: h, wrap_x: false, terrain, region };
        let regions: Vec<RegionDef> = crate::testkit::tiny_defs().regions.clone();
        (NavGrid::new(&map, &regions), w, h)
    }

    #[test]
    fn reused_scratch_finds_the_same_paths_as_fresh_tables() {
        let (grid, w, h) = grid();
        let mut rng = crate::rng::Rng::derive(12, 0, crate::rng::Domain::Market, 7, 0);
        let cell =
            |rng: &mut crate::rng::Rng| Cell::new(rng.below(u64::from(w)) as u16, rng.below(u64::from(h)) as u16);
        let (mut found, mut blocked) = (0, 0);
        // 连着查几百次：有通的、有不通的（工作区里留着上一次的痕迹）、有被“帷幕”挡住要绕路的
        for round in 0..600u64 {
            let (start, goal) = (cell(&mut rng), cell(&mut rng));
            let season = (round % 4) as usize;
            let veil = Cell::new(rng.below(u64::from(w)) as u16, rng.below(u64::from(h)) as u16);
            let allowed = |c: Cell| match round % 3 {
                0 => true,
                1 => c.x.abs_diff(veil.x) > 2 || c.y.abs_diff(veil.y) > 6,
                _ => c.x != veil.x,
            };
            let old = find_path_allowed_before_p12(&grid, season, start, goal, allowed);
            let new = grid.find_path_allowed(season, start, goal, allowed);
            assert_eq!(new, old, "第 {round} 次：{start:?} → {goal:?}");
            if new.is_some() {
                found += 1;
            } else {
                blocked += 1;
            }
        }
        assert!(found > 100 && blocked > 100, "通与不通都要覆盖到：{found} / {blocked}");
        // 拷贝出来的网格不带工作区，照样能用
        let copy = grid.clone();
        let (a, b) = (Cell::new(1, 1), Cell::new(38, 22));
        assert_eq!(copy.find_path_allowed(0, a, b, |_| true), find_path_allowed_before_p12(&grid, 0, a, b, |_| true));
    }
}
