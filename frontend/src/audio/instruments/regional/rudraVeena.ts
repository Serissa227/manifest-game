// 鲁德拉维纳琴（北印度的“宾”，莫卧儿宫廷德鲁帕德的乐器）：一根粗竹管的琴颈挂着两只大葫芦，粗钢弦在宽的琴桥上慢慢地嗡，
// 声音极低、极长、极暗——乐手在低音区一个音一个音地“摸”出拉格（阿拉普），手指把弦拉过去的滑音（meend）写 !bend!，
// 在音上慢慢地摇（andolan：达尔巴里的降三级与降六级要这样“摇”着唱）写 !andolan!——按 engine.ts 的 ANDOLAN，每秒一下半、从记谱音往下摆，
// 与同一句的萨朗吉、谢赫奈摇得一样；!vib! 是它自己的揉弦（pluckVib：宽而慢，每秒两三下）。
// 侧面的几根“齐卡里”弦调在高处的萨上，在节奏段（jod、jhala）里与旋律音交替着扫：曲谱里写成高八度的 C。
import type { RegionalDef } from "./types";

export const RUDRA_VEENA: RegionalDef = {
  key: "rudra_veena",
  region: "india",
  name: { zh: "鲁德拉维纳琴", en: "Rudra Veena" },
  instrument: {
    kind: "pluck",
    spec: {
      t60: 7.5,
      tilt: 0.3,
      bright: 0.45,
      pick: 0.22,
      damp: 0.2,
      thump: 0.05,
      onset: 0.003,
      // 宽的琴桥：嗡得低而厚（高通 900 Hz，弦本身很快变暗，余音里一直有一层暗的“嗡”）
      buzz: { at: 0.4, level: 6.5, hp: 900 },
      // 两只大葫芦：85 与 170 Hz 一带的深腹，高频往下压
      body: [[85, 1.0, 5], [170, 1.2, 4], [420, 1.3, 1.5], [1800, 1.2, -2]],
      lp: 5500,
      max: 8,
    },
    level: 0.74,
    // !vib! 的揉弦：慢而宽（andolan 另按 ANDOLAN）
    pluckVib: { rate: 2.6, depth: 0.022, delay: 0.25 },
  },
  // 达尔巴里·卡纳达（萨 = C：降 E、降 A、降 B），低音区的阿拉普：萨 — 低七 — 萨，再一 · 摇着的降三 · 四 · 二 — 萨，低五 · 摇着的降六 · 低七 — 萨
  demo: { key: "C minor", qpm: 66, bars: 4, abc: "C,4 B,,2 !bend!C,2 | D,2 !andolan!E,4 F,2 | D,2 C,2 G,,2 !andolan!A,,2 | B,,2 !bend!C,6" },
};
