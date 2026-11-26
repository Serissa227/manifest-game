// 《会安的河埠》：大越的港口（会安 / 费福、铺宪、升龙城外的河埠——日本町与唐人街挨着越南的木屋）。地方特色第二阶段：越南的丝竹（nhạc tài tử 一类）领奏。
// 调式：北调（điệu Bắc，C D F G A 的五声，明快）与南调里的“怨”（điệu Nam oán：C xự F G 降B，xự 与降 B 上又按又颤，哀而不伤）。
// 怨调的第二级 xự 不是平均律的降 E：比降 E 高、比 E 低，按着颤。这里写成半降 E（`_/E`，约 350 音分，中立的三度），独弦琴与檀筝都用它。
// 4/4（每分钟 84 拍）：
// - 引子（rao）：檀筝一个人慢慢地拨开、按弦，木鱼一下；
// - A（北调）：独弦琴高八度唱旋律（扳竿的上滑、句尾落下、摇竿的颤），檀筝在长音的空当里答一句，月琴在低八度跟着同一条旋律加花（异音），拍板“嗒嗒”地点板眼；
// - A′：竹笛唱同一条旋律，独弦琴在下面拉长了跟着（异音），饭鼓加进来；
// - B（南调·怨）：慢下来，独弦琴独自扳着降 B、xự（半降 E）唱，檀筝在低处稀疏地拨，木鱼一小节一下；
// - A″：全体回来；尾声檀筝一扫、独弦琴一个长长的颤音。
// 不写西洋的和弦：只有很轻的 C–G 空五度持续音托底，低音拨奏只落在 C 与 G 上（不走功能和声的根音进行）。
import type { TrackDef } from "../score";

/** 北调的旋律（A 段）。 */
const MEL = "G2 A c d2 c A | !bend!G4 F D C2 | D F G A c2 !bend!d2 | !vib!c6 A2 | d2 f d c A G A | !bend!c4 A G F2 | D F G A G F D C | D2 !vib!C6";
/** 竹笛的说法：同一条旋律加倚音（láy）。 */
const SAO = "{A}G2 A c d2 {e}d c | !bend!G4 {A}G F D C | D F G A c2 !bend!d2 | !vib!c4 {d}c A G A | d2 f d c A G A | !bend!c4 A G F2 | D F G A {c}G F D C | D2 !vib!C6";
/** 檀筝在长音的空当里答。 */
const TRANH = "z8 | z4 c/2A/2G/2F/2 D2 | z8 | z4 G/2A/2c/2d/2 !bend!f2 | z8 | z4 d/2c/2A/2G/2 F2 | z8 | z2 C/2D/2F/2G/2 !bend!A2 G2";
/**
 * 月琴：跟着独弦琴的同一条旋律加花（异音，丝竹合奏里各件乐器各按自己的手法奏同一条旋律）——
 * 长音上同音连弹、上邻音一勾（倚音），句中加经过音，每拍的落音与旋律相同；只用北调的五个音，不另起低音线、不换“根音”。
 */
const NGUYET = "G G A c d d c A | G {A}G A G F D C2 | D F G A c A d d | c c c d c A A2 | d d f d c A G A | c {d}c c A A G F2 | D F G A G/2A/2G/2F/2 D C | D D C D C G, C2";

export const PORT_VIETNAM: TrackDef = {
  id: "port_vietnam",
  title: { zh: "会安的河埠", en: "River Quay of Hội An" },
  qpm: 84,
  meter: [4, 4],
  key: "C major",
  voices: {
    bau: { inst: "dan_bau", gain: 0.62, pan: -0.06, reverb: 0.4 },
    tranh: { inst: "dan_tranh", gain: 0.42, pan: 0.26, reverb: 0.34 },
    nguyet: { inst: "dan_nguyet", gain: 0.26, pan: -0.28, reverb: 0.26 },
    sao: { inst: "sao_truc", gain: 0.42, pan: 0.12, reverb: 0.4 },
    phach: { inst: "perc", gain: 0.2, pan: 0.34, reverb: 0.26, pattern: { kind: "drum", steps: "x..x..x.", hits: { x: ["phach", 0.7] } } },
    mo: {
      inst: "perc",
      gain: 0.26,
      pan: -0.3,
      reverb: 0.4,
      pattern: {
        a: { kind: "drum", steps: "m.......", hits: { m: ["mo", 0.7] } },
        intro: { kind: "drum", steps: "m...............................", hits: { m: ["mo", 0.75] } },
        coda: { kind: "drum", steps: "........m.......", hits: { m: ["mo", 0.8] } },
      },
    },
    trong: {
      inst: "perc",
      gain: 0.28,
      pan: 0.06,
      reverb: 0.3,
      pattern: {
        a: { kind: "drum", steps: "T..t.T..", hits: { T: ["trong_com", 0.75], t: ["trong_com_tac", 0.55] } },
        b: { kind: "drum", steps: "T..t.TtT", hits: { T: ["trong_com", 0.8], t: ["trong_com_tac", 0.6] } },
      },
    },
    // 衬底（合成）：很轻的 C–G 空五度，低音拨奏在句首点一下
    pad: { inst: "drone", gain: 0.1, pan: -0.16, reverb: 0.46, pattern: { kind: "drone", notes: [36, 43] } },
    bass: { inst: "pizz", gain: 0.2, pan: 0.08, reverb: 0.2 },
  },
  sections: {
    intro: {
      bars: 4,
      lines: {
        // 檀筝的 rao：拨开、按上去、揉
        rao: "C/2D/2F/2G/2 A/2c/2d/2f/2 !bend!g4 | f d c A !vib!G4 | A, C D F G A c d | !bend!d4 !vib!c4",
      },
    },
    A: {
      bars: 8,
      lines: { mel: MEL, sao: SAO, tranh: TRANH, nguyet: NGUYET, low: "C,2 z6 | z8 | z8 | C,2 z6 | z8 | G,,2 z6 | z8 | C,2 z6" },
    },
    B: {
      bars: 8,
      lines: {
        // 南调·怨：降 B 与 xự（半降 E，比降 E 高四分之一音）上又按又颤
        oan: "G4 !bend!_B4 | !vib!c4 _B G F2 | F G !vib!_/E4 C2 | !bend!F4 !fall!F4 | _B2 c2 !bend!_/e4 | !vib!c4 _B G !fall!_B2 | G F _/E C !bend!F4 | !vib!C8",
        // 檀筝在低处稀疏地拨（怨调的定弦：xự 那根弦也调成半降 E，与独弦琴一致）
        low2: "C2 z2 G,2 z2 | z4 _/E2 F2 | C2 z2 G,4 | z4 F,2 C2 | _B,2 z2 _/E2 z2 | z4 G,2 _B,2 | C2 z2 F,2 G,2 | C,4 z4",
        low: "C,2 z6 | z8 | C,2 z6 | z8 | _B,,2 z6 | z8 | C,2 z6 | z8",
      },
    },
    coda: {
      bars: 2,
      lines: {
        // 最后的低八度先后一勾（两根弦同时拨在静处起得太猛，咔嗒检查会算进去）
        sweep: "C/2D/2F/2G/2 A/2c/2d/2f/2 !bend!g4 | C,/2 C3/2 z6",
        end: "z4 !bend!G4 | !vib!c8",
        low: "z8 | C,2 z6",
      },
    },
  },
  forms: [
    [
      { s: "intro", play: "rao:tranh mo.intro pad", dyn: 0.6 },
      { s: "A", play: "mel:bau+12 tranh:tranh nguyet:nguyet phach pad low:bass", dyn: 0.64 },
      { s: "B", play: "oan:bau+12 low2:tranh mo pad low:bass", dyn: 0.56, tempo: 0.88 },
      { s: "A", play: "sao:sao+12 mel:bau tranh:tranh nguyet:nguyet phach trong.b pad low:bass", dyn: 0.72 },
      { s: "coda", play: "sweep:tranh end:bau+12 mo.coda pad low:bass", dyn: 0.66, rit: 0.85 },
    ],
    [
      { s: "A", play: "sao:sao+12 mel:bau tranh:tranh nguyet:nguyet phach trong pad low:bass", dyn: 0.68 },
      { s: "B", play: "oan:bau+12 low2:tranh mo pad low:bass", dyn: 0.56, tempo: 0.88 },
      { s: "coda", play: "sweep:tranh end:bau+12 mo.coda pad low:bass", dyn: 0.66, rit: 0.85 },
    ],
  ],
  rest: [10, 18],
  level: 1.4,
};
