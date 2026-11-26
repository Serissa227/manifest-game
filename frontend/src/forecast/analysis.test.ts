// 原因分析：市场驱动分解（恒等式）、统计诊断、修订建议与修订评估、规格换算、复盘汇总。
import { describe, expect, it } from "vitest";
import type { ForecastEntryView, SeriesView, TrackDayView } from "../ipc/types";
import { compareRevision, suggestAdjustments } from "./adjust";
import { attribute, curveAt } from "./attribution";
import { chowTest, cusumBreak, diagnose } from "./diagnose";
import { DEFAULT_SPEC, roundPath, runForecast, type ForecastSpec, type SeriesInput } from "./engine";
import { evaluate } from "./monitor";
import { reviewEntry, seasonOf } from "./review";
import { specFromView, specToView } from "./spec";

/** 与 data/rules.toml 相同的价格曲线（万分之一）。 */
const CURVE: [number, number][] = [
  [0, 50000],
  [1000, 40000],
  [2500, 28000],
  [5000, 17500],
  [7500, 13000],
  [10000, 10000],
  [12500, 8200],
  [15000, 7000],
  [20000, 5200],
  [30000, 3600],
  [40000, 2800],
  [60000, 2000],
];
const BASE = 100;

/** 按内核公式由库存与需求系数算出的收盘价。 */
function priceOf(stock: number, target: number, demandBp: number): number {
  return Math.round(BASE * curveAt(CURVE, stock / target) * (demandBp / 10_000));
}

function day(d: number, over: Partial<TrackDayView>): TrackDayView {
  const t: TrackDayView = {
    day: d,
    price: 0,
    stock_close: 3000,
    stock_end: 3000,
    target: 3000,
    produced: 100,
    consumed: 100,
    player_bought: 0,
    player_sold: 0,
    npc_bought: 0,
    npc_sold: 0,
    other_bought: 0,
    other_sold: 0,
    demand_bp: 10_000,
    season_bp: 10_000,
    event_bp: 10_000,
    popular: false,
    supply_bp: 10_000,
    event_supply_bp: 10_000,
    clamped: 0,
    ...over,
  };
  t.price = priceOf(t.stock_close, t.target, t.demand_bp);
  return t;
}

/** 按内核的库存恒等式逐日推出的轨迹：收盘 = 前一天日终 − 玩家净买 + 产出 − 消耗；日终 = 收盘 − 商会与做市方净买。 */
function simulate(days: Partial<TrackDayView>[], start: TrackDayView): TrackDayView[] {
  const out: TrackDayView[] = [];
  let prevEnd = start.stock_end;
  days.forEach((o, i) => {
    const t = day(start.day + i + 1, o);
    t.stock_close = prevEnd - t.player_bought + t.player_sold + t.produced - t.consumed;
    t.stock_end = t.stock_close - (t.npc_bought - t.npc_sold) - (t.other_bought - t.other_sold);
    t.price = priceOf(t.stock_close, t.target, t.demand_bp);
    prevEnd = t.stock_end;
    out.push(t);
  });
  return out;
}

describe("市场驱动分解", () => {
  const baseline = day(100, {});

  it("各项（对数）之和等于实际价格的对数变化", () => {
    const track = simulate(
      [
        { player_bought: 400, produced: 90, consumed: 110 },
        { npc_bought: 300, produced: 95, consumed: 100 },
        { popular: true, demand_bp: 15_000, produced: 100, consumed: 120 },
        { season_bp: 12_000, popular: true, demand_bp: 18_000, player_sold: 50, other_sold: 40 },
        { season_bp: 12_000, event_bp: 13_000, popular: true, demand_bp: 23_400, event_supply_bp: 8_000, produced: 80 },
      ],
      baseline,
    );
    for (let t = 1; t <= track.length; t++) {
      const a = attribute({ baseline, baselineExact: true, track, curve: CURVE, popularBonusBp: 5_000 }, t);
      expect(a).not.toBeNull();
      const sum = a!.all.reduce((s, d) => s + d.effect, 0);
      expect(sum).toBeCloseTo(a!.total, 10);
    }
    const a = attribute({ baseline, baselineExact: true, track, curve: CURVE, popularBonusBp: 5_000 }, 5)!;
    const by = Object.fromEntries(a.all.map((d) => [d.key, d]));
    expect(by.popular.effect).toBeCloseTo(Math.log(1.5), 10);
    expect(by.season.effect).toBeCloseTo(Math.log(1.2), 10);
    expect(by.event_demand.effect).toBeCloseTo(Math.log(1.3), 10);
    // 玩家净买入 350 件：库存减少、价格上升；商会第 2 天买走 300 件同样推高价格
    expect(by.player.units).toBe(-350);
    expect(by.player.effect).toBeGreaterThan(0);
    expect(by.npc.units).toBe(-300);
    expect(by.npc.effect).toBeGreaterThan(0);
    // 事件让第 5 天少产了 20 件：库存少、价格高
    expect(by.event_supply.units).toBe(-20);
    expect(by.event_supply.effect).toBeGreaterThan(0);
    expect(a.drivers[0].key).toBe("popular");
  });

  it("起点不完整时从第一天开始分解，第一天本身没有可分解的变化", () => {
    const track = simulate([{ player_bought: 100 }, { produced: 200 }], baseline);
    expect(attribute({ baseline, baselineExact: false, track, curve: CURVE, popularBonusBp: 5_000 }, 1)).toBeNull();
    const a = attribute({ baseline, baselineExact: false, track, curve: CURVE, popularBonusBp: 5_000 }, 2)!;
    expect(a.approximate).toBe(true);
    expect(a.fromDay).toBe(101);
    expect(a.all.reduce((s, d) => s + d.effect, 0)).toBeCloseTo(a.total, 10);
  });

  it("价格曲线与内核一致：分段线性、两端外取端点值", () => {
    expect(curveAt(CURVE, 1)).toBe(1);
    expect(curveAt(CURVE, 0.875)).toBeCloseTo((1.3 + 1) / 2, 10);
    expect(curveAt(CURVE, 10)).toBe(0.2);
  });
});

function arSeries(n: number, mu = 100, phi = 0.8, amp = 3): number[] {
  let y = mu;
  return Array.from({ length: n }, (_, i) => {
    y = mu + phi * (y - mu) + amp * Math.sin(i * 1.7) + (i % 7 === 0 ? 4 : 0);
    return Math.round(y * 10) / 10;
  });
}

const spec = (s: Partial<ForecastSpec>): ForecastSpec => ({ ...DEFAULT_SPEC, ...s });

describe("市场驱动分解：人口、繁荣、替代、城镇工坊与委托交付（第八批 E4）", () => {
  it("目标库存按需求规模的分量分摊，工坊与交付计入库存驱动，各项之和仍等于价格的对数变化", () => {
    const baseline = day(100, { people_bp: 10_000, prosperity_bp: 10_000, substitute_bp: 10_000 });
    // 20 天里：人口 +2%、繁荣度的需求系数 +20%、替代系数 −5%（目标库存随之变化）；工坊每天取走 30 件原料，第 10 天交付 50 件
    let stock = 3000;
    const track = Array.from({ length: 20 }, (_, i) => {
      const k = (i + 1) / 20;
      const [p, q, s] = [1 + 0.02 * k, 1 + 0.2 * k, 1 - 0.05 * k];
      const delivered = i === 9 ? 50 : 0;
      stock += delivered - 30;
      return day(101 + i, {
        stock_close: stock,
        stock_end: stock,
        target: Math.round(3000 * p * q * s),
        workshop_in: 30,
        workshop_out: 0,
        delivered,
        people_bp: Math.round(10_000 * p),
        prosperity_bp: Math.round(10_000 * q),
        substitute_bp: Math.round(10_000 * s),
      });
    });
    for (let t = 1; t <= 20; t++) {
      const a = attribute({ baseline, baselineExact: true, track, curve: CURVE, popularBonusBp: 5_000 }, t)!;
      expect(a.all.reduce((sum, d) => sum + d.effect, 0)).toBeCloseTo(a.total, 10);
    }
    const a = attribute({ baseline, baselineExact: true, track, curve: CURVE, popularBonusBp: 5_000 }, 20)!;
    const by = Object.fromEntries(a.all.map((d) => [d.key, d]));
    // 需求变大（人口与繁荣）让价格上涨，替代系数变小让价格下跌；目标库存的变化全由这几项解释，“市场规模（发展度）”只剩取整
    expect(by.people.effect).toBeGreaterThan(0.1);
    expect(by.substitute.effect).toBeLessThan(0);
    expect(Math.abs(by.target.effect)).toBeLessThan(0.005);
    // 工坊取走了 600 件（价格上涨），交付送来 50 件（价格下跌）
    expect(by.workshop.units).toBe(-600);
    expect(by.workshop.effect).toBeGreaterThan(0);
    expect(by.delivered.units).toBe(50);
    expect(by.delivered.effect).toBeLessThan(0);
    expect(by.other.units).toBe(0);
  });

  it("本地商人的存货进出（收盘之后，算前一天的）计入库存驱动，恒等式照旧成立（第八批 E5）", () => {
    const baseline = day(100, { hoarded: 20 });
    let stock = 3000 - 20;
    const track = Array.from({ length: 10 }, (_, i) => {
      // 商人每天囤入 20 件（第 6 天起改为抛售 10 件）；收盘库存 = 前一天的日终库存
      const hoarded = i < 5 ? 20 : -10;
      const d = day(101 + i, { stock_close: stock, hoarded });
      stock -= hoarded;
      d.stock_end = stock;
      return d;
    });
    for (let t = 1; t <= 10; t++) {
      const a = attribute({ baseline, baselineExact: true, track, curve: CURVE, popularBonusBp: 5_000 }, t)!;
      expect(a.all.reduce((sum, d) => sum + d.effect, 0)).toBeCloseTo(a.total, 10);
    }
    const a = attribute({ baseline, baselineExact: true, track, curve: CURVE, popularBonusBp: 5_000 }, 10)!;
    const by = Object.fromEntries(a.all.map((d) => [d.key, d]));
    // 起点当天与前九天的存货进出：囤入 6 × 20，抛售 4 × 10 → 市场库存净减 80 件（价格因此上涨），没有剩给“其他”的余量
    expect(by.hoard.units).toBe(-(20 * 6) + 10 * 4);
    expect(by.hoard.effect).toBeGreaterThan(0);
    expect(by.other.units).toBe(0);
  });

  it("旧的追踪记录没有这些字段：需求规模的分量为 0，市场规模照旧解释目标库存的变化", () => {
    const baseline = day(100, {});
    const track = [day(101, { target: 3300 }), day(102, { target: 3600 })];
    const a = attribute({ baseline, baselineExact: true, track, curve: CURVE, popularBonusBp: 5_000 }, 2)!;
    const by = Object.fromEntries(a.all.map((d) => [d.key, d]));
    expect(by.people.effect).toBe(0);
    expect(by.substitute.effect).toBe(0);
    expect(by.target.effect).toBeGreaterThan(0.1);
    expect(a.all.reduce((sum, d) => sum + d.effect, 0)).toBeCloseTo(a.total, 10);
  });
});

describe("统计诊断", () => {
  it("Chow 检验在真实的断点处显著；CUSUM 在持续偏离时越界", () => {
    const ys = [...Array(20).fill(0).map((_, i) => 100 + (i % 3)), ...Array(10).fill(0).map((_, i) => 140 + (i % 3))];
    const c = chowTest(ys, 20)!;
    expect(c.p).toBeLessThan(0.001);
    const path = Array.from({ length: 10 }, () => ({ mean: 100, lo80: 97, hi80: 103, lo95: 96, hi95: 104 }));
    expect(cusumBreak(Array(10).fill(6), path, 10)).toBe(2);
    expect(cusumBreak([1, -1, 1, -1], path, 10)).toBeNull();
  });

  it("把趋势外推到回归型价格上：诊断出错配，事后最好的方法是均值回归一类", () => {
    // 围绕 100 回归的价格，最后几天碰巧上冲；用短窗口的线性趋势外推，而价格回到 100 附近
    const fit = [...arSeries(60, 100, 0.6, 1), 104, 108, 112, 116, 120, 124];
    const series: SeriesInput = { daily: fit, lastClose: 165, monthly: [], monthlyLast: null, floor: 1, cap: 10_000 };
    const s = spec({ method: "linear", window: 8 });
    const r = runForecast(series, s, 15);
    if (!r.ok) throw new Error("预测失败");
    const path = roundPath(r.path);
    const actual = Array.from({ length: 15 }, (_, i) => Math.round(100 + 24 * 0.6 ** (i + 1)));
    const ev = evaluate(fit[fit.length - 1], path, actual);
    expect(ev.verdict).toBe("failed");
    const findings = diagnose({ series, spec: s, path, actual, marks: [], evaluation: ev, clampedDays: 0, baselineExact: true });
    const keys = findings.map((f) => f.key);
    expect(keys).toContain("trend_vs_reversion");
    expect(keys).toContain("hindsight");
    expect(keys).toContain("bias");
    const h = findings.find((f) => f.key === "hindsight")!;
    expect(["ar1", "ses", "naive", "ma", "damped"]).toContain(h.method);
  });

  it("预测期内的跳变与已知断点（事件开始）", () => {
    const fit = arSeries(40, 100, 0.6, 1.5);
    const series: SeriesInput = { daily: fit, lastClose: 139, monthly: [], monthlyLast: null, floor: 1, cap: 10_000 };
    const s = spec({ method: "ar1", window: 40 });
    const r = runForecast(series, s, 12);
    if (!r.ok) throw new Error("预测失败");
    const path = roundPath(r.path);
    const actual = Array.from({ length: 12 }, (_, i) => (i < 4 ? 100 : 150) + (i % 2));
    const ev = evaluate(fit[39], path, actual);
    const findings = diagnose({
      series,
      spec: s,
      path,
      actual,
      marks: [{ day: 144, kind: "event", effect: "demand_shift", mult_bp: 15_000, end: 170 }],
      evaluation: ev,
      clampedDays: 2,
      baselineExact: false,
    });
    const jump = findings.find((f) => f.key === "jump")!;
    expect(jump.day).toBe(144);
    expect(jump.value).toBeGreaterThan(40);
    expect(findings.find((f) => f.key === "chow")?.day).toBe(144);
    expect(findings.map((f) => f.key)).toEqual(expect.arrayContaining(["breach", "clamped", "approx_baseline"]));
  });
});

describe("修订建议与评估", () => {
  const ev = evaluate(100, Array.from({ length: 6 }, () => ({ mean: 100, lo80: 97, hi80: 103, lo95: 95, hi95: 105 })), [110, 112, 111, 113, 112, 114]);

  it("流行还在进行：建议脉冲干预（幅度为流行加成，到流行结束为止）；实际误差大于预测的标准差时建议放宽区间", () => {
    const s = spec({ method: "ses" });
    const list = suggestAdjustments({
      spec: s,
      findings: [{ key: "hindsight", severity: 1, method: "ar1", value: 30 }],
      marks: [{ day: 101, kind: "popular", end: 131 }],
      evaluation: ev,
      today: 107,
      popularBonusBp: 5_000,
      popularUntil: 131,
      seasonalAvailable: true,
      seasonChanged: true,
      meanSd: 2.5,
    });
    const kinds = list.map((x) => x.kind);
    expect(kinds).toEqual(["refit", "switch", "intervention", "seasonal", "calibrate"]);
    const iv = list.find((x) => x.kind === "intervention")!;
    expect(iv.spec.intervention).toEqual({ day: 101, kind: "pulse", size: 0.5, end: 131 });
    expect(iv.reason).toBe("event");
    expect(list.find((x) => x.kind === "switch")!.spec.method).toBe("ar1");
    expect(list.find((x) => x.kind === "calibrate")!.spec.sigmaScale).toBeGreaterThan(1);
  });

  it("预测期内的需求事件：建议剔除事件期间的数据", () => {
    const list = suggestAdjustments({
      spec: spec({}),
      findings: [],
      marks: [{ day: 103, kind: "event", effect: "supply_shift", mult_bp: 7_000, end: 106 }],
      evaluation: ev,
      today: 107,
      popularBonusBp: 5_000,
      popularUntil: null,
      seasonalAvailable: false,
      seasonChanged: false,
      meanSd: 50,
    });
    expect(list.map((x) => x.kind)).toEqual(["refit", "exclude"]);
    expect(list[1].spec.excluded).toEqual([103, 104, 105]);
  });

  it("修订版在共同观测日上的误差比原预测小：给出改进的百分比", () => {
    const entry = (id: number, origin: number, means: number[], prices: number[]): ForecastEntryView => ({
      id,
      loc: 0,
      good: 0,
      created: origin + 1,
      origin,
      horizon: means.length,
      spec: specToView(spec({})),
      fitted_on: [1, 2],
      path: means.map((m) => ({ mean: m, lo80: m, hi80: m, lo95: m, hi95: m })),
      baseline: day(origin, {}),
      baseline_exact: true,
      track: prices.map((p, i) => ({ ...day(origin + i + 1, {}), price: p })),
      marks: [],
    });
    const orig = entry(1, 100, [100, 100, 100, 100], [110, 120, 120, 118]);
    const rev = entry(2, 102, [119, 119], [120, 118]);
    const rep = compareRevision(orig, rev)!;
    expect(rep.days).toBe(2);
    expect(rep.improvement).toBeGreaterThan(90);
  });
});

describe("规格换算与复盘", () => {
  it("前端规格与后端的整数规格互相换算不丢信息", () => {
    const s = spec({ method: "damped", params: { alpha: 0.3, beta: 0.1, phi: 0.9 }, window: 45, log: true, excluded: [5, 3], interval: "empirical", sigmaScale: 1.5, intervention: { day: 9, kind: "pulse", size: -0.25, end: 20 } });
    const v = specToView(s);
    expect(v.params).toEqual({ alpha: 3000, beta: 1000, phi: 9000, sigma_scale: 15000 });
    expect(v.excluded).toEqual([3, 5]);
    expect(v.intervention).toEqual({ day: 9, kind: "pulse", size_bp: -2500, end: 20 });
    expect(specFromView(v)).toEqual({ ...s, excluded: [3, 5] });
    expect(specFromView({ ...v, method: "crystal_ball" }).method).toBe("naive");
  });

  it("复盘：成绩单、诊断、驱动与建议都给出", () => {
    const baseline = day(59, {});
    const track = simulate(
      [{ popular: true, demand_bp: 15_000 }, { popular: true, demand_bp: 15_000 }, { popular: true, demand_bp: 15_000, player_bought: 200 }],
      baseline,
    );
    const daily = [...Array(57).fill(100), 100, 100, 100];
    const s = spec({ method: "naive", window: 30 });
    const r = runForecast({ daily, lastClose: 59, monthly: [], monthlyLast: null, floor: 20, cap: 500 }, s, 5);
    if (!r.ok) throw new Error("预测失败");
    const entry: ForecastEntryView = {
      id: 1,
      loc: 0,
      good: 0,
      created: 60,
      origin: 59,
      horizon: 5,
      spec: specToView(s),
      fitted_on: daily.slice(30),
      path: roundPath(r.path),
      baseline,
      baseline_exact: true,
      track,
      marks: [{ day: 60, kind: "popular", end: 90 }],
    };
    const series: SeriesView = {
      loc: 0,
      good: 0,
      today: 63,
      last_close: 62,
      daily: [...daily, ...track.map((t) => t.price)],
      monthly: [100],
      monthly_last: 59,
      base_price: 100,
      floor: 20,
      cap: 500,
      price: track[2].price,
      stock: track[2].stock_end,
      target: 3000,
      popular_until: 90,
      events: [],
      curve: CURVE,
      popular_bonus_bp: 5_000,
      methods: ["naive", "ma", "drift", "seasonal", "fair", "astrology"],
    };
    const rv = reviewEntry(entry, series);
    expect(rv.evaluation.n).toBe(3);
    expect(rv.evaluation.verdict).toBe("failed");
    expect(rv.attribution?.drivers[0].key).toBe("popular");
    expect(rv.suggestions.some((x) => x.kind === "intervention" && x.spec.intervention?.kind === "pulse")).toBe(true);
    expect(rv.lastErrorPct).toBeGreaterThan(40);
    expect(seasonOf(89)).toBe(0);
    expect(seasonOf(90)).toBe(1);
  });
});
