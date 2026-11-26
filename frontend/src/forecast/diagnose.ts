// 预测失败的统计诊断（docs/ECONOMY.md 4.7(a)）：
// 系统性偏差、区间突破、价格跳变、误差的 CUSUM 越界（未知断点）、已知断点的 Chow 检验、波动放大（F 检验）、
// 趋势外推与均值回归的错配、事后最好的方法、残差自相关（Ljung–Box）、样本太短、触及价格上下限、区间偏窄、起点近似。

import type { ForecastMark } from "../ipc/types";
import { allMethods, runForecast, type ForecastSpec, type SeriesInput } from "./engine";
import { ar1, type MethodKey } from "./methods";
import type { Evaluation, PathValue } from "./monitor";
import { fSf, median } from "./stats";

export type FindingKey =
  | "bias"
  | "breach"
  | "jump"
  | "cusum"
  | "chow"
  | "volatility"
  | "trend_vs_reversion"
  | "hindsight"
  | "autocorr"
  | "short_sample"
  | "clamped"
  | "narrow_interval"
  | "approx_baseline"
  | "capacity"
  | "stale"
  | "liquidity";

export interface Finding {
  key: FindingKey;
  /** 严重程度（排序用，越大越靠前） */
  severity: number;
  /** 相关的日期 */
  day?: number;
  /** 数值：偏差百分比、跳变百分比、F 值、方差比、半衰期、改进百分比等 */
  value?: number;
  /** 检验的 p 值 */
  p?: number;
  method?: MethodKey;
  /** 变化之前的值（产能：相对开局的百分比） */
  from?: number;
}

/** 预测期内产能变化超过这个幅度（相对开局，万分之一）才指出来。 */
export const CAPACITY_NOTE_BP = 500;

export interface DiagnoseInput {
  /** 起点当时的序列 */
  series: SeriesInput;
  spec: ForecastSpec;
  path: readonly PathValue[];
  /** 已观测的实际价格（第 1 步起） */
  actual: readonly number[];
  marks: readonly ForecastMark[];
  evaluation: Evaluation;
  /** 收盘价被夹在上下限的天数 */
  clampedDays: number;
  baselineExact: boolean;
  /** 玩家会的方法（“事后最好的方法”只在这些里挑）；不给时全部方法 */
  methods?: readonly MethodKey[];
  /** 是否做统计检验（需要算学奇才）：否时只给偏差、区间突破、跳变等看得见的现象 */
  advanced?: boolean;
  /** 本地产能（相对开局，万分之一）：起点当天与最后观测的一天；不知道时不给 */
  capacity?: { from: number; to: number };
  /** 起点比记下预测的前一天早几天（随船传递时用过时的行情记下；ECONOMY.md 第 7 节）；0 或不给表示不过时 */
  staleDays?: number;
  /** 当地的流动性系数（万分之一，ECONOMY.md 6.9）：起点当天与最后观测的一天；不知道时不给 */
  liquidity?: { from: number; to: number };
}

/** 预测期内流动性系数变化超过这个幅度（万分之一）才指出来。 */
export const LIQUIDITY_NOTE_BP = 300;

/** 线性回归的残差平方和（Chow 检验用）。 */
function sseLinear(ys: readonly number[], t0: number): number {
  const n = ys.length;
  if (n < 2) return 0;
  const ts = ys.map((_, i) => t0 + i);
  const tb = ts.reduce((a, b) => a + b, 0) / n;
  const yb = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (ts[i] - tb) ** 2;
    sxy += (ts[i] - tb) * (ys[i] - yb);
  }
  const b = sxx > 0 ? sxy / sxx : 0;
  const a = yb - b * tb;
  return ys.reduce((s, y, i) => s + (y - a - b * ts[i]) ** 2, 0);
}

/** Chow 检验：在已知断点 `at`（序列下标）前后各拟合一条趋势线；返回 F 值与 p 值。两段都至少 3 个点。 */
export function chowTest(ys: readonly number[], at: number): { f: number; p: number } | null {
  const n = ys.length;
  const k = 2;
  if (at < 3 || n - at < 3 || n - 2 * k <= 0) return null;
  const sc = sseLinear(ys, 0);
  const s1 = sseLinear(ys.slice(0, at), 0);
  const s2 = sseLinear(ys.slice(at), at);
  const den = (s1 + s2) / (n - 2 * k);
  if (den <= 0) return null;
  const f = (sc - s1 - s2) / k / den;
  return { f, p: fSf(f, k, n - 2 * k) };
}

/** 误差的 CUSUM（按各步预测的标准差标准化）第一次越过 Brown–Durbin–Evans 5% 边界的步数（1 起）。 */
export function cusumBreak(errors: readonly number[], path: readonly PathValue[], horizon: number): number | null {
  const H = Math.max(1, horizon);
  let w = 0;
  for (let i = 0; i < errors.length; i++) {
    const sd = (path[i].hi95 - path[i].lo95) / (2 * 1.96);
    if (!(sd > 0)) continue;
    w += errors[i] / sd;
    const t = i + 1;
    const bound = 0.948 * (Math.sqrt(H) + (2 * t) / Math.sqrt(H));
    if (Math.abs(w) > bound) return t;
  }
  return null;
}

/** 日变动的稳健标准差（1.4826 × 绝对偏差的中位数）。 */
function robustSd(xs: readonly number[]): number {
  const d = xs.slice(1).map((v, i) => v - xs[i]);
  if (d.length < 3) return NaN;
  const m = median(d);
  return 1.4826 * median(d.map((v) => Math.abs(v - m)));
}

/** 诊断，按严重程度排序。 */
export function diagnose(input: DiagnoseInput): Finding[] {
  const { series, spec, path, actual, evaluation: ev } = input;
  const out: Finding[] = [];
  const advanced = input.advanced ?? true;
  const origin = series.lastClose;
  const n = actual.length;
  if (n === 0) return out;
  const fitValues = series.daily.slice(Math.max(0, series.daily.length - spec.window));
  const last = fitValues[fitValues.length - 1];
  const meanActual = actual.reduce((a, b) => a + b, 0) / n;

  // 偏差与区间突破
  if (Math.abs(ev.ts) >= 3 || Math.abs(ev.bias) > 0.05 * meanActual) {
    out.push({ key: "bias", severity: Math.abs(ev.ts) / 4 + Math.abs(ev.bias) / meanActual, value: (100 * ev.bias) / meanActual });
  }
  if (ev.firstBreach95 !== null) {
    out.push({ key: "breach", severity: 1 + ev.outside95 / n, day: origin + ev.firstBreach95, value: ev.outside95 });
  }

  // 跳变：单日变动超过拟合期典型日波动的 4 倍
  const sd = robustSd(fitValues);
  const joined = [last, ...actual];
  if (sd > 0) {
    let best = -1;
    let bestAbs = 0;
    for (let i = 1; i < joined.length; i++) {
      const d = Math.abs(joined[i] - joined[i - 1]);
      if (d > 4 * sd && d > bestAbs) {
        best = i;
        bestAbs = d;
      }
    }
    if (best > 0) {
      out.push({ key: "jump", severity: 0.9 + bestAbs / (10 * sd), day: origin + best, value: (100 * (joined[best] - joined[best - 1])) / joined[best - 1] });
    }
  }

  // CUSUM（断点未知）
  const cs = advanced ? cusumBreak(ev.errors, path, path.length) : null;
  if (cs !== null) out.push({ key: "cusum", severity: 0.8, day: origin + cs });

  // Chow 检验（断点已知：预测期内的事件、流行开始）
  const known = input.marks.filter((m) => (m.kind === "event" || m.kind === "composed" || m.kind === "popular") && m.day > origin && m.day <= origin + n);
  if (advanced && known.length) {
    const all = [...fitValues, ...actual];
    const at = fitValues.length + (known[0].day - origin - 1);
    const c = chowTest(all, at);
    if (c && c.p < 0.05) out.push({ key: "chow", severity: 0.85 + (0.05 - c.p), day: known[0].day, value: c.f, p: c.p });
  }

  // 波动放大：预测期与拟合期日变动方差之比
  const dv = (xs: readonly number[]) => {
    const d = xs.slice(1).map((v, i) => v - xs[i]);
    if (d.length < 2) return NaN;
    const m = d.reduce((a, b) => a + b, 0) / d.length;
    return d.reduce((s, v) => s + (v - m) ** 2, 0) / (d.length - 1);
  };
  const vFit = dv(fitValues);
  const vAct = dv(joined);
  if (advanced && vFit > 0 && Number.isFinite(vAct) && joined.length >= 4) {
    const ratio = vAct / vFit;
    const p = fSf(ratio, joined.length - 2, fitValues.length - 2);
    if (ratio > 2 && p < 0.05) out.push({ key: "volatility", severity: 0.6 + Math.min(1, ratio / 10), value: ratio, p });
  }

  // 趋势外推 vs 均值回归：趋势类方法 + 这段走势之前的价格有明显的均值回归 + 实际走势与外推方向相反。
  // 均值回归用拟合窗口之前的日线估计（窗口里正在上冲或下跌的几天杠杆很大，会把 AR(1) 拉成单位根）；不够 20 天时用全部日线
  if (spec.method === "linear" || spec.method === "drift" || spec.method === "holt") {
    const before = series.daily.slice(0, Math.max(0, series.daily.length - spec.window));
    const a = ar1(before.length >= 20 ? before : series.daily);
    const hl = a.info.halfLife ?? Infinity;
    const slope = path.length > 1 ? path[path.length - 1].mean - path[0].mean : 0;
    const moved = actual[n - 1] - last;
    if (Number.isFinite(hl) && hl < 2 * path.length && slope !== 0 && Math.sign(moved) !== Math.sign(slope)) {
      out.push({ key: "trend_vs_reversion", severity: 0.95, value: hl });
    }
  }

  // 事后最好的方法：同一起点、同一份数据，用其他方法重做，与实际比较
  const others = allMethods(series, { ...spec, params: {} }, n, input.methods);
  const rmseOf = (p: readonly PathValue[]) => Math.sqrt(actual.reduce((s, a, i) => s + (a - p[i].mean) ** 2, 0) / n);
  const used = rmseOf(path);
  const ranked = others.map((r) => ({ method: r.spec.method, rmse: rmseOf(r.path) })).sort((a, b) => a.rmse - b.rmse);
  if (ranked.length && ranked[0].method !== spec.method && ranked[0].rmse < 0.8 * used) {
    out.push({ key: "hindsight", severity: 0.7 + (1 - ranked[0].rmse / used), method: ranked[0].method, value: 100 * (1 - ranked[0].rmse / used) });
  }

  // 残差自相关
  const at0 = advanced ? runForecast(series, spec, 1) : null;
  if (at0?.ok && at0.ljungBox && at0.ljungBox.p < 0.05) {
    out.push({ key: "autocorr", severity: 0.5, value: at0.ljungBox.q, p: at0.ljungBox.p });
  }

  // 其他情况
  const obs = fitValues.length - spec.excluded.filter((d) => d > origin - fitValues.length && d <= origin).length;
  if (obs < 20) out.push({ key: "short_sample", severity: 0.4, value: obs });
  if (input.clampedDays > 0) out.push({ key: "clamped", severity: 0.45, value: input.clampedDays });
  if (n >= 10 && ev.cov95 < 0.8) out.push({ key: "narrow_interval", severity: 0.55, value: 100 * ev.cov95 });
  if (!input.baselineExact) out.push({ key: "approx_baseline", severity: 0.1 });
  // 预测所用的行情已经过时（看得见的现象，不需要奇才）：过时越久越靠前
  const stale = input.staleDays ?? 0;
  if (stale > 0) out.push({ key: "stale", severity: 0.5 + Math.min(0.4, stale / 100), value: stale });
  // 供给在变：本地生产者扩产或减产（看得见的现象，不需要奇才）
  const cap = input.capacity;
  if (cap && cap.from > 0 && cap.to > 0 && Math.abs(cap.to - cap.from) >= CAPACITY_NOTE_BP) {
    out.push({ key: "capacity", severity: 0.6 + Math.abs(cap.to - cap.from) / 10000, from: cap.from / 100, value: cap.to / 100 });
  }
  // 当地钱袋在变：流动性系数让所有商品一起涨跌（看得见的现象，不需要奇才）
  const liq = input.liquidity;
  if (liq && Math.abs(liq.to - liq.from) >= LIQUIDITY_NOTE_BP) {
    out.push({ key: "liquidity", severity: 0.55 + Math.abs(liq.to - liq.from) / 5000, from: liq.from / 100, value: liq.to / 100 });
  }
  return out.sort((a, b) => b.severity - a.severity);
}
