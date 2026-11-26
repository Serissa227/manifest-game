// “天气特效”开关（设置 → 画面；缺省开）：关掉时航海图上不画按海区的压暗、雨线与闪电，也没有全画面的雨幕（天况小标记照旧）。
// 只影响画面，保存在本机；读写失败（隐私模式等）时按缺省（开）。
import { create } from "zustand";

const KEY = "manifest.weatherFx";

function load(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export interface WeatherFxPrefStore {
  on: boolean;
  setOn: (on: boolean) => void;
}

export const useWeatherFxPref = create<WeatherFxPrefStore>((set) => ({
  on: load(),
  setOn: (on) => {
    try {
      globalThis.localStorage?.setItem(KEY, on ? "on" : "off");
    } catch {
      // 本机存储不可用时只在本次运行中生效
    }
    set({ on });
  },
}));
