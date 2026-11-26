//! 气候与植被：气温按纬度与海拔，降水按盛行风的水汽输送、地形抬升与雨影、离海距离与气候带；
//! 再按（气温, 降水）分出植被代码，按高程分出地势等级。

use super::grid::{Grid, blur};
use super::hydro::River;
use super::layout::Layout;
use super::noise::Noise;
use super::shape::smoothstep;
use super::terrain::{Terrain, Zones};

/// 植被 / 地貌代码（EXPANSION.md §10.3）。
pub const ICE: u8 = b'I';
pub const TUNDRA: u8 = b'T';
pub const BOREAL: u8 = b'B';
pub const FOREST: u8 = b'F';
pub const GRASS: u8 = b'G';
pub const MEDIT: u8 = b'M';
pub const STEPPE: u8 = b'K';
pub const DESERT: u8 = b'D';
pub const SAVANNA: u8 = b'S';
pub const JUNGLE: u8 = b'J';
pub const WETLAND: u8 = b'W';
pub const ALPINE: u8 = b'A';
pub const VOLCANIC: u8 = b'V';
pub const ARCANE: u8 = b'X';
pub const SEA: u8 = b'.';

/// 全部合法的陆格植被代码。
pub const CODES: &[u8] = b"ITBFGMKDSJWAVX";

/// 分段线性插值（控制点按 y 升序）。
pub fn interp(ctrl: &[[f64; 2]], y: f64) -> f64 {
    if ctrl.is_empty() {
        return 0.0;
    }
    if y <= ctrl[0][0] {
        return ctrl[0][1];
    }
    for w in ctrl.windows(2) {
        if y <= w[1][0] {
            let t = (y - w[0][0]) / (w[1][0] - w[0][0]).max(1e-9);
            return w[0][1] + t * (w[1][1] - w[0][1]);
        }
    }
    ctrl[ctrl.len() - 1][1]
}

/// 侵蚀阶段用的粗略降水（地形尚未生成）：只看气候带与分区。
pub fn rough_rain(l: &Layout, z: &Zones) -> Grid<f64> {
    let (w, h) = z.dims();
    Grid::from_fn(w, h, |x, y| {
        let belt = interp(&l.climate.rain_belt, y as f64);
        (belt + 0.5 * z.get("humid", x, y) - 0.5 * z.get("arid", x, y) + 0.3 * z.get("fjord", x, y)).clamp(0.08, 1.6)
    })
}

/// 气候图。
pub struct ClimateMaps {
    /// 年均温（°C，已按海拔修正）
    pub temp: Grid<f64>,
    /// 降水指数（约 0–1.6，1 ≈ 湿润）
    pub precip: Grid<f64>,
    /// 地中海式气候的程度（0–1）：冬季在西风带（纬度带）× 上风（西侧）有海（大陆西岸或内海沿岸）
    pub medit: Grid<f64>,
}

/// 西侧 45° 扇形内到海的距离（格）：逐列从西向东推，每格取左上、左、左下三格的最小值 + 1。
/// 地图西缘的陆格按“陆地延伸到图外”处理（距离取 40）。
pub fn west_fetch(land: &Grid<bool>) -> Grid<f64> {
    let (w, h) = (land.w, land.h);
    let mut f: Grid<f64> = Grid::new(w, h, 0.0);
    for x in 0..w {
        for y in 0..h {
            if !land.get(x, y) {
                continue;
            }
            let v = if x == 0 {
                40.0
            } else {
                let a = f.get(x - 1, y.saturating_sub(1));
                let b = f.get(x - 1, y);
                let c = f.get(x - 1, (y + 1).min(h - 1));
                1.0 + a.min(b).min(c)
            };
            f.set(x, y, v.min(99.0));
        }
    }
    f
}

pub fn compute(l: &Layout, z: &Zones, t: &Terrain) -> ClimateMaps {
    let (w, h) = (t.land.w, t.land.h);
    let c = &l.climate;
    let tn = Noise::new(l.seed, 51);
    let tn2 = Noise::new(l.seed, 52);
    let rn = Noise::new(l.seed, 53);
    let bn = Noise::new(l.seed, 54);
    // 河谷比周围暖：与半径 4 格内陆地平均高程比较
    let le = Grid::from_fn(w, h, |x, y| if t.land.get(x, y) { t.elev.get(x, y).max(0.0) } else { 0.0 });
    let lf = Grid::from_fn(w, h, |x, y| if t.land.get(x, y) { 1.0 } else { 0.0 });
    let le_b = blur(&le, 4);
    let lf_b = blur(&lf, 4);
    let temp = Grid::from_fn(w, h, |x, y| {
        let base = interp(&c.temperature, y as f64);
        let land = t.land.get(x, y);
        let e = if land { t.elev.get(x, y).max(0.0) } else { 0.0 };
        let valley = if land && lf_b.get(x, y) > 0.2 {
            ((le_b.get(x, y) / lf_b.get(x, y) - e) / 150.0).clamp(0.0, c.valley_warmth)
        } else {
            0.0
        };
        base - c.lapse * e / 1000.0 + 3.0 * z.get("warm", x, y) - 4.0 * z.get("cold", x, y)
            + c.temp_noise * tn.fbm(x as f64, y as f64, c.temp_noise_wavelength, 3, 0.5)
            + 0.6 * tn2.fbm(x as f64, y as f64, 14.0, 2, 0.5)
            + valley
            // 大陆度：离海越远越冷一点（年均温，最多 −1.2°C）
            - 0.03 * if land { t.dist_sea.get(x, y).min(40.0) } else { 0.0 }
    });
    // 水汽沿盛行风输送：东向（西风带）与西向（信风带）各扫一遍，按风向权重混合
    let sweep = |east: bool| -> Grid<f64> {
        let mut g = Grid::new(w, h, 0.0);
        for y in 0..h {
            let mut m = 1.0f64;
            let mut prev = 0.0f64;
            for k in 0..w {
                let x = if east { k } else { w - 1 - k };
                if !t.land.get(x, y) {
                    m += (1.0 - m) * 0.2;
                    prev = 0.0;
                    g.set(x, y, m);
                    continue;
                }
                let e = t.elev.get(x, y).max(0.0);
                let rise = e - prev;
                let oro = (rise.max(0.0) / 260.0).min(1.5);
                let mut r = m * (0.03 + 0.45 * oro);
                if rise < -40.0 {
                    // 背风坡下沉增温，降水减少
                    r *= 0.45;
                }
                g.set(x, y, r / 0.03);
                m -= r * 0.28;
                m *= 0.996;
                m = m.max(0.02);
                prev = e;
            }
        }
        g
    };
    let east = sweep(true);
    let west = sweep(false);
    let mut precip = Grid::new(w, h, 0.0);
    for y in 0..h {
        let s = interp(&c.wind, y as f64).clamp(-1.0, 1.0);
        let (a, b) = ((1.0 + s) * 0.5, (1.0 - s) * 0.5);
        let belt = interp(&c.rain_belt, y as f64);
        for x in 0..w {
            let adv = (a * east.get(x, y) + b * west.get(x, y)).min(2.2);
            let coast = 1.0 / (1.0 + t.dist_sea.get(x, y) / 6.0);
            // 峡湾海岸在迎风的多雨海岸上
            let v = belt * (0.8 * adv + 0.4 * coast) + 0.55 * z.get("humid", x, y) - 0.55 * z.get("arid", x, y)
                + 0.2 * z.get("fjord", x, y);
            // 降水的低频扰动：两个尺度（约 55 格与 24 格），植被带的边界因此成舌状与锯齿，不沿纬线或经线
            let rnz = 0.65 * rn.fbm(x as f64, y as f64, 55.0, 3, 0.5)
                + 0.35 * rn.fbm(x as f64 + 113.0, y as f64 - 57.0, 24.0, 2, 0.5);
            let v = v * (1.0 + c.rain_noise * rnz);
            precip.set(x, y, v.max(0.0));
        }
    }
    let precip = blur(&precip, 1);
    // 地中海式气候：纬度带（边界按噪声起伏）× 上风有海
    // 上风距离先做一次模糊（不让西侧海岸的形状沿 45° 扇形投出一条直的边界），阈值再加噪声
    let fetch = blur(&west_fetch(&t.land), 4);
    let [m0, m1, m2, m3] = c.medit;
    let medit = Grid::from_fn(w, h, |x, y| {
        let yy = y as f64 + 5.0 * bn.fbm(x as f64, y as f64, 30.0, 2, 0.5);
        let band = smoothstep(m0, m1, yy) * (1.0 - smoothstep(m2, m3, yy));
        let f0 = c.medit_fetch * (1.0 + 0.35 * bn.fbm(x as f64 + 300.0, y as f64, 20.0, 2, 0.5));
        band * smoothstep(f0 * 2.0, f0 * 0.8, fetch.get(x, y))
    });
    ClimateMaps { temp, precip, medit }
}

/// 地势等级 0–9（海格为 255）。
pub fn relief(l: &Layout, t: &Terrain) -> Grid<u8> {
    let lv = &l.params.relief_levels;
    Grid::from_fn(t.land.w, t.land.h, |x, y| {
        if !t.land.get(x, y) {
            return 255;
        }
        let e = t.elev.get(x, y);
        lv.iter().position(|&th| e < th).unwrap_or(9).min(9) as u8
    })
}

/// 到最近的命名河流的切比雪夫距离（0 = 河道本身，最多记到 3，更远记 9）与那条河的宽度。
pub fn river_near(rivers: &[River], w: usize, h: usize) -> Grid<(u8, u8)> {
    let mut g = Grid::new(w, h, (9u8, 0u8));
    for r in rivers {
        for &(x, y) in &r.path {
            for dy in -3i32..=3 {
                for dx in -3i32..=3 {
                    let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                    if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                        continue;
                    }
                    let d = dx.unsigned_abs().max(dy.unsigned_abs()) as u8;
                    let cur = g.get(nx as usize, ny as usize);
                    if d < cur.0 || (d == cur.0 && r.width > cur.1) {
                        g.set(nx as usize, ny as usize, (d, r.width));
                    }
                }
            }
        }
    }
    g
}

/// 植被分类。`arcane` 为奇观占地（涂成 X）。
pub fn biomes(
    z: &Zones,
    t: &Terrain,
    c: &ClimateMaps,
    relief: &Grid<u8>,
    rivers: &[River],
    arcane: &Grid<bool>,
) -> Grid<u8> {
    let (w, h) = (t.land.w, t.land.h);
    let rn = river_near(rivers, w, h);
    let sabkha_n = Noise::new(0x0005_ab4a, 3);
    let corr_n = Noise::new(0x0000_a515, 5);
    Grid::from_fn(w, h, |x, y| {
        if !t.land.get(x, y) {
            return SEA;
        }
        if arcane.get(x, y) {
            return ARCANE;
        }
        if t.volcanic.get(x, y) && relief.get(x, y) >= 2 {
            return VOLCANIC;
        }
        let tt = c.temp.get(x, y);
        let p = c.precip.get(x, y);
        let rl = relief.get(x, y);
        if rl >= 8 || (rl >= 6 && tt < -2.0) {
            return ALPINE;
        }
        // 三角洲：前缘与河槽两侧是湿地，其余是肥沃的冲积平原（不沿用周围干旱气候算出的荒漠）
        if t.delta.get(x, y) {
            let by_channel = (-1i32..=1)
                .any(|dy| (-1i32..=1).any(|dx| t.delta_channel.at(x as i32 + dx, y as i32 + dy) == Some(true)));
            return if t.dist_sea.get(x, y) <= 2.5 || by_channel { WETLAND } else { FOREST };
        }
        // 湿地：填平的低平湖沼与潟湖、红树林海岸、大河两岸的低洼地
        let (rd, rw) = rn.get(x, y);
        let near_big_river = rd <= 1 && rw >= 2;
        let mangrove = z.get("mangrove", x, y) > 0.45 && t.dist_sea.get(x, y) <= 2.5 && tt >= 18.0;
        if t.wetland.get(x, y)
            || (rl == 0
                && (mangrove || (near_big_river && p > 0.55 && t.elev.get(x, y) < 25.0 && t.dist_sea.get(x, y) <= 8.0)))
        {
            return WETLAND;
        }
        let mut b = oasis(classify(tt, p, c.medit.get(x, y)), rd, rw, corr_n.fbm(x as f64, y as f64, 7.0, 2, 0.5));
        // 冰原只在冰盖内部（高程 ≥ 180 米）；冰盖边缘的低平海岸是不结冰的冻原（像格陵兰南端的海岸）
        if b == ICE && rl <= 1 {
            b = TUNDRA;
        }
        // 萨布哈（盐沼）：干旱海岸的低平处，海水倒灌、蒸发后留下盐壳与泥滩（记湿地）
        if matches!(b, DESERT | STEPPE)
            && rl == 0
            && t.dist_sea.get(x, y) <= 2.5
            && p < 0.35
            && sabkha_n.fbm(x as f64, y as f64, 6.0, 2, 0.5) > 0.25
        {
            b = WETLAND;
        }
        // 用分区直接指定的植被（例如“晨光草甸”）：强度过半就覆盖分类结果
        for code in OVERRIDABLE {
            let kind = format!("biome_{}", *code as char);
            if z.get(&kind, x, y) > 0.5 && !matches!(b, ICE | ALPINE) {
                return *code;
            }
        }
        b
    })
}

/// 可以用 `biome_X` 分区覆盖的植被代码。
const OVERRIDABLE: &[u8] = b"TBFGMKDSJW";

/// 河岸绿洲：干旱区（荒漠、半干旱草原）里的河流两岸是一条窄窄的灌溉走廊——
/// 大河（宽度 ≥ 2）的河道是湿地（泛滥平原的芦苇、灌渠与椰林），贴河的一两格是半干旱草原（灌溉农田），
/// 宽度沿程按噪声 `n`（约 −1–1）变化；小河只有河道本身与部分贴河的格是半干旱草原。
pub fn oasis(b: u8, river_dist: u8, river_width: u8, n: f64) -> u8 {
    if !matches!(b, DESERT | STEPPE) {
        return b;
    }
    match river_dist {
        0 => {
            if river_width >= 2 {
                WETLAND
            } else {
                STEPPE
            }
        }
        1 => {
            if river_width >= 3 && n > 0.35 {
                WETLAND
            } else if river_width >= 2 || n > -0.3 {
                STEPPE
            } else {
                b
            }
        }
        2 if river_width >= 3 && n > 0.1 => STEPPE,
        _ => b,
    }
}

/// （气温, 降水, 地中海式气候程度）→ 植被。
/// - 热带雨林要求年均温 ≥ 23°C；19–23°C 的湿润地区是亚热带常绿阔叶林（记为 F）；
/// - 地中海灌丛只出现在地中海式气候里（冬季在西风带、上风有海），不在大陆内部、信风带或热带高山上。
pub fn classify(tt: f64, p: f64, medit: f64) -> u8 {
    let med = medit >= 0.5;
    if tt < -9.0 {
        ICE
    } else if tt < -3.0 {
        TUNDRA
    } else if tt < 1.0 {
        if p >= 0.3 { BOREAL } else { TUNDRA }
    } else if tt < 6.5 {
        // 针叶林在寒冷的地方需要的降水不多（蒸发弱）
        if p >= 0.28 {
            BOREAL
        } else if p >= 0.16 {
            GRASS
        } else {
            STEPPE
        }
    } else if tt < 12.0 {
        if p >= 0.5 {
            FOREST
        } else if p >= 0.28 {
            GRASS
        } else {
            STEPPE
        }
    } else if tt < 19.0 {
        if med {
            if p >= 1.1 {
                FOREST
            } else if p >= 0.33 {
                MEDIT
            } else if p >= 0.16 {
                STEPPE
            } else {
                DESERT
            }
        } else if p >= 0.6 {
            FOREST
        } else if p >= 0.3 {
            GRASS
        } else if p >= 0.15 {
            STEPPE
        } else {
            DESERT
        }
    } else if tt < 23.0 {
        if med && (0.33..1.1).contains(&p) {
            MEDIT
        } else if p >= 0.9 {
            FOREST
        } else if p >= 0.5 {
            SAVANNA
        } else if p >= 0.22 {
            STEPPE
        } else {
            DESERT
        }
    } else if p >= 0.9 {
        JUNGLE
    } else if p >= 0.5 {
        SAVANNA
    } else if p >= 0.22 {
        STEPPE
    } else {
        DESERT
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classification_follows_climate() {
        assert_eq!(classify(-12.0, 0.5, 0.0), ICE);
        assert_eq!(classify(-5.0, 0.5, 0.0), TUNDRA);
        assert_eq!(classify(3.0, 0.8, 0.0), BOREAL);
        assert_eq!(classify(9.0, 0.9, 0.0), FOREST);
        // 地中海灌丛只出现在地中海式气候里（第三个参数为地中海式气候的程度）
        assert_eq!(classify(16.0, 0.6, 1.0), MEDIT);
        assert_eq!(classify(16.0, 0.45, 0.0), GRASS);
        assert_eq!(classify(16.0, 0.45, 1.0), MEDIT);
        assert_eq!(classify(22.0, 0.05, 0.0), DESERT);
        // 干旱区河流两岸是窄窄的灌溉走廊：大河贴河的格是湿地、外缘是半干旱草原，离河远的仍是荒漠
        assert_eq!(oasis(classify(22.0, 0.05, 0.0), 0, 3, 0.0), WETLAND);
        assert_eq!(oasis(classify(22.0, 0.05, 0.0), 1, 2, 0.0), STEPPE);
        assert_eq!(oasis(classify(22.0, 0.05, 0.0), 2, 1, 0.0), DESERT);
        assert_eq!(oasis(FOREST, 0, 3, 0.0), FOREST);
        assert_eq!(classify(25.0, 1.2, 0.0), JUNGLE);
        assert_eq!(classify(25.0, 0.7, 0.0), SAVANNA);
        // 热带雨林要求年均温 ≥ 23°C；19–23°C 的湿润地区是亚热带常绿阔叶林
        assert_eq!(classify(21.0, 1.2, 0.0), FOREST);
    }

    #[test]
    fn west_fetch_measures_distance_to_upwind_sea() {
        // 第 0 列是海，往东逐列变远；第 1 行第 3 列的海只影响它东侧的扇形
        let mut land = Grid::new(8, 3, true);
        for y in 0..3 {
            land.set(0, y, false);
        }
        land.set(3, 1, false);
        let f = west_fetch(&land);
        assert_eq!(f.get(1, 0), 1.0);
        assert_eq!(f.get(2, 2), 2.0);
        assert_eq!(f.get(4, 1), 1.0);
        assert_eq!(f.get(5, 0), 2.0);
        assert_eq!(f.get(3, 0), 3.0);
    }

    #[test]
    fn interpolation_clamps_and_blends() {
        let c = [[0.0, 0.0], [10.0, 10.0]];
        assert_eq!(interp(&c, -5.0), 0.0);
        assert_eq!(interp(&c, 5.0), 5.0);
        assert_eq!(interp(&c, 50.0), 10.0);
    }
}
