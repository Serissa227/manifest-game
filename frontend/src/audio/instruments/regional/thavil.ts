// 塔维尔（南印度的桶鼓，纳达斯瓦拉姆的搭档）：右面绷得极紧，鼓手的指头戴着米糊做的硬指套，打下去是一声能传过半个镇子的“嗒！”；
// 左面用一根粗木棍敲，低沉干脆的“咚”。响、硬、快，庙会与婚礼的游行里与纳达斯瓦拉姆、小钹、奥图一起（periya melam）。
// 鼓点：Ta（右面、硬指套的一下）、Ki（右面轻的一下）、Dhom（左面木棍）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const THAVIL: RegionalDef = {
  region: "india",
  name: { zh: "塔维尔", en: "Thavil" },
  drums: {
    thavil_ta: { layers: [skin(620, 560, 0.006, 0.12, 0.6, [[1.6, 0.4, 0.08], [2.3, 0.3, 0.05]], 0.0003), hiss(1800, 9000, 0.035, 1, { attack: 0.0008 })] },
    thavil_ki: { layers: [skin(700, 650, 0.006, 0.06, 0.4, undefined, 0.0003), hiss(2500, 9000, 0.02, 0.8, { attack: 0.0008 })] },
    thavil_dhom: { layers: [skin(95, 70, 0.025, 0.45, 1, [[1.55, 0.25, 0.15]]), hiss(150, 1500, 0.03, 0.5)] },
  },
  // 阿迪塔拉的一种走法：咚 · 嗒嗒 · 嗒 咚 嗒 | · 嗒 嗒 · 咚 · 嗒嗒
  demo: {
    key: "E major",
    qpm: 88,
    bars: 4,
    drum: [{ steps: "D.tt.tDt.tk.D.tt", hits: { D: ["thavil_dhom", 0.85], t: ["thavil_ta", 0.75], k: ["thavil_ki", 0.6] } }],
  },
};
