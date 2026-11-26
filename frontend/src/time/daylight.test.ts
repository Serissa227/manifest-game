import { describe, expect, it } from "vitest";
import {
  clockText,
  dayLengthMs,
  lightingFollowsClock,
  nightAmount,
  normMinute,
  periodOf,
  phaseOf,
  scenePhase,
  SPEEDS,
} from "./daylight";

describe("时钟与昼夜", () => {
  it("光照时段：黎明 5–7、白天 7–17、黄昏 17–19、夜晚 19–5", () => {
    expect(phaseOf(4 * 60 + 59)).toBe("night");
    expect(phaseOf(5 * 60)).toBe("dawn");
    expect(phaseOf(7 * 60)).toBe("day");
    expect(phaseOf(16 * 60 + 59)).toBe("day");
    expect(phaseOf(17 * 60)).toBe("dusk");
    expect(phaseOf(19 * 60)).toBe("night");
    expect(phaseOf(0)).toBe("night");
  });

  it("时段名覆盖一整天", () => {
    expect(periodOf(0)).toBe("lateNight");
    expect(periodOf(6 * 60)).toBe("dawn");
    expect(periodOf(9 * 60)).toBe("morning");
    expect(periodOf(12 * 60)).toBe("noon");
    expect(periodOf(15 * 60)).toBe("afternoon");
    expect(periodOf(18 * 60)).toBe("dusk");
    expect(periodOf(23 * 60 + 59)).toBe("night");
  });

  it("时刻文字与规范化", () => {
    expect(clockText(0)).toBe("00:00");
    expect(clockText(6 * 60 + 40)).toBe("06:40");
    expect(clockText(23 * 60 + 59)).toBe("23:59");
    expect(normMinute(1440 + 5)).toBe(5);
    expect(normMinute(-1)).toBe(1439);
  });

  it("1× 每天 4 秒，32× 等于旧 8× 的每秒 8 天", () => {
    expect(SPEEDS).toEqual([1, 2, 4, 8, 16, 32]);
    expect(dayLengthMs(1)).toBe(4000);
    expect(dayLengthMs(32)).toBe(125);
    expect(dayLengthMs(0)).toBe(Infinity);
  });

  it("防闪烁：4× 及以上或选择始终白天时光照固定为白天，暂停时跟随时钟", () => {
    expect(lightingFollowsClock(0)).toBe(true);
    expect(lightingFollowsClock(1)).toBe(true);
    expect(lightingFollowsClock(2)).toBe(true);
    expect(lightingFollowsClock(4)).toBe(false);
    expect(lightingFollowsClock(32)).toBe(false);
    expect(lightingFollowsClock(1, "day")).toBe(false);
    expect(scenePhase(22 * 60, 1)).toBe("night");
    expect(scenePhase(22 * 60, 8)).toBe("day");
  });

  it("夜色浓度在黎明与黄昏线性过渡", () => {
    expect(nightAmount(12 * 60)).toBe(0);
    expect(nightAmount(2 * 60)).toBe(1);
    expect(nightAmount(6 * 60)).toBeCloseTo(0.5);
    expect(nightAmount(18 * 60)).toBeCloseTo(0.5);
  });
});
