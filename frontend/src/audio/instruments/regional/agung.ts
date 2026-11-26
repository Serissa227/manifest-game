// 阿贡（agung，菲律宾南部的一对大吊锣）：宽边、深腹、高高的乳头，裹布的槌敲，“嗡——”又深又厚，一高一低两只咬合着奏低音的节奏型；
// 有时一敲就用手按住（短的“嘭”）。比爪哇的大锣高、短，拍音慢。
import type { RegionalDef } from "./types";

export const AGUNG: RegionalDef = {
  key: "agung",
  region: "philippines",
  name: { zh: "阿贡（大吊锣）", en: "Agung" },
  instrument: {
    kind: "mallet",
    // 深腹的锣：分音近乎谐和，起音略高一点慢慢落稳
    spec: { partials: [[1, 1, 4.2], [2.0, 0.45, 2.6], [2.96, 0.35, 1.8], [4.1, 0.2, 1.1], [5.3, 0.1, 0.7]], attack: 0.008, strike: [0.25, 0.025, 650], beat: 1.3, tilt: 0.12, glide: { from: 1.012, time: 0.25 }, max: 5 },
    level: 0.41,
    release: 1.6,
  },
  // 一高一低两只的咬合
  demo: { key: "D major", qpm: 110, bars: 3, abc: "D,,2 z A,,2 z D,,2 | z D,, z A,, D,,2 A,,2 | D,,8" },
};
