// 帕玛（pat ma，缅甸 hsaing waing 乐队里吊着的大鼓）：很深的“嘭——”，在乐句的大落点与突然的停顿之后响。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const PAT_MA: RegionalDef = {
  region: "burma",
  name: { zh: "帕玛（吊鼓）", en: "Pat ma" },
  drums: {
    pat_ma: { layers: [skin(70, 52, 0.06, 1.6, 1, [[1.5, 0.3, 0.8], [2.0, 0.18, 0.5]], 0.001), hiss(400, 2500, 0.02, 0.3, { attack: 0.001 }), hiss(30, 160, 0.3, 0.45, { attack: 0.003 })] },
  },
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "B.......B.......B...B.B.", hits: { B: ["pat_ma", 0.9] } }] },
};
