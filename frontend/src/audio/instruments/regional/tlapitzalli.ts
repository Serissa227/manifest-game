// 特拉皮查利（阿兹特克的陶笛）：烧陶的哨口笛，四个按孔，笛口做成一朵花；吐音清楚（哨口的“嚓”），几乎不揉，音高有点游移（陶土的管）。
// 墨西哥谷地出土过两管、三管连在一起的陶笛——这里做成两个气室：两个略有音差的振荡器一起吹（齐奏），长音上有一点“嗡嗡”的拍。
// 第三谐波比第二谐波强（陶笛的腔体），比玛雅的陶笛（几乎是正弦）亮一点、空一点。
import type { RegionalDef } from "./types";

export const TLAPITZALLI: RegionalDef = {
  key: "tlapitzalli",
  region: "mexica",
  name: { zh: "特拉皮查利陶笛", en: "Tlapitzalli (clay flute)" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.1, 0.2, 0.05, 0.06, 0.02][n - 1] ?? 0,
    attack: 0.03,
    release: 0.07,
    vib: { rate: 6.2, depth: 4, delay: 0.5 },
    breath: { level: 0.12, q: 1, ratio: 2.2 },
    pulse: { level: 0.1, q: 1.2, ratio: 2.6 },
    puff: { level: 0.12, decay: 0.04 },
    unison: { voices: 2, spread: 14 },
    drift: 9,
    chiff: 0.14,
    tongue: 0.3,
    glide: 0.02,
    level: 0.214,
  },
  // 鸟叫一样的倚音、重复的音、四度的跳，句尾往下落
  demo: { key: "D minor", qpm: 100, bars: 4, abc: "A2 A d c2 A2 | {AcA}G2 A2 F4 | d2 {fdf}d c A2 G2 | !fall!D8" },
};
