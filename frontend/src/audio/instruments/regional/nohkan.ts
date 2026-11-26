// 能管（日本能乐的横笛，nōkan）：竹管里插着一截“喉”（nodo），把高音区的八度打乱，声音尖、硬、气声很重，音高游移不定；
// 不唱旋律，吹的是一个个程式化的“唱歌”（shōga）短句，最有名的是开场与高潮的“ヒシギ”（hishigi）——一下冲到最高处的尖啸。
// 与龙笛（ryuteki，雅乐，圆一点、稳一点）分开：这件起音的一口气更猛（puff）、气声更多、音高漂得更厉害（drift），亮度一下推上去（blare）。
import { bump } from "./shape";
import type { RegionalDef } from "./types";

export const NOHKAN: RegionalDef = {
  key: "nohkan",
  region: "japan",
  name: { zh: "能管", en: "Nōkan" },
  instrument: {
    kind: "wind",
    amps: (n, f) => ([1, 0.24, 0.34, 0.12, 0.1, 0.05, 0.04][n - 1] ?? 0) * (1 + bump(f, 2700, 0.5, 0.7)),
    attack: 0.03,
    release: 0.12,
    vib: { rate: 4.8, depth: 9, delay: 0.45 },
    vibBoost: 2.6,
    breath: { level: 0.22, q: 0.7, ratio: 2.5 },
    pulse: { level: 0.2, q: 1.1, ratio: 3.5 },
    puff: { level: 0.38, decay: 0.07 },
    tremor: { rate: 1.1, depth: 0.1 },
    drift: 16,
    chiff: 0.1,
    tongue: 0.6,
    glide: 0.1,
    blare: { from: 2400, to: 9000, time: 0.12 },
    level: 0.2,
  },
  // 开场的一句：低处起、推上去，最后一声ヒシギ
  demo: { key: "D dorian", qpm: 66, bars: 3, abc: "!bend!A4 (c2 B2) | !vib!A4 {c}d2 !fall!B2 | z2 !bend!a'4 !fall!g'2" },
};
