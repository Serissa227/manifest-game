// T01 商馆、货档与商誉的界面：
// - 交易所买入页：商誉不够的货照样列出（置灰、排到后面），行里写“差多少商誉”，一键“去投资”切到港口投资页；
//   页头写明你在这里的商誉与买得到哪一档；成交单里不留锁着的货；手上的请托要的货注明“照卖”；
// - 港口投资页的商馆阶梯：现在几级、每级给什么、到下一级还差多少，一键升级提交 InvestPort；现金不够时写明差多少。
// 没有这些字段的旧后端（与没有这条规则的世界）界面照旧：原有的 trade*.test.tsx、open-market.test.tsx 不变。
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Market from "../components/panels/Market";
import { buyBlock, cartLines, EMPTY_CART, normalize, sortBuyRows, withLine, type Load } from "../components/panels/trade";
import { HouseLadder } from "../components/port/House";
import { setLocale } from "../i18n/locale";
import type { HouseView, PortView, StaticView } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, port, startedGame, statics } from "./fixtures";

const [grain, silk] = port.market;

/** 初始发展度 50 的港口：玩家有 1 级商馆（累计 5,000），声望 5，商誉 15——买得到行货，细货还差 15。 */
const house: HouseView = {
  level: 1,
  max_level: 4,
  reputation: 5,
  goodwill: 15,
  rank_goodwill: [0, 10, 30, 60],
  top_rank: 1,
  levels: [
    { level: 0, cost: 0, goodwill: 0, tax_bp: 10_000, storage: 0, top_rank: 0 },
    { level: 1, cost: 5_000, goodwill: 10, tax_bp: 10_000, storage: 100, top_rank: 1 },
    { level: 2, cost: 15_000, goodwill: 25, tax_bp: 8_500, storage: 200, top_rank: 2 },
    { level: 3, cost: 45_000, goodwill: 45, tax_bp: 7_000, storage: 300, top_rank: 2 },
    { level: 4, cost: 135_000, goodwill: 70, tax_bp: 5_000, storage: 300, top_rank: 3 },
  ],
  next_cost: 10_000,
  ally_share_bp: 4_000,
  ally_house: 4,
  depth_bp: 10_000,
  depth_next_bp: 10_240,
  decay_months: 6,
};

/** 谷物是粗货（照常买）；丝绸是细货，要商誉 30，现在差 15。 */
const ranked: PortView = {
  ...port,
  invest: { ...port.invest, mine: 5_000, share_bp: 10_000, house },
  market: [
    { ...silk, popular: false, sold: true, rank_need: 30, rank_short: 15 },
    { ...grain, sold: true },
  ],
};

const rankedStatics: StaticView = {
  ...statics,
  goods: statics.goods.map((g) => (g.id === silk.good ? { ...g, rank: 2 } : g)),
};

describe("货档：交易所买入页", () => {
  beforeEach(() => {
    setLocale("zh-CN");
    installIpc({ port: () => ranked, statics: () => rankedStatics });
    startedGame();
    useGame.setState({ statics: rankedStatics, facility: "market" });
  });

  it("锁着的货照样列出、置灰，写明差多少商誉；能买的货照常", async () => {
    render(<Market port={ranked} />);
    await userEvent.setup().click(screen.getByRole("tab", { name: /买入/ }));
    const locked = screen.getByTestId(`market-row-${silk.good}`);
    expect(locked).toHaveClass("mk-blocked");
    expect(within(locked).getByTestId(`mk-rank-why-${silk.good}`)).toHaveTextContent("差 15 商誉");
    expect(within(locked).getByTestId(`mk-rank-${silk.good}`)).toHaveTextContent("细货");
    // 锁着的行没有数量与“买满”
    expect(within(locked).queryByRole("spinbutton")).toBeNull();
    const open = screen.getByTestId(`market-row-${grain.good}`);
    expect(open).not.toHaveClass("mk-blocked");
    // 默认的顺序：买得了的在前，锁着的排到后面
    const rows = screen.getAllByTestId(/^market-row-\d+$/);
    expect(rows.map((r) => r.dataset.good)).toEqual([String(grain.good), String(silk.good)]);
  });

  it("页头写明你在这里的商誉与买得到哪一档，“去投资”一下切到港口投资页", async () => {
    const user = userEvent.setup();
    render(<Market port={ranked} />);
    await user.click(screen.getByRole("tab", { name: /买入/ }));
    const bar = screen.getByTestId("mk-rank-bar");
    expect(bar).toHaveTextContent("你在这里的商誉 15（声望 5 + 商馆 10），买得到行货及以下；还有 1 种货要更高的商誉。");
    await user.click(within(screen.getByTestId(`market-row-${silk.good}`)).getByRole("button", { name: "去投资" }));
    expect(useGame.getState().facility).toBe("invest");
    useGame.setState({ facility: "market" });
    await user.click(within(bar).getByRole("button", { name: "去投资" }));
    expect(useGame.getState().facility).toBe("invest");
  });

  it("内陆城市设不了商馆：只写原因，没有“去投资”", async () => {
    // 内陆城市：最高等级 0，阶梯里只有 0 级；商誉就是声望
    const cityHouse: HouseView = { ...house, level: 0, max_level: 0, goodwill: 15, reputation: 15, levels: [house.levels[0]], next_cost: null };
    const city: PortView = { ...ranked, invest: { ...ranked.invest, house: cityHouse } };
    render(<Market port={city} />);
    await userEvent.setup().click(screen.getByRole("tab", { name: /买入/ }));
    expect(screen.getByTestId("mk-rank-bar")).toHaveTextContent(
      "你在这里的商誉 15，买得到行货及以下；还有 1 种货要更高的商誉——内陆城市设不了商馆，只能靠声望。",
    );
    expect(screen.queryByRole("button", { name: "去投资" })).toBeNull();
    expect(screen.getByTestId(`mk-rank-why-${silk.good}`)).toHaveTextContent("差 15 商誉");
  });

  it("手上的请托要的货注明照卖；旧存档的宽限期写在页头", async () => {
    const errand: PortView = {
      ...ranked,
      invest: { ...ranked.invest, house: { ...house, grace_left: 120 } },
      market: [{ ...silk, popular: false, sold: true, rank_need: 30, rank_pass: "errand" }, { ...grain, sold: true }],
    };
    render(<Market port={errand} />);
    await userEvent.setup().click(screen.getByRole("tab", { name: /买入/ }));
    const row = screen.getByTestId(`market-row-${silk.good}`);
    expect(row).not.toHaveClass("mk-blocked");
    expect(row).toHaveTextContent("请托要的货，照卖");
    expect(screen.getByTestId("mk-rank-grace")).toHaveTextContent("旧存档的宽限期还剩 120 天");
    expect(screen.queryByTestId("mk-rank-bar")).toBeNull();
  });

  it("买不了的原因与成交单：货档排在禁运、许可证之后，锁着的货不进成交单", () => {
    const [lockedRow, openRow] = ranked.market;
    const goods = rankedStatics.goods;
    expect(buyBlock(ranked, lockedRow, goods[lockedRow.good])).toBe("rank");
    expect(buyBlock(ranked, { ...lockedRow, banned: true }, goods[lockedRow.good])).toBe("banned");
    expect(buyBlock(ranked, openRow, goods[openRow.good])).toBeNull();
    expect(buyBlock(ranked, { ...lockedRow, rank_short: null }, goods[lockedRow.good])).toBeNull();
    const load: Load = { cargo: [], used: 0, capacity: 100 };
    const rows = new Map(ranked.market.map((r) => [r.good, r]));
    const cart = withLine(withLine(EMPTY_CART, lockedRow.good, "buy", 3), openRow.good, "buy", 4);
    expect(cartLines(normalize(cart, load, rows, ranked, goods)).map((l) => l.good)).toEqual([openRow.good]);
    // 排序：默认把锁着的排到后面；按价格排序时照价格
    expect(sortBuyRows(ranked.market, "default").map((r) => r.good)).toEqual([openRow.good, lockedRow.good]);
    expect(sortBuyRows(ranked.market, "price").map((r) => r.good)).toEqual(
      [...ranked.market].sort((a, b) => a.price - b.price).map((r) => r.good),
    );
  });
});

describe("商馆：港口投资页的等级阶梯", () => {
  beforeEach(() => {
    setLocale("zh-CN");
  });

  it("写清现在几级、每级给什么、到下一级还差多少，一键升到下一级", async () => {
    const onInvest = vi.fn();
    render(<HouseLadder invest={ranked.invest} house={house} cash={50_000} min={1_000} onInvest={onInvest} />);
    expect(screen.getByTestId("house-level")).toHaveTextContent("1 级商馆");
    expect(screen.getByTestId("house-goodwill")).toHaveTextContent("15（声望 5 + 商馆 10）");
    expect(screen.getByTestId("house-top")).toHaveTextContent("行货及以下");
    const now = screen.getByTestId("house-row-1");
    expect(now).toHaveClass("is-now");
    expect(now).toHaveTextContent("现在");
    const next = screen.getByTestId("house-row-2");
    expect(next).toHaveClass("is-next");
    expect(next).toHaveTextContent("15,000");
    expect(next).toHaveTextContent("+25");
    expect(next).toHaveTextContent("细货");
    expect(next).toHaveTextContent("−15%");
    expect(next).toHaveTextContent("200");
    expect(screen.getByTestId("house-row-4")).toHaveTextContent("珍货");
    expect(screen.getByTestId("house-gap")).toHaveTextContent("到 2 级还差 10,000 金币");
    expect(screen.getByTestId("house-depth")).toHaveTextContent("×1，升级后约 ×1.02");
    expect(screen.getByTestId("house-ally")).toHaveTextContent("不低于 40%，并且商馆到 4 级");
    expect(screen.getByTestId("house-ally")).toHaveTextContent("现在：占有率 100%，商馆 1 级。");
    await userEvent.setup().click(screen.getByRole("button", { name: "升到 2 级（10,000 金币）" }));
    expect(onInvest).toHaveBeenCalledWith(10_000);
  });

  it("现金不够时按钮灰掉并写明差多少；差额不到最低投资额时按最低额投", async () => {
    const onInvest = vi.fn();
    const { rerender } = render(<HouseLadder invest={ranked.invest} house={house} cash={4_000} min={1_000} onInvest={onInvest} />);
    expect(screen.getByRole("button", { name: /升到 2 级/ })).toBeDisabled();
    expect(screen.getByTestId("house-short")).toHaveTextContent("现金不够：还差 6,000 金币");
    rerender(<HouseLadder invest={ranked.invest} house={{ ...house, next_cost: 300 }} cash={4_000} min={1_000} onInvest={onInvest} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "升到 2 级（1,000 金币）" }));
    expect(onInvest).toHaveBeenCalledWith(1_000);
  });

  it("到顶之后不再给升级；同盟港写明已经是你的", () => {
    const top: HouseView = { ...house, level: 4, top_rank: 3, goodwill: 75, next_cost: null, depth_next_bp: null };
    render(
      <HouseLadder invest={{ ...ranked.invest, ally_is_me: true, ally: "你" }} house={top} cash={0} min={1_000} onInvest={() => undefined} />,
    );
    expect(screen.getByTestId("house-max")).toHaveTextContent("商馆已经到顶。");
    expect(screen.queryByRole("button", { name: /升到/ })).toBeNull();
    expect(screen.getByTestId("house-top")).toHaveTextContent("全部货档");
    expect(screen.getByTestId("house-ally")).toHaveTextContent("这里已经是你的同盟港。");
  });
});
