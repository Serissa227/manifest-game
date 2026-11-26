// 屯库尔（玛雅的裂缝木鼓，阿兹特克叫特波纳兹特利）：一段挖空的硬木，上面刻出 H 形的两片舌头，橡胶头的槌敲下去“嘣”的一声木头的空响；
// 两片舌头两个音（常隔四度、五度）。比旧的 logdrum 低一点、闷一点。
import type { RegionalDef } from "./types";

export const TUNKUL: RegionalDef = {
  key: "tunkul",
  region: "maya",
  name: { zh: "屯库尔木鼓", en: "Tunkul (slit drum)" },
  instrument: {
    kind: "mallet",
    spec: { partials: [[1, 1, 0.45], [2.12, 0.3, 0.12], [3.9, 0.12, 0.05], [6.1, 0.05, 0.03]], attack: 0.002, strike: [0.4, 0.004, 1800], tilt: 0.2, max: 1 },
    level: 1.11,
  },
  demo: { key: "G minor", qpm: 100, bars: 3, abc: "G,,2 G,, D,2 D, G,,2 | G,,2 D,2 G,,2 D, D, | G,,2 G,, D,2 D, G,,2" },
};
