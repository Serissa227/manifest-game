// 西塔琴（印度）：钢弦在宽的骨质琴桥（jawari）上嗡响；主弦一拨，调在拉格音上的共鸣弦（taraf）跟着亮一层；
// 按弦拉过去的滑音（meend）写 !bend!，颤音（gamak）写 !vib!，铁指套（mizrab）的起音很利。
// 共鸣弦调在 D 上的卡玛吉（D E 升F G A B C D，上行也常用升 C）：港口曲《棉布与靛蓝的码头》在 D 上。
import type { PluckSpec } from "../../dsp";
import type { RegionalDef } from "./types";

/** 西塔琴的弦与琴身；taraf 为共鸣弦的音高（MIDI）。别的拉格、别的主音另登记一件（键不同），共鸣弦跟着改。 */
export function sitarSpec(taraf: readonly number[]): PluckSpec {
  return {
    t60: 3.4,
    tilt: 0.4,
    bright: 0.86,
    pick: 0.08,
    damp: 0.08,
    thump: 0.06,
    onset: 0.003,
    buzz: { at: 0.4, level: 8 },
    sympathetic: { notes: taraf, level: 0.006, t60: 3 },
    body: [[170, 1.2, 3], [520, 1.3, 2], [2400, 1.2, 4]],
    lp: 9500,
    max: 4,
  };
}

export const SITAR: RegionalDef = {
  key: "sitar",
  region: "india",
  name: { zh: "西塔琴", en: "Sitar" },
  instrument: { kind: "pluck", spec: sitarSpec([62, 64, 66, 67, 69, 71, 72, 74]), level: 0.96 },
  // 卡玛吉：滑上去、颤音、上行的升 C
  demo: { key: "D mixolydian", qpm: 80, bars: 4, abc: "D2 F G A2 !bend!B2 | ^c2 !bend!d4 =c B | A G F2 !vib!G4 | !bend!A2 F2 !vib!D4" },
};
