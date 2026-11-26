// 港口的其余设施在新界面（v2，docs/UI-REDESIGN.md 第 8、9 节）下多出的小结构：
// 空状态的说明与“下一步”（酒馆没有航海士、没有造船厂、没有期货交易所、近期没有拍卖会）、银行与港口投资的快捷金额与写清金额的按钮、
// 装卸台只有一处能放货时一键租仓库、道具店里“买”灰掉的原因、交易所账台的快捷键小键帽；
// 以及旧界面（v1）下这些地方维持原样（原来的字与元素，DOM 里没有任何 v2 的类）。模拟的 Tauri IPC，不调用任何真实服务。
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AuctionPanel from "../components/items/AuctionPanel";
import ShopPanel from "../components/items/ShopPanel";
import CartBar from "../components/panels/CartBar";
import PortPanel from "../components/panels/PortPanel";
import { useShell } from "../components/shell/shellState";
import { t } from "../i18n";
import { setLocale } from "../i18n/locale";
import type { ItemLine, PortView, ShopView } from "../ipc/types";
import { useGame, type PortPage } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { installIpc, overview, port, startedGame } from "./fixtures";

function setUiFor(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

/** 页面里 v2 开头的类。 */
const v2Classes = () => [...document.querySelectorAll("[class]")].flatMap((el) => [...el.classList]).filter((c) => /^v2(-|$)/.test(c));

/** 打开港口窗口的某一页（港口数据在 fixtures 的澄港上改）。 */
function openPort(facility: PortPage, over: Partial<PortView> = {}, loc = 0) {
  const calls = installIpc({ port: () => ({ ...port, ...over, loc }) });
  startedGame();
  useGame.setState({ facility, selectedLoc: loc });
  useShell.setState({ windowOpen: false });
  render(<PortPanel />);
  return calls;
}

const bankPort: Partial<PortView> = {
  bank: { ...port.bank, deposit: 6000, loans: [{ id: 3, principal: 5000, rate_bp: 900, start_day: 0, due_day: 180, overdue: false }] },
};

beforeEach(() => {
  setLocale("zh-CN");
  useGame.setState({ message: null, error: null });
});
afterEach(() => {
  cleanup();
  setUiFor("v1");
  vi.restoreAllMocks();
});

/**
 * 模拟手机上一行放不下、左右滑动的设施分页（jsdom 不排版）：分页条在正文宽度里（14–376），每个小签 72 宽、间隔 80，
 * 位置随分页条的 scrollLeft 移动；返回分页条与“当前小签在不在可见范围里”。
 */
function fakeScrollingTabs() {
  const bar = () => document.querySelector<HTMLElement>(".port > .tabbar");
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("tabbar") ? 362 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("tabbar") ? this.children.length * 80 : 0;
  });
  const rect = (left: number, width: number) => ({ left, right: left + width, width, top: 0, bottom: 44, height: 44, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const b = bar();
    if (this === b) return rect(14, 362);
    if (b && this.parentElement === b) return rect(14 + [...b.children].indexOf(this) * 80 - b.scrollLeft, 72);
    return rect(0, 0);
  });
  const activeInView = () => {
    const b = bar();
    const a = b?.querySelector(".tab.active");
    if (!b || !a) return false;
    const r = a.getBoundingClientRect();
    return r.left >= 14 && r.right <= 376;
  };
  return { bar, activeInView };
}

describe("旧界面（v1）维持原样", () => {
  beforeEach(() => setUiFor("v1"));

  it("酒馆没有航海士、没有期货交易所：还是原来那一句，没有“下一步”", async () => {
    openPort("tavern", { mates_here: [] });
    const empty = await screen.findByText("本港酒馆暂时没有航海士");
    expect(empty.tagName).toBe("P");
    expect(empty).toHaveClass("empty");
    expect(screen.queryByRole("button", { name: "看看别处的航海士" })).toBeNull();
    expect(screen.queryByText("按人数")).toBeNull();
    expect(v2Classes()).toEqual([]);
    cleanup();
    openPort("exchange", { exchange: null });
    const none = await screen.findByText("无");
    expect(none).toHaveClass("empty");
    expect(screen.queryByRole("button", { name: "打开期货" })).toBeNull();
    expect(v2Classes()).toEqual([]);
  });

  it("银行：按钮还是“存入 / 取出 / 借款 / 还款”，没有快捷金额", async () => {
    openPort("bank", bankPort);
    await screen.findByTestId("bank");
    for (const name of ["存入", "取出", "借款", "还款"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "快捷金额" })).toBeNull();
    expect(screen.getByTestId("bank").querySelector(".bk-desk, .bk-loans")).toBeNull();
    expect(v2Classes()).toEqual([]);
  });

  it("仓库：只有一处能放货时是原来的说明，没有租仓库的按钮；账台的键盘提示是一行字", async () => {
    openPort("warehouse");
    expect(await screen.findByTestId("tr-need")).toHaveTextContent(t("tr.needTwo"));
    expect(screen.getByTestId("tr-need")).toHaveTextContent("在上面租一间仓库");
    expect(screen.queryByRole("button", { name: /租 200 单位/ })).toBeNull();
    expect(v2Classes()).toEqual([]);
    cleanup();
    render(<CartBar cash={100} load={{ cargo: [], used: 0, capacity: 80 }} summary={null} lines={0} busy={false} onSettle={() => {}} onClear={() => {}} onFitCash={() => {}} />);
    const keys = document.querySelector(".mk-keys");
    expect(keys?.tagName).toBe("SPAN");
    expect(keys).toHaveTextContent(t("mk.keys"));
    expect(document.querySelector("kbd")).toBeNull();
  });

  it("仓库：容量在上、装卸台在下，没有“仓库容量”小标题；期货入口的按钮还是“期货”；办事处与投资的金额照旧不分千位", async () => {
    openPort("warehouse");
    const wh = await screen.findByTestId("warehouse");
    expect(wh.firstElementChild).toHaveClass("wh-cap");
    expect(wh.children).toHaveLength(2);
    expect(within(wh).queryByRole("heading", { name: "仓库容量" })).toBeNull();
    cleanup();
    openPort("exchange");
    expect(await screen.findByRole("button", { name: "期货" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开期货" })).toBeNull();
    cleanup();
    openPort("office");
    expect(await screen.findByRole("button", { name: "购买许可证（3000 金币）" })).toBeInTheDocument();
    cleanup();
    openPort("invest");
    expect(await screen.findByText("最低投资 1000 金币")).toBeInTheDocument();
    expect(v2Classes()).toEqual([]);
  });
});

describe("新界面（v2）：空状态的“下一步”", () => {
  beforeEach(() => setUiFor("v2"));

  it("酒馆没有航海士：说明航海士会走动，一键打开“航海士”窗口", async () => {
    const user = userEvent.setup();
    openPort("tavern", { mates_here: [] });
    const box = (await screen.findByText("本港酒馆暂时没有航海士")).closest("[data-testid='empty-state']") as HTMLElement;
    expect(box).toHaveTextContent("航海士会在各港的酒馆之间走动");
    await user.click(within(box).getByRole("button", { name: "看看别处的航海士" }));
    expect(useGame.getState().tab).toBe("mates");
    expect(useShell.getState().windowOpen).toBe(true);
    // 按人数招募那一行前有小标题
    expect(screen.getByText("按人数")).toHaveClass("tv-crew-by");
  });

  it("没有造船厂的港口：写明最近的造船厂在哪，一键换到那里的造船厂", async () => {
    const user = userEvent.setup();
    // 柳湾（地点 1）没有造船厂；最近的有造船厂的港口是澄港（兰城是内陆城市）
    openPort("shipyard", { shipyard: [], fleets_here: [] }, 1);
    expect(await screen.findByText("离这里最近的造船厂在澄港。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "看看澄港的造船厂" }));
    expect(useGame.getState().selectedLoc).toBe(0);
    expect(useGame.getState().facility).toBe("shipyard");
  });

  it("没有期货交易所：说明期货在哪里买卖，一键打开期货", async () => {
    const user = userEvent.setup();
    openPort("exchange", { exchange: null });
    await user.click(await screen.findByRole("button", { name: "打开期货" }));
    expect(screen.getByText("这个港口没有期货交易所。")).toBeInTheDocument();
    expect(useGame.getState().tab).toBe("futures");
  });

  it("商会没有委托、近期没有拍卖会：一句为什么空、一句补充", async () => {
    openPort("guild", { contracts: [] });
    const box = (await screen.findByText("目前没有委托")).closest("[data-testid='empty-state']") as HTMLElement;
    expect(box).toHaveTextContent("过几天再来看看");
    cleanup();
    installIpc({ auctions: () => ({ auctions: [] }) });
    render(<AuctionPanel loc={0} />);
    const au = (await screen.findByText("近期没有拍卖会。")).closest("[data-testid='empty-state']") as HTMLElement;
    expect(au).toHaveTextContent("拍卖会的预告会写在日历里");
  });

  it("仓库：只有一处能放货、还没有仓库时，一键租 200 单位的仓库（每天的租金写在按钮上）", async () => {
    const user = userEvent.setup();
    const calls = openPort("warehouse");
    // fixtures：每 100 单位每天 5 金币 → 200 单位每天 10 金币
    await user.click(await screen.findByRole("button", { name: "租 200 单位的仓库（每天 10 金币）" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { RentWarehouse: { owner: "player", loc: 0, capacity: 200 } } }));
  });

  it("仓库：已经有仓库、只是没有船队在这里时，不给租仓库的按钮", async () => {
    openPort("warehouse", { fleets_here: [], warehouse: { rented: 100, owned: 0, capacity: 100, used: 0, stock: [] } });
    // 新界面里容量那一块排在装卸台下面：说明写“在下面租一间仓库”（v1 是“在上面”）
    expect(await screen.findByText(t("v2.port.trNeedTwo"))).toBeInTheDocument();
    expect(screen.getByText(/在下面租一间仓库/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /租 200 单位/ })).toBeNull();
  });
});

describe("新界面（v2）：主要操作排在前面、按钮写清动作", () => {
  beforeEach(() => setUiFor("v2"));

  it("仓库：常用的装卸台排在上面，容量（租用、买下）排在下面、有自己的小标题；租用照旧提交 RentWarehouse", async () => {
    const user = userEvent.setup();
    const calls = openPort("warehouse", { warehouse: { rented: 200, owned: 0, capacity: 200, used: 0, stock: [] } });
    const wh = await screen.findByTestId("warehouse");
    const headings = within(wh)
      .getAllByRole("heading")
      .map((h) => h.textContent);
    expect(headings).toEqual([t("tr.title"), "仓库容量"]);
    // 装卸台（舰队与仓库两处能放货）在容量那一块之前
    const desk = within(wh).getByTestId("transfer-desk");
    const cap = wh.querySelector(".wh-cap") as HTMLElement;
    expect(desk.compareDocumentPosition(cap) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 容量的操作没有变：改租用量后“设定租用容量”提交同一条命令
    const rent = within(cap).getByRole("spinbutton", { name: t("whRent") });
    await user.clear(rent);
    await user.type(rent, "300");
    await user.click(within(cap).getByRole("button", { name: t("whRent") }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { RentWarehouse: { owner: "player", loc: 0, capacity: 300 } } }));
  });

  it("期货入口：按钮写“打开期货”，点了打开期货窗口", async () => {
    const user = userEvent.setup();
    openPort("exchange");
    await user.click(await screen.findByRole("button", { name: "打开期货" }));
    expect(useGame.getState().tab).toBe("futures");
  });

  it("办事处与港口投资：金额写成千分位（“购买许可证（3,000 金币）”“最低投资 1,000 金币”），命令不变", async () => {
    const user = userEvent.setup();
    const calls = openPort("office");
    await user.click(await screen.findByRole("button", { name: "购买许可证（3,000 金币）" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { BuyLicense: { owner: "player", faction: 0 } } }));
    expect(screen.getByRole("button", { name: "购买私掠许可（8,000 金币）" })).toBeInTheDocument();
    cleanup();
    openPort("invest");
    expect(await screen.findByText("最低投资 1,000 金币")).toBeInTheDocument();
    // 投资是这一块里唯一的主按钮
    expect(screen.getByRole("button", { name: "投资 1,000 金币" })).toHaveClass("primary");
  });
});

describe("新界面（v2）：行内的快捷操作", () => {
  beforeEach(() => setUiFor("v2"));

  it("银行：快捷金额改金额；三个按钮与还款都写清金额，命令与 v1 相同", async () => {
    const user = userEvent.setup();
    const calls = openPort("bank", bankPort);
    const quick = await screen.findByRole("group", { name: "快捷金额" });
    await user.click(within(quick).getByRole("button", { name: "5,000" }));
    expect(within(quick).getByRole("button", { name: "5,000" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("spinbutton", { name: "金额" })).toHaveValue(5000);
    await user.click(screen.getByRole("button", { name: "存入 5,000 金币" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { Deposit: { owner: "player", amount: 5000 } } }));
    await user.click(screen.getByRole("button", { name: "借 5,000 金币（6 个月）" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { Borrow: { owner: "player", amount: 5000, months: 6 } } }));
    // 5,000 正好是这笔贷款的本金：还完就清了，写“还清”
    await user.click(screen.getByRole("button", { name: "还清 5,000 金币" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { Repay: { owner: "player", loan: 3, amount: 5000 } } }));
    // 有存款时多一个“全部存款”
    await user.click(within(quick).getByRole("button", { name: "全部存款 6,000" }));
    await user.click(screen.getByRole("button", { name: "取出 6,000 金币" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { Withdraw: { owner: "player", amount: 6000 } } }));
  });

  it("银行：柜台金额不小于某笔贷款的本金时写“还清 n”，超过时按本金封顶（内核不收超过本金的还款）；不到本金时写“还 n”", async () => {
    const user = userEvent.setup();
    const calls = openPort("bank", {
      bank: {
        ...port.bank,
        loans: [
          { id: 3, principal: 5000, rate_bp: 900, start_day: 0, due_day: 180, overdue: false },
          { id: 4, principal: 2000, rate_bp: 900, start_day: 0, due_day: 90, overdue: true },
        ],
      },
    });
    const quick = await screen.findByRole("group", { name: "快捷金额" });
    const loans = screen.getAllByRole("listitem").filter((li) => li.closest(".bk-loans"));
    // 缺省 1,000：两笔都还不清，照旧“还 1,000”
    expect(within(loans[0]).getByRole("button")).toHaveTextContent("还 1,000 金币");
    expect(within(loans[1]).getByRole("button")).toHaveTextContent("还 1,000 金币");
    await user.click(within(quick).getByRole("button", { name: "5,000" }));
    // 5,000 正好是第 3 笔的本金：还完就清了，也写“还清 5,000”；第 4 笔只欠 2,000：封顶“还清 2,000”
    expect(within(loans[0]).getByRole("button")).toHaveTextContent("还清 5,000 金币");
    expect(within(loans[1]).getByRole("button")).toHaveTextContent("还清 2,000 金币");
    await user.click(screen.getByRole("button", { name: "还清 2,000 金币" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { Repay: { owner: "player", loan: 4, amount: 2000 } } }));
    // 金额改大到 10,000：两笔都封顶
    await user.click(within(quick).getByRole("button", { name: "10,000" }));
    expect(within(loans[0]).getByRole("button")).toHaveTextContent("还清 5,000 金币");
    await user.click(screen.getByRole("button", { name: "还清 5,000 金币" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { Repay: { owner: "player", loan: 3, amount: 5000 } } }));
    expect(calls).not.toHaveBeenCalledWith("submit", { command: { Repay: { owner: "player", loan: 3, amount: 10000 } } });
  });

  it("港口投资：最低额的 1、5、10 倍一键填好，“投资”写清金额", async () => {
    const user = userEvent.setup();
    const calls = openPort("invest");
    const quick = await screen.findByRole("group", { name: "快捷金额" });
    expect(within(quick).getAllByRole("button").map((b) => b.textContent)).toEqual(["1,000", "5,000", "10,000"]);
    await user.click(within(quick).getByRole("button", { name: "10,000" }));
    await user.click(screen.getByRole("button", { name: "投资 10,000 金币" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { InvestPort: { owner: "player", loc: 0, amount: 10000 } } }));
  });

  it("道具店：“买”灰掉时原因写在这一行——卖完了写换货日，钱不够写差多少；v1 不写", async () => {
    const line = (key: string, name: string): ItemLine => ({
      key,
      name,
      kind: "curio",
      rarity: 1,
      qty: 1,
      equipped: 0,
      icon: "",
      desc: "",
      lore: null,
      tags: [],
      price: 100,
      bonus: [],
      effects: [],
      set: null,
      book: null,
      key_item: false,
      can_sell: true,
      can_give: true,
      can_use: false,
    });
    const shop: ShopView = {
      loc: 0,
      name: "澄港的杂货铺",
      restock: [1502, 2, 1],
      sell_bp: 5000,
      offers: [
        { item: "ring", stock: 0, price: 300, line: line("ring", "信手戒"), enabled: true },
        { item: "globe", stock: 1, price: 20000, line: line("globe", "地球仪"), enabled: true },
        { item: "map", stock: 2, price: 500, line: line("map", "旧海图"), enabled: true },
      ],
    };
    installIpc({ item_shop: () => shop, inventory: () => ({ items: [] }) });
    useGame.setState({ overview: { ...overview, cash: 12345 } });
    render(<ShopPanel loc={0} />);
    const ring = await screen.findByTestId("offer-ring");
    expect(within(ring).getByRole("button", { name: "买" })).toBeDisabled();
    expect(ring).toHaveTextContent("卖完了，1502 年 2 月 1 日换货");
    const globe = screen.getByTestId("offer-globe");
    expect(within(globe).getByRole("button", { name: "买" })).toBeDisabled();
    expect(globe).toHaveTextContent("现金还差 7,655 金币");
    expect(screen.getByTestId("offer-map").querySelector(".it-why")).toBeNull();
    cleanup();
    setUiFor("v1");
    render(<ShopPanel loc={0} />);
    expect(await screen.findByTestId("offer-ring")).not.toHaveTextContent("卖完了");
    expect(screen.getByTestId("offer-globe")).not.toHaveTextContent("现金还差");
  });

  it("交易所的账台：成交单空着时，键盘提示画成小键帽（读屏念完整的键名）", () => {
    render(<CartBar cash={100} load={{ cargo: [], used: 0, capacity: 80 }} summary={null} lines={0} busy={false} onSettle={() => {}} onClear={() => {}} onFitCash={() => {}} />);
    const keys = screen.getByRole("list", { name: "快捷键" });
    expect(keys).toHaveClass("mk-keys");
    expect(keys.querySelectorAll("kbd")).toHaveLength(7);
    for (const label of ["选货", "调数量", "一次 10 件", "成交", "看明细"]) expect(within(keys).getByText(label)).toBeInTheDocument();
    expect(keys).toHaveTextContent("上箭头");
  });
});

describe("新界面（v2）：手机上的设施分页、酒馆的写法", () => {
  it("设施分页一行放不下时，当前设施的小签滚进可见范围（打开窗口、换设施时都是）；v1 不动", async () => {
    const user = userEvent.setup();
    setUiFor("v2");
    const { bar, activeInView } = fakeScrollingTabs();
    // 港口投资是第 8 个分页（14 + 7 × 80 = 574，在 376 之外）
    openPort("invest");
    await screen.findByRole("tab", { name: "港口投资", selected: true });
    await waitFor(() => expect(activeInView()).toBe(true));
    expect(bar()?.scrollLeft).toBeGreaterThan(0);
    // 换到第一个分页“交易所”：滚回头
    await user.click(screen.getByRole("tab", { name: "交易所" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "交易所" })).toHaveAttribute("aria-selected", "true"));
    expect(activeInView()).toBe(true);
    expect(bar()?.scrollLeft).toBe(0);
    cleanup();
    setUiFor("v1");
    openPort("invest");
    await screen.findByRole("tab", { name: "港口投资", selected: true });
    expect(bar()?.scrollLeft).toBe(0);
  });

  it("酒馆：按人数招募写“招募（50 金币）”（全角括号），航海士的雇金写千分位；v1 照旧", async () => {
    setUiFor("v2");
    openPort("tavern");
    const crew = await screen.findByTestId("tavern-crew");
    expect(within(crew).getByRole("button", { name: "招募（50 金币）" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "招募（1,500 金币）" })).toBeInTheDocument();
    cleanup();
    setUiFor("v1");
    openPort("tavern");
    const crew1 = await screen.findByTestId("tavern-crew");
    expect(within(crew1).getByRole("button", { name: "招募 (50 金币)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "招募（1500 金币）" })).toBeInTheDocument();
  });

  it("酒馆的议价：输入框里是短提示，能试的说法写在下面的小字里（读屏当作说明念）；v1 照旧整句放在输入框里", async () => {
    setUiFor("v2");
    openPort("tavern");
    const input = await screen.findByRole("textbox", { name: "对掌柜说点什么……" });
    expect(input).toHaveAttribute("placeholder", "对掌柜说点什么……");
    expect(input).toHaveAccessibleDescription(t("v2.port.bargainHint"));
    expect(screen.getByText(t("v2.port.bargainHint"))).toHaveClass("tv-bargain-hint");
    cleanup();
    setUiFor("v1");
    openPort("tavern");
    const input1 = await screen.findByRole("textbox", { name: t("tvBargainHint") });
    expect(input1).toHaveAttribute("placeholder", t("tvBargainHint"));
    expect(input1).not.toHaveAttribute("aria-describedby");
    expect(document.querySelector(".tv-bargain-hint")).toBeNull();
  });
});
