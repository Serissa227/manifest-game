// 行情窗口的界面状态：当前分析的港口与商品、推算的方法与参数、分页、正在复盘的条目与修订草稿。
// 只在界面里，不进世界状态；记下的预测由后端的预测簿保存。
import { create } from "zustand";
import type { AdjustKind, AdjustReason } from "../forecast/adjust";
import { DEFAULT_SPEC, type ForecastSpec } from "../forecast/engine";

export type AnalysisView = "work" | "backtest" | "book";

/** 期限的上限（天）：实时行情 60 天；过时的行情可以多出过时的天数（告示板最多留 180 天的消息）。 */
export const MAX_LIVE_HORIZON = 60;
export const MAX_STORED_HORIZON = 240;
/** 推算用哪条线：日线（可以记下预测）或月线（看长期走势与周期，只供参考） */
export type SeriesMode = "daily" | "monthly";

/** 修订草稿：从复盘里点了某条调整建议，工作台按它重算，记下时作为修订版。 */
export interface RevisionDraft {
  revises: number;
  kind: AdjustKind;
  reason: AdjustReason;
  note: string;
}

export interface ForecastStore {
  loc: number | null;
  good: number | null;
  spec: ForecastSpec;
  horizon: number;
  mode: SeriesMode;
  /** 月线的期限（月） */
  monthlyHorizon: number;
  view: AnalysisView;
  reviewId: number | null;
  draft: RevisionDraft | null;
  /** 选定港口与商品（换港口或商品时回到推算页，清掉修订草稿） */
  select: (loc: number, good: number) => void;
  setSpec: (patch: Partial<ForecastSpec>) => void;
  setHorizon: (h: number) => void;
  setMode: (m: SeriesMode) => void;
  setMonthlyHorizon: (h: number) => void;
  setView: (v: AnalysisView) => void;
  openReview: (id: number | null) => void;
  /** 从复盘开始一份修订：载入建议的规格，切到推算页 */
  startDraft: (d: RevisionDraft, spec: ForecastSpec, loc: number, good: number) => void;
  setDraft: (patch: Partial<RevisionDraft>) => void;
  clearDraft: () => void;
}

/** 默认的方法：人人会的“公道价”。 */
export const START_SPEC: ForecastSpec = { ...DEFAULT_SPEC, method: "fair" };

export const useForecast = create<ForecastStore>((set) => ({
  loc: null,
  good: null,
  spec: START_SPEC,
  horizon: 15,
  mode: "daily",
  monthlyHorizon: 6,
  view: "work",
  reviewId: null,
  draft: null,
  select: (loc, good) =>
    set((s) => (s.loc === loc && s.good === good ? {} : { loc, good, draft: null, view: s.view === "book" ? "book" : s.view })),
  setSpec: (patch) => set((s) => ({ spec: { ...s.spec, ...patch } })),
  // 过时的行情（随船传递）期限可以多出过时的天数：这里只挡住离谱的值，上限由工作台与后端按行情的时效定
  setHorizon: (horizon) => set({ horizon: Math.max(1, Math.min(MAX_STORED_HORIZON, Math.round(horizon))) }),
  setMode: (mode) => set({ mode }),
  setMonthlyHorizon: (h) => set({ monthlyHorizon: Math.max(1, Math.min(12, Math.round(h))) }),
  setView: (view) => set({ view }),
  openReview: (reviewId) => set({ reviewId, view: "book" }),
  // 修订版按日线记下
  startDraft: (draft, spec, loc, good) => set({ draft, spec, loc, good, view: "work", mode: "daily" }),
  setDraft: (patch) => set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : {})),
  clearDraft: () => set({ draft: null }),
}));
