// 航海图的地点列表与图例：殖民点单独成组（“未开拓之地”），按概览里的状态显示未开拓 / 势力占领 / 殖民地；
// 有殖民点与发现物的世界才在图例中列出它们。（PixiJS 渲染器以桩代替。）
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYER_FLAG } from "../art/map";
import MapView from "../components/MapView";
import type { LocView, Overview, StaticView } from "../ipc/types";
import { discoveryMarks, siteMark, siteState, siteStates } from "../map/marks";
import { createMapRenderer } from "../map/renderer";
import { useGame } from "../store/game";
import { installIpc, overview, startedGame, statics } from "./fixtures";

vi.mock("../map/renderer", () => ({ createMapRenderer: vi.fn() }));
const create = vi.mocked(createMapRenderer);

/** 在测试世界里加三个殖民点与一件发现物（后端的实际字段：地点 kind "site"，归属在概览的 site_claims 与 colonies）。 */
const site = (id: number, name: string, x: number, y: number): LocView => ({
  id,
  key: `site${id}`,
  name,
  kind: "site",
  x,
  y,
  faction: 0,
  shipyard: false,
  founded: null,
  lore: "",
  site: { terrain: "forest", fertility: 50, hazard: 20, resources: [] },
});
const withSites: StaticView = {
  ...statics,
  locations: [...statics.locations, site(3, "银雾河口", 0, 0), site(4, "翡翠峡湾", 0, 2), site(5, "晨星岬", 2, 0)],
  discoveries: [{ id: 0, key: "arch", name: "鲸骨拱门", kind: "landmark", fame: 10, value: 1000, lore: "" }],
};
const sitesOverview: Overview = {
  ...overview,
  colonies: [{ id: 0, name: "新晨港", loc: 5, population: 120, morale: 60, starving_days: 0, food_days: 30, construction: null }],
  site_claims: [
    { loc: 4, faction: 1, colony: null, mine: false },
    { loc: 5, faction: null, colony: 0, mine: true },
  ],
  discoveries_unreported: 1,
};

describe("航海图的殖民点分组", () => {
  beforeEach(() => {
    installIpc({ static_data: () => withSites, overview: () => sitesOverview });
    startedGame();
    useGame.setState({ statics: withSites, overview: sitesOverview });
    create.mockReset();
    create.mockReturnValue(new Promise(() => {}));
  });

  it("港口与城市照旧列在“地点”里，殖民点另列在“未开拓之地”下，并说明各自的状态", () => {
    render(<MapView />);
    const towns = screen.getByRole("navigation", { name: "地点列表" });
    expect(within(towns).getByRole("button", { name: /澄港/ })).toBeInTheDocument();
    expect(within(towns).queryByRole("button", { name: /银雾河口/ })).toBeNull();
    const sites = screen.getByRole("navigation", { name: "未开拓之地" });
    expect(within(sites).getAllByRole("button")).toHaveLength(3);
    expect(within(sites).getByRole("button", { name: /银雾河口/ })).toHaveAttribute("title", "殖民点（未开拓）");
    expect(within(sites).getByRole("button", { name: /翡翠峡湾/ })).toHaveAttribute("title", "殖民点（已被金穗占领）");
    expect(within(sites).getByRole("button", { name: /晨星岬/ })).toHaveAttribute("title", "殖民地：新晨港");
  });

  it("图例列出殖民点、势力占领、殖民地与发现物", () => {
    render(<MapView />);
    const legend = screen.getByRole("list", { name: "图例" });
    for (const text of ["殖民点（未开拓）", "势力占领", "殖民地", "发现物", "港口", "内陆城市"]) expect(within(legend).getByText(text)).toBeInTheDocument();
  });

  it("点选殖民点与点选港口一样选中它", async () => {
    render(<MapView />);
    await userEvent.click(screen.getByRole("button", { name: /银雾河口/ }));
    expect(useGame.getState().selectedLoc).toBe(3);
  });

  it("没有殖民点的旧世界不显示分组与相关图例", () => {
    useGame.setState({ statics, overview });
    render(<MapView />);
    expect(screen.queryByText("未开拓之地")).toBeNull();
    expect(screen.queryByText("势力占领")).toBeNull();
    expect(screen.queryByText("发现物")).toBeNull();
  });
});

describe("地点列表的分组与查找", () => {
  beforeEach(() => {
    installIpc({ static_data: () => withSites, overview: () => sitesOverview });
    startedGame();
    useGame.setState({ statics: withSites, overview: sitesOverview, tab: "port", selectedColony: null });
    create.mockReset();
    create.mockReturnValue(new Promise(() => {}));
  });

  it("港口与内陆城市分两组；殖民点按现状分为我的殖民地、尚未开拓、已被占领，组名带个数", () => {
    render(<MapView />);
    const towns = screen.getByRole("navigation", { name: "地点列表" });
    const ports = within(towns).getByRole("group", { name: "港口（2）" });
    expect(within(ports).getAllByRole("button").map((b) => b.textContent)).toEqual(["澄港 ⛵", "柳湾"]);
    expect(within(within(towns).getByRole("group", { name: "内陆城市（1）" })).getByRole("button", { name: /兰城/ })).toBeInTheDocument();

    const sites = screen.getByRole("navigation", { name: "未开拓之地" });
    const groups = within(sites).getAllByRole("group");
    expect(groups.map((g) => g.querySelector("h5")?.textContent)).toEqual(["我的殖民地（1）", "尚未开拓（1）", "已被占领（1）"]);
    expect(within(groups[0]).getByRole("button", { name: /晨星岬/ })).toBeInTheDocument();
    expect(within(groups[1]).getByRole("button", { name: /银雾河口/ })).toBeInTheDocument();
    expect(within(groups[2]).getByRole("button", { name: /翡翠峡湾/ })).toBeInTheDocument();
  });

  it("他人的殖民地单独成组，说明为“殖民地（他人所有）”", () => {
    useGame.setState({ overview: { ...sitesOverview, site_claims: [...sitesOverview.site_claims, { loc: 3, faction: null, colony: 7, mine: false }] } });
    render(<MapView />);
    const sites = screen.getByRole("navigation", { name: "未开拓之地" });
    const other = within(sites).getByRole("group", { name: "他人的殖民地（1）" });
    expect(within(other).getByRole("button", { name: /银雾河口/ })).toHaveAttribute("title", "殖民地（他人所有）");
    expect(within(sites).queryByRole("group", { name: /尚未开拓/ })).toBeNull();
  });

  it("平时点选殖民点切到“殖民地”页：我的殖民地同时选中该殖民地，其余清空选中的殖民地", async () => {
    const user = userEvent.setup();
    render(<MapView />);
    await user.click(screen.getByRole("button", { name: /晨星岬/ }));
    expect(useGame.getState()).toMatchObject({ selectedLoc: 5, selectedColony: 0, tab: "colonies" });
    await user.click(screen.getByRole("button", { name: /翡翠峡湾/ }));
    expect(useGame.getState()).toMatchObject({ selectedLoc: 4, selectedColony: null, tab: "colonies" });
    // 港口照旧切到港口页
    await user.click(screen.getByRole("button", { name: /柳湾/ }));
    expect(useGame.getState()).toMatchObject({ selectedLoc: 1, tab: "port" });
  });

  it("地点多时可以按名字查找；没有相符的地点时给出说明", async () => {
    const many: StaticView = {
      ...withSites,
      locations: [...withSites.locations, ...Array.from({ length: 10 }, (_, i) => site(6 + i, `无名湾${i + 1}`, 1, 1))],
    };
    useGame.setState({ statics: many });
    const user = userEvent.setup();
    render(<MapView />);
    const box = screen.getByRole("searchbox", { name: "查找地点" });
    await user.type(box, "峡");
    const sites = screen.getByRole("navigation", { name: "未开拓之地" });
    expect(within(sites).getAllByRole("button").map((b) => b.textContent)).toEqual(["翡翠峡湾"]);
    expect(within(screen.getByRole("navigation", { name: "地点列表" })).queryAllByRole("button")).toHaveLength(0);
    await user.clear(box);
    await user.type(box, "找不到的地名");
    expect(screen.getByText("没有名字相符的地点。")).toBeInTheDocument();
    await user.clear(box);
    expect(within(screen.getByRole("navigation", { name: "未开拓之地" })).getAllByRole("button")).toHaveLength(13);
  });

  it("地点少的旧世界不显示查找框", () => {
    useGame.setState({ statics, overview });
    render(<MapView />);
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});

describe("海图标记数据（后端字段）", () => {
  it("殖民点的现状来自概览的 site_claims 与 colonies；标记按现状取旗色", () => {
    const states = siteStates(sitesOverview);
    expect(siteState(states, 3)).toMatchObject({ status: "wild", faction: null, colony: null });
    expect(siteState(states, 4)).toMatchObject({ status: "claimed", faction: 1 });
    expect(siteState(states, 5)).toMatchObject({ status: "mine", colony: 0, name: "新晨港", population: 120 });
    // 势力占领：势力的旗色；我的殖民地：金旗，规模按人口分档；无主：默认画法
    expect(siteMark(withSites, siteState(states, 4))).toEqual({ claim: "#2e86c1" });
    expect(siteMark(withSites, siteState(states, 5))).toEqual({ colony: { flag: PLAYER_FLAG, size: 1 } });
    expect(siteMark(withSites, siteState(states, 3))).toEqual({});
    // 他人的殖民地：不是金旗
    const other = siteStates({ ...sitesOverview, colonies: [], site_claims: [{ loc: 3, faction: null, colony: 7, mine: false }] });
    expect(siteState(other, 3).status).toBe("other");
    expect(siteMark(withSites, siteState(other, 3)).colony?.flag).not.toBe(PLAYER_FLAG);
  });

  it("发现物标记只列出已发现的：位置取自 found，名称与种类取自目录，目录里没有的跳过", () => {
    const two: StaticView = {
      ...withSites,
      discoveries: [...withSites.discoveries, { id: 1, key: "sunken_gate", name: "沉没之门", kind: "ruins", fame: 30, value: 4000, lore: "" }],
    };
    expect(discoveryMarks(two, [])).toEqual([]);
    const marks = discoveryMarks(two, [
      { id: 1, day: 8, reported: false, x: 3, y: 2 },
      { id: 9, day: 9, reported: false, x: 1, y: 1 },
    ]);
    expect(marks).toEqual([{ id: 1, key: "sunken_gate", name: "沉没之门", kind: "ruins", x: 3, y: 2, day: 8, reported: false }]);
    // 旧世界没有发现物目录：什么也不显示
    expect(discoveryMarks(statics, [{ id: 0, day: 1, reported: true, x: 0, y: 0 }])).toEqual([]);
  });
});
