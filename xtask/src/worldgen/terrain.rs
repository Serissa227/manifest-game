//! 地形：骨架距离场 → 扰动海岸（域扭曲、分形噪声、岩性硬度）→ 高程（台地、桌山、丘陵、山脉、火山、陨石坑）
//! → 河流侵蚀 → 海岸过程（河谷淹没成峡湾 / 溺谷 / 河口湾、沙岸与堰洲岛、礁石、环礁、三角洲）→ 海平面
//! → 清理（形态学）→ 大陆架。

use super::grid::{Grid, N4, N8, components4, distance_to, neighbors8, sea_reach};
use super::layout::Layout;
use super::noise::{Noise, Rng, Warp, unit};
use super::shape::{bump, chaikin_closed, chaikin_closed_keep, chaikin_open, polygon_sdf, polyline_dist, smoothstep};
use std::collections::{BTreeMap, BinaryHeap};

/// 各类分区的强度场（0 = 不在分区内，1 = 完全在分区内）。
pub struct Zones {
    fields: BTreeMap<String, Grid<f64>>,
    w: usize,
    h: usize,
}

impl Zones {
    /// 多边形分区先套用与海岸相同的域扭曲再参与计算（边界不再是尺子画的直线，并与扭曲后的海岸对齐）；
    /// 椭圆分区是按成图位置点的局部标记，默认不扭曲（可用 `warp` 字段改）。
    pub fn build(l: &Layout) -> Zones {
        let (w, h) = (l.width, l.height);
        let warp = Warp::new(l.seed, 11, l.params.warp_amount, l.params.warp_wavelength);
        let coords: Vec<(f64, f64)> = (0..w * h).map(|i| warp.apply((i % w) as f64, (i / w) as f64)).collect();
        let mut fields: BTreeMap<String, Grid<f64>> = BTreeMap::new();
        for (zi, z) in l.zone.iter().enumerate() {
            let poly = chaikin_closed(&z.polygon(), 2);
            let sdf = polygon_sdf(&poly, w, h, z.feather + 4.0 + z.edge_noise);
            let warped = z.warp.unwrap_or(z.center.is_none());
            let en = Noise::new(l.seed, 900 + zi as u64);
            let f = fields.entry(z.kind.clone()).or_insert_with(|| Grid::new(w, h, 0.0));
            for (i, (fv, &(cx, cy))) in f.v.iter_mut().zip(coords.iter()).enumerate() {
                let mut d = if warped { sample(&sdf, cx, cy) } else { sdf.v[i] };
                if z.edge_noise > 0.0 {
                    // 边界起伏：两层噪声（波长 edge_wavelength 与其 0.4 倍），边界成锯齿与舌状伸出
                    let (x, y) = ((i % w) as f64, (i / w) as f64);
                    d += z.edge_noise
                        * (0.7 * en.fbm(x, y, z.edge_wavelength, 3, 0.55)
                            + 0.3 * en.fbm(x + 71.0, y - 13.0, z.edge_wavelength * 0.4, 2, 0.5));
                }
                let s = smoothstep(-z.feather * 0.5, z.feather * 0.5, d) * z.strength;
                if s > *fv {
                    *fv = s;
                }
            }
        }
        Zones { fields, w, h }
    }

    #[inline]
    pub fn get(&self, kind: &str, x: usize, y: usize) -> f64 {
        self.fields.get(kind).map_or(0.0, |g| g.v[y * self.w + x])
    }

    pub fn dims(&self) -> (usize, usize) {
        (self.w, self.h)
    }
}

/// 地形结果。
pub struct Terrain {
    /// 高程（米），陆地 > 0
    pub elev: Grid<f64>,
    pub land: Grid<bool>,
    pub shallow: Grid<bool>,
    /// 被填平的低平封闭水体（内陆湖、潟湖、陨石坑湖），在植被图上画成湿地
    pub wetland: Grid<bool>,
    /// 三角洲
    pub delta: Grid<bool>,
    /// 三角洲上的主河道与汊道（植被画成湿地）
    pub delta_channel: Grid<bool>,
    /// 火山口附近（植被图画成火山地）
    pub volcanic: Grid<bool>,
    /// 强制开通的水道
    pub channel: Grid<bool>,
    /// 峡湾内部的深水格（口门的浅槛不算）
    pub fjord: Grid<bool>,
    /// 清理时不填的海格（水道、被淹没的河谷、环礁潟湖与通道）
    pub keep_sea: Grid<bool>,
    /// 清理时不删的陆格（环礁的礁岛）
    pub keep_land: Grid<bool>,
    /// 一定是浅海的海格（环礁潟湖）
    pub force_shallow: Grid<bool>,
    /// 各格到陆地的距离（海格）/ 到海的距离（陆格）
    pub dist_land: Grid<f64>,
    pub dist_sea: Grid<f64>,
}

/// 火山：中心、半径、高度、破火山口半径、开口方向、锥顶偏移、是否火山（陨石坑不是）。
struct Cone {
    c: [f64; 2],
    radius: f64,
    height: f64,
    caldera: f64,
    breach: Option<[f64; 2]>,
    offset: [f64; 2],
    volcanic: bool,
    /// 陨石坑：坑心是封闭的湖（没有缺口时）
    crater: bool,
    /// 岛弧上的火山锥：侵蚀之后仍保证锥形（岛小，侵蚀会把它削平）
    arc: bool,
}
/// 河谷引导：平滑后的折线、半宽、压低比例。
type ValleyLine = (Vec<(f64, f64)>, f64, f64);

/// 岛屿用的小尺度扭曲。
struct IslWarp {
    n1: Noise,
    n2: Noise,
}

impl IslWarp {
    fn a(&self, x: f64, y: f64) -> f64 {
        self.n1.fbm(x, y, 9.0, 3, 0.5)
    }
    fn b(&self, x: f64, y: f64) -> f64 {
        self.n2.fbm(x, y, 9.0, 3, 0.5)
    }
}

/// 双线性采样。
pub fn sample(g: &Grid<f64>, x: f64, y: f64) -> f64 {
    let x = x.clamp(0.0, (g.w - 1) as f64);
    let y = y.clamp(0.0, (g.h - 1) as f64);
    let (x0, y0) = (x.floor() as usize, y.floor() as usize);
    let (x1, y1) = ((x0 + 1).min(g.w - 1), (y0 + 1).min(g.h - 1));
    let (fx, fy) = (x - x0 as f64, y - y0 as f64);
    let a = g.get(x0, y0) + fx * (g.get(x1, y0) - g.get(x0, y0));
    let b = g.get(x0, y1) + fx * (g.get(x1, y1) - g.get(x0, y1));
    a + fy * (b - a)
}

fn norm(v: [f64; 2]) -> (f64, f64) {
    let l = (v[0] * v[0] + v[1] * v[1]).sqrt().max(1e-9);
    (v[0] / l, v[1] / l)
}

/// 一个岛屿的形状：有符号距离场按岛的大小做域扭曲与低频形变，并随机切出一个湾口。
/// `sd` 为岛的原始距离场（全图），结果并入 `isl`（取最大值），`isl_r` 记录各格所属岛的内切半径。
#[allow(clippy::too_many_arguments)]
fn stamp_island(
    sd: &Grid<f64>,
    seed: u64,
    idx: u64,
    bay: bool,
    gentle: bool,
    height: f64,
    isl: &mut Grid<f64>,
    isl_r: &mut Grid<f64>,
    uplift: &mut Grid<f64>,
) {
    let (w, h) = (sd.w, sd.h);
    // 内切半径与包围盒
    let mut r_in: f64 = 0.0;
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0usize, 0usize);
    let (mut cx, mut cy, mut cn) = (0.0, 0.0, 0.0);
    for y in 0..h {
        for x in 0..w {
            let v = sd.get(x, y);
            if v > 0.0 {
                r_in = r_in.max(v);
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
                cx += x as f64;
                cy += y as f64;
                cn += 1.0;
            }
        }
    }
    if cn == 0.0 {
        return;
    }
    let (cx, cy) = (cx / cn, cy / cn);
    let r_in = r_in.max(0.8);
    // 扭曲幅度与波长按岛的大小：小岛也会被揉成不规则的形状，而不是一颗豆子。
    // 岛弧上的小岛（gentle）已经沿弧线拉长，只轻轻揉一下，免得又被揉回一团
    let amp = if gentle { (0.4 * r_in).max(0.55) } else { (0.5 * r_in).max(1.1) };
    let wl = (2.0 * r_in).max(if gentle { 5.0 } else { 4.0 });
    let n1 = Noise::new(seed, 300 + idx * 2);
    let n2 = Noise::new(seed, 301 + idx * 2);
    let n3 = Noise::new(seed, 700 + idx);
    // 湾口：沿随机方向从岛心走到岸边，往里挖一个小圆
    let mut bay_c: Option<((f64, f64), f64)> = None;
    if bay && r_in >= 2.5 {
        let mut rng = Rng::new(seed ^ (idx + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15) ^ 0xba7);
        let (ux, uy) = norm([rng.range(-1.0, 1.0), rng.range(-1.0, 1.0)]);
        let mut k = 0.0;
        let mut edge = (cx, cy);
        while k < 60.0 {
            let (px, py) = (cx + ux * k, cy + uy * k);
            if sample(sd, px, py) <= 0.0 {
                break;
            }
            edge = (px, py);
            k += 0.5;
        }
        let br = 0.38 * r_in + 0.6;
        bay_c = Some(((edge.0 - ux * 0.25 * r_in, edge.1 - uy * 0.25 * r_in), br));
    }
    let m = (amp * 2.0 + 3.0).ceil() as usize;
    for y in y0.saturating_sub(m)..=(y1 + m).min(h - 1) {
        for x in x0.saturating_sub(m)..=(x1 + m).min(w - 1) {
            let (fx, fy) = (x as f64, y as f64);
            let dx = n1.fbm(fx, fy, wl, 2, 0.5);
            let dy = n2.fbm(fx, fy, wl, 2, 0.5);
            // 低频形变：沿岸线把一侧鼓出、一侧收进
            let bulge = 0.3 * r_in * n3.fbm(fx, fy, wl * 1.3, 2, 0.5);
            let mut v = sample(sd, fx + amp * dx, fy + amp * dy) + bulge;
            if let Some(((bx, by), br)) = bay_c {
                let d = ((fx - bx).powi(2) + (fy - by).powi(2)).sqrt();
                v = v.min(d - br);
            }
            let i = y * w + x;
            if v > isl.v[i] {
                isl.v[i] = v;
                isl_r.v[i] = r_in;
                if v > 0.0 {
                    uplift.v[i] = height;
                }
            }
        }
    }
}

/// 骨架的各个场：有符号距离（陆地为正）、岛屿距离场、岛屿内切半径、抬升系数，以及岛弧上的 1 格礁岩。
type Skeleton = (Grid<f64>, Grid<f64>, Grid<f64>, Grid<f64>, Vec<(usize, usize)>);

/// 骨架有符号距离场（陆地为正）、岛屿距离场、岛屿内切半径与抬升系数。
fn skeleton(l: &Layout, rng_seed: u64) -> Skeleton {
    let (w, h) = (l.width, l.height);
    let cap = 90.0;
    let mut d = Grid::new(w, h, -cap);
    let mut uplift = Grid::new(w, h, 1.0);
    let outside = |p: (f64, f64)| p.0 < 0.0 || p.1 < 0.0 || p.0 > (w - 1) as f64 || p.1 > (h - 1) as f64;
    for s in &l.land {
        let poly = chaikin_closed_keep(&s.polygon(), s.smooth, outside);
        let sd = polygon_sdf(&poly, w, h, cap);
        for i in 0..d.v.len() {
            if sd.v[i] > d.v[i] {
                d.v[i] = sd.v[i];
            }
            if sd.v[i] > 0.0 {
                uplift.v[i] = s.height;
            }
        }
    }
    for s in &l.sea {
        let poly = chaikin_closed(&s.polygon(), s.smooth);
        let sd = polygon_sdf(&poly, w, h, cap);
        for i in 0..d.v.len() {
            d.v[i] = d.v[i].min(-sd.v[i]);
        }
    }
    // 岛屿与岛弧另存一份（岛屿的扰动幅度按岛的大小缩放，免得小岛被噪声抹掉）
    let mut isl = Grid::new(w, h, -cap);
    let mut isl_r = Grid::new(w, h, 0.0);
    let mut islets = Vec::new();
    for (ii, s) in l.island.iter().enumerate() {
        let poly = chaikin_closed(&s.polygon(), s.smooth);
        let sd = polygon_sdf(&poly, w, h, 24.0);
        stamp_island(&sd, rng_seed, ii as u64, s.bay, false, s.height, &mut isl, &mut isl_r, &mut uplift);
    }
    for isle in arc_isles(l, rng_seed) {
        let (c, (ux, uy), ax, ay) = (isle.c, isle.dir, isle.ax, isle.ay);
        let sd = Grid::from_fn(w, h, |x, y| {
            let (dx, dy) = (x as f64 - c.0, y as f64 - c.1);
            if dx.abs() > ax + 8.0 || dy.abs() > ax + 8.0 {
                return -24.0;
            }
            let (u, v) = ((dx * ux + dy * uy) / ax, (-dx * uy + dy * ux) / ay);
            (1.0 - (u * u + v * v).sqrt()) * ay.min(ax)
        });
        let idx = 1000 + (isle.arc as u64) * 64 + isle.k as u64;
        let a = &l.arc[isle.arc];
        // 小岛（长轴 < 2.5 格）不切湾口，免得被切成两半
        stamp_island(&sd, rng_seed, idx, ax >= 2.5, true, a.height, &mut isl, &mut isl_r, &mut uplift);
        for &(px, py) in &isle.islets {
            let (x, y) = (px.round(), py.round());
            if x >= 0.0 && y >= 0.0 && (x as usize) < w && (y as usize) < h {
                islets.push((x as usize, y as usize));
            }
        }
    }
    (d, isl, isl_r, uplift, islets)
}

/// 重新采样折线，使相邻点间距不超过 `step` 格。
fn resample(line: &[(f64, f64)], step: f64) -> Vec<(f64, f64)> {
    let mut out = Vec::new();
    for w in line.windows(2) {
        let d = ((w[1].0 - w[0].0).powi(2) + (w[1].1 - w[0].1).powi(2)).sqrt();
        let n = (d / step).ceil().max(1.0) as usize;
        for k in 0..n {
            let t = k as f64 / n as f64;
            out.push((w[0].0 + t * (w[1].0 - w[0].0), w[0].1 + t * (w[1].1 - w[0].1)));
        }
    }
    if let Some(&p) = line.last() {
        out.push(p);
    }
    out
}

/// 一次完整的地形生成。`rain` 为侵蚀用的粗略降水（约 0.08–1.6）：汇流量按降水加权，干旱区侵蚀弱、地势平。
pub fn build(l: &Layout, z: &Zones, rain: &Grid<f64>) -> Terrain {
    let (w, h) = (l.width, l.height);
    let p = &l.params;
    let seed = l.seed;
    let (skel, isl, isl_r, uplift, islets) = skeleton(l, seed);

    // ── 1. 扰动海岸：域扭曲 + 分形噪声 + 岩性硬度 ──
    let warp = Warp::new(seed, 11, p.warp_amount, p.warp_wavelength);
    // 中尺度的第二层扭曲：把岸线揉出 5–20 格的弯折、钩状岬角与小湾（只作用于海岸附近）
    let warp2 = Warp::new(seed, 27, p.warp2_amount, p.warp2_wavelength);
    let coast_lo = Noise::new(seed, 12);
    let coast_hi = Noise::new(seed, 13);
    let hills = Noise::new(seed, 14);
    let isl_n = Noise::new(seed, 16);
    let isl_warp = IslWarp { n1: Noise::new(seed, 17), n2: Noise::new(seed, 18) };
    let hard_n = Noise::new(seed, 19);
    let coast_mid_n = Noise::new(seed, 28);
    let ridge_n = Noise::new(seed, 15);
    let mut d2 = Grid::new(w, h, 0.0);
    for y in 0..h {
        for x in 0..w {
            let (fx, fy) = (x as f64, y as f64);
            let (wx0, wy0) = warp.apply(fx, fy);
            // 沙岸、平缓海岸、低地海岸的扰动小一些，但不归零：中尺度的岬角、海湾与沙嘴仍然要有
            let wmod = (1.0 + 0.4 * z.get("rough", x, y)
                - 0.45 * z.get("sandy", x, y)
                - 0.3 * z.get("calm", x, y)
                - 0.35 * z.get("lowland", x, y))
            .clamp(0.25, 1.5);
            let near_coast = wmod * (1.0 - smoothstep(4.0, 12.0, sample(&skel, wx0, wy0).abs()));
            let (wx2, wy2) = warp2.apply(wx0, wy0);
            let (wx, wy) = (wx0 + near_coast * (wx2 - wx0), wy0 + near_coast * (wy2 - wy0));
            let base = sample(&skel, wx, wy);
            let fj = z.get("fjord", x, y);
            let sk = z.get("skerry", x, y);
            let sandy = z.get("sandy", x, y);
            let calm = z.get("calm", x, y);
            // 峡湾区里不再叠加破碎海岸的扰动（峡湾由河谷淹没产生，扰动叠上去只会变成虫蛀的迷宫）
            let rough = z.get("rough", x, y) * (1.0 - fj.min(1.0));
            // 低地海岸（范德兰）的河口湾与圩田海岸由骨架决定，扰动小一些，免得把河口填平
            let low = z.get("lowland", x, y);
            let amp = p.coast_noise
                * (1.0 + 0.2 * fj + 0.5 * rough + 0.2 * sk - 0.55 * sandy - 0.6 * calm - 0.35 * low).max(0.15);
            let lo = coast_lo.fbm(wx, wy, p.coast_wavelength, p.coast_octaves, p.coast_gain);
            let detail = coast_hi.fbm(fx, fy, 7.0, 3, 0.55);
            let dw = (0.25 + 0.3 * rough + 0.3 * sk - 0.25 * sandy - 0.2 * calm).max(0.0);
            // 岩性硬度：阈值化的低频噪声，硬岩成岬、软岩成湾（真实海岸差异侵蚀的主要来源）
            let hb = smoothstep(-0.35, 0.35, hard_n.fbm(wx, wy, p.hardness_wavelength, 2, 0.5)) * 2.0 - 1.0;
            let coastal = 1.0 - smoothstep(5.0, 14.0, base.abs());
            let hard = p.hardness * hb * coastal * (1.0 - 0.5 * sandy - 0.35 * calm - 0.4 * low).max(0.25);
            // 中尺度（波长 7–14 格）的岸线起伏：岬角与小湾，幅度按海岸类型缩放（沙岸、平缓海岸小，破碎海岸大）
            // 用脊状噪声：岬角尖、海湾圆（波浪折射让海湾成弧形、岬角被削尖），而不是一律平滑的波浪线
            let mid = p.coast_mid * wmod * (coast_mid_n.ridged(wx, wy, 16.0, 3) - 0.47) * 2.0;
            let mut v = base + amp * (lo + dw * detail) + hard + mid;
            // 岛屿：岛形已在骨架里按大小扭曲过，这里只加少量细节，幅度随岛的大小缩放
            let iv = isl.get(x, y);
            if iv > -14.0 {
                let r = isl_r.get(x, y).max(0.8);
                let (ix, iy) = (isl_warp.a(fx, fy), isl_warp.b(fx, fy));
                let iw = sample(&isl, fx + 0.35 * r * ix, fy + 0.35 * r * iy);
                // 小岛（岛弧上沿弧线拉长的岛）细节噪声小一些，免得又被揉回圆点
                let isl_amp = if r < 1.6 { 0.3 + 0.15 * r } else { 0.5 + 0.18 * r };
                let fine = isl_n.fbm(fx, fy, 5.5, 4, 0.6);
                v = v.max(iw + isl_amp * (0.4 * lo + 1.0 * fine));
            }
            d2.set(x, y, v);
        }
    }

    // ── 2. 山脉与火山的抬升（米）──
    let mut rng_add: Grid<f64> = Grid::new(w, h, 0.0);
    let sad_n = Noise::new(seed, 26);
    for (ri, r) in l.range.iter().enumerate() {
        let base_line = chaikin_open(&r.points.iter().map(|q| (q[0], q[1])).collect::<Vec<_>>(), 2);
        let line0 = resample(&base_line, 1.5);
        // 脊线左右摆动：沿弧长取一维噪声，沿法线方向挪开
        let wn = Noise::new(seed, 400 + ri as u64);
        let mut line = Vec::with_capacity(line0.len());
        let mut s = 0.0;
        for i in 0..line0.len() {
            if i > 0 {
                s += ((line0[i].0 - line0[i - 1].0).powi(2) + (line0[i].1 - line0[i - 1].1).powi(2)).sqrt();
            }
            let a = line0[i.saturating_sub(1)];
            let b = line0[(i + 1).min(line0.len() - 1)];
            let (tx, ty) = norm([b.0 - a.0, b.1 - a.1]);
            let off = r.wander * wn.fbm(s, 7.3, 26.0, 2, 0.5);
            line.push((line0[i].0 - ty * off, line0[i].1 + tx * off));
        }
        let wmax = r.widths.iter().copied().fold(r.width, f64::max);
        let reach_max = wmax * 2.6 + r.wander;
        let (mut x0, mut y0, mut x1, mut y1) = (f64::MAX, f64::MAX, f64::MIN, f64::MIN);
        for &(px, py) in &line {
            x0 = x0.min(px);
            y0 = y0.min(py);
            x1 = x1.max(px);
            y1 = y1.max(py);
        }
        let xa = (x0 - reach_max).floor().max(0.0) as usize;
        let xb = ((x1 + reach_max).ceil().max(0.0) as usize).min(w - 1);
        let ya = (y0 - reach_max).floor().max(0.0) as usize;
        let yb = ((y1 + reach_max).ceil().max(0.0) as usize).min(h - 1);
        for y in ya..=yb {
            for x in xa..=xb {
                // 用扭曲后的坐标量距离，山脊线不再是光滑的管子
                let (wx, wy) = warp.apply(x as f64 * 1.7 + 311.0, y as f64 * 1.7 - 97.0);
                let (qx, qy) =
                    (x as f64 + (wx - x as f64 * 1.7 - 311.0) * 0.35, y as f64 + (wy - y as f64 * 1.7 + 97.0) * 0.35);
                let (dist, t) = polyline_dist((qx, qy), &line);
                let (wid, hgt) = r.profile(t);
                let wid = wid.max(0.5);
                let reach = wid * 2.6;
                if dist > reach {
                    continue;
                }
                let taper =
                    if r.taper > 0.0 { smoothstep(0.0, r.taper, t) * smoothstep(0.0, r.taper, 1.0 - t) } else { 1.0 };
                // 鞍部与山口：沿线按 20–40 格波长压低脊线
                let sad = 1.0 - r.saddle * smoothstep(-0.05, 0.45, sad_n.fbm(x as f64, y as f64, 30.0, 2, 0.5));
                let rid = ridge_n.ridged(x as f64, y as f64, 11.0, 5);
                let core = bump(dist / wid);
                let foot = bump(dist / reach);
                let add =
                    hgt * sad * (0.3 + 0.7 * taper) * (core * (0.3 + 0.7 * rid) + 0.22 * foot * (0.5 + 0.5 * rid));
                let i = y * w + x;
                rng_add.v[i] += add;
            }
        }
    }
    let mut volcanic = Grid::new(w, h, false);
    let mut caldera_sea = Grid::new(w, h, false);
    let mut crater_lake = Grid::new(w, h, false);
    let mut vol_add: Grid<f64> = Grid::new(w, h, 0.0);
    // 火山锥的“保底”高程：侵蚀与热力侵蚀之后再抬回去（岛弧上的小火山岛与没有破火山口的火山），锥形因此认得出来
    let mut cone_floor: Grid<f64> = Grid::new(w, h, 0.0);
    let arc_cones: Vec<([f64; 2], f64, f64, [f64; 2])> = arc_isles(l, seed)
        .into_iter()
        .filter_map(|a| a.cone.map(|(off, hgt)| ([a.c.0, a.c.1], (a.ax * 1.15).max(2.0), hgt, off)))
        .collect();
    let cones: Vec<Cone> = l
        .volcano
        .iter()
        .map(|v| Cone {
            c: v.center,
            radius: v.radius,
            height: v.height,
            caldera: v.caldera,
            breach: v.breach,
            offset: v.offset.unwrap_or([0.0, 0.0]),
            volcanic: true,
            crater: false,
            arc: false,
        })
        .chain(arc_cones.into_iter().map(|(c, r, hgt, off)| Cone {
            c,
            radius: r,
            height: hgt,
            caldera: 0.0,
            breach: None,
            offset: off,
            volcanic: true,
            crater: false,
            arc: true,
        }))
        .chain(l.crater.iter().map(|c| Cone {
            c: c.center,
            radius: c.radius + 2.6,
            height: c.rim,
            caldera: c.radius,
            breach: c.breach,
            offset: [0.0, 0.0],
            volcanic: false,
            crater: true,
            arc: false,
        }))
        .collect();
    for cone in &cones {
        let (c, radius, height, caldera) = (cone.c, cone.radius, cone.height, cone.caldera);
        let top = [c[0] + cone.offset[0], c[1] + cone.offset[1]];
        let ra = radius + 2.0;
        for y in (c[1] - ra).max(0.0) as usize..=((c[1] + ra) as usize).min(h - 1) {
            for x in (c[0] - ra).max(0.0) as usize..=((c[0] + ra) as usize).min(w - 1) {
                let dist = ((x as f64 - c[0]).powi(2) + (y as f64 - c[1]).powi(2)).sqrt();
                if dist > radius {
                    continue;
                }
                let i = y * w + x;
                if caldera > 0.0 {
                    // 环形：半径 caldera 以内塌陷（火山口海湾 / 陨石坑湖），外面一圈陡峭的坑壁
                    if dist <= caldera {
                        if cone.crater && cone.breach.is_none() {
                            crater_lake.v[i] = true;
                        } else {
                            caldera_sea.v[i] = true;
                        }
                    } else {
                        let ring = bump(((dist - caldera - 1.0) / 1.8).abs());
                        vol_add.v[i] = vol_add.v[i].max(height * ring);
                        let ring_sd = 1.6 - (dist - caldera - 1.0).abs();
                        d2.v[i] = d2.v[i].max(ring_sd * 1.5);
                    }
                    if cone.volcanic && dist <= caldera + 2.2 && dist > caldera - 0.5 {
                        volcanic.v[i] = true;
                    }
                } else {
                    // 锥顶偏离中心：一侧陡、一侧缓
                    let dt = ((x as f64 - top[0]).powi(2) + (y as f64 - top[1]).powi(2)).sqrt();
                    let t = (dt / radius).min(1.0).max(dist / radius * 0.85);
                    let prof = height * (1.0 - t).max(0.0).powf(1.6);
                    vol_add.v[i] = vol_add.v[i].max(prof);
                    if cone.volcanic {
                        cone_floor.v[i] = cone_floor.v[i].max(prof * if cone.arc { 0.95 } else { 0.8 });
                    }
                    let vr = if cone.arc { 0.55 } else { 0.35 };
                    if cone.volcanic && dt / radius < vr {
                        volcanic.v[i] = true;
                    }
                }
            }
        }
        if let (true, Some(b)) = (caldera > 0.0, cone.breach) {
            // 缺口：从中心沿开口方向一直挖到明确的海里
            let (bx, by) = norm(b);
            let mut k = 0.0;
            while k <= radius + 12.0 {
                let mut reached = false;
                for off in [-0.5f64, 0.0, 0.5] {
                    let x = (c[0] + bx * k - by * off).round();
                    let y = (c[1] + by * k + bx * off).round();
                    if x >= 0.0 && y >= 0.0 && (x as usize) < w && (y as usize) < h {
                        let i = y as usize * w + x as usize;
                        caldera_sea.v[i] = true;
                        if k > radius && d2.v[i] + (rng_add.v[i] / 400.0).min(3.0) < -1.5 {
                            reached = true;
                        }
                    }
                }
                if reached {
                    break;
                }
                k += 0.5;
            }
        }
    }

    // ── 3. 目标高程（构造地形）──
    let land0 = Grid::from_fn(w, h, |x, y| {
        let i = y * w + x;
        d2.v[i] + (rng_add.v[i] / 400.0).min(3.0) > 0.0 && !caldera_sea.v[i]
    });
    let valleys: Vec<ValleyLine> = l
        .valley
        .iter()
        .map(|v| (chaikin_open(&v.points.iter().map(|q| (q[0], q[1])).collect::<Vec<_>>(), 2), v.width, v.depth))
        .collect();
    let mut target = Grid::new(w, h, 0.0);
    // 平滑的基底（海岸向内陆抬升、台地、桌山）：不参与侵蚀模拟，最后直接叠加，台地因此保持平坦
    let mut smooth_base: Grid<f64> = Grid::new(w, h, 0.0);
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if !land0.v[i] {
                target.v[i] = -25.0 + 55.0 * d2.v[i].min(0.0);
                continue;
            }
            let d = d2.v[i].max(0.3);
            let low = z.get("lowland", x, y);
            let plat = z.get("plateau", x, y);
            let erg = z.get("erg", x, y);
            let t = d / p.inland_distance;
            let base = p.inland_height * uplift.get(x, y) * (t / (1.0 + t)) * (1.0 - 0.85 * low);
            let hn = hills.fbm(x as f64, y as f64, 18.0, 6, 0.6);
            // 丘陵与平原交错：低频噪声决定哪里多丘陵、哪里是平原
            let mask = 0.2 + 0.8 * smoothstep(-0.2, 0.35, hills.fbm(x as f64 + 500.0, y as f64, 70.0, 3, 0.5));
            let flat = (1.0 - 0.8 * low) * (1.0 - 0.6 * z.get("arid", x, y)) * (1.0 - 0.4 * plat) * (1.0 - 0.8 * erg);
            let hl = p.hill_height * (0.5 + 0.5 * hn) * mask * smoothstep(0.0, 6.0, d) * flat;
            let pl = 520.0 * plat * smoothstep(0.0, 8.0, d);
            // 桌山：平顶、四周陡崖
            let ms = 640.0 * smoothstep(0.4, 0.62, z.get("mesa", x, y));
            // 岛屿内部起伏：脊状噪声，岛越大山越高
            let isz = isl.v[i].clamp(0.0, 8.0);
            let il =
                if isz > 0.0 { (180.0 + 90.0 * isz) * ridge_n.ridged(x as f64 + 71.0, y as f64, 7.0, 4) } else { 0.0 };
            let mut v = 6.0 + 0.3 * base + hl + il + rng_add.v[i] + vol_add.v[i];
            let mut sb = 0.7 * base + pl + ms;
            // 河谷：量距离前把点扭一扭，河谷（和河）就会蜿蜒
            let (mx, my) = (
                x as f64 + 3.5 * isl_warp.a(x as f64 * 1.3, y as f64 * 1.3),
                y as f64 + 3.5 * isl_warp.b(x as f64 * 1.3, y as f64 * 1.3),
            );
            for (line, vw, depth) in &valleys {
                let (dist, _) = polyline_dist((mx, my), line);
                if dist < vw * 2.5 {
                    let k = 1.0 - depth * bump(dist / (vw * 2.5));
                    v *= k;
                    sb *= k;
                }
            }
            if crater_lake.v[i] {
                v = 8.0;
                sb = 0.0;
            }
            target.v[i] = v.max(4.0);
            smooth_base.v[i] = sb;
        }
    }

    // ── 4. 抬升—侵蚀：河谷网在这里自然长出来 ──
    let kfield = Grid::from_fn(w, h, |x, y| (1.0 + 1.6 * z.get("fjord", x, y) + 0.4 * z.get("ria", x, y)).max(0.3));
    // 初始地表：只保留山脉、火山与河谷引导，其余是低缓的噪声面。流向由“侵入渗流”式的填洼顺序决定，
    // 于是内陆会长出长而曲折的大河，而不是一律从海岸径直流下的短溪。
    let init_n = Noise::new(seed, 62);
    let init = Grid::from_fn(w, h, |x, y| {
        let i = y * w + x;
        if !land0.v[i] {
            return -10.0;
        }
        let mut v = 0.35 * (rng_add.v[i] + vol_add.v[i])
            + 30.0 * (1.0 + init_n.fbm(x as f64, y as f64, 14.0, 4, 0.55))
            + 1.5 * d2.v[i].clamp(0.0, 12.0);
        let (mx, my) = (
            x as f64 + 3.5 * isl_warp.a(x as f64 * 1.3, y as f64 * 1.3),
            y as f64 + 3.5 * isl_warp.b(x as f64 * 1.3, y as f64 * 1.3),
        );
        for (line, vw, depth) in &valleys {
            let (dist, _) = polyline_dist((mx, my), line);
            if dist < vw * 2.5 {
                v *= 1.0 - depth * bump(dist / (vw * 2.5));
            }
        }
        v.max(1.0)
    });
    let rain_w = Grid::from_fn(w, h, |x, y| rain.get(x, y).clamp(0.08, 1.6));
    let (sim, sim_area, sim_recv) =
        uplift_erode(&target, &init, &land0, &kfield, &rain_w, p.erosion_iterations, p.erosion_k, p.erosion_m);
    let mut e = Grid::new(w, h, 0.0);
    {
        let mut tv: Vec<f64> = (0..w * h).filter(|&i| land0.v[i]).map(|i| target.v[i]).collect();
        let mut sv: Vec<f64> = (0..w * h).filter(|&i| land0.v[i]).map(|i| sim.v[i]).collect();
        tv.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        sv.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let q = |v: &Vec<f64>| v.get(v.len() * 995 / 1000).copied().unwrap_or(1.0).max(1.0);
        let s = q(&tv) / q(&sv);
        let b = p.erosion_blend.clamp(0.0, 1.0);
        for i in 0..w * h {
            e.v[i] = if land0.v[i] {
                (b * sim.v[i] * s + (1.0 - b) * target.v[i] + smooth_base.v[i]).max(1.0)
            } else {
                target.v[i]
            };
        }
    }
    thermal(&mut e, p.talus, 4, &caldera_sea);
    for i in 0..w * h {
        if crater_lake.v[i] {
            e.v[i] = 3.0;
        }
        if land0.v[i] && cone_floor.v[i] > e.v[i] {
            e.v[i] = cone_floor.v[i];
        }
    }

    // ── 5. 海岸过程 ──
    // 河谷淹没：冰后期海平面上升，海水沿河谷倒灌。只淹大的河谷，同一段海岸上只留汇流最大的一条，
    // 峡湾又深又长、会分叉、口门有浅槛；溺谷短而分叉；干旱海岸没有河谷可淹。
    let pre_land = Grid::from_fn(w, h, |x, y| land0.get(x, y) && e.get(x, y) > 0.0);
    let fl = drown_valleys(l, z, &mut e, &pre_land, &sim_area, &sim_recv, rain);
    let delta = Grid::new(w, h, false);

    let mut land = Grid::from_fn(w, h, |x, y| e.get(x, y) > 0.0);
    let mut keep_sea = fl.flooded.clone();

    // 沙岸：把海岸线抹平，再在离岸 2–3 格堆出堰洲岛与沙嘴
    let sandy_any = (0..w * h).any(|i| z.get("sandy", i % w, i / w) > 0.3);
    if sandy_any {
        let lf = Grid::from_fn(w, h, |x, y| if land.get(x, y) { 1.0 } else { 0.0 });
        let bl = super::grid::blur(&lf, 1);
        for y in 0..h {
            for x in 0..w {
                let s = z.get("sandy", x, y);
                if s > 0.3 && !delta.get(x, y) && !fl.flooded.get(x, y) {
                    let v = bl.get(x, y) > 0.5;
                    land.set(x, y, v);
                    let i = y * w + x;
                    if v && e.v[i] <= 0.0 {
                        e.v[i] = 3.0;
                    } else if !v && e.v[i] > 0.0 {
                        e.v[i] = -5.0;
                    }
                }
            }
        }
        // 潟湖：沙岸第二排陆格在噪声高处被海水灌进来，外侧一排留作沙堤（开口处成为潮汐通道）
        let ds = distance_to(&land, false);
        let ln = Noise::new(seed, 24);
        for y in 0..h {
            for x in 0..w {
                let s = z.get("sandy", x, y);
                if s < 0.5 || !land.get(x, y) || delta.get(x, y) {
                    continue;
                }
                let d = ds.get(x, y);
                let n = ln.fbm(x as f64, y as f64, 9.0, 3, 0.55);
                let lagoon = (1.9..=3.1).contains(&d) && n > 0.32;
                let inlet = (0.9..=1.1).contains(&d) && n > 0.62;
                if lagoon || inlet {
                    land.set(x, y, false);
                    e.set(x, y, -3.0);
                }
            }
        }
    }
    // 堰洲岛：离岸 2–3 格一串被潮汐通道隔开的沙岛
    let barrier_any = (0..w * h).any(|i| z.get("barrier", i % w, i / w) > 0.3);
    if barrier_any {
        let dl = distance_to(&land, true);
        let bn = Noise::new(seed, 22);
        let bn2 = Noise::new(seed, 25);
        let mut add = Vec::new();
        for y in 0..h {
            for x in 0..w {
                let s = z.get("barrier", x, y);
                if s < 0.5 || land.get(x, y) {
                    continue;
                }
                let band = 2.4 + 0.8 * bn2.gradient(x as f64 * 0.15, y as f64 * 0.15);
                let dd = dl.get(x, y);
                if (dd - band).abs() <= 0.55 {
                    let n = bn.gradient(x as f64 * 0.21, y as f64 * 0.21);
                    if n > -0.05 {
                        add.push((x, y));
                    }
                }
            }
        }
        for (x, y) in add {
            land.set(x, y, true);
            e.set(x, y, 2.0);
        }
    }

    // 礁石与岩礁群：离岸小岛。岩礁只在峡湾口外，不堵进峡湾里
    let dl = distance_to(&land, true);
    let dfj = distance_to(&fl.flooded, true);
    let rn = Noise::new(seed, 23);
    for y in 0..h {
        for x in 0..w {
            if land.get(x, y) {
                continue;
            }
            let reef = z.get("reef", x, y);
            let sk = z.get("skerry", x, y);
            let dd = dl.get(x, y);
            let n = rn.gradient(x as f64 * 0.45, y as f64 * 0.45) * 0.6 + unit(seed ^ 77, x as i64, y as i64) * 0.8;
            let reef_hit = reef > 0.5 && (2.5..=6.5).contains(&dd) && n > 1.22;
            let sk_hit = sk > 0.35 && (1.5..=4.0).contains(&dd) && n > 1.1 && dfj.get(x, y) > 2.5;
            if reef_hit || sk_hit {
                land.set(x, y, true);
                e.set(x, y, if sk_hit { 25.0 } else { 2.0 });
            }
        }
    }

    // 环礁：一圈断续的礁岛围着浅海潟湖（不参与海岸噪声）
    let mut keep_land = Grid::new(w, h, false);
    let mut force_shallow = Grid::new(w, h, false);
    for (ai, a) in l.atoll.iter().enumerate() {
        let r = a.radius.max(2.0);
        let gaps: Vec<(f64, f64)> = a.gaps.iter().map(|g| norm(*g)).collect();
        let ra = r + 3.0;
        for y in (a.center[1] - ra).max(0.0) as usize..=((a.center[1] + ra) as usize).min(h - 1) {
            for x in (a.center[0] - ra).max(0.0) as usize..=((a.center[0] + ra) as usize).min(w - 1) {
                let (dx, dy) = (x as f64 - a.center[0], y as f64 - a.center[1]);
                let d = (dx * dx + dy * dy).sqrt();
                let i = y * w + x;
                if d > r + 2.6 {
                    continue;
                }
                let (ux, uy) = (dx / d.max(1e-9), dy / d.max(1e-9));
                let in_gap = gaps.iter().any(|&(gx, gy)| ux * gx + uy * gy > 0.94);
                let ring = (d - r).abs() <= 0.75;
                let hole = unit(seed ^ 0xa70 ^ ai as u64, x as i64, y as i64) < 0.12;
                if ring && !in_gap && !hole {
                    land.v[i] = true;
                    e.v[i] = 2.0;
                    keep_land.v[i] = true;
                } else {
                    land.v[i] = false;
                    e.v[i] = e.v[i].min(-4.0);
                    force_shallow.v[i] = true;
                    keep_sea.v[i] = true;
                }
            }
        }
    }

    // 峡湾口外的岩礁与口门的浅槛
    for &c in &fl.skerries {
        if !land.v[c] && !keep_sea.v[c] {
            land.v[c] = true;
            e.v[c] = 25.0;
            keep_land.v[c] = true;
        }
    }
    for &c in &fl.sill {
        if !land.v[c] {
            force_shallow.v[c] = true;
        }
    }
    // 岛弧上的礁岩与海蚀柱：长轴一端外侧的 1 格小岛（清理时保留）
    for &(x, y) in &islets {
        let i = y * w + x;
        if !land.v[i] && !keep_sea.v[i] {
            land.v[i] = true;
            e.v[i] = 25.0;
            keep_land.v[i] = true;
        }
    }

    // ── 6. 强制水道 ──
    let mut channel = Grid::new(w, h, false);
    for c in &l.channel {
        let line = chaikin_open(&c.points.iter().map(|q| (q[0], q[1])).collect::<Vec<_>>(), 2);
        for y in 0..h {
            for x in 0..w {
                let (dist, _) = polyline_dist((x as f64, y as f64), &line);
                if dist <= c.width * 0.5 {
                    channel.set(x, y, true);
                    land.set(x, y, false);
                    let i = y * w + x;
                    e.v[i] = e.v[i].min(-30.0);
                }
            }
        }
    }
    for i in 0..w * h {
        if caldera_sea.v[i] {
            land.v[i] = false;
            keep_sea.v[i] = true;
        }
        if channel.v[i] {
            keep_sea.v[i] = true;
        }
    }
    let mut wetland = Grid::new(w, h, false);
    for i in 0..w * h {
        if crater_lake.v[i] {
            land.v[i] = true;
            wetland.v[i] = true;
        }
    }

    let mut t = Terrain {
        elev: e,
        land,
        shallow: Grid::new(w, h, false),
        wetland,
        delta,
        delta_channel: Grid::new(w, h, false),
        volcanic,
        channel,
        fjord: fl.deep,
        keep_sea,
        keep_land,
        force_shallow,
        dist_land: Grid::new(w, h, 0.0),
        dist_sea: Grid::new(w, h, 0.0),
    };
    finish(&mut t, l, z);
    t
}

/// 河谷淹没的结果。
struct Flooded {
    /// 被淹没的全部格（清理时不填）
    flooded: Grid<bool>,
    /// 峡湾内部的深水格
    deep: Grid<bool>,
    /// 峡湾口门外的浅槛（一定是浅海）
    sill: Vec<usize>,
    /// 峡湾口外的岩礁（1 格小岛，清理时保留）
    skerries: Vec<usize>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Drown {
    Fjord,
    Ria,
    Estuary,
}

/// 河谷淹没：在河流入海处挑出汇流大的河谷，做沿岸的非极大值抑制（同一段海岸只留最大的一条），
/// 再沿汇流网向上游淹没：主干最长，支流按汇流比例分叉；峡湾内部是深水、口门留一格浅槛，两壁抬高成陡崖。
fn drown_valleys(
    l: &Layout,
    z: &Zones,
    e: &mut Grid<f64>,
    pre_land: &Grid<bool>,
    area: &[f64],
    recv: &[usize],
    rain: &Grid<f64>,
) -> Flooded {
    let (w, h) = (e.w, e.h);
    let n = w * h;
    let p = &l.params;
    let seed = l.seed;
    let mut kids: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (i, &r) in recv.iter().enumerate().take(n) {
        if pre_land.v[i] && r != i && r != usize::MAX && pre_land.v[r] {
            kids[r].push(i);
        }
    }
    // 候选河口
    let mut cands: Vec<(f64, usize, Drown, f64)> = Vec::new();
    for i in 0..n {
        if !pre_land.v[i] {
            continue;
        }
        let r = recv[i];
        if r == usize::MAX || r == i || pre_land.v[r] {
            continue;
        }
        let (x, y) = (i % w, i / w);
        let fj = z.get("fjord", x, y);
        let ri = z.get("ria", x, y);
        let wet = rain.get(x, y) >= 0.3;
        // 峡湾区的门槛低一些：同一段海岸上多淹几条次要的谷（次要的短、窄）
        let (kind, s, thr) = if fj > 0.3 {
            (Drown::Fjord, fj.min(1.2), p.fjord_area * 0.65)
        } else if ri > 0.3 && wet {
            (Drown::Ria, ri.min(1.2), p.ria_area)
        } else if wet {
            (Drown::Estuary, 1.0, p.drown_area)
        } else {
            continue;
        };
        if area[i] < thr {
            continue;
        }
        cands.push((area[i], i, kind, s));
    }
    cands.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal).then(a.1.cmp(&b.1)));
    let mut accepted: Vec<(usize, Drown, f64)> = Vec::new();
    for &(_, i, kind, s) in &cands {
        let (x, y) = ((i % w) as f64, (i / w) as f64);
        let k = if kind == Drown::Fjord { 0.7 } else { 1.0 };
        let spacing = k * p.mouth_spacing * (0.8 + 0.4 * unit(seed ^ 91, x as i64, y as i64));
        let near = accepted.iter().any(|&(j, _, _)| {
            let (jx, jy) = ((j % w) as f64, (j / w) as f64);
            ((jx - x).powi(2) + (jy - y).powi(2)).sqrt() < spacing
        });
        if !near {
            accepted.push((i, kind, s));
        }
    }
    let mut flooded = Grid::new(w, h, false);
    let mut deep = Grid::new(w, h, false);
    let mut fj_taken = Grid::new(w, h, false);
    let (mut sill, mut skerries) = (Vec::new(), Vec::new());
    let mut shallow_cells: Vec<usize> = Vec::new();
    let mut deep_cells: Vec<usize> = Vec::new();
    // 峡湾两壁：(格, 高度)
    let mut walls: Vec<(usize, f64)> = Vec::new();
    let main_kid = |c: usize| -> Option<usize> {
        kids[c]
            .iter()
            .copied()
            .max_by(|&a, &b| area[a].partial_cmp(&area[b]).unwrap_or(std::cmp::Ordering::Equal).then(b.cmp(&a)))
    };
    for &(mouth, kind, s) in &accepted {
        let (mx, my) = (mouth % w, mouth / w);
        // 主干长度
        let mut stem = 0usize;
        let mut c = mouth;
        while let Some(k) = main_kid(c) {
            stem += 1;
            c = k;
            if stem > 400 {
                break;
            }
        }
        let jit = 0.7 + 0.6 * unit(seed ^ 93, mx as i64, my as i64);
        let (len, thr) = match kind {
            Drown::Fjord => ((5.0 + 13.0 * s) * jit, p.fjord_area),
            Drown::Ria => ((2.5 + 6.0 * s) * jit, p.ria_area),
            Drown::Estuary => (p.drown / 10.0 * (area[mouth] / p.drown_area).sqrt().min(2.0), p.drown_area),
        };
        let cap = match kind {
            Drown::Estuary => 0.5,
            _ => 0.6,
        } * stem as f64;
        let len = len.min(cap).max(1.0);
        let wide = kind == Drown::Fjord && area[mouth] >= 1.6 * thr;
        if kind == Drown::Fjord {
            // 峡湾：沿主谷刻出弯折、分汊、口宽头窄的深水槽（见 carve_fjord）
            let mut chain = vec![mouth];
            let mut c = mouth;
            while let Some(k) = main_kid(c) {
                chain.push(k);
                c = k;
                if chain.len() > 60 {
                    break;
                }
            }
            let major = area[mouth] >= p.fjord_area;
            let flen = ((6.0 + 9.0 * s.min(1.0)) * jit * if major { 1.0 } else { 0.6 })
                .min((stem as f64 * 0.9).max(4.0))
                .clamp(4.0, 15.0);
            let wd = if area[mouth] >= 4.0 * p.fjord_area {
                3
            } else if area[mouth] >= 1.2 * p.fjord_area {
                2
            } else {
                1
            };
            let cut = carve_fjord(seed ^ mouth as u64, mouth, &chain, flen, wd, s, pre_land, &fj_taken);
            for &(c, dist, _) in &cut.cells {
                fj_taken.v[c] = true;
                if dist >= 0.9 {
                    deep_cells.push(c);
                } else {
                    shallow_cells.push(c);
                }
            }
            walls.extend(cut.walls);
            sill.extend(cut.sill);
            skerries.extend(cut.skerries);
            continue;
        }
        // 先沿汇流网收集要淹没的各支（主干最长，支流按汇流比例分叉、长度打折），
        // 每支是一串格：（格序列, 起点离河口的距离, 是否主干）
        let mut branches: Vec<(Vec<usize>, f64, bool)> = Vec::new();
        let mut starts: Vec<(usize, f64, f64, bool)> = vec![(mouth, 0.0, len, true)];
        while let Some((c0, d0, budget, is_main)) = starts.pop() {
            // 支流从汇合处起算，保证与干流相连
            let mut path = if is_main { vec![c0] } else { vec![recv[c0], c0] };
            let (mut c, mut dist) = (c0, d0);
            loop {
                let mk = main_kid(c);
                if kind != Drown::Estuary {
                    for &k in &kids[c] {
                        if Some(k) == mk || area[k] < (thr * 0.35).max(0.3 * area[c]) {
                            continue;
                        }
                        let nb = dist + (budget - dist) * 0.55;
                        if dist + 2.0 <= nb && branches.len() + starts.len() < 10 {
                            starts.push((k, dist + 1.0, nb, false));
                        }
                    }
                }
                let Some(k) = mk else { break };
                let (cx, cy, kx, ky) = (c % w, c / w, k % w, k / w);
                let step = if kx != cx && ky != cy { std::f64::consts::SQRT_2 } else { 1.0 };
                // 不淹到离图边 4 格以内（图外是陆地，峡湾不会从图边“漏”出去）
                let near_edge = kx < 4 || ky < 4 || kx + 4 >= w || ky + 4 >= h;
                if dist + step > budget || near_edge {
                    break;
                }
                dist += step;
                c = k;
                path.push(k);
            }
            branches.push((path, d0, is_main));
        }
        // 再把每支的折线做滑动平均（河口 / 汇合点不动），沿平滑后的线栅格化：峡湾因此是顺直的长水道，
        // 不会跟着 D8 河道拐出钩子
        for (path, d0, is_main) in &branches {
            let pts: Vec<(f64, f64)> = path.iter().map(|&c| ((c % w) as f64, (c / w) as f64)).collect();
            let n = pts.len();
            let sm: Vec<(f64, f64)> = (0..n)
                .map(|i| {
                    if i == 0 {
                        return pts[0];
                    }
                    let (a, b) = (i.saturating_sub(2), (i + 2).min(n - 1));
                    let k = (b - a + 1) as f64;
                    let sx: f64 = pts[a..=b].iter().map(|p| p.0).sum();
                    let sy: f64 = pts[a..=b].iter().map(|p| p.1).sum();
                    (sx / k, sy / k)
                })
                .collect();
            let mut last: Option<(usize, usize)> = None;
            let mut along = *d0;
            let mut prev_pt = sm[0];
            let mark = |cell: usize, dist: f64, deep_cells: &mut Vec<usize>, shallow_cells: &mut Vec<usize>| {
                if !pre_land.v[cell] {
                    return;
                }
                if kind == Drown::Fjord && dist >= 0.9 {
                    deep_cells.push(cell);
                } else {
                    shallow_cells.push(cell);
                }
            };
            for i in 0..n {
                let seg_end = sm[i];
                let seg_len = ((seg_end.0 - prev_pt.0).powi(2) + (seg_end.1 - prev_pt.1).powi(2)).sqrt();
                let steps = (seg_len / 0.25).ceil().max(1.0) as usize;
                for k in 0..=steps {
                    let t = k as f64 / steps as f64;
                    let (px, py) = (prev_pt.0 + t * (seg_end.0 - prev_pt.0), prev_pt.1 + t * (seg_end.1 - prev_pt.1));
                    let dist = along + t * seg_len;
                    let (cx, cy) = (
                        px.round().clamp(0.0, (w - 1) as f64) as usize,
                        py.round().clamp(0.0, (h - 1) as f64) as usize,
                    );
                    if last == Some((cx, cy)) {
                        continue;
                    }
                    let cell = cy * w + cx;
                    // 斜向一步时补一格正交的格，保证水道四连通（与内核的“不斜穿陆角”一致）
                    if let Some((lx, ly)) = last
                        && lx != cx
                        && ly != cy
                    {
                        let a = ly * w + cx;
                        let b = cy * w + lx;
                        let fill = if e.v[a] <= e.v[b] { a } else { b };
                        mark(fill, dist, &mut deep_cells, &mut shallow_cells);
                    }
                    mark(cell, dist, &mut deep_cells, &mut shallow_cells);
                    if kind == Drown::Fjord {
                        let hgt = 300.0 + 420.0 * s.min(1.0) * (dist / len).clamp(0.0, 1.0);
                        walls.push((cell, hgt));
                        // 主峡湾靠口门的一半加宽到两格（沿横向偏一格）
                        if *is_main && wide && dist >= 0.9 && dist <= 0.55 * len && i + 1 < n {
                            let (tx, ty) = (sm[i + 1].0 - px, sm[i + 1].1 - py);
                            let tl = (tx * tx + ty * ty).sqrt().max(1e-9);
                            let side = if unit(seed ^ 95, mx as i64, my as i64) < 0.5 { 1.0 } else { -1.0 };
                            let (ox, oy) = (px - side * ty / tl, py + side * tx / tl);
                            let (sx, sy) = (ox.round(), oy.round());
                            if sx >= 0.0
                                && sy >= 0.0
                                && (sx as usize) < w
                                && (sy as usize) < h
                                && pre_land.v[sy as usize * w + sx as usize]
                            {
                                deep_cells.push(sy as usize * w + sx as usize);
                            }
                        }
                    }
                    last = Some((cx, cy));
                }
                along += seg_len;
                prev_pt = seg_end;
            }
        }
    }
    // 峡湾两壁抬高成陡崖（谷头最高）
    for &(c, hgt) in &walls {
        let (cx, cy) = ((c % w) as i32, (c / w) as i32);
        for dy in -2i32..=2 {
            for dx in -2i32..=2 {
                let (nx, ny) = (cx + dx, cy + dy);
                if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                    continue;
                }
                let j = ny as usize * w + nx as usize;
                // 只抬山坡，不抬谷底（否则会在峡湾头上游筑起一道坝）
                if pre_land.v[j] && area[j] < 4.0 {
                    let k = if dx.abs().max(dy.abs()) == 1 { 1.0 } else { 0.8 };
                    e.v[j] = e.v[j].max(hgt * k);
                }
            }
        }
    }
    for &c in &shallow_cells {
        flooded.v[c] = true;
        e.v[c] = -5.0;
    }
    for &c in &deep_cells {
        flooded.v[c] = true;
        deep.v[c] = true;
        e.v[c] = -80.0;
    }
    // 口门的浅槛不算深水
    for &(mouth, kind, _) in &accepted {
        if kind == Drown::Fjord {
            deep.v[mouth] = false;
            e.v[mouth] = -5.0;
        }
    }
    Flooded { flooded, deep, sill, skerries }
}

/// 一条峡湾刻出的格：（格, 离口门的距离, 是否主槽）、口门外的浅槛、口外的岩礁、两壁要抬高的（格, 高度）。
#[derive(Default)]
struct FjordCut {
    cells: Vec<(usize, f64, bool)>,
    sill: Vec<usize>,
    skerries: Vec<usize>,
    walls: Vec<(usize, f64)>,
}

/// 把方向 (x, y) 转过一个角度（用正切值 t 表示：t = tan θ，不用三角函数，保证确定性）并归一化。
fn turn(v: (f64, f64), t: f64) -> (f64, f64) {
    norm([v.0 - v.1 * t, v.1 + v.0 * t])
}

/// 峡湾：从口门沿冰川谷向内陆“刻”一道深水槽。走向跟着汇流网的主谷（`chain`，从口门往上游），
/// 再按噪声左右摆动，所以会弯折；口门一段宽 2–3 格，往里收窄到湾头 1 格；中段按哈希分出 1–2 条侧汊；
/// 口门留一格浅槛（冰碛），口外散布几块岩礁。遇到别的海面或图边就停，不会把半岛切断。
#[allow(clippy::too_many_arguments)]
fn carve_fjord(
    seed: u64,
    mouth: usize,
    chain: &[usize],
    len: f64,
    wide: u8,
    s: f64,
    pre_land: &Grid<bool>,
    taken: &Grid<bool>,
) -> FjordCut {
    let (w, h) = (pre_land.w, pre_land.h);
    let (mx, my) = ((mouth % w) as f64, (mouth / w) as f64);
    let nz = Noise::new(seed, 71);
    // 初始方向：主谷前几格的走向；没有主谷时朝离海最远的邻格
    let far = chain.get(chain.len().min(5).saturating_sub(1)).copied().unwrap_or(mouth);
    let mut dir = norm([(far % w) as f64 - mx, (far / w) as f64 - my]);
    if far == mouth {
        dir = (0.0, -1.0);
    }
    // 每条峡湾的走向再随机偏转 ±25°：同一段海岸的峡湾不再彼此平行
    dir = turn(dir, (unit(seed ^ 96, mx as i64, my as i64) - 0.5) * 0.95);
    let init = dir;
    let mut cut = FjordCut::default();
    let mut mine = vec![mouth];
    cut.cells.push((mouth, 0.0, true));
    let inside = |x: f64, y: f64| x >= 4.0 && y >= 4.0 && x < (w - 4) as f64 && y < (h - 4) as f64;
    // 沿一条方向走，返回走过的格（含横向加宽）
    let walk = |start: (f64, f64),
                mut hd: (f64, f64),
                steps: usize,
                d0: f64,
                width_at: &dyn Fn(f64) -> u8,
                follow: bool,
                k: f64,
                mine: &mut Vec<usize>,
                cut: &mut FjordCut|
     -> Vec<((f64, f64), (f64, f64))> {
        let mut p = start;
        let mut last = ((p.0.round()) as usize, (p.1.round()) as usize);
        let mut trail = Vec::new();
        let side = if unit(seed ^ 97, mx as i64 + k as i64, my as i64) < 0.5 { 1.0 } else { -1.0 };
        for st in 1..=steps {
            // 走向：跟主谷（前方第 st+2 个谷格）+ 噪声摆动，并且不掉头朝海
            if follow && let Some(&c) = chain.get(st + 2) {
                let to = norm([(c % w) as f64 - p.0, (c / w) as f64 - p.1]);
                hd = norm([hd.0 * 0.85 + to.0 * 0.15, hd.1 * 0.85 + to.1 * 0.15]);
            }
            let wob = 0.8 * nz.gradient(p.0 * 0.26 + k * 7.0, p.1 * 0.26 - k * 3.0);
            hd = turn(hd, wob);
            if hd.0 * init.0 + hd.1 * init.1 < 0.15 {
                hd = norm([hd.0 + init.0 * 0.8, hd.1 + init.1 * 0.8]);
            }
            let np = (p.0 + hd.0, p.1 + hd.1);
            if !inside(np.0, np.1) {
                break;
            }
            let (cx, cy) = (np.0.round() as usize, np.1.round() as usize);
            if (cx, cy) == last {
                p = np;
                continue;
            }
            let c = cy * w + cx;
            // 碰到别的海面（不是本峡湾刻出的）或别的峡湾：停下，免得把半岛切断
            let mut blocked = !pre_land.v[c] && !mine.contains(&c);
            for &(dx, dy) in &N8 {
                let (qx, qy) = (cx as i32 + dx, cy as i32 + dy);
                if qx < 0 || qy < 0 || qx >= w as i32 || qy >= h as i32 {
                    blocked = true;
                    continue;
                }
                let q = qy as usize * w + qx as usize;
                if (!pre_land.v[q] || taken.v[q]) && !mine.contains(&q) && d0 + st as f64 > 2.5 {
                    blocked = true;
                }
            }
            if blocked {
                break;
            }
            let dist = d0 + st as f64;
            let t = st as f64 / steps.max(1) as f64;
            // 斜向一步时补一格正交的格，水道四连通
            if last.0 != cx && last.1 != cy {
                let a = last.1 * w + cx;
                if pre_land.v[a] && !mine.contains(&a) {
                    mine.push(a);
                    cut.cells.push((a, dist - 0.5, follow));
                }
            }
            mine.push(c);
            cut.cells.push((c, dist, follow));
            // 横向加宽：口门一段宽、湾头收窄到 1 格
            let wd = width_at(t);
            let (px, py) = (-hd.1, hd.0);
            for off in 1..wd {
                let sgn = if off % 2 == 1 { side } else { -side };
                let o = off.div_ceil(2) as f64 * sgn;
                let (ox, oy) = ((np.0 + px * o).round(), (np.1 + py * o).round());
                if ox < 0.0 || oy < 0.0 || ox as usize >= w || oy as usize >= h {
                    continue;
                }
                let q = oy as usize * w + ox as usize;
                // 加宽的格也不能挨着别的海面（否则两片水会连起来）
                let touches = N8.iter().any(|&(dx, dy)| {
                    let (qx, qy) = (ox as i32 + dx, oy as i32 + dy);
                    qx < 0
                        || qy < 0
                        || qx >= w as i32
                        || qy >= h as i32
                        || ((!pre_land.v[qy as usize * w + qx as usize] || taken.v[qy as usize * w + qx as usize])
                            && !mine.contains(&(qy as usize * w + qx as usize)))
                });
                if pre_land.v[q] && !mine.contains(&q) && !touches {
                    mine.push(q);
                    cut.cells.push((q, dist, follow));
                }
            }
            let hgt = 300.0 + 420.0 * s.min(1.0) * t.clamp(0.0, 1.0);
            cut.walls.push((c, hgt));
            trail.push((np, hd));
            last = (cx, cy);
            p = np;
        }
        trail
    };
    let steps = len.round().max(3.0) as usize;
    let main_w = move |t: f64| -> u8 {
        if t < 0.4 {
            wide
        } else if t < 0.75 {
            wide.min(2)
        } else {
            1
        }
    };
    let trail = walk((mx, my), dir, steps, 0.0, &main_w, true, 0.0, &mut mine, &mut cut);
    // 侧汊：1–2 条，从主槽中段按 ±55–70° 分出，宽 1 格
    let nb = if trail.len() >= 6 { 1 + (unit(seed ^ 98, mx as i64, my as i64) < 0.5) as usize } else { 0 };
    for b in 0..nb {
        let f = 0.3 + 0.35 * unit(seed ^ (99 + b as u64), mx as i64, my as i64);
        let at = ((trail.len() as f64 * f) as usize).min(trail.len().saturating_sub(1));
        let (bp, bh) = trail[at];
        let sgn = if (unit(seed ^ 101, mx as i64, my as i64) < 0.5) ^ (b == 1) { 1.0 } else { -1.0 };
        let t = sgn * (0.9 + 0.7 * unit(seed ^ (102 + b as u64), mx as i64, my as i64));
        dir = turn(bh, t);
        let rem = (trail.len() - at) as f64;
        let bl = (rem * (0.45 + 0.3 * unit(seed ^ (104 + b as u64), mx as i64, my as i64))).max(3.0) as usize;
        let one = |_t: f64| -> u8 { 1 };
        walk(bp, dir, bl, at as f64 + 1.0, &one, false, 5.0 + b as f64, &mut mine, &mut cut);
    }
    // 口门外的浅槛与岩礁
    let (ox, oy) = ((mx - init.0).round(), (my - init.1).round());
    if ox >= 0.0 && oy >= 0.0 && (ox as usize) < w && (oy as usize) < h {
        let q = oy as usize * w + ox as usize;
        if !pre_land.v[q] {
            cut.sill.push(q);
        }
    }
    let nsk = if wide >= 2 {
        1 + (2.0 * unit(seed ^ 105, mx as i64, my as i64)) as usize
    } else {
        (unit(seed ^ 105, mx as i64, my as i64) < 0.35) as usize
    };
    for j in 0..nsk {
        let along = 2.0 + 2.5 * unit(seed ^ 106, mx as i64 + j as i64, my as i64);
        let lat = (1.6 + 2.0 * unit(seed ^ 107, mx as i64 + j as i64, my as i64)) * if j % 2 == 0 { 1.0 } else { -1.0 };
        let (sx, sy) = ((mx - init.0 * along - init.1 * lat).round(), (my - init.1 * along + init.0 * lat).round());
        if sx < 1.0 || sy < 1.0 || sx as usize >= w - 1 || sy as usize >= h - 1 {
            continue;
        }
        let q = sy as usize * w + sx as usize;
        // 只放在明确的海里（四周 8 格都是海），不堵口门
        let open = N8.iter().all(|&(dx, dy)| !pre_land.v[(sy as i32 + dy) as usize * w + (sx as i32 + dx) as usize]);
        if !pre_land.v[q] && open {
            cut.skerries.push(q);
        }
    }
    cut
}

/// 三角洲扇面：顶点、朝海方向（单位向量）、伸出长度、张角与汊道方向。
pub struct Fan {
    pub apex: (f64, f64),
    pub dir: (f64, f64),
    /// 扇根：扇顶到扇面“基线”（大致是原来的海岸）的距离（格）
    pub inset: f64,
    /// 基线以外伸进海里的长度（格）
    pub length: f64,
    pub spread: f64,
    /// 汊道方向（单位向量）：主河道之外的分支，决定前缘朵叶的位置
    pub branches: Vec<(f64, f64)>,
}

/// 三角洲汊道的旋转角 cos / sin：±28°、±50°（与 hydro::branches 一致）。
pub const DELTA_ROT: [(f64, f64); 4] = [(0.8829, 0.4695), (0.8829, -0.4695), (0.6428, 0.7660), (0.6428, -0.7660)];

/// 在河口推出扇形三角洲：宽度随离扇顶的距离线性增大，前缘是弧形，每条汊道口外凸出一个朵叶；
/// 主河道与汊道在扇面上刻出略低的河槽，让主河一直流到前缘。然后重新清理与计算大陆架。
pub fn add_deltas(t: &mut Terrain, l: &Layout, z: &Zones, fans: &[Fan]) {
    let (w, h) = (t.land.w, t.land.h);
    let dn = Noise::new(l.seed, 21);
    for fan in fans {
        let (ux, uy) = fan.dir;
        let len = fan.length.max(1.0);
        let f0 = fan.inset.max(0.0);
        let spread = fan.spread.max(0.2);
        // 扇面：扇根是从扇顶张开的三角形，基线以外是底边最宽、前缘成弧的半椭圆（基线半宽 wd，伸出 len）；
        // 每条河槽口外鼓出一个朵叶，边界按噪声起伏（没有从扇顶射出的直边，也不会头宽颈窄）
        let wd = 0.55 * spread * len;
        let tip = f0 + len * 0.95;
        let mut lobes: Vec<(f64, f64)> = vec![(fan.apex.0 + ux * tip, fan.apex.1 + uy * tip)];
        for &(bx, by) in &fan.branches {
            lobes.push((fan.apex.0 + bx * tip * 0.95, fan.apex.1 + by * tip * 0.95));
        }
        let r = (f0 + len + wd).ceil() as i64 + 4;
        let (ax, ay) = (fan.apex.0.round() as i64, fan.apex.1.round() as i64);
        for y in (ay - r).max(0)..=(ay + r).min(h as i64 - 1) {
            for x in (ax - r).max(0)..=(ax + r).min(w as i64 - 1) {
                let (x, y) = (x as usize, y as usize);
                let (dx, dy) = (x as f64 - fan.apex.0, y as f64 - fan.apex.1);
                let f = dx * ux + dy * uy;
                let s = -dx * uy + dy * ux;
                if f < -1.0 || t.channel.get(x, y) {
                    continue;
                }
                let nz = 1.2 * dn.fbm(x as f64, y as f64, 5.0, 3, 0.6)
                    + 1.4 * dn.fbm(x as f64 - 30.0, y as f64, 9.0, 2, 0.5);
                let lobe = lobes
                    .iter()
                    .map(|&(lx, ly)| 2.4 * bump(((x as f64 - lx).powi(2) + (y as f64 - ly).powi(2)).sqrt() / 4.2))
                    .fold(0.0, f64::max);
                let inside = if f <= f0 {
                    s.abs() <= (wd + nz) * ((f + 1.0) / (f0 + 1.0)).clamp(0.0, 1.0)
                } else {
                    let a = (f - f0) / (len + lobe + 0.8 * nz).max(0.5);
                    let b = s / (wd + nz + 0.5 * lobe).max(0.5);
                    a * a + b * b <= 1.0
                };
                if inside {
                    let i = y * w + x;
                    let target = 2.0 + 5.0 * (1.0 - (f / (f0 + len)).clamp(0.0, 1.0));
                    if !t.land.v[i] || t.elev.v[i] < target {
                        t.elev.v[i] = target;
                    }
                    t.land.v[i] = true;
                    t.delta.v[i] = true;
                    t.keep_sea.v[i] = false;
                }
            }
        }
        // 河槽：主河道从扇顶直通前缘，汊道从扇顶分出（走向与 hydro::branches 追溯的汊道一致）
        let bn = super::hydro::branch_noise(l.seed);
        let mut walks: Vec<(Vec<(f64, f64)>, f64)> =
            vec![(super::hydro::branch_walk(&bn, fan.apex, fan.dir, 17.0, ((f0 + len) * 1.8) as usize + 2), 1.0)];
        for (k, &b) in fan.branches.iter().enumerate() {
            walks.push((super::hydro::branch_walk(&bn, fan.apex, b, k as f64, ((f0 + len) * 1.8) as usize + 2), 0.4));
        }
        for (pts, depth) in walks {
            let mut prev: Option<(usize, usize)> = None;
            for (k, &(px, py)) in std::iter::once(&fan.apex).chain(pts.iter()).enumerate() {
                let (x, y) = (px.round(), py.round());
                if x < 0.0 || y < 0.0 || x as usize >= w || y as usize >= h {
                    break;
                }
                let (cx, cy) = (x as usize, y as usize);
                let i = cy * w + cx;
                if !t.land.v[i] {
                    break;
                }
                let tgt = (1.2 + 4.0 * (1.0 - (k as f64 / (f0 + len)).clamp(0.0, 1.0))) - depth;
                // 斜向一步时补刻一格，河槽四连通，D8 流向不会从槽里斜着漏出去
                if let Some((lx, ly)) = prev
                    && lx != cx
                    && ly != cy
                {
                    let j = ly * w + cx;
                    if t.land.v[j] {
                        t.elev.v[j] = t.elev.v[j].min((tgt + 0.05).max(0.6));
                        t.delta_channel.v[j] = true;
                    }
                }
                t.elev.v[i] = t.elev.v[i].min(tgt.max(0.6));
                t.delta_channel.v[i] = true;
                prev = Some((cx, cy));
            }
        }
    }
    finish(t, l, z);
}

/// 清理并计算距离与大陆架。
pub fn finish(t: &mut Terrain, l: &Layout, z: &Zones) {
    let (w, h) = (t.land.w, t.land.h);
    let p = &l.params;
    cleanup(t, z);
    break_square_islets(t);
    t.dist_land = distance_to(&t.land, true);
    t.dist_sea = distance_to(&t.land, false);
    let sn = Noise::new(l.seed, 31);
    let wn1 = Noise::new(l.seed, 32);
    let wn2 = Noise::new(l.seed, 33);
    let vn = Noise::new(l.seed, 34);
    let mut shallow = Grid::new(w, h, false);
    // 大陆架：被动大陆边缘（低地、三角洲、陆表海）宽，陡岸（山地直逼海边、火山岛弧外侧）窄；
    // 海湾与岛间（周围陆地多）也浅。陆架外缘不与海岸平行：宽度沿岸按低频噪声伸缩（shelf_vary），
    // 量离岸距离前先把采样点扭一扭（shelf_warp），外缘因此有舌状的浅滩与深水沟，不会是一圈等宽的描边。
    let lf = Grid::from_fn(w, h, |x, y| if t.land.get(x, y) { 1.0 } else { 0.0 });
    let near = super::grid::blur(&lf, 3);
    let far = super::grid::blur(&lf, 7);
    let le = Grid::from_fn(w, h, |x, y| if t.land.get(x, y) { t.elev.get(x, y).max(0.0) } else { 0.0 });
    let le_b = super::grid::blur(&le, 4);
    let lf_b = super::grid::blur(&lf, 4);
    let dd = if t.delta.v.iter().any(|v| *v) { distance_to(&t.delta, true) } else { Grid::new(w, h, 1e9) };
    let mut width_g = Grid::new(w, h, 0.0);
    for y in 0..h {
        for x in 0..w {
            if t.land.get(x, y) {
                continue;
            }
            if t.force_shallow.get(x, y) {
                shallow.set(x, y, true);
                continue;
            }
            if t.fjord.get(x, y) {
                continue;
            }
            let (fx, fy) = (x as f64, y as f64);
            let dl = t.dist_land.get(x, y);
            // 扭曲后的离岸距离
            let dlw = sample(
                &t.dist_land,
                fx + p.shelf_warp * wn1.fbm(fx, fy, 11.0, 3, 0.6),
                fy + p.shelf_warp * wn2.fbm(fx, fy, 11.0, 3, 0.6),
            );
            let mean_e = if lf_b.get(x, y) > 0.01 { le_b.get(x, y) / lf_b.get(x, y) } else { 0.0 };
            // 岸上越低平，大陆架越宽；山地直逼海边处（岸上平均高程 ≥ 600 米）几乎没有大陆架
            let low = 1.0 - (mean_e / 600.0).clamp(0.0, 1.0);
            let shelf_z = z.get("shelf", x, y);
            let steep = z.get("steep", x, y) + 0.6 * z.get("fjord", x, y);
            let nz = sn.fbm(fx, fy, 14.0, 4, 0.6);
            let base = p.shelf
                + 1.8 * low * low * low
                + 7.0 * shelf_z
                + 2.0 * z.get("sandy", x, y)
                + 2.5 * z.get("lowland", x, y)
                + 2.0 * z.get("reef", x, y)
                + 6.0 * smoothstep(10.0, 3.0, dd.get(x, y))
                - 3.5 * steep;
            // 沿岸伸缩（波长 30 格左右）：同一段海岸上陆架时宽时窄
            let vary = (1.0
                + p.shelf_vary
                    * (0.65 * vn.fbm(fx, fy, 30.0, 3, 0.5) + 0.35 * vn.fbm(fx + 57.0, fy - 23.0, 11.0, 2, 0.5))
                    * 1.6)
                .max(0.25);
            let width = base.max(0.0) * vary + 1.3 * nz;
            width_g.set(x, y, width);
            // 半封闭的小海湾与岛间窄水道也浅
            let enclosed =
                1.3 * near.get(x, y) + 1.1 * far.get(x, y) + 0.15 * sn.fbm(fx + 90.0, fy, 9.0, 3, 0.6) - 0.35 * steep;
            // 紧贴陆地的一格通常是浅海；陡岸（陡岸分区、峡湾区，或岸上是高山且噪声低处）深海直接贴岸
            let cliff = steep >= 0.6 || (low < 0.3 && nz < -0.1);
            if (dl <= 1.0 && !cliff) || dlw <= width || enclosed > 0.9 {
                shallow.set(x, y, true);
            }
        }
    }
    island_shelves(t, l, &mut shallow, &width_g, &near);
    for (bi, b) in l.bank.iter().enumerate() {
        // 远海浅滩：扭曲后的椭圆（不是一块方正的贴片）
        let bw = Warp::new(l.seed, 600 + bi as u64, 2.2, 7.0);
        for y in 0..h {
            for x in 0..w {
                let (wx, wy) = bw.apply(x as f64, y as f64);
                let dx = (wx - b.center[0]) / b.radius[0].max(0.5);
                let dy = (wy - b.center[1]) / b.radius[1].max(0.5);
                let n = sn.fbm(x as f64, y as f64, 4.0, 3, 0.6) * 0.7;
                if dx * dx + dy * dy <= 1.0 + n && !t.land.get(x, y) {
                    shallow.set(x, y, true);
                }
            }
        }
    }
    t.shallow = shallow;
}

/// 正好是 2×2 方块的小岛：去掉最低的一格（成 L 形的礁岩），全图不再散落一模一样的方块岛。
fn break_square_islets(t: &mut Terrain) {
    let (comp, sizes) = components4(&t.land, true);
    let (w, h) = (t.land.w, t.land.h);
    for y in 0..h.saturating_sub(1) {
        for x in 0..w.saturating_sub(1) {
            let c = comp.get(x, y);
            if c == u32::MAX || sizes[c as usize] != 4 {
                continue;
            }
            let quad = [(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)];
            if !quad.iter().all(|&(qx, qy)| comp.get(qx, qy) == c) {
                continue;
            }
            let low = quad
                .iter()
                .copied()
                .min_by(|a, b| {
                    t.elev
                        .get(a.0, a.1)
                        .partial_cmp(&t.elev.get(b.0, b.1))
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then(a.cmp(b))
                })
                .unwrap_or((x, y));
            t.land.set(low.0, low.1, false);
            t.elev.set(low.0, low.1, -6.0);
            t.wetland.set(low.0, low.1, false);
            t.delta.set(low.0, low.1, false);
        }
    }
}

/// 小岛（≤ 45 格）的浅海：沿岛的长轴从一端拖出 2–5 格的沙嘴或礁滩；垂直于长轴的一侧（按哈希取边），
/// 陆架不宽的地方深海直接贴岸。小岛因此不再是“一圈等宽浅海包着的圆点”。
fn island_shelves(t: &Terrain, l: &Layout, shallow: &mut Grid<bool>, width_g: &Grid<f64>, near: &Grid<f64>) {
    let (w, h) = (t.land.w, t.land.h);
    let (comp, sizes) = components4(&t.land, true);
    let mut members: Vec<Vec<(usize, usize)>> = vec![Vec::new(); sizes.len()];
    for y in 0..h {
        for x in 0..w {
            let c = comp.get(x, y);
            if c != u32::MAX && sizes[c as usize] <= 45 {
                members[c as usize].push((x, y));
            }
        }
    }
    for (ci, cells) in members.iter().enumerate() {
        if cells.is_empty() {
            continue;
        }
        let n = cells.len() as f64;
        let (mx, my) = cells.iter().fold((0.0, 0.0), |a, &(x, y)| (a.0 + x as f64, a.1 + y as f64));
        let (mx, my) = (mx / n, my / n);
        // 主轴：协方差矩阵的主特征向量（单格岛按哈希取一个方向）
        let (mut sxx, mut syy, mut sxy) = (0.0, 0.0, 0.0);
        for &(x, y) in cells {
            let (dx, dy) = (x as f64 - mx, y as f64 - my);
            sxx += dx * dx;
            syy += dy * dy;
            sxy += dx * dy;
        }
        let (ax, ay) = if sxx + syy < 1e-6 {
            norm([unit(l.seed ^ 0x51, ci as i64, 1) - 0.5, unit(l.seed ^ 0x52, ci as i64, 1) - 0.5])
        } else {
            let tr = sxx + syy;
            let det = sxx * syy - sxy * sxy;
            let lam = tr / 2.0 + (tr * tr / 4.0 - det).max(0.0).sqrt();
            if sxy.abs() > 1e-9 {
                norm([lam - syy, sxy])
            } else if sxx >= syy {
                (1.0, 0.0)
            } else {
                (0.0, 1.0)
            }
        };
        let hsh = unit(l.seed ^ 0x53, mx.round() as i64, my.round() as i64);
        let end = if hsh < 0.5 { 1.0 } else { -1.0 };
        // 长轴一端最远的岛格
        let proj = |c: &(usize, usize)| ((c.0 as f64 - mx) * ax + (c.1 as f64 - my) * ay) * end;
        let tip = cells
            .iter()
            .copied()
            .max_by(|a, b| proj(a).partial_cmp(&proj(b)).unwrap_or(std::cmp::Ordering::Equal).then(b.cmp(a)))
            .unwrap_or((mx.round() as usize, my.round() as usize));
        let len = 2.0 + 3.5 * unit(l.seed ^ 0x54, tip.0 as i64, tip.1 as i64);
        let bend = (unit(l.seed ^ 0x55, tip.0 as i64, tip.1 as i64) - 0.5) * 0.5;
        let mut k = 0.5;
        while k <= len {
            let (px, py) = (
                tip.0 as f64 + end * ax * k - ay * bend * k * k * 0.3,
                tip.1 as f64 + end * ay * k + ax * bend * k * k * 0.3,
            );
            let (qx, qy) = (px.round(), py.round());
            if qx >= 0.0 && qy >= 0.0 && (qx as usize) < w && (qy as usize) < h {
                let (ux, uy) = (qx as usize, qy as usize);
                if !t.land.get(ux, uy) && !t.fjord.get(ux, uy) {
                    shallow.set(ux, uy, true);
                }
            }
            k += 0.5;
        }
        // 背向的一侧：深海贴岸
        let side = if unit(l.seed ^ 0x56, tip.0 as i64, tip.1 as i64) < 0.5 { 1.0 } else { -1.0 };
        let (nx, ny) = (-ay * side, ax * side);
        for &(x, y) in cells {
            for &(dx, dy) in &N8 {
                let (qx, qy) = (x as i32 + dx, y as i32 + dy);
                if !t.land.inside(qx, qy) {
                    continue;
                }
                let (ux, uy) = (qx as usize, qy as usize);
                if t.land.get(ux, uy) || t.force_shallow.get(ux, uy) || !shallow.get(ux, uy) {
                    continue;
                }
                let pr = (ux as f64 - mx) * nx + (uy as f64 - my) * ny;
                if pr > 0.4 && width_g.get(ux, uy) < 2.2 && near.get(ux, uy) < 0.35 {
                    shallow.set(ux, uy, false);
                }
            }
        }
    }
}

/// 岛弧上的一个岛：中心、沿弧线的朝向（单位向量）、长短半轴、长轴一端外侧的 1 格礁岩，以及火山锥（锥顶偏移、高度）。
pub struct ArcIsle {
    pub arc: usize,
    pub k: u32,
    pub c: (f64, f64),
    pub dir: (f64, f64),
    pub ax: f64,
    pub ay: f64,
    pub islets: Vec<(f64, f64)>,
    pub cone: Option<([f64; 2], f64)>,
}

/// 岛弧上的各个岛（确定性）：沿弧线等距取点，岛沿弧线的切向拉长（长短轴比 `aspect`，朝向偏离切向不超过 `twist`），
/// 成串排布；一部分岛在长轴一端外侧点出 1–2 块礁岩（海蚀柱）；火山岛弧上均匀挑出 `volcanoes` 座火山锥。
pub fn arc_isles(l: &Layout, seed: u64) -> Vec<ArcIsle> {
    let mut out = Vec::new();
    for (ai, a) in l.arc.iter().enumerate() {
        let line: Vec<(f64, f64)> = chaikin_open(&a.points.iter().map(|p| (p[0], p[1])).collect::<Vec<_>>(), 2);
        if line.len() < 2 || a.count == 0 {
            continue;
        }
        let mut rng = Rng::new(seed ^ (ai as u64 + 1).wrapping_mul(0x2545_f491_4f6c_dd1d));
        let lens: Vec<f64> =
            line.windows(2).map(|p| ((p[1].0 - p[0].0).powi(2) + (p[1].1 - p[0].1).powi(2)).sqrt()).collect();
        let total: f64 = lens.iter().sum();
        let cones = if a.volcanic { a.volcanoes.unwrap_or(a.count.div_ceil(2)).min(a.count) } else { 0 };
        for k in 0..a.count {
            let target = total * (k as f64 + 0.5 + rng.range(-0.3, 0.3)) / a.count as f64;
            let mut acc = 0.0;
            let mut c = line[0];
            let mut tan = (line[1].0 - line[0].0, line[1].1 - line[0].1);
            for (i, seg) in lens.iter().enumerate() {
                if acc + seg >= target {
                    let t = (target - acc) / seg.max(1e-9);
                    c = (line[i].0 + t * (line[i + 1].0 - line[i].0), line[i].1 + t * (line[i + 1].1 - line[i].1));
                    tan = (line[i + 1].0 - line[i].0, line[i + 1].1 - line[i].1);
                    break;
                }
                acc += seg;
            }
            let c = (c.0 + rng.range(-a.jitter, a.jitter), c.1 + rng.range(-a.jitter, a.jitter));
            // 火山锥所在的岛：在弧上均匀挑出（第 k 个岛跨过了 cones / count 的一个整数刻度）
            let is_cone = cones > 0 && ((k + 1) * cones) / a.count > (k * cones) / a.count;
            let mut r = rng.range(a.size[0], a.size[1]);
            if is_cone {
                r = r.max(1.7);
            }
            // 朝向：弧线切向，偏转不超过 ±twist
            let (tx, ty) = norm([tan.0, tan.1]);
            let tw = rng.range(-a.twist, a.twist);
            let (ux, uy) = norm([tx - ty * tw, ty + tx * tw]);
            let ax = r * rng.range(a.aspect[0], a.aspect[1].max(a.aspect[0]));
            let ay = r * rng.range(0.55, 0.8);
            let mut islets = Vec::new();
            if rng.f() < a.islets {
                // 礁岩在长轴的哪一端、几块
                let side = if rng.f() < 0.5 { 1.0 } else { -1.0 };
                let n = if rng.f() < 0.45 { 2 } else { 1 };
                for j in 0..n {
                    let along = ax + 1.4 + j as f64 * 1.7 + rng.range(0.0, 0.8);
                    let lat = rng.range(-0.9, 0.9);
                    islets.push((c.0 + side * ux * along - uy * lat, c.1 + side * uy * along + ux * lat));
                }
            }
            let cone = if is_cone {
                let s = rng.range(-0.3, 0.3);
                let off = [ux * s * ax, uy * s * ax];
                Some((off, a.cone_height * rng.range(0.85, 1.15)))
            } else {
                None
            };
            out.push(ArcIsle { arc: ai, k, c, dir: (ux, uy), ax, ay, islets, cone });
        }
    }
    out
}

/// 抬升—侵蚀模拟（隐式 stream-power，Braun & Willett 2013）：每步按目标高程抬升，再让河流下切，
/// 迭代到接近稳态，得到树枝状的河谷与山脊。汇流量按降水加权（干旱区下切弱）。海格是基准面，
/// 地图边缘的陆格可以向图外排水（陆地延伸到图外）。返回高程、汇流量与最后一步的下游格。
#[allow(clippy::too_many_arguments)]
fn uplift_erode(
    target: &Grid<f64>,
    init: &Grid<f64>,
    land: &Grid<bool>,
    kmul: &Grid<f64>,
    rain: &Grid<f64>,
    iterations: u32,
    k: f64,
    m: f64,
) -> (Grid<f64>, Vec<f64>, Vec<usize>) {
    let (w, h) = (target.w, target.h);
    let n = w * h;
    let mut e = init.clone();
    let rate = 1.3 / iterations.max(1) as f64;
    let mut area = vec![0.0f64; n];
    let mut recv_out = vec![usize::MAX; n];
    for _ in 0..iterations {
        for i in 0..n {
            if land.v[i] {
                e.v[i] += target.v[i].max(0.0) * rate;
            }
        }
        let (order, recv) = flow_order(&e, true, false);
        area.iter_mut().for_each(|a| *a = 0.0);
        for &i in order.iter().rev() {
            if land.v[i] {
                area[i] += rain.v[i];
            }
            let r = recv[i];
            if r != i && r != usize::MAX {
                let a = area[i];
                area[r] += a;
            }
        }
        for &i in &order {
            let r = recv[i];
            if r == usize::MAX || r == i || !land.v[i] {
                continue;
            }
            let (xi, yi) = (i % w, i / w);
            let (xr, yr) = (r % w, r / w);
            let dist = if xi != xr && yi != yr { std::f64::consts::SQRT_2 } else { 1.0 };
            let f = k * kmul.v[i] * area[i].powf(m) / dist;
            let base = if land.v[r] { e.v[r] } else { 0.0 };
            e.v[i] = ((e.v[i] + f * base) / (1.0 + f)).max(0.2);
        }
        // 地图边缘：陆地延伸到图外，边缘格取内侧邻格的高程（零梯度边界），既不隆起成墙，也不塌成沟
        for y in 0..h {
            for x in 0..w {
                if x != 0 && y != 0 && x != w - 1 && y != h - 1 {
                    continue;
                }
                let i = y * w + x;
                if !land.v[i] {
                    continue;
                }
                let ix = x.clamp(1, w - 2);
                let iy = y.clamp(1, h - 2);
                let j = iy * w + ix;
                if land.v[j] {
                    e.v[i] = (e.v[j] - 0.5).max(0.2);
                }
            }
        }
        recv_out = recv;
    }
    (e, area, recv_out)
}

/// 热力侵蚀：过陡的坡向最低的邻格滑落。
fn thermal(e: &mut Grid<f64>, talus: f64, passes: u32, fixed: &Grid<bool>) {
    let (w, h) = (e.w, e.h);
    for _ in 0..passes {
        for i in 0..w * h {
            if e.v[i] <= 0.0 || fixed.v[i] {
                continue;
            }
            let mut low = i;
            let mut lv = e.v[i];
            for (d, j) in neighbors8(w, h, i) {
                let dist = if d % 2 == 1 { std::f64::consts::SQRT_2 } else { 1.0 };
                let v = e.v[j] + talus * dist;
                if v < lv {
                    lv = v;
                    low = j;
                }
            }
            if low != i {
                let excess = (e.v[i] - lv) * 0.25;
                e.v[i] -= excess;
                if e.v[low] > 0.0 {
                    e.v[low] += excess * 0.5;
                }
            }
        }
    }
}

/// 优先队列填洼（Barnes 2014）：返回按“填后高程”从低到高的处理顺序与每格的下游格。
/// 海格与（可选）地图边缘的陆格是出口；`edge_low` 时边缘的陆格一律当最低的出口（只用于最后的汇流：
/// 图边附近的水直接流出图外，不会贴着图边汇成一条“边缘河”；侵蚀模拟里不这样做，否则紧挨图边的一排格排水坡度为零、不受侵蚀，会隆起成墙）。
pub fn flow_order(e: &Grid<f64>, edges_drain: bool, edge_low: bool) -> (Vec<usize>, Vec<usize>) {
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
            // 最小堆：高程小的先出；高程相同时下标小的先出（确定性）
            o.0.partial_cmp(&self.0).unwrap_or(std::cmp::Ordering::Equal).then_with(|| o.1.cmp(&self.1))
        }
    }
    let (w, h) = (e.w, e.h);
    let n = w * h;
    let mut recv = vec![usize::MAX; n];
    let mut done = vec![false; n];
    let mut fill = e.v.clone();
    let mut heap = BinaryHeap::new();
    let mut order = Vec::with_capacity(n);
    for i in 0..n {
        let (x, y) = (i % w, i / w);
        let edge = x == 0 || y == 0 || x == w - 1 || y == h - 1;
        if e.v[i] <= 0.0 || (edges_drain && edge) {
            done[i] = true;
            recv[i] = i;
            // 地图边缘的陆格（图外还是陆地）一律当最低的出口：边上的水直接流出图外，不会贴着图边汇成一条“边缘河”
            if edge_low && e.v[i] > 0.0 {
                fill[i] = -1.0;
            }
            heap.push(Item(fill[i], i));
        }
    }
    while let Some(Item(v, i)) = heap.pop() {
        order.push(i);
        for (_, j) in neighbors8(w, h, i) {
            if done[j] {
                continue;
            }
            done[j] = true;
            recv[j] = i;
            if fill[j] <= v {
                fill[j] = v + 1e-3;
            }
            heap.push(Item(fill[j], j));
        }
    }
    (order, recv)
}

/// 周围陆格的平均高程与起伏（最高 − 最低）。
fn around_land(land: &Grid<bool>, e: &Grid<f64>, x: usize, y: usize) -> (f64, f64, usize) {
    let (mut s, mut lo, mut hi, mut n) = (0.0, f64::MAX, f64::MIN, 0usize);
    for &(dx, dy) in &N8 {
        let (nx, ny) = (x as i32 + dx, y as i32 + dy);
        if land.at(nx, ny) == Some(true) {
            let v = e.get(nx as usize, ny as usize);
            s += v;
            lo = lo.min(v);
            hi = hi.max(v);
            n += 1;
        }
    }
    if n == 0 { (0.0, 0.0, 0) } else { (s / n as f64, hi - lo, n) }
}

/// 把一个海格填成陆：低平处画成湿地，否则取周围陆格的平均高程（不是湿地）。
fn fill_land(t: &mut Terrain, x: usize, y: usize) {
    let (mean, relief, n) = around_land(&t.land, &t.elev, x, y);
    t.land.set(x, y, true);
    if n > 0 && (mean >= 70.0 || relief >= 90.0) {
        t.elev.set(x, y, mean.max(2.0));
        t.wetland.set(x, y, false);
    } else {
        t.elev.set(x, y, mean.clamp(2.0, 40.0));
        t.wetland.set(x, y, true);
    }
}

/// 清理（形态学）：单格海坑与 1 格宽的水缝填成陆、小于 3 格的陆块与单格的“毛刺”去掉、
/// 斜向缝隙打通、封闭水体填平。水道、被淹没的河谷、环礁、沙岸与堰洲岛的潮汐通道不动。
fn cleanup(t: &mut Terrain, z: &Zones) {
    let (w, h) = (t.land.w, t.land.h);
    let protected_sea = |t: &Terrain, x: usize, y: usize| {
        t.keep_sea.get(x, y) || t.channel.get(x, y) || z.get("sandy", x, y) > 0.5 || z.get("barrier", x, y) > 0.5
    };
    let islet_ok = |t: &Terrain, x: usize, y: usize| {
        t.keep_land.get(x, y)
            || z.get("reef", x, y) > 0.5
            || z.get("skerry", x, y) > 0.5
            || z.get("barrier", x, y) > 0.5
    };
    for pass in 0..3 {
        // 单格海坑（四面是陆）与 1 格宽的死水缝（三面是陆的缝头）→ 陆。只从缝头往外填，
        // 连接两片水域的 1 格水道不动（不会把海切断）；几遍下来短的毛刺状水缝就没了，长的峡湾与河口湾受保护。
        for y in 0..h {
            for x in 0..w {
                if t.land.get(x, y) || t.channel.get(x, y) {
                    continue;
                }
                let l = |dx: i32, dy: i32| t.land.at(x as i32 + dx, y as i32 + dy).unwrap_or(true);
                let lands = N4.iter().filter(|&&(dx, dy)| l(dx, dy)).count();
                let pit = lands == 4;
                let gap = lands == 3;
                if (pit && !t.keep_sea.get(x, y)) || (gap && !protected_sea(t, x, y)) {
                    fill_land(t, x, y);
                }
            }
        }
        if pass == 2 {
            break;
        }
        // 小于 3 格的陆块（礁石、岩礁、环礁、堰洲岛区之外）→ 海
        let (id, sizes) = components4(&t.land, true);
        for y in 0..h {
            for x in 0..w {
                let c = id.get(x, y);
                if c == u32::MAX || sizes[c as usize] >= 3 || t.delta.get(x, y) || islet_ok(t, x, y) {
                    continue;
                }
                t.land.set(x, y, false);
                t.elev.set(x, y, -10.0);
                t.wetland.set(x, y, false);
            }
        }
        // 单格毛刺：只有一个正交陆邻、八邻里海格 ≥ 5 的陆格 → 海
        for y in 0..h {
            for x in 0..w {
                if !t.land.get(x, y) || t.delta.get(x, y) || islet_ok(t, x, y) || z.get("sandy", x, y) > 0.5 {
                    continue;
                }
                let l = |dx: i32, dy: i32| t.land.at(x as i32 + dx, y as i32 + dy).unwrap_or(true);
                let n4 = N4.iter().filter(|&&(dx, dy)| l(dx, dy)).count();
                let n8 = N8.iter().filter(|&&(dx, dy)| l(dx, dy)).count();
                if n4 == 1 && n8 <= 3 {
                    t.land.set(x, y, false);
                    t.elev.set(x, y, -8.0);
                    t.wetland.set(x, y, false);
                }
            }
        }
        // 斜向缝隙：两格海只在对角相连时，把其中一格陆地打通（取较低的一格）
        for y in 0..h - 1 {
            for x in 0..w - 1 {
                let a = t.land.get(x, y);
                let b = t.land.get(x + 1, y);
                let c = t.land.get(x, y + 1);
                let d = t.land.get(x + 1, y + 1);
                let pinch = |s1: bool, s2: bool, l1: bool, l2: bool| !s1 && !s2 && l1 && l2;
                let cut = if pinch(a, d, b, c) {
                    Some(if t.elev.get(x + 1, y) < t.elev.get(x, y + 1) { (x + 1, y) } else { (x, y + 1) })
                } else if pinch(b, c, a, d) {
                    Some(if t.elev.get(x, y) < t.elev.get(x + 1, y + 1) { (x, y) } else { (x + 1, y + 1) })
                } else {
                    None
                };
                if let Some((tx, ty)) = cut
                    && !t.delta.get(tx, ty)
                    && !t.keep_land.get(tx, ty)
                {
                    t.land.set(tx, ty, false);
                    t.elev.set(tx, ty, -8.0);
                    t.wetland.set(tx, ty, false);
                }
            }
        }
    }
    // 封闭水体：从最大的海域出发不可达、又不接地图边缘（图外的大洋）的小水体填成陆地（低平处画成湿地）。
    // 大片的封闭水域说明骨架有问题，不填，留给自检与 validate-data 报出来。
    let (id, sizes) = components4(&t.land.clone(), false);
    let Some(big) = sizes.iter().enumerate().max_by_key(|(_, s)| **s).map(|(i, _)| i as u32) else { return };
    let start = (0..w * h).find(|&i| id.v[i] == big).map(|i| (i % w, i / w));
    let Some(start) = start else { return };
    let reach = sea_reach(&t.land, &[start]);
    let mut on_edge = vec![false; sizes.len()];
    for y in 0..h {
        for x in 0..w {
            let c = id.get(x, y);
            if c != u32::MAX && (x == 0 || y == 0 || x == w - 1 || y == h - 1) {
                on_edge[c as usize] = true;
            }
        }
    }
    for y in 0..h {
        for x in 0..w {
            if t.land.get(x, y) || reach.get(x, y) {
                continue;
            }
            let c = id.get(x, y);
            let open = c != u32::MAX && (on_edge[c as usize] || sizes[c as usize] >= 300);
            if !open {
                fill_land(t, x, y);
            }
        }
    }
}
