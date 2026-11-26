// 铙钹（明，锣鼓里的“才”）：两片对击，“嚓——”比西洋的钹更“破”、带一点钟一样的音高；两片合住的闷击是“七”。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const BO: RegionalDef = {
  region: "ming",
  name: { zh: "铙钹", en: "Naobo cymbals" },
  drums: {
    bo: { layers: [hiss(1800, 10000, 0.55, 1, { attack: 0.002 }), hiss(400, 2500, 0.18, 0.4), skin(640, 600, 0.01, 0.35, 0.2, [[1.6, 0.6, 0.3], [2.3, 0.5, 0.25], [3.4, 0.4, 0.2]])] },
    bo_mute: { layers: [hiss(1800, 9000, 0.08, 1, { attack: 0.002 }), hiss(400, 2500, 0.05, 0.5), skin(640, 600, 0.01, 0.06, 0.2)] },
  },
  demo: { key: "C major", qpm: 96, bars: 3, drum: [{ steps: "C...c.c.C...C.C.c.c.C...", hits: { C: ["bo", 0.85], c: ["bo_mute", 0.7] } }] },
};
