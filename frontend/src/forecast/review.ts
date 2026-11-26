// 复盘一条记下的预测：成绩单（误差指标与结论）、统计诊断、市场驱动分解与修订建议。

import type { ForecastEntryView, SeriesView } from "../ipc/types";
import { suggestAdjustments, type Suggestion } from "./adjust";
import { attribute, type Attribution } from "./attribution";
import { diagnose, type Finding } from "./diagnose";
import { DAYS_PER_MONTH, DAYS_PER_YEAR, Z95, seasonalIndices, truncate, type SeriesInput } from "./engine";
import { evaluate, type Evaluation } from "./monitor";
import type { MethodKey } from "./methods";
import { seriesAtOrigin, seriesInput, specFromView } from "./spec";

export interface Review {
  evaluation: Evaluation;
  findings: Finding[];
  /** 从起点到最后一个观测日的价格变化分解（还没有观测时为 null） */
  attribution: Attribution | null;
  suggestions: Suggestion[];
  /** 最后一个观测日：实际比预测高（正）或低（负）多少百分比 */
  lastErrorPct: number | null;
}

/** 某天所在的季节（0–3）。 */
export function seasonOf(day: number): number {
  return Math.floor((((day % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR) / (DAYS_PER_MONTH * 3));
}

/** 记下时的序列：优先用当前行情截到起点（含月线），拟合窗口已经滚出日线时用条目里保存的拟合数据。 */
export function originSeries(entry: ForecastEntryView, series: SeriesView | null): SeriesInput {
  const now = series ? seriesInput(series) : null;
  if (now) {
    const k = now.lastClose - entry.origin;
    if (k >= 0 && now.daily.length - k >= entry.fitted_on.length) return truncate(now, k);
  }
  return seriesAtOrigin(entry, { floor: series?.floor ?? 1, cap: series?.cap ?? Number.MAX_SAFE_INTEGER });
}

/**
 * 复盘。`methods` 为玩家会的方法（“事后最好的方法”与“换方法”只在这些里挑），`advanced` 表示麾下有算学奇才
 * （做统计检验、给出干预建议）。
 */
/** 预测期内的产能变化（起点与最后观测的一天）；旧的预测簿没有记下产能时不给。 */
function capacityChange(entry: ForecastEntryView): { from: number; to: number } | undefined {
  const from = entry.baseline.capacity_bp ?? 0;
  const to = entry.track.length ? (entry.track[entry.track.length - 1].capacity_bp ?? 0) : 0;
  return from > 0 && to > 0 ? { from, to } : undefined;
}

/** 预测期内的流动性系数（起点与最后观测的一天；没有记录时为 1）；还没有观测时不给。 */
function liquidityChange(entry: ForecastEntryView): { from: number; to: number } | undefined {
  if (!entry.track.length) return undefined;
  const bp = (v: number | undefined) => (v && v > 0 ? v : 10_000);
  return { from: bp(entry.baseline.liquidity_bp), to: bp(entry.track[entry.track.length - 1].liquidity_bp) };
}

export function reviewEntry(
  entry: ForecastEntryView,
  series: SeriesView | null,
  methods?: readonly MethodKey[],
  advanced = true,
): Review {
  const spec = specFromView(entry.spec);
  const actual = entry.track.map((t) => t.price);
  const evaluation = evaluate(entry.baseline.price, entry.path, actual);
  const at = originSeries(entry, series);
  const findings = diagnose({
    series: at,
    spec,
    path: entry.path,
    actual,
    marks: entry.marks,
    evaluation,
    clampedDays: entry.track.filter((t) => t.clamped !== 0).length,
    baselineExact: entry.baseline_exact,
    methods,
    advanced,
    capacity: capacityChange(entry),
    staleDays: Math.max(0, entry.created - 1 - entry.origin),
    liquidity: liquidityChange(entry),
  });
  const attribution =
    entry.track.length > 0 && series
      ? attribute(
          { baseline: entry.baseline, baselineExact: entry.baseline_exact, track: entry.track, curve: series.curve, popularBonusBp: series.popular_bonus_bp },
          entry.track.length,
        )
      : null;
  const n = entry.track.length;
  const meanSd = n
    ? entry.path.slice(0, n).reduce((s, p) => s + (p.hi95 - p.lo95) / (2 * Z95), 0) / n
    : 0;
  const today = series?.today ?? entry.origin + n + 1;
  const suggestions = suggestAdjustments({
    advanced,
    spec,
    findings,
    marks: entry.marks,
    evaluation,
    today,
    popularBonusBp: series?.popular_bonus_bp ?? 0,
    popularUntil: series?.popular_until ?? null,
    seasonalAvailable: !!series && seasonalIndices(series.monthly, series.monthly_last) !== null,
    seasonChanged: seasonOf(entry.origin) !== seasonOf(today - 1),
    meanSd,
  });
  const lastErrorPct = n ? (100 * (actual[n - 1] - entry.path[n - 1].mean)) / Math.max(1, entry.path[n - 1].mean) : null;
  return { evaluation, findings, attribution, suggestions, lastErrorPct };
}
