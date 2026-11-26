// 塔夸普（图皮—瓜拉尼人的跺地竹筒，takuapu）：一截粗竹筒，下端有节封着，女人们握着它往地上一顿——
// 闷的一声落地，跟着竹筒里的空气“嗡”地一响：一端封闭的管只有奇次谐波（3 倍、5 倍），所以是空空的“咚”。长短两根，一低一高。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TAKUAPU: RegionalDef = {
  region: "tupi",
  name: { zh: "塔夸普跺地竹筒", en: "Takuapu (stamping tube)" },
  drums: {
    takuapu: { layers: [skin(170, 165, 0.006, 0.28, 1, [[3, 0.3, 0.1], [5, 0.12, 0.05]], 0.0006), hiss(70, 500, 0.04, 0.5), hiss(800, 3000, 0.008, 0.2, { attack: 0.002 })], vary: 0.015 },
    takuapu_hi: { layers: [skin(226, 220, 0.006, 0.24, 1, [[3, 0.28, 0.08], [5, 0.1, 0.04]], 0.0006), hiss(70, 500, 0.04, 0.45), hiss(900, 3200, 0.008, 0.2, { attack: 0.002 })], vary: 0.015 },
  },
  // 围圈踏步：低 · 高 · 低 · 高 ·
  demo: { key: "C major", qpm: 112, bars: 3, drum: [{ steps: "T.t.T.t.T.t.T.ttT.t.T.t.", hits: { T: ["takuapu", 0.85], t: ["takuapu_hi", 0.65] } }] },
};
