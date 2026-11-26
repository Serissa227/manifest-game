// 甘吉拉（南印度的小框鼓）：巴掌大的木框蒙着蜥蜴皮，框上只有一对铜铃片；左手的指头从背面压鼓皮，低音一边响一边往上走，
// 右手的指尖打出又高又脆的一下、铃片“嚓”地跟着。卡纳提克音乐会里坐在姆里丹加姆旁边（打击乐独奏 tani avartanam 时与它一问一答）。
// 鼓点：Bass（低音、压上去）、Ta（指尖的高音 + 铃片）、Ki（轻的铃片）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const KANJIRA: RegionalDef = {
  region: "india",
  name: { zh: "甘吉拉", en: "Kanjira" },
  drums: {
    kanj_bass: { layers: [skin(165, 225, 0.09, 0.45, 1, [[1.6, 0.2, 0.15]]), hiss(4000, 11000, 0.07, 0.3, { taps: 2 })] },
    kanj_ta: { layers: [skin(430, 405, 0.01, 0.1, 0.6), hiss(3500, 11000, 0.06, 0.75, { taps: 2 })] },
    kanj_ki: { layers: [hiss(4500, 12000, 0.04, 0.75, { taps: 2 }), skin(500, 480, 0.01, 0.04, 0.2)] },
  },
  // 阿迪塔拉：低音（推上去）· 嗒 嚓 · 嗒 · 嚓 | 低音 · 嚓 嗒 · 嚓 嗒 嚓
  demo: {
    key: "E major",
    qpm: 84,
    bars: 4,
    drum: [{ steps: "B.tk.t.kB.kt.ktk", hits: { B: ["kanj_bass", 0.85], t: ["kanj_ta", 0.7], k: ["kanj_ki", 0.55] } }],
  },
};
