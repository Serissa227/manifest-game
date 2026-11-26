// 里克鼓（阿拉伯，埃及的小框鼓）：鱼皮或羊皮绷在小木框上，框上嵌五对厚的黄铜小钹——开罗“塔赫特”小乐队（乌德琴、卡农琴、奈伊笛、提琴、里克鼓）的节拍核心。
// 鼓心的“咚”（dum）是皮的闷响带着铜钹一抖；鼓边的“嗒”（tak）几乎全是铜钹，亮而脆；手指轻点铜钹的“卡”（ka）；整面一摇的“沙”（sak，哗啦一片、余音长）。
// 铜钹用几支不谐和的高频正弦（黄铜的“铮”）加连串的噪声（几对钹先后相碰）——比原有的铃鼓（riq）重、余音长、带金属的音高。
// 原有的 riq（铃鼓）不动，别的曲子在用；这里的鼓点名都以 riq_ 开头。
import type { DrumLayer } from "../../dsp";
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

/** 一对黄铜小钹的“铮”：几支不谐和的分音（以 f 为基准，衰减 decay 秒）。 */
export function zil(f: number, decay: number, level: number): DrumLayer {
  return skin(f, f, 0.01, decay, level, [[1.37, 0.85, decay * 0.85], [1.83, 0.7, decay * 0.7], [2.41, 0.5, decay * 0.55], [3.07, 0.3, decay * 0.4]], 0.0004);
}

/** 五对小钹里一起响的三对（各自的音高错开，分音因此密而乱，像金属而不像铃）。 */
function zils(decay: number, level: number, lift = 1): DrumLayer[] {
  return [zil(2950 * lift, decay, level), zil(3420 * lift, decay * 0.85, level * 0.8), zil(4180 * lift, decay * 0.7, level * 0.6)];
}

export const RIQ: RegionalDef = {
  region: "arabia",
  name: { zh: "里克鼓", en: "Riq" },
  drums: {
    riq_dum: { layers: [skin(250, 196, 0.012, 0.17, 1, [[1.62, 0.22, 0.07], [2.3, 0.1, 0.05]], 0.0004), ...zils(0.2, 0.06), hiss(4000, 12000, 0.07, 0.3, { taps: 3 })] },
    riq_tak: { layers: [skin(880, 860, 0.006, 0.03, 0.22, undefined, 0.0003), ...zils(0.24, 0.14, 1.04), hiss(3500, 12000, 0.11, 0.9, { taps: 4, attack: 0.0006 })] },
    riq_ka: { layers: [...zils(0.12, 0.09, 1.1), hiss(5000, 12000, 0.05, 0.55, { taps: 2, attack: 0.0006 })] },
    riq_sak: { layers: [...zils(0.42, 0.12), hiss(3500, 11000, 0.28, 0.8, { taps: 7, attack: 0.008 })] },
  },
  // 马克苏姆（咚 嗒 · 嗒 咚 · 嗒 ·）两遍，第三小节加花（卡），最后整面一摇
  demo: {
    key: "C major",
    qpm: 100,
    bars: 4,
    drum: [{ steps: "DT.TD.T.DTkTD.T.DTkTDkTkD.TkD.S.", hits: { D: ["riq_dum", 0.9], T: ["riq_tak", 0.75], k: ["riq_ka", 0.5], S: ["riq_sak", 0.8] } }],
  },
};
