// 布祖克（buzuq，黎巴嫩与叙利亚的长颈琉特）：细长的琴颈、小小的梨形琴身，钢丝复弦（一组里夹一根高八度的弦），
// 品是活动的，能放在四分之一音上（巴亚提的降半个半音）；拨片紧贴琴桥弹，声音细、亮、带金属的“铮”，余音比乌德琴长，
// 长音用拨片快速地震（rish）。黎凡特港口的咖啡馆与码头上，它领着达布卡与里克鼓。
import type { RegionalDef } from "./types";

export const BUZUQ: RegionalDef = {
  key: "buzuq",
  region: "ottoman",
  name: { zh: "布祖克琴", en: "Buzuq" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 2.6,
      tilt: 0.4,
      bright: 0.95,
      pick: 0.07,
      damp: 0.08,
      course: 6,
      octave: 0.28,
      thump: 0.08,
      onset: 0.0025,
      body: [[330, 1.5, 3], [950, 1.3, 3], [2500, 1.2, 4]],
      lp: 11000,
      max: 3.4,
    },
    level: 0.8,
    tremolo: 0.55,
    tremRate: 16,
  },
  // D 巴亚提（E 降半个半音）：上行、在第二级上停、震音的长音
  demo: { key: "D bayati", qpm: 96, bars: 4, abc: "D2 E F G2 A2 | B A G F E4 | F G A B c B A G | !trem!A4 {G}F E D2" },
};
