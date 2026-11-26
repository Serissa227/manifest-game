// 第九批（C11）：有名有姓的传说之船（ShipView.legend）——舰队面板的船单与船厂的船行写它的名字、带“传说之船”标签、另写船型；
// 普通的船照旧写船型名；卖船照旧按船在舰队里的下标提交。
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import FleetPanel from "../components/panels/FleetPanel";
import PortPanel from "../components/panels/PortPanel";
import { setLocale } from "../i18n/locale";
import type { Overview } from "../ipc/types";
import { useGame } from "../store/game";
import { installIpc, overview, startedGame } from "./fixtures";

/** 机器很忙时交互多的用例会慢好几倍：单项给 15 秒，等异步的结果给 4 秒（断言一条没少）。 */
const HEAVY = 15_000;
const SLOW = { timeout: 4_000 };

/** 旗舰队两艘船：第 0 艘普通的单桅帆船，第 1 艘是传说之船“圣安娜号”（船型同样是单桅帆船）。 */
const withLegend: Overview = {
  ...overview,
  fleets: [
    {
      ...overview.fleets[0],
      used: 20,
      capacity: 160,
      crew_max: 40,
      ships: [
        { kind: 0, durability: 60, max_durability: 60, capacity: 80, guns: 2, refits: [], resale: 2400 },
        { legend: { key: "santa_ana", name: "圣安娜号" }, kind: 0, durability: 60, max_durability: 60, capacity: 80, guns: 2, refits: [], resale: 2600 },
      ],
    },
  ],
};

const submits = (calls: ReturnType<typeof installIpc>) => calls.mock.calls.filter(([cmd]) => cmd === "submit").map(([, a]) => a.command);

describe("传说之船", { timeout: HEAVY }, () => {
  beforeEach(() => {
    setLocale("zh-CN");
    startedGame();
    useGame.setState({ overview: withLegend });
  });

  it("舰队面板：传说之船写它的名字与“传说之船”标签，船型写在数值前；普通的船照旧写船型名", async () => {
    installIpc({ overview: () => withLegend });
    render(<FleetPanel />);
    // 等航行预估（异步）回来，免得更新落在测试之外
    await waitFor(() => expect(screen.getByTestId("sail-preview")).not.toHaveTextContent("正在载入"), SLOW);
    const items = within(screen.getByRole("list", { name: "船只" })).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText("单桅帆船")).toBeInTheDocument();
    expect(within(items[0]).queryByTestId("legend-ship-tag")).toBeNull();
    expect(within(items[1]).getByTestId("ship-legend-santa_ana")).toHaveTextContent("圣安娜号");
    const tag = within(items[1]).getByTestId("legend-ship-tag");
    expect(tag).toHaveTextContent("传说之船");
    expect(tag).toHaveAttribute("title", expect.stringContaining("秘闻 · 传说之船"));
    expect(within(items[1]).getByText("单桅帆船")).toHaveClass("pn-ship-hull");
  });

  it("船厂：传说之船的一行写名字、标签与船型；卖它照旧按下标提交 SellShip", async () => {
    const calls = installIpc({ overview: () => withLegend });
    useGame.setState({ facility: "shipyard" });
    const user = userEvent.setup();
    render(<PortPanel />);
    const plain = await screen.findByTestId("yard-ship-0-0");
    expect(within(plain).getByText("单桅帆船")).toBeInTheDocument();
    expect(within(plain).queryByTestId("legend-ship-tag")).toBeNull();
    const ship = screen.getByTestId("yard-ship-0-1");
    expect(within(ship).getByText("圣安娜号").tagName).toBe("STRONG");
    expect(within(ship).getByTestId("legend-ship-tag")).toHaveTextContent("传说之船");
    expect(ship).toHaveTextContent("单桅帆船");
    await user.click(within(ship).getByRole("button", { name: "出售 2,600 金币" }));
    await user.click(within(ship).getByRole("button", { name: "确定以 2,600 金币卖掉？" }));
    await waitFor(() => expect(submits(calls)).toEqual([{ SellShip: { owner: "player", fleet: 0, ship: 1 } }]), SLOW);
  });

  it("英文界面：标签写 Legendary，船名照后端给的", async () => {
    setLocale("en");
    installIpc({ overview: () => withLegend });
    render(<FleetPanel />);
    await waitFor(() => expect(screen.getByTestId("sail-preview")).not.toHaveTextContent(/loading/i), SLOW);
    expect(screen.getByTestId("legend-ship-tag")).toHaveTextContent("Legendary");
    expect(screen.getByTestId("ship-legend-santa_ana")).toHaveTextContent("圣安娜号");
  });
});
