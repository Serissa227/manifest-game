// 库都姆（奥斯曼宫廷与苏菲音乐的一对小铜鼓）：低的一只“咚”、高的一只“嗒”，干、短，按乌苏尔（节奏型）打。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const KUDUM: RegionalDef = {
  region: "ottoman",
  name: { zh: "库都姆", en: "Kudüm" },
  drums: {
    kudum_dum: { layers: [skin(180, 150, 0.01, 0.22, 1, [[1.6, 0.2, 0.1]]), hiss(400, 2500, 0.015, 0.4)] },
    kudum_tek: { layers: [skin(420, 400, 0.01, 0.1, 0.7, [[1.6, 0.3, 0.06]]), hiss(1500, 7000, 0.015, 0.6)] },
  },
  // 杜耶克（düyek）：咚 · 嗒嗒 · 咚 嗒 ·
  demo: { key: "C major", qpm: 96, bars: 3, drum: [{ steps: "D.tt.Dt.D.tt.Dt.D.tt.Dtt", hits: { D: ["kudum_dum", 0.9], t: ["kudum_tek", 0.7] } }] },
};
