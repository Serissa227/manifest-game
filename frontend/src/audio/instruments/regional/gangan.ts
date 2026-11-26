// 说话鼓（几内亚湾，约鲁巴的甘甘 / 敦敦一族，沙漏形）：两面鼓皮用皮绳连着，鼓夹在腋下，弯棒敲——
// 胳膊一夹，绳子拉紧，音高往上走；一松，往下落。鼓手照着说话的声调“念”出名字、谚语与赞辞（这些语言是有声调的），
// 所以它的鼓点不是一个音，是一个音高的轮廓：平的高音、平的低音、敲下去再夹紧（往上滑）、敲下去再放松（往下落）。
// 鼓边挂着小铜铃（saworo），每一下都跟着细细地“嚓”。沃洛夫与曼丁人腋下夹的“塔马”（tama）是同一类的小说话鼓。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

/** 一下：从 f0 赫兹开始，停 hold 秒，再按 bend 滑到 f1；第二层是跟着一起滑的 1.5 倍鼓皮泛音，第三层是铜铃（伊亚伊卢母鼓也用它）。 */
export function stroke(f0: number, f1: number, hold: number, bend: number, decay: number) {
  return {
    layers: [
      skin(f0, f1, bend, decay, 1, undefined, 0.0003, hold),
      skin(f0 * 1.5, f1 * 1.5, bend, decay * 0.5, 0.25, undefined, 0.0003, hold),
      hiss(4000, 11000, 0.04, 0.12, { taps: 2 }),
      hiss(600, 3000, 0.01, 0.3),
    ],
    vary: 0.015,
  };
}

export const GANGAN: RegionalDef = {
  region: "guinea",
  name: { zh: "说话鼓（甘甘）", en: "Talking drum (gangan)" },
  drums: {
    gangan_hi: stroke(300, 296, 0, 0.02, 0.32),
    gangan_lo: stroke(176, 172, 0, 0.02, 0.4),
    // 敲下去再夹紧：先低后高（“问”的声调）
    gangan_up: stroke(176, 300, 0.05, 0.06, 0.55),
    // 敲下去再放松：先高后低（句尾、叹息）
    gangan_down: stroke(300, 168, 0.06, 0.08, 0.6),
    // 很快地一夹一松的颤（滑到中间）
    gangan_mid: stroke(210, 250, 0.02, 0.03, 0.35),
  },
  // 一句“问”、一句“答”：低 低 高↗ · 高 高 低↘ ·
  demo: {
    key: "C major",
    qpm: 92,
    bars: 3,
    drum: [{ steps: "ll.U..h.hhD...m.l.lUh.D.", hits: { l: ["gangan_lo", 0.75], h: ["gangan_hi", 0.75], U: ["gangan_up", 0.85], D: ["gangan_down", 0.85], m: ["gangan_mid", 0.7] } }],
  },
};
