// 三线（さんしん，琉球）：蒙蟒蛇皮的小琴箱、三根弦，食指上套着水牛角的拨子（チミ）往下弹——
// 声音圆、亮、带一点鼻音的“嘣嘣”，蛇皮让起音有一下柔的“噗”；没有三味线的 sawari（不“嗞”），余音比三味线长一点、软一点。
// 本调子（C–F–c）定弦，唱歌时自己弹自己伴；勾弦写 !slide!，倚音是左手的打音。
import type { RegionalDef } from "./types";

export const SANSHIN: RegionalDef = {
  key: "sanshin",
  region: "ryukyu",
  name: { zh: "三线（琉球）", en: "Sanshin" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 1.5,
      tilt: 0.45,
      bright: 0.74,
      pick: 0.14,
      damp: 0.15,
      thump: 0.08,
      // 拨子碰到蛇皮的一下
      skin: [300, 0.045, 0.18],
      body: [[320, 1.3, 4], [850, 1.2, 1], [2100, 1.2, 4], [4000, 1.1, 1]],
      lp: 8500,
      max: 2.4,
    },
    level: 1.02,
  },
  // 琉球音阶（C E F G B）：E–F、B–C 两个半音是它的颜色
  demo: { key: "C major", qpm: 96, bars: 4, abc: "C2 E F G2 B2 | c2 {c}B G !slide!G4 | F2 G E F2 E C | E2 {F}E C !slide!C4" },
};
