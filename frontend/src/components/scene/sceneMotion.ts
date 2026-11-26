// 会动的场景：水面、随风动的东西、天空、灯火各自怎么动（参数与随时间的量）。
// 着色器（sceneWarp.ts）里写的是同一套式子；这里的纯函数给测试、离线预览与“最大位移”的估算用。
// 位移一律按“设计像素”（768×336 的画面）算，画面实际多大都是同样的幅度。
// 这些动画纯属装饰，不进内核、不影响任何确定性的结果。

/** 设计像素的画面尺寸。 */
export const SCENE_DESIGN = { w: 768, h: 336 } as const;

/** 时间取模的周期（秒）：下面每个周期都是它的约数，取模处首尾相接、不跳。 */
export const SCENE_LOOP = 144;

export const SCENE_MOTION = {
  /** 水面：两层横向的细浪（一层沿纵深往近处走、一层反着走）加一点上下起伏；亮处的碎光一明一暗 */
  water: { amp1: 1.5, len1: 13, period1: 2.4, bend: 2.6, bendLen: 97, amp2: 0.7, len2: 5.5, period2: 1.6, lift: 0.45, liftLen: 31, liftPeriod: 3.2, glint: 0.1, glintPeriod: 0.8 },
  /** 随风动的（树冠、旗、帆、篷布、烟）：一层慢摆加一层快而小的抖 */
  wind: { amp1: 1.2, period1: 3.6, lenX: 41, lenY: 23, amp2: 0.45, period2: 1.2, len2: 7, lift: 0.35, liftPeriod: 2.4, liftLen: 17 },
  /** 天空：云极慢地横向挪 */
  sky: { amp: 3.5, period: 48, len: 60 },
  /** 灯火：按 6 像素见方的小块各自明灭 */
  light: { amp1: 0.08, period1: 0.4, amp2: 0.05, period2: 1.2, cell: 6 },
} as const;

const TAU = Math.PI * 2;

/** 一处的各类权重（0–1）：水、随风、天。 */
export interface SceneWeights {
  water: number;
  wind: number;
  sky: number;
}

/** 设计像素 (x, y) 处、t 秒时“该往回取样多远”（与着色器同式）。gain 是淡入的程度（0–1）。 */
export function sceneShift(t: number, x: number, y: number, w: SceneWeights, gain = 1): { dx: number; dy: number } {
  const { water: W, wind: G, sky: S } = SCENE_MOTION;
  const wx = w.water * (W.amp1 * Math.sin(TAU * (y / W.len1 + t / W.period1) + W.bend * Math.sin((TAU * x) / W.bendLen)) + W.amp2 * Math.sin(TAU * (y / W.len2 - t / W.period2) + x * 0.11));
  const wy = w.water * W.lift * Math.sin(TAU * (x / W.liftLen + t / W.liftPeriod));
  const gx = w.wind * (G.amp1 * Math.sin((TAU * t) / G.period1 + x / G.lenX + y / G.lenY) + G.amp2 * Math.sin((TAU * t) / G.period2 + y / G.len2));
  const gy = w.wind * G.lift * Math.sin((TAU * t) / G.liftPeriod + x / G.liftLen);
  const sx = w.sky * S.amp * Math.sin((TAU * t) / S.period + y / S.len);
  return { dx: gain * (wx + gx + sx), dy: gain * (wy + gy) };
}

/** 任何时刻、任何位置的位移都不超过这个数（设计像素）：水、风、天各自满权重时的上界里最大的那个再相加（三者几乎不重叠，取和是宽松的上界）。 */
export function sceneShiftBound(): number {
  const { water: W, wind: G, sky: S } = SCENE_MOTION;
  return W.amp1 + W.amp2 + G.amp1 + G.amp2 + S.amp;
}

/** 着色器用的时间：取模到一个循环里（浮点精度不随游戏时长变差）。 */
export function sceneClock(seconds: number): number {
  const t = seconds % SCENE_LOOP;
  return t < 0 ? t + SCENE_LOOP : t;
}
