// H05：航行视图的“岸上”面板（岸上差事、召回、下网、避风）。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShoreMenu } from "../components/nav/ShorePanel";
import { biomeNames, shoreButton } from "../components/nav/shoreKit";
import type { NavView, ShoreView } from "../ipc/types";
import { useGame } from "../store/game";
import { startedGame } from "./fixtures";

const shore: ShoreView = {
  coast: true,
  river: true,
  biomes: ["D", "J"],
  options: [
    { task: "water", hands: 4, days: 1, gain: 120, block: null },
    { task: "forage", hands: 8, days: 2, gain: 30, block: null },
    { task: "timber", hands: 10, days: 3, gain: 0, block: "no_forest" },
    { task: "careen", hands: 24, days: 5, gain: 0, block: "full" },
  ],
  camp: null,
  nets: false,
  nets_working: false,
  fish: 40,
  anchored: true,
  lee: true,
  shelter_keep: 30,
};

const nav = (s: ShoreView | undefined): NavView => ({
  fleet: 0, day: 12, minute: 120, mode: "manual", pos: { x: 10, y: 10 }, heading: 90, sail: "furled", speed: 0,
  wind: { dir: 0, force: 3, name: "" }, current: null, sail_limit: 50, trail: [], forecast: [], stops: [],
  supplies_days: 30, morale: 100, sight: 3, autopilot: null, known_dests: [], lat_lon: null, shore: s,
});

beforeEach(() => startedGame());
afterEach(cleanup);

describe("岸上面板", () => {
  it("列出四件差事：能做的写人手、天数与所得，做不了的灰掉写原因；勾选后一次派出", () => {
    const submit = vi.fn().mockResolvedValue({ Done: null });
    useGame.setState({ submit });
    render(<ShoreMenu nav={nav(shore)} onClose={() => {}} />);
    expect(screen.getByTestId("shore-site")).toHaveTextContent("荒漠、雨林");
    expect(screen.getByTestId("shore-site")).toHaveTextContent("附近有河");
    expect(screen.getByTestId("shore-task-water")).toHaveTextContent("4 人 · 1 天");
    expect(screen.getByTestId("shore-task-water")).toHaveTextContent("水 +120");
    expect(screen.getByTestId("shore-task-timber")).toHaveTextContent("附近没有林子");
    expect(screen.getByTestId("shore-task-timber").querySelector("input")).toBeDisabled();
    expect(screen.getByTestId("shore-task-careen")).toHaveTextContent("已经满了");
    expect(screen.getByTestId("shore-send")).toBeDisabled();
    fireEvent.click(screen.getByTestId("shore-task-water").querySelector("input")!);
    fireEvent.click(screen.getByTestId("shore-task-forage").querySelector("input")!);
    expect(screen.getByTestId("shore-send")).toHaveTextContent("12 人，2 天");
    fireEvent.click(screen.getByTestId("shore-send"));
    expect(submit).toHaveBeenLastCalledWith({ Shore: { owner: "player", fleet: 0, order: { start: { tasks: ["water", "forage"] } } } });
    expect(screen.getByTestId("shore-lee")).toHaveTextContent("30%");
  });

  it("差事期间显示第几天与召回；按钮上写天数", () => {
    const submit = vi.fn().mockResolvedValue({ Done: null });
    useGame.setState({ submit });
    const busy = { ...shore, camp: { elapsed: 1, days: 2, jobs: [{ task: "forage" as const, days: 2, hands: 8 }] } };
    expect(shoreButton(nav(busy))).toBe("岸上 1/2 天");
    expect(shoreButton(nav(shore))).toBe("岸上");
    expect(shoreButton(nav(undefined))).toBeNull();
    render(<ShoreMenu nav={nav(busy)} onClose={() => {}} />);
    expect(screen.getByTestId("shore-camp")).toHaveTextContent("岸上第 1/2 天");
    expect(screen.queryByTestId("shore-send")).toBeNull();
    fireEvent.click(screen.getByTestId("shore-recall"));
    expect(submit).toHaveBeenLastCalledWith({ Shore: { owner: "player", fleet: 0, order: "recall" } });
  });

  it("离岸远时只给下网；下网开关提交 nets", () => {
    const submit = vi.fn().mockResolvedValue({ Done: null });
    useGame.setState({ submit });
    render(<ShoreMenu nav={nav({ ...shore, coast: false })} onClose={() => {}} />);
    expect(screen.getByTestId("shore-menu")).toHaveTextContent("离岸太远");
    expect(screen.queryByTestId("shore-task-water")).toBeNull();
    expect(screen.getByTestId("shore-menu")).toHaveTextContent("约够全船吃 40% 的一天");
    fireEvent.click(screen.getByTestId("shore-nets"));
    expect(submit).toHaveBeenLastCalledWith({ Shore: { owner: "player", fleet: 0, order: { nets: { on: true } } } });
  });

  it("地貌代码转中文，不认识的略去", () => {
    expect(biomeNames(["B", "?", "W"])).toBe("针叶林、湿地");
  });
});
