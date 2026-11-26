// 罗斯的教堂钟（kolokol）：钟不摇，钟舌用绳子拉着撞——“报时的大钟”（blagovest）一下一下慢慢地敲，
// 几口小钟（zazvonnye）由一个人同时拉着，敲出反复的节奏型（zvon、trezvon）——几口钟的音高并不按和弦来配，靠节奏型取胜。罗斯的钟不按西欧那样调律：
// 分音不成小三度那样整齐的比例，又低又浑、拍音重、哼音很长，撞击的那一下沉而钝。大钟写低（A2 一带），小钟写高（A4–E6）。
import type { RegionalDef } from "./types";

export const KOLOKOL: RegionalDef = {
  key: "kolokol",
  region: "north_europe",
  name: { zh: "罗斯的教堂钟", en: "Kolokol (Russian church bell)" },
  instrument: {
    kind: "mallet",
    spec: {
      partials: [
        [0.5, 0.55, 9],
        [1, 1, 6.5],
        [1.183, 0.45, 4.5],
        [1.506, 0.32, 3.8],
        [2, 0.55, 3.6],
        [2.63, 0.3, 2.4],
        [3.36, 0.2, 1.7],
        [4.21, 0.14, 1.1],
        [5.43, 0.09, 0.7],
      ],
      attack: 0.002,
      strike: [0.42, 0.014, 3200],
      beat: 0.9,
      tilt: 0.25,
      max: 7,
    },
    level: 0.52,
    release: 3,
  },
  // 大钟两下，中钟落在反拍上，小钟的节奏型（E、D、B 三口钟按 3 + 3 + 2 反复——不按和弦配）
  demo: { key: "A minor", qpm: 90, bars: 4, abc: "A,,4 z4 | A,,4 z B, D B, | e/2d/2B/2e/2d/2B/2e/2d/2 e/2d/2B/2e/2d/2B/2 E | A,,8" },
};
