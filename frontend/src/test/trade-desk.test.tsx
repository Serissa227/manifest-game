// 交易操作现代化（DECISIONS“交易操作现代化”）：交易所的交易台——每行直接调数量（加减、Shift ×10、长按连发、滚轮、拖动、键盘）、
// 成交单一次结清（先卖后买、逐行询价放宽限价、没成交的写在行上）、账台（合计、成交后的现金与装载、现金不够时写明并一键减到买得起）、
// 买不了卖不了的原因、查找与排序、持有者各自的成交单、成交的行闪一下、数字滚动、新手教程的锚点，以及 trade.ts 的纯函数。
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Market from "../components/panels/Market";
import PortPanel from "../components/panels/PortPanel";
import { RollingNumber } from "../components/panels/tradeKit";
import {
  buyBlock,
  buyCostEstimate,
  buyRoom,
  cartLines,
  curveFrom,
  EMPTY_CART,
  goodMatches,
  maxBuy,
  maxBuyImpact,
  normalize,
  sellBlock,
  sortBuyRows,
  summarize,
  withLine,
  type Cart,
  type Load,
} from "../components/panels/trade";
import { STEPS } from "../components/tutorial/steps";
import Tutorial from "../components/tutorial/Tutorial";
import { resetTutorial, useTutorial } from "../components/tutorial/tutorialState";
import { setLocale } from "../i18n/locale";
import type { Overview, PortView } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, port, quoteFor, seriesFor, startedGame, statics } from "./fixtures";

/** 船上装着谷物 30 件（此地收，成本 10）与火炮 5 件（此地不收）。 */
function withCargo(extra: Partial<Overview["fleets"][number]> = {}): Overview {
  return {
    ...overview,
    fleets: [
      {
        ...overview.fleets[0],
        used: 35,
        cargo: [
          { good: 0, qty: 30, avg_cost: 10 },
          { good: 2, qty: 5, avg_cost: 300 },
        ],
        ...extra,
      },
    ],
  };
}

const submits = (calls: ReturnType<typeof installIpc>) => calls.mock.calls.filter(([cmd]) => cmd === "submit").map(([, a]) => a.command);

/**
 * 交互多的用例在机器很忙时（几个工作树同时跑测试）会慢好几倍：单项给 15 秒；等询价、逐行成交这类一连串异步的结果给 4 秒。
 * 只是等得久一点，断言一条没少。
 */
const HEAVY = 15_000;
const SLOW = { timeout: 4_000 };

describe("交易台：每行直接调数量", { timeout: HEAVY }, () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    setLocale("zh-CN");
    calls = installIpc();
    startedGame();
  });

  it("加减按钮与输入框，Shift + 点击一次 10 件；数量记进成交单，账台写出合计与成交后的现金、装载；清空", async () => {
    const user = userEvent.setup();
    render(<PortPanel />);
    const row = await screen.findByTestId("market-row-0");
    // 空的成交单：账台只有现金与装载
    expect(screen.getByTestId("mk-load")).toHaveTextContent("现金 12,345 金币 · 装载 20 / 80");
    expect(screen.queryByTestId("mk-cart-sum")).toBeNull();
    const inc = within(row).getByRole("button", { name: /^多买 1 件/ });
    await user.click(inc);
    const qty = within(row).getByRole("spinbutton", { name: "谷物的买入数量" });
    expect(qty).toHaveValue(1);
    await user.keyboard("{Shift>}");
    await user.click(inc);
    await user.keyboard("{/Shift}");
    expect(qty).toHaveValue(11);
    await user.click(within(row).getByRole("button", { name: /^少买 1 件/ }));
    expect(qty).toHaveValue(10);
    // 直接打字（点一下全选）
    await user.clear(qty);
    await user.type(qty, "20");
    expect(qty).toHaveValue(20);
    expect(row).toHaveClass("staged");
    // 询价到了：这一行与账台都用询价的合计（20 件：240 + 税 12）
    await waitFor(() => expect(within(row).getByTestId("mk-line-0")).toHaveTextContent("−252"), SLOW);
    expect(calls).toHaveBeenCalledWith("quote", { request: { loc: 0, good: 0, side: "buy", qty: 20 } });
    expect(screen.getByTestId("mk-cart-sum")).toHaveTextContent("买入 1 种 −252");
    expect(screen.getByTestId("mk-load")).toHaveTextContent("现金 12,345 金币 → 12,093 金币 · 装载 20 → 40 / 80");
    expect(screen.getByTestId("mk-settle")).toHaveTextContent("成交 1 笔");
    // 买入的数量不超过舱位：再输 999 也只有 60
    fireEvent.change(qty, { target: { value: "999" } });
    expect(qty).toHaveValue(60);
    await user.click(screen.getByRole("button", { name: "清空" }));
    expect(qty).toHaveValue(0);
    expect(screen.queryByTestId("mk-cart-sum")).toBeNull();
    expect(submits(calls)).toEqual([]);
  });

  it("成交单一次结清：先卖后买，每一行询价后放宽 3% 限价提交；成交的行闪一下，成交单清空，提示合计与盈亏", async () => {
    useGame.setState({ overview: withCargo() });
    calls = installIpc({ overview: () => withCargo(), submit: () => ({ outcome: "Done", overview: withCargo() }) });
    const user = userEvent.setup();
    render(<PortPanel />);
    // 卖出页：谷物卖 10 件
    const grain = await screen.findByTestId("sell-row-0");
    const sellQty = within(grain).getByRole("spinbutton", { name: "谷物的卖出数量" });
    await user.clear(sellQty);
    await user.type(sellQty, "10");
    // 换到买入页：丝绸买 2 件（卖出页的数量还在成交单里）
    await user.click(screen.getByRole("tab", { name: "买入（2）" }));
    const silk = screen.getByTestId("market-row-1");
    await user.click(within(silk).getByRole("button", { name: /^多买 1 件/ }));
    await user.click(within(silk).getByRole("button", { name: /^多买 1 件/ }));
    await waitFor(() => expect(screen.getByTestId("mk-cart-sum")).toHaveTextContent("卖出 1 种 +95"), SLOW);
    expect(screen.getByTestId("mk-cart-sum")).toHaveTextContent("买入 1 种 −25");
    // 卖 10 件得 95，成本 100：盈亏 -5
    expect(screen.getByTestId("mk-cart-sum")).toHaveTextContent("盈亏 −5");
    calls.mockClear();
    await user.click(screen.getByTestId("mk-settle"));
    await waitFor(() => expect(useGame.getState().message).toBe("成交 2 笔：卖出 1 种，得 95 金币（盈亏 -5）；买入 1 种，花 25 金币"), SLOW);
    // 先卖后买；限价是询价放宽 3%
    expect(submits(calls)).toEqual([
      { Sell: { owner: "player", fleet: 0, good: 0, qty: 10, min_total: 92 } },
      { Buy: { owner: "player", fleet: 0, good: 1, qty: 2, max_total: 26 } },
    ]);
    // 询价在提交之前
    const order = calls.mock.calls.map(([cmd, a]) => (cmd === "quote" ? `quote:${(a.request as { good: number }).good}` : cmd)).filter((c) => c !== "port" && c !== "overview");
    expect(order.indexOf("quote:0")).toBeLessThan(order.indexOf("submit"));
    expect(screen.getByTestId("market-row-1")).toHaveClass("mk-flash");
    expect(screen.queryByTestId("mk-cart-sum")).toBeNull();
    expect(within(screen.getByTestId("market-row-1")).getByRole("spinbutton")).toHaveValue(0);
  });

  it("有一行没成交：原因写在那一行，别的行照常成交；没成交的留在成交单里，改了数量就把原因清掉", async () => {
    useGame.setState({ overview: withCargo() });
    calls = installIpc({
      overview: () => withCargo(),
      submit: (args) => {
        if ("Buy" in (args.command as object)) throw "命令被拒绝：现金不足";
        return { outcome: "Done", overview: withCargo() };
      },
    });
    const user = userEvent.setup();
    render(<PortPanel />);
    const grain = await screen.findByTestId("sell-row-0");
    await user.click(within(grain).getByRole("button", { name: /^多卖 1 件/ }));
    await user.click(screen.getByRole("tab", { name: "买入（2）" }));
    await user.click(within(screen.getByTestId("market-row-1")).getByRole("button", { name: /^多买 1 件/ }));
    await user.click(screen.getByTestId("mk-settle"));
    await waitFor(() => expect(screen.getByTestId("mk-note-1")).toHaveTextContent("现金不足"), SLOW);
    expect(useGame.getState().message).toContain("1 笔没成交，原因写在那一行");
    // 卖 1 件：10 − 税 1 = 9
    expect(useGame.getState().message).toContain("卖出 1 种，得 9 金币");
    // 没成交的丝绸还在成交单里；卖掉的谷物不在了
    const silk = screen.getByTestId("market-row-1");
    expect(within(silk).getByRole("spinbutton")).toHaveValue(1);
    expect(screen.getByTestId("mk-cart-sum")).toHaveTextContent("买入 1 种");
    expect(screen.getByTestId("mk-cart-sum")).not.toHaveTextContent("卖出");
    await user.click(within(silk).getByRole("button", { name: /^多买 1 件/ }));
    expect(screen.queryByTestId("mk-note-1")).toBeNull();
  });

  it("现金不够：账台写明差多少、“成交”不能点；“减到买得起”按询价找出买得起的件数", async () => {
    const poor = { ...overview, cash: 100 };
    useGame.setState({ overview: poor });
    // 询价比估价贵（每件 20）：估价以为买得起 8 件，询价要 160
    calls = installIpc({
      overview: () => poor,
      quote: (args) => {
        const req = args.request as { side: string; qty: number };
        return { ...quoteFor("Buy", req.qty), total: req.qty * 20 };
      },
    });
    const user = userEvent.setup();
    render(<PortPanel />);
    const row = await screen.findByTestId("market-row-0");
    const qty = within(row).getByRole("spinbutton", { name: "谷物的买入数量" });
    // 按估价（算上成交量对价格的冲击）最多 8 件：再多加不上去
    await user.clear(qty);
    await user.type(qty, "30");
    expect(qty).toHaveValue(8);
    await waitFor(() => expect(screen.getByTestId("mk-cart-warn")).toHaveTextContent("现金还差 60 金币"), SLOW);
    expect(screen.getByTestId("mk-settle")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "减到买得起" }));
    await waitFor(() => expect(qty).toHaveValue(5), SLOW);
    await waitFor(() => expect(screen.queryByTestId("mk-cart-warn")).toBeNull(), SLOW);
    expect(screen.getByTestId("mk-settle")).toBeEnabled();
    expect(submits(calls)).toEqual([]);
  });

  it("买不了、卖不了的行写明原因，没有加减按钮：禁运、没有许可证、此地不收", async () => {
    // 市场上有火炮（军需品，要许可证；没有办）、丝绸禁运
    const [grain, silk] = port.market;
    const here: PortView = {
      ...port,
      market: [grain, { ...silk, banned: true }, { ...grain, good: 2, price: 420, base_price: 400, stock: 30, target: 40, specialty: false, history: [400, 420] }],
    };
    installIpc({ port: () => here });
    render(<Market port={here} />);
    const banned = screen.getByTestId("market-row-1");
    expect(banned).toHaveTextContent("不许运出");
    expect(within(banned).queryByRole("button")).toBeNull();
    expect(within(banned).queryByRole("spinbutton")).toBeNull();
    const cannon = screen.getByTestId("market-row-2");
    expect(cannon).toHaveTextContent("先办许可证");
    expect(within(cannon).getByText("先办许可证")).toHaveAttribute("title", expect.stringContaining("势力办事处"));
    expect(within(cannon).queryByRole("button")).toBeNull();
    // 能买的行照常
    expect(within(screen.getByTestId("market-row-0")).getByRole("button", { name: /^买满/ })).toBeEnabled();
  });

  it("卖出页：没有许可证的军需品写明原因；此地不收的注明、没有按钮", async () => {
    const [grain] = port.market;
    const here: PortView = { ...port, market: [grain, { ...grain, good: 2, price: 420, base_price: 400, stock: 30, target: 40, specialty: false }] };
    useGame.setState({ overview: withCargo() });
    installIpc({ port: () => here, overview: () => withCargo() });
    render(<Market port={here} />);
    const cannon = screen.getByTestId("sell-row-2");
    expect(cannon).toHaveTextContent("先办许可证");
    expect(within(cannon).queryByRole("button")).toBeNull();
    // 没有许可证的货不算“此地收购”：全部卖出只卖谷物
    expect(screen.getByText("此地收购的货全部卖掉约得 314 金币")).toBeInTheDocument();
    // 办了许可证就能卖
    const licensed = { ...here, office: { ...here.office, license: true } };
    render(<Market port={licensed} />);
    expect(within(screen.getAllByTestId("sell-row-2")[1]).getByRole("button", { name: "全卖" })).toBeEnabled();
  });
});

describe("交易台：键盘、长按、滚轮与拖动", { timeout: HEAVY }, () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    setLocale("zh-CN");
    calls = installIpc();
    startedGame();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("↑↓ 选行，→ / ← 调数量（Shift ×10），空格展开明细，回车成交", async () => {
    const user = userEvent.setup();
    render(<PortPanel />);
    const first = await screen.findByTestId("market-row-0");
    // 同一时刻只有一行在 Tab 顺序里
    expect(first).toHaveAttribute("tabindex", "0");
    expect(screen.getByTestId("market-row-1")).toHaveAttribute("tabindex", "-1");
    act(() => first.focus());
    await user.keyboard("{ArrowDown}");
    const silk = screen.getByTestId("market-row-1");
    expect(silk).toHaveFocus();
    expect(silk).toHaveAttribute("tabindex", "0");
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(within(silk).getByRole("spinbutton")).toHaveValue(2);
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(within(silk).getByRole("spinbutton")).toHaveValue(12);
    await user.keyboard("{ArrowLeft}");
    expect(within(silk).getByRole("spinbutton")).toHaveValue(11);
    // “+ / −”一次一件（多数键盘上“+”本身要按 Shift，不算 ×10）
    await user.keyboard("{Shift>}+{/Shift}");
    expect(within(silk).getByRole("spinbutton")).toHaveValue(12);
    await user.keyboard("-");
    expect(within(silk).getByRole("spinbutton")).toHaveValue(11);
    await user.keyboard("{ArrowUp}");
    expect(first).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    // 空格：展开 / 收起明细
    await user.keyboard(" ");
    expect(silk).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("mk-qty")).toBeInTheDocument();
    await user.keyboard(" ");
    expect(silk).toHaveAttribute("aria-expanded", "false");
    // 回车：成交（11 件询价 132 + 税 7 = 139，限价放宽 3%：144）
    await user.keyboard("{Enter}");
    await waitFor(() => expect(submits(calls)).toEqual([{ Buy: { owner: "player", fleet: 0, good: 1, qty: 11, max_total: 144 } }]), SLOW);
  });

  it("输入框里：↑↓ 加减（Shift ×10），Home / End 到 0 与最多；获得焦点后滚轮加减，没焦点时滚轮不改数量", async () => {
    const user = userEvent.setup();
    render(<PortPanel />);
    const row = await screen.findByTestId("market-row-0");
    const qty = within(row).getByRole("spinbutton", { name: "谷物的买入数量" });
    act(() => qty.focus());
    await user.keyboard("{ArrowUp}{ArrowUp}{Shift>}{ArrowUp}{/Shift}");
    expect(qty).toHaveValue(12);
    await user.keyboard("{ArrowDown}");
    expect(qty).toHaveValue(11);
    await user.keyboard("{End}");
    expect(qty).toHaveValue(60);
    await user.keyboard("{Home}");
    expect(qty).toHaveValue(0);
    // 滚轮：向上 +1，Shift +10
    fireEvent.wheel(qty, { deltaY: -100 });
    fireEvent.wheel(qty, { deltaY: -100 });
    expect(qty).toHaveValue(2);
    fireEvent.wheel(qty, { deltaY: -100, shiftKey: true });
    expect(qty).toHaveValue(12);
    fireEvent.wheel(qty, { deltaY: 100 });
    expect(qty).toHaveValue(11);
    // 没有焦点：滚轮是滚动列表，不改数量
    act(() => qty.blur());
    fireEvent.wheel(qty, { deltaY: -100 });
    expect(qty).toHaveValue(11);
  });

  it("按住加号连发（越按越快），松开后不再多加；鼠标在输入框上左右拖动调数量", async () => {
    // jsdom 没有 PointerEvent：这一项临时补一个（带 button、clientX 与 pointerType），用完拿掉
    class FakePointerEvent extends MouseEvent {
      pointerType: string;
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? "mouse";
        this.pointerId = init.pointerId ?? 1;
      }
    }
    const had = "PointerEvent" in window;
    Object.defineProperty(window, "PointerEvent", { value: FakePointerEvent, configurable: true, writable: true });
    vi.useFakeTimers();
    try {
      await holdAndScrub(calls);
    } finally {
      if (!had) delete (window as unknown as Record<string, unknown>).PointerEvent;
    }
  });
});

async function holdAndScrub(calls: ReturnType<typeof installIpc>) {
  {
    render(<PortPanel />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const row = screen.getByTestId("market-row-0");
    const inc = within(row).getByRole("button", { name: /^多买 1 件/ });
    const qty = within(row).getByRole("spinbutton", { name: "谷物的买入数量" }) as HTMLInputElement;
    fireEvent.pointerDown(inc, { button: 0, pointerType: "touch" });
    act(() => vi.advanceTimersByTime(379));
    expect(qty).toHaveValue(0);
    // 380 毫秒后开始连发，每 70 毫秒一次
    act(() => vi.advanceTimersByTime(1 + 70 * 4));
    expect(qty).toHaveValue(5);
    // 连发十几次以后每次 5 件
    act(() => vi.advanceTimersByTime(70 * 10));
    const after = Number(qty.value);
    expect(after).toBeGreaterThanOrEqual(16);
    act(() => vi.advanceTimersByTime(70));
    expect(Number(qty.value) - after).toBe(5);
    fireEvent.pointerUp(inc);
    // 长按之后的那次点击不再加一
    fireEvent.click(inc);
    const held = Number(qty.value);
    act(() => vi.advanceTimersByTime(500));
    expect(Number(qty.value)).toBe(held);
    // 普通点击照常加一
    fireEvent.click(inc);
    expect(Number(qty.value)).toBe(held + 1);

    // 拖动：每 6 像素一件，向左减
    fireEvent.pointerDown(qty, { button: 0, pointerType: "mouse", clientX: 200 });
    fireEvent.pointerMove(qty, { pointerType: "mouse", clientX: 212 });
    expect(Number(qty.value)).toBe(held + 3);
    fireEvent.pointerMove(qty, { pointerType: "mouse", clientX: 188 });
    expect(Number(qty.value)).toBe(held - 1);
    fireEvent.pointerUp(qty, { pointerType: "mouse", clientX: 188 });
    expect(calls).not.toHaveBeenCalledWith("submit", expect.anything());
  }
}

describe("交易台：持有者、查找与排序、账台", { timeout: HEAVY }, () => {
  beforeEach(() => {
    setLocale("zh-CN");
    installIpc();
    startedGame();
  });

  it("持有者各自的成交单：切换舰队 / 商队时各自的数量都在，按钮上写着成交单有几行", async () => {
    const here: PortView = { ...port, caravans_here: [3] };
    const o: Overview = { ...overview, caravans: [{ id: 3, animal: 0, count: 4, guards: 1, at: 0, leg: null, dest: null, capacity: 80, cargo: [], daily_cost: 16 }] };
    useGame.setState({ overview: o });
    installIpc({ port: () => here, overview: () => o });
    const user = userEvent.setup();
    render(<Market port={here} />);
    await user.click(within(screen.getByTestId("market-row-0")).getByRole("button", { name: /^多买 1 件/ }));
    const fleetChip = screen.getByRole("button", { name: /^舰队 #0/ });
    expect(fleetChip).toHaveTextContent("单 1");
    await user.click(screen.getByRole("button", { name: /^商队 #3/ }));
    const qty = () => within(screen.getByTestId("market-row-0")).getByRole("spinbutton");
    expect(qty()).toHaveValue(0);
    // 商队装载 0 / 80
    expect(screen.getByTestId("mk-load")).toHaveTextContent("装载 0 / 80");
    await user.click(within(screen.getByTestId("market-row-0")).getByRole("button", { name: /^多买 1 件/ }));
    await user.click(within(screen.getByTestId("market-row-0")).getByRole("button", { name: /^多买 1 件/ }));
    await user.click(fleetChip);
    expect(qty()).toHaveValue(1);
    expect(screen.getByRole("button", { name: /^商队 #3/ })).toHaveTextContent("单 1");
  });

  it("成交单跟着实际收紧：刚用“全卖”卖掉的货不会留在成交单里", async () => {
    useGame.setState({ overview: withCargo() });
    // 全卖之后船上没有谷物了
    const sold = withCargo({ used: 5, cargo: [{ good: 2, qty: 5, avg_cost: 300 }] });
    installIpc({ overview: () => useGame.getState().overview, submit: () => ({ outcome: "Done", overview: sold }) });
    const user = userEvent.setup();
    render(<PortPanel />);
    const grain = await screen.findByTestId("sell-row-0");
    await user.click(within(grain).getByRole("button", { name: /^多卖 1 件/ }));
    expect(screen.getByTestId("mk-cart-sum")).toHaveTextContent("卖出 1 种");
    await user.click(within(grain).getByRole("button", { name: "全卖" }));
    await waitFor(() => expect(screen.queryByTestId("sell-row-0")).toBeNull(), SLOW);
    expect(screen.queryByTestId("mk-cart-sum")).toBeNull();
  });

  it("查找（名字、英文名、类别）与排序：比平常便宜的在前、价格、库存", async () => {
    const many: PortView = {
      ...port,
      market: [
        ...port.market,
        { ...port.market[0], good: 3, price: 30, base_price: 60, stock: 50, target: 100 },
        { ...port.market[0], good: 4, price: 5, base_price: 4, stock: 5000, target: 1000 },
        { ...port.market[0], good: 5, price: 7, base_price: 7, stock: 10, target: 100 },
        { ...port.market[0], good: 6, price: 8, base_price: 8, stock: 11, target: 100 },
        { ...port.market[0], good: 7, price: 9, base_price: 9, stock: 12, target: 100 },
        { ...port.market[0], good: 8, price: 10, base_price: 10, stock: 13, target: 100 },
      ],
    };
    const more = {
      ...statics,
      goods: [
        ...statics.goods,
        ...[3, 4, 5, 6, 7, 8].map((id) => ({ id, key: `g${id}`, name: `货${id}`, name_en: `Ware ${id}`, category: id === 3 ? "香料" : "杂货", tier: 0, base_price: 10, license: false, description: "" })),
      ],
    };
    useGame.setState({ statics: more });
    const user = userEvent.setup();
    render(<Market port={many} />);
    const ids = () => screen.getAllByTestId(/^market-row-/).map((r) => r.getAttribute("data-good"));
    expect(ids()).toEqual(["0", "1", "3", "4", "5", "6", "7", "8"]);
    await user.selectOptions(screen.getByRole("combobox", { name: "排序" }), "cheap");
    // 相对基准：货3 0.5、谷物 0.92、其余 1、货4 1.25、丝绸 1.06
    expect(ids().slice(0, 2)).toEqual(["3", "0"]);
    expect(ids().at(-1)).toBe("4");
    await user.selectOptions(screen.getByRole("combobox", { name: "排序" }), "stock");
    expect(ids()[0]).toBe("4");
    await user.selectOptions(screen.getByRole("combobox", { name: "排序" }), "price");
    expect(ids()[0]).toBe("4");
    await user.type(screen.getByRole("searchbox", { name: "找商品" }), "ware 3");
    expect(ids()).toEqual(["3"]);
    await user.clear(screen.getByRole("searchbox", { name: "找商品" }));
    await user.type(screen.getByRole("searchbox", { name: "找商品" }), "香料");
    expect(ids()).toEqual(["3"]);
    await user.clear(screen.getByRole("searchbox", { name: "找商品" }));
    await user.type(screen.getByRole("searchbox", { name: "找商品" }), "没有这种货");
    expect(screen.getByTestId("mk-no-match")).toHaveTextContent("没有找到“没有这种货”");
  });

  it("“买满”算上成交量对价格的冲击：库存少、买得多时按价格曲线估算买得起几件", async () => {
    // 库存 100、目标 120 的丝绸，现金 5000：按现价估 50 件，算上涨价只买得起更少
    const o = { ...overview, cash: 5000 };
    useGame.setState({ overview: o });
    installIpc({ overview: () => o });
    render(<Market port={port} />);
    const silk = screen.getByTestId("market-row-1");
    const naive = maxBuy(port, port.market[1], 5000, 60).qty;
    await waitFor(() => {
      const label = within(silk).getByRole("button", { name: /^买满/ }).textContent ?? "";
      expect(Number(label.replace(/\D/g, ""))).toBeLessThan(naive);
    }, SLOW);
  });

  it("账台的数字滚动到新值；系统要求减少动态效果时直接跳到新值", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const listeners: Array<() => void> = [];
    let reduce = false;
    window.matchMedia = ((q: string) => ({
      matches: q.includes("reduce") ? reduce : false,
      media: q,
      addEventListener: (_: string, f: () => void) => listeners.push(f),
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      const fmt = (v: number) => `${v}`;
      const { rerender, unmount } = render(<RollingNumber value={100} format={fmt} />);
      expect(screen.getByText("100")).toBeInTheDocument();
      rerender(<RollingNumber value={200} format={fmt} />);
      act(() => vi.advanceTimersByTime(100));
      const mid = Number(document.querySelector(".rolling")?.textContent);
      expect(mid).toBeGreaterThan(100);
      expect(mid).toBeLessThan(200);
      expect(document.querySelector(".rolling")).toHaveClass("rolling-up");
      act(() => vi.advanceTimersByTime(500));
      expect(document.querySelector(".rolling")).toHaveTextContent("200");
      unmount();
      reduce = true;
      const again = render(<RollingNumber value={100} format={fmt} />);
      again.rerender(<RollingNumber value={300} format={fmt} />);
      expect(document.querySelector(".rolling")).toHaveTextContent("300");
    } finally {
      // @ts-expect-error 测试环境本来没有 matchMedia
      delete window.matchMedia;
      vi.useRealTimers();
    }
  });
});

describe("交易台：新手教程的锚点", { timeout: HEAVY }, () => {
  beforeEach(() => {
    setLocale("zh-CN");
    installIpc();
    startedGame();
    resetTutorial();
  });

  it("交易所、账台、买货、卖货几步圈的元素都在交易所里；船上有货时“账台”“买货”两步把交易所切到买入页", async () => {
    useGame.setState({ overview: { ...withCargo(), day: 0 } });
    installIpc({ overview: () => withCargo() });
    render(
      <>
        <PortPanel />
        <Tutorial />
      </>,
    );
    // 有货：交易所默认打开卖出页
    expect(await screen.findByTestId("mk-sell")).toBeInTheDocument();
    const step = (id: string) => STEPS.findIndex((s) => s.id === id);
    const target = (id: string) => document.querySelector(STEPS[step(id)].target as string);
    const market = () => screen.getByTestId("market");
    act(() => useTutorial.getState().go(step("market")));
    expect(target("market")).toBe(market());
    act(() => useTutorial.getState().go(step("cart")));
    await waitFor(() => expect(screen.getByTestId("mk-buy")).toBeInTheDocument(), SLOW);
    expect(target("cart")).toBe(screen.getByTestId("mk-cart"));
    expect(market()).toContainElement(target("cart") as HTMLElement);
    act(() => useTutorial.getState().go(step("buy")));
    expect(target("buy")).toBe(screen.getByTestId("mk-buy"));
    act(() => useTutorial.getState().go(step("sell")));
    expect(target("sell")).toBe(within(market()).getByRole("tablist", { name: "交易" }));
    // 教程请求的换页只用一次：玩家自己点回卖出页后不会被再切走
    await userEvent.click(screen.getByRole("tab", { name: "卖出（2）" }));
    expect(screen.getByTestId("mk-sell")).toBeInTheDocument();
  });
});

describe("交易台的纯函数（trade.ts）", () => {
  const load: Load = { cargo: [{ good: 0, qty: 30, avg_cost: 10 }], used: 35, capacity: 80 };
  const rows = new Map(port.market.map((r) => [r.good, r]));

  it("成交单：设定一行、同一种货只有一个方向、0 删掉；先卖后买；买入的舱位算上要卖的", () => {
    let c: Cart = EMPTY_CART;
    c = withLine(c, 1, "buy", 5);
    c = withLine(c, 0, "sell", 10);
    expect(cartLines(c).map((l) => `${l.side}:${l.good}:${l.qty}`)).toEqual(["sell:0:10", "buy:1:5"]);
    // 在买入页调谷物：取代卖出
    expect(cartLines(withLine(c, 0, "buy", 3)).map((l) => `${l.side}:${l.good}`)).toEqual(["buy:0", "buy:1"]);
    expect(withLine(c, 1, "sell", 0)).toBe(c);
    expect(cartLines(withLine(c, 1, "buy", 0))).toHaveLength(1);
    // 空位 45 + 卖出腾出的 10，减去别的要买的 5（算自己时不减自己）
    expect(buyRoom(load, c, 0, 900)).toBe(50);
    expect(buyRoom(load, c, 1, 900)).toBe(55);
    expect(buyRoom(load, c, 1, 20)).toBe(20);
  });

  it("整理成交单：卖出不超过持有，买入不超过库存与舱位，此地不收、禁运、缺许可证的去掉", () => {
    let c: Cart = EMPTY_CART;
    c = withLine(c, 0, "sell", 99);
    c = withLine(c, 1, "buy", 999);
    c = withLine(c, 2, "sell", 1);
    const n = normalize(c, load, rows, port, statics.goods);
    expect(cartLines(n).map((l) => `${l.side}:${l.good}:${l.qty}`)).toEqual(["sell:0:30", "buy:1:75"]);
    const banned = new Map(rows);
    banned.set(1, { ...rows.get(1)!, banned: true });
    expect(cartLines(normalize(c, load, banned, port, statics.goods)).map((l) => l.good)).toEqual([0]);
  });

  it("合计：询价到了用询价，否则用估价；盈亏按成本；现金差多少、舱位超出多少", () => {
    const lines = cartLines(withLine(withLine(EMPTY_CART, 0, "sell", 10), 1, "buy", 5));
    const s = summarize(lines, (l) => (l.side === "sell" ? quoteFor("Sell", l.qty) : undefined), (l) => (l.side === "buy" ? 500 : 0), 100, load);
    expect(s).toMatchObject({ sells: 1, buys: 1, sellTotal: 95, buyTotal: 500, profit: -5, cashAfter: -305, usedAfter: 30, exact: false, shortCash: 305, overSpace: 0 });
  });

  it("买不了、卖不了的原因；查找与排序", () => {
    const [grain, silk] = port.market;
    expect(buyBlock(port, grain, statics.goods[0])).toBeNull();
    expect(buyBlock(port, { ...silk, banned: true }, statics.goods[1])).toBe("banned");
    expect(buyBlock(port, grain, statics.goods[2])).toBe("license");
    expect(buyBlock({ ...port, office: { ...port.office, license: true } }, grain, statics.goods[2])).toBeNull();
    expect(sellBlock(port, undefined, statics.goods[0])).toBe("notTraded");
    expect(sellBlock(port, grain, statics.goods[2])).toBe("license");
    expect(goodMatches(statics.goods[0], " 谷 ")).toBe(true);
    expect(goodMatches(statics.goods[0], "GRAIN")).toBe(true);
    expect(goodMatches(statics.goods[0], "丝")).toBe(false);
    expect(sortBuyRows(port.market, "cheap").map((r) => r.good)).toEqual([0, 1]);
    expect(sortBuyRows(port.market, "price").map((r) => r.good)).toEqual([0, 1]);
    expect(sortBuyRows(port.market, "stock").map((r) => r.good)).toEqual([0, 1]);
    expect(sortBuyRows([...port.market].reverse(), "default").map((r) => r.good)).toEqual([1, 0]);
  });

  it("成交量对价格的冲击：与内核同一条价格曲线沿库存走价；少量时与按现价估算相同，库存紧时买得越多越贵", () => {
    const curve = curveFrom(seriesFor(0, 0))!;
    // 谷物基准价 12：下限 2、上限 60
    expect(curve.floor).toBeCloseTo(2 / 12);
    expect(curve.cap).toBe(5);
    const [grain, silk] = port.market;
    // 1 件：几乎就是现价（含税）
    expect(buyCostEstimate(port, grain, 1, curve)).toBeCloseTo(11 * 1.05, 0);
    // 买得越多越贵（均价上升）
    const avg = (n: number) => buyCostEstimate(port, silk, n, curve) / n;
    expect(avg(60)).toBeGreaterThan(avg(10));
    // 现金 1000 买丝绸：按现价估 10 件，算上涨价 9 件
    expect(maxBuy(port, silk, 1000, 60)).toEqual({ qty: 10, limit: "cash" });
    expect(maxBuyImpact(port, silk, 1000, 60, curve)).toEqual({ qty: 9, limit: "cash" });
    // 舱位、库存是硬上限；没有曲线时退回按现价估算
    expect(maxBuyImpact(port, grain, 1e9, 60, curve)).toEqual({ qty: 60, limit: "space" });
    expect(maxBuyImpact(port, { ...grain, stock: 3 }, 1e9, 60, curve)).toEqual({ qty: 3, limit: "stock" });
    expect(maxBuyImpact(port, silk, 1000, 60, null)).toEqual(maxBuy(port, silk, 1000, 60));
    expect(curveFrom(null)).toBeNull();
  });
});
