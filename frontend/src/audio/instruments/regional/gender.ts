// 根德尔（爪哇甘美兰的细音板，下面吊着竹管共鸣，软槌）：柔、暖、余音长，两手奏两条交错的线，像水里的光；比萨龙轻得多。
import type { RegionalDef } from "./types";

export const GENDER: RegionalDef = {
  key: "gender",
  region: "nusantara",
  name: { zh: "根德尔", en: "Gendèr" },
  instrument: {
    kind: "mallet",
    spec: { partials: [[1, 1, 3.2], [2.9, 0.08, 0.6], [5.6, 0.03, 0.25]], attack: 0.004, strike: [0.06, 0.004, 1800], beat: 3.5, tilt: 0.3, max: 3.5 },
    level: 0.5,
    release: 1.2,
  },
  demo: { key: "E phrygian", qpm: 80, bars: 3, abc: "E G B G c B G B | F G B c e c B G | [EB]8" },
};
