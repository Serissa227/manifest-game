// UI strings (en): new UI phase 2 — start (title, load game, new-game wizard, worlds and protagonist roster). Keys start with v2.start.
// 与 zh-CN.v2-start.ts 一一对应。
import type { Translation } from "./translation";
import type { v2Start as zh } from "./zh-CN.v2-start";

export const v2Start: Translation<typeof zh> = {
  "v2.start.noSavesHint": "Once a voyage is under way, you can save at any time.",
  "v2.start.newVoyage": "Start a new voyage",
  "v2.start.deleteTitle": "Delete save “{slot}”?",
  "v2.start.deleteBody": "A deleted save can't be recovered.",
  "v2.start.deleteConfirm": "Delete “{slot}”",
  "v2.start.seedHint": "The same number opens the same world (handy for comparing runs with friends); leave it empty for a fresh one.",
  "v2.start.cardDetails": "Details",
  "v2.start.cardDetailsLabel": "Captain card details",
};
