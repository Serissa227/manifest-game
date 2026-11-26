// 采纳齐尔（埃塞俄比亚正教会的叉铃，sistrum）：U 形的铜架上穿着几根横杆，杆上套着小铜片，执事一摇“沙啦——”；
// 与凯贝罗鼓一起伴着祈祷的歌（梅兹穆尔）与宗教节庆的游行。轻摇是一串细碎的“沙”，重摇多几下、更亮。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TSENATSIL: RegionalDef = {
  region: "ethiopia",
  name: { zh: "采纳齐尔（叉铃）", en: "Tsenatsil (sistrum)" },
  drums: {
    tsenatsil: { layers: [hiss(3500, 11000, 0.14, 0.9, { attack: 0.004, taps: 6 }), skin(2600, 2600, 0.01, 0.12, 0.08, [[1.43, 0.6, 0.1], [2.2, 0.4, 0.08]])], vary: 0.02 },
    tsenatsil_soft: { layers: [hiss(4000, 11000, 0.1, 0.6, { attack: 0.008, taps: 4 })], vary: 0.02 },
  },
  // 一摇一停：沙啦 · 沙 · 沙啦 · ·
  demo: { key: "C major", qpm: 84, bars: 3, drum: [{ steps: "T.s.T..sT.s.T..sT.s.Ts..", hits: { T: ["tsenatsil", 0.8], s: ["tsenatsil_soft", 0.6] } }] },
};
