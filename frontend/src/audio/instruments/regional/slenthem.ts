// 斯连特姆（slenthem，爪哇甘美兰的低音铜板琴）：宽薄的铜板吊在竹管共鸣器上，软槌，“嗡——”又低又长，拍音慢慢地起伏；
// 比萨龙低一个八度奏骨干旋律，像甘美兰的地板。
import type { RegionalDef } from "./types";

export const SLENTHEM: RegionalDef = {
  key: "slenthem",
  region: "nusantara",
  name: { zh: "斯连特姆（低音铜板琴）", en: "Slenthem" },
  instrument: {
    kind: "mallet",
    spec: { partials: [[1, 1, 3.4], [2.85, 0.1, 0.8], [5.4, 0.03, 0.3]], attack: 0.006, strike: [0.08, 0.006, 1200], beat: 2.6, tilt: 0.25, max: 3.8 },
    level: 0.5,
    release: 1.1,
  },
  demo: { key: "F major", qpm: 72, bars: 3, abc: "F,2 G,2 A,2 C2 | D2 C2 A,2 G,2 | F,8" },
};
