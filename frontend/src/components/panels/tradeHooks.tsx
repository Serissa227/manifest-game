// 交易类面板共用的钩子与文字工具（小部件在 tradeKit.tsx）：
// - useFlash：成交的行闪一下；
// - useQuotes：成交单各行的精确询价（改了件数稍等片刻再问；概览更新时限流重问，高倍速下不刷屏也不丢结果）；
// - slotted / slot：把界面文字里的占位符换成组件（例如会滚动的数字），文字仍从字符串表取，中英文照旧一一对应。
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useWorldVersion } from "../../hooks/useView";
import { api } from "../../ipc/api";
import type { TradeQuote } from "../../ipc/types";
import { quoteKey, type CartLine } from "./trade";

/** 成交的行闪一下：返回每种商品最近一次闪的编号（CSS 按奇偶换一个动画名，连续成交也能重新播放）与触发函数。 */
export function useFlash(): [Record<number, number>, (goods: readonly number[]) => void] {
  const [flash, setFlash] = useState<Record<number, number>>({});
  const seq = useRef(0);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((id) => window.clearTimeout(id));
  }, []);
  const fire = useCallback((goods: readonly number[]) => {
    if (goods.length === 0) return;
    seq.current += 1;
    const n = seq.current;
    setFlash((f) => ({ ...f, ...Object.fromEntries(goods.map((g) => [g, n])) }));
    timers.current.push(
      window.setTimeout(() => {
        setFlash((f) => Object.fromEntries(Object.entries(f).filter(([, v]) => v !== n)));
      }, 1300),
    );
  }, []);
  return [flash, fire];
}

/** 改了件数后稍等多久再询价；概览更新（价格每天在变）引起的重问至少隔多久。 */
const QUOTE_DEBOUNCE = 120;
const QUOTE_THROTTLE = 800;

/**
 * 成交单各行的精确询价（与内核同一套计算，含成交量对价格的冲击与税）：键为 quoteKey（方向、商品、件数）。
 * 件数变了稍等 120 毫秒再问；只是世界的状态变了（每天的价格变化、别的操作）时至多每 0.8 秒重问一次——高倍速下不刷屏，
 * 也不会因为下一天又到了就把刚问到的结果作废（只有成交单变了，旧的结果才不用）。只改了倍速时不重问。
 */
export function useQuotes(loc: number, lines: readonly CartLine[], enabled: boolean): Record<string, TradeQuote> {
  const version = useWorldVersion();
  const [quotes, setQuotes] = useState<Record<string, TradeQuote>>({});
  const keys = enabled ? lines.map(quoteKey).join("|") : "";
  const latest = useRef({ keys, lines, loc });
  const last = useRef({ keys: "", at: 0 });
  const pending = useRef<{ id: number; keys: string } | null>(null);
  useEffect(() => {
    latest.current = { keys, lines, loc };
  });
  useEffect(
    () => () => {
      if (pending.current) window.clearTimeout(pending.current.id);
      pending.current = null;
    },
    [],
  );
  useEffect(() => {
    if (keys === "") {
      if (pending.current) window.clearTimeout(pending.current.id);
      pending.current = null;
      last.current.keys = "";
      setQuotes((q) => (Object.keys(q).length === 0 ? q : {}));
      return;
    }
    // 已经约好了同一张成交单的询价：到时候用的就是最新的价格，不用再约
    if (pending.current && pending.current.keys === keys) return;
    if (pending.current) window.clearTimeout(pending.current.id);
    const changed = keys !== last.current.keys;
    const wait = changed ? QUOTE_DEBOUNCE : Math.max(0, QUOTE_THROTTLE - (Date.now() - last.current.at));
    const id = window.setTimeout(() => {
      pending.current = null;
      const req = latest.current;
      last.current = { keys: req.keys, at: Date.now() };
      void Promise.all(
        req.lines.map((l) =>
          api
            .quote(req.loc, l.good, l.side, l.qty)
            .then((q) => [quoteKey(l), q] as const)
            .catch(() => null),
        ),
      ).then((res) => {
        // 成交单在询价期间变了：这批结果不用（新的询价已经约好）
        if (latest.current.keys !== req.keys) return;
        const next: Record<string, TradeQuote> = {};
        for (const r of res) if (r) next[r[0]] = r[1];
        setQuotes(next);
      });
    }, wait);
    pending.current = { id, keys };
  }, [loc, keys, version]);
  return quotes;
}

/** 最近的可滚动的祖先（功能窗口的内容区）。 */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = window.getComputedStyle(p).overflowY;
    if (o === "auto" || o === "scroll") return p;
  }
  return null;
}

/**
 * 贴边的表头与账台：量出所在滚动区的上下内边距，写成 --mk-stick-top / --mk-stick-bottom（负值），
 * 让贴顶的表头、贴底的账台正好贴到窗口边上，而不是离边一段内边距、让后面的行从缝里露出来。
 * 窗口的内边距改了（例如手机上另有样式）也跟着变。返回给根元素用的回调 ref。
 */
export function useStickyInsets(): (el: HTMLElement | null) => void {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((el: HTMLElement | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    const scroller = scrollParent(el);
    if (!scroller) return;
    const apply = () => {
      const s = window.getComputedStyle(scroller);
      el.style.setProperty("--mk-stick-top", `-${s.paddingTop || "0px"}`);
      el.style.setProperty("--mk-stick-bottom", `-${s.paddingBottom || "0px"}`);
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(scroller);
    cleanup.current = () => ro.disconnect();
  }, []);
}

/**
 * 把一条带占位符的界面文字拆开，占位符换成组件（例如把“现金 {cash}”里的金额换成会滚动的数字）。
 * text 由 t() 取出、占位符先填成记号 slot(名字)。
 */
export function slotted(text: string, slots: Record<string, ReactNode>): ReactNode[] {
  return text.split("\u0001").map((part, i) => (i % 2 === 1 ? <span key={i}>{slots[part]}</span> : part));
}

/** slotted 用的占位记号。 */
export function slot(name: string): string {
  return `\u0001${name}\u0001`;
}
