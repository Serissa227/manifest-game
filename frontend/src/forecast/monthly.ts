// 月线模式（docs/ECONOMY.md 第 9 节 E3）：用月线（每月的平均收盘价）看长期走势、季节与生产者造成的“猪周期”。
// 只供分析：预测簿仍按日线逐日追踪，月线的预测不记下。方法与日线共用 methods.ts 的实现，区间用公式区间。

import { DAYS_PER_MONTH, Z80, Z95, type PathPoint } from "./engine";
import { MIN_OBS, SEASON_LENGTH, fitMethod, type Fit, type MethodContext, type MethodKey } from "./methods";

/** 月线至少要攒满多少个月才能切到月线。 */
export const MONTHLY_MIN = 24;
/** 月线能用的方法（公道价按日线的回归速度定义，星象历书按日期——两者不用于月线）。 */
export const MONTHLY_METHODS: readonly MethodKey[] = ["naive", "ma", "drift", "seasonal", "ses", "linear", "holt", "damped", "ar1", "ar2", "hw"];
/** 月线的期限（月）。 */
export const MONTHLY_HORIZONS: readonly number[] = [3, 6, 12];
/** 旬均价在月线上的默认窗口（月）。 */
const MA_MONTHS = 3;

export interface MonthlyResult {
  ok: true;
  method: MethodKey;
  /** 各月的月末日期与月均价 */
  months: number[];
  values: number[];
  fitted: (number | null)[];
  /** 往后各月（月末日期）的点预测与区间 */
  path: PathPoint[];
  fit: Fit;
  /** 样本内一步预测的均方根误差 */
  rmse: number;
}

export interface MonthlyFailure {
  ok: false;
  /** too_short：月线不够长；unsupported：这个法子不用于月线 */
  reason: "too_short" | "unsupported";
}

const clampTo = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 在月线上拟合与预测（`last` 为最后一个月的月末日期，`h` 为往后几个月）。 */
export function runMonthly(
  monthly: readonly number[],
  last: number,
  method: MethodKey,
  h: number,
  floor: number,
  cap: number,
): MonthlyResult | MonthlyFailure {
  if (!MONTHLY_METHODS.includes(method)) return { ok: false, reason: "unsupported" };
  const values = monthly.filter((v) => v > 0);
  const need = Math.max(MIN_OBS[method], method === "seasonal" ? SEASON_LENGTH + 1 : 0);
  if (values.length < need) return { ok: false, reason: "too_short" };
  const n = values.length;
  const months = values.map((_, i) => last - DAYS_PER_MONTH * (n - 1 - i));
  // “去年同月”在月线上就是 12 期以前的那个月
  const ctx: MethodContext = {
    days: values.map((_, i) => i),
    lastYear: (i) => (i >= SEASON_LENGTH && i - SEASON_LENGTH < n ? values[i - SEASON_LENGTH] : null),
  };
  const fit = fitMethod(method, values, method === "ma" ? { k: MA_MONTHS } : {}, ctx);
  if (!Number.isFinite(fit.sigma)) return { ok: false, reason: "too_short" };
  const f = fit.forecast(h);
  if (f.mean.some((m) => !Number.isFinite(m))) return { ok: false, reason: "too_short" };
  const path: PathPoint[] = f.mean.map((m, i) => {
    const pt = (v: number) => clampTo(v, floor, cap);
    const sd = f.sd[i];
    return { day: last + DAYS_PER_MONTH * (i + 1), mean: pt(m), lo80: pt(m - Z80 * sd), hi80: pt(m + Z80 * sd), lo95: pt(m - Z95 * sd), hi95: pt(m + Z95 * sd) };
  });
  let se = 0;
  let cnt = 0;
  fit.fitted.forEach((v, i) => {
    if (v !== null) {
      se += (values[i] - v) ** 2;
      cnt++;
    }
  });
  return { ok: true, method, months, values, fitted: fit.fitted, path, fit, rmse: cnt ? Math.sqrt(se / cnt) : NaN };
}
