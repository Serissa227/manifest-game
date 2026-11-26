// 会动的场景：运动量是纯函数——周期首尾相接、位移有上界、淡入是线性的；着色器里的数与这里是同一套。
import { describe, expect, it } from "vitest";
import { SCENE_DESIGN, SCENE_LOOP, SCENE_MOTION, sceneClock, sceneShift, sceneShiftBound } from "./sceneMotion";
import { sceneFragmentSource } from "./sceneWarp";

const FULL = { water: 1, wind: 1, sky: 1 };
const NONE = { water: 0, wind: 0, sky: 0 };

describe("会动的场景：运动量", () => {
  it("每个周期都是循环长度的约数：时间取模处首尾相接", () => {
    const { water: W, wind: G, sky: S, light: L } = SCENE_MOTION;
    const periods = [W.period1, W.period2, W.liftPeriod, W.glintPeriod, G.period1, G.period2, G.liftPeriod, S.period, L.period1, L.period2];
    for (const p of periods) {
      const n = SCENE_LOOP / p;
      expect(Math.abs(n - Math.round(n)), `周期 ${p}`).toBeLessThan(1e-9);
    }
    for (const [x, y] of [
      [10, 20],
      [400, 300],
      [767, 5],
    ]) {
      const a = sceneShift(3.7, x, y, FULL);
      const b = sceneShift(3.7 + SCENE_LOOP, x, y, FULL);
      expect(b.dx).toBeCloseTo(a.dx, 6);
      expect(b.dy).toBeCloseTo(a.dy, 6);
    }
    expect(sceneClock(SCENE_LOOP + 1.5)).toBeCloseTo(1.5, 9);
    expect(sceneClock(-1)).toBeCloseTo(SCENE_LOOP - 1, 9);
    expect(sceneClock(0)).toBe(0);
  });

  it("没有权重的地方一个像素都不动；位移不超过上界，且小到不会把画面扯开（设计像素里几个像素）", () => {
    for (let t = 0; t < 60; t += 0.37) {
      const s = sceneShift(t, 123, 45, NONE);
      expect(Math.abs(s.dx) + Math.abs(s.dy)).toBe(0);
    }
    const bound = sceneShiftBound();
    expect(bound).toBeLessThan(8);
    let max = 0;
    for (let t = 0; t < SCENE_LOOP; t += 0.61) {
      for (let x = 0; x < SCENE_DESIGN.w; x += 97) {
        for (let y = 0; y < SCENE_DESIGN.h; y += 41) {
          const s = sceneShift(t, x, y, FULL);
          max = Math.max(max, Math.abs(s.dx), Math.abs(s.dy));
        }
      }
    }
    expect(max).toBeLessThanOrEqual(bound);
    expect(max).toBeGreaterThan(2); // 确实在动
  });

  it("各类各动各的：权重减半位移减半；云只横着挪；淡入是线性的，0 时与底图一模一样", () => {
    const water = sceneShift(5, 200, 250, { water: 1, wind: 0, sky: 0 });
    const half = sceneShift(5, 200, 250, { water: 0.5, wind: 0, sky: 0 });
    expect(half.dx).toBeCloseTo(water.dx / 2, 9);
    expect(half.dy).toBeCloseTo(water.dy / 2, 9);
    const sky = sceneShift(5, 200, 40, { water: 0, wind: 0, sky: 1 });
    expect(Math.abs(sky.dy)).toBe(0);
    expect(Math.abs(sky.dx)).toBeLessThanOrEqual(SCENE_MOTION.sky.amp);
    const faded = sceneShift(5, 200, 250, FULL, 0.25);
    const full = sceneShift(5, 200, 250, FULL, 1);
    expect(faded.dx).toBeCloseTo(full.dx * 0.25, 9);
    const still = sceneShift(5, 200, 250, FULL, 0);
    expect(Math.abs(still.dx) + Math.abs(still.dy)).toBe(0);
  });

  it("着色器里的数取自同一份参数（改了参数、着色器跟着变）", () => {
    const src = sceneFragmentSource();
    const num = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));
    const { water: W, wind: G, sky: S, light: L } = SCENE_MOTION;
    for (const n of [W.amp1, W.len1, W.period1, W.bend, W.bendLen, W.amp2, W.len2, W.period2, W.lift, W.liftLen, W.liftPeriod, W.glint, W.glintPeriod]) expect(src, `水 ${n}`).toContain(num(n));
    for (const n of [G.amp1, G.period1, G.lenX, G.lenY, G.amp2, G.period2, G.len2, G.lift, G.liftPeriod, G.liftLen]) expect(src, `风 ${n}`).toContain(num(n));
    for (const n of [S.amp, S.period, S.len, L.amp1, L.period1, L.amp2, L.period2, L.cell]) expect(src, `天与灯 ${n}`).toContain(num(n));
    expect(src).toContain(`vec2(${num(SCENE_DESIGN.w)}, ${num(SCENE_DESIGN.h)})`);
    expect(sceneFragmentSource("mediump")).toContain("precision mediump float;");
  });
});
