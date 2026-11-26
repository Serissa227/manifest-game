// H10iF 船头缓动与“抢风不算漂”的窄测试（纯计算）。
import { describe, expect, it } from "vitest";
import { angleDiff } from "../components/nav/navKit";
import type { CoursePreview, NavView } from "../ipc/types";
import { dayLengthMs } from "../time/daylight";
import { chordHeading, courseAt, deadband, drifting, HEADING_CHORD, nextHeading, PLAY_LEAD_MAX_MIN, ShipMotion, TURN_DEG_PER_S, turnToward } from "./navMotion";
// X06 录下的一段真航迹（宽水帆行、每分钟约 0.0014 格，旧算法在这段里船头左右来回最多）
import seg from "./navMotion.x06.json";

describe("H10iF 船头缓动", () => {
  it("走最短的那一边（350° → 10° 顺时针过北，不倒转 340°）", () => {
    expect(turnToward(350, 10, 50)).toBeCloseTo(359, 5); // 180°/s × 0.05 s = 9°
    expect(turnToward(10, 350, 50)).toBeCloseTo(1, 5);
  });

  it("角速度有上限，一步转够了就停在目标上", () => {
    expect(TURN_DEG_PER_S).toBe(180);
    expect(turnToward(0, 90, 100)).toBeCloseTo(18, 5);
    expect(turnToward(0, 90, 1000)).toBe(90);
  });

  it("按两帧之间的实际间隔算：掉帧、后台标签页回来时一步追上，不夹到 100 ms", () => {
    expect(nextHeading(0, 170, 2000)).toBe(170);
  });

  it("头一帧（没画过）与暂停时直接到位", () => {
    expect(nextHeading(null, 250, 0)).toBe(250);
    expect(nextHeading(0, 170, 16, true)).toBe(170);
    expect(nextHeading(0, 170, 16)).toBeCloseTo(2.88, 5);
  });
});

describe("H10iF 抢风不算漂", () => {
  const base = { heading: 10, wind: { dir: 20, force: 4, name: "" }, sail_limit: 67 };
  const ap = (mode: "sail" | "beat") => ({ dest: 1, dest_name: "柳湾", eta_days: 2, mode });
  it("舵向在逆风禁区里：帆行算漂，抢风不算", () => {
    expect(drifting(200, { ...base, autopilot: ap("sail") })).toBe(true);
    expect(drifting(200, { ...base, autopilot: ap("beat") })).toBe(false);
  });
});

/** 一串目标船头里“方向相反、各超过 3° 的连续转动”交替的次数（与 X06 的“3° 以上的左右反转”同一口径，按目标算）。 */
function reversals(hs: number[]): number {
  const eps: number[] = [];
  let cur = 0;
  for (let i = 1; i < hs.length; i++) {
    const d = angleDiff(hs[i - 1], hs[i]);
    if (Math.abs(d) < 0.05) continue;
    if (cur !== 0 && Math.sign(d) !== Math.sign(cur)) {
      eps.push(cur);
      cur = 0;
    }
    cur += d;
  }
  if (cur !== 0) eps.push(cur);
  const big = eps.filter((e) => Math.abs(e) > 3);
  let n = 0;
  for (let i = 1; i < big.length; i++) if (Math.sign(big[i]) !== Math.sign(big[i - 1])) n++;
  return n;
}

describe("H10iF2 船头按距离取弦、加死区（X06 真数据）", () => {
  const pts = seg.pts as CoursePreview["points"];
  const lo = pts[0][2];
  const hi = pts[pts.length - 1][2];
  const head = (a: { x: number; y: number }, b: { x: number; y: number }) => ((Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI + 360) % 360;

  it("旧的 ±20 分钟弦在这段里来回翻，新的取法不翻", () => {
    const old: number[] = [];
    const neu: number[] = [];
    let g: number | null = null;
    for (let m = seg.from; m <= seg.to; m += 0.7) {
      old.push(head(courseAt(pts, m - 20, 0, false)!, courseAt(pts, m + 20, 0, false)!));
      g = deadband(g, chordHeading(pts, m, lo, hi, 0, false));
      if (g !== null) neu.push(g);
    }
    expect(reversals(old)).toBeGreaterThanOrEqual(8);
    expect(neu.length).toBeGreaterThan(300);
    expect(reversals(neu)).toBe(0);
  });

  it("弦的两端够 HEADING_CHORD 格；凑不够距离时为 null、死区沿用上一次", () => {
    expect(chordHeading(pts, seg.from, seg.from - 2, seg.from + 2, 0, false)).toBeNull();
    expect(deadband(123, null)).toBe(123);
    expect(deadband(100, 103)).toBe(100);
    expect(deadband(100, 105)).toBe(105);
    expect(HEADING_CHORD).toBeGreaterThan(0.2);
  });

  it("航迹真折了的地方照样转过去", () => {
    // 先向东走 300 分钟、再向北走 300 分钟（每分钟 0.002 格，量化到 1/256 格）
    const q = (v: number) => Math.round(v * 256) / 256;
    const bent: CoursePreview["points"] = [];
    for (let m = 0; m <= 600; m++) bent.push(m <= 300 ? [q(10 + 0.002 * m), 10, m] : [q(10.6), q(10 - 0.002 * (m - 300)), m]);
    const before = chordHeading(bent, 100, 0, 600, 0, false)!;
    const after = chordHeading(bent, 500, 0, 600, 0, false)!;
    expect(Math.abs(angleDiff(before, 90))).toBeLessThan(2);
    expect(Math.abs(angleDiff(after, 0))).toBeLessThan(2);
  });
});

describe("H10iF3 日界不等后端", () => {
  const D = 100;
  // 每天一份航迹：向东每分钟 0.002 格；第二天的权威航迹比外推的预测偏北 0.01 格、略落后
  const dayCourse = (x0: number, y0: number): CoursePreview => {
    const pts: CoursePreview["points"] = [];
    for (let m = 0; m <= 1439; m++) pts.push([x0 + 0.002 * m, y0, m]);
    return { points: pts, stops: [] };
  };
  const nav = (day: number, x: number, y: number) =>
    ({ fleet: 0, day, minute: 0, pos: { x, y }, heading: 90, sail: "full", autopilot: { dest: 1, dest_name: "", eta_days: 3, mode: "sail" }, wind: { dir: 0, force: 3, name: "" }, sail_limit: 67, stops: [] }) as unknown as NavView;
  const clockAt = (day: number, navMin: number, sampledAt: number, speed = 4) => ({ day, minute: (navMin + 360) % 1440, speed, sampledAt });

  /** 模拟后端：一天 dayMs 实时，跨日结算 settleMs（时钟停在日末），结算后 navDelay 毫秒到新的航行视图、再 courseDelay 到新航迹。 */
  function run(days: number, settleMs: number, stopAtDay: number | null = null) {
    const dayMs = dayLengthMs(4);
    const sm = new ShipMotion();
    let t = 0;
    const frames: { t: number; x: number; minute: number; abs: number; speed: number }[] = [];
    let n = nav(D, 10, 10);
    let course: CoursePreview | null = dayCourse(10, 10);
    let clock = clockAt(D, 0, 0);
    for (let d = 0; d < days; d++) {
      const day = D + d;
      // 一天里时钟每 100 ms 推一次
      for (let k = 0; k * 100 < dayMs; k++) {
        const until = t + 100;
        clock = clockAt(day, Math.min(1439, (k * 100 * 1440) / dayMs), t);
        for (; t < until; t += 16) {
          const o = sm.sample(n, course, null, clock, t, 0, false)!;
          frames.push({ t, x: o.x, minute: o.minute!, abs: o.courseDay * 1440 + o.minute!, speed: clock.speed });
        }
      }
      // 日结：时钟停在日末 settleMs（续推同一时刻）
      const endAt = t + settleMs;
      while (t < endAt) {
        clock = clockAt(day, 1439.9, t);
        const until = Math.min(endAt, t + 100);
        for (; t < until; t += 16) {
          const o = sm.sample(n, course, null, clock, t, 0, false)!;
          frames.push({ t, x: o.x, minute: o.minute!, abs: o.courseDay * 1440 + o.minute!, speed: clock.speed });
        }
      }
      const nx = 10 + 0.002 * 1440 * (d + 1);
      if (stopAtDay === d) {
        // 后端在次日 6:00 自动暂停
        clock = clockAt(day + 1, 0, t, 0);
        n = nav(day + 1, nx, 10);
        course = null;
        for (const end = t + 600; t < end; t += 16) {
          const o = sm.sample(n, course, null, clock, t, 0, false)!;
          frames.push({ t, x: o.x, minute: o.minute!, abs: o.courseDay * 1440 + o.minute!, speed: 0 });
        }
        return frames;
      }
      n = nav(day + 1, nx, 10.01);
      course = null;
      clock = clockAt(day + 1, 0, t);
      for (const end = t + 150; t < end; t += 16) {
        const o = sm.sample(n, course, null, clock, t, 0, false)!;
        frames.push({ t, x: o.x, minute: o.minute!, abs: o.courseDay * 1440 + o.minute!, speed: clock.speed });
      }
      course = dayCourse(nx - 0.01, 10.01);
    }
    return frames;
  }

  it("日结 0.7 秒（这里一天 1 秒，相当于快进）：H10iF4 起领先按游戏分钟封顶，日界停住不超过 0.2 秒；画面船位不往回退", () => {
    const f = run(5, 700);
    let maxStill = 0;
    let still = 0;
    let back = 0;
    for (let i = 1; i < f.length; i++) {
      if (f[i].abs <= f[i - 1].abs + 1e-9) still += f[i].t - f[i - 1].t;
      else still = 0;
      maxStill = Math.max(maxStill, still);
      if (f[i].x < f[i - 1].x - 1e-6) back++;
    }
    expect(maxStill).toBeLessThanOrEqual(200);
    expect(back).toBe(0);
  });

  it("H10iF4 后端一直不回：领先确认的分钟不超过 PLAY_LEAD_MAX_MIN（也不超过 1.5 秒），到顶停住等", () => {
    const f = run(1, 4000);
    const last = f[f.length - 160];
    const rate = 1440 / dayLengthMs(4);
    const lead = last.abs - (D * 1440 + 1439.9);
    // 封顶的是领先后端最后确认的分钟
    expect(lead).toBeLessThanOrEqual(PLAY_LEAD_MAX_MIN + 0.5);
    expect(lead / rate).toBeLessThanOrEqual(1500 + 1);
    expect(f[f.length - 160].abs - f[f.length - 170].abs).toBeLessThan(1);
  });

  it("H10iF4 后端在次日 6:00 真停了、画面已领先：原地停住不退", () => {
    const f = run(2, 700, 1);
    const tail = f.filter((r) => r.speed === 0);
    const before = f[f.indexOf(tail[0]) - 1];
    for (const r of tail) expect(r.abs).toBeGreaterThanOrEqual(before.abs - 0.5);
    for (let i = 1; i < tail.length; i++) expect(tail[i].x).toBeGreaterThanOrEqual(tail[i - 1].x - 1e-9);
  });
});

describe("H10iF3 新航迹带来画面已经走过的停点", () => {
  const D = 100;
  const pts: CoursePreview["points"] = [];
  for (let m = 0; m <= 1439; m++) pts.push([10 + 0.002 * m, 10, m]);
  const nav = { fleet: 0, day: D, minute: 0, pos: { x: 10, y: 10 }, heading: 90, sail: "full", autopilot: null, wind: { dir: 0, force: 3, name: "" }, sail_limit: 67, stops: [] } as unknown as NavView;
  const clock = (navMin: number, t: number, speed = 4) => ({ day: D, minute: (navMin + 360) % 1440, speed, sampledAt: t });

  it("时钟在走：原地等、不往回拉；后端过了停点接着走；后端在停点暂停：缓回停点", () => {
    const sm = new ShipMotion();
    const first: CoursePreview = { points: pts, stops: [] };
    let t = 0;
    let out = sm.sample(nav, first, null, clock(0, 0), 0, 0, false)!;
    // 后端推到 500，画面因为领先已经在 500 以后
    for (; t <= 1100; t += 16) out = sm.sample(nav, first, null, clock(Math.min(500, (t * 1440) / 3000), t), t, 0, false)!;
    const ahead = out.minute!;
    expect(ahead).toBeGreaterThan(520);
    // 新航迹到了，在 510 有一个停点（画面已经走过）
    const second: CoursePreview = { points: pts, stops: [{ minute: 510, kind: "sight", loc: 3, text: "" }] };
    let minX = out.x;
    for (const end = t + 300; t < end; t += 16) {
      out = sm.sample(nav, second, null, clock(500, t), t, 0, false)!;
      expect(out.x).toBeGreaterThanOrEqual(minX - 1e-9);
      minX = out.x;
    }
    // H10iF4：后端在停点暂停，画面与航迹对得上：原地停住、不退
    const held = out.minute!;
    for (const end = t + 400; t < end; t += 16) out = sm.sample(nav, second, null, clock(510, t, 0), t, 0, false)!;
    expect(out.minute!).toBeGreaterThanOrEqual(held - 0.5);
    // 恢复以后先等后端走到画面的位置，再接着走（不往回）
    let last = out.minute!;
    for (const end = t + 800; t < end; t += 16) {
      out = sm.sample(nav, second, null, clock(510 + ((t - 1400) * 1440) / 3000, t), t, 0, false)!;
      expect(out.minute!).toBeGreaterThanOrEqual(last - 1e-6);
      last = out.minute!;
    }
    expect(last).toBeGreaterThan(held);
  });

  it("H10iF4 必须退：新航迹在画面后面就到港结束了，暂停时缓回港口（不一帧跳回）", () => {
    const sm = new ShipMotion();
    const first: CoursePreview = { points: pts, stops: [] };
    let t = 0;
    let out = sm.sample(nav, first, null, clock(0, 0), 0, 0, false)!;
    for (; t <= 1100; t += 16) out = sm.sample(nav, first, null, clock(Math.min(500, (t * 1440) / 3000), t), t, 0, false)!;
    expect(out.minute!).toBeGreaterThan(520);
    // 航迹在 515 分到港结束，后端停在那儿
    const port: CoursePreview = { points: pts.filter((p) => p[2] <= 515), stops: [{ minute: 515, kind: "port", loc: 3, text: "" }] };
    const startX = out.x;
    let maxStep = 0;
    for (const end = t + 500; t < end; t += 16) {
      const px = out.x;
      out = sm.sample(nav, port, null, clock(515, t, 0), t, 0, false)!;
      maxStep = Math.max(maxStep, Math.abs(out.x - px));
    }
    expect(Math.abs(out.x - (10 + 0.002 * 515))).toBeLessThan(0.01);
    expect(maxStep).toBeLessThan(Math.abs(startX - (10 + 0.002 * 515)) * 0.6 + 1e-6);
  });
});
