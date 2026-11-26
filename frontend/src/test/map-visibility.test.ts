import { afterEach, expect, it, vi } from "vitest";
import { resetNav, toggleNavView } from "../hooks/useNavigation";
import { watchMapVisibility } from "../map/visibility";
import { useGame } from "../store/game";
import { overview, startedGame, statics } from "./fixtures";

afterEach(() => resetNav());

it("航海覆盖时停止世界图，暂停和反复切图不丢失恢复绘制的订阅", () => {
  startedGame();
  const sea = { ...overview, fleets: [{ ...overview.fleets[0], docked: null }] };
  useGame.setState({ stage: "chart", statics: { ...statics, world: { ...statics.world, modules: ["navigation_manual"] } }, overview: sea });
  resetNav();
  const ticker = { started: true, start: vi.fn(() => { ticker.started = true; }), stop: vi.fn(() => { ticker.started = false; }) };
  const size = { clientWidth: 1000, clientHeight: 700 };
  const watcher = watchMapVisibility(size, ticker);
  expect(ticker.started).toBe(false);
  for (const speed of [0, 4, 0, 8, 0]) {
    useGame.setState({ overview: { ...sea, speed } });
    expect(ticker.started).toBe(false);
    toggleNavView();
    expect(ticker.started).toBe(true);
    toggleNavView();
    expect(ticker.started).toBe(false);
  }
  useGame.setState({ overview });
  expect(ticker.started).toBe(true);
  useGame.setState({ stage: "town" });
  expect(ticker.started).toBe(false);
  useGame.setState({ stage: "chart" });
  size.clientWidth = 0;
  watcher.sync();
  expect(ticker.started).toBe(false);
  size.clientWidth = 1000;
  watcher.sync();
  expect(ticker.started).toBe(true);
  watcher.dispose();
  const stopped = ticker.stop.mock.calls.length;
  useGame.setState({ stage: "town" });
  expect(ticker.stop).toHaveBeenCalledTimes(stopped);
});
