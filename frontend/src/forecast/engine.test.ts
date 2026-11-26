// 预测流水线：窗口与剔除、对数尺度、季节修正、干预修正、公式区间与经验区间、上下限与取整；回测与监控。
import { describe, expect, it } from "vitest";
import { backtestAll, backtestMethod, naiveScale } from "./backtest";
import {
  DEFAULT_SPEC,
  Z95,
  allMethods,
  fairPrice,
  lastYearValue,
  monthOfYear,
  roundPath,
  runForecast,
  seasonalIndices,
  truncate,
  type ForecastResult,
  type ForecastSpec,
  type SeriesInput,
} from "./engine";
import { almanac } from "./methods";
import { evaluate } from "./monitor";
import { Rng } from "../art/rng";

/** 围绕均衡价、按 AR(1) 回归的价格（确定性的伪随机噪声）。 */
function arSeries(n: number, mu = 100, phi = 0.9, noise = 3, seed = 7): number[] {
  const rng = new Rng(seed);
  const out: number[] = [];
  let y = mu + 20;
  for (let i = 0; i < n; i++) {
    y = mu + phi * (y - mu) + (rng.next() - 0.5) * 2 * noise;
    out.push(Math.round(y));
  }
  return out;
}

function input(daily: number[], extra: Partial<SeriesInput> = {}): SeriesInput {
  return { daily, lastClose: 200, monthly: [], monthlyLast: null, floor: 1, cap: 100_000, ...extra };
}

const spec = (s: Partial<ForecastSpec>): ForecastSpec => ({ ...DEFAULT_SPEC, ...s });

function ok(r: ReturnType<typeof runForecast>): ForecastResult {
  if (!r.ok) throw new Error(`预测失败：${r.reason}`);
  return r;
}

describe("预测流水线", () => {
  it("窗口只用最近的若干天；路径从起点的下一天起；区间 = 点预测 ± z·σ_h", () => {
    const daily = [...Array(50).fill(500), 100, 102, 98, 101, 99, 100];
    const r = ok(runForecast(input(daily), spec({ method: "naive", window: 6 }), 3));
    expect(r.days).toEqual([195, 196, 197, 198, 199, 200]);
    expect(r.path.map((p) => p.day)).toEqual([201, 202, 203]);
    expect(r.path[0].mean).toBe(100);
    const sd = r.fit.sigma * Math.sqrt(2);
    expect(r.path[1].hi95 - r.path[1].mean).toBeCloseTo(Z95 * sd, 6);
    expect(r.origin).toBe(200);
  });

  it("剔除的日期不参与拟合；没有数据或样本太短时报告原因", () => {
    const daily = [100, 101, 102, 103, 150];
    const r = ok(runForecast(input(daily), spec({ method: "naive", window: 5, excluded: [200] }), 1));
    expect(r.path[0].mean).toBe(103);
    expect(runForecast(input([]), spec({}), 3)).toEqual({ ok: false, reason: "no_data" });
    expect(runForecast(input([100, 101]), spec({ method: "damped" }), 3)).toEqual({ ok: false, reason: "too_short" });
  });

  it("对数尺度：预测与区间在原尺度上显示，区间上宽下窄", () => {
    const daily = Array.from({ length: 40 }, (_, t) => Math.round(100 * 1.02 ** t));
    const r = ok(runForecast(input(daily), spec({ method: "drift", log: true, window: 40 }), 10));
    const p = r.path[9];
    expect(p.mean).toBeGreaterThan(daily[39]);
    expect(p.hi95 - p.mean).toBeGreaterThan(p.mean - p.lo95);
  });

  it("预测与区间夹在价格上下限之内", () => {
    const daily = Array.from({ length: 30 }, (_, t) => 100 + 10 * t);
    const r = ok(runForecast(input(daily, { floor: 50, cap: 420 }), spec({ method: "drift", window: 30 }), 20));
    expect(r.path.every((p) => p.hi95 <= 420 && p.lo95 >= 50)).toBe(true);
    expect(r.path[19].mean).toBe(420);
  });

  it("季节指数：满 24 个月用对中心化移动平均的比率，均值为 1；不足 12 个月不做季节修正", () => {
    const pattern = [1.2, 1.2, 1.2, 1, 1, 1, 0.8, 0.8, 0.8, 1, 1, 1];
    // 月线最后一个值是第 36 个月（第 1079 天所在月）的月末
    const monthly = Array.from({ length: 36 }, (_, i) => 100 * pattern[i % 12]);
    const idx = seasonalIndices(monthly, 36 * 30 - 1) as number[];
    expect(idx).toHaveLength(12);
    expect(idx.reduce((a, b) => a + b, 0) / 12).toBeCloseTo(1, 9);
    idx.forEach((v, m) => expect(v).toBeCloseTo(pattern[m], 6));
    expect(seasonalIndices(monthly.slice(0, 11), 11 * 30 - 1)).toBeNull();
    expect(monthOfYear(359)).toBe(11);
    expect(monthOfYear(360)).toBe(0);
    // 季节修正：去季节后是水平序列，预测跨进下个季节时按指数乘回
    const lastClose = 36 * 30 - 1 + 60; // 第 38 个月末：之后是第 0 个月
    const daily = Array.from({ length: 60 }, (_, i) => 100 * pattern[monthOfYear(lastClose - 59 + i)]);
    const r = ok(runForecast(input(daily, { lastClose, monthly, monthlyLast: 36 * 30 - 1 }), spec({ method: "naive", seasonal: true, window: 60 }), 40));
    expect(r.seasonal).toBe(true);
    expect(r.path[0].mean).toBeCloseTo(100 * pattern[monthOfYear(lastClose + 1)], 6);
  });

  it("干预修正：进行中的脉冲（例如流行）在结束前保持、结束后回到原来的水平；过去的阶跃把旧数据调到新水平", () => {
    const base = Array.from({ length: 40 }, () => 100);
    const daily = [...base.slice(0, 30), ...base.slice(30).map((v) => v * 1.5)];
    const pulse = ok(
      runForecast(input(daily), spec({ method: "ses", params: { alpha: 0.3 }, window: 40, intervention: { day: 191, kind: "pulse", size: 0.5, end: 205 } }), 10),
    );
    expect(pulse.path[0].mean).toBeCloseTo(150, 6);
    expect(pulse.path[3].mean).toBeCloseTo(150, 6);
    expect(pulse.path[4].mean).toBeCloseTo(100, 6);
    const step = ok(runForecast(input(daily), spec({ method: "naive", window: 40, intervention: { day: 191, kind: "step", size: 0.5, end: null } }), 1));
    expect(step.fit.sigma).toBeCloseTo(0, 9);
    const future = ok(runForecast(input(base), spec({ method: "naive", window: 40, intervention: { day: 203, kind: "step", size: -0.2, end: null } }), 5));
    expect(future.path.map((p) => p.mean)).toEqual([100, 100, 80, 80, 80]);
  });

  it("经验区间：按滚动起点的误差分位数给出；样本不够时退回公式区间", () => {
    const daily = arSeries(120);
    const e = ok(runForecast(input(daily), spec({ method: "ar1", window: 60, interval: "empirical" }), 10));
    expect(e.interval).toBe("empirical");
    expect(e.path.every((p) => p.lo95 <= p.lo80 && p.lo80 <= p.mean && p.mean <= p.hi80 && p.hi80 <= p.hi95)).toBe(true);
    const short = ok(runForecast(input(daily.slice(0, 25)), spec({ method: "ar1", window: 60, interval: "empirical" }), 10));
    expect(short.interval).toBe("formula");
  });

  it("区间放大倍数（区间校准）按比例放宽", () => {
    const daily = arSeries(80);
    const a = ok(runForecast(input(daily), spec({ method: "ar1" }), 5));
    const b = ok(runForecast(input(daily), spec({ method: "ar1", sigmaScale: 2 }), 5));
    expect(b.path[4].hi95 - b.path[4].mean).toBeCloseTo(2 * (a.path[4].hi95 - a.path[4].mean), 6);
  });

  it("取整后仍然满足区间的先后次序、非负", () => {
    const rounded = roundPath([{ day: 1, mean: 10.4, lo80: 10.45, hi80: 10.44, lo95: -3, hi95: 10.1 }]);
    expect(rounded).toEqual([{ mean: 10, lo80: 10, hi80: 10, lo95: 0, hi95: 10 }]);
  });

  it("截到更早的起点：日线与月线同步截断", () => {
    const s = input(Array.from({ length: 100 }, (_, i) => i), { lastClose: 99, monthly: [1, 2, 3], monthlyLast: 89 });
    const t = truncate(s, 15);
    expect(t.lastClose).toBe(84);
    expect(t.daily).toHaveLength(85);
    expect(t.monthly).toEqual([1, 2]);
    expect(t.monthlyLast).toBe(59);
  });

  it("全部方法都能在同一份数据上给出预测（没有一年以上的月线时，“去年同月”给不出）", () => {
    const r = allMethods(input(arSeries(80)), spec({}), 10);
    expect(r.map((x) => x.spec.method)).toEqual(["naive", "ma", "drift", "fair", "astrology", "ses", "linear", "holt", "damped", "ar1", "ar2"]);
    expect(runForecast(input(arSeries(80)), spec({ method: "seasonal" }), 10)).toEqual({ ok: false, reason: "no_history" });
    // 四季平滑只用于月线
    expect(runForecast(input(arSeries(80)), spec({ method: "hw" }), 10)).toEqual({ ok: false, reason: "monthly_only" });
    expect(allMethods(input(arSeries(80)), spec({}), 10, ["naive", "ar1"]).map((x) => x.spec.method)).toEqual(["naive", "ar1"]);
  });

  it("去年同月：照去年这个月的月均价，跨月时换成下个月的", () => {
    // 月线 24 个月：第 i 个月的均价 = 100 + i；最后一个月末是第 719 天
    const monthly = Array.from({ length: 24 }, (_, i) => 100 + i);
    const daily = Array.from({ length: 60 }, () => 150);
    const r = ok(runForecast(input(daily, { lastClose: 719, monthly, monthlyLast: 719 }), spec({ method: "seasonal", window: 60 }), 35));
    // 第 720 天（第 25 个月的第一天）→ 去年同月是第 13 个月（下标 12）
    expect(r.path[0].mean).toBe(112);
    expect(r.path[29].mean).toBe(112);
    expect(r.path[30].mean).toBe(113);
    expect(lastYearValue({ ...input([]), monthly, monthlyLast: 719 }, 719)).toBe(111);
    expect(lastYearValue({ ...input([]), monthly, monthlyLast: 719 }, 300)).toBeNull();
  });

  it("公道价：偏离近一年月线均价的部分每过半个月收回一半", () => {
    const monthly = Array.from({ length: 12 }, () => 100);
    const daily = [...Array.from({ length: 30 }, () => 100), 140];
    const r = ok(runForecast(input(daily, { monthly, monthlyLast: 180 }), spec({ method: "fair", window: 31 }), 30));
    expect(r.fit.params.mu).toBeCloseTo(100, 9);
    expect(r.path[14].mean).toBeCloseTo(120, 6);
    expect(r.path[29].mean).toBeCloseTo(110, 6);
    expect(fairPrice(input([]), [90, 110])).toBe(100);
    const quick = ok(runForecast(input(daily, { monthly, monthlyLast: 180 }), spec({ method: "fair", window: 31, params: { halfLife: 5 } }), 5));
    expect(quick.path[4].mean).toBeCloseTo(120, 6);
  });

  it("星象历书：与价格无关的吉凶只由日期决定；回测比“照旧”差", () => {
    expect(almanac(123)).toBe(almanac(123));
    const vals = Array.from({ length: 360 }, (_, d) => almanac(d));
    expect(Math.max(...vals)).toBeLessThanOrEqual(0.1);
    expect(Math.min(...vals)).toBeGreaterThanOrEqual(-0.1);
    const s = input(arSeries(120, 100, 0.95, 2, 5));
    const naiveRow = backtestMethod(s, spec({ method: "naive", window: 60 }), 5);
    const starRow = backtestMethod(s, spec({ method: "astrology", window: 60 }), 5);
    expect(starRow.mase).toBeGreaterThan(naiveRow.mase);
  });
});

describe("回测", () => {
  it("回归型价格：均值回归 AR(1) 的 MASE 比线性趋势小；覆盖率在 0–1 之间", () => {
    const s = input(arSeries(120, 100, 0.85, 4, 11));
    const rows = backtestAll(s, spec({ window: 60 }), 10);
    const by = Object.fromEntries(rows.map((r) => [r.method, r]));
    expect(by.ar1.mase).toBeLessThan(by.linear.mase);
    // 没有月线时“去年同月”没有样本，排在最后；其余按 MASE 从小到大
    expect(rows[rows.length - 1]).toMatchObject({ method: "seasonal", n: 0 });
    const tested = rows.filter((r) => r.n > 0);
    expect(tested).toHaveLength(11);
    // 只用于月线的四季平滑不在日线上试算
    expect(rows.map((r) => r.method)).not.toContain("hw");
    for (let i = 1; i < tested.length; i++) expect(tested[i].mase).toBeGreaterThanOrEqual(tested[i - 1].mase);
    for (const r of tested) {
      expect(r.cov95).toBeGreaterThanOrEqual(r.cov80);
      expect(r.cov95).toBeLessThanOrEqual(1);
    }
  });

  it("数据不够时样本数为 0", () => {
    expect(backtestMethod(input(arSeries(25)), spec({ method: "naive" }), 10).n).toBe(0);
    expect(naiveScale([1, 3, 2])).toBe(1.5);
  });
});

describe("预测监控：误差指标与结论", () => {
  const path = Array.from({ length: 10 }, () => ({ mean: 100, lo80: 95, hi80: 105, lo95: 90, hi95: 110 }));

  it("落在区间内、误差正负相抵：准确", () => {
    const ev = evaluate(100, path, [101, 99, 102, 98, 100, 101, 99, 100, 102, 98]);
    expect(ev.verdict).toBe("accurate");
    expect(ev.outside95).toBe(0);
    expect(Math.abs(ev.ts)).toBeLessThan(3);
    expect(ev.cov80).toBe(1);
  });

  it("一天跑出 95% 区间：有偏差；两天以上且不少于 10%：失败", () => {
    expect(evaluate(100, path, [101, 99, 115, 98]).verdict).toBe("biased");
    const ev = evaluate(100, path, [101, 99, 115, 98, 120]);
    expect(ev.verdict).toBe("failed");
    expect(ev.firstBreach95).toBe(3);
  });

  it("一直偏同一个方向：跟踪信号超过 4 判为失败", () => {
    const ev = evaluate(100, path, [104, 103, 104, 103, 104, 103]);
    expect(ev.ts).toBe(6);
    expect(ev.verdict).toBe("failed");
    expect(ev.bias).toBeCloseTo(3.5, 9);
    expect(ev.trigg).toBeGreaterThan(0.51);
  });

  it("Theil U：比一直等于起点价格的朴素预测好时小于 1；还没有观测时待定", () => {
    const trend = Array.from({ length: 5 }, (_, i) => ({ mean: 100 + 5 * (i + 1), lo80: 0, hi80: 1e9, lo95: 0, hi95: 1e9 }));
    expect(evaluate(100, trend, [104, 111, 114, 121, 124]).theilU).toBeLessThan(1);
    expect(evaluate(100, trend, []).verdict).toBe("pending");
  });
});
