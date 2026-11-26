// UI strings (en): new UI phase 2 — upbringing (main screen, contests and mini-games, academy). Keys start with v2.upbringing.
// 与 zh-CN.v2-upbringing.ts 一一对应。
import type { Translation } from "./translation";
import type { v2Upbringing as zh } from "./zh-CN.v2-upbringing";

export const v2Upbringing: Translation<typeof zh> = {
  "v2.upbringing.where": "{slot}, {part}",
  "v2.upbringing.target": "Pick a card for {where}",
  "v2.upbringing.targetReplace": "Pick a card to replace {act} in {where}",
  "v2.upbringing.projLabel": "This month, roughly",
  "v2.upbringing.projNone": "Plan some activities and this shows roughly what the month will bring.",
  "v2.upbringing.tired": "Too tiring: may fall ill or sulk",
  "v2.upbringing.goEmpty": "{n:plural(slot is,slots are)} still empty",
  "v2.upbringing.goNeeds": "{act} in {where} still needs: {needs}",
  "v2.upbringing.goEmptyFix": "Go to {where}",
  "v2.upbringing.goNeedsFix": "Choose now",
  "v2.upbringing.pathNone": "No need to choose a path yet.",
  "v2.upbringing.examsNone": "No exams coming up.",
};
