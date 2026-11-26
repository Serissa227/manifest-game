// M5 界面：遭遇海盗对话框、战术海战、航海士、海图与未到访港口（模拟的 Tauri IPC）。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import BattleDialog from "../components/BattleDialog";
import MatesPanel from "../components/panels/MatesPanel";
import PortPanel from "../components/panels/PortPanel";
import TacticalPanel from "../components/panels/TacticalPanel";
import { useGame } from "../store/game";
import { installIpc, overview, port, startedGame } from "./fixtures";

describe("海战", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc();
    startedGame();
  });

  it("遭遇海盗时可选择自动结算或战术海战", async () => {
    const user = userEvent.setup();
    useGame.setState({
      overview: { ...overview, pending_battles: [{ id: 4, fleet: 0, pirate_ships: 2, pirate_guns: 16, pirate_crew: 40 }] },
    });
    render(<BattleDialog />);
    const dialog = screen.getByTestId("battle-dialog");
    expect(within(dialog).getByText("舰队 #0 遭遇 2 艘海盗船（火炮 16 门，船员约 40 人）。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "自动结算" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { EngageBattle: { owner: "player", battle: 4, tactical: false } },
      }),
    );
    useGame.setState({
      overview: { ...overview, pending_battles: [{ id: 4, fleet: 0, pirate_ships: 2, pirate_guns: 16, pirate_crew: 40 }] },
    });
    await user.click(await screen.findByRole("button", { name: "战术海战" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { EngageBattle: { owner: "player", battle: 4, tactical: true } },
      }),
    );
    expect(useGame.getState().tab).toBe("battle");
  });

  it("战术海战：移动、开火、转向、撤退与结束回合都以命令提交", async () => {
    const user = userEvent.setup();
    const inBattle = { ...overview, tactical_battles: [4] };
    calls = installIpc({ submit: () => ({ outcome: "Done", overview: inBattle }) });
    useGame.setState({ overview: inBattle });
    render(<TacticalPanel />);
    expect(await screen.findByText("第 1 回合 / 共 30 回合 · 风向：东")).toBeInTheDocument();
    expect(screen.getByText(/#2 单桅帆船（已沉没）/)).toBeInTheDocument();
    expect(screen.getByText(/#1 向 #0 开火，造成 5 点伤害/)).toBeInTheDocument();
    expect(calls).toHaveBeenCalledWith("battle", { id: 4 });

    await user.click(screen.getByTestId("hex--1-0"));
    const order = (o: unknown) => ({ command: { TacticalCommand: { owner: "player", battle: 4, order: o } } });
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", order({ Move: { unit: 0, q: -1, r: 0 } })));
    await user.click(screen.getByTestId("unit-1"));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", order({ Fire: { unit: 0, target: 1 } })));
    await user.click(screen.getByRole("button", { name: "东南" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", order({ Turn: { unit: 0, facing: 5 } })));
    await user.click(screen.getByRole("button", { name: "撤退" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", order("Retreat")));
    await user.click(screen.getByRole("button", { name: "结束回合" }));
    await waitFor(() => expect(calls).toHaveBeenCalledWith("submit", order("EndTurn")));
  });
});

describe("航海士与探索", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc();
    startedGame();
  });

  it("酒馆可招募航海士、购买海图", async () => {
    const user = userEvent.setup();
    render(<PortPanel />);
    await user.click(await screen.findByRole("tab", { name: "酒馆" }));
    const card = await screen.findByTestId("tavern-mate-1");
    expect(within(card).getByText("周明远")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "招募（1500 金币）" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { HireMate: { owner: "player", mate: 1 } } }),
    );
    expect(screen.getByText("已拥有")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "购买（900 金币）" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { BuyChart: { owner: "player", region: 1 } } }),
    );
  });

  it("未到访的港口不显示行情", async () => {
    installIpc({ port: () => ({ ...port, known: false, market: [] }) });
    render(<PortPanel />);
    expect(await screen.findByText("尚未到访：抵达后才能看到这里的市场行情。")).toBeInTheDocument();
  });

  it("任命与解雇航海士", async () => {
    const user = userEvent.setup();
    render(<MatesPanel />);
    const card = await screen.findByTestId("mate-0");
    expect(within(card).getAllByText(/舰长（舰队 #0）/).length).toBeGreaterThan(0);
    await user.selectOptions(within(card).getByLabelText("任命"), "trader");
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { AssignMate: { owner: "player", mate: 0, role: "Trader" } },
      }),
    );
    await user.selectOptions(within(card).getByLabelText("任命"), "captain:0");
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", {
        command: { AssignMate: { owner: "player", mate: 0, role: { Captain: 0 } } },
      }),
    );
    await user.click(within(card).getByRole("button", { name: "解雇" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { DismissMate: { owner: "player", mate: 0 } } }),
    );
    expect(screen.getByText(/在 澄港 的酒馆/)).toBeInTheDocument();
  });
});
