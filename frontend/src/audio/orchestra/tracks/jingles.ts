// 管弦版的短乐句：出港、入港、发现、大赚时在正在放的曲子上方奏几秒（曲子同时压低约 10 dB，奏完回来，不打断）。
// 与合成版一样都写在 D 大调上，播放时移到正在放的曲子的调上（−6…+5 个半音，见 engine.cueShift），
// 所以每个声部的音在这个移调范围里都要落在采样的音域内（测试逐音检查）：圆号的号角放在低八度，小号与钟琴的音也相应摆好。
import type { TrackDef } from "../../score";
import { JINGLES as SYNTH } from "../../tracks/jingles";
import type { CueId } from "../../tracks/jingles";
import { bass, chords, line, pulse, SEAT, WET } from "./kit";

/** 出港《起锚》：圆号在低处吹起帆动机，小号接过来一路爬上高音，吊镲渐强、定音鼓滚奏后一击，竖琴向上刮奏（约 5 秒）。 */
const DEPART: TrackDef = {
  id: "cue_depart",
  title: SYNTH.depart.title,
  qpm: 100,
  meter: [4, 4],
  key: "D major",
  hall: true,
  level: 0.9,
  voices: {
    tp: line("o.tp", 0.48, SEAT.tp, WET.brass),
    hn: line("o.hn", 0.5, SEAT.hn, WET.brass),
    vn2: chords("o.vn", 0.16, SEAT.vn2, WET.strings, 62, 74, 3),
    va: chords("o.va", 0.14, SEAT.va, WET.strings, 55, 67, 2),
    vc: line("o.vc", 0.36, SEAT.vc, 0.22, bass("B . . . . . . .", 43)),
    cb: line("o.cb", 0.26, SEAT.cb, 0.2, bass("B . . . . . . .", 38)),
    harp: line("o.harp", 0.32, SEAT.harp, WET.harp),
    timp: line("o.timp", 0.46, SEAT.timp, 0.3),
    perc: line("o.perc", 0.3, SEAT.perc, 0.4),
  },
  sections: {
    A: {
      bars: 2,
      chords: "D | D",
      lines: {
        hn: "A,,3/2 D,/2 F,2 A,4 | A,8",
        tp: "z2 A2 d4 | f8",
        timp: "z4 !trem!A,,4 | !accent!D,2 z6",
        gliss: "z4 D/4F/4A/4d/4f/4a/4d'/4f'/4 z2 | z8",
        perc: "z4 =G4 | z8",
      },
    },
  },
  forms: [[{ s: "A", play: "hn:hn tp:tp timp:timp gliss:harp perc:perc vn2 va vc cb", dyn: 0.78, to: 0.7 }]],
  rest: [0, 0],
};

/** 入港《入港》：管钟两响（船钟），圆号与小提琴一个温暖的变格终止（G → D），竖琴分解和弦，弦乐的和弦长音（约 6 秒）。 */
const ARRIVE: TrackDef = {
  id: "cue_arrive",
  title: SYNTH.arrive.title,
  qpm: 84,
  meter: [4, 4],
  key: "D major",
  voices: {
    bell: line("o.tubular", 0.34, SEAT.bells, WET.bells),
    hn: line("o.hn", 0.5, SEAT.hn, WET.brass),
    vn1: line("o.vn", 0.48, SEAT.vn1, WET.strings),
    harp: pulse("o.harp", 0.3, SEAT.harp, WET.harp, { kind: "arp", low: 43, steps: "1 5 8 10 12 10 8 5", ring: 2 }),
    vn2: chords("o.vn", 0.14, SEAT.vn2, WET.strings, 62, 74, 2),
    va: chords("o.va", 0.14, SEAT.va, WET.strings, 55, 67, 2),
    vc: line("o.vc", 0.34, SEAT.vc, 0.22, bass("B . . . . . . .", 43)),
    cb: line("o.cb", 0.24, SEAT.cb, 0.2, bass("B . . . . . . .", 38)),
  },
  sections: {
    A: {
      bars: 2,
      chords: "G | D",
      lines: {
        bell: "d2 z d2 z3 | z8",
        hn: "D4 B,4 | A,8",
        vn: "g4 d4 | f8",
      },
    },
  },
  forms: [[{ s: "A", play: "bell:bell hn:hn vn:vn1 harp vn2 va vc cb", dyn: 0.66, to: 0.52, rit: 0.85 }]],
  rest: [0, 0],
};

/** 发现《发现》：竖琴一串 E 大三和弦的琶音（D 上的利底亚色彩），钟琴点两下，小提琴的升 G 上行解决到 A，圆号吹起帆动机落在主和弦上（约 7 秒）。 */
const DISCOVER: TrackDef = {
  id: "cue_discover",
  title: SYNTH.discover.title,
  qpm: 72,
  meter: [4, 4],
  key: "D major",
  hall: true,
  voices: {
    cel: line("o.harp", 0.42, SEAT.harp + 0.1, 0.5),
    glock: line("o.glock", 0.16, SEAT.glock, 0.6),
    hn: line("o.hn", 0.5, SEAT.hn, 0.44),
    vn1: line("o.vn", 0.5, SEAT.vn1, 0.4),
    harp: pulse("o.harp", 0.26, SEAT.harp, WET.harp, { kind: "arp", low: 43, steps: "1 5 8 10 12 15 12 10", ring: 2 }),
    vn2: chords("o.vn", 0.13, SEAT.vn2, 0.42, 64, 76, 3),
    va: chords("o.va", 0.13, SEAT.va, 0.42, 55, 67, 2),
  },
  sections: {
    A: {
      bars: 2,
      chords: "E/D | D",
      lines: {
        cel: SYNTH.discover.sections.A.lines!.cel,
        glock: "z4 b'4 | z4 a'4",
        vn: SYNTH.discover.sections.A.lines!.vn,
        hn: SYNTH.discover.sections.A.lines!.hn,
      },
    },
  },
  forms: [[{ s: "A", play: "cel:cel glock:glock vn:vn1 hn:hn harp vn2 va", dyn: 0.6, to: 0.66, rit: 0.9 }]],
  rest: [0, 0],
};

/** 大赚《大赚》：小号短促的号角（圆号低八度托着），钟琴一串“叮叮当当”的钱币声，定音鼓与一记钹收尾（约 4 秒）。 */
const FORTUNE: TrackDef = {
  id: "cue_fortune",
  title: SYNTH.fortune.title,
  qpm: 120,
  meter: [4, 4],
  key: "D major",
  voices: {
    tp: line("o.tp", 0.5, SEAT.tp, 0.3),
    hn: line("o.hn", 0.46, SEAT.hn, 0.32),
    glock: line("o.glock", 0.24, SEAT.glock, 0.5),
    vn2: chords("o.vn", 0.15, SEAT.vn2, WET.strings, 62, 74, 3),
    va: chords("o.va", 0.14, SEAT.va, WET.strings, 55, 67, 2),
    vc: line("o.vc", 0.34, SEAT.vc, 0.22, bass("B . . . B . . .", 43)),
    timp: line("o.timp", 0.46, SEAT.timp, 0.3),
    perc: line("o.perc", 0.26, SEAT.perc, 0.4),
  },
  sections: {
    A: {
      bars: 2,
      chords: "D | A D",
      lines: {
        tp: ".D2 .D2 .F2 .A2 | e3 c d4",
        hn: "F,2 F,2 A,2 A,2 | C4 A,4",
        coins: "z4 d'/2f'/2a'/2d''/2 z2 | z8",
        timp: "D,2 z6 | A,,2 z2 !accent!D,2 z2",
        perc: "z8 | z4 =F4",
      },
    },
  },
  forms: [[{ s: "A", play: "tp:tp hn:hn coins:glock timp:timp perc:perc vn2 va vc", dyn: 0.72 }]],
  rest: [0, 0],
};

export const ORCH_JINGLES_DEFS: Readonly<Record<CueId, TrackDef>> = {
  depart: DEPART,
  arrive: ARRIVE,
  discover: DISCOVER,
  fortune: FORTUNE,
};
