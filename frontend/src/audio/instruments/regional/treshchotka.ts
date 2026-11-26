// 木片响板（罗斯的 treshchotka：一串薄木片用绳子穿起来，两手一抖就“哗啦啦”地互相拍）：
// 一下是一串很密的木头的噼啪（连着好几下的噪声），比木勺更碎、更“沙”；treshchotka 长一串，treshchotka_short 短一下。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TRESHCHOTKA: RegionalDef = {
  region: "north_europe",
  name: { zh: "木片响板", en: "Treshchotka (board rattle)" },
  drums: {
    treshchotka: { layers: [hiss(900, 4800, 0.05, 1, { attack: 0.0022, taps: 7 }), skin(1300, 1250, 0.01, 0.03, 0.25, undefined, 0.0004)] },
    treshchotka_short: { layers: [hiss(1000, 5000, 0.03, 0.9, { attack: 0.0022, taps: 3 }), skin(1350, 1300, 0.01, 0.025, 0.2, undefined, 0.0004)] },
  },
  demo: { key: "C major", qpm: 120, bars: 4, drum: [{ steps: "T...s.s.T...s...", hits: { T: ["treshchotka", 0.85], s: ["treshchotka_short", 0.6] } }] },
};
