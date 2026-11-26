// 动画计时：按固定帧率驱动像素动画。
import { useEffect, useRef } from "react";

/** 按固定帧率调用回调（页面隐藏时暂停）。回调收到从 0 开始递增的帧号。 */
export function useFrames(fps: number, onFrame: (frame: number) => void, enabled = true) {
  const cb = useRef(onFrame);
  useEffect(() => {
    cb.current = onFrame;
  }, [onFrame]);
  useEffect(() => {
    if (!enabled || typeof requestAnimationFrame === "undefined") return;
    let raf = 0;
    let frame = 0;
    let last = -Infinity;
    const interval = 1000 / Math.max(1, fps);
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (typeof document !== "undefined" && document.hidden) return;
      if (now - last < interval) return;
      last = now;
      cb.current(frame++);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [fps, enabled]);
}
