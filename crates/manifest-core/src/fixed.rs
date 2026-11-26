//! 定点数运算。
//!
//! 金额一律用 `Money`（i64，最小货币单位；名称由 `rules.toml [world] currency` 配置，默认“金币”）。
//! 比例与系数用 [`Fx`]，精度为万分之一。
//! 所有乘除都经 i128 中间结果，按"四舍五入、远离零"取整，保证跨平台一致。

use serde::{Deserialize, Serialize};
use std::fmt;
use std::ops::{Add, AddAssign, Neg, Sub, SubAssign};

/// 金额（整数），最小货币单位的名称见 `rules.world.currency`。
pub type Money = i64;

/// 万分之一精度的定点系数。`Fx(10_000)` 表示 1.0。
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Fx(pub i64);

/// 计算 `a * b / c`，四舍五入（远离零）。`c == 0` 时返回 0。
///
/// 内核里几乎每一步价格、产量、系数都要过这里，是日结里调用最多的函数。乘积装得下 i64 时（绝大多数情况）
/// 全程用 64 位运算：一次乘法、一次硬件除法同时得到商与余数；除数是常数（`Fx::SCALE`）时编译器还能换成乘法。
/// 装不下才走 i128（[`mul_div_wide`]）。两条路径的结果逐位相同，见本文件的测试 `mul_div_narrow_path_matches_wide_path`。
#[inline]
pub fn mul_div(a: i64, b: i64, c: i64) -> i64 {
    if c == 0 {
        return 0;
    }
    // `checked_div` 只在 num == i64::MIN 且 c == −1（商溢出）时失败，那一种情况留给宽路径去夹
    if let Some(num) = a.checked_mul(b)
        && let Some(q) = num.checked_div(c)
    {
        let r = num.wrapping_rem(c);
        // 余数的两倍与除数比较，决定是否进位：2|r| ≥ |c| 等价于 |r| ≥ |c| − |r|（|r| < |c|，无符号相减不会溢出）
        let (ra, ca) = (r.unsigned_abs(), c.unsigned_abs());
        let adjust = if ra >= ca - ra { if (num < 0) != (c < 0) { -1 } else { 1 } } else { 0 };
        // |c| == 1 时余数为 0、不进位；|c| ≥ 2 时 |q| ≤ 2^62，加减 1 不会溢出，也用不着再夹
        return q + adjust;
    }
    mul_div_wide(a, b, c)
}

/// [`mul_div`] 的宽路径（i128 中间结果，结果夹进 i64）：乘积超出 i64 时用；也是窄路径的对照基准。
#[inline(never)]
fn mul_div_wide(a: i64, b: i64, c: i64) -> i64 {
    if c == 0 {
        return 0;
    }
    let num = (a as i128) * (b as i128);
    let den = c as i128;
    let q = num / den;
    let r = num % den;
    // 余数的两倍与除数比较，决定是否进位
    let adjust = if (r * 2).abs() >= den.abs() { if (num < 0) != (den < 0) { -1 } else { 1 } } else { 0 };
    clamp_i128(q + adjust)
}

/// 计算 `a * b / c`，向下取整（朝负无穷）。`c == 0` 时返回 0。
pub fn mul_div_floor(a: i64, b: i64, c: i64) -> i64 {
    if c == 0 {
        return 0;
    }
    let num = (a as i128) * (b as i128);
    clamp_i128(num.div_euclid(c as i128) - if c < 0 && num.rem_euclid(c as i128) != 0 { 1 } else { 0 })
}

fn clamp_i128(v: i128) -> i64 {
    v.clamp(i64::MIN as i128, i64::MAX as i128) as i64
}

impl Fx {
    /// 定点精度：1.0 对应的原始值。
    pub const SCALE: i64 = 10_000;
    pub const ZERO: Fx = Fx(0);
    pub const ONE: Fx = Fx(Self::SCALE);

    /// 整数 n 对应的系数。
    pub const fn from_int(n: i64) -> Fx {
        Fx(n * Self::SCALE)
    }

    /// 百分数 p（例如 5 表示 5%）。
    pub const fn from_pct(p: i64) -> Fx {
        Fx(p * (Self::SCALE / 100))
    }

    /// 万分数（基点）。
    pub const fn from_bp(bp: i64) -> Fx {
        Fx(bp)
    }

    /// num / den 的比值；den 为 0 时返回 0。
    #[inline]
    pub fn ratio(num: i64, den: i64) -> Fx {
        Fx(mul_div(num, Self::SCALE, den))
    }

    pub const fn raw(self) -> i64 {
        self.0
    }

    // 方法名与 std::ops 相同但语义明确（定点乘法），保留方法调用写法
    #[allow(clippy::should_implement_trait)]
    #[inline]
    pub fn mul(self, other: Fx) -> Fx {
        Fx(mul_div(self.0, other.0, Self::SCALE))
    }

    #[allow(clippy::should_implement_trait)]
    #[inline]
    pub fn div(self, other: Fx) -> Fx {
        Fx(mul_div(self.0, Self::SCALE, other.0))
    }

    /// 把系数作用于一个整数量（如金额），四舍五入。
    #[inline]
    pub fn apply(self, v: i64) -> i64 {
        mul_div(v, self.0, Self::SCALE)
    }

    /// 把系数作用于一个整数量，向下取整。
    pub fn apply_floor(self, v: i64) -> i64 {
        mul_div_floor(v, self.0, Self::SCALE)
    }

    pub fn clamp(self, lo: Fx, hi: Fx) -> Fx {
        if self < lo {
            lo
        } else if self > hi {
            hi
        } else {
            self
        }
    }

    pub fn min(self, other: Fx) -> Fx {
        if self < other { self } else { other }
    }

    pub fn max(self, other: Fx) -> Fx {
        if self > other { self } else { other }
    }

    /// 取整数部分（向零）。
    pub fn trunc(self) -> i64 {
        self.0 / Self::SCALE
    }

    /// 线性插值：`a + (b - a) * t`。
    pub fn lerp(a: Fx, b: Fx, t: Fx) -> Fx {
        a + (b - a).mul(t)
    }
}

impl Add for Fx {
    type Output = Fx;
    fn add(self, rhs: Fx) -> Fx {
        Fx(self.0.saturating_add(rhs.0))
    }
}

impl Sub for Fx {
    type Output = Fx;
    fn sub(self, rhs: Fx) -> Fx {
        Fx(self.0.saturating_sub(rhs.0))
    }
}

impl AddAssign for Fx {
    fn add_assign(&mut self, rhs: Fx) {
        *self = *self + rhs;
    }
}

impl SubAssign for Fx {
    fn sub_assign(&mut self, rhs: Fx) {
        *self = *self - rhs;
    }
}

impl Neg for Fx {
    type Output = Fx;
    fn neg(self) -> Fx {
        Fx(-self.0)
    }
}

impl fmt::Debug for Fx {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(self, f)
    }
}

impl fmt::Display for Fx {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let sign = if self.0 < 0 { "-" } else { "" };
        let abs = self.0.unsigned_abs();
        let int = abs / Self::SCALE as u64;
        let frac = abs % Self::SCALE as u64;
        write!(f, "{sign}{int}.{frac:04}")
    }
}

/// 分段线性查表曲线：`points` 按 x 递增排列。超出范围取端点值。
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Curve {
    pub points: Vec<(Fx, Fx)>,
}

impl Curve {
    pub fn new(points: Vec<(Fx, Fx)>) -> Self {
        Self { points }
    }

    pub fn eval(&self, x: Fx) -> Fx {
        let pts = &self.points;
        let Some(first) = pts.first() else { return Fx::ONE };
        if x <= first.0 {
            return first.1;
        }
        for w in pts.windows(2) {
            let (x0, y0) = w[0];
            let (x1, y1) = w[1];
            if x <= x1 {
                let span = x1.0 - x0.0;
                if span <= 0 {
                    return y1;
                }
                let t = Fx::ratio(x.0 - x0.0, span);
                return Fx::lerp(y0, y1, t);
            }
        }
        pts.last().map(|p| p.1).unwrap_or(Fx::ONE)
    }

    /// x 递增时 y 单调不增。
    pub fn is_non_increasing(&self) -> bool {
        self.points.windows(2).all(|w| w[0].0 < w[1].0 && w[0].1 >= w[1].1)
    }
}

/// 整数平方根（向下取整）。
pub fn isqrt(v: i64) -> i64 {
    if v <= 0 {
        return 0;
    }
    let mut x = v;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + v / x) / 2;
    }
    x
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mul_div_rounds_half_away_from_zero() {
        assert_eq!(mul_div(5, 1, 2), 3);
        assert_eq!(mul_div(-5, 1, 2), -3);
        assert_eq!(mul_div(4, 1, 3), 1);
        assert_eq!(mul_div(7, 3, 0), 0);
    }

    /// 窄路径（64 位）与宽路径（i128）逐位相同：边界值的全部组合，加上一批伪随机的大小数。
    #[test]
    fn mul_div_narrow_path_matches_wide_path() {
        let edges = [
            0,
            1,
            -1,
            2,
            -2,
            3,
            -3,
            5,
            -5,
            7,
            10,
            -10,
            9_999,
            10_000,
            -10_000,
            10_001,
            15_000,
            i64::from(i32::MAX),
            i64::from(i32::MIN),
            3_037_000_499,
            3_037_000_500,
            -3_037_000_500,
            1 << 62,
            -(1 << 62),
            i64::MAX / 2,
            i64::MAX / 2 + 1,
            i64::MIN / 2,
            i64::MAX - 1,
            i64::MAX,
            i64::MIN + 1,
            i64::MIN,
        ];
        for a in edges {
            for b in edges {
                for c in edges {
                    assert_eq!(mul_div(a, b, c), mul_div_wide(a, b, c), "{a} * {b} / {c}");
                }
            }
        }
        // 伪随机（固定种子的 64 位线性同余）：各种量级混着来，余数正好落在一半上下的情况靠小除数覆盖
        let mut state = 0x9E37_79B9_7F4A_7C15_u64;
        let mut next = |bits: u32| {
            state = state.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
            (state >> (64 - bits.clamp(1, 63))) as i64
        };
        for i in 0..2_000_000u32 {
            let (wa, wb, wc) = (1 + i % 63, 1 + (i / 63) % 40, 1 + (i / 7) % 34);
            let (a, b, c) = (next(wa), next(wb), next(wc));
            let (a, b) = if i % 3 == 0 { (-a, b) } else { (a, b) };
            let c = if i % 5 == 0 { -c } else { c };
            assert_eq!(mul_div(a, b, c), mul_div_wide(a, b, c), "{a} * {b} / {c}");
            // 内核里最常见的形状：乘或除以定点精度
            assert_eq!(mul_div(a, b, Fx::SCALE), mul_div_wide(a, b, Fx::SCALE), "{a} * {b} / SCALE");
            assert_eq!(mul_div(a, Fx::SCALE, c), mul_div_wide(a, Fx::SCALE, c), "{a} * SCALE / {c}");
        }
    }

    #[test]
    fn fx_arithmetic() {
        let a = Fx::from_pct(150);
        let b = Fx::from_pct(50);
        assert_eq!(a.mul(b), Fx::from_pct(75));
        assert_eq!(a.div(b), Fx::from_int(3));
        assert_eq!(Fx::from_pct(5).apply(1000), 50);
        assert_eq!(Fx::ratio(1, 3), Fx(3333));
        assert_eq!(format!("{}", Fx(-12345)), "-1.2345");
    }

    #[test]
    fn curve_interpolates_and_clamps() {
        let c = Curve::new(vec![(Fx::ZERO, Fx::from_int(5)), (Fx::ONE, Fx::ONE), (Fx::from_int(2), Fx::from_pct(50))]);
        assert!(c.is_non_increasing());
        assert_eq!(c.eval(Fx::from_pct(50)), Fx::from_int(3));
        assert_eq!(c.eval(Fx::from_int(9)), Fx::from_pct(50));
        assert_eq!(c.eval(-Fx::ONE), Fx::from_int(5));
    }

    #[test]
    fn integer_sqrt() {
        assert_eq!(isqrt(0), 0);
        assert_eq!(isqrt(15), 3);
        assert_eq!(isqrt(16), 4);
        assert_eq!(isqrt(1_000_000), 1000);
    }
}
