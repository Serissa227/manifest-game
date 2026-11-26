// 指笛（ゆびぶえ，琉球）：把手指放进嘴里吹的口哨，又高又尖、几乎是纯音，“咻——”地往上一挑（!bend!）——
// カチャーシー与エイサー跳到兴头上，旁边的人吹它起哄。音很高（C7 一带），声部音量要放小。
import type { RegionalDef } from "./types";

export const YUBIBUE: RegionalDef = {
  key: "yubibue",
  region: "ryukyu",
  name: { zh: "指笛", en: "Yubibue (finger whistle)" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.05, 0.015][n - 1] ?? 0,
    attack: 0.02,
    release: 0.05,
    vib: { rate: 6.5, depth: 18, delay: 0.12 },
    vibBoost: 2,
    breath: { level: 0.05, q: 2, ratio: 1 },
    puff: { level: 0.12, decay: 0.04 },
    drift: 10,
    chiff: 0.06,
    tongue: 0.4,
    glide: 0.07,
    level: 0.25,
  },
  // 咻——（往上挑）、咻咻、长的一声
  demo: { key: "C major", qpm: 112, bars: 3, abc: "!bend!c''3 z5 | !bend!a'2 z2 !bend!a'2 z2 | !bend!c''4 !fall!c''4" },
};
