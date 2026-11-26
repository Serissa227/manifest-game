// 东巴克（波斯的杯形鼓，又叫扎尔布）：整块桑木挖成，蒙羊皮，抱在怀里用十个手指打——
// 鼓心的“通”（tom）是木腔里圆而低的回响（比铝鼓身的达布卡低、余音更“木”）；鼓边的“巴克”（bak）干而脆，没有金属的余响；
// 无名指弹出去的“佩朗”（pelang）像一声响指；几根手指接连滚过鼓边的“里兹”（riz）是一串细碎的“嗒啦啦”。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TOMBAK: RegionalDef = {
  region: "persia",
  name: { zh: "东巴克鼓", en: "Tombak" },
  drums: {
    tombak_tom: { layers: [skin(108, 78, 0.022, 0.6, 1, [[1.58, 0.24, 0.22], [2.27, 0.1, 0.12]], 0.0005), hiss(90, 700, 0.06, 0.3), hiss(700, 2500, 0.012, 0.12)] },
    tombak_bak: { layers: [skin(600, 585, 0.007, 0.085, 0.55, [[1.47, 0.32, 0.05], [2.18, 0.18, 0.035]], 0.0004), hiss(1700, 6500, 0.022, 0.65, { attack: 0.0005 })] },
    tombak_pelang: { layers: [hiss(2500, 9500, 0.012, 1, { attack: 0.0004 }), skin(1150, 1100, 0.005, 0.028, 0.35, undefined, 0.0003)] },
    tombak_riz: { layers: [hiss(1400, 6000, 0.05, 0.6, { taps: 6, attack: 0.001 }), skin(560, 540, 0.008, 0.11, 0.3, undefined, 0.0005)] },
  },
  // 6/8 的“六拍”放在 4/4 的格子里：通 · 巴克 通 巴克 ·，后面滚指与响指
  demo: {
    key: "C major",
    qpm: 92,
    bars: 4,
    drum: [{ steps: "T.bTb.T.bTrrT.bTb.T.bTppT.bTrrrr", hits: { T: ["tombak_tom", 0.9], b: ["tombak_bak", 0.75], r: ["tombak_riz", 0.5], p: ["tombak_pelang", 0.6] } }],
  },
};
