// 马丁巴（刚果与安哥拉的木琴，madimba / marimba 一词就是从这里传到美洲的）：硬木的琴键下面挂着一排葫芦作共鸣管，
// 每个葫芦侧面开个小口、蒙着蛛网的卵囊膜（mirliton）——琴键一敲，膜跟着“嗞嗞”地嗡，声音带着鼻音、毛边，越重越嗡。
// 木头的分音不像音乐会马林巴那样调成四倍，余音短；两个人对坐，一人一半地咬合着奏出连续的一串。
import type { RegionalDef } from "./types";

export const MADIMBA: RegionalDef = {
  key: "madimba",
  region: "kongo",
  name: { zh: "马丁巴（刚果木琴）", en: "Madimba" },
  instrument: {
    kind: "mallet",
    spec: {
      partials: [[1, 1, 0.6], [2.95, 0.22, 0.13], [6.4, 0.06, 0.04]],
      attack: 0.0015,
      strike: [0.2, 0.003, 3200],
      tilt: 0.35,
      buzz: { at: 0.3, level: 2, hp: 700, fade: 0.7 },
      max: 1.6,
    },
    level: 1.2,
    release: 0.5,
    // 长音用两只槌轮流的滚奏（!trem!）
    roll: 12,
  },
  // 五声（G A B D E）的咬合短句，一圈一圈地转
  demo: { key: "G major", qpm: 112, bars: 4, abc: "G B d B e d B d | A B d e d B A B | G B d e g e d B | [G,D]4 z4" },
};
