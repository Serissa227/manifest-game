// 法阿特特（塔希提的 faʻatete）：一只小的立鼓，挖空的木头蒙一张鲨鱼皮（后来也有羊皮），用两根细木棍敲——
// 高、紧、脆，比帕胡鼓的“帕”高得多，余音比普纽膝鼓长一点（鼓皮绷得紧、会“响”）；棍子敲在鼓边的木头上是更干更亮的“嗒”（faatete_rim）。
// 奥特阿（ʻōteʻa）鼓舞里与托埃雷裂缝鼓、帕胡鼓一起奏：托埃雷滚十六分音符的花样，法阿特特在下面守着一条不停的八分音符。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const FAATETE: RegionalDef = {
  region: "pacific",
  name: { zh: "法阿特特小鼓", en: "Faʻatete (Tahitian stick drum)" },
  drums: {
    // 起音 1.2–1.5 毫秒：棍子敲下去仍然脆，又不会在静处单独敲时变成一下“咔嗒”
    faatete: { layers: [skin(470, 420, 0.006, 0.17, 0.9, [[1.59, 0.34, 0.07], [2.14, 0.2, 0.05], [2.65, 0.1, 0.03]], 0.0012), hiss(2000, 9000, 0.007, 0.5, { attack: 0.0015 })] },
    faatete_rim: { layers: [skin(980, 950, 0.003, 0.05, 0.45, [[1.72, 0.3, 0.03]], 0.0012), hiss(2600, 10000, 0.005, 0.7, { attack: 0.0015 })] },
  },
  // 八分音符不停，重音落在 3 + 3 + 2 上（与拉利木鼓一样横过四拍），每小节最后一下敲边
  demo: { key: "C major", qpm: 110, bars: 3, drum: [{ steps: "F.f.f.F.f.f.F.r.F.f.f.F.f.f.F.r.F.f.f.F.f.ffF.r.", grid: 0.5, hits: { F: ["faatete", 0.9], f: ["faatete", 0.5], r: ["faatete_rim", 0.7] } }] },
};
