// 低音竖笛（文艺复兴竖笛合奏的低音，F3–G5）：像吹过瓶口的风，气声最多、起音慢、每个音头有一口“噗”，第二谐波略强。做法见 consort.ts。
import { recorderSpec } from "./consort";
import type { RegionalDef } from "./types";

export const REC_BASS: RegionalDef = {
  key: "rec_bass",
  region: "iberia_italy",
  name: { zh: "低音竖笛", en: "Bass recorder" },
  instrument: recorderSpec({ amps: [1, 0.22, 0.1, 0.06, 0.035, 0.02], air: 0.08, ratio: 1.8, chiff: 0.07, attack: 0.04, puff: 0.12, level: 0.25 }),
  demo: { key: "G mixolydian", qpm: 88, bars: 3, abc: "G4 G2 G2 | C4 E2 C2 | D4 G,4" },
};
