// 帕胡鼓（夏威夷与社会群岛的 pahu）：一整段挖空的椰子树干或面包树干立在地上，蒙鲨鱼皮，用手掌与手指打——
// 鼓身又高又长，低音“嘣”得很深、余音里有鼓身的分音与鼓腔的空气声（与原有的群岛大鼓 pahu 不同：余音长得多、有手掌的一下）；
// 手指打鼓边是“帕”（pahu_pa）。哈拉乌的 hula pahu 里慢、重、隔得很开。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const PAHU: RegionalDef = {
  region: "pacific",
  name: { zh: "帕胡鼓（鲨皮鼓）", en: "Pahu (sharkskin drum)" },
  drums: {
    pahu_nui: { layers: [skin(150, 82, 0.03, 1.0, 1, [[1.47, 0.3, 0.45], [1.98, 0.16, 0.3], [2.6, 0.08, 0.18]], 0.001), hiss(60, 300, 0.12, 0.35), hiss(500, 3000, 0.012, 0.22)] },
    pahu_pa: { layers: [skin(330, 290, 0.01, 0.18, 0.7, [[1.6, 0.35, 0.08], [2.25, 0.18, 0.05]], 0.0006), hiss(800, 5000, 0.02, 0.6)] },
  },
  // 慢、重：嘣 · · 帕 嘣 · · · | 嘣 · · 帕 嘣 · 帕 · | 嘣 · 嘣 · 嘣 · · ·
  demo: { key: "C major", qpm: 80, bars: 3, drum: [{ steps: "D..pD...D..pD.p.D.D.D...", hits: { D: ["pahu_nui", 0.9], p: ["pahu_pa", 0.7] } }] },
};
