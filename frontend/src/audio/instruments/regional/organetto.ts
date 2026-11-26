// 便携管风琴（organetto / organo portativo，意大利）：抱在膝上，右手按键、左手推风箱，一排小的唇管（再加一排略有音差的管）；
// 音色在竖笛与管风琴之间：基音稳、谐波比竖笛多，没有揉音、音头有一下“咚”（管口的起振），风箱推动时音量有一点起伏。
// 只奏单旋律（右手），兰迪尼的歌与教堂里跟着合唱的高声部都靠它；按键的乐器，音与音之间不滑。
import { roll } from "./shape";
import type { RegionalDef } from "./types";

export const ORGANETTO: RegionalDef = {
  key: "organetto",
  region: "iberia_italy",
  name: { zh: "便携管风琴", en: "Portative organ" },
  instrument: {
    kind: "wind",
    amps: (n, f) => ([1, 0.42, 0.22, 0.14, 0.08, 0.05, 0.03, 0.02][n - 1] ?? 0) * roll(f, 6000, 2),
    attack: 0.018,
    release: 0.035,
    breath: { level: 0.012, q: 1.2, ratio: 3 },
    chiff: 0.08,
    tongue: 0.2,
    glide: 0.006,
    unison: { voices: 2, spread: 4 },
    tremor: { rate: 3.1, depth: 0.04 },
    level: 0.26,
  },
  // 一句带倚音的歌，终止前的“兰迪尼终止”（7 — 6 — 8）
  demo: { key: "G mixolydian", qpm: 96, bars: 3, abc: "d2 e2 f2 e2 | d c B c d2 c2 | ^F2 E2 G4" },
};
