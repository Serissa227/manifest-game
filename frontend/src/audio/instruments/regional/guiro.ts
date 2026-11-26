// 刮瓜（güiro / 泰诺语 guayo）：一只长葫芦上刻满一道道的横槽，用木棍或骨刺刮——长的一刮是“嘎啦啦——”（guiro_long），
// 短的一刮是“嘎”（guiro_short）。每一道槽是一下短的“咔”，有节律地连成一串（刮奏层），葫芦的空腔让中频更厚。
import type { RegionalDef } from "./types";

export const GUIRO: RegionalDef = {
  region: "taino",
  name: { zh: "刮瓜（圭罗）", en: "Güiro" },
  drums: {
    guiro_long: { layers: [{ kind: "rasp", lo: 900, hi: 5200, rate: 72, dur: 0.21, click: 0.006, level: 1, jitter: 0.1, floor: 0.22 }] },
    guiro_short: { layers: [{ kind: "rasp", lo: 1000, hi: 5600, rate: 80, dur: 0.07, click: 0.006, level: 0.9, jitter: 0.1, floor: 0.22 }] },
  },
  // 长 — 短短（一拍长刮，后半拍两下短刮）
  demo: { key: "C major", qpm: 104, bars: 3, drum: [{ steps: "L.ssL.ss", hits: { L: ["guiro_long", 0.8], s: ["guiro_short", 0.55] } }] },
};
