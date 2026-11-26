// 达乌尔（奥斯曼的大鼓）：挂在肩上，右手粗槌打低音面“咚”，左手细枝条打另一面“嗒”——与祖尔纳一起的户外鼓。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const DAVUL: RegionalDef = {
  region: "ottoman",
  name: { zh: "达乌尔大鼓", en: "Davul" },
  drums: {
    davul_dum: { layers: [skin(105, 62, 0.04, 0.8, 1, [[1.55, 0.28, 0.35], [2.2, 0.12, 0.2]]), hiss(60, 400, 0.08, 0.5), hiss(400, 2500, 0.02, 0.25)] },
    davul_tek: { layers: [skin(320, 300, 0.01, 0.06, 0.4), hiss(2500, 9000, 0.035, 1)] },
  },
  // 9/8 的卡希拉马（2+2+2+3）放在 4/4 的格子里只是示范：咚 · 嗒 嗒 咚 · 嗒 ·
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "D.ttD.t.D.t.Dtt.D.t.DDt.", hits: { D: ["davul_dum", 0.9], t: ["davul_tek", 0.7] } }] },
};
