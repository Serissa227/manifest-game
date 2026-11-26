// 乐琵琶（日本雅乐的琵琶，gakubiwa）：四根粗丝弦、很大的拨子，奏的是“节奏的骨架”而不是旋律——
// 每个乐句的开头拨子从最低的弦慢慢扫上去（三四根弦一个一个地响，“ジャラーン”），停在旋律音上，余音很长。
// 比萨摩琵琶（biwa）圆、低、暗，“嗡”很轻（柱很低）；拨子打在琴面的皮上有一声闷响。曲谱里把扫弦写成一串很短的音（余音自己连着）。
import type { RegionalDef } from "./types";

export const GAKUBIWA: RegionalDef = {
  key: "gakubiwa",
  region: "japan",
  name: { zh: "乐琵琶", en: "Gakubiwa" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 2.6,
      tilt: 0.4,
      bright: 0.58,
      pick: 0.2,
      damp: 0.22,
      thump: 0.26,
      buzz: { at: 0.55, level: 2.6 },
      skin: [130, 0.05, 0.22],
      body: [[95, 1.2, 4], [260, 1.3, 3], [900, 1.3, 1], [2400, 1.1, -2]],
      lp: 6000,
      max: 3.5,
    },
    level: 0.97,
    release: 1.4,
  },
  // 平调的扫弦：低音弦一个一个地上去，停在旋律音上
  demo: { key: "E dorian", qpm: 60, bars: 3, abc: "E,/2B,/2E/2 B9/2 z2 | D,/2A,/2D/2 A9/2 z2 | E,/2B,/2E/2 B13/2" },
};
