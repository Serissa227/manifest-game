// 奥图（南印度，纳达斯瓦拉姆旁边的持续音管）：与纳达斯瓦拉姆同样的双簧与喇叭口，但管上没有按孔，只吹一个萨（有时连着帕），
// 一口气接一口气地从不停下（循环换气）——大乐队底下那层粗的、嗡嗡的光，相当于坦布拉。曲谱里用持续音的伴奏型（drone）。
import { reedAmps } from "./shape";
import type { RegionalDef } from "./types";

export const OTTU: RegionalDef = {
  key: "ottu",
  region: "india",
  name: { zh: "奥图（持续音管）", en: "Ottu" },
  instrument: {
    kind: "pad",
    amps: reedAmps(0.34, [[800, 0.6, 0.7], [1800, 0.5, 0.5]], 6000),
    attack: 0.5,
    release: 0.8,
    // 两片簧的一点音差：慢慢地“翁——翁——”
    detune: 4,
    breath: { level: 0.015, q: 0.8, ratio: 3 },
    glide: 0.1,
    level: 0.31,
  },
  // 萨（E3）一直吹，中间换一口气接上帕
  demo: { key: "E major", qpm: 60, bars: 2, abc: "[E,B,]8 | [E,B,]6 E,2" },
};
