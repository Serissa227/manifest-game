// 拍板（phách，大越的竹拍）：一块竹片用两根小木棍敲，“嗒嗒”的又干又脆——歌筹（ca trù）与丝竹里打着板眼。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const PHACH: RegionalDef = {
  region: "vietnam",
  name: { zh: "拍板（竹拍）", en: "Phách" },
  drums: {
    phach: { layers: [skin(1450, 1420, 0.01, 0.07, 0.7, [[1.6, 0.35, 0.05]], 0.0005), hiss(1800, 7000, 0.012, 0.8, { attack: 0.0008 })] },
  },
  demo: { key: "C major", qpm: 96, bars: 3, drum: [{ steps: "x.x.xx.x..x.x.xxx.x.x..x", hits: { x: ["phach", 0.8] } }] },
};
