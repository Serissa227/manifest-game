// 预测监控（docs/ECONOMY.md 4.6）：记下的预测每天与实际价格对照，给出误差指标与结论。
// 判定用两条公认的标准：实际价格跑出预测区间；跟踪信号（累计误差 / 平均绝对误差）超过 ±4（另显示 Trigg 的平滑信号）。

export interface PathValue {
  mean: number;
  lo80: number;
  hi80: number;
  lo95: number;
  hi95: number;
}

export type Verdict = "pending" | "accurate" | "biased" | "failed";

export interface Evaluation {
  /** 已观测的步数 */
  n: number;
  /** 各步误差（实际 − 预测） */
  errors: number[];
  mae: number;
  rmse: number;
  mape: number;
  /** 平均误差：正数表示预测偏低 */
  bias: number;
  cov80: number;
  cov95: number;
  outside80: number;
  outside95: number;
  /** 跟踪信号 */
  ts: number;
  /** Trigg 平滑信号（−1…1） */
  trigg: number;
  /** Theil U：预测的 RMSE ÷ 朴素法（一直等于起点价格）的 RMSE；小于 1 说明比朴素法好 */
  theilU: number;
  /** 第一次跑出 95% 区间是第几步（1 起；没有为 null） */
  firstBreach95: number | null;
  verdict: Verdict;
}

/** 跟踪信号的警戒线（实务惯例）与 Trigg 信号的警戒线（平滑系数 0.1 时）。 */
export const TS_LIMIT = 4;
export const TS_WARN = 3;
export const TRIGG_LIMIT = 0.51;

/** 把路径与实际价格对照。`start` 是起点价格（朴素法的预测）。 */
export function evaluate(start: number, path: readonly PathValue[], actual: readonly number[]): Evaluation {
  const n = Math.min(path.length, actual.length);
  const errors: number[] = [];
  let ae = 0;
  let se = 0;
  let pe = 0;
  let naiveSe = 0;
  let out80 = 0;
  let out95 = 0;
  let firstBreach95: number | null = null;
  let e10 = 0;
  let m10 = 0;
  for (let i = 0; i < n; i++) {
    const a = actual[i];
    const p = path[i];
    const e = a - p.mean;
    errors.push(e);
    ae += Math.abs(e);
    se += e * e;
    pe += a > 0 ? Math.abs(e) / a : 0;
    naiveSe += (a - start) * (a - start);
    if (a < p.lo80 || a > p.hi80) out80++;
    if (a < p.lo95 || a > p.hi95) {
      out95++;
      if (firstBreach95 === null) firstBreach95 = i + 1;
    }
    e10 = 0.1 * e + 0.9 * e10;
    m10 = 0.1 * Math.abs(e) + 0.9 * m10;
  }
  const sum = errors.reduce((s, e) => s + e, 0);
  const mad = n ? ae / n : 0;
  const ts = mad > 0 ? sum / mad : 0;
  const trigg = m10 > 0 ? e10 / m10 : 0;
  const rmse = n ? Math.sqrt(se / n) : NaN;
  const naiveRmse = n ? Math.sqrt(naiveSe / n) : NaN;
  let verdict: Verdict = "pending";
  if (n > 0) {
    if ((out95 >= 2 && out95 >= 0.1 * n) || (n >= 5 && Math.abs(ts) >= TS_LIMIT)) verdict = "failed";
    else if (out95 === 1 || out80 > 0.3 * n || Math.abs(ts) >= TS_WARN) verdict = "biased";
    else verdict = "accurate";
  }
  return {
    n,
    errors,
    mae: n ? ae / n : NaN,
    rmse,
    mape: n ? (pe / n) * 100 : NaN,
    bias: n ? sum / n : NaN,
    cov80: n ? (n - out80) / n : NaN,
    cov95: n ? (n - out95) / n : NaN,
    outside80: out80,
    outside95: out95,
    ts,
    trigg,
    theilU: naiveRmse > 0 ? rmse / naiveRmse : rmse > 0 ? Infinity : 0,
    firstBreach95,
    verdict,
  };
}
