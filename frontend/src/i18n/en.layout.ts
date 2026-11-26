// UI strings (en): responsive layout — the top-bar menu, the bottom navigation's “More”, the speed picker, chart zoom buttons.
// 与 zh-CN.layout.ts 一一对应。
import type { Translation } from "./translation";
import type { layout as zh } from "./zh-CN.layout";

export const layout: Translation<typeof zh> = {
  "layout.menu": "Menu",
  "layout.menuTitle": "Captain's ledger",
  "layout.menuAssets": "Assets and goal",
  "layout.menuWeather": "Time and weather",
  "layout.menuSaves": "Saves",
  "layout.menuSystem": "System",
  "layout.cashLabel": "Cash {money}",
  "layout.dateShort": "{date} {month:@month}",
  "layout.dateShortNamed": "{date} {month}",
  "layout.dateFullNamed": "{date} {month} {year}",
  "layout.resume": "Resume ({n}×)",
  "layout.speedNow": "Speed {n}×, tap to change",
  "layout.speedPaused": "Paused, tap to pick a speed",
  "layout.speedTitle": "Game speed",
  "layout.more": "More",
  "layout.moreTitle": "All panels",
  "layout.moreActive": "More (now: {tab})",
  "layout.stageTo": "Switch to {stage}",
  "layout.sheetClose": "Close",
  "layout.zoomIn": "Zoom in",
  "layout.zoomOut": "Zoom out",
  "layout.zoomFit": "Show the whole chart",
  "layout.zoomGroup": "Chart zoom",
  "layout.toggleVoyage": "Collapse or expand the voyage status",
  "layout.loadFailed": "This part of the interface failed to load (unstable network?)",
  "layout.loadRetry": "Retry",
};
