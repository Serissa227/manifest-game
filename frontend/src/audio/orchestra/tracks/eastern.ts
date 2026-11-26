// 《琉璃瓦上的月》管弦版（瑶华帝国的港口，东方风；G 宫五声，慢 4/4）：旋律与和声同合成版，按管弦乐重新配器。
// 开头竖琴一串两个八度的五声音阶上行刮奏、一声大锣；笛子的旋律交给长笛（倚音与上滑音照旧），古筝的旋律是竖琴，
// 古筝流动的分解和弦也是竖琴；笙在后面托着的长音改成中提琴与第二小提琴很轻的和弦长音（第二遍加上单簧管）；
// 梆子是响棒。B 段落在羽音（E）上，像一句没有说完的话，再回到宫音。
import type { TrackDef } from "../../score";
import { EASTERN as SYNTH } from "../../tracks/eastern";
import { chords, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;

export const EASTERN: TrackDef = {
  id: "port_eastern",
  title: SYNTH.title,
  qpm: 72,
  meter: [4, 4],
  key: "G major",
  level: 1.16,
  voices: {
    fl: line("o.fl", 0.54, SEAT.fl, 0.4),
    ob: line("o.ob", 0.44, SEAT.ob, 0.38),
    hp: line("o.harp", 0.46, SEAT.harp, 0.38),
    arp: pulse("o.harp", 0.26, SEAT.harp + 0.12, WET.harp, { kind: "arp", low: 43, steps: "1 5 8 10 12 10 8 5", ring: 3 }),
    vn2: chords("o.vn", 0.12, SEAT.vn2, 0.42, 62, 76, 3),
    va: chords("o.va", 0.12, SEAT.va, 0.42, 55, 67, 2),
    clp: chords("o.cl", 0.1, SEAT.cl, 0.4, 60, 72, 2),
    cb: { inst: "o.cb", gain: 0.16, pan: SEAT.cb, reverb: 0.3, poly: true, pattern: { kind: "pad", low: 31, high: 43, size: 1 } },
    gong: line("o.perc", 0.34, 0.1, 0.6),
    clapper: pulse("o.perc", 0.24, -0.2, 0.35, { kind: "drum", steps: "c.......c...c...", hits: { c: ["claves", 0.4] } }),
  },
  sections: {
    intro: { ...S.intro, lines: { gliss: S.intro.lines!.gliss, gong: "g4 z4 | z8" } },
    A: { ...S.A },
    B: { ...S.B, lines: { mel: S.B.lines!.mel, gong: "g4 z4 | z8 | z8 | z8 | z8 | z8 | z8 | z8" } },
  },
  forms: [
    [
      { s: "intro", play: "gliss:hp gong:gong arp", dyn: 0.6 },
      { s: "A", play: "mel:fl arp cb clapper", dyn: 0.62 },
      { s: "A", play: "mel:hp va vn2 cb clapper", dyn: 0.62 },
      { s: "B", play: "mel:fl gong:gong arp va vn2 cb clapper", dyn: 0.68 },
      { s: "A", play: "mel:fl mel:hp-12 va vn2 clp cb clapper", dyn: 0.7, rit: 0.9 },
    ],
    [
      { s: "A", play: "mel:hp arp cb", dyn: 0.58 },
      { s: "A", play: "mel:fl arp va vn2 cb clapper", dyn: 0.64 },
      { s: "B", play: "mel:ob gong:gong arp va vn2 clp cb clapper", dyn: 0.68 },
      { s: "A", play: "mel:fl mel:hp-12 arp va vn2 cb", dyn: 0.68, rit: 0.9 },
    ],
  ],
  rest: [12, 20],
};
