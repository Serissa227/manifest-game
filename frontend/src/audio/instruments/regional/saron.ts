// 萨龙（爪哇甘美兰的青铜音板，木槌）：分音不成倍数（1、2.71、4.82……），成对的两架调得差几赫兹，合起来“翁翁”地拍（ombak）；
// 敲下去“铛”的一声，奏下一个音时用手按掉上一个（release 短）。甘美兰的骨干旋律（balungan）由它奏。
import type { RegionalDef } from "./types";

export const SARON: RegionalDef = {
  key: "saron",
  region: "nusantara",
  name: { zh: "萨龙", en: "Saron" },
  instrument: {
    kind: "mallet",
    spec: { partials: [[1, 1, 2.6], [2.71, 0.5, 1.1], [4.82, 0.2, 0.5], [6.9, 0.08, 0.25]], attack: 0.001, strike: [0.45, 0.004, 6000], beat: 4.5, tilt: 0.3, max: 3 },
    level: 0.71,
    release: 0.3,
  },
  // 佩洛格一类的五声（E F G B C）上的骨干旋律
  demo: { key: "E phrygian", qpm: 90, bars: 3, abc: "E2 F2 G2 B2 | c2 B2 G2 F2 | E2 G2 F2 E2" },
};
