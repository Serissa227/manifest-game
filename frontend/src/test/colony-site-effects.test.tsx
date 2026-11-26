// 殖民与探险的集成修整（西幻扩展第三批）：
// - 殖民地窗口：选中 / 抵达殖民点时在名册上方显示殖民点卡片与“在此建立殖民地”，对话框在殖民地窗口里打开；
// - 组合事件的五种殖民效果（殖民地产量、士气、移民、占领殖民点、发现物传闻）在情报卡片与殖民地窗口里的格式；
// - 殖民地窗口的“事件影响”：正在作用的效果、剩余天数与人口增长系数；
// - 探险窗口的海上传闻（已找到的标为已证实）；剧本卡片的开局货物；按“已发现总数”触发发现物查询。
// 模拟的 Tauri IPC，不调用任何真实服务。
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { openFoundDialog, useColonyUi } from "../components/colony/colonyUi";
import ColoniesPanel from "../components/panels/ColoniesPanel";
import { effectText } from "../components/panels/effectText";
import ExplorePanel from "../components/panels/ExplorePanel";
import IntelPanel from "../components/panels/IntelPanel";
import StartScreen from "../components/StartScreen";
import { useShell } from "../components/shell/shellState";
import { focusSite } from "../hooks/useVoyage";
import type {
  ColoniesView,
  ColonyView,
  DiscoveriesView,
  EffectView,
  EventView,
  FleetView,
  LocView,
  Overview,
  ScenarioView,
  SiteView,
  StaticView,
} from "../ipc/types";
import { useFoundStore, watchDiscoveries } from "../map/found";
import { useGame } from "../store/game";
import {
  colonialOverview,
  colonialStatics,
  coloniesView,
  discoveriesView,
  installIpc,
  overview,
  siteLoc,
  siteView,
  startedGame,
  statics,
} from "./fixtures";

/** 停在殖民点（地点 3）的旗舰队：40 名船员，船上有 60 件谷物。 */
const fleetAtSite: FleetView = {
  ...overview.fleets[0],
  docked: 3,
  x: 2,
  y: 0,
  crew: 40,
  capacity: 200,
  used: 60,
  cargo: [{ good: 0, qty: 60, avg_cost: 12 }],
};

/** 殖民点无人占领、玩家还没有殖民地、旗舰队停在殖民点的概览。 */
const wildOverview: Overview = { ...colonialOverview, colonies: [], site_claims: [], fleets: [fleetAtSite] };

/** 第二处殖民点“琥珀湾”（地点 4）：玩家的殖民地“新晨港”建在这里，旗舰队停在无主的银雾河口（地点 3）。 */
const amberLoc: LocView = { ...siteLoc, id: 4, key: "amber_cove", name: "琥珀湾", x: 3, y: 2 };
const twoSites: StaticView = { ...colonialStatics, locations: [...colonialStatics.locations, amberLoc] };
const colonyAtAmber: ColonyView = { ...coloniesView.colonies[0], loc: 4, fleets_here: [] };
const amberOverview: Overview = {
  ...colonialOverview,
  colonies: [{ ...colonialOverview.colonies[0], loc: 4 }],
  site_claims: [{ loc: 4, faction: null, colony: 0, mine: true }],
  fleets: [fleetAtSite],
};

function effect(patch: Partial<EffectView>): EffectView {
  return {
    effect: "location_supply",
    label: "当地生产",
    hint: "产量下降",
    loc: null,
    good: null,
    region: null,
    faction_a: null,
    faction_b: null,
    mult_bp: null,
    days: null,
    delta: null,
    end: null,
    ...patch,
  };
}

/** 五种殖民效果（与 views.rs 的 EffectView 字段一致；label 取 effects.toml 的 name）。 */
const colonyOutput = effect({
  effect: "colony_output",
  label: "殖民地产量",
  hint: "殖民地增产",
  loc: "银雾河口",
  colony: "新晨港",
  building: "农庄",
  all_buildings: false,
  mult_bp: 12000,
  days: 60,
  end: 40,
});
const colonySlump = effect({
  effect: "colony_output",
  label: "殖民地产量",
  hint: "殖民地减产",
  loc: "银雾河口",
  colony: "新晨港",
  building: null,
  all_buildings: true,
  mult_bp: 7500,
  days: 30,
  end: 13,
});
const colonyMorale = effect({ effect: "colony_morale", label: "殖民地士气", hint: "殖民地士气高涨", loc: "银雾河口", colony: "新晨港", delta: 8 });
const colonyGrowth = effect({
  effect: "colony_growth",
  label: "殖民地移民",
  hint: "移民涌入",
  loc: "银雾河口",
  colony: "新晨港",
  mult_bp: 13000,
  days: 90,
  end: 100,
});
const siteClaim = effect({ effect: "site_claim", label: "势力占领殖民点", hint: "殖民点易主", loc: "琥珀湾", faction_a: "金穗" });
const rumor = effect({ effect: "discovery_rumor", label: "发现物传闻", hint: "发现物的传闻", discovery: "沉没的阿尔坎之门", region: "内海" });

function colonyGame(o: Overview, s: StaticView = colonialStatics) {
  startedGame();
  useGame.setState({ statics: s, overview: o, selectedLoc: 0, selectedColony: 7, tab: "reports" });
  useColonyUi.setState({ foundSite: null, focus: null });
  useShell.setState({ windowOpen: true });
}

describe("殖民地窗口：选中殖民点时名册上方的殖民点卡片", () => {
  it("抵达未开拓的殖民点：卡片把“在此建立殖民地”放在最前面，对话框就在殖民地窗口里打开，建立后显示新殖民地", async () => {
    const founded: Overview = { ...colonialOverview, fleets: [{ ...fleetAtSite, crew: 20 }] };
    const calls = installIpc({
      colonies: () => ({ colonies: [], slots_left: 5 }),
      submit: (args) => {
        const cmd = args.command as Record<string, unknown>;
        if ("FoundColony" in cmd) return { outcome: { ColonyFounded: { colony: 7 } }, overview: founded };
        return { outcome: "Done", overview: wildOverview };
      },
    });
    colonyGame(wildOverview);
    // 与海图的点击 / 抵达一致：选中殖民点、清空选中的殖民地、切到“殖民地”页
    act(() => void focusSite(3));
    expect(useGame.getState().tab).toBe("colonies");
    expect(useGame.getState().selectedColony).toBeNull();
    const user = userEvent.setup();
    render(<ColoniesPanel />);

    const card = await screen.findByTestId("colony-site-card");
    expect(within(card).getByRole("heading", { name: "银雾河口 未开拓之地" })).toBeInTheDocument();
    // 卡片在名册之前
    const roster = screen.getByRole("heading", { name: "殖民地名册" });
    expect(card.compareDocumentPosition(roster) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/你还没有殖民地/)).toBeInTheDocument();
    // “在此建立殖民地”一节在自然条件之前，条件齐备时给出提示
    const details = await within(card).findByTestId("site-details");
    const headings = within(details)
      .getAllByRole("heading")
      .map((h) => h.textContent);
    expect(headings.indexOf("在此建立殖民地")).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf("在此建立殖民地")).toBeLessThan(headings.indexOf("自然条件"));
    expect(within(details).getByText("你的船队停泊在银雾河口，条件齐备，可以立下界碑了。")).toBeInTheDocument();
    expect(within(details).getByText("舰队 #0：可以建立")).toBeInTheDocument();
    expect(within(details).getByText("地形：森林")).toBeInTheDocument();
    const btn = within(details).getByRole("button", { name: "在此建立殖民地" });
    expect(btn).toBeEnabled();

    // 点按钮：对话框在殖民地窗口里打开，不跳去港口窗口
    await user.click(btn);
    expect(useGame.getState().tab).toBe("colonies");
    expect(useColonyUi.getState().foundSite).toBe(3);
    const dialog = await screen.findByRole("dialog", { name: "在银雾河口建立殖民地" });
    const name = within(dialog).getByRole("textbox", { name: "殖民地名称" });
    await user.clear(name);
    await user.type(name, "晨星港");
    await user.click(within(dialog).getByRole("button", { name: "立下界碑" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { FoundColony: { owner: "player", fleet: 0, site: 3, name: "晨星港", settlers: 32 } },
      }),
    );
    await waitFor(() => expect(useGame.getState().selectedColony).toBe(7));
    expect(useGame.getState().tab).toBe("colonies");
    expect(useColonyUi.getState().foundSite).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("colony-site-card")).toBeNull();
  });

  it("没有停泊的舰队时按钮禁用，并逐项标出缺什么", async () => {
    installIpc({ colonies: () => ({ colonies: [], slots_left: 5 }), site: () => ({ ...siteView, fleets_here: [] }) });
    colonyGame({ ...wildOverview, fleets: [{ ...fleetAtSite, docked: 0, cargo: [] }] });
    act(() => void focusSite(3));
    render(<ColoniesPanel />);
    const details = await within(await screen.findByTestId("colony-site-card")).findByTestId("site-details");
    expect(within(details).getByRole("button", { name: "在此建立殖民地" })).toBeDisabled();
    expect(within(details).getByText("须有你的舰队停泊在此")).toBeInTheDocument();
    expect(within(details).getByText("谷物 60 件（船上 0）").closest("li")).toHaveClass("bad");
    expect(within(details).queryByText(/条件齐备/)).toBeNull();
  });

  it("被势力占领的殖民点：卡片写明归属，没有建立按钮", async () => {
    const claimed: SiteView = {
      ...siteView,
      claim: { loc: 3, faction: 1, colony: null, mine: false },
      can_found: false,
      reason: "已被金穗占领",
      fleets_here: [[0, "已被金穗占领"]],
    };
    installIpc({ colonies: () => ({ colonies: [], slots_left: 5 }), site: () => claimed });
    colonyGame({ ...wildOverview, site_claims: [claimed.claim!] });
    act(() => void focusSite(3));
    render(<ColoniesPanel />);
    const card = await screen.findByTestId("colony-site-card");
    expect(within(card).getByRole("heading", { name: "银雾河口 金穗的据点" })).toBeInTheDocument();
    expect(await within(card).findByTestId("site-claim")).toHaveTextContent("此地已被金穗占领");
    expect(within(card).queryByRole("button", { name: "在此建立殖民地" })).toBeNull();
  });

  it("别处已有殖民地：名册照列但不选中；点名册看详情，再点“查看殖民点”回到卡片", async () => {
    installIpc({ colonies: () => ({ ...coloniesView, colonies: [colonyAtAmber] }) });
    colonyGame(amberOverview, twoSites);
    act(() => void focusSite(3));
    const user = userEvent.setup();
    render(<ColoniesPanel />);
    expect(await screen.findByTestId("colony-site-card")).toBeInTheDocument();
    const item = await screen.findByRole("button", { name: /新晨港/ });
    expect(item).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("colony-detail-0")).toBeNull();

    await user.click(item);
    expect(useGame.getState().selectedColony).toBe(0);
    expect(await screen.findByTestId("colony-detail-0")).toBeInTheDocument();
    expect(screen.queryByTestId("colony-site-card")).toBeNull();
    expect(screen.getByRole("button", { name: /新晨港/ })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "查看殖民点：银雾河口" }));
    expect(useGame.getState().selectedColony).toBeNull();
    expect(await screen.findByTestId("colony-site-card")).toBeInTheDocument();
  });

  it("选中的殖民点就是你的殖民地：直接显示它的详情，不显示殖民点卡片", async () => {
    installIpc({ colonies: () => ({ ...coloniesView, colonies: [coloniesView.colonies[0], { ...colonyAtAmber, id: 1, name: "琥珀堡" }] }) });
    colonyGame(
      {
        ...amberOverview,
        colonies: [colonialOverview.colonies[0], { ...colonialOverview.colonies[0], id: 1, name: "琥珀堡", loc: 4 }],
        site_claims: [
          { loc: 3, faction: null, colony: 0, mine: true },
          { loc: 4, faction: null, colony: 1, mine: true },
        ],
      },
      twoSites,
    );
    act(() => void focusSite(4));
    expect(useGame.getState().selectedColony).toBe(1);
    render(<ColoniesPanel />);
    expect(await screen.findByTestId("colony-detail-1")).toBeInTheDocument();
    expect(screen.queryByTestId("colony-site-card")).toBeNull();
    // 选中的殖民地为空、但选中的地点是你的殖民地时，也显示那处殖民地（而不是名册第一个）
    act(() => useGame.setState({ selectedColony: null }));
    expect(await screen.findByTestId("colony-detail-1")).toBeInTheDocument();
    expect(screen.queryByTestId("colony-site-card")).toBeNull();
  });

  it("“建立殖民地”对话框：在殖民地页时留在殖民地窗口，其余时候打开港口窗口", () => {
    installIpc();
    colonyGame(wildOverview);
    useGame.setState({ tab: "colonies", selectedColony: 0 });
    openFoundDialog(3);
    expect(useGame.getState().tab).toBe("colonies");
    expect(useGame.getState().selectedLoc).toBe(3);
    expect(useGame.getState().selectedColony).toBeNull();
    expect(useColonyUi.getState().foundSite).toBe(3);

    useColonyUi.setState({ foundSite: null });
    useGame.setState({ tab: "fleet", selectedColony: 0, selectedLoc: 0 });
    openFoundDialog(3);
    expect(useGame.getState().tab).toBe("port");
    expect(useGame.getState().selectedColony).toBe(0);
    expect(useColonyUi.getState().foundSite).toBe(3);
  });
});

describe("组合事件的殖民效果：格式化", () => {
  it("五种殖民效果写成“对象 · 方向与幅度 · 持续”：殖民地（殖民点）、建筑或全部建筑、殖民点 → 势力、发现物与海区", () => {
    expect(effectText(colonyOutput)).toBe("新晨港（银雾河口） · 农庄 · 殖民地增产 +20% · 持续 60 天");
    expect(effectText(colonySlump)).toBe("新晨港（银雾河口） · 全部建筑 · 殖民地减产 −25% · 持续 30 天");
    expect(effectText(colonyMorale)).toBe("新晨港（银雾河口） · 殖民地士气高涨 +8 · 一次性");
    expect(effectText({ ...colonyMorale, hint: "殖民地士气低落", delta: -5 })).toBe("新晨港（银雾河口） · 殖民地士气低落 −5 · 一次性");
    expect(effectText(colonyGrowth)).toBe("新晨港（银雾河口） · 移民涌入 +30% · 持续 90 天");
    expect(effectText(siteClaim)).toBe("琥珀湾 → 金穗 · 殖民点易主 · 一次性");
    expect(effectText(rumor)).toBe("「沉没的阿尔坎之门」据传在内海一带 · 发现物的传闻 · 一次性");
    // 殖民地已不存在时只写殖民点；传闻没有海区时只写发现物
    expect(effectText({ ...colonyGrowth, colony: null })).toBe("银雾河口 · 移民涌入 +30% · 持续 90 天");
    expect(effectText({ ...rumor, region: null })).toBe("「沉没的阿尔坎之门」 · 发现物的传闻 · 一次性");
    // 殖民地窗口里省略殖民地本身
    expect(effectText(colonyOutput, { omitColony: true })).toBe("农庄 · 殖民地增产 +20% · 持续 60 天");
    expect(effectText(colonyGrowth, { omitColony: true })).toBe("移民涌入 +30% · 持续 90 天");
    // 旧效果的格式不变
    expect(effectText(effect({ effect: "demand_shift", hint: "需求旺盛", loc: "澄港", good: "木材", mult_bp: 15000, days: 45 }))).toBe(
      "澄港 · 木材 · 需求旺盛 +50% · 持续 45 天",
    );
    expect(effectText(effect({ effect: "interest_shift", hint: "银根收紧", mult_bp: 11000, days: 90 }))).toBe("各地 · 银根收紧 +10% · 持续 90 天");
  });

  it("情报窗口的大事记卡片逐条列出殖民效果", async () => {
    const frontier: EventView = {
      name: "新大陆的春汛",
      description: "银雾河涨水，冲来大片沃土，也冲垮了琥珀湾的栅栏。",
      start: 10,
      end: 100,
      place: ["新晨港", "琥珀湾"],
      origin: "composed",
      id: 9,
      source: "ai",
      title: "新大陆的春汛",
      narrative: "银雾河涨水，冲来大片沃土，也冲垮了琥珀湾的栅栏。",
      effects: [colonyOutput, colonyMorale, colonyGrowth, siteClaim, rumor],
      active: true,
    };
    startedGame();
    installIpc({ intel: () => ({ news: [], events: [frontier], log: [], chronicles: [], composed: [frontier] }) });
    render(<IntelPanel />);
    const card = await screen.findByTestId("composed-9");
    const list = within(card).getByRole("list", { name: "新大陆的春汛 的效果" });
    const lines = within(list)
      .getAllByRole("listitem")
      .map((li) => [li.querySelector(".pn-ce-label")?.textContent, li.querySelector(".pn-ce-text")?.textContent]);
    expect(lines).toEqual([
      ["殖民地产量", "新晨港（银雾河口） · 农庄 · 殖民地增产 +20% · 持续 60 天"],
      ["殖民地士气", "新晨港（银雾河口） · 殖民地士气高涨 +8 · 一次性"],
      ["殖民地移民", "新晨港（银雾河口） · 移民涌入 +30% · 持续 90 天"],
      ["势力占领殖民点", "琥珀湾 → 金穗 · 殖民点易主 · 一次性"],
      ["发现物传闻", "「沉没的阿尔坎之门」据传在内海一带 · 发现物的传闻 · 一次性"],
    ]);
    expect(within(list).getAllByRole("listitem")[0]).toHaveAttribute("title", "至 1502年2月11日");
  });
});

describe("殖民地窗口：事件影响", () => {
  function withEffects(patch: Partial<ColonyView>): ColoniesView {
    return { ...coloniesView, colonies: [{ ...coloniesView.colonies[0], ...patch }] };
  }

  beforeEach(() => {
    colonyGame({ ...colonialOverview, fleets: [fleetAtSite] });
    useGame.setState({ selectedLoc: 3, selectedColony: null, tab: "colonies" });
  });

  it("列出正在作用的效果（省略殖民地本身）与剩余天数，写明人口增长系数；名册上标出“事件影响”", async () => {
    installIpc({ colonies: () => withEffects({ effects: [colonyOutput, colonySlump, colonyGrowth], growth_mult_bp: 13000 }) });
    render(<ColoniesPanel />);
    const section = await screen.findByTestId("colony-effects");
    expect(within(section).getByRole("heading", { name: "事件影响" })).toBeInTheDocument();
    expect(within(section).getByText("人口增长与移民 ×1.30")).toBeInTheDocument();
    // 今天是第 12 天；结束日不含
    const e0 = within(section).getByTestId("colony-effect-0");
    expect(within(e0).getByText("殖民地产量")).toBeInTheDocument();
    expect(within(e0).getByText("农庄 · 殖民地增产 +20% · 持续 60 天")).toBeInTheDocument();
    expect(within(e0).getByText("剩 28 天 · 至 1502年2月11日")).toBeInTheDocument();
    expect(e0).toHaveClass("is-up");
    const e1 = within(section).getByTestId("colony-effect-1");
    expect(within(e1).getByText("全部建筑 · 殖民地减产 −25% · 持续 30 天")).toBeInTheDocument();
    expect(within(e1).getByText("剩 1 天 · 至 1502年1月14日")).toBeInTheDocument();
    expect(e1).toHaveClass("is-down");
    const e2 = within(section).getByTestId("colony-effect-2");
    expect(within(e2).getByText("移民涌入 +30% · 持续 90 天")).toBeInTheDocument();
    expect(within(e2).getByText("剩 88 天 · 至 1502年4月11日")).toBeInTheDocument();
    // 人口与住房一节也提到增长系数；名册卡片上有“事件影响”标签
    expect(screen.getByText("受事件影响，人口增长与移民 ×1.30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /新晨港/ })).toHaveTextContent("事件影响");
    // 图标对辅助技术隐藏
    for (const c of section.querySelectorAll("canvas")) expect(c).toHaveAttribute("aria-hidden", "true");
  });

  it("没有事件时写明不受影响（×1.00）；旧后端没有这两个字段时不显示这一节", async () => {
    installIpc({ colonies: () => withEffects({ effects: [], growth_mult_bp: 10000 }) });
    const { unmount } = render(<ColoniesPanel />);
    const section = await screen.findByTestId("colony-effects");
    expect(within(section).getByText("人口增长与移民 ×1.00")).toBeInTheDocument();
    expect(within(section).getByText("眼下没有海上大事影响这处殖民地。")).toBeInTheDocument();
    expect(screen.queryByText(/受事件影响/)).toBeNull();
    expect(screen.getByRole("button", { name: /新晨港/ })).not.toHaveTextContent("事件影响");
    unmount();

    installIpc();
    render(<ColoniesPanel />);
    expect(await screen.findByTestId("colony-detail-0")).toBeInTheDocument();
    expect(screen.queryByTestId("colony-effects")).toBeNull();
  });

  it("减缓增长的事件：系数小于 1 时标为拖累", async () => {
    installIpc({
      colonies: () =>
        withEffects({ effects: [{ ...colonyGrowth, hint: "人口增长放缓", mult_bp: 8000, end: 50 }], growth_mult_bp: 8000 }),
    });
    render(<ColoniesPanel />);
    const section = await screen.findByTestId("colony-effects");
    expect(within(section).getByText("人口增长与移民 ×0.80")).toBeInTheDocument();
    expect(within(section).getByText("拖累")).toBeInTheDocument();
    expect(within(section).getByText("人口增长放缓 −20% · 持续 90 天")).toBeInTheDocument();
    expect(within(section).getByTestId("colony-effect-0")).toHaveClass("is-down");
  });
});

describe("探险窗口：海上传闻", () => {
  const exploreStatics: StaticView = {
    ...colonialStatics,
    discoveries: [
      ...colonialStatics.discoveries,
      { id: 1, key: "morning_star_wreck", name: "晨星号残骸", kind: "wreck", fame: 20, value: 2500, lore: "" },
    ],
  };

  beforeEach(() => {
    startedGame();
    useGame.setState({ statics: exploreStatics, overview: colonialOverview });
  });

  it("“传闻：「某发现物」在某海区一带”，未证实的在前；已找到的标为已证实", async () => {
    const view: DiscoveriesView = {
      ...discoveriesView,
      total: 2,
      rumors: [
        { id: 0, day: 5, region: 0, region_name: "内海", found: true },
        { id: 1, day: 30, region: 0, region_name: "晨星洋", found: false },
      ],
    };
    installIpc({ discoveries: () => view });
    render(<ExplorePanel />);
    const section = await screen.findByTestId("explore-rumors");
    expect(within(section).getByRole("heading", { name: "海上传闻" })).toBeInTheDocument();
    const items = within(section).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("data-testid"))).toEqual(["rumor-1", "rumor-0"]);
    const open = screen.getByTestId("rumor-1");
    expect(within(open).getByText("传闻：「晨星号残骸」在晨星洋一带")).toBeInTheDocument();
    expect(within(open).getByText("听闻于 1502年2月1日")).toBeInTheDocument();
    expect(within(open).getByText("待查证")).toBeInTheDocument();
    expect(open).not.toHaveClass("is-found");
    const done = screen.getByTestId("rumor-0");
    expect(within(done).getByText("传闻：「沉没的阿尔坎之门」在内海一带")).toBeInTheDocument();
    expect(within(done).getByText("已证实")).toBeInTheDocument();
    expect(done).toHaveClass("is-found");
    // 传闻不改变发现进度，像素图章对辅助技术隐藏
    expect(screen.getByText("已发现 1 / 2")).toBeInTheDocument();
    expect(screen.queryAllByRole("img")).toHaveLength(0);
  });

  it("没有传闻（或旧后端没有 rumors 字段）时不显示这一节；海区名为空时写“某片远海”", async () => {
    installIpc({ discoveries: () => ({ ...discoveriesView, rumors: [] }) });
    const { unmount } = render(<ExplorePanel />);
    expect(await screen.findByTestId("explore-fame")).toBeInTheDocument();
    expect(screen.queryByTestId("explore-rumors")).toBeNull();
    unmount();

    installIpc({ discoveries: () => ({ ...discoveriesView, rumors: [{ id: 1, day: 3, region: 9, region_name: "", found: false }] }) });
    render(<ExplorePanel />);
    expect(await screen.findByText("传闻：「晨星号残骸」在某片远海一带")).toBeInTheDocument();
  });
});

describe("剧本卡片：开局货物", () => {
  it("列出开局货物与粮水；没有货物的剧本不显示这一行", async () => {
    const colonist: ScenarioView = {
      key: "colonist",
      name: "新大陆开拓者",
      description: "船上已备好开荒的木材、谷物与铁器。",
      start: 0,
      cash: 60000,
      ships: [0],
      crew: 70,
      mates: 1,
      goal: { kind: "colonies", target: 3, population: 400, years: 15 },
      cargo: [
        { good: 0, qty: 90 },
        { good: 1, qty: 10 },
      ],
      food: 80,
      water: 80,
    };
    const plain: ScenarioView = { ...statics.scenarios[0], cargo: [], food: 0, water: 0 };
    const calls = installIpc();
    useGame.setState({ statics: { ...statics, scenarios: [plain, colonist] }, overview: null, version: 0, selectedLoc: null, error: null, message: null });
    render(<StartScreen roll={0} />);
    await waitFor(() => expect(calls).toHaveBeenCalledWith("list_saves", {}));
    const row = screen.getByTestId("scenario-cargo-colonist");
    expect(row).toHaveTextContent("货舱");
    expect(row).toHaveTextContent("谷物 ×90、丝绸 ×10 · 粮 80 · 水 80");
    expect(screen.queryByTestId("scenario-cargo-newcomer")).toBeNull();
  });
});

describe("发现物查询：按“已发现总数”触发", () => {
  const twoFinds: StaticView = {
    ...colonialStatics,
    discoveries: [
      ...colonialStatics.discoveries,
      { id: 1, key: "whale_arch", name: "鲸骨拱门", kind: "landmark", fame: 10, value: 1000, lore: "" },
    ],
  };

  it("概览带 discovered_count 时：名声变化不再查询；同一天既报告又发现（未报告数不变）也能及时发现", async () => {
    let found = discoveriesView.found;
    const calls = installIpc({ discoveries: () => ({ ...discoveriesView, found, total: 2 }) });
    startedGame();
    useFoundStore.setState({ found: [], fresh: [], freshSeq: 0, voyage: 0 });
    const base: Overview = { ...overview, discoveries_unreported: 1, discovered_count: 1 };
    useGame.setState({ statics: twoFinds, overview: base, message: null });
    const queries = () => calls.mock.calls.filter(([c]) => c === "discoveries").length;
    const stop = watchDiscoveries();
    try {
      await waitFor(() => expect(useFoundStore.getState().found).toHaveLength(1));
      expect(queries()).toBe(1);

      // 只有名声变了（例如建立殖民地）：不查询
      act(() => useGame.setState({ overview: { ...base, day: 13, fame: 10 } }));
      await Promise.resolve();
      expect(queries()).toBe(1);

      // 报告了旧的、又发现了新的：未报告数仍为 1，已发现总数 1 → 2
      found = [
        { ...discoveriesView.found[0], reported: true },
        { id: 1, day: 14, reported: false, x: 3, y: 2 },
      ];
      act(() => useGame.setState({ overview: { ...base, day: 14, fame: 40, discovered_count: 2 } }));
      await waitFor(() => expect(useFoundStore.getState().found).toHaveLength(2));
      expect(queries()).toBe(2);
      expect(useFoundStore.getState().fresh).toEqual([1]);
      expect(useGame.getState().message).toBe("发现：鲸骨拱门！到港口商会报告可领取赏金。");
    } finally {
      stop();
    }
  });
});
