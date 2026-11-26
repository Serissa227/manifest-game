// 普罗旺斯的长鼓（tambourin de Provence：又深又长的鼓身挂在左臂上，与加卢贝笛一人同奏）：鼓槌打在一张皮上，
// 鼓面上只绷着一根粗的响弦（chanterelle），所以不是军鼓那种“沙”，而是低沉的“咚——嗡”，响弦嗡得慢而长；
// tambourin 是重击，tambourin_ta 是轻的一下。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const TAMBOURIN: RegionalDef = {
  region: "north_europe",
  name: { zh: "普罗旺斯长鼓", en: "Tambourin (Provençal long drum)" },
  drums: {
    tambourin: { layers: [skin(150, 108, 0.03, 0.42, 1, [[1.52, 0.3, 0.22], [2.08, 0.18, 0.15]], 0.0006), hiss(380, 2300, 0.22, 0.42, { attack: 0.003, taps: 3 })] },
    tambourin_ta: { layers: [skin(170, 125, 0.02, 0.22, 0.6, [[1.52, 0.25, 0.12]], 0.0006), hiss(450, 2600, 0.14, 0.38, { attack: 0.003, taps: 2 })] },
  },
  // 法兰多拉：咚 · 嗒 咚 · 嗒
  demo: { key: "C major", qpm: 100, bars: 4, drum: [{ steps: "T.tT.tT.tTtt", hits: { T: ["tambourin", 0.85], t: ["tambourin_ta", 0.6] } }] },
};
