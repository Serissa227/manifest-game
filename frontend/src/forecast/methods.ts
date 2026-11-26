// 行情预测方法（docs/ECONOMY.md 4.3）。分两档：
// - 行商的老法子（人人会）：照旧（朴素法）、旬均价（移动平均）、顺势推算（漂移法）、去年同月（季节朴素法）、
//   公道价（按经验回归：偏离公道价的部分每过半个月收回一半）、星象历书（与价格无关，全凭运气）；
// - 算学奇才的法子（只有少数天才掌握）：递减权重均价（简单指数平滑）、最小二乘直线（线性回归）、双重平滑（Holt 线性趋势）、
//   渐缓的涨势（阻尼趋势）、回归术（均值回归 AR(1)，估计回归速度与公道价）、周期推算（AR(2)，看得出几年一轮的涨落）、
//   四季平滑（Holt–Winters 加法季节，只用于月线）。
// 公式见 Hyndman & Athanasopoulos《Forecasting: Principles and Practice》第 3 版。
// 输入序列里的 null 表示不参与拟合的日期（剔除的日期）：平滑类方法在这些天只推进状态、不更新；回归类方法直接跳过。
// 每种方法给出一步预测（样本内拟合值）、残差、残差标准差 σ、AICc，以及第 1..h 步的点预测与标准差 σ_h。

import { boundedMin, goldenMin } from "./stats";

export type MethodKey =
  | "naive"
  | "ma"
  | "drift"
  | "seasonal"
  | "fair"
  | "astrology"
  | "ses"
  | "linear"
  | "holt"
  | "damped"
  | "ar1"
  | "ar2"
  | "hw";

/** 行商的老法子（人人会）。 */
export const COMMON_METHODS: readonly MethodKey[] = ["naive", "ma", "drift", "seasonal", "fair", "astrology"];
/** 算学奇才的法子（与内核 `mates::GENIUS_METHODS` 一致）。 */
export const GENIUS_METHODS: readonly MethodKey[] = ["ses", "linear", "holt", "damped", "ar1", "ar2", "hw"];
/** 只用于月线的方法（日线没有“一年十二期”的季节）。 */
export const MONTHLY_ONLY: readonly MethodKey[] = ["hw"];
/** 月线的季节长度。 */
export const SEASON_LENGTH = 12;
/** 方法的固定顺序（界面列表与回测表都按这个顺序）。 */
export const METHOD_KEYS: readonly MethodKey[] = [...COMMON_METHODS, ...GENIUS_METHODS];

/**
 * 可以手动指定的参数：α、β*（Holt 的分量形式）、φ（阻尼）、k（移动平均窗口）、AR(1) 的 φ 与均衡价 μ、
 * 公道价的回归半衰期（天）。
 */
export interface MethodParams {
  alpha?: number;
  beta?: number;
  phi?: number;
  k?: number;
  arPhi?: number;
  /** AR(2) 的第二个系数 */
  arPhi2?: number;
  /** Holt–Winters 的季节平滑系数 γ */
  gamma?: number;
  mu?: number;
  halfLife?: number;
}

/** 需要日期的方法（去年同月、星象历书）用到的上下文：各点的日期、去年同月的价格（已按同样的尺度变换）。 */
export interface MethodContext {
  days: readonly number[];
  lastYear: (day: number) => number | null;
}

export interface Fit {
  method: MethodKey;
  /** 实际使用的参数（自动估计或手动指定） */
  params: MethodParams;
  /** 样本内的一步预测（与输入对齐；没有定义的位置为 null） */
  fitted: (number | null)[];
  residuals: (number | null)[];
  /** 残差标准差（扣除估计参数的个数） */
  sigma: number;
  /** 估计的参数个数（AICc 与 Ljung–Box 的自由度用） */
  nParams: number;
  /** 残差个数 */
  n: number;
  sse: number;
  aicc: number;
  /** 第 1..h 步（从序列最后一天算起）的点预测与标准差；线性回归另给 t 分布的自由度 */
  forecast(h: number): { mean: number[]; sd: number[]; df?: number };
  /** 解释用的量：AR(1) 的半衰期与均衡价、趋势斜率等 */
  info: {
    halfLife?: number;
    mu?: number;
    slope?: number;
    level?: number;
    trend?: number;
    randomWalk?: boolean;
    /** AR(2) 的特征根为复数时，一轮涨落的期数 */
    period?: number;
    /** Holt–Winters 的季节起伏（各期季节项的最大绝对值，与水平同单位） */
    seasonAmp?: number;
  };
}

/** 方法对样本长度的最低要求（非空观测数）。 */
export const MIN_OBS: Record<MethodKey, number> = {
  naive: 2,
  ma: 3,
  drift: 3,
  seasonal: 2,
  fair: 3,
  astrology: 2,
  ses: 3,
  linear: 3,
  holt: 4,
  damped: 5,
  ar1: 5,
  ar2: 8,
  hw: 2 * SEASON_LENGTH,
};

function lastIndex(y: readonly (number | null)[]): number {
  for (let i = y.length - 1; i >= 0; i--) if (y[i] !== null) return i;
  return -1;
}

function firstIndex(y: readonly (number | null)[]): number {
  return y.findIndex((v) => v !== null);
}

function sseOf(res: readonly (number | null)[]): { sse: number; n: number } {
  let sse = 0;
  let n = 0;
  for (const e of res) {
    if (e !== null && Number.isFinite(e)) {
      sse += e * e;
      n++;
    }
  }
  return { sse, n };
}

function aiccOf(sse: number, n: number, k: number): number {
  // 高斯似然下的 AIC（加上 σ 本身一个参数）与小样本修正
  const kk = k + 1;
  if (n <= kk + 1 || sse <= 0) return NaN;
  const aic = n * Math.log(sse / n) + 2 * kk;
  return aic + (2 * kk * (kk + 1)) / (n - kk - 1);
}

function sigmaOf(sse: number, n: number, k: number): number {
  const dof = n - k;
  return dof > 0 ? Math.sqrt(sse / dof) : NaN;
}

function build(
  method: MethodKey,
  params: MethodParams,
  fitted: (number | null)[],
  y: readonly (number | null)[],
  nParams: number,
  forecast: Fit["forecast"],
  info: Fit["info"] = {},
): Fit {
  const residuals = fitted.map((f, i) => (f === null || y[i] === null ? null : (y[i] as number) - f));
  const { sse, n } = sseOf(residuals);
  return { method, params, fitted, residuals, sigma: sigmaOf(sse, n, nParams), nParams, n, sse, aicc: aiccOf(sse, n, nParams), forecast, info };
}

// ───────────────────────────── 基准方法 ─────────────────────────────

/** 朴素法（随机游走）：ŷ = 最后一个观测；σ_h = σ√h。 */
export function naive(y: readonly (number | null)[]): Fit {
  const fitted = y.map((_, i) => (i > 0 && y[i - 1] !== null ? (y[i - 1] as number) : null));
  const li = lastIndex(y);
  const last = y[li] as number;
  const gap = y.length - 1 - li;
  const fit = build("naive", {}, fitted, y, 0, (h) => {
    const mean: number[] = [];
    const sd: number[] = [];
    for (let s = 1; s <= h; s++) {
      mean.push(last);
      sd.push(fit.sigma * Math.sqrt(s + gap));
    }
    return { mean, sd };
  });
  return fit;
}

/** 漂移法：ŷ_{T+h} = y_T + h·(y_T − y_1)/(T − 1)；σ_h = σ√(h(1 + h/(T − 1)))。 */
export function drift(y: readonly (number | null)[]): Fit {
  const fi = firstIndex(y);
  const li = lastIndex(y);
  const slope = li > fi ? ((y[li] as number) - (y[fi] as number)) / (li - fi) : 0;
  const fitted = y.map((_, i) => (i > 0 && y[i - 1] !== null ? (y[i - 1] as number) + slope : null));
  const last = y[li] as number;
  const span = li - fi + 1;
  const gap = y.length - 1 - li;
  const fit = build(
    "drift",
    {},
    fitted,
    y,
    1,
    (h) => {
      const mean: number[] = [];
      const sd: number[] = [];
      for (let s = 1; s <= h; s++) {
        const k = s + gap;
        mean.push(last + slope * k);
        sd.push(fit.sigma * Math.sqrt(k * (1 + k / Math.max(1, span - 1))));
      }
      return { mean, sd };
    },
    { slope },
  );
  return fit;
}

/** 移动平均 MA(k)：ŷ = 最近 k 个观测的均值；区间用一步残差的标准差（相当于 σ_噪声·√(1 + 1/k)）。 */
export function movingAverage(y: readonly (number | null)[], k0 = 10): Fit {
  const obs = y.filter((v) => v !== null).length;
  const k = Math.max(2, Math.min(Math.round(k0), Math.max(2, obs - 1)));
  const fitted: (number | null)[] = [];
  const window: number[] = [];
  for (let i = 0; i < y.length; i++) {
    fitted.push(window.length >= k ? window.reduce((a, b) => a + b, 0) / window.length : null);
    const v = y[i];
    if (v !== null) {
      window.push(v);
      if (window.length > k) window.shift();
    }
  }
  const level = window.length ? window.reduce((a, b) => a + b, 0) / window.length : NaN;
  const fit = build(
    "ma",
    { k },
    fitted,
    y,
    0,
    (h) => ({ mean: new Array<number>(h).fill(level), sd: new Array<number>(h).fill(fit.sigma) }),
    { level },
  );
  return fit;
}

/** 线性回归（最小二乘趋势）：y = a + b·t；预测区间用 t 分布，s√(1 + 1/n + (t₀ − t̄)² / Σ(t − t̄)²)。 */
export function linear(y: readonly (number | null)[]): Fit {
  const pts: [number, number][] = [];
  y.forEach((v, i) => {
    if (v !== null) pts.push([i, v]);
  });
  const n = pts.length;
  const tb = pts.reduce((s, p) => s + p[0], 0) / n;
  const yb = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const [t, v] of pts) {
    sxx += (t - tb) * (t - tb);
    sxy += (t - tb) * (v - yb);
  }
  const b = sxx > 0 ? sxy / sxx : 0;
  const a = yb - b * tb;
  const fitted = y.map((_, i) => a + b * i);
  const T = y.length;
  const fit = build(
    "linear",
    {},
    fitted,
    y,
    2,
    (h) => {
      const mean: number[] = [];
      const sd: number[] = [];
      for (let s = 1; s <= h; s++) {
        const t0 = T - 1 + s;
        mean.push(a + b * t0);
        sd.push(fit.sigma * Math.sqrt(1 + 1 / n + (sxx > 0 ? ((t0 - tb) * (t0 - tb)) / sxx : 0)));
      }
      return { mean, sd, df: Math.max(1, n - 2) };
    },
    { slope: b, level: a + b * (T - 1) },
  );
  return fit;
}

// ───────────────────────────── 指数平滑 ─────────────────────────────

interface SmoothRun {
  fitted: (number | null)[];
  level: number;
  trend: number;
  sse: number;
}

/** 平滑的递推（SES：beta = 0 且无趋势；Holt：phi = 1；阻尼：phi < 1）。 */
function smooth(y: readonly (number | null)[], alpha: number, beta: number, phi: number, withTrend: boolean): SmoothRun {
  const fi = firstIndex(y);
  const fitted: (number | null)[] = new Array<number | null>(y.length).fill(null);
  let level = y[fi] as number;
  let trend = 0;
  if (withTrend) {
    // 初始趋势：头几天的平均变化
    let j = fi + 1;
    let steps = 0;
    let last = level;
    while (j < y.length && steps < 4) {
      if (y[j] !== null) {
        trend += (y[j] as number) - last;
        last = y[j] as number;
        steps++;
      }
      j++;
    }
    trend = steps ? trend / steps : 0;
  }
  let sse = 0;
  for (let i = fi + 1; i < y.length; i++) {
    const damped = withTrend ? phi * trend : 0;
    const pred = level + damped;
    fitted[i] = pred;
    const v = y[i];
    if (v === null) {
      level = pred;
      trend = withTrend ? phi * trend : 0;
      continue;
    }
    const e = v - pred;
    sse += e * e;
    const newLevel = pred + alpha * e;
    if (withTrend) trend = beta * (newLevel - level) + (1 - beta) * damped;
    level = newLevel;
  }
  return { fitted, level, trend, sse };
}

/** 简单指数平滑：ℓ_t = α·y_t + (1 − α)·ℓ_{t−1}；ŷ = ℓ_T；σ_h = σ√(1 + α²(h − 1))。 */
export function ses(y: readonly (number | null)[], p: MethodParams = {}): Fit {
  const alpha = p.alpha ?? goldenMin((a) => smooth(y, a, 0, 1, false).sse, 0.01, 0.99);
  const run = smooth(y, alpha, 0, 1, false);
  const fit = build(
    "ses",
    { alpha },
    run.fitted,
    y,
    1,
    (h) => {
      const mean = new Array<number>(h).fill(run.level);
      const sd = mean.map((_, i) => fit.sigma * Math.sqrt(1 + alpha * alpha * i));
      return { mean, sd };
    },
    { level: run.level },
  );
  return fit;
}

/** Holt 线性趋势（β 为分量形式的 β*）：ŷ_{T+h} = ℓ_T + h·b_T；σ_h = σ√(1 + Σ_{j<h}(α + αβ*·j)²)。 */
export function holt(y: readonly (number | null)[], p: MethodParams = {}): Fit {
  let alpha = p.alpha;
  let beta = p.beta;
  if (alpha === undefined || beta === undefined) {
    const lo = [alpha ?? 0.01, beta ?? 0.01];
    const hi = [alpha ?? 0.99, beta ?? 0.99];
    const [a, b] = boundedMin((x) => smooth(y, x[0], x[1], 1, true).sse, lo, hi, 7);
    alpha = alpha ?? a;
    beta = beta ?? b;
  }
  const run = smooth(y, alpha, beta, 1, true);
  const [al, be] = [alpha, beta];
  const fit = build(
    "holt",
    { alpha: al, beta: be },
    run.fitted,
    y,
    2,
    (h) => {
      const mean: number[] = [];
      const sd: number[] = [];
      let acc = 0;
      for (let s = 1; s <= h; s++) {
        mean.push(run.level + s * run.trend);
        if (s > 1) acc += (al + al * be * (s - 1)) ** 2;
        sd.push(fit.sigma * Math.sqrt(1 + acc));
      }
      return { mean, sd };
    },
    { level: run.level, trend: run.trend },
  );
  return fit;
}

/** 阻尼趋势（Gardner–McKenzie）：ŷ_{T+h} = ℓ_T + (φ + … + φ^h)·b_T；σ_h = σ√(1 + Σ_{j<h}(α + αβ*·(φ + … + φ^j))²)。 */
export function damped(y: readonly (number | null)[], p: MethodParams = {}): Fit {
  let { alpha, beta, phi } = p;
  if (alpha === undefined || beta === undefined || phi === undefined) {
    const lo = [alpha ?? 0.01, beta ?? 0.01, phi ?? 0.8];
    const hi = [alpha ?? 0.99, beta ?? 0.99, phi ?? 0.98];
    const [a, b, f] = boundedMin((x) => smooth(y, x[0], x[1], x[2], true).sse, lo, hi, 5);
    alpha = alpha ?? a;
    beta = beta ?? b;
    phi = phi ?? f;
  }
  const run = smooth(y, alpha, beta, phi, true);
  const [al, be, ph] = [alpha, beta, phi];
  const fit = build(
    "damped",
    { alpha: al, beta: be, phi: ph },
    run.fitted,
    y,
    3,
    (h) => {
      const mean: number[] = [];
      const sd: number[] = [];
      let phiSum = 0;
      let pw = 1;
      let acc = 0;
      for (let s = 1; s <= h; s++) {
        if (s > 1) acc += (al + al * be * phiSum) ** 2;
        pw *= ph;
        phiSum += pw;
        mean.push(run.level + phiSum * run.trend);
        sd.push(fit.sigma * Math.sqrt(1 + acc));
      }
      return { mean, sd };
    },
    { level: run.level, trend: run.trend },
  );
  return fit;
}

// ───────────────────────────── 均值回归 ─────────────────────────────

/** φ 达到这个值就认为看不出均值回归，按随机游走处理。 */
export const AR_PHI_MAX = 0.995;

/**
 * 均值回归 AR(1)（离散化的 Ornstein–Uhlenbeck）：y_t − μ = φ(y_{t−1} − μ) + ε；最小二乘估计 φ 与 μ（可手动指定其一）。
 * ŷ_{T+h} = μ + φ^h(y_T − μ)；σ_h = σ√((1 − φ^{2h}) / (1 − φ²))；半衰期 ln 0.5 / ln φ。
 */
export function ar1(y: readonly (number | null)[], p: MethodParams = {}): Fit {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < y.length; i++) {
    if (y[i] !== null && y[i - 1] !== null) {
      xs.push(y[i - 1] as number);
      ys.push(y[i] as number);
    }
  }
  const n = xs.length;
  let phi: number;
  let c: number;
  if (p.mu !== undefined && p.arPhi === undefined) {
    const mu = p.mu;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (ys[i] - mu) * (xs[i] - mu);
      den += (xs[i] - mu) * (xs[i] - mu);
    }
    phi = den > 0 ? num / den : 0;
    c = mu * (1 - phi);
  } else if (p.arPhi !== undefined) {
    phi = p.arPhi;
    c = p.mu !== undefined ? p.mu * (1 - phi) : n ? ys.reduce((s, v, i) => s + v - phi * xs[i], 0) / n : 0;
  } else {
    const xb = xs.reduce((a, b) => a + b, 0) / Math.max(1, n);
    const yb = ys.reduce((a, b) => a + b, 0) / Math.max(1, n);
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      sxx += (xs[i] - xb) * (xs[i] - xb);
      sxy += (xs[i] - xb) * (ys[i] - yb);
    }
    phi = sxx > 0 ? sxy / sxx : 0;
    c = yb - phi * xb;
  }
  // φ 限制在 [0, AR_PHI_MAX]；越界时按限制后的 φ 重新估计截距
  const clamped = Math.min(Math.max(phi, 0), AR_PHI_MAX);
  if (clamped !== phi && p.mu === undefined) {
    phi = clamped;
    c = n ? ys.reduce((s, v, i) => s + v - phi * xs[i], 0) / n : 0;
  } else if (clamped !== phi) {
    phi = clamped;
    c = (p.mu as number) * (1 - phi);
  }
  const randomWalk = phi >= AR_PHI_MAX && p.mu === undefined && p.arPhi === undefined;
  const mu = !randomWalk && phi < 1 ? c / (1 - phi) : NaN;
  const fitted = y.map((_, i) => (i > 0 && y[i - 1] !== null ? c + phi * (y[i - 1] as number) : null));
  const li = lastIndex(y);
  const last = y[li] as number;
  const gap = y.length - 1 - li;
  const fit = build(
    "ar1",
    { arPhi: phi, mu },
    fitted,
    y,
    2,
    (h) => {
      const mean: number[] = [];
      const sd: number[] = [];
      for (let s = 1; s <= h; s++) {
        const k = s + gap;
        if (randomWalk) {
          mean.push(last);
          sd.push(fit.sigma * Math.sqrt(k));
        } else {
          mean.push(mu + phi ** k * (last - mu));
          sd.push(fit.sigma * Math.sqrt(phi < 1 ? (1 - phi ** (2 * k)) / (1 - phi * phi) : k));
        }
      }
      return { mean, sd };
    },
    { halfLife: phi > 0 && phi < 1 ? Math.log(0.5) / Math.log(phi) : phi <= 0 ? 0 : Infinity, mu, randomWalk },
  );
  return fit;
}

// ───────────────────────────── 周期与季节 ─────────────────────────────

/**
 * 周期推算：二阶自回归 AR(2)，y_t = c + φ₁y_{t−1} + φ₂y_{t−2} + ε，最小二乘估计。
 * 特征根为复数（φ₁² + 4φ₂ < 0）时价格绕着均衡价打转，一轮的期数 2π / arccos(φ₁ / (2√(−φ₂)))——
 * 生产者扩产、减产的滞后造成的“猪周期”就是这样。ŷ 按递推；σ_h² = σ² Σ_{j<h} ψ_j²，ψ₀ = 1、ψ₁ = φ₁、ψ_j = φ₁ψ_{j−1} + φ₂ψ_{j−2}。
 * 估计出的系数不平稳（不满足 φ₂ > −1、φ₁ + φ₂ < 1、φ₂ − φ₁ < 1）时退回 AR(1)。
 */
export function ar2(y: readonly (number | null)[]): Fit {
  const rows: [number, number, number][] = [];
  for (let i = 2; i < y.length; i++) {
    const [a, b, c] = [y[i], y[i - 1], y[i - 2]];
    if (a !== null && b !== null && c !== null) rows.push([a, b, c]);
  }
  const n = rows.length;
  const mean = [0, 0, 0];
  for (const r of rows) for (let k = 0; k < 3; k++) mean[k] += r[k] / Math.max(1, n);
  let s11 = 0;
  let s12 = 0;
  let s22 = 0;
  let s1y = 0;
  let s2y = 0;
  for (const [t, a, b] of rows) {
    const [dt, da, db] = [t - mean[0], a - mean[1], b - mean[2]];
    s11 += da * da;
    s12 += da * db;
    s22 += db * db;
    s1y += da * dt;
    s2y += db * dt;
  }
  const det = s11 * s22 - s12 * s12;
  const phi1 = det > 0 ? (s1y * s22 - s2y * s12) / det : 0;
  const phi2 = det > 0 ? (s2y * s11 - s1y * s12) / det : 0;
  if (!(phi2 > -1 && phi1 + phi2 < 1 && phi2 - phi1 < 1)) {
    const f = ar1(y);
    return { ...f, method: "ar2", params: { ...f.params, arPhi2: 0 }, nParams: 3 };
  }
  const c = mean[0] - phi1 * mean[1] - phi2 * mean[2];
  const mu = c / (1 - phi1 - phi2);
  const fitted = y.map((_, i) => {
    const [a, b] = [y[i - 1], y[i - 2]];
    return i > 1 && a !== null && a !== undefined && b !== null && b !== undefined ? c + phi1 * a + phi2 * b : null;
  });
  const period = phi1 * phi1 + 4 * phi2 < 0 ? (2 * Math.PI) / Math.acos(phi1 / (2 * Math.sqrt(-phi2))) : undefined;
  const li = lastIndex(y);
  const tail = [y[li - 1] ?? y[li], y[li]].map((v) => v as number);
  const fit = build(
    "ar2",
    { arPhi: phi1, arPhi2: phi2, mu },
    fitted,
    y,
    3,
    (h) => {
      const mean: number[] = [];
      const sd: number[] = [];
      const path = [...tail];
      const psi = [1, phi1];
      let acc = 0;
      for (let s = 1; s <= h; s++) {
        const next = c + phi1 * path[path.length - 1] + phi2 * path[path.length - 2];
        path.push(next);
        mean.push(next);
        if (s > 2) psi.push(phi1 * psi[s - 2] + phi2 * psi[s - 3]);
        acc += psi[s - 1] ** 2;
        sd.push(fit.sigma * Math.sqrt(acc));
      }
      return { mean, sd };
    },
    { mu, period },
  );
  return fit;
}

/**
 * Holt–Winters 加法季节的一次平滑：返回样本内一步预测、最后的水平、趋势与季节项。前 m 期用来定初值，不给拟合值。
 * 初值（经典做法）：头两季的均值差给趋势，季节项取头两季“扣掉趋势直线后”的平均偏离（各项之和为 0），水平取第一季末。
 */
function winters(y: readonly (number | null)[], alpha: number, beta: number, gamma: number, m = SEASON_LENGTH) {
  const fitted: (number | null)[] = y.map(() => null);
  const obs = (i: number) => y[i] ?? null;
  const first = y.slice(0, m).filter((v): v is number => v !== null);
  const second = y.slice(m, 2 * m).filter((v): v is number => v !== null);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const center = avg(first);
  let trend = second.length && first.length ? (avg(second) - center) / m : 0;
  // 趋势直线在第 t 期的值（第一季的均值落在第一季的正中）
  const line = (t: number) => center + trend * (t - (m - 1) / 2);
  const season = Array.from({ length: m }, (_, i) => {
    const devs = [i, i + m].map((t) => obs(t)).map((v, k) => (v === null ? null : v - line(i + k * m))).filter((d): d is number => d !== null);
    return devs.length ? avg(devs) : 0;
  });
  const shift = avg(season);
  for (let i = 0; i < m; i++) season[i] -= shift;
  let level = line(m - 1);
  let sse = 0;
  for (let t = m; t < y.length; t++) {
    const s = season[t % m];
    const pred = level + trend + s;
    fitted[t] = pred;
    const v = obs(t);
    if (v === null) {
      // 剔除的一期：只推进状态
      level += trend;
      continue;
    }
    sse += (v - pred) ** 2;
    const newLevel = alpha * (v - s) + (1 - alpha) * (level + trend);
    trend = beta * (newLevel - level) + (1 - beta) * trend;
    season[t % m] = gamma * (v - level - trend) + (1 - gamma) * s;
    level = newLevel;
  }
  return { fitted, level, trend, season, sse, n: y.length };
}

/**
 * 四季平滑：Holt–Winters 加法季节（季节长度 12 期，只用于月线）。
 * ŷ_{T+h} = ℓ_T + h·b_T + s_{T+h−m(k+1)}，k = ⌊(h − 1)/m⌋；参数按一步预测误差平方和最小估计。
 * σ_h² = σ²[1 + (h − 1){α² + αβh + β²h(2h − 1)/6} + γk{2α + γ + βm(k + 1)}]（ETS(A,A,A)，β = αβ*，FPP3 表 8.8）。
 */
export function holtWinters(y: readonly (number | null)[], p: MethodParams = {}): Fit {
  const m = SEASON_LENGTH;
  let { alpha, beta, gamma } = p;
  if (alpha === undefined || beta === undefined || gamma === undefined) {
    const lo = [alpha ?? 0.01, beta ?? 0.01, gamma ?? 0.01];
    const hi = [alpha ?? 0.99, beta ?? 0.99, gamma ?? 0.99];
    const [a, b, g] = boundedMin((x) => winters(y, x[0], x[1], x[2]).sse, lo, hi, 5);
    alpha = alpha ?? a;
    beta = beta ?? b;
    gamma = gamma ?? g;
  }
  const run = winters(y, alpha, beta, gamma);
  const [al, be, ga] = [alpha, beta, gamma];
  const n = y.length;
  const seasonAmp = Math.max(...run.season.map((s) => Math.abs(s)));
  const fit = build(
    "hw",
    { alpha: al, beta: be, gamma: ga },
    run.fitted,
    y,
    3 + m,
    (h) => {
      const mean: number[] = [];
      const sd: number[] = [];
      const bb = al * be;
      for (let s = 1; s <= h; s++) {
        const k = Math.floor((s - 1) / m);
        mean.push(run.level + s * run.trend + run.season[(n + s - 1) % m]);
        const v = 1 + (s - 1) * (al * al + al * bb * s + (bb * bb * s * (2 * s - 1)) / 6) + ga * k * (2 * al + ga + bb * m * (k + 1));
        sd.push(fit.sigma * Math.sqrt(v));
      }
      return { mean, sd };
    },
    { level: run.level, trend: run.trend, seasonAmp },
  );
  return fit;
}

// ───────────────────────────── 行商的老法子 ─────────────────────────────

/** 公道价的默认回归半衰期（天）：“半个月收回一半”。 */
export const FAIR_HALF_LIFE = 15;

/**
 * 公道价（经验回归）：偏离公道价 μ 的部分按固定的半衰期收回——φ = 0.5^(1/半衰期)，不做估计；
 * μ 默认取序列均值（流水线会换成近一年月线的均价）。区间与 AR(1) 相同。
 */
export function fair(y: readonly (number | null)[], p: MethodParams = {}): Fit {
  const hl = Math.max(1, p.halfLife ?? FAIR_HALF_LIFE);
  const obs = y.filter((v): v is number => v !== null);
  const mu = p.mu ?? obs.reduce((a, b) => a + b, 0) / Math.max(1, obs.length);
  const f = ar1(y, { arPhi: 0.5 ** (1 / hl), mu });
  return { ...f, method: "fair", params: { halfLife: hl, mu }, nParams: 0, info: { ...f.info, mu } };
}

/** 去年同月（季节朴素法）：照去年这个月的均价；区间用样本内误差的标准差（一年以内 σ_h = σ）。 */
export function seasonalNaive(y: readonly (number | null)[], ctx: MethodContext): Fit {
  const fitted = ctx.days.map((d) => ctx.lastYear(d));
  const T = ctx.days.length;
  const origin = T ? ctx.days[T - 1] : 0;
  const fit = build("seasonal", {}, fitted, y, 0, (h) => {
    const mean: number[] = [];
    for (let s = 1; s <= h; s++) mean.push(ctx.lastYear(origin + s) ?? NaN);
    return { mean, sd: mean.map(() => fit.sigma) };
  });
  return fit;
}

/** 历书上某天的“星象吉凶”：−10%…+10%，只由日期决定（与价格毫无关系）。 */
export function almanac(day: number): number {
  let h = 0x811c9dc5;
  const s = `star:${day}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (((h >>> 0) % 2001) - 1000) / 10_000;
}

/** 星象历书：照旧价按当天的星象吉凶加减（至多一成）；区间同朴素法。 */
export function astrology(y: readonly (number | null)[], ctx: MethodContext): Fit {
  const fitted = y.map((_, i) => (i > 0 && y[i - 1] !== null ? (y[i - 1] as number) * (1 + almanac(ctx.days[i])) : null));
  const li = lastIndex(y);
  const last = y[li] as number;
  const gap = y.length - 1 - li;
  const origin = ctx.days.length ? ctx.days[ctx.days.length - 1] : 0;
  const fit = build("astrology", {}, fitted, y, 0, (h) => {
    const mean: number[] = [];
    const sd: number[] = [];
    for (let s = 1; s <= h; s++) {
      mean.push(last * (1 + almanac(origin + s)));
      sd.push(fit.sigma * Math.sqrt(s + gap));
    }
    return { mean, sd };
  });
  return fit;
}

/** 按 key 拟合；去年同月与星象历书需要日期上下文（没有时退回朴素法）。 */
export function fitMethod(method: MethodKey, y: readonly (number | null)[], p: MethodParams = {}, ctx?: MethodContext): Fit {
  switch (method) {
    case "seasonal":
      return ctx ? seasonalNaive(y, ctx) : naive(y);
    case "fair":
      return fair(y, p);
    case "astrology":
      return ctx ? astrology(y, ctx) : naive(y);
    case "naive":
      return naive(y);
    case "drift":
      return drift(y);
    case "ma":
      return movingAverage(y, p.k ?? 10);
    case "linear":
      return linear(y);
    case "ses":
      return ses(y, p);
    case "holt":
      return holt(y, p);
    case "damped":
      return damped(y, p);
    case "ar1":
      return ar1(y, p);
    case "ar2":
      return ar2(y);
    case "hw":
      return holtWinters(y, p);
  }
}
