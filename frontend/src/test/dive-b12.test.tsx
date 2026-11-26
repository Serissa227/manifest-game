// B12 潜水入口（docs/UI-CONTRACT.md “B12 潜水入口”）：探险窗口的潜水点与航行视图的“潜水”。
// - 探险窗口按选中的舰队列出潜水入口（已经发现过的不列），能潜的给“潜水”、不能的写后端给的原因；名字不从目录里泄露
//   （听过传闻的按传闻的海区称呼），提交 { Dive: { owner, fleet, discovery } }，之后视图照常刷新；
// - 航行视图收着帆时才查潜水入口，旗舰队此处能潜才出“潜水”，选一处提交同一条命令。
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import NavigationView from "../components/nav/NavigationView";
import ExplorePanel from "../components/panels/ExplorePanel";
import { resetNav } from "../hooks/useNavigation";
import type { DiscoveriesView, NavView, Overview, StaticView } from "../ipc/types";
import { useGame } from "../store/game";
import { applyUi, useUiVersion } from "../ui/uiMode";
import { discoveriesView, installIpc, overview, startedGame, statics } from "./fixtures";

/** 目录里只有找到过的 4 号（隐藏世界的静态数据只给发现过的）。 */
const diveStatics: StaticView = {
  ...statics,
  world: { ...statics.world, modules: ["navigation_manual"] },
  discoveries: [{ id: 4, key: "coral_bell", name: "珊瑚钟", kind: "wreck", fame: 10, value: 500, lore: "", dive: true }],
};

/** 0 号舰队：7 号能潜（听过传闻，在内海）、9 号还没收帆、4 号已经找到；1 号舰队也能潜 7 号。 */
const data: DiscoveriesView = {
  ...discoveriesView,
  found: [{ id: 4, day: 3, reported: false, x: 1, y: 0 }],
  total: 3,
  rumors: [{ id: 7, day: 5, region: 0, region_name: "内海", found: false }],
  dives: [
    { fleet: 0, discovery: 9, enabled: false, blocked_reason: "潜水前须收帆或靠港。" },
    { fleet: 0, discovery: 7, enabled: true },
    { fleet: 0, discovery: 4, enabled: false, blocked_reason: "这里已经潜过了。" },
    { fleet: 1, discovery: 7, enabled: true },
  ],
};

const twoFleets: Overview = { ...overview, fleets: [overview.fleets[0], { ...overview.fleets[0], id: 1 }] };

const discoveryCalls = (calls: ReturnType<typeof installIpc>) => calls.mock.calls.filter(([c]) => c === "discoveries").length;
const submitted = (calls: ReturnType<typeof installIpc>) => calls.mock.calls.filter(([c]) => c === "submit").map(([, a]) => (a as { command: unknown }).command);

function setUi(ui: "v1" | "v2") {
  applyUi(ui);
  useUiVersion.setState({ ui });
}

beforeEach(() => {
  startedGame();
  useGame.setState({ statics: diveStatics, overview: twoFleets, selectedFleet: 0 });
});

afterEach(() => {
  cleanup();
  setUi("v1");
  resetNav();
});

describe("探险窗口：潜水点", () => {
  it("只列选中舰队的、还没找到的；能潜的在前；名字按传闻的海区，什么都不知道的写“未探明”", async () => {
    installIpc({ discoveries: () => data });
    render(<ExplorePanel />);
    const box = await screen.findByTestId("explore-dives");
    expect(within(box).getAllByRole("listitem").map((li) => li.getAttribute("data-testid"))).toEqual(["dive-7", "dive-9"]);
    expect(within(box).getByTestId("dive-7")).toHaveTextContent("内海一带的潜水点");
    expect(within(box).getByTestId("dive-9")).toHaveTextContent("未探明的潜水点");
    expect(within(box).queryByTestId("dive-4")).toBeNull();
    // 不能潜：按钮灰着，原因是后端给的那句话，按钮指过去
    const blocked = within(within(box).getByTestId("dive-9")).getByRole("button", { name: "潜水" });
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAccessibleDescription("潜水前须收帆或靠港。");
    expect(within(within(box).getByTestId("dive-7")).getByRole("button", { name: "潜水" })).toBeEnabled();
  });

  it("潜水：提交 Dive（选中的舰队与这处潜水点），回执写称呼，探险记录随后重取", async () => {
    const calls = installIpc({ discoveries: () => data });
    render(<ExplorePanel />);
    const row = await screen.findByTestId("dive-7");
    const before = discoveryCalls(calls);
    await userEvent.click(within(row).getByRole("button", { name: "潜水" }));
    await waitFor(() => expect(submitted(calls)).toContainEqual({ Dive: { owner: "player", fleet: 0, discovery: 7 } }));
    expect(await screen.findByText("潜水完成：内海一带的潜水点")).toBeInTheDocument();
    await waitFor(() => expect(discoveryCalls(calls)).toBeGreaterThan(before));
  });

  it("换选别的舰队：只列那支舰队的；没有潜水入口时不出这一节", async () => {
    installIpc({ discoveries: () => data });
    useGame.setState({ selectedFleet: 1 });
    const { unmount } = render(<ExplorePanel />);
    const box = await screen.findByTestId("explore-dives");
    expect(within(box).getAllByRole("listitem").map((li) => li.getAttribute("data-testid"))).toEqual(["dive-7"]);
    unmount();
    installIpc({ discoveries: () => ({ ...data, dives: undefined }) });
    render(<ExplorePanel />);
    await screen.findByTestId("explore-fame");
    expect(screen.queryByTestId("explore-dives")).toBeNull();
  });

  it("新界面：不能潜的原因就地写（InlineError），按钮同样指过去", async () => {
    setUi("v2");
    installIpc({ discoveries: () => data });
    render(<ExplorePanel />);
    const row = await screen.findByTestId("dive-9");
    expect(within(row).getByTestId("inline-error")).toHaveTextContent("潜水前须收帆或靠港。");
    expect(within(row).getByRole("button", { name: "潜水" })).toHaveAccessibleDescription("潜水前须收帆或靠港。");
  });
});

describe("航行视图：潜水", () => {
  const atSea: Overview = {
    ...twoFleets,
    fleets: [{ ...twoFleets.fleets[0], docked: null, pos: { x: 1.5, y: 1.25 }, heading: 90 }, twoFleets.fleets[1]],
    sighted: [0],
  };
  const nav = (sail: NavView["sail"]): NavView => ({
    fleet: 0,
    mode: "manual",
    day: 12,
    minute: 0,
    pos: { x: 1.5, y: 1.25 },
    heading: 90,
    sail,
    speed: sail === "furled" ? 0.4 : 5,
    wind: { dir: 0, force: 3, name: "北风 3 级" },
    current: null,
    sail_limit: 67,
    trail: [],
    forecast: [],
    stops: [],
    supplies_days: 9,
    morale: 70,
    sight: 6,
    autopilot: null,
    known_dests: [],
    lat_lon: null,
  });

  it("张着帆时不查潜水入口，也没有“潜水”", async () => {
    const calls = installIpc({ navigation: () => nav("half"), discoveries: () => data });
    useGame.setState({ overview: atSea });
    render(<NavigationView source={null} />);
    await screen.findByTestId("nav-actions");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("nav-dive-open")).toBeNull();
    expect(discoveryCalls(calls)).toBe(0);
  });

  it("收着帆、旗舰队此处能潜：出“潜水”，菜单只列能潜的，选一处提交 Dive 并回一句", async () => {
    const calls = installIpc({ navigation: () => nav("furled"), discoveries: () => data, submit: () => ({ outcome: "Done", overview: atSea }) });
    useGame.setState({ overview: atSea });
    render(<NavigationView source={null} />);
    await userEvent.click(await screen.findByTestId("nav-dive-open"));
    const menu = screen.getByTestId("nav-dive-menu");
    expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["内海一带的潜水点"]);
    await userEvent.click(within(menu).getByTestId("nav-dive-7"));
    await waitFor(() => expect(submitted(calls)).toContainEqual({ Dive: { owner: "player", fleet: 0, discovery: 7 } }));
    await waitFor(() => expect(useGame.getState().message).toBe("潜水完成：内海一带的潜水点"));
  });

  it("收着帆但此处潜不了：不出“潜水”（原因看探险窗口）", async () => {
    installIpc({ navigation: () => nav("furled"), discoveries: () => ({ ...data, dives: data.dives?.filter((d) => !d.enabled) }) });
    useGame.setState({ overview: atSea });
    render(<NavigationView source={null} />);
    await screen.findByTestId("nav-actions");
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("nav-dive-open")).toBeNull();
  });
});
