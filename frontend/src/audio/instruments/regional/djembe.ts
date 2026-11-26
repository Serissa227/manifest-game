// 金贝鼓（西非曼丁的高脚杯形鼓）：一整块木头挖成，蒙羊皮，用绳子绷得很紧——三种手法：
// 低音（bass，手掌拍鼓心，“咚”）、开音（tone，手指并拢拍鼓边，“通”，有音高）、拍音（slap，手指松开抽在鼓边，“啪”，又高又脆、能穿透整个鼓队）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const DJEMBE: RegionalDef = {
  region: "guinea",
  name: { zh: "金贝鼓", en: "Djembe" },
  drums: {
    djembe_bass: { layers: [skin(88, 70, 0.02, 0.35, 1, [[1.6, 0.2, 0.15]]), hiss(80, 600, 0.03, 0.3)] },
    djembe_tone: { layers: [skin(330, 312, 0.01, 0.22, 0.9, [[1.5, 0.4, 0.15], [2, 0.25, 0.1], [2.6, 0.15, 0.06]]), hiss(1500, 6000, 0.012, 0.4)] },
    djembe_slap: { layers: [skin(430, 390, 0.005, 0.06, 0.5, [[1.7, 0.3, 0.04]]), hiss(2500, 11000, 0.04, 1)] },
  },
  // 伴奏的一个型（四拍，十六分音符）：低 · 开 开 拍 · 开 开 | ……
  demo: {
    key: "C major",
    qpm: 104,
    bars: 3,
    drum: [{ grid: 0.5, steps: "B.ttS.ttB.ttS.SSB.ttS.ttB.ttS.SSB.ttS.ttBBttSSSS", hits: { B: ["djembe_bass", 0.85], t: ["djembe_tone", 0.7], S: ["djembe_slap", 0.8] } }],
  },
};
