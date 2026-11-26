// 锣圈（kyi waing，缅甸的围锣）：十几只小乳锣排成一圈，比暹罗的孔旺艾小、亮、拍音快；在 hsaing waing 里跟着鼓圈奏同一条旋律的另一种说法。
import type { RegionalDef } from "./types";

export const KYI_WAING: RegionalDef = {
  key: "kyi_waing",
  region: "burma",
  name: { zh: "锣圈（缅甸）", en: "Kyi waing" },
  instrument: {
    kind: "mallet",
    spec: { partials: [[1, 1, 1.7], [2.55, 0.35, 0.6], [4.25, 0.15, 0.3], [5.9, 0.06, 0.15]], attack: 0.0015, strike: [0.28, 0.003, 5000], beat: 2.8, tilt: 0.3, max: 2.2 },
    level: 0.65,
    release: 0.7,
  },
  demo: { key: "C major", qpm: 96, bars: 3, abc: "[Cc]2 [Gg]2 E D C2 | [Aa]2 [Gg]2 E2 D2 | C E G c [Cc]4" },
};
