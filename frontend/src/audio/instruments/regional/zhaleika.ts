// 扎列伊卡（罗斯的牧笛 zhaleika：一节芦苇或柳木管、单簧，管口套一只牛角）：响、尖、带鼻音，像粗一点的单簧管——
// 圆柱管让奇次谐波占上风，牛角喇叭口把 1.6 kHz 与 3 kHz 一带推得很亮，吹得越用力越亮（blare）；
// 牧人吹法：揉音宽而有点抖，音常常从下面滑上来（!bend!）、句尾往下落（!fall!），倚音多。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const ZHALEIKA: RegionalDef = {
  key: "zhaleika",
  region: "north_europe",
  name: { zh: "扎列伊卡（牛角牧笛）", en: "Zhaleika (hornpipe)" },
  instrument: {
    kind: "wind",
    amps: (n, f) => ((n % 2 === 1 ? 1 : 0.42) / Math.pow(n, 0.35)) * (0.4 + bump(f, 1600, 0.5, 0.8) + bump(f, 3100, 0.4, 0.4)) * roll(f, 7000, 3),
    attack: 0.022,
    release: 0.07,
    vib: { rate: 5.6, depth: 13, delay: 0.25 },
    vibBoost: 2,
    breath: { level: 0.03, q: 0.8, ratio: 2.5 },
    pulse: { level: 0.08, q: 0.9, ratio: 3.5 },
    chiff: 0.05,
    tongue: 0.45,
    glide: 0.035,
    drift: 6,
    blare: { from: 2000, to: 6500, time: 0.1 },
    level: 0.225,
  },
  // A 小调（自然小调）的长歌：从下面滑上来、揉开、落下
  demo: { key: "A minor", qpm: 80, bars: 3, abc: "!bend!E2 A2 (B c) (B A) | !vib!c4 (B A) (G E) | A2 {B}c2 !fall!A4" },
};
