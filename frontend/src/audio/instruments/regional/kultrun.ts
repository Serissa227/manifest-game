// 库尔特伦（智利南部马普切人的鼓，kultrun）：一只浅浅的木碗（月桂木挖成）蒙上马皮或羊皮，碗里装着几粒小石子与种子，
// 女巫医（machi）一手托着、一手用一根裹着毛线的槌敲，鼓面上画着四方与天地。
// 声音是中低的“咚”，碗浅所以不像大鼓那样拖、比邦博鼓高；每一下之后碗里的石子跟着“沙啦”一阵（这是它与别的鼓最不一样的地方）。
// 寰宇世界里马普切诸部的风格是 andean，所以登记在安第斯一组。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const KULTRUN: RegionalDef = {
  region: "andes",
  name: { zh: "库尔特伦鼓（马普切）", en: "Kultrun (Mapuche)" },
  drums: {
    kultrun: { layers: [skin(185, 148, 0.016, 0.38, 1, [[1.59, 0.32, 0.14], [2.14, 0.18, 0.09], [2.65, 0.08, 0.06]], 0.0006), hiss(70, 420, 0.06, 0.4, { attack: 0.002 }), hiss(1400, 6000, 0.22, 0.3, { attack: 0.004, taps: 6 })] },
    kultrun_soft: { layers: [skin(180, 150, 0.016, 0.3, 0.7, [[1.59, 0.28, 0.1], [2.14, 0.14, 0.07]], 0.0006), hiss(1500, 6000, 0.16, 0.24, { attack: 0.004, taps: 4 })] },
  },
  // 女巫医的鼓点：重 · 轻 重 · 轻……（长短的三拍子一样地连着走），末尾一阵快的轻击
  demo: { key: "C major", qpm: 96, bars: 3, drum: [{ steps: "K.kK.kK.kK.kK.kK.kkkK...", hits: { K: ["kultrun", 0.85], k: ["kultrun_soft", 0.55] } }] },
};
