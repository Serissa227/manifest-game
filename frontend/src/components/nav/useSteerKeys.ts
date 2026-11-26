// 航行视图的键盘（FRAMEWORK §6.8）：A/D 或 ←/→ 按住连续转舵（松开时提交 Steer），W/S 升降帆，空格暂停，Tab 切换世界图。
// 输入框里打字、模态对话框开着时不当作操船；Shift+Tab 照常移动焦点。
import { useEffect } from "react";
import { draftHeading, setSail, steerTo, toggleNavView, togglePause, useNavStore } from "../../hooks/useNavigation";
import { navKeyOf, normDeg, sailDown, sailUp, TURN_RATE } from "./navKit";

/** 航行视图的键盘正挂着几处（空格这时归它：全局快捷键 shell/hotkeys.ts 让开，免得一下暂停又继续）。 */
let owners = 0;

/** 手动航行的键盘正在用空格（暂停 / 继续）。 */
export function steerKeysActive(): boolean {
  return owners > 0;
}

/** 按住转舵：一按先转这么多（度），之后每 TICK 毫秒按 TURN_RATE 连续转。 */
export const TAP_DEG = 5;
export const TURN_TICK_MS = 50;

/** 键盘事件来自输入框（查找框、数量）时不当作操船。 */
function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== "string") return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
}

/** 有模态对话框（事件、确认框）开着时不操船。 */
function modalOpen(): boolean {
  return typeof document !== "undefined" && document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

/**
 * 航行视图的键盘：A/D 或 ←/→ 按住连续转舵（松开时提交），W/S 升降帆，空格暂停，Tab 切换世界图。
 * world 为 true（在世界图上）时只认空格与 Tab。
 */
export function useSteerKeys(enabled: boolean, world: boolean) {
  useEffect(() => {
    if (!enabled) return;
    owners++;
    let hold: { dir: -1 | 1; timer: ReturnType<typeof setInterval> } | null = null;
    const finish = () => {
      if (!hold) return;
      clearInterval(hold.timer);
      hold = null;
      const h = useNavStore.getState().draft;
      if (h !== null) void steerTo(h);
    };
    const onDown = (e: KeyboardEvent) => {
      if (typing(e.target) || modalOpen()) return;
      const k = navKeyOf(e);
      if (!k || (k === "toggleView" && e.shiftKey)) return;
      if (world && k !== "pause" && k !== "toggleView") return;
      e.preventDefault();
      if (e.repeat) return;
      const st = useNavStore.getState();
      const nav = st.nav;
      switch (k) {
        case "left":
        case "right": {
          if (!nav || hold) return;
          const dir = k === "left" ? -1 : 1;
          const base = st.draft ?? nav.heading;
          let ticks = 0;
          draftHeading(normDeg(base + dir * TAP_DEG));
          hold = {
            dir,
            timer: setInterval(() => {
              ticks++;
              draftHeading(normDeg(base + dir * (TAP_DEG + (TURN_RATE * ticks * TURN_TICK_MS) / 1000)));
            }, TURN_TICK_MS),
          };
          return;
        }
        case "sailUp":
          if (nav) void setSail(sailUp(nav.sail));
          return;
        case "sailDown":
          if (nav) void setSail(sailDown(nav.sail));
          return;
        case "pause":
          void togglePause();
          return;
        case "toggleView":
          toggleNavView();
          return;
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const k = navKeyOf(e);
      // 空格：按钮在按键抬起时触发点击，这里挡掉（空格只用来暂停）
      if (k === "pause" && !typing(e.target)) e.preventDefault();
      if (!hold) return;
      if ((k === "left" && hold.dir === -1) || (k === "right" && hold.dir === 1)) finish();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", finish);
    return () => {
      owners--;
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", finish);
      if (hold) clearInterval(hold.timer);
      hold = null;
    };
  }, [enabled, world]);
}
