// 第八批 E3：周期推算（AR(2)）与四季平滑（Holt–Winters）的已知答案测试，以及月线模式的流水线。
import { describe, expect, it } from "vitest";
import { GENIUS_METHODS, MIN_OBS, MONTHLY_ONLY, ar2, holtWinters } from "./methods";
import { MONTHLY_METHODS, MONTHLY_MIN, runMonthly } from "./monthly";

/** 确定性的白噪声：线性同余发生器给出 [−1, 1) 的均匀随机数。 */
function noise(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return (2 * s) / 2147483648 - 1;
  };
}

/** 猪周期式的 AR(2)：y_t − 100 = 1.2(y_{t−1} − 100) − 0.5(y_{t−2} − 100) + 噪声。 */
function cycle(n: number): number[] {
  const e = noise(7);
  const y = [102, 98];
  for (let t = 2; t < n; t++) y.push(100 + 1.2 * (y[t - 1] - 100) - 0.5 * (y[t - 2] - 100) + 2 * e());
  return y;
}

/** 带趋势与季节的月线：100 + 0.5t + 10·sin(2πt / 12)。 */
const seasonalMonths = (n: number) => Array.from({ length: n }, (_, t) => 100 + 0.5 * t + 10 * Math.sin((2 * Math.PI * t) / 12));

describe("周期推算（AR(2)）", () => {
  it("估计出两个系数与一轮的期数；预测回到均衡价、区间越往后越宽", () => {
    const f = ar2(cycle(400));
    expect(f.method).toBe("ar2");
    expect(Math.abs((f.params.arPhi ?? 0) - 1.2)).toBeLessThan(0.1);
    expect(Math.abs((f.params.arPhi2 ?? 0) + 0.5)).toBeLessThan(0.1);
    // 理论周期 2π / arccos(1.2 / (2√0.5)) ≈ 11.2 期
    expect(Math.abs((f.info.period ?? 0) - 11.2)).toBeLessThan(1.5);
    expect(Math.abs((f.info.mu ?? 0) - 100)).toBeLessThan(2);
    const { mean, sd } = f.forecast(60);
    expect(Math.abs(mean[59] - 100)).toBeLessThan(2);
    expect(sd[1]).toBeGreaterThan(sd[0]);
    expect(sd[59]).toBeGreaterThanOrEqual(sd[5] - 1e-9);
    // σ₁ 就是残差标准差，σ₂ = σ√(1 + φ₁²)
    expect(Math.abs(sd[0] - f.sigma)).toBeLessThan(1e-9);
    expect(Math.abs(sd[1] - f.sigma * Math.sqrt(1 + (f.params.arPhi ?? 0) ** 2))).toBeLessThan(1e-9);
  });

  it("系数不平稳（一路上涨的直线）时退回回归术", () => {
    const f = ar2(Array.from({ length: 60 }, (_, t) => 50 + 2 * t));
    expect(f.method).toBe("ar2");
    expect(f.params.arPhi2).toBe(0);
    expect(f.info.period).toBeUndefined();
  });
});

describe("四季平滑（Holt–Winters）", () => {
  it("没有噪声的趋势 + 季节：往后一年的预测贴着真值，季节起伏约 ±10", () => {
    const y = seasonalMonths(48);
    const f = holtWinters(y);
    expect(f.method).toBe("hw");
    const truth = seasonalMonths(60).slice(48);
    const { mean, sd } = f.forecast(12);
    mean.forEach((m, i) => expect(Math.abs(m - truth[i])).toBeLessThan(1.5));
    expect(Math.abs((f.info.seasonAmp ?? 0) - 10)).toBeLessThan(2);
    for (let i = 1; i < 12; i++) expect(sd[i]).toBeGreaterThanOrEqual(sd[i - 1] - 1e-9);
  });

  it("至少要两年的月线，只用于月线", () => {
    expect(MIN_OBS.hw).toBe(24);
    expect(MONTHLY_ONLY).toEqual(["hw"]);
    expect(GENIUS_METHODS).toEqual(["ses", "linear", "holt", "damped", "ar1", "ar2", "hw"]);
  });
});

describe("月线模式", () => {
  const months = seasonalMonths(30);
  const last = 30 * 30 - 1;

  it("能用的方法都给出往后各月的预测：日期是各月月末，区间把点预测夹在中间", () => {
    expect(MONTHLY_MIN).toBe(24);
    for (const m of MONTHLY_METHODS) {
      const r = runMonthly(months, last, m, 6, 10, 500);
      if (!r.ok) throw new Error(`${m}: ${r.reason}`);
      expect(r.months).toHaveLength(30);
      expect(r.months[29]).toBe(last);
      expect(r.path.map((p) => p.day)).toEqual([1, 2, 3, 4, 5, 6].map((k) => last + 30 * k));
      for (const p of r.path) expect(p.lo95 <= p.lo80 && p.lo80 <= p.mean && p.mean <= p.hi80 && p.hi80 <= p.hi95).toBe(true);
    }
  });

  it("去年同月在月线上就是 12 个月以前；公道价与星象历书不用于月线；月线太短时算不出", () => {
    const r = runMonthly(months, last, "seasonal", 3, 10, 500);
    if (!r.ok) throw new Error(r.reason);
    expect(r.path.map((p) => p.mean)).toEqual([months[18], months[19], months[20]]);
    expect(runMonthly(months, last, "fair", 3, 10, 500)).toEqual({ ok: false, reason: "unsupported" });
    expect(runMonthly(months, last, "astrology", 3, 10, 500)).toEqual({ ok: false, reason: "unsupported" });
    expect(runMonthly(months.slice(0, 20), last, "hw", 3, 10, 500)).toEqual({ ok: false, reason: "too_short" });
  });

  it("预测夹在价格上下限之内", () => {
    const r = runMonthly(months, last, "linear", 12, 10, 110);
    if (!r.ok) throw new Error(r.reason);
    for (const p of r.path) expect(p.hi95).toBeLessThanOrEqual(110);
  });
});
