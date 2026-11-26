// 葫芦沙铃（玛雅的 sonaja）：干葫芦里装着种子，“沙”的一声带一点颗粒。
import { hiss } from "./shape";
import type { RegionalDef } from "./types";

export const SONAJA: RegionalDef = {
  region: "maya",
  name: { zh: "葫芦沙铃", en: "Gourd rattle" },
  drums: {
    sonaja: { layers: [hiss(2500, 9000, 0.08, 1, { attack: 0.015, taps: 3 })] },
  },
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "s.ss.ss.", hits: { s: ["sonaja", 0.7] } }] },
};
