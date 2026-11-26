// 测试 13：报表（模拟的 Tauri IPC）。
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import ReportsPanel from "../components/panels/ReportsPanel";
import { installIpc, startedGame } from "./fixtures";

describe("报表", () => {
  beforeEach(() => {
    installIpc();
    startedGame();
  });

  it("显示三大报表与资产走势，可按月 / 按年切换", async () => {
    const user = userEvent.setup();
    render(<ReportsPanel />);
    const income = await screen.findByTestId("income-statement");
    expect(within(income).getByText("销售收入")).toBeInTheDocument();
    expect(within(income).getByText("销售成本")).toBeInTheDocument();
    expect(within(income).getByText("工资")).toBeInTheDocument();
    expect(within(income).getByText("1,345 金币")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "第 0–30 天" })).toBeInTheDocument();

    const [monthBalance, current] = screen.getAllByTestId("balance-sheet");
    expect(within(monthBalance).getByText("现金")).toBeInTheDocument();
    expect(within(monthBalance).getByText("船只")).toBeInTheDocument();
    expect(within(current).getByText("实收资本")).toBeInTheDocument();

    const cash = screen.getByTestId("cash-flow");
    expect(within(cash).getByText("经营活动")).toBeInTheDocument();
    expect(within(cash).getByText("12,345 金币")).toBeInTheDocument();
    expect(screen.getByTestId("asset-trend")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "年报" }));
    expect(screen.getByText("尚无已结账的报表（每月末生成）")).toBeInTheDocument();
    expect(screen.queryByTestId("income-statement")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "月报" }));
    expect(screen.getByTestId("income-statement")).toBeInTheDocument();
  });
});
