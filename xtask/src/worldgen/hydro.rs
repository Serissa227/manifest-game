//! 水系：填洼后的 D8 流向、按降水加权的汇流量、主要河流的追溯与三角洲分汊。

use super::grid::{Grid, N4, N8};
use super::layout::Layout;
use super::noise::Noise;
use super::terrain::{Terrain, flow_order};

/// 汇流结果。
pub struct Hydro {
    /// 每格的下游格（出口为自身）
    pub recv: Vec<usize>,
    /// 汇流量（按降水加权的上游格数）
    pub acc: Vec<f64>,
}

/// 一条河：从源头到入海口的陆格序列（八连通）。
#[derive(Clone, Debug)]
pub struct River {
    pub key: String,
    pub name: String,
    pub path: Vec<(usize, usize)>,
    pub width: u8,
}

/// 计算流向与汇流量（地图边缘的陆格可以向图外排水）。
pub fn route(t: &Terrain, rain: &Grid<f64>) -> Hydro {
    let (w, h) = (t.land.w, t.land.h);
    let e = Grid::from_fn(w, h, |x, y| if t.land.get(x, y) { t.elev.get(x, y).max(0.5) } else { -1.0 });
    let (order, recv) = flow_order(&e, true, true);
    let mut acc = vec![0.0f64; w * h];
    for &i in order.iter().rev() {
        if t.land.v[i] {
            acc[i] += rain.v[i].max(0.05);
        }
        let r = recv[i];
        if r != i && r != usize::MAX {
            let a = acc[i];
            acc[r] += a;
        }
    }
    Hydro { recv, acc }
}

fn sea4(t: &Terrain, x: usize, y: usize) -> bool {
    N4.iter().any(|&(dx, dy)| t.land.at(x as i32 + dx, y as i32 + dy) == Some(false))
}

/// 按骨架里的命名追溯主要河流。`taken` 记录已用过的河口，避免两条河取同一个口。
/// 写了 `via` 的河直接用刻进地形的河道（`burned`）。
pub fn trace(l: &Layout, t: &Terrain, hy: &Hydro, burned: &Burned, warn: &mut Vec<String>) -> Vec<River> {
    let (w, h) = (t.land.w, t.land.h);
    let mut out: Vec<River> = Vec::new();
    let mut used = vec![false; w * h];
    for (_, path) in burned {
        for &(x, y) in path {
            used[y * w + x] = true;
        }
    }
    for spec in &l.river {
        if let Some((_, path)) = burned.iter().find(|(k, _)| *k == spec.key) {
            let still_land = path.iter().all(|&(x, y)| t.land.get(x, y));
            let m = path[path.len() - 1];
            if still_land && sea4(t, m.0, m.1) {
                let acc_mouth = hy.acc[m.1 * w + m.0];
                let width = spec.width.unwrap_or(if acc_mouth > 420.0 {
                    3
                } else if acc_mouth > 120.0 {
                    2
                } else {
                    1
                });
                out.push(River {
                    key: spec.key.clone(),
                    name: spec.name.clone(),
                    path: path.clone(),
                    width: width.clamp(1, 3),
                });
                continue;
            }
            warn.push(format!("河流 {}：刻出的河道后来被海岸改动，改按汇流追溯", spec.key));
        }
        let r = spec.search;
        let mut best: Option<(f64, usize)> = None;
        let (mx, my) = (spec.mouth[0], spec.mouth[1]);
        for y in (my - r).max(0.0) as usize..=((my + r) as usize).min(h - 1) {
            for x in (mx - r).max(0.0) as usize..=((mx + r) as usize).min(w - 1) {
                let i = y * w + x;
                if !t.land.v[i] || used[i] {
                    continue;
                }
                let rc = hy.recv[i];
                if rc == i || t.land.v[rc] {
                    continue;
                }
                let d = ((x as f64 - mx).powi(2) + (y as f64 - my).powi(2)).sqrt();
                if d > r {
                    continue;
                }
                let score = hy.acc[i] / (1.0 + 0.08 * d);
                if best.is_none_or(|(b, _)| score > b) {
                    best = Some((score, i));
                }
            }
        }
        let Some((_, mouth)) = best else {
            warn.push(format!("河流 {}：入海口 {:?} 附近找不到河口", spec.key, spec.mouth));
            continue;
        };
        // 反向邻接：谁流进这一格
        let mut path = vec![mouth];
        let mut cur = mouth;
        let min_acc = 1.2;
        loop {
            let (cx, cy) = (cur % w, cur / w);
            let mut pick: Option<(f64, usize)> = None;
            for &(dx, dy) in &N8 {
                let (nx, ny) = (cx as i32 + dx, cy as i32 + dy);
                if !t.land.inside(nx, ny) {
                    continue;
                }
                let j = ny as usize * w + nx as usize;
                if hy.recv[j] != cur || !t.land.v[j] || hy.acc[j] < min_acc {
                    continue;
                }
                // 不让河道贴着地图边缘走（边缘外是图外的陆地）
                let (ux, uy) = (nx as usize, ny as usize);
                if ux < 4 || uy < 3 || ux + 4 >= w || uy + 3 >= t.land.h {
                    continue;
                }
                let mut s = hy.acc[j];
                if let Some(src) = spec.source {
                    let dnow = ((cx as f64 - src[0]).powi(2) + (cy as f64 - src[1]).powi(2)).sqrt();
                    let dnext = ((nx as f64 - src[0]).powi(2) + (ny as f64 - src[1]).powi(2)).sqrt();
                    s *= if dnext < dnow { 1.6 } else { 1.0 };
                }
                if pick.is_none_or(|(b, _)| s > b) {
                    pick = Some((s, j));
                }
            }
            match pick {
                Some((_, j)) if path.len() < 600 => {
                    path.push(j);
                    cur = j;
                }
                _ => break,
            }
        }
        for &i in &path {
            used[i] = true;
        }
        path.reverse();
        // 河口只与海斜向相邻时，补一格与海正交相邻的陆格
        let (mx0, my0) = (mouth % w, mouth / w);
        if !sea4(t, mx0, my0) {
            let rc = hy.recv[mouth];
            let (sx, sy) = (rc % w, rc / w);
            for (cx, cy) in [(sx, my0), (mx0, sy)] {
                if t.land.get(cx, cy) && sea4(t, cx, cy) {
                    path.push(cy * w + cx);
                    break;
                }
            }
        }
        let acc_mouth = hy.acc[mouth];

        let width = spec.width.unwrap_or(if acc_mouth > 420.0 {
            3
        } else if acc_mouth > 120.0 {
            2
        } else {
            1
        });
        if path.len() < 5 {
            warn.push(format!(
                "河流 {}：只有 {} 格长（汇流量 {:.0}），不写入 rivers.toml",
                spec.key,
                path.len(),
                acc_mouth
            ));
            continue;
        }
        out.push(River {
            key: spec.key.clone(),
            name: spec.name.clone(),
            path: path.iter().map(|&i| (i % w, i / w)).collect(),
            width: width.clamp(1, 3),
        });
    }
    out
}

/// 汊道的走向：从扇顶出发，沿方向 `u` 每步走一格，按噪声左右摆动（三角洲刻河槽与追溯汊道共用）。
pub fn branch_walk(n: &Noise, apex: (f64, f64), u: (f64, f64), k: f64, steps: usize) -> Vec<(f64, f64)> {
    // 走向按噪声左右打弯（小角度旋转），再往总方向 u 拉回一点：河道蜿蜒，但不会掉头
    let (ux, uy) = u;
    let (mut hx, mut hy) = u;
    let (mut px, mut py) = apex;
    let mut out = Vec::with_capacity(steps);
    for _ in 0..steps {
        let turn = n.gradient(px * 0.22 + k * 5.0, py * 0.22 - k * 3.0) * 0.55;
        let (nx, ny) = (hx - hy * turn + 0.18 * ux, hy + hx * turn + 0.18 * uy);
        let l = (nx * nx + ny * ny).sqrt().max(1e-9);
        (hx, hy) = (nx / l, ny / l);
        px += hx;
        py += hy;
        out.push((px, py));
    }
    out
}

/// 汊道摆动用的噪声通道。
pub fn branch_noise(seed: u64) -> Noise {
    Noise::new(seed, 41)
}

/// 三角洲的分汊河道：从顶点出发、偏离主方向若干角度，沿三角洲陆地走到海边。
pub fn branches(
    t: &Terrain,
    apex: (f64, f64),
    dir: (f64, f64),
    names: &[[String; 2]],
    seed: u64,
    main: &[(usize, usize)],
) -> Vec<River> {
    // 旋转角与三角洲扇面的朵叶一致（±28°、±50°）
    const ROT: [(f64, f64); 4] = super::terrain::DELTA_ROT;
    let n = branch_noise(seed);
    let mut out = Vec::new();
    for (k, pair) in names.iter().enumerate() {
        let (c, s) = ROT[k % ROT.len()];
        let (ux, uy) = (dir.0 * c - dir.1 * s, dir.0 * s + dir.1 * c);
        let mut path: Vec<(usize, usize)> = Vec::new();
        for (step, (px, py)) in branch_walk(&n, apex, (ux, uy), k as f64, 80).into_iter().enumerate() {
            let (cx, cy) = (px.round() as i32, py.round() as i32);
            if !t.land.inside(cx, cy) {
                break;
            }
            let (ux2, uy2) = (cx as usize, cy as usize);
            if !t.land.get(ux2, uy2) {
                // 下一步就是海：当前格若只与海斜向相邻，补一格与海正交相邻的陆格
                if let Some(&(lx, ly)) = path.last()
                    && !sea4(t, lx, ly)
                {
                    for (qx, qy) in [(ux2, ly), (lx, uy2)] {
                        if t.land.get(qx, qy) && sea4(t, qx, qy) {
                            path.push((qx, qy));
                            break;
                        }
                    }
                }
                break;
            }
            // 保持八连通
            if let Some(&(lx, ly)) = path.last() {
                if (lx, ly) == (ux2, uy2) {
                    continue;
                }
                let (ddx, ddy) = (ux2 as i32 - lx as i32, uy2 as i32 - ly as i32);
                if ddx.abs() > 1 || ddy.abs() > 1 {
                    let mid = ((lx as i32 + ddx.signum()) as usize, (ly as i32 + ddy.signum()) as usize);
                    if t.land.get(mid.0, mid.1) {
                        path.push(mid);
                    } else {
                        break;
                    }
                }
            }
            path.push((ux2, uy2));
            if step > 1 && sea4(t, ux2, uy2) {
                break;
            }
        }
        // 从主河道上离顶点最近的格起步，保证与主河相连
        if let Some(&first) = path.first() {
            let join = main
                .iter()
                .min_by_key(|&&(mx, my)| {
                    let d = (mx as i64 - first.0 as i64).pow(2) + (my as i64 - first.1 as i64).pow(2);
                    d * 1000 + (mx as i64) * 3 + my as i64
                })
                .copied();
            if let Some(j) = join
                && j != first
            {
                path.insert(0, j);
            }
        }
        let ok = path.len() >= 3 && path.last().is_some_and(|&(x, y)| sea4(t, x, y));
        if ok && path_connected(&path) {
            out.push(River { key: pair[0].clone(), name: pair[1].clone(), path, width: 1 });
        }
    }
    out
}

/// 路径是否八连通。
pub fn path_connected(p: &[(usize, usize)]) -> bool {
    p.windows(2).all(|w| {
        let dx = (w[0].0 as i64 - w[1].0 as i64).abs();
        let dy = (w[0].1 as i64 - w[1].1 as i64).abs();
        dx <= 1 && dy <= 1 && (dx + dy) > 0
    })
}

/// 流量最大的若干河口（报告里列出，方便在骨架里给河流命名）。
pub fn top_mouths(t: &Terrain, hy: &Hydro, n: usize) -> Vec<((usize, usize), f64)> {
    let (w, _) = (t.land.w, t.land.h);
    let mut v: Vec<((usize, usize), f64)> = (0..hy.acc.len())
        .filter(|&i| t.land.v[i] && hy.recv[i] != i && hy.recv[i] != usize::MAX && !t.land.v[hy.recv[i]])
        .map(|i| ((i % w, i / w), hy.acc[i]))
        .collect();
    v.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(&b.0)));
    v.truncate(n);
    v
}

/// 刻进地形的河道：河流 key → 从源头到入海口的陆格。
pub type Burned = Vec<(String, Vec<(usize, usize)>)>;

/// 离 (x, y) 最近的陆格（半径 r 内；`sea4` 时要求与海正交相邻）。
fn nearest_land(t: &Terrain, p: [f64; 2], r: i64, want_sea4: bool) -> Option<(usize, usize)> {
    let (w, h) = (t.land.w as i64, t.land.h as i64);
    let (cx, cy) = (p[0].round() as i64, p[1].round() as i64);
    let mut best: Option<(i64, (usize, usize))> = None;
    for dy in -r..=r {
        for dx in -r..=r {
            let (x, y) = (cx + dx, cy + dy);
            if x < 3 || y < 3 || x >= w - 3 || y >= h - 3 {
                continue;
            }
            let (ux, uy) = (x as usize, y as usize);
            if !t.land.get(ux, uy) || (want_sea4 && !sea4(t, ux, uy)) {
                continue;
            }
            let d = dx * dx + dy * dy;
            if best.is_none_or(|(b, c)| d < b || (d == b && (ux, uy) < c)) {
                best = Some((d, (ux, uy)));
            }
        }
    }
    best.map(|b| b.1)
}

/// 两格之间代价最小的陆路（Dijkstra，八方向，不斜穿两块海之间的陆角）：代价随高程升高，
/// 离海 1.5 格以内（海岸）除了终点附近都很贵——河道不会先贴着海岸走一段。
fn low_path(t: &Terrain, a: (usize, usize), b: (usize, usize), coast_ok: f64) -> Option<Vec<(usize, usize)>> {
    #[derive(PartialEq)]
    struct Item(f64, usize);
    impl Eq for Item {}
    impl PartialOrd for Item {
        fn partial_cmp(&self, o: &Self) -> Option<std::cmp::Ordering> {
            Some(self.cmp(o))
        }
    }
    impl Ord for Item {
        fn cmp(&self, o: &Self) -> std::cmp::Ordering {
            o.0.partial_cmp(&self.0).unwrap_or(std::cmp::Ordering::Equal).then_with(|| o.1.cmp(&self.1))
        }
    }
    let (w, h) = (t.land.w, t.land.h);
    let m = 14usize;
    let (x0, x1) = (a.0.min(b.0).saturating_sub(m).max(3), (a.0.max(b.0) + m).min(w - 4));
    let (y0, y1) = (a.1.min(b.1).saturating_sub(m).max(3), (a.1.max(b.1) + m).min(h - 4));
    let start = a.1 * w + a.0;
    let goal = b.1 * w + b.0;
    let mut dist = vec![f64::INFINITY; w * h];
    let mut prev = vec![usize::MAX; w * h];
    let mut heap = std::collections::BinaryHeap::new();
    dist[start] = 0.0;
    heap.push(Item(0.0, start));
    while let Some(Item(d, i)) = heap.pop() {
        if i == goal {
            break;
        }
        if d > dist[i] {
            continue;
        }
        let (x, y) = (i % w, i / w);
        for &(dx, dy) in &N8 {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if nx < x0 as i32 || ny < y0 as i32 || nx > x1 as i32 || ny > y1 as i32 {
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
            let step = if dx != 0 && dy != 0 { std::f64::consts::SQRT_2 } else { 1.0 };
            let near_goal = ((ux as f64 - b.0 as f64).powi(2) + (uy as f64 - b.1 as f64).powi(2)).sqrt() <= coast_ok;
            let coast = if t.dist_sea.get(ux, uy) <= 1.5 && !near_goal { 8.0 } else { 0.0 };
            let c = step * (1.0 + t.elev.get(ux, uy).max(0.0) / 220.0 + coast);
            let nd = d + c;
            if nd < dist[j] {
                dist[j] = nd;
                prev[j] = i;
                heap.push(Item(nd, j));
            }
        }
    }
    if !dist[goal].is_finite() {
        return None;
    }
    let mut out = vec![(b.0, b.1)];
    let mut c = goal;
    while c != start {
        c = prev[c];
        if c == usize::MAX {
            return None;
        }
        out.push((c % w, c / w));
    }
    out.reverse();
    Some(out)
}

/// 把写了 `via` 的河流刻进地形：沿地势最低的路线依次连起源头、途经点与入海口，
/// 河道高程从源头到入海口单调下降（高出的地方切成峡谷），两侧 2 格压低成 V 形河谷，汇流因此顺着刻出的河道走。
/// 返回各河的河道（追溯时直接使用）。
pub fn burn(l: &Layout, t: &mut Terrain, warn: &mut Vec<String>) -> Burned {
    let (w, h) = (t.land.w, t.land.h);
    let mut out = Vec::new();
    for spec in l.river.iter().filter(|s| !s.via.is_empty()) {
        let Some(mouth) = nearest_land(t, spec.mouth, spec.search.max(3.0).round() as i64, true) else {
            warn.push(format!("河流 {}：入海口 {:?} 附近找不到与海正交相邻的陆格，不刻河道", spec.key, spec.mouth));
            continue;
        };
        let mut pts: Vec<(usize, usize)> = Vec::new();
        for v in &spec.via {
            match nearest_land(t, *v, 4, false) {
                Some(c) => pts.push(c),
                None => warn.push(format!("河流 {}：途经点 {:?} 附近没有陆格，跳过", spec.key, v)),
            }
        }
        pts.push(mouth);
        let mut path: Vec<(usize, usize)> = vec![pts[0]];
        let mut ok = true;
        for k in 1..pts.len() {
            let last = k + 1 == pts.len();
            let Some(seg) = low_path(t, pts[k - 1], pts[k], if last { 3.0 } else { 0.0 }) else {
                warn.push(format!("河流 {}：{:?} 到 {:?} 之间没有陆路，不刻河道", spec.key, pts[k - 1], pts[k]));
                ok = false;
                break;
            };
            for c in seg.into_iter().skip(1) {
                // 去掉回头路：新格若已在河道里，截到那一格
                if let Some(pos) = path.iter().position(|&q| q == c) {
                    path.truncate(pos + 1);
                } else {
                    path.push(c);
                }
            }
        }
        if !ok || path.len() < 3 {
            continue;
        }
        // 入海口之前的格不与海正交相邻（否则河会提前“入海”）：截到第一个与海正交相邻的格
        if let Some(first) = path.iter().position(|&(x, y)| sea4(t, x, y))
            && first + 1 < path.len()
            && first >= 4
        {
            path.truncate(first + 1);
        }
        // 单调下降：每格不高于上一格减 0.5 米；下限随离入海口的格数线性升高（入海口约 2 米），保证严格下降
        let n = path.len();
        let mut target = vec![0.0; n];
        let mut prev = f64::MAX;
        for (k, &(x, y)) in path.iter().enumerate() {
            let floor = 2.0 + (n - 1 - k) as f64 * 0.6;
            target[k] = t.elev.get(x, y).min(prev - 0.5).max(floor);
            prev = target[k];
        }
        for (k, &(x, y)) in path.iter().enumerate() {
            let i = y * w + x;
            t.elev.v[i] = t.elev.v[i].min(target[k]);
        }
        // 两侧的 V 形河谷：离河道 d 格处不高于河道 + 70·d 米
        for (k, &(x, y)) in path.iter().enumerate() {
            for dy in -2i32..=2 {
                for dx in -2i32..=2 {
                    let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                    if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 || (dx == 0 && dy == 0) {
                        continue;
                    }
                    let j = ny as usize * w + nx as usize;
                    if !t.land.v[j] {
                        continue;
                    }
                    let d = ((dx * dx + dy * dy) as f64).sqrt();
                    let cap = target[k] + 70.0 * d + 5.0;
                    if t.elev.v[j] > cap {
                        t.elev.v[j] = cap;
                    }
                }
            }
        }
        // 河谷压低之后河道本身要保持最低（邻格可能被压到河道以下）
        for (k, &(x, y)) in path.iter().enumerate() {
            let i = y * w + x;
            t.elev.v[i] = t.elev.v[i].min(target[k]);
        }
        out.push((spec.key.clone(), path));
    }
    out
}

/// 中文序号（一、二……十二）。
fn cn_num(n: usize) -> String {
    const D: [&str; 11] = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    if n <= 10 {
        D[n].to_string()
    } else if n < 20 {
        format!("十{}", D[n - 10])
    } else {
        format!("{}十{}", D[(n / 10).min(10)], D[n % 10])
    }
}

/// 支流与次级河流：命名河流沿途汇流量够大的上游分支写成 1 级宽的支流（终点接在干流上）；
/// 没有命名、但汇流量够大的河口也向上追溯写成小河。门槛按降水调整：多雨区低、干旱区高。
pub fn minor(
    l: &Layout,
    t: &Terrain,
    hy: &Hydro,
    precip: &Grid<f64>,
    rivers: &[River],
    naming: &crate::mapgen::config::Naming,
) -> Vec<River> {
    let (w, h) = (t.land.w, t.land.h);
    let p = &l.params;
    let mut taken = vec![false; w * h];
    let mut mouths: Vec<(usize, usize)> = Vec::new();
    for r in rivers {
        for &(x, y) in &r.path {
            taken[y * w + x] = true;
        }
        if let Some(&m) = r.path.last() {
            mouths.push(m);
        }
    }
    // 降水越多门槛越低（0.5–2 倍）
    let wet = |i: usize| (precip.v[i] / 0.6).clamp(0.5, 2.0);
    let edge_ok = |x: usize, y: usize| x >= 4 && y >= 3 && x + 4 < w && y + 3 < h;
    // 从 j 向上游追溯（每步取汇流量最大的上游邻格），直到汇流量低于 stop
    let climb = |j: usize, stop: f64, taken: &Vec<bool>| -> Vec<usize> {
        let mut path = vec![j];
        let mut cur = j;
        loop {
            let (cx, cy) = (cur % w, cur / w);
            let mut pick: Option<(f64, usize)> = None;
            for &(dx, dy) in &N8 {
                let (nx, ny) = (cx as i32 + dx, cy as i32 + dy);
                if !t.land.inside(nx, ny) {
                    continue;
                }
                let k = ny as usize * w + nx as usize;
                if hy.recv[k] != cur || !t.land.v[k] || taken[k] || hy.acc[k] < stop {
                    continue;
                }
                if !edge_ok(nx as usize, ny as usize) {
                    continue;
                }
                if pick.is_none_or(|(b, bi)| hy.acc[k] > b || (hy.acc[k] == b && k < bi)) {
                    pick = Some((hy.acc[k], k));
                }
            }
            match pick {
                Some((_, k)) if path.len() < 200 => {
                    path.push(k);
                    cur = k;
                }
                _ => break,
            }
        }
        path
    };
    let mut out: Vec<River> = Vec::new();
    // ── 支流 ──
    let mut cands: Vec<(f64, usize, usize, usize)> = Vec::new();
    for (ri, r) in rivers.iter().enumerate() {
        // 三角洲汊道不再分支流
        if l.river.iter().all(|s| s.key != r.key) {
            continue;
        }
        let n = r.path.len();
        for (k, &(x, y)) in r.path.iter().enumerate() {
            // 入海口前 2 格不接支流（那里是河口）
            if k + 2 >= n {
                break;
            }
            let c = y * w + x;
            for &(dx, dy) in &N8 {
                let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                if !t.land.inside(nx, ny) {
                    continue;
                }
                let j = ny as usize * w + nx as usize;
                if hy.recv[j] != c || !t.land.v[j] || taken[j] || !edge_ok(nx as usize, ny as usize) {
                    continue;
                }
                if hy.acc[j] >= p.tributary_area / wet(j) {
                    cands.push((hy.acc[j], j, c, ri));
                }
            }
        }
    }
    cands.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal).then(a.1.cmp(&b.1)));
    let mut count = vec![0usize; rivers.len()];
    for &(_, j, c, ri) in &cands {
        if taken[j] || count[ri] >= 8 {
            continue;
        }
        let stop = (p.tributary_area / wet(j) * 0.2).max(1.5);
        let up = climb(j, stop, &taken);
        if up.len() + 1 < p.stream_min_len {
            continue;
        }
        let mut path: Vec<(usize, usize)> = up.iter().rev().map(|&i| (i % w, i / w)).collect();
        path.push((c % w, c / w));
        for &i in &up {
            taken[i] = true;
        }
        count[ri] += 1;
        let base = &rivers[ri];
        out.push(River {
            key: format!("{}_trib{}", base.key, count[ri]),
            name: format!("{}支流{}", base.name.split('（').next().unwrap_or(&base.name), cn_num(count[ri])),
            path,
            width: 1,
        });
    }
    // ── 没有命名的小河 ──
    let mut heads: Vec<(f64, usize)> = (0..w * h)
        .filter(|&i| {
            let r = hy.recv[i];
            t.land.v[i] && r != i && r != usize::MAX && !t.land.v[r] && !taken[i]
        })
        .map(|i| (hy.acc[i], i))
        .filter(|&(a, i)| a >= p.stream_area / wet(i))
        .collect();
    heads.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal).then(a.1.cmp(&b.1)));
    let mut per_region: Vec<(&str, usize)> = Vec::new();
    for &(_, i) in &heads {
        let (x, y) = (i % w, i / w);
        if taken[i] || !edge_ok(x, y) || !sea4(t, x, y) {
            continue;
        }
        // 离已有的河口至少 3 格
        if mouths.iter().any(|&(mx, my)| mx.abs_diff(x).max(my.abs_diff(y)) < 3) {
            continue;
        }
        let stop = (p.stream_area / wet(i) * 0.15).max(1.5);
        let up = climb(i, stop, &taken);
        if up.len() < p.stream_min_len {
            continue;
        }
        let path: Vec<(usize, usize)> = up.iter().rev().map(|&k| (k % w, k / w)).collect();
        for &k in &up {
            taken[k] = true;
        }
        mouths.push((x, y));
        let reg = naming.region_name(x, y);
        let n = match per_region.iter_mut().find(|(r, _)| *r == reg) {
            Some(e) => {
                e.1 += 1;
                e.1
            }
            None => {
                per_region.push((reg, 1));
                1
            }
        };
        out.push(River {
            key: format!("brook_{x}_{y}"),
            name: format!("{reg}小河{}", cn_num(n)),
            path,
            width: if hy.acc[i] > 160.0 { 2 } else { 1 },
        });
    }
    out
}
