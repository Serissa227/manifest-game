// 历史的天平（docs/UI-CONTRACT.md I7）的纯逻辑：天平的区间换成条上的位置、事件排序、杠杆进度、战役链变量的折线。
import type { LeverView, TimelineEvent } from "../../ipc/types";

/** 天平的取值范围（数据里的天平是有符号整数，绝对值很少超过 60）：画条时夹在 ±SCALE。 */
export const SCALE = 60;

/** 区间 [lo, hi] → 条上的百分比位置（0 = 第二方占尽，100 = 第一方占尽；50 是持平）。 */
export function balanceSpan(lo: number, hi: number): { from: number; to: number; mid: number } {
  const f = (v: number) => Math.round(((Math.max(-SCALE, Math.min(SCALE, v)) + SCALE) / (2 * SCALE)) * 1000) / 10;
  const a = f(Math.min(lo, hi));
  const b = f(Math.max(lo, hi));
  return { from: a, to: b, mid: Math.round(((a + b) / 2) * 10) / 10 };
}

/**
 * 天平偏向哪一方（新界面写在天平下面）：区间整个在正数一边偏向第一方、整个在负数一边偏向第二方（契约：正数偏向第一方），
 * 跨过中线（或正好持平）时 side 为 null，写“难分高下”；情报不足时为 null，不写。
 */
export function balanceLean(b: { lo: number; hi: number; known: string }, first: string, second: string): { side: string | null } | null {
  if (b.known === "unknown") return null;
  if (Math.min(b.lo, b.hi) > 0) return { side: first };
  if (Math.max(b.lo, b.hi) < 0) return { side: second };
  return { side: null };
}

/** 事件排序：进行中在前（按剩余天数），然后将来的（按日期），最后揭晓过的（最近的在前）。 */
export function sortEvents(list: TimelineEvent[]): TimelineEvent[] {
  const rank = { active: 0, future: 1, resolved: 2 } as const;
  const key = (e: TimelineEvent) => (e.date ? e.date[0] * 10000 + e.date[1] * 100 + e.date[2] : Number.MAX_SAFE_INTEGER);
  return [...list].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    if (a.status === "resolved") return key(b) - key(a);
    return (a.days_left ?? Number.MAX_SAFE_INTEGER) - (b.days_left ?? Number.MAX_SAFE_INTEGER) || key(a) - key(b);
  });
}

/** 杠杆的进度（0–1）与你占的份额（0–1）。 */
export function leverShare(l: Pick<LeverView, "progress" | "yours">): { done: number; yours: number } {
  const max = Math.max(1, l.progress.max);
  return { done: Math.min(1, l.progress.points / max), yours: Math.min(1, l.yours / max) };
}

/** 战役链变量的折线（SVG 路径）：x 按年份在 [y0, y1] 里、y 按 0–100 翻转；宽高按给定尺寸。 */
export function driftPath(points: [number, number][], w: number, h: number, y0: number, y1: number): string {
  if (points.length === 0) return "";
  const span = Math.max(1, y1 - y0);
  return points
    .map(([year, v], i) => {
      const x = ((year - y0) / span) * w;
      const y = h - (Math.max(0, Math.min(100, v)) / 100) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
