// 钲（징，朝鲜）：大的铜锣，用包着布的软槌敲，“嗡——”地慢慢绽开、余音很长，音高不沉也不翘，几个分音一涨一落地拍；
// 农乐与巫乐里在每个长短（节奏循环）的第一拍敲一下，告诉大家一轮到了。旋律行里写一个低音（A2 一带）。
import type { RegionalDef } from "./types";

export const JING: RegionalDef = {
  key: "jing",
  region: "korea",
  name: { zh: "钲（朝鲜的징）", en: "Jing" },
  instrument: {
    kind: "mallet",
    spec: {
      partials: [[1, 1, 7], [2.02, 0.55, 5], [2.76, 0.4, 3.5], [3.48, 0.3, 2.6], [4.6, 0.22, 1.8], [5.9, 0.14, 1.2], [7.3, 0.08, 0.8]],
      attack: 0.012,
      strike: [0.15, 0.03, 700],
      beat: 1.3,
      tilt: 0.1,
      max: 8,
    },
    level: 0.42,
    release: 3,
  },
  demo: { key: "C major", qpm: 66, bars: 3, abc: "A,,8 | z8 | A,,4 z4" },
};
