// 笙（明）：十几根簧管同时响，亮、稳，没有揉音——衬底的长音（写和弦或 pad 伴奏型）。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const SHENG: RegionalDef = {
  key: "sheng",
  region: "ming",
  name: { zh: "笙", en: "Sheng" },
  instrument: {
    kind: "pad",
    amps: (n, f) => (1 / Math.pow(n, 0.8)) * (0.5 + bump(f, 1500, 0.6, 0.6) + bump(f, 3200, 0.5, 0.3)) * roll(f, 6000, 3),
    attack: 0.12,
    release: 0.4,
    detune: 4,
    glide: 0.05,
    level: 0.23,
  },
  demo: { key: "D major", qpm: 72, bars: 3, abc: "[DAd]4 [EBe]4 | [FAd]4 [EAe]4 | [DAd]8" },
};
