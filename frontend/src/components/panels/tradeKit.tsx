// 交易类面板共用的小部件（交易所、补给、仓库装卸、招募船员都用；钩子与文字工具在 tradeHooks.tsx）：
// - QtyStepper：数量加减。按钮可长按连发（越按越快），Shift + 点击一次 10 件；输入框里 ↑↓ 加减（Shift ×10）、PgUp/PgDn ±10、
//   Home / End 到 0 / 最多；获得焦点后滚轮加减；鼠标在输入框上左右拖动也能调（点一下则全选、直接打字）。
// - RollingNumber：数字变化时滚动到新值（约 0.45 秒；系统要求减少动态效果或测试环境里直接跳到新值）。
// - Sparkline：价格走势小图；LoadBar：装载条（成交后的装载用浅色标出）。
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { usePrefersReducedMotion } from "../portrait/motion";

/** 长按多久开始连发、连发的间隔（毫秒）。 */
const REPEAT_DELAY = 380;
const REPEAT_EVERY = 70;
/** 拖动多少像素算一件。 */
const SCRUB_PX = 6;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 长按连发：按住超过 REPEAT_DELAY 后每 REPEAT_EVERY 连发一次，连发十几次后每次 5 件、三十次后每次 10 件。连发过就吞掉随后的那次点击。 */
function useRepeat(step: (times: number) => boolean) {
  const timer = useRef<number | undefined>(undefined);
  const fired = useRef(false);
  const stepRef = useRef(step);
  useEffect(() => {
    stepRef.current = step;
  });
  const stop = useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  useEffect(() => stop, [stop]);
  const start = (e: PointerEvent) => {
    if (e.button !== 0) return;
    stop();
    fired.current = false;
    let count = 0;
    const tick = () => {
      count += 1;
      fired.current = true;
      // 到头了（最多或 0）就停下
      if (!stepRef.current(count > 30 ? 10 : count > 12 ? 5 : 1)) {
        stop();
        return;
      }
      timer.current = window.setTimeout(tick, REPEAT_EVERY);
    };
    timer.current = window.setTimeout(tick, REPEAT_DELAY);
    // 按钮在连发中变成禁用（到头）时收不到抬起事件：在窗口上兜底
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
  };
  return {
    handlers: {
      onPointerDown: start,
      onPointerUp: stop,
      onPointerLeave: stop,
      onPointerCancel: stop,
      onContextMenu: (e: MouseEvent) => e.preventDefault(),
    },
    /** 这次点击是长按连发之后的抬起：不再另加一次 */
    swallow: () => {
      const f = fired.current;
      fired.current = false;
      return f;
    },
  };
}

export interface QtyStepperProps {
  value: number;
  max: number;
  onChange: (v: number) => void;
  /** 输入框的可访问名称（例如“谷物 买入数量”） */
  label: string;
  decLabel: string;
  incLabel: string;
  disabled?: boolean;
  testId?: string;
  className?: string;
}

export function QtyStepper({ value, max, onChange, label, decLabel, incLabel, disabled, testId, className }: QtyStepperProps) {
  const input = useRef<HTMLInputElement | null>(null);
  const v = clamp(value, 0, Math.max(0, max));
  // 连发与滚轮在一次渲染之间可能触发多次：以最新的值为准
  const live = useRef({ v, max, onChange });
  useLayoutEffect(() => {
    live.current = { v, max, onChange };
  });
  const bump = useCallback((d: number): boolean => {
    const { v: cur, max: hi, onChange: set } = live.current;
    const next = clamp(cur + d, 0, Math.max(0, hi));
    if (next === cur) return false;
    live.current.v = next;
    set(next);
    return true;
  }, []);
  const dec = useRepeat((n) => bump(-n));
  const inc = useRepeat((n) => bump(n));

  // 滚轮：只在输入框有焦点时加减（不然滚动列表时经过这里会误改数量）；React 的滚轮监听是被动的，这里用原生监听才能阻止页面滚动
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== el || el.disabled) return;
      const d = e.deltaY || e.deltaX;
      if (!d) return;
      e.preventDefault();
      bump((d < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [bump]);

  // 鼠标在输入框上左右拖动调数量；没拖动就当点击：聚焦并全选，直接打字替换
  const scrub = useRef<{ x: number; v: number; active: boolean } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLInputElement>) => {
    if (disabled || e.pointerType !== "mouse" || e.button !== 0 || document.activeElement === e.currentTarget) return;
    e.preventDefault();
    scrub.current = { x: e.clientX, v, active: false };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // 测试环境或已松开的指针：不捕获也能用
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLInputElement>) => {
    const s = scrub.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (!s.active && Math.abs(dx) < 4) return;
    s.active = true;
    const next = clamp(s.v + Math.trunc(dx / SCRUB_PX) * (e.shiftKey ? 10 : 1), 0, Math.max(0, max));
    if (next !== live.current.v) {
      live.current.v = next;
      onChange(next);
    }
  };
  const onPointerUp = (e: PointerEvent<HTMLInputElement>) => {
    const s = scrub.current;
    scrub.current = null;
    try {
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    } catch {
      // 没有捕获过
    }
    if (s && !s.active) {
      e.currentTarget.focus();
      e.currentTarget.select();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const big = e.shiftKey ? 10 : 1;
    let handled = true;
    switch (e.key) {
      case "ArrowUp":
        bump(big);
        break;
      case "ArrowDown":
        bump(-big);
        break;
      case "PageUp":
        bump(10);
        break;
      case "PageDown":
        bump(-10);
        break;
      case "Home":
        onChange(0);
        break;
      case "End":
        onChange(Math.max(0, max));
        break;
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const cls = ["qty-stepper", v > 0 ? "has-qty" : "", className ?? ""].filter(Boolean).join(" ");
  return (
    <span className={cls} data-testid={testId}>
      <button
        type="button"
        className="qty-btn qty-dec"
        tabIndex={-1}
        aria-label={decLabel}
        title={decLabel}
        disabled={disabled || v <= 0}
        onClick={(e) => {
          if (!dec.swallow()) bump(-(e.shiftKey ? 10 : 1));
        }}
        {...dec.handlers}
      >
        −
      </button>
      <input
        ref={input}
        type="number"
        className="qty-input"
        inputMode="numeric"
        aria-label={label}
        min={0}
        max={Math.max(0, max)}
        step={1}
        value={v}
        disabled={disabled}
        onChange={(e) => {
          const n = Math.trunc(Number(e.target.value));
          onChange(clamp(Number.isFinite(n) ? n : 0, 0, Math.max(0, max)));
        }}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          scrub.current = null;
        }}
      />
      <button
        type="button"
        className="qty-btn qty-inc"
        tabIndex={-1}
        aria-label={incLabel}
        title={incLabel}
        disabled={disabled || v >= max}
        onClick={(e) => {
          if (!inc.swallow()) bump(e.shiftKey ? 10 : 1);
        }}
        {...inc.handlers}
      >
        +
      </button>
    </span>
  );
}

/** 能不能放动画：系统没要求减少动态效果，且环境支持（测试环境 jsdom 没有 matchMedia，数字直接跳到新值，结果确定）。 */
function useMotion(): boolean {
  const reduce = usePrefersReducedMotion();
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && !reduce;
}

/** 数字变化时从旧值滚动到新值（缓出，约 0.45 秒）。 */
export const RollingNumber = memo(function RollingNumber({ value, format, className }: { value: number; format: (v: number) => string; className?: string }) {
  const motion = useMotion();
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    if (!motion || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const frame = (now: number) => {
      const k = Math.min(1, (now - start) / 450);
      const eased = 1 - Math.pow(1 - k, 3);
      const cur = Math.round(a + (value - a) * eased);
      from.current = cur;
      setShown(cur);
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [value, motion]);
  const dir = shown === value ? "" : value > shown ? " rolling-up" : " rolling-down";
  return <span className={`rolling${dir}${className ? ` ${className}` : ""}`}>{format(motion ? shown : value)}</span>;
});

/** 价格走势小图（对辅助技术隐藏；涨跌另有文字）。 */
export function Sparkline({ data, width = 52, height = 16 }: { data: readonly number[]; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const span = hi - lo || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * (width - 2) + 1, height - 2 - ((v - lo) / span) * (height - 4)] as const);
  const dir = data[data.length - 1] > data[0] ? "rise" : data[data.length - 1] < data[0] ? "fall" : "flat";
  const last = pts[pts.length - 1];
  return (
    <svg className={`spark spark-${dir}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <polyline points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="1.8" fill="currentColor" />
    </svg>
  );
}

/** 装载条：已装的部分；给了 after 时标出成交后的装载（多出来的用斜纹、腾出来的用虚框）。 */
export function LoadBar({ used, capacity, after }: { used: number; capacity: number; after?: number }) {
  const pct = (v: number) => `${capacity > 0 ? clamp((v / capacity) * 100, 0, 100) : 0}%`;
  const next = after ?? used;
  const full = next > capacity;
  return (
    <span className={full ? "load-bar over" : "load-bar"} aria-hidden="true">
      <i className="load-now" style={{ width: pct(Math.min(used, next)) }} />
      {next > used && <i className="load-add" style={{ left: pct(used), width: pct(next - used) }} />}
      {next < used && <i className="load-free" style={{ left: pct(next), width: pct(used - next) }} />}
    </span>
  );
}
