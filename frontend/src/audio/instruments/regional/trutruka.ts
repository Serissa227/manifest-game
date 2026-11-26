// 特鲁特鲁卡（智利南部马普切人的长号，trutruka）：一根两三米长、掏空的竹竿（colihue 竹），外面缠着马肠，末端套一只牛角当喇叭口；
// 用嘴唇吹，像号一样只吹得出管子的自然泛音（这里按 G 管：G、D、G、B、D），祭典 ngillatun 上与库尔特伦鼓一起响，声音能传到对面的山谷。
// 管长所以基音低、泛音多；牛角口让它比海螺号亮、冲，嘴唇的颤（每秒十七八下的起伏）让长音毛毛的；音头常从下面推上去，句尾往下落。
// 寰宇世界里马普切诸部的风格是 andean，所以登记在安第斯一组。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const TRUTRUKA: RegionalDef = {
  key: "trutruka",
  region: "andes",
  name: { zh: "特鲁特鲁卡长号（马普切）", en: "Trutruka (Mapuche horn)" },
  instrument: {
    kind: "brass",
    amps: (n, f) => (1 / Math.pow(n, 0.3)) * (0.4 + bump(f, 1100, 0.6, 0.7) + bump(f, 2500, 0.5, 0.4)) * roll(f, 5000, 2.5),
    attack: 0.09,
    release: 0.22,
    vib: { rate: 5, depth: 3, delay: 0.8 },
    breath: { level: 0.06, q: 0.8, ratio: 3 },
    pulse: { level: 0.12, q: 0.9, ratio: 4 },
    tremor: { rate: 17, depth: 0.18 },
    drift: 8,
    tongue: 0.6,
    glide: 0.08,
    blare: { from: 600, to: 5000, time: 0.2 },
    level: 0.41,
  },
  // 只有自然泛音：从 D 推上去，G、B 来回，落回 G
  demo: { key: "G major", qpm: 84, bars: 3, abc: "!bend!D4 G2 D2 | G2 B2 !bend!d4 | B2 G2 !fall!G4" },
};
