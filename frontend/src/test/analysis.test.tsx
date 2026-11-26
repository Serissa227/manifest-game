// 行情窗口（docs/ECONOMY.md 第 4 节）：推算、记下预测、奇才之法的解锁、对照旧账试算、预测簿与复盘、修订版；交易所的预测开关。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import PortPanel from "../components/panels/PortPanel";
import AnalysisPanel from "../components/panels/AnalysisPanel";
import MatesPanel from "../components/panels/MatesPanel";
import { roundPath, runForecast } from "../forecast/engine";
import { specToView } from "../forecast/spec";
import type { BookView, ForecastEntryView, PinRequest, SeriesView, TrackDayView } from "../ipc/types";
import { START_SPEC, useForecast } from "../store/forecast";
import { useGame } from "../store/game";
import { COMMON, emptyBook, installIpc, mate, seriesFor, startedGame } from "./fixtures";

function resetForecast() {
  useForecast.setState({ loc: null, good: null, spec: START_SPEC, horizon: 15, mode: "daily", monthlyHorizon: 6, view: "work", reviewId: null, draft: null });
}

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

/** 一条记下的“照旧”预测：起点第 49 天、看 10 天；之后本地流行，价格涨了五成。 */
function failedEntry(): ForecastEntryView {
  const s = seriesFor(0, 0);
  const fitted = s.daily.slice(20, 50);
  const r = runForecast({ daily: s.daily.slice(0, 50), lastClose: 49, monthly: [], monthlyLast: null, floor: s.floor, cap: s.cap }, { ...START_SPEC, method: "naive", window: 30 }, 10);
  if (!r.ok) throw new Error("预测失败");
  const last = fitted[fitted.length - 1];
  const track = Array.from({ length: 10 }, (_, i) =>
    day(50 + i, i < 2 ? last : Math.round(last * 1.5), i < 2 ? {} : { popular: true, demand_bp: 15000 }),
  );
  return {
    id: 7,
    loc: 0,
    good: 0,
    created: 50,
    origin: 49,
    horizon: 10,
    spec: specToView({ ...START_SPEC, method: "naive", window: 30 }),
    fitted_on: fitted,
    path: roundPath(r.path),
    revises: null,
    basis: null,
    baseline: day(49, last),
    baseline_exact: true,
    track,
    marks: [{ day: 52, kind: "popular", end: 82 }],
  };
}

describe("行情窗口", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc();
    startedGame();
    resetForecast();
  });

  it("命令栏有“行情”；打开后按旗舰所在港口给出行情，只会老法子时奇才之法灰掉", async () => {
    const user = userEvent.setup();
    render(<App />);
    const bar = await screen.findByRole("tablist", { name: "功能面板" });
    await user.click(within(bar).getByRole("tab", { name: "行情" }));
    expect(await screen.findByTestId("analysis-panel")).toBeInTheDocument();
    expect(screen.getByTestId("game-window")).toHaveClass("gw-center", "gw-large");
    await waitFor(() => expect(calls).toHaveBeenCalledWith("market_series", { loc: 0, good: 0 }));
    expect(screen.getByTestId("fc-geniuses")).toHaveTextContent("你麾下还没有算学奇才");
    const common = await screen.findByRole("group", { name: "行商的老法子" });
    expect(within(common).getByRole("radio", { name: /照旧/ })).toBeEnabled();
    expect(within(common).getByRole("radio", { name: /公道价/ })).toBeChecked();
    const genius = screen.getByRole("group", { name: "算学奇才的法子" });
    for (const r of within(genius).getAllByRole("radio")) expect(r).toBeDisabled();
    expect(within(genius).getByText("递减权重均价（简单指数平滑）")).toBeInTheDocument();
    // 没有奇才：没有“按以往的误差”的区间，也不能对照旧账试算
    expect(screen.queryByLabelText("区间")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "对照旧账试算" }));
    expect(screen.getByText("对照旧账试算、误差检验与干预修正需要一位算学奇才。")).toBeInTheDocument();
  });

  it("选“旬均价”、改期限后记下预测：请求里是这个法子、最近的收盘日、整数的路径与区间", async () => {
    const user = userEvent.setup();
    let book: BookView = emptyBook;
    calls = installIpc({
      forecast_book: () => book,
      pin_forecast: (args) => {
        const req = args.request as PinRequest;
        book = { ...book, active: 1, entries: [{ ...failedEntry(), id: 1, spec: req.spec, horizon: req.horizon, path: req.path, track: [] }] };
        return book;
      },
    });
    render(<AnalysisPanel />);
    const summary = await screen.findByTestId("fc-summary");
    expect(summary).toHaveTextContent("15 天后约");
    await user.click(screen.getByRole("radio", { name: /旬均价/ }));
    await user.selectOptions(screen.getByLabelText("往后看几天"), "30");
    expect(screen.getByTestId("fc-summary")).toHaveTextContent("30 天后约");
    await user.click(screen.getByRole("button", { name: "记下这个预测" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("pin_forecast", expect.anything()));
    const req = calls.mock.calls.find(([c]) => c === "pin_forecast")?.[1].request as PinRequest;
    expect(req.loc).toBe(0);
    expect(req.good).toBe(0);
    expect(req.origin).toBe(59);
    expect(req.horizon).toBe(30);
    expect(req.spec.method).toBe("ma");
    expect(req.spec.params.k).toBeGreaterThan(0);
    expect(req.path).toHaveLength(30);
    for (const p of req.path) {
      expect(Number.isInteger(p.mean)).toBe(true);
      expect(p.lo95 <= p.lo80 && p.lo80 <= p.mean && p.mean <= p.hi80 && p.hi80 <= p.hi95).toBe(true);
    }
    expect(req.fitted_on).toHaveLength(60);
    expect(req.revises).toBeNull();
    expect(await screen.findByText("正在追踪 1/12 条")).toBeInTheDocument();
  });

  it("麾下有算学奇才：他会的方法可用，能对照旧账试算并一键换用最准的", async () => {
    const user = userEvent.setup();
    const methods = [...COMMON, "linear", "ar1"];
    installIpc({
      market_series: (a) => seriesFor(a.loc as number, a.good as number, { methods }),
      forecast_book: () => ({ ...emptyBook, methods, geniuses: [{ mate: 5, name: "卡里姆·阿尔纳吉米", methods: ["linear", "ar1"] }] }),
    });
    render(<AnalysisPanel />);
    expect(await screen.findByTestId("fc-geniuses")).toHaveTextContent("卡里姆·阿尔纳吉米（最小二乘直线、回归术）");
    const genius = await screen.findByRole("group", { name: "算学奇才的法子" });
    expect(within(genius).getByRole("radio", { name: /回归术/ })).toBeEnabled();
    expect(within(genius).getByRole("radio", { name: /最小二乘直线/ })).toBeEnabled();
    expect(within(genius).getByRole("radio", { name: /递减权重均价/ })).toBeDisabled();
    expect(screen.getByLabelText("区间")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "对照旧账试算" }));
    const table = await screen.findByTestId("fc-backtest");
    expect(within(table).getByText("最准")).toBeInTheDocument();
    expect(within(table).queryByText("递减权重均价")).toBeNull();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(8);
    await user.click(within(rows[0]).getByRole("button", { name: "用这个" }));
    expect(useForecast.getState().view).toBe("work");
    expect(screen.getByTestId("fc-work")).toBeInTheDocument();
  });

  it("预测簿与复盘：失败的预测给出原因、市场上发生的事与调整建议；按建议记下修订版要写明依据", async () => {
    const user = userEvent.setup();
    const entry = failedEntry();
    calls = installIpc({
      forecast_book: () => ({ ...emptyBook, active: 0, entries: [entry] }),
      market_series: (a) => seriesFor(a.loc as number, a.good as number, { popular_until: 82 }),
    });
    render(<AnalysisPanel />);
    await user.click(await screen.findByRole("tab", { name: "预测簿" }));
    const item = await screen.findByTestId("fc-entry-7");
    expect(item).toHaveTextContent("#7 澄港 · 谷物 · 照旧");
    expect(item).toHaveTextContent("失败");
    await user.click(within(item).getByRole("button", { name: "复盘" }));
    const rv = await screen.findByTestId("fc-review");
    expect(within(rv).getByTestId("fc-score")).toHaveTextContent("跟踪信号");
    expect(within(rv).getByTestId("fc-causes")).toHaveTextContent("价格跑出了九成五的范围");
    expect(within(rv).getByTestId("fc-drivers")).toHaveTextContent("流行：约 +50%");
    expect(within(rv).getByTestId("fc-causes")).toHaveTextContent("第 52 天：开始流行");
    const adjust = within(rv).getByTestId("fc-adjust");
    expect(adjust).toHaveTextContent("用到今天为止的价重新推算");
    // 没有奇才时不给干预修正
    expect(adjust).not.toHaveTextContent("干预");
    const tryButtons = within(adjust).getAllByRole("button", { name: "试试" });
    await user.click(tryButtons[0]);
    const draft = await screen.findByTestId("fc-draft");
    expect(draft).toHaveTextContent("修订第 7 条：重新推算");
    await user.selectOptions(within(draft).getByLabelText("依据"), "event");
    await user.type(within(draft).getByLabelText("备注（可不填）"), "流行还要一个月");
    await user.click(screen.getByRole("button", { name: "记下修订版" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("pin_forecast", expect.anything()));
    const req = calls.mock.calls.find(([c]) => c === "pin_forecast")?.[1].request as PinRequest;
    expect(req.revises).toBe(7);
    expect(req.basis).toEqual({ kind: "refit", reason: "event", note: "流行还要一个月" });
    expect(useForecast.getState().draft).toBeNull();
  });

  it("删除预测簿里的一条", async () => {
    const user = userEvent.setup();
    calls = installIpc({ forecast_book: () => ({ ...emptyBook, entries: [failedEntry()] }) });
    render(<AnalysisPanel />);
    await user.click(await screen.findByRole("tab", { name: "预测簿" }));
    await user.click(within(await screen.findByTestId("fc-entry-7")).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("remove_forecast", { id: 7 }));
  });

  it("后端拒绝（例如追踪已满）时显示错误", async () => {
    const user = userEvent.setup();
    installIpc({
      pin_forecast: () => {
        throw "同时追踪的预测已达上限 12 条";
      },
    });
    render(<AnalysisPanel />);
    await user.click(await screen.findByRole("button", { name: "记下这个预测" }));
    await waitFor(() => expect(useGame.getState().error).toContain("已达上限"));
  });
});

describe("交易所的预测开关", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc();
    startedGame();
    resetForecast();
  });

  it("打开“预测”换成带预测线与区间的图；“详细分析”打开行情窗口并选好这个市场", async () => {
    const user = userEvent.setup();
    render(<PortPanel />);
    await user.click(await screen.findByTestId("market-row-1"));
    await user.click(screen.getByRole("checkbox", { name: "预测" }));
    expect(await screen.findByTestId("mk-forecast")).toBeInTheDocument();
    await waitFor(() => expect(calls).toHaveBeenCalledWith("market_series", { loc: 0, good: 1 }));
    expect(screen.getByTestId("mk-forecast-line")).toHaveTextContent("公道价 · 15 天后约");
    await user.click(screen.getByRole("button", { name: "详细分析" }));
    expect(useGame.getState().tab).toBe("analysis");
    expect(useForecast.getState()).toMatchObject({ loc: 0, good: 1, view: "work" });
  });

  it("航海士卡片标出算学奇才掌握的方法；普通航海士没有这一行", async () => {
    installIpc({
      mates: () => ({
        hired: [{ ...mate, id: 0, name: "卡里姆", hired: true, methods: ["linear", "ar1"], role: { kind: "accountant" as const, target: null } }],
        available: [{ ...mate, methods: [] }],
      }),
    });
    render(<MatesPanel />);
    expect(await screen.findByText("算学奇才：最小二乘直线、回归术")).toBeInTheDocument();
    expect(screen.getAllByText(/算学奇才：/)).toHaveLength(1);
  });
});

describe("行情窗口：月线模式与本地生产者（第八批 E3）", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    resetForecast();
  });

  /** 30 个月的月线：带季节起伏与一点上涨。 */
  const months = Array.from({ length: 30 }, (_, t) => Math.round(12 + 2 * Math.sin((2 * Math.PI * t) / 12) + 0.05 * t));

  it("月线满两年可以切到月线：只供参考、不记进预测簿；四季平滑只用于月线，公道价只用于日线", async () => {
    const user = userEvent.setup();
    const methods = [...COMMON, "ar2", "hw"];
    installIpc({
      market_series: (a) => seriesFor(a.loc as number, a.good as number, { methods, monthly: months, monthly_last: 59 }),
      forecast_book: () => ({ ...emptyBook, methods }),
    });
    render(<AnalysisPanel />);
    const mode = await screen.findByRole("group", { name: "看哪条线" });
    const genius = screen.getByRole("group", { name: "算学奇才的法子" });
    // 日线：四季平滑写着“只用于月线”，周期推算可用
    const hw = within(genius).getByRole("radio", { name: /四季平滑/ });
    expect(hw).toBeDisabled();
    expect(hw.closest("label")).toHaveTextContent("只用于月线");
    expect(within(genius).getByRole("radio", { name: /周期推算/ })).toBeEnabled();

    await user.click(within(mode).getByRole("radio", { name: "月线" }));
    expect(await screen.findByTestId("fc-monthly-summary")).toHaveTextContent("6 个月后的月均价约");
    expect(screen.getByTestId("fc-monthly-note")).toHaveTextContent("只供参考");
    expect(screen.queryByRole("button", { name: "记下这个预测" })).toBeNull();
    const fair = within(screen.getByRole("group", { name: "行商的老法子" })).getByRole("radio", { name: /公道价/ });
    expect(fair).toBeDisabled();
    expect(fair.closest("label")).toHaveTextContent("只用于日线");
    await user.click(within(genius).getByRole("radio", { name: /四季平滑/ }));
    expect(screen.getByTestId("fc-monthly-summary")).toHaveTextContent("一年里各月的起伏约");
    await user.selectOptions(screen.getByLabelText("往后看几个月"), "12");
    expect(screen.getByTestId("fc-monthly-summary")).toHaveTextContent("12 个月后的月均价约");
    await user.click(within(genius).getByRole("radio", { name: /周期推算/ }));
    expect(screen.getByTestId("fc-monthly-summary")).toHaveTextContent("12 个月后的月均价约");

    // 切回日线：又能记下预测
    await user.click(within(mode).getByRole("radio", { name: "日线" }));
    expect(screen.getByRole("button", { name: "记下这个预测" })).toBeInTheDocument();
  });

  it("月线不满两年时不能切过去，并说明还差多少", async () => {
    render(<AnalysisPanel />);
    const mode = await screen.findByRole("group", { name: "看哪条线" });
    expect(within(mode).getByRole("radio", { name: "月线" })).toBeDisabled();
    expect(mode).toHaveTextContent("月线满 24 个月才能用（现在 2 个月）");
  });

  it("图下写着本地生产者的状况：产能与预期、作物的计划、头一年观望、这里不产", async () => {
    const producer = { capacity_bp: 11800, planned_bp: null, expect_bp: 10800, normal_bp: 120000, learning: false, crop: false };
    const cases: [Partial<SeriesView>, string][] = [
      [{ produces: true, producer }, "本地产能为开局的 118%；生产者眼中的价格比这个月的正常价高 8.0%，月末还要扩产。"],
      [
        { produces: true, producer: { ...producer, capacity_bp: 9000, expect_bp: 9500, planned_bp: 8800, crop: true } },
        "本地产能为开局的 90%；生产者眼中的价格比这个月的正常价低 5.0%，月末还要减产。（作物：下一季的计划产能为开局的 88%）",
      ],
      [{ produces: true, producer: { ...producer, expect_bp: 10050 } }, "产能大体不动"],
      [{ produces: true, producer: { ...producer, learning: true, normal_bp: null } }, "本地生产者还在观望：头一年只记下各月的行情，不调整产能。"],
      [{ produces: false, producer: null }, "这里不产这种货，全靠外来。"],
    ];
    for (const [over, text] of cases) {
      installIpc({ market_series: (a) => seriesFor(a.loc as number, a.good as number, over) });
      const { unmount } = render(<AnalysisPanel />);
      expect(await screen.findByTestId("fc-producer")).toHaveTextContent(text);
      unmount();
    }
    // 旧后端（没有这两个字段）：不显示
    installIpc();
    render(<AnalysisPanel />);
    await screen.findByTestId("fc-work");
    expect(screen.queryByTestId("fc-producer")).toBeNull();
  });

  it("图下写着本地商人（第八批 E5）：四派的占比与预测、主流预期、存货、传闻", async () => {
    // 今天 100.00；四派各自对明天的预测；强趋势派占上风
    const merchants = {
      shares_bp: [1000, 2000, 6000, 1000] as [number, number, number, number],
      forecast_bp: [1_000_000, 1_020_000, 1_060_000, 970_000] as [number, number, number, number],
      expect_bp: 1_043_000,
      price_bp: 1_000_000,
      hoard: 140,
      hoard_base: 100,
      rumor_bp: 1200,
    };
    installIpc({ market_series: (a) => seriesFor(a.loc as number, a.good as number, { merchants }) });
    const { unmount } = render(<AnalysisPanel />);
    const note = await screen.findByTestId("fc-merchants");
    const rows = within(note).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual(["适应派10%+0.0%", "弱趋势派20%+2.0%", "强趋势派60%+6.0%", "锚定派10%−3.0%"]);
    expect(rows[2]).toHaveAttribute("title", "明天还会顺着今天的涨跌走得更多");
    expect(note).toHaveTextContent("商人们预计明天涨 4.3%。");
    expect(note).toHaveTextContent("他们在囤货（存货 140 件，平常 100 件）。");
    expect(note).toHaveTextContent("传闻让他们多看涨 12.0%，会慢慢淡去。");
    unmount();
    // 抛售、没有传闻
    installIpc({
      market_series: (a) =>
        seriesFor(a.loc as number, a.good as number, { merchants: { ...merchants, expect_bp: 980_000, hoard: 60, rumor_bp: 0 } }),
    });
    const second = render(<AnalysisPanel />);
    const note2 = await screen.findByTestId("fc-merchants");
    expect(note2).toHaveTextContent("商人们预计明天跌 2.0%。他们在抛售（存货 60 件，平常 100 件）。");
    expect(note2).not.toHaveTextContent("传闻");
    second.unmount();
    // 旧后端（没有这个字段）：不显示
    installIpc();
    render(<AnalysisPanel />);
    await screen.findByTestId("fc-work");
    expect(screen.queryByTestId("fc-merchants")).toBeNull();
  });

  it("复盘指出预测期内本地产能的变化", async () => {
    const user = userEvent.setup();
    const entry = failedEntry();
    const withCapacity: ForecastEntryView = {
      ...entry,
      baseline: { ...entry.baseline, capacity_bp: 10000 },
      track: entry.track.map((d, i) => ({ ...d, capacity_bp: 10000 + 150 * i })),
    };
    installIpc({ forecast_book: () => ({ ...emptyBook, entries: [withCapacity] }) });
    render(<AnalysisPanel />);
    await user.click(await screen.findByRole("tab", { name: "预测簿" }));
    await user.click(within(await screen.findByTestId("fc-entry-7")).getByRole("button", { name: "复盘" }));
    expect(await screen.findByTestId("fc-causes")).toHaveTextContent("预测期内本地产能从开局的 100% 变到 114%：生产者在扩产，供给跟着变了");
  });
});
