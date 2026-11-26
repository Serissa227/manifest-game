// 当钲（日本祭囃子的小铜钲，鹿角的槌在里面敲）：“锵—吉”，很亮、很短，和太鼓、篠笛一起是祭礼的声音。
import type { RegionalDef } from "./types";

export const ATARIGANE: RegionalDef = {
  key: "atarigane",
  region: "japan",
  name: { zh: "当钲", en: "Atarigane" },
  instrument: {
    kind: "mallet",
    spec: { partials: [[1, 1, 0.5], [1.62, 0.6, 0.4], [2.33, 0.5, 0.28], [3.1, 0.3, 0.18], [4.2, 0.15, 0.1]], attack: 0.0008, strike: [0.5, 0.003, 9000], beat: 6, tilt: 0.1, max: 1 },
    level: 0.5,
    release: 0.12,
  },
  // 锵 · 吉吉 锵 · 吉 ·（高音 E6 一带）
  demo: { key: "C major", qpm: 104, bars: 3, abc: "e'2 e'/2e'/2 e' e'2 e' z | e'2 e'/2e'/2 e' e'2 e' z | e'4 z4" },
};
