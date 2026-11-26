// 视口判断（网页自适应，决定见 docs/DECISIONS.md“网页自适应”）：按窗口的宽高与指针类型分四种布局，
// 游戏外壳据此换结构（手机上顶栏收起、命令栏变成底部导航、功能窗口变成整页），样式表里的 @media 用同样的断点。
//
// - short：矮窗口（高 < 500，手机横屏）——顶栏一行，命令栏竖在左侧，功能窗口整页；
// - phone：窄窗口（宽 < 720，手机竖屏）——顶栏一行，底部导航 + “更多”，功能窗口整页；
// - tablet：宽 < 1180（平板、小笔记本）——顶栏一行、次要信息收进菜单，命令栏一行放不下的收进“更多”；
// - desktop：其余（笔记本到大屏）——原来的布局。
// 另外几个独立的判断：coarse（主要指针是手指，可点的目标放大到 40 px 以上、悬停提示改为点按）、wide（大屏，排版加大）、
// narrow（宽 < 1000：竖放的平板上功能窗口也铺满舞台，见 windowCovers）。
//
// 没有 matchMedia 的环境（jsdom 等）一律按桌面、鼠标处理：原有的组件测试不受影响；测试新行为时用 test/viewport.ts 模拟。
import { useSyncExternalStore } from "react";

export type Layout = "phone" | "short" | "tablet" | "desktop";

/** 各布局的媒体查询（与 styles/ 里的 @media 一致）。 */
export const VIEWPORT_QUERIES = {
  short: "(max-height: 499px)",
  phone: "(max-width: 719px)",
  tablet: "(max-width: 1179px)",
  coarse: "(pointer: coarse)",
  wide: "(min-width: 1800px) and (min-height: 1000px)",
  narrow: "(max-width: 999px)",
} as const;

export interface Viewport {
  layout: Layout;
  /** 主要指针是手指（触屏） */
  coarse: boolean;
  /** 大屏（宽 ≥ 1800 且高 ≥ 1000） */
  wide: boolean;
  /** 宽 < 1000（竖放的平板与更窄） */
  narrow: boolean;
}

const DESKTOP: Viewport = { layout: "desktop", coarse: false, wide: false, narrow: false };

type MatchMedia = (query: string) => MediaQueryList;

function matcher(): MatchMedia | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  return window.matchMedia.bind(window) as MatchMedia;
}

/** 按媒体查询的结果决定布局（纯函数，测试直接用）。矮窗口优先于窄窗口：640×360 的横屏手机按矮窗口排。 */
export function layoutOf(m: { short: boolean; phone: boolean; tablet: boolean }): Layout {
  if (m.short) return "short";
  if (m.phone) return "phone";
  if (m.tablet) return "tablet";
  return "desktop";
}

let cache: Viewport = DESKTOP;

/** 此刻的视口（内容不变时返回同一个对象，供 useSyncExternalStore 比较）。 */
export function readViewport(): Viewport {
  const mm = matcher();
  if (!mm) {
    cache = DESKTOP;
    return cache;
  }
  const q = (k: keyof typeof VIEWPORT_QUERIES) => {
    try {
      return !!mm(VIEWPORT_QUERIES[k]).matches;
    } catch {
      return false;
    }
  };
  const next: Viewport = {
    layout: layoutOf({ short: q("short"), phone: q("phone"), tablet: q("tablet") }),
    coarse: q("coarse"),
    wide: q("wide"),
    narrow: q("narrow"),
  };
  if (next.layout !== cache.layout || next.coarse !== cache.coarse || next.wide !== cache.wide || next.narrow !== cache.narrow) cache = next;
  return cache;
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let frame = 0;
  const kick = () => {
    if (frame) return;
    const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (f: () => void) => setTimeout(f, 16) as unknown as number;
    frame = raf(() => {
      frame = 0;
      onChange();
    });
  };
  const mm = matcher();
  const lists: MediaQueryList[] = [];
  if (mm) {
    for (const query of Object.values(VIEWPORT_QUERIES)) {
      try {
        const l = mm(query);
        l.addEventListener?.("change", onChange);
        lists.push(l);
      } catch {
        // 不认识的查询：只靠 resize
      }
    }
  }
  window.addEventListener("resize", kick);
  window.addEventListener("orientationchange", kick);
  return () => {
    for (const l of lists) l.removeEventListener?.("change", onChange);
    window.removeEventListener("resize", kick);
    window.removeEventListener("orientationchange", kick);
    if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
  };
}

/** 当前视口：布局、是否触屏、是否大屏。窗口大小或指针变化时重新渲染。 */
export function useViewport(): Viewport {
  return useSyncExternalStore(subscribe, readViewport, () => DESKTOP);
}

/** 当前布局。 */
export function useLayout(): Layout {
  return useViewport().layout;
}

/** 手机上的紧凑外壳（竖屏或横屏）：顶栏一行、功能窗口整页。 */
export function isCompact(layout: Layout): boolean {
  return layout === "phone" || layout === "short";
}

/** 功能窗口打开时会整个盖住舞台：手机上（整页），以及竖放的平板（宽 < 1000，窗口铺满舞台）。这时开局不自动打开窗口、教程要看街景时先收起它。 */
export function windowCovers(v: Viewport): boolean {
  return isCompact(v.layout) || (v.layout === "tablet" && v.narrow);
}
