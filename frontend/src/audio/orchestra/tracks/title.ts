// 主题曲《船货清单》管弦版：旋律与和声同合成版（D 大调，宽广的 4/4，起帆动机），按管弦乐重新配器。
// 前奏：管钟敲两下（船钟），定音鼓在主音上滚奏渐强，小提琴组颤弓铺开，竖琴刮奏；圆号在低处吹起帆动机，小号高处应答，吊镲渐强推到动机上。
// A 段：大提琴组在它最会唱的次中音区唱主题，圆号低八度同奏（温暖、庄重），竖琴分解和弦，高处小提琴轻轻的长音像一层光，低音提琴走根音。
// A2 段：第一小提琴接过主题推到高音，圆号在中低音区吹对位，第二小提琴与中提琴的和弦长音在中间，大提琴与低音提琴走低音。
// B 段：转到 B 小调一侧，第一小提琴唱，圆号吹一条平稳下行的内声部；末尾定音鼓滚奏、吊镲渐强推回全奏。
// 全奏的 A2：小号、第一小提琴与高八度的长笛齐奏主题，圆号对位，长号的和弦托底，一记对击钹；尾声回到起帆动机，竖琴刮奏、钟琴点亮最后的主和弦。
// 第二遍换一套：长笛（高八度）唱 A 段、弦乐拨奏伴奏，B 段交给单簧管、小提琴在高处拉长音。
import type { TrackDef } from "../../score";
import { TITLE as SYNTH } from "../../tracks/title";
import { bass, chords, held, line, pulse, SEAT, WET } from "./kit";

const S = SYNTH.sections;
const mel = (s: keyof typeof S, l: string) => S[s].lines![l];

export const TITLE: TrackDef = {
  id: "title",
  title: SYNTH.title,
  qpm: 80,
  meter: [4, 4],
  key: "D major",
  hall: true,
  level: 0.8,
  voices: {
    bell: line("o.tubular", 0.3, SEAT.bells, WET.bells),
    timp: line("o.timp", 0.44, SEAT.timp, 0.3),
    perc: line("o.perc", 0.34, SEAT.perc, 0.4),
    hn: line("o.hn", 0.52, SEAT.hn, WET.brass),
    tp: line("o.tp", 0.44, SEAT.tp, WET.brass),
    tb: chords("o.tb", 0.2, SEAT.tb, WET.brass, 45, 60, 3),
    fl: line("o.fl", 0.42, SEAT.fl, WET.winds),
    ob: line("o.ob", 0.44, SEAT.ob, WET.winds),
    cl: line("o.cl", 0.48, SEAT.cl, WET.winds),
    vn1: line("o.vn", 0.56, SEAT.vn1, WET.strings),
    vtr: held("o.vn.trem", 0.18, SEAT.vn2, 0.4),
    vhi: chords("o.vn", 0.15, SEAT.vn2, 0.42, 74, 86, 2),
    vn2: chords("o.vn", 0.19, SEAT.vn2, WET.strings, 62, 74, 2),
    va: chords("o.va", 0.12, SEAT.va, WET.strings, 52, 66, 3),
    vcm: line("o.vc", 0.62, SEAT.vc, WET.strings),
    vc: line("o.vc", 0.38, SEAT.vc, 0.2, { a: bass("B . . . . . . .", 38), b: bass("B . . . 5 . . .", 38) }),
    cb: line("o.cb", 0.24, SEAT.cb, 0.2, { a: bass("B . . . . . . .", 26) }),
    vcp: pulse("o.vc.pizz", 0.4, SEAT.vc, WET.low, bass("B - - - 5 - - -", 38)),
    vnp: pulse("o.vn.pizz", 0.3, SEAT.vn2, WET.strings, bass("- - 8+10 - - - 8+10 -", 55)),
    harp: pulse("o.harp", 0.34, SEAT.harp, WET.harp, {
      a: { kind: "arp", low: 43, steps: "1 5 8 10 12 10 8 5", ring: 2 },
      b: { kind: "arp", low: 43, steps: "1 8 5 10 8 12 10 15", ring: 2 },
      c: { kind: "arp", low: 43, steps: "1 . 8 . 10 . 12 .", ring: 3 },
    }),
    glock: line("o.glock", 0.22, SEAT.glock, WET.bells),
  },
  sections: {
    intro: {
      ...S.intro,
      lines: {
        bell: mel("intro", "bell"),
        timp: mel("intro", "timp"),
        gliss: mel("intro", "gliss"),
        // 圆号在低处远远地吹起帆动机，小号高处应答
        call: "z8 | z8 | A,,3/2 D,/2 A,6 | z8",
        ans: mel("intro", "ans"),
        // 小提琴组颤弓：D 大三和弦铺开，第二小节换到 G/D
        trem: "[Adf]8 | [Bdg]6 z2 | z8 | z8",
        // 吊镲渐强，推到圆号的动机上
        swell: "z8 | z4 =G4 | z8 | z8",
      },
    },
    A: {
      ...S.A,
      lines: { mel: mel("A", "mel") },
    },
    A2: {
      ...S.A2,
      lines: {
        mel: mel("A2", "mel"),
        hcnt: mel("A2", "hcnt"),
        timp: mel("A2", "timp"),
        // 全奏开头的一记对击钹
        crash: "z2 | =F8 | z8 | z8 | z8 | z8 | z8 | z8 | z6",
      },
    },
    B: {
      ...S.B,
      lines: {
        mel: mel("B", "mel"),
        hb: mel("B", "hb"),
        timp: mel("B", "timp"),
        // 末尾吊镲渐强，推回全奏
        swell: "z8 | z8 | z8 | z8 | z8 | z8 | z8 | z4 =G4",
      },
    },
    coda: {
      ...S.coda,
      lines: {
        // 圆号低八度吹起帆动机，落到主和弦的三音
        tag: "A,,3/2 D,/2 A,6 | B,6 A,2 | A,6 G,2 | F,8",
        ttag: mel("coda", "ttag"),
        timp: mel("coda", "timp"),
        gliss: mel("coda", "gliss"),
        // 钟琴点亮最后的主和弦
        spark: "z8 | z8 | z8 | z2 d'/2f'/2a'/2d''/2 z4",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "bell:bell timp:timp trem:vtr gliss:harp call:hn ans:tp swell:perc harp.c vc cb", dyn: 0.5, to: 0.74 },
      { s: "A", play: "mel:vcm mel:hn-12 harp vhi cb", dyn: 0.64 },
      { s: "A2", play: "mel:vn1 hcnt:hn-12 timp:timp harp vn2 va vc cb", dyn: 0.7 },
      { s: "B", play: "mel:vn1 hb:hn timp:timp swell:perc harp.b vn2 va vc.b cb", dyn: 0.66, to: 0.86 },
      { s: "A2", play: "mel:tp mel:vn1 mel:fl+12 hcnt:hn-12 crash:perc timp:timp tb harp vn2 va vc cb", dyn: 0.82 },
      { s: "coda", play: "tag:hn ttag:tp timp:timp gliss:harp spark:glock vn2 va vc cb", dyn: 0.74, to: 0.5, rit: 0.72 },
    ],
    [
      { s: "intro", play: "bell:bell gliss:harp call:fl+24 ans:ob harp.c vhi vc cb", dyn: 0.46, to: 0.6 },
      { s: "A", play: "mel:fl+12 harp.c vcp vnp va", dyn: 0.6 },
      { s: "A2", play: "mel:vn1 hcnt:hn-12 harp vn2 va vc cb", dyn: 0.68 },
      { s: "B", play: "mel:cl hb:vn1+12 timp:timp swell:perc harp.b va vc.b cb", dyn: 0.64, to: 0.84 },
      { s: "A2", play: "mel:tp mel:vn1 mel:fl+12 hcnt:hn-12 crash:perc timp:timp tb harp vn2 va vc cb", dyn: 0.82 },
      { s: "coda", play: "tag:hn ttag:tp timp:timp gliss:harp spark:glock vn2 va vc cb", dyn: 0.72, to: 0.48, rit: 0.72 },
    ],
  ],
  rest: [8, 16],
};
