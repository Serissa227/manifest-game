// 文艺复兴竖笛一族（recorder consort：高音、中音、次中音、低音四种尺寸一起奏多声部）的共用做法——不是乐器，四件竖笛各自一个文件。
// 文艺复兴的竖笛管腔宽（比巴洛克的竖笛圆、基音强、泛音少，第二、三谐波都弱），几乎不揉音，吐音清楚（“咚”的一下：chiff）；
// 尺寸越大气声越多、起音越慢、第二谐波略强（低音竖笛像吹过瓶口的风）。
// 与原有的 recorder（经典世界在用，第三谐波偏强、像巴洛克竖笛）不同。
import type { SustainSpec } from "../../instruments";

/** 一种尺寸的竖笛：amps 前几个谐波的振幅，air 气声（带通噪声 + 跟着波形的噪声），chiff 吐音的“咚”，attack 起音，level 音量校准。 */
export function recorderSpec(o: { amps: readonly number[]; air: number; ratio: number; chiff: number; attack: number; puff?: number; level: number }): SustainSpec {
  return {
    kind: "wind",
    amps: (n) => o.amps[n - 1] ?? 0,
    attack: o.attack,
    release: o.attack * 2,
    vib: { rate: 4.6, depth: 3, delay: 0.45 },
    vibBoost: 1.6,
    breath: { level: o.air, q: 1.4, ratio: o.ratio },
    pulse: { level: o.air * 0.8, q: 1.2, ratio: o.ratio + 0.8 },
    ...(o.puff ? { puff: { level: o.puff, decay: 0.06 } } : {}),
    chiff: o.chiff,
    tongue: 0.36,
    glide: 0.018,
    drift: 2,
    level: o.level,
  };
}
