import { afterEach, expect, it, vi } from "vitest";
import { refreshNav, resetNav, useNavStore } from "../hooks/useNavigation";
import type { NavView } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, startedGame, statics } from "./fixtures";

afterEach(() => { resetNav(); vi.useRealTimers(); });

it("暂停期间一次查询失败保留船位并只补一次重试，换局取消重试", async () => {
  vi.useFakeTimers();
  startedGame();
  const current = { ...overview, speed: 0, fleets: [{ ...overview.fleets[0], docked: null }] };
  useGame.setState({ statics: { ...statics, world: { ...statics.world, modules: ["navigation_manual"] } }, overview: current });
  resetNav();
  const nav = { fleet: current.fleets[0].id, day: current.day, minute: 120, pos: { x: 1, y: 1 }, heading: 90, sail: "full" } as NavView;
  useNavStore.setState({ nav });
  const calls = installIpc({ navigation: () => { throw new Error("temporary query failure"); } });
  await refreshNav();
  expect(useNavStore.getState().nav).toEqual(nav);
  await vi.advanceTimersByTimeAsync(500);
  await vi.advanceTimersByTimeAsync(5000);
  expect(calls.mock.calls.filter(([name]) => name === "navigation")).toHaveLength(2);
  expect(useNavStore.getState().nav).toEqual(nav);
  resetNav();
  await refreshNav();
  resetNav();
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls.mock.calls.filter(([name]) => name === "navigation")).toHaveLength(3);
  expect(useNavStore.getState().nav).toBeNull();
});

it("查询返回前概览已换日：丢弃旧船位，接着查询当前航程", async () => {
  startedGame();
  const current = { ...overview, fleets: [{ ...overview.fleets[0], docked: null }] };
  useGame.setState({ statics: { ...statics, world: { ...statics.world, modules: ["navigation_manual"] } }, overview: current });
  resetNav();
  const old = { fleet: current.fleets[0].id, day: current.day, minute: 120, pos: { x: 1, y: 1 }, heading: 90, sail: "full" } as NavView;
  const fresh = { ...old, day: current.day + 1, pos: { x: 2, y: 2 } };
  let finish: ((nav: NavView) => void) | undefined;
  let count = 0;
  const calls = installIpc({ navigation: () => ++count === 1 ? new Promise<NavView>((resolve) => { finish = resolve; }) : fresh });
  const pending = refreshNav();
  await vi.waitFor(() => expect(finish).toBeDefined());
  useGame.setState({ overview: { ...current, day: fresh.day } });
  finish?.(old);
  await pending;
  await vi.waitFor(() => expect(useNavStore.getState().nav).toEqual(fresh));
  expect(count).toBe(2);
  expect(calls.mock.calls.filter(([name]) => name === "preview_course")).toHaveLength(1);
});

it("后端已靠港时主动同步概览，暂停中也能退出失效的航海画面", async () => {
  startedGame();
  useGame.setState({
    statics: { ...statics, world: { ...statics.world, modules: ["navigation_manual"] } },
    overview: { ...overview, speed: 0, fleets: [{ ...overview.fleets[0], docked: null }] },
  });
  resetNav();
  const calls = installIpc({ navigation: () => null, overview: () => overview });
  await refreshNav();
  await vi.waitFor(() => expect(useGame.getState().overview?.fleets[0].docked).toBe(overview.fleets[0].docked));
  expect(useNavStore.getState().nav).toBeNull();
  expect(calls.mock.calls.filter(([name]) => name === "overview")).toHaveLength(1);
});
