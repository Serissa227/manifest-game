// 敦敦鼓（西非曼丁的双面低音鼓，dunun）：三只一组，大的敦巴（dunun ba）、中的桑班（sangban）、小的肯凯尼（kenkeni），
// 横放着用木棒敲，另一只手拿铁棒敲绑在鼓上的铁铃（kenken）——鼓与铃一起打出各自的型，是金贝鼓队的骨架与旋律。
// 棒子按在鼓皮上不放是闷音（_m）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const DUNDUN: RegionalDef = {
  region: "guinea",
  name: { zh: "敦敦鼓（三只与铁铃）", en: "Dundun (dunun set)" },
  drums: {
    dundun_ba: { layers: [skin(72, 58, 0.03, 0.7, 1, [[1.5, 0.2, 0.3]]), hiss(60, 500, 0.04, 0.3)] },
    dundun_ba_m: { layers: [skin(74, 60, 0.02, 0.12, 1), hiss(80, 700, 0.03, 0.35)] },
    dundun_sang: { layers: [skin(112, 96, 0.02, 0.45, 1, [[1.55, 0.2, 0.2]]), hiss(100, 900, 0.03, 0.3)] },
    dundun_ken: { layers: [skin(172, 156, 0.015, 0.3, 1, [[1.6, 0.2, 0.15]]), hiss(200, 1500, 0.02, 0.3)] },
    dundun_bell: { layers: [skin(2150, 2150, 0.01, 0.14, 0.8, [[1.38, 0.6, 0.09], [2.1, 0.3, 0.05]]), hiss(3000, 10000, 0.01, 0.4)], vary: 0.01 },
  },
  // 铁铃一直打，敦巴与桑班在下面对话
  demo: {
    key: "C major",
    qpm: 104,
    bars: 3,
    drum: [
      { steps: "x.xx.xx.x.xx.xx.x.xx.xx.", hits: { x: ["dundun_bell", 0.7] } },
      { steps: "B..b..S.B..b..SSB..b..S.", hits: { B: ["dundun_ba", 0.85], b: ["dundun_ba_m", 0.7], S: ["dundun_sang", 0.75] } },
      { steps: "..k...k...k...k...k..kk.", hits: { k: ["dundun_ken", 0.7] } },
    ],
  },
};
