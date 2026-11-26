// 招募船员（玩家反馈“不知道船员如何补充”）：一键补到最低人数 / 补满，按此刻招得到的人手（hire_max）与现金封顶；
// 舰队页、酒馆最上面、出港确认框与港口名牌都有；招不了时写明原因。
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MapView from "../components/MapView";
import FleetPanel from "../components/panels/FleetPanel";
import PortPanel from "../components/panels/PortPanel";
import PortScene from "../components/PortScene";
import { crewPlan } from "../components/crew/crewPlan";
import { beginDeparture, useVoyage, useVoyageStore } from "../hooks/useVoyage";
import type { FleetView } from "../ipc/types";
import { createMapRenderer } from "../map/renderer";
import { useGame } from "../store/game";
import { installIpc, overview, port, startedGame } from "./fixtures";

vi.mock("../map/renderer", () => ({ createMapRenderer: vi.fn() }));
const create = vi.mocked(createMapRenderer);

const base: FleetView = overview.fleets[0];
/** 船员 5 人（最少 8、最多 20），此刻招得到 15 人。 */
const short: FleetView = { ...base, crew: 5, hire_max: 15 };

function withFleet(f: FleetView) {
  useGame.setState({ overview: { ...overview, fleets: [f] } });
}

describe("一键补员的人数", () => {
  it("补到最低人数与补满：按人手与现金封顶，写明为什么招不满", () => {
    // 单价 10：现金 12345 够招很多；差 3 人到最低、15 人到上限
    expect(crewPlan(short, 12345, 10)).toEqual({ toMin: 3, toFull: 15, short: 3, limit: null });
    // 这里只招得到 2 人：补不到最低人数
    expect(crewPlan({ ...short, hire_max: 2 }, 12345, 10)).toEqual({ toMin: 2, toFull: 2, short: 3, limit: "hands" });
    // 现金只够 1 人
    expect(crewPlan(short, 15, 10)).toEqual({ toMin: 1, toFull: 1, short: 3, limit: "cash" });
    // 在海上：什么也招不了
    expect(crewPlan({ ...short, docked: null, hire_max: 0 }, 12345, 10)).toEqual({ toMin: 0, toFull: 0, short: 3, limit: "sea" });
    // 船员够了：只有“补满”
    expect(crewPlan({ ...base, hire_max: 8 }, 12345, 10)).toEqual({ toMin: 0, toFull: 8, short: 0, limit: null });
    // 旧后端没有 hire_max：按船员上限算
    expect(crewPlan({ ...base, hire_max: undefined }, 12345, 10).toFull).toBe(8);
  });
});

describe("舰队页与酒馆", () => {
  beforeEach(() => {
    startedGame();
  });

  it("舰队页有“船员”一节：船员不足时写明差多少，一键补到最低人数或补满", async () => {
    const calls = installIpc();
    withFleet(short);
    const user = userEvent.setup();
    render(<FleetPanel />);
    await waitFor(() => expect(screen.getByTestId("sail-preview")).not.toHaveTextContent("正在载入"));
    const sec = screen.getByTestId("fleet-crew");
    expect(within(sec).getByTestId("crew-short")).toHaveTextContent("船员不足：至少要 8 人，现有 5 人。");
    expect(within(sec).getByText(/每人每天工资 1 金币，招募一人 10 金币/)).toBeInTheDocument();
    expect(within(sec).getByRole("button", { name: "补满船员（+15，150 金币）" })).toBeInTheDocument();
    await user.click(within(sec).getByRole("button", { name: "补到最低人数（+3，30 金币）" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { HireCrew: { owner: "player", fleet: 0, count: 3 } } }));
    // 提交后概览换成后端返回的（模拟里是船员 12 人）；换回不足的舰队再点“补满”
    act(() => withFleet(short));
    await user.click(within(screen.getByTestId("fleet-crew")).getByRole("button", { name: "补满船员（+15，150 金币）" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { HireCrew: { owner: "player", fleet: 0, count: 15 } } }));
  });

  it("在海上时没有按钮，写明靠港后才能招募；船员满了写明已满", async () => {
    installIpc();
    withFleet({ ...base, docked: null, dest: 1, hire_max: 0 });
    const { unmount } = render(<FleetPanel />);
    const sec = await screen.findByTestId("fleet-crew");
    expect(within(sec).queryByRole("button")).toBeNull();
    expect(sec).toHaveTextContent("靠港后才能招募船员");
    unmount();
    withFleet({ ...base, crew: 20, hire_max: 0 });
    render(<FleetPanel />);
    await waitFor(() => expect(screen.getByTestId("sail-preview")).not.toHaveTextContent("正在载入"));
    expect(screen.getByTestId("fleet-crew")).toHaveTextContent("船员已满。");
  });

  it("酒馆最上面就是“招募船员”：在港的每支舰队一键补足，也能按数量招募或解雇", async () => {
    const calls = installIpc({ port: () => ({ ...port, fleets_here: [0] }) });
    withFleet(short);
    useGame.setState({ facility: "tavern" });
    const user = userEvent.setup();
    render(<PortPanel />);
    const crew = await screen.findByTestId("tavern-crew");
    // 在“本港酒馆的航海士”之前
    const mates = screen.getByText("本港酒馆的航海士");
    expect(crew.compareDocumentPosition(mates) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(crew).getByTestId("crew-short")).toHaveTextContent("至少要 8 人，现有 5 人");
    await user.click(within(crew).getByRole("button", { name: "补到最低人数（+3，30 金币）" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { HireCrew: { owner: "player", fleet: 0, count: 3 } } }));
    expect(within(crew).getByRole("button", { name: /^招募/ })).toBeInTheDocument();
    expect(within(crew).getByRole("button", { name: "解雇" })).toBeInTheDocument();
  });

  it("这里招不到人手时写明原因，不给按钮", async () => {
    installIpc({ port: () => ({ ...port, fleets_here: [0] }) });
    withFleet({ ...short, hire_max: 0 });
    useGame.setState({ facility: "tavern" });
    render(<PortPanel />);
    const crew = await screen.findByTestId("tavern-crew");
    expect(within(crew).queryByRole("button", { name: /补到最低人数|补满船员/ })).toBeNull();
    expect(crew).toHaveTextContent("这里暂时招不到人手，换个港口试试。");
  });
});

describe("出港确认框与港口名牌", () => {
  beforeEach(() => {
    startedGame();
    useVoyageStore.setState({ picking: false, target: null, plan: null, known: {} });
    create.mockReset();
    create.mockResolvedValue({ update: vi.fn(), setFog: vi.fn(), destroy: vi.fn() });
  });

  function Harness() {
    useVoyage();
    return <MapView />;
  }

  it("船员不足时确认框写明开不了船，一键补到最低人数", async () => {
    const calls = installIpc({ sail_preview: () => ({ days: 5, path: [[1, 1], [2, 1]], supplies: 6 }), port: () => port });
    withFleet(short);
    const user = userEvent.setup();
    render(<Harness />);
    act(() => beginDeparture());
    await user.click(screen.getByRole("button", { name: /柳湾/ }));
    expect(await screen.findByTestId("departure-crew")).toHaveTextContent("5 人（最少 8，最多 20）");
    expect(screen.getByTestId("departure-crew-short")).toHaveTextContent("船员不足：至少要 8 人，现在只有 5 人，开不了船。");
    // 紧凑模式：只有“补到最低人数”
    const box = screen.getByTestId("departure-crew-hire");
    expect(within(box).getAllByRole("button")).toHaveLength(1);
    await user.click(within(box).getByRole("button", { name: "补到最低人数（+3，30 金币）" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { HireCrew: { owner: "player", fleet: 0, count: 3 } } }));
  });

  it("船员够时确认框只写人数，没有提示", async () => {
    installIpc({ sail_preview: () => ({ days: 5, path: [[1, 1], [2, 1]], supplies: 6 }), port: () => port });
    withFleet({ ...base, hire_max: 8 });
    const user = userEvent.setup();
    render(<Harness />);
    act(() => beginDeparture());
    await user.click(screen.getByRole("button", { name: /柳湾/ }));
    expect(await screen.findByTestId("departure-crew")).toHaveTextContent("12 人（最少 8，最多 20）");
    expect(screen.queryByTestId("departure-crew-short")).toBeNull();
  });

  it("旗舰队船员不足时港口名牌下有提示与“补到最低人数”", async () => {
    const calls = installIpc();
    withFleet(short);
    useGame.setState({ selectedLoc: 0, stage: "town" });
    const user = userEvent.setup();
    const { unmount } = render(<PortScene />);
    const chip = await screen.findByTestId("scene-crew-short");
    expect(chip).toHaveTextContent("船员不足 5/8，开不了船");
    await user.click(within(chip).getByRole("button", { name: "补到最低人数（+3，30 金币）" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", { command: { HireCrew: { owner: "player", fleet: 0, count: 3 } } }));
    unmount();
    withFleet({ ...base, hire_max: 8 });
    render(<PortScene />);
    await screen.findByTestId("port-scene");
    expect(screen.queryByTestId("scene-crew-short")).toBeNull();
  });
});
