// 加塔姆（南印度的陶罐鼓）：一只掺了铜屑与铁屑烧硬的大陶罐，罐口抵在乐手肚子上；指尖与指甲敲罐颈，是又硬又脆的陶瓷“嗒”，
// 手掌拍罐腹，罐里的空气“嘭”地一响；把罐口在肚子上一压一放，低音就往上推（gumki）。卡纳提克音乐会里与姆里丹加姆、甘吉拉一起。
// 鼓点：Ta（指尖敲罐颈）、Ki（轻的一下）、Thom（手掌拍罐腹）、Gumki（罐口压着肚子，低音往上推）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const GHATAM: RegionalDef = {
  region: "india",
  name: { zh: "加塔姆（陶罐）", en: "Ghatam" },
  drums: {
    ghatam_ta: { layers: [skin(520, 500, 0.005, 0.1, 0.5, [[2.3, 0.45, 0.05], [3.9, 0.3, 0.03]], 0.0002), hiss(2000, 7000, 0.015, 0.8, { attack: 0.0006 })] },
    ghatam_ki: { layers: [skin(560, 540, 0.005, 0.06, 0.3, [[2.3, 0.3, 0.03]], 0.0002), hiss(2500, 8000, 0.01, 0.6, { attack: 0.0006 })] },
    ghatam_thom: { layers: [skin(140, 110, 0.02, 0.35, 1, [[2.7, 0.2, 0.06]]), hiss(150, 1200, 0.05, 0.5)] },
    ghatam_gumki: { layers: [skin(95, 140, 0.1, 0.5, 1), hiss(150, 900, 0.04, 0.3)] },
  },
  // 阿迪塔拉：嘭 · 嗒 嘀 · 嘀 嗒 · | 推 · 嗒 嘀 嗒 嘀 嗒 ·
  demo: {
    key: "E major",
    qpm: 84,
    bars: 4,
    drum: [{ steps: "O.tk.kt.G.tktkt.", hits: { O: ["ghatam_thom", 0.85], G: ["ghatam_gumki", 0.8], t: ["ghatam_ta", 0.75], k: ["ghatam_ki", 0.55] } }],
  },
};
