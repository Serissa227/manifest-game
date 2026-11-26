// 视图查询的调度（store/views.ts，性能商议 2026-10-07 第 2 条）：按“世界的状态变没变”重新查询（只改倍速、重复的推送不查），
// 同一个 key 共用一份结果，每类查询只有一个在途、一个最新需求（迟到的旧结果丢掉、中间的需求不再发请求），没打开的不查。
import { act, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useView } from "../hooks/useView";
import { api } from "../ipc/api";
import type { PortView } from "../ipc/types";
import { useGame } from "../store/game";
import { viewStats, worldChanged } from "../store/views";
import { installIpc, overview, port, startedGame } from "./fixtures";

/** 可以手动放行的请求：每次调用排进队列，测试里按顺序 resolve。 */
function deferredIpc(cmd: string) {
  const pending: { args: Record<string, unknown>; resolve: (v: unknown) => void }[] = [];
  const calls = installIpc({
    [cmd]: (args) =>
      new Promise((resolve) => {
        pending.push({ args, resolve });
      }),
  });
  const count = () => calls.mock.calls.filter(([c]) => c === cmd).length;
  return { pending, count };
}

/** 等事件循环转几圈（请求的 Promise 链走完）。 */
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

function PortName({ loc, label }: { loc: number; label: string }) {
  const { data } = useView<PortView>(`port:${loc}`, () => api.port(loc));
  return <p data-testid={label}>{data ? `${data.loc}:${data.mates_here.length}` : "loading"}</p>;
}

describe("领域版本：世界的状态变没变", () => {
  it("只改了倍速、时刻、编号、AI 预算不算变；换了日期、内容变了算变；同一个对象不算", () => {
    expect(worldChanged(overview, overview)).toBe(false);
    expect(worldChanged(overview, { ...overview })).toBe(false);
    expect(worldChanged(overview, { ...overview, speed: 4, minute: 700, rev: 9, budget: null, ai_mode: "live" })).toBe(false);
    expect(worldChanged(overview, { ...overview, day: overview.day + 1 })).toBe(true);
    expect(worldChanged(overview, { ...overview, cash: overview.cash + 1 })).toBe(true);
    expect(worldChanged(overview, { ...overview, fleets: overview.fleets.map((f) => ({ ...f, morale: f.morale - 1 })) })).toBe(true);
    expect(worldChanged(overview, { ...overview, epoch: 3 })).toBe(true);
    expect(worldChanged(null, overview)).toBe(true);
    expect(worldChanged(overview, null)).toBe(true);
  });
});

describe("视图查询的调度", () => {
  beforeEach(() => {
    startedGame();
  });

  it("同一个 key 的两个使用者同时挂上时只问一次；后来的使用者再问一次，结果交给所有人", async () => {
    let reply: PortView = port;
    const calls = installIpc({ port: () => reply });
    const n = () => calls.mock.calls.filter(([c]) => c === "port").length;
    render(
      <>
        <PortName loc={0} label="a" />
        <PortName loc={0} label="b" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("0:1"));
    expect(screen.getByTestId("b")).toHaveTextContent("0:1");
    expect(n()).toBe(1);
    // 后来挂上的使用者不拿旧结果：再问一次，新结果交给所有使用者
    reply = { ...port, mates_here: [] };
    render(<PortName loc={0} label="c" />);
    expect(screen.getByTestId("c")).toHaveTextContent("loading");
    await waitFor(() => expect(screen.getByTestId("c")).toHaveTextContent("0:0"));
    expect(screen.getByTestId("a")).toHaveTextContent("0:0");
    expect(screen.getByTestId("b")).toHaveTextContent("0:0");
    expect(n()).toBe(2);
  });

  it("在途时世界连变 20 次：同一时间只有一个请求在路上，回来后只再问一次，显示的是最后一次的结果", async () => {
    const { pending, count } = deferredIpc("port");
    render(<PortName loc={0} label="a" />);
    expect(count()).toBe(1);
    for (let d = 1; d <= 20; d++) act(() => useGame.getState().setOverview({ ...overview, day: overview.day + d }));
    await flush();
    expect(count()).toBe(1);
    expect(viewStats().inflight).toBe(1);
    // 第一个回来：先显示（比没有强），再为最新的需求问一次
    act(() => pending[0].resolve({ ...port, mates_here: [] }));
    await flush();
    expect(screen.getByTestId("a")).toHaveTextContent("0:0");
    expect(count()).toBe(2);
    act(() => pending[1].resolve(port));
    await flush();
    expect(screen.getByTestId("a")).toHaveTextContent("0:1");
    // 需求都满足了：不再发请求
    await flush();
    expect(count()).toBe(2);
    expect(viewStats().inflight).toBe(0);
  });

  it("快速换 key：在途的旧结果丢掉，中间的 key 不再请求，只问最后一个", async () => {
    const { pending, count } = deferredIpc("port");
    let pick: (loc: number) => void = () => {};
    function Picker() {
      const [loc, setLoc] = useState(0);
      pick = setLoc;
      return <PortName loc={loc} label="a" />;
    }
    render(<Picker />);
    expect(count()).toBe(1);
    for (const loc of [1, 2, 3]) act(() => pick(loc));
    await flush();
    // port:0 还在路上：port:1、port:2 的需求随着换走作废，port:3 排着
    expect(count()).toBe(1);
    act(() => pending[0].resolve({ ...port, loc: 0 }));
    await flush();
    // 旧结果不显示（换了 key 之后它已经没人要了）
    expect(screen.getByTestId("a")).toHaveTextContent("loading");
    expect(count()).toBe(2);
    expect(pending[1].args).toEqual({ loc: 3 });
    act(() => pending[1].resolve({ ...port, loc: 3 }));
    await flush();
    expect(screen.getByTestId("a")).toHaveTextContent("3:1");
    expect(count()).toBe(2);
  });

  it("只改了倍速不重新查询；本地命令之后即使概览一样也重新查询", async () => {
    const calls = installIpc({ set_speed: () => ({ ...overview, speed: 4 }) });
    const n = () => calls.mock.calls.filter(([c]) => c === "port").length;
    render(<PortName loc={0} label="a" />);
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("0:1"));
    expect(n()).toBe(1);
    await act(() => useGame.getState().setSpeed(4));
    await flush();
    expect(useGame.getState().overview?.speed).toBe(4);
    expect(n()).toBe(1);
    // 重复的推送（内容相同）也不查
    act(() => useGame.getState().applyPushed({ ...overview, speed: 4 }));
    await flush();
    expect(n()).toBe(1);
    // 命令可能改了概览里看不出来的状态：照样重新查询
    await act(() => useGame.getState().submit({ SetInfoMode: { owner: "player", mode: "carried" } }));
    await waitFor(() => expect(n()).toBe(2));
    await flush();
    expect(n()).toBe(2);
  });

  it("没打开的面板不查询：卸下之后世界再变也不发请求", async () => {
    const calls = installIpc();
    const n = () => calls.mock.calls.filter(([c]) => c === "port").length;
    const { unmount } = render(<PortName loc={0} label="a" />);
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("0:1"));
    unmount();
    for (let d = 1; d <= 5; d++) act(() => useGame.getState().setOverview({ ...overview, day: overview.day + d }));
    await flush();
    expect(n()).toBe(1);
    expect(viewStats().slots).toBe(0);
  });
});
