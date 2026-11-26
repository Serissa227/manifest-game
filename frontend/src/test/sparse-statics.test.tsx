// 静态数据按 id 查（hide_unknown_ports 的世界）：桌面版的 static_data 只留看见过的地点、发现过的发现物，各条保留原来的 id，
// 下标不再等于 id（crates/manifest-appcore/src/navigation_view/visibility.rs 的 filter_static）。这里用 id 为 0、3、7 的地点，
// 看海图、港口、舰队、探险各处都按 id 找到对的那一条；以及概览里看见了新地点、新发现物之后只重取一次静态数据。
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { chartInput } from "../art/map";
import ExplorePanel from "../components/panels/ExplorePanel";
import FleetPanel from "../components/panels/FleetPanel";
import FuturesPanel from "../components/panels/FuturesPanel";
import PortPanel from "../components/panels/PortPanel";
import { t } from "../i18n";
import { byId, discoveryById, exchangeById, locById } from "../ipc/byId";
import { bumpRequestSeq } from "../ipc/sequence";
import type { LocView, Overview, StaticView } from "../ipc/types";
import { SIGHT_REFETCH_MS, resetSightSync, staticsBehind, useGame } from "../store/game";
import { discoveriesView, futures, installIpc, overview, port, startedGame, statics } from "./fixtures";

const far: LocView = { id: 3, key: "yuangang", name: "远港", kind: "port", x: 2, y: 2, faction: 1, shipyard: false, founded: null, lore: "", site: null };
const stone: LocView = { id: 7, key: "shicheng", name: "石城", kind: "city", x: 3, y: 1, faction: 0, shipyard: false, founded: null, lore: "", site: null };
const ninth: LocView = { id: 9, key: "wugang", name: "雾港", kind: "port", x: 0, y: 2, faction: 1, shipyard: false, founded: null, lore: "", site: null };

/** 看见过 0、3、7 号地点、发现过 5 号发现物时后端给的静态数据：下标 1、2 上是 3、7 号地点。 */
const sparse: StaticView = {
  ...statics,
  locations: [statics.locations[0], far, stone],
  roads: [{ ...statics.roads[0], id: 4, from: 3, to: 7 }],
  exchanges: [{ ...statics.exchanges[0], id: 2, name: "远港交易所", port: 3 }],
  discoveries: [{ id: 5, key: "fog_gate", name: "雾中石门", kind: "ruins", fame: 30, value: 4000, lore: "退潮时才露出来。" }],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  resetSightSync();
  startedGame();
});

describe("按 id 查静态数据", () => {
  it("下标不等于 id 时按 id 找到那一条；没看见过的为 undefined；下标正好等于 id 时照样对", () => {
    expect(locById(sparse, 3)?.name).toBe("远港");
    expect(locById(sparse, 7)?.name).toBe("石城");
    expect(locById(sparse, 0)?.name).toBe("澄港");
    expect(locById(sparse, 1)).toBeUndefined();
    expect(locById(sparse, 2)).toBeUndefined();
    expect(locById(sparse, null)).toBeUndefined();
    expect(locById(null, 3)).toBeUndefined();
    expect(discoveryById(sparse, 5)?.name).toBe("雾中石门");
    expect(discoveryById(sparse, 0)).toBeUndefined();
    expect(exchangeById(sparse, 2)?.name).toBe("远港交易所");
    expect(exchangeById(sparse, 0)).toBeUndefined();
    // 不过滤的静态数据（经典世界）
    expect(locById(statics, 2)?.name).toBe("兰城");
    // 同一个数组查两次是同一条（表按数组缓存）
    expect(byId(sparse.locations, 7)).toBe(stone);
  });

  it("海图：道路两端按 id 找到地点（3 号到 7 号）", () => {
    expect(chartInput(sparse).roads).toEqual([{ from: [2, 2], to: [3, 1] }]);
  });

  it("港口窗口：选中 3 号地点时标题是远港；选中没看见过的地点时不报错，提示去选一个港口", async () => {
    installIpc({ port: () => ({ ...port, loc: 3 }) });
    useGame.setState({ statics: sparse, selectedLoc: 3 });
    const { unmount } = render(<PortPanel />);
    expect(await screen.findByTestId("port-title-name")).toHaveTextContent("远港");
    unmount();
    useGame.setState({ selectedLoc: 2 });
    render(<PortPanel />);
    expect(screen.queryByTestId("port-panel")).toBeNull();
    expect(screen.getByText(t("portSelect"))).toBeInTheDocument();
  });

  it("舰队页：停在 3 号地点的舰队写“停靠 远港”", async () => {
    installIpc();
    useGame.setState({ statics: sparse, overview: { ...overview, fleets: [{ ...overview.fleets[0], docked: 3 }] } });
    render(<FleetPanel />);
    expect(await screen.findByText("停靠 远港")).toBeInTheDocument();
  });

  it("探险窗口：5 号发现物按 id 找到目录条目", async () => {
    installIpc({ discoveries: () => ({ ...discoveriesView, found: [{ id: 5, day: 8, reported: false, x: 2, y: 0 }] }) });
    useGame.setState({ statics: sparse });
    render(<ExplorePanel />);
    const card = await screen.findByTestId("discovery-5");
    expect(within(card).getByRole("heading", { name: "雾中石门" })).toBeInTheDocument();
  });

  it("期货窗口：2 号交易所按 id 找到名字", async () => {
    installIpc({
      futures: () => ({
        accounts: futures.accounts.map((a) => ({ ...a, exchange: 2 })),
        contracts: futures.contracts.map((c) => ({ ...c, exchange: 2 })),
      }),
    });
    useGame.setState({ statics: sparse });
    render(<FuturesPanel />);
    expect((await screen.findAllByText(/远港交易所/)).length).toBeGreaterThan(0);
  });
});

describe("看见新地点之后重取静态数据", () => {
  const seen = (sighted: number[], extra: Partial<Overview> = {}): Overview => ({ ...overview, sighted, ...extra });
  const staticCalls = (calls: ReturnType<typeof installIpc>) => calls.mock.calls.filter((c) => c[0] === "static_data").length;

  it("什么时候算缺：看见的地点不在静态数据里、发现物数多过目录、世界不同；没有 sighted 的世界不比地点", () => {
    expect(staticsBehind(sparse, seen([0, 3, 7]))).toBe(false);
    expect(staticsBehind(sparse, seen([0, 3, 7, 9]))).toBe(true);
    expect(staticsBehind(sparse, seen([0, 3, 7], { discovered_count: 2 }))).toBe(true);
    expect(staticsBehind(sparse, seen([0, 3, 7], { discovered_count: 1 }))).toBe(false);
    expect(staticsBehind({ ...sparse, world: { ...sparse.world, key: "terra16" } }, seen([0, 3, 7], { world_key: "classic" }))).toBe(true);
    expect(staticsBehind(sparse, overview)).toBe(false);
  });

  it("看见了 9 号地点：攒一下只取一次 static_data，换上新的静态数据；再推送同样的概览不再取", async () => {
    const more: StaticView = { ...sparse, locations: [...sparse.locations, ninth] };
    const calls = installIpc({ static_data: () => more });
    useGame.setState({ statics: sparse, overview: seen([0, 3, 7]) });
    act(() => useGame.getState().setOverview(seen([0, 3, 7], { day: 13 })));
    await sleep(SIGHT_REFETCH_MS + 100);
    expect(staticCalls(calls)).toBe(0);
    // 接连两次推送（高倍速）都带着 9 号：只取一次
    act(() => useGame.getState().setOverview(seen([0, 3, 7, 9], { day: 14 })));
    act(() => useGame.getState().setOverview(seen([0, 3, 7, 9], { day: 15 })));
    await waitFor(() => expect(useGame.getState().statics).toBe(more));
    expect(staticCalls(calls)).toBe(1);
    expect(locById(useGame.getState().statics, 9)?.name).toBe("雾港");
    act(() => useGame.getState().setOverview(seen([0, 3, 7, 9], { day: 16 })));
    await sleep(SIGHT_REFETCH_MS + 100);
    expect(staticCalls(calls)).toBe(1);
  });

  it("新发现了发现物（discovered_count 多过目录）也重取", async () => {
    const calls = installIpc({ static_data: () => sparse });
    useGame.setState({ statics: { ...sparse, discoveries: [] }, overview: seen([0, 3, 7], { discovered_count: 0 }) });
    act(() => useGame.getState().setOverview(seen([0, 3, 7], { discovered_count: 1 })));
    await waitFor(() => expect(staticCalls(calls)).toBe(1));
    await waitFor(() => expect(discoveryById(useGame.getState().statics, 5)?.name).toBe("雾中石门"));
  });

  it("取的时候换了一局（读档、开新局）：迟到的回复不用", async () => {
    let answer: (s: StaticView) => void = () => {};
    const calls = installIpc({ static_data: () => new Promise<StaticView>((r) => (answer = r)) });
    useGame.setState({ statics: sparse, overview: seen([0, 3, 7]) });
    act(() => useGame.getState().setOverview(seen([0, 3, 7, 9])));
    await waitFor(() => expect(staticCalls(calls)).toBe(1));
    bumpRequestSeq("load");
    answer({ ...sparse, locations: [...sparse.locations, ninth] });
    await sleep(50);
    expect(useGame.getState().statics).toBe(sparse);
  });
});
