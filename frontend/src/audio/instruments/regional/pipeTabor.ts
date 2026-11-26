// 三孔笛与塔博鼓（pipe and tabor：加泰罗尼亚的 flabiol 与 tamborí、巴斯克的 txistu、普罗旺斯的 galoubet）：一个人左手吹只有三个孔的细笛，
// 右手拿一根槌敲挂在左臂上的小鼓——乡村的节日、游行与舞蹈都靠这一个人。笛管细，靠超吹奏出泛音列上的音：尖、亮、带沙沙的气声，吐音很脆；
// 鼓的皮面上横着一根羊肠响弦，一敲“嚓”地带一串沙声，比原有的 tabor（经典世界在用）更深、响弦更长。
// 鼓点名 tambori / tambori_soft（加泰罗尼亚的 tamborí）：原来叫 taborin，与北欧的小鼓（taborin.ts）重名，整合时改成这个名字。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const PIPE_TABOR: RegionalDef = {
  key: "pipe",
  region: "iberia_italy",
  name: { zh: "三孔笛与塔博鼓", en: "Pipe and tabor" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.28, 0.24, 0.1, 0.07, 0.035][n - 1] ?? 0,
    attack: 0.02,
    release: 0.05,
    vib: { rate: 5.6, depth: 7, delay: 0.25 },
    breath: { level: 0.06, q: 1.2, ratio: 2.2 },
    pulse: { level: 0.06, q: 1.1, ratio: 3.2 },
    chiff: 0.14,
    tongue: 0.38,
    glide: 0.02,
    drift: 3,
    level: 0.255,
  },
  drums: {
    tambori: { layers: [skin(205, 168, 0.012, 0.2, 0.9, [[1.59, 0.3, 0.12], [2.14, 0.15, 0.08]]), hiss(1100, 5200, 0.17, 0.75, { taps: 3 }), hiss(2500, 8000, 0.01, 0.3)] },
    tambori_soft: { layers: [skin(215, 180, 0.01, 0.12, 0.55), hiss(1100, 5200, 0.12, 0.55, { taps: 2 })] },
  },
  // 6/8 的舞曲：笛子一句、鼓“咚 · 嚓 咚 · 嚓”（这里按 4/4 的格子示范）
  demo: {
    key: "G minor",
    qpm: 120,
    bars: 4,
    abc: "d' d' d' g'2 d' b2 | ^f'2 e' d' c'2 a2 | b a g d'2 g' ^f'2 | g'8",
    drum: [{ steps: "T..tT.t.T..tT.t.T..tT.t.T.......", hits: { T: ["tambori", 0.8], t: ["tambori_soft", 0.6] } }],
  },
};
