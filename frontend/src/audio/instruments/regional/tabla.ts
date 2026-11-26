// 塔布拉（印度）：右手鼓 dayan 调在萨（D4）上——鼓心的“墨”（syahi）让它的分音成倍数，所以有音高；左手鼓 bayan 是低音，
// 手腕在鼓皮上一推，音高往上走（“嗡——呜”）。两只鼓分两个声部写（同时打就是“Dha”= Na + Ge）。
// 右手鼓的几种鼓点每次只差一点点（vary 0.008，约 ±14 音分），调好的音高不跑。
// 鼓点：Na（鼓边，闷住基音，二到五倍音“叮”）、Tin（空击）、Tun（鼓心，基音长鸣）、Te（闷击），Ge（推音）、Go（平的低音）、Ke（左手平拍）。
import { hiss, hz, skin } from "./shape";
import type { RegionalDef } from "./types";

/** 右手鼓的萨（D4）。 */
const SA = hz(62);

export const TABLA: RegionalDef = {
  region: "india",
  name: { zh: "塔布拉", en: "Tabla" },
  drums: {
    tabla_na: { layers: [skin(SA, SA, 0.01, 0.3, 0.2), skin(SA * 2, SA * 2, 0.01, 0.6, 1, [[1.5, 0.55, 0.45], [2, 0.35, 0.35], [2.5, 0.2, 0.25]]), hiss(2000, 8000, 0.008, 0.5)], vary: 0.008 },
    tabla_tin: { layers: [skin(SA, SA, 0.01, 0.5, 0.7), skin(SA * 2, SA * 2, 0.01, 0.5, 0.6, [[1.5, 0.4, 0.35], [2, 0.25, 0.25]]), hiss(1500, 6000, 0.008, 0.35)], vary: 0.008 },
    tabla_tun: { layers: [skin(SA * 1.02, SA, 0.01, 0.9, 1, [[2, 0.25, 0.5], [3, 0.12, 0.35]]), hiss(800, 3000, 0.01, 0.2)], vary: 0.008 },
    tabla_te: { layers: [skin(SA, SA, 0.01, 0.05, 0.6), hiss(800, 4000, 0.02, 0.6)], vary: 0.008 },
    bayan_ge: { layers: [skin(80, 120, 0.12, 0.7, 1), hiss(100, 800, 0.03, 0.3)] },
    bayan_go: { layers: [skin(105, 98, 0.02, 0.5, 1), hiss(100, 800, 0.03, 0.3)] },
    bayan_ke: { layers: [skin(140, 120, 0.01, 0.05, 0.6), hiss(300, 3000, 0.03, 0.8)] },
  },
  // 凯赫尔瓦（八拍）：Dha Ge Na Ti | Na Ke Dhi Na
  demo: {
    key: "D major",
    qpm: 90,
    bars: 3,
    drum: [
      { steps: "n.ntn.in", hits: { n: ["tabla_na", 0.85], t: ["tabla_te", 0.7], i: ["tabla_tin", 0.8] } },
      { steps: "GG...KG.", hits: { G: ["bayan_ge", 0.85], K: ["bayan_ke", 0.7] } },
    ],
  },
};
