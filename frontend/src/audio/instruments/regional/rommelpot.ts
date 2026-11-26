// 隆默尔罐（佛兰德斯与尼德兰的 rommelpot：一只陶罐蒙上猪膀胱，中间插一根芦苇棍，用湿手捋它——布鲁盖尔与哈尔斯画里狂欢节的孩子手里那一件）：
// 摩擦鼓：手在棍上一滑一滞（黏滑），膜被一下下拽着，发出低沉、粗糙、有音高的“轰——”，起音慢（不是敲的），带着沙沙的颤。
// rommelpot 是往下捋的一长声，rommelpot_up 是往上回的短一声。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

/** 摩擦的“轰”：基频 f 加一串谐波（黏滑让波形很尖），起音 attack 秒，decay 秒消失；颤的沙声是一串连着的噪声。 */
function grunt(f: number, decay: number, level: number, attack: number) {
  const modes: (readonly [number, number, number])[] = [[2, 0.62, decay * 0.85], [3, 0.5, decay * 0.75], [4, 0.36, decay * 0.65], [5, 0.28, decay * 0.55], [6, 0.2, decay * 0.45], [7, 0.14, decay * 0.4]];
  return {
    layers: [skin(f * 1.04, f, 0.06, decay, level, modes, attack), hiss(160, 1100, decay * 0.75, level * 0.5, { attack, taps: 5 })],
    vary: 0.03,
  };
}

export const ROMMELPOT: RegionalDef = {
  region: "north_europe",
  name: { zh: "隆默尔罐（摩擦鼓）", en: "Rommelpot (friction drum)" },
  drums: {
    rommelpot: grunt(98, 0.32, 1, 0.03),
    rommelpot_up: grunt(112, 0.18, 0.7, 0.02),
  },
  // 狂欢节的步子：轰 · 嗯 · 轰 · 嗯嗯
  demo: { key: "C major", qpm: 108, bars: 4, drum: [{ steps: "R.u.R.uuR.u.R...", hits: { R: ["rommelpot", 0.9], u: ["rommelpot_up", 0.6] } }] },
};
