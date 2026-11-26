// 姆里丹加姆（南印度卡纳提克音乐的双面桶鼓）：右面（valanthalai）中间有一块黑的“索鲁”（铁粉与米糊），让它的分音成倍数——调在萨（E3）上，
// 二到六倍音的“叮”比塔布拉更长、更亮；左面（thoppi）每次演奏前抹一团湿麦面，低沉的“通”（thom），手掌一压音高往上走（gumki）。
// 鼓点：Nam（右面边上，二三倍音响）、Din（右面中间，基音长鸣）、Chapu（小指在边上一弹，高处的四到六倍音“叮——”）、Ki（右面闷击）；
// Tha（左面闷拍）、Thom（左面空击）、Gumki（左面推音）。左右手分两个声部写（同时打就是“Tham”= Nam + Thom）。
import { hiss, hz, skin } from "./shape";
import type { RegionalDef } from "./types";

/** 右面的萨（E3）。 */
const SA = hz(52);

export const MRIDANGAM: RegionalDef = {
  region: "india",
  name: { zh: "姆里丹加姆", en: "Mridangam" },
  drums: {
    mrd_nam: { layers: [skin(SA, SA, 0.01, 0.35, 0.25), skin(SA * 2, SA * 2, 0.01, 0.85, 1, [[1.5, 0.6, 0.6], [2, 0.4, 0.45], [2.5, 0.22, 0.3]]), hiss(1800, 7000, 0.01, 0.45)], vary: 0.008 },
    mrd_din: { layers: [skin(SA * 1.01, SA, 0.01, 1.0, 1, [[2, 0.32, 0.6], [3, 0.16, 0.4], [4, 0.08, 0.3]]), hiss(700, 3000, 0.012, 0.2)], vary: 0.008 },
    mrd_chapu: { layers: [skin(SA * 4, SA * 4, 0.01, 0.9, 0.8, [[1.25, 0.55, 0.7], [1.5, 0.3, 0.5]]), skin(SA * 2, SA * 2, 0.01, 0.5, 0.3), hiss(3000, 9000, 0.006, 0.4)], vary: 0.008 },
    mrd_ki: { layers: [skin(SA * 2, SA * 2, 0.01, 0.05, 0.5), hiss(900, 4500, 0.02, 0.6)], vary: 0.01 },
    mrd_tha: { layers: [skin(150, 130, 0.01, 0.06, 0.6), hiss(300, 2500, 0.03, 0.8)] },
    mrd_thom: { layers: [skin(118, 96, 0.03, 0.7, 1, [[1.6, 0.15, 0.2]]), hiss(100, 900, 0.04, 0.3)] },
    mrd_gumki: { layers: [skin(84, 136, 0.14, 0.8, 1), hiss(100, 700, 0.03, 0.25)] },
  },
  // 阿迪塔拉（八拍：四 + 二 + 二），每拍两下：右手 Nam · Din Ki | Nam · Chapu · | Nam Ki Din · | Nam Ki Chapu ·，左手在一、五拍“通”，七拍推音
  demo: {
    key: "E major",
    qpm: 84,
    bars: 4,
    drum: [
      { steps: "n.dkn.c.nkd.nkc.", hits: { n: ["mrd_nam", 0.85], d: ["mrd_din", 0.8], k: ["mrd_ki", 0.65], c: ["mrd_chapu", 0.8] } },
      { steps: "T.....h.T...G.h.", hits: { T: ["mrd_thom", 0.85], G: ["mrd_gumki", 0.8], h: ["mrd_tha", 0.6] } },
    ],
  },
};
