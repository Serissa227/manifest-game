// 行情预测用的统计工具：均值方差、正态与 t 分位数、F 与卡方分布的尾概率、有界优化。
// 浮点只在前端（DESIGN §3 第 4 条），这里的结果只用于显示与玩家记下的预测，不进世界状态。

/** 非空数值。 */
export function present(xs: readonly (number | null)[]): number[] {
  return xs.filter((v): v is number => v !== null && Number.isFinite(v));
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** 方差（ddof = 1 为样本方差）。 */
export function variance(xs: readonly number[], ddof = 1): number {
  const n = xs.length;
  if (n - ddof <= 0) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (n - ddof);
}

/** 中位数。 */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 分位数（线性插值，p ∈ [0, 1]）。 */
export function quantile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = Math.min(Math.max(p, 0), 1) * (s.length - 1);
  const i = Math.floor(pos);
  const f = pos - i;
  return i + 1 < s.length ? s[i] * (1 - f) + s[i + 1] * f : s[i];
}

// ───────────────────────────── 分布 ─────────────────────────────

/** 标准正态分位数（Acklam 算法，相对误差约 1e-9）。 */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** 自由度为 df 的 t 分布分位数：df = 1、2 用精确公式，其余用 Cornish–Fisher 展开（Abramowitz & Stegun 26.7.5）。 */
export function tQuantile(p: number, df: number): number {
  if (!Number.isFinite(df) || df > 1e6) return normalQuantile(p);
  if (df <= 1) return Math.tan(Math.PI * (p - 0.5));
  if (df <= 2) return (2 * p - 1) / Math.sqrt(2 * p * (1 - p));
  const z = normalQuantile(p);
  const z2 = z * z;
  const g1 = (z * (z2 + 1)) / 4;
  const g2 = (z * ((5 * z2 + 16) * z2 + 3)) / 96;
  const g3 = (z * (((3 * z2 + 19) * z2 + 17) * z2 - 15)) / 384;
  const g4 = (z * ((((79 * z2 + 776) * z2 + 1482) * z2 - 1920) * z2 - 945)) / 92160;
  return z + g1 / df + g2 / (df * df) + g3 / df ** 3 + g4 / df ** 4;
}

/** ln Γ(x)（Lanczos 近似）。 */
export function lnGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  const xx = x - 1;
  let a = c[0];
  const t = xx + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

/** 正则化不完全 Beta 函数 I_x(a, b)（连分式，Numerical Recipes 的 betacf）。 */
export function regIncBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (front * betaCf(x, a, b)) / a;
  return 1 - (front * betaCf(1 - x, b, a)) / b;
}

function betaCf(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return h;
}

/** 正则化下不完全 Gamma 函数 P(a, x)。 */
export function regGammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n < 500; n++) {
      del *= x / (a + n);
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-14) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  // 连分式求 Q，再取 1 − Q
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

/** 卡方分布的上尾概率 P(X > x)。 */
export function chiSquareSf(x: number, k: number): number {
  if (k <= 0) return NaN;
  return 1 - regGammaP(k / 2, x / 2);
}

/** F 分布的上尾概率 P(F > f)。 */
export function fSf(f: number, d1: number, d2: number): number {
  if (f <= 0) return 1;
  return regIncBeta(d2 / (d2 + d1 * f), d2 / 2, d1 / 2);
}

// ───────────────────────────── 优化 ─────────────────────────────

/** 黄金分割搜索：在 [lo, hi] 上求单峰函数的最小点。 */
export function goldenMin(f: (x: number) => number, lo: number, hi: number, tol = 1e-4): number {
  const r = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let c = b - r * (b - a);
  let d = a + r * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < 200 && b - a > tol; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - r * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + r * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

/**
 * 有界的 Nelder–Mead 单纯形法：先在粗网格上找起点，再在界内收缩（越界的点夹回界内）。
 * 返回最小点（每一维都在 [lo, hi] 内）。
 */
export function boundedMin(f: (x: number[]) => number, lo: number[], hi: number[], grid = 5, iters = 300): number[] {
  const n = lo.length;
  const clamp = (x: number[]) => x.map((v, i) => Math.min(hi[i], Math.max(lo[i], v)));
  // 粗网格
  let best: number[] = lo.map((l, i) => (l + hi[i]) / 2);
  let bestF = f(best);
  const idx = new Array<number>(n).fill(0);
  const total = grid ** n;
  for (let k = 0; k < total; k++) {
    let r = k;
    for (let i = 0; i < n; i++) {
      idx[i] = r % grid;
      r = Math.floor(r / grid);
    }
    const x = idx.map((j, i) => lo[i] + ((hi[i] - lo[i]) * (j + 0.5)) / grid);
    const fx = f(x);
    if (fx < bestF) {
      bestF = fx;
      best = x;
    }
  }
  // 单纯形
  const simplex: number[][] = [best];
  for (let i = 0; i < n; i++) {
    const p = [...best];
    p[i] = p[i] + (hi[i] - lo[i]) / (grid * 2);
    simplex.push(clamp(p));
  }
  let values = simplex.map(f);
  for (let it = 0; it < iters; it++) {
    const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
    const sorted = order.map(([, i]) => simplex[i]);
    values = order.map(([v]) => v);
    simplex.splice(0, simplex.length, ...sorted);
    if (Math.abs(values[n] - values[0]) < 1e-12 * (1 + Math.abs(values[0]))) break;
    const centroid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += simplex[i][j] / n;
    const worst = simplex[n];
    const reflect = clamp(centroid.map((c, j) => c + (c - worst[j])));
    const fr = f(reflect);
    if (fr < values[0]) {
      const expand = clamp(centroid.map((c, j) => c + 2 * (c - worst[j])));
      const fe = f(expand);
      if (fe < fr) {
        simplex[n] = expand;
        values[n] = fe;
      } else {
        simplex[n] = reflect;
        values[n] = fr;
      }
    } else if (fr < values[n - 1]) {
      simplex[n] = reflect;
      values[n] = fr;
    } else {
      const contract = clamp(centroid.map((c, j) => c + 0.5 * (worst[j] - c)));
      const fc = f(contract);
      if (fc < values[n]) {
        simplex[n] = contract;
        values[n] = fc;
      } else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = clamp(simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j])));
          values[i] = f(simplex[i]);
        }
      }
    }
  }
  let bi = 0;
  for (let i = 1; i < values.length; i++) if (values[i] < values[bi]) bi = i;
  return simplex[bi];
}
