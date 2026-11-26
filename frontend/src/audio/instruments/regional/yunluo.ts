// 云锣（明）：木架上挂着十面小铜锣，一锣一音，小槌敲下去“叮——”，清亮、有准确的音高，余音带一点颤（两面锣的拍音）；
// 寺庙、宫廷与民间的细乐都用，灯会里在笛子与笙的上面点出旋律的骨干。比小锣（xiaoluo）音高稳得多，只往上翘一点点。
import type { RegionalDef } from "./types";

export const YUNLUO: RegionalDef = {
  key: "yunluo",
  region: "ming",
  name: { zh: "云锣", en: "Yunluo" },
  instrument: {
    kind: "mallet",
    spec: {
      partials: [[1, 1, 1.8], [2.76, 0.2, 0.5], [5.1, 0.08, 0.25], [7.3, 0.03, 0.12]],
      attack: 0.001,
      strike: [0.28, 0.003, 7000],
      beat: 1.4,
      tilt: 0.25,
      glide: { from: 0.99, time: 0.05 },
      max: 2.5,
    },
    level: 0.71,
    release: 0.9,
  },
  // 五声音阶上的一串
  demo: { key: "D major", qpm: 84, bars: 3, abc: "d2 e2 f2 a2 | b2 a2 f e d2 | a4 d'4" },
};
