// H10iF2 镜头前视的窄测试（纯计算）。
import { describe, expect, it } from "vitest";
import { CAMERA_MAX_PX_PER_S, lookSettled, stepLook, type LookState } from "./navLook";

describe("H10iF2 镜头前视", () => {
  const look = 240; // 1600 宽的屏，前视 15%
  const maxY = 300;

  it("头一帧与瞬移当场到位", () => {
    const s = stepLook(null, 90, look, maxY, 0);
    expect(s.off.x).toBeCloseTo(240, 5);
    expect(s.off.y).toBeCloseTo(0, 5);
    const j = stepLook(s, 0, look, maxY, 16, true);
    expect(j.off.y).toBeCloseTo(-240, 5);
  });

  it("船头转 30°：海图不跟着甩，每帧挪动不超过限速，两三秒后才挪到位", () => {
    let s: LookState = stepLook(null, 90, look, maxY, 0);
    const start = { ...s.off };
    let maxStep = 0;
    let t = 0;
    let half = -1;
    for (; t < 12000; t += 16) {
      const prev = s.off;
      s = stepLook(s, 120, look, maxY, 16);
      maxStep = Math.max(maxStep, Math.hypot(s.off.x - prev.x, s.off.y - prev.y));
      const target = { x: Math.sin(Math.PI * 2 / 3) * look, y: 0.5 * look };
      const done = 1 - Math.hypot(s.off.x - target.x, s.off.y - target.y) / Math.hypot(start.x - target.x, start.y - target.y);
      if (half < 0 && done >= 0.5) half = t;
    }
    expect(maxStep).toBeLessThanOrEqual((CAMERA_MAX_PX_PER_S * 16) / 1000 + 1e-9);
    // 挪完一半要一秒以上（原来 0.25 秒的时间常数不到 0.2 秒）
    expect(half).toBeGreaterThan(1000);
    expect(lookSettled(s, 120, look, maxY)).toBe(true);
  });

  it("船头来回细颤（±3°、每秒十几次）时镜头几乎不动", () => {
    let s: LookState = stepLook(null, 90, look, maxY, 0);
    let minY = 0;
    let maxYSeen = 0;
    for (let t = 0; t < 3000; t += 16) {
      s = stepLook(s, 90 + (Math.floor(t / 70) % 2 ? 3 : -3), look, maxY, 16);
      minY = Math.min(minY, s.off.y);
      maxYSeen = Math.max(maxYSeen, s.off.y);
    }
    expect(maxYSeen - minY).toBeLessThan(2);
  });

  it("船真的停了才回到船上，回正也限速（H10iF3）", () => {
    let s: LookState = stepLook(null, 90, look, maxY, 0);
    let maxStep = 0;
    for (let t = 0; t < 4000; t += 16) {
      const prev = s.off.x;
      s = stepLook(s, 90, 0, maxY, 16);
      maxStep = Math.max(maxStep, Math.abs(s.off.x - prev));
    }
    expect(maxStep).toBeLessThanOrEqual((CAMERA_MAX_PX_PER_S * 16) / 1000 + 1e-9);
    expect(Math.abs(s.off.x)).toBeLessThan(0.5);
  });
});
