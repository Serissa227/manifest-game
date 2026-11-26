// 短号（cornetto / corneta，文艺复兴）：弯的木管外面包皮子，开指孔，却用号嘴吹——“最像人声的乐器”，亮而不刺、带一点气；
// 威尼斯圣马可的双合唱里它领唱（加布里埃利的坎佐纳），塞维利亚大教堂也用。灵活，装饰多（倚音、颤音 groppi，写 {..} 与 !vib!）。
// 与小号不同：起音软、亮度包络窄（1.1–3.6 kHz）、有一层气声；与竖笛不同：有号嘴的“唇音”，中频（0.9、1.7 kHz）的元音颜色。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const CORNETT: RegionalDef = {
  key: "cornett",
  region: "iberia_italy",
  name: { zh: "短号（木号）", en: "Cornett" },
  instrument: {
    kind: "brass",
    amps: (n, f) => (1 / Math.pow(n, 0.8)) * (0.55 + bump(f, 900, 0.5, 0.55) + bump(f, 1700, 0.45, 0.4) + bump(f, 2900, 0.4, 0.15)) * roll(f, 3800, 3),
    attack: 0.035,
    release: 0.09,
    vib: { rate: 5.2, depth: 7, delay: 0.32 },
    vibBoost: 2,
    breath: { level: 0.025, q: 0.9, ratio: 2.5 },
    pulse: { level: 0.05, q: 1, ratio: 3 },
    chiff: 0.03,
    tongue: 0.38,
    glide: 0.03,
    drift: 3,
    blare: { from: 1100, to: 3600, time: 0.09 },
    level: 0.25,
  },
  // 坎佐纳的开头（长—短—短的同音），一串经过句与倚音，句尾揉开
  demo: { key: "G mixolydian", qpm: 100, bars: 3, abc: "G4 G2 G2 | c4 e d c B | {B}c2 B2 !vib!A4" },
};
