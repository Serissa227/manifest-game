import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NavCanvas from "../components/nav/NavCanvas";
import type { ChartSource } from "../hooks/useChartSource";
import { resetNav, useNavStore } from "../hooks/useNavigation";
import type { CoursePreview, NavView } from "../ipc/types";
import { drawNav } from "../map/navDraw";
import { useClockStore } from "../store/clock";
import { useGame } from "../store/game";
import { overview, startedGame, statics } from "./fixtures";

vi.mock("../map/navDraw", async (original) => ({
  ...await original<typeof import("../map/navDraw")>(), drawNav: vi.fn(),
}));
vi.mock("../map/chartHub", () => ({
  acquireChartHub: () => ({ subscribe: () => () => {}, release: () => {}, jobs: { chart: () => {}, tile: () => {} } }),
}));
vi.mock("../map/fogStore", async (original) => ({
  ...await original<typeof import("../map/fogStore")>(), attachFogFeed: () => () => {}, fogLookup: () => null,
}));
vi.mock("../art/render", async (original) => ({
  ...await original<typeof import("../art/render")>(), toCanvas: () => null,
}));

const nav: NavView = { fleet: 0, day: 12, minute: 120, mode: "manual", pos: { x: 10, y: 10 },
  heading: 90, sail: "full", speed: 5, wind: { dir: 0, force: 3, name: "" }, current: null,
  sail_limit: 50, trail: [], forecast: [], stops: [], supplies_days: 30, morale: 100, sight: 3,
  autopilot: null, known_dests: [], lat_lon: null };
const course: CoursePreview = { points: [[10, 10, 120], [20, 10, 180]], stops: [] };
const source = { statics, input: { width: 4, height: 4 }, wrap: false, fogMap: "p08", hubKey: "p08" } as ChartSource;
let frames: Map<number, FrameRequestCallback>;
let now: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  startedGame();
  resetNav();
  useNavStore.setState({ nav, course });
  useClockStore.setState({ day: 12, minute: 480, speed: 1, sampledAt: 0 });
  frames = new Map();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
  now = vi.spyOn(performance, "now").mockReturnValue(0);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ({ setTransform: vi.fn() })) as unknown as typeof HTMLCanvasElement.prototype.getContext,
  );
  vi.mocked(drawNav).mockClear();
});
afterEach(() => {
  cleanup();
  resetNav();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function frame(at: number) {
  now.mockReturnValue(at);
  const [id, callback] = frames.entries().next().value!;
  frames.delete(id);
  act(() => callback(at));
  return vi.mocked(drawNav).mock.calls.at(-1)![1];
}

it("实际画布的相邻帧不改确认时钟", () => {
  render(<NavCanvas source={source} nav={nav} overview={overview} zoom={12} />);
  const clockUpdates = vi.fn();
  const gameUpdates = vi.fn();
  const offClock = useClockStore.subscribe(clockUpdates);
  const offGame = useGame.subscribe(gameUpdates);
  expect(frame(0).ship!.x).toBe(10);
  frame(16);
  frame(33);
  expect(useClockStore.getState().minute).toBe(480);
  expect(clockUpdates).not.toHaveBeenCalled();
  expect(gameUpdates).not.toHaveBeenCalled();
  offClock();
  offGame();
});

it("预览线与暂停标记不逐帧重建", () => {
  useNavStore.setState({ preview: course });
  render(<NavCanvas source={source} nav={nav} overview={overview} zoom={12} />);
  const first = frame(0);
  const second = frame(16);
  expect(second.preview).toBe(first.preview);
  expect(second.stops).toBe(first.stops);
});
