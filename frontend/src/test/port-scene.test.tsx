// 港口街景与港口窗口：设施热点、出港按钮、掌柜问候语、街景合成的热点几何。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ARCH_STYLES } from "../art/buildings";
import PortScene from "../components/PortScene";
import PortPanel from "../components/panels/PortPanel";
import { GREETING_COUNT, greeting, greetingKey, keeper, keeperPlaces, type GreetingContext } from "../components/port/greeting";
import { sceneParams } from "../components/port/params";
import { beginDeparture } from "../hooks/useVoyage";
import { tk } from "../i18n";
import {
  composePortScene,
  cutRect,
  facilitiesAt,
  layoutPortScene,
  SCENE_HEIGHT,
  type Hotspot,
  type PortSceneParams,
} from "../scene/port";
import { FACILITIES, useGame, type Facility } from "../store/game";
import { colonialStatics, installIpc, overview, port, startedGame, statics } from "./fixtures";

vi.mock("../hooks/useVoyage", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../hooks/useVoyage")>();
  return { ...mod, beginDeparture: vi.fn() };
});

const NAMES: Record<Facility, string> = {
  market: "交易所",
  shipyard: "造船厂",
  tavern: "酒馆",
  guild: "商会",
  bank: "银行",
  exchange: "期货交易所",
  warehouse: "仓库",
  invest: "港口投资",
  office: "势力办事处",
};

function overlaps(a: Hotspot, b: Hotspot): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe("港口街景", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
    vi.mocked(beginDeparture).mockClear();
  });

  it("每座设施建筑上都有以设施名命名的按钮（名称与 title 一致）", async () => {
    render(<PortScene />);
    const group = await screen.findByRole("group", { name: "澄港的设施" });
    for (const f of FACILITIES) {
      const b = within(group).getByRole("button", { name: NAMES[f] });
      expect(b).toHaveAttribute("title", NAMES[f]);
    }
    expect(within(group).getAllByRole("button")).toHaveLength(FACILITIES.length);
    // 港口名牌：地名、势力与交易税
    expect(screen.getByText("澄港")).toBeInTheDocument();
    expect(await screen.findByText(/税率 5%/)).toBeInTheDocument();
  });

  it("内陆城市没有造船厂；没有期货交易所的地方也不画期货交易所", async () => {
    // FIX4F 起：船停在港里时街景只画停泊的那座港；看别处的街景要旗舰队不在港里
    const atSea = { ...overview.fleets[0], docked: null, dest: 1 };
    useGame.setState({ selectedLoc: 2, overview: { ...overview, fleets: [atSea] } });
    render(<PortScene />);
    const group = await screen.findByRole("group", { name: "兰城的设施" });
    expect(within(group).queryByRole("button", { name: "造船厂" })).toBeNull();
    expect(within(group).queryByRole("button", { name: "期货交易所" })).toBeNull();
    expect(within(group).getByRole("button", { name: "交易所" })).toBeInTheDocument();
  });

  it("点击建筑切换到港口窗口的对应设施", async () => {
    const user = userEvent.setup();
    useGame.setState({ tab: "reports", facility: "market" });
    render(<PortScene />);
    await user.click(await screen.findByRole("button", { name: "酒馆" }));
    expect(useGame.getState().tab).toBe("port");
    expect(useGame.getState().facility).toBe("tavern");
    await user.click(screen.getByRole("button", { name: "银行" }));
    expect(useGame.getState().facility).toBe("bank");
  });

  it("“出港”按钮只在旗舰队停在此港时出现，点击后开始出港", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<PortScene />);
    await user.click(await screen.findByRole("button", { name: "出港" }));
    expect(beginDeparture).toHaveBeenCalledTimes(1);
    unmount();

    // 船停在澄港时点选别的港口：街景与“出港”仍然是停泊的这座港（FIX4F 有意改的规则；原先期望街景跟着换、“出港”消失）
    useGame.setState({ selectedLoc: 1 });
    const second = render(<PortScene />);
    await screen.findByRole("group", { name: "澄港的设施" });
    expect(screen.getByRole("button", { name: "出港" })).toBeInTheDocument();
    second.unmount();

    // 旗舰队在海上
    const atSea = { ...overview.fleets[0], docked: null, dest: 1 };
    useGame.setState({ selectedLoc: 0, overview: { ...overview, fleets: [atSea] } });
    render(<PortScene />);
    await screen.findByRole("group", { name: "澄港的设施" });
    expect(screen.queryByRole("button", { name: "出港" })).toBeNull();
    expect(beginDeparture).toHaveBeenCalledTimes(1);
  });

  it("街景参数：旗舰停泊时带上船型与帆装，季节取自概览", () => {
    const p = sceneParams(statics, overview, 0);
    expect(p.flagship).toEqual({ type: 0, sail: "lateen" });
    expect(p.faction).toBe("cuilan");
    expect(p.facilities).toEqual(FACILITIES);
    expect(sceneParams(statics, overview, 1).flagship).toBeNull();
    expect(sceneParams(statics, { ...overview, season: 3 }, 2).season).toBe(3);
  });
});

describe("街景合成", () => {
  const cases: PortSceneParams[] = [];
  for (const faction of ARCH_STYLES) {
    for (const width of [400, 480, 640, 960, 1400]) {
      cases.push({
        key: `k-${faction}`,
        kind: "port",
        faction,
        facilities: facilitiesAt("port", true, true),
        season: width % 4,
        width,
        flagship: { type: 1, sail: "square" },
        others: 3,
      });
      cases.push({ key: `c-${faction}`, kind: "city", faction, facilities: facilitiesAt("city", false, true), season: 3, width });
    }
  }

  it("热点都在画面内、互不重叠，每个设施恰好一个", () => {
    for (const c of cases) {
      const { px, hotspots } = composePortScene(c, 7);
      expect(px.w).toBe(c.width);
      expect(px.h).toBe(SCENE_HEIGHT);
      expect(hotspots.map((h) => h.facility).sort()).toEqual([...c.facilities].sort());
      for (const h of hotspots) {
        expect(h.w).toBeGreaterThan(8);
        expect(h.h).toBeGreaterThan(8);
        expect(h.x).toBeGreaterThanOrEqual(0);
        expect(h.y).toBeGreaterThanOrEqual(0);
        expect(h.x + h.w).toBeLessThanOrEqual(c.width);
        expect(h.y + h.h).toBeLessThanOrEqual(SCENE_HEIGHT);
      }
      for (let i = 0; i < hotspots.length; i++) {
        for (let j = i + 1; j < hotspots.length; j++) {
          expect(overlaps(hotspots[i], hotspots[j]), `${c.key} ${c.width}: ${hotspots[i].facility} × ${hotspots[j].facility}`).toBe(false);
        }
      }
      // 布局函数给出的热点与合成结果一致
      expect(layoutPortScene(c).hotspots).toEqual(hotspots);
    }
  });

  it("同样的参数与帧号画出同样的图；帧号变化时画面在动；悬停只改变描边", () => {
    const c = cases[4];
    const a = composePortScene(c, 12).px.clone();
    const b = composePortScene(c, 12).px.clone();
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    const later = composePortScene(c, 40).px.clone();
    expect(Array.from(later.data)).not.toEqual(Array.from(a.data));
    const hover = composePortScene({ ...c, hover: "market" }, 12).px.clone();
    expect(Array.from(hover.data)).not.toEqual(Array.from(a.data));
    // 复用输出缓冲
    const buf = composePortScene(c, 1).px;
    expect(composePortScene(c, 2, buf).px).toBe(buf);
  });

  it("主角的船只在停泊时出现在海湾里", () => {
    const docked = layoutPortScene(cases[2]);
    expect(docked.berth).not.toBeNull();
    const b = docked.berth!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w).toBeLessThanOrEqual(cases[2].width);
    expect(layoutPortScene({ ...cases[2], flagship: null }).berth).toBeNull();
    expect(layoutPortScene(cases[3]).berth).toBeNull();
  });

  it("矩形相减保留最大的一块", () => {
    expect(cutRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 })).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(cutRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 6, w: 10, h: 10 })).toEqual({ x: 0, y: 0, w: 10, h: 6 });
    expect(cutRect({ x: 0, y: 0, w: 10, h: 10 }, { x: -1, y: -1, w: 20, h: 20 }).w).toBe(0);
  });
});

describe("设施掌柜的问候", () => {
  const ctx = (over: Partial<GreetingContext> = {}): GreetingContext => ({
    locKey: "chenggang",
    port: "澄港",
    faction: "翠岚",
    day: 12,
    season: 0,
    captain: "林远",
    view: port,
    ...over,
  });

  it("每种设施至少 4 句问候，字符串表里都有，占位符都已填好", () => {
    for (const f of FACILITIES) {
      expect(GREETING_COUNT[f]).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < GREETING_COUNT[f]; i++) expect(tk(`portGreet.${f}.${i}`)).not.toBe(`portGreet.${f}.${i}`);
      for (let day = 0; day < 40; day++) {
        const text = greeting(f, ctx({ day }));
        expect(text.startsWith("portGreet")).toBe(false);
        expect(text).not.toMatch(/[{}]/);
      }
    }
  });

  it("按地点与日期确定性挑选：同一天同一句，隔些天会换", () => {
    expect(greeting("market", ctx())).toBe(greeting("market", ctx()));
    const seen = new Set(Array.from({ length: 60 }, (_, day) => greeting("market", ctx({ day }))));
    expect(seen.size).toBeGreaterThanOrEqual(3);
    // 不同港口同一天不一定同一句，但各自稳定
    expect(greeting("tavern", ctx({ locKey: "liuwan" }))).toBe(greeting("tavern", ctx({ locKey: "liuwan" })));
  });

  it("问候语嵌入当地数据；数据为零时换成专门的一句", () => {
    const day = Array.from({ length: 400 }, (_, d) => d).find((d) => greetingKey("market", ctx({ day: d })) === "portGreet.market.0");
    expect(day).toBeDefined();
    expect(greeting("market", ctx({ day }))).toContain("好货有 1 样");
    const tday = Array.from({ length: 400 }, (_, d) => d).find((d) => greetingKey("tavern", ctx({ day: d })) === "portGreet.tavern.0");
    expect(greeting("tavern", ctx({ day: tday }))).toContain("1 位航海士");
    expect(greetingKey("tavern", ctx({ view: { ...port, mates_here: [] } }))).toBe("portGreet.tavern.nomate");
    expect(greetingKey("guild", ctx())).toBe("portGreet.guild.none");
    expect(greetingKey("exchange", ctx({ view: { ...port, exchange: null } }))).toBe("portGreet.exchange.none");
  });
});

describe("港口窗口", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
  });

  it("分页跟随 store 的设施；掌柜先打招呼；分页名称保持原文", async () => {
    render(<PortPanel />);
    const bubble = await screen.findByTestId("keeper-greeting");
    expect(bubble.textContent).toBe(
      greeting("market", {
        locKey: "chenggang",
        port: "澄港",
        faction: "翠岚",
        day: overview.day,
        season: overview.season,
        captain: null,
        view: port,
      }),
    );
    expect(screen.getByRole("tab", { name: "交易所" })).toHaveAttribute("aria-selected", "true");
    // 街景里点了造船厂 → 窗口切到造船厂，显示在售船型大图卡片
    act(() => useGame.getState().setFacility("shipyard"));
    expect(await screen.findByTestId("ship-offer-0")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "造船厂" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByTestId("ship-offer-0")).getByText("单桅帆船")).toBeInTheDocument();
  });

  it("商会委托做成委托书卡片，可以承接", async () => {
    const calls = installIpc({
      port: () => ({
        ...port,
        contracts: [
          { id: 3, issuer: 0, good: 1, qty: 20, to: 1, deadline: 40, reward: 2600, penalty: 800, status: "open", ai: false },
        ],
      }),
    });
    useGame.setState({ facility: "guild" });
    const user = userEvent.setup();
    render(<PortPanel />);
    const card = await screen.findByTestId("contract-3");
    expect(within(card).getByText("兹委托贵船运送 丝绸 20 担，于第 40 天前运抵 柳湾。")).toBeInTheDocument();
    expect(within(card).getByText("2,600 金币")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "承接" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { AcceptContract: { owner: "player", contract: 3 } } }),
    );
  });

  it("酒馆的航海士是带头像与能力条的人物卡", async () => {
    useGame.setState({ facility: "tavern" });
    render(<PortPanel />);
    const card = await screen.findByTestId("tavern-mate-1");
    expect(within(card).getByText("周明远")).toBeInTheDocument();
    expect(within(card).getByText("航海")).toBeInTheDocument();
    expect(within(card).getByText("66")).toBeInTheDocument();
  });
});

describe("街景与掌柜的建筑风格（势力数据的 style 字段）", () => {
  const eastern = { ...statics, factions: statics.factions.map((f) => ({ ...f, style: "eastern" })) };

  it("港口街景的参数带上势力的 style；没写时为 null（按势力 key 映射）", () => {
    expect(sceneParams(eastern, overview, 0).style).toBe("eastern");
    expect(sceneParams(statics, overview, 0).style).toBeNull();
    expect(sceneParams(eastern, overview, 2).style).toBe("eastern");
  });

  it("殖民点的地形取自 LocView.site.terrain；给出殖民地时画成殖民地", () => {
    const wild = sceneParams(colonialStatics, overview, 3);
    expect(wild.kind).toBe("site");
    expect(wild.terrain).toBe("forest");
    expect(wild.facilities).toEqual([]);
    const col = sceneParams(colonialStatics, overview, 3, { buildings: [{ key: "farm", level: 1 }], population: 40, flag: "#abcdef" });
    expect(col.kind).toBe("colony");
    expect(col.terrain).toBe("forest");
    expect(col.flag).toBe("#abcdef");
  });

  it("设施掌柜的衣着与姓名随势力的 style", async () => {
    installIpc();
    startedGame();
    useGame.setState({ statics: eastern });
    render(<PortPanel />);
    await screen.findByTestId("keeper-greeting");
    // 界面按静态数据的地点列表选掌柜（名字跟随所选肖像的性别），这里用同一份列表
    expect(within(screen.getByTestId("keeper")).getByText(keeper("chenggang", "market", "eastern", keeperPlaces(eastern.locations, eastern.factions)).name)).toBeInTheDocument();
  });
});
