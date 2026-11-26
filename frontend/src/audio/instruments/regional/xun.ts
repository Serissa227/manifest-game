// 埙（明，陶土烧的卵形吹器）：没有管子，只有一个闷着的腔——几乎只剩基音，气声多，起音软，音量小，
// 低而暗，像隔着水面传过来的人声；揉音很慢，长音上气息一涨一落。比玛雅的陶笛低一个音区、暗得多，比箫更“空”。
// 夜里的江面、雾里的渔火用它（第九批 A01）。
import type { RegionalDef } from "./types";

export const XUN: RegionalDef = {
  key: "xun",
  region: "ming",
  name: { zh: "埙", en: "Xun" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.09, 0.03, 0.008][n - 1] ?? 0,
    attack: 0.1,
    release: 0.2,
    vib: { rate: 4.2, depth: 10, delay: 0.5 },
    vibBoost: 2.2,
    breath: { level: 0.26, q: 0.7, ratio: 1.25 },
    pulse: { level: 0.08, q: 1, ratio: 2 },
    puff: { level: 0.12, decay: 0.12 },
    tremor: { rate: 0.6, depth: 0.12 },
    drift: 6,
    chiff: 0.02,
    tongue: 0.7,
    glide: 0.09,
    lp: 2600,
    level: 0.23,
  },
  // 羽调式的一句慢板：从下面按上来、长音上慢慢揉开
  demo: { key: "A minor", qpm: 60, bars: 3, abc: "!bend!E4 G2 A2 | !vib!c6 A2 | G2 E2 !vib!D4" },
};
