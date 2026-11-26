// 板鼓（明，单皮鼓）：高、干、短的“哒”，司鼓用它领着整个锣鼓班子起、收。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const BANGU: RegionalDef = {
  region: "ming",
  name: { zh: "板鼓", en: "Bangu" },
  drums: {
    bangu: { layers: [skin(900, 860, 0.01, 0.05, 0.8, [[1.6, 0.3, 0.03]]), hiss(2500, 9000, 0.01, 0.8)] },
  },
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "b.b.bbb.b...b.b.bbbbb...", hits: { b: ["bangu", 0.8] } }] },
};
