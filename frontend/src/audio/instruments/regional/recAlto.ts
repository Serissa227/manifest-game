// 中音竖笛（文艺复兴竖笛合奏，F4–G6）：比高音竖笛暖一点，气声略多。做法见 consort.ts。
import { recorderSpec } from "./consort";
import type { RegionalDef } from "./types";

export const REC_ALTO: RegionalDef = {
  key: "rec_alto",
  region: "iberia_italy",
  name: { zh: "中音竖笛", en: "Alto recorder" },
  instrument: recorderSpec({ amps: [1, 0.12, 0.1, 0.035, 0.03, 0.012], air: 0.05, ratio: 2.2, chiff: 0.1, attack: 0.028, level: 0.24 }),
  demo: { key: "G mixolydian", qpm: 96, bars: 3, abc: "g3 g g2 b2 | a3 a a2 c'2 | b2 g2 ^f2 d2" },
};
