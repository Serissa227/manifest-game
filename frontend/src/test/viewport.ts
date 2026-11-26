// 测试用的视口模拟（网页自适应）：按给定的宽高与指针类型回答 matchMedia 的查询，并触发 resize。
// 只认本项目用到的几种写法：(min|max-width|height: Npx)、and 与逗号（或）、(pointer: coarse)、(hover: none)、(prefers-reduced-motion: reduce)。
// jsdom 本身没有 matchMedia（原有的测试一律按桌面、鼠标）；用完调 resetViewport() 还原。
import { act } from "@testing-library/react";
import { vi } from "vitest";

export interface FakeViewport {
  width: number;
  height: number;
  /** 主要指针是手指 */
  coarse?: boolean;
  reducedMotion?: boolean;
}

function one(cond: string, v: FakeViewport): boolean {
  const m = /\((min|max)-(width|height):\s*(\d+)px\)/.exec(cond);
  if (m) {
    const value = m[2] === "width" ? v.width : v.height;
    return m[1] === "min" ? value >= Number(m[3]) : value <= Number(m[3]);
  }
  if (/\(pointer:\s*coarse\)/.test(cond)) return !!v.coarse;
  if (/\(hover:\s*none\)/.test(cond)) return !!v.coarse;
  if (/\(prefers-reduced-motion:\s*reduce\)/.test(cond)) return !!v.reducedMotion;
  return false;
}

/** 媒体查询在这个视口下是否成立。 */
export function queryMatches(query: string, v: FakeViewport): boolean {
  return query.split(",").some((part) =>
    part
      .split(/\band\b/)
      .map((c) => c.trim())
      .filter(Boolean)
      .every((c) => one(c, v)),
  );
}

const JSDOM_SIZE = { width: 1024, height: 768 };

function setSize(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
}

/** 模拟一个视口：matchMedia 按它回答，窗口大小跟着改，并发出 resize（已挂上的组件随之重排）。 */
export function mockViewport(v: FakeViewport): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: queryMatches(query, v),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  setSize(v.width, v.height);
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

/** 还原成 jsdom 的缺省（没有 matchMedia，1024 × 768）。 */
export function resetViewport(): void {
  vi.unstubAllGlobals();
  setSize(JSDOM_SIZE.width, JSDOM_SIZE.height);
}

/** 手机竖屏（iPhone 12–15 的 390 × 844，触屏）。 */
export const PHONE: FakeViewport = { width: 390, height: 844, coarse: true };
/** 手机横屏。 */
export const PHONE_LANDSCAPE: FakeViewport = { width: 844, height: 390, coarse: true };
/** 竖放的平板。 */
export const TABLET: FakeViewport = { width: 768, height: 1024, coarse: true };
/** 笔记本。 */
export const LAPTOP: FakeViewport = { width: 1366, height: 768 };
