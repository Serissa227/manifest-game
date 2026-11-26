// FIX6F：养成期的停顿方式（应用设置 `upbringing_pause`）的一份共用状态。
// 行动制主菜单里的“养成期的停顿”（UbWeek.PauseMode）读写它；周末底栏看它决定要不要写自由日停下的原因（只在“每月停 / 有事才停”下写）。
// 值仍存在应用设置里，这里只是界面上同一份读数；读不到设置（旧后端、测试替身）时为 null。
import { create } from "zustand";
import { api } from "../../ipc/api";
import type { UpbringingPause } from "../../ipc/types";

interface UbPauseState {
  pause: UpbringingPause | null;
  loaded: boolean;
}

export const useUbPause = create<UbPauseState>(() => ({ pause: null, loaded: false }));

/** 还没读过就读一次设置（多处同时调用只读一次）。 */
let loading: Promise<void> | null = null;
export function loadUbPause(): Promise<void> {
  if (useUbPause.getState().loaded) return Promise.resolve();
  loading ??= api
    .getSettings()
    .then((v) => useUbPause.setState({ pause: v?.settings ? (v.settings.upbringing_pause ?? "week") : null, loaded: true }))
    .catch(() => useUbPause.setState({ loaded: true }))
    .finally(() => {
      loading = null;
    });
  return loading;
}
