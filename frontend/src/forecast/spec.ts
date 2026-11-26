// 预测规格在前端（浮点）与后端（整数：比例为万分之一）之间的换算，以及从预测簿条目还原“当时的”序列。

import type { ForecastEntryView, ForecastSpecView, SeriesView } from "../ipc/types";
import type { ForecastSpec, SeriesInput } from "./engine";
import { METHOD_KEYS, type MethodKey, type MethodParams } from "./methods";

const PARAM_KEYS: readonly (keyof MethodParams)[] = ["alpha", "beta", "phi", "k", "arPhi", "mu", "halfLife"];
const SCALE = 10_000;

export function isMethod(v: string): v is MethodKey {
  return (METHOD_KEYS as readonly string[]).includes(v);
}

/** 前端规格 → 后端保存的整数规格。 */
export function specToView(spec: ForecastSpec): ForecastSpecView {
  const params: Record<string, number> = {};
  for (const k of PARAM_KEYS) {
    const v = spec.params[k];
    if (v !== undefined && Number.isFinite(v)) params[k] = Math.round(v * SCALE);
  }
  if (spec.sigmaScale !== 1) params.sigma_scale = Math.round(spec.sigmaScale * SCALE);
  return {
    method: spec.method,
    params,
    window: Math.round(spec.window),
    log: spec.log,
    seasonal: spec.seasonal,
    excluded: [...spec.excluded].sort((a, b) => a - b),
    interval: spec.interval,
    intervention: spec.intervention
      ? { day: spec.intervention.day, kind: spec.intervention.kind, size_bp: Math.round(spec.intervention.size * SCALE), end: spec.intervention.end }
      : null,
  };
}

/** 后端保存的整数规格 → 前端规格（未知方法按朴素法）。 */
export function specFromView(v: ForecastSpecView): ForecastSpec {
  const params: MethodParams = {};
  for (const k of PARAM_KEYS) {
    const raw = v.params[k];
    if (raw !== undefined) params[k] = raw / SCALE;
  }
  return {
    method: isMethod(v.method) ? v.method : "naive",
    window: v.window,
    params,
    log: v.log,
    seasonal: v.seasonal,
    excluded: [...v.excluded],
    interval: v.interval === "empirical" ? "empirical" : "formula",
    intervention: v.intervention
      ? { day: v.intervention.day, kind: v.intervention.kind, size: v.intervention.size_bp / SCALE, end: v.intervention.end ?? null }
      : null,
    sigmaScale: v.params.sigma_scale ? v.params.sigma_scale / SCALE : 1,
  };
}

/** 后端的行情序列 → 预测流水线的输入。 */
export function seriesInput(s: SeriesView): SeriesInput | null {
  if (s.last_close === null || s.daily.length === 0) return null;
  return { daily: s.daily, lastClose: s.last_close, monthly: s.monthly, monthlyLast: s.monthly_last, floor: s.floor, cap: s.cap };
}

/** 从预测簿条目还原记下时的序列（拟合窗口里的日线；上下限取当前的行情）。 */
export function seriesAtOrigin(e: ForecastEntryView, bounds: { floor: number; cap: number }): SeriesInput {
  return { daily: e.fitted_on, lastClose: e.origin, monthly: [], monthlyLast: null, floor: bounds.floor, cap: bounds.cap };
}
