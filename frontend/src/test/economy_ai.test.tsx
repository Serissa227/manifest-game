// 第八批 E7（docs/ECONOMY.md 第 8 节、6.10）：交易所里势力政策的标记（禁运、出口税、进口关税）、酒馆里的商会传闻、
// 情报里的市场月报与身世序章、复盘里的“请账房点评”。模拟的 Tauri IPC，不调用任何真实服务。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import AnalysisPanel from "../components/panels/AnalysisPanel";
import IntelPanel from "../components/panels/IntelPanel";
import Market from "../components/panels/Market";
import PortPanel from "../components/panels/PortPanel";
import { roundPath, runForecast } from "../forecast/engine";
import { specToView } from "../forecast/spec";
import { setLocale } from "../i18n/locale";
import type { ForecastEntryView, PortView, TrackDayView } from "../ipc/types";
import { START_SPEC, useForecast } from "../store/forecast";
import { useGame } from "../store/game";
import { emptyBook, installIpc, overview, port, seriesFor, startedGame, statics } from "./fixtures";

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

describe("LLM 进入经济", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    setLocale("zh-CN");
    calls = installIpc();
    startedGame();
    useForecast.setState({ loc: null, good: null, spec: START_SPEC, horizon: 15, mode: "daily", monthlyHorizon: 6, view: "work", reviewId: null, draft: null });
  });

  it("交易所：禁运、出口税与进口关税标在商品旁边，写明倍数", () => {
    const [a, b] = port.market;
    const here: PortView = {
      ...port,
      market: [
        { ...a, banned: true, export_tax_bp: 20_000 },
        { ...b, import_tax_bp: 15_000 },
      ],
    };
    render(<Market port={here} />);
    const first = screen.getByTestId(`market-row-${a.good}`);
    expect(within(first).getByText("禁运")).toHaveAttribute("title", expect.stringContaining("买不到"));
    expect(first).toHaveTextContent("出口税 ×2");
    expect(screen.getByTestId(`market-row-${b.good}`)).toHaveTextContent("进口关税 ×1.5");
    // 没有政策的旧后端：不标
    expect(within(screen.getByTestId(`market-row-${b.good}`)).queryByText("禁运")).toBeNull();
  });

  it("酒馆：本据港在这里或有船队停着的商会，它们的展望成了传闻", async () => {
    installIpc({
      port: () => ({ ...port, outlooks: [{ company: "阿尔梅拉商行", day: 30, memo: "阿尔梅拉商行看好胡椒，打算多运一些。" }] }),
    });
    useGame.setState({ facility: "tavern" });
    render(<PortPanel />);
    const list = await screen.findByTestId("tavern-outlooks");
    expect(list).toHaveTextContent("听说阿尔梅拉商行：阿尔梅拉商行看好胡椒，打算多运一些。");
  });

  it("情报：市场月报按海区列出；立下身世后，编年史前面是序章", async () => {
    calls = installIpc({
      intel: () => ({
        news: [],
        events: [],
        log: [],
        chronicles: [],
        composed: [],
        reports: [{ day: 32, region: 0, month: 0, text: "港务厅月报：澄港的谷物月均价涨了 23%。" }],
      }),
      prologue: () => "林远舟生在罗盘座当值的时节。",
    });
    useGame.setState({
      overview: {
        ...overview,
        profile: { birthday: { year: 1480, month: 2, day: 12 }, sign: "compass", sign_name: "罗盘座", answers: [], attrs: [], methods: [], created: 0 },
      },
    });
    render(<IntelPanel />);
    const reports = await screen.findByTestId("intel-reports");
    expect(reports).toHaveTextContent(`${statics.regions[0].name} · 第 32 天发布`);
    expect(reports).toHaveTextContent("港务厅月报：澄港的谷物月均价涨了 23%。");
    expect(await screen.findByTestId("intel-prologue")).toHaveTextContent("序章林远舟生在罗盘座当值的时节。");
    expect(calls.mock.calls.filter(([c]) => c === "prologue")).toHaveLength(1);
  });

  it("复盘：请账房点评，把诊断与驱动（界面语言）交给后端，显示写好的点评", async () => {
    const user = userEvent.setup();
    const s = seriesFor(0, 0);
    const r = runForecast({ daily: s.daily.slice(0, 50), lastClose: 49, monthly: [], monthlyLast: null, floor: s.floor, cap: s.cap }, { ...START_SPEC, method: "naive", window: 30 }, 10);
    if (!r.ok) throw new Error("预测失败");
    const fitted = s.daily.slice(20, 50);
    const last = fitted[fitted.length - 1];
    // 预测照旧，实际涨了五成：失败
    const entry: ForecastEntryView = {
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
      track: Array.from({ length: 10 }, (_, i) => day(50 + i, Math.round(last * 1.5))),
      marks: [],
    };
    calls = installIpc({
      forecast_book: () => ({ ...emptyBook, entries: [entry] }),
      review_comment: () => "账房翻到澄港的谷物这一页，眯着眼看了半晌：实际比预测高得多。",
    });
    render(<AnalysisPanel />);
    await user.click(await screen.findByRole("tab", { name: "预测簿" }));
    await user.click(within(await screen.findByTestId("fc-entry-7")).getByRole("button", { name: "复盘" }));
    const box = await screen.findByTestId("fc-comment");
    await user.click(within(box).getByRole("button", { name: "请账房点评" }));
    await waitFor(() => expect(box).toHaveTextContent("账房翻到澄港的谷物这一页"));
    const req = calls.mock.calls.find(([c]) => c === "review_comment")?.[1] as { entry: number; place: string; facts: string[] };
    expect(req.entry).toBe(7);
    expect(req.place).toContain(statics.goods[0].name);
    expect(req.facts.length).toBeGreaterThan(0);
    const causes = screen.getByTestId("fc-causes").textContent ?? "";
    expect(req.facts.some((f) => causes.includes(f))).toBe(true);
  });
});
