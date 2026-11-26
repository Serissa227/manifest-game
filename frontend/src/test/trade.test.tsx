// 测试 13：现货交易（模拟的 Tauri IPC）——交易所分卖出 / 买入两页，一键全部卖出、一键买满，
// 选中一行后可调数量（滑块、输入框、快捷按钮）并确认；成交前重新询价，以放宽 3% 的询价为限价。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import PortPanel from "../components/panels/PortPanel";
import { maxBuy, unitEstimate } from "../components/panels/trade";
import type { Overview } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, port, quoteFor, startedGame } from "./fixtures";

const portNoHolder = { ...port, fleets_here: [] };

/** 船上装着谷物（此地收）与火炮（此地不收）。 */
function withCargo(): Overview {
  return {
    ...overview,
    fleets: [
      {
        ...overview.fleets[0],
        used: 35,
        cargo: [
          { good: 2, qty: 5, avg_cost: 300 },
          { good: 0, qty: 30, avg_cost: 10 },
        ],
      },
    ],
  };
}

describe("现货交易", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc();
    startedGame();
  });

  it("船上没货时打开买入页：行情、标签与每行的“买满”（按现金、舱位与库存算最多件数）", async () => {
    const user = userEvent.setup();
    render(<PortPanel />);
    expect(await screen.findByText("谷物")).toBeInTheDocument();
    expect(calls).toHaveBeenCalledWith("port", { loc: 0 });
    expect(screen.getByText("特产")).toBeInTheDocument();
    expect(screen.getByText("流行")).toBeInTheDocument();
    expect(screen.getByText("交易税率 5%", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "买入（2）" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "卖出（0）" })).toBeInTheDocument();
    expect(screen.getByTestId("mk-load")).toHaveTextContent("现金 12,345 金币 · 装载 20 / 80");
    // 货舱只剩 60：两种商品都最多买 60 件
    const row = screen.getByTestId("market-row-0");
    await user.click(within(row).getByRole("button", { name: "买满 60" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("quote", { request: { loc: 0, good: 0, side: "buy", qty: 60 } }));
    // 询价 756，限价放宽 3%：779
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { Buy: { owner: "player", fleet: 0, good: 0, qty: 60, max_total: 779 } } }),
    );
    expect(useGame.getState().message).toBe("买入谷物 60 件，花 756 金币");
    expect(useGame.getState().error).toBeNull();
  });

  it("选中一行：调数量（输入框、快捷按钮）、看成交预估，确认后以放宽的限价提交", async () => {
    const user = userEvent.setup();
    render(<PortPanel />);
    await user.click(await screen.findByTestId("market-row-0"));
    const form = screen.getByTestId("mk-qty");
    const qty = within(form).getByLabelText("数量");
    await user.clear(qty);
    await user.type(qty, "20");
    await waitFor(() =>
      expect(screen.getByTestId("preview-buy")).toHaveTextContent("均价 12 金币，税 12 金币，合计 252 金币；成交后价格 11 → 13"),
    );
    expect(calls).toHaveBeenCalledWith("quote", { request: { loc: 0, good: 0, side: "buy", qty: 20 } });
    await user.click(within(form).getByRole("button", { name: "买入 20 件 · 252 金币" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { Buy: { owner: "player", fleet: 0, good: 0, qty: 20, max_total: 260 } } }),
    );
    // 快捷按钮：一半
    await user.click(within(form).getByRole("button", { name: "一半" }));
    expect(within(form).getByLabelText("数量")).toHaveValue(30);
    expect(within(form).getByRole("button", { name: "一半" })).toHaveAttribute("aria-pressed", "true");
  });

  it("有货时打开卖出页：此地收的货带收购价、盈亏与“全卖”，不收的也列出并注明；页头一次全部卖出", async () => {
    useGame.setState({ overview: withCargo() });
    calls = installIpc({ overview: () => withCargo() });
    const user = userEvent.setup();
    render(<PortPanel />);
    expect(await screen.findByRole("tab", { name: "卖出（2）" })).toHaveAttribute("aria-selected", "true");
    // 此地收的排在前面
    const rows = within(screen.getByTestId("mk-sell")).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveAttribute("data-testid", "sell-row-0");
    const grain = screen.getByTestId("sell-row-0");
    expect(grain).toHaveTextContent("30");
    // 收购价按现价扣 5% 税估算：11 × 0.95 ≈ 10.45；比成本 10 高约 0.45 × 30 件
    expect(screen.getByTestId("sell-profit-0")).toHaveTextContent("+13");
    const cannon = screen.getByTestId("sell-row-2");
    expect(cannon).toHaveTextContent("此地不收");
    expect(within(cannon).queryByRole("button")).toBeNull();
    expect(screen.getByText("此地收购的货全部卖掉约得 314 金币")).toBeInTheDocument();

    await user.click(within(grain).getByRole("button", { name: "全卖" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("quote", { request: { loc: 0, good: 0, side: "sell", qty: 30 } }));
    // 询价 285，限价放宽 3%：276
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { Sell: { owner: "player", fleet: 0, good: 0, qty: 30, min_total: 276 } } }),
    );
    expect(useGame.getState().message).toBe("卖出谷物 30 件，得 285 金币（盈亏 -15）");

    // 页头的“全部卖出”：只卖此地收的
    useGame.setState({ overview: withCargo() });
    calls.mockClear();
    await user.click(await screen.findByTestId("mk-sell-all"));
    await waitFor(() => expect(useGame.getState().message).toBe("卖出 1 种货物，共得 285 金币"));
    const sells = calls.mock.calls.filter(([cmd]) => cmd === "submit");
    expect(sells).toHaveLength(1);
    expect(sells[0][1]).toEqual({ command: { Sell: { owner: "player", fleet: 0, good: 0, qty: 30, min_total: 276 } } });
  });

  // 需求变更（交易操作现代化，见 DECISIONS）：明细里的数量就是这一行在成交单里的数量，打开明细不往成交单里放东西，
  // 所以打开时是 0（原来缺省是全部）；“全部”一按就是持有的件数。其余断言照旧，另加“明细紧跟在这一行下面”。
  it("卖出页里选中一行：明细就在这一行下面，打开时数量是 0（不往成交单里放东西），“全部”是持有的件数，可以只卖一部分；选中此地不收的货只给说明", async () => {
    useGame.setState({ overview: withCargo() });
    // 成交后货还在（只卖了一部分）
    calls = installIpc({ overview: () => withCargo(), submit: () => ({ outcome: "Done", overview: withCargo() }) });
    const user = userEvent.setup();
    render(<PortPanel />);
    await user.click(await screen.findByTestId("sell-row-0"));
    const form = screen.getByTestId("mk-qty");
    expect(screen.getByTestId("sell-row-0").nextElementSibling).toContainElement(screen.getByTestId("trade-form"));
    expect(within(form).getByLabelText("数量")).toHaveValue(0);
    expect(within(form).getByRole("button", { name: "先选数量" })).toBeDisabled();
    expect(screen.queryByTestId("mk-cart-sum")).toBeNull();
    await user.click(within(form).getByRole("button", { name: "全部" }));
    expect(within(form).getByLabelText("数量")).toHaveValue(30);
    expect(within(form).getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
    await user.click(within(form).getByRole("button", { name: "一半" }));
    // 询价 15 件：150 − 税 8 = 142；比成本少 8
    await waitFor(() => expect(screen.getByTestId("preview-sell")).toHaveTextContent("合计 142 金币"));
    expect(screen.getByTestId("preview-profit")).toHaveTextContent("-8");
    await user.click(within(form).getByRole("button", { name: "卖出 15 件 · 得 142 金币" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { Sell: { owner: "player", fleet: 0, good: 0, qty: 15, min_total: 137 } } }),
    );
    await user.click(screen.getByTestId("sell-row-2"));
    expect(screen.getByTestId("mk-not-traded")).toHaveTextContent("这里的交易所不收这种货");
  });

  it("命令被内核拒绝时显示错误", async () => {
    calls = installIpc({
      submit: () => {
        throw "命令被拒绝：现金不足";
      },
    });
    const user = userEvent.setup();
    render(<PortPanel />);
    const row = await screen.findByTestId("market-row-1");
    await user.click(within(row).getByRole("button", { name: /^买满/ }));
    await waitFor(() => expect(useGame.getState().error).toContain("现金不足"));
  });

  it("此地没有舰队、商队或仓库时不能交易：写明原因，没有买卖按钮", async () => {
    useGame.setState({ overview: { ...overview, fleets: [] } });
    installIpc({ port: () => ({ ...portNoHolder }) });
    const user = userEvent.setup();
    render(<PortPanel />);
    expect(await screen.findAllByText("此地没有你的舰队、商队或仓库，无法交易")).not.toHaveLength(0);
    expect(within(screen.getByTestId("market-row-0")).queryByRole("button")).toBeNull();
    await user.click(screen.getByTestId("market-row-0"));
    expect(screen.queryByTestId("mk-qty")).toBeNull();
  });

  it("买满的件数：按含税估价受现金、舱位、库存中最紧的一项限制；询价超出现金时减少件数再问", async () => {
    const row = port.market[1];
    expect(unitEstimate(port, row, "buy")).toBeCloseTo(99.75);
    expect(unitEstimate(port, row, "sell")).toBeCloseTo(90.25);
    expect(maxBuy(port, row, 12_345, 60)).toEqual({ qty: 60, limit: "space" });
    expect(maxBuy(port, row, 1_000, 60)).toEqual({ qty: 10, limit: "cash" });
    expect(maxBuy(port, { ...row, stock: 3 }, 12_345, 60)).toEqual({ qty: 3, limit: "stock" });
    // 议价：买入降价、卖出按一半加价；进口关税乘在税率上
    const bargain = { ...port, bargain: [0.1, 30] as [number, number] };
    expect(unitEstimate(bargain, row, "buy")).toBeCloseTo(95 * 0.9 * 1.05);
    expect(unitEstimate(port, { ...row, import_tax_bp: 20_000 }, "sell")).toBeCloseTo(95 * 0.9);

    // 现金只有 100：估价能买 8 件，询价 8 件要 101（超出），按比例减到 7 件再问
    const poor = { ...overview, cash: 100 };
    useGame.setState({ overview: poor });
    installIpc({
      overview: () => poor,
      quote: (args) => {
        const req = args.request as { qty: number };
        return { ...quoteFor("Buy", req.qty), total: req.qty === 8 ? 101 : req.qty * 12 };
      },
    });
    const user = userEvent.setup();
    render(<PortPanel />);
    const grain = await screen.findByTestId("market-row-0");
    await user.click(within(grain).getByRole("button", { name: "买满 8" }));
    await waitFor(() => expect(useGame.getState().message).toBe("买入谷物 7 件，花 84 金币"));
  });
});
