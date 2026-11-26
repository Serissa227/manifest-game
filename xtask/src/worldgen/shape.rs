//! 骨架几何：多边形平滑、有符号距离场、折线距离。

use super::grid::Grid;

pub type P = (f64, f64);

/// Chaikin 细分平滑（闭合多边形），每次迭代把折角切成两个点。
pub fn chaikin_closed(pts: &[P], iterations: u32) -> Vec<P> {
    let mut cur: Vec<P> = pts.to_vec();
    for _ in 0..iterations {
        if cur.len() < 3 {
            break;
        }
        let n = cur.len();
        let mut next = Vec::with_capacity(n * 2);
        for i in 0..n {
            let a = cur[i];
            let b = cur[(i + 1) % n];
            next.push((0.75 * a.0 + 0.25 * b.0, 0.75 * a.1 + 0.25 * b.1));
            next.push((0.25 * a.0 + 0.75 * b.0, 0.25 * a.1 + 0.75 * b.1));
        }
        cur = next;
    }
    cur
}

/// Chaikin 细分平滑（闭合多边形），但 `keep` 为真的顶点保持尖角不切。
/// 用于越出地图的顶点：普通的 Chaikin 会把远在图外的大拐角切成一条斜线，斜线可能切进地图的角落。
pub fn chaikin_closed_keep(pts: &[P], iterations: u32, keep: impl Fn(P) -> bool) -> Vec<P> {
    let mut cur: Vec<P> = pts.to_vec();
    for _ in 0..iterations {
        if cur.len() < 3 {
            break;
        }
        let n = cur.len();
        let mut next = Vec::with_capacity(n * 2);
        for i in 0..n {
            let a = cur[i];
            let b = cur[(i + 1) % n];
            if keep(a) {
                next.push(a);
            } else {
                next.push((0.75 * a.0 + 0.25 * b.0, 0.75 * a.1 + 0.25 * b.1));
            }
            if !keep(b) {
                next.push((0.25 * a.0 + 0.75 * b.0, 0.25 * a.1 + 0.75 * b.1));
            }
        }
        cur = next;
    }
    cur
}

/// Chaikin 细分平滑（开放折线，保留两端点）。
pub fn chaikin_open(pts: &[P], iterations: u32) -> Vec<P> {
    let mut cur: Vec<P> = pts.to_vec();
    for _ in 0..iterations {
        if cur.len() < 3 {
            break;
        }
        let n = cur.len();
        let mut next = Vec::with_capacity(n * 2);
        next.push(cur[0]);
        for i in 0..n - 1 {
            let a = cur[i];
            let b = cur[i + 1];
            next.push((0.75 * a.0 + 0.25 * b.0, 0.75 * a.1 + 0.25 * b.1));
            next.push((0.25 * a.0 + 0.75 * b.0, 0.25 * a.1 + 0.75 * b.1));
        }
        next.push(cur[n - 1]);
        cur = next;
    }
    cur
}

/// 点到线段的距离，以及投影参数 t ∈ [0, 1]。
pub fn seg_dist(p: P, a: P, b: P) -> (f64, f64) {
    let (vx, vy) = (b.0 - a.0, b.1 - a.1);
    let (wx, wy) = (p.0 - a.0, p.1 - a.1);
    let len2 = vx * vx + vy * vy;
    let t = if len2 <= 1e-12 { 0.0 } else { ((wx * vx + wy * vy) / len2).clamp(0.0, 1.0) };
    let (cx, cy) = (a.0 + t * vx, a.1 + t * vy);
    (((p.0 - cx).powi(2) + (p.1 - cy).powi(2)).sqrt(), t)
}

/// 点到折线的距离，以及沿线的归一化位置（0 = 起点，1 = 终点）。
pub fn polyline_dist(p: P, line: &[P]) -> (f64, f64) {
    if line.len() == 1 {
        return (((p.0 - line[0].0).powi(2) + (p.1 - line[0].1).powi(2)).sqrt(), 0.0);
    }
    let lens: Vec<f64> =
        line.windows(2).map(|w| ((w[1].0 - w[0].0).powi(2) + (w[1].1 - w[0].1).powi(2)).sqrt()).collect();
    let total: f64 = lens.iter().sum::<f64>().max(1e-9);
    let mut best = (f64::MAX, 0.0);
    let mut acc = 0.0;
    for (i, w) in line.windows(2).enumerate() {
        let (d, t) = seg_dist(p, w[0], w[1]);
        if d < best.0 {
            best = (d, (acc + t * lens[i]) / total);
        }
        acc += lens[i];
    }
    best
}

/// 点是否在多边形内（奇偶规则）。
pub fn inside(p: P, poly: &[P]) -> bool {
    let mut c = false;
    let n = poly.len();
    let mut j = n - 1;
    for i in 0..n {
        let (a, b) = (poly[i], poly[j]);
        if (a.1 > p.1) != (b.1 > p.1) && p.0 < (b.0 - a.0) * (p.1 - a.1) / (b.1 - a.1) + a.0 {
            c = !c;
        }
        j = i;
    }
    c
}

/// 多边形的有符号距离场（内部为正），只精确计算到 `cap` 格，远处夹取为 ±cap。
pub fn polygon_sdf(poly: &[P], w: usize, h: usize, cap: f64) -> Grid<f64> {
    let n = poly.len();
    // 包围盒外的格直接按包围盒距离估计（都在外部）
    let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
    for &(x, y) in poly {
        x0 = x0.min(x);
        y0 = y0.min(y);
        x1 = x1.max(x);
        y1 = y1.max(y);
    }
    Grid::from_fn(w, h, |x, y| {
        let p = (x as f64, y as f64);
        let bx = (x0 - p.0).max(p.0 - x1).max(0.0);
        let by = (y0 - p.1).max(p.1 - y1).max(0.0);
        if (bx * bx + by * by).sqrt() > cap {
            return -cap;
        }
        let mut d = f64::MAX;
        let mut j = n - 1;
        for i in 0..n {
            let (dd, _) = seg_dist(p, poly[j], poly[i]);
            d = d.min(dd);
            j = i;
        }
        let d = d.min(cap);
        if inside(p, poly) { d } else { -d }
    })
}

/// 平滑的钟形衰减：t = 0 时为 1，t ≥ 1 时为 0。
pub fn bump(t: f64) -> f64 {
    if t >= 1.0 {
        0.0
    } else {
        let s = 1.0 - t * t;
        s * s
    }
}

/// 平滑阶跃（0 → 1）。
pub fn smoothstep(e0: f64, e1: f64, x: f64) -> f64 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn square_sdf_signs() {
        let sq = vec![(2.0, 2.0), (8.0, 2.0), (8.0, 8.0), (2.0, 8.0)];
        let d = polygon_sdf(&sq, 12, 12, 50.0);
        assert!(d.get(5, 5) > 2.9);
        assert!(d.get(0, 0) < -2.0);
        assert!(d.get(2, 5).abs() < 1e-9);
    }

    #[test]
    fn kept_corners_stay_sharp() {
        let sq = vec![(-10.0, -10.0), (20.0, -10.0), (20.0, 20.0), (-10.0, 20.0)];
        let out = chaikin_closed_keep(&sq, 2, |p| p.0 < 0.0 || p.1 < 0.0);
        assert!(out.contains(&(-10.0, -10.0)));
        assert!(!out.contains(&(20.0, 20.0)));
        assert!(inside((0.0, 0.0), &out));
    }

    #[test]
    fn polyline_position_runs_from_zero_to_one() {
        let line = vec![(0.0, 0.0), (10.0, 0.0)];
        let (d, t) = polyline_dist((7.0, 2.0), &line);
        assert!((d - 2.0).abs() < 1e-9 && (t - 0.7).abs() < 1e-9);
    }
}
