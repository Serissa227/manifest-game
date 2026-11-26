// 小金（꽹과리，朝鲜）：巴掌大的扁铜锣，用硬木槌敲，又尖又亮、满是不协和的分音——农乐（풍물）与四物（사물）的领奏，
// 打法念“갱”（开着敲，金属的余音一片）与“갠 / 지”（左手的手指按住锣背，一下就止）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const KKWAENGGWARI: RegionalDef = {
  region: "korea",
  name: { zh: "小金（꽹과리）", en: "Kkwaenggwari" },
  drums: {
    kkwaeng: {
      layers: [
        skin(1180, 1180, 0.01, 0.7, 0.7, [[1.37, 0.8, 0.6], [1.92, 0.7, 0.5], [2.6, 0.55, 0.4], [3.3, 0.4, 0.3], [4.1, 0.3, 0.25]], 0.0005),
        hiss(2500, 10000, 0.25, 0.6, { attack: 0.0008 }),
        hiss(800, 3000, 0.05, 0.3, { attack: 0.0008 }),
      ],
    },
    kkwaeng_mute: {
      layers: [
        skin(1180, 1180, 0.01, 0.08, 0.7, [[1.37, 0.8, 0.07], [1.92, 0.7, 0.06], [2.6, 0.55, 0.05], [3.3, 0.4, 0.04]], 0.0005),
        hiss(2500, 10000, 0.04, 0.6, { attack: 0.0008 }),
      ],
    },
  },
  // 갱 · 갠지 갱 · 갠지（开、按、开）
  demo: { key: "C major", qpm: 104, bars: 3, drum: [{ steps: "X.xxX.xxX.x.X...", hits: { X: ["kkwaeng", 0.85], x: ["kkwaeng_mute", 0.6] } }] },
};
