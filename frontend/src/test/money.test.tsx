// 第八批 E8（docs/ECONOMY.md 6.9）：交易所里的城镇钱袋与国库、报表里的经济月报、财政日志的文字，
// 以及行情窗口的驱动分解与复盘里的“当地钱袋”。模拟的 Tauri IPC，不调用任何真实服务。
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import Market from "../components/panels/Market";
import ReportsPanel from "../components/panels/ReportsPanel";
import { attribute } from "../forecast/attribution";
import { roundPath, runForecast } from "../forecast/engine";
import { findingText } from "../forecast/labels";
import { reviewEntry } from "../forecast/review";
import { specToView } from "../forecast/spec";
import { tk } from "../i18n";
import { setLocale } from "../i18n/locale";
import type { EconomyReportView, ForecastEntryView, PortView, TrackDayView } from "../ipc/types";
import { START_SPEC } from "../store/forecast";
import { installIpc, port, reports, seriesFor, startedGame } from "./fixtures";

function day(d: number, price: number, over: Partial<TrackDayView> = {}): TrackDayView {
  return {
    day: d,
    price,
    stock_close: 300,
    stock_end: 300,
    target: 300,
    produced: 10,
    consumed: 10,
    player_bought: 0,
    player_sold: 0,
    npc_bought: 0,
    npc_sold: 0,
    other_bought: 0,
    other_sold: 0,
    demand_bp: 10000,
    season_bp: 10000,
    event_bp: 10000,
    popular: false,
    supply_bp: 10000,
    event_supply_bp: 10000,
    clamped: 0,
    ...over,
  };
}

const withPurse: PortView = {
  ...port,
  purse: {
    money: 61_000,
    reference: 150_000,
    liquidity_bp: 8_342,
    gaps: 4_200,
    treasury: { faction: "埃斯佩兰王国", money: -12_000, tax_mult_bp: 10_500, patrol_bp: 4_500 },
  },
};

function econ(month: number, supply: number): EconomyReportView {
  return {
    month,
    day: month * 30 + 29,
    sectors: [
      { kind: "traders", opening: 400_000, inflow: 90_000, outflow: 60_000, closing: 430_000 },
      { kind: "towns", opening: 12_000_000, inflow: 6_100_000, outflow: 6_130_000, closing: 11_970_000 },
      { kind: "treasuries", opening: 300_000, inflow: 40_000, outflow: 35_000, closing: 305_000 },
      { kind: "bank", opening: 2_000_000, inflow: 0, outflow: 0, closing: 2_000_000 },
      { kind: "hinterland", opening: 0, inflow: 6_000_000, outflow: 6_005_000, closing: -5_000 },
    ],
    flows: [
      { flow: "HinterlandIncome", from: "hinterland", to: "towns", amount: 6_000_000 },
      { flow: "Leak", from: "towns", to: "hinterland", amount: 5_990_000 },
      { flow: "Market", from: "towns", to: "traders", amount: 80_000 },
      { flow: "Tax", from: "towns", to: "treasuries", amount: 40_000 },
    ],
    money_supply: supply,
    player: 21_000,
    companies: 380_000,
    exchange: 29_000,
    price_index_bp: 14_217,
    production: 123_456,
    population: 1_200_000,
    shortfall: 4_200,
    tightest: ["布鲁玛角", 8_342],
    flush: ["卡迪拉", 11_347],
    treasuries: [{ faction: "埃斯佩兰王国", money: -12_000, tax_mult_bp: 10_500, patrol_bp: 4_500, income: 40_000, spent: 35_000 }],
  };
}

describe("货币流通", () => {
  beforeEach(() => {
    setLocale("zh-CN");
    installIpc();
    startedGame();
  });

  it("交易所：本港钱袋比往常少时写明报价打了折、腹地垫付过多少，并列出所属势力的国库", () => {
    render(<Market port={withPurse} />);
    const box = screen.getByTestId("market-purse");
    expect(box).toHaveClass("mk-purse-tight");
    expect(box).toHaveTextContent("本港钱袋 61,000 金币（往常 150,000 金币）");
    expect(box).toHaveTextContent("报价 ×0.83");
    expect(box).toHaveTextContent("钱袋吃紧");
    expect(box).toHaveTextContent("腹地替它垫付过 4,200 金币");
    expect(screen.getByTestId("market-treasury")).toHaveTextContent("埃斯佩兰王国国库 -12,000 金币 · 税 ×1.05 · 海军巡逻 45%");
  });

  it("交易所：没有钱袋（货币流通关闭、远方港口或旧后端）时不显示", () => {
    render(<Market port={port} />);
    expect(screen.queryByTestId("market-purse")).toBeNull();
  });

  it("报表：经济月报列出各部门的月初、流入、流出与月末，资金流、统计与各势力国库；可以换月份", async () => {
    const user = userEvent.setup();
    installIpc({ reports: () => ({ ...reports, economy: [econ(0, 14_700_000), econ(1, 14_650_000)] }) });
    render(<ReportsPanel />);
    const sec = await screen.findByTestId("economy-report");
    const rows = within(screen.getByTestId("economy-sectors")).getAllByRole("row");
    expect(rows).toHaveLength(6);
    expect(rows[1]).toHaveTextContent("商人（玩家、商会与交易所）400,000 金币90,000 金币60,000 金币430,000 金币");
    expect(rows[5]).toHaveTextContent("腹地");
    const flows = screen.getByTestId("economy-flows");
    expect(flows).toHaveTextContent("腹地收入腹地 → 城镇钱袋6,000,000 金币");
    expect(flows).toHaveTextContent("交易税、关税与通行税城镇钱袋 → 势力国库40,000 金币");
    const stats = screen.getByTestId("economy-stats");
    expect(stats).toHaveTextContent("货币总量（腹地以外）14,650,000 金币");
    expect(stats).toHaveTextContent("物价指数（报价 / 基准价）1.42");
    expect(stats).toHaveTextContent("钱袋最紧布鲁玛角（报价 ×0.83）");
    expect(screen.getByTestId("economy-treasuries")).toHaveTextContent("埃斯佩兰王国-12,000 金币×1.0545%40,000 金币35,000 金币");
    expect(within(sec).getByTestId("money-supply-trend")).toBeInTheDocument();
    // 换到第一个月
    await user.selectOptions(within(sec).getByRole("combobox", { name: "选择月份" }), "0");
    expect(screen.getByTestId("economy-stats")).toHaveTextContent("14,700,000 金币");
  });

  it("报表：旧后端或货币流通关闭时没有经济月报", async () => {
    render(<ReportsPanel />);
    await screen.findByTestId("income-statement");
    expect(screen.queryByTestId("economy-report")).toBeNull();
  });

  it("情报日志：国库亏空加税、富余减税，写明新的税率与国库余额", () => {
    expect(tk("log.FiscalTax", { faction: "埃斯佩兰王国", raised: "true", mult: "10500", treasury: "-12000" })).toBe(
      "埃斯佩兰王国国库亏空，加税：交易税调为往常的 105%（国库 -12,000 金币）",
    );
    expect(tk("log.FiscalTax", { faction: "埃斯佩兰王国", raised: "false", mult: "9500", treasury: "3000000" })).toBe(
      "埃斯佩兰王国国库富余，减税：交易税调为往常的 95%（国库 3,000,000 金币）",
    );
    setLocale("en");
    expect(tk("log.FiscalTax", { faction: "Kingdom of Esperan", raised: "true", mult: "10500", treasury: "-12000" })).toBe(
      "The Kingdom of Esperan raises taxes because its treasury is in deficit: trade tax is now 105% of normal (treasury -12,000 gold)",
    );
  });

  it("驱动分解：流动性系数的变化单独算作“当地钱袋”，各项之和仍等于价格的对数变化", () => {
    const baseline = day(10, 100);
    const track = [day(11, 95, { liquidity_bp: 9_500 }), day(12, 90, { liquidity_bp: 9_000 })];
    const a = attribute({ baseline, baselineExact: true, track, curve: [[0, 20000], [20000, 5000]], popularBonusBp: 3000 }, 2);
    if (!a) throw new Error("没有分解");
    const liq = a.all.find((d) => d.key === "liquidity");
    expect(liq?.effect).toBeCloseTo(Math.log(0.9), 6);
    expect(a.drivers[0].key).toBe("liquidity");
    const sum = a.all.reduce((s, d) => s + d.effect, 0);
    expect(sum).toBeCloseTo(a.total, 9);
  });

  it("复盘：预测期内当地钱袋变紧，诊断指出报价从往常的 100% 变到 88%", () => {
    const s = seriesFor(0, 0);
    const spec = { ...START_SPEC, method: "naive" as const, window: 30 };
    const r = runForecast({ daily: s.daily.slice(0, 50), lastClose: 49, monthly: [], monthlyLast: null, floor: s.floor, cap: s.cap }, spec, 10);
    if (!r.ok) throw new Error("预测失败");
    const fitted = s.daily.slice(20, 50);
    const last = fitted[fitted.length - 1];
    const entry: ForecastEntryView = {
      id: 3,
      loc: 0,
      good: 0,
      created: 50,
      origin: 49,
      horizon: 10,
      spec: specToView(spec),
      fitted_on: fitted,
      path: roundPath(r.path),
      revises: null,
      basis: null,
      baseline: day(49, last),
      baseline_exact: true,
      track: Array.from({ length: 5 }, (_, i) => day(50 + i, Math.round(last * (1 - 0.03 * (i + 1))), { liquidity_bp: 10_000 - 240 * (i + 1) })),
      marks: [],
    };
    const review = reviewEntry(entry, null);
    const f = review.findings.find((x) => x.key === "liquidity");
    expect(f).toBeDefined();
    expect(findingText(f!)).toBe("预测期内当地钱袋变紧：报价从往常的 100% 变到 88%，各种货的价格一起走低");
  });

  it("英文界面：钱袋与国库的说明是英文", () => {
    setLocale("en");
    render(<Market port={withPurse} />);
    const box = screen.getByTestId("market-purse");
    expect(box).toHaveTextContent("Town purse 61,000 gold (usually 150,000 gold)");
    expect(box).toHaveTextContent("prices ×0.83");
    expect(box).toHaveTextContent("short of coin");
    expect(screen.getByTestId("market-treasury")).toHaveTextContent("Treasury of the 埃斯佩兰王国");
  });
});
