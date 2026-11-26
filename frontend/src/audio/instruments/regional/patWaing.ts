// 鼓圈（pat waing，缅甸 hsaing waing 乐队的主奏）：二十一只调好音的鼓吊在一圈雕花的木栏里，鼓皮中心糊着米灰膏调音，
// 乐手坐在圈中用手掌与手指拍出旋律——“咚”的一声有清楚的音高，起音先略高一点再落稳；手掌压住鼓皮一推，音往下滑（写 !fall!）、往上推（写 !bend!）。
// 快的跑句、两手的咬合、突然的停顿是它的脾气。
import type { RegionalDef } from "./types";

export const PAT_WAING: RegionalDef = {
  key: "pat_waing",
  region: "burma",
  name: { zh: "鼓圈（缅甸）", en: "Pat waing" },
  instrument: {
    kind: "mallet",
    // 糊了膏的鼓皮：分音近乎成倍数，所以有音高；手掌的闷响（低通 1.6 kHz 的噪声）；起音高 3.5% 很快落稳
    spec: { partials: [[1, 1, 0.6], [1.98, 0.35, 0.3], [2.95, 0.15, 0.18], [1.52, 0.1, 0.12]], attack: 0.0015, strike: [0.45, 0.01, 1600], glide: { from: 1.035, time: 0.035 }, tilt: 0.25, max: 1.3 },
    level: 1.16,
    release: 0.3,
  },
  demo: { key: "C major", qpm: 104, bars: 3, abc: "c/2d/2e/2g/2 a2 !fall!g2 e d | C, G, C E G2 !bend!c2 | e/2d/2c/2A/2 G/2E/2D/2C/2 C,4" },
};
