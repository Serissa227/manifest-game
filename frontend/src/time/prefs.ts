// 昼夜光影偏好（EXPANSION.md §9.3）：“跟随时间”或“始终白天”。只影响画面，保存在本机；读写失败（隐私模式等）时按默认值。
import { create } from "zustand";
import type { DaylightPref } from "./daylight";

const KEY = "manifest.daylight";

function load(): DaylightPref {
  try {
    return globalThis.localStorage?.getItem(KEY) === "day" ? "day" : "clock";
  } catch {
    return "clock";
  }
}

export interface DaylightPrefStore {
  pref: DaylightPref;
  setPref: (pref: DaylightPref) => void;
}

export const useDaylightPref = create<DaylightPrefStore>((set) => ({
  pref: load(),
  setPref: (pref) => {
    try {
      globalThis.localStorage?.setItem(KEY, pref);
    } catch {
      // 本机存储不可用时只在本次运行中生效
    }
    set({ pref });
  },
}));
