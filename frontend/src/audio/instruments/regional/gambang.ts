// 甘邦（gambang，爪哇甘美兰的木琴）：柚木琴键架在木槽上，水牛角的槌头裹着软垫，声音软、木、短；
// 两手隔八度一刻不停地奏十六分音符，在“软的”宫廷合奏（根德尔、竖琴、苏灵笛、雷巴布、人声）里像流水。
import type { RegionalDef } from "./types";

export const GAMBANG: RegionalDef = {
  key: "gambang",
  region: "nusantara",
  name: { zh: "甘邦（木琴）", en: "Gambang" },
  instrument: {
    kind: "mallet",
    // 木头琴键、软槌：分音 1 : 2.8 : 5.6，比暹罗的拉那软得多
    spec: { partials: [[1, 1, 0.65], [2.8, 0.18, 0.15], [5.6, 0.06, 0.06]], attack: 0.002, strike: [0.2, 0.004, 3000], tilt: 0.45, max: 1.3 },
    level: 1.09,
    release: 0.25,
  },
  // 斯连德罗一类的五声（F G A C D）：隔八度的十六分音符
  demo: { key: "F major", qpm: 84, bars: 3, abc: "F/2A/2c/2d/2 f/2d/2c/2A/2 G/2A/2c/2d/2 c/2A/2G/2F/2 | d/2f/2g/2f/2 d/2c/2A/2c/2 d/2c/2A/2G/2 A/2c/2d/2c/2 | A/2G/2F/2D/2 F/2G/2A/2c/2 F4" },
};
