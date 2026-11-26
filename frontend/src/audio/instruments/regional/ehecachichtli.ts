// 埃埃卡奇赫特利（阿兹特克的风哨，风神埃埃卡特尔的哨子；与考古里那种“死亡哨”同一类）：陶哨里有两个气室，气流在里面互相打架，
// 吹出来是带着粗糙的拍、被风撕开的长啸。这里取它“风”的一面、做成有音高的乐器（音落在调上，不做成惊叫）：
// 窄带的风声就在音高上，两个气室的振荡器差 44 音分（粗的拍），气流一秒十来下地抖，音头慢慢起来、常从下面推上来（!bend!）、句尾落下去（!fall!）。
// 曲子里只在空处用一两声，当作风与远处的号。
import type { RegionalDef } from "./types";

export const EHECACHICHTLI: RegionalDef = {
  key: "ehecachichtli",
  region: "mexica",
  name: { zh: "风哨（埃埃卡奇赫特利）", en: "Ehecachichtli (wind whistle)" },
  instrument: {
    kind: "wind",
    amps: (n) => [1, 0.22, 0.12, 0.05][n - 1] ?? 0,
    attack: 0.18,
    release: 0.35,
    breath: { level: 0.42, q: 2.4, ratio: 1 },
    pulse: { level: 0.3, q: 1.2, ratio: 3.2 },
    puff: { level: 0.3, decay: 0.14 },
    unison: { voices: 2, spread: 44 },
    tremor: { rate: 11, depth: 0.3 },
    drift: 16,
    chiff: 0.06,
    tongue: 0.6,
    glide: 0.16,
    lp: 6000,
    level: 0.214,
  },
  demo: { key: "D minor", qpm: 80, bars: 3, abc: "!bend!a6 !fall!f2 | z4 !bend!d'4 | !fall!a8" },
};
