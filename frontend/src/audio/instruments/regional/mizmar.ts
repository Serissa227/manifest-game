// 米兹玛尔（阿拉伯，上埃及“萨伊迪”的双簧管）：杏木的锥形管，嘴唇抵着唇托、鼓着腮循环换气，一口气不断；
// 婚礼、集市与棍舞（塔赫提卜）里与大鼓（塔布勒）一起吹，几支一高一低地应答。
// 比奥斯曼的祖尔纳略暗、鼻音更重（共振峰在 1.1 kHz 与 2.5 kHz 一带），揉音更宽，句中常有很快的倚音与颤音（写 {…} 与 !vib!）。
import { reedAmps } from "./shape";
import type { RegionalDef } from "./types";

export const MIZMAR: RegionalDef = {
  key: "mizmar",
  region: "arabia",
  name: { zh: "米兹玛尔", en: "Mizmar" },
  instrument: {
    kind: "wind",
    amps: reedAmps(0.3, [[1150, 0.5, 1.0], [2500, 0.45, 0.75], [4200, 0.4, 0.3]], 8000),
    attack: 0.03,
    release: 0.08,
    vib: { rate: 5.6, depth: 13, delay: 0.25 },
    vibBoost: 2.4,
    breath: { level: 0.022, q: 0.8, ratio: 3 },
    pulse: { level: 0.09, q: 0.9, ratio: 3.5 },
    chiff: 0.05,
    tongue: 0.5,
    glide: 0.05,
    drift: 6,
    blare: { from: 2200, to: 7500, time: 0.12 },
    level: 0.27,
  },
  // 拉斯特：起句从下面推上来，中立的三度（降半个半音的 E）与倚音，句尾落下
  demo: { key: "C rast", qpm: 104, bars: 4, abc: "!bend!G4 {A}G F E D | E F G A !vib!G4 | c B A G {A}G F E D | E2 D2 !fall!C4" },
};
