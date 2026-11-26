// 伊利伊利（夏威夷的 ʻiliʻili）：两对被海水磨圆的玄武岩小石子，每只手两颗，像响板一样对敲——
// 很高、很短的“嗒”，石头的分音不成倍数；坐着跳的呼拉里一直跟着节拍点。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const ILILI: RegionalDef = {
  region: "pacific",
  name: { zh: "伊利伊利卵石", en: "ʻIliʻili (water-worn stones)" },
  drums: {
    // 起音留 2 毫秒上下：石头的高音与高频噪声在安静处一下子跳上去会被当成“咔嗒”
    ilili: { layers: [skin(2900, 2870, 0.004, 0.03, 0.7, [[1.52, 0.45, 0.02], [2.31, 0.25, 0.012]], 0.0018), hiss(3500, 10000, 0.004, 0.4, { attack: 0.0022 })] },
  },
  demo: { key: "C major", qpm: 96, bars: 3, drum: [{ grid: 0.5, steps: "i.i.i.iii.i.i.iii.i.i.iii.i.i.i.i.i.i.iii.i.iiii", hits: { i: ["ilili", 0.8] } }] },
};
