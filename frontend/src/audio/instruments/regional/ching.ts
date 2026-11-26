// 钦（ching，暹罗的一对小碗钹，用绳子连着）：两只厚的小铜碗边对边一碰，“钦——”地长鸣；碰了马上合住是“恰”（chap）。
// 它是暹罗音乐的“拍子”：开的“钦”落在弱拍、合的“恰”落在强拍（一句的最后一拍最重），三种速度层（sam chan、song chan、chan diao）各有疏密。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const CHING: RegionalDef = {
  region: "siam",
  name: { zh: "钦（碗钹）", en: "Ching" },
  drums: {
    // 开：两只碗的音高差一点，合起来“嗡嗡”地颤；铜的分音不成倍数
    ching: {
      layers: [
        skin(2650, 2650, 0.01, 1.5, 0.7, [[1.41, 0.55, 1.2], [1.93, 0.4, 0.9], [2.62, 0.3, 0.6], [3.4, 0.2, 0.4]], 0.0004),
        skin(2718, 2718, 0.01, 1.2, 0.4, [[1.43, 0.4, 0.9]], 0.0004),
        hiss(3500, 11000, 0.25, 0.25, { attack: 0.001 }),
      ],
      vary: 0.01,
    },
    // 合：碰一下就按住
    chap: {
      layers: [skin(2650, 2650, 0.01, 0.09, 0.6, [[1.41, 0.5, 0.07], [1.93, 0.4, 0.05]], 0.0004), hiss(2500, 9000, 0.05, 0.9, { attack: 0.001 }), hiss(800, 3000, 0.02, 0.3)],
      vary: 0.01,
    },
  },
  // song chan 两小节（钦在第二拍、恰在第四拍），最后一小节转 chan diao（每拍一下）
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "..o...c...o...c.o.c.o.c.", hits: { o: ["ching", 0.8], c: ["chap", 0.85] } }] },
};
