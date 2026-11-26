// 塔拉姆（南印度的一对小铜钹，北方叫曼吉拉，喀拉拉的叫伊拉塔拉姆）：两片厚的小钹一碰，“叮——”的一声余音很长；碰了马上捏住是短的“嚓”。
// 拍子的骨架：阿迪塔拉的第一、五、七拍（拍手的拍）敲开的“叮”，其余的拍敲闷的“嚓”；大乐队与游神里一直跟着。
// 鼓点：Talam（开，长鸣）、Talam_chik（闷，短）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TALAM: RegionalDef = {
  region: "india",
  name: { zh: "塔拉姆（小钹）", en: "Talam" },
  drums: {
    talam: { layers: [skin(1900, 1900, 0.01, 1.3, 0.5, [[1.48, 0.6, 1.1], [2.09, 0.5, 0.9], [2.71, 0.38, 0.7], [3.36, 0.28, 0.5]], 0.0005), hiss(5000, 12000, 0.45, 0.45, { attack: 0.001 })], vary: 0.01 },
    talam_chik: { layers: [hiss(3000, 10000, 0.04, 1, { attack: 0.0006 }), skin(1900, 1900, 0.01, 0.05, 0.3, [[1.48, 0.5, 0.04]], 0.0005)], vary: 0.01 },
  },
  // 阿迪塔拉的拍：叮 · 嚓 · 嚓 · 嚓 · | 叮 · 嚓 · 叮 · 嚓 ·
  demo: {
    key: "E major",
    qpm: 84,
    bars: 4,
    drum: [{ steps: "C.c.c.c.C.c.C.c.", hits: { C: ["talam", 0.75], c: ["talam_chik", 0.6] } }],
  },
};
