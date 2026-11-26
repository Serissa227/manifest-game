// UI strings (en): new UI phase 2 — encounters (naval battle, pirates, outcome banner). Keys start with v2.dialogs.
// 与 zh-CN.v2-dialogs.ts 一一对应。
import type { Translation } from "./translation";
import type { v2Dialogs as zh } from "./zh-CN.v2-dialogs";

export const v2Dialogs: Translation<typeof zh> = {
  "v2.dialogs.battle.autoHint": "Settle it now from both sides' ships, guns and crew",
  "v2.dialogs.battle.tacticalHint": "Command your ships yourself on the hex board: move, turn, fire, board",
  "v2.dialogs.tactical.legend": "Legend",
  "v2.dialogs.tactical.legendMove": "Hexes you can move to",
  "v2.dialogs.tactical.legendTarget": "Enemy in range: click it to fire",
  "v2.dialogs.tactical.legendSelected": "The ship you are commanding",
  "v2.dialogs.tactical.noneHint": "Choose “Tactical battle” when pirates attack, and you will command it here.",
  "v2.dialogs.tactical.toChart": "Back to the chart",
  "v2.dialogs.tut.keys": "Pages",
  "v2.dialogs.contest.whyMatch": "Turn over at least one pair (two cards) before you stop",
  "v2.dialogs.contest.whyPoem": "Pick a word for every line to recite ({n} to go)",
  "v2.dialogs.contest.whyIdentify": "Name every sample to hand in ({n} to go)",
};
