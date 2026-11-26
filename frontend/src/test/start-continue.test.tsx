// 标题画面的“继续”、读档与读取世界时的等待提示。
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StartScreen from "../components/StartScreen";
import { continueNote, continueSave, waitText } from "../components/start/continueSave";
import { loadFrom } from "../components/shell/saveSlots";
import type { Overview, SaveInfo, StaticView, WorldCard, WorldCatalog } from "../ipc/types";
import { resetSightSync, useGame } from "../store/game";
import { installIpc, overview, startedGame, statics } from "./fixtures";

const save = (slot: string, extra: Partial<SaveInfo> = {}): SaveInfo => ({
  slot,
  day: 30,
  scenario: "链与缎带·1553",
  net_worth: 500,
  world_key: "terra16",
  ...extra,
});

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

/** 一个手动放行的回复：resolve 之前命令一直在等（模拟后端还在读世界）。 */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function reset() {
  resetSightSync();
  useGame.setState({ statics, overview: null, version: 0, selectedLoc: null, selectedFleet: null, error: null, message: null });
}

describe("“继续”挑哪一局", () => {
  it("挑写入时刻最近的；一样新时取列表里靠前的", () => {
    const saves = [save("a", { modified: 100 }), save("autosave", { modified: 300 }), save("b", { modified: 300 })];
    expect(continueSave(saves)?.slot).toBe("autosave");
    expect(continueSave([save("a", { modified: 5 }), save("b", { modified: 9 })])?.slot).toBe("b");
  });

  it("下线的世界不挑；旧后端没有写入时刻时读自动存档，没有自动存档就不给“继续”", () => {
    const retired = (key: string) => key === "classic";
    const saves = [save("old", { world_key: "classic", modified: 900 }), save("far", { modified: 100 })];
    expect(continueSave(saves, retired)?.slot).toBe("far");
    expect(continueSave([save("x"), save("autosave")])?.slot).toBe("autosave");
    expect(continueSave([save("x"), save("y")])).toBeNull();
    expect(continueSave([])).toBeNull();
    expect(continueSave([save("old", { world_key: "classic", modified: 1 })], retired)).toBeNull();
  });

  it("小字写主角名与剧本名，没有名字时只写剧本名", () => {
    expect(continueNote(save("a", { hero: "诺埃尔" }))).toBe("诺埃尔 · 链与缎带·1553");
    expect(continueNote(save("a", { captain: { name: "阿洛", portrait: 3 } }))).toBe("阿洛 · 链与缎带·1553");
    expect(continueNote(save("a"))).toBe("链与缎带·1553");
  });

  it("等待提示：头几秒只写“正在……”，等久了写上秒数与原因", () => {
    expect(waitText("save", 0)).toBe("正在读档……");
    expect(waitText("save", 5)).toContain("已等 5 秒");
    expect(waitText("world", 1)).toBe("正在读取世界……");
    expect(waitText("world", 12)).toContain("已等 12 秒");
  });
});

describe("标题画面的“继续”", () => {
  beforeEach(reset);

  it("有存档时主菜单最前面是“继续”，一键读最近的那一局并进入游戏", async () => {
    const terraStatics: StaticView = { ...statics, world: { ...statics.world, key: "terra16", name: "寰宇·十六世纪" } };
    const loaded: Overview = { ...overview, world_key: "terra16" };
    const calls = installIpc({
      list_saves: () => [save("autosave", { modified: 50, hero: "诺埃尔" }), save("mine", { modified: 80, hero: "诺埃尔", day: 99 })],
      load_game: () => loaded,
      static_data: () => terraStatics,
    });
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    const resume = await screen.findByTestId("start-continue");
    expect(resume).toHaveTextContent("继续");
    expect(resume).toHaveTextContent("诺埃尔 · 链与缎带·1553");
    await user.click(resume);
    await waitFor(() => expect(useGame.getState().overview?.world_key).toBe("terra16"));
    expect(calls).toHaveBeenCalledWith("load_game", { slot: "mine" });
    expect(useGame.getState().statics?.world?.key).toBe("terra16");
  });

  it("没有存档时没有“继续”", async () => {
    installIpc({ list_saves: () => [] });
    render(<StartScreen roll={0} />);
    expect(await screen.findByRole("button", { name: "读取存档" })).toBeInTheDocument();
    expect(screen.queryByTestId("start-continue")).toBeNull();
  });

  it("读档途中写着“正在读档……”，按钮不能再点；读完提示消失", async () => {
    const pending = deferred<Overview>();
    installIpc({ list_saves: () => [save("mine", { modified: 80 })], load_game: () => pending.promise });
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await user.click(await screen.findByTestId("start-continue"));
    expect(await screen.findByTestId("start-loading-save")).toHaveTextContent("正在读档……");
    expect(screen.getByTestId("start-continue")).toBeDisabled();
    await act(async () => pending.resolve({ ...overview, world_key: "classic" }));
    await waitFor(() => expect(useGame.getState().overview).not.toBeNull());
  });

  it("读档失败时提示消失、显示错误，还能再点", async () => {
    installIpc({
      list_saves: () => [save("mine", { modified: 80 })],
      load_game: () => Promise.reject("存档：读取存档失败：找不到文件"),
    });
    const user = userEvent.setup();
    render(<StartScreen roll={0} />);
    await user.click(await screen.findByTestId("start-continue"));
    // FE4（2026-11-15）起标题画面读档失败写人话，后端原文只进控制台：这条报错属于“找不到存档”那一类
    await waitFor(() => expect(useGame.getState().error).toBe("没有叫“mine”的存档。"));
    expect(screen.queryByTestId("start-loading-save")).toBeNull();
    expect(screen.getByTestId("start-continue")).toBeEnabled();
    expect(useGame.getState().overview).toBeNull();
  });

  it("已下线的世界（有别的世界时的经典存档）不当“继续”", async () => {
    installIpc({
      list_saves: () => [save("old", { world_key: "classic", modified: 900 }), save("far", { modified: 100 })],
      world_catalog: (): WorldCatalog => ({ current: null, worlds: [card("classic", "维斯塔海"), card("terra16", "寰宇·十六世纪")] }),
    });
    render(<StartScreen roll={0} />);
    await waitFor(() => expect(screen.getByTestId("start-continue")).toHaveTextContent("链与缎带·1553"));
    const calls = installIpc({ load_game: () => ({ ...overview, world_key: "terra16" }) });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("start-continue"));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("load_game", { slot: "far" }));
  });
});

describe("“继续”与世界目录", () => {
  beforeEach(reset);

  it("世界目录还没到时不拿经典世界的存档当“继续”；到了、经典没下线时再给", async () => {
    const pending = deferred<WorldCatalog>();
    installIpc({ list_saves: () => [save("old", { world_key: "classic", modified: 900 })], world_catalog: () => pending.promise });
    render(<StartScreen roll={0} />);
    expect(await screen.findByRole("button", { name: "读取存档（1）" })).toBeInTheDocument();
    expect(screen.queryByTestId("start-continue")).toBeNull();
    await act(async () => pending.resolve({ current: null, worlds: [card("classic", "维斯塔海")] }));
    expect(await screen.findByTestId("start-continue")).toBeInTheDocument();
  });
});

describe("世界还在后台读进来时", () => {
  beforeEach(reset);
  afterEach(() => vi.useRealTimers());

  it("外壳的开局画面：世界目录到之前“新的航程”写“正在读取世界……”，到了换成开局向导", async () => {
    const pending = deferred<WorldCatalog>();
    installIpc({ world_catalog: () => pending.promise });
    render(<StartScreen roll={0} waitWorlds />);
    expect(await screen.findByTestId("world-loading")).toHaveTextContent("正在读取世界……");
    expect(screen.queryByRole("navigation", { name: "开局步骤" })).toBeNull();
    // 主菜单照常能点：读档不必等世界
    expect(screen.getByRole("button", { name: "读取存档" })).toBeEnabled();
    await act(async () => pending.resolve({ current: null, worlds: [card("classic", "维斯塔海")] }));
    expect(await screen.findByRole("navigation", { name: "开局步骤" })).toBeInTheDocument();
    expect(screen.queryByTestId("world-loading")).toBeNull();
  });

  it("等久了写上已等几秒", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pending = deferred<WorldCatalog>();
    installIpc({ world_catalog: () => pending.promise });
    render(<StartScreen roll={0} waitWorlds />);
    expect(await screen.findByTestId("world-loading")).toHaveTextContent("正在读取世界……");
    await act(async () => {
      vi.advanceTimersByTime(4100);
    });
    expect(screen.getByTestId("world-loading")).toHaveTextContent("已等 4 秒");
    await act(async () => pending.resolve({ current: null, worlds: [card("classic", "维斯塔海")] }));
  });

  it("世界目录取不到（旧后端）时照旧显示经典向导", async () => {
    installIpc({ world_catalog: () => Promise.reject("unknown command") });
    render(<StartScreen roll={0} waitWorlds />);
    expect(await screen.findByRole("navigation", { name: "开局步骤" })).toBeInTheDocument();
  });

  it("直接渲染开局画面（没给 waitWorlds）时照旧，不先显示等待", () => {
    installIpc({ world_catalog: () => deferred<WorldCatalog>().promise });
    render(<StartScreen roll={0} />);
    expect(screen.getByRole("navigation", { name: "开局步骤" })).toBeInTheDocument();
    expect(screen.queryByTestId("world-loading")).toBeNull();
  });
});

describe("游戏里从菜单读档", () => {
  beforeEach(reset);

  it("读完之前提示条写“正在读档……”，读完换成“已读档”", async () => {
    startedGame();
    const pending = deferred<Overview>();
    installIpc({ load_game: () => pending.promise });
    const done = loadFrom("save1");
    await waitFor(() => expect(useGame.getState().message).toBe("正在读档……"));
    await act(async () => {
      pending.resolve(overview);
      await done;
    });
    expect(useGame.getState().message).toBe("已读档：save1");
  });
});
