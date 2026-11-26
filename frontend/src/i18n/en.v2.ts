// UI strings (en): shared feedback components of the new UI — inline errors, empty states, key hints, confirmation dialogs.
// 与 zh-CN.v2.ts 一一对应。
import type { Translation } from "./translation";
import type { v2 as zh } from "./zh-CN.v2";

export const v2: Translation<typeof zh> = {
  "v2.fb.keys": "Keyboard shortcuts",
  "v2.fb.key.enter": "Enter",
  "v2.fb.key.space": "Space",
  "v2.fb.key.up": "Up arrow",
  "v2.fb.key.down": "Down arrow",
  "v2.fb.key.left": "Left arrow",
  "v2.fb.key.right": "Right arrow",
  "v2.fb.working": "Working…",
  "v2.fb.loadFailedFix": "Retry to load it again; your game progress is not affected.",
  "v2.fb.sc.title": "All keyboard shortcuts",
  "v2.fb.sc.lead": "Press ? at any time to open this list (not while typing in a field).",
  "v2.fb.sc.closeCard": "Close",
  "v2.fb.sc.button": "All keyboard shortcuts (press ?)",
  "v2.fb.sc.market": "Market",
  "v2.fb.sc.pick": "Choose a good",
  "v2.fb.sc.qty": "Change the quantity",
  "v2.fb.sc.ten": "10 at a time",
  "v2.fb.sc.settle": "Trade (with an empty order, expand the row)",
  "v2.fb.sc.detail": "Show details",
  "v2.fb.sc.clear": "Clear this row",
  "v2.fb.sc.ends": "First / last row",
  "v2.fb.sc.window": "Windows and dialogs",
  "v2.fb.sc.close": "Close the window or cancel a dialog",
  "v2.fb.sc.help": "Open or close this list",
  "v2.fb.sc.nav": "Manual sailing",
  "v2.fb.sc.steer": "Steer (hold to keep turning)",
  "v2.fb.sc.sail": "Raise / lower sail",
  "v2.fb.sc.pause": "Pause / resume",
  "v2.fb.sc.world": "Toggle the world map",
  "v2.fb.sc.tutorial": "Tutorial",
  "v2.fb.sc.steps": "Previous / next step",
  "v2.fb.sc.endTutorial": "End the tutorial",
};
