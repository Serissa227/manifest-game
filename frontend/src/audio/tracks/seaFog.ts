// 《雾号》：海上起雾的时候——几十步外就看不见船头，降了帆慢慢地走，隔一阵吹一声号、敲两下钟，听有没有别的船应。
// 第九批 A01（2026-11-11）新写，旋律原创。海区数据写了音乐分区的世界里，舰队在海上、当地天况是雾时放它（天晴了回到这片海的航海曲）。
// B 小调，4/4 拍（每分钟 54 拍），很慢、很空，句子都是断开的：
// - 引子：弦乐极轻的长音，圆号远远地吹两个音（升 F → B，雾号），停一会儿，船钟敲两下；
// - A：竖笛（管弦版是单簧管的低音区）吹几个断开的短句，每句后面都是空的；
// - B：雾更浓——长笛在高处吹一句，经过还原 C（降二级的大三和弦）落在属和弦的升 A 上，悬着；
// - A′：独奏小提琴接过断句，圆号的雾号在下面一声一声地应；尾声钟再敲两下，停在主和弦上。
// 没有打击乐。管弦版：单簧管、长笛、独奏小提琴、圆号、管钟，弦乐的长音（B 段是小提琴组的颤弓）。
import type { TrackDef } from "../score";

const MEL = "B4 d2 c2 | B6 z2 | G4 B2 A2 | F6 z2 | G2 B2 d4 | d2 B6";

export const SEA_FOG: TrackDef = {
  id: "sea_fog",
  title: { zh: "雾号" },
  qpm: 54,
  meter: [4, 4],
  key: "B minor",
  level: 1.7,
  hall: true,
  space: 1.2,
  voices: {
    cl: { inst: "recorder", gain: 0.44, pan: 0.1, reverb: 0.46 },
    fl: { inst: "flute", gain: 0.4, pan: -0.08, reverb: 0.46 },
    vn: { inst: "fiddle", gain: 0.44, pan: -0.3, reverb: 0.44 },
    hn: { inst: "horn", gain: 0.4, pan: -0.24, reverb: 0.52 },
    bell: { inst: "bell", gain: 0.22, pan: 0.32, reverb: 0.58 },
    pad: { inst: "strings", gain: 0.2, pan: 0.1, reverb: 0.48, pattern: { kind: "pad", low: 54, high: 71, size: 3 } },
    hi: { inst: "strings", gain: 0.12, pan: -0.2, reverb: 0.5, pattern: { kind: "pad", low: 66, high: 81, size: 2 } },
    low: { inst: "strings", gain: 0.22, pan: 0.3, reverb: 0.38, pattern: { kind: "pad", low: 30, high: 42, size: 1 } },
  },
  sections: {
    intro: {
      bars: 4,
      chords: "Bm | Bm | G | Bm",
      lines: {
        call: "z4 F4 | B6 z2 | z8 | z8",
        bell: "z8 | z8 | B2 B2 z4 | z8",
      },
    },
    A: {
      bars: 6,
      chords: "Bm | G | Em | F#m | G | Bm",
      lines: { mel: MEL },
    },
    B: {
      bars: 4,
      // 还原 C 的大三和弦是降二级；最后停在属和弦（升 A）
      chords: "Em | Bm | C | F#",
      lines: { bmel: "e4 g2 f2 | d6 z2 | e4 =c2 e2 | ^A6 z2" },
    },
    A2: {
      bars: 6,
      chords: "Bm | G | Em | F#m | G | Bm",
      lines: {
        mel: MEL,
        // 雾号在下面应
        call: "z4 F4 | B6 z2 | z8 | z4 F4 | G6 z2 | F8",
      },
    },
    coda: {
      bars: 2,
      chords: "G | Bm",
      lines: {
        end: "G4 A4 | B8",
        bell: "z8 | B2 B2 z4",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "call:hn bell:bell pad low", dyn: 0.44, to: 0.5 },
      { s: "A", play: "mel:cl pad low", dyn: 0.52 },
      { s: "B", play: "bmel:fl pad hi low", dyn: 0.54, to: 0.58 },
      { s: "A2", play: "mel:vn call:hn pad low", dyn: 0.56, to: 0.5 },
      { s: "coda", play: "end:cl bell:bell pad low", dyn: 0.48, to: 0.36, rit: 0.84 },
    ],
    [
      { s: "intro", play: "call:hn bell:bell pad low", dyn: 0.44, to: 0.5 },
      { s: "A", play: "mel:vn pad low", dyn: 0.52 },
      { s: "B", play: "bmel:fl pad hi low", dyn: 0.54, to: 0.58 },
      { s: "A2", play: "mel:cl call:hn pad hi low", dyn: 0.56, to: 0.5 },
      { s: "B", play: "bmel:vn pad hi low", dyn: 0.56, to: 0.6 },
      { s: "A2", play: "mel:fl call:hn pad low", dyn: 0.56, to: 0.5 },
      { s: "coda", play: "end:cl bell:bell pad low", dyn: 0.48, to: 0.36, rit: 0.84 },
    ],
  ],
  rest: [12, 24],
};
