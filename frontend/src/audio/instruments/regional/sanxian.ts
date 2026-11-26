// 三弦（明，南音的“上四管”之一）：长长的无品琴颈、两面蒙蟒皮的小琴筒，三根丝弦，用指甲（或骨拨）弹。
// 声音“空、嘣”：起音时皮面一声低的“嘣”（比三味线的猫皮低、闷），没有三味线那种碰琴颈的“嗞——”（不加 sawari），
// 余音比琵琶短、暗。南音里它紧跟着琵琶走骨干（点挑的同音反复），无品，按弦可以滑（!slide! / !bend!）。
import type { RegionalDef } from "./types";

export const SANXIAN: RegionalDef = {
  key: "sanxian",
  region: "ming",
  name: { zh: "三弦", en: "Sanxian" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 1.1,
      tilt: 0.5,
      bright: 0.74,
      pick: 0.14,
      damp: 0.17,
      thump: 0.16,
      // 蟒皮的“嘣”：比三味线的猫皮（210 Hz）低、长一点
      skin: [150, 0.14, 0.5],
      body: [[230, 1.3, 4], [780, 1.4, 3], [2300, 1.2, 3]],
      lp: 7200,
      max: 2.2,
    },
    // 音量校准（试听台，同一音区的八分音符）：1.0 时 −28.1 LUFS，比琵琶（−24.1）、乌德琴（−23.7）轻 4 dB → 1.55
    level: 1.55,
    release: 0.18,
  },
  // D 商调五声：点挑的同音反复、按弦滑上去
  demo: { key: "D dorian", qpm: 84, bars: 4, abc: "A,2 A, A, D2 E2 | G2 G G A4 | !slide!c2 A G A2 D2 | E2 D2 D4" },
};
