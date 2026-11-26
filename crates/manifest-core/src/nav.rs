//! 海图与寻路。
//!
//! 海图是字符网格（深海、浅海、陆地）。寻路在海格上用 A*，八方向移动，
//! 代价 = 步长 ÷ (风与洋流系数) × 海区危险度系数。港口之间的航线按季节预先计算。

pub mod topology;
pub use topology::MapTopology;
pub mod climate;
pub use climate::{NavError, NavigationRules};
pub mod fine;
pub use fine::{FineCoast, FineCoastError, FineKind};
mod queue;
mod realms;
pub mod routes;
pub use routes::{CompressedPath, RouteMemory};

#[cfg(test)]
#[path = "nav/wrapping_tests.rs"]
mod wrapping_tests;

use crate::defs::{RegionDef, SailType, SeasonWeather};
use crate::fixed::Fx;
use crate::ids::{Cell, LocId, RegionId};
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// 地形。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Terrain {
    Deep,
    Shallow,
    Land,
}

/// 八个方向的位移，0 = 北，顺时针。
pub const DIRS: [(i32, i32); 8] = [(0, -1), (1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1)];

/// 对角步长 √2。
pub const DIAG: Fx = Fx(14_142);

pub fn step_len(dir: u8) -> Fx {
    if dir.is_multiple_of(2) { Fx::ONE } else { DIAG }
}

/// 两个方向的夹角，以 45° 为单位（0–4）。
pub fn angle_diff(a: u8, b: u8) -> u8 {
    let d = (a as i32 - b as i32).rem_euclid(8) as u8;
    if d > 4 { 8 - d } else { d }
}

/// 从 a 走到相邻格 b 的方向。
pub fn dir_between(a: Cell, b: Cell) -> u8 {
    let dx = (b.x as i32 - a.x as i32).signum();
    let dy = (b.y as i32 - a.y as i32).signum();
    DIRS.iter().position(|&(x, y)| x == dx && y == dy).unwrap_or(0) as u8
}

/// 帆装在不同风向夹角下的速度系数（夹角 0 = 顺风）。
const SQUARE_TABLE: [i64; 5] = [12_500, 11_000, 9_000, 6_000, 4_000];
const LATEEN_TABLE: [i64; 5] = [10_500, 11_000, 10_500, 8_500, 6_000];
/// 洋流对速度的影响（每级强度）。
const CURRENT_TABLE: [i64; 5] = [500, 350, 0, -350, -500];

/// 风力系数：风力 5 为 1.0，无风 0.6，风力 10 为 1.4。
fn strength_factor(strength: i64) -> Fx {
    Fx(6_000 + 800 * strength.clamp(0, 10))
}

/// 船在某方向航行时风的速度系数。
pub fn sail_mult(sail: SailType, heading: u8, w: &SeasonWeather) -> Fx {
    let diff = angle_diff(heading, w.wind_dir) as usize;
    let table = match sail {
        SailType::Square => SQUARE_TABLE,
        SailType::Lateen => LATEEN_TABLE,
    };
    Fx(table[diff]).mul(strength_factor(w.wind_strength))
}

/// 洋流的速度系数。
pub fn current_mult(heading: u8, w: &SeasonWeather) -> Fx {
    let diff = angle_diff(heading, w.current_dir) as usize;
    Fx::ONE + Fx(CURRENT_TABLE[diff] * w.current_strength.clamp(0, 3))
}

/// 参考船（横帆与纵帆平均）的综合速度系数。
fn reference_mult(heading: u8, w: &SeasonWeather) -> Fx {
    let sq = sail_mult(SailType::Square, heading, w);
    let lt = sail_mult(SailType::Lateen, heading, w);
    Fx((sq.0 + lt.0) / 2).mul(current_mult(heading, w))
}

/// 可能的最大综合速度系数（启发函数用，保证可采纳）。
const MAX_MULT: Fx = Fx(19_000);

/// 走一步的时间代价：步长 ÷ 风与洋流系数，浅海 +10%，按海区危险度加重。
fn step_cost_of(w: Option<&SeasonWeather>, shallow: bool, dir: u8) -> i64 {
    let len = step_len(dir);
    let (mult, danger) = match w {
        Some(w) => (reference_mult(dir, w), w.storm_bp + w.pirate_bp),
        None => (Fx::ONE, 0),
    };
    let mut t = len.div(mult.max(Fx(2_000)));
    if shallow {
        t = t.mul(Fx(11_000));
    }
    // 危险度：每 200 个万分点使代价增加 100%
    t = t.mul(Fx::ONE + Fx::ratio(danger, 200));
    t.0.max(1)
}

/// 走一步所需的参考时间（参考船、横帆、纵帆，均按 1 格/天 的基础航速）。
fn step_times(w: Option<&SeasonWeather>, dir: u8) -> (Fx, Fx, Fx) {
    let len = step_len(dir);
    match w {
        Some(wt) => {
            let cur = current_mult(dir, wt);
            (
                len.div(reference_mult(dir, wt).max(Fx(2_000))),
                len.div(sail_mult(SailType::Square, dir, wt).mul(cur).max(Fx(2_000))),
                len.div(sail_mult(SailType::Lateen, dir, wt).mul(cur).max(Fx(2_000))),
            )
        }
        None => (len, len, len),
    }
}

/// 八方向网格上的可采纳启发函数（直线距离 ÷ 最大速度系数）。
#[cfg(test)]
fn octile_heuristic(ca: Cell, cb: Cell) -> i64 {
    let dx = (ca.x as i64 - cb.x as i64).abs();
    let dy = (ca.y as i64 - cb.y as i64).abs();
    let (lo, hi) = if dx < dy { (dx, dy) } else { (dy, dx) };
    let octile = Fx::from_int(hi - lo) + DIAG.mul(Fx::from_int(lo));
    octile.div(MAX_MULT).0
}

/// 海图。
#[derive(Clone, Debug)]
pub struct SeaMap {
    pub width: u16,
    pub height: u16,
    /// 东西是否环绕；经典地图为 false，不写入世界状态。
    pub wrap_x: bool,
    pub terrain: Vec<Terrain>,
    /// 每格所属海区；`u16::MAX` 表示陆地或未划分
    pub region: Vec<u16>,
}

impl SeaMap {
    pub fn topology(&self) -> MapTopology {
        MapTopology::new(self.width, self.height, self.wrap_x)
    }

    pub fn dir_between(&self, a: Cell, b: Cell) -> u8 {
        self.topology().dir_between(a, b)
    }

    pub fn idx(&self, c: Cell) -> usize {
        c.y as usize * self.width as usize + c.x as usize
    }

    pub fn cell_of(&self, idx: usize) -> Cell {
        Cell::new((idx % self.width as usize) as u16, (idx / self.width as usize) as u16)
    }

    pub fn in_bounds(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.width as i32 && y < self.height as i32
    }

    pub fn terrain(&self, c: Cell) -> Terrain {
        self.terrain[self.idx(c)]
    }

    pub fn is_sea(&self, c: Cell) -> bool {
        self.terrain(c) != Terrain::Land
    }

    pub fn region_of(&self, c: Cell) -> Option<RegionId> {
        let r = self.region[self.idx(c)];
        (r != u16::MAX).then_some(RegionId(r))
    }

    /// 是否与陆地相邻（港口停泊格需要满足）。
    pub fn touches_land(&self, c: Cell) -> bool {
        (0..8).filter_map(|dir| self.topology().neighbor(c, dir)).any(|n| self.terrain(n) == Terrain::Land)
    }

    /// 格子是否在界内且是海格（越界视为不是海）。
    pub fn is_sea_in_bounds(&self, c: Cell) -> bool {
        self.in_bounds(c.x as i32, c.y as i32) && self.is_sea(c)
    }

    /// 与起点连通的全部海格（八方向，不斜穿陆角）；起点越界或不是海时全为 false。
    pub fn reachable_from(&self, start: Cell) -> Vec<bool> {
        let mut seen = vec![false; self.terrain.len()];
        if !self.is_sea_in_bounds(start) {
            return seen;
        }
        let s = self.idx(start);
        let mut stack = vec![s];
        seen[s] = true;
        while let Some(cur) = stack.pop() {
            for dir in 0..8u8 {
                if let Some(next) = self.step(cur, dir)
                    && !seen[next]
                {
                    seen[next] = true;
                    stack.push(next);
                }
            }
        }
        seen
    }

    /// 离 `from` 最近的、满足 `accept`（参数为格下标）的格：从 `from`（越界时先夹到地图内）出发，
    /// 不分海陆按八方向广度优先搜索，即按切比雪夫距离由近到远、同一距离按固定的方向顺序。找不到时为 None。
    pub fn nearest_cell(&self, from: Cell, accept: impl Fn(usize) -> bool) -> Option<Cell> {
        self.topology().nearest_cell(from, accept)
    }

    /// 某格在某季节的天气。
    pub fn weather<'a>(&self, regions: &'a [RegionDef], c: Cell, season: usize) -> Option<&'a SeasonWeather> {
        self.region_of(c).map(|r| &regions[r.idx()].seasons[season])
    }

    /// 从 idx 沿 dir 走一步到达的海格；越界、陆地或斜穿陆角时返回 None。
    fn step(&self, idx: usize, dir: u8) -> Option<usize> {
        let c = self.cell_of(idx);
        let n = self.topology().neighbor(c, dir)?;
        // 只有一两列时不同方向会落在同一格；使用可由路径格序列还原的规范方向。
        if self.wrap_x && self.width <= 2 && (n == c || self.dir_between(c, n) != dir) {
            return None;
        }
        if !self.is_sea(n) {
            return None;
        }
        if !dir.is_multiple_of(2) {
            // 不允许斜穿两块陆地之间的缝隙
            let a = Cell::new(n.x, c.y);
            let b = Cell::new(c.x, n.y);
            if !self.is_sea(a) && !self.is_sea(b) {
                return None;
            }
        }
        Some(self.idx(n))
    }

    /// 参考船走一步的时间代价（定点，单位"天·格速"）。
    fn step_cost(&self, regions: &[RegionDef], season: usize, to: usize, dir: u8) -> i64 {
        let c = self.cell_of(to);
        step_cost_of(self.weather(regions, c, season), self.terrain[to] == Terrain::Shallow, dir)
    }

    fn heuristic(&self, a: usize, b: usize) -> i64 {
        self.topology().octile_heuristic(self.cell_of(a), self.cell_of(b))
    }

    /// A* 寻路：返回从 start 到 goal 的格子序列（含两端）。
    pub fn find_path(&self, regions: &[RegionDef], season: usize, start: Cell, goal: Cell) -> Option<Path> {
        if !self.is_sea_in_bounds(start) || !self.is_sea_in_bounds(goal) {
            return None;
        }
        let n = self.terrain.len();
        let s = self.idx(start);
        let g_idx = self.idx(goal);
        let mut g = vec![i64::MAX; n];
        let mut parent = vec![u32::MAX; n];
        let mut closed = vec![false; n];
        let mut heap = BinaryHeap::new();
        g[s] = 0;
        heap.push(Reverse((self.heuristic(s, g_idx), s as u32)));
        while let Some(Reverse((_, cur))) = heap.pop() {
            let cur = cur as usize;
            if closed[cur] {
                continue;
            }
            if cur == g_idx {
                return Some(self.build_path(regions, season, &parent, s, g_idx, g[g_idx]));
            }
            closed[cur] = true;
            for dir in 0..8u8 {
                let Some(next) = self.step(cur, dir) else { continue };
                if closed[next] {
                    continue;
                }
                let cand = g[cur] + self.step_cost(regions, season, next, dir);
                if cand < g[next] {
                    g[next] = cand;
                    parent[next] = cur as u32;
                    heap.push(Reverse((cand + self.heuristic(next, g_idx), next as u32)));
                }
            }
        }
        None
    }

    /// 逐格计算（不查表）的参考实现：从某格出发到各目标格的航线。用于校验 [`NavGrid`] 与性能对比。
    pub fn reference_routes(
        &self,
        regions: &[RegionDef],
        season: usize,
        from: Cell,
        targets: &[Cell],
    ) -> Vec<Option<Path>> {
        if !self.is_sea(from) {
            return vec![None; targets.len()];
        }
        let s = self.idx(from);
        let (parent, g) = self.dijkstra(regions, season, s);
        targets
            .iter()
            .map(|t| {
                let goal = self.idx(*t);
                if *t == from || g[goal] == i64::MAX {
                    return None;
                }
                Some(self.build_path(regions, season, &parent, s, goal, g[goal]))
            })
            .collect()
    }

    /// 单源 Dijkstra：返回到全图的父指针与代价（逐格计算的参考实现）。
    fn dijkstra(&self, regions: &[RegionDef], season: usize, start: usize) -> (Vec<u32>, Vec<i64>) {
        let n = self.terrain.len();
        let mut g = vec![i64::MAX; n];
        let mut parent = vec![u32::MAX; n];
        let mut closed = vec![false; n];
        let mut heap = BinaryHeap::new();
        g[start] = 0;
        heap.push(Reverse((0i64, start as u32)));
        while let Some(Reverse((cost, cur))) = heap.pop() {
            let cur = cur as usize;
            if closed[cur] {
                continue;
            }
            closed[cur] = true;
            for dir in 0..8u8 {
                let Some(next) = self.step(cur, dir) else { continue };
                if closed[next] {
                    continue;
                }
                let cand = cost + self.step_cost(regions, season, next, dir);
                if cand < g[next] {
                    g[next] = cand;
                    parent[next] = cur as u32;
                    heap.push(Reverse((cand, next as u32)));
                }
            }
        }
        (parent, g)
    }

    fn build_path(
        &self,
        regions: &[RegionDef],
        season: usize,
        parent: &[u32],
        s: usize,
        goal: usize,
        cost: i64,
    ) -> Path {
        let mut idxs = vec![goal];
        let mut cur = goal;
        while cur != s {
            cur = parent[cur] as usize;
            idxs.push(cur);
        }
        idxs.reverse();
        let cells: Vec<Cell> = idxs.iter().map(|&i| self.cell_of(i)).collect();
        Path::from_cells(self, regions, season, cells, cost)
    }
}

/// 一条航线。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Path {
    pub cells: Vec<Cell>,
    /// 寻路代价
    pub cost: i64,
    /// 几何长度（格）
    pub length: Fx,
    /// 参考船在 1 格/天 基础航速下所需天数；除以船速即得预计天数
    pub time_ref: Fx,
    /// 横帆船在 1 格/天 基础航速下所需天数（计风与洋流）
    pub time_square: Fx,
    /// 纵帆船在 1 格/天 基础航速下所需天数（计风与洋流）
    pub time_lateen: Fx,
}

impl Path {
    fn from_cells(map: &SeaMap, regions: &[RegionDef], season: usize, cells: Vec<Cell>, cost: i64) -> Path {
        let mut length = Fx::ZERO;
        let mut time_ref = Fx::ZERO;
        let mut time_square = Fx::ZERO;
        let mut time_lateen = Fx::ZERO;
        for w in cells.windows(2) {
            let dir = map.dir_between(w[0], w[1]);
            length += step_len(dir);
            let (r, s, l) = step_times(map.weather(regions, w[1], season), dir);
            time_ref += r;
            time_square += s;
            time_lateen += l;
        }
        Path { cells, cost, length, time_ref, time_square, time_lateen }
    }

    /// 以给定基础航速（格/天）估算参考船的天数（向上取整）。
    pub fn estimate_days(&self, speed: Fx) -> i64 {
        ceil_days(self.time_ref, speed)
    }

    /// 某帆装、某基础航速的船走完全程的天数（向上取整）。
    pub fn days_for(&self, sail: SailType, speed: Fx) -> i64 {
        let t = match sail {
            SailType::Square => self.time_square,
            SailType::Lateen => self.time_lateen,
        };
        ceil_days(t, speed)
    }
}

fn ceil_days(time: Fx, speed: Fx) -> i64 {
    if speed.0 <= 0 {
        return i64::MAX / 4;
    }
    let d = time.div(speed);
    ((d.0 + Fx::SCALE - 1) / Fx::SCALE).max(1)
}

/// 某季节的逐步查表（下标：代价类别 × 8 + 方向）。
#[derive(Clone, Debug, Default)]
struct SeasonTable {
    cost: Vec<i64>,
    scaled_cost: Vec<i64>,
    time_ref: Vec<Fx>,
    time_square: Vec<Fx>,
    time_lateen: Vec<Fx>,
}

/// 航线网格：预先算好每个海格的八方向邻接与四季的逐步代价，寻路时只查表。
///
/// 一步的代价只取决于"目标格的海区、是否浅海、方向与季节"，因此按（海区 × 浅海）分类后
/// 每季只需算几百个值；结果与逐格计算（[`SeaMap::find_path`]）完全一致。
#[derive(Clone, Debug, Default)]
pub struct NavGrid {
    width: u16,
    topology: MapTopology,
    /// 每格八个方向的相邻海格下标（下标 idx × 8 + 方向）；`u32::MAX` 表示不可走
    next: Vec<u32>,
    /// 每格的代价类别：海区 × 2 + 是否浅海（无海区的海格归入最后一组）
    class: Vec<u16>,
    seasons: Vec<SeasonTable>,
    rules: Option<NavigationRules>,
    lengths: Vec<[Fx; 8]>,
    factors: Vec<[Fx; 8]>,
    scaled_class: Vec<u32>,
    blocked: Vec<Vec<bool>>,
    ports: Vec<(LocId, Cell)>,
    /// 帷幕世界动态寻路的工作区，轮流用（见 [`realms::ScratchPool`]）；只是省分配，不影响寻路结果
    scratch: realms::ScratchPool,
}

impl NavGrid {
    /// 由海图与海区构建。
    pub fn new(map: &SeaMap, regions: &[RegionDef]) -> NavGrid {
        let n = map.terrain.len();
        let mut next = vec![u32::MAX; n * 8];
        let mut class = vec![u16::MAX; n];
        let none_region = regions.len();
        for idx in 0..n {
            if map.terrain[idx] == Terrain::Land {
                continue;
            }
            for dir in 0..8u8 {
                if let Some(to) = map.step(idx, dir) {
                    next[idx * 8 + dir as usize] = to as u32;
                }
            }
            let r = map.region[idx];
            let r = if (r as usize) < regions.len() { r as usize } else { none_region };
            class[idx] = (r * 2 + usize::from(map.terrain[idx] == Terrain::Shallow)) as u16;
        }
        let classes = (none_region + 1) * 2;
        let seasons = (0..4)
            .map(|season| {
                let mut t = SeasonTable {
                    cost: Vec::with_capacity(classes * 8),
                    time_ref: Vec::with_capacity(classes * 8),
                    time_square: Vec::with_capacity(classes * 8),
                    time_lateen: Vec::with_capacity(classes * 8),
                    scaled_cost: Vec::new(),
                };
                for c in 0..classes {
                    let (r, shallow) = (c / 2, c % 2 == 1);
                    let w = regions.get(r).map(|reg| &reg.seasons[season]);
                    for dir in 0..8u8 {
                        t.cost.push(step_cost_of(w, shallow, dir));
                        let (tr, ts, tl) = step_times(w, dir);
                        t.time_ref.push(tr);
                        t.time_square.push(ts);
                        t.time_lateen.push(tl);
                    }
                }
                t
            })
            .collect();
        NavGrid { width: map.width, topology: map.topology(), next, class, seasons, ..Default::default() }
    }

    /// 新世界的导航网格。封冻港的锚地也禁止穿过，不能借实时寻路绕开入港限制。
    pub fn with_rules(
        map: &SeaMap,
        regions: &[RegionDef],
        ports: &[(LocId, Cell)],
        rules: NavigationRules,
    ) -> Result<Self, NavError> {
        rules.validate(map.topology(), regions.len())?;
        if ports.iter().any(|(_, c)| !map.is_sea_in_bounds(*c))
            || rules.frozen_ports.keys().any(|id| !ports.iter().any(|(p, _)| p == id))
        {
            return Err(NavError::InvalidConfig("港口锚地无效或封冻港不存在".into()));
        }
        let mut grid = Self::new(map, regions);
        grid.ports = ports.to_vec();
        let count = rules.period_count();
        grid.seasons = (0..count)
            .map(|period| {
                let mut table = SeasonTable::default();
                for r in 0..=regions.len() {
                    let w = rules.weather(regions, RegionId(r as u16), period);
                    for shallow in [false, true] {
                        for dir in 0..8 {
                            table.cost.push(step_cost_of(w.as_ref(), shallow, dir));
                            let (tr, ts, tl) = step_times(w.as_ref(), dir);
                            table.time_ref.push(tr);
                            table.time_square.push(ts);
                            table.time_lateen.push(tl);
                        }
                    }
                }
                table
            })
            .collect();
        if rules.projection.as_ref().is_some_and(|p| p.lat_scale) {
            (grid.lengths, grid.factors) =
                (0..map.height).map(|row| climate::row_lengths(rules.projection.as_ref(), row)).unzip();
            // 按实际出现的（行、海区、浅深）分类；不在每次松弛边时做定点乘除。
            let mut classes = std::collections::BTreeMap::new();
            let mut samples = Vec::new();
            grid.scaled_class = vec![u32::MAX; map.terrain.len()];
            for idx in 0..map.terrain.len() {
                if map.terrain[idx] == Terrain::Land {
                    continue;
                }
                let key = (map.cell_of(idx).y, grid.class[idx]);
                let class = *classes.entry(key).or_insert_with(|| {
                    let id = samples.len() as u32;
                    samples.push(idx);
                    id
                });
                grid.scaled_class[idx] = class;
            }
            for table in &mut grid.seasons {
                table.scaled_cost = Vec::with_capacity(samples.len() * 8);
                for &idx in &samples {
                    let row = idx / usize::from(map.width);
                    for dir in 0..8 {
                        table.scaled_cost.push(
                            Fx(table.cost[grid.class[idx] as usize * 8 + dir]).mul(grid.factors[row][dir]).0.max(1),
                        );
                    }
                }
            }
        }
        if !rules.frozen_ports.is_empty() || rules.regions.iter().any(|r| !r.frozen_months.is_empty()) {
            grid.blocked = (0..count)
                .map(|period| {
                    let mut blocked: Vec<bool> =
                        map.region.iter().map(|&r| rules.region_frozen(RegionId(r), period)).collect();
                    for &(id, cell) in ports {
                        if rules.port_frozen(id, period) {
                            blocked[map.idx(cell)] = true;
                        }
                    }
                    blocked
                })
                .collect();
        }
        grid.rules = Some(rules);
        Ok(grid)
    }

    pub fn rules(&self) -> Option<&NavigationRules> {
        self.rules.as_ref()
    }

    pub fn topology(&self) -> MapTopology {
        self.topology
    }

    pub fn period_count(&self) -> usize {
        self.seasons.len()
    }

    pub fn period_on(&self, day: u32) -> usize {
        self.rules.as_ref().map_or_else(|| crate::calendar::season_of(day).index(), |r| r.period_on(day))
    }

    pub fn travel_length(&self, to: Cell, dir: u8) -> Fx {
        self.rules
            .as_ref()
            .and_then(|r| r.projection.as_ref())
            .map_or_else(|| step_len(dir), |p| p.travel_length(to.y, dir))
    }

    fn blocked_at(&self, period: usize, idx: usize) -> bool {
        self.blocked.get(period).is_some_and(|b| b[idx])
    }

    fn next_at(&self, period: usize, idx: usize, dir: usize) -> Option<usize> {
        let next = self.next[idx * 8 + dir];
        if next == u32::MAX {
            return None;
        }
        let next = next as usize;
        if self.blocked_at(period, next) {
            return None;
        }
        if !self.blocked.is_empty() && dir % 2 == 1 {
            let a = self.cell_of(idx);
            let b = self.cell_of(next);
            let x = self.idx(Cell::new(a.x, b.y));
            let y = self.idx(Cell::new(b.x, a.y));
            if (!self.is_sea_idx(x) || self.blocked_at(period, x))
                && (!self.is_sea_idx(y) || self.blocked_at(period, y))
            {
                return None;
            }
        }
        Some(next)
    }

    fn factor(&self, idx: usize, dir: usize) -> Fx {
        self.factors.get(idx / usize::from(self.width.max(1))).map_or(Fx::ONE, |f| f[dir])
    }

    fn cost_at(&self, table: &SeasonTable, idx: usize, dir: usize) -> i64 {
        if self.scaled_class.is_empty() {
            table.cost[self.class[idx] as usize * 8 + dir]
        } else {
            table.scaled_cost[self.scaled_class[idx] as usize * 8 + dir]
        }
    }

    fn heuristic(&self, start: Cell, goal: Cell) -> i64 {
        self.heuristic_by(self.heuristic_scaled(), start, goal)
    }

    /// 启发值要不要按新风场折算（整张网格固定不变：一次寻路里问一次就够）。
    fn heuristic_scaled(&self) -> bool {
        self.rules.as_ref().is_some_and(|r| r.regions.iter().any(|c| !c.weather.is_empty()))
    }

    /// 同 [`NavGrid::heuristic`]，`scaled` 由调用方先取好（[`NavGrid::heuristic_scaled`]）。
    fn heuristic_by(&self, scaled: bool, start: Cell, goal: Cell) -> i64 {
        let value = self.topology.octile_heuristic(start, goal);
        // 新风场允许满风满流；2.1 大于两种帆装平均的最大速度，维持可采纳性。
        if scaled { value * 19 / 21 } else { value }
    }

    /// 封冻原因可直接供命令校验与航行视图使用。
    pub fn check_port(&self, period: usize, port: LocId) -> Result<(), NavError> {
        if period >= self.period_count() {
            return Err(NavError::InvalidPeriod);
        }
        if self.rules.as_ref().is_some_and(|r| r.port_frozen(port, period)) {
            return Err(NavError::FrozenPort);
        }
        if let Some((_, cell)) = self.ports.iter().find(|(p, _)| *p == port) {
            self.check_cell(period, *cell)?;
        }
        Ok(())
    }

    pub fn check_cell(&self, period: usize, cell: Cell) -> Result<(), NavError> {
        if period >= self.period_count() {
            return Err(NavError::InvalidPeriod);
        }
        if !self.topology.in_bounds(cell) || !self.is_sea_idx(self.idx(cell)) {
            return Err(NavError::Unreachable);
        }
        if self.blocked_at(period, self.idx(cell)) {
            if self
                .ports
                .iter()
                .any(|(p, c)| *c == cell && self.rules.as_ref().is_some_and(|r| r.port_frozen(*p, period)))
            {
                return Err(NavError::FrozenPort);
            }
            return Err(NavError::FrozenRegion);
        }
        Ok(())
    }

    pub fn find_path_on(&self, day: u32, start: Cell, goal: Cell) -> Result<Path, NavError> {
        let period = self.period_on(day);
        self.check_cell(period, start)?;
        self.check_cell(period, goal)?;
        self.find_path(period, start, goal).ok_or(NavError::Unreachable)
    }

    pub fn is_empty(&self) -> bool {
        self.class.is_empty()
    }

    fn cell_of(&self, idx: usize) -> Cell {
        let w = self.width.max(1) as usize;
        Cell::new((idx % w) as u16, (idx / w) as u16)
    }

    fn idx(&self, c: Cell) -> usize {
        c.y as usize * self.width as usize + c.x as usize
    }

    fn is_sea_idx(&self, idx: usize) -> bool {
        self.class.get(idx).is_some_and(|c| *c != u16::MAX)
    }

    /// 单源 Dijkstra：返回到全图的父指针与代价。
    fn dijkstra(&self, season: usize, start: usize) -> (Vec<u32>, Vec<i64>) {
        // 每个搜索只选择一次模式，避免每条边反复检查纬度与封冻开关。
        match (self.blocked.is_empty(), self.scaled_class.is_empty()) {
            (true, true) => self.dijkstra_mode::<false, false>(season, start),
            (true, false) => self.dijkstra_mode::<false, true>(season, start),
            (false, true) => self.dijkstra_mode::<true, false>(season, start),
            (false, false) => self.dijkstra_mode::<true, true>(season, start),
        }
    }

    fn dijkstra_mode<const BLOCKED: bool, const SCALED: bool>(
        &self,
        season: usize,
        start: usize,
    ) -> (Vec<u32>, Vec<i64>) {
        let n = self.class.len();
        let table = &self.seasons[season];
        let mut g = vec![i64::MAX; n];
        let mut parent = vec![u32::MAX; n];
        let mut closed = vec![false; n];
        let mut heap = queue::MinQueue::new();
        g[start] = 0;
        heap.push(0, start as u32);
        while let Some((cost, cur)) = heap.pop() {
            let cur = cur as usize;
            if closed[cur] {
                continue;
            }
            closed[cur] = true;
            for dir in 0..8usize {
                let next = if BLOCKED {
                    let Some(next) = self.next_at(season, cur, dir) else { continue };
                    next
                } else {
                    let next = self.next[cur * 8 + dir];
                    if next == u32::MAX {
                        continue;
                    }
                    next as usize
                };
                if closed[next] {
                    continue;
                }
                let step = if SCALED {
                    table.scaled_cost[self.scaled_class[next] as usize * 8 + dir]
                } else {
                    table.cost[self.class[next] as usize * 8 + dir]
                };
                let cand = cost + step;
                if cand < g[next] {
                    g[next] = cand;
                    parent[next] = cur as u32;
                    heap.push(cand, next as u32);
                }
            }
        }
        (parent, g)
    }

    /// 沿父指针还原航线并按查表累计航程与时间。
    fn build_path(&self, season: usize, parent: &[u32], s: usize, goal: usize, cost: i64) -> Path {
        let mut idxs = vec![goal];
        let mut cur = goal;
        while cur != s {
            cur = parent[cur] as usize;
            idxs.push(cur);
        }
        idxs.reverse();
        let table = &self.seasons[season];
        let cells: Vec<Cell> = idxs.iter().map(|&i| self.cell_of(i)).collect();
        let mut length = Fx::ZERO;
        let mut time_ref = Fx::ZERO;
        let mut time_square = Fx::ZERO;
        let mut time_lateen = Fx::ZERO;
        for (w, pair) in cells.windows(2).zip(idxs.windows(2)) {
            let dir = self.topology.dir_between(w[0], w[1]);
            let k = self.class[pair[1]] as usize * 8 + dir as usize;
            length += self.lengths.get(w[1].y as usize).map_or_else(|| step_len(dir), |l| l[dir as usize]);
            let factor = self.factor(pair[1], dir as usize);
            time_ref += table.time_ref[k].mul(factor);
            time_square += table.time_square[k].mul(factor);
            time_lateen += table.time_lateen[k].mul(factor);
        }
        Path { cells, cost, length, time_ref, time_square, time_lateen }
    }

    /// 从某格出发到各目标格的航线（不可达为 None）。
    pub fn routes_from(&self, season: usize, from: Cell, targets: &[Cell]) -> Vec<Option<Path>> {
        let s = self.idx(from);
        if self.check_cell(season, from).is_err() {
            return vec![None; targets.len()];
        }
        let (parent, g) = self.dijkstra(season, s);
        targets
            .iter()
            .map(|t| {
                let goal = self.idx(*t);
                if *t == from || self.check_cell(season, *t).is_err() || g[goal] == i64::MAX {
                    return None;
                }
                Some(self.build_path(season, &parent, s, goal, g[goal]))
            })
            .collect()
    }

    /// A* 寻路：结果与 [`SeaMap::find_path`] 相同，但只查表。
    pub fn find_path(&self, season: usize, start: Cell, goal: Cell) -> Option<Path> {
        let n = self.class.len();
        let s = self.idx(start);
        let g_idx = self.idx(goal);
        if self.check_cell(season, start).is_err() || self.check_cell(season, goal).is_err() {
            return None;
        }
        let table = &self.seasons[season];
        let mut g = vec![i64::MAX; n];
        let mut parent = vec![u32::MAX; n];
        let mut closed = vec![false; n];
        let mut heap = BinaryHeap::new();
        g[s] = 0;
        heap.push(Reverse((self.heuristic(start, goal), s as u32)));
        while let Some(Reverse((_, cur))) = heap.pop() {
            let cur = cur as usize;
            if closed[cur] {
                continue;
            }
            if cur == g_idx {
                return Some(self.build_path(season, &parent, s, g_idx, g[g_idx]));
            }
            closed[cur] = true;
            for dir in 0..8usize {
                let Some(next) = self.next_at(season, cur, dir) else { continue };
                if closed[next] {
                    continue;
                }
                let cand = g[cur] + self.cost_at(table, next, dir);
                if cand < g[next] {
                    g[next] = cand;
                    parent[next] = cur as u32;
                    heap.push(Reverse((cand + self.heuristic(self.cell_of(next), goal), next as u32)));
                }
            }
        }
        None
    }

    /// 与起点连通的全部海格（八方向，不斜穿陆角）。
    pub fn reachable_from(&self, start: Cell) -> Vec<bool> {
        let n = self.class.len();
        let mut seen = vec![false; n];
        let s = self.idx(start);
        if !self.is_sea_idx(s) {
            return seen;
        }
        let mut stack = vec![s];
        seen[s] = true;
        while let Some(cur) = stack.pop() {
            for dir in 0..8usize {
                let next = self.next[cur * 8 + dir];
                if next != u32::MAX && !seen[next as usize] {
                    seen[next as usize] = true;
                    stack.push(next as usize);
                }
            }
        }
        seen
    }
}

/// 一次航线计算任务：某季节从某港口出发到其余港口。
#[derive(Clone, Copy, Debug)]
pub struct NavJob {
    pub season: usize,
    pub from: LocId,
    pub from_cell: Cell,
}

/// 港口之间按季节预计算的航线表，外加寻路用的网格。
#[derive(Clone, Debug, Default)]
pub struct NavTable {
    /// 查表寻路用的网格（殖民点等不在表中的航线实时寻路）
    pub grid: NavGrid,
    /// 地点总数（表的边长）
    loc_count: usize,
    /// 下标：[季节][出发 × 地点总数 + 目的]；非港口或不可达为 None
    paths: Vec<Vec<Option<routes::StoredPath>>>,
    /// 只有旧接口第一次需要 Vec<Cell> 时才分配兼容槽位，压缩缓存不付这个常驻开销。
    expanded: std::sync::OnceLock<Vec<std::sync::OnceLock<Box<Path>>>>,
}

impl NavTable {
    /// 为给定港口（地点下标, 停泊格）计算四季航线（单线程）。
    pub fn build(map: &SeaMap, regions: &[RegionDef], loc_count: usize, ports: &[(LocId, Cell)]) -> NavTable {
        let grid = NavGrid::new(map, regions);
        let jobs = NavTable::jobs(ports);
        let rows: Vec<Vec<Option<Path>>> = jobs.iter().map(|j| NavTable::run_job(&grid, ports, j)).collect();
        NavTable::assemble(grid, loc_count, ports, &jobs, rows)
    }

    /// 全部计算任务（季节 × 出发港）。调用方可以把它们分给多个线程执行（[`NavTable::run_job`]），
    /// 再按同样的顺序交给 [`NavTable::assemble`]。
    pub fn jobs(ports: &[(LocId, Cell)]) -> Vec<NavJob> {
        (0..4)
            .flat_map(|season| ports.iter().map(move |&(from, from_cell)| NavJob { season, from, from_cell }))
            .collect()
    }

    pub fn jobs_for(grid: &NavGrid, ports: &[(LocId, Cell)]) -> Vec<NavJob> {
        (0..grid.period_count())
            .flat_map(|season| ports.iter().map(move |&(from, from_cell)| NavJob { season, from, from_cell }))
            .collect()
    }

    pub fn build_with_rules(
        map: &SeaMap,
        regions: &[RegionDef],
        loc_count: usize,
        ports: &[(LocId, Cell)],
        rules: NavigationRules,
    ) -> Result<Self, NavError> {
        let grid = NavGrid::with_rules(map, regions, ports, rules)?;
        let jobs = Self::jobs_for(&grid, ports);
        let rows = jobs.iter().map(|j| Self::run_job(&grid, ports, j)).collect();
        Ok(Self::assemble(grid, loc_count, ports, &jobs, rows))
    }

    /// 执行一个任务：返回到 `ports` 中每个港口的航线（与自身为 None）。
    pub fn run_job(grid: &NavGrid, ports: &[(LocId, Cell)], job: &NavJob) -> Vec<Option<Path>> {
        let targets: Vec<Cell> = ports.iter().map(|p| p.1).collect();
        let mut row = grid.routes_from(job.season, job.from_cell, &targets);
        for (slot, p) in row.iter_mut().zip(ports) {
            if p.0 == job.from {
                *slot = None;
            }
        }
        row
    }

    pub fn run_compressed_job(grid: &NavGrid, ports: &[(LocId, Cell)], job: &NavJob) -> Vec<Option<CompressedPath>> {
        Self::run_job(grid, ports, job)
            .into_iter()
            .map(|path| path.map(|p| CompressedPath::from_valid_path(&p, grid.topology)))
            .collect()
    }

    /// 把各任务的结果组装成航线表。
    pub fn assemble(
        grid: NavGrid,
        loc_count: usize,
        ports: &[(LocId, Cell)],
        jobs: &[NavJob],
        rows: Vec<Vec<Option<Path>>>,
    ) -> NavTable {
        let mut paths: Vec<Vec<Option<routes::StoredPath>>> =
            (0..grid.period_count()).map(|_| vec![None; loc_count * loc_count]).collect();
        for (job, row) in jobs.iter().zip(rows) {
            for (p, path) in ports.iter().zip(row) {
                let (Some(slot), Some(path)) =
                    (paths[job.season].get_mut(job.from.idx() * loc_count + p.0.idx()), path)
                else {
                    continue;
                };
                *slot = Some(routes::StoredPath::new(&path, grid.topology));
            }
        }
        NavTable { grid, loc_count, paths, expanded: Default::default() }
    }

    pub fn assemble_compressed(
        grid: NavGrid,
        loc_count: usize,
        ports: &[(LocId, Cell)],
        jobs: &[NavJob],
        rows: Vec<Vec<Option<CompressedPath>>>,
    ) -> Self {
        let mut paths: Vec<Vec<Option<routes::StoredPath>>> =
            (0..grid.period_count()).map(|_| vec![None; loc_count * loc_count]).collect();
        for (job, row) in jobs.iter().zip(rows) {
            for (p, path) in ports.iter().zip(row) {
                if let (Some(slot), Some(compressed)) =
                    (paths[job.season].get_mut(job.from.idx() * loc_count + p.0.idx()), path)
                {
                    *slot = Some(routes::StoredPath { compressed });
                }
            }
        }
        Self { grid, loc_count, paths, expanded: Default::default() }
    }

    pub fn compressed_path(&self, period: usize, from: LocId, to: LocId) -> Option<&CompressedPath> {
        if from.idx() >= self.loc_count || to.idx() >= self.loc_count {
            return None;
        }
        self.paths.get(period)?.get(from.idx() * self.loc_count + to.idx())?.as_ref().map(|p| &p.compressed)
    }

    pub fn memory(&self) -> RouteMemory {
        use std::mem::{size_of, size_of_val};
        let mut m = RouteMemory {
            table_bytes: size_of::<Self>() + self.paths.capacity() * size_of::<Vec<Option<routes::StoredPath>>>(),
            grid_bytes: self.grid.next.capacity() * size_of::<u32>()
                + self.grid.scaled_class.capacity() * size_of::<u32>()
                + self.grid.class.capacity() * size_of::<u16>()
                + (self.grid.lengths.capacity() + self.grid.factors.capacity()) * size_of::<[Fx; 8]>()
                + self.grid.ports.capacity() * size_of::<(LocId, Cell)>(),
            ..Default::default()
        };
        m.grid_bytes += self.grid.seasons.capacity() * size_of::<SeasonTable>();
        for t in &self.grid.seasons {
            m.grid_bytes += (t.cost.capacity() + t.scaled_cost.capacity()) * size_of::<i64>()
                + (t.time_ref.capacity() + t.time_square.capacity() + t.time_lateen.capacity()) * size_of::<Fx>();
        }
        m.grid_bytes += self.grid.blocked.capacity() * size_of::<Vec<bool>>()
            + self.grid.blocked.iter().map(|b| b.capacity() * size_of::<bool>()).sum::<usize>();
        for row in &self.paths {
            m.table_bytes += row.capacity() * size_of::<Option<routes::StoredPath>>();
            for p in row.iter().flatten() {
                m.paths += 1;
                m.cells += p.compressed.len();
                m.segments += p.compressed.runs().len();
                m.table_bytes += p.compressed.segment_bytes();
            }
        }
        if let Some(expanded) = self.expanded.get() {
            m.table_bytes += expanded.capacity() * size_of::<std::sync::OnceLock<Box<Path>>>();
            for p in expanded.iter().filter_map(|p| p.get()) {
                m.legacy_expanded_paths += 1;
                m.table_bytes += size_of_val(p.as_ref()) + p.cells.capacity() * size_of::<Cell>();
            }
        }
        m.expanded_cell_bytes = m.cells * size_of::<Cell>();
        m
    }

    pub fn path(&self, season: usize, from: LocId, to: LocId) -> Option<&Path> {
        if from.idx() >= self.loc_count || to.idx() >= self.loc_count {
            return None;
        }
        let path = self.paths.get(season)?.get(from.idx() * self.loc_count + to.idx())?.as_ref()?;
        let expanded = self.expanded.get_or_init(|| {
            (0..self.paths.len() * self.loc_count * self.loc_count).map(|_| std::sync::OnceLock::new()).collect()
        });
        let slot = (season * self.loc_count + from.idx()) * self.loc_count + to.idx();
        Some(expanded[slot].get_or_init(|| Box::new(path.compressed.expand(self.grid.topology))))
    }

    pub fn path_on(&self, day: u32, from: LocId, to: LocId) -> Result<&Path, NavError> {
        let period = self.grid.period_on(day);
        self.grid.check_port(period, from)?;
        self.grid.check_port(period, to)?;
        self.path(period, from, to).ok_or(NavError::Unreachable)
    }

    /// 实时寻路：网格可用时查表，否则逐格计算。
    pub fn find_path(
        &self,
        map: &SeaMap,
        regions: &[RegionDef],
        season: usize,
        start: Cell,
        goal: Cell,
    ) -> Option<Path> {
        if self.grid.is_empty() {
            map.find_path(regions, season, start, goal)
        } else {
            self.grid.find_path(season, start, goal)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::weather::Climate;

    fn weather(wind_dir: u8) -> SeasonWeather {
        SeasonWeather { wind_dir, wind_strength: 5, current_dir: 0, current_strength: 0, storm_bp: 0, pirate_bp: 0 }
    }

    fn open_map(w: u16, h: u16) -> (SeaMap, Vec<RegionDef>) {
        let n = w as usize * h as usize;
        let map = SeaMap { width: w, height: h, wrap_x: false, terrain: vec![Terrain::Deep; n], region: vec![0; n] };
        let region = RegionDef {
            key: "r".into(),
            name: "r".into(),
            rect: (0, 0, w - 1, h - 1),
            seasons: [weather(2); 4],
            climate: Climate::Temperate,
        };
        (map, vec![region])
    }

    #[test]
    fn angle_differences() {
        assert_eq!(angle_diff(0, 0), 0);
        assert_eq!(angle_diff(0, 4), 4);
        assert_eq!(angle_diff(1, 7), 2);
        assert_eq!(angle_diff(7, 0), 1);
    }

    #[test]
    fn square_sails_prefer_downwind() {
        let w = weather(2);
        assert!(sail_mult(SailType::Square, 2, &w) > sail_mult(SailType::Square, 6, &w));
        assert!(sail_mult(SailType::Lateen, 6, &w) > sail_mult(SailType::Square, 6, &w));
    }

    #[test]
    fn astar_finds_path_around_wall() {
        let (mut map, regions) = open_map(10, 10);
        for y in 0..9 {
            let i = map.idx(Cell::new(5, y));
            map.terrain[i] = Terrain::Land;
        }
        let p = map.find_path(&regions, 0, Cell::new(1, 1), Cell::new(8, 1)).expect("有路");
        assert_eq!(p.cells.first(), Some(&Cell::new(1, 1)));
        assert_eq!(p.cells.last(), Some(&Cell::new(8, 1)));
        assert!(p.cells.iter().all(|c| map.is_sea(*c)));
        assert!(p.cells.iter().any(|c| c.y == 9));
    }

    #[test]
    fn astar_matches_dijkstra_cost() {
        let (map, regions) = open_map(20, 12);
        let a = Cell::new(1, 1);
        let b = Cell::new(17, 9);
        let p = map.find_path(&regions, 0, a, b).expect("有路");
        let (_, g) = map.dijkstra(&regions, 0, map.idx(a));
        assert_eq!(p.cost, g[map.idx(b)]);
    }

    /// 带陆地、浅海与两个海区的测试海图。
    fn mixed_map() -> (SeaMap, Vec<RegionDef>) {
        let (w, h) = (30u16, 18u16);
        let n = w as usize * h as usize;
        let mut map =
            SeaMap { width: w, height: h, wrap_x: false, terrain: vec![Terrain::Deep; n], region: vec![0; n] };
        for y in 0..h {
            for x in 0..w {
                let i = map.idx(Cell::new(x, y));
                if (10..14).contains(&x) && (2..15).contains(&y) || (20..22).contains(&x) && y >= 6 {
                    map.terrain[i] = Terrain::Land;
                    map.region[i] = u16::MAX;
                } else if (x + y) % 5 == 0 {
                    map.terrain[i] = Terrain::Shallow;
                }
                if map.terrain[i] != Terrain::Land && x >= 15 {
                    map.region[i] = 1;
                }
            }
        }
        let stormy = SeasonWeather {
            wind_dir: 6,
            wind_strength: 7,
            current_dir: 1,
            current_strength: 2,
            storm_bp: 40,
            pirate_bp: 25,
        };
        let regions = vec![
            RegionDef {
                key: "a".into(),
                name: "a".into(),
                rect: (0, 0, 14, h - 1),
                seasons: [weather(2); 4],
                climate: Climate::Temperate,
            },
            RegionDef {
                key: "b".into(),
                name: "b".into(),
                rect: (15, 0, w - 1, h - 1),
                seasons: [stormy, weather(0), stormy, weather(4)],
                climate: Climate::Temperate,
            },
        ];
        (map, regions)
    }

    #[test]
    fn grid_routes_match_cell_by_cell_reference() {
        let (map, regions) = mixed_map();
        let ports = [
            (LocId(0), Cell::new(1, 1)),
            (LocId(1), Cell::new(28, 16)),
            (LocId(2), Cell::new(16, 3)),
            (LocId(3), Cell::new(5, 16)),
        ];
        let table = NavTable::build(&map, &regions, 5, &ports);
        for season in 0..4 {
            for &(a, ca) in &ports {
                let (parent, g) = map.dijkstra(&regions, season, map.idx(ca));
                for &(b, cb) in &ports {
                    let got = table.path(season, a, b);
                    if a == b {
                        assert!(got.is_none());
                        continue;
                    }
                    let goal = map.idx(cb);
                    let want = map.build_path(&regions, season, &parent, map.idx(ca), goal, g[goal]);
                    assert_eq!(got, Some(&want), "季节 {season}：{a:?} → {b:?}");
                    let astar = table.find_path(&map, &regions, season, ca, cb).expect("有路");
                    assert_eq!(astar, map.find_path(&regions, season, ca, cb).expect("有路"));
                    assert_eq!(astar.cost, want.cost);
                }
            }
        }
        assert!(table.path(0, LocId(4), LocId(0)).is_none(), "不在表中的地点没有预计算航线");
        let reach = table.grid.reachable_from(Cell::new(1, 1));
        assert!(reach[map.idx(Cell::new(28, 16))]);
        assert!(!reach[map.idx(Cell::new(11, 5))], "陆地不可达");
    }

    #[test]
    fn nearest_cell_and_reachability_on_the_sea_map() {
        // 6×6：第 3 列是陆墙，(0, 0) 是被陆地围住的一格水
        let (mut map, _) = open_map(6, 6);
        for y in 0..6 {
            let i = map.idx(Cell::new(3, y));
            map.terrain[i] = Terrain::Land;
        }
        for c in [Cell::new(1, 0), Cell::new(0, 1), Cell::new(1, 1)] {
            let i = map.idx(c);
            map.terrain[i] = Terrain::Land;
        }
        let east = map.reachable_from(Cell::new(5, 5));
        assert!(east[map.idx(Cell::new(4, 0))]);
        assert!(!east[map.idx(Cell::new(2, 2))], "陆墙另一侧不连通");
        assert!(!east[map.idx(Cell::new(3, 3))], "陆地不可达");
        assert!(map.reachable_from(Cell::new(3, 0)).iter().all(|r| !r), "起点是陆地");
        assert!(map.reachable_from(Cell::new(0, 0)).iter().filter(|r| **r).count() == 1, "孤立的一格水");
        // 从陆墙上的 (3, 2) 找最近的海格：同一距离按方向顺序，先北后东
        assert_eq!(map.nearest_cell(Cell::new(3, 2), |i| map.terrain[i] != Terrain::Land), Some(Cell::new(4, 1)));
        // 只接受与东侧连通的海格
        assert_eq!(map.nearest_cell(Cell::new(1, 1), |i| east[i]), Some(Cell::new(4, 0)));
        // 越界的起点先夹到地图内
        assert_eq!(map.nearest_cell(Cell::new(60, 60), |i| map.terrain[i] != Terrain::Land), Some(Cell::new(5, 5)));
        assert_eq!(map.nearest_cell(Cell::new(1, 1), |_| false), None);
        assert!(!map.is_sea_in_bounds(Cell::new(6, 0)) && map.is_sea_in_bounds(Cell::new(0, 0)));
    }

    #[test]
    fn unreachable_returns_none() {
        let (mut map, regions) = open_map(6, 6);
        for y in 0..6 {
            let i = map.idx(Cell::new(3, y));
            map.terrain[i] = Terrain::Land;
        }
        assert!(map.find_path(&regions, 0, Cell::new(0, 0), Cell::new(5, 5)).is_none());
    }
}
