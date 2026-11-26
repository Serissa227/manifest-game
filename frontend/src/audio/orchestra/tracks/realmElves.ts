// 《银枝与白花》管弦版（彼界·精灵的七岛，E 利底亚慢 3/4，轻、高、几乎没有低音）：旋律与和声同合成版，按管弦乐重新配器。
// 钢片琴的旋律改成竖琴与高八度的钟琴同奏（银枝上的花），第二遍长笛唱；竖琴在高音区一上一下地拨（泛音一样的光）；
// 高处第二小提琴与中提琴极轻的和弦长音，再高一层小提琴组的颤弓是亮的雾；B 段第一小提琴唱到最高处；大提琴组只有极轻的一个长音。用大厅混响。
import type { TrackDef } from "../../score";
import { REALM_ELVES as SYNTH } from "../../tracks/realmElves";
import { chords, line, pulse, SEAT } from "./kit";

const S = SYNTH.sections;

export const REALM_ELVES: TrackDef = {
  id: "realm_elves",
  title: SYNTH.title,
  qpm: 60,
  meter: [3, 4],
  key: "E lydian",
  hall: true,
  space: 1.35,
  level: 1.35,
  voices: {
    hp: line("o.harp", 0.48, SEAT.harp, 0.55),
    glock: line("o.glock", 0.14, SEAT.glock, 0.66),
    fl: line("o.fl", 0.46, SEAT.fl, 0.55),
    vn1: line("o.vn", 0.44, SEAT.vn1, 0.6),
    harp: pulse("o.harp", 0.24, SEAT.harp + 0.1, 0.55, { kind: "arp", low: 64, steps: "1 5 8 10 12 10", ring: 3 }),
    vhi: chords("o.vn", 0.09, SEAT.vn2, 0.62, 71, 88, 3),
    va: chords("o.va", 0.08, SEAT.va, 0.6, 64, 79, 2),
    mist: chords("o.vn.trem", 0.06, SEAT.vn2 + 0.1, 0.66, 76, 88, 2),
    low: chords("o.vc", 0.08, SEAT.vc, 0.5, 52, 64, 1),
  },
  sections: {
    intro: { ...S.intro },
    A: { ...S.A },
    B: { ...S.B },
    outro: { ...S.outro },
  },
  forms: [
    [
      { s: "intro", play: "gliss:hp vhi mist", dyn: 0.48, to: 0.54 },
      { s: "A", play: "mel:hp mel:glock+12 harp vhi low", dyn: 0.56 },
      { s: "B", play: "bmel:vn1 harp vhi va mist low", dyn: 0.58, to: 0.62 },
      { s: "A", play: "mel:hp mel:glock+12 mel:fl harp vhi va low", dyn: 0.6 },
      { s: "outro", play: "tag:hp tag:glock+12 harp vhi mist", dyn: 0.5, to: 0.34, rit: 0.85 },
    ],
    [
      { s: "intro", play: "gliss:hp vhi mist", dyn: 0.46, to: 0.52 },
      { s: "A", play: "mel:fl harp vhi low", dyn: 0.54 },
      { s: "B", play: "bmel:vn1 bmel:hp-12 harp vhi va mist low", dyn: 0.58, to: 0.62 },
      { s: "outro", play: "tag:hp tag:glock+12 harp vhi mist", dyn: 0.48, to: 0.32, rit: 0.85 },
    ],
  ],
  rest: [20, 40],
};
