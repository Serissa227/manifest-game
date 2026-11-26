// 巴洪管（bajón，西班牙的低音双簧管，意大利叫 dulciana / fagotto；巴松管的前身）：管身折成两截、一根木头里钻出的锥形管，
// 比肖姆管柔和得多、圆、带一点木头的“嗡”。西班牙的教堂与城里的乐队里它是低音：和萨克布一起托住肖姆与短号。
import { reedAmps } from "./shape";
import type { RegionalDef } from "./types";

export const BAJON: RegionalDef = {
  key: "bajon",
  region: "iberia_italy",
  name: { zh: "巴洪管", en: "Bajón (dulcian)" },
  instrument: {
    kind: "wind",
    amps: reedAmps(0.5, [[420, 0.55, 0.7], [1050, 0.5, 0.45], [2400, 0.4, 0.15]], 3800),
    attack: 0.04,
    release: 0.09,
    vib: { rate: 5, depth: 3, delay: 0.5 },
    breath: { level: 0.015, q: 0.8, ratio: 3 },
    pulse: { level: 0.05, q: 0.9, ratio: 3.5 },
    chiff: 0.035,
    tongue: 0.45,
    glide: 0.04,
    drift: 2,
    blare: { from: 1400, to: 3600, time: 0.12 },
    level: 0.32,
  },
  // 低音线：福利亚的低音（g — D — g — F — 降B — F — g — D）
  demo: { key: "G minor", qpm: 96, bars: 4, abc: "G,4 D,4 | G,4 F,4 | B,,4 F,4 | G,2 E,2 D,4" },
};
