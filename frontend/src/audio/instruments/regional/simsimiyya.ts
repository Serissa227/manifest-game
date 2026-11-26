// 西姆西米亚（阿拉伯，红海沿岸——苏伊士、吉达、荷台达、亚丁的水手与渔夫的竖琴）：一个蒙皮的碗当共鸣箱，两根臂架起横梁，五根金属弦；
// 右手拿拨片一下扫过全部的弦，左手手指按住不要的弦，只让要的那一根响——所以每一拨都带着拨片刮过被按住的弦的“嚓”，
// 没按住的空弦跟着轻轻地响（一层金属的微光）；没有指板，没有滑音，长音是一下下快速的扫弦。
// 比卡农琴更亮、更“铁”，余音比桑图尔短（皮面的碗吸掉了余音）。
// 乐器的年代不作硬性限制：西姆西米亚的记载多在 19 世纪以后，这里取它一听就是红海的声音。
import type { RegionalDef } from "./types";

export const SIMSIMIYYA: RegionalDef = {
  key: "simsimiyya",
  region: "arabia",
  name: { zh: "西姆西米亚琴", en: "Simsimiyya" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 1.15,
      tilt: 0.35,
      bright: 0.96,
      pick: 0.07,
      damp: 0.06,
      thump: 0.24,
      skin: [190, 0.07, 0.1],
      // 没按住的空弦（G A C D G 一类的五声定弦）被拨片带着响
      sympathetic: { notes: [55, 57, 60, 62, 67], level: 0.035, t60: 0.7 },
      onset: 0.002,
      body: [[190, 1.2, 4], [850, 1.3, 2], [2900, 1.2, 4], [5200, 1.2, 2]],
      lp: 11500,
      max: 2,
    },
    level: 0.82,
    tremolo: 0.7,
    tremRate: 9.5,
  },
  // 拉斯特：同一个音扫两下的音型、上下的五声，长音是一下下的扫弦
  demo: { key: "C rast", qpm: 104, bars: 4, abc: "G G A G F E D2 | E E F G !trem!A4 | c c B A G A G F | E D E F !trem!G4" },
};
