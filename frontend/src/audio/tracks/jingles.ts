// 短乐句：出港、入港、发现、大赚时在正在放的曲子上方奏几秒（曲子同时压低约 10 dB，奏完回来，不打断）。
// 都写在 D 大调上，播放时移到正在放的曲子的调上（大调式移到同一主音，小调式移到关系大调，见 engine.cueShift）。
// 时机见 cues.ts；不在“曲目”列表里，也不能在设置里单独点播。
import type { TrackDef } from "../score";

/** 短乐句的编号（顺序即优先级之外的书写顺序；优先级见 cues.ts 的 CUE_ORDER）。 */
export const CUE_IDS = ["depart", "arrive", "discover", "fortune"] as const;
export type CueId = (typeof CUE_IDS)[number];

/** 出港《起锚》：小号吹起帆动机并一路爬上高音，定音鼓滚奏后一击，竖琴向上刮奏（约 5 秒）。 */
const DEPART: TrackDef = {
  id: "cue_depart",
  title: { zh: "起锚", en: "Weigh Anchor" },
  qpm: 100,
  meter: [4, 4],
  key: "D major",
  hall: true,
  voices: {
    trumpet: { inst: "trumpet", gain: 0.5, pan: 0.15, reverb: 0.3 },
    horns: { inst: "horns", gain: 0.5, pan: -0.2, reverb: 0.34 },
    strings: { inst: "strings", gain: 0.42, reverb: 0.45, pattern: { kind: "pad", low: 50, high: 71, size: 4 } },
    celli: { inst: "celli", gain: 0.42, pan: 0.2, reverb: 0.3, pattern: { kind: "arp", low: 38, steps: "1 . . . . . . ." } },
    harp: { inst: "harp", gain: 0.3, pan: -0.4, reverb: 0.4 },
    timp: { inst: "timpani", gain: 0.5, reverb: 0.3 },
  },
  sections: {
    A: {
      bars: 2,
      chords: "D | D",
      lines: {
        tp: "A,3/2 D/2 A2 d4 | f8",
        hn: "z2 D2 F4 | A8",
        timp: "z4 !trem!A,,4 | !accent!D,,2 z6",
        gliss: "z4 D/4F/4A/4d/4f/4a/4d'/4f'/4 z2 | z8",
      },
    },
  },
  forms: [[{ s: "A", play: "tp:trumpet hn:horns timp:timp gliss:harp strings celli", dyn: 0.78, to: 0.7 }]],
  rest: [0, 0],
};

/** 入港《入港》：船钟两响，圆号与小提琴一个温暖的变格终止（G → D），竖琴分解和弦（约 6 秒）。 */
const ARRIVE: TrackDef = {
  id: "cue_arrive",
  title: { zh: "入港", en: "Safe Harbor" },
  qpm: 84,
  meter: [4, 4],
  key: "D major",
  voices: {
    bell: { inst: "bell", gain: 0.42, pan: 0.4, reverb: 0.55 },
    horns: { inst: "horns", gain: 0.62, pan: -0.2, reverb: 0.36 },
    violins: { inst: "violins", gain: 0.55, pan: 0.25, reverb: 0.36 },
    harp: { inst: "harp", gain: 0.36, pan: -0.4, reverb: 0.4, pattern: { kind: "arp", low: 43, steps: "1 5 8 10 12 10 8 5", ring: 2 } },
    strings: { inst: "strings", gain: 0.48, reverb: 0.45, pattern: { kind: "pad", low: 50, high: 71, size: 4 } },
    celli: { inst: "celli", gain: 0.48, pan: 0.2, reverb: 0.3, pattern: { kind: "arp", low: 38, steps: "1 . . . . . . ." } },
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
  forms: [[{ s: "A", play: "bell:bell hn:horns vn:violins harp strings celli", dyn: 0.66, to: 0.52, rit: 0.85 }]],
  rest: [0, 0],
};

/** 发现《发现》：钢片琴一串 E 大三和弦的琶音（D 上的利底亚色彩），小提琴的升 G 上行解决到 A，圆号吹起帆动机落在主和弦上（约 7 秒）。 */
const DISCOVER: TrackDef = {
  id: "cue_discover",
  title: { zh: "发现", en: "Discovery" },
  qpm: 72,
  meter: [4, 4],
  key: "D major",
  hall: true,
  voices: {
    celesta: { inst: "celesta", gain: 0.52, pan: 0.35, reverb: 0.6 },
    horns: { inst: "horns", gain: 0.62, pan: -0.25, reverb: 0.45 },
    violins: { inst: "violins", gain: 0.58, pan: 0.15, reverb: 0.4 },
    harp: { inst: "harp", gain: 0.36, pan: -0.4, reverb: 0.45, pattern: { kind: "arp", low: 43, steps: "1 5 8 10 12 15 12 10", ring: 2 } },
    strings: { inst: "strings", gain: 0.5, reverb: 0.5, pattern: { kind: "pad", low: 52, high: 71, size: 4 } },
  },
  sections: {
    A: {
      bars: 2,
      chords: "E/D | D",
      lines: {
        cel: "B/2e/2^g/2b/2 e'/2^g'/2 b'3 z2 | z2 f/2a/2d'/2f'/2 a'2 z2",
        vn: "^g8 | a8",
        hn: "z8 | A,3/2 D/2 A6",
      },
    },
  },
  forms: [[{ s: "A", play: "cel:celesta vn:violins hn:horns harp strings", dyn: 0.6, to: 0.66, rit: 0.9 }]],
  rest: [0, 0],
};

/** 大赚《大赚》：小号短促的号角，钢片琴一串“叮叮当当”的钱币声，定音鼓收尾（约 4 秒）。 */
const FORTUNE: TrackDef = {
  id: "cue_fortune",
  title: { zh: "大赚", en: "Fortune" },
  qpm: 120,
  meter: [4, 4],
  key: "D major",
  voices: {
    trumpet: { inst: "trumpet", gain: 0.56, pan: 0.15, reverb: 0.28 },
    horns: { inst: "horns", gain: 0.54, pan: -0.2, reverb: 0.3 },
    celesta: { inst: "celesta", gain: 0.52, pan: 0.35, reverb: 0.5 },
    strings: { inst: "strings", gain: 0.48, reverb: 0.4, pattern: { kind: "pad", low: 50, high: 71, size: 4 } },
    timp: { inst: "timpani", gain: 0.52, reverb: 0.3 },
  },
  sections: {
    A: {
      bars: 2,
      chords: "D | A D",
      lines: {
        tp: ".A2 .A2 .d2 .f2 | a3 f d4",
        hn: "F2 F2 A2 A2 | c4 A4",
        coins: "z4 a/2d'/2f'/2a'/2 z2 | z8",
        timp: "D,,2 z6 | A,,2 z2 !accent!D,,2 z2",
      },
    },
  },
  forms: [[{ s: "A", play: "tp:trumpet hn:horns coins:celesta timp:timp strings", dyn: 0.72 }]],
  rest: [0, 0],
};

export const JINGLES: Readonly<Record<CueId, TrackDef>> = {
  depart: DEPART,
  arrive: ARRIVE,
  discover: DISCOVER,
  fortune: FORTUNE,
};
