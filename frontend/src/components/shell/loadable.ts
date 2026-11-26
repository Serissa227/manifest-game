// 按需加载的界面（性能商议 2026-10-07 第 1 条：主界面、养成主界面与各功能面板拆成单独的代码块）。
// - React.lazy 的包装：代码已经到了（预先加载过、或者第一次加载完）就直接渲染，不再经过一帧 Suspense 的占位——不闪；
// - preload()：预先加载（开局画面上空闲时、指针移到命令栏的按钮上时）；
// - 下载失败（断网、慢网超时）时由 LoadBoundary（LoadBoundary.tsx）显示“没能载入”与“重试”，重试会重新下载，不会一直白屏。
import { createElement, lazy, type ComponentType } from "react";

export interface Loadable<P> {
  Component: ComponentType<P>;
  preload: () => Promise<unknown>;
}

/** 下载失败、等着重试的：重试时换一个新的 lazy（React.lazy 失败过一次就一直失败），由 LoadBoundary 的“重试”调用。 */
const failed = new Set<() => void>();

/** 让下载失败过的按需界面在下一次渲染时重新下载（LoadBoundary 的“重试”）。 */
export function retryFailedLoads(): void {
  const list = [...failed];
  failed.clear();
  for (const f of list) f();
}

/** 测试环境里登记的预先加载（test/setup.ts 在每个测试文件开始前全部加载：与拆分之前一样，代码在用例开始前就在）。 */
type PreloadRegistry = { __manifestPreloads?: (() => Promise<unknown>)[] };

export function loadable<P extends object>(load: () => Promise<{ default: ComponentType<P> }>): Loadable<P> {
  let loaded: ComponentType<P> | null = null;
  let pending: Promise<{ default: ComponentType<P> }> | null = null;
  const preload = () => {
    pending ??= load().then(
      (m) => {
        loaded = m.default;
        return m;
      },
      (e: unknown) => {
        // 失败了：等玩家点“重试”再重新下载（不自动重试：断网时不会一直刷请求）
        failed.add(() => {
          pending = null;
          Lazy = lazy(preload);
        });
        throw e;
      },
    );
    return pending;
  };
  let Lazy = lazy(preload);
  function Loaded(props: P) {
    return createElement(loaded ?? Lazy, props);
  }
  if (import.meta.env.MODE === "test") ((globalThis as PreloadRegistry).__manifestPreloads ??= []).push(() => preload().catch(() => {}));
  return { Component: Loaded, preload };
}

