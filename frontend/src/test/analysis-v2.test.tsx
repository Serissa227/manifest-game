// 新界面（v2，docs/UI-REDESIGN.md 第 8 节第 4 项“数字类”）：行情、期货、报表、情报在 v2 下的小改动——
// 推算页贴底的“记下预测”条、空状态的“下一步”、删除预测前先问、期货的行内下单（不用先选中一行）、
// 手机上变成卡片的表格（格子的 data-label）、图表的纸面配色；以及旧界面（v1）下这些都不出现（结构与行为照旧）。
// 模拟的 Tauri IPC，不调用任何真实服务。
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { init } from "echarts";
import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { luma, rgba } from "../art/px";
import ForecastChart from "../components/analysis/ForecastChart";
import { LineChart } from "../components/Chart";
import { V2_CHART } from "../components/chartTheme";
import MarketForecast from "../components/analysis/MarketForecast";
import AnalysisPanel from "../components/panels/AnalysisPanel";
import FuturesPanel from "../components/panels/FuturesPanel";
import IntelPanel from "../components/panels/IntelPanel";
import ReportsPanel from "../components/panels/ReportsPanel";
import { roundPath, runForecast } from "../forecast/engine";
import { specToView } from "../forecast/spec";
import { setLocale } from "../i18n/locale";
import type { EconomyReportView, ForecastEntryView, FuturesView, PinRequest, TrackDayView } from "../ipc/types";
import { START_SPEC, useForecast } from "../store/forecast";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { COMMON, emptyBook, futures, installIpc, overview, reports, seriesFor, startedGame } from "./fixtures";
import { PHONE, PHONE_LANDSCAPE, mockViewport, resetViewport } from "./viewport";

function setUiFor(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

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

/** 一条记下的“照旧”预测（第 7 条：澄港 · 谷物），预测期里价格没动。 */
function entry(): ForecastEntryView {
  const s = seriesFor(0, 0);
  const fitted = s.daily.slice(20, 50);
  const r = runForecast({ daily: s.daily.slice(0, 50), lastClose: 49, monthly: [], monthlyLast: null, floor: s.floor, cap: s.cap }, { ...START_SPEC, method: "naive", window: 30 }, 10);
  if (!r.ok) throw new Error("预测失败");
  const last = fitted[fitted.length - 1];
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
    track: Array.from({ length: 10 }, (_, i) => day(50 + i, last)),
    marks: [],
  };
}

function econ(month: number): EconomyReportView {
  return {
    month,
    day: 30 * (month + 1),
    sectors: [{ kind: "traders", opening: 400_000, inflow: 90_000, outflow: 60_000, closing: 430_000 }],
    flows: [{ flow: "Market", from: "towns", to: "traders", amount: 80_000 }],
    money_supply: 14_700_000,
    player: 21_000,
    companies: 380_000,
    exchange: 29_000,
    price_index_bp: 10_000,
    production: 1,
    population: 1,
    shortfall: 0,
    tightest: null,
    flush: null,
    treasuries: [{ faction: "翠岚", money: 86_000, tax_mult_bp: 10_000, patrol_bp: 5_000, income: 1, spent: 1 }],
  };
}

/** 页面里 v2 开头的类，以及新界面才加的结构。 */
const v2Traces = () => [
  ...[...document.querySelectorAll("[class]")].flatMap((el) => [...el.classList]).filter((c) => /^(v2(-|$)|fu-|fc-pin-bar|fc-pin-what|fc-bt-act)/.test(c)),
  ...[...document.querySelectorAll("[data-label]")].map(() => "data-label"),
];

beforeEach(() => {
  setLocale("zh-CN");
  startedGame();
  resetForecast();
});
afterEach(() => {
  // 先卸下组件再切回 v1（否则切换会让还挂着的组件在 act 之外更新）
  cleanup();
  setUiFor("v1");
});

describe("行情（v2）", () => {
  it("“记下这个预测”在贴底的条上，写明记下的是哪个法子、往后几天；点了照常记下", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    const calls = installIpc();
    render(<AnalysisPanel />);
    const bar = await screen.findByTestId("fc-pin-bar");
    expect(bar).toHaveAccessibleName("记下预测");
    // 不在右栏里：右栏只剩方法与参数
    expect(screen.getByTestId("fc-work").querySelector(".fc-work-side .fc-pin")).toBeNull();
    expect(within(bar).getByTestId("fc-pin-what")).toHaveTextContent("公道价 · 往后 15 天");
    expect(within(bar).getByText("正在追踪 0/12 条")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("往后看几天"), "30");
    expect(within(bar).getByTestId("fc-pin-what")).toHaveTextContent("公道价 · 往后 30 天");
    await user.click(within(bar).getByRole("button", { name: "记下这个预测" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("pin_forecast", expect.anything()));
    const req = calls.mock.calls.find(([c]) => c === "pin_forecast")?.[1].request as PinRequest;
    expect(req.horizon).toBe(30);
    expect(req.spec.method).toBe("fair");
  });

  it("月线只供参考：贴底条上换成一句说明，没有记下的按钮", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    const months = Array.from({ length: 30 }, (_, i) => 12 + (i % 12));
    installIpc({ market_series: (a) => seriesFor(a.loc as number, a.good as number, { monthly: months, monthly_last: 59 }) });
    render(<AnalysisPanel />);
    const mode = await screen.findByRole("group", { name: "看哪条线" });
    await user.click(within(mode).getByRole("radio", { name: "月线" }));
    const bar = screen.getByTestId("fc-pin-bar");
    expect(within(bar).getByTestId("fc-monthly-note")).toHaveTextContent("只供参考");
    expect(within(bar).queryByRole("button")).toBeNull();
  });

  it("交易所抽屉里的小预测图：还没有收盘价时与行情窗口同一个空状态（v2 只写“过一天就有了”、不放“下一天”——抽屉里已有成交的主按钮；v1 照旧一句话）", async () => {
    setUiFor("v2");
    installIpc({ market_series: () => seriesFor(0, 1, { last_close: null, daily: [] }) });
    const { unmount } = render(<MarketForecast loc={0} good={1} />);
    const empty = await screen.findByTestId("empty-state");
    expect(empty).toHaveClass("mk-forecast-empty");
    expect(empty).toHaveTextContent("这里还没有收盘价，至少要过一天。");
    expect(empty).toHaveTextContent("收盘价每天记一次，过一天就有了。");
    expect(within(empty).queryByRole("button")).toBeNull();
    unmount();
    act(() => setUiFor("v1"));
    render(<MarketForecast loc={0} good={1} />);
    expect(await screen.findByText("这里还没有收盘价，至少要过一天。")).toHaveClass("empty");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("还没有收盘价：空状态给“下一天”，点了推进一天", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    const calls = installIpc({ forecast_book: () => ({ ...emptyBook, places: [] }) });
    render(<AnalysisPanel />);
    const empty = await screen.findByTestId("empty-state");
    expect(empty).toHaveTextContent("这里还没有收盘价，至少要过一天。");
    expect(empty).toHaveTextContent("收盘价每天记一次，过一天就有了。");
    await user.click(within(empty).getByRole("button", { name: "下一天" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("step", { days: 1 }));
  });

  it("空的预测簿与没有奇才的试算：说明为什么空，“去推算”回到推算页", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    installIpc();
    render(<AnalysisPanel />);
    await user.click(await screen.findByRole("tab", { name: "预测簿" }));
    const book = await screen.findByTestId("empty-state");
    expect(book).toHaveTextContent("还没有记下的预测。");
    expect(book).toHaveTextContent("预测簿会逐日对照它准不准");
    await user.click(within(book).getByRole("button", { name: "去推算" }));
    expect(useForecast.getState().view).toBe("work");
    expect(await screen.findByTestId("fc-work")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "对照旧账试算" }));
    const locked = await screen.findByTestId("empty-state");
    expect(locked).toHaveTextContent("对照旧账试算、误差检验与干预修正需要一位算学奇才。");
    expect(locked).toHaveTextContent("酒馆");
    await user.click(within(locked).getByRole("button", { name: "去推算" }));
    expect(useForecast.getState().view).toBe("work");
  });

  it("删除预测簿里的一条先问一句：取消不删；确认后删掉并回一句", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    const calls = installIpc({ forecast_book: () => ({ ...emptyBook, entries: [entry()] }) });
    render(<AnalysisPanel />);
    await user.click(await screen.findByRole("tab", { name: "预测簿" }));
    const item = await screen.findByTestId("fc-entry-7");
    await user.click(within(item).getByRole("button", { name: "删除" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("删除第 7 条预测？");
    expect(dialog).toHaveTextContent("#7 澄港 · 谷物 · 照旧");
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls).not.toHaveBeenCalledWith("remove_forecast", expect.anything());

    await user.click(within(screen.getByTestId("fc-entry-7")).getByRole("button", { name: "删除" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "删除这条预测" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("remove_forecast", { id: 7 }));
    await waitFor(() => expect(useGame.getState().message).toBe("已删除第 7 条预测"));
  });

  it("删除确认框取消（点“取消”或按 Esc）后，焦点回到这一条的“删除”按钮（键盘用户不丢位置）", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    installIpc({ forecast_book: () => ({ ...emptyBook, entries: [entry()] }) });
    render(<AnalysisPanel />);
    await user.click(await screen.findByRole("tab", { name: "预测簿" }));
    const del = within(await screen.findByTestId("fc-entry-7")).getByRole("button", { name: "删除" });
    await user.click(del);
    const dialog = await screen.findByRole("alertdialog");
    // 等确认的时候“删除”按钮不能被禁用（禁用的元素拿不回焦点）
    expect(del).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(del).toHaveFocus();
    // 键盘：回车打开，Esc 取消，焦点仍回到“删除”
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(del).toHaveFocus();
  });

  it("试算表的格子带 data-label（手机上变成卡片时写在数前）；“用这个”照常换方法", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    const methods = [...COMMON, "linear", "ar1"];
    installIpc({
      market_series: (a) => seriesFor(a.loc as number, a.good as number, { methods }),
      forecast_book: () => ({ ...emptyBook, methods, geniuses: [{ mate: 5, name: "卡里姆", methods: ["linear", "ar1"] }] }),
    });
    render(<AnalysisPanel />);
    await user.click(await screen.findByRole("tab", { name: "对照旧账试算" }));
    const table = await screen.findByTestId("fc-backtest");
    const row = within(table).getAllByRole("row")[1];
    const labels = [...row.querySelectorAll("td[data-label]")].map((td) => td.getAttribute("data-label"));
    expect(labels).toEqual(["与照旧之比", "平均偏差", "偏差百分比", "落在八成区间", "落在九成五区间", "对照次数"]);
    await user.click(within(row).getByRole("button", { name: "用这个" }));
    expect(useForecast.getState().view).toBe("work");
  });

  it("旧界面（v1）：没有贴底条、没有 data-label，空状态照旧只有一句话，删除不问", async () => {
    const user = userEvent.setup();
    const calls = installIpc({ forecast_book: () => ({ ...emptyBook, entries: [entry()] }) });
    render(<AnalysisPanel />);
    await screen.findByTestId("fc-work");
    expect(screen.queryByTestId("fc-pin-bar")).toBeNull();
    expect(screen.getByTestId("fc-work").querySelector(".fc-work-side .fc-pin")).not.toBeNull();
    await user.click(screen.getByRole("tab", { name: "预测簿" }));
    await user.click(within(await screen.findByTestId("fc-entry-7")).getByRole("button", { name: "删除" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("remove_forecast", { id: 7 }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(v2Traces()).toEqual([]);
  });
});

describe("期货（v2）", () => {
  it("每一行直接开多、开空、平仓（手数在行情板上方），交割方式在持仓那一格；不再出现下单单子", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    const calls = installIpc();
    render(<FuturesPanel />);
    const row = await screen.findByTestId("futures-row-7");
    // 交割港写进合约的小字
    expect(row).toHaveTextContent("交割 澄港");
    const lots = within(screen.getByTestId("fu-lots")).getByLabelText("手数");
    await user.clear(lots);
    await user.type(lots, "3");
    await user.click(within(row).getByRole("button", { name: "丝绸 · 第 60 天到期：买入开多 3 手" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { TradeFutures: { owner: "player", contract: 7, lots: 3 } } }));
    await user.click(within(row).getByRole("button", { name: "丝绸 · 第 60 天到期：卖出开空 3 手" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { TradeFutures: { owner: "player", contract: 7, lots: -3 } } }));
    await user.click(within(row).getByRole("button", { name: "丝绸 · 第 60 天到期：平仓 2 手" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { TradeFutures: { owner: "player", contract: 7, lots: -2 } } }));
    const settle = within(row).getByRole("group", { name: "丝绸 · 第 60 天到期：到期交割方式" });
    expect(within(settle).getByRole("radio", { name: "现金结算" })).toBeChecked();
    await user.click(within(settle).getByRole("radio", { name: "实物交割" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { SetDelivery: { owner: "player", contract: 7, physical: true } } }));
    // 点一行不会选中、也不会出现下单单子
    await user.click(row);
    expect(row).not.toHaveClass("selected");
    expect(document.querySelector(".pn-ticket")).toBeNull();
    // 格子带 data-label（手机上变成卡片时写在数前）
    expect([...row.querySelectorAll("td[data-label]")].map((td) => td.getAttribute("data-label"))).toEqual(["买价", "卖价", "盯市价", "交割港现货", "持仓"]);
  });

  it("交割方式是两段的切换：字不随状态变，选中的那段就是现在的方式；每一行的读屏名带合约名", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    const cash = futures.contracts[0];
    const physical = { ...cash, id: 8, good: 2, expiry_day: 90, position: { lots: -1, avg_price: 50, physical: true, pnl: -20 } };
    const calls = installIpc({ futures: () => ({ ...futures, contracts: [cash, physical] }) });
    render(<FuturesPanel />);
    const groups = await screen.findAllByRole("group", { name: /：到期交割方式$/ });
    expect(groups).toHaveLength(2);
    // 两行的读屏名各不相同（带合约名）
    expect(new Set(groups.map((g) => g.getAttribute("aria-label"))).size).toBe(2);
    for (const g of groups) {
      // 两段的字固定（不随状态变成“到期现金结算 / 到期实物交割”）
      expect(within(g).getAllByRole("radio").map((r) => r.closest("label")?.textContent)).toEqual(["现金结算", "实物交割"]);
    }
    const row8 = screen.getByTestId("futures-row-8");
    const settle8 = within(row8).getByRole("group", { name: /：到期交割方式$/ });
    expect(within(settle8).getByRole("radio", { name: "实物交割" })).toBeChecked();
    expect(within(settle8).getByRole("radio", { name: "现金结算" })).not.toBeChecked();
    await user.click(within(settle8).getByRole("radio", { name: "现金结算" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { SetDelivery: { owner: "player", contract: 8, physical: false } } }));
    // 已经选中的那段再点一下不发单子
    const sets = () => calls.mock.calls.filter(([c, a]) => c === "submit" && "SetDelivery" in (a.command as object));
    await user.click(within(settle8).getByRole("radio", { name: "实物交割" }));
    expect(sets()).toHaveLength(1);
  });

  it("保证金的金额在账户上方；追保的账户写明后果；存入照常提交", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    const calls = installIpc({
      futures: () => ({
        accounts: [{ exchange: 0, balance: 500, initial_requirement: 900, maintenance_requirement: 630, call_since: 11 }],
        contracts: [],
      }),
    });
    render(<FuturesPanel />);
    const toolbar = await screen.findByTestId("fu-amount");
    const accounts = document.querySelector(".pn-accounts");
    expect(accounts).not.toBeNull();
    // 金额在账户前面（DOM 与键盘顺序也是）
    expect(toolbar.compareDocumentPosition(accounts as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("alert")).toHaveTextContent("追保中（第 11 天发出）");
    expect(screen.getByTestId("fu-call-note-0")).toHaveTextContent("明天盯市后若仍低于维持保证金，交易所会强行平仓。至少还差 130 金币。");
    const amount = within(toolbar).getByLabelText("金额");
    await user.clear(amount);
    await user.type(amount, "2500");
    await user.click(screen.getByRole("button", { name: "存入保证金" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { DepositMargin: { owner: "player", exchange: 0, amount: 2500 } } }));
    // 没有合约：说明为什么空
    expect(screen.getByTestId("empty-state")).toHaveTextContent("眼下没有挂牌的期货合约。");
  });

  it("追保而且低于维持保证金：卡上有一键“存入差额”，按差额直接存入（不用先在金额框里打数），在路上时禁用、双击只存一次；没有差额时不出现", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    const pending: (() => void)[] = [];
    let view: FuturesView = {
      accounts: [{ exchange: 0, balance: 500, initial_requirement: 900, maintenance_requirement: 630, call_since: 11 }],
      contracts: [],
    };
    const calls = installIpc({
      futures: () => view,
      submit: () => new Promise((resolve) => pending.push(() => resolve({ outcome: "Done", overview }))),
    });
    render(<FuturesPanel />);
    const topUp = await screen.findByRole("button", { name: "澄港期货交易所：存入差额 130 金币，补到维持保证金" });
    expect(topUp).toHaveTextContent("存入差额 130 金币");
    // 一键按钮在追保说明的下面、存取按钮的上面（看完说明就是它）
    const note = screen.getByTestId("fu-call-note-0");
    expect(note.compareDocumentPosition(topUp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(topUp.compareDocumentPosition(screen.getByRole("button", { name: "存入保证金" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.dblClick(topUp);
    await waitFor(() => expect(pending).toHaveLength(1));
    const deposits = () => calls.mock.calls.filter(([c, a]) => c === "submit" && "DepositMargin" in (a.command as object));
    expect(deposits()).toEqual([["submit", { command: { DepositMargin: { owner: "player", exchange: 0, amount: 130 } } }]]);
    expect(topUp).toBeDisabled();
    // 存够了（追保的小签要到明天盯市才撤）：没有差额，按钮不再出现
    view = { ...view, accounts: [{ ...view.accounts[0], balance: 630 }] };
    await act(async () => pending[0]());
    await waitFor(() => expect(screen.queryByRole("button", { name: /存入差额/ })).toBeNull());
    expect(screen.getByRole("alert")).toHaveTextContent("追保中（第 11 天发出）");
    expect(screen.getByTestId("fu-call-note-0")).not.toHaveTextContent("至少还差");
  });

  it("手机上合约（下单的地方）排在保证金账户前面，DOM 顺序也是；追保时最上面一条写明哪个交易所、后果与差额，带一键“存入差额”，账户卡里不再重复；桌面照旧账户在前", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    const called = { exchange: 0, balance: 500, initial_requirement: 900, maintenance_requirement: 630, call_since: 11 };
    let view: FuturesView = { ...futures, accounts: [called] };
    const calls = installIpc({ futures: () => view });
    const sections = () => [...document.querySelectorAll(".pn-futures > section")].map((s) => s.querySelector(".pn-h")?.textContent);
    try {
      mockViewport(PHONE);
      const { unmount } = render(<FuturesPanel />);
      await screen.findByTestId("futures-row-7");
      expect(sections()).toEqual(["合约", "保证金账户"]);
      // 追保的一条在最上面（合约之前），说明与按钮只出现这一次
      const strip = screen.getByTestId("fu-call-strip-0");
      expect(strip).toHaveTextContent("澄港期货交易所");
      expect(strip).toHaveTextContent("追保中（第 11 天发出）");
      expect(strip).toHaveTextContent("至少还差 130 金币。");
      expect(strip.compareDocumentPosition(screen.getByTestId("futures-row-7")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getAllByTestId("fu-call-note-0")).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: /存入差额/ })).toHaveLength(1);
      // 账户卡里照旧有追保的小签（读屏照样会报）
      expect(document.querySelector(".pn-account .fu-call-note")).toBeNull();
      expect(screen.getByRole("alert")).toHaveTextContent("追保中（第 11 天发出）");
      await user.click(within(strip).getByRole("button", { name: "澄港期货交易所：存入差额 130 金币，补到维持保证金" }));
      await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { DepositMargin: { owner: "player", exchange: 0, amount: 130 } } }));
      unmount();
      // 没有追保：没有那一条，合约照样在前
      view = { ...futures, accounts: [{ ...called, balance: 5000, call_since: null }] };
      const second = render(<FuturesPanel />);
      await screen.findByTestId("futures-row-7");
      expect(sections()).toEqual(["合约", "保证金账户"]);
      expect(document.querySelector(".fu-call-strip")).toBeNull();
      second.unmount();
      // 横屏手机同样
      mockViewport(PHONE_LANDSCAPE);
      const third = render(<FuturesPanel />);
      await screen.findByTestId("futures-row-7");
      expect(sections()).toEqual(["合约", "保证金账户"]);
      third.unmount();
    } finally {
      resetViewport();
    }
    // 桌面：账户在前，追保的说明与按钮在卡里，没有最上面那一条
    view = { ...futures, accounts: [called] };
    render(<FuturesPanel />);
    await screen.findByTestId("futures-row-7");
    expect(sections()).toEqual(["保证金账户", "合约"]);
    expect(document.querySelector(".fu-call-strip")).toBeNull();
    expect(document.querySelector(".pn-account .fu-call-note")).not.toBeNull();
    expect(within(document.querySelector(".pn-account") as HTMLElement).getByRole("button", { name: /存入差额/ })).toBeInTheDocument();
  });

  it("行内下单防连点：单子在路上时这一行的按钮都禁用，双击只发一单；回来以后照常能下", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    const pending: (() => void)[] = [];
    const calls = installIpc({
      submit: () => new Promise((resolve) => pending.push(() => resolve({ outcome: "Done", overview }))),
    });
    render(<FuturesPanel />);
    const row = await screen.findByTestId("futures-row-7");
    const long = within(row).getByRole("button", { name: "丝绸 · 第 60 天到期：买入开多 1 手" });
    await user.dblClick(long);
    await waitFor(() => expect(pending).toHaveLength(1));
    const trades = () => calls.mock.calls.filter(([c, a]) => c === "submit" && "TradeFutures" in (a.command as object));
    expect(trades()).toHaveLength(1);
    // 在路上：这一行的开多、开空、平仓都禁用
    for (const b of within(row).getAllByRole("button")) expect(b).toBeDisabled();
    await act(async () => pending[0]());
    await waitFor(() => expect(long).toBeEnabled());
    await user.click(long);
    await waitFor(() => expect(trades()).toHaveLength(2));
    await act(async () => pending[1]());
  });

  it("平仓按下单那一刻现查的持仓数平（行情板上的还是旧数）；已经没有持仓时不再下单", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    // 行情板第一次查到 2 手；之后（成交了却还没刷新时）现查到的是 5 手
    let view: FuturesView = futures;
    const calls = installIpc({ futures: () => view });
    render(<FuturesPanel />);
    const row = await screen.findByTestId("futures-row-7");
    view = { ...futures, contracts: [{ ...futures.contracts[0], position: { lots: 5, avg_price: 92, physical: false, pnl: 40 } }] };
    await user.click(within(row).getByRole("button", { name: "丝绸 · 第 60 天到期：平仓 2 手" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { TradeFutures: { owner: "player", contract: 7, lots: -5 } } }));
    expect(calls).not.toHaveBeenCalledWith("submit", { command: { TradeFutures: { owner: "player", contract: 7, lots: -2 } } });
    // 已经平掉了（现查没有持仓）：不发单子，行情板刷新后“平仓”不见了
    view = { ...futures, contracts: [{ ...futures.contracts[0], position: null }] };
    const close = within(row).queryByRole("button", { name: /平仓/ });
    if (close) {
      await waitFor(() => expect(close).toBeEnabled());
      await user.click(close);
    }
    await waitFor(() => expect(within(screen.getByTestId("futures-row-7")).queryByRole("button", { name: /平仓/ })).toBeNull());
    const trades = calls.mock.calls.filter(([c, a]) => c === "submit" && "TradeFutures" in (a.command as object));
    expect(trades).toHaveLength(1);
  });

  it("旧界面（v1）：没有行内下单与工具栏，点一行照旧出下单单子；没有合约时照旧写“无”", async () => {
    const user = userEvent.setup();
    installIpc();
    const { unmount } = render(<FuturesPanel />);
    const row = await screen.findByTestId("futures-row-7");
    expect(within(row).queryByRole("button")).toBeNull();
    expect(row).not.toHaveTextContent("交割 澄港");
    await user.click(row);
    expect(row).toHaveClass("selected");
    expect(document.querySelector(".pn-ticket")).not.toBeNull();
    expect(v2Traces()).toEqual([]);
    unmount();
    installIpc({ futures: () => ({ accounts: [], contracts: [] }) });
    render(<FuturesPanel />);
    expect(await screen.findByText("无")).toHaveClass("empty");
  });
});

describe("报表与情报（v2）", () => {
  it("报表：还没有年报时写明什么时候会有；经济月报的部门与国库格子带 data-label，资金流不带", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    installIpc({ reports: () => ({ ...reports, economy: [econ(0)] }) });
    render(<ReportsPanel />);
    const sectors = await screen.findByTestId("economy-sectors");
    expect([...sectors.querySelectorAll("tbody td[data-label]")].map((td) => td.getAttribute("data-label"))).toEqual(["月初", "流入", "流出", "月末"]);
    expect(screen.getByTestId("economy-treasuries").querySelectorAll("tbody td[data-label]")).toHaveLength(5);
    expect(screen.getByTestId("economy-flows").querySelector("[data-label]")).toBeNull();
    await user.click(screen.getByRole("tab", { name: "年报" }));
    const empty = screen.getByTestId("empty-state");
    expect(empty).toHaveTextContent("尚无已结账的报表（每月末生成）");
    expect(empty).toHaveTextContent("每月最后一天结账");
  });

  it("情报：各处空着时写明为什么；日志空着不画空框", async () => {
    setUiFor("v2");
    installIpc({ intel: () => ({ news: [], events: [], log: [], chronicles: [], composed: [] }) });
    render(<IntelPanel />);
    const panel = await screen.findByTestId("intel-panel");
    const texts = within(panel)
      .getAllByTestId("empty-state")
      .map((e) => e.querySelector(".v2-empty-text")?.textContent);
    expect(texts).toEqual(["还没有听到什么消息。", "眼下没有进行中的事件。", "近来海上风平浪静，没有值得记下的大事。", "日志里还没有记下什么。", "编年史还是空白的。"]);
    expect(panel.querySelector(".pn-logbook")).toBeNull();
  });

  it("情报：勾了“只看与我有关”而筛完一条不剩时，不说日志是空的；“看全部”一键取消勾选", async () => {
    setUiFor("v2");
    const user = userEvent.setup();
    const others = [{ day: 3, kind: "Arrived", args: [["owner", "某商会"], ["fleet", "2"], ["loc", "澄港"]] as [string, string][], mine: false }];
    installIpc({ intel: () => ({ news: [], events: [], log: others, chronicles: [], composed: [] }) });
    render(<IntelPanel />);
    const panel = await screen.findByTestId("intel-panel");
    expect(panel.querySelector(".pn-logbook li")).not.toBeNull();
    const only = within(panel).getByRole("checkbox", { name: "只看与我有关" });
    await user.click(only);
    const empties = within(panel).getAllByTestId("empty-state");
    const mineEmpty = empties.find((e) => e.textContent?.includes("还没有与你有关的记录。"));
    expect(mineEmpty).toBeDefined();
    expect(within(panel).queryByText("日志里还没有记下什么。")).toBeNull();
    expect(mineEmpty).toHaveTextContent("日志里记的都是别人的事。");
    await user.click(within(mineEmpty as HTMLElement).getByRole("button", { name: "看全部" }));
    expect(only).not.toBeChecked();
    expect(panel.querySelector(".pn-logbook li")).not.toBeNull();
  });

  it("情报：没有消息时的说明不说“靠港”——消息按日程传来、船在哪儿都收得到，AI 关掉时没有新消息", async () => {
    setUiFor("v2");
    installIpc({ intel: () => ({ news: [], events: [], log: [], chronicles: [], composed: [] }) });
    render(<IntelPanel />);
    const news = (await screen.findAllByTestId("empty-state"))[0];
    expect(news).toHaveTextContent("还没有听到什么消息。");
    expect(news).toHaveTextContent("船在哪儿都收得到");
    expect(news).toHaveTextContent("AI 关掉");
    expect(news).not.toHaveTextContent("靠港");
  });

  it("旧界面（v1）：报表与情报的结构照旧（“暂无”、空的日志框、没有 data-label）", async () => {
    installIpc({ reports: () => ({ ...reports, economy: [econ(0)] }), intel: () => ({ news: [], events: [], log: [], chronicles: [], composed: [] }) });
    const { unmount } = render(<ReportsPanel />);
    await screen.findByTestId("economy-sectors");
    expect(v2Traces()).toEqual([]);
    unmount();
    render(<IntelPanel />);
    const panel = await screen.findByTestId("intel-panel");
    expect(within(panel).getAllByText("暂无")).toHaveLength(3);
    expect(panel.querySelector(".pn-logbook")).not.toBeNull();
    expect(v2Traces()).toEqual([]);
  });
});

describe("图表的纸面配色（v2）", () => {
  type Opt = {
    legend: { textStyle: { color: string } };
    xAxis: { axisLabel: { color: string } };
    yAxis: { axisLabel: { color: string } };
    tooltip: { backgroundColor: string; textStyle: { color: string }; confine: boolean; valueFormatter: (v: unknown) => string };
    color?: string[];
    series: { areaStyle?: unknown; lineStyle?: { color?: string } }[];
  };
  const optionOf = async (ui: ReactElement) => {
    vi.mocked(init).mockClear();
    const { unmount } = render(ui);
    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    const chart = vi.mocked(init).mock.results[0].value as { setOption: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(chart.setOption).toHaveBeenCalled());
    const raw = chart.setOption.mock.calls[chart.setOption.mock.calls.length - 1][0] as Opt & { baseOption?: Opt };
    unmount();
    // 带响应式规则（media）的设置：基础部分在 baseOption 里
    return raw.baseOption ?? raw;
  };
  const dark = (c: string) => luma(rgba(c)) < 110;

  it("折线图：深色文字、白纸提示框、线色在纸面上够深；只有一条线时下面垫一层淡面积；切回 v1 换回羊皮纸配色", async () => {
    setUiFor("v2");
    const opt = await optionOf(<LineChart labels={["1", "2", "3"]} series={[{ name: "货币总量", data: [1, 2, 3] }]} />);
    expect(dark(opt.legend.textStyle.color)).toBe(true);
    expect(dark(opt.xAxis.axisLabel.color)).toBe(true);
    expect(dark(opt.yAxis.axisLabel.color)).toBe(true);
    expect(dark(opt.tooltip.textStyle.color)).toBe(true);
    expect(opt.tooltip.backgroundColor).toBe(V2_CHART.tooltipBg);
    expect(opt.tooltip.confine).toBe(true);
    expect(opt.tooltip.valueFormatter(12.954841603910417)).toBe("12.95");
    for (const c of opt.color ?? []) expect(luma(rgba(c))).toBeLessThan(150);
    expect(opt.series[0].areaStyle).toBeDefined();
    const two = await optionOf(
      <LineChart
        labels={["1", "2"]}
        series={[
          { name: "总资产", data: [1, 2] },
          { name: "净资产", data: [1, 2] },
        ]}
      />,
    );
    expect(two.series.every((s) => s.areaStyle === undefined)).toBe(true);
    // v1：仍是原来的羊皮纸配色（没有面积）
    act(() => setUiFor("v1"));
    const v1 = await optionOf(<LineChart labels={["1", "2"]} series={[{ name: "货币总量", data: [1, 2] }]} />);
    expect(v1.tooltip.backgroundColor).not.toBe(V2_CHART.tooltipBg);
    expect(v1.series[0].areaStyle).toBeUndefined();
    // 三次挂载图表（按需载入 echarts）：机器忙时会超过缺省的 5 秒
  }, 20000);

  it("预测图：纸面配色，线色都够深，提示框照样两位小数、留在图里", async () => {
    setUiFor("v2");
    const opt = await optionOf(<ForecastChart days={[100, 101, 102]} actual={[12, 13, null]} fitted={[12.954841603910417, 12.5, null]} forecast={[null, 13, 14]} origin={101} />);
    expect(opt.tooltip.backgroundColor).toBe(V2_CHART.tooltipBg);
    expect(opt.tooltip.confine).toBe(true);
    expect(opt.tooltip.valueFormatter(12.954841603910417)).toBe("12.95");
    expect(dark(opt.legend.textStyle.color)).toBe(true);
    for (const s of opt.series) if (s.lineStyle?.color) expect(luma(rgba(s.lineStyle.color))).toBeLessThan(150);
  }, 20000);

  it("预测图只在图例真会折行时才多留上边距：交易所抽屉里的四项图例在手机宽（约 340 px）上排得下一行，不再留“两行”的 64 px；推算页多一项“回看拟合”、排不下时才留；英文按英文的字长算", async () => {
    setUiFor("v2");
    type Media = { query: { maxWidth?: number; minWidth?: number }; option: { grid?: { top?: number } } };
    type Raw = { baseOption: { grid: { top: number } }; media?: Media[] };
    const rawOf = async (ui: ReactElement) => {
      vi.mocked(init).mockClear();
      const { unmount } = render(ui);
      await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
      const chart = vi.mocked(init).mock.results[0].value as { setOption: ReturnType<typeof vi.fn> };
      await waitFor(() => expect(chart.setOption).toHaveBeenCalled());
      const raw = chart.setOption.mock.calls[chart.setOption.mock.calls.length - 1][0] as Raw;
      unmount();
      return raw;
    };
    /** 宽 w 的图上实际的上边距：ECharts 按顺序叠用每一条命中的 media 规则。 */
    const topAt = (raw: Raw, w: number) =>
      (raw.media ?? [])
        .filter((m) => (m.query.maxWidth === undefined || w <= m.query.maxWidth) && (m.query.minWidth === undefined || w >= m.query.minWidth))
        .reduce((top, m) => m.option.grid?.top ?? top, raw.baseOption.grid.top);
    const band = { lo: [null, 12, 11], hi: [null, 12, 15] };
    // 交易所抽屉（MarketForecast）：九成五把握 / 八成把握 / 实际价格 / 预测
    const drawer = await rawOf(<ForecastChart days={[100, 101, 102]} actual={[12, 12, null]} forecast={[null, 12, 13]} band80={band} band95={band} origin={101} height={170} />);
    expect(topAt(drawer, 340)).toBe(40);
    expect(topAt(drawer, 600)).toBe(40);
    expect(topAt(drawer, 240)).toBe(64);
    // 推算页：多一项“回看拟合”，手机宽上折成两行
    const work = await rawOf(
      <ForecastChart days={[100, 101, 102]} actual={[12, 12, null]} fitted={[12, 12, null]} forecast={[null, 12, 13]} band80={band} band95={band} origin={101} />,
    );
    expect(topAt(work, 360)).toBe(64);
    expect(topAt(work, 1000)).toBe(40);
    // 英文的字长：桌面上一行，窄图两行
    setLocale("en");
    const en = await rawOf(<ForecastChart days={[100, 101, 102]} actual={[12, 12, null]} forecast={[null, 12, 13]} band80={band} band95={band} origin={101} height={170} />);
    expect(topAt(en, 600)).toBe(40);
    expect(topAt(en, 240)).toBe(64);
  }, 20000);
});

describe("触屏点按区（v2 样式表）", () => {
  // 样式表的原文（测试环境不处理 CSS，直接用 Node 读；路径放在变量里，免得 Vite 把 new URL(…) 改写成网页资源地址）
  const readText = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const SHEET = "../styles/ui-v2/analysis.css";
  const BASE = "../styles/ui-v2/base.css";
  type Rule = { selectors: string[]; body: string; at: string[]; pos: number };
  /** 拆出每一条规则：选择器（逗号拆开）、声明、外面套着的 @ 规则、在文件里的位置。 */
  const rulesOf = (text: string, at: string[] = [], offset = 0, out: Rule[] = []) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === "{") depth++;
        else if (text[j] === "}") depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith("@")) rulesOf(body, [...at, head], offset + open + 1, out);
      else out.push({ selectors: head.split(",").map((s) => s.trim().replace(/\s+/g, " ")), body, at, pos: offset + open });
      i = j;
    }
    return out;
  };

  it("本组每一个矮于 44 px 的可点控件，触屏（@media (pointer: coarse)）块里都有同一条选择器、写在它后面、把它撑到 --v2-h-touch（特异度相同、后写的赢；原来月报 / 年报、复盘的“返回预测簿”漏了）", () => {
    // 控件高度的令牌（base.css 里的值）
    const heights = Object.fromEntries([...readText(BASE).matchAll(/(--v2-h-[\w-]+):\s*(\d+)px/g)].map((m) => [m[1], Number(m[2])]));
    expect(heights["--v2-h-touch"]).toBe(44);
    const px = (v: string) => {
      const lit = v.match(/^(\d+(?:\.\d+)?)px$/);
      if (lit) return Number(lit[1]);
      const tok = v.match(/^var\((--v2-h-[\w-]+)\)$/);
      return tok ? heights[tok[1]] : Number.NaN;
    };
    const rules = rulesOf(readText(SHEET));
    const coarse = (r: Rule) => r.at.some((a) => /\(pointer:\s*coarse\)/.test(a));
    const touch = rules.filter((r) => coarse(r) && /(^|;)\s*min-height:\s*var\(--v2-h-touch\)/.test(r.body));
    expect(touch.length).toBeGreaterThan(0);
    // 不能点的：只是排版用的最小高度（推算页的本地商人名单、情报里进行中的事件）
    const notTappable = new Set([':root[data-ui="v2"] .pn-analysis .fc-merchants li', ':root[data-ui="v2"] .pn .pn-event']);
    const short: { selector: string; pos: number }[] = [];
    for (const r of rules) {
      if (coarse(r)) continue;
      const m = r.body.match(/(?:^|;)\s*min-height:\s*([^;]+)/);
      if (!m) continue;
      const h = px(m[1].trim());
      expect(Number.isNaN(h), `${r.selectors.join(", ")}：min-height ${m[1]}`).toBe(false);
      if (h >= heights["--v2-h-touch"]) continue;
      for (const selector of r.selectors) if (!notTappable.has(selector)) short.push({ selector, pos: r.pos });
    }
    expect(short.length).toBeGreaterThan(10);
    const missing = short.filter(({ selector, pos }) => !touch.some((t) => t.pos > pos && t.selectors.includes(selector))).map((s) => s.selector);
    expect(missing).toEqual([]);
    // 这一轮补上的几条
    const covered = touch.flatMap((t) => t.selectors);
    expect(covered).toContain(':root[data-ui="v2"] div.pn-reports > .tabbar .tab');
    expect(covered).toContain(':root[data-ui="v2"] .fc-review > .btn.small:first-child');
    expect(covered).toContain(':root[data-ui="v2"] .pn-analysis .fc-stale .btn.small');
  });
});
