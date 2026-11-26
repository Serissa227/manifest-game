// 界面的两种皮肤（docs/UI-REDESIGN.md）：v2“海图室”（缺省）与 v1“经典像素”（改版前的界面，原样保留）。
// - 只影响画面：v2 时根元素 <html> 带 data-ui="v2"，styles/ui-v2/ 下的样式才生效；
//   v1 时根元素上没有 data-ui 这个属性，画面与 DOM 与改版前完全相同。
// - 设置“画面”一节的“界面风格”（海图室 / 经典像素）切换，立即生效，保存在本机（localStorage 的 manifest.uiSkin）；
//   读写失败（隐私模式等）时只在本次运行中生效。没有保存过选择时是海图室（v2）。
//   试用期的键 manifest.ui 不再读：那时存下的 v1 多半只是“没在试用”，不是“要经典像素”（docs/DECISIONS.md 2026-10-12）。
// - 地址里的 ?ui=v1（或 ?ui=v2）优先于保存的选择，只管这一次打开、不写入本机：加 ?ui=v1 用经典像素打开，不改本机设置。
// 不进入命令、存档与世界状态。
import { create } from "zustand";

export type UiVersion = "v1" | "v2";

/** 没有保存过选择时的界面：海图室。 */
export const DEFAULT_UI: UiVersion = "v2";

/** 本机保存选择用的键（试用期用的是 manifest.ui，见文件开头）。 */
export const UI_KEY = "manifest.uiSkin";

/** 认得的写法：v1、v2；其余一律当作没有。 */
export function parseUi(v: unknown): UiVersion | null {
  return v === "v2" || v === "v1" ? v : null;
}

/** 地址里的 ?ui=…（没有或认不出时为 null）。 */
export function urlUi(search?: string): UiVersion | null {
  try {
    const s = search ?? (typeof location !== "undefined" ? location.search : "");
    return parseUi(new URLSearchParams(s).get("ui"));
  } catch {
    return null;
  }
}

/** 本机保存的选择（没有或读不到时为缺省的海图室）。 */
export function storedUi(): UiVersion {
  try {
    return parseUi(globalThis.localStorage?.getItem(UI_KEY)) ?? DEFAULT_UI;
  } catch {
    return DEFAULT_UI;
  }
}

/** 把版本写到根元素上：v2 加 data-ui="v2"，v1 去掉这个属性。 */
export function applyUi(ui: UiVersion): void {
  try {
    const root = typeof document !== "undefined" ? document.documentElement : null;
    if (!root) return;
    if (ui === "v2") root.setAttribute("data-ui", "v2");
    else root.removeAttribute("data-ui");
  } catch {
    // 没有文档对象（纯逻辑测试）时忽略
  }
}

export interface UiVersionStore {
  ui: UiVersion;
  /** 切换并保存在本机（设置里的“界面风格”） */
  setUi: (ui: UiVersion) => void;
}

export const useUiVersion = create<UiVersionStore>((set) => ({
  ui: urlUi() ?? storedUi(),
  setUi: (ui) => {
    try {
      globalThis.localStorage?.setItem(UI_KEY, ui);
    } catch {
      // 本机存储不可用时只在本次运行中生效
    }
    applyUi(ui);
    set({ ui });
  },
}));

/**
 * 此刻是不是海图室（组件里用）：第二阶段需要小的 DOM 调整（空状态的“下一步”按钮、快捷键提示……）时，
 * 只在 v2 下渲染新的结构，经典像素（v1）照旧（v1 的 DOM 不变，见 docs/UI-REDESIGN.md 第 9 节）。
 */
export function useIsV2(): boolean {
  return useUiVersion((s) => s.ui === "v2");
}

// 模块载入时（React 挂上之前）就把版本写到根元素上：首屏不闪
applyUi(useUiVersion.getState().ui);
