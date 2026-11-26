// 出港、选择目的地、入港与航行状态（模拟的 Tauri IPC；PixiJS 渲染器以桩代替），以及航海图美术的纯函数。
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHART_CELL,
  FLASH_FRAMES,
  drawChart,
  drawDiscoveryFlash,
  drawFog,
  drawPortMarker,
  drawWindArrow,
  type ChartInput,
} from "../art/map";
import MapView from "../components/MapView";
import VoyageHud from "../components/VoyageHud";
import { beginDeparture, useVoyage, useVoyageStore } from "../hooks/useVoyage";
import type { FleetView, FoundView, Overview, StaticView } from "../ipc/types";
import { useShell } from "../components/shell/shellState";
import { createChartJobs } from "../map/chartJobs";
import type { RgbaImage } from "../map/chartWork";
import { useFoundStore } from "../map/found";
import { discoveryMarks } from "../map/marks";
import { createMapRenderer } from "../map/renderer";
import { useGame } from "../store/game";
import { colonialOverview, colonialStatics, discoveriesView, installIpc, overview, port, siteView, startedGame } from "./fixtures";

vi.mock("../map/renderer", () => ({ createMapRenderer: vi.fn() }));
const create = vi.mocked(createMapRenderer);

/** 外壳的最小替身：调用一次 useVoyage()，航海图上叠着航行状态。 */
function Harness() {
  useVoyage();
  return (
    <>
      <MapView />
      <VoyageHud />
    </>
  );
}

const PREVIEW = { days: 5, path: [[1, 1], [2, 1], [2, 2]] as [number, number][], supplies: 6 };
const docked: FleetView = overview.fleets[0];

function withFleet(patch: Partial<FleetView>, extra: Partial<Overview> = {}): Overview {
  return { ...overview, ...extra, fleets: [{ ...docked, ...patch }] };
}

function setup(known: Record<number, boolean> = { 0: true, 1: false }) {
  const calls = installIpc({
    sail_preview: () => PREVIEW,
    port: (args) => ({ ...port, loc: args.loc as number, known: known[args.loc as number] ?? true }),
  });
  startedGame();
  useVoyageStore.setState({ picking: false, target: null, plan: null, known: {} });
  const update = vi.fn();
  const setFog = vi.fn();
  const destroy = vi.fn();
  create.mockReset();
  create.mockResolvedValue({ update, setFog, destroy });
  return calls;
}

/** 渲染器创建时拿到的点选回调（相当于在海图上点了某个地点）。 */
function mapPick(): (loc: number) => void {
  return create.mock.calls[0][2];
}

describe("出港与选择目的地", () => {
  beforeEach(() => {
    setup();
  });

  it("出港 → 在海图上点选港口 → 确认后提交 SetSail，并以“普通”开始航行", async () => {
    const calls = setup();
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => expect(create).toHaveBeenCalled());

    act(() => beginDeparture());
    expect(useGame.getState().stage).toBe("chart");
    expect(useVoyageStore.getState().picking).toBe(true);
    expect(screen.getByText("请在海图上选择目的地")).toBeInTheDocument();

    // 在海图上点选柳湾：弹出确认框，显示航程与“未到访”
    act(() => mapPick()(1));
    const dialog = await screen.findByRole("dialog", { name: "扬帆出港" });
    expect(dialog).toHaveTextContent("柳湾");
    expect(await screen.findByTestId("departure-days")).toHaveTextContent("5 天");
    expect(await screen.findByText("未到访的港口")).toBeInTheDocument();
    expect(calls).toHaveBeenCalledWith("sail_preview", { fleet: 0, dest: 1 });
    // 规划航线交给航海图画出来
    await waitFor(() => expect(useVoyageStore.getState().plan).toEqual({ dest: 1, path: PREVIEW.path }));
    // 选择状态下，普通的“选中并切到港口页”不再发生
    expect(useGame.getState().selectedLoc).toBe(0);

    await user.click(screen.getByRole("button", { name: "起航" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { SetSail: { owner: "player", fleet: 0, dest: 1 } } }),
    );
    // 游戏暂停着：顺便以“普通”（4×，11-03 起的缺省；原来是 1×）开始
    await waitFor(() => expect(calls).toHaveBeenCalledWith("set_speed", { speed: 4 }));
    expect(useVoyageStore.getState().picking).toBe(false);
    expect(useVoyageStore.getState().target).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    // 出航前查到柳湾没到访过，记下来留给靠港时判断
    expect(useVoyageStore.getState().known[1]).toBe(false);
  });

  it("游戏已在运行时确认出航不改变速度", async () => {
    const calls = setup();
    useGame.setState({ overview: { ...overview, speed: 2 } });
    const user = userEvent.setup();
    render(<Harness />);
    act(() => beginDeparture());
    await user.click(screen.getByRole("button", { name: /柳湾/ }));
    await user.click(await screen.findByRole("button", { name: "起航" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", expect.anything()));
    expect(calls).not.toHaveBeenCalledWith("set_speed", expect.anything());
  });

  it("地点列表同样可以选择目的地；内陆城市与所在港口不能作为目的地", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    act(() => beginDeparture());

    await user.click(screen.getByRole("button", { name: /兰城/ }));
    expect(useGame.getState().message).toBe("只能驶向港口；内陆城市请组建商队前往。");
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: /澄港/ }));
    expect(useGame.getState().message).toBe("旗舰队已经停泊在澄港。");
    expect(useVoyageStore.getState().picking).toBe(true);

    await user.click(screen.getByRole("button", { name: /柳湾/ }));
    expect(await screen.findByRole("dialog", { name: "扬帆出港" })).toBeInTheDocument();
  });

  it("重新选择只关闭确认框；取消则退出选择并回到港口街景", async () => {
    const calls = setup();
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => expect(create).toHaveBeenCalled());
    act(() => beginDeparture());
    act(() => mapPick()(1));
    await user.click(await screen.findByRole("button", { name: "重新选择" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(useVoyageStore.getState().picking).toBe(true);
    expect(useVoyageStore.getState().plan).toBeNull();

    // 提示条上的“取消”
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(useVoyageStore.getState().picking).toBe(false);
    expect(useGame.getState().stage).toBe("town");
    expect(screen.queryByText("请在海图上选择目的地")).toBeNull();

    // 确认框里的“取消出港”
    act(() => beginDeparture());
    act(() => mapPick()(1));
    await user.click(await screen.findByRole("button", { name: "取消出港" }));
    expect(useVoyageStore.getState().picking).toBe(false);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls).not.toHaveBeenCalledWith("submit", expect.anything());
  });

  it("无法到达时不能起航", async () => {
    installIpc({ sail_preview: () => null });
    const user = userEvent.setup();
    render(<Harness />);
    act(() => beginDeparture());
    await user.click(screen.getByRole("button", { name: /柳湾/ }));
    expect(await screen.findByText("无法到达该港口。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "起航" })).toBeDisabled();
  });

  it("粮水不够全程时给出警告", async () => {
    installIpc({ sail_preview: () => ({ ...PREVIEW, days: 30 }), port: () => port });
    const user = userEvent.setup();
    render(<Harness />);
    act(() => beginDeparture());
    await user.click(screen.getByRole("button", { name: /柳湾/ }));
    expect(await screen.findByText("粮水不足以支撑全程，途中可能断粮。")).toBeInTheDocument();
  });

  it("确认框里一键补给到建议量：港内、粮水低于建议量时才出现，按差量提交 Resupply", async () => {
    // 建议各 30，现有粮 10、水 10：各补 20，约 20 × 2 + 20 × 1 = 60 金币
    const calls = installIpc({ sail_preview: () => ({ ...PREVIEW, supplies: 30 }), port: () => port });
    const user = userEvent.setup();
    render(<Harness />);
    act(() => beginDeparture());
    await user.click(screen.getByRole("button", { name: /柳湾/ }));
    await user.click(await screen.findByRole("button", { name: "补给到建议量（约 60 金币）" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { Resupply: { owner: "player", fleet: 0, food: 20, water: 20 } } }),
    );
  });

  it("粮水已经够本次航程时，确认框里没有补给按钮", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    act(() => beginDeparture());
    await user.click(screen.getByRole("button", { name: /柳湾/ }));
    expect(await screen.findByTestId("departure-days")).toBeInTheDocument();
    expect(screen.queryByTestId("departure-resupply")).toBeNull();
  });
});

describe("航行与入港", () => {
  beforeEach(() => {
    setup();
  });

  it("离港切到航海图并显示航行状态，靠港后自动选中港口、切回街景并提示发现新港口", async () => {
    const calls = setup();
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByTestId("voyage-hud")).toBeNull();

    // 出港：旗舰队离开澄港，驶向柳湾
    act(() =>
      useGame.getState().setOverview(withFleet({ docked: null, dest: 1, x: 2, y: 1, path: [[2, 1], [2, 2]], days_at_sea: 1 }, { day: 13 })),
    );
    expect(useGame.getState().stage).toBe("chart");
    const hud = await screen.findByTestId("voyage-hud");
    expect(hud).toHaveAccessibleName("航行状态");
    expect(screen.getByTestId("voyage-dest")).toHaveTextContent("柳湾");
    expect(screen.getByTestId("voyage-days")).toHaveTextContent("1 天");
    // 粮 10、水 10、每日各需 1：可支撑 10 天
    expect(screen.getByTestId("voyage-supply")).toHaveTextContent("10 天");
    expect(hud).toHaveTextContent("80");
    expect(hud).toHaveTextContent("12 人（至少 8）");
    // 离港时查询目的地是否到访过
    await waitFor(() => expect(useVoyageStore.getState().known[1]).toBe(false));
    expect(calls).toHaveBeenCalledWith("port", { loc: 1 });

    // 海上改变航向：进入选择状态
    await user.click(screen.getByRole("button", { name: "改变航向" }));
    expect(useVoyageStore.getState().picking).toBe(true);
    expect(screen.getByText("请在海图上选择目的地")).toBeInTheDocument();

    // 靠港：选中柳湾、切到港口页与交易所、回到港口街景，并提示发现新港口
    useGame.setState({ tab: "reports", facility: "bank", selectedLoc: 0 });
    act(() => useGame.getState().setOverview(withFleet({ docked: 1, dest: null, x: 2, y: 2, path: [] }, { day: 15 })));
    const s = useGame.getState();
    expect(s.selectedLoc).toBe(1);
    expect(s.tab).toBe("port");
    expect(s.facility).toBe("market");
    expect(s.stage).toBe("town");
    expect(s.message).toBe("发现新港口：柳湾！市场行情已记入航海日志。");
    expect(useVoyageStore.getState().picking).toBe(false);
    expect(screen.queryByTestId("voyage-hud")).toBeNull();

    // 再次出港、回到到访过的澄港：只提示抵达
    act(() => useGame.getState().setOverview(withFleet({ docked: null, dest: 0, x: 2, y: 1, path: [[1, 1]] }, { day: 16 })));
    act(() => useGame.getState().setOverview(withFleet({ docked: 0, dest: null, x: 1, y: 1, path: [] }, { day: 18 })));
    expect(useGame.getState().message).toBe("抵达澄港。");
    expect(useGame.getState().selectedLoc).toBe(0);
  });

  it("靠港时后端按设置自动暂停了：提示里写明；再出港时按暂停之前的倍速继续", async () => {
    const calls = setup();
    const user = userEvent.setup();
    render(<Harness />);
    await waitFor(() => expect(create).toHaveBeenCalled());
    // 以 4 倍速航行，靠港的那次结算之后后端暂停了（速度 4 → 0）
    act(() => useGame.getState().setOverview(withFleet({ docked: null, dest: 1, x: 2, y: 1, path: [[2, 1]] }, { day: 13, speed: 4 })));
    act(() => useGame.getState().setOverview(withFleet({ docked: 1, dest: null, x: 2, y: 2, path: [] }, { day: 15, speed: 0 })));
    expect(useGame.getState().message).toBe("抵达柳湾。已自动暂停，出港时按原来的速度继续。");
    expect(useGame.getState().runSpeed).toBe(4);

    // 再出港：确认之后按 4 倍速继续
    act(() => beginDeparture());
    act(() => mapPick()(0));
    await screen.findByRole("dialog", { name: "扬帆出港" });
    await user.click(screen.getByRole("button", { name: "起航" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("set_speed", { speed: 4 }));

    // 暂停着靠港（玩家自己停的，速度 0 → 0）：只提示抵达
    act(() => useGame.getState().setOverview(withFleet({ docked: null, dest: 0, x: 2, y: 1, path: [[1, 1]] }, { day: 16, speed: 0 })));
    act(() => useGame.getState().setOverview(withFleet({ docked: 0, dest: null, x: 1, y: 1, path: [] }, { day: 18, speed: 0 })));
    expect(useGame.getState().message).toBe("抵达澄港。");
  });

  it("新开局或读档不算出港与靠港", () => {
    render(<Harness />);
    useGame.setState({ stage: "town", message: null });
    // 读档：日期倒退、舰队停在别处
    act(() => useGame.getState().setOverview(withFleet({ docked: 1, x: 2, y: 2 }, { day: 3 })));
    expect(useGame.getState().message).toBeNull();
    expect(useGame.getState().stage).toBe("town");
    // 读档时旗舰队在海上：直接显示航海图
    act(() => useGame.getState().setOverview(withFleet({ docked: null, dest: 0, x: 2, y: 1 }, { day: 1 })));
    expect(useGame.getState().stage).toBe("chart");
    expect(useGame.getState().message).toBeNull();
  });

  it("粮水不够到港时，航行状态给出警告", async () => {
    installIpc({ sail_preview: () => ({ ...PREVIEW, days: 20 }), port: () => port });
    render(<Harness />);
    act(() => useGame.getState().setOverview(withFleet({ docked: null, dest: 1, x: 2, y: 1, food: 4, water: 9 }, { day: 13 })));
    expect(await screen.findByText("粮水告急！")).toBeInTheDocument();
    expect(screen.getByTestId("voyage-supply")).toHaveTextContent("4 天");
  });
});

describe("航海图美术", () => {
  // 30×20 的小岛图：中间一块陆地，四周浅海与深海
  const rows = Array.from({ length: 20 }, (_, y) =>
    Array.from({ length: 30 }, (_, x) => {
      const d = Math.hypot(x - 15, y - 10);
      return d < 5 ? "#" : d < 7 ? "-" : "~";
    }).join(""),
  );
  const input: ChartInput = { width: 30, height: 20, rows, places: [{ x: 21, y: 10, kind: "port", faction: "cuilan" }] };

  it("海图按每格 CHART_CELL 像素生成，且同一输入结果完全相同", () => {
    const a = drawChart(input, { season: 1 });
    expect(a.w).toBe(30 * CHART_CELL);
    expect(a.h).toBe(20 * CHART_CELL);
    const b = drawChart({ ...input, rows: [...rows] }, { season: 1 });
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
    // 陆地中心与深海角落颜色不同，且整张图不透明
    const center = a.get(15 * CHART_CELL + 2, 10 * CHART_CELL + 2);
    const corner = a.get(2, 2);
    expect(center).not.toBe(corner);
    expect(a.data.every((v) => (v & 0xff) === 0xff)).toBe(true);
  });

  it("季节改变海图（冬季积雪、秋季树色）", () => {
    const summer = drawChart(input, { season: 1 });
    const winter = drawChart(input, { season: 3 });
    expect(Array.from(winter.data)).not.toEqual(Array.from(summer.data));
  });

  it("迷雾只盖住未探索的格子，边缘抖动过渡", () => {
    const explored = rows.map((r) => [...r].map((_, x) => (x < 15 ? "1" : "0")).join(""));
    const fog = drawFog(explored, 30, 20);
    expect(fog.w).toBe(30 * CHART_CELL);
    // 已探索区深处透明，未探索区深处不透明
    expect(fog.get(4 * CHART_CELL, 10 * CHART_CELL) & 0xff).toBe(0);
    expect(fog.get(26 * CHART_CELL, 10 * CHART_CELL) & 0xff).toBe(0xff);
    // 全部揭开时整张透明
    const clear = drawFog(rows.map((r) => "1".repeat(r.length)), 30, 20);
    expect(clear.data.every((v) => (v & 0xff) === 0)).toBe(true);
  });

  it("地点标记与风向箭头", () => {
    const known = drawPortMarker("eastern", "#c0392b");
    const sketch = drawPortMarker("eastern", "#c0392b", { unknown: true });
    expect(known.w).toBe(sketch.w);
    expect(known.colorCount()).toBeGreaterThan(sketch.colorCount());
    for (let d = 0; d < 8; d++) expect(drawWindArrow(d, 5).bounds()).not.toBeNull();
    // 风力越大箭头越长
    expect(drawWindArrow(2, 10).w).toBeGreaterThan(drawWindArrow(2, 0).w);
  });
});

describe("出港时收起功能窗口", () => {
  it("开始选择目的地时关闭打开着的功能窗口，海图完整可见", () => {
    installIpc();
    startedGame();
    useShell.setState({ windowOpen: true });
    act(() => beginDeparture());
    expect(useShell.getState().windowOpen).toBe(false);
    expect(useGame.getState().stage).toBe("chart");
    expect(useVoyageStore.getState().picking).toBe(true);
    useVoyageStore.setState({ picking: false, target: null, plan: null });
  });
});

// ── 殖民点作为目的地、抵达殖民点、航行中的发现 ──

/** 带殖民点（地点 3 “银雾河口”）的世界；默认概览里还没有殖民地。 */
function colonialSetup(o: Overview = overview, knownSite = false) {
  const calls = installIpc({
    static_data: () => colonialStatics,
    sail_preview: () => PREVIEW,
    port: (args) => ({ ...port, loc: args.loc as number, known: true }),
    site: () => ({ ...siteView, known: knownSite }),
  });
  startedGame();
  useGame.setState({ statics: colonialStatics, overview: o, selectedColony: null });
  useVoyageStore.setState({ picking: false, target: null, plan: null, known: {} });
  useFoundStore.setState({ found: [], fresh: [], freshSeq: 0, voyage: 0 });
  create.mockReset();
  create.mockResolvedValue({ update: vi.fn(), setFog: vi.fn(), destroy: vi.fn() });
  return calls;
}

describe("驶向殖民点", () => {
  it("殖民点可以选为目的地：确认框显示现状、地形与建立殖民地的条件，确认后提交 SetSail", async () => {
    const calls = colonialSetup();
    const user = userEvent.setup();
    render(<Harness />);
    act(() => beginDeparture());
    // 世界里有殖民点：提示条与城市的提示都提到殖民点
    expect(screen.getByText("点选一座港口或殖民点，或在左侧的地点列表中选择。")).toBeInTheDocument();
    const siteButton = screen.getByRole("button", { name: /银雾河口/ });
    expect(siteButton).toHaveClass("pickable");
    await user.click(screen.getByRole("button", { name: /兰城/ }));
    expect(useGame.getState().message).toBe("只能驶向港口或殖民点；内陆城市请组建商队前往。");

    await user.click(siteButton);
    const dialog = await screen.findByRole("dialog", { name: "扬帆出港" });
    expect(dialog).toHaveTextContent("银雾河口");
    expect(screen.getByTestId("departure-status")).toHaveTextContent("未开拓之地");
    expect(dialog).toHaveTextContent("森林（肥力 60，风险 30）");
    expect(dialog).toHaveTextContent("抵达后可在此建立殖民地：至少 20 名殖民者、6,000 金币 与建材。");
    // 殖民点的 faction 是占位值：不显示势力名
    expect(dialog).not.toHaveTextContent("翠岚");
    expect(await screen.findByText("尚未探明")).toBeInTheDocument();
    expect(calls).toHaveBeenCalledWith("site", { loc: 3 });
    expect(calls).toHaveBeenCalledWith("sail_preview", { fleet: 0, dest: 3 });
    expect(await screen.findByTestId("departure-days")).toHaveTextContent("5 天");

    await user.click(screen.getByRole("button", { name: "起航" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { SetSail: { owner: "player", fleet: 0, dest: 3 } } }),
    );
    expect(useVoyageStore.getState().known[3]).toBe(false);
  });

  it("被势力占领的殖民点：确认框写明“已被某国占领”，不能在此建立殖民地", async () => {
    colonialSetup({ ...overview, site_claims: [{ loc: 3, faction: 1, colony: null, mine: false }] });
    const user = userEvent.setup();
    render(<Harness />);
    act(() => beginDeparture());
    await user.click(screen.getByRole("button", { name: /银雾河口/ }));
    await screen.findByRole("dialog", { name: "扬帆出港" });
    expect(screen.getByTestId("departure-status")).toHaveTextContent("已被金穗占领");
    expect(screen.getByText("此地已有主人，不能在这里建立殖民地。")).toBeInTheDocument();
  });

  it("无法到达殖民点时不能起航", async () => {
    colonialSetup();
    installIpc({ static_data: () => colonialStatics, sail_preview: () => null, site: () => siteView });
    const user = userEvent.setup();
    render(<Harness />);
    act(() => beginDeparture());
    await user.click(screen.getByRole("button", { name: /银雾河口/ }));
    expect(await screen.findByText("无法到达该地。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "起航" })).toBeDisabled();
  });

  it("抵达未到访的殖民点：选中它、切到“殖民地”页与街景（荒野），提示探明未开拓之地", async () => {
    const calls = colonialSetup();
    render(<Harness />);
    act(() => useGame.getState().setOverview(withFleet({ docked: null, dest: 3, x: 2, y: 1, path: [[2, 0]] }, { day: 13 })));
    expect(useGame.getState().stage).toBe("chart");
    // 离港时用殖民点视图查询是否到访过
    await waitFor(() => expect(useVoyageStore.getState().known[3]).toBe(false));
    expect(calls).toHaveBeenCalledWith("site", { loc: 3 });

    useGame.setState({ tab: "reports", selectedColony: 5 });
    act(() => useGame.getState().setOverview(withFleet({ docked: 3, dest: null, x: 2, y: 0, path: [] }, { day: 15 })));
    const s = useGame.getState();
    expect(s.selectedLoc).toBe(3);
    expect(s.selectedColony).toBeNull();
    expect(s.tab).toBe("colonies");
    expect(s.stage).toBe("town");
    expect(s.message).toBe("探明未开拓之地：银雾河口！可以在此建立殖民地。");

    // 再次到访：只提示抵达
    act(() => useGame.getState().setOverview(withFleet({ docked: null, dest: 3, x: 2, y: 1 }, { day: 16 })));
    act(() => useGame.getState().setOverview(withFleet({ docked: 3, dest: null, x: 2, y: 0 }, { day: 18 })));
    expect(useGame.getState().message).toBe("抵达未开拓之地：银雾河口。");
  });

  it("抵达自己的殖民地：同时选中该殖民地并提示殖民地名", () => {
    colonialSetup(colonialOverview, true);
    render(<Harness />);
    const at = (patch: Partial<FleetView>, day: number): Overview => ({ ...colonialOverview, day, fleets: [{ ...docked, ...patch }] });
    act(() => useGame.getState().setOverview(at({ docked: null, dest: 3, x: 2, y: 1 }, 13)));
    act(() => useGame.getState().setOverview(at({ docked: 3, dest: null, x: 2, y: 0 }, 15)));
    const s = useGame.getState();
    expect(s).toMatchObject({ selectedLoc: 3, selectedColony: 0, tab: "colonies", stage: "town" });
    expect(s.message).toBe("抵达殖民地新晨港。");
  });
});

describe("航行中的发现", () => {
  /** 两件发现物的世界：0 已发现，1 在航行中发现。 */
  const twoFinds: StaticView = {
    ...colonialStatics,
    discoveries: [
      ...colonialStatics.discoveries,
      { id: 1, key: "whale_arch", name: "鲸骨拱门", kind: "landmark", fame: 10, value: 1000, lore: "" },
    ],
  };

  it("未报告的发现数变化时重新查询：新发现提示“发现：XXX”、在海图上闪现，航行状态显示本次航程的新发现数", async () => {
    let found: FoundView[] = discoveriesView.found;
    const calls = installIpc({
      static_data: () => twoFinds,
      sail_preview: () => PREVIEW,
      discoveries: () => ({ ...discoveriesView, found, total: 2 }),
    });
    startedGame();
    useFoundStore.setState({ found: [], fresh: [], freshSeq: 0, voyage: 0 });
    useGame.setState({ statics: twoFinds, overview: { ...overview, discoveries_unreported: 1 }, message: null });
    create.mockReset();
    create.mockResolvedValue({ update: vi.fn(), setFog: vi.fn(), destroy: vi.fn() });
    render(<Harness />);
    // 开局取一次基准：不算新发现
    await waitFor(() => expect(useFoundStore.getState().found).toHaveLength(1));
    expect(calls).toHaveBeenCalledWith("discoveries", {});
    expect(useGame.getState().message).toBeNull();

    // 出港
    act(() => useGame.getState().setOverview(withFleet({ docked: null, dest: 1, x: 2, y: 1 }, { day: 13, discoveries_unreported: 1 })));
    expect(await screen.findByTestId("voyage-found")).toHaveTextContent("0 处");

    // 航行中望见了鲸骨拱门
    found = [...discoveriesView.found, { id: 1, day: 14, reported: false, x: 3, y: 2 }];
    const seq = useFoundStore.getState().freshSeq;
    act(() => useGame.getState().setOverview(withFleet({ docked: null, dest: 1, x: 2, y: 2 }, { day: 14, discoveries_unreported: 2 })));
    await waitFor(() => expect(useGame.getState().message).toBe("发现：鲸骨拱门！到港口商会报告可领取赏金。"));
    const st = useFoundStore.getState();
    expect(st.fresh).toEqual([1]);
    expect(st.freshSeq).toBe(seq + 1);
    expect(st.voyage).toBe(1);
    expect(screen.getByTestId("voyage-found")).toHaveTextContent("1 处");
    // 海图上的发现物标记：只有已发现的两件，位置来自查询结果
    expect(discoveryMarks(twoFinds, st.found).map((m) => [m.name, m.x, m.y])).toEqual([
      ["沉没的阿尔坎之门", 2, 0],
      ["鲸骨拱门", 3, 2],
    ]);

    // 靠港后再次出港：本次航程的新发现从零算起
    act(() => useGame.getState().setOverview(withFleet({ docked: 1, dest: null, x: 2, y: 2 }, { day: 16, discoveries_unreported: 2 })));
    act(() => useGame.getState().setOverview(withFleet({ docked: null, dest: 0, x: 2, y: 1 }, { day: 17, discoveries_unreported: 2 })));
    expect(useFoundStore.getState().voyage).toBe(0);
    expect(await screen.findByTestId("voyage-found")).toHaveTextContent("0 处");
  });

  it("没有发现物的旧世界不查询探险记录，航行状态也不显示新发现", async () => {
    const calls = setup();
    render(<Harness />);
    act(() => useGame.getState().setOverview(withFleet({ docked: null, dest: 1, x: 2, y: 1 }, { day: 13 })));
    await screen.findByTestId("voyage-hud");
    expect(screen.queryByTestId("voyage-found")).toBeNull();
    expect(calls).not.toHaveBeenCalledWith("discoveries", expect.anything());
  });
});

describe("海图的后台计算与闪光", () => {
  // 20×12 的小图：中间一块陆地
  const rows = Array.from({ length: 12 }, (_, y) =>
    Array.from({ length: 20 }, (_, x) => (Math.hypot(x - 10, y - 6) < 3 ? "#" : Math.hypot(x - 10, y - 6) < 5 ? "-" : "~")).join(""),
  );
  const input: ChartInput = { width: 20, height: 12, rows, places: [] };
  const fogRows = (open: (x: number, y: number) => boolean) => rows.map((r, y) => [...r].map((_, x) => (open(x, y) ? "1" : "0")).join(""));

  it("没有 Worker 时在主线程生成：海图与 drawChart 一致并按季节缓存，迷雾合并排队的请求、只返回变化的矩形", async () => {
    const charts: [number, RgbaImage][] = [];
    const fogs: (RgbaImage | null)[] = [];
    const jobs = createChartJobs(input, { chart: (s, img) => charts.push([s, img]), fog: (img) => fogs.push(img) }, { worker: false });
    jobs.chart(5); // 季节按 4 取余
    await waitFor(() => expect(charts).toHaveLength(1));
    const [season, img] = charts[0];
    expect(season).toBe(1);
    expect([img.x, img.y, img.w, img.h]).toEqual([0, 0, 20 * CHART_CELL, 12 * CHART_CELL]);
    const px = drawChart(input, { season: 1 });
    const probe = (x: number, y: number) => Array.from(img.data.slice((y * img.w + x) * 4, (y * img.w + x) * 4 + 4));
    const expected = (x: number, y: number) => {
      const v = px.get(x, y);
      return [v >>> 24, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
    };
    expect(probe(0, 0)).toEqual(expected(0, 0));
    expect(probe(40, 24)).toEqual(expected(40, 24));
    // 同一季节再要一次：直接从缓存回调
    jobs.chart(1);
    expect(charts).toHaveLength(2);
    expect(charts[1][1]).toBe(img);

    // 三次迷雾更新：第一次计算时后两次排队，只算最新的一次
    jobs.fog(fogRows((x) => x < 8));
    jobs.fog(fogRows((x) => x < 9));
    jobs.fog(fogRows((x, y) => x < 8 || (x === 8 && y === 6)));
    await waitFor(() => expect(fogs).toHaveLength(2));
    expect(fogs[0]).toMatchObject({ x: 0, y: 0, w: 20 * CHART_CELL, h: 12 * CHART_CELL });
    const diff = fogs[1];
    expect(diff).not.toBeNull();
    expect(diff!.w).toBeLessThan(20 * CHART_CELL);
    expect(diff!.data.length).toBe(diff!.w * diff!.h * 4);
    // 变化的格子 (8, 6) 在返回的矩形里
    expect(diff!.x).toBeLessThanOrEqual(8 * CHART_CELL);
    expect(diff!.x + diff!.w).toBeGreaterThanOrEqual(9 * CHART_CELL);
    jobs.destroy();
  });

  it("销毁后不再回调", async () => {
    const chart = vi.fn();
    const jobs = createChartJobs(input, { chart, fog: vi.fn() }, { worker: false });
    jobs.chart(2);
    jobs.destroy();
    await new Promise((r) => setTimeout(r, 20));
    expect(chart).not.toHaveBeenCalled();
  });

  it("新发现物的闪光：各帧尺寸相同、互不相同，中心留给发现物图标", () => {
    const frames = Array.from({ length: FLASH_FRAMES }, (_, f) => drawDiscoveryFlash(f));
    for (const p of frames) {
      expect([p.w, p.h]).toEqual([31, 31]);
      expect(p.bounds()).not.toBeNull();
      expect(p.isOpaque(15, 15)).toBe(false);
    }
    for (let i = 1; i < frames.length; i++) expect(Array.from(frames[i].data)).not.toEqual(Array.from(frames[i - 1].data));
    expect(drawDiscoveryFlash(FLASH_FRAMES)).toBe(frames[0]);
  });
});
