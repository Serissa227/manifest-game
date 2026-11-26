// 倍速快捷键（11-03）：主界面里按 1 / 2 / 3 切到慢 / 普通 / 快；海上口径（Overview.sea_clock，H10b）多一个 4：极快。
// - 输入框里打字、按着 Ctrl / Alt / ⌘、按住不放（自动重复）、或已经有模态对话框开着（剧情、海战、确认框……）时不理会；
// - 在港暂停（Overview.port_hold）时同样按下这一档：后端不走、不报错，只记下“出港后的倍速”；
// - 空格暂停 / 继续不在这里（hooks/useNavigation.ts 的 togglePause 与操作手感那边的处理）。
import { useEffect } from "react";
import { useGame } from "../store/game";
import { tiersFor } from "../time/daylight";

/** 键盘事件来自输入框（查找框、数量、存档名）：数字只是字符。 */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
}

/** 已经有模态对话框开着。 */
function modalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]') !== null;
}

/** 按键对应的一档（1 / 2 / 3 → 慢 / 普通 / 快；海上 4 → 极快）；不是这几个键时为 null。 */
export function speedForKey(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "altKey" | "metaKey" | "repeat" | "target">,
  sea = false,
): number | null {
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return null;
  const tiers = tiersFor(sea);
  const i = ["1", "2", "3", "4"].slice(0, tiers.length).indexOf(e.key);
  if (i < 0 || typing(e.target)) return null;
  return tiers[i];
}

/** 在主界面挂上 1 / 2 / 3 的倍速快捷键（enabled 为假时不挂：还没进游戏）。 */
export function useSpeedKeys(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const speed = speedForKey(e, useGame.getState().overview?.sea_clock === true);
      if (speed === null || modalOpen()) return;
      e.preventDefault();
      void useGame.getState().setSpeed(speed);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
