// 塔布勒（阿拉伯，上埃及的“塔布勒·巴拉迪”）：挂在胸前的双面大鼓，右手粗槌打低音面“咚”，左手一根细藤条打另一面“嗒”——
// 与米兹玛尔一起是集市、婚礼与棍舞的户外乐队。比奥斯曼的达乌尔更沉、更“闷”（鼓腔里低频的回响长），藤条的“嗒”更干。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TABL: RegionalDef = {
  region: "arabia",
  name: { zh: "塔布勒大鼓", en: "Tabl baladi" },
  drums: {
    tabl_dum: { layers: [skin(92, 56, 0.045, 0.75, 1, [[1.48, 0.3, 0.32], [2.06, 0.14, 0.2]], 0.0006), hiss(50, 300, 0.12, 0.55), hiss(300, 1800, 0.025, 0.25)] },
    tabl_tak: { layers: [skin(420, 395, 0.008, 0.045, 0.3, undefined, 0.0004), hiss(2200, 8500, 0.028, 1, { attack: 0.0006 })] },
  },
  // 萨伊迪节奏（咚 嗒 · 咚 咚 · 嗒 ·）：棍舞的步子
  demo: { key: "C major", qpm: 104, bars: 4, drum: [{ steps: "DT.DD.T.DT.DD.T.DT.DD.TTDTTDD.T.", hits: { D: ["tabl_dum", 0.9], T: ["tabl_tak", 0.7] } }] },
};
