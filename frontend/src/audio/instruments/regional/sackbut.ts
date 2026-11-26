// 萨克布（sackbut / sacabuche / trombone，文艺复兴的长号）：管口窄、喇叭口小，比后来的长号柔、圆，跟人声与短号融得起来；
// 威尼斯圣马可的“短号与萨克布”、塞维利亚大教堂的乐手都靠它。中低音区 500–600 Hz 与 1.2 kHz 的长号颜色，力度大时才亮。
// 几乎不揉音；吐音清楚（tongue 低），圆滑处是拉管的滑过去。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const SACKBUT: RegionalDef = {
  key: "sackbut",
  region: "iberia_italy",
  name: { zh: "萨克布", en: "Sackbut" },
  instrument: {
    kind: "brass",
    amps: (n, f) => (1 / Math.pow(n, 0.6)) * (0.7 + bump(f, 540, 0.6, 0.45) + bump(f, 1180, 0.5, 0.3)) * roll(f, 1800, 2.6),
    attack: 0.05,
    release: 0.12,
    vib: { rate: 5, depth: 3, delay: 0.5 },
    breath: { level: 0.006, q: 1, ratio: 3 },
    chiff: 0.02,
    tongue: 0.42,
    glide: 0.06,
    blare: { from: 450, to: 2400, time: 0.12 },
    level: 0.32,
  },
  // 众赞歌式的内声部：长—短—短，再一个终止
  demo: { key: "G mixolydian", qpm: 92, bars: 3, abc: "G,4 G,2 G,2 | C4 B,2 A,2 | G,8" },
};
