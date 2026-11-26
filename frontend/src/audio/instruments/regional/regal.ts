// 簧管风琴（regale，16 世纪的意大利与德意志）：一排拍击簧片配极短的共鸣管，小得能放在桌上；
// 声音鼻、尖、带“嗡嗡”的簧音（谐波衰减得很慢），起音快——给歌与乐队铺和弦（数字低音的祖先），蒙特威尔第的《奥菲欧》里冥河的船夫就配它。
// 写和弦（pad 伴奏型或旋律行里的 [..]）。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const REGAL: RegionalDef = {
  key: "regal",
  region: "iberia_italy",
  name: { zh: "簧管风琴", en: "Regal" },
  instrument: {
    kind: "pad",
    amps: (n, f) => (1 / Math.pow(n, 0.45)) * (0.35 + bump(f, 1400, 0.55, 0.7) + bump(f, 3000, 0.5, 0.45)) * roll(f, 6800, 3),
    attack: 0.02,
    release: 0.07,
    detune: 5,
    glide: 0.02,
    breath: { level: 0.008, q: 0.8, ratio: 3 },
    level: 0.28,
  },
  demo: { key: "G mixolydian", qpm: 80, bars: 3, abc: "[G,DGB]4 [C,EGc]4 | [F,CFA]4 [C,EGc]4 | [D,A,D^F]4 [G,DGB]4" },
};
