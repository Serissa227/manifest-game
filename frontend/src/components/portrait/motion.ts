// 会动的头像（LiveFigure）与教程的小乌鸦共用的时序：不规则的眨眼、偶尔的镜片反光，
// 以及“页面不可见时暂停”“系统要求减少动态效果时静止”两条约束。
// 这些动画纯属装饰，用 Math.random 决定间隔（不进内核、不影响任何确定性的结果）。
import { useEffect, useState } from "react";

function reducedMotionQuery(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia("(prefers-reduced-motion: reduce)");
}

/** 系统设置了“减少动态效果”（prefers-reduced-motion: reduce）：会动的头像改为静止的一帧。jsdom 等没有 matchMedia 的环境视为未设置。 */
export function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(() => reducedMotionQuery()?.matches ?? false);
  useEffect(() => {
    const mq = reducedMotionQuery();
    if (!mq) return;
    const on = () => setReduce(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduce;
}

/** 页面是否不可见（最小化、切到别的标签页）：不可见时暂停动画与计时。 */
export function usePageHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.hidden);
  useEffect(() => {
    if (typeof document === "undefined") return;
    const on = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return hidden;
}

/** 眨眼的时长（毫秒）：闭眼帧停留 100–140 ms。 */
export const BLINK_MS: readonly [number, number] = [100, 140];
/** 两次眨眼之间的间隔（毫秒）：2.2–6.8 秒，不规则。 */
export const BLINK_GAP_MS: readonly [number, number] = [2200, 6800];
/** 连眨的概率（眨完紧接着再眨一次）。 */
export const DOUBLE_BLINK = 0.22;

/**
 * 不规则间隔的眨眼：返回此刻是否闭眼。enabled 为假（页面不可见、减少动态效果）时停止计时并保持睁眼。
 * rand 可以换成确定的序列（测试用）。
 */
export function useBlink(enabled: boolean, rand: () => number = Math.random): boolean {
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = (ms: number, fn: () => void) => {
      timer = setTimeout(() => {
        if (alive) fn();
      }, ms);
    };
    const span = ([a, b]: readonly [number, number]) => a + rand() * (b - a);
    const blink = (more: number) => {
      setClosed(true);
      later(span(BLINK_MS), () => {
        setClosed(false);
        if (more > 0) later(140 + rand() * 90, () => blink(more - 1));
        else wait();
      });
    };
    const wait = () => later(span(BLINK_GAP_MS), () => blink(rand() < DOUBLE_BLINK ? 1 : 0));
    wait();
    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
      setClosed(false);
    };
  }, [enabled, rand]);
  return enabled && closed;
}

/**
 * 偶尔的一道反光（眼镜镜片上扫过的高光）：每隔 7–15 秒计数加一，界面用计数作 key 重新播放一次 CSS 动画。
 * enabled 为假时不计时（计数保持不变）。
 */
export function useGlint(enabled: boolean, rand: () => number = Math.random): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      timer = setTimeout(() => {
        setCount((c) => c + 1);
        tick();
      }, 7000 + rand() * 8000);
    };
    tick();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [enabled, rand]);
  return count;
}
