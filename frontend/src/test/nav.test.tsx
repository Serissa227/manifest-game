// 第九批 I3：手动航行的航行视图（模拟的 Tauri IPC；PixiJS 渲染器以桩代替；jsdom 没有 2D 画布，海图不画，交互照常）。
// 平视显示、罗经盘的拖动与键盘（按住连续转、松开提交 Steer）、帆、暂停、Tab 切换世界图、自动航行、登陆、点海面设航向、
// 逆风禁区、手动出港；大地图的地图资源（按 hash 缓存）与迷雾增量；看见过的地点；经典世界不受影响。
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import MapView from "../components/MapView";
import { PREVIEW_MS, draftHeading, resetNav, steerTo, useNavStore } from "../hooks/useNavigation";
import { beginDeparture } from "../hooks/useVoyage";
import type { MapResource, NavView, Overview, StaticView } from "../ipc/types";
import { FogBits } from "../map/fogBits";
import { resetChartFog } from "../map/fogStore";
import { clearMapResources } from "../map/mapResource";
import { createMapRenderer } from "../map/renderer";
import { useGame } from "../store/game";
import { installIpc, overview, startedGame, statics } from "./fixtures";

vi.mock("../map/renderer", () => ({ createMapRenderer: vi.fn() }));
const create = vi.mocked(createMapRenderer);

// jsdom 没有 PointerEvent：用 MouseEvent 补一个（带 pointerId、pointerType），拖动罗经盘要用到 clientX / clientY
beforeAll(() => {
  if (typeof window.PointerEvent === "undefined") {
    class PointerEventShim extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? "mouse";
      }
    }
    (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = PointerEventShim;
  }
});

const manualStatics: StaticView = { ...statics, world: { ...statics.world, modules: ["navigation_manual"] } };

const atSea: Overview = {
  ...overview,
  fleets: [{ ...overview.fleets[0], docked: null, x: 1, y: 1, pos: { x: 1.5, y: 1.25 }, heading: 292 }],
  sighted: [0],
};

const NAV: NavView = {
  fleet: 0,
  mode: "manual",
  day: 12,
  minute: 0,
  pos: { x: 1.5, y: 1.25 },
  heading: 292,
  sail: "half",
  speed: 5.26,
  wind: { dir: 0, force: 4, name: "北风 4 级" },
  current: { dir: 90, speed: 0.8 },
  sail_limit: 67,
  trail: [[1.2, 1.1]],
  forecast: [[1.0, 1.0]],
  stops: [{ minute: 300, kind: "land", loc: null, text: "前方是陆地" }],
  supplies_days: 9,
  morale: 72,
  sight: 6,
  autopilot: null,
  known_dests: [
    { loc: 0, name: "澄港", days: 2 },
    { loc: 1, name: "柳湾", days: null },
  ],
  lat_lon: "北纬 38°42′ 西经 9°08′",
};

const PREVIEW = { points: [[1.5, 1.25, 0], [1.0, 1.0, 600]] as [number, number, number][], stops: [] };

function setup(over: { statics?: StaticView; overview?: Overview; nav?: NavView | null; extra?: Record<string, (args: Record<string, unknown>) => unknown> } = {}) {
  const o = over.overview ?? atSea;
  // 后端的航行视图随操舵变化（转舵、调帆之后再取，拿到的是新的航向与帆）
  let cur: NavView | null = over.nav === undefined ? { ...NAV } : over.nav;
  const calls = installIpc({
    navigation: () => cur,
    preview_course: () => PREVIEW,
    submit: (args) => {
      const steer = (args.command as { Steer?: { heading?: number; sail?: NavView["sail"] } }).Steer;
      if (cur && steer) cur = { ...cur, heading: steer.heading ?? cur.heading, sail: steer.sail ?? cur.sail };
      return { outcome: "Done", overview: o };
    },
    set_speed: (args) => ({ ...o, speed: args.speed as number }),
    ...over.extra,
  });
  startedGame();
  useGame.setState({ statics: over.statics ?? manualStatics, overview: o, stage: "chart" });
  resetNav();
  resetChartFog();
  create.mockReset();
  create.mockResolvedValue({ update: vi.fn(), setFog: vi.fn(), destroy: vi.fn() });
  return calls;
}

/** 提交过的命令（submit 的 command 参数）。 */
function submitted(calls: ReturnType<typeof setup>): unknown[] {
  return calls.mock.calls.filter(([cmd]) => cmd === "submit").map(([, args]) => (args as { command: unknown }).command);
}

const rect = (w: number, h: number) =>
  ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

afterEach(() => {
  vi.useRealTimers();
  resetNav();
});

describe("航行视图：平视显示", () => {
  beforeEach(() => {
    setup();
  });

  it("海上的手动航行世界盖上航行视图：航向的罗经点名、航速、风、洋流、粮水、士气、经纬度与今天会停下的地方", async () => {
    render(<MapView />);
    const hud = await screen.findByTestId("nav-hud");
    expect(within(hud).getByTestId("nav-heading")).toHaveTextContent("西北偏西 292°");
    expect(within(hud).getByTestId("nav-speed")).toHaveTextContent("5.3 节");
    expect(within(hud).getByTestId("nav-wind")).toHaveTextContent("北风 4 级");
    expect(within(hud).getByTestId("nav-current")).toHaveTextContent("流向东 0.8 节");
    expect(within(hud).getByTestId("nav-supplies")).toHaveTextContent("9 天");
    expect(within(hud).getByTestId("nav-morale")).toHaveTextContent("72");
    expect(within(hud).getByTestId("nav-latlon")).toHaveTextContent("北纬 38°42′ 西经 9°08′");
    // 今天 6:00 起第 300 分钟 = 11:00
    expect(screen.getByTestId("nav-stops")).toHaveTextContent("11:00 前方是陆地");
    // 帆：当前是半帆
    expect(screen.getByTestId("nav-sail-half")).toHaveAttribute("aria-pressed", "true");
    // 罗经盘：逆风禁区（风从北来、夹角 67°）
    expect(screen.getByTestId("nav-compass-nogo")).toBeInTheDocument();
    expect(screen.getByTestId("nav-compass")).toHaveAttribute("aria-valuenow", "292");
    // 经典的航行状态让位
    expect(screen.queryByTestId("voyage-hud")).toBeNull();
  });

  it("逆风禁区里给出提示", async () => {
    setup({ nav: { ...NAV, heading: 20 } });
    render(<MapView />);
    expect(await screen.findByTestId("nav-irons")).toHaveTextContent("逆风");
    expect(screen.getByTestId("nav-compass")).toHaveClass("irons");
  });
});

describe("航行视图：操舵", () => {
  it("拖动罗经盘：拖动时请求预测（带草稿航向），松手提交 Steer（分钟取应用层时钟，从 6:00 起）", async () => {
    const calls = setup();
    render(<MapView />);
    const dial = await screen.findByTestId("nav-compass");
    dial.getBoundingClientRect = () => rect(160, 160);
    // 按在正东 → 拖到正南 → 松手
    fireEvent.pointerDown(dial, { clientX: 160, clientY: 80, pointerId: 7 });
    expect(useNavStore.getState().draft).toBe(90);
    fireEvent.pointerMove(dial, { clientX: 80, clientY: 160, pointerId: 7 });
    expect(useNavStore.getState().draft).toBe(180);
    expect(dial).toHaveAttribute("aria-valuenow", "180");
    await waitFor(() => expect(calls).toHaveBeenCalledWith("preview_course", expect.objectContaining({ fleet: 0, minute: 120 })));
    const pc = calls.mock.calls.filter(([c]) => c === "preview_course").map(([, a]) => a as { steers: { heading?: number }[] });
    expect(pc.some((a) => a.steers.length === 1 && a.steers[0].heading === 180)).toBe(true);
    fireEvent.pointerUp(dial, { clientX: 80, clientY: 160, pointerId: 7 });
    await waitFor(() => expect(submitted(calls)).toContainEqual({ Steer: { owner: "player", fleet: 0, minute: 120, heading: 180 } }));
    expect(useNavStore.getState().draft).toBeNull();
  });

  it("快速拖动 20 次：在路上的预测请求最多一个，中间的草稿不问，最后一次的预测一定画出来；松手照样提交 Steer", async () => {
    // 拖动的预测（带草稿）按手动放行；当天航迹（steers 为空）立即回复
    const drags: { heading: number; resolve: () => void; done: boolean }[] = [];
    let inflight = 0;
    let maxInflight = 0;
    const calls = setup({
      extra: {
        preview_course: (args) => {
          const steers = args.steers as { heading?: number }[];
          if (steers.length === 0) return PREVIEW;
          const heading = steers[0].heading ?? -1;
          inflight++;
          maxInflight = Math.max(maxInflight, inflight);
          return new Promise((resolve) =>
            drags.push({
              heading,
              done: false,
              resolve: () => {
                inflight--;
                resolve({ points: [[heading, 0, 0]], stops: [] });
              },
            }),
          );
        },
      },
    });
    render(<MapView />);
    await screen.findByTestId("nav-hud");
    const sleep = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
    // 20 次草稿，间隔 15 毫秒（共约 0.3 秒，跨过两个节流间隔）
    for (let i = 0; i < 20; i++) {
      act(() => draftHeading(10 + 5 * i));
      await sleep(15);
    }
    // 依次放行：每放行一个，最多再发一个（按最新的草稿）
    for (let round = 0; round < 6; round++) {
      await sleep(PREVIEW_MS + 40);
      const next = drags.find((d) => !d.done);
      if (!next) break;
      next.done = true;
      act(() => next.resolve());
    }
    await sleep(PREVIEW_MS + 40);
    const sent = calls.mock.calls
      .filter(([c, a]) => c === "preview_course" && (a.steers as unknown[]).length > 0)
      .map(([, a]) => (a.steers as { heading: number }[])[0].heading);
    expect(maxInflight).toBe(1);
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(sent.length).toBeLessThan(6);
    expect(sent[sent.length - 1]).toBe(105);
    expect(useNavStore.getState().preview?.points[0][0]).toBe(105);

    // 有预测在路上时松手：最终的 Steer 照样提交，回来的预测不再画
    act(() => draftHeading(200));
    await sleep(PREVIEW_MS + 40);
    expect(inflight).toBe(1);
    await act(() => steerTo(200));
    await waitFor(() => expect(submitted(calls)).toContainEqual({ Steer: { owner: "player", fleet: 0, minute: 120, heading: 200 } }));
    act(() => drags[drags.length - 1].resolve());
    await sleep(PREVIEW_MS + 40);
    expect(useNavStore.getState().preview).toBeNull();
    expect(inflight).toBe(0);
  });

  it("键盘：按住 D 连续右转，松开时提交；A 左转；W/S 升降帆", async () => {
    const calls = setup();
    render(<MapView />);
    await screen.findByTestId("nav-hud");
    vi.useFakeTimers();
    fireEvent.keyDown(window, { key: "d" });
    // 一按先转 5°，之后每秒 60°：按住 0.5 秒再转 30°
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(useNavStore.getState().draft).toBe(292 + 35);
    fireEvent.keyUp(window, { key: "d" });
    vi.useRealTimers();
    await waitFor(() => expect(submitted(calls)).toContainEqual({ Steer: { owner: "player", fleet: 0, minute: 120, heading: 327 } }));

    // A：左转（短按只转 5°）
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    fireEvent.keyUp(window, { key: "ArrowLeft" });
    await waitFor(() => expect(submitted(calls)).toContainEqual({ Steer: { owner: "player", fleet: 0, minute: 120, heading: 322 } }));

    // W：半帆 → 满帆；S：降一档
    fireEvent.keyDown(window, { key: "w" });
    await waitFor(() => expect(submitted(calls)).toContainEqual({ Steer: { owner: "player", fleet: 0, minute: 120, sail: "full" } }));
  });

  it("帆的按钮、点海面设航向", async () => {
    const calls = setup();
    render(<MapView />);
    await userEvent.click(await screen.findByTestId("nav-sail-furled"));
    await waitFor(() => expect(submitted(calls)).toContainEqual({ Steer: { owner: "player", fleet: 0, minute: 120, sail: "furled" } }));
    // 点海面（船在画布中心）：点在正东 → 航向 90°
    const canvas = screen.getByTestId("nav-canvas");
    canvas.getBoundingClientRect = () => rect(400, 300);
    fireEvent.pointerDown(canvas, { clientX: 380, clientY: 150 });
    fireEvent.pointerUp(canvas, { clientX: 380, clientY: 150 });
    await waitFor(() => expect(submitted(calls)).toContainEqual({ Steer: { owner: "player", fleet: 0, minute: 120, heading: 90 } }));
  });

  it("空格暂停 / 继续；Tab 切到世界图，再按回到航行", async () => {
    const calls = setup();
    render(<MapView />);
    await screen.findByTestId("nav-hud");
    fireEvent.keyDown(window, { key: " " });
    await waitFor(() => expect(calls).toHaveBeenCalledWith("set_speed", { speed: 4 }));
    fireEvent.keyDown(window, { key: "Tab" });
    expect(await screen.findByTestId("nav-worldbar")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-hud")).toBeNull();
    // 世界图上 A/D 不转舵
    fireEvent.keyDown(window, { key: "d" });
    expect(useNavStore.getState().draft).toBeNull();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(await screen.findByTestId("nav-hud")).toBeInTheDocument();
  });

  it("输入框里打字不当作操船", async () => {
    setup();
    render(
      <>
        <MapView />
        <input data-testid="typing" />
      </>,
    );
    await screen.findByTestId("nav-hud");
    fireEvent.keyDown(screen.getByTestId("typing"), { key: "d" });
    expect(useNavStore.getState().draft).toBeNull();
  });
});

describe("航行视图：自动航行与登陆", () => {
  it("自动航行：已知海域里的港口，days 为 null 的只能开到已知海域的边缘", async () => {
    const calls = setup();
    render(<MapView />);
    await userEvent.click(await screen.findByTestId("nav-autopilot-open"));
    const menu = screen.getByTestId("nav-autopilot-menu");
    expect(within(menu).getByTestId("nav-dest-0")).toHaveTextContent("驶往 澄港");
    expect(within(menu).getByTestId("nav-dest-0")).toHaveTextContent("约 2 天");
    expect(within(menu).getByTestId("nav-dest-1")).toHaveTextContent("开到已知海域的边缘");
    await userEvent.click(within(menu).getByTestId("nav-dest-1"));
    await waitFor(() =>
      expect(submitted(calls)).toContainEqual({ Autopilot: { owner: "player", fleet: 0, dest: 1, minute: 120, stop_at_known_edge: true } }),
    );
    await userEvent.click(screen.getByTestId("nav-autopilot-open"));
    await userEvent.click(screen.getByTestId("nav-dest-0"));
    await waitFor(() => expect(submitted(calls)).toContainEqual({ Autopilot: { owner: "player", fleet: 0, dest: 0, minute: 120 } }));
  });

  it("世界图上点已知港口发起自动航行；点不能去的地点给出提示", async () => {
    const calls = setup();
    render(<MapView />);
    await screen.findByTestId("nav-hud");
    fireEvent.keyDown(window, { key: "Tab" });
    await screen.findByTestId("nav-worldbar");
    await waitFor(() => expect(create).toHaveBeenCalled());
    const pick = create.mock.calls[0][2];
    act(() => pick(0));
    await userEvent.click(await screen.findByTestId("nav-pick-go"));
    await waitFor(() => expect(submitted(calls)).toContainEqual({ Autopilot: { owner: "player", fleet: 0, dest: 0, minute: 120 } }));
    act(() => pick(2));
    expect(useGame.getState().message).toContain("尚未探明");
  });

  it("登陆探索：派出几天", async () => {
    const calls = setup();
    render(<MapView />);
    await userEvent.click(await screen.findByTestId("nav-landing-open"));
    await userEvent.click(screen.getByTestId("nav-landing-3"));
    await waitFor(() => expect(submitted(calls)).toContainEqual({ Landing: { owner: "player", fleet: 0, days: 3 } }));
  });
});

describe("手动出港与经典世界", () => {
  it("港内出港：罗经盘定航向，启航提交 Depart，游戏暂停时以“普通”（4×，11-03 起的缺省；原来是 1×）开始航行", async () => {
    const docked: Overview = { ...overview, fleets: [{ ...overview.fleets[0], docked: 0 }] };
    const calls = setup({ overview: docked, nav: null });
    render(<MapView />);
    act(() => beginDeparture());
    const dialog = await screen.findByTestId("nav-depart");
    const dial = within(dialog).getByTestId("nav-compass");
    const heading = Number(dial.getAttribute("aria-valuenow"));
    expect(heading).toBeGreaterThanOrEqual(0);
    expect(heading).toBeLessThan(360);
    // 在盘上拖到正西再启航
    dial.getBoundingClientRect = () => rect(160, 160);
    fireEvent.pointerDown(dial, { clientX: 0, clientY: 80 });
    fireEvent.pointerUp(dial, { clientX: 0, clientY: 80 });
    expect(dial).toHaveAttribute("aria-valuenow", "270");
    await userEvent.click(within(dialog).getByTestId("nav-depart-go"));
    await waitFor(() => expect(submitted(calls)).toContainEqual({ Depart: { owner: "player", fleet: 0, minute: 120, heading: 270 } }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("set_speed", { speed: 4 }));
    // 没有走“在海图上选目的地”
    expect(submitted(calls).some((c) => typeof c === "object" && c !== null && "SetSail" in c)).toBe(false);
  });

  it("经典世界：没有航行视图，不查询 navigation", async () => {
    const calls = setup({ statics });
    render(<MapView />);
    await waitFor(() => expect(create).toHaveBeenCalled());
    expect(screen.queryByTestId("nav-view")).toBeNull();
    expect(calls).not.toHaveBeenCalledWith("navigation", expect.anything());
  });
});

describe("大地图：地图资源、迷雾增量与看见过的地点", () => {
  const W = 4;
  const H = 3;
  const RES: MapResource = {
    key: "earth",
    hash: "h1",
    width: W,
    height: H,
    wrap_x: true,
    cell_km: 37,
    projection: { kind: "equirect", west: -10800, north: 4320, arcmin_per_cell: 20 },
    rows: ["~~-#", "~--#", "~~~#"],
    relief: null,
    biomes: null,
    seas: null,
  };
  const external: StaticView = { ...manualStatics, map: { width: W, height: H, rows: [], key: "earth", hash: "h1", wrap_x: true, external: true } };

  beforeEach(() => clearMapResources());

  it("按 hash 取地图资源（同一张图只取一次）、渲染器拿到环绕与投影；迷雾按 fog_delta 的位图增量更新", async () => {
    const full = new FogBits(W, H);
    full.applyRuns([[0, 0, 1]]);
    const fogDelta = vi.fn((args: Record<string, unknown>) =>
      (args.since as number) === 0 ? { epoch: "e", rev: 100, full: full.toBase64(), runs: [] } : { epoch: "e", rev: 120, full: null, runs: [[2, 2, 3]] },
    );
    const docked: Overview = { ...overview, sighted: [0, 1] };
    const calls = setup({ statics: external, overview: docked, extra: { map_resource: () => RES, fog_delta: fogDelta } });
    const setFog = vi.fn();
    create.mockResolvedValue({ update: vi.fn(), setFog, destroy: vi.fn() });
    const { unmount } = render(<MapView />);
    await waitFor(() => expect(create).toHaveBeenCalled());
    const [, givenStatics, , opts] = create.mock.calls[0];
    expect(givenStatics.map.rows).toEqual(RES.rows);
    expect(opts?.input?.wrapX).toBe(true);
    expect(opts?.input?.projection).toEqual(RES.projection);
    // 迷雾：since = 0 拿全量
    await waitFor(() => expect(setFog).toHaveBeenCalledWith(["1100", "0000", "0000"]));
    expect(fogDelta).toHaveBeenCalledWith({ since: 0 });
    expect(calls).not.toHaveBeenCalledWith("fog", expect.anything());
    // 探索进度变化：since 取手上的版本，只拿增量
    act(() => useGame.getState().setOverview({ ...docked, day: 13, fog_version: 120 }));
    await waitFor(() => expect(setFog).toHaveBeenLastCalledWith(["1100", "0000", "0011"]));
    expect(fogDelta).toHaveBeenLastCalledWith({ since: 100, epoch: "e" });
    unmount();
    // 再开一次：地图资源走缓存
    render(<MapView />);
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(calls.mock.calls.filter(([c]) => c === "map_resource")).toHaveLength(1);
  });

  it("看见过的地点：没看见的不列、不能选", async () => {
    setup({ statics, overview: { ...overview, sighted: [0] } });
    render(<MapView />);
    expect(await screen.findByRole("button", { name: /澄港/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /柳湾/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /兰城/ })).toBeNull();
  });
});
