// 三味线（日本）：一根丝弦被象牙拨子（撥）狠狠地打下去，拨子同时打在猫皮上（“咚”的一声皮响）；
// 一弦的 sawari 让弦碰着琴颈上的小凹槽，余音里一直有“嗞——”的嗡响。余音短，亮而硬。
// 弹法：拨子打下去的重音、勾弦（!slide!）、按弦滑上去（!bend!），倚音是左手的“打”。
import type { RegionalDef } from "./types";

export const SHAMISEN: RegionalDef = {
  key: "shamisen",
  region: "japan",
  name: { zh: "三味线", en: "Shamisen" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 1.25,
      tilt: 0.45,
      bright: 0.9,
      pick: 0.11,
      damp: 0.11,
      thump: 0.14,
      buzz: { at: 0.5, level: 6 },
      skin: [210, 0.08, 0.42],
      body: [[290, 1.3, 4], [1150, 1.5, -3], [2900, 1.1, 5], [5200, 1.2, 2]],
      lp: 10000,
      max: 2.4,
    },
    level: 1.43,
    release: 0.2,
  },
  // 都节音阶（E F A B C）：拨子的重音、勾弦、倚音、按弦滑上去
  demo: { key: "E phrygian", qpm: 92, bars: 4, abc: "E2 F2 A2 B2 | c2 B A !slide!B4 | e2 {f}e c B2 !bend!A2 | F2 E2 z E, E,2" },
};
