// 卡拉卡布（马格里布，格纳瓦的大铁响板，也写 krakeb）：一对两头宽、中间细的铁片，一只手一副，开合相撞——
// “咔”的一声又响又带金属的余音（几支不谐和的分音），合上不放开的“嚓”短而闷；
// 两只手交替，打出格纳瓦那种不均匀的三连音（咔—嚓咔，咔—嚓咔），整夜不停。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const QRAQEB: RegionalDef = {
  region: "maghreb",
  name: { zh: "卡拉卡布铁响板", en: "Qraqeb" },
  drums: {
    qraqeb: { layers: [skin(1880, 1860, 0.004, 0.09, 0.45, [[1.52, 0.7, 0.07], [2.27, 0.5, 0.05], [3.13, 0.3, 0.04]], 0.001), hiss(2000, 10000, 0.04, 1, { taps: 2, attack: 0.0012 })] },
    qraqeb_shut: { layers: [skin(1700, 1690, 0.004, 0.035, 0.3, [[1.52, 0.4, 0.025]], 0.001), hiss(2500, 9000, 0.018, 0.8, { attack: 0.0012 })] },
  },
  // 6/8 放在 4/4 的格子里只是示范：两只手交替的三连音（咔 · 嚓 咔 · 嚓……）
  demo: { key: "C major", qpm: 104, bars: 4, drum: [{ steps: "K.sK.sK.sK.sK.sK.sK.sK.sK.sK.sKK", hits: { K: ["qraqeb", 0.85], s: ["qraqeb_shut", 0.6] } }] },
};
