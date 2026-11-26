// 第九批的行囊、道具店、拍卖会与图鉴（docs/UI-CONTRACT.md I4、I9）：装备槽、分类与排序、拍卖出价的规整；
// 纸娃娃装上 / 卸下、读书、道具店买卖、拍卖出价 / 放弃 / 鉴定、图鉴换类别；命令栏只在打开物品模块的世界里出现行囊与图鉴。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import AuctionPanel from "../components/items/AuctionPanel";
import CodexPanel from "../components/items/CodexPanel";
import InventoryPanel from "../components/items/InventoryPanel";
import ShopPanel from "../components/items/ShopPanel";
import { ItemSlotIcon } from "../components/items/ItemParts";
import { defaultBid, itemIconKey, matches, normalizeBid, slotToEquip, slotsFor, sortItems } from "../components/items/itemKit";
import { commandTabs } from "../components/shell/shellState";
import type { AuctionView, CodexView, InventoryView, ItemLine, ShopView } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, statics } from "./fixtures";

const item = (o: Partial<ItemLine> & Pick<ItemLine, "key" | "name" | "kind">): ItemLine => ({
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
  ...o,
});

const rapier = item({ key: "toledo_rapier", name: "托莱多细剑", kind: "weapon", rarity: 2, price: 1800, bonus: [{ attr: "arms", value: 1 }], effects: [{ kind: "duel_pct", text: "白刃战与决斗 +10%" }] });
const ring = item({ key: "fede_ring", name: "信手戒", kind: "accessory", rarity: 3 });
const book = item({
  key: "kokinshu",
  name: "古今和歌集",
  kind: "book",
  book: { category: "poetry", category_name: "诗与小说", lang: "lang_ja", lang_name: "日语", days: 20, read: false, can_read: "self", published: 905 },
});
const tablet = item({ key: "tabula", name: "翠玉录", kind: "key", rarity: 5, key_item: true, can_sell: false, can_give: false });

function inventory(): InventoryView {
  return {
    items: [book, rapier, ring, tablet],
    wearers: [
      { key: "captain", name: "一条澪", portrait: null, slots: [{ slot: "weapon", item: null }, { slot: "accessory1", item: "fede_ring" }, { slot: "accessory2", item: null }], attrs: [{ attr: "arms", base: 3, equipped: 3 }] },
    ],
    reading: null,
    bibliography: { read: 2, categories: [{ key: "poetry", name: "诗与小说", count: 2 }, { key: "nav", name: "航海与天文", count: 0 }], recent: [] },
    sets: [{ key: "court", name: "宫中女房的见习", items: ["a", "b", "c"], have: 1, bonus: "礼仪的活动收益 +10%", done: false }],
    gifts: { count: 3, value: 900, kinds: 2 },
    collection_value: 4200,
  };
}

describe("物品的纯逻辑", () => {
  it("种类对应装备槽；饰品先放空槽", () => {
    expect(slotsFor("weapon")).toEqual(["weapon"]);
    expect(slotsFor("accessory")).toEqual(["accessory1", "accessory2"]);
    expect(slotsFor("book")).toEqual([]);
    const w = inventory().wearers[0];
    expect(slotToEquip(w, ring)).toBe("accessory2");
    expect(slotToEquip(w, book)).toBeNull();
  });

  it("分类与排序：稀有度高的在前；关键物品单独一类", () => {
    const list = inventory().items;
    expect(sortItems(list).map((i) => i.key)).toEqual(["tabula", "fede_ring", "toledo_rapier", "kokinshu"]);
    expect(list.filter((i) => matches("gear", i)).map((i) => i.key)).toEqual(["toledo_rapier", "fede_ring"]);
    expect(list.filter((i) => matches("key", i)).map((i) => i.key)).toEqual(["tabula"]);
  });

  it("拍卖出价：不低于下一口，按加价幅度向上取整；钱不够返回 null", () => {
    const lot = { next_min: 1200, current: 1100, reserve: 800, increment: 100 };
    expect(defaultBid(lot)).toBe(1200);
    expect(normalizeBid(1000, lot, 5000)).toBe(1200);
    expect(normalizeBid(1250, lot, 5000)).toBe(1300);
    expect(normalizeBid(1300, lot, 1250)).toBeNull();
    expect(defaultBid({ next_min: 0, current: null, reserve: 800, increment: 100 })).toBe(800);
  });

  it("专属图标：物品 key 有图就用图，名匠作沿用原物品的，书按类别共用封面，没有图时退回种类的像素图标", () => {
    expect(itemIconKey(rapier)).toBe("toledo_rapier");
    expect(itemIconKey({ ...rapier, key: "toledo_rapier_master" })).toBe("toledo_rapier");
    expect(itemIconKey({ ...rapier, key: "no_such_item" })).toBeNull();
    const book = item({ key: "some_unknown_book", name: "某本书", kind: "book", book: { category: "classics", category_name: "古典", lang: null, lang_name: null, days: 20, read: false, can_read: "self", published: 1502 } });
    expect(itemIconKey(book)).toBe("book_classics");
    const { container, unmount } = render(<ItemSlotIcon item={rapier} />);
    expect(container.querySelector("img.it-icon-img")?.getAttribute("src")).toContain("items/toledo_rapier.webp");
    unmount();
    const plain = render(<ItemSlotIcon item={{ ...rapier, key: "no_such_item" }} />);
    expect(plain.container.querySelector("img.it-icon-img")).toBeNull();
    plain.unmount();
  });

  it("命令栏：只有打开物品模块的世界才有行囊与图鉴", () => {
    expect(commandTabs(overview, false, statics)).not.toContain("items");
    const t16 = { ...statics, world: { ...statics.world, modules: ["items"] } };
    expect(commandTabs(overview, false, t16)).toEqual(expect.arrayContaining(["items", "codex"]));
  });
});

describe("行囊、道具店、拍卖会与图鉴", () => {
  beforeEach(() => {
    useGame.setState({ statics, overview: { ...overview, cash: 3000 }, version: 1, error: null, message: null });
  });

  it("行囊：选中细剑装上主角（Equip 武器槽）；卸下饰品；读书", async () => {
    const user = userEvent.setup();
    const calls = installIpc({ inventory: () => inventory() });
    render(<InventoryPanel />);
    await screen.findByTestId("inventory");
    expect(screen.getByText("收藏估值 4,200 金币 · 送礼 3 次 · 读过 2 本")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "托莱多细剑" }));
    const detail = screen.getByTestId("item-detail");
    expect(detail).toHaveTextContent("白刃战与决斗 +10%");
    await user.click(within(detail).getByRole("button", { name: "给一条澪装上" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { Equip: { owner: "player", wearer: "captain", slot: "weapon", item: "toledo_rapier" } } }));
    await user.click(screen.getByRole("button", { name: "卸下信手戒" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { Unequip: { owner: "player", wearer: "captain", slot: "accessory1" } } }));
    await user.click(screen.getByRole("button", { name: "古今和歌集" }));
    await user.click(screen.getByRole("button", { name: "开始读" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { ReadBook: { owner: "player", book: "kokinshu" } } }));
    // 书目一页按类别计数
    await user.click(screen.getByRole("tab", { name: "书目" }));
    expect(screen.getByText("读过 2 本，1 类。")).toBeInTheDocument();
  });

  it("道具店：买一件（带上限价）；身上能卖的按收购价卖；关键物品不出现在卖单里", async () => {
    const user = userEvent.setup();
    const shop: ShopView = { loc: 0, name: "塞维利亚的道具店", restock: [1557, 2, 1], sell_bp: 5000, offers: [{ item: "toledo_rapier", stock: 2, price: 1900, line: rapier, enabled: true }] };
    const calls = installIpc({ item_shop: () => shop, inventory: () => inventory() });
    render(<ShopPanel loc={0} />);
    const offer = await screen.findByTestId("offer-toledo_rapier");
    await user.click(within(offer).getByRole("button", { name: "买" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { BuyItem: { owner: "player", loc: 0, item: "toledo_rapier", qty: 1, max_total: 1900 } } }));
    const sell = screen.getByRole("list", { name: "卖掉身上的东西" });
    expect(within(sell).queryByText("翠玉录")).not.toBeInTheDocument();
    const rapierRow = within(sell).getByText("托莱多细剑").closest("li") as HTMLElement;
    await user.click(within(rapierRow).getByRole("button", { name: "卖" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { SellItem: { owner: "player", loc: 0, item: "toledo_rapier", qty: 1, min_total: 900 } } }));
  });

  it("拍卖会：竞价中出价（规整到加价幅度）、放弃、鉴定；输掉的拍品写明后路", async () => {
    const user = userEvent.setup();
    const view: AuctionView = {
      key: "antwerp_1557",
      name: "安特卫普 · 星期五市场的公开拍卖",
      loc: 0,
      loc_name: "安特卫普",
      opens_on: [1557, 7, 3],
      closes_on: [1557, 7, 3],
      days_left: 0,
      status: "open",
      headline: null,
      here: true,
      cash: 3000,
      log: [{ lot: "astrolabe", text: "比安卡·马雷加到 1,100" }],
      lots: [
        {
          key: "astrolabe",
          line: item({ key: "astrolabe", name: "鲁汶的星盘", kind: "instrument", rarity: 3 }),
          qty: 1,
          status: "bidding",
          reserve: 800,
          increment: 100,
          current: 1100,
          leader: { key: "bianca", name: "比安卡·马雷", you: false },
          next_min: 1200,
          bidders: [{ key: "bianca", name: "比安卡·马雷", portrait: null, active: true, mood: "志在必得" }],
          inspection: { done: false, verdict: null, note: null, can_inspect: true },
          winner: null,
          after_loss: null,
          enabled: true,
        },
        {
          key: "horn",
          line: item({ key: "horn", name: "独角兽角", kind: "curio", rarity: 4 }),
          qty: 1,
          status: "sold",
          reserve: 2000,
          increment: 200,
          current: 2600,
          leader: null,
          next_min: 0,
          bidders: [],
          inspection: { done: true, verdict: "fake", note: "其实是一角鲸的牙", can_inspect: false },
          winner: { key: "fugger_factor", name: "富格尔的代理人", you: false, price: 2600 },
          after_loss: "可以去找得主谈",
          enabled: true,
        },
      ],
    };
    const calls = installIpc({ auctions: () => ({ auctions: [{ ...view, lots: 2 }] }), auction: () => view });
    render(<AuctionPanel loc={0} />);
    const lot = await screen.findByTestId("lot-astrolabe");
    expect(within(lot).getByText("比安卡·马雷领先")).toBeInTheDocument();
    const input = within(lot).getByLabelText("你的出价");
    await user.clear(input);
    await user.type(input, "1250");
    await user.click(within(lot).getByRole("button", { name: "出价 1,300 金币" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { BidAuction: { owner: "player", auction: "antwerp_1557", lot: "astrolabe", amount: 1300 } } }));
    await user.click(within(lot).getByRole("button", { name: "请人鉴定" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { InspectLot: { owner: "player", auction: "antwerp_1557", lot: "astrolabe" } } }));
    await user.click(within(lot).getByRole("button", { name: "放弃" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { PassAuction: { owner: "player", auction: "antwerp_1557", lot: "astrolabe" } } }));
    const horn = screen.getByTestId("lot-horn");
    expect(horn).toHaveTextContent("鉴定：伪物 · 其实是一角鲸的牙");
    expect(horn).toHaveTextContent("富格尔的代理人以 2,600 金币 拍得");
    expect(horn).toHaveTextContent("可以去找得主谈");
  });

  it("图鉴：显示各类完成度，换类别重新查询；没见过的只显示问号", async () => {
    const user = userEvent.setup();
    const v = (category: string): CodexView => ({
      categories: [
        { key: "items", name: "物品", got: 3, total: 520 },
        { key: "creatures", name: "怪异", got: 1, total: 90 },
      ],
      category,
      entries:
        category === "creatures"
          ? [
              { key: "hafgufa", name: "哈夫古法", state: "seen", icon: null, desc: "像岛一样大的鱼。", basis: "literature", sources: ["《国王之镜》"], changed: null },
              { key: "kraken", name: "克拉肯", state: "unknown", icon: null, desc: null, basis: null, sources: [], changed: null },
            ]
          : [],
    });
    const calls = installIpc({ codex: (args) => v((args.category as string | null) ?? "items") });
    render(<CodexPanel />);
    await screen.findByTestId("codex");
    await user.click(screen.getByRole("tab", { name: /怪异/ }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("codex", { category: "creatures" }));
    expect(await screen.findByRole("button", { name: "？" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "哈夫古法" }));
    expect(screen.getByRole("article", { name: "哈夫古法" })).toHaveTextContent("《国王之镜》");
  });
});
