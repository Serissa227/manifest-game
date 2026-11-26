// 伊达卡（喀拉拉的沙漏鼓）：挂在左肩上，右手拿一根细木棍敲，左手捏紧或放松两面鼓皮之间的绳子——敲一下就有清楚的音高，
// 还能一边响一边把音推上去、落下来，所以它能“唱”：喀拉拉庙宇里的索帕纳歌（sopana sangeetham）就由它跟着唱腔走。
// 曲谱里当有音高的击奏写旋律：推上去写 !bend!，落下写 !fall!，滑上去写 !slide!。
import type { RegionalDef } from "./types";

export const EDAKKA: RegionalDef = {
  key: "edakka",
  region: "india",
  name: { zh: "伊达卡（沙漏鼓）", en: "Edakka" },
  instrument: {
    kind: "mallet",
    spec: {
      // 绷得很紧的鼓皮：基音清楚、八度与十二度的分音弱、还有一点鼓皮的非谐分音（1.52 倍）
      partials: [[1, 1, 0.5], [2.0, 0.32, 0.24], [2.98, 0.13, 0.12], [1.52, 0.12, 0.14]],
      attack: 0.001,
      // 细木棍敲在鼓皮上
      strike: [0.35, 0.006, 3000],
      tilt: 0.2,
      max: 1.2,
    },
    level: 1.22,
  },
  // 萨 = E：一句索帕纳的唱腔，推上去、落下
  demo: { key: "E major", qpm: 80, bars: 3, abc: "E2 !bend!F2 G2 !slide!B2 | !bend!B2 G F !fall!G4 | F E F G !bend!E4" },
};
