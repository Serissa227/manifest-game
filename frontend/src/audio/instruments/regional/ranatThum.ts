// 拉那·通（ranat thum，暹罗的低音木琴）：琴键宽、共鸣箱像个小船，裹布的软槌，声音圆、暖、余音比拉那·艾长；
// 它在乐队里“逗趣”——切分、留空、突然跳八度，和高音木琴一密一疏。
import type { RegionalDef } from "./types";

export const RANAT_THUM: RegionalDef = {
  key: "ranat_thum",
  region: "siam",
  name: { zh: "拉那·通（低音木琴）", en: "Ranat thum" },
  instrument: {
    kind: "mallet",
    spec: { partials: [[1, 1, 1.3], [2.95, 0.18, 0.3], [6.1, 0.05, 0.1]], attack: 0.002, strike: [0.18, 0.005, 2600], tilt: 0.4, max: 2.2 },
    level: 0.72,
    release: 0.5,
    roll: 12,
  },
  // 切分与留空
  demo: { key: "G mixolydian", qpm: 96, bars: 3, abc: "G, z A, _/B, z D z _/E | D2 z _/B, A,2 G,2 | z G, A, _/B, D2 G,2" },
};
