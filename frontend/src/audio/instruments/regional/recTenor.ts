// 次中音竖笛（文艺复兴竖笛合奏，C4–D6）：圆而柔，气声更多、吐音软一点。做法见 consort.ts。
import { recorderSpec } from "./consort";
import type { RegionalDef } from "./types";

export const REC_TENOR: RegionalDef = {
  key: "rec_tenor",
  region: "iberia_italy",
  name: { zh: "次中音竖笛", en: "Tenor recorder" },
  instrument: recorderSpec({ amps: [1, 0.16, 0.09, 0.04, 0.03, 0.015], air: 0.06, ratio: 2, chiff: 0.085, attack: 0.032, level: 0.25 }),
  demo: { key: "G mixolydian", qpm: 92, bars: 3, abc: "d3 d d2 G2 | e3 e e2 c2 | d2 B2 A2 d2" },
};
