// 奇里米亚（玛雅人的木双簧管，chirimía）：十六世纪方济各会的修士把西班牙的肖姆管带进尤卡坦与危地马拉的教堂与游行，
// 玛雅的乐师接过去，配着屯（tun，裂缝木鼓）吹到今天。木管、双簧：鼻音重，比祖尔纳、唢呐暗一些、软一些，
// 音高常有点晃（drift），倚音与回音多。
import { reedAmps } from "./shape";
import type { RegionalDef } from "./types";

export const CHIRIMIA: RegionalDef = {
  key: "chirimia",
  region: "maya",
  name: { zh: "奇里米亚木管", en: "Chirimía (shawm)" },
  instrument: {
    kind: "wind",
    amps: reedAmps(0.42, [[1100, 0.55, 0.9], [2400, 0.5, 0.5]], 6500),
    attack: 0.03,
    release: 0.07,
    vib: { rate: 5, depth: 14, delay: 0.3 },
    breath: { level: 0.04, q: 1, ratio: 3 },
    pulse: { level: 0.12, q: 1, ratio: 5 },
    drift: 9,
    chiff: 0.06,
    tongue: 0.35,
    glide: 0.04,
    blare: { from: 1800, to: 6000, time: 0.15 },
    level: 0.237,
  },
  demo: { key: "D dorian", qpm: 92, bars: 3, abc: "A2 {B}A G F2 E D | !vib!F4 {G}F E D2 | E2 F2 !fall!D4" },
};
