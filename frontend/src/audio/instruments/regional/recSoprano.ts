// 高音竖笛（文艺复兴竖笛合奏的最高声部，C5–D7）：清亮、圆，吐音的“咚”最脆，气声最少。做法见 consort.ts。
import { recorderSpec } from "./consort";
import type { RegionalDef } from "./types";

export const REC_SOPRANO: RegionalDef = {
  key: "rec_soprano",
  region: "iberia_italy",
  name: { zh: "高音竖笛", en: "Soprano recorder" },
  instrument: recorderSpec({ amps: [1, 0.1, 0.09, 0.03, 0.025, 0.01], air: 0.045, ratio: 2.4, chiff: 0.11, attack: 0.025, level: 0.24 }),
  // 弗罗托拉一类的舞曲旋律：同音反复、附点
  demo: { key: "G mixolydian", qpm: 104, bars: 3, abc: "b3 b b2 d'2 | c'3 c' c'2 e'2 | d'2 b2 a2 g2" },
};
