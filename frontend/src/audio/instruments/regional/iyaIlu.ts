// 伊亚伊卢（说话鼓的“母鼓”，iya ilu）：约鲁巴与贝宁湾一带的说话鼓队里最大的一只，沙漏形、腋下夹绳、弯棒敲——
// 比甘甘大一圈，音低、余音长，由鼓队的领头人打，照着说话的声调“念”出国王的名号与赞辞，甘甘与小鼓跟在后面答。
// 鼓点的轮廓与甘甘一样（平的高音、平的低音、往上滑、往下落、中间的颤），只是整体低了五六个半音。
import { stroke } from "./gangan";
import type { RegionalDef } from "./types";

export const IYA_ILU: RegionalDef = {
  region: "guinea",
  name: { zh: "伊亚伊卢（说话鼓的母鼓）", en: "Iya ilu (master talking drum)" },
  drums: {
    iya_hi: stroke(214, 210, 0, 0.02, 0.42),
    iya_lo: stroke(128, 125, 0, 0.02, 0.52),
    // 敲下去再夹紧：先低后高
    iya_up: stroke(128, 214, 0.06, 0.07, 0.7),
    // 敲下去再放松：先高后低
    iya_down: stroke(214, 120, 0.07, 0.09, 0.75),
    // 很快地一夹一松
    iya_mid: stroke(150, 178, 0.02, 0.03, 0.45),
  },
  // 母鼓“念”一句：低 低 往上滑 · 高 高 往下落 ·
  demo: {
    key: "C major",
    qpm: 92,
    bars: 3,
    drum: [{ steps: "l.lU..h.hD....m.l.lUhD..", hits: { l: ["iya_lo", 0.8], h: ["iya_hi", 0.8], U: ["iya_up", 0.9], D: ["iya_down", 0.9], m: ["iya_mid", 0.7] } }],
  },
};
