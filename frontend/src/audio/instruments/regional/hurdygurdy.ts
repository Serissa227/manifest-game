// 手摇弦琴（法兰西的 vielle à roue；佛兰德斯画里乞丐与农民手里的那一件，瑞典叫 vevlira）——旋律弦（两根 chanterelle 齐奏）：
// 右手摇着涂了松香的木轮一直擦弦，所以是弓弦的锯齿波、从不断，左手按键（键上的木片顶住弦）一按就换音：没有揉音、没有滑音，
// 两根旋律弦差一点点音高（齐奏）；木轮的沙沙声跟着波形一开一合，琴箱的鼻音在 500 Hz、1.5 kHz、3 kHz 一带。
// “狗”（chien）：小号弦（trompette）上活动的琴码，摇轮时手腕一顿（coup de poignet）它就跳起来拍在面板上“嗞”一声——
// 布雷舞的节奏全靠它。这里写成鼓点（声部 inst: "perc"）：chien_g / chien_c / chien_d 调在 G3、C4、D4（小号弦常见的几种定弦），
// 每一下是小号弦音高上的一串谐波很满的“嗞”，再加一层碰面板的沙沙声。持续音（bourdon 与 mouche）另是 hurdy_drone。
import { bump, hz, roll } from "./shape";
import type { DrumLayer, DrumSpec } from "../../dsp";
import type { RegionalDef } from "./types";

/** 狗的一下：小号弦音高 f 上的谐波（起音 1.5 毫秒，0.1 秒内消失）加碰面板的沙沙声。 */
function chien(f: number): DrumSpec {
  const modes: (readonly [number, number, number])[] = [];
  // 碰面板的“嗞”是一串窄脉冲：高次谐波与基频一起持续到这一下结束（不像拨弦那样高音先消失）
  for (let k = 2; k <= 16; k++) modes.push([k, 0.95 / Math.pow(k, 0.35), 0.13 - k * 0.001]);
  const buzz: DrumLayer = { kind: "skin", f0: f, f1: f, bend: 0.01, decay: 0.14, level: 0.8, modes, attack: 0.0015 };
  const grit: DrumLayer = { kind: "noise", lo: 1400, hi: 6500, decay: 0.07, level: 0.32, attack: 0.002, taps: 4 };
  return { layers: [buzz, grit], vary: 0.003 };
}

export const HURDYGURDY: RegionalDef = {
  key: "hurdygurdy",
  region: "north_europe",
  name: { zh: "手摇弦琴", en: "Hurdy-gurdy (vielle à roue)" },
  instrument: {
    kind: "bowed",
    amps: (n, f) => (1 / Math.pow(n, 0.85)) * (0.35 + bump(f, 520, 0.45, 0.55) + bump(f, 1500, 0.45, 0.85) + bump(f, 3100, 0.45, 0.6)) * roll(f, 6500, 3),
    attack: 0.03,
    release: 0.12,
    breath: { level: 0.014, q: 0.7, ratio: 6 },
    pulse: { level: 0.09, q: 0.8, ratio: 5 },
    unison: { voices: 2, spread: 5 },
    chiff: 0.02,
    tongue: 0.86,
    glide: 0.005,
    drift: 2,
    level: 0.36,
  },
  drums: {
    chien_g: chien(hz(55)),
    chien_c: chien(hz(60)),
    chien_d: chien(hz(62)),
  },
  // 布雷舞：旋律在上，狗在每个三拍的第一、第三拍“嗞”
  demo: {
    key: "G major",
    qpm: 100,
    bars: 3,
    abc: "G2 B d2 B c2 | e d2 B A2 c2 | B2 G A2 B G2",
    drum: [{ steps: "C.cC.cC.", hits: { C: ["chien_d", 0.85], c: ["chien_d", 0.5] } }],
  },
};
