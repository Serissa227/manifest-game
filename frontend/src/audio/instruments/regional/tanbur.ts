// 坦布尔（tanbur，奥斯曼古典音乐的长颈琉特）：一米多长的细颈上缠着几十道可挪动的品，半球形的薄木琴身，
// 成对的细金属弦，只在最高的一对上弹旋律，其余几对空着共鸣；玳瑁的长拨片贴着琴桥弹——声音细、清、带金属的“铮”，
// 余音很长，一个音弹下去能唱一小节。和乌德琴（短颈、无品、羊肠弦、深而暖）是伊斯坦布尔合奏里的一高一低。
// 滑到品之间的音写 !slide!，揉弦写 !vib!（第九批 A01：咖啡馆里的独奏）。
import type { RegionalDef } from "./types";

export const TANBUR: RegionalDef = {
  key: "tanbur",
  region: "ottoman",
  name: { zh: "坦布尔", en: "Tanbur" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 3.3,
      tilt: 0.38,
      bright: 0.9,
      pick: 0.06,
      damp: 0.1,
      course: 4,
      thump: 0.05,
      onset: 0.002,
      body: [[260, 1.4, 3], [820, 1.3, 3], [2100, 1.2, 3], [4200, 1, 2]],
      // 空着的几对弦（调在主音与五度上）被旋律带着响
      sympathetic: { notes: [50, 57, 62], level: 0.05, t60: 2.4 },
      lp: 10000,
      max: 4.2,
    },
    level: 0.95,
  },
  // D 上的拉斯特（三级、七级是中立音）：上行、在五级上停住让它响、滑下来
  demo: { key: "D rast", qpm: 76, bars: 4, abc: "D2 E F G2 A2 | !vib!A4 B c d2 | c B A G !slide!F2 E2 | !vib!D8" },
};
