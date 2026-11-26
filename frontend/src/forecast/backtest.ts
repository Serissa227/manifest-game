// 回测（滚动起点的时间序列交叉验证，FPP3 §5.10）：在最近若干个起点上各做 h 步预测，与后来的实际价格比较，
// 统计 MAE、RMSE、MAPE、MASE（以样本内朴素法的平均绝对误差为尺度）与区间覆盖率，帮商家选方法。

import { runForecast, truncate, type ForecastSpec, type SeriesInput } from "./engine";
import { METHOD_KEYS, MONTHLY_ONLY, type MethodKey } from "./methods";

export interface BacktestRow {
  method: MethodKey;
  /** 参与比较的（起点, 步长）个数；0 表示数据不够 */
  n: number;
  mae: number;
  rmse: number;
  mape: number;
  mase: number;
  /** 实际价格落在 80% / 95% 区间内的比例 */
  cov80: number;
  cov95: number;
}

/** 样本内朴素法的平均绝对误差（MASE 的尺度）。 */
export function naiveScale(values: readonly number[]): number {
  let s = 0;
  let n = 0;
  for (let i = 1; i < values.length; i++) {
    s += Math.abs(values[i] - values[i - 1]);
    n++;
  }
  return n ? s / n : NaN;
}

/**
 * 回测一种方法：起点从最后一天往前数 h 天起、共 `origins` 个，每个起点用当时之前的数据做 h 步预测。
 * 训练数据不足 `minTrain` 天的起点跳过。
 */
export function backtestMethod(
  series: SeriesInput,
  spec: ForecastSpec,
  h: number,
  origins = 20,
  minTrain = 20,
): BacktestRow {
  const n = series.daily.length;
  const scale = naiveScale(series.daily.slice(Math.max(0, n - spec.window)));
  let cnt = 0;
  let ae = 0;
  let se = 0;
  let pe = 0;
  let in80 = 0;
  let in95 = 0;
  for (let k = h; k < h + origins && n - k >= minTrain; k++) {
    const r = runForecast(truncate(series, k), spec, h);
    if (!r.ok) continue;
    for (let s = 1; s <= h; s++) {
      const actual = series.daily[n - 1 - k + s];
      const p = r.path[s - 1];
      const e = actual - p.mean;
      cnt++;
      ae += Math.abs(e);
      se += e * e;
      pe += actual > 0 ? Math.abs(e) / actual : 0;
      if (actual >= p.lo80 && actual <= p.hi80) in80++;
      if (actual >= p.lo95 && actual <= p.hi95) in95++;
    }
  }
  if (cnt === 0) return { method: spec.method, n: 0, mae: NaN, rmse: NaN, mape: NaN, mase: NaN, cov80: NaN, cov95: NaN };
  const mae = ae / cnt;
  return {
    method: spec.method,
    n: cnt,
    mae,
    rmse: Math.sqrt(se / cnt),
    mape: (pe / cnt) * 100,
    mase: scale > 0 ? mae / scale : NaN,
    cov80: in80 / cnt,
    cov95: in95 / cnt,
  };
}

/** 若干方法（默认全部）的回测，按 MASE 从小到大排序（数据不够的排在最后）。 */
export function backtestAll(
  series: SeriesInput,
  base: ForecastSpec,
  h: number,
  origins = 20,
  methods: readonly MethodKey[] = METHOD_KEYS,
): BacktestRow[] {
  // 只用于月线的方法不在日线上试算
  const daily = methods.filter((m) => !MONTHLY_ONLY.includes(m));
  const rows = daily.map((m) => backtestMethod(series, { ...base, method: m, params: m === base.method ? base.params : {} }, h, origins));
  return rows.sort((a, b) => {
    const x = Number.isFinite(a.mase) ? a.mase : Infinity;
    const y = Number.isFinite(b.mase) ? b.mase : Infinity;
    return x - y;
  });
}
