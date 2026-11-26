// 跨世界的读档与非经典世界的经典向导：存档在别的世界时先按它换上静态数据再进入游戏（开局画面与顶栏两处读档）；
// 世界多于一个时存档行写上世界名；没有主角名册的非经典世界（框架测试海域）照经典向导开局，但调用的是 new_world_game。
import { render, screen, waitFor } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import StartScreen from "../components/StartScreen";
import TopBar from "../components/TopBar";
import type { Overview, ScenarioCard, StaticView, WorldCard, WorldCatalog } from "../ipc/types";
import { resetSightSync, useGame } from "../store/game";
import { installIpc, overview, startedGame, statics } from "./fixtures";

const terraStatics: StaticView = { ...statics, world: { ...statics.world, key: "terra16", name: "寰宇·十六世纪" } };
const terraSave: Overview = { ...overview, world_key: "terra16" };

/** 记下第一次放进概览的那一刻静态数据是哪个世界的（“先换静态数据，再进入游戏”）。 */
function worldAtEnter(): { key: string | undefined | null } {
  const seen = { key: null as string | undefined | null };
  const off = useGame.subscribe((s, prev) => {
    if (s.overview && s.overview !== prev.overview && seen.key === null) {
      seen.key = s.statics?.world?.key;
      off();
    }
  });
  return seen;
}

function reset() {
  resetSightSync();
  useGame.setState({ statics, overview: null, version: 0, selectedLoc: null, selectedFleet: null, error: null, message: null });
}

describe("跨世界读档", () => {
  beforeEach(reset);

  it("开局画面读一个寰宇的存档：先重取静态数据（换成寰宇），再进入游戏", async () => {
    const calls = installIpc({
      list_saves: () => [{ slot: "far", day: 30, scenario: "更远之处", net_worth: 50000, world_key: "terra16", scenario_key: "plus_ultra" }],
      load_game: () => terraSave,
      static_data: () => terraStatics,
    });
    const seen = worldAtEnter();
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await user.click(await screen.findByRole("button", { name: "读取存档（1）" }));
    await user.click(screen.getByRole("button", { name: "读取存档 far" }));
    await waitFor(() => expect(useGame.getState().overview).not.toBeNull());
    expect(seen.key).toBe("terra16");
    const names = calls.mock.calls.map((c) => c[0]).filter((n) => n === "load_game" || n === "static_data");
    expect(names).toEqual(["load_game", "static_data"]);
  });

  it("同一个世界、不按看见过滤的存档：不重取静态数据", async () => {
    const calls = installIpc({ list_saves: () => [{ slot: "home", day: 30, scenario: "新晋船主", net_worth: 50000, world_key: "classic" }] });
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await user.click(await screen.findByRole("button", { name: "读取存档（1）" }));
    await user.click(screen.getByRole("button", { name: "读取存档 home" }));
    await waitFor(() => expect(useGame.getState().overview).not.toBeNull());
    expect(calls).not.toHaveBeenCalledWith("static_data", expect.anything());
  });

  it("顶栏读档读进别的世界：同样先换静态数据再放入概览", async () => {
    startedGame();
    const calls = installIpc({ load_game: () => terraSave, static_data: () => terraStatics });
    const seen = { key: null as string | undefined | null };
    const off = useGame.subscribe((s, prev) => {
      if (s.overview !== prev.overview && s.overview?.world_key === "terra16" && seen.key === null) seen.key = s.statics?.world?.key;
    });
    const user = userEvent.setup();
    render(<TopBar />);
    await user.click(screen.getByRole("button", { name: "读档" }));
    await waitFor(() => expect(useGame.getState().overview?.world_key).toBe("terra16"));
    off();
    expect(seen.key).toBe("terra16");
    expect(calls).toHaveBeenCalledWith("static_data", expect.anything());
    expect(useGame.getState().message).toBe("已读档：save1");
  });

  it("世界多于一个时，存档行在剧本前写上世界名；只有一个世界时不写", async () => {
    const card = (key: string, name: string): WorldCard => ({
      key,
      name,
      tagline: "",
      description: "",
      map_key: key,
      era: "公元",
      start_year: 1553,
      currency: "金币",
      modules: [],
      scenarios: [],
    });
    const saves = [{ slot: "far", day: 30, scenario: "更远之处", net_worth: 50000, world_key: "terra16" }];
    installIpc({ list_saves: () => saves, world_catalog: () => ({ current: null, worlds: [card("classic", "维斯塔海"), card("terra16", "寰宇·十六世纪")] }) });
    const user = userEvent.setup();
    const { unmount } = render(<StartScreen roll={0} />);
    await user.click(await screen.findByRole("button", { name: "读取存档（1）" }));
    expect(await screen.findByText(/^寰宇·十六世纪 · 更远之处 · /)).toBeInTheDocument();
    unmount();
    installIpc({ list_saves: () => saves, world_catalog: () => ({ current: null, worlds: [card("terra16", "寰宇·十六世纪")] }) });
    render(<StartScreen roll={0} />);
    await user.click(await screen.findByRole("button", { name: "读取存档（1）" }));
    expect(await screen.findByText(/^更远之处 · /)).toBeInTheDocument();
  });

  it("旧剧本下线：有别的世界时，经典世界的存档行不能读（写明原因、可以删除），寰宇的照常读", async () => {
    const card = (key: string, name: string): WorldCard => ({
      key,
      name,
      tagline: "",
      description: "",
      map_key: key,
      era: "公元",
      start_year: 1553,
      currency: "金币",
      modules: [],
      scenarios: [],
    });
    const saves = [
      { slot: "old", day: 30, scenario: "白手起家", net_worth: 5000, world_key: "classic" },
      { slot: "far", day: 30, scenario: "更远之处", net_worth: 50000, world_key: "terra16" },
    ];
    const calls = installIpc({ list_saves: () => saves, world_catalog: () => ({ current: null, worlds: [card("classic", "维斯塔海"), card("terra16", "寰宇·十六世纪")] }) });
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await user.click(await screen.findByRole("button", { name: "读取存档（2）" }));
    const old = await screen.findByRole("button", { name: "读取存档 old" });
    expect(old).toBeDisabled();
    expect(old).toHaveTextContent("旧剧本已下线");
    expect(screen.getByRole("button", { name: "读取存档 far" })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: /删除/ }).length).toBe(2);
    expect(calls).not.toHaveBeenCalledWith("load_game", { slot: "old" });
  });
});

describe("没有主角名册的非经典世界", () => {
  beforeEach(reset);

  const sandbox: ScenarioCard = {
    key: "newcomer",
    name: "测试航行",
    description: "两个小岛之间的测试航程。",
    start_date: [1, 1, 1],
    control_date: [1, 1, 1],
    upbringing: false,
    protagonists: [],
    templates: [],
    goal: { kind: "sandbox", target: 0, years: null },
    options: { history_toggle: false, skip_upbringing: false },
  };
  const world = (key: string, name: string, scenarios: ScenarioCard[]): WorldCard => ({
    key,
    name,
    tagline: "",
    description: "",
    map_key: key,
    era: "公元",
    start_year: 1502,
    currency: "金币",
    modules: [],
    scenarios,
  });
  const catalog: WorldCatalog = { current: null, worlds: [world("classic", "维斯塔海", []), world("testbed", "框架测试海域", [sandbox])] };

  /** 步骤条上的当前步。 */
  const currentStep = () =>
    (screen.getAllByRole("button").find((b) => b.getAttribute("aria-current") === "step")?.textContent ?? "").replace(/^\d+/, "");
  async function goTo(user: UserEvent, label: string) {
    for (let i = 0; i < 12 && currentStep() !== label; i++) await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(currentStep()).toBe(label);
  }

  it("框架测试海域走经典向导，启航时调用 new_world_game（不调用只开经典世界的 new_game），随后设置主角", async () => {
    const testbedStatics: StaticView = { ...statics, world: { ...statics.world, key: "testbed" } };
    const calls = installIpc({
      world_catalog: () => catalog,
      select_world: () => testbedStatics,
      new_world_game: () => ({ ...overview, world_key: "testbed" }),
      set_captain: (args) => ({ ...overview, world_key: "testbed", captain: args.captain }),
      static_data: () => testbedStatics,
    });
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    // 经典 + 测试海域：新开局只剩测试海域，不选世界，直接切过去
    await waitFor(() => expect(calls).toHaveBeenCalledWith("select_world", { world: "testbed" }));
    expect(await screen.findByRole("heading", { name: "选择开局剧本" })).toBeInTheDocument();
    await goTo(user, "启航");
    await user.click(screen.getByRole("button", { name: "开始新游戏" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("new_world_game", { request: { world: "testbed", scenario: "newcomer", seed: null, info: "carried" } }),
    );
    await waitFor(() => expect(calls).toHaveBeenCalledWith("set_captain", expect.anything()));
    expect(calls).not.toHaveBeenCalledWith("new_game", expect.anything());
    // 行情情报随请求给了后端：不再单独提交 SetInfoMode
    expect(calls).not.toHaveBeenCalledWith("submit", { command: { SetInfoMode: { owner: "player", mode: "carried" } } });
    await waitFor(() => expect(useGame.getState().overview?.world_key).toBe("testbed"));
    expect(useGame.getState().statics?.world?.key).toBe("testbed");
  });

  it("经典世界照旧调用 new_game（只有经典一个世界时；有别的世界时经典不再出现在新开局里）", async () => {
    const calls = installIpc({ world_catalog: () => ({ current: null, worlds: [catalog.worlds[0]] }), select_world: () => statics });
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    expect(await screen.findByRole("heading", { name: "选择开局剧本" })).toBeInTheDocument();
    expect(calls).not.toHaveBeenCalledWith("select_world", expect.anything());
    await goTo(user, "启航");
    await user.click(screen.getByRole("button", { name: "开始新游戏" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("new_game", { scenario: "newcomer", seed: null }));
    expect(calls).not.toHaveBeenCalledWith("new_world_game", expect.anything());
  });
});
