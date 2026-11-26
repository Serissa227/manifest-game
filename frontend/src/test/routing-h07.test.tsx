// H07 航线规划：世界图上的航线预览（偏好、经停点、粮水标红、风险提示、按偏好提交自动领航）、靠港后的行程下一站、
// 季风历的开关与拨月份（数据交给渲染器）；纯函数（拼路径、拨月份、流线几何）。模拟的 Tauri IPC，PixiJS 渲染器以桩代替。
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import MapView from "../components/MapView";
import ItineraryChip from "../components/routing/ItineraryChip";
import { RoutePlanBody } from "../components/routing/RoutePlanner";
import { joinPaths, plannedStops, stepMonth, useRouteStore } from "../components/routing/routeStore";
import { resetNav } from "../hooks/useNavigation";
import { useVoyageStore } from "../hooks/useVoyage";
import type { MonsoonView, RoutePlanView } from "../ipc/routing";
import type { NavView, Overview, StaticView } from "../ipc/types";
import { dirVector, monsoonStreaks, monsoonStride } from "../map/monsoonLayer";
import { createMapRenderer } from "../map/renderer";
import { resetChartFog } from "../map/fogStore";
import { useGame } from "../store/game";
import { installIpc, overview, startedGame, statics } from "./fixtures";

vi.mock("../map/renderer", () => ({ createMapRenderer: vi.fn() }));
const create = vi.mocked(createMapRenderer);

const manualStatics: StaticView = { ...statics, world: { ...statics.world, modules: ["navigation_manual"] } };
const atSea: Overview = {
  ...overview,
  fleets: [{ ...overview.fleets[0], docked: null, x: 1, y: 1, pos: { x: 1.5, y: 1.25 }, heading: 292 }],
  sighted: [0, 1],
};
const NAV: NavView = {
  fleet: 0,
  mode: "manual",
  day: 12,
  minute: 0,
  pos: { x: 1.5, y: 1.25 },
  heading: 292,
  sail: "full",
  speed: 5,
  wind: { dir: 0, force: 4, name: "北风 4 级" },
  current: null,
  sail_limit: 67,
  trail: [],
  forecast: [],
  stops: [],
  supplies_days: 9,
  morale: 72,
  sight: 6,
  autopilot: null,
  known_dests: [
    { loc: 0, name: "澄港", days: 2 },
    { loc: 1, name: "柳湾", days: 5 },
  ],
  lat_lon: null,
};

function plan(over: Partial<RoutePlanView> = {}): RoutePlanView {
  return {
    fleet: 0,
    tier: "timed",
    pref: "fastest",
    prefs: ["distance", "fastest", "safe", "coastal"],
    legs: [
      {
        dest: 0,
        name: "澄港",
        from: null,
        path: [
          [1, 1],
          [2, 1],
          [3, 2],
        ],
        edge: false,
        minutes: 2880,
        days: 2,
        regions: ["西海"],
        record: null,
      },
    ],
    minutes: 2880,
    days: 2,
    required: { food: 10, water: 10 },
    have: { food: 20, water: 4 },
    short: { food: 0, water: 6 },
    hazards: [{ kind: "storm", leg: 0, month: 7, season: null, region: "西海", port: null, bp: 1200 }],
    failed: null,
    month: 7,
    ...over,
  };
}

const MONSOON: MonsoonView = { periods: 12, period: 6, now: 6, step: 6, points: [[3, 3, 2, 5, 4, 1]] };

function setup(over: { overview?: Overview; plan?: (args: Record<string, unknown>) => unknown } = {}) {
  const o = over.overview ?? atSea;
  const calls = installIpc({
    navigation: () => ({ ...NAV }),
    preview_course: () => ({ points: [], stops: [] }),
    route_plan: over.plan ?? (() => plan()),
    monsoon: (args) => ({ ...MONSOON, period: ((args.month as number | null) ?? 7) - 1 }),
    submit: () => ({ outcome: "Done", overview: o }),
  });
  startedGame();
  useGame.setState({ statics: manualStatics, overview: o, stage: "chart" });
  resetNav();
  resetChartFog();
  useRouteStore.setState({ stops: [], pref: null, itinerary: null, monsoon: false, month: null, shown: false });
  useVoyageStore.setState({ plan: null, target: null, picking: false });
  create.mockReset();
  const renderer = { update: vi.fn(), setFog: vi.fn(), destroy: vi.fn(), setMonsoon: vi.fn() };
  create.mockResolvedValue(renderer);
  return { calls, renderer };
}

function submitted(calls: ReturnType<typeof setup>["calls"]): unknown[] {
  return calls.mock.calls.filter(([cmd]) => cmd === "submit").map(([, args]) => (args as { command: unknown }).command);
}

afterEach(() => resetNav());

describe("H07 纯函数", () => {
  it("行程：经停点加点选的终点；拼路径去掉接头的重复格；拨月份循环", () => {
    expect(plannedStops([3, 5], 7)).toEqual([3, 5, 7]);
    expect(plannedStops([3, 5], 5)).toEqual([3, 5]);
    expect(plannedStops([], null)).toEqual([]);
    expect(
      joinPaths([
        [
          [1, 1],
          [2, 1],
        ],
        [
          [2, 1],
          [3, 1],
        ],
      ]),
    ).toEqual([
      [1, 1],
      [2, 1],
      [3, 1],
    ]);
    expect(stepMonth(12, 1, 12)).toBe(1);
    expect(stepMonth(1, -1, 12)).toBe(12);
    expect(stepMonth(4, 1, 4)).toBe(1);
  });

  it("流线：风的去向（0 北，顺时针）对上海图方向；风越大越长，有洋流另画点线，相位挪动虚线", () => {
    const [ex, ey] = dirVector(2);
    expect(ex).toBeCloseTo(1);
    expect(ey).toBeCloseTo(0);
    const [nx, ny] = dirVector(0);
    expect(nx).toBeCloseTo(0);
    expect(ny).toBeCloseTo(-1);
    const calm = monsoonStreaks({ ...MONSOON, points: [[3, 3, 2, 2, 0, 0]] }, 4, 0);
    const gale = monsoonStreaks({ ...MONSOON, points: [[3, 3, 2, 9, 0, 0]] }, 4, 0);
    const span = (s: typeof calm) => Math.max(...s.map((x) => Math.max(x.x1, x.x2))) - Math.min(...s.map((x) => Math.min(x.x1, x.x2)));
    expect(span(gale)).toBeGreaterThan(span(calm));
    expect(gale.some((s) => s.kind === "gale")).toBe(true);
    expect(calm.some((s) => s.kind === "current")).toBe(false);
    const flow = monsoonStreaks(MONSOON, 4, 0);
    expect(flow.filter((s) => s.kind === "current").length).toBe(3);
    expect(flow.filter((s) => s.kind === "head").length).toBe(2);
    // 东风（向东吹）的流线都在同一行上，箭头尖在东端
    const wind = flow.filter((s) => s.kind === "wind");
    expect(wind.every((s) => Math.abs(s.y1 - 14) < 1e-9 && Math.abs(s.y2 - 14) < 1e-9)).toBe(true);
    const shifted = monsoonStreaks(MONSOON, 4, 1).filter((s) => s.kind === "wind");
    expect(shifted.map((s) => s.x1)).not.toEqual(wind.map((s) => s.x1));
    // 远看：每隔一个取样点画一道（取样点在 3、9、15……格），流线加长一倍
    expect(monsoonStride(1)).toBe(2);
    expect(monsoonStride(12)).toBe(1);
    const grid: MonsoonView = { ...MONSOON, points: [3, 9, 15].map((x) => [x, 3, 2, 5, 0, 0] as MonsoonView["points"][number]) };
    const sparse = monsoonStreaks(grid, 4, 0, 2).filter((s) => s.kind === "head");
    expect(sparse.length).toBe(4);
    const one: MonsoonView = { ...MONSOON, points: [[3, 3, 2, 5, 0, 0]] };
    expect(span(monsoonStreaks(one, 4, 0, 2))).toBeGreaterThan(span(monsoonStreaks(one, 4, 0, 1)));
  });
});

describe("H07 航线预览", () => {
  it("正文：偏好、各段天数与首航、全程天数、粮水不够标红、当季风险", () => {
    const onPref = vi.fn();
    render(<RoutePlanBody plan={plan()} onPref={onPref} />);
    expect(screen.getByTestId("route-pref-fastest")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId("route-total")).toHaveTextContent("全程约 2 天");
    const supply = screen.getByTestId("route-supply");
    expect(supply).toHaveClass("short");
    expect(supply).toHaveTextContent("水 4 / 要 10");
    expect(within(supply).getByText("水 4 / 要 10")).toHaveClass("route-short");
    expect(within(supply).getByText("粮 20 / 要 10")).not.toHaveClass("route-short");
    expect(screen.getByTestId("route-hazards")).toHaveTextContent("7 月西海风暴多");
    fireEvent.click(screen.getByTestId("route-pref-safe"));
    expect(onPref).toHaveBeenCalledWith("safe");
  });

  it("没有领航员时只写一句按距离，不给偏好按钮；纪录与封冻照样写出", () => {
    const p = plan({
      tier: "distance",
      pref: "distance",
      prefs: ["distance"],
      short: { food: 0, water: 0 },
      hazards: [{ kind: "frozen", leg: 0, month: 1, season: null, region: null, port: "柳湾", bp: 0 }],
      legs: [{ ...plan().legs[0], from: 1, record: { days: 9, minutes: 12000, day: 3 } }],
    });
    render(<RoutePlanBody plan={p} onPref={vi.fn()} />);
    expect(screen.getByTestId("route-no-navigator")).toHaveTextContent("领航员");
    expect(screen.queryByTestId("route-pref-fastest")).toBeNull();
    expect(screen.getByTestId("route-plan")).toHaveTextContent("纪录 9 天");
    expect(screen.getByTestId("route-supply")).not.toHaveClass("short");
    expect(screen.getByTestId("route-hazards")).toHaveTextContent("1 月柳湾封冻");
  });

  it("世界图上点港口：画出航线、选偏好重算、加经停点排两站，起航按偏好提交自动领航并记下剩下的一站", async () => {
    const { calls } = setup({
      plan: (args) => {
        const req = args.request as { stops: number[]; pref: string | null };
        const legs = req.stops.map((d, i) => ({ ...plan().legs[0], dest: d, name: d === 0 ? "澄港" : "柳湾", from: i === 0 ? null : req.stops[i - 1] }));
        return plan({ legs, pref: (req.pref as RoutePlanView["pref"]) ?? "fastest" });
      },
    });
    render(<MapView />);
    await screen.findByTestId("nav-hud");
    fireEvent.keyDown(window, { key: "Tab" });
    await screen.findByTestId("nav-worldbar");
    await waitFor(() => expect(create).toHaveBeenCalled());
    const pick = create.mock.calls[0][2];
    act(() => pick(1));
    const planner = await screen.findByTestId("route-planner");
    // 拿到了预览：原来的快捷“驶往”按钮收起，航线交给航海图
    expect(screen.queryByTestId("nav-pick-go")).toBeNull();
    await waitFor(() => expect(useVoyageStore.getState().plan?.dest).toBe(1));
    expect(useVoyageStore.getState().plan?.path).toEqual([
      [1, 1],
      [2, 1],
      [3, 2],
    ]);
    await userEvent.click(within(planner).getByTestId("route-pref-safe"));
    await waitFor(() =>
      expect(calls.mock.calls.some(([cmd, args]) => cmd === "route_plan" && (args.request as { pref: string }).pref === "safe")).toBe(true),
    );
    // 加为经停点，再点下一站
    await userEvent.click(screen.getByTestId("route-add-stop"));
    expect(useRouteStore.getState().stops).toEqual([1]);
    act(() => pick(0));
    await waitFor(() => expect(screen.getByTestId("route-go")).toHaveTextContent("行程共 2 站"));
    await userEvent.click(screen.getByTestId("route-go"));
    await waitFor(() =>
      expect(submitted(calls)).toContainEqual({ Autopilot: { owner: "player", fleet: 0, dest: 1, minute: 120, route: "safe" } }),
    );
    expect(useRouteStore.getState().itinerary).toEqual({ fleet: 0, stops: [0], pref: "safe" });
  });

  it("旧后端没有航线预览时照旧是快捷“驶往”", async () => {
    setup({ plan: () => null });
    render(<MapView />);
    await screen.findByTestId("nav-hud");
    fireEvent.keyDown(window, { key: "Tab" });
    await waitFor(() => expect(create).toHaveBeenCalled());
    act(() => create.mock.calls[0][2](0));
    expect(await screen.findByTestId("nav-pick-go")).toBeInTheDocument();
    expect(screen.queryByTestId("route-planner")).toBeNull();
  });

  it("靠港后问要不要继续行程：继续就从港里发自动领航，偏好沿用", async () => {
    const docked: Overview = { ...overview, fleets: [{ ...overview.fleets[0], docked: 1 }] };
    const { calls } = setup({ overview: docked });
    useRouteStore.setState({ itinerary: { fleet: 0, stops: [0], pref: "coastal" } });
    render(<ItineraryChip />);
    expect(screen.getByTestId("route-itinerary")).toHaveTextContent("行程下一站：");
    await userEvent.click(screen.getByTestId("route-continue"));
    await waitFor(() =>
      expect(submitted(calls)).toContainEqual({ Autopilot: { owner: "player", fleet: 0, dest: 0, minute: expect.any(Number), route: "coastal" } }),
    );
    expect(useRouteStore.getState().itinerary).toBeNull();
  });
});

describe("H07 季风历", () => {
  it("开关与拨月份：按月向后端要数据，交给渲染器；关掉时收起", async () => {
    const { calls, renderer } = setup();
    render(<MapView />);
    const toggle = await screen.findByTestId("route-monsoon-toggle");
    await userEvent.click(toggle);
    await waitFor(() => expect(renderer.setMonsoon).toHaveBeenLastCalledWith(expect.objectContaining({ period: 6 }), expect.any(Boolean)));
    expect(screen.getByTestId("route-month")).toHaveTextContent("7 月");
    await userEvent.click(screen.getByTestId("route-month-next"));
    await waitFor(() => expect(calls.mock.calls.some(([cmd, args]) => cmd === "monsoon" && args.month === 8)).toBe(true));
    await waitFor(() => expect(screen.getByTestId("route-month")).toHaveTextContent("8 月"));
    await userEvent.click(toggle);
    await waitFor(() => expect(renderer.setMonsoon).toHaveBeenLastCalledWith(null, expect.any(Boolean)));
  });

  it("经典世界没有季风历", async () => {
    setup();
    useGame.setState({ statics });
    render(<MapView />);
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(screen.queryByTestId("route-monsoon")).toBeNull();
  });
});
