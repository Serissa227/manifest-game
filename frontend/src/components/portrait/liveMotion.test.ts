// 会动的头像的运动量：位移始终很小、没有运动量时完全静止、指针跟随会缓动并回正、眨眼闭得快睁得慢。
import { describe, expect, it } from "vitest";
import { blinkStep, LIVE_AMPS, LIVE_PERIODS, liveMotion, liveMotionBound, PointerFollow } from "./liveMotion";

const TAU = Math.PI * 2;

describe("liveMotion：每一帧的运动量", () => {
  it("gain 为 0 时一切位移都是 0（页面刚出现的第一帧不跳）", () => {
    const m = liveMotion(12.3, 0.8, -0.6, 384, 0);
    expect([m.lift, m.rot, m.nod, m.shift, m.sway1, m.sway2, m.turnX, m.turnY].every((v) => v === 0)).toBe(true);
  });

  it("呼吸只往上抬、在 0 与满幅之间来回，一个周期后回到原处", () => {
    const h = 384;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i <= 420; i++) {
      const { lift } = liveMotion(i / 100, 0, 0, h);
      lo = Math.min(lo, lift);
      hi = Math.max(hi, lift);
    }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(lo).toBeLessThan(0.01);
    expect(hi).toBeCloseTo(LIVE_AMPS.lift * h, 2);
    expect(liveMotion(1.1 + LIVE_PERIODS.breath, 0, 0, h).lift).toBeCloseTo(liveMotion(1.1, 0, 0, h).lift, 6);
  });

  it("384 像素高的图上，各项位移都在几个像素以内；相位取模到一圈之内", () => {
    const h = 384;
    for (let i = 0; i < 2000; i++) {
      const t = i * 0.173;
      const px = Math.sin(i * 0.7);
      const py = Math.cos(i * 0.31);
      const m = liveMotion(t, px, py, h);
      expect(m.lift).toBeLessThanOrEqual(LIVE_AMPS.lift * h + 1e-9);
      expect(Math.abs(m.rot)).toBeLessThanOrEqual(LIVE_AMPS.rot + LIVE_AMPS.rotFine + LIVE_AMPS.rotPointer + 1e-9);
      expect(Math.abs(m.nod)).toBeLessThanOrEqual((LIVE_AMPS.nod + LIVE_AMPS.nodPointer) * h + 1e-9);
      expect(Math.abs(m.shift)).toBeLessThanOrEqual(LIVE_AMPS.shiftPointer * h + 1e-9);
      expect(m.sway1).toBeGreaterThan(0);
      expect(m.sway1).toBeLessThanOrEqual(LIVE_AMPS.sway1 * h + 1e-9);
      expect(m.phase1).toBeGreaterThanOrEqual(0);
      expect(m.phase1).toBeLessThan(TAU);
      expect(m.phase2).toBeGreaterThanOrEqual(0);
      expect(m.phase2).toBeLessThan(TAU);
    }
    // 最坏情况（各项同向叠加、离颈根 180 像素的发顶）也不到画面高度的百分之五
    expect(liveMotionBound(h, 180)).toBeLessThan(h * 0.05);
  });

  it("没有指针时头只做很小的自发转动；指针偏到一边，头朝那边多转一点、五官也跟过去", () => {
    const h = 384;
    const idle = liveMotion(3, 0, 0, h);
    const right = liveMotion(3, 1, 0, h);
    expect(idle.shift).toBe(0);
    expect(idle.turnX).toBe(0);
    expect(right.rot - idle.rot).toBeCloseTo(LIVE_AMPS.rotPointer, 9);
    expect(right.shift).toBeCloseTo(LIVE_AMPS.shiftPointer * h, 9);
    expect(right.turnX).toBeCloseTo(LIVE_AMPS.turnX * h, 9);
    const down = liveMotion(3, 0, 1, h);
    expect(down.nod - idle.nod).toBeCloseTo(LIVE_AMPS.nodPointer * h, 9);
    expect(down.turnY).toBeCloseTo(LIVE_AMPS.turnY * h, 9);
  });

  it("同一时刻、同样的输入，结果相同（纯函数）", () => {
    expect(liveMotion(7.77, 0.2, -0.4, 720)).toEqual(liveMotion(7.77, 0.2, -0.4, 720));
  });
});

describe("PointerFollow：指针的跟随", () => {
  it("朝目标缓动而不是一步到位；离得再远也只算到单位圆上", () => {
    const f = new PointerFollow();
    f.aim(5000, 100, 100, 100, 400);
    f.step(1 / 30);
    expect(f.x).toBeGreaterThan(0);
    expect(f.x).toBeLessThan(0.2);
    for (let i = 0; i < 60; i++) f.step(1 / 30);
    expect(f.x).toBeGreaterThan(0.98);
    expect(f.x).toBeLessThanOrEqual(1);
    expect(Math.abs(f.y)).toBeLessThan(1e-6);
  });

  it("鼠标离开窗口后回到正中", () => {
    const f = new PointerFollow();
    f.aim(300, 300, 100, 100, 200);
    for (let i = 0; i < 60; i++) f.step(1 / 30);
    expect(Math.hypot(f.x, f.y)).toBeGreaterThan(0.9);
    f.release();
    for (let i = 0; i < 90; i++) f.step(1 / 30);
    expect(Math.hypot(f.x, f.y)).toBeLessThan(0.01);
  });

  it("鼠标停着不动超过 3 秒，头慢慢回正", () => {
    const f = new PointerFollow();
    f.aim(300, 100, 100, 100, 200);
    for (let i = 0; i < 60; i++) f.step(1 / 30);
    const held = f.x;
    expect(held).toBeGreaterThan(0.95);
    for (let i = 0; i < 300; i++) f.step(1 / 30);
    expect(f.x).toBeLessThan(held * 0.2);
  });
});

describe("blinkStep：眨眼的缓动", () => {
  it("闭眼：三四帧（约 100 毫秒）之内闭到九成以上，始终在 0 与 1 之间", () => {
    let a = 0;
    for (let i = 0; i < 3; i++) {
      a = blinkStep(a, true, 1 / 30);
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThanOrEqual(1);
    }
    expect(a).toBeGreaterThan(0.9);
  });

  it("睁眼比闭眼慢一点，最后回到整 0（不留一层若有若无的闭眼补丁）", () => {
    const closing = blinkStep(0, true, 1 / 60);
    const opening = 1 - blinkStep(1, false, 1 / 60);
    expect(opening).toBeLessThan(closing);
    let a = 1;
    for (let i = 0; i < 30; i++) a = blinkStep(a, false, 1 / 30);
    expect(a).toBe(0);
  });
});
