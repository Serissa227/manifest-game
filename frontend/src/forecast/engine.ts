// 预测流水线（docs/ECONOMY.md 4.3–4.5）：取拟合窗口与剔除日期 → 干预修正 → 对数尺度 → 季节修正 → 拟合 →
// 公式区间或经验区间 → 还原尺度 → 夹到价格上下限。界面、回测、复盘与调整都走这一个入口。

import { METHOD_KEYS, MIN_OBS, MONTHLY_ONLY, fitMethod, type Fit, type MethodContext, type MethodKey, type MethodParams } from "./methods";
import { chiSquareSf, normalQuantile, quantile, tQuantile } from "./stats";

/** 一年、一个月的天数（与内核历法一致）。 */
export const DAYS_PER_YEAR = 360;
export const DAYS_PER_MONTH = 30;

/** 某市场的行情序列（后端 market_series 的子集）。 */
export interface SeriesInput {
  /** 日线（收盘价），最早的在前 */
  daily: readonly number[];
  /** 日线最后一个值的日期 */
  lastClose: number;
  /** 月线（月均收盘价），最早的在前 */
  monthly: readonly number[];
  /** 月线最后一个值所在月的月末日期 */
  monthlyLast: number | null;
  /** 价格下限与上限 */
  floor: number;
  cap: number;
}

export type IntervalKind = "formula" | "empirical";

/** 干预修正（Box–Tiao）：阶跃 step（从 day 起水平移动）或脉冲 pulse（[day, end) 期间偏离）。 */
export interface Intervention {
  day: number;
  kind: "step" | "pulse";
  /** 相对幅度：0.3 表示高 30% */
  size: number;
  end: number | null;
}

export interface ForecastSpec {
  method: MethodKey;
  /** 拟合窗口（最近多少天） */
  window: number;
  /** 手动指定的参数（不给的自动估计） */
  params: MethodParams;
  /** 对数尺度（Box–Cox λ = 0） */
  log: boolean;
  /** 季节修正（用月线的季节指数） */
  seasonal: boolean;
  /** 不参与拟合的日期 */
  excluded: readonly number[];
  interval: IntervalKind;
  intervention: Intervention | null;
  /** 区间放大倍数（区间校准；1 为不变） */
  sigmaScale: number;
}

export const DEFAULT_SPEC: ForecastSpec = {
  method: "ar1",
  window: 60,
  params: {},
  log: false,
  seasonal: false,
  excluded: [],
  interval: "formula",
  intervention: null,
  sigmaScale: 1,
};

export interface PathPoint {
  day: number;
  mean: number;
  lo80: number;
  hi80: number;
  lo95: number;
  hi95: number;
}

export interface LjungBox {
  q: number;
  df: number;
  p: number;
  lag: number;
}

export interface ForecastResult {
  ok: true;
  spec: ForecastSpec;
  /** 起点：最后一个已知收盘价的日期 */
  origin: number;
  /** 拟合窗口的日期与原始值 */
  days: number[];
  values: number[];
  /** 样本内拟合值（原尺度；没有定义的位置为 null） */
  fitted: (number | null)[];
  path: PathPoint[];
  /** 变换后的尺度上的拟合（参数、σ、AICc、解释量） */
  fit: Fit;
  /** 实际用的区间（经验区间样本不够时退回公式区间） */
  interval: IntervalKind;
  /** 实际是否做了季节修正（月线不足 12 个月时不做） */
  seasonal: boolean;
  seasonalIndex: number[] | null;
  ljungBox: LjungBox | null;
  /** 样本内一步预测的均方根误差（原尺度） */
  rmse: number;
}

export interface ForecastFailure {
  ok: false;
  /** no_data：还没有收盘价；too_short：样本太短；no_history：去年同月缺少去年的价目（月线不足）；monthly_only：只用于月线的方法 */
  reason: "no_data" | "too_short" | "no_history" | "monthly_only";
}

export const Z80 = normalQuantile(0.9);
export const Z95 = normalQuantile(0.975);

/** 某天所在的月份（0–11）。 */
export function monthOfYear(day: number): number {
  return Math.floor((((day % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR) / DAYS_PER_MONTH);
}

/**
 * 月线的季节指数（经典乘法分解）：满 24 个月用“对中心化 2×12 移动平均的比率”，12–23 个月用“月均 / 总均”；
 * 不足 12 个月返回 null。结果按月份（0–11）排列，均值为 1。
 */
export function seasonalIndices(monthly: readonly number[], monthlyLast: number | null): number[] | null {
  const M = monthly.length;
  if (M < 12 || monthlyLast === null) return null;
  const moy = (i: number) => monthOfYear(monthlyLast - DAYS_PER_MONTH * (M - 1 - i));
  const buckets: number[][] = Array.from({ length: 12 }, () => []);
  if (M >= 24) {
    for (let i = 6; i < M - 6; i++) {
      // 2×12 中心化移动平均
      let s = monthly[i - 6] / 2 + monthly[i + 6] / 2;
      for (let j = i - 5; j <= i + 5; j++) s += monthly[j];
      const trend = s / 12;
      if (trend > 0) buckets[moy(i)].push(monthly[i] / trend);
    }
  } else {
    const overall = monthly.reduce((a, b) => a + b, 0) / M;
    for (let i = 0; i < M; i++) if (overall > 0) buckets[moy(i)].push(monthly[i] / overall);
  }
  const raw = buckets.map((b) => (b.length ? b.reduce((a, c) => a + c, 0) / b.length : NaN));
  const known = raw.filter((v) => Number.isFinite(v));
  if (known.length < 12) return null;
  const avg = known.reduce((a, b) => a + b, 0) / known.length;
  return raw.map((v) => v / avg);
}

/** 去年同月的月均价：某天往前推一年所在月份的月线值（没有时为 null）。 */
export function lastYearValue(series: SeriesInput, day: number): number | null {
  if (series.monthlyLast === null) return null;
  const d = day - DAYS_PER_YEAR;
  if (d < 0) return null;
  const monthEnd = Math.floor(d / DAYS_PER_MONTH) * DAYS_PER_MONTH + DAYS_PER_MONTH - 1;
  const back = (series.monthlyLast - monthEnd) / DAYS_PER_MONTH;
  const i = series.monthly.length - 1 - back;
  return Number.isInteger(back) && i >= 0 && i < series.monthly.length ? series.monthly[i] : null;
}

/** 公道价：近一年（最多 12 个月）月线的均价；月线不足 3 个月时取拟合窗口的均价。 */
export function fairPrice(series: SeriesInput, window: readonly number[]): number {
  const m = series.monthly.slice(-12);
  const xs = m.length >= 3 ? m : window;
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

/** Ljung–Box 检验：滞后 ℓ = min(10, ⌊T/5⌋)，自由度扣除参数个数。 */
export function ljungBox(residuals: readonly (number | null)[], nParams: number): LjungBox | null {
  const e = residuals.filter((v): v is number => v !== null && Number.isFinite(v));
  const T = e.length;
  const lag = Math.min(10, Math.floor(T / 5));
  const df = lag - nParams;
  if (lag < 2 || df < 1) return null;
  const m = e.reduce((a, b) => a + b, 0) / T;
  let den = 0;
  for (const v of e) den += (v - m) * (v - m);
  if (den <= 0) return null;
  let q = 0;
  for (let k = 1; k <= lag; k++) {
    let num = 0;
    for (let t = k; t < T; t++) num += (e[t] - m) * (e[t - k] - m);
    const r = num / den;
    q += (r * r) / (T - k);
  }
  q *= T * (T + 2);
  return { q, df, p: chiSquareSf(q, df), lag };
}

/** 把序列截到更早的起点（去掉最后 k 天），月线只保留那时已经记下的月份。 */
export function truncate(series: SeriesInput, k: number): SeriesInput {
  const lastClose = series.lastClose - k;
  let monthly = series.monthly;
  let monthlyLast = series.monthlyLast;
  if (monthlyLast !== null) {
    let drop = 0;
    while (drop < monthly.length && monthlyLast - DAYS_PER_MONTH * drop > lastClose) drop++;
    monthly = monthly.slice(0, monthly.length - drop);
    monthlyLast = monthly.length ? monthlyLast - DAYS_PER_MONTH * drop : null;
  }
  return { ...series, daily: series.daily.slice(0, Math.max(0, series.daily.length - k)), lastClose, monthly, monthlyLast };
}

const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 在变换后的尺度上拟合与预测（公式区间），返回原尺度的路径。 */
function core(series: SeriesInput, spec: ForecastSpec, h: number): ForecastResult | ForecastFailure {
  const all = series.daily;
  if (all.length === 0) return { ok: false, reason: "no_data" };
  if (MONTHLY_ONLY.includes(spec.method)) return { ok: false, reason: "monthly_only" };
  const n = Math.min(all.length, Math.max(2, Math.round(spec.window)));
  const values = all.slice(all.length - n);
  const origin = series.lastClose;
  const days = values.map((_, i) => origin - (n - 1 - i));
  const excluded = new Set(spec.excluded);
  const iv = spec.intervention;

  // 1. 取值、剔除日期、干预修正（过去的阶跃把突变前的数据调到突变后的水平；进行中或已结束的脉冲先去掉冲击）
  const adj = (day: number) => {
    if (!iv) return 1;
    if (iv.kind === "step" && iv.day <= origin && day < iv.day) return 1 + iv.size;
    if (iv.kind === "pulse" && iv.day <= origin && day >= iv.day && (iv.end === null || day < iv.end)) return 1 / (1 + iv.size);
    return 1;
  };
  const used: (number | null)[] = values.map((v, i) => (excluded.has(days[i]) || !(v > 0) ? null : v * adj(days[i])));
  const obs = used.filter((v) => v !== null).length;
  if (obs < MIN_OBS[spec.method]) return { ok: false, reason: "too_short" };

  // 2. 季节修正与对数尺度（“去年同月”本身就按季节，不再叠加季节修正）
  const index = spec.seasonal && spec.method !== "seasonal" ? seasonalIndices(series.monthly, series.monthlyLast) : null;
  const sIdx = (day: number) => (index ? index[monthOfYear(day)] : 1);
  const fwd = (v: number, day: number) => {
    const d = v / sIdx(day);
    return spec.log ? Math.log(d) : d;
  };
  const back = (v: number, day: number) => (spec.log ? Math.exp(v) : v) * sIdx(day);
  const y = used.map((v, i) => (v === null ? null : fwd(v, days[i])));

  // 3. 拟合与预测
  const ctx: MethodContext = {
    days,
    lastYear: (day) => {
      const v = lastYearValue(series, day);
      return v === null || !(v > 0) ? null : spec.log ? Math.log(v) : v;
    },
  };
  const params: MethodParams = { ...spec.params };
  if (spec.method === "fair" && params.mu === undefined) {
    const mu = fairPrice(series, values);
    params.mu = spec.log ? Math.log(mu) : mu;
  }
  const fit = fitMethod(spec.method, y, params, ctx);
  if (!Number.isFinite(fit.sigma)) return { ok: false, reason: spec.method === "seasonal" ? "no_history" : "too_short" };
  const f = fit.forecast(h);
  if (f.mean.some((m) => !Number.isFinite(m))) return { ok: false, reason: "no_history" };
  const scale = spec.sigmaScale > 0 ? spec.sigmaScale : 1;
  const z80 = f.df ? tQuantile(0.9, f.df) : Z80;
  const z95 = f.df ? tQuantile(0.975, f.df) : Z95;
  // 未来的干预：阶跃从 day 起、脉冲在 [day, end) 期间乘上幅度；进行中的脉冲在结束前恢复冲击
  const future = (day: number) => {
    if (!iv) return 1;
    if (iv.kind === "step" && iv.day > origin && day >= iv.day) return 1 + iv.size;
    if (iv.kind === "pulse" && day >= iv.day && (iv.end === null || day < iv.end)) return 1 + iv.size;
    return 1;
  };
  const path: PathPoint[] = f.mean.map((m, i) => {
    const day = origin + i + 1;
    const sd = f.sd[i] * scale;
    const k = future(day);
    const pt = (v: number) => clampTo(back(v, day) * k, series.floor, series.cap);
    return { day, mean: pt(m), lo80: pt(m - z80 * sd), hi80: pt(m + z80 * sd), lo95: pt(m - z95 * sd), hi95: pt(m + z95 * sd) };
  });
  const fitted = fit.fitted.map((v, i) => (v === null ? null : back(v, days[i]) / adj(days[i])));
  let se = 0;
  let cnt = 0;
  fitted.forEach((v, i) => {
    if (v !== null && used[i] !== null) {
      se += (values[i] - v) ** 2;
      cnt++;
    }
  });
  return {
    ok: true,
    spec,
    origin,
    days,
    values: [...values],
    fitted,
    path,
    fit,
    interval: "formula",
    seasonal: index !== null,
    seasonalIndex: index,
    ljungBox: ljungBox(fit.residuals, fit.nParams),
    rmse: cnt ? Math.sqrt(se / cnt) : NaN,
  };
}

/** 滚动起点上的相对误差（actual / 预测 − 1），按步长分组：errors[s − 1] 是第 s 步的误差样本。 */
export function rollingErrors(series: SeriesInput, spec: ForecastSpec, h: number, maxOrigins = 40, minTrain = 20): number[][] {
  const errors: number[][] = Array.from({ length: h }, () => []);
  const n = series.daily.length;
  const inner: ForecastSpec = { ...spec, interval: "formula", sigmaScale: 1 };
  for (let k = 1; k <= Math.min(maxOrigins, n - minTrain); k++) {
    const r = core(truncate(series, k), inner, Math.min(h, k));
    if (!r.ok) continue;
    for (let s = 1; s <= Math.min(h, k); s++) {
      const actual = series.daily[n - 1 - k + s];
      const m = r.path[s - 1].mean;
      if (m > 0) errors[s - 1].push(actual / m - 1);
    }
  }
  return errors;
}

/** 经验区间至少需要的误差样本数。 */
export const MIN_EMPIRICAL = 8;

/** 预测：公式区间，或按回测误差分位数的经验区间（样本不够时退回公式区间）。 */
export function runForecast(series: SeriesInput, spec: ForecastSpec, h: number): ForecastResult | ForecastFailure {
  const r = core(series, spec, h);
  if (!r.ok || spec.interval !== "empirical") return r;
  const errors = rollingErrors(series, spec, h);
  let lastGood = -1;
  const q = errors.map((e, i) => {
    if (e.length < MIN_EMPIRICAL) return null;
    lastGood = i;
    return [quantile(e, 0.025), quantile(e, 0.1), quantile(e, 0.9), quantile(e, 0.975)];
  });
  if (lastGood < 0) return r;
  const scale = spec.sigmaScale > 0 ? spec.sigmaScale : 1;
  const path = r.path.map((p, i) => {
    // 样本不够的步长：沿用最后一个有足够样本的步长，按 √步长 放宽
    const qi = q[i] ?? (q[lastGood] as number[]).map((v) => v * Math.sqrt((i + 1) / (lastGood + 1)));
    const at = (rel: number) => clampTo(p.mean * (1 + rel * scale), series.floor, series.cap);
    return { ...p, lo95: Math.min(at(qi[0]), p.mean), lo80: Math.min(at(qi[1]), p.mean), hi80: Math.max(at(qi[2]), p.mean), hi95: Math.max(at(qi[3]), p.mean) };
  });
  return { ...r, path, interval: "empirical" };
}

/** 四舍五入成整数金币（记下预测用），并保持 95% 下沿 ≤ 80% 下沿 ≤ 预测值 ≤ 80% 上沿 ≤ 95% 上沿、非负。 */
export function roundPath(path: readonly PathPoint[]): { mean: number; lo80: number; hi80: number; lo95: number; hi95: number }[] {
  return path.map((p) => {
    const mean = Math.max(0, Math.round(p.mean));
    const lo80 = Math.min(mean, Math.max(0, Math.round(p.lo80)));
    const lo95 = Math.min(lo80, Math.max(0, Math.round(p.lo95)));
    const hi80 = Math.max(mean, Math.round(p.hi80));
    const hi95 = Math.max(hi80, Math.round(p.hi95));
    return { mean, lo80, hi80, lo95, hi95 };
  });
}

/** 若干方法（默认全部）在同一份数据上的预测（界面对比与“事后最好的方法”用）；拟合不了的方法不在结果里。 */
export function allMethods(series: SeriesInput, base: ForecastSpec, h: number, methods: readonly MethodKey[] = METHOD_KEYS): ForecastResult[] {
  return methods
    .filter((m) => !MONTHLY_ONLY.includes(m))
    .map((m) => runForecast(series, { ...base, method: m, params: m === base.method ? base.params : {} }, h))
    .filter((r): r is ForecastResult => r.ok);
}
