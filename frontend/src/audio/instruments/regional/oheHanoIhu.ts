// 鼻笛（夏威夷的 ʻohe hano ihu，“用鼻子吹的竹”）：一段竹子，用一侧鼻孔吹，只有两三个孔、三四个音；
// 声音很轻、气多音少，吹不出吐音（鼻子没有舌头），音与音之间靠手指滑过去，长音上气息一起一伏。
// 情人之间的私语、清晨的歌。与原有的鼻笛 vivo（群岛）比：气声更重、起音更软、没有“吐”的一下。
import { roll } from "./shape";
import type { RegionalDef } from "./types";

export const OHE_HANO_IHU: RegionalDef = {
  key: "ohe_hano",
  region: "pacific",
  name: { zh: "鼻笛（ʻohe hano ihu）", en: "ʻOhe hano ihu (nose flute)" },
  instrument: {
    kind: "wind",
    amps: (n, f) => ([1, 0.1, 0.06, 0.02][n - 1] ?? 0) * roll(f, 3000, 2),
    attack: 0.13,
    release: 0.22,
    vib: { rate: 3.8, depth: 7, delay: 0.6 },
    vibBoost: 2.6,
    breath: { level: 0.3, q: 0.6, ratio: 1.4 },
    pulse: { level: 0.12, q: 1, ratio: 2 },
    puff: { level: 0.1, decay: 0.2 },
    tremor: { rate: 0.7, depth: 0.2 },
    drift: 9,
    tongue: 0.85,
    glide: 0.1,
    level: 0.215,
  },
  // 只吹相邻的四个音（D E G A），从下面滑上来、在 A 上念、长音揉开、句尾落到 D
  demo: { key: "D mixolydian", qpm: 66, bars: 3, abc: "!bend!A4 G2 A2 | !vib!A6 G2 | E2 G E !fall!D4" },
};
