// 教程的“圈出界面上的一个真实元素”（从 Tutorial.tsx 拆出，R10-Q02）：新手教程每一步用它，任务的“去”也用它（Spotlight.tsx）。
// 目标是 CSS 选择器，给一串时取第一个看得见、有大小的；看不见（display: none、visibility: hidden、全透明）的不圈。

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 目标：一个选择器或一串（取第一个看得见的）。 */
export type SpotTarget = string | readonly string[];

export function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.left - b.left) < 1 && Math.abs(a.top - b.top) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
}

/**
 * 元素是否真的看得见：自身或祖先没有被 display: none、visibility: hidden 或完全透明藏起来。
 * 航海图层切走时只是用 visibility 隐藏（MapView 始终挂载），出港确认框仍在页面上、量得出位置——不能圈它。
 */
export function visible(el: Element): boolean {
  const check = (el as Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean }).checkVisibility;
  if (typeof check === "function") {
    return check.call(el, { checkVisibilityCSS: true, visibilityProperty: true, checkOpacity: true, opacityProperty: true });
  }
  for (let e: Element | null = el; e; e = e.parentElement) {
    const s = window.getComputedStyle(e);
    if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse" || s.opacity === "0") return false;
    if (e.classList.contains("is-hidden")) return false;
  }
  return true;
}

/** 这一步的目标元素（第一个看得见、有大小的）。 */
export function targetEl(selector: SpotTarget | undefined): Element | null {
  if (!selector) return null;
  for (const one of typeof selector === "string" ? [selector] : selector) {
    const el = document.querySelector(one);
    if (!el || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/** 量出目标元素的位置（不存在、没有大小或看不见时为 null）。给一串选择器时取第一个看得见的。 */
export function measure(selector: SpotTarget | undefined): Box | null {
  const el = targetEl(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** 目标整个在屏幕外（矮屏上交易所的“买满”在窗口下面）：把它滚进视野。滚了返回 true。 */
export function reveal(selector: SpotTarget | undefined): boolean {
  const el = targetEl(selector) as (Element & { scrollIntoView?: (o?: ScrollIntoViewOptions) => void }) | null;
  if (!el || typeof el.scrollIntoView !== "function") return false;
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight || 800;
  if (r.bottom > 0 && r.top < vh) return false;
  el.scrollIntoView({ block: r.height > vh * 0.6 ? "start" : "center", behavior: "smooth" });
  return true;
}
