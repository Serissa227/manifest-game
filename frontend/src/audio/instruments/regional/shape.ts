// 地方乐器共用的小工具：共振峰、滚降、音高换算、鼓点的两种层（鼓皮与噪声）、双簧管一族的谐波表。
import type { DrumLayer, DrumSpec } from "../../dsp";
import type { Harmonics } from "../../instruments";

/** 高斯共振峰：频率 f 处的增益（中心 c、宽度 oct 个八度、高度 h）。 */
export function bump(f: number, c: number, oct: number, h: number): number {
  const d = Math.log2(f / c) / oct;
  return h * Math.exp(-d * d);
}

/** 高于 fc 后按 slope 阶衰减。 */
export function roll(f: number, fc: number, slope = 2): number {
  return 1 / (1 + Math.pow(f / fc, slope));
}

/** MIDI 音高（中央 C = 60）→ 频率（Hz）。 */
export function hz(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

/**
 * 鼓皮：正弦从 f0 滑到 f1（时间常数 bend 秒），decay 秒衰减到 −60 dB；modes 为额外的分音 [频率比, 振幅, 衰减秒]；attack 为起音（秒）；
 * hold 为滑音前停留的秒数（说话鼓先响原来的音高，再夹紧或放松）。
 */
export function skin(
  f0: number,
  f1: number,
  bend: number,
  decay: number,
  level: number,
  modes?: readonly (readonly [number, number, number])[],
  attack?: number,
  hold?: number,
): DrumLayer {
  return { kind: "skin", f0, f1, bend, decay, level, ...(modes ? { modes } : {}), ...(attack ? { attack } : {}), ...(hold ? { hold } : {}) };
}

/**
 * 把一种鼓点整体移调：鼓皮层的频率（f0、f1）乘 ratio，泛音的频率比、衰减、噪声层与随机偏差都不变。
 * 用在调了音的鼓上——塔布拉的右手鼓一定调在曲子的萨上，萨换了就换一只鼓皮调在新萨上的鼓（音色是同一种）。
 */
export function retune(spec: DrumSpec, ratio: number): DrumSpec {
  return { ...spec, layers: spec.layers.map((l) => (l.kind === "skin" ? { ...l, f0: l.f0 * ratio, f1: l.f1 * ratio } : l)) };
}

/** 噪声：带通 lo–hi Hz，decay 秒衰减；attack 为起音，taps 为铃片、响弦一类的连续几下。 */
export function hiss(lo: number, hi: number, decay: number, level: number, extra: { attack?: number; taps?: number } = {}): DrumLayer {
  return { kind: "noise", lo, hi, decay, level, ...extra };
}

/**
 * 双簧管一族（唢呐、祖尔纳、谢赫奈、筚篥、祖马里）的谐波表：锥形管，谐波齐全而且慢慢衰减（tilt 越小越亮），
 * 哨片与管身的共振峰（formants：[中心 Hz, 宽度八度, 高度]）给出各自的鼻音与“喊”的颜色，cutoff 以上滚降。
 */
export function reedAmps(tilt: number, formants: readonly (readonly [number, number, number])[], cutoff: number): Harmonics {
  return (n, f) => (1 / Math.pow(n, tilt)) * (0.35 + formants.reduce((s, [c, oct, h]) => s + bump(f, c, oct, h), 0)) * roll(f, cutoff, 3);
}
