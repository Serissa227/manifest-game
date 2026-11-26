import { describe, expect, it } from "vitest";
import type { CoursePreview } from "../../ipc/types";
import { positionAt } from "./navKit";
import { NavPlayback } from "./navPlayback";

const nav = { fleet: 1, day: 12, minute: 120 };
const clock = { day: 12, minute: 480, speed: 1, sampledAt: 0 };
const course: CoursePreview = { points: [[10, 10, 120], [20, 10, 180], [20, 20, 1440]], stops: [] };

describe("航行画面的连续分钟", () => {
  it("100 ms 的后端消息之间仍逐帧移动，收到下一次确认时连续衔接", () => {
    const playback = new NavPlayback();
    const minutes = [0, 16, 33, 50, 83, 99].map((now) => playback.minute(nav, course, clock, now)!);
    expect(minutes).toEqual([120, 125.76, 131.88, 138, 149.88, 155.64]);
    const xs = minutes.map((minute) => positionAt(course.points, minute, 1080, true)!.x);
    expect(xs.every((x, i) => i === 0 || x > xs[i - 1])).toBe(true);
    expect(playback.minute(nav, course, { ...clock, minute: 516, sampledAt: 100 }, 100)).toBe(156);
    expect(clock.minute).toBe(480);
    expect(course.points[0]).toEqual([10, 10, 120]);
  });

  it.each([[1, 121.8], [2, 123.6], [4, 127.2], [8, 134.4], [16, 148.8], [32, 177.6]])(
    "%s 倍速下按真实帧间隔推进小数分钟", (speed, expected) => {
      expect(new NavPlayback().minute(nav, course, { ...clock, speed }, 5)).toBeCloseTo(expected);
    },
  );

  it("稍晚到的确认不把船向后拉，后端追上后继续平滑前进", () => {
    const playback = new NavPlayback();
    expect(playback.minute(nav, course, clock, 60)).toBe(141.6);
    const late = { ...clock, minute: 500, sampledAt: 70 };
    expect(playback.minute(nav, course, late, 70)).toBe(141.6);
    expect(playback.minute(nav, course, late, 75)).toBeCloseTo(141.8);
  });

  it("暂停立即使用准确分钟，恢复与变速从新的采样时刻起算", () => {
    const playback = new NavPlayback();
    playback.minute(nav, course, clock, 100);
    const paused = { ...clock, minute: 501, speed: 0, sampledAt: 120 };
    expect(playback.minute(nav, course, paused, 1_000)).toBe(141);
    const resumed = { ...paused, speed: 2, sampledAt: 1_000 };
    expect(playback.minute(nav, course, resumed, 1_000)).toBe(141);
    expect(playback.minute(nav, course, resumed, 1_025)).toBe(159);
  });

  it("不会越过尚未确认跨过的暂停点，收到确认后解除限制", () => {
    const playback = new NavPlayback();
    const stopped: CoursePreview = { ...course, stops: [{ minute: 150, kind: "sight", loc: 1, text: "" }] };
    expect(playback.minute(nav, stopped, clock, 200)).toBe(150);
    expect(playback.minute(nav, stopped, { ...clock, minute: 511, sampledAt: 200 }, 210)).toBeCloseTo(154.6);
  });

  it("普通商船发现不在连续画面里重新制造暂停，实际暂停仍以确认时钟为准", () => {
    const ships: CoursePreview = { ...course, stops: [{ minute: 130, kind: "sight", loc: null, text: "" }] };
    const playback = new NavPlayback();
    expect(playback.minute(nav, ships, clock, 100)).toBe(156);
    expect(playback.minute(nav, ships, { ...clock, minute: 490, speed: 0 }, 110)).toBe(130);
  });

  it("断线或挂起最多外推 250 ms，不超出预测末端", () => {
    const playback = new NavPlayback();
    expect(playback.minute(nav, course, clock, 10_000)).toBe(210);
    expect(playback.minute(nav, course, clock, 20_000)).toBe(210);
    const short: CoursePreview = { points: [[10, 10, 120], [11, 10, 145]], stops: [] };
    expect(playback.minute(nav, short, clock, 20_000)).toBe(145);
    expect(playback.minute(nav, null, clock, 20_000)).toBeNull();
  });

  it("换日先停在旧航迹终点，新航迹到达后从新一天起算", () => {
    const playback = new NavPlayback();
    const tomorrow = { ...clock, day: 13, minute: 360, sampledAt: 1_000 };
    expect(playback.minute(nav, course, tomorrow, 1_000)).toBe(1440);
    const next: CoursePreview = { points: [[20, 20, 0], [21, 20, 60]], stops: [] };
    expect(playback.minute({ ...nav, day: 13, minute: 0 }, next, tomorrow, 1_000)).toBe(0);
    expect(playback.minute({ ...nav, day: 13, minute: 0 }, next, tomorrow, 1_050)).toBe(18);
  });

  it("新操舵航迹或读档重新锚定，不继承上一条航迹的画面进度", () => {
    const playback = new NavPlayback();
    playback.minute(nav, course, clock, 200);
    const turned: CoursePreview = { points: [[10, 10, 130], [10, 20, 180]], stops: [] };
    expect(playback.minute({ ...nav, minute: 130 }, turned, { ...clock, minute: 490, sampledAt: 200 }, 200)).toBe(130);
    expect(playback.minute({ ...nav, day: 2 }, course, { ...clock, day: 2, speed: 0 }, 5_000)).toBe(120);
  });
});
