// 贾赫拉陶罐（阿拉伯，海湾——巴林、科威特、卡塔尔的采珠船歌“菲吉里”）：一只装水用的陶罐，横抱着，用手掌拍罐口——
// 罐里的空气被拍得“嗡”地一沉（亥姆霍兹共鸣，110 Hz 一带，比鼓皮的“咚”圆、闷、带一口气）；手指敲罐肚是一声干而亮的“嗒”，陶的分音不谐和。
// 菲吉里里它与小鼓（米尔瓦斯）、众人的拍手一起，在船上的号子底下压着拍子。
import { hiss, skin } from "./shape";
import type { RegionalDef } from "./types";

export const JAHLAH: RegionalDef = {
  region: "arabia",
  name: { zh: "贾赫拉陶罐", en: "Jahlah clay pot" },
  drums: {
    // 掌拍罐口：空气的“嗡”往下沉，一口闷气，手掌拍在罐沿上的一下
    jahlah: { layers: [skin(124, 104, 0.025, 0.34, 1, [[2.63, 0.1, 0.06]], 0.0012), hiss(55, 380, 0.09, 0.42, { attack: 0.002 }), hiss(700, 2400, 0.014, 0.16, { attack: 0.0008 })] },
    // 手指敲罐肚：陶的不谐和分音，很短
    jahlah_tak: { layers: [skin(860, 845, 0.004, 0.055, 0.55, [[1.83, 0.45, 0.035], [2.96, 0.25, 0.022]], 0.0005), hiss(1500, 5200, 0.014, 0.5, { attack: 0.0006 })] },
  },
  // 菲吉里的慢拍子：罐口两下、罐肚点空拍
  demo: { key: "C major", qpm: 84, bars: 4, drum: [{ steps: "J..t..J.J..t..t.J..t..J.J.tt..J.", hits: { J: ["jahlah", 0.9], t: ["jahlah_tak", 0.6] } }] },
};
