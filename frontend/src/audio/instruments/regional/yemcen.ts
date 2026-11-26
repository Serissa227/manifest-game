// 神鼓（满语 yemcen，女真与满洲的萨满鼓）：单面的大框鼓，鼓背用皮绳拴着握手，握手上挂着铁环；
// 萨满用细鼓鞭打，鼓心是低沉的“咚”（yemcen），靠边打是高一点、干一点的“嗒”（yemcen_edge），每一下铁环都跟着“哗啦”地抖。
// 跳神时鼓点由慢到快、由疏到密，与腰铃一起。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const YEMCEN: RegionalDef = {
  region: "jurchen",
  name: { zh: "神鼓（萨满的单鼓）", en: "Yemcen (shaman drum)" },
  drums: {
    yemcen: {
      layers: [
        skin(105, 78, 0.03, 0.5, 1, [[1.59, 0.3, 0.25], [2.14, 0.2, 0.18], [2.65, 0.12, 0.12]], 0.0008),
        // 握手上的铁环
        hiss(2500, 9000, 0.3, 0.32, { attack: 0.002, taps: 5 }),
        // 鼓鞭打在皮上
        hiss(400, 2000, 0.02, 0.3, { attack: 0.001 }),
      ],
    },
    yemcen_edge: {
      layers: [skin(260, 230, 0.01, 0.15, 0.7, [[1.6, 0.35, 0.06]], 0.0006), hiss(2500, 9000, 0.25, 0.4, { attack: 0.002, taps: 5 }), hiss(1500, 7000, 0.01, 0.5, { attack: 0.001 })],
    },
  },
  // 咚 · 咚 咚 · 嗒 | 咚咚咚咚嗒嗒（越打越密）
  demo: { key: "C major", qpm: 112, bars: 3, drum: [{ steps: "D.dD.eD.dD.eDdDdee", hits: { D: ["yemcen", 0.9], d: ["yemcen", 0.55], e: ["yemcen_edge", 0.6] } }] },
};
