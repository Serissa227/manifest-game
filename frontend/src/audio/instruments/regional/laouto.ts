// 劳托（laouto，希腊的长颈琉特）：四组钢丝复弦、有品，用一根长的羽毛拨片弹；低的两组里夹着高八度的弦（octave），
// 声音亮、带铁弦的金属味，比乌德琴的羊肠弦与深琴身“硬”而“脆”。在群岛与克里特的乐队里主要扫空五度的“孔特拉”节奏，
// 托着里拉琴；偶尔也弹旋律，长音用拨片的震音。
import type { RegionalDef } from "./types";

export const LAOUTO: RegionalDef = {
  key: "laouto",
  region: "ottoman",
  name: { zh: "劳托琴", en: "Laouto" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 2.1,
      tilt: 0.45,
      bright: 0.84,
      pick: 0.12,
      damp: 0.12,
      course: 5,
      octave: 0.32,
      thump: 0.09,
      onset: 0.002,
      body: [[175, 1.4, 4], [420, 1.3, 2], [1300, 1.2, 2], [3000, 1.1, 3]],
      lp: 9500,
      max: 3,
    },
    level: 1.0,
    tremolo: 0.7,
    tremRate: 13,
  },
  // 空五度的扫弦（孔特拉）与一句旋律
  demo: { key: "D dorian", qpm: 100, bars: 3, abc: "[D,A,D]2 [D,A,D] [D,A,D] [D,A,D]2 [C,G,C]2 | [D,A,D]2 [D,A,D] [D,A,D] [G,DG]4 | A G F E D4" },
};
