// 《吉里的读经声》：学院的短主题·爪哇北岸格雷西克的吉里（凯奇利；群岛各地的王子与学生来这里学经）。
// F 上近似斯连德罗的五声（F G A C D：不带半音的那一种，与东南亚的航海曲用的佩洛格不同），4/4 拍（每分钟 100 拍，一遍三十多秒）。
// 地方特色第二阶段重编：由真正的甘美兰奏“软的”宫廷合奏（原来是木琴、钢片琴、竖琴与木笛“模仿”）——骨干旋律与苏灵笛的旋律不变：
// - 萨龙奏一拍一个音的骨干旋律，斯连特姆低八度跟着；
// - 根德尔两手奏流动的十六分音符，甘邦木琴在高处另绕一串，西特齐特琴隔八度一下一下地拨；
// - 克图在每小节第一、三拍“突”一下，克农落在第四拍、肯普尔落在第二拍，大锣在每四小节的最后一拍收；
// - 伊斯兰学堂（pesantren）里的特尔班框鼓（没有响弦）打着拍子——这是吉里，不是宫廷；
// - 苏灵笛在第二遍上面拉长音唱。
// 甘美兰没有西洋的和声：原来的 F6、Dm7 一类和弦去掉，只剩很轻的 F–C 空五度持续音托底。
import type { TrackDef } from "../score";
import { octave, paraphrase } from "./mainland";
import { punctuate, woven, type Ladder } from "./weave";

/** 斯连德罗一类的五声（从低到高）。 */
const SLENDRO: Ladder = { notes: ["D", "F", "G", "A", "c", "d", "f", "g", "a", "c'"] };

/** 骨干旋律（每拍一个音；“c4 G4”“F8”这种长音按拍重复）。 */
const BAL = ["F", "G", "A", "c", "d", "c", "A", "F", "G", "A", "d", "A", "c", "c", "G", "G", "A", "c", "d", "f", "d", "c", "A", "c", "G", "A", "c", "G", "F", "F", "F", "F"];

/** 西特：每拍先拨低八度、再拨本音。 */
const SITER = BAL.map((p, i) => `${i > 0 && i % 4 === 0 ? "| " : ""}${octave(p, -1)} ${p}`).join(" ");

export const AC_GIRI: TrackDef = {
  id: "ac_giri",
  title: { zh: "吉里的读经声", en: "Recitation at Giri" },
  qpm: 100,
  meter: [4, 4],
  key: "F major",
  level: 1.2,
  voices: {
    saron: { inst: "saron", gain: 0.38, pan: 0.1, reverb: 0.3 },
    slenthem: { inst: "slenthem", gain: 0.32, pan: -0.06, reverb: 0.36 },
    gender: { inst: "gender", gain: 0.34, pan: 0.22, reverb: 0.38 },
    gambang: { inst: "gambang", gain: 0.2, pan: -0.26, reverb: 0.32 },
    siter: { inst: "siter", gain: 0.2, pan: 0.32, reverb: 0.3 },
    suling: { inst: "suling", gain: 0.44, pan: -0.14, reverb: 0.44 },
    kethuk: { inst: "kethuk", gain: 0.2, pan: 0.16, reverb: 0.3 },
    kenong: { inst: "kenong", gain: 0.3, pan: 0.2, reverb: 0.42 },
    kempul: { inst: "kempul", gain: 0.32, pan: -0.16, reverb: 0.44 },
    gong: { inst: "gong_ageng", gain: 0.56, pan: 0.02, reverb: 0.55 },
    terbang: {
      inst: "perc",
      gain: 0.3,
      pan: 0.18,
      reverb: 0.24,
      pattern: { kind: "drum", steps: "D.tDot.t", hits: { D: ["terbang_dung", 0.7], t: ["terbang_tak", 0.55], o: ["terbang_tung", 0.5] } },
    },
    // 衬底（合成）：很轻的 F–C 空五度
    pad: { inst: "drone", gain: 0.1, pan: -0.14, reverb: 0.46, pattern: { kind: "drone", notes: [41, 48] } },
  },
  sections: {
    A: {
      bars: 8,
      lines: {
        bal: "F2 G2 A2 c2 | d2 c2 A2 F2 | G2 A2 d2 A2 | c4 G4 | A2 c2 d2 f2 | d2 c2 A2 c2 | G2 A2 c2 G2 | F8",
        suling: "!vib!c6 d2 | {g}f4 d4 | !vib!d6 c2 | !vib!c8 | z4 f3 g | !bend!a4 f4 | g4 !fall!d4 | !vib!c8",
        flow: woven(BAL, SLENDRO),
        run: paraphrase(BAL, SLENDRO, true),
        siter: SITER,
        kethuk: Array.from({ length: 8 }, () => "G,2 z2 G,2 z2").join(" | "),
        kenong: punctuate(BAL, 4),
        kempul: punctuate(BAL, 2, ",,", [0, 1, 2, 4, 5, 6]),
        gong: punctuate(BAL, 4, ",,,", [3, 7]),
      },
    },
  },
  forms: [
    [
      { s: "A", play: "bal:saron bal:slenthem-12 flow:gender kethuk:kethuk kenong:kenong kempul:kempul gong:gong terbang pad", dyn: 0.62 },
      { s: "A", play: "bal:saron bal:slenthem-12 flow:gender run:gambang+12 siter:siter suling:suling kethuk:kethuk kenong:kenong kempul:kempul gong:gong terbang pad", dyn: 0.66, to: 0.6 },
    ],
    [
      { s: "A", play: "bal:saron bal:slenthem-12 run:gambang+12 siter:siter kethuk:kethuk kenong:kenong kempul:kempul gong:gong terbang pad", dyn: 0.62 },
      { s: "A", play: "bal:saron bal:slenthem-12 flow:gender suling:suling kethuk:kethuk kenong:kenong kempul:kempul gong:gong terbang pad", dyn: 0.64, to: 0.58 },
    ],
  ],
  rest: [8, 14],
};
