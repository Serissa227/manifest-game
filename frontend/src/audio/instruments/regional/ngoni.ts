// 恩戈尼（西非曼丁的小琉特，格里奥最老的琴）：独木挖成的船形琴身蒙着皮，四五根弦，手指或指甲弹，
// 声音脆、短、跳，带着皮面的“嗒”；琴颈上常插一片薄铁片（nyenyemo），套着小铁环，弹起来“嗞嗞”地跟着响。
// 快速的音型与切分是它的本色，与科拉琴的长余音相反。
import type { RegionalDef } from "./types";

export const NGONI: RegionalDef = {
  key: "ngoni",
  region: "guinea",
  name: { zh: "恩戈尼（小琉特）", en: "Ngoni" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 0.95,
      tilt: 0.4,
      bright: 0.88,
      pick: 0.09,
      damp: 0.12,
      thump: 0.12,
      skin: [300, 0.04, 0.32],
      buzz: { at: 0.62, level: 2.2, hp: 2000 },
      body: [[340, 1.4, 4], [1500, 1.3, 3], [3400, 1.2, 2]],
      lp: 9500,
      max: 1.8,
    },
    level: 1.27,
  },
  // 切分的短音型（D 多利亚一类）
  demo: { key: "D dorian", qpm: 104, bars: 4, abc: "D/2D/2 F A/2G/2 F/2E/2 D z/2A/2 G/2F/2 E/2D/2 | D/2D/2 F A/2c/2 d/2c/2 A z/2G/2 F/2E/2 D | D/2D/2 F A/2G/2 F/2E/2 D z/2A/2 G/2F/2 E/2D/2 | D4 z4" },
};
