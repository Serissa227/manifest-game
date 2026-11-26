// 测试 13：期货下单（模拟的 Tauri IPC）。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import FuturesPanel from "../components/panels/FuturesPanel";
import { installIpc, startedGame } from "./fixtures";

describe("期货下单", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc();
    startedGame();
  });

  it("显示保证金、追保提示与持仓，并提交开仓、平仓、保证金与交割选择", async () => {
    const user = userEvent.setup();
    render(<FuturesPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("追保中（第 11 天发出）");
    expect(screen.getByText("5,000 金币")).toBeInTheDocument();
    const row = screen.getByTestId("futures-row-7");
    expect(within(row).getByText(/丝绸 · 第 60 天到期/)).toBeInTheDocument();
    expect(within(row).getByText("2 手，均价 90，浮动盈亏 100 金币")).toBeInTheDocument();

    await user.click(row);
    const lots = screen.getByLabelText("手数");
    await user.clear(lots);
    await user.type(lots, "3");
    await user.click(screen.getByRole("button", { name: "买入开多" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { TradeFutures: { owner: "player", contract: 7, lots: 3 } },
      }),
    );
    await user.click(screen.getByRole("button", { name: "卖出开空" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { TradeFutures: { owner: "player", contract: 7, lots: -3 } },
      }),
    );
    await user.click(screen.getByRole("button", { name: "平仓" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { TradeFutures: { owner: "player", contract: 7, lots: -2 } },
      }),
    );
    await user.click(screen.getByRole("checkbox"));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { SetDelivery: { owner: "player", contract: 7, physical: true } },
      }),
    );

    const amount = screen.getByLabelText("金额");
    await user.clear(amount);
    await user.type(amount, "2500");
    await user.click(screen.getByRole("button", { name: "存入保证金" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { DepositMargin: { owner: "player", exchange: 0, amount: 2500 } },
      }),
    );
    await user.click(screen.getByRole("button", { name: "取回保证金" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { WithdrawMargin: { owner: "player", exchange: 0, amount: 2500 } },
      }),
    );
  });
});
