// 甘丁甘（gandingan，马京达瑙的四只窄边吊锣）：两两一对，“会说话的锣”——敲完马上按住，短的“嘣、嘣”模仿说话的声调；
// 在锣乐队里跟着库林唐的旋律走低音的轮廓。
import type { RegionalDef } from "./types";

export const GANDINGAN: RegionalDef = {
  key: "gandingan",
  region: "philippines",
  name: { zh: "甘丁甘（说话锣）", en: "Gandingan" },
  instrument: {
    kind: "mallet",
    spec: { partials: [[1, 1, 1.8], [2.25, 0.3, 0.7], [3.35, 0.14, 0.4]], attack: 0.004, strike: [0.18, 0.01, 1600], beat: 1.8, tilt: 0.2, max: 2.5 },
    level: 0.43,
    // 按住的锣：一放就收
    release: 0.35,
  },
  demo: { key: "D major", qpm: 110, bars: 3, abc: "A,2 G,2 E,2 D,2 | z A, z G, E,2 D,2 | A,2 z2 D,4" },
};
