// 殖民地：船员不足时从殖民者中带人上船；建立殖民地时殖民者人数默认取上限。
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { CargoTransfer } from "../components/colony/CargoTransfer";
import { coloniesView, installIpc, startedGame } from "./fixtures";

describe("从殖民地带人上船", () => {
  let calls: ReturnType<typeof installIpc>;
  beforeEach(() => {
    calls = installIpc();
    startedGame();
  });

  it("显示船员与殖民地人口，按输入人数提交 HireCrew", async () => {
    const user = userEvent.setup();
    const colony = coloniesView.colonies[0];
    render(<CargoTransfer colony={colony} />);
    expect(screen.getByTestId("colony-crew")).toHaveTextContent(`殖民地人口 ${colony.population}`);
    const box = screen.getByLabelText("带上船的人数");
    await user.clear(box);
    await user.type(box, "3");
    await user.click(screen.getByRole("button", { name: "带 3 名殖民者上船" }));
    await waitFor(() =>
      expect(calls).toHaveBeenCalledWith("submit", { command: { HireCrew: { owner: "player", fleet: 0, count: 3 } } }),
    );
  });

  it("没有人口信息时不显示带人上船", () => {
    const { population: _unused, ...rest } = coloniesView.colonies[0];
    void _unused;
    render(<CargoTransfer colony={rest} />);
    expect(screen.queryByTestId("colony-crew")).toBeNull();
  });
});
