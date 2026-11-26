// 刷新开销：图表只创建一次实例；调试面板不随每天的推进重新计算状态哈希。
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { init } from "echarts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LineChart } from "../components/Chart";
import DebugPanel from "../components/panels/DebugPanel";
import { useGame } from "../store/game";
import { installIpc, overview, startedGame } from "./fixtures";

describe("刷新开销", () => {
  beforeEach(() => {
    startedGame();
    vi.mocked(init).mockClear();
  });

  it("数据变化时复用同一个图表实例，只更新数据", async () => {
    const { rerender, unmount } = render(<LineChart labels={["1", "2"]} series={[{ name: "价", data: [1, 2] }]} />);
    await waitFor(() => expect(init).toHaveBeenCalledTimes(1));
    const chart = vi.mocked(init).mock.results[0].value as { setOption: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };
    await waitFor(() => expect(chart.setOption).toHaveBeenCalledTimes(1));
    for (let i = 3; i < 10; i++) {
      rerender(<LineChart labels={["1", "2", String(i)]} series={[{ name: "价", data: [1, 2, i] }]} />);
    }
    await waitFor(() => expect(chart.setOption).toHaveBeenCalledTimes(8));
    expect(init).toHaveBeenCalledTimes(1);
    expect(chart.dispose).not.toHaveBeenCalled();
    unmount();
    expect(chart.dispose).toHaveBeenCalledTimes(1);
  });

  it("调试面板只在打开与点刷新时查询", async () => {
    const calls = installIpc({
      debug: () => ({ day: 12, state_hash: "abc", log_len: 3, ai_commands: 1, money_conserved: true, audit: [] }),
    });
    const user = userEvent.setup();
    render(<DebugPanel />);
    expect(await screen.findByText("abc")).toBeInTheDocument();
    for (let d = 13; d < 20; d++) useGame.getState().setOverview({ ...overview, day: d });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.mock.calls.filter(([cmd]) => cmd === "debug")).toHaveLength(1);
    // 显示数据所属的日期，过时时提示刷新
    expect(screen.getByTestId("debug-asof")).toHaveTextContent("以下数据截至第 12 天（已过时，点“刷新”更新）");
    await user.click(screen.getByRole("button", { name: "刷新" }));
    await waitFor(() => expect(calls.mock.calls.filter(([cmd]) => cmd === "debug")).toHaveLength(2));
  });
});
