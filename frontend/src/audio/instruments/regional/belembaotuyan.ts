// 贝伦巴奥图延（密克罗尼西亚·马里亚纳群岛查莫罗人的 belembaotuyan）：一张长弓上张一根弦，弓背绑一只挖空的葫芦，
// 葫芦口抵在胸腹上当共鸣箱，细棍敲弦、手指按弦换音——低沉的“嗡”带着葫芦腔的共鸣，敲下去有木棍的一下，弦贴着弓微微地“嗞”。
import type { RegionalDef } from "./types";

export const BELEMBAOTUYAN: RegionalDef = {
  key: "belembaotuyan",
  region: "pacific",
  name: { zh: "贝伦巴奥图延葫芦弓", en: "Belembaotuyan (gourd bow)" },
  instrument: {
    kind: "pluck",
    spec: { t60: 2.6, tilt: 0.35, bright: 0.75, pick: 0.07, damp: 0.12, thump: 0.14, body: [[320, 3, 9], [880, 2, 3], [2400, 1.5, -3]], lp: 6500, max: 3, buzz: { at: 0.75, level: 0.06, hp: 1500 } },
    level: 0.82,
  },
  // 低音区的一条短句（按弦换音），收在主音上
  demo: { key: "G major", qpm: 84, bars: 3, abc: "G,2 D, G, B,2 A,2 | G,2 D,2 E,2 D,2 | G,2 B, A, G,4" },
};
