// UI strings (en): new UI phase 2 — voyage (chart stage, legend, zoom, departure dialog, manual sailing compass and HUD). Keys start with v2.voyage.
// 与 zh-CN.v2-voyage.ts 一一对应。
import type { Translation } from "./translation";
import type { v2Voyage as zh } from "./zh-CN.v2-voyage";

export const v2Voyage: Translation<typeof zh> = {
  "v2.voyage.clearFilter": "Clear search",
  "v2.voyage.noRouteFix": "Use “Pick again” to choose another destination.",
  "v2.voyage.shortFixSea": "Put in at a nearby port for food and water first.",
  "v2.voyage.noFleetFix": "Buy a ship at a shipyard to form a fleet first.",
  "v2.voyage.progress": "Voyage progress",
  "v2.voyage.progressText": "{done} days at sea, about {left} to go",
  "v2.voyage.worldMap": "World map",
  "v2.voyage.backToNav": "Back to sailing",
  "v2.voyage.pause": "Pause",
  "v2.voyage.resume": "Resume",
  "v2.voyage.keySteer": "Steer",
  "v2.voyage.keySail": "Raise / lower sail",
  "v2.voyage.keyPause": "Pause / resume",
  "v2.voyage.keyWorld": "World map",
};
