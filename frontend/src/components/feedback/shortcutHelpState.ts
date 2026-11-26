// 全部快捷键（ShortcutHelp.tsx）开着没有：按“?”与窗口标题栏上的“?”小键帽都打开同一张卡。
import { create } from "zustand";

export const useShortcutHelp = create<{ open: boolean }>(() => ({ open: false }));

/** 打开全部快捷键（新界面里才挂着这张卡）。 */
export function openShortcutHelp(): void {
  useShortcutHelp.setState({ open: true });
}

/** 关上全部快捷键。 */
export function closeShortcutHelp(): void {
  useShortcutHelp.setState({ open: false });
}
