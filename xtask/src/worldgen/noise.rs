//! 确定性噪声：整数哈希驱动的梯度噪声、分形叠加（fBm）、脊状噪声与域扭曲。
//!
//! 只用加减乘除与整数哈希，同一台机器上同样的种子总是得到同样的结果。

/// 64 位整数混合（splitmix64 的终结函数）。
pub fn mix(mut z: u64) -> u64 {
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

/// 把种子、通道与整数坐标混成一个哈希值。
pub fn hash3(seed: u64, a: i64, b: i64) -> u64 {
    mix(seed ^ mix((a as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15) ^ mix(b as u64).wrapping_add(0x632b_e59b_d9b4_e019)))
}

/// [0, 1) 的伪随机数。
pub fn unit(seed: u64, a: i64, b: i64) -> f64 {
    (hash3(seed, a, b) >> 11) as f64 / (1u64 << 53) as f64
}

/// 简单的确定性随机数流（用于岛弧、村落等离散撒点）。
pub struct Rng {
    state: u64,
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng { state: mix(seed ^ 0x5851_f42d_4c95_7f2d) }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        mix(self.state)
    }

    /// [0, 1)
    pub fn f(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// [lo, hi)
    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + (hi - lo) * self.f()
    }
}

const S2: f64 = std::f64::consts::FRAC_1_SQRT_2;

/// 16 个单位梯度方向（cos, sin），预先写成常数，避免三角函数。
const GRADS: [(f64, f64); 16] = [
    (1.0, 0.0),
    (0.9239, 0.3827),
    (S2, S2),
    (0.3827, 0.9239),
    (0.0, 1.0),
    (-0.3827, 0.9239),
    (-S2, S2),
    (-0.9239, 0.3827),
    (-1.0, 0.0),
    (-0.9239, -0.3827),
    (-S2, -S2),
    (-0.3827, -0.9239),
    (0.0, -1.0),
    (0.3827, -0.9239),
    (S2, -S2),
    (0.9239, -0.3827),
];

fn fade(t: f64) -> f64 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

/// 一个噪声通道（不同通道互不相关）。
#[derive(Clone, Copy)]
pub struct Noise {
    seed: u64,
}

impl Noise {
    pub fn new(seed: u64, channel: u64) -> Self {
        Noise { seed: mix(seed ^ mix(channel.wrapping_mul(0xd1b5_4a32_d192_ed03))) }
    }

    fn grad(&self, ix: i64, iy: i64, dx: f64, dy: f64) -> f64 {
        let g = GRADS[(hash3(self.seed, ix, iy) & 15) as usize];
        g.0 * dx + g.1 * dy
    }

    /// 梯度噪声，约在 [-1, 1]。
    pub fn gradient(&self, x: f64, y: f64) -> f64 {
        let (fx, fy) = (x.floor(), y.floor());
        let (ix, iy) = (fx as i64, fy as i64);
        let (dx, dy) = (x - fx, y - fy);
        let (u, v) = (fade(dx), fade(dy));
        let n00 = self.grad(ix, iy, dx, dy);
        let n10 = self.grad(ix + 1, iy, dx - 1.0, dy);
        let n01 = self.grad(ix, iy + 1, dx, dy - 1.0);
        let n11 = self.grad(ix + 1, iy + 1, dx - 1.0, dy - 1.0);
        let a = n00 + u * (n10 - n00);
        let b = n01 + u * (n11 - n01);
        (a + v * (b - a)) * 1.414
    }

    /// 分形叠加：`wavelength` 为最低频的波长（格），每层频率 ×2、幅度 ×`gain`。结果约在 [-1, 1]。
    pub fn fbm(&self, x: f64, y: f64, wavelength: f64, octaves: u32, gain: f64) -> f64 {
        let mut f = 1.0 / wavelength.max(0.5);
        let mut amp = 1.0;
        let mut sum = 0.0;
        let mut norm = 0.0;
        for o in 0..octaves {
            // 每层偏移一点，避免各层在原点对齐
            let off = o as f64 * 17.31;
            sum += amp * self.gradient(x * f + off, y * f - off);
            norm += amp;
            f *= 2.0;
            amp *= gain;
        }
        sum / norm
    }

    /// 脊状噪声：1 − |n| 的分形叠加，山脊处接近 1，结果在 [0, 1]。
    pub fn ridged(&self, x: f64, y: f64, wavelength: f64, octaves: u32) -> f64 {
        let mut f = 1.0 / wavelength.max(0.5);
        let mut amp = 1.0;
        let mut sum = 0.0;
        let mut norm = 0.0;
        let mut weight = 1.0;
        for o in 0..octaves {
            let off = o as f64 * 23.17;
            let n = 1.0 - self.gradient(x * f + off, y * f + off).abs();
            let n = n * n * weight;
            weight = n.clamp(0.0, 1.0);
            sum += amp * n;
            norm += amp;
            f *= 2.0;
            amp *= 0.5;
        }
        (sum / norm).clamp(0.0, 1.0)
    }
}

/// 域扭曲：用两个低频噪声把采样点挪开，得到更“有机”的形状。
#[derive(Clone, Copy)]
pub struct Warp {
    a: Noise,
    b: Noise,
    pub amount: f64,
    pub wavelength: f64,
}

impl Warp {
    pub fn new(seed: u64, channel: u64, amount: f64, wavelength: f64) -> Self {
        Warp { a: Noise::new(seed, channel), b: Noise::new(seed, channel + 7919), amount, wavelength }
    }

    pub fn apply(&self, x: f64, y: f64) -> (f64, f64) {
        let dx = self.a.fbm(x, y, self.wavelength, 3, 0.5);
        let dy = self.b.fbm(x, y, self.wavelength, 3, 0.5);
        (x + dx * self.amount, y + dy * self.amount)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noise_is_deterministic_and_bounded() {
        let n = Noise::new(42, 1);
        let m = Noise::new(42, 1);
        let mut lo = f64::MAX;
        let mut hi = f64::MIN;
        for i in 0..2000 {
            let (x, y) = (i as f64 * 0.37, i as f64 * 0.11);
            let v = n.fbm(x, y, 16.0, 5, 0.5);
            assert_eq!(v, m.fbm(x, y, 16.0, 5, 0.5));
            lo = lo.min(v);
            hi = hi.max(v);
        }
        assert!(lo > -1.5 && hi < 1.5 && hi - lo > 0.5, "{lo} {hi}");
        let r = n.ridged(3.3, 4.4, 10.0, 4);
        assert!((0.0..=1.0).contains(&r));
    }

    #[test]
    fn channels_differ() {
        let a = Noise::new(7, 1).gradient(3.5, 2.25);
        let b = Noise::new(7, 2).gradient(3.5, 2.25);
        assert_ne!(a, b);
    }
}
