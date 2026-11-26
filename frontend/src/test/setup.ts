import "@testing-library/jest-dom/vitest";
import { clearMocks } from "@tauri-apps/api/mocks";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll, vi } from "vitest";
import { applyUi, useUiVersion } from "../ui/uiMode";

// 界面风格：缺省已改为海图室（v2，ui/uiMode.ts）。改版前的测试都是照经典像素（v1）的 DOM 写的，
// 测试环境开头当作“本机选了经典像素”；海图室的测试各自切到 v2、结束时切回 v1（*-v2.test.tsx）。
// 缺省值本身由 ui-v2.test.tsx 重新载入模块来检查。不写本机存储（有的测试会清空它、检查里面的内容）。
applyUi("v1");
useUiVersion.setState({ ui: "v1" });

// jsdom 没有 WebGL 与画布：图表库与地图渲染库用桩代替（地图组件自带列表回退）。
vi.mock("echarts", () => ({
  init: vi.fn(() => ({ setOption: vi.fn(), dispose: vi.fn(), resize: vi.fn() })),
}));
vi.mock("pixi.js", () => ({
  Application: class {
    init() {
      return Promise.reject(new Error("测试环境没有 WebGL"));
    }
  },
}));

// jsdom 没有 2D 画布：返回 null（像素图组件据此静默跳过），避免 jsdom 打印“未实现”错误。
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

// 系统语言（EXPANSION.md §12）：jsdom 默认是 en-US。测试环境按中文系统处理，现有测试默认中文；
// 测试首次启动按系统语言时，个别用例临时改写这个值（见 i18n-ui.test.tsx）。
// 这一句在任何测试文件导入 i18n 之前执行（setupFiles 先于测试文件运行）。
Object.defineProperty(window.navigator, "language", { value: "zh-CN", configurable: true });

// 按需加载的界面（components/shell/loadable.ts：主界面、各功能面板……）：测试文件导入了它们时，在用例开始前先全部加载好——
// 与拆分代码块之前一样，用例里渲染时代码已经在了（不把模块的首次加载算进用例的等待时间）。
beforeAll(async () => {
  const list = (globalThis as { __manifestPreloads?: (() => Promise<unknown>)[] }).__manifestPreloads ?? [];
  await Promise.all(list.map((f) => f()));
}, 60000);

afterEach(() => {
  cleanup();
  clearMocks();
  // 视图查询的调度（store/views.ts）是模块级的：用例之间清空，上一个用例迟到的结果不交给下一个用例
  (globalThis as { __manifestResetViews?: () => void }).__manifestResetViews?.();
});
