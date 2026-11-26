// 特尔班（terbang / rebana，爪哇北岸的框鼓）：没有响弦的单面框鼓，伊斯兰学堂（pesantren）里伴着颂诗（sholawat）几只一起打，
// 鼓心的“咚”、鼓边的“嗒”与半开的“通”交错成一张网。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TERBANG: RegionalDef = {
  region: "nusantara",
  name: { zh: "特尔班（框鼓）", en: "Terbang" },
  drums: {
    terbang_dung: { layers: [skin(130, 112, 0.02, 0.4, 1, [[1.6, 0.3, 0.2], [2.3, 0.15, 0.12]], 0.0008), hiss(200, 1500, 0.02, 0.3, { attack: 0.0008 })] },
    terbang_tak: { layers: [skin(480, 460, 0.01, 0.08, 0.6, undefined, 0.0006), hiss(1500, 7500, 0.03, 0.8, { attack: 0.0006 })] },
    terbang_tung: { layers: [skin(260, 250, 0.01, 0.3, 0.9, [[1.6, 0.25, 0.15]], 0.0006), hiss(800, 4000, 0.015, 0.35, { attack: 0.0006 })] },
  },
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "D..t.Dt.D.tt.Dt.D..t.Dtt", hits: { D: ["terbang_dung", 0.85], t: ["terbang_tak", 0.7] } }, { steps: "..o...o...o.o...", grid: 1.5, hits: { o: ["terbang_tung", 0.6] } }] },
};
