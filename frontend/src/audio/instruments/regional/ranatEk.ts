// 拉那·艾（ranat ek，暹罗 piphat 乐队的高音木琴）：二十一根红木琴键吊在船形的共鸣箱上，硬槌敲下去“托”的一声又亮又干，余音短；
// 两手隔八度奏一串串的八分音符，把骨干旋律绕开、加花；长音是两槌交替的滚奏（kro，写 !trem!）。
// 暹罗的律是七平均律（一个音级约 171 音分）：曲谱里第三、第六级写成四分之一降音（_/B、_/E），中立的三度是它一听就知道的颜色。
import type { RegionalDef } from "./types";

export const RANAT_EK: RegionalDef = {
  key: "ranat_ek",
  region: "siam",
  name: { zh: "拉那·艾（高音木琴）", en: "Ranat ek" },
  instrument: {
    kind: "mallet",
    // 木头琴键：分音约 1 : 3 : 6.3（中间略挖薄），高分音很快就没了；硬槌的“托”
    spec: { partials: [[1, 1, 0.8], [3.05, 0.42, 0.25], [6.3, 0.2, 0.09], [10.4, 0.08, 0.045]], attack: 0.0012, strike: [0.45, 0.003, 8000], tilt: 0.45, max: 1.6 },
    level: 1.14,
    release: 0.35,
    roll: 14,
  },
  // 七平均律近似的五声（G A 半降B D 半降E）：八分音符的加花、滚奏
  demo: { key: "G mixolydian", qpm: 100, bars: 3, abc: "G A _/B d _/e d _/B A | G2 !trem!d4 _/B A | g _/e d _/B A G A2" },
};
