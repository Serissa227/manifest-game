// 库迪亚皮（kudyapi，马京达瑙与马拉瑙的船形二弦琴）：一根弦上有蜂蜡粘的品、奏旋律，另一根空弦一直“嗡”地给持续音；藤片拨，亮、带鼻音。
// 曲谱里旋律与空弦（G 一带）交替着写。夜里求爱、讲故事的乐器。
import type { RegionalDef } from "./types";

export const KUDYAPI: RegionalDef = {
  key: "kudyapi",
  region: "philippines",
  name: { zh: "库迪亚皮（船形琴）", en: "Kudyapi" },
  instrument: {
    kind: "pluck",
    spec: { t60: 1.7, tilt: 0.45, bright: 0.86, pick: 0.07, damp: 0.12, thump: 0.1, body: [[240, 1.4, 4], [820, 1.3, 3], [2400, 1.2, 2]], lp: 8500, max: 2.6 },
    level: 0.99,
  },
  demo: { key: "G major", qpm: 92, bars: 3, abc: "G, d G, B G, A G2 | G, B G, d !bend!e2 d B | G, A G, G !vib!E2 D2" },
};
