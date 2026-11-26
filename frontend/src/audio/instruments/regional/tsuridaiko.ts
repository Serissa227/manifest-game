// 釣太鼓（日本雅乐的乐太鼓，tsuri-daiko）：吊在华丽的圆框里的大鼓，槌头包着皮，声音深、软、长，没有“咔”的一声；
// 每个节拍周期的末尾打一对：先是左手的轻击“图”（雌桴，tsuri_me），再是右手的重击“咚”（雄桴，tsuri_o）——雅乐里时间的刻度。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TSURIDAIKO: RegionalDef = {
  region: "japan",
  name: { zh: "钓太鼓", en: "Tsuri-daiko" },
  drums: {
    tsuri_me: { layers: [skin(80, 60, 0.06, 0.9, 1, [[1.5, 0.2, 0.4], [2.0, 0.12, 0.3]], 0.004), hiss(60, 380, 0.18, 0.45, { attack: 0.008 })] },
    tsuri_o: { layers: [skin(92, 58, 0.05, 1.8, 1, [[1.5, 0.3, 0.9], [1.98, 0.18, 0.6], [2.44, 0.1, 0.4]], 0.003), hiss(50, 300, 0.25, 0.5, { attack: 0.006 }), hiss(300, 1400, 0.03, 0.12, { attack: 0.003 })] },
  },
  // 留白很长：· · · 图 | 咚 · · · | · · · 图 | 咚
  demo: { key: "C major", qpm: 60, bars: 3, drum: [{ steps: "......m.O.......m.O.....", hits: { m: ["tsuri_me", 0.5], O: ["tsuri_o", 0.95] } }] },
};
