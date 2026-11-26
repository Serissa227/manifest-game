// 画面时钟的采样与航迹生命周期；真实命令仍只带后端确认过的整数分钟。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshNav, resetNav, steerTo, useNavStore } from "../hooks/useNavigation";
import type { CoursePreview, NavView, Overview, StaticView } from "../ipc/types";
import { useClockStore } from "../store/clock";
import { useGame } from "../store/game";
import { installIpc, overview, startedGame, statics } from "./fixtures";

const nav: NavView = {
  fleet: 0, mode: "manual", day: 12, minute: 120, pos: { x: 1.5, y: 1.5 }, heading: 90,
  sail: "full", speed: 5, wind: { dir: 0, force: 3, name: "" }, current: null,
  sail_limit: 50, trail: [], forecast: [], stops: [], supplies_days: 30,
  morale: 100, sight: 3, autopilot: null, known_dests: [], lat_lon: null,
};
const course: CoursePreview = { points: [[1.5, 1.5, 120], [2.5, 1.5, 1440]], stops: [] };
const atSea: Overview = { ...overview, speed: 1, minute: 480,
  fleets: [{ ...overview.fleets[0], docked: null }] };
const manual: StaticView = { ...statics, world: { ...statics.world, modules: ["navigation_manual"] } };

beforeEach(() => {
  installIpc();
  startedGame();
  useGame.setState({ statics: manual, overview: atSea });
  resetNav();
});
afterEach(() => {
  resetNav();
  vi.restoreAllMocks();
});

describe("航行画面时钟的确认采样", () => {
  it("时刻没变的普通概览不重新计时，变速和暂停必须重新锚定", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(100);
    useClockStore.getState().syncOverview({ ...atSea, day: 30, minute: 480, speed: 1 });
    expect(useClockStore.getState()).toMatchObject({ sampledAt: 100, speed: 1 });
    now.mockReturnValue(200);
    useClockStore.getState().syncOverview({ ...atSea, day: 30, minute: 480, speed: 1, cash: 1 });
    expect(useClockStore.getState().sampledAt).toBe(100);
    useClockStore.getState().syncOverview({ ...atSea, day: 30, minute: 480, speed: 2 });
    expect(useClockStore.getState()).toMatchObject({ sampledAt: 200, speed: 2 });
    now.mockReturnValue(300);
    useClockStore.getState().syncOverview({ ...atSea, day: 30, minute: 480, speed: 0 });
    expect(useClockStore.getState()).toMatchObject({ sampledAt: 300, speed: 0, minute: 480 });
  });

  it("旧 clock 包不重置画面锚点，迟到的变速回复保留较新的确认时刻", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(100);
    useClockStore.getState().syncOverview({ ...atSea, day: 30, minute: 480 });
    now.mockReturnValue(200);
    useClockStore.getState().applyClock({ day: 30, minute: 520 });
    now.mockReturnValue(300);
    useClockStore.getState().applyClock({ day: 30, minute: 500 });
    expect(useClockStore.getState()).toMatchObject({ minute: 520, sampledAt: 200 });
    useClockStore.getState().syncOverview({ ...atSea, day: 30, minute: 500, speed: 4 });
    expect(useClockStore.getState()).toMatchObject({ minute: 520, sampledAt: 300, speed: 4 });
  });
});

describe("当天航迹与操舵状态绑定", () => {
  it("换日航迹在路上时清掉旧航迹，不用今天的分钟读取昨天的起点", async () => {
    let finish!: (value: CoursePreview) => void;
    const next = { ...nav, day: 13, minute: 0, pos: { x: 2.5, y: 1.5 } };
    installIpc({ navigation: () => next,
      preview_course: () => new Promise<CoursePreview>((resolve) => { finish = resolve; }) });
    useNavStore.setState({ nav, course });
    const request = refreshNav();
    await vi.waitFor(() => expect(useNavStore.getState().nav?.day).toBe(13));
    expect(useNavStore.getState().course).toBeNull();
    const today: CoursePreview = { points: [[2.5, 1.5, 0], [3.5, 1.5, 1440]], stops: [] };
    finish(today);
    await request;
    expect(useNavStore.getState().course).toEqual(today);
  });

  it("操舵期间迟到的旧航迹不发布，命令携带确认分钟而非画面外推分钟", async () => {
    const waiting: ((value: CoursePreview) => void)[] = [];
    const calls = installIpc({ navigation: () => nav,
      preview_course: () => new Promise<CoursePreview>((resolve) => waiting.push(resolve)),
      submit: () => ({ outcome: "Done", overview: atSea }) });
    useClockStore.getState().syncOverview(atSea);
    const request = refreshNav();
    await vi.waitFor(() => expect(waiting).toHaveLength(1));
    await steerTo(180);
    const stale: CoursePreview = { points: [[999, 999, 120]], stops: [] };
    waiting[0](stale);
    await request;
    await vi.waitFor(() => expect(waiting).toHaveLength(2));
    expect(useNavStore.getState().course).toBeNull();
    expect(calls).toHaveBeenCalledWith("submit", { command: {
      Steer: { owner: "player", fleet: 0, minute: 120, heading: 180 },
    } });
    waiting[1](course);
    await vi.waitFor(() => expect(useNavStore.getState().course).toEqual(course));
  });
});
