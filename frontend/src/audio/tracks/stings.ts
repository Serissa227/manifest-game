// 时间线事件的短乐句（3–6 秒，一次性）：历史的天平上一件事揭晓、或期限迫近时，在正在放的曲子上方奏一下（与出港、入港的短乐句同一套机制：
// 曲子压低约 10 dB、奏完回来，移到正在放的曲子的调上，见 engine.cueShift）。时机见 ../stings.ts。
// 都按 D 大调登记（移调按它算）：凯旋与平静的两句就写在 D 大调上；悲伤与紧张的两句写在关系小调（B 小调）上——
// 移调之后，在大调的曲子上它们落在那首曲子的关系小调上，在小调的曲子上正好落在那首曲子自己的小调上。
// 不在“曲目”列表里，也不能在设置里单独点播。
import type { TrackDef } from "../score";

/** 时间线短乐句的编号（定义的 id 是 `sting_<编号>`）。 */
export const STING_IDS = ["history_win", "history_loss", "history_as_is", "deadline"] as const;
export type StingId = (typeof STING_IDS)[number];

/** 改写了历史《新的世界线》：小号的上行琶音一路爬到高音，圆号托着，定音鼓滚奏后一击，竖琴刮奏、一记钹（约 5 秒）。 */
const WIN: TrackDef = {
  id: "sting_history_win",
  title: { zh: "新的世界线", en: "A New World-Line" },
  qpm: 100,
  meter: [4, 4],
  key: "D major",
  hall: true,
  voices: {
    trumpet: { inst: "trumpet", gain: 0.52, pan: 0.15, reverb: 0.32 },
    horns: { inst: "horns", gain: 0.5, pan: -0.2, reverb: 0.36 },
    strings: { inst: "strings", gain: 0.42, reverb: 0.45, pattern: { kind: "pad", low: 50, high: 71, size: 4 } },
    celli: { inst: "celli", gain: 0.42, pan: 0.2, reverb: 0.3, pattern: { kind: "arp", low: 38, steps: "1 . . . . . . ." } },
    harp: { inst: "harp", gain: 0.3, pan: -0.4, reverb: 0.4 },
    timp: { inst: "timpani", gain: 0.5, reverb: 0.3 },
    cymbal: { inst: "perc", gain: 0.12, pan: 0.3, reverb: 0.4, pattern: { kind: "drum", steps: "........C.......", hits: { C: ["cymbal", 0.7] } } },
  },
  sections: {
    A: {
      bars: 2,
      chords: "D | D",
      lines: {
        tp: "D3/2 F/2 A2 d4 | f8",
        hn: "A,3/2 D/2 F2 A4 | A8",
        timp: "z4 !trem!A,,4 | !accent!D,,2 z6",
        gliss: "z4 D/4F/4A/4d/4f/4a/4d'/4f'/4 z2 | z8",
      },
    },
  },
  forms: [[{ s: "A", play: "tp:trumpet hn:horns timp:timp gliss:harp strings celli cymbal", dyn: 0.8, to: 0.72 }]],
  rest: [0, 0],
};

/** 没能改变《功败》：低处的圆号与大提琴组落下来，小提琴一声叹息落回主音（关系小调），竖琴一串轻轻的分解和弦（约 5 秒半）。 */
const LOSS: TrackDef = {
  id: "sting_history_loss",
  title: { zh: "功败", en: "The Tide Holds" },
  qpm: 66,
  meter: [3, 4],
  key: "D major",
  hall: true,
  voices: {
    violins: { inst: "violins", gain: 0.5, pan: -0.24, reverb: 0.42 },
    horns: { inst: "horns", gain: 0.46, pan: -0.3, reverb: 0.42 },
    celli: { inst: "celli", gain: 0.48, pan: 0.2, reverb: 0.36 },
    strings: { inst: "strings", gain: 0.36, reverb: 0.5, pattern: { kind: "pad", low: 50, high: 69, size: 3 } },
    harp: { inst: "harp", gain: 0.3, pan: -0.4, reverb: 0.5 },
    timp: { inst: "timpani", gain: 0.36, reverb: 0.4 },
  },
  sections: {
    A: {
      bars: 2,
      // 写在关系小调（B 小调）上：E 小 → 升 F 大 → B 小
      chords: "Em*3 F#*3 | Bm",
      lines: {
        vn: "e3 c3 | d6",
        hn: "B,3 ^A,3 | B,6",
        vc: "E,3 F,3 | B,,6",
        gliss: "z6 | B,/2D/2F/2B/2 z4",
        timp: "z6 | B,,2 z4",
      },
    },
  },
  forms: [[{ s: "A", play: "vn:violins hn:horns vc:celli gliss:harp timp:timp strings", dyn: 0.72, to: 0.6, rit: 0.85 }]],
  rest: [0, 0],
};

/** 照着史实《史书照旧》：圆号与小提琴一个平平的变格终止（G → D），竖琴分解和弦，远处一声钟（约 5 秒）。 */
const AS_IS: TrackDef = {
  id: "sting_history_as_is",
  title: { zh: "史书照旧", en: "As It Was Written" },
  qpm: 72,
  meter: [3, 4],
  key: "D major",
  voices: {
    horns: { inst: "horns", gain: 0.46, pan: -0.2, reverb: 0.4 },
    violins: { inst: "violins", gain: 0.42, pan: -0.26, reverb: 0.42 },
    strings: { inst: "strings", gain: 0.38, reverb: 0.46, pattern: { kind: "pad", low: 50, high: 69, size: 3 } },
    harp: { inst: "harp", gain: 0.3, pan: -0.4, reverb: 0.46 },
    bell: { inst: "bell", gain: 0.36, pan: 0.36, reverb: 0.6 },
  },
  sections: {
    A: {
      bars: 2,
      chords: "G | D",
      lines: {
        hn: "B4 A2 | F6",
        vn: "g4 e2 | f6",
        gliss: "z6 | D/2F/2A/2d/2 z4",
        bell: "z6 | A6",
      },
    },
  },
  forms: [[{ s: "A", play: "hn:horns vn:violins gliss:harp bell:bell strings", dyn: 0.7, to: 0.6, rit: 0.9 }]],
  rest: [0, 0],
};

/** 期限迫近《沙漏》：定音鼓像心跳一样敲属音，梆子越敲越密，圆号沿着属七和弦往上爬，高处弦乐绷着（关系小调的属和弦，约 4 秒）。 */
const DEADLINE: TrackDef = {
  id: "sting_deadline",
  title: { zh: "沙漏", en: "The Hourglass" },
  qpm: 120,
  meter: [4, 4],
  key: "D major",
  voices: {
    horns: { inst: "horns", gain: 0.48, pan: -0.2, reverb: 0.34 },
    violins: { inst: "violins", gain: 0.4, pan: -0.26, reverb: 0.36 },
    celli: { inst: "celli", gain: 0.36, pan: 0.2, reverb: 0.3 },
    strings: { inst: "strings", gain: 0.34, reverb: 0.4, pattern: { kind: "pad", low: 61, high: 76, size: 3 } },
    timp: { inst: "timpani", gain: 0.46, reverb: 0.3 },
    tick: { inst: "perc", gain: 0.3, pan: 0.3, reverb: 0.2, pattern: { kind: "drum", steps: "c.c.c.c.cccccccc", hits: { c: ["clapper", 0.4] } } },
  },
  sections: {
    A: {
      bars: 2,
      // 关系小调（B 小调）的属七和弦
      chords: "F#7 | F#7",
      lines: {
        hn: "F,2 ^A,2 C2 E2 | F8",
        vn: "c8- | c8",
        vc: "F,,8- | F,,8",
        timp: "C,2 z2 C,2 z2 | C,2 C,2 !trem!C,4",
      },
    },
  },
  forms: [[{ s: "A", play: "hn:horns vn:violins vc:celli timp:timp strings tick", dyn: 0.66, to: 0.8 }]],
  rest: [0, 0],
};

export const STINGS: Readonly<Record<StingId, TrackDef>> = {
  history_win: WIN,
  history_loss: LOSS,
  history_as_is: AS_IS,
  deadline: DEADLINE,
};
