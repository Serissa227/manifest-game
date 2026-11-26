// 独弦琴（đàn bầu，大越）：只有一根弦，右手掌侧轻点弦上的泛音节点同时拨，发出的是纯净、像人声又像笛的泛音；
// 左手握着竖在琴头的软竹竿（cần đàn）一扳，弦的张力一变，音高就一路滑上滑下——一句话里的“哭腔”与“笑声”全靠它。
// 曲谱里多写 !bend!（扳上去）、!fall!（落下来）与 !vib!（摇竿的颤）。
import type { RegionalDef } from "./types";

export const DAN_BAU: RegionalDef = {
  key: "dan_bau",
  region: "vietnam",
  name: { zh: "独弦琴", en: "Đàn bầu" },
  instrument: {
    kind: "pluck",
    // 泛音：拨在弦中点（只剩奇次谐波）、损耗大（高次谐波很快没了），只剩一个近乎正弦的长音；起音淡入 4 毫秒，不“铮”
    spec: { t60: 3.8, tilt: 0.35, bright: 0.2, pick: 0.5, damp: 0.42, thump: 0.012, body: [[200, 1, 3], [700, 1.2, 2]], lp: 3200, max: 4.5, onset: 0.004 },
    level: 0.68,
  },
  // 南调（điệu Nam）的哀怨：降 B 与降 E 一带扳来扳去
  demo: { key: "C major", qpm: 66, bars: 3, abc: "G4 !bend!c4 | !vib!d6 c2 | _B2 G2 !fall!F4" },
};
