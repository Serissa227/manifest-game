// 八种方法与统计工具的已知答案测试（手算或教科书公式）。
import { describe, expect, it } from "vitest";
import { AR_PHI_MAX, ar1, damped, drift, fitMethod, holt, linear, movingAverage, naive, ses } from "./methods";
import { chiSquareSf, fSf, normalQuantile, quantile, regIncBeta, tQuantile } from "./stats";

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe("统计工具", () => {
  it("正态与 t 分位数", () => {
    close(normalQuantile(0.975), 1.959964, 1e-5);
    close(normalQuantile(0.9), 1.281552, 1e-5);
    close(normalQuantile(0.5), 0, 1e-9);
    close(normalQuantile(0.001), -3.090232, 1e-5);
    // t 分布：df = 1、2 精确；df = 3、10、30 与分布表一致（Cornish–Fisher 误差 < 0.01）
    close(tQuantile(0.975, 1), 12.7062, 1e-3);
    close(tQuantile(0.975, 2), 4.3027, 1e-3);
    close(tQuantile(0.975, 3), 3.1824, 1e-2);
    close(tQuantile(0.975, 10), 2.2281, 2e-3);
    close(tQuantile(0.9, 30), 1.3104, 1e-3);
  });

  it("不完全 Beta、F 与卡方的尾概率", () => {
    close(regIncBeta(0.5, 2, 2), 0.5, 1e-9);
    close(regIncBeta(0.3, 1, 1), 0.3, 1e-9);
    // F(2, 10) 的 5% 临界值约 4.103
    close(fSf(4.1028, 2, 10), 0.05, 1e-3);
    // 卡方(10) 的 5% 临界值约 18.307；卡方(1) 的 3.841
    close(chiSquareSf(18.307, 10), 0.05, 1e-3);
    close(chiSquareSf(3.841, 1), 0.05, 1e-3);
  });

  it("分位数线性插值", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([10], 0.9)).toBe(10);
  });
});

describe("基准方法", () => {
  const y = [10, 12, 11, 13];

  it("朴素法：点预测是最后一个值，σ_h = σ√h", () => {
    const f = naive(y);
    close(f.sigma, Math.sqrt(3));
    const { mean, sd } = f.forecast(4);
    expect(mean).toEqual([13, 13, 13, 13]);
    close(sd[3], Math.sqrt(3) * 2);
  });

  it("漂移法：斜率取首尾连线，σ_h = σ√(h(1 + h/(T−1)))", () => {
    const f = drift(y);
    expect(f.info.slope).toBe(1);
    close(f.sigma, Math.sqrt(3));
    const { mean, sd } = f.forecast(2);
    expect(mean).toEqual([14, 15]);
    close(sd[0], Math.sqrt(3) * Math.sqrt(1 + 1 / 3));
    close(sd[1], Math.sqrt(3) * Math.sqrt(2 * (1 + 2 / 3)));
  });

  it("移动平均：最近 k 天均值，区间用一步残差的标准差", () => {
    const f = movingAverage([1, 2, 3, 4, 5], 2);
    expect(f.fitted).toEqual([null, null, 1.5, 2.5, 3.5]);
    close(f.sigma, 1.5);
    const { mean, sd } = f.forecast(3);
    expect(mean).toEqual([4.5, 4.5, 4.5]);
    expect(sd).toEqual([1.5, 1.5, 1.5]);
  });

  it("线性回归：最小二乘，预测区间含参数不确定性，用 t 分布", () => {
    const f = linear([1, 3, 2, 5, 4]);
    close(f.info.slope as number, 0.8);
    close(f.sigma, Math.sqrt(3.6 / 3));
    const { mean, sd, df } = f.forecast(1);
    close(mean[0], 5.4);
    close(sd[0], Math.sqrt(3.6 / 3) * Math.sqrt(1 + 1 / 5 + 9 / 10));
    expect(df).toBe(3);
  });
});

describe("指数平滑", () => {
  it("SES：α = 0.5 手算；σ_h = σ√(1 + α²(h − 1))", () => {
    const f = ses([10, 12, 11, 13], { alpha: 0.5 });
    expect(f.fitted).toEqual([null, 10, 11, 11]);
    close(f.sigma, 2);
    const { mean, sd } = f.forecast(3);
    expect(mean).toEqual([12, 12, 12]);
    close(sd[2], 2 * Math.sqrt(1.5));
  });

  it("SES 自动估计 α：随机游走得到大的 α，围绕常数的噪声得到小的 α", () => {
    const walk = [100, 104, 99, 107, 111, 108, 115, 121, 117, 124, 130, 126, 133, 139, 135, 142];
    expect(ses(walk).params.alpha as number).toBeGreaterThan(0.6);
    const noise = [100, 103, 97, 101, 99, 104, 96, 100, 102, 98, 101, 99, 103, 97, 100, 101];
    expect(ses(noise).params.alpha as number).toBeLessThan(0.3);
  });

  it("Holt 与阻尼趋势：完全线性的序列一步不差地外推", () => {
    const y = Array.from({ length: 12 }, (_, t) => 10 + 2 * t);
    const h = holt(y, { alpha: 0.5, beta: 0.5 });
    close(h.sse, 0);
    expect(h.forecast(3).mean.map((v) => Math.round(v * 1e6) / 1e6)).toEqual([34, 36, 38]);
    const d = damped(y, { alpha: 0.5, beta: 0.5, phi: 0.9 });
    const m = d.forecast(2).mean;
    const level = d.info.level as number;
    const trend = d.info.trend as number;
    close(m[0], level + 0.9 * trend);
    close(m[1], level + (0.9 + 0.81) * trend);
  });

  it("Holt 的 h 步标准差：σ√(1 + Σ_{j<h}(α + αβ*·j)²)（等于 ETS(A,A,N) 的闭式）", () => {
    const y = [10, 13, 12, 15, 17, 16, 20, 21, 22, 25];
    const f = holt(y, { alpha: 0.4, beta: 0.3 });
    const h = 5;
    const sd = f.forecast(h).sd[h - 1];
    const a = 0.4;
    const b = 0.4 * 0.3;
    const closed = f.sigma * Math.sqrt(1 + (h - 1) * (a * a + a * b * h + (b * b * h * (2 * h - 1)) / 6));
    close(sd, closed, 1e-9);
  });
});

describe("均值回归 AR(1)", () => {
  it("没有噪声的回归序列：估计出 φ 与均衡价，h 步预测 μ + φ^h(y_T − μ)", () => {
    const y = Array.from({ length: 30 }, (_, t) => 100 + 50 * 0.8 ** t);
    const f = ar1(y);
    close(f.params.arPhi as number, 0.8, 1e-9);
    close(f.params.mu as number, 100, 1e-6);
    close(f.info.halfLife as number, Math.log(0.5) / Math.log(0.8), 1e-9);
    const last = y[y.length - 1];
    const m = f.forecast(3).mean;
    close(m[2], 100 + 0.8 ** 3 * (last - 100), 1e-6);
  });

  it("h 步标准差 σ√((1 − φ^{2h}) / (1 − φ²))，趋近无条件标准差", () => {
    const y = [100, 108, 103, 97, 102, 110, 104, 99, 95, 101, 106, 100, 96, 103, 107, 98, 101, 104, 99, 102];
    const f = ar1(y);
    const phi = f.params.arPhi as number;
    const sd = f.forecast(200).sd;
    close(sd[0], f.sigma);
    close(sd[199], f.sigma / Math.sqrt(1 - phi * phi), 1e-6);
  });

  it("看不出均值回归（φ 接近 1）时按随机游走处理；手动给均衡价时只估计 φ", () => {
    const trendy = Array.from({ length: 30 }, (_, t) => 100 + 3 * t);
    const f = ar1(trendy);
    expect(f.info.randomWalk).toBe(true);
    expect(f.params.arPhi).toBe(AR_PHI_MAX);
    expect(f.forecast(2).mean).toEqual([187, 187]);
    const g = ar1([90, 95, 97, 99, 98, 100, 99, 101, 100], { mu: 100 });
    expect(g.params.mu).toBe(100);
    expect(g.params.arPhi as number).toBeGreaterThan(0);
  });
});

describe("剔除日期（序列里的空缺）", () => {
  it("平滑类方法在空缺处只推进状态；朴素法的区间按离最后一个观测的步数放宽", () => {
    const y = [10, 12, null, 13, null];
    const f = naive(y);
    expect(f.forecast(1).mean).toEqual([13]);
    close(f.forecast(1).sd[0], f.sigma * Math.sqrt(2));
    const s = ses(y, { alpha: 0.5 });
    expect(s.residuals[2]).toBeNull();
    expect(s.fitted[3]).toBe(11);
  });

  it("按 key 拟合，窗口参数传给移动平均", () => {
    expect(fitMethod("ma", [1, 2, 3, 4, 5, 6], { k: 3 }).params.k).toBe(3);
    expect(fitMethod("linear", [1, 2, 3]).method).toBe("linear");
  });
});
