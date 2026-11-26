// 纳达斯瓦拉姆（南印度的长双簧管）：黑檀木的锥形长管、一只大喇叭口，响得能盖过整个庙会——比北方的谢赫奈低、粗、亮，像一支会唱歌的号。
// 庙宇的仪式、婚礼与游神都要它，旁边总有塔维尔鼓、小钹与一支不按孔的“奥图”管吹着萨的持续音（合称 periya melam，“大乐队”）。
// 卡纳提克的 gamaka 在它上面最夸张：从低处滑上来写 !bend!，句尾落下写 !fall!；在音上大幅度地摆（kampita）写 !vib!——
// 揉得比谢赫奈深得多，而且像维纳琴一样从记谱音往上摆、不往下沉（vibLift 为 1，最高约 +94 音分），只放在三级、七级这些会动的音上，萨与帕平直。
import { reedAmps } from "./shape";
import type { RegionalDef } from "./types";

export const NADASWARAM: RegionalDef = {
  key: "nadaswaram",
  region: "india",
  name: { zh: "纳达斯瓦拉姆", en: "Nadaswaram" },
  instrument: {
    kind: "wind",
    // 比谢赫奈亮（谐波衰减得慢），第一共振峰更低（850 Hz：管更长、喇叭口更大，“号”一样的开阔）
    amps: reedAmps(0.28, [[850, 0.55, 0.8], [1900, 0.5, 0.7], [3400, 0.45, 0.35]], 7500),
    attack: 0.04,
    release: 0.1,
    vib: { rate: 4.6, depth: 13, delay: 0.25 },
    vibBoost: 3.6,
    vibLift: 1,
    breath: { level: 0.02, q: 0.8, ratio: 3 },
    pulse: { level: 0.08, q: 0.9, ratio: 3.5 },
    chiff: 0.04,
    tongue: 0.6,
    glide: 0.12,
    drift: 5,
    blare: { from: 1600, to: 6500, time: 0.15 },
    level: 0.27,
  },
  // 汉萨德瓦尼（萨 = E）：推上来的三级、七级上的 kampita，摇着的三级，推上来的高二级，三级摇过以后从二级落回萨
  demo: { key: "E major", qpm: 72, bars: 4, abc: "F2 !bend!G2 B2 !vib!d2 | e2 d B !vib!G4 | (B d) e2 !bend!f2 e2 | d B G !vib!G2 !fall!F3" },
};
