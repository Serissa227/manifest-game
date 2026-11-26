// 克图（kethuk，爪哇甘美兰的小锅锣）：横放的小锣，敲一下马上按住，“突”的一声短而闷，落在骨干旋律的弱拍上，给循环打点。
import type { RegionalDef } from "./types";

export const KETHUK: RegionalDef = {
  key: "kethuk",
  region: "nusantara",
  name: { zh: "克图（小锅锣）", en: "Kethuk" },
  instrument: {
    kind: "mallet",
    spec: { partials: [[1, 1, 0.35], [2.4, 0.3, 0.15], [3.7, 0.12, 0.08]], attack: 0.002, strike: [0.2, 0.008, 2000], tilt: 0.2, max: 0.8 },
    level: 1.1,
    release: 0.15,
  },
  demo: { key: "F major", qpm: 90, bars: 3, abc: "z2 A,2 z2 A,2 | z2 A,2 z2 A,2 | z2 A,2 z4" },
};
