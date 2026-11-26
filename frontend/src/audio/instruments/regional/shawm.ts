// 肖姆管（chirimía / piffaro，伊比利亚与意大利的“高音乐队” alta capella）：锥形管的双簧管，嘴唇不碰哨片（含在“唇托”后面），
// 又响又亮、带鼻音的“嗡”，户外、城门、节庆与教堂的游行用；塞维利亚大教堂的乐手（ministriles）就是肖姆、萨克布与巴洪。
// 与奥斯曼的祖尔纳同出一族，但共振峰低一点（1.1 kHz、2.5 kHz），几乎不揉音、音高很稳——欧洲的乐队要和声对得齐。
import { reedAmps } from "./shape";
import type { RegionalDef } from "./types";

export const SHAWM: RegionalDef = {
  key: "shawm",
  region: "iberia_italy",
  name: { zh: "肖姆管", en: "Shawm" },
  instrument: {
    kind: "wind",
    amps: reedAmps(0.26, [[1150, 0.5, 0.85], [2500, 0.45, 0.75], [4000, 0.4, 0.35]], 8000),
    attack: 0.03,
    release: 0.07,
    vib: { rate: 5.4, depth: 5, delay: 0.42 },
    vibBoost: 1.8,
    breath: { level: 0.02, q: 0.8, ratio: 3 },
    pulse: { level: 0.07, q: 0.9, ratio: 4 },
    chiff: 0.05,
    tongue: 0.42,
    glide: 0.035,
    drift: 3,
    blare: { from: 2400, to: 8000, time: 0.1 },
    level: 0.27,
  },
  // G 小调：节庆的号召，附点与倚音，句尾落在 D 上（半终止）
  demo: { key: "G minor", qpm: 100, bars: 3, abc: "d3 d d2 g2 | ^f e d c B2 A2 | {c}B2 A2 G4" },
};
