// 博南（爪哇甘美兰，成排横放的小铜锣，裹布的槌）：“咚”的一声，基音强，第二、三分音在 2.0 与 2.76 倍附近，拍音轻；
// 两架（barung 与 panerus）的咬合（imbal / kotekan）把骨干旋律织成一串十六分音符。
import type { RegionalDef } from "./types";

export const BONANG: RegionalDef = {
  key: "bonang",
  region: "nusantara",
  name: { zh: "博南", en: "Bonang" },
  instrument: {
    kind: "mallet",
    spec: { partials: [[1, 1, 1.5], [2.02, 0.22, 0.6], [2.76, 0.4, 0.55], [4.1, 0.15, 0.3], [5.3, 0.08, 0.18]], attack: 0.002, strike: [0.12, 0.006, 2500], beat: 3, tilt: 0.3, max: 2.5 },
    level: 0.85,
    release: 0.6,
  },
  demo: { key: "E phrygian", qpm: 90, bars: 3, abc: "B/2c/2B/2c/2 e/2c/2B/2c/2 G/2B/2G/2B/2 c/2B/2G/2B/2 | F/2G/2F/2G/2 B/2G/2F/2G/2 E4 | e2 c2 B2 G2" },
};
