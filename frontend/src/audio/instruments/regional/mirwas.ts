// 米尔瓦斯（阿拉伯，海湾的小双面鼓）：巴掌大的木框两面蒙皮，一只手托着、另一只手打——
// 鼓心的“咚”高而紧（300 Hz 一带，比达布卡、东巴克的“咚”高得多），鼓边的“嗒”是很脆的一响；
// 海湾的“萨乌特”与采珠船歌里，它在乌德琴与拍手底下打 3 + 3 + 2 的跛足拍子。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const MIRWAS: RegionalDef = {
  region: "arabia",
  name: { zh: "米尔瓦斯小鼓", en: "Mirwas" },
  drums: {
    mirwas_dum: { layers: [skin(330, 292, 0.008, 0.2, 1, [[1.59, 0.3, 0.08], [2.14, 0.16, 0.06]], 0.0008), hiss(350, 2600, 0.026, 0.3, { attack: 0.001 })] },
    mirwas_tak: { layers: [skin(940, 915, 0.004, 0.065, 0.4, [[1.62, 0.3, 0.035]], 0.0007), hiss(2600, 9500, 0.03, 0.85, { attack: 0.001 })] },
  },
  // 3 + 3 + 2：咚 · · 嗒 · · 嗒 ·，第二小节加花
  demo: { key: "C major", qpm: 96, bars: 4, drum: [{ steps: "D..T..T.D..T.TT.D..T..T.D.TT.TT.", hits: { D: ["mirwas_dum", 0.85], T: ["mirwas_tak", 0.65] } }] },
};
