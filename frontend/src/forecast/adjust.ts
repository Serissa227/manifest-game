// 调整预测曲线（docs/ECONOMY.md 4.8）：根据诊断与预测期内的事件给出修订建议；修订版从今天的数据重新预测，
// 记下时必须写明依据（事件 / 情报 / 自己的判断）。到期后比较修订版与原预测的误差，告诉商家这次调整是否真的有用
// （FPP3：判断性调整只有掌握模型以外的信息时才有帮助）。

import type { AdjustBasisView, ForecastEntryView, ForecastMark } from "../ipc/types";
import type { ForecastSpec } from "./engine";
import type { Finding } from "./diagnose";
import type { Evaluation } from "./monitor";

export type AdjustKind = AdjustBasisView["kind"];
export type AdjustReason = AdjustBasisView["reason"];

/** 调整的依据（界面的下拉选项顺序）。 */
export const REASONS_ALL: readonly AdjustReason[] = ["event", "intel", "judgment"];

export interface Suggestion {
  kind: AdjustKind;
  /** 默认的依据（界面上可改） */
  reason: AdjustReason;
  spec: ForecastSpec;
  /** 相关的日期、幅度等（显示用） */
  day?: number;
  end?: number | null;
  size?: number;
}

/** 需求类的事件效果（影响价格的方向与需求系数一致）。 */
const DEMAND_EFFECTS = ["good_demand", "demand_shift", "location_demand"];

export interface SuggestInput {
  /** 麾下有算学奇才：才给出干预修正与季节修正（不给时视为有） */
  advanced?: boolean;
  spec: ForecastSpec;
  findings: readonly Finding[];
  marks: readonly ForecastMark[];
  evaluation: Evaluation;
  /** 今天（修订从最近一个收盘日起算） */
  today: number;
  /** 流行的需求加成（万分之一） */
  popularBonusBp: number;
  /** 当前还在进行的流行截止日 */
  popularUntil: number | null;
  /** 月线是否够做季节修正（满 12 个月） */
  seasonalAvailable: boolean;
  /** 起点到今天之间是否跨过季节交替 */
  seasonChanged: boolean;
  /** 预测各步的平均标准差（由 95% 区间推回） */
  meanSd: number;
}

/** 修订建议（按常用程度排列）。 */
export function suggestAdjustments(input: SuggestInput): Suggestion[] {
  const { spec, findings, marks, evaluation: ev, today } = input;
  const base: ForecastSpec = { ...spec, intervention: null };
  const out: Suggestion[] = [{ kind: "refit", reason: "judgment", spec: { ...spec } }];
  const hindsight = findings.find((f) => f.key === "hindsight");
  if (hindsight?.method) out.push({ kind: "switch", reason: "judgment", spec: { ...base, method: hindsight.method, params: {} } });

  const advanced = input.advanced ?? true;
  // 干预：还在进行的流行或需求事件——价格暂时偏高，到期后回落（脉冲）；否则按检测到的跳变做阶跃
  if (!advanced) {
    // 没有算学奇才：不做干预修正
  } else if (input.popularUntil !== null && input.popularUntil > today) {
    const start = marks.find((m) => m.kind === "popular")?.day ?? today - 1;
    const size = input.popularBonusBp / 10_000;
    out.push({ kind: "intervention", reason: "event", spec: { ...base, intervention: { day: start, kind: "pulse", size, end: input.popularUntil } }, day: start, end: input.popularUntil, size });
  } else {
    const ev = marks.find((m) => (m.kind === "event" || m.kind === "composed") && m.effect && DEMAND_EFFECTS.includes(m.effect) && (m.end ?? 0) > today && m.mult_bp);
    if (ev) {
      const size = (ev.mult_bp as number) / 10_000 - 1;
      out.push({ kind: "intervention", reason: "event", spec: { ...base, intervention: { day: ev.day, kind: "pulse", size, end: ev.end ?? null } }, day: ev.day, end: ev.end, size });
    } else {
      const jump = findings.find((f) => f.key === "jump");
      if (jump?.day !== undefined && jump.value !== undefined) {
        const size = jump.value / 100;
        out.push({ kind: "intervention", reason: "judgment", spec: { ...base, intervention: { day: jump.day, kind: "step", size, end: null } }, day: jump.day, size });
      }
    }
  }

  // 季节修正
  if (advanced && input.seasonalAvailable && input.seasonChanged && !spec.seasonal) out.push({ kind: "seasonal", reason: "judgment", spec: { ...base, seasonal: true } });

  // 剔除异常期：预测期内的事件期间不参与拟合
  const eventDays = new Set<number>();
  for (const m of marks) {
    if (m.kind !== "event" && m.kind !== "composed") continue;
    for (let d = m.day; d < Math.min(m.end ?? today, today); d++) eventDays.add(d);
  }
  if (eventDays.size > 0) {
    const excluded = [...new Set([...spec.excluded, ...eventDays])].sort((a, b) => a - b);
    out.push({ kind: "exclude", reason: "event", spec: { ...base, excluded } });
  }

  // 区间校准：实际误差比预测的标准差大时按比例放宽
  const realized = ev.rmse;
  if (ev.n >= 3 && input.meanSd > 0 && realized > 1.2 * input.meanSd) {
    const scale = Math.min(5, realized / input.meanSd);
    out.push({ kind: "calibrate", reason: "judgment", spec: { ...spec, sigmaScale: Math.round(scale * 100) / 100 }, size: scale });
  }
  return out;
}

export interface RevisionReport {
  /** 共同观测的天数 */
  days: number;
  original: number;
  revised: number;
  /** 修订版比原预测的 RMSE 小多少（百分比；负数表示更差） */
  improvement: number;
}

/** 比较修订版与原预测在共同观测日上的误差。 */
export function compareRevision(original: ForecastEntryView, revised: ForecastEntryView): RevisionReport | null {
  const orig = new Map<number, [number, number]>();
  original.track.forEach((t, i) => orig.set(t.day, [t.price, original.path[i].mean]));
  let so = 0;
  let sr = 0;
  let n = 0;
  revised.track.forEach((t, i) => {
    const o = orig.get(t.day);
    if (!o) return;
    so += (o[0] - o[1]) ** 2;
    sr += (t.price - revised.path[i].mean) ** 2;
    n++;
  });
  if (n === 0) return null;
  const ro = Math.sqrt(so / n);
  const rr = Math.sqrt(sr / n);
  return { days: n, original: ro, revised: rr, improvement: ro > 0 ? 100 * (1 - rr / ro) : 0 };
}
