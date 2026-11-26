// 意大利铃鼓（tamburello，南意大利的大铃鼓）：比阿拉伯的里克大，鼓皮低一点、铃片多，拍一下“嘭”带一串“铃铃”，摇起来“沙啦啦”；
// 塔兰泰拉与弗罗托拉一类的舞曲、街头的歌都靠它打拍子。原有的 riq / shake（经典世界在用）更小、更亮。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TAMBURELLO: RegionalDef = {
  region: "iberia_italy",
  name: { zh: "意大利铃鼓", en: "Tamburello" },
  drums: {
    tamburello: { layers: [skin(260, 220, 0.01, 0.08, 0.5), hiss(5500, 12500, 0.11, 1, { taps: 4 })] },
    tamburello_shake: { layers: [hiss(5000, 12000, 0.14, 0.85, { attack: 0.018, taps: 5 })] },
  },
  demo: { key: "C major", qpm: 112, bars: 3, drum: [{ steps: "T.s.t.s.T.s.t.ssT.s.t.sT", hits: { T: ["tamburello", 0.8], t: ["tamburello", 0.5], s: ["tamburello_shake", 0.5] } }] },
};
