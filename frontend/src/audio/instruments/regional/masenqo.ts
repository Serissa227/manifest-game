// 马森果（埃塞俄比亚的单弦提琴）：一根马尾弦绷在菱形的小琴箱上（箱上蒙皮），用马尾弓拉；
// 声音沙、鼻音重、像人在唱——阿兹马里拉着它即兴地唱，句子里满是滑上去（!bend!）、落下来（!fall!）和深揉（!vib!）。
// 弓毛与马尾弦的“沙”跟着波形一开一合（pulse 比二胡、克曼切都重），菱形琴箱的共振峰比二胡低。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const MASENQO: RegionalDef = {
  key: "masenqo",
  region: "ethiopia",
  name: { zh: "马森果（单弦提琴）", en: "Masenqo" },
  instrument: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.7)) * (0.3 + bump(f, 560, 0.5, 0.75) + bump(f, 1250, 0.4, 0.8) + bump(f, 2600, 0.5, 0.45)) * roll(f, 5200, 3),
    attack: 0.07,
    release: 0.13,
    vib: { rate: 5.6, depth: 18, delay: 0.2 },
    vibBoost: 2.2,
    breath: { level: 0.03, q: 0.6, ratio: 5 },
    pulse: { level: 0.17, q: 0.8, ratio: 3.5 },
    chiff: 0.05,
    tongue: 0.68,
    glide: 0.1,
    drift: 6,
    level: 0.335,
  },
  // 提兹塔（小调的一种：E 升F G B C）：滑上去、深揉、落下来
  demo: { key: "E phrygian", qpm: 76, bars: 4, abc: "!bend!B4 c B G2 | ^F2 E ^F !vib!G4 | (B c) (B G) ^F E ^F G | !vib!E6 z2" },
};
