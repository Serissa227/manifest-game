// 城镇（docs/ECONOMY.md 6.4、6.5，第八批 E4）：港口窗口标题下的人口与繁荣度、“港口投资”页的城镇详情、“交易所”页的城镇工坊与商品的需求层级，
// 航海图地点列表里的市况标记，市况变化的日志文案；旧后端没有这些字段时照常显示。模拟的 Tauri IPC，不调用任何真实服务。
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MapView from "../components/MapView";
import PortPanel from "../components/panels/PortPanel";
import { setLocale } from "../i18n/locale";
import { tk } from "../i18n";
import type { Overview, PeopleView, PortView, StaticView, WorkshopView } from "../ipc/types";
import { createMapRenderer } from "../map/renderer";
import { useGame } from "../store/game";
import { installIpc, overview, port, startedGame, statics } from "./fixtures";

vi.mock("../map/renderer", () => ({ createMapRenderer: vi.fn() }));
const create = vi.mocked(createMapRenderer);

const people: PeopleView = {
  pop: 35_000,
  pop0: 34_000,
  prosperity_bp: 640_000,
  goal_bp: 700_000,
  condition: "boom",
  since: 400,
  sat_bp: [10_000, 8_200, 6_100],
  growth_bp: 7,
  learning: false,
};
const loom: WorkshopView = {
  recipe: 0,
  output: 1,
  out_qty: 1,
  inputs: [[0, 2]],
  share_bp: 5_000,
  daily_bp: 31_000,
  capacity_bp: 10_300,
  made: 3,
  short: true,
  stopped: false,
  value_bp: 14_500,
  learning: false,
};
const town: PortView = { ...port, people, workshops: [loom] };
/** 丝绸标成奢侈品、谷物标成必需品（后端 GoodView.need） */
const tiered: StaticView = {
  ...statics,
  goods: statics.goods.map((g) => ({
    ...g,
    need: g.key === "silk" ? "luxury" : g.key === "grain" ? "essential" : null,
  })),
};

describe("港口窗口：城镇的人口、繁荣度、市况与工坊", () => {
  beforeEach(() => {
    setLocale("zh-CN");
    installIpc({ port: () => town, static_data: () => tiered });
    startedGame();
    useGame.setState({ statics: tiered, facility: "market" });
  });

  it("标题下写人口与繁荣度，繁荣的港口带市况标签", async () => {
    render(<PortPanel />);
    expect(await screen.findByTestId("town-line")).toHaveTextContent("人口 35,000 · 繁荣度 64");
    const tag = screen.getByTestId("town-condition");
    expect(tag).toHaveTextContent("繁荣");
    expect(tag).toHaveAttribute("title", tk("portConditionHint.boom"));
  });

  it("交易所页列出城镇工坊：配方、产能、今天的产出、缺料；选中商品时说明它的需求层级", async () => {
    render(<PortPanel />);
    const shop = await screen.findByTestId("workshop-0");
    expect(shop).toHaveTextContent("织丝：谷物 2 → 丝绸 1");
    expect(shop).toHaveTextContent("产能每天 3.1 件（开局的 103%），接手当地产量的 50%");
    expect(shop).toHaveTextContent("今天做了 3 件");
    expect(shop).toHaveTextContent("上月产出价值是原料的 1.45 倍");
    expect(within(shop).getByText("缺料")).toBeInTheDocument();
    expect(within(shop).queryByText("亏本停工")).toBeNull();
    await userEvent.click(screen.getByTestId("market-row-1"));
    expect(screen.getByTestId("market-need")).toHaveTextContent("奢侈品：需求随繁荣度成倍变化");
  });

  it("港口投资页的城镇：人口与每月增幅、繁荣度与目标、市况起始日、三层需求满足度", async () => {
    useGame.setState({ facility: "invest" });
    render(<PortPanel />);
    const sec = await screen.findByTestId("town-section");
    expect(sec).toHaveTextContent("35,000（开局 34,000）");
    expect(sec).toHaveTextContent("每月 +0.07%");
    expect(within(sec).getByTestId("town-prosperity")).toHaveTextContent("64，正在向 70 靠近");
    expect(sec).toHaveTextContent("繁荣（");
    const needs = within(sec).getByTestId("town-needs");
    expect(needs).toHaveTextContent("必需品");
    expect(needs).toHaveTextContent("100%");
    expect(needs).toHaveTextContent("82%");
    expect(needs).toHaveTextContent("61%");
  });

  it("头一年：说明繁荣度与人口暂不变化，不列满足度；停工的工坊标出来", async () => {
    useGame.setState({ facility: "invest" });
    installIpc({
      port: () => ({
        ...town,
        people: { ...people, learning: true, condition: "stable" },
        workshops: [{ ...loom, stopped: true }],
      }),
      static_data: () => tiered,
    });
    render(<PortPanel />);
    const sec = await screen.findByTestId("town-section");
    expect(sec).toHaveTextContent("头一年");
    expect(within(sec).queryByTestId("town-needs")).toBeNull();
    expect(screen.queryByTestId("town-condition")).toBeNull();
    useGame.setState({ facility: "market" });
    expect(await screen.findByText("亏本停工")).toBeInTheDocument();
  });

  it("旧后端没有城镇字段：不显示这些部分，也不出错", async () => {
    installIpc({ port: () => port, static_data: () => statics });
    useGame.setState({ statics });
    render(<PortPanel />);
    expect(await screen.findByTestId("market")).toBeInTheDocument();
    expect(screen.queryByTestId("town-line")).toBeNull();
    expect(screen.queryByTestId("workshops")).toBeNull();
  });

  it("英文：市况与城镇的文字都有翻译", async () => {
    setLocale("en");
    render(<PortPanel />);
    expect(await screen.findByTestId("town-line")).toHaveTextContent("Population 35,000 · Prosperity 64");
    expect(screen.getByTestId("town-condition")).toHaveTextContent("Boom");
    expect(await screen.findByTestId("workshop-0")).toHaveTextContent("Short of materials");
    setLocale("zh-CN");
  });
});

describe("航海图与日志：港口的市况", () => {
  const withMarks: Overview = {
    ...overview,
    port_conditions: [
      { loc: 1, condition: "famine", since: 300 },
      { loc: 2, condition: "glut", since: 320 },
    ],
  };
  beforeEach(() => {
    setLocale("zh-CN");
    installIpc({ overview: () => withMarks });
    startedGame();
    useGame.setState({ overview: withMarks });
    create.mockReset();
    create.mockReturnValue(new Promise(() => {}));
  });

  it("地点列表里，市况不是平稳的港口与城市带上标签", () => {
    render(<MapView />);
    const list = screen.getByRole("navigation", { name: "地点列表" });
    expect(within(list).getByTestId("chart-condition-1")).toHaveTextContent("饥荒");
    expect(within(list).getByTestId("chart-condition-2")).toHaveTextContent("过剩");
    expect(within(list).queryByTestId("chart-condition-0")).toBeNull();
  });

  it("日志：某地市况转为某某", () => {
    expect(tk("log.PortCondition", { loc: "柳湾", condition: "famine" })).toBe("柳湾 的市况转为饥荒");
    setLocale("en");
    expect(tk("log.PortCondition", { loc: "Riverbend", condition: "boom" })).toBe("Riverbend: conditions turn to Boom");
    setLocale("zh-CN");
  });
});
