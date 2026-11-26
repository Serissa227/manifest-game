// 开放市场（DECISIONS“开放市场”）：每个港口都收购所有的货，出售的以本地特产为主。
// 新后端的行情行带 sold / extra / nearest：买入页只列出售的货（页签数字跟着）、写明其余只收不卖；卖出页每一行都能卖；
// 明细写明最近的产地与“离产地越远出价越高”；“别处的价格”在买入页只看出售这种货的地方、便宜的在前，卖出页贵的在前；
// 掌柜问候里的货物数是出售的种数。旧后端的行没有这些字段：原有测试（trade.test.tsx、trade-desk.test.tsx）照旧。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import Market from "../components/panels/Market";
import { cartLines, EMPTY_CART, isSold, normalize, pickPlaces, saleRows, withLine, type Load } from "../components/panels/trade";
import { greetingCounts } from "../components/port/greeting";
import { setLocale } from "../i18n/locale";
import type { BookView, MarketRow, Overview, PortView } from "../ipc/types";
import { useGame } from "../store/game";
import { emptyBook, installIpc, overview, port, seriesFor, startedGame, statics } from "./fixtures";

const [grain, silk] = port.market;

/** 开放市场的港口：谷物是特产（出售）；丝绸只收不卖（清单以外，最近的产地柳湾 42 格）；火炮在清单里但不出售。 */
const open: PortView = {
  ...port,
  market: [
    { ...grain, sold: true },
    { ...silk, popular: false, sold: false, extra: true, nearest: [1, 42] },
    { ...grain, good: 2, price: 820, base_price: 400, stock: 12, target: 60, specialty: false, history: [800, 820], sold: false, nearest: [1, 42] },
  ],
};

/** 船上装着谷物 30、丝绸 4、火炮 2（开放市场下都能在这里卖；火炮要许可证）。 */
function withCargo(): Overview {
  return {
    ...overview,
    fleets: [
      {
        ...overview.fleets[0],
        used: 36,
        cargo: [
          { good: 0, qty: 30, avg_cost: 10 },
          { good: 1, qty: 4, avg_cost: 60 },
          { good: 2, qty: 2, avg_cost: 300 },
        ],
      },
    ],
  };
}

describe("开放市场：交易所", () => {
  beforeEach(() => {
    setLocale("zh-CN");
    installIpc({ port: () => open });
    startedGame();
  });

  it("买入页只列这里出售的货，页签写出售的种数，并说明别的货只收不卖", async () => {
    render(<Market port={open} />);
    expect(screen.getByRole("tab", { name: "买入（1）" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("market-row-0")).toBeInTheDocument();
    expect(screen.queryByTestId("market-row-1")).toBeNull();
    expect(screen.queryByTestId("market-row-2")).toBeNull();
    expect(screen.getByTestId("mk-sale-hint")).toHaveTextContent("这里出售 1 种货，以本地特产为主；别的货这里只收不卖");
  });

  it("卖出页：船上的货每一行都能卖（没有“此地不收”），“全部卖出”连只收不卖的货一起卖", async () => {
    useGame.setState({ overview: withCargo() });
    const calls = installIpc({ port: () => open, overview: () => withCargo() });
    const user = userEvent.setup();
    const licensed: PortView = { ...open, office: { ...open.office, license: true } };
    render(<Market port={licensed} />);
    expect(screen.getByRole("tab", { name: "卖出（3）" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByText("此地不收")).toBeNull();
    const silkRow = screen.getByTestId("sell-row-1");
    expect(within(silkRow).getByRole("button", { name: "全卖" })).toBeEnabled();
    expect(within(screen.getByTestId("sell-row-2")).getByRole("button", { name: "全卖" })).toBeEnabled();
    await user.click(screen.getByTestId("mk-sell-all"));
    await waitFor(() => expect(calls.mock.calls.filter(([cmd]) => cmd === "submit")).toHaveLength(3));
    const goods = calls.mock.calls.filter(([cmd]) => cmd === "submit").map(([, a]) => (a.command as { Sell: { good: number } }).Sell.good);
    expect(goods).toEqual([0, 1, 2]);
  });

  it("明细：只收不卖的货写明最近的产地与“离产地越远出价越高”；特产不写", async () => {
    useGame.setState({ overview: withCargo() });
    installIpc({ port: () => open, overview: () => withCargo() });
    const user = userEvent.setup();
    render(<Market port={open} />);
    await user.click(screen.getByTestId("sell-row-1"));
    const origin = await screen.findByTestId("mk-origin");
    expect(origin).toHaveTextContent("这里只收购、不出售这种货。");
    expect(origin).toHaveTextContent("最近的产地：柳湾（贸易距离约 42 格）——离产地越远，收购价越高。");
    await user.click(screen.getByTestId("sell-row-0"));
    await waitFor(() => expect(screen.queryByTestId("mk-origin")).toBeNull());
  });

  it("英文界面：页签、说明与产地", async () => {
    setLocale("en");
    useGame.setState({ overview: withCargo() });
    installIpc({ port: () => open, overview: () => withCargo() });
    const user = userEvent.setup();
    render(<Market port={open} />);
    await user.click(screen.getByRole("tab", { name: "Buy (1)" }));
    expect(screen.getByTestId("mk-sale-hint")).toHaveTextContent("This market sells 1 good, mostly local specialties");
    await user.click(screen.getByRole("tab", { name: "Sell (3)" }));
    await user.click(screen.getByTestId("sell-row-1"));
    expect(await screen.findByTestId("mk-origin")).toHaveTextContent("Nearest source: 柳湾 (about 42 cells by trade route).");
    setLocale("zh-CN");
  });

  it("别处的价格：买入页列出售这种货、便宜的在前；卖出页列贵的在前（新后端的预测簿带价格与出售清单）", async () => {
    const book: BookView = {
      ...emptyBook,
      places: [
        { loc: 0, goods: [0, 1, 2], prices: [11, 95, 820], sold: [0] },
        { loc: 1, goods: [0, 1, 2], prices: [9, 60, 700], sold: [1, 2] },
        { loc: 2, goods: [0, 1, 2], prices: [25, 150, 900], sold: [0] },
      ],
    };
    useGame.setState({ overview: withCargo() });
    const calls = installIpc({
      port: () => open,
      overview: () => withCargo(),
      forecast_book: () => book,
      market_series: (a) => seriesFor(a.loc as number, a.good as number, { price: book.places[a.loc as number].prices![a.good as number] }),
    });
    const user = userEvent.setup();
    render(<Market port={open} />);
    // 卖出页的丝绸：柳湾 60、兰城 150——贵的在前
    await user.click(screen.getByTestId("sell-row-1"));
    const sellElse = await screen.findByTestId("mk-elsewhere");
    expect(sellElse).toHaveTextContent("别处的收购价（高的在前）");
    const items = within(sellElse).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items[0]).toContain("兰城");
    expect(items[1]).toContain("柳湾");
    // 买入页的谷物：只看出售谷物的兰城（柳湾不卖谷物），不问柳湾的谷物行情
    await user.click(screen.getByRole("tab", { name: "买入（1）" }));
    calls.mockClear();
    await user.click(screen.getByTestId("market-row-0"));
    const buyElse = await screen.findByTestId("mk-elsewhere");
    expect(buyElse).toHaveTextContent("别处出售的价格（便宜的在前）");
    expect(within(buyElse).getAllByRole("listitem")).toHaveLength(1);
    expect(buyElse).toHaveTextContent("兰城");
    expect(calls).not.toHaveBeenCalledWith("market_series", { loc: 1, good: 0 });
  });
});

describe("开放市场：纯函数与问候", () => {
  const rows = new Map<number, MarketRow>(open.market.map((r) => [r.good, r]));
  const load: Load = { cargo: [{ good: 0, qty: 30, avg_cost: 10 }], used: 30, capacity: 100 };

  it("出售与否：新后端看 sold，旧后端的行都算出售", () => {
    expect(open.market.map(isSold)).toEqual([true, false, false]);
    expect(saleRows(open).map((r) => r.good)).toEqual([0]);
    expect(port.market.every(isSold)).toBe(true);
    expect(saleRows(port)).toHaveLength(2);
  });

  it("整理成交单：这里不出售的货买不了（去掉），卖得了", () => {
    let c = withLine(EMPTY_CART, 1, "buy", 5);
    c = withLine(c, 0, "sell", 10);
    const n = normalize(c, load, rows, { ...open, office: { ...open.office, license: true } }, statics.goods);
    expect(cartLines(n).map((l) => `${l.side}:${l.good}:${l.qty}`)).toEqual(["sell:0:10"]);
  });

  it("别处的价格挑哪几处：按价格排、买入只看出售的；旧后端没有价格时按地点顺序取", () => {
    const places: BookView["places"] = [
      { loc: 0, goods: [0, 1], prices: [11, 95], sold: [0] },
      { loc: 1, goods: [0, 1], prices: [9, 60], sold: [1] },
      { loc: 2, goods: [0, 1], prices: [25, 150], sold: [0, 1] },
      { loc: 3, goods: [0, 1], prices: [30, 40], sold: [] },
      { loc: 4, goods: [0, 1], prices: [30, 200], sold: [0] },
    ];
    const sell = pickPlaces(places, 0, 1, "sell");
    expect(sell).toEqual({ ranked: true, places: [places[4], places[2], places[1]] });
    const buy = pickPlaces(places, 0, 1, "buy");
    expect(buy.places.map((p) => p.loc)).toEqual([1, 2]);
    // 同价按地点编号
    expect(pickPlaces(places, 0, 0, "sell").places.map((p) => p.loc)).toEqual([3, 4, 2]);
    // 旧后端：没有价格与出售清单
    const old = places.map(({ loc, goods }) => ({ loc, goods }));
    expect(pickPlaces(old, 0, 1, "buy")).toEqual({ ranked: false, places: old.slice(1) });
  });

  it("交易所掌柜问候里的货物数是出售的种数（旧后端是全部）", () => {
    expect(greetingCounts("market", open).count).toBe(1);
    expect(greetingCounts("market", port).count).toBe(2);
  });
});
