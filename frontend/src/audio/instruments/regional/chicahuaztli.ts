// 奇卡瓦兹特利（阿兹特克的响杖）：一根空心的长杖，杖头里装着小石子或种子，祭司与舞者把它往地上一顿——
// 先是杖落地的一声闷响，跟着杖头里“沙啦啦”一阵（刮奏层，比果壳串慢、长）；只摇不顿时只有那一阵（chicahuaztli_shake）。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const CHICAHUAZTLI: RegionalDef = {
  region: "mexica",
  name: { zh: "奇卡瓦兹特利响杖", en: "Chicahuaztli (rattle staff)" },
  drums: {
    chicahuaztli: { layers: [skin(140, 95, 0.02, 0.12, 0.85, [[1.7, 0.2, 0.05]], 0.0008), hiss(80, 700, 0.03, 0.4, { attack: 0.002 }), { kind: "rasp", lo: 1800, hi: 7500, rate: 55, dur: 0.18, click: 0.012, level: 0.8, jitter: 0.35 }] },
    chicahuaztli_shake: { layers: [{ kind: "rasp", lo: 2000, hi: 8000, rate: 45, dur: 0.22, click: 0.015, level: 0.8, jitter: 0.4, floor: 0.35 }] },
  },
  demo: { key: "C major", qpm: 100, bars: 3, drum: [{ steps: "C...s...C...s.s.C...C...", hits: { C: ["chicahuaztli", 0.85], s: ["chicahuaztli_shake", 0.6] } }] },
};
