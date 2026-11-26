// 按需圈出界面上的一处（R10-Q02）的状态：谁要圈、圈哪里、圈多久。画在 Spotlight.tsx。
import { create } from "zustand";
import type { SpotTarget } from "./spot";

export interface SpotState {
  target: SpotTarget | null;
  /** 圈出时旁边的一小行字（没有为 null） */
  label: string | null;
  /** 第几次请求（同一个目标再点一次也重新开始） */
  seq: number;
  ms: number;
}

export const useSpot = create<SpotState>(() => ({ target: null, label: null, seq: 0, ms: 0 }));

/** 圈出的缺省时长（毫秒）。 */
const SPOT_MS = 4200;

/** 圈出一处（给一串选择器时取第一个看得见的）。label 是旁边的一小行字。 */
export function spotlight(target: SpotTarget, opts: { label?: string | null; ms?: number } = {}): void {
  useSpot.setState((s) => ({ target, label: opts.label ?? null, seq: s.seq + 1, ms: opts.ms ?? SPOT_MS }));
}

/** 收起（测试、换外壳）。 */
export function clearSpotlight(): void {
  useSpot.setState({ target: null, label: null });
}
