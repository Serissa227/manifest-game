// 风笛的持续音管（drone）：低音管与次中音管各一支，单簧、圆柱形的管——闭管一样奇次谐波强、偶次弱，嗡嗡地亮；
// 两三支管的音高永远差一点点，拍出慢慢的“哇哇”声（齐奏的振荡器错开几个音分）；起音有皮囊鼓起来的一下。
// 曲谱里用 drone 伴奏型写主音与低八度（例如 notes: [43, 55]：G2 与 G3），整段一直响。
import { bump, roll } from "./shape";
import type { RegionalDef } from "./types";

export const PIPE_DRONE: RegionalDef = {
  key: "pipe_drone",
  region: "north_europe",
  name: { zh: "风笛的持续音管", en: "Bagpipe drones" },
  instrument: {
    kind: "pad",
    amps: (n, f) => ((n % 2 === 1 ? 1 : 0.38) / Math.pow(n, 0.55)) * (0.5 + bump(f, 900, 0.6, 0.5) + bump(f, 2400, 0.5, 0.3)) * roll(f, 5200, 3),
    attack: 0.18,
    release: 0.45,
    breath: { level: 0.008, q: 0.8, ratio: 4 },
    unison: { voices: 3, spread: 5 },
    glide: 0.05,
    level: 0.19,
  },
  demo: { key: "G mixolydian", qpm: 80, bars: 3, abc: "[G,,G,]8 | [G,,G,]8 | [G,,G,D]8" },
};
