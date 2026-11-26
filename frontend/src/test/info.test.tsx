// 信息时效（docs/ECONOMY.md 第 7 节，第八批 E6）：交易所里远方行情的时效与来源、库存档位与行情通报；
// 行情窗口对过时行情的衔接（期限 = 过时的天数 + 航程，终点是抵达那天）；复盘里“预测所用的行情已经过时”与等消息。
// 模拟的 Tauri IPC，不调用任何真实服务。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import AnalysisPanel from "../components/panels/AnalysisPanel";
import Market from "../components/panels/Market";
import { seenLabel, stockBand } from "../components/panels/marketInfo";
import { roundPath, runForecast } from "../forecast/engine";
import { specToView } from "../forecast/spec";
import { money, tk } from "../i18n";
import { setLocale } from "../i18n/locale";
import type { BookView, ForecastEntryView, PinRequest, PortView, SeriesView, TrackDayView } from "../ipc/types";
import { START_SPEC, useForecast } from "../store/forecast";
import { emptyBook, installIpc, port, seriesFor, startedGame } from "./fixtures";

function resetForecast() {
  useForecast.setState({ loc: null, good: null, spec: START_SPEC, horizon: 15, mode: "daily", monthlyHorizon: 6, view: "work", reviewId: null, draft: null });
}

function day(d: number, price: number): TrackDayView {
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
  };
}

/** 柳湾（1 号）的谷物：手上的行情是 10 天前的行情通报，日线只到第 49 天；旗舰队过去要 7 天。 */
function staleSeries(): SeriesView {
  const s = seriesFor(0, 0);
  return {
    ...s,
    last_close: 49,
    daily: s.daily.slice(0, 50),
    monthly_last: 29,
    price: s.daily[49],
    seen: { day: 50, age: 10, source: "report" },
    voyage_days: 7,
  };
}

describe("信息时效", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    setLocale("zh-CN");
    calls = installIpc();
    startedGame();
    resetForecast();
  });

  it("库存档位按库存 / 目标库存分五档；时效写明几天前与来源", () => {
    expect([0, 49, 50, 84, 85, 115, 116, 160, 161, 500].map((s) => stockBand(s, 100))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(stockBand(10, 0)).toBe(4);
    expect(seenLabel({ day: 55, age: 5, source: "ship" })).toBe("5 天前 · 随船消息");
    expect(seenLabel({ day: 40, age: 20, source: "report" })).toBe("20 天前 · 行情通报");
    expect(seenLabel({ day: 60, age: 0, source: "visit" })).toBe("今天 · 自己到过");
  });

  it("交易所：远方港口的行情写明几天前、从哪里来，库存只给档位；在港时照常显示数字", () => {
    const remote: PortView = { ...port, loc: 1, fleets_here: [], caravans_here: [], seen: { day: 55, age: 5, source: "ship" }, report: null };
    const { unmount } = render(<Market port={remote} />);
    const note = screen.getByTestId("market-seen");
    expect(note).toHaveTextContent("5 天前 · 随船消息");
    expect(note).toHaveTextContent("价格与库存是那时的，现在可能已经变了；不在这里，问不到现价。");
    for (const r of remote.market) {
      const row = screen.getByTestId(`market-row-${r.good}`);
      expect(row).toHaveTextContent(tk(`info.band.${stockBand(r.stock, r.target)}`));
      expect(within(row).queryByText(String(r.stock))).toBeNull();
    }
    expect(screen.queryByTestId("market-report")).toBeNull();
    unmount();
    // 在港（没有 seen）：没有时效横幅，库存是数字
    render(<Market port={port} />);
    expect(screen.queryByTestId("market-seen")).toBeNull();
    const first = port.market[0];
    expect(within(screen.getByTestId(`market-row-${first.good}`)).getByText(String(first.stock))).toBeInTheDocument();
  });

  it("交易所：行情通报写明告示板上比手上新的港口与价格，一键买下；没有更新的就直说", async () => {
    const user = userEvent.setup();
    const here: PortView = { ...port, report: { locs: [1, 2], price: 180 } };
    const { unmount } = render(<Market port={here} />);
    const box = screen.getByTestId("market-report");
    expect(box).toHaveTextContent(`告示板上有 2 处港口的行情比你手上的新（柳湾、兰城），整份买下要 ${money(180)}。`);
    await user.click(within(box).getByRole("button", { name: "买下行情通报" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { BuyMarketReport: { owner: "player", loc: 0 } } }));
    unmount();
    render(<Market port={{ ...port, report: { locs: [], price: 0 } }} />);
    const none = screen.getByTestId("market-report");
    expect(none).toHaveTextContent("告示板上没有比你手上更新的行情。");
    expect(within(none).queryByRole("button")).toBeNull();
  });

  it("行情窗口：过时的行情自动按抵达时预测（期限 = 过时的天数 + 航程），记下时起点是所知的最后收盘日", async () => {
    const user = userEvent.setup();
    let book: BookView = emptyBook;
    calls = installIpc({
      market_series: () => staleSeries(),
      forecast_book: () => book,
      pin_forecast: () => {
        book = { ...book, active: 1 };
        return book;
      },
    });
    render(<AnalysisPanel />);
    const note = await screen.findByTestId("fc-stale");
    expect(note).toHaveTextContent("这里的行情是 10 天前的（行情通报），日线只到那一天。你的旗舰队到这里约 7 天：期限取 10 + 7 = 17 天，终点就是抵达的那天。");
    await waitFor(() => expect(screen.getByLabelText("往后看几天")).toHaveValue("17"));
    expect(screen.getByTestId("fc-summary")).toHaveTextContent("17 天后约");
    // 改了期限：可以一键回到抵达时
    await user.selectOptions(screen.getByLabelText("往后看几天"), "30");
    await user.click(within(screen.getByTestId("fc-stale")).getByRole("button", { name: "按抵达时预测" }));
    expect(screen.getByLabelText("往后看几天")).toHaveValue("17");
    await user.click(screen.getByRole("button", { name: "记下这个预测" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("pin_forecast", expect.anything()));
    const req = calls.mock.calls.find(([c]) => c === "pin_forecast")?.[1].request as PinRequest;
    expect(req.origin).toBe(49);
    expect(req.horizon).toBe(17);
    expect(req.path).toHaveLength(17);
    // 实时的行情（旧后端或在港）：没有这段说明
    resetForecast();
    installIpc({ forecast_book: () => emptyBook });
    const other = render(<AnalysisPanel />);
    await other.findAllByTestId("fc-summary");
    expect(other.container.querySelector("[data-testid='fc-stale']")).toBeNull();
  });

  it("复盘：用过时的行情记下的预测指出“行情已经过时”；预测期结束而消息没传回来时写明在等消息", async () => {
    const user = userEvent.setup();
    const s = seriesFor(0, 0);
    const r = runForecast({ daily: s.daily.slice(0, 50), lastClose: 49, monthly: [], monthlyLast: null, floor: s.floor, cap: s.cap }, { ...START_SPEC, method: "naive", window: 30 }, 10);
    if (!r.ok) throw new Error("预测失败");
    const fitted = s.daily.slice(20, 50);
    // 第 60 天用第 49 天的行情记下（过时 10 天），看 10 天：预测期到第 59 天已经结束，只知道头 4 天的实际价格
    const entry: ForecastEntryView = {
      id: 9,
      loc: 0,
      good: 0,
      created: 60,
      origin: 49,
      horizon: 10,
      spec: specToView({ ...START_SPEC, method: "naive", window: 30 }),
      fitted_on: fitted,
      path: roundPath(r.path),
      revises: null,
      basis: null,
      baseline: day(49, fitted[fitted.length - 1]),
      baseline_exact: false,
      track: [50, 51, 52, 53].map((d) => day(d, fitted[fitted.length - 1])),
      marks: [],
    };
    installIpc({ forecast_book: () => ({ ...emptyBook, entries: [entry] }) });
    render(<AnalysisPanel />);
    await user.click(await screen.findByRole("tab", { name: "预测簿" }));
    const item = await screen.findByTestId("fc-entry-9");
    expect(item).toHaveTextContent("已过 4/10 天 · 等消息");
    await user.click(within(item).getByRole("button", { name: "复盘" }));
    expect(await screen.findByTestId("fc-waiting")).toHaveTextContent("预测期已经结束，那边的行情还没传回来");
    expect(screen.getByTestId("fc-causes")).toHaveTextContent("预测所用的行情已经过时：起点是记下之前 10 天的行情，这些天里的变化事先无从得知");
  });
});
