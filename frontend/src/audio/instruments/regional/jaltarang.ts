// 加尔塔朗（印度的“水琴”）：一排大小不一的瓷碗，盛着不同深浅的水来调音，用两根细竹签敲碗沿——清亮的“叮”，余音纯，
// 碗里的水一晃，音高也跟着微微地颤（同一个音分成两个相差两赫兹多的分音，拍出“水”的波动）；快的经过句一串串地落下来，像雨点。
// 南北两边都有，宫廷与庙会都奏。
import type { RegionalDef } from "./types";

export const JALTARANG: RegionalDef = {
  key: "jaltarang",
  region: "india",
  name: { zh: "加尔塔朗（水碗）", en: "Jaltarang" },
  instrument: {
    kind: "mallet",
    spec: {
      // 瓷碗：基音长、第二个振动模态约 2.7 倍、第三个约 5.2 倍（都很快消失）
      partials: [[1, 1, 2.2], [2.71, 0.16, 0.7], [5.2, 0.05, 0.25]],
      attack: 0.0015,
      // 细竹签的一下
      strike: [0.1, 0.003, 7000],
      // 水的晃动
      beat: 2.3,
      tilt: 0.35,
      max: 3,
    },
    level: 0.51,
  },
  // 汉萨德瓦尼（萨 = E）：一串落下来的音、再一串上去
  demo: { key: "E major", qpm: 84, bars: 3, abc: "e d B G F E F G | B d e f e2 d B | G F G B !vib!e4" },
};
